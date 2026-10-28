"""Provider-reported weekly percentages and explicitly estimated session shares."""
import collections
import math
from pathlib import Path
from .usage import WINDOWS

RETENTION = 8 * 86400
FRESH = 300


def valid_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def account_for(spec, roots):
    """Current profile is an attribution hint, not proof of a session's billing identity."""
    value = spec.get('config_dir') or spec.get('path')
    if not value:return None
    path = Path(value).expanduser().resolve(strict=False)
    matches = [(len(root.parts), (account, since)) for root, (account, kind, since) in roots.items()
               if kind == spec.get('kind') and (path == root or root in path.parents)]
    return max(matches)[1] if matches else None


def event_account(spec, timestamp):
    binding=spec.get('account_binding')
    return binding[0] if binding and timestamp>=binding[1] else None


def initialize(db):
    columns={r[1] for r in db.execute('PRAGMA table_info(events)')}
    if columns and 'account' not in columns:db.execute('ALTER TABLE events ADD COLUMN account TEXT')
    db.execute('''CREATE TABLE IF NOT EXISTS weekly_samples (
        account TEXT, kind TEXT, t REAL, pct REAL, reset REAL,
        PRIMARY KEY(account,t))''')


def record(db, quotas, now):
    for q in quotas:
        t=q.get('updated')
        if q.get('stale',True) or not valid_number(t) or not 0<=now-t<=FRESH:continue
        w=next((w for w in q.get('windows',[]) if w.get('label')=='주간'),{})
        value,reset=w.get('pct'),w.get('reset')
        if not valid_number(value) or not 0<=value<=100:continue
        if not valid_number(reset) or reset<=now:continue
        db.execute('INSERT OR IGNORE INTO weekly_samples VALUES(?,?,?,?,?)',
                   (q['id'],q['kind'],t,value,reset))
    db.execute('DELETE FROM weekly_samples WHERE t<?',(now-RETENTION,))


def interval(before, after):
    """Same-window differences; a reset loses unobserved spend near the boundary."""
    t0,p0,r0=before;t1,p1,r1=after
    if abs(r1-r0)<=60:
        return (p1-p0,False) if p1>=p0 else (None,True)
    if p0==p1==0 and r0>t1 and r1>t1:return 0,True
    if r1>r0 and t0<r0<=t1:return p1,True
    return None,True


def snapshot(db, quotas, now):
    history=collections.defaultdict(list)
    for account,t,pct,reset in db.execute(
            'SELECT account,t,pct,reset FROM weekly_samples WHERE t>=? AND t<=? ORDER BY t',
            (now-86400-FRESH,now)):
        history[account].append((t,pct,reset))
    # Only newly attributed events participate. Old, unbound history is never reassigned.
    columns={r[1] for r in db.execute('PRAGMA table_info(events)')}
    events=collections.defaultdict(list)
    if 'account' in columns:
        for account,sid,t,total in db.execute('''SELECT account,sid,t,fresh+cached+written+output
                FROM events WHERE account IS NOT NULL AND t>? AND t<=? ORDER BY t''',(now-86400-FRESH,now)):
            if valid_number(total) and total>0:events[account].append((t,sid,total))
    session_accounts=collections.defaultdict(set)
    for account,rows in events.items():
        for _,sid,_ in rows:session_accounts[sid].add(account)
    result=[];shares=collections.defaultdict(dict)
    for quota in quotas:
        account=quota['id'];points=history[account];observations=[];event_index=0
        for before,after in zip(points,points[1:]):
            t0,t1=before[0],after[0];delta,uncertain=interval(before,after)
            weights=collections.Counter()
            while event_index<len(events[account]) and events[account][event_index][0]<=t1:
                t,sid,tokens=events[account][event_index];event_index+=1
                if t>t0:weights[sid]+=tokens
            # Give the log collector time to receive reports; do not allocate incomplete tails.
            settled=t1<=now-10
            observations.append((t0,t1,delta,uncertain,weights if settled and t1-t0<=FRESH else {}))
        periods={}
        for key,_,seconds in WINDOWS:
            start=now-seconds
            # Do not include the part before the requested boundary or interpolate quota steps.
            chunks=[o for o in observations if o[0]>=start and o[1]<=now and o[2] is not None]
            covered=sum(t1-t0 for t0,t1,_,_,_ in chunks)
            partial=(not chunks or chunks[0][0]>start+FRESH or now-chunks[-1][1]>FRESH
                     or any(o[3] or o[1]-o[0]>FRESH for o in chunks) or any(a[1]!=b[0] for a,b in zip(chunks,chunks[1:])))
            value=sum(o[2] for o in chunks) if chunks else None
            allocation=collections.Counter();unattributed=0
            for t0,t1,delta,uncertain,weights in chunks:
                if uncertain or not weights:
                    unattributed+=delta;continue
                total=sum(weights.values())
                for sid,tokens in weights.items():allocation[sid]+=delta*tokens/total
            periods[key]={'used_pp':round(value,4) if value is not None else None,
                          'partial':partial,'observed_seconds':covered,
                          'unattributed_pp':round(unattributed,4),'sample_count':len(chunks)+1 if chunks else len(points)}
            for sid,value in allocation.items():
                if len(session_accounts[sid])!=1:continue
                shares[sid][key]={'used_pp':round(value,4),'account_id':account,
                                 'partial':partial,'basis':'observed_token_share',
                                 'observed_seconds':covered}
        # Bound the chart independently of how long the collector has run.
        step=max(1,math.ceil(len(points)/95))
        chart=points[::step]
        if points and chart[-1]!=points[-1]:chart.append(points[-1])
        result.append({'id':account,'kind':quota['kind'],'periods':periods,
                       'history':[[t,p] for t,p,_ in chart]})
    return {'accounts':result,'basis':'provider_weekly_percentage','as_of':now},dict(shares)
