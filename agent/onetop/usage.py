"""Per-session usage rates derived from recorded reports, not CPU inference."""
WINDOWS = [('24h', '24시간', 86400), ('12h', '12시간', 43200),
           ('5h', '5시간', 18000), ('1h', '1시간', 3600),
           ('30m', '30분', 1800), ('10m', '10분', 600)]


def window_usage(db, now, started, known_kinds=(), windows=None):
    """Rolling (now-duration, now] sums; include retained, now-closed sessions.

    Partial coverage describes the recording horizon, not guaranteed complete
    provider accounting. Missing reports and first cumulative baselines remain
    unknown; do not reconstruct them from lifetime session totals.
    """
    periods = []
    sessions = {}
    known = set(known_kinds)
    for key, label, seconds in WINDOWS if windows is None else windows:
        beginning = max(started, now - seconds)
        grouped = db.execute('''SELECT sid,kind,SUM(fresh),SUM(cached),SUM(written),SUM(output)
            FROM events WHERE t>? AND t<=? AND t>=? GROUP BY sid,kind''',
            (now - seconds, now, started)).fetchall()
        by_kind, ids = {}, set()
        for sid, kind, *values in grouped:
            known.add(kind)
            ids.add(sid)
            aggregate = by_kind.setdefault(kind, [0, 0, 0, 0])
            per_session = sessions.setdefault(sid, {}).setdefault(key, [0, 0, 0, 0])
            for i, value in enumerate(values):
                aggregate[i] += value
                per_session[i] += value
        periods.append({'key': key, 'label': label, 'seconds': seconds,
                        'from': beginning, 'observed_seconds': max(0, now - beginning),
                        'partial': started > now - seconds,
                        'tokens': [sum(v[i] for v in by_kind.values()) for i in range(4)],
                        'by_kind': by_kind, 'session_count': len(ids)})
    return {'as_of': now, 'recording_started': started,
            'known_kinds': sorted(known), 'windows': periods}, sessions


def session_usage(db,now,started):
    window=min(60,max(1,now-started))
    minute={r[0]:list(r[1:]) for r in db.execute(
        'SELECT sid,SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events WHERE t>? AND t<=? GROUP BY sid',
        (now-window,now))}
    five={r[0]:list(r[1:]) for r in db.execute(
        'SELECT sid,SUM(fresh),SUM(cached),SUM(written),SUM(output) FROM events WHERE t>? AND t<=? GROUP BY sid',(now-300,now))}
    history={}
    for sid,t,n in db.execute('SELECT sid,CAST(t/60 AS INTEGER)*60,SUM(fresh+cached+written+output) FROM events WHERE t>? AND t<=? GROUP BY 1,2 ORDER BY 2',(now-3600,now)):
        history.setdefault(sid,[]).append([t,n])
    return minute,five,history,window
