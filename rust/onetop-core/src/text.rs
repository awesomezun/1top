use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use regex::Regex;
use std::sync::OnceLock;
use unicode_general_category::{get_general_category, GeneralCategory};

/// Matches Python 3's `str.isprintable()` across all Unicode scalar values.
/// In CPython, printable is true iff the Unicode general category is not
/// `Other` (`Cc`, `Cf`, `Cs`, `Co`, `Cn`) and not `Separator` (`Zl`, `Zp`, `Zs`),
/// with the single exception that ASCII space (`U+0020`) is printable.
pub fn is_python_printable(c: char) -> bool {
    if c == ' ' {
        return true;
    }
    !matches!(
        get_general_category(c),
        GeneralCategory::Control
            | GeneralCategory::Format
            | GeneralCategory::Surrogate
            | GeneralCategory::PrivateUse
            | GeneralCategory::Unassigned
            | GeneralCategory::LineSeparator
            | GeneralCategory::ParagraphSeparator
            | GeneralCategory::SpaceSeparator
    )
}

/// Equivalent to `''.join(c for c in s if c.isprintable()).strip()[:max_chars]`.
pub fn clean_title(s: &str, max_chars: usize) -> String {
    let filtered: String = s.chars().filter(|&c| is_python_printable(c)).collect();
    filtered.trim().chars().take(max_chars).collect()
}

pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

fn frac_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal verified at compile/test time
        Regex::new(r"\.(\d{1,6})\d*").expect("valid fractional regex")
    })
}

/// Normalize fractional seconds to 6 digits (matching `antigravity.py:stamp`)
/// and parse an ISO-8601 string into Unix seconds. Naive datetimes use local timezone,
/// matching Python's `datetime.fromisoformat(...).timestamp()`.
pub fn parse_antigravity_stamp(value: &str) -> f64 {
    let replaced = value.replacen(' ', "T", 1);
    let normalized = frac_re().replace_all(&replaced, |caps: &regex::Captures| {
        let frac = &caps[1];
        format!(".{frac:0<6}")
    });
    parse_iso_to_epoch(&normalized)
}

/// Parse Devin timestamp (ISO string with `Z` -> `+00:00`, naive -> local timezone).
pub fn parse_devin_stamp_str(value: &str) -> f64 {
    let replaced = value.replace('Z', "+00:00");
    let normalized = replaced.replacen(' ', "T", 1);
    parse_iso_to_epoch(&normalized)
}

pub fn parse_devin_stamp_num(value: f64) -> f64 {
    if value > 1e12 {
        value / 1000.0
    } else {
        value
    }
}

pub fn epoch_rfc3339(value: &str) -> Option<f64> {
    let ts = parse_devin_stamp_str(value);
    if ts > 0.0 && ts.is_finite() {
        Some(ts)
    } else {
        None
    }
}

pub fn epoch_from_value(val: Option<&serde_json::Value>) -> f64 {
    match val {
        Some(serde_json::Value::Number(n)) => n
            .as_f64()
            .filter(|f| f.is_finite())
            .map(parse_devin_stamp_num)
            .unwrap_or(0.0),
        Some(serde_json::Value::String(s)) => parse_devin_stamp_str(s),
        _ => 0.0,
    }
}

fn parse_iso_to_epoch(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_nanos()) / 1e9;
    }
    // Support offsets like +0000 without colon or fractional seconds with offset
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f%:z",
        "%Y-%m-%dT%H:%M:%S%:z",
        "%Y-%m-%dT%H:%M:%S%.f%#z",
        "%Y-%m-%dT%H:%M:%S%#z",
    ] {
        if let Ok(dt) = DateTime::parse_from_str(s, fmt) {
            return dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_nanos()) / 1e9;
        }
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(ndt) = NaiveDateTime::parse_from_str(s, fmt) {
            if let Some(local_dt) = Local.from_local_datetime(&ndt).earliest() {
                return local_dt.timestamp() as f64
                    + f64::from(local_dt.timestamp_subsec_nanos()) / 1e9;
            }
        }
    }
    if let Ok(nd) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        if let Some(ndt) = nd.and_hms_opt(0, 0, 0) {
            if let Some(local_dt) = Local.from_local_datetime(&ndt).earliest() {
                return local_dt.timestamp() as f64;
            }
        }
    }
    0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn printable_matches_python_edges() {
        assert!(is_python_printable(' '));
        assert!(is_python_printable('가'));
        assert!(is_python_printable('🦀'));
        assert!(!is_python_printable('\t'));
        assert!(!is_python_printable('\n'));
        assert!(!is_python_printable('\u{00a0}')); // NBSP
        assert!(!is_python_printable('\u{200b}')); // ZWSP
        assert!(!is_python_printable('\u{2028}')); // Line sep
    }

    #[test]
    fn clean_title_truncates_by_chars() {
        let s = format!("  \t안녕{}세계\u{200b}  ", "가".repeat(250));
        let cleaned = clean_title(&s, 200);
        assert_eq!(cleaned.chars().count(), 200);
        assert!(cleaned.starts_with("안녕가"));
    }

    #[test]
    fn parse_rfc3339_with_nanos() {
        let ts = parse_antigravity_stamp("2026-11-25 12:00:00.123456789Z");
        assert!((ts - 1795608000.123456).abs() < 1e-5);
    }
}
