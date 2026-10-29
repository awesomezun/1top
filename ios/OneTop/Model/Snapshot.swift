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
    var weekly: QuotaWindow? { windows.first { $0.label == "주간" || $0.key == "7d" || $0.key == "weekly" } }
    var fiveHour: QuotaWindow? { windows.first { $0.label == "5H" || $0.key == "5h" } }
    var handle: String { accountLabel.split(separator: "@").first.map(String.init) ?? accountLabel }
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
