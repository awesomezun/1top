//! Complete port of `sessions/*`, `hierarchy.py`, `discovery.py`, and `controls.py:target_key`.
use crate::effort::level as effort_level;
use crate::processes::{describe_json as describe_process, APP_NAMES};
use crate::text::epoch_from_value;
use crate::transcripts::boundary as transcript_boundary;
use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn usable_ignore_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^(?:tty\S*|claude|codex|aside|unknown)$").unwrap())
}

fn aside_id_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9_-]{1,120}$").unwrap())
}

fn braille_prefix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[\u{2800}-\u{28ff}]\s+").unwrap())
}

fn action_req_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\[\s*[.!]\s*\] Action Required \| ").unwrap())
}

fn safe_sid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap())
}

pub fn orca_executable() -> String {
    if let Ok(explicit) = std::env::var("ORCA_CLI_COMMAND") {
        if !explicit.is_empty() {
            return explicit;
        }
    }
    let home = crate::platform_support::home_dir();
    let local = home.join(".local/bin/orca");
    if local.is_file() {
        return local.to_string_lossy().into_owned();
    }
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let candidate = dir.join("orca");
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    local.to_string_lossy().into_owned()
}

pub fn claude_transcript(root: &str, sid: &str) -> Option<String> {
    if !safe_sid_re().is_match(sid) {
        return None;
    }
    let expanded = if let Some(rest) = root.strip_prefix("~/") {
        crate::platform_support::home_dir().join(rest)
    } else if root == "~" {
        crate::platform_support::home_dir()
    } else {
        PathBuf::from(root)
    };
    let pattern = format!("{}/projects/*/{sid}.jsonl", expanded.display());
    let mut matches = Vec::new();
    if let Ok(paths) = glob::glob(&pattern) {
        for p in paths.flatten() {
            matches.push(p);
            if matches.len() > 1 {
                return None;
            }
        }
    }
    if matches.len() == 1 {
        Some(matches[0].to_string_lossy().into_owned())
    } else {
        None
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Exact port of `controls.py:target_key`.
pub fn target_key(spec: &Map<String, Value>) -> String {
    let terminal = spec.get("orca_terminal").and_then(|v| v.as_object());
    let identity = json!([
        spec.get("id").cloned().unwrap_or(Value::Null),
        spec.get("pids").cloned().unwrap_or_else(|| json!([])),
        spec.get("process_started").cloned().unwrap_or(Value::Null),
        spec.get("process_birth").cloned().unwrap_or(Value::Null),
        terminal
            .and_then(|t| t.get("handle"))
            .cloned()
            .unwrap_or(Value::Null),
        terminal
            .and_then(|t| t.get("incarnationId"))
            .cloned()
            .unwrap_or(Value::Null),
    ]);
    // Python json.dumps(identity, sort_keys=True) uses ", " separator
    let encoded = python_json_dumps(&identity);
    sha256_hex(encoded.as_bytes())
}

fn python_json_dumps(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into()),
        Value::Array(arr) => {
            let parts: Vec<String> = arr.iter().map(python_json_dumps).collect();
            format!("[{}]", parts.join(", "))
        }
        Value::Object(map) => {
            let sorted: BTreeMap<&String, &Value> = map.iter().collect();
            let parts: Vec<String> = sorted
                .into_iter()
                .map(|(k, val)| {
                    format!(
                        "{}: {}",
                        serde_json::to_string(k).unwrap_or_default(),
                        python_json_dumps(val)
                    )
                })
                .collect();
            format!("{{{}}}", parts.join(", "))
        }
    }
}

pub fn format_local_ctime(birth: f64) -> String {
    let secs = birth.floor() as i64;
    Local
        .timestamp_opt(secs, 0)
        .single()
        .map(|dt| dt.format("%a %b %d %H:%M:%S %Y").to_string())
        .unwrap_or_default()
}

pub fn verified_registry(reg: &Map<String, Value>, process: &Map<String, Value>) -> bool {
    let reg_pid = reg.get("pid").and_then(|v| v.as_i64());
    let proc_pid = process.get("pid").and_then(|v| v.as_i64());
    let sid = reg.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
    if reg_pid.is_none() || reg_pid != proc_pid || sid.is_empty() {
        return false;
    }
    let Some(proc_start) = reg.get("procStart").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(birth) = process.get("birth").and_then(|v| v.as_f64()) else {
        return false;
    };
    let Ok(ndt) = NaiveDateTime::parse_from_str(proc_start, "%a %b %d %H:%M:%S %Y") else {
        return false;
    };
    let reg_birth = Utc.from_utc_datetime(&ndt).timestamp() as f64;
    (reg_birth - birth).abs() < 1.1
}

pub fn process_rows(record: &Map<String, Value>) -> HashMap<i64, Map<String, Value>> {
    let mut result = HashMap::new();
    let Some(procs) = record.get("processes").and_then(|v| v.as_array()) else {
        return result;
    };
    for orig in procs {
        let Some(mut row) = orig.as_object().cloned() else {
            continue;
        };
        let described = describe_process(&row);
        row.insert(
            "kind".into(),
            described
                .kind
                .map(|k| Value::String(k.to_string()))
                .unwrap_or(Value::Null),
        );
        row.insert("role".into(), json!(described.role));
        row.insert(
            "explicit_session".into(),
            described
                .explicit_session
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
        if let Some(pid) = row.get("pid").and_then(|v| v.as_i64()) {
            result.insert(pid, row);
        }
    }
    result
}

pub fn terminal_for(meta: &Map<String, Value>, terminals: &[Value]) -> Option<Map<String, Value>> {
    for (field, key) in [("orca_handle", "handle"), ("orca_tab", "tabId")] {
        let Some(wanted) = meta
            .get(field)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let matches: Vec<&Map<String, Value>> = terminals
            .iter()
            .filter_map(|t| t.as_object())
            .filter(|t| t.get(key).and_then(|v| v.as_str()) == Some(wanted))
            .collect();
        if matches.len() == 1 {
            let t = matches[0];
            let mut out = Map::new();
            for k in [
                "handle",
                "tabId",
                "leafId",
                "title",
                "worktreePath",
                "incarnationId",
            ] {
                out.insert(k.into(), t.get(k).cloned().unwrap_or(Value::Null));
            }
            return Some(out);
        }
    }
    None
}

pub fn pane_thread_name(title: &str, cwd: &str) -> Option<String> {
    let base = Path::new(cwd)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let suffix = format!(" | {base}");
    let stripped = title.strip_suffix(&suffix)?;
    let no_braille = braille_prefix_re().replace(stripped, "");
    let cleaned = action_req_re().replace(&no_braille, "");
    Some(cleaned.into_owned())
}

pub fn context_for_pid(pid: i64, rows: &HashMap<i64, Map<String, Value>>) -> Map<String, Value> {
    let mut visited = HashSet::new();
    let mut current = pid;
    let mut nearest: Option<(String, String)> = None;
    while current != 0 && visited.insert(current) {
        let Some(row) = rows.get(&current) else {
            break;
        };
        if let Some(app_arr) = row.get("app").and_then(|v| v.as_array()) {
            let name = app_arr
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let path = app_arr
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !name.is_empty() {
                let known = APP_NAMES.contains(&name.as_str());
                nearest = Some((name, path));
                if known {
                    break;
                }
            }
        }
        current = row.get("ppid").and_then(|v| v.as_i64()).unwrap_or(0);
    }
    let tty = rows
        .get(&pid)
        .and_then(|r| r.get("tty"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let (app, app_path, match_kind) = if let Some((n, p)) = nearest {
        (n, p, "process_ancestry")
    } else if !tty.is_empty() {
        ("Terminal".to_string(), String::new(), "tty")
    } else {
        ("Background process".to_string(), String::new(), "process")
    };
    let mut out = Map::new();
    out.insert("app".into(), json!(app));
    out.insert("app_path".into(), json!(app_path));
    out.insert("terminal".into(), json!(tty));
    out.insert("match".into(), json!(match_kind));
    out
}

pub fn applications(rows: &HashMap<i64, Map<String, Value>>) -> Vec<Value> {
    let mut seen: HashMap<String, (i64, String)> = HashMap::new();
    for row in rows.values() {
        let Some(app_arr) = row.get("app").and_then(|v| v.as_array()) else {
            continue;
        };
        let name = app_arr.first().and_then(|v| v.as_str()).unwrap_or("");
        let path = app_arr.get(1).and_then(|v| v.as_str()).unwrap_or("");
        let pid = row.get("pid").and_then(|v| v.as_i64()).unwrap_or(0);
        if !name.is_empty() && (!path.is_empty() || APP_NAMES.contains(&name)) {
            let replace = match seen.get(name) {
                None => true,
                Some((old_pid, _)) => pid < *old_pid,
            };
            if replace {
                seen.insert(name.to_string(), (pid, path.to_string()));
            }
        }
    }
    seen.into_iter()
        .map(|(name, (pid, path))| {
            json!({
                "name": name,
                "pid": pid,
                "path": path,
                "evidence": "application_process",
                "note": "App detected; embedded AI sessions require a usage adapter."
            })
        })
        .collect()
}

fn chat_label(location: &Map<String, Value>, env: Option<&Map<String, Value>>) -> String {
    if env
        .and_then(|e| e.get("ORCA_STRUCTURED_SESSION"))
        .and_then(|v| v.as_str())
        == Some("1")
    {
        return "Orca 채팅".into();
    }
    let app = if location.get("match").and_then(|v| v.as_str()) == Some("process_ancestry") {
        location.get("app").and_then(|v| v.as_str()).unwrap_or("")
    } else {
        ""
    };
    if !app.is_empty() {
        format!("{app} 채팅")
    } else {
        "앱 채팅".into()
    }
}

fn workspace_norm(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn canonical_path_key(raw: &str) -> String {
    let expanded = if let Some(rest) = raw.strip_prefix("~/") {
        crate::platform_support::home_dir().join(rest)
    } else if raw == "~" {
        crate::platform_support::home_dir()
    } else {
        PathBuf::from(raw)
    };
    let resolved = std::fs::canonicalize(&expanded).unwrap_or(expanded);
    workspace_norm(&resolved.to_string_lossy())
}

fn sanitize_display_title(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("<openbot-developer-instructions>")
        || trimmed.starts_with("# AGENTS")
        || trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<INSTRUCTIONS>")
        || trimmed.starts_with("<user_instructions>")
    {
        String::new()
    } else {
        trimmed.to_string()
    }
}

fn openbot_seat(cwd: &str, agents: &[Value]) -> Option<String> {
    let target = workspace_norm(cwd);
    if target.is_empty() {
        return None;
    }
    for a in agents {
        let Some(ws) = a.get("workspace").and_then(|v| v.as_str()) else {
            continue;
        };
        if !ws.is_empty() && workspace_norm(ws) == target {
            if let Some(name) = a.get("name").and_then(|v| v.as_str()) {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn apply_openbot_app_row(row: &mut Map<String, Value>, name: &str, connected: bool) {
    row.insert("chat".into(), json!(true));
    row.insert("chat_name".into(), json!(name));
    row.insert("workspace_name".into(), json!(name));
    row.insert("project_name".into(), json!(name));
    row.insert("connected".into(), json!(connected));
    row.insert("terminal_match".into(), json!("chat"));
    row.insert("terminal_note".into(), json!("OpenBot 채팅"));
    row.insert(
        "location".into(),
        json!({
            "app": "OpenBot",
            "app_path": "/Applications/OpenBot.app",
            "terminal": "OpenBot 채팅",
            "match": "chat"
        }),
    );
}

fn turn_bounds(transcript: Option<&Value>) -> (f64, f64, bool) {
    let mut start = 0.0_f64;
    let mut end = 0.0_f64;
    let mut interrupted = false;
    let Some(events) = transcript
        .and_then(|v| v.as_object())
        .and_then(|m| m.get("events"))
        .and_then(|v| v.as_array())
    else {
        return (start, end, interrupted);
    };
    for ev in events {
        let Some(ev_map) = ev.as_object() else {
            continue;
        };
        let btree: BTreeMap<String, Value> =
            ev_map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        let kind = transcript_boundary(&btree);
        let stamp = epoch_from_value(ev_map.get("t"));
        match kind {
            Some("start") => start = start.max(stamp),
            Some(k) if stamp >= end => {
                end = stamp;
                interrupted = k == "interrupt";
            }
            _ => {}
        }
    }
    (start, end, interrupted)
}

pub fn decide_status(
    registries: &[Value],
    transcript: Option<&Value>,
    now: f64,
    connected: bool,
) -> (String, f64, String) {
    if !connected {
        return ("disconnected".into(), 0.0, "processes".into());
    }
    let records: Vec<&Map<String, Value>> = registries
        .iter()
        .filter_map(|v| v.as_object())
        .filter(|m| !m.is_empty())
        .collect();
    let waiting: Vec<f64> = records
        .iter()
        .filter(|r| r.get("status").and_then(|v| v.as_str()) == Some("waiting"))
        .map(|r| epoch_from_value(r.get("statusUpdatedAt")))
        .collect();
    if !waiting.is_empty() {
        let max_t = waiting.into_iter().fold(0.0_f64, f64::max);
        return ("waiting".into(), max_t, "registry".into());
    }
    let (start, mut end, mut interrupted) = turn_bounds(transcript);
    let closed = records
        .iter()
        .filter(|r| r.get("status").and_then(|v| v.as_str()) == Some("idle"))
        .map(|r| epoch_from_value(r.get("statusUpdatedAt")))
        .fold(0.0_f64, f64::max);
    if start > end && closed >= start {
        end = closed;
        interrupted = false;
    }
    if start > end {
        return ("working".into(), start, "transcript_turn".into());
    }
    if end > 0.0 {
        let recent_child = transcript
            .and_then(|v| v.as_object())
            .and_then(|m| m.get("subagents"))
            .and_then(|v| v.as_array())
            .is_some_and(|subs| {
                subs.iter().any(|c| {
                    let mt = epoch_from_value(c.get("mtime"));
                    let age = now - mt;
                    (0.0..120.0).contains(&age)
                })
            });
        let any_busy = records
            .iter()
            .any(|r| r.get("status").and_then(|v| v.as_str()) == Some("busy"));
        if recent_child || any_busy {
            return ("subagents".into(), end, "transcript_children".into());
        }
        if interrupted {
            return ("interrupted".into(), end, "transcript_turn".into());
        }
        let age = now - end;
        let st = if (0.0..600.0).contains(&age) {
            "done"
        } else {
            "idle"
        };
        return (st.into(), end, "transcript_turn".into());
    }
    let best = records.iter().max_by(|a, b| {
        let ta = epoch_from_value(a.get("statusUpdatedAt"));
        let tb = epoch_from_value(b.get("statusUpdatedAt"));
        ta.partial_cmp(&tb).unwrap_or(std::cmp::Ordering::Equal)
    });
    if let Some(rec) = best {
        let st = match rec.get("status").and_then(|v| v.as_str()).unwrap_or("") {
            "busy" | "working" => "working",
            "idle" => "idle",
            "interrupted" | "aborted" => "interrupted",
            _ => "unknown",
        };
        let src = rec
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("registry");
        (
            st.into(),
            epoch_from_value(rec.get("statusUpdatedAt")),
            src.into(),
        )
    } else {
        ("unknown".into(), 0.0, "registry".into())
    }
}

pub fn control_display(
    spec: &Map<String, Value>,
    mark: Option<&Map<String, Value>>,
) -> (String, bool) {
    let status = spec
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    if status == "disconnected" {
        return (status.into(), false);
    }
    let mut valid = mark.is_some_and(|m| {
        m.get("key").and_then(|v| v.as_str()) == spec.get("control_key").and_then(|v| v.as_str())
            && m.get("key").is_some_and(|v| !v.is_null())
    });
    if valid {
        if let Some(m) = mark {
            let status_at = spec
                .get("status_at")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let mark_at = m.get("at").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let phase = m.get("phase").and_then(|v| v.as_str()).unwrap_or("");
            if status_at > mark_at
                && (status == "working"
                    || (phase == "resuming" && matches!(status, "idle" | "interrupted" | "done")))
            {
                valid = false;
            }
        }
    }
    if valid {
        if let Some(m) = mark {
            let phase = m.get("phase").and_then(|v| v.as_str()).unwrap_or("");
            if phase == "resuming" {
                return ("resuming".into(), true);
            }
            if matches!(status, "idle" | "interrupted" | "done") {
                return ("paused".into(), true);
            }
        }
    }
    (status.into(), valid)
}

fn usable_name(value: Option<&str>) -> bool {
    let Some(s) = value else {
        return false;
    };
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return false;
    }
    if s.starts_with("/dev/")
        || s.starts_with("process-")
        || s.starts_with("cli-")
        || s.contains("미확인")
        || usable_ignore_re().is_match(s)
    {
        return false;
    }
    true
}

fn build_aside_rows(records: &[Value]) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for rv in records {
        let Some(r) = rv.as_object() else {
            continue;
        };
        let sid = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let profile = r.get("profile").and_then(|v| v.as_str()).unwrap_or("");
        let config = r.get("model").and_then(|v| v.as_object());
        let origin = r.get("trigger").and_then(|v| v.as_object());
        let parent = r
            .get("parent")
            .and_then(|v| v.as_str())
            .filter(|&p| p != sid && aside_id_re().is_match(p));
        let raw_status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let state = match raw_status {
            "running" | "streaming" | "executing" => "working",
            "errored" | "error" | "failed" | "cancelled" | "canceled" | "aborted" => "interrupted",
            other => other,
        };
        let running = r.get("running").and_then(|v| v.as_bool()).unwrap_or(false);
        let db = r.get("db").and_then(|v| v.as_str()).unwrap_or("");
        let created = r
            .get("created")
            .map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        let control_key = if running {
            Some(sha256_hex(format!("{db}:{sid}:{created}").as_bytes()))
        } else {
            None
        };
        let provider = config
            .and_then(|c| c.get("provider"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let model_id = config
            .and_then(|c| c.get("modelId"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let billing_kind = match provider {
            "openai-codex" => Some("Codex"),
            "claude-code" => Some("Claude"),
            "zai" => Some("GLM"),
            "google" => Some("Antigravity"),
            _ => None,
        };
        let billing_account = r
            .get("billing_accounts")
            .and_then(|v| v.as_object())
            .and_then(|m| m.get(provider))
            .cloned()
            .unwrap_or(Value::Null);
        let updated = r.get("updated").cloned().unwrap_or_else(|| json!(0));
        let is_subagent = parent.is_some()
            || origin.and_then(|o| o.get("type")).and_then(|v| v.as_str()) == Some("subagent");
        let mut row = Map::new();
        row.insert("id".into(), json!(format!("aside:{profile}:{sid}")));
        row.insert("conversation_id".into(), json!(sid));
        row.insert("kind".into(), json!("Aside"));
        row.insert(
            "config_dir".into(),
            json!(Path::new(db)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()),
        );
        row.insert(
            "cwd".into(),
            json!(r.get("cwd").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert(
            "title".into(),
            json!(sanitize_display_title(
                r.get("title").and_then(|v| v.as_str()).unwrap_or("")
            )),
        );
        row.insert("connected".into(), json!(running));
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("path".into(), r.get("path").cloned().unwrap_or(Value::Null));
        row.insert("configured_model".into(), json!(model_id));
        row.insert("provider".into(), json!(provider));
        row.insert(
            "control_key".into(),
            control_key.map(Value::String).unwrap_or(Value::Null),
        );
        row.insert("process_started".into(), Value::Null);
        row.insert("process_birth".into(), Value::Null);
        row.insert("orca_terminal".into(), Value::Null);
        row.insert("input_verified".into(), json!(false));
        row.insert("terminal_match".into(), json!("aside_database"));
        row.insert(
            "location".into(),
            json!({
                "app": "Aside",
                "app_path": "/Applications/Aside.app",
                "terminal": "Aside 내부 세션",
                "match": "aside_database"
            }),
        );
        row.insert(
            "terminal_note".into(),
            json!("Aside 내부 세션 · 터미널 CLI가 아님 · 바로가기는 Aside 앱 열기"),
        );
        row.insert(
            "source".into(),
            json!("Aside local session database and per-request usage reports"),
        );
        row.insert("aside_account".into(), json!(format!("u{profile}")));
        row.insert("aside_session".into(), json!(sid));
        row.insert("native_status".into(), json!(raw_status));
        row.insert("is_subagent".into(), json!(is_subagent));
        row.insert(
            "parent_session_id".into(),
            parent
                .map(|p| json!(format!("aside:{profile}:{p}")))
                .unwrap_or(Value::Null),
        );
        row.insert(
            "billing_kind".into(),
            billing_kind.map(|k| json!(k)).unwrap_or(Value::Null),
        );
        row.insert("billing_account".into(), billing_account);
        row.insert(
            "_registries".into(),
            json!([{"status": state, "statusUpdatedAt": updated}]),
        );
        row.insert("_transcript".into(), Value::Null);
        if let Some(eff) = effort_level(config.and_then(|c| c.get("thinkingLevel"))) {
            if !model_id.is_empty() {
                row.insert("effort".into(), json!(eff));
                row.insert("effort_model".into(), json!(model_id));
                row.insert("effort_source".into(), json!("aside_session_configuration"));
                row.insert("effort_updated".into(), updated);
            }
        }
        rows.push(row);
    }
    rows
}

fn build_openmausbot_rows(threads: &[Value], running: bool) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for rv in threads {
        let Some(r) = rv.as_object() else {
            continue;
        };
        let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let mut row = Map::new();
        row.insert("id".into(), json!(format!("openmausbot:{id}")));
        row.insert("conversation_id".into(), json!(id));
        row.insert(
            "kind".into(),
            json!(r.get("kind").and_then(|v| v.as_str()).unwrap_or("Claude")),
        );
        row.insert("config_dir".into(), json!(""));
        row.insert("cwd".into(), json!(""));
        row.insert("title".into(), json!(""));
        row.insert(
            "chat_name".into(),
            json!(r.get("bot").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("project_name".into(), json!("OpenMausBot"));
        row.insert("connected".into(), json!(running));
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("path".into(), Value::Null);
        row.insert("chat".into(), json!(true));
        row.insert(
            "configured_model".into(),
            json!(r.get("model").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("provider".into(), json!(""));
        row.insert("orca_terminal".into(), Value::Null);
        row.insert("input_verified".into(), json!(false));
        row.insert("terminal_match".into(), json!("chat"));
        row.insert("terminal_note".into(), json!("OpenMausBot 채팅"));
        row.insert(
            "location".into(),
            json!({
                "app": "OpenMausBot",
                "app_path": "/Applications/OpenMausBot.app",
                "terminal": "OpenMausBot 채팅",
                "match": "chat"
            }),
        );
        row.insert("source".into(), json!("OpenMausBot usage ledger"));
        row.insert("usage_adapter".into(), json!("openmausbot"));
        row.insert(
            "_registries".into(),
            json!([{
                "status": "idle",
                "statusUpdatedAt": r.get("updated").cloned().unwrap_or_else(|| json!(0)),
                "source": "openmausbot"
            }]),
        );
        row.insert("_transcript".into(), Value::Null);
        rows.push(row);
    }
    rows
}

fn build_devin_rows(
    sessions: &[Value],
    agents: &[Value],
    devin_running: bool,
    openbot_running: bool,
) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for rv in sessions {
        let Some(r) = rv.as_object() else {
            continue;
        };
        let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let cwd = r.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
        let mut row = Map::new();
        row.insert("id".into(), json!(format!("devin:{id}")));
        row.insert("conversation_id".into(), json!(id));
        row.insert("kind".into(), json!("Devin"));
        row.insert("config_dir".into(), json!(""));
        row.insert("cwd".into(), json!(cwd));
        row.insert(
            "title".into(),
            json!(sanitize_display_title(
                r.get("title").and_then(|v| v.as_str()).unwrap_or("")
            )),
        );
        row.insert("connected".into(), json!(devin_running));
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("path".into(), Value::Null);
        row.insert(
            "configured_model".into(),
            json!(r.get("model").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("provider".into(), json!(""));
        row.insert("orca_terminal".into(), Value::Null);
        row.insert("input_verified".into(), json!(false));
        row.insert("terminal_match".into(), json!("chat"));
        row.insert("chat".into(), json!(true));
        row.insert("terminal_note".into(), json!("Devin CLI 세션"));
        row.insert(
            "location".into(),
            json!({
                "app": "Devin",
                "app_path": "",
                "terminal": "Devin CLI",
                "match": "chat"
            }),
        );
        row.insert(
            "source".into(),
            json!("Devin local session database and per-response usage reports"),
        );
        row.insert("usage_adapter".into(), json!("devin"));
        let status_at = r
            .get("status_at")
            .filter(|v| v.as_f64().is_some_and(|x| x > 0.0))
            .or_else(|| r.get("updated"))
            .cloned()
            .unwrap_or_else(|| json!(0));
        row.insert(
            "_registries".into(),
            json!([{
                "status": r.get("status").and_then(|v| v.as_str()).unwrap_or("idle"),
                "statusUpdatedAt": status_at,
                "source": "devin"
            }]),
        );
        row.insert("_transcript".into(), Value::Null);
        if let Some(name) = openbot_seat(cwd, agents) {
            apply_openbot_app_row(&mut row, &name, openbot_running);
        }
        rows.push(row);
    }
    rows
}

fn build_antigravity_rows(
    conversations: &[Value],
    agents: &[Value],
    openbot_running: bool,
) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for rv in conversations {
        let Some(r) = rv.as_object() else {
            continue;
        };
        let cwd = r.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
        let Some(name) = openbot_seat(cwd, agents) else {
            continue;
        };
        let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let parent = r
            .get("parent")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let st = match r.get("status").and_then(|v| v.as_str()).unwrap_or("") {
            "CASCADE_RUN_STATUS_RUNNING" => "busy",
            _ => "idle",
        };
        let mut row = Map::new();
        row.insert("id".into(), json!(id));
        row.insert("conversation_id".into(), json!(id));
        row.insert("kind".into(), json!("Antigravity"));
        row.insert(
            "config_dir".into(),
            json!(r.get("root").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("cwd".into(), json!(cwd));
        row.insert(
            "title".into(),
            json!(sanitize_display_title(
                r.get("title").and_then(|v| v.as_str()).unwrap_or("")
            )),
        );
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("path".into(), Value::Null);
        row.insert("configured_model".into(), json!(""));
        row.insert("provider".into(), json!(""));
        row.insert("orca_terminal".into(), Value::Null);
        row.insert("input_verified".into(), json!(false));
        row.insert(
            "source".into(),
            json!("Antigravity ACP conversation summaries and per-response usage reports"),
        );
        row.insert("usage_adapter".into(), json!("antigravity"));
        row.insert("is_subagent".into(), json!(parent.is_some()));
        row.insert(
            "parent_session_id".into(),
            parent.map(|p| json!(p)).unwrap_or(Value::Null),
        );
        row.insert(
            "_registries".into(),
            json!([{
                "status": st,
                "statusUpdatedAt": r.get("modified").cloned().unwrap_or_else(|| json!(0)),
                "source": "antigravity"
            }]),
        );
        row.insert("_transcript".into(), Value::Null);
        apply_openbot_app_row(&mut row, &name, openbot_running);
        rows.push(row);
    }
    rows
}

fn build_recent_codex_rows(
    sessions: &[Value],
    agents: &[Value],
    openbot_running: bool,
) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for rv in sessions {
        let Some(r) = rv.as_object() else {
            continue;
        };
        let sid = r
            .get("session_id")
            .or_else(|| r.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if sid.is_empty() {
            continue;
        }
        let cwd = r.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
        let profile = r
            .get("profile")
            .and_then(|v| v.as_str())
            .unwrap_or("~/.codex");
        let name = r
            .get("name")
            .and_then(|v| v.as_str())
            .map(sanitize_display_title)
            .filter(|s| !s.is_empty());
        let raw_title = r.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let title = name
            .clone()
            .unwrap_or_else(|| sanitize_display_title(raw_title));
        let is_sub = r
            .get("is_subagent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let modified = r.get("modified").cloned().unwrap_or_else(|| json!(0));

        let mut row = Map::new();
        row.insert("id".into(), json!(sid));
        row.insert("conversation_id".into(), json!(sid));
        row.insert("kind".into(), json!("Codex"));
        row.insert("config_dir".into(), json!(profile));
        row.insert("cwd".into(), json!(cwd));
        row.insert("title".into(), json!(title));
        row.insert(
            "thread_name".into(),
            name.map(Value::String).unwrap_or(Value::Null),
        );
        row.insert("connected".into(), json!(true));
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("cpu".into(), Value::Null);
        row.insert("rss".into(), Value::Null);
        row.insert("path".into(), r.get("path").cloned().unwrap_or(Value::Null));
        row.insert(
            "configured_model".into(),
            json!(r.get("model").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("provider".into(), json!(""));
        row.insert("orca_terminal".into(), Value::Null);
        row.insert("input_verified".into(), json!(false));
        row.insert("chat".into(), json!(true));
        row.insert("terminal_match".into(), json!("chat"));
        row.insert("terminal_note".into(), json!("최근 Codex 세션"));
        row.insert(
            "location".into(),
            json!({
                "app": "Codex",
                "app_path": "",
                "terminal": "Codex CLI",
                "match": "chat"
            }),
        );
        row.insert("source".into(), json!("Codex recent session transcript"));
        row.insert("is_subagent".into(), json!(is_sub));
        row.insert(
            "parent_session_id".into(),
            r.get("parent_session_id").cloned().unwrap_or(Value::Null),
        );
        row.insert(
            "agent_depth".into(),
            r.get("agent_depth").cloned().unwrap_or(Value::Null),
        );
        row.insert(
            "agent_path".into(),
            r.get("agent_path").cloned().unwrap_or(Value::Null),
        );
        row.insert(
            "_registries".into(),
            json!([{
                "status": "idle",
                "statusUpdatedAt": modified,
                "source": "recent_codex"
            }]),
        );
        row.insert("_transcript".into(), Value::Null);
        if !is_sub {
            if let Some(agent_name) = openbot_seat(cwd, agents) {
                apply_openbot_app_row(&mut row, &agent_name, openbot_running);
            }
        }
        rows.push(row);
    }
    rows
}

fn build_recent_claude_rows(
    sessions: &[Value],
    agents: &[Value],
    openbot_running: bool,
) -> Vec<Map<String, Value>> {
    let mut rows = Vec::new();
    for rv in sessions {
        let Some(r) = rv.as_object() else {
            continue;
        };
        let sid = r
            .get("session_id")
            .or_else(|| r.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if sid.is_empty() {
            continue;
        }
        let cwd = r.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
        let profile = r
            .get("profile")
            .and_then(|v| v.as_str())
            .unwrap_or("~/.claude");
        let title = sanitize_display_title(r.get("title").and_then(|v| v.as_str()).unwrap_or(""));
        let modified = r.get("modified").cloned().unwrap_or_else(|| json!(0));

        let mut row = Map::new();
        row.insert("id".into(), json!(sid));
        row.insert("conversation_id".into(), json!(sid));
        row.insert("kind".into(), json!("Claude"));
        row.insert("config_dir".into(), json!(profile));
        row.insert("cwd".into(), json!(cwd));
        row.insert("title".into(), json!(title));
        row.insert("connected".into(), json!(true));
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("cpu".into(), Value::Null);
        row.insert("rss".into(), Value::Null);
        row.insert("path".into(), r.get("path").cloned().unwrap_or(Value::Null));
        row.insert(
            "configured_model".into(),
            json!(r.get("model").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("provider".into(), json!(""));
        row.insert("orca_terminal".into(), Value::Null);
        row.insert("input_verified".into(), json!(false));
        row.insert("chat".into(), json!(true));
        row.insert("terminal_match".into(), json!("chat"));
        row.insert("terminal_note".into(), json!("최근 Claude 세션"));
        row.insert(
            "location".into(),
            json!({
                "app": "Claude",
                "app_path": "",
                "terminal": "Claude Code",
                "match": "chat"
            }),
        );
        row.insert("source".into(), json!("Claude recent session transcript"));
        row.insert("is_subagent".into(), json!(false));
        row.insert("parent_session_id".into(), Value::Null);
        row.insert(
            "_registries".into(),
            json!([{
                "status": "idle",
                "statusUpdatedAt": modified,
                "source": "recent_claude"
            }]),
        );
        row.insert("_transcript".into(), Value::Null);
        if let Some(agent_name) = openbot_seat(cwd, agents) {
            apply_openbot_app_row(&mut row, &agent_name, openbot_running);
        }
        rows.push(row);
    }
    rows
}

/// Exact port of `hierarchy.py:annotate`.
pub fn annotate_hierarchy(specs: &mut [Map<String, Value>]) {
    let mut by_id: HashMap<String, usize> = HashMap::new();
    for (idx, s) in specs.iter().enumerate() {
        if let Some(id) = s.get("id").and_then(|v| v.as_str()) {
            by_id.insert(id.to_string(), idx);
        }
    }
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for i in 0..specs.len() {
        if !specs[i].contains_key("is_subagent") {
            specs[i].insert("is_subagent".into(), json!(false));
        }
        if !specs[i].contains_key("parent_session_id") {
            specs[i].insert("parent_session_id".into(), Value::Null);
        }
        let is_sub = specs[i]
            .get("is_subagent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if is_sub {
            let sid = specs[i]
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let skind = specs[i]
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let parent = specs[i]
                .get("parent_session_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if let Some(pid) = parent {
                if pid != sid {
                    if let Some(&pidx) = by_id.get(&pid) {
                        if specs[pidx].get("kind").and_then(|v| v.as_str()) == Some(skind.as_str())
                        {
                            children.entry(pid).or_default().push(sid);
                        }
                    }
                }
            }
            specs[i].insert("pids".into(), json!([]));
            specs[i].insert("input_verified".into(), json!(false));
            specs[i].remove("control_key");
            specs[i].remove("process_started");
            specs[i].remove("process_birth");
        }
    }

    // Compute root_session_id and inherited location for each session.
    let snapshot: Vec<Map<String, Value>> = specs.to_vec();
    for i in 0..specs.len() {
        let sid = snapshot[i]
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let skind = snapshot[i]
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mut seen = HashSet::new();
        seen.insert(sid.clone());
        let mut current = i;
        let mut ancestors = Vec::new();
        let mut complete = true;
        while snapshot[current]
            .get("is_subagent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            let parent_id = snapshot[current]
                .get("parent_session_id")
                .and_then(|v| v.as_str());
            let Some(pidx) = parent_id.and_then(|p| by_id.get(p)).copied() else {
                complete = false;
                break;
            };
            let pid_str = snapshot[pidx]
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !seen.insert(pid_str)
                || snapshot[pidx].get("kind").and_then(|v| v.as_str()) != Some(skind)
            {
                complete = false;
                break;
            }
            ancestors.push(pidx);
            current = pidx;
        }
        let root_id = if complete {
            snapshot[current].get("id").cloned().unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        specs[i].insert("root_session_id".into(), root_id);
        let child_list = children.get(&sid).cloned().unwrap_or_default();
        specs[i].insert("child_session_ids".into(), json!(child_list));

        let is_sub = snapshot[i]
            .get("is_subagent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !is_sub {
            continue;
        }
        specs[i].insert("orca_terminal".into(), Value::Null);
        specs[i].insert(
            "location".into(),
            json!({"app": "Unknown", "terminal": "", "match": "unverified"}),
        );
        specs[i].insert("terminal_match".into(), json!("unverified"));
        specs[i].insert(
            "terminal_note".into(),
            json!("하위 에이전트 · 부모 세션의 실행 위치 확인 필요"),
        );
        if complete {
            for pidx in ancestors {
                let parent = &snapshot[pidx];
                let loc = parent.get("location").and_then(|v| v.as_object());
                let confirmed_term =
                    if parent.get("terminal_match").and_then(|v| v.as_str()) == Some("confirmed") {
                        parent.get("orca_terminal").and_then(|v| v.as_object())
                    } else {
                        None
                    };
                let app_name = loc
                    .and_then(|l| l.get("app"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let loc_match = loc
                    .and_then(|l| l.get("match"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let known_app =
                    !app_name.is_empty() && app_name != "Unknown" && loc_match != "unverified";
                if confirmed_term.is_none() && !known_app {
                    continue;
                }
                let mut new_loc = loc.cloned().unwrap_or_default();
                new_loc.insert("match".into(), json!("parent_session"));
                if let Some(ct) = confirmed_term {
                    specs[i].insert("orca_terminal".into(), Value::Object(ct.clone()));
                    new_loc.insert("app".into(), json!("Orca"));
                }
                specs[i].insert("location".into(), Value::Object(new_loc));
                specs[i].insert("terminal_match".into(), json!("parent_session"));
                specs[i].insert(
                    "location_parent_id".into(),
                    parent.get("id").cloned().unwrap_or(Value::Null),
                );
                specs[i].insert(
                    "terminal_note".into(),
                    json!("명시된 부모 세션에서 확인한 실행 위치 · 하위 에이전트 직접 제어 불가"),
                );
                break;
            }
        }
    }
}

fn is_valid_num(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64()?;
    if n.is_finite() && n >= 0.0 {
        Some(n)
    } else {
        None
    }
}

fn as_vec4(v: Option<&Value>) -> Option<[i64; 4]> {
    let arr = v?.as_array()?;
    if arr.len() != 4 {
        return None;
    }
    let mut out = [0i64; 4];
    for (i, item) in arr.iter().enumerate() {
        let f = is_valid_num(Some(item))?;
        out[i] = f as i64;
    }
    Some(out)
}

fn sum_vec4s(vals: &[Option<[i64; 4]>]) -> Option<Value> {
    let mut acc = [0i64; 4];
    let mut any = false;
    for v in vals.iter().flatten() {
        any = true;
        for i in 0..4 {
            acc[i] += v[i];
        }
    }
    if any {
        Some(json!(acc))
    } else {
        None
    }
}

/// Exact port of `hierarchy.py:group_sessions`.
pub fn group_sessions(sessions: &[Value]) -> Vec<Value> {
    let mut order = Vec::new();
    let mut by_id: HashMap<String, &Map<String, Value>> = HashMap::new();
    for s in sessions {
        let Some(obj) = s.as_object() else {
            continue;
        };
        let Some(id) = obj.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        if !by_id.contains_key(id) {
            order.push(id.to_string());
        }
        by_id.insert(id.to_string(), obj);
    }

    let mut root_order = Vec::new();
    let mut members: HashMap<String, Vec<&Map<String, Value>>> = HashMap::new();
    for id in &order {
        let s = by_id[id];
        let root = s
            .get("root_session_id")
            .and_then(|v| v.as_str())
            .filter(|r| by_id.contains_key(*r))
            .unwrap_or(id.as_str())
            .to_string();
        if !members.contains_key(&root) {
            root_order.push(root.clone());
        }
        members.entry(root).or_default().push(s);
    }

    let mut result = Vec::with_capacity(root_order.len());
    for root_id in root_order {
        let rows = &members[&root_id];
        let mut group = by_id[&root_id].clone();
        let descendants: Vec<&&Map<String, Value>> = rows
            .iter()
            .filter(|s| s.get("id").and_then(|v| v.as_str()) != Some(root_id.as_str()))
            .collect();
        let children_ids: Vec<Value> = descendants
            .iter()
            .filter_map(|s| s.get("id").cloned())
            .collect();
        let children_working = descendants
            .iter()
            .filter(|s| {
                let st = s
                    .get("display_status")
                    .or_else(|| s.get("status"))
                    .and_then(|v| v.as_str());
                st == Some("working")
            })
            .count();
        let group_usage_partial = rows.iter().any(|s| as_vec4(s.get("tokens")).is_none());
        group.insert("children_ids".into(), Value::Array(children_ids));
        group.insert("children_count".into(), json!(descendants.len()));
        group.insert("children_working".into(), json!(children_working));
        group.insert("group_usage_partial".into(), json!(group_usage_partial));

        if descendants.is_empty() {
            result.push(Value::Object(group));
            continue;
        }

        let tok_vecs: Vec<Option<[i64; 4]>> =
            rows.iter().map(|s| as_vec4(s.get("tokens"))).collect();
        group.insert("tokens".into(), sum_vec4s(&tok_vecs).unwrap_or(Value::Null));
        let last_usage = rows
            .iter()
            .filter_map(|s| s.get("last_usage").and_then(|v| v.as_f64()))
            .fold(0.0_f64, f64::max);
        group.insert("last_usage".into(), json!(last_usage));

        let mut usage = group
            .get("usage")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        for key in ["last_minute", "last_five_minutes"] {
            let vals: Vec<Option<[i64; 4]>> = rows
                .iter()
                .map(|s| {
                    as_vec4(
                        s.get("usage")
                            .and_then(|u| u.as_object())
                            .and_then(|u| u.get(key)),
                    )
                })
                .collect();
            usage.insert(key.into(), sum_vec4s(&vals).unwrap_or(Value::Null));
        }
        for key in ["rate", "output_rate"] {
            let known: Vec<f64> = rows
                .iter()
                .filter_map(|s| {
                    is_valid_num(
                        s.get("usage")
                            .and_then(|u| u.as_object())
                            .and_then(|u| u.get(key)),
                    )
                })
                .collect();
            usage.insert(
                key.into(),
                if known.is_empty() {
                    Value::Null
                } else {
                    json!(known.into_iter().sum::<f64>())
                },
            );
        }
        let mut win_keys: HashSet<String> = HashSet::new();
        for s in rows {
            if let Some(w) = s
                .get("usage")
                .and_then(|u| u.as_object())
                .and_then(|u| u.get("windows"))
                .and_then(|v| v.as_object())
            {
                for k in w.keys() {
                    win_keys.insert(k.clone());
                }
            }
        }
        let mut win_map = Map::new();
        for key in &win_keys {
            let vals: Vec<Option<[i64; 4]>> = rows
                .iter()
                .map(|s| {
                    as_vec4(
                        s.get("usage")
                            .and_then(|u| u.as_object())
                            .and_then(|u| u.get("windows"))
                            .and_then(|w| w.as_object())
                            .and_then(|w| w.get(key)),
                    )
                })
                .collect();
            win_map.insert(key.clone(), sum_vec4s(&vals).unwrap_or(Value::Null));
        }
        usage.insert("windows".into(), Value::Object(win_map));

        let mut hist: BTreeMap<i64, i64> = BTreeMap::new();
        for s in rows {
            if let Some(entries) = s
                .get("usage")
                .and_then(|u| u.as_object())
                .and_then(|u| u.get("history"))
                .and_then(|v| v.as_array())
            {
                for entry in entries {
                    if let Some(arr) = entry.as_array() {
                        if arr.len() == 2 {
                            if let (Some(t), Some(val)) =
                                (is_valid_num(arr.first()), is_valid_num(arr.get(1)))
                            {
                                *hist.entry(t as i64).or_insert(0) += val as i64;
                            }
                        }
                    }
                }
            }
        }
        let hist_arr: Vec<Value> = hist.into_iter().map(|(t, v)| json!([t, v])).collect();
        usage.insert("history".into(), Value::Array(hist_arr));

        let accounts: HashSet<Option<String>> = rows
            .iter()
            .map(|s| {
                s.get("usage")
                    .and_then(|u| u.as_object())
                    .and_then(|u| u.get("weekly_account"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .collect();
        let single_account = if accounts.len() == 1 {
            accounts.into_iter().next().flatten()
        } else {
            None
        };
        usage.insert(
            "weekly_account".into(),
            single_account
                .as_ref()
                .map(|a| json!(a))
                .unwrap_or(Value::Null),
        );

        let mut weekly_est = Map::new();
        if let Some(ref acct) = single_account {
            for key in &win_keys {
                let mut estimates: Vec<&Map<String, Value>> = Vec::new();
                let mut complete = true;
                for s in rows {
                    let u = s.get("usage").and_then(|v| v.as_object());
                    let val = as_vec4(
                        u.and_then(|m| m.get("windows"))
                            .and_then(|w| w.as_object())
                            .and_then(|w| w.get(key)),
                    );
                    let Some(vec4) = val else {
                        complete = false;
                        break;
                    };
                    if vec4.iter().sum::<i64>() == 0 {
                        continue;
                    }
                    let est = u
                        .and_then(|m| m.get("weekly_estimate"))
                        .and_then(|w| w.as_object())
                        .and_then(|w| w.get(key))
                        .and_then(|e| e.as_object());
                    let ok = est.is_some_and(|e| {
                        e.get("account_id").and_then(|v| v.as_str()) == Some(acct.as_str())
                            && e.get("basis").and_then(|v| v.as_str())
                                == Some("calibrated_token_equivalent")
                            && is_valid_num(e.get("used_pp")).is_some()
                            && is_valid_num(e.get("tokens")).is_some()
                    });
                    if !ok {
                        complete = false;
                        break;
                    }
                    estimates.push(est.unwrap());
                }
                if complete
                    && !estimates.is_empty()
                    && estimates
                        .iter()
                        .all(|e| e.get("calibration") == estimates[0].get("calibration"))
                {
                    let mut combined = estimates[0].clone();
                    let pp_sum: f64 = estimates
                        .iter()
                        .filter_map(|e| e.get("used_pp").and_then(|v| v.as_f64()))
                        .sum();
                    let tok_sum: i64 = estimates
                        .iter()
                        .filter_map(|e| e.get("tokens").and_then(|v| v.as_i64()))
                        .sum();
                    let partial = estimates
                        .iter()
                        .any(|e| e.get("partial").and_then(|v| v.as_bool()).unwrap_or(false));
                    combined.insert(
                        "used_pp".into(),
                        json!((pp_sum * 10000.0).round_ties_even() / 10000.0),
                    );
                    combined.insert("tokens".into(), json!(tok_sum));
                    combined.insert("partial".into(), json!(partial));
                    weekly_est.insert(key.clone(), Value::Object(combined));
                }
            }
        }
        usage.insert("weekly_estimate".into(), Value::Object(weekly_est));
        group.insert("usage".into(), Value::Object(usage));
        result.push(Value::Object(group));
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn get_or_add_group<'a>(
    groups: &'a mut HashMap<(String, String, String), Map<String, Value>>,
    group_order: &mut Vec<(String, String, String)>,
    kind: &str,
    profile: &str,
    sid: &str,
    proc_row: &Map<String, Value>,
    reg: &Map<String, Value>,
    transcript: Option<&Value>,
) -> &'a mut Map<String, Value> {
    let key = (kind.to_string(), profile.to_string(), sid.to_string());
    if !groups.contains_key(&key) {
        group_order.push(key.clone());
        let mut row = Map::new();
        row.insert("id".into(), json!(sid));
        row.insert("conversation_id".into(), json!(sid));
        row.insert("kind".into(), json!(kind));
        row.insert("config_dir".into(), json!(profile));
        let cwd = reg
            .get("cwd")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| proc_row.get("cwd").and_then(|v| v.as_str()))
            .unwrap_or("");
        row.insert("cwd".into(), json!(cwd));
        row.insert(
            "title".into(),
            json!(reg.get("name").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert(
            "path".into(),
            transcript
                .and_then(|t| t.get("path"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        row.insert(
            "configured_model".into(),
            json!(proc_row
                .get("configured_model")
                .and_then(|v| v.as_str())
                .unwrap_or("")),
        );
        row.insert(
            "provider".into(),
            json!(proc_row
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("")),
        );
        row.insert("connected".into(), json!(false));
        row.insert("runs".into(), json!([]));
        row.insert("pids".into(), json!([]));
        row.insert("pid".into(), Value::Null);
        row.insert("cpu".into(), Value::Null);
        row.insert("rss".into(), Value::Null);
        row.insert("status".into(), json!("unknown"));
        row.insert("status_at".into(), json!(0));
        row.insert("_registries".into(), json!([]));
        row.insert(
            "_transcript".into(),
            transcript.cloned().unwrap_or(Value::Null),
        );
        row.insert("_identity".into(), json!([kind, profile, sid]));
        row.insert("source".into(), json!("세션 관찰 기록"));
        groups.insert(key.clone(), row);
    }
    groups.get_mut(&key).unwrap()
}

/// Exact port of `sessions/__init__.py:resolve`.
pub fn resolve_sessions(record: &Map<String, Value>) -> Vec<Map<String, Value>> {
    let mut processes = process_rows(record);
    let empty_obj = Map::new();
    let registries = record
        .get("claude_registry")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_obj);

    let mut valid: HashMap<i64, Map<String, Value>> = HashMap::new();
    for (&pid, proc_row) in &processes {
        let key = pid.to_string();
        if let Some(reg) = registries.get(&key).and_then(|v| v.as_object()) {
            if verified_registry(reg, proc_row) {
                valid.insert(pid, reg.clone());
            }
        }
    }
    for (&pid, reg) in &valid {
        if reg.get("kind").and_then(|v| v.as_str()) == Some("bg") {
            if let Some(p) = processes.get_mut(&pid) {
                p.insert("role".into(), json!("background"));
            }
        }
    }

    let mut ag_map: HashMap<i64, Map<String, Value>> = HashMap::new();
    if let Some(ag_list) = record
        .get("antigravity_sessions")
        .and_then(|v| v.as_array())
    {
        for a in ag_list {
            let Some(ao) = a.as_object() else {
                continue;
            };
            let Some(pid) = ao.get("pid").and_then(|v| v.as_i64()) else {
                continue;
            };
            if !processes.contains_key(&pid) {
                continue;
            }
            let st = match ao.get("status").and_then(|v| v.as_str()).unwrap_or("") {
                "CASCADE_RUN_STATUS_RUNNING" => Value::String("busy".into()),
                "CASCADE_RUN_STATUS_IDLE" => Value::String("idle".into()),
                _ => Value::Null,
            };
            let mut m = Map::new();
            m.insert("pid".into(), json!(pid));
            m.insert(
                "sessionId".into(),
                ao.get("session_id").cloned().unwrap_or(Value::Null),
            );
            m.insert(
                "name".into(),
                json!(ao.get("title").and_then(|v| v.as_str()).unwrap_or("")),
            );
            m.insert("status".into(), st);
            m.insert(
                "statusUpdatedAt".into(),
                ao.get("modified").cloned().unwrap_or_else(|| json!(0)),
            );
            m.insert("source".into(), json!("antigravity"));
            ag_map.insert(pid, m);
        }
    }

    let mut profiles: HashMap<i64, String> = HashMap::new();
    for (&pid, p) in &processes {
        let dir = p
            .get("config_dir")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                p.get("env")
                    .and_then(|v| v.as_object())
                    .and_then(|e| e.get("CLAUDE_CONFIG_DIR"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or("~/.claude")
            .to_string();
        profiles.insert(pid, dir);
    }

    let mut jobs: HashMap<(String, String), Vec<i64>> = HashMap::new();
    for (&pid, reg) in &valid {
        if reg.get("kind").and_then(|v| v.as_str()) == Some("bg") {
            if let Some(jid) = reg
                .get("jobId")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                jobs.entry((profiles[&pid].clone(), jid.to_string()))
                    .or_default()
                    .push(pid);
            }
        }
    }

    let mut links: HashMap<i64, i64> = HashMap::new();
    let mut conflicts: HashSet<i64> = HashSet::new();
    for (&pid, reg) in &valid {
        let Some(pjid) = reg
            .get("parkedJobId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let Some(cands) = jobs.get(&(profiles[&pid].clone(), pjid.to_string())) else {
            continue;
        };
        if cands.len() > 1 {
            conflicts.insert(pid);
            for &c in cands {
                conflicts.insert(c);
            }
        } else if cands.len() == 1 {
            let job = cands[0];
            let reg_cwd = reg.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let job_cwd = valid
                .get(&job)
                .and_then(|r| r.get("cwd"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if job != pid && !reg_cwd.is_empty() && reg_cwd == job_cwd {
                links.insert(pid, job);
            }
        }
    }
    let link_keys: Vec<i64> = links.keys().copied().collect();
    for pid in link_keys {
        let mut seen = HashSet::new();
        let mut p = pid;
        while let Some(&next) = links.get(&p) {
            if !seen.insert(p) {
                break;
            }
            p = next;
            if seen.contains(&p) {
                conflicts.extend(seen);
                break;
            }
        }
    }
    links.retain(|p, j| !conflicts.contains(p) && !conflicts.contains(j));

    let mut group_order: Vec<(String, String, String)> = Vec::new();
    let mut groups: HashMap<(String, String, String), Map<String, Value>> = HashMap::new();

    let empty_transcripts = Map::new();
    let claude_transcripts = record
        .get("claude_transcripts")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_transcripts);
    let has_ag_key = record.contains_key("antigravity_sessions");

    let mut proc_pids: Vec<i64> = processes.keys().copied().collect();
    proc_pids.sort_unstable();

    for &pid in &proc_pids {
        let p = &processes[&pid];
        let kind = p.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let role = p.get("role").and_then(|v| v.as_str()).unwrap_or("");
        if !matches!(kind, "Claude" | "GLM" | "Antigravity") || role == "helper" {
            continue;
        }
        let reg = valid
            .get(&pid)
            .or_else(|| ag_map.get(&pid))
            .cloned()
            .unwrap_or_default();
        if role == "background" && reg.is_empty() {
            continue;
        }
        let mut chain = vec![pid];
        let mut end = pid;
        while let Some(&next) = links.get(&end) {
            end = next;
            chain.push(end);
        }
        let target = valid.get(&end).cloned().unwrap_or_else(|| reg.clone());
        let seat = if role == "chat" {
            p.get("env")
                .and_then(|v| v.as_object())
                .and_then(|e| e.get("ORCA_AGENT_SESSION_ID"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        } else {
            None
        };
        let sid = target
            .get("sessionId")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or(seat)
            .map(str::to_string)
            .unwrap_or_else(|| {
                let birth = p.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0);
                format!("process-{pid}-{birth}")
            });
        let root = &profiles[&pid];
        let tr = claude_transcripts
            .get(&format!("{root}:{sid}"))
            .or_else(|| claude_transcripts.get(&sid));
        let end_proc = &processes[&end];
        let row = get_or_add_group(
            &mut groups,
            &mut group_order,
            kind,
            root,
            &sid,
            end_proc,
            &target,
            tr,
        );
        if reg.is_empty() {
            row.insert("process_only".into(), json!(true));
            if kind == "Antigravity" && role != "chat" && has_ag_key {
                if let Some(arr) = row.get_mut("_registries").and_then(|v| v.as_array_mut()) {
                    arr.push(json!({
                        "status": "idle",
                        "statusUpdatedAt": p.get("birth").cloned().unwrap_or_else(|| json!(0)),
                        "source": "antigravity"
                    }));
                }
            }
        }
        let prev_conf = row
            .get("identity_conflict")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        row.insert(
            "identity_conflict".into(),
            json!(prev_conf || conflicts.contains(&pid)),
        );
        let prev_shape = row
            .get("shape_unknown")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        row.insert(
            "shape_unknown".into(),
            json!(prev_shape || role == "shape_unknown"),
        );
        if links.contains_key(&pid) {
            if !row
                .get("continuation_sources")
                .is_some_and(|v| v.is_array())
            {
                row.insert("continuation_sources".into(), json!([]));
            }
            if let Some(cs) = row
                .get_mut("continuation_sources")
                .and_then(|v| v.as_array_mut())
            {
                for &member in &chain {
                    if let Some(msid) = valid
                        .get(&member)
                        .and_then(|r| r.get("sessionId"))
                        .and_then(|v| v.as_str())
                    {
                        let mpath = claude_transcripts
                            .get(&format!("{root}:{msid}"))
                            .or_else(|| claude_transcripts.get(msid))
                            .and_then(|t| t.get("path"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        let src = json!({"session_id": msid, "path": mpath});
                        if !cs.contains(&src) {
                            cs.push(src);
                        }
                    }
                }
            }
        }
        row.insert("connected".into(), json!(true));
        if let Some(runs) = row.get_mut("runs").and_then(|v| v.as_array_mut()) {
            runs.push(json!({
                "pid": pid,
                "birth": p.get("birth").cloned().unwrap_or(Value::Null),
                "tty": p.get("tty").and_then(|v| v.as_str()).unwrap_or(""),
                "role": role,
                "connected": true,
                "_registry": reg,
                "conversation_id": reg.get("sessionId").cloned().unwrap_or(Value::Null),
                "active_pid": end,
                "owns_terminal": role != "background",
                "shape_unknown": role == "shape_unknown"
            }));
        }
        if !links.contains_key(&pid) && !reg.is_empty() {
            if let Some(arr) = row.get_mut("_registries").and_then(|v| v.as_array_mut()) {
                arr.push(Value::Object(reg));
            }
        }
        row.insert(
            "waiting_for".into(),
            target.get("waitingFor").cloned().unwrap_or(Value::Null),
        );
    }

    // Codex logs
    let mut matched_pids: HashSet<i64> = HashSet::new();
    let codex_logs = record
        .get("codex_logs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let tmux_panes = record
        .get("tmux_panes")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_obj);

    for log_val in &codex_logs {
        let Some(log) = log_val.as_object() else {
            continue;
        };
        let sid = log
            .get("session_id")
            .or_else(|| log.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if sid.is_empty() {
            continue;
        }
        let profile = log
            .get("profile")
            .and_then(|v| v.as_str())
            .unwrap_or("~/.codex")
            .to_string();
        let holders: Vec<i64> = log
            .get("holders")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_i64())
                    .filter(|pid| processes.contains_key(pid))
                    .collect()
            })
            .unwrap_or_default();
        let first_holder = holders
            .first()
            .and_then(|pid| processes.get(pid))
            .cloned()
            .unwrap_or_default();
        let mut fake_reg = Map::new();
        fake_reg.insert(
            "cwd".into(),
            json!(log.get("cwd").and_then(|v| v.as_str()).unwrap_or("")),
        );
        let name_or_title = log
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| log.get("title").and_then(|v| v.as_str()))
            .unwrap_or("");
        fake_reg.insert("name".into(), json!(name_or_title));

        let row = get_or_add_group(
            &mut groups,
            &mut group_order,
            "Codex",
            &profile,
            &sid,
            &first_holder,
            &fake_reg,
            Some(log_val),
        );
        row.insert(
            "thread_name".into(),
            log.get("name").cloned().unwrap_or(Value::Null),
        );
        let is_sub = log
            .get("is_subagent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        row.insert("is_subagent".into(), json!(is_sub));
        row.insert(
            "parent_session_id".into(),
            log.get("parent_session_id").cloned().unwrap_or(Value::Null),
        );
        row.insert(
            "agent_depth".into(),
            log.get("agent_depth").cloned().unwrap_or(Value::Null),
        );
        row.insert(
            "agent_path".into(),
            log.get("agent_path").cloned().unwrap_or(Value::Null),
        );
        row.insert(
            "configured_model".into(),
            json!(log.get("model").and_then(|v| v.as_str()).unwrap_or("")),
        );
        row.insert("connected".into(), json!(!holders.is_empty()));
        row.insert("_holders".into(), json!(holders));
        row.insert(
            "pid".into(),
            holders.first().map(|p| json!(p)).unwrap_or(Value::Null),
        );

        let log_name = log.get("name").and_then(|v| v.as_str());
        let log_cwd = log.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
        let unique = codex_logs
            .iter()
            .filter_map(|v| v.as_object())
            .filter(|other| {
                other.get("name").and_then(|v| v.as_str()) == log_name
                    && other.get("cwd").and_then(|v| v.as_str()).unwrap_or("") == log_cwd
            })
            .count()
            == 1;

        if !is_sub {
            for &pid in &proc_pids {
                let proc_row = &processes[&pid];
                if proc_row.get("kind").and_then(|v| v.as_str()) != Some("Codex")
                    || proc_row.get("role").and_then(|v| v.as_str()) == Some("helper")
                {
                    continue;
                }
                let pane = proc_row
                    .get("env")
                    .and_then(|v| v.as_object())
                    .and_then(|e| e.get("TMUX_PANE"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let pane_title = tmux_panes.get(pane).and_then(|v| v.as_str()).unwrap_or("");
                let exact_name = log_name.is_some_and(|ln| {
                    !ln.is_empty()
                        && proc_row.get("cwd").and_then(|v| v.as_str()) == Some(log_cwd)
                        && pane_thread_name(pane_title, log_cwd).as_deref() == Some(ln)
                });
                let sole_holder = holders.contains(&pid)
                    && codex_logs
                        .iter()
                        .filter_map(|v| v.as_object())
                        .filter(|other| {
                            other
                                .get("holders")
                                .and_then(|h| h.as_array())
                                .is_some_and(|arr| arr.iter().any(|x| x.as_i64() == Some(pid)))
                        })
                        .count()
                        == 1;
                let explicit_match =
                    proc_row.get("explicit_session").and_then(|v| v.as_str()) == Some(sid.as_str());
                if explicit_match || (exact_name && unique) || sole_holder {
                    matched_pids.insert(pid);
                    if let Some(runs) = row.get_mut("runs").and_then(|v| v.as_array_mut()) {
                        runs.push(json!({
                            "pid": pid,
                            "birth": proc_row.get("birth").cloned().unwrap_or(Value::Null),
                            "tty": proc_row.get("tty").and_then(|v| v.as_str()).unwrap_or(""),
                            "role": proc_row.get("role").and_then(|v| v.as_str()).unwrap_or("interactive"),
                            "connected": true,
                            "active_pid": pid,
                            "owns_terminal": true
                        }));
                    }
                }
            }
        }
    }

    // Remaining generic AI CLIs
    for &pid in &proc_pids {
        let p = &processes[&pid];
        let Some(kind) = p.get("kind").and_then(|v| v.as_str()) else {
            continue;
        };
        if matches!(kind, "Claude" | "GLM" | "Antigravity" | "Aside")
            || matched_pids.contains(&pid)
            || p.get("role").and_then(|v| v.as_str()) == Some("helper")
        {
            continue;
        }
        let mut parent = p.get("ppid").and_then(|v| v.as_i64()).unwrap_or(0);
        let mut seen = HashSet::new();
        while let Some(pr) = processes.get(&parent) {
            if !seen.insert(parent) || pr.get("kind").and_then(|v| v.as_str()).is_some() {
                break;
            }
            parent = pr.get("ppid").and_then(|v| v.as_i64()).unwrap_or(0);
        }
        if processes
            .get(&parent)
            .and_then(|pr| pr.get("kind"))
            .and_then(|v| v.as_str())
            .is_some()
        {
            continue;
        }
        let cfg = p.get("config_dir").and_then(|v| v.as_str()).unwrap_or("");
        let birth = p.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let sid = format!("cli-{pid}-{birth}");
        let row = get_or_add_group(
            &mut groups,
            &mut group_order,
            kind,
            cfg,
            &sid,
            p,
            &empty_obj,
            None,
        );
        row.insert("process_only".into(), json!(true));
        row.insert("connected".into(), json!(true));
        row.insert(
            "runs".into(),
            json!([{
                "pid": pid,
                "birth": p.get("birth").cloned().unwrap_or(Value::Null),
                "tty": p.get("tty").and_then(|v| v.as_str()).unwrap_or(""),
                "role": p.get("role").and_then(|v| v.as_str()).unwrap_or("interactive"),
                "connected": true,
                "active_pid": pid,
                "owns_terminal": true
            }]),
        );
    }

    let mut rows: Vec<Map<String, Value>> = group_order
        .into_iter()
        .filter_map(|k| groups.remove(&k))
        .collect();

    // Collision namespacing + runs sorting + pids
    let mut id_counts: HashMap<String, usize> = HashMap::new();
    for row in &rows {
        if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
            *id_counts.entry(id.to_string()).or_insert(0) += 1;
        }
    }
    let mut by_native: HashMap<(String, String, String), String> = HashMap::new();
    for row in &mut rows {
        let id = row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id_counts.get(&id).copied().unwrap_or(0) > 1 {
            let ident_parts: Vec<String> = row
                .get("_identity")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .map(|x| x.as_str().unwrap_or("").to_string())
                        .collect()
                })
                .unwrap_or_default();
            let suffix = &sha256_hex(ident_parts.join("\0").as_bytes())[..16];
            row.insert("id".into(), json!(format!("{id}:{suffix}")));
        }
        if let Some(runs) = row.get_mut("runs").and_then(|v| v.as_array_mut()) {
            runs.sort_by(|a, b| {
                let ao = !a
                    .get("owns_terminal")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let bo = !b
                    .get("owns_terminal")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let ab = a.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let bb = b.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let ap = a.get("pid").and_then(|v| v.as_i64()).unwrap_or(0);
                let bp = b.get("pid").and_then(|v| v.as_i64()).unwrap_or(0);
                ao.cmp(&bo)
                    .then_with(|| ab.partial_cmp(&bb).unwrap_or(std::cmp::Ordering::Equal))
                    .then_with(|| ap.cmp(&bp))
            });
            let mut pids: Vec<i64> = runs
                .iter()
                .filter_map(|r| r.get("active_pid").and_then(|v| v.as_i64()))
                .collect();
            pids.sort_unstable();
            pids.dedup();
            if let Some(&first) = pids.first() {
                row.insert("pid".into(), json!(first));
            }
            row.insert("pids".into(), json!(pids));
        }
        let cid = row.get("conversation_id").cloned().unwrap_or(Value::Null);
        row.insert("active_session_id".into(), cid.clone());
        let cid_str = cid.as_str().unwrap_or("").to_string();
        if let Some(cs) = row
            .get_mut("continuation_sources")
            .and_then(|v| v.as_array_mut())
        {
            cs.sort_by_key(|s| {
                s.get("session_id").and_then(|v| v.as_str()) == Some(cid_str.as_str())
            });
            let prev_ids: Vec<Value> = cs
                .iter()
                .filter(|s| s.get("session_id").and_then(|v| v.as_str()) != Some(cid_str.as_str()))
                .filter_map(|s| s.get("session_id").cloned())
                .collect();
            row.insert("previous_session_ids".into(), Value::Array(prev_ids));
        }
        if let Some(ident) = row.get("_identity").and_then(|v| v.as_array()) {
            if ident.len() == 3 {
                let k = (
                    ident[0].as_str().unwrap_or("").to_string(),
                    ident[1].as_str().unwrap_or("").to_string(),
                    ident[2].as_str().unwrap_or("").to_string(),
                );
                let new_id = row
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                by_native.insert(k, new_id);
            }
        }
    }
    for row in &mut rows {
        if let Some(parent) = row
            .get("parent_session_id")
            .and_then(|v| v.as_str())
            .map(str::to_string)
        {
            if let Some(ident) = row.get("_identity").and_then(|v| v.as_array()) {
                if ident.len() >= 2 {
                    let key = (
                        ident[0].as_str().unwrap_or("").to_string(),
                        ident[1].as_str().unwrap_or("").to_string(),
                        parent.clone(),
                    );
                    if let Some(mapped) = by_native.get(&key) {
                        row.insert("parent_session_id".into(), json!(mapped));
                    }
                }
            }
        }
    }

    // Apply terminals (sessions/terminals.py:apply)
    let terminals_slice = record
        .get("orca_terminals")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut handle_owners: HashMap<String, HashSet<String>> = HashMap::new();
    for row in &mut rows {
        let cid = row
            .get("conversation_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let is_sub = row
            .get("is_subagent")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let has_owners = row
            .get("runs")
            .and_then(|v| v.as_array())
            .is_some_and(|runs| {
                runs.iter().any(|r| {
                    r.get("owns_terminal")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                })
            });
        if let Some(runs) = row.get_mut("runs").and_then(|v| v.as_array_mut()) {
            for run_val in runs.iter_mut() {
                let Some(run) = run_val.as_object_mut() else {
                    continue;
                };
                let rpid = run.get("pid").and_then(|v| v.as_i64()).unwrap_or(0);
                let Some(proc_row) = processes.get(&rpid) else {
                    continue;
                };
                let env = proc_row.get("env").and_then(|v| v.as_object());
                let owns = run
                    .get("owns_terminal")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let mut blocked = false;
                if !owns {
                    let mut parent = proc_row.get("ppid").and_then(|v| v.as_i64()).unwrap_or(0);
                    let mut seen = HashSet::new();
                    while processes.contains_key(&parent) && seen.insert(parent) {
                        let other = registries
                            .get(&parent.to_string())
                            .and_then(|v| v.as_object())
                            .and_then(|r| r.get("sessionId"))
                            .and_then(|v| v.as_str());
                        if let Some(osid) = other {
                            if !osid.is_empty() && osid != cid {
                                blocked = true;
                                break;
                            }
                        }
                        parent = processes[&parent]
                            .get("ppid")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(0);
                    }
                }
                let mut term = if blocked || is_sub {
                    None
                } else {
                    let mut meta = Map::new();
                    if let Some(e) = env {
                        if let Some(v) = e.get("ORCA_TERMINAL_HANDLE") {
                            meta.insert("orca_handle".into(), v.clone());
                        }
                        if let Some(v) = e.get("ORCA_TAB_ID") {
                            meta.insert("orca_tab".into(), v.clone());
                        }
                    }
                    terminal_for(&meta, &terminals_slice)
                };
                if has_owners && !owns {
                    term = None;
                }
                let tkey = term
                    .as_ref()
                    .and_then(|t| t.get("handle").and_then(|v| v.as_str()).map(str::to_string))
                    .or_else(|| {
                        let tty = run.get("tty").and_then(|v| v.as_str()).unwrap_or("");
                        if owns && !matches!(tty, "" | "??" | "?") {
                            Some(format!("tty:{tty}"))
                        } else {
                            None
                        }
                    });
                let mut loc = context_for_pid(rpid, &processes);
                if run.get("role").and_then(|v| v.as_str()) == Some("chat") {
                    let lbl = chat_label(&loc, env);
                    loc.insert("terminal".into(), json!(lbl));
                    loc.insert("match".into(), json!("chat"));
                }
                if !owns && term.is_none() {
                    loc = json!({
                        "app": "Background process",
                        "terminal": "백그라운드",
                        "match": "background"
                    })
                    .as_object()
                    .unwrap()
                    .clone();
                }
                run.insert(
                    "terminal".into(),
                    term.clone().map(Value::Object).unwrap_or(Value::Null),
                );
                run.insert(
                    "terminal_match".into(),
                    json!(if term.is_some() {
                        "confirmed"
                    } else {
                        "unavailable"
                    }),
                );
                run.insert(
                    "terminal_key".into(),
                    tkey.map(Value::String).unwrap_or(Value::Null),
                );
                run.insert("location".into(), Value::Object(loc));
            }
        }

        let runs_clone = row
            .get("runs")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let owners: Vec<&Map<String, Value>> = runs_clone
            .iter()
            .filter_map(|v| v.as_object())
            .filter(|r| {
                r.get("owns_terminal")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            })
            .collect();
        let visible: Vec<&Map<String, Value>> = if !owners.is_empty() {
            owners
        } else {
            runs_clone.iter().filter_map(|v| v.as_object()).collect()
        };
        let primary = visible
            .iter()
            .copied()
            .find(|r| r.get("terminal").is_some_and(|t| t.is_object()))
            .or_else(|| visible.first().copied());
        let orca_term = primary
            .and_then(|p| p.get("terminal"))
            .filter(|v| v.is_object())
            .cloned()
            .unwrap_or(Value::Null);
        let has_term = orca_term.is_object();
        row.insert("orca_terminal".into(), orca_term);
        row.insert(
            "terminal_match".into(),
            json!(if has_term { "confirmed" } else { "unavailable" }),
        );
        row.insert(
            "location".into(),
            primary
                .and_then(|p| p.get("location"))
                .cloned()
                .unwrap_or_else(
                    || json!({"app": "Unknown", "terminal": "", "match": "unverified"}),
                ),
        );
        row.insert(
            "terminal_note".into(),
            json!(if has_term {
                "실행의 Orca 터미널 ID"
            } else {
                "터미널 연결 확인 안 됨"
            }),
        );
        let mut is_chat = visible
            .iter()
            .any(|r| r.get("role").and_then(|v| v.as_str()) == Some("chat"));
        let holder = row
            .get("_holders")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_i64());
        if runs_clone.is_empty() && !is_sub {
            if let Some(hpid) = holder {
                if let Some(hp) = processes.get(&hpid) {
                    let htty = hp.get("tty").and_then(|v| v.as_str()).unwrap_or("");
                    if matches!(htty, "" | "?" | "??") {
                        let mut where_loc = context_for_pid(hpid, &processes);
                        if where_loc.get("match").and_then(|v| v.as_str())
                            == Some("process_ancestry")
                        {
                            let lbl = chat_label(&where_loc, None);
                            where_loc.insert("terminal".into(), json!(lbl));
                            where_loc.insert("match".into(), json!("chat"));
                            row.insert("location".into(), Value::Object(where_loc));
                            is_chat = true;
                        }
                    }
                }
            }
        }
        row.insert("chat".into(), json!(is_chat));
        if is_chat && !has_term {
            let lbl = visible
                .iter()
                .find(|r| r.get("role").and_then(|v| v.as_str()) == Some("chat"))
                .and_then(|r| r.get("location"))
                .and_then(|l| l.get("terminal"))
                .and_then(|v| v.as_str())
                .or_else(|| {
                    row.get("location")
                        .and_then(|l| l.get("terminal"))
                        .and_then(|v| v.as_str())
                })
                .filter(|s| !s.is_empty())
                .unwrap_or("Orca 채팅")
                .to_string();
            row.insert("terminal_match".into(), json!("chat"));
            row.insert("terminal_note".into(), json!(lbl));
        }
        if let Some(pr) = primary {
            let ppid = pr.get("pid").and_then(|v| v.as_i64());
            let apid = pr.get("active_pid").and_then(|v| v.as_i64());
            if ppid != apid {
                if let Some(v) = ppid {
                    row.insert("terminal_owner_pid".into(), json!(v));
                }
            }
        }
        row.insert("input_verified".into(), json!(false));
        let targets: Vec<i64> = row
            .get("pids")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_i64()).collect())
            .unwrap_or_default();
        let conflict = row
            .get("identity_conflict")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let shape_unk = row
            .get("shape_unknown")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if targets.len() == 1 && !is_sub && !conflict && !shape_unk && !is_chat {
            if let Some(p) = processes.get(&targets[0]) {
                let birth = p.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let started = p
                    .get("started")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format_local_ctime(birth));
                row.insert("process_birth".into(), json!(birth));
                row.insert("process_started".into(), json!(started));
                let ck = target_key(row);
                row.insert("control_key".into(), json!(ck));
                let cont_pids: Vec<i64> = runs_clone
                    .iter()
                    .filter_map(|r| r.get("pid").and_then(|v| v.as_i64()))
                    .filter(|p| !targets.contains(p))
                    .collect();
                let mut cont_keys = Vec::new();
                for &cpid in &cont_pids {
                    if let Some(cp) = processes.get(&cpid) {
                        let mut tmp = row.clone();
                        let csid = registries
                            .get(&cpid.to_string())
                            .and_then(|v| v.as_object())
                            .and_then(|r| r.get("sessionId"))
                            .cloned()
                            .unwrap_or_else(|| row.get("id").cloned().unwrap_or(Value::Null));
                        let cb = cp.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        let cs = cp
                            .get("started")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .unwrap_or_else(|| format_local_ctime(cb));
                        tmp.insert("id".into(), csid);
                        tmp.insert("pids".into(), json!([cpid]));
                        tmp.insert("process_birth".into(), json!(cb));
                        tmp.insert("process_started".into(), json!(cs));
                        cont_keys.push(target_key(&tmp));
                    }
                }
                row.insert("continuation_processes".into(), json!(cont_pids));
                row.insert("continuation_keys".into(), json!(cont_keys));
                let ptty = primary
                    .and_then(|pr| pr.get("tty"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let verified = has_term && visible.len() == 1 && !matches!(ptty, "" | "?" | "??");
                row.insert("input_verified".into(), json!(verified));
            }
        }
        let rid = row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        for run in &runs_clone {
            if let Some(h) = run
                .get("terminal")
                .and_then(|t| t.get("handle"))
                .and_then(|v| v.as_str())
            {
                handle_owners
                    .entry(h.to_string())
                    .or_default()
                    .insert(rid.clone());
            }
        }
    }
    for row in &mut rows {
        if let Some(h) = row
            .get("orca_terminal")
            .and_then(|t| t.get("handle"))
            .and_then(|v| v.as_str())
        {
            if handle_owners.get(h).is_some_and(|s| s.len() > 1) {
                row.insert("input_verified".into(), json!(false));
            }
        }
    }

    // Apply seats (sessions/seats.py:apply)
    let openbot_agents = record
        .get("openbot_agents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for row in &mut rows {
        if row.get("chat").and_then(|v| v.as_bool()).unwrap_or(false) {
            let cwd = row.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(name) = openbot_seat(cwd, &openbot_agents) {
                row.insert("chat_name".into(), json!(name));
                row.insert("workspace_name".into(), json!(name));
                row.insert("project_name".into(), json!(name));
            }
        }
    }
    if let Some(orca_agents) = record.get("orca_agents").and_then(|v| v.as_array()) {
        let mut chats: HashMap<String, &Map<String, Value>> = HashMap::new();
        let mut panes: HashMap<String, &Map<String, Value>> = HashMap::new();
        for a in orca_agents {
            let Some(ao) = a.as_object() else {
                continue;
            };
            let Some(pk) = ao.get("paneKey").and_then(|v| v.as_str()) else {
                continue;
            };
            panes.insert(pk.to_string(), ao);
            if let Some(rest) = pk.strip_prefix("structured-agent-session-") {
                let sid = rest.split(':').next().unwrap_or("");
                if !sid.is_empty() {
                    chats.insert(sid.to_string(), ao);
                }
            }
        }
        for row in &mut rows {
            let mut found_agent: Option<&Map<String, Value>> = None;
            if let Some(runs) = row.get("runs").and_then(|v| v.as_array()) {
                for r in runs {
                    if r.get("role").and_then(|v| v.as_str()) == Some("chat") {
                        if let Some(pid) = r.get("pid").and_then(|v| v.as_i64()) {
                            if let Some(sid) = processes
                                .get(&pid)
                                .and_then(|p| p.get("env"))
                                .and_then(|e| e.get("ORCA_AGENT_SESSION_ID"))
                                .and_then(|v| v.as_str())
                            {
                                found_agent = chats.get(sid).copied();
                            }
                        }
                    } else if let Some(leaf) = r
                        .get("terminal")
                        .and_then(|t| t.get("leafId"))
                        .and_then(|v| v.as_str())
                    {
                        let tab = r
                            .get("terminal")
                            .and_then(|t| t.get("tabId"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        found_agent = panes.get(&format!("{tab}:{leaf}")).copied();
                    }
                    if found_agent.is_some() {
                        break;
                    }
                }
            }
            let Some(agent) = found_agent else {
                continue;
            };
            if row.get("chat").and_then(|v| v.as_bool()).unwrap_or(false) {
                if let Some(n) = agent
                    .get("name")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    row.insert("chat_name".into(), json!(n));
                }
            }
            let state = if agent
                .get("interrupted")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                Some("interrupted")
            } else {
                match agent.get("state").and_then(|v| v.as_str()).unwrap_or("") {
                    "working" => Some("busy"),
                    "done" | "idle" => Some("idle"),
                    "waiting" | "blocked" | "permission" => Some("waiting"),
                    _ => None,
                }
            };
            let verifiable = agent
                .get("verifiable")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let no_regs = row
                .get("_registries")
                .and_then(|v| v.as_array())
                .is_none_or(|a| a.is_empty());
            let no_events = row
                .get("_transcript")
                .and_then(|t| t.get("events"))
                .and_then(|v| v.as_array())
                .is_none_or(|a| a.is_empty());
            if let Some(st) = state {
                if verifiable && no_regs && no_events {
                    row.insert(
                        "_registries".into(),
                        json!([{
                            "status": st,
                            "statusUpdatedAt": agent.get("since").cloned().unwrap_or_else(|| json!(0)),
                            "source": "orca_agent"
                        }]),
                    );
                }
            }
        }
    }

    // Apply status to native rows
    let now = record
        .get("captured_at")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let apply_status = |slice: &mut [Map<String, Value>]| {
        for row in slice.iter_mut() {
            let regs = row
                .get("_registries")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let tr = row.get("_transcript").cloned();
            let connected = row
                .get("connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let (st, stamp, src) = decide_status(&regs, tr.as_ref(), now, connected);
            row.insert("status".into(), json!(st));
            row.insert("display_status".into(), json!(st));
            row.insert("status_at".into(), json!(stamp));
            row.insert("status_source".into(), json!(src));
            if let Some(runs) = row.get_mut("runs").and_then(|v| v.as_array_mut()) {
                for run_val in runs.iter_mut() {
                    if let Some(run) = run_val.as_object_mut() {
                        let rreg = run
                            .get("_registry")
                            .cloned()
                            .unwrap_or_else(|| Value::Object(Map::new()));
                        let rconn = run
                            .get("connected")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let (rst, rat, _) = decide_status(&[rreg], tr.as_ref(), now, rconn);
                        run.insert("status".into(), json!(rst));
                        run.insert("display_status".into(), json!(rst));
                        run.insert("status_at".into(), json!(rat));
                    }
                }
            }
        }
    };
    apply_status(&mut rows);

    // Adapters (Aside, OpenMausBot, Devin, Antigravity ACP)
    let mut adapters = build_aside_rows(
        record
            .get("aside_sessions")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]),
    );
    adapters.extend(build_openmausbot_rows(
        record
            .get("openmausbot_threads")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        record
            .get("openmausbot_running")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    ));
    let openbot_running = record
        .get("openbot_running")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    adapters.extend(build_devin_rows(
        record
            .get("devin_sessions")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        &openbot_agents,
        record
            .get("devin_running")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        openbot_running,
    ));
    let listed_ag: HashSet<String> = rows
        .iter()
        .filter(|r| r.get("kind").and_then(|v| v.as_str()) == Some("Antigravity"))
        .filter_map(|r| {
            r.get("conversation_id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .collect();
    for row in build_antigravity_rows(
        record
            .get("antigravity_conversations")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        &openbot_agents,
        openbot_running,
    ) {
        let cid = row
            .get("conversation_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !listed_ag.contains(cid) {
            adapters.push(row);
        }
    }

    let mut listed_codex: HashSet<String> = HashSet::new();
    let mut listed_claude: HashSet<String> = HashSet::new();
    let mut listed_paths: HashSet<String> = HashSet::new();
    let mut listed_ids: HashSet<String> = HashSet::new();
    for r in rows.iter().chain(adapters.iter()) {
        let k = r.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let cid = r
            .get("conversation_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let active_sid = r
            .get("active_session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !id.is_empty() {
            listed_ids.insert(id.to_string());
        }
        if k == "Codex" {
            for s in [id, cid] {
                if !s.is_empty() {
                    listed_codex.insert(s.to_string());
                }
            }
        } else if matches!(k, "Claude" | "GLM") {
            for s in [id, cid, active_sid] {
                if !s.is_empty() {
                    listed_claude.insert(s.to_string());
                }
            }
        }
        if let Some(p) = r
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            listed_paths.insert(canonical_path_key(p));
        }
        if let Some(sources) = r.get("continuation_sources").and_then(|v| v.as_array()) {
            for src in sources {
                if let Some(sp) = src
                    .get("path")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    listed_paths.insert(canonical_path_key(sp));
                }
                if let Some(ssid) = src
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    if k == "Codex" {
                        listed_codex.insert(ssid.to_string());
                    } else if matches!(k, "Claude" | "GLM") {
                        listed_claude.insert(ssid.to_string());
                    }
                }
            }
        }
    }
    for row in build_recent_codex_rows(
        record
            .get("recent_codex_sessions")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        &openbot_agents,
        openbot_running,
    ) {
        let sid = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let pkey = row
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(canonical_path_key);
        if sid.is_empty()
            || listed_codex.contains(sid)
            || listed_ids.contains(sid)
            || pkey.as_ref().is_some_and(|p| listed_paths.contains(p))
        {
            continue;
        }
        listed_codex.insert(sid.to_string());
        listed_ids.insert(sid.to_string());
        if let Some(p) = pkey {
            listed_paths.insert(p);
        }
        adapters.push(row);
    }
    for row in build_recent_claude_rows(
        record
            .get("recent_claude_sessions")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        &openbot_agents,
        openbot_running,
    ) {
        let sid = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let pkey = row
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(canonical_path_key);
        if sid.is_empty()
            || listed_claude.contains(sid)
            || listed_ids.contains(sid)
            || pkey.as_ref().is_some_and(|p| listed_paths.contains(p))
        {
            continue;
        }
        listed_claude.insert(sid.to_string());
        listed_ids.insert(sid.to_string());
        if let Some(p) = pkey {
            listed_paths.insert(p);
        }
        adapters.push(row);
    }
    apply_status(&mut adapters);
    rows.extend(adapters);

    // Hierarchy + Naming
    annotate_hierarchy(&mut rows);
    for row in &mut rows {
        let cwd = row
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .replace('\\', "/");
        let project = Path::new(&cwd)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let title = row
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let term_title = row
            .get("orca_terminal")
            .and_then(|t| t.get("title"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let chat_name = row
            .get("chat_name")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let name = [
            term_title.as_deref(),
            chat_name.as_deref(),
            Some(title.as_str()),
            Some(project.as_str()),
        ]
        .into_iter()
        .flatten()
        .find(|v| usable_name(Some(v)))
        .unwrap_or("")
        .to_string();

        row.insert(
            "display_name".into(),
            json!(if name.is_empty() { "새 대화" } else { &name }),
        );
        let mut detail: Vec<String> = Vec::new();
        let app = if row.get("terminal_match").and_then(|v| v.as_str()) == Some("chat") {
            row.get("location")
                .and_then(|l| l.get("app"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
        } else {
            ""
        };
        let mut redundant = HashSet::new();
        redundant.insert(name.clone());
        if !app.is_empty() {
            redundant.insert(app.to_string());
            redundant.insert(format!("{app} · {name}"));
        }
        if usable_name(Some(&title)) && !redundant.contains(&title) && !detail.contains(&title) {
            detail.push(title);
        }
        let has_ws_name = row
            .get("workspace_name")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty());
        if !has_ws_name && !project.is_empty() && !detail.contains(&project) {
            detail.push(project.clone());
        }
        let term_keys: HashSet<&str> = row
            .get("runs")
            .and_then(|v| v.as_array())
            .map(|runs| {
                runs.iter()
                    .filter_map(|r| r.get("terminal_key").and_then(|v| v.as_str()))
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if term_keys.len() > 1 {
            detail.push(format!("터미널 {}곳", term_keys.len()));
        }
        let tmatch = row
            .get("terminal_match")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if tmatch == "chat" {
            let note = row
                .get("terminal_note")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("Orca 채팅");
            detail.push(note.to_string());
        }
        if tmatch == "unavailable" && row.get("kind").and_then(|v| v.as_str()) != Some("Aside") {
            detail.push("터미널 연결 확인 안 됨".into());
        }
        if row
            .get("identity_conflict")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            detail.push("연결 확인 안 됨".into());
        }
        row.insert("display_detail".into(), json!(detail.join(" · ")));
        row.insert(
            "project".into(),
            json!(if project.is_empty() {
                "알 수 없음"
            } else {
                &project
            }),
        );
    }

    rows
}

/// Strip private `_`-prefixed keys matching `sessions/__init__.py:public`.
pub fn public_session(row: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (k, v) in row {
        if k.starts_with('_') {
            continue;
        }
        if k == "runs" {
            if let Some(arr) = v.as_array() {
                let cleaned: Vec<Value> = arr
                    .iter()
                    .map(|r| {
                        if let Some(ro) = r.as_object() {
                            let mut m = Map::new();
                            for (rk, rv) in ro {
                                if !rk.starts_with('_') {
                                    m.insert(rk.clone(), rv.clone());
                                }
                            }
                            Value::Object(m)
                        } else {
                            r.clone()
                        }
                    })
                    .collect();
                out.insert(k.clone(), Value::Array(cleaned));
                continue;
            }
        }
        out.insert(k.clone(), v.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pane_thread_and_status_decision() {
        assert_eq!(
            pane_thread_name("⠋ [.] Action Required | My Task | repo", "/tmp/repo").as_deref(),
            Some("My Task")
        );
        let regs = vec![json!({"status": "waiting", "statusUpdatedAt": 1700000100.0})];
        let (st, t, src) = decide_status(&regs, None, 1700000200.0, true);
        assert_eq!(st, "waiting");
        assert_eq!(t, 1700000100.0);
        assert_eq!(src, "registry");
    }

    #[test]
    fn recent_codex_and_claude_rows_appear_idle_and_deduplicate_active() {
        let birth = 1700000000.0;
        let proc_start = Utc
            .timestamp_opt(birth as i64, 0)
            .single()
            .unwrap()
            .format("%a %b %d %H:%M:%S %Y")
            .to_string();
        let record_val = json!({
            "captured_at": 1700000500.0,
            "openbot_running": true,
            "openbot_agents": [
                {"workspace": "/Users/alice/OpenBot/Agents/agent-img", "name": "Image Studio"},
                {"workspace": "/Users/alice/OpenBot/Agents/agent-bot", "name": "ChatBot"},
                {"workspace": "/Users/alice/OpenBot/Agents/agent-swe", "name": "Naming Agent"}
            ],
            "processes": [
                {
                    "pid": 100, "ppid": 1, "birth": 1.0, "tty": "", "cwd": "/",
                    "argv": ["OpenBot"], "name": "OpenBot", "env": {},
                    "app": ["OpenBot", "/Applications/OpenBot.app"]
                },
                {
                    "pid": 201, "ppid": 100, "birth": birth, "tty": "",
                    "cwd": "/work/live-codex", "config_dir": "/home/.codex",
                    "kind": "Codex", "name": "codex",
                    "argv": ["codex", "app-server"], "env": {}, "app": ["", ""]
                },
                {
                    "pid": 202, "ppid": 100, "birth": birth, "tty": "",
                    "cwd": "/work/live-claude", "config_dir": "/home/.claude",
                    "kind": "Claude", "name": "claude",
                    "argv": ["claude", "--output-format", "<arg>", "--input-format", "<arg>"],
                    "env": {}, "app": ["", ""]
                }
            ],
            "claude_registry": {
                "202": {
                    "pid": 202,
                    "procStart": proc_start,
                    "sessionId": "claude-live",
                    "cwd": "/work/live-claude",
                    "status": "busy",
                    "statusUpdatedAt": 1700000490.0
                }
            },
            "claude_transcripts": {
                "/home/.claude:claude-live": {
                    "path": "/home/.claude/projects/-work-live-claude/claude-live.jsonl",
                    "events": []
                }
            },
            "codex_logs": [
                {
                    "id": "codex-live",
                    "session_id": "codex-live",
                    "profile": "/home/.codex",
                    "path": "/home/.codex/sessions/2026/11/27/rollout-live.jsonl",
                    "cwd": "/work/live-codex",
                    "title": "Live Codex",
                    "holders": [201],
                    "events": []
                }
            ],
            "antigravity_conversations": [
                {
                    "id": "ag-1",
                    "title": "<openbot-developer-instructions> You are a persistent local OpenBot teammate",
                    "cwd": "/Users/alice/OpenBot/Agents/agent-swe",
                    "status": "CASCADE_RUN_STATUS_IDLE",
                    "modified": 1700000480.0,
                    "root": "/home/.gemini/antigravity-acp"
                }
            ],
            "recent_codex_sessions": [
                {
                    "id": "codex-live",
                    "session_id": "codex-live",
                    "profile": "/home/.codex",
                    "path": "/home/.codex/sessions/2026/11/27/rollout-live.jsonl",
                    "cwd": "/work/live-codex",
                    "title": "Duplicate Live Codex",
                    "modified": 1700000495.0
                },
                {
                    "id": "codex-img",
                    "session_id": "codex-img",
                    "profile": "/home/.codex",
                    "path": "/home/.codex/sessions/2026/11/27/rollout-img.jsonl",
                    "cwd": "/Users/alice/OpenBot/Agents/agent-img",
                    "title": "",
                    "modified": 1700000450.0
                },
                {
                    "id": "codex-local",
                    "session_id": "codex-local",
                    "profile": "/home/.codex",
                    "path": "/home/.codex/sessions/2026/11/27/rollout-local.jsonl",
                    "cwd": "/work/my-cli-repo",
                    "title": "Fix parser",
                    "modified": 1700000400.0
                }
            ],
            "recent_claude_sessions": [
                {
                    "id": "claude-live",
                    "session_id": "claude-live",
                    "profile": "/home/.claude",
                    "path": "/home/.claude/projects/-work-live-claude/claude-live.jsonl",
                    "cwd": "/work/live-claude",
                    "title": "Duplicate Live Claude",
                    "modified": 1700000490.0
                },
                {
                    "id": "claude-ob",
                    "session_id": "claude-ob",
                    "profile": "/home/Library/Application Support/OpenBot/provider-accounts/a2",
                    "path": "/home/Library/Application Support/OpenBot/provider-accounts/a2/projects/-bots/claude-ob.jsonl",
                    "cwd": "/Users/alice/OpenBot/Agents/agent-bot",
                    "title": "OpenBot",
                    "modified": 1700000440.0
                },
                {
                    "id": "claude-local",
                    "session_id": "claude-local",
                    "profile": "/home/.claude",
                    "path": "/home/.claude/projects/-work-repo/claude-local.jsonl",
                    "cwd": "/work/repo",
                    "title": "Refactor tests",
                    "modified": 1700000410.0
                }
            ],
            "orca_terminals": [],
            "tmux_panes": {},
            "aside_sessions": []
        });

        let rows = resolve_sessions(record_val.as_object().unwrap());
        let ids: Vec<&str> = rows
            .iter()
            .filter_map(|r| r.get("id").and_then(|v| v.as_str()))
            .collect();
        let unique_ids: HashSet<&str> = ids.iter().copied().collect();
        assert_eq!(
            ids.len(),
            unique_ids.len(),
            "no duplicate session ids: {ids:?}"
        );

        let find = |sid: &str| {
            rows.iter()
                .find(|r| r.get("id").and_then(|v| v.as_str()) == Some(sid))
                .unwrap_or_else(|| panic!("missing session {sid} in {ids:?}"))
        };

        let img = find("codex-img");
        assert_eq!(img.get("kind").and_then(|v| v.as_str()), Some("Codex"));
        assert_eq!(img.get("status").and_then(|v| v.as_str()), Some("idle"));
        assert_eq!(
            img.get("display_name").and_then(|v| v.as_str()),
            Some("Image Studio")
        );
        assert_eq!(
            img.get("display_detail").and_then(|v| v.as_str()),
            Some("OpenBot 채팅")
        );
        assert_eq!(
            img.get("path").and_then(|v| v.as_str()),
            Some("/home/.codex/sessions/2026/11/27/rollout-img.jsonl")
        );

        let cx_local = find("codex-local");
        assert_eq!(
            cx_local.get("status").and_then(|v| v.as_str()),
            Some("idle")
        );
        assert_eq!(
            cx_local.get("terminal_note").and_then(|v| v.as_str()),
            Some("최근 Codex 세션")
        );

        let cl_ob = find("claude-ob");
        assert_eq!(cl_ob.get("kind").and_then(|v| v.as_str()), Some("Claude"));
        assert_eq!(cl_ob.get("status").and_then(|v| v.as_str()), Some("idle"));
        assert_eq!(
            cl_ob.get("display_name").and_then(|v| v.as_str()),
            Some("ChatBot")
        );
        assert_eq!(
            cl_ob.get("display_detail").and_then(|v| v.as_str()),
            Some("OpenBot 채팅")
        );

        let cl_local = find("claude-local");
        assert_eq!(
            cl_local.get("status").and_then(|v| v.as_str()),
            Some("idle")
        );
        assert_eq!(
            cl_local.get("terminal_note").and_then(|v| v.as_str()),
            Some("최근 Claude 세션")
        );

        let ag = find("ag-1");
        assert_eq!(
            ag.get("display_detail").and_then(|v| v.as_str()),
            Some("OpenBot 채팅")
        );
    }
}
