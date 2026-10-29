import Foundation

/// Two made-up computers for trying the app without an account. No real projects or accounts.
/// The Android app's demo (mobile/src/demo.ts) carries the same computers, sessions, accounts and
/// conversation, so both phones show the same thing. Names follow the chosen language.
enum DemoData {
    static let controls = ["focus", "pause", "resume", "terminate", "prompt", "message", "mailbox", "message_images"]
    /// The demo Mac mini is paired without remote control, so its sessions show usage only.
    static let controlOff: Set<String> = ["demo-mini"]
    /// Message 2 of the first conversation carries two photos; the demo shows them as sent pictures.
    static let photoMessage = "00000000-0000-4000-8000-000000000002"
    /// When this demo began: the hours around it never rest, and sessions stopped before it stay stopped.
    static let anchor = Date().timeIntervalSince1970

    /// Two accounts per tool, as on Android (mobile/src/demo.ts) and the web demo. per: weekly percent per
    /// token, set once from a typical week of this demo, so a limit is the tokens of its weekly window times
    /// per and moves with the work. reset: seconds after the demo began (the window began 7 days before).
    /// five: the 5-hour window's reset and its percent per weekly percent. ago: how old the report is;
    /// stale: the computer could not refresh it.
    struct Account {
        let id: String, kind: String, label: String, plan: String, per: Double, reset: Double, five: (reset: Double, factor: Double)?, ago: Double
        var stale = false, alias: String? = nil
    }
    static let accounts: [Account] = [
        Account(id: "demo:claude-a", kind: "Claude", label: "Claude · 4f21a8", plan: "max", per: 9.4e-9, reset: 276_000, five: (9_400, 6), ago: 40),
        Account(id: "demo:claude-b", kind: "Claude", label: "Claude · b7e3c1", plan: "pro", per: 5.4e-8, reset: 290_000, five: (14_200, 6), ago: 70, alias: "Team"),
        Account(id: "demo:codex-a", kind: "Codex", label: "Codex · 9c03e2", plan: "pro", per: 2.4e-8, reset: 250_000, five: nil, ago: 55),
        // A limit the computer could not refresh: it shows how old it is instead of a rate.
        Account(id: "demo:codex-b", kind: "Codex", label: "Codex · 2d5f90", plan: "plus", per: 2e-7, reset: 337_000, five: nil, ago: 38 * 60, stale: true),
    ]
    static func account(_ id: String?) -> Account? { accounts.first { $0.id == id } }

    /// One demo session. weight is its usual share of its computer; mobile/src/demo.ts lists the same rows.
    struct Row {
        let id: String, kind: String, model: String, project: String, en: String, ko: String, status: String, weight: Double, account: String?
        var capabilities: [String]
        init(_ id: String, _ kind: String, _ model: String, _ project: String, _ en: String, _ ko: String, _ status: String, _ weight: Double, _ account: String?,
             capabilities: [String] = DemoData.controls) {
            self.id = id; self.kind = kind; self.model = model; self.project = project; self.en = en; self.ko = ko
            self.status = status; self.weight = weight; self.account = account; self.capabilities = capabilities
        }
    }
    // Two accounts per tool, numbered 1 and 2 the way the desktop dashboard numbers them; one has a
    // name given in the desktop app.
    static let rows: [Row] = [
        Row("d1", "Claude", "claude-opus-5-5", "storefront", "Checkout redesign", "결제 화면 개편", "working", 52, "demo:claude-a"),
        Row("d2", "Codex", "gpt-6-astra", "api-gateway", "Rate limit tests", "요청 제한 테스트", "working", 12, "demo:codex-a"),
        Row("d3", "Claude", "claude-opus-5-5", "docs-site", "Better docs search", "문서 검색 개선", "working", 13, "demo:claude-b"),
        Row("d4", "Codex", "gpt-6.1-sol", "ml-pipeline", "Training data cleanup", "학습 데이터 정리", "waiting", 4, "demo:codex-b"),
        // An older computer's session: instructions only, no reply reader.
        Row("d5", "GLM", "glm-5.3[1m]", "storefront", "Translation review", "번역 검수", "idle", 3, nil, capabilities: ["focus", "prompt"]),
        // Working, since a request is only answered by a working session (contract v1.1.0).
        Row("d6", "Claude", "claude-sonnet-5-5", "mobile-app", "Notification settings", "알림 설정 화면", "working", 6, "demo:claude-a"),
        Row("d7", "Codex", "gpt-6-astra", "infra", "Deploy script", "배포 스크립트", "paused", 2, "demo:codex-a"),
        Row("d8", "Claude", "claude-opus-5-5", "design-system", "Design token cleanup", "토큰 정리", "idle", 0, "demo:claude-b"),
        Row("m1", "Codex", "gpt-6.1-sol", "data-sync", "Nightly sync", "야간 동기화", "working", 8, "demo:codex-b"),
        Row("m2", "Claude", "claude-sonnet-5-5", "billing", "Invoice template", "청구서 템플릿", "idle", 3, "demo:claude-a"),
    ]
    /// The demo computers: id, rows by id prefix, hash seed, the median tokens of an active minute and how
    /// often the computer works next to the main one.
    struct Computer { let id: String, prefix: String, seed: UInt32, scale: Double, duty: Double }
    static let computers = [Computer(id: "demo-mac", prefix: "d", seed: 23, scale: 1.2e6, duty: 1), Computer(id: "demo-mini", prefix: "m", seed: 61, scale: 0.25e6, duty: 0.3)]
    /// One person's computers rest together.
    static let restSeed: UInt32 = 7

    /// When a session takes part in its computer's work: working ones all along, the others until a
    /// while before the demo began (DemoUsage shapes the minutes).
    static func stream(_ status: String, _ weight: Double, _ index: Int, anchor: Double) -> DemoUsage.Stream {
        let start = index % 4 == 3 ? anchor - Double(5 + index % 7) * 3600 : anchor - 30 * 3600
        let stop = status == "waiting" ? anchor - Double(2 + index % 4) * 60 : status == "paused" ? anchor - 12 * 60
            : status == "idle" ? anchor - Double(40 + index * 37 % 180) * 60 : Double.infinity
        return .init(weight: weight, start: start, stop: stop)
    }

    /// One computer's minutes. owners: the account of each stream (the shown sessions, then the earlier
    /// ones); week: each stream's tokens from its account's weekly window start until the demo began.
    struct Machine { let computer: Computer; let rows: [(row: Row, index: Int)]; let now: DemoUsage.Usage; let before: DemoUsage.Usage; let owners: [String?]; let week: [Double] }
    /// What stays fixed while one demo runs: the day before it began and each weekly window then.
    nonisolated(unsafe) private static var fixed: [String: (before: DemoUsage.Usage, week: [Double])] = [:]

    static func devices(now: Double, anchor: Double = DemoData.anchor) -> [Device] {
        let machines = computers.map { c -> Machine in
            let mine = rows.enumerated().filter { $0.element.id.hasPrefix(c.prefix) }.map { (row: $0.element, index: $0.offset) }
            // Earlier sessions of each account on this computer, closed before the shown ones began: they
            // fill the weekly window and never show in the last day.
            var ids: [String] = []
            for pair in mine { if let a = pair.row.account, !ids.contains(a) { ids.append(a) } }
            let earlier = ids.map { id in (id: id, weight: mine.reduce(0) { $0 + ($1.row.account == id ? $1.row.weight : 0) }) }
            let streams = mine.map { stream($0.row.status, $0.row.weight, $0.index, anchor: anchor) }
                + earlier.map { DemoUsage.Stream(weight: $0.weight, start: anchor - 8 * 86400, stop: anchor - 30 * 3600) }
            let owners = mine.map(\.row.account) + earlier.map { Optional($0.id) }
            let key = c.id + ":" + String(anchor)
            if fixed[key] == nil {
                // Tokens from a day before the demo began until it began, so totals only grow; and each
                // stream's tokens from its account's weekly window start until the demo began.
                let long = DemoUsage.usage(c.seed, c.scale, streams, now: anchor, anchor: anchor, rest: restSeed, duty: c.duty, span: 8 * 1440 + 15)
                fixed[key] = (DemoUsage.usage(c.seed, c.scale, streams, now: anchor, anchor: anchor, rest: restSeed, duty: c.duty),
                              owners.enumerated().map { j, id in account(id).map { DemoUsage.since(long, j, anchor + $0.reset - 604_800) } ?? 0 })
            }
            return Machine(computer: c, rows: mine, now: DemoUsage.usage(c.seed, c.scale, streams, now: now, anchor: anchor, rest: restSeed, duty: c.duty),
                           before: fixed[key]!.before, owners: owners, week: fixed[key]!.week)
        }
        let sessions = machines.map { m in
            m.rows.enumerated().map { j, pair -> Session in
                let row = pair.row, u = m.now
                var windows: [String: [Double]?] = [:]
                for p in Period.allCases { windows[p.rawValue] = DemoUsage.vector(DemoUsage.since(u, j, now - p.seconds)) }
                let per = account(row.account)?.per ?? 0, lastMinute = u.minutes[j][u.minutes[j].count - 2]
                let estimates = row.account.map { account in
                    Dictionary(uniqueKeysWithValues: Period.allCases.map { p in
                        (p.rawValue, WeeklyEstimate(usedPp: (windows[p.rawValue] ?? nil).map { $0.reduce(0, +) * per }, partial: false, accountId: account,
                                                    calibration: .init(ppPerToken: per, confidence: "stable")))
                    })
                }
                return Session(id: row.id, controlKey: "demo", kind: row.kind, app: row.kind == "Codex" ? "Orca" : "Terminal", terminal: L.t(row.en, row.ko),
                               project: row.project, title: nil, model: row.model, status: row.status,
                               tokens: DemoUsage.vector(row.weight * 4e7 + DemoUsage.since(m.before, j, anchor - 86400) + DemoUsage.since(u, j, anchor)),
                               rate: row.status == "working" ? DemoUsage.since(u, j, now - 600) / 600 : 0, windows: windows,
                               cpu: row.status == "working" ? ((1.5 + min(30, lastMinute / 4e4)) * 10).rounded() / 10 : 0.3, rss: 410,
                               capabilities: row.capabilities, weeklyAccount: row.account, weeklyEstimate: estimates)
            }
        }
        // An account's tokens since a moment over both computers, and its weekly percent: the tokens of its
        // weekly window (before the demo began, then since) times its per-token percent.
        func used(_ id: String, _ from: Double) -> Double {
            machines.reduce(0) { n, m in n + m.owners.enumerated().reduce(0) { k, e in k + (e.element == id ? DemoUsage.since(m.now, e.offset, from) : 0) } }
        }
        func weekly(_ a: Account) -> Double {
            (machines.reduce(0) { n, m in n + m.owners.enumerated().reduce(0) { k, e in k + (e.element == a.id ? m.week[e.offset] : 0) } } + used(a.id, anchor)) * a.per
        }
        func round(_ n: Double) -> Double { (n * 10).rounded() / 10 }
        func quota(_ a: Account) -> Quota {
            let exact = weekly(a), reset = anchor + a.reset
            var windows: [QuotaWindow] = []
            if let five = a.five {
                windows.append(QuotaWindow(key: "5h", label: "5H", pct: min(100, round(used(a.id, anchor + five.reset - 18_000) * a.per * five.factor)), reset: anchor + five.reset))
            }
            windows.append(QuotaWindow(key: "7d", label: "주간", pct: round(exact), reset: reset))
            let periods = Dictionary(uniqueKeysWithValues: Period.allCases.map { p in
                (p.rawValue, WeeklyPeriod(usedPp: used(a.id, now - p.seconds) * a.per, observedSeconds: p.seconds, partial: false))
            })
            let points = (0..<145).map { i -> [Double] in
                let at = now - 86400 + Double(i) * 600
                return [at, max(0, round(exact - used(a.id, at) * a.per)), reset]
            }
            return Quota(id: a.id, kind: a.kind, accountLabel: a.label, plan: a.plan, updated: now - a.ago, stale: a.stale, note: nil, status: nil,
                         windows: windows, weekly: periods, usagePoints: points, alias: a.alias)
        }
        let quotas = accounts.map(quota)
        let (claudeA, claudeB, codexA, codexB) = (quotas[0], quotas[1], quotas[2], quotas[3])
        func flow(_ m: Machine) -> [String: FlowSeries] {
            var flow: [String: FlowSeries] = [:]
            for p in Period.allCases {
                let step: Double = p.seconds <= 3600 ? 60 : p.seconds <= 18000 ? 300 : 900
                let b = DemoUsage.bins(m.now, m.rows.map { $0.row.kind }, now: now, seconds: p.seconds, step: step)
                flow[p.rawValue] = FlowSeries(step: step, start: b.start, end: b.end, reported: true, bins: b.bins.map { $0 })
            }
            return flow
        }
        // The host is as busy as its last minute of tokens.
        func busy(_ m: Machine) -> Double { min(1, m.now.minutes.reduce(0) { $0 + $1[$1.count - 2] } / (m.computer.scale * 3)) }
        let operations = Operations(updated: now - 30, installedSkills: 18, observedEvents: 7, loopState: "not_verified",
                                    goals: [.init(runtime: "Codex", status: "active", tokensUsed: 1_240_000, timeUsedSeconds: 5_400, sessionConnected: true)])
        let studioSnapshot = DeviceSnapshot(version: "4.0.0", updated: now, sessions: sessions[0],
                                            host: Host(cpu: ((8 + 48 * busy(machines[0])) * 10).rounded() / 10, usedMemory: 61.4e9, totalMemory: 128e9, cores: 16),
                                            accountQuotas: [claudeA, claudeB, codexA], periods: nil, flow: flow(machines[0]), operations: operations)
        let miniSnapshot = DeviceSnapshot(version: "4.0.0", updated: now - 3, sessions: sessions[1],
                                          host: Host(cpu: ((4 + 48 * busy(machines[1])) * 10).rounded() / 10, usedMemory: 9.8e9, totalMemory: 24e9, cores: 10),
                                          accountQuotas: [codexB, claudeA], periods: nil, flow: flow(machines[1]),
                                          operations: Operations(installedSkills: 6, observedEvents: 2, goals: []))
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
}
