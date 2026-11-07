"""Customizing gate G2 on Android (docs/design/customizing/customizing-spec_v1.2.2.md): the web gate's seeds
(tests/customize-browser.py: its three extremes and seeded combinations) drawn by the phone at 360, 393 and 412 dp, both
presets. Every object stays inside its housing and the screen, no two objects or rings overlap, the objects come in the
layout's order. The app reports what it drew through the demo-only link onetop://?qaLayout=…&qaCustomize=on&qaReport=1
('[qa-layout]' in the log).
Run against a booted emulator with the app open in the demo (a release build: mobile/android, ./gradlew assembleRelease):
  python3 tests/customize-android.py [clusters] [dashboards] [screenshot folder]
Motion is turned off while it runs (the wiggle tilts what is measured) and back on after; the screen size is reset."""
import json, os, random, subprocess, sys, time, urllib.parse
A = ['adb', '-s', os.environ.get('ANDROID_SERIAL', 'emulator-5554')]
OUT = (sys.argv[3] if len(sys.argv) > 3 else 'output/customizing-port_android/g2').rstrip('/') + '/'
os.makedirs(OUT, exist_ok=True)
def sh(*a, **k): return subprocess.run(A + list(a), capture_output=True, text=True, **k).stdout
ORDER = ['periods', 'dials', 'alerts', 'odo', 'temps', 'fuel', 'window']
SHAPES = {'periods': ['auto', 'tabs', 'drum', 'tuner', 'roller', 'knob', 'lever'], 'dials': ['ring', 'glow', 'plate'],
          'alerts': ['label', 'chips', 'strip', 'count', 'badge', 'lens'], 'odo': ['drum', 'led', 'led0', 'print', 'print0']}
MODES = ['sessions', 'flow', 'weekly', 'map', 'heat', 'goals', 'system']
EXTREMES = [
    {'order': ORDER, 'hidden': [], 'opts': {'dials': {'size': 0}, 'alerts': {'count': 3, 'shape': 'lens'}, 'odo': {'shape': 'led0'}, 'fuel': {'count': 8}, 'window': {'size': 0}}},
    {'order': ORDER, 'hidden': [], 'opts': {'dials': {'size': 2, 'shape': 'plate'}, 'alerts': {'count': 6, 'shape': 'chips'}, 'odo': {'shape': 'print0'}, 'fuel': {'count': 3}, 'window': {'size': 2}}},
    {'order': ['periods', 'window', 'fuel', 'odo', 'alerts', 'dials', 'temps'], 'hidden': ['alerts', 'odo'], 'opts': {}}]
rng = random.Random(46)
def cluster():
    opts = {k: {'shape': rng.choice(v)} for k, v in SHAPES.items()}
    opts['dials'].update(size=rng.randint(0, 2), needle=rng.choice(['default', 'red', 'amber'])); opts['alerts']['count'] = rng.randint(3, 6)
    opts['fuel'] = {'count': rng.choice([None, 3, 4, 5, 6, 7, 8])}; opts['window'] = {'size': rng.randint(0, 2), 'tabs': rng.sample(MODES, rng.randint(1, 7))}
    mov = ORDER[1:]; rng.shuffle(mov)
    return {'order': ['periods'] + mov, 'hidden': rng.sample(['alerts', 'odo', 'fuel', 'window', 'temps'], rng.randint(0, 2)), 'opts': opts}
def dashboard():
    rest = ['tokens', 'weekly', 'resources', 'sessions']; rng.shuffle(rest)
    return {'order': ['periods'] + rest, 'hidden': rng.sample(['tokens', 'weekly', 'resources'], rng.randint(0, 2)),
            'opts': {'tokens': {'size': rng.randint(0, 2)}, 'weekly': {'count': rng.choice([2, 4, 6, None])}, 'sessions': {'count': rng.choice([3, 5, 10, None])}}}
CLUSTERS = EXTREMES + [cluster() for _ in range(int(sys.argv[1]) if len(sys.argv) > 1 else 5)]
DASHBOARDS = [dashboard() for _ in range(int(sys.argv[2]) if len(sys.argv) > 2 else 4)]
SIZES = [(360, '945x2000'), (393, '1032x2235'), (412, '1082x2400')]

def report(path, layout, timeout=40):
    sh('logcat', '-c')
    q = urllib.parse.quote(json.dumps(layout, separators=(',', ':')))
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', f"'onetop://{path}?qaLayout={q}&qaCustomize=on&qaReport=1'", 'si.onetop.mobile')
    end = time.time() + timeout
    while time.time() < end:
        time.sleep(1.5)
        for line in sh('logcat', '-d', '-s', 'ReactNativeJS:V').splitlines():
            if '[qa-layout] ' in line:
                return json.loads(line.split('[qa-layout] ', 1)[1].rstrip("'"))
    return None

def overlap(a, b, pad=0.5):
    return a['x'] + pad < b['x'] + b['w'] and b['x'] + pad < a['x'] + a['w'] and a['y'] + pad < b['y'] + b['h'] and b['y'] + pad < a['y'] + a['h']

def check(r, want, label):
    bad = []
    c, W = r['canvas'], r['width']
    parts = r['parts']
    for k, b in parts.items():
        if b['x'] < c['x'] - .5 or b['x'] + b['w'] > c['x'] + c['w'] + .5 or b['y'] < c['y'] - .5 or b['y'] + b['h'] > c['y'] + c['h'] + .5: bad.append(f'{k} outside its housing {b} {c}')
        if b['x'] < -.5 or b['x'] + b['w'] > W + .5: bad.append(f'{k} outside the screen')
    ks = list(parts)
    for i in range(len(ks)):
        for j in range(i + 1, len(ks)):
            if overlap(parts[ks[i]], parts[ks[j]]): bad.append(f'{ks[i]} overlaps {ks[j]}')
    rings = []
    for k, m in r['marks'].items():
        for name in ('ring', 'minus', 'grip'):
            b = m.get(name)
            if b and (b['x'] < -.5 or b['x'] + b['w'] > W + .5): bad.append(f'{k} {name} off the screen')
        rings.append((k, m['ring']))
    for i in range(len(rings)):
        for j in range(i + 1, len(rings)):
            if overlap(rings[i][1], rings[j][1]): bad.append(f'rings of {rings[i][0]} and {rings[j][0]} overlap')
    order = sorted(parts, key=lambda k: parts[k]['y'])
    if order != want: bad.append(f'order {order} != {want}')
    return bad

def cluster_order(g):
    out = ['dials']
    for i in g['order']:
        if i in ('dials', 'periods', 'temps'): continue
        if i == 'window': out.append('periods')
        if i not in g['hidden']: out.append(i)
    return out

results, failures = [], []
SCALES = ['animator_duration_scale', 'transition_animation_scale', 'window_animation_scale']
for k in SCALES: sh('shell', 'settings', 'put', 'global', k, '0')
time.sleep(2)
for dp, size in SIZES:
    sh('shell', 'wm', 'size', size); time.sleep(3)
    for i, g in enumerate(CLUSTERS):
        r = report('cluster', {'v': 1, 'preset': 'cluster', 'presets': {'cluster': g}})
        label = f'cluster {dp}dp #{i}'
        if not r: failures.append({label: 'no report'}); continue
        g2 = r['group']; bad = check(r, cluster_order(g2), label)
        results.append(label); failures += [{label: bad}] if bad else []
        if i < 3: sh('emu', 'screenrecord', 'screenshot', OUT + f'cluster-{dp}-{i}.png')
    for i, g in enumerate(DASHBOARDS):
        r = report('', {'v': 1, 'preset': 'dashboard', 'presets': {'dashboard': g}})
        label = f'dashboard {dp}dp #{i}'
        if not r: failures.append({label: 'no report'}); continue
        g2 = r['group']; bad = check(r, [x for x in g2['order'] if x not in g2['hidden']], label)
        results.append(label); failures += [{label: bad}] if bad else []
        if i < 2: sh('emu', 'screenrecord', 'screenshot', OUT + f'dashboard-{dp}-{i}.png')
    sh('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', "'onetop://?qaCustomize=off'", 'si.onetop.mobile'); time.sleep(2)
sh('shell', 'wm', 'size', 'reset')
for k in SCALES: sh('shell', 'settings', 'put', 'global', k, '1')
print(json.dumps({'checked': len(results), 'failures': failures}, ensure_ascii=False, indent=1))
if failures: raise SystemExit(1)
