"""Read-only, client-specific time ranges over retained local usage reports."""
import collections
import copy
import math
import re

from .hierarchy import group_sessions
from .usage import WINDOWS, window_usage
from .weekly_usage import FRESH, interval, reconciled_history


def parse_period(value):
    if value in {key for key, _, _ in WINDOWS}:
        return None
    if value == 'all':
        return 'all'
    if not isinstance(value, str) or not re.fullmatch(r'custom:[0-9]{1,13}', value):
        raise ValueError('Invalid time range')
    seconds = int(value.split(':')[1])
    # JavaScript Date's representable range, not a product lookback cap.
    if seconds < 600 or seconds % 60 or seconds > 8_000_000_000_000:
        raise ValueError('Invalid time range')
    return seconds


def period_label(seconds):
    if seconds % 86400 == 0:
        return f'{int(seconds // 86400)}일'
    if seconds % 3600 == 0:
        return f'{int(seconds // 3600)}시간'
    return f'{int(seconds // 60)}분'


def extend_snapshot(db, snapshot, key):
    duration = parse_period(key)
    if duration is None or not snapshot.get('ready'):
        return snapshot
    result = copy.deepcopy(snapshot)
    now = result['updated']
    started = result.get('history_started', result['started'])
    seconds = max(600, now - started) if duration == 'all' else duration
    label = '전체 기록' if duration == 'all' else period_label(seconds)
    period, usage = window_usage(db, now, started, result['period_usage']['known_kinds'],
                                 [(key, label, seconds)])
    result['period_usage']['windows'].append(period['windows'][0])
    result['period_usage']['known_kinds'] = period['known_kinds']
    start = now - seconds
    # Keep chart data bounded independently of the number/age of reports.
    step = max(60, math.ceil(seconds / 240 / 60) * 60)
    buckets = db.execute('''SELECT CAST((t-?)/? AS INTEGER),kind,
        SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events
        WHERE t>? AND t<=? AND t>=? GROUP BY 1,2 ORDER BY 1''',
        (start, step, start, now, started)).fetchall()
    result['events'] = [dict(zip(('t', 'kind', 'fresh', 'cached', 'written', 'output'),
                                (min(now - .001, start + bucket * step), kind, *values)))
                        for bucket, kind, *values in buckets]
    result['chart_range'] = {'start': start, 'end': now, 'step': step}
    attributed = collections.defaultdict(list)
    for sid, account, kind, tokens in db.execute('''SELECT sid,account,kind,
        SUM(fresh+cached+written+output) FROM events
        WHERE t>? AND t<=? AND t>=? GROUP BY sid,account,kind''', (start, now, started)):
        attributed[sid].append((account, kind, tokens))
    accounts = {a['id']: a for a in result.get('weekly_usage', {}).get('accounts', [])}
    for session in result['sessions']:
        sid = session['id']; known = session.get('tokens') is not None
        u = session.setdefault('usage', {})
        u.setdefault('windows', {})[key] = usage.get(sid, {}).get(key, [0, 0, 0, 0]) if known else None
        account = u.get('weekly_account'); calibration = accounts.get(account, {}).get('calibration')
        rows = attributed[sid]
        # Match the existing conversion contract; never relabel another account's history.
        if not known or session.get('loading') or not calibration or not rows:
            continue
        provider = accounts[account].get('kind') or session.get('billing_kind') or session['kind']
        rows = [(a, accounts.get(a, {}).get('kind', provider) if kind == 'Aside' else kind, n)
                for a, kind, n in rows]
        other_accounts = any(a is not None and a != account for a, kind, _ in rows if kind == provider)
        accepted = [(a, n) for a, kind, n in rows if kind == provider and
                    (a == account or a is None and not other_accounts)]
        if not accepted:
            continue
        tokens = sum(n for _, n in accepted)
        converted = tokens * calibration['pp_per_token']
        if not math.isfinite(converted):
            continue
        u.setdefault('weekly_estimate', {})[key] = {
            'used_pp': round(converted, 4), 'account_id': account,
            'basis': 'calibrated_token_equivalent', 'tokens': tokens,
            'partial': other_accounts or started > start, 'period_seconds': seconds, 'calibration': calibration,
            'inferred_account_tokens': sum(n for a, n in accepted if a is None),
            'excluded_account_tokens': sum(n for a, kind, n in rows if kind == provider and (a, n) not in accepted)}
    result['root_sessions'] = group_sessions(result['sessions'])
    # The provider-history retention is separate from token history. Missing
    # quota history stays partial rather than extrapolating it from token totals.
    for account in accounts.values():
        raw = db.execute('SELECT t,pct,reset FROM weekly_samples WHERE account=? AND t>=? AND t<=? ORDER BY t',
                         (account['id'], start - FRESH, now)).fetchall()
        points, corrections, _ = reconciled_history(raw)
        chunks = []
        for a, b in zip(points, points[1:]):
            delta, uncertain = interval(a, b)
            if a[0] < start or delta is None:
                continue
            chunks.append((a[0], b[0], delta, uncertain or any(a[0] < t <= b[0] for t in corrections)))
        covered = sum(b - a for a, b, _, _ in chunks)
        account['periods'][key] = {
            'used_pp': sum(d for _, _, d, _ in chunks) if chunks else None,
            'observed_seconds': covered, 'partial': not chunks or covered < seconds - FRESH,
            'observed_from': chunks[0][0] if chunks else None,
            'observed_to': chunks[-1][1] if chunks else None, 'sample_count': len(points)}
        stride = max(1, math.ceil(len(points) / 240))
        chart = points[::stride]
        if points and chart[-1] != points[-1]:
            chart.append(points[-1])
        account['usage_points'] = [list(p) for p in chart]
    return result
