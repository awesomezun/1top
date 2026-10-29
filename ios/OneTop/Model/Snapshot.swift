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
        case .m10: "10분"
        case .m30: "30분"
        case .h1: "1시간"
        case .h5: "5시간"
        case .h12: "12시간"
        case .h24: "24시간"
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
        return project == "0" && kind == "Aside" ? "Aside 기본 작업공간" : project
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

/// Token bins over a period, oldest first, by tool.
struct FlowSeries: Codable, Hashable, Sendable {
    var step: Double
    var start: Double?
    var end: Double?
    var reported: Bool?
    var bins: [[String: Double]]
}

struct QuotaWindow: Codable, Hashable, Sendable {
    var key: String?
    var label: String
    var pct: Double?
    var reset: Double?
}

struct Quota: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var kind: String
    var accountLabel: String
    var plan: String?
    var updated: Double?
    var stale: Bool
    var note: String?
    var windows: [QuotaWindow]
    var weekly: [String: WeeklyPeriod]?
    /// [time, weekly %, reset] report points, newest last.
    var usagePoints: [[Double]]?
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

struct DeviceSnapshot: Codable, Hashable, Sendable {
    var version: String?
    var updated: Double?
    var sessions: [Session]
    var host: Host?
    var accountQuotas: [Quota]?
    var periods: [PeriodTotal]?
    var flow: [String: FlowSeries]?
}

struct Device: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var platform: String?
    var online: Bool
    var received: Double
    var snapshot: DeviceSnapshot?
}

/// Messages on the relay's live socket that the app reads; others are ignored.
struct LiveMessage: Decodable, Sendable {
    var type: String
    var devices: [Device]?
    var device: Device?
}

extension JSONDecoder {
    /// Relay payloads use snake_case keys.
    static func relay() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}
