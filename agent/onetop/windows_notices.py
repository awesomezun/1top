"""Windows local notices: only IDs/times persist, and a notice is claimed before its native display attempt."""
import contextlib
import datetime
import http.client
import json
import math
import sqlite3
import threading
import time
from pathlib import Path


def clipped(value, units):
    return value.encode('utf-16-le')[:units * 2].decode('utf-16-le', errors='ignore')


WEEKDAYS = {'en': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
            'zh': ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']}
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _duration(seconds, lang):
    h, m = divmod(max(0, round(seconds / 60)), 60)
    if lang == 'zh':
        return f'{h}小时{m}分钟' if h and m else f'{h}小时' if h else f'{m}分钟'
    return f'{h}h {m}m' if h and m else f'{h}h' if h else f'{m}m'


def _when(t, now, lang):
    d, n = datetime.datetime.fromtimestamp(t), datetime.datetime.fromtimestamp(now)
    days = (d.date() - n.date()).days
    if lang == 'zh':
        day = '今天' if days == 0 else '明天' if days == 1 else WEEKDAYS['zh'][d.weekday()] if 0 < days < 7 else f'{d.month}月{d.day}日'
        return f'{day} {d:%H:%M}'
    day = 'today' if days == 0 else 'tomorrow' if days == 1 else WEEKDAYS['en'][d.weekday()] if 0 < days < 7 else f'{MONTHS[d.month - 1]} {d.day}'
    return f"{day} at {d.hour % 12 or 12}:{d:%M} {'AM' if d.hour < 12 else 'PM'}"


def text(row, lang):
    """A notice's title and body in the dashboard's language. The collector writes them in Korean and sends the numbers
    with them (report-contract v1.2.0), which make the English and the Chinese."""
    title, body = row.get('title'), row.get('body')
    if lang not in ('en', 'zh'):
        return title, body
    try:
        at = row['at']
        if row['type'] == 'limit':
            name, end, reset = row.get('account_label') or row.get('kind') or '1top', row['end'], row['reset']
            if lang == 'zh':
                return f'{name} 额度将在重置前用尽', f'按此速度将在{_when(end, at, lang)}用尽 · 比重置早 {_duration(reset - end, lang)}'
            return f'{name} runs out before its reset', f'At this pace it runs out {_when(end, at, lang)} · {_duration(reset - end, lang)} before the reset'
        month, ratio = datetime.datetime.fromtimestamp(at).month, row.get('ratio')
        multiple = isinstance(ratio, (int, float)) and not isinstance(ratio, bool) and math.isfinite(ratio)
        if lang == 'zh':
            return (f"上周智能体工作 {_duration(row['working_s'], lang)}",
                    f"等你的时间 {_duration(row['waiting_s'], lang)}" + (f' · {month}月 回本 {ratio:.1f} 倍' if multiple else ''))
        return (f"Agents worked {_duration(row['working_s'], lang)} last week",
                f"Waiting for you {_duration(row['waiting_s'], lang)}" + (f' · {MONTHS[month - 1]} value {ratio:.1f}×' if multiple else ''))
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        return title, body


class Notices:
    def __init__(self, path, display, now=time.time, lang=lambda: 'ko'):
        self.path, self.display, self.now, self.lang = Path(path), display, now, lang
        self.lock = threading.Lock()

    def consume(self, state):
        if not isinstance(state, dict):
            return []
        settings = state.get('notification_settings')
        if not isinstance(settings, dict) or any(not isinstance(settings.get(k), bool) for k in ('limit', 'weekly')):
            return []
        notices = state.get('notices')
        if not isinstance(notices, list):
            return []
        delivered = []
        for row in notices[-10:]:
            if not isinstance(row, dict):
                continue
            key, kind, at = row.get('id'), row.get('type'), row.get('at')
            if (kind not in ('limit', 'weekly') or not isinstance(key, str) or not key or len(key) > 240
                    or any(ord(c) < 32 for c in key) or not isinstance(at, (int, float)) or isinstance(at, bool)
                    or not math.isfinite(at) or not self.now() - 86400 <= at <= self.now() + 300):
                continue
            title, body = row.get('title'), row.get('body')
            if not isinstance(title, str) or not title.strip() or not isinstance(body, str):
                continue
            with self.lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with contextlib.closing(sqlite3.connect(self.path, timeout=1)) as db, db:
                    db.execute('CREATE TABLE IF NOT EXISTS shown(id TEXT PRIMARY KEY, at REAL NOT NULL)')
                    db.execute('DELETE FROM shown WHERE at<?', (self.now() - 86400,))
                    inserted = db.execute('INSERT OR IGNORE INTO shown VALUES(?,?)', (key, at)).rowcount
                    db.execute('DELETE FROM shown WHERE id NOT IN (SELECT id FROM shown ORDER BY at DESC LIMIT 256)')
                if not inserted or settings.get(kind) is False:
                    continue
                title, body = text(row, self.lang())
                # A failed OS attempt is not repeated on every poll (or after a restart).
                self.display(clipped(body.replace('\x00', ''), 255), clipped(title.replace('\x00', ''), 63))
                delivered.append(key)
        return delivered


def set_settings(port, token, values):
    """The same guarded loopback API the dashboard uses. No HTTP proxy, remote URL or redirect."""
    if not isinstance(token, str) or not token:
        return None
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
    try:
        connection.request('POST', '/api/notifications', body=json.dumps(values),
                           headers={'Content-Type': 'application/json', 'X-Monitor-Token': token, 'Origin': f'http://127.0.0.1:{port}'})
        response = connection.getresponse()
        raw = response.read(4097)
        if response.status != 200 or len(raw) > 4096:
            return None
        value = json.loads(raw)
        if not isinstance(value, dict):
            return None
        value = value.get('settings', value)
        if not isinstance(value, dict):
            return None
        return {k: value[k] for k in ('limit', 'weekly')} if all(isinstance(value.get(k), bool) for k in ('limit', 'weekly')) else None
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        connection.close()
