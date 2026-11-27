//! Complete port of `bridge.py` snapshot/flow/report export, relay pairing, receipts, and workspace usage.
use crate::controls::{accepts_instruction, accepts_message, mailbox_readable};
use crate::usage::{
    host_metrics, period_metrics, select_keys, session_identity, system_metrics, CALIBRATION_KEYS,
    WINDOWS,
};
use crate::APP_VERSION;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use url::Url;

pub const RELAY: &str = "https://onetop-relay.gitreels.workers.dev";
pub const SEND_SECS: u64 = 30;

const REPORT_VALUE_KEYS: [&str; 11] = [
    "month",
    "start",
    "end",
    "currency",
    "prices_as_of",
    "plan_total",
    "api_value",
    "ratio",
    "api_billed",
    "unpriced",
    "excluded",
];

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("/usr/bin/open").arg(url).status();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd.exe")
            .args(["/c", "start", "", url])
            .status();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = Command::new("xdg-open").arg(url).status();
    }
}

pub fn relay_origin(value: &str) -> Result<String, &'static str> {
    let parsed = Url::parse(value)
        .map_err(|_| "Use the HTTPS origin of your relay, without a path or credentials.")?;
    let Some(host) = parsed.host_str() else {
        return Err("Use the HTTPS origin of your relay, without a path or credentials.");
    };
    if parsed.scheme() != "https"
        || !host.contains('.')
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
        || !matches!(parsed.port(), None | Some(443))
    {
        return Err("Use the HTTPS origin of your relay, without a path or credentials.");
    }
    Ok(format!("https://{}", host.to_lowercase()))
}

pub fn save_private_json(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string(value).unwrap_or_default())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn report_interval(value: Option<&Value>) -> u64 {
    let Some(v) = value else {
        return 60;
    };
    if v.is_boolean() {
        return 60;
    }
    if let Some(f) = v.as_f64() {
        if !f.is_finite() {
            return 60;
        }
        if f == 3.0 {
            return 3;
        }
        return f.clamp(60.0, 600.0) as u64;
    }
    60
}

pub fn export_flow(state: &Map<String, Value>) -> Map<String, Value> {
    let mut result = Map::new();
    let Some(now) = state
        .get("updated")
        .and_then(|v| v.as_f64())
        .filter(|x| x.is_finite())
    else {
        return result;
    };
    let finish = (now / 60.0).floor() * 60.0 + 60.0;
    let events = state.get("events").and_then(|v| v.as_array());
    for &(key, _, seconds) in &WINDOWS {
        let step = if seconds > 18000 {
            900
        } else if seconds > 3600 {
            300
        } else {
            60
        };
        let start = finish - seconds as f64;
        let bin_count = (seconds / step) as usize;
        let mut bins: Vec<BTreeMap<String, f64>> = vec![BTreeMap::new(); bin_count];
        if let Some(evs) = events {
            for ev in evs {
                let Some(t) = ev.get("t").and_then(|v| v.as_f64()) else {
                    continue;
                };
                if !t.is_finite() || t < start || t >= finish || t > now {
                    continue;
                }
                let mut vals = [0.0_f64; 4];
                let mut ok = true;
                for (i, k) in ["fresh", "cached", "written", "output"].iter().enumerate() {
                    let v = ev.get(*k).and_then(|x| x.as_f64()).unwrap_or(0.0);
                    if !v.is_finite() || v < 0.0 {
                        ok = false;
                        break;
                    }
                    vals[i] = v;
                }
                if !ok {
                    continue;
                }
                let kind = ev.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown");
                let total: f64 = vals.iter().sum();
                let idx = (((t - start) / step as f64).floor() as usize).min(bin_count - 1);
                *bins[idx].entry(kind.to_string()).or_insert(0.0) += total;
            }
        }
        result.insert(
            key.to_string(),
            json!({
                "step": step,
                "start": start,
                "end": finish,
                "as_of": now,
                "reported": events.is_some(),
                "bins": bins
            }),
        );
    }
    result
}

pub fn export_weekly(usage: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(we) = usage.get("weekly_estimate").and_then(|v| v.as_object()) else {
        return out;
    };
    for (k, v) in we {
        let Some(vo) = v.as_object() else {
            continue;
        };
        let mut est = select_keys(
            Some(v),
            &[
                "used_pp",
                "partial",
                "period_seconds",
                "tokens",
                "account_id",
            ],
        );
        if let Some(cal) = vo.get("calibration").filter(|c| c.is_object()) {
            est.insert(
                "calibration".into(),
                Value::Object(select_keys(Some(cal), &CALIBRATION_KEYS)),
            );
        }
        out.insert(k.clone(), Value::Object(est));
    }
    out
}

pub fn export_reports(report: Option<&Value>) -> Value {
    let Some(ro) = report.and_then(|v| v.as_object()) else {
        return Value::Null;
    };
    let mut out = Map::new();
    out.insert("version".into(), json!(1));
    out.insert(
        "as_of".into(),
        ro.get("as_of").cloned().unwrap_or(Value::Null),
    );
    if let Some(v) = ro.get("value").filter(|x| x.is_object()) {
        let mut vm = select_keys(Some(v), &REPORT_VALUE_KEYS);
        let map_arr = |field: &str, limit: usize, keys: &[&str]| -> Value {
            let items: Vec<Value> = v
                .get(field)
                .and_then(|x| x.as_array())
                .map(|arr| {
                    arr.iter()
                        .take(limit)
                        .map(|item| Value::Object(select_keys(Some(item), keys)))
                        .collect()
                })
                .unwrap_or_default();
            Value::Array(items)
        };
        vm.insert(
            "plans".into(),
            map_arr(
                "plans",
                24,
                &["account_id", "kind", "plan", "label", "price", "source"],
            ),
        );
        vm.insert(
            "by_kind".into(),
            map_arr("by_kind", 12, &["kind", "api_value", "plan_total", "ratio"]),
        );
        vm.insert(
            "by_model".into(),
            map_arr("by_model", 24, &["model", "kind", "api_value", "tokens"]),
        );
        vm.insert(
            "months".into(),
            map_arr("months", 6, &["month", "api_value", "plan_total"]),
        );
        out.insert("value".into(), Value::Object(vm));
    }
    if let Some(w) = ro.get("weekly").filter(|x| x.is_object()) {
        let mut wm = select_keys(
            Some(w),
            &[
                "start",
                "end",
                "since",
                "working_s",
                "waiting_s",
                "previous",
                "longest_wait",
            ],
        );
        let days: Vec<Value> = w
            .get("days")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .take(7)
                    .map(|d| {
                        Value::Object(select_keys(Some(d), &["date", "working_s", "waiting_s"]))
                    })
                    .collect()
            })
            .unwrap_or_default();
        wm.insert("days".into(), Value::Array(days));
        out.insert("weekly".into(), Value::Object(wm));
    }
    Value::Object(out)
}

pub fn export_snapshot(state: &Map<String, Value>) -> Value {
    let mut rows: Vec<&Map<String, Value>> = state
        .get("sessions")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_object()).collect())
        .unwrap_or_default();
    if rows.len() > 250 {
        rows.sort_by_key(|s| {
            !matches!(
                s.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                "working" | "waiting" | "subagents"
            )
        });
        rows.truncate(250);
    }

    let mut sessions = Vec::with_capacity(rows.len());
    let mut sids: HashSet<String> = HashSet::new();
    for s in rows {
        let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
        sids.insert(sid.to_string());
        let loc = s.get("location").and_then(|v| v.as_object());
        let term = s.get("orca_terminal").and_then(|v| v.as_object());
        let r = s.get("resources").and_then(|v| v.as_object());
        let u = s.get("usage").and_then(|v| v.as_object());
        let identified = s
            .get("control_key")
            .and_then(|v| v.as_str())
            .is_some_and(|x| !x.is_empty());
        let status = s
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let kind = s.get("kind").and_then(|v| v.as_str()).unwrap_or("");

        let mut caps: Vec<&str> = Vec::new();
        if identified
            && (term.is_some()
                || loc
                    .and_then(|l| l.get("app_path"))
                    .and_then(|v| v.as_str())
                    .is_some_and(|x| !x.is_empty()))
        {
            caps.push("focus");
        }
        if identified && term.is_some() {
            caps.push("rename");
        }
        let can_pause = identified
            && term.is_some()
            && s.get("input_verified").and_then(|v| v.as_bool()) != Some(false)
            && matches!(kind, "Claude" | "GLM" | "Codex");
        if (can_pause || (identified && kind == "Aside")) && matches!(status, "working" | "waiting")
        {
            caps.push("pause");
        }
        if can_pause
            && s.get("display_status").and_then(|v| v.as_str()) == Some("paused")
            && matches!(status, "idle" | "interrupted" | "done")
        {
            caps.push("resume");
        }
        if accepts_instruction(s) {
            caps.push("prompt");
        }
        if identified && mailbox_readable(s) {
            caps.push("mailbox");
            if accepts_message(s) {
                caps.push("message");
                if matches!(kind, "Claude" | "GLM" | "Codex") {
                    caps.push("message_images");
                }
            }
        }
        if kind != "Aside"
            && identified
            && (term.is_none()
                || matches!(status, "idle" | "interrupted" | "done")
                || (can_pause && matches!(status, "working" | "waiting")))
        {
            caps.push("terminate");
        }

        let mut out = Map::new();
        out.insert("id".into(), json!(sid));
        out.insert(
            "control_key".into(),
            json!(s.get("control_key").and_then(|v| v.as_str()).unwrap_or("")),
        );
        out.insert("kind".into(), json!(kind));
        let app = if term.is_some() {
            "Orca"
        } else {
            loc.and_then(|l| l.get("app"))
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
                .unwrap_or("Unknown")
        };
        out.insert("app".into(), json!(app));
        let term_name = term
            .and_then(|t| t.get("title"))
            .and_then(|v| v.as_str())
            .filter(|x| !x.is_empty())
            .or_else(|| loc.and_then(|l| l.get("terminal")).and_then(|v| v.as_str()))
            .unwrap_or("");
        out.insert("terminal".into(), json!(term_name));
        out.insert(
            "project".into(),
            json!(s.get("project").and_then(|v| v.as_str()).unwrap_or("")),
        );
        out.insert("title".into(), json!(""));
        out.insert(
            "model".into(),
            json!(s.get("model").and_then(|v| v.as_str()).unwrap_or("")),
        );
        out.insert(
            "effort".into(),
            s.get("effort").cloned().unwrap_or(Value::Null),
        );
        out.insert(
            "effort_source".into(),
            s.get("effort_source").cloned().unwrap_or(Value::Null),
        );
        out.insert(
            "effort_updated".into(),
            s.get("effort_updated").cloned().unwrap_or(Value::Null),
        );
        out.insert(
            "status".into(),
            json!(s
                .get("display_status")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
                .unwrap_or(status)),
        );
        out.insert(
            "tokens".into(),
            s.get("tokens").cloned().unwrap_or(Value::Null),
        );
        for (k, v) in session_identity(s) {
            out.insert(k, v);
        }
        let ctx_val = s
            .get("context_usage")
            .filter(|v| v.is_object())
            .map(|c| {
                Value::Object(select_keys(
                    Some(c),
                    &[
                        "basis",
                        "input_tokens",
                        "capacity",
                        "parts",
                        "observed_at",
                        "model",
                    ],
                ))
            })
            .unwrap_or(Value::Null);
        out.insert("context_usage".into(), ctx_val);
        for (k, v) in select_keys(
            Some(&Value::Object(s.clone())),
            &[
                "last_usage",
                "request_input",
                "context_size",
                "terminal_note",
                "pids",
            ],
        ) {
            out.insert(k, v);
        }
        let u_val = u.map(|m| Value::Object(m.clone()));
        out.insert(
            "usage".into(),
            Value::Object(select_keys(
                u_val.as_ref(),
                &["last_minute", "last_five_minutes", "output_rate", "history"],
            )),
        );
        out.insert(
            "rate".into(),
            u.and_then(|m| m.get("rate"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        out.insert(
            "windows".into(),
            u.and_then(|m| m.get("windows"))
                .cloned()
                .unwrap_or_else(|| json!({})),
        );
        out.insert(
            "cpu".into(),
            r.and_then(|m| m.get("cpu")).cloned().unwrap_or(Value::Null),
        );
        out.insert(
            "rss".into(),
            r.and_then(|m| m.get("rss")).cloned().unwrap_or(Value::Null),
        );
        out.insert(
            "weekly_estimate".into(),
            Value::Object(u.map(export_weekly).unwrap_or_default()),
        );
        out.insert(
            "weekly_account".into(),
            u.and_then(|m| m.get("weekly_account"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        out.insert(
            "root_session_id".into(),
            s.get("root_session_id")
                .cloned()
                .unwrap_or_else(|| json!(sid)),
        );
        out.insert(
            "parent_session_id".into(),
            s.get("parent_session_id").cloned().unwrap_or(Value::Null),
        );
        out.insert("capabilities".into(), json!(caps));
        sessions.push(Value::Object(out));
    }

    let host = state.get("system").and_then(|s| s.get("host"));
    let memory = host.and_then(|h| h.get("memory"));
    let ops = state.get("operations").and_then(|v| v.as_object());
    let ops_goals: Vec<Value> = ops
        .and_then(|o| o.get("goals"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|g| {
                    Value::Object(select_keys(
                        Some(g),
                        &[
                            "thread_id",
                            "runtime",
                            "status",
                            "tokens_used",
                            "time_used_seconds",
                            "session_connected",
                            "evidence",
                        ],
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let operations = json!({
        "updated": ops.and_then(|o| o.get("updated")).cloned().unwrap_or(Value::Null),
        "installed_skills": ops.and_then(|o| o.get("skills")).and_then(|v| v.as_array()).map(Vec::len),
        "observed_events": ops.and_then(|o| o.get("events")).and_then(|v| v.as_array()).map(Vec::len),
        "goals": ops_goals,
        "loop_state": "not_verified",
        "skill_runtime": "partial"
    });

    let weekly_map: BTreeMap<String, &Map<String, Value>> = state
        .get("weekly_usage")
        .and_then(|w| w.get("accounts"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.as_object())
                .filter_map(|a| Some((a.get("id")?.as_str()?.to_string(), a)))
                .collect()
        })
        .unwrap_or_default();

    let mut flow = export_flow(state);
    if let Some(rf) = state.get("remote_flows").and_then(|v| v.as_object()) {
        for (k, v) in rf {
            flow.insert(k.clone(), v.clone());
        }
    }

    let actions: Vec<Value> = state
        .get("actions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            let skip = arr.len().saturating_sub(20);
            arr[skip..]
                .iter()
                .map(|a| {
                    Value::Object(select_keys(
                        Some(a),
                        &["t", "action", "sid", "terminal", "project", "message"],
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    let quotas: Vec<Value> = state
        .get("quotas")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .take(24)
                .map(|q| {
                    Value::Object(select_keys(
                        Some(q),
                        &["kind", "plan", "updated", "stale", "note", "windows"],
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    let account_quotas: Vec<Value> = state
        .get("account_quotas")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .take(24)
                .filter_map(|q| q.as_object())
                .map(|q| {
                    let qid = q.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let qkind = q.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                    let tail = if qid.len() >= 6 { &qid[qid.len() - 6..] } else { qid };
                    let wins: Vec<Value> = q
                        .get("windows")
                        .and_then(|v| v.as_array())
                        .map(|ws| {
                            ws.iter()
                                .take(16)
                                .filter_map(|w| w.as_object())
                                .map(|w| {
                                    let mut m = Map::new();
                                    for k in ["key", "period", "label", "pct", "reset", "seconds", "scope", "meter"] {
                                        if let Some(v) = w.get(k) {
                                            m.insert(k.into(), v.clone());
                                        }
                                    }
                                    Value::Object(m)
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let w_acct = weekly_map.get(qid).copied();
                    let cal = select_keys(
                        w_acct.and_then(|a| a.get("calibration")),
                        &CALIBRATION_KEYS,
                    );
                    let mut w_periods = Map::new();
                    if let Some(ps) = w_acct.and_then(|a| a.get("periods")).and_then(|v| v.as_object()) {
                        for (pk, pv) in ps {
                            w_periods.insert(
                                pk.clone(),
                                Value::Object(select_keys(
                                    Some(pv),
                                    &["used_pp", "observed_seconds", "partial"],
                                )),
                            );
                        }
                    }
                    let up: Vec<Value> = w_acct
                        .and_then(|a| a.get("usage_points"))
                        .and_then(|v| v.as_array())
                        .map(|pts| {
                            let skip = pts.len().saturating_sub(60);
                            pts[skip..].to_vec()
                        })
                        .unwrap_or_default();
                    json!({
                        "id": qid,
                        "kind": qkind,
                        "account_label": format!("{qkind} · {tail}"),
                        "alias": q.get("alias").and_then(|v| v.as_str()).unwrap_or(""),
                        "plan": q.get("plan").and_then(|v| v.as_str()).unwrap_or(""),
                        "provider": q.get("provider").and_then(|v| v.as_str()).unwrap_or(""),
                        "pool": q.get("pool").and_then(|v| v.as_str()).unwrap_or(""),
                        "identity_source": q.get("identity_source").and_then(|v| v.as_str()).unwrap_or(""),
                        "identity_verified": q.get("identity_verified").cloned().unwrap_or(Value::Null),
                        "windows": wins,
                        "updated": q.get("updated").cloned().unwrap_or_else(|| json!(0)),
                        "stale": q.get("stale").cloned().unwrap_or(Value::Bool(true)),
                        "note": q.get("note").and_then(|v| v.as_str()).unwrap_or(""),
                        "status": q.get("status").and_then(|v| v.as_str()).unwrap_or(""),
                        "calibration": cal,
                        "weekly": w_periods,
                        "usage_points": up
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let apps: Vec<Value> = state
        .get("applications")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|a| {
                    json!({
                        "name": a.get("name").cloned().unwrap_or(Value::Null),
                        "evidence": a.get("evidence").cloned().unwrap_or(Value::Null)
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let mut host_out = host_metrics(host);
    host_out.insert(
        "cpu".into(),
        host.and_then(|h| h.get("cpu"))
            .cloned()
            .unwrap_or(Value::Null),
    );
    host_out.insert(
        "used_memory".into(),
        memory
            .and_then(|m| m.get("used"))
            .cloned()
            .unwrap_or_else(|| json!(0)),
    );
    host_out.insert(
        "total_memory".into(),
        memory
            .and_then(|m| m.get("total"))
            .cloned()
            .unwrap_or_else(|| json!(0)),
    );
    host_out.insert(
        "cores".into(),
        host.and_then(|h| h.get("cores"))
            .cloned()
            .unwrap_or_else(|| json!(0)),
    );

    let periods: Vec<Value> = state
        .get("period_usage")
        .and_then(|p| p.get("windows"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(period_metrics).collect())
        .unwrap_or_default();

    json!({
        "version": APP_VERSION,
        "updated": state.get("updated").cloned().unwrap_or_else(|| json!(0)),
        "recording_started": state.get("started").cloned().unwrap_or_else(|| json!(0)),
        "features": ["history", "account_alias", "usage_sessions", "reports"],
        "reports": export_reports(state.get("reports")),
        "flow": flow,
        "system": system_metrics(state.get("system"), &sids),
        "collection_ms": state.get("collection_ms").cloned().unwrap_or(Value::Null),
        "resume_prompt": state.get("resume_prompt").and_then(|v| v.as_str()).unwrap_or(""),
        "actions": actions,
        "orca_terminals": state.get("orca_terminals").cloned().unwrap_or(Value::Null),
        "process_counts": state.get("process_counts").cloned().unwrap_or_else(|| json!({})),
        "quotas": quotas,
        "operations": operations,
        "account_quotas": account_quotas,
        "sessions": sessions,
        "applications": apps,
        "host": Value::Object(host_out),
        "periods": periods
    })
}

fn default_relay() -> String {
    RELAY.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub device_id: String,
    pub device_token: String,
    #[serde(default = "default_relay")]
    pub relay: String,
}

pub fn load_device_config(
    data_dir: &Path,
    explicit_relay: Option<&str>,
) -> (Option<DeviceConfig>, String) {
    let loaded: Option<DeviceConfig> = std::fs::read_to_string(data_dir.join("device.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let saved_relay = loaded.as_ref().map(|c| c.relay.as_str()).unwrap_or(RELAY);
    let target_relay =
        relay_origin(explicit_relay.unwrap_or(saved_relay)).unwrap_or_else(|_| RELAY.to_string());
    let valid_cfg = loaded.filter(|c| c.relay == target_relay);
    (valid_cfg, target_relay)
}

pub fn pair_device_blocking(
    data_dir: &Path,
    relay: &str,
    open_browser: bool,
) -> Result<DeviceConfig, String> {
    let origin = relay_origin(relay).map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let raw_host = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "Mac".into());
    let name = raw_host.strip_suffix(".local").unwrap_or(&raw_host);
    let plat = match std::env::consts::OS {
        "macos" => "Darwin",
        "windows" => "Windows",
        other => other,
    };
    let resp = client
        .post(format!("{origin}/api/pair/start"))
        .header("User-Agent", format!("1top/{APP_VERSION}"))
        .json(&json!({"name": name, "platform": plat}))
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let result: Value = resp.json().map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(result
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Could not start connection")
            .to_string());
    }
    let url = result
        .get("verification_uri_complete")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Unexpected sign-in address".to_string())?;
    let verify = Url::parse(url).map_err(|_| "Unexpected sign-in address".to_string())?;
    if verify.scheme() != "https"
        || verify.host_str() != Some("1top.si")
        || verify.path() != "/connect"
    {
        return Err("Unexpected sign-in address".into());
    }
    if open_browser {
        open_url(url);
    }
    let device_code = result
        .get("device_code")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let expires_in = result
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(300);
    let interval = result
        .get("interval")
        .and_then(|v| v.as_u64())
        .unwrap_or(3)
        .max(1);
    let deadline = Instant::now() + Duration::from_secs(expires_in);
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_secs(interval));
        let Ok(pr) = client
            .post(format!("{origin}/api/pair/poll"))
            .header("User-Agent", format!("1top/{APP_VERSION}"))
            .json(&json!({"device_code": device_code}))
            .send()
        else {
            continue;
        };
        let pcode = pr.status().as_u16();
        if pcode == 202 || pcode == 429 {
            continue;
        }
        let pdata: Value = pr.json().unwrap_or_else(|_| json!({}));
        if pcode == 200 {
            let cfg = DeviceConfig {
                device_id: pdata
                    .get("device_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                device_token: pdata
                    .get("device_token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                relay: origin,
            };
            save_private_json(
                &data_dir.join("device.json"),
                &serde_json::to_value(&cfg).unwrap(),
            )
            .map_err(|e| e.to_string())?;
            return Ok(cfg);
        }
        return Err(pdata
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Connection expired")
            .to_string());
    }
    Err("Connection expired. Open 1top to connect again.".into())
}

pub fn fetch_workspace_usage_blocking(relay: &str, device_token: &str) -> Option<Value> {
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    let resp = client
        .get(format!("{relay}/api/device/usage"))
        .header("Authorization", format!("Bearer {device_token}"))
        .header("User-Agent", format!("1top/{APP_VERSION}"))
        .send()
        .ok()?;
    let bytes = resp.bytes().ok()?;
    if bytes.len() > 128_000 {
        return None;
    }
    let val: Value = serde_json::from_slice(&bytes).ok()?;
    let devices = val.get("devices")?.as_array()?;
    let capped: Vec<Value> = devices.iter().take(25).cloned().collect();
    Some(json!({"devices": capped, "updated": now_epoch()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relay_origin_and_report_interval_validation() {
        assert_eq!(
            relay_origin("https://Relay.Example.com/").unwrap(),
            "https://relay.example.com"
        );
        assert!(relay_origin("http://relay.example.com").is_err());
        assert!(relay_origin("https://relay.example.com/path").is_err());
        assert!(relay_origin("https://user:pass@relay.example.com").is_err());
        assert!(relay_origin("https://localhost").is_err());

        assert_eq!(report_interval(Some(&json!(3))), 3);
        assert_eq!(report_interval(Some(&json!(15))), 60);
        assert_eq!(report_interval(Some(&json!(900))), 600);
        assert_eq!(report_interval(Some(&json!(180))), 180);
        assert_eq!(report_interval(Some(&json!(true))), 60);

        let td = tempfile::tempdir().unwrap();
        std::fs::write(
            td.path().join("device.json"),
            r#"{"device_id":"dev-1","device_token":"tok-1"}"#,
        )
        .unwrap();
        let (cfg, relay) = load_device_config(td.path(), None);
        assert_eq!(relay, RELAY);
        let cfg = cfg.expect("legacy device.json without relay must load");
        assert_eq!(cfg.device_id, "dev-1");
        assert_eq!(cfg.relay, RELAY);
    }

    #[test]
    fn export_snapshot_shapes_capabilities_and_privacy_boundary() {
        let state: Map<String, Value> = serde_json::from_value(json!({
            "updated": 1795600000.0,
            "started": 1795590000.0,
            "sessions": [{
                "id": "s1",
                "control_key": "ck1",
                "kind": "Claude",
                "status": "idle",
                "project": "demo",
                "model": "claude-opus-5-5",
                "tokens": [10, 20, 0, 5],
                "orca_terminal": {"handle": "t1", "title": "Tab"},
                "usage": {"last_minute": [10, 0, 0, 5], "rate": 0.25, "windows": {}}
            }],
            "events": [{"t": 1795599960.0, "kind": "Claude", "fresh": 10, "cached": 20, "written": 0, "output": 5}],
            "period_usage": {"windows": []},
            "account_quotas": [],
            "weekly_usage": {"accounts": []},
            "system": {"host": {"cpu": 12.5, "cores": 8, "memory": {"used": 100, "total": 1000}}}
        }))
        .unwrap();
        let exported = export_snapshot(&state);
        assert_eq!(exported["sessions"][0]["id"], "s1");
        assert_eq!(exported["sessions"][0]["title"], "");
        let caps = exported["sessions"][0]["capabilities"].as_array().unwrap();
        assert!(caps.iter().any(|c| c == "focus"));
        assert!(caps.iter().any(|c| c == "rename"));
        assert!(caps.iter().any(|c| c == "terminate"));
    }
}
