import Foundation
import Combine
import CoreGraphics

struct DesktopSnapshot: Decodable {
    var ready: Bool
    var updated: Double?
    var error: String?
    var sessions: [DesktopSession]?
    var root_sessions: [DesktopSession]?
    var period_usage: PeriodUsage?
    var system: SystemUsage?
    var action_token: String?
    var account_quotas: [AccountQuota]?
    var events: [UsageEvent]?
    var weekly_usage: WeeklyUsage?
    struct UsageEvent: Decodable {
        var t: Double; var n: Double?
        var kind: String?
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
    var effort: String?
    var status: String?; var display_status: String?; var tokens: [Double]?
    var usage: Usage?; var resources: Resources?; var orca_terminal: Terminal?
    var location: Location?; var control_key: String?; var input_verified: Bool?
    var children_count: Int?; var children_working: Int?; var children_ids: [String]?
    var group_usage_partial: Bool?
    struct Usage: Decodable {
        var rate: Double?; var windows: [String: [Double]?]?
        var weekly_estimate: [String: WeeklyEstimate]?; var weekly_account: String?
        func weeklyBurnPerHour(period: String) -> Double? {
            guard let estimate = weekly_estimate?[period],
                  let weekly_account, !weekly_account.isEmpty,
                  estimate.account_id == weekly_account else { return nil }
            return estimate.burnPerHour(tokensPerSecond: rate)
        }
    }
    struct Resources: Decodable { var cpu: Double?; var rss: Double? }
    struct Terminal: Decodable { var title: String? }
    struct Location: Decodable { var app: String?; var app_path: String?; var terminal: String? }
    var state: String { display_status ?? status ?? "unknown" }
    var reportedEffort: String? {
        guard let value = effort?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
    var isWorkingGroup: Bool { state == "working" || (children_working ?? 0) > 0 }
    var groupStateLabel: String {
        (children_working ?? 0) > 0 ? "\(stateLabel) · 하위 \(children_working ?? 0)개 작업 중" : stateLabel
    }
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
        var source: String?; var kind: String?; var reset: Double?; var valid_until: Double?
        var age_seconds: Double?; var report_source: String?; var from: Double?; var to: Double?
    }
    func permitsBurnRate(for quota: AccountQuota?, at now: Double) -> Bool {
        guard let quota, quota.id == account_id, now.isFinite else { return false }
        guard calibration?.source == "historical_provider_calibration" else { return !quota.stale }
        guard quota.kind == "Claude", calibration?.kind == "Claude",
              let reset = calibration?.reset, reset.isFinite,
              let validUntil = calibration?.valid_until, validUntil.isFinite,
              let observedTo = calibration?.to, observedTo.isFinite, observedTo > 0, observedTo <= now,
              let currentReset = quota.windows.first(where: { $0.label == "주간" })?.reset,
              currentReset.isFinite, currentReset > now,
              abs(reset - currentReset) <= 60, validUntil > now,
              validUntil <= min(reset, observedTo + 86400) else { return false }
        return true
    }
    // A recent-token-rate equivalent, not a forecast of future account deductions.
    func burnPerHour(tokensPerSecond: Double?) -> Double? {
        guard basis == "calibrated_token_equivalent", let calibration,
              calibration.tokens.isFinite, calibration.tokens > 0,
              calibration.used_pp.isFinite, calibration.used_pp > 0,
              calibration.seconds.isFinite, calibration.seconds >= 120,
              let tokensPerSecond, tokensPerSecond.isFinite, tokensPerSecond >= 0 else { return nil }
        let value = tokensPerSecond * (calibration.used_pp / calibration.tokens) * 3600
        return value.isFinite ? value : nil
    }
    var scopeLabel: String {
        "환산 추정" + (calibration?.confidence == "early" ? " · 초기" : "") + (partial ? " · 일부 토큰" : "")
    }
    var calculationLabel: String {
        guard let calibration, let tokens else { return "환산 기준 미확인" }
        let historical = calibration.source == "historical_provider_calibration"
        let date = calibration.to.flatMap { $0.isFinite ? Date(timeIntervalSince1970: $0).formatted(date: .abbreviated, time: .shortened) : nil }
        return "선택 기간 \(DesktopFormat.number(tokens)) tokens × (\(DesktopFormat.quota(calibration.used_pp)) ÷ \(DesktopFormat.number(calibration.tokens)) tokens)\n기준 \(Int(calibration.seconds / 60))분 관측 · 현재 계정 기준 환산" +
            (historical ? "\n이전 제공자 관측 기준" + (date.map { " · " + $0 } ?? "") : "")
    }
}
struct WeeklyUsage: Decodable {
    var accounts: [Account]
    struct Account: Decodable, Identifiable {
        var id: String; var periods: [String: Period]
        var history: [[Double]]?
        var flow: [[Double]]?
        // [time, weekly %, reset]: reconciled report points; preferred over history like the dashboard.
        var usage_points: [[Double]]?
    }
    struct Period: Decodable {
        var used_pp: Double?; var partial: Bool; var observed_seconds: Double
        // Partial periods use their observed duration, never the requested window length.
        var burnPerHour: Double? {
            guard let used_pp, used_pp.isFinite, used_pp >= 0,
                  observed_seconds.isFinite, observed_seconds >= 120 else { return nil }
            let value = (used_pp / observed_seconds) * 3600
            return value.isFinite ? value : nil
        }
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
    static func burnRate(_ value: Double?) -> String {
        guard let value, value.isFinite, value >= 0 else { return "—" }
        return quota(value) + "/시간"
    }
    static func duration(_ seconds: Double?) -> String {
        guard let seconds, seconds.isFinite, seconds >= 0,
              seconds < Double(Int.max) / 2 else { return "—" }
        let minutes = Int(seconds / 60)
        if minutes == 0 { return "1분 미만" }
        if minutes < 60 { return "\(minutes)분" }
        return minutes % 60 == 0 ? "\(minutes / 60)시간" : "\(minutes / 60)시간 \(minutes % 60)분"
    }
}

struct DesktopUsageTrend {
    struct Bin: Identifiable {
        var id: Int; var start: Double; var end: Double; var tokens: Double
        var tokensByKind: [String: Double] = [:]
    }
    var bins: [Bin]
    var reported: Bool
    // Canonical bottom-to-top order; independent of event arrival order.
    var series: [String] {
        let kinds = Set(bins.flatMap { $0.tokensByKind.keys })
        let preferred = ["Claude", "Codex", "GLM", "Antigravity", "Aside"]
        return preferred.filter(kinds.contains) + kinds.filter { !preferred.contains($0) }
            .sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
    }
    var maximum: Double { Self.niceMaximum(bins.map(\.tokens).max() ?? 0) }
    static func niceMaximum(_ peak: Double) -> Double {
        guard peak.isFinite, peak > 0 else { return 1 }
        let power = pow(10, floor(log10(peak))), fraction = peak / power
        return ([1.0, 2, 5, 10].first { $0 >= fraction } ?? 10) * power
    }
    init(events: [DesktopSnapshot.UsageEvent]?, period: String, end: Double) {
        let seconds: Double = ["10m":600, "30m":1800, "1h":3600, "5h":18000, "12h":43200, "24h":86400][period] ?? 3600
        // Shared with the full dashboard: snapshot clock, minute boundary,
        // and 1/5/15-minute buckets. No width-dependent resampling.
        let finish = floor((end.isFinite ? end : 0) / 60) * 60 + 60, start = finish - seconds
        let step: Double = seconds > 18000 ? 900 : seconds > 3600 ? 300 : 60
        let count = Int(seconds / step)
        bins = (0..<count).map { Bin(id:$0, start:start + Double($0)*step, end:start + Double($0+1)*step, tokens:0) }
        reported = events != nil
        for event in events ?? [] where event.t.isFinite && event.total.isFinite && event.total >= 0 && event.t >= start && event.t < finish {
            let index = min(count-1, Int((event.t-start)/step)); bins[index].tokens += event.total
            let value = event.kind?.trimmingCharacters(in: .whitespacesAndNewlines)
            let kind = value.flatMap { $0.isEmpty ? nil : $0 } ?? "unknown"
            bins[index].tokensByKind[kind, default: 0] += event.total
        }
    }
}

struct DesktopWeeklyUsageTrend {
    struct Bin: Identifiable {
        var id: Int; var start: Double; var end: Double
        // nil means no eligible report, not zero consumption.
        var usedPP: Double?
    }
    var bins: [Bin]
    var observedSeconds: Double
    var observedFrom: Double?
    var observedTo: Double?
    var total: Double { bins.compactMap(\.usedPP).reduce(0, +) }
    var reported: Bool { observedSeconds > 0 }

    init(history: [[Double]]?, flow: [[Double]]? = nil, period: String, end: Double) {
        let seconds: Double = ["10m":600, "30m":1800, "1h":3600, "5h":18000, "12h":43200, "24h":86400][period] ?? 3600
        let finish = end.isFinite ? end : 0, start = finish - seconds
        let count = min(36, Int(seconds / 60)), step = seconds / Double(count)
        bins = (0..<count).map { Bin(id:$0, start:start + Double($0)*step, end:start + Double($0+1)*step) }
        observedSeconds = 0
        var intervals = flow ?? []
        if flow == nil {
            // Legacy payloads lack reset-aware intervals. Never fall back when
            // an explicit empty flow says the server rejected every interval.
            let points = history ?? []
            intervals = zip(points, points.dropFirst()).compactMap { before, after in
                guard before.count >= 2, after.count >= 2,
                      before[1].isFinite, after[1].isFinite,
                      (0...100).contains(before[1]), (0...100).contains(after[1]) else { return nil }
                return [before[0], after[0], after[1] - before[1]]
            }
        }
        var previousEnd: Double?
        for interval in intervals {
            guard interval.count >= 3 else { continue }
            let t0 = interval[0], t1 = interval[1], delta = interval[2]
            guard t0.isFinite, t1.isFinite, delta.isFinite,
                  t0 >= start, t1 <= finish, t1 > t0, t1 - t0 <= 300,
                  (0...100).contains(delta), t0 >= (previousEnd ?? t0) else { continue }
            // Place changes at report time. Do not interpolate a rounded provider
            // update over earlier bins or invent values across resets and gaps.
            let index = min(count - 1, max(0, Int((t1 - start) / step)))
            bins[index].usedPP = (bins[index].usedPP ?? 0) + delta
            observedSeconds += t1 - t0
            observedFrom = min(observedFrom ?? t0, t0)
            observedTo = max(observedTo ?? t1, t1)
            previousEnd = t1
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
    var sessions: [DesktopSession] { snapshot?.root_sessions ?? snapshot?.sessions ?? [] }
    var fresh: Bool { connected && snapshot?.isFresh(at: now) == true }
    var working: Int { sessions.filter(\.isWorkingGroup).count }
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
        // Recompute from the selected period; do not retain stale status or usage ranks.
        func amount(_ row: DesktopSession) -> Double {
            let values = row.usage?.windows?[selectedPeriod] ?? nil
            let amount = values.flatMap { values -> Double? in
                guard !values.isEmpty, values.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
                let total = values.reduce(0, +)
                return total.isFinite ? total : nil
            }
            return amount ?? -1
        }
        return sessions.sorted {
            if $0.isWorkingGroup != $1.isWorkingGroup { return $0.isWorkingGroup }
            let ar = amount($0), br = amount($1)
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
        case "last_report": return "마지막 보고"
        case "report_pending": return "보고 대기"
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
