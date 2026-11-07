"""Python port of OmniRoute account selection/quota fallback primitives.

Adapted from cheaper-inference/OmniRoute b2a64106c9e47d654012d24d5ae5424c950649cc:
src/sse/services/auth.ts, quotaLimitPolicy.ts and chatQuotaExhaustion.ts.
MIT, copyright 2026 diegosouzapw.
See third_party/omniroute/LICENSE and PORTING.md for attribution and scope.
"""
import math
from datetime import timezone
from email.utils import parsedate_to_datetime


def numeric(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)


def quota_deadline(account, model, now, threshold=100):
    """A reported model window may block; MCP and expired/stale reports do not."""
    if account.get('stale'):
        return None
    deadlines=[]
    for window in account.get('windows',[]):
        if window.get('scope')=='mcp' or window.get('model') not in (None,model):
            continue
        reset=window.get('reset')
        if numeric(reset) and 0<reset<=now:
            continue
        pct=window.get('pct')
        if numeric(pct) and pct>=threshold:
            deadlines.append(reset if numeric(reset) and reset>now else now+120)
    # Every exhausted applicable window must reset before this account is usable.
    return max(deadlines) if deadlines else None


def retry_seconds(value, now, default=30):
    try:
        seconds=float(value)
    except (ValueError,TypeError):
        try:
            date=parsedate_to_datetime(value)
            if date.tzinfo is None:date=date.replace(tzinfo=timezone.utc)
            seconds=date.timestamp()-now
        except (ValueError,TypeError,AttributeError,OverflowError):
            seconds=default
    return max(1,min(7*86400,seconds)) if numeric(seconds) else default


def failure_policy(status, headers, payload, now):
    """Classify a definite upstream response, before any response is streamed."""
    headers={k.lower():v for k,v in headers.items()}
    error=payload.get('error',{}) if isinstance(payload,dict) else {}
    if not isinstance(error,dict):error={'message':str(error)}
    code=str(error.get('code') or error.get('type') or '').lower()
    message=str(error.get('message') or '').lower()
    if status in (401,403):return {'retry':True,'reason':'authentication','until':now+120}
    if status==429:
        exhausted=any(mark in code+' '+message for mark in ('quota_exceeded','usage_limit_reached','insufficient_quota','weekly limit','usage limit reached','credit balance'))
        delay=retry_seconds(headers.get('retry-after'),now,300 if exhausted else 30)
        reset=error.get('resets_at') or error.get('reset_at')
        if exhausted and numeric(reset) and reset>now:delay=max(delay,reset-now)
        return {'retry':True,'reason':'quota' if exhausted else 'rate_limit','until':now+delay}
    if status in (500,502,503,504):
        return {'retry':True,'reason':'temporary','until':now+retry_seconds(headers.get('retry-after'),now,10)}
    return {'retry':False,'reason':'request','until':now}


def choose(accounts, provider, model, now, excluded, cooldowns, preferred=None, priority=(), threshold=100):
    """Fill-first with session affinity, quota preflight and failed-account exclusion."""
    eligible=[];retry_at=[]
    order={account:i for i,account in enumerate(priority)}
    for account in accounts:
        if account.get('kind')!=provider or account['id'] in excluded:
            continue
        deadline=max(cooldowns.get((account['id'],model),0),cooldowns.get((account['id'],'*'),0),
                     quota_deadline(account,model,now,threshold) or 0)
        if deadline>now:
            retry_at.append(deadline);continue
        eligible.append(account)
    eligible.sort(key=lambda a:(a['id']!=preferred,order.get(a['id'],len(order)),a['id']))
    return (eligible[0] if eligible else None),min(retry_at) if retry_at else None
