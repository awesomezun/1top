"""T5 adapter rows for Devin sessions (observe/devin.py): an OpenBot agent's chat when its workspace is one,
otherwise Devin CLI's own session. Tokens come from Devin's per-response reports (server.read_devin)."""
from .seats import workspace

OPENBOT = {'app': 'OpenBot', 'app_path': '/Applications/OpenBot.app', 'terminal': 'OpenBot 채팅', 'match': 'chat'}


def seat(cwd, agents):
    """The OpenBot agent whose workspace a conversation runs in, if any."""
    return {workspace(a['workspace']): a['name'] for a in agents or [] if a.get('workspace')}.get(workspace(cwd))


def app_row(row, name, connected):
    """An app's chat seat, named by its agent as OpenBot's Claude and Codex seats are (seats.apply)."""
    row.update(chat=True, chat_name=name, workspace_name=name, project_name=name, connected=connected,
               terminal_match='chat', terminal_note='OpenBot 채팅', location=dict(OPENBOT))
    return row


def build(sessions, agents, devin_running, openbot_running):
    rows = []
    for r in sessions:
        row = {'id': f'devin:{r["id"]}', 'conversation_id': r['id'], 'kind': 'Devin', 'config_dir': '',
               'cwd': r.get('cwd') or '', 'title': r.get('title') or '', 'connected': devin_running, 'runs': [],
               'pids': [], 'pid': None, 'path': None, 'configured_model': r.get('model') or '', 'provider': '',
               'orca_terminal': None, 'input_verified': False, 'terminal_match': 'chat', 'chat': True,
               'terminal_note': 'Devin CLI 세션', 'location': {'app': 'Devin', 'app_path': '', 'terminal': 'Devin CLI', 'match': 'chat'},
               'source': 'Devin local session database and per-response usage reports', 'usage_adapter': 'devin',
               '_registries': [{'status': r.get('status') or 'idle', 'statusUpdatedAt': r.get('status_at') or r.get('updated') or 0,
                                'source': 'devin'}],
               '_transcript': None}
        name = seat(row['cwd'], agents)
        rows.append(app_row(row, name, openbot_running) if name else row)
    return rows
