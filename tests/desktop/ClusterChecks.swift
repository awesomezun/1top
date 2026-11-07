import Foundation
// The menu bar's cluster reads the same numbers as the dashboard's (cluster.js) from the same /api/state.
// node tests/cluster-fixture.mjs <folder> writes the demo state and the dashboard's readings; this checks them.
@main struct ClusterChecks {
    struct Cases: Decodable { var now: Double; var cases: [Case] }
    struct Pick: Decodable { var type: String; var id: String }
    struct Case: Decodable { var period: String; var pick: Pick?; var only: String?; var state: String; var expected: Expected }
    struct Expected: Decodable {
        struct Tach: Decodable { var rate: Double?; var max: Double; var full: Double; var tokens: Double?; var instant: Double? }
        struct Reach: Decodable { var state: String; var hours: Double?; var early: Bool; var account: String? }
        struct Speed: Decodable {
            var value: Double?; var cruise: Double?; var max: Double; var subject: String?; var subjectAccount: String?; var count: Int
            var picked: Bool; var account: String?; var session: String?; var multi: [[Value]]; var reach: Reach
        }
        struct Account: Decodable {
            var id: String; var pct: Double?; var left: Double?; var burn: Double?; var added: Double?
            var reconnect: Bool; var weekly: Bool; var range: String?
        }
        struct Tells: Decodable {
            var kinds: [[Value]]; var waiting: [String]; var reconnect: [String]; var empty: [String]; var done: [String]
            var context: [String]; var stalled: [String]; var fresh: Bool
        }
        /// A pair's text or number ([id, value], [kind, count], [id, used]); null reads as a missing number.
        enum Value: Decodable {
            case text(String), number(Double?)
            init(from decoder: Decoder) throws {
                let c = try decoder.singleValueContainer()
                if let s = try? c.decode(String.self) { self = .text(s) } else { self = .number(try? c.decode(Double.self)) }
            }
            var text: String? { if case .text(let t) = self { t } else { nil } }
            var number: Double? { if case .number(let n) = self { n } else { nil } }
        }
        struct Trip: Decodable { var tokens: Double?; var rate: Double?; var inRange: Bool; var accounts: [[Value]] }
        var tach: Tach; var speed: Speed; var accounts: [Account]; var sessions: [[Value]]; var working: Int
        var tells: Tells; var heat: Double?; var trip: Trip?
    }
    static func same(_ a: Double?, _ b: Double?, _ what: String) {
        switch (a, b) {
        case (nil, nil): return
        case let (x?, y?) where abs(x - y) <= max(1e-9, abs(y) * 1e-9): return
        default: fatalError("\(what): menu bar \(String(describing: a)) ≠ dashboard \(String(describing: b))")
        }
    }
    static func main() throws {
        guard CommandLine.arguments.count > 1 else { fatalError("usage: cluster-checks <folder from tests/cluster-fixture.mjs>") }
        let dir = URL(fileURLWithPath: CommandLine.arguments[1])
        let all = try JSONDecoder().decode(Cases.self, from: Data(contentsOf: dir.appendingPathComponent("cases.json")))
        for c in all.cases {
            let snapshot = try JSONDecoder().decode(DesktopSnapshot.self, from: Data(contentsOf: dir.appendingPathComponent(c.state)))
            let sessions = snapshot.root_sessions ?? snapshot.sessions ?? []
            let pick: ClusterReadings.Pick? = c.pick.map { $0.type == "session" ? .session($0.id) : .account($0.id) }
            let r = ClusterReadings(snapshot: snapshot, sessions: sessions, period: c.period, now: all.now, pick: pick, only: c.only, trip: all.now - 10800)
            let e = c.expected, tag = "\(c.period) pick \(c.pick.map { "\($0.type) \($0.id)" } ?? "none") only \(c.only ?? "all")"
            same(r.tach.rate, e.tach.rate, "\(tag) token speed"); same(r.tach.max, e.tach.max, "\(tag) tachometer scale")
            same(r.tach.full, e.tach.full, "\(tag) tachometer full scale")
            same(r.tach.tokens, e.tach.tokens, "\(tag) odometer"); same(r.tach.instant, e.tach.instant, "\(tag) last minute")
            same(r.speed.value, e.speed.value, "\(tag) burn"); same(r.speed.cruise, e.speed.cruise, "\(tag) cruise")
            same(r.speed.max, e.speed.max, "\(tag) speedometer scale")
            precondition(r.speed.subject?.type.rawValue == e.speed.subject && r.speed.subject?.account == e.speed.subjectAccount
                         && (r.speed.subject?.count ?? 0) == e.speed.count, "\(tag) speedometer subject")
            precondition(r.speed.account == e.speed.account && r.speed.session == e.speed.session && r.speed.picked == e.speed.picked, "\(tag) speedometer pick")
            let multi = r.speed.multi ?? []
            precondition(multi.map(\.id) == e.speed.multi.map { $0.first?.text ?? "" }, "\(tag) rim marks")
            for (m, x) in zip(multi, e.speed.multi) { same(m.value, x.last?.number, "\(tag) \(m.id) rim mark") }
            precondition(r.speed.reach.state.rawValue == e.speed.reach.state && r.speed.reach.early == e.speed.reach.early
                         && r.speed.reach.account == e.speed.reach.account, "\(tag) range \(r.speed.reach) ≠ \(e.speed.reach)")
            same(r.speed.reach.hours, e.speed.reach.hours, "\(tag) hours of work left")
            precondition(r.accounts.map(\.id) == e.accounts.map(\.id), "\(tag) fuel accounts")
            for (a, x) in zip(r.accounts, e.accounts) {
                same(a.pct, x.pct, "\(tag) \(a.id) used"); same(a.left, x.left, "\(tag) \(a.id) left")
                same(a.burn, x.burn, "\(tag) \(a.id) burn"); same(a.added, x.added, "\(tag) \(a.id) added")
                precondition(a.reconnect == x.reconnect && a.weekly == x.weekly, "\(tag) \(a.id) reconnect or weekly")
                let range = a.range.map { $0.state == .idle ? "idle" : $0.state == .enough ? "enough" : "empty" }
                precondition(range == x.range, "\(tag) \(a.id) range \(String(describing: range)) ≠ \(String(describing: x.range))")
            }
            precondition(r.sessions.map(\.id) == e.sessions.map { $0.first?.text ?? "" }, "\(tag) session order \(r.sessions.map(\.id))")
            for (s, x) in zip(r.sessions, e.sessions) { same(s.burn, x.last?.number, "\(tag) \(s.id) burn") }
            precondition(r.working == e.working, "\(tag) working sessions")
            let kinds = e.tells.kinds.map { "\($0.first?.text ?? ""):\(Int($0.last?.number ?? -1))" }
            precondition(r.tells.kinds.map { "\($0.kind):\($0.working)" } == kinds, "\(tag) working tools")
            precondition(r.tells.waiting == e.tells.waiting && r.tells.reconnect == e.tells.reconnect && r.tells.empty == e.tells.empty
                         && r.tells.done == e.tells.done, "\(tag) warning lights")
            precondition(r.tells.context == e.tells.context && r.tells.stalled == e.tells.stalled && r.tells.fresh == e.tells.fresh, "\(tag) warning lights")
            same(r.heat.value, e.heat, "\(tag) load")
            same(r.trip?.tokens, e.trip?.tokens, "\(tag) trip"); same(r.trip?.rate, e.trip?.rate, "\(tag) trip average")
            precondition(r.trip?.inRange == e.trip?.inRange, "\(tag) trip range")
            let legs = e.trip?.accounts ?? []
            precondition(r.trip?.accounts.count == legs.count, "\(tag) trip accounts")
            for (leg, x) in zip(r.trip?.accounts ?? [], legs) {
                guard x.count == 2, let id = x[0].text else { fatalError("\(tag) trip leg") }
                precondition(leg.id == id, "\(tag) trip leg order"); same(leg.used, x[1].number, "\(tag) \(id) weekly % since the trip began")
            }
        }
        // The dials' scales hold within a period: a smaller reading never shrinks them, a new period starts over.
        let hold = ClusterReadings.Hold()
        let first = try JSONDecoder().decode(DesktopSnapshot.self, from: Data(contentsOf: dir.appendingPathComponent(all.cases[0].state)))
        _ = ClusterReadings(snapshot: first, sessions: first.root_sessions ?? [], period: all.cases[0].period, now: all.now, hold: hold)
        hold.full = 5e8; hold.smax = 20
        let held = ClusterReadings(snapshot: first, sessions: first.root_sessions ?? [], period: all.cases[0].period, now: all.now, hold: hold)
        precondition(held.tach.full == 5e8 && held.speed.max == 20, "scales hold within a period")
        let fresh = ClusterReadings(snapshot: first, sessions: first.root_sessions ?? [], period: "other", now: all.now, hold: hold)
        precondition(fresh.tach.full == 2e8 && fresh.speed.max < 20, "a new period starts the scales over")
        // The token dial: 200M in every period, past it 100M steps numbered at most six times with the full scale
        // marked; fever levels at 300M, 400M and 500M and above.
        for (full, major) in [(3e8, 100.0), (4e8, 100), (5e8, 100), (6e8, 100), (7e8, 200)] {
            precondition(ClusterReadings.tachMarks(full, div: 1e6) == .init(max: full / 1e6, major: major, minor: major / 5), "tach marks \(full)")
        }
        precondition(ClusterReadings.tachMarks(2e8, div: 1e6) == ClusterReadings.marks(200), "tach marks at the limit")
        for (full, level) in [(2e8, 0), (3e8, 1), (4e8, 2), (5e8, 3), (7e8, 3)] { precondition(ClusterReadings.feverLevel(full) == level, "fever \(full)") }
        // The burn dial: 2, 5, 10, 20, past 20%/h steps of 20 numbered at most six times; levels at 40, 60, 80 and above.
        for (top, max) in [(0.5, 2.0), (3, 5), (15, 20), (20, 20), (25, 40), (45, 60), (61, 80), (85, 100)] {
            precondition(ClusterReadings.burnMax(top) == max, "burn max \(top)")
        }
        for (max, major) in [(40.0, 10.0), (60, 10), (80, 20), (100, 20), (120, 20), (140, 50)] {
            precondition(ClusterReadings.burnMarks(max) == .init(max: max, major: major, minor: major / 5), "burn marks \(max)")
        }
        precondition(ClusterReadings.burnMarks(20) == ClusterReadings.marks(20) && ClusterReadings.burnMarks(2) == ClusterReadings.marks(2), "burn marks at the limit")
        for (max, level) in [(2.0, 0), (20, 0), (40, 1), (60, 2), (80, 3), (100, 3)] { precondition(ClusterReadings.burnLevel(max) == level, "burn level \(max)") }
        // Scales: four or more major steps, five minor steps each.
        for (max, major, minor) in [(2e8, 5e7, 1e7), (1e8, 2.5e7, 5e6), (5e7, 1e7, 2e6), (2.0, 0.5, 0.1)] {
            precondition(ClusterReadings.marks(max) == .init(max: max, major: major, minor: minor), "marks \(max)")
        }
        precondition(ClusterReadings.reading(1.4253) == "1.43" && ClusterReadings.reading(108.2) == "108" && ClusterReadings.reading(nil) == "—")
        print("Cluster checks passed: \(all.cases.count) cases")
    }
}
