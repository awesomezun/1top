use crate::text::truncate_chars;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const TAIL: u64 = 262_144;
pub const LIMIT: u64 = 64 * 1024 * 1024;
pub const RECENT: usize = 200;

const LOCAL_PREFIXES: &[&str] = &[
    "<command-name>",
    "<local-command-",
    "<bash-input>",
    "<bash-stdout>",
    "<bash-stderr>",
];
const INTERRUPT_PREFIX: &str = "[Request interrupted by user";

/// Exact port of `observe/transcripts.py:opening`.
pub fn opening(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => truncate_chars(s.trim_start(), 40),
        Some(serde_json::Value::Array(items)) => {
            for item in items {
                if let Some(obj) = item.as_object() {
                    if obj.get("type").and_then(|v| v.as_str()) == Some("text") {
                        let text = match obj.get("text") {
                            Some(serde_json::Value::String(s)) => s.clone(),
                            Some(serde_json::Value::Null) | None => String::new(),
                            Some(other) => other.to_string(),
                        };
                        return truncate_chars(text.trim_start(), 40);
                    }
                }
            }
            String::new()
        }
        _ => String::new(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranscriptFact(pub BTreeMap<String, serde_json::Value>);

/// Exact port of `observe/transcripts.py:fact`.
pub fn extract_fact(
    row: &serde_json::Map<String, serde_json::Value>,
) -> BTreeMap<String, serde_json::Value> {
    let message = row.get("message").and_then(|v| v.as_object());
    let raw = message.and_then(|m| m.get("content"));
    let content = raw.and_then(|v| v.as_array());
    let payload = row.get("payload").and_then(|v| v.as_object());
    let row_type = row.get("type");
    let head = if row_type.and_then(|v| v.as_str()) == Some("user") {
        opening(raw)
    } else {
        String::new()
    };

    let mut out = BTreeMap::new();
    let mut insert_non_null = |k: &str, v: Option<&serde_json::Value>| {
        if let Some(val) = v {
            if !val.is_null() {
                out.insert(k.to_string(), val.clone());
            }
        }
    };

    insert_non_null("t", row.get("timestamp"));
    insert_non_null("type", row_type);
    insert_non_null("subtype", row.get("subtype"));
    insert_non_null("stop", message.and_then(|m| m.get("stop_reason")));
    insert_non_null("sidechain", row.get("isSidechain"));
    insert_non_null("payload", payload.and_then(|p| p.get("type")));

    let is_meta = is_truthy(row.get("isMeta")) || is_truthy(row.get("isCompactSummary"));
    if is_meta {
        out.insert("meta".to_string(), serde_json::Value::Bool(true));
    }
    if LOCAL_PREFIXES.iter().any(|p| head.starts_with(p)) {
        out.insert("local".to_string(), serde_json::Value::Bool(true));
    }
    if head.starts_with(INTERRUPT_PREFIX) {
        out.insert("interrupt".to_string(), serde_json::Value::Bool(true));
    }
    if let Some(arr) = content {
        let has_tool_use = arr.iter().any(|x| {
            x.as_object()
                .and_then(|o| o.get("type"))
                .and_then(|v| v.as_str())
                == Some("tool_use")
        });
        if has_tool_use {
            out.insert("tool_use".to_string(), serde_json::Value::Bool(true));
        }
        let has_tool_result = arr.iter().any(|x| {
            x.as_object()
                .and_then(|o| o.get("type"))
                .and_then(|v| v.as_str())
                == Some("tool_result")
        });
        if has_tool_result {
            out.insert("tool_result".to_string(), serde_json::Value::Bool(true));
        }
    }
    out
}

fn is_truthy(v: Option<&serde_json::Value>) -> bool {
    match v {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(serde_json::Value::String(s)) => !s.is_empty(),
        Some(serde_json::Value::Array(a)) => !a.is_empty(),
        Some(serde_json::Value::Object(m)) => !m.is_empty(),
    }
}

/// Exact port of `observe/transcripts.py:boundary`.
pub fn boundary(event: &BTreeMap<String, serde_json::Value>) -> Option<&'static str> {
    if is_truthy(event.get("sidechain")) {
        return None;
    }
    let typ = event.get("type").and_then(|v| v.as_str());
    let sub = event.get("subtype").and_then(|v| v.as_str());
    let payload = event.get("payload").and_then(|v| v.as_str());
    let stop = event.get("stop").and_then(|v| v.as_str());

    if is_truthy(event.get("interrupt")) || payload == Some("turn_aborted") {
        return Some("interrupt");
    }
    if matches!(sub, Some("turn_duration" | "stop_hook_summary"))
        || stop == Some("end_turn")
        || matches!(payload, Some("task_complete" | "turn_complete"))
    {
        return Some("end");
    }
    if (typ == Some("user") && !(is_truthy(event.get("meta")) || is_truthy(event.get("local"))))
        || matches!(typ, Some("api-request" | "queued-message"))
        || matches!(payload, Some("task_started" | "user_message"))
    {
        return Some("start");
    }
    None
}

/// Exact port of `observe/transcripts.py:facts`.
pub fn parse_facts(raw: &[u8]) -> Vec<BTreeMap<String, serde_json::Value>> {
    let mut events = Vec::new();
    for line in raw.split(|&b| b == b'\n') {
        if line.is_empty() {
            continue;
        }
        if let Ok(serde_json::Value::Object(map)) =
            serde_json::from_slice::<serde_json::Value>(line)
        {
            events.push(extract_fact(&map));
        }
    }
    events
}

/// Exact port of `observe/transcripts.py:latest`.
pub fn latest_events(
    events: Vec<BTreeMap<String, serde_json::Value>>,
) -> Vec<BTreeMap<String, serde_json::Value>> {
    let mut kept: BTreeMap<String, usize> = BTreeMap::new();
    let mut keys: Vec<String> = Vec::with_capacity(events.len());
    for (index, event) in events.iter().enumerate() {
        let mut sig = BTreeMap::new();
        for (k, v) in event {
            if k != "t" {
                sig.insert(k.as_str(), v);
            }
        }
        let key = serde_json::to_string(&sig).unwrap_or_default();
        kept.insert(key.clone(), index);
        keys.push(key);
    }
    let recent = events.len().saturating_sub(RECENT);
    events
        .into_iter()
        .enumerate()
        .filter(|(i, _)| *i >= recent || kept.get(&keys[*i]).copied() == Some(*i))
        .map(|(_, e)| e)
        .collect()
}

pub struct TailTranscript {
    pub events: Vec<BTreeMap<String, serde_json::Value>>,
}

pub fn read_tail(path: &std::path::Path) -> Option<TailTranscript> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let size = file.seek(SeekFrom::End(0)).ok()?;
    let start = size.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut raw = Vec::new();
    file.take(TAIL).read_to_end(&mut raw).ok()?;
    let slice = if start > 0 {
        raw.iter()
            .position(|&b| b == b'\n')
            .map(|i| &raw[i + 1..])
            .unwrap_or(&[])
    } else {
        &raw
    };
    let complete = slice
        .iter()
        .rposition(|&b| b == b'\n')
        .map(|i| &slice[..=i])
        .unwrap_or(&[]);
    Some(TailTranscript {
        events: latest_events(parse_facts(complete)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_user_and_assistant_boundaries() {
        let raw = concat!(
            "{\"type\":\"user\",\"timestamp\":1,\"message\":{\"content\":\"hello\"}}\n",
            "{\"type\":\"assistant\",\"timestamp\":2,\"message\":{\"stop_reason\":\"end_turn\",\"content\":[{\"type\":\"tool_use\"}]}}\n",
            "not json\n"
        );
        let evs = parse_facts(raw.as_bytes());
        assert_eq!(evs.len(), 2);
        assert_eq!(boundary(&evs[0]), Some("start"));
        assert_eq!(boundary(&evs[1]), Some("end"));
        assert_eq!(evs[1].get("tool_use"), Some(&serde_json::Value::Bool(true)));
    }
}
