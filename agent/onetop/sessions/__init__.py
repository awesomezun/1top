"""Replayable session recognition. This package performs no filesystem/process I/O."""
from . import identity, terminals, seats, status, naming
from ..hierarchy import annotate
from .aside import build as aside_rows
from .openmausbot import build as openmausbot_rows


def resolve(record):
    rows = identity.resolve(record)
    terminals.apply(rows, record)
    seats.apply(rows, record)
    status.apply(rows, record)
    adapters = aside_rows(record.get('aside_sessions', []))
    adapters += openmausbot_rows(record.get('openmausbot_threads') or [], bool(record.get('openmausbot_running')))
    status.apply(adapters, record)
    rows.extend(adapters)
    annotate(rows)
    naming.apply(rows)
    return rows


def public(row):
    """Internal evidence is for recomputation, not /api/state or relay payloads."""
    return {k: ([{a:b for a,b in run.items() if not a.startswith('_')} for run in value]
                if k == 'runs' else value) for k,value in row.items() if not k.startswith('_')}
