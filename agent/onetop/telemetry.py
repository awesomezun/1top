"""Local OTLP intake. Only allowlisted measurements survive decoding.

JSONL remains the usage ledger. OTLP request measurements are an independent
cross-check, never added to that ledger or forwarded to the remote relay.
"""
import gzip
import hashlib
import io
import json
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import closing
from datetime import datetime
from pathlib import Path

from .accounts import identity
from .effort import level

MAX_BODY = 4 * 1024 * 1024
MAX_RECORDS = 5000
RETENTION = 8 * 86400
MAX_STORED = 100000
IDENTIFIER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,255}$')
SIGNALS = {'logs': ('resourceLogs', 'scopeLogs', 'logRecords'),
           'metrics': ('resourceMetrics', 'scopeMetrics', 'metrics'),
           'traces': ('resourceSpans', 'scopeSpans', 'spans')}


def literal(value):
    return value if isinstance(value, str) and IDENTIFIER.fullmatch(value) else None


def number(value):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) and 0 <= result <= 1e15 else None
    except (TypeError, ValueError, OverflowError):
        return None


def attrs(values):
    result = {}
    if not isinstance(values, list):
        return result
    for item in values[:256]:
        if not isinstance(item, dict) or not isinstance(item.get('key'), str):
            continue
        value = item.get('value')
        if not isinstance(value, dict):
            continue
        for field in ('stringValue', 'intValue', 'doubleValue', 'boolValue'):
            if value.get(field) is not None:
                result[item['key']] = value[field]
                break
    return result


def timestamp(record, attributes, now):
    raw = record.get('timeUnixNano') or record.get('endTimeUnixNano')
    try:
        nanos = int(raw or 0)
        if nanos > 0:
            t = nanos / 1e9
        elif attributes.get('event.timestamp'):
            t = datetime.fromisoformat(str(attributes['event.timestamp']).replace('Z', '+00:00')).timestamp()
        else:
            t = int(record.get('observedTimeUnixNano') or 0) / 1e9
    except (TypeError, ValueError, OverflowError):
        return None
    return t if now - RETENTION <= t <= now + 30 else None


def decode(body, signal, content_type, encoding=''):
    if len(body) > MAX_BODY:
        raise ValueError('payload_too_large')
    if encoding == 'gzip':
        with gzip.GzipFile(fileobj=io.BytesIO(body)) as stream:
            body = stream.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            raise ValueError('payload_too_large')
    elif encoding not in ('', 'identity'):
        raise ValueError('unsupported_encoding')
    if content_type.split(';')[0].strip() == 'application/json':
        data = json.loads(body)
    elif content_type == 'application/x-protobuf':
        # Official OTLP protobuf definitions; no Collector daemon or gRPC server.
        from google.protobuf.json_format import MessageToDict
        from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import ExportLogsServiceRequest
        from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import ExportMetricsServiceRequest
        from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
        message = {'logs': ExportLogsServiceRequest, 'metrics': ExportMetricsServiceRequest,
                   'traces': ExportTraceServiceRequest}[signal]()
        message.ParseFromString(body)
        data = MessageToDict(message)
    else:
        raise ValueError('unsupported_content_type')
    if not isinstance(data, dict):
        raise ValueError('invalid_otlp_document')
    return data


def _normalize(signal, record, a, now, metric=None):
    name = a.get('event.name') or record.get('eventName') or record.get('name')
    body = record.get('body') or {}
    if not name and isinstance(body, dict):
        candidate = body.get('stringValue')
        if isinstance(candidate, str) and candidate.startswith(('claude_code.', 'codex.')):
            name = candidate
    service = str(a.get('service.name', '')).lower()
    name = literal(name)
    if not name:
        return None
    kind = 'Claude' if name.startswith('claude_code.') or service in ('claude-code', 'claude_code') else (
        'Codex' if name.startswith('codex.') or 'codex' in service else None)
    sid = literal(a.get('session.id') if kind == 'Claude' else a.get('conversation.id'))
    t = timestamp(record, a, now)
    if not kind or not sid or t is None:
        return None
    if kind == 'Claude' and not name.startswith('claude_code.'):
        name = 'claude_code.' + name
    account = literal(a.get('user.account_uuid') if kind == 'Claude' else a.get('user.account_id'))
    org = literal(a.get('organization.id')) or ''
    account_key = identity(kind, account, org if kind == 'Claude' else '') if account else None
    values = None
    # Counters and spans repeat request usage. Only completed request LOGS form
    # this secondary token ledger; metric/trace values remain diagnostics.
    if signal == 'logs' and name == 'claude_code.api_request':
        keys = ('input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens')
        parsed = [number(a.get(k)) for k in keys]
        valid = all((value is not None and value.is_integer()) or key not in a for key,value in zip(keys,parsed))
        if valid and parsed[0] is not None and parsed[3] is not None:
            values = [int(v or 0) for v in parsed]
    elif signal == 'logs' and name in ('codex.sse_event', 'codex.websocket_event') and a.get('event.kind') == 'response.completed':
        fresh = number(a.get('input_token_count'))
        output = number(a.get('output_token_count'))
        cached = number(a.get('cached_token_count')) or 0
        written = number(a.get('cache_write_token_count')) or 0
        valid = all(number(a[k]) is not None and number(a[k]).is_integer() for k in
                    ('input_token_count','output_token_count','cached_token_count','cache_write_token_count') if k in a)
        if valid and fresh is not None and output is not None and cached <= fresh:
            values = [int(fresh - cached), int(cached), int(written), int(output)]
    duration = number(a.get('duration_ms'))
    if duration is None and signal == 'traces':
        try:
            duration = number((int(record['endTimeUnixNano']) - int(record['startTimeUnixNano'])) / 1e6)
        except (KeyError, TypeError, ValueError):
            pass
    item = {'kind': kind, 'session_id': sid, 'signal': signal, 'name': name, 't': t,
            'account_id': account_key, 'model': literal(a.get('model') or a.get('gen_ai.request.model')),
            'effort': level(a.get('effort') or a.get('model_reasoning_effort') or a.get('reasoning_effort')),
            'parent_session_id': literal(a.get('parent.conversation.id')),
            'agent_id': literal(a.get('agent_id')), 'parent_agent_id': literal(a.get('parent_agent_id')),
            'request_id': literal(a.get('request_id') or a.get('response.id')),
            'duration_ms': duration, 'ttft_ms': number(a.get('ttft_ms')),
            'error': bool(a.get('error') or a.get('error.message') or name.endswith('.api_error') or
                          (record.get('status') or {}).get('code') in (2, 'STATUS_CODE_ERROR')),
            'tokens': values}
    if metric:
        item['metric'] = metric
    # Keep exact nanoseconds for retry deduplication. Never hash/store prompt,
    # command, tool result, email, arbitrary resource attributes, or raw body.
    stable = [item, record.get('timeUnixNano') or record.get('endTimeUnixNano'),
              record.get('startTimeUnixNano'), record.get('spanId'),
              a.get('event.sequence'), literal(a.get('service.instance.id'))]
    if values is not None and item['request_id']:
        stable = [kind, sid, name, item['request_id']]
    item['key'] = hashlib.sha256(json.dumps(stable, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return item


def normalize(signal, data, now):
    resource_key, scope_key, records_key = SIGNALS[signal]
    groups = data.get(resource_key) or []
    if not isinstance(groups, list):
        raise ValueError('invalid_resource_list')
    output = []
    count = 0
    for group in groups:
        base = attrs((group.get('resource') or {}).get('attributes'))
        for scope in group.get(scope_key) or []:
            for record in scope.get(records_key) or []:
                if signal == 'metrics':
                    metric_type = next((k for k in ('sum', 'gauge', 'histogram', 'exponentialHistogram') if k in record), None)
                    if not metric_type:
                        continue
                    metric_data = record[metric_type]
                    points = metric_data.get('dataPoints', [])
                else:
                    points = [record]
                for point in points:
                    count += 1
                    if count > MAX_RECORDS:
                        raise ValueError('too_many_records')
                    a = {**base, **attrs(point.get('attributes'))}
                    metric = None
                    if signal == 'metrics':
                        a['event.name'] = record.get('name')
                        metric = {'type': metric_type, 'temporality': number(metric_data.get('aggregationTemporality')),
                                  'value': number(point.get('asInt', point.get('asDouble'))),
                                  'count': number(point.get('count')), 'sum': number(point.get('sum')),
                                  'token_type': literal(a.get('type')),
                                  'start': str(point.get('startTimeUnixNano')) if str(point.get('startTimeUnixNano','')).isdigit() else None}
                    item = _normalize(signal, point, a, now, metric)
                    if item:
                        output.append(item)
    return output, count


class TelemetryStore:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / 'telemetry.sqlite'
        self.lock = threading.Lock()
        self.cache = None
        self.cache_at = 0
        self.trim_at = 0
        with closing(self.connect()) as db:
            db.executescript('''PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS records (
                    key TEXT PRIMARY KEY, kind TEXT NOT NULL, sid TEXT NOT NULL,
                    t REAL NOT NULL, received REAL NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS telemetry_time ON records(t);
                CREATE INDEX IF NOT EXISTS telemetry_session ON records(kind,sid,t);
                CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value REAL);''')
            db.commit()
        os.chmod(self.path, 0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=2)

    def ingest(self, signal, data, now=None):
        now = time.time() if now is None else now
        records, count = normalize(signal, data, now)
        with self.lock, closing(self.connect()) as db:
            inserted = 0
            with db:
                for item in records:
                    inserted += db.execute('INSERT OR IGNORE INTO records VALUES(?,?,?,?,?,?)',
                        (item['key'], item['kind'], item['session_id'], item['t'], now,
                         json.dumps(item, separators=(',', ':')))).rowcount
                for name, amount in [('received_records', count), ('stored_records', inserted),
                                     ('duplicate_records', len(records)-inserted), ('ignored_records', count-len(records))]:
                    db.execute('INSERT INTO counters VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value', (name, amount))
                db.execute("INSERT OR REPLACE INTO counters VALUES('last_received',?)", (now,))
                if now - self.trim_at > 60:
                    db.execute('DELETE FROM records WHERE t<?', (now-RETENTION,))
                    db.execute('DELETE FROM records WHERE key IN (SELECT key FROM records ORDER BY t DESC LIMIT -1 OFFSET ?)', (MAX_STORED,))
                    self.trim_at = now
            self.cache = None
        return {'accepted': inserted, 'duplicates': len(records)-inserted, 'ignored': count-len(records)}

    def snapshot(self, now=None):
        now = time.time() if now is None else now
        with self.lock:
            if self.cache is not None and now - self.cache_at < 3:
                return self.cache
            with closing(self.connect()) as db:
                counters = dict(db.execute('SELECT name,value FROM counters'))
                rows = db.execute('SELECT data FROM records WHERE t>? AND t<=? ORDER BY t', (now-86400, now)).fetchall()
            sessions = {}
            for (raw,) in rows:
                item = json.loads(raw)
                key = (item['kind'], item['session_id'])
                s = sessions.setdefault(key, {'kind': key[0], 'session_id': key[1], 'first_seen': item['t'],
                    'last_seen': item['t'], 'request_count': 0, 'error_count': 0,
                    'tokens_24h': [0, 0, 0, 0], 'token_reports': 0, 'signals': set(), 'account_ids': set()})
                s['last_seen'] = item['t']
                s['signals'].add(item['signal'])
                if item['account_id']:
                    s['account_ids'].add(item['account_id'])
                    # Metrics may re-export an old account's cumulative series.
                    # Request/trace identities outrank those periodic counters.
                    priority = 0 if item['signal'] == 'metrics' else 1
                    previous_priority = s.get('identity_priority', -1)
                    if priority >= previous_priority:
                        at = s.get('identity_at', 0)
                        if priority > previous_priority or item['t'] > at:
                            if s.get('account_id') != item['account_id']:
                                s['account_since'] = item['t']
                            s.update(account_id=item['account_id'], identity_at=item['t'], identity_priority=priority)
                        elif item['t'] == at and s.get('account_id') != item['account_id']:
                            s['account_id'] = None  # Conflicting identities at the same instant.
                for field in ('model', 'effort', 'parent_session_id', 'agent_id', 'parent_agent_id', 'duration_ms', 'ttft_ms'):
                    # Periodic counters can describe an OLD model; their export
                    # timestamp is not evidence that it is the current model.
                    if item['signal'] != 'metrics' and item.get(field) is not None:
                        s[field] = item[field]
                        s[field+'_at'] = item['t']
                if item['signal'] == 'logs':
                    s['error_count'] += int(item['error'])
                    if item['tokens'] is not None:
                        s['request_count'] += 1
                        s['token_reports'] += 1
                        s['tokens_24h'] = [a+b for a,b in zip(s['tokens_24h'], item['tokens'])]
            result = []
            for s in sessions.values():
                s['signals'] = sorted(s['signals'])
                s['account_ids'] = sorted(s['account_ids'])
                s.setdefault('account_id', None)
                s.pop('identity_priority', None)
                if not s['token_reports']:
                    s['tokens_24h'] = None
                result.append(s)
            self.cache = {'transport': 'otlp/http', 'mode': 'supplement', 'usage_authority': 'jsonl',
                          'remote_export': False, 'retention_days': RETENTION//86400,
                          **counters, 'sessions': sorted(result, key=lambda s:s['last_seen'], reverse=True)[:250]}
            self.cache_at = now
            return self.cache


def session_index(snapshot):
    return {(s['kind'], s['session_id']): s for s in snapshot.get('sessions', [])}


def bind_account(spec, index, roots, now):
    """Only an exact provider/session identity can override a profile hint.

    Ambiguous or unrecognized explicit identities disable that hint. Binding
    starts at the actual observation, never rewrites earlier usage events.
    """
    report = index.get((spec.get('kind'), spec.get('active_session_id') or spec.get('id')))
    if not report or not report['account_ids']:
        return
    known = {v[0] for v in roots.values() if v[1] == spec['kind']}
    # A session-scoped verified statusline can outlive the profile login that
    # originally introduced the account. Do not discard the corroborating OTel ID.
    if spec.get('account_binding_source') == 'claude_statusline_session' and spec.get('account_binding'):
        known.add(spec['account_binding'][0])
    account = report['account_id']
    spec['account_binding'] = (account, report['account_since']) if account in known else None
    spec['account_binding_source'] = 'otel_session_identity'


def enrich(spec, index):
    report = index.get((spec.get('kind'), spec.get('active_session_id') or spec.get('id')))
    if not report:
        return
    spec['telemetry'] = report
    # Per-agent telemetry must not relabel the parent's model/effort.
    if report.get('agent_id'):
        return
    model_at = report.get('model_at', 0)
    if report.get('model') and model_at > max(spec.get('model_updated') or 0, spec.get('last_usage') or 0):
        if report['model'] != spec.get('model'):
            for field in ('effort', 'effort_source', 'effort_updated'):
                spec.pop(field, None)
        spec.update(model=report['model'], model_updated=model_at)
    if (report.get('effort') and report.get('model') == spec.get('model') and
        report.get('effort_at', 0) >= max(spec.get('effort_updated') or 0, spec.get('model_updated') or 0)):
        spec.update(effort=report['effort'], effort_updated=report['effort_at'], effort_source='otel_request')


def receiver_key(directory):
    path = Path(directory) / 'telemetry-key'
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError('symlink_telemetry_key')
    if not path.exists():
        try:
            with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
                stream.write(secrets.token_urlsafe(32))
        except FileExistsError:
            pass
    value = path.read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', value):
        raise ValueError('invalid_telemetry_key')
    os.chmod(path, 0o600)
    return value


def handle_http(handler):
    signal = handler.path.removeprefix('/v1/')
    host = handler.headers.get('Host', '')
    allowed = {f'127.0.0.1:{handler.server.server_port}', f'localhost:{handler.server.server_port}'}
    key = getattr(handler.server, 'telemetry_key', None)
    if (not key or host not in allowed or handler.headers.get('Origin') is not None or
        not secrets.compare_digest(handler.headers.get('X-1top-Telemetry-Key', ''), key)):
        handler.json_response(403, {'code': 7, 'message': 'Local telemetry authentication required.'})
        return
    if getattr(handler.server.collector, 'telemetry', None) is None:
        handler.json_response(503, {'code': 14, 'message': 'Telemetry receiver is starting.'})
        return
    try:
        size = int(handler.headers.get('Content-Length', '0'))
        if not 0 < size <= MAX_BODY or handler.headers.get('Transfer-Encoding'):
            raise ValueError('invalid_payload_length')
        handler.connection.settimeout(5)
        body = handler.rfile.read(size)
        if len(body) != size:
            raise ValueError('incomplete_payload')
        content_type = handler.headers.get('Content-Type', '')
        document = decode(body, signal, content_type, handler.headers.get('Content-Encoding', ''))
        handler.server.collector.telemetry.ingest(signal, document)
        if content_type == 'application/x-protobuf':
            # An empty Export*ServiceResponse serializes to zero bytes.
            handler.send_response(200)
            handler.send_header('Content-Type', content_type)
            handler.send_header('Content-Length', '0')
            handler.end_headers()
        else:
            handler.json_response(200, {})
    except sqlite3.Error:
        handler.json_response(503, {'code': 14, 'message': 'Telemetry storage temporarily unavailable.'})
    except Exception as error:
        handler.server.telemetry_last_error = type(error).__name__
        handler.json_response(400, {'code': 3, 'message': 'Invalid or unsupported OTLP payload.'})
