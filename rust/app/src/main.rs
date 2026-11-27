//! Standalone pure-Rust 1top backend agent (`onetop-agent`).
//! Zero Python runtime dependency; full CLI + HTTP + OTLP + Gateway + Cloud WebSocket parity.
#![forbid(unsafe_code)]

mod capture;
mod collector;
mod gateway_server;
mod relay_ws;

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use base64::Engine;
use clap::Parser;
use collector::Collector;
use gateway_server::{run_standalone_gateway, GatewayService};
use onetop_core::accounts::{
    authorize_claude_profile, profile_roots, run_statusline_cli, AccountLogin,
};
use onetop_core::assets::{resolve_static_asset, CSP_HEADER};
use onetop_core::bridge::{open_url, relay_origin, save_private_json};
use onetop_core::controls::Controller;
use onetop_core::gateway::run_gateway_client;
use onetop_core::platform_support::data_directory;
use onetop_core::reports;
use onetop_core::session_order::ordered_snapshot;
use onetop_core::telemetry::{
    decode_otlp, receiver_key, telemetry_disable, telemetry_enable, TelemetryStore, MAX_BODY,
};
use onetop_core::updates::UpdateMonitor;
use onetop_core::APP_VERSION;
use rand::RngCore;
use relay_ws::CloudLink;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use url::form_urlencoded;

const VALID_COMMANDS: &[&str] = &[
    "run",
    "connect",
    "local",
    "version",
    "capture-sessions",
    "statusline",
    "telemetry-enable",
    "telemetry-disable",
    "telemetry-status",
    "authorize-claude",
    "gateway",
    "gateway-claude",
    "gateway-codex",
    "gateway-glm",
];

#[derive(Debug, Parser)]
#[command(
    name = "1top",
    about = "Your AI agents, across apps and computers.",
    disable_version_flag = true
)]
struct Cli {
    #[arg(default_value = "run")]
    command: String,

    #[arg(long)]
    output: Option<String>,

    #[arg(long)]
    profile: Option<String>,

    #[arg(long)]
    config: Option<String>,

    #[arg(long, default_value_t = 18766)]
    port: u16,

    #[arg(long, default_value_t = 18767)]
    gateway_port: u16,

    #[arg(long)]
    headless: bool,

    #[arg(long)]
    relay: Option<String>,

    /// Optional override for static dashboard assets directory (`agent/onetop/dist`).
    #[arg(long, env = "ONETOP_DIST_DIR")]
    dist_dir: Option<PathBuf>,
}

type StateCacheEntry = ((u64, u64, u64), Vec<u8>);

struct AppState {
    port: u16,
    data_dir: PathBuf,
    dist_dir: Option<PathBuf>,
    collector: Arc<Collector>,
    controller: Arc<Controller>,
    routing: Arc<GatewayService>,
    account_login: Arc<AccountLogin>,
    bridge: Arc<CloudLink>,
    updates: Arc<UpdateMonitor>,
    action_token: String,
    telemetry_key: Option<String>,
    telemetry_last_error: Mutex<Option<String>>,
    state_rev: AtomicU64,
    state_cache: Mutex<Option<StateCacheEntry>>,
    diagnostics: bool,
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn ct_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

fn token_urlsafe_32() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn find_repo_root() -> Option<PathBuf> {
    if let Ok(env_root) = std::env::var("ONETOP_REPO_ROOT") {
        let p = PathBuf::from(env_root);
        if p.join("agent/onetop/dist/index.html").is_file() {
            return Some(p);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        for anc in cwd.ancestors() {
            if anc.join("agent/onetop/dist/index.html").is_file() {
                return Some(anc.to_path_buf());
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors() {
            if anc.join("agent/onetop/dist/index.html").is_file() {
                return Some(anc.to_path_buf());
            }
        }
    }
    None
}

fn resolve_dist_dir(explicit: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = explicit {
        if p.join("index.html").is_file() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("dist");
            if bundled.join("index.html").is_file() {
                return Some(bundled);
            }
            let alt = parent.join("onetop/dist");
            if alt.join("index.html").is_file() {
                return Some(alt);
            }
        }
    }
    if let Some(root) = find_repo_root() {
        let d = root.join("agent/onetop/dist");
        if d.join("index.html").is_file() {
            return Some(d);
        }
    }
    None
}

fn parse_query(query: Option<&str>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(q) = query {
        for (k, v) in form_urlencoded::parse(q.as_bytes()) {
            map.entry(k.into_owned()).or_insert_with(|| v.into_owned());
        }
    }
    map
}

fn json_response(status: StatusCode, payload: &Value, diagnostics: bool) -> Response {
    let data = serde_json::to_vec(payload).unwrap_or_else(|_| b"{}".to_vec());
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_LENGTH, data.len());
    if diagnostics {
        builder = builder.header("X-1top-Runtime", "rust");
    }
    builder
        .body(Body::from(data))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn is_allowed_get_host(headers: &HeaderMap) -> bool {
    let Some(host_val) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let host_only = host_val.split(':').next().unwrap_or("");
    matches!(host_only, "127.0.0.1" | "localhost")
}

fn is_exact_local_host(headers: &HeaderMap, port: u16) -> Option<String> {
    let host = headers.get(header::HOST)?.to_str().ok()?;
    if host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}") {
        Some(host.to_string())
    } else {
        None
    }
}

async fn handle_otlp_post(
    state: Arc<AppState>,
    path: &str,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let signal = path.strip_prefix("/v1/").unwrap_or("").to_string();
    let Some(ref expected_key) = state.telemetry_key else {
        return json_response(
            StatusCode::FORBIDDEN,
            &json!({"code": 7, "message": "Local telemetry authentication required."}),
            state.diagnostics,
        );
    };
    let provided = headers
        .get("X-1top-Telemetry-Key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if is_exact_local_host(&headers, state.port).is_none()
        || headers.contains_key(header::ORIGIN)
        || !ct_eq(provided, expected_key)
    {
        return json_response(
            StatusCode::FORBIDDEN,
            &json!({"code": 7, "message": "Local telemetry authentication required."}),
            state.diagnostics,
        );
    }

    let Some(store) = state.collector.telemetry_store() else {
        return json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            &json!({"code": 14, "message": "Telemetry receiver is starting."}),
            state.diagnostics,
        );
    };

    if headers.contains_key(header::TRANSFER_ENCODING) {
        return json_response(
            StatusCode::BAD_REQUEST,
            &json!({"code": 3, "message": "Invalid or unsupported OTLP payload."}),
            state.diagnostics,
        );
    }
    let size = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    if size == 0 || size > MAX_BODY {
        return json_response(
            StatusCode::BAD_REQUEST,
            &json!({"code": 3, "message": "Invalid or unsupported OTLP payload."}),
            state.diagnostics,
        );
    }

    let raw = match tokio::time::timeout(Duration::from_secs(5), to_bytes(body, MAX_BODY)).await {
        Ok(Ok(b)) if b.len() == size => b,
        _ => {
            return json_response(
                StatusCode::BAD_REQUEST,
                &json!({"code": 3, "message": "Invalid or unsupported OTLP payload."}),
                state.diagnostics,
            );
        }
    };

    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_encoding = headers
        .get(header::CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let ct_clone = content_type.clone();
    let res = tokio::task::spawn_blocking(move || {
        let doc = decode_otlp(&raw, &signal, &ct_clone, &content_encoding)
            .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
        store.ingest(&signal, &doc, None).map_err(|e| {
            let status =
                if e.to_lowercase().contains("sqlite") || e.to_lowercase().contains("database") {
                    StatusCode::SERVICE_UNAVAILABLE
                } else {
                    StatusCode::BAD_REQUEST
                };
            (status, e)
        })
    })
    .await;

    match res {
        Ok(Ok(_)) => {
            if content_type == "application/x-protobuf" {
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, content_type)
                    .header(header::CONTENT_LENGTH, "0")
                    .body(Body::empty())
                    .unwrap_or_else(|_| StatusCode::OK.into_response())
            } else {
                json_response(StatusCode::OK, &json!({}), state.diagnostics)
            }
        }
        Ok(Err((StatusCode::SERVICE_UNAVAILABLE, _))) => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            &json!({"code": 14, "message": "Telemetry storage temporarily unavailable."}),
            state.diagnostics,
        ),
        Ok(Err((_, err_name))) => {
            if let Ok(mut le) = state.telemetry_last_error.lock() {
                *le = Some(err_name);
            }
            json_response(
                StatusCode::BAD_REQUEST,
                &json!({"code": 3, "message": "Invalid or unsupported OTLP payload."}),
                state.diagnostics,
            )
        }
        Err(_) => json_response(
            StatusCode::SERVICE_UNAVAILABLE,
            &json!({"code": 14, "message": "Telemetry storage temporarily unavailable."}),
            state.diagnostics,
        ),
    }
}

async fn handle_post(state: Arc<AppState>, path: &str, headers: HeaderMap, body: Body) -> Response {
    if matches!(path, "/v1/logs" | "/v1/metrics" | "/v1/traces") {
        return handle_otlp_post(state, path, headers, body).await;
    }

    let Some(host) = is_exact_local_host(&headers, state.port) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    let expected_origin = format!("http://{host}");
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let monitor_token = headers
        .get("X-Monitor-Token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if origin != expected_origin || !ct_eq(monitor_token, &state.action_token) {
        return StatusCode::FORBIDDEN.into_response();
    }

    if !matches!(
        path,
        "/api/action"
            | "/api/mailbox"
            | "/api/accounts/login"
            | "/api/accounts/authorize"
            | "/api/accounts/alias"
            | "/api/routing"
            | "/api/notifications"
            | "/api/reports/plan"
    ) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let max_len = if path == "/api/action" {
        2_200_000
    } else {
        4096
    };
    let length = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(0);
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if length < 1 || length > max_len || content_type != "application/json" {
        return StatusCode::BAD_REQUEST.into_response();
    }

    let Ok(raw) = to_bytes(body, max_len).await else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(Value::Object(payload)) = serde_json::from_slice::<Value>(&raw) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            &json!({"ok": false, "message": "잘못된 요청입니다."}),
            state.diagnostics,
        );
    };

    let route = path.to_string();
    let st = Arc::clone(&state);
    let outcome = tokio::task::spawn_blocking(
        move || -> Result<Map<String, Value>, (StatusCode, String)> {
            match route.as_str() {
                "/api/mailbox" => {
                    let sid = payload
                        .get("session_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let key = payload
                        .get("control_key")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let snap = st.collector.raw_snapshot();
                    let msgs = st.controller.read_mailbox(&snap, sid, key).map_err(|e| {
                        (
                            StatusCode::from_u16(e.status).unwrap_or(StatusCode::CONFLICT),
                            e.message,
                        )
                    })?;
                    let mut m = Map::new();
                    m.insert("messages".into(), Value::Array(msgs));
                    Ok(m)
                }
                "/api/routing" => {
                    let val = st
                        .routing
                        .configure(&payload)
                        .map_err(|_| (StatusCode::BAD_REQUEST, "잘못된 요청입니다.".to_string()))?;
                    Ok(val.as_object().cloned().unwrap_or_default())
                }
                "/api/accounts/login" => {
                    let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                    let val = if kind == "GLM" {
                        let host = payload
                            .get("host")
                            .and_then(|v| v.as_str())
                            .unwrap_or("api.z.ai");
                        let api_key = payload
                            .get("api_key")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        st.account_login.save_glm(host, api_key)
                    } else {
                        st.account_login.start(kind)
                    }
                    .map_err(|(code, msg)| {
                        (
                            StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST),
                            msg,
                        )
                    })?;
                    let acc = st.collector.accounts();
                    acc.clear_backoff(Some(kind));
                    if kind == "GLM" {
                        let _ = std::thread::Builder::new()
                            .name("1top-acc-refresh".into())
                            .spawn(move || acc.sample_once());
                    }
                    Ok(val.as_object().cloned().unwrap_or_default())
                }
                "/api/accounts/authorize" => {
                    let aid = payload
                        .get("account_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let val = st
                        .account_login
                        .authorize_claude(aid)
                        .map_err(|(code, msg)| {
                            (
                                StatusCode::from_u16(code).unwrap_or(StatusCode::BAD_REQUEST),
                                msg,
                            )
                        })?;
                    let acc = st.collector.accounts();
                    acc.clear_backoff(Some(aid));
                    let _ = std::thread::Builder::new()
                        .name("1top-acc-refresh".into())
                        .spawn(move || acc.sample_once());
                    Ok(val.as_object().cloned().unwrap_or_default())
                }
                "/api/notifications" => {
                    let settings = reports::set_settings(&st.data_dir, &payload)
                        .map_err(|_| (StatusCode::BAD_REQUEST, "잘못된 요청입니다.".to_string()))?;
                    let mut m = Map::new();
                    m.insert("settings".into(), settings);
                    Ok(m)
                }
                "/api/reports/plan" => {
                    let snap = st.collector.raw_snapshot();
                    let known: HashSet<String> = snap
                        .get("account_quotas")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|r| {
                                    r.get("id").and_then(|v| v.as_str()).map(str::to_string)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let aid = payload
                        .get("account_id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| {
                            (StatusCode::BAD_REQUEST, "잘못된 요청입니다.".to_string())
                        })?;
                    let plan = payload.get("plan").and_then(|v| v.as_str());
                    let price = payload.get("price").and_then(|v| v.as_f64());
                    let saved = reports::set_plan(&st.data_dir, aid, plan, price, &known)
                        .map_err(|_| (StatusCode::BAD_REQUEST, "잘못된 요청입니다.".to_string()))?;
                    st.collector.invalidate_value_report();
                    let mut m = Map::new();
                    m.insert("plan".into(), saved.unwrap_or(Value::Null));
                    Ok(m)
                }
                "/api/accounts/alias" => {
                    let aid = payload.get("account_id").and_then(|v| v.as_str());
                    let alias = payload.get("alias").and_then(|v| v.as_str());
                    let saved = st
                        .collector
                        .set_account_alias(aid, alias)
                        .map_err(|_| (StatusCode::BAD_REQUEST, "잘못된 요청입니다.".to_string()))?;
                    let mut m = Map::new();
                    m.insert("alias".into(), Value::String(saved));
                    Ok(m)
                }
                "/api/action" => {
                    let snap = st.collector.raw_snapshot();
                    let res = st.controller.execute(&snap, &payload, true).map_err(|e| {
                        (
                            StatusCode::from_u16(e.status).unwrap_or(StatusCode::CONFLICT),
                            e.message,
                        )
                    })?;
                    Ok(res.as_object().cloned().unwrap_or_default())
                }
                _ => Err((StatusCode::NOT_FOUND, "Not found".to_string())),
            }
        },
    )
    .await;

    match outcome {
        Ok(Ok(mut map)) => {
            state.state_rev.fetch_add(1, Ordering::Relaxed);
            map.insert("ok".into(), Value::Bool(true));
            json_response(StatusCode::OK, &Value::Object(map), state.diagnostics)
        }
        Ok(Err((status, msg))) => json_response(
            status,
            &json!({"ok": false, "message": msg}),
            state.diagnostics,
        ),
        Err(_) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &json!({"ok": false, "message": "동작을 확인하지 못했습니다. 터미널에서 현재 상태를 확인하세요."}),
            state.diagnostics,
        ),
    }
}

async fn handle_get(
    state: Arc<AppState>,
    path: &str,
    query: Option<&str>,
    headers: HeaderMap,
) -> Response {
    if !is_allowed_get_host(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }

    match path {
        "/health" => {
            let ready = state.collector.is_ready();
            return json_response(
                StatusCode::OK,
                &json!({"ok": true, "app": "1top", "version": APP_VERSION, "ready": ready}),
                state.diagnostics,
            );
        }
        "/api/routing" => {
            let st = Arc::clone(&state);
            let val = tokio::task::spawn_blocking(move || st.routing.status())
                .await
                .unwrap_or_else(|_| json!({"enabled": false, "running": false}));
            return json_response(StatusCode::OK, &val, state.diagnostics);
        }
        "/api/usage-sessions" => {
            let q = parse_query(query);
            let period = q.get("period").cloned().unwrap_or_else(|| "1h".into());
            let offset = q.get("offset").cloned().unwrap_or_else(|| "0".into());
            let limit = q.get("limit").cloned().unwrap_or_else(|| "100".into());
            let st = Arc::clone(&state);
            let res = tokio::task::spawn_blocking(move || {
                st.collector.usage_sessions(&period, &offset, &limit)
            })
            .await;
            return match res {
                Ok(Ok(val)) => json_response(StatusCode::OK, &val, state.diagnostics),
                Ok(Err(collector::QueryError::Invalid(msg))) => json_response(
                    StatusCode::BAD_REQUEST,
                    &json!({"ok": false, "message": msg}),
                    state.diagnostics,
                ),
                Ok(Err(collector::QueryError::Unavailable(msg))) => json_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    &json!({"ok": false, "message": msg}),
                    state.diagnostics,
                ),
                Err(_) => json_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    &json!({"ok": false, "message": "Session archive is starting"}),
                    state.diagnostics,
                ),
            };
        }
        "/api/history" => {
            let q = parse_query(query);
            let period = q.get("period").cloned().unwrap_or_else(|| "1h".into());
            let step = q.get("step").cloned().unwrap_or_else(|| "60".into());
            let kind = q.get("kind").cloned();
            let st = Arc::clone(&state);
            let res = tokio::task::spawn_blocking(move || {
                st.collector
                    .history_response(&period, &step, kind.as_deref())
            })
            .await;
            return match res {
                Ok(Ok(val)) => json_response(StatusCode::OK, &val, state.diagnostics),
                Ok(Err(collector::QueryError::Invalid(msg))) => json_response(
                    StatusCode::BAD_REQUEST,
                    &json!({"ok": false, "message": msg}),
                    state.diagnostics,
                ),
                Ok(Err(collector::QueryError::Unavailable(msg))) => json_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    &json!({"ok": false, "message": msg}),
                    state.diagnostics,
                ),
                Err(_) => json_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    &json!({"ok": false, "message": "History collector is starting"}),
                    state.diagnostics,
                ),
            };
        }
        "/api/state" => {
            let q = parse_query(query);
            let period = q.get("period").cloned();
            if period.is_none() {
                let snap_ts = state.collector.snapshot_updated().to_bits();
                let rev = state.state_rev.load(Ordering::Relaxed);
                let ws_ts = state
                    .bridge
                    .workspace_usage_value()
                    .get("updated")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)
                    .to_bits();
                let cache_key = (snap_ts, rev, ws_ts);
                if let Ok(guard) = state.state_cache.lock() {
                    if let Some((k, ref bytes)) = *guard {
                        if k == cache_key {
                            let mut resp = Response::builder()
                                .status(StatusCode::OK)
                                .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
                                .header(header::CONTENT_LENGTH, bytes.len())
                                .header(header::CACHE_CONTROL, "no-store")
                                .header("X-Content-Type-Options", "nosniff")
                                .header("Content-Security-Policy", CSP_HEADER);
                            if state.diagnostics {
                                resp = resp.header("X-1top-Runtime", "rust");
                            }
                            return resp.body(Body::from(bytes.clone())).unwrap_or_else(|_| {
                                StatusCode::INTERNAL_SERVER_ERROR.into_response()
                            });
                        }
                    }
                }
                let st = Arc::clone(&state);
                let built = tokio::task::spawn_blocking(move || {
                    let mut snap = st.collector.raw_snapshot();
                    snap = st.controller.decorate(&snap);
                    snap = ordered_snapshot(&snap, "1h");
                    snap.insert("workspace_usage".into(), st.bridge.workspace_usage_value());
                    snap.insert(
                        "action_token".into(),
                        Value::String(st.action_token.clone()),
                    );
                    serde_json::to_vec(&Value::Object(snap)).unwrap_or_else(|_| b"{}".to_vec())
                })
                .await;
                return match built {
                    Ok(bytes) => {
                        if let Ok(mut guard) = state.state_cache.lock() {
                            *guard = Some((cache_key, bytes.clone()));
                        }
                        let mut resp = Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
                            .header(header::CONTENT_LENGTH, bytes.len())
                            .header(header::CACHE_CONTROL, "no-store")
                            .header("X-Content-Type-Options", "nosniff")
                            .header("Content-Security-Policy", CSP_HEADER);
                        if state.diagnostics {
                            resp = resp.header("X-1top-Runtime", "rust");
                        }
                        resp.body(Body::from(bytes))
                            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
                    }
                    Err(_) => json_response(
                        StatusCode::SERVICE_UNAVAILABLE,
                        &json!({"ok": false, "error": "state_temporarily_unavailable"}),
                        state.diagnostics,
                    ),
                };
            }
            let st = Arc::clone(&state);
            let res = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, (StatusCode, Value)> {
                let p = period.as_deref().unwrap_or("1h");
                let mut snap = st.collector.state_for_period(p).map_err(|e| match e {
                    collector::QueryError::Invalid(_) => (
                        StatusCode::BAD_REQUEST,
                        json!({"ok": false, "message": "유효한 기간을 입력하세요. 최소 10분입니다."}),
                    ),
                    collector::QueryError::Unavailable(_) => (
                        StatusCode::SERVICE_UNAVAILABLE,
                        json!({"ok": false, "error": "state_temporarily_unavailable"}),
                    ),
                })?;
                snap = st.controller.decorate(&snap);
                snap = ordered_snapshot(&snap, p);
                snap.insert("workspace_usage".into(), st.bridge.workspace_usage_value());
                snap.insert("action_token".into(), Value::String(st.action_token.clone()));
                Ok(serde_json::to_vec(&Value::Object(snap)).unwrap_or_else(|_| b"{}".to_vec()))
            })
            .await;
            return match res {
                Ok(Ok(bytes)) => {
                    let mut resp = Response::builder()
                        .status(StatusCode::OK)
                        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
                        .header(header::CONTENT_LENGTH, bytes.len())
                        .header(header::CACHE_CONTROL, "no-store")
                        .header("X-Content-Type-Options", "nosniff")
                        .header("Content-Security-Policy", CSP_HEADER);
                    if state.diagnostics {
                        resp = resp.header("X-1top-Runtime", "rust");
                    }
                    resp.body(Body::from(bytes))
                        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
                }
                Ok(Err((status, val))) => json_response(status, &val, state.diagnostics),
                Err(_) => json_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    &json!({"ok": false, "error": "state_temporarily_unavailable"}),
                    state.diagnostics,
                ),
            };
        }
        "/api/notifications" => {
            let dir = state.data_dir.clone();
            let settings = tokio::task::spawn_blocking(move || reports::read_settings(&dir))
                .await
                .unwrap_or_else(|_| json!({}));
            return json_response(
                StatusCode::OK,
                &json!({"ok": true, "settings": settings}),
                state.diagnostics,
            );
        }
        "/api/telemetry" => {
            let st = Arc::clone(&state);
            let val = tokio::task::spawn_blocking(move || {
                st.collector
                    .telemetry_store()
                    .and_then(|t| t.snapshot(None).ok())
                    .unwrap_or_else(|| json!({"ready": false}))
            })
            .await
            .unwrap_or_else(|_| json!({"ready": false}));
            return json_response(StatusCode::OK, &val, state.diagnostics);
        }
        "/api/updates" => {
            let val = state.updates.value();
            return json_response(StatusCode::OK, &val, state.diagnostics);
        }
        _ => {}
    }

    if let Some(spec) = resolve_static_asset(path) {
        if let Some(ref dist_dir) = state.dist_dir {
            let file_path = dist_dir.join(spec.rel_path);
            if let Ok(bytes) = tokio::fs::read(&file_path).await {
                let mut resp = Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, spec.content_type)
                    .header(header::CONTENT_LENGTH, bytes.len())
                    .header(header::CACHE_CONTROL, "no-store")
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Content-Security-Policy", CSP_HEADER);
                if state.diagnostics {
                    resp = resp.header("X-1top-Runtime", "rust");
                }
                if let Ok(built) = resp.body(Body::from(bytes)) {
                    return built;
                }
            }
        }
    }

    StatusCode::NOT_FOUND.into_response()
}

async fn handle_request(State(state): State<Arc<AppState>>, req: Request<Body>) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path = uri.path().to_string();
    let query = uri.query().map(str::to_string);
    let headers = req.headers().clone();

    match method {
        Method::GET => handle_get(state, &path, query.as_deref(), headers).await,
        Method::POST => handle_post(state, &path, headers, req.into_body()).await,
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

fn ensure_private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

async fn wait_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).ok();
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = async {
                if let Some(ref mut s) = sigterm {
                    s.recv().await;
                } else {
                    std::future::pending::<()>().await;
                }
            } => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    let raw_args: Vec<String> = std::env::args().skip(1).collect();
    let (parse_args, client_args): (Vec<String>, Vec<String>) =
        if let Some(pos) = raw_args.iter().position(|a| a == "--") {
            (raw_args[..pos].to_vec(), raw_args[pos + 1..].to_vec())
        } else {
            (raw_args, Vec::new())
        };

    let mut argv = vec!["1top".to_string()];
    argv.extend(parse_args);
    let cli = match Cli::try_parse_from(&argv) {
        Ok(c) => c,
        Err(e) => {
            let _ = e.print();
            return ExitCode::from(if e.exit_code() == 0 { 0 } else { 2 });
        }
    };

    if !VALID_COMMANDS.contains(&cli.command.as_str()) {
        eprintln!(
            "1top: error: invalid choice '{}' (choose from {})",
            cli.command,
            VALID_COMMANDS.join(", ")
        );
        return ExitCode::from(2);
    }

    if !client_args.is_empty()
        && !matches!(
            cli.command.as_str(),
            "gateway-claude" | "gateway-codex" | "gateway-glm"
        )
    {
        eprintln!("1top: error: native arguments require a gateway client command");
        return ExitCode::from(2);
    }
    if cli.relay.is_some() && cli.command != "connect" {
        eprintln!("1top: error: --relay requires connect");
        return ExitCode::from(2);
    }
    if cli.command == "version" {
        println!("{APP_VERSION}");
        return ExitCode::SUCCESS;
    }
    if cli.command == "capture-sessions" {
        let Some(ref out_path) = cli.output else {
            eprintln!("1top: error: capture-sessions requires --output");
            return ExitCode::from(2);
        };
        match capture::capture_to_file(Path::new(out_path)) {
            Ok(record) => {
                let procs = record
                    .get("processes")
                    .and_then(|v| v.as_array())
                    .map(Vec::len)
                    .unwrap_or(0);
                let regs = record
                    .get("claude_registry")
                    .and_then(|v| v.as_object())
                    .map(Map::len)
                    .unwrap_or(0);
                println!(
                    "{}",
                    json!({"output": out_path, "processes": procs, "registry_rows": regs})
                );
                return ExitCode::SUCCESS;
            }
            Err(e) => {
                eprintln!("1top: capture-sessions failed: {e}");
                return ExitCode::from(1);
            }
        }
    }
    if cli.output.is_some() {
        eprintln!("1top: error: --output requires capture-sessions");
        return ExitCode::from(2);
    }
    if cli.command == "authorize-claude" {
        let Some(ref prof) = cli.profile else {
            eprintln!("1top: error: authorize-claude requires --profile");
            return ExitCode::from(2);
        };
        match authorize_claude_profile(Path::new(prof)) {
            Ok(val) => {
                println!("{val}");
                return ExitCode::SUCCESS;
            }
            Err(code) => {
                println!("{}", json!({"ok": false, "error": code}));
                return ExitCode::from(1);
            }
        }
    }
    if cli.profile.is_some() {
        eprintln!("1top: error: --profile requires authorize-claude");
        return ExitCode::from(2);
    }
    if cli.command.starts_with("telemetry-") {
        let data_dir = data_directory(None);
        let res = match cli.command.as_str() {
            "telemetry-enable" => {
                let roots = profile_roots(None);
                telemetry_enable(Some(&data_dir), &roots, cli.port)
            }
            "telemetry-disable" => telemetry_disable(Some(&data_dir)),
            _ => TelemetryStore::new(&data_dir)
                .and_then(|s| s.snapshot(None))
                .map_err(|e| e.to_string()),
        };
        match res {
            Ok(val) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&val).unwrap_or_else(|_| "{}".into())
                );
                return ExitCode::SUCCESS;
            }
            Err(e) => {
                eprintln!("1top: {}: {e}", cli.command);
                return ExitCode::from(1);
            }
        }
    }
    if cli.command == "statusline" {
        let Some(ref cfg) = cli.config else {
            eprintln!("1top: error: statusline requires --config");
            return ExitCode::from(2);
        };
        let code = run_statusline_cli(Path::new(cfg));
        return ExitCode::from(code.clamp(0, 255) as u8);
    }
    if cli.config.is_some() {
        eprintln!("1top: error: --config requires statusline");
        return ExitCode::from(2);
    }
    if matches!(
        cli.command.as_str(),
        "gateway-claude" | "gateway-codex" | "gateway-glm"
    ) {
        let provider = match cli.command.as_str() {
            "gateway-claude" => "Claude",
            "gateway-codex" => "Codex",
            _ => "GLM",
        };
        let data_dir = data_directory(None);
        match run_gateway_client(provider, &client_args, &data_dir, cli.gateway_port) {
            Ok(code) => return ExitCode::from(code.clamp(0, 255) as u8),
            Err(_) => {
                eprintln!("Could not connect to 1top gateway or the native CLI. Start 1top gateway and check the CLI installation.");
                return ExitCode::from(1);
            }
        }
    }
    if cli.command == "gateway" {
        let data_dir = data_directory(None);
        return match run_standalone_gateway(&data_dir, cli.gateway_port).await {
            Ok(()) => ExitCode::SUCCESS,
            Err(e) => {
                eprintln!("1top gateway error: {e}");
                ExitCode::from(1)
            }
        };
    }

    if !matches!(std::env::consts::OS, "macos" | "windows") {
        eprintln!("This release supports macOS and Windows.");
        return ExitCode::from(2);
    }
    if let Some(ref r) = cli.relay {
        if let Err(msg) = relay_origin(r) {
            eprintln!("1top: {msg}");
            return ExitCode::from(2);
        }
    }

    let data_dir = data_directory(None);
    if let Err(e) = ensure_private_dir(&data_dir) {
        eprintln!("onetop-agent: failed to prepare data directory: {e}");
        return ExitCode::from(1);
    }

    let lock_path = data_dir.join("agent.lock");
    let lock_file = match OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("onetop-agent: failed to open lock file: {e}");
            return ExitCode::from(1);
        }
    };
    if lock_file.try_lock().is_err() {
        eprintln!("1top is already running.");
        return ExitCode::SUCCESS;
    }

    let dist_dir = resolve_dist_dir(cli.dist_dir);
    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("onetop-agent: failed to bind {addr}: {e}");
            return ExitCode::from(1);
        }
    };
    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(cli.port);

    let stop = Arc::new(AtomicBool::new(false));
    let controller = Arc::new(Controller::new(Some(data_dir.join("controls-v5.json"))));
    let collector = Arc::new(Collector::new(
        data_dir.clone(),
        Arc::clone(&controller),
        Arc::clone(&stop),
    ));
    let routing = Arc::new(GatewayService::new(
        data_dir.clone(),
        collector.accounts(),
        cli.gateway_port,
        tokio::runtime::Handle::current(),
    ));
    routing.start_saved();

    let telemetry_key = receiver_key(&data_dir).ok();
    let account_login = Arc::new(AccountLogin::new(None));
    let bridge = Arc::new(CloudLink::new(
        Arc::clone(&collector),
        Arc::clone(&controller),
        data_dir.clone(),
        cli.relay.as_deref(),
    ));
    let updates = Arc::new(UpdateMonitor::new());

    // Start background collector loop thread (3s poll cycle).
    let col_bg = Arc::clone(&collector);
    let _ = std::thread::Builder::new()
        .name("1top-collector".into())
        .spawn(move || col_bg.run_loop());

    // Start background release update monitor (every 24h).
    let upd_bg = Arc::clone(&updates);
    let stop_upd = Arc::clone(&stop);
    let _ = std::thread::Builder::new()
        .name("1top-updates".into())
        .spawn(move || {
            while !stop_upd.load(Ordering::Relaxed) {
                upd_bg.check_blocking();
                for _ in 0..86400 {
                    if stop_upd.load(Ordering::Relaxed) {
                        return;
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        });

    bridge.set_status("Local monitoring");
    let status_detail = Arc::new(Mutex::new(
        "Free local monitoring. No account or cloud connection is required.".to_string(),
    ));

    // Background status.json writer (1s heartbeat).
    let status_path = data_dir.join("status.json");
    let bridge_st = Arc::clone(&bridge);
    let detail_st = Arc::clone(&status_detail);
    let stop_st = Arc::clone(&stop);
    let _ = std::thread::Builder::new()
        .name("1top-status".into())
        .spawn(move || {
            while !stop_st.load(Ordering::Relaxed) {
                let det = detail_st.lock().map(|g| g.clone()).unwrap_or_default();
                let _ = save_private_json(
                    &status_path,
                    &json!({
                        "updated": now_epoch(),
                        "status": bridge_st.status_text(),
                        "detail": det,
                    }),
                );
                std::thread::sleep(Duration::from_secs(1));
            }
        });

    let diagnostics = std::env::var("ONETOP_RUST_DIAGNOSTICS").as_deref() == Ok("1");
    let app_state = Arc::new(AppState {
        port: actual_port,
        data_dir: data_dir.clone(),
        dist_dir,
        collector: Arc::clone(&collector),
        controller,
        routing: Arc::clone(&routing),
        account_login,
        bridge: Arc::clone(&bridge),
        updates,
        action_token: token_urlsafe_32(),
        telemetry_key,
        telemetry_last_error: Mutex::new(None),
        state_rev: AtomicU64::new(0),
        state_cache: Mutex::new(None),
        diagnostics,
    });

    let router = Router::new()
        .route("/", any(handle_request))
        .route("/{*path}", any(handle_request))
        .with_state(app_state);

    let server_stop = Arc::clone(&stop);
    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                while !server_stop.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            })
            .await;
    });

    let mut paired = false;
    if cli.command == "connect" && !cli.headless {
        let br = Arc::clone(&bridge);
        let pair_res = tokio::task::spawn_blocking(move || br.pair_blocking(true)).await;
        match pair_res {
            Ok(Ok(())) => paired = true,
            _ => {
                bridge.set_status("Local monitoring");
                if let Ok(mut d) = status_detail.lock() {
                    *d = "Remote connection is unavailable. Local monitoring is ready and your AI sessions are unaffected.".into();
                }
            }
        }
    }

    let mut relay_handle = None;
    if cli.command != "local" && bridge.has_config() {
        if let Ok(mut d) = status_detail.lock() {
            *d = "Local monitoring is ready. Your previously connected remote workspace is also enabled.".into();
        }
        let br = Arc::clone(&bridge);
        relay_handle = Some(tokio::spawn(async move {
            br.run().await;
        }));
    }

    if !cli.headless {
        let target = if paired {
            "https://1top.si/app".to_string()
        } else {
            format!("http://127.0.0.1:{actual_port}")
        };
        open_url(&target);
    }

    wait_shutdown_signal().await;

    stop.store(true, Ordering::Relaxed);
    bridge.stop.store(true, Ordering::Relaxed);
    collector.stop_all();
    routing.close();
    if let Some(rh) = relay_handle {
        rh.abort();
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), server_handle).await;
    drop(lock_file);
    ExitCode::SUCCESS
}
