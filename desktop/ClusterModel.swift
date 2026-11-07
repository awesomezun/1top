import Foundation

/// The cluster's readings for the menu bar (agent/onetop/dist/cluster.js `readings`): the same numbers from the
/// same /api/state. Token speed is the chosen period's average in tokens an hour on a 100M or 200M scale; burn is
/// %/h of a weekly limit for the session or account picked, else the average of every account with a burn, each
/// account's own on the rim; its range is the hours of work left before the limit runs out. Fuel is each account's
/// limit left; the warning lights, odometer, trip and load follow the dashboard's cluster.
struct ClusterReadings {
    struct Scale: Equatable { var max: Double; var major: Double; var minor: Double }
    struct Range: Equatable {
        enum State: Equatable { case idle, enough, empty }
        var state: State; var at: Double?; var early: Bool
    }
    struct Account: Identifiable {
        var id: String; var kind: String; var label: String; var plan: String?; var alias: String?; var who: String
        var pct: Double?; var left: Double?; var reset: Double?
        var current: Bool; var reconnect: Bool; var burn: Double?; var added: Double?
        var weekly: Bool; var window: String?; var range: Range?
    }
    /// rate is the period's average per hour; full is the dial's full scale (100M, 200M, then round steps), held
    /// while the period stays; instant is the last minute per hour, which only runs the odometer between readings.
    struct Tach { var rate: Double?; var max: Double; var full: Double; var tokens: Double?; var instant: Double?; var climb: Double }
    /// The dials' scales, held while the period (and the burn dial's subject) stay, so a needle never jumps back.
    final class Hold { var period = ""; var full = 0.0; var skey = ""; var smax = 0.0 }
    enum Pick: Equatable { case session(String), account(String) }
    struct Subject {
        enum Kind: String { case all, session, account }
        var type: Kind; var id: String?; var kind: String?; var value: Double?; var account: String?
        var count = 0; var cruise: Double? = nil; var session: DesktopSession? = nil
    }
    struct Mark { var id: String; var kind: String; var value: Double }
    /// Like a car's distance to empty: hours of work at this burn before the weekly limit runs out (early when that
    /// comes before its reset); idle at no burn; reconnect when the account is signed out; unknown without a limit.
    struct Reach {
        enum State: String { case hours, idle, reconnect, unknown }
        var state: State; var hours: Double? = nil; var early = false; var account: String? = nil
    }
    struct Speed {
        var value: Double?; var multi: [Mark]?; var cruise: Double?; var max: Double
        var subject: Subject?; var picked: Bool; var reach: Reach; var account: String?; var session: String?
    }
    struct Row: Identifiable {
        var id: String; var kind: String; var state: String; var tokens: Double; var estimate: Double?
        var burn: Double?; var account: String?; var session: DesktopSession
    }
    struct Tells {
        var kinds: [(kind: String, working: Int)] = []
        var waiting: [String] = [], reconnect: [String] = [], empty: [String] = [], done: [String] = []
        var context: [String] = [], stalled: [String] = []
        var fresh = false
    }
    struct Trip {
        var start: Double; var tokens: Double?; var rate: Double?; var inRange: Bool
        /// Each account's weekly percent used since the start; nil when no report covers it.
        var accounts: [(id: String, used: Double?)] = []
    }
    /// value is the hottest computer's load (the higher of its CPU and memory); cpu and memory are the busiest's.
    struct Heat { var value: Double?; var cpu: Double?; var memory: Double? }

    var period: String
    var tach: Tach
    var speed: Speed
    var accounts: [Account]
    var sessions: [Row]
    var working: Int
    var tells: Tells
    var heat: Heat
    var trip: Trip?

    static let reconnectStates: Set<String> = ["login_required", "login_expired", "credential_store_unavailable", "access_denied"]
    static let kinds = ["Claude", "Codex", "GLM", "Antigravity", "Aside"]
    static let hour = 3600.0, stall = 15 * 60.0, contextFull = 0.9
    static func valid(_ n: Double?) -> Bool { n.map { $0.isFinite && $0 >= 0 } ?? false }

    /// Marks on a 1-2-2.5-5 step so a dial reads four or five numbers: 200 → 50, 100 → 25, 50 → 10, 2 → 0.5.
    static func marks(_ max: Double) -> Scale {
        let p = pow(10, floor(log10(max)))
        let major = [5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1].map { $0 * p }.first { max / $0 >= 4 - 1e-9 } ?? p / 10
        return Scale(max: max, major: major, minor: major / 5)
    }
    /// speed.js niceMax and scaleMax: a 1-2-5 step, and the dashboard dial's resting full scale by period length.
    static func niceMax(_ value: Double) -> Double {
        guard valid(value), value > 0 else { return 1 }
        let power = pow(10, floor(log10(value)))
        return [1.0, 2, 5, 10].map { $0 * power }.first { $0 >= value } ?? 10 * power
    }
    static func scaleMax(_ rate: Double?, seconds: Double?) -> Double {
        let base = !valid(seconds) || seconds! <= 3600 ? 2e8 : seconds! <= 604_800 ? 1e8 : 5e7
        return Swift.max(base, valid(rate) ? niceMax(rate!) : 0)
    }
    /// Range: at the current burn, when the weekly limit runs out and whether that comes before the reset.
    static func range(left: Double?, burn: Double?, reset: Double?, now: Double) -> Range? {
        guard let left, let burn, valid(burn) else { return nil }
        if burn == 0 { return Range(state: .idle, at: nil, early: false) }
        let at = now + left / burn * hour
        if let reset, reset > 0, at >= reset { return Range(state: .enough, at: at, early: false) }
        return Range(state: .empty, at: at, early: (reset ?? 0) > 0)
    }
    /// Cruise: the steady %/h that spends what is left of the weekly limit exactly by its reset.
    static func cruise(_ a: Account?, now: Double) -> Double? {
        guard let a, a.weekly, let left = a.left, let reset = a.reset, reset > now else { return nil }
        return left / ((reset - now) / hour)
    }
    /// weekly.js accountBurn: a current, verified provider report over at least two observed minutes.
    static func accountBurn(_ period: WeeklyUsage.Period?, _ quota: AccountQuota?) -> Double? {
        guard let quota, !quota.stale, quota.identity_verified != false, let period else { return nil }
        return period.burnPerHour
    }
    /// The display state the dashboard gives a row: working while any of its subagents works.
    static func display(_ s: DesktopSession) -> String { (s.children_working ?? 0) > 0 ? "working" : s.state }

    /// A tokens-per-percent measurement, from a session's estimate or its account's own.
    struct Calibration {
        var tokens: Double?; var used_pp: Double?; var seconds: Double?; var source: String?; var kind: String?
        var reset: Double?; var valid_until: Double?; var report_source: String?; var to: Double?
    }
    /// weekly.js historicalCalibration: an earlier Claude report holds until its weekly reset or a day after it.
    static func historical(_ c: Calibration, _ q: AccountQuota, now: Double) -> Bool {
        let reset = q.windows.first { $0.isWeekly }?.reset
        guard q.kind == "Claude", c.kind == "Claude", c.source == "historical_provider_calibration",
              ["claude_statusline", "historical_provider_report"].contains(c.report_source ?? ""), valid(now),
              let to = c.to, valid(to), to > 0, to <= now, let cr = c.reset, valid(cr), cr > now,
              let reset, valid(reset), abs(reset - cr) <= 60, let until = c.valid_until, valid(until), until > now,
              until <= Swift.min(cr, to + 86400) else { return false }
        return true
    }
    /// weekly.js sessionBurn: a session's tokens per second priced by its account's tokens per percent, in %/h.
    static func sessionBurn(account: String?, basis: String?, calibration c: Calibration?, rate: Double?, quota: AccountQuota?, now: Double) -> Double? {
        if rate == 0 { return 0 }
        guard let quota, let c else { return nil }
        let allowed = c.source == "historical_provider_calibration" ? historical(c, quota, now: now) : !quota.stale
        guard allowed, account == quota.id, basis == "calibrated_token_equivalent", let rate, valid(rate),
              let tokens = c.tokens, valid(tokens), tokens > 0, let used = c.used_pp, valid(used), used > 0,
              let seconds = c.seconds, valid(seconds), seconds >= 120 else { return nil }
        let value = rate * (used / tokens) * 3600
        return valid(value) ? value : nil
    }

    init(snapshot: DesktopSnapshot?, sessions: [DesktopSession], period: String, now: Double, pick: Pick? = nil, only: String? = nil,
         trip: Double? = nil, hold: Hold? = nil) {
        self.period = period
        let state = snapshot
        // Token speed: speed.js measure, the period's tokens over its length. Collection running late keeps the last
        // reading (as of the last collection) and lights its warning.
        let window = state?.period_usage?.windows.first { $0.key == period }
        let local: Double? = window.flatMap { w in w.tokens.count == 4 && w.tokens.allSatisfy { Self.valid($0) } ? w.tokens.reduce(0, +) : nil }
        let known = local != nil && (local! > 0 || !(state?.period_usage?.known_kinds.isEmpty ?? true))
        let noError = state != nil && (state?.error ?? "").isEmpty
        let tokens: Double? = known && noError && Self.valid(state?.updated) ? local : nil
        let seconds = window?.seconds
        let rate: Double? = tokens.flatMap { t in Self.valid(seconds) && seconds! > 0 ? t / seconds! * Self.hour : nil }
        // The last minute's tokens per hour from each top-level session's sliding minute, in all and by tool.
        var instant: Double?
        let roots = (state?.root_sessions?.isEmpty == false) ? state!.root_sessions! : (state?.sessions ?? []).filter { $0.is_subagent != true }
        for s in roots {
            guard let v = s.usage?.last_minute else { continue }
            let window = (s.usage?.window_seconds ?? 0) > 0 ? s.usage!.window_seconds! : 60
            instant = (instant ?? 0) + v.reduce(0) { $0 + (Self.valid($1) ? $1 : 0) } * Self.hour / window
        }
        // The dial runs to 100M tokens an hour, to 200M when the use is heavy, and on in round steps past that.
        let r0 = rate ?? 0
        var full = r0 <= 90e6 ? 100e6 : r0 <= 180e6 ? 200e6 : Self.niceMax(r0 * 1.1)
        if let hold {
            if hold.period == period && hold.full > full { full = hold.full }
            hold.period = period; hold.full = full
        }
        tach = Tach(rate: rate, max: Self.scaleMax(rate, seconds: seconds), full: full, tokens: tokens, instant: instant,
                    climb: Self.valid(instant) ? instant! / Self.hour : 0)

        // Each account reads its representative window; only a verified account's weekly window gets a burn, a range
        // and a cruise, all in %/h of the weekly limit.
        let usage = state?.weekly_usage?.accounts ?? []
        let quotas = state?.account_quotas ?? []
        var list = quotas.map { q -> Account in
            let p = usage.first { $0.id == q.id }?.periods[period], week = q.representativeWindow, weekly = week?.isWeekly == true
            let burns = q.burnAllowed, pct = Self.valid(week?.pct) ? week?.pct : nil
            let label = q.account_label, who = label.contains("@") ? String(label.split(separator: "@").first ?? "") : label
            return Account(id: q.id, kind: q.kind, label: label, plan: q.plan.flatMap { $0.isEmpty ? nil : $0 }, alias: q.alias.flatMap { $0.isEmpty ? nil : $0 },
                           who: who, pct: pct, left: pct.map { Swift.max(0, 100 - $0) }, reset: week.flatMap { Self.valid($0.reset) ? $0.reset : nil },
                           current: pct != nil && q.stale == false, reconnect: Self.reconnectStates.contains(q.status ?? ""),
                           burn: burns ? Self.accountBurn(p, q) : nil, added: burns && Self.valid(p?.used_pp) ? p?.used_pp : nil,
                           weekly: weekly, window: weekly ? nil : week?.label, range: nil)
        }
        for i in list.indices { list[i].range = Self.range(left: list[i].left, burn: list[i].burn, reset: list[i].reset, now: now) }
        accounts = list

        // Sessions: each one's tokens in the period and its burn (an estimate's or its account's calibration); a
        // signed-out account's last report still prices the session's tokens.
        func periodTokens(_ s: DesktopSession) -> Double {
            ((s.usage?.windows?[period] ?? nil) ?? []).reduce(0) { $0 + (Self.valid($1) ? $1 : 0) }
        }
        func burn(_ s: DesktopSession) -> Double? {
            let e = s.usage?.weekly_estimate?[period]
            let id = (e?.account_id).flatMap { $0.isEmpty ? nil : $0 } ?? s.usage?.weekly_account
            let q = quotas.first { $0.id == id }
            var account = e?.account_id, basis = e?.basis
            var cal = e?.calibration.map { Calibration(tokens: $0.tokens, used_pp: $0.used_pp, seconds: $0.seconds, source: $0.source, kind: $0.kind,
                                                       reset: $0.reset, valid_until: $0.valid_until, report_source: $0.report_source, to: $0.to) }
            if e == nil, let q, let c = usage.first(where: { $0.id == q.id })?.calibration {
                account = q.id; basis = "calibrated_token_equivalent"
                cal = Calibration(tokens: c.tokens, used_pp: c.used_pp, seconds: c.seconds, source: c.source, kind: c.kind,
                                  reset: c.reset, valid_until: c.valid_until, report_source: c.report_source, to: c.to)
            }
            guard s.tokens != nil else { return nil }
            let b = Self.sessionBurn(account: account, basis: basis, calibration: cal, rate: s.usage?.rate, quota: q, now: now)
            guard b == nil, var q, q.stale else { return b }
            q.stale = false
            return Self.sessionBurn(account: account, basis: basis, calibration: cal, rate: s.usage?.rate, quota: q, now: now)
        }
        let all = sessions.map { (s: $0, state: Self.display($0), tokens: periodTokens($0)) }
        func row(_ r: (s: DesktopSession, state: String, tokens: Double)) -> Row {
            let e = r.s.usage?.weekly_estimate?[period]
            return Row(id: r.s.id, kind: r.s.kind, state: r.state, tokens: r.tokens, estimate: Self.valid(e?.used_pp) ? e?.used_pp : nil,
                       burn: burn(r.s), account: (e?.account_id).flatMap { $0.isEmpty ? nil : $0 } ?? r.s.usage?.weekly_account, session: r.s)
        }
        // Every session: working first, then those waiting for a look, then the rest, each by its tokens in the period
        // and then by its last use. A warning pressed (only: working, waiting or done) shows only its sessions.
        func done(_ r: (s: DesktopSession, state: String, tokens: Double)) -> Bool {
            r.state == "idle" && Self.valid(r.s.last_usage) && r.s.last_usage! > 0 && now - r.s.last_usage! <= 600
        }
        let shown = all.filter { r in
            switch only { case "working": r.state == "working"; case "waiting": r.state == "waiting"; case "done": done(r); default: true }
        }
        let step = { (r: (s: DesktopSession, state: String, tokens: Double)) in r.state == "working" ? 0 : r.state == "waiting" ? 1 : 2 }
        self.sessions = shown.sorted { a, b in
            if step(a) != step(b) { return step(a) < step(b) }
            if a.tokens != b.tokens { return a.tokens > b.tokens }
            return (a.s.last_usage ?? 0) > (b.s.last_usage ?? 0)
        }.map(row)

        // The burn dial reads one subject: the session or account picked; with nothing picked, every account with a
        // burn, their average on the needle and each one's own on the rim.
        var subject: Subject?, multi: [Mark]?
        switch pick {
        case .session(let id)?:
            if let l = all.first(where: { $0.s.id == id }) {
                let r = row(l); subject = Subject(type: .session, id: r.id, kind: r.kind, value: r.burn, account: r.account, session: r.session)
            }
        case .account(let id)?:
            if let a = list.first(where: { $0.id == id }) { subject = Subject(type: .account, id: a.id, kind: a.kind, value: a.burn, account: a.id) }
        case nil: break
        }
        let picked = subject != nil
        if subject == nil {
            let live = list.filter { Self.valid($0.burn) }.sorted { $0.burn! > $1.burn! }
            let cs = live.compactMap { Self.cruise($0, now: now) }.filter { Self.valid($0) }
            if !live.isEmpty {
                subject = Subject(type: .all, id: nil, kind: nil, value: live.reduce(0) { $0 + $1.burn! } / Double(live.count), account: nil,
                                  count: live.count, cruise: cs.isEmpty ? nil : cs.reduce(0, +) / Double(cs.count))
                multi = live.map { Mark(id: $0.id, kind: $0.kind, value: $0.burn!) }
            }
        }
        let value = Self.valid(subject?.value) ? subject?.value : nil
        let target = subject?.type == .all ? subject?.cruise : Self.cruise(list.first { $0.id == subject?.account }, now: now)
        // The scale reaches past the reading, one and a half times the cruise and every rim mark, in 2, 5, 10, 20 steps.
        let top = ([value ?? 0, (target ?? 0) * 1.6] + (multi ?? []).map(\.value)).max() ?? 0
        var smax = Swift.max(2, Self.niceMax(top))
        let skey = period + "|" + (subject?.type.rawValue ?? "") + "|" + (subject?.id ?? "")
        if let hold {
            if hold.skey == skey && hold.smax > smax { smax = hold.smax }
            hold.skey = skey; hold.smax = smax
        }
        var reach = Reach(state: .unknown)
        if subject?.type == .all {
            let ends = list.filter { Self.valid($0.burn) && $0.burn! > 0 && $0.left != nil }.map { (a: $0, h: $0.left! / $0.burn!) }.sorted { $0.h < $1.h }
            if let first = ends.first {
                reach = Reach(state: .hours, hours: first.h, early: (first.a.reset ?? 0) > 0 && now + first.h * Self.hour < first.a.reset!, account: first.a.id)
            } else { reach = Reach(state: .idle) }
        } else if let subject {
            if let a = list.first(where: { $0.id == subject.account }) {
                if a.reconnect { reach = Reach(state: .reconnect, account: a.id) }
                else if let left = a.left, let value {
                    if value == 0 { reach = Reach(state: .idle) }
                    else { reach = Reach(state: .hours, hours: left / value, early: (a.reset ?? 0) > 0 && now + left / value * Self.hour < a.reset!, account: a.id) }
                }
            }
        }
        speed = Speed(value: value, multi: multi, cruise: target, max: smax, subject: subject, picked: picked, reach: reach,
                      account: subject?.type == .account ? subject?.id : nil, session: subject?.type == .session ? subject?.id : nil)

        // Tell-tales: tools with working sessions, sessions waiting for a look or just done, accounts to sign in again
        // or running out before the reset, and whether the readings are live.
        var tells = Tells(), working: [String: Int] = [:]
        for r in all {
            if r.state == "working" { working[r.s.kind, default: 0] += 1 }
            if r.state == "waiting" { tells.waiting.append(r.s.id) }
            if done(r) { tells.done.append(r.s.id) }
            if let c = r.s.context_usage, Self.valid(c.input_tokens), Self.valid(c.capacity), c.capacity! > 0,
               c.input_tokens! / c.capacity! >= Self.contextFull { tells.context.append(r.s.id) }
            if r.state == "working", let last = r.s.last_usage, Self.valid(last), last > 0, now - last > Self.stall { tells.stalled.append(r.s.id) }
        }
        let rank = { (k: String) in Self.kinds.firstIndex(of: k) ?? Self.kinds.count }
        tells.kinds = working.keys.sorted { rank($0) != rank($1) ? rank($0) < rank($1) : $0 < $1 }.map { ($0, working[$0]!) }
        tells.reconnect = list.filter(\.reconnect).map(\.id)
        tells.empty = list.filter { $0.range?.early == true }.map(\.id)
        tells.fresh = noError && Self.valid(state?.updated) && now - (state?.updated ?? 0) <= 20
        self.tells = tells
        self.working = all.filter { $0.state == "working" }.count

        // Load: each computer's is the higher of its CPU and memory use; CPU and memory each read the busiest computer.
        var computers: [(cpu: Double?, memory: Double?)] = []
        if let list = state?.system?.computers, !list.isEmpty { computers = list.map { ($0.cpu, $0.memory) } }
        else if let host = state?.system?.host { computers = [(host.cpu, host.memory?.percent)] }
        let loads = computers.map { (cpu: Self.valid($0.cpu) ? $0.cpu : nil, memory: Self.valid($0.memory) ? $0.memory : nil) }
            .filter { $0.cpu != nil || $0.memory != nil }
        heat = Heat(value: loads.map { Swift.min(100, Swift.max($0.cpu ?? 0, $0.memory ?? 0)) }.max(),
                    cpu: loads.compactMap(\.cpu).max(), memory: loads.compactMap(\.memory).max())

        // Trip: tokens since the last reset from the token events, and their average per hour.
        if let start = trip, Self.valid(start), start <= now {
            let from = state?.chart_range?.start ?? ((Self.valid(state?.updated) ? state!.updated! : now) - 86_400)
            let inRange = start >= from
            let total: Double? = inRange ? (state?.events ?? []).reduce(0) { n, e in
                e.t >= start && e.t <= now && Self.valid(e.total) ? n + e.total : n } : nil
            let hours = (now - start) / Self.hour
            self.trip = Trip(start: start, tokens: total, rate: total.flatMap { hours > 0 ? $0 / hours : nil }, inRange: inRange,
                             accounts: usage.map { ($0.id, Self.increase($0, start: start, end: now)) })
        } else { self.trip = nil }
    }

    /// weekly.js increaseTrend's total: the weekly percent an account's reports added within start…end, each
    /// report once, never apportioned across the boundary. nil when no report falls inside.
    static func increase(_ account: WeeklyUsage.Account, start: Double, end: Double) -> Double? {
        guard valid(start), valid(end), end > start else { return nil }
        let complete = account.increase_intervals != nil
        var rows: [[Double?]]
        if let cells = account.increase_intervals { rows = cells.map { $0.prefix(3).map(\.number) } }
        else if let flow = account.flow { rows = flow.map { $0.prefix(3).map { Optional($0) } } }
        else {
            let points = (account.history ?? []).filter { $0.count >= 2 && valid($0[0]) }.sorted { $0[0] < $1[0] }
            rows = zip(points, points.dropFirst()).compactMap { a, b in
                valid(a[1]) && a[1] <= 100 && valid(b[1]) && b[1] <= 100 ? [a[0], b[0], b[1] - a[1]] : nil }
        }
        let intervals = rows.compactMap { r -> (Double, Double, Double)? in
            guard r.count >= 3, let a = r[0], let b = r[1], let d = r[2], valid(a), valid(b), valid(d), b > a,
                  complete || b - a <= 300, a >= start, b <= end else { return nil }
            return (a, b, d)
        }.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        var total = 0.0, last: Double?, any = false
        for (a, b, d) in intervals {
            if let last, a < last { continue }
            let next = total + d
            guard valid(next) else { continue }
            total = next; last = b; any = true
        }
        return any ? total : nil
    }

    /// The burn readout: whole above 100, one decimal above 10, else two.
    static func reading(_ v: Double?) -> String {
        guard let v, valid(v) else { return "—" }
        return v >= 100 ? String(Int(v.rounded())) : v >= 10 ? String(format: "%.1f", v) : String(format: "%.2f", v)
    }
    /// Dial numbers: "0.5", "1", "1.5", "50".
    static func scaleNumber(_ v: Double) -> String {
        let r = v < 1 ? (v * 100).rounded() / 100 : (v * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(r)
    }
    /// weekly.js number: one decimal, '<0.1' below a tenth.
    static func number(_ n: Double?) -> String {
        guard let n, valid(n) else { return "—" }
        if n > 0 && n < 0.1 { return "<0.1" }
        let r = (n * 10).rounded() / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }
}
