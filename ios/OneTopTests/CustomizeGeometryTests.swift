import SwiftUI
import XCTest
@testable import OneTop

/// Customizing gate G2 on the iPhone (customizing-spec_v1.2.2), as tests/customize-browser.py checks the web: seeded
/// layouts (the web's three extremes and random ones, both presets) drawn with the demo at 375, 393 and 440 points
/// wide keep every object, and the tiles, fuel gauges and lights in them, inside the housing and the screen, without
/// any two overlapping (so neither do their rings, which run 2 points inside); the dials stay on top, the objects
/// follow the layout's order and the gear sits clear of the dials or inside the first section's heading row.
@MainActor
final class CustomizeGeometryTests: XCTestCase {
    typealias Item = ScreenLayout.Item
    private let suite = "si.onetop.customize-geometry"
    // A real iPhone draws one width and the extreme layouts, which keeps the run inside a device's test time; the
    // simulator draws every width and every seeded layout.
    #if targetEnvironment(simulator)
    private static let widths: [CGFloat] = [375, 393, 440]
    private static let seeded = 9
    #else
    private static let widths: [CGFloat] = [393]
    private static let seeded = 0
    #endif
    private var failures: [String] = []

    override func tearDown() async throws { UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite) }

    // MARK: Seeds
    /// SplitMix64, so every run draws the same layouts.
    private struct Seeded: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
    }
    private static let shapes: [String: [String]] = ["periods": ["auto", "tabs", "drum", "tuner", "roller", "knob", "lever"], "dials": ["ring", "glow", "plate"],
                                                     "alerts": ["label", "chips", "strip", "count", "badge", "lens"], "odo": ["drum", "led", "led0", "print", "print0"]]
    private static let modes = ["sessions", "flow", "weekly", "map", "heat", "goals", "system"]
    /// The web gate's extremes: everything smallest and fullest, everything largest and fewest, the order turned over
    /// with the lights and the odometer hidden.
    private static let extremes: [[String: Any]] = [
        ["order": ["periods", "dials", "alerts", "odo", "temps", "fuel", "window"], "hidden": [String](),
         "opts": ["dials": ["size": 0], "alerts": ["count": 3, "shape": "lens"], "odo": ["shape": "led0"], "fuel": ["count": 8], "window": ["size": 0]]],
        ["order": ["periods", "dials", "alerts", "odo", "temps", "fuel", "window"], "hidden": [String](),
         "opts": ["dials": ["size": 2, "shape": "plate"], "alerts": ["count": 6, "shape": "chips"], "odo": ["shape": "print0"], "fuel": ["count": 3], "window": ["size": 2]]],
        ["order": ["periods", "window", "fuel", "odo", "alerts", "dials", "temps"], "hidden": ["alerts", "odo"], "opts": [String: Any]()],
    ]
    private func clusterGroup(_ rng: inout Seeded) -> [String: Any] {
        let movable = ["dials", "alerts", "odo", "temps", "fuel", "window"].shuffled(using: &rng)
        let hidden = Array(["alerts", "odo", "fuel", "window", "temps"].shuffled(using: &rng).prefix(Int.random(in: 0...2, using: &rng)))
        var opts: [String: [String: Any]] = [:]
        for (k, v) in Self.shapes { opts[k] = ["shape": v.randomElement(using: &rng)!] }
        opts["dials"]?["size"] = Int.random(in: 0...2, using: &rng)
        opts["dials"]?["needle"] = ["default", "red", "amber"].randomElement(using: &rng)!
        opts["alerts"]?["count"] = Int.random(in: 3...6, using: &rng)
        let fuel: Int? = [nil, 3, 4, 5, 6, 7, 8].randomElement(using: &rng)!
        opts["fuel"] = ["count": fuel.map { $0 as Any } ?? NSNull()]
        opts["window"] = ["size": Int.random(in: 0...2, using: &rng),
                          "tabs": Array(Self.modes.shuffled(using: &rng).prefix(Int.random(in: 1...7, using: &rng)))]
        return ["order": ["periods"] + movable, "hidden": hidden, "opts": opts]
    }
    private func dashboardGroup(_ rng: inout Seeded) -> [String: Any] {
        let rest = ["tokens", "weekly", "resources", "sessions"].shuffled(using: &rng)
        let weekly: Int? = [2, 4, 6, nil].randomElement(using: &rng)!, sessions: Int? = [3, 5, 10, nil].randomElement(using: &rng)!
        return ["order": ["periods"] + rest, "hidden": Array(["tokens", "weekly", "resources"].shuffled(using: &rng).prefix(Int.random(in: 0...2, using: &rng))),
                "opts": ["tokens": ["size": Int.random(in: 0...2, using: &rng)], "weekly": ["count": weekly.map { $0 as Any } ?? NSNull()],
                         "sessions": ["count": sessions.map { $0 as Any } ?? NSNull()]]]
    }
    private func text(_ preset: ScreenLayout.Preset, _ group: [String: Any]) throws -> String {
        let layout: [String: Any] = ["v": 1, "preset": preset.rawValue, "presets": [preset.rawValue: group]]
        return String(decoding: try JSONSerialization.data(withJSONObject: layout), as: UTF8.self)
    }

    // MARK: Drawing
    /// The preset drawn with the demo at this width; its editor's frames and probes once they settle.
    private func draw(_ raw: String, _ preset: ScreenLayout.Preset, width: CGFloat) async throws -> (CustomizeSession, ScreenLayout.Arrangement, UIWindow) {
        let store = try XCTUnwrap(UserDefaults(suiteName: suite))
        store.removePersistentDomain(forName: suite)
        store.set(raw, forKey: ScreenLayout.key)
        let layouts = LayoutStore(store: store), model = AppModel(restoring: false)
        model.showDemo()
        let session = CustomizeSession(preset: preset)
        let host = UIHostingController(rootView: QuickView(fixed: preset, session: session).environment(model).environment(layouts))
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: width, height: 900)
        window.overrideUserInterfaceStyle = .dark
        window.rootViewController = host
        window.makeKeyAndVisible()
        for _ in 0..<24 {
            host.view.setNeedsLayout(); host.view.layoutIfNeeded()
            try await Task.sleep(for: .milliseconds(50))
        }
        return (session, layouts.layout.presets[preset], window)
    }

    private func fail(_ label: String, _ what: String) { failures.append("\(label): \(what)") }
    private func inside(_ r: CGRect, _ outer: CGRect, slack: CGFloat = 0.5) -> Bool { outer.insetBy(dx: -slack, dy: -slack).contains(r) }
    private func overlap(_ a: CGRect, _ b: CGRect) -> Bool { let i = a.intersection(b); return !i.isNull && i.width > 0.5 && i.height > 0.5 }
    private func separate(_ label: String, _ rects: [(String, CGRect)]) {
        for i in rects.indices { for j in rects.indices where j > i && overlap(rects[i].1, rects[j].1) { fail(label, "\(rects[i].0) overlaps \(rects[j].0)") } }
    }

    // MARK: The cluster preset
    func testClusterLayoutsStayInsideTheHousing() async throws {
        var rng = Seeded(state: 46)
        let groups = Self.extremes + (0..<Self.seeded).map { _ in clusterGroup(&rng) }
        for width in Self.widths {
            for (n, group) in groups.enumerated() {
                let label = "cluster \(Int(width))pt #\(n)"
                let (session, a, window) = try await draw(try text(.cluster, group), .cluster, width: width)
                defer { window.isHidden = true; window.rootViewController = nil }
                let screen = CGRect(x: 0, y: -1e6, width: width, height: 2e6)
                guard let housing = session.probes["housing"] else { fail(label, "no housing"); continue }
                if !inside(housing, screen) { fail(label, "housing \(housing) past the screen") }
                let shown = Customizing.known(.cluster).filter { $0 == .periods || !a.hidden.contains($0) }
                var parts: [(String, CGRect)] = []
                for id in shown {
                    guard let f = session.frames[id] else { fail(label, "\(id) not drawn"); continue }
                    parts.append((id.rawValue, f))
                    if !inside(f, housing) { fail(label, "\(id) \(f) outside the housing \(housing)") }
                }
                for id in a.hidden where id != .temps && id != .periods && session.frames[id] != nil { fail(label, "hidden \(id) drawn") }
                separate(label, parts)
                // The dials on top; the rest in the layout's order (the period control rides on the window).
                if let dials = session.frames[.dials], parts.contains(where: { $0.0 != "dials" && $0.1.minY < dials.minY }) { fail(label, "dials not on top") }
                let want = a.order.filter { [.alerts, .odo, .fuel, .window].contains($0) && !a.hidden.contains($0) }
                let got = parts.filter { ["alerts", "odo", "fuel", "window"].contains($0.0) }.sorted { $0.1.minY < $1.1.minY }.map(\.0)
                if got != want.map(\.rawValue) { fail(label, "order \(got), want \(want)") }
                // The pieces inside their objects, apart.
                for (prefix, id) in [("lamp-", Item.alerts), ("can-", .fuel)] {
                    let pieces = session.probes.filter { $0.key.hasPrefix(prefix) }.map { ($0.key, $0.value) }
                    guard let part = session.frames[id] else { continue }
                    for (k, r) in pieces where !inside(r, part) { fail(label, "\(k) \(r) outside \(id) \(part)") }
                    separate(label, pieces)
                }
                // The gear in the housing's corner, clear of the right dial's round face.
                if let gear = session.probes["gear"], let dial = session.probes["dial-burn"] {
                    if !inside(gear, housing) { fail(label, "gear outside the housing") }
                    let gap = hypot(gear.midX - dial.midX, gear.midY - dial.midY) - dial.width / 2 - gear.width / 2
                    if gap < 0 { fail(label, "gear on the dial (\(gap))") }
                } else { fail(label, "no gear") }
            }
        }
        XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
        print("G2 cluster: \(groups.count) layouts at \(Self.widths.map { Int($0) }) checked")
    }

    // MARK: The dashboard preset
    func testDashboardLayoutsKeepTheirOrderInsideTheScreen() async throws {
        var rng = Seeded(state: 64)
        let extremes: [[String: Any]] = [
            ["order": ["periods", "tokens", "weekly", "resources", "sessions"], "hidden": [String](),
             "opts": ["tokens": ["size": 0], "weekly": ["count": 6], "sessions": ["count": 3]]],
            ["order": ["periods", "sessions", "resources", "weekly", "tokens"], "hidden": ["tokens", "weekly", "resources"], "opts": [String: Any]()],
        ]
        let groups = extremes + (0..<min(6, Self.seeded)).map { _ in dashboardGroup(&rng) }
        for width in Self.widths {
            for (n, group) in groups.enumerated() {
                let label = "dashboard \(Int(width))pt #\(n)"
                let (session, a, window) = try await draw(try text(.dashboard, group), .dashboard, width: width)
                defer { window.isHidden = true; window.rootViewController = nil }
                let screen = CGRect(x: 0, y: -1e6, width: width, height: 2e6)
                let want = [Item.periods] + a.order.filter { $0 != .periods && !a.hidden.contains($0) }
                var parts: [(String, CGRect)] = []
                for id in want {
                    guard let f = session.frames[id] else { fail(label, "\(id) not drawn"); continue }
                    parts.append((id.rawValue, f))
                    if !inside(f, screen) { fail(label, "\(id) \(f) past the screen") }
                }
                for id in a.hidden where session.frames[id] != nil { fail(label, "hidden \(id) drawn") }
                separate(label, parts)
                let got = parts.sorted { $0.1.minY < $1.1.minY }.map(\.0)
                if got != want.map(\.rawValue) { fail(label, "order \(got), want \(want)") }
                // The account tiles, as many as asked, inside their section and apart.
                let tiles = session.probes.filter { $0.key.hasPrefix("tile-") }.map { ($0.key, $0.value) }
                if let weekly = session.frames[.weekly] {
                    for (k, r) in tiles where !inside(r, weekly) { fail(label, "\(k) \(r) outside the limits \(weekly)") }
                    separate(label, tiles)
                    if let c = a.opts[.weekly]?.count, case .value(let v) = c, tiles.count > v { fail(label, "\(tiles.count) tiles for \(v)") }
                }
                // The gear in the first section's heading row.
                if let first = want.dropFirst().first, var gear = session.probes["gear"], let part = session.frames[first] {
                    // The token section is drawn smaller as a whole: its pieces' frames are its own, before the scale.
                    if first == .tokens, let size = a.opts[.tokens]?.size, size < 2 {
                        let k = [0.7, 0.85, 1][size]
                        gear = CGRect(x: part.minX + (gear.minX - part.minX) * k, y: part.minY + (gear.minY - part.minY) * k, width: gear.width * k, height: gear.height * k)
                    }
                    if !inside(gear, part, slack: 1) { fail(label, "gear \(gear) outside \(first) \(part)") }
                    if gear.minY > part.minY + 40 { fail(label, "gear not on the heading row") }
                } else { fail(label, "no gear") }
            }
        }
        XCTAssert(failures.isEmpty, failures.joined(separator: "\n"))
        print("G2 dashboard: \(groups.count) layouts at \(Self.widths.map { Int($0) }) checked")
    }
}
