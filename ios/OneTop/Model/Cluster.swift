import Foundation

/// The cluster's readings on the iPhone (agent/onetop/dist/cluster.js `readings`), from the relay's reports as the
/// 1top.si dashboard reads them (site/src/remote-adapter.js). The token dial reads the period's average in tokens an
/// hour on a 100M scale (200M when use is heavy); the burn dial reads %/h of a weekly limit for the session or account
/// picked, else the average of every account with a burn, each account marked on the rim; the range below it is the
/// hours of work left before a limit runs out; fuel is each account's weekly limit left; the window's session rows,
/// the warning lights, odometer and trip follow the dashboard's cluster.
struct ClusterReadings {
    struct Scale: Equatable { var max: Double; var major: Double; var minor: Double }
    struct Range: Equatable {
        enum State: Equatable { case idle, enough, empty }
        var state: State; var at: Double?; var early: Bool
    }
    /// added is the limit's rise over the period; who the account's short name; window the limit read when it is
    /// not a weekly one (5 hours, monthly).
    struct Account: Identifiable {
        var id: String; var kind: String; var plan: String?; var tag: String?
        /// The tag as a gauge names it, as the web does: "Gemini Models" → "Gemini", "Claude and GPT" → "Claude·GPT".
        var shortTag: String? {
            tag.map { $0.replacingOccurrences(of: #"\s+models?$"#, with: "", options: [.regularExpression, .caseInsensitive])
                .replacingOccurrences(of: #"^Claude and GPT$"#, with: "Claude·GPT", options: [.regularExpression, .caseInsensitive]) }
        }
        /// Under a gauge the plan stays one short word, as the web writes it (Max, Pro, Biz; an Agy pool by its last
        /// name, Gemini 4 Argon as Argon), so nothing is cut short.
        var brief: String {
            let whole = plan ?? shortTag ?? "", last = whole.split(whereSeparator: \.isWhitespace).last.map(String.init) ?? whole
            let cap = last.prefix(1).uppercased() + last.dropFirst()
            return ["Business": "Biz", "Enterprise": "Ent"][cap] ?? cap
        }
        var pct: Double?; var left: Double?; var reset: Double?
        var current: Bool; var reconnect: Bool; var burn: Double?; var range: Range?; var cruise: Double?
        var added: Double? = nil; var weekly = true; var window: String? = nil; var who: String? = nil
    }
    /// What the burn dial reads when something is picked: a session tree (its lead's key) or an account.
    enum Pick: Equatable { case session(String), account(String) }
    /// A session tree's row in the window: working, waiting or its lead's own state, the period's tokens and
    /// weekly-limit estimate, and its burn.
    struct Row: Identifiable {
        var group: SessionGroup; var state: String; var tokens: Double; var estimate: Double?; var burn: Double?
        var id: String { group.id }
    }
    /// rate is the period's average per hour; full is the dial's full scale; tokens the period's total; climb the
    /// last minute's tokens a second, which carries the odometer between readings.
    struct Tach { var rate: Double?; var full: Double; var tokens: Double?; var instant: Double?; var climb: Double }
    /// Both scales hold while the period (and the burn dial's subject) stays, so a burst grows them and they never
    /// jump back.
    final class Hold { var period = ""; var full = 0.0; var subject = ""; var burn = 0.0 }
    /// One account's own burn on the burn dial's rim.
    struct Mark: Identifiable { var id: String; var kind: String; var value: Double }
    /// Range, like a car's distance to empty: the hours of work left at this burn before the weekly limit runs out.
    struct Reach: Equatable {
        enum State: Equatable { case hours, idle, reconnect, unknown }
        var state: State; var hours: Double? = nil; var early = false; var account: String? = nil
    }
    enum Subject: Equatable { case all(count: Int), session(id: String, kind: String), account(id: String, kind: String), none }
    struct Speed {
        var value: Double?; var multi: [Mark]; var cruise: Double?; var max: Double
        var subject: Subject; var picked: Bool; var reach: Reach
        var account: String? { if case .account(let id, _) = subject { id } else { nil } }
        var session: String? { if case .session(let id, _) = subject { id } else { nil } }
        var kind: String? {
            switch subject {
            case .session(_, let kind), .account(_, let kind): kind
            default: nil
            }
        }
    }
    /// What the warning lights tell: groups working now, sessions waiting for a look, sessions just finished,
    /// accounts to sign in again, limits running out before the reset, and whether the readings are live.
    struct Tells {
        var working: [String] = [], waiting: [String] = [], done: [String] = [], reconnect: [String] = [], empty: [String] = []
        var fresh = false
    }
    /// The busiest computer's CPU and memory.
    struct Heat { var cpu: Double?; var memory: Double? }
    struct Trip {
        var start: Double; var tokens: Double?; var rate: Double?; var inRange: Bool
    }

    var tach: Tach
    var speed: Speed
    var accounts: [Account]
    /// The window's sessions: working first, then those waiting, then the rest, each by its tokens and last use;
    /// a warning light pressed leaves only its own.
    var rows: [Row]
    var tells: Tells
    var heat: Heat
    var trip: Trip?

    static let hour = 3600.0, doneWindow = 600.0
    static func valid(_ n: Double?) -> Bool { n.map { $0.isFinite && $0 >= 0 } ?? false }
    /// The gauges that fit: every provider gets one before any gets a second, kept in the accounts' order (the web's pick).
    static func pick(_ list: [Account], _ n: Int) -> [Account] {
        let kinds = list.reduce(into: [String]()) { if !$0.contains($1.kind) { $0.append($1.kind) } }
        var taken = Set<String>()
        for round in 0..<list.count where taken.count < Swift.min(n, list.count) {
            for kind in kinds where taken.count < n {
                let same = list.filter { $0.kind == kind }
                if round < same.count { taken.insert(same[round].id) }
            }
        }
        return list.filter { taken.contains($0.id) }
    }

    /// Marks on a 1-2-2.5-5 step so a dial reads four or five numbers: 200 → 50, 100 → 25, 50 → 10, 2 → 0.5.
    static func marks(_ max: Double) -> Scale {
        let p = pow(10, floor(log10(max)))
        let major = [5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1].map { $0 * p }.first { max / $0 >= 4 - 1e-9 } ?? p / 10
        return Scale(max: max, major: major, minor: major / 5)
    }
    /// speed.js niceMax: a 1-2-5 step.
    static func niceMax(_ value: Double) -> Double {
        guard valid(value), value > 0 else { return 1 }
        let power = pow(10, floor(log10(value)))
        return [1.0, 2, 5, 10].map { $0 * power }.first { $0 >= value } ?? 10 * power
    }
    /// The token dial runs to 200M tokens an hour in every period; past that it breaks its limit in steps of 100M
    /// (300M, 400M, 500M, …).
    static func fullScale(_ rate: Double?) -> Double {
        let r = rate ?? 0
        return r <= 200e6 ? 200e6 : (r / 100e6).rounded(.up) * 100e6
    }
    /// Past its 200M limit the token dial counts in hundreds of millions, at most six steps to the full scale.
    static func tachMarks(_ full: Double) -> Scale {
        guard full > 200e6 else { return marks(full) }
        let u = (full / 100e6).rounded(), s = [1.0, 2, 5, 10, 20, 50].first { u / $0 <= 6 } ?? 100
        return Scale(max: full, major: s * 100e6, minor: s * 100e6 / 5)
    }
    /// The limit's level: 0 within 200M, 1 at 300M, 2 at 400M, 3 from 500M on (no more show past that).
    static func feverLevel(_ full: Double) -> Int { full <= 200e6 ? 0 : full <= 300e6 ? 1 : full <= 400e6 ? 2 : 3 }
    /// The burn dial's scale: 2, 5, 10, 20 and past its 20%/h limit steps of 20 (40, 60, 80, …).
    static func burnScale(_ top: Double) -> Double { top <= 20 ? Swift.max(2, niceMax(top)) : (top / 20).rounded(.up) * 20 }
    /// Past its 20%/h limit the burn dial counts in tens, twenties, fifties …, at most six steps to the full scale.
    static func burnMarks(_ max: Double) -> Scale {
        guard max > 20 else { return marks(max) }
        let s = [10.0, 20, 50, 100, 200, 500].first { max / $0 <= 6 } ?? 1000
        return Scale(max: max, major: s, minor: s / 5)
    }
    /// The burn dial's level: 0 within 20%/h, 1 at 40, 2 at 60, 3 from 80 on.
    static func burnLevel(_ max: Double) -> Int { max <= 20 ? 0 : max <= 40 ? 1 : max <= 60 ? 2 : 3 }
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

    @MainActor init(model: AppModel, now: Double, pick: Pick? = nil, only: String? = nil, trip: Double? = nil, hold: Hold? = nil) {
        let period = model.period, devices = model.reportingDevices
        let live = devices.filter { model.isFresh($0) }
        // The relay's newest report; readings within 20 seconds are live.
        let updated = (live.isEmpty ? devices : live).map { $0.received / 1000 }.max()
        let fresh = model.connection == .demo || (model.connection == .live && updated.map { now - $0 <= 20 } ?? false)

        // Token dial: the dashboard's token speed, the period's tokens over its length while reports are live.
        // QA and filming on the demo only hold the token speed to show the limit's levels: -qaTachRate (tokens an hour),
        // or -qaTachRamp "150,230,370,470" (millions an hour, one step for each ten seconds of the demo).
        var qa = model.connection == .demo ? UserDefaults.standard.double(forKey: "qaTachRate") : 0
        if model.connection == .demo, let ramp = UserDefaults.standard.string(forKey: "qaTachRamp")?.split(separator: ",").compactMap({ Double($0) }), !ramp.isEmpty {
            qa = ramp[Swift.min(ramp.count - 1, Swift.max(0, Int((now - DemoData.anchor) / 10)))] * 1e6
        }
        let tokens = fresh ? model.periodTokens : nil, rate = qa > 0 ? qa : tokens.map { $0 / period.seconds * Self.hour }
        let roots = model.sessions.filter { $0.parentSessionId == nil }
        var instant: Double?
        for s in roots {
            guard let v = s.usage?.lastMinute else { continue }
            instant = (instant ?? 0) + v.reduce(0) { $0 + (Self.valid($1) ? $1 : 0) } * Self.hour / 60
        }
        var full = Self.fullScale(rate)
        if let hold {
            if hold.period == period.rawValue && hold.full > full { full = hold.full }
            hold.period = period.rawValue; hold.full = full
        }
        tach = Tach(rate: rate, full: full, tokens: tokens, instant: instant, climb: Self.valid(instant) ? instant! / Self.hour : 0)

        // QA and filming on the demo only hold every account's burn to show the burn dial's levels: -qaBurnRate (%/h),
        // or -qaBurnRamp "25,45,65" (one step for each ten seconds of the demo).
        var qaBurn = model.connection == .demo ? UserDefaults.standard.double(forKey: "qaBurnRate") : 0
        if model.connection == .demo, let ramp = UserDefaults.standard.string(forKey: "qaBurnRamp")?.split(separator: ",").compactMap({ Double($0) }), !ramp.isEmpty {
            qaBurn = ramp[Swift.min(ramp.count - 1, Swift.max(0, Int((now - DemoData.anchor) / 10)))]
        }
        // Fuel: every account with what is left of its weekly limit, its burn, range and cruise.
        let list = model.quotas.map { q in
            let week = Self.window(q), pct = Self.valid(week?.pct) ? week?.pct : nil, reset = Self.valid(week?.reset) ? week?.reset : nil
            let reported = q.burnAllowed ? Self.burn(q, period.rawValue) : nil, burn = qaBurn > 0 && reported != nil ? qaBurn : reported
            let left = pct.map { Swift.max(0, 100 - $0) }
            let weekly = q.representativeWindow?.isWeekly == true, added = q.stale ? nil : q.weekly?[period.rawValue]?.usedPp
            return Account(id: q.id, kind: q.kind, plan: q.plan.flatMap { $0.isEmpty ? nil : $0 }, tag: model.accountTag(q.id), pct: pct, left: left,
                           reset: reset, current: pct != nil && !q.stale, reconnect: q.needsReconnect, burn: burn,
                           range: Self.range(left: left, burn: burn, reset: reset, now: now),
                           cruise: weekly ? Self.cruise(left: left, reset: reset, now: now) : nil,
                           added: Self.valid(added) ? added : nil, weekly: weekly, window: weekly ? nil : week?.name, who: q.pool ?? q.handle)
        }
        accounts = list

        // The window's session rows, for the dashboard's rows (a lead with its subagents).
        let all = model.groups.map { g -> Row in
            let busy = g.members.contains { model.isWorking($0) }
            return Row(group: g, state: busy ? "working" : g.root.status, tokens: g.tokens(in: period) ?? 0,
                       estimate: g.estimate(in: period), burn: fresh ? g.pace(in: period) : nil)
        }
        let done = { (r: Row) in r.state != "working" && r.state != "waiting" && (r.group.root.lastUsage ?? 0) > 0 && now - r.group.root.lastUsage! <= Self.doneWindow }
        let step = { (r: Row) in r.state == "working" ? 0 : r.state == "waiting" ? 1 : 2 }
        rows = all.filter { r in
            switch only {
            case "working": r.state == "working"
            case "waiting": r.state == "waiting"
            case "done": done(r)
            default: true
            }
        }.sorted { a, b in
            step(a) != step(b) ? step(a) < step(b) : a.tokens != b.tokens ? a.tokens > b.tokens : (a.group.root.lastUsage ?? 0) > (b.group.root.lastUsage ?? 0)
        }

        // Burn dial: the session or account picked, read against its account; with nothing picked, every account with
        // a burn, their average on the needle and each one's own on the rim.
        var subject = Subject.none, value: Double?, multi: [Mark] = [], cruise: Double?, reach = Reach(state: .unknown)
        func against(_ a: Account?) -> Reach {
            guard let a else { return Reach(state: .unknown) }
            return a.reconnect ? Reach(state: .reconnect, account: a.id) : a.left == nil || value == nil ? Reach(state: .unknown)
                : value == 0 ? Reach(state: .idle) : Self.reach(left: a.left!, burn: value!, reset: a.reset, now: now, account: a.id)
        }
        if case .session(let id) = pick, let row = all.first(where: { $0.id == id }) {
            let a = model.account(of: row.group.root).flatMap { id in list.first { $0.id == id } }
            subject = .session(id: id, kind: row.group.root.kind); value = Self.valid(row.burn) ? row.burn : nil; cruise = a?.cruise
            reach = against(a)
        } else if case .account(let id) = pick, let a = list.first(where: { $0.id == id }) {
            subject = .account(id: a.id, kind: a.kind); value = Self.valid(a.burn) ? a.burn : nil; cruise = a.cruise
            reach = against(a)
        } else {
            let burning = list.filter { Self.valid($0.burn) }
            if !burning.isEmpty {
                subject = .all(count: burning.count)
                value = burning.reduce(0) { $0 + $1.burn! } / Double(burning.count)
                multi = burning.map { Mark(id: $0.id, kind: $0.kind, value: $0.burn!) }
                let cs = burning.compactMap(\.cruise)
                cruise = cs.isEmpty ? nil : cs.reduce(0, +) / Double(cs.count)
                // Every AI together reads the account that runs out first.
                let ends = burning.filter { $0.burn! > 0 && $0.left != nil }.map { (a: $0, h: $0.left! / $0.burn!) }.sorted { $0.h < $1.h }
                reach = ends.first.map { Self.reach(left: $0.a.left!, burn: $0.a.burn!, reset: $0.a.reset, now: now, account: $0.a.id) } ?? Reach(state: .idle)
            }
        }
        // The scale steps 2, 5, 10, 20 and past 20%/h by 20s, past the reading, one and a half times the cruise and
        // every rim mark.
        let top = Swift.max(value ?? 0, (cruise ?? 0) * 1.6, multi.map(\.value).max() ?? 0)
        var smax = Self.burnScale(top)
        if let hold {
            let key = period.rawValue + "|" + "\(subject)"
            if hold.subject == key && hold.burn > smax { smax = hold.burn }
            hold.subject = key; hold.burn = smax
        }
        let picked = switch subject { case .session, .account: true; default: false }
        speed = Speed(value: value, multi: multi, cruise: cruise, max: smax, subject: subject, picked: picked, reach: reach)

        // Warning lights, for the dashboard's rows (a lead with its subagents).
        var tells = Tells()
        for g in model.groups {
            let s = g.root, busy = g.members.contains { model.isWorking($0) }
            if busy { tells.working.append(s.key) }
            else if s.status == "waiting" { tells.waiting.append(s.key) }
            else if let last = s.lastUsage, last > 0, now - last <= Self.doneWindow { tells.done.append(s.key) }
        }
        tells.reconnect = list.filter(\.reconnect).map(\.id)
        tells.empty = list.filter { $0.range?.early == true }.map(\.id)
        tells.fresh = fresh
        self.tells = tells

        // CPU and memory: the busiest reporting computer's.
        let hosts = (live.isEmpty ? devices : live).compactMap { $0.snapshot?.host }
        heat = Heat(cpu: hosts.compactMap(\.cpu).filter { Self.valid($0) }.max(), memory: hosts.compactMap(\.memoryPercent).filter { Self.valid($0) }.max())

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
            self.trip = Trip(start: start, tokens: inRange ? total : nil, rate: inRange && hours > 0 ? total / hours : nil, inRange: inRange)
        } else { self.trip = nil }
    }

    private static func reach(left: Double, burn: Double, reset: Double?, now: Double, account: String) -> Reach {
        let h = left / burn
        return Reach(state: .hours, hours: h, early: reset.map { now + h * hour < $0 } ?? false, account: account)
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
    /// The dashboard's token figures: 108.20M, 7.5k.
    static func tokens(_ value: Double?) -> String {
        guard let value, valid(value) else { return "—" }
        if value >= 1e9 { return String(format: "%.2fB", value / 1e9) }
        if value >= 1e6 { return String(format: "%.2fM", value / 1e6) }
        if value >= 1e3 { return String(format: "%.1fk", value / 1e3) }
        return String(format: value.rounded() == value ? "%.0f" : "%.1f", value)
    }
    /// cluster.js modelName: a model as the burn dial names a session (claude-opus-5-5 → Opus 5.5, gpt-6.1-sol → GPT-6.1-sol).
    static func modelName(_ id: String?) -> String? {
        guard let name = Tool.model(id) else { return nil }
        guard let m = name.wholeMatch(of: /(opus|sonnet|haiku|fable)-(\d+)-(\d+).*/) else { return name }
        return m.1.prefix(1).uppercased() + m.1.dropFirst() + " " + m.2 + "." + m.3
    }
    /// The trip's short figure, as the token dial reads: three digits and k, M or B (396M).
    static func short(_ value: Double?) -> String {
        guard let value, valid(value) else { return "—" }
        let d = Display.digits(value)
        return String(d.cells) + d.unit
    }
}

/// The cluster's lit displays (speed.js digits and seg7, cluster.js burnDigits and rangeDigits): which cells
/// light, where a decimal point sits, and the unit letter beside them. Only lit cells are kept.
enum Display {
    struct Cells: Equatable { var cells: [Character]; var unit = ""; var dp: Int? = nil }
    /// The token figure: up to three cells with k, M or B beside them (108M).
    static func digits(_ v: Double?) -> Cells {
        guard let v, v.isFinite, v >= 0 else { return Cells(cells: ["-", "-", "-"]) }
        if v < 0.5 { return Cells(cells: ["0"]) }
        func unit(_ n: Double) -> (Double, String) { n >= 1e9 ? (1e9, "B") : n >= 1e6 ? (1e6, "M") : n >= 1e3 ? (1e3, "k") : (1, "") }
        var (d, u) = unit(v), x = (v / d).rounded()
        if x >= 1000 && u != "B" { (d, u) = unit(x * d); x = (v / d).rounded() }
        return Cells(cells: Array(String(Int(min(999, x)))), unit: u)
    }
    /// The burn: three cells with the decimal point (0.53, 12.4, 135); unknown keeps the reading's shape, -.--.
    static func burn(_ v: Double?) -> Cells {
        guard let v, v.isFinite, v >= 0 else { return Cells(cells: ["-", "-", "-"], dp: 0) }
        let s = v < 9.995 ? String(format: "%.2f", v) : v < 99.95 ? String(format: "%.1f", v) : String(Int(min(999, v.rounded())))
        let dot = s.firstIndex(of: ".").map { s.distance(from: s.startIndex, to: $0) }
        return Cells(cells: Array(s.replacingOccurrences(of: ".", with: "")), dp: dot.map { $0 - 1 })
    }
    /// The range in hours: 4.6, 23, 140 (999 at most); without a reading, dashes.
    static func hours(_ h: Double?) -> Cells {
        guard let h, h.isFinite, h >= 0 else { return Cells(cells: ["-", "-", "-"]) }
        let s = h < 9.95 ? String(format: "%.1f", h) : String(Int(min(999, h.rounded())))
        let dot = s.firstIndex(of: ".").map { s.distance(from: s.startIndex, to: $0) }
        return Cells(cells: Array(s.replacingOccurrences(of: ".", with: "")), dp: dot.map { $0 - 1 })
    }
}

/// The range on the odometer's drum wheels (cluster.js rangeWheels): 4.6, 23, 140 (999 at most), a wheel per digit and
/// the point between; without a reading two dashes, the dash sitting on each wheel's strip after its 9. A wheel turns
/// either way to its new digit; when the shape changes (23 → 9.8) the wheels are set anew without turning.
final class RangeWheels {
    static let dash = 10
    /// A 0 for each wheel and the point where it sits: "00", "0.0", "000".
    private(set) var shape = ""
    /// Each wheel's place on its strip, left to right.
    private(set) var positions: [Int] = []

    /// Takes the latest hours; true when the wheels turn to them, false when they are set anew or stay.
    @discardableResult func take(_ hours: Double?) -> Bool {
        let s = Self.text(hours), form = String(s.map { $0 == "." ? "." : "0" })
        let next = s.filter { $0 != "." }.map { $0.wholeNumberValue ?? Self.dash }
        let turns = form == shape && next != positions
        shape = form; positions = next
        return turns
    }
    static func text(_ h: Double?) -> String {
        guard let h, h.isFinite, h >= 0 else { return "--" }
        return h < 9.95 ? String(format: "%.1f", h) : String(Int(min(999, h.rounded())))
    }
}

/// The total as a car's odometer turns it (cluster.js odometer): while the period stays the count never goes back,
/// the wheels move at most every three seconds, and each place's wheel only turns up, from 9 on to 0. A place shows its
/// turn's last digit (a turn of 12 shows 2), and there are only as many places as the count has digits.
final class OdometerWheels {
    private(set) var period: String?
    private(set) var shown: Double?
    private(set) var at = -Double.infinity
    /// Each place's turn, units first.
    private(set) var turns: [Double] = []

    /// Takes the latest count; true when the wheels move.
    @discardableResult func take(_ value: Double, period: String, now: Double) -> Bool {
        let target = Swift.max(0, Swift.min(9_999_999_999, value.isFinite ? value.rounded() : 0))
        if self.period != period { self.period = period; shown = nil }
        if shown != nil && now - at < 3 { return false }
        at = now
        let total = shown.map { Swift.max($0, target) } ?? target
        shown = total
        let digits = Array(String(Int64(total)).compactMap(\.wholeNumberValue).reversed())
        var next = Array(turns.prefix(digits.count))
        next += Array(repeating: 0, count: digits.count - next.count)
        for (k, d) in digits.enumerated() { next[k] += Double((d - Int(next[k]) % 10 + 10) % 10) }
        let moved = next != turns
        turns = next
        return moved
    }
}
