import CryptoKit
import Foundation
import Security

/// The relay the phone signs in through. Same flow as the Expo app: a random device token whose
/// SHA-256 challenge is approved on 1top.si, then Bearer requests and a ticketed live socket.
enum Relay {
    static let managed = URL(string: "https://onetop-relay.gitreels.workers.dev")!
    static let callbackScheme = "onetop"

    struct Failure: LocalizedError {
        var status: Int?
        var message: String
        var errorDescription: String? { message }
    }

    /// The sign-in page and the token it will approve. The token is stored only after approval.
    static func signInRequest(relay: URL = managed) -> (url: URL, token: String, state: String) {
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

    static func request(_ path: String, token: String, body: [String: String]? = nil, relay: URL = managed) async throws -> Data {
        var request = URLRequest(url: relay.appending(path: path), timeoutInterval: 15)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(status: status, message: message ?? "릴레이 응답 \(status)")
        }
        return data
    }

    struct Ticket: Decodable { var ticket: String; var socketUrl: URL }

    /// Opens the live socket. The relay only accepts its own wss origin and the 1top subprotocols.
    static func liveSocket(token: String, relay: URL = managed) async throws -> URLSessionWebSocketTask {
        let data = try await request("/api/live-ticket", token: token, body: [:], relay: relay)
        let ticket = try JSONDecoder.relay().decode(Ticket.self, from: data)
        guard ticket.socketUrl.scheme == "wss", ticket.socketUrl.host() == relay.host(), ticket.socketUrl.path() == "/api/live" else {
            throw Failure(status: nil, message: "예상하지 못한 릴레이 소켓 주소입니다.")
        }
        var request = URLRequest(url: ticket.socketUrl)
        request.setValue("1top, ticket." + ticket.ticket, forHTTPHeaderField: "Sec-WebSocket-Protocol")
        request.setValue("https://1top.si", forHTTPHeaderField: "Origin")
        let task = URLSession.shared.webSocketTask(with: request)
        task.resume()
        return task
    }
}

/// The device token lives in the Keychain, readable only while this iPhone is unlocked.
enum TokenStore {
    private static let service = "si.onetop.native", account = "session.v1"

    static func load() -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account, kSecReturnData as String: true]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
              let token = String(data: data, encoding: .utf8), token.range(of: #"^1tm_[a-f0-9]{64}$"#, options: .regularExpression) != nil
        else { return nil }
        return token
    }

    static func save(_ token: String) {
        delete()
        let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                   kSecAttrAccount as String: account, kSecValueData as String: Data(token.utf8),
                                   kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        SecItemAdd(item as CFDictionary, nil)
    }

    static func delete() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                    kSecAttrAccount as String: account]
        SecItemDelete(query as CFDictionary)
    }
}
