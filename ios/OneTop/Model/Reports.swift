import Foundation
import Observation

/// The collector's reports (report-contract v1.2.0): this month's API value of the subscriptions and the week's agent
/// hours. Several computers add up and an account's plan counts once, as the web's remote adapter does (mergeReports).
struct Reports: Codable, Hashable, Sendable {
    struct Plan: Codable, Hashable, Sendable { var accountId: String?; var kind: String?; var plan: String?; var label: String?; var price: Double?; var source: String? }
    struct Kind: Codable, Hashable, Sendable { var kind: String; var apiValue: Double?; var planTotal: Double?; var ratio: Double? }
    struct ModelValue: Codable, Hashable, Sendable { var model: String; var kind: String?; var apiValue: Double? }
    struct Month: Codable, Hashable, Sendable { var month: String; var apiValue: Double?; var planTotal: Double? }
    struct Unpriced: Codable, Hashable, Sendable { var tokens: Double?; var models: [String]? }
    struct Value: Codable, Hashable, Sendable {
        var month: String?; var start: Double?; var end: Double?; var pricesAsOf: String?
        var plans: [Plan]?; var planTotal: Double?; var apiValue: Double?; var apiBilled: Double?; var unpriced: Unpriced?
        var byKind: [Kind]?; var byModel: [ModelValue]?; var months: [Month]?
    }
    struct Day: Codable, Hashable, Sendable { var date: String; var workingS: Double?; var waitingS: Double? }
    struct Wait: Codable, Hashable, Sendable { var sessionId: String?; var label: String?; var kind: String?; var seconds: Double? }
    struct Previous: Codable, Hashable, Sendable { var workingS: Double?; var waitingS: Double?; var partial: Bool? }
    struct Weekly: Codable, Hashable, Sendable {
        var start: Double?; var end: Double?; var since: Double?; var workingS: Double?; var waitingS: Double?
        var longestWait: Wait?; var previous: Previous?; var days: [Day]?
    }
    var version: Int?
    var asOf: Double?
    var value: Value?
    var weekly: Weekly?

    private static let rank = ["user": 0, "detected": 1, "unknown": 2]
    static func merge(_ parts: [Reports]) -> Reports? {
        guard !parts.isEmpty else { return nil }
        var out = Reports(version: 1, asOf: parts.compactMap(\.asOf).max())
        let values = parts.compactMap(\.value).filter { $0.apiValue != nil && $0.month != nil }
        if let month = values.compactMap(\.month).max() {
            let same = values.filter { $0.month == month }
            var plans: [String: Plan] = [:], planOrder: [String] = []
            for v in same { for p in v.plans ?? [] {
                let id = p.accountId ?? UUID().uuidString
                if let old = plans[id] { if (rank[p.source ?? ""] ?? 3) < (rank[old.source ?? ""] ?? 3) { plans[id] = p } }
                else { plans[id] = p; planOrder.append(id) }
            } }
            let plan = planOrder.compactMap { plans[$0] }, planTotal = plan.reduce(0) { $0 + ($1.price ?? 0) }
            var models: [String: ModelValue] = [:], modelOrder: [String] = []
            for v in same { for m in v.byModel ?? [] {
                let key = (m.kind ?? "") + "|" + m.model
                if models[key] == nil { models[key] = ModelValue(model: m.model, kind: m.kind, apiValue: 0); modelOrder.append(key) }
                models[key]!.apiValue! += m.apiValue ?? 0
            } }
            let modelList = modelOrder.compactMap { models[$0] }.sorted { ($0.apiValue ?? 0) > ($1.apiValue ?? 0) }
            var kinds: [String] = []; for m in modelList where !kinds.contains(m.kind ?? "") { kinds.append(m.kind ?? "") }
            let byKind = kinds.map { kind -> Kind in
                let v = modelList.filter { $0.kind == kind }.reduce(0) { $0 + ($1.apiValue ?? 0) }
                let p = plan.filter { $0.kind == kind }.reduce(0) { $0 + ($1.price ?? 0) }
                return Kind(kind: kind, apiValue: v, planTotal: p, ratio: p > 0 ? v / p : nil)
            }
            var months: [String: Month] = [:]
            for v in same { for m in v.months ?? [] {
                var o = months[m.month] ?? Month(month: m.month, apiValue: 0, planTotal: 0)
                o.apiValue = (o.apiValue ?? 0) + (m.apiValue ?? 0); o.planTotal = max(o.planTotal ?? 0, m.planTotal ?? 0); months[m.month] = o
            } }
            out.value = Value(month: month, start: same.compactMap(\.start).min(), end: same.compactMap(\.end).max(), pricesAsOf: same.compactMap(\.pricesAsOf).max(),
                              plans: plan, planTotal: planTotal, apiValue: same.reduce(0) { $0 + ($1.apiValue ?? 0) }, apiBilled: same.reduce(0) { $0 + ($1.apiBilled ?? 0) },
                              unpriced: Unpriced(tokens: same.reduce(0) { $0 + ($1.unpriced?.tokens ?? 0) }, models: Array(Set(same.flatMap { $0.unpriced?.models ?? [] })).sorted()),
                              byKind: byKind, byModel: modelList, months: months.values.sorted { $0.month < $1.month })
        }
        let weeks = parts.compactMap(\.weekly).filter { $0.start != nil && $0.workingS != nil }
        if let start = weeks.compactMap(\.start).max() {
            let wk = weeks.filter { $0.start == start }
            var days: [String: Day] = [:]
            for w in wk { for d in w.days ?? [] {
                var o = days[d.date] ?? Day(date: d.date, workingS: 0, waitingS: 0)
                o.workingS = (o.workingS ?? 0) + (d.workingS ?? 0); o.waitingS = (o.waitingS ?? 0) + (d.waitingS ?? 0); days[d.date] = o
            } }
            let prev = wk.compactMap(\.previous)
            out.weekly = Weekly(start: start, end: wk.compactMap(\.end).max(), since: wk.compactMap(\.since).max(),
                                workingS: wk.reduce(0) { $0 + ($1.workingS ?? 0) }, waitingS: wk.reduce(0) { $0 + ($1.waitingS ?? 0) },
                                longestWait: wk.compactMap(\.longestWait).max { ($0.seconds ?? 0) < ($1.seconds ?? 0) },
                                previous: prev.isEmpty ? nil : Previous(workingS: prev.reduce(0) { $0 + ($1.workingS ?? 0) }, waitingS: prev.reduce(0) { $0 + ($1.waitingS ?? 0) },
                                                                        partial: prev.contains { $0.partial == true } || prev.count < wk.count),
                                days: days.values.sorted { $0.date < $1.date })
        }
        return out.value != nil || out.weekly != nil ? out : nil
    }
}

/// The look picked on this phone, kept apart from the layout ("reportsV1") so an older app that saves the layout
/// keeps it: the panel's shape, the share card's, the multiple's basis and whether the panel shows.
@Observable final class ReportPrefs: @unchecked Sendable {
    static let shapes = ["trip", "receipt", "big", "trend", "strip"]
    static let shared = ReportPrefs()
    private static let key = "reportsV1"
    var shape = "trip" { didSet { save() } }
    var share = "trend" { didSet { save() } }
    var basis = "month" { didSet { save() } }
    var hidden = false { didSet { save() } }
    private var loading = false
    init() {
        loading = true; defer { loading = false }
        guard let text = UserDefaults.standard.string(forKey: Self.key), let data = text.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        if let v = o["shape"] as? String, Self.shapes.contains(v) { shape = v }
        if let v = o["share"] as? String, Self.shapes.contains(v) { share = v }
        if let v = o["basis"] as? String, ["month", "prorated"].contains(v) { basis = v }
        hidden = o["hidden"] as? Bool == true
    }
    func reset() { shape = "trip"; share = "trend"; basis = "month"; hidden = false }
    private func save() {
        guard !loading, let data = try? JSONSerialization.data(withJSONObject: ["shape": shape, "share": share, "basis": basis, "hidden": hidden]),
              let text = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(text, forKey: Self.key)
    }
    static func name(_ shape: String) -> String {
        switch shape {
        case "receipt": L.t("Receipt", "영수증")
        case "big": L.t("Big multiple", "큰 배수")
        case "trend": L.t("Monthly trend", "월별 추이")
        case "strip": L.t("Strip", "요약 띠")
        default: L.t("Trip computer", "트립 컴퓨터")
        }
    }
}

/// What the panels draw, as reports.js computes it: the month against all of its subscriptions (month) or against the
/// share of them that has passed (prorated), and the week from Monday.
struct ReportFigures {
    struct KindRow: Identifiable { var kind: String; var api: Double; var plan: Double; var ratio: Double?; var id: String { kind } }
    struct MonthRow: Identifiable { var label: String; var api: Double; var plan: Double; var now = false; var id: String { label } }
    var label: String; var first: Double; var end: Double; var share: Double
    var api: Double; var plan: Double?; var cost: Double?; var ratio: Double?; var saved: Double?
    var kinds: [KindRow]; var models: [Reports.ModelValue]; var months: [MonthRow]; var proj: Double?
    var plans: Int; var unknown: Int; var billed: Double; var prices: String
    /// The value of tools whose plan price is unknown, left out of the figures above, and their names.
    var left: Double = 0; var leftKinds: [String] = []

    static func monthLabel(_ month: String?) -> String {
        let parts = (month ?? "").split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, let date = Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)) else { return "" }
        return date.formatted(.dateTime.month(.abbreviated).locale(L.locale))
    }
    init?(_ v: Reports.Value?, basis: String) {
        guard let v, v.apiValue != nil else { return nil }
        let parts = (v.month ?? "").split(separator: "-").compactMap { Int($0) }, cal = Calendar.current
        let firstDate = parts.count == 2 ? cal.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)) : nil
        let first = firstDate?.timeIntervalSince1970 ?? (v.start ?? 0)
        let next = firstDate.flatMap { cal.date(byAdding: .month, value: 1, to: $0) }?.timeIntervalSince1970
        let end = v.end ?? Date().timeIntervalSince1970
        let share = next.map { $0 > first ? min(1, (end - first) / ($0 - first)) : 1 } ?? 1
        // A tool with a plan whose price is unknown (a ChatGPT Pro tier, an API key) stays out of the value, the plans
        // and the multiple, so its tokens never count against too little (reports.js does the same).
        let unknownKinds = Set((v.plans ?? []).filter { $0.price == nil }.compactMap(\.kind))
        kinds = (v.byKind ?? []).compactMap { k in
            guard let a = k.apiValue else { return nil }
            let known = !unknownKinds.contains(k.kind) && (k.planTotal ?? 0) > 0
            let p = known ? (basis == "prorated" ? k.planTotal! * share : k.planTotal!) : nil
            return KindRow(kind: k.kind, api: a, plan: known ? k.planTotal! : 0, ratio: p.map { a / $0 })
        }
        let counted = kinds.filter { $0.ratio != nil }, known = counted.reduce(0) { $0 + $1.api }, planSum = counted.reduce(0) { $0 + $1.plan }
        let plan = planSum > 0 ? planSum : nil
        let cost = plan.map { basis == "prorated" ? $0 * share : $0 }
        label = Self.monthLabel(v.month); self.first = first; self.end = end; self.share = share
        self.api = known; self.plan = plan; self.cost = cost; ratio = cost.map { known / $0 }; saved = plan.map { known - $0 }
        let leftRows = kinds.filter { $0.ratio == nil && $0.api > 0 }
        left = leftRows.reduce(0) { $0 + $1.api }; leftKinds = leftRows.map(\.kind)
        models = (v.byModel ?? []).filter { m in m.apiValue != nil && counted.contains { $0.kind == m.kind } }.sorted { ($0.apiValue ?? 0) > ($1.apiValue ?? 0) }
        months = (v.months ?? []).suffix(5).compactMap { m in m.apiValue.map { MonthRow(label: Self.monthLabel(m.month), api: $0, plan: m.planTotal ?? 0) } }
        let elapsed = end - first
        proj = next.flatMap { elapsed >= 86400 ? known / elapsed * ($0 - first) : nil }
        plans = (v.plans ?? []).filter { $0.price != nil && !unknownKinds.contains($0.kind ?? "") }.count; unknown = (v.plans ?? []).filter { $0.source == "unknown" || $0.price == nil }.count
        billed = v.apiBilled ?? 0; prices = v.pricesAsOf ?? ""
    }
}

struct WeekFigures {
    struct DayRow: Identifiable { var label: String; var work: Double?; var wait: Double?; var id: String { label } }
    var start: Double; var work: Double; var wait: Double; var partial: Bool
    var prev: (work: Double, wait: Double)?; var longest: (label: String, kind: String, seconds: Double)?; var days: [DayRow]
    init?(_ w: Reports.Weekly?) {
        guard let w, let start = w.start, let work = w.workingS, let wait = w.waitingS else { return nil }
        self.start = start; self.work = work; self.wait = wait; partial = (w.since ?? start) > start
        prev = w.previous.flatMap { p in p.workingS.map { ($0, p.waitingS ?? 0) } }
        longest = w.longestWait.flatMap { l in l.seconds.map { (l.label ?? "", l.kind ?? "", $0) } }
        let cal = Calendar.current, format = DateFormatter(); format.dateFormat = "yyyy-MM-dd"; format.locale = Locale(identifier: "en_US_POSIX")
        days = (0..<7).map { i in
            let date = cal.date(byAdding: .day, value: i, to: Date(timeIntervalSince1970: start)) ?? Date(timeIntervalSince1970: start + Double(i) * 86400)
            let row = w.days?.first { $0.date == format.string(from: date) }
            return DayRow(label: date.formatted(.dateTime.weekday(.abbreviated).locale(L.locale)), work: row?.workingS, wait: row?.waitingS)
        }
    }
}

/// When a weekly limit runs out at the account's burn for the chosen period, as the cluster's range reads it.
struct Forecast {
    enum State { case idle, enough, empty }
    var state: State; var left: Double; var reset: Double?; var end: Double?; var hours: Double?; var early: Double?

    static func burn(_ q: Quota, period: Period) -> Double? {
        guard q.burnAllowed, !q.stale else { return nil }
        return q.weekly?[period.rawValue]?.burnPerHour
    }
    init?(_ q: Quota, period: Period, now: Double) {
        guard let w = q.windows.first(where: { $0.isWeekly }), let pct = w.pct, let rate = Self.burn(q, period: period) else { return nil }
        left = max(0, 100 - pct); reset = w.reset
        if rate == 0 { state = .idle; return }
        let end = now + left / rate * 3600; self.end = end
        if let reset, end >= reset { state = .enough } else { state = .empty; hours = left / rate; early = reset.map { $0 - end } }
    }
}

/// The sentences every account card adds, the same words as reports.js.
struct ForecastText {
    var forecast: Forecast; var main: String; var sub: String; var alt: String?; var fiveHour: String?
    var warn: Bool { forecast.state == .empty }

    static func when(_ t: Double, now: Double) -> String {
        let cal = Calendar.current, d = Date(timeIntervalSince1970: t), n = Date(timeIntervalSince1970: now)
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: n), to: cal.startOfDay(for: d)).day ?? 0
        let day = days == 0 ? L.t("Today", "오늘") : days == 1 ? L.t("Tomorrow", "내일")
            : days < 7 ? d.formatted(.dateTime.weekday(.wide).locale(L.locale)) : d.formatted(.dateTime.month(.abbreviated).day().locale(L.locale))
        let time = d.formatted(.dateTime.hour().minute().locale(L.locale))
        // English reads "runs out today at 3:00 PM", as the dashboard says it.
        return L.language == .en ? "\(days < 2 ? day.lowercased() : day) at \(time)" : day + " " + time
    }
    static func hoursShort(_ s: Double) -> String { s >= 3600 ? L.t("\(Int((s / 3600).rounded()))h", "\(Int((s / 3600).rounded()))시간") : L.t("\(max(1, Int((s / 60).rounded())))m", "\(max(1, Int((s / 60).rounded())))분") }
    static func duration(_ s: Double) -> String {
        let m = max(0, Int((s / 60).rounded())), h = m / 60, r = m % 60
        if h > 0 && r > 0 { return L.t("\(h)h \(r)m", "\(h)시간 \(r)분") }
        return h > 0 ? L.t("\(h)h", "\(h)시간") : L.t("\(r)m", "\(r)분")
    }
    init?(_ q: Quota, quotas: [Quota], period: Period, now: Double, name: (Quota) -> String) {
        guard let f = Forecast(q, period: period, now: now) else { return nil }
        forecast = f
        switch f.state {
        case .empty:
            main = L.t("At this pace it runs out \(Self.when(f.end ?? now, now: now))", "이 속도면 \(Self.when(f.end ?? now, now: now))에 바닥납니다")
            sub = f.early.map { L.t("\(Self.hoursShort($0)) before the reset", "초기화보다 \(Self.hoursShort($0)) 빠릅니다") } ?? ""
            let others = quotas.filter { $0.kind == q.kind && $0.id != q.id && !$0.stale }.compactMap { o in Forecast(o, period: period, now: now).map { (o, $0) } }.filter { $0.1.state != .empty }
            if let best = others.max(by: { $0.1.left < $1.1.left }) {
                alt = L.t("\(name(best.0)) has \(Int(best.1.left.rounded()))% left and lasts to its reset", "\(name(best.0)) 계정은 \(Int(best.1.left.rounded()))% 남아 초기화까지 넉넉합니다")
            }
        case .enough:
            main = L.t("It lasts to the reset", "초기화 전에 바닥나지 않습니다")
            sub = f.reset.map { Format.reset($0) + " · " + L.t("\(Int(f.left.rounded()))% left", "\(Int(f.left.rounded()))% 남음") } ?? ""
        case .idle:
            main = L.t("Not in use now", "지금은 쓰지 않고 있습니다"); sub = ""
        }
        if let w = q.windows.first(where: { $0.scope != "mcp" && $0.periodKey == "5h" }), let pct = w.pct, let reset = w.reset, pct >= 80, reset - now > 0, reset - now <= 3600 {
            fiveHour = L.t("The 5-hour limit resets in \(Self.duration(reset - now)) (\(Int(pct.rounded()))% used). Start big work after that.",
                           "5시간 한도가 \(Self.duration(reset - now)) 뒤 초기화됩니다(\(Int(pct.rounded()))% 사용). 큰 작업은 그 뒤에 시작하세요.")
        }
    }
}

enum ReportFormat {
    static func money(_ v: Double?) -> String {
        guard let v, v.isFinite else { return "—" }
        return v >= 100 ? "$" + Int(v.rounded()).formatted(.number.locale(Locale(identifier: "en_US"))) : "$" + String(format: "%.2f", v)
    }
    static func times(_ r: Double?) -> String {
        guard let r, r.isFinite, r >= 0 else { return "—" }
        return r < 99.95 ? String(format: "%.1f", r) : String(Int(r.rounded()))
    }
}
