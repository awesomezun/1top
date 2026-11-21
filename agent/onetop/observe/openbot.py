"""OpenBot agents: the name OpenBot gives each agent workspace, read-only from its own database."""
import json
import os
import platform
import sqlite3
from contextlib import closing
from pathlib import Path


def database(home):
    system = platform.system()
    if system == 'Darwin':
        return Path(home)/'Library'/'Application Support'/'OpenBot'/'openbot.db'
    if system == 'Windows':
        return Path(os.environ.get('APPDATA') or Path(home)/'AppData'/'Roaming')/'OpenBot'/'openbot.db'
    return Path(home)/'.config'/'OpenBot'/'openbot.db'


def read(home, processes):
    """Only while an OpenBot process runs; names only, never messages or settings."""
    if not any('OpenBot' in str((p.get('app') or ('', ''))[0]) or '/OpenBot.app/' in str(p.get('exe') or '')
               for p in processes):
        return []
    path = database(home)
    try:
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)) as db:
            rows = db.execute('SELECT agent_json FROM projection_agents').fetchall()
    except (OSError, ValueError, sqlite3.Error):
        return []
    agents = []
    for (raw,) in rows:
        try:
            agent = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(agent, dict) and agent.get('workspacePath') and str(agent.get('name') or '').strip():
            agents.append({'workspace': str(agent['workspacePath']), 'name': str(agent['name']).strip()[:120]})
    return agents
