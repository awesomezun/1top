// Written by scripts/demo-world.mjs from site/src/demo-world.js. Do not edit by hand.
// swiftlint:disable all
enum DemoWorld {
    struct Computer { let id: String, name: String, platform: String, seed: UInt32, scale: Double, duty: Double, control: Bool, cores: Int, memory: Double, used: Double, cpu: (idle: Double, busy: Double) }
    struct Account { let key: String, id: String, kind: String, email: String, alias: String?, plan: String, per: Double, reset: Double, five: (reset: Double, factor: Double)?, source: String?, stale: Double?, status: String? }
    struct Session { let computer: Int, id: String, kind: String, project: String, model: String?, status: String, account: String?, weight: Double, app: String, title: String, effort: String?, caps: [String] }
    struct Child { let lead: String, name: String, share: Double, status: String }
    struct Earlier { let computer: Int, kind: String, account: String?, model: String?, project: String, weight: Double }
    struct Goal { let runtime: String, status: String, tokensUsed: Double, timeUsedSeconds: Double, sessionConnected: Bool }
    struct Operations { let installedSkills: Int, observedEvents: Int, goals: [Goal] }
    static let rest: UInt32 = 7
    static let computers: [Computer] = [
        Computer(id: "demo-0", name: "MacBook Pro", platform: "Darwin", seed: 23, scale: 1300000, duty: 1, control: true, cores: 12, memory: 36, used: 22.032, cpu: (9, 45)),
        Computer(id: "demo-1", name: "Mac mini", platform: "Darwin", seed: 61, scale: 300000, duty: 0.2, control: false, cores: 10, memory: 24, used: 15, cpu: (12.25, 48)),
        Computer(id: "demo-2", name: "Workstation", platform: "Windows", seed: 37, scale: 600000, duty: 0.3, control: true, cores: 16, memory: 64, used: 38, cpu: (14.35, 48)),
    ]
    static let accounts: [Account] = [
        Account(key: "dev", id: "demo-claude-4f1c2a", kind: "Claude", email: "dev@example.com", alias: nil, plan: "Max", per: 1.29e-8, reset: 266000, five: (7400, 6), source: "claude_statusline", stale: nil, status: nil),
        Account(key: "studio", id: "demo-claude-9b07e3", kind: "Claude", email: "studio@example.com", alias: "Studio", plan: "Pro", per: 5.4e-8, reset: 330000, five: (14200, 6), source: "claude_statusline", stale: nil, status: nil),
        Account(key: "ops", id: "demo-codex-c2a957", kind: "Codex", email: "ops@example.com", alias: nil, plan: "Pro", per: 1.3e-7, reset: 300000, five: nil, source: nil, stale: nil, status: nil),
        Account(key: "ml", id: "demo-codex-61d8f0", kind: "Codex", email: "ml@example.com", alias: nil, plan: "Plus", per: 1.8e-8, reset: 220000, five: nil, source: nil, stale: 2280, status: "login_required"),
    ]
    static let sessions: [Session] = [
        Session(computer: 0, id: "s1", kind: "Claude", project: "checkout-web", model: "claude-opus-5-5", status: "working", account: "dev", weight: 30, app: "Orca", title: "Checkout UI", effort: "xhigh", caps: ["focus","pause","mailbox","message","message_images","terminate"]),
        Session(computer: 0, id: "s2", kind: "Codex", project: "billing-service", model: "gpt-6.1-sol", status: "working", account: "ml", weight: 8, app: "Orca", title: "Billing API", effort: "ultra", caps: ["focus","pause","mailbox","message","message_images","terminate"]),
        Session(computer: 0, id: "s3", kind: "Claude", project: "docs-site", model: "claude-sonnet-5-5", status: "working", account: "studio", weight: 6, app: "Visual Studio Code", title: "docs", effort: "high", caps: ["focus","mailbox","terminate"]),
        Session(computer: 0, id: "s4", kind: "GLM", project: "data-sync", model: "glm-5.3[1m]", status: "waiting", account: nil, weight: 2, app: "Orca", title: "Nightly sync", effort: "high", caps: ["focus","pause","mailbox","terminate"]),
        Session(computer: 0, id: "s5", kind: "Aside", project: "0", model: "gpt-6.1-sol", status: "working", account: nil, weight: 1.5, app: "Aside", title: "Release notes", effort: "medium", caps: ["focus","pause","prompt","mailbox","message"]),
        Session(computer: 0, id: "s6", kind: "Codex", project: "api-gateway", model: "gpt-6-astra", status: "idle", account: "ops", weight: 3, app: "Orca", title: "Gateway", effort: "high", caps: ["focus","prompt","terminate"]),
        Session(computer: 0, id: "s7", kind: "Claude", project: "mobile-app", model: "claude-haiku-5-5", status: "paused", account: "dev", weight: 2, app: "Orca", title: "Mobile", effort: "low", caps: ["focus","resume","prompt","mailbox","message","message_images","terminate"]),
        Session(computer: 0, id: "s8", kind: "Antigravity", project: "research", model: "gemini-3.5-pro", status: "unknown", account: nil, weight: 0, app: "Cursor", title: "research", effort: nil, caps: ["focus","terminate"]),
        Session(computer: 0, id: "s9", kind: "Claude", project: "design-tokens", model: "claude-sonnet-5-5", status: "waiting", account: "dev", weight: 4, app: "Ghostty", title: "tokens", effort: "medium", caps: ["focus","mailbox","terminate"]),
        Session(computer: 0, id: "s10", kind: "Gemini", project: "release-bot", model: nil, status: "unknown", account: nil, weight: 0, app: "iTerm2", title: "release", effort: nil, caps: ["focus","terminate"]),
        Session(computer: 0, id: "s11", kind: "Codex", project: "data-pipeline", model: "gpt-6-astra", status: "idle", account: "ops", weight: 2, app: "Terminal", title: "etl", effort: "low", caps: ["focus","mailbox","terminate"]),
        Session(computer: 0, id: "s12", kind: "Claude", project: "onboarding", model: "claude-sonnet-5-5", status: "idle", account: "studio", weight: 1, app: "Warp", title: "onboard", effort: "medium", caps: ["focus","mailbox","terminate"]),
        Session(computer: 1, id: "m1", kind: "Antigravity", project: "search-index", model: "claude-sonnet-5-5", status: "working", account: nil, weight: 2, app: "Ghostty", title: "indexer", effort: "medium", caps: ["focus","terminate"]),
        Session(computer: 1, id: "m2", kind: "Claude", project: "support-replies", model: "claude-haiku-5-5", status: "idle", account: "studio", weight: 2, app: "Claude", title: "", effort: "low", caps: ["focus","mailbox","terminate"]),
        Session(computer: 1, id: "m3", kind: "Qwen Code", project: "prototype", model: nil, status: "unknown", account: nil, weight: 0, app: "Terminal", title: "proto", effort: nil, caps: ["focus","terminate"]),
        Session(computer: 2, id: "w1", kind: "Claude", project: "game-engine", model: "claude-fable-5-1", status: "working", account: "dev", weight: 14, app: "Windows Terminal", title: "engine", effort: "max", caps: ["focus","mailbox","terminate"]),
        Session(computer: 2, id: "w2", kind: "Codex", project: "infra-scripts", model: "gpt-6.1-sol", status: "waiting", account: "ops", weight: 3, app: "powershell", title: "infra", effort: "medium", caps: ["focus","mailbox","terminate"]),
        Session(computer: 2, id: "w3", kind: "GLM", project: "analytics", model: "glm-5.3[1m]", status: "working", account: nil, weight: 1.5, app: "Windsurf", title: "analytics", effort: "xhigh", caps: ["focus","mailbox","terminate"]),
        Session(computer: 2, id: "w4", kind: "OpenCode", project: "ui-kit", model: nil, status: "unknown", account: nil, weight: 0, app: "Windows Terminal", title: "ui", effort: nil, caps: ["focus","terminate"]),
        Session(computer: 2, id: "w5", kind: "GitHub Copilot", project: "notes", model: nil, status: "unknown", account: nil, weight: 0, app: "Visual Studio Code", title: "copilot", effort: nil, caps: ["focus","terminate"]),
        Session(computer: 2, id: "w6", kind: "Codex", project: "research", model: "gpt-6-astra", status: "idle", account: "ml", weight: 1, app: "ChatGPT", title: "", effort: "high", caps: ["focus","mailbox","terminate"]),
    ]
    static let children: [Child] = [
        Child(lead: "s1", name: "reviewer", share: 0.25, status: "working"),
        Child(lead: "s1", name: "tester", share: 0.1, status: "idle"),
        Child(lead: "s2", name: "migrator", share: 0.3, status: "working"),
    ]
    static let earlier: [Earlier] = [
        Earlier(computer: 0, kind: "Claude", account: "dev", model: "claude-opus-5-5", project: "storefront", weight: 30),
        Earlier(computer: 0, kind: "Claude", account: "dev", model: "claude-sonnet-5-5", project: "design-system", weight: 8),
        Earlier(computer: 0, kind: "Claude", account: "studio", model: "claude-sonnet-5-5", project: "docs-site", weight: 6),
        Earlier(computer: 0, kind: "Codex", account: "ops", model: "gpt-6-astra", project: "api-gateway", weight: 4),
        Earlier(computer: 0, kind: "Codex", account: "ml", model: "gpt-6.1-sol", project: "ml-pipeline", weight: 7),
        Earlier(computer: 0, kind: "GLM", account: nil, model: "glm-5.3[1m]", project: "data-sync", weight: 2),
        Earlier(computer: 0, kind: "Aside", account: nil, model: "gpt-6.1-sol", project: "0", weight: 1.5),
        Earlier(computer: 1, kind: "Claude", account: "studio", model: "claude-haiku-5-5", project: "support-replies", weight: 2),
        Earlier(computer: 2, kind: "Claude", account: "dev", model: "claude-fable-5-1", project: "game-engine", weight: 14),
        Earlier(computer: 2, kind: "Codex", account: "ops", model: "gpt-6.1-sol", project: "infra-scripts", weight: 3),
        Earlier(computer: 2, kind: "Codex", account: "ml", model: "gpt-6-astra", project: "research", weight: 1),
    ]
    static let operations: [Operations] = [
        Operations(installedSkills: 14, observedEvents: 9, goals: [Goal(runtime: "Codex", status: "active", tokensUsed: 18400000, timeUsedSeconds: 6300, sessionConnected: true)]),
        Operations(installedSkills: 8, observedEvents: 3, goals: [Goal(runtime: "Claude Code", status: "complete", tokensUsed: 6200000, timeUsedSeconds: 2700, sessionConnected: false)]),
        Operations(installedSkills: 11, observedEvents: 5, goals: [Goal(runtime: "Codex", status: "paused", tokensUsed: 9100000, timeUsedSeconds: 4100, sessionConnected: true)]),
    ]
}
