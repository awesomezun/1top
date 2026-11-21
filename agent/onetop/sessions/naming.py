"""Canonical names; terminal devices and process placeholders are never names."""
import re
from pathlib import PurePath


def usable(value):
    return isinstance(value, str) and bool(value.strip()) and not (
        value.startswith(('/dev/', 'process-', 'cli-')) or '미확인' in value or
        re.fullmatch(r'(?:tty\S*|claude|codex|aside|unknown)', value, re.I))


def apply(rows):
    for row in rows:
        project = PurePath((row.get('cwd') or '').replace('\\', '/')).name
        title = row.get('title') or ''
        terminal = row.get('orca_terminal') or {}
        name = next((v for v in (terminal.get('title'), row.get('chat_name'), title, project) if usable(v)), '')
        # An unnamed CLI has no conversation yet; keep its project fallback explicit.
        row['display_name'] = name or '새 대화'
        detail = []
        # An app seat named by its app: the app's own name and an agent's workspace folder add nothing.
        app = (row.get('location') or {}).get('app') if row.get('terminal_match') == 'chat' else ''
        redundant = {name, app, f'{app} · {name}'} if app else {name}
        for value in (title if usable(title) and title not in redundant else '',
                      '' if row.get('workspace_name') else project):
            if value and value not in detail:
                detail.append(value)
        terminals = {run.get('terminal_key') for run in row['runs'] if run.get('terminal_key')}
        if len(terminals) > 1:
            detail.append(f'터미널 {len(terminals)}곳')
        if row.get('terminal_match') == 'chat':
            detail.append(row.get('terminal_note') or 'Orca 채팅')
        if row.get('terminal_match') == 'unavailable' and row.get('kind') != 'Aside':
            detail.append('터미널 연결 확인 안 됨')
        if row.get('identity_conflict'):
            detail.append('연결 확인 안 됨')
        row['display_detail'] = ' · '.join(detail)
        row['project'] = project or '알 수 없음'
    return rows
