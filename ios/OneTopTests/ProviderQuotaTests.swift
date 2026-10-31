import XCTest
@testable import OneTop

/// Agy pools and GLM windows (provider-quotas-contract v1.0.2): the tile shows one representative
/// window, a burn rate only for a verified weekly window, and four tiles spread over the providers.
/// The rows are tests/fixtures/provider-quotas_v1.0.2.json, also checked on the web, Android and Mac.
final class ProviderQuotaTests: XCTestCase {
    private let rows = #"""
[{"id": "claude:fixture-a", "kind": "Claude", "account_label": "fixture-a@example.test", "plan": "Max", "windows": [{"label": "5H", "pct": 41, "reset": 1900003600}, {"label": "주간", "pct": 22, "reset": 1900400000}], "updated": 1899999990, "stale": false, "note": "fixture"}, {"id": "claude:fixture-b", "kind": "Claude", "account_label": "fixture-b@example.test", "plan": "Pro", "windows": [{"label": "5H", "pct": 12, "reset": 1900003600}, {"label": "주간", "pct": 64, "reset": 1900400000}], "updated": 1899999990, "stale": false, "note": "fixture"}, {"id": "codex:fixture-c", "kind": "Codex", "account_label": "fixture-c@example.test", "plan": "Plus", "windows": [{"label": "5H", "pct": 9, "reset": 1900003600}, {"label": "주간", "pct": 31, "reset": 1900400000}], "updated": 1899999990, "stale": false, "note": "fixture"}, {"id": "antigravity:pool-gemini", "kind": "Antigravity", "account_label": "Gemini Models", "alias": null, "provider": "Google Antigravity", "pool": "Gemini Models", "identity_source": "cli_profile", "identity_verified": false, "plan": "", "windows": [{"key": "gemini-weekly", "period": "weekly", "label": "주간", "pct": 48.5, "reset": 1900400000, "seconds": 604800}, {"key": "gemini-5h", "period": "5h", "label": "5H", "pct": 17, "reset": 1900003600, "seconds": 18000}], "updated": 1899999990, "stale": false, "source": "agy_usage", "note": "agy /usage 공식 한도 · 2분마다 확인"}, {"id": "antigravity:pool-claude-gpt", "kind": "Antigravity", "account_label": "Claude and GPT models", "provider": "Google Antigravity", "pool": "Claude and GPT models", "identity_source": "cli_profile", "identity_verified": false, "plan": "", "windows": [{"key": "cg-5h", "period": "5h", "label": "5H", "pct": 5, "reset": 1900003600, "seconds": 18000}, {"key": "cg-weekly", "period": "weekly", "label": "주간", "pct": 12.5, "reset": 1900400000, "seconds": 604800}], "updated": 1899999990, "stale": false, "source": "agy_usage", "note": "agy /usage 공식 한도 · 2분마다 확인"}, {"id": "antigravity:pool-argon", "kind": "Antigravity", "account_label": "Gemini 4 Argon", "alias": "Gemini 4 Argon", "provider": "Google Antigravity", "pool": "Gemini 4 Argon", "identity_source": "cli_profile", "identity_verified": false, "plan": "", "windows": [{"key": "argon-weekly", "period": "weekly", "label": "주간", "pct": 75.5, "reset": 1900400000, "seconds": 604800}], "updated": 1899999990, "stale": false, "source": "agy_usage", "note": "agy /usage 공식 한도 · 2분마다 확인"}, {"id": "glm:fixture-key", "kind": "GLM", "account_label": "GLM · ab12cd", "provider": "Z.ai", "plan": "", "identity_source": "credential_fingerprint", "windows": [{"key": "mcp", "period": "monthly", "label": "MCP · 월간", "pct": 3, "reset": 1901000000, "seconds": null, "scope": "mcp", "meter": "TIME_LIMIT"}, {"key": "tokens", "period": "5h", "label": "5H", "pct": 27.25, "reset": 1900003600, "seconds": 18000, "scope": "models", "meter": "TOKENS_LIMIT"}], "updated": 1899999990, "stale": false, "source": "zai_usage", "note": "공식 API · 2분마다 확인"}, {"id": "glm:fixture-down", "kind": "GLM", "account_label": "GLM", "plan": "", "windows": [], "updated": 0, "stale": true, "status": "provider_unavailable", "note": "계정 조회 지연 · 마지막 보고값"}]
"""#

    func testRepresentativeWindowsAndTiles() throws {
        let quotas = try JSONDecoder.relay().decode([Quota].self, from: Data(rows.utf8))
        let byId = Dictionary(uniqueKeysWithValues: quotas.map { ($0.id, $0) })
        XCTAssertEqual(byId["claude:fixture-a"]?.representativeWindow?.label, "주간")
        XCTAssertEqual(byId["claude:fixture-a"]?.burnAllowed, true)
        XCTAssertEqual(byId["antigravity:pool-claude-gpt"]?.representativeWindow?.key, "cg-weekly")
        XCTAssertEqual(byId["antigravity:pool-gemini"]?.burnAllowed, false)
        XCTAssertEqual(byId["antigravity:pool-gemini"]?.pool, "Gemini Models")
        XCTAssertEqual(byId["glm:fixture-key"]?.representativeWindow?.label, "5H")
        XCTAssertEqual(byId["glm:fixture-key"]?.burnAllowed, false)
        XCTAssertNil(byId["glm:fixture-down"]?.representativeWindow)
        XCTAssertEqual(byId["glm:fixture-down"]?.unavailable, true)
        var mcpOnly = byId["glm:fixture-key"]!; mcpOnly.windows = mcpOnly.windows.filter { $0.scope == "mcp" }
        XCTAssertEqual(mcpOnly.representativeWindow?.key, "mcp")
        XCTAssertEqual(Quota.pickTiles(quotas).map(\.id), ["claude:fixture-a", "codex:fixture-c", "antigravity:pool-gemini", "glm:fixture-key"])
        XCTAssertEqual(Quota.pickTiles(Array(quotas.prefix(3))).count, 3)
    }
}
