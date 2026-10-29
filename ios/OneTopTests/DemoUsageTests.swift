import XCTest
@testable import OneTop

/// The demo's token use gives the same numbers as the web (tests/demo-usage.mjs) and Android
/// (mobile/test/parity.test.mjs), and it is uneven the way real use is.
final class DemoUsageTests: XCTestCase {
    func testSharedCheckValues() {
        let checks: [(UInt32, Int, Int)] = [(7, 0, 0), (7, 29_880_000, 5), (1_234_567, 123, 456), (42, 99, 100)]
        XCTAssertEqual(checks.map { DemoUsage.unit($0.0, $0.1, $0.2) }, [0.638385457219556, 0.416402937611565, 0.8966296215076, 0.9844421946909279])
        let now = 1_800_000_000.5
        let u = DemoUsage.usage(23, 1.2e6, [.init(weight: 52, start: 0, stop: .infinity), .init(weight: 12, start: 0, stop: now - 3000)], now: now, anchor: now - 600)
        XCTAssertEqual([DemoUsage.since(u, 0, now - 3600), DemoUsage.since(u, 1, now - 86400), DemoUsage.since(u, 0, now - 600)].map { $0.rounded() },
                       [92_181_344, 292_954_505, 8_620_266])
        // Resting with another computer, working less often, and no waking hour around the start.
        let quiet = DemoUsage.usage(23, 1.2e6, [.init(weight: 52, start: 0, stop: .infinity), .init(weight: 12, start: 0, stop: now - 3000)],
                                    now: now, anchor: now - 600, rest: 7, duty: 0.4, awake: false)
        XCTAssertEqual([DemoUsage.since(quiet, 0, now - 86400), DemoUsage.since(quiet, 1, now - 86400)].map { $0.rounded() }, [513_711_382, 161_355_472])
        let bins = DemoUsage.bins(u, ["Claude", "Codex"], now: now, seconds: 3600, step: 300).bins.suffix(4)
        XCTAssertEqual(Array(bins), [["Claude": 1_511_996], ["Claude": 1_823_151], ["Claude": 7_315_948], ["Claude": 3_781]])
        XCTAssertEqual(DemoUsage.since(u, 1, now - 3000), 0)
    }

    func testDemoIsUneven() {
        let now = 1_800_000_000.0
        let u = DemoUsage.usage(23, 1.2e6, [.init(weight: 1, start: 0, stop: .infinity)], now: now, anchor: now)
        let totals = DemoUsage.bins(u, ["Claude"], now: now, seconds: 86400, step: 900).bins.map { $0["Claude"] ?? 0 }
        let busy = totals.filter { $0 > 0 }.sorted()
        XCTAssertLessThan(busy.count, totals.count, "some quarter hours rest")
        XCTAssertGreaterThan(busy.last ?? 0, busy[busy.count / 2] * 2.5, "the busiest quarter hour is well above the middle one")
    }

    func testDemoDevicesFollowTheRows() {
        let sessions = DemoData.devices(now: Date().timeIntervalSince1970).flatMap { $0.snapshot?.sessions ?? [] }
        XCTAssertEqual(sessions.map(\.id), DemoData.rows.map(\.id))
        let day = Dictionary(grouping: sessions, by: \.kind).mapValues { $0.reduce(0) { $0 + (($1.windows?["24h"] ?? nil)?.reduce(0, +) ?? 0) } }
        let all = day.values.reduce(0, +)
        XCTAssertGreaterThan((day["Claude"] ?? 0) / all, 0.6)
    }
}
