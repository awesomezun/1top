use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FailureDecision {
    pub retry: bool,
    pub reason: String,
    pub until: f64,
}

fn finite_num(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64()).filter(|f| f.is_finite())
}

/// Exact port of `routing_policy.py:quota_deadline`.
pub fn quota_deadline(account: &Value, model: &str, now: f64, threshold: f64) -> Option<f64> {
    let obj = account.as_object()?;
    if obj.get("stale").and_then(|v| v.as_bool()).unwrap_or(false) {
        return None;
    }
    let windows = obj.get("windows").and_then(|v| v.as_array())?;
    let mut best: Option<f64> = None;
    for window in windows {
        let Some(w) = window.as_object() else {
            continue;
        };
        if w.get("scope").and_then(|v| v.as_str()) == Some("mcp") {
            continue;
        }
        match w.get("model") {
            None | Some(Value::Null) => {}
            Some(Value::String(m)) if m == model => {}
            _ => continue,
        }
        let reset = finite_num(w.get("reset"));
        if let Some(r) = reset {
            if r > 0.0 && r <= now {
                continue;
            }
        }
        if let Some(pct) = finite_num(w.get("pct")) {
            if pct >= threshold {
                let d = match reset {
                    Some(r) if r > now => r,
                    _ => now + 120.0,
                };
                best = Some(match best {
                    Some(prev) => prev.max(d),
                    None => d,
                });
            }
        }
    }
    best
}

/// Exact port of `routing_policy.py:retry_seconds`.
pub fn retry_seconds(value: Option<&str>, now: f64, default: f64) -> f64 {
    let Some(raw) = value else {
        return default;
    };
    let parsed = raw
        .trim()
        .parse::<f64>()
        .ok()
        .or_else(|| {
            httpdate::parse_http_date(raw.trim())
                .ok()
                .and_then(|st| st.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64() - now)
        })
        .unwrap_or(default);
    if parsed.is_finite() {
        parsed.clamp(1.0, 7.0 * 86400.0)
    } else {
        default
    }
}

/// Exact port of `routing_policy.py:failure_policy`.
pub fn failure_policy(
    status: u16,
    headers: &BTreeMap<String, String>,
    payload: &Value,
    now: f64,
) -> FailureDecision {
    let lower_headers: HashMap<String, &str> = headers
        .iter()
        .map(|(k, v)| (k.to_lowercase(), v.as_str()))
        .collect();
    let error = payload
        .as_object()
        .and_then(|m| m.get("error"))
        .and_then(|v| v.as_object());
    let code = error
        .and_then(|e| e.get("code").or_else(|| e.get("type")))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let message = match payload.as_object().and_then(|m| m.get("error")) {
        Some(Value::Object(e)) => e
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase(),
        Some(other) if !other.is_null() => other.to_string().to_lowercase(),
        _ => String::new(),
    };

    if status == 401 || status == 403 {
        return FailureDecision {
            retry: true,
            reason: "authentication".into(),
            until: now + 120.0,
        };
    }
    if status == 429 {
        let combined = format!("{code} {message}");
        let exhausted = [
            "quota_exceeded",
            "usage_limit_reached",
            "insufficient_quota",
            "weekly limit",
            "usage limit reached",
            "credit balance",
        ]
        .iter()
        .any(|m| combined.contains(m));
        let mut delay = retry_seconds(
            lower_headers.get("retry-after").copied(),
            now,
            if exhausted { 300.0 } else { 30.0 },
        );
        let reset =
            error.and_then(|e| finite_num(e.get("resets_at").or_else(|| e.get("reset_at"))));
        if exhausted {
            if let Some(r) = reset {
                if r > now {
                    delay = delay.max(r - now);
                }
            }
        }
        return FailureDecision {
            retry: true,
            reason: if exhausted { "quota" } else { "rate_limit" }.into(),
            until: now + delay,
        };
    }
    if matches!(status, 500 | 502 | 503 | 504) {
        return FailureDecision {
            retry: true,
            reason: "temporary".into(),
            until: now + retry_seconds(lower_headers.get("retry-after").copied(), now, 10.0),
        };
    }
    FailureDecision {
        retry: false,
        reason: "request".into(),
        until: now,
    }
}

/// Exact port of `routing_policy.py:choose`.
#[allow(clippy::too_many_arguments)]
pub fn choose<'a>(
    accounts: &'a [Value],
    provider: &str,
    model: &str,
    now: f64,
    excluded: &HashSet<String>,
    cooldowns: &HashMap<(String, String), f64>,
    preferred: Option<&str>,
    priority: &[String],
    threshold: f64,
) -> (Option<&'a Value>, Option<f64>) {
    let order: HashMap<&str, usize> = priority
        .iter()
        .enumerate()
        .map(|(i, id)| (id.as_str(), i))
        .collect();
    let mut eligible: Vec<(&'a Value, String)> = Vec::new();
    let mut retry_at: Option<f64> = None;

    for account in accounts {
        let Some(obj) = account.as_object() else {
            continue;
        };
        if obj.get("kind").and_then(|v| v.as_str()) != Some(provider) {
            continue;
        }
        let Some(id) = obj.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        if excluded.contains(id) {
            continue;
        }
        let c_model = cooldowns
            .get(&(id.to_string(), model.to_string()))
            .copied()
            .unwrap_or(0.0);
        let c_any = cooldowns
            .get(&(id.to_string(), "*".to_string()))
            .copied()
            .unwrap_or(0.0);
        let q = quota_deadline(account, model, now, threshold).unwrap_or(0.0);
        let deadline = c_model.max(c_any).max(q);
        if deadline > now {
            retry_at = Some(match retry_at {
                Some(prev) => prev.min(deadline),
                None => deadline,
            });
            continue;
        }
        eligible.push((account, id.to_string()));
    }

    let order_len = order.len();
    eligible.sort_by(|(_, a), (_, b)| {
        let a_not_pref = Some(a.as_str()) != preferred;
        let b_not_pref = Some(b.as_str()) != preferred;
        let a_ord = order.get(a.as_str()).copied().unwrap_or(order_len);
        let b_ord = order.get(b.as_str()).copied().unwrap_or(order_len);
        a_not_pref
            .cmp(&b_not_pref)
            .then_with(|| a_ord.cmp(&b_ord))
            .then_with(|| a.cmp(b))
    });

    (eligible.first().map(|(a, _)| *a), retry_at)
}
