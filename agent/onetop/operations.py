"""Read-only, local operational evidence. Never interpret prompt text as state."""
import json
import re
import shlex
import sqlite3
import time
from pathlib import Path


class OperationalMonitor:
    def __init__(self, home=None):
        self.home = Path(home or Path.home())
        self.cached = None
        self.last = 0
        self.offsets = {}
        self.events = {}
        self.claude_goals = {}

    def goals(self, sessions):
        path = self.home / '.codex/goals_1.sqlite'
        if not path.exists():
            return [], 'unavailable'
        try:
            db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=.2)
            db.row_factory = sqlite3.Row
            try:
                rows = db.execute('SELECT thread_id,goal_id,objective,status,token_budget,tokens_used,time_used_seconds,updated_at_ms FROM thread_goals ORDER BY updated_at_ms DESC LIMIT 100').fetchall()
            finally:
                db.close()
            by_id = {s['id']: s for s in sessions}
            result = []
            for row in rows:
                r = dict(row)
                session = by_id.get(r['thread_id'])
                r.update(session_connected=session is not None,
                         location=location(session) if session else '연결된 세션 없음',
                         runtime='Codex', source='Codex goal database', evidence='reported')
                result.append(r)
            return result, 'reported'
        except (OSError, sqlite3.Error):
            return [], 'unavailable'

    def skills(self, sessions):
        roots = [(self.home / '.agents/skills', 'Shared', 'user'),
                 (self.home / '.codex/skills', 'Codex', 'user'),
                 (self.home / '.claude/skills', 'Claude', 'user')]
        for cwd in sorted({s.get('cwd') for s in sessions if s.get('cwd')}):
            for parent, provider in [('.agents', 'Shared'), ('.codex', 'Codex'), ('.claude', 'Claude')]:
                roots.append((Path(cwd) / parent / 'skills', provider, 'project'))
        # Registry confirms installed plugin roots; an arbitrary cached version does not.
        try:
            registry = json.loads((self.home / '.claude/plugins/installed_plugins.json').read_text())
            for name, installs in registry.get('plugins', {}).items():
                for entry in installs:
                    if entry.get('installPath'):
                        roots.append((Path(entry['installPath']) / 'skills', 'Claude plugin', entry.get('scope', 'plugin')))
        except (OSError, ValueError, TypeError):
            pass
        found = {}
        for root, provider, scope in roots:
            try:
                paths = list(root.glob('*/SKILL.md')) + list(root.glob('.system/*/SKILL.md'))
                if (root / 'SKILL.md').is_file(): paths.append(root / 'SKILL.md')
                for path in paths[:400]:
                    resolved = str(path.resolve())
                    if resolved in found:
                        if provider not in found[resolved]['providers']: found[resolved]['providers'].append(provider)
                        continue
                    # Existence/readability is inventory evidence, not enablement or success.
                    with path.open() as f: header = f.read(8192)
                    name = path.parent.name
                    if header.startswith('---'):
                        for line in header.split('---', 2)[1].splitlines():
                            if line.startswith('name:'): name = line[5:].strip().strip('"\'') or name
                    found[resolved] = dict(name=name[:160], providers=[provider], scope=scope,
                                           path=str(path), state='installed', availability='not_verified')
            except (OSError, ValueError):
                continue
        return sorted(found.values(), key=lambda r: r['name'].lower())[:600]

    def scan(self, s):
        path = s.get('path')
        if not path or s.get('kind') not in ('Claude', 'GLM', 'Codex'): return
        try:
            p = Path(path); stat = p.stat()
            old = self.offsets.get(path)
            # Bound initial history and each update. Partial lines wait until next collection.
            start = old[1] if old and old[0] == stat.st_ino and old[1] <= stat.st_size else max(0, stat.st_size - 512_000)
            with p.open('rb') as f:
                f.seek(start)
                if not old and start: f.readline(); start = f.tell()
                raw = f.read(1_048_576)
            end = raw.rfind(b'\n') + 1
            self.offsets[path] = (stat.st_ino, start + end)
            for line in raw[:end].splitlines():
                try: self.event(json.loads(line), s)
                except (ValueError, TypeError, KeyError, AttributeError): continue
        except OSError:
            pass

    def event(self, value, session):
        if session.get('kind') == 'Codex':
            self.codex_event(value, session)
            return
        base = dict(session_id=session['id'], location=location(session), provider=session['kind'], runtime='Claude Code',
                    observed_at=value.get('timestamp'), source='session tool log')
        attachment = value.get('attachment')
        if value.get('type') == 'attachment' and isinstance(attachment, dict) and attachment.get('type') == 'goal_status':
            condition = attachment.get('condition')
            if isinstance(condition, str) and condition:
                status = 'failed' if attachment.get('failed') else ('cleared' if attachment.get('sentinel') else 'complete') if attachment.get('met') else 'active'
                duration = attachment.get('durationMs')
                self.claude_goals[session['id']] = dict(base, thread_id=session['id'], goal_id=session['id'],
                    objective=condition[:4000], status=status, token_budget=None, tokens_used=attachment.get('tokens'),
                    time_used_seconds=duration / 1000 if isinstance(duration, (int, float)) else None,
                    iterations=attachment.get('iterations'), session_connected=True, evidence='last_observed')
        if value.get('scheduledTaskId') and value.get('scheduledFireId'):
            key = 'fire:' + str(value['scheduledFireId'])
            self.events[key] = dict(base, category='loop', name='Scheduled task', state='fire_observed',
                                    schedule=str(value.get('cron') or '')[:100], job_id=str(value['scheduledTaskId'])[:100],
                                    next_run=None, result='not_verified')
        if value.get('type') == 'system' and value.get('subtype') == 'scheduled_task_fire' and value.get('taskId'):
            key = 'fire:' + str(value.get('uuid') or value['taskId'])
            self.events[key] = dict(base, category='loop', name='Claude Code /loop' if value.get('taskKind') == 'loop' else 'Claude Code scheduled task',
                                    state='fire_observed', schedule=str(value.get('cron') or '')[:100],
                                    job_id=str(value['taskId'])[:100], next_run=None, result='not_verified')
        message = value.get('message')
        if not isinstance(message, dict) or not isinstance(message.get('content'), list): return
        for item in message['content']:
            if not isinstance(item, dict): continue
            if item.get('type') == 'tool_use' and item.get('name') in ('Skill', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup'):
                name = item['name']; inp = item.get('input') or {}
                key = session['id'] + ':' + str(item.get('id'))
                self.events[key] = dict(base, category='skill' if name == 'Skill' else 'loop',
                                        name=str(inp.get('skill') or name)[:160], state='invoked',
                                        schedule=str(inp.get('cron') or '')[:100], job_id=str(inp.get('id') or '')[:100],
                                        next_run=None, result='not_verified')
            elif item.get('type') == 'tool_result':
                key = session['id'] + ':' + str(item.get('tool_use_id'))
                if key in self.events:
                    self.events[key]['state'] = 'tool_error' if item.get('is_error') else 'tool_returned'
                    # A returned tool call is not evidence that a whole skill/loop worked.

    def codex_event(self, value, session):
        if value.get('type') != 'response_item': return
        payload = value.get('payload') or {}
        kind = payload.get('type'); call = str(payload.get('call_id') or '')
        if not call: return
        key = session['id'] + ':' + call
        if kind in ('function_call_output', 'custom_tool_call_output'):
            if key in self.events: self.events[key]['state'] = 'tool_returned'
            return
        if kind not in ('function_call', 'custom_tool_call'): return
        name = str(payload.get('name') or '')
        raw = payload.get('arguments') or payload.get('input') or ''
        paths = []
        if name.endswith(('exec_command', 'shell_command')):
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
                command = args.get('cmd') or args.get('command') or ''
                parts = shlex.split(command)
                if parts and parts[0] in ('cat', 'sed', 'head', 'tail'):
                    paths = [part for part in parts[1:] if part.endswith('/SKILL.md')]
            except (ValueError, TypeError, AttributeError): return
        elif name.endswith(('read_file', 'read_text')):
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
                path = args.get('path') or args.get('file_path') or ''
                if path.endswith('/SKILL.md'): paths = [path]
            except (ValueError, TypeError, AttributeError): return
        elif 'skills' in name and name.endswith(('read', 'read_skill')):
            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
                paths = [str(args.get('resource') or args.get('uri') or args.get('name') or 'Skill')]
            except (ValueError, TypeError, AttributeError): return
        if not paths: return
        self.events[key] = dict(session_id=session['id'], location=location(session), provider='Codex', runtime='Codex',
            observed_at=value.get('timestamp'), source='session tool log', category='skill',
            name=', '.join(Path(p).parent.name if p.endswith('/SKILL.md') else p for p in paths)[:160],
            state='read_requested', result='not_verified', next_run=None)

    def schedules(self, sessions):
        # Persistent jobs are a subset. Session-only /loop jobs are not in this file.
        roots = {self.home / '.claude'}
        for session in sessions:
            if session.get('kind') not in ('Claude', 'GLM'): continue
            path = Path(session.get('path') or '')
            for parent in path.parents:
                if parent.name == 'projects': roots.add(parent.parent); break
        result = []
        for root in sorted(roots):
            path = root / 'scheduled_tasks.json'
            try:
                if path.stat().st_size > 1_048_576: continue
                content = json.loads(path.read_text())
                tasks = content.get('tasks', [])
                if not isinstance(tasks, list): continue
                for task in tasks[:300]:
                    if not isinstance(task, dict) or not isinstance(task.get('id'), str) or not isinstance(task.get('cron'), str): continue
                    session = next((s for s in sessions if s['id'] == task.get('createdBySessionId')), None)
                    result.append(dict(job_id=task['id'][:100], schedule=task['cron'][:100],
                        name='Claude Code scheduled task', state='stored', source='persistent schedule file',
                        recurring=task.get('recurring') is True, last_fired_at=task.get('lastFiredAt'),
                        session_connected=session is not None, location=location(session) if session else '세션 연결 미확인',
                        next_run=None, result='not_verified'))
            except (OSError, ValueError, TypeError): continue
        return result[:300]

    def sample(self, sessions):
        if self.cached is not None and time.monotonic() - self.last < 10: return self.cached
        goals, goal_status = self.goals(sessions)
        for session in sessions[:100]: self.scan(session)
        connected = {s['id'] for s in sessions}
        for goal in self.claude_goals.values(): goal['session_connected'] = goal['thread_id'] in connected
        goals.extend(self.claude_goals.values())
        self.events = dict(list(self.events.items())[-300:])
        self.cached = dict(updated=time.time(), goals=goals, goal_source_status=goal_status,
                           skills=self.skills(sessions), events=list(reversed(list(self.events.values()))),
                           schedules=self.schedules(sessions), loop_state='persistent_subset', skill_runtime='partial',
                           claude_goal_source_status='partial_log',
                           history_scope='Recent observed tool logs and persistent schedules; not complete history')
        self.last = time.monotonic()
        return self.cached


def location(session):
    return (session.get('orca_terminal') or {}).get('title') or (session.get('location') or {}).get('app') or session.get('project') or '위치 미확인'
