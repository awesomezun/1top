"""Differential behavioral verification & A/A benchmark harness for 1top Rust migration.

Follows rust-anything (record/diff/gate/replay) and fast-anything (real calls + edge cases
+ A/A control rounds). Strictly read-only against user data; any collector run uses a
fresh temporary DATA directory.
"""
import json
import os
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "agent"))

from onetop import _rust_bridge, pricing  # noqa: E402
from onetop.observe import antigravity, devin, transcripts  # noqa: E402


def assert_equal_approx(label, py_val, rs_val, tol=1e-6):
    if isinstance(py_val, float) or isinstance(rs_val, float):
        if isinstance(py_val, (int, float)) and isinstance(rs_val, (int, float)):
            if abs(py_val - rs_val) <= tol * max(1.0, abs(py_val), abs(rs_val)):
                return
        raise AssertionError(f"{label}: float mismatch py={py_val!r} rs={rs_val!r}")
    if isinstance(py_val, dict) and isinstance(rs_val, dict):
        if set(py_val.keys()) != set(rs_val.keys()):
            raise AssertionError(f"{label}: keys differ py={set(py_val)} rs={set(rs_val)}")
        for k in py_val:
            assert_equal_approx(f"{label}[{k!r}]", py_val[k], rs_val[k], tol)
        return
    if isinstance(py_val, (list, tuple)) and isinstance(rs_val, (list, tuple)):
        if len(py_val) != len(rs_val):
            raise AssertionError(f"{label}: len differs py={len(py_val)} rs={len(rs_val)}")
        for i, (a, b) in enumerate(zip(py_val, rs_val)):
            assert_equal_approx(f"{label}[{i}]", a, b, tol)
        return
    if py_val != rs_val:
        raise AssertionError(f"{label}: value mismatch py={py_val!r} rs={rs_val!r}")


def diff_pricing():
    models = [
        None, "", "unknown", "claude-opus-5-5", "anthropic/claude-opus-5-5-20261101[1m]",
        "anthropic/claude-opus-5-5[1m]-20261101", "CLAUDE-SONNET-4-6", "claude-fable-5-1",
        "claude-mythos-5", "gpt-6.1-sol", "gpt-5.3-codex", "glm-5.3-flash", "glm-5.3",
        "gemini-4-neon", "claude-opus-5-99", "  openai/gpt-6-astra[200k]  ",
    ]
    tok_cases = [[0, 0, 0, 0], [1000, 50000, 2000, 500], [1234567, 89012345, 0, 9999]]
    checked = 0
    for m in models:
        assert_equal_approx(f"pricing.normalize({m!r})", pricing._py_normalize(m), _rust_bridge.native.pricing_normalize("" if not m else str(m)))
        assert_equal_approx(f"pricing.price({m!r})", pricing._py_price(m), _rust_bridge.native.pricing_price("" if not m else str(m)))
        for t in tok_cases:
            assert_equal_approx(
                f"pricing.value({m!r},{t})",
                pricing._py_value(m, t),
                _rust_bridge.native.pricing_value("" if not m else str(m), [float(x) for x in t]),
            )
            checked += 1
    plans = [
        ("Claude", "max", "default_claude_max_5x"),
        ("Claude", "max", "claude_max_20x"),
        ("Claude", "pro", ""),
        ("Claude", "ultra", ""),
        ("Claude", "free", ""),
        ("Claude", "enterprise", ""),
        ("Claude", "", ""),
        ("Codex", "free", ""),
        ("Codex", "go", ""),
        ("Codex", "plus", ""),
        ("Codex", "pro", ""),
        ("Codex", "team", ""),
        ("GLM", "lite", ""),
        ("GLM", "pro", ""),
        ("Antigravity", "", ""),
        ("Antigravity", "pro", ""),
        ("Devin", "team", ""),
    ]
    for kind, pn, tier in plans:
        assert_equal_approx(
            f"pricing.plan({kind},{pn},{tier})",
            pricing._py_plan(kind, pn, tier),
            _rust_bridge.native.pricing_plan(kind, pn, tier),
        )
        checked += 1
    return checked


def diff_antigravity_real_and_edges():
    checked = 0
    # Edge wire inputs (including errors)
    bad_wires = [b"\x80", b"\x0a\x05abc", b"\x08" + b"\x80" * 10 + b"\x01", b"\x0b"]
    for bw in bad_wires:
        py_err = rs_err = None
        try:
            antigravity._py_fields(bw)
        except Exception as e:
            py_err = type(e).__name__
        try:
            _rust_bridge.native.ag_fields(bw)
        except Exception as e:
            rs_err = type(e).__name__
        assert py_err is not None and rs_err is not None, f"edge wire error mismatch on {bw!r}: py={py_err} rs={rs_err}"
        checked += 1

    # Real Antigravity summaries + conversation DBs (read-only)
    home = Path.home()
    roots = antigravity.roots(home)
    for root in roots:
        py_cat = antigravity._py_catalog(root)
        rs_cat = _rust_bridge.native.ag_catalog(str(root))
        assert_equal_approx(f"antigravity.catalog({root})", py_cat, rs_cat, tol=1e-3)
        checked += len(py_cat) + 1

        conv_dir = root / "conversations"
        if conv_dir.is_dir():
            dbs = sorted(conv_dir.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)[:15]
            for dbp in dbs:
                saved_models = dict(antigravity.MODELS)
                try:
                    py_res = antigravity._py_usage(dbp, -1)
                except sqlite3.Error:
                    continue
                finally:
                    antigravity.MODELS.clear()
                    antigravity.MODELS.update(saved_models)
                rs_last, rs_rows, _ = _rust_bridge.native.ag_usage(str(dbp), -1, saved_models)
                assert_equal_approx(f"antigravity.usage({dbp.name})", py_res, (rs_last, rs_rows), tol=1e-6)
                checked += len(rs_rows) + 1
    return checked, roots


def diff_devin_real_and_edges():
    checked = 0
    now = time.time()
    # Synthetic edge-case Devin DB
    with tempfile.TemporaryDirectory() as td:
        dbp = Path(td) / "sessions.db"
        con = sqlite3.connect(dbp)
        con.execute("CREATE TABLE sessions (id TEXT, working_directory TEXT, model TEXT, title TEXT, created_at TEXT, last_activity_at REAL, hidden INT)")
        con.execute("CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY, session_id TEXT, created_at TEXT, chat_message TEXT)")
        con.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, 0)", ("sess-1", "/tmp/proj", "swe-2-1", "  안녕\u00a0세계\u200b🦀\t ", "2026-11-25T10:00:00Z", now - 10))
        con.execute("INSERT INTO message_nodes VALUES (1, 'sess-1', '2026-11-25T10:00:01Z', ?)", (json.dumps({
            "role": "assistant", "message_id": "m1",
            "metadata": {"finish_reason": "tool_use", "generation_model": "compactor",
                         "metrics": {"input_tokens": 100, "cache_read_tokens": 50, "cache_creation_tokens": 10, "output_tokens": 25}}
        }),))
        con.execute("INSERT INTO message_nodes VALUES (2, 'sess-1', '2026-11-25T10:00:05Z', ?)", (json.dumps({
            "role": "assistant", "message_id": "m2",
            "metadata": {"finish_reason": "stop", "generation_model": "swe-2-1",
                         "metrics": {"input_tokens": 200, "cache_read_tokens": 0, "cache_creation_tokens": 0, "output_tokens": 40}}
        }),))
        con.commit()
        con.close()

        assert_equal_approx("devin.sessions(synth)", devin._py_sessions(dbp, now, 86400), _rust_bridge.native.devin_sessions(str(dbp), now, 86400))
        assert_equal_approx("devin.usage(synth)", devin._py_usage(dbp, 0, now, 5000), _rust_bridge.native.devin_usage(str(dbp), 0, now, 5000))
        checked += 4

    # Real Devin DB (read-only)
    real_db = devin.database(Path.home())
    if real_db.is_file():
        py_s = devin._py_sessions(real_db, now, 86400)
        rs_s = _rust_bridge.native.devin_sessions(str(real_db), now, 86400)
        assert_equal_approx("devin.sessions(real)", py_s, rs_s, tol=1e-3)
        checked += len(py_s)

        py_u = devin._py_usage(real_db, 0, now, 5000)
        rs_u = _rust_bridge.native.devin_usage(str(real_db), 0, now, 5000)
        assert_equal_approx("devin.usage(real)", py_u, rs_u, tol=1e-3)
        checked += len(py_u[1])
    return checked, real_db if real_db.is_file() else None


def diff_transcripts():
    sample = "\n".join([
        json.dumps({"type": "user", "timestamp": "2026-11-25T10:00:00Z", "message": {"content": "  <command-name>/help</command-name>"}}),
        json.dumps({"type": "user", "timestamp": "2026-11-25T10:00:01Z", "message": {"content": [{"type": "text", "text": "  [Request interrupted by user]"}]}}),
        json.dumps({"type": "assistant", "timestamp": "2026-11-25T10:00:02Z", "isSidechain": False, "message": {"stop_reason": "end_turn", "content": [{"type": "tool_use"}, {"type": "tool_result"}]}}),
        json.dumps({"type": "event_msg", "timestamp": 1795600000, "payload": {"type": "task_started"}}),
        "malformed json line {{{",
        "",
    ]).encode("utf-8") + b"\xff\xfe\n"
    py_f = transcripts._py_facts(sample)
    rs_f = _rust_bridge.native.transcript_facts(sample)
    assert_equal_approx("transcripts.facts", py_f, rs_f)
    return len(py_f)


def bench_hotspots(ag_roots, devin_db):
    results = {}
    # 1. Antigravity usage benchmark on top 15 real DBs
    ag_dbs = []
    for r in ag_roots:
        cd = r / "conversations"
        if cd.is_dir():
            ag_dbs.extend(sorted(cd.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)[:15])
    ag_dbs = ag_dbs[:15]
    if ag_dbs:
        def run_ag(mode):
            os.environ["ONETOP_RUST_MODE"] = mode
            t0 = time.perf_counter()
            for p in ag_dbs:
                try:
                    antigravity.usage(p, -1)
                except sqlite3.Error:
                    pass
            return (time.perf_counter() - t0) * 1000

        py1, py2, rs = [], [], []
        for _ in range(3):
            py1.append(run_ag("old"))
            py2.append(run_ag("old"))
            rs.append(run_ag("new"))
        results["antigravity_usage_15dbs_ms"] = {
            "python_aa1": round(statistics.median(py1), 2),
            "python_aa2": round(statistics.median(py2), 2),
            "rust": round(statistics.median(rs), 2),
            "speedup": round(statistics.median(py1) / max(0.01, statistics.median(rs)), 2),
        }

    # 2. Devin usage benchmark on real DB
    if devin_db:
        now = time.time()
        def run_devin(mode):
            os.environ["ONETOP_RUST_MODE"] = mode
            t0 = time.perf_counter()
            devin.usage(devin_db, 0, now, 5000)
            return (time.perf_counter() - t0) * 1000

        py1, py2, rs = [], [], []
        for _ in range(3):
            py1.append(run_devin("old"))
            py2.append(run_devin("old"))
            rs.append(run_devin("new"))
        results["devin_usage_5000rows_ms"] = {
            "python_aa1": round(statistics.median(py1), 2),
            "python_aa2": round(statistics.median(py2), 2),
            "rust": round(statistics.median(rs), 2),
            "speedup": round(statistics.median(py1) / max(0.01, statistics.median(rs)), 2),
        }

    os.environ["ONETOP_RUST_MODE"] = "new"
    return results


def verify_http_front_door():
    rs_bin = REPO / "rust/target/release/onetop-agent"
    assert rs_bin.is_file(), f"Missing binary: {rs_bin}"

    # 1. CLI `version` parity & startup latency
    t0 = time.perf_counter()
    rs_ver = subprocess.check_output([str(rs_bin), "version"], text=True).strip()
    rs_cli_ms = (time.perf_counter() - t0) * 1000

    env_py = {**os.environ, "PYTHONPATH": str(REPO / "agent")}
    t0 = time.perf_counter()
    py_ver = subprocess.check_output([sys.executable, "-m", "onetop.cli", "version"], env=env_py, text=True).strip()
    py_cli_ms = (time.perf_counter() - t0) * 1000
    assert rs_ver == py_ver, f"version mismatch: rs={rs_ver!r} py={py_ver!r}"

    # 2. Live HTTP server front-door replay in isolated temp DATA directory
    py_port = 19866
    rs_port = 19867
    with tempfile.TemporaryDirectory() as td:
        td_py = Path(td) / "py_data"
        td_py.mkdir(parents=True, exist_ok=True)
        p_py = subprocess.Popen(
            [sys.executable, "-m", "onetop.cli", "local", "--headless", "--port", str(py_port), "--gateway-port", str(py_port + 10)],
            env={**env_py, "ONETOP_DATA": str(td_py)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        p_rs = None
        try:
            # Wait for Python backend ready
            for _ in range(200):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{py_port}/health", timeout=1) as r:
                        if r.status == 200 and json.loads(r.read()).get("ready") is True:
                            break
                except Exception:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Python test server failed to start")

            td_rs = Path(td) / "rs_data"
            td_rs.mkdir(parents=True, exist_ok=True)
            p_rs = subprocess.Popen(
                [str(rs_bin), "local", "--headless", "--port", str(rs_port), "--dist-dir", str(REPO / "agent/onetop/dist")],
                env={**os.environ, "ONETOP_REPO_ROOT": str(REPO), "ONETOP_DATA": str(td_rs)},
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(200):
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{rs_port}/health", timeout=1) as r:
                        if r.status == 200 and json.loads(r.read()).get("ready") is True:
                            break
                except Exception:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Rust standalone agent failed to become ready")

            # Check ALL 45 static routes byte-for-byte + headers!
            static_routes = [
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
            for route in static_routes:
                with urllib.request.urlopen(f"http://127.0.0.1:{py_port}{route}", timeout=5) as rp:
                    py_b, py_h = rp.read(), rp.headers
                with urllib.request.urlopen(f"http://127.0.0.1:{rs_port}{route}", timeout=5) as rr:
                    rs_b, rs_h = rr.read(), rr.headers
                assert py_b == rs_b, f"Static body mismatch on {route}"
                for hdr in ("Content-Type", "Cache-Control", "X-Content-Type-Options", "Content-Security-Policy"):
                    assert py_h.get(hdr) == rs_h.get(hdr), f"Header {hdr} mismatch on {route}: py={py_h.get(hdr)!r} rs={rs_h.get(hdr)!r}"

            # Check API proxy routes + 404 + 403 bad Host
            for api_route in ("/health", "/api/notifications", "/api/routing", "/api/telemetry", "/api/state"):
                with urllib.request.urlopen(f"http://127.0.0.1:{py_port}{api_route}", timeout=5) as rp:
                    py_j = json.loads(rp.read())
                with urllib.request.urlopen(f"http://127.0.0.1:{rs_port}{api_route}", timeout=5) as rr:
                    rs_j = json.loads(rr.read())
                assert set(py_j.keys()) == set(rs_j.keys()), f"API keys mismatch on {api_route}"

            # 404 check
            for port in (py_port, rs_port):
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{port}/nonexistent", timeout=5)
                    raise AssertionError(f"Expected 404 on port {port}")
                except urllib.error.HTTPError as e:
                    assert e.code == 404

            # Bad Host -> 403 check
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{rs_port}/", headers={"Host": "evil.example.com"})
                urllib.request.urlopen(req, timeout=5)
                raise AssertionError("Expected 403 for bad Host")
            except urllib.error.HTTPError as e:
                assert e.code == 403

            # Measure static latency (50 requests of /app.js) & Rust RSS
            t0 = time.perf_counter()
            for _ in range(50):
                urllib.request.urlopen(f"http://127.0.0.1:{py_port}/app.js", timeout=5).read()
            py_static_ms = (time.perf_counter() - t0) * 1000 / 50

            t0 = time.perf_counter()
            for _ in range(50):
                urllib.request.urlopen(f"http://127.0.0.1:{rs_port}/app.js", timeout=5).read()
            rs_static_ms = (time.perf_counter() - t0) * 1000 / 50

            rss_kb = int(subprocess.check_output(["ps", "-p", str(p_rs.pid), "-o", "rss="], text=True).strip())
            bin_mb = rs_bin.stat().st_size / (1024 * 1024)
            return {
                "version": rs_ver,
                "cli_version_ms": {"python": round(py_cli_ms, 1), "rust": round(rs_cli_ms, 1)},
                "static_routes_verified": len(static_routes),
                "static_app_js_ms": {"python": round(py_static_ms, 2), "rust": round(rs_static_ms, 2)},
                "rust_frontdoor_rss_mb": round(rss_kb / 1024, 1),
                "rust_binary_mb": round(bin_mb, 2),
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
    assert _rust_bridge.native is not None, "Native Rust extension _onetop_rs not loaded!"
    p_cnt = diff_pricing()
    ag_cnt, ag_roots = diff_antigravity_real_and_edges()
    dv_cnt, devin_db = diff_devin_real_and_edges()
    tr_cnt = diff_transcripts()
    benches = bench_hotspots(ag_roots, devin_db)
    http_res = verify_http_front_door()
    print(json.dumps({
        "diff_cases_passed": {
            "pricing": p_cnt,
            "antigravity": ag_cnt,
            "devin": dv_cnt,
            "transcripts": tr_cnt,
            "total": p_cnt + ag_cnt + dv_cnt + tr_cnt,
        },
        "benchmarks": benches,
        "http_front_door": http_res,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
