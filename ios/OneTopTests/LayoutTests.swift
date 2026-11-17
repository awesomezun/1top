import XCTest
@testable import OneTop

/// The customizing layout reads on the iPhone as the web reads it (agent/onetop/dist/layout.js): every case in
/// tests/fixtures/layout_v1.json, shared with the web, the Mac and Android, reads to exactly its expected layout; what
/// is written reads back the same; and a newer version is never written over.
final class LayoutTests: XCTestCase {
    /// The repository's fixture, copied into this test bundle (project.yml), so it reads on a real iPhone too.
    private static var fixture: URL { get throws { try XCTUnwrap(Bundle(for: LayoutTests.self).url(forResource: "layout_v1", withExtension: "json")) } }
    private let suite = "si.onetop.layout-tests"

    override func tearDown() { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }

    /// A case's old settings as layout.js takes them: the dashboard's text, and the chosen view only when it is a
    /// boolean.
    private func legacy(_ raw: Any?) -> ScreenLayout.Legacy {
        guard let raw = raw as? [String: Any] else { return .init() }
        let quick = (raw["quickCluster"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? $0.boolValue : nil }
        return .init(dashboard: raw["dashboard"] as? String, quickCluster: quick)
    }

    /// Text read by Foundation rather than the model's own reader, so the two are compared as JSON objects.
    private func object(_ text: String) -> NSDictionary { (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? NSDictionary ?? [:] }

    func testStoredCases() throws {
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: try Self.fixture)) as? [[String: Any]])
        XCTAssertGreaterThanOrEqual(cases.count, 30)
        for c in cases {
            let name = c["name"] as? String ?? "?", expect = try XCTUnwrap(c["expect"] as? [String: Any], name)
            let got = ScreenLayout.read(c["raw"] as? String, legacy: legacy(c["legacy"]))
            let text = got.layout.json.text
            XCTAssertTrue(object(text).isEqual(to: try XCTUnwrap(expect["layout"] as? [AnyHashable: Any], name)), "\(name): \(text)")
            XCTAssertEqual(got.locked, expect["locked"] as? Bool, name)
            // What is written reads back the same, word for word.
            let written = ScreenLayout.write(got.layout), back = ScreenLayout.read(written)
            XCTAssertEqual(back, ScreenLayout.Stored(layout: got.layout, locked: false), name)
            XCTAssertEqual(ScreenLayout.write(back.layout), written, name)
        }
        XCTAssertEqual(ScreenLayout.read(nil), ScreenLayout.Stored(layout: ScreenLayout.defaults, locked: false))
    }

    /// What is written is put right first: a size past the largest, an unknown shape, everything hidden.
    func testWritingPutsTheLayoutRight() {
        var odd = ScreenLayout.defaults
        odd.presets.cluster.opts[.dials]?.size = 7
        odd.presets.cluster.opts[.odo]?.shape = "neon"
        odd.wide.cluster.hidden = odd.wide.cluster.order
        let fixed = ScreenLayout.read(ScreenLayout.write(odd)).layout
        XCTAssertEqual(fixed.presets.cluster.opts[.dials]?.size, 2)
        XCTAssertEqual(fixed.presets.cluster.opts[.odo]?.shape, "drum")
        XCTAssertEqual(fixed.wide.cluster, ScreenLayout.defaults.wide.cluster)
    }

    /// On this iPhone: nothing stored loads as the defaults, the panel's chosen view is taken over until a layout is
    /// saved, a saved layout loads back the same, and one a newer version wrote is never saved over.
    func testSavedOnThisDevice() throws {
        let store = try XCTUnwrap(UserDefaults(suiteName: suite))
        store.removePersistentDomain(forName: suite)
        XCTAssertEqual(ScreenLayout.load(from: store), ScreenLayout.Stored(layout: ScreenLayout.defaults, locked: false))
        store.set(true, forKey: "quickCluster")
        XCTAssertEqual(ScreenLayout.load(from: store).layout.preset, .cluster)
        var layout = ScreenLayout.defaults
        layout.tabs = .one
        layout.presets[.dashboard].opts[.weekly]?.count = .value(6)
        layout.presets.cluster.order.swapAt(1, 2)
        XCTAssertTrue(ScreenLayout.save(ScreenLayout.Stored(layout: layout, locked: false), to: store))
        XCTAssertEqual(ScreenLayout.load(from: store), ScreenLayout.Stored(layout: layout, locked: false))
        store.set(#"{"v":2}"#, forKey: ScreenLayout.key)
        let newer = ScreenLayout.load(from: store)
        XCTAssertEqual(newer, ScreenLayout.Stored(layout: ScreenLayout.defaults, locked: true))
        XCTAssertFalse(ScreenLayout.save(newer, to: store))
        XCTAssertEqual(store.string(forKey: ScreenLayout.key), #"{"v":2}"#)
    }
}
