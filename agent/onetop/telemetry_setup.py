"""Explicit, reversible enrollment of CLI exporters in the local OTLP receiver."""
import json
import os
import tempfile
import time
import tomllib
from pathlib import Path

from .platform_support import data_directory
from .telemetry import receiver_key

BEGIN = '# BEGIN 1top local telemetry'
END = '# END 1top local telemetry'


def write_private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.'+path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def enable(directory=None, profiles=None, port=18766):
    directory = Path(directory) if directory is not None else data_directory()
    if not 1 <= port <= 65535:
        raise ValueError('Invalid local port')
    if profiles is None:
        from .accounts import profile_roots
        profiles = profile_roots()
    key = receiver_key(directory)
    endpoint = f'http://127.0.0.1:{port}'
    manifest_path = directory/'telemetry-enrollment.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'profiles': []}
    managed = {p['path']: p for p in manifest['profiles']}
    output = []
    for kind, root in profiles:
        if kind not in ('Claude', 'Codex'):
            continue
        path = Path(root)/('settings.json' if kind == 'Claude' else 'config.toml')
        if path.is_symlink():
            output.append({'provider': kind, 'path': str(path), 'status': 'skipped_symlink'})
            continue
        raw = path.read_text() if path.exists() else ''
        previous = managed.get(str(path))
        if previous:
            current = (all(json.loads(raw).get('env',{}).get(k)==v for k,v in previous['env'].items())
                       if kind == 'Claude' else previous['block'] in raw)
            output.append({'provider': kind, 'path': str(path), 'status': 'already_enrolled' if current else 'modified_configuration_preserved'})
            continue
        if kind == 'Claude':
            config = json.loads(raw) if raw.strip() else {}
            env = config.get('env', {})
            if not isinstance(env, dict):
                output.append({'provider': kind, 'path': str(path), 'status': 'invalid_environment'})
                continue
            if any(k.startswith('OTEL_') or k == 'CLAUDE_CODE_ENABLE_TELEMETRY' for k in env):
                output.append({'provider': kind, 'path': str(path), 'status': 'existing_telemetry_preserved'})
                continue
            additions = {'CLAUDE_CODE_ENABLE_TELEMETRY': '1', 'OTEL_METRICS_EXPORTER': 'otlp',
                         'OTEL_LOGS_EXPORTER': 'otlp', 'OTEL_TRACES_EXPORTER': 'none',
                         'OTEL_EXPORTER_OTLP_PROTOCOL': 'http/json',
                         'OTEL_EXPORTER_OTLP_ENDPOINT': endpoint,
                         'OTEL_EXPORTER_OTLP_HEADERS': 'X-1top-Telemetry-Key='+key,
                         'OTEL_METRIC_EXPORT_INTERVAL': '10000', 'OTEL_LOGS_EXPORT_INTERVAL': '1000',
                         'OTEL_LOG_USER_PROMPTS': '0', 'OTEL_LOG_ASSISTANT_RESPONSES': '0',
                         'OTEL_LOG_TOOL_DETAILS': '0', 'OTEL_METRICS_INCLUDE_SESSION_ID': 'true',
                         'OTEL_METRICS_INCLUDE_ACCOUNT_UUID': 'true'}
            config['env'] = {**env, **additions}
            updated = json.dumps(config, indent=2, ensure_ascii=False)+'\n'
            entry = {'kind': kind, 'path': str(path), 'env': additions}
        else:
            config = tomllib.loads(raw)
            if 'otel' in config:
                output.append({'provider': kind, 'path': str(path), 'status': 'existing_telemetry_preserved'})
                continue
            exporter = lambda suffix: '{ otlp-http = { endpoint = '+json.dumps(endpoint+suffix)+', protocol = "json", headers = { "X-1top-Telemetry-Key" = '+json.dumps(key)+' } } }'
            block = ('\n'+BEGIN+'\n[otel]\nlog_user_prompt = false\n'
                     'exporter = '+exporter('/v1/logs')+'\n'
                     'metrics_exporter = '+exporter('/v1/metrics')+'\n'+END+'\n')
            updated = raw.rstrip()+'\n'+block
            tomllib.loads(updated)
            entry = {'kind': kind, 'path': str(path), 'block': block}
        backup = directory/'telemetry-backups'/str(time.time_ns())/path.name
        write_private(backup, raw)
        entry['backup'] = str(backup)
        # Persist recovery information before changing external CLI settings.
        manifest['profiles'].append(entry)
        write_private(manifest_path, json.dumps(manifest, indent=2))
        write_private(path, updated)
        output.append({'provider': kind, 'path': str(path), 'status': 'enabled', 'backup': str(backup)})
    return {'endpoint': endpoint, 'profiles': output, 'restart_required': True,
            'message': 'Existing AI sessions were not restarted. New sessions load the exporter settings.'}


def disable(directory=None):
    directory = Path(directory) if directory is not None else data_directory()
    path = directory/'telemetry-enrollment.json'
    if not path.exists():
        return {'profiles': []}
    manifest = json.loads(path.read_text())
    output = []
    retained = []
    for entry in manifest['profiles']:
        target = Path(entry['path'])
        if not target.exists() or target.is_symlink():
            retained.append(entry)
            output.append({'path': str(target), 'status': 'unchanged'})
            continue
        raw = target.read_text()
        if entry['kind'] == 'Claude':
            config = json.loads(raw)
            env = config.get('env', {})
            for key, value in entry['env'].items():
                if env.get(key) == value:
                    env.pop(key)
            if not env:
                config.pop('env', None)
            updated = json.dumps(config, ensure_ascii=False, indent=2)+'\n'
        else:
            if entry['block'] not in raw:
                retained.append(entry)
                output.append({'path': str(target), 'status': 'modified_configuration_preserved'})
                continue
            updated = raw.replace(entry['block'], '', 1)
            tomllib.loads(updated)
        write_private(target, updated)
        output.append({'path': str(target), 'status': 'disabled'})
    write_private(path, json.dumps({'profiles': retained}, indent=2))
    return {'profiles': output, 'restart_required': True}


def command(name, port=18766):
    if name == 'telemetry-enable':
        return enable(port=port)
    if name == 'telemetry-disable':
        return disable()
    from .telemetry import TelemetryStore
    return TelemetryStore(data_directory()).snapshot()
