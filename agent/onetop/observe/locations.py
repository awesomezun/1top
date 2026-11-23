"""Where Antigravity and Devin keep their data, wherever that is: the tools' own folders, the accounts OpenBot keeps,
what their running processes were started with or hold open, and the folders seen before. Folder paths only, kept on
this computer; no file is read here."""
import platform
from pathlib import Path

import psutil

from . import antigravity, devin

ERRORS = (psutil.Error, OSError, SystemError, AttributeError, NotImplementedError, ValueError)
# A process can open its data after it starts: it is looked at again this often, in seconds.
CHECK = 30
# Remembered folders of each tool, newest first.
KEEP = 64


def tool(name):
    name = str(name or '').replace('\\', '/').rsplit('/', 1)[-1].lower().removesuffix('.exe')
    if name in ('antigravity', 'agy') or name.startswith('agy_acp_server'):
        return 'antigravity'
    return 'devin' if name == 'devin' else None


def started(args, home):
    """(data folder, whether an app started it) that an Antigravity process names with --gemini-dir and --app-data-dir;
    the folder is None when it names neither."""
    given = {}
    for i, value in enumerate(args):
        for key in ('--gemini-dir', '--app-data-dir'):
            if value == key and i + 1 < len(args):
                given[key] = args[i+1]
            elif value.startswith(key + '='):
                given[key] = value.split('=', 1)[1]
    app = 'acp' in args[1:2]
    if not any(given.values()):
        return None, app
    return Path(given.get('--gemini-dir') or Path(home)/'.gemini')/(given.get('--app-data-dir') or (antigravity.APP_ROOT if app else 'antigravity-cli')), app


def holder(path):
    """The Antigravity data folder a file a process holds open belongs to."""
    path = Path(path)
    if path.name == 'conversation_summaries.db':
        return path.parent
    if path.parent.name == 'presence' and path.suffix == '.lock' or path.parent.name == 'conversations' and path.suffix == '.db':
        return path.parent.parent
    return None


def look(pid):
    """(arguments, open files) of one of the user's own processes. Windows lists open files too slowly to ask."""
    try:
        proc = psutil.Process(pid)
        args = proc.cmdline()
    except ERRORS:
        return [], []
    if platform.system() == 'Windows':
        return args, []
    try:
        return args, [f.path for f in proc.open_files()]
    except ERRORS:
        return args, []


class Locations:
    def __init__(self, home, known=None):
        known = known if isinstance(known, dict) else {}
        self.home = Path(home)
        # {folder: whether an app's runtime (ACP) writes it}
        self.antigravity = {str(k): bool(v) for k, v in (known.get('antigravity') or {}).items()}
        self.devin = [str(p) for p in known.get('devin') or []]
        self.checked = {}

    def update(self, processes, now):
        seen = {}
        for p in processes:
            kind = tool(p.get('name'))
            if not kind or not p.get('pid'):
                continue
            key = (p['pid'], p.get('birth'))
            seen[key] = self.checked.get(key, 0)
            if now - seen[key] < CHECK:
                continue
            seen[key] = now
            args, files = look(p['pid'])
            if kind == 'devin':
                for path in files:
                    if Path(path).name == 'sessions.db':
                        self.add_devin(path)
                continue
            root, app = started(args, self.home)
            for found in {root, *map(holder, files)} - {None}:
                self.add_antigravity(found, app)
        self.checked = seen

    def add_antigravity(self, root, app):
        key = str(root)
        if not Path(key).is_absolute():
            return
        app = self.antigravity.pop(key, False) or app
        self.antigravity = dict(list({key: app, **self.antigravity}.items())[:KEEP])

    def add_devin(self, path):
        if str(path) != str(devin.database(self.home)) and str(path) not in self.devin:
            self.devin = [str(path), *self.devin][:KEEP]

    def antigravity_roots(self):
        """Every data folder that has conversations, each once."""
        found = {}
        for root in [*antigravity.roots(self.home), *map(Path, self.antigravity)]:
            try:
                if root.is_dir():
                    found.setdefault(str(root.resolve()), root)
            except OSError:
                continue
        return list(found.values())

    def app_roots(self):
        """Those that an app's ACP runtime writes."""
        return [r for r in self.antigravity_roots() if r.name == antigravity.APP_ROOT or self.antigravity.get(str(r))]

    def devin_databases(self):
        paths = [devin.database(self.home), *map(Path, self.devin)]
        return [p for i, p in enumerate(paths) if p not in paths[:i]]

    def known(self):
        return {'antigravity': self.antigravity, 'devin': self.devin}
