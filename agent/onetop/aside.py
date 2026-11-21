"""Read-only Aside session adapter. Prompt bodies never leave their transcript files."""
import hashlib
import json
import re
import sqlite3
import time
from pathlib import Path
import psutil
from .effort import level
from .hierarchy import annotate
from .accounts import identity, read_json

ACTIVE={'running','working','streaming','executing'}
PROVIDERS={'openai-codex':'Codex','claude-code':'Claude','zai':'GLM','google':'Antigravity'}

def billing_accounts(directory):
    """Read identity metadata only. Never return or refresh provider credentials."""
    credentials=read_json(directory/'credentials.json')
    codex=credentials.get('openai-codex')
    account=codex.get('accountId') if isinstance(codex,dict) else None
    return {'openai-codex':identity('Codex',account)} if isinstance(account,str) and account.strip() else {}

def cli_path(home=None):
    return (home or Path.home())/'.aside/cli/Aside CLI.app/Contents/MacOS/aside'

def discover(home=None,now=None,running=None):
    from .observe.aside import read
    from .sessions.aside import build
    from .sessions import status, naming, public
    from .observe.processes import ERRORS
    home=home or Path.home();now=now or time.time()
    if running is None:
        running=False
        for p in psutil.process_iter():
            try:
                if p.name()=='aside-daemon':running=True;break
            except ERRORS:continue
    rows=build(read(home,now,running))
    status.apply(rows,{'captured_at':now})
    return [public(r) for r in naming.apply(annotate(rows))]


def resolve(sid,key):
    return next((s for s in discover() if s['id']==sid and s.get('control_key')==key),None)
