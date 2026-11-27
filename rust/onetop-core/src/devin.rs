use crate::readonly::open_readonly;
use crate::text::{clean_title, parse_devin_stamp_num, parse_devin_stamp_str, truncate_chars};
use rusqlite::types::ValueRef;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const OPEN_TURN: f64 = 300.0;

pub fn database(home: &Path) -> std::path::PathBuf {
    home.join(".local/share/devin/cli/sessions.db")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DevinSessionRow {
    pub id: String,
    pub cwd: String,
    pub model: String,
    pub title: String,
    pub created: f64,
    pub updated: f64,
    pub status: String,
    pub status_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DevinUsageRow {
    pub session: String,
    pub id: String,
    pub t: f64,
    pub model: String,
    pub tokens: [i64; 4],
    pub session_model: String,
    pub cwd: String,
    pub title: String,
}

/// Exact equivalent of `^[A-Za-z0-9_.:-]{1,120}$` without regex overhead.
#[inline]
fn is_valid_id(s: &str) -> bool {
    let len = s.len();
    (1..=120).contains(&len)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
}

#[derive(Deserialize)]
#[serde(untagged)]
enum FlexCount {
    Int(i64),
    Float(f64),
    Bool(bool),
    Str(String),
    Other(serde::de::IgnoredAny),
}

impl FlexCount {
    #[inline]
    fn as_count(&self) -> i64 {
        match self {
            FlexCount::Int(n) => (*n).max(0),
            FlexCount::Float(f) => (*f as i64).max(0),
            FlexCount::Bool(b) => i64::from(*b),
            FlexCount::Str(s) => s.trim().parse::<i64>().unwrap_or(0).max(0),
            FlexCount::Other(_) => 0,
        }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum FlexStr {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
    Other(serde::de::IgnoredAny),
}

impl FlexStr {
    fn into_nonempty(self) -> Option<String> {
        match self {
            FlexStr::Str(s) if !s.is_empty() => Some(s),
            FlexStr::Int(n) => Some(n.to_string()),
            FlexStr::Float(f) => Some(f.to_string()),
            FlexStr::Bool(b) => Some(if b { "True" } else { "False" }.to_string()),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
struct MinimalMetrics {
    input_tokens: Option<FlexCount>,
    cache_read_tokens: Option<FlexCount>,
    cache_creation_tokens: Option<FlexCount>,
    output_tokens: Option<FlexCount>,
}

#[derive(Deserialize)]
struct MinimalMetadata {
    request_id: Option<FlexStr>,
    generation_model: Option<FlexStr>,
    metrics: Option<MinimalMetrics>,
}

/// Zero-DOM minimal view of `chat_message`: unknown fields (`content`, `tool_calls`, etc.)
/// are skipped by `serde_json` without allocating strings or AST nodes.
#[derive(Deserialize)]
struct MinimalChatMessage {
    role: Option<String>,
    message_id: Option<FlexStr>,
    metadata: Option<MinimalMetadata>,
}

pub fn stamp_value(val: &ValueRef<'_>) -> f64 {
    match val {
        ValueRef::Integer(n) => parse_devin_stamp_num(*n as f64),
        ValueRef::Real(f) => parse_devin_stamp_num(*f),
        ValueRef::Text(bytes) => std::str::from_utf8(bytes)
            .map(parse_devin_stamp_str)
            .unwrap_or(0.0),
        ValueRef::Null | ValueRef::Blob(_) => 0.0,
    }
}

pub fn state_from_last(role: &str, finish: &str, at: f64, now: f64) -> &'static str {
    if role == "assistant" && finish != "tool_calls" && finish != "tool_use" {
        return "idle";
    }
    let delta = now - at;
    if (0.0..OPEN_TURN).contains(&delta) {
        "busy"
    } else {
        "idle"
    }
}

fn value_as_opt_string(val: ValueRef<'_>) -> Option<String> {
    match val {
        ValueRef::Null => None,
        ValueRef::Text(b) => Some(String::from_utf8_lossy(b).into_owned()),
        ValueRef::Integer(n) => Some(n.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Blob(_) => None,
    }
}

/// Exact port of `observe/devin.py:sessions`.
pub fn read_sessions(path: &Path, now: f64, window: f64) -> Vec<DevinSessionRow> {
    if !path.is_file() {
        return Vec::new();
    }
    let Ok(db) = open_readonly(path, 1.0) else {
        return Vec::new();
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT id, working_directory, model, title, created_at, last_activity_at \
         FROM sessions WHERE hidden=0 AND last_activity_at>? \
         ORDER BY last_activity_at DESC LIMIT 200",
    ) else {
        return Vec::new();
    };
    let Ok(mut last_stmt) = db.prepare(
        "SELECT json_extract(chat_message,'$.role') AS role, \
                json_extract(chat_message,'$.metadata.finish_reason'), \
                created_at \
         FROM message_nodes \
         WHERE session_id=? AND role IS NOT 'system' \
         ORDER BY row_id DESC LIMIT 1",
    ) else {
        return Vec::new();
    };

    let Ok(mut rows) = stmt.query([now - window]) else {
        return Vec::new();
    };
    let mut found = Vec::new();

    while let Ok(Some(row)) = rows.next() {
        let Some(sid) = row.get_ref(0).ok().and_then(value_as_opt_string) else {
            continue;
        };
        if !is_valid_id(&sid) {
            continue;
        }
        let cwd = row
            .get_ref(1)
            .ok()
            .and_then(value_as_opt_string)
            .unwrap_or_default();
        let model = row
            .get_ref(2)
            .ok()
            .and_then(value_as_opt_string)
            .unwrap_or_default();
        let title = row
            .get_ref(3)
            .ok()
            .and_then(value_as_opt_string)
            .unwrap_or_default();
        let created = row.get_ref(4).map(|v| stamp_value(&v)).unwrap_or(0.0);
        let updated = row.get_ref(5).map(|v| stamp_value(&v)).unwrap_or(0.0);

        let (role, finish, at) = last_stmt
            .query_row([&sid], |lr| {
                let r = lr
                    .get_ref(0)
                    .ok()
                    .and_then(value_as_opt_string)
                    .unwrap_or_default();
                let f = lr
                    .get_ref(1)
                    .ok()
                    .and_then(value_as_opt_string)
                    .unwrap_or_default();
                let a = lr.get_ref(2).map(|v| stamp_value(&v)).unwrap_or(0.0);
                Ok((r, f, a))
            })
            .unwrap_or_else(|_| (String::new(), String::new(), updated));

        found.push(DevinSessionRow {
            id: sid,
            cwd,
            model: truncate_chars(&model, 160),
            title: clean_title(&title, 200),
            created,
            updated,
            status: state_from_last(&role, &finish, at, now).to_string(),
            status_at: at,
        });
    }
    found
}

/// Exact port of `observe/devin.py:usage`.
/// Uses a pure primary-key scan in SQLite (zero repeated `json_extract` calls) and
/// borrows `chat_message` zero-copy (`ValueRef::Text`) into a streaming zero-DOM
/// `serde_json` struct, stopping after `limit` assistant rows.
pub fn read_usage(
    path: &Path,
    mut after: i64,
    now: Option<f64>,
    limit: i64,
) -> Result<(i64, Vec<DevinUsageRow>), rusqlite::Error> {
    let db = open_readonly(path, 2.0)?;
    let max_row: Option<i64> =
        db.query_row("SELECT MAX(row_id) FROM message_nodes", [], |r| r.get(0))?;
    if max_row.unwrap_or(0) < after {
        after = 0;
    }

    if limit <= 0 {
        return Ok((after, Vec::new()));
    }

    let mut stmt = db.prepare(
        "SELECT m.row_id, m.session_id, m.created_at, m.chat_message, \
                s.working_directory, s.title \
         FROM message_nodes m LEFT JOIN sessions s ON s.id=m.session_id \
         WHERE m.row_id>? ORDER BY m.row_id",
    )?;
    let mut rows = stmt.query([after])?;

    let mut out = Vec::new();
    let mut last = after;
    let mut assistant_seen: i64 = 0;
    let mut title_cache: HashMap<String, String> = HashMap::new();

    while let Some(row) = rows.next()? {
        let msg_bytes = match row.get_ref(3)? {
            ValueRef::Text(b) => b,
            _ => continue,
        };
        let Ok(parsed) = serde_json::from_slice::<MinimalChatMessage>(msg_bytes) else {
            continue;
        };
        if parsed.role.as_deref() != Some("assistant") {
            continue;
        }
        assistant_seen += 1;

        let row_id: i64 = row.get(0)?;
        let created = row.get_ref(2).map(|v| stamp_value(&v)).unwrap_or(0.0);

        let metrics = parsed.metadata.as_ref().and_then(|m| m.metrics.as_ref());
        let tokens = [
            metrics
                .and_then(|m| m.input_tokens.as_ref())
                .map_or(0, FlexCount::as_count),
            metrics
                .and_then(|m| m.cache_read_tokens.as_ref())
                .map_or(0, FlexCount::as_count),
            metrics
                .and_then(|m| m.cache_creation_tokens.as_ref())
                .map_or(0, FlexCount::as_count),
            metrics
                .and_then(|m| m.output_tokens.as_ref())
                .map_or(0, FlexCount::as_count),
        ];
        let total: i64 = tokens.iter().sum();

        if total == 0 {
            if let Some(n) = now {
                if n - created < 120.0 {
                    break;
                }
            }
        }
        last = row_id;

        let mid = parsed.message_id.and_then(FlexStr::into_nonempty);
        let (req_id, gen_model) = match parsed.metadata {
            Some(md) => (
                md.request_id.and_then(FlexStr::into_nonempty),
                md.generation_model.and_then(FlexStr::into_nonempty),
            ),
            None => (None, None),
        };
        let key = mid.or(req_id);

        if let Some(key_str) = key {
            if total > 0 {
                let sid = row
                    .get_ref(1)
                    .ok()
                    .and_then(value_as_opt_string)
                    .unwrap_or_default();
                if is_valid_id(&sid) {
                    let cwd = row
                        .get_ref(4)
                        .ok()
                        .and_then(value_as_opt_string)
                        .unwrap_or_default();
                    let cleaned_title = if let Some(cached) = title_cache.get(&sid) {
                        cached.clone()
                    } else {
                        let raw_title = row
                            .get_ref(5)
                            .ok()
                            .and_then(value_as_opt_string)
                            .unwrap_or_default();
                        let c = clean_title(&raw_title, 200);
                        title_cache.insert(sid.clone(), c.clone());
                        c
                    };
                    let model = truncate_chars(gen_model.as_deref().unwrap_or(""), 160);
                    let session_model = if model == "compactor" {
                        String::new()
                    } else {
                        model.clone()
                    };

                    out.push(DevinUsageRow {
                        session: sid,
                        id: truncate_chars(&key_str, 120),
                        t: created,
                        model,
                        tokens,
                        session_model,
                        cwd,
                        title: cleaned_title,
                    });
                }
            }
        }

        if assistant_seen >= limit {
            break;
        }
    }

    Ok((last, out))
}
