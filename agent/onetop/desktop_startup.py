"""Local desktop startup, independent of session collection and HTTP proxies."""
import http.client
import json
import os
from pathlib import Path
import subprocess
import time

from .platform_support import data_directory


def local_json(port, route, timeout=1):
    # A user's system/HTTP proxy must never receive local state or action tokens.
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        connection.request('GET', route)
        response = connection.getresponse()
        if response.status != 200:
            return None
        raw = response.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            return None
        value = json.loads(raw)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        connection.close()


def collector_available(port):
    health = local_json(port, '/health')
    if health and health.get('ok') is True and health.get('app') == '1top':
        return True
    # Reuse an older running collector, not an unrelated HTTP service.
    state = local_json(port, '/api/state')
    return bool(state and isinstance(state.get('version'), str)
                and isinstance(state.get('sessions'), list)
                and isinstance(state.get('action_token'), str))


class StartupError(Exception):
    def __init__(self, code, detail):
        super().__init__(detail)
        self.code = code


class CollectorLauncher:
    def __init__(self, port, log_dir=None):
        self.port = port
        self.child = None
        self.log_dir = Path(log_dir) if log_dir else data_directory() / 'logs'
        self.output = None

    def record(self, event, **fields):
        # Diagnostic events contain no account data or session text.
        self.log_dir.mkdir(parents=True, exist_ok=True)
        path = self.log_dir / 'startup.jsonl'
        if path.exists() and path.stat().st_size > 256 * 1024:
            path.replace(path.with_suffix('.previous.jsonl'))
        with path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps({'time': time.time(), 'event': event,
                                     'port': self.port, **fields}) + '\n')

    def start(self, command, timeout=60):
        if collector_available(self.port):
            self.record('connected', owned=False)
            return
        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            path = self.log_dir / 'collector.log'
            if path.exists() and path.stat().st_size > 256 * 1024:
                path.replace(path.with_suffix('.previous.log'))
            self.output = path.open('ab')
            self.child = subprocess.Popen(
                command, stdin=subprocess.DEVNULL, stdout=self.output, stderr=self.output,
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.record('starting', pid=self.child.pid)
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if collector_available(self.port):
                    self.record('connected', owned=True, pid=self.child.pid)
                    return
                code = self.child.poll()
                if code is not None:
                    raise StartupError('collector_exited',
                                       f'The local collector exited (code {code}).')
                time.sleep(.2)
            raise StartupError('connection_timeout',
                               f'The local collector did not connect on port {self.port}.')
        except Exception as error:
            self.stop()
            code = error.code if isinstance(error, StartupError) else 'launch_failed'
            try:
                self.record(code, error_type=type(error).__name__)
            except OSError:
                pass
            if isinstance(error, StartupError):
                raise
            raise StartupError(code, 'The local collector could not be started.') from error

    def stop(self):
        # Only the child launched by this window belongs to us.
        if self.child is not None:
            if self.child.poll() is None:
                self.child.terminate()
                try:
                    self.child.wait(8)
                except subprocess.TimeoutExpired:
                    self.child.kill()
                    self.child.wait()
            self.child = None
        if self.output:
            self.output.close()
            self.output = None
