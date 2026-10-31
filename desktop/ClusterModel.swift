import Foundation

/// The cluster's readings for the menu bar (agent/onetop/dist/cluster.js `readings`): the same numbers from the
/// same /api/state. The speedometer is one account's weekly-limit burn in %/h at its last minute's token speed,
/// the account picked or else the one burning fastest now; the tachometer is tokens per minute over the last
/// minute; fuel is each account's weekly limit left; the warning lights, odometer, trip and load follow the
/// dashboard's cluster.
struct ClusterReadings {
    struct Scale: Equatable { var max: Double; var major: Double; var minor: Double }
    struct Range: Equatable {
        enum State: Equatable { case idle, enough, empty }
        var state: State; var at: Double?; var early: Bool
    }
    struct Account: Identifiable {
        var id: String; var kind: String; var plan: String?; var alias: String?
        var pct: Double?; var left: Double?; var reset: Double?
        var current: Bool; var reconnect: Bool; var burn: Double?; var range: Range?
        /// The burn at the last minute's token speed of the account's sessions; the period's burn without a report.
        var live: Double? = nil
    }
    /// rate is the period's average per hour; now is the last minute per hour (the period's average without a
    /// report); tpmMax is the dial's full scale in tokens per minute.
    struct Tach { var rate: Double?; var max: Double; var tokens: Double?; var instant: Double?; var climb: Double
                  var now: Double?; var live: Bool; var tpmMax: Double }
    /// The tachometer's scale, held while the period stays so a burst grows it and it never jumps back.
    final class TachHold { var period = ""; var tpm = 0.0 }
    struct Speed {
        var value: Double?; var live: Double?; var recent: Double?; var cruise: Double?; var max: Double
        var kind: String?; var account: String?; var picked: Bool
    }
    struct Tells {
        var kinds: [(kind: String, working: Int)] = []
        var waiting: [String] = [], reconnect: [String] = [], empty: [String] = [], context: [String] = [], stalled: [String] = []
        var fresh = false
    }
    struct Trip {
        var start: Double; var tokens: Double?; var rate: Double?; var inRange: Bool
        /// Each account's weekly percent used since the start; nil when no report covers it.
        var accounts: [(id: String, used: Double?)] = []
    }
    struct Heat { var value: Double?; var cpu: Double?; var memory: Double? }

    var period: String
    var tach: Tach
    var speed: Speed
    var accounts: [Account]
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
    /// speed.js niceMax and scaleMax: a 1-2-5 step, and the dial's resting full scale by period length.
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
        if let reset, at >= reset { return Range(state: .enough, at: at, early: false) }
        return Range(state: .empty, at: at, early: reset != nil)
    }
    /// Cruise: the steady %/h that spends what is left of the weekly limit exactly by its reset.
    static func cruise(left: Double?, reset: Double?, now: Double) -> Double? {
        guard let left, let reset, reset > now else { return nil }
        return left / ((reset - now) / hour)
    }
    /// weekly.js accountBurn: a current provider report over at least two observed minutes.
    static func accountBurn(_ period: WeeklyUsage.Period?, _ quota: AccountQuota?) -> Double? {
        guard let quota, !quota.stale, let period else { return nil }
        return period.burnPerHour
    }
    /// The one place that chooses which of an account's limit windows the cluster reads: its representative
    /// window (weekly, else 5 hours, else daily). Only a verified weekly window gets a burn and a cruise.
    static func window(_ q: AccountQuota) -> AccountQuota.Window? { q.representativeWindow }
    /// The display state the dashboard gives a row: working while any of its subagents works.
    static func display(_ s: DesktopSession) -> String { (s.children_working ?? 0) > 0 ? "working" : s.state }

    init(snapshot: DesktopSnapshot?, sessions: [DesktopSession], period: String, now: Double, pick: String? = nil, trip: Double? = nil,
         hold: TachHold? = nil) {
        self.period = period
        let state = snapshot
        // Tachometer: speed.js measure, the period's tokens over its length while the collector is fresh.
        let window = state?.period_usage?.windows.first { $0.key == period }
        let local: Double? = window.flatMap { w in w.tokens.count == 4 && w.tokens.allSatisfy { Self.valid($0) } ? w.tokens.reduce(0, +) : nil }
        let known = local != nil && (local! > 0 || !(state?.period_usage?.known_kinds.isEmpty ?? true))
        let fresh = state != nil && (state?.error ?? "").isEmpty && Self.valid(state?.updated) && now - (state?.updated ?? 0) <= 20
        let seconds = window?.seconds ?? ["10m": 600, "30m": 1800, "1h": 3600, "5h": 18000, "12h": 43200, "24h": 86400][period]
        let tokens: Double? = known && fresh ? local : nil
        let rate: Double? = tokens.flatMap { t in (seconds ?? 0) > 0 ? t / seconds! * Self.hour : nil }
        // The last minute's tokens per hour from each top-level session's sliding minute, in all and by tool.
        var instant: Double?
        for s in state?.root_sessions ?? state?.sessions ?? [] {
            guard let v = s.usage?.last_minute else { continue }
            instant = (instant ?? 0) + v.reduce(0) { $0 + (Self.valid($1) ? $1 : 0) } * Self.hour / (s.usage?.window_seconds ?? 60)
        }
        // Tokens per minute, like rpm: the needle reads the last minute; the scale is round, at least two and a half
        // times the period's average, and held while the period stays.
        let now1 = Self.valid(instant) ? instant : rate, full = Self.scaleMax(rate, seconds: seconds)
        var tpmMax = Self.niceMax(Swift.max(full / 60, (rate ?? 0) / 60 * 2.5, (now1 ?? 0) / 60))
        if let hold {
            if hold.period == period && hold.tpm > tpmMax { tpmMax = hold.tpm }
            hold.period = period; hold.tpm = tpmMax
        }
        tach = Tach(rate: rate, max: full, tokens: tokens, instant: instant, climb: Self.valid(instant) ? instant! / Self.hour : 0,
                    now: now1, live: Self.valid(instant), tpmMax: tpmMax)

        // Fuel: every account with what is left of its weekly limit.
        let usage = state?.weekly_usage?.accounts ?? []
        var list = (state?.account_quotas ?? []).map { q in
            let week = Self.window(q), pct = Self.valid(week?.pct) ? week?.pct : nil
            let reset = week.flatMap { Self.valid($0.reset) ? $0.reset : nil }
            let burn = q.burnAllowed ? Self.accountBurn(usage.first { $0.id == q.id }?.periods[period], q) : nil
            let left = pct.map { Swift.max(0, 100 - $0) }
            return Account(id: q.id, kind: q.kind, plan: q.plan.flatMap { $0.isEmpty ? nil : $0 }, alias: q.alias, pct: pct, left: left,
                           reset: reset, current: pct != nil && q.stale == false, reconnect: Self.reconnectStates.contains(q.status ?? ""),
                           burn: burn, range: Self.range(left: left, burn: burn, reset: reset, now: now))
        }
        // Live: each account's burn at its sessions' last-minute token speed, holding the period's percent per
        // token, so the needle moves as tokens flow; without a last-minute report it is the period's burn.
        func lastMinute(_ s: DesktopSession) -> Double? {
            s.usage?.last_minute.map { $0.reduce(0) { $0 + (Self.valid($1) ? $1 : 0) } * Self.hour / (s.usage?.window_seconds ?? 60) }
        }
        func accountOf(_ s: DesktopSession) -> String? {
            if let id = s.usage?.weekly_estimate?[period]?.account_id, !id.isEmpty { return id }
            if let id = s.usage?.weekly_account, !id.isEmpty { return id }
            return nil
        }
        func periodTokens(_ s: DesktopSession) -> Double {
            ((s.usage?.windows?[period] ?? nil) ?? []).reduce(0) { $0 + (Self.valid($1) ? $1 : 0) }
        }
        func livePace(_ value: Double?, _ rows: [DesktopSession]) -> Double? {
            guard let value else { return nil }
            var n: Double?, t = 0.0
            for s in rows { if let l = lastMinute(s) { n = (n ?? 0) + l }; t += periodTokens(s) }
            let per: Double? = Self.valid(window?.seconds) && window!.seconds! > 0 ? t * Self.hour / window!.seconds! : nil
            guard let n, let per, per > 0 else { return value }
            return value * n / per
        }
        for i in list.indices where Self.valid(list[i].burn) {
            let id = list[i].id
            list[i].live = livePace(list[i].burn, sessions.filter { accountOf($0) == id })
        }
        accounts = list

        // Speedometer: the account picked, else the one burning fastest now; never a sum across accounts.
        let quotas = state?.account_quotas ?? []
        func recent(_ id: String) -> Double? {
            guard period != "10m", let q = quotas.first(where: { $0.id == id }), q.burnAllowed else { return nil }
            return Self.accountBurn(usage.first { $0.id == id }?.periods["10m"], q)
        }
        let picked = pick.flatMap { id in list.first { $0.id == id } }
        let subject = picked ?? list.filter { Self.valid($0.burn) }
            .sorted { ($0.live ?? 0) != ($1.live ?? 0) ? ($0.live ?? 0) > ($1.live ?? 0) : ($0.burn ?? 0) > ($1.burn ?? 0) }.first
        let value = subject?.burn.flatMap { Self.valid($0) ? $0 : nil }
        let liveBurn = subject == nil ? nil : subject!.live ?? value
        let target = subject.flatMap { s in quotas.first { $0.id == s.id }?.representativeWindow?.isWeekly == true ? Self.cruise(left: s.left, reset: s.reset, now: now) : nil }
        let ten = subject.flatMap { recent($0.id) }.flatMap { Self.valid($0) ? $0 : nil }
        speed = Speed(value: value, live: liveBurn, recent: ten, cruise: target,
                      max: Swift.max(2, Self.niceMax(Swift.max(value ?? 0, liveBurn ?? 0, (target ?? 0) * 1.6))),
                      kind: subject?.kind, account: subject?.id, picked: picked != nil)

        // Warning lights: tools working now, sessions waiting for a look, accounts to sign in again, limits
        // running out before the reset, contexts nearly full, sessions quiet for 15 minutes, and live readings.
        var tells = Tells()
        var working: [String: Int] = [:]
        for s in sessions {
            let display = Self.display(s)
            if display == "working" { working[s.kind, default: 0] += 1 }
            if display == "waiting" { tells.waiting.append(s.id) }
            if let c = s.context_usage, Self.valid(c.input_tokens), Self.valid(c.capacity), c.capacity! > 0,
               c.input_tokens! / c.capacity! >= Self.contextFull { tells.context.append(s.id) }
            if display == "working", let last = s.last_usage, Self.valid(last), last > 0, now - last > Self.stall { tells.stalled.append(s.id) }
        }
        let rank = { (k: String) in Self.kinds.firstIndex(of: k) ?? Self.kinds.count }
        tells.kinds = working.keys.sorted { rank($0) != rank($1) ? rank($0) < rank($1) : $0 < $1 }.map { ($0, working[$0]!) }
        tells.reconnect = list.filter(\.reconnect).map(\.id)
        tells.empty = list.filter { $0.range?.early == true }.map(\.id)
        tells.fresh = fresh
        self.tells = tells

        // Engine temperature: each computer's load is the higher of its CPU and memory use; the hottest shows.
        var computers: [(cpu: Double?, memory: Double?)] = []
        if let list = state?.system?.computers, !list.isEmpty { computers = list.map { ($0.cpu, $0.memory) } }
        else if let host = state?.system?.host { computers = [(host.cpu, host.memory?.percent)] }
        let loads = computers.map { (cpu: Self.valid($0.cpu) ? $0.cpu : nil, memory: Self.valid($0.memory) ? $0.memory : nil) }
            .filter { $0.cpu != nil || $0.memory != nil }
            .map { (load: Swift.min(100, Swift.max($0.cpu ?? 0, $0.memory ?? 0)), cpu: $0.cpu, memory: $0.memory) }
        let hottest = loads.max { $0.load < $1.load }
        heat = Heat(value: hottest?.load, cpu: hottest?.cpu, memory: hottest?.memory)

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

    /// The speedometer's readout: whole above 100, one decimal above 10, else two.
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
