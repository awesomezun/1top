//! Complete port of `usage.py`, `fleet_usage.py`, `time_ranges.py`, `session_archive.py`, and `relay_data.py`.
use crate::readonly::open_readonly;
use crate::sessions::{group_sessions, sha256_hex};
use crate::text::clean_title;
use crate::weekly_usage::{interval, reconciled_history, FRESH};
use regex::Regex;
use rusqlite::{params, params_from_iter, Connection};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

pub const WINDOWS: [(&str, &str, i64); 6] = [
    ("24h", "24시간", 86400),
    ("12h", "12시간", 43200),
    ("5h", "5시간", 18000),
    ("1h", "1시간", 3600),
    ("30m", "30분", 1800),
    ("10m", "10분", 600),
];

pub const STOPS: [i64; 18] = [
    600, 900, 1800, 3600, 7200, 10800, 18000, 21600, 43200, 86400, 172800, 259200, 604800, 1209600,
    2592000, 7776000, 15552000, 31536000,
];

pub const CALIBRATION_KEYS: [&str; 9] = [
    "pp_per_token",
    "confidence",
    "from",
    "to",
    "valid_until",
    "source",
    "seconds",
    "used_pp",
    "tokens",
];

fn custom_period_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^custom:[0-9]{1,13}$").unwrap())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PeriodDuration {
    Preset,
    All,
    Seconds(i64),
}

pub fn parse_period(value: &str) -> Result<PeriodDuration, &'static str> {
    if WINDOWS.iter().any(|(k, _, _)| *k == value) {
        return Ok(PeriodDuration::Preset);
    }
    if value == "all" {
        return Ok(PeriodDuration::All);
    }
    if !custom_period_re().is_match(value) {
        return Err("Invalid time range");
    }
    let secs: i64 = value
        .split_once(':')
        .and_then(|(_, s)| s.parse().ok())
        .ok_or("Invalid time range")?;
    if secs < 600 || secs % 60 != 0 || secs > 8_000_000_000_000 {
        return Err("Invalid time range");
    }
    Ok(PeriodDuration::Seconds(secs))
}

pub fn period_label(seconds: i64) -> String {
    if seconds % 86400 == 0 {
        format!("{}일", seconds / 86400)
    } else if seconds % 3600 == 0 {
        format!("{}시간", seconds / 3600)
    } else {
        format!("{}분", seconds / 60)
    }
}

#[allow(clippy::let_and_return)]
pub fn has_column(db: &Connection, table: &str, col: &str) -> bool {
    let sql = format!("PRAGMA table_info({table})");
    let Ok(mut stmt) = db.prepare(&sql) else {
        return false;
    };
    let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) else {
        return false;
    };
    let found = rows.flatten().any(|name| name == col);
    found
}

pub type SessionPeriodMap = HashMap<String, HashMap<String, [i64; 4]>>;

/// Exact port of `usage.py:window_usage`.
pub fn window_usage(
    db: &Connection,
    now: f64,
    started: f64,
    known_kinds: &[String],
    custom_windows: Option<&[(String, String, i64)]>,
) -> rusqlite::Result<(Value, SessionPeriodMap)> {
    let mut periods = Vec::new();
    let mut sessions: SessionPeriodMap = HashMap::new();
    let mut known: BTreeSet<String> = known_kinds.iter().cloned().collect();
    let model_col = if has_column(db, "events", "model") {
        "model"
    } else {
        "NULL"
    };
    let sql = format!(
        "SELECT sid, kind, {model_col}, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
         FROM events WHERE t>?1 AND t<=?2 AND t>=?3 GROUP BY 1, 2, 3"
    );

    let default_wins: Vec<(String, String, i64)> = WINDOWS
        .iter()
        .map(|(k, l, s)| (k.to_string(), l.to_string(), *s))
        .collect();
    let active_wins = custom_windows.unwrap_or(&default_wins);

    for (key, label, seconds) in active_wins {
        let secs_f = *seconds as f64;
        let beginning = started.max(now - secs_f);
        let mut stmt = db.prepare(&sql)?;
        let rows = stmt.query_map(params![now - secs_f, now, started], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3).unwrap_or(0),
                r.get::<_, i64>(4).unwrap_or(0),
                r.get::<_, i64>(5).unwrap_or(0),
                r.get::<_, i64>(6).unwrap_or(0),
            ))
        })?;

        let mut by_kind: BTreeMap<String, [i64; 4]> = BTreeMap::new();
        let mut by_model: HashMap<(String, Option<String>), [i64; 4]> = HashMap::new();
        let mut model_sessions: HashMap<(String, Option<String>), HashSet<String>> = HashMap::new();
        let mut ids: HashSet<String> = HashSet::new();

        for row in rows.flatten() {
            let (sid, kind, raw_model, f, c, w, o) = row;
            known.insert(kind.clone());
            ids.insert(sid.clone());
            let model = raw_model.map(|m| m.trim().to_string()).filter(|m| {
                !m.is_empty() && !matches!(m.to_lowercase().as_str(), "unknown" | "<synthetic>")
            });
            let vals = [f, c, w, o];
            let mkey = (kind.clone(), model);
            let mt = by_model.entry(mkey.clone()).or_insert([0; 4]);
            model_sessions.entry(mkey).or_default().insert(sid.clone());
            let ka = by_kind.entry(kind).or_insert([0; 4]);
            let ps = sessions
                .entry(sid)
                .or_default()
                .entry(key.clone())
                .or_insert([0; 4]);
            for i in 0..4 {
                mt[i] += vals[i];
                ka[i] += vals[i];
                ps[i] += vals[i];
            }
        }

        type ModelSummary = ((String, Option<String>), [i64; 4], usize);
        let mut models: Vec<ModelSummary> = by_model
            .into_iter()
            .map(|(k, v)| {
                let sc = model_sessions.get(&k).map(HashSet::len).unwrap_or(0);
                (k, v, sc)
            })
            .collect();
        models.sort_by(|a, b| {
            let sa: i64 = a.1.iter().sum();
            let sb: i64 = b.1.iter().sum();
            sb.cmp(&sa).then_with(|| a.0 .0.cmp(&b.0 .0)).then_with(|| {
                a.0 .1
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.0 .1.as_deref().unwrap_or(""))
            })
        });

        let models_json: Vec<Value> = models
            .into_iter()
            .map(|((kind, model), tokens, session_count)| {
                json!({
                    "kind": kind,
                    "model": model,
                    "tokens": tokens,
                    "session_count": session_count
                })
            })
            .collect();

        let mut total = [0i64; 4];
        let mut by_kind_json = Map::new();
        for (k, v) in by_kind {
            for i in 0..4 {
                total[i] += v[i];
            }
            by_kind_json.insert(k, json!(v));
        }

        periods.push(json!({
            "key": key,
            "label": label,
            "seconds": seconds,
            "from": beginning,
            "observed_seconds": (now - beginning).max(0.0),
            "partial": started > now - secs_f,
            "tokens": total,
            "by_kind": by_kind_json,
            "by_model": models_json,
            "session_count": ids.len()
        }));
    }

    let known_vec: Vec<String> = known.into_iter().collect();
    Ok((
        json!({
            "as_of": now,
            "recording_started": started,
            "known_kinds": known_vec,
            "windows": periods
        }),
        sessions,
    ))
}

pub type SessionUsageResult = (
    HashMap<String, [i64; 4]>,
    HashMap<String, [i64; 4]>,
    HashMap<String, Vec<[i64; 2]>>,
    f64,
);

/// Exact port of `usage.py:session_usage`.
pub fn session_usage(
    db: &Connection,
    now: f64,
    started: f64,
) -> rusqlite::Result<SessionUsageResult> {
    let window = (now - started).clamp(1.0, 60.0);
    let mut minute = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT sid, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
             FROM events WHERE t>?1 AND t<=?2 GROUP BY sid",
        )?;
        let rows = stmt.query_map(params![now - window, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                [
                    r.get::<_, i64>(1).unwrap_or(0),
                    r.get::<_, i64>(2).unwrap_or(0),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, i64>(4).unwrap_or(0),
                ],
            ))
        })?;
        for (sid, v) in rows.flatten() {
            minute.insert(sid, v);
        }
    }
    let mut five = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT sid, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
             FROM events WHERE t>?1 AND t<=?2 GROUP BY sid",
        )?;
        let rows = stmt.query_map(params![now - 300.0, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                [
                    r.get::<_, i64>(1).unwrap_or(0),
                    r.get::<_, i64>(2).unwrap_or(0),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, i64>(4).unwrap_or(0),
                ],
            ))
        })?;
        for (sid, v) in rows.flatten() {
            five.insert(sid, v);
        }
    }
    let mut history: HashMap<String, Vec<[i64; 2]>> = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT sid, CAST(t/60 AS INTEGER)*60, SUM(fresh+cached+written+output) \
             FROM events WHERE t>?1 AND t<=?2 GROUP BY 1, 2 ORDER BY 2",
        )?;
        let rows = stmt.query_map(params![now - 3600.0, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1).unwrap_or(0),
                r.get::<_, i64>(2).unwrap_or(0),
            ))
        })?;
        for (sid, t, n) in rows.flatten() {
            history.entry(sid).or_default().push([t, n]);
        }
    }
    Ok((minute, five, history, window))
}

/// Exact port of `fleet_usage.py:speed_windows`.
pub fn speed_windows(db: &Connection, state: &Map<String, Value>) -> rusqlite::Result<Vec<Value>> {
    let now = state.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let start = state
        .get("history_started")
        .or_else(|| state.get("started"))
        .and_then(|v| v.as_f64())
        .unwrap_or(now);
    let cols: Vec<&str> = STOPS
        .iter()
        .map(|_| "COALESCE(SUM(CASE WHEN t>? THEN fresh+cached+written+output ELSE 0 END),0)")
        .collect();
    let sql = format!(
        "SELECT {}, COALESCE(SUM(fresh+cached+written+output),0), COUNT(*) \
         FROM events WHERE t>=? AND t<=?",
        cols.join(",")
    );
    let mut bind_vals: Vec<f64> = STOPS.iter().map(|&s| now - s as f64).collect();
    bind_vals.push(start);
    bind_vals.push(now);

    let mut stmt = db.prepare(&sql)?;
    let (totals, count): (Vec<i64>, i64) =
        stmt.query_row(params_from_iter(bind_vals.iter()), |r| {
            let mut vals = Vec::with_capacity(STOPS.len() + 1);
            for i in 0..=STOPS.len() {
                vals.push(r.get::<_, i64>(i).unwrap_or(0));
            }
            let cnt = r.get::<_, i64>(STOPS.len() + 1).unwrap_or(0);
            Ok((vals, cnt))
        })?;

    let has_known_kinds = state
        .get("period_usage")
        .and_then(|p| p.get("known_kinds"))
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    let known = count > 0 || has_known_kinds;

    let mut rows = Vec::new();
    for (i, &seconds) in STOPS.iter().enumerate() {
        let tok = totals[i];
        if tok < 0 {
            continue;
        }
        let key = match seconds {
            600 => "10m".to_string(),
            1800 => "30m".to_string(),
            3600 => "1h".to_string(),
            18000 => "5h".to_string(),
            43200 => "12h".to_string(),
            86400 => "24h".to_string(),
            s => format!("custom:{s}"),
        };
        rows.push(json!({
            "key": key,
            "seconds": seconds,
            "tokens": tok,
            "known": known,
            "partial": start > now - seconds as f64
        }));
    }
    let all_secs = (now - start).max(1.0);
    let all_tok = totals[STOPS.len()];
    if all_tok >= 0 {
        rows.push(json!({
            "key": "all",
            "seconds": all_secs,
            "tokens": all_tok,
            "known": known,
            "partial": false
        }));
    }
    Ok(rows)
}

/// Exact port of `time_ranges.py:extend_snapshot`.
pub fn extend_snapshot(
    db: &Connection,
    snapshot: &Map<String, Value>,
    key: &str,
) -> Result<Map<String, Value>, String> {
    let duration = parse_period(key).map_err(|e| e.to_string())?;
    if duration == PeriodDuration::Preset
        || !snapshot
            .get("ready")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    {
        return Ok(snapshot.clone());
    }
    let mut result = snapshot.clone();
    let now = result
        .get("updated")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let started = result
        .get("history_started")
        .or_else(|| result.get("started"))
        .and_then(|v| v.as_f64())
        .unwrap_or(now);
    let (seconds_f, seconds_i, label) = match duration {
        PeriodDuration::All => {
            let s = (now - started).max(600.0);
            (s, s as i64, "전체 기록".to_string())
        }
        PeriodDuration::Seconds(s) => (s as f64, s, period_label(s)),
        PeriodDuration::Preset => unreachable!(),
    };

    let known_kinds: Vec<String> = result
        .get("period_usage")
        .and_then(|p| p.get("known_kinds"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let (period, usage) = window_usage(
        db,
        now,
        started,
        &known_kinds,
        Some(&[(key.to_string(), label, seconds_i)]),
    )
    .map_err(|e| e.to_string())?;

    if let Some(pu) = result
        .get_mut("period_usage")
        .and_then(|v| v.as_object_mut())
    {
        if let Some(win0) = period
            .get("windows")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .cloned()
        {
            if let Some(wins) = pu.get_mut("windows").and_then(|v| v.as_array_mut()) {
                wins.push(win0);
            }
        }
        if let Some(kk) = period.get("known_kinds").cloned() {
            pu.insert("known_kinds".into(), kk);
        }
    }

    let start = now - seconds_f;
    let step = ((seconds_f / 240.0 / 60.0).ceil() as i64 * 60).max(60) as f64;

    let mut events_out = Vec::new();
    {
        let mut stmt = db
            .prepare(
                "SELECT CAST((t-?1)/?2 AS INTEGER), kind, \
                 SUM(fresh), SUM(cached), SUM(written), SUM(output) FROM events \
                 WHERE t>?3 AND t<=?4 AND t>=?5 GROUP BY 1, 2 ORDER BY 1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start, step, start, now, started], |r| {
                Ok((
                    r.get::<_, i64>(0).unwrap_or(0),
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2).unwrap_or(0),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, i64>(4).unwrap_or(0),
                    r.get::<_, i64>(5).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;
        for (bucket, kind, f, c, w, o) in rows.flatten() {
            let t = (now - 0.001).min(start + bucket as f64 * step);
            events_out.push(json!({
                "t": t,
                "kind": kind,
                "fresh": f,
                "cached": c,
                "written": w,
                "output": o
            }));
        }
    }
    result.insert("events".into(), Value::Array(events_out));
    result.insert(
        "chart_range".into(),
        json!({"start": start, "end": now, "step": step}),
    );

    let mut attributed: HashMap<String, Vec<(Option<String>, String, i64)>> = HashMap::new();
    {
        let mut stmt = db
            .prepare(
                "SELECT sid, account, kind, SUM(fresh+cached+written+output) FROM events \
                 WHERE t>?1 AND t<=?2 AND t>=?3 GROUP BY sid, account, kind",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![start, now, started], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;
        for (sid, acct, kind, tok) in rows.flatten() {
            attributed.entry(sid).or_default().push((acct, kind, tok));
        }
    }

    let accounts_snapshot: HashMap<String, Map<String, Value>> = result
        .get("weekly_usage")
        .and_then(|w| w.get("accounts"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| a.as_object())
                .filter_map(|a| Some((a.get("id")?.as_str()?.to_string(), a.clone())))
                .collect()
        })
        .unwrap_or_default();

    if let Some(sessions) = result.get_mut("sessions").and_then(|v| v.as_array_mut()) {
        for sv in sessions.iter_mut() {
            let Some(session) = sv.as_object_mut() else {
                continue;
            };
            let sid = session
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let known = session.get("tokens").is_some_and(|v| !v.is_null());
            let loading = session
                .get("loading")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let skind = session
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let bkind = session
                .get("billing_kind")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            if !session.get("usage").is_some_and(|v| v.is_object()) {
                session.insert("usage".into(), Value::Object(Map::new()));
            }
            let u = session.get_mut("usage").unwrap().as_object_mut().unwrap();
            if !u.get("windows").is_some_and(|v| v.is_object()) {
                u.insert("windows".into(), Value::Object(Map::new()));
            }
            let win_val = if known {
                json!(usage
                    .get(&sid)
                    .and_then(|m| m.get(key))
                    .copied()
                    .unwrap_or([0; 4]))
            } else {
                Value::Null
            };
            u.get_mut("windows")
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(key.to_string(), win_val);

            let acct = u
                .get("weekly_account")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let Some(acct_id) = acct else {
                continue;
            };
            let Some(acct_obj) = accounts_snapshot.get(&acct_id) else {
                continue;
            };
            let Some(cal) = acct_obj.get("calibration").filter(|v| v.is_object()) else {
                continue;
            };
            let Some(raw_rows) = attributed.get(&sid) else {
                continue;
            };
            if !known || loading || raw_rows.is_empty() {
                continue;
            }
            let provider = acct_obj
                .get("kind")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or(bkind.as_deref())
                .unwrap_or(&skind)
                .to_string();
            let mapped: Vec<(Option<String>, String, i64)> = raw_rows
                .iter()
                .map(|(a, k, n)| {
                    let eff_k = if k == "Aside" {
                        a.as_ref()
                            .and_then(|aid| accounts_snapshot.get(aid))
                            .and_then(|ao| ao.get("kind"))
                            .and_then(|v| v.as_str())
                            .unwrap_or(&provider)
                            .to_string()
                    } else {
                        k.clone()
                    };
                    (a.clone(), eff_k, *n)
                })
                .collect();
            let other_accounts = mapped
                .iter()
                .any(|(a, k, _)| k == &provider && a.as_deref().is_some_and(|x| x != acct_id));
            let accepted: Vec<(&Option<String>, i64)> = mapped
                .iter()
                .filter(|(a, k, _)| {
                    k == &provider
                        && (a.as_deref() == Some(acct_id.as_str())
                            || (a.is_none() && !other_accounts))
                })
                .map(|(a, _, n)| (a, *n))
                .collect();
            if accepted.is_empty() {
                continue;
            }
            let tokens: i64 = accepted.iter().map(|(_, n)| *n).sum();
            let pp_per_tok = cal
                .get("pp_per_token")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let converted = tokens as f64 * pp_per_tok;
            if !converted.is_finite() {
                continue;
            }
            let inferred: i64 = accepted
                .iter()
                .filter(|(a, _)| a.is_none())
                .map(|(_, n)| *n)
                .sum();
            let total_provider: i64 = mapped
                .iter()
                .filter(|(_, k, _)| k == &provider)
                .map(|(_, _, n)| *n)
                .sum();
            let excluded = total_provider - tokens;
            if !u.get("weekly_estimate").is_some_and(|v| v.is_object()) {
                u.insert("weekly_estimate".into(), Value::Object(Map::new()));
            }
            u.get_mut("weekly_estimate")
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(
                    key.to_string(),
                    json!({
                        "used_pp": (converted * 10000.0).round_ties_even() / 10000.0,
                        "account_id": acct_id,
                        "basis": "calibrated_token_equivalent",
                        "tokens": tokens,
                        "partial": other_accounts || started > start,
                        "period_seconds": seconds_f,
                        "calibration": cal,
                        "inferred_account_tokens": inferred,
                        "excluded_account_tokens": excluded
                    }),
                );
        }
    }

    if let Some(sessions) = result.get("sessions").and_then(|v| v.as_array()) {
        let grouped = group_sessions(sessions);
        result.insert("root_sessions".into(), Value::Array(grouped));
    }

    if let Some(wu_accts) = result
        .get_mut("weekly_usage")
        .and_then(|w| w.get_mut("accounts"))
        .and_then(|v| v.as_array_mut())
    {
        for av in wu_accts.iter_mut() {
            let Some(acct) = av.as_object_mut() else {
                continue;
            };
            let Some(aid) = acct.get("id").and_then(|v| v.as_str()).map(str::to_string) else {
                continue;
            };
            let mut stmt = db
                .prepare(
                    "SELECT t, pct, reset FROM weekly_samples \
                     WHERE account=?1 AND t>=?2 AND t<=?3 ORDER BY t",
                )
                .map_err(|e| e.to_string())?;
            let raw: Vec<(f64, f64, f64)> = stmt
                .query_map(params![aid, start - FRESH, now], |r| {
                    Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                })
                .map_err(|e| e.to_string())?
                .flatten()
                .collect();
            let (points, corrections, _) = reconciled_history(&raw);
            let mut chunks = Vec::new();
            for pair in points.windows(2) {
                let (delta, uncertain) = interval(pair[0], pair[1]);
                if pair[0].0 < start {
                    continue;
                }
                let Some(d) = delta else {
                    continue;
                };
                let corr = corrections
                    .iter()
                    .any(|&ct| pair[0].0 < ct && ct <= pair[1].0);
                chunks.push((pair[0].0, pair[1].0, d, uncertain || corr));
            }
            let covered: f64 = chunks.iter().map(|(a, b, _, _)| b - a).sum();
            let used_pp = if chunks.is_empty() {
                Value::Null
            } else {
                json!(chunks.iter().map(|(_, _, d, _)| *d).sum::<f64>())
            };
            if !acct.get("periods").is_some_and(|v| v.is_object()) {
                acct.insert("periods".into(), Value::Object(Map::new()));
            }
            acct.get_mut("periods")
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(
                    key.to_string(),
                    json!({
                        "used_pp": used_pp,
                        "observed_seconds": covered,
                        "partial": chunks.is_empty() || covered < seconds_f - FRESH,
                        "observed_from": chunks.first().map(|c| c.0),
                        "observed_to": chunks.last().map(|c| c.1),
                        "sample_count": points.len()
                    }),
                );
            let stride = ((points.len() as f64) / 240.0).ceil().max(1.0) as usize;
            let mut chart: Vec<[f64; 3]> = points
                .iter()
                .step_by(stride)
                .map(|&(t, p, r)| [t, p, r])
                .collect();
            if let Some(&(t, p, r)) = points.last() {
                let last = [t, p, r];
                if chart.last() != Some(&last) {
                    chart.push(last);
                }
            }
            acct.insert("usage_points".into(), json!(chart));
        }
    }

    Ok(result)
}

// ---------------- session_archive ----------------

pub fn archive_initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute(
        "CREATE TABLE IF NOT EXISTS session_catalog (
            sid TEXT PRIMARY KEY, kind TEXT, title TEXT, project TEXT, app TEXT,
            model TEXT, first_seen REAL, last_seen REAL, source TEXT)",
        [],
    )?;
    Ok(())
}

pub fn archive_remember(db: &Connection, sessions: &[Value], now: f64) -> rusqlite::Result<()> {
    archive_initialize(db)?;
    let mut stmt = db.prepare(
        "INSERT INTO session_catalog VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(sid) DO UPDATE SET
         title=COALESCE(NULLIF(excluded.title,''),session_catalog.title),
         project=COALESCE(NULLIF(excluded.project,''),session_catalog.project),
         app=COALESCE(NULLIF(excluded.app,''),session_catalog.app),
         model=COALESCE(NULLIF(excluded.model,''),session_catalog.model),
         last_seen=excluded.last_seen, source=excluded.source",
    )?;
    for sv in sessions {
        let Some(s) = sv.as_object() else {
            continue;
        };
        let sid = clean_title(s.get("id").and_then(|v| v.as_str()).unwrap_or(""), 200);
        if sid.is_empty() {
            continue;
        }
        let term = s.get("orca_terminal").and_then(|v| v.as_object());
        let loc = s.get("location").and_then(|v| v.as_object());
        let raw_title = term
            .and_then(|t| t.get("title"))
            .and_then(|v| v.as_str())
            .filter(|t| !t.is_empty())
            .or_else(|| {
                s.get("thread_name")
                    .and_then(|v| v.as_str())
                    .filter(|t| !t.is_empty())
            })
            .or_else(|| s.get("title").and_then(|v| v.as_str()))
            .unwrap_or("");
        let title = clean_title(raw_title, 200);
        let kind = clean_title(s.get("kind").and_then(|v| v.as_str()).unwrap_or(""), 40);
        let project = clean_title(s.get("project").and_then(|v| v.as_str()).unwrap_or(""), 100);
        let app = if term.is_some() {
            "Orca".to_string()
        } else {
            clean_title(
                loc.and_then(|l| l.get("app"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                80,
            )
        };
        let model = clean_title(s.get("model").and_then(|v| v.as_str()).unwrap_or(""), 160);
        stmt.execute(params![
            sid,
            kind,
            title,
            project,
            app,
            model,
            now,
            now,
            "collector"
        ])?;
    }
    Ok(())
}

pub fn archive_recover(
    db: &Connection,
    home: &Path,
    roots: &[(String, std::path::PathBuf)],
) -> rusqlite::Result<()> {
    archive_initialize(db)?;
    let model = if has_column(db, "events", "model") {
        "model"
    } else {
        "NULL"
    };
    let cwd = if has_column(db, "events", "cwd") {
        "cwd"
    } else {
        "NULL"
    };
    let backfill_sql = format!(
        "INSERT OR IGNORE INTO session_catalog
         SELECT sid,kind,'',COALESCE({cwd},''),'',COALESCE({model},''),first,last,'events'
         FROM (SELECT *,MIN(t) OVER (PARTITION BY sid) AS first,MAX(t) OVER (PARTITION BY sid) AS last,
             ROW_NUMBER() OVER (PARTITION BY sid ORDER BY t DESC,rowid DESC) AS position
             FROM events WHERE sid NOT IN (SELECT sid FROM session_catalog)) WHERE position=1"
    );
    let _ = db.execute(&backfill_sql, []);

    let ev_rows: Vec<(String, String)> = {
        let mut stmt =
            db.prepare("SELECT sid, project FROM session_catalog WHERE source='events'")?;
        let x: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .flatten()
            .collect();
        x
    };
    for (sid, proj) in ev_rows {
        let base = Path::new(&proj)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let _ = db.execute(
            "UPDATE session_catalog SET project=?1 WHERE sid=?2",
            params![clean_title(base, 100), sid],
        );
    }

    let wanted: HashSet<String> = {
        let mut stmt = db.prepare("SELECT sid FROM session_catalog WHERE source!='collector'")?;
        let x: HashSet<String> = stmt.query_map([], |r| r.get(0))?.flatten().collect();
        x
    };
    if wanted.is_empty() {
        return Ok(());
    }

    let save = |sid: &str, title_raw: &str, project_raw: &str, app: &str, source: &str| {
        if !wanted.contains(sid) {
            return;
        }
        let mut title = clean_title(title_raw, 200);
        if title.starts_with("# AGENTS") || title.starts_with('<') || title.starts_with("You are") {
            title.clear();
        }
        let proj = if project_raw.is_empty() {
            String::new()
        } else {
            let base = Path::new(project_raw)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            clean_title(base, 100)
        };
        let _ = db.execute(
            "UPDATE session_catalog SET title=COALESCE(NULLIF(?1,''),title),
             project=COALESCE(NULLIF(?2,''),project), app=?3, source=?4 WHERE sid=?5",
            params![title, proj, app, source, sid],
        );
    };

    for (kind, root) in roots {
        if kind == "Codex" {
            let pattern = format!("{}/state_*.sqlite", root.display());
            let mut dbs: Vec<std::path::PathBuf> = glob::glob(&pattern)
                .ok()
                .into_iter()
                .flatten()
                .flatten()
                .collect();
            dbs.sort();
            if let Some(latest) = dbs.last() {
                if let Ok(src) = open_readonly(latest, 0.5) {
                    let name_col = if has_column(&src, "threads", "thread_name") {
                        "thread_name"
                    } else {
                        "NULL"
                    };
                    let sql = format!("SELECT id, title, cwd, {name_col} FROM threads");
                    if let Ok(mut stmt) = src.prepare(&sql) {
                        if let Ok(rows) = stmt.query_map([], |r| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                            ))
                        }) {
                            for (sid, title, cwd_s, thread) in rows.flatten() {
                                let chosen = if thread.is_empty() { &title } else { &thread };
                                save(&sid, chosen, &cwd_s, "", "codex_threads");
                            }
                        }
                    }
                }
            }
        } else if kind == "Claude" {
            let idx_pat = format!("{}/projects/*/sessions-index.json", root.display());
            if let Ok(paths) = glob::glob(&idx_pat) {
                for p in paths.flatten() {
                    if std::fs::metadata(&p).is_ok_and(|m| m.len() <= 8 * 1024 * 1024) {
                        if let Ok(text) = std::fs::read_to_string(&p) {
                            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                                if let Some(entries) = val.get("entries").and_then(|v| v.as_array())
                                {
                                    for e in entries {
                                        if let Some(sid) =
                                            e.get("sessionId").and_then(|v| v.as_str())
                                        {
                                            let title = e
                                                .get("customTitle")
                                                .or_else(|| e.get("summary"))
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("");
                                            let proj = e
                                                .get("projectPath")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("");
                                            save(sid, title, proj, "", "claude_session_index");
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let aside_pat = format!("{}/.aside/u/*/state.db", home.display());
    if let Ok(paths) = glob::glob(&aside_pat) {
        for p in paths.flatten() {
            let prof = p
                .parent()
                .and_then(|d| d.file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if prof.is_empty() || !prof.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            if let Ok(src) = open_readonly(&p, 0.5) {
                if let Ok(mut stmt) = src.prepare(
                    "SELECT id, title, cwd FROM sessions WHERE incognito=0 AND ephemeral=0",
                ) {
                    if let Ok(rows) = stmt.query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                            r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        ))
                    }) {
                        for (sid, title, cwd_s) in rows.flatten() {
                            save(
                                &format!("aside:{prof}:{sid}"),
                                &title,
                                &cwd_s,
                                "Aside",
                                "aside_registry",
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Exact port of `session_archive.py:response`.
pub fn usage_sessions_response(
    db: &Connection,
    state: &Map<String, Value>,
    period: &str,
    offset: i64,
    limit: i64,
) -> Result<Value, String> {
    if offset < 0 || !(1..=200).contains(&limit) {
        return Err("Invalid page".into());
    }
    let preset_secs = WINDOWS
        .iter()
        .find(|(k, _, _)| *k == period)
        .map(|(_, _, s)| *s);
    let duration = parse_period(period).map_err(|e| e.to_string())?;
    let now = state.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let started = if preset_secs.is_none() {
        state
            .get("history_started")
            .or_else(|| state.get("started"))
            .and_then(|v| v.as_f64())
            .unwrap_or(now)
    } else {
        state.get("started").and_then(|v| v.as_f64()).unwrap_or(now)
    };
    let seconds = match (preset_secs, duration) {
        (Some(s), _) => s as f64,
        (None, PeriodDuration::All) => (now - started).max(600.0),
        (None, PeriodDuration::Seconds(s)) => s as f64,
        (None, PeriodDuration::Preset) => 3600.0,
    };
    let start = started.max(now - seconds);
    let lower = now - seconds;

    let (count, t_f, t_c, t_w, t_o): (i64, i64, i64, i64, i64) = db
        .query_row(
            "SELECT COUNT(DISTINCT sid), COALESCE(SUM(fresh),0), COALESCE(SUM(cached),0), \
             COALESCE(SUM(written),0), COALESCE(SUM(output),0) \
             FROM events WHERE t>?1 AND t<=?2 AND t>=?3",
            params![lower, now, started],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;

    let mut page_stmt = db
        .prepare(
            "SELECT sid, kind, SUM(fresh), SUM(cached), SUM(written), SUM(output), MIN(t), MAX(t) \
             FROM events WHERE t>?1 AND t<=?2 AND t>=?3 GROUP BY sid \
             ORDER BY SUM(fresh+cached+written+output) DESC, sid LIMIT ?4 OFFSET ?5",
        )
        .map_err(|e| e.to_string())?;
    let page_rows: Vec<(String, String, [i64; 4], f64, f64)> = page_stmt
        .query_map(params![lower, now, started, limit, offset], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                [
                    r.get::<_, i64>(2).unwrap_or(0),
                    r.get::<_, i64>(3).unwrap_or(0),
                    r.get::<_, i64>(4).unwrap_or(0),
                    r.get::<_, i64>(5).unwrap_or(0),
                ],
                r.get::<_, f64>(6).unwrap_or(0.0),
                r.get::<_, f64>(7).unwrap_or(0.0),
            ))
        })
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    let live: HashMap<&str, &Map<String, Value>> = state
        .get("sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_object())
                .filter_map(|s| Some((s.get("id")?.as_str()?, s)))
                .collect()
        })
        .unwrap_or_default();

    let has_catalog = db
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE name='session_catalog'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    let model_col = if has_column(db, "events", "model") {
        "model"
    } else {
        "NULL"
    };
    let cwd_col = if has_column(db, "events", "cwd") {
        "cwd"
    } else {
        "NULL"
    };

    let mut entries = Vec::with_capacity(page_rows.len());
    for (sid, kind, tokens, first, last) in page_rows {
        let stored: Option<(String, String, String, String, String)> = if has_catalog {
            db.query_row(
                "SELECT title, project, app, model, source FROM session_catalog WHERE sid=?1",
                params![sid],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    ))
                },
            )
            .ok()
        } else {
            None
        };
        let latest_sql = format!(
            "SELECT {model_col}, {cwd_col} FROM events WHERE sid=?1 AND t<=?2 ORDER BY t DESC LIMIT 1"
        );
        let latest: Option<(Option<String>, Option<String>)> = db
            .query_row(&latest_sql, params![sid, now], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .ok();
        let (st_title, st_proj, st_app, st_model, st_src) = stored.unwrap_or_else(|| {
            let proj = latest
                .as_ref()
                .and_then(|(_, c)| c.as_deref())
                .and_then(|c| Path::new(c).file_name())
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            (
                String::new(),
                proj,
                String::new(),
                String::new(),
                "events".into(),
            )
        });
        let current = live.get(sid.as_str()).copied();
        let raw_title = current
            .and_then(|c| c.get("orca_terminal"))
            .and_then(|t| t.get("title"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                current
                    .and_then(|c| c.get("thread_name"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
            })
            .or_else(|| {
                current
                    .and_then(|c| c.get("title"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
            })
            .unwrap_or(&st_title);
        let title = clean_title(raw_title, 200);
        let proj = clean_title(
            current
                .and_then(|c| c.get("project"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&st_proj),
            100,
        );
        let app = clean_title(
            if current.is_some_and(|c| c.get("orca_terminal").is_some_and(|t| t.is_object())) {
                "Orca"
            } else {
                current
                    .and_then(|c| c.get("location"))
                    .and_then(|l| l.get("app"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&st_app)
            },
            80,
        );
        let model_str = clean_title(
            latest
                .as_ref()
                .and_then(|(m, _)| m.as_deref())
                .unwrap_or(&st_model),
            160,
        );

        let mod_sql = format!(
            "SELECT {model_col}, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
             FROM events WHERE sid=?1 AND t>?2 AND t<=?3 AND t>=?4 GROUP BY 1"
        );
        let mut models = Vec::new();
        if let Ok(mut mstmt) = db.prepare(&mod_sql) {
            if let Ok(mrows) = mstmt.query_map(params![sid, lower, now, started], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    [
                        r.get::<_, i64>(1).unwrap_or(0),
                        r.get::<_, i64>(2).unwrap_or(0),
                        r.get::<_, i64>(3).unwrap_or(0),
                        r.get::<_, i64>(4).unwrap_or(0),
                    ],
                ))
            }) {
                for (m, vec4) in mrows.flatten() {
                    let cm = clean_title(m.as_deref().unwrap_or(""), 160);
                    let norm = if !cm.is_empty()
                        && !matches!(cm.to_lowercase().as_str(), "unknown" | "<synthetic>")
                    {
                        Some(cm)
                    } else {
                        None
                    };
                    models.push(json!({"model": norm, "tokens": vec4}));
                }
            }
        }
        entries.push(json!({
            "id": sid,
            "kind": kind,
            "title": if title.is_empty() { Value::Null } else { json!(title) },
            "project": if proj.is_empty() { Value::Null } else { json!(proj) },
            "app": if app.is_empty() { Value::Null } else { json!(app) },
            "model": if model_str.is_empty() { Value::Null } else { json!(model_str) },
            "identity_source": if current.is_some() { "collector" } else { st_src.as_str() },
            "listed": current.is_some(),
            "tokens": tokens,
            "models": models,
            "first_usage": first,
            "last_usage": last
        }));
    }

    let next_offset = if offset + entries.len() as i64 >= count {
        Value::Null
    } else {
        json!(offset + entries.len() as i64)
    };
    Ok(json!({
        "view": "sessions",
        "period": period,
        "as_of": now,
        "start": start,
        "end": now,
        "session_count": count,
        "tokens": [t_f, t_c, t_w, t_o],
        "offset": offset,
        "next_offset": next_offset,
        "sessions": entries
    }))
}

// ---------------- relay_data ----------------

pub fn select_keys(val: Option<&Value>, keys: &[&str]) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(obj) = val.and_then(|v| v.as_object()) else {
        return out;
    };
    for &k in keys {
        out.insert(k.to_string(), obj.get(k).cloned().unwrap_or(Value::Null));
    }
    out
}

pub fn session_identity(session: &Map<String, Value>) -> Map<String, Value> {
    let mut result = Map::new();
    for k in [
        "display_name",
        "display_detail",
        "display_status",
        "shape_unknown",
    ] {
        if let Some(v) = session.get(k) {
            result.insert(k.to_string(), v.clone());
        }
    }
    if let Some(runs) = session.get("runs").and_then(|v| v.as_array()) {
        let out_runs: Vec<Value> = runs
            .iter()
            .map(|run| {
                let mut m = select_keys(
                    Some(run),
                    &[
                        "pid",
                        "birth",
                        "role",
                        "connected",
                        "status",
                        "display_status",
                        "status_at",
                        "terminal_match",
                    ],
                );
                let term = select_keys(run.get("terminal"), &["handle", "title"]);
                m.insert(
                    "terminal".into(),
                    if term.is_empty() {
                        Value::Null
                    } else {
                        Value::Object(term)
                    },
                );
                Value::Object(m)
            })
            .collect();
        result.insert("runs".into(), Value::Array(out_runs));
    }
    result
}

pub fn period_metrics(window: &Value) -> Value {
    let mut result = select_keys(
        Some(window),
        &[
            "key",
            "label",
            "tokens",
            "partial",
            "observed_seconds",
            "seconds",
        ],
    );
    if let Some(by_model) = window.get("by_model").and_then(|v| v.as_array()) {
        let rows: Vec<Value> = by_model
            .iter()
            .map(|r| {
                Value::Object(select_keys(
                    Some(r),
                    &["kind", "model", "tokens", "session_count"],
                ))
            })
            .collect();
        result.insert("by_model".into(), Value::Array(rows));
    }
    Value::Object(result)
}

pub fn all_periods(db: &Connection, state: &Map<String, Value>) -> Map<String, Value> {
    let mut result = state.clone();
    let mut remote_flows = Map::new();

    let mut base = Map::new();
    for k in [
        "ready",
        "updated",
        "started",
        "history_started",
        "period_usage",
        "weekly_usage",
        "sessions",
    ] {
        if let Some(v) = state.get(k) {
            base.insert(k.to_string(), v.clone());
        }
    }

    let mut keys: Vec<String> = STOPS
        .iter()
        .filter(|&&n| !matches!(n, 600 | 1800 | 3600 | 18000 | 43200 | 86400))
        .map(|n| format!("custom:{n}"))
        .collect();
    keys.push("all".into());

    let updated = state.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);

    for key in keys {
        let Ok(extended) = extend_snapshot(db, &base, &key) else {
            continue;
        };
        if let Some(last_win) = extended
            .get("period_usage")
            .and_then(|p| p.get("windows"))
            .and_then(|v| v.as_array())
            .and_then(|a| a.last())
            .cloned()
        {
            if let Some(wins) = result
                .get_mut("period_usage")
                .and_then(|p| p.get_mut("windows"))
                .and_then(|v| v.as_array_mut())
            {
                wins.push(last_win);
            }
        }
        let ext_sessions: HashMap<String, &Map<String, Value>> = extended
            .get("sessions")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_object())
                    .filter_map(|s| Some((s.get("id")?.as_str()?.to_string(), s)))
                    .collect()
            })
            .unwrap_or_default();
        if let Some(res_sessions) = result.get_mut("sessions").and_then(|v| v.as_array_mut()) {
            for sv in res_sessions.iter_mut() {
                if let Some(so) = sv.as_object_mut() {
                    let sid = so.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(es) = ext_sessions.get(sid) {
                        if !so.get("usage").is_some_and(|v| v.is_object()) {
                            so.insert("usage".into(), Value::Object(Map::new()));
                        }
                        let su = so.get_mut("usage").unwrap().as_object_mut().unwrap();
                        for field in ["windows", "weekly_estimate"] {
                            if let Some(val) = es
                                .get("usage")
                                .and_then(|u| u.get(field))
                                .and_then(|m| m.get(&key))
                                .cloned()
                            {
                                if !su.get(field).is_some_and(|v| v.is_object()) {
                                    su.insert(field.into(), Value::Object(Map::new()));
                                }
                                su.get_mut(field)
                                    .unwrap()
                                    .as_object_mut()
                                    .unwrap()
                                    .insert(key.clone(), val);
                            }
                        }
                    }
                }
            }
        }
        let ext_accts: HashMap<String, Value> = extended
            .get("weekly_usage")
            .and_then(|w| w.get("accounts"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.as_object())
                    .filter_map(|a| {
                        let id = a.get("id")?.as_str()?.to_string();
                        let p = a.get("periods")?.get(&key)?.clone();
                        Some((id, p))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if let Some(res_accts) = result
            .get_mut("weekly_usage")
            .and_then(|w| w.get_mut("accounts"))
            .and_then(|v| v.as_array_mut())
        {
            for av in res_accts.iter_mut() {
                if let Some(ao) = av.as_object_mut() {
                    let id = ao.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(pval) = ext_accts.get(id) {
                        if !ao.get("periods").is_some_and(|v| v.is_object()) {
                            ao.insert("periods".into(), Value::Object(Map::new()));
                        }
                        ao.get_mut("periods")
                            .unwrap()
                            .as_object_mut()
                            .unwrap()
                            .insert(key.clone(), pval.clone());
                    }
                }
            }
        }
        if let Some(chart) = extended.get("chart_range").and_then(|v| v.as_object()) {
            let c_start = chart.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let c_end = chart.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let c_step = chart.get("step").and_then(|v| v.as_f64()).unwrap_or(60.0);
            let count = ((c_end - c_start) / c_step).ceil().max(1.0) as usize;
            let mut bins: Vec<BTreeMap<String, i64>> = vec![BTreeMap::new(); count];
            if let Some(evs) = extended.get("events").and_then(|v| v.as_array()) {
                for ev in evs {
                    let t = ev.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let slot = (((t - c_start) / c_step).floor().max(0.0) as usize).min(count - 1);
                    let kind = ev.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let sum: i64 = ["fresh", "cached", "written", "output"]
                        .iter()
                        .filter_map(|k| ev.get(*k).and_then(|v| v.as_i64()))
                        .sum();
                    *bins[slot].entry(kind.to_string()).or_insert(0) += sum;
                }
            }
            remote_flows.insert(
                key,
                json!({
                    "start": c_start,
                    "end": c_end,
                    "step": c_step,
                    "as_of": updated,
                    "reported": true,
                    "bins": bins
                }),
            );
        }
    }
    result.insert("remote_flows".into(), Value::Object(remote_flows));
    result
}

pub fn host_metrics(host: Option<&Value>) -> Map<String, Value> {
    let mut out = select_keys(
        host,
        &[
            "load",
            "uptime",
            "process_count",
            "unreadable_processes",
            "platform",
            "os",
        ],
    );
    out.insert(
        "network".into(),
        Value::Object(select_keys(
            host.and_then(|h| h.get("network")),
            &["rx", "tx", "interfaces"],
        )),
    );
    out.insert(
        "disk".into(),
        Value::Object(select_keys(
            host.and_then(|h| h.get("disk")),
            &["total", "free", "percent", "read", "write"],
        )),
    );
    out.insert(
        "swap".into(),
        Value::Object(select_keys(
            host.and_then(|h| h.get("swap")),
            &["used", "total"],
        )),
    );
    let bat = select_keys(host.and_then(|h| h.get("battery")), &["percent", "plugged"]);
    out.insert(
        "battery".into(),
        if bat.is_empty() {
            Value::Null
        } else {
            Value::Object(bat)
        },
    );
    out
}

pub fn system_metrics(system: Option<&Value>, session_ids: &HashSet<String>) -> Value {
    let mut owners = session_ids.clone();
    if let Some(shared) = system
        .and_then(|s| s.get("shared"))
        .and_then(|v| v.as_array())
    {
        for r in shared.iter().take(30) {
            if let (Some(pid), Some(id)) = (
                r.get("pid").and_then(|v| v.as_i64()),
                r.get("id").and_then(|v| v.as_str()),
            ) {
                if pid > 0 && pid <= i64::from(u32::MAX) && id == format!("backend:{pid}") {
                    owners.insert(id.to_string());
                }
            }
        }
    }
    let cpu_basis = system
        .and_then(|s| s.get("cpu_basis"))
        .and_then(|v| v.as_str())
        .filter(|b| matches!(*b, "host_total" | "single_core"));
    let history: Vec<Value> = system
        .and_then(|s| s.get("history"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            let skip = arr.len().saturating_sub(300);
            arr[skip..]
                .iter()
                .map(|r| Value::Object(select_keys(Some(r), &["t", "cpu", "memory", "rx", "tx"])))
                .collect()
        })
        .unwrap_or_default();
    let top: Vec<Value> = system
        .and_then(|s| s.get("top"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .take(15)
                .map(|r| {
                    let mut m =
                        select_keys(Some(r), &["pid", "ppid", "name", "created", "cpu", "rss"]);
                    let owner = r
                        .get("owner")
                        .and_then(|v| v.as_str())
                        .filter(|o| owners.contains(*o));
                    m.insert(
                        "owner".into(),
                        owner.map(|o| json!(o)).unwrap_or(Value::Null),
                    );
                    Value::Object(m)
                })
                .collect()
        })
        .unwrap_or_default();
    let shared_out: Vec<Value> = system
        .and_then(|s| s.get("shared"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .take(30)
                .map(|r| {
                    Value::Object(select_keys(
                        Some(r),
                        &["id", "pid", "name", "cpu", "rss", "count", "pids"],
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "cpu_basis": cpu_basis,
        "sampler_ms": system.and_then(|s| s.get("sampler_ms")).cloned().unwrap_or(Value::Null),
        "monitor": Value::Object(select_keys(system.and_then(|s| s.get("monitor")), &["pid", "cpu", "rss"])),
        "history": history,
        "top": top,
        "shared": shared_out
    })
}

pub fn public_history(data: &Value) -> Value {
    let series = data.get("series");
    let mut projects = Vec::new();
    if let Some(arr) = series
        .and_then(|s| s.get("by_project"))
        .and_then(|v| v.as_array())
    {
        for row in arr.iter().take(13) {
            let key = row.get("key").and_then(|v| v.as_str()).unwrap_or("unknown");
            let pub_key = if matches!(key, "unknown" | "__other__") {
                key.to_string()
            } else {
                format!("project:{}", sha256_hex(key.as_bytes()))
            };
            let mut m = select_keys(Some(row), &["label", "tokens", "folded"]);
            m.insert("key".into(), json!(pub_key));
            projects.push(Value::Object(m));
        }
    }
    let coverage: Vec<Value> = data
        .get("coverage")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|r| Value::Object(select_keys(Some(r), &["source", "kind", "from", "to"])))
                .collect()
        })
        .unwrap_or_default();
    let by_model: Vec<Value> = series
        .and_then(|s| s.get("by_model"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .take(13)
                .map(|r| Value::Object(select_keys(Some(r), &["key", "kind", "tokens", "folded"])))
                .collect()
        })
        .unwrap_or_default();
    let mut ser = select_keys(series, &["start", "end", "step", "bins", "total"]);
    ser.insert("by_model".into(), Value::Array(by_model));
    ser.insert("by_project".into(), Value::Array(projects));
    json!({
        "as_of": data.get("as_of").cloned().unwrap_or(Value::Null),
        "coverage": coverage,
        "series": Value::Object(ser),
        "heatmap": Value::Object(select_keys(data.get("heatmap"), &["hours", "days"]))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_period_and_labels() {
        assert_eq!(parse_period("1h"), Ok(PeriodDuration::Preset));
        assert_eq!(parse_period("all"), Ok(PeriodDuration::All));
        assert_eq!(
            parse_period("custom:7200"),
            Ok(PeriodDuration::Seconds(7200))
        );
        assert!(parse_period("custom:300").is_err());
        assert!(parse_period("custom:605").is_err());
        assert_eq!(period_label(86400 * 7), "7일");
        assert_eq!(period_label(7200), "2시간");
        assert_eq!(period_label(900), "15분");
    }
}
