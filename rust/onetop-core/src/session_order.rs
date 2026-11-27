use serde_json::{Map, Value};
use std::cmp::Ordering;

fn sort_key(row: &Value, period: &str) -> (bool, f64, String) {
    let obj = row.as_object();
    let children_working = obj
        .and_then(|m| m.get("children_working"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let status = obj
        .and_then(|m| {
            m.get("display_status")
                .filter(|v| !v.is_null())
                .or_else(|| m.get("status"))
        })
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let working = children_working > 0.0 || status == "working";

    let mut amount = -1.0_f64;
    if let Some(arr) = obj
        .and_then(|m| m.get("usage"))
        .and_then(|u| u.get("windows"))
        .and_then(|w| w.get(period))
        .and_then(|p| p.as_array())
    {
        if !arr.is_empty() {
            let mut sum = 0.0_f64;
            let mut valid = true;
            for item in arr {
                match item.as_f64() {
                    Some(n) if n.is_finite() && n >= 0.0 => sum += n,
                    _ => {
                        valid = false;
                        break;
                    }
                }
            }
            if valid && sum.is_finite() {
                amount = sum;
            }
        }
    }

    let id = obj
        .and_then(|m| m.get("id"))
        .map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        })
        .unwrap_or_default();

    (!working, -amount, id)
}

/// Exact port of `session_order.py:ordered_snapshot`.
pub fn ordered_snapshot(snapshot: &Map<String, Value>, period: &str) -> Map<String, Value> {
    let mut out = snapshot.clone();
    for key in ["sessions", "root_sessions"] {
        if let Some(Value::Array(items)) = snapshot.get(key) {
            let mut sorted = items.clone();
            sorted.sort_by(|a, b| {
                let ka = sort_key(a, period);
                let kb = sort_key(b, period);
                ka.0.cmp(&kb.0)
                    .then_with(|| ka.1.partial_cmp(&kb.1).unwrap_or(Ordering::Equal))
                    .then_with(|| ka.2.cmp(&kb.2))
            });
            out.insert(key.to_string(), Value::Array(sorted));
        }
    }
    out
}
