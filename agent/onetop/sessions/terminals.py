"""T1–T3: bind terminal identity only after conversation identity is resolved."""
import re
import time
from pathlib import Path
from ..discovery import context
from ..controls import target_key

def terminal_for(meta, terminals):
    """Join a process to a live Orca tab by identity, never by its directory."""
    for field, key in [('orca_handle','handle'),('orca_tab','tabId')]:
        matches=[t for t in terminals if meta.get(field) and t.get(key)==meta[field]]
        if len(matches)==1:
            t=matches[0]
            return {k:t.get(k) for k in ('handle','tabId','leafId','title','worktreePath','incarnationId')}
    return None


def chat_label(location, env):
    """T4/T5: where a terminal-less seat lives — Orca's chat, or the app that hosts it."""
    if env.get('ORCA_STRUCTURED_SESSION') == '1':
        return 'Orca 채팅'
    app = location.get('app') if location.get('match') == 'process_ancestry' else ''
    return f'{app} 채팅' if app else '앱 채팅'


def pane_thread_name(title, cwd):
    suffix=' | '+Path(cwd).name
    if not title.endswith(suffix):return None
    name=title[:-len(suffix)]
    # Codex decorates the stable thread name with a Braille activity spinner.
    name = re.sub(r'^[\u2800-\u28ff]\s+', '', name)
    # Codex adds this exact attention prefix while the stable thread name stays
    # unchanged. Strip the decoration, not an arbitrary pipe-delimited prefix.
    return re.sub(r'^\[\s*[.!]\s*\] Action Required \| ', '', name)


def bind_terminal(spec, metadata, terminals, pane_titles, specs):
    if spec.get('is_subagent'):
        spec.update(pids=[], orca_terminal=None, terminal_match='unverified',
                    terminal_note='하위 에이전트 · 부모 세션의 실행 위치에서 확인')
        return
    pids=spec['pids']
    source='프로세스의 Orca 터미널 ID'
    if spec['kind']=='Codex' and not spec.get('process_only'):
        name=spec.get('thread_name')
        unique=name and sum(s.get('thread_name')==name and s['cwd']==spec['cwd']
                            for s in specs if s['kind']=='Codex')==1
        matches=[pid for pid in pids if unique and
                 pane_thread_name(pane_titles.get(metadata.get(pid,{}).get('tmux_pane'),''),spec['cwd'])==name]
        # A shared backend's environment belongs to only one of its clients.
        # Never attach that terminal to every thread, or pick a same-directory client.
        if len(matches)!=1:
            spec.update(orca_terminal=None,terminal_match='unverified',
                        terminal_note='세션과 터미널 화면 제목의 고유한 일치를 확인하지 못했습니다.')
            return
        pids=matches
        source='Codex 세션명·프로젝트와 터미널 화면 제목의 고유한 일치 → Orca 터미널 ID'
        spec['pids']=matches
    meta=metadata.get(spec.get('terminal_owner_pid', pids[0]),{}) if len(pids)==1 else {}
    terminal=terminal_for(meta,terminals)
    spec.update(orca_terminal=terminal,terminal_match='confirmed' if terminal else 'unavailable',
                terminal_note=source if terminal else '프로세스는 실행 중이지만 현재 Orca 탭 목록에서 연결을 확인하지 못했습니다.')


def apply(rows, record):
    from .identity import process_rows
    processes = process_rows(record)
    inventory = {pid: {**p, 'app': p.get('app', ('', ''))} for pid, p in processes.items()}
    terminals = record.get('orca_terminals') or []
    registry = record.get('claude_registry', {})
    for row in rows:
        owners = [r for r in row['runs'] if r.get('owns_terminal')]
        for run in row['runs']:
            process = processes[run['pid']]
            env = process.get('env') or {}
            blocked = False
            if not run['owns_terminal']:
                parent, seen = process.get('ppid'), set()
                while parent in processes and parent not in seen:
                    seen.add(parent)
                    other = registry.get(str(parent), {}).get('sessionId')
                    if other and other != row['conversation_id']:
                        blocked = True; break
                    parent = processes[parent].get('ppid')
            term = None if blocked or row.get('is_subagent') else terminal_for(
                {'orca_handle': env.get('ORCA_TERMINAL_HANDLE'), 'orca_tab': env.get('ORCA_TAB_ID')}, terminals)
            # Owned background runs use the owner's tab, never inherited daemon metadata.
            if owners and not run['owns_terminal']:
                term = None
            run['terminal'] = term
            run['terminal_match'] = 'confirmed' if term else 'unavailable'
            run['terminal_key'] = (term or {}).get('handle') or (
                f'tty:{run["tty"]}' if run['owns_terminal'] and run.get('tty') not in ('', '??', '?', None) else None)
            run['location'] = context(run['pid'], inventory)
            if run.get('role') == 'chat':  # T4, T5
                run['location'] = {**run['location'], 'terminal': chat_label(run['location'], env), 'match': 'chat'}
            if not run['owns_terminal'] and not term:
                run['location'] = {'app': 'Background process', 'terminal': '백그라운드', 'match': 'background'}
        visible = owners or row['runs']
        primary = next((r for r in visible if r.get('terminal')), next(iter(visible), {}))
        row['orca_terminal'] = primary.get('terminal')
        row['terminal_match'] = 'confirmed' if row['orca_terminal'] else 'unavailable'
        row['location'] = primary.get('location', {'app':'Unknown','terminal':'','match':'unverified'})
        row['terminal_note'] = '실행의 Orca 터미널 ID' if row['orca_terminal'] else '터미널 연결 확인 안 됨'
        row['chat'] = any(r.get('role') == 'chat' for r in visible)
        # T5: a conversation only an app's shared backend holds (OpenBot's Codex app-server) is that
        # app's chat. A backend with a terminal belongs to a CLI and stays unconfirmed.
        holder = next(iter(row.get('_holders') or []), None)
        if not row['runs'] and not row.get('is_subagent') and holder in processes \
                and processes[holder].get('tty') in ('', '?', '??', None):
            where = context(holder, inventory)
            if where.get('match') == 'process_ancestry':
                row['location'] = {**where, 'terminal': chat_label(where, {}), 'match': 'chat'}
                row['chat'] = True
        if row['chat'] and not row['orca_terminal']:
            label = next((r['location']['terminal'] for r in visible if r.get('role') == 'chat'), None)
            row['terminal_match'], row['terminal_note'] = 'chat', label or row['location'].get('terminal') or 'Orca 채팅'
        if primary and primary['pid'] != primary['active_pid']:
            row['terminal_owner_pid'] = primary['pid']
        row['input_verified'] = False
        targets = row['pids']
        if len(targets) == 1 and not row.get('is_subagent') and not row.get('identity_conflict') and not row.get('shape_unknown') and not row['chat']:
            p = processes[targets[0]]
            row['process_birth'] = p['birth']
            row['process_started'] = p.get('started') or time.strftime('%a %b %d %H:%M:%S %Y', time.localtime(p['birth']))
            row['control_key'] = target_key(row)
            row['continuation_processes'] = [r['pid'] for r in row['runs'] if r['pid'] not in targets]
            row['continuation_keys'] = [target_key({**row, 'id':registry.get(str(pid),{}).get('sessionId',row['id']), 'pids':[pid], 'process_birth':processes[pid]['birth'],
                'process_started':processes[pid].get('started') or time.strftime('%a %b %d %H:%M:%S %Y', time.localtime(processes[pid]['birth']))})
                for pid in row['continuation_processes']]
            row['input_verified'] = bool(row['orca_terminal'] and len(visible) == 1 and primary.get('tty') not in ('', '?', '??', None))
    handles = {}
    for row in rows:
        for run in row['runs']:
            if run.get('terminal'):
                handles.setdefault(run['terminal']['handle'], set()).add(row['id'])
    for row in rows:
        term = row.get('orca_terminal')
        if term and len(handles[term['handle']]) > 1:
            row['input_verified'] = False
    return rows

