//! Complete native Rust `Observer` matching `observe/__init__.py`, `observe/processes.py:Reader`,
//! `observe/aside.py`, `observe/codex.py`, `observe/orca.py`, `observe/tmux.py`,
//! `observe/locations.py`, `observe/antigravity.py:read/refresh/conversations`, and `observe/openbot.py`.
use crate::accounts::managed_profiles_dir;
use crate::antigravity;
use crate::devin;
use crate::ledger::codex_metadata;
use crate::observers::{
    location_holder, location_started, location_tool, read_claude_registry, read_openbot_agents,
    read_openmausbot,
};
use crate::platform_support::home_dir;
use crate::processes::{
    app_from, argv_shape, cli_kind, describe_json, explicit_session, find_own_probe_pids,
};
use crate::readonly::open_readonly;
use crate::sessions::{claude_transcript, format_local_ctime, orca_executable};
use crate::telemetry::account_identity;
use crate::text::clean_title;
use crate::transcripts::read_tail;
use crate::usage::has_column;
use chrono::{Local, TimeZone, Utc};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use url::Url;

fn rollout_root_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(.+)/sessions/\d{4}/\d{2}/\d{2}/rollout-[^/]+\.jsonl$").unwrap()
    })
}

fn aside_sid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9_-]{1,120}$").unwrap())
}

fn non_alnum_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^A-Za-z0-9]").unwrap())
}

fn is_boilerplate_title(s: &str) -> bool {
    let t = s.trim();
    t.is_empty()
        || t.starts_with("# AGENTS")
        || t.starts_with('<')
        || t.starts_with("You are ")
        || t == "You are"
}

fn clean_session_title(s: &str) -> String {
    let cleaned = clean_title(s, 160);
    if is_boilerplate_title(&cleaned) {
        String::new()
    } else {
        cleaned
    }
}

fn file_mtime_epoch(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn file_mtime_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn openbot_provider_account_dirs(home: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for base in [
        home.join("Library/Application Support/OpenBot/provider-accounts"),
        home.join(".config/OpenBot/provider-accounts"),
        home.join("AppData/Roaming/OpenBot/provider-accounts"),
    ] {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    out.push(p);
                }
            }
        }
    }
    out.sort();
    out
}

fn orca_claude_profile_homes(home: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for base in [
        home.join("Library/Application Support/orca/claude-profiles"),
        home.join(".config/orca/claude-profiles"),
        home.join("AppData/Roaming/orca/claude-profiles"),
    ] {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for e in entries.flatten() {
                let p = e.path().join("home");
                if p.is_dir() {
                    out.push(p);
                }
            }
        }
    }
    out.sort();
    out
}

fn dedupe_existing_dirs(cands: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut found: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut order = Vec::new();
    for root in cands {
        if root.is_dir() {
            if let Ok(canon) = std::fs::canonicalize(&root) {
                if !found.contains_key(&canon) {
                    found.insert(canon.clone(), root);
                    order.push(canon);
                }
            }
        }
    }
    order.into_iter().filter_map(|c| found.remove(&c)).collect()
}

type RecentMetaCache = HashMap<PathBuf, (u64, u64, Option<Map<String, Value>>)>;

#[allow(clippy::type_complexity)]
fn read_codex_state_threads(
    root: &Path,
) -> (
    HashMap<String, Map<String, Value>>,
    HashMap<String, Map<String, Value>>,
    HashSet<String>,
) {
    let mut by_path = HashMap::new();
    let mut by_id = HashMap::new();
    let mut archived_ids = HashSet::new();
    let pat = format!("{}/state_*.sqlite", root.display());
    let mut dbs: Vec<PathBuf> = glob::glob(&pat)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    dbs.sort();
    let Some(latest) = dbs.last() else {
        return (by_path, by_id, archived_ids);
    };
    let Ok(conn) = open_readonly(latest, 0.2) else {
        return (by_path, by_id, archived_ids);
    };
    let name_col = if has_column(&conn, "threads", "name") {
        "name"
    } else {
        "NULL"
    };
    let archived_col = if has_column(&conn, "threads", "archived") {
        "archived"
    } else {
        "0"
    };
    let sql = format!(
        "SELECT id, rollout_path, cwd, title, model, {name_col}, {archived_col} FROM threads"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return (by_path, by_id, archived_ids);
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            r.get::<_, Option<String>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, i64>(6).unwrap_or(0),
        ))
    }) else {
        return (by_path, by_id, archived_ids);
    };
    for (sid, rpath, cwd, title, model, name, archived) in rows.flatten() {
        if archived != 0 {
            archived_ids.insert(sid);
            continue;
        }
        let mut m = Map::new();
        m.insert("session_id".into(), json!(sid));
        m.insert("cwd".into(), json!(cwd));
        m.insert("title".into(), json!(clean_session_title(&title)));
        m.insert(
            "model".into(),
            model.map(Value::String).unwrap_or(Value::Null),
        );
        let cleaned_name = name
            .as_deref()
            .map(clean_session_title)
            .filter(|s| !s.is_empty());
        m.insert(
            "name".into(),
            cleaned_name.map(Value::String).unwrap_or(Value::Null),
        );
        if !rpath.is_empty() {
            if let Ok(canon) = std::fs::canonicalize(&rpath) {
                by_path.insert(canon.to_string_lossy().into_owned(), m.clone());
            }
            by_path.insert(rpath, m.clone());
        }
        if !sid.is_empty() {
            by_id.insert(sid, m);
        }
    }
    (by_path, by_id, archived_ids)
}

fn codex_date_dirs(now: f64, window_secs: f64) -> Vec<String> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    let start = (now - window_secs - 50400.0).floor() as i64;
    let end = (now + 50400.0).ceil() as i64;
    let mut ts = start;
    while ts <= end {
        if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
            let rel = dt.format("%Y/%m/%d").to_string();
            if seen.insert(rel.clone()) {
                dirs.push(rel);
            }
        }
        if let Some(dt) = Local.timestamp_opt(ts, 0).single() {
            let rel = dt.format("%Y/%m/%d").to_string();
            if seen.insert(rel.clone()) {
                dirs.push(rel);
            }
        }
        ts += 43200;
    }
    dirs
}

fn parse_codex_rollout_meta(path: &Path) -> Option<Map<String, Value>> {
    let f = File::open(path).ok()?;
    let mut reader = BufReader::new(f);
    let mut buf = Vec::new();
    if reader
        .by_ref()
        .take(2 * 1024 * 1024)
        .read_until(b'\n', &mut buf)
        .is_err()
        || buf.is_empty()
    {
        return None;
    }
    let val = serde_json::from_slice::<Value>(&buf).ok()?;
    if val.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
        return None;
    }
    let payload = val.get("payload").and_then(|v| v.as_object())?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let sid = payload
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(stem)
        .to_string();
    if sid.is_empty() {
        return None;
    }
    let cwd = payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut m = Map::new();
    m.insert("session_id".into(), json!(sid));
    m.insert("cwd".into(), json!(cwd));
    for (k, v) in codex_metadata(path, Some(&sid)) {
        m.insert(k, v);
    }
    Some(m)
}

pub fn read_recent_codex_sessions(roots: &[PathBuf], now: f64, window_secs: f64) -> Vec<Value> {
    let mut cache = HashMap::new();
    read_recent_codex_sessions_cached(roots, now, window_secs, &mut cache)
}

fn read_recent_codex_sessions_cached(
    roots: &[PathBuf],
    now: f64,
    window_secs: f64,
    cache: &mut RecentMetaCache,
) -> Vec<Value> {
    if cache.len() > 512 {
        cache.clear();
    }
    let cutoff = now - window_secs;
    let date_dirs = codex_date_dirs(now, window_secs);
    let mut seen_files: HashSet<PathBuf> = HashSet::new();
    let mut by_sid: HashMap<String, (f64, Map<String, Value>)> = HashMap::new();

    for root in roots {
        let sess_dir = root.join("sessions");
        if !sess_dir.is_dir() {
            continue;
        }
        let (state_by_path, state_by_id, archived_ids) = read_codex_state_threads(root);
        let profile = root.to_string_lossy().into_owned();
        for rel in &date_dirs {
            let dir = sess_dir.join(rel);
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if !fname.starts_with("rollout-") || !fname.ends_with(".jsonl") {
                    continue;
                }
                let Ok(meta) = std::fs::metadata(&path) else {
                    continue;
                };
                if !meta.is_file() || meta.len() == 0 {
                    continue;
                }
                let mtime = file_mtime_epoch(&meta);
                if mtime < cutoff {
                    continue;
                }
                let canon = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                if !seen_files.insert(canon.clone()) {
                    continue;
                }
                let fsize = meta.len();
                let mms = file_mtime_ms(&meta);
                let parsed = match cache.get(&canon) {
                    Some((sz, tm, cached)) if *sz == fsize && *tm == mms => cached.clone(),
                    _ => {
                        let p = parse_codex_rollout_meta(&path);
                        cache.insert(canon.clone(), (fsize, mms, p.clone()));
                        p
                    }
                };
                let raw_path = path.to_string_lossy().into_owned();
                let canon_str = canon.to_string_lossy().into_owned();
                let state_row = state_by_path
                    .get(&raw_path)
                    .or_else(|| state_by_path.get(&canon_str))
                    .or_else(|| {
                        parsed
                            .as_ref()
                            .and_then(|m| m.get("session_id").and_then(|v| v.as_str()))
                            .and_then(|sid| state_by_id.get(sid))
                    });
                let sid = state_row
                    .and_then(|r| r.get("session_id").and_then(|v| v.as_str()))
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        parsed
                            .as_ref()
                            .and_then(|r| r.get("session_id").and_then(|v| v.as_str()))
                            .filter(|s| !s.is_empty())
                    })
                    .unwrap_or("")
                    .to_string();
                if sid.is_empty() || archived_ids.contains(&sid) {
                    continue;
                }
                let mut row = Map::new();
                row.insert("id".into(), json!(sid));
                row.insert("session_id".into(), json!(sid));
                row.insert("path".into(), json!(raw_path));
                row.insert("profile".into(), json!(profile));
                let cwd = state_row
                    .and_then(|r| r.get("cwd").and_then(|v| v.as_str()))
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        parsed
                            .as_ref()
                            .and_then(|r| r.get("cwd").and_then(|v| v.as_str()))
                            .filter(|s| !s.is_empty())
                    })
                    .unwrap_or("");
                row.insert("cwd".into(), json!(cwd));
                row.insert(
                    "title".into(),
                    json!(state_row
                        .and_then(|r| r.get("title").and_then(|v| v.as_str()))
                        .unwrap_or("")),
                );
                row.insert(
                    "name".into(),
                    state_row
                        .and_then(|r| r.get("name"))
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                row.insert(
                    "model".into(),
                    state_row
                        .and_then(|r| r.get("model"))
                        .cloned()
                        .unwrap_or(Value::Null),
                );
                row.insert("modified".into(), json!(mtime));
                if let Some(p) = parsed.as_ref() {
                    for k in [
                        "is_subagent",
                        "parent_session_id",
                        "agent_depth",
                        "agent_path",
                    ] {
                        if let Some(v) = p.get(k) {
                            row.insert(k.into(), v.clone());
                        }
                    }
                }
                let replace = match by_sid.get(&sid) {
                    None => true,
                    Some((prev_t, prev_row)) => {
                        mtime > *prev_t
                            || ((mtime - *prev_t).abs() < 1e-6
                                && prev_row
                                    .get("cwd")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .is_empty()
                                && !cwd.is_empty())
                    }
                };
                if replace {
                    by_sid.insert(sid, (mtime, row));
                }
            }
        }
    }

    let mut rows: Vec<(f64, Map<String, Value>)> = by_sid.into_values().collect();
    rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    rows.truncate(100);
    rows.into_iter().map(|(_, r)| Value::Object(r)).collect()
}

fn parse_claude_session_header(path: &Path) -> Option<Map<String, Value>> {
    let mut f = File::open(path).ok()?;
    let file_len = f.metadata().ok()?.len();
    if file_len == 0 {
        return None;
    }
    let mut reader = BufReader::new(&mut f);
    let mut buf = Vec::new();
    let mut total_bytes = 0usize;
    let mut session_id = String::new();
    let mut cwd = String::new();
    let mut custom_title = String::new();
    let mut ai_title = String::new();
    let mut model = String::new();
    let mut has_message = false;

    for _ in 0..48 {
        buf.clear();
        let Ok(n) = reader.by_ref().take(256 * 1024).read_until(b'\n', &mut buf) else {
            break;
        };
        if n == 0 {
            break;
        }
        total_bytes += n;
        if let Ok(Value::Object(obj)) = serde_json::from_slice::<Value>(&buf) {
            if obj.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
                return None;
            }
            if session_id.is_empty() {
                if let Some(s) = obj
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    session_id = s.to_string();
                }
            }
            if cwd.is_empty() {
                if let Some(c) = obj
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    cwd = c.to_string();
                }
            }
            match obj.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "custom-title" => {
                    if let Some(t) = obj.get("customTitle").and_then(|v| v.as_str()) {
                        let cleaned = clean_session_title(t);
                        if !cleaned.is_empty() {
                            custom_title = cleaned;
                        }
                    }
                }
                "ai-title" => {
                    if let Some(t) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                        let cleaned = clean_session_title(t);
                        if !cleaned.is_empty() {
                            ai_title = cleaned;
                        }
                    }
                }
                "user" | "assistant" | "system" => {
                    has_message = true;
                    if model.is_empty() {
                        if let Some(m) = obj
                            .get("message")
                            .and_then(|m| m.get("model"))
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty() && !s.starts_with('<'))
                        {
                            model = m.to_string();
                        }
                    }
                }
                _ => {}
            }
        }
        if total_bytes >= 1024 * 1024 {
            break;
        }
    }

    if cwd.is_empty() && !has_message {
        return None;
    }

    // Check tail for late custom-title / ai-title updates.
    if file_len > total_bytes as u64 {
        let start = file_len.saturating_sub(32 * 1024);
        if f.seek(SeekFrom::Start(start)).is_ok() {
            let mut tail_buf = Vec::new();
            if f.take(32 * 1024 + 1024).read_to_end(&mut tail_buf).is_ok() {
                let slice = if start > 0 {
                    tail_buf
                        .iter()
                        .position(|&b| b == b'\n')
                        .map(|i| &tail_buf[i + 1..])
                        .unwrap_or(&[])
                } else {
                    &tail_buf[..]
                };
                for line in slice.split(|&b| b == b'\n') {
                    if line.is_empty()
                        || (!line.windows(12).any(|w| w == b"custom-title")
                            && !line.windows(8).any(|w| w == b"ai-title"))
                    {
                        continue;
                    }
                    if let Ok(Value::Object(obj)) = serde_json::from_slice::<Value>(line) {
                        match obj.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                            "custom-title" => {
                                if let Some(t) = obj.get("customTitle").and_then(|v| v.as_str()) {
                                    let cleaned = clean_session_title(t);
                                    if !cleaned.is_empty() {
                                        custom_title = cleaned;
                                    }
                                }
                            }
                            "ai-title" => {
                                if let Some(t) = obj.get("aiTitle").and_then(|v| v.as_str()) {
                                    let cleaned = clean_session_title(t);
                                    if !cleaned.is_empty() {
                                        ai_title = cleaned;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    if session_id.is_empty() {
        session_id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
    }
    if session_id.is_empty() {
        return None;
    }
    let title = if !custom_title.is_empty() {
        custom_title
    } else {
        ai_title
    };
    let mut out = Map::new();
    out.insert("session_id".into(), json!(session_id));
    out.insert("cwd".into(), json!(cwd));
    out.insert("title".into(), json!(title));
    out.insert("model".into(), json!(model));
    Some(out)
}

pub fn read_recent_claude_sessions(
    home: &Path,
    roots: &[PathBuf],
    now: f64,
    window_secs: f64,
) -> Vec<Value> {
    let mut cache = HashMap::new();
    read_recent_claude_sessions_cached(home, roots, now, window_secs, &mut cache)
}

fn read_recent_claude_sessions_cached(
    home: &Path,
    roots: &[PathBuf],
    now: f64,
    window_secs: f64,
    cache: &mut RecentMetaCache,
) -> Vec<Value> {
    if cache.len() > 512 {
        cache.clear();
    }
    let cutoff = now - window_secs;
    let mausbot = non_alnum_re()
        .replace_all(&home.join(".openmausbot").to_string_lossy(), "-")
        .into_owned();
    let mut seen_proj_roots: HashSet<PathBuf> = HashSet::new();
    let mut seen_files: HashSet<PathBuf> = HashSet::new();
    let mut by_sid: HashMap<String, (f64, Map<String, Value>)> = HashMap::new();

    for root in roots {
        let proj_root = root.join("projects");
        if !proj_root.is_dir() {
            continue;
        }
        let canon_proj = std::fs::canonicalize(&proj_root).unwrap_or_else(|_| proj_root.clone());
        if !seen_proj_roots.insert(canon_proj) {
            continue;
        }
        let profile = root.to_string_lossy().into_owned();
        let Ok(proj_dirs) = std::fs::read_dir(&proj_root) else {
            continue;
        };
        for pdir in proj_dirs.flatten() {
            let ppath = pdir.path();
            if !ppath.is_dir() {
                continue;
            }
            let pname = ppath.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if !mausbot.is_empty() && pname.starts_with(&mausbot) {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&ppath) else {
                continue;
            };
            for fentry in files.flatten() {
                let path = fentry.path();
                let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if !fname.ends_with(".jsonl") || fname.starts_with("agent-") {
                    continue;
                }
                let Ok(meta) = std::fs::metadata(&path) else {
                    continue;
                };
                if !meta.is_file() || meta.len() == 0 {
                    continue;
                }
                let mtime = file_mtime_epoch(&meta);
                if mtime < cutoff {
                    continue;
                }
                let canon = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                if !seen_files.insert(canon.clone()) {
                    continue;
                }
                let fsize = meta.len();
                let mms = file_mtime_ms(&meta);
                let parsed = match cache.get(&canon) {
                    Some((sz, tm, cached)) if *sz == fsize && *tm == mms => cached.clone(),
                    _ => {
                        let p = parse_claude_session_header(&path);
                        cache.insert(canon.clone(), (fsize, mms, p.clone()));
                        p
                    }
                };
                let Some(parsed) = parsed else {
                    continue;
                };
                let sid = parsed
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if sid.is_empty() {
                    continue;
                }
                let cwd = parsed.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
                let mut row = Map::new();
                row.insert("id".into(), json!(sid));
                row.insert("session_id".into(), json!(sid));
                row.insert("path".into(), json!(path.to_string_lossy().into_owned()));
                row.insert("profile".into(), json!(profile));
                row.insert("cwd".into(), json!(cwd));
                row.insert(
                    "title".into(),
                    json!(parsed.get("title").and_then(|v| v.as_str()).unwrap_or("")),
                );
                row.insert(
                    "model".into(),
                    json!(parsed.get("model").and_then(|v| v.as_str()).unwrap_or("")),
                );
                row.insert("modified".into(), json!(mtime));
                let replace = match by_sid.get(&sid) {
                    None => true,
                    Some((prev_t, prev_row)) => {
                        mtime > *prev_t
                            || ((mtime - *prev_t).abs() < 1e-6
                                && prev_row
                                    .get("cwd")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .is_empty()
                                && !cwd.is_empty())
                    }
                };
                if replace {
                    by_sid.insert(sid, (mtime, row));
                }
            }
        }
    }

    let mut rows: Vec<(f64, Map<String, Value>)> = by_sid.into_values().collect();
    rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    rows.truncate(100);
    rows.into_iter().map(|(_, r)| Value::Object(r)).collect()
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn run_cmd_stdout(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn read_ps_ttys(pids: &[u32]) -> HashMap<u32, String> {
    let mut out = HashMap::new();
    if pids.is_empty() || cfg!(windows) {
        return out;
    }
    let pid_arg = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let Some(raw) = run_cmd_stdout("ps", &["-p", &pid_arg, "-o", "pid=,tty="]) else {
        return out;
    };
    for line in raw.lines() {
        let mut parts = line.split_whitespace();
        if let (Some(ps), Some(tty)) = (parts.next(), parts.next()) {
            if let Ok(pid) = ps.parse::<u32>() {
                if !matches!(tty, "?" | "??" | "") {
                    out.insert(pid, tty.to_string());
                }
            }
        }
    }
    out
}

pub fn read_orca_terminals() -> Option<Vec<Value>> {
    let exe = orca_executable();
    let raw = run_cmd_stdout(&exe, &["terminal", "list", "--json"])?;
    let val: Value = serde_json::from_str(&raw).ok()?;
    val.get("result")?
        .get("terminals")
        .and_then(|v| v.as_array())
        .cloned()
}

pub fn read_orca_agents() -> Option<Vec<Value>> {
    let exe = orca_executable();
    let raw = run_cmd_stdout(&exe, &["worktree", "ps", "--json"])?;
    let val: Value = serde_json::from_str(&raw).ok()?;
    let wts = val.get("result")?.get("worktrees")?.as_array()?;
    let mut out = Vec::new();
    for w in wts {
        let Some(agents) = w.get("agents").and_then(|v| v.as_array()) else {
            continue;
        };
        for a in agents {
            let Some(pk) = a
                .get("paneKey")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };
            let act = a.get("activity").and_then(|v| v.as_object());
            let name = a
                .get("conversationName")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| act.and_then(|x| x.get("title")).and_then(|v| v.as_str()))
                .unwrap_or("");
            out.push(json!({
                "paneKey": pk,
                "type": a.get("agentType").cloned().unwrap_or(Value::Null),
                "state": a.get("state").cloned().unwrap_or(Value::Null),
                "interrupted": a.get("interrupted").and_then(|v| v.as_bool()).unwrap_or(false),
                "verifiable": act.and_then(|x| x.get("status")).and_then(|v| v.as_str()) != Some("unverifiable"),
                "since": a.get("stateStartedAt").cloned().unwrap_or(Value::Null),
                "name": name
            }));
        }
    }
    Some(out)
}

pub fn read_tmux_panes() -> Map<String, Value> {
    let mut out = Map::new();
    let Some(raw) = run_cmd_stdout(
        "tmux",
        &["list-panes", "-a", "-F", "#{pane_id}\t#{pane_title}"],
    ) else {
        return out;
    };
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once('\t') {
            out.insert(k.to_string(), json!(v));
        }
    }
    out
}

pub fn read_aside_sessions(home: &Path, now: f64, running: bool) -> Vec<Value> {
    let mut rows = Vec::new();
    let pat = format!("{}/.aside/u/*/state.db", home.display());
    let mut dbs: Vec<PathBuf> = glob::glob(&pat)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    dbs.sort();
    for db_path in dbs.into_iter().take(12) {
        let prof = db_path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if prof.is_empty() || !prof.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Ok(conn) = open_readonly(&db_path, 0.2) else {
            continue;
        };
        let parent_col = if has_column(&conn, "sessions", "parent_id") {
            "parent_id"
        } else {
            "NULL"
        };
        let trigger_col = if has_column(&conn, "sessions", "trigger") {
            "trigger"
        } else {
            "NULL"
        };
        let sql = format!(
            "SELECT id, title, status, model, cwd, created_at, updated_at, {parent_col}, {trigger_col} \
             FROM sessions WHERE archived_at IS NULL AND incognito=0 AND ephemeral=0 \
             AND (updated_at>?1 OR status IN ('running','working','streaming','executing','waiting')) \
             ORDER BY updated_at DESC LIMIT 100"
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            continue;
        };
        let Ok(iter) = stmt.query_map(rusqlite::params![now - 86400.0], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                r.get::<_, Option<String>>(4)?.unwrap_or_default(),
                r.get::<_, f64>(5).unwrap_or(0.0),
                r.get::<_, f64>(6).unwrap_or(0.0),
                r.get::<_, Option<String>>(7)?,
                r.get::<_, Option<String>>(8)?.unwrap_or_default(),
            ))
        }) else {
            continue;
        };
        let source: Vec<_> = iter.flatten().collect();
        let db_dir = db_path.parent().unwrap();
        let creds =
            crate::accounts::read_json_object(&db_dir.join("credentials.json"), 8 * 1024 * 1024);
        let mut billing = Map::new();
        if let Some(aid) = creds
            .get("openai-codex")
            .and_then(|c| c.get("accountId"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
        {
            billing.insert(
                "openai-codex".into(),
                json!(account_identity("Codex", aid, "")),
            );
        }
        let mut paths_map: HashMap<String, String> = HashMap::new();
        let mpat = format!("{}/sessions/*/messages.jsonl", db_dir.display());
        if let Ok(mps) = glob::glob(&mpat) {
            for mp in mps.flatten() {
                if let Some(dir_name) = mp
                    .parent()
                    .and_then(|d| d.file_name())
                    .and_then(|s| s.to_str())
                {
                    let sid = dir_name.rsplit('_').next().unwrap_or("");
                    paths_map.insert(sid.to_string(), mp.to_string_lossy().into_owned());
                }
            }
        }
        for (id, title, status, model_raw, cwd, created, updated, parent, trigger_raw) in source {
            if !aside_sid_re().is_match(&id) {
                continue;
            }
            let model_v = serde_json::from_str::<Value>(&model_raw)
                .ok()
                .filter(|v| v.is_object())
                .unwrap_or_else(|| json!({}));
            let trig_v = serde_json::from_str::<Value>(&trigger_raw)
                .ok()
                .filter(|v| v.is_object())
                .unwrap_or_else(|| json!({}));
            rows.push(json!({
                "id": id,
                "title": title,
                "status": status,
                "model": model_v,
                "cwd": cwd,
                "created": created,
                "updated": updated,
                "parent": parent,
                "trigger": trig_v,
                "db": db_path.to_string_lossy(),
                "profile": prof,
                "running": running,
                "path": paths_map.get(&id).cloned(),
                "billing_accounts": billing
            }));
        }
    }
    rows
}

fn read_lsof_open_files(pids: &[u32]) -> HashMap<u32, Vec<String>> {
    let mut out: HashMap<u32, Vec<String>> = HashMap::new();
    if pids.is_empty() || cfg!(windows) {
        return out;
    }
    let pid_arg = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let Some(raw) = run_cmd_stdout("lsof", &["-p", &pid_arg, "-Fn"])
        .or_else(|| run_cmd_stdout("/usr/sbin/lsof", &["-p", &pid_arg, "-Fn"]))
    else {
        return out;
    };
    let mut cur_pid: Option<u32> = None;
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix('p') {
            cur_pid = rest.parse::<u32>().ok();
        } else if let Some(path) = line.strip_prefix('n') {
            if let Some(pid) = cur_pid {
                out.entry(pid).or_default().push(path.to_string());
            }
        }
    }
    out
}

pub fn read_codex_logs(processes: &[Value]) -> Vec<Value> {
    let cands: Vec<&Map<String, Value>> = processes
        .iter()
        .filter_map(|p| p.as_object())
        .filter(|p| p.get("kind").and_then(|v| v.as_str()) == Some("Codex"))
        .collect();
    if cands.is_empty() {
        return Vec::new();
    }
    let pids: Vec<u32> = cands
        .iter()
        .filter_map(|p| p.get("pid").and_then(|v| v.as_u64()).map(|u| u as u32))
        .collect();
    let lsof = read_lsof_open_files(&pids);
    let mut opened: HashMap<String, HashSet<u32>> = HashMap::new();
    for (pid, files) in lsof {
        for f in files {
            if f.ends_with(".jsonl") {
                opened.entry(f).or_default().insert(pid);
            }
        }
    }

    let default_root = home_dir().join(".codex").to_string_lossy().into_owned();
    let mut roots: HashSet<String> = cands
        .iter()
        .map(|p| {
            p.get("config_dir")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or(&default_root)
                .to_string()
        })
        .collect();
    for path in opened.keys() {
        let norm = path.replace('\\', "/");
        if let Some(caps) = rollout_root_re().captures(&norm) {
            roots.insert(caps[1].to_string());
        }
    }

    let mut records: HashMap<String, Map<String, Value>> = HashMap::new();
    let mut paths: HashMap<String, (String, HashSet<u32>)> = HashMap::new();
    for root in &roots {
        let folder = PathBuf::from(root);
        let sess_dir = folder.join("sessions");
        for (p, holders) in &opened {
            if Path::new(p).starts_with(&sess_dir) {
                paths.insert(p.clone(), (root.clone(), holders.clone()));
            }
        }
        let pat = format!("{}/state_*.sqlite", folder.display());
        let mut dbs: Vec<PathBuf> = glob::glob(&pat)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect();
        dbs.sort();
        if let Some(latest) = dbs.last() {
            if let Ok(conn) = open_readonly(latest, 1.0) {
                let name_col = if has_column(&conn, "threads", "name") {
                    "name"
                } else {
                    "NULL"
                };
                let sql =
                    format!("SELECT id, rollout_path, cwd, title, model, {name_col} FROM threads WHERE archived=0");
                if let Ok(mut stmt) = conn.prepare(&sql) {
                    if let Ok(rows) = stmt.query_map([], |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                            r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                            r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                            r.get::<_, Option<String>>(4)?,
                            r.get::<_, Option<String>>(5)?,
                        ))
                    }) {
                        for (sid, rpath, cwd, title, model, name) in rows.flatten() {
                            if paths.contains_key(&rpath) {
                                let mut m = Map::new();
                                m.insert("session_id".into(), json!(sid));
                                m.insert("path".into(), json!(rpath));
                                m.insert("cwd".into(), json!(cwd));
                                m.insert("title".into(), json!(title));
                                m.insert(
                                    "model".into(),
                                    model.map(Value::String).unwrap_or(Value::Null),
                                );
                                m.insert(
                                    "name".into(),
                                    name.map(Value::String).unwrap_or(Value::Null),
                                );
                                records.insert(rpath, m);
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result = Vec::new();
    for (path, (root, holders)) in paths {
        let mut row = match records.remove(&path) {
            Some(r) => r,
            None => {
                let Ok(f) = File::open(&path) else {
                    continue;
                };
                let mut reader = BufReader::new(f);
                let mut buf = Vec::new();
                if reader
                    .by_ref()
                    .take(2 * 1024 * 1024)
                    .read_until(b'\n', &mut buf)
                    .is_err()
                {
                    continue;
                }
                let Ok(val) = serde_json::from_slice::<Value>(&buf) else {
                    continue;
                };
                let payload = val.get("payload").and_then(|v| v.as_object());
                let stem = Path::new(&path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let mut m = Map::new();
                m.insert(
                    "session_id".into(),
                    json!(payload
                        .and_then(|p| p.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(stem)),
                );
                m.insert(
                    "cwd".into(),
                    json!(payload
                        .and_then(|p| p.get("cwd"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")),
                );
                m.insert("title".into(), json!(""));
                m.insert("name".into(), Value::Null);
                m.insert("model".into(), Value::Null);
                m
            }
        };
        let sid = row
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let mut hvec: Vec<u32> = holders.into_iter().collect();
        hvec.sort_unstable();
        row.insert("id".into(), json!(sid));
        row.insert("path".into(), json!(path));
        row.insert("profile".into(), json!(root));
        row.insert("holders".into(), json!(hvec));
        if let Some(tail) = read_tail(Path::new(&path)) {
            row.insert("events".into(), json!(tail.events));
        }
        for (k, v) in codex_metadata(Path::new(&path), Some(&sid)) {
            row.insert(k, v);
        }
        let title = row.get("title").and_then(|v| v.as_str()).unwrap_or("");
        if title.starts_with("# AGENTS") || title.starts_with('<') || title.starts_with("You are") {
            row.insert("title".into(), json!(""));
        }
        result.push(Value::Object(row));
    }
    result
}

pub fn read_antigravity_cli_sessions(processes: &[Value]) -> Vec<Value> {
    let ag_pids: Vec<u32> = processes
        .iter()
        .filter_map(|p| p.as_object())
        .filter(|p| {
            p.get("kind").and_then(|v| v.as_str()) == Some("Antigravity")
                && p.get("role").and_then(|v| v.as_str()) != Some("helper")
        })
        .filter_map(|p| p.get("pid").and_then(|v| v.as_u64()).map(|u| u as u32))
        .collect();
    if ag_pids.is_empty() {
        return Vec::new();
    }
    let lsof = read_lsof_open_files(&ag_pids);
    let mut catalogs: HashMap<PathBuf, BTreeMap<String, antigravity::CatalogRow>> = HashMap::new();
    let mut out = Vec::new();
    for (pid, files) in lsof {
        for f in files {
            let p = Path::new(&f);
            if p.parent()
                .and_then(|d| d.file_name())
                .and_then(|s| s.to_str())
                == Some("presence")
                && p.extension().and_then(|s| s.to_str()) == Some("lock")
            {
                let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                if !antigravity::is_conversation_id(stem) {
                    continue;
                }
                let Some(root) = p.parent().and_then(|d| d.parent()) else {
                    continue;
                };
                let cat = catalogs
                    .entry(root.to_path_buf())
                    .or_insert_with(|| antigravity::read_catalog(root));
                let info = cat.get(stem);
                out.push(json!({
                    "pid": pid,
                    "session_id": stem,
                    "root": root.to_string_lossy(),
                    "title": info.map(|i| i.title.as_str()).unwrap_or(""),
                    "cwd": info.map(|i| i.cwd.as_str()).unwrap_or(""),
                    "status": info.map(|i| i.status.as_str()).unwrap_or(""),
                    "modified": info.map(|i| i.modified).unwrap_or(0.0)
                }));
            }
        }
    }
    out
}

pub struct Locations {
    home: PathBuf,
    pub antigravity: HashMap<String, bool>,
    pub devin: Vec<String>,
    pub codex: Vec<String>,
    pub claude: Vec<String>,
    checked: HashMap<(u32, u64), f64>,
}

impl Locations {
    pub fn new(home: PathBuf, known: Option<&Map<String, Value>>) -> Self {
        let mut ag = HashMap::new();
        let mut dv = Vec::new();
        let mut cx = Vec::new();
        let mut cl = Vec::new();
        if let Some(k) = known {
            if let Some(am) = k.get("antigravity").and_then(|v| v.as_object()) {
                for (path, app) in am {
                    ag.insert(path.clone(), app.as_bool().unwrap_or(false));
                }
            }
            for (key, target) in [("devin", &mut dv), ("codex", &mut cx), ("claude", &mut cl)] {
                if let Some(arr) = k.get(key).and_then(|v| v.as_array()) {
                    for v in arr {
                        if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
                            let owned = s.to_string();
                            if !target.contains(&owned) {
                                target.push(owned);
                            }
                        }
                    }
                    target.truncate(64);
                }
            }
        }
        Self {
            home,
            antigravity: ag,
            devin: dv,
            codex: cx,
            claude: cl,
            checked: HashMap::new(),
        }
    }

    pub fn update(&mut self, processes: &[Value], sys: &System, now: f64) {
        let default_codex = self.home.join(".codex").to_string_lossy().into_owned();
        let default_claude = self.home.join(".claude").to_string_lossy().into_owned();
        let mut seen = HashMap::new();
        let mut inspect_pids = Vec::new();
        let mut pid_tools: HashMap<u32, &str> = HashMap::new();
        for pv in processes {
            let Some(p) = pv.as_object() else {
                continue;
            };
            if let Some(cfg) = p
                .get("config_dir")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                let cfg_path = Path::new(cfg);
                if cfg_path.is_absolute() {
                    match p.get("kind").and_then(|v| v.as_str()) {
                        Some("Codex")
                            if cfg != default_codex && !self.codex.iter().any(|x| x == cfg) =>
                        {
                            self.codex.insert(0, cfg.to_string());
                            self.codex.truncate(64);
                        }
                        Some("Claude" | "GLM")
                            if cfg != default_claude && !self.claude.iter().any(|x| x == cfg) =>
                        {
                            self.claude.insert(0, cfg.to_string());
                            self.claude.truncate(64);
                        }
                        _ => {}
                    }
                }
            }
            let name = p.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let Some(kind) = location_tool(Some(name)) else {
                continue;
            };
            let Some(pid) = p.get("pid").and_then(|v| v.as_u64()).map(|u| u as u32) else {
                continue;
            };
            let birth = p.get("birth").and_then(|v| v.as_f64()).unwrap_or(0.0) as u64;
            let key = (pid, birth);
            let last = self.checked.get(&key).copied().unwrap_or(0.0);
            seen.insert(key, last);
            if now - last < 30.0 {
                continue;
            }
            seen.insert(key, now);
            inspect_pids.push(pid);
            pid_tools.insert(pid, kind);
        }
        if !inspect_pids.is_empty() {
            let open_map = read_lsof_open_files(&inspect_pids);
            let default_devin = devin::database(&self.home).to_string_lossy().into_owned();
            for pid in inspect_pids {
                let kind = pid_tools[&pid];
                let files = open_map.get(&pid).map(Vec::as_slice).unwrap_or(&[]);
                if kind == "devin" {
                    for f in files {
                        if Path::new(f).file_name().and_then(|s| s.to_str()) == Some("sessions.db")
                            && f != &default_devin
                            && !self.devin.contains(f)
                        {
                            self.devin.insert(0, f.clone());
                            self.devin.truncate(64);
                        }
                    }
                    continue;
                }
                let args: Vec<String> = sys
                    .process(sysinfo::Pid::from_u32(pid))
                    .map(|pr| {
                        pr.cmd()
                            .iter()
                            .map(|a| a.to_string_lossy().into_owned())
                            .collect()
                    })
                    .unwrap_or_default();
                let (started_root, is_app) = location_started(&args, &self.home);
                let mut roots = Vec::new();
                if let Some(sr) = started_root {
                    roots.push(sr);
                }
                for f in files {
                    if let Some(hr) = location_holder(Path::new(f)) {
                        roots.push(hr);
                    }
                }
                for r in roots {
                    if r.is_absolute() {
                        let k = r.to_string_lossy().into_owned();
                        let prev = self.antigravity.get(&k).copied().unwrap_or(false);
                        self.antigravity.insert(k, prev || is_app);
                    }
                }
            }
        }
        self.checked = seen;
    }

    pub fn antigravity_roots(&self) -> Vec<PathBuf> {
        let mut cands = antigravity::roots(&self.home);
        for k in self.antigravity.keys() {
            cands.push(PathBuf::from(k));
        }
        dedupe_existing_dirs(cands)
    }

    pub fn app_roots(&self) -> Vec<PathBuf> {
        self.antigravity_roots()
            .into_iter()
            .filter(|r| {
                r.file_name().and_then(|s| s.to_str()) == Some("antigravity-acp")
                    || self
                        .antigravity
                        .get(&r.to_string_lossy().into_owned())
                        .copied()
                        .unwrap_or(false)
            })
            .collect()
    }

    pub fn codex_roots(&self) -> Vec<PathBuf> {
        let mut cands = vec![self.home.join(".codex")];
        if let Ok(v) = std::env::var("CODEX_HOME") {
            if !v.is_empty() {
                cands.push(PathBuf::from(v));
            }
        }
        let mdir = managed_profiles_dir(Some(&self.home)).join("codex");
        if let Ok(entries) = std::fs::read_dir(&mdir) {
            let mut managed: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            managed.sort();
            cands.extend(managed);
        }
        for p in openbot_provider_account_dirs(&self.home) {
            if p.join("sessions").is_dir() {
                cands.push(p);
            }
        }
        for k in &self.codex {
            cands.push(PathBuf::from(k));
        }
        dedupe_existing_dirs(cands)
    }

    pub fn claude_roots(&self) -> Vec<PathBuf> {
        let mut cands = vec![self.home.join(".claude")];
        if let Ok(v) = std::env::var("CLAUDE_CONFIG_DIR") {
            if !v.is_empty() {
                cands.push(PathBuf::from(v));
            }
        }
        let mdir = managed_profiles_dir(Some(&self.home)).join("claude");
        if let Ok(entries) = std::fs::read_dir(&mdir) {
            let mut managed: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
            managed.sort();
            cands.extend(managed);
        }
        for p in openbot_provider_account_dirs(&self.home) {
            if p.join("projects").is_dir() {
                cands.push(p);
            }
        }
        for p in orca_claude_profile_homes(&self.home) {
            if p.join("projects").is_dir() {
                cands.push(p);
            }
        }
        for k in &self.claude {
            cands.push(PathBuf::from(k));
        }
        dedupe_existing_dirs(cands)
    }

    pub fn devin_databases(&self) -> Vec<PathBuf> {
        let mut out = vec![devin::database(&self.home)];
        for p in &self.devin {
            let pb = PathBuf::from(p);
            if !out.contains(&pb) {
                out.push(pb);
            }
        }
        out
    }

    pub fn known(&self) -> Value {
        json!({
            "antigravity": self.antigravity,
            "devin": self.devin,
            "codex": self.codex,
            "claude": self.claude
        })
    }
}

pub struct Observer {
    pub home: PathBuf,
    pub locations: Locations,
    sys: System,
    paths_cache: HashMap<(String, String), String>,
    recent_codex_cache: RecentMetaCache,
    recent_claude_cache: RecentMetaCache,
    agents_at: f64,
    ledger_at: f64,
    apps_at: f64,
}

impl Observer {
    pub fn new(home: Option<PathBuf>, known: Option<&Map<String, Value>>) -> Self {
        let home = home.unwrap_or_else(home_dir);
        Self {
            locations: Locations::new(home.clone(), known),
            home,
            sys: System::new(),
            paths_cache: HashMap::new(),
            recent_codex_cache: HashMap::new(),
            recent_claude_cache: HashMap::new(),
            agents_at: 0.0,
            ledger_at: 0.0,
            apps_at: 0.0,
        }
    }

    fn read_processes(&mut self) -> Vec<Value> {
        // Pass 1: lightweight metadata only (no cwd / environ for ~900 non-AI processes).
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_exe(UpdateKind::OnlyIfNotSet)
                .with_cmd(UpdateKind::OnlyIfNotSet)
                .with_user(UpdateKind::OnlyIfNotSet),
        );
        let own_pid = std::process::id();
        let own_uid = self
            .sys
            .process(sysinfo::Pid::from_u32(own_pid))
            .and_then(|p| p.user_id())
            .cloned();

        // Identify AI PIDs first so cwd/environ syscalls run ONLY on ~10-30 AI processes.
        let mut ai_sys_pids: Vec<sysinfo::Pid> = Vec::new();
        for (pid_obj, proc_info) in self.sys.processes() {
            if let Some(ref my_uid) = own_uid {
                if proc_info.user_id() != Some(my_uid) {
                    continue;
                }
            }
            let name = proc_info.name().to_string_lossy();
            let exe = proc_info
                .exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let args: Vec<String> = proc_info
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            if cli_kind(&name, &args, &exe).is_some() {
                ai_sys_pids.push(*pid_obj);
            }
        }
        if !ai_sys_pids.is_empty() {
            self.sys.refresh_processes_specifics(
                ProcessesToUpdate::Some(&ai_sys_pids),
                false,
                ProcessRefreshKind::nothing()
                    .with_cwd(UpdateKind::Always)
                    .with_environ(UpdateKind::OnlyIfNotSet),
            );
        }

        let mut raw_rows: Vec<(u32, u32, Map<String, Value>)> = Vec::new();
        let mut ai_pids: Vec<u32> = Vec::new();

        for (pid_obj, proc_info) in self.sys.processes() {
            if let Some(ref my_uid) = own_uid {
                if proc_info.user_id() != Some(my_uid) {
                    continue;
                }
            }
            let pid = pid_obj.as_u32();
            let ppid = proc_info.parent().map(|p| p.as_u32()).unwrap_or(0);
            let name = proc_info.name().to_string_lossy().into_owned();
            let exe = proc_info
                .exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default();
            let args: Vec<String> = proc_info
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            let kind = cli_kind(&name, &args, &exe);
            let birth = proc_info.start_time() as f64;
            let (app_name, app_path) = app_from(&exe, &name);

            let mut safe_env = Map::new();
            let mut profile: Option<String> = None;
            let mut provider = String::new();
            let mut configured_model = String::new();
            let mut cwd = String::new();

            if let Some(k) = kind {
                ai_pids.push(pid);
                if let Some(c) = proc_info.cwd() {
                    cwd = c.to_string_lossy().into_owned();
                }
                for entry in proc_info.environ() {
                    let s = entry.to_string_lossy();
                    let Some((ek, ev)) = s.split_once('=') else {
                        continue;
                    };
                    if ev.is_empty() {
                        continue;
                    }
                    match ek {
                        "ORCA_TERMINAL_HANDLE"
                        | "ORCA_TAB_ID"
                        | "TMUX_PANE"
                        | "ORCA_AGENT_SESSION_ID"
                        | "ORCA_STRUCTURED_SESSION" => {
                            safe_env.insert(ek.to_string(), json!(ev));
                        }
                        "CODEX_HOME" if k == "Codex" => profile = Some(ev.to_string()),
                        "CLAUDE_CONFIG_DIR" if k != "Codex" => profile = Some(ev.to_string()),
                        "ANTHROPIC_BASE_URL" => {
                            if let Ok(u) = Url::parse(ev) {
                                if let Some(h) = u.host_str() {
                                    provider = h.to_string();
                                }
                            }
                        }
                        "ANTHROPIC_MODEL" => configured_model = ev.to_string(),
                        "ANTHROPIC_DEFAULT_OPUS_MODEL" if configured_model.is_empty() => {
                            configured_model = ev.to_string();
                        }
                        _ => {}
                    }
                }
            }

            let config_dir = profile.unwrap_or_else(|| {
                self.home
                    .join(if kind == Some("Codex") {
                        ".codex"
                    } else {
                        ".claude"
                    })
                    .to_string_lossy()
                    .into_owned()
            });

            let mut row = Map::new();
            row.insert("pid".into(), json!(pid));
            row.insert("ppid".into(), json!(ppid));
            row.insert("name".into(), json!(name));
            row.insert("exe".into(), json!(exe));
            row.insert("argv".into(), json!(argv_shape(&args)));
            row.insert("kind".into(), kind.map(|k| json!(k)).unwrap_or(Value::Null));
            row.insert("config_dir".into(), json!(config_dir));
            row.insert("env".into(), Value::Object(safe_env));
            row.insert("provider".into(), json!(provider));
            row.insert("configured_model".into(), json!(configured_model));
            row.insert(
                "explicit_session".into(),
                explicit_session(&args)
                    .map(Value::String)
                    .unwrap_or(Value::Null),
            );
            row.insert("app".into(), json!([app_name, app_path]));
            row.insert("birth".into(), json!(birth));
            row.insert("started".into(), json!(format_local_ctime(birth)));
            row.insert("cwd".into(), json!(cwd));
            row.insert("tty".into(), json!(""));
            row.insert("ai".into(), json!(kind.is_some()));

            // Describe using real args before stripping
            let mut desc_input = row.clone();
            desc_input.insert("argv".into(), json!(args));
            let desc = describe_json(&desc_input);
            row.insert(
                "kind".into(),
                desc.kind.map(|k| json!(k)).unwrap_or(Value::Null),
            );
            row.insert("role".into(), json!(desc.role));
            if let Some(es) = desc.explicit_session {
                row.insert("explicit_session".into(), json!(es));
            }
            raw_rows.push((pid, ppid, row));
        }

        let ttys = read_ps_ttys(&ai_pids);
        let probe_pairs: Vec<(u32, u32, bool)> = raw_rows
            .iter()
            .map(|(pid, ppid, r)| {
                (
                    *pid,
                    *ppid,
                    r.get("kind").and_then(|v| v.as_str()).is_some(),
                )
            })
            .collect();
        let own_probes: HashSet<u32> = find_own_probe_pids(&probe_pairs, own_pid)
            .into_iter()
            .collect();

        raw_rows
            .into_iter()
            .map(|(pid, _, mut row)| {
                if let Some(tty) = ttys.get(&pid) {
                    row.insert("tty".into(), json!(tty));
                }
                if own_probes.contains(&pid) {
                    row.insert("own_probe".into(), json!(true));
                    row.insert("role".into(), json!("helper"));
                }
                Value::Object(row)
            })
            .collect()
    }

    pub fn read(&mut self) -> Map<String, Value> {
        let procs = self.read_processes();
        let now = now_epoch();
        self.agents_at = 0.0;
        self.locations.update(&procs, &self.sys, now);

        let (orca_terms, ag_cli, tmux_panes, codex_logs, openbot_agents) =
            std::thread::scope(|s| {
                let h_orca = s.spawn(read_orca_terminals);
                let h_ag = s.spawn(|| read_antigravity_cli_sessions(&procs));
                let h_tmux = s.spawn(read_tmux_panes);
                let h_codex = s.spawn(|| read_codex_logs(&procs));
                let home_ref = &self.home;
                let h_ob = s.spawn(move || {
                    read_openbot_agents(home_ref)
                        .into_iter()
                        .map(|a| json!({"workspace": a.workspace, "name": a.name}))
                        .collect::<Vec<Value>>()
                });
                (
                    h_orca.join().ok().flatten(),
                    h_ag.join().unwrap_or_default(),
                    h_tmux.join().unwrap_or_default(),
                    h_codex.join().unwrap_or_default(),
                    h_ob.join().unwrap_or_default(),
                )
            });

        let openbot_running = procs.iter().any(|p| {
            p.get("exe")
                .and_then(|v| v.as_str())
                .is_some_and(|e| e.contains("/OpenBot.app/"))
                || p.get("name").and_then(|v| v.as_str()) == Some("OpenBot")
        });
        let openmausbot_running = procs.iter().any(|p| {
            p.get("exe")
                .and_then(|v| v.as_str())
                .is_some_and(|e| e.contains("/OpenMausBot.app/Contents/MacOS/"))
        });
        let devin_running = procs
            .iter()
            .any(|p| p.get("name").and_then(|v| v.as_str()) == Some("devin"));

        let mut record = Map::new();
        record.insert("schema".into(), json!("onetop.session-capture.v1"));
        record.insert("captured_at".into(), json!(now));
        record.insert(
            "platform".into(),
            json!(match std::env::consts::OS {
                "macos" => "Darwin",
                "windows" => "Windows",
                other => other,
            }),
        );
        record.insert(
            "orca_terminals".into(),
            orca_terms.map(Value::Array).unwrap_or(Value::Null),
        );
        record.insert("antigravity_sessions".into(), Value::Array(ag_cli));
        record.insert("openbot_agents".into(), Value::Array(openbot_agents));
        record.insert("tmux_panes".into(), Value::Object(tmux_panes));
        record.insert("openmausbot_running".into(), json!(openmausbot_running));
        record.insert("openbot_running".into(), json!(openbot_running));
        record.insert("devin_running".into(), json!(devin_running));
        record.insert("codex_logs".into(), Value::Array(codex_logs));
        record.insert("processes".into(), Value::Array(procs));
        self.refresh(&record)
    }

    pub fn refresh(&mut self, record: &Map<String, Value>) -> Map<String, Value> {
        let now = now_epoch();
        let procs = record
            .get("processes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // Read claude registries for Claude/GLM processes
        let mut regs = Map::new();
        let mut observed = Map::new();
        for p in &procs {
            let Some(po) = p.as_object() else {
                continue;
            };
            let kind = po.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            if kind != "Claude" && kind != "GLM" {
                continue;
            }
            let Some(pid) = po.get("pid").and_then(|v| v.as_u64()).map(|u| u as u32) else {
                continue;
            };
            let cfg_dir = po
                .get("config_dir")
                .and_then(|v| v.as_str())
                .unwrap_or("~/.claude");
            let reg = read_claude_registry(Path::new(cfg_dir), pid);
            if !reg.is_empty() {
                if let Some(sid) = reg
                    .get("sessionId")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    let cache_key = (cfg_dir.to_string(), sid.to_string());
                    let path_opt = match self.paths_cache.get(&cache_key) {
                        Some(p) if Path::new(p).exists() => Some(p.clone()),
                        _ => {
                            let found = claude_transcript(cfg_dir, sid);
                            if let Some(ref f) = found {
                                self.paths_cache.insert(cache_key, f.clone());
                            }
                            found
                        }
                    };
                    let name = format!("{cfg_dir}:{sid}");
                    if !observed.contains_key(&name) {
                        let tr_val = if let Some(ref p) = path_opt {
                            let events = read_tail(Path::new(p))
                                .map(|t| t.events)
                                .unwrap_or_default();
                            json!({"path": p, "events": events, "subagents": []})
                        } else {
                            json!({"path": Value::Null, "events": [], "subagents": []})
                        };
                        observed.insert(name, tr_val);
                    }
                }
                regs.insert(pid.to_string(), Value::Object(reg));
            }
        }

        // Refresh codex log tails
        let mut logs = Vec::new();
        if let Some(old_logs) = record.get("codex_logs").and_then(|v| v.as_array()) {
            for l in old_logs {
                let mut lo = l.as_object().cloned().unwrap_or_default();
                if let Some(p) = lo.get("path").and_then(|v| v.as_str()) {
                    let evs = read_tail(Path::new(p))
                        .map(|t| t.events)
                        .unwrap_or_default();
                    lo.insert("events".into(), json!(evs));
                }
                logs.push(Value::Object(lo));
            }
        }

        let aside_running = procs
            .iter()
            .any(|p| p.get("name").and_then(|v| v.as_str()) == Some("aside-daemon"));
        let seats = if now - self.agents_at >= 5.0 {
            self.agents_at = now;
            read_orca_agents().map(Value::Array).unwrap_or(Value::Null)
        } else {
            record.get("orca_agents").cloned().unwrap_or(Value::Null)
        };
        let bots = if !record.contains_key("openmausbot_threads") || now - self.ledger_at >= 5.0 {
            self.ledger_at = now;
            let rows: Vec<Value> = read_openmausbot(&self.home, now, 86400.0)
                .into_iter()
                .map(|r| {
                    json!({
                        "id": r.id,
                        "turns": r.turns,
                        "updated": r.updated,
                        "bot": r.bot,
                        "kind": r.kind,
                        "model": r.model
                    })
                })
                .collect();
            Value::Array(rows)
        } else {
            record
                .get("openmausbot_threads")
                .cloned()
                .unwrap_or_else(|| json!([]))
        };

        let (devin_sessions, ag_convs, recent_codex, recent_claude) = if !record
            .contains_key("devin_sessions")
            || !record.contains_key("antigravity_conversations")
            || !record.contains_key("recent_codex_sessions")
            || !record.contains_key("recent_claude_sessions")
            || now - self.apps_at >= 5.0
        {
            self.apps_at = now;
            let mut d_rows = Vec::new();
            let mut seen_d: HashSet<String> = HashSet::new();
            for dbp in self.locations.devin_databases() {
                for r in devin::read_sessions(&dbp, now, 86400.0) {
                    if seen_d.insert(r.id.clone()) {
                        d_rows.push(json!({
                            "id": r.id,
                            "cwd": r.cwd,
                            "model": r.model,
                            "title": r.title,
                            "created": r.created,
                            "updated": r.updated,
                            "status": r.status,
                            "status_at": r.status_at
                        }));
                    }
                }
            }
            let mut ag_rows = Vec::new();
            let mut seen_ag: HashSet<String> = HashSet::new();
            for folder in self.locations.app_roots() {
                for (cid, entry) in antigravity::read_catalog(&folder) {
                    let age = now - entry.modified;
                    if ((-60.0..=86400.0).contains(&age)
                        || entry.status == "CASCADE_RUN_STATUS_RUNNING")
                        && seen_ag.insert(cid)
                    {
                        ag_rows.push(json!({
                            "id": entry.id,
                            "title": entry.title,
                            "cwd": entry.cwd,
                            "status": entry.status,
                            "modified": entry.modified,
                            "root": entry.root,
                            "parent": entry.parent
                        }));
                    }
                }
            }
            let codex_roots = self.locations.codex_roots();
            let claude_roots = self.locations.claude_roots();
            let r_codex = read_recent_codex_sessions_cached(
                &codex_roots,
                now,
                86400.0,
                &mut self.recent_codex_cache,
            );
            let r_claude = read_recent_claude_sessions_cached(
                &self.home,
                &claude_roots,
                now,
                86400.0,
                &mut self.recent_claude_cache,
            );
            (
                Value::Array(d_rows),
                Value::Array(ag_rows),
                Value::Array(r_codex),
                Value::Array(r_claude),
            )
        } else {
            (
                record
                    .get("devin_sessions")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
                record
                    .get("antigravity_conversations")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
                record
                    .get("recent_codex_sessions")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
                record
                    .get("recent_claude_sessions")
                    .cloned()
                    .unwrap_or_else(|| json!([])),
            )
        };

        let mut out = record.clone();
        out.insert("captured_at".into(), json!(now));
        out.insert("orca_agents".into(), seats);
        out.insert("claude_registry".into(), Value::Object(regs));
        out.insert("claude_transcripts".into(), Value::Object(observed));
        out.insert("codex_logs".into(), Value::Array(logs));
        out.insert(
            "aside_sessions".into(),
            Value::Array(read_aside_sessions(&self.home, now, aside_running)),
        );
        out.insert("openmausbot_threads".into(), bots);
        out.insert("devin_sessions".into(), devin_sessions);
        out.insert("antigravity_conversations".into(), ag_convs);
        out.insert("recent_codex_sessions".into(), recent_codex);
        out.insert("recent_claude_sessions".into(), recent_claude);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn locations_and_recent_codex_claude_discovery_deduplicate_across_roots() {
        let tmp = TempDir::new().unwrap();
        let home = tmp.path().to_path_buf();
        let now = now_epoch();
        let today = Utc::now().format("%Y/%m/%d").to_string();

        // 1. Default Codex root
        let default_codex = home.join(".codex");
        let codex_day = default_codex.join("sessions").join(&today);
        std::fs::create_dir_all(&codex_day).unwrap();
        let codex_a = codex_day.join("rollout-2026-11-27T10-00-00-sid-codex-a.jsonl");
        std::fs::write(
            &codex_a,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid-codex-a\",\"cwd\":\"/Users/alice/OpenBot/Agents/agent-1\"}}\n",
        )
        .unwrap();

        // 2. OpenBot provider-account Codex root (with one unique + one duplicate session_id)
        let ob_codex = home.join("Library/Application Support/OpenBot/provider-accounts/acct-cx");
        let ob_day = ob_codex.join("sessions").join(&today);
        std::fs::create_dir_all(&ob_day).unwrap();
        std::fs::write(
            ob_day.join("rollout-2026-11-27T10-01-00-sid-codex-b.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid-codex-b\",\"cwd\":\"/work/project-b\"}}\n",
        )
        .unwrap();
        std::fs::write(
            ob_day.join("rollout-2026-11-27T10-02-00-sid-codex-a-dup.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid-codex-a\",\"cwd\":\"/Users/alice/OpenBot/Agents/agent-1\"}}\n",
        )
        .unwrap();

        // 3. Remembered process-discovered custom Codex root
        let custom_codex = home.join("custom-codex-home");
        let custom_day = custom_codex.join("sessions").join(&today);
        std::fs::create_dir_all(&custom_day).unwrap();
        std::fs::write(
            custom_day.join("rollout-2026-11-27T10-03-00-sid-codex-c.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"sid-codex-c\",\"cwd\":\"/work/project-c\"}}\n",
        )
        .unwrap();

        // 4. Default Claude root + sidechain/agent exclusions
        let default_claude = home.join(".claude");
        let claude_proj = default_claude.join("projects/-work-alpha");
        std::fs::create_dir_all(&claude_proj).unwrap();
        let mut f1 = File::create(claude_proj.join("sid-claude-1.jsonl")).unwrap();
        writeln!(
            f1,
            "{{\"type\":\"user\",\"sessionId\":\"sid-claude-1\",\"cwd\":\"/work/alpha\",\"isSidechain\":false}}"
        )
        .unwrap();
        writeln!(f1, "{{\"type\":\"ai-title\",\"aiTitle\":\"Alpha 작업\"}}").unwrap();
        // Sidechain and agent-* must be skipped
        std::fs::write(
            claude_proj.join("agent-sub1.jsonl"),
            "{\"type\":\"user\",\"sessionId\":\"agent-sub1\",\"cwd\":\"/work/alpha\"}\n",
        )
        .unwrap();
        std::fs::write(
            claude_proj.join("sid-sidechain.jsonl"),
            "{\"type\":\"user\",\"sessionId\":\"sid-sidechain\",\"cwd\":\"/work/alpha\",\"isSidechain\":true}\n",
        )
        .unwrap();

        // 5. OpenBot provider-account Claude root
        let ob_claude = home.join("Library/Application Support/OpenBot/provider-accounts/acct-cl");
        let ob_proj = ob_claude.join("projects/-bots-agent-2");
        std::fs::create_dir_all(&ob_proj).unwrap();
        std::fs::write(
            ob_proj.join("sid-claude-2.jsonl"),
            "{\"type\":\"custom-title\",\"customTitle\":\"OpenBot\"}\n{\"type\":\"user\",\"sessionId\":\"sid-claude-2\",\"cwd\":\"/Users/alice/OpenBot/Agents/agent-2\"}\n",
        )
        .unwrap();

        // 6. Orca claude-profile whose projects dir symlinks to ~/.claude/projects (must not duplicate)
        #[cfg(unix)]
        {
            let orca_home =
                home.join("Library/Application Support/orca/claude-profiles/prof-1/home");
            std::fs::create_dir_all(&orca_home).unwrap();
            std::os::unix::fs::symlink(default_claude.join("projects"), orca_home.join("projects"))
                .unwrap();
        }

        // 7. Remembered custom Claude root via Locations::update
        let custom_claude = home.join("custom-claude-home");
        let custom_cl_proj = custom_claude.join("projects/-work-gamma");
        std::fs::create_dir_all(&custom_cl_proj).unwrap();
        std::fs::write(
            custom_cl_proj.join("sid-claude-3.jsonl"),
            "{\"type\":\"user\",\"sessionId\":\"sid-claude-3\",\"cwd\":\"/work/gamma\"}\n",
        )
        .unwrap();

        let mut locs = Locations::new(home.clone(), None);
        let sys = System::new();
        let fake_procs = vec![
            json!({"pid": 1001, "kind": "Codex", "name": "codex", "config_dir": custom_codex.to_string_lossy()}),
            json!({"pid": 1002, "kind": "Claude", "name": "claude", "config_dir": custom_claude.to_string_lossy()}),
        ];
        locs.update(&fake_procs, &sys, now);

        // Verify persistence roundtrip via known()
        let saved = locs.known();
        let restored = Locations::new(home.clone(), saved.as_object());
        let codex_roots = restored.codex_roots();
        let claude_roots = restored.claude_roots();
        assert!(codex_roots.len() >= 3);
        assert!(claude_roots.len() >= 3);

        let recent_cx = read_recent_codex_sessions(&codex_roots, now, 86400.0);
        let cx_ids: HashSet<&str> = recent_cx
            .iter()
            .filter_map(|v| v.get("session_id").and_then(|s| s.as_str()))
            .collect();
        assert_eq!(
            recent_cx.len(),
            3,
            "duplicate codex session_id must be merged"
        );
        assert!(cx_ids.contains("sid-codex-a"));
        assert!(cx_ids.contains("sid-codex-b"));
        assert!(cx_ids.contains("sid-codex-c"));

        let recent_cl = read_recent_claude_sessions(&home, &claude_roots, now, 86400.0);
        let cl_ids: HashSet<&str> = recent_cl
            .iter()
            .filter_map(|v| v.get("session_id").and_then(|s| s.as_str()))
            .collect();
        assert_eq!(
            recent_cl.len(),
            3,
            "symlinked Orca projects and sidechains must not appear"
        );
        assert!(cl_ids.contains("sid-claude-1"));
        assert!(cl_ids.contains("sid-claude-2"));
        assert!(cl_ids.contains("sid-claude-3"));
        let cl1 = recent_cl
            .iter()
            .find(|v| v.get("session_id").and_then(|s| s.as_str()) == Some("sid-claude-1"))
            .unwrap();
        assert_eq!(
            cl1.get("title").and_then(|v| v.as_str()),
            Some("Alpha 작업")
        );
    }
}
