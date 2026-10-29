"""Explicit session correspondence; never export a general conversation transcript."""
import json
import os
import re
import threading
import time
from pathlib import Path
from datetime import datetime
from .message_images import public_images, image_prompt

ID = re.compile(r'^[a-f0-9-]{36}$')
REPLY = re.compile(r'\[1top-reply:([a-f0-9-]{36})\]([\s\S]*?)\[/1top-reply\]')
MAX_REPLY = 8000


def readable(spec):
    return bool(spec.get('path') and spec.get('kind') in ('Claude', 'GLM', 'Codex', 'Aside'))


def assistant_text(record, kind):
    """Only visible assistant text, excluding reasoning, tool output and user content."""
    if kind == 'Codex':
        if record.get('type') != 'response_item':
            return ''
        message = record.get('payload') or {}
        if message.get('type') != 'message' or message.get('channel') == 'analysis':
            return ''
    elif kind == 'Aside':
        message = record
    else:
        if record.get('type') != 'assistant':
            return ''
        message = record.get('message') or {}
    if message.get('role') != 'assistant':
        return ''
    content = message.get('content')
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    return '\n'.join(block['text'] for block in content if isinstance(block, dict)
                     and block.get('type') in ('text', 'output_text')
                     and isinstance(block.get('text'), str))


def track_activity(row, record, kind):
    """Only phase/timestamp, scoped to this request's visible user marker.

    Never store or export reasoning, tool arguments/results, or ordinary text.
    """
    try:
        stamp = record.get('timestamp', record.get('createdAt'))
        stamp = datetime.fromisoformat(stamp.replace('Z','+00:00')).timestamp() if isinstance(stamp,str) else float(stamp)
        if not row.get('started_at') or stamp < row['started_at']-1 or stamp > time.time()+60:return
        if stamp < row.get('_activity_at',0):return
    except (TypeError,ValueError):return
    message = record.get('payload') if kind=='Codex' else record if kind=='Aside' else record.get('message')
    message = message if isinstance(message,dict) else {}
    content = message.get('content')
    text = content if isinstance(content,str) else '\n'.join(b.get('text','') for b in content if isinstance(b,dict) and b.get('type') in ('text','input_text') and isinstance(b.get('text'),str)) if isinstance(content,list) else ''
    is_user = record.get('type')=='user' or message.get('role')=='user'
    if kind=='Codex' and record.get('type')=='event_msg' and message.get('type')=='user_message':
        is_user=True;text=message.get('message') if isinstance(message.get('message'),str) else ''
    if is_user and text:
        if f'[1top-reply:{row["id"]}]' in text:
            row.update(_activity_seen=True,_activity_done=False,_activity_at=stamp)
        elif row.get('_activity_seen'):
            row.update(_activity_done=True,activity=None,_activity_at=stamp)
        return
    if not row.get('_activity_seen') or row.get('_activity_done'):return
    phase = None
    if record.get('type')=='api-request' or kind=='Codex' and message.get('type')=='task_started':phase='responding'
    elif record.get('type')=='assistant' or kind=='Aside' and message.get('role')=='assistant':
        blocks = content if isinstance(content,list) else []
        if any(isinstance(b,dict) and b.get('type')=='tool_use' for b in blocks):phase='working'
        elif assistant_text(record,kind):phase='writing'
    elif kind=='Codex' and record.get('type')=='response_item':
        if message.get('type') in ('function_call','custom_tool_call','local_shell_call'):phase='working'
        elif assistant_text(record,kind):phase='writing'
    if record.get('type')=='system' and record.get('subtype')=='turn_duration' or kind=='Codex' and message.get('type') in ('task_complete','turn_complete','turn_aborted'):
        row.update(_activity_done=True,activity=None,_activity_at=stamp)
    elif phase:
        row.update(activity={'phase':phase,'observed_at':stamp},_activity_at=stamp)


class Mailbox:
    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.lock = threading.RLock()
        try:
            self.records = json.loads(self.path.read_text()) if self.path else []
            if not isinstance(self.records, list):
                self.records = []
        except (OSError, ValueError):
            self.records = []

    def save(self):
        self.records = self.records[-200:]
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = self.path.with_suffix('.tmp')
        with os.fdopen(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as f:
            json.dump(self.records, f, ensure_ascii=False)
        tmp.replace(self.path)

    def begin(self, spec, rid, text, images=()):
        if not ID.fullmatch(rid) or not readable(spec):
            raise ValueError('This session has no verified reply reader.')
        with self.lock:
            previous = next((r for r in self.records if r['id'] == rid), None)
            if previous and (previous['status'] != 'queued' or previous['text'] != text or previous['session_id'] != spec['id']):
                raise ValueError('Message ID already used; check the existing message.')
            path = Path(spec['path'])
            stat = path.stat()
            if not path.is_file():
                raise ValueError('Session reply source is unavailable.')
            row = {'id': rid, 'session_id': spec['id'], 'text': text,
                                 'created': previous['created'] if previous else time.time(), 'status': 'sending', 'reply': '',
                                 'path': str(path), 'inode': stat.st_ino, 'offset': stat.st_size,
                                 'kind': spec['kind'], 'attachments':public_images(images), 'started_at':time.time()}
            if previous:
                previous.update(row)
            else:
                self.records.append(row)
            self.save()
        # Terminal transports have no separate instruction channel. Keep only the
        # reply format needed to correlate this answer; do not append task policy.
        return f'{image_prompt(text,images)}\n\n1top reply: [1top-reply:{rid}]...[/1top-reply]'

    def enqueue(self, spec, rid, text, images=()):
        with self.lock:
            if any(r['id'] == rid for r in self.records):
                raise ValueError('Message ID already used.')
            self.records.append({'id':rid,'session_id':spec['id'],'control_key':spec['control_key'],
                                 'text':text,'created':time.time(),'status':'queued','reply':'',
                                 'attachments':public_images(images)})
            self.save()

    def queued(self):
        with self.lock:
            return [dict(r) for r in self.records if r['status'] == 'queued']

    def delivery(self, rid, status):
        with self.lock:
            row = next((r for r in self.records if r['id'] == rid), None)
            if row and row['status'] != 'replied':
                row['status'] = status
                self.save()

    def read(self, spec):
        with self.lock:
            rows = [r for r in self.records if r['session_id'] == spec['id']][-10:]
            changed = False
            for row in rows:
                if row['status'] in ('replied', 'queued', 'not_delivered') or not row.get('path'):
                    continue
                paths = [source.get('path') for source in spec.get('continuation_sources', [])]
                if row['path'] in paths and spec.get('path') in paths:
                    readers = row.setdefault('continuation_readers', [])
                    known = {row['path'], *(r['path'] for r in readers)}
                    for source in paths[:17]:
                        if source and source not in known:
                            try:
                                stat = Path(source).stat()
                                readers.append({'path': source, 'inode': stat.st_ino, 'offset': 0})
                                known.add(source); changed = True
                            except OSError:
                                pass
                for cursor in [row, *row.get('continuation_readers', [])]:
                    try:
                        path = Path(cursor['path']); stat = path.stat()
                        if stat.st_ino != cursor['inode'] or stat.st_size < cursor['offset']:
                            if row['status'] != 'source_changed':
                                row['status'] = 'source_changed'; changed = True
                            continue
                        with path.open('rb') as f:
                            f.seek(cursor['offset'])
                            data = f.read(4 * 1024 * 1024)
                        complete = data.rfind(b'\n') + 1
                        if not complete:
                            if len(data)==4*1024*1024:
                                cursor['offset']+=len(data);changed=True
                            continue
                        for line in data[:complete].splitlines():
                            try:
                                record = json.loads(line)
                                visible = assistant_text(record, row['kind'])
                                track_activity(row,record,row['kind'])
                            except (ValueError, TypeError, AttributeError):
                                continue
                            for match in REPLY.finditer(visible):
                                if match[1] == row['id'] and match[2].strip():
                                    row.update(reply=match[2].strip()[:MAX_REPLY], status='replied',
                                               reply_at=time.time(), truncated=len(match[2].strip()) > MAX_REPLY)
                        cursor['offset'] += complete
                        changed = True
                    except OSError:
                        continue
                    if row['status'] == 'replied':
                        break
            if changed:
                self.save()
            return [{**{k: row[k] for k in ('id', 'text', 'created', 'status', 'reply', 'reply_at', 'truncated', 'attachments') if k in row},
                     'activity':row.get('activity') if row['status']=='awaiting_reply' and spec.get('status')=='working' and not row.get('_activity_done') else None} for row in rows]
