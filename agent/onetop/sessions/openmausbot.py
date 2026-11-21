"""T5 adapter rows for OpenMausBot threads, from its own usage ledger (observe/openmausbot.py)."""

APP = '/Applications/OpenMausBot.app'


def build(threads, running):
    rows = []
    for r in threads:
        rows.append({'id': f'openmausbot:{r["id"]}', 'conversation_id': r['id'], 'kind': r.get('kind') or 'Claude',
            'config_dir': '', 'cwd': '', 'title': '', 'chat_name': r.get('bot') or '', 'project_name': 'OpenMausBot',
            'connected': running, 'runs': [], 'pids': [], 'pid': None, 'path': None, 'chat': True,
            'configured_model': r.get('model') or '', 'provider': '', 'orca_terminal': None, 'input_verified': False,
            'terminal_match': 'chat', 'terminal_note': 'OpenMausBot 채팅',
            'location': {'app': 'OpenMausBot', 'app_path': APP,
                         'terminal': 'OpenMausBot 채팅', 'match': 'chat'},
            'source': 'OpenMausBot usage ledger', 'usage_adapter': 'openmausbot',
            # The ledger records finished turns only: the last one closed the thread's turn.
            '_registries': [{'status': 'idle', 'statusUpdatedAt': r.get('updated') or 0, 'source': 'openmausbot'}],
            '_transcript': None})
    return rows
