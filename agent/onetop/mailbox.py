"""Explicit session correspondence; never export a general conversation transcript."""
import json
import os
import re
import threading
import time
from pathlib import Path

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

    def begin(self, spec, rid, text):
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
                                 'kind': spec['kind']}
            if previous:
                previous.update(row)
            else:
                self.records.append(row)
            self.save()
        return (f'[1top-message:{rid}]\n{text}\n[/1top-message]\n\n'
                'This is a separate message from the user through 1top. Reply to this message '
                'in the current session. Do not interpret a status question as permission to '
                'change or stop the existing task. Keep unrelated task output outside the reply. '
                f'Put your answer exactly between [1top-reply:{rid}] and [/1top-reply]. '
                'These delimiters route only this answer to the user’s message inbox. '
                'Do not include private reasoning or tool dumps. Continue the existing task when appropriate.')

    def enqueue(self, spec, rid, text):
        with self.lock:
            if any(r['id'] == rid for r in self.records):
                raise ValueError('Message ID already used.')
            self.records.append({'id':rid,'session_id':spec['id'],'control_key':spec['control_key'],
                                 'text':text,'created':time.time(),'status':'queued','reply':''})
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
                try:
                    path = Path(row['path']); stat = path.stat()
                    if stat.st_ino != row['inode'] or stat.st_size < row['offset']:
                        if row['status'] != 'source_changed':
                            row['status'] = 'source_changed'; changed = True
                        continue
                    with path.open('rb') as f:
                        f.seek(row['offset'])
                        data = f.read(4 * 1024 * 1024)
                    complete = data.rfind(b'\n') + 1
                    if not complete:
                        # Skip a bounded chunk of an oversized JSONL record (for example an image).
                        # Its remainder will fail JSON parsing; later complete records remain readable.
                        if len(data)==4*1024*1024:
                            row['offset']+=len(data);changed=True
                        continue
                    for line in data[:complete].splitlines():
                        try:
                            record = json.loads(line)
                            visible = assistant_text(record, row['kind'])
                        except (ValueError, TypeError, AttributeError):
                            continue
                        for match in REPLY.finditer(visible):
                            if match[1] == row['id'] and match[2].strip():
                                row.update(reply=match[2].strip()[:MAX_REPLY], status='replied',
                                           reply_at=time.time(), truncated=len(match[2].strip()) > MAX_REPLY)
                    row['offset'] += complete
                    changed = True
                except OSError:
                    continue
            if changed:
                self.save()
            return [{k: row[k] for k in ('id', 'text', 'created', 'status', 'reply', 'reply_at', 'truncated')
                     if k in row} for row in rows]
