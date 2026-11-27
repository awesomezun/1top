//! Exact port of `history.py`.
use crate::ledger::{first_codex_report, token_vector};
use crate::observers::parse_openmausbot_turn;
use crate::sessions::sha256_hex;
use crate::text::epoch_from_value;
use crate::usage::{has_column, parse_period, PeriodDuration, WINDOWS};
use chrono::{Datelike, Duration, Local, LocalResult, TimeZone, Timelike};
use regex::Regex;
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

fn uuid_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$").unwrap())
}

fn non_alnum_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^A-Za-z0-9]").unwrap())
}

pub fn initialize_capture(db: &Connection) -> rusqlite::Result<()> {
    if !has_column(db, "events", "t") {
        return Ok(());
    }
    if !has_column(db, "events", "model") {
        let _ = db.execute("ALTER TABLE events ADD COLUMN model TEXT", []);
    }
    if !has_column(db, "events", "cwd") {
        let _ = db.execute("ALTER TABLE events ADD COLUMN cwd TEXT", []);
    }
    let _ = db.execute(
        "CREATE INDEX IF NOT EXISTS event_session_time ON events(sid,t)",
        [],
    );
    Ok(())
}

fn local_timestamp_floor(ts: f64) -> Option<chrono::DateTime<Local>> {
    Local.timestamp_opt(ts.floor() as i64, 0).single()
}

fn local_midnight(dt: chrono::DateTime<Local>) -> Option<chrono::DateTime<Local>> {
    let naive = dt.date_naive().and_hms_opt(0, 0, 0)?;
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => Some(d),
        LocalResult::None => Some(dt),
    }
}

/// Exact port of `history.py:edges_for`.
pub fn edges_for(start: f64, end: f64, step: &str) -> Result<Vec<f64>, &'static str> {
    if !start.is_finite() || start < 0.0 || !end.is_finite() {
        return Err("Unsupported history range");
    }
    let step_secs: Option<i64> = match step {
        "60" => Some(60),
        "300" => Some(300),
        "900" => Some(900),
        "3600" => Some(3600),
        _ => None,
    };
    if let Some(size) = step_secs {
        let local = local_timestamp_floor(start).ok_or("Unsupported history range")?;
        let min = if size < 3600 {
            let step_m = (size / 60) as u32;
            (local.minute() / step_m) * step_m
        } else {
            0
        };
        let naive = local
            .date_naive()
            .and_hms_opt(local.hour(), min, 0)
            .ok_or("Unsupported history range")?;
        let first_dt = match Local.from_local_datetime(&naive) {
            LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => d,
            LocalResult::None => local,
        };
        let first = first_dt.timestamp() as f64;
        let count = (((end - first) / (size as f64)).floor() as i64) + 1;
        if !(0..=400).contains(&count) {
            return Err("More than 400 bins");
        }
        return Ok((0..count).map(|i| first + (i * size) as f64).collect());
    }
    if step != "day" && step != "week" {
        return Err("Invalid step");
    }
    let local = local_timestamp_floor(start).ok_or("Unsupported history range")?;
    let mut day = local.date_naive();
    if step == "week" {
        let wd = day.weekday().num_days_from_monday() as i64;
        day -= Duration::days(wd);
    }
    let mut result = Vec::new();
    loop {
        let naive = day
            .and_hms_opt(0, 0, 0)
            .ok_or("Unsupported history range")?;
        let ts = match Local.from_local_datetime(&naive) {
            LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => d.timestamp() as f64,
            LocalResult::None => (day.and_hms_opt(1, 0, 0).unwrap().and_utc().timestamp()) as f64,
        };
        if ts > end {
            break;
        }
        if result.len() >= 400 {
            return Err("More than 400 bins");
        }
        result.push(ts);
        day += Duration::days(if step == "week" { 7 } else { 1 });
    }
    Ok(result)
}

#[cfg(unix)]
fn file_dev_ino(meta: &std::fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!("{}:{}", meta.dev(), meta.ino())
}

#[cfg(not(unix))]
fn file_dev_ino(_meta: &std::fs::Metadata) -> String {
    "0:0".into()
}

fn byte_contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn now_epoch() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[derive(Debug, Clone, Default)]
pub struct ImportProgress {
    pub running: bool,
    pub files_done: usize,
    pub files_total: usize,
    pub failed: usize,
}

type HistoryCacheKey = (String, String, Option<String>, i64, u64);
type HeatCacheKey = (Option<String>, i64, u64);

pub struct HistoryStore {
    pub directory: PathBuf,
    pub path: PathBuf,
    pub monitor: PathBuf,
    lock: Mutex<()>,
    cache: Mutex<HashMap<HistoryCacheKey, Value>>,
    heat_cache: Mutex<HashMap<HeatCacheKey, Value>>,
    generation: AtomicU64,
    progress: Mutex<ImportProgress>,
    stop_flag: Arc<AtomicBool>,
}

impl HistoryStore {
    pub fn new(directory: &Path, monitor: Option<&Path>) -> rusqlite::Result<Self> {
        let dir = std::fs::canonicalize(directory).unwrap_or_else(|_| directory.to_path_buf());
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("history.sqlite");
        let mon = monitor
            .map(|p| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf()))
            .unwrap_or_else(|| dir.join("monitor.sqlite"));
        let store = Self {
            directory: dir,
            path,
            monitor: mon,
            lock: Mutex::new(()),
            cache: Mutex::new(HashMap::new()),
            heat_cache: Mutex::new(HashMap::new()),
            generation: AtomicU64::new(0),
            progress: Mutex::new(ImportProgress::default()),
            stop_flag: Arc::new(AtomicBool::new(false)),
        };
        let db = store.connect()?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, inode TEXT, offset INTEGER,
                 state TEXT, completed REAL, error TEXT);
             CREATE TABLE IF NOT EXISTS records(key TEXT PRIMARY KEY, sid TEXT, source TEXT,
                 kind TEXT, t REAL, model TEXT, cwd TEXT, fresh INTEGER, cached INTEGER,
                 written INTEGER, output INTEGER);
             CREATE INDEX IF NOT EXISTS history_time ON records(t);
             CREATE INDEX IF NOT EXISTS history_kind_time ON records(kind,t);
             CREATE INDEX IF NOT EXISTS history_coverage ON records(source,kind,t);
             CREATE TABLE IF NOT EXISTS metadata(sid TEXT, t REAL, model TEXT, cwd TEXT,
                 PRIMARY KEY(sid,t));",
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&store.path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(store)
    }

    pub fn connect(&self) -> rusqlite::Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(std::time::Duration::from_secs(10))?;
        let _ = db.execute_batch("PRAGMA synchronous=NORMAL; PRAGMA cache_size=-2000;");
        Ok(db)
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }

    pub fn discover_files(
        &self,
        profile_roots: &[(String, PathBuf)],
    ) -> Vec<(String, PathBuf, f64)> {
        let home = crate::platform_support::home_dir();
        let mausbot = non_alnum_re()
            .replace_all(&home.join(".openmausbot").to_string_lossy(), "-")
            .into_owned();
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();

        for (kind, root) in profile_roots {
            let pattern = if kind == "Codex" {
                "rollout-*.jsonl"
            } else {
                "*.jsonl"
            };
            let folders: Vec<PathBuf> = if kind == "Codex" {
                vec![root.join("sessions"), root.join("archived_sessions")]
            } else {
                vec![root.join("projects")]
            };
            for folder in folders {
                if !folder.is_dir() {
                    continue;
                }
                let glob_pat = format!("{}/**/{pattern}", folder.display());
                if let Ok(paths) = glob::glob(&glob_pat) {
                    for p in paths.flatten() {
                        if kind != "Codex" {
                            if let Ok(rel) = p.strip_prefix(&folder) {
                                if let Some(first) =
                                    rel.components().next().and_then(|c| c.as_os_str().to_str())
                                {
                                    if first.starts_with(&mausbot) {
                                        continue;
                                    }
                                }
                            }
                        }
                        if let Ok(meta) = std::fs::metadata(&p) {
                            let key = file_dev_ino(&meta);
                            if !seen.insert(key) {
                                continue;
                            }
                            let mt = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs_f64())
                                .unwrap_or(0.0);
                            out.push((kind.clone(), p, mt));
                        }
                    }
                }
            }
        }

        let aside_pat = format!("{}/.aside/u/*/sessions/*/messages.jsonl", home.display());
        if let Ok(paths) = glob::glob(&aside_pat) {
            for p in paths.flatten() {
                if let Ok(meta) = std::fs::metadata(&p) {
                    let mt = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs_f64())
                        .unwrap_or(0.0);
                    out.push(("Aside".into(), p, mt));
                }
            }
        }

        let omb_pat = format!("{}/.openmausbot/usage/????-??.jsonl", home.display());
        if let Ok(paths) = glob::glob(&omb_pat) {
            for p in paths.flatten() {
                if let Ok(meta) = std::fs::metadata(&p) {
                    let mt = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs_f64())
                        .unwrap_or(0.0);
                    out.push(("OpenMausBot".into(), p, mt));
                }
            }
        }

        out.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// Exact port of `history.py:HistoryStore.import_file`.
    pub fn import_file(&self, kind: &str, path: &Path, chunk: u64) -> Result<bool, String> {
        let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
        let size = meta.len();
        let inode = file_dev_ino(&meta);
        let path_str = path.to_string_lossy().into_owned();
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        let mut db = self.connect().map_err(|e| e.to_string())?;
        let prior: Option<(String, u64, String)> = db
            .query_row(
                "SELECT inode, offset, state FROM files WHERE path=?1",
                params![path_str],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64, r.get(2)?)),
            )
            .ok();

        let (mut offset, mut state) = match &prior {
            Some((pino, poff, pstate)) if pino == &inode && *poff <= size => (
                *poff,
                serde_json::from_str::<Map<String, Value>>(pstate).unwrap_or_default(),
            ),
            _ => (0u64, Map::new()),
        };

        if kind == "Codex" && state.get("metadata_schema").and_then(|v| v.as_i64()) != Some(3) {
            offset = 0;
            state.clear();
            state.insert("metadata_schema".into(), json!(3));
        }
        if offset == size && prior.is_some() {
            return Ok(true);
        }
        if !state.contains_key("sid") {
            state.insert("sid".into(), json!(stem));
        }
        if !state.contains_key("model") {
            state.insert("model".into(), json!("unknown"));
        }
        if !state.contains_key("cwd") {
            state.insert("cwd".into(), json!("unknown"));
        }
        let source = if kind == "Codex" {
            "codex_sessions"
        } else {
            "claude_transcripts"
        };

        let tx = db.transaction().map_err(|e| e.to_string())?;
        let mut reader =
            BufReader::with_capacity(65536, File::open(path).map_err(|e| e.to_string())?);
        reader
            .seek(SeekFrom::Start(offset))
            .map_err(|e| e.to_string())?;
        let mut pos = offset;
        let mut line = Vec::with_capacity(4096);
        let now = now_epoch();

        while pos - offset < chunk {
            line.clear();
            let n = reader
                .read_until(b'\n', &mut line)
                .map_err(|e| e.to_string())?;
            if n == 0 || !line.ends_with(b"\n") {
                break;
            }
            pos += n as u64;

            if kind == "OpenMausBot" {
                if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(&line) {
                    if let Some(item) = parse_openmausbot_turn(&map) {
                        let sum: i64 = item.tokens.iter().sum();
                        if sum > 0 && item.t <= now + 60.0 {
                            let sid = format!("openmausbot:{}", item.thread);
                            let key_raw = json!([item.thread, item.turn, item.t]).to_string();
                            let key = format!("openmausbot:{}", sha256_hex(key_raw.as_bytes()));
                            let model = if item.model.is_empty() {
                                "unknown"
                            } else {
                                &item.model
                            };
                            let _ = tx.execute(
                                "INSERT OR IGNORE INTO records VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                                params![
                                    key, sid, "openmausbot_usage", item.kind, item.t, model,
                                    "unknown", item.tokens[0], item.tokens[1], item.tokens[2], item.tokens[3]
                                ],
                            );
                            let _ = tx.execute(
                                "INSERT OR REPLACE INTO metadata VALUES(?1,?2,?3,?4)",
                                params![sid, item.t, model, "unknown"],
                            );
                        }
                    }
                }
                continue;
            }

            if !byte_contains(&line, b"\"usage\"")
                && !byte_contains(&line, b"\"token_count\"")
                && !byte_contains(&line, b"\"turn_context\"")
                && !byte_contains(&line, b"\"session_meta\"")
            {
                continue;
            }
            let Ok(row_val) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            let Some(row) = row_val.as_object() else {
                continue;
            };
            let t = epoch_from_value(row.get("timestamp"));
            if !(t.is_finite() && t > 0.0 && t <= now + 60.0) {
                continue;
            }

            if kind == "Aside" {
                if row.get("role").and_then(|v| v.as_str()) == Some("assistant")
                    && row.get("usage").is_some_and(|v| v.is_object())
                {
                    let prof = path
                        .parent()
                        .and_then(|p| p.parent())
                        .and_then(|p| p.parent())
                        .and_then(|p| p.file_name())
                        .and_then(|s| s.to_str())
                        .unwrap_or("");
                    let sess = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .rsplit('_')
                        .next()
                        .unwrap_or("");
                    let sid = format!("aside:{prof}:{sess}");
                    let model = row
                        .get("model")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("unknown");
                    let cwd = row
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("unknown");
                    let _ = tx.execute(
                        "INSERT OR REPLACE INTO metadata VALUES(?1,?2,?3,?4)",
                        params![sid, t, model, cwd],
                    );
                }
                continue;
            }

            if kind == "Codex" {
                let rtype = row.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let Some(payload) = row.get("payload").and_then(|v| v.as_object()) else {
                    continue;
                };
                if rtype == "session_meta" {
                    if let Some(id) = payload
                        .get("id")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        state.insert("sid".into(), json!(id));
                    }
                    if let Some(c) = payload
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        state.insert("cwd".into(), json!(c));
                    }
                } else if rtype == "turn_context" {
                    let m = payload
                        .get("model")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("unknown");
                    state.insert("model".into(), json!(m));
                    if let Some(c) = payload
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        state.insert("cwd".into(), json!(c));
                    }
                } else if rtype == "event_msg"
                    && payload.get("type").and_then(|v| v.as_str()) == Some("token_count")
                {
                    let info = payload.get("info").and_then(|v| v.as_object());
                    let Some(usage) = info
                        .and_then(|i| i.get("total_token_usage"))
                        .and_then(|v| v.as_object())
                    else {
                        continue;
                    };
                    let cur_sid = state
                        .get("sid")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let cur_model = state
                        .get("model")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let cur_cwd = state
                        .get("cwd")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();

                    let alias = uuid_suffix_re()
                        .captures(&stem)
                        .and_then(|c| c.get(1))
                        .map(|m| m.as_str().to_string());
                    let mut sids = HashSet::new();
                    sids.insert(cur_sid.clone());
                    if let Some(a) = alias {
                        sids.insert(a);
                    }
                    for s in sids {
                        let _ = tx.execute(
                            "INSERT OR REPLACE INTO metadata VALUES(?1,?2,?3,?4)",
                            params![s, t, cur_model, cur_cwd],
                        );
                    }
                    let values = token_vector(usage, true);
                    let mut old: Option<[i64; 4]> =
                        state.get("total").and_then(|v| v.as_array()).and_then(|a| {
                            if a.len() == 4 {
                                Some([
                                    a[0].as_i64()?,
                                    a[1].as_i64()?,
                                    a[2].as_i64()?,
                                    a[3].as_i64()?,
                                ])
                            } else {
                                None
                            }
                        });
                    state.insert("total".into(), json!(values));
                    if old.is_none() && info.is_some_and(|i| first_codex_report(i, values)) {
                        old = Some([0, 0, 0, 0]);
                    }
                    let Some(prev) = old else {
                        continue;
                    };
                    if (0..4).any(|i| values[i] < prev[i]) {
                        continue;
                    }
                    let delta = [
                        values[0] - prev[0],
                        values[1] - prev[1],
                        values[2] - prev[2],
                        values[3] - prev[3],
                    ];
                    if delta.iter().sum::<i64>() == 0 {
                        continue;
                    }
                    let key_raw = json!([cur_sid, t, values]).to_string();
                    let key = format!("codex:{}", sha256_hex(key_raw.as_bytes()));
                    let _ = tx.execute(
                        "INSERT OR IGNORE INTO records VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                        params![
                            key, cur_sid, source, kind, t, cur_model, cur_cwd, delta[0], delta[1],
                            delta[2], delta[3]
                        ],
                    );
                    let _ = tx.execute(
                        "INSERT OR REPLACE INTO metadata VALUES(?1,?2,?3,?4)",
                        params![cur_sid, t, cur_model, cur_cwd],
                    );
                }
                continue;
            }

            // Claude / GLM
            if row.get("type").and_then(|v| v.as_str()) != Some("assistant") {
                continue;
            }
            let Some(msg) = row.get("message").and_then(|v| v.as_object()) else {
                continue;
            };
            let Some(usage) = msg.get("usage").and_then(|v| v.as_object()) else {
                continue;
            };
            let model = msg
                .get("model")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("unknown");
            if model == "<synthetic>" {
                continue;
            }
            let Some(mid) = msg
                .get("id")
                .or_else(|| row.get("uuid"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let runtime = if model.to_lowercase().starts_with("glm") {
                "GLM"
            } else {
                kind
            };
            let sid = if stem.starts_with("agent-") {
                stem.as_str()
            } else {
                row.get("sessionId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(stem.as_str())
            };
            let cwd = row
                .get("cwd")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("unknown");
            let values = token_vector(usage, false);
            let req_id = row.get("requestId").and_then(|v| v.as_str()).unwrap_or("");
            let key_raw = json!([runtime, mid, req_id]).to_string();
            let key = format!("claude:{}", sha256_hex(key_raw.as_bytes()));
            let _ = tx.execute(
                "INSERT INTO records VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) \
                 ON CONFLICT(key) DO UPDATE SET \
                 t=MIN(records.t,excluded.t), fresh=MAX(records.fresh,excluded.fresh), \
                 cached=MAX(records.cached,excluded.cached), written=MAX(records.written,excluded.written), \
                 output=MAX(records.output,excluded.output)",
                params![
                    key, sid, source, runtime, t, model, cwd,
                    values[0], values[1], values[2], values[3]
                ],
            );
            let _ = tx.execute(
                "INSERT OR REPLACE INTO metadata VALUES(?1,?2,?3,?4)",
                params![sid, t, model, cwd],
            );
        }

        let state_json = serde_json::to_string(&state).unwrap_or_else(|_| "{}".into());
        let completed = if pos >= size { Some(now_epoch()) } else { None };
        tx.execute(
            "INSERT OR REPLACE INTO files VALUES(?1,?2,?3,?4,?5,NULL)",
            params![path_str, inode, pos as i64, state_json, completed],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        self.generation.fetch_add(1, Ordering::Relaxed);
        Ok(pos >= size || pos == offset)
    }

    pub fn run_import_pass(&self, profile_roots: &[(String, PathBuf)]) {
        let paths = self.discover_files(profile_roots);
        if let Ok(mut p) = self.progress.lock() {
            p.running = true;
            p.files_done = 0;
            p.files_total = paths.len();
            p.failed = 0;
        }
        for (kind, path, _) in paths {
            if self.stop_flag.load(Ordering::Relaxed) {
                break;
            }
            loop {
                match self.import_file(&kind, &path, 4 * 1024 * 1024) {
                    Ok(true) => break,
                    Ok(false) => {
                        if self.stop_flag.load(Ordering::Relaxed) {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(25));
                    }
                    Err(_) => {
                        if let Ok(mut p) = self.progress.lock() {
                            p.failed += 1;
                        }
                        break;
                    }
                }
            }
            if let Ok(mut p) = self.progress.lock() {
                p.files_done += 1;
            }
        }
        if let Ok(mut p) = self.progress.lock() {
            p.running = false;
        }
    }

    fn attach_collector(&self, db: &Connection) -> rusqlite::Result<()> {
        let uri = format!("file:{}?mode=ro", self.monitor.display());
        db.execute("ATTACH DATABASE ?1 AS collector", params![uri])?;
        Ok(())
    }

    /// Exact port of `history.py:HistoryStore.model_totals`.
    pub fn model_totals(&self, start: f64, end: f64) -> HashMap<(String, String), [i64; 4]> {
        let mut out: HashMap<(String, String), [i64; 4]> = HashMap::new();
        let _guard = self.lock.lock();
        let Ok(db) = self.connect() else {
            return out;
        };
        if self.attach_collector(&db).is_err() {
            return out;
        }
        let meta_started: f64 = db
            .query_row(
                "SELECT value FROM collector.meta WHERE key='started'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(end);
        let first: Option<f64> = db
            .query_row(
                "SELECT MIN(t) FROM collector.events WHERE t<=?1",
                params![end],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        let started = first.map(|f| meta_started.max(f)).unwrap_or(end);

        if let Ok(mut stmt) = db.prepare(
            "SELECT kind, model, SUM(fresh), SUM(cached), SUM(written), SUM(output) \
             FROM records WHERE t>?1 AND t<?2 GROUP BY kind, model",
        ) {
            if let Ok(rows) = stmt.query_map(params![start, end.min(started)], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "unknown".into()),
                    [
                        r.get::<_, i64>(2).unwrap_or(0),
                        r.get::<_, i64>(3).unwrap_or(0),
                        r.get::<_, i64>(4).unwrap_or(0),
                        r.get::<_, i64>(5).unwrap_or(0),
                    ],
                ))
            }) {
                for (kind, model, v) in rows.flatten() {
                    let e = out.entry((kind, model)).or_insert([0; 4]);
                    for i in 0..4 {
                        e[i] += v[i];
                    }
                }
            }
        }

        let has_model = {
            let mut cols = HashSet::new();
            if let Ok(mut stmt) = db.prepare("PRAGMA collector.table_info(events)") {
                if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) {
                    for c in rows.flatten() {
                        cols.insert(c);
                    }
                }
            }
            cols.contains("model")
        };
        let model_expr = if has_model {
            "COALESCE(NULLIF(e.model,''),m.model,'unknown')"
        } else {
            "COALESCE(m.model,'unknown')"
        };
        let sql = format!(
            "SELECT e.kind, {model_expr}, SUM(e.fresh), SUM(e.cached), SUM(e.written), SUM(e.output) \
             FROM collector.events e LEFT JOIN metadata m ON m.sid=e.sid AND m.t=e.t \
             WHERE e.t>?1 AND e.t<=?2 GROUP BY 1, 2"
        );
        if let Ok(mut stmt) = db.prepare(&sql) {
            if let Ok(rows) = stmt.query_map(params![start.max(started - 0.000001), end], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "unknown".into()),
                    [
                        r.get::<_, i64>(2).unwrap_or(0),
                        r.get::<_, i64>(3).unwrap_or(0),
                        r.get::<_, i64>(4).unwrap_or(0),
                        r.get::<_, i64>(5).unwrap_or(0),
                    ],
                ))
            }) {
                for (kind, model, v) in rows.flatten() {
                    let e = out.entry((kind, model)).or_insert([0; 4]);
                    for i in 0..4 {
                        e[i] += v[i];
                    }
                }
            }
        }
        out
    }

    fn known(coverage: &[(String, Option<String>, f64, f64)], a: f64, b: f64) -> bool {
        coverage
            .iter()
            .any(|(_, _, from, to)| *from < b && *to >= a)
    }

    /// Exact port of `history.py:HistoryStore.response`.
    pub fn response(
        &self,
        period: &str,
        step: &str,
        kind: Option<&str>,
        snapshot: Option<&Map<String, Value>>,
    ) -> Result<Value, String> {
        let fixed_secs = WINDOWS
            .iter()
            .find(|(k, _, _)| *k == period)
            .map(|(_, _, s)| *s);
        let parsed = if fixed_secs.is_none() {
            Some(parse_period(period).map_err(|e| e.to_string())?)
        } else {
            None
        };
        if let Some(k) = kind {
            if k.is_empty() || k.len() > 80 {
                return Err("Invalid kind".into());
            }
        }
        let now = snapshot
            .and_then(|s| s.get("updated"))
            .and_then(|v| v.as_f64())
            .filter(|&x| x > 0.0)
            .unwrap_or_else(now_epoch);
        let snap_started = snapshot
            .and_then(|s| s.get("started"))
            .and_then(|v| v.as_f64());
        let gen = self.generation.load(Ordering::Relaxed);
        let cache_key = (
            period.to_string(),
            step.to_string(),
            kind.map(str::to_string),
            (now * 1000.0) as i64,
            gen,
        );

        let _guard = self.lock.lock();
        if let Ok(cache) = self.cache.lock() {
            if let Some(hit) = cache.get(&cache_key) {
                return Ok(hit.clone());
            }
        }

        let db = self.connect().map_err(|e| e.to_string())?;
        self.attach_collector(&db).map_err(|e| e.to_string())?;
        let base_started = match snap_started {
            Some(s) => s,
            None => db
                .query_row(
                    "SELECT value FROM collector.meta WHERE key='started'",
                    [],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(now),
        };
        let first_ev: Option<f64> = db
            .query_row(
                "SELECT MIN(t) FROM collector.events WHERE t<=?1",
                params![now],
                |r| r.get(0),
            )
            .ok()
            .flatten();
        let started = first_ev.map(|f| base_started.max(f)).unwrap_or(now);

        // Coverage
        let mut coverage: Vec<(String, Option<String>, f64, f64)> = Vec::new();
        {
            let sql = if kind.is_some() {
                "SELECT source, kind, MIN(t), MAX(t) FROM records WHERE kind=?1 GROUP BY source, kind"
            } else {
                "SELECT source, kind, MIN(t), MAX(t) FROM records GROUP BY source, kind"
            };
            let mut stmt = db.prepare(sql).map_err(|e| e.to_string())?;
            let mapper = |r: &rusqlite::Row| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, f64>(2)?,
                    r.get::<_, f64>(3)?,
                ))
            };
            let rows: Vec<(String, String, f64, f64)> = if let Some(k) = kind {
                stmt.query_map(params![k], mapper)
                    .map_err(|e| e.to_string())?
                    .flatten()
                    .collect()
            } else {
                stmt.query_map([], mapper)
                    .map_err(|e| e.to_string())?
                    .flatten()
                    .collect()
            };
            for (src, k, first, last) in rows {
                let end = last.min(started).min(now);
                if first < end {
                    coverage.push((src, Some(k), first, end));
                }
            }
            if started <= now {
                coverage.push(("collector".into(), kind.map(str::to_string), started, now));
            }
        }

        let earliest = coverage.iter().map(|c| c.2).fold(now, f64::min);
        let duration = match (fixed_secs, parsed) {
            (Some(s), _) => s as f64,
            (None, Some(PeriodDuration::All)) => (now - earliest).max(600.0),
            (None, Some(PeriodDuration::Seconds(s))) => s as f64,
            _ => 3600.0,
        };
        let start = now - duration;
        let edges = edges_for(start, now, step).map_err(|e| e.to_string())?;
        let mut bounds = edges.clone();
        bounds.push(now + 0.001);

        let empty: Vec<Option<i64>> = bounds
            .windows(2)
            .map(|w| {
                if Self::known(&coverage, w[0].max(start), w[1]) {
                    Some(0)
                } else {
                    None
                }
            })
            .collect();
        let mut total = empty.clone();
        let mut models: HashMap<String, Vec<Option<i64>>> = HashMap::new();
        let mut projects: HashMap<String, Vec<Option<i64>>> = HashMap::new();
        let mut model_kind: HashMap<String, HashMap<String, i64>> = HashMap::new();

        // Read rows from records + collector.events
        let mut consume_row = |t: f64, k: String, model: String, cwd: String, tokens: i64| {
            let idx = edges.partition_point(|&e| e <= t);
            if idx == 0 {
                return;
            }
            let i = idx - 1;
            total[i] = Some(total[i].unwrap_or(0) + tokens);
            let mname = if model.is_empty() {
                "unknown".to_string()
            } else {
                model
            };
            let cname = if cwd.is_empty() {
                "unknown".to_string()
            } else {
                cwd
            };
            let m = models.entry(mname.clone()).or_insert_with(|| empty.clone());
            m[i] = Some(m[i].unwrap_or(0) + tokens);
            let p = projects.entry(cname).or_insert_with(|| empty.clone());
            p[i] = Some(p[i].unwrap_or(0) + tokens);
            *model_kind.entry(mname).or_default().entry(k).or_insert(0) += tokens;
        };

        {
            let sql = if kind.is_some() {
                "SELECT t, kind, model, cwd, fresh+cached+written+output FROM records WHERE t>?1 AND t<?2 AND kind=?3"
            } else {
                "SELECT t, kind, model, cwd, fresh+cached+written+output FROM records WHERE t>?1 AND t<?2"
            };
            let mut stmt = db.prepare(sql).map_err(|e| e.to_string())?;
            let upper = now.min(started);
            let mapper = |r: &rusqlite::Row| {
                Ok((
                    r.get::<_, f64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    r.get::<_, i64>(4).unwrap_or(0),
                ))
            };
            if let Some(k) = kind {
                for (t, kk, m, c, tok) in stmt
                    .query_map(params![start, upper, k], mapper)
                    .map_err(|e| e.to_string())?
                    .flatten()
                {
                    consume_row(t, kk, m, c, tok);
                }
            } else {
                for (t, kk, m, c, tok) in stmt
                    .query_map(params![start, upper], mapper)
                    .map_err(|e| e.to_string())?
                    .flatten()
                {
                    consume_row(t, kk, m, c, tok);
                }
            }
        }
        {
            let mut cols = HashSet::new();
            if let Ok(mut stmt) = db.prepare("PRAGMA collector.table_info(events)") {
                if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) {
                    for c in rows.flatten() {
                        cols.insert(c);
                    }
                }
            }
            let model_expr = if cols.contains("model") {
                "COALESCE(NULLIF(e.model,''),m.model,'unknown')"
            } else {
                "COALESCE(m.model,'unknown')"
            };
            let cwd_expr = if cols.contains("cwd") {
                "COALESCE(NULLIF(e.cwd,''),m.cwd,'unknown')"
            } else {
                "COALESCE(m.cwd,'unknown')"
            };
            let kind_clause = if kind.is_some() { " AND e.kind=?3" } else { "" };
            let sql = format!(
                "SELECT e.t, e.kind, {model_expr}, {cwd_expr}, e.fresh+e.cached+e.written+e.output \
                 FROM collector.events e LEFT JOIN metadata m ON m.sid=e.sid AND m.t=e.t \
                 WHERE e.t>?1 AND e.t<=?2{kind_clause}"
            );
            let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
            let lower = start.max(started - 0.000001);
            let mapper = |r: &rusqlite::Row| {
                Ok((
                    r.get::<_, f64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    r.get::<_, i64>(4).unwrap_or(0),
                ))
            };
            if let Some(k) = kind {
                for (t, kk, m, c, tok) in stmt
                    .query_map(params![lower, now, k], mapper)
                    .map_err(|e| e.to_string())?
                    .flatten()
                {
                    consume_row(t, kk, m, c, tok);
                }
            } else {
                for (t, kk, m, c, tok) in stmt
                    .query_map(params![lower, now], mapper)
                    .map_err(|e| e.to_string())?
                    .flatten()
                {
                    consume_row(t, kk, m, c, tok);
                }
            }
        }

        let rank = |rows: &HashMap<String, Vec<Option<i64>>>, is_project: bool| -> Vec<Value> {
            let mut ordered: Vec<&String> = rows.keys().collect();
            ordered.sort_by(|a, b| {
                let sa: i64 = rows[*a].iter().filter_map(|x| *x).sum();
                let sb: i64 = rows[*b].iter().filter_map(|x| *x).sum();
                sb.cmp(&sa).then_with(|| a.cmp(b))
            });
            let mut out = Vec::new();
            for name in ordered.iter().take(12) {
                let mut m = Map::new();
                m.insert("key".into(), json!(name));
                m.insert("tokens".into(), json!(rows[*name]));
                if is_project {
                    let lbl = if name.as_str() == "unknown" {
                        "알 수 없음".to_string()
                    } else {
                        Path::new(name)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string()
                    };
                    m.insert("label".into(), json!(lbl));
                } else {
                    let top_kind = model_kind
                        .get(*name)
                        .and_then(|counts| {
                            counts
                                .iter()
                                .max_by_key(|(_, &c)| c)
                                .map(|(k, _)| k.clone())
                        })
                        .unwrap_or_default();
                    m.insert("kind".into(), json!(top_kind));
                }
                out.push(Value::Object(m));
            }
            if ordered.len() > 12 {
                let rest = &ordered[12..];
                let folded_toks: Vec<Option<i64>> = empty
                    .iter()
                    .enumerate()
                    .map(|(i, v)| {
                        v.map(|_| rest.iter().map(|k| rows[*k][i].unwrap_or(0)).sum::<i64>())
                    })
                    .collect();
                out.push(json!({
                    "key": "__other__",
                    "folded": rest.len(),
                    "tokens": folded_toks
                }));
            }
            out
        };

        let heat_key = (kind.map(str::to_string), (now / 60.0).floor() as i64, gen);
        let heatmap = {
            let cached = self
                .heat_cache
                .lock()
                .ok()
                .and_then(|c| c.get(&heat_key).cloned());
            if let Some(h) = cached {
                h
            } else {
                let mut by_day: HashMap<String, i64> = HashMap::new();
                let mut by_hour: HashMap<(String, u32), i64> = HashMap::new();
                for (table, lower, upper, op) in [
                    ("records", earliest - 0.001, now.min(started), "<"),
                    (
                        "collector.events",
                        (earliest - 0.001).max(started - 0.000001),
                        now,
                        "<=",
                    ),
                ] {
                    let kclause = if kind.is_some() { " AND kind=?3" } else { "" };
                    let sql = format!(
                        "SELECT strftime('%Y-%m-%d',t,'unixepoch','localtime'), \
                         CAST(strftime('%H',t,'unixepoch','localtime') AS INTEGER), \
                         SUM(fresh+cached+written+output) FROM {table} \
                         WHERE t>?1 AND t{op}?2{kclause} GROUP BY 1, 2"
                    );
                    if let Ok(mut stmt) = db.prepare(&sql) {
                        let mapper = |r: &rusqlite::Row| {
                            Ok((
                                r.get::<_, String>(0)?,
                                r.get::<_, i64>(1).unwrap_or(0) as u32,
                                r.get::<_, i64>(2).unwrap_or(0),
                            ))
                        };
                        let rows: Vec<(String, u32, i64)> = if let Some(k) = kind {
                            stmt.query_map(params![lower, upper, k], mapper)
                                .ok()
                                .into_iter()
                                .flatten()
                                .flatten()
                                .collect()
                        } else {
                            stmt.query_map(params![lower, upper], mapper)
                                .ok()
                                .into_iter()
                                .flatten()
                                .flatten()
                                .collect()
                        };
                        for (day, hour, tok) in rows {
                            *by_day.entry(day.clone()).or_insert(0) += tok;
                            *by_hour.entry((day, hour)).or_insert(0) += tok;
                        }
                    }
                }
                let today = local_timestamp_floor(now)
                    .and_then(local_midnight)
                    .map(|d| d.date_naive())
                    .unwrap_or_else(|| Local::now().date_naive());
                let mut d = local_timestamp_floor(earliest)
                    .and_then(local_midnight)
                    .map(|dt| dt.date_naive())
                    .unwrap_or(today);
                let mut days = Vec::new();
                while d <= today {
                    let next_d = d + Duration::days(1);
                    let start_ts = match Local.from_local_datetime(&d.and_hms_opt(0, 0, 0).unwrap())
                    {
                        LocalResult::Single(x) | LocalResult::Ambiguous(x, _) => {
                            x.timestamp() as f64
                        }
                        LocalResult::None => 0.0,
                    };
                    let end_ts =
                        match Local.from_local_datetime(&next_d.and_hms_opt(0, 0, 0).unwrap()) {
                            LocalResult::Single(x) | LocalResult::Ambiguous(x, _) => {
                                x.timestamp() as f64
                            }
                            LocalResult::None => start_ts + 86400.0,
                        };
                    let name = d.format("%Y-%m-%d").to_string();
                    let val = if Self::known(&coverage, start_ts, end_ts) {
                        json!(by_day.get(&name).copied().unwrap_or(0))
                    } else {
                        Value::Null
                    };
                    days.push(json!([name, val]));
                    d = next_d;
                }
                let mut hours = Vec::with_capacity(30 * 24);
                for offset in 0..30i64 {
                    let day = today - Duration::days(29 - offset);
                    let name = day.format("%Y-%m-%d").to_string();
                    for hour in 0..24u32 {
                        let valid_stamp = day.and_hms_opt(hour, 0, 0).and_then(|naive| match Local
                            .from_local_datetime(&naive)
                        {
                            LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => Some(dt),
                            LocalResult::None => None,
                        });
                        let val = if let Some(dt) = valid_stamp {
                            let stamp = dt.timestamp() as f64;
                            if dt.hour() == hour
                                && stamp <= now
                                && Self::known(&coverage, stamp, stamp + 3600.0)
                            {
                                json!(by_hour.get(&(name.clone(), hour)).copied().unwrap_or(0))
                            } else {
                                Value::Null
                            }
                        } else {
                            Value::Null
                        };
                        hours.push(json!([name, hour, val]));
                    }
                }
                let h = json!({"hours": hours, "days": days});
                if let Ok(mut hc) = self.heat_cache.lock() {
                    hc.clear();
                    hc.insert(heat_key, h.clone());
                }
                h
            }
        };

        let prog = self
            .progress
            .lock()
            .map(|p| {
                json!({
                    "running": p.running,
                    "files_done": p.files_done,
                    "files_total": p.files_total,
                    "failed": p.failed
                })
            })
            .unwrap_or_else(
                |_| json!({"running": false, "files_done": 0, "files_total": 0, "failed": 0}),
            );
        let cov_json: Vec<Value> = coverage
            .into_iter()
            .map(|(src, k, from, to)| json!({"source": src, "kind": k, "from": from, "to": to}))
            .collect();
        let res = json!({
            "as_of": now,
            "coverage": cov_json,
            "import": prog,
            "series": {
                "start": edges.first().copied().unwrap_or(start),
                "end": now,
                "step": step,
                "bins": edges,
                "total": total,
                "by_model": rank(&models, false),
                "by_project": rank(&projects, true)
            },
            "heatmap": heatmap
        });
        if let Ok(mut c) = self.cache.lock() {
            if c.len() > 16 {
                c.clear();
            }
            c.insert(cache_key, res.clone());
        }
        Ok(res)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_for_hourly_and_daily() {
        let now = 1795600000.0;
        let e = edges_for(now - 3600.0, now, "60").unwrap();
        assert!(e.len() >= 60 && e.len() <= 62);
        assert!(edges_for(now - 86400.0 * 30.0, now, "60").is_err());
        let d = edges_for(now - 86400.0 * 6.0, now, "day").unwrap();
        assert!(d.len() >= 6 && d.len() <= 8);
    }
}
