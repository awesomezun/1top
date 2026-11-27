use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const PRICES_AS_OF: &str = "2026-11-07";

pub type Rates = (f64, f64, f64, f64);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanInfo {
    pub plan: String,
    pub label: String,
    pub price: Option<i64>,
}

fn compiled_models() -> &'static Vec<(Regex, Rates)> {
    static MODELS: OnceLock<Vec<(Regex, Rates)>> = OnceLock::new();
    MODELS.get_or_init(|| {
        let defs: &[(&str, Rates)] = &[
            (r"^claude-fable-5-1$", (10.0, 0.25, 12.5, 50.0)),
            (r"^claude-mythos-5-1$", (10.0, 0.25, 12.5, 50.0)),
            (r"^claude-(fable|mythos)-5$", (10.0, 1.0, 12.5, 50.0)),
            (r"^claude-opus-5-5$", (4.0, 0.20, 5.0, 20.0)),
            (
                r"^claude-opus-(5|4-8|4-7|4-6|4-5)$",
                (5.0, 0.50, 6.25, 25.0),
            ),
            (r"^claude-opus-4(-1)?$", (15.0, 1.5, 18.75, 75.0)),
            (r"^claude-sonnet-5-5$", (2.0, 0.10, 2.5, 10.0)),
            (r"^claude-sonnet-5$", (2.0, 0.20, 2.5, 10.0)),
            (r"^claude-sonnet-4(-6|-5)?$", (3.0, 0.30, 3.75, 15.0)),
            (r"^claude-haiku-5-5$", (0.10, 0.01, 0.125, 0.50)),
            (r"^claude-haiku-4-5$", (1.0, 0.10, 1.25, 5.0)),
            (r"^gpt-6-astra$", (10.0, 1.0, 12.5, 50.0)),
            (r"^gpt-6\.1-sol$", (2.0, 0.10, 2.5, 10.0)),
            (r"^gpt-5\.6-terra$", (2.0, 0.20, 2.5, 12.0)),
            (r"^gpt-6-luna$", (0.10, 0.01, 0.125, 0.50)),
            (r"^gpt-5\.3-codex$", (1.75, 0.175, 0.0, 14.0)),
            (r"^glm-5\.3-flash$", (0.15, 0.03, 0.0, 0.50)),
            (r"^glm-5\.3$", (1.40, 0.26, 0.0, 4.40)),
        ];
        defs.iter()
            .map(|(pat, rates)| {
                // INFALLIBLE: static regex patterns
                (Regex::new(pat).expect("valid model regex"), *rates)
            })
            .collect()
    })
}

fn bracket_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal
        Regex::new(r"\[[^\]]*\]$").expect("valid bracket regex")
    })
}

fn date_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // INFALLIBLE: static regex literal
        Regex::new(r"-20\d{6}$").expect("valid date regex")
    })
}

/// Exact port of `pricing.py:normalize`.
pub fn normalize(model: Option<&str>) -> String {
    let s = model.unwrap_or("").trim().to_lowercase();
    let tail = s.rsplit('/').next().unwrap_or("");
    let no_bracket = bracket_suffix_re().replace(tail, "");
    date_suffix_re().replace(&no_bracket, "").into_owned()
}

/// Exact port of `pricing.py:price`.
pub fn price(model: Option<&str>) -> Option<Rates> {
    let name = normalize(model);
    if name.is_empty() || name == "unknown" {
        return None;
    }
    for (pattern, rates) in compiled_models() {
        if pattern.is_match(&name) {
            return Some(*rates);
        }
    }
    None
}

/// Exact port of `pricing.py:value`.
pub fn value(model: Option<&str>, tokens: &[f64]) -> Option<f64> {
    let (r0, r1, r2, r3) = price(model)?;
    let rates = [r0, r1, r2, r3];
    let total: f64 = tokens.iter().zip(rates.iter()).map(|(n, r)| n * r).sum();
    Some(total / 1e6)
}

/// Matches Python `str.title()` for ASCII/Unicode cased words.
fn python_title(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_cased = false;
    for ch in s.chars() {
        let is_cased = ch.is_alphabetic();
        if is_cased {
            if !prev_cased {
                for up in ch.to_uppercase() {
                    out.push(up);
                }
            } else {
                for lo in ch.to_lowercase() {
                    out.push(lo);
                }
            }
        } else {
            out.push(ch);
        }
        prev_cased = is_cased;
    }
    out
}

/// Exact port of `pricing.py:plan`.
pub fn plan(kind: &str, plan_name: &str, tier: &str) -> PlanInfo {
    let p = plan_name.trim().to_lowercase();
    let t = tier.to_lowercase();
    match kind {
        "Claude" => {
            if t.contains("max_20x") {
                return PlanInfo {
                    plan: "max20x".into(),
                    label: "Claude Max 20x".into(),
                    price: Some(200),
                };
            }
            if p.contains("max") || t.contains("_claude_max") {
                return PlanInfo {
                    plan: "max".into(),
                    label: "Claude Max".into(),
                    price: Some(100),
                };
            }
            if p == "pro" {
                return PlanInfo {
                    plan: "pro".into(),
                    label: "Claude Pro".into(),
                    price: Some(20),
                };
            }
            if p == "ultra" {
                return PlanInfo {
                    plan: "ultra".into(),
                    label: "Claude Ultra".into(),
                    price: Some(200),
                };
            }
            if p == "free" {
                return PlanInfo {
                    plan: "free".into(),
                    label: "Claude Free".into(),
                    price: Some(0),
                };
            }
            let label = if p.is_empty() {
                "Claude".into()
            } else {
                format!("Claude {}", python_title(&p)).trim().to_string()
            };
            PlanInfo {
                plan: if p.is_empty() { "unknown".into() } else { p },
                label,
                price: None,
            }
        }
        "Codex" => {
            let known = match p.as_str() {
                "free" => Some(("ChatGPT Free", 0)),
                "go" => Some(("ChatGPT Go", 8)),
                "plus" => Some(("ChatGPT Plus", 20)),
                _ => None,
            };
            if let Some((label, pr)) = known {
                return PlanInfo {
                    plan: p,
                    label: label.into(),
                    price: Some(pr),
                };
            }
            let label = if p.is_empty() {
                "ChatGPT".into()
            } else {
                format!("ChatGPT {}", python_title(&p)).trim().to_string()
            };
            PlanInfo {
                plan: if p.is_empty() { "unknown".into() } else { p },
                label,
                price: None,
            }
        }
        "GLM" => {
            if p == "lite" {
                return PlanInfo {
                    plan: "lite".into(),
                    label: "GLM Lite".into(),
                    price: Some(18),
                };
            }
            let label = if p.is_empty() {
                "GLM".into()
            } else {
                format!("GLM {}", python_title(&p)).trim().to_string()
            };
            PlanInfo {
                plan: if p.is_empty() { "unknown".into() } else { p },
                label,
                price: None,
            }
        }
        _ => {
            let base = if kind == "Antigravity" { "Agy" } else { kind };
            let label = if p.is_empty() {
                base.to_string()
            } else {
                format!("{base} {}", python_title(&p)).trim().to_string()
            };
            PlanInfo {
                plan: if p.is_empty() { "unknown".into() } else { p },
                label,
                price: None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_prices_models() {
        assert_eq!(
            normalize(Some("anthropic/claude-opus-5-5[1m]-20261101")),
            "claude-opus-5-5[1m]"
        );
        assert_eq!(
            normalize(Some("anthropic/claude-opus-5-5-20261101[1m]")),
            "claude-opus-5-5"
        );
        assert_eq!(price(Some("claude-opus-5-5")), Some((4.0, 0.20, 5.0, 20.0)));
        assert_eq!(price(Some("gemini-4-neon")), None);
        let val = value(Some("claude-opus-5-5"), &[1e6, 0.0, 0.0, 1e6]).unwrap();
        assert!((val - 24.0).abs() < 1e-9);
    }
}
