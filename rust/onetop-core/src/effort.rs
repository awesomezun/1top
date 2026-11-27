use crate::platform_support::data_directory;
use crate::text::parse_devin_stamp_str;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const TAIL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_STATUSLINE_BYTES: usize = 16 * 1024;

/// Exact port of `effort.py:level` (`^[A-Za-z0-9][A-Za-z0-9_.+\-]{0,63}$`).
pub fn level(value: Option<&Value>) -> Option<String> {
    let s = value?.as_str()?;
    let bytes = s.as_bytes();
    if bytes.is_empty() || bytes.len() > 64 {
        return None;
    }
    if !bytes[0].is_ascii_alphanumeric() {
        return None;
    }
    if bytes[1..]
        .iter()
        .all(|&b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'+' | b'-'))
    {
        Some(s.to_string())
    } else {
        None
    }
}

/// Exact port of `effort.py:codex_level`.
pub fn codex_level(payload: &Map<String, Value>) -> Option<String> {
    for key in ["effort", "reasoning_effort", "model_reasoning_effort"] {
        if let Some(v) = payload.get(key) {
            return level(Some(v));
        }
    }
    None
}

fn parse_time(val: Option<&Value>) -> f64 {
    match val {
        Some(Value::Number(n)) => n.as_f64().filter(|f| f.is_finite()).unwrap_or(0.0),
        Some(Value::String(s)) => parse_devin_stamp_str(s),
        _ => 0.0,
    }
}

/// Exact port of `effort.py:backfill_codex`.
pub fn backfill_codex(state: &mut Map<String, Value>, path: &Path) -> bool {
    if state.get("effort_schema").and_then(|v| v.as_i64()) == Some(1) {
        return false;
    }
    state.insert("effort_schema".into(), Value::Number(1.into()));
    state.remove("effort");
    state.remove("effort_updated");

    let Ok(mut file) = File::open(path) else {
        return true;
    };
    let Ok(len) = file.seek(SeekFrom::End(0)) else {
        return true;
    };
    let start = len.saturating_sub(TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return true;
    }
    let mut raw = Vec::new();
    if file.take(TAIL_BYTES).read_to_end(&mut raw).is_err() {
        return true;
    }

    let mut lines: Vec<&[u8]> = raw.split_inclusive(|&b| b == b'\n').collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    for line in lines.into_iter().rev() {
        if !line.ends_with(b"\n") {
            continue;
        }
        if !line
            .windows(b"\"turn_context\"".len())
            .any(|w| w == b"\"turn_context\"")
        {
            continue;
        }
        let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        if row.get("type").and_then(|v| v.as_str()) != Some("turn_context") {
            continue;
        }
        let Some(Value::Object(payload)) = row.get("payload") else {
            continue;
        };
        if payload.get("model") != state.get("model") {
            break;
        }
        if let Some(val) = codex_level(payload) {
            state.insert("effort".into(), Value::String(val));
            let ts = parse_time(row.get("timestamp"));
            if let Some(num) = serde_json::Number::from_f64(ts) {
                state.insert("effort_updated".into(), Value::Number(num));
            }
        }
        break;
    }
    true
}

/// Exact port of `effort.py:apply_statusline`.
pub fn apply_statusline(spec: &mut Map<String, Value>, now: f64, directory: Option<&Path>) {
    for key in ["effort", "effort_source", "effort_updated"] {
        spec.remove(key);
    }
    let Some(profile) = spec
        .get("config_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    else {
        return;
    };
    let Some(session) = spec
        .get("active_session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            spec.get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
    else {
        return;
    };

    let Ok(root) = fs::canonicalize(profile) else {
        return;
    };
    let root_str = root.to_string_lossy();
    let mut hasher = Sha256::new();
    hasher.update(root_str.as_bytes());
    hasher.update(b"|");
    hasher.update(session.as_bytes());
    let key = hex::encode(hasher.finalize());

    let folder = match directory {
        Some(d) => d.to_path_buf(),
        None => data_directory(None).join("claude-statusline-sessions"),
    };
    let path = folder.join(format!("{key}.json"));
    if fs::symlink_metadata(&folder).is_ok_and(|m| m.file_type().is_symlink())
        || fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink())
    {
        return;
    }

    let Ok(file) = File::open(&path) else {
        return;
    };
    let mut raw = Vec::new();
    if file
        .take((MAX_STATUSLINE_BYTES + 1) as u64)
        .read_to_end(&mut raw)
        .is_err()
        || raw.len() > MAX_STATUSLINE_BYTES
    {
        return;
    }
    let Ok(Value::Object(report)) = serde_json::from_slice::<Value>(&raw) else {
        return;
    };
    if report.get("schema").and_then(|v| v.as_i64()) != Some(1) {
        return;
    }
    if report.get("profile").and_then(|v| v.as_str()) != Some(root_str.as_ref())
        || report.get("session_id").and_then(|v| v.as_str()) != Some(session)
    {
        return;
    }
    let Some(updated) = report
        .get("updated")
        .and_then(|v| v.as_f64())
        .filter(|u| u.is_finite() && *u > 0.0 && *u <= now + 5.0)
    else {
        return;
    };
    let floor = spec
        .get("process_birth")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        .max(
            spec.get("model_updated")
                .or_else(|| spec.get("last_usage"))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
        );
    if updated < floor {
        return;
    }
    if let Some(model_val) = report.get("model") {
        if !model_val.is_null() {
            let Some(m) = model_val.as_str() else {
                return;
            };
            if m.is_empty() || m.len() > 256 || m.chars().any(|c| (c as u32) < 32) {
                return;
            }
            spec.insert("model".into(), Value::String(m.to_string()));
            if let Some(num) = serde_json::Number::from_f64(updated) {
                spec.insert("model_updated".into(), Value::Number(num));
            }
        }
    }
    if let Some(val) = level(report.get("effort")) {
        spec.insert("effort".into(), Value::String(val));
        spec.insert(
            "effort_source".into(),
            Value::String("claude_statusline".into()),
        );
        if let Some(num) = serde_json::Number::from_f64(updated) {
            spec.insert("effort_updated".into(), Value::Number(num));
        }
    }
}
