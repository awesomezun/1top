//! Complete port of `accounts.py`, `account_aliases.py`, `claude_statusline.py`,
//! `claude_profiles.py`, `credential_store.py`, `account_login.py`, and `provider_quotas.py`.
use crate::platform_support::{data_directory, home_dir};
use crate::processes::cli_kind;
use crate::sessions::sha256_hex;
use crate::telemetry::account_identity;
use crate::text::{clean_title, epoch_from_value};
use crate::weekly_usage::ProfileRootBinding;
use crate::APP_VERSION;
use base64::Engine;
use rand::RngCore;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use url::Url;

const HELPER_NAME: &str = "onetop-credential-store-v1.0.0";
const GLM_HOSTS: [&str; 2] = ["api.z.ai", "open.bigmodel.cn"];
const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_STATUSLINE_INPUT: usize = 1024 * 1024;

static ALIAS_LOCK: Mutex<()> = Mutex::new(());

fn hex32_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[0-9a-f]{32}$").unwrap())
}

fn semver_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(\d+)\.(\d+)\.(\d+)").unwrap())
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn read_json_object(path: &Path, limit: usize) -> Map<String, Value> {
    let Ok(mut f) = File::open(path) else {
        return Map::new();
    };
    let mut raw = Vec::new();
    if std::io::Read::by_ref(&mut f)
        .take((limit + 1) as u64)
        .read_to_end(&mut raw)
        .is_err()
        || raw.len() > limit
    {
        return Map::new();
    }
    serde_json::from_slice::<Value>(&raw)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

pub fn managed_profiles_dir(home: Option<&Path>) -> PathBuf {
    data_directory(home).join("accounts")
}

pub fn find_executable(name: &str) -> Option<String> {
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand.to_string_lossy().into_owned());
            }
        }
    }
    let home = home_dir();
    let mut cands = vec![
        home.join(".local/bin").join(name),
        PathBuf::from("/opt/homebrew/bin").join(name),
        PathBuf::from("/usr/local/bin").join(name),
    ];
    let nvm_pat = format!("{}/.nvm/versions/node/*/bin/{name}", home.display());
    if let Ok(paths) = glob::glob(&nvm_pat) {
        let mut nvm: Vec<PathBuf> = paths.flatten().collect();
        nvm.sort();
        nvm.reverse();
        cands.extend(nvm);
    }
    cands
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

fn clamp_pct(v: Option<&Value>) -> Option<f64> {
    let val = v?;
    if val.is_boolean() {
        return None;
    }
    let f = val.as_f64()?;
    if f.is_finite() {
        Some(f.clamp(0.0, 100.0))
    } else {
        None
    }
}

fn nonneg_num(v: Option<&Value>) -> Option<f64> {
    let val = v?;
    if val.is_boolean() {
        return None;
    }
    let f = val.as_f64()?;
    if f.is_finite() && f >= 0.0 {
        Some(f)
    } else {
        None
    }
}

fn make_window(label: &str, value: Option<&Value>, reset: Option<&Value>, now: f64) -> Value {
    let r = epoch_from_value(reset);
    let p = if r == 0.0 || r > now {
        clamp_pct(value)
    } else {
        None
    };
    json!({"label": label, "pct": p, "reset": r})
}

pub fn claude_windows(payload: &Map<String, Value>, now: f64) -> Vec<Value> {
    [("five_hour", "5H"), ("seven_day", "주간")]
        .into_iter()
        .map(|(k, label)| {
            let sub = payload.get(k).and_then(|v| v.as_object());
            make_window(
                label,
                sub.and_then(|m| m.get("utilization")),
                sub.and_then(|m| m.get("resets_at")),
                now,
            )
        })
        .collect()
}

pub fn codex_windows(result: &Map<String, Value>, now: f64) -> (Vec<Value>, Option<String>) {
    let snap = result
        .get("rateLimitsByLimitId")
        .and_then(|v| v.as_object())
        .and_then(|m| m.get("codex"))
        .or_else(|| result.get("rateLimits"))
        .and_then(|v| v.as_object());
    let valid_snap = snap.filter(|s| {
        matches!(
            s.get("limitId").and_then(|v| v.as_str()),
            None | Some("codex")
        )
    });
    let mut found: HashMap<&str, Value> = HashMap::new();
    let mut unrecognized = false;
    if let Some(s) = valid_snap {
        for key in ["primary", "secondary"] {
            let Some(wv) = s.get(key) else {
                continue;
            };
            if wv.is_null() {
                continue;
            }
            let Some(w) = wv.as_object() else {
                unrecognized = true;
                continue;
            };
            match w.get("windowDurationMins").and_then(|v| v.as_i64()) {
                Some(300) => {
                    found.insert(
                        "5H",
                        make_window("5H", w.get("usedPercent"), w.get("resetsAt"), now),
                    );
                }
                Some(10080) => {
                    found.insert(
                        "주간",
                        make_window("주간", w.get("usedPercent"), w.get("resetsAt"), now),
                    );
                }
                _ => unrecognized = true,
            }
        }
    }
    let plan = valid_snap
        .and_then(|s| s.get("planType"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    if !found.is_empty() && !unrecognized {
        let out = ["5H", "주간"]
            .into_iter()
            .filter_map(|l| found.remove(l))
            .collect();
        (out, plan)
    } else {
        let out = ["5H", "주간"]
            .into_iter()
            .map(|l| {
                found
                    .remove(l)
                    .unwrap_or_else(|| make_window(l, None, None, now))
            })
            .collect();
        (out, plan)
    }
}

// ---------------- account_aliases ----------------

pub fn read_aliases(data: &Path) -> BTreeMap<String, String> {
    let obj = read_json_object(&data.join("account-aliases-v1.json"), 32768);
    obj.into_iter()
        .filter_map(|(k, v)| {
            let s = v.as_str()?;
            if s.chars().count() <= 24 {
                Some((k, s.to_string()))
            } else {
                None
            }
        })
        .collect()
}

pub fn apply_aliases(rows: &mut [Value], data: &Path) {
    let aliases = read_aliases(data);
    for row in rows.iter_mut() {
        if let Some(ro) = row.as_object_mut() {
            let id = ro.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let fallback: String = ro
                .get("pool")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .chars()
                .take(24)
                .collect();
            let alias = aliases.get(id).cloned().unwrap_or(fallback);
            ro.insert("alias".into(), json!(alias));
        }
    }
}

pub fn set_alias(
    data: &Path,
    account_id: &str,
    alias: &str,
    account_ids: &HashSet<String>,
) -> Result<String, &'static str> {
    if !account_ids.contains(account_id) {
        return Err("Unknown account.");
    }
    let trimmed = alias.trim();
    if trimmed.chars().count() > 24
        || alias
            .chars()
            .any(|c| (c as u32) < 32 || ((c as u32) >= 127 && (c as u32) < 160))
    {
        return Err("Use an account name of up to 24 characters, without control characters.");
    }
    let _g = ALIAS_LOCK.lock();
    let mut values = read_aliases(data);
    if !trimmed.is_empty() {
        values.insert(account_id.to_string(), trimmed.to_string());
    } else {
        values.remove(account_id);
    }
    let path = data.join("account-aliases-v1.json");
    let _ = std::fs::create_dir_all(data);
    let tmp = path.with_extension("tmp");
    let raw = serde_json::to_string(&values).unwrap_or_else(|_| "{}".into());
    std::fs::write(&tmp, raw).map_err(|_| "Write failed")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|_| "Write failed")?;
    Ok(trimmed.to_string())
}

// ---------------- claude_statusline ----------------

fn valid_literal(val: Option<&Value>, limit: usize) -> Option<String> {
    let s = val?.as_str()?;
    if s.is_empty()
        || s.chars().count() > limit
        || s.trim() != s
        || s.chars().any(|c| (c as u32) < 32)
    {
        return None;
    }
    Some(s.to_string())
}

fn claude_config_path(root: &Path) -> PathBuf {
    let default_root = home_dir().join(".claude");
    let canon_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let canon_def = std::fs::canonicalize(&default_root).unwrap_or(default_root);
    if canon_root == canon_def {
        home_dir().join(".claude.json")
    } else {
        root.join(".claude.json")
    }
}

fn statusline_account(root: &Path) -> Option<(String, String)> {
    let cfg = read_json_object(&claude_config_path(root), 8 * 1024 * 1024);
    let acct = cfg.get("oauthAccount")?.as_object()?;
    let uuid = acct.get("accountUuid")?.as_str()?;
    let org = acct
        .get("organizationUuid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if uuid.is_empty() || uuid.len() > 256 || org.len() > 256 {
        return None;
    }
    let ident = account_identity("Claude", uuid, org);
    let plan: String = acct
        .get("seatTier")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .chars()
        .take(80)
        .collect();
    Some((ident, plan))
}

pub fn sanitize_limits(payload: &Map<String, Value>) -> Map<String, Value> {
    let mut windows = Map::new();
    let Some(val) = payload.get("rate_limits").and_then(|v| v.as_object()) else {
        return windows;
    };
    for name in ["five_hour", "seven_day"] {
        let Some(win) = val.get(name).and_then(|v| v.as_object()) else {
            continue;
        };
        let Some(used) = nonneg_num(win.get("used_percentage")).filter(|&u| u <= 100.0) else {
            continue;
        };
        let mut res = Map::new();
        res.insert("used_percentage".into(), json!(used));
        if let Some(rv) = win.get("resets_at") {
            let Some(reset) = nonneg_num(Some(rv)).filter(|&r| r < 1e12) else {
                continue;
            };
            res.insert("resets_at".into(), json!(reset));
        }
        windows.insert(name.into(), Value::Object(res));
    }
    windows
}

fn write_atomic_json(path: &Path, report: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    let body = serde_json::to_string(report).unwrap_or_else(|_| "{}".into());
    std::fs::write(&tmp, body)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn capture_statusline(
    payload: &Value,
    profile: Option<&str>,
    directory: Option<&Path>,
    now: Option<f64>,
) -> Option<PathBuf> {
    let p_obj = payload.as_object()?;
    let session = p_obj.get("session_id")?.as_str()?;
    if session.is_empty() || session.len() > 160 || session.chars().any(|c| (c as u32) < 32) {
        return None;
    }
    let raw_root = std::env::var("CLAUDE_CONFIG_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| profile.map(str::to_string))
        .unwrap_or_else(|| home_dir().join(".claude").to_string_lossy().into_owned());
    let root_pb = if let Some(rest) = raw_root.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(&raw_root)
    };
    let root = std::fs::canonicalize(&root_pb).unwrap_or(root_pb);
    let root_str = root.to_string_lossy().into_owned();
    let now = now.unwrap_or_else(now_epoch);
    if !now.is_finite() || now <= 0.0 {
        return None;
    }
    let dir = directory
        .map(Path::to_path_buf)
        .unwrap_or_else(|| data_directory(None).join("claude-statusline"));

    // Independent session effort/model capture
    if let Some(parent) = dir.parent() {
        let target = parent.join("claude-statusline-sessions");
        if !target.is_symlink() {
            let _ = std::fs::create_dir_all(&target);
            let eff = p_obj
                .get("effort")
                .and_then(|v| v.as_object())
                .and_then(|m| valid_literal(m.get("level"), 64));
            let model = p_obj
                .get("model")
                .and_then(|v| v.as_object())
                .and_then(|m| valid_literal(m.get("id"), 256));
            let key = sha256_hex(format!("{root_str}|{session}").as_bytes());
            let rep = json!({
                "schema": 1,
                "profile": root_str,
                "session_id": session,
                "updated": now,
                "effort": eff,
                "model": model
            });
            let _ = write_atomic_json(&target.join(format!("{key}.json")), &rep);
        }
    }

    let limits = sanitize_limits(p_obj);
    if limits.is_empty() {
        return None;
    }
    let (mut account_id, mut plan) = statusline_account(&root)?;
    let initial_account = (account_id.clone(), plan.clone());
    if dir.is_symlink() {
        return None;
    }
    let _ = std::fs::create_dir_all(&dir);
    let key = sha256_hex(format!("{root_str}|{session}").as_bytes());
    let path = dir.join(format!("{key}.json"));
    let previous = read_json_object(&path, 64 * 1024);

    if previous.get("schema").and_then(|v| v.as_i64()) == Some(1)
        && previous.get("profile").and_then(|v| v.as_str()) == Some(root_str.as_str())
        && previous.get("session_id").and_then(|v| v.as_str()) == Some(session)
        && previous.get("account_id").and_then(|v| v.as_str()) != Some(account_id.as_str())
    {
        let work = p_obj
            .get("cost")
            .and_then(|c| c.get("total_api_duration_ms"))
            .and_then(|v| nonneg_num(Some(v)));
        let prior_work = nonneg_num(previous.get("api_work_ms"));
        let reset = limits
            .get("seven_day")
            .and_then(|s| s.get("resets_at"))
            .and_then(|v| nonneg_num(Some(v)));
        let prior_reset = previous
            .get("rl")
            .and_then(|r| r.get("seven_day"))
            .and_then(|s| s.get("resets_at"))
            .and_then(|v| nonneg_num(Some(v)));
        let continuing = previous.get("verified_activity").and_then(|v| v.as_bool()) == Some(true)
            && work.is_some()
            && prior_work.is_some()
            && work > prior_work
            && reset.is_some_and(|r| r > now)
            && prior_reset.is_some_and(|pr| (reset.unwrap() - pr).abs() <= 60.0);
        if continuing {
            account_id = previous
                .get("account_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            plan = previous
                .get("plan")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        } else {
            // Check verified switch or write pending
            let pending_path = dir.join(format!("{key}.pending"));
            let pending = read_json_object(&pending_path, 64 * 1024);
            let same_cycle = pending
                .get("rl")
                .and_then(|r| r.get("seven_day"))
                .and_then(|s| s.get("resets_at"))
                .and_then(|v| v.as_f64())
                == reset;
            let since = if same_cycle {
                pending
                    .get("account_since")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(now)
            } else {
                now
            };
            let _ = write_atomic_json(
                &pending_path,
                &json!({
                    "schema": 1,
                    "observed_at": now,
                    "t": now,
                    "account_since": since,
                    "profile": root_str,
                    "session_id": session,
                    "rl": limits
                }),
            );
            return None;
        }
    }

    let same = previous.get("schema").and_then(|v| v.as_i64()) == Some(1)
        && previous.get("profile").and_then(|v| v.as_str()) == Some(root_str.as_str())
        && previous.get("account_id").and_then(|v| v.as_str()) == Some(account_id.as_str())
        && previous.get("session_id").and_then(|v| v.as_str()) == Some(session);
    let work = p_obj
        .get("cost")
        .and_then(|c| c.get("total_api_duration_ms"))
        .and_then(|v| nonneg_num(Some(v)));
    let prior_work = if same {
        nonneg_num(previous.get("api_work_ms"))
    } else {
        None
    };
    let prior_t = if same {
        previous.get("t").and_then(|v| v.as_f64())
    } else {
        None
    };
    let valid_prev = prior_t.is_some_and(|pt| pt.is_finite() && pt > 0.0 && pt <= now);
    let limits_val = Value::Object(limits);
    let activity = same
        && valid_prev
        && (previous.get("rl") != Some(&limits_val)
            || (work.is_some() && prior_work.is_some() && work > prior_work));
    let changed = !valid_prev || activity;
    let verified = activity
        || (same
            && valid_prev
            && previous.get("verified_activity").and_then(|v| v.as_bool()) == Some(true));
    let t_val = if changed { now } else { prior_t.unwrap() };
    let account_since = if same && valid_prev {
        previous
            .get("account_since")
            .and_then(|v| v.as_f64())
            .unwrap_or_else(|| prior_t.unwrap())
    } else {
        now
    };

    let mut report = json!({
        "schema": 1,
        "source": "claude_statusline",
        "verified_activity": verified,
        "t": t_val,
        "observed_at": now,
        "profile": root_str,
        "account_id": account_id,
        "session_id": session,
        "plan": plan,
        "rl": limits_val,
        "account_since": account_since
    });
    if let Some(mx) = match (work, prior_work) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    } {
        report
            .as_object_mut()
            .unwrap()
            .insert("api_work_ms".into(), json!(mx));
    }

    if statusline_account(&root).as_ref() != Some(&initial_account) {
        return None;
    }
    if write_atomic_json(&path, &report).is_err() {
        return None;
    }
    let _ = std::fs::remove_file(dir.join(format!("{key}.pending")));
    Some(path)
}

pub fn run_statusline_cli(config_path: &Path) -> i32 {
    let config = read_json_object(config_path, 64 * 1024);
    let command = config
        .get("original_command")
        .and_then(|v| v.as_str())
        .filter(|s| s.len() <= 48 * 1024)
        .unwrap_or("")
        .to_string();

    let mut raw = Vec::new();
    let mut stdin = std::io::stdin().lock();
    let _ = stdin
        .by_ref()
        .take((MAX_STATUSLINE_INPUT + 1) as u64)
        .read_to_end(&mut raw);
    if raw.len() <= MAX_STATUSLINE_INPUT {
        if let Ok(payload) = serde_json::from_slice::<Value>(&raw) {
            let dir_opt = config
                .get("report_directory")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .filter(|p| p.is_absolute());
            let _ = capture_statusline(
                &payload,
                config.get("profile").and_then(|v| v.as_str()),
                dir_opt.as_deref(),
                None,
            );
        }
    }
    if command.is_empty() {
        return 0;
    }
    let depth: i32 = std::env::var("ONETOP_STATUSLINE_DEPTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    if depth >= 4 {
        return 0;
    }
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd.exe");
        c.args(["/d", "/s", "/c", &command]);
        c
    } else {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", &command]);
        c
    };
    cmd.env("ONETOP_STATUSLINE_DEPTH", (depth + 1).to_string())
        .stdin(Stdio::piped());
    let Ok(mut child) = cmd.spawn() else {
        return 0;
    };
    if let Some(mut cstdin) = child.stdin.take() {
        let _ = cstdin.write_all(&raw);
    }
    child.wait().ok().and_then(|s| s.code()).unwrap_or(0)
}

pub fn claude_statusline_report(root: &Path, key: &str, now: f64) -> Option<Map<String, Value>> {
    let canon_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let dir = data_directory(None).join("claude-statusline");
    let pat = format!("{}/*.json", dir.display());
    let mut latest: Option<Map<String, Value>> = None;
    for path in glob::glob(&pat).ok()?.flatten().take(4096) {
        if path.is_symlink() {
            continue;
        }
        let report = read_json_object(&path, 16 * 1024);
        if report.get("schema").and_then(|v| v.as_i64()) != Some(1) {
            continue;
        }
        if report.get("source").and_then(|v| v.as_str()) != Some("claude_statusline")
            || report.get("account_id").and_then(|v| v.as_str()) != Some(key)
        {
            continue;
        }
        let Some(prof) = report.get("profile").and_then(|v| v.as_str()) else {
            continue;
        };
        let prof_p = Path::new(prof);
        if !prof_p.is_absolute() {
            continue;
        }
        let Ok(canon_prof) = std::fs::canonicalize(prof_p) else {
            continue;
        };
        if canon_prof != canon_root {
            continue;
        }
        let Some(sess) = report.get("session_id").and_then(|v| v.as_str()) else {
            continue;
        };
        if sess.is_empty() || sess.len() > 1024 {
            continue;
        }
        let Some(reported) = nonneg_num(report.get("t")).filter(|&t| t > 0.0 && t <= now + 5.0)
        else {
            continue;
        };
        let Some(limits) = report.get("rl").and_then(|v| v.as_object()) else {
            continue;
        };
        let mut windows = Vec::new();
        for (name, label) in [("five_hour", "5H"), ("seven_day", "주간")] {
            let Some(val) = limits.get(name).and_then(|v| v.as_object()) else {
                continue;
            };
            let Some(used) = nonneg_num(val.get("used_percentage")).filter(|&u| u <= 100.0) else {
                continue;
            };
            let Some(reset) = nonneg_num(val.get("resets_at")).filter(|&r| r > 0.0) else {
                continue;
            };
            windows.push(make_window(
                label,
                Some(&json!(used)),
                Some(&json!(reset)),
                now,
            ));
        }
        if windows.is_empty() {
            continue;
        }
        let prev_upd = latest
            .as_ref()
            .and_then(|m| m.get("updated"))
            .and_then(|v| v.as_f64())
            .unwrap_or(-1.0);
        if reported > prev_upd {
            let mut m = Map::new();
            m.insert("windows".into(), Value::Array(windows));
            m.insert("updated".into(), json!(reported));
            m.insert("source".into(), json!("claude_statusline"));
            m.insert(
                "verified_activity".into(),
                json!(report.get("verified_activity").and_then(|v| v.as_bool()) == Some(true)),
            );
            latest = Some(m);
        }
    }
    latest
}

pub fn matching_quota(limits: &Map<String, Value>, quotas: &[Value], now: f64) -> Option<String> {
    if !limits.get("seven_day").is_some_and(|v| v.is_object()) {
        return None;
    }
    let mut matches: HashSet<String> = HashSet::new();
    for row in quotas {
        let Some(ro) = row.as_object() else {
            continue;
        };
        if ro.get("kind").and_then(|v| v.as_str()) != Some("Claude")
            || ro.get("stale").and_then(|v| v.as_bool()).unwrap_or(true)
        {
            continue;
        }
        let upd = ro.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let age = now - upd;
        if !(0.0..=300.0).contains(&age) {
            continue;
        }
        let wins: HashMap<&str, &Map<String, Value>> = ro
            .get("windows")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|w| w.as_object())
                    .filter_map(|w| Some((w.get("label")?.as_str()?, w)))
                    .collect()
            })
            .unwrap_or_default();
        let mut valid = true;
        for (name, label) in [("seven_day", "주간"), ("five_hour", "5H")] {
            let Some(obs) = limits.get(name).and_then(|v| v.as_object()) else {
                continue;
            };
            let known = wins.get(label).copied();
            let (Some(r), Some(p), Some(kr), Some(kp)) = (
                nonneg_num(obs.get("resets_at")),
                nonneg_num(obs.get("used_percentage")),
                known.and_then(|k| nonneg_num(k.get("reset"))),
                known.and_then(|k| nonneg_num(k.get("pct"))),
            ) else {
                valid = false;
                break;
            };
            if r <= now || (r - kr).abs() > 60.0 || (p - kp).abs() > 1.0 {
                valid = false;
                break;
            }
        }
        if valid {
            if let Some(id) = ro.get("id").and_then(|v| v.as_str()) {
                matches.insert(id.to_string());
            }
        }
    }
    if matches.len() == 1 {
        matches.into_iter().next()
    } else {
        None
    }
}

pub fn session_statusline_binding(
    spec: &mut Map<String, Value>,
    now: f64,
    quotas: Option<&[Value]>,
) -> Option<(String, f64)> {
    if spec.get("kind").and_then(|v| v.as_str()) != Some("Claude") {
        return None;
    }
    let cdir = spec
        .get("config_dir")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())?;
    let root_pb = if let Some(rest) = cdir.strip_prefix("~/") {
        home_dir().join(rest)
    } else {
        PathBuf::from(cdir)
    };
    let root = std::fs::canonicalize(&root_pb).unwrap_or(root_pb);
    let root_str = root.to_string_lossy().into_owned();
    let sid = spec
        .get("active_session_id")
        .or_else(|| spec.get("id"))
        .and_then(|v| v.as_str())?;
    let key = sha256_hex(format!("{root_str}|{sid}").as_bytes());
    let dir = data_directory(None).join("claude-statusline");
    let report = read_json_object(&dir.join(format!("{key}.json")), 64 * 1024);

    if let Some(qslice) = quotas {
        let pending = read_json_object(&dir.join(format!("{key}.pending")), 64 * 1024);
        let pending_at = nonneg_num(pending.get("observed_at"));
        let report_at = nonneg_num(report.get("observed_at").or_else(|| report.get("t")));
        let obs = match (pending_at, report_at) {
            (Some(pa), Some(ra)) if pa >= ra => &pending,
            (Some(_), None) => &pending,
            _ => &report,
        };
        let observed = nonneg_num(obs.get("observed_at"));
        let valid_obs = obs.get("schema").and_then(|v| v.as_i64()) == Some(1)
            && obs.get("profile").and_then(|v| v.as_str()) == Some(root_str.as_str())
            && obs.get("session_id").and_then(|v| v.as_str()) == Some(sid)
            && observed.is_some_and(|o| now - o >= 0.0 && now - o <= 300.0);
        let matched = if valid_obs {
            obs.get("rl")
                .and_then(|v| v.as_object())
                .and_then(|rl| matching_quota(rl, qslice, now))
        } else {
            None
        };
        if let Some(m) = matched {
            spec.insert("account_binding_uncertain".into(), json!(false));
            spec.insert(
                "account_binding_evidence".into(),
                json!("provider_quota_cycle"),
            );
            let obs_t = observed.unwrap_or(now);
            let since = if Some(m.as_str()) == report.get("account_id").and_then(|v| v.as_str()) {
                nonneg_num(report.get("account_since").or_else(|| report.get("t"))).unwrap_or(now)
            } else {
                nonneg_num(obs.get("account_since")).unwrap_or(obs_t)
            };
            let s = if since > 0.0 && since <= now {
                since
            } else {
                obs_t
            };
            return Some((m, s));
        }
        let current = statusline_account(&root);
        let switched = current.is_some_and(|(cid, _)| {
            Some(cid.as_str()) != report.get("account_id").and_then(|v| v.as_str())
        });
        if !pending.is_empty()
            || (switched && nonneg_num(report.get("t")).is_some_and(|rt| now - rt > 900.0))
        {
            spec.insert("account_binding_uncertain".into(), json!(true));
            return None;
        }
    }

    if report.get("schema").and_then(|v| v.as_i64()) != Some(1)
        || report.get("session_id").and_then(|v| v.as_str()) != Some(sid)
        || report.get("profile").and_then(|v| v.as_str()) != Some(root_str.as_str())
        || report.get("verified_activity").and_then(|v| v.as_bool()) != Some(true)
    {
        return None;
    }
    let rt = nonneg_num(report.get("t")).filter(|&t| t > 0.0 && t <= now)?;
    let aid = valid_literal(report.get("account_id"), 128)?;
    let since = nonneg_num(report.get("account_since"))
        .filter(|&s| s > 0.0 && s <= now)
        .unwrap_or(rt);
    Some((aid, since))
}

// ---------------- credential_store & claude_profiles ----------------

pub fn claude_service_name(root: &Path) -> String {
    let default_root = home_dir().join(".claude");
    let canon_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let canon_def = std::fs::canonicalize(&default_root).unwrap_or(default_root);
    if canon_root == canon_def {
        "Claude Code-credentials".into()
    } else {
        let hash = sha256_hex(canon_root.to_string_lossy().as_bytes());
        format!("Claude Code-credentials-{}", &hash[..8])
    }
}

pub fn is_managed_claude(root: &Path) -> bool {
    if root.is_symlink() {
        return false;
    }
    let canon = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mdir = managed_profiles_dir(None).join("claude");
    let canon_m = std::fs::canonicalize(&mdir).unwrap_or(mdir);
    canon.parent() == Some(canon_m.as_path())
}

pub fn credential_helper_path() -> Option<PathBuf> {
    let path = data_directory(None).join("tools").join(HELPER_NAME);
    if path.is_file() && !path.is_symlink() {
        Some(path)
    } else {
        None
    }
}

pub fn install_credential_helper() -> Result<PathBuf, &'static str> {
    if let Some(p) = credential_helper_path() {
        return Ok(p);
    }
    let exe = std::env::current_exe().map_err(|_| "helper_unavailable")?;
    let packaged = exe.parent().ok_or("helper_unavailable")?.join(HELPER_NAME);
    if !packaged.is_file() {
        return Err("helper_unavailable");
    }
    let dst = data_directory(None).join("tools").join(HELPER_NAME);
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::copy(&packaged, &dst).map_err(|_| "helper_unavailable")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dst, std::fs::Permissions::from_mode(0o500));
    }
    Ok(dst)
}

pub fn invoke_credential_helper(
    root: &Path,
    action: &str,
    document: Option<&Value>,
    interactive: bool,
) -> Result<Option<Value>, &'static str> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    if interactive != (action == "authorize") {
        return Err("invalid_operation");
    }
    let helper = if interactive {
        install_credential_helper()?
    } else {
        match credential_helper_path() {
            Some(p) => p,
            None => return Ok(None),
        }
    };
    let Some((key, _)) = statusline_account(root) else {
        return if action == "get" {
            Ok(None)
        } else {
            Err("login_required")
        };
    };
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_default();
    let mut cmd = Command::new(helper);
    cmd.arg(action).arg(claude_service_name(root)).arg(user);
    if interactive {
        cmd.arg(&key);
    }
    cmd.stdin(if document.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    })
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|_| "credential_store_unavailable")?;
    if let Some(doc) = document {
        let payload = json!({"schema": 1, "account_id": key, "document": doc}).to_string();
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(payload.as_bytes());
        }
    }
    let out = child
        .wait_with_output()
        .map_err(|_| "credential_store_unavailable")?;
    if !out.status.success() || out.stdout.len() > 128 * 1024 {
        return Err("credential_store_unavailable");
    }
    let val: Value =
        serde_json::from_slice(&out.stdout).map_err(|_| "credential_store_unavailable")?;
    let Some(obj) = val.as_object() else {
        return Err("credential_store_unavailable");
    };
    if obj.get("missing").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(None);
    }
    if action == "get" {
        if obj.get("account_id").and_then(|v| v.as_str()) != Some(key.as_str()) {
            return Ok(None);
        }
        return Ok(obj.get("document").filter(|v| v.is_object()).cloned());
    }
    Ok(Some(val))
}

pub fn authorize_claude_profile(root: &Path) -> Result<Value, &'static str> {
    if !cfg!(target_os = "macos") || !is_managed_claude(root) {
        return Err("managed_profile_required");
    }
    invoke_credential_helper(root, "authorize", None, true)?.ok_or("credential_store_unavailable")
}

pub fn claude_credentials(root: &Path) -> Result<Map<String, Value>, &'static str> {
    if let Ok(Some(doc)) = invoke_credential_helper(root, "get", None, false) {
        if let Some(oauth) = doc.get("claudeAiOauth").and_then(|v| v.as_object()) {
            return Ok(oauth.clone());
        }
    }
    let fallback = read_json_object(&root.join(".credentials.json"), MAX_JSON_BYTES)
        .get("claudeAiOauth")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if !fallback.is_empty() {
        let exp = epoch_from_value(fallback.get("expiresAt"));
        if exp == 0.0
            || exp > now_epoch()
            || (is_managed_claude(root)
                && fallback
                    .get("refreshToken")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty()))
        {
            return Ok(fallback);
        }
    }
    Err("credential_store_unavailable")
}

fn claude_refresh_request(
    credentials: &Map<String, Value>,
) -> Result<Map<String, Value>, &'static str> {
    let refresh_token = credentials
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("login_required")?;
    let mut body = json!({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
    });
    if let Some(scopes) = credentials.get("scopes").and_then(|v| v.as_array()) {
        let joined: Vec<&str> = scopes.iter().filter_map(|v| v.as_str()).collect();
        if !joined.is_empty() {
            body.as_object_mut()
                .unwrap()
                .insert("scope".into(), json!(joined.join(" ")));
        }
    }
    let client = blocking_http_client(15);
    let resp = client
        .post("https://platform.claude.com/v1/oauth/token")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("User-Agent", format!("1top/{APP_VERSION}"))
        .json(&body)
        .send()
        .map_err(|_| "provider_unavailable")?;
    let status = resp.status().as_u16();
    if status >= 400 {
        let code = match status {
            400 | 401 => "login_required",
            403 => "access_denied",
            429 => "rate_limited",
            _ => "provider_unavailable",
        };
        return Err(code);
    }
    let bytes = resp.bytes().map_err(|_| "provider_unavailable")?;
    if bytes.len() > 128 * 1024 {
        return Err("invalid_response");
    }
    let obj = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .ok_or("invalid_response")?;
    let ok_tok = obj
        .get("access_token")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());
    let ok_exp = obj
        .get("expires_in")
        .and_then(|v| v.as_f64())
        .is_some_and(|e| e.is_finite() && e > 0.0 && e < 366.0 * 86400.0);
    if !ok_tok || !ok_exp {
        return Err("invalid_response");
    }
    Ok(obj)
}

pub fn refresh_managed_claude(
    root: &Path,
    now: f64,
    force: bool,
) -> Result<Map<String, Value>, &'static str> {
    if !is_managed_claude(root) {
        return Err("login_expired");
    }
    let lock_path = root.join(".1top-refresh.lock");
    let mut open_opts = std::fs::OpenOptions::new();
    open_opts.create(true).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open_opts.mode(0o600);
    }
    let lock_file = open_opts.open(&lock_path).map_err(|_| "refresh_pending")?;
    lock_file.try_lock().map_err(|_| "refresh_pending")?;

    let current = claude_credentials(root)?;
    let cur_tok = current
        .get("accessToken")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let cur_exp = epoch_from_value(current.get("expiresAt"));
    if !force && !cur_tok.is_empty() && cur_exp > now + 60.0 {
        return Ok(current);
    }
    if current
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .is_none_or(str::is_empty)
    {
        return Err("login_required");
    }
    let cfg_path = root.join(".claude.json");
    let before_acct = read_json_object(&cfg_path, 8 * 1024 * 1024)
        .get("oauthAccount")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let acct_uuid = before_acct
        .get("accountUuid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or("login_required")?
        .to_string();
    let org_uuid = before_acct
        .get("organizationUuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let result = claude_refresh_request(&current)?;

    let after_acct = read_json_object(&cfg_path, 8 * 1024 * 1024)
        .get("oauthAccount")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if after_acct.get("accountUuid").and_then(|v| v.as_str()) != Some(acct_uuid.as_str())
        || after_acct
            .get("organizationUuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            != org_uuid.as_str()
    {
        return Err("account_changed");
    }
    if claude_credentials(root).ok().as_ref() != Some(&current) {
        return Err("refresh_pending");
    }

    let mut renewed = current.clone();
    renewed.insert(
        "accessToken".into(),
        result.get("access_token").cloned().unwrap(),
    );
    if let Some(rt) = result
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        renewed.insert("refreshToken".into(), json!(rt));
    }
    let expires_in = result
        .get("expires_in")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let expires_at_ms = ((now_epoch() + expires_in) * 1000.0) as i64;
    renewed.insert("expiresAt".into(), json!(expires_at_ms));
    if let Some(scope_str) = result.get("scope").and_then(|v| v.as_str()) {
        let scopes: Vec<Value> = scope_str.split_whitespace().map(|s| json!(s)).collect();
        renewed.insert("scopes".into(), Value::Array(scopes));
    }

    if let Ok(Some(mut enrolled_doc)) = invoke_credential_helper(root, "get", None, false) {
        if let Some(obj) = enrolled_doc.as_object_mut() {
            obj.insert("claudeAiOauth".into(), Value::Object(renewed.clone()));
            invoke_credential_helper(root, "set", Some(&enrolled_doc), false)?;
            return Ok(renewed);
        }
    }

    let cred_path = root.join(".credentials.json");
    let mut doc = read_json_object(&cred_path, MAX_JSON_BYTES);
    if doc.get("claudeAiOauth").and_then(|v| v.as_object()) != Some(&current) {
        return Err("credential_store_unavailable");
    }
    doc.insert("claudeAiOauth".into(), Value::Object(renewed.clone()));
    write_atomic_json(&cred_path, &Value::Object(doc))
        .map_err(|_| "credential_store_unavailable")?;
    Ok(renewed)
}

fn blocking_http_client(timeout_secs: u64) -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .expect("http client")
}

pub fn claude_api(token: &str, resource: &str) -> Result<Map<String, Value>, (u16, &'static str)> {
    if resource != "usage" && resource != "profile" {
        return Err((400, "invalid_resource"));
    }
    let client = blocking_http_client(8);
    let url = format!("https://api.anthropic.com/api/oauth/{resource}");
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", format!("1top/{APP_VERSION}"))
        .header("Accept", "application/json")
        .header("Cache-Control", "no-cache")
        .send()
        .map_err(|_| (0, "provider_unavailable"))?;
    let status = resp.status().as_u16();
    if status >= 400 {
        let code = match status {
            401 => "login_required",
            403 => "access_denied",
            429 => "rate_limited",
            _ => "provider_unavailable",
        };
        return Err((status, code));
    }
    let bytes = resp.bytes().map_err(|_| (0, "provider_unavailable"))?;
    if bytes.len() > 512 * 1024 {
        return Err((0, "invalid_response"));
    }
    serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .ok_or((0, "invalid_response"))
}

pub fn claude_identity_from_token(token: &str) -> Result<String, (u16, &'static str)> {
    let profile = claude_api(token, "profile")?;
    let acct = profile
        .get("account")
        .and_then(|v| v.as_object())
        .and_then(|a| a.get("uuid"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or((0, "invalid_response"))?;
    let org = profile
        .get("organization")
        .and_then(|v| v.as_object())
        .and_then(|o| o.get("uuid"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or((0, "invalid_response"))?;
    Ok(account_identity("Claude", acct, org))
}

#[allow(clippy::type_complexity)]
pub fn codex_rpc(
    root: &Path,
    refresh: bool,
) -> Result<(Map<String, Value>, Map<String, Value>), &'static str> {
    let exe = find_executable("codex").ok_or("codex_unavailable")?;
    let mut path_env = std::env::var("PATH").unwrap_or_default();
    if let Some(parent) = Path::new(&exe).parent() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        path_env = format!("{}{sep}{path_env}", parent.display());
    }
    let mut child = Command::new(&exe)
        .arg("app-server")
        .env("CODEX_HOME", root)
        .env("PATH", path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "codex_unavailable")?;

    let mut stdin = child.stdin.take().ok_or("codex_unavailable")?;
    let stdout = child.stdout.take().ok_or("codex_unavailable")?;
    let mut reader = BufReader::new(stdout);

    let send = |stdin: &mut std::process::ChildStdin,
                rid: Option<u64>,
                method: &str,
                params: Value|
     -> Result<(), &'static str> {
        let mut msg = json!({"method": method, "params": params});
        if let Some(id) = rid {
            msg.as_object_mut().unwrap().insert("id".into(), json!(id));
        }
        let line = format!("{msg}\n");
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|_| "rpc_write_failed")
    };

    let res = (|| {
        send(
            &mut stdin,
            Some(1),
            "initialize",
            json!({"clientInfo": {"name": "onetop_usage", "version": "2.1.0"}}),
        )?;
        let deadline = Instant::now() + Duration::from_secs(18);
        let mut results: HashMap<u64, Map<String, Value>> = HashMap::new();
        let mut line = String::new();
        while Instant::now() < deadline {
            line.clear();
            let n = reader.read_line(&mut line).map_err(|_| "rpc_read_failed")?;
            if n == 0 {
                break;
            }
            if line.len() > 1024 * 1024 {
                return Err("oversized_rpc");
            }
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(rid) = msg.get("id").and_then(|v| v.as_u64()) else {
                continue;
            };
            if rid == 1 {
                if msg.get("error").is_some() {
                    return Err("init_failed");
                }
                send(&mut stdin, None, "initialized", json!({}))?;
                send(
                    &mut stdin,
                    Some(2),
                    "account/read",
                    json!({"refreshToken": refresh}),
                )?;
                send(&mut stdin, Some(3), "account/rateLimits/read", Value::Null)?;
            } else if rid == 2 || rid == 3 {
                if msg.get("error").is_some() {
                    return Err("usage_unavailable");
                }
                let r = msg
                    .get("result")
                    .and_then(|v| v.as_object())
                    .cloned()
                    .unwrap_or_default();
                results.insert(rid, r);
                if results.len() == 2 {
                    let acct = results
                        .remove(&2)
                        .and_then(|mut m| m.remove("account"))
                        .and_then(|v| v.as_object().cloned())
                        .unwrap_or_default();
                    let limits = results.remove(&3).unwrap_or_default();
                    return Ok((acct, limits));
                }
            }
        }
        Err("timeout")
    })();

    let _ = child.kill();
    let _ = child.wait();
    res
}

pub fn profile_roots(home: Option<&Path>) -> Vec<(String, PathBuf)> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let mut roots: BTreeSet<(String, PathBuf)> = BTreeSet::new();
    roots.insert(("Claude".into(), home.join(".claude")));
    roots.insert(("Codex".into(), home.join(".codex")));

    let mdir = managed_profiles_dir(Some(&home));
    for kind in ["Claude", "Codex"] {
        let dir = mdir.join(kind.to_lowercase());
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && !p.is_symlink() {
                    roots.insert((kind.into(), p));
                }
            }
        }
    }
    for base in [
        home.join("Library/Application Support/OpenBot/provider-accounts"),
        home.join(".config/OpenBot/provider-accounts"),
        home.join("AppData/Roaming/OpenBot/provider-accounts"),
    ] {
        if let Ok(entries) = std::fs::read_dir(&base) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() || p.is_symlink() {
                    continue;
                }
                if p.join("sessions").is_dir() || p.join("auth.json").is_file() {
                    roots.insert(("Codex".into(), p.clone()));
                }
                if p.join("projects").is_dir() || p.join(".claude.json").is_file() {
                    roots.insert(("Claude".into(), p));
                }
            }
        }
    }
    for (kind, key) in [("Claude", "CLAUDE_CONFIG_DIR"), ("Codex", "CODEX_HOME")] {
        if let Ok(val) = std::env::var(key) {
            if !val.is_empty() {
                roots.insert((kind.into(), PathBuf::from(val)));
            }
        }
    }

    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cmd(UpdateKind::OnlyIfNotSet)
            .with_environ(UpdateKind::OnlyIfNotSet),
    );
    for proc_info in sys.processes().values() {
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
        if !matches!(cli_kind(&name, &args, &exe), Some("Claude" | "Codex")) {
            continue;
        }
        for env_entry in proc_info.environ() {
            let s = env_entry.to_string_lossy();
            if let Some(v) = s
                .strip_prefix("CLAUDE_CONFIG_DIR=")
                .filter(|x| !x.is_empty())
            {
                roots.insert(("Claude".into(), PathBuf::from(v)));
            } else if let Some(v) = s.strip_prefix("CODEX_HOME=").filter(|x| !x.is_empty()) {
                roots.insert(("Codex".into(), PathBuf::from(v)));
            }
        }
    }

    roots.into_iter().take(64).collect()
}

// ---------------- provider_quotas (GLM / Antigravity) ----------------

fn quota_window_row(
    key: &str,
    period: &str,
    percentage: Option<f64>,
    reset: Option<&Value>,
    now: f64,
    extra: Option<(&str, &str)>,
) -> Value {
    let (label, seconds): (&str, Option<i64>) = match period {
        "5h" => ("5H", Some(18000)),
        "weekly" => ("주간", Some(604800)),
        "daily" => ("24H", Some(86400)),
        "monthly" => ("월간", None),
        other => (
            if other.is_empty() {
                "플랜 한도"
            } else {
                other
            },
            None,
        ),
    };
    let r = epoch_from_value(reset);
    let pct = percentage.and_then(|v| {
        if v.is_finite() && v >= 0.0 && (r == 0.0 || r > now) {
            Some(v.min(100.0))
        } else {
            None
        }
    });
    let mut m = json!({
        "key": clean_title(key, 80),
        "period": period,
        "label": label,
        "pct": pct,
        "reset": r,
        "seconds": seconds
    });
    if let Some((meter, scope)) = extra {
        let obj = m.as_object_mut().unwrap();
        obj.insert("meter".into(), json!(meter));
        obj.insert("scope".into(), json!(scope));
        if meter == "TIME_LIMIT" {
            obj.insert("label".into(), json!(format!("MCP · {label}")));
        }
    }
    m
}

pub fn glm_windows(payload: &Map<String, Value>, now: f64) -> Result<Vec<Value>, &'static str> {
    if payload.get("success").and_then(|v| v.as_bool()) != Some(true) {
        return Err("provider_unavailable");
    }
    let code = nonneg_num(payload.get("code")).unwrap_or(0.0);
    if code != 0.0 && code != 200.0 {
        return Err("provider_unavailable");
    }
    let limits = payload
        .get("data")
        .and_then(|d| d.get("limits"))
        .and_then(|l| l.as_array())
        .ok_or("invalid_response")?;
    let mut windows = Vec::new();
    for (i, item) in limits.iter().take(32).enumerate() {
        let Some(io) = item.as_object() else {
            continue;
        };
        let Some(meter) = io.get("type").and_then(|v| v.as_str()) else {
            continue;
        };
        if !matches!(meter, "TOKENS_LIMIT" | "CREDIT_LIMIT" | "TIME_LIMIT") {
            continue;
        }
        let cap = nonneg_num(io.get("usage"));
        let mut used = nonneg_num(io.get("currentValue"));
        let remaining = nonneg_num(io.get("remaining"));
        let mut pct = nonneg_num(io.get("percentage"));
        if let Some(c) = cap.filter(|&x| x > 0.0) {
            if used.is_none() {
                if let Some(rem) = remaining.filter(|&r| r <= c) {
                    used = Some(c - rem);
                }
            }
            if let Some(u) = used {
                pct = Some(u / c * 100.0);
            }
        }
        let unit = io.get("unit").and_then(|v| v.as_i64()).unwrap_or(0);
        let count = nonneg_num(io.get("number")).unwrap_or(0.0);
        let period = if meter == "TIME_LIMIT" && unit == 5 {
            "monthly"
        } else {
            let mult = match unit {
                1 => 86400.0,
                3 => 3600.0,
                6 => 604800.0,
                _ => 0.0,
            };
            match (mult * count) as i64 {
                18000 => "5h",
                604800 => "weekly",
                86400 => "daily",
                _ => "unknown",
            }
        };
        let key = format!("{}:{unit}:{count}:{i}", meter.to_lowercase());
        let scope = if meter == "TIME_LIMIT" {
            "mcp"
        } else {
            "models"
        };
        windows.push(quota_window_row(
            &key,
            period,
            pct,
            io.get("nextResetTime"),
            now,
            Some((meter, scope)),
        ));
    }
    windows.sort_by_key(|w| {
        let mcp = w.get("scope").and_then(|v| v.as_str()) == Some("mcp");
        let p = match w.get("period").and_then(|v| v.as_str()).unwrap_or("") {
            "weekly" => 0,
            "5h" => 1,
            "daily" => 2,
            _ => 3,
        };
        (mcp, p)
    });
    Ok(windows)
}

#[derive(Debug, Clone)]
pub struct ProviderSource {
    pub kind: String,
    pub id: String,
    pub host: String,
    pub token: String,
    pub cli: String,
}

fn glm_source_from_env(env: &HashMap<String, String>) -> Option<ProviderSource> {
    let mut base = env.get("ANTHROPIC_BASE_URL").cloned();
    let mut token = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .or_else(|| env.get("ANTHROPIC_API_KEY"))
        .cloned();
    if base.as_deref().is_none_or(str::is_empty) {
        if let Some(zk) = env.get("ZAI_API_KEY").filter(|s| !s.is_empty()) {
            base = Some("https://api.z.ai".into());
            token = Some(zk.clone());
        }
    }
    let parsed = Url::parse(base.as_deref()?).ok()?;
    let host = parsed.host_str()?;
    if parsed.scheme() != "https"
        || !GLM_HOSTS.contains(&host)
        || !matches!(parsed.port(), None | Some(443))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return None;
    }
    let mut tok = token?.trim().to_string();
    if let Some(rest) = tok.strip_prefix("Bearer ") {
        tok = rest.to_string();
    }
    if tok.is_empty() || tok.len() > 8192 || tok.chars().any(char::is_whitespace) {
        return None;
    }
    let id = provider_account_id("GLM", &format!("{host}|{tok}"));
    Some(ProviderSource {
        kind: "GLM".into(),
        id,
        host: host.to_string(),
        token: tok,
        cli: String::new(),
    })
}

fn provider_account_id(provider: &str, value: &str) -> String {
    let digest = sha256_hex(value.as_bytes());
    format!("{}:{}", provider.to_lowercase(), &digest[..20])
}

fn installation_scope(home: &Path) -> Result<String, &'static str> {
    let root = data_directory(Some(home));
    let path = root.join("provider-profile-v1.json");
    if let Some(s) = read_json_object(&path, MAX_JSON_BYTES)
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|s| hex32_re().is_match(s))
    {
        return Ok(s.to_string());
    }
    let _ = std::fs::create_dir_all(&root);
    let mut buf = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    let scope = hex::encode(buf);
    let _ = write_atomic_json(&path, &json!({"id": scope}));
    Ok(scope)
}

pub fn discover_providers(home: Option<&Path>) -> Vec<ProviderSource> {
    let home = home.map(Path::to_path_buf).unwrap_or_else(home_dir);
    let mut found: BTreeMap<String, ProviderSource> = BTreeMap::new();
    let mut add = |env: &HashMap<String, String>| {
        if found.len() >= 32 {
            return;
        }
        if let Some(src) = glm_source_from_env(env) {
            found.insert(src.id.clone(), src);
        }
    };
    let os_env: HashMap<String, String> = std::env::vars().collect();
    add(&os_env);

    let mut roots = BTreeSet::new();
    roots.insert(home.join(".claude"));
    if let Ok(v) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !v.is_empty() {
            roots.insert(PathBuf::from(v));
        }
    }
    let mdir = managed_profiles_dir(Some(&home)).join("claude");
    if let Ok(entries) = std::fs::read_dir(&mdir) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() && !p.is_symlink() {
                roots.insert(p);
            }
        }
    }
    for root in roots.into_iter().take(64) {
        let cfg = read_json_object(&root.join("settings.json"), MAX_JSON_BYTES);
        if let Some(env_obj) = cfg.get("env").and_then(|v| v.as_object()) {
            let map: HashMap<String, String> = env_obj
                .iter()
                .filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string())))
                .collect();
            add(&map);
        }
    }
    let glm_dir = managed_profiles_dir(Some(&home)).join("glm");
    if let Ok(entries) = std::fs::read_dir(&glm_dir) {
        for e in entries.flatten().take(32) {
            let p = e.path();
            if !p.is_file() || p.is_symlink() {
                continue;
            }
            let doc = read_json_object(&p, 16 * 1024);
            let host = doc
                .get("host")
                .and_then(|v| v.as_str())
                .unwrap_or("api.z.ai");
            if let Some(key) = doc
                .get("api_key")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                let mut map = HashMap::new();
                map.insert("ANTHROPIC_BASE_URL".into(), format!("https://{host}"));
                map.insert("ANTHROPIC_AUTH_TOKEN".into(), key.to_string());
                add(&map);
            }
        }
    }
    if let Some(cli) = find_executable("agy") {
        if let Ok(scope) = installation_scope(&home) {
            let key = provider_account_id("Antigravity", &format!("{scope}|default-cli-profile"));
            found.insert(
                key.clone(),
                ProviderSource {
                    kind: "Antigravity".into(),
                    id: key,
                    host: String::new(),
                    token: String::new(),
                    cli,
                },
            );
        }
    }
    found.into_values().collect()
}

pub fn agy_rows(
    payload: &Map<String, Value>,
    source_id: &str,
    now: f64,
) -> Result<Vec<Value>, &'static str> {
    if nonneg_num(payload.get("num_turns")) != Some(0.0)
        || payload
            .get("conversation_id")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty())
    {
        return Err("unsafe_cli_response");
    }
    if let Some(u) = payload.get("usage").and_then(|v| v.as_object()) {
        if u.values().any(|v| nonneg_num(Some(v)) != Some(0.0)) {
            return Err("unsafe_cli_response");
        }
    }
    let cmd = payload.get("command").and_then(|v| v.as_object());
    if payload.get("status").and_then(|v| v.as_str()) != Some("SUCCESS")
        || cmd.and_then(|c| c.get("name")).and_then(|v| v.as_str()) != Some("usage")
    {
        return Err("provider_unavailable");
    }
    let groups = cmd
        .and_then(|c| c.get("data"))
        .and_then(|d| d.get("groups"))
        .and_then(|g| g.as_array())
        .ok_or("invalid_response")?;
    let mut rows = Vec::new();
    for g in groups.iter().take(16) {
        let Some(go) = g.as_object() else {
            continue;
        };
        let Some(buckets) = go.get("buckets").and_then(|v| v.as_array()) else {
            continue;
        };
        let pool = clean_title(go.get("name").and_then(|v| v.as_str()).unwrap_or(""), 80);
        let mut windows = Vec::new();
        for b in buckets.iter().take(16) {
            let Some(bo) = b.as_object() else {
                continue;
            };
            if bo.get("disabled").and_then(|v| v.as_bool()) == Some(true) {
                continue;
            }
            let frac = nonneg_num(bo.get("remaining_fraction")).filter(|&f| f <= 1.0);
            let period = match bo.get("window").and_then(|v| v.as_str()).unwrap_or("") {
                p @ ("5h" | "weekly" | "daily" | "monthly") => p,
                _ => "unknown",
            };
            let bid = bo.get("id").and_then(|v| v.as_str()).unwrap_or(period);
            windows.push(quota_window_row(
                bid,
                period,
                frac.map(|f| (1.0 - f) * 100.0),
                bo.get("reset_time"),
                now,
                None,
            ));
        }
        if windows.is_empty() {
            continue;
        }
        windows.sort_by_key(
            |w| match w.get("period").and_then(|v| v.as_str()).unwrap_or("") {
                "weekly" => 0,
                "5h" => 1,
                "daily" => 2,
                _ => 3,
            },
        );
        let key = provider_account_id("Antigravity", &format!("{source_id}|{pool}"));
        rows.push(json!({
            "id": key,
            "kind": "Antigravity",
            "account_label": pool,
            "plan": "",
            "pool": pool,
            "provider": "Google Antigravity",
            "identity_verified": false,
            "identity_source": "cli_profile",
            "windows": windows,
            "updated": now,
            "stale": false,
            "source": "agy_usage",
            "note": "agy /usage 공식 한도 · 2분마다 확인"
        }));
    }
    if rows.is_empty() {
        return Err("invalid_response");
    }
    Ok(rows)
}

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn clean_subprocess_env() -> Vec<(&'static str, String)> {
    // Allowlist safe baseline variables so parent agent/IDE shells (e.g. WSL_DISTRO_NAME,
    // GEMINI_HOME, ANTIGRAVITY_*, AGY_CLI_FORCE_FILE_TOKEN_STORAGE) never break agy keyring auth.
    const KEEP: &[&str] = &[
        "HOME",
        "USER",
        "LOGNAME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "SYSTEMROOT",
        "SystemRoot",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "TEMP",
        "TMP",
    ];
    let mut out = Vec::new();
    for &key in KEEP {
        if let Ok(val) = std::env::var(key) {
            if !val.is_empty() {
                out.push((key, val));
            }
        }
    }
    out
}

fn build_browser_guard_dir() -> Option<(TempDirGuard, PathBuf)> {
    if cfg!(windows) {
        return None;
    }
    let dir = std::env::temp_dir().join(format!(
        "1top-agy-guard-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let marker = dir.join("browser_attempted");
    let script = format!(
        "#!/bin/sh\n: > '{}'\nexit 1\n",
        marker.to_string_lossy().replace('\'', "'\\''")
    );
    for tool in ["open", "xdg-open"] {
        let p = dir.join(tool);
        std::fs::write(&p, &script).ok()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o700));
        }
    }
    Some((TempDirGuard(dir), marker))
}

fn apply_clean_agy_env(cmd: &mut Command, guard_dir: Option<&Path>) {
    cmd.env_clear();
    for (k, v) in clean_subprocess_env() {
        cmd.env(k, v);
    }
    let base_path = if cfg!(windows) {
        std::env::var("PATH").unwrap_or_default()
    } else {
        "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".to_string()
    };
    let path_val = match guard_dir {
        Some(g) if !cfg!(windows) => format!("{}:{base_path}", g.display()),
        _ => base_path,
    };
    cmd.env("PATH", path_val);
    cmd.env("AGY_CLI_DISABLE_AUTO_UPDATE", "true");
}

fn query_agy(source: &ProviderSource, now: f64) -> Result<Vec<Value>, &'static str> {
    let mut ver_cmd = Command::new(&source.cli);
    ver_cmd
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null());
    apply_clean_agy_env(&mut ver_cmd, None);
    let ver = ver_cmd.output().map_err(|_| "provider_unavailable")?;
    let vstr = String::from_utf8_lossy(&ver.stdout);
    let caps = semver_re().captures(&vstr).ok_or("unsupported_cli")?;
    let tuple = (
        caps[1].parse::<u32>().unwrap_or(0),
        caps[2].parse::<u32>().unwrap_or(0),
        caps[3].parse::<u32>().unwrap_or(0),
    );
    if tuple < (1, 1, 11) {
        return Err("unsupported_cli");
    }
    let guard = build_browser_guard_dir();
    let guard_dir = guard.as_ref().map(|(g, _)| g.0.as_path());
    let marker_path = guard.as_ref().map(|(_, m)| m.clone());
    let devnull = if cfg!(windows) { "NUL" } else { "/dev/null" };
    let mut cmd = Command::new(&source.cli);
    cmd.args([
        "-p",
        "/usage",
        "--output-format",
        "json",
        "--print-timeout",
        "20s",
        "--log-file",
        devnull,
        "--settings",
        "{\"disableSlashCommands\":false}",
    ])
    .current_dir(home_dir())
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
    apply_clean_agy_env(&mut cmd, guard_dir);
    let mut child = cmd.spawn().map_err(|_| "provider_unavailable")?;
    let mut stdout_pipe = child.stdout.take().ok_or("provider_unavailable")?;
    let reader_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe
            .by_ref()
            .take((MAX_JSON_BYTES + 1) as u64)
            .read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + Duration::from_secs(28);
    let mut browser_blocked = false;
    let status = loop {
        if marker_path.as_ref().is_some_and(|m| m.exists()) {
            browser_blocked = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let stdout = reader_handle.join().unwrap_or_default();
    if browser_blocked || marker_path.as_ref().is_some_and(|m| m.exists()) {
        return Err("login_required");
    }
    let Some(st) = status else {
        return Err("provider_unavailable");
    };
    if !st.success() || stdout.len() > MAX_JSON_BYTES {
        return Err("provider_unavailable");
    }
    let val: Value = serde_json::from_slice(&stdout).map_err(|_| "invalid_response")?;
    let obj = val.as_object().ok_or("invalid_response")?;
    agy_rows(obj, &source.id, now)
}

fn query_glm(source: &ProviderSource, now: f64) -> Result<Vec<Value>, &'static str> {
    let client = blocking_http_client(8);
    let url = format!("https://{}/api/monitor/usage/quota/limit", source.host);
    let resp = client
        .get(&url)
        .header("Authorization", &source.token)
        .header("Accept", "application/json")
        .header("User-Agent", "1top-quota/1.0")
        .send()
        .map_err(|_| "provider_unavailable")?;
    let status = resp.status().as_u16();
    if status >= 400 {
        return Err(match status {
            401 => "login_required",
            403 => "access_denied",
            429 => "rate_limited",
            _ => "provider_unavailable",
        });
    }
    let bytes = resp.bytes().map_err(|_| "provider_unavailable")?;
    if bytes.len() > MAX_JSON_BYTES {
        return Err("invalid_response");
    }
    let val: Value = serde_json::from_slice(&bytes).map_err(|_| "invalid_response")?;
    let obj = val.as_object().ok_or("invalid_response")?;
    let windows = glm_windows(obj, now)?;
    if windows.is_empty() {
        return Err("no_quota");
    }
    let tail = if source.id.len() >= 6 {
        &source.id[source.id.len() - 6..]
    } else {
        &source.id
    };
    Ok(vec![json!({
        "id": source.id,
        "kind": "GLM",
        "account_label": format!("GLM · {tail}"),
        "provider": if source.host == "api.z.ai" { "Z.ai" } else { "Zhipu" },
        "plan": "",
        "identity_source": "credential_fingerprint",
        "windows": windows,
        "updated": now,
        "stale": false,
        "source": "zai_usage",
        "note": "공식 API · 2분마다 확인"
    })])
}

// ---------------- AccountQuotaSampler ----------------

#[derive(Default)]
struct SamplerState {
    rows: Vec<Value>,
    provider_rows: Vec<Value>,
    cached: HashMap<String, Value>,
    profile_accounts: HashMap<PathBuf, ProfileRootBinding>,
    claude_verified: HashMap<String, String>,
    refresh_failures: HashMap<(String, String), (f64, String)>,
    claude_backoff: HashMap<String, f64>,
    provider_sources: HashMap<String, ProviderSource>,
    provider_cached: HashMap<String, Vec<Value>>,
    provider_retry_after: HashMap<String, (f64, String)>,
    provider_disabled: HashSet<String>,
}

#[derive(Clone, Default)]
pub struct AccountQuotaSampler {
    state: Arc<Mutex<SamplerState>>,
}

impl AccountQuotaSampler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear_backoff(&self, hint: Option<&str>) {
        let Ok(mut g) = self.state.lock() else {
            return;
        };
        match hint {
            Some(h) if h.starts_with("claude:") => {
                g.refresh_failures.retain(|(_, aid), _| aid != h);
                g.claude_backoff.remove(h);
            }
            Some("Claude") => {
                g.refresh_failures.clear();
                g.claude_backoff.clear();
            }
            Some("Antigravity") => {
                let ids: Vec<String> = g
                    .provider_sources
                    .values()
                    .filter(|s| s.kind == "Antigravity")
                    .map(|s| s.id.clone())
                    .collect();
                for id in ids {
                    g.provider_retry_after.remove(&id);
                }
            }
            Some("GLM") => {
                let ids: Vec<String> = g
                    .provider_sources
                    .values()
                    .filter(|s| s.kind == "GLM")
                    .map(|s| s.id.clone())
                    .collect();
                for id in ids {
                    g.provider_retry_after.remove(&id);
                }
            }
            _ => {
                g.refresh_failures.clear();
                g.claude_backoff.clear();
                g.provider_retry_after.clear();
            }
        }
    }

    pub fn roots(&self) -> HashMap<PathBuf, ProfileRootBinding> {
        self.state
            .lock()
            .map(|s| s.profile_accounts.clone())
            .unwrap_or_default()
    }

    pub fn providers_snapshot(&self, now: f64) -> Vec<Value> {
        let mut rows = self
            .state
            .lock()
            .map(|s| s.provider_rows.clone())
            .unwrap_or_default();
        expire_windows(&mut rows, now);
        rows
    }

    pub fn snapshot(&self, now: f64) -> Vec<Value> {
        let (mut rows, mut provs) = self
            .state
            .lock()
            .map(|s| (s.rows.clone(), s.provider_rows.clone()))
            .unwrap_or_default();
        expire_windows(&mut rows, now);
        expire_windows(&mut provs, now);
        rows.extend(provs);
        rows
    }

    fn sample_claude_local(&self, root: &Path, now: f64) -> Option<Value> {
        let cfg_path = claude_config_path(root);
        let cfg = read_json_object(&cfg_path, 8 * 1024 * 1024);
        let acct = cfg.get("oauthAccount")?.as_object()?;
        let acct_id = acct
            .get("accountUuid")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())?;
        let org_id = acct
            .get("organizationUuid")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let key = account_identity("Claude", acct_id, org_id);
        let tail = if key.len() >= 6 {
            &key[key.len() - 6..]
        } else {
            &key
        };
        let label = acct
            .get("emailAddress")
            .or_else(|| acct.get("displayName"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Claude 계정 {tail}"));
        let tier_raw = acct
            .get("organizationRateLimitTier")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let plan = acct
            .get("seatTier")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                if tier_raw.contains("_claude_max_") {
                    "max".into()
                } else {
                    String::new()
                }
            });

        let mut row = json!({
            "id": key,
            "kind": "Claude",
            "account_label": label,
            "plan": plan,
            "plan_tier": tier_raw.chars().take(60).collect::<String>(),
            "windows": claude_windows(&Map::new(), now),
            "updated": 0.0,
            "stale": true,
            "status": "report_pending",
            "note": "Claude Code의 다음 사용량 보고를 기다립니다."
        });
        let ro = row.as_object_mut().unwrap();

        if let Ok(guard) = self.state.lock() {
            if let Some(prev) = guard.cached.get(&key).and_then(|v| v.as_object()) {
                if let Some(w) = prev.get("windows") {
                    ro.insert("windows".into(), w.clone());
                }
                if let Some(u) = prev.get("updated") {
                    ro.insert("updated".into(), u.clone());
                }
                if let Some(src) = prev.get("source") {
                    ro.insert("source".into(), src.clone());
                }
                if prev.get("verified_activity").and_then(|v| v.as_bool()) == Some(true) {
                    ro.insert("verified_activity".into(), json!(true));
                }
            }
        }

        if let Some(cache) = cfg
            .get("cachedUsageUtilization")
            .and_then(|v| v.as_object())
        {
            if cache.get("accountUuid").and_then(|v| v.as_str()) == Some(acct_id)
                && cache
                    .get("organizationUuid")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    == org_id
            {
                if let Some(util) = cache.get("utilization").and_then(|v| v.as_object()) {
                    let reported = epoch_from_value(cache.get("fetchedAtMs"));
                    let cur_upd = ro.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if cur_upd < reported && reported <= now {
                        ro.insert("windows".into(), Value::Array(claude_windows(util, now)));
                        ro.insert("updated".into(), json!(reported));
                        ro.insert("source".into(), json!("claude_cache"));
                    }
                }
            }
        }

        if let Some(report) = claude_statusline_report(root, &key, now) {
            let r_upd = report
                .get("updated")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let cur_upd = ro.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if r_upd >= cur_upd {
                for (k, v) in report {
                    ro.insert(k, v);
                }
            }
        }

        // Verify account didn't switch mid-read
        let after = read_json_object(&cfg_path, 8 * 1024 * 1024);
        let after_acct = after.get("oauthAccount").and_then(|v| v.as_object())?;
        if after_acct.get("accountUuid").and_then(|v| v.as_str()) != Some(acct_id)
            || after_acct
                .get("organizationUuid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                != org_id
        {
            return None;
        }

        let mut has_value = false;
        if let Some(ws) = ro.get_mut("windows").and_then(|v| v.as_array_mut()) {
            for w in ws.iter_mut() {
                if let Some(wo) = w.as_object_mut() {
                    let reset = wo.get("reset").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if reset > 0.0 && reset <= now {
                        wo.insert("pct".into(), Value::Null);
                    }
                    if wo.get("pct").is_some_and(|v| !v.is_null()) {
                        has_value = true;
                    }
                }
            }
        }
        let upd = ro.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let src = ro
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let verified = ro.get("verified_activity").and_then(|v| v.as_bool()) == Some(true);
        if src == "claude_oauth" && now - upd <= 300.0 && has_value {
            ro.insert("stale".into(), json!(false));
            ro.insert("note".into(), json!("Claude 계정 사용률 · 2분마다 확인"));
            ro.remove("status");
        } else if src == "claude_statusline" && verified && now - upd <= 300.0 && has_value {
            ro.insert("stale".into(), json!(false));
            ro.insert("note".into(), json!("Claude Code 상태줄 보고"));
            ro.remove("status");
        } else if src == "claude_statusline" && !verified && upd > 0.0 {
            ro.insert("status".into(), json!("last_report"));
            ro.insert(
                "note".into(),
                json!("Claude Code 마지막 보고값 · 다음 응답에서 갱신"),
            );
        } else if upd > 0.0 {
            ro.insert(
                "note".into(),
                json!(if src == "claude_statusline" {
                    "Claude Code 상태줄 보고 · 마지막 보고값"
                } else {
                    "Claude 계정 캐시 · 마지막 보고값"
                }),
            );
        }
        Some(row)
    }

    fn sample_claude_live(&self, root: &Path, now: f64) -> Option<Value> {
        let mut row = self.sample_claude_local(root, now)?;
        let stale = row.get("stale").and_then(|v| v.as_bool()).unwrap_or(true);
        let upd = row.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if !stale && now - upd < 120.0 {
            return Some(row);
        }
        let key = row.get("id")?.as_str()?.to_string();
        let fkey = (root.to_string_lossy().into_owned(), key.clone());

        let apply_fail = |r: &mut Value, code: &str| {
            let obj = r.as_object_mut().unwrap();
            obj.insert("status".into(), json!(code));
            let note = match code {
                "credential_store_unavailable" => "Claude 인증 저장소 접근 필요 · 마지막 보고값",
                "login_required" | "login_expired" => "Claude 계정 재연결 필요 · 마지막 보고값",
                "account_changed" => "Claude 계정 확인 필요 · 마지막 보고값",
                "rate_limited" => "Claude 조회 대기 · 마지막 보고값",
                _ => "Claude 계정 조회 지연 · 마지막 보고값",
            };
            obj.insert("note".into(), json!(note));
        };

        if let Ok(g) = self.state.lock() {
            if let Some((until, code)) = g.refresh_failures.get(&fkey) {
                if now < *until {
                    apply_fail(&mut row, code);
                    return Some(row);
                }
            }
            if let Some(&until) = g.claude_backoff.get(&key) {
                if now < until {
                    apply_fail(&mut row, "rate_limited");
                    return Some(row);
                }
            }
        }

        let mut creds = match claude_credentials(root) {
            Ok(c) => c,
            Err(code) => {
                if let Ok(mut g) = self.state.lock() {
                    g.refresh_failures.insert(fkey, (now + 120.0, code.into()));
                }
                apply_fail(&mut row, code);
                return Some(row);
            }
        };
        if creds
            .get("accessToken")
            .and_then(|v| v.as_str())
            .is_none_or(str::is_empty)
        {
            apply_fail(&mut row, "login_required");
            return Some(row);
        }
        let exp = epoch_from_value(creds.get("expiresAt"));
        if exp <= now + 30.0 {
            match refresh_managed_claude(root, now, false) {
                Ok(renewed) => creds = renewed,
                Err(code) => {
                    if let Ok(mut g) = self.state.lock() {
                        if code == "rate_limited" {
                            g.claude_backoff.insert(key, now + 300.0);
                        }
                        let delay = if matches!(code, "login_required" | "login_expired") {
                            600.0
                        } else {
                            120.0
                        };
                        g.refresh_failures.insert(fkey, (now + delay, code.into()));
                    }
                    apply_fail(&mut row, code);
                    return Some(row);
                }
            }
        }

        let mut final_usage: Option<Map<String, Value>> = None;
        let mut last_err: Option<&'static str> = None;
        for attempt in 0..2 {
            let Some(token) = creds
                .get("accessToken")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            else {
                last_err = Some("login_required");
                break;
            };
            let fp = sha256_hex(token.as_bytes());
            let verified_owner = self
                .state
                .lock()
                .ok()
                .and_then(|g| g.claude_verified.get(&fp).cloned());
            if verified_owner.as_deref() != Some(key.as_str()) {
                match claude_identity_from_token(token) {
                    Ok(owner) if owner == key => {
                        if let Ok(mut g) = self.state.lock() {
                            if g.claude_verified.len() > 128 {
                                g.claude_verified.clear();
                            }
                            g.claude_verified.insert(fp, key.clone());
                        }
                    }
                    Ok(_) => {
                        apply_fail(&mut row, "account_changed");
                        return Some(row);
                    }
                    Err((status, code)) => {
                        if status == 401 && attempt == 0 && is_managed_claude(root) {
                            match refresh_managed_claude(root, now, true) {
                                Ok(renewed) => {
                                    creds = renewed;
                                    continue;
                                }
                                Err(rc) => {
                                    last_err = Some(rc);
                                    break;
                                }
                            }
                        }
                        last_err = Some(code);
                        break;
                    }
                }
            }
            match claude_api(token, "usage") {
                Ok(usage) => {
                    final_usage = Some(usage);
                    break;
                }
                Err((status, code)) => {
                    if status == 401 && attempt == 0 && is_managed_claude(root) {
                        match refresh_managed_claude(root, now, true) {
                            Ok(renewed) => {
                                creds = renewed;
                                continue;
                            }
                            Err(rc) => {
                                last_err = Some(rc);
                                break;
                            }
                        }
                    }
                    last_err = Some(code);
                    break;
                }
            }
        }

        if let Some(usage) = final_usage {
            let after = self.sample_claude_local(root, now);
            if after
                .as_ref()
                .and_then(|r| r.get("id"))
                .and_then(|v| v.as_str())
                != Some(key.as_str())
            {
                return None;
            }
            let windows = claude_windows(&usage, now);
            if windows
                .iter()
                .any(|w| w.get("pct").is_some_and(|v| !v.is_null()))
            {
                let obj = row.as_object_mut().unwrap();
                obj.insert("windows".into(), Value::Array(windows));
                obj.insert("updated".into(), json!(now));
                obj.insert("stale".into(), json!(false));
                obj.insert("source".into(), json!("claude_oauth"));
                obj.insert("note".into(), json!("Claude 계정 사용률 · 2분마다 확인"));
                obj.remove("status");
                obj.remove("verified_activity");
                if let Ok(mut g) = self.state.lock() {
                    g.refresh_failures.remove(&fkey);
                }
            } else {
                last_err = Some("invalid_response");
            }
        }
        if let Some(code) = last_err {
            if let Ok(mut g) = self.state.lock() {
                if code == "rate_limited" {
                    g.claude_backoff.insert(key, now + 300.0);
                }
                let delay = if matches!(code, "login_required" | "login_expired") {
                    600.0
                } else {
                    120.0
                };
                g.refresh_failures.insert(fkey, (now + delay, code.into()));
            }
            apply_fail(&mut row, code);
        }
        Some(row)
    }

    fn sample_codex(&self, root: &Path, now: f64) -> Option<Value> {
        let auth = read_json_object(&root.join("auth.json"), MAX_JSON_BYTES);
        let tokens = auth.get("tokens").and_then(|v| v.as_object())?;
        let acct_id = tokens
            .get("account_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())?;
        let key = account_identity("Codex", acct_id, "");
        let tail = if key.len() >= 6 {
            &key[key.len() - 6..]
        } else {
            &key
        };
        let mut label = format!("Codex 계정 {tail}");
        if let Some(id_tok) = tokens.get("id_token").and_then(|v| v.as_str()) {
            if let Some(part) = id_tok.split('.').nth(1) {
                if let Ok(dec) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(part) {
                    if let Ok(claims) = serde_json::from_slice::<Value>(&dec) {
                        if let Some(email) = claims.get("email").and_then(|v| v.as_str()) {
                            label = email.to_string();
                        }
                    }
                }
            }
        }

        let mut row = self
            .state
            .lock()
            .ok()
            .and_then(|g| g.cached.get(&key).cloned())
            .map(|mut r| {
                if let Some(o) = r.as_object_mut() {
                    o.insert("stale".into(), json!(true));
                    o.insert("note".into(), json!("계정 조회 지연 · 마지막 보고값"));
                }
                r
            })
            .unwrap_or_else(|| {
                json!({
                    "id": key,
                    "kind": "Codex",
                    "account_label": label,
                    "plan": "",
                    "windows": codex_windows(&Map::new(), now).0,
                    "updated": 0.0,
                    "stale": true,
                    "note": "계정 한도를 확인하지 못했습니다."
                })
            });

        if let Ok((account, usage)) = codex_rpc(root, false) {
            let after_auth = read_json_object(&root.join("auth.json"), MAX_JSON_BYTES);
            let after_id = after_auth
                .get("tokens")
                .and_then(|t| t.get("account_id"))
                .and_then(|v| v.as_str());
            let usage_acct = usage
                .get("accountId")
                .and_then(|v| v.as_str())
                .unwrap_or(acct_id);
            if after_id == Some(acct_id)
                && usage_acct == acct_id
                && account.get("type").and_then(|v| v.as_str()) == Some("chatgpt")
            {
                let (windows, plan) = codex_windows(&usage, now);
                let ro = row.as_object_mut().unwrap();
                let eff_label = account
                    .get("email")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&label);
                let eff_plan = plan
                    .as_deref()
                    .or_else(|| account.get("planType").and_then(|v| v.as_str()))
                    .unwrap_or("");
                ro.insert("account_label".into(), json!(eff_label));
                ro.insert("plan".into(), json!(eff_plan));
                ro.insert("windows".into(), Value::Array(windows));
                ro.insert("updated".into(), json!(now));
                ro.insert("stale".into(), json!(false));
                ro.insert("note".into(), json!("Codex 계정 사용률 · 2분마다 확인"));
            } else {
                return None;
            }
        }
        Some(row)
    }

    pub fn sample_once(&self) {
        let now = now_epoch();
        let mut rows: HashMap<String, Value> = HashMap::new();
        let mut bindings: HashMap<PathBuf, ProfileRootBinding> = HashMap::new();

        for (kind, root) in profile_roots(None) {
            let canon = std::fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
            let row = if kind == "Claude" {
                self.sample_claude_live(&root, now)
            } else {
                self.sample_codex(&root, now)
            };
            if let Some(r) = row {
                let rid = r
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if rid.is_empty() {
                    continue;
                }
                bindings.insert(canon, (rid.clone(), kind.clone(), now));
                let r_fresh = !r.get("stale").and_then(|v| v.as_bool()).unwrap_or(true);
                let r_upd = r.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let replace = match rows.get(&rid) {
                    None => true,
                    Some(prev) => {
                        let p_fresh = !prev.get("stale").and_then(|v| v.as_bool()).unwrap_or(true);
                        let p_upd = prev.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        (r_fresh, r_upd) > (p_fresh, p_upd)
                    }
                };
                if replace {
                    rows.insert(rid, r);
                }
            }
        }

        // Publish Claude/Codex rows immediately so UI doesn't wait on slow provider CLIs (e.g. agy).
        if let Ok(mut g) = self.state.lock() {
            for (root, val) in bindings.iter_mut() {
                if let Some(old) = g.profile_accounts.get(root) {
                    if old.0 == val.0 && old.1 == val.1 {
                        val.2 = old.2;
                    }
                }
            }
            g.cached = rows.clone();
            g.profile_accounts = bindings;
            g.rows = rows.into_values().collect();
        }

        // Provider quotas (GLM / Antigravity)
        let discovered = discover_providers(None);
        let sources: Vec<ProviderSource> = {
            let mut g = self.state.lock().unwrap();
            for s in discovered {
                if g.provider_sources.contains_key(&s.id) || g.provider_sources.len() < 33 {
                    g.provider_sources.insert(s.id.clone(), s);
                }
            }
            g.provider_sources.values().cloned().collect()
        };
        let mut all_prov = Vec::new();
        for src in sources {
            let (disabled, retry_code) = self
                .state
                .lock()
                .ok()
                .map(|g| {
                    let dis = g.provider_disabled.contains(&src.id);
                    let rc = g
                        .provider_retry_after
                        .get(&src.id)
                        .filter(|(until, _)| now < *until)
                        .map(|(_, code)| code.clone());
                    (dis, rc)
                })
                .unwrap_or((false, None));
            let res: Result<Vec<Value>, String> = if disabled {
                Err("unsafe_cli_response".into())
            } else if let Some(code) = retry_code {
                Err(code)
            } else if src.kind == "Antigravity" {
                query_agy(&src, now).map_err(str::to_string)
            } else {
                query_glm(&src, now).map_err(str::to_string)
            };
            let p_rows = match res {
                Ok(v) => {
                    if let Ok(mut g) = self.state.lock() {
                        g.provider_retry_after.remove(&src.id);
                        g.provider_cached.insert(src.id.clone(), v.clone());
                    }
                    v
                }
                Err(code) => {
                    if let Ok(mut g) = self.state.lock() {
                        if code == "unsafe_cli_response" {
                            g.provider_disabled.insert(src.id.clone());
                        } else if !g
                            .provider_retry_after
                            .get(&src.id)
                            .is_some_and(|(until, _)| now < *until)
                        {
                            let delay = match code.as_str() {
                                "login_required" | "access_denied" => 1800.0,
                                _ => 300.0,
                            };
                            g.provider_retry_after
                                .insert(src.id.clone(), (now + delay, code.clone()));
                        }
                    }
                    let note = match (src.kind.as_str(), code.as_str()) {
                        ("Antigravity", "login_required") => {
                            "Google (Agy CLI) 로그인 필요 · 마지막 보고값"
                        }
                        ("GLM", "login_required" | "access_denied") => {
                            "GLM API 키 확인 필요 · 마지막 보고값"
                        }
                        _ => "계정 조회 지연 · 마지막 보고값",
                    };
                    let mut prev = self
                        .state
                        .lock()
                        .ok()
                        .and_then(|g| g.provider_cached.get(&src.id).cloned())
                        .unwrap_or_else(|| {
                            vec![json!({
                                "id": src.id,
                                "kind": src.kind,
                                "account_label": src.kind,
                                "plan": "",
                                "windows": [],
                                "updated": 0.0
                            })]
                        });
                    for pr in &mut prev {
                        if let Some(po) = pr.as_object_mut() {
                            po.insert("stale".into(), json!(true));
                            po.insert("status".into(), json!(code));
                            po.insert("note".into(), json!(note));
                        }
                    }
                    prev
                }
            };
            all_prov.extend(p_rows);
        }

        if let Ok(mut g) = self.state.lock() {
            g.provider_rows = all_prov;
        }
    }
}

fn expire_windows(rows: &mut [Value], now: f64) {
    for row in rows.iter_mut() {
        let Some(ro) = row.as_object_mut() else {
            continue;
        };
        let stale = ro.get("stale").and_then(|v| v.as_bool()).unwrap_or(true);
        let upd = ro.get("updated").and_then(|v| v.as_f64()).unwrap_or(0.0);
        ro.insert("stale".into(), json!(stale || now - upd > 300.0));
        if let Some(ws) = ro.get_mut("windows").and_then(|v| v.as_array_mut()) {
            for w in ws.iter_mut() {
                if let Some(wo) = w.as_object_mut() {
                    let reset = wo.get("reset").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if reset > 0.0 && reset <= now {
                        wo.insert("pct".into(), Value::Null);
                    }
                }
            }
        }
    }
}

// ---------------- AccountLogin ----------------

pub struct AccountLogin {
    directory: PathBuf,
    last: Mutex<Option<Instant>>,
    auth_lock: Mutex<()>,
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

impl AccountLogin {
    pub fn new(directory: Option<PathBuf>) -> Self {
        Self {
            directory: directory.unwrap_or_else(|| managed_profiles_dir(None)),
            last: Mutex::new(None),
            auth_lock: Mutex::new(()),
        }
    }

    pub fn save_glm(&self, host: &str, api_key: &str) -> Result<Value, (u16, String)> {
        let h = host.trim();
        if !GLM_HOSTS.contains(&h) {
            return Err((
                400,
                "지원하는 GLM 호스트(api.z.ai 또는 open.bigmodel.cn)를 선택해 주세요.".into(),
            ));
        }
        let mut token = api_key.trim();
        if let Some(rest) = token.strip_prefix("Bearer ") {
            token = rest.trim();
        }
        if token.is_empty() || token.len() > 8192 || token.chars().any(char::is_whitespace) {
            return Err((400, "유효한 Z.ai / Zhipu API 키를 입력해 주세요.".into()));
        }
        let dir = self.directory.join("glm");
        std::fs::create_dir_all(&dir).map_err(|_| {
            (
                500,
                "GLM 계정 정보를 저장하지 못했습니다. 다시 시도해 주세요.".into(),
            )
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        let count = std::fs::read_dir(&dir).map(|rd| rd.count()).unwrap_or(0);
        let id = provider_account_id("GLM", &format!("{h}|{token}"));
        let suffix = id.strip_prefix("glm:").unwrap_or(&id);
        let path = dir.join(format!("{suffix}.json"));
        if !path.exists() && count >= 16 {
            return Err((
                409,
                "저장된 GLM 계정이 많습니다. 기존 프로필을 정리해 주세요.".into(),
            ));
        }
        write_atomic_json(&path, &json!({"host": h, "api_key": token})).map_err(|_| {
            (
                500,
                "GLM 계정 정보를 저장하지 못했습니다. 다시 시도해 주세요.".into(),
            )
        })?;
        Ok(json!({
            "id": id,
            "message": "GLM (Z.ai) API 키를 로컬에 저장했습니다. 잠시 후 한도를 자동으로 확인합니다."
        }))
    }

    pub fn authorize_claude(&self, account_id: &str) -> Result<Value, (u16, String)> {
        if !account_id.starts_with("claude:") {
            return Err((400, "연결할 Claude 계정을 선택하세요.".into()));
        }
        let Ok(_g) = self.auth_lock.try_lock() else {
            return Err((409, "이미 열린 인증 연결 창을 확인해 주세요.".into()));
        };
        let mut cands: Vec<(f64, PathBuf)> = Vec::new();
        let cdir = self.directory.join("claude");
        if let Ok(entries) = std::fs::read_dir(&cdir) {
            for e in entries.flatten() {
                let root = e.path();
                if !root.is_dir() || root.is_symlink() {
                    continue;
                }
                let cfg = root.join(".claude.json");
                let doc = read_json_object(&cfg, 8 * 1024 * 1024);
                if let Some(a) = doc.get("oauthAccount").and_then(|v| v.as_object()) {
                    if let Some(u) = a.get("accountUuid").and_then(|v| v.as_str()) {
                        let org = a
                            .get("organizationUuid")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if account_identity("Claude", u, org) == account_id {
                            let mt = std::fs::metadata(&cfg)
                                .ok()
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_secs_f64())
                                .unwrap_or(0.0);
                            cands.push((mt, root));
                        }
                    }
                }
            }
        }
        cands.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let Some((_, best)) = cands.pop() else {
            return Err((
                409,
                "이 계정의 저장된 로그인을 찾지 못했습니다. 계정을 다시 추가해 주세요.".into(),
            ));
        };
        authorize_claude_profile(&best).map_err(|_| {
            (
                409,
                "계정 연결이 완료되지 않았습니다. 자동으로 다시 요청하지 않습니다.".into(),
            )
        })?;
        Ok(json!({
            "message": "계정을 연결했습니다. 백그라운드에서는 인증창을 띄우지 않습니다."
        }))
    }

    pub fn start(&self, kind: &str) -> Result<Value, (u16, String)> {
        if !matches!(
            kind,
            "Claude" | "Codex" | "Antigravity" | "Devin" | "Gemini"
        ) {
            return Err((
                400,
                "이 제공자의 추가 로그인 방식은 아직 연결되지 않았습니다.".into(),
            ));
        }
        let (bin_name, display_label) = match kind {
            "Claude" => ("claude", "Claude Code"),
            "Codex" => ("codex", "Codex"),
            "Antigravity" => ("agy", "Google Antigravity (Agy CLI)"),
            "Devin" => ("devin", "Devin"),
            "Gemini" => ("gemini", "Google Gemini"),
            _ => unreachable!(),
        };
        let cli = find_executable(bin_name)
            .ok_or_else(|| (409, format!("{display_label} CLI를 먼저 설치해 주세요.")))?;
        if kind == "Claude" {
            let out = Command::new(&cli).arg("--version").output().map_err(|_| {
                (
                    409,
                    "계정 분리를 위해 Claude Code 2.1.310 이상으로 업데이트해 주세요.".into(),
                )
            })?;
            let text = String::from_utf8_lossy(&out.stdout);
            let ok = semver_re().captures(&text).is_some_and(|c| {
                let v = (
                    c[1].parse::<u32>().unwrap_or(0),
                    c[2].parse::<u32>().unwrap_or(0),
                    c[3].parse::<u32>().unwrap_or(0),
                );
                v >= (2, 1, 310)
            });
            if !ok {
                return Err((
                    409,
                    "계정 분리를 위해 Claude Code 2.1.310 이상으로 업데이트해 주세요.".into(),
                ));
            }
        }
        let mut last = self.last.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
            return Err((409, "방금 연 로그인 창을 확인해 주세요.".into()));
        }

        let home_env = std::env::var("HOME")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| home_dir().to_string_lossy().into_owned());
        let user_env = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_default();
        let path_dir = Path::new(&cli)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default();
        let clean_path = if path_dir.is_empty() {
            "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin".to_string()
        } else {
            format!("{path_dir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")
        };

        // Shared CLI login flows (Antigravity / Devin / Gemini) use the tool's own default profile
        // in a clean environment so inherited OpenBot/WSL variables never interfere.
        if matches!(kind, "Antigravity" | "Devin" | "Gemini") {
            let parent = self.directory.join(kind.to_lowercase());
            let _ = std::fs::create_dir_all(&parent);
            let script = parent.join("Sign in to 1top.command");
            let (banner, cli_cmd) = match kind {
                "Antigravity" => (
                    "echo 'Google Antigravity (Agy CLI) 로그인을 시작합니다. 브라우저에서 Google 로그인을 마친 뒤 창을 닫아도 됩니다.'",
                    format!(
                        "/usr/bin/env -i HOME={} USER={} LOGNAME={} PATH={} AGY_CLI_DISABLE_AUTO_UPDATE=true {}",
                        sh_quote(&home_env),
                        sh_quote(&user_env),
                        sh_quote(&user_env),
                        sh_quote(&clean_path),
                        sh_quote(&cli)
                    ),
                ),
                "Devin" => (
                    "echo 'Devin CLI 로그인을 시작합니다.'",
                    format!(
                        "/usr/bin/env -i HOME={} USER={} LOGNAME={} PATH={} {} auth login",
                        sh_quote(&home_env),
                        sh_quote(&user_env),
                        sh_quote(&user_env),
                        sh_quote(&clean_path),
                        sh_quote(&cli)
                    ),
                ),
                "Gemini" => (
                    "echo 'Google Gemini CLI 로그인을 시작합니다.'",
                    format!(
                        "/usr/bin/env -i HOME={} USER={} LOGNAME={} PATH={} {}",
                        sh_quote(&home_env),
                        sh_quote(&user_env),
                        sh_quote(&user_env),
                        sh_quote(&clean_path),
                        sh_quote(&cli)
                    ),
                ),
                _ => unreachable!(),
            };
            let script_body = format!(
                "#!/bin/sh\numask 077\ncd {}\n{}\nexec {}\n",
                sh_quote(&home_env),
                banner,
                cli_cmd
            );
            std::fs::write(&script, script_body).map_err(|_| {
                (
                    500,
                    "로그인 터미널을 열지 못했습니다. 다시 시도해 주세요.".into(),
                )
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700));
            }
            Command::new("/usr/bin/open")
                .args(["-a", "Terminal", &script.to_string_lossy()])
                .status()
                .map_err(|_| {
                    (
                        500,
                        "로그인 터미널을 열지 못했습니다. 다시 시도해 주세요.".into(),
                    )
                })?;
            *last = Some(Instant::now());
            let msg = match kind {
                "Antigravity" => "Google (Agy CLI) 로그인 터미널을 열었습니다. 로그인을 마치면 1top이 자동으로 한도를 확인합니다.",
                "Devin" => "Devin 로그인 터미널을 열었습니다. 로그인 후 세션과 토큰이 자동으로 집계됩니다.",
                "Gemini" => "Google Gemini CLI 로그인 터미널을 열었습니다. (구독 한도 %는 Agy CLI에서 제공됩니다.)",
                _ => "공식 로그인 터미널을 열었습니다.",
            };
            return Ok(json!({"message": msg}));
        }

        let parent = self.directory.join(kind.to_lowercase());
        let _ = std::fs::create_dir_all(&parent);
        let count = std::fs::read_dir(&parent).map(|rd| rd.count()).unwrap_or(0);
        if count >= 32 {
            return Err((
                409,
                "저장된 프로필이 많습니다. 계정 프로필 폴더를 확인해 주세요.".into(),
            ));
        }
        let profile = parent.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&profile).map_err(|_| {
            (
                500,
                "로그인 터미널을 열지 못했습니다. 다시 시도해 주세요.".into(),
            )
        })?;
        let exe = std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "onetop-agent".into());
        if kind == "Claude" {
            let spec = profile.join("1top-statusline.json");
            let cmd_str = format!(
                "{} statusline --config {}",
                sh_quote(&exe),
                sh_quote(&spec.to_string_lossy())
            );
            let _ = write_atomic_json(
                &spec,
                &json!({
                    "profile": profile.to_string_lossy(),
                    "original_command": "",
                    "report_directory": data_directory(None).join("claude-statusline").to_string_lossy()
                }),
            );
            let _ = write_atomic_json(
                &profile.join("settings.json"),
                &json!({"statusLine": {"type": "command", "command": cmd_str}}),
            );
        }
        let script = profile.join("Sign in to 1top.command");
        let prof_str = profile.to_string_lossy().into_owned();
        let data_dir_str = data_directory(None).to_string_lossy().into_owned();
        let script_body = if kind == "Claude" {
            // After Claude CLI finishes OAuth login and writes its macOS Keychain entry,
            // immediately enroll it once into 1top's Keychain store so the new account works
            // right away instead of staying stuck on credential_store_unavailable.
            format!(
                "#!/bin/sh\numask 077\ncd {prof}\n/usr/bin/env -i HOME={home} USER={user} LOGNAME={user} PATH={path} CLAUDE_CONFIG_DIR={prof} {cli} auth login --claudeai\nstatus=$?\nif [ \"$status\" -eq 0 ] && [ -x {exe} ]; then\n  echo ''\n  echo '1top 키체인 연결을 승인해 주세요 (최초 1회만 묻습니다)...'\n  ONETOP_DATA={data} {exe} authorize-claude --profile {prof} >/dev/null 2>&1 && echo '1top 계정 연결 완료! 이 창을 닫아도 됩니다.' || echo '키체인 승인을 건너뛰었습니다. 1top 카드의 [다시 연결] 버튼으로 언제든 승인할 수 있습니다.'\nfi\nexit \"$status\"\n",
                prof = sh_quote(&prof_str),
                home = sh_quote(&home_env),
                user = sh_quote(&user_env),
                path = sh_quote(&clean_path),
                cli = sh_quote(&cli),
                exe = sh_quote(&exe),
                data = sh_quote(&data_dir_str),
            )
        } else {
            format!(
                "#!/bin/sh\numask 077\ncd {prof}\nexec /usr/bin/env -i HOME={home} USER={user} LOGNAME={user} PATH={path} CODEX_HOME={prof} {cli} -c 'cli_auth_credentials_store=\"file\"' login\n",
                prof = sh_quote(&prof_str),
                home = sh_quote(&home_env),
                user = sh_quote(&user_env),
                path = sh_quote(&clean_path),
                cli = sh_quote(&cli),
            )
        };
        std::fs::write(&script, script_body).map_err(|_| {
            (
                500,
                "로그인 터미널을 열지 못했습니다. 다시 시도해 주세요.".into(),
            )
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700));
        }
        Command::new("/usr/bin/open")
            .args(["-a", "Terminal", &script.to_string_lossy()])
            .status()
            .map_err(|_| {
                (
                    500,
                    "로그인 터미널을 열지 못했습니다. 다시 시도해 주세요.".into(),
                )
            })?;
        *last = Some(Instant::now());
        let msg = if kind == "Claude" {
            "공식 로그인 터미널을 열었습니다. 브라우저 로그인 직후 macOS 키체인 허용을 1회 승인하면 바로 연결됩니다."
        } else {
            "공식 로그인 터미널을 열었습니다. 브라우저에서 로그인하면 최대 2분 내에 계정이 표시됩니다."
        };
        Ok(json!({ "message": msg }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_and_glm_window_parsing() {
        let td = tempfile::tempdir().unwrap();
        let ids: HashSet<String> = ["claude:abc".to_string()].into_iter().collect();
        assert_eq!(
            set_alias(td.path(), "claude:abc", "Work", &ids),
            Ok("Work".into())
        );
        assert_eq!(
            read_aliases(td.path())
                .get("claude:abc")
                .map(String::as_str),
            Some("Work")
        );

        let now = 1795600000.0;
        let payload = json!({
            "success": true,
            "code": 200,
            "data": {
                "limits": [
                    {"type": "TIME_LIMIT", "unit": 5, "number": 1, "percentage": 10, "nextResetTime": (now + 3600.0) * 1000.0},
                    {"type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 42, "nextResetTime": (now + 3600.0) * 1000.0}
                ]
            }
        });
        let ws = glm_windows(payload.as_object().unwrap(), now).unwrap();
        assert_eq!(ws.len(), 2);
        assert_eq!(ws[0]["period"], "5h");
        assert_eq!(ws[1]["period"], "monthly");
    }

    #[test]
    fn refresh_managed_claude_rejects_unmanaged_profiles() {
        let td = tempfile::tempdir().unwrap();
        assert_eq!(
            refresh_managed_claude(td.path(), 1_795_600_000.0, false),
            Err("login_expired")
        );
    }

    #[test]
    fn clean_env_excludes_wsl_and_antigravity_overrides() {
        let kept: HashSet<&str> = clean_subprocess_env().into_iter().map(|(k, _)| k).collect();
        for forbidden in [
            "WSL_DISTRO_NAME",
            "WSL_INTEROP",
            "GEMINI_HOME",
            "ANTIGRAVITY_APP_DATA_DIR",
            "AGY_CLI_FORCE_FILE_TOKEN_STORAGE",
            "OPENBOT_AGENT_PROCESS",
        ] {
            assert!(!kept.contains(forbidden), "leaked env var: {forbidden}");
        }
    }

    #[test]
    fn save_glm_validates_and_persists_profile() {
        let td = tempfile::tempdir().unwrap();
        let login = AccountLogin::new(Some(td.path().to_path_buf()));
        assert!(login.save_glm("evil.example", "secret-key").is_err());
        assert!(login.save_glm("api.z.ai", "bad key with spaces").is_err());
        let saved = login
            .save_glm("api.z.ai", "Bearer test-glm-key-123")
            .unwrap();
        assert!(saved
            .get("id")
            .and_then(|v| v.as_str())
            .is_some_and(|s| s.starts_with("glm:")));
        let glm_files: Vec<_> = std::fs::read_dir(td.path().join("glm"))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(glm_files.len(), 1);
    }
}
