import Foundation
import Observation

/// What the phone shows: the connected computers from the relay, or a demo with no account.
@MainActor @Observable
final class AppModel {
    enum Connection: Equatable { case signedOut, connecting, live, offline, restricted, demo }

    /// The latest word on a control request for one session: in flight, or final.
    struct ControlNote: Equatable { var id: String; var text: String; var final: Bool }
    /// One session's messages and the last mailbox error.
    struct Mailbox: Equatable { var messages: [MailMessage] = []; var error: String? }

    var connection: Connection = .signedOut
    var devices: [Device] = []
    /// One computer, or nil for every computer together.
    var selectedDeviceID: String?
    var period: Period = .h1
    var message: String?
    var account: RelayAccount?
    var relay: URL = Relay.current
    var language: Language = Language.saved {
        didSet { language.save(); L.ko = language == .ko }
    }
    /// Request IDs in flight by session key; the relay allows one control at a time per session.
    var pending: [String: String] = [:]
    var notes: [String: ControlNote] = [:]
    var mailboxes: [String: Mailbox] = [:]
    /// Computers paired without remote control (`allow_control` 0 in /api/devices). Live snapshots do
    /// not carry the flag, so the device list is matched by id.
    var controlOff: Set<String> = []
    var busy = false
    private(set) var token: String?
    private var liveTask: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?

    init() {
        L.ko = language == .ko
        if ProcessInfo.processInfo.arguments.contains("--demo") { showDemo(); return }
        #if DEBUG
        TokenStore.importDevelopmentToken()
        #endif
        if let saved = TokenStore.load(relay: relay) { token = saved; connect() }
    }

    // MARK: Computers in view
    /// A report counts as fresh for 30 seconds; controls need one from the last 20.
    func isFresh(_ device: Device?, within milliseconds: Double = 30_000) -> Bool {
        guard let device else { return false }
        if connection == .demo { return true }
        return device.online && Date().timeIntervalSince1970 * 1000 - device.received < milliseconds
    }
    var selectedDevice: Device? { selectedDeviceID.flatMap { id in devices.first { $0.id == id } } }
    /// The chosen computer, or all of them.
    var visibleDevices: [Device] { selectedDevice.map { [$0] } ?? devices.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    /// The dashboard adds up computers that are reporting now; with none, it keeps the last records.
    var reportingDevices: [Device] {
        let live = visibleDevices.filter { isFresh($0) }
        return live.isEmpty ? visibleDevices : live
    }
    var scopeName: String {
        if let selectedDevice { return selectedDevice.name }
        return devices.count == 1 ? devices[0].name : L.t("All computers", "모든 컴퓨터") + " · \(devices.count)"
    }
    func device(for session: Session) -> Device? { devices.first { $0.id == session.deviceId } }

    /// A computer paired without remote control offers no controls, instructions or messages.
    private func sessions(of list: [Device]) -> [Session] {
        list.flatMap { d in
            (d.snapshot?.sessions ?? []).map { var s = $0; s.deviceId = d.id; if controlOff.contains(d.id) { s.capabilities = [] }; return s }
        }
    }
    func isControlOff(_ s: Session) -> Bool { s.deviceId.map(controlOff.contains) ?? false }
    /// Sessions on the dashboard: the reporting computers.
    var sessions: [Session] { sessions(of: reportingDevices) }
    /// Sessions in the list: every computer in view, stale ones marked.
    var allSessions: [Session] { sessions(of: visibleDevices) }

    /// Each account once, from the computer that reported it last.
    var quotas: [Quota] {
        var seen: [String: Quota] = [:], order: [String] = []
        for d in reportingDevices {
            for q in d.snapshot?.accountQuotas ?? [] {
                if let old = seen[q.id] {
                    if (old.stale && !q.stale) || (old.stale == q.stale && (q.updated ?? 0) > (old.updated ?? 0)) { seen[q.id] = q }
                } else { seen[q.id] = q; order.append(q.id) }
            }
        }
        return order.compactMap { seen[$0] }
    }
    /// The newest report time among the reporting computers, in seconds.
    var reportEnd: Double { reportingDevices.compactMap { $0.snapshot?.updated }.max() ?? Date().timeIntervalSince1970 }

    /// Root sessions with their subagents folded in, in the shared order.
    var groups: [SessionGroup] {
        let byRoot = Dictionary(grouping: sessions) { ($0.deviceId ?? "") + ":" + ($0.rootSessionId ?? $0.id) }
        return byRoot.map { key, members in
            SessionGroup(root: members.first { $0.key == key } ?? members[0], members: members)
        }
        .sorted {
            if $0.isWorking != $1.isWorking { return $0.isWorking }
            let a = $0.tokens(in: period) ?? -1, b = $1.tokens(in: period) ?? -1
            return a != b ? a > b : $0.id < $1.id
        }
    }

    /// Working sessions first, then every other session together, each by selected-period tokens.
    /// Same order as the dashboard and the menu bar; states never split the usage order. A session on
    /// a computer that stopped reporting is not counted as working.
    var orderedSessions: [Session] {
        allSessions.sorted {
            let a = isWorking($0), b = isWorking($1)
            if a != b { return a }
            let x = $0.tokens(in: period) ?? -1, y = $1.tokens(in: period) ?? -1
            return x != y ? x > y : $0.key < $1.key
        }
    }
    func isWorking(_ s: Session) -> Bool { s.isWorking && isFresh(device(for: s)) }

    /// The selected period's tokens from each computer's own period total, so sessions that ended
    /// still count; a computer without totals falls back to its current sessions.
    var periodTokens: Double? {
        var total = 0.0, known = false
        for d in reportingDevices {
            if let vector = d.snapshot?.periods?.first(where: { $0.key == period.rawValue })?.tokens, !vector.isEmpty,
               vector.allSatisfy({ $0.isFinite && $0 >= 0 }) {
                total += vector.reduce(0, +); known = true
            } else {
                let values = (d.snapshot?.sessions ?? []).compactMap { $0.tokens(in: period) }
                if !values.isEmpty { total += values.reduce(0, +); known = true }
            }
        }
        return known ? total : nil
    }
    /// Average speed over the selected period in tokens per hour, as on the desktop instrument.
    var averagePerHour: Double? { periodTokens.map { $0 / period.seconds * 3600 } }

    /// The collector's fine bins summed across computers on real time, not position, as in the
    /// 1top.si cockpit (`reading`) and the Android app (`fleetFlow`). Computers report at different
    /// moments, so the axis ends where every one has reported; a bin some computer did not cover
    /// stays unknown. Nil when steps differ or a start is missing: the radar then uses the nested
    /// period totals.
    var flow: FlowSeries? {
        let list = reportingDevices
        let flows = list.compactMap { $0.snapshot?.flow?[period.rawValue] }.filter { $0.step > 0 && !$0.bins.isEmpty }
        guard !flows.isEmpty, flows.count == list.count, let step = flows.first?.step, flows.allSatisfy({ $0.step == step }) else { return nil }
        if flows.count == 1 { return flows[0] }
        func valid(_ n: Double?) -> Double? { n.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil } }
        guard flows.allSatisfy({ valid($0.start) != nil }) else { return nil }
        let end = flows.map { valid($0.end) ?? valid($0.start)! + Double($0.bins.count) * step }.min() ?? 0
        let count = flows.map(\.bins.count).max() ?? 0
        let bins: [[String: Double]?] = (0..<count).map { k in
            let from = end - Double(count - k) * step
            var sum: [String: Double] = [:]
            for f in flows {
                let j = Int(floor((from - valid(f.start)!) / step + 0.5))
                guard j >= 0, j < f.bins.count, let bin = f.bins[j] else { return nil }
                for (kind, value) in bin where value.isFinite && value >= 0 { sum[kind, default: 0] += value }
            }
            return sum
        }
        return FlowSeries(step: step, start: end - Double(count) * step, end: end, reported: true, bins: bins)
    }

    // MARK: Controls
    /// Controls need a live connection and a report from the last 20 seconds.
    func canControl(_ s: Session) -> Bool { connection == .demo || (connection == .live && isFresh(device(for: s), within: 20_000)) }

    static func actionLabel(_ action: String) -> String {
        switch action {
        case "prompt": L.t("Send AI instruction", "AI에게 지시 보내기")
        case "focus": L.t("Open on computer", "컴퓨터에서 열기")
        case "pause": L.t("Pause work", "작업 일시정지")
        case "resume": L.t("Resume work", "작업 재개")
        case "terminate": L.t("Quit CLI", "CLI 종료")
        case "message": L.t("Send message", "메시지 보내기")
        default: action
        }
    }

    #if DEBUG
    /// UI test runs pass -qaGuard YES; then only the session named by -qaSession can receive a
    /// control or a message, so a test can never act on someone's real work.
    private func qaBlocked(_ s: Session) -> Bool {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: "qaGuard") else { return false }
        guard let allowed = defaults.string(forKey: "qaSession"), !allowed.isEmpty else { return true }
        return allowed != s.id
    }
    private static let qaRefusal = "QA 보호: 시험 세션이 아니어서 보내지 않았습니다."
    #endif

    private func note(_ key: String, id: String, _ text: String, final: Bool) {
        if let old = notes[key], old.id == id, old.final { return }
        notes[key] = ControlNote(id: id, text: text, final: final)
        message = text
    }

    /// Sends one control after the person confirmed it. A request whose result never arrives is
    /// reported as unconfirmed, never retried on its own.
    func control(_ s: Session, action: String, instruction: String? = nil) async {
        guard let device = device(for: s), s.can(action), pending[s.key] == nil else { return }
        if action == "prompt" {
            guard let instruction, !instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, instruction.utf16.count <= 4000 else {
                message = L.t("Enter an instruction up to 4,000 characters.", "4,000자 이내의 지시를 입력하세요."); return
            }
        }
        if connection == .demo {
            note(s.key, id: "demo", L.t("Demo only. No command was sent.", "체험 화면입니다. 명령을 전송하지 않았습니다."), final: true); return
        }
        guard canControl(s), let token else {
            note(s.key, id: "stale", L.t("Computer report is stale. Reconnect first.", "컴퓨터 정보가 오래됐습니다. 먼저 재연결하세요."), final: true); return
        }
        #if DEBUG
        if qaBlocked(s) { note(s.key, id: "qa", Self.qaRefusal, final: true); return }
        #endif
        let id = UUID().uuidString.lowercased(), key = s.key
        pending[key] = id
        note(key, id: id, L.t("Sending…", "전송 중…"), final: false)
        var body = ["action": action, "request_id": id, "device_id": device.id, "session_id": s.id, "control_key": s.controlKey ?? ""]
        if action == "prompt" { body["prompt"] = instruction }
        do {
            let data = try await Relay.request("/api/action", token: token, body: body, relay: relay)
            let done = (try? JSONDecoder.relay().decode(ActionReceipt.self, from: data))?.status == "completed"
            if done { pending[key] = nil }
            note(key, id: id, done ? L.t("Completed", "완료") : L.t("Sent. Waiting for the computer.", "전송했습니다. 컴퓨터 응답을 기다립니다."), final: done)
        } catch {
            pending[key] = nil
            note(key, id: id, error.localizedDescription, final: true); return
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(25))
            guard let self, self.pending[key] == id else { return }
            self.pending[key] = nil
            self.note(key, id: id, L.t("Result unconfirmed. Check the computer before retrying.", "결과 미확인. 다시 요청하기 전에 컴퓨터를 확인하세요."), final: true)
        }
    }

    // MARK: Mailbox
    /// The latest mailbox request; only its answer is applied, so a late reply for a screen that
    /// has since closed never lands in another one.
    private var mailboxAsk: (requestId: String, deviceId: String, sessionId: String)?

    /// Asks the computer for this session's latest messages; the answer arrives on the socket.
    @discardableResult
    func readMailbox(_ s: Session) -> Bool {
        guard connection == .live, let socket, let device = device(for: s), s.can("mailbox") else { return false }
        let id = UUID().uuidString.lowercased()
        mailboxAsk = (id, device.id, s.id)
        let payload = ["type": "mailbox_request", "request_id": id, "device_id": device.id,
                       "session_id": s.id, "control_key": s.controlKey ?? ""]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let text = String(data: data, encoding: .utf8) else { return false }
        socket.send(.string(text)) { _ in }
        return true
    }

    /// Sends a message the session answers in its mailbox. Throws when it cannot be sent.
    func sendMessage(_ s: Session, text: String) async throws {
        guard let device = device(for: s), s.can("message"), canControl(s) else {
            throw Relay.Failure(status: nil, message: L.t("This session cannot receive messages right now.", "현재 이 세션에 메시지를 보낼 수 없습니다."))
        }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf16.count <= 4000 else {
            throw Relay.Failure(status: nil, message: L.t("Enter up to 4,000 characters.", "4,000자 이내로 입력하세요."))
        }
        let id = UUID().uuidString.lowercased(), created = Date().timeIntervalSince1970
        if connection == .demo {
            mailboxes[s.key, default: Mailbox()].messages.append(MailMessage(
                id: id, text: text, created: created, status: "replied",
                reply: L.t("Demo reply: I have finished the first checks and am reviewing the remaining failures.", "예시 답신: 첫 검사를 마쳤고 남은 오류를 확인하고 있습니다."),
                replyAt: created, truncated: false, local: true))
            return
        }
        guard let token else { throw Relay.Failure(status: 401, message: L.t("Sign in again.", "다시 로그인하세요.")) }
        #if DEBUG
        if qaBlocked(s) { throw Relay.Failure(status: nil, message: Self.qaRefusal) }
        #endif
        _ = try await Relay.request("/api/action", token: token, body: ["action": "message", "request_id": id, "device_id": device.id,
                                                                         "session_id": s.id, "control_key": s.controlKey ?? "", "prompt": text], relay: relay)
        mailboxes[s.key, default: Mailbox()].messages.append(MailMessage(id: id, text: text, created: created, status: "sending", local: true))
    }

    private func applyReceipt(_ live: LiveMessage) {
        guard let request = live.request else { return }
        let key = request.deviceId + ":" + request.sessionId, failed = live.status == "failed"
        for (k, v) in pending where v == request.requestId { pending[k] = nil }
        let detail = (live.message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let head = failed ? L.t("Failed", "실패") : live.status == "completed" ? L.t("Completed", "완료") : (live.status ?? "")
        notes[key] = ControlNote(id: request.requestId, text: head + (detail.isEmpty ? "" : " · " + detail), final: true)
        message = notes[key]?.text
        if var box = mailboxes[key], let i = box.messages.firstIndex(where: { $0.id == request.requestId }) {
            box.messages[i].status = failed ? "delivery_unconfirmed" : "awaiting_reply"
            if failed { box.error = detail.isEmpty ? nil : detail }
            mailboxes[key] = box
        }
    }

    private func applyMailbox(_ live: LiveMessage) {
        guard let deviceId = live.deviceId, let sessionId = live.sessionId, let ask = mailboxAsk,
              live.requestId == ask.requestId, deviceId == ask.deviceId, sessionId == ask.sessionId else { return }
        mailboxAsk = nil
        let key = deviceId + ":" + sessionId
        var box = mailboxes[key] ?? Mailbox()
        if let error = live.error { box.error = error; mailboxes[key] = box; return }
        let server = live.messages ?? [], now = Date().timeIntervalSince1970
        let waiting = box.messages.filter { m in m.local == true && !server.contains { $0.id == m.id } }.map { m -> MailMessage in
            var m = m
            if now - m.created > 30 { m.status = "delivery_unconfirmed" }
            return m
        }
        box.error = nil
        box.messages = server + waiting
        mailboxes[key] = box
    }

    // MARK: Sign-in and live updates
    func finishSignIn(callback: URL, token: String, state: String) async {
        guard URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "state" })?.value == state else {
            message = L.t("Sign-in response did not match this request.", "로그인 응답이 이 요청과 맞지 않습니다."); return
        }
        do {
            _ = try await Relay.request("/api/devices", token: token, relay: relay)
            TokenStore.save(token, relay: relay); self.token = token; message = nil; connect()
        } catch { message = error.localizedDescription }
    }

    func signOut() async {
        busy = true; defer { busy = false }
        liveTask?.cancel(); liveTask = nil; socket = nil
        if let token {
            do { _ = try await Relay.request("/api/mobile/logout", token: token, body: [:], relay: relay) }
            catch let failure as Relay.Failure where failure.status != 400 && failure.status != 401 { message = failure.message }
            catch {}
        }
        TokenStore.delete(); token = nil
        resetAccountState(); connection = .signedOut
    }

    /// Changing servers is allowed only while signed out, so a token never meets another relay.
    func changeRelay(_ text: String) throws {
        guard token == nil else { throw Relay.Failure(status: nil, message: L.t("Sign out before changing servers.", "서버 변경 전에 로그아웃하세요.")) }
        relay = try Relay.select(text)
        message = L.t("Server saved. Sign in to connect.", "서버를 저장했습니다. 로그인하여 연결하세요.")
    }

    private func resetAccountState() {
        devices = []; account = nil; selectedDeviceID = nil; pending = [:]; notes = [:]; mailboxes = [:]; controlOff = []; mailboxAsk = nil
    }

    func showDemo() {
        liveTask?.cancel(); liveTask = nil; socket = nil
        resetAccountState()
        devices = DemoData.devices(now: Date().timeIntervalSince1970)
        mailboxes = DemoData.mailboxes(now: Date().timeIntervalSince1970)
        controlOff = DemoData.controlOff
        connection = .demo
    }

    func leaveDemo() {
        resetAccountState()
        connection = token == nil ? .signedOut : .connecting
        if token != nil { connect() }
    }

    func connect() {
        guard let token else { return }
        liveTask?.cancel()
        let relay = relay
        liveTask = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self else { return }
                self.connection = .connecting
                do {
                    let data = try await Relay.request("/api/devices", token: token, relay: relay)
                    if let info = try? JSONDecoder.relay().decode(AccountEnvelope.self, from: data) {
                        if let account = info.account { self.account = account }
                        if let list = info.devices { self.controlOff = Set(list.filter { $0.allowControl == false }.map(\.id)) }
                    }
                    let socket = try await Relay.liveSocket(token: token, relay: relay)
                    self.socket = socket; self.mailboxAsk = nil
                    self.connection = .live; self.message = nil; attempt = 0
                    while !Task.isCancelled {
                        let frame = try await socket.receive()
                        guard case .string(let text) = frame, let data = text.data(using: .utf8),
                              let live = try? JSONDecoder.relay().decode(LiveMessage.self, from: data) else { continue }
                        self.apply(live)
                    }
                    socket.cancel(with: .goingAway, reason: nil)
                } catch let failure as Relay.Failure where failure.status == 400 || failure.status == 401 || failure.status == 403 {
                    self.socket = nil
                    self.connection = failure.status == 403 ? .restricted : failure.status == 401 ? .signedOut : .offline
                    self.message = failure.message
                    if failure.status == 401 { TokenStore.delete(); self.token = nil }
                    return
                } catch {
                    self.socket = nil
                    if Task.isCancelled { return }
                    self.connection = .offline; self.message = error.localizedDescription
                }
                attempt += 1
                try? await Task.sleep(for: .seconds(min(30, pow(2, Double(min(attempt, 5))))))
            }
        }
    }

    private func apply(_ live: LiveMessage) {
        switch live.type {
        case "state": if let list = live.devices { devices = list }
        case "snapshot":
            if let device = live.device { devices.removeAll { $0.id == device.id }; devices.append(device) }
        case "offline":
            if let id = live.deviceId, let i = devices.firstIndex(where: { $0.id == id }) { devices[i].online = false }
        case "removed":
            devices.removeAll { $0.id == live.deviceId }
            if selectedDeviceID == live.deviceId { selectedDeviceID = nil }
        case "result": applyReceipt(live)
        case "mailbox": applyMailbox(live)
        default: break
        }
    }

    private struct AccountEnvelope: Decodable { var account: RelayAccount?; var devices: [DeviceAccess]? }
    /// A paired computer in /api/devices. D1 stores `allow_control` as 0/1; a boolean is accepted too.
    private struct DeviceAccess: Decodable {
        var id: String
        var allowControl: Bool?
        enum CodingKeys: String, CodingKey { case id, allowControl }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            if let flag = try? c.decode(Bool.self, forKey: .allowControl) { allowControl = flag }
            else if let number = try? c.decode(Int.self, forKey: .allowControl) { allowControl = number != 0 }
            else { allowControl = nil }
        }
    }
}

/// A root session and its subagents. Usage adds up across the family; weekly estimates add up only
/// within the root's account, since another account's limit is a different 100%.
struct SessionGroup: Identifiable {
    var root: Session
    var members: [Session]
    var id: String { root.key }
    var childCount: Int { members.count - 1 }
    var isWorking: Bool { members.contains(where: \.isWorking) }

    func tokens(in period: Period) -> Double? {
        let known = members.compactMap { $0.tokens(in: period) }
        return known.isEmpty ? nil : known.reduce(0, +)
    }
    var rate: Double? {
        let known = members.compactMap { $0.rate }.filter { $0.isFinite && $0 >= 0 }
        return known.isEmpty ? nil : known.reduce(0, +)
    }
    private func account(_ period: Period) -> String? { root.weeklyEstimate?[period.rawValue]?.accountId ?? root.weeklyAccount }
    private func sameAccount(_ period: Period) -> [(Session, WeeklyEstimate)] {
        guard let account = account(period) else { return [] }
        return members.compactMap { s in s.weeklyEstimate?[period.rawValue].flatMap { $0.accountId == account ? (s, $0) : nil } }
    }
    /// ≈ percentage points of the weekly limit used in the period.
    func estimate(in period: Period) -> Double? {
        let values = sameAccount(period).compactMap(\.1.usedPp).filter { $0.isFinite && $0 >= 0 }
        return values.isEmpty ? nil : values.reduce(0, +)
    }
    /// Current pace in weekly-limit percentage points per hour: tokens per second × points per token.
    func pace(in period: Period) -> Double? {
        let values = sameAccount(period).compactMap { s, e -> Double? in
            guard let rate = s.rate, let per = e.calibration?.ppPerToken, rate.isFinite, per.isFinite, rate >= 0, per >= 0 else { return nil }
            return rate * per * 3600
        }
        return values.isEmpty ? nil : values.reduce(0, +)
    }
}
