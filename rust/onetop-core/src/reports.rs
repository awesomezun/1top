//! Exact port of `reports.py`.
use crate::pricing;
use chrono::{Datelike, Duration, Local, LocalResult, NaiveDate, TimeZone, Timelike};
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DAY: f64 = 86400.0;
pub const GAP: f64 = 120.0;
pub const WRITE_EVERY: f64 = 30.0;
pub const KEEP_DAYS: f64 = 90.0;
pub const SIX_HOURS: f64 = 6.0 * 3600.0;
const WEEKDAYS: [&str; 7] = ["월", "화", "수", "목", "금", "토", "일"];
const PLAN_KINDS: [&str; 4] = ["Claude", "Codex", "GLM", "Antigravity"];

static FILE_LOCK: Mutex<()> = Mutex::new(());

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS state_spans(sid TEXT, kind TEXT, state TEXT, label TEXT, start REAL, end REAL);
         CREATE INDEX IF NOT EXISTS state_span_end ON state_spans(end);",
    )
}

fn local_dt(t: f64) -> chrono::DateTime<Local> {
    Local
        .timestamp_opt(t.floor() as i64, 0)
        .single()
        .unwrap_or_else(Local::now)
}

fn local_date_ts(d: NaiveDate) -> f64 {
    let naive = d.and_hms_opt(0, 0, 0).unwrap();
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => dt.timestamp() as f64,
        LocalResult::None => naive.and_utc().timestamp() as f64,
    }
}

pub fn month_start(t: f64) -> f64 {
    let d = local_dt(t);
    let first = NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap();
    local_date_ts(first)
}

pub fn add_months(t: f64, n: i32) -> f64 {
    let d = local_dt(t);
    let total_m = (d.month() as i32 - 1) + n;
    let y_off = total_m.div_euclid(12);
    let m0 = total_m.rem_euclid(12) as u32;
    let first = NaiveDate::from_ymd_opt(d.year() + y_off, m0 + 1, 1).unwrap();
    local_date_ts(first)
}

pub fn week_start(t: f64) -> f64 {
    let d = local_dt(t);
    let wd = d.weekday().num_days_from_monday() as i64;
    let monday = d.date_naive() - Duration::days(wd);
    local_date_ts(monday)
}

pub fn clock(t: f64) -> String {
    let d = local_dt(t);
    let ampm = if d.hour() < 12 { "오전" } else { "오후" };
    let h12 = if d.hour().is_multiple_of(12) {
        12
    } else {
        d.hour() % 12
    };
    format!("{ampm} {h12:02}:{:02}", d.minute())
}

pub fn when(t: f64, now: f64) -> String {
    let d = local_dt(t).date_naive();
    let n = local_dt(now).date_naive();
    let days = (d - n).num_days();
    let day = if days == 0 {
        "오늘".to_string()
    } else if days == 1 {
        "내일".to_string()
    } else if days > 0 && days < 7 {
        format!(
            "{}요일",
            WEEKDAYS[d.weekday().num_days_from_monday() as usize]
        )
    } else {
        format!("{}월 {}일", d.month(), d.day())
    };
    format!("{day} {}", clock(t))
}

pub fn duration_text(seconds: f64) -> String {
    let m = ((seconds / 60.0).round_ties_even() as i64).max(0);
    let h = m / 60;
    let rem = m % 60;
    if h > 0 && rem > 0 {
        format!("{h}시간 {rem}분")
    } else if h > 0 {
        format!("{h}시간")
    } else {
        format!("{rem}분")
    }
}

fn span_label(s: &Map<String, Value>) -> String {
    let raw = s
        .get("project")
        .or_else(|| s.get("title"))
        .or_else(|| s.get("kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let norm = raw.replace('\\', "/");
    let last = norm.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    last.chars().take(60).collect()
}

fn span_state(s: &Map<String, Value>) -> Option<&'static str> {
    if s.get("children_working")
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
        > 0
    {
        return Some("working");
    }
    let st = s
        .get("display_status")
        .or_else(|| s.get("status"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match st {
        "working" => Some("working"),
        "waiting" => Some("waiting"),
        _ => None,
    }
}

#[derive(Debug, Clone)]
struct OpenSpan {
    row: i64,
    state: &'static str,
    last: f64,
    written: f64,
}

#[derive(Debug, Default)]
pub struct Spans {
    open: HashMap<String, OpenSpan>,
}

impl Spans {
    pub fn new() -> Self {
        Self::default()
    }

    fn close_span(&mut self, db: &Connection, sid: &str, end: f64) -> rusqlite::Result<()> {
        if let Some(span) = self.open.remove(sid) {
            db.execute(
                "UPDATE state_spans SET end=?1 WHERE rowid=?2",
                params![end, span.row],
            )?;
        }
        Ok(())
    }

    pub fn record(
        &mut self,
        db: &Connection,
        sessions: &[Value],
        now: f64,
    ) -> rusqlite::Result<()> {
        let mut seen = HashSet::new();
        for sv in sessions {
            let Some(s) = sv.as_object() else {
                continue;
            };
            if s.get("is_subagent")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                continue;
            }
            let Some(sid) = s
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
            else {
                continue;
            };
            let state = span_state(s);
            seen.insert(sid.to_string());
            if let Some(existing) = self.open.get(sid) {
                let gap_exceeded = now - existing.last > GAP;
                if Some(existing.state) != state || gap_exceeded {
                    let end = if gap_exceeded { existing.last } else { now };
                    self.close_span(db, sid, end)?;
                }
            }
            let Some(st) = state else {
                continue;
            };
            if let Some(span) = self.open.get_mut(sid) {
                span.last = now;
                if now - span.written >= WRITE_EVERY {
                    db.execute(
                        "UPDATE state_spans SET end=?1 WHERE rowid=?2",
                        params![now, span.row],
                    )?;
                    span.written = now;
                }
            } else {
                let kind = s.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                let lbl = span_label(s);
                db.execute(
                    "INSERT INTO state_spans(sid,kind,state,label,start,end) VALUES(?1,?2,?3,?4,?5,?6)",
                    params![sid, kind, st, lbl, now, now],
                )?;
                let row = db.last_insert_rowid();
                self.open.insert(
                    sid.to_string(),
                    OpenSpan {
                        row,
                        state: st,
                        last: now,
                        written: now,
                    },
                );
            }
        }
        let unseen: Vec<(String, f64)> = self
            .open
            .iter()
            .filter(|(k, _)| !seen.contains(*k))
            .map(|(k, v)| (k.clone(), v.last))
            .collect();
        for (sid, last) in unseen {
            self.close_span(db, &sid, last)?;
        }
        db.execute(
            "DELETE FROM state_spans WHERE end<?1",
            params![now - KEEP_DAYS * DAY],
        )?;
        Ok(())
    }
}

type SpanRow = (String, String, String, String, f64, f64);

fn clip_rows(rows: &[SpanRow], a: f64, b: f64) -> Vec<SpanRow> {
    rows.iter()
        .filter_map(|(sid, kind, st, lbl, s, e)| {
            let cs = s.max(a);
            let ce = e.min(b);
            if ce > cs {
                Some((sid.clone(), kind.clone(), st.clone(), lbl.clone(), cs, ce))
            } else {
                None
            }
        })
        .collect()
}

fn query_week(db: &Connection, a: f64, b: f64) -> rusqlite::Result<(Vec<SpanRow>, f64, f64)> {
    let mut stmt = db.prepare(
        "SELECT sid, kind, state, label, start, end FROM state_spans WHERE end>?1 AND start<?2",
    )?;
    let raw: Vec<SpanRow> = stmt
        .query_map(params![a, b], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                r.get::<_, f64>(4)?,
                r.get::<_, f64>(5)?,
            ))
        })?
        .flatten()
        .collect();
    let clipped = clip_rows(&raw, a, b);
    let work: f64 = clipped
        .iter()
        .filter(|r| r.2 == "working")
        .map(|r| r.5 - r.4)
        .sum();
    let wait: f64 = clipped
        .iter()
        .filter(|r| r.2 == "waiting")
        .map(|r| r.5 - r.4)
        .sum();
    Ok((clipped, work, wait))
}

pub fn weekly(db: &Connection, now: f64) -> rusqlite::Result<Option<Value>> {
    let start = week_start(now);
    let first: Option<f64> = db
        .query_row("SELECT MIN(start) FROM state_spans", [], |r| r.get(0))
        .ok()
        .flatten();
    let Some(first) = first else {
        return Ok(None);
    };
    let (rows, work, wait) = query_week(db, start, now)?;
    let monday_date = local_dt(start).date_naive();
    let mut days = Vec::new();
    for i in 0..7i64 {
        let a = local_date_ts(monday_date + Duration::days(i));
        let b = local_date_ts(monday_date + Duration::days(i + 1));
        if a > now {
            break;
        }
        let day_rows = clip_rows(&rows, a, b);
        let dw: f64 = day_rows
            .iter()
            .filter(|r| r.2 == "working")
            .map(|r| r.5 - r.4)
            .sum();
        let dwait: f64 = day_rows
            .iter()
            .filter(|r| r.2 == "waiting")
            .map(|r| r.5 - r.4)
            .sum();
        days.push(json!({
            "date": (monday_date + Duration::days(i)).format("%Y-%m-%d").to_string(),
            "working_s": dw.round_ties_even() as i64,
            "waiting_s": dwait.round_ties_even() as i64
        }));
    }
    let longest = rows
        .iter()
        .filter(|r| r.2 == "waiting")
        .max_by(|a, b| {
            (a.5 - a.4)
                .partial_cmp(&(b.5 - b.4))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|r| {
            json!({
                "session_id": r.0,
                "label": r.3,
                "kind": r.1,
                "seconds": (r.5 - r.4).round_ties_even() as i64
            })
        });
    let prev_start = local_date_ts(monday_date - Duration::days(7));
    let last_same_time = now - 7.0 * DAY;
    let (_, pwork, pwait) = query_week(db, prev_start, last_same_time)?;
    let week_end = local_date_ts(monday_date + Duration::days(7));

    Ok(Some(json!({
        "start": start,
        "end": week_end,
        "since": first,
        "working_s": work.round_ties_even() as i64,
        "waiting_s": wait.round_ties_even() as i64,
        "longest_wait": longest,
        "previous": {
            "working_s": pwork.round_ties_even() as i64,
            "waiting_s": pwait.round_ties_even() as i64,
            "partial": first > prev_start
        },
        "days": days
    })))
}

pub fn last_week(db: &Connection, now: f64) -> rusqlite::Result<Option<Value>> {
    let start = week_start(now);
    let monday_date = local_dt(start).date_naive();
    let a = local_date_ts(monday_date - Duration::days(7));
    let first: Option<f64> = db
        .query_row("SELECT MIN(start) FROM state_spans", [], |r| r.get(0))
        .ok()
        .flatten();
    let Some(first) = first else {
        return Ok(None);
    };
    if first > start - DAY {
        return Ok(None);
    }
    let (_, work, wait) = query_week(db, a, start)?;
    Ok(Some(json!({
        "start": a,
        "working_s": work.round_ties_even() as i64,
        "waiting_s": wait.round_ties_even() as i64
    })))
}

fn write_private_json(path: &Path, val: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    let data = serde_json::to_string(val).unwrap_or_else(|_| "{}".into());
    std::fs::write(&tmp, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------- plans ----------------

#[derive(Debug, Clone, PartialEq)]
pub struct PlanOverride {
    pub plan: String,
    pub price: Option<f64>,
}

fn plans_path(data: &Path) -> PathBuf {
    data.join("report-plans-v1.json")
}

pub fn read_plans(data: &Path) -> BTreeMap<String, PlanOverride> {
    let mut out = BTreeMap::new();
    let Ok(raw) = std::fs::read(plans_path(data)) else {
        return out;
    };
    if raw.len() > 65536 {
        return out;
    }
    let Ok(Value::Object(map)) = serde_json::from_slice(&raw) else {
        return out;
    };
    for (k, v) in map {
        if let Some(obj) = v.as_object() {
            let plan: String = obj
                .get("plan")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .chars()
                .take(24)
                .collect();
            let price = obj
                .get("price")
                .and_then(|x| x.as_f64())
                .filter(|&p| p.is_finite() && (0.0..=10000.0).contains(&p));
            out.insert(k, PlanOverride { plan, price });
        }
    }
    out
}

pub fn set_plan(
    data: &Path,
    account_id: &str,
    plan: Option<&str>,
    price: Option<f64>,
    account_ids: &HashSet<String>,
) -> Result<Option<Value>, &'static str> {
    if !account_ids.contains(account_id) {
        return Err("Unknown account.");
    }
    if let Some(p) = plan {
        if p.chars().count() > 24 {
            return Err("Invalid plan.");
        }
    }
    if let Some(pr) = price {
        if !pr.is_finite() || !(0.0..=10000.0).contains(&pr) {
            return Err("Invalid price.");
        }
    }
    let _g = FILE_LOCK.lock();
    let mut current = read_plans(data);
    let saved = match plan {
        None => {
            current.remove(account_id);
            None
        }
        Some(p) => {
            let ov = PlanOverride {
                plan: p.to_string(),
                price,
            };
            current.insert(account_id.to_string(), ov);
            Some(json!({"plan": p, "price": price}))
        }
    };
    let mut ser = Map::new();
    for (k, v) in current {
        ser.insert(k, json!({"plan": v.plan, "price": v.price}));
    }
    write_private_json(&plans_path(data), &Value::Object(ser)).map_err(|_| "Write failed.")?;
    Ok(saved)
}

pub fn resolve_plans(
    account_quotas: &[Value],
    overrides: &BTreeMap<String, PlanOverride>,
) -> Vec<Value> {
    let mut rows = Vec::new();
    for q in account_quotas {
        let Some(qo) = q.as_object() else {
            continue;
        };
        let kind = qo.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let id = qo.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if !PLAN_KINDS.contains(&kind) || id.is_empty() {
            continue;
        }
        let info = pricing::plan(
            kind,
            qo.get("plan").and_then(|v| v.as_str()).unwrap_or(""),
            qo.get("plan_tier").and_then(|v| v.as_str()).unwrap_or(""),
        );
        let mut plan_name = info.plan;
        let mut label = info.label;
        let mut price = info.price.map(|p| p as f64);
        let mut source = if price.is_some() {
            "detected"
        } else {
            "unknown"
        };
        if let Some(own) = overrides.get(id) {
            if !own.plan.is_empty() {
                plan_name = own.plan.clone();
                label = pricing::plan(kind, &own.plan, "").label;
            }
            price = own.price;
            source = if price.is_some() { "user" } else { "unknown" };
        }
        rows.push(json!({
            "account_id": id,
            "kind": kind,
            "plan": plan_name,
            "label": label,
            "price": price,
            "source": source
        }));
    }
    rows
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round_ties_even() / 100.0
}

fn round3(v: f64) -> f64 {
    (v * 1000.0).round_ties_even() / 1000.0
}

fn priced_totals(
    totals: &HashMap<(String, String), [i64; 4]>,
    counted: &BTreeSet<String>,
) -> (Vec<Value>, i64, Vec<String>, f64, Vec<String>) {
    let mut merged: HashMap<(String, String), (f64, [i64; 4])> = HashMap::new();
    let mut unpriced: i64 = 0;
    let mut unpriced_models: BTreeSet<String> = BTreeSet::new();
    let mut excluded: f64 = 0.0;
    let mut excluded_kinds: BTreeSet<String> = BTreeSet::new();

    for ((kind, model), tokens) in totals {
        let tok_f = [
            tokens[0] as f64,
            tokens[1] as f64,
            tokens[2] as f64,
            tokens[3] as f64,
        ];
        let dollars = pricing::value(Some(model), &tok_f);
        if !counted.contains(kind) {
            if let Some(d) = dollars {
                if d != 0.0 {
                    excluded += d;
                    excluded_kinds.insert(kind.clone());
                }
            }
            continue;
        }
        let Some(d) = dollars else {
            unpriced += tokens.iter().sum::<i64>();
            let norm = pricing::normalize(Some(model));
            unpriced_models.insert(if norm.is_empty() {
                "unknown".into()
            } else {
                norm
            });
            continue;
        };
        let norm = pricing::normalize(Some(model));
        let val2 = round2(d);
        let entry = merged
            .entry((kind.clone(), norm))
            .or_insert((0.0, [0, 0, 0, 0]));
        entry.0 = round2(entry.0 + val2);
        for (dst, src) in entry.1.iter_mut().zip(tokens.iter()) {
            *dst += *src;
        }
    }
    let mut list: Vec<((String, String), f64, [i64; 4])> =
        merged.into_iter().map(|(k, (v, t))| (k, v, t)).collect();
    list.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let by_model: Vec<Value> = list
        .into_iter()
        .map(|((kind, model), api_value, tokens)| {
            json!({
                "model": model,
                "kind": kind,
                "api_value": api_value,
                "tokens": tokens
            })
        })
        .collect();
    (
        by_model,
        unpriced,
        unpriced_models.into_iter().collect(),
        excluded,
        excluded_kinds.into_iter().collect(),
    )
}

#[derive(Default)]
pub struct ValueReport {
    cache: HashMap<(String, Vec<String>), f64>,
    pub current: Option<(f64, String, Value)>,
}

impl ValueReport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn compute<F>(
        &mut self,
        totals_for: F,
        account_quotas: &[Value],
        overrides: &BTreeMap<String, PlanOverride>,
        now: f64,
    ) -> Value
    where
        F: Fn(f64, f64) -> HashMap<(String, String), [i64; 4]>,
    {
        let ov_key = format!("{overrides:?}");
        if let Some((at, ref key, ref cached)) = self.current {
            if now - at < 60.0 && key == &ov_key {
                return cached.clone();
            }
        }
        let first = month_start(now);
        let rows = resolve_plans(account_quotas, overrides);
        let counted: BTreeSet<String> = rows
            .iter()
            .filter_map(|r| r.get("kind").and_then(|v| v.as_str()).map(str::to_string))
            .collect();
        let plan_total = round2(
            rows.iter()
                .filter_map(|r| r.get("price").and_then(|v| v.as_f64()))
                .sum(),
        );
        let (by_model, unpriced, unpriced_models, excluded, excluded_kinds) =
            priced_totals(&totals_for(first, now), &counted);
        let api_value = round2(
            by_model
                .iter()
                .filter_map(|r| r.get("api_value").and_then(|v| v.as_f64()))
                .sum(),
        );
        let unknown: BTreeSet<String> = rows
            .iter()
            .filter(|r| r.get("price").is_none_or(|v| v.is_null()))
            .filter_map(|r| r.get("kind").and_then(|v| v.as_str()).map(str::to_string))
            .collect();

        let mut all_kinds = counted.clone();
        for r in &by_model {
            if let Some(k) = r.get("kind").and_then(|v| v.as_str()) {
                all_kinds.insert(k.to_string());
            }
        }
        let mut by_kind = Vec::new();
        let mut known_api = 0.0_f64;
        let mut known_plan = 0.0_f64;
        for kind in all_kinds {
            let v = round2(
                by_model
                    .iter()
                    .filter(|r| r.get("kind").and_then(|x| x.as_str()) == Some(kind.as_str()))
                    .filter_map(|r| r.get("api_value").and_then(|x| x.as_f64()))
                    .sum(),
            );
            let p = round2(
                rows.iter()
                    .filter(|r| r.get("kind").and_then(|x| x.as_str()) == Some(kind.as_str()))
                    .filter_map(|r| r.get("price").and_then(|x| x.as_f64()))
                    .sum(),
            );
            let ratio = if p > 0.0 && !unknown.contains(&kind) {
                known_api = round2(known_api + v);
                known_plan = round2(known_plan + p);
                Some(round3(v / p))
            } else {
                None
            };
            by_kind.push(json!({
                "kind": kind,
                "api_value": v,
                "plan_total": p,
                "ratio": ratio
            }));
        }

        let priced_set: BTreeSet<String> = counted.difference(&unknown).cloned().collect();
        let priced_vec: Vec<String> = priced_set.iter().cloned().collect();
        let mut months = Vec::new();
        for back in (1..=5).rev() {
            let a = add_months(now, -back);
            let b = add_months(now, -back + 1);
            let mlabel = local_dt(a).format("%Y-%m").to_string();
            let ckey = (mlabel.clone(), priced_vec.clone());
            let val = if let Some(&v) = self.cache.get(&ckey) {
                v
            } else {
                let (past, _, _, _, _) = priced_totals(&totals_for(a, b), &priced_set);
                let v = round2(
                    past.iter()
                        .filter_map(|r| r.get("api_value").and_then(|x| x.as_f64()))
                        .sum(),
                );
                self.cache.insert(ckey, v);
                v
            };
            if val > 0.0 {
                months.push(json!({
                    "month": mlabel,
                    "api_value": val,
                    "plan_total": known_plan
                }));
            }
        }

        let result = json!({
            "month": local_dt(now).format("%Y-%m").to_string(),
            "start": first,
            "end": now,
            "currency": "USD",
            "prices_as_of": pricing::PRICES_AS_OF,
            "plans": rows,
            "plan_total": plan_total,
            "api_value": api_value,
            "ratio": if known_plan > 0.0 { Some(round3(known_api / known_plan)) } else { None },
            "unpriced": {"tokens": unpriced, "models": unpriced_models},
            "api_billed": 0,
            "excluded": {"api_value": round2(excluded), "kinds": excluded_kinds},
            "by_kind": by_kind,
            "by_model": by_model,
            "months": months
        });
        self.current = Some((now, ov_key, result.clone()));
        result
    }
}

// ---------------- notices & settings ----------------

fn settings_path(data: &Path) -> PathBuf {
    data.join("notifications-v1.json")
}

fn notices_path(data: &Path) -> PathBuf {
    data.join("notices-v1.json")
}

pub fn read_settings(data: &Path) -> Value {
    let raw = std::fs::read_to_string(settings_path(data)).ok();
    let obj = raw
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let limit = obj.get("limit").and_then(|v| v.as_bool()) != Some(false);
    let weekly = obj.get("weekly").and_then(|v| v.as_bool()) != Some(false);
    json!({"limit": limit, "weekly": weekly})
}

pub fn set_settings(data: &Path, payload: &Map<String, Value>) -> Result<Value, &'static str> {
    for (k, v) in payload {
        if (k != "limit" && k != "weekly") || !v.is_boolean() {
            return Err("Invalid notification settings.");
        }
    }
    let _g = FILE_LOCK.lock();
    let mut merged = read_settings(data).as_object().cloned().unwrap_or_default();
    for (k, v) in payload {
        merged.insert(k.clone(), v.clone());
    }
    let val = Value::Object(merged);
    write_private_json(&settings_path(data), &val).map_err(|_| "Write failed.")?;
    Ok(val)
}

fn weekly_window(q: &Map<String, Value>) -> Option<&Map<String, Value>> {
    let ws = q.get("windows")?.as_array()?;
    for w in ws {
        let Some(wo) = w.as_object() else {
            continue;
        };
        if wo.get("scope").and_then(|v| v.as_str()) == Some("mcp") {
            continue;
        }
        let is_weekly = wo.get("period").and_then(|v| v.as_str()) == Some("weekly")
            || matches!(
                wo.get("label").and_then(|v| v.as_str()),
                Some("주간" | "Weekly")
            );
        if is_weekly {
            return Some(wo);
        }
    }
    None
}

fn burn_rate(weekly_snapshot: Option<&Value>, q: &Map<String, Value>) -> Option<f64> {
    if q.get("stale").and_then(|v| v.as_bool()) != Some(false)
        || q.get("identity_verified").and_then(|v| v.as_bool()) == Some(false)
    {
        return None;
    }
    let qid = q.get("id")?.as_str()?;
    let accts = weekly_snapshot?.get("accounts")?.as_array()?;
    let acct = accts
        .iter()
        .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(qid))?;
    let p = acct.get("periods")?.get("5h")?;
    let used = p.get("used_pp")?.as_f64()?;
    let seen = p.get("observed_seconds")?.as_f64()?;
    if seen < 120.0 {
        return None;
    }
    Some(used / seen * 3600.0)
}

pub fn compute_notices(
    data: &Path,
    account_quotas: &[Value],
    weekly_snapshot: Option<&Value>,
    names: &HashMap<String, String>,
    last_week_summary: Option<&Value>,
    value_now: Option<&Value>,
    now: f64,
) -> (Vec<Value>, Value) {
    let settings = read_settings(data);
    let lim_on = settings
        .get("limit")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let wk_on = settings
        .get("weekly")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let _g = FILE_LOCK.lock();
    let npath = notices_path(data);
    let mut state: Map<String, Value> = std::fs::read_to_string(&npath)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let before = serde_json::to_string(&state).unwrap_or_default();

    let mut early = state
        .get("early")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let mut last = state
        .get("last_limit")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let mut items: Vec<Value> = state
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for qv in account_quotas {
        let Some(q) = qv.as_object() else {
            continue;
        };
        let Some(qid) = q.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let w = weekly_window(q);
        let rate = burn_rate(weekly_snapshot, q);
        let pct = w.and_then(|wo| wo.get("pct")).and_then(|v| v.as_f64());
        let (Some(w_obj), Some(pct_val), Some(rate_val)) = (w, pct, rate) else {
            early.remove(qid);
            continue;
        };
        if rate_val <= 0.0 {
            early.remove(qid);
            continue;
        }
        let left = (100.0 - pct_val).max(0.0);
        let reset = w_obj.get("reset").and_then(|v| v.as_f64());
        let end = now + left / rate_val * 3600.0;
        let soon = reset.is_some_and(|r| end < r);
        let was_early = early.get(qid).and_then(|v| v.as_bool()).unwrap_or(false);
        let last_t = last.get(qid).and_then(|v| v.as_f64()).unwrap_or(0.0);
        if soon && !was_early && now - last_t >= SIX_HOURS && lim_on {
            let reset_val = reset.unwrap();
            let name = names
                .get(qid)
                .filter(|s| !s.is_empty())
                .map(String::as_str)
                .or_else(|| q.get("kind").and_then(|v| v.as_str()))
                .unwrap_or("");
            items.push(json!({
                "id": format!("limit:{qid}:{}", (end / 3600.0).floor() as i64),
                "type": "limit",
                "at": now,
                "account_id": qid,
                "kind": q.get("kind").cloned().unwrap_or(Value::Null),
                "account_label": name,
                "end": end.round_ties_even() as i64,
                "reset": reset_val,
                "left_pct": (left * 10.0).round_ties_even() / 10.0,
                "burn_pph": round3(rate_val),
                "title": format!("{name} 한도가 초기화 전에 바닥납니다"),
                "body": format!("이 속도면 {}에 바닥납니다 · 초기화보다 {} 빠릅니다", when(end, now), duration_text(reset_val - end))
            }));
            last.insert(qid.to_string(), json!(now));
        }
        early.insert(qid.to_string(), json!(soon));
    }

    let monday = local_dt(week_start(now)).format("%Y-%m-%d").to_string();
    if wk_on && state.get("weekly_sent").and_then(|v| v.as_str()) != Some(monday.as_str()) {
        if let Some(lw) = last_week_summary {
            let ws = lw.get("working_s").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let waits = lw.get("waiting_s").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let ratio = value_now
                .and_then(|v| v.get("ratio"))
                .and_then(|v| v.as_f64());
            let suffix = match ratio {
                Some(r) => format!(" · {}월 본전 {:.1}배", local_dt(now).month(), r),
                None => String::new(),
            };
            items.push(json!({
                "id": format!("weekly:{monday}"),
                "type": "weekly",
                "at": now,
                "week_start": lw.get("start").cloned().unwrap_or(Value::Null),
                "working_s": ws as i64,
                "waiting_s": waits as i64,
                "ratio": ratio,
                "title": format!("지난주 에이전트 작업 {}", duration_text(ws)),
                "body": format!("대기로 멈춘 시간 {}{suffix}", duration_text(waits))
            }));
            state.insert("weekly_sent".into(), json!(monday));
        }
    }

    items.retain(|n| {
        n.is_object() && now - n.get("at").and_then(|v| v.as_f64()).unwrap_or(0.0) < DAY
    });
    if items.len() > 10 {
        items = items.split_off(items.len() - 10);
    }

    state.insert("early".into(), Value::Object(early.clone()));
    state.insert("last_limit".into(), Value::Object(last.clone()));
    state.insert("items".into(), Value::Array(items.clone()));
    let after = serde_json::to_string(&state).unwrap_or_default();
    let meaningful = !items.is_empty()
        || early.values().any(|v| v.as_bool() == Some(true))
        || !last.is_empty()
        || state.get("weekly_sent").is_some_and(|v| !v.is_null());
    if after != before && (meaningful || npath.exists()) {
        let _ = write_private_json(&npath, &Value::Object(state));
    }

    let visible: Vec<Value> = items
        .into_iter()
        .filter(|n| {
            let typ = n.get("type").and_then(|v| v.as_str()).unwrap_or("");
            settings.get(typ).and_then(|v| v.as_bool()).unwrap_or(true)
        })
        .collect();
    (visible, settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_formatting_and_settings() {
        assert_eq!(duration_text(3600.0), "1시간");
        assert_eq!(duration_text(5400.0), "1시간 30분");
        assert_eq!(duration_text(300.0), "5분");
        let td = tempfile::tempdir().unwrap();
        assert_eq!(
            read_settings(td.path()),
            json!({"limit": true, "weekly": true})
        );
        let mut upd = Map::new();
        upd.insert("weekly".into(), json!(false));
        assert_eq!(
            set_settings(td.path(), &upd).unwrap(),
            json!({"limit": true, "weekly": false})
        );
    }
}
