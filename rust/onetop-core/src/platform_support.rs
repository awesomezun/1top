use std::path::{Path, PathBuf};

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

/// Exact port of `platform_support.py:data_directory`.
pub fn data_directory(home: Option<&Path>) -> PathBuf {
    if let Ok(val) = std::env::var("ONETOP_DATA").or_else(|_| std::env::var("AGENT_MONITOR_DATA")) {
        if !val.is_empty() {
            return PathBuf::from(val);
        }
    }
    let home_owned = home_dir();
    let h = home.unwrap_or(&home_owned);

    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.is_empty() {
                return PathBuf::from(local).join("1top");
            }
        }
        return h.join("AppData").join("Local").join("1top");
    }

    #[cfg(target_os = "macos")]
    {
        h.join("Library").join("Application Support").join("1top")
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_STATE_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("1top");
            }
        }
        h.join(".local").join("state").join("1top")
    }
}
