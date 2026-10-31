import XCTest
@testable import OneTop

/// The cluster on the Dashboard tab reads what the dashboard's cluster (cluster.js) reads: one account's burn on
/// the speedometer, never a sum; every account's weekly limit left; the warning lights; the token speed.
@MainActor final class ClusterTests: XCTestCase {
    func testDemoReadings() throws {
        let model = AppModel()
        model.showDemo(); model.period = .h1
        let now = DemoData.now(), r = ClusterReadings(model: model, now: now)
        // Speedometer: the account burning fastest now (its burn at the last minute's speed), then by the period's
        // burn; the needle reads that live burn. A picked account reads that account.
        let ranked = r.accounts.filter { ClusterReadings.valid($0.burn) }
            .sorted { ($0.live ?? 0) != ($1.live ?? 0) ? ($0.live ?? 0) > ($1.live ?? 0) : ($0.burn ?? 0) > ($1.burn ?? 0) }
        let fastest = try XCTUnwrap(ranked.first)
        XCTAssertEqual(r.speed.account, fastest.id)
        XCTAssertEqual(try XCTUnwrap(r.speed.value), try XCTUnwrap(fastest.burn), accuracy: 1e-9)
        XCTAssertEqual(try XCTUnwrap(r.speed.live), try XCTUnwrap(fastest.live ?? fastest.burn), accuracy: 1e-9)
        for a in r.accounts { if let burn = a.burn { XCTAssertEqual(burn, try XCTUnwrap(model.quotas.first { $0.id == a.id }.flatMap { ClusterReadings.burn($0, "1h") }), accuracy: 1e-9) } }
        XCTAssertFalse(r.speed.picked)
        XCTAssertGreaterThanOrEqual(r.speed.max, max(2, r.speed.value ?? 0, r.speed.live ?? 0))
        let other = try XCTUnwrap(ranked.first { $0.id != fastest.id })
        let picked = ClusterReadings(model: model, now: now, pick: other.id)
        XCTAssertEqual(picked.speed.account, other.id)
        XCTAssertTrue(picked.speed.picked)
        XCTAssertEqual(try XCTUnwrap(picked.speed.value), try XCTUnwrap(other.burn), accuracy: 1e-9)
        // Fuel: every account with what is left of its weekly limit.
        XCTAssertEqual(r.accounts.map(\.id), model.quotas.map(\.id))
        for a in r.accounts { if let pct = a.pct { XCTAssertEqual(a.left, max(0, 100 - pct)) } }
        // Warning lights: accounts to sign in again, the world's nearly full context, live readings.
        XCTAssertEqual(r.tells.reconnect, model.quotas.filter(\.needsReconnect).map(\.id))
        XCTAssertTrue(r.tells.context.contains { $0.hasSuffix(":s3") })
        XCTAssertTrue(r.tells.fresh)
        XCTAssertTrue(r.tells.kinds.allSatisfy { $0.working > 0 })
        // Tachometer: the dashboard's token speed as the period's average; the needle reads the last minute in
        // tokens per minute, on a round scale at least two and a half times the average, held while the period stays.
        XCTAssertEqual(try XCTUnwrap(r.tach.rate), try XCTUnwrap(model.averagePerHour), accuracy: 1e-6)
        XCTAssertEqual(r.tach.max, ClusterReadings.scaleMax(r.tach.rate, seconds: 3600))
        XCTAssertTrue(r.tach.live)
        XCTAssertEqual(try XCTUnwrap(r.tach.now), try XCTUnwrap(r.tach.instant), accuracy: 1e-9)
        XCTAssertGreaterThanOrEqual(r.tach.tpmMax, try XCTUnwrap(r.tach.rate) / 60 * 2.5)
        XCTAssertEqual(r.tach.tpmMax, ClusterReadings.niceMax(r.tach.tpmMax))
        let hold = ClusterReadings.TachHold(); hold.period = "1h"; hold.tpm = r.tach.tpmMax * 10
        XCTAssertEqual(ClusterReadings(model: model, now: now, hold: hold).tach.tpmMax, r.tach.tpmMax * 10)
        // Trip: tokens since the start from the token bins, inside the record.
        let trip = try XCTUnwrap(ClusterReadings(model: model, now: now, trip: now - 3600).trip)
        XCTAssertTrue(trip.inRange)
        XCTAssertGreaterThan(try XCTUnwrap(trip.tokens), 0)
        XCTAssertFalse(try XCTUnwrap(ClusterReadings(model: model, now: now, trip: now - 3 * 86_400).trip).inRange)
    }

    func testScalesAndFigures() {
        for (max, major, minor) in [(2e8, 5e7, 1e7), (1e8, 2.5e7, 5e6), (5e7, 1e7, 2e6), (2.0, 0.5, 0.1)] {
            XCTAssertEqual(ClusterReadings.marks(max), .init(max: max, major: major, minor: minor))
        }
        XCTAssertEqual(ClusterReadings.scaleMax(nil, seconds: 3600), 2e8)
        XCTAssertEqual(ClusterReadings.scaleMax(3.1e8, seconds: 86_400), 5e8)
        XCTAssertEqual(ClusterReadings.reading(1.4253), "1.43")
        XCTAssertEqual(ClusterReadings.reading(108.2), "108")
        XCTAssertEqual(ClusterReadings.tokens(108_201_744), "108.20M")
        XCTAssertEqual(ClusterReadings.range(left: 39, burn: 1.4253, reset: 1e12, now: 0)?.state, .empty)
        XCTAssertEqual(ClusterReadings.range(left: 39, burn: 0, reset: nil, now: 0)?.state, .idle)
        XCTAssertNil(ClusterReadings.cruise(left: 39, reset: 10, now: 20))
    }
}
