"""Read Aside's public session metadata; never open incognito transcripts."""
import json
import re
import sqlite3
from pathlib import Path


def read(home, now, running):
    from ..aside import billing_accounts
    rows = []
    for db in sorted((home/'.aside/u').glob('*/state.db'))[:12]:
        if not db.parent.name.isdigit():
            continue
        try:
            connection = sqlite3.connect(db.as_uri()+'?mode=ro', uri=True, timeout=.2)
            try:
                connection.execute('PRAGMA query_only=ON')
                columns = {r[1] for r in connection.execute('PRAGMA table_info(sessions)')}
                parent = 'parent_id' if 'parent_id' in columns else 'NULL'
                trigger = 'trigger' if 'trigger' in columns else 'NULL'
                select = f'SELECT id,title,status,model,cwd,created_at,updated_at,{parent},{trigger} FROM sessions '
                public = 'archived_at IS NULL AND incognito=0 AND ephemeral=0'
                source = connection.execute(select+f"WHERE {public} AND (updated_at>? OR status IN ('running','working','streaming','executing','waiting')) ORDER BY updated_at DESC LIMIT 100", (now-86400,)).fetchall()
                seen = {r[0] for r in source}
                for _ in range(32):
                    missing = {r[7] for r in source if r[7] and r[7] not in seen}
                    if not missing or len(source) >= 250:
                        break
                    found = []
                    for sid in sorted(missing)[:250-len(source)]:
                        seen.add(sid)
                        result = connection.execute(select+f'WHERE {public} AND id=?', (sid,)).fetchone()
                        if result:
                            found.append(result)
                    if not found:
                        break
                    source.extend(found)
            finally:
                connection.close()
            accounts = billing_accounts(db.parent)
            paths = {p.parent.name.rsplit('_',1)[-1]: str(p) for p in (db.parent/'sessions').glob('*/messages.jsonl')}
            for source_row in source:
                row = dict(zip(('id','title','status','model','cwd','created','updated','parent','trigger'), source_row))
                if not isinstance(row['id'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,120}', row['id']):
                    continue
                for key in ('model', 'trigger'):
                    try:
                        value = json.loads(row[key] or '{}')
                        row[key] = value if isinstance(value, dict) else {}
                    except (ValueError, TypeError):
                        row[key] = {}
                rows.append({**row, 'db': str(db), 'profile': db.parent.name, 'running': running,
                             'path': paths.get(row['id']), 'billing_accounts': accounts})
        except (OSError, sqlite3.Error):
            continue
    return rows
