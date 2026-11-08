"""Reports (docs/design/growth-features/report-contract_v1.2.0): this month's API value of the subscriptions, the
week's agent hours from session state spans, and the notices a computer shows (a weekly limit that runs out before
its reset, last week's summary). Nothing here stores a conversation, a path or an e-mail."""
import datetime
import json
import os
import threading
import time
from pathlib import Path

from . import pricing

DAY = 86400
GAP = 120          # a session unseen this long (the collector asleep) ends its span where it was last seen
WRITE_EVERY = 30   # an open span's end is written at most this often
KEEP_DAYS = 90
SIX_HOURS = 6 * 3600
_LOCK = threading.RLock()
WEEKDAYS = '월화수목금토일'  # the Korean notice's weekday; the apps write theirs from the notice's times


def initialize(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS state_spans(sid TEXT, kind TEXT, state TEXT, label TEXT, start REAL, end REAL);
        CREATE INDEX IF NOT EXISTS state_span_end ON state_spans(end);''')


def local(t):
    return datetime.datetime.fromtimestamp(t)


def month_start(t):
    d = local(t)
    return datetime.datetime(d.year, d.month, 1).timestamp()


def add_months(t, n):
    d = local(t)
    y, m = divmod(d.month - 1 + n, 12)
    return datetime.datetime(d.year + y, m + 1, 1).timestamp()


def week_start(t):
    d = local(t)
    monday = datetime.datetime(d.year, d.month, d.day) - datetime.timedelta(days=d.weekday())
    return monday.timestamp()


def clock(t):
    d = local(t)
    return f"{'오전' if d.hour < 12 else '오후'} {d.hour % 12 or 12:02d}:{d.minute:02d}"


def when(t, now):
    d, n = local(t).date(), local(now).date()
    days = (d - n).days
    day = '오늘' if days == 0 else '내일' if days == 1 else WEEKDAYS[d.weekday()] + '요일' if 0 < days < 7 else f'{d.month}월 {d.day}일'
    return f'{day} {clock(t)}'


def duration(seconds):
    m = max(0, round(seconds / 60))
    h, m = divmod(m, 60)
    return f'{h}시간 {m}분' if h and m else f'{h}시간' if h else f'{m}분'


def _label(s):
    # The project's own name, never a path; a session without one is named by its tool.
    name = str(s.get('project') or s.get('title') or s.get('kind') or '').replace('\\', '/').rstrip('/').split('/')[-1]
    return name[:60]


def _state(s):
    if (s.get('children_working') or 0) > 0:
        return 'working'
    status = s.get('display_status') or s.get('status')
    return status if status in ('working', 'waiting') else None


class Spans:
    """A span opens when a session starts working or waiting, grows while it stays so and ends when it changes or
    the session goes unseen. Subagents run inside their session's time, so only top-level sessions count."""

    def __init__(self):
        self.open = {}  # sid -> {'row', 'state', 'last', 'written'}

    def _close(self, db, sid, end):
        span = self.open.pop(sid)
        db.execute('UPDATE state_spans SET end=? WHERE rowid=?', (end, span['row']))

    def record(self, db, sessions, now):
        seen = set()
        for s in sessions:
            if s.get('is_subagent') or not s.get('id'):
                continue
            sid, state = s['id'], _state(s)
            seen.add(sid)
            span = self.open.get(sid)
            if span and (span['state'] != state or now - span['last'] > GAP):
                self._close(db, sid, span['last'] if now - span['last'] > GAP else now)
                span = None
            if not state:
                continue
            if span:
                span['last'] = now
                if now - span['written'] >= WRITE_EVERY:
                    db.execute('UPDATE state_spans SET end=? WHERE rowid=?', (now, span['row']))
                    span['written'] = now
            else:
                row = db.execute('INSERT INTO state_spans(sid,kind,state,label,start,end) VALUES(?,?,?,?,?,?)',
                                 (sid, s.get('kind'), state, _label(s), now, now)).lastrowid
                self.open[sid] = {'row': row, 'state': state, 'last': now, 'written': now}
        for sid in [k for k, v in self.open.items() if k not in seen]:
            self._close(db, sid, self.open[sid]['last'])
        db.execute('DELETE FROM state_spans WHERE end<?', (now - KEEP_DAYS * DAY,))


def _clip(rows, a, b):
    for sid, kind, state, label, start, end in rows:
        s, e = max(start, a), min(end, b)
        if e > s:
            yield sid, kind, state, label, s, e


def _week(db, a, b):
    rows = list(_clip(db.execute('SELECT sid,kind,state,label,start,end FROM state_spans WHERE end>? AND start<?', (a, b)), a, b))
    work = sum(e - s for _, _, st, _, s, e in rows if st == 'working')
    wait = sum(e - s for _, _, st, _, s, e in rows if st == 'waiting')
    return rows, work, wait


def weekly(db, now):
    """This week from Monday 0:00 (local) to now, each day, the longest wait, and last week up to the same time."""
    start = week_start(now)
    first = db.execute('SELECT MIN(start) FROM state_spans').fetchone()[0]
    if first is None:
        return None
    rows, work, wait = _week(db, start, now)
    days = []
    for i in range(7):
        a = (local(start) + datetime.timedelta(days=i)).timestamp()
        b = (local(start) + datetime.timedelta(days=i + 1)).timestamp()
        if a > now:
            break
        day = list(_clip(rows, a, b))
        days.append({'date': local(a).strftime('%Y-%m-%d'),
                     'working_s': round(sum(e - s for _, _, st, _, s, e in day if st == 'working')),
                     'waiting_s': round(sum(e - s for _, _, st, _, s, e in day if st == 'waiting'))})
    waits = [r for r in rows if r[2] == 'waiting']
    longest = max(waits, key=lambda r: r[5] - r[4], default=None)
    last = (local(now) - datetime.timedelta(days=7)).timestamp()
    _, pwork, pwait = _week(db, (local(start) - datetime.timedelta(days=7)).timestamp(), last)
    previous_start = (local(start) - datetime.timedelta(days=7)).timestamp()
    return {'start': start, 'end': (local(start) + datetime.timedelta(days=7)).timestamp(), 'since': first,
            'working_s': round(work), 'waiting_s': round(wait),
            'longest_wait': {'session_id': longest[0], 'label': longest[3], 'kind': longest[1], 'seconds': round(longest[5] - longest[4])} if longest else None,
            'previous': {'working_s': round(pwork), 'waiting_s': round(pwait), 'partial': first > previous_start},
            'days': days}


def last_week(db, now):
    """The whole of last week, Monday to Sunday, for the Monday notice."""
    start = week_start(now)
    a = (local(start) - datetime.timedelta(days=7)).timestamp()
    first = db.execute('SELECT MIN(start) FROM state_spans').fetchone()[0]
    if first is None or first > start - DAY:
        return None
    _, work, wait = _week(db, a, start)
    return {'start': a, 'working_s': round(work), 'waiting_s': round(wait)}


# ---------- plans ----------
def _plans_path(data):
    return Path(data) / 'report-plans-v1.json'


def read_plans(data):
    try:
        with _plans_path(data).open('rb') as stream:
            raw = stream.read(65537)
        values = json.loads(raw) if len(raw) <= 65536 else {}
    except (OSError, ValueError):
        return {}
    out = {}
    for k, v in (values.items() if isinstance(values, dict) else []):
        if isinstance(k, str) and isinstance(v, dict):
            price = v.get('price')
            out[k] = {'plan': str(v.get('plan') or '')[:24], 'price': float(price) if isinstance(price, (int, float)) and 0 <= price <= 10000 else None}
    return out


def set_plan(data, account_id, plan, price, account_ids):
    """Saves the user's own plan and price for an account; plan None goes back to what the provider reports."""
    if not isinstance(account_id, str) or account_id not in account_ids:
        raise ValueError('Unknown account.')
    if plan is not None and (not isinstance(plan, str) or len(plan) > 24):
        raise ValueError('Invalid plan.')
    if price is not None and (not isinstance(price, (int, float)) or isinstance(price, bool) or not 0 <= price <= 10000):
        raise ValueError('Invalid price.')
    with _LOCK:
        values = read_plans(data)
        if plan is None:
            values.pop(account_id, None)
        else:
            values[account_id] = {'plan': plan, 'price': price}
        _write(_plans_path(data), values)
    return values.get(account_id)


def _write(path, values):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    with os.fdopen(os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        json.dump(values, stream, ensure_ascii=False)
    temp.replace(path)


PLAN_KINDS = ('Claude', 'Codex', 'GLM', 'Antigravity')


def plans(account_quotas, overrides):
    rows = []
    for q in account_quotas or []:
        if q.get('kind') not in PLAN_KINDS or not q.get('id'):
            continue
        plan, label, price = pricing.plan(q['kind'], q.get('plan'), q.get('plan_tier'))
        source = 'detected' if price is not None else 'unknown'
        own = overrides.get(q['id'])
        if own:
            plan, label, price, source = own['plan'] or plan, pricing.plan(q['kind'], own['plan'])[1] if own['plan'] else label, own['price'], 'user'
            if price is None:
                source = 'unknown'
        rows.append({'account_id': q['id'], 'kind': q['kind'], 'plan': plan, 'label': label, 'price': price, 'source': source})
    return rows


# ---------- the month ----------
def _priced(totals, counted):
    by_model, unpriced, unpriced_models, excluded, excluded_kinds = [], 0, set(), 0.0, set()
    for (kind, model), tokens in totals.items():
        dollars = pricing.value(model, tokens)
        if kind not in counted:
            if dollars:
                excluded += dollars
                excluded_kinds.add(kind)
            continue
        if dollars is None:
            unpriced += sum(tokens)
            unpriced_models.add(pricing.normalize(model) or 'unknown')
            continue
        by_model.append({'model': pricing.normalize(model), 'kind': kind, 'api_value': round(dollars, 2), 'tokens': [int(n) for n in tokens]})
    merged = {}
    for row in by_model:
        key = (row['kind'], row['model'])
        if key in merged:
            merged[key]['api_value'] = round(merged[key]['api_value'] + row['api_value'], 2)
            merged[key]['tokens'] = [a + b for a, b in zip(merged[key]['tokens'], row['tokens'])]
        else:
            merged[key] = row
    return sorted(merged.values(), key=lambda r: -r['api_value']), unpriced, sorted(unpriced_models), excluded, sorted(excluded_kinds)


class Value:
    """The month so far, recomputed at most once a minute; the five months before are kept once computed."""

    def __init__(self):
        self.cache = {}
        self.current = None

    def compute(self, totals_for, account_quotas, overrides, now):
        if self.current and now - self.current[0] < 60 and self.current[1] == json.dumps(overrides, sort_keys=True):
            return self.current[2]
        first = month_start(now)
        rows = plans(account_quotas, overrides)
        counted = {r['kind'] for r in rows}
        plan_total = round(sum(r['price'] or 0 for r in rows), 2)
        by_model, unpriced, unpriced_models, excluded, excluded_kinds = _priced(totals_for(first, now), counted)
        api_value = round(sum(r['api_value'] for r in by_model), 2)
        # A tool with a plan whose price is unknown (ChatGPT Pro's tier, an API key) leaves the multiple: its value
        # would count against too little.
        unknown = {r['kind'] for r in rows if r['price'] is None}
        by_kind = []
        for kind in sorted({r['kind'] for r in by_model} | counted):
            v = round(sum(r['api_value'] for r in by_model if r['kind'] == kind), 2)
            p = round(sum(r['price'] or 0 for r in rows if r['kind'] == kind), 2)
            by_kind.append({'kind': kind, 'api_value': v, 'plan_total': p, 'ratio': round(v / p, 3) if p and kind not in unknown else None})
        known_api = round(sum(k['api_value'] for k in by_kind if k['ratio'] is not None), 2)
        known_plan = round(sum(k['plan_total'] for k in by_kind if k['ratio'] is not None), 2)
        months = []
        for back in range(5, 0, -1):
            a, b = add_months(now, -back), add_months(now, -back + 1)
            # The months count the tools the multiple counts: those whose plans all have a price.
            priced = frozenset(counted - unknown)
            key = (local(a).strftime('%Y-%m'), priced)
            if key not in self.cache:
                past, *_ = _priced(totals_for(a, b), priced)
                self.cache[key] = round(sum(r['api_value'] for r in past), 2)
            if self.cache[key] > 0:
                # The plans of a past month are not kept; today's plans stand in for them.
                months.append({'month': key[0], 'api_value': self.cache[key], 'plan_total': known_plan})
        result = {'month': local(now).strftime('%Y-%m'), 'start': first, 'end': now, 'currency': 'USD', 'prices_as_of': pricing.PRICES_AS_OF,
                  'plans': rows, 'plan_total': plan_total, 'api_value': api_value, 'ratio': round(known_api / known_plan, 3) if known_plan else None,
                  'unpriced': {'tokens': int(unpriced), 'models': unpriced_models}, 'api_billed': 0,
                  'excluded': {'api_value': round(excluded, 2), 'kinds': excluded_kinds},
                  'by_kind': by_kind, 'by_model': by_model, 'months': months}
        self.current = (now, json.dumps(overrides, sort_keys=True), result)
        return result


# ---------- notices ----------
def _settings_path(data):
    return Path(data) / 'notifications-v1.json'


def _notices_path(data):
    return Path(data) / 'notices-v1.json'


def read_settings(data):
    try:
        values = json.loads(_settings_path(data).read_text())
    except (OSError, ValueError):
        values = {}
    values = values if isinstance(values, dict) else {}
    return {'limit': values.get('limit') is not False, 'weekly': values.get('weekly') is not False}


def set_settings(data, payload):
    if not isinstance(payload, dict) or any(k not in ('limit', 'weekly') or not isinstance(v, bool) for k, v in payload.items()):
        raise ValueError('Invalid notification settings.')
    with _LOCK:
        values = {**read_settings(data), **payload}
        _write(_settings_path(data), values)
    return values


def _read_state(data):
    try:
        values = json.loads(_notices_path(data).read_text())
        return values if isinstance(values, dict) else {}
    except (OSError, ValueError):
        return {}


def _weekly_window(q):
    for w in q.get('windows') or []:
        if isinstance(w, dict) and w.get('scope') != 'mcp' and (w.get('period') == 'weekly' or w.get('label') in ('주간', 'Weekly')):
            return w
    return None


def _burn(weekly_snapshot, q, key='5h'):
    account = next((a for a in (weekly_snapshot or {}).get('accounts') or [] if a.get('id') == q.get('id')), None)
    p = ((account or {}).get('periods') or {}).get(key) or {}
    used, seen = p.get('used_pp'), p.get('observed_seconds')
    if q.get('stale') is not False or q.get('identity_verified') is False or not isinstance(used, (int, float)) or not isinstance(seen, (int, float)) or seen < 120:
        return None
    return used / seen * 3600


def notices(data, account_quotas, weekly_snapshot, names, last_week_summary, value_now, now):
    """Updates the notice list: a limit notice when an account turns to running out before its reset (once in six
    hours per account), a weekly notice on the first run of a Monday. Returns (notices, settings)."""
    settings = read_settings(data)
    with _LOCK:
        state = _read_state(data)
        before = json.dumps(state, sort_keys=True)
        early, last, items = state.get('early', {}), state.get('last_limit', {}), state.get('items', [])
        for q in account_quotas or []:
            w, rate = _weekly_window(q), _burn(weekly_snapshot, q)
            if not w or not isinstance(w.get('pct'), (int, float)) or not rate or rate <= 0:
                early.pop(q.get('id'), None)
                continue
            left, reset = max(0.0, 100 - w['pct']), w.get('reset')
            end = now + left / rate * 3600
            soon = isinstance(reset, (int, float)) and end < reset
            if soon and not early.get(q['id']) and now - last.get(q['id'], 0) >= SIX_HOURS and settings['limit']:
                name = names.get(q['id']) or q.get('kind') or ''
                items.append({'id': f"limit:{q['id']}:{int(end // 3600)}", 'type': 'limit', 'at': now, 'account_id': q['id'], 'kind': q.get('kind'),
                              'account_label': name, 'end': round(end), 'reset': reset, 'left_pct': round(left, 1), 'burn_pph': round(rate, 3),
                              'title': f'{name} 한도가 초기화 전에 바닥납니다',
                              'body': f'이 속도면 {when(end, now)}에 바닥납니다 · 초기화보다 {duration(reset - end)} 빠릅니다'})
                last[q['id']] = now
            early[q['id']] = bool(soon)
        monday = local(week_start(now)).strftime('%Y-%m-%d')
        if settings['weekly'] and state.get('weekly_sent') != monday and last_week_summary:
            ratio = (value_now or {}).get('ratio')
            items.append({'id': f'weekly:{monday}', 'type': 'weekly', 'at': now, 'week_start': last_week_summary['start'],
                          'working_s': last_week_summary['working_s'], 'waiting_s': last_week_summary['waiting_s'], 'ratio': ratio,
                          'title': f"지난주 에이전트 작업 {duration(last_week_summary['working_s'])}",
                          'body': f"대기로 멈춘 시간 {duration(last_week_summary['waiting_s'])}" + (f" · {local(now).month}월 본전 {ratio:.1f}배" if isinstance(ratio, (int, float)) else '')})
            state['weekly_sent'] = monday
        items = [n for n in items if isinstance(n, dict) and now - n.get('at', 0) < DAY][-10:]
        state.update(early=early, last_limit=last, items=items)
        # Written only when something changed: the collector runs this every few seconds.
        # Nothing to remember (no notice, no account running out early) writes nothing.
        meaningful = items or any(early.values()) or last or state.get('weekly_sent')
        if json.dumps(state, sort_keys=True) != before and (meaningful or _notices_path(data).exists()):
            _write(_notices_path(data), state)
    return [n for n in items if settings.get(n.get('type'), True)], settings
