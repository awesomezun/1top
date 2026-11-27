use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

const CLI_NAMES: &[(&str, &str)] = &[
    ("claude", "Claude"),
    ("codex", "Codex"),
    ("gemini", "Gemini"),
    ("opencode", "OpenCode"),
    ("aider", "Aider"),
    ("goose", "Goose"),
    ("agy", "Antigravity"),
    ("qwen", "Qwen Code"),
    ("copilot", "GitHub Copilot"),
    ("droid", "Droid"),
    ("amp", "Amp"),
];

const PACKAGES: &[(&str, &str)] = &[
    ("@anthropic-ai/claude-code", "Claude"),
    ("@openai/codex", "Codex"),
    ("@google/gemini-cli", "Gemini"),
    ("@github/copilot", "GitHub Copilot"),
    ("@qwen-code/qwen-code", "Qwen Code"),
    ("opencode-ai", "OpenCode"),
];

pub const APP_NAMES: &[&str] = &[
    "Cursor",
    "Visual Studio Code",
    "Code",
    "Code - Insiders",
    "Windsurf",
    "Zed",
    "WindowsTerminal",
    "Windows Terminal",
    "powershell",
    "pwsh",
    "cmd",
    "conhost",
    "OpenConsole",
    "Antigravity",
    "Terminal",
    "iTerm",
    "iTerm2",
    "Warp",
    "Ghostty",
    "Alacritty",
    "WezTerm",
    "IntelliJ IDEA",
    "PyCharm",
    "WebStorm",
    "Orca",
    "ChatGPT",
    "Claude",
];

const CLAUDE_FLAGS: &[&str] = &[
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "--resume",
    "--continue",
    "--session-id",
    "--fork-session",
    "--allowed-tools",
    "--allowedTools",
    "--disallowed-tools",
    "--disallowedTools",
    "--permission-mode",
    "--model",
    "--effort",
    "--plugin-dir",
    "--add-dir",
    "--mcp-config",
    "--strict-mcp-config",
    "--system-prompt",
    "--append-system-prompt",
    "--settings",
    "--setting-sources",
    "--agents",
    "--agent",
    "--debug",
    "--debug-file",
    "--verbose",
    "--output-format",
    "--input-format",
    "--print",
    "-p",
    "-c",
    "-r",
    "--include-partial-messages",
    "--max-turns",
    "--max-budget-usd",
    "--tools",
    "--betas",
    "--ide",
    "--no-session-persistence",
    "--permission-prompt-tool",
    "--replay-user-messages",
    "--worktree",
    "-w",
    "--remote",
    "--teleport",
    "--from-pr",
    "--chrome",
    "--no-chrome",
];

fn sid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal
        Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}$").expect("valid sid regex")
    })
}

fn claude_ver_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal
        Regex::new(r"(?:^|/)claude/versions/\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\.exe)?$")
            .expect("valid claude version regex")
    })
}

fn app_bundle_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal
        Regex::new(r"([^/]+)\.app(?:/|$)").expect("valid app bundle regex")
    })
}

/// Exact port of `observe/processes.py:cli_kind`.
pub fn cli_kind(name: &str, args: &[String], exe: &str) -> Option<&'static str> {
    let norm = name.replace('\\', "/");
    let tail = norm.rsplit('/').next().unwrap_or("").to_lowercase();
    let base = tail.strip_suffix(".exe").unwrap_or(&tail);

    for &(k, v) in CLI_NAMES {
        if base == k {
            return Some(v);
        }
    }
    if base.starts_with("agy_acp_server") {
        return Some("Antigravity");
    }
    if base == "claude bg-spare" || base == "claude bg-pty-host" || base.starts_with("<claude ") {
        return Some("Claude");
    }
    let norm_exe = exe.replace('\\', "/");
    if claude_ver_re().is_match(&norm_exe) {
        return Some("Claude");
    }
    if matches!(base, "node" | "nodejs") || base.starts_with("python") {
        let entry = args
            .get(1)
            .map(|s| s.replace('\\', "/"))
            .unwrap_or_default();
        for &(pkg, kind) in PACKAGES {
            let needle = format!("/node_modules/{pkg}/");
            if entry.contains(&needle) {
                return Some(kind);
            }
        }
        if base.starts_with("python") && args.len() >= 3 && args[1] == "-m" && args[2] == "aider" {
            return Some("Aider");
        }
    }
    None
}

/// Exact port of `observe/processes.py:explicit_session`.
pub fn explicit_session(args: &[String]) -> Option<String> {
    let re = sid_re();
    for (i, value) in args.iter().enumerate() {
        if matches!(value.as_str(), "--resume" | "--session-id" | "resume") {
            if let Some(next) = args.get(i + 1) {
                if re.is_match(next) {
                    return Some(next.clone());
                }
            }
        }
        if let Some(rest) = value.strip_prefix("--session-id=") {
            if re.is_match(rest) {
                return Some(rest.to_string());
            }
        }
    }
    None
}

/// Exact port of `observe/processes.py:argv_shape`.
pub fn argv_shape(args: &[String]) -> Vec<String> {
    if args.is_empty() {
        return Vec::new();
    }
    let re = sid_re();
    let first = args[0].replace('\\', "/");
    let first_tail = first.rsplit('/').next().unwrap_or("");
    let head = if first.contains("/claude/versions/") {
        format!("<claude {first_tail}>")
    } else {
        first_tail.to_string()
    };
    let mut out = Vec::with_capacity(args.len());
    out.push(head);
    for value in &args[1..] {
        if value.starts_with('-') {
            out.push(value.split('=').next().unwrap_or(value).to_string());
        } else if re.is_match(value)
            || (!value.is_empty() && value.chars().all(|c| c.is_ascii_digit()))
            || matches!(
                value.as_str(),
                "run" | "daemon" | "resume" | "exec" | "app-server" | "exec-server"
            )
        {
            out.push(value.clone());
        } else if value.ends_with(".jsonl") {
            let stem = Path::new(value)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            out.push(format!("<transcript:{stem}>"));
        } else if value.starts_with('/') {
            out.push("<path>".to_string());
        } else if value.starts_with('{') {
            out.push("<json>".to_string());
        } else {
            out.push("<arg>".to_string());
        }
    }
    out
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessDescription {
    pub kind: Option<String>,
    pub role: String,
    pub explicit_session: Option<String>,
    pub include_explicit_session: bool,
}

#[derive(Debug, Default)]
pub struct DescribeInput {
    pub argv: Vec<String>,
    pub name: String,
    pub exe: String,
    pub kind: Option<String>,
    pub own_probe: bool,
    pub env: BTreeMap<String, String>,
    pub tty: String,
    pub cwd: String,
    pub provider: String,
    pub configured_model: String,
    pub explicit_session: Option<String>,
}

/// Exact port of `observe/processes.py:describe`.
pub fn describe(row: &DescribeInput) -> ProcessDescription {
    let args = &row.argv;
    let first = args
        .first()
        .map(String::as_str)
        .unwrap_or(row.name.as_str());
    let exe_arg = if row.exe.is_empty() { first } else { &row.exe };
    let mut kind = row
        .kind
        .clone()
        .or_else(|| cli_kind(first, args, exe_arg).map(String::from));

    if args
        .iter()
        .any(|a| matches!(a.as_str(), "--type" | "--monitor-self" | "--handshake-fd"))
    {
        return ProcessDescription {
            kind: None,
            role: "helper".into(),
            explicit_session: None,
            include_explicit_session: false,
        };
    }
    if row.own_probe {
        return ProcessDescription {
            kind,
            role: "helper".into(),
            explicit_session: None,
            include_explicit_session: true,
        };
    }

    let mut chat = row.env.get("ORCA_STRUCTURED_SESSION").map(String::as_str) == Some("1")
        && row
            .env
            .get("ORCA_AGENT_SESSION_ID")
            .is_some_and(|v| !v.is_empty());

    let no_tty = matches!(row.tty.as_str(), "" | "?" | "??");
    let is_claude_or_glm = matches!(kind.as_deref(), Some("Claude" | "GLM"));
    if is_claude_or_glm
        && no_tty
        && args
            .iter()
            .skip(1)
            .any(|a| a.split('=').next() == Some("--input-format"))
    {
        chat = true;
    }

    let mut role = if chat { "chat" } else { "interactive" }.to_string();

    if kind.is_some() && row.cwd.replace('\\', "/").contains("/.openmausbot/") {
        return ProcessDescription {
            kind,
            role: "helper".into(),
            explicit_session: None,
            include_explicit_session: true,
        };
    }

    if is_claude_or_glm {
        let first_base = first.rsplit('/').next().unwrap_or("");
        if matches!(first_base, "bfs" | "rg" | "ripgrep" | "ugrep" | "ug") {
            return ProcessDescription {
                kind,
                role: "helper".into(),
                explicit_session: None,
                include_explicit_session: false,
            };
        }
        let is_daemon_run = args.len() >= 3 && args[1] == "daemon" && args[2] == "run";
        if args.iter().any(|a| a == "--bg-pty-host")
            || first == "claude bg-pty-host"
            || is_daemon_run
            || args.iter().any(|a| a == "--chrome-native-host")
        {
            role = "helper".into();
        } else if args.iter().any(|a| a == "--bg-spare") || first == "claude bg-spare" {
            role = "background".into();
        } else if args.iter().any(|a| a == "--no-session-persistence")
            && no_tty
            && row
                .env
                .get("ORCA_STRUCTURED_SESSION")
                .is_none_or(String::is_empty)
        {
            role = "helper".into();
        } else if !chat {
            let has_unknown_flag = args.iter().skip(1).any(|a| {
                a.starts_with('-')
                    && !CLAUDE_FLAGS.contains(&a.split('=').next().unwrap_or(a.as_str()))
            });
            if has_unknown_flag {
                role = "shape_unknown".into();
            }
        }
        if matches!(row.provider.as_str(), "api.z.ai" | "open.bigmodel.cn")
            || row.configured_model.to_lowercase().starts_with("glm")
        {
            kind = Some("GLM".into());
        }
    } else if kind.as_deref() == Some("Codex")
        && ((args.iter().any(|a| a == "app-server") && !chat)
            || args.iter().any(|a| a == "exec-server"))
    {
        role = "helper".into();
    }

    let exp = row
        .explicit_session
        .clone()
        .or_else(|| explicit_session(args));
    ProcessDescription {
        kind,
        role,
        explicit_session: exp,
        include_explicit_session: true,
    }
}

pub fn describe_json(row: &serde_json::Map<String, serde_json::Value>) -> ProcessDescription {
    let argv: Vec<String> = row
        .get("argv")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let env: BTreeMap<String, String> = row
        .get("env")
        .and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let input = DescribeInput {
        argv,
        name: row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        exe: row
            .get("exe")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        kind: row
            .get("kind")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        own_probe: row
            .get("own_probe")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        env,
        tty: row
            .get("tty")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        cwd: row
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        provider: row
            .get("provider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        configured_model: row
            .get("configured_model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        explicit_session: row
            .get("explicit_session")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    };
    describe(&input)
}

/// Exact port of `discovery.py:app_from`.
pub fn app_from(path: &str, name: &str) -> (String, String) {
    if let Some(caps) = app_bundle_re().captures(path) {
        let app_name = caps[1].to_string();
        let app_path = format!("{}.app", path.split(".app").next().unwrap_or(""));
        return (app_name, app_path);
    }
    let base = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if APP_NAMES.contains(&base) {
        (base.to_string(), path.to_string())
    } else {
        (String::new(), String::new())
    }
}

/// Exact port of `discovery.py:registry_status`.
pub fn registry_status(status: Option<&str>) -> String {
    match status.unwrap_or("unknown") {
        "busy" | "shell" => "working".into(),
        other => other.into(),
    }
}

/// Exact port of `observe/processes.py:mark_own_probes` on generic `(pid, ppid, has_kind)` rows.
pub fn find_own_probe_pids(rows: &[(u32, u32, bool)], own: u32) -> HashSet<u32> {
    let parents: HashMap<u32, u32> = rows.iter().map(|&(pid, ppid, _)| (pid, ppid)).collect();
    let mut marked = HashSet::new();
    for &(pid, ppid, has_kind) in rows {
        if !has_kind {
            continue;
        }
        let mut parent = ppid;
        let mut seen = HashSet::new();
        while parent != 0 && seen.insert(parent) {
            if parent == own {
                marked.insert(pid);
                break;
            }
            parent = parents.get(&parent).copied().unwrap_or(0);
        }
    }
    marked
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_cli_kinds_and_apps() {
        assert_eq!(cli_kind("claude", &[], ""), Some("Claude"));
        assert_eq!(
            cli_kind(
                "node",
                &[
                    "node".into(),
                    "/opt/node_modules/@openai/codex/bin/codex.js".into()
                ],
                ""
            ),
            Some("Codex")
        );
        assert_eq!(
            cli_kind(
                "2.1.332",
                &[],
                "/Users/x/.local/share/claude/versions/2.1.332"
            ),
            Some("Claude")
        );
        assert_eq!(
            app_from("/Applications/Cursor.app/Contents/MacOS/Cursor", "Cursor"),
            ("Cursor".into(), "/Applications/Cursor.app".into())
        );
    }

    #[test]
    fn extracts_explicit_session_and_shape() {
        let args = vec![
            "/Users/k/claude/versions/2.1.0".into(),
            "--resume".into(),
            "56911751-307d-4b21-b5e4-12c11909067a".into(),
            "--model=claude-opus-5-5".into(),
            "/tmp/test.jsonl".into(),
        ];
        assert_eq!(
            explicit_session(&args).as_deref(),
            Some("56911751-307d-4b21-b5e4-12c11909067a")
        );
        assert_eq!(
            argv_shape(&args),
            vec![
                "<claude 2.1.0>",
                "--resume",
                "56911751-307d-4b21-b5e4-12c11909067a",
                "--model",
                "<transcript:test>",
            ]
        );
    }
}
