import Foundation

/// The demo for trying the app without an account: the one demo world (DemoWorld.swift, written from
/// site/src/demo-world.js) as the web demo (site/src/remote-demo.js) and Android (mobile/src/demo.ts) show
/// it, with the same computers, sessions, accounts and numbers. The steps are site/src/demo-model.js's in
/// the same order; DemoWorldTests checks the numbers against the web model's. Nothing here is real.
enum DemoData {
    /// The Mac mini is paired without remote control, so its sessions show usage only.
    static let controlOff = Set(DemoWorld.computers.filter { !$0.control }.map(\.id))
    /// Message 2 of the first conversation carries two photos; the demo shows them as sent pictures.
    static let photoMessage = "00000000-0000-4000-8000-000000000002"
    /// QA and filming (-qaDemoNow <unix seconds>): hold the demo at one moment, the same moment the web page
    /// (/app?demo&demoNow=…), the desktop demo collector and Android (onetop://?qaDemoNow=…) take.
    static let held: Double? = { let at = UserDefaults.standard.double(forKey: "qaDemoNow"); return at > 0 ? at : nil }()
    /// When this demo began: the hours around it never rest, and sessions stopped before it stay stopped.
    static let anchor = held ?? Date().timeIntervalSince1970
    static func now() -> Double { held ?? Date().timeIntervalSince1970 }
    /// Whether the demo is on screen; only then does a hold change what the screens show.
    nonisolated(unsafe) static var onScreen = false
    /// What the screens take as now ("updated … ago", resets, today's times): the phone's clock, or the held
    /// moment while the demo is on screen. A signed-in connection never holds.
    static func shownNow() -> Double { onScreen ? now() : Date().timeIntervalSince1970 }

    static let day = 86_400.0, week = 7 * 86_400.0, historyDays = 90.0
    /// The shown sessions began this long before the demo; earlier sessions closed then.
    static let started = 30 * 3600.0
    /// Enough minutes for any weekly window (a window begins at most 7 days before its reset).
    static let weekSpan = 8 * 1440 + 15

    /// One stream of a computer's work: a shown session, a subagent under one, or an earlier session.
    struct Part {
        var id: String, kind: String, project: String, model: String?, account: String?, weight: Double, status: String?
        var start: Double, stop: Double, row: Int?
        var child: (lead: String, name: String, status: String)?
        var earlier = false
    }

    /// A computer's streams: its shown sessions in world order, their subagents, then its earlier sessions.
    static func streams(_ c: Int, anchor: Double) -> [Part] {
        var out: [Part] = []
        for (i, s) in DemoWorld.sessions.enumerated() where s.computer == c {
            let stop = s.status == "waiting" ? anchor - Double(3 + i) * 60 : s.status == "paused" ? anchor - 12 * 60
                : s.status == "idle" ? anchor - Double(40 + i * 31) * 60 : Double.infinity
            out.append(Part(id: s.id, kind: s.kind, project: s.project, model: s.model, account: s.account, weight: s.weight, status: s.status,
                            start: anchor - started, stop: stop, row: i))
        }
        for child in DemoWorld.children {
            guard var part = out.first(where: { $0.id == child.lead }) else { continue }
            let stop = child.status == "working" ? part.stop : min(part.stop, anchor - 25 * 60)
            part.id = child.lead + "-" + child.name; part.weight *= child.share; part.status = child.status; part.stop = stop
            part.child = (child.lead, child.name, child.status)
            out.append(part)
        }
        for (i, e) in DemoWorld.earlier.enumerated() where e.computer == c {
            out.append(Part(id: "earlier-\(i)", kind: e.kind, project: e.project, model: e.model, account: e.account, weight: e.weight, status: nil,
                            start: anchor - historyDays * day, stop: anchor - started, row: nil, earlier: true))
        }
        return out
    }

    /// A computer's minutes from span minutes before now, with sums over any stretch: sum(j, from, to).
    struct Machine {
        let c: Int, list: [Part], u: DemoUsage.Usage, n: Int
        /// Each stream's tokens from the first minute up to each minute, as the web model adds them up.
        let cum: [[Double]]
        func at(_ t: Double) -> Int { min(n, max(0, Int(ceil(t / 60)) - u.first)) }
        func sum(_ j: Int, _ from: Double, _ to: Double = .infinity) -> Double {
            let a = at(from), b = to == .infinity ? n : at(to)
            return b > a ? cum[j][b] - cum[j][a] : 0
        }
    }

    static func machine(_ c: Int, now: Double, anchor: Double, span: Int = weekSpan) -> Machine {
        let computer = DemoWorld.computers[c], list = streams(c, anchor: anchor)
        let u = DemoUsage.usage(computer.seed, computer.scale, list.map { .init(weight: $0.weight, start: $0.start, stop: $0.stop) },
                                now: now, anchor: anchor, rest: DemoWorld.rest, duty: computer.duty, awake: true, span: span)
        let n = u.minutes[0].count
        let cum = u.minutes.map { row -> [Double] in
            var s = [Double](repeating: 0, count: n + 1)
            for i in 0..<n { s[i + 1] = s[i] + row[i] }
            return s
        }
        return Machine(c: c, list: list, u: u, n: n, cum: cum)
    }

    static func machines(now: Double, anchor: Double) -> [Machine] {
        DemoWorld.computers.indices.map { machine($0, now: now, anchor: anchor) }
    }

    /// A session's numbers: tokens over each period, its recent rate and its total since a day before the demo.
    /// A subagent's total starts where its lead's does, as the desktop demo collector counts it.
    static func sessionNumbers(_ m: Machine, _ j: Int, now: Double, anchor: Double) -> (windows: [String: [Double]?], rate: Double, tokens: [Double]) {
        var windows: [String: [Double]?] = [:]
        for p in Period.allCases { windows[p.rawValue] = DemoUsage.vector(m.sum(j, now - p.seconds)) }
        let s = m.list[j], base = s.child.flatMap { child in m.list.first { $0.id == child.lead }?.weight } ?? s.weight
        return (windows, (m.sum(j, now - 600) / 600).rounded(), DemoUsage.vector(base * 5e7 + m.sum(j, anchor - day)))
    }

    /// Each account's limits over every computer it works on. Providers report limits in whole percent.
    struct Limits {
        let account: DemoWorld.Account, resetAt: Double, start: Double, reportAt: Double, weekly: Double, five: Double?, fiveReset: Double?
        let used: (Double, Double) -> Double
    }
    static func accounts(_ all: [Machine], now: Double, anchor: Double) -> [Limits] {
        func used(_ key: String, _ from: Double, _ to: Double) -> Double {
            all.reduce(0) { n, m in n + m.list.indices.reduce(0) { k, j in k + (m.list[j].account == key ? m.sum(j, from, to) : 0) } }
        }
        return DemoWorld.accounts.map { a in
            let reset = anchor + a.reset, start = reset - week, reportAt = a.stale.map { now - $0 } ?? now
            return Limits(account: a, resetAt: reset, start: start, reportAt: reportAt, weekly: (used(a.key, start, reportAt) * a.per).rounded(),
                          five: a.five.map { min(100, (used(a.key, anchor + $0.reset - 5 * 3600, reportAt) * a.per * $0.factor).rounded()) },
                          fiveReset: a.five.map { anchor + $0.reset }, used: { used(a.key, $0, $1) })
        }
    }

    static func devices(now: Double = DemoData.now(), anchor: Double = DemoData.anchor) -> [Device] {
        let all = machines(now: now, anchor: anchor), limits = accounts(all, now: now, anchor: anchor)
        func limit(_ key: String?) -> Limits? { limits.first { $0.account.key == key } }
        func round4(_ n: Double) -> Double { (n * 1e4).rounded() / 1e4 }
        return all.map { m in
            let computer = DemoWorld.computers[m.c], rows = DemoWorld.sessions.filter { $0.computer == m.c }
            let sessions = m.list.indices.compactMap { j -> Session? in
                let s = m.list[j]
                if s.earlier { return nil }
                let row = rows.first { $0.id == (s.child?.lead ?? s.id) }!, i = DemoWorld.sessions.firstIndex { $0.id == row.id }!
                let status = s.child?.status ?? row.status, numbers = row.weight > 0 ? sessionNumbers(m, j, now: now, anchor: anchor) : nil
                let a = limit(s.account), minutes = m.u.minutes[j]
                let cpu = status == "working" ? ((1.5 + min(30, minutes[minutes.count - 2] / 4e4) + Double(i % 5) * 0.7) * 10).rounded() / 10
                    : status == "unknown" ? 0.6 : 0.3
                let estimates = a.flatMap { a in numbers.map { n in
                    Dictionary(uniqueKeysWithValues: Period.allCases.map { p in
                        (p.rawValue, WeeklyEstimate(usedPp: round4(((n.windows[p.rawValue] ?? nil) ?? []).reduce(0, +) * a.account.per), partial: false,
                                                    accountId: a.account.id, calibration: .init(ppPerToken: a.account.per, confidence: "limited")))
                    })
                } }
                return Session(id: s.id, controlKey: s.child == nil ? "demo-\(i)" : "", kind: row.kind, app: row.app, terminal: s.child == nil ? row.title : "",
                               project: row.project, title: row.project + " · " + row.kind, model: row.model ?? "", status: status,
                               tokens: numbers?.tokens, rate: numbers.map { status == "working" ? $0.rate : 0 }, windows: numbers?.windows ?? [:],
                               cpu: s.child == nil ? cpu : nil, rss: s.child == nil ? Double(160 + i * 24) * 1_048_576 : nil,
                               capabilities: s.child == nil ? row.caps : [], weeklyAccount: estimates == nil ? nil : a?.account.id, weeklyEstimate: estimates,
                               rootSessionId: s.child?.lead ?? s.id, parentSessionId: s.child?.lead)
            }
            let used = Set(rows.compactMap(\.account))
            // The relay names an account by its tool and the end of its id; providers report limits in whole percent.
            let quotas = limits.filter { used.contains($0.account.key) }.map { l -> Quota in
                let a = l.account
                var windows: [QuotaWindow] = []
                if let five = l.five { windows.append(QuotaWindow(key: "5h", label: "5H", pct: five, reset: l.fiveReset)) }
                windows.append(QuotaWindow(key: "7d", label: "주간", pct: l.weekly, reset: l.resetAt))
                let periods = Dictionary(uniqueKeysWithValues: Period.allCases.map { p in
                    (p.rawValue, WeeklyPeriod(usedPp: round4(l.used(now - p.seconds, .infinity) * a.per), observedSeconds: p.seconds, partial: false))
                })
                let points = stride(from: l.start, through: l.reportAt, by: 600).map { t in [t, (l.used(l.start, t) * a.per).rounded(), l.resetAt] }
                return Quota(id: a.id, kind: a.kind, accountLabel: a.kind + " · " + String(a.id.suffix(6)), plan: a.plan, updated: l.reportAt, stale: a.stale != nil,
                             note: nil, status: a.status, windows: windows, weekly: periods, usagePoints: points, alias: a.alias)
            }
            let kinds = m.list.map { $0.weight > 0 ? $0.kind : nil }
            var flow: [String: FlowSeries] = [:]
            for p in Period.allCases {
                let step: Double = p.seconds <= 3600 ? 60 : p.seconds <= 18000 ? 300 : 900
                let b = DemoUsage.bins(m.u, kinds, now: now, seconds: p.seconds, step: step)
                flow[p.rawValue] = FlowSeries(step: step, start: b.start, end: b.end, reported: true, bins: b.bins.map { $0 })
            }
            // The host is as busy as its last whole minute of tokens (the current one is partial).
            let busy = min(1, m.u.minutes.reduce(0) { $0 + $1[$1.count - 2] } / (computer.scale * 3)), ops = DemoWorld.operations[m.c]
            let host = Host(cpu: ((computer.cpu.idle + computer.cpu.busy * busy) * 10).rounded() / 10, usedMemory: (computer.used * 1_073_741_824).rounded(),
                            totalMemory: computer.memory * 1_073_741_824, cores: computer.cores)
            let operations = Operations(installedSkills: Double(ops.installedSkills), observedEvents: Double(ops.observedEvents),
                                        goals: ops.goals.map { .init(runtime: $0.runtime, status: $0.status, tokensUsed: $0.tokensUsed,
                                                                     timeUsedSeconds: $0.timeUsedSeconds, sessionConnected: $0.sessionConnected) })
            return Device(id: computer.id, name: computer.name, platform: computer.platform, online: true, received: now * 1000,
                          snapshot: DeviceSnapshot(version: "4.0.0", updated: now, sessions: sessions, host: host, accountQuotas: quotas, periods: nil,
                                                   flow: flow, operations: operations))
        }
    }

    /// A conversation that shows every delivery state once, a reply, and photos the computer
    /// listed by name (the relay returns no image data); three more sessions show the other response phases.
    static func mailboxes(now: Double = DemoData.now()) -> [String: AppModel.Mailbox] {
        func message(_ n: Int, _ text: String, _ status: String, ago: Double, reply: String? = nil, photos: [String] = [], activity: String? = nil) -> MailMessage {
            MailMessage(id: String(format: "00000000-0000-4000-8000-%012d", n), text: text, created: now - ago, status: status, reply: reply,
                        replyAt: reply == nil ? nil : now - ago + 60, truncated: false,
                        attachments: photos.isEmpty ? nil : photos.map { MailAttachment(id: $0, name: $0, mime: "image/jpeg", bytes: 180_000) },
                        activity: activity.map { MailActivity(phase: $0, observedAt: now - 3) })
        }
        return ["demo-0:s1": .init(messages: [
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
        "demo-0:s3": .init(messages: [message(10, L.t("Change how search results are sorted.", "검색 결과 정렬 기준을 바꿔 줘."), "awaiting_reply", ago: 120, activity: "working")]),
        "demo-0:s5": .init(messages: [message(11, L.t("Polish the notification copy.", "알림 문구를 다듬어 줘."), "awaiting_reply", ago: 20, activity: "responding")]),
        // Awaiting a reply with no reported activity: nothing claims the request is being answered.
        "demo-0:s4": .init(messages: [message(9, L.t("What rules do you use to clean the data?", "데이터 정리 기준을 알려 줘."), "awaiting_reply", ago: 240)])]
    }
}
