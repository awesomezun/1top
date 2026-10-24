"""A last-request input snapshot, never cumulative spend or inferred file sizes."""
import math


def count(value):
    return value if isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0 else None


def request_context(usage, observed_at, model='', capacity=None, codex=False):
    if not isinstance(usage,dict):return None
    used=count(usage.get('input_tokens'))
    if used is None:return None
    cached=count(usage.get('cached_input_tokens' if codex else 'cache_read_input_tokens',0))
    written=count(usage.get('cache_write_input_tokens' if codex else 'cache_creation_input_tokens',0))
    if cached is None or written is None:return None
    if codex:
        # Codex input already includes cached input. Never count the cache twice.
        if cached>used or written>used-cached:return None
        parts=[used-cached-written,cached,written]
    else:
        parts=[used,cached,written];used=sum(parts)
    cap=count(capacity)
    return {'basis':'last_request_input','input_tokens':used,'capacity':cap if cap else None,
            'parts':parts,'observed_at':count(observed_at) or 0,'model':str(model)[:80]}


def stored_context(state):
    if state.get('context_usage'):return state['context_usage']
    # Older persisted ledgers retain the last input total, without its breakdown.
    used=count(state.get('request_input'))
    if used is None:return None
    return {'basis':'last_request_input','input_tokens':used,'capacity':count(state.get('context_size')) or None,
            'parts':None,'observed_at':count(state.get('last_usage')) or 0,'model':str(state.get('model',''))[:80]}
