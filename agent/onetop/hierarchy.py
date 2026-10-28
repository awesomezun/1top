"""Explicit session ancestry and non-destructive, per-thread usage grouping."""
import collections
import copy
import json
import math
import re

_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$')


def _identifier(value):
    return value if isinstance(value, str) and _ID.fullmatch(value) else None


def codex_metadata(path, expected_id=None):
    """Read only the bounded metadata header, never export instruction contents."""
    try:
        with open(path, 'rb') as stream:
            line = stream.readline(2 * 1024 * 1024)
        if not line.endswith(b'\n'):
            return {}
        row = json.loads(line)
        if row.get('type') != 'session_meta':
            return {}
        payload = row.get('payload') or {}
        if expected_id and payload.get('id') != expected_id:
            return {}
        source = payload.get('source')
        subagent = source.get('subagent') if isinstance(source, dict) else None
        if not isinstance(subagent, dict):
            return {'is_subagent': False}
        spawn = subagent.get('thread_spawn') or {}
        if not isinstance(spawn, dict):
            return {'is_subagent': True}
        parent = _identifier(spawn.get('parent_thread_id') or payload.get('parent_thread_id'))
        explicit = _identifier(payload.get('parent_thread_id'))
        if explicit and parent != explicit:
            parent = None
        depth = spawn.get('depth')
        agent_path = spawn.get('agent_path')
        return {'is_subagent': True, 'parent_session_id': parent,
                'agent_depth': depth if isinstance(depth, int) and not isinstance(depth, bool) and depth > 0 else None,
                'agent_path': agent_path[:200] if isinstance(agent_path, str) else None}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def annotate(specs):
    """Resolve only recorded parent IDs. Inherited host identity grants no controls."""
    by_id = {s['id']: s for s in specs}
    children = collections.defaultdict(list)
    for s in specs:
        s.setdefault('is_subagent', False)
        s.setdefault('parent_session_id', None)
        if s['is_subagent']:
            parent = s.get('parent_session_id')
            if parent in by_id and by_id[parent].get('kind') == s.get('kind') and parent != s['id']:
                children[parent].append(s['id'])
            # Shared CLI/backend identities cannot safely address a child thread.
            s['pids'] = []
            s['input_verified'] = False
            s.pop('control_key', None)
            s.pop('process_started', None)
            s.pop('process_birth', None)
    for s in specs:
        seen = {s['id']}; current = s; ancestors = []; complete = True
        while current.get('is_subagent'):
            parent = by_id.get(current.get('parent_session_id'))
            if not parent or parent['id'] in seen or parent.get('kind') != s.get('kind'):
                complete = False
                break
            seen.add(parent['id']); ancestors.append(parent); current = parent
        s['root_session_id'] = current['id'] if complete else None
        s['child_session_ids'] = children[s['id']]
        if not s['is_subagent']:
            continue
        # Never keep a guessed/old child terminal, including on incomplete chains.
        s['orca_terminal'] = None
        s['location'] = {'app': 'Unknown', 'terminal': '', 'match': 'unverified'}
        s['terminal_match'] = 'unverified'
        s['terminal_note'] = '하위 에이전트 · 부모 세션의 실행 위치 확인 필요'
        for parent in ancestors if complete else []:
            location = parent.get('location') or {}
            confirmed_terminal = parent.get('orca_terminal') if parent.get('terminal_match') == 'confirmed' else None
            known_app = location.get('app') not in (None, '', 'Unknown') and location.get('match') != 'unverified'
            if not confirmed_terminal and not known_app:
                continue
            s['location'] = {**location, 'match': 'parent_session'}
            if confirmed_terminal:
                s['orca_terminal'] = dict(confirmed_terminal)
                s['location']['app'] = 'Orca'
            s['terminal_match'] = 'parent_session'
            s['location_parent_id'] = parent['id']
            s['terminal_note'] = '명시된 부모 세션에서 확인한 실행 위치 · 하위 에이전트 직접 제어 불가'
            break
    return specs


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def _vector(value):
    return isinstance(value, list) and len(value) == 4 and all(_number(v) for v in value)


def _sum_vectors(values):
    known = [v for v in values if _vector(v)]
    return [sum(v[i] for v in known) for i in range(4)] if known else None


def group_sessions(sessions):
    """Keep raw rows intact; add one display row for each confirmed session tree.

    Codex reports thread-local cumulative counters; every descendant contributes
    once. Unknown parent chains remain separate rather than merging by directory.
    Control identity, status and resources remain the actual root's values.
    """
    by_id = {s['id']: s for s in sessions}
    members = collections.defaultdict(list)
    for s in by_id.values():
        root = s.get('root_session_id')
        members[root if root in by_id else s['id']].append(s)
    result = []
    for root_id, rows in members.items():
        root = by_id[root_id]
        group = copy.deepcopy(root)
        descendants = [s for s in rows if s['id'] != root_id]
        group.update(children_ids=[s['id'] for s in descendants], children_count=len(descendants),
                     children_working=sum(s.get('display_status', s.get('status')) == 'working' for s in descendants),
                     group_usage_partial=any(not _vector(s.get('tokens')) for s in rows))
        if not descendants:
            result.append(group)
            continue
        group['tokens'] = _sum_vectors([s.get('tokens') for s in rows])
        group['last_usage'] = max((s.get('last_usage') or 0 for s in rows), default=0)
        usage = group.setdefault('usage', {})
        for key in ('last_minute', 'last_five_minutes'):
            usage[key] = _sum_vectors([(s.get('usage') or {}).get(key) for s in rows])
        for key in ('rate', 'output_rate'):
            values = [(s.get('usage') or {}).get(key) for s in rows]
            known = [v for v in values if _number(v)]
            usage[key] = sum(known) if known else None
        windows = set().union(*((s.get('usage') or {}).get('windows', {}) for s in rows))
        usage['windows'] = {key: _sum_vectors([(s.get('usage') or {}).get('windows', {}).get(key) for s in rows]) for key in windows}
        history = collections.Counter()
        for s in rows:
            for entry in (s.get('usage') or {}).get('history', []):
                if len(entry) == 2 and all(_number(v) for v in entry):
                    history[entry[0]] += entry[1]
        usage['history'] = [[t, value] for t, value in sorted(history.items())]
        accounts = {(s.get('usage') or {}).get('weekly_account') for s in rows}
        account = next(iter(accounts)) if len(accounts) == 1 else None
        usage['weekly_account'] = account
        usage['weekly_estimate'] = {}
        for key in windows:
            if not account:
                continue
            estimates = []; complete = True
            for s in rows:
                u = s.get('usage') or {}; value = u.get('windows', {}).get(key)
                if not _vector(value):
                    complete = False; break
                if sum(value) == 0:
                    continue
                estimate = u.get('weekly_estimate', {}).get(key)
                if (not estimate or estimate.get('account_id') != account or
                        estimate.get('basis') != 'calibrated_token_equivalent' or
                        not _number(estimate.get('used_pp')) or not _number(estimate.get('tokens'))):
                    complete = False; break
                estimates.append(estimate)
            if complete and estimates and all(e.get('calibration') == estimates[0].get('calibration') for e in estimates):
                combined = copy.deepcopy(estimates[0])
                combined.update(used_pp=round(sum(e['used_pp'] for e in estimates), 4),
                                tokens=sum(e['tokens'] for e in estimates),
                                partial=any(e.get('partial', False) for e in estimates))
                usage['weekly_estimate'][key] = combined
        result.append(group)
    return result
