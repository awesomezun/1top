"""Bounded raw registry reads; identity verification belongs to sessions/."""
import json
from pathlib import Path


def read(root, pid):
    try:
        with (Path(root)/'sessions'/f'{pid}.json').open('rb') as stream:
            raw = stream.read(65537)
        value = json.loads(raw) if len(raw) <= 65536 else None
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def read_all(processes):
    return {str(p['pid']): read(p['config_dir'], p['pid']) for p in processes
            if p.get('kind') in ('Claude', 'GLM')}
