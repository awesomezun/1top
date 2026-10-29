import CryptoKit
import Foundation
import Security

/// The relay the phone signs in through. Same flow as the Expo app: a random device token whose
/// SHA-256 challenge is approved on 1top.si, then Bearer requests and a ticketed live socket.
enum Relay {
    static let managed = URL(string: "https://onetop-relay.gitreels.workers.dev")!
    static let callbackScheme = "onetop"
    /// The relay this phone signs in through: the managed one, or a trusted self-hosted origin.
    static var current: URL { UserDefaults.standard.string(forKey: "relay").flatMap { try? origin($0) } ?? managed }

    /// An HTTPS origin with no path, port, credentials, query or fragment, as the Expo app requires.
    static func origin(_ text: String) throws -> URL {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: trimmed), parts.scheme?.lowercased() == "https", let host = parts.host, host.contains("."),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil, parts.port == nil,
              parts.path.isEmpty || parts.path == "/", let url = URL(string: "https://" + host.lowercased())
        else { throw Failure(status: nil, message: L.t("Use an HTTPS relay origin without a path.", "경로 없는 HTTPS 서버 주소를 입력하세요.")) }
        return url
    }
    static func select(_ text: String) throws -> URL {
        let url = try origin(text)
        UserDefaults.standard.set(url.absoluteString, forKey: "relay")
        return url
    }
    static func label(_ url: URL) -> String { url.host() ?? url.absoluteString }
    /// Cloudflare in front of the relay rejects anonymous client signatures; name the app.
    static let userAgent = "1top/\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2") (iPhone; iOS)"

    struct Failure: LocalizedError {
        var status: Int?
        var message: String
        var errorDescription: String? { message }
    }

    /// The sign-in page and the token it will approve. The token is stored only after approval.
    static func signInRequest(relay: URL = current) -> (url: URL, token: String, state: String) {
        let token = "1tm_" + randomHex(32), state = randomHex(16)
        let challenge = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
        var parts = URLComponents(string: "https://1top.si/mobile-connect")!
        parts.queryItems = [.init(name: "challenge", value: challenge), .init(name: "state", value: state),
                            .init(name: "relay", value: relay.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
                            .init(name: "platform", value: "iOS")]
        return (parts.url!, token, state)
    }

    static func randomHex(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func request(_ path: String, token: String, body: [String: String]? = nil, relay: URL = current) async throws -> Data {
        try await send(path, token: token, body: try body.map { try JSONEncoder().encode($0) }, timeout: 15, relay: relay)
    }

    /// A JSON payload with nested values, such as a message with photo attachments.
    static func request(_ path: String, token: String, payload: some Encodable, timeout: TimeInterval = 30, relay: URL = current) async throws -> Data {
        try await send(path, token: token, body: try JSONEncoder().encode(payload), timeout: timeout, relay: relay)
    }

    private static func send(_ path: String, token: String, body: Data?, timeout: TimeInterval, relay: URL) async throws -> Data {
        var request = URLRequest(url: relay.appending(path: path), timeoutInterval: timeout)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(status: status, message: message ?? L.t("Relay answered \(status)", "릴레이 응답 \(status)"))
        }
        return data
    }

    struct Ticket: Decodable { var ticket: String; var socketUrl: URL }

    /// Opens the live socket. The relay only accepts its own wss origin and the 1top subprotocols.
    static func liveSocket(token: String, relay: URL = current) async throws -> URLSessionWebSocketTask {
        let data = try await request("/api/live-ticket", token: token, body: [:], relay: relay)
        let ticket = try JSONDecoder.relay().decode(Ticket.self, from: data)
        guard ticket.socketUrl.scheme == "wss", ticket.socketUrl.host() == relay.host(), ticket.socketUrl.path() == "/api/live" else {
            throw Failure(status: nil, message: L.t("Unexpected relay socket address.", "예상하지 못한 릴레이 소켓 주소입니다."))
        }
        var request = URLRequest(url: ticket.socketUrl)
        request.setValue("1top, ticket." + ticket.ticket, forHTTPHeaderField: "Sec-WebSocket-Protocol")
        request.setValue("https://1top.si", forHTTPHeaderField: "Origin")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        let task = URLSession.shared.webSocketTask(with: request)
        task.resume()
        return task
    }
}

/// The device token lives in the Keychain, readable only while this iPhone is unlocked. It is
/// stored with the relay that approved it and is never sent to another relay.
enum TokenStore {
    private static let service = "si.onetop.native", account = "session.v1"
    private struct Saved: Codable { var token: String; var relay: String }
    private static func valid(_ token: String) -> Bool { token.range(of: #"^1tm_[a-f0-9]{64}$"#, options: .regularExpression) != nil }

    static func load(relay: URL = Relay.current) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        if let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            return saved.relay == relay.absoluteString && valid(saved.token) ? saved.token : nil
        }
        // Tokens saved before relay selection belong to the managed relay.
        guard let token = String(data: data, encoding: .utf8), valid(token), relay == Relay.managed else { return nil }
        return token
    }

    static func save(_ token: String, relay: URL = Relay.current) {
        delete()
        guard let data = try? JSONEncoder().encode(Saved(token: token, relay: relay.absoluteString)) else { return }
        let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                   kSecAttrAccount as String: account, kSecValueData as String: data,
                                   kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        SecItemAdd(item as CFDictionary, nil)
    }

    #if DEBUG
    /// Development only: a token approved on the Mac can be copied into this app's Documents as
    /// development-mobile-auth.json ({"token", "relay"}). It is moved into the Keychain once and the
    /// file is deleted at once. Release builds never contain this path.
    static func importDevelopmentToken() {
        guard let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let file = folder.appending(path: "development-mobile-auth.json")
        guard let data = try? Data(contentsOf: file) else { return }
        defer { try? FileManager.default.removeItem(at: file) }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String, token.range(of: #"^1tm_[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              (object["relay"] as? String)?.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == Relay.managed.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
              Relay.current == Relay.managed
        else { return }
        save(token, relay: Relay.managed)
    }
    #endif

    static func delete() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
    }
}
