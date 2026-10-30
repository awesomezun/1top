"""Sessions without a conversation title, as a relay sends them, on the dashboard: the table's second
line, the detail heading, the detail's last-hour chart over a long period and the names in row labels.

Run with system Python (Playwright installed). The state is the desktop demo collector's
(scripts/demo-state.mjs) with every title emptied but two; nothing reaches a real session.
"""
import json
from pathlib import Path
import subprocess
import threading
from urllib.parse import parse_qs, urlsplit
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'agent/onetop/dist'
NOW, WEEK = 1800000000, 'custom:604800'
# Titles someone gave: a Codex thread name, and the Aside session whose row label also names its default workspace.
KEPT = {'s2', 's5'}
states = {}


def state(period):
    # A relay sends no title taken from prompts.
    if period not in states:
        script = f"import {{demoState}} from {json.dumps(str(ROOT / 'scripts/demo-state.mjs'))};process.stdout.write(JSON.stringify(demoState({NOW},{{period:{json.dumps(period)}}})))"
        result = json.loads(subprocess.run(['node', '--input-type=module', '-e', script], capture_output=True, text=True, check=True).stdout)
        for key in ('sessions', 'root_sessions'):
            for s in result.get(key, []):
                if s['id'] not in KEPT: s['title'] = ''
        states[period] = json.dumps(result).encode()
    return states[period]


class Preview(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        route = self.path.split('?', 1)[0]
        if route == '/api/state':
            body, mime = state(parse_qs(urlsplit(self.path).query).get('period', ['1h'])[0]), 'application/json'
        else:
            path = (DIST / ('index.html' if route == '/' else route.lstrip('/'))).resolve()
            if route.startswith('/api/') or not path.is_relative_to(DIST) or not path.is_file(): self.send_error(404); return
            body = path.read_bytes()
            mime = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json'}.get(path.suffix, 'application/octet-stream')
        self.send_response(200); self.send_header('Content-Type', mime); self.end_headers(); self.wfile.write(body)
    def do_POST(self): self.send_error(404)


ROWS = "()=>[...document.querySelectorAll('#sessionsBody tr[data-session]')].map(tr=>({id:tr.dataset.session,task:tr.querySelector('.cell-task')?.textContent.trim()||'',label:tr.getAttribute('aria-label')}))"
# Every token flow the page draws, with the range it was given and the bins it got.
SPY = "()=>{window.flows=[];const draw=window.tokenFlowData;window.tokenFlowData=(events,minutes,updated,range)=>{const out=draw(events,minutes,updated,range);flows.push({minutes,range:range??null,span:out.end-out.start,step:out.step});return out;};}"
CHILDREN = {'ko': '하위 2개 포함', 'en': 'Includes 2 subsessions', 'zh': '包含 2 个子会话'}

server = ThreadingHTTPServer(('127.0.0.1', 0), Preview)
threading.Thread(target=server.serve_forever, daemon=True).start()
checks, errors = [], []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for lang in ('ko', 'en', 'zh'):
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            page.on('pageerror', lambda e: errors.append(str(e)))
            prefs = json.dumps({'lang': lang, 'theme': 'dark', 'period': WEEK, 'rangeScale': 'fixed-v1'})
            page.add_init_script(f"localStorage.setItem('onetop.dashboard.v1',{json.dumps(prefs)})")
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.locator('#sessionsBody tr[data-session]').first.wait_for()
            page.wait_for_timeout(600)
            rows = {r['id']: r for r in page.evaluate(ROWS)}
            # The second line names each part once and starts and ends with a name.
            for r in rows.values():
                parts = r['task'].split(' · ')
                assert all(parts) and len(parts) == len(set(parts)), r
            assert rows['s1']['task'] == 'checkout-web', rows['s1']
            assert rows['s2']['task'] == 'Billing API · billing-service', rows['s2']
            # A name the dashboard gives (the Aside default workspace) reads in the page's language in labels too.
            if lang != 'ko':
                left = [r['label'] for r in rows.values() if any('가' <= c <= '힣' for c in r['label'])]
                assert not left, left
            page.evaluate(SPY)
            assert page.evaluate('data.chart_range&&data.chart_range.end-data.chart_range.start') == 604800
            page.locator('#sessionsBody tr[data-session="s1"] td:nth-child(3)').click()
            page.wait_for_timeout(800)
            heading = page.locator('.detail-project').inner_text().split('\n')
            assert heading[0].strip() == CHILDREN[lang], heading
            # The detail draws the last hour by the minute, whatever the period; the period charts keep its range.
            flows = page.evaluate('flows')
            detail = [f for f in flows if f['minutes'] == 60]
            assert detail and all(f['range'] is None and f['span'] == 3600 and f['step'] == 60 for f in detail), flows
            assert any(f['range'] and f['span'] == 604800 for f in flows if f['minutes'] != 60), flows
            page.locator('#closeDetail').click()
            page.locator('#sessionsBody tr[data-session="s3"] td:nth-child(3)').click()
            page.wait_for_timeout(500)
            # No title and no subagents: only the place is left under the terminal.
            assert page.locator('.detail-project').evaluate('e=>e.firstElementChild.className') == 'detail-path'
            checks.append(lang)
            page.close()
        browser.close()
finally:
    server.shutdown()
assert not errors, errors
print('Untitled sessions: second line once, detail heading without a leading separator, last-hour detail chart over a week, translated row labels:', ', '.join(checks))
