"""Optional Rust acceleration bridge with kill switch and shadow verification mode.

Modes (controlled by `ONETOP_RUST_MODE` or `ONETOP_RUST_DISABLE=1`):
- `new` (default when `_onetop_rs` native extension is built): run Rust implementation.
- `shadow`: run both Python and Rust implementations, assert identical results (raising
  AssertionError on mismatch when `ONETOP_RUST_SHADOW_STRICT=1`), and return Python's result.
- `old`: run pure Python implementation byte-for-byte.
"""
import os
import sqlite3

try:
    from . import _onetop_rs as native
except ImportError:
    native = None


def mode():
    if os.environ.get('ONETOP_RUST_DISABLE') == '1' or native is None:
        return 'old'
    val = os.environ.get('ONETOP_RUST_MODE', 'new').strip().lower()
    return val if val in ('new', 'shadow', 'old') else 'new'


def reraise_sqlite(err):
    msg = str(err)
    if msg.startswith('SQLITE:'):
        raise sqlite3.OperationalError(msg[7:]) from None
    raise err


def shadow_check(name, py_result, rs_result):
    if py_result != rs_result:
        if os.environ.get('ONETOP_RUST_SHADOW_STRICT') == '1':
            raise AssertionError(f'Rust shadow mismatch in {name}: py={py_result!r} rs={rs_result!r}')
    return py_result
