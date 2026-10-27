"""Exercise real installed MSIX activation, package identity, collection and persistence."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
from datetime import datetime, timezone

import psutil
from onetop import __version__
from onetop.desktop_startup import local_json

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--package-info', type=Path, required=True)
parser.add_argument('--after-update', action='store_true')
args = parser.parse_args()
package = json.loads(args.package_info.read_text(encoding='utf-8-sig'))
target = Path(package['InstallLocation']) / 'app/1top.exe'
assert target.is_file(), package
test_root = root / 'build/windows/msix-test'
test_root.mkdir(parents=True, exist_ok=True)
temp = test_root / '한글 사용자'
profile = temp / 'profile'
profile.mkdir(parents=True, exist_ok=True)
sid = str(uuid.uuid4())
log = profile / 'projects/fixture' / f'{sid}.jsonl'
log.parent.mkdir(parents=True, exist_ok=True)
log.write_text(json.dumps({'type': 'assistant', 'timestamp': datetime.now(timezone.utc).isoformat(), 'message': {
    'id': 'fixture-response', 'model': 'test-model', 'usage': {
        'input_tokens': 100, 'cache_read_input_tokens': 200,
        'cache_creation_input_tokens': 10, 'output_tokens': 20}}}) + '\n', encoding='utf-8')
(profile / 'sessions').mkdir(exist_ok=True)
script = temp / 'node_modules/@anthropic-ai/claude-code/cli.js'
script.parent.mkdir(parents=True, exist_ok=True)
script.write_text('const fs=require("fs"),p=require("path");fs.writeFileSync(p.join(process.env.CLAUDE_CONFIG_DIR,"sessions",process.pid+".json"),JSON.stringify({sessionId:process.env.FIXTURE_SESSION,status:"idle",cwd:process.cwd()}));setInterval(()=>{},1000);', encoding='utf-8')
base = {'CLAUDE_CONFIG_DIR': str(profile), 'FIXTURE_SESSION': sid,
        'ONETOP_DATA': str(temp / 'state'), 'ONETOP_PORT': '18789'}
results = []
fixture = agent = None
ui_pid = None
cases = ('after-update', 'default-data-after-update') if args.after_update else (
    'default-data-location', 'empty-first-launch', 'cold-start', 'cold-start-with-proxy', 'existing-collector')
try:
    for name in cases:
        config = dict(base)
        if name in ('empty-first-launch', 'default-data-location'):
            config.pop('FIXTURE_SESSION')
            config['ONETOP_SMOKE_STORAGE_WRITE'] = 'preserved-through-msix-update'
        else:
            config['ONETOP_SMOKE_STORAGE_EXPECT'] = 'preserved-through-msix-update'
            if fixture is None:
                fixture = subprocess.Popen(['node', str(script)], env={**os.environ, **base})
        if name.startswith('default-data'):
            config.pop('ONETOP_DATA')
            marker = Path(os.environ['LOCALAPPDATA']) / '1top/msix-migration-probe.txt'
            if not args.after_update:
                marker.parent.mkdir(parents=True, exist_ok=True)
                marker.write_text('legacy-preserved', encoding='utf-8')
            config['ONETOP_SMOKE_MIGRATION_EXPECT'] = 'packaged-preserved' if args.after_update else 'legacy-preserved'
        if name == 'cold-start-with-proxy':
            config.update(HTTP_PROXY='http://127.0.0.1:1', HTTPS_PROXY='http://127.0.0.1:1',
                          ALL_PROXY='http://127.0.0.1:1', NO_PROXY='', no_proxy='')
        if name == 'existing-collector':
            agent = subprocess.Popen([str(target), '--agent', '--port', '18789'], env={**os.environ, **base})
            for _ in range(120):
                if (local_json(18789, '/health') or {}).get('app') == '1top':
                    break
                time.sleep(.25)
            else:
                raise RuntimeError('External collector did not start')
        else:
            assert local_json(18789, '/health') is None, 'Packaged cold launch must start its own collector'
        report = test_root / f'{name}.json'
        report.unlink(missing_ok=True)
        config['ONETOP_SMOKE_REPORT'] = str(report)
        config_path = test_root / 'activation-config.json'
        config_path.write_text(json.dumps(config), encoding='utf-8')
        activation = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', str(root / 'scripts/activate-windows-msix.ps1'), '-AppId', package['PackageFamilyName'] + '!OneTop',
            '-LaunchArguments', subprocess.list2cmdline(['--smoke-config', str(config_path)])],
            check=True, capture_output=True, text=True)
        ui_pid = int(activation.stdout.strip().splitlines()[-1])
        for _ in range(480):
            if report.exists() and not psutil.pid_exists(ui_pid):
                break
            time.sleep(.25)
        else:
            raise RuntimeError(f'MSIX activated PID {ui_pid} but no completed dashboard report for {name}')
        result = json.loads(report.read_text(encoding='utf-8'))
        assert result['package_identity'] == package['PackageFullName'], result
        assert result['maps'] and result['ready'] and result['dataReady'], result
        assert result['connection'] == '실시간 연결' and result['render_error'] is None, result
        assert result['rendered_sessions'] == result['session_count'], result
        assert result['renderedVersion'] == __version__ == result['collector_version'], result
        assert result['storage_expectation_met'], result
        assert result['host_resources'], result
        assert result['update_channel'] == 'microsoft-store', result
        assert result['collector_owned'] == (name != 'existing-collector'), result
        if name.startswith('default-data'):
            assert result['existing_data_preserved'], result
            assert '1top' in result['webview_storage'] and 'msix-test' not in result['webview_storage'], result
        if name in ('empty-first-launch', 'default-data-location'):
            assert result['session_count'] == 0, result
        else:
            assert result['fixture_tokens'] == [100, 200, 10, 20], result
            assert result['fixture_period_tokens'] == [100, 200, 10, 20], result
        if agent:
            assert agent.poll() is None, 'An external collector must survive UI quit'
        else:
            assert not psutil.pid_exists(result['collector_pid']), 'Owned collector left running'
            assert local_json(18789, '/health') is None
        result.update(scenario=name, installed_msix=True, activation='IApplicationActivationManager')
        results.append(result)
        print(json.dumps(result))
    filename = 'update-report.json' if args.after_update else 'smoke-report.json'
    (test_root / filename).write_text(json.dumps({'version': __version__, 'package': package['PackageFullName'],
        'scenarios': results, 'unicode_data_path': True, 'store_certified': False}, indent=2), encoding='utf-8')
finally:
    pids = [p.pid for p in (fixture, agent) if p is not None] + ([ui_pid] if ui_pid else [])
    for pid in pids:
        try:
            process = psutil.Process(pid)
            children = process.children(recursive=True)
            for p in [process, *children]:
                try:
                    p.terminate()
                except psutil.NoSuchProcess:
                    pass
            psutil.wait_procs([process, *children], timeout=10)
        except psutil.NoSuchProcess:
            pass
