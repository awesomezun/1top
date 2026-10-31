import Foundation

/// The cluster's readings on the iPhone (agent/onetop/dist/cluster.js `readings`), from the relay's reports as the
/// 1top.si dashboard reads them (site/src/remote-adapter.js): the speedometer is one account's weekly-limit burn
/// in %/h, the account picked or else the fastest; the tachometer is the dashboard's token speed; fuel is each
/// account's weekly limit left; the warning lights, odometer and trip follow the dashboard's cluster.
struct ClusterReadings {
    struct Scale: Equatable { var max: Double; var major: Double; var minor: Double }
    struct Range: Equatable {
        enum State: Equatable { case idle, enough, empty }
        var state: State; var at: Double?; var early: Bool
    }
    struct Account: Identifiable {
        var id: String; var kind: String; var plan: String?; var tag: String?
        var pct: Double?; var left: Double?; var reset: Double?
        var current: Bool; var reconnect: Bool; var burn: Double?; var range: Range?
    }
    struct Tach { var rate: Double?; var max: Double; var tokens: Double?; var instant: Double?; var climb: Double }
    struct Speed {
        var value: Double?; var recent: Double?; var cruise: Double?; var max: Double
        var kind: String?; var account: String?; var picked: Bool
    }
    struct Tells {
        var kinds: [(kind: String, working: Int)] = []
        var waiting: [String] = [], reconnect: [String] = [], empty: [String] = [], context: [String] = [], stalled: [String] = []
        var fresh = false
    }
    struct Trip {
        var start: Double; var tokens: Double?; var rate: Double?; var inRange: Bool
        /// Each account's weekly percent since the start. The relay carries no per-report increases, so the
        /// 1top.si dashboard shows none either: always nil here for now.
        var accounts: [(id: String, used: Double?)] = []
    }

    var tach: Tach
    var speed: Speed
    var accounts: [Account]
    var tells: Tells
    var trip: Trip?

    static let hour = 3600.0, stall = 15 * 60.0, contextFull = 0.9
    static let kinds = ["Claude", "Codex", "GLM", "Antigravity", "Aside"]
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
    static func scaleMax(_ rate: Double?, seconds: Double) -> Double {
        Swift.max(seconds <= 3600 ? 2e8 : seconds <= 604_800 ? 1e8 : 5e7, valid(rate) ? niceMax(rate!) : 0)
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
    /// The one place that chooses which of an account's limit windows the cluster reads: its weekly window.
    static func window(_ q: Quota) -> QuotaWindow? { q.representativeWindow }
    /// weekly.js accountBurn: a current provider report over at least two observed minutes.
    static func burn(_ q: Quota, _ period: String) -> Double? { q.stale ? nil : q.weekly?[period]?.burnPerHour }

    @MainActor init(model: AppModel, now: Double, pick: String? = nil, trip: Double? = nil) {
        let period = model.period, devices = model.reportingDevices
        let live = devices.filter { model.isFresh($0) }
        // The relay's newest report; readings within 20 seconds are live.
        let updated = (live.isEmpty ? devices : live).map { $0.received / 1000 }.max()
        let fresh = model.connection == .demo || (model.connection == .live && updated.map { now - $0 <= 20 } ?? false)

        // Tachometer: the dashboard's token speed, the period's tokens over its length while reports are live.
        let tokens = fresh ? model.periodTokens : nil, rate = tokens.map { $0 / period.seconds * Self.hour }
        let roots = model.sessions.filter { $0.parentSessionId == nil }
        var instant: Double?
        for s in roots {
            guard let v = s.usage?.lastMinute else { continue }
            instant = (instant ?? 0) + v.reduce(0) { $0 + (Self.valid($1) ? $1 : 0) } * Self.hour / 60
        }
        tach = Tach(rate: rate, max: Self.scaleMax(rate, seconds: period.seconds), tokens: tokens, instant: instant,
                    climb: Self.valid(instant) ? instant! / Self.hour : 0)

        // Fuel: every account with what is left of its weekly limit.
        let list = model.quotas.map { q in
            let week = Self.window(q), pct = Self.valid(week?.pct) ? week?.pct : nil, reset = Self.valid(week?.reset) ? week?.reset : nil
            let burn = q.burnAllowed ? Self.burn(q, period.rawValue) : nil, left = pct.map { Swift.max(0, 100 - $0) }
            return Account(id: q.id, kind: q.kind, plan: q.plan.flatMap { $0.isEmpty ? nil : $0 }, tag: model.accountTag(q.id), pct: pct, left: left,
                           reset: reset, current: pct != nil && !q.stale, reconnect: q.needsReconnect, burn: burn,
                           range: Self.range(left: left, burn: burn, reset: reset, now: now))
        }
        accounts = list

        // Speedometer: the account picked, else the one burning fastest; never a sum across accounts. Its
        // second needle reads the same account over the last ten minutes.
        let picked = pick.flatMap { id in list.first { $0.id == id } }
        let subject = picked ?? list.filter { Self.valid($0.burn) }.max { ($0.burn ?? 0) < ($1.burn ?? 0) }
        let value = subject?.burn.flatMap { Self.valid($0) ? $0 : nil }
        let target = subject.flatMap { s in model.quotas.first { $0.id == s.id }?.representativeWindow?.isWeekly == true ? Self.cruise(left: s.left, reset: s.reset, now: now) : nil }
        let ten = period == .m10 ? nil : subject.flatMap { a in model.quotas.first { $0.id == a.id }.flatMap { $0.burnAllowed ? Self.burn($0, Period.m10.rawValue) : nil } }
        speed = Speed(value: value, recent: ten, cruise: target,
                      max: Swift.max(2, Self.niceMax(Swift.max(value ?? 0, (target ?? 0) * 1.6, ten ?? 0))),
                      kind: subject?.kind, account: subject?.id, picked: picked != nil)

        // Warning lights, for the dashboard's rows (a lead with its subagents): tools working now, sessions
        // waiting for a look, accounts to sign in again, limits running out before the reset, contexts nearly
        // full, working sessions quiet for 15 minutes, and whether the readings are live.
        var tells = Tells(), working: [String: Int] = [:]
        for g in model.groups {
            let s = g.root, busy = g.members.contains { model.isWorking($0) }
            if busy { working[s.kind, default: 0] += 1 }
            if !busy && s.status == "waiting" { tells.waiting.append(s.key) }
            if let c = s.contextUsage, let input = c.inputTokens, let capacity = c.capacity, Self.valid(input), capacity > 0,
               input / capacity >= Self.contextFull { tells.context.append(s.key) }
            if busy, let last = s.lastUsage, last > 0, now - last > Self.stall { tells.stalled.append(s.key) }
        }
        let rank = { (k: String) in Self.kinds.firstIndex(of: k) ?? Self.kinds.count }
        tells.kinds = working.keys.sorted { rank($0) != rank($1) ? rank($0) < rank($1) : $0 < $1 }.map { ($0, working[$0]!) }
        tells.reconnect = list.filter(\.reconnect).map(\.id)
        tells.empty = list.filter { $0.range?.early == true }.map(\.id)
        tells.fresh = fresh
        self.tells = tells

        // Trip: tokens since the last reset from each computer's token bins (its finest bins first, coarser ones
        // only before them), and their average per hour.
        if let start = trip, Self.valid(start), start <= now {
            let from = (updated ?? now) - 86_400, inRange = start >= from
            var total = 0.0
            if inRange {
                for d in live {
                    let flows = (d.snapshot?.flow ?? [:]).values.filter { $0.step > 0 && $0.start != nil }
                        .sorted { $0.step != $1.step ? $0.step < $1.step : ($0.start ?? 0) < ($1.start ?? 0) }
                    var covered = Double.infinity
                    for f in flows {
                        let first = f.start!
                        for (i, bin) in f.bins.enumerated() {
                            let t = first + Double(i) * f.step
                            guard t + f.step <= covered, t >= start, t <= now, let bin else { continue }
                            total += bin.values.reduce(0) { $0 + (Self.valid($1) ? $1 : 0) }
                        }
                        covered = Swift.min(covered, first)
                    }
                }
            }
            let hours = (now - start) / Self.hour
            self.trip = Trip(start: start, tokens: inRange ? total : nil, rate: inRange && hours > 0 ? total / hours : nil, inRange: inRange,
                             accounts: list.map { ($0.id, nil) })
        } else { self.trip = nil }
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
    /// The dashboard's token figures: 108.20M, 7.5k.
    static func tokens(_ value: Double?) -> String {
        guard let value, valid(value) else { return "—" }
        if value >= 1e9 { return String(format: "%.2fB", value / 1e9) }
        if value >= 1e6 { return String(format: "%.2fM", value / 1e6) }
        if value >= 1e3 { return String(format: "%.1fk", value / 1e3) }
        return String(format: value.rounded() == value ? "%.0f" : "%.1f", value)
    }
}
