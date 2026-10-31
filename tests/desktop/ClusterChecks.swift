import Foundation
// The menu bar's cluster reads the same numbers as the dashboard's (cluster.js) from the same /api/state.
// node tests/cluster-fixture.mjs <folder> writes the demo state and the dashboard's readings; this checks them.
@main struct ClusterChecks {
    struct Cases: Decodable { var now: Double; var cases: [Case] }
    struct Case: Decodable { var period: String; var pick: String?; var state: String; var expected: Expected }
    struct Expected: Decodable {
        struct Tach: Decodable { var rate: Double?; var max: Double; var tokens: Double?; var instant: Double?; var now: Double?; var live: Bool; var tpmMax: Double }
        struct Speed: Decodable { var value: Double?; var live: Double?; var recent: Double?; var cruise: Double?; var max: Double; var account: String?; var picked: Bool }
        struct Account: Decodable { var id: String; var pct: Double?; var left: Double?; var burn: Double?; var live: Double?; var reconnect: Bool; var range: String? }
        struct Tells: Decodable {
            var kinds: [[Value]]; var waiting: [String]; var reconnect: [String]; var empty: [String]
            var context: [String]; var stalled: [String]; var fresh: Bool
        }
        enum Value: Decodable {
            case text(String), count(Int)
            init(from decoder: Decoder) throws {
                let c = try decoder.singleValueContainer()
                if let n = try? c.decode(Int.self) { self = .count(n) } else { self = .text(try c.decode(String.self)) }
            }
        }
        struct Trip: Decodable { var tokens: Double?; var rate: Double?; var inRange: Bool; var accounts: [[Leg]] }
        enum Leg: Decodable {
            case id(String), used(Double?)
            init(from decoder: Decoder) throws {
                let c = try decoder.singleValueContainer()
                if let s = try? c.decode(String.self) { self = .id(s) } else { self = .used(try? c.decode(Double.self)) }
            }
        }
        var tach: Tach; var speed: Speed; var accounts: [Account]; var tells: Tells; var heat: Double?; var trip: Trip?
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
            let r = ClusterReadings(snapshot: snapshot, sessions: sessions, period: c.period, now: all.now, pick: c.pick, trip: all.now - 10800)
            let e = c.expected, tag = "\(c.period) pick \(c.pick ?? "none")"
            same(r.tach.rate, e.tach.rate, "\(tag) token speed"); same(r.tach.max, e.tach.max, "\(tag) tachometer scale")
            same(r.tach.tokens, e.tach.tokens, "\(tag) odometer"); same(r.tach.instant, e.tach.instant, "\(tag) last minute")
            same(r.tach.now, e.tach.now, "\(tag) tachometer reading"); same(r.tach.tpmMax, e.tach.tpmMax, "\(tag) tachometer scale per minute")
            precondition(r.tach.live == e.tach.live, "\(tag) tachometer reads the last minute")
            same(r.speed.live, e.speed.live, "\(tag) live burn")
            same(r.speed.value, e.speed.value, "\(tag) burn"); same(r.speed.recent, e.speed.recent, "\(tag) last ten minutes")
            same(r.speed.cruise, e.speed.cruise, "\(tag) cruise"); same(r.speed.max, e.speed.max, "\(tag) speedometer scale")
            precondition(r.speed.account == e.speed.account && r.speed.picked == e.speed.picked, "\(tag) speedometer subject")
            precondition(r.accounts.map(\.id) == e.accounts.map(\.id), "\(tag) fuel accounts")
            for (a, x) in zip(r.accounts, e.accounts) {
                same(a.pct, x.pct, "\(tag) \(a.id) used"); same(a.left, x.left, "\(tag) \(a.id) left"); same(a.burn, x.burn, "\(tag) \(a.id) burn"); same(a.live, x.live, "\(tag) \(a.id) live burn")
                precondition(a.reconnect == x.reconnect, "\(tag) \(a.id) reconnect")
                let range = a.range.map { $0.state == .idle ? "idle" : $0.state == .enough ? "enough" : "empty" }
                precondition(range == x.range, "\(tag) \(a.id) range \(String(describing: range)) ≠ \(String(describing: x.range))")
            }
            let kinds = e.tells.kinds.map { pair -> String in pair.map { if case .text(let t) = $0 { t } else if case .count(let n) = $0 { String(n) } else { "" } }.joined(separator: ":") }
            precondition(r.tells.kinds.map { "\($0.kind):\($0.working)" } == kinds, "\(tag) working tools")
            precondition(r.tells.waiting == e.tells.waiting && r.tells.reconnect == e.tells.reconnect && r.tells.empty == e.tells.empty, "\(tag) warning lights")
            precondition(r.tells.context == e.tells.context && r.tells.stalled == e.tells.stalled && r.tells.fresh == e.tells.fresh, "\(tag) warning lights")
            same(r.heat.value, e.heat, "\(tag) load")
            same(r.trip?.tokens, e.trip?.tokens, "\(tag) trip"); same(r.trip?.rate, e.trip?.rate, "\(tag) trip average")
            precondition(r.trip?.inRange == e.trip?.inRange, "\(tag) trip range")
            let legs = e.trip?.accounts ?? []
            precondition(r.trip?.accounts.count == legs.count, "\(tag) trip accounts")
            for (leg, x) in zip(r.trip?.accounts ?? [], legs) {
                guard x.count == 2, case .id(let id) = x[0], case .used(let used) = x[1] else { fatalError("\(tag) trip leg") }
                precondition(leg.id == id, "\(tag) trip leg order"); same(leg.used, used, "\(tag) \(id) weekly % since the trip began")
            }
        }
        // Scales: four or more major steps, five minor steps each.
        for (max, major, minor) in [(2e8, 5e7, 1e7), (1e8, 2.5e7, 5e6), (5e7, 1e7, 2e6), (2.0, 0.5, 0.1)] {
            precondition(ClusterReadings.marks(max) == .init(max: max, major: major, minor: minor), "marks \(max)")
        }
        precondition(ClusterReadings.reading(1.4253) == "1.43" && ClusterReadings.reading(108.2) == "108" && ClusterReadings.reading(nil) == "—")
        print("Cluster checks passed: \(all.cases.count) cases")
    }
}
