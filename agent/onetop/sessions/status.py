"""Session-contract v1.3.0 §4. Pure decisions over recorded observations."""
from datetime import datetime
from ..observe.transcripts import boundary


def epoch(value):
    if isinstance(value, (int, float)):
        return value / 1000 if value > 1e12 else value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        return 0


def turn(transcript):
    start = end = 0
    interrupted = False
    for event in (transcript or {}).get('events', []):
        kind, stamp = boundary(event), epoch(event.get('t'))
        if kind == 'start':
            start = max(start, stamp)
        elif kind and stamp >= end:
            end, interrupted = stamp, kind == 'interrupt'
    return start, end, interrupted


def decide(registries, transcript, now, connected=True):
    if not connected:
        return 'disconnected', 0, 'processes'
    records = [r for r in registries if r]
    waiting = [r for r in records if r.get('status') == 'waiting']
    if waiting:
        return 'waiting', max(epoch(r.get('statusUpdatedAt')) for r in waiting), 'registry'
    start, end, interrupted = turn(transcript)
    # §4-1: an `idle` Claude Code wrote after the last start closes that turn.
    closed = max((epoch(r.get('statusUpdatedAt')) for r in records if r.get('status') == 'idle'), default=0)
    if start > end and closed >= start:
        end, interrupted = closed, False
    if start > end:
        return 'working', start, 'transcript_turn'
    if end:
        recent_child = any(0 <= now - epoch(child.get('mtime')) < 120
                           for child in (transcript or {}).get('subagents', []))
        if recent_child or any(r.get('status') == 'busy' for r in records):
            return 'subagents', end, 'transcript_children'
        if interrupted:
            return 'interrupted', end, 'transcript_turn'
        return ('done' if 0 <= now - end < 600 else 'idle'), end, 'transcript_turn'
    record = max(records, key=lambda r: epoch(r.get('statusUpdatedAt')), default={})
    fallback = {'busy': 'working', 'working': 'working', 'idle': 'idle',
                'interrupted': 'interrupted', 'aborted': 'interrupted'}
    return fallback.get(record.get('status'), 'unknown'), epoch(record.get('statusUpdatedAt')), record.get('source', 'registry')


def apply(rows, record):
    now = record['captured_at']
    for row in rows:
        state, stamp, source = decide(row.get('_registries', []), row.get('_transcript'), now,
                                      row.get('connected', False))
        row.update(status=state, display_status=state, status_at=stamp, status_source=source)
        for run in row['runs']:
            rstate, rat, _ = decide([run.get('_registry', {})], row.get('_transcript'), now, run['connected'])
            run.update(status=rstate, display_status=rstate, status_at=rat)
    return rows


def control_display(spec, mark):
    """Control overlays do not fabricate native registry events (§4 row 2)."""
    status = spec.get('status', 'unknown')
    if status == 'disconnected':
        return status, False
    valid = bool(mark and mark.get('key') == spec.get('control_key'))
    if valid and spec.get('status_at', 0) > mark['at'] and (
            status == 'working' or mark['phase'] == 'resuming' and status in ('idle', 'interrupted', 'done')):
        valid = False
    if valid:
        if mark['phase'] == 'resuming':
            return 'resuming', True
        if status in ('idle', 'interrupted', 'done'):
            return 'paused', True
    return status, valid
