"""Read another app's SQLite database without writing to it."""
import sqlite3
from pathlib import Path


def connect(path, timeout=1):
    """A WAL database read-only needs its -shm, which only its writer creates. With no -wal file there is
    nothing outside the main file, so it is read as it stands (immutable) instead."""
    path = Path(path)
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=timeout)
    try:
        db.execute('SELECT 1 FROM sqlite_master LIMIT 1')
        return db
    except sqlite3.OperationalError as error:
        db.close()
        if 'unable to open' not in str(error) or Path(str(path) + '-wal').exists():
            raise
    return sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True, timeout=timeout)
