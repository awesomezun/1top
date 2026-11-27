//! Exact port of `observe/capture.py` (`capture-sessions` CLI).
#![forbid(unsafe_code)]

use onetop_core::observer::Observer;
use onetop_core::sessions::pane_thread_name;
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashMap};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

struct Anonymizer {
    tokens: HashMap<(String, String), String>,
    order: Vec<String>,
}

impl Anonymizer {
    fn new() -> Self {
        Self {
            tokens: HashMap::new(),
            order: Vec::new(),
        }
    }

    fn token(&mut self, kind: &str, value: Option<&Value>) -> Value {
        let Some(v) = value else {
            return Value::Null;
        };
        if v.is_null() {
            return Value::Null;
        }
        let s = match v {
            Value::String(s) => {
                if s.is_empty() {
                    return Value::String(String::new());
                }
                s.clone()
            }
            other => other.to_string(),
        };
        let key = (kind.to_string(), s);
        if let Some(existing) = self.tokens.get(&key) {
            return Value::String(existing.clone());
        }
        let count = 1 + self.tokens.keys().filter(|(k, _)| k == kind).count();
        let tok = format!("{kind}{count}");
        self.tokens.insert(key, tok.clone());
        self.order.push(tok.clone());
        Value::String(tok)
    }

    fn token_str(&mut self, kind: &str, value: &str) -> String {
        if value.is_empty() {
            return String::new();
        }
        let key = (kind.to_string(), value.to_string());
        if let Some(existing) = self.tokens.get(&key) {
            return existing.clone();
        }
        let count = 1 + self.tokens.keys().filter(|(k, _)| k == kind).count();
        let tok = format!("{kind}{count}");
        self.tokens.insert(key, tok.clone());
        self.order.push(tok.clone());
        tok
    }

    fn identifier(&mut self, value: Option<&Value>) -> Value {
        self.token("tab", value)
    }

    fn pane(&mut self, value: Option<&Value>) -> Value {
        let Some(s) = value.and_then(|v| v.as_str()) else {
            return value.cloned().unwrap_or(Value::Null);
        };
        if s.is_empty() || s.starts_with("structured-agent-session-") {
            return Value::String(s.to_string());
        }
        if let Some((tab, leaf)) = s.rsplit_once(':') {
            let t = self.token_str("tab", tab);
            Value::String(format!("{t}:{leaf}"))
        } else {
            Value::String(format!(":{s}"))
        }
    }
}

fn clean_transcript(val: Option<&Value>) -> Value {
    let Some(obj) = val.and_then(|v| v.as_object()) else {
        return Value::Null;
    };
    let ev_keys = [
        "t",
        "type",
        "subtype",
        "stop",
        "sidechain",
        "tool_use",
        "tool_result",
        "payload",
        "meta",
        "local",
        "interrupt",
    ];
    let events: Vec<Value> = obj
        .get("events")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    let eo = e.as_object()?;
                    let mut m = Map::new();
                    for k in ev_keys {
                        if let Some(val) = eo.get(k) {
                            m.insert(k.to_string(), val.clone());
                        }
                    }
                    Some(Value::Object(m))
                })
                .collect()
        })
        .unwrap_or_default();
    let subagents: Vec<Value> = obj
        .get("subagents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let so = s.as_object()?;
                    let mut m = clean_transcript(Some(s))
                        .as_object()
                        .cloned()
                        .unwrap_or_default();
                    if let Some(id) = so.get("id") {
                        m.insert("id".to_string(), id.clone());
                    }
                    Some(Value::Object(m))
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "mtime": obj.get("mtime").cloned().unwrap_or(Value::Null),
        "partial": obj.get("partial").and_then(|v| v.as_bool()).unwrap_or(false),
        "events": events,
        "subagents": subagents,
    })
}

pub fn anonymize(record: &Map<String, Value>) -> Value {
    let mut an = Anonymizer::new();

    let empty_vec = Vec::new();
    let empty_map = Map::new();

    let raw_procs = record
        .get("processes")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty_vec);
    let mut procs = Vec::new();
    for p in raw_procs {
        let Some(po) = p.as_object() else {
            continue;
        };
        let mut m = Map::new();
        for k in [
            "pid",
            "ppid",
            "birth",
            "tty",
            "ai",
            "argv",
            "kind",
            "role",
            "explicit_session",
            "name",
        ] {
            m.insert(k.to_string(), po.get(k).cloned().unwrap_or(Value::Null));
        }
        m.insert("config_dir".into(), an.token("C", po.get("config_dir")));
        m.insert("cwd".into(), an.token("P", po.get("cwd")));
        let mut env_out = Map::new();
        if let Some(env) = po.get("env").and_then(|v| v.as_object()) {
            for (k, v) in env {
                if k == "ORCA_TAB_ID" {
                    env_out.insert(k.clone(), an.identifier(Some(v)));
                } else {
                    env_out.insert(k.clone(), v.clone());
                }
            }
        }
        m.insert("env".into(), Value::Object(env_out));
        procs.push(Value::Object(m));
    }

    let raw_regs = record
        .get("claude_registry")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_map);
    let mut regs = Map::new();
    let mut versions = BTreeSet::new();
    for (pid, r) in raw_regs {
        let Some(ro) = r.as_object() else {
            continue;
        };
        let mut m = Map::new();
        for k in [
            "pid",
            "sessionId",
            "kind",
            "status",
            "statusUpdatedAt",
            "procStart",
            "jobId",
            "parkedJobId",
            "nameSource",
            "entrypoint",
            "waitingFor",
            "version",
        ] {
            if let Some(v) = ro.get(k) {
                m.insert(k.to_string(), v.clone());
            }
        }
        if let Some(v) = ro
            .get("version")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            versions.insert(v.to_string());
        }
        m.insert("cwd".into(), an.token("P", ro.get("cwd")));
        m.insert("name".into(), an.token("N", ro.get("name")));
        regs.insert(pid.clone(), Value::Object(m));
    }

    let raw_tr = record
        .get("claude_transcripts")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_map);
    let mut transcripts = Map::new();
    for p in raw_procs {
        let Some(po) = p.as_object() else {
            continue;
        };
        let pid_str = po
            .get("pid")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string());
        let sid = pid_str
            .as_deref()
            .and_then(|ps| raw_regs.get(ps))
            .and_then(|r| r.get("sessionId"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        if let Some(sid) = sid {
            let root = po.get("config_dir").and_then(|v| v.as_str()).unwrap_or("");
            let tok_root = an.token_str("C", root);
            let orig_key = format!("{root}:{sid}");
            let new_key = format!("{tok_root}:{sid}");
            transcripts.insert(new_key, clean_transcript(raw_tr.get(&orig_key)));
        }
    }

    let mut logs = Vec::new();
    if let Some(raw_logs) = record.get("codex_logs").and_then(|v| v.as_array()) {
        for l in raw_logs {
            let Some(lo) = l.as_object() else {
                continue;
            };
            let mut m = clean_transcript(Some(l))
                .as_object()
                .cloned()
                .unwrap_or_default();
            for k in [
                "id",
                "session_id",
                "holders",
                "is_subagent",
                "parent_session_id",
                "agent_depth",
            ] {
                m.insert(k.to_string(), lo.get(k).cloned().unwrap_or(Value::Null));
            }
            m.insert("profile".into(), an.token("C", lo.get("profile")));
            m.insert("cwd".into(), an.token("P", lo.get("cwd")));
            m.insert("title".into(), an.token("N", lo.get("title")));
            m.insert("name".into(), an.token("N", lo.get("name")));
            logs.push(Value::Object(m));
        }
    }

    let terminals = match record.get("orca_terminals").and_then(|v| v.as_array()) {
        Some(arr) => Value::Array(
            arr.iter()
                .filter_map(|t| {
                    let to = t.as_object()?;
                    Some(json!({
                        "handle": to.get("handle").cloned().unwrap_or(Value::Null),
                        "connected": to.get("connected").cloned().unwrap_or(Value::Null),
                        "leafId": to.get("leafId").cloned().unwrap_or(Value::Null),
                        "tabId": an.identifier(to.get("tabId")),
                        "title": an.token("T", to.get("title")),
                        "worktree": an.token("P", to.get("worktreePath")),
                    }))
                })
                .collect(),
        ),
        None => Value::Null,
    };

    let agents = match record.get("orca_agents").and_then(|v| v.as_array()) {
        Some(arr) => Value::Array(
            arr.iter()
                .filter_map(|a| {
                    let mut m = a.as_object()?.clone();
                    let pk = an.pane(m.get("paneKey").cloned().as_ref());
                    let nm = an.token("N", m.get("name").cloned().as_ref());
                    m.insert("paneKey".into(), pk);
                    m.insert("name".into(), nm);
                    Some(Value::Object(m))
                })
                .collect(),
        ),
        None => Value::Null,
    };

    let antigravity: Vec<Value> = record
        .get("antigravity_sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let mut m = a.as_object()?.clone();
                    let rt = an.token("C", m.get("root").cloned().as_ref());
                    let tl = an.token("N", m.get("title").cloned().as_ref());
                    m.insert("root".into(), rt);
                    m.insert("title".into(), tl);
                    Some(Value::Object(m))
                })
                .collect()
        })
        .unwrap_or_default();

    let openbot: Vec<Value> = record
        .get("openbot_agents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let ao = a.as_object()?;
                    Some(json!({
                        "workspace": an.token("P", ao.get("workspace")),
                        "name": an.token("N", ao.get("name")),
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    let mausbot: Vec<Value> = record
        .get("openmausbot_threads")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let mut m = a.as_object()?.clone();
                    let b = an.token("N", m.get("bot").cloned().as_ref());
                    m.insert("bot".into(), b);
                    Some(Value::Object(m))
                })
                .collect()
        })
        .unwrap_or_default();

    let devin: Vec<Value> = record
        .get("devin_sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let mut m = a.as_object()?.clone();
                    let cw = an.token("P", m.get("cwd").cloned().as_ref());
                    let tl = an.token("N", m.get("title").cloned().as_ref());
                    m.insert("cwd".into(), cw);
                    m.insert("title".into(), tl);
                    Some(Value::Object(m))
                })
                .collect()
        })
        .unwrap_or_default();

    let acp: Vec<Value> = record
        .get("antigravity_conversations")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let mut m = a.as_object()?.clone();
                    let cw = an.token("P", m.get("cwd").cloned().as_ref());
                    let tl = an.token("N", m.get("title").cloned().as_ref());
                    let rt = an.token("C", m.get("root").cloned().as_ref());
                    m.insert("cwd".into(), cw);
                    m.insert("title".into(), tl);
                    m.insert("root".into(), rt);
                    Some(Value::Object(m))
                })
                .collect()
        })
        .unwrap_or_default();

    let raw_panes = record
        .get("tmux_panes")
        .and_then(|v| v.as_object())
        .unwrap_or(&empty_map);
    let mut panes = Map::new();
    for p in raw_procs {
        let Some(po) = p.as_object() else {
            continue;
        };
        let Some(pane) = po
            .get("env")
            .and_then(|e| e.get("TMUX_PANE"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if let Some(title) = raw_panes.get(pane).and_then(|v| v.as_str()) {
            let cwd = po.get("cwd").and_then(|v| v.as_str()).unwrap_or("");
            let val = if let Some(name) = pane_thread_name(title, cwd) {
                format!("{} | {}", an.token_str("N", &name), an.token_str("P", cwd))
            } else {
                an.token_str("T", title)
            };
            panes.insert(pane.to_string(), Value::String(val));
        }
    }

    let aside: Vec<Value> = record
        .get("aside_sessions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let ro = r.as_object()?;
                    let mut model_out = Map::new();
                    if let Some(mo) = ro.get("model").and_then(|v| v.as_object()) {
                        for k in ["modelId", "provider", "thinkingLevel"] {
                            if let Some(v) = mo.get(k) {
                                model_out.insert(k.to_string(), v.clone());
                            }
                        }
                    }
                    Some(json!({
                        "id": ro.get("id").cloned().unwrap_or(Value::Null),
                        "status": ro.get("status").cloned().unwrap_or(Value::Null),
                        "created": ro.get("created").cloned().unwrap_or(Value::Null),
                        "updated": ro.get("updated").cloned().unwrap_or(Value::Null),
                        "parent": ro.get("parent").cloned().unwrap_or(Value::Null),
                        "running": ro.get("running").cloned().unwrap_or(Value::Null),
                        "profile": an.token("A", ro.get("profile")),
                        "db": an.token("DB", ro.get("db")),
                        "title": an.token("N", ro.get("title")),
                        "cwd": an.token("P", ro.get("cwd")),
                        "model": Value::Object(model_out),
                        "trigger": {"type": ro.get("trigger").and_then(|t| t.get("type")).cloned().unwrap_or(Value::Null)},
                        "path": Value::Null,
                        "billing_accounts": {},
                    }))
                })
                .collect()
        })
        .unwrap_or_default();

    json!({
        "schema": "onetop.session-capture.v1",
        "captured_at": record.get("captured_at").cloned().unwrap_or(Value::Null),
        "platform": record.get("platform").cloned().unwrap_or(Value::Null),
        "claude_code_versions": versions.into_iter().collect::<Vec<_>>(),
        "processes": procs,
        "claude_registry": Value::Object(regs),
        "claude_transcripts": Value::Object(transcripts),
        "codex_logs": logs,
        "orca_terminals": terminals,
        "tmux_panes": Value::Object(panes),
        "aside_sessions": aside,
        "orca_agents": agents,
        "antigravity_sessions": antigravity,
        "openbot_agents": openbot,
        "openmausbot_threads": mausbot,
        "openmausbot_running": record.get("openmausbot_running").and_then(|v| v.as_bool()).unwrap_or(false),
        "devin_sessions": devin,
        "antigravity_conversations": acp,
        "openbot_running": record.get("openbot_running").and_then(|v| v.as_bool()).unwrap_or(false),
        "devin_running": record.get("devin_running").and_then(|v| v.as_bool()).unwrap_or(false),
        "tokens": an.order,
    })
}

pub fn capture_to_file(path: &Path) -> Result<Value, String> {
    let mut obs = Observer::new(None, None);
    let record = obs.read();
    let anon = anonymize(&record);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    let mut text = serde_json::to_string_pretty(&anon).map_err(|e| e.to_string())?;
    text.push('\n');
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(anon)
}
