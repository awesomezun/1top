#!/usr/bin/env python3
"""Exercise the pinned upstream launcher with disposable local fixtures only.

No T3 account, real T3 executable, provider process, or user history is used.
The upstream launcher is read from a separately supplied reference checkout.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PIN = '27e0c684c585f955252d65f06206dd11a143bff5'
SOURCE_SHA256 = '9bc0b14ebb4c80139db109cdf0bc9db8aca2259a9517873417e295a1114dac6d'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Output exists; use a new versioned path.')
    sha = subprocess.check_output(['git', '-C', str(args.reference), 'rev-parse', 'HEAD'], text=True).strip()
    if sha != PIN:
        raise SystemExit('Reference commit does not match the reviewed source.')
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required.')
    platform = subprocess.check_output([node, '-p', 'process.platform+"-"+process.arch'], text=True).strip()
    if platform not in ('darwin-arm64', 'linux-arm64', 'linux-x64'):
        raise SystemExit('This fixture probe covers the POSIX launcher only.')
    source = (args.reference / 'scripts/npm-launcher/t3.mjs').read_bytes()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise SystemExit('Launcher content differs from the reviewed source.')
    version = '0.0.0'
    archive_name = f't3-{version}-{platform}.tar.gz'
    archive = io.BytesIO()
    stub = b'#!/bin/sh\nprintf "onetop-launcher-fixture\\n"\n'
    with tarfile.open(fileobj=archive, mode='w:gz') as tar:
        info = tarfile.TarInfo('fixture/t3')
        info.mode = 0o755
        info.size = len(stub)
        tar.addfile(info, io.BytesIO(stub))
    raw = archive.getvalue()
    checksum = hashlib.sha256(raw).hexdigest()
    state = {'mode': 'valid', 'requests': []}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            state['requests'].append(self.path)
            if self.path == f'/v{version}/SHA256SUMS':
                body = (f'{checksum}  {archive_name}\n' if state['mode'] != 'missing-checksum' else '').encode()
            elif self.path == f'/v{version}/{archive_name}':
                body = raw if state['mode'] != 'corrupt' else raw + b'tampered'
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *unused):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    cases = []
    try:
        with tempfile.TemporaryDirectory(prefix='onetop-launcher-probe-') as folder:
            root = Path(folder)
            package = root / 'package'
            (package / 'bin').mkdir(parents=True)
            (package / 'package.json').write_text(json.dumps({'version': version, 'type': 'module'}))
            launcher = package / 'bin/t3.mjs'
            launcher.write_bytes(source)
            base_env = {
                'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                'HOME': str(root / 'home'),
                'TMPDIR': folder,
                'T3CODE_RELEASE_BASE_URL': f'http://127.0.0.1:{server.server_port}',
            }

            def run(name, mode='valid'):
                state['mode'] = mode
                state['requests'] = []
                result = subprocess.run(
                    [node, str(launcher), 'version'],
                    env={**base_env, 'T3CODE_HOME': str(root / name)},
                    cwd=root, capture_output=True, text=True, timeout=20,
                )
                return result, list(state['requests'])

            result, requests = run('cold')
            cases.append({'case': 'cold_install_verified_archive', 'passed': result.returncode == 0 and result.stdout.strip() == 'onetop-launcher-fixture' and len(requests) == 2})
            result, requests = run('cold')
            cases.append({'case': 'warm_cache_no_download', 'passed': result.returncode == 0 and not requests})
            result, requests = run('tamper', 'corrupt')
            cases.append({'case': 'checksum_mismatch_never_executes', 'passed': result.returncode != 0 and not result.stdout and 'checksum mismatch' in result.stderr and not (root / 'tamper/runtime/versions/0.0.0/.install-complete').exists()})
            result, requests = run('missing', 'missing-checksum')
            cases.append({'case': 'unlisted_archive_never_downloads_or_executes', 'passed': result.returncode != 0 and not result.stdout and len(requests) == 1})
            incomplete = root / 'interrupted/runtime/versions/0.0.0'
            incomplete.mkdir(parents=True)
            (incomplete / 'partial-file').write_text('incomplete fixture')
            result, requests = run('interrupted')
            cases.append({'case': 'incomplete_install_recovered', 'passed': result.returncode == 0 and result.stdout.strip() == 'onetop-launcher-fixture' and (incomplete / '.install-complete').is_file() and not (incomplete / 'partial-file').exists()})
    finally:
        server.shutdown()
        server.server_close()
    output = {
        'upstream_commit': PIN,
        'upstream_file': 'scripts/npm-launcher/t3.mjs',
        'upstream_sha256': hashlib.sha256(source).hexdigest(),
        'platform': platform,
        'node_version': subprocess.check_output([node, '--version'], text=True).strip(),
        'scope': 'Synthetic local archive and inert executable; not a real install, sign-in, mobile, or load benchmark.',
        'cases': cases,
    }
    if args.output.exists():
        raise SystemExit('Output exists; use a new versioned path.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'passed': sum(c['passed'] for c in cases), 'total': len(cases), 'output': str(args.output)}))
    if not all(c['passed'] for c in cases):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
