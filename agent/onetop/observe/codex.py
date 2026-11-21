"""Open log holders plus read-only thread metadata, scoped to each CODEX_HOME."""
import json
import re
import sqlite3
import subprocess
from contextlib import closing
from pathlib import Path
import psutil
from ..hierarchy import codex_metadata
from .processes import ERRORS


def read(processes, transcripts, run, platform):
    candidates = [p for p in processes if p.get('kind') == 'Codex']
    opened = {}
    if platform == 'Windows':
        for proc in candidates:
            try:
                for f in psutil.Process(proc['pid']).open_files():
                    if f.path.endswith('.jsonl'):
                        opened.setdefault(f.path, set()).add(proc['pid'])
            except ERRORS:
                continue
    elif candidates:
        try:
            raw = run(['lsof', '-p', ','.join(str(p['pid']) for p in candidates), '-Fn'], timeout=10)
            pid = None
            for line in raw.splitlines():
                if line.startswith('p') and line[1:].isdigit():
                    try: pid = int(line[1:])
                    except ValueError: pid = None
                elif line.startswith('n') and line.endswith('.jsonl') and pid is not None:
                    opened.setdefault(line[1:], set()).add(pid)
        except (OSError, subprocess.SubprocessError):
            pass
    roots = {p.get('config_dir') or str(Path.home()/'.codex') for p in candidates}
    # A shared app-server can retain files from a profile it used before an
    # account switch. The open rollout is evidence of its own profile; the
    # backend's current CODEX_HOME is not the owner of all of its conversations.
    for path in opened:
        match = re.fullmatch(r'(.+)/sessions/\d{4}/\d{2}/\d{2}/rollout-[^/]+\.jsonl', path.replace('\\','/'))
        if match:
            roots.add(match[1])
    records, paths = {}, {}
    for root in roots:
        folder = Path(root).expanduser()
        for path, holders in opened.items():
            if Path(path).is_relative_to(folder/'sessions'):
                paths[path] = (root, holders)
        try:
            dbpath = max(folder.glob('state_*.sqlite'), key=lambda p:p.stat().st_mtime)
            with closing(sqlite3.connect(dbpath.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
                columns = {r[1] for r in db.execute('PRAGMA table_info(threads)')}
                name = 'name' if 'name' in columns else 'NULL'
                for row in db.execute(f'SELECT id,rollout_path,cwd,title,model,{name} FROM threads WHERE archived=0'):
                    if row[1] in paths:
                        records[row[1]] = dict(zip(('session_id','path','cwd','title','model','name'),row))
        except (OSError, ValueError, sqlite3.Error):
            pass
        # Windows/native clients can identify their report with an explicit resume id.
        for process in candidates:
            sid = process.get('explicit_session')
            if sid and process.get('config_dir') == root and not any(process['pid'] in h for _, h in paths.values()):
                matches = list((folder/'sessions').glob('**/*' + sid + '.jsonl'))[:2]
                if len(matches) == 1:
                    paths[str(matches[0])] = (root, {process['pid']})
    result = []
    for path, (root, holders) in paths.items():
        row = records.get(path)
        if row is None:
            try:
                with open(path, 'rb') as stream:
                    header = json.loads(stream.readline(2 * 1024 * 1024)).get('payload', {})
                row = {'session_id': header.get('id', Path(path).stem), 'cwd': header.get('cwd', ''),
                       'title': '', 'name': None, 'model': None}
            except (OSError, ValueError, AttributeError):
                continue
        row = {**row, 'id':row['session_id'], 'path':path, 'profile':root, 'holders':sorted(holders),
               **(transcripts.read(path) or {}), **codex_metadata(path, row['session_id'])}
        if (row.get('title') or '').startswith(('# AGENTS', '<', 'You are')):
            row['title'] = ''
        result.append(row)
    return result
