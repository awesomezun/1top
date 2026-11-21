"""R1–R6: conversation identity, independent of process ancestry and UI state."""
import collections
import hashlib
from datetime import datetime, timezone
from pathlib import PurePath
from ..observe.processes import describe


def verified(reg, process):
    if not reg or reg.get('pid') != process['pid'] or not reg.get('sessionId'):
        return False
    try:
        birth = datetime.strptime(reg['procStart'], '%a %b %d %H:%M:%S %Y').replace(tzinfo=timezone.utc).timestamp()
        return abs(birth - process['birth']) < 1.1
    except (KeyError, TypeError, ValueError):
        return False


def process_rows(record):
    result = {}
    for original in record.get('processes', []):
        row = dict(original)
        row.update(describe(row))
        result[row['pid']] = row
    return result


def resolve(record):
    processes = process_rows(record)
    registries = record.get('claude_registry', {})
    valid = {pid: registries[str(pid)] for pid, p in processes.items()
             if str(pid) in registries and verified(registries[str(pid)], p)}
    for pid, reg in valid.items():
        if reg.get('kind') == 'bg':
            processes[pid]['role'] = 'background'
    # R7: Antigravity's own conversation and state, in the registry's shape.
    antigravity = {a['pid']: {'pid': a['pid'], 'sessionId': a['session_id'], 'name': a.get('title', ''),
        'status': {'CASCADE_RUN_STATUS_RUNNING': 'busy', 'CASCADE_RUN_STATUS_IDLE': 'idle'}.get(a.get('status')),
        'statusUpdatedAt': a.get('modified', 0), 'source': 'antigravity'}
        for a in record.get('antigravity_sessions', []) if a.get('pid') in processes}
    profiles = {pid: p.get('config_dir') or (p.get('env') or {}).get('CLAUDE_CONFIG_DIR') or '~/.claude'
                for pid, p in processes.items()}
    jobs = collections.defaultdict(list)
    for pid, reg in valid.items():
        if reg.get('kind') == 'bg' and reg.get('jobId'):
            jobs[(profiles[pid], reg['jobId'])].append(pid)
    links, conflicts = {}, set()
    for pid, reg in valid.items():
        candidates = jobs.get((profiles[pid], reg.get('parkedJobId')), [])
        if len(candidates) > 1:
            conflicts.update([pid, *candidates])
        elif len(candidates) == 1:
            job = candidates[0]
            if job != pid and reg.get('cwd') and reg.get('cwd') == valid[job].get('cwd'):
                links[pid] = job
    # Cycles and conflicting owners never choose an arbitrary control target.
    for pid in list(links):
        seen, p = set(), pid
        while p in links and p not in seen:
            seen.add(p); p = links[p]
        if p in seen:
            conflicts.update(seen)
    links = {p: j for p, j in links.items() if p not in conflicts and j not in conflicts}
    groups = {}

    def add(kind, profile, sid, process, reg, transcript=None, **extra):
        key = (kind, profile, sid)
        row = groups.setdefault(key, {'id': sid, 'conversation_id': sid, 'kind': kind, 'config_dir': profile,
            'cwd': reg.get('cwd') or process.get('cwd', ''), 'title': reg.get('name', ''),
            'path': (transcript or {}).get('path'), 'configured_model': process.get('configured_model', ''),
            'provider': process.get('provider', ''), 'connected': False, 'runs': [], 'pids': [],
            'pid': None, 'cpu': None, 'rss': None, 'status': 'unknown', 'status_at': 0,
            '_registries': [], '_transcript': transcript, '_identity': key,
            'source': '세션 관찰 기록', **extra})
        return row

    for pid, p in processes.items():
        kind = p.get('kind')
        if kind not in ('Claude', 'GLM', 'Antigravity') or p['role'] == 'helper':
            continue
        reg = valid.get(pid) or antigravity.get(pid, {})
        if p['role'] == 'background' and not reg:
            continue  # a spare is not a conversation
        chain, end = [pid], pid
        while end in links:
            end = links[end]; chain.append(end)
        target = valid.get(end, reg)
        seat = (p.get('env') or {}).get('ORCA_AGENT_SESSION_ID') if p['role'] == 'chat' else None
        sid = target.get('sessionId') or seat or f'process-{pid}-{p.get("birth", 0)}'
        root = profiles[pid]
        transcripts = record.get('claude_transcripts', {})
        transcript = transcripts.get(root + ':' + sid, transcripts.get(sid))
        row = add(kind, root, sid, processes[end], target, transcript)
        if not reg:
            row['process_only'] = True
            # R7: an Antigravity process holding no conversation lock has not begun one.
            if kind == 'Antigravity' and p['role'] != 'chat' and 'antigravity_sessions' in record:
                row['_registries'].append({'status': 'idle', 'statusUpdatedAt': p.get('birth', 0), 'source': 'antigravity'})
        row['identity_conflict'] = row.get('identity_conflict', False) or pid in conflicts
        row['shape_unknown'] = row.get('shape_unknown', False) or p['role'] == 'shape_unknown'
        if pid in links:
            row.setdefault('continuation_sources', [])
            for member in chain:
                msid = valid[member]['sessionId']
                mt = transcripts.get(root + ':' + msid, transcripts.get(msid)) or {}
                source = {'session_id': msid, 'path': mt.get('path')}
                if source not in row['continuation_sources']:
                    row['continuation_sources'].append(source)
        row['connected'] = True
        row['runs'].append({'pid': pid, 'birth': p.get('birth'), 'tty': p.get('tty', ''),
            'role': p['role'], 'connected': True, '_registry': reg,
            'conversation_id': reg.get('sessionId'), 'active_pid': end,
            'owns_terminal': p['role'] != 'background', 'shape_unknown': p['role'] == 'shape_unknown'})
        if pid not in links and reg:
            row['_registries'].append(reg)
        row['waiting_for'] = target.get('waitingFor')

    # Codex files identify conversations; one shared backend can hold many files.
    matched = set()
    for log in record.get('codex_logs', []):
        sid = log.get('session_id') or log['id']
        profile = log.get('profile', '~/.codex')
        holders = [pid for pid in log.get('holders', []) if pid in processes]
        p = processes.get(next(iter(holders), 0), {})
        row = add('Codex', profile, sid, p, {'cwd': log.get('cwd', ''), 'name': log.get('name') or log.get('title', '')}, log,
                  thread_name=log.get('name'), is_subagent=log.get('is_subagent', False),
                  parent_session_id=log.get('parent_session_id'), agent_depth=log.get('agent_depth'),
                  agent_path=log.get('agent_path'))
        row['configured_model'] = log.get('model') or ''
        row['connected'] = bool(holders)
        row['_holders'] = holders
        row['pid'] = holders[0] if holders else None
        # CLI attachment is by an exact explicit session or a unique pane title,
        # never a shared backend's inherited environment or cwd alone.
        from .terminals import pane_thread_name
        candidates = []
        for pid, proc in processes.items():
            if proc.get('kind') != 'Codex' or proc['role'] == 'helper':
                continue
            pane = (proc.get('env') or {}).get('TMUX_PANE')
            exact_name = log.get('name') and proc.get('cwd') == log.get('cwd') and pane_thread_name(
                record.get('tmux_panes', {}).get(pane, ''), log.get('cwd', '')) == log['name']
            unique = sum(other.get('name') == log.get('name') and other.get('cwd') == log.get('cwd')
                         for other in record.get('codex_logs', [])) == 1
            if proc.get('explicit_session') == sid or exact_name and unique or (pid in holders and len(
                    [other for other in record.get('codex_logs', []) if pid in other.get('holders', [])]) == 1):
                candidates.append(proc)
        for proc in candidates if not row.get('is_subagent') else []:
            pid = proc['pid']; matched.add(pid)
            row['runs'].append({'pid': pid, 'birth': proc.get('birth'), 'tty': proc.get('tty', ''),
                'role': proc['role'], 'connected': True, 'active_pid': pid, 'owns_terminal': True})

    for pid, p in processes.items():
        if not p.get('kind') or p['kind'] in ('Claude', 'GLM', 'Antigravity', 'Aside') or pid in matched or p['role'] == 'helper':
            continue
        # Do not create a second generic row for an AI child of an identified CLI.
        parent, seen = p.get('ppid'), set()
        while parent in processes and parent not in seen and not processes[parent].get('kind'):
            seen.add(parent); parent = processes[parent].get('ppid')
        if parent in processes and processes[parent].get('kind'):
            continue
        row = add(p['kind'], p.get('config_dir', ''), f'cli-{pid}-{p.get("birth",0)}', p, {}, process_only=True)
        row['connected'] = True
        row['runs'] = [{'pid': pid, 'birth': p.get('birth'), 'tty': p.get('tty', ''), 'role': p['role'],
                        'connected': True, 'active_pid': pid, 'owns_terminal': True}]

    # Keep common, globally unique native IDs stable; namespace only collisions.
    collisions = collections.Counter(row['id'] for row in groups.values())
    rows = list(groups.values())
    for row in rows:
        if collisions[row['id']] > 1:
            suffix = hashlib.sha256('\0'.join(row['_identity']).encode()).hexdigest()[:16]
            row['id'] = f'{row["id"]}:{suffix}'
        row['runs'].sort(key=lambda r: (not r['owns_terminal'], r.get('birth') or 0, r['pid']))
        row['pids'] = sorted({r['active_pid'] for r in row['runs']})
        if row['pids']:
            row['pid'] = row['pids'][0]
        row['active_session_id'] = row['conversation_id']
        if row.get('continuation_sources'):
            row['continuation_sources'].sort(key=lambda s: s['session_id'] == row['conversation_id'])
            row['previous_session_ids'] = [s['session_id'] for s in row['continuation_sources'] if s['session_id'] != row['conversation_id']]
    # Parent ids have the same provider/profile scope as the child.
    by_native = {r['_identity']: r['id'] for r in rows}
    for row in rows:
        parent = row.get('parent_session_id')
        if parent:
            row['parent_session_id'] = by_native.get((*row['_identity'][:2], parent), parent)
    return rows
