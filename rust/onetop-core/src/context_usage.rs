use crate::text::truncate_chars;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextSnapshot {
    pub basis: String,
    pub input_tokens: f64,
    pub capacity: Option<f64>,
    pub parts: Option<[f64; 3]>,
    pub observed_at: f64,
    pub model: String,
}

fn non_neg_finite(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => {
            let f = n.as_f64()?;
            if f.is_finite() && f >= 0.0 {
                Some(f)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Exact port of `context_usage.py:request_context`.
pub fn request_context(
    usage: &Map<String, Value>,
    observed_at: Option<f64>,
    model: &str,
    capacity: Option<f64>,
    codex: bool,
) -> Option<ContextSnapshot> {
    let mut used = non_neg_finite(usage.get("input_tokens"))?;
    let cached_key = if codex {
        "cached_input_tokens"
    } else {
        "cache_read_input_tokens"
    };
    let written_key = if codex {
        "cache_write_input_tokens"
    } else {
        "cache_creation_input_tokens"
    };
    let cached = match usage.get(cached_key) {
        None => 0.0,
        Some(v) => non_neg_finite(Some(v))?,
    };
    let written = match usage.get(written_key) {
        None => 0.0,
        Some(v) => non_neg_finite(Some(v))?,
    };

    let parts = if codex {
        if cached > used || written > used - cached {
            return None;
        }
        [used - cached - written, cached, written]
    } else {
        let p = [used, cached, written];
        used = p[0] + p[1] + p[2];
        p
    };

    let cap = capacity.filter(|c| c.is_finite() && *c > 0.0);
    let obs = observed_at
        .filter(|t| t.is_finite() && *t >= 0.0)
        .unwrap_or(0.0);

    Some(ContextSnapshot {
        basis: "last_request_input".to_string(),
        input_tokens: used,
        capacity: cap,
        parts: Some(parts),
        observed_at: obs,
        model: truncate_chars(model, 80),
    })
}
