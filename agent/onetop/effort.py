"""Session-scoped reasoning effort from reported metadata, never model defaults."""
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path

from .platform_support import data_directory

_LEVEL = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.+\-]{0,63}$')
_TAIL = 16 * 1024 * 1024


def level(value):
    """Keep the provider's literal label without translating levels between tools."""
    return value if isinstance(value, str) and _LEVEL.fullmatch(value) else None


def codex_level(payload):
    for key in ('effort', 'reasoning_effort', 'model_reasoning_effort'):
        if key in payload:
            return level(payload[key])
    return None


def _time(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value if math.isfinite(value) else 0
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except (TypeError, ValueError):
        return 0


def backfill_codex(state, path):
    """Upgrade an already-consumed ledger using only a bounded recent context tail."""
    if state.get('effort_schema') == 1:
        return False
    state['effort_schema'] = 1
    state.pop('effort', None)
    state.pop('effort_updated', None)
    try:
        with Path(path).open('rb') as stream:
            stream.seek(0, 2)
            start = max(0, stream.tell() - _TAIL)
            stream.seek(start)
            raw = stream.read(_TAIL)
        lines = raw.splitlines(keepends=True)
        if start:
            lines = lines[1:]
        for line in reversed(lines):
            if not line.endswith(b'\n') or b'"turn_context"' not in line:
                continue
            try:
                row = json.loads(line)
            except (ValueError, TypeError):
                continue
            if not isinstance(row, dict) or row.get('type') != 'turn_context':
                continue
            payload = row.get('payload')
            if not isinstance(payload, dict):
                continue
            # Never backfill an older model's effort into a newer saved model.
            if payload.get('model') != state.get('model'):
                break
            value = codex_level(payload)
            if value:
                state['effort'] = value
                state['effort_updated'] = _time(row.get('timestamp'))
            break
    except OSError:
        pass
    return True


def apply_statusline(spec, now, directory=None):
    """Read one exact profile/session report; missing or conflicting reports stay unknown."""
    for key in ('effort', 'effort_source', 'effort_updated'):
        spec.pop(key, None)
    profile, session = spec.get('config_dir'), spec.get('active_session_id') or spec.get('id')
    if not isinstance(profile, str) or not profile or not isinstance(session, str) or not session:
        return
    try:
        root = Path(profile).expanduser().resolve()
        key = hashlib.sha256((str(root) + '|' + session).encode()).hexdigest()
        folder = Path(directory) if directory is not None else data_directory() / 'claude-statusline-sessions'
        path = folder / (key + '.json')
        if folder.is_symlink() or path.is_symlink():
            return
        with path.open('rb') as stream:
            raw = stream.read(16 * 1024 + 1)
        if len(raw) > 16 * 1024:
            return
        report = json.loads(raw)
        if not isinstance(report, dict) or report.get('schema') != 1 or isinstance(report.get('schema'), bool):
            return
        if report.get('profile') != str(root) or report.get('session_id') != session:
            return
        updated = report.get('updated')
        if not isinstance(updated, (float, int)) or isinstance(updated, bool) or not math.isfinite(updated) or not 0 < updated <= now + 5:
            return
        # A resumed process or a newer transcript model invalidates an old callback.
        if updated < max(spec.get('process_birth') or 0, spec.get('model_updated') or spec.get('last_usage') or 0):
            return
        model = report.get('model')
        if model is not None:
            if not isinstance(model, str) or not model or len(model) > 256 or any(ord(c) < 32 for c in model):
                return
            spec['model'] = model
            spec['model_updated'] = updated
        value = level(report.get('effort'))
        if value:
            spec.update(effort=value, effort_source='claude_statusline', effort_updated=updated)
    except (OSError, ValueError, TypeError):
        return
