"""User-chosen display names, separate from provider credentials and identity."""
import json
import os
import threading
from pathlib import Path

_LOCK = threading.RLock()

def read(data):
    try:
        with (Path(data)/'account-aliases-v1.json').open('rb') as stream:raw=stream.read(32769)
        values=json.loads(raw) if len(raw)<=32768 else {}
        return {k:v for k,v in values.items() if isinstance(k,str) and isinstance(v,str) and len(v)<=24} if isinstance(values,dict) else {}
    except (OSError,ValueError):return {}

def apply(rows, data):
    aliases=read(data)
    for row in rows:row['alias']=aliases.get(row.get('id'),row.get('pool','')[:24])
    return rows

def set_alias(data, account_id, alias, account_ids):
    if not isinstance(account_id,str) or account_id not in account_ids:raise ValueError('Unknown account.')
    if not isinstance(alias,str) or len(alias.strip())>24 or any(ord(c)<32 or 127<=ord(c)<160 for c in alias):
        raise ValueError('Use an account name of up to 24 characters, without control characters.')
    alias=alias.strip();path=Path(data)/'account-aliases-v1.json'
    with _LOCK:
        values=read(data)
        if alias:values[account_id]=alias
        else:values.pop(account_id,None)
        path.parent.mkdir(parents=True,exist_ok=True)
        temp=path.with_suffix('.tmp')
        with os.fdopen(os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as stream:json.dump(values,stream,ensure_ascii=False)
        temp.replace(path)
    return alias
