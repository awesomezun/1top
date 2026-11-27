//! Exact port of `weekly_usage.py`.
use crate::usage::{has_column, WINDOWS};
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub const RETENTION: f64 = 8.0 * 86400.0;
pub const FRESH: f64 = 300.0;
pub const CLAUDE_CALIBRATION_GAP: f64 = 3600.0;
pub const CLAUDE_CALIBRATION_AGE: f64 = 86400.0;

pub type ProfileRootBinding = (String, String, f64); // (account_id, kind, since)

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    if !has_column(db, "events", "account") && has_column(db, "events", "t") {
        let _ = db.execute("ALTER TABLE events ADD COLUMN account TEXT", []);
    }
    db.execute(
        "CREATE TABLE IF NOT EXISTS weekly_samples (
            account TEXT, kind TEXT, t REAL, pct REAL, reset REAL,
            PRIMARY KEY(account, t))",
        [],
    )?;
    db.execute(
        "CREATE TABLE IF NOT EXISTS adapter_accounts (
            sid TEXT PRIMARY KEY, account TEXT, kind TEXT, since REAL)",
        [],
    )?;
    Ok(())
}

fn expand_path(raw: &str) -> PathBuf {
    let p = if let Some(rest) = raw.strip_prefix("~/") {
        crate::platform_support::home_dir().join(rest)
    } else if raw == "~" {
        crate::platform_support::home_dir()
    } else {
        PathBuf::from(raw)
    };
    std::fs::canonicalize(&p).unwrap_or(p)
}

pub fn account_for(
    spec: &Map<String, Value>,
    roots: &HashMap<PathBuf, ProfileRootBinding>,
) -> Option<(String, f64)> {
    let raw = spec
        .get("config_dir")
        .or_else(|| spec.get("path"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())?;
    let kind = spec.get("kind").and_then(|v| v.as_str())?;
    let path = expand_path(raw);
    let mut best: Option<(usize, String, f64)> = None;
    for (root, (account, rkind, since)) in roots {
        if rkind == kind && (path == *root || path.starts_with(root)) {
            let depth = root.components().count();
            if best.as_ref().is_none_or(|(bd, _, _)| depth > *bd) {
                best = Some((depth, account.clone(), *since));
            }
        }
    }
    best.map(|(_, a, s)| (a, s))
}

pub fn account_at(intervals: &[(String, String, f64, Option<f64>)], t: f64) -> Option<String> {
    let matches: HashSet<&str> = intervals
        .iter()
        .filter(|(_, _, start, end)| {
            let hi = end.map(|e| e + 2.0).unwrap_or(start + 1800.0);
            *start <= t && t <= hi
        })
        .map(|(a, _, _, _)| a.as_str())
        .collect();
    if matches.len() == 1 {
        matches.into_iter().next().map(str::to_string)
    } else {
        None
    }
}

pub fn event_account(spec: &Map<String, Value>, timestamp: f64) -> Option<String> {
    if let Some(arr) = spec.get("_routing_intervals").and_then(|v| v.as_array()) {
        let mut intervals = Vec::new();
        let mut min_start = f64::INFINITY;
        for row in arr {
            if let Some(r) = row.as_array() {
                if r.len() >= 4 {
                    if let (Some(a), Some(k), Some(s)) =
                        (r[0].as_str(), r[1].as_str(), r[2].as_f64())
                    {
                        min_start = min_start.min(s);
                        intervals.push((a.to_string(), k.to_string(), s, r[3].as_f64()));
                    }
                }
            }
        }
        if !intervals.is_empty() && timestamp >= min_start {
            return account_at(&intervals, timestamp);
        }
    }
    let binding = spec
        .get("_routing_original_binding")
        .or_else(|| spec.get("account_binding"))
        .and_then(|v| v.as_array());
    if let Some(b) = binding {
        if b.len() >= 2 {
            if let (Some(acct), Some(since)) = (b[0].as_str(), b[1].as_f64()) {
                if timestamp >= since {
                    return Some(acct.to_string());
                }
            }
        }
    }
    None
}

pub fn bind_adapter(
    db: &Connection,
    spec: &Map<String, Value>,
    roots: &HashMap<PathBuf, ProfileRootBinding>,
    now: f64,
) -> Option<(String, f64)> {
    let sid = spec.get("id").and_then(|v| v.as_str())?;
    let account = spec.get("billing_account").and_then(|v| v.as_str());
    let kind = spec.get("billing_kind").and_then(|v| v.as_str());
    let known = match (account, kind) {
        (Some(a), Some(k)) => roots.values().any(|(ra, rk, _)| ra == a && rk == k),
        _ => false,
    };
    let prev: Option<(Option<String>, Option<String>, f64)> = db
        .query_row(
            "SELECT account, kind, since FROM adapter_accounts WHERE sid=?1",
            params![sid],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    let since = match prev {
        Some((pa, pk, ps)) if pa.as_deref() == account && pk.as_deref() == kind => ps,
        _ => now,
    };
    let stored_acct = if known { account } else { None };
    let _ = db.execute(
        "INSERT OR REPLACE INTO adapter_accounts VALUES(?1,?2,?3,?4)",
        params![sid, stored_acct, kind, since],
    );
    if known {
        account.map(|a| (a.to_string(), since))
    } else {
        None
    }
}

pub fn record(db: &Connection, quotas: &[Value], now: f64) -> rusqlite::Result<()> {
    for q in quotas {
        let Some(qo) = q.as_object() else {
            continue;
        };
        if qo.get("identity_verified").and_then(|v| v.as_bool()) == Some(false) {
            continue;
        }
        if qo.get("stale").and_then(|v| v.as_bool()).unwrap_or(true) {
            continue;
        }
        let Some(t) = qo
            .get("updated")
            .and_then(|v| v.as_f64())
            .filter(|x| x.is_finite())
        else {
            continue;
        };
        let age = now - t;
        if !(0.0..=FRESH).contains(&age) {
            continue;
        }
        let weekly = qo
            .get("windows")
            .and_then(|v| v.as_array())
            .and_then(|ws| {
                ws.iter()
                    .find(|w| w.get("label").and_then(|v| v.as_str()) == Some("주간"))
            })
            .and_then(|w| w.as_object());
        let Some(w) = weekly else {
            continue;
        };
        let Some(pct) = w
            .get("pct")
            .and_then(|v| v.as_f64())
            .filter(|x| x.is_finite() && (0.0..=100.0).contains(x))
        else {
            continue;
        };
        let Some(reset) = w
            .get("reset")
            .and_then(|v| v.as_f64())
            .filter(|x| x.is_finite() && *x > now)
        else {
            continue;
        };
        let Some(id) = qo.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(kind) = qo.get("kind").and_then(|v| v.as_str()) else {
            continue;
        };
        db.execute(
            "INSERT OR IGNORE INTO weekly_samples VALUES(?1,?2,?3,?4,?5)",
            params![id, kind, t, pct, reset],
        )?;
    }
    db.execute(
        "DELETE FROM weekly_samples WHERE t<?1",
        params![now - RETENTION],
    )?;
    Ok(())
}

pub fn restore_claude_last_report(db: &Connection, quotas: &mut [Value], now: f64) {
    for q in quotas.iter_mut() {
        let Some(qo) = q.as_object_mut() else {
            continue;
        };
        if qo.get("kind").and_then(|v| v.as_str()) != Some("Claude") {
            continue;
        }
        let Some(qid) = qo.get("id").and_then(|v| v.as_str()).map(str::to_string) else {
            continue;
        };
        if qid.is_empty() {
            continue;
        }
        let mut windows: Vec<Value> = qo
            .get("windows")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let weekly = windows
            .iter()
            .find(|w| w.get("label").and_then(|v| v.as_str()) == Some("주간"))
            .and_then(|w| w.as_object())
            .cloned();
        let val = weekly
            .as_ref()
            .and_then(|w| w.get("pct"))
            .and_then(|v| v.as_f64())
            .filter(|x| x.is_finite());
        let reset = weekly
            .as_ref()
            .and_then(|w| w.get("reset"))
            .and_then(|v| v.as_f64())
            .filter(|x| x.is_finite());
        let statusline = qo.get("source").and_then(|v| v.as_str()) == Some("claude_statusline");
        let initial =
            statusline && qo.get("verified_activity").and_then(|v| v.as_bool()) != Some(true);
        if !statusline {
            if val.is_some_and(|v| (0.0..=100.0).contains(&v)) {
                continue;
            }
            if reset.is_some_and(|r| r > 0.0 && r <= now) {
                continue;
            }
        }
        let previous: Option<(f64, f64, f64)> = db
            .query_row(
                "SELECT t, pct, reset FROM weekly_samples \
                 WHERE account=?1 AND kind='Claude' AND t>=?2 AND t<=?3 ORDER BY t DESC LIMIT 1",
                params![qid, now - RETENTION, now],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        let Some((reported, prev_val, prev_reset)) = previous else {
            continue;
        };
        if !reported.is_finite()
            || !prev_val.is_finite()
            || !prev_reset.is_finite()
            || !(0.0..=100.0).contains(&prev_val)
            || prev_reset <= now
        {
            continue;
        }
        let same_cycle = reset.is_some_and(|r| r > now && (r - prev_reset).abs() <= 60.0);
        let conflicting =
            statusline && reset.is_some_and(|r| r > 0.0 && (r - prev_reset).abs() > 60.0);
        if initial || conflicting {
            qo.insert("stale".into(), json!(true));
            qo.insert("status".into(), json!("last_report"));
            qo.insert(
                "note".into(),
                json!("Claude Code 마지막 보고값 · 다음 응답에서 갱신"),
            );
            if !same_cycle {
                windows = windows
                    .iter()
                    .map(|item| {
                        json!({
                            "label": item.get("label").cloned().unwrap_or(Value::Null),
                            "pct": Value::Null,
                            "reset": 0
                        })
                    })
                    .collect();
            } else if val.is_some_and(|v| prev_val <= v && v <= 100.0) {
                continue;
            }
        } else {
            if val.is_some_and(|v| (0.0..=100.0).contains(&v)) {
                continue;
            }
            if reset.is_some_and(|r| r > 0.0 && r <= now) {
                continue;
            }
            if qo
                .get("updated")
                .and_then(|v| v.as_f64())
                .is_some_and(|u| u.is_finite() && u > reported)
            {
                continue;
            }
            if reset.is_some_and(|r| r > 0.0 && (r - prev_reset).abs() > 60.0) {
                continue;
            }
        }
        let restored = json!({"label": "주간", "pct": prev_val, "reset": prev_reset});
        let mut replaced = false;
        for w in &mut windows {
            if w.get("label").and_then(|v| v.as_str()) == Some("주간") {
                *w = restored.clone();
                replaced = true;
            }
        }
        if !replaced {
            windows.push(restored);
        }
        qo.insert("windows".into(), Value::Array(windows));
        qo.insert("updated".into(), json!(reported));
        qo.insert("stale".into(), json!(true));
        qo.insert("status".into(), json!("last_report"));
        qo.insert("source".into(), json!("historical_provider_report"));
        qo.insert(
            "note".into(),
            json!("Claude Code 마지막 보고값 · 다음 응답에서 갱신"),
        );
        qo.remove("verified_activity");
    }
}

pub fn interval(before: (f64, f64, f64), after: (f64, f64, f64)) -> (Option<f64>, bool) {
    let (t0, p0, r0) = before;
    let (t1, p1, r1) = after;
    if (r1 - r0).abs() <= 60.0 {
        return if p1 >= p0 {
            (Some(p1 - p0), false)
        } else {
            (None, true)
        };
    }
    if p0 == 0.0 && p1 == 0.0 && r0 > t1 && r1 > t1 {
        return (Some(0.0), true);
    }
    if r1 > r0 && t0 < r0 && r0 <= t1 {
        return (Some(p1), true);
    }
    (None, true)
}

pub fn reconciled_history(points: &[(f64, f64, f64)]) -> (Vec<(f64, f64, f64)>, Vec<f64>, usize) {
    let mut retained = Vec::new();
    let mut corrections = Vec::new();
    let mut excluded = 0usize;
    let mut start = 0usize;
    for index in 1..=points.len() {
        if index < points.len() && (points[index].2 - points[index - 1].2).abs() <= 60.0 {
            continue;
        }
        let cycle = &points[start..index];
        for pair in cycle.windows(2) {
            if pair[1].1 < pair[0].1 {
                corrections.push(pair[1].0);
            }
        }
        let mut ceiling: Option<f64> = None;
        let mut clean = Vec::new();
        for &pt in cycle.iter().rev() {
            if let Some(c) = ceiling {
                if pt.1 > c {
                    excluded += 1;
                    continue;
                }
            }
            clean.push(pt);
            ceiling = Some(pt.1);
        }
        clean.reverse();
        retained.extend(clean);
        start = index;
    }
    (retained, corrections, excluded)
}

struct Obs {
    t0: f64,
    t1: f64,
    delta: Option<f64>,
    uncertain: bool,
    weights: HashMap<String, i64>,
}

pub type WeeklySnapshotResult = (Value, HashMap<String, Map<String, Value>>);
type SessionEventRow = (f64, Option<String>, String, i64);

/// Exact port of `weekly_usage.py:snapshot`.
pub fn snapshot(
    db: &Connection,
    quotas: &[Value],
    now: f64,
    explicit_bindings: Option<&HashMap<String, String>>,
    recording_started: Option<f64>,
) -> rusqlite::Result<WeeklySnapshotResult> {
    let mut history: HashMap<String, Vec<(f64, f64, f64)>> = HashMap::new();
    {
        let mut stmt = db.prepare(
            "SELECT account, t, pct, reset FROM weekly_samples \
             WHERE t>=?1 AND t<=?2 ORDER BY t",
        )?;
        let rows = stmt.query_map(params![now - 86400.0 - FRESH, now], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, f64>(3)?,
            ))
        })?;
        for (acct, t, pct, reset) in rows.flatten() {
            history.entry(acct).or_default().push((t, pct, reset));
        }
    }

    let mut events_by_acct: HashMap<String, Vec<(f64, String, i64)>> = HashMap::new();
    let mut session_events: HashMap<String, Vec<SessionEventRow>> = HashMap::new();
    let mut unbound: HashMap<String, Vec<f64>> = HashMap::new();
    let mut adapter_kinds: HashMap<String, String> = HashMap::new();
    if let Ok(mut stmt) = db.prepare("SELECT sid, kind FROM adapter_accounts") {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        }) {
            for (sid, k) in rows.flatten() {
                if let Some(ks) = k {
                    adapter_kinds.insert(sid, ks);
                }
            }
        }
    }

    if has_column(db, "events", "account") {
        let mut stmt = db.prepare(
            "SELECT account, sid, kind, t, fresh+cached+written+output \
             FROM events WHERE t>?1 AND t<=?2 ORDER BY t",
        )?;
        let rows = stmt.query_map(params![now - 86400.0 - FRESH, now], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, i64>(4).unwrap_or(0),
            ))
        })?;
        for (account, sid, mut kind, t, total) in rows.flatten() {
            if total <= 0 {
                continue;
            }
            if kind == "Aside" {
                let q_kind = account.as_deref().and_then(|aid| {
                    quotas.iter().find_map(|q| {
                        if q.get("id").and_then(|v| v.as_str()) == Some(aid) {
                            q.get("kind").and_then(|v| v.as_str()).map(str::to_string)
                        } else {
                            None
                        }
                    })
                });
                kind = q_kind
                    .or_else(|| adapter_kinds.get(&sid).cloned())
                    .unwrap_or_else(|| "Aside".into());
            }
            session_events.entry(sid.clone()).or_default().push((
                t,
                account.clone(),
                kind.clone(),
                total,
            ));
            if let Some(acct) = account {
                events_by_acct
                    .entry(acct)
                    .or_default()
                    .push((t, sid, total));
            } else {
                unbound.entry(kind).or_default().push(t);
            }
        }
    }

    let derived_bindings: HashMap<String, String>;
    let bindings = if let Some(b) = explicit_bindings {
        b
    } else {
        let mut sac: HashMap<String, HashSet<String>> = HashMap::new();
        for (acct, rows) in &events_by_acct {
            for (_, sid, _) in rows {
                sac.entry(sid.clone()).or_default().insert(acct.clone());
            }
        }
        derived_bindings = sac
            .into_iter()
            .filter_map(|(sid, set)| {
                if set.len() == 1 {
                    Some((sid, set.into_iter().next().unwrap()))
                } else {
                    None
                }
            })
            .collect();
        &derived_bindings
    };

    let mut result = Vec::new();
    let mut shares: HashMap<String, Map<String, Value>> = HashMap::new();

    for qv in quotas {
        let Some(quota) = qv.as_object() else {
            continue;
        };
        let Some(account) = quota.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(qkind) = quota.get("kind").and_then(|v| v.as_str()) else {
            continue;
        };
        let raw_pts = history.get(account).map(Vec::as_slice).unwrap_or(&[]);
        let (points, corrections, excluded) = reconciled_history(raw_pts);
        let qsource = quota.get("source").and_then(|v| v.as_str());
        let claude_history = qkind == "Claude"
            && matches!(
                qsource,
                Some("claude_statusline" | "historical_provider_report" | "claude_oauth")
            );
        let calibration_gap = if claude_history {
            CLAUDE_CALIBRATION_GAP
        } else {
            FRESH
        };

        let acct_events = events_by_acct
            .get(account)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let mut observations = Vec::new();
        let mut event_index = 0usize;
        for pair in points.windows(2) {
            let t0 = pair[0].0;
            let t1 = pair[1].0;
            let (delta, mut uncertain) = interval(pair[0], pair[1]);
            if corrections.iter().any(|&c| t0 < c && c <= t1) {
                uncertain = true;
            }
            let mut weights: HashMap<String, i64> = HashMap::new();
            while event_index < acct_events.len() && acct_events[event_index].0 <= t1 {
                let (et, ref esid, etok) = acct_events[event_index];
                event_index += 1;
                if et > t0 {
                    *weights.entry(esid.clone()).or_insert(0) += etok;
                }
            }
            let settled = t1 <= now - 10.0;
            observations.push(Obs {
                t0,
                t1,
                delta,
                uncertain,
                weights: if settled && t1 - t0 <= calibration_gap {
                    weights
                } else {
                    HashMap::new()
                },
            });
        }

        let current_reset = points.last().map(|p| p.2);
        let account_observed_since = acct_events.first().map(|e| e.0);
        let kind_unbound = unbound.get(qkind).map(Vec::as_slice).unwrap_or(&[]);
        let mut eligible: Vec<&Obs> = Vec::new();
        let mut earlier: Vec<&Obs> = Vec::new();
        let mut pending_tokens: i64 = 0;
        let mut pending_end: Option<f64> = None;

        for (idx, o) in observations.iter().enumerate() {
            let same_cycle = current_reset.is_some_and(|cr| {
                (points[idx].2 - cr).abs() <= 60.0 && (points[idx + 1].2 - cr).abs() <= 60.0
            });
            let missing = kind_unbound.iter().any(|&t| o.t0 < t && t <= o.t1);
            let after_corr = corrections.last().is_none_or(|&c| o.t0 >= c);
            let attr_started = !claude_history || account_observed_since.is_some_and(|s| s <= o.t0);
            let settled_iv = o.t1 <= now - 10.0 && o.t1 - o.t0 <= calibration_gap;
            let complete = same_cycle
                && attr_started
                && settled_iv
                && !o.uncertain
                && o.delta.is_some()
                && !missing;
            if !complete {
                pending_tokens = 0;
                pending_end = None;
                continue;
            }
            if pending_end != Some(o.t0) {
                pending_tokens = 0;
            }
            let wsum: i64 = o.weights.values().sum();
            pending_tokens += wsum;
            pending_end = Some(o.t1);
            let d = o.delta.unwrap();
            if d > 0.0 && pending_tokens <= 0 {
                continue;
            }
            if after_corr {
                eligible.push(o);
            } else {
                earlier.push(o);
            }
            if d > 0.0 {
                pending_tokens = 0;
            }
        }

        let is_ready = |rows: &[&Obs]| -> bool {
            let toks: i64 = rows.iter().map(|o| o.weights.values().sum::<i64>()).sum();
            let pp: f64 = rows.iter().filter_map(|o| o.delta).sum();
            let secs: f64 = rows.iter().map(|o| o.t1 - o.t0).sum();
            toks > 0 && pp >= 1.0 && secs >= 120.0
        };
        let reused_earlier = claude_history && !is_ready(&eligible) && is_ready(&earlier);
        if reused_earlier {
            eligible = earlier;
        }

        let cal_tokens: i64 = eligible
            .iter()
            .map(|o| o.weights.values().sum::<i64>())
            .sum();
        let cal_pp: f64 = eligible.iter().filter_map(|o| o.delta).sum();
        let cal_secs: f64 = eligible.iter().map(|o| o.t1 - o.t0).sum();
        let weekly_win = quota
            .get("windows")
            .and_then(|v| v.as_array())
            .and_then(|ws| {
                ws.iter()
                    .find(|w| w.get("label").and_then(|v| v.as_str()) == Some("주간"))
            });
        let reported_reset = weekly_win
            .and_then(|w| w.get("reset"))
            .and_then(|v| v.as_f64())
            .filter(|x| x.is_finite());
        let historical_valid = claude_history
            && !eligible.is_empty()
            && reported_reset.is_some_and(|rr| {
                rr > now && current_reset.is_some_and(|cr| (rr - cr).abs() <= 60.0)
            })
            && {
                let age = now - eligible.last().unwrap().t1;
                (0.0..=CLAUDE_CALIBRATION_AGE).contains(&age)
            };
        let usable = cal_tokens > 0
            && cal_pp >= 1.0
            && cal_secs >= 120.0
            && current_reset.is_some_and(|cr| cr > now)
            && if claude_history {
                historical_valid
            } else {
                !quota
                    .get("stale")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    && points.last().is_some_and(|p| now - p.0 <= FRESH)
            };

        let calibration: Option<Value> = if usable {
            let pp_per_tok = cal_pp / cal_tokens as f64;
            let from_t = eligible.first().unwrap().t0;
            let to_t = eligible.last().unwrap().t1;
            let mut m = Map::new();
            m.insert("tokens".into(), json!(cal_tokens));
            m.insert(
                "used_pp".into(),
                json!((cal_pp * 10000.0).round_ties_even() / 10000.0),
            );
            m.insert("seconds".into(), json!(cal_secs));
            m.insert("from".into(), json!(from_t));
            m.insert("to".into(), json!(to_t));
            m.insert("pp_per_token".into(), json!(pp_per_tok));
            m.insert(
                "confidence".into(),
                json!(if cal_secs < 600.0 || cal_pp < 3.0 {
                    "early"
                } else {
                    "limited"
                }),
            );
            if historical_valid {
                let rr = reported_reset.unwrap();
                m.insert("source".into(), json!("historical_provider_calibration"));
                m.insert("kind".into(), json!("Claude"));
                m.insert("reset".into(), json!(rr));
                m.insert(
                    "valid_until".into(),
                    json!(rr.min(to_t + CLAUDE_CALIBRATION_AGE)),
                );
                m.insert("age_seconds".into(), json!((now - to_t).max(0.0)));
                m.insert(
                    "report_source".into(),
                    qsource.map(|s| json!(s)).unwrap_or(Value::Null),
                );
                m.insert(
                    "account_observed_since".into(),
                    account_observed_since
                        .map(|s| json!(s))
                        .unwrap_or(Value::Null),
                );
                m.insert("reused_before_correction".into(), json!(reused_earlier));
            }
            Some(Value::Object(m))
        } else {
            None
        };

        let mut periods = Map::new();
        for &(key, _, secs) in &WINDOWS {
            let secs_f = secs as f64;
            let start = now - secs_f;
            let chunks: Vec<&Obs> = observations
                .iter()
                .filter(|o| o.t0 >= start && o.t1 <= now && o.delta.is_some())
                .collect();
            let covered: f64 = chunks.iter().map(|o| o.t1 - o.t0).sum();
            let partial = chunks.is_empty()
                || chunks[0].t0 > start + FRESH
                || now - chunks.last().unwrap().t1 > FRESH
                || chunks.iter().any(|o| o.uncertain || o.t1 - o.t0 > FRESH)
                || chunks.windows(2).any(|p| p[0].t1 != p[1].t0);
            let value = if chunks.is_empty() {
                None
            } else {
                Some(chunks.iter().filter_map(|o| o.delta).sum::<f64>())
            };
            let mut unattributed = 0.0_f64;
            for o in &chunks {
                let d = o.delta.unwrap();
                if o.uncertain || o.weights.is_empty() || o.t1 - o.t0 > FRESH {
                    unattributed += d;
                }
            }
            periods.insert(
                key.to_string(),
                json!({
                    "used_pp": value.map(|v| (v * 10000.0).round_ties_even() / 10000.0),
                    "partial": partial,
                    "observed_seconds": covered,
                    "unattributed_pp": (unattributed * 10000.0).round_ties_even() / 10000.0,
                    "observed_from": chunks.first().map(|o| o.t0),
                    "observed_to": chunks.last().map(|o| o.t1),
                    "sample_count": if chunks.is_empty() { points.len() } else { chunks.len() + 1 }
                }),
            );

            if let Some(ref cal) = calibration {
                let pp_per_tok = cal
                    .get("pp_per_token")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0);
                for (sid, bound_acct) in bindings {
                    if bound_acct != account {
                        continue;
                    }
                    let Some(srows) = session_events.get(sid) else {
                        continue;
                    };
                    let period_rows: Vec<&(f64, Option<String>, String, i64)> = srows
                        .iter()
                        .filter(|r| start < r.0 && r.0 <= now && r.2 == qkind)
                        .collect();
                    let other_accounts = period_rows
                        .iter()
                        .any(|r| r.1.as_deref().is_some_and(|a| a != account));
                    let accepted: Vec<&&(f64, Option<String>, String, i64)> = period_rows
                        .iter()
                        .filter(|r| {
                            r.1.as_deref() == Some(account) || (r.1.is_none() && !other_accounts)
                        })
                        .collect();
                    if accepted.is_empty() {
                        continue;
                    }
                    let tokens: i64 = accepted.iter().map(|r| r.3).sum();
                    let inferred: i64 =
                        accepted.iter().filter(|r| r.1.is_none()).map(|r| r.3).sum();
                    let total_p: i64 = period_rows.iter().map(|r| r.3).sum();
                    let est_val = tokens as f64 * pp_per_tok;
                    if !est_val.is_finite() {
                        continue;
                    }
                    shares.entry(sid.clone()).or_default().insert(
                        key.to_string(),
                        json!({
                            "used_pp": (est_val * 10000.0).round_ties_even() / 10000.0,
                            "account_id": account,
                            "basis": "calibrated_token_equivalent",
                            "tokens": tokens,
                            "partial": other_accounts || recording_started.unwrap_or(now) > start,
                            "excluded_account_tokens": total_p - tokens,
                            "period_seconds": secs,
                            "calibration": cal,
                            "inferred_account_tokens": inferred
                        }),
                    );
                }
            }
        }

        let step = ((points.len() as f64) / 95.0).ceil().max(1.0) as usize;
        let mut chart: Vec<[f64; 2]> = points
            .iter()
            .step_by(step)
            .map(|&(t, p, _)| [t, p])
            .collect();
        if let Some(&(t, p, _)) = points.last() {
            if chart.last() != Some(&[t, p]) {
                chart.push([t, p]);
            }
        }
        let flow: Vec<[f64; 3]> = observations
            .iter()
            .filter_map(|o| {
                let d = o.delta?;
                if !o.uncertain
                    && d.is_finite()
                    && d >= 0.0
                    && now - 86400.0 <= o.t0
                    && o.t0 < o.t1
                    && o.t1 <= now
                    && o.t1 - o.t0 <= FRESH
                {
                    Some([o.t0, o.t1, d])
                } else {
                    None
                }
            })
            .collect();
        let usage_points: Vec<[f64; 3]> = points.iter().map(|&(t, p, r)| [t, p, r]).collect();
        let increase_intervals: Vec<Value> = observations
            .iter()
            .filter(|o| now - 86400.0 <= o.t0 && o.t0 < o.t1 && o.t1 <= now)
            .map(|o| json!([o.t0, o.t1, o.delta, o.uncertain]))
            .collect();

        result.push(json!({
            "id": account,
            "kind": qkind,
            "periods": periods,
            "calibration": calibration,
            "history": chart,
            "flow": flow,
            "usage_points": usage_points,
            "history_quality": {
                "reconciled": !corrections.is_empty(),
                "excluded_samples": excluded,
                "correction_count": corrections.len(),
                "last_correction": corrections.last().copied()
            },
            "increase_intervals": increase_intervals
        }));
    }

    Ok((
        json!({
            "accounts": result,
            "basis": "provider_weekly_percentage",
            "as_of": now
        }),
        shares,
    ))
}

pub fn restore_bound_claude_accounts(
    db: &Connection,
    quotas: &mut Vec<Value>,
    sessions: &[Value],
    now: f64,
    statusline_report_fn: impl Fn(&Path, &str, f64) -> Option<Map<String, Value>>,
) {
    let mut known_idx: HashMap<String, usize> = HashMap::new();
    for (i, q) in quotas.iter().enumerate() {
        if let Some(id) = q.get("id").and_then(|v| v.as_str()) {
            known_idx.insert(id.to_string(), i);
        }
    }
    for sv in sessions {
        let Some(s) = sv.as_object() else {
            continue;
        };
        if s.get("kind").and_then(|v| v.as_str()) != Some("Claude") {
            continue;
        }
        let bsrc = s
            .get("account_binding_source")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !matches!(bsrc, "claude_statusline_session" | "otel_session_identity") {
            continue;
        }
        let Some(account) = s
            .get("account_binding")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .map(str::to_string)
        else {
            continue;
        };
        let report = s
            .get("config_dir")
            .and_then(|v| v.as_str())
            .filter(|p| !p.is_empty())
            .and_then(|p| statusline_report_fn(Path::new(p), &account, now));
        if let Some(rep) = report {
            let verified = rep
                .get("verified_activity")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let rep_upd = rep.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let existing_upd = known_idx
                .get(&account)
                .and_then(|&i| quotas[i].get("updated").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            if verified && (!known_idx.contains_key(&account) || rep_upd >= existing_upd) {
                let idx = if let Some(&i) = known_idx.get(&account) {
                    i
                } else {
                    let tail = if account.len() >= 6 {
                        &account[account.len() - 6..]
                    } else {
                        &account
                    };
                    quotas.push(json!({
                        "id": account,
                        "kind": "Claude",
                        "account_label": format!("Claude · {tail}"),
                        "plan": ""
                    }));
                    let ni = quotas.len() - 1;
                    known_idx.insert(account.clone(), ni);
                    ni
                };
                if let Some(qo) = quotas[idx].as_object_mut() {
                    for (k, v) in rep {
                        qo.insert(k, v);
                    }
                    qo.insert("stale".into(), json!(now - rep_upd > FRESH));
                    qo.insert("note".into(), json!("Claude Code 상태줄 보고"));
                }
                continue;
            }
        }
        if known_idx.contains_key(&account) {
            continue;
        }
        let row: Option<(f64, f64, f64)> = db
            .query_row(
                "SELECT t, pct, reset FROM weekly_samples \
                 WHERE account=?1 AND kind='Claude' AND t>=?2 AND t<=?3 ORDER BY t DESC LIMIT 1",
                params![account, now - RETENTION, now],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .ok();
        if let Some((t, pct, reset)) = row {
            if t.is_finite()
                && pct.is_finite()
                && reset.is_finite()
                && (0.0..=100.0).contains(&pct)
                && reset > now
            {
                let tail = if account.len() >= 6 {
                    &account[account.len() - 6..]
                } else {
                    &account
                };
                quotas.push(json!({
                    "id": account,
                    "kind": "Claude",
                    "account_label": format!("Claude · {tail}"),
                    "plan": "",
                    "updated": t,
                    "stale": true,
                    "status": "last_report",
                    "source": "historical_provider_report",
                    "note": "Claude Code 마지막 보고값",
                    "windows": [{"label": "주간", "pct": pct, "reset": reset}]
                }));
                known_idx.insert(account, quotas.len() - 1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconciliation_removes_overshoot() {
        let pts = vec![
            (100.0, 10.0, 5000.0),
            (200.0, 15.0, 5000.0),
            (300.0, 12.0, 5000.0),
            (400.0, 18.0, 5000.0),
        ];
        let (clean, corrs, excl) = reconciled_history(&pts);
        assert_eq!(excl, 1);
        assert_eq!(corrs, vec![300.0]);
        assert_eq!(clean.len(), 3);
        assert_eq!(clean[1].1, 12.0);
    }
}
