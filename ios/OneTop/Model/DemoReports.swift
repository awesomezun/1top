import Foundation

/// Each demo computer's reports, as site/src/demo-reports.js makes them for the web demo and the Android app: this
/// month's API value grows with the demo clock at the pace of the computer's sessions and models, its plans are the
/// demo accounts it works with, and the week counts the demo's agent hours, Monday first, local time.
enum DemoReports {
    static let rate: [String: Double] = ["claude-opus-5-5": 0.074, "claude-sonnet-5-5": 0.037, "claude-haiku-5-5": 0.004, "claude-fable-5-1": 0.16,
                                         "gpt-6.1-sol": 0.036, "gpt-6-astra": 0.16, "glm-5.3": 0.012, "gemini-3.5-pro": 0.03]
    static let plans: [String: (plan: String, label: String, price: Double?, source: String)] = [
        "dev": ("max", "Claude Max", 100, "detected"), "studio": ("pro", "Claude Pro", 20, "detected"), "ops": ("pro", "ChatGPT Pro", 200, "user"),
        "ml": ("plus", "ChatGPT Plus", 20, "detected"), "gemini": ("", "Agy Gemini", nil, "unknown"), "glm": ("pro", "GLM Pro", nil, "unknown")]
    static let hours: [(work: Double, wait: Double)] = [(6.8, 0.9), (2.9, 0.35), (3.6, 0.4)]
    static let past: [Double] = [0.45, 0.6, 0.75, 0.85, 0.95]
    static func round(_ n: Double, _ d: Double = 2) -> Double { (n * pow(10, d)).rounded() / pow(10, d) }
    static func base(_ m: String?) -> String { (m ?? "").replacingOccurrences(of: #"\[.*\]$"#, with: "", options: .regularExpression) }
    private static func ymd(_ d: Date) -> String { let c = Calendar.current.dateComponents([.year, .month, .day], from: d); return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!) }
    private static func monthKey(_ d: Date) -> String { let c = Calendar.current.dateComponents([.year, .month], from: d); return String(format: "%04d-%02d", c.year!, c.month!) }

    static func make(_ c: Int, now: Double) -> Reports {
        struct Row { var kind: String; var account: String?; var model: String; var weight: Double }
        // Aside bills through its own key, not a subscription here, so it stays out of the month's value.
        let rows = (DemoWorld.sessions.filter { $0.computer == c }.map { Row(kind: $0.kind, account: $0.account, model: base($0.model), weight: $0.weight) }
                    + DemoWorld.earlier.filter { $0.computer == c }.map { Row(kind: $0.kind, account: $0.account, model: base($0.model), weight: $0.weight) })
            .filter { rate[$0.model] != nil && $0.kind != "Aside" }
        let cal = Calendar.current, d = Date(timeIntervalSince1970: now)
        let firstDate = cal.date(from: cal.dateComponents([.year, .month], from: d))!, first = firstDate.timeIntervalSince1970
        var pace: [String: Double] = [:], order: [String] = []
        for r in rows { let k = r.model + "|" + r.kind; if pace[k] == nil { order.append(k) }; pace[k, default: 0] += r.weight * rate[r.model]! }
        let hoursIn = (now - first) / 3600
        let byModel = order.map { k -> Reports.ModelValue in
            let p = k.split(separator: "|").map(String.init); return Reports.ModelValue(model: p[0], kind: p[1], apiValue: round(pace[k]! * hoursIn * 0.35))
        }.sorted { ($0.apiValue ?? 0) > ($1.apiValue ?? 0) }
        var keys: [String] = []; for r in rows { if let a = r.account, plans[a] != nil, !keys.contains(a) { keys.append(a) } }
        let planRows = keys.compactMap { k -> Reports.Plan? in
            guard let a = DemoWorld.accounts.first(where: { $0.key == k }), let p = plans[k] else { return nil }
            return Reports.Plan(accountId: a.id, kind: a.kind, plan: p.plan, label: p.label, price: p.price, source: p.source)
        }
        let planTotal = planRows.reduce(0) { $0 + ($1.price ?? 0) }, apiValue = round(byModel.reduce(0) { $0 + ($1.apiValue ?? 0) })
        var kinds: [String] = []; for m in byModel where !kinds.contains(m.kind ?? "") { kinds.append(m.kind ?? "") }
        let byKind = kinds.map { kind -> Reports.Kind in
            let v = round(byModel.filter { $0.kind == kind }.reduce(0) { $0 + ($1.apiValue ?? 0) }), p = planRows.filter { $0.kind == kind }.reduce(0) { $0 + ($1.price ?? 0) }
            return Reports.Kind(kind: kind, apiValue: v, planTotal: p, ratio: p > 0 ? round(v / p, 3) : nil)
        }
        // The past months count the tools the multiple counts: those whose plans all have a price.
        let unknownKinds = Set(planRows.filter { $0.price == nil }.compactMap(\.kind))
        let perMonth = pace.filter { !unknownKinds.contains(String($0.key.split(separator: "|")[1])) }.values.reduce(0, +) * 24 * 30 * 0.35
        let knownPlan = planRows.filter { !unknownKinds.contains($0.kind ?? "") }.reduce(0) { $0 + ($1.price ?? 0) }
        let months = past.enumerated().map { i, f in
            Reports.Month(month: monthKey(cal.date(byAdding: .month, value: -past.count + i, to: firstDate)!), apiValue: round(perMonth * f), planTotal: knownPlan)
        }
        // The week from Monday 0:00: whole days at the computer's hours, today by the share of it gone.
        let weekday = (cal.component(.weekday, from: d) + 5) % 7, monday = cal.date(byAdding: .day, value: -weekday, to: cal.startOfDay(for: d))!
        let start = monday.timeIntervalSince1970, (w, q) = c < hours.count ? hours[c] : (0, 0)
        var days: [Reports.Day] = []
        for i in 0..<7 {
            let day = cal.date(byAdding: .day, value: i, to: monday)!, t = day.timeIntervalSince1970
            if t > now { break }
            let part = min(1, (now - t) / 86400), wave = 1 + 0.12 * sin(Double(i) * 1.7 + Double(c))
            days.append(Reports.Day(date: ymd(day), workingS: (w * 3600 * part * wave).rounded(), waitingS: (q * 3600 * part * (2 - wave)).rounded()))
        }
        let working = days.reduce(0) { $0 + ($1.workingS ?? 0) }, waiting = days.reduce(0) { $0 + ($1.waitingS ?? 0) }
        let waitingSession = DemoWorld.sessions.first { $0.computer == c && $0.status == "waiting" }
        return Reports(version: 1, asOf: now,
                       value: Reports.Value(month: monthKey(firstDate), start: first, end: now, pricesAsOf: "2026-11-07", plans: planRows, planTotal: planTotal, apiValue: apiValue, apiBilled: 0,
                                            unpriced: Reports.Unpriced(tokens: 0, models: []), byKind: byKind, byModel: byModel, months: months),
                       weekly: Reports.Weekly(start: start, end: start + 7 * 86400, since: start - 30 * 86400, workingS: working, waitingS: waiting,
                                              longestWait: waitingSession.map { Reports.Wait(sessionId: $0.id, label: $0.project, kind: $0.kind, seconds: (q * 3600 * 0.35).rounded()) },
                                              previous: Reports.Previous(workingS: (working * 0.86).rounded(), waitingS: (waiting * 1.35).rounded(), partial: false), days: days))
    }
}
