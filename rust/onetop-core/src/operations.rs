//! Exact port of `operations.py`.
use crate::readonly::open_readonly;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub fn location_of(session: &Map<String, Value>) -> String {
    session
        .get("orca_terminal")
        .and_then(|t| t.get("title"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            session
                .get("location")
                .and_then(|l| l.get("app"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .or_else(|| {
            session
                .get("project")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("위치 미확인")
        .to_string()
}

#[cfg(unix)]
fn file_ino(meta: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn file_ino(_meta: &std::fs::Metadata) -> u64 {
    0
}

pub struct OperationalMonitor {
    home: PathBuf,
    cached: Option<Value>,
    last: Option<Instant>,
    offsets: HashMap<String, (u64, u64)>,
    events: Vec<(String, Value)>,
    claude_goals: HashMap<String, Value>,
}

impl OperationalMonitor {
    pub fn new(home: Option<PathBuf>) -> Self {
        Self {
            home: home.unwrap_or_else(crate::platform_support::home_dir),
            cached: None,
            last: None,
            offsets: HashMap::new(),
            events: Vec::new(),
            claude_goals: HashMap::new(),
        }
    }

    fn upsert_event(&mut self, key: String, val: Value) {
        if let Some(pos) = self.events.iter().position(|(k, _)| k == &key) {
            self.events[pos].1 = val;
        } else {
            self.events.push((key, val));
        }
    }

    fn goals(&self, sessions: &[Value]) -> (Vec<Value>, &'static str) {
        let path = self.home.join(".codex/goals_1.sqlite");
        if !path.exists() {
            return (Vec::new(), "unavailable");
        }
        let Ok(db) = open_readonly(&path, 0.2) else {
            return (Vec::new(), "unavailable");
        };
        let Ok(mut stmt) = db.prepare(
            "SELECT thread_id, goal_id, objective, status, token_budget, tokens_used, \
             time_used_seconds, updated_at_ms FROM thread_goals ORDER BY updated_at_ms DESC LIMIT 100",
        ) else {
            return (Vec::new(), "unavailable");
        };
        let by_id: HashMap<&str, &Map<String, Value>> = sessions
            .iter()
            .filter_map(|s| s.as_object())
            .filter_map(|s| Some((s.get("id")?.as_str()?, s)))
            .collect();
        let Ok(rows) = stmt.query_map([], |r| {
            Ok(json!({
                "thread_id": r.get::<_, String>(0)?,
                "goal_id": r.get::<_, Option<String>>(1)?,
                "objective": r.get::<_, Option<String>>(2)?,
                "status": r.get::<_, Option<String>>(3)?,
                "token_budget": r.get::<_, Option<i64>>(4)?,
                "tokens_used": r.get::<_, Option<i64>>(5)?,
                "time_used_seconds": r.get::<_, Option<f64>>(6)?,
                "updated_at_ms": r.get::<_, Option<i64>>(7)?
            }))
        }) else {
            return (Vec::new(), "unavailable");
        };
        let mut out = Vec::new();
        for mut row in rows.flatten() {
            if let Some(obj) = row.as_object_mut() {
                let tid = obj
                    .get("thread_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let sess = by_id.get(tid.as_str()).copied();
                obj.insert("session_connected".into(), json!(sess.is_some()));
                obj.insert(
                    "location".into(),
                    json!(sess
                        .map(location_of)
                        .unwrap_or_else(|| "연결된 세션 없음".into())),
                );
                obj.insert("runtime".into(), json!("Codex"));
                obj.insert("source".into(), json!("Codex goal database"));
                obj.insert("evidence".into(), json!("reported"));
            }
            out.push(row);
        }
        (out, "reported")
    }

    fn skills(&self, sessions: &[Value]) -> Vec<Value> {
        let mut roots: Vec<(PathBuf, String, String)> = vec![
            (
                self.home.join(".agents/skills"),
                "Shared".into(),
                "user".into(),
            ),
            (
                self.home.join(".codex/skills"),
                "Codex".into(),
                "user".into(),
            ),
            (
                self.home.join(".claude/skills"),
                "Claude".into(),
                "user".into(),
            ),
        ];
        let cwds: BTreeSet<String> = sessions
            .iter()
            .filter_map(|s| s.get("cwd").and_then(|v| v.as_str()))
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        for cwd in cwds {
            for (parent, prov) in [
                (".agents", "Shared"),
                (".codex", "Codex"),
                (".claude", "Claude"),
            ] {
                roots.push((
                    PathBuf::from(&cwd).join(parent).join("skills"),
                    prov.into(),
                    "project".into(),
                ));
            }
        }
        let reg_path = self.home.join(".claude/plugins/installed_plugins.json");
        if let Ok(raw) = std::fs::read_to_string(&reg_path) {
            if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                if let Some(plugins) = val.get("plugins").and_then(|v| v.as_object()) {
                    for installs in plugins.values() {
                        if let Some(arr) = installs.as_array() {
                            for entry in arr {
                                if let Some(ip) = entry.get("installPath").and_then(|v| v.as_str())
                                {
                                    let scope = entry
                                        .get("scope")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("plugin");
                                    roots.push((
                                        PathBuf::from(ip).join("skills"),
                                        "Claude plugin".into(),
                                        scope.into(),
                                    ));
                                }
                            }
                        }
                    }
                }
            }
        }

        let mut found: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
        for (root, provider, scope) in roots {
            if !root.is_dir() {
                continue;
            }
            let mut paths: Vec<PathBuf> = Vec::new();
            for pat in [
                format!("{}/*/SKILL.md", root.display()),
                format!("{}/.system/*/SKILL.md", root.display()),
            ] {
                if let Ok(it) = glob::glob(&pat) {
                    paths.extend(it.flatten());
                }
            }
            let direct = root.join("SKILL.md");
            if direct.is_file() {
                paths.push(direct);
            }
            for p in paths.into_iter().take(400) {
                let Ok(resolved_pb) = std::fs::canonicalize(&p) else {
                    continue;
                };
                let resolved = resolved_pb.to_string_lossy().into_owned();
                if let Some(existing) = found.get_mut(&resolved) {
                    if let Some(provs) =
                        existing.get_mut("providers").and_then(|v| v.as_array_mut())
                    {
                        if !provs.iter().any(|x| x.as_str() == Some(provider.as_str())) {
                            provs.push(json!(provider));
                        }
                    }
                    continue;
                }
                let Ok(mut f) = File::open(&p) else {
                    continue;
                };
                let mut buf = vec![0u8; 8192];
                let Ok(n) = f.read(&mut buf) else {
                    continue;
                };
                let header = String::from_utf8_lossy(&buf[..n]);
                let mut name = p
                    .parent()
                    .and_then(|d| d.file_name())
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                if header.starts_with("---") {
                    let mut parts = header.splitn(3, "---");
                    let _ = parts.next();
                    if let Some(fm) = parts.next() {
                        for line in fm.lines() {
                            if let Some(rest) = line.strip_prefix("name:") {
                                let cleaned = rest.trim().trim_matches(|c| c == '"' || c == '\'');
                                if !cleaned.is_empty() {
                                    name = cleaned.to_string();
                                }
                            }
                        }
                    }
                }
                let mut row = Map::new();
                row.insert(
                    "name".into(),
                    json!(name.chars().take(160).collect::<String>()),
                );
                row.insert("providers".into(), json!([provider]));
                row.insert("scope".into(), json!(scope));
                row.insert("path".into(), json!(p.to_string_lossy()));
                row.insert("state".into(), json!("installed"));
                row.insert("availability".into(), json!("not_verified"));
                found.insert(resolved, row);
            }
        }
        let mut out: Vec<Value> = found.into_values().map(Value::Object).collect();
        out.sort_by(|a, b| {
            let an = a
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            let bn = b
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            an.cmp(&bn)
        });
        out.truncate(600);
        out
    }

    fn scan(&mut self, session: &Map<String, Value>) {
        let Some(path) = session.get("path").and_then(|v| v.as_str()) else {
            return;
        };
        let kind = session.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if path.is_empty() || !matches!(kind, "Claude" | "GLM" | "Codex") {
            return;
        }
        let p = Path::new(path);
        let Ok(meta) = std::fs::metadata(p) else {
            return;
        };
        let ino = file_ino(&meta);
        let size = meta.len();
        let old = self.offsets.get(path).copied();
        let mut start = match old {
            Some((oino, ooff)) if oino == ino && ooff <= size => ooff,
            _ => size.saturating_sub(512_000),
        };
        let Ok(file) = File::open(p) else {
            return;
        };
        let mut f = BufReader::new(file);
        if f.seek(SeekFrom::Start(start)).is_err() {
            return;
        }
        if old.is_none() && start > 0 {
            let mut discard = Vec::new();
            let _ = f.read_until(b'\n', &mut discard);
            if let Ok(pos) = f.stream_position() {
                start = pos;
            }
        }
        let mut raw = Vec::new();
        if f.take(1_048_576).read_to_end(&mut raw).is_err() {
            return;
        }
        let end = raw
            .iter()
            .rposition(|&b| b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(0);
        self.offsets
            .insert(path.to_string(), (ino, start + end as u64));
        for line in raw[..end].split(|&b| b == b'\n') {
            if line.is_empty() {
                continue;
            }
            if let Ok(val) = serde_json::from_slice::<Value>(line) {
                self.handle_event(&val, session);
            }
        }
    }

    fn handle_event(&mut self, value: &Value, session: &Map<String, Value>) {
        let Some(vobj) = value.as_object() else {
            return;
        };
        let kind = session.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if kind == "Codex" {
            self.handle_codex_event(vobj, session);
            return;
        }
        let sid = session.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let loc = location_of(session);
        let obs = vobj.get("timestamp").cloned().unwrap_or(Value::Null);

        if vobj.get("type").and_then(|v| v.as_str()) == Some("attachment") {
            if let Some(att) = vobj.get("attachment").and_then(|v| v.as_object()) {
                if att.get("type").and_then(|v| v.as_str()) == Some("goal_status") {
                    if let Some(cond) = att
                        .get("condition")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        let status = if att.get("failed").and_then(|v| v.as_bool()).unwrap_or(false)
                        {
                            "failed"
                        } else if att.get("met").and_then(|v| v.as_bool()).unwrap_or(false) {
                            if att
                                .get("sentinel")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false)
                            {
                                "cleared"
                            } else {
                                "complete"
                            }
                        } else {
                            "active"
                        };
                        let dur_s = att
                            .get("durationMs")
                            .and_then(|v| v.as_f64())
                            .map(|ms| ms / 1000.0);
                        self.claude_goals.insert(
                            sid.to_string(),
                            json!({
                                "session_id": sid,
                                "location": loc,
                                "provider": kind,
                                "runtime": "Claude Code",
                                "observed_at": obs,
                                "source": "session tool log",
                                "thread_id": sid,
                                "goal_id": sid,
                                "objective": cond.chars().take(4000).collect::<String>(),
                                "status": status,
                                "token_budget": Value::Null,
                                "tokens_used": att.get("tokens").cloned().unwrap_or(Value::Null),
                                "time_used_seconds": dur_s,
                                "iterations": att.get("iterations").cloned().unwrap_or(Value::Null),
                                "session_connected": true,
                                "evidence": "last_observed"
                            }),
                        );
                    }
                }
            }
        }

        if let (Some(tid), Some(fid)) = (
            vobj.get("scheduledTaskId").filter(|v| !v.is_null()),
            vobj.get("scheduledFireId").filter(|v| !v.is_null()),
        ) {
            let key = format!("fire:{}", value_to_str(fid));
            let cron = vobj
                .get("cron")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .chars()
                .take(100)
                .collect::<String>();
            self.upsert_event(
                key,
                json!({
                    "session_id": sid,
                    "location": loc,
                    "provider": kind,
                    "runtime": "Claude Code",
                    "observed_at": obs,
                    "source": "session tool log",
                    "category": "loop",
                    "name": "Scheduled task",
                    "state": "fire_observed",
                    "schedule": cron,
                    "job_id": value_to_str(tid).chars().take(100).collect::<String>(),
                    "next_run": Value::Null,
                    "result": "not_verified"
                }),
            );
        }

        if vobj.get("type").and_then(|v| v.as_str()) == Some("system")
            && vobj.get("subtype").and_then(|v| v.as_str()) == Some("scheduled_task_fire")
        {
            if let Some(tid) = vobj.get("taskId").filter(|v| !v.is_null()) {
                let uid = vobj.get("uuid").unwrap_or(tid);
                let key = format!("fire:{}", value_to_str(uid));
                let name = if vobj.get("taskKind").and_then(|v| v.as_str()) == Some("loop") {
                    "Claude Code /loop"
                } else {
                    "Claude Code scheduled task"
                };
                let cron = vobj
                    .get("cron")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .chars()
                    .take(100)
                    .collect::<String>();
                self.upsert_event(
                    key,
                    json!({
                        "session_id": sid,
                        "location": loc,
                        "provider": kind,
                        "runtime": "Claude Code",
                        "observed_at": obs,
                        "source": "session tool log",
                        "category": "loop",
                        "name": name,
                        "state": "fire_observed",
                        "schedule": cron,
                        "job_id": value_to_str(tid).chars().take(100).collect::<String>(),
                        "next_run": Value::Null,
                        "result": "not_verified"
                    }),
                );
            }
        }

        let Some(content) = vobj
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|v| v.as_array())
        else {
            return;
        };
        for item in content {
            let Some(iobj) = item.as_object() else {
                continue;
            };
            let itype = iobj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if itype == "tool_use" {
                let name = iobj.get("name").and_then(|v| v.as_str()).unwrap_or("");
                if matches!(
                    name,
                    "Skill" | "CronCreate" | "CronDelete" | "CronList" | "ScheduleWakeup"
                ) {
                    let inp = iobj.get("input").and_then(|v| v.as_object());
                    let id_str = iobj.get("id").map(value_to_str).unwrap_or_default();
                    let key = format!("{sid}:{id_str}");
                    let ev_name = inp
                        .and_then(|i| i.get("skill"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or(name);
                    let sched = inp
                        .and_then(|i| i.get("cron"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let jid = inp
                        .and_then(|i| i.get("id"))
                        .map(value_to_str)
                        .unwrap_or_default();
                    self.upsert_event(
                        key,
                        json!({
                            "session_id": sid,
                            "location": loc,
                            "provider": kind,
                            "runtime": "Claude Code",
                            "observed_at": obs,
                            "source": "session tool log",
                            "category": if name == "Skill" { "skill" } else { "loop" },
                            "name": ev_name.chars().take(160).collect::<String>(),
                            "state": "invoked",
                            "schedule": sched.chars().take(100).collect::<String>(),
                            "job_id": jid.chars().take(100).collect::<String>(),
                            "next_run": Value::Null,
                            "result": "not_verified"
                        }),
                    );
                }
            } else if itype == "tool_result" {
                let tid = iobj
                    .get("tool_use_id")
                    .map(value_to_str)
                    .unwrap_or_default();
                let key = format!("{sid}:{tid}");
                let is_err = iobj
                    .get("is_error")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if let Some((_, ev)) = self.events.iter_mut().find(|(k, _)| k == &key) {
                    if let Some(obj) = ev.as_object_mut() {
                        obj.insert(
                            "state".into(),
                            json!(if is_err {
                                "tool_error"
                            } else {
                                "tool_returned"
                            }),
                        );
                    }
                }
            }
        }
    }

    fn handle_codex_event(&mut self, vobj: &Map<String, Value>, session: &Map<String, Value>) {
        if vobj.get("type").and_then(|v| v.as_str()) != Some("response_item") {
            return;
        }
        let Some(payload) = vobj.get("payload").and_then(|v| v.as_object()) else {
            return;
        };
        let ptype = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let call = payload.get("call_id").map(value_to_str).unwrap_or_default();
        if call.is_empty() {
            return;
        }
        let sid = session.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let key = format!("{sid}:{call}");
        if matches!(ptype, "function_call_output" | "custom_tool_call_output") {
            if let Some((_, ev)) = self.events.iter_mut().find(|(k, _)| k == &key) {
                if let Some(obj) = ev.as_object_mut() {
                    obj.insert("state".into(), json!("tool_returned"));
                }
            }
            return;
        }
        if !matches!(ptype, "function_call" | "custom_tool_call") {
            return;
        }
        let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let raw_val = payload.get("arguments").or_else(|| payload.get("input"));
        let args_obj: Option<Map<String, Value>> = match raw_val {
            Some(Value::String(s)) => serde_json::from_str::<Value>(s)
                .ok()
                .and_then(|v| v.as_object().cloned()),
            Some(Value::Object(m)) => Some(m.clone()),
            _ => None,
        };
        let Some(args) = args_obj else {
            return;
        };
        let mut paths = Vec::new();
        if name.ends_with("exec_command") || name.ends_with("shell_command") {
            let cmd = args
                .get("cmd")
                .or_else(|| args.get("command"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let parts: Vec<&str> = cmd.split_whitespace().collect();
            if let Some(&first) = parts.first() {
                if matches!(first, "cat" | "sed" | "head" | "tail") {
                    for part in &parts[1..] {
                        let cleaned = part.trim_matches(|c| c == '"' || c == '\'');
                        if cleaned.ends_with("/SKILL.md") {
                            paths.push(cleaned.to_string());
                        }
                    }
                }
            }
        } else if name.ends_with("read_file") || name.ends_with("read_text") {
            let p = args
                .get("path")
                .or_else(|| args.get("file_path"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if p.ends_with("/SKILL.md") {
                paths.push(p.to_string());
            }
        } else if name.contains("skills")
            && (name.ends_with("read") || name.ends_with("read_skill"))
        {
            let target = args
                .get("resource")
                .or_else(|| args.get("uri"))
                .or_else(|| args.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Skill");
            paths.push(target.to_string());
        }
        if paths.is_empty() {
            return;
        }
        let label: String = paths
            .iter()
            .map(|p| {
                if p.ends_with("/SKILL.md") {
                    Path::new(p)
                        .parent()
                        .and_then(|d| d.file_name())
                        .and_then(|s| s.to_str())
                        .unwrap_or(p)
                } else {
                    p.as_str()
                }
            })
            .collect::<Vec<_>>()
            .join(", ")
            .chars()
            .take(160)
            .collect();
        self.upsert_event(
            key,
            json!({
                "session_id": sid,
                "location": location_of(session),
                "provider": "Codex",
                "runtime": "Codex",
                "observed_at": vobj.get("timestamp").cloned().unwrap_or(Value::Null),
                "source": "session tool log",
                "category": "skill",
                "name": label,
                "state": "read_requested",
                "result": "not_verified",
                "next_run": Value::Null
            }),
        );
    }

    fn schedules(&self, sessions: &[Value]) -> Vec<Value> {
        let mut roots: BTreeSet<PathBuf> = BTreeSet::new();
        roots.insert(self.home.join(".claude"));
        for sv in sessions {
            let kind = sv.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            if !matches!(kind, "Claude" | "GLM") {
                continue;
            }
            if let Some(p) = sv.get("path").and_then(|v| v.as_str()) {
                for anc in Path::new(p).ancestors() {
                    if anc.file_name().and_then(|s| s.to_str()) == Some("projects") {
                        if let Some(parent) = anc.parent() {
                            roots.insert(parent.to_path_buf());
                        }
                        break;
                    }
                }
            }
        }
        let mut result = Vec::new();
        for root in roots {
            let path = root.join("scheduled_tasks.json");
            if !std::fs::metadata(&path).is_ok_and(|m| m.len() <= 1_048_576) {
                continue;
            }
            let Ok(raw) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(val) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            let Some(tasks) = val.get("tasks").and_then(|v| v.as_array()) else {
                continue;
            };
            for task in tasks.iter().take(300) {
                let Some(tobj) = task.as_object() else {
                    continue;
                };
                let (Some(id), Some(cron)) = (
                    tobj.get("id").and_then(|v| v.as_str()),
                    tobj.get("cron").and_then(|v| v.as_str()),
                ) else {
                    continue;
                };
                let creator = tobj.get("createdBySessionId").and_then(|v| v.as_str());
                let sess = creator.and_then(|cid| {
                    sessions
                        .iter()
                        .filter_map(|s| s.as_object())
                        .find(|s| s.get("id").and_then(|v| v.as_str()) == Some(cid))
                });
                result.push(json!({
                    "job_id": id.chars().take(100).collect::<String>(),
                    "schedule": cron.chars().take(100).collect::<String>(),
                    "name": "Claude Code scheduled task",
                    "state": "stored",
                    "source": "persistent schedule file",
                    "recurring": tobj.get("recurring").and_then(|v| v.as_bool()) == Some(true),
                    "last_fired_at": tobj.get("lastFiredAt").cloned().unwrap_or(Value::Null),
                    "session_connected": sess.is_some(),
                    "location": sess.map(location_of).unwrap_or_else(|| "세션 연결 미확인".into()),
                    "next_run": Value::Null,
                    "result": "not_verified"
                }));
            }
        }
        result.truncate(300);
        result
    }

    pub fn sample(&mut self, sessions: &[Value]) -> Value {
        if let (Some(ref cached), Some(last)) = (&self.cached, self.last) {
            if last.elapsed().as_secs_f64() < 10.0 {
                return cached.clone();
            }
        }
        let (mut goals, goal_status) = self.goals(sessions);
        for sv in sessions.iter().take(100) {
            if let Some(so) = sv.as_object() {
                self.scan(so);
            }
        }
        let connected: BTreeSet<&str> = sessions
            .iter()
            .filter_map(|s| s.get("id").and_then(|v| v.as_str()))
            .collect();
        for g in self.claude_goals.values_mut() {
            if let Some(go) = g.as_object_mut() {
                let tid = go.get("thread_id").and_then(|v| v.as_str()).unwrap_or("");
                go.insert("session_connected".into(), json!(connected.contains(tid)));
            }
            goals.push(g.clone());
        }
        if self.events.len() > 300 {
            self.events = self.events.split_off(self.events.len() - 300);
        }
        let rev_events: Vec<Value> = self.events.iter().rev().map(|(_, v)| v.clone()).collect();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let out = json!({
            "updated": now,
            "goals": goals,
            "goal_source_status": goal_status,
            "skills": self.skills(sessions),
            "events": rev_events,
            "schedules": self.schedules(sessions),
            "loop_state": "persistent_subset",
            "skill_runtime": "partial",
            "claude_goal_source_status": "partial_log",
            "history_scope": "Recent observed tool logs and persistent schedules; not complete history"
        });
        self.cached = Some(out.clone());
        self.last = Some(Instant::now());
        out
    }
}

fn value_to_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
