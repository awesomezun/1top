"""Windows process and report discovery; never match a session by cwd alone."""
import collections
import json
import os
import re
import time
from pathlib import Path
import psutil
from .controls import target_key
from .discovery import inventory, applications, context, registry_status

UUID = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}$')


def explicit_session(args):
    for i, value in enumerate(args):
        if value in ('--resume', '--session-id', 'resume') and i+1 < len(args) and UUID.fullmatch(args[i+1]):
            return args[i+1]
        if value.startswith('--session-id=') and UUID.fullmatch(value.split('=', 1)[1]):
            return value.split('=', 1)[1]
    return None


def discover(collector):
    rows = inventory()
    collector.app_inventory = rows
    collector.apps = applications(rows)
    collector.terminals = []
    collector.terminal_count = None
    collector.shared_roots = []
    specs = []
    counts = collections.Counter()
    tracked = set()
    for pid, row in rows.items():
        if not row['kind']:
            continue
        parent = row['ppid']; visited = set(); nested = False
        while parent in rows and parent not in visited:
            visited.add(parent)
            if rows[parent]['kind']:
                nested = True; break
            parent = rows[parent]['ppid']
        if nested:
            continue
        try:
            process = psutil.Process(pid)
            args = process.cmdline()
            env = process.environ()
            # Only whitelisted fields leave this scope; command text and secrets do not.
            root = Path(env.get('CODEX_HOME' if row['kind']=='Codex' else 'CLAUDE_CONFIG_DIR',
                                str(Path.home()/('.codex' if row['kind']=='Codex' else '.claude'))))
            provider = env.get('ANTHROPIC_BASE_URL', '')
            model = env.get('ANTHROPIC_MODEL', '')
            del env
            try:
                opened = [f.path for f in process.open_files() if f.path.endswith('.jsonl')]
            except (psutil.Error, OSError):
                opened = []
        except (psutil.Error, OSError):
            continue
        kind = row['kind']
        if kind == 'Claude' and ('api.z.ai' in provider or 'open.bigmodel.cn' in provider or model.lower().startswith('glm')):
            kind = 'GLM'
        counts[kind] += 1
        reg = {}
        if kind in ('Claude', 'GLM'):
            try:
                reg = json.loads((root/'sessions'/f'{pid}.json').read_text(encoding='utf-8'))
            except (OSError, ValueError):
                pass
        sid = reg.get('sessionId') or explicit_session(args)
        paths = []
        if kind in ('Claude', 'GLM') and sid:
            paths = list((root/'projects').glob('*/'+sid+'.jsonl'))[:2]
        if kind == 'Codex':
            sessions_root = os.path.normcase(os.path.abspath(root/'sessions'))+os.sep
            paths = [Path(p) for p in opened if os.path.normcase(os.path.abspath(p)).startswith(sessions_root)]
            if not paths and sid:
                paths = list((root/'sessions').glob('**/*'+sid+'.jsonl'))[:2]
        # Ambiguous logs are not assigned to the process.
        path = paths[0] if len(paths)==1 else None
        cwd = row['cwd'] or reg.get('cwd', '')
        if path and kind == 'Codex':
            try:
                with path.open(encoding='utf-8') as f:
                    meta = json.loads(f.readline()).get('payload', {})
                sid = meta.get('id') or sid
                cwd = meta.get('cwd') or cwd
            except (OSError, ValueError):
                path = None
        started = time.strftime('%a %b %d %H:%M:%S %Y', time.localtime(row['birth']))
        spec = {'id':sid or f'cli-{pid}-{row["birth"]}', 'kind':kind, 'cwd':cwd,
                'title':reg.get('name') or Path(cwd).name or kind, 'pid':pid, 'pids':[pid],
                'path':str(path) if path else None, 'configured_model':model,
                'config_dir':str(root) if kind in ('Claude', 'GLM') else '',
                'status':registry_status(reg), 'status_at':0, 'connected':True,
                'process_only':path is None, 'process_started':started, 'process_birth':row['birth'],
                'location':context(pid, rows), 'input_verified':False, 'terminal_match':'unavailable',
                'terminal_note':'Windows host application is matched by process ancestry; terminal tab identity is unreported.',
                'source':'Windows process and exact session report' if path else 'Windows CLI process',
                'note':'' if path else 'CLI detected. A matching usage report has not been confirmed.'}
        spec['control_key'] = target_key(spec)
        specs.append(spec); tracked.add(pid)
    collector.specs, collector.process_counts = specs, dict(counts)
    collector.discovery_at = time.time()


def focus_process(pid):
    """Raise an existing ancestor window; never start a second host application."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    ancestors = {pid}
    try:
        ancestors.update(p.pid for p in psutil.Process(pid).parents())
    except psutil.Error:
        return False
    found = []
    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value in ancestors and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True
    user32.EnumWindows(callback(visit), 0)
    if not found:
        return False
    user32.ShowWindow(found[0], 9)
    return bool(user32.SetForegroundWindow(found[0]))
