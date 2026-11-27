//! Complete port of `telemetry.py` and `telemetry_setup.py`.
//! Includes pure-Rust OTLP/HTTP JSON + Protobuf + gzip decoder with `#![forbid(unsafe_code)]`.
use crate::effort::level as effort_level;
use crate::platform_support::data_directory;
use crate::sessions::sha256_hex;
use crate::text::epoch_rfc3339;
use base64::Engine;
use flate2::read::GzDecoder;
use rand::RngCore;
use regex::Regex;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_BODY: usize = 4 * 1024 * 1024;
pub const MAX_RECORDS: usize = 5000;
pub const RETENTION: f64 = 8.0 * 86400.0;
pub const MAX_STORED: i64 = 100_000;

const BEGIN_MARKER: &str = "# BEGIN 1top local telemetry";
const END_MARKER: &str = "# END 1top local telemetry";

fn ident_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,255}$").unwrap())
}

fn key_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9_-]{43,128}$").unwrap())
}

pub fn literal(val: Option<&Value>) -> Option<String> {
    let s = val?.as_str()?;
    if ident_re().is_match(s) {
        Some(s.to_string())
    } else {
        None
    }
}

pub fn number(val: Option<&Value>) -> Option<f64> {
    let v = val?;
    if v.is_boolean() {
        return None;
    }
    let f = match v {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.parse::<f64>().ok()?,
        _ => return None,
    };
    if f.is_finite() && (0.0..=1e15).contains(&f) {
        Some(f)
    } else {
        None
    }
}

pub fn account_identity(kind: &str, account: &str, workspace: &str) -> String {
    let digest = sha256_hex(format!("{account}|{workspace}").as_bytes());
    format!("{}:{}", kind.to_lowercase(), &digest[..20])
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

// ---------------- Pure-Rust OTLP Protobuf Wire Decoder ----------------

fn pb_varint(buf: &[u8], pos: &mut usize) -> Result<u64, &'static str> {
    let mut out = 0u64;
    let mut shift = 0u32;
    loop {
        if *pos >= buf.len() || shift >= 64 {
            return Err("invalid_varint");
        }
        let b = buf[*pos];
        *pos += 1;
        out |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Ok(out);
        }
        shift += 7;
    }
}

fn pb_read_field<'a>(
    buf: &'a [u8],
    pos: &mut usize,
) -> Result<(u32, u8, &'a [u8], u64), &'static str> {
    let tag = pb_varint(buf, pos)?;
    let field_num = (tag >> 3) as u32;
    let wire_type = (tag & 7) as u8;
    match wire_type {
        0 => {
            let v = pb_varint(buf, pos)?;
            Ok((field_num, wire_type, &[], v))
        }
        1 => {
            if *pos + 8 > buf.len() {
                return Err("truncated_fixed64");
            }
            let slice = &buf[*pos..*pos + 8];
            *pos += 8;
            let v = u64::from_le_bytes(slice.try_into().unwrap());
            Ok((field_num, wire_type, slice, v))
        }
        2 => {
            let len = pb_varint(buf, pos)? as usize;
            if *pos + len > buf.len() {
                return Err("truncated_bytes");
            }
            let slice = &buf[*pos..*pos + len];
            *pos += len;
            Ok((field_num, wire_type, slice, 0))
        }
        5 => {
            if *pos + 4 > buf.len() {
                return Err("truncated_fixed32");
            }
            let slice = &buf[*pos..*pos + 4];
            *pos += 4;
            let v = u32::from_le_bytes(slice.try_into().unwrap()) as u64;
            Ok((field_num, wire_type, slice, v))
        }
        _ => Err("unsupported_wire_type"),
    }
}

fn decode_any_value(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut out = Map::new();
    while pos < buf.len() {
        let (f, wt, slice, v) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (1, 2) => {
                out.insert(
                    "stringValue".into(),
                    Value::String(String::from_utf8_lossy(slice).into_owned()),
                );
            }
            (2, 0) => {
                out.insert("boolValue".into(), Value::Bool(v != 0));
            }
            (3, 0) => {
                out.insert("intValue".into(), Value::String((v as i64).to_string()));
            }
            (4, 1) => {
                out.insert("doubleValue".into(), json!(f64::from_bits(v)));
            }
            _ => {}
        }
    }
    Ok(Value::Object(out))
}

fn decode_key_value(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut key = String::new();
    let mut val = Value::Object(Map::new());
    while pos < buf.len() {
        let (f, wt, slice, _) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (1, 2) => key = String::from_utf8_lossy(slice).into_owned(),
            (2, 2) => val = decode_any_value(slice)?,
            _ => {}
        }
    }
    Ok(json!({"key": key, "value": val}))
}

fn decode_resource(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut attributes = Vec::new();
    while pos < buf.len() {
        let (f, wt, slice, _) = pb_read_field(buf, &mut pos)?;
        if f == 1 && wt == 2 {
            attributes.push(decode_key_value(slice)?);
        }
    }
    Ok(json!({"attributes": attributes}))
}

fn decode_log_record(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut out = Map::new();
    let mut attrs = Vec::new();
    while pos < buf.len() {
        let (f, wt, slice, v) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (1, 1) => {
                out.insert("timeUnixNano".into(), json!(v.to_string()));
            }
            (11, 1) => {
                out.insert("observedTimeUnixNano".into(), json!(v.to_string()));
            }
            (5, 2) => {
                out.insert("body".into(), decode_any_value(slice)?);
            }
            (6, 2) => {
                attrs.push(decode_key_value(slice)?);
            }
            (12, 2) => {
                out.insert(
                    "eventName".into(),
                    Value::String(String::from_utf8_lossy(slice).into_owned()),
                );
            }
            _ => {}
        }
    }
    out.insert("attributes".into(), Value::Array(attrs));
    Ok(Value::Object(out))
}

fn decode_number_dp(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut out = Map::new();
    let mut attrs = Vec::new();
    while pos < buf.len() {
        let (f, wt, slice, v) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (7, 2) => attrs.push(decode_key_value(slice)?),
            (2, 1) => {
                out.insert("startTimeUnixNano".into(), json!(v.to_string()));
            }
            (3, 1) => {
                out.insert("timeUnixNano".into(), json!(v.to_string()));
            }
            (4, 1) => {
                out.insert("asDouble".into(), json!(f64::from_bits(v)));
            }
            (6, 1) => {
                out.insert("asInt".into(), json!((v as i64).to_string()));
            }
            _ => {}
        }
    }
    out.insert("attributes".into(), Value::Array(attrs));
    Ok(Value::Object(out))
}

fn decode_hist_dp(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut out = Map::new();
    let mut attrs = Vec::new();
    while pos < buf.len() {
        let (f, wt, slice, v) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (9, 2) => attrs.push(decode_key_value(slice)?),
            (2, 1) => {
                out.insert("startTimeUnixNano".into(), json!(v.to_string()));
            }
            (3, 1) => {
                out.insert("timeUnixNano".into(), json!(v.to_string()));
            }
            (4, 1) => {
                out.insert("count".into(), json!(v.to_string()));
            }
            (5, 1) => {
                out.insert("sum".into(), json!(f64::from_bits(v)));
            }
            _ => {}
        }
    }
    out.insert("attributes".into(), Value::Array(attrs));
    Ok(Value::Object(out))
}

fn decode_metric_series(buf: &[u8], hist: bool) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut dps = Vec::new();
    let mut temp: Option<u64> = None;
    while pos < buf.len() {
        let (f, wt, slice, v) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (1, 2) => {
                dps.push(if hist {
                    decode_hist_dp(slice)?
                } else {
                    decode_number_dp(slice)?
                });
            }
            (2, 0) => temp = Some(v),
            _ => {}
        }
    }
    let mut out = Map::new();
    out.insert("dataPoints".into(), Value::Array(dps));
    if let Some(t) = temp {
        out.insert("aggregationTemporality".into(), json!(t));
    }
    Ok(Value::Object(out))
}

fn decode_metric(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut out = Map::new();
    while pos < buf.len() {
        let (f, wt, slice, _) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (1, 2) => {
                out.insert(
                    "name".into(),
                    Value::String(String::from_utf8_lossy(slice).into_owned()),
                );
            }
            (5, 2) => {
                out.insert("gauge".into(), decode_metric_series(slice, false)?);
            }
            (7, 2) => {
                out.insert("sum".into(), decode_metric_series(slice, false)?);
            }
            (9, 2) => {
                out.insert("histogram".into(), decode_metric_series(slice, true)?);
            }
            (10, 2) => {
                out.insert(
                    "exponentialHistogram".into(),
                    decode_metric_series(slice, true)?,
                );
            }
            _ => {}
        }
    }
    Ok(Value::Object(out))
}

fn decode_span(buf: &[u8]) -> Result<Value, &'static str> {
    let mut pos = 0;
    let mut out = Map::new();
    let mut attrs = Vec::new();
    while pos < buf.len() {
        let (f, wt, slice, v) = pb_read_field(buf, &mut pos)?;
        match (f, wt) {
            (2, 2) => {
                out.insert(
                    "spanId".into(),
                    json!(base64::engine::general_purpose::STANDARD.encode(slice)),
                );
            }
            (5, 2) => {
                out.insert(
                    "name".into(),
                    Value::String(String::from_utf8_lossy(slice).into_owned()),
                );
            }
            (7, 1) => {
                out.insert("startTimeUnixNano".into(), json!(v.to_string()));
            }
            (8, 1) => {
                out.insert("endTimeUnixNano".into(), json!(v.to_string()));
            }
            (9, 2) => attrs.push(decode_key_value(slice)?),
            (15, 2) => {
                let mut sp = 0;
                while sp < slice.len() {
                    let (sf, swt, _, sv) = pb_read_field(slice, &mut sp)?;
                    if sf == 3 && swt == 0 {
                        out.insert("status".into(), json!({"code": sv}));
                    }
                }
            }
            _ => {}
        }
    }
    out.insert("attributes".into(), Value::Array(attrs));
    Ok(Value::Object(out))
}

fn decode_otlp_protobuf(signal: &str, body: &[u8]) -> Result<Value, &'static str> {
    let (res_key, scope_key, rec_key) = match signal {
        "logs" => ("resourceLogs", "scopeLogs", "logRecords"),
        "metrics" => ("resourceMetrics", "scopeMetrics", "metrics"),
        "traces" => ("resourceSpans", "scopeSpans", "spans"),
        _ => return Err("unsupported_signal"),
    };
    let mut pos = 0;
    let mut groups = Vec::new();
    while pos < body.len() {
        let (f, wt, slice, _) = pb_read_field(body, &mut pos)?;
        if f == 1 && wt == 2 {
            let mut gpos = 0;
            let mut resource = json!({"attributes": []});
            let mut scopes = Vec::new();
            while gpos < slice.len() {
                let (gf, gwt, gslice, _) = pb_read_field(slice, &mut gpos)?;
                if gf == 1 && gwt == 2 {
                    resource = decode_resource(gslice)?;
                } else if gf == 2 && gwt == 2 {
                    let mut spos = 0;
                    let mut recs = Vec::new();
                    while spos < gslice.len() {
                        let (sf, swt, sslice, _) = pb_read_field(gslice, &mut spos)?;
                        if sf == 2 && swt == 2 {
                            let rec = match signal {
                                "logs" => decode_log_record(sslice)?,
                                "metrics" => decode_metric(sslice)?,
                                "traces" => decode_span(sslice)?,
                                _ => unreachable!(),
                            };
                            recs.push(rec);
                        }
                    }
                    let mut smap = Map::new();
                    smap.insert(rec_key.into(), Value::Array(recs));
                    scopes.push(Value::Object(smap));
                }
            }
            let mut gmap = Map::new();
            gmap.insert("resource".into(), resource);
            gmap.insert(scope_key.into(), Value::Array(scopes));
            groups.push(Value::Object(gmap));
        }
    }
    let mut doc = Map::new();
    doc.insert(res_key.into(), Value::Array(groups));
    Ok(Value::Object(doc))
}

/// Exact port of `telemetry.py:decode`.
pub fn decode_otlp(
    body: &[u8],
    signal: &str,
    content_type: &str,
    encoding: &str,
) -> Result<Value, &'static str> {
    if body.len() > MAX_BODY {
        return Err("payload_too_large");
    }
    let raw_buf: Vec<u8>;
    let data_bytes: &[u8] = if encoding == "gzip" {
        let mut decoder = GzDecoder::new(body);
        let mut out = Vec::new();
        decoder
            .by_ref()
            .take((MAX_BODY + 1) as u64)
            .read_to_end(&mut out)
            .map_err(|_| "invalid_gzip")?;
        if out.len() > MAX_BODY {
            return Err("payload_too_large");
        }
        raw_buf = out;
        &raw_buf
    } else if encoding.is_empty() || encoding == "identity" {
        body
    } else {
        return Err("unsupported_encoding");
    };

    let media = content_type.split(';').next().unwrap_or("").trim();
    let doc = if media == "application/json" {
        serde_json::from_slice::<Value>(data_bytes).map_err(|_| "invalid_json")?
    } else if content_type == "application/x-protobuf" {
        decode_otlp_protobuf(signal, data_bytes)?
    } else {
        return Err("unsupported_content_type");
    };
    if !doc.is_object() {
        return Err("invalid_otlp_document");
    }
    Ok(doc)
}

fn parse_attrs(values: Option<&Value>) -> Map<String, Value> {
    let mut result = Map::new();
    let Some(arr) = values.and_then(|v| v.as_array()) else {
        return result;
    };
    for item in arr.iter().take(256) {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let Some(key) = obj.get("key").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(val) = obj.get("value").and_then(|v| v.as_object()) else {
            continue;
        };
        for field in ["stringValue", "intValue", "doubleValue", "boolValue"] {
            if let Some(v) = val.get(field).filter(|x| !x.is_null()) {
                result.insert(key.to_string(), v.clone());
                break;
            }
        }
    }
    result
}

fn parse_u64_val(v: Option<&Value>) -> Option<u64> {
    match v? {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    }
}

fn record_timestamp(
    record: &Map<String, Value>,
    attrs: &Map<String, Value>,
    now: f64,
) -> Option<f64> {
    let raw = record
        .get("timeUnixNano")
        .or_else(|| record.get("endTimeUnixNano"));
    let t = if let Some(nanos) = parse_u64_val(raw).filter(|&n| n > 0) {
        nanos as f64 / 1e9
    } else if let Some(ev_ts) = attrs.get("event.timestamp").and_then(|v| v.as_str()) {
        epoch_rfc3339(ev_ts)?
    } else {
        parse_u64_val(record.get("observedTimeUnixNano")).unwrap_or(0) as f64 / 1e9
    };
    if t.is_finite() && now - RETENTION <= t && t <= now + 30.0 {
        Some(t)
    } else {
        None
    }
}

fn normalize_record(
    signal: &str,
    record: &Map<String, Value>,
    a: &Map<String, Value>,
    now: f64,
    metric: Option<Value>,
) -> Option<Value> {
    let mut name_val = a
        .get("event.name")
        .or_else(|| record.get("eventName"))
        .or_else(|| record.get("name"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    if name_val.as_deref().is_none_or(str::is_empty) {
        if let Some(cand) = record
            .get("body")
            .and_then(|b| b.get("stringValue"))
            .and_then(|v| v.as_str())
        {
            if cand.starts_with("claude_code.") || cand.starts_with("codex.") {
                name_val = Some(cand.to_string());
            }
        }
    }
    let service = a
        .get("service.name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let mut name = literal(name_val.as_deref().map(Value::from).as_ref())?;
    let kind = if name.starts_with("claude_code.")
        || matches!(service.as_str(), "claude-code" | "claude_code")
    {
        "Claude"
    } else if name.starts_with("codex.") || service.contains("codex") {
        "Codex"
    } else {
        return None;
    };
    let sid = literal(if kind == "Claude" {
        a.get("session.id")
    } else {
        a.get("conversation.id")
    })?;
    let t = record_timestamp(record, a, now)?;
    if kind == "Claude" && !name.starts_with("claude_code.") {
        name = format!("claude_code.{name}");
    }
    let acct_raw = literal(if kind == "Claude" {
        a.get("user.account_uuid")
    } else {
        a.get("user.account_id")
    });
    let org = literal(a.get("organization.id")).unwrap_or_default();
    let account_key = acct_raw
        .as_deref()
        .map(|acc| account_identity(kind, acc, if kind == "Claude" { &org } else { "" }));

    let mut values: Option<[i64; 4]> = None;
    if signal == "logs" && name == "claude_code.api_request" {
        let keys = [
            "input_tokens",
            "cache_read_tokens",
            "cache_creation_tokens",
            "output_tokens",
        ];
        let parsed: Vec<Option<f64>> = keys.iter().map(|k| number(a.get(*k))).collect();
        let valid = keys
            .iter()
            .zip(&parsed)
            .all(|(k, p)| !a.contains_key(*k) || p.is_some_and(|x| x.fract() == 0.0));
        if valid && parsed[0].is_some() && parsed[3].is_some() {
            values = Some([
                parsed[0].unwrap_or(0.0) as i64,
                parsed[1].unwrap_or(0.0) as i64,
                parsed[2].unwrap_or(0.0) as i64,
                parsed[3].unwrap_or(0.0) as i64,
            ]);
        }
    } else if signal == "logs"
        && matches!(name.as_str(), "codex.sse_event" | "codex.websocket_event")
        && a.get("event.kind").and_then(|v| v.as_str()) == Some("response.completed")
    {
        let fresh = number(a.get("input_token_count"));
        let output = number(a.get("output_token_count"));
        let cached = number(a.get("cached_token_count")).unwrap_or(0.0);
        let written = number(a.get("cache_write_token_count")).unwrap_or(0.0);
        let valid = [
            "input_token_count",
            "output_token_count",
            "cached_token_count",
            "cache_write_token_count",
        ]
        .iter()
        .all(|k| !a.contains_key(*k) || number(a.get(*k)).is_some_and(|x| x.fract() == 0.0));
        if valid {
            if let (Some(fr), Some(out)) = (fresh, output) {
                if cached <= fr {
                    values = Some([
                        (fr - cached) as i64,
                        cached as i64,
                        written as i64,
                        out as i64,
                    ]);
                }
            }
        }
    }

    let mut duration = number(a.get("duration_ms"));
    if duration.is_none() && signal == "traces" {
        if let (Some(end_ns), Some(start_ns)) = (
            parse_u64_val(record.get("endTimeUnixNano")),
            parse_u64_val(record.get("startTimeUnixNano")),
        ) {
            if end_ns >= start_ns {
                duration = Some((end_ns - start_ns) as f64 / 1e6);
            }
        }
    }

    let status_err = match record.get("status").and_then(|s| s.get("code")) {
        Some(Value::Number(n)) => n.as_i64() == Some(2),
        Some(Value::String(s)) => s == "STATUS_CODE_ERROR",
        _ => false,
    };
    let is_error = a
        .get("error")
        .is_some_and(|v| !v.is_null() && v != &Value::Bool(false) && v != &json!(""))
        || a.get("error.message")
            .is_some_and(|v| !v.is_null() && v != &json!(""))
        || name.ends_with(".api_error")
        || status_err;

    let req_id = literal(a.get("request_id").or_else(|| a.get("response.id")));
    let mut item = Map::new();
    item.insert("kind".into(), json!(kind));
    item.insert("session_id".into(), json!(sid));
    item.insert("signal".into(), json!(signal));
    item.insert("name".into(), json!(name));
    item.insert("t".into(), json!(t));
    item.insert(
        "account_id".into(),
        account_key.map(Value::String).unwrap_or(Value::Null),
    );
    item.insert(
        "model".into(),
        literal(a.get("model").or_else(|| a.get("gen_ai.request.model")))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    item.insert(
        "effort".into(),
        effort_level(
            a.get("effort")
                .or_else(|| a.get("model_reasoning_effort"))
                .or_else(|| a.get("reasoning_effort")),
        )
        .map(Value::String)
        .unwrap_or(Value::Null),
    );
    item.insert(
        "parent_session_id".into(),
        literal(a.get("parent.conversation.id"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    item.insert(
        "agent_id".into(),
        literal(a.get("agent_id"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    item.insert(
        "parent_agent_id".into(),
        literal(a.get("parent_agent_id"))
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    item.insert(
        "request_id".into(),
        req_id.clone().map(Value::String).unwrap_or(Value::Null),
    );
    item.insert(
        "duration_ms".into(),
        duration.map(|d| json!(d)).unwrap_or(Value::Null),
    );
    item.insert(
        "ttft_ms".into(),
        number(a.get("ttft_ms"))
            .map(|d| json!(d))
            .unwrap_or(Value::Null),
    );
    item.insert("error".into(), json!(is_error));
    item.insert(
        "tokens".into(),
        values.map(|v| json!(v)).unwrap_or(Value::Null),
    );
    if let Some(m) = metric {
        item.insert("metric".into(), m);
    }

    let stable = if values.is_some() && req_id.is_some() {
        json!([kind, sid, name, req_id])
    } else {
        json!([
            Value::Object(item.clone()),
            record
                .get("timeUnixNano")
                .or_else(|| record.get("endTimeUnixNano"))
                .cloned()
                .unwrap_or(Value::Null),
            record
                .get("startTimeUnixNano")
                .cloned()
                .unwrap_or(Value::Null),
            record.get("spanId").cloned().unwrap_or(Value::Null),
            a.get("event.sequence").cloned().unwrap_or(Value::Null),
            literal(a.get("service.instance.id"))
        ])
    };
    let key = sha256_hex(
        serde_json::to_string(&stable)
            .unwrap_or_default()
            .as_bytes(),
    );
    item.insert("key".into(), json!(key));
    Some(Value::Object(item))
}

pub fn normalize_otlp(
    signal: &str,
    data: &Value,
    now: f64,
) -> Result<(Vec<Value>, usize), &'static str> {
    let (res_key, scope_key, rec_key) = match signal {
        "logs" => ("resourceLogs", "scopeLogs", "logRecords"),
        "metrics" => ("resourceMetrics", "scopeMetrics", "metrics"),
        "traces" => ("resourceSpans", "scopeSpans", "spans"),
        _ => return Err("unsupported_signal"),
    };
    let groups = match data.get(res_key) {
        None | Some(Value::Null) => &[] as &[Value],
        Some(Value::Array(a)) => a.as_slice(),
        _ => return Err("invalid_resource_list"),
    };
    let mut output = Vec::new();
    let mut count = 0usize;
    for group in groups {
        let base = parse_attrs(group.get("resource").and_then(|r| r.get("attributes")));
        let scopes = group
            .get(scope_key)
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for scope in scopes {
            let records = scope
                .get(rec_key)
                .and_then(|v| v.as_array())
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            for record in records {
                let Some(rec_obj) = record.as_object() else {
                    continue;
                };
                if signal == "metrics" {
                    let metric_type = ["sum", "gauge", "histogram", "exponentialHistogram"]
                        .into_iter()
                        .find(|k| rec_obj.contains_key(*k));
                    let Some(mt) = metric_type else {
                        continue;
                    };
                    let Some(mdata) = rec_obj.get(mt).and_then(|v| v.as_object()) else {
                        continue;
                    };
                    let points = mdata
                        .get("dataPoints")
                        .and_then(|v| v.as_array())
                        .map(Vec::as_slice)
                        .unwrap_or(&[]);
                    for point in points {
                        count += 1;
                        if count > MAX_RECORDS {
                            return Err("too_many_records");
                        }
                        let Some(pt_obj) = point.as_object() else {
                            continue;
                        };
                        let mut a = base.clone();
                        for (k, v) in parse_attrs(pt_obj.get("attributes")) {
                            a.insert(k, v);
                        }
                        if let Some(rn) = rec_obj.get("name") {
                            a.insert("event.name".into(), rn.clone());
                        }
                        let start_str = pt_obj.get("startTimeUnixNano").and_then(|v| match v {
                            Value::String(s)
                                if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) =>
                            {
                                Some(s.clone())
                            }
                            Value::Number(n) => n.as_u64().map(|u| u.to_string()),
                            _ => None,
                        });
                        let metric = json!({
                            "type": mt,
                            "temporality": number(mdata.get("aggregationTemporality")),
                            "value": number(pt_obj.get("asInt").or_else(|| pt_obj.get("asDouble"))),
                            "count": number(pt_obj.get("count")),
                            "sum": number(pt_obj.get("sum")),
                            "token_type": literal(a.get("type")),
                            "start": start_str
                        });
                        if let Some(item) = normalize_record(signal, pt_obj, &a, now, Some(metric))
                        {
                            output.push(item);
                        }
                    }
                } else {
                    count += 1;
                    if count > MAX_RECORDS {
                        return Err("too_many_records");
                    }
                    let mut a = base.clone();
                    for (k, v) in parse_attrs(rec_obj.get("attributes")) {
                        a.insert(k, v);
                    }
                    if let Some(item) = normalize_record(signal, rec_obj, &a, now, None) {
                        output.push(item);
                    }
                }
            }
        }
    }
    Ok((output, count))
}

struct StoreInner {
    cache: Option<(f64, Value)>,
    trim_at: f64,
}

pub struct TelemetryStore {
    pub path: PathBuf,
    inner: Mutex<StoreInner>,
}

impl TelemetryStore {
    pub fn new(directory: &Path) -> rusqlite::Result<Self> {
        let _ = std::fs::create_dir_all(directory);
        let path = directory.join("telemetry.sqlite");
        let db = Connection::open(&path)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS records (
                 key TEXT PRIMARY KEY, kind TEXT NOT NULL, sid TEXT NOT NULL,
                 t REAL NOT NULL, received REAL NOT NULL, data TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS telemetry_time ON records(t);
             CREATE INDEX IF NOT EXISTS telemetry_session ON records(kind,sid,t);
             CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value REAL);",
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(Self {
            path,
            inner: Mutex::new(StoreInner {
                cache: None,
                trim_at: 0.0,
            }),
        })
    }

    fn connect(&self) -> rusqlite::Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(std::time::Duration::from_secs(2))?;
        Ok(db)
    }

    pub fn ingest(&self, signal: &str, data: &Value, now: Option<f64>) -> Result<Value, String> {
        let now = now.unwrap_or_else(now_epoch);
        let (records, count) = normalize_otlp(signal, data, now).map_err(|e| e.to_string())?;
        let mut guard = self.inner.lock().map_err(|_| "lock_poisoned")?;
        let mut db = self.connect().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut inserted = 0usize;
        for item in &records {
            let key = item.get("key").and_then(|v| v.as_str()).unwrap_or("");
            let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let sid = item
                .get("session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let t = item.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let raw = serde_json::to_string(item).unwrap_or_default();
            let changed = tx
                .execute(
                    "INSERT OR IGNORE INTO records VALUES(?1,?2,?3,?4,?5,?6)",
                    params![key, kind, sid, t, now, raw],
                )
                .map_err(|e| e.to_string())?;
            inserted += changed;
        }
        let dups = records.len().saturating_sub(inserted);
        let ignored = count.saturating_sub(records.len());
        for (cname, amt) in [
            ("received_records", count as f64),
            ("stored_records", inserted as f64),
            ("duplicate_records", dups as f64),
            ("ignored_records", ignored as f64),
        ] {
            tx.execute(
                "INSERT INTO counters VALUES(?1,?2) ON CONFLICT(name) DO UPDATE SET value=value+excluded.value",
                params![cname, amt],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO counters VALUES('last_received',?1)",
            params![now],
        )
        .map_err(|e| e.to_string())?;
        if now - guard.trim_at > 60.0 {
            let _ = tx.execute("DELETE FROM records WHERE t<?1", params![now - RETENTION]);
            let _ = tx.execute(
                "DELETE FROM records WHERE key IN (SELECT key FROM records ORDER BY t DESC LIMIT -1 OFFSET ?1)",
                params![MAX_STORED],
            );
            guard.trim_at = now;
        }
        tx.commit().map_err(|e| e.to_string())?;
        guard.cache = None;
        Ok(json!({
            "accepted": inserted,
            "duplicates": dups,
            "ignored": ignored
        }))
    }

    pub fn snapshot(&self, now: Option<f64>) -> rusqlite::Result<Value> {
        let now = now.unwrap_or_else(now_epoch);
        let mut guard = self.inner.lock().unwrap();
        if let Some((at, ref cached)) = guard.cache {
            if now - at < 3.0 {
                return Ok(cached.clone());
            }
        }
        let db = self.connect()?;
        let mut counters = Map::new();
        {
            let mut stmt = db.prepare("SELECT name, value FROM counters")?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
            for (n, v) in rows.flatten() {
                counters.insert(n, json!(v));
            }
        }
        let mut raw_rows = Vec::new();
        {
            let mut stmt =
                db.prepare("SELECT data FROM records WHERE t>?1 AND t<=?2 ORDER BY t")?;
            let rows = stmt.query_map(params![now - 86400.0, now], |r| r.get::<_, String>(0))?;
            for r in rows.flatten() {
                raw_rows.push(r);
            }
        }

        let mut sessions: HashMap<(String, String), Map<String, Value>> = HashMap::new();
        let mut sigs: HashMap<(String, String), BTreeSet<String>> = HashMap::new();
        let mut acct_ids: HashMap<(String, String), BTreeSet<String>> = HashMap::new();
        let mut prio_map: HashMap<(String, String), i32> = HashMap::new();

        for raw in raw_rows {
            let Ok(item) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            let Some(iobj) = item.as_object() else {
                continue;
            };
            let kind = iobj
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let sid = iobj
                .get("session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let t = iobj.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let signal = iobj.get("signal").and_then(|v| v.as_str()).unwrap_or("");
            let key = (kind.clone(), sid.clone());
            let s = sessions.entry(key.clone()).or_insert_with(|| {
                let mut m = Map::new();
                m.insert("kind".into(), json!(kind));
                m.insert("session_id".into(), json!(sid));
                m.insert("first_seen".into(), json!(t));
                m.insert("last_seen".into(), json!(t));
                m.insert("request_count".into(), json!(0));
                m.insert("error_count".into(), json!(0));
                m.insert("tokens_24h".into(), json!([0, 0, 0, 0]));
                m.insert("token_reports".into(), json!(0));
                m.insert("account_id".into(), Value::Null);
                m
            });
            s.insert("last_seen".into(), json!(t));
            sigs.entry(key.clone())
                .or_default()
                .insert(signal.to_string());

            if let Some(aid) = iobj
                .get("account_id")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
            {
                acct_ids
                    .entry(key.clone())
                    .or_default()
                    .insert(aid.to_string());
                let prio = if signal == "metrics" { 0 } else { 1 };
                let prev_prio = prio_map.get(&key).copied().unwrap_or(-1);
                if prio >= prev_prio {
                    let at = s.get("identity_at").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let cur_aid = s.get("account_id").and_then(|v| v.as_str());
                    if prio > prev_prio || t > at {
                        if cur_aid != Some(aid) {
                            s.insert("account_since".into(), json!(t));
                        }
                        s.insert("account_id".into(), json!(aid));
                        s.insert("identity_at".into(), json!(t));
                        prio_map.insert(key.clone(), prio);
                    } else if t == at && cur_aid != Some(aid) {
                        s.insert("account_id".into(), Value::Null);
                    }
                }
            }
            if signal != "metrics" {
                for field in [
                    "model",
                    "effort",
                    "parent_session_id",
                    "agent_id",
                    "parent_agent_id",
                    "duration_ms",
                    "ttft_ms",
                ] {
                    if let Some(v) = iobj.get(field).filter(|x| !x.is_null()) {
                        s.insert(field.into(), v.clone());
                        s.insert(format!("{field}_at"), json!(t));
                    }
                }
            }
            if signal == "logs" {
                if iobj.get("error").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let ec = s.get("error_count").and_then(|v| v.as_i64()).unwrap_or(0);
                    s.insert("error_count".into(), json!(ec + 1));
                }
                if let Some(toks) = iobj.get("tokens").and_then(|v| v.as_array()) {
                    if toks.len() == 4 {
                        let rc = s.get("request_count").and_then(|v| v.as_i64()).unwrap_or(0);
                        let tr = s.get("token_reports").and_then(|v| v.as_i64()).unwrap_or(0);
                        s.insert("request_count".into(), json!(rc + 1));
                        s.insert("token_reports".into(), json!(tr + 1));
                        let prev = s
                            .get("tokens_24h")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_else(|| vec![json!(0); 4]);
                        let next: Vec<i64> = (0..4)
                            .map(|i| prev[i].as_i64().unwrap_or(0) + toks[i].as_i64().unwrap_or(0))
                            .collect();
                        s.insert("tokens_24h".into(), json!(next));
                    }
                }
            }
        }

        let mut result: Vec<Map<String, Value>> = sessions
            .into_iter()
            .map(|(k, mut s)| {
                let sv: Vec<String> = sigs.remove(&k).unwrap_or_default().into_iter().collect();
                let av: Vec<String> = acct_ids
                    .remove(&k)
                    .unwrap_or_default()
                    .into_iter()
                    .collect();
                s.insert("signals".into(), json!(sv));
                s.insert("account_ids".into(), json!(av));
                if s.get("token_reports").and_then(|v| v.as_i64()).unwrap_or(0) == 0 {
                    s.insert("tokens_24h".into(), Value::Null);
                }
                s
            })
            .collect();
        result.sort_by(|a, b| {
            let la = a.get("last_seen").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let lb = b.get("last_seen").and_then(|v| v.as_f64()).unwrap_or(0.0);
            lb.partial_cmp(&la).unwrap_or(std::cmp::Ordering::Equal)
        });
        result.truncate(250);

        let mut out = Map::new();
        out.insert("transport".into(), json!("otlp/http"));
        out.insert("mode".into(), json!("supplement"));
        out.insert("usage_authority".into(), json!("jsonl"));
        out.insert("remote_export".into(), json!(false));
        out.insert("retention_days".into(), json!((RETENTION / 86400.0) as i64));
        for (k, v) in counters {
            out.insert(k, v);
        }
        out.insert(
            "sessions".into(),
            Value::Array(result.into_iter().map(Value::Object).collect()),
        );
        let snap = Value::Object(out);
        guard.cache = Some((now, snap.clone()));
        Ok(snap)
    }
}

pub fn session_index(snapshot: &Value) -> HashMap<(String, String), Map<String, Value>> {
    let mut out = HashMap::new();
    if let Some(arr) = snapshot.get("sessions").and_then(|v| v.as_array()) {
        for s in arr {
            if let Some(so) = s.as_object() {
                if let (Some(k), Some(sid)) = (
                    so.get("kind").and_then(|v| v.as_str()),
                    so.get("session_id").and_then(|v| v.as_str()),
                ) {
                    out.insert((k.to_string(), sid.to_string()), so.clone());
                }
            }
        }
    }
    out
}

pub fn bind_account(
    spec: &mut Map<String, Value>,
    index: &HashMap<(String, String), Map<String, Value>>,
    roots: &HashMap<PathBuf, crate::weekly_usage::ProfileRootBinding>,
) {
    let kind = spec
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sid = spec
        .get("active_session_id")
        .or_else(|| spec.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let Some(report) = index.get(&(kind.clone(), sid)) else {
        return;
    };
    let has_aids = report
        .get("account_ids")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    if !has_aids {
        return;
    }
    let mut known: HashSet<String> = roots
        .values()
        .filter(|(_, rk, _)| rk == &kind)
        .map(|(a, _, _)| a.clone())
        .collect();
    if spec.get("account_binding_source").and_then(|v| v.as_str())
        == Some("claude_statusline_session")
    {
        if let Some(a) = spec
            .get("account_binding")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
        {
            known.insert(a.to_string());
        }
    }
    let acct = report.get("account_id").and_then(|v| v.as_str());
    let binding = match acct {
        Some(a) if known.contains(a) => {
            let since = report
                .get("account_since")
                .cloned()
                .unwrap_or_else(|| json!(0));
            json!([a, since])
        }
        _ => Value::Null,
    };
    spec.insert("account_binding".into(), binding);
    spec.insert(
        "account_binding_source".into(),
        json!("otel_session_identity"),
    );
}

pub fn enrich(
    spec: &mut Map<String, Value>,
    index: &HashMap<(String, String), Map<String, Value>>,
) {
    let kind = spec
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sid = spec
        .get("active_session_id")
        .or_else(|| spec.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let Some(report) = index.get(&(kind, sid)) else {
        return;
    };
    spec.insert("telemetry".into(), Value::Object(report.clone()));
    if report
        .get("agent_id")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
    {
        return;
    }
    let model_at = report
        .get("model_at")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let cur_max = spec
        .get("model_updated")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
        .max(
            spec.get("last_usage")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
        );
    if let Some(rmodel) = report
        .get("model")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        if model_at > cur_max {
            if spec.get("model").and_then(|v| v.as_str()) != Some(rmodel) {
                spec.remove("effort");
                spec.remove("effort_source");
                spec.remove("effort_updated");
            }
            spec.insert("model".into(), json!(rmodel));
            spec.insert("model_updated".into(), json!(model_at));
        }
    }
    if let Some(reff) = report
        .get("effort")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        let rmodel = report.get("model").and_then(|v| v.as_str());
        let smodel = spec.get("model").and_then(|v| v.as_str());
        let eff_at = report
            .get("effort_at")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let cur_eff_max = spec
            .get("effort_updated")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
            .max(
                spec.get("model_updated")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0),
            );
        if rmodel == smodel && eff_at >= cur_eff_max {
            spec.insert("effort".into(), json!(reff));
            spec.insert("effort_updated".into(), json!(eff_at));
            spec.insert("effort_source".into(), json!("otel_request"));
        }
    }
}

pub fn receiver_key(directory: &Path) -> Result<String, &'static str> {
    let path = directory.join("telemetry-key");
    let _ = std::fs::create_dir_all(directory);
    if path.is_symlink() {
        return Err("symlink_telemetry_key");
    }
    if !path.exists() {
        let mut raw = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut raw);
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
        let opts = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path);
        if let Ok(mut f) = opts {
            use std::io::Write;
            let _ = f.write_all(token.as_bytes());
        }
    }
    let val = std::fs::read_to_string(&path)
        .map_err(|_| "invalid_telemetry_key")?
        .trim()
        .to_string();
    if !key_re().is_match(&val) {
        return Err("invalid_telemetry_key");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(val)
}

// ---------------- telemetry_setup ----------------

fn write_private_text(path: &Path, data: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    std::fs::write(&tmp, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn telemetry_enable(
    directory: Option<&Path>,
    profiles: &[(String, PathBuf)],
    port: u16,
) -> Result<Value, String> {
    if port == 0 {
        return Err("Invalid local port".into());
    }
    let dir = directory
        .map(Path::to_path_buf)
        .unwrap_or_else(|| data_directory(None));
    let key = receiver_key(&dir).map_err(|e| e.to_string())?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let manifest_path = dir.join("telemetry-enrollment.json");
    let mut manifest: Value = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({"profiles": []}));
    let mut managed: HashMap<String, Value> = HashMap::new();
    if let Some(arr) = manifest.get("profiles").and_then(|v| v.as_array()) {
        for p in arr {
            if let Some(ps) = p.get("path").and_then(|v| v.as_str()) {
                managed.insert(ps.to_string(), p.clone());
            }
        }
    }

    let mut output = Vec::new();
    for (kind, root) in profiles {
        if kind != "Claude" && kind != "Codex" {
            continue;
        }
        let path = root.join(if kind == "Claude" {
            "settings.json"
        } else {
            "config.toml"
        });
        let path_str = path.to_string_lossy().into_owned();
        if path.is_symlink() {
            output.push(json!({"provider": kind, "path": path_str, "status": "skipped_symlink"}));
            continue;
        }
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        if let Some(prev) = managed.get(&path_str) {
            let current = if kind == "Claude" {
                let cfg = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
                let env = cfg.get("env").and_then(|v| v.as_object());
                prev.get("env")
                    .and_then(|v| v.as_object())
                    .is_some_and(|penv| {
                        penv.iter()
                            .all(|(k, v)| env.and_then(|e| e.get(k)) == Some(v))
                    })
            } else {
                prev.get("block")
                    .and_then(|v| v.as_str())
                    .is_some_and(|b| raw.contains(b))
            };
            output.push(json!({
                "provider": kind,
                "path": path_str,
                "status": if current { "already_enrolled" } else { "modified_configuration_preserved" }
            }));
            continue;
        }

        let (updated, mut entry) = if kind == "Claude" {
            let mut config: Map<String, Value> = if raw.trim().is_empty() {
                Map::new()
            } else {
                serde_json::from_str::<Value>(&raw)
                    .ok()
                    .and_then(|v| v.as_object().cloned())
                    .unwrap_or_default()
            };
            let env_val = config.get("env").cloned().unwrap_or_else(|| json!({}));
            let Some(mut env) = env_val.as_object().cloned() else {
                output.push(
                    json!({"provider": kind, "path": path_str, "status": "invalid_environment"}),
                );
                continue;
            };
            if env
                .keys()
                .any(|k| k.starts_with("OTEL_") || k == "CLAUDE_CODE_ENABLE_TELEMETRY")
            {
                output.push(json!({
                    "provider": kind,
                    "path": path_str,
                    "status": "existing_telemetry_preserved"
                }));
                continue;
            }
            let additions = json!({
                "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
                "OTEL_METRICS_EXPORTER": "otlp",
                "OTEL_LOGS_EXPORTER": "otlp",
                "OTEL_TRACES_EXPORTER": "none",
                "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
                "OTEL_EXPORTER_OTLP_ENDPOINT": endpoint,
                "OTEL_EXPORTER_OTLP_HEADERS": format!("X-1top-Telemetry-Key={key}"),
                "OTEL_METRIC_EXPORT_INTERVAL": "10000",
                "OTEL_LOGS_EXPORT_INTERVAL": "1000",
                "OTEL_LOG_USER_PROMPTS": "0",
                "OTEL_LOG_ASSISTANT_RESPONSES": "0",
                "OTEL_LOG_TOOL_DETAILS": "0",
                "OTEL_METRICS_INCLUDE_SESSION_ID": "true",
                "OTEL_METRICS_INCLUDE_ACCOUNT_UUID": "true"
            });
            for (k, v) in additions.as_object().unwrap() {
                env.insert(k.clone(), v.clone());
            }
            config.insert("env".into(), Value::Object(env));
            let text = format!(
                "{}\n",
                serde_json::to_string_pretty(&Value::Object(config)).unwrap_or_default()
            );
            (
                text,
                json!({"kind": kind, "path": path_str, "env": additions}),
            )
        } else {
            let parsed: toml::Table = raw.parse().map_err(|e: toml::de::Error| e.to_string())?;
            if parsed.contains_key("otel") {
                output.push(json!({
                    "provider": kind,
                    "path": path_str,
                    "status": "existing_telemetry_preserved"
                }));
                continue;
            }
            let make_exp = |suffix: &str| {
                let ep = serde_json::to_string(&format!("{endpoint}{suffix}")).unwrap();
                let kq = serde_json::to_string(&key).unwrap();
                format!(
                    "{{ otlp-http = {{ endpoint = {ep}, protocol = \"json\", headers = {{ \"X-1top-Telemetry-Key\" = {kq} }} }} }}"
                )
            };
            let block = format!(
                "\n{BEGIN_MARKER}\n[otel]\nlog_user_prompt = false\nexporter = {}\nmetrics_exporter = {}\n{END_MARKER}\n",
                make_exp("/v1/logs"),
                make_exp("/v1/metrics")
            );
            let text = format!("{}\n{block}", raw.trim_end());
            let _: toml::Table = text.parse().map_err(|e: toml::de::Error| e.to_string())?;
            (
                text,
                json!({"kind": kind, "path": path_str, "block": block}),
            )
        };

        let ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let backup = dir
            .join("telemetry-backups")
            .join(ns.to_string())
            .join(path.file_name().unwrap());
        write_private_text(&backup, &raw).map_err(|e| e.to_string())?;
        let backup_str = backup.to_string_lossy().into_owned();
        if let Some(eo) = entry.as_object_mut() {
            eo.insert("backup".into(), json!(backup_str));
        }
        if let Some(arr) = manifest.get_mut("profiles").and_then(|v| v.as_array_mut()) {
            arr.push(entry);
        }
        let mtext = serde_json::to_string_pretty(&manifest).unwrap_or_default();
        write_private_text(&manifest_path, &mtext).map_err(|e| e.to_string())?;
        write_private_text(&path, &updated).map_err(|e| e.to_string())?;
        output.push(json!({
            "provider": kind,
            "path": path_str,
            "status": "enabled",
            "backup": backup_str
        }));
    }
    Ok(json!({
        "endpoint": endpoint,
        "profiles": output,
        "restart_required": true,
        "message": "Existing AI sessions were not restarted. New sessions load the exporter settings."
    }))
}

pub fn telemetry_disable(directory: Option<&Path>) -> Result<Value, String> {
    let dir = directory
        .map(Path::to_path_buf)
        .unwrap_or_else(|| data_directory(None));
    let mpath = dir.join("telemetry-enrollment.json");
    if !mpath.exists() {
        return Ok(json!({"profiles": []}));
    }
    let manifest: Value = std::fs::read_to_string(&mpath)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({"profiles": []}));
    let mut output = Vec::new();
    let mut retained = Vec::new();
    if let Some(entries) = manifest.get("profiles").and_then(|v| v.as_array()) {
        for entry in entries {
            let pstr = entry.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let target = Path::new(pstr);
            if !target.exists() || target.is_symlink() {
                retained.push(entry.clone());
                output.push(json!({"path": pstr, "status": "unchanged"}));
                continue;
            }
            let raw = std::fs::read_to_string(target).unwrap_or_default();
            let updated = if entry.get("kind").and_then(|v| v.as_str()) == Some("Claude") {
                let mut cfg: Map<String, Value> = serde_json::from_str::<Value>(&raw)
                    .ok()
                    .and_then(|v| v.as_object().cloned())
                    .unwrap_or_default();
                if let Some(env) = cfg.get_mut("env").and_then(|v| v.as_object_mut()) {
                    if let Some(added) = entry.get("env").and_then(|v| v.as_object()) {
                        for (k, v) in added {
                            if env.get(k) == Some(v) {
                                env.remove(k);
                            }
                        }
                    }
                    if env.is_empty() {
                        cfg.remove("env");
                    }
                }
                format!(
                    "{}\n",
                    serde_json::to_string_pretty(&Value::Object(cfg)).unwrap_or_default()
                )
            } else {
                let block = entry.get("block").and_then(|v| v.as_str()).unwrap_or("");
                if !raw.contains(block) {
                    retained.push(entry.clone());
                    output
                        .push(json!({"path": pstr, "status": "modified_configuration_preserved"}));
                    continue;
                }
                let next = raw.replacen(block, "", 1);
                let _: toml::Table = next.parse().map_err(|e: toml::de::Error| e.to_string())?;
                next
            };
            write_private_text(target, &updated).map_err(|e| e.to_string())?;
            output.push(json!({"path": pstr, "status": "disabled"}));
        }
    }
    let mtext = serde_json::to_string_pretty(&json!({"profiles": retained})).unwrap_or_default();
    write_private_text(&mpath, &mtext).map_err(|e| e.to_string())?;
    Ok(json!({"profiles": output, "restart_required": true}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otlp_json_ingest_and_snapshot() {
        let td = tempfile::tempdir().unwrap();
        let store = TelemetryStore::new(td.path()).unwrap();
        let now = 1795600000.0;
        let payload = json!({
            "resourceLogs": [{
                "resource": {"attributes": [{"key": "service.name", "value": {"stringValue": "claude-code"}}]},
                "scopeLogs": [{
                    "logRecords": [{
                        "timeUnixNano": ((now - 5.0) * 1e9) as u64,
                        "eventName": "claude_code.api_request",
                        "attributes": [
                            {"key": "session.id", "value": {"stringValue": "sess-abc"}},
                            {"key": "model", "value": {"stringValue": "claude-opus-5-5"}},
                            {"key": "input_tokens", "value": {"intValue": "100"}},
                            {"key": "output_tokens", "value": {"intValue": "25"}}
                        ]
                    }]
                }]
            }]
        });
        let res = store.ingest("logs", &payload, Some(now)).unwrap();
        assert_eq!(res["accepted"], 1);
        let snap = store.snapshot(Some(now)).unwrap();
        let sessions = snap["sessions"].as_array().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0]["tokens_24h"], json!([100, 0, 0, 25]));
    }
}
