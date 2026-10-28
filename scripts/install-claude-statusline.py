#!/usr/bin/env python3
"""Opt-in, reversible Claude status-line integration; never reads credentials."""
import argparse
import hashlib
import json
import os
import re
import shlex
import stat
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent'))
from onetop.platform_support import data_directory

VERSION = re.compile(r'^v\d+\.\d+\.\d+$')


class InstallError(ValueError):
    pass


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def read_file(path, optional=False):
    """Read regular files without following a final symlink; never print bytes."""
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    except FileNotFoundError:
        if optional:
            return None
        raise InstallError('Required integration file is missing') from None
    except OSError:
        raise InstallError('Cannot read a regular integration file') from None
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode) or Path(path).is_symlink():
            raise InstallError('Symlink or non-regular file refused')
        return stream.read()


def document(raw):
    try:
        value = json.loads(raw) if raw is not None else {}
    except (ValueError, UnicodeError):
        raise InstallError('Settings or integration JSON is invalid; left unchanged') from None
    if not isinstance(value, dict):
        raise InstallError('Settings or integration JSON must be an object')
    return value


def profile_path(value):
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise InstallError('Profile must be an existing absolute non-symlink directory')
    return path.resolve()


def profile_hash(profile):
    return hashlib.sha256(str(profile).encode()).hexdigest()[:20]


def integration_base():
    return Path(data_directory()).absolute() / 'integrations' / 'claude-statusline'


def checked_path(path, base):
    """Only touch descendants of our integration tree, with no symlink components."""
    path = Path(path)
    try:
        relative = path.relative_to(base)
    except ValueError:
        raise InstallError('Integration path is outside the known directory') from None
    current = base
    for part in (None, *relative.parts):
        if part is not None:
            current /= part
        if current.is_symlink():
            raise InstallError('Symlink integration paths are refused')
    # A symlink above the integration root must not redirect known specs elsewhere.
    if base.resolve(strict=False) != base:
        raise InstallError('Integration directory must not traverse symlinks')
    return path


def wrapper_spec(command, profile, base):
    try:
        args = shlex.split(command)
    except ValueError:
        return None  # It is an existing user's command, preserved verbatim.
    if len(args) != 4 or args[1:3] != ['statusline', '--config'] or not Path(args[0]).is_absolute():
        return None
    path = Path(args[3])
    if not path.is_absolute():
        return None
    try:
        parts = path.relative_to(base).parts
    except ValueError:
        return None  # Do not read arbitrary paths mentioned in existing commands.
    if len(parts) != 3 or not VERSION.fullmatch(parts[0]) or parts[1] != profile_hash(profile) or parts[2] != 'spec.json':
        raise InstallError('Unrecognized 1top status-line specification path')
    return checked_path(path, base)


def original_command(command, profile, base):
    seen = set()
    for _ in range(16):
        path = wrapper_spec(command, profile, base)
        if path is None:
            return command
        if path in seen:
            raise InstallError('Recursive status-line integration refused')
        seen.add(path)
        spec = document(read_file(path))
        if spec.get('profile') != str(profile) or not isinstance(spec.get('original_command'), str):
            raise InstallError('Existing integration specification does not match this profile')
        command = spec['original_command']
    raise InstallError('Too many nested status-line integrations')


def atomic_write(path, raw, exclusive=False):
    if path.is_symlink():
        raise InstallError('Symlink write target refused')
    fd, temporary = tempfile.mkstemp(prefix='.1top-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary, path)  # Atomic publication, never overwrite a backup.
        else:
            os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def make_private_dirs(path, base):
    checked_path(path, base)
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    if not current.is_dir() or current.is_symlink():
        raise InstallError('Integration parent is not a regular directory')
    for directory in reversed(missing):
        directory.mkdir(mode=0o700)


def prepare(profile, agent, version, restore=False):
    profile = profile_path(profile)
    if not VERSION.fullmatch(version):
        raise InstallError('Version must use vMAJOR.MINOR.PATCH')
    base = integration_base()
    folder = checked_path(base / version / profile_hash(profile), base)
    settings = profile / 'settings.json'
    raw = read_file(settings, optional=True)
    current = document(raw)
    statusline = current.get('statusLine', {})
    if not isinstance(statusline, dict) or not isinstance(statusline.get('command', ''), str):
        raise InstallError('Existing statusLine must be an object with a string command')
    if statusline.get('type', 'command') != 'command':
        raise InstallError('Unsupported statusLine type; left unchanged')
    spec_path, meta_path = folder / 'spec.json', folder / 'backup.json'
    meta_raw = read_file(meta_path, optional=True)
    meta = document(meta_raw) if meta_raw is not None else None
    if meta is not None:
        if meta.get('profile') != str(profile) or not isinstance(meta.get('settings_existed'), bool):
            raise InstallError('Backup metadata does not match this profile')
        before = read_file(folder / 'settings.before.json') if meta['settings_existed'] else None
        if hashlib.sha256(before or b'').hexdigest() != meta.get('before_sha256'):
            raise InstallError('Backup verification failed; left unchanged')
    else:
        before = raw
        if folder.exists():
            raise InstallError('Incomplete or conflicting backup directory; use a new version')
    if restore:
        if meta is None:
            raise InstallError('No backup exists for this version and profile')
        if wrapper_spec(statusline.get('command', ''), profile, base) != spec_path:
            if raw == before:
                return dict(profile=profile, settings=settings, raw=raw, desired=raw, folder=folder, restore=True)
            raise InstallError('Current statusLine was changed elsewhere; restore refused')
        original_command(statusline['command'], profile, base)  # Validate our spec before modifying settings.
        if hashlib.sha256(raw or b'').hexdigest() == meta.get('installed_sha256'):
            desired = before
        else:
            # Preserve unrelated edits made after installation.
            prior = document(before)
            if 'statusLine' in prior:
                current['statusLine'] = prior['statusLine']
            else:
                current.pop('statusLine', None)
            desired = encoded(current)
        return dict(profile=profile, settings=settings, raw=raw, desired=desired, folder=folder, restore=True)
    agent = Path(agent or '')
    if not agent.is_absolute() or not agent.is_file() or not os.access(agent, os.X_OK):
        raise InstallError('Agent must be an absolute executable file')
    original = original_command(statusline.get('command', ''), profile, base)
    spec = {'profile': str(profile), 'original_command': original,
            'report_directory': str((Path(data_directory()) / 'claude-statusline').resolve())}
    if meta is not None and document(read_file(spec_path)) != spec:
        raise InstallError('Original command differs from this version backup; use a new version')
    current['statusLine'] = {**statusline, 'type': 'command', 'command': shlex.join([str(agent), 'statusline', '--config', str(spec_path)])}
    desired = encoded(current)
    return dict(profile=profile, settings=settings, raw=raw, desired=desired, folder=folder,
                restore=False, spec=spec, new_backup=meta is None)


def apply_plan(plan):
    profile, settings, folder = plan['profile'], plan['settings'], plan['folder']
    if profile.is_symlink() or not profile.is_dir() or read_file(settings, optional=True) != plan['raw']:
        raise InstallError('Profile settings changed during installation; retry after checking them')
    if plan['raw'] == plan['desired']:
        return False
    if not plan['restore'] and plan['new_backup']:
        make_private_dirs(folder, integration_base())
        if plan['raw'] is not None:
            atomic_write(folder / 'settings.before.json', plan['raw'], exclusive=True)
        atomic_write(folder / 'spec.json', encoded(plan['spec']), exclusive=True)
        meta = {'profile': str(profile), 'settings_existed': plan['raw'] is not None,
                'before_sha256': hashlib.sha256(plan['raw'] or b'').hexdigest(),
                'installed_sha256': hashlib.sha256(plan['desired']).hexdigest()}
        atomic_write(folder / 'backup.json', encoded(meta), exclusive=True)
    if read_file(settings, optional=True) != plan['raw']:
        raise InstallError('Settings changed while backing up; settings were not replaced')
    if plan['desired'] is None:
        settings.unlink()
    else:
        atomic_write(settings, plan['desired'])
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--agent', help='Absolute packaged 1top agent executable')
    parser.add_argument('--profile', action='append', required=True, help='Absolute existing Claude profile root; repeatable')
    parser.add_argument('--version', required=True, help='Backup version, for example v3.16.0')
    parser.add_argument('--apply', action='store_true', help='Write changes; otherwise inspect only')
    parser.add_argument('--restore', action='store_true', help='Restore this version while preserving later unrelated settings edits')
    args = parser.parse_args(argv)
    try:
        plans = [prepare(p, args.agent, args.version, args.restore) for p in dict.fromkeys(args.profile)]
        for plan in plans:
            changed = apply_plan(plan) if args.apply else plan['raw'] != plan['desired']
            print(json.dumps({'profile': str(plan['profile']), 'action': 'restore' if args.restore else 'install',
                              'applied': args.apply, 'changed': changed, 'backup_directory': str(plan['folder'])}))
    except (InstallError, OSError) as error:
        # Never include settings values, original shell commands or credential material.
        print(json.dumps({'error': str(error) if isinstance(error, InstallError) else 'Filesystem operation failed; settings were not intentionally overwritten'}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
