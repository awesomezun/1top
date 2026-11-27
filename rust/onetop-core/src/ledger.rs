use crate::context_usage::request_context;
use crate::effort::{backfill_codex, codex_level};
use crate::text::epoch_from_value;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::OnceLock;

pub const ZERO: [i64; 4] = [0, 0, 0, 0];

fn codex_id_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$").expect("valid regex"))
}

fn codex_ident(val: Option<&Value>) -> Option<String> {
    let s = val?.as_str()?;
    if codex_id_regex().is_match(s) {
        Some(s.to_string())
    } else {
        None
    }
}

/// Exact port of `hierarchy.py:codex_metadata`.
pub fn codex_metadata(path: &Path, expected_id: Option<&str>) -> Map<String, Value> {
    let mut out = Map::new();
    let Ok(file) = File::open(path) else {
        return out;
    };
    let mut reader = BufReader::new(file);
    let mut buf = Vec::new();
    let mut limited = reader.by_ref().take(2 * 1024 * 1024);
    if limited.read_until(b'\n', &mut buf).is_err() || !buf.ends_with(b"\n") {
        return out;
    }
    let Ok(row) = serde_json::from_slice::<Value>(&buf) else {
        return out;
    };
    if row.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
        return out;
    }
    let Some(payload) = row.get("payload").and_then(|v| v.as_object()) else {
        return out;
    };
    if let Some(exp) = expected_id {
        if payload.get("id").and_then(|v| v.as_str()) != Some(exp) {
            return out;
        }
    }
    let subagent = payload
        .get("source")
        .and_then(|v| v.as_object())
        .and_then(|s| s.get("subagent"))
        .and_then(|v| v.as_object());
    let Some(subagent) = subagent else {
        out.insert("is_subagent".into(), Value::Bool(false));
        return out;
    };
    out.insert("is_subagent".into(), Value::Bool(true));
    let Some(spawn) = subagent.get("thread_spawn").and_then(|v| v.as_object()) else {
        return out;
    };
    let mut parent = codex_ident(
        spawn
            .get("parent_thread_id")
            .or_else(|| payload.get("parent_thread_id")),
    );
    let explicit = codex_ident(payload.get("parent_thread_id"));
    if explicit.is_some() && parent != explicit {
        parent = None;
    }
    let depth = spawn
        .get("depth")
        .and_then(|v| v.as_i64())
        .filter(|&d| d > 0);
    let agent_path = spawn
        .get("agent_path")
        .and_then(|v| v.as_str())
        .map(|s| s.chars().take(200).collect::<String>());
    out.insert(
        "parent_session_id".into(),
        parent.map(Value::String).unwrap_or(Value::Null),
    );
    out.insert(
        "agent_depth".into(),
        depth.map(|d| json!(d)).unwrap_or(Value::Null),
    );
    out.insert(
        "agent_path".into(),
        agent_path.map(Value::String).unwrap_or(Value::Null),
    );
    out
}

/// Exact port of `server.py:vector`.
pub fn token_vector(usage: &Map<String, Value>, codex: bool) -> [i64; 4] {
    let n = |key: &str| -> i64 {
        match usage.get(key) {
            Some(Value::Number(num)) => {
                if let Some(i) = num.as_i64() {
                    i.max(0)
                } else if let Some(f) = num.as_f64() {
                    if f.is_finite() {
                        (f as i64).max(0)
                    } else {
                        0
                    }
                } else {
                    0
                }
            }
            Some(Value::String(s)) => s.parse::<i64>().unwrap_or(0).max(0),
            _ => 0,
        }
    };
    if codex {
        let cached = n("cached_input_tokens");
        [
            (n("input_tokens") - cached).max(0),
            cached,
            n("cache_write_input_tokens"),
            n("output_tokens"),
        ]
    } else {
        [
            n("input_tokens"),
            n("cache_read_input_tokens"),
            n("cache_creation_input_tokens"),
            n("output_tokens"),
        ]
    }
}

/// Exact port of `server.py:first_codex_report`.
pub fn first_codex_report(info: &Map<String, Value>, total: [i64; 4]) -> bool {
    let Some(last) = info.get("last_token_usage").and_then(|v| v.as_object()) else {
        return false;
    };
    total.iter().sum::<i64>() > 0 && token_vector(last, true) == total
}

fn vec_from_json(val: Option<&Value>) -> [i64; 4] {
    let Some(arr) = val.and_then(|v| v.as_array()) else {
        return ZERO;
    };
    if arr.len() < 4 {
        return ZERO;
    }
    [
        arr[0].as_i64().unwrap_or(0),
        arr[1].as_i64().unwrap_or(0),
        arr[2].as_i64().unwrap_or(0),
        arr[3].as_i64().unwrap_or(0),
    ]
}

fn vec_to_json(v: [i64; 4]) -> Value {
    json!([v[0], v[1], v[2], v[3]])
}

/// Exact port of `server.py:Ledger`.
#[derive(Debug, Clone)]
pub struct Ledger {
    pub state: Map<String, Value>,
}

impl Ledger {
    pub fn new(kind: &str, state: Option<Map<String, Value>>) -> Self {
        if let Some(s) = state {
            return Self { state: s };
        }
        let mut s = Map::new();
        s.insert("kind".into(), json!(kind));
        s.insert("offset".into(), json!(0));
        s.insert("inode".into(), Value::Null);
        s.insert("total".into(), vec_to_json(ZERO));
        s.insert("seen".into(), Value::Object(Map::new()));
        s.insert("models".into(), Value::Array(Vec::new()));
        s.insert("last_usage".into(), json!(0));
        s.insert("model".into(), json!(""));
        s.insert("status".into(), json!("unknown"));
        s.insert("status_at".into(), json!(0));
        s.insert("known".into(), json!(false));
        s.insert("effort_schema".into(), json!(1));
        Self { state: s }
    }

    pub fn consume(&mut self, record: &Value) -> Option<(f64, [i64; 4])> {
        let d = record.as_object()?;
        let t = epoch_from_value(d.get("timestamp"));
        let p = d.get("payload").and_then(|v| v.as_object());
        if let Some(cwd) = d
            .get("cwd")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            self.state.insert("cwd".into(), json!(cwd));
        }
        let d_type = d.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if matches!(d_type, "session_meta" | "turn_context") {
            if let Some(cwd) = p
                .and_then(|m| m.get("cwd"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                self.state.insert("cwd".into(), json!(cwd));
            }
        }
        let kind = self
            .state
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if kind == "Codex" {
            let p_obj = p?;
            if d_type == "turn_context" {
                let cur_model = self
                    .state
                    .get("model")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(m) = p_obj
                    .get("model")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    if m != cur_model {
                        self.state.insert("context_usage".into(), Value::Null);
                        self.state.insert("request_input".into(), Value::Null);
                        self.state.insert("context_size".into(), Value::Null);
                    }
                    self.state.insert("model".into(), json!(m));
                }
                self.state.insert("model_at".into(), json!(t));
                self.state.insert("effort_schema".into(), json!(1));
                let eff = codex_level(p_obj);
                self.state.insert(
                    "effort".into(),
                    eff.as_ref().map(|e| json!(e)).unwrap_or(Value::Null),
                );
                self.state.insert(
                    "effort_updated".into(),
                    if eff.is_some() { json!(t) } else { Value::Null },
                );
                return None;
            }
            if d_type == "event_msg" {
                let typ = p_obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let status = match typ {
                    "task_started" => Some("working"),
                    "task_complete" | "turn_complete" => Some("idle"),
                    "turn_aborted" => Some("interrupted"),
                    _ => None,
                };
                if let Some(st) = status {
                    self.state.insert("status".into(), json!(st));
                    self.state.insert("status_at".into(), json!(t));
                }
                if typ == "token_count" {
                    if let Some(rl) = p_obj.get("rate_limits").filter(|v| !v.is_null()) {
                        self.state.insert("quota".into(), json!({"t": t, "rl": rl}));
                    }
                    let info = p_obj.get("info").and_then(|v| v.as_object());
                    let context_at = self
                        .state
                        .get("context_at")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                    if t >= context_at {
                        if let Some(info_m) = info {
                            let cur_model = self
                                .state
                                .get("model")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let cap = info_m.get("model_context_window").and_then(|v| v.as_f64());
                            if let Some(last_u) =
                                info_m.get("last_token_usage").and_then(|v| v.as_object())
                            {
                                if let Some(ctx) =
                                    request_context(last_u, Some(t), cur_model, cap, true)
                                {
                                    if let Ok(ctx_val) = serde_json::to_value(ctx) {
                                        self.state.insert("context_usage".into(), ctx_val);
                                        self.state.insert("context_at".into(), json!(t));
                                    }
                                }
                            }
                        }
                    }
                    let u = info
                        .and_then(|m| m.get("total_token_usage"))
                        .and_then(|v| v.as_object())?;
                    let v = token_vector(u, true);
                    let old = vec_from_json(self.state.get("total"));
                    let was_known = self
                        .state
                        .get("known")
                        .and_then(|b| b.as_bool())
                        .unwrap_or(false);
                    let reset = was_known && (0..4).any(|i| v[i] < old[i]);
                    let first = !was_known && info.is_some_and(|m| first_codex_report(m, v));
                    let delta = if was_known && !reset {
                        [
                            (v[0] - old[0]).max(0),
                            (v[1] - old[1]).max(0),
                            (v[2] - old[2]).max(0),
                            (v[3] - old[3]).max(0),
                        ]
                    } else if first {
                        v
                    } else {
                        ZERO
                    };
                    if reset {
                        self.state.insert("counter_reset".into(), json!(true));
                    }
                    self.state.insert("total".into(), vec_to_json(v));
                    self.state.insert("known".into(), json!(true));
                    if let Some(info_m) = info {
                        let req_in = info_m
                            .get("last_token_usage")
                            .and_then(|v| v.as_object())
                            .and_then(|m| m.get("input_tokens"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        self.state.insert("request_input".into(), req_in);
                        self.state.insert(
                            "context_size".into(),
                            info_m
                                .get("model_context_window")
                                .cloned()
                                .unwrap_or(Value::Null),
                        );
                    }
                    let sum_delta: i64 = delta.iter().sum();
                    if sum_delta > 0 || !was_known {
                        self.state.insert("last_usage".into(), json!(t));
                    }
                    return if sum_delta > 0 {
                        Some((t, delta))
                    } else {
                        None
                    };
                }
            }
            return None;
        }

        // Normalize Aside into Claude-like message shape
        let normalized_holder: Value;
        let active_d: &Map<String, Value> = if kind == "Aside" {
            if d.get("role").and_then(|v| v.as_str()) != Some("assistant") {
                return None;
            }
            let usage = d.get("usage").and_then(|v| v.as_object())?;
            let mid = d
                .get("responseId")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())?;
            normalized_holder = json!({
                "type": "assistant",
                "message": {
                    "id": mid,
                    "model": d.get("model").and_then(|v| v.as_str()).unwrap_or(""),
                    "usage": {
                        "input_tokens": usage.get("input").cloned().unwrap_or(Value::Null),
                        "output_tokens": usage.get("output").cloned().unwrap_or(Value::Null),
                        "cache_read_input_tokens": usage.get("cacheRead").cloned().unwrap_or(Value::Null),
                        "cache_creation_input_tokens": usage.get("cacheWrite").cloned().unwrap_or(Value::Null),
                    }
                }
            });
            normalized_holder.as_object()?
        } else {
            d
        };

        if active_d.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            return None;
        }
        let msg = active_d.get("message").and_then(|v| v.as_object())?;
        let model = msg.get("model").and_then(|v| v.as_str()).unwrap_or("");
        if model == "<synthetic>" {
            return None;
        }
        let usage = msg.get("usage").and_then(|v| v.as_object())?;
        let mid = msg
            .get("id")
            .or_else(|| active_d.get("uuid"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())?
            .to_string();

        let v = token_vector(usage, false);
        let old = self
            .state
            .get("seen")
            .and_then(|v| v.as_object())
            .and_then(|m| m.get(&mid))
            .map(|val| vec_from_json(Some(val)))
            .unwrap_or(ZERO);
        let new = [
            v[0].max(old[0]),
            v[1].max(old[1]),
            v[2].max(old[2]),
            v[3].max(old[3]),
        ];
        let delta = [
            new[0] - old[0],
            new[1] - old[1],
            new[2] - old[2],
            new[3] - old[3],
        ];
        if !self.state.get("seen").is_some_and(|v| v.is_object()) {
            self.state.insert("seen".into(), Value::Object(Map::new()));
        }
        if let Some(seen) = self.state.get_mut("seen").and_then(|v| v.as_object_mut()) {
            seen.insert(mid.clone(), vec_to_json(new));
        }
        let cur_total = vec_from_json(self.state.get("total"));
        let next_total = [
            cur_total[0] + delta[0],
            cur_total[1] + delta[1],
            cur_total[2] + delta[2],
            cur_total[3] + delta[3],
        ];
        self.state.insert("total".into(), vec_to_json(next_total));
        self.state.insert("known".into(), json!(true));

        let context_at = self
            .state
            .get("context_at")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if t >= context_at {
            let mut u_copy = usage.clone();
            if self.state.get("context_mid").and_then(|v| v.as_str()) == Some(mid.as_str()) {
                u_copy.insert("input_tokens".into(), json!(new[0]));
                u_copy.insert("cache_read_input_tokens".into(), json!(new[1]));
                u_copy.insert("cache_creation_input_tokens".into(), json!(new[2]));
            }
            let cap = active_d
                .get("context_window")
                .and_then(|v| v.as_object())
                .and_then(|m| m.get("context_window_size"))
                .and_then(|v| v.as_f64());
            if let Some(ctx) = request_context(&u_copy, Some(t), model, cap, false) {
                if let Ok(ctx_val) = serde_json::to_value(ctx) {
                    self.state.insert("context_usage".into(), ctx_val);
                    self.state.insert("context_at".into(), json!(t));
                    self.state.insert("context_mid".into(), json!(mid));
                }
            }
        }

        let model_at = self
            .state
            .get("model_at")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if !model.is_empty() && t >= model_at {
            self.state.insert("model".into(), json!(model));
            self.state.insert("model_at".into(), json!(t));
        }
        if !model.is_empty() {
            if !self.state.get("models").is_some_and(|v| v.is_array()) {
                self.state.insert("models".into(), Value::Array(Vec::new()));
            }
            if let Some(models) = self.state.get_mut("models").and_then(|v| v.as_array_mut()) {
                if !models.iter().any(|m| m.as_str() == Some(model)) {
                    models.push(json!(model));
                }
            }
        }
        let sum_delta: i64 = delta.iter().sum();
        if sum_delta > 0 {
            let prev_last = self
                .state
                .get("last_usage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            self.state
                .insert("last_usage".into(), json!(prev_last.max(t)));
            self.state
                .insert("request_input".into(), json!(v[0] + v[1] + v[2]));
            Some((t, delta))
        } else {
            None
        }
    }
}

#[derive(Debug, Clone)]
pub struct LedgerEvent {
    pub t: f64,
    pub tokens: [i64; 4],
    pub model: Option<String>,
    pub cwd: Option<String>,
}

fn byte_contains(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn is_interesting_line(line: &[u8]) -> bool {
    byte_contains(line, b"\"usage\"")
        || byte_contains(line, b"\"token_count\"")
        || byte_contains(line, b"\"turn_context\"")
        || byte_contains(line, b"\"event_msg\"")
        || byte_contains(line, b"\"session_meta\"")
}

#[cfg(unix)]
fn file_inode(meta: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn file_inode(_meta: &std::fs::Metadata) -> u64 {
    0
}

/// Incremental JSONL scan matching `server.py:Collector.read_tracker`.
/// Returns `(events_emitted, new_offset, file_size, dirty)`.
pub fn scan_jsonl_tracker(
    tracker: &mut Ledger,
    path: &Path,
    kind: &str,
    started: f64,
    spec_cwd: Option<&str>,
) -> std::io::Result<(Vec<LedgerEvent>, u64, u64, bool)> {
    let meta = std::fs::metadata(path)?;
    let size = meta.len();
    let ino = file_inode(&meta);

    let prev_ino = tracker.state.get("inode").and_then(|v| v.as_u64());
    let prev_offset = tracker
        .state
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if (prev_ino.is_some() && prev_ino != Some(ino)) || size < prev_offset {
        *tracker = Ledger::new(kind, None);
    }
    tracker.state.insert("inode".into(), json!(ino));

    let effort_migrated = if kind == "Codex" {
        backfill_codex(&mut tracker.state, path)
    } else {
        false
    };

    let mut offset = tracker
        .state
        .get("offset")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if offset == 0 && kind == "Codex" && size > 16 * 1024 * 1024 {
        let mut f = BufReader::new(File::open(path)?);
        f.seek(SeekFrom::Start(size - 16 * 1024 * 1024))?;
        let mut discard = Vec::new();
        let _ = f.read_until(b'\n', &mut discard);
        offset = f.stream_position()?;
        tracker.state.insert("offset".into(), json!(offset));
    }

    let start = offset;
    let mut events = Vec::new();
    if start < size {
        let mut reader = BufReader::with_capacity(65536, File::open(path)?);
        reader.seek(SeekFrom::Start(start))?;
        let mut line = Vec::with_capacity(4096);
        let mut pos = start;
        while pos - start < 24 * 1024 * 1024 {
            line.clear();
            let n = reader.read_until(b'\n', &mut line)?;
            if n == 0 || !line.ends_with(b"\n") {
                break;
            }
            pos += n as u64;
            if is_interesting_line(&line) {
                if let Ok(record) = serde_json::from_slice::<Value>(&line) {
                    if let Some((t, v)) = tracker.consume(&record) {
                        if t >= started {
                            let msg_model = if matches!(kind, "Claude" | "GLM") {
                                record
                                    .get("message")
                                    .and_then(|m| m.get("model"))
                                    .and_then(|v| v.as_str())
                                    .filter(|s| !s.is_empty())
                            } else {
                                None
                            };
                            let state_model = tracker
                                .state
                                .get("model")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty());
                            let event_model = msg_model.or(state_model).map(str::to_string);
                            let cwd = tracker
                                .state
                                .get("cwd")
                                .and_then(|v| v.as_str())
                                .filter(|s| !s.is_empty())
                                .or(spec_cwd)
                                .map(str::to_string);
                            events.push(LedgerEvent {
                                t,
                                tokens: v,
                                model: event_model,
                                cwd,
                            });
                        }
                    }
                }
            }
        }
        offset = pos;
        tracker.state.insert("offset".into(), json!(offset));
    }
    let dirty = start < size || effort_migrated;
    Ok((events, offset, size, dirty))
}

/// Deduplicate string values preserving order.
pub fn dedup_strings(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|s| seen.insert(s.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_stream_dedup_and_codex_delta() {
        let mut claude = Ledger::new("Claude", None);
        let r1 = json!({
            "type": "assistant",
            "timestamp": "2026-11-25T10:00:00Z",
            "message": {
                "id": "m1",
                "model": "claude-opus-5-5",
                "usage": {"input_tokens": 100, "cache_read_input_tokens": 50, "cache_creation_input_tokens": 10, "output_tokens": 5}
            }
        });
        let r2 = json!({
            "type": "assistant",
            "timestamp": "2026-11-25T10:00:02Z",
            "message": {
                "id": "m1",
                "model": "claude-opus-5-5",
                "usage": {"input_tokens": 100, "cache_read_input_tokens": 50, "cache_creation_input_tokens": 10, "output_tokens": 25}
            }
        });
        assert_eq!(claude.consume(&r1).unwrap().1, [100, 50, 10, 5]);
        assert_eq!(claude.consume(&r2).unwrap().1, [0, 0, 0, 20]);
        assert_eq!(vec_from_json(claude.state.get("total")), [100, 50, 10, 25]);

        let mut codex = Ledger::new("Codex", None);
        let c1 = json!({
            "type": "event_msg",
            "timestamp": 1700000000.0,
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 10},
                    "last_token_usage": {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 10}
                }
            }
        });
        assert_eq!(codex.consume(&c1).unwrap().1, [60, 40, 0, 10]);
    }
}
