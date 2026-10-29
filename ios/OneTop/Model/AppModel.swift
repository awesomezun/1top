import Foundation
import Observation

/// What the phone shows: the connected computers from the relay, or a demo with no account.
@MainActor @Observable
final class AppModel {
    enum Connection: Equatable { case signedOut, connecting, live, offline, restricted, demo }

    var connection: Connection = .signedOut
    var devices: [Device] = []
    var selectedDeviceID: String?
    var period: Period = .h1
    var message: String?
    private(set) var token: String?
    private var liveTask: Task<Void, Never>?

    init() {
        if ProcessInfo.processInfo.arguments.contains("--demo") { showDemo(); return }
        #if DEBUG
        TokenStore.importDevelopmentToken()
        #endif
        if let saved = TokenStore.load() { token = saved; connect() }
    }

    var device: Device? { devices.first { $0.id == selectedDeviceID } ?? devices.first { $0.online } ?? devices.first }
    var sessions: [Session] { device?.snapshot?.sessions ?? [] }
    var quotas: [Quota] { device?.snapshot?.accountQuotas ?? [] }

    /// Working sessions first, then every other session together, each by selected-period tokens.
    /// Same order as the dashboard and the menu bar; states never split the usage order.
    var orderedSessions: [Session] {
        sessions.sorted {
            if $0.isWorking != $1.isWorking { return $0.isWorking }
            let a = $0.tokens(in: period) ?? -1, b = $1.tokens(in: period) ?? -1
            return a != b ? a > b : $0.id < $1.id
        }
    }
    /// The selected period's total, or nil when no session reported tokens.
    var periodTokens: Double? {
        let values = sessions.compactMap { $0.tokens(in: period) }
        return values.isEmpty ? nil : values.reduce(0, +)
    }
    /// Average speed over the selected period in tokens per hour, as on the desktop instrument.
    var averagePerHour: Double? { periodTokens.map { $0 / period.seconds * 3600 } }

    // MARK: Sign-in and live updates
    func finishSignIn(callback: URL, token: String, state: String) async {
        guard URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "state" })?.value == state else {
            message = "로그인 응답이 이 요청과 맞지 않습니다."; return
        }
        do {
            _ = try await Relay.request("/api/devices", token: token)
            TokenStore.save(token); self.token = token; message = nil; connect()
        } catch { message = error.localizedDescription }
    }

    func signOut() async {
        liveTask?.cancel(); liveTask = nil
        if let token { _ = try? await Relay.request("/api/mobile/logout", token: token, body: [:]) }
        TokenStore.delete(); token = nil; devices = []; connection = .signedOut
    }

    func showDemo() {
        liveTask?.cancel(); liveTask = nil
        devices = DemoData.devices(now: Date().timeIntervalSince1970); selectedDeviceID = devices.first?.id
        connection = .demo
    }

    func leaveDemo() { devices = []; connection = token == nil ? .signedOut : .connecting; if token != nil { connect() } }

    func connect() {
        guard let token else { return }
        liveTask?.cancel()
        liveTask = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self else { return }
                self.connection = .connecting
                do {
                    let data = try await Relay.request("/api/devices", token: token)
                    if let list = try? JSONDecoder.relay().decode(DeviceList.self, from: data).devices { self.devices = list }
                    let socket = try await Relay.liveSocket(token: token)
                    self.connection = .live; self.message = nil; attempt = 0
                    while !Task.isCancelled {
                        let frame = try await socket.receive()
                        guard case .string(let text) = frame, let data = text.data(using: .utf8),
                              let live = try? JSONDecoder.relay().decode(LiveMessage.self, from: data) else { continue }
                        self.apply(live)
                    }
                    socket.cancel(with: .goingAway, reason: nil)
                } catch let failure as Relay.Failure where failure.status == 401 || failure.status == 403 {
                    self.connection = failure.status == 403 ? .restricted : .signedOut
                    self.message = failure.message
                    if failure.status == 401 { TokenStore.delete(); self.token = nil }
                    return
                } catch {
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
        default: break
        }
    }

    private struct DeviceList: Decodable { var devices: [Device]? }
}
