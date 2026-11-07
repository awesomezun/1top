"""Customizing gates G2 and G3 (docs/design/customizing/customizing-spec_v1.1.0.md) against a read-only live snapshot.

G2: seeded combinations of order, size, count, shape and hidden objects, drawn at 360, 390, 440, 1280 and 1440px, keep
every text and block inside the cluster's housing, without overlapping text or a sideways page. G3: the edit mode by
keyboard, its marks, reset to the defaults, the layout surviving a reload, and no jiggle with reduced motion.
Run with system Python (Playwright installed). Never forwards control POSTs to real sessions.
"""
import json
import random
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'agent/onetop/dist'
HOUSING = (ROOT / 'tests/cluster-housing.js').read_text()
with urllib.request.urlopen('http://127.0.0.1:18766/api/state') as response:
    snapshot = json.load(response)
snapshot['action_token'] = 'customize-test-only'


class Preview(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_GET(self):
        try: self.serve()
        except (BrokenPipeError, ConnectionResetError): pass
    def serve(self):
        route = self.path.split('?', 1)[0]
        if route == '/api/state':
            snapshot['updated'] = time.time()
            body, mime = json.dumps(snapshot).encode(), 'application/json'
        elif route.startswith('/api/'): body, mime = b'{}', 'application/json'
        else:
            path = (DIST / ('index.html' if route == '/' else route.lstrip('/'))).resolve()
            if not path.is_relative_to(DIST) or not path.is_file(): self.send_error(404); return
            body = path.read_bytes()
            mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.json':'application/json'}.get(path.suffix,'application/octet-stream')
        self.send_response(200); self.send_header('Content-Type', mime); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        self.send_response(403); self.end_headers()


# The listen backlog is set when the server binds, so it is a class attribute: the default 5 resets a page's parallel
# requests on a busy machine, which looked like files dropping at random.
class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


server = Server(('127.0.0.1', 0), Preview)
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{server.server_port}'

ORDER = ['periods', 'dials', 'alerts', 'odo', 'temps', 'fuel', 'window']
SHAPES = {'periods': ['auto', 'tabs', 'drum', 'tuner', 'roller', 'knob', 'lever'], 'dials': ['ring', 'glow', 'plate'],
          'alerts': ['label', 'chips', 'strip', 'count', 'badge', 'lens'], 'odo': ['drum', 'led', 'led0', 'print', 'print0']}


def cluster_group(rng):
    order = ORDER[:]
    movable = [x for x in order if x not in ('periods',)]
    rng.shuffle(movable)
    order = ['periods'] + movable
    hidden = rng.sample(['alerts', 'odo', 'fuel', 'window', 'temps'], rng.randint(0, 2))
    opts = {k: {'shape': rng.choice(v)} for k, v in SHAPES.items()}
    opts['dials'].update(size=rng.randint(0, 2), needle=rng.choice(['default', 'red', 'amber']))
    opts['alerts']['count'] = rng.randint(3, 6)
    opts['fuel'] = {'count': rng.choice([None, 3, 4, 5, 6, 7, 8])}
    opts['window'] = {'size': rng.randint(0, 2), 'tabs': rng.sample(['sessions', 'flow', 'weekly', 'map', 'heat', 'goals', 'system'], rng.randint(1, 7))}
    return {'order': order, 'hidden': hidden, 'opts': opts}


def dashboard_group(rng):
    order = ['periods', 'tokens', 'weekly', 'resources', 'sessions']
    rest = order[1:]; rng.shuffle(rest)
    return {'order': ['periods'] + rest, 'hidden': rng.sample(['tokens', 'weekly', 'resources'], rng.randint(0, 2)),
            'opts': {'tokens': {'size': rng.randint(0, 2)}, 'weekly': {'count': rng.choice([2, 4, 6, None])}, 'sessions': {'count': rng.choice([3, 5, 10, None])}}}


EXTREMES = [
    {'order': ORDER, 'hidden': [], 'opts': {'dials': {'size': 0}, 'alerts': {'count': 3, 'shape': 'lens'}, 'odo': {'shape': 'led0'}, 'fuel': {'count': 8}, 'window': {'size': 0}}},
    {'order': ORDER, 'hidden': [], 'opts': {'dials': {'size': 2, 'shape': 'plate'}, 'alerts': {'count': 6, 'shape': 'chips'}, 'odo': {'shape': 'print0'}, 'fuel': {'count': 3}, 'window': {'size': 2}}},
    {'order': ['periods', 'window', 'fuel', 'odo', 'alerts', 'dials', 'temps'], 'hidden': ['alerts', 'odo'], 'opts': {}},
]
checks = []
failures = []


def load(page, url, ready):
    # The local preview server sometimes drops a file under load; one reload tells that apart from a real failure.
    for attempt in range(2):
        seen = len(errors)
        page.goto(url, wait_until='networkidle')
        try:
            ready(); page.wait_for_timeout(500)
            # A file dropped on the first try can leave the page drawn but an error behind; a real one comes back.
            if attempt or len(errors) == seen: return
        except Exception:
            if attempt: raise
        del errors[seen:]


def fit(page, label):
    page.wait_for_timeout(250)
    result = page.evaluate(HOUSING)
    if result.get('missing') or result['out'] or result['overlap'] or result['page'] > 0:
        failures.append({label: result})


with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    rng = random.Random(46)
    clusters = EXTREMES + [cluster_group(rng) for _ in range(9)]
    # G2: the dashboard's cluster, upright on a phone and wide.
    for width, height in [(360, 780), (390, 844), (1280, 860), (1440, 900)]:
        for i, group in enumerate(clusters):
            layout = {'v': 1, 'wide': {'cluster': group}}
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.on('pageerror', lambda e, page=page: errors.append(page.url.rsplit('/',1)[-1]+': '+str(e)))
            page.add_init_script(f"localStorage.setItem('onetop.layout.v1',{json.dumps(json.dumps(layout))})")
            try:
                load(page, URL + '/', lambda: (page.locator('#views [data-view="cluster"]').click(), page.wait_for_selector('#clusterView .cluster .cl-dial', timeout=15000)))
                page.wait_for_timeout(1600)
                fit(page, f'dashboard cluster {width}px #{i}')
            except Exception as error: failures.append({f'dashboard cluster {width}px #{i}': {'error': str(error).splitlines()[0]}})
            page.close()
    checks.append(f'dashboard cluster: {len(clusters)} layouts at 360, 390, 1280 and 1440px inside the housing')
    # G2: the tray, both presets.
    dashboards = [dashboard_group(rng) for _ in range(6)]
    for width in (360, 440):
        for i, group in enumerate(clusters):
            layout = {'v': 1, 'preset': 'cluster', 'presets': {'cluster': group}}
            page = browser.new_page(viewport={'width': width, 'height': 900})
            page.on('pageerror', lambda e, page=page: errors.append(page.url.rsplit('/',1)[-1]+': '+str(e)))
            page.add_init_script(f"localStorage.setItem('onetop.layout.v1',{json.dumps(json.dumps(layout))})")
            try:
                load(page, URL + '/quick.html', lambda: page.wait_for_selector('#qCluster .cluster .cl-dial', timeout=15000))
                page.wait_for_timeout(1600)
                fit(page, f'tray cluster {width}px #{i}')
            except Exception as error: failures.append({f'tray cluster {width}px #{i}': {'error': str(error).splitlines()[0]}})
            page.close()
        for i, group in enumerate(dashboards):
            layout = {'v': 1, 'preset': 'dashboard', 'presets': {'dashboard': group}}
            page = browser.new_page(viewport={'width': width, 'height': 900})
            page.on('pageerror', lambda e, page=page: errors.append(page.url.rsplit('/',1)[-1]+': '+str(e)))
            page.add_init_script(f"localStorage.setItem('onetop.layout.v1',{json.dumps(json.dumps(layout))})")
            # The sections take their order on the first drawing with data.
            load(page, URL + '/quick.html', lambda: page.wait_for_function("document.getElementById('qPeriods').style.order!==''", timeout=15000))
            page.wait_for_timeout(300)
            order = page.evaluate("""()=>[['periods','#qPeriods'],['tokens','.q-tokens'],['weekly','#qWeekly'],['resources','#qResources'],['sessions','.q-sessions']]
              .map(([id,sel])=>[id,document.querySelector(sel)]).filter(([,el])=>el&&getComputedStyle(el).display!=='none').sort((a,b)=>a[1].getBoundingClientRect().top-b[1].getBoundingClientRect().top).map(([id])=>id)""")
            want = [x for x in group['order'] if x not in group['hidden']]
            if order != want or page.evaluate('document.documentElement.scrollWidth-innerWidth') > 0:
                failures.append({f'tray dashboard {width}px #{i}': {'order': order, 'want': want}})
            page.close()
    checks.append(f'tray: {len(clusters)} cluster and {len(dashboards)} dashboard layouts at 360 and 440px, in order and inside')
    # G3: the edit mode by keyboard on the tray's cluster; the layout survives a reload; reset; reduced motion.
    page = browser.new_page(viewport={'width': 440, 'height': 900}, reduced_motion='reduce')
    page.on('pageerror', lambda e, page=page: errors.append(page.url.rsplit('/',1)[-1]+': '+str(e)))
    page.add_init_script("if(!sessionStorage.getItem('seeded')){localStorage.clear();localStorage.setItem('onetop.quick.v1',JSON.stringify({cluster:true}));sessionStorage.setItem('seeded','1');}")
    page.goto(URL + '/quick.html', wait_until='networkidle')
    page.wait_for_selector('#qCluster .cluster .cl-dial')
    page.locator('[data-act="customize"]').click()
    page.wait_for_selector('.cz-top')
    assert page.locator('.cz-minus').count() >= 3 and page.locator('.cz-grip').count() >= 3
    assert page.locator('[data-cz-part="dials"]').first.evaluate('e=>getComputedStyle(e).animationName') == 'none', 'no jiggle with reduced motion'
    page.locator('[data-cz-part="fuel"]').focus()
    page.keyboard.press('ArrowUp'); page.keyboard.press('ArrowUp')
    page.keyboard.press('-')
    page.wait_for_timeout(200)
    group = page.evaluate("JSON.parse(localStorage.getItem('onetop.layout.v1')).presets.cluster")
    assert group['order'].index('fuel') < group['order'].index('alerts'), group['order']
    assert isinstance(group['opts']['fuel']['count'], int), group['opts']['fuel']
    page.locator('[data-cz-part="alerts"]').focus(); page.keyboard.press('Enter')
    page.wait_for_selector('.cz-sheet.cz-obj.up [data-cz-shape]')
    assert page.locator('.cz-sheet.cz-obj [data-cz-step]').count() == 2, 'the picked object sheet counts'
    page.locator('.cz-sheet.cz-obj [data-cz-shape]').click()
    page.wait_for_selector('.cz-sheet.cz-gallery.up .cz-card')
    assert page.locator('.cz-card').count() == 6
    page.locator('.cz-card[data-v="badge"]').click()
    page.keyboard.press('Escape'); page.wait_for_timeout(350)
    page.keyboard.press('Escape'); page.wait_for_timeout(350)
    if page.locator('.cz-top').count(): page.keyboard.press('Escape'); page.wait_for_timeout(200)
    assert page.locator('.cz-top').count() == 0
    page.reload(wait_until='networkidle'); page.wait_for_selector('#qCluster .cluster .cl-dial')
    assert page.locator('#qCluster .cluster').get_attribute('data-lamps') == 'badge'
    assert page.evaluate("JSON.parse(localStorage.getItem('onetop.layout.v1')).presets.cluster.order.indexOf('fuel')") < page.evaluate("JSON.parse(localStorage.getItem('onetop.layout.v1')).presets.cluster.order.indexOf('alerts')")
    page.locator('[data-act="customize"]').click(); page.locator('.cz-top [data-cz="list"]').click()
    page.wait_for_selector('.cz-sheet.up [data-cz-reset]')
    page.locator('[data-cz-reset]').click(); page.wait_for_timeout(300)
    defaults = page.evaluate("OneTopLayout.defaults().presets.cluster")
    assert page.evaluate("JSON.parse(localStorage.getItem('onetop.layout.v1')).presets.cluster") == defaults
    page.close()
    checks.append('keyboard moves, counts and opens shapes; marks for every object; reload keeps it; reset restores the defaults; no jiggle with reduced motion')
    browser.close()
server.shutdown()
assert not errors, errors[:5]
if failures: print(json.dumps([{k:{x:y for x,y in v.items() if y not in (None,[],0)}} for f in failures for k,v in f.items()], ensure_ascii=False)); raise SystemExit(1)
print(json.dumps({'checks': checks}, ensure_ascii=False))
