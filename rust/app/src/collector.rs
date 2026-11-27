//! Full native Rust `Collector` (`server.py:Collector`), zero Python dependency.
#![forbid(unsafe_code)]

use onetop_core::accounts::{
    apply_aliases, claude_statusline_report, profile_roots, session_statusline_binding, set_alias,
    AccountQuotaSampler,
};
use onetop_core::antigravity;
use onetop_core::controls::Controller;
use onetop_core::devin;
use onetop_core::effort::apply_statusline;
use onetop_core::gateway::{attach_routing, load_routing_bindings, RoutingBinding};
use onetop_core::history::{initialize_capture, HistoryStore};
use onetop_core::ledger::{scan_jsonl_tracker, Ledger, ZERO};
use onetop_core::observer::Observer;
use onetop_core::observers::{openmausbot_ledgers, parse_openmausbot_turn};
use onetop_core::platform_support::home_dir;
use onetop_core::readonly::open_readonly;
use onetop_core::reports::{self, Spans, ValueReport};
use onetop_core::resources::NativeResourceSampler;
use onetop_core::sessions::{
    applications, group_sessions, process_rows, public_session, resolve_sessions,
};
use onetop_core::telemetry::{bind_account, enrich, session_index, TelemetryStore};
use onetop_core::text::epoch_from_value;
use onetop_core::usage::{
    all_periods, archive_recover, archive_remember, extend_snapshot, parse_period, session_usage,
    speed_windows, usage_sessions_response, window_usage, WINDOWS,
};
use onetop_core::weekly_usage::{self, ProfileRootBinding};
use onetop_core::APP_VERSION;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug)]
pub enum QueryError {
    Invalid(String),
    Unavailable(String),
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[cfg(unix)]
fn file_inode(meta: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn file_inode(_meta: &std::fs::Metadata) -> u64 {
    0
}

fn mtime_secs(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn non_neg_finite(v: Option<&Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64())
        .filter(|f| f.is_finite() && *f >= 0.0)
}

fn stored_context(state: &Map<String, Value>) -> Option<Value> {
    if let Some(cu) = state.get("context_usage").filter(|v| !v.is_null()) {
        return Some(cu.clone());
    }
    let used = non_neg_finite(state.get("request_input"))?;
    let cap = non_neg_finite(state.get("context_size")).filter(|c| *c > 0.0);
    let obs = non_neg_finite(state.get("last_usage")).unwrap_or(0.0);
    let model: String = state
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(80)
        .collect();
    Some(json!({
        "basis": "last_request_input",
        "input_tokens": used,
        "capacity": cap,
        "parts": Value::Null,
        "observed_at": obs,
        "model": model,
    }))
}

fn workspace_norm(path: &str) -> String {
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        path.to_string()
    } else {
        trimmed.to_string()
    }
}

fn openbot_seat(cwd: &str, observation: Option<&Map<String, Value>>) -> Option<String> {
    if cwd.is_empty() {
        return None;
    }
    let target = workspace_norm(cwd);
    let agents = observation?
        .get("openbot_agents")
        .and_then(|v| v.as_array())?;
    for a in agents {
        let Some(ws) = a.get("workspace").and_then(|v| v.as_str()) else {
            continue;
        };
        if !ws.is_empty() && workspace_norm(ws) == target {
            if let Some(name) = a.get("name").and_then(|v| v.as_str()) {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn claude_windows_legacy(entries: &[Value], now: f64) -> (Vec<Value>, Option<Value>) {
    let latest = entries
        .iter()
        .filter(|e| {
            e.get("rl")
                .and_then(|v| v.as_object())
                .is_some_and(|m| !m.is_empty())
        })
        .max_by(|a, b| {
            let ta = a.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let tb = b.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
            ta.partial_cmp(&tb).unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned();
    let mut windows = Vec::new();
    if let Some(ref l) = latest {
        if let Some(rl) = l.get("rl").and_then(|v| v.as_object()) {
            let lt = l.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
            for (key, label) in [("five_hour", "5시간"), ("seven_day", "주간")] {
                let Some(w) = rl.get(key).and_then(|v| v.as_object()) else {
                    continue;
                };
                let Some(used_pct) = w.get("used_percentage").filter(|v| !v.is_null()) else {
                    continue;
                };
                let reset = epoch_from_value(w.get("resets_at"));
                let pct = if reset > now {
                    used_pct.clone()
                } else {
                    Value::Null
                };
                windows.push(json!({
                    "label": label,
                    "pct": pct,
                    "reset": reset,
                    "t": lt,
                }));
            }
        }
    }
    (windows, latest)
}

#[derive(Default)]
struct RangeCache {
    period_cache: HashMap<String, Map<String, Value>>,
    cloud_cache: Option<Map<String, Value>>,
    speed_cache: Option<(f64, Vec<Value>)>,
}

struct CollectorInner {
    db: Option<Connection>,
    observer: Option<Observer>,
    observation: Option<Map<String, Value>>,
    specs: Vec<Map<String, Value>>,
    apps: Vec<Value>,
    terminal_count: Option<usize>,
    shared_roots: Vec<u32>,
    process_counts: HashMap<String, usize>,
    discovery_at: f64,
    started: f64,
    history_started: f64,
    trackers: HashMap<String, Ledger>,
    adapter_cache: HashMap<String, Map<String, Value>>,
    devin_row: HashMap<String, i64>,
    antigravity_models: BTreeMap<u128, String>,
    routing_bindings: HashMap<String, Vec<RoutingBinding>>,
    routing_reconciled: HashMap<String, Vec<RoutingBinding>>,
    locations_saved: Value,
    resources: NativeResourceSampler,
    operations: onetop_core::operations::OperationalMonitor,
    spans: Spans,
    reports_weekly: (f64, Option<Value>, Option<Value>),
}

impl CollectorInner {
    fn new(home: &Path) -> Self {
        Self {
            db: None,
            observer: None,
            observation: None,
            specs: Vec::new(),
            apps: Vec::new(),
            terminal_count: None,
            shared_roots: Vec::new(),
            process_counts: HashMap::new(),
            discovery_at: 0.0,
            started: 0.0,
            history_started: 0.0,
            trackers: HashMap::new(),
            adapter_cache: HashMap::new(),
            devin_row: HashMap::new(),
            antigravity_models: BTreeMap::new(),
            routing_bindings: HashMap::new(),
            routing_reconciled: HashMap::new(),
            locations_saved: json!({}),
            resources: NativeResourceSampler::new(),
            operations: onetop_core::operations::OperationalMonitor::new(Some(home.to_path_buf())),
            spans: Spans::new(),
            reports_weekly: (0.0, None, None),
        }
    }
}

pub struct Collector {
    data_dir: PathBuf,
    home: PathBuf,
    accounts: AccountQuotaSampler,
    controller: Arc<Controller>,
    stop: Arc<AtomicBool>,
    snapshot: Mutex<Map<String, Value>>,
    range_cache: Mutex<RangeCache>,
    telemetry: Mutex<Option<Arc<TelemetryStore>>>,
    history: Mutex<Option<Arc<HistoryStore>>>,
    reports_value: Arc<Mutex<Option<Value>>>,
    value_report: Arc<Mutex<ValueReport>>,
    reports_running: Arc<AtomicBool>,
    mailbox_running: Arc<AtomicBool>,
    inner: Mutex<CollectorInner>,
}

impl Collector {
    pub fn new(data_dir: PathBuf, controller: Arc<Controller>, stop: Arc<AtomicBool>) -> Self {
        let home = home_dir();
        let mut initial = Map::new();
        initial.insert("ready".into(), Value::Bool(false));
        initial.insert("version".into(), Value::String(APP_VERSION.to_string()));
        initial.insert("updated".into(), json!(0));
        initial.insert("sessions".into(), Value::Array(Vec::new()));
        initial.insert("error".into(), Value::Null);

        Self {
            data_dir,
            home: home.clone(),
            accounts: AccountQuotaSampler::new(),
            controller,
            stop,
            snapshot: Mutex::new(initial),
            range_cache: Mutex::new(RangeCache::default()),
            telemetry: Mutex::new(None),
            history: Mutex::new(None),
            reports_value: Arc::new(Mutex::new(None)),
            value_report: Arc::new(Mutex::new(ValueReport::new())),
            reports_running: Arc::new(AtomicBool::new(false)),
            mailbox_running: Arc::new(AtomicBool::new(false)),
            inner: Mutex::new(CollectorInner::new(&home)),
        }
    }

    pub fn accounts(&self) -> AccountQuotaSampler {
        self.accounts.clone()
    }

    pub fn telemetry_store(&self) -> Option<Arc<TelemetryStore>> {
        self.telemetry.lock().ok().and_then(|g| g.clone())
    }

    pub fn history_store(&self) -> Option<Arc<HistoryStore>> {
        self.history.lock().ok().and_then(|g| g.clone())
    }

    pub fn raw_snapshot(&self) -> Map<String, Value> {
        self.snapshot.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn is_ready(&self) -> bool {
        self.snapshot
            .lock()
            .ok()
            .and_then(|g| g.get("ready").and_then(|v| v.as_bool()))
            .unwrap_or(false)
    }

    pub fn snapshot_updated(&self) -> f64 {
        self.snapshot
            .lock()
            .ok()
            .and_then(|g| g.get("updated").and_then(|v| v.as_f64()))
            .unwrap_or(0.0)
    }

    pub fn invalidate_value_report(&self) {
        if let Ok(mut rv) = self.reports_value.lock() {
            *rv = None;
        }
        if let Ok(mut vr) = self.value_report.lock() {
            vr.current = None;
        }
    }

    pub fn set_account_alias(
        &self,
        account_id: Option<&str>,
        alias: Option<&str>,
    ) -> Result<String, &'static str> {
        let aid = account_id.ok_or("Invalid account")?;
        let mut snap = self.snapshot.lock().unwrap();
        let known: HashSet<String> = snap
            .get("account_quotas")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let saved = set_alias(&self.data_dir, aid, alias.unwrap_or(""), &known)?;
        if let Some(rows) = snap
            .get_mut("account_quotas")
            .and_then(|v| v.as_array_mut())
        {
            apply_aliases(rows, &self.data_dir);
        }
        Ok(saved)
    }

    pub fn stop_all(&self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(hist) = self.history_store() {
            hist.stop();
        }
    }

    fn monitor_db_path(&self) -> PathBuf {
        self.data_dir.join("monitor.sqlite")
    }

    pub fn usage_sessions(
        &self,
        period: &str,
        offset_raw: &str,
        limit_raw: &str,
    ) -> Result<Value, QueryError> {
        let state = self.raw_snapshot();
        if state.get("ready").and_then(|v| v.as_bool()) != Some(true) {
            return Err(QueryError::Invalid("Collector is starting".into()));
        }
        let offset = offset_raw
            .parse::<i64>()
            .map_err(|_| QueryError::Invalid("Invalid period or page".into()))?;
        let limit = limit_raw
            .parse::<i64>()
            .map_err(|_| QueryError::Invalid("Invalid period or page".into()))?;
        let db = open_readonly(&self.monitor_db_path(), 5.0)
            .map_err(|_| QueryError::Unavailable("Session archive is starting".into()))?;
        let _ = db.execute_batch("BEGIN");
        usage_sessions_response(&db, &state, period, offset, limit)
            .map_err(|_| QueryError::Invalid("Invalid period or page".into()))
    }

    pub fn history_response(
        &self,
        period: &str,
        step: &str,
        kind: Option<&str>,
    ) -> Result<Value, QueryError> {
        let Some(hist) = self.history_store() else {
            return Err(QueryError::Unavailable(
                "History collector is starting".into(),
            ));
        };
        let snap = self.raw_snapshot();
        hist.response(period, step, kind, Some(&snap)).map_err(|e| {
            if e.to_lowercase().contains("sqlite") || e.to_lowercase().contains("database") {
                QueryError::Unavailable("History collector is starting".into())
            } else {
                QueryError::Invalid("Invalid history period or step; maximum 400 bins".into())
            }
        })
    }

    pub fn state_for_period(&self, key: &str) -> Result<Map<String, Value>, QueryError> {
        if parse_period(key).is_err() {
            return Err(QueryError::Invalid("Invalid period".into()));
        }
        let snap = self.raw_snapshot();
        if snap.get("ready").and_then(|v| v.as_bool()) != Some(true) {
            return Ok(snap);
        }
        let snap_updated = snap.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let mut cache = self.range_cache.lock().unwrap();
        if let Some(cached) = cache.period_cache.get(key) {
            if cached.get("updated").and_then(|v| v.as_f64()) == Some(snap_updated) {
                return Ok(cached.clone());
            }
        }
        let db = open_readonly(&self.monitor_db_path(), 5.0)
            .map_err(|_| QueryError::Unavailable("state_temporarily_unavailable".into()))?;
        let _ = db.execute_batch("BEGIN");
        let extended = extend_snapshot(&db, &snap, key).map_err(|e| {
            if e.to_lowercase().contains("sqlite") {
                QueryError::Unavailable("state_temporarily_unavailable".into())
            } else {
                QueryError::Invalid(e)
            }
        })?;
        if cache.period_cache.len() >= 8 {
            cache.period_cache.clear();
        }
        cache.period_cache.insert(key.to_string(), extended.clone());
        Ok(extended)
    }

    pub fn state_for_cloud(&self) -> Map<String, Value> {
        let snap = self.raw_snapshot();
        if snap.get("ready").and_then(|v| v.as_bool()) != Some(true) {
            return snap;
        }
        let snap_updated = snap.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let mut cache = self.range_cache.lock().unwrap();
        if let Some(ref cached) = cache.cloud_cache {
            if cached.get("updated").and_then(|v| v.as_f64()) == Some(snap_updated) {
                return cached.clone();
            }
        }
        let Ok(db) = open_readonly(&self.monitor_db_path(), 5.0) else {
            return snap;
        };
        let _ = db.execute_batch("BEGIN");
        let res = all_periods(&db, &snap);
        cache.cloud_cache = Some(res.clone());
        res
    }

    pub fn speed_for_cloud(&self, state: &Map<String, Value>) -> Vec<Value> {
        let updated = state.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let mut cache = self.range_cache.lock().unwrap();
        if let Some((ts, ref rows)) = cache.speed_cache {
            let diff = updated - ts;
            if (0.0..30.0).contains(&diff) {
                return rows.clone();
            }
        }
        let Ok(db) = open_readonly(&self.monitor_db_path(), 5.0) else {
            return Vec::new();
        };
        let rows = speed_windows(&db, state).unwrap_or_default();
        cache.speed_cache = Some((updated, rows.clone()));
        rows
    }

    fn start_background_services(&self) {
        // Account quota polling every 120s.
        let acc = self.accounts.clone();
        let stop_acc = Arc::clone(&self.stop);
        let _ = std::thread::Builder::new()
            .name("1top-accounts".into())
            .spawn(move || {
                while !stop_acc.load(Ordering::Relaxed) {
                    acc.sample_once();
                    for _ in 0..120 {
                        if stop_acc.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(Duration::from_secs(1));
                    }
                }
            });
    }

    fn start_history_importer(&self, hist: Arc<HistoryStore>) {
        let stop_h = Arc::clone(&self.stop);
        let home = self.home.clone();
        let _ = std::thread::Builder::new()
            .name("1top-history".into())
            .spawn(move || {
                while !stop_h.load(Ordering::Relaxed) {
                    let roots = profile_roots(Some(&home));
                    hist.run_import_pass(&roots);
                    for _ in 0..300 {
                        if stop_h.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(Duration::from_secs(1));
                    }
                }
            });
    }

    fn initialize(&self) -> Result<(), String> {
        std::fs::create_dir_all(&self.data_dir).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&self.data_dir, std::fs::Permissions::from_mode(0o700));
        }

        if let Ok(ts) = TelemetryStore::new(&self.data_dir) {
            if let Ok(mut g) = self.telemetry.lock() {
                *g = Some(Arc::new(ts));
            }
        }

        let db = Connection::open(self.monitor_db_path()).map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA cache_size=-2000;
             PRAGMA temp_store=MEMORY;
             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE IF NOT EXISTS trackers (path TEXT PRIMARY KEY, data TEXT);
             CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, t REAL, sid TEXT, kind TEXT,
                 fresh INTEGER, cached INTEGER, written INTEGER, output INTEGER);
             CREATE INDEX IF NOT EXISTS event_time ON events(t);",
        )
        .map_err(|e| e.to_string())?;

        weekly_usage::initialize(&db).map_err(|e| e.to_string())?;
        initialize_capture(&db).map_err(|e| e.to_string())?;
        let _ = reports::initialize(&db);
        let roots = profile_roots(Some(&self.home));
        let _ = archive_recover(&db, &self.home, &roots);

        let now = now_epoch();
        let started: f64 = db
            .query_row("SELECT value FROM meta WHERE key='started'", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(now);
        let _ = db.execute(
            "INSERT OR IGNORE INTO meta VALUES ('started', ?1)",
            params![started.to_string()],
        );
        let hs_default = started.max(now - 86400.0);
        let _ = db.execute(
            "INSERT OR IGNORE INTO meta VALUES ('history_started', ?1)",
            params![hs_default.to_string()],
        );
        let history_started: f64 = db
            .query_row(
                "SELECT value FROM meta WHERE key='history_started'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(hs_default);

        let mut inner = self.inner.lock().unwrap();
        inner.started = started;
        inner.history_started = history_started;
        inner.db = Some(db);
        drop(inner);

        if let Ok(hs) = HistoryStore::new(&self.data_dir, None) {
            let arc = Arc::new(hs);
            if let Ok(mut g) = self.history.lock() {
                *g = Some(Arc::clone(&arc));
            }
            self.start_history_importer(arc);
        }
        Ok(())
    }

    fn known_locations(inner: &mut CollectorInner) -> Option<Map<String, Value>> {
        let db = inner.db.as_ref()?;
        let raw: Option<String> = db
            .query_row(
                "SELECT data FROM trackers WHERE path='locations'",
                [],
                |r| r.get(0),
            )
            .ok();
        let parsed: Value = raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| json!({}));
        inner.locations_saved = parsed.clone();
        parsed.as_object().cloned()
    }

    fn remember_locations(inner: &mut CollectorInner) {
        let Some(ref obs) = inner.observer else {
            return;
        };
        let known = obs.locations.known();
        if known == inner.locations_saved {
            return;
        }
        if let Some(ref db) = inner.db {
            if let Ok(txt) = serde_json::to_string(&known) {
                if db
                    .execute(
                        "INSERT OR REPLACE INTO trackers VALUES ('locations', ?1)",
                        params![txt],
                    )
                    .is_ok()
                {
                    inner.locations_saved = known;
                }
            }
        }
    }

    fn discover(&self, inner: &mut CollectorInner) {
        if inner.observer.is_none() {
            let known = Self::known_locations(inner);
            inner.observer = Some(Observer::new(Some(self.home.clone()), known.as_ref()));
        }
        let record = inner.observer.as_mut().unwrap().read();
        Self::remember_locations(inner);
        let specs = resolve_sessions(&record);
        let proc_map = process_rows(&record);
        let apps = applications(&proc_map);
        let term_count = record
            .get("orca_terminals")
            .and_then(|v| v.as_array())
            .map(Vec::len);
        let shared_roots: Vec<u32> = record
            .get("processes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|p| {
                        p.get("kind").and_then(|v| v.as_str()) == Some("Codex")
                            && p.get("role").and_then(|v| v.as_str()) == Some("helper")
                    })
                    .filter_map(|p| p.get("pid").and_then(|v| v.as_u64()).map(|n| n as u32))
                    .collect()
            })
            .unwrap_or_default();
        let mut counts: HashMap<String, usize> = HashMap::new();
        for s in &specs {
            if let Some(k) = s.get("kind").and_then(|v| v.as_str()) {
                *counts.entry(k.to_string()).or_insert(0) += 1;
            }
        }
        let cap_at = record
            .get("captured_at")
            .and_then(|v| v.as_f64())
            .unwrap_or_else(now_epoch);
        inner.observation = Some(record);
        inner.specs = specs;
        inner.apps = apps;
        inner.terminal_count = term_count;
        inner.shared_roots = shared_roots;
        inner.process_counts = counts;
        inner.discovery_at = cap_at;
    }

    fn refresh_sessions(inner: &mut CollectorInner) {
        let Some(prev) = inner.observation.as_ref() else {
            return;
        };
        let Some(ref mut obs) = inner.observer else {
            return;
        };
        let next = obs.refresh(prev);
        let specs = resolve_sessions(&next);
        inner.observation = Some(next);
        inner.specs = specs;
    }

    fn read_tracker(inner: &mut CollectorInner, spec: &mut Map<String, Value>) {
        if let Some(ref db) = inner.db {
            attach_routing(
                spec,
                &inner.routing_bindings,
                db,
                &mut inner.routing_reconciled,
            );
        }
        let Some(path_str) = spec
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
        else {
            return;
        };
        let kind = spec
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let has_ledger_path = spec
            .get("_ledger_path")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty());
        let ledger_path = spec
            .get("_ledger_path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| path_str.clone());

        if !inner.trackers.contains_key(&ledger_path) {
            let saved = inner
                .db
                .as_ref()
                .and_then(|db| {
                    db.query_row(
                        "SELECT data FROM trackers WHERE path=?1",
                        params![&ledger_path],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                })
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|v| v.as_object().cloned());
            inner
                .trackers
                .insert(ledger_path.clone(), Ledger::new(&kind, saved));
        }

        let Some(tracker) = inner.trackers.get_mut(&ledger_path) else {
            return;
        };

        let mut saved_cursors: Option<Map<String, Value>> = None;
        if has_ledger_path {
            let base_off = tracker
                .state
                .get("offset")
                .cloned()
                .unwrap_or_else(|| json!(0));
            let base_ino = tracker.state.get("inode").cloned().unwrap_or(Value::Null);
            let mut cursors = tracker
                .state
                .get("continuation_cursors")
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_else(|| {
                    let mut m = Map::new();
                    m.insert(
                        ledger_path.clone(),
                        json!({"offset": base_off, "inode": base_ino}),
                    );
                    m
                });
            let cur = cursors
                .entry(path_str.clone())
                .or_insert_with(|| json!({"offset": 0, "inode": Value::Null}))
                .as_object()
                .cloned()
                .unwrap_or_default();
            let cur_off = cur.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
            let cur_ino = cur.get("inode").and_then(|v| v.as_u64());
            if let Ok(meta) = std::fs::metadata(&path_str) {
                let ino = file_inode(&meta);
                let sz = meta.len();
                if (cur_ino.is_some() && cur_ino != Some(ino)) || sz < cur_off {
                    tracker.state.insert("offset".into(), json!(0));
                    tracker.state.insert("inode".into(), Value::Null);
                } else {
                    tracker.state.insert("offset".into(), json!(cur_off));
                    tracker.state.insert(
                        "inode".into(),
                        cur_ino.map(|n| json!(n)).unwrap_or(Value::Null),
                    );
                }
            }
            saved_cursors = Some(cursors);
        }

        let spec_cwd = spec.get("cwd").and_then(|v| v.as_str()).map(str::to_string);
        let scan_res = scan_jsonl_tracker(
            tracker,
            Path::new(&path_str),
            &kind,
            inner.started,
            spec_cwd.as_deref(),
        );
        let Ok((events, new_offset, file_size, dirty)) = scan_res else {
            spec.insert("note".into(), json!("세션 기록을 읽을 수 없습니다."));
            return;
        };

        let sid = spec
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if let Some(ref db) = inner.db {
            for ev in events {
                let acct = weekly_usage::event_account(spec, ev.t);
                let _ = db.execute(
                    "INSERT INTO events(t,sid,kind,fresh,cached,written,output,account,model,cwd) \
                     VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    params![
                        ev.t,
                        &sid,
                        &kind,
                        ev.tokens[0],
                        ev.tokens[1],
                        ev.tokens[2],
                        ev.tokens[3],
                        acct,
                        ev.model,
                        ev.cwd,
                    ],
                );
            }
        }

        let s = &mut tracker.state;
        let loading = new_offset < file_size;
        let progress =
            ((100.0 * new_offset as f64) / (file_size.max(1) as f64)).round_ties_even() as i64;
        let known = s.get("known").and_then(|v| v.as_bool()).unwrap_or(false);
        spec.insert("loading".into(), Value::Bool(loading));
        spec.insert("progress".into(), json!(progress));
        spec.insert(
            "tokens".into(),
            if known && !loading {
                s.get("total").cloned().unwrap_or_else(|| json!(ZERO))
            } else {
                Value::Null
            },
        );
        let ledger_model = s.get("model").and_then(|v| v.as_str()).unwrap_or("");
        let resolved_model = if !ledger_model.is_empty() {
            ledger_model.to_string()
        } else {
            spec.get("configured_model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        spec.insert("model".into(), Value::String(resolved_model.clone()));
        let model_updated = s
            .get("model_at")
            .or_else(|| s.get("last_usage"))
            .cloned()
            .unwrap_or_else(|| json!(0));
        spec.insert("model_updated".into(), model_updated);

        if kind == "Codex" {
            for k in ["effort", "effort_source", "effort_updated"] {
                spec.remove(k);
            }
            if let Some(eff) = s
                .get("effort")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
            {
                spec.insert("effort".into(), json!(eff));
                spec.insert("effort_source".into(), json!("codex_turn_context"));
                spec.insert(
                    "effort_updated".into(),
                    s.get("effort_updated").cloned().unwrap_or(Value::Null),
                );
            }
        } else if kind == "Aside"
            && Some(resolved_model.as_str()) != spec.get("effort_model").and_then(|v| v.as_str())
        {
            for k in ["effort", "effort_source", "effort_updated"] {
                spec.remove(k);
            }
        }

        spec.insert(
            "models".into(),
            s.get("models").cloned().unwrap_or_else(|| json!([])),
        );
        spec.insert(
            "last_usage".into(),
            s.get("last_usage").cloned().unwrap_or_else(|| json!(0)),
        );
        spec.insert(
            "request_input".into(),
            s.get("request_input").cloned().unwrap_or(Value::Null),
        );
        spec.insert(
            "context_size".into(),
            s.get("context_size").cloned().unwrap_or(Value::Null),
        );
        spec.insert(
            "context_usage".into(),
            if !loading {
                stored_context(s).unwrap_or(Value::Null)
            } else {
                Value::Null
            },
        );
        spec.insert(
            "quota".into(),
            s.get("quota").cloned().unwrap_or(Value::Null),
        );
        spec.insert(
            "counter_reset".into(),
            s.get("counter_reset")
                .cloned()
                .unwrap_or(Value::Bool(false)),
        );
        if kind == "Codex" && !spec.contains_key("display_status") {
            spec.insert(
                "status".into(),
                s.get("status").cloned().unwrap_or_else(|| json!("unknown")),
            );
            spec.insert(
                "status_at".into(),
                s.get("status_at").cloned().unwrap_or_else(|| json!(0)),
            );
        }
        if !loading && !known {
            spec.insert(
                "note".into(),
                json!("대화 기록에 유효한 사용량 보고가 없습니다. 0으로 간주하지 않습니다."),
            );
        }

        let has_cursors = saved_cursors.is_some();
        if let Some(mut cursors) = saved_cursors {
            let cur_off = s.get("offset").cloned().unwrap_or_else(|| json!(0));
            let cur_ino = s.get("inode").cloned().unwrap_or(Value::Null);
            cursors.insert(path_str, json!({"offset": cur_off, "inode": cur_ino}));
            if let Some(base) = cursors.get(&ledger_path).and_then(|v| v.as_object()) {
                if let Some(bo) = base.get("offset") {
                    s.insert("offset".into(), bo.clone());
                }
                if let Some(bi) = base.get("inode") {
                    s.insert("inode".into(), bi.clone());
                }
            }
            s.insert("continuation_cursors".into(), Value::Object(cursors));
        }

        if dirty || has_cursors {
            if let (Some(db), Ok(txt)) = (inner.db.as_ref(), serde_json::to_string(s)) {
                let _ = db.execute(
                    "INSERT OR REPLACE INTO trackers VALUES (?1, ?2)",
                    params![&ledger_path, &txt],
                );
            }
        }
    }

    fn read_continuation(
        inner: &mut CollectorInner,
        spec: &mut Map<String, Value>,
        roots: &HashMap<PathBuf, ProfileRootBinding>,
        telemetry_sessions: &HashMap<(String, String), Map<String, Value>>,
        account_quotas: &[Value],
        now: f64,
    ) {
        let sources: Vec<(String, String)> = spec
            .get("continuation_sources")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| {
                        let p = s
                            .get("path")
                            .and_then(|v| v.as_str())
                            .filter(|x| !x.is_empty())?;
                        let sid = s.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
                        Some((p.to_string(), sid.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if sources.is_empty() {
            return;
        }
        let active_id = spec
            .get("active_session_id")
            .cloned()
            .unwrap_or(Value::Null);
        let active_path = spec.get("path").cloned().unwrap_or(Value::Null);
        let first_path = sources[0].0.clone();

        for (src_path, src_sid) in sources {
            let mut part = spec.clone();
            part.insert("path".into(), Value::String(src_path));
            part.insert("active_session_id".into(), Value::String(src_sid));
            part.insert("_ledger_path".into(), Value::String(first_path.clone()));
            if let Some((aid, since)) = weekly_usage::account_for(&part, roots) {
                part.insert("account_binding".into(), json!([aid, since]));
            } else {
                part.insert("account_binding".into(), Value::Null);
            }
            part.remove("account_binding_source");
            let captured = session_statusline_binding(&mut part, now, Some(account_quotas));
            if part
                .get("account_binding_uncertain")
                .and_then(|v| v.as_bool())
                == Some(true)
            {
                part.insert("account_binding".into(), Value::Null);
                part.insert(
                    "account_binding_source".into(),
                    json!("claude_identity_unconfirmed"),
                );
            }
            if let Some((aid, since)) = captured {
                part.insert("account_binding".into(), json!([aid, since]));
                part.insert(
                    "account_binding_source".into(),
                    json!("claude_statusline_session"),
                );
            }
            bind_account(&mut part, telemetry_sessions, roots);
            Self::read_tracker(inner, &mut part);
            spec.remove("account_binding_source");
            let still_loading = part
                .get("loading")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            for (k, v) in part {
                spec.insert(k, v);
            }
            if still_loading {
                break;
            }
        }
        spec.insert("active_session_id".into(), active_id);
        spec.insert("path".into(), active_path);
        spec.remove("_ledger_path");
    }

    fn adapter_state<'a>(inner: &'a mut CollectorInner, key: &str) -> &'a mut Map<String, Value> {
        if !inner.adapter_cache.contains_key(key) {
            let saved = inner
                .db
                .as_ref()
                .and_then(|db| {
                    db.query_row(
                        "SELECT data FROM trackers WHERE path=?1",
                        params![key],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                })
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_else(|| {
                    let mut m = Map::new();
                    m.insert("tokens".into(), json!(ZERO));
                    m.insert("model".into(), json!(""));
                    m.insert("last".into(), json!(0));
                    m.insert("seen".into(), json!({}));
                    m.insert("new".into(), json!(true));
                    m
                });
            inner.adapter_cache.insert(key.to_string(), saved);
        }
        inner.adapter_cache.get_mut(key).unwrap()
    }

    #[allow(clippy::too_many_arguments)]
    fn count_response(
        inner: &mut CollectorInner,
        key: &str,
        kind: &str,
        sid: &str,
        item_id: &str,
        item_tokens: [i64; 4],
        item_t: f64,
        item_model: &str,
        session_model: &str,
        item_cwd: &str,
    ) -> bool {
        let started = inner.started;
        let s = Self::adapter_state(inner, key);
        let seen = s
            .entry("seen")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .unwrap();
        let old: [i64; 4] = seen
            .get(item_id)
            .and_then(|v| v.as_array())
            .filter(|a| a.len() == 4)
            .map(|a| {
                [
                    a[0].as_i64().unwrap_or(0),
                    a[1].as_i64().unwrap_or(0),
                    a[2].as_i64().unwrap_or(0),
                    a[3].as_i64().unwrap_or(0),
                ]
            })
            .unwrap_or(ZERO);
        let new_v = [
            item_tokens[0].max(old[0]),
            item_tokens[1].max(old[1]),
            item_tokens[2].max(old[2]),
            item_tokens[3].max(old[3]),
        ];
        let delta = [
            new_v[0] - old[0],
            new_v[1] - old[1],
            new_v[2] - old[2],
            new_v[3] - old[3],
        ];
        if delta.iter().sum::<i64>() == 0 {
            return false;
        }
        seen.insert(item_id.to_string(), json!(new_v));
        let cur_tok: [i64; 4] = s
            .get("tokens")
            .and_then(|v| v.as_array())
            .filter(|a| a.len() == 4)
            .map(|a| {
                [
                    a[0].as_i64().unwrap_or(0),
                    a[1].as_i64().unwrap_or(0),
                    a[2].as_i64().unwrap_or(0),
                    a[3].as_i64().unwrap_or(0),
                ]
            })
            .unwrap_or(ZERO);
        s.insert(
            "tokens".into(),
            json!([
                cur_tok[0] + delta[0],
                cur_tok[1] + delta[1],
                cur_tok[2] + delta[2],
                cur_tok[3] + delta[3],
            ]),
        );
        let prev_last = s.get("last").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if item_t >= prev_last {
            let pick_model = if !session_model.is_empty() {
                session_model
            } else if !item_model.is_empty() {
                item_model
            } else {
                s.get("model").and_then(|v| v.as_str()).unwrap_or("")
            }
            .to_string();
            s.insert("model".into(), json!(pick_model));
            s.insert("last".into(), json!(item_t));
        }

        if item_t >= started {
            if let Some(ref db) = inner.db {
                let model_opt = if item_model.is_empty() {
                    None
                } else {
                    Some(item_model)
                };
                let cwd_opt = if item_cwd.is_empty() {
                    None
                } else {
                    Some(item_cwd)
                };
                let _ = db.execute(
                    "INSERT INTO events(t,sid,kind,fresh,cached,written,output,account,model,cwd) \
                     VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,?9)",
                    params![
                        item_t, sid, kind, delta[0], delta[1], delta[2], delta[3], model_opt,
                        cwd_opt,
                    ],
                );
            }
        }
        true
    }

    #[allow(clippy::too_many_arguments)]
    fn save_adapter(
        inner: &mut CollectorInner,
        key: &str,
        kind: &str,
        sid: &str,
        cwd: &str,
        title: &str,
        app_name: &str,
        now: f64,
    ) {
        let seat_name = openbot_seat(cwd, inner.observation.as_ref());
        let (is_new, model_str, serialized) = {
            let s = Self::adapter_state(inner, key);
            let was_new = s.remove("new").and_then(|v| v.as_bool()).unwrap_or(false);
            let m = s
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let txt = serde_json::to_string(s).unwrap_or_else(|_| "{}".into());
            (was_new, m, txt)
        };
        if let Some(ref db) = inner.db {
            if is_new {
                let project = seat_name.clone().unwrap_or_else(|| {
                    Path::new(cwd)
                        .file_name()
                        .and_then(|x| x.to_str())
                        .unwrap_or("")
                        .to_string()
                });
                let loc_app = if seat_name.is_some() || cwd == "OpenBot" {
                    "OpenBot"
                } else {
                    app_name
                };
                let entry = json!({
                    "id": sid,
                    "kind": kind,
                    "title": title,
                    "model": model_str,
                    "project": project,
                    "location": {"app": loc_app},
                });
                let _ = archive_remember(db, &[entry], now);
            }
            let _ = db.execute(
                "INSERT OR REPLACE INTO trackers VALUES (?1, ?2)",
                params![key, &serialized],
            );
        }
    }

    fn read_openmausbot(&self, inner: &mut CollectorInner, now: f64) -> HashMap<String, Value> {
        let mut totals: HashMap<String, ([i64; 4], String, f64)> = HashMap::new();
        for path in openmausbot_ledgers(&self.home, now) {
            let key = format!("openmausbot:{}", path.display());
            let mut s: Map<String, Value> = inner
                .db
                .as_ref()
                .and_then(|db| {
                    db.query_row(
                        "SELECT data FROM trackers WHERE path=?1",
                        params![&key],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                })
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default();

            if let Ok(meta) = std::fs::metadata(&path) {
                let ino = file_inode(&meta);
                let sz = meta.len();
                let prev_ino = s.get("inode").and_then(|v| v.as_u64());
                let prev_off = s.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
                if prev_ino != Some(ino) || sz < prev_off {
                    s.clear();
                    s.insert("inode".into(), json!(ino));
                    s.insert("offset".into(), json!(0));
                    s.insert("threads".into(), json!({}));
                }
                let off = s.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
                if off < sz {
                    if let Ok(mut f) = File::open(&path) {
                        if f.seek(SeekFrom::Start(off)).is_ok() {
                            let to_read = ((sz - off) as usize).min(64 * 1024 * 1024);
                            let mut buf = vec![0u8; to_read];
                            if let Ok(n) = f.read(&mut buf) {
                                buf.truncate(n);
                                if let Some(last_nl) = buf.iter().rposition(|b| *b == b'\n') {
                                    let end = last_nl + 1;
                                    let threads_map = s
                                        .entry("threads")
                                        .or_insert_with(|| json!({}))
                                        .as_object_mut()
                                        .unwrap();
                                    for line in buf[..end].split(|b| *b == b'\n') {
                                        if line.is_empty() {
                                            continue;
                                        }
                                        let Ok(Value::Object(row)) =
                                            serde_json::from_slice::<Value>(line)
                                        else {
                                            continue;
                                        };
                                        let Some(item) = parse_openmausbot_turn(&row) else {
                                            continue;
                                        };
                                        let th = threads_map
                                            .entry(item.thread.clone())
                                            .or_insert_with(
                                                || json!({"tokens": ZERO, "model": "", "last": 0}),
                                            )
                                            .as_object_mut()
                                            .unwrap();
                                        let cur: [i64; 4] = th
                                            .get("tokens")
                                            .and_then(|v| v.as_array())
                                            .filter(|a| a.len() == 4)
                                            .map(|a| {
                                                [
                                                    a[0].as_i64().unwrap_or(0),
                                                    a[1].as_i64().unwrap_or(0),
                                                    a[2].as_i64().unwrap_or(0),
                                                    a[3].as_i64().unwrap_or(0),
                                                ]
                                            })
                                            .unwrap_or(ZERO);
                                        th.insert(
                                            "tokens".into(),
                                            json!([
                                                cur[0] + item.tokens[0],
                                                cur[1] + item.tokens[1],
                                                cur[2] + item.tokens[2],
                                                cur[3] + item.tokens[3],
                                            ]),
                                        );
                                        let prev_last =
                                            th.get("last").and_then(|v| v.as_f64()).unwrap_or(0.0);
                                        if item.t >= prev_last {
                                            th.insert("model".into(), json!(item.model));
                                            th.insert("last".into(), json!(item.t));
                                        }
                                        if item.t >= inner.started
                                            && item.tokens.iter().sum::<i64>() > 0
                                        {
                                            if let Some(ref db) = inner.db {
                                                let sid = format!("openmausbot:{}", item.thread);
                                                let m_opt = if item.model.is_empty() {
                                                    None
                                                } else {
                                                    Some(item.model.as_str())
                                                };
                                                let _ = db.execute(
                                                    "INSERT INTO events(t,sid,kind,fresh,cached,written,output,account,model,cwd) \
                                                     VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,NULL)",
                                                    params![
                                                        item.t,
                                                        &sid,
                                                        &item.kind,
                                                        item.tokens[0],
                                                        item.tokens[1],
                                                        item.tokens[2],
                                                        item.tokens[3],
                                                        m_opt,
                                                    ],
                                                );
                                            }
                                        }
                                    }
                                    s.insert("offset".into(), json!(off + end as u64));
                                    if let (Some(db), Ok(txt)) =
                                        (inner.db.as_ref(), serde_json::to_string(&s))
                                    {
                                        let _ = db.execute(
                                            "INSERT OR REPLACE INTO trackers VALUES (?1, ?2)",
                                            params![&key, &txt],
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if let Some(threads) = s.get("threads").and_then(|v| v.as_object()) {
                for (tid, th) in threads {
                    let toks: [i64; 4] = th
                        .get("tokens")
                        .and_then(|v| v.as_array())
                        .filter(|a| a.len() == 4)
                        .map(|a| {
                            [
                                a[0].as_i64().unwrap_or(0),
                                a[1].as_i64().unwrap_or(0),
                                a[2].as_i64().unwrap_or(0),
                                a[3].as_i64().unwrap_or(0),
                            ]
                        })
                        .unwrap_or(ZERO);
                    let last = th.get("last").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let model = th
                        .get("model")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let entry = totals
                        .entry(tid.clone())
                        .or_insert_with(|| (ZERO, String::new(), 0.0));
                    for (dst, src) in entry.0.iter_mut().zip(toks.iter()) {
                        *dst += *src;
                    }
                    if last >= entry.2 {
                        entry.1 = model;
                        entry.2 = last;
                    }
                }
            }
        }

        totals
            .into_iter()
            .map(|(tid, (toks, model, last))| {
                (tid, json!({"tokens": toks, "model": model, "last": last}))
            })
            .collect()
    }

    fn read_devin(&self, inner: &mut CollectorInner, now: f64) -> HashMap<String, Value> {
        let dbs = inner
            .observer
            .as_ref()
            .map(|o| o.locations.devin_databases())
            .unwrap_or_else(|| vec![devin::database(&self.home)]);
        for path in dbs {
            if !path.is_file() {
                continue;
            }
            let key = format!("devin:{}", path.display());
            if !inner.devin_row.contains_key(&key) {
                let row_id = inner
                    .db
                    .as_ref()
                    .and_then(|db| {
                        db.query_row(
                            "SELECT data FROM trackers WHERE path=?1",
                            params![&key],
                            |r| r.get::<_, String>(0),
                        )
                        .ok()
                    })
                    .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                    .and_then(|v| v.get("row").and_then(|x| x.as_i64()))
                    .unwrap_or(0);
                inner.devin_row.insert(key.clone(), row_id);
            }
            for _ in 0..4 {
                let after = *inner.devin_row.get(&key).unwrap_or(&0);
                let Ok((last, found)) = devin::read_usage(&path, after, Some(now), 2000) else {
                    break;
                };
                let mut touched: HashMap<String, (String, String)> = HashMap::new();
                for item in &found {
                    let sid = format!("devin:{}", item.session);
                    if Self::count_response(
                        inner,
                        &sid,
                        "Devin",
                        &sid,
                        &item.id,
                        item.tokens,
                        item.t,
                        &item.model,
                        &item.session_model,
                        &item.cwd,
                    ) {
                        touched.insert(sid, (item.cwd.clone(), item.title.clone()));
                    }
                }
                for (sid, (cwd, title)) in touched {
                    Self::save_adapter(inner, &sid, "Devin", &sid, &cwd, &title, "Devin", now);
                }
                if last == after {
                    break;
                }
                inner.devin_row.insert(key.clone(), last);
                if let Some(ref db) = inner.db {
                    let _ = db.execute(
                        "INSERT OR REPLACE INTO trackers VALUES (?1, ?2)",
                        params![&key, json!({"row": last}).to_string()],
                    );
                }
            }
        }

        let devin_specs: Vec<(String, String)> = inner
            .specs
            .iter()
            .filter(|s| s.get("usage_adapter").and_then(|v| v.as_str()) == Some("devin"))
            .filter_map(|s| {
                let cid = s.get("conversation_id").and_then(|v| v.as_str())?;
                let id = s.get("id").and_then(|v| v.as_str())?;
                Some((cid.to_string(), id.to_string()))
            })
            .collect();
        let mut out = HashMap::new();
        for (cid, id) in devin_specs {
            let st = Self::adapter_state(inner, &id).clone();
            out.insert(cid, Value::Object(st));
        }
        out
    }

    fn read_antigravity(
        &self,
        inner: &mut CollectorInner,
        now: f64,
        mut budget: usize,
    ) -> HashMap<String, Value> {
        let roots = inner
            .observer
            .as_ref()
            .map(|o| o.locations.antigravity_roots())
            .unwrap_or_else(|| antigravity::roots(&self.home));
        let mut files: HashMap<String, (f64, PathBuf, PathBuf, Value)> = HashMap::new();
        for root in roots {
            let conv_dir = root.join("conversations");
            let Ok(rd) = std::fs::read_dir(&conv_dir) else {
                continue;
            };
            for entry in rd.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("db") {
                    continue;
                }
                let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                if !antigravity::is_conversation_id(stem) {
                    continue;
                }
                let Ok(st) = std::fs::metadata(&path) else {
                    continue;
                };
                let wal_path = PathBuf::from(format!("{}-wal", path.display()));
                let (wal_mt, wal_sz) = std::fs::metadata(&wal_path)
                    .map(|m| (mtime_secs(&m), m.len()))
                    .unwrap_or((0.0, 0));
                let mt = mtime_secs(&st);
                let mark = json!([mt, st.len(), wal_mt, wal_sz]);
                let at = mt.max(wal_mt);
                let replace = files.get(stem).map(|prev| at > prev.0).unwrap_or(true);
                if replace {
                    files.insert(stem.to_string(), (at, root.clone(), path, mark));
                }
            }
        }

        let mut ordered: Vec<(String, f64, PathBuf, PathBuf, Value)> = files
            .into_iter()
            .map(|(stem, (at, root, path, mark))| (stem, at, root, path, mark))
            .collect();
        ordered.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut catalogs: HashMap<PathBuf, BTreeMap<String, antigravity::CatalogRow>> =
            HashMap::new();
        for (stem, _, root, path, mark) in ordered {
            let key = format!("antigravity:{stem}");
            let (same_mark, prev_step) = {
                let s = Self::adapter_state(inner, &key);
                (
                    s.get("mark") == Some(&mark),
                    s.get("step").and_then(|v| v.as_i64()).unwrap_or(-1),
                )
            };
            if same_mark {
                continue;
            }
            if budget == 0 {
                break;
            }
            budget -= 1;

            let cat = catalogs
                .entry(root.clone())
                .or_insert_with(|| antigravity::read_catalog(&root));
            let (cwd, title) = cat
                .get(&stem)
                .map(|c| (c.cwd.clone(), c.title.clone()))
                .unwrap_or_default();

            let (last, found) =
                match antigravity::read_usage(&path, prev_step, &inner.antigravity_models) {
                    Ok((l, rows, discovered)) => {
                        for (num, name) in discovered {
                            inner.antigravity_models.insert(num, name);
                        }
                        (l, rows)
                    }
                    Err(_) => (prev_step, Vec::new()),
                };

            let mut again = HashSet::new();
            for item in &found {
                again.insert(item.id.clone());
                let resolved_model = if !item.model.is_empty() {
                    item.model.clone()
                } else {
                    inner
                        .antigravity_models
                        .get(&item.model_num)
                        .cloned()
                        .unwrap_or_default()
                };
                let toks = [
                    item.tokens[0] as i64,
                    item.tokens[1] as i64,
                    item.tokens[2] as i64,
                    item.tokens[3] as i64,
                ];
                Self::count_response(
                    inner,
                    &key,
                    "Antigravity",
                    &stem,
                    &item.id,
                    toks,
                    item.t,
                    &resolved_model,
                    &resolved_model,
                    &cwd,
                );
            }
            {
                let s = Self::adapter_state(inner, &key);
                if !found.is_empty() {
                    if let Some(seen) = s.get_mut("seen").and_then(|v| v.as_object_mut()) {
                        seen.retain(|rid, _| again.contains(rid));
                    }
                }
                s.insert("mark".into(), mark);
                s.insert("step".into(), json!(last));
            }
            Self::save_adapter(inner, &key, "Antigravity", &stem, &cwd, &title, "", now);
        }

        let ag_cids: Vec<String> = inner
            .specs
            .iter()
            .filter(|s| {
                s.get("kind").and_then(|v| v.as_str()) == Some("Antigravity")
                    && s.get("path")
                        .and_then(|v| v.as_str())
                        .is_none_or(str::is_empty)
            })
            .filter_map(|s| {
                s.get("conversation_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .collect();
        let mut out = HashMap::new();
        for cid in ag_cids {
            let key = format!("antigravity:{cid}");
            let st = Self::adapter_state(inner, &key).clone();
            out.insert(cid, Value::Object(st));
        }
        out
    }

    fn claude_quota(&self, now: f64) -> Value {
        let mut entries = Vec::new();
        let p = self
            .home
            .join("Library/Logs/proc-logger/claude-limits.jsonl");
        if let Ok(mut f) = File::open(&p) {
            if let Ok(meta) = f.metadata() {
                if meta.len() > 1024 * 1024 {
                    let _ = f.seek(SeekFrom::End(-(1024 * 1024)));
                    let mut discard = String::new();
                    let mut rdr = BufReader::new(f);
                    let _ = rdr.read_line(&mut discard);
                    for line in rdr.lines().map_while(Result::ok) {
                        if let Ok(v) = serde_json::from_str::<Value>(&line) {
                            entries.push(v);
                        }
                    }
                } else {
                    let rdr = BufReader::new(f);
                    for line in rdr.lines().map_while(Result::ok) {
                        if let Ok(v) = serde_json::from_str::<Value>(&line) {
                            entries.push(v);
                        }
                    }
                }
            }
        }
        let (windows, latest) = claude_windows_legacy(&entries, now);
        let updated = latest
            .as_ref()
            .and_then(|l| l.get("t").and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        json!({
            "kind": "Claude",
            "windows": windows,
            "updated": updated,
            "note": "가장 최근 상태줄 보고 · 계정 전체 합계 아님",
        })
    }

    fn quotas(&self, sessions: &[Map<String, Value>], now: f64) -> Vec<Value> {
        let mut out = vec![self.claude_quota(now)];
        let best_q = sessions
            .iter()
            .filter_map(|s| s.get("quota").and_then(|v| v.as_object()))
            .max_by(|a, b| {
                let ta = a.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let tb = b.get("t").and_then(|v| v.as_f64()).unwrap_or(0.0);
                ta.partial_cmp(&tb).unwrap_or(std::cmp::Ordering::Equal)
            });
        let qt = best_q
            .and_then(|q| q.get("t").and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        let mut windows = Vec::new();
        if let Some(rl) = best_q.and_then(|q| q.get("rl")).and_then(|v| v.as_object()) {
            for key in ["primary", "secondary"] {
                let Some(w) = rl.get(key).and_then(|v| v.as_object()) else {
                    continue;
                };
                let mins = w
                    .get("window_minutes")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let reset = epoch_from_value(w.get("resets_at"));
                let label = match mins {
                    10080 => "주간".to_string(),
                    300 => "5시간".to_string(),
                    m => format!("{m}분"),
                };
                let pct = if reset > now {
                    w.get("used_percent").cloned().unwrap_or(Value::Null)
                } else {
                    Value::Null
                };
                windows.push(json!({"label": label, "pct": pct, "reset": reset, "t": qt}));
            }
        }
        out.push(json!({
            "kind": "Codex",
            "windows": windows,
            "updated": qt,
            "note": "가장 최근 세션이 보고한 계정 한도",
        }));
        out.extend(self.accounts.providers_snapshot(now));
        out
    }

    fn reports_snapshot(
        &self,
        inner: &mut CollectorInner,
        account_quotas: &[Value],
        weekly_val: &Value,
        now: f64,
    ) -> (Value, Vec<Value>, Value) {
        let cur_value = self.reports_value.lock().ok().and_then(|g| g.clone());
        let needs_recompute = cur_value
            .as_ref()
            .and_then(|v| v.get("end").and_then(|e| e.as_f64()))
            .map(|end| now - end >= 60.0)
            .unwrap_or(true);
        if needs_recompute {
            if let Some(hist) = self.history_store() {
                if self
                    .reports_running
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    let quotas_cloned = account_quotas.to_vec();
                    let overrides = reports::read_plans(&self.data_dir);
                    let rv_slot = Arc::clone(&self.reports_value);
                    let vr_slot = Arc::clone(&self.value_report);
                    let running_flag = Arc::clone(&self.reports_running);
                    let _ = std::thread::Builder::new()
                        .name("1top-reports".into())
                        .spawn(move || {
                            if let Ok(mut vr) = vr_slot.lock() {
                                let computed = vr.compute(
                                    |start, end| hist.model_totals(start, end),
                                    &quotas_cloned,
                                    &overrides,
                                    now_epoch(),
                                );
                                if let Ok(mut slot) = rv_slot.lock() {
                                    *slot = Some(computed);
                                }
                            }
                            running_flag.store(false, Ordering::SeqCst);
                        });
                }
            }
        }

        if now - inner.reports_weekly.0 >= 30.0 {
            if let Some(ref db) = inner.db {
                let wk = reports::weekly(db, now).ok().flatten();
                let lw = reports::last_week(db, now).ok().flatten();
                inner.reports_weekly = (now, wk, lw);
            } else {
                inner.reports_weekly = (now, None, None);
            }
        }

        let week = inner.reports_weekly.1.clone();
        let last = inner.reports_weekly.2.clone();
        let value_now = self.reports_value.lock().ok().and_then(|g| g.clone());

        let mut names: HashMap<String, String> = HashMap::new();
        for q in account_quotas {
            let Some(id) = q
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let alias = q
                .get("alias")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());
            let label = if let Some(a) = alias {
                a.to_string()
            } else {
                let kind = q.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                let base = match kind {
                    "Claude" => "Claude Code",
                    "Antigravity" => "Agy CLI",
                    other => other,
                };
                let plan = q.get("plan").and_then(|v| v.as_str()).unwrap_or("");
                if plan.is_empty() {
                    base.to_string()
                } else {
                    let mut chars = plan.chars();
                    let titled = match chars.next() {
                        Some(first) => {
                            format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase())
                        }
                        None => String::new(),
                    };
                    format!("{base} {titled}")
                }
            };
            names.insert(id.to_string(), label.trim().to_string());
        }

        let (items, settings) = reports::compute_notices(
            &self.data_dir,
            account_quotas,
            Some(weekly_val),
            &names,
            last.as_ref(),
            value_now.as_ref(),
            now,
        );

        let mut rep = Map::new();
        rep.insert("version".into(), json!(1));
        rep.insert("as_of".into(), json!(now));
        if let Some(v) = value_now {
            rep.insert("value".into(), v);
        }
        if let Some(w) = week {
            rep.insert("weekly".into(), w);
        }
        (Value::Object(rep), items, settings)
    }

    pub fn collect_once(&self) -> Result<(), String> {
        let collect_started = Instant::now();
        let mut inner = self.inner.lock().unwrap();
        if now_epoch() - inner.discovery_at > 9.0 {
            self.discover(&mut inner);
        } else {
            Self::refresh_sessions(&mut inner);
        }

        let now = now_epoch();
        let roots = self.accounts.roots();
        let mut account_quotas = self.accounts.snapshot(now);
        inner.routing_bindings = load_routing_bindings(&self.data_dir, now);

        let telemetry_val = self
            .telemetry_store()
            .and_then(|t| t.snapshot(Some(now)).ok())
            .unwrap_or_else(|| json!({"available": false}));
        let telemetry_sessions = session_index(&telemetry_val);

        // Batch all collector SQLite mutations into one WAL transaction per phase
        // (matching Python sqlite3's implicit transaction + explicit db.commit()).
        let mut in_tx1 = false;
        if let Some(ref db) = inner.db {
            in_tx1 = db.execute_batch("BEGIN IMMEDIATE").is_ok();
        }

        let mausbot = self.read_openmausbot(&mut inner, now);
        let devin_map = self.read_devin(&mut inner, now);
        let ag_map = self.read_antigravity(&mut inner, now, 24);

        let raw_specs = inner.specs.clone();
        let mut sessions_maps: Vec<Map<String, Value>> = Vec::with_capacity(raw_specs.len());
        for src in &raw_specs {
            let mut s = public_session(src);
            let kind = s
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let binding = if kind == "Aside" {
                inner
                    .db
                    .as_ref()
                    .and_then(|db| weekly_usage::bind_adapter(db, &s, &roots, now))
            } else {
                weekly_usage::account_for(&s, &roots)
            };
            if let Some((aid, since)) = binding {
                s.insert("account_binding".into(), json!([aid, since]));
            } else {
                s.insert("account_binding".into(), Value::Null);
            }
            s.remove("billing_account");

            let captured = session_statusline_binding(&mut s, now, Some(&account_quotas));
            if s.get("account_binding_uncertain").and_then(|v| v.as_bool()) == Some(true) {
                s.insert("account_binding".into(), Value::Null);
                s.insert(
                    "account_binding_source".into(),
                    json!("claude_identity_unconfirmed"),
                );
            }
            if let Some((aid, since)) = captured {
                s.insert("account_binding".into(), json!([aid, since]));
                s.insert(
                    "account_binding_source".into(),
                    json!("claude_statusline_session"),
                );
            }
            bind_account(&mut s, &telemetry_sessions, &roots);

            let cfg_model = s
                .get("configured_model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            s.insert("tokens".into(), Value::Null);
            s.insert("model".into(), Value::String(cfg_model));
            s.insert("last_usage".into(), json!(0));
            s.insert("loading".into(), Value::Bool(false));

            let adapter = s
                .get("usage_adapter")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let conv_id = s
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            if adapter == "openmausbot" {
                if let Some(ledger) = conv_id.as_deref().and_then(|c| mausbot.get(c)) {
                    s.insert(
                        "tokens".into(),
                        ledger.get("tokens").cloned().unwrap_or(Value::Null),
                    );
                    if let Some(m) = ledger
                        .get("model")
                        .and_then(|v| v.as_str())
                        .filter(|x| !x.is_empty())
                    {
                        s.insert("model".into(), json!(m));
                    }
                    s.insert(
                        "last_usage".into(),
                        ledger.get("last").cloned().unwrap_or_else(|| json!(0)),
                    );
                }
            }

            let adapter_ledger = if adapter == "devin" {
                conv_id.as_deref().and_then(|c| devin_map.get(c))
            } else if kind == "Antigravity" {
                conv_id.as_deref().and_then(|c| ag_map.get(c))
            } else {
                None
            };
            if let Some(ledger) = adapter_ledger {
                let has_mark = ledger.get("mark").is_some();
                if kind == "Devin" || has_mark {
                    s.insert(
                        "tokens".into(),
                        ledger.get("tokens").cloned().unwrap_or(Value::Null),
                    );
                    if let Some(m) = ledger
                        .get("model")
                        .and_then(|v| v.as_str())
                        .filter(|x| !x.is_empty())
                    {
                        s.insert("model".into(), json!(m));
                    }
                    s.insert(
                        "last_usage".into(),
                        ledger.get("last").cloned().unwrap_or_else(|| json!(0)),
                    );
                } else {
                    s.insert("loading".into(), Value::Bool(true));
                }
            }

            if s.get("path")
                .and_then(|v| v.as_str())
                .is_some_and(|p| !p.is_empty())
            {
                let has_cont = s
                    .get("continuation_sources")
                    .and_then(|v| v.as_array())
                    .is_some_and(|a| !a.is_empty());
                if has_cont {
                    Self::read_continuation(
                        &mut inner,
                        &mut s,
                        &roots,
                        &telemetry_sessions,
                        &account_quotas,
                        now,
                    );
                } else {
                    Self::read_tracker(&mut inner, &mut s);
                }
            }

            if matches!(kind.as_str(), "Claude" | "GLM") {
                apply_statusline(&mut s, now, None);
            }
            enrich(&mut s, &telemetry_sessions);

            let cur_status = s.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if !matches!(
                cur_status,
                "working"
                    | "subagents"
                    | "done"
                    | "idle"
                    | "waiting"
                    | "interrupted"
                    | "disconnected"
            ) {
                s.insert("status".into(), json!("unknown"));
            }

            let project = s
                .get("project_name")
                .and_then(|v| v.as_str())
                .filter(|x| !x.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    s.get("cwd")
                        .and_then(|v| v.as_str())
                        .and_then(|p| Path::new(p).file_name())
                        .and_then(|n| n.to_str())
                        .filter(|x| !x.is_empty())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "알 수 없음".to_string());
            s.insert("project".into(), Value::String(project));

            sessions_maps.push(s);
        }

        let sessions_vals_tmp: Vec<Value> = sessions_maps
            .iter()
            .map(|m| Value::Object(m.clone()))
            .collect();
        if let Some(ref db) = inner.db {
            let _ = archive_remember(db, &sessions_vals_tmp, now);
            if in_tx1 {
                let _ = db.execute_batch("COMMIT");
            }
        }

        let (events, recent) = if let Some(ref db) = inner.db {
            let mut evs = Vec::new();
            if let Ok(mut stmt) = db.prepare(
                "SELECT CAST(t/60 AS INTEGER)*60, kind, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
                 FROM events WHERE t>?1 AND t<=?2 GROUP BY 1,2 ORDER BY 1",
            ) {
                if let Ok(rows) = stmt.query_map(params![now - 86400.0, now], |r| {
                    Ok(json!({
                        "t": r.get::<_, i64>(0)?,
                        "kind": r.get::<_, String>(1)?,
                        "fresh": r.get::<_, i64>(2).unwrap_or(0),
                        "cached": r.get::<_, i64>(3).unwrap_or(0),
                        "written": r.get::<_, i64>(4).unwrap_or(0),
                        "output": r.get::<_, i64>(5).unwrap_or(0),
                    }))
                }) {
                    for r in rows.flatten() {
                        evs.push(r);
                    }
                }
            }
            let mut rec = Map::new();
            if let Ok(mut stmt) = db.prepare(
                "SELECT kind, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
                 FROM events WHERE t>?1 GROUP BY kind",
            ) {
                if let Ok(rows) = stmt.query_map(params![now - 300.0], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        json!([
                            r.get::<_, i64>(1).unwrap_or(0),
                            r.get::<_, i64>(2).unwrap_or(0),
                            r.get::<_, i64>(3).unwrap_or(0),
                            r.get::<_, i64>(4).unwrap_or(0),
                        ]),
                    ))
                }) {
                    for (k, v) in rows.flatten() {
                        rec.insert(k, v);
                    }
                }
            }
            (evs, Value::Object(rec))
        } else {
            (Vec::new(), json!({}))
        };

        let quotas = self.quotas(&sessions_maps, now);
        for s in &mut sessions_maps {
            s.remove("quota");
        }

        let known_kinds: Vec<String> = sessions_maps
            .iter()
            .filter(|s| s.get("tokens").is_some_and(|v| !v.is_null()))
            .filter_map(|s| s.get("kind").and_then(|v| v.as_str()).map(str::to_string))
            .collect();

        let (minute, five, history_map, window) = inner
            .db
            .as_ref()
            .and_then(|db| session_usage(db, now, inner.started).ok())
            .unwrap_or_else(|| (HashMap::new(), HashMap::new(), HashMap::new(), 60.0));

        let (periods, session_periods) = inner
            .db
            .as_ref()
            .and_then(|db| window_usage(db, now, inner.started, &known_kinds, None).ok())
            .unwrap_or_else(|| {
                (
                    json!({"windows": [], "started": inner.started}),
                    HashMap::new(),
                )
            });

        account_quotas = self.accounts.snapshot(now);
        let sessions_for_restore: Vec<Value> = sessions_maps
            .iter()
            .map(|m| Value::Object(m.clone()))
            .collect();
        if let Some(ref db) = inner.db {
            weekly_usage::restore_bound_claude_accounts(
                db,
                &mut account_quotas,
                &sessions_for_restore,
                now,
                claude_statusline_report,
            );
            weekly_usage::restore_claude_last_report(db, &mut account_quotas, now);
        }
        apply_aliases(&mut account_quotas, &self.data_dir);
        {
            let CollectorInner { db, spans, .. } = &mut *inner;
            if let Some(ref db) = db {
                let in_tx2 = db.execute_batch("BEGIN IMMEDIATE").is_ok();
                let _ = weekly_usage::record(db, &account_quotas, now);
                let _ = spans.record(db, &sessions_for_restore, now);
                if in_tx2 {
                    let _ = db.execute_batch("COMMIT");
                }
            }
        }

        let explicit_bindings: HashMap<String, String> = sessions_maps
            .iter()
            .filter_map(|s| {
                let id = s.get("id").and_then(|v| v.as_str())?;
                let acct = s
                    .get("account_binding")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|v| v.as_str())?;
                Some((id.to_string(), acct.to_string()))
            })
            .collect();

        let (weekly_val, estimates) = inner
            .db
            .as_ref()
            .and_then(|db| {
                weekly_usage::snapshot(
                    db,
                    &account_quotas,
                    now,
                    Some(&explicit_bindings),
                    Some(inner.started),
                )
                .ok()
            })
            .unwrap_or_else(|| (json!({"accounts": []}), HashMap::new()));

        for s in &mut sessions_maps {
            let binding_acct = s
                .remove("account_binding")
                .and_then(|v| v.as_array().and_then(|a| a.first().cloned()))
                .and_then(|v| v.as_str().map(str::to_string));
            s.remove("_routing_intervals");
            s.remove("_routing_original_binding");

            let sid = s
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let known = s.get("tokens").is_some_and(|v| !v.is_null());
            let loading = s.get("loading").and_then(|v| v.as_bool()).unwrap_or(false);
            let v_opt = if known {
                Some(minute.get(&sid).copied().unwrap_or(ZERO))
            } else {
                None
            };
            let five_opt = if known {
                Some(five.get(&sid).copied().unwrap_or(ZERO))
            } else {
                None
            };
            let rate = v_opt.map(|v| v.iter().sum::<i64>() as f64 / window);
            let output_rate = v_opt.map(|v| v[3] as f64 / window);
            let hist_list = history_map.get(&sid).cloned().unwrap_or_default();
            let weekly_est = if known && !loading {
                estimates
                    .get(&sid)
                    .map(|m| Value::Object(m.clone()))
                    .unwrap_or_else(|| json!({}))
            } else {
                json!({})
            };
            let mut win_map = Map::new();
            for (wk, _, _) in WINDOWS {
                if known {
                    let vals = session_periods
                        .get(&sid)
                        .and_then(|m| m.get(wk))
                        .copied()
                        .unwrap_or(ZERO);
                    win_map.insert(wk.to_string(), json!(vals));
                } else {
                    win_map.insert(wk.to_string(), Value::Null);
                }
            }
            s.insert(
                "usage".into(),
                json!({
                    "last_minute": v_opt.map(|v| json!(v)).unwrap_or(Value::Null),
                    "last_five_minutes": five_opt.map(|v| json!(v)).unwrap_or(Value::Null),
                    "rate": rate,
                    "output_rate": output_rate,
                    "window_seconds": window,
                    "history": hist_list,
                    "weekly_estimate": weekly_est,
                    "weekly_account": binding_acct,
                    "windows": Value::Object(win_map),
                }),
            );
        }

        // Sample system + per-session resources via NativeResourceSampler.
        let mut candidates: HashMap<String, Vec<(u32, Option<f64>)>> = HashMap::new();
        for s in &sessions_maps {
            let sid = s
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let mut list = Vec::new();
            if let Some(runs) = s.get("runs").and_then(|v| v.as_array()) {
                for r in runs {
                    if let Some(pid) = r.get("pid").and_then(|v| v.as_u64()) {
                        let birth = r.get("birth").and_then(|v| v.as_f64());
                        list.push((pid as u32, birth));
                    }
                }
            }
            if list.is_empty() {
                if let Some(pids) = s.get("pids").and_then(|v| v.as_array()) {
                    for p in pids {
                        if let Some(pid) = p.as_u64() {
                            list.push((pid as u32, None));
                        }
                    }
                }
            }
            candidates.insert(sid, list);
        }
        let shared_roots = inner.shared_roots.clone();
        let (system_snap, per_session_res) = inner.resources.sample(&candidates, &shared_roots);
        for s in &mut sessions_maps {
            let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(rg) = per_session_res.get(sid) {
                s.insert(
                    "resources".into(),
                    serde_json::to_value(rg).unwrap_or(Value::Null),
                );
            } else {
                s.insert(
                    "resources".into(),
                    json!({"cpu": Value::Null, "rss": 0, "count": 0, "pids": []}),
                );
            }
        }

        let sessions_vals: Vec<Value> = sessions_maps.into_iter().map(Value::Object).collect();
        let root_sessions = group_sessions(&sessions_vals);
        let ops = inner.operations.sample(&sessions_vals);
        let (report, notice_list, notice_settings) =
            self.reports_snapshot(&mut inner, &account_quotas, &weekly_val, now);

        let mut tel_public = telemetry_val.as_object().cloned().unwrap_or_default();
        tel_public.remove("sessions");

        let collection_ms =
            (collect_started.elapsed().as_secs_f64() * 1000.0 * 10.0).round_ties_even() / 10.0;

        let mut result = Map::new();
        result.insert("ready".into(), Value::Bool(true));
        result.insert("version".into(), Value::String(APP_VERSION.to_string()));
        result.insert("updated".into(), json!(now));
        result.insert("started".into(), json!(inner.started));
        result.insert("sessions".into(), Value::Array(sessions_vals));
        result.insert("reports".into(), report);
        result.insert("notices".into(), Value::Array(notice_list));
        result.insert("notification_settings".into(), notice_settings);
        result.insert("history_started".into(), json!(inner.history_started));
        result.insert("root_sessions".into(), Value::Array(root_sessions));
        result.insert("events".into(), Value::Array(events));
        result.insert("recent".into(), recent);
        result.insert("period_usage".into(), periods);
        result.insert("quotas".into(), Value::Array(quotas));
        result.insert(
            "process_counts".into(),
            serde_json::to_value(&inner.process_counts).unwrap_or_else(|_| json!({})),
        );
        result.insert("orca_terminals".into(), json!(inner.terminal_count));
        result.insert("error".into(), Value::Null);
        result.insert("poll_seconds".into(), json!(3));
        result.insert("applications".into(), Value::Array(inner.apps.clone()));
        result.insert(
            "system".into(),
            serde_json::to_value(&system_snap).unwrap_or_else(|_| json!({})),
        );
        result.insert("operations".into(), ops);
        result.insert("account_quotas".into(), Value::Array(account_quotas));
        result.insert("weekly_usage".into(), weekly_val);
        result.insert("telemetry".into(), Value::Object(tel_public));
        result.insert("collection_ms".into(), json!(collection_ms));

        drop(inner);
        if let Ok(mut snap) = self.snapshot.lock() {
            *snap = result;
        }
        Ok(())
    }

    fn tick_mailbox(&self) {
        if self
            .mailbox_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let ctrl = Arc::clone(&self.controller);
        let snap = self.raw_snapshot();
        let flag = Arc::clone(&self.mailbox_running);
        let _ = std::thread::Builder::new()
            .name("1top-mailbox".into())
            .spawn(move || {
                ctrl.flush_mailbox(&snap);
                flag.store(false, Ordering::SeqCst);
            });
    }

    pub fn run_loop(&self) {
        let mut initialized = false;
        while !self.stop.load(Ordering::Relaxed) {
            let before = Instant::now();
            let step = if !initialized {
                self.start_background_services();
                match self.initialize() {
                    Ok(()) => {
                        initialized = true;
                        self.collect_once()
                    }
                    Err(e) => Err(e),
                }
            } else {
                self.collect_once()
            };

            if let Err(err) = step {
                if let Ok(mut snap) = self.snapshot.lock() {
                    snap.insert("error".into(), Value::String(err));
                }
            }
            if initialized {
                self.tick_mailbox();
            }

            let elapsed = before.elapsed().as_secs_f64();
            let sleep_s = (3.0 - elapsed).max(0.2);
            let chunks = (sleep_s / 0.1).ceil() as usize;
            for _ in 0..chunks {
                if self.stop.load(Ordering::Relaxed) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}
