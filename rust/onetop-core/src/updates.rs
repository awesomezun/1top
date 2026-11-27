//! Exact port of `updates.py`.
use crate::APP_VERSION;
use regex::Regex;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const FEED: &str = "https://1top.si/release.json";
pub const RELEASES: &str = "https://github.com/awesomezun/1top/releases/tag/v";

fn version_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d+\.\d+\.\d+$").unwrap())
}

fn parse_semver(v: &str) -> Option<(u32, u32, u32)> {
    if !version_re().is_match(v) {
        return None;
    }
    let mut parts = v.split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn release_info(value: &Value, current: &str) -> Result<Value, &'static str> {
    let ver = value
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or("Invalid release version")?;
    let v_tup = parse_semver(ver).ok_or("Invalid release version")?;
    let cur_tup = parse_semver(current).unwrap_or((0, 0, 0));
    let verified = value.get("signed").and_then(|v| v.as_bool()) == Some(true)
        && value.get("notarized").and_then(|v| v.as_bool()) == Some(true);
    Ok(json!({
        "version": ver,
        "current": current,
        "available": v_tup > cur_tup,
        "release_url": format!("{RELEASES}{ver}"),
        "status": if verified { "verified" } else { "preview" },
        "automatic_install": false,
        "checked": now_epoch()
    }))
}

#[derive(Clone)]
pub struct UpdateMonitor {
    state: Arc<Mutex<Value>>,
}

impl Default for UpdateMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl UpdateMonitor {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(json!({
                "current": APP_VERSION,
                "available": false,
                "checked": Value::Null,
                "automatic_install": false
            }))),
        }
    }

    pub fn value(&self) -> Value {
        self.state
            .lock()
            .map(|v| v.clone())
            .unwrap_or_else(|_| json!({}))
    }

    pub fn check_blocking(&self) {
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build();
        let res = client.ok().and_then(|c| {
            let resp = c
                .get(FEED)
                .header("User-Agent", format!("1top/{APP_VERSION}"))
                .send()
                .ok()?;
            let bytes = resp.bytes().ok()?;
            if bytes.len() > 65536 {
                return None;
            }
            let val: Value = serde_json::from_slice(&bytes).ok()?;
            release_info(&val, APP_VERSION).ok()
        });
        if let Ok(mut guard) = self.state.lock() {
            if let Some(info) = res {
                *guard = info;
            } else if let Some(obj) = guard.as_object_mut() {
                obj.insert(
                    "error".into(),
                    json!("Update check unavailable. Your installed app continues to work."),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_version_compare() {
        let info = release_info(
            &json!({"version": "5.1.0", "signed": true, "notarized": true}),
            "5.0.0",
        )
        .unwrap();
        assert_eq!(info["available"], true);
        assert_eq!(info["status"], "verified");
    }
}
