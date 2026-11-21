import Foundation

/// The cluster's look (customizing): the 1top instruments or one of the 72 themes the dashboard draws
/// (agent/onetop/dist/themes, ThemeHost.html). Kept apart from the layout under its own key, as the dashboard keeps it
/// (cluster-themes.js, onetop.clusterTheme.v1), so an older app that saves the layout keeps it.
@Observable final class ClusterThemePrefs: @unchecked Sendable {
    static let shared = ClusterThemePrefs()
    private static let key = "clusterThemeV1"
    /// "01" … "72", or nil for the 1top instruments.
    var theme: String? { didSet { UserDefaults.standard.set(theme, forKey: Self.key) } }
    init() { theme = Self.valid(UserDefaults.standard.string(forKey: Self.key)) }
    static func valid(_ id: String?) -> String? { id.flatMap { $0.count == 2 && $0.allSatisfy(\.isNumber) ? $0 : nil } }
    /// Each theme's kind (아날로그, 디지털, 혼합) for the gallery's narrowing, from the dashboard's catalog, and its name.
    static let kinds: [String: String] = table("ThemeKinds"), names: [String: String] = table("ThemeNames")
    /// Width over height of each theme's two headline instruments cut out (themes/compact.js), and the most they stand.
    static let compact: [String: Double] = table("ThemeCompact"), compactTall = 240.0
    private static func table<V: Decodable>(_ name: String) -> [String: V] {
        guard let url = Bundle.main.url(forResource: name, withExtension: "json"), let data = try? Data(contentsOf: url) else { return [:] }
        return (try? JSONDecoder().decode([String: V].self, from: data)) ?? [:]
    }
    /// The look's name as the customizing list shows it.
    static func name(_ id: String?) -> String { id.map { "\($0) · \(names[$0] ?? "")" } ?? L.t("1top default", "1top 기본") }
}

/// The cluster's readings as the themes read them, the same figures cluster-themes.js figures() hands them on the
/// dashboard: the scales the dials run to, the subject picked, the busiest computer, the trip and the four warnings,
/// the window's sessions and the period's flow.
enum ClusterThemeFigures {
    static let gears = Period.allCases.map(\.rawValue)
    private static let short = ["Claude": "Claude", "Codex": "Codex", "Antigravity": "Agy", "GLM": "GLM"]
    static func tokens(_ n: Double) -> String {
        n >= 1e9 ? String(format: "%.1fB", n / 1e9) : n >= 1e6 ? String(format: "%.1fM", n / 1e6) : n >= 1e3 ? "\(Int((n / 1e3).rounded()))K" : "\(Int(n.rounded()))"
    }
    static func make(_ r: ClusterReadings, period: Period, now: Double, odometer: Double) -> [String: Any] {
        let ok = ClusterReadings.valid
        let fuel: [[String: Any]] = r.accounts.compactMap { a in
            guard let left = a.left, left.isFinite else { return nil }
            return ["name": short[a.kind] ?? a.kind, "plan": a.plan ?? "", "left": left, "burn": ok(a.burn) ? a.burn! : 0]
        }
        let lefts = fuel.compactMap { $0["left"] as? Double }
        var counts = ["working": 0, "waiting": 0, "idle": 0]
        for row in r.rows { counts[row.state == "working" || row.state == "waiting" ? row.state : "idle", default: 0] += 1 }
        let cpu = r.heat.cpu ?? 0, mem = r.heat.memory ?? 0
        let reach = r.speed.reach
        let clock = Date(timeIntervalSince1970: now).formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(Locale(identifier: "ko_KR")))
        return [
            "period": period.rawValue, "gears": gears,
            "rate": ok(r.tach.rate) ? r.tach.rate! : 0, "rateMax": r.tach.full, "tokens": r.tach.tokens ?? 0,
            "burn": ok(r.speed.value) ? r.speed.value! : 0, "burnMax": r.speed.max, "cruise": ok(r.speed.cruise) ? r.speed.cruise! as Any : NSNull(),
            "heat": max(cpu, mem), "cpu": cpu, "mem": mem,
            "fuel": fuel, "fuelLeft": lefts.isEmpty ? 0 : (lefts.reduce(0, +) / Double(lefts.count)).rounded(), "minLeft": lefts.min() ?? 0,
            "rangeH": reach.state == .hours && ok(reach.hours) ? min(99, reach.hours!) as Any : NSNull(),
            "odo": odometer, "trip": ok(r.trip?.tokens) ? r.trip!.tokens! : 0,
            "sessions": ["working": counts["working"]!, "waiting": counts["waiting"]!, "idle": counts["idle"]!, "total": r.rows.count],
            "list": r.rows.prefix(7).map { row -> [String: Any] in
                ["name": row.group.root.name, "state": row.state == "working" || row.state == "waiting" ? row.state : "idle", "tok": tokens(row.tokens), "tokens": row.tokens]
            },
            "flow": r.flow,
            "lamps": ["waiting": r.tells.waiting.count, "reconnect": r.tells.reconnect.count, "empty": r.tells.empty.count, "late": r.tells.fresh ? 0 : 1],
            "clock": clock, "temp": "",
        ]
    }
    static func json(_ figures: [String: Any]) -> String {
        (try? JSONSerialization.data(withJSONObject: figures)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
}
