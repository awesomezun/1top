import Foundation

// The menu bar reads the customizing layout as the web does (agent/onetop/dist/layout.js): every case in
// tests/fixtures/layout_v1.json, shared with the web, the iPhone and Android, reads to exactly its expected layout;
// what is written reads back the same; and a newer version is never written over.
@main struct LayoutChecks {
    /// A case's old settings as layout.js takes them: the dashboard's text, and the chosen view only when it is a
    /// boolean.
    static func legacy(_ raw: Any?) -> ScreenLayout.Legacy {
        guard let raw = raw as? [String: Any] else { return .init() }
        let quick = (raw["quickCluster"] as? NSNumber).flatMap { CFGetTypeID($0) == CFBooleanGetTypeID() ? $0.boolValue : nil }
        return .init(dashboard: raw["dashboard"] as? String, quickCluster: quick)
    }
    /// Text read by Foundation rather than the model's own reader, so the two are compared as JSON objects.
    static func object(_ text: String) -> NSDictionary { (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? NSDictionary ?? [:] }

    static func main() throws {
        guard CommandLine.arguments.count > 1 else { fatalError("usage: layout-checks tests/fixtures/layout_v1.json") }
        let file = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        guard let cases = try JSONSerialization.jsonObject(with: file) as? [[String: Any]], cases.count >= 30 else { fatalError("at least 30 cases") }
        for c in cases {
            let name = c["name"] as? String ?? "?", expect = c["expect"] as? [String: Any] ?? [:]
            let got = ScreenLayout.read(c["raw"] as? String, legacy: legacy(c["legacy"]))
            let text = got.layout.json.text
            precondition(object(text).isEqual(to: expect["layout"] as? [AnyHashable: Any] ?? [:]), "\(name): \(text)")
            precondition(got.locked == expect["locked"] as? Bool, "\(name): locked \(got.locked)")
            // What is written reads back the same, word for word.
            let written = ScreenLayout.write(got.layout), back = ScreenLayout.read(written)
            precondition(back == ScreenLayout.Stored(layout: got.layout, locked: false) && ScreenLayout.write(back.layout) == written, "\(name): round trip")
        }
        precondition(ScreenLayout.read(nil) == ScreenLayout.Stored(layout: ScreenLayout.defaults, locked: false), "nothing stored reads as the defaults")
        // What is written is put right first: a size past the largest, an unknown shape, everything hidden.
        var odd = ScreenLayout.defaults
        odd.presets.cluster.opts[.dials]?.size = 7
        odd.presets.cluster.opts[.odo]?.shape = "neon"
        odd.wide.cluster.hidden = odd.wide.cluster.order
        let fixed = ScreenLayout.read(ScreenLayout.write(odd)).layout
        precondition(fixed.presets.cluster.opts[.dials]?.size == 2 && fixed.presets.cluster.opts[.odo]?.shape == "drum"
                     && fixed.wide.cluster == ScreenLayout.defaults.wide.cluster, "written layouts are put right")
        // On this Mac: nothing stored loads as the defaults, the panel's chosen view is taken over until a layout is
        // saved, a saved layout loads back the same, and one a newer version wrote is never saved over.
        let suite = "si.onetop.layout-checks"
        guard let store = UserDefaults(suiteName: suite) else { fatalError("no defaults suite") }
        store.removePersistentDomain(forName: suite)
        defer { store.removePersistentDomain(forName: suite) }
        precondition(ScreenLayout.load(from: store) == ScreenLayout.Stored(layout: ScreenLayout.defaults, locked: false), "nothing stored")
        store.set(true, forKey: "quickCluster")
        precondition(ScreenLayout.load(from: store).layout.preset == .cluster, "the panel's chosen view is taken over")
        var layout = ScreenLayout.defaults
        layout.tabs = .one
        layout.presets[.dashboard].opts[.weekly]?.count = .value(6)
        layout.presets.cluster.order.swapAt(1, 2)
        precondition(ScreenLayout.save(ScreenLayout.Stored(layout: layout, locked: false), to: store), "saved")
        precondition(ScreenLayout.load(from: store) == ScreenLayout.Stored(layout: layout, locked: false), "a saved layout loads back the same")
        store.set(#"{"v":2}"#, forKey: ScreenLayout.key)
        let newer = ScreenLayout.load(from: store)
        precondition(newer == ScreenLayout.Stored(layout: ScreenLayout.defaults, locked: true), "a newer version shows the defaults")
        precondition(!ScreenLayout.save(newer, to: store) && store.string(forKey: ScreenLayout.key) == #"{"v":2}"#, "a newer version is never written over")
        print("Layout checks passed: \(cases.count) stored cases, defaults, round trips, saving and the newer-version lock")
    }
}
