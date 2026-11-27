//! Local inference gateway HTTP listener (`gateway.py:GatewayHandler` & `GatewayService`).
#![forbid(unsafe_code)]

use axum::body::{to_bytes, Body};
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use onetop_core::accounts::AccountQuotaSampler;
use onetop_core::bridge::save_private_json;
use onetop_core::gateway::{ensure_gateway_key, route_spec, GatewayRouter, MAX_BODY};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

#[derive(Clone)]
struct GatewayHttpState {
    port: u16,
    key: String,
    router: Arc<GatewayRouter>,
}

fn ct_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

fn json_err(status: StatusCode, code: &str) -> Response {
    let body = serde_json::to_vec(&json!({"type": "onetop_gateway_error", "code": code}))
        .unwrap_or_default();
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONNECTION, "close")
        .body(Body::from(body))
        .unwrap_or_else(|_| status.into_response())
}

fn authorize(headers: &HeaderMap, port: u16, expected_key: &str) -> bool {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ok_host = host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}");
    if !ok_host || headers.contains_key(header::ORIGIN) {
        return false;
    }
    let auth = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = if let Some(rest) = auth.strip_prefix("Bearer ") {
        rest
    } else {
        headers
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
    };
    ct_eq(token, expected_key)
}

async fn handle_gateway(
    State(state): State<Arc<GatewayHttpState>>,
    req: Request<Body>,
) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let headers = req.headers().clone();

    if !authorize(&headers, state.port, &state.key) {
        return json_err(StatusCode::UNAUTHORIZED, "local_key_required");
    }

    let path = uri.path().to_string();
    if method == Method::GET {
        if path != "/status" {
            return json_err(StatusCode::NOT_FOUND, "not_found");
        }
        let router = Arc::clone(&state.router);
        let val = tokio::task::spawn_blocking(move || router.status())
            .await
            .unwrap_or_else(|_| json!({}));
        let bytes = serde_json::to_vec(&val).unwrap_or_default();
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CONNECTION, "close")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    if method != Method::POST {
        return json_err(StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed");
    }

    if route_spec(&path).is_none() {
        return json_err(StatusCode::NOT_FOUND, "unsupported_endpoint");
    }

    if headers.contains_key(header::TRANSFER_ENCODING) {
        return json_err(StatusCode::BAD_REQUEST, "invalid_length");
    }
    let lengths: Vec<&str> = headers
        .get_all(header::CONTENT_LENGTH)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .collect();
    if lengths.len() != 1
        || !lengths[0].is_ascii()
        || !lengths[0].bytes().all(|b| b.is_ascii_digit())
    {
        return json_err(StatusCode::BAD_REQUEST, "invalid_length");
    }
    let Ok(length) = lengths[0].parse::<usize>() else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_length");
    };
    if length == 0 || length > MAX_BODY {
        return json_err(StatusCode::PAYLOAD_TOO_LARGE, "body_too_large");
    }

    let Ok(raw) = to_bytes(req.into_body(), MAX_BODY).await else {
        return json_err(StatusCode::PAYLOAD_TOO_LARGE, "body_too_large");
    };
    if raw.len() != length {
        return json_err(StatusCode::BAD_REQUEST, "invalid_json");
    }
    let Ok(Value::Object(payload)) = serde_json::from_slice::<Value>(&raw) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_json");
    };

    let mut hdr_map = HashMap::new();
    for (k, v) in &headers {
        if let Ok(vs) = v.to_str() {
            hdr_map.insert(k.as_str().to_string(), vs.to_string());
        }
    }

    let router = Arc::clone(&state.router);
    let reply =
        tokio::task::spawn_blocking(move || router.route_blocking(&path, &payload, &hdr_map)).await;
    let Ok((status, resp_hdrs, body, account, rid)) = reply else {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "internal_error");
    };

    let st = StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut out = Response::builder().status(st);
    for (k, v) in &resp_hdrs {
        let lower = k.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "content-type" | "content-encoding" | "retry-after" | "cache-control"
        ) {
            if let (Ok(hn), Ok(hv)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                out = out.header(hn, hv);
            }
        }
    }
    if let Some(acc) = account {
        if let Ok(hv) = HeaderValue::from_str(&acc) {
            out = out.header("X-1top-Account", hv);
        }
    }
    if let Some(r) = rid {
        if let Ok(hv) = HeaderValue::from_str(&r) {
            out = out.header("X-1top-Request-Id", hv);
        }
    }
    out = out.header(header::CONNECTION, "close");
    out.body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

struct RunningGateway {
    port: u16,
    router: Arc<GatewayRouter>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

pub struct GatewayService {
    directory: PathBuf,
    sampler: AccountQuotaSampler,
    configured_port: u16,
    runtime: tokio::runtime::Handle,
    inner: Mutex<(Option<RunningGateway>, Option<String>)>,
}

impl GatewayService {
    pub fn new(
        directory: PathBuf,
        sampler: AccountQuotaSampler,
        port: u16,
        runtime: tokio::runtime::Handle,
    ) -> Self {
        Self {
            directory,
            sampler,
            configured_port: port,
            runtime,
            inner: Mutex::new((None, None)),
        }
    }

    pub fn start_saved(&self) {
        let saved =
            onetop_core::accounts::read_json_object(&self.directory.join("gateway.json"), 65536);
        if saved.get("enabled").and_then(|v| v.as_bool()) == Some(true) {
            if let Err(code) = self.configure(&saved) {
                if let Ok(mut g) = self.inner.lock() {
                    g.1 = Some(code.to_string());
                }
            }
        }
    }

    fn spawn_listener(&self) -> Result<RunningGateway, &'static str> {
        let key = ensure_gateway_key(&self.directory).map_err(|_| "configuration_unavailable")?;
        let router = Arc::new(
            GatewayRouter::new(self.directory.clone(), self.sampler.clone())
                .map_err(|_| "configuration_unavailable")?,
        );
        let addr = SocketAddr::from(([127, 0, 0, 1], self.configured_port));
        let std_listener = std::net::TcpListener::bind(addr).map_err(|_| "listener_unavailable")?;
        std_listener
            .set_nonblocking(true)
            .map_err(|_| "listener_unavailable")?;
        let actual_port = std_listener
            .local_addr()
            .map(|a| a.port())
            .unwrap_or(self.configured_port);

        let state = Arc::new(GatewayHttpState {
            port: actual_port,
            key,
            router: Arc::clone(&router),
        });
        let app = Router::new()
            .route("/", any(handle_gateway))
            .route("/{*path}", any(handle_gateway))
            .with_state(state);

        let (tx, rx) = oneshot::channel::<()>();
        self.runtime.spawn(async move {
            if let Ok(listener) = TcpListener::from_std(std_listener) {
                let _ = axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = rx.await;
                    })
                    .await;
            }
        });

        Ok(RunningGateway {
            port: actual_port,
            router,
            shutdown_tx: Some(tx),
        })
    }

    pub fn configure(&self, value: &Map<String, Value>) -> Result<Value, &'static str> {
        let Some(enabled) = value.get("enabled").and_then(|v| v.as_bool()) else {
            return Err("enabled is required");
        };
        let threshold_val = value.get("threshold");
        if threshold_val.is_some_and(|v| v.is_boolean()) {
            return Err("Invalid threshold");
        }
        let threshold = threshold_val
            .map(|v| v.as_f64().ok_or("Invalid threshold"))
            .transpose()?
            .unwrap_or(100.0);
        if !threshold.is_finite() || !(1.0..=100.0).contains(&threshold) {
            return Err("Invalid threshold");
        }
        let mut priority = Vec::new();
        if let Some(pv) = value.get("account_priority") {
            let Some(arr) = pv.as_array() else {
                return Err("Invalid priority");
            };
            if arr.len() > 64 {
                return Err("Invalid priority");
            }
            let mut seen = HashSet::new();
            for item in arr {
                let Some(s) = item.as_str() else {
                    return Err("Invalid priority");
                };
                if s.is_empty() || s.len() > 100 {
                    return Err("Invalid priority");
                }
                if seen.insert(s.to_string()) {
                    priority.push(s.to_string());
                }
            }
        }

        let settings = json!({
            "enabled": enabled,
            "threshold": threshold,
            "account_priority": priority,
        });

        {
            let mut guard = self.inner.lock().unwrap();
            let mut started_here = false;
            if enabled && guard.0.is_none() {
                let running = self.spawn_listener()?;
                guard.0 = Some(running);
                started_here = true;
            }
            if save_private_json(&self.directory.join("gateway.json"), &settings).is_err() {
                if started_here {
                    if let Some(mut r) = guard.0.take() {
                        if let Some(tx) = r.shutdown_tx.take() {
                            let _ = tx.send(());
                        }
                    }
                }
                return Err("Write failed");
            }
            if !enabled {
                if let Some(mut r) = guard.0.take() {
                    if let Some(tx) = r.shutdown_tx.take() {
                        let _ = tx.send(());
                    }
                }
            }
            guard.1 = None;
        }
        Ok(self.status())
    }

    pub fn close(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(mut r) = guard.0.take() {
                if let Some(tx) = r.shutdown_tx.take() {
                    let _ = tx.send(());
                }
            }
        }
    }

    pub fn status(&self) -> Value {
        let settings =
            onetop_core::accounts::read_json_object(&self.directory.join("gateway.json"), 65536);
        let (running, port, err, router_opt) = {
            let g = self.inner.lock().unwrap();
            let r = g.0.as_ref();
            (
                r.is_some(),
                r.map(|x| x.port).unwrap_or(self.configured_port),
                g.1.clone(),
                r.map(|x| Arc::clone(&x.router)),
            )
        };
        let mut res = json!({
            "enabled": settings.get("enabled").and_then(|v| v.as_bool()) == Some(true),
            "running": running,
            "threshold": settings.get("threshold").cloned().unwrap_or_else(|| json!(100)),
            "account_priority": settings.get("account_priority").cloned().unwrap_or_else(|| json!([])),
            "port": port,
            "error": err,
            "providers": ["Claude", "Codex", "GLM"],
        });
        if let Some(router) = router_opt {
            if let (Some(ro), Some(st)) = (res.as_object_mut(), router.status().as_object()) {
                for (k, v) in st {
                    ro.insert(k.clone(), v.clone());
                }
            }
        }
        res
    }
}

pub async fn run_standalone_gateway(directory: &Path, port: u16) -> Result<(), String> {
    let sampler = AccountQuotaSampler::new();
    let bg_sampler = sampler.clone();
    std::thread::Builder::new()
        .name("1top-gateway-accounts".into())
        .spawn(move || loop {
            bg_sampler.sample_once();
            std::thread::sleep(std::time::Duration::from_secs(120));
        })
        .map_err(|e| e.to_string())?;

    let key = ensure_gateway_key(directory)?;
    let router =
        Arc::new(GatewayRouter::new(directory.to_path_buf(), sampler).map_err(|e| e.to_string())?);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await.map_err(|e| e.to_string())?;
    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);

    println!("1top gateway: http://127.0.0.1:{actual_port}");
    println!(
        "Local credential file: {}",
        directory.join("gateway-key.json").display()
    );

    let state = Arc::new(GatewayHttpState {
        port: actual_port,
        key,
        router,
    });
    let app = Router::new()
        .route("/", any(handle_gateway))
        .route("/{*path}", any(handle_gateway))
        .with_state(state);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|e| e.to_string())
}
