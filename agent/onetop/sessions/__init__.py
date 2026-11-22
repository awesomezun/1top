"""Replayable session recognition. This package performs no filesystem/process I/O."""
from . import identity, terminals, seats, status, naming
from ..hierarchy import annotate
from .aside import build as aside_rows
from .openmausbot import build as openmausbot_rows
from .devin import build as devin_rows
from .antigravity import build as antigravity_rows


def resolve(record):
    rows = identity.resolve(record)
    terminals.apply(rows, record)
    seats.apply(rows, record)
    status.apply(rows, record)
    adapters = aside_rows(record.get('aside_sessions', []))
    adapters += openmausbot_rows(record.get('openmausbot_threads') or [], bool(record.get('openmausbot_running')))
    agents, openbot = record.get('openbot_agents') or [], bool(record.get('openbot_running'))
    adapters += devin_rows(record.get('devin_sessions') or [], agents, bool(record.get('devin_running')), openbot)
    # An Agy CLI process already lists its own conversation; the ACP runtime's are listed from their summaries.
    listed = {row['conversation_id'] for row in rows if row['kind'] == 'Antigravity'}
    adapters += [row for row in antigravity_rows(record.get('antigravity_conversations') or [], agents, openbot)
                 if row['conversation_id'] not in listed]
    status.apply(adapters, record)
    rows.extend(adapters)
    annotate(rows)
    naming.apply(rows)
    return rows


def public(row):
    """Internal evidence is for recomputation, not /api/state or relay payloads."""
    return {k: ([{a:b for a,b in run.items() if not a.startswith('_')} for run in value]
                if k == 'runs' else value) for k,value in row.items() if not k.startswith('_')}
