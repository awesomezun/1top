import XCTest
@testable import OneTop

/// The quick view's model split (period-model-breakdown v1.1.0): each computer's own split when it reports
/// one, ended sessions included; an empty split is no usage; older collectors fall back to the sessions; a
/// computer without a split gives its tokens to no model.
@MainActor
final class ModelShareTests: XCTestCase {
    private func shares(_ computers: [(period: [Double], split: String?)]) throws -> ModelShares {
        let now = Date().timeIntervalSince1970 * 1000
        let devices = try computers.enumerated().map { i, c -> Device in
            let split = c.split.map { #","by_model":\#($0)"# } ?? ""
            let json = #"""
            {"id":"dev-\#(i)","name":"Mac \#(i)","platform":"macOS","online":true,"received":\#(now),"snapshot":{"sessions":[
             {"id":"a","kind":"Claude","model":"claude-opus-5-5","status":"working","tokens":[1,0,0,0],"windows":{"1h":[30,0,0,0]}},
             {"id":"b","kind":"Codex","model":null,"status":"idle","tokens":[1,0,0,0],"windows":{"1h":[20,0,0,0]}}],
             "periods":[{"key":"1h","label":"1h","tokens":\#(c.period),"partial":false\#(split)}]}}
            """#
            return try JSONDecoder.relay().decode(Device.self, from: Data(json.utf8))
        }
        let model = AppModel(restoring: false)
        model.devices = devices
        model.period = .h1
        return model.modelShares
    }

    func testSplitFromTheComputers() throws {
        let present = try shares([([60, 0, 0, 40], #"[{"kind":"Claude","model":"claude-opus-5-5","tokens":[40,0,0,20],"session_count":2},{"kind":"Codex","model":"gpt-6.1-sol","tokens":[15,0,0,15],"session_count":1},{"kind":"Codex","model":"claude-opus-5-5","tokens":[5,0,0,5],"session_count":1}]"#)])
        XCTAssertTrue(present.split)
        XCTAssertEqual(present.total, 100)
        XCTAssertEqual(present.rows, [.init(kind: "Claude", model: "opus-5-5", tokens: 60), .init(kind: "Codex", model: "GPT-6.1-sol", tokens: 30),
                                      .init(kind: "Codex", model: "opus-5-5", tokens: 10)])
        let empty = try shares([([0, 0, 0, 0], "[]")])
        XCTAssertTrue(empty.split)
        XCTAssertTrue(empty.rows.isEmpty)
        let unnamed = try shares([([60, 0, 0, 40], #"[{"kind":"Codex","model":null,"tokens":[60,0,0,40],"session_count":1}]"#)])
        XCTAssertEqual(unnamed.rows, [.init(kind: "Codex", model: nil, tokens: 100)])
    }

    func testOlderCollectorsSplitTheSessions() throws {
        let legacy = try shares([([60, 0, 0, 40], nil)])
        XCTAssertFalse(legacy.split)
        XCTAssertEqual(legacy.total, 100)
        XCTAssertEqual(legacy.rows, [.init(kind: "Claude", model: "opus-5-5", tokens: 30), .init(kind: "Codex", model: nil, tokens: 20)])
    }

    func testComputersAddUpAndOneWithoutASplitStaysApart() throws {
        let split = #"[{"kind":"Claude","model":"claude-opus-5-5","tokens":[30,0,0,10],"session_count":1}]"#
        let both = try shares([([30, 0, 0, 10], split), ([30, 0, 0, 10], split)])
        XCTAssertEqual(both.rows, [.init(kind: "Claude", model: "opus-5-5", tokens: 80)])
        let partial = try shares([([30, 0, 0, 10], split), ([50, 0, 0, 10], nil)])
        XCTAssertEqual(partial.total, 100)
        XCTAssertEqual(partial.rows, [.init(kind: nil, model: nil, tokens: 60), .init(kind: "Claude", model: "opus-5-5", tokens: 40)])
    }

    func testTheDemoSplitAddsUpToEachPeriod() {
        for d in DemoData.devices(now: 1_800_000_000, anchor: 1_800_000_000) {
            for p in d.snapshot?.periods ?? [] {
                let split = try? XCTUnwrap(p.byModel)
                for i in 0..<4 {
                    XCTAssertEqual(split?.reduce(0) { $0 + ($1.tokens?[i] ?? 0) } ?? -1, p.tokens?[i] ?? -2, accuracy: 0.5, "\(d.id) \(p.key) \(i)")
                }
            }
            XCTAssertEqual(d.snapshot?.periods?.count, Period.allCases.count)
        }
    }
}
