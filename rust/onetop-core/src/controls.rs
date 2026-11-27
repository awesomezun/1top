//! Complete port of `controls.py`, `mailbox.py`, and `message_images.py`.
use crate::platform_support::{data_directory, home_dir};
use crate::sessions::{control_display, orca_executable, sha256_hex};
use crate::text::epoch_from_value;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const RESUME_PROMPT: &str = "이전에 중단된 작업을 이어서 진행해 주세요. 먼저 현재 진행 상태와 이미 완료한 변경을 확인하고, 중복 실행을 피해서 계속해 주세요.";
const MAX_IMAGE_BYTES: usize = 524_288;
const MAX_IMAGES: usize = 3;
const MAX_STORE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_REPLY: usize = 8000;

fn uuid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$").unwrap())
}

fn digest_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-f0-9]{64}$").unwrap())
}

fn reply_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"\[1top-reply:([a-f0-9-]{36})\]([\s\S]*?)\[/1top-reply\]").unwrap()
    })
}

fn now_epoch() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[derive(Debug, Clone)]
pub struct ActionError {
    pub status: u16,
    pub message: String,
    pub busy: bool,
}

impl ActionError {
    pub fn new(message: impl Into<String>, status: u16) -> Self {
        Self {
            status,
            message: message.into(),
            busy: false,
        }
    }

    pub fn busy(message: impl Into<String>) -> Self {
        Self {
            status: 409,
            message: message.into(),
            busy: true,
        }
    }
}

pub fn mailbox_readable(spec: &Map<String, Value>) -> bool {
    let has_path = spec
        .get("path")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty());
    let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    has_path && matches!(kind, "Claude" | "GLM" | "Codex" | "Aside")
}

pub fn accepts_instruction(spec: &Map<String, Value>) -> bool {
    if spec
        .get("control_key")
        .and_then(|v| v.as_str())
        .is_none_or(str::is_empty)
    {
        return false;
    }
    let state = spec
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "Aside" {
        return matches!(
            state,
            "working" | "idle" | "interrupted" | "done" | "subagents"
        );
    }
    spec.get("orca_terminal").is_some_and(|v| v.is_object())
        && spec.get("input_verified").and_then(|v| v.as_bool()) == Some(true)
        && matches!(kind, "Claude" | "GLM" | "Codex")
        && matches!(state, "idle" | "interrupted" | "done" | "subagents")
        && spec.get("display_status").and_then(|v| v.as_str()) != Some("resuming")
}

pub fn accepts_message(spec: &Map<String, Value>) -> bool {
    if !mailbox_readable(spec) {
        return false;
    }
    if accepts_instruction(spec) {
        return true;
    }
    let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    let state = spec
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    spec.get("control_key")
        .and_then(|v| v.as_str())
        .is_some_and(|s| !s.is_empty())
        && spec.get("orca_terminal").is_some_and(|v| v.is_object())
        && spec.get("input_verified").and_then(|v| v.as_bool()) == Some(true)
        && matches!(kind, "Claude" | "GLM" | "Codex")
        && matches!(
            state,
            "working" | "idle" | "interrupted" | "done" | "subagents"
        )
}

pub fn instruction_text(value: Option<&Value>) -> Result<String, ActionError> {
    let Some(s) = value.and_then(|v| v.as_str()) else {
        return Err(ActionError::new(
            "지시는 1–4,000자 텍스트로 입력하세요. 제어 문자는 사용할 수 없습니다.",
            400,
        ));
    };
    if s.trim().is_empty()
        || s.chars().count() > 4000
        || s.chars()
            .any(|c| ((c as u32) < 32 && c != '\n' && c != '\t') || (c as u32) == 127)
    {
        return Err(ActionError::new(
            "지시는 1–4,000자 텍스트로 입력하세요. 제어 문자는 사용할 수 없습니다.",
            400,
        ));
    }
    Ok(s.to_string())
}

pub fn terminal_title(value: Option<&Value>) -> Result<String, ActionError> {
    let Some(s) = value.and_then(|v| v.as_str()) else {
        return Err(ActionError::new(
            "터미널 제목은 제어 문자 없이 1–80자로 입력하세요.",
            400,
        ));
    };
    let trimmed = s.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > 80
        || s.chars().any(|c| (c as u32) < 32 || (c as u32) == 127)
    {
        return Err(ActionError::new(
            "터미널 제목은 제어 문자 없이 1–80자로 입력하세요.",
            400,
        ));
    }
    Ok(trimmed.to_string())
}

// ---------------- message_images ----------------

#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: usize,
    pub data: Vec<u8>,
    pub path: Option<String>,
}

fn image_dimensions(data: &[u8], mime: &str) -> Result<(u32, u32), &'static str> {
    if mime == "image/png"
        && data.starts_with(b"\x89PNG\r\n\x1a\n")
        && data.len() >= 45
        && &data[12..16] == b"IHDR"
        && &data[data.len() - 12..] == b"\x00\x00\x00\x00IEND\xaeB`\x82"
    {
        let w = u32::from_be_bytes(data[16..20].try_into().unwrap());
        let h = u32::from_be_bytes(data[20..24].try_into().unwrap());
        return Ok((w, h));
    }
    if mime == "image/jpeg" && data.starts_with(&[0xff, 0xd8]) && data.ends_with(&[0xff, 0xd9]) {
        let mut pos = 2;
        while pos + 4 <= data.len() {
            if data[pos] != 0xff {
                break;
            }
            while pos < data.len() && data[pos] == 0xff {
                pos += 1;
            }
            if pos >= data.len() {
                break;
            }
            let marker = data[pos];
            pos += 1;
            if matches!(marker, 0xd9 | 0xda) {
                break;
            }
            if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
                continue;
            }
            if pos + 2 > data.len() {
                break;
            }
            let len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
            if len < 2 || pos + len > data.len() {
                break;
            }
            if matches!(marker, 0xc0..=0xc2) && len >= 8 {
                let h = u16::from_be_bytes([data[pos + 3], data[pos + 4]]) as u32;
                let w = u16::from_be_bytes([data[pos + 5], data[pos + 6]]) as u32;
                return Ok((w, h));
            }
            pos += len;
        }
    }
    Err("Attach a valid JPEG or PNG image.")
}

pub fn decode_images(items: Option<&Value>) -> Result<Vec<DecodedImage>, &'static str> {
    let Some(val) = items else {
        return Ok(Vec::new());
    };
    let arr = val.as_array().ok_or("Attach up to 3 images.")?;
    if arr.len() > MAX_IMAGES {
        return Err("Attach up to 3 images.");
    }
    let mut result = Vec::new();
    for item in arr {
        let obj = item
            .as_object()
            .ok_or("Only JPEG and PNG images are supported.")?;
        let mime = obj
            .get("mime")
            .and_then(|v| v.as_str())
            .filter(|m| matches!(*m, "image/jpeg" | "image/png"))
            .ok_or("Only JPEG and PNG images are supported.")?;
        let raw = obj
            .get("data")
            .and_then(|v| v.as_str())
            .filter(|s| s.len() <= 4 * MAX_IMAGE_BYTES.div_ceil(3))
            .ok_or("Each image must be 512 KiB or smaller.")?;
        let data = base64::engine::general_purpose::STANDARD
            .decode(raw)
            .map_err(|_| "Invalid image encoding.")?;
        if data.is_empty() || data.len() > MAX_IMAGE_BYTES {
            return Err("Each image must be 512 KiB or smaller.");
        }
        let (w, h) = image_dimensions(&data, mime)?;
        if w == 0 || w > 4096 || h == 0 || h > 4096 || u64::from(w) * u64::from(h) > 12_000_000 {
            return Err("Image dimensions are too large.");
        }
        let digest = sha256_hex(&data);
        let ext = if mime == "image/jpeg" { ".jpg" } else { ".png" };
        result.push(DecodedImage {
            id: digest,
            name: format!("Image {}{ext}", result.len() + 1),
            mime: mime.to_string(),
            bytes: data.len(),
            data,
            path: None,
        });
    }
    Ok(result)
}

pub fn public_images(images: &[DecodedImage]) -> Vec<Value> {
    images
        .iter()
        .map(|r| json!({"id": r.id, "name": r.name, "mime": r.mime, "bytes": r.bytes}))
        .collect()
}

pub fn image_prompt(text: &str, images: &[DecodedImage]) -> String {
    if images.is_empty() {
        return text.to_string();
    }
    let paths: Vec<String> = images
        .iter()
        .filter_map(|r| r.path.as_deref())
        .map(|p| serde_json::to_string(p).unwrap_or_default())
        .collect();
    format!(
        "{text}\n\nAttached images on this computer. Open these files to inspect them:\n{}",
        paths.join("\n")
    )
}

pub struct ImageStore {
    root: PathBuf,
}

impl ImageStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path_for(
        &self,
        rid: &str,
        sid: &str,
        id: &str,
        mime: &str,
    ) -> Result<PathBuf, &'static str> {
        if !uuid_re().is_match(rid) || !digest_re().is_match(id) {
            return Err("Invalid image reference.");
        }
        let ext = match mime {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            _ => return Err("Invalid image type."),
        };
        let scope = &sha256_hex(sid.as_bytes())[..24];
        Ok(self.root.join(format!("{scope}-{rid}-{id}{ext}")))
    }

    pub fn stage(
        &self,
        rid: &str,
        sid: &str,
        images: Vec<DecodedImage>,
    ) -> Result<Vec<DecodedImage>, &'static str> {
        if images.is_empty() {
            return Ok(Vec::new());
        }
        std::fs::create_dir_all(&self.root).map_err(|_| "Attachment storage is unavailable.")?;
        if self.root.is_symlink() {
            return Err("Attachment storage is unavailable.");
        }
        let mut used: u64 = 0;
        if let Ok(rd) = std::fs::read_dir(&self.root) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_file() && !p.is_symlink() {
                    used += e.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        }
        let extra: u64 = images.iter().map(|i| i.data.len() as u64).sum();
        if used + extra > MAX_STORE_BYTES {
            return Err(
                "Local photo storage is full. Remove old files from the 1top attachments folder.",
            );
        }
        let mut out = Vec::with_capacity(images.len());
        for mut img in images {
            let path = self.path_for(rid, sid, &img.id, &img.mime)?;
            if !path.exists() {
                std::fs::write(&path, &img.data)
                    .map_err(|_| "Attachment storage is unavailable.")?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
                }
            }
            let canon = std::fs::canonicalize(&path).unwrap_or(path);
            img.path = Some(canon.to_string_lossy().into_owned());
            out.push(img);
        }
        Ok(out)
    }

    pub fn restore(
        &self,
        rid: &str,
        sid: &str,
        refs: &[Value],
    ) -> Result<Vec<DecodedImage>, &'static str> {
        if refs.len() > MAX_IMAGES {
            return Err("Too many image references.");
        }
        let mut out = Vec::with_capacity(refs.len());
        for r in refs {
            let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = r.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let mime = r.get("mime").and_then(|v| v.as_str()).unwrap_or("");
            let bytes = r.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let path = self.path_for(rid, sid, id, mime)?;
            if path.is_symlink() {
                return Err("The stored image changed. Nothing sent.");
            }
            let data =
                std::fs::read(&path).map_err(|_| "The stored image changed. Nothing sent.")?;
            if data.len() != bytes || sha256_hex(&data) != id {
                return Err("The stored image changed. Nothing sent.");
            }
            let canon = std::fs::canonicalize(&path).unwrap_or(path);
            out.push(DecodedImage {
                id: id.to_string(),
                name: name.to_string(),
                mime: mime.to_string(),
                bytes,
                data,
                path: Some(canon.to_string_lossy().into_owned()),
            });
        }
        Ok(out)
    }
}

// ---------------- Mailbox ----------------

#[cfg(unix)]
fn file_ino(meta: &std::fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    meta.ino()
}

#[cfg(not(unix))]
fn file_ino(_meta: &std::fs::Metadata) -> u64 {
    0
}

fn assistant_text(record: &Map<String, Value>, kind: &str) -> String {
    let msg_opt = if kind == "Codex" {
        if record.get("type").and_then(|v| v.as_str()) != Some("response_item") {
            return String::new();
        }
        let p = record.get("payload").and_then(|v| v.as_object());
        if p.and_then(|m| m.get("type")).and_then(|v| v.as_str()) != Some("message")
            || p.and_then(|m| m.get("channel")).and_then(|v| v.as_str()) == Some("analysis")
        {
            return String::new();
        }
        p
    } else if kind == "Aside" {
        Some(record)
    } else {
        if record.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            return String::new();
        }
        record.get("message").and_then(|v| v.as_object())
    };
    let Some(msg) = msg_opt else {
        return String::new();
    };
    if msg.get("role").and_then(|v| v.as_str()) != Some("assistant") {
        return String::new();
    }
    match msg.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|b| b.as_object())
            .filter(|b| {
                matches!(
                    b.get("type").and_then(|v| v.as_str()),
                    Some("text" | "output_text")
                )
            })
            .filter_map(|b| b.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

pub struct Mailbox {
    path: Option<PathBuf>,
    records: Mutex<Vec<Map<String, Value>>>,
}

impl Mailbox {
    pub fn new(path: Option<PathBuf>) -> Self {
        let initial = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v.as_array().cloned())
            .map(|arr| {
                arr.into_iter()
                    .filter_map(|x| x.as_object().cloned())
                    .collect()
            })
            .unwrap_or_default();
        Self {
            path,
            records: Mutex::new(initial),
        }
    }

    fn save_locked(&self, recs: &mut Vec<Map<String, Value>>) {
        let finished_ids: HashSet<String> = {
            let fin: Vec<&Map<String, Value>> = recs
                .iter()
                .filter(|r| {
                    matches!(
                        r.get("status").and_then(|v| v.as_str()),
                        Some("replied" | "not_delivered")
                    )
                })
                .collect();
            let skip = fin.len().saturating_sub(200);
            fin[skip..]
                .iter()
                .filter_map(|r| r.get("id").and_then(|v| v.as_str()).map(str::to_string))
                .collect()
        };
        recs.retain(|r| {
            let st = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
            let id = r.get("id").and_then(|v| v.as_str()).unwrap_or("");
            !matches!(st, "replied" | "not_delivered") || finished_ids.contains(id)
        });
        let Some(ref path) = self.path else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = path.with_extension("tmp");
        let val = Value::Array(recs.iter().cloned().map(Value::Object).collect());
        if std::fs::write(&tmp, serde_json::to_string(&val).unwrap_or_default()).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
            }
            let _ = std::fs::rename(&tmp, path);
        }
    }

    pub fn enqueue(
        &self,
        spec: &Map<String, Value>,
        rid: &str,
        text: &str,
        images: &[DecodedImage],
    ) -> Result<Map<String, Value>, &'static str> {
        if !uuid_re().is_match(rid) || !mailbox_readable(spec) {
            return Err("This session has no verified reply reader.");
        }
        let sid = spec.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let ckey = spec
            .get("control_key")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let pub_imgs = Value::Array(public_images(images));
        let mut recs = self.records.lock().unwrap();
        if let Some(prev) = recs
            .iter()
            .find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid))
        {
            if prev.get("session_id").and_then(|v| v.as_str()) != Some(sid)
                || prev.get("text").and_then(|v| v.as_str()) != Some(text)
                || prev
                    .get("attachments")
                    .cloned()
                    .unwrap_or_else(|| json!([]))
                    != pub_imgs
            {
                return Err("Message ID already used with different content.");
            }
            return Ok(prev.clone());
        }
        let pending = recs
            .iter()
            .filter(|r| {
                !matches!(
                    r.get("status").and_then(|v| v.as_str()),
                    Some("replied" | "not_delivered")
                )
            })
            .count();
        if pending >= 100 {
            return Err("There are 100 pending messages. Check their results before sending more.");
        }
        let mut row = Map::new();
        row.insert("id".into(), json!(rid));
        row.insert("session_id".into(), json!(sid));
        row.insert("control_key".into(), json!(ckey));
        row.insert("text".into(), json!(text));
        row.insert("created".into(), json!(now_epoch()));
        row.insert("status".into(), json!("queued"));
        row.insert("reply".into(), json!(""));
        row.insert("attachments".into(), pub_imgs);
        recs.push(row.clone());
        self.save_locked(&mut recs);
        Ok(row)
    }

    pub fn begin(
        &self,
        spec: &Map<String, Value>,
        rid: &str,
        text: &str,
        images: &[DecodedImage],
    ) -> Result<String, &'static str> {
        if !uuid_re().is_match(rid) || !mailbox_readable(spec) {
            return Err("This session has no verified reply reader.");
        }
        let sid = spec.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let path_str = spec.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let meta =
            std::fs::metadata(path_str).map_err(|_| "Session reply source is unavailable.")?;
        if !meta.is_file() {
            return Err("Session reply source is unavailable.");
        }
        let mut recs = self.records.lock().unwrap();
        let existing_pos = recs
            .iter()
            .position(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid));
        let created = if let Some(idx) = existing_pos {
            let prev = &recs[idx];
            if prev.get("status").and_then(|v| v.as_str()) != Some("queued")
                || prev.get("text").and_then(|v| v.as_str()) != Some(text)
                || prev.get("session_id").and_then(|v| v.as_str()) != Some(sid)
            {
                return Err("Message ID already used; check the existing message.");
            }
            prev.get("created")
                .and_then(|v| v.as_f64())
                .unwrap_or_else(now_epoch)
        } else {
            now_epoch()
        };
        let mut row = Map::new();
        row.insert("id".into(), json!(rid));
        row.insert("session_id".into(), json!(sid));
        row.insert("text".into(), json!(text));
        row.insert("created".into(), json!(created));
        row.insert("status".into(), json!("sending"));
        row.insert("reply".into(), json!(""));
        row.insert("path".into(), json!(path_str));
        row.insert("inode".into(), json!(file_ino(&meta)));
        row.insert("offset".into(), json!(meta.len()));
        row.insert("kind".into(), json!(kind));
        row.insert("attachments".into(), Value::Array(public_images(images)));
        row.insert("started_at".into(), json!(now_epoch()));
        if let Some(idx) = existing_pos {
            for (k, v) in row {
                recs[idx].insert(k, v);
            }
        } else {
            recs.push(row);
        }
        self.save_locked(&mut recs);
        Ok(format!(
            "{}\n\n1top reply: [1top-reply:{rid}]...[/1top-reply]",
            image_prompt(text, images)
        ))
    }

    pub fn queued(&self) -> Vec<Map<String, Value>> {
        self.records
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.get("status").and_then(|v| v.as_str()) == Some("queued"))
            .cloned()
            .collect()
    }

    pub fn pending_sessions(&self) -> HashSet<String> {
        self.records
            .lock()
            .unwrap()
            .iter()
            .filter(|r| {
                r.get("path")
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty())
                    && !matches!(
                        r.get("status").and_then(|v| v.as_str()),
                        Some("replied" | "queued" | "not_delivered")
                    )
            })
            .filter_map(|r| {
                r.get("session_id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .collect()
    }

    pub fn delivery(&self, rid: &str, status: &str) {
        let mut recs = self.records.lock().unwrap();
        if let Some(row) = recs
            .iter_mut()
            .find(|r| r.get("id").and_then(|v| v.as_str()) == Some(rid))
        {
            if row.get("status").and_then(|v| v.as_str()) != Some("replied") {
                row.insert("status".into(), json!(status));
                row.insert("updated_at".into(), json!(now_epoch()));
                self.save_locked(&mut recs);
            }
        }
    }

    pub fn rebind(&self, spec: &Map<String, Value>) {
        let prev_ids: HashSet<String> = spec
            .get("previous_session_ids")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let Some(ckey) = spec
            .get("control_key")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        else {
            return;
        };
        if prev_ids.is_empty() {
            return;
        }
        let sid = spec.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let ckeys: HashSet<&str> = spec
            .get("continuation_keys")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str()).collect())
            .unwrap_or_default();
        let paths: HashSet<&str> = spec
            .get("continuation_sources")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.get("path").and_then(|v| v.as_str()))
                    .collect()
            })
            .unwrap_or_default();
        let mut recs = self.records.lock().unwrap();
        let mut changed = false;
        for row in recs.iter_mut() {
            let rsid = row.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            if !prev_ids.contains(rsid) {
                continue;
            }
            let verified = if row.get("status").and_then(|v| v.as_str()) == Some("queued") {
                row.get("control_key")
                    .and_then(|v| v.as_str())
                    .is_some_and(|k| ckeys.contains(k))
            } else {
                row.get("path")
                    .and_then(|v| v.as_str())
                    .is_some_and(|p| paths.contains(p))
                    && row.get("kind").and_then(|v| v.as_str()) == Some(kind)
            };
            if verified {
                row.insert("session_id".into(), json!(sid));
                row.insert("control_key".into(), json!(ckey));
                changed = true;
            }
        }
        if changed {
            self.save_locked(&mut recs);
        }
    }

    pub fn read(&self, spec: &Map<String, Value>) -> Vec<Value> {
        let sid = spec.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let spec_status = spec.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let mut recs = self.records.lock().unwrap();
        let mut changed = false;

        for row in recs.iter_mut() {
            if row.get("session_id").and_then(|v| v.as_str()) != Some(sid) {
                continue;
            }
            let st = row.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if matches!(st, "replied" | "queued" | "not_delivered") {
                continue;
            }
            let Some(pstr) = row
                .get("path")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
            else {
                continue;
            };
            let kind = row
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let rid = row
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let ino = row.get("inode").and_then(|v| v.as_u64()).unwrap_or(0);
            let offset = row.get("offset").and_then(|v| v.as_u64()).unwrap_or(0);
            let Ok(meta) = std::fs::metadata(&pstr) else {
                continue;
            };
            if file_ino(&meta) != ino || meta.len() < offset {
                if st != "source_changed" {
                    row.insert("status".into(), json!("source_changed"));
                    changed = true;
                }
                continue;
            }
            let Ok(mut f) = File::open(&pstr) else {
                continue;
            };
            if f.seek(SeekFrom::Start(offset)).is_err() {
                continue;
            }
            let mut data = Vec::new();
            if f.take(4 * 1024 * 1024).read_to_end(&mut data).is_err() {
                continue;
            }
            let complete = data
                .iter()
                .rposition(|&b| b == b'\n')
                .map(|i| i + 1)
                .unwrap_or(0);
            if complete == 0 {
                if data.len() == 4 * 1024 * 1024 {
                    row.insert("offset".into(), json!(offset + data.len() as u64));
                    changed = true;
                }
                continue;
            }
            for line in data[..complete].split(|&b| b == b'\n') {
                if line.is_empty() {
                    continue;
                }
                let Ok(Value::Object(rec)) = serde_json::from_slice::<Value>(line) else {
                    continue;
                };
                let visible = assistant_text(&rec, &kind);
                for caps in reply_re().captures_iter(&visible) {
                    if caps[1] == *rid {
                        let body = caps[2].trim();
                        if !body.is_empty() {
                            let trunc = body.chars().count() > MAX_REPLY;
                            let clipped: String = body.chars().take(MAX_REPLY).collect();
                            row.insert("reply".into(), json!(clipped));
                            row.insert("status".into(), json!("replied"));
                            row.insert("reply_at".into(), json!(now_epoch()));
                            row.insert("truncated".into(), json!(trunc));
                        }
                    }
                }
            }
            row.insert("offset".into(), json!(offset + complete as u64));
            changed = true;
        }
        if changed {
            self.save_locked(&mut recs);
        }

        let mut matching: Vec<&Map<String, Value>> = recs
            .iter()
            .filter(|r| r.get("session_id").and_then(|v| v.as_str()) == Some(sid))
            .collect();
        matching.sort_by(|a, b| {
            let ta = epoch_from_value(a.get("created"))
                .max(epoch_from_value(a.get("updated_at")))
                .max(epoch_from_value(a.get("reply_at")));
            let tb = epoch_from_value(b.get("created"))
                .max(epoch_from_value(b.get("updated_at")))
                .max(epoch_from_value(b.get("reply_at")));
            ta.partial_cmp(&tb).unwrap_or(std::cmp::Ordering::Equal)
        });
        let skip = matching.len().saturating_sub(10);
        let mut recent = matching[skip..].to_vec();
        recent.sort_by(|a, b| {
            let ca = epoch_from_value(a.get("created"));
            let cb = epoch_from_value(b.get("created"));
            let ia = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ib = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
            ca.partial_cmp(&cb)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| ia.cmp(ib))
        });

        recent
            .into_iter()
            .map(|r| {
                let mut m = Map::new();
                for k in [
                    "id",
                    "text",
                    "created",
                    "status",
                    "reply",
                    "reply_at",
                    "truncated",
                    "attachments",
                ] {
                    if let Some(v) = r.get(k) {
                        m.insert(k.into(), v.clone());
                    }
                }
                let act_vis = r.get("status").and_then(|v| v.as_str()) == Some("awaiting_reply")
                    && spec_status == "working"
                    && r.get("_activity_done").and_then(|v| v.as_bool()) != Some(true);
                m.insert(
                    "activity".into(),
                    if act_vis {
                        r.get("activity").cloned().unwrap_or(Value::Null)
                    } else {
                        Value::Null
                    },
                );
                Value::Object(m)
            })
            .collect()
    }
}

// ---------------- Controller ----------------

pub fn process_start(pid: u32) -> Option<String> {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn terminate_pid(pid: u32, started: &str) -> Result<bool, ActionError> {
    if pid <= 1
        || pid == std::process::id()
        || started.is_empty()
        || process_start(pid).as_deref() != Some(started)
    {
        return Err(ActionError::new(
            "프로세스가 변경되었습니다. 새로고침 후 다시 확인하세요.",
            409,
        ));
    }
    let _ = Command::new("/bin/kill")
        .args(["-TERM", &pid.to_string()])
        .status();
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if process_start(pid).as_deref() != Some(started) {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Ok(false)
}

#[derive(Default)]
struct ControllerState {
    paused: HashMap<String, Map<String, Value>>,
    audit: Vec<Value>,
}

pub struct Controller {
    state_file: Option<PathBuf>,
    pub mailbox: Mailbox,
    pub images: ImageStore,
    exec_lock: Mutex<()>,
    state: Mutex<ControllerState>,
    receipts: Mutex<HashMap<String, (String, Value)>>,
    interrupted: Mutex<HashMap<String, Instant>>,
}

impl Controller {
    pub fn new(state_file: Option<PathBuf>) -> Self {
        let mut init = ControllerState::default();
        if let Some(ref sf) = state_file {
            if let Ok(raw) = std::fs::read_to_string(sf) {
                if let Ok(val) = serde_json::from_str::<Value>(&raw) {
                    if let Some(p) = val.get("paused").and_then(|v| v.as_object()) {
                        for (k, v) in p {
                            if let Some(mo) = v.as_object() {
                                init.paused.insert(k.clone(), mo.clone());
                            }
                        }
                    }
                    if let Some(a) = val.get("audit").and_then(|v| v.as_array()) {
                        let skip = a.len().saturating_sub(50);
                        init.audit = a[skip..].to_vec();
                    }
                }
            }
        }
        let mailbox_path = state_file
            .as_ref()
            .map(|p| p.with_file_name("session-mailbox.json"));
        let att_dir = state_file
            .as_ref()
            .and_then(|p| p.parent().map(|d| d.join("attachments")))
            .unwrap_or_else(|| data_directory(None).join("attachments"));
        Self {
            state_file,
            mailbox: Mailbox::new(mailbox_path),
            images: ImageStore::new(att_dir),
            exec_lock: Mutex::new(()),
            state: Mutex::new(init),
            receipts: Mutex::new(HashMap::new()),
            interrupted: Mutex::new(HashMap::new()),
        }
    }

    fn save_state_locked(&self, st: &ControllerState) {
        let Some(ref sf) = self.state_file else {
            return;
        };
        if let Some(parent) = sf.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let skip = st.audit.len().saturating_sub(50);
        let payload = json!({
            "paused": st.paused,
            "audit": &st.audit[skip..]
        });
        let tmp = sf.with_extension("tmp");
        if std::fs::write(&tmp, serde_json::to_string(&payload).unwrap_or_default()).is_ok() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
            }
            let _ = std::fs::rename(&tmp, sf);
        }
    }

    fn remember(&self, sid: &str, key: &str, phase: Option<&str>) {
        let mut st = self.state.lock().unwrap();
        if let Some(ph) = phase {
            let mut m = Map::new();
            m.insert("key".into(), json!(key));
            m.insert("phase".into(), json!(ph));
            m.insert("at".into(), json!(now_epoch()));
            st.paused.insert(sid.to_string(), m);
        } else {
            st.paused.remove(sid);
        }
        self.save_state_locked(&st);
    }

    pub fn decorate(&self, snapshot: &Map<String, Value>) -> Map<String, Value> {
        let mut st = self.state.lock().unwrap();
        let mut changed = false;
        let mut sessions = Vec::new();
        let mut decorated_map: HashMap<String, String> = HashMap::new();
        if let Some(src_list) = snapshot.get("sessions").and_then(|v| v.as_array()) {
            for sv in src_list {
                let Some(mut s) = sv.as_object().cloned() else {
                    continue;
                };
                let sid = s
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let mark = st.paused.get(&sid).cloned();
                let (disp, valid) = control_display(&s, mark.as_ref());
                if mark.is_some() && !valid {
                    st.paused.remove(&sid);
                    changed = true;
                } else if let Some(m) = mark {
                    s.insert("pause_state".into(), Value::Object(m));
                }
                s.insert("display_status".into(), json!(disp));
                decorated_map.insert(sid, disp);
                sessions.push(Value::Object(s));
            }
        }
        if changed {
            self.save_state_locked(&st);
        }
        let mut result = snapshot.clone();
        result.insert("sessions".into(), Value::Array(sessions));
        let skip = st.audit.len().saturating_sub(20);
        result.insert("actions".into(), Value::Array(st.audit[skip..].to_vec()));
        result.insert("resume_prompt".into(), json!(RESUME_PROMPT));
        if let Some(roots) = snapshot.get("root_sessions").and_then(|v| v.as_array()) {
            let updated_roots: Vec<Value> = roots
                .iter()
                .map(|r| {
                    let mut ro = r.as_object().cloned().unwrap_or_default();
                    let rid = ro.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let disp = decorated_map
                        .get(rid)
                        .cloned()
                        .or_else(|| {
                            ro.get("status")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                        })
                        .unwrap_or_else(|| "unknown".into());
                    ro.insert("display_status".into(), json!(disp));
                    Value::Object(ro)
                })
                .collect();
            result.insert("root_sessions".into(), Value::Array(updated_roots));
        }
        result
    }

    pub fn read_mailbox(
        &self,
        snapshot: &Map<String, Value>,
        sid: &str,
        key: &str,
    ) -> Result<Vec<Value>, ActionError> {
        let updated = snapshot
            .get("updated")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if now_epoch() - updated > 20.0 {
            return Err(ActionError::new("Computer report is stale.", 409));
        }
        let spec = find_session_matching(snapshot, sid, key, true)
            .filter(|s| !key.is_empty() && mailbox_readable(s))
            .ok_or_else(|| ActionError::new("Session reply source is unavailable.", 409))?;
        self.mailbox.rebind(spec);
        Ok(self.mailbox.read(spec))
    }

    fn orca_cmd(&self, args: &[&str]) -> Result<Map<String, Value>, ActionError> {
        let mut cmd = Command::new(orca_executable());
        cmd.arg("terminal").args(args).arg("--json");
        let out = cmd.output().map_err(|_| {
            ActionError::new(
                "Orca 응답을 확인하지 못했습니다. 터미널 상태를 확인하세요.",
                502,
            )
        })?;
        let val: Value = serde_json::from_slice(&out.stdout).map_err(|_| {
            ActionError::new(
                "Orca 응답을 확인하지 못했습니다. 터미널 상태를 확인하세요.",
                502,
            )
        })?;
        if !out.status.success() || val.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err(ActionError::new(
                "Orca에서 동작을 처리하지 못했습니다. 터미널 연결을 확인하세요.",
                502,
            ));
        }
        Ok(val
            .get("result")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default())
    }

    fn interrupt_spec(&self, spec: &Map<String, Value>) -> Result<(), ActionError> {
        let term = spec
            .get("orca_terminal")
            .and_then(|v| v.as_object())
            .ok_or_else(|| ActionError::new("연결된 Orca 터미널이 없습니다.", 409))?;
        if spec.get("input_verified").and_then(|v| v.as_bool()) == Some(false) {
            return Err(ActionError::new(
                "이 터미널의 입력을 받을 CLI를 하나로 확인할 수 없습니다. 터미널에서 직접 확인하세요.",
                409,
            ));
        }
        let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        if !matches!(kind, "Claude" | "GLM" | "Codex") {
            return Err(ActionError::new(
                "이 CLI의 작업 중단 키는 아직 검증되지 않았습니다.",
                409,
            ));
        }
        let key = spec
            .get("control_key")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        {
            let map = self.interrupted.lock().unwrap();
            if map
                .get(key)
                .is_some_and(|t| t.elapsed() < Duration::from_secs(8))
            {
                return Err(ActionError::new(
                    "중단 요청을 이미 보냈습니다. 상태 갱신을 기다려 주세요.",
                    409,
                ));
            }
        }
        let handle = term.get("handle").and_then(|v| v.as_str()).unwrap_or("");
        self.orca_cmd(&["send", "--terminal", handle, "--text", "\x1b"])?;
        self.interrupted
            .lock()
            .unwrap()
            .insert(key.to_string(), Instant::now());
        Ok(())
    }

    pub fn execute(
        &self,
        snapshot: &Map<String, Value>,
        payload: &Map<String, Value>,
        dispatch_queued: bool,
    ) -> Result<Value, ActionError> {
        let action = payload.get("action").and_then(|v| v.as_str()).unwrap_or("");
        let sid = payload
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let key = payload
            .get("control_key")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let rid = payload
            .get("request_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let valid_action = matches!(
            action,
            "focus"
                | "interrupt"
                | "pause"
                | "resume"
                | "terminate"
                | "prompt"
                | "message"
                | "rename"
        );
        let (Some(sid), Some(key), Some(rid)) = (sid, key, rid) else {
            return Err(ActionError::new("잘못된 동작 요청입니다.", 400));
        };
        if !valid_action {
            return Err(ActionError::new("잘못된 동작 요청입니다.", 400));
        }
        let prompt = if matches!(action, "prompt" | "message") {
            Some(instruction_text(payload.get("prompt"))?)
        } else {
            None
        };
        let title = if action == "rename" {
            Some(terminal_title(payload.get("title"))?)
        } else {
            None
        };
        if payload
            .get("attachments")
            .and_then(|v| v.as_array())
            .is_some_and(|a| !a.is_empty())
            && action != "message"
        {
            return Err(ActionError::new(
                "Photos require a conversation message.",
                400,
            ));
        }

        let queued_row = if dispatch_queued {
            self.mailbox.queued().into_iter().find(|r| {
                r.get("id").and_then(|v| v.as_str()) == Some(rid)
                    && r.get("session_id").and_then(|v| v.as_str()) == Some(sid)
            })
        } else {
            None
        };
        let decoded_imgs = if queued_row.is_none() {
            decode_images(payload.get("attachments")).map_err(|e| ActionError::new(e, 400))?
        } else {
            Vec::new()
        };

        if action == "message" && !dispatch_queued {
            let updated = snapshot
                .get("updated")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            if now_epoch() - updated > 20.0 {
                return Err(ActionError::new(
                    "Computer report is stale. Nothing sent.",
                    409,
                ));
            }
            let spec = find_session_matching(snapshot, sid, key, true)
                .filter(|s| accepts_message(s))
                .ok_or_else(|| {
                    ActionError::new("This session cannot receive messages right now.", 409)
                })?;
            let staged = if !decoded_imgs.is_empty() {
                let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
                if !matches!(kind, "Claude" | "GLM" | "Codex") {
                    return Err(ActionError::new(
                        "This session cannot receive photos right now.",
                        409,
                    ));
                }
                self.images
                    .stage(rid, sid, decoded_imgs)
                    .map_err(|e| ActionError::new(e, 409))?
            } else {
                Vec::new()
            };
            let row = self
                .mailbox
                .enqueue(spec, rid, prompt.as_deref().unwrap_or(""), &staged)
                .map_err(|e| ActionError::new(e, 409))?;
            let is_q = row.get("status").and_then(|v| v.as_str()) == Some("queued");
            return Ok(json!({
                "message": if is_q {
                    "메시지를 저장했습니다. 현재 작업이 끝나면 접수 순서대로 전달합니다."
                } else {
                    "이미 접수한 메시지입니다. 대화에서 결과를 확인하세요."
                },
                "queued": is_q,
                "status": row.get("status").cloned().unwrap_or(Value::Null)
            }));
        }

        if dispatch_queued && queued_row.is_none() {
            return Err(ActionError::new("Queued message no longer exists.", 409));
        }
        let Ok(_guard) = self.exec_lock.try_lock() else {
            return Err(ActionError::busy(
                "이전 동작을 처리 중입니다. 잠시 후 다시 시도하세요.",
            ));
        };

        let content_hash = title
            .as_deref()
            .or(prompt.as_deref())
            .map(|c| sha256_hex(c.as_bytes()))
            .unwrap_or_default();
        let req_sig = format!("{action}|{sid}|{key}|{content_hash}");
        {
            let recs = self.receipts.lock().unwrap();
            if let Some((prev_sig, prev_res)) = recs.get(rid) {
                if prev_sig != &req_sig {
                    return Err(ActionError::new("요청 ID가 이미 사용되었습니다.", 409));
                }
                if !(dispatch_queued
                    && prev_res.get("queued").and_then(|v| v.as_bool()) == Some(true))
                {
                    return Ok(prev_res.clone());
                }
            }
        }

        let spec = find_session_matching(snapshot, sid, key, action == "message")
            .ok_or_else(|| {
                ActionError::new(
                    "세션이나 터미널 연결이 변경되었습니다. 새로고침 후 다시 확인하세요.",
                    409,
                )
            })?
            .clone();
        let terminal = spec.get("orca_terminal").and_then(|v| v.as_object());
        let kind = spec.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        let state = spec
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let res = match action {
            "rename" => {
                let handle = terminal
                    .and_then(|t| t.get("handle"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| {
                        ActionError::new(
                            "제목을 변경할 Orca 터미널 연결을 확인할 수 없습니다.",
                            409,
                        )
                    })?;
                let t = title.as_deref().unwrap_or("");
                self.orca_cmd(&["rename", "--terminal", handle, "--title", t])?;
                json!({"message": format!("터미널 제목을 {t}(으)로 변경했습니다."), "title": t})
            }
            "prompt" | "message" => {
                let imgs = if let Some(ref qr) = queued_row {
                    let refs = qr
                        .get("attachments")
                        .and_then(|v| v.as_array())
                        .map(Vec::as_slice)
                        .unwrap_or(&[]);
                    if refs.is_empty() {
                        Vec::new()
                    } else {
                        self.images
                            .restore(rid, sid, refs)
                            .map_err(|e| ActionError::new(e, 409))?
                    }
                } else {
                    decoded_imgs
                };
                if action == "message"
                    && kind != "Aside"
                    && state == "working"
                    && accepts_message(&spec)
                {
                    let qres = json!({
                        "message": "작업을 중단하지 않고 세션이 대기 상태가 되면 메시지를 전달합니다.",
                        "queued": true
                    });
                    self.receipts
                        .lock()
                        .unwrap()
                        .insert(rid.to_string(), (req_sig, qres.clone()));
                    return Ok(qres);
                }
                if !accepts_instruction(&spec) {
                    return Err(ActionError::new(
                        "이 세션의 입력 가능한 대기 상태를 확인할 수 없습니다. 실행 중이면 작업을 중단한 뒤 다시 확인하세요.",
                        409,
                    ));
                }
                let mut text_to_send = prompt.unwrap_or_default();
                if action == "message" {
                    text_to_send = self
                        .mailbox
                        .begin(&spec, rid, &text_to_send, &imgs)
                        .map_err(|_| {
                            ActionError::new(
                                "이 세션과의 대화 연결을 확인하지 못했습니다. 메시지를 보내지 않았습니다.",
                                409,
                            )
                        })?;
                }
                let out = if kind == "Aside" {
                    let cli = home_dir().join(".aside/cli/Aside CLI.app/Contents/MacOS/aside");
                    let mode = if state == "working" {
                        "queue"
                    } else {
                        "resume"
                    };
                    let a_acct = spec
                        .get("aside_account")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let a_sess = spec
                        .get("aside_session")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let status = Command::new(cli)
                        .args([
                            "session",
                            mode,
                            "--account",
                            a_acct,
                            "--",
                            a_sess,
                            &text_to_send,
                        ])
                        .output()
                        .map_err(|_| {
                            ActionError::new(
                                "지시 전달 결과가 미확인입니다. 자동으로 다시 보내지 않습니다.",
                                409,
                            )
                        })?;
                    if !status.status.success() {
                        return Err(ActionError::new(
                            "Aside에서 지시 접수 여부를 확인하지 못했습니다. 세션을 확인하세요.",
                            409,
                        ));
                    }
                    json!({
                        "message": if mode == "queue" {
                            "다음 단계에 실행할 지시를 접수했습니다."
                        } else {
                            "AI 세션에 지시를 전달했습니다. 작업 시작은 상태 갱신으로 확인합니다."
                        },
                        "started": false
                    })
                } else {
                    let handle = terminal
                        .and_then(|t| t.get("handle"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    self.remember(sid, key, Some("resuming"));
                    let receipt = self.orca_cmd(&[
                        "send",
                        "--terminal",
                        handle,
                        "--text",
                        &text_to_send,
                        "--enter",
                        "--wait-submit",
                        "2",
                    ])?;
                    let started = receipt
                        .get("send")
                        .and_then(|s| s.get("prompt"))
                        .and_then(|p| p.get("stages"))
                        .and_then(|v| v.as_array())
                        .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("turn_started")));
                    json!({
                        "message": if started {
                            "AI 지시를 보냈고 새 작업 시작을 확인했습니다."
                        } else {
                            "AI 지시를 보냈습니다. 새 작업 시작은 아직 미확인입니다."
                        },
                        "started": started
                    })
                };
                if action == "message" {
                    self.mailbox.delivery(rid, "awaiting_reply");
                }
                out
            }
            "focus" => {
                if let Some(t) = terminal {
                    let handle = t.get("handle").and_then(|v| v.as_str()).unwrap_or("");
                    let ttitle = t.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    self.orca_cmd(&["switch", "--terminal", handle])?;
                    json!({"message": format!("{ttitle} 터미널로 이동했습니다.")})
                } else if let Some(app_path) = spec
                    .get("location")
                    .and_then(|l| l.get("app_path"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    let _ = Command::new("/usr/bin/open")
                        .args(["-a", app_path])
                        .status();
                    json!({"message": "Sent a request to bring the host application forward on that computer."})
                } else {
                    return Err(ActionError::new(
                        "The host application cannot be focused automatically.",
                        409,
                    ));
                }
            }
            "pause" => {
                if kind == "Aside" {
                    if !matches!(state, "working" | "waiting") {
                        return Err(ActionError::new(
                            "현재 Aside 작업 중 상태를 확인하지 못했습니다.",
                            409,
                        ));
                    }
                    let cli = home_dir().join(".aside/cli/Aside CLI.app/Contents/MacOS/aside");
                    let a_acct = spec
                        .get("aside_account")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let a_sess = spec
                        .get("aside_session")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let out = Command::new(cli)
                        .args(["session", "stop", a_sess, "--account", a_acct])
                        .output()
                        .map_err(|_| ActionError::new("Aside 응답을 확인하지 못했습니다.", 409))?;
                    if !out.status.success() {
                        return Err(ActionError::new(
                            "Aside 중단 결과를 확인하지 못했습니다.",
                            409,
                        ));
                    }
                    json!({"message": "Aside 세션의 작업 중단을 요청했습니다. 실제 상태는 다음 수집 때 확인합니다."})
                } else {
                    if matches!(state, "working" | "waiting") {
                        self.interrupt_spec(&spec)?;
                    } else if !matches!(state, "idle" | "interrupted" | "done") {
                        return Err(ActionError::new(
                            "작업 상태를 확인할 수 없어 일시정지를 보류했습니다.",
                            409,
                        ));
                    }
                    self.remember(sid, key, Some("paused"));
                    json!({"message": "작업이 멈춘 것을 확인했습니다. 세션을 보존했으며, 재개 버튼으로 새 요청을 보낼 수 있습니다."})
                }
            }
            "interrupt" => {
                if matches!(state, "idle" | "interrupted" | "done") {
                    json!({"message": "이미 작업이 멈춘 상태입니다. 세션을 유지했습니다."})
                } else if matches!(state, "working" | "waiting") {
                    self.interrupt_spec(&spec)?;
                    json!({"message": "작업 중단을 요청했습니다. 실제 상태는 다음 수집 때 갱신됩니다."})
                } else {
                    return Err(ActionError::new(
                        "작업 상태를 확인할 수 없습니다. 터미널에서 확인하세요.",
                        409,
                    ));
                }
            }
            "resume" => {
                let valid_pause = {
                    let st = self.state.lock().unwrap();
                    st.paused.get(sid).is_some_and(|m| {
                        m.get("key").and_then(|v| v.as_str()) == Some(key)
                            && m.get("phase").and_then(|v| v.as_str()) == Some("paused")
                    })
                };
                if !valid_pause {
                    return Err(ActionError::new(
                        "이 모니터에서 일시정지한 세션이 아니거나 이미 재개를 요청했습니다.",
                        409,
                    ));
                }
                let handle = terminal
                    .and_then(|t| t.get("handle"))
                    .and_then(|v| v.as_str())
                    .filter(|_| {
                        matches!(state, "idle" | "interrupted" | "done")
                            && spec.get("input_verified").and_then(|v| v.as_bool()) != Some(false)
                    })
                    .ok_or_else(|| {
                        ActionError::new("현재 대기 상태와 터미널 연결을 확인할 수 없습니다.", 409)
                    })?;
                self.remember(sid, key, Some("resuming"));
                let receipt = self.orca_cmd(&[
                    "send",
                    "--terminal",
                    handle,
                    "--text",
                    RESUME_PROMPT,
                    "--enter",
                    "--wait-submit",
                    "2",
                ])?;
                let started = receipt
                    .get("send")
                    .and_then(|s| s.get("prompt"))
                    .and_then(|p| p.get("stages"))
                    .and_then(|v| v.as_array())
                    .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("turn_started")));
                let tail = if started {
                    " 새 작업 시작을 확인했습니다."
                } else {
                    " 실제 시작은 상태 갱신으로 확인합니다."
                };
                json!({"message": format!("이어서 작업하는 새 요청을 보냈습니다.{tail}"), "started": started})
            }
            "terminate" => {
                let pid = spec
                    .get("pids")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|v| v.as_u64())
                    .map(|u| u as u32)
                    .ok_or_else(|| {
                        ActionError::new("개별 CLI 프로세스를 확인할 수 없습니다.", 409)
                    })?;
                let started = spec
                    .get("process_started")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if terminal.is_some() && matches!(state, "working" | "waiting") {
                    self.interrupt_spec(&spec)?;
                }
                let exited = terminate_pid(pid, started)?;
                if exited {
                    self.remember(sid, key, None);
                }
                json!({
                    "message": if exited {
                        "CLI 종료를 확인했습니다. Orca 탭과 대화 기록은 유지됩니다."
                    } else {
                        "CLI 종료 신호를 보냈습니다. 아직 프로세스 종료가 확인되지 않았습니다."
                    },
                    "exited": exited
                })
            }
            _ => return Err(ActionError::new("잘못된 동작 요청입니다.", 400)),
        };

        if action != "focus" {
            let mut st = self.state.lock().unwrap();
            let proj = Path::new(spec.get("cwd").and_then(|v| v.as_str()).unwrap_or(""))
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            st.audit.push(json!({
                "t": now_epoch(),
                "action": action,
                "sid": sid,
                "terminal": terminal.and_then(|t| t.get("title")).cloned().unwrap_or(Value::Null),
                "project": proj,
                "message": res.get("message").cloned().unwrap_or(Value::Null)
            }));
            if st.audit.len() > 50 {
                let cut = st.audit.len() - 50;
                st.audit = st.audit.split_off(cut);
            }
            self.save_state_locked(&st);
        }
        {
            let mut recs = self.receipts.lock().unwrap();
            if recs.len() > 100 {
                if let Some(k) = recs.keys().next().cloned() {
                    recs.remove(&k);
                }
            }
            recs.insert(rid.to_string(), (req_sig, res.clone()));
        }
        Ok(res)
    }

    pub fn flush_mailbox(&self, snapshot: &Map<String, Value>) {
        if self.exec_lock.try_lock().is_err() {
            return;
        }
        let updated = snapshot
            .get("updated")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        if now_epoch() - updated > 20.0 {
            return;
        }
        let sessions = snapshot
            .get("sessions")
            .and_then(|v| v.as_array())
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for sv in sessions {
            if let Some(s) = sv.as_object() {
                self.mailbox.rebind(s);
            }
        }
        let pending = self.mailbox.pending_sessions();
        for sv in sessions {
            if let Some(s) = sv.as_object() {
                if let Some(id) = s.get("id").and_then(|v| v.as_str()) {
                    if pending.contains(id) {
                        let _ = self.mailbox.read(s);
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        for row in self.mailbox.queued() {
            let rid = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let sid = row.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            let ckey = row
                .get("control_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let created = row.get("created").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let spec = sessions
                .iter()
                .filter_map(|v| v.as_object())
                .find(|s| s.get("id").and_then(|v| v.as_str()) == Some(sid));
            let mismatch = spec.is_some_and(|s| {
                s.get("control_key").and_then(|v| v.as_str()) != Some(ckey)
                    && !s
                        .get("continuation_keys")
                        .and_then(|v| v.as_array())
                        .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(ckey)))
            });
            if now_epoch() - created > 900.0 || mismatch {
                self.mailbox.delivery(rid, "not_delivered");
                continue;
            }
            if !seen.insert(sid.to_string()) {
                continue;
            }
            let Some(s) = spec else {
                continue;
            };
            if !accepts_instruction(s) {
                continue;
            }
            let mut payload = Map::new();
            payload.insert("action".into(), json!("message"));
            payload.insert("session_id".into(), json!(sid));
            payload.insert("control_key".into(), json!(ckey));
            payload.insert("request_id".into(), json!(rid));
            payload.insert(
                "prompt".into(),
                row.get("text").cloned().unwrap_or_else(|| json!("")),
            );
            match self.execute(snapshot, &payload, true) {
                Ok(res) => {
                    if res.get("queued").and_then(|v| v.as_bool()) != Some(true) {
                        break;
                    }
                }
                Err(e) if e.busy => continue,
                Err(_) => self.mailbox.delivery(rid, "delivery_unconfirmed"),
            }
        }
    }
}

fn find_session_matching<'a>(
    snapshot: &'a Map<String, Value>,
    sid: &str,
    key: &str,
    allow_continuation: bool,
) -> Option<&'a Map<String, Value>> {
    snapshot
        .get("sessions")?
        .as_array()?
        .iter()
        .filter_map(|v| v.as_object())
        .find(|s| {
            s.get("id").and_then(|v| v.as_str()) == Some(sid)
                && (s.get("control_key").and_then(|v| v.as_str()) == Some(key)
                    || (allow_continuation
                        && s.get("continuation_keys")
                            .and_then(|v| v.as_array())
                            .is_some_and(|a| a.iter().any(|x| x.as_str() == Some(key)))))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_instruction_title_and_png_attachments() {
        assert_eq!(
            instruction_text(Some(&json!("  hello world "))).unwrap(),
            "  hello world "
        );
        assert!(instruction_text(Some(&json!("   "))).is_err());
        assert!(instruction_text(Some(&json!("bad\x07bell"))).is_err());

        assert_eq!(terminal_title(Some(&json!(" My Tab "))).unwrap(), "My Tab");
        assert!(terminal_title(Some(&json!("bad\nline"))).is_err());

        // Minimal valid PNG with IHDR (16x8) + CRC + IEND trailer (>= 45 bytes)
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        png.extend_from_slice(&[0, 0, 0, 13, b'I', b'H', b'D', b'R']);
        png.extend_from_slice(&16u32.to_be_bytes());
        png.extend_from_slice(&8u32.to_be_bytes());
        png.extend_from_slice(&[8, 2, 0, 0, 0, 0, 0, 0, 0]);
        png.extend_from_slice(b"\x00\x00\x00\x00IEND\xaeB`\x82");
        let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
        let decoded = decode_images(Some(
            &json!([{"name": "shot.png", "mime": "image/png", "data": b64}]),
        ))
        .unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].mime, "image/png");
        assert_eq!(decoded[0].bytes, png.len());
    }

    #[test]
    fn mailbox_enqueue_and_controller_decorate() {
        let td = tempfile::tempdir().unwrap();
        let ctrl = Controller::new(Some(td.path().join("controls-v5.json")));
        let mut snap = Map::new();
        snap.insert("updated".into(), json!(now_epoch()));
        snap.insert(
            "sessions".into(),
            json!([{
                "id": "s1",
                "control_key": "k1",
                "kind": "Claude",
                "status": "idle",
                "orca_terminal": {"handle": "h1", "title": "Tab"}
            }]),
        );
        snap.insert(
            "root_sessions".into(),
            json!([{"id": "s1", "status": "idle"}]),
        );
        let dec = ctrl.decorate(&snap);
        assert_eq!(dec["sessions"][0]["display_status"], "idle");
        assert_eq!(dec["resume_prompt"], RESUME_PROMPT);
    }
}
