use crate::readonly::open_readonly;
use crate::text::{parse_devin_stamp_str, truncate_chars};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Exact port of `observe/claude_registry.py:read`.
pub fn read_claude_registry(root: &Path, pid: u32) -> Map<String, Value> {
    let path = root.join("sessions").join(format!("{pid}.json"));
    let Ok(file) = File::open(path) else {
        return Map::new();
    };
    let mut raw = Vec::new();
    if file.take(65537).read_to_end(&mut raw).is_err() || raw.len() > 65536 {
        return Map::new();
    }
    match serde_json::from_slice::<Value>(&raw) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

/// Exact port of `observe/openbot.py:database`.
pub fn openbot_database(home: &Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home.join("Library")
            .join("Application Support")
            .join("OpenBot")
            .join("openbot.db")
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"));
        base.join("OpenBot").join("openbot.db")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        home.join(".config").join("OpenBot").join("openbot.db")
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenBotAgent {
    pub workspace: String,
    pub name: String,
}

/// Exact port of `observe/openbot.py:read` (caller checks `running`).
pub fn read_openbot_agents(home: &Path) -> Vec<OpenBotAgent> {
    let path = openbot_database(home);
    let Ok(db) = open_readonly(&path, 1.0) else {
        return Vec::new();
    };
    let Ok(mut stmt) = db.prepare("SELECT agent_json FROM projection_agents") else {
        return Vec::new();
    };
    let Ok(mut rows) = stmt.query([]) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    while let Ok(Some(row)) = rows.next() {
        let Ok(raw) = row.get::<_, String>(0) else {
            continue;
        };
        let Ok(Value::Object(agent)) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let ws = agent
            .get("workspacePath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let name = agent
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let (Some(w), Some(n)) = (ws, name) {
            out.push(OpenBotAgent {
                workspace: w.to_string(),
                name: truncate_chars(n, 120),
            });
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenMausBotTurn {
    pub thread: String,
    pub bot: String,
    pub kind: String,
    pub model: String,
    pub turn: String,
    pub t: f64,
    pub tokens: [i64; 4],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenMausBotThread {
    pub id: String,
    pub turns: i64,
    pub updated: f64,
    pub bot: String,
    pub kind: String,
    pub model: String,
}

fn is_valid_mausbot_id(s: &str) -> bool {
    let len = s.len();
    (1..=120).contains(&len)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

fn json_nonneg_int(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n
            .as_i64()
            .or_else(|| n.as_f64().map(|f| f as i64))
            .unwrap_or(0)
            .max(0),
        Some(Value::String(s)) => s.trim().parse::<i64>().unwrap_or(0).max(0),
        Some(Value::Bool(b)) => i64::from(*b),
        _ => 0,
    }
}

/// Exact port of `observe/openmausbot.py:turn`.
pub fn parse_openmausbot_turn(row: &Map<String, Value>) -> Option<OpenMausBotTurn> {
    let thread = row.get("threadId").and_then(|v| v.as_str()).unwrap_or("");
    if !is_valid_mausbot_id(thread) {
        return None;
    }
    let ts_raw = row
        .get("endedAt")
        .filter(|v| !v.is_null())
        .or_else(|| row.get("at"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let t = parse_devin_stamp_str(ts_raw);
    if t == 0.0 {
        return None;
    }
    let cached = json_nonneg_int(row.get("cachedInput"));
    let prompt = json_nonneg_int(row.get("input"));
    let output = json_nonneg_int(row.get("output"));
    let kind = match row.get("driverKind").and_then(|v| v.as_str()) {
        Some("codexAgent") => "Codex",
        _ => "Claude",
    };
    let bot = row
        .get("botName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let model = row.get("model").and_then(|v| v.as_str()).unwrap_or("");
    let turn_id = row.get("turnId").and_then(|v| v.as_str()).unwrap_or("");
    Some(OpenMausBotTurn {
        thread: thread.to_string(),
        bot: truncate_chars(bot, 120),
        kind: kind.to_string(),
        model: truncate_chars(model, 120),
        turn: turn_id.to_string(),
        t,
        tokens: [(prompt - cached).max(0), cached, 0, output],
    })
}

/// Exact port of `observe/openmausbot.py:ledgers`.
pub fn openmausbot_ledgers(home: &Path, now: f64) -> Vec<PathBuf> {
    let folder = home.join(".openmausbot").join("usage");
    let mut months: Vec<String> = [now, now - 32.0 * 86400.0]
        .iter()
        .filter_map(|&ts| {
            DateTime::<Utc>::from_timestamp(ts as i64, 0).map(|dt| dt.format("%Y-%m").to_string())
        })
        .collect();
    months.sort();
    months.dedup();
    months
        .into_iter()
        .map(|m| folder.join(format!("{m}.jsonl")))
        .filter(|p| p.is_file())
        .collect()
}

/// Exact port of `observe/openmausbot.py:read`.
pub fn read_openmausbot(home: &Path, now: f64, window: f64) -> Vec<OpenMausBotThread> {
    let mut threads: HashMap<String, OpenMausBotThread> = HashMap::new();
    for path in openmausbot_ledgers(home, now) {
        let Ok(file) = File::open(&path) else {
            continue;
        };
        let mut buf = Vec::new();
        if file.take(64 * 1024 * 1024).read_to_end(&mut buf).is_err() {
            continue;
        }
        // Only complete newline-terminated lines (`split(b'\n')[:-1]`).
        let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') else {
            continue;
        };
        for line in buf[..last_nl].split(|&b| b == b'\n') {
            let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let Some(item) = parse_openmausbot_turn(&map) else {
                continue;
            };
            if item.t > now - window {
                let entry =
                    threads
                        .entry(item.thread.clone())
                        .or_insert_with(|| OpenMausBotThread {
                            id: item.thread.clone(),
                            turns: 0,
                            updated: 0.0,
                            bot: String::new(),
                            kind: String::new(),
                            model: String::new(),
                        });
                entry.turns += 1;
                if item.t >= entry.updated {
                    entry.bot = item.bot;
                    entry.kind = item.kind;
                    entry.model = item.model;
                    entry.updated = item.t;
                }
            }
        }
    }
    let mut out: Vec<OpenMausBotThread> = threads.into_values().collect();
    out.sort_by(|a, b| {
        b.updated
            .partial_cmp(&a.updated)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

/// Exact port of `observe/locations.py:tool`.
pub fn location_tool(name: Option<&str>) -> Option<&'static str> {
    let norm = name.unwrap_or("").replace('\\', "/");
    let tail = norm.rsplit('/').next().unwrap_or("").to_lowercase();
    let base = tail.strip_suffix(".exe").unwrap_or(&tail);
    if matches!(base, "antigravity" | "agy") || base.starts_with("agy_acp_server") {
        Some("antigravity")
    } else if base == "devin" {
        Some("devin")
    } else {
        None
    }
}

/// Exact port of `observe/locations.py:started`.
pub fn location_started(args: &[String], home: &Path) -> (Option<PathBuf>, bool) {
    let mut given: BTreeMap<&str, &str> = BTreeMap::new();
    for (i, value) in args.iter().enumerate() {
        for key in ["--gemini-dir", "--app-data-dir"] {
            if value == key {
                if let Some(next) = args.get(i + 1) {
                    given.insert(key, next.as_str());
                }
            } else if let Some(rest) = value.strip_prefix(key).and_then(|s| s.strip_prefix('=')) {
                given.insert(key, rest);
            }
        }
    }
    let app = args.get(1).is_some_and(|a| a == "acp");
    if !given.values().any(|v| !v.is_empty()) {
        return (None, app);
    }
    let gemini_dir = given
        .get("--gemini-dir")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".gemini"));
    let app_data = given
        .get("--app-data-dir")
        .filter(|v| !v.is_empty())
        .copied()
        .unwrap_or(if app {
            "antigravity-acp"
        } else {
            "antigravity-cli"
        });
    (Some(gemini_dir.join(app_data)), app)
}

/// Exact port of `observe/locations.py:holder`.
pub fn location_holder(path: &Path) -> Option<PathBuf> {
    let name = path.file_name().and_then(|s| s.to_str())?;
    if name == "conversation_summaries.db" {
        return path.parent().map(Path::to_path_buf);
    }
    let parent = path.parent()?;
    let parent_name = parent.file_name().and_then(|s| s.to_str())?;
    let ext = path.extension().and_then(|s| s.to_str())?;
    if (parent_name == "presence" && ext == "lock")
        || (parent_name == "conversations" && ext == "db")
    {
        return parent.parent().map(Path::to_path_buf);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_started_and_holder() {
        let args = vec![
            "antigravity".into(),
            "acp".into(),
            "--gemini-dir=/Users/k/.gemini".into(),
            "--app-data-dir=antigravity-acp".into(),
        ];
        let (root, app) = location_started(&args, Path::new("/Users/k"));
        assert!(app);
        assert_eq!(
            root,
            Some(PathBuf::from("/Users/k/.gemini/antigravity-acp"))
        );
        assert_eq!(
            location_holder(Path::new("/a/b/conversations/uuid.db")),
            Some(PathBuf::from("/a/b"))
        );
        assert_eq!(location_tool(Some("agy_acp_server")), Some("antigravity"));
    }
}
