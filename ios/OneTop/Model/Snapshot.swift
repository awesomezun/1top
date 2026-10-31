import Foundation

/// Selected-period keys shared with the desktop dashboard and the relay snapshot.
enum Period: String, CaseIterable, Identifiable, Sendable {
    case m10 = "10m", m30 = "30m", h1 = "1h", h5 = "5h", h12 = "12h", h24 = "24h"
    var id: String { rawValue }
    var seconds: Double {
        switch self {
        case .m10: 600
        case .m30: 1800
        case .h1: 3600
        case .h5: 18000
        case .h12: 43200
        case .h24: 86400
        }
    }
    var label: String {
        switch self {
        case .m10: L.t("10m", "10분")
        case .m30: L.t("30m", "30분")
        case .h1: L.t("1h", "1시간")
        case .h5: L.t("5h", "5시간")
        case .h12: L.t("12h", "12시간")
        case .h24: L.t("24h", "24시간")
        }
    }
}

/// One session as the collector reports it through the relay. Token vectors are
/// [fresh input, cache read, cache write, output]; `nil` means not reported, never zero.
struct Session: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var controlKey: String?
    var kind: String
    var app: String?
    var terminal: String?
    var project: String?
    var title: String?
    var model: String?
    var status: String
    var tokens: [Double]?
    var rate: Double?
    var windows: [String: [Double]?]?
    var cpu: Double?
    var rss: Double?
    var capabilities: [String]?
    var weeklyAccount: String?
    var weeklyEstimate: [String: WeeklyEstimate]?
    var rootSessionId: String?
    var parentSessionId: String?
    /// The computer that reported this session; set by the app, not sent by the relay.
    var deviceId: String?
    /// For the cluster's warning lights and last minute: how full the context is, when usage was last
    /// reported, and the sliding last minute's token vector.
    var contextUsage: ContextUsage? = nil
    var lastUsage: Double? = nil
    var usage: SessionUsage? = nil
    struct ContextUsage: Codable, Hashable, Sendable { var inputTokens: Double?; var capacity: Double? }
    struct SessionUsage: Codable, Hashable, Sendable { var lastMinute: [Double]? }

    /// Session IDs are unique per computer only.
    var key: String { (deviceId ?? "") + ":" + id }
    var total: Double? {
        guard let tokens, tokens.count == 4, tokens.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
        return tokens.reduce(0, +)
    }
    func can(_ action: String) -> Bool { capabilities?.contains(action) == true }
    /// A collector without estimates sends nothing or an empty map; only a number counts.
    var hasEstimate: Bool { weeklyEstimate?.values.contains { $0.usedPp.map { $0.isFinite && $0 >= 0 } ?? false } ?? false }

    func tokens(in period: Period) -> Double? {
        guard let vector = windows?[period.rawValue] ?? nil, !vector.isEmpty,
              vector.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
        return vector.reduce(0, +)
    }
    var isWorking: Bool { status == "working" }
    /// The terminal tab tells sessions apart; then the conversation title, then the project.
    var name: String {
        for candidate in [terminal, title, displayProject] {
            if let text = candidate?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty { return text }
        }
        return kind
    }
    var displayProject: String? {
        guard let project, !project.isEmpty else { return nil }
        return project == "0" && kind == "Aside" ? L.t("Aside default workspace", "Aside 기본 작업공간") : project
    }
}

/// A session's selected-period tokens converted to its account's weekly limit (percentage points).
struct WeeklyEstimate: Codable, Hashable, Sendable {
    struct Calibration: Codable, Hashable, Sendable { var ppPerToken: Double?; var confidence: String? }
    var usedPp: Double?
    var partial: Bool?
    var accountId: String?
    var calibration: Calibration?
}

/// An account's weekly-limit change over a period, as the provider reported it.
struct WeeklyPeriod: Codable, Hashable, Sendable {
    var usedPp: Double?
    var observedSeconds: Double?
    var partial: Bool?
    /// Percentage points per hour over the observed part, once at least two minutes are observed.
    var burnPerHour: Double? {
        guard let usedPp, let observedSeconds, usedPp.isFinite, usedPp >= 0, observedSeconds >= 120 else { return nil }
        return usedPp / observedSeconds * 3600
    }
}

/// Token bins over a period, oldest first, by tool. Bin i covers [start + i·step, start + (i+1)·step).
/// A nil bin is unknown (a computer did not cover it), never zero.
struct FlowSeries: Codable, Hashable, Sendable {
    var step: Double
    var start: Double?
    var end: Double?
    var reported: Bool?
    var bins: [[String: Double]?]
}

struct QuotaWindow: Codable, Hashable, Sendable {
    var key: String?
    var label: String
    var pct: Double?
    var reset: Double?
    /// Newer providers (Agy, GLM) name the period and scope; older Claude and Codex windows carry only a label.
    var period: String? = nil
    var scope: String? = nil
    /// "5 hours" or "Weekly" in the chosen language, from the window's period; other labels as reported.
    var name: String {
        if label == "MCP · 월간" { return L.t("MCP · Monthly", "MCP · 월간") }
        switch periodKey {
        case "5h": return L.t("5 hours", "5시간")
        case "weekly": return L.t("Weekly", "주간")
        case "monthly" where label == "월간": return L.t("Monthly", "월간")
        default: return label
        }
    }
    var periodKey: String {
        if let period, period != "unknown" { return period }
        if key == "7d" || key == "weekly" { return "weekly" }
        if key == "5h" { return "5h" }
        return ["주간": "weekly", "Weekly": "weekly", "5H": "5h", "5시간": "5h", "24H": "daily"][label] ?? "unknown"
    }
    var isWeekly: Bool { scope != "mcp" && periodKey == "weekly" }
}

struct Quota: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var kind: String
    var accountLabel: String
    var plan: String?
    var updated: Double?
    var stale: Bool
    var note: String?
    /// Why a value could not be refreshed: login_required, login_expired, rate_limited, …
    var status: String?
    var windows: [QuotaWindow]
    var weekly: [String: WeeklyPeriod]?
    /// [time, weekly %, reset] report points, newest last.
    var usagePoints: [[Double]]?
    /// The name given to the account in the desktop app; it replaces the account's number.
    var alias: String? = nil
    /// An Agy limit pool ("Gemini Models"); pools of one installation are told apart by this name.
    var pool: String? = nil
    /// false for an Agy pool: the provider does not say which Google account it belongs to.
    var identityVerified: Bool? = nil
    /// The one window a tile shows: model weekly, then 5 hours, then daily, then any other model
    /// window. An MCP or other budget stands in only when the account reports no model window.
    var representativeWindow: QuotaWindow? {
        let model = windows.filter { $0.scope != "mcp" }, list = model.isEmpty ? windows : model
        for period in ["weekly", "5h", "daily"] { if let w = list.first(where: { $0.periodKey == period }) { return w } }
        return list.first
    }
    /// A verified account's weekly window is the only one a burn rate is measured against.
    var burnAllowed: Bool { identityVerified != false && representativeWindow?.isWeekly == true }
    /// Error states leave a value unknown or old; never 0% and never unlimited.
    var unavailable: Bool { ["provider_unavailable", "invalid_response", "no_quota", "unsafe_cli_response", "unsupported_cli"].contains(status ?? "") }
    /// Four compact tiles: every provider gets one before any gets a second, in the computers' order.
    static func pickTiles(_ rows: [Quota], count: Int = 4) -> [Quota] {
        var kinds: [String] = []; for q in rows where !kinds.contains(q.kind) { kinds.append(q.kind) }
        var taken = Set<String>(), round = 0
        while taken.count < min(count, rows.count), round < rows.count {
            for kind in kinds where taken.count < count {
                let list = rows.filter { $0.kind == kind }
                if round < list.count { taken.insert(list[round].id) }
            }
            round += 1
        }
        return rows.filter { taken.contains($0.id) }
    }
    /// The account's sign-in on the computer has to be renewed before the limit can update.
    var needsReconnect: Bool { ["login_required", "login_expired", "credential_store_unavailable", "access_denied"].contains(status ?? "") }
    /// What a stale value says instead of a rate: reconnect needed, or how old it is.
    var staleLabel: String {
        if needsReconnect { return L.t("Reconnect needed", "재연결 필요") }
        if ["unsafe_cli_response", "unsupported_cli"].contains(status ?? "") { return L.t("Checks stopped", "조회 중단") }
        if unavailable && (updated ?? 0) <= 0 { return L.t("No value", "값 없음") }
        return Format.reportAge(updated)
    }
    var weeklyWindow: QuotaWindow? { windows.first { $0.label == "주간" || $0.key == "7d" || $0.key == "weekly" } }
    var fiveHour: QuotaWindow? { windows.first { $0.label == "5H" || $0.key == "5h" } }
    /// The relay masks accounts as "Claude · 4f21a8"; the tool is already the tile title, so keep the tag.
    var handle: String {
        if let tag = accountLabel.components(separatedBy: " · ").last, accountLabel.contains(" · ") { return tag }
        return accountLabel.split(separator: "@").first.map(String.init) ?? accountLabel
    }
}

struct Host: Codable, Hashable, Sendable {
    var cpu: Double?
    var usedMemory: Double?
    var totalMemory: Double?
    var cores: Int?
    var memoryPercent: Double? {
        guard let usedMemory, let totalMemory, totalMemory > 0 else { return nil }
        return usedMemory / totalMemory * 100
    }
}

struct PeriodTotal: Codable, Hashable, Sendable {
    var key: String
    var label: String?
    var tokens: [Double]?
    var partial: Bool?
}

/// Goals, loops and skills as the computer reports them. Loop activity is not verified yet.
struct Operations: Codable, Hashable, Sendable {
    struct Goal: Codable, Hashable, Sendable {
        var runtime: String?
        var status: String?
        var tokensUsed: Double?
        var timeUsedSeconds: Double?
        var sessionConnected: Bool?
    }
    var updated: Double?
    var installedSkills: Double?
    var observedEvents: Double?
    var loopState: String?
    var goals: [Goal]?
}

struct DeviceSnapshot: Codable, Hashable, Sendable {
    var version: String?
    var updated: Double?
    var sessions: [Session]
    var host: Host?
    var accountQuotas: [Quota]?
    var periods: [PeriodTotal]?
    var flow: [String: FlowSeries]?
    var operations: Operations?
    var recordingStarted: Double?
}

struct Device: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var platform: String?
    var online: Bool
    /// When the relay last heard from this computer, in milliseconds.
    var received: Double
    var snapshot: DeviceSnapshot?
    var receivedDate: Date { Date(timeIntervalSince1970: received / 1000) }
}

/// What a control request asked for, echoed back in its receipt.
struct ActionRequest: Codable, Hashable, Sendable {
    var action: String
    var requestId: String
    var deviceId: String
    var sessionId: String
    var controlKey: String?
}

/// The relay's answer to /api/action: sent, unconfirmed, or (for a repeated ID) the final state.
struct ActionReceipt: Decodable, Sendable {
    var request: ActionRequest?
    var status: String
    var message: String?
}

/// One message to a session and the session's reply. Bodies live on the computer; the relay only
/// carries the latest ten on request.
struct MailMessage: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var text: String
    var created: Double
    var status: String
    var reply: String?
    var replyAt: Double?
    var truncated: Bool?
    /// Sent from this phone and not yet in the computer's list.
    var local: Bool?
    /// Photos sent with the message. The relay keeps no image data, so only these facts come back.
    var attachments: [MailAttachment]?
    /// The session is answering this request right now (contract v1.1.0): seen only after the
    /// request reached the session and real activity followed it. Nil otherwise.
    var activity: MailActivity?
}

struct MailActivity: Codable, Hashable, Sendable {
    /// responding, working or writing.
    var phase: String
    var observedAt: Double?
}

struct MailAttachment: Codable, Hashable, Sendable {
    var id: String?
    var name: String?
    var mime: String?
    var bytes: Double?
}

/// `POST /api/action` for a message, with photos as base64 JPEG (mobile conversation contract v1.0.0).
struct MessagePayload: Encodable {
    struct Photo: Encodable { var mime: String; var data: String }
    var action = "message"
    var requestId: String
    var deviceId: String
    var sessionId: String
    var controlKey: String
    var prompt: String
    var attachments: [Photo]?
    enum CodingKeys: String, CodingKey {
        case action, prompt, attachments
        case requestId = "request_id", deviceId = "device_id", sessionId = "session_id", controlKey = "control_key"
    }
}

struct RelayAccount: Decodable, Hashable, Sendable {
    var role: String?
    var plan: String?
}

/// Messages on the relay's live socket that the app reads; others are ignored.
struct LiveMessage: Decodable, Sendable {
    var type: String
    var devices: [Device]?
    var device: Device?
    var deviceId: String?
    var sessionId: String?
    var requestId: String?
    var request: ActionRequest?
    var status: String?
    var message: String?
    var messages: [MailMessage]?
    var error: String?
}

extension JSONDecoder {
    /// Relay payloads use snake_case keys.
    static func relay() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}
