//! Native async outbound-only cloud WebSocket bridge (`bridge.py:CloudLink`).
#![forbid(unsafe_code)]

use crate::collector::Collector;
use flate2::write::GzEncoder;
use flate2::Compression;
use futures_util::{SinkExt, StreamExt};
use onetop_core::bridge::{
    export_snapshot, fetch_workspace_usage_blocking, load_device_config, pair_device_blocking,
    report_interval, save_private_json, DeviceConfig, SEND_SECS,
};
use onetop_core::controls::Controller;
use onetop_core::usage::public_history;
use onetop_core::APP_VERSION;
use rand::Rng;
use serde_json::{json, Map, Value};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub struct CloudLink {
    collector: Arc<Collector>,
    controller: Arc<Controller>,
    data_dir: PathBuf,
    receipt_file: PathBuf,
    relay: String,
    config: Mutex<Option<DeviceConfig>>,
    receipts: Mutex<Map<String, Value>>,
    status: Mutex<String>,
    workspace_usage: Mutex<Value>,
    workspace_checked: Mutex<f64>,
    alone: AtomicBool,
    gzip: AtomicBool,
    action_lock: Mutex<()>,
    message_lock: Mutex<()>,
    history_lock: Mutex<()>,
    pub stop: Arc<AtomicBool>,
}

impl CloudLink {
    pub fn new(
        collector: Arc<Collector>,
        controller: Arc<Controller>,
        data_dir: PathBuf,
        explicit_relay: Option<&str>,
    ) -> Self {
        let (cfg, relay) = load_device_config(&data_dir, explicit_relay);
        let receipt_file = data_dir.join("remote-receipts.json");
        let receipts = std::fs::read_to_string(&receipt_file)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        Self {
            collector,
            controller,
            data_dir,
            receipt_file,
            relay,
            config: Mutex::new(cfg),
            receipts: Mutex::new(receipts),
            status: Mutex::new("Not connected".to_string()),
            workspace_usage: Mutex::new(json!({"devices": [], "updated": 0})),
            workspace_checked: Mutex::new(0.0),
            alone: AtomicBool::new(false),
            gzip: AtomicBool::new(false),
            action_lock: Mutex::new(()),
            message_lock: Mutex::new(()),
            history_lock: Mutex::new(()),
            stop: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn has_config(&self) -> bool {
        self.config.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn status_text(&self) -> String {
        self.status
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "Not connected".to_string())
    }

    pub fn set_status(&self, s: impl Into<String>) {
        if let Ok(mut g) = self.status.lock() {
            *g = s.into();
        }
    }

    pub fn workspace_usage_value(&self) -> Value {
        self.workspace_usage
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| json!({"devices": [], "updated": 0}))
    }

    pub fn pair_blocking(&self, open_browser: bool) -> Result<(), String> {
        self.set_status("Waiting for Google sign-in");
        let cfg = pair_device_blocking(&self.data_dir, &self.relay, open_browser)?;
        if let Ok(mut g) = self.config.lock() {
            *g = Some(cfg);
        }
        Ok(())
    }

    fn save_receipt(&self, rid: &str, result: Value) {
        if let Ok(mut recs) = self.receipts.lock() {
            recs.insert(rid.to_string(), result);
            while recs.len() > 200 {
                if let Some(first) = recs.keys().next().cloned() {
                    recs.remove(&first);
                } else {
                    break;
                }
            }
            let _ = save_private_json(&self.receipt_file, &Value::Object(recs.clone()));
        }
    }

    fn send_result(&self, out_tx: &mpsc::UnboundedSender<Message>, rid: &str, ok: bool, msg: &str) {
        let res = json!({"type": "result", "request_id": rid, "ok": ok, "message": msg});
        self.save_receipt(rid, res.clone());
        if let Ok(text) = serde_json::to_string(&res) {
            let _ = out_tx.send(Message::Text(text.into()));
        }
    }

    fn handle_command(&self, data: &Map<String, Value>, out_tx: &mpsc::UnboundedSender<Message>) {
        let Some(rid) = data.get("request_id").and_then(|v| v.as_str()) else {
            return;
        };
        if rid.len() != 36 {
            return;
        }
        let dev_id = self
            .config
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| c.device_id.clone()))
            .unwrap_or_default();
        if data.get("device_id").and_then(|v| v.as_str()) != Some(dev_id.as_str()) {
            return;
        }
        if let Ok(recs) = self.receipts.lock() {
            if let Some(prev) = recs.get(rid) {
                if let Ok(text) = serde_json::to_string(prev) {
                    let _ = out_tx.send(Message::Text(text.into()));
                }
                return;
            }
        }
        let exp = data
            .get("expires_at")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if exp < now_epoch() * 1000.0 {
            self.send_result(
                out_tx,
                rid,
                false,
                "Request expired before delivery. Nothing executed.",
            );
            return;
        }

        let action = data.get("action").and_then(|v| v.as_str()).unwrap_or("");
        let is_msg = action == "message";
        let _guard = if is_msg {
            self.message_lock.lock().ok()
        } else {
            match self.action_lock.try_lock() {
                Ok(g) => Some(g),
                Err(_) => {
                    self.send_result(
                        out_tx,
                        rid,
                        false,
                        "Another action is running. Check the device first.",
                    );
                    return;
                }
            }
        };

        if let Ok(recs) = self.receipts.lock() {
            if let Some(prev) = recs.get(rid) {
                if let Ok(text) = serde_json::to_string(prev) {
                    let _ = out_tx.send(Message::Text(text.into()));
                }
                return;
            }
        }

        self.save_receipt(
            rid,
            json!({
                "type": "result",
                "request_id": rid,
                "ok": false,
                "message": "Previous execution is unconfirmed. Check the session before requesting another action."
            }),
        );

        if !matches!(
            action,
            "focus"
                | "pause"
                | "resume"
                | "terminate"
                | "prompt"
                | "message"
                | "rename"
                | "account_alias"
        ) {
            self.send_result(
                out_tx,
                rid,
                false,
                "The action could not be confirmed. Check this computer.",
            );
            return;
        }

        if action == "account_alias" {
            let aid = data.get("account_id").and_then(|v| v.as_str());
            let alias = data.get("alias").and_then(|v| v.as_str());
            match self.collector.set_account_alias(aid, alias) {
                Ok(_) => self.send_result(out_tx, rid, true, "Account name updated."),
                Err(_) => self.send_result(
                    out_tx,
                    rid,
                    false,
                    "The action could not be confirmed. Check this computer.",
                ),
            }
            return;
        }

        let mut payload = Map::new();
        for k in [
            "action",
            "session_id",
            "control_key",
            "request_id",
            "prompt",
            "attachments",
            "title",
        ] {
            if let Some(v) = data.get(k) {
                payload.insert(k.to_string(), v.clone());
            }
        }
        let snap = self.collector.raw_snapshot();
        match self.controller.execute(&snap, &payload, false) {
            Ok(res) => {
                let msg = res
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Completed");
                self.send_result(out_tx, rid, true, msg);
            }
            Err(err) => {
                if is_msg {
                    self.controller
                        .mailbox
                        .delivery(rid, "delivery_unconfirmed");
                }
                self.send_result(out_tx, rid, false, &err.message);
            }
        }
    }

    fn handle_mailbox(&self, data: &Map<String, Value>, out_tx: &mpsc::UnboundedSender<Message>) {
        let Some(rid) = data.get("request_id").and_then(|v| v.as_str()) else {
            return;
        };
        let dev_id = self
            .config
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| c.device_id.clone()))
            .unwrap_or_default();
        if rid.len() != 36
            || data.get("device_id").and_then(|v| v.as_str()) != Some(dev_id.as_str())
        {
            return;
        }
        let exp = data
            .get("expires_at")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if exp < now_epoch() * 1000.0 {
            return;
        }
        let sid = data
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let key = data
            .get("control_key")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let snap = self.collector.raw_snapshot();
        let reply = match self.controller.read_mailbox(&snap, sid, key) {
            Ok(rows) => json!({
                "type": "mailbox",
                "request_id": rid,
                "session_id": data.get("session_id").cloned().unwrap_or(Value::Null),
                "messages": rows,
            }),
            Err(_) => json!({
                "type": "mailbox",
                "request_id": rid,
                "session_id": data.get("session_id").cloned().unwrap_or(Value::Null),
                "error": "This session mailbox is unavailable.",
            }),
        };
        if let Ok(text) = serde_json::to_string(&reply) {
            let _ = out_tx.send(Message::Text(text.into()));
        }
    }

    fn handle_history(&self, data: &Map<String, Value>, out_tx: &mpsc::UnboundedSender<Message>) {
        let Some(rid) = data.get("request_id").and_then(|v| v.as_str()) else {
            return;
        };
        let dev_id = self
            .config
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|c| c.device_id.clone()))
            .unwrap_or_default();
        if rid.len() != 36
            || data.get("device_id").and_then(|v| v.as_str()) != Some(dev_id.as_str())
        {
            return;
        }
        let exp = data
            .get("expires_at")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if exp < now_epoch() * 1000.0 {
            return;
        }
        let Ok(_g) = self.history_lock.try_lock() else {
            let reply = json!({
                "type": "history",
                "request_id": rid,
                "error": "History is busy. Try again shortly.",
            });
            if let Ok(text) = serde_json::to_string(&reply) {
                let _ = out_tx.send(Message::Text(text.into()));
            }
            return;
        };

        let period = data.get("period").and_then(|v| v.as_str()).unwrap_or("1h");
        let reply = if data.get("view").and_then(|v| v.as_str()) == Some("sessions") {
            let offset = data
                .get("offset")
                .and_then(|v| v.as_i64())
                .unwrap_or(0)
                .to_string();
            let limit = data
                .get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(100)
                .to_string();
            match self.collector.usage_sessions(period, &offset, &limit) {
                Ok(val) => json!({"type": "history", "request_id": rid, "data": val}),
                Err(_) => json!({
                    "type": "history",
                    "request_id": rid,
                    "error": "History is unavailable for this period or step.",
                }),
            }
        } else {
            let step = match data.get("step") {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                _ => "60".to_string(),
            };
            let kind = data.get("kind").and_then(|v| v.as_str());
            match self.collector.history_response(period, &step, kind) {
                Ok(val) => json!({
                    "type": "history",
                    "request_id": rid,
                    "data": public_history(&val),
                }),
                Err(_) => json!({
                    "type": "history",
                    "request_id": rid,
                    "error": "History is unavailable for this period or step.",
                }),
            }
        };
        if let Ok(text) = serde_json::to_string(&reply) {
            let _ = out_tx.send(Message::Text(text.into()));
        }
    }

    fn maybe_refresh_workspace_usage(&self, token: &str) {
        if self.alone.load(Ordering::Relaxed) {
            return;
        }
        let now = now_epoch();
        if let Ok(mut last) = self.workspace_checked.lock() {
            if now - *last < 15.0 {
                return;
            }
            *last = now;
        }
        if let Some(val) = fetch_workspace_usage_blocking(&self.relay, token) {
            if let Ok(mut wu) = self.workspace_usage.lock() {
                *wu = val;
            }
        }
    }

    pub async fn run(self: Arc<Self>) {
        let mut delay: u64 = 1;
        while !self.stop.load(Ordering::Relaxed) {
            let cfg = match self.config.lock().ok().and_then(|g| g.clone()) {
                Some(c) => c,
                None => break,
            };
            let ws_url = format!(
                "{}/api/device/socket",
                self.relay.replacen("https://", "wss://", 1)
            );
            let mut req = match ws_url.into_client_request() {
                Ok(r) => r,
                Err(_) => break,
            };
            if let Ok(hv) = HeaderValue::from_str(&format!("Bearer {}", cfg.device_token)) {
                req.headers_mut().insert("Authorization", hv);
            }
            if let Ok(hv) = HeaderValue::from_str(&format!("1top/{APP_VERSION}")) {
                req.headers_mut().insert("User-Agent", hv);
            }
            req.headers_mut().remove("Origin");

            match tokio::time::timeout(
                Duration::from_secs(10),
                tokio_tungstenite::connect_async(req),
            )
            .await
            {
                Ok(Ok((ws_stream, _))) => {
                    self.set_status("Connected");
                    delay = 1;
                    self.alone.store(false, Ordering::Relaxed);
                    self.gzip.store(false, Ordering::Relaxed);

                    let (mut write, mut read) = ws_stream.split();
                    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
                    let writer_task = tokio::spawn(async move {
                        while let Some(msg) = out_rx.recv().await {
                            let res = tokio::time::timeout(
                                Duration::from_secs(SEND_SECS),
                                write.send(msg),
                            )
                            .await;
                            if !matches!(res, Ok(Ok(()))) {
                                break;
                            }
                        }
                    });

                    let mut heard = false;
                    let mut last_sent: Option<Instant> = None;
                    let mut interval_secs: u64 = 60;

                    while !self.stop.load(Ordering::Relaxed) {
                        let due = heard
                            && last_sent
                                .map(|t| t.elapsed() >= Duration::from_secs(interval_secs))
                                .unwrap_or(true);
                        if due {
                            let this = Arc::clone(&self);
                            let token = cfg.device_token.clone();
                            let use_gzip = self.gzip.load(Ordering::Relaxed);
                            let maybe_msg = tokio::task::spawn_blocking(move || {
                                let state = this.collector.state_for_cloud();
                                if state.get("ready").and_then(|v| v.as_bool()) != Some(true) {
                                    return None;
                                }
                                let decorated = this.controller.decorate(&state);
                                let mut payload = export_snapshot(&decorated);
                                if let Some(po) = payload.as_object_mut() {
                                    po.insert(
                                        "speed_periods".into(),
                                        Value::Array(this.collector.speed_for_cloud(&state)),
                                    );
                                }
                                let report = serde_json::to_string(&json!({
                                    "type": "snapshot",
                                    "data": payload
                                }))
                                .ok()?;
                                this.maybe_refresh_workspace_usage(&token);
                                if use_gzip {
                                    let mut enc = GzEncoder::new(Vec::new(), Compression::new(6));
                                    enc.write_all(report.as_bytes()).ok()?;
                                    let gz = enc.finish().ok()?;
                                    Some(Message::Binary(gz.into()))
                                } else {
                                    Some(Message::Text(report.into()))
                                }
                            })
                            .await
                            .ok()
                            .flatten();

                            if let Some(msg) = maybe_msg {
                                if out_tx.send(msg).is_err() {
                                    break;
                                }
                            }
                            last_sent = Some(Instant::now());
                        }
                        heard = true;

                        match tokio::time::timeout(Duration::from_secs(3), read.next()).await {
                            Ok(Some(Ok(Message::Text(txt)))) => {
                                if txt.as_str() == "pong" {
                                    continue;
                                }
                                let Ok(Value::Object(msg)) = serde_json::from_str::<Value>(&txt)
                                else {
                                    continue;
                                };
                                match msg.get("type").and_then(|v| v.as_str()) {
                                    Some("report_policy") => {
                                        interval_secs = report_interval(msg.get("interval"));
                                        if interval_secs == 3 {
                                            last_sent = None;
                                        }
                                        self.gzip.store(
                                            msg.get("gzip").and_then(|v| v.as_bool()) == Some(true),
                                            Ordering::Relaxed,
                                        );
                                        let alone = msg.get("others").and_then(|v| v.as_bool())
                                            == Some(false);
                                        self.alone.store(alone, Ordering::Relaxed);
                                        if alone {
                                            if let Ok(mut wu) = self.workspace_usage.lock() {
                                                *wu =
                                                    json!({"devices": [], "updated": now_epoch()});
                                            }
                                        }
                                    }
                                    Some("history_request") => {
                                        let this = Arc::clone(&self);
                                        let tx = out_tx.clone();
                                        tokio::task::spawn_blocking(move || {
                                            this.handle_history(&msg, &tx);
                                        });
                                    }
                                    Some("mailbox_request") => {
                                        let this = Arc::clone(&self);
                                        let tx = out_tx.clone();
                                        tokio::task::spawn_blocking(move || {
                                            this.handle_mailbox(&msg, &tx);
                                        });
                                    }
                                    Some("action") => {
                                        let this = Arc::clone(&self);
                                        let tx = out_tx.clone();
                                        if msg.get("action").and_then(|v| v.as_str())
                                            == Some("message")
                                        {
                                            let _ = tokio::task::spawn_blocking(move || {
                                                this.handle_command(&msg, &tx);
                                            })
                                            .await;
                                        } else {
                                            tokio::task::spawn_blocking(move || {
                                                this.handle_command(&msg, &tx);
                                            });
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            Ok(Some(Ok(Message::Ping(payload)))) => {
                                let _ = out_tx.send(Message::Pong(payload));
                            }
                            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => break,
                            Ok(Some(Err(_))) => break,
                            Err(_) => continue,
                            _ => continue,
                        }
                    }

                    drop(out_tx);
                    writer_task.abort();
                }
                Ok(Err(tokio_tungstenite::tungstenite::Error::Http(resp)))
                    if matches!(resp.status().as_u16(), 401 | 403) =>
                {
                    self.set_status("Disconnected by account. Open 1top to reconnect.");
                    return;
                }
                _ => {
                    self.set_status("Reconnecting");
                }
            }

            for _ in 0..delay {
                if self.stop.load(Ordering::Relaxed) {
                    return;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            let jitter: u64 = rand::thread_rng().gen_range(0..3);
            delay = (delay * 2 + jitter).min(60);
        }
    }
}
