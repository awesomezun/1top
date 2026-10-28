"""Numerical usage summaries for the account's connected computers."""
import math

STOPS = (600, 900, 1800, 3600, 7200, 10800, 18000, 21600, 43200,
         86400, 172800, 259200, 604800, 1209600, 2592000, 7776000,
         15552000, 31536000)
PRESETS = {600: '10m', 1800: '30m', 3600: '1h', 18000: '5h',
           43200: '12h', 86400: '24h'}


def speed_windows(db, state):
    """One scan of recorded events, never parent plus child display totals."""
    now = state['updated']
    start = state.get('history_started', state.get('started', now))
    columns = ','.join('COALESCE(SUM(CASE WHEN t>? THEN fresh+cached+written+output ELSE 0 END),0)'
                       for _ in STOPS)
    values = db.execute(f'SELECT {columns},COALESCE(SUM(fresh+cached+written+output),0),COUNT(*) '
                        'FROM events WHERE t>=? AND t<=?',
                        (*[now - seconds for seconds in STOPS], start, now)).fetchone()
    known = bool(values[-1] or state.get('period_usage', {}).get('known_kinds'))
    rows = []
    for i, seconds in enumerate((*STOPS, max(1, now - start))):
        if not math.isfinite(values[i]) or values[i] < 0:
            continue
        rows.append({'key': PRESETS.get(seconds, f'custom:{seconds}') if i < len(STOPS) else 'all',
                     'seconds': seconds, 'tokens': values[i], 'known': known,
                     'partial': i < len(STOPS) and start > now - seconds})
    return rows
