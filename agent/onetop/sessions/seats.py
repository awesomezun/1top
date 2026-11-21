"""Orca's own report for an agent seat: the chat name, and state as the last resort (§4 row 9)."""
from .identity import process_rows

PREFIX = 'structured-agent-session-'
STATES = {'working': 'busy', 'done': 'idle', 'idle': 'idle', 'waiting': 'waiting', 'blocked': 'waiting',
          'permission': 'waiting'}


def workspace(path):
    return str(path or '').replace('\\', '/').rstrip('/')


def apply(rows, record):
    # T5: an app's own name for the agent whose workspace a chat seat runs in (OpenBot).
    named = {workspace(a['workspace']): a['name'] for a in record.get('openbot_agents') or [] if a.get('workspace')}
    for row in rows:
        name = named.get(workspace(row.get('cwd'))) if row.get('chat') else None
        if name:
            row['chat_name'] = row['workspace_name'] = row['project_name'] = name
    agents = record.get('orca_agents') or []
    if not agents:
        return rows
    processes = process_rows(record)
    chats = {a['paneKey'][len(PREFIX):].split(':', 1)[0]: a for a in agents if a['paneKey'].startswith(PREFIX)}
    panes = {a['paneKey']: a for a in agents}
    for row in rows:
        agent = None
        for run in row['runs']:
            terminal = run.get('terminal') or {}
            if run.get('role') == 'chat':
                agent = chats.get((processes[run['pid']].get('env') or {}).get('ORCA_AGENT_SESSION_ID'))
            elif terminal.get('leafId'):
                agent = panes.get(f"{terminal.get('tabId')}:{terminal['leafId']}")
            if agent:
                break
        if not agent:
            continue
        if row.get('chat') and agent.get('name'):
            row['chat_name'] = agent['name']
        state = 'interrupted' if agent.get('interrupted') else STATES.get(agent.get('state'))
        if state and agent.get('verifiable', True) and not row.get('_registries') and not (row.get('_transcript') or {}).get('events'):
            row['_registries'] = [{'status': state, 'statusUpdatedAt': agent.get('since') or 0, 'source': 'orca_agent'}]
    return rows
