"""T5 adapter rows for conversations an app runs on Antigravity's ACP runtime (OpenBot), from that runtime's
own conversation summaries (observe/antigravity.py). The runtime process lives for a turn only, so a
conversation stays listed for a day after its last change while the app runs."""
from .devin import seat, app_row

STATES = {'CASCADE_RUN_STATUS_RUNNING': 'busy', 'CASCADE_RUN_STATUS_IDLE': 'idle'}


def build(conversations, agents, openbot_running):
    rows = []
    for r in conversations:
        name = seat(r.get('cwd'), agents)
        if not name:
            continue  # only an app's agent seats; the app's own one-off checks are not conversations to show
        parent = r.get('parent')
        row = {'id': r['id'], 'conversation_id': r['id'], 'kind': 'Antigravity', 'config_dir': r.get('root') or '',
               'cwd': r.get('cwd') or '', 'title': r.get('title') or '', 'runs': [], 'pids': [], 'pid': None, 'path': None,
               'configured_model': '', 'provider': '', 'orca_terminal': None, 'input_verified': False,
               'source': 'Antigravity ACP conversation summaries and per-response usage reports', 'usage_adapter': 'antigravity',
               'is_subagent': bool(parent), 'parent_session_id': parent or None,
               '_registries': [{'status': STATES.get(r.get('status'), 'idle'), 'statusUpdatedAt': r.get('modified') or 0,
                                'source': 'antigravity'}],
               '_transcript': None}
        rows.append(app_row(row, name, openbot_running))
    return rows
