"""Refresh only 1top-enrolled Claude logins; never export or log credentials."""
import contextlib
import ctypes
import getpass
import hashlib
import json
import os
import ssl
import subprocess
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

import certifi
from .account_login import managed_profiles_dir


class CredentialError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def service_name(root):
    suffix = '' if root == Path.home()/'.claude' else '-' + hashlib.sha256(
        unicodedata.normalize('NFC', str(root)).encode()).hexdigest()[:8]
    return 'Claude Code-credentials' + suffix


def keychain_document(root):
    if os.name == 'nt' or os.uname().sysname != 'Darwin':
        return None
    try:
        result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-a',
            getpass.getuser(), '-w', '-s', service_name(root)], capture_output=True, text=True, timeout=3)
        if result.returncode == 44:return None  # errSecItemNotFound
        if result.returncode or len(result.stdout) > 128*1024:
            raise CredentialError('credential_store_unavailable')
        value = json.loads(result.stdout)
        if isinstance(value, dict) and isinstance(value.get('claudeAiOauth'), dict):
            return value
    except (ValueError, OSError, subprocess.SubprocessError):
        raise CredentialError('credential_store_unavailable') from None
    return None


def save_keychain(root, document):
    # Call Security.framework directly: tokens never enter argv, a shell, or logs.
    sec = ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
    cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    find = sec.SecKeychainFindGenericPassword
    find.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p,
                    ctypes.c_uint32, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint32),
                    ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)]
    find.restype = ctypes.c_int32
    modify = sec.SecKeychainItemModifyAttributesAndData
    modify.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p]
    modify.restype = ctypes.c_int32
    sec.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    service, account = service_name(root).encode(), getpass.getuser().encode()
    size, data, item = ctypes.c_uint32(), ctypes.c_void_p(), ctypes.c_void_p()
    if find(None, len(service), service, len(account), account,
            ctypes.byref(size), ctypes.byref(data), ctypes.byref(item)):
        raise CredentialError('credential_store_unavailable')
    try:
        encoded = json.dumps(document, separators=(',', ':')).encode()
        if modify(item, None, len(encoded), encoded):
            raise CredentialError('credential_store_unavailable')
    finally:
        sec.SecKeychainItemFreeContent(None, data)
        cf.CFRelease(item)


def managed(root):
    root = Path(root)
    return (not root.is_symlink() and root.resolve().parent ==
            (managed_profiles_dir()/'claude').resolve())


@contextlib.contextmanager
def refresh_lock(root):
    # OS locks are released even after a crash. Never wait behind another collector.
    fd = os.open(root/'.1top-refresh.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if os.name == 'nt':
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b'0')
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    except (BlockingIOError, PermissionError):
        raise CredentialError('refresh_pending') from None
    finally:
        os.close(fd)


def refresh_request(credentials):
    from .accounts import NoRedirect
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(
        context=ssl.create_default_context(cafile=certifi.where())))
    body = {'grant_type': 'refresh_token', 'refresh_token': credentials['refreshToken'],
            'client_id': '9d1c250a-e61b-44d9-88ed-5944d1962f5e'}
    # Preserve granted scopes; do not request new permissions on the user's behalf.
    if credentials.get('scopes'):
        body['scope'] = ' '.join(credentials['scopes'])
    request = urllib.request.Request('https://platform.claude.com/v1/oauth/token',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
            'Accept': 'application/json', 'User-Agent': '1top/3.9.0'})
    try:
        with opener.open(request, timeout=15) as response:
            value = json.loads(response.read(128*1024))
    except urllib.error.HTTPError as error:
        code = {400:'login_required',401:'login_required',403:'access_denied',429:'rate_limited'}.get(error.code,'provider_unavailable')
        error.close()
        raise CredentialError(code) from None
    if (not isinstance(value, dict) or not isinstance(value.get('access_token'), str)
            or not value['access_token'] or not isinstance(value.get('expires_in'), (int, float))
            or not 0 < value['expires_in'] < 366*86400):
        raise CredentialError('invalid_response')
    return value


def refresh_managed(root, now=None):
    from .accounts import claude_credentials, read_json, timestamp
    root = Path(root)
    if not managed(root):
        raise CredentialError('login_expired')
    now = now or time.time()
    with refresh_lock(root):
        current = claude_credentials(root)
        if current.get('accessToken') and timestamp(current.get('expiresAt')) > now + 60:
            return current
        if not current.get('refreshToken'):
            raise CredentialError('login_required')
        config = root/'.claude.json'
        account = read_json(config).get('oauthAccount') or {}
        if not account.get('accountUuid'):
            raise CredentialError('login_required')
        identity = (account.get('accountUuid'), account.get('organizationUuid'))
        result = refresh_request(current)
        after = read_json(config).get('oauthAccount') or {}
        if identity != (after.get('accountUuid'), after.get('organizationUuid')):
            raise CredentialError('account_changed')
        if claude_credentials(root) != current:
            raise CredentialError('refresh_pending')
        renewed = {**current, 'accessToken': result['access_token'],
                   'refreshToken': result.get('refresh_token') or current['refreshToken'],
                   'expiresAt': int((time.time() + result['expires_in'])*1000)}
        if isinstance(result.get('scope'), str):
            renewed['scopes'] = result['scope'].split()
        document = keychain_document(root)
        if document is not None:
            document['claudeAiOauth'] = renewed
            save_keychain(root, document)
        else:
            path = root/'.credentials.json'
            document = read_json(path)
            if document.get('claudeAiOauth') != current:
                raise CredentialError('credential_store_unavailable')
            document['claudeAiOauth'] = renewed
            fd, temp = tempfile.mkstemp(prefix='.credentials-', dir=root)
            try:
                with os.fdopen(fd, 'w') as stream:
                    json.dump(document, stream, separators=(',', ':'))
                    stream.flush(); os.fsync(stream.fileno())
                os.replace(temp, path)
            finally:
                if os.path.exists(temp): os.unlink(temp)
        return renewed
