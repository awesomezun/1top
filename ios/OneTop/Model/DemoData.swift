import Foundation

/// Two made-up computers for trying the app without an account. No real projects or accounts.
/// The Android app's demo (mobile/src/demo.ts) carries the same computers, sessions, accounts and
/// conversation, so both phones show the same thing. Names follow the chosen language.
enum DemoData {
    private static let controls = ["focus", "pause", "resume", "terminate", "prompt", "message", "mailbox", "message_images"]
    /// The demo Mac mini is paired without remote control, so its sessions show usage only.
    static let controlOff: Set<String> = ["demo-mini"]
    /// Message 2 of the first conversation carries two photos; the demo shows them as sent pictures.
    static let photoMessage = "00000000-0000-4000-8000-000000000002"

    static func devices(now: Double) -> [Device] {
        func vector(_ total: Double) -> [Double] { [total * 0.01, total * 0.92, total * 0.04, total * 0.03] }
        func session(_ id: String, _ kind: String, _ model: String, _ project: String, _ terminal: String,
                     _ status: String, _ hour: Double, account: String?, capabilities: [String] = controls) -> Session {
            let windows: [String: [Double]?] = ["10m": vector(hour * 0.21), "30m": vector(hour * 0.55), "1h": vector(hour),
                                                "5h": vector(hour * 3.6), "12h": vector(hour * 7.4), "24h": vector(hour * 12.8)]
            let per = kind == "Codex" ? 1.1e-7 : 3.2e-8
            let estimates = account.map { account in
                Dictionary(uniqueKeysWithValues: Period.allCases.map { p in
                    (p.rawValue, WeeklyEstimate(usedPp: (windows[p.rawValue] ?? nil).map { $0.reduce(0, +) * per }, partial: false, accountId: account,
                                                calibration: .init(ppPerToken: per, confidence: "stable")))
                })
            }
            return Session(id: id, controlKey: "demo", kind: kind, app: kind == "Codex" ? "Orca" : "Terminal", terminal: terminal, project: project, title: nil,
                           model: model, status: status, tokens: vector(hour * 40), rate: status == "working" ? hour / 3600 : 0,
                           windows: windows, cpu: status == "working" ? 12.4 : 0.3, rss: 410, capabilities: capabilities,
                           weeklyAccount: account, weeklyEstimate: estimates)
        }
        // Two accounts per tool, numbered 1 and 2 the way the desktop dashboard numbers them; one has a
        // name given in the desktop app.
        let studio = [
            session("d1", "Claude", "claude-opus-5-5", "storefront", L.t("Checkout redesign", "결제 화면 개편"), "working", 52_400_000, account: "demo:claude-a"),
            session("d2", "Codex", "gpt-6-astra", "api-gateway", L.t("Rate limit tests", "요청 제한 테스트"), "working", 31_800_000, account: "demo:codex-a"),
            session("d3", "Claude", "claude-opus-5-5", "docs-site", L.t("Better docs search", "문서 검색 개선"), "working", 12_900_000, account: "demo:claude-b"),
            session("d4", "Codex", "gpt-6.1-sol", "ml-pipeline", L.t("Training data cleanup", "학습 데이터 정리"), "waiting", 9_600_000, account: "demo:codex-b"),
            // An older computer's session: instructions only, no reply reader.
            session("d5", "GLM", "glm-5.3[1m]", "storefront", L.t("Translation review", "번역 검수"), "idle", 4_100_000, account: nil, capabilities: ["focus", "prompt"]),
            // Working, since a request is only answered by a working session (contract v1.1.0).
            session("d6", "Claude", "claude-sonnet-5-5", "mobile-app", L.t("Notification settings", "알림 설정 화면"), "working", 2_700_000, account: "demo:claude-a"),
            session("d7", "Codex", "gpt-6-astra", "infra", L.t("Deploy script", "배포 스크립트"), "paused", 1_200_000, account: "demo:codex-a"),
            session("d8", "Claude", "claude-opus-5-5", "design-system", L.t("Design token cleanup", "토큰 정리"), "idle", 0, account: "demo:claude-b"),
        ]
        let mini = [
            session("m1", "Codex", "gpt-6.1-sol", "data-sync", L.t("Nightly sync", "야간 동기화"), "working", 8_400_000, account: "demo:codex-b"),
            session("m2", "Claude", "claude-sonnet-5-5", "billing", L.t("Invoice template", "청구서 템플릿"), "idle", 1_900_000, account: "demo:claude-a"),
        ]
        let claudeA = Quota(id: "demo:claude-a", kind: "Claude", accountLabel: "Claude · 4f21a8", plan: "max", updated: now - 40, stale: false, note: nil, status: nil,
                            windows: [QuotaWindow(key: "5h", label: "5H", pct: 38, reset: now + 9_400), QuotaWindow(key: "7d", label: "주간", pct: 27, reset: now + 290_000)],
                            weekly: weekly(4.2), usagePoints: points(from: 21.5, to: 27, reset: now + 290_000, now: now))
        let claudeB = Quota(id: "demo:claude-b", kind: "Claude", accountLabel: "Claude · b7e3c1", plan: "pro", updated: now - 70, stale: false, note: nil, status: nil,
                            windows: [QuotaWindow(key: "5h", label: "5H", pct: 12, reset: now + 14_200), QuotaWindow(key: "7d", label: "주간", pct: 46, reset: now + 350_000)],
                            weekly: weekly(1.4), usagePoints: points(from: 43, to: 46, reset: now + 350_000, now: now), alias: "Team")
        let codexA = Quota(id: "demo:codex-a", kind: "Codex", accountLabel: "Codex · 9c03e2", plan: "pro", updated: now - 55, stale: false, note: nil, status: nil,
                           windows: [QuotaWindow(key: "7d", label: "주간", pct: 23, reset: now + 410_000)],
                           weekly: weekly(2.1), usagePoints: points(from: 19.5, to: 23, reset: now + 410_000, now: now))
        // A limit the computer could not refresh: it shows how old it is instead of a rate.
        let codexB = Quota(id: "demo:codex-b", kind: "Codex", accountLabel: "Codex · 2d5f90", plan: "plus", updated: now - 38 * 60, stale: true, note: nil, status: nil,
                           windows: [QuotaWindow(key: "7d", label: "주간", pct: 64, reset: now + 220_000)],
                           weekly: weekly(0.9), usagePoints: points(from: 61, to: 64, reset: now + 220_000, now: now))
        func flow(_ claudeRate: Double, _ codexRate: Double) -> [String: FlowSeries] {
            var flow: [String: FlowSeries] = [:]
            for period in Period.allCases {
                let step: Double = period.seconds <= 3600 ? 60 : period.seconds <= 18000 ? 300 : 900
                let count = Int(period.seconds / step)
                flow[period.rawValue] = FlowSeries(step: step, start: now - period.seconds, end: now, reported: true, bins: (0..<count).map { i in
                    let wave: Double = 0.55 + 0.45 * sin(Double(i) / 4.3) * cos(Double(i) / 11.0)
                    let busy: Double = i % 17 < 3 ? 0.25 : 1, scale: Double = step / 60
                    let claude: Double = claudeRate * scale * max(0.05, wave) * busy, codex: Double = codexRate * scale * max(0.05, 1 - wave * 0.6)
                    return ["Claude": claude, "Codex": codex]
                })
            }
            return flow
        }
        let operations = Operations(updated: now - 30, installedSkills: 18, observedEvents: 7, loopState: "not_verified",
                                    goals: [.init(runtime: "Codex", status: "active", tokensUsed: 1_240_000, timeUsedSeconds: 5_400, sessionConnected: true)])
        let studioSnapshot = DeviceSnapshot(version: "4.0.0", updated: now, sessions: studio,
                                            host: Host(cpu: 31.5, usedMemory: 61.4e9, totalMemory: 128e9, cores: 16), accountQuotas: [claudeA, claudeB, codexA],
                                            periods: nil, flow: flow(1_150_000, 520_000), operations: operations)
        let miniSnapshot = DeviceSnapshot(version: "4.0.0", updated: now - 3, sessions: mini,
                                          host: Host(cpu: 12.2, usedMemory: 9.8e9, totalMemory: 24e9, cores: 10), accountQuotas: [codexB, claudeA],
                                          periods: nil, flow: flow(40_000, 120_000), operations: Operations(installedSkills: 6, observedEvents: 2, goals: []))
        let received = now * 1000
        return [Device(id: "demo-mac", name: L.t("Demo Mac Studio", "데모 Mac Studio"), platform: "macOS", online: true, received: received - 2_000, snapshot: studioSnapshot),
                Device(id: "demo-mini", name: L.t("Demo Mac mini", "데모 Mac mini"), platform: "macOS", online: true, received: received - 4_000, snapshot: miniSnapshot)]
    }

    /// A conversation that shows every delivery state once, a reply, and photos the computer
    /// listed by name (the relay returns no image data).
    static func mailboxes(now: Double) -> [String: AppModel.Mailbox] {
        func message(_ n: Int, _ text: String, _ status: String, ago: Double, reply: String? = nil, photos: [String] = [], activity: String? = nil) -> MailMessage {
            MailMessage(id: String(format: "00000000-0000-4000-8000-%012d", n), text: text, created: now - ago, status: status, reply: reply,
                        replyAt: reply == nil ? nil : now - ago + 60, truncated: false,
                        attachments: photos.isEmpty ? nil : photos.map { MailAttachment(id: $0, name: $0, mime: "image/jpeg", bytes: 180_000) },
                        activity: activity.map { MailActivity(phase: $0, observedAt: now - 3) })
        }
        return ["demo-mac:d1": .init(messages: [
            message(1, L.t("How far along are you?", "지금 어디까지 진행됐어?"), "replied", ago: 1500,
                    reply: L.t("I moved the card entry step of checkout to the new component. The receipt screen and two tests are left.",
                               "결제 화면의 카드 입력 단계를 새 컴포넌트로 옮겼고, 남은 작업은 영수증 화면과 테스트 두 개입니다.")),
            message(2, L.t("The buttons look misaligned on these two screens. Please check.", "이 두 화면에서 버튼 정렬이 어긋나 보여. 확인해 줘."), "replied", ago: 1200,
                    reply: L.t("I checked both photos. The pay button's bottom margin was 8 pt off, so I matched it.",
                               "두 사진 모두 확인했습니다. 결제 버튼의 아래 여백이 8pt 달라서 맞췄습니다."), photos: ["IMG_0412.jpg", "IMG_0413.jpg"]),
            message(3, L.t("Match the receipt screen to the same rules.", "영수증 화면도 같은 기준으로 맞춰 줘."), "awaiting_reply", ago: 900, activity: "writing"),
            message(4, L.t("Let me know when the tests finish.", "테스트가 끝나면 알려 줘."), "queued", ago: 600),
            message(5, L.t("Where is the log file?", "로그 파일 경로를 알려 줘."), "delivery_unconfirmed", ago: 420),
            message(6, L.t("Compare it with the previous branch too.", "이전 브랜치 결과도 비교해 줘."), "source_changed", ago: 300),
            message(7, L.t("Also do the cleanup I asked for yesterday.", "어제 요청한 정리도 해 줘."), "not_delivered", ago: 200),
            message(8, L.t("Sum up the current screen in one line.", "지금 화면을 한 줄로 요약해 줘."), "sending", ago: 5),
        ]),
        // The other two response phases, one session each.
        "demo-mac:d3": .init(messages: [message(10, L.t("Change how search results are sorted.", "검색 결과 정렬 기준을 바꿔 줘."), "awaiting_reply", ago: 120, activity: "working")]),
        "demo-mac:d6": .init(messages: [message(11, L.t("Polish the notification copy.", "알림 문구를 다듬어 줘."), "awaiting_reply", ago: 20, activity: "responding")]),
        // Awaiting a reply with no reported activity: nothing claims the request is being answered.
        "demo-mac:d4": .init(messages: [message(9, L.t("What rules do you use to clean the data?", "데이터 정리 기준을 알려 줘."), "awaiting_reply", ago: 240)])]
    }

    private static func weekly(_ perHour: Double) -> [String: WeeklyPeriod] {
        Dictionary(uniqueKeysWithValues: Period.allCases.map { ($0.rawValue, WeeklyPeriod(usedPp: perHour * $0.seconds / 3600, observedSeconds: $0.seconds, partial: false)) })
    }
    private static func points(from: Double, to: Double, reset: Double, now: Double) -> [[Double]] {
        (0..<24).map { i -> [Double] in
            let t: Double = now - Double(23 - i) * 3600
            let step: Double = (to - from) * Double(i) / 23
            let bump: Double = i % 5 == 0 ? 0.4 : 0
            return [t, from + step + bump, reset]
        }
    }
}
