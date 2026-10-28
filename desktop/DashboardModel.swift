import Foundation
import Combine
import CoreGraphics

struct DesktopSnapshot: Decodable {
    var ready: Bool
    var updated: Double?
    var error: String?
    var sessions: [DesktopSession]?
    var period_usage: PeriodUsage?
    var system: SystemUsage?
    var action_token: String?
    var account_quotas: [AccountQuota]?
    var events: [UsageEvent]?
    var weekly_usage: WeeklyUsage?
    struct UsageEvent: Decodable {
        var t: Double; var n: Double?
        var fresh: Double?; var cached: Double?; var written: Double?; var output: Double?
        var total: Double { n ?? ((fresh ?? 0) + (cached ?? 0) + (written ?? 0) + (output ?? 0)) }
    }
    struct PeriodUsage: Decodable {
        var known_kinds: [String]
        var windows: [Window]
        struct Window: Decodable, Identifiable {
            var key: String; var label: String; var tokens: [Double]
            var partial: Bool; var observed_seconds: Double
            var id: String { key }
        }
    }
    struct SystemUsage: Decodable {
        var host: Host?
        struct Host: Decodable {
            var cpu: Double?; var memory: Memory?
            struct Memory: Decodable { var percent: Double?; var used: Double? }
        }
    }
    func isFresh(at now: Date = Date()) -> Bool {
        guard ready, error == nil || error == "", let updated else { return false }
        return (-5...20).contains(now.timeIntervalSince1970 - updated)
    }
}
struct DesktopSession: Decodable, Identifiable {
    var id: String; var kind: String; var project: String?; var title: String?; var model: String?
    var status: String?; var display_status: String?; var tokens: [Double]?
    var usage: Usage?; var resources: Resources?; var orca_terminal: Terminal?
    var location: Location?; var control_key: String?; var input_verified: Bool?
    struct Usage: Decodable { var rate: Double?; var windows: [String: [Double]?]?; var weekly_estimate: [String: WeeklyEstimate]?; var weekly_account: String? }
    struct Resources: Decodable { var cpu: Double?; var rss: Double? }
    struct Terminal: Decodable { var title: String? }
    struct Location: Decodable { var app: String?; var app_path: String?; var terminal: String? }
    var state: String { display_status ?? status ?? "unknown" }
    var terminalName: String { orca_terminal?.title ?? location?.app ?? "실행 위치 미확인" }
    var locationLabel: String { orca_terminal != nil ? "Orca · \(terminalName)" : terminalName }
    var stateLabel: String {
        ["working":"작업 중", "waiting":"확인 필요", "idle":"대기", "paused":"일시정지",
         "resuming":"재개 요청 중", "interrupted":"중단됨"][state] ?? "미확인"
    }
    func allows(_ action: String) -> Bool {
        guard let control_key, !control_key.isEmpty else { return false }
        let stopped = ["idle", "interrupted"].contains(status ?? "")
        let canPause = orca_terminal != nil && input_verified != false &&
            ["working", "waiting"].contains(status ?? "") && ["Claude", "GLM", "Codex"].contains(kind)
        switch action {
        case "focus": return orca_terminal != nil || !(location?.app_path ?? "").isEmpty
        case "pause": return (kind == "Aside" && ["working", "waiting"].contains(state)) || canPause && state != "resuming" && state != "paused"
        case "resume": return state == "paused" && stopped && orca_terminal != nil && input_verified != false
        case "terminate": return kind != "Aside" && (stopped || canPause) && state != "resuming"
        default: return false
        }
    }
}
struct WeeklyEstimate: Decodable {
    var used_pp: Double; var account_id: String; var partial: Bool
    var basis: String?; var tokens: Double?; var calibration: Calibration?
    struct Calibration: Decodable {
        var tokens: Double; var used_pp: Double; var seconds: Double; var confidence: String
    }
    var scopeLabel: String {
        "환산 추정" + (calibration?.confidence == "early" ? " · 초기" : "") + (partial ? " · 일부 토큰" : "")
    }
    var calculationLabel: String {
        guard let calibration, let tokens else { return "환산 기준 미확인" }
        return "선택 기간 \(DesktopFormat.number(tokens)) tokens × (\(DesktopFormat.quota(calibration.used_pp))p ÷ \(DesktopFormat.number(calibration.tokens)) tokens)\n기준 \(Int(calibration.seconds / 60))분 관측 · 현재 계정 기준 환산"
    }
}
struct WeeklyUsage: Decodable {
    var accounts: [Account]
    struct Account: Decodable, Identifiable {
        var id: String; var periods: [String: Period]
    }
    struct Period: Decodable {
        var used_pp: Double?; var partial: Bool; var observed_seconds: Double
    }
}

enum DesktopFormat {
    static func number(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        if value >= 1e9 { return String(format: "%.2fB", value / 1e9) }
        if value >= 1e6 { return String(format: "%.2fM", value / 1e6) }
        if value >= 1e3 { return String(format: "%.1fk", value / 1e3) }
        return String(format: value.rounded() == value ? "%.0f" : "%.1f", value)
    }
    static func quota(_ value: Double?) -> String {
        guard let value, value.isFinite, value >= 0 else { return "—" }
        if value > 0 && value < 0.01 { return "<0.01%" }
        return value.formatted(.number.precision(.fractionLength(0...2))) + "%"
    }
    static func percent(_ value: Double?) -> String { value.map { String(format: "%.0f%%", $0) } ?? "—" }
    static func total(_ tokens: [Double]?) -> Double? { tokens?.reduce(0, +) }
}

struct DesktopUsageTrend {
    struct Bin: Identifiable {
        var id: Int; var start: Double; var end: Double; var tokens: Double
    }
    var bins: [Bin]
    var reported: Bool
    init(events: [DesktopSnapshot.UsageEvent]?, period: String, end: Double) {
        let seconds: Double = ["10m":600, "30m":1800, "1h":3600, "5h":18000, "12h":43200, "24h":86400][period] ?? 3600
        // Reports are aggregated by minute. Align boundaries so today's final minute is included.
        let finish = floor(end / 60) * 60 + 60, start = finish - seconds
        let count = min(36, Int(seconds / 60)), step = seconds / Double(count)
        bins = (0..<count).map { Bin(id:$0, start:start + Double($0)*step, end:start + Double($0+1)*step, tokens:0) }
        reported = events != nil
        for event in events ?? [] where event.t.isFinite && event.total.isFinite && event.total >= 0 && event.t >= start && event.t < finish {
            let index = min(count-1, Int((event.t-start)/step)); bins[index].tokens += event.total
        }
    }
}

struct DesktopUsageMap {
    struct Tile: Identifiable {
        var id: String; var title: String; var detail: String; var value: Double
    }
    struct Placement: Identifiable {
        var tile: Tile; var rect: CGRect; var colorIndex: Int
        var id: String { tile.id }
    }
    var tiles: [Tile]
    var total: Double
    var reported: Int
    var unknown: Int
    var zero: Int

    init(sessions: [DesktopSession], period: String) {
        var positive: [Tile] = []; var known = 0; var zeros = 0
        for session in sessions {
            guard session.tokens != nil, let tokens = session.usage?.windows?[period] ?? nil,
                  !tokens.isEmpty, tokens.allSatisfy({ $0.isFinite && $0 >= 0 }) else { continue }
            let value = tokens.reduce(0, +)
            guard value.isFinite else { continue }
            known += 1
            if value == 0 { zeros += 1; continue }
            let title = session.project ?? session.title ?? session.kind
            let tool = session.kind == "Claude" ? "Claude Code" : session.kind
            positive.append(Tile(id: session.id, title: title,
                detail: [session.locationLabel, tool, session.model].compactMap { $0 }.joined(separator: " · "), value: value))
        }
        positive.sort { $0.value == $1.value ? $0.id < $1.id : $0.value > $1.value }
        total = positive.reduce(0) { $0 + $1.value }; reported = known
        unknown = sessions.count - known; zero = zeros
        if !total.isFinite { tiles = []; total = 0; reported = 0; unknown = sessions.count; zero = 0; return }
        // Keep the compact panel usable while preserving the exact combined area.
        if positive.count > 8 {
            let rest = Array(positive.dropFirst(7))
            tiles = Array(positive.prefix(7)) + [Tile(id: "__other__", title: "기타 \(rest.count)개 세션",
                detail: rest.map { "\($0.title) · \($0.value.formatted(.number.precision(.fractionLength(0)))) tokens\n\($0.detail)" }.joined(separator: "\n"),
                value: rest.reduce(0) { $0 + $1.value })]
        } else { tiles = positive }
    }

    func layout(in rect: CGRect) -> [Placement] {
        guard total > 0, rect.width > 0, rect.height > 0 else { return [] }
        func split(_ values: [(Int, Tile)], _ box: CGRect) -> [Placement] {
            guard values.count > 1 else {
                return values.map { Placement(tile: $0.1, rect: box, colorIndex: $0.0) }
            }
            let sum = values.reduce(0) { $0 + $1.1.value }
            var prefix = 0.0; var best = 1; var distance = Double.infinity
            for index in 1..<values.count {
                prefix += values[index - 1].1.value
                if abs(prefix - sum / 2) < distance { best = index; distance = abs(prefix - sum / 2) }
            }
            let left = Array(values.prefix(best)), right = Array(values.dropFirst(best))
            let fraction = left.reduce(0) { $0 + $1.1.value } / sum
            if box.width >= box.height {
                let width = box.width * fraction
                return split(left, CGRect(x: box.minX, y: box.minY, width: width, height: box.height)) +
                    split(right, CGRect(x: box.minX + width, y: box.minY, width: box.width - width, height: box.height))
            }
            let height = box.height * fraction
            return split(left, CGRect(x: box.minX, y: box.minY, width: box.width, height: height)) +
                split(right, CGRect(x: box.minX, y: box.minY + height, width: box.width, height: box.height - height))
        }
        return split(Array(tiles.enumerated()), rect)
    }
}
// No credentials, snapshots, or actions are written to disk by this UI.
final class DashboardModel: ObservableObject {
    @Published var snapshot: DesktopSnapshot?
    @Published var connected = false
    @Published var selectedPeriod = "1h"
    @Published var accounts = false
    @Published var busy = false
    @Published var message: String?
    @Published var messageIsError = false
    @Published var openAtLogin = false
    @Published var now = Date()
    let baseURL: URL
    private let session: URLSession
    private var fetching = false
    private var task: URLSessionDataTask?
    var onUpdate: (() -> Void)?
    init(baseURL: URL) {
        self.baseURL = baseURL
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5; config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
    }
    var sessions: [DesktopSession] { snapshot?.sessions ?? [] }
    var fresh: Bool { connected && snapshot?.isFresh(at: now) == true }
    var working: Int { sessions.filter { $0.state == "working" }.count }
    var knownCount: Int { sessions.filter { $0.tokens != nil }.count }
    var rate: Double? {
        let reported = sessions.compactMap { $0.tokens != nil ? $0.usage?.rate : nil }
        return reported.isEmpty ? nil : reported.reduce(0, +)
    }
    var window: DesktopSnapshot.PeriodUsage.Window? { snapshot?.period_usage?.windows.first { $0.key == selectedPeriod } }
    var periodTokens: Double? {
        guard snapshot?.period_usage?.known_kinds.isEmpty == false else { return nil }
        return DesktopFormat.total(window?.tokens)
    }
    var sortedSessions: [DesktopSession] {
        let ranks = ["working":0, "waiting":1, "resuming":2, "paused":3, "interrupted":4, "unknown":5, "idle":6]
        return sessions.sorted {
            let a = ranks[$0.state] ?? 5, b = ranks[$1.state] ?? 5
            if a != b { return a < b }
            let ar = $0.usage?.rate ?? 0, br = $1.usage?.rate ?? 0
            if ar != br { return ar > br }
            return $0.id < $1.id
        }
    }
    var connectionLabel: String {
        if fresh { return "실시간 · 이 Mac" }
        if snapshot == nil { return connected ? "세션 수집 중" : "수집기 연결 중" }
        if snapshot?.ready == false { return "세션 수집 중" }
        return connected ? "수집 지연 · 마지막 기록" : "연결 끊김 · 마지막 기록"
    }
    func tick() { now = Date() }
    func refresh() {
        tick(); guard !fetching else { return }; fetching = true
        task = session.dataTask(with: baseURL.appendingPathComponent("api/state")) { [weak self] data, response, _ in
            let snapshot: DesktopSnapshot? = (response as? HTTPURLResponse)?.statusCode == 200
                ? data.flatMap { try? JSONDecoder().decode(DesktopSnapshot.self, from: $0) } : nil
            DispatchQueue.main.async {
                guard let self else { return }
                self.fetching = false; self.connected = snapshot != nil; self.now = Date()
                if let snapshot { self.snapshot = snapshot }
                self.onUpdate?()
            }
        }
        task?.resume()
    }
    func perform(_ action: String, session target: DesktopSession) {
        tick()
        guard fresh, !busy, target.allows(action),
              sessions.contains(where: { $0.id == target.id && $0.control_key == target.control_key && $0.allows(action) }),
              let token = snapshot?.action_token, !token.isEmpty else {
            message = "세션 상태가 변경되었습니다. 새로고침 후 다시 확인하세요."; messageIsError = true; return
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/action"))
        request.httpMethod = "POST"; request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue(token, forHTTPHeaderField: "X-Monitor-Token")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "action":action, "session_id":target.id, "control_key":target.control_key ?? "", "request_id":UUID().uuidString
        ])
        busy = true; message = nil
        // Mutations are sent once. A timeout must never automatically replay a control.
        session.dataTask(with: request) { [weak self] data, response, _ in
            let value = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            let ok = (response as? HTTPURLResponse)?.statusCode == 200 && value?["ok"] as? Bool == true
            DispatchQueue.main.async {
                guard let self else { return }
                self.busy = false; self.messageIsError = !ok
                self.message = value?["message"] as? String ?? "응답을 확인하지 못했습니다. 다시 누르기 전에 터미널 상태를 확인하세요."
                self.refresh()
            }
        }.resume()
    }
    func stop() { task?.cancel(); session.invalidateAndCancel() }
    func addAccount(_ kind: String) {
        guard fresh, !busy, let token = snapshot?.action_token else { return }
        busy = true
        var request = URLRequest(url: baseURL.appendingPathComponent("api/accounts/login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue(token, forHTTPHeaderField: "X-Monitor-Token")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["kind":kind])
        request.timeoutInterval = 20
        session.dataTask(with: request) { [weak self] data, response, _ in
            let value = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String:Any] }
            DispatchQueue.main.async {
                guard let self else { return }; self.busy = false
                self.messageIsError = (response as? HTTPURLResponse)?.statusCode != 200
                self.message = value?["message"] as? String ?? "로그인 창을 확인하지 못했습니다. 다시 시도하기 전에 터미널을 확인해 주세요."
            }
        }.resume()
    }
}

struct AccountQuota: Decodable, Identifiable {
    var id: String; var kind: String; var account_label: String; var plan: String?
    var windows: [Window]; var updated: Double; var stale: Bool; var note: String
    var status: String?
    var statusLabel: String {
        if !stale { return "확인됨" }
        switch status {
        case "login_required", "login_expired": return "재로그인 필요"
        case "refresh_pending": return "갱신 중"
        case "rate_limited": return "조회 제한"
        case "access_denied": return "권한 확인"
        case "credential_store_unavailable": return "저장소 확인"
        default: return updated > 0 ? "마지막 보고" : "조회 지연"
        }
    }
    struct Window: Decodable, Identifiable {
        var label: String; var pct: Double?; var reset: Double
        var id: String { label }
    }
}
