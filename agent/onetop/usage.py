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
    # Older retained databases have no event-time model. Keep their tokens as
    # unknown instead of assigning the session's current (possibly changed) model.
    model_column = 'model' if any(r[1] == 'model' for r in db.execute('PRAGMA table_info(events)')) else 'NULL'
    for key, label, seconds in WINDOWS if windows is None else windows:
        beginning = max(started, now - seconds)
        grouped = db.execute(f'''SELECT sid,kind,{model_column},SUM(fresh),SUM(cached),SUM(written),SUM(output)
            FROM events WHERE t>? AND t<=? AND t>=? GROUP BY 1,2,3''',
            (now - seconds, now, started)).fetchall()
        by_kind, by_model, model_sessions, ids = {}, {}, {}, set()
        for sid, kind, model, *values in grouped:
            known.add(kind)
            ids.add(sid)
            model = model.strip() if isinstance(model, str) else None
            if not model or model.lower() in ('unknown', '<synthetic>'):
                model = None
            identity = (kind, model)
            model_total = by_model.setdefault(identity, [0, 0, 0, 0])
            model_sessions.setdefault(identity, set()).add(sid)
            aggregate = by_kind.setdefault(kind, [0, 0, 0, 0])
            per_session = sessions.setdefault(sid, {}).setdefault(key, [0, 0, 0, 0])
            for i, value in enumerate(values):
                aggregate[i] += value
                per_session[i] += value
                model_total[i] += value
        models = [{'kind': kind, 'model': model, 'tokens': values,
                   'session_count': len(model_sessions[(kind, model)])}
                  for (kind, model), values in by_model.items()]
        models.sort(key=lambda row: (-sum(row['tokens']), row['kind'], row['model'] or ''))
        periods.append({'key': key, 'label': label, 'seconds': seconds,
                        'from': beginning, 'observed_seconds': max(0, now - beginning),
                        'partial': started > now - seconds,
                        'tokens': [sum(v[i] for v in by_kind.values()) for i in range(4)],
                        'by_kind': by_kind, 'by_model': models, 'session_count': len(ids)})
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
