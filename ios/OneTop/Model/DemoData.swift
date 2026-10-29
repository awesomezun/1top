import Foundation

/// A made-up computer for trying the app without an account. No real projects or accounts.
enum DemoData {
    static func devices(now: Double) -> [Device] {
        func vector(_ total: Double) -> [Double] { [total * 0.01, total * 0.92, total * 0.04, total * 0.03] }
        func session(_ id: String, _ kind: String, _ model: String, _ project: String, _ terminal: String,
                     _ status: String, _ hour: Double) -> Session {
            let windows: [String: [Double]?] = ["10m": vector(hour * 0.21), "30m": vector(hour * 0.55), "1h": vector(hour),
                                                "5h": vector(hour * 3.6), "12h": vector(hour * 7.4), "24h": vector(hour * 12.8)]
            return Session(id: id, controlKey: id, kind: kind, app: "Orca", terminal: terminal, project: project, title: nil,
                           model: model, status: status, tokens: vector(hour * 40), rate: status == "working" ? hour / 3600 : 0,
                           windows: windows, cpu: status == "working" ? 12.4 : 0.3, rss: 410, capabilities: ["focus", "pause"])
        }
        let sessions = [
            session("d1", "Claude", "claude-opus-5-5", "storefront", "결제 화면 개편", "working", 52_400_000),
            session("d2", "Codex", "gpt-6-astra", "api-gateway", "요청 제한 테스트", "working", 31_800_000),
            session("d3", "Claude", "claude-opus-5-5", "docs-site", "문서 검색 개선", "working", 12_900_000),
            session("d4", "Codex", "gpt-6-astra", "ml-pipeline", "학습 데이터 정리", "waiting", 9_600_000),
            session("d5", "GLM", "glm-5.3", "storefront", "번역 검수", "idle", 4_100_000),
            session("d6", "Claude", "claude-sonnet-5-5", "mobile-app", "알림 설정 화면", "idle", 2_700_000),
            session("d7", "Codex", "gpt-6-astra", "infra", "배포 스크립트", "paused", 1_200_000),
            session("d8", "Claude", "claude-opus-5-5", "design-system", "토큰 정리", "idle", 0),
        ]
        let quotas = [
            Quota(id: "demo:claude", kind: "Claude", accountLabel: "studio@example.com", plan: "max", updated: now - 40, stale: false,
                  windows: [QuotaWindow(key: "5h", label: "5H", pct: 38, reset: now + 9_400), QuotaWindow(key: "7d", label: "주간", pct: 27, reset: now + 290_000)]),
            Quota(id: "demo:codex", kind: "Codex", accountLabel: "lab@example.com", plan: "pro", updated: now - 55, stale: false,
                  windows: [QuotaWindow(key: "7d", label: "주간", pct: 23, reset: now + 410_000)]),
        ]
        let snapshot = DeviceSnapshot(version: "4.0.0", sessions: sessions,
                                      host: Host(cpu: 31.5, usedMemory: 61.4e9, totalMemory: 128e9, cores: 16), accountQuotas: quotas)
        return [Device(id: "demo-mac", name: "데모 Mac", platform: "macOS", online: true, received: now - 2, snapshot: snapshot)]
    }
}
