"""Install the EXE and launch the actual app, including its owned collector."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid
from datetime import datetime, timezone

import psutil
from onetop import __version__
from onetop.desktop_startup import local_json

root = Path(__file__).resolve().parents[1]
installer = root / f'release/v{__version__}/1top-{__version__}-windows-x64-setup.exe'
target = root / 'build/windows/installed'
subprocess.run([str(installer), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', f'/DIR={target}'], check=True)
assert (target / '1top.exe').is_file()
results = []
with tempfile.TemporaryDirectory() as tmp:
    temp = Path(tmp) / '한글 사용자'
    profile = temp / 'profile'
    sid = str(uuid.uuid4())
    log = profile / 'projects' / 'fixture' / f'{sid}.jsonl'
    log.parent.mkdir(parents=True)
    log.write_text('', encoding='utf-8')
    (profile / 'sessions').mkdir()
    script = temp / 'node_modules/@anthropic-ai/claude-code/cli.js'
    script.parent.mkdir(parents=True)
    script.write_text('const fs=require("fs"),p=require("path");fs.writeFileSync(p.join(process.env.CLAUDE_CONFIG_DIR,"sessions",process.pid+".json"),JSON.stringify({sessionId:process.env.FIXTURE_SESSION,status:"idle",cwd:process.cwd()}));setInterval(()=>{},1000);', encoding='utf-8')
    env = {**os.environ, 'CLAUDE_CONFIG_DIR': str(profile), 'FIXTURE_SESSION': sid,
           'ONETOP_DATA': str(temp / 'state'), 'ONETOP_PORT': '18789'}
    fixture = None
    agent = None
    ui = None
    try:
        for name in ('empty-first-launch', 'cold-start', 'cold-start-with-proxy', 'existing-collector'):
            case_env = dict(env)
            if name == 'empty-first-launch':
                case_env.pop('FIXTURE_SESSION')
            elif fixture is None:
                fixture = subprocess.Popen(['node', str(script)], env=env)
            if name == 'cold-start-with-proxy':
                case_env.update(HTTP_PROXY='http://127.0.0.1:1', HTTPS_PROXY='http://127.0.0.1:1',
                                ALL_PROXY='http://127.0.0.1:1', NO_PROXY='', no_proxy='')
            if name == 'existing-collector':
                agent = subprocess.Popen([str(target / '1top.exe'), '--agent', '--port', '18789'], env=env)
                for _ in range(120):
                    if (local_json(18789, '/health') or {}).get('ready') is True:
                        break
                    time.sleep(.25)
                else:
                    raise RuntimeError('The external collector did not start')
            else:
                assert local_json(18789, '/health') is None, 'Cold-start test must not prestart the collector'
            report = root / f'build/windows/{name}.json'
            ui = subprocess.Popen([str(target / '1top.exe')], env={**case_env, 'ONETOP_SMOKE_REPORT': str(report)})
            if name == 'cold-start':
                # Emit a real-time report AFTER recording begins. Pre-existing
                # usage belongs to lifetime totals, not the recorded window.
                for _ in range(240):
                    if (local_json(18789, '/health') or {}).get('ready') is True:
                        break
                    time.sleep(.25)
                else:
                    raise RuntimeError('Cold-start collector never became available')
                log.write_text(json.dumps({'type': 'assistant', 'timestamp': datetime.now(timezone.utc).isoformat(), 'message': {
                    'id': 'fixture-response', 'model': 'test-model', 'usage': {
                        'input_tokens': 100, 'cache_read_input_tokens': 200,
                        'cache_creation_input_tokens': 10, 'output_tokens': 20}}}) + '\n', encoding='utf-8')
            ui.wait(120)
            assert ui.returncode == 0
            result = json.loads(report.read_text(encoding='utf-8'))
            assert 'smoke_failure' not in result, result
            assert result['maps'] and result['ready'], result
            assert result['dataReady'] and result['renderedVersion'] == __version__, result
            assert result['connection'] == '실시간 연결' and result['render_error'] is None, result
            assert result['rendered_sessions'] == result['session_count'], result
            if name == 'empty-first-launch':
                assert result['session_count'] == 0, result
            else:
                assert result['fixture_tokens'] == [100, 200, 10, 20], result
                assert result['fixture_period_tokens'] == [100, 200, 10, 20], result
            assert result['collector_version'] == __version__, result
            assert result['host_resources'], result
            # The tray quick view loads hidden beside the dashboard and lists the same root sessions.
            assert result['quick_ready'] and result['quick_render_error'] is None, result
            assert result['quick_rows'] == result['root_session_count'], result
            assert result['quick_connection'] == '실시간 · 이 PC', result
            assert result['window_title'] == '1top — 이 PC', result
            native=result['quick_native']
            assert all(native[k] for k in ('tool_window','not_app_window','within_work_area','blur_dismissed','preferences_restored','login_enabled','login_disabled','login_quick_view')), native
            assert all(r['synced'] for r in native['languages']+native['themes']), native
            assert native['circle_animations'] >= 5, native
            assert result['collector_owned'] == (name != 'existing-collector'), result
            if agent:
                assert agent.poll() is None, 'Closing the UI must preserve an external collector'
            else:
                assert not psutil.pid_exists(result['collector_pid']), 'Owned collector was left running'
                assert local_json(18789, '/health') is None
            result.update(scenario=name, installer=True, exact_fixture_usage=name != 'empty-first-launch')
            results.append(result)
            print(json.dumps(result))
        (root / 'build/windows/smoke-report.json').write_text(json.dumps({
            'version': __version__, 'scenarios': results, 'unicode_data_path': True,
            'first_launch_without_prestarted_collector': True}, indent=2), encoding='utf-8')
    finally:
        for process in (ui, agent, fixture):
            if process is None:
                continue
            try:
                children = psutil.Process(process.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                children = []
            if process.poll() is None:
                process.terminate()
                process.wait(10)
            for child in children:
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass
        logs = temp / 'state/logs'
        if logs.exists():
            shutil.copytree(logs, root / 'build/windows/diagnostics', dirs_exist_ok=True)
