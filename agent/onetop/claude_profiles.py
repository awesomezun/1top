"""Refresh only 1top-enrolled Claude logins; never export or log credentials."""
import contextlib
import ctypes
import getpass
import hashlib
import json
import os
import ssl
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


def _keychain_query_names(read=True):
    # Both reads and refresh writes must fail rather than request authorization.
    keys = [('kSecClass', 'kSecClassGenericPassword'),
            ('kSecUseAuthenticationUI', 'kSecUseAuthenticationUIFail')]
    if read:
        keys += [('kSecMatchLimit', 'kSecMatchLimitOne'),
                 ('kSecReturnData', 'kCFBooleanTrue')]
    return keys


def _keychain_operation(root, document=None):
    """Access one existing item without UI, shell arguments, or ACL changes."""
    sec = ctypes.CDLL('/System/Library/Frameworks/Security.framework/Security')
    # Legacy login-keychain items can ignore kSecUseAuthenticationUIFail. This
    # switch belongs to this collector process, not the OS or an item's ACL.
    # Never restore TRUE: concurrent profile jobs must all remain noninteractive.
    setter = sec.SecKeychainSetUserInteractionAllowed
    setter.argtypes = [ctypes.c_ubyte]
    setter.restype = ctypes.c_int32
    if setter(False):
        raise CredentialError('credential_store_unavailable')
    return _keychain_noninteractive_operation(sec, root, document)


def _keychain_noninteractive_operation(sec, root, document):
    cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
    cf.CFStringCreateWithCString.restype = ctypes.c_void_p
    cf.CFDictionaryCreate.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p),
                                    ctypes.POINTER(ctypes.c_void_p), ctypes.c_long,
                                    ctypes.c_void_p, ctypes.c_void_p]
    cf.CFDictionaryCreate.restype = ctypes.c_void_p
    cf.CFDataCreate.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_long]
    cf.CFDataCreate.restype = ctypes.c_void_p
    cf.CFDataGetLength.argtypes = [ctypes.c_void_p]
    cf.CFDataGetLength.restype = ctypes.c_long
    cf.CFDataGetBytePtr.argtypes = [ctypes.c_void_p]
    cf.CFDataGetBytePtr.restype = ctypes.c_void_p
    cf.CFGetTypeID.argtypes = [ctypes.c_void_p]
    cf.CFGetTypeID.restype = ctypes.c_ulong
    cf.CFDataGetTypeID.restype = ctypes.c_ulong
    cf.CFRelease.argtypes = [ctypes.c_void_p]
    sec.SecItemCopyMatching.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    sec.SecItemCopyMatching.restype = ctypes.c_int32
    sec.SecItemUpdate.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    sec.SecItemUpdate.restype = ctypes.c_int32
    owned = []

    def constant(name):
        return ctypes.c_void_p.in_dll(cf if name.startswith('kCF') else sec, name).value

    def own(value):
        if not value:raise CredentialError('credential_store_unavailable')
        owned.append(value)
        return value

    def string(value):
        return own(cf.CFStringCreateWithCString(None, value.encode(), 0x08000100))

    def dictionary(pairs):
        keys = (ctypes.c_void_p * len(pairs))(*(constant(key) for key, _ in pairs))
        values = (ctypes.c_void_p * len(pairs))(*(value for _, value in pairs))
        key_callbacks = ctypes.addressof(ctypes.c_byte.in_dll(cf, 'kCFTypeDictionaryKeyCallBacks'))
        value_callbacks = ctypes.addressof(ctypes.c_byte.in_dll(cf, 'kCFTypeDictionaryValueCallBacks'))
        return own(cf.CFDictionaryCreate(None, keys, values, len(pairs), key_callbacks, value_callbacks))

    try:
        pairs = [(key, constant(value)) for key, value in _keychain_query_names(document is None)]
        pairs += [('kSecAttrService', string(service_name(root))),
                  ('kSecAttrAccount', string(getpass.getuser()))]
        query = dictionary(pairs)
        if document is not None:
            encoded = json.dumps(document, separators=(',', ':')).encode()
            if len(encoded) > 128 * 1024:raise CredentialError('credential_store_unavailable')
            value = own(cf.CFDataCreate(None, encoded, len(encoded)))
            status = sec.SecItemUpdate(query, dictionary([('kSecValueData', value)]))
            if status:raise CredentialError('credential_store_unavailable')
            return None
        value = ctypes.c_void_p()
        status = sec.SecItemCopyMatching(query, ctypes.byref(value))
        if status == -25300:return None  # errSecItemNotFound
        if status:raise CredentialError('credential_store_unavailable')
        own(value.value)
        if cf.CFGetTypeID(value) != cf.CFDataGetTypeID():
            raise CredentialError('credential_store_unavailable')
        size = cf.CFDataGetLength(value)
        if not 0 < size <= 128 * 1024:raise CredentialError('credential_store_unavailable')
        return ctypes.string_at(cf.CFDataGetBytePtr(value), size)
    finally:
        for value in reversed(owned):cf.CFRelease(value)


def keychain_document(root):
    if os.name == 'nt' or os.uname().sysname != 'Darwin':
        return None
    try:
        encoded = _keychain_operation(root)
        if encoded is None:return None
        value = json.loads(encoded)
        if isinstance(value, dict) and isinstance(value.get('claudeAiOauth'), dict):
            return value
    except (ValueError, OSError, TypeError, AttributeError):
        raise CredentialError('credential_store_unavailable') from None
    return None


def save_keychain(root, document):
    try:
        _keychain_operation(root, document)
    except (ValueError, OSError, TypeError, AttributeError):
        raise CredentialError('credential_store_unavailable') from None


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
    from .credential_store import enrolled_document, save_enrolled
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
        enrolled=enrolled_document(root)
        if enrolled is not None:
            enrolled['claudeAiOauth']=renewed
            save_enrolled(root,enrolled)
            return renewed
        try:document = keychain_document(root)
        except CredentialError:
            # Continue only an existing, matching managed file login. Do not
            # create a plaintext copy of a Keychain-only login.
            if read_json(root/'.credentials.json').get('claudeAiOauth') != current:raise
            document = None
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
