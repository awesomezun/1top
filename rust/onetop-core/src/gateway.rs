//! Complete port of `routing_attribution.py`, `gateway.py`, `gateway_client.py`, and `routing_credentials.py`.
use crate::accounts::{
    claude_credentials, codex_rpc, discover_providers, find_executable, read_json_object,
    AccountQuotaSampler,
};
use crate::readonly::open_readonly;
use crate::routing_policy::{choose, failure_policy};
use crate::sessions::sha256_hex;
use crate::weekly_usage::account_at;
use base64::Engine;
use rand::RngCore;
use regex::Regex;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const MAX_BODY: usize = 16 * 1024 * 1024;

fn sid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9:_-]{1,200}$").unwrap())
}

fn legacy_acct_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"_account_[^_]*_session_").unwrap())
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn route_spec(path: &str) -> Option<(Option<&'static str>, &'static str)> {
    match path {
        "/claude/v1/messages" => Some((Some("Claude"), "messages")),
        "/v1/messages" => Some((None, "messages")),
        "/codex/v1/responses" | "/v1/responses" => Some((Some("Codex"), "responses")),
        "/glm/v1/messages" => Some((Some("GLM"), "messages")),
        "/glm/v1/chat/completions" => Some((Some("GLM"), "chat/completions")),
        "/claude/v1/messages/count_tokens" => Some((Some("Claude"), "messages/count_tokens")),
        "/v1/messages/count_tokens" => Some((None, "messages/count_tokens")),
        "/glm/v1/messages/count_tokens" => Some((Some("GLM"), "messages/count_tokens")),
        "/codex/v1/responses/compact" | "/v1/responses/compact" => {
            Some((Some("Codex"), "responses/compact"))
        }
        _ => None,
    }
}

/// Exact port of `routing_attribution.py:session_id`.
pub fn extract_session_id(
    payload: &Map<String, Value>,
    headers: &HashMap<String, String>,
) -> Option<String> {
    let mut value = headers
        .get("session_id")
        .or_else(|| headers.get("conversation_id"))
        .cloned()
        .or_else(|| {
            payload
                .get("prompt_cache_key")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        });
    if value.as_deref().is_none_or(str::is_empty) {
        if let Some(user) = payload
            .get("metadata")
            .and_then(|m| m.get("user_id"))
            .and_then(|v| v.as_str())
        {
            if let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(user) {
                value = parsed
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
            } else if let Some((_, right)) = user.rsplit_once("_session_") {
                value = Some(right.to_string());
            }
        }
    }
    value.filter(|s| sid_re().is_match(s))
}

pub type RoutingBinding = (String, String, f64, Option<f64>);

/// Exact port of `routing_attribution.py:load`.
pub fn load_routing_bindings(directory: &Path, now: f64) -> HashMap<String, Vec<RoutingBinding>> {
    let mut out: HashMap<String, Vec<RoutingBinding>> = HashMap::new();
    let path = directory.join("gateway.sqlite");
    if !path.is_file() {
        return out;
    }
    let Ok(db) = open_readonly(&path, 0.1) else {
        return out;
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT sid, account, kind, start, end FROM bindings \
         WHERE start>?1 ORDER BY start DESC LIMIT 20000",
    ) else {
        return out;
    };
    let Ok(rows) = stmt.query_map(params![now - 8.0 * 86400.0], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, f64>(3)?,
            r.get::<_, Option<f64>>(4)?,
        ))
    }) else {
        return out;
    };
    for (sid, account, kind, start, end) in rows.flatten() {
        out.entry(sid)
            .or_default()
            .push((account, kind, start, end));
    }
    out
}

/// Exact port of `routing_attribution.py:attach`.
pub fn attach_routing(
    spec: &mut Map<String, Value>,
    bindings: &HashMap<String, Vec<RoutingBinding>>,
    db: &Connection,
    cache: &mut HashMap<String, Vec<RoutingBinding>>,
) {
    let lookup_sid = spec
        .get("active_session_id")
        .or_else(|| spec.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let Some(intervals) = bindings.get(&lookup_sid) else {
        return;
    };
    if intervals.is_empty() {
        return;
    }
    let iv_json: Vec<Value> = intervals
        .iter()
        .map(|(a, k, s, e)| json!([a, k, s, e]))
        .collect();
    spec.insert("_routing_intervals".into(), Value::Array(iv_json));
    if let Some(orig) = spec.get("account_binding").cloned() {
        spec.insert("_routing_original_binding".into(), orig);
    }
    let latest = intervals
        .iter()
        .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap();
    spec.insert("account_binding".into(), json!([latest.0, latest.2]));
    spec.insert("account_binding_source".into(), json!("gateway_session"));
    spec.insert("kind".into(), json!(latest.1));

    let spec_id = spec
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if cache.get(&spec_id) == Some(intervals) {
        return;
    }
    if cache.len() > 4096 {
        cache.clear();
    }
    cache.insert(spec_id.clone(), intervals.clone());

    let start = intervals.iter().map(|r| r.2).fold(f64::INFINITY, f64::min);
    let ev_rows: Vec<(i64, f64, Option<String>)> = {
        let Ok(mut stmt) =
            db.prepare("SELECT rowid, t, account FROM events WHERE sid=?1 AND t>=?2")
        else {
            return;
        };
        let Ok(rows) = stmt.query_map(params![spec_id, start], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        }) else {
            return;
        };
        rows.flatten().collect()
    };
    for (rowid, t, acct) in ev_rows {
        let routed = account_at(intervals, t);
        if acct != routed {
            let _ = db.execute(
                "UPDATE events SET account=?1 WHERE rowid=?2",
                params![routed, rowid],
            );
        }
    }
}

pub fn ensure_gateway_key(directory: &Path) -> Result<String, String> {
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let key_path = directory.join("gateway-key.json");
    if key_path.exists() {
        let key = read_json_object(&key_path, 4096)
            .get("key")
            .and_then(|v| v.as_str())
            .filter(|s| s.len() >= 32)
            .map(str::to_string)
            .ok_or_else(|| "Invalid gateway key file".to_string())?;
        return Ok(key);
    }
    let mut raw = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    let key = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
    std::fs::write(&key_path, json!({"key": key}).to_string()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

pub type UpstreamRequest = (String, HashMap<String, String>, Vec<u8>);
pub type GatewayReply = (
    u16,
    HashMap<String, String>,
    Vec<u8>,
    Option<String>,
    Option<String>,
);

pub fn prepare_upstream(
    provider: &str,
    endpoint: &str,
    creds: &HashMap<String, String>,
    payload: &Map<String, Value>,
    client_headers: &HashMap<String, String>,
) -> Result<UpstreamRequest, &'static str> {
    let allowed_hdrs = [
        "anthropic-version",
        "anthropic-beta",
        "user-agent",
        "x-app",
        "accept",
        "session_id",
        "conversation_id",
        "openai-beta",
    ];
    let mut hdrs: HashMap<String, String> = HashMap::new();
    for (k, v) in client_headers {
        let kl = k.to_lowercase();
        if allowed_hdrs.contains(&kl.as_str()) || kl.starts_with("x-stainless-") {
            hdrs.insert(kl, v.clone());
        }
    }
    for (k, v) in creds {
        if !k.starts_with('_') {
            hdrs.insert(k.clone(), v.clone());
        }
    }
    hdrs.insert("Content-Type".into(), "application/json".into());

    let mut body_obj = payload.clone();
    let url = match provider {
        "Claude" => {
            hdrs.entry("anthropic-version".into())
                .or_insert_with(|| "2023-06-01".into());
            let mut betas: Vec<String> = hdrs
                .get("anthropic-beta")
                .map(|s| {
                    s.split(',')
                        .map(|x| x.trim().to_string())
                        .filter(|x| !x.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            if !betas.iter().any(|b| b == "oauth-2025-04-20") {
                betas.push("oauth-2025-04-20".into());
            }
            hdrs.insert("anthropic-beta".into(), betas.join(","));
            let acct_uuid = creds.get("_account_uuid").map(String::as_str).unwrap_or("");
            let mut meta = body_obj
                .get("metadata")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            if let Some(user) = meta
                .get("user_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
            {
                if let Ok(Value::Object(mut bound)) = serde_json::from_str::<Value>(&user) {
                    bound.insert("account_uuid".into(), json!(acct_uuid));
                    meta.insert(
                        "user_id".into(),
                        json!(serde_json::to_string(&bound).unwrap_or_default()),
                    );
                } else {
                    let repl = format!("_account_{acct_uuid}_session_");
                    meta.insert(
                        "user_id".into(),
                        json!(legacy_acct_re().replace(&user, repl.as_str()).into_owned()),
                    );
                }
            }
            body_obj.insert("metadata".into(), Value::Object(meta));
            format!("https://api.anthropic.com/v1/{endpoint}")
        }
        "Codex" => {
            if endpoint == "responses" {
                body_obj.insert("store".into(), json!(false));
            }
            format!("https://chatgpt.com/backend-api/codex/{endpoint}")
        }
        "GLM" => {
            let host = creds
                .get("_host")
                .map(String::as_str)
                .filter(|h| matches!(*h, "api.z.ai" | "open.bigmodel.cn"))
                .ok_or("provider_unavailable")?;
            let path = if endpoint.starts_with("messages") {
                format!("/api/anthropic/v1/{endpoint}")
            } else {
                "/api/coding/paas/v4/chat/completions".into()
            };
            format!("https://{host}{path}")
        }
        _ => return Err("provider_unavailable"),
    };
    let bytes = serde_json::to_vec(&Value::Object(body_obj)).map_err(|_| "invalid_json")?;
    Ok((url, hdrs, bytes))
}

pub struct GatewayRouter {
    pub directory: PathBuf,
    pub db_path: PathBuf,
    pub sampler: AccountQuotaSampler,
    lock: Mutex<()>,
    affinity: Mutex<HashMap<String, (String, f64)>>,
}

impl GatewayRouter {
    pub fn new(directory: PathBuf, sampler: AccountQuotaSampler) -> rusqlite::Result<Self> {
        let _ = std::fs::create_dir_all(&directory);
        let db_path = directory.join("gateway.sqlite");
        let db = Connection::open(&db_path)?;
        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS cooldown(account TEXT, model TEXT, until REAL, reason TEXT, PRIMARY KEY(account,model));
             CREATE TABLE IF NOT EXISTS requests(id TEXT, at REAL, account TEXT, model TEXT, status INTEGER, attempt INTEGER, reason TEXT);
             CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY, sid TEXT, account TEXT, kind TEXT, start REAL, end REAL);
             CREATE INDEX IF NOT EXISTS binding_start ON bindings(start);",
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(Self {
            directory,
            db_path,
            sampler,
            lock: Mutex::new(()),
            affinity: Mutex::new(HashMap::new()),
        })
    }

    fn cooldowns(&self, now: f64) -> HashMap<(String, String), f64> {
        let mut out = HashMap::new();
        let _g = self.lock.lock();
        let Ok(db) = Connection::open(&self.db_path) else {
            return out;
        };
        if let Ok(mut stmt) =
            db.prepare("SELECT account, model, until FROM cooldown WHERE until>?1")
        {
            if let Ok(rows) = stmt.query_map(params![now], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, f64>(2)?,
                ))
            }) {
                for (a, m, u) in rows.flatten() {
                    out.insert((a, m), u);
                }
            }
        }
        out
    }

    #[allow(clippy::too_many_arguments)]
    fn record(
        &self,
        rid: &str,
        account: &str,
        model: &str,
        status: i64,
        attempt: i64,
        reason: &str,
        until: f64,
    ) {
        let now = now_epoch();
        let _g = self.lock.lock();
        let Ok(db) = Connection::open(&self.db_path) else {
            return;
        };
        if until > now {
            let cm = if matches!(
                reason,
                "authentication"
                    | "login_required"
                    | "login_expired"
                    | "account_changed"
                    | "credential_store_unavailable"
                    | "refresh_pending"
            ) {
                "*"
            } else {
                model
            };
            let _ = db.execute(
                "INSERT INTO cooldown VALUES(?1,?2,?3,?4) \
                 ON CONFLICT(account,model) DO UPDATE SET until=MAX(until,excluded.until), reason=excluded.reason",
                params![account, cm, until, reason],
            );
        }
        let _ = db.execute("DELETE FROM cooldown WHERE until<=?1", params![now]);
        let _ = db.execute(
            "INSERT INTO requests VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![rid, now, account, model, status, attempt, reason],
        );
        let _ = db.execute(
            "DELETE FROM requests WHERE rowid NOT IN (SELECT rowid FROM requests ORDER BY rowid DESC LIMIT 2000)",
            [],
        );
    }

    pub fn record_binding_start(
        &self,
        rid: &str,
        sid: &str,
        account: &str,
        kind: &str,
        start: f64,
    ) {
        let _g = self.lock.lock();
        if let Ok(db) = Connection::open(&self.db_path) {
            let _ = db.execute(
                "INSERT INTO bindings VALUES(?1,?2,?3,?4,?5,NULL)",
                params![rid, sid, account, kind, start],
            );
            let _ = db.execute(
                "DELETE FROM bindings WHERE start<?1",
                params![start - 8.0 * 86400.0],
            );
        }
    }

    pub fn record_binding_end(&self, rid: &str) {
        let _g = self.lock.lock();
        if let Ok(db) = Connection::open(&self.db_path) {
            let _ = db.execute(
                "UPDATE bindings SET end=?1 WHERE id=?2",
                params![now_epoch(), rid],
            );
        }
    }

    pub fn status(&self) -> Value {
        let mut recent = Vec::new();
        {
            let _g = self.lock.lock();
            if let Ok(db) = Connection::open(&self.db_path) {
                if let Ok(mut stmt) = db.prepare(
                    "SELECT id, at, account, model, status, attempt, reason FROM requests ORDER BY rowid DESC LIMIT 50",
                ) {
                    if let Ok(rows) = stmt.query_map([], |r| {
                        Ok(json!({
                            "request_id": r.get::<_, String>(0)?,
                            "at": r.get::<_, f64>(1)?,
                            "account_id": r.get::<_, String>(2)?,
                            "model": r.get::<_, String>(3)?,
                            "status": r.get::<_, i64>(4)?,
                            "attempt": r.get::<_, i64>(5)?,
                            "reason": r.get::<_, String>(6)?
                        }))
                    }) {
                        recent = rows.flatten().collect();
                    }
                }
            }
        }
        let accounts: Vec<Value> = self
            .sampler
            .snapshot(now_epoch())
            .into_iter()
            .map(|a| {
                let mut m = Map::new();
                if let Some(ao) = a.as_object() {
                    for k in ["id", "kind", "account_label", "windows", "stale", "status"] {
                        if let Some(v) = ao.get(k) {
                            m.insert(k.into(), v.clone());
                        }
                    }
                }
                Value::Object(m)
            })
            .collect();
        json!({
            "providers": ["Claude", "Codex", "GLM"],
            "accounts": accounts,
            "recent_requests": recent
        })
    }

    fn resolve_creds(
        &self,
        account_id: &str,
        kind: &str,
    ) -> Result<HashMap<String, String>, &'static str> {
        let mut out = HashMap::new();
        if kind == "GLM" {
            let src = discover_providers(None)
                .into_iter()
                .find(|s| s.kind == "GLM" && s.id == account_id)
                .ok_or("login_required")?;
            out.insert("Authorization".into(), format!("Bearer {}", src.token));
            out.insert("_host".into(), src.host);
            return Ok(out);
        }
        let roots: Vec<PathBuf> = self
            .sampler
            .roots()
            .into_iter()
            .filter(|(_, (aid, rk, _))| aid == account_id && rk == kind)
            .map(|(p, _)| p)
            .collect();
        let root = roots.first().ok_or("login_required")?;
        if kind == "Claude" {
            let creds = claude_credentials(root)?;
            let tok = creds
                .get("accessToken")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or("login_required")?;
            out.insert("Authorization".into(), format!("Bearer {tok}"));
            let cfg_p = if *root == crate::platform_support::home_dir().join(".claude") {
                crate::platform_support::home_dir().join(".claude.json")
            } else {
                root.join(".claude.json")
            };
            let uuid = read_json_object(&cfg_p, 8 * 1024 * 1024)
                .get("oauthAccount")
                .and_then(|a| a.get("accountUuid"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            out.insert("_account_uuid".into(), uuid);
            Ok(out)
        } else if kind == "Codex" {
            let auth = read_json_object(&root.join("auth.json"), 1024 * 1024);
            let tokens = auth
                .get("tokens")
                .and_then(|v| v.as_object())
                .ok_or("login_required")?;
            let tok = tokens
                .get("access_token")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .ok_or("login_required")?;
            let aid = tokens
                .get("account_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let _ = codex_rpc; // available for forced refresh
            out.insert("Authorization".into(), format!("Bearer {tok}"));
            out.insert("ChatGPT-Account-Id".into(), aid.to_string());
            out.insert("originator".into(), "codex_cli_rs".into());
            Ok(out)
        } else {
            Err("provider_unavailable")
        }
    }

    pub fn route_blocking(
        &self,
        path: &str,
        payload: &Map<String, Value>,
        headers: &HashMap<String, String>,
    ) -> GatewayReply {
        let Some((prov_opt, endpoint)) = route_spec(path) else {
            return err_reply(404, "unsupported_endpoint", None, None, None);
        };
        let Some(model) = payload
            .get("model")
            .and_then(|v| v.as_str())
            .filter(|m| !m.is_empty() && m.len() <= 200)
        else {
            return err_reply(400, "model_required", None, None, None);
        };
        let provider = prov_opt.unwrap_or_else(|| {
            if model.to_lowercase().starts_with("glm-") {
                "GLM"
            } else {
                "Claude"
            }
        });
        let mut rid_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut rid_bytes);
        let rid = hex::encode(rid_bytes);

        let lower_hdrs: HashMap<String, String> = headers
            .iter()
            .map(|(k, v)| (k.to_lowercase(), v.clone()))
            .collect();
        let native_sid = extract_session_id(payload, &lower_hdrs);
        let session_key = lower_hdrs
            .get("x-onetop-session")
            .cloned()
            .or_else(|| native_sid.clone())
            .or_else(|| {
                payload
                    .get("metadata")
                    .and_then(|m| m.get("user_id"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            });
        let affinity_key = session_key
            .as_deref()
            .map(|s| sha256_hex(format!("{provider}|{model}|{s}").as_bytes()));

        let settings = read_json_object(&self.directory.join("gateway.json"), 65536);
        let threshold = settings
            .get("threshold")
            .and_then(|v| v.as_f64())
            .filter(|t| (1.0..=100.0).contains(t))
            .unwrap_or(100.0);
        let priority: Vec<String> = settings
            .get("account_priority")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(120))
            .build()
            .expect("gateway client");

        let mut excluded: HashSet<String> = HashSet::new();
        let mut retry_at: Option<f64> = None;

        for attempt in 1..=32i64 {
            let now = now_epoch();
            let preferred = {
                let mut aff = self.affinity.lock().unwrap();
                aff.retain(|_, (_, exp)| *exp > now);
                affinity_key
                    .as_deref()
                    .and_then(|k| aff.get(k).map(|(a, _)| a.clone()))
            };
            let snap = self.sampler.snapshot(now);
            let cds = self.cooldowns(now);
            let (chosen_opt, deadline) = choose(
                &snap,
                provider,
                model,
                now,
                &excluded,
                &cds,
                preferred.as_deref(),
                &priority,
                threshold,
            );
            if let Some(d) = deadline {
                retry_at = Some(retry_at.map(|r| r.min(d)).unwrap_or(d));
            }
            let Some(chosen) = chosen_opt else {
                return err_reply(503, "no_available_account", retry_at, None, Some(rid));
            };
            let key = chosen
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let chosen_kind = chosen
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or(provider)
                .to_string();
            excluded.insert(key.clone());

            let creds = match self.resolve_creds(&key, &chosen_kind) {
                Ok(c) => c,
                Err(code) => {
                    let until = now + 120.0;
                    self.record(&rid, &key, model, 0, attempt, code, until);
                    retry_at = Some(retry_at.map(|r| r.min(until)).unwrap_or(until));
                    continue;
                }
            };
            let Ok((url, up_hdrs, body)) =
                prepare_upstream(provider, endpoint, &creds, payload, &lower_hdrs)
            else {
                let until = now + 120.0;
                self.record(&rid, &key, model, 0, attempt, "provider_unavailable", until);
                continue;
            };

            let mut req = client.post(&url).body(body);
            for (k, v) in up_hdrs {
                req = req.header(&k, &v);
            }
            let resp = match req.send() {
                Ok(r) => r,
                Err(_) => {
                    self.record(&rid, &key, model, 502, attempt, "transport_unknown", 0.0);
                    return err_reply(
                        502,
                        "upstream_connection_failed",
                        None,
                        Some(key),
                        Some(rid),
                    );
                }
            };
            let status = resp.status().as_u16();
            let mut resp_hdrs = HashMap::new();
            for (k, v) in resp.headers() {
                if let Ok(vs) = v.to_str() {
                    resp_hdrs.insert(k.as_str().to_string(), vs.to_string());
                }
            }
            let raw = resp.bytes().map(|b| b.to_vec()).unwrap_or_default();

            if status < 400 {
                if let Some(ref ak) = affinity_key {
                    let mut aff = self.affinity.lock().unwrap();
                    if aff.len() >= 4096 {
                        if let Some(first_k) = aff.keys().next().cloned() {
                            aff.remove(&first_k);
                        }
                    }
                    aff.insert(ak.clone(), (key.clone(), now + 3600.0));
                }
                self.record(
                    &rid,
                    &key,
                    model,
                    i64::from(status),
                    attempt,
                    "accepted",
                    0.0,
                );
                if endpoint != "messages/count_tokens" {
                    if let Some(ref nsid) = native_sid {
                        self.record_binding_start(&rid, nsid, &key, provider, now);
                        self.record_binding_end(&rid);
                    }
                }
                return (status, resp_hdrs, raw, Some(key), Some(rid));
            }
            let err_body = serde_json::from_slice::<Value>(&raw).unwrap_or_else(|_| json!({}));
            let btree_hdrs: BTreeMap<String, String> = resp_hdrs
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect();
            let decision = failure_policy(status, &btree_hdrs, &err_body, now);
            self.record(
                &rid,
                &key,
                model,
                i64::from(status),
                attempt,
                &decision.reason,
                decision.until,
            );
            if !decision.retry {
                return (status, resp_hdrs, raw, Some(key), Some(rid));
            }
            retry_at = Some(
                retry_at
                    .map(|r| r.min(decision.until))
                    .unwrap_or(decision.until),
            );
        }
        err_reply(503, "no_available_account", retry_at, None, Some(rid))
    }
}

fn err_reply(
    status: u16,
    code: &str,
    retry_at: Option<f64>,
    account: Option<String>,
    rid: Option<String>,
) -> GatewayReply {
    let mut err = json!({"type": "onetop_gateway_error", "code": code});
    let mut hdrs = HashMap::new();
    hdrs.insert("Content-Type".into(), "application/json".into());
    if let Some(ra) = retry_at {
        err.as_object_mut()
            .unwrap()
            .insert("retry_at".into(), json!(ra));
        let secs = ((ra - now_epoch()).ceil() as i64).max(1);
        hdrs.insert("Retry-After".into(), secs.to_string());
    }
    let body = serde_json::to_vec(&json!({"error": err})).unwrap_or_default();
    (status, hdrs, body, account, rid)
}

#[derive(Clone)]
pub struct GatewayConfigState {
    pub directory: PathBuf,
    pub port: u16,
    pub router: Arc<GatewayRouter>,
    inner: Arc<Mutex<(bool, Option<String>)>>,
}

impl GatewayConfigState {
    pub fn new(
        directory: PathBuf,
        sampler: AccountQuotaSampler,
        port: u16,
    ) -> rusqlite::Result<Self> {
        let router = Arc::new(GatewayRouter::new(directory.clone(), sampler)?);
        let saved = read_json_object(&directory.join("gateway.json"), 65536);
        let enabled = saved.get("enabled").and_then(|v| v.as_bool()) == Some(true);
        Ok(Self {
            directory,
            port,
            router,
            inner: Arc::new(Mutex::new((enabled, None))),
        })
    }

    pub fn configure(&self, value: &Map<String, Value>) -> Result<Value, &'static str> {
        let Some(enabled) = value.get("enabled").and_then(|v| v.as_bool()) else {
            return Err("enabled is required");
        };
        let threshold = value
            .get("threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(100.0);
        if value.get("threshold").is_some_and(|v| v.is_boolean())
            || !threshold.is_finite()
            || !(1.0..=100.0).contains(&threshold)
        {
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
        if enabled {
            let _ = ensure_gateway_key(&self.directory);
        }
        let settings = json!({
            "enabled": enabled,
            "threshold": threshold,
            "account_priority": priority
        });
        let path = self.directory.join("gateway.json");
        let tmp = path.with_extension("tmp");
        std::fs::write(&tmp, serde_json::to_string(&settings).unwrap_or_default())
            .map_err(|_| "Write failed")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, &path).map_err(|_| "Write failed")?;
        if let Ok(mut guard) = self.inner.lock() {
            guard.0 = enabled;
            guard.1 = None;
        }
        Ok(self.status())
    }

    pub fn status(&self) -> Value {
        let settings = read_json_object(&self.directory.join("gateway.json"), 65536);
        let (running, err) = self
            .inner
            .lock()
            .map(|g| g.clone())
            .unwrap_or((false, None));
        let mut res = json!({
            "enabled": settings.get("enabled").and_then(|v| v.as_bool()) == Some(true),
            "running": running,
            "threshold": settings.get("threshold").cloned().unwrap_or_else(|| json!(100)),
            "account_priority": settings.get("account_priority").cloned().unwrap_or_else(|| json!([])),
            "port": self.port,
            "error": err,
            "providers": ["Claude", "Codex", "GLM"]
        });
        if running {
            if let (Some(ro), Some(st)) = (res.as_object_mut(), self.router.status().as_object()) {
                for (k, v) in st {
                    ro.insert(k.clone(), v.clone());
                }
            }
        }
        res
    }
}

/// Exact port of `gateway_client.py:run`.
pub fn run_gateway_client(
    provider: &str,
    args: &[String],
    directory: &Path,
    port: u16,
) -> Result<i32, String> {
    if !matches!(provider, "Claude" | "Codex" | "GLM") {
        return Err("Unsupported gateway client".into());
    }
    let key = read_json_object(&directory.join("gateway-key.json"), 4096)
        .get("key")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() >= 32)
        .map(str::to_string)
        .ok_or_else(|| "Run 1top gateway first".to_string())?;
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("{base}/status"))
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .map_err(|_| "Gateway unavailable".to_string())?;
    if !resp.status().is_success() {
        return Err("Gateway unavailable".into());
    }
    let cli = find_executable(if provider == "Codex" {
        "codex"
    } else {
        "claude"
    })
    .ok_or_else(|| "Native CLI unavailable".to_string())?;

    let mut cmd = Command::new(&cli);
    if provider == "Claude" || provider == "GLM" {
        cmd.env_remove("ANTHROPIC_API_KEY")
            .env_remove("CLAUDE_CODE_OAUTH_TOKEN")
            .env(
                "ANTHROPIC_BASE_URL",
                format!(
                    "{base}{}",
                    if provider == "Claude" {
                        "/claude"
                    } else {
                        "/glm"
                    }
                ),
            )
            .env("ANTHROPIC_AUTH_TOKEN", &key)
            .args(args);
    } else {
        cmd.env("ONETOP_GATEWAY_KEY", &key);
        let opts = [
            ("model_provider", json!("onetop")),
            ("model_providers.onetop.name", json!("1top")),
            (
                "model_providers.onetop.base_url",
                json!(format!("{base}/codex/v1")),
            ),
            (
                "model_providers.onetop.env_key",
                json!("ONETOP_GATEWAY_KEY"),
            ),
            ("model_providers.onetop.wire_api", json!("responses")),
            ("model_providers.onetop.requires_openai_auth", json!(false)),
            ("model_providers.onetop.supports_websockets", json!(false)),
        ];
        for (k, v) in opts {
            cmd.arg("-c").arg(format!("{k}={v}"));
        }
        cmd.args(args);
    }
    let status = cmd.status().map_err(|e| e.to_string())?;
    Ok(status.code().unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn route_spec_and_session_id_extraction() {
        assert_eq!(
            route_spec("/claude/v1/messages"),
            Some((Some("Claude"), "messages"))
        );
        assert_eq!(
            route_spec("/v1/responses"),
            Some((Some("Codex"), "responses"))
        );
        assert_eq!(
            route_spec("/glm/v1/chat/completions"),
            Some((Some("GLM"), "chat/completions"))
        );
        assert_eq!(route_spec("/unknown"), None);

        let payload: Map<String, Value> = serde_json::from_value(
            json!({"metadata": {"user_id": "u_account_123_session_abc-def"}}),
        )
        .unwrap();
        let hdrs = HashMap::new();
        assert_eq!(
            extract_session_id(&payload, &hdrs),
            Some("abc-def".to_string())
        );

        let mut codex_hdrs = HashMap::new();
        codex_hdrs.insert("session_id".into(), "codex-sess-42".into());
        assert_eq!(
            extract_session_id(&Map::new(), &codex_hdrs),
            Some("codex-sess-42".to_string())
        );
    }

    #[test]
    fn ensure_gateway_key_creates_and_reuses() {
        let td = tempfile::tempdir().unwrap();
        let k1 = ensure_gateway_key(td.path()).unwrap();
        assert!(k1.len() >= 32);
        let k2 = ensure_gateway_key(td.path()).unwrap();
        assert_eq!(k1, k2);
    }
}
