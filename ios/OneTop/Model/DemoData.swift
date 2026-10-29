import Foundation

/// A made-up computer for trying the app without an account. No real projects or accounts.
enum DemoData {
    static func devices(now: Double) -> [Device] {
        func vector(_ total: Double) -> [Double] { [total * 0.01, total * 0.92, total * 0.04, total * 0.03] }
        func session(_ id: String, _ kind: String, _ model: String, _ project: String, _ terminal: String,
                     _ status: String, _ hour: Double) -> Session {
            let windows: [String: [Double]?] = ["10m": vector(hour * 0.21), "30m": vector(hour * 0.55), "1h": vector(hour),
                                                "5h": vector(hour * 3.6), "12h": vector(hour * 7.4), "24h": vector(hour * 12.8)]
            let account = kind == "Codex" ? "demo:codex" : "demo:claude", per = kind == "Codex" ? 1.1e-7 : 3.2e-8
            let estimates = Dictionary(uniqueKeysWithValues: Period.allCases.map { p in
                (p.rawValue, WeeklyEstimate(usedPp: (windows[p.rawValue] ?? nil).map { $0.reduce(0, +) * per }, partial: false, accountId: account,
                                            calibration: .init(ppPerToken: per, confidence: "stable")))
            })
            return Session(id: id, controlKey: id, kind: kind, app: "Orca", terminal: terminal, project: project, title: nil,
                           model: model, status: status, tokens: vector(hour * 40), rate: status == "working" ? hour / 3600 : 0,
                           windows: windows, cpu: status == "working" ? 12.4 : 0.3, rss: 410, capabilities: ["focus", "pause"],
                           weeklyAccount: kind == "GLM" ? nil : account, weeklyEstimate: kind == "GLM" ? nil : estimates)
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
            Quota(id: "demo:claude", kind: "Claude", accountLabel: "Claude · 4f21a8", plan: "max", updated: now - 40, stale: false, note: nil,
                  windows: [QuotaWindow(key: "5h", label: "5H", pct: 38, reset: now + 9_400), QuotaWindow(key: "7d", label: "주간", pct: 27, reset: now + 290_000)],
                  weekly: weekly(4.2), usagePoints: points(from: 21.5, to: 27, now: now)),
            Quota(id: "demo:codex", kind: "Codex", accountLabel: "Codex · 9c03e2", plan: "pro", updated: now - 55, stale: false, note: nil,
                  windows: [QuotaWindow(key: "7d", label: "주간", pct: 23, reset: now + 410_000)],
                  weekly: weekly(2.1), usagePoints: points(from: 19.5, to: 23, now: now)),
        ]
        var flow: [String: FlowSeries] = [:]
        for period in Period.allCases {
            let step: Double = period.seconds <= 3600 ? 60 : period.seconds <= 18000 ? 300 : 900
            let count = Int(period.seconds / step)
            flow[period.rawValue] = FlowSeries(step: step, start: now - period.seconds, end: now, reported: true, bins: (0..<count).map { i in
                let wave: Double = 0.55 + 0.45 * sin(Double(i) / 4.3) * cos(Double(i) / 11.0)
                let busy: Double = i % 17 < 3 ? 0.25 : 1, scale: Double = step / 60
                let claude: Double = 1_150_000 * scale * max(0.05, wave) * busy, codex: Double = 520_000 * scale * max(0.05, 1 - wave * 0.6)
                return ["Claude": claude, "Codex": codex]
            })
        }
        let snapshot = DeviceSnapshot(version: "4.0.0", updated: now, sessions: sessions,
                                      host: Host(cpu: 31.5, usedMemory: 61.4e9, totalMemory: 128e9, cores: 16), accountQuotas: quotas,
                                      periods: nil, flow: flow)
        return [Device(id: "demo-mac", name: "데모 Mac", platform: "macOS", online: true, received: now - 2, snapshot: snapshot)]
    }

    private static func weekly(_ perHour: Double) -> [String: WeeklyPeriod] {
        Dictionary(uniqueKeysWithValues: Period.allCases.map { ($0.rawValue, WeeklyPeriod(usedPp: perHour * $0.seconds / 3600, observedSeconds: $0.seconds, partial: false)) })
    }
    private static func points(from: Double, to: Double, now: Double) -> [[Double]] {
        (0..<24).map { i -> [Double] in
            let t: Double = now - Double(23 - i) * 3600
            let step: Double = (to - from) * Double(i) / 23
            let bump: Double = i % 5 == 0 ? 0.4 : 0
            return [t, from + step + bump, now + 290_000]
        }
    }
}
