use crate::readonly::open_readonly;
use crate::text::{clean_title, parse_antigravity_stamp, truncate_chars};
use percent_encoding::percent_decode_str;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::OnceLock;
use thiserror::Error;
use url::Url;

pub const REREAD: i64 = 32;

#[derive(Debug, Error)]
pub enum WireError {
    #[error("varint")]
    Varint,
    #[error("truncated")]
    Truncated,
    #[error("wire type")]
    WireType,
}

#[derive(Debug, Error)]
pub enum AntigravityError {
    #[error(transparent)]
    Wire(#[from] WireError),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WireValue {
    Varint(u128),
    Bytes(Vec<u8>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResponseUsage {
    pub id: String,
    pub tokens: [u128; 4],
    pub model: u128,
    pub t: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AntigravityUsageRow {
    pub id: String,
    pub tokens: [u128; 4],
    pub model_num: u128,
    pub model: String,
    pub t: f64,
    pub idx: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogRow {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub status: String,
    pub modified: f64,
    pub root: String,
    pub parent: Option<String>,
}

fn conversation_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static UUID regex literal
        Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
            .expect("valid uuid regex")
    })
}

fn openbot_profile_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal
        Regex::new(r"/openbot-profile-[^/]+$").expect("valid openbot profile regex")
    })
}

pub fn is_conversation_id(s: &str) -> bool {
    conversation_re().is_match(s)
}

pub fn roots(home: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let base = home.join(".gemini");
    for name in ["antigravity-cli", "antigravity-acp"] {
        let p = base.join(name);
        if p.is_dir() {
            out.push(p);
        }
    }
    let patterns = [
        format!(
            "{}/Library/Application Support/OpenBot/antigravity-accounts/*/antigravity-acp",
            home.display()
        ),
        format!(
            "{}/Library/Application Support/OpenBot/provider-accounts/*/antigravity-acp",
            home.display()
        ),
        format!(
            "{}/Library/Application Support/OpenBot/provider-accounts/*/antigravity-cli",
            home.display()
        ),
        format!(
            "{}/.config/OpenBot/provider-accounts/*/antigravity-acp",
            home.display()
        ),
    ];
    for pat in patterns {
        if let Ok(paths) = glob::glob(&pat) {
            for p in paths.flatten() {
                if p.is_dir() && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
    }
    out
}

/// Exact port of `observe/antigravity.py:_varint`.
pub fn decode_varint(data: &[u8], mut i: usize) -> Result<(u128, usize), WireError> {
    let mut value: u128 = 0;
    let mut shift: u32 = 0;
    loop {
        let byte = *data.get(i).ok_or(WireError::Truncated)?;
        i += 1;
        value |= u128::from(byte & 0x7f) << shift;
        shift += 7;
        if byte < 0x80 {
            return Ok((value, i));
        }
        if shift > 63 {
            return Err(WireError::Varint);
        }
    }
}

/// Exact port of `observe/antigravity.py:fields`.
pub fn decode_fields(data: &[u8]) -> Result<BTreeMap<u128, Vec<WireValue>>, WireError> {
    let mut out: BTreeMap<u128, Vec<WireValue>> = BTreeMap::new();
    let mut i = 0usize;
    let size = data.len();
    while i < size {
        let (key, next_i) = decode_varint(data, i)?;
        i = next_i;
        let number = key >> 3;
        let wire = key & 7;
        match wire {
            0 => {
                let (val, next_i) = decode_varint(data, i)?;
                i = next_i;
                out.entry(number).or_default().push(WireValue::Varint(val));
            }
            2 => {
                let (len_u128, next_i) = decode_varint(data, i)?;
                i = next_i;
                let length = usize::try_from(len_u128).map_err(|_| WireError::Truncated)?;
                let end = i.checked_add(length).ok_or(WireError::Truncated)?;
                if end > size {
                    return Err(WireError::Truncated);
                }
                let slice = data[i..end].to_vec();
                i = end;
                out.entry(number).or_default().push(WireValue::Bytes(slice));
            }
            1 => {
                i = i.saturating_add(8);
            }
            5 => {
                i = i.saturating_add(4);
            }
            _ => return Err(WireError::WireType),
        }
    }
    Ok(out)
}

fn first_int(values: Option<&Vec<WireValue>>) -> u128 {
    match values.and_then(|v| v.first()) {
        Some(WireValue::Varint(n)) => *n,
        _ => 0,
    }
}

fn first_text(values: Option<&Vec<WireValue>>) -> String {
    match values.and_then(|v| v.first()) {
        Some(WireValue::Bytes(b)) => match std::str::from_utf8(b) {
            Ok(s) => truncate_chars(s, 160),
            Err(_) => String::new(),
        },
        _ => String::new(),
    }
}

fn first_bytes(values: Option<&Vec<WireValue>>) -> Option<&[u8]> {
    match values.and_then(|v| v.first()) {
        Some(WireValue::Bytes(b)) => Some(b.as_slice()),
        _ => None,
    }
}

fn seconds(values: Option<&Vec<WireValue>>) -> Result<f64, WireError> {
    let Some(bytes) = first_bytes(values) else {
        return Ok(0.0);
    };
    let sf = decode_fields(bytes)?;
    Ok(first_int(sf.get(&1)) as f64 + (first_int(sf.get(&2)) as f64) / 1e9)
}

/// Exact port of `observe/antigravity.py:response`.
pub fn parse_response(metadata: &[u8]) -> Result<Option<ResponseUsage>, WireError> {
    let top = decode_fields(metadata)?;
    let Some(usage_bytes) = first_bytes(top.get(&9)) else {
        return Ok(None);
    };
    let usage = decode_fields(usage_bytes)?;
    let rid = {
        let a = first_text(usage.get(&7));
        if !a.is_empty() {
            a
        } else {
            first_text(usage.get(&11))
        }
    };
    let tokens = [
        first_int(usage.get(&2)),
        first_int(usage.get(&5)),
        first_int(usage.get(&4)),
        first_int(usage.get(&3)),
    ];
    let total = tokens.iter().fold(0u128, |acc, &x| acc.saturating_add(x));
    if rid.is_empty() || total == 0 {
        return Ok(None);
    }
    let mut at = 0.0_f64;
    for field_num in [1u128, 6, 7, 8] {
        let s = seconds(top.get(&field_num))?;
        if s > at {
            at = s;
        }
    }
    Ok(Some(ResponseUsage {
        id: rid,
        tokens,
        model: first_int(usage.get(&1)),
        t: at,
    }))
}

fn parse_gen_metadata_row(data: &[u8]) -> Result<Option<(Vec<String>, u128, String)>, WireError> {
    let top = decode_fields(data)?;
    let generation = match first_bytes(top.get(&1)) {
        Some(b) => decode_fields(b)?,
        None => BTreeMap::new(),
    };
    let number = first_int(generation.get(&3));
    let name = first_text(generation.get(&19));
    let ids = match first_bytes(generation.get(&4)) {
        Some(b) => decode_fields(b)?,
        None => BTreeMap::new(),
    };
    if name.is_empty() {
        return Ok(None);
    }
    let mut rids = Vec::with_capacity(2);
    for fid in [7u128, 11] {
        let r = first_text(ids.get(&fid));
        if !r.is_empty() {
            rids.push(r);
        }
    }
    Ok(Some((rids, number, name)))
}

pub type UsageBatch = (i64, Vec<AntigravityUsageRow>, BTreeMap<u128, String>);

/// Exact port of `observe/antigravity.py:usage`.
/// Returns `(last_idx, rows, newly_discovered_model_numbers)`.
/// Caller may merge `newly_discovered_model_numbers` into its persistent model cache
/// and resolve empty `row.model` via `row.model_num`.
pub fn read_usage(
    path: &Path,
    mut after: i64,
    known_models: &BTreeMap<u128, String>,
) -> Result<UsageBatch, AntigravityError> {
    let db = open_readonly(path, 1.0)?;
    let top: Option<i64> = db.query_row("SELECT MAX(idx) FROM steps", [], |r| r.get(0))?;
    if top.unwrap_or(-1) < after {
        after = -1;
    }
    let threshold = (after - REREAD).max(-1);
    let mut stmt = db.prepare("SELECT idx, metadata FROM steps WHERE idx>? ORDER BY idx")?;
    let mut rows_iter = stmt.query([threshold])?;
    let mut found: Vec<(i64, ResponseUsage)> = Vec::new();
    let mut last_idx: Option<i64> = None;

    while let Some(row) = rows_iter.next()? {
        let idx: i64 = row.get(0)?;
        last_idx = Some(idx);
        let metadata: Option<Vec<u8>> = row.get(1)?;
        let bytes = metadata.as_deref().unwrap_or(&[]);
        if let Ok(Some(item)) = parse_response(bytes) {
            found.push((idx, item));
        }
    }
    drop(rows_iter);
    drop(stmt);

    let mut names: BTreeMap<String, String> = BTreeMap::new();
    let mut numbers: BTreeMap<u128, String> = BTreeMap::new();
    if !found.is_empty() {
        let limit = (found.len() as i64) + 8;
        if let Ok(mut gstmt) = db.prepare(
            "SELECT data FROM gen_metadata WHERE length(data)<65536 ORDER BY idx DESC LIMIT ?",
        ) {
            if let Ok(mut grows) = gstmt.query([limit]) {
                while let Ok(Some(grow)) = grows.next() {
                    let blob: Option<Vec<u8>> = grow.get(0).ok().flatten();
                    if let Some(data) = blob {
                        if let Ok(Some((rids, number, name))) = parse_gen_metadata_row(&data) {
                            for rid in rids {
                                names.entry(rid).or_insert_with(|| name.clone());
                            }
                            if number != 0 {
                                numbers.entry(number).or_insert(name);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut out = Vec::with_capacity(found.len());
    for (idx, item) in found {
        let resolved_model = names
            .get(&item.id)
            .or_else(|| numbers.get(&item.model))
            .or_else(|| known_models.get(&item.model))
            .cloned()
            .unwrap_or_default();
        out.push(AntigravityUsageRow {
            id: item.id,
            tokens: item.tokens,
            model_num: item.model,
            model: resolved_model,
            t: item.t,
            idx,
        });
    }

    Ok((last_idx.unwrap_or(after), out, numbers))
}

/// Exact port of `observe/antigravity.py:workspace`.
pub fn workspace_from_uris(uris: Option<&str>) -> String {
    let raw = uris.unwrap_or("[]");
    let Ok(serde_json::Value::Array(values)) = serde_json::from_str::<serde_json::Value>(raw)
    else {
        return String::new();
    };
    for value in values {
        let s = match value {
            serde_json::Value::String(v) => v,
            other => other.to_string(),
        };
        if let Ok(parsed) = Url::parse(&s) {
            if parsed.scheme() == "file" {
                let decoded = percent_decode_str(parsed.path()).decode_utf8_lossy();
                let trimmed = decoded.trim_end_matches('/');
                if !trimmed.is_empty() {
                    if openbot_profile_re().is_match(trimmed) {
                        return "OpenBot".to_string();
                    }
                    return trimmed.to_string();
                }
            }
        }
    }
    String::new()
}

/// Exact port of `observe/antigravity.py:catalog`.
pub fn read_catalog(root: &Path) -> BTreeMap<String, CatalogRow> {
    let db_path = root.join("conversation_summaries.db");
    let Ok(db) = open_readonly(&db_path, 1.0) else {
        return BTreeMap::new();
    };
    let Ok(mut stmt) = db.prepare(
        "SELECT conversation_id, title, workspace_uris, status, last_modified_time, parent_conversation_id \
         FROM conversation_summaries",
    ) else {
        return BTreeMap::new();
    };
    let Ok(mut rows) = stmt.query([]) else {
        return BTreeMap::new();
    };

    let root_str = root.to_string_lossy().to_string();
    let re = conversation_re();
    let mut out = BTreeMap::new();

    while let Ok(Some(row)) = rows.next() {
        let cid: String = match row.get::<_, Option<String>>(0) {
            Ok(Some(v)) => v,
            _ => continue,
        };
        if !re.is_match(&cid) {
            continue;
        }
        let title_raw: String = row
            .get::<_, Option<String>>(1)
            .ok()
            .flatten()
            .unwrap_or_default();
        let uris: Option<String> = row.get::<_, Option<String>>(2).ok().flatten();
        let status: String = row
            .get::<_, Option<String>>(3)
            .ok()
            .flatten()
            .unwrap_or_default();
        let modified_raw: Option<String> = row.get::<_, Option<String>>(4).ok().flatten();
        let parent_raw: Option<String> = row.get::<_, Option<String>>(5).ok().flatten();

        let at = modified_raw
            .as_deref()
            .map(parse_antigravity_stamp)
            .unwrap_or(0.0);
        let parent = parent_raw.filter(|p| re.is_match(p));

        out.insert(
            cid.clone(),
            CatalogRow {
                id: cid,
                title: clean_title(&title_raw, 200),
                cwd: workspace_from_uris(uris.as_deref()),
                status,
                modified: at,
                root: root_str.clone(),
                parent,
            },
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_varint(mut v: u64, out: &mut Vec<u8>) {
        loop {
            let mut b = (v & 0x7f) as u8;
            v >>= 7;
            if v != 0 {
                b |= 0x80;
            }
            out.push(b);
            if v == 0 {
                break;
            }
        }
    }

    fn encode_ld(field: u64, payload: &[u8], out: &mut Vec<u8>) {
        encode_varint((field << 3) | 2, out);
        encode_varint(payload.len() as u64, out);
        out.extend_from_slice(payload);
    }

    fn encode_vi_field(field: u64, val: u64, out: &mut Vec<u8>) {
        encode_varint(field << 3, out);
        encode_varint(val, out);
    }

    #[test]
    fn decodes_synthetic_response_usage() {
        let mut usage_msg = Vec::new();
        encode_vi_field(1, 42, &mut usage_msg);
        encode_vi_field(2, 100, &mut usage_msg);
        encode_vi_field(3, 50, &mut usage_msg);
        encode_vi_field(4, 20, &mut usage_msg);
        encode_vi_field(5, 300, &mut usage_msg);
        encode_ld(7, b"resp-abc", &mut usage_msg);

        let mut ts_msg = Vec::new();
        encode_vi_field(1, 1795600000, &mut ts_msg);
        encode_vi_field(2, 500_000_000, &mut ts_msg);

        let mut top = Vec::new();
        encode_ld(9, &usage_msg, &mut top);
        encode_ld(8, &ts_msg, &mut top);

        let parsed = parse_response(&top).expect("ok").expect("some");
        assert_eq!(parsed.id, "resp-abc");
        assert_eq!(parsed.tokens, [100, 300, 20, 50]);
        assert_eq!(parsed.model, 42);
        assert!((parsed.t - 1795600000.5).abs() < 1e-6);
    }

    #[test]
    fn workspace_maps_openbot_profile_and_decodes_spaces() {
        assert_eq!(
            workspace_from_uris(Some(r#"["file:///Users/alice/My%20Project/"]"#)),
            "/Users/alice/My Project"
        );
        assert_eq!(
            workspace_from_uris(Some(r#"["file:///tmp/openbot-profile-12345"]"#)),
            "OpenBot"
        );
    }
}
