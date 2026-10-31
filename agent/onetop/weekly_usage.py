"""Provider-reported weekly percentages and explicitly estimated session shares."""
import collections
import math
from pathlib import Path
from .usage import WINDOWS

RETENTION = 8 * 86400
FRESH = 300
# Claude's callbacks are response-driven. A closed, account-attributed interval
# may span one hour; its approximate local token ratio expires after one day or
# the weekly reset, whichever comes first. This never refreshes the quota itself.
CLAUDE_CALIBRATION_GAP = 3600
CLAUDE_CALIBRATION_AGE = 86400


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
    intervals=spec.get('_routing_intervals')
    if intervals and timestamp>=min(row[2] for row in intervals):
        from .routing_attribution import account_at
        return account_at(intervals,timestamp)
    binding=spec.get('_routing_original_binding',spec.get('account_binding'))
    return binding[0] if binding and timestamp>=binding[1] else None


def bind_adapter(db, spec, roots, now):
    """Match an app's explicit provider identity to an already observed account."""
    account=spec.get('billing_account');kind=spec.get('billing_kind')
    known=any(value[:2]==(account,kind) for value in roots.values())
    previous=db.execute('SELECT account,kind,since FROM adapter_accounts WHERE sid=?',(spec['id'],)).fetchone()
    since=previous[2] if previous and previous[:2]==(account,kind) else now
    db.execute('INSERT OR REPLACE INTO adapter_accounts VALUES(?,?,?,?)',
               (spec['id'],account if known else None,kind,since))
    return (account,since) if account and known else None


def initialize(db):
    columns={r[1] for r in db.execute('PRAGMA table_info(events)')}
    if columns and 'account' not in columns:db.execute('ALTER TABLE events ADD COLUMN account TEXT')
    db.execute('''CREATE TABLE IF NOT EXISTS weekly_samples (
        account TEXT, kind TEXT, t REAL, pct REAL, reset REAL,
        PRIMARY KEY(account,t))''')
    db.execute('''CREATE TABLE IF NOT EXISTS adapter_accounts (
        sid TEXT PRIMARY KEY, account TEXT, kind TEXT, since REAL)''')


def record(db, quotas, now):
    for q in quotas:
        # Agy /usage reports pools but not the signed-in account. Do not join
        # account history across potentially different CLI logins.
        if q.get('identity_verified') is False:continue
        t=q.get('updated')
        if q.get('stale',True) or not valid_number(t) or not 0<=now-t<=FRESH:continue
        w=next((w for w in q.get('windows',[]) if w.get('label')=='주간'),{})
        value,reset=w.get('pct'),w.get('reset')
        if not valid_number(value) or not 0<=value<=100:continue
        if not valid_number(reset) or reset<=now:continue
        db.execute('INSERT OR IGNORE INTO weekly_samples VALUES(?,?,?,?,?)',
                   (q['id'],q['kind'],t,value,reset))
    db.execute('DELETE FROM weekly_samples WHERE t<?',(now-RETENTION,))


def restore_bound_claude_accounts(db, quotas, sessions, now):
    """Keep a verified running session's old quota after its profile logs out."""
    from .accounts import claude_statusline_report
    known = {q['id']:q for q in quotas}
    for session in sessions:
        binding = session.get('account_binding')
        if (session.get('kind') != 'Claude' or not binding or
                session.get('account_binding_source') not in ('claude_statusline_session','otel_session_identity')):
            continue
        account = binding[0]
        report = (claude_statusline_report(Path(session['config_dir']),account,now)
                  if session.get('config_dir') else None)
        quota = known.get(account)
        if (report and report.get('verified_activity') is True and
                (not quota or report['updated'] >= quota.get('updated',0))):
            if quota is None:
                quota={'id':account,'kind':'Claude','account_label':'Claude · '+account[-6:],'plan':''}
                quotas.append(quota);known[account]=quota
            quota.update(report,stale=now-report['updated']>FRESH,note='Claude Code 상태줄 보고')
            continue
        if quota is not None:continue
        row = db.execute('''SELECT t,pct,reset FROM weekly_samples WHERE account=?
            AND kind='Claude' AND t>=? AND t<=? ORDER BY t DESC LIMIT 1''',
            (account,now-RETENTION,now)).fetchone()
        if not row or not all(valid_number(v) for v in row) or not 0<=row[1]<=100 or row[2]<=now:
            continue
        quotas.append({'id':account,'kind':'Claude','account_label':'Claude · '+account[-6:],
            'plan':'','updated':row[0],'stale':True,'status':'last_report',
            'source':'historical_provider_report','note':'Claude Code 마지막 보고값',
            'windows':[{'label':'주간','pct':row[1],'reset':row[2]}]})
        known[account]=quotas[-1]


def restore_claude_last_report(db, quotas, now):
    """Validate initial CLI reports and preserve verified Claude history as stale."""
    for quota in quotas:
        if quota.get('kind')!='Claude' or not quota.get('id'):continue
        windows=quota.get('windows') or []
        weekly=next((value for value in windows if value.get('label')=='주간'),{})
        value=weekly.get('pct');reset=weekly.get('reset')
        statusline=quota.get('source')=='claude_statusline'
        initial=statusline and quota.get('verified_activity') is not True
        if not statusline:
            if valid_number(value) and 0<=value<=100:continue
            # An explicit reset invalidates the old cycle even when no new value arrived.
            if valid_number(reset) and reset>0 and reset<=now:continue
        previous=db.execute('''SELECT t,pct,reset FROM weekly_samples
            WHERE account=? AND kind='Claude' AND t>=? AND t<=? ORDER BY t DESC LIMIT 1''',
            (quota['id'],now-RETENTION,now)).fetchone()
        if not previous:continue
        reported,previous_value,previous_reset=previous
        if not all(valid_number(v) for v in previous) or not 0<=previous_value<=100 or previous_reset<=now:continue
        same_cycle=valid_number(reset) and reset>now and abs(reset-previous_reset)<=60
        conflicting_cycle=statusline and valid_number(reset) and reset>0 and abs(reset-previous_reset)>60
        if initial or conflicting_cycle:
            # Existing CLI processes may retain another account's login in memory.
            # Their first callback cannot establish identity from current profile metadata.
            quota.update(stale=True,status='last_report',note='Claude Code 마지막 보고값 · 다음 응답에서 갱신')
            if not same_cycle:
                windows=[{'label':item.get('label'),'pct':None,'reset':0} for item in windows]
                weekly=next((item for item in windows if item.get('label')=='주간'),{})
            elif valid_number(value) and previous_value<=value<=100:
                continue
        else:
            if valid_number(value) and 0<=value<=100:continue
            if valid_number(reset) and reset>0 and reset<=now:continue
            if valid_number(quota.get('updated')) and quota['updated']>reported:continue
            if valid_number(reset) and reset>0 and abs(reset-previous_reset)>60:continue
        restored={'label':'주간','pct':previous_value,'reset':previous_reset}
        quota['windows']=[restored if item.get('label')=='주간' else item for item in windows]
        if not weekly:quota['windows'].append(restored)
        quota.update(updated=reported,stale=True,status='last_report',source='historical_provider_report',
                     note='Claude Code 마지막 보고값 · 다음 응답에서 갱신')
        quota.pop('verified_activity',None)


def interval(before, after):
    """Same-window differences; a reset loses unobserved spend near the boundary."""
    t0,p0,r0=before;t1,p1,r1=after
    if abs(r1-r0)<=60:
        return (p1-p0,False) if p1>=p0 else (None,True)
    if p0==p1==0 and r0>t1 and r1>t1:return 0,True
    if r1>r0 and t0<r0<=t1:return p1,True
    return None,True


def reconciled_history(points):
    """Keep raw storage intact; reconcile same-cycle overshoots to newer reports."""
    retained=[];corrections=[];excluded=0;start=0
    for index in range(1,len(points)+1):
        if index<len(points) and abs(points[index][2]-points[index-1][2])<=60:continue
        cycle=points[start:index];ceiling=None;clean=[]
        corrections.extend(after[0] for before,after in zip(cycle,cycle[1:]) if after[1]<before[1])
        for point in reversed(cycle):
            if ceiling is not None and point[1]>ceiling:
                excluded+=1;continue
            clean.append(point);ceiling=point[1]
        retained.extend(reversed(clean));start=index
    return retained,corrections,excluded


def snapshot(db, quotas, now, bindings=None, recording_started=None):
    history=collections.defaultdict(list)
    for account,t,pct,reset in db.execute(
            'SELECT account,t,pct,reset FROM weekly_samples WHERE t>=? AND t<=? ORDER BY t',
            (now-86400-FRESH,now)):
        history[account].append((t,pct,reset))
    # Only newly attributed events participate. Old, unbound history is never reassigned.
    columns={r[1] for r in db.execute('PRAGMA table_info(events)')}
    events=collections.defaultdict(list);session_events=collections.defaultdict(list)
    unbound=collections.defaultdict(list)
    adapter_kinds=dict(db.execute('SELECT sid,kind FROM adapter_accounts'))
    if 'account' in columns:
        for account,sid,kind,t,total in db.execute('''SELECT account,sid,kind,t,fresh+cached+written+output
                FROM events WHERE t>? AND t<=? ORDER BY t''',(now-86400-FRESH,now)):
            if valid_number(total) and total>0:
                # Runtime/app and billing provider are different dimensions.
                # Account-attributed events retain their recorded identity even
                # after the app changes provider. Unbound old reports remain
                # unbound and cannot inflate a calibration's missing denominator.
                if kind=='Aside':
                    kind=next((q['kind'] for q in quotas if q['id']==account),adapter_kinds.get(sid) or 'Aside')
                session_events[sid].append((t,account,kind,total))
                if account:events[account].append((t,sid,total))
                else:unbound[kind].append(t)
    session_accounts=collections.defaultdict(set)
    for account,rows in events.items():
        for _,sid,_ in rows:session_accounts[sid].add(account)
    if bindings is None:
        bindings={sid:next(iter(accounts)) for sid,accounts in session_accounts.items() if len(accounts)==1}
    result=[];shares=collections.defaultdict(dict)
    for quota in quotas:
        account=quota['id'];points,corrections,excluded=reconciled_history(history[account]);observations=[];event_index=0
        claude_history=(quota['kind']=='Claude' and quota.get('source') in ('claude_statusline','historical_provider_report','claude_oauth'))
        calibration_gap=CLAUDE_CALIBRATION_GAP if claude_history else FRESH
        for before,after in zip(points,points[1:]):
            t0,t1=before[0],after[0];delta,uncertain=interval(before,after)
            if any(t0<corrected<=t1 for corrected in corrections):uncertain=True
            weights=collections.Counter()
            while event_index<len(events[account]) and events[account][event_index][0]<=t1:
                t,sid,tokens=events[account][event_index];event_index+=1
                if t>t0:weights[sid]+=tokens
            # Give the log collector time to receive reports; do not allocate incomplete tails.
            settled=t1<=now-10
            observations.append((t0,t1,delta,uncertain,weights if settled and t1-t0<=calibration_gap else {}))
        # Calibrate an account-specific token equivalent, then apply it to the
        # selected period's reported tokens. Never reuse a short observed share
        # as if it represented all tokens in a longer selected period.
        current_reset=points[-1][2] if points else None
        account_observed_since=events[account][0][0] if events[account] else None
        eligible=[];earlier=[];pending_tokens=0;pending_end=None
        for index,o in enumerate(observations):
            t0,t1,delta,uncertain,weights=o
            same_cycle=(current_reset is not None and abs(points[index][2]-current_reset)<=60
                        and abs(points[index+1][2]-current_reset)<=60)
            missing=any(t0<t<=t1 for t in unbound[quota['kind']])
            after_correction=not corrections or t0>=corrections[-1]
            attribution_started=(not claude_history or (account_observed_since is not None and account_observed_since<=t0))
            # A provider percentage can arrive after the token log. Include the
            # complete settled interval even if that individual callback has no
            # tokens, so a delayed quota increment is paired with preceding
            # account-attributed work. Require a measured token denominator below.
            settled_interval=t1<=now-10 and t1-t0<=calibration_gap
            complete=(same_cycle and attribution_started and settled_interval
                      and not uncertain and delta is not None and not missing)
            if not complete:
                pending_tokens=0;pending_end=None;continue
            if pending_end!=t0:pending_tokens=0
            pending_tokens+=sum(weights.values());pending_end=t1
            # Never attach an empty increment across a gap, an unbound event,
            # or work already consumed by an earlier percentage increment.
            if delta>0 and pending_tokens<=0:continue
            (eligible if after_correction else earlier).append(o)
            if delta>0:pending_tokens=0
        # A correction rejects the affected span, not unrelated earlier
        # account-attributed measurements that survive reconciliation. Prefer
        # post-correction data; otherwise retain a bounded same-cycle Claude
        # calibration until a new positive percentage movement is available.
        ready=lambda rows: (sum(sum(o[4].values()) for o in rows)>0
                            and sum(o[2] for o in rows)>=1
                            and sum(o[1]-o[0] for o in rows)>=120)
        reused_earlier=bool(claude_history and not ready(eligible) and ready(earlier))
        if reused_earlier:eligible=earlier
        calibration_tokens=sum(sum(o[4].values()) for o in eligible)
        calibration_pp=sum(o[2] for o in eligible)
        calibration_seconds=sum(o[1]-o[0] for o in eligible)
        weekly=next((window for window in quota.get('windows',[]) if window.get('label')=='주간'),{})
        reported_reset=weekly.get('reset')
        historical_valid=(claude_history and eligible and valid_number(reported_reset) and reported_reset>now
                          and current_reset is not None and abs(reported_reset-current_reset)<=60
                          and 0<=now-eligible[-1][1]<=CLAUDE_CALIBRATION_AGE)
        # No quota movement is not evidence of a zero token-to-quota conversion.
        usable=(calibration_tokens>0 and calibration_pp>=1 and calibration_seconds>=120
                and current_reset is not None and current_reset>now
                and (historical_valid if claude_history else
                     (not quota.get('stale',False) and points and now-points[-1][0]<=FRESH)))
        calibration=({'tokens':calibration_tokens,'used_pp':round(calibration_pp,4),
                      'seconds':calibration_seconds,'from':eligible[0][0],'to':eligible[-1][1],
                      'pp_per_token':calibration_pp/calibration_tokens,
                      'confidence':'early' if calibration_seconds<600 or calibration_pp<3 else 'limited'}
                     if usable else None)
        if calibration and historical_valid:
            calibration.update(source='historical_provider_calibration',kind='Claude',reset=reported_reset,
                               valid_until=min(reported_reset,calibration['to']+CLAUDE_CALIBRATION_AGE),
                               age_seconds=max(0,now-calibration['to']),report_source=quota.get('source'),
                               account_observed_since=account_observed_since,reused_before_correction=reused_earlier)
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
                if uncertain or not weights or t1-t0>FRESH:
                    unattributed+=delta;continue
                total=sum(weights.values())
                for sid,tokens in weights.items():allocation[sid]+=delta*tokens/total
            periods[key]={'used_pp':round(value,4) if value is not None else None,
                          'partial':partial,'observed_seconds':covered,
                          'unattributed_pp':round(unattributed,4),
                          'observed_from':chunks[0][0] if chunks else None,
                          'observed_to':chunks[-1][1] if chunks else None,'sample_count':len(chunks)+1 if chunks else len(points)}
            if calibration:
                for sid,bound_account in bindings.items():
                    if bound_account!=account:continue
                    period_rows=[r for r in session_events[sid] if start<r[0]<=now and r[2]==quota['kind']]
                    # A real login switch does not erase the new account's measured
                    # segment. Keep the previous account's tokens out of this quota.
                    other_accounts=any(r[1] is not None and r[1]!=account for r in period_rows)
                    rows=[r for r in period_rows if r[1]==account or (r[1] is None and not other_accounts)]
                    tokens=sum(r[3] for r in rows)
                    if not rows:continue
                    inferred_tokens=sum(r[3] for r in rows if r[1] is None)
                    value=tokens*calibration['pp_per_token']
                    if not math.isfinite(value):continue
                    shares[sid][key]={'used_pp':round(value,4),'account_id':account,
                                     'basis':'calibrated_token_equivalent','tokens':tokens,
                                     'partial':other_accounts or (recording_started if recording_started is not None else now)>start,
                                     'excluded_account_tokens':sum(r[3] for r in period_rows if r not in rows),
                                     'period_seconds':seconds,'calibration':calibration,
                                     'inferred_account_tokens':inferred_tokens}
        # Bound the chart independently of how long the collector has run.
        step=max(1,math.ceil(len(points)/95))
        chart=points[::step]
        if points and chart[-1]!=points[-1]:chart.append(points[-1])
        # Flow needs original adjacent samples: thinning the cumulative chart
        # creates artificial >5-minute gaps and drops valid long-window changes.
        # Keep reset-aware intervals separately, including observed zero changes.
        flow=[[t0,t1,delta] for t0,t1,delta,uncertain,_ in observations
              if not uncertain and valid_number(delta) and delta>=0
              and now-86400<=t0<t1<=now and t1-t0<=FRESH]
        result.append({'id':account,'kind':quota['kind'],'periods':periods,'calibration':calibration,
                       'history':[[t,p] for t,p,_ in chart],'flow':flow,
                       'usage_points':[[t,p,r] for t,p,r in points],
                       'history_quality':{'reconciled':bool(corrections),'excluded_samples':excluded,
                                          'correction_count':len(corrections),'last_correction':corrections[-1] if corrections else None},
                       'increase_intervals':[[t0,t1,delta,uncertain] for t0,t1,delta,uncertain,_ in observations
                                             if now-86400<=t0<t1<=now]})
    return {'accounts':result,'basis':'provider_weekly_percentage','as_of':now},dict(shares)
