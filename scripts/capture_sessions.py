#!/usr/bin/env python3
"""Save a new anonymous session-capture.v1 fixture; never start a collector."""
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'agent'))
from onetop.observe.capture import capture

if __name__ == '__main__':
    path = Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'tests/fixtures/real'/f'{datetime.now():%Y-%m-%dT%H-%M-%S}-capture.json'
    record = capture(path)
    print(path, len(record['processes']), 'processes,', len(record['claude_registry']), 'registry rows')
