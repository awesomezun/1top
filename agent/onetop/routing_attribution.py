"""Join native usage reports to the account that actually served a request."""
import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing


def session_id(payload,headers):
    value=headers.get('session_id') or headers.get('conversation_id') or payload.get('prompt_cache_key')
    if not value:
        user=(payload.get('metadata') or {}).get('user_id')
        if isinstance(user,str):
            try:parsed=json.loads(user)
            except ValueError:parsed=None
            if isinstance(parsed,dict):value=parsed.get('session_id')
            elif '_session_' in user:value=user.rsplit('_session_',1)[1]
    return value if isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9:_-]{1,200}',value) else None


def load(directory,now):
    path=directory/'gateway.sqlite'
    if not path.is_file():return {}
    result=defaultdict(list)
    try:
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=.1)) as db:
            for sid,account,kind,start,end in db.execute('SELECT sid,account,kind,start,end FROM bindings WHERE start>? ORDER BY start DESC LIMIT 20000',(now-8*86400,)):
                result[sid].append((account,kind,start,end))
    except sqlite3.Error:return {}
    return dict(result)


def account_at(intervals,t):
    # The native CLI appends its usage event just after receiving the final byte.
    # Allow two seconds for delivery; overlapping different accounts stay unknown.
    matches={a for a,_,start,end in intervals if start<=t<=(end+2 if end is not None else start+1800)}
    return next(iter(matches)) if len(matches)==1 else None


def attach(spec,bindings,db,cache=None):
    intervals=bindings.get(spec.get('active_session_id') or spec['id'])
    if not intervals:return
    spec['_routing_intervals']=intervals
    spec['_routing_original_binding']=spec.get('account_binding')
    latest=max(intervals,key=lambda row:row[2])
    spec['account_binding']=(latest[0],latest[2]);spec['account_binding_source']='gateway_session'
    spec['kind']=latest[1]
    fingerprint=tuple(intervals)
    if cache is not None:
        if cache.get(spec['id'])==fingerprint:return
        if len(cache)>4096:cache.clear()
        cache[spec['id']]=fingerprint
    # A collector tick can observe the CLI report just before reading the new
    # routing binding. Correct that race from the durable request intervals.
    start=min(row[2] for row in intervals)
    for rowid,t,account in db.execute('SELECT rowid,t,account FROM events WHERE sid=? AND t>=?',(spec['id'],start)).fetchall():
        routed=account_at(intervals,t)
        if account!=routed:db.execute('UPDATE events SET account=? WHERE rowid=?',(routed,rowid))
