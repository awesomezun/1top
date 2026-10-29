import SwiftUI

/// Tool colours match the dashboard and the menu bar, so a tool reads the same everywhere.
enum Tool {
    static func color(_ kind: String) -> Color {
        switch kind {
        case "Claude": Color(red: 0.831, green: 0.584, blue: 0.420)
        case "Codex": Color(red: 0.247, green: 0.682, blue: 0.549)
        case "GLM": Color(red: 0.561, green: 0.596, blue: 0.878)
        case "Antigravity": Color(red: 0.380, green: 0.616, blue: 0.725)
        case "Aside": Color(red: 0.663, green: 0.608, blue: 0.859)
        default: Color.gray
        }
    }
    static func name(_ kind: String) -> String {
        kind == "Claude" ? "Claude Code" : kind == "Antigravity" ? "Agy CLI" : kind
    }
    /// Model IDs without the vendor prefix the tool colour already shows.
    static func model(_ id: String?) -> String? {
        guard var name = id?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { return nil }
        name = name.replacingOccurrences(of: "[1m]", with: "", options: .caseInsensitive)
        if name.lowercased().hasPrefix("claude-") { name = String(name.dropFirst(7)) }
        if name.lowercased().hasPrefix("gpt-") { name = "GPT-" + name.dropFirst(4) }
        return name
    }
}

extension Color {
    /// The 1top mint: segment digits, the beam and the accent.
    static let mint1top = Color("AccentColor")
    static let segmentOn = Color(red: 0.455, green: 0.831, blue: 0.694)
}

enum Format {
    /// 158M, 7.5M, 0. Unknown stays a dash, never zero.
    static func tokens(_ value: Double?) -> String {
        guard let value, value.isFinite, value >= 0 else { return "—" }
        if value < 0.5 { return "0" }
        let (divisor, suffix): (Double, String) = value >= 1e9 ? (1e9, "B") : value >= 1e6 ? (1e6, "M") : value >= 1e3 ? (1e3, "k") : (1, "")
        let x = value / divisor
        let text = x >= 10 ? String(Int(x.rounded())) : String(format: "%.1f", x).replacingOccurrences(of: #"\.0$"#, with: "", options: .regularExpression)
        return text + suffix
    }
    /// Percentages carry at most one decimal place.
    static func percent(_ value: Double?) -> String {
        guard let value, value.isFinite, value >= 0 else { return "—" }
        if value == 0 { return "0%" }
        if value < 0.05 { return "<0.1%" }
        let tenths = (value * 10).rounded() / 10
        return (tenths == tenths.rounded() ? String(Int(tenths)) : String(format: "%.1f", tenths)) + "%"
    }
    static func reset(_ at: Double?, now: Double = Date().timeIntervalSince1970) -> String {
        guard let at, at > 0 else { return "초기화 시각 미보고" }
        let minutes = Int(ceil((at - now) / 60))
        if minutes <= 0 { return "초기화 보고 대기" }
        if minutes >= 1440 { return "\(minutes / 1440)일 \((minutes % 1440) / 60)시간 후 초기화" }
        return minutes >= 60 ? "\(minutes / 60)시간 \(minutes % 60)분 후 초기화" : "\(minutes)분 후 초기화"
    }
    static func status(_ status: String) -> String {
        ["working": "작업 중", "waiting": "확인 필요", "paused": "일시정지", "idle": "대기 중", "interrupted": "중단됨", "resuming": "재개 중"][status] ?? "상태 미확인"
    }
}
