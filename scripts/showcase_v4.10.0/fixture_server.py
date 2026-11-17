"""Synthetic-only recording server. Never reads user data or executes controls."""
import json
import math
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
START = time.time()
PERIODS = [('24h', '24시간', 86400, 12), ('12h', '12시간', 43200, 7),
           ('5h', '5시간', 18000, 3), ('1h', '1시간', 3600, 1),
           ('30m', '30분', 1800, .6), ('10m', '10분', 600, .25)]


def snapshot():
    now = time.time()
    step = int((now - START) / 3) % 5
    sessions = []
    examples = [
        ('Claude', 'website', 'Cursor', 'Frontend', 'claude-sonnet-4-6', 38),
        ('Codex', 'api-service', 'Orca', 'Backend', 'gpt-5.4', 22),
        ('Codex', 'research', 'Aside', 'Research', 'gpt-5.4', 13),
        ('GLM', 'docs', 'Visual Studio Code', 'Docs', 'glm-5', 8),
        ('Claude', 'design-system', 'Cursor', 'Components', 'claude-sonnet-4-6', 6),
        ('Codex', 'mobile-app', 'Terminal', 'Mobile', 'gpt-5.4', 4),
        ('Claude', 'test-suite', 'Orca', 'Tests', 'claude-sonnet-4-6', 3),
        ('Codex', 'data-pipeline', 'Visual Studio Code', 'Data', 'gpt-5.4', 2),
        ('GLM', 'release-notes', 'Terminal', 'Release', 'glm-5', 1.5),
        ('Claude', 'auth-service', 'Cursor', 'Auth', 'claude-sonnet-4-6', 1.2),
        ('Codex', 'search-index', 'Aside', 'Search', 'gpt-5.4', .8),
        ('Claude', 'icon-library', 'Orca', 'Icons', 'claude-sonnet-4-6', .5),
    ]
    for i, (kind, project, app, terminal, model, share) in enumerate(examples):
        working = i < 5 or (i == 5 and step < 3)
        amount = round(share * 10000 * (1 + step * .003 * (1 + i % 3)))
        tokens = [round(amount * .22), round(amount * .63), round(amount * .03)]
        tokens.append(amount - sum(tokens))
        windows = {k: [round(x * mul) for x in tokens] for k, _, _, mul in PERIODS}
        sessions.append(dict(id=f'demo-session-{i}', kind=kind, project=project,
            title=f'Work on {project}',
            cwd=f'~/projects/{project}', model=model, context_usage=dict(basis='last_request_input',input_tokens=64000+i*6000+step*400,capacity=200000 if i==1 else None,parts=[12000+i*2000+step*400,48000+i*4000,4000],observed_at=now-3,model=model), status='working' if working else 'idle',
            tokens=[x * 18 for x in tokens], pids=[4101 + i],
            last_usage=now - 2, path='Example usage report', terminal_note='Illustrative session',
            note='Synthetic demo data', control_key=f'demo-key-{i}', input_verified=True,
            orca_terminal={'title': terminal, 'handle': f'demo-{i}'} if app == 'Orca' else None,
            location={'app': app, 'terminal': terminal, 'app_path': f'/Applications/{app}.app'},
            resources=dict(cpu=round(8 + i * 4 + step * .7, 1), rss=(320 + i * 100) * 2**20, count=2),
            usage=dict(rate=(620 + step * 21 if i == 0 else 170 + i * 52 + step * 21) if working else 0, windows=windows,
                last_minute=[x // 4 for x in tokens], last_five_minutes=[x // 2 for x in tokens], output_rate=24,
                history=[[now - 3600 + n * 60, int((1 + math.sin(n / 4)) * 800 + n * 20)] for n in range(60)])))
    windows = [dict(key=k, label=label, seconds=secs, partial=False, observed_seconds=secs,
        tokens=[sum(s['usage']['windows'][k][i] for s in sessions) for i in range(4)],
        by_kind={kind: [sum(s['usage']['windows'][k][j] for s in sessions if s['kind'] == kind) for j in range(4)] for kind in dict.fromkeys(s['kind'] for s in sessions)}) for k, label, secs, _ in PERIODS]
    quotas = [dict(id='demo-account-'+str(i), kind=kind, account_label=email, plan=plan,
        updated=now - 15, stale=False, note='예시 계정 · 제공자 보고값', windows=[
            *([] if kind == 'Codex' and plan == 'Pro' else [dict(label='5H', pct=pct + step, reset=now + 7200 + i*900)]),
            dict(label='주간', pct=weekly, reset=now + 172800 + i*86400)])
        for i, (kind, plan, email, pct, weekly) in enumerate([
            ('Claude', 'Max', 'personal@example.com', 24, 61),
            ('Codex', 'Pro', 'personal@example.com', 38, 72),
            ('Claude', 'Team', 'work@example.com', 12, 35),
            ('Codex', 'Business', 'work@example.com', 8, 48)])]
    host = dict(cpu=24 + step * 1.3, cores=12, load=[3.2, 2.8, 2.3],
        memory=dict(used=28 * 2**30, total=64 * 2**30, available=36 * 2**30, percent=43.8),
        swap=dict(used=0), network=dict(rx=(140 + step * 30) * 1024, tx=38000, interfaces=['en0']),
        disk=dict(free=382 * 2**30, percent=62.7, read=1200000, write=420000),
        platform='macOS · Apple silicon', process_count=410, uptime=200000,
        battery=dict(percent=92, plugged=True), gpu_note='GPU·온도 정보 미수집')
    return dict(ready=True, version='3.3.0', updated=now, started=now - 172800, sessions=sessions,
        process_counts=dict(Counter(s['kind'] for s in sessions)), orca_terminals=sum(s['location']['app'] == 'Orca' for s in sessions), collection_ms=39,
        action_token='recording-disabled', actions=[], quotas=[], account_quotas=quotas,
        period_usage=dict(recording_started=now - 172800, known_kinds=list(dict.fromkeys(s['kind'] for s in sessions)), windows=windows),
        system=dict(host=host, shared=[], top=[], monitor=dict(cpu=.7, rss=48 * 2**20), sampler_ms=9,
            history=[dict(t=now-900+n*15, cpu=25+math.sin(n/7)*9, memory=43.8) for n in range(61)]),
        events=[dict(t=now-3600+n*60, kind=s['kind'], n=int(1000+1000*math.sin(n/8)**2+i*300))
            for i, s in enumerate(sessions) for n in range(60)],
        operations=dict(goal_source_status='reported', goals=[dict(goal_id='example-goal', runtime='Codex',
            objective='Ship the API update with passing checks', location='Orca · Backend',
            status='active', session_connected=True, tokens_used=82400 + step*1000,
            token_budget=200000, time_used_seconds=1500, evidence='stored')],
            skills=[dict(name=n, path=f'~/skills/{n}/SKILL.md', providers=['Claude', 'Codex'], scope='user')
                for n in ['code-review', 'testing', 'docs']], events=[dict(category='loop', name='/loop',
                    location='Orca · Frontend', state='fire_observed', observed_at=now*1000, schedule='5m')]))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_POST(self):
        self.send_response(403); self.end_headers()
        self.wfile.write(b'{"ok":false,"message":"Recording fixture: controls disabled"}')

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/state':
            data = json.dumps(snapshot()).encode(); mime = 'application/json'
        elif path == '/benchmark.json':
            data = b'[]'; mime = 'application/json'
        elif path in ('/', '/index.html', '/style.css', '/app.js', '/maps.js', '/maps.css', '/typography.css'):
            file = ROOT / 'agent/onetop/dist' / ('index.html' if path == '/' else path[1:])
            data = file.read_bytes()
            mime = {'html': 'text/html', 'css': 'text/css', 'js': 'text/javascript'}[file.suffix[1:]]
        elif path in {f'/fonts/ibm-plex/v1.0.0/{name}.woff2' for name in ['IBMPlexSans','IBMPlexSansKR-Regular','IBMPlexSansKR-Medium','IBMPlexSansKR-SemiBold','IBMPlexSansKR-Bold']}:
            data=(ROOT / 'agent/onetop/dist' / path[1:]).read_bytes(); mime='font/woff2'
        else:
            self.send_error(404); return
        self.send_response(200); self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(data)


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 18868), Handler).serve_forever()
