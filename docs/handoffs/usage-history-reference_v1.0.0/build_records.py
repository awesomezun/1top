"""Prototype of the usage-history backfill described in usage-history-contract_v1.0.0.md.

Reads Claude Code and Codex transcripts and keeps only time, tool, model, working folder and the
four token counts (input, cache read, cache write, output). Message content is never stored.
Writes a SQLite table of per-minute sums for the frontend fixture server.
"""
import glob
import json
import os
import sqlite3
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'records.sqlite')


def epoch(value):
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        return None


def n(usage, key):
    try:
        return max(0, int(usage.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def claude_file(path):
    """Last usage per message id in one transcript: [(key, t, model, cwd, tokens)]."""
    found = {}
    try:
        with open(path, 'rb') as f:
            for line in f:
                if b'"usage"' not in line or b'"assistant"' not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if row.get('type') != 'assistant':
                    continue
                msg = row.get('message') or {}
                usage = msg.get('usage') or {}
                model = msg.get('model') or 'unknown'
                if model == '<synthetic>':
                    continue
                t = epoch(row.get('timestamp'))
                if t is None:
                    continue
                tokens = (n(usage, 'input_tokens') + n(usage, 'cache_read_input_tokens')
                          + n(usage, 'cache_creation_input_tokens') + n(usage, 'output_tokens'))
                key = (msg.get('id') or '') + '|' + (row.get('requestId') or '')
                if key == '|':
                    key = path + ':' + str(t)
                found[key] = (key, t, model, row.get('cwd') or '', tokens)
    except OSError:
        return []
    return list(found.values())


def codex_file(path):
    """Token deltas from cumulative token_count reports, with the model of the latest turn."""
    rows, model, cwd, total = [], 'unknown', '', None
    try:
        with open(path, 'rb') as f:
            for line in f:
                if b'"token_count"' not in line and b'"turn_context"' not in line and b'"session_meta"' not in line:
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                p = row.get('payload') or {}
                kind = row.get('type')
                if kind == 'session_meta':
                    cwd = p.get('cwd') or cwd
                elif kind == 'turn_context':
                    model = p.get('model') or model
                    cwd = p.get('cwd') or cwd
                elif kind == 'event_msg' and p.get('type') == 'token_count':
                    u = (p.get('info') or {}).get('total_token_usage')
                    t = epoch(row.get('timestamp'))
                    if not u or t is None:
                        continue
                    cached = n(u, 'cached_input_tokens')
                    v = [max(0, n(u, 'input_tokens') - cached), cached, n(u, 'cache_write_input_tokens'), n(u, 'output_tokens')]
                    # A decreasing cumulative counter is a reset, never negative spend.
                    if total is not None and not any(a < b for a, b in zip(v, total)):
                        delta = sum(a - b for a, b in zip(v, total))
                        if delta > 0:
                            rows.append((None, t, model, cwd, delta))
                    total = v
    except OSError:
        return []
    return rows


def main():
    home = os.path.expanduser('~')
    claude = glob.glob(os.path.join(home, '.claude/projects/**/*.jsonl'), recursive=True)
    codex = glob.glob(os.path.join(home, '.codex/sessions/**/*.jsonl'), recursive=True)
    print('files', len(claude), len(codex), flush=True)
    minute = {}

    def add(t, kind, model, cwd, tokens):
        k = (int(t // 60) * 60, kind, model, cwd)
        minute[k] = minute.get(k, 0) + tokens

    seen = set()
    with ProcessPoolExecutor(max_workers=8) as pool:
        for i, rows in enumerate(pool.map(claude_file, claude, chunksize=4)):
            for key, t, model, cwd, tokens in rows:
                if key in seen:
                    continue
                seen.add(key)
                add(t, 'GLM' if model.lower().startswith('glm') else 'Claude', model, cwd, tokens)
            if i % 100 == 0:
                print('claude', i, flush=True)
        for i, rows in enumerate(pool.map(codex_file, codex, chunksize=2)):
            for _, t, model, cwd, tokens in rows:
                add(t, 'Codex', model, cwd, tokens)
            if i % 20 == 0:
                print('codex', i, flush=True)
    if os.path.exists(OUT):
        os.remove(OUT)
    db = sqlite3.connect(OUT)
    db.execute('CREATE TABLE rec (t INTEGER, kind TEXT, model TEXT, cwd TEXT, tokens INTEGER)')
    db.executemany('INSERT INTO rec VALUES (?,?,?,?,?)', [(*k, v) for k, v in minute.items()])
    db.execute('CREATE INDEX rec_t ON rec(t)')
    db.commit()
    print('rows', len(minute), 'messages', len(seen), flush=True)


if __name__ == '__main__':
    sys.exit(main())
