"""Development stand-in for GET /api/history (usage-history-contract_v1.0.0.md).

Answers from records.sqlite (built by build_records.py) so the frontend can be designed against
real-shaped data before the collector implements the endpoint. Not product code.
"""
import os
import sqlite3
import time
from datetime import date, datetime, timedelta

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'records.sqlite')
FIXED = {'10m': 600, '30m': 1800, '1h': 3600, '5h': 18000, '12h': 43200, '24h': 86400}
STEPS = {'60': 60, '300': 300, '900': 900, '3600': 3600}
SOURCES = {'Claude': 'claude_transcripts', 'GLM': 'claude_transcripts', 'Codex': 'codex_sessions'}


class BadRequest(ValueError):
    pass


def local_midnight(t):
    d = datetime.fromtimestamp(t)
    return datetime(d.year, d.month, d.day).timestamp()


def bins_for(start, now, step):
    if step in STEPS:
        size = STEPS[step]
        offset = -time.localtime(start).tm_gmtoff
        first = (start - offset) // size * size + offset
        out, t = [], first
        while t <= now:
            out.append(t)
            t += size
        return out
    day = datetime.fromtimestamp(local_midnight(start))
    if step == 'week':
        day -= timedelta(days=day.weekday())
    elif step != 'day':
        raise BadRequest('step')
    out = []
    while day.timestamp() <= now:
        out.append(day.timestamp())
        day += timedelta(days=7 if step == 'week' else 1)
    return out


def history(query):
    db = sqlite3.connect(DB)
    now = time.time()
    kind = query.get('kind') or None
    where, args = ('AND kind=?', [kind]) if kind else ('', [])
    first = {k: t for k, t in db.execute('SELECT kind, MIN(t) FROM rec GROUP BY kind')}
    known = [t for k, t in first.items() if not kind or k == kind]
    covered_from = min(known) if known else now
    coverage = [{'source': SOURCES.get(k, 'transcripts'), 'kind': k, 'from': t, 'to': now}
                for k, t in sorted(first.items()) if not kind or k == kind]

    period = query.get('period') or '1h'
    if period in FIXED:
        seconds = FIXED[period]
    elif period == 'all':
        seconds = max(600, now - covered_from)
    elif period.startswith('custom:') and period[7:].isdigit():
        seconds = int(period[7:])
    else:
        raise BadRequest('period')
    edges = bins_for(now - seconds, now, query.get('step') or '60')
    if len(edges) > 400:
        raise BadRequest('too many bins')
    bounds = edges + [now + 1]

    def index(t):
        lo, hi = 0, len(edges) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if edges[mid] <= t:
                lo = mid
            else:
                hi = mid - 1
        return lo

    empty = [None if bounds[i + 1] <= covered_from else 0 for i in range(len(edges))]
    total, models, projects, model_kind = list(empty), {}, {}, {}
    for t, k, model, cwd, tokens in db.execute(
            f'SELECT t, kind, model, cwd, tokens FROM rec WHERE t>=? AND t<=? {where}', [edges[0], now, *args]):
        i = index(t)
        total[i] = (total[i] or 0) + tokens
        row = models.setdefault(model, list(empty))
        row[i] = (row[i] or 0) + tokens
        row = projects.setdefault(cwd or 'unknown', list(empty))
        row[i] = (row[i] or 0) + tokens
        model_kind.setdefault(model, {}).setdefault(k, 0)
        model_kind[model][k] += tokens

    def ranked(rows):
        # Top 12 by period total; the rest folds into one __other__ row.
        order = sorted(rows.items(), key=lambda kv: -sum(v or 0 for v in kv[1]))
        top, rest = order[:12], order[12:]
        if rest:
            other = [None if all(r[1][i] is None for r in rest) else sum(r[1][i] or 0 for r in rest) for i in range(len(edges))]
            top.append(('__other__', other, len(rest)))
        return top

    series = {
        'start': edges[0], 'end': now, 'step': query.get('step') or '60', 'bins': edges, 'total': total,
        'by_model': [{'key': m, 'kind': max(model_kind[m], key=model_kind[m].get), 'tokens': r[1]} if m != '__other__'
                     else {'key': m, 'folded': r[2], 'tokens': r[1]} for r in ranked(models) for m in [r[0]]],
        'by_project': [{'key': p, 'label': os.path.basename(p) if p != 'unknown' else '알 수 없음', 'tokens': r[1]} if p != '__other__'
                       else {'key': p, 'folded': r[2], 'tokens': r[1]} for r in ranked(projects) for p in [r[0]]]}

    today = date.today()
    hours = []
    by_hour = {}
    start_30 = datetime(today.year, today.month, today.day) - timedelta(days=29)
    for t, tokens in db.execute(f'SELECT t, tokens FROM rec WHERE t>=? {where}', [start_30.timestamp(), *args]):
        d = datetime.fromtimestamp(t)
        key = (d.date().isoformat(), d.hour)
        by_hour[key] = by_hour.get(key, 0) + tokens
    for day in range(30):
        d = start_30 + timedelta(days=day)
        for h in range(24):
            at = d + timedelta(hours=h)
            known_hour = at.timestamp() + 3600 > covered_from and at.timestamp() <= now
            hours.append([d.date().isoformat(), h, by_hour.get((d.date().isoformat(), h), 0) if known_hour else None])
    by_day = {d: n for d, n in db.execute(
        f"SELECT date(t,'unixepoch','localtime') d, SUM(tokens) FROM rec WHERE 1=1 {where} GROUP BY d", args)}
    days, d = [], datetime.fromtimestamp(covered_from).date()
    while d <= today:
        days.append([d.isoformat(), by_day.get(d.isoformat(), 0)])
        d += timedelta(days=1)
    return {'as_of': now, 'coverage': coverage, 'series': series, 'heatmap': {'hours': hours, 'days': days}}
