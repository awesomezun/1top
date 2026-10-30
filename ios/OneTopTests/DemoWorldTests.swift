import XCTest
@testable import OneTop

/// The iPhone demo is the one demo world: at the same moment it gives the numbers the web model gives
/// (DemoWorldExpected.swift, written by scripts/demo-world.mjs from site/src/demo-model.js), so the
/// iPhone, Android, 1top.si/app?demo and the desktop demo show the same accounts and sessions.
final class DemoWorldTests: XCTestCase {
    func testSameNumbersAsTheWebModel() {
        let at = DemoWorldExpected.checkAt, devices = DemoData.devices(now: at, anchor: at)
        XCTAssertEqual(devices.map(\.id), DemoWorld.computers.map(\.id))
        XCTAssertEqual(devices.map(\.name), ["MacBook Pro", "Mac mini", "Workstation"])
        for (id, cpu, used) in DemoWorldExpected.hosts {
            let host = devices.first { $0.id == id }?.snapshot?.host
            XCTAssertEqual(host?.cpu, cpu, id)
            XCTAssertEqual(host?.usedMemory, used, id)
        }
        let sessions = Dictionary(uniqueKeysWithValues: devices.flatMap { $0.snapshot?.sessions ?? [] }.map { ($0.id, $0) })
        for (id, hour, day, rate, total) in DemoWorldExpected.sessions {
            guard let s = sessions[id] else { XCTFail("No session \(id)"); continue }
            XCTAssertEqual(s.tokens(in: .h1), hour, id)
            XCTAssertEqual(s.tokens(in: .h24), day, id)
            XCTAssertEqual(s.total, total, id)
            if s.status == "working" { XCTAssertEqual(s.rate, rate, id) }
        }
        var quotas: [String: Quota] = [:]
        for q in devices.flatMap({ $0.snapshot?.accountQuotas ?? [] }) { quotas[q.id] = q }
        for (key, weekly, five, day, fiveHours, hour) in DemoWorldExpected.accounts {
            let account = DemoWorld.accounts.first { $0.key == key }!
            guard let q = quotas[account.id] else { XCTFail("No account \(key)"); continue }
            XCTAssertEqual(q.weeklyWindow?.pct, weekly, key)
            XCTAssertEqual(q.fiveHour?.pct ?? -1, five, key)
            XCTAssertEqual(q.weekly?["24h"]?.usedPp ?? -1, day, accuracy: 1e-4, key)
            XCTAssertEqual(q.weekly?["5h"]?.usedPp ?? -1, fiveHours, accuracy: 1e-4, key)
            XCTAssertEqual(q.weekly?["1h"]?.usedPp ?? -1, hour, accuracy: 1e-4, key)
            XCTAssertEqual(q.accountLabel, account.kind + " · " + String(account.id.suffix(6)))
            XCTAssertEqual(q.alias, account.alias)
            XCTAssertEqual(q.stale, account.stale != nil)
        }
        // Each session shows its world's controls; the Mac mini is paired for usage only.
        for s in DemoWorld.sessions { XCTAssertEqual(sessions[s.id]?.capabilities, s.caps, s.id) }
        XCTAssertEqual(DemoData.controlOff, ["demo-1"])
    }
}
