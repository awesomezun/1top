"""End-to-end standalone pure-Rust `onetop-agent` parity & benchmark suite.

Compares the standalone pure-Rust binary (`0%` Python fallback) side-by-side against
the original Python backend across CLI, HTTP GET/POST, CSRF/Host/OTLP security guards,
dynamic local inference gateway, static assets, SQLite persistence, and steady-state
performance/RSS/startup metrics.

Strictly uses isolated temporary `ONETOP_DATA` directories; never touches live user data
or port 18766.
"""
import gzip
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RS_BIN = REPO / "rust/target/release/onetop-agent"
DIST_DIR = REPO / "agent/onetop/dist"

STATIC_ROUTES = [
    "/", "/index.html", "/app.js", "/style.css", "/maps.js", "/ranges.js",
    "/speed.js", "/weekly.js", "/history.js", "/maps.css", "/typography.css",
    "/benchmark.json", "/dashboard.js", "/dashboard.css", "/i18n.js",
    "/effects.js", "/conversation.js", "/quick.html", "/quick.js", "/quick.css",
    "/cluster.js", "/cluster.css", "/cluster-pages.js", "/layout.js",
    "/customize.js", "/reports.js", "/cluster-themes.js",
    "/themes/core.js", "/themes/catalog.json", "/themes/mini.json",
    "/themes/pairs.js", "/themes/compact.js", "/themes/t01-06.js",
    "/themes/t07-17.js", "/themes/t18-28.js", "/themes/t29-39.js",
    "/themes/t40-50.js", "/themes/t51-61.js", "/themes/t62-72.js",
    "/brand-mark_v1.1.0.png",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSans.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-Regular.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-Medium.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-SemiBold.woff2",
    "/fonts/ibm-plex/v1.0.0/IBMPlexSansKR-Bold.woff2",
]


def http_req(url, method="GET", headers=None, data=None, timeout=10):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def wait_health(port, require_ready=False, timeout=30.0):
    t0 = time.perf_counter()
    deadline = t0 + timeout
    while time.perf_counter() < deadline:
        try:
            code, _, body = http_req(f"http://127.0.0.1:{port}/health", timeout=2)
            if code == 200:
                payload = json.loads(body)
                if not require_ready or payload.get("ready") is True:
                    return (time.perf_counter() - t0) * 1000.0, payload
        except Exception:
            pass
        time.sleep(0.05)
    raise RuntimeError(f"Server on port {port} did not become healthy (require_ready={require_ready})")


def child_python_processes(parent_pid):
    out = subprocess.check_output(["ps", "-eo", "pid,ppid,comm"], text=True)
    found = []
    for line in out.splitlines()[1:]:
        parts = line.split(None, 2)
        if len(parts) == 3:
            pid, ppid, comm = int(parts[0]), int(parts[1]), parts[2].lower()
            if ppid == parent_pid and "python" in comm:
                found.append((pid, comm))
    return found


def test_cli_parity():
    assert RS_BIN.is_file(), f"Missing release binary: {RS_BIN}"
    env_py = {**os.environ, "PYTHONPATH": str(REPO / "agent"), "ONETOP_RUST_MODE": "old"}

    # 1. version (warmed 2nd call to avoid one-time macOS AMFI first-launch scan of freshly linked binary)
    subprocess.check_output([str(RS_BIN), "version"], text=True)
    t0 = time.perf_counter()
    rs_ver = subprocess.check_output([str(RS_BIN), "version"], text=True).strip()
    rs_ver_ms = (time.perf_counter() - t0) * 1000.0

    subprocess.check_output([sys.executable, "-m", "onetop.cli", "version"], env=env_py, text=True)
    t0 = time.perf_counter()
    py_ver = subprocess.check_output([sys.executable, "-m", "onetop.cli", "version"], env=env_py, text=True).strip()
    py_ver_ms = (time.perf_counter() - t0) * 1000.0
    assert rs_ver == py_ver, f"version mismatch: rs={rs_ver!r} py={py_ver!r}"

    # 2. telemetry-status in isolated temp dir
    with tempfile.TemporaryDirectory() as td_rs, tempfile.TemporaryDirectory() as td_py:
        rs_ts = json.loads(
            subprocess.check_output(
                [str(RS_BIN), "telemetry-status"],
                env={**os.environ, "ONETOP_DATA": td_rs},
                text=True,
            )
        )
        py_ts = json.loads(
            subprocess.check_output(
                [sys.executable, "-m", "onetop.cli", "telemetry-status"],
                env={**env_py, "ONETOP_DATA": td_py},
                text=True,
            )
        )
        assert set(rs_ts.keys()) == set(py_ts.keys()), f"telemetry-status keys differ: rs={set(rs_ts)} py={set(py_ts)}"

    # 3. capture-sessions in isolated temp dir
    with tempfile.TemporaryDirectory() as td:
        rs_cap_path = Path(td) / "rs_cap.json"
        py_cap_path = Path(td) / "py_cap.json"
        rs_summary = json.loads(
            subprocess.check_output([str(RS_BIN), "capture-sessions", "--output", str(rs_cap_path)], text=True)
        )
        py_summary = json.loads(
            subprocess.check_output(
                [sys.executable, "-m", "onetop.cli", "capture-sessions", "--output", str(py_cap_path)],
                env=env_py,
                text=True,
            )
        )
        assert set(rs_summary.keys()) == set(py_summary.keys())
        rs_cap = json.loads(rs_cap_path.read_text())
        py_cap = json.loads(py_cap_path.read_text())
        assert set(rs_cap.keys()) == set(py_cap.keys()), f"capture keys differ: {set(rs_cap) ^ set(py_cap)}"
        assert rs_cap["schema"] == "onetop.session-capture.v1"

    # 4. Invalid CLI arg validation
    bad = subprocess.run([str(RS_BIN), "run", "--relay", "https://example.com"], capture_output=True, text=True)
    assert bad.returncode == 2, f"Expected exit code 2, got {bad.returncode}"

    return {
        "version": rs_ver,
        "cli_version_ms": {"python": round(py_ver_ms, 1), "rust": round(rs_ver_ms, 1)},
        "telemetry_status_parity": True,
        "capture_sessions_parity": True,
        "cli_validation_parity": True,
    }


def test_standalone_e2e():
    rs_port = 19966
    rs_gw_port = 19967
    py_port = 19968
    py_gw_port = 19969

    with tempfile.TemporaryDirectory() as td_rs, tempfile.TemporaryDirectory() as td_py:
        env_rs = {
            **os.environ,
            "ONETOP_DATA": td_rs,
            "ONETOP_DIST_DIR": str(DIST_DIR),
            "ONETOP_PYTHON": "/nonexistent/python-must-not-run",
            "ONETOP_RUST_DIAGNOSTICS": "1",
        }
        env_py = {
            **os.environ,
            "PYTHONPATH": str(REPO / "agent"),
            "ONETOP_DATA": td_py,
            "ONETOP_RUST_MODE": "old",
        }

        t_rs_start = time.perf_counter()
        p_rs = subprocess.Popen(
            [str(RS_BIN), "local", "--headless", "--port", str(rs_port), "--gateway-port", str(rs_gw_port)],
            env=env_rs,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        t_py_start = time.perf_counter()
        p_py = subprocess.Popen(
            [sys.executable, "-m", "onetop.cli", "local", "--headless", "--port", str(py_port), "--gateway-port", str(py_gw_port)],
            env=env_py,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        try:
            rs_listen_ms, _ = wait_health(rs_port, require_ready=False, timeout=20.0)
            py_listen_ms, _ = wait_health(py_port, require_ready=False, timeout=20.0)

            rs_ready_ms, rs_health = wait_health(rs_port, require_ready=True, timeout=30.0)
            rs_ready_total_ms = (time.perf_counter() - t_rs_start) * 1000.0
            py_ready_ms, py_health = wait_health(py_port, require_ready=True, timeout=30.0)
            py_ready_total_ms = (time.perf_counter() - t_py_start) * 1000.0

            # 0. Verify ZERO Python child processes under pure-Rust onetop-agent
            py_children = child_python_processes(p_rs.pid)
            assert not py_children, f"Rust binary spawned Python children: {py_children}"

            # 1. Verify single-instance lock (`agent.lock`)
            dup = subprocess.run(
                [str(RS_BIN), "local", "--headless", "--port", str(rs_port + 20)],
                env=env_rs,
                capture_output=True,
                text=True,
                timeout=10,
            )
            assert dup.returncode == 0 and "already running" in dup.stderr, (
                f"Single-instance lock failed: rc={dup.returncode} stderr={dup.stderr!r}"
            )

            # 2. Verify status.json created with 0o600
            status_path = Path(td_rs) / "status.json"
            for _ in range(30):
                if status_path.is_file():
                    break
                time.sleep(0.1)
            assert status_path.is_file(), "status.json not written"
            assert (status_path.stat().st_mode & 0o777) == 0o600, "status.json permissions not 0600"

            # 3. Verify /health exact keys & values
            assert set(rs_health.keys()) == set(py_health.keys())
            assert rs_health["version"] == py_health["version"]
            assert rs_health["ready"] is True

            # 4. Verify ALL 45 static dashboard routes byte-for-byte + headers
            for route in STATIC_ROUTES:
                sc_p, h_p, b_p = http_req(f"http://127.0.0.1:{py_port}{route}")
                sc_r, h_r, b_r = http_req(f"http://127.0.0.1:{rs_port}{route}")
                assert sc_p == 200 and sc_r == 200, f"Status mismatch on {route}: py={sc_p} rs={sc_r}"
                assert b_p == b_r, f"Body mismatch on {route}"
                assert h_r.get("x-1top-runtime") == "rust", f"Missing rust runtime header on {route}"
                for hdr in ("content-type", "cache-control", "x-content-type-options", "content-security-policy"):
                    assert h_p.get(hdr) == h_r.get(hdr), f"Header {hdr} mismatch on {route}: py={h_p.get(hdr)!r} rs={h_r.get(hdr)!r}"

            # 5. Verify /api/state schema & key parity
            sc_p, _, b_p = http_req(f"http://127.0.0.1:{py_port}/api/state")
            sc_r, h_r, b_r = http_req(f"http://127.0.0.1:{rs_port}/api/state")
            assert sc_p == 200 and sc_r == 200
            assert h_r.get("x-1top-runtime") == "rust"
            py_state = json.loads(b_p)
            rs_state = json.loads(b_r)

            py_keys = set(py_state.keys())
            rs_keys = set(rs_state.keys())
            assert py_keys == rs_keys, f"/api/state top-level key diff: py_only={py_keys - rs_keys} rs_only={rs_keys - py_keys}"
            assert set(py_state["system"].keys()) == set(rs_state["system"].keys()), (
                f"system keys diff: {set(py_state['system']) ^ set(rs_state['system'])}"
            )
            assert set(py_state["system"]["host"].keys()) == set(rs_state["system"]["host"].keys()), (
                f"system.host keys diff: {set(py_state['system']['host']) ^ set(rs_state['system']['host'])}"
            )
            assert len(py_state["period_usage"]["windows"]) == len(rs_state["period_usage"]["windows"])

            # 6. Verify /api/state?period=... (valid + invalid)
            for p_param in ("1h", "all", "custom:7200"):
                sc_r, _, b_r = http_req(f"http://127.0.0.1:{rs_port}/api/state?period={p_param}")
                assert sc_r == 200, f"/api/state?period={p_param} failed: {sc_r}"
                j = json.loads(b_r)
                assert j["ready"] is True
            sc_bad, _, _ = http_req(f"http://127.0.0.1:{rs_port}/api/state?period=invalid")
            assert sc_bad == 400, f"Expected 400 for invalid period, got {sc_bad}"

            # 7. Verify /api/history, /api/usage-sessions, /api/updates, /api/notifications, /api/telemetry, /api/routing
            for ep in (
                "/api/history?period=1h&step=60",
                "/api/usage-sessions?period=1h&offset=0&limit=100",
                "/api/notifications",
                "/api/telemetry",
                "/api/updates",
                "/api/routing",
            ):
                sc_p, _, b_p = http_req(f"http://127.0.0.1:{py_port}{ep}")
                sc_r, _, b_r = http_req(f"http://127.0.0.1:{rs_port}{ep}")
                assert sc_p == 200 and sc_r == 200, f"GET {ep}: py={sc_p} rs={sc_r}"
                jp, jr = json.loads(b_p), json.loads(b_r)
                assert set(jp.keys()) == set(jr.keys()), f"GET {ep} key diff: py_only={set(jp)-set(jr)} rs_only={set(jr)-set(jp)}"

            # Invalid history/usage-sessions params -> 400
            assert http_req(f"http://127.0.0.1:{rs_port}/api/history?period=bad&step=60")[0] == 400
            assert http_req(f"http://127.0.0.1:{rs_port}/api/usage-sessions?period=1h&offset=-1&limit=10")[0] == 400

            # 8. Security guards: 404, bad Host -> 403, POST without CSRF/Origin -> 403
            assert http_req(f"http://127.0.0.1:{rs_port}/does-not-exist")[0] == 404
            assert http_req(f"http://127.0.0.1:{rs_port}/", headers={"Host": "evil.example.com"})[0] == 403
            assert http_req(
                f"http://127.0.0.1:{rs_port}/api/notifications",
                method="POST",
                headers={"Content-Type": "application/json"},
                data=b'{"limit": false}',
            )[0] == 403

            token = rs_state["action_token"]
            csrf_headers = {
                "Host": f"127.0.0.1:{rs_port}",
                "Origin": f"http://127.0.0.1:{rs_port}",
                "X-Monitor-Token": token,
                "Content-Type": "application/json",
            }
            # Bad Content-Type -> 400
            bad_ct = dict(csrf_headers, **{"Content-Type": "text/plain"})
            assert http_req(
                f"http://127.0.0.1:{rs_port}/api/notifications",
                method="POST",
                headers=bad_ct,
                data=b'{"limit": false}',
            )[0] == 400

            # Valid POST /api/notifications
            sc, _, body = http_req(
                f"http://127.0.0.1:{rs_port}/api/notifications",
                method="POST",
                headers=csrf_headers,
                data=json.dumps({"limit": False, "weekly": True}).encode(),
            )
            assert sc == 200, f"POST /api/notifications failed: {sc} {body}"
            j = json.loads(body)
            assert j["ok"] is True and j["settings"]["limit"] is False and j["settings"]["weekly"] is True

            # 9. OTLP /v1/logs ingest (auth reject + plain JSON + gzipped JSON)
            tkey = (Path(td_rs) / "telemetry-key").read_text().strip()
            assert http_req(
                f"http://127.0.0.1:{rs_port}/v1/logs",
                method="POST",
                headers={"Content-Type": "application/json"},
                data=b"{}",
            )[0] == 403
            assert http_req(
                f"http://127.0.0.1:{rs_port}/v1/logs",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "X-1top-Telemetry-Key": tkey,
                    "Origin": f"http://127.0.0.1:{rs_port}",
                },
                data=b"{}",
            )[0] == 403

            now_ns = int((time.time() - 2) * 1e9)
            otlp_payload = json.dumps({
                "resourceLogs": [{
                    "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "claude-code"}}]},
                    "scopeLogs": [{
                        "logRecords": [{
                            "timeUnixNano": str(now_ns),
                            "eventName": "claude_code.api_request",
                            "attributes": [
                                {"key": "session.id", "value": {"stringValue": "e2e-test-sess-1"}},
                                {"key": "model", "value": {"stringValue": "claude-sonnet-4-6"}},
                                {"key": "input_tokens", "value": {"intValue": "123"}},
                                {"key": "output_tokens", "value": {"intValue": "45"}},
                            ],
                        }]
                    }],
                }]
            }).encode()
            gz_otlp = gzip.compress(otlp_payload)
            sc, _, body = http_req(
                f"http://127.0.0.1:{rs_port}/v1/logs",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Content-Encoding": "gzip",
                    "X-1top-Telemetry-Key": tkey,
                },
                data=gz_otlp,
            )
            assert sc == 200 and json.loads(body) == {}, f"OTLP ingest failed: {sc} {body}"
            _, _, tb = http_req(f"http://127.0.0.1:{rs_port}/api/telemetry")
            tj = json.loads(tb)
            assert tj.get("stored_records", 0) >= 1, f"OTLP record not persisted: {tj}"
            assert any(
                s.get("session_id") == "e2e-test-sess-1" and s.get("tokens_24h") == [123, 0, 0, 45]
                for s in tj.get("sessions", [])
            ), f"OTLP session missing: {tj}"

            # 10. Dynamic local inference gateway via POST /api/routing
            sc, _, body = http_req(
                f"http://127.0.0.1:{rs_port}/api/routing",
                method="POST",
                headers=csrf_headers,
                data=json.dumps({"enabled": True, "threshold": 85, "account_priority": []}).encode(),
            )
            assert sc == 200, f"Enable gateway failed: {sc} {body}"
            rj = json.loads(body)
            assert rj["ok"] is True and rj["running"] is True and rj["port"] == rs_gw_port

            gw_key = json.loads((Path(td_rs) / "gateway-key.json").read_text())["key"]
            assert http_req(f"http://127.0.0.1:{rs_gw_port}/status")[0] == 401
            sc_gw, _, b_gw = http_req(
                f"http://127.0.0.1:{rs_gw_port}/status",
                headers={"Authorization": f"Bearer {gw_key}"},
            )
            assert sc_gw == 200, f"Gateway /status failed: {sc_gw} {b_gw}"

            sc, _, body = http_req(
                f"http://127.0.0.1:{rs_port}/api/routing",
                method="POST",
                headers=csrf_headers,
                data=json.dumps({"enabled": False, "threshold": 85, "account_priority": []}).encode(),
            )
            assert sc == 200 and json.loads(body)["running"] is False

            # 11. Isolated non-contending steady-state benchmarks (terminate peer before measuring!)
            def stop_proc(proc):
                if proc is None:
                    return
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)

            stop_proc(p_py)
            p_py = None

            # Wait until Antigravity initial catch-up finishes (loading==false) or max 4 ticks, then measure 5 steady ticks
            def measure_steady(port, pid):
                for _ in range(4):
                    time.sleep(3.1)
                    st = json.loads(http_req(f"http://127.0.0.1:{port}/api/state")[2])
                    if not any(s.get("loading") for s in st.get("sessions", [])):
                        break
                ticks = []
                last_u = 0.0
                for _ in range(5):
                    time.sleep(3.1)
                    st = json.loads(http_req(f"http://127.0.0.1:{port}/api/state")[2])
                    if st["updated"] != last_u:
                        ticks.append(st["collection_ms"])
                        last_u = st["updated"]

                def bench_get(path, n=50):
                    t0 = time.perf_counter()
                    for _ in range(n):
                        http_req(f"http://127.0.0.1:{port}{path}")
                    return (time.perf_counter() - t0) * 1000.0 / n

                state_ms = bench_get("/api/state", 50)
                appjs_ms = bench_get("/app.js", 50)
                hist_ms = bench_get("/api/history?period=1h&step=60", 20)
                rss_mb = int(subprocess.check_output(["ps", "-p", str(pid), "-o", "rss="], text=True).strip()) / 1024.0
                return ticks, state_ms, appjs_ms, hist_ms, rss_mb

            rs_ticks, rs_state_ms, rs_appjs_ms, rs_hist_ms, rs_rss_mb = measure_steady(rs_port, p_rs.pid)
            stop_proc(p_rs)
            p_rs = None

            # Now run Python alone for an apples-to-apples non-contending steady-state measurement
            p_py = subprocess.Popen(
                [sys.executable, "-m", "onetop.cli", "local", "--headless", "--port", str(py_port), "--gateway-port", str(py_gw_port)],
                env=env_py,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            wait_health(py_port, require_ready=True, timeout=30.0)
            py_ticks, py_state_ms, py_appjs_ms, py_hist_ms, py_rss_mb = measure_steady(py_port, p_py.pid)
            bin_mb = RS_BIN.stat().st_size / (1024.0 * 1024.0)

            return {
                "zero_python_children": True,
                "single_instance_lock": True,
                "static_routes_verified": len(STATIC_ROUTES),
                "api_schema_parity": True,
                "security_guards_verified": True,
                "otlp_gzip_ingest_verified": True,
                "dynamic_gateway_verified": True,
                "sessions_observed": {"rust": len(rs_state["sessions"]), "python": len(py_state["sessions"])},
                "binary_size_mb": round(bin_mb, 2),
                "startup_listen_ms": {"python": round(py_listen_ms, 1), "rust": round(rs_listen_ms, 1)},
                "startup_ready_ms": {"python": round(py_ready_total_ms, 1), "rust": round(rs_ready_total_ms, 1)},
                "steady_state_rss_mb": {"python": round(py_rss_mb, 1), "rust": round(rs_rss_mb, 1)},
                "collection_ms_samples": {"python": py_ticks, "rust": rs_ticks},
                "collection_ms_median": {
                    "python": round(statistics.median(py_ticks), 1) if py_ticks else None,
                    "rust": round(statistics.median(rs_ticks), 1) if rs_ticks else None,
                    "speedup": round(statistics.median(py_ticks) / max(0.1, statistics.median(rs_ticks)), 2)
                    if py_ticks and rs_ticks
                    else None,
                },
                "http_latency_ms": {
                    "api_state": {
                        "python": round(py_state_ms, 2),
                        "rust": round(rs_state_ms, 2),
                        "speedup": round(py_state_ms / max(0.01, rs_state_ms), 2),
                    },
                    "api_history": {
                        "python": round(py_hist_ms, 2),
                        "rust": round(rs_hist_ms, 2),
                        "speedup": round(py_hist_ms / max(0.01, rs_hist_ms), 2),
                    },
                    "static_app_js": {
                        "python": round(py_appjs_ms, 2),
                        "rust": round(rs_appjs_ms, 2),
                        "speedup": round(py_appjs_ms / max(0.01, rs_appjs_ms), 2),
                    },
                },
            }
        finally:
            for p in (p_rs, p_py):
                if p is None:
                    continue
                p.terminate()
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait(timeout=5)


def main():
    cli = test_cli_parity()
    e2e = test_standalone_e2e()
    print(json.dumps({"cli": cli, "e2e_standalone": e2e}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
