import AppKit
import SwiftUI

// Customizing in the menu bar panel (customizing-spec_v1.2.2), drawn offscreen with the demo state. G2: seeded layouts
// (the web gate's three extremes and random ones, both presets) at the panel's width and zoom 0.8, 1 and 1.6 keep every
// object inside the panel and the cluster's housing, none overlapping another, the dials on top, the gear clear of the
// dials and inside the first section, and in the edit mode every ring, − and grip inside the panel, the rings apart,
// and nothing moved by a fraction of a point. G3: the edit mode worked as its clicks, drags and keys work it (hide,
// move, size, count, shape through the gallery, the list's order and switches, reset), each change kept at once, read
// back after a relaunch, never written over a newer version's layout, and no jiggle with Reduce Motion. With a folder
// after the state file it also writes the screenshots.
// node tests/cluster-fixture.mjs <dir> && swiftc (desktop/*.swift but OneTop.swift) tests/desktop/CustomizeChecks.swift
//   && customize-checks <dir>/state-1h.json [<shots folder>]
@main struct CustomizeChecks {
    typealias Item = ScreenLayout.Item
    static let suite = "si.onetop.customize-checks"
    static var model: DashboardModel!
    static let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 800), styleMask: .borderless, backing: .buffered, defer: false)
    static var failures: [String] = []
    static func check(_ ok: Bool, _ what: @autoclosure () -> String) { if !ok { failures.append(what()) } }

    /// The panel drawn offscreen with a layout, settled.
    @discardableResult static func host(_ layout: PanelLayout, zoom: Double = 1) -> NSHostingView<QuickDashboard> {
        let size = QuickDashboard.panelSize(zoom: zoom)
        let z = AppZoom(persist: false)
        z.set(zoom)
        let view = QuickDashboard(model: model, zoom: z, layout: layout, openDashboard: {}, openBrowser: {}, remoteOptions: {}, connectRemote: {},
                                  toggleLogin: {}, restart: {}, quit: {}, control: { _, _ in })
        let host = NSHostingView(rootView: view)
        window.setContentSize(size)
        window.contentView = host
        host.frame = NSRect(origin: .zero, size: size)
        settle()
        return host
    }
    static func settle(_ seconds: Double = 0.35) { RunLoop.main.run(until: Date().addingTimeInterval(seconds)) }
    static func shot(_ host: NSView, _ folder: URL?, _ name: String) {
        guard let folder, let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return }
        host.cacheDisplay(in: host.bounds, to: rep)
        try? rep.representation(using: .png, properties: [:])?.write(to: folder.appendingPathComponent(name + ".png"))
    }
    static func store(_ raw: String?) -> UserDefaults {
        let s = UserDefaults(suiteName: suite)!
        s.removePersistentDomain(forName: suite)
        if let raw { s.set(raw, forKey: ScreenLayout.key) }
        return s
    }

    // MARK: Seeds, as tests/customize-browser.py draws them
    struct Seeded: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state &+= 0x9E3779B97F4A7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9; z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
            return z ^ (z >> 31)
        }
    }
    static let order = ["periods", "dials", "alerts", "odo", "temps", "fuel", "window"]
    static let shapes: [String: [String]] = ["periods": ["auto", "tabs", "drum", "tuner", "roller", "knob", "lever"], "dials": ["ring", "glow", "plate"],
                                             "alerts": ["label", "chips", "strip", "count", "badge", "lens"], "odo": ["drum", "led", "led0", "print", "print0"]]
    static let extremes: [String] = [
        #"{"order":["periods","dials","alerts","odo","temps","fuel","window"],"hidden":[],"opts":{"dials":{"size":0},"alerts":{"count":3,"shape":"lens"},"odo":{"shape":"led0"},"fuel":{"count":8},"window":{"size":0}}}"#,
        #"{"order":["periods","dials","alerts","odo","temps","fuel","window"],"hidden":[],"opts":{"dials":{"size":2,"shape":"plate"},"alerts":{"count":6,"shape":"chips"},"odo":{"shape":"print0"},"fuel":{"count":3},"window":{"size":2}}}"#,
        #"{"order":["periods","window","fuel","odo","alerts","dials","temps"],"hidden":["alerts","odo"],"opts":{}}"#]
    static func quote(_ list: [String]) -> String { "[" + list.map { "\"\($0)\"" }.joined(separator: ",") + "]" }
    static func clusterGroup(_ rng: inout Seeded) -> String {
        let movable = Array(order.dropFirst()).shuffled(using: &rng)
        let hidden = Array(["alerts", "odo", "fuel", "window", "temps"].shuffled(using: &rng).prefix(Int.random(in: 0...2, using: &rng)))
        var opts = shapes.map { "\"\($0.key)\":{\"shape\":\"\($0.value.randomElement(using: &rng)!)\"" }
        opts = opts.map { o in
            o.hasPrefix("\"dials\"") ? o + ",\"size\":\(Int.random(in: 0...2, using: &rng)),\"needle\":\"\(["default", "red", "amber"].randomElement(using: &rng)!)\"}"
                : o.hasPrefix("\"alerts\"") ? o + ",\"count\":\(Int.random(in: 3...6, using: &rng))}" : o + "}"
        }
        let fuel = ["null", "3", "4", "5", "6", "7", "8"].randomElement(using: &rng)!
        let tabs = Array(["sessions", "flow", "weekly", "map", "heat", "goals", "system"].shuffled(using: &rng).prefix(Int.random(in: 1...7, using: &rng)))
        opts.append("\"fuel\":{\"count\":\(fuel)}")
        opts.append("\"window\":{\"size\":\(Int.random(in: 0...2, using: &rng)),\"tabs\":\(quote(tabs))}")
        return "{\"order\":\(quote(["periods"] + movable)),\"hidden\":\(quote(hidden)),\"opts\":{\(opts.joined(separator: ","))}}"
    }
    static func dashboardGroup(_ rng: inout Seeded) -> String {
        let rest = ["tokens", "weekly", "resources", "sessions"].shuffled(using: &rng)
        let hidden = Array(["tokens", "weekly", "resources"].shuffled(using: &rng).prefix(Int.random(in: 0...2, using: &rng)))
        let weekly = ["2", "4", "6", "null"].randomElement(using: &rng)!, sessions = ["3", "5", "10", "null"].randomElement(using: &rng)!
        return "{\"order\":\(quote(["periods"] + rest)),\"hidden\":\(quote(hidden)),\"opts\":{\"tokens\":{\"size\":\(Int.random(in: 0...2, using: &rng))},\"weekly\":{\"count\":\(weekly)},\"sessions\":{\"count\":\(sessions)}}}"
    }

    // MARK: G2
    static func overlap(_ a: CGRect, _ b: CGRect) -> Bool { let i = a.intersection(b); return !i.isNull && i.width > 0.5 && i.height > 0.5 }
    /// Inside the housing: its box, upper corners round about the dials' centres (rx = ry), lower corners rb.
    static func inside(_ p: CGPoint, housing h: CGRect, r: CGFloat, rb: CGFloat) -> Bool {
        guard p.x >= h.minX - 0.5, p.x <= h.maxX + 0.5, p.y >= h.minY - 0.5, p.y <= h.maxY + 0.5 else { return false }
        func corner(_ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ sx: CGFloat, _ sy: CGFloat) -> Bool {
            let dx = (p.x - cx) * sx, dy = (p.y - cy) * sy
            return dx <= 0 || dy <= 0 || pow(dx / rx, 2) + pow(dy / ry, 2) <= 1.01
        }
        return corner(h.minX + r, h.minY + r, r, r, -1, -1) && corner(h.maxX - r, h.minY + r, r, r, 1, -1)
            && corner(h.maxX - rb, h.maxY - rb, rb, rb, 1, 1) && corner(h.minX + rb, h.maxY - rb, rb, rb, -1, 1)
    }
    static func geometry(_ raw: String, _ label: String, zoom: Double) -> Int {
        let layout = PanelLayout(store: store(raw), measuring: true), g = layout.group, cluster = layout.cluster
        let host = host(layout, zoom: zoom), m = QuickMetrics(zoom: CGFloat(zoom)), width = m(440)
        let frames = layout.frames, marks = layout.marks
        // What shows, top to bottom: the period buttons, the dials, then the layout's order without the hidden.
        let want = layout.parts
        let seen = frames.keys.sorted { frames[$0]!.minY < frames[$1]!.minY }
        check(seen == want, "\(label): shown \(seen.map(\.rawValue)) ≠ \(want.map(\.rawValue))")
        for (id, r) in frames { check(r.minX >= -0.5 && r.maxX <= width + 0.5 && r.minY >= -0.5, "\(label): \(id) outside the panel \(r)") }
        let ids = Array(frames.keys)
        for i in ids.indices { for j in ids.indices where j > i { check(!overlap(frames[ids[i]]!, frames[ids[j]]!), "\(label): \(ids[i]) overlaps \(ids[j])") } }
        guard let gear = marks["gear"] else { failures.append("\(label): no gear"); return 1 }
        check(gear.minX >= 0 && gear.maxX <= width + 0.5 && gear.minY >= 0, "\(label): gear outside the panel \(gear)")
        if cluster, let dials = frames[.dials], let housing = marks["housing"] {
            check(seen.dropFirst(seen.first == .periods ? 1 : 0).first == .dials, "\(label): the dials are not on top")
            // The dials' centres share the housing's upper corners; each dial's rim and every other object stay inside.
            let d = dials.height, r = dials.minX - housing.minX + d / 2
            let circles = [CGPoint(x: dials.minX + d / 2, y: dials.midY), CGPoint(x: dials.maxX - d / 2, y: dials.midY)]
            for c in circles {
                for k in 0..<32 {
                    let a = Double(k) / 32 * 2 * .pi, p = CGPoint(x: c.x + d / 2 * cos(a), y: c.y + d / 2 * sin(a))
                    check(inside(p, housing: housing, r: r, rb: m(26)), "\(label): a dial's rim leaves the housing")
                }
                // The gear sits beside the right dial, never over it.
                let nx = max(gear.minX, min(c.x, gear.maxX)), ny = max(gear.minY, min(c.y, gear.maxY))
                check(hypot(nx - c.x, ny - c.y) >= d / 2, "\(label): the gear covers a dial")
            }
            for (id, f) in frames where id != .periods && id != .dials {
                for p in [CGPoint(x: f.minX, y: f.minY), CGPoint(x: f.maxX, y: f.minY), CGPoint(x: f.minX, y: f.maxY), CGPoint(x: f.maxX, y: f.maxY)] {
                    check(inside(p, housing: housing, r: r, rb: m(26)), "\(label): \(id) leaves the housing at \(p)")
                }
                check(!overlap(gear, f), "\(label): the gear covers \(id)")
            }
        } else if !cluster {
            // The gear ends the first section's heading (its top row), clear of the period buttons.
            let first = want.first { $0 != .periods }
            if let first, let f = frames[first] {
                check(gear.minX >= f.minX && gear.maxX <= f.maxX + m(6) && gear.midY >= f.minY && gear.midY <= f.minY + m(40), "\(label): the gear is not in \(first)'s heading \(gear) \(f)")
            }
            if let periods = frames[.periods] { check(!overlap(gear, periods), "\(label): the gear covers the period buttons") }
        }
        // The edit mode: nothing moves; the marks stay inside the panel and the rings apart.
        layout.open()
        settle()
        for (id, r) in layout.frames {
            guard let was = frames[id] else { continue }
            check(abs(r.minX - was.minX) < 0.01 && abs(r.minY - was.minY) < 0.01 && abs(r.width - was.width) < 0.01 && abs(r.height - was.height) < 0.01,
                  "\(label): \(id) moved in the edit mode \(was) → \(r)")
        }
        let rings = layout.marks.filter { $0.key.hasPrefix("ring:") }
        check(rings.count == want.count, "\(label): \(rings.count) rings for \(want.count) objects")
        // Rings 2 points inside the panel's sides, − and grips 3.
        for (name, r) in layout.marks where name.hasPrefix("ring:") || name.hasPrefix("minus:") || name.hasPrefix("grip:") {
            let edge: CGFloat = name.hasPrefix("ring:") ? 2 : 3
            check(r.minX >= edge - 0.01 && r.maxX <= width - edge + 0.01, "\(label): \(name) outside the panel \(r)")
        }
        for (name, r) in rings {
            if let f = frames[Item(rawValue: String(name.dropFirst(5)))!] { check(f.insetBy(dx: 1.9, dy: 1.9).contains(r), "\(label): \(name) not inside its object") }
            for (other, s) in rings where other > name { check(!overlap(r, s), "\(label): \(name) and \(other) share a line") }
        }
        for id in want {
            let c = layout.caps(id)
            check((layout.marks["minus:" + id.rawValue] != nil) == c.hide, "\(label): \(id)'s − \(c.hide)")
            check((layout.marks["grip:" + id.rawValue] != nil) == (c.size || c.count), "\(label): \(id)'s grip")
        }
        layout.close()
        _ = host
        return 1
    }

    // MARK: G3
    /// Tab until an object has the focus.
    static func focus(_ layout: PanelLayout, _ id: Item) {
        for _ in 0..<12 where layout.focused != id { key(layout, 48) }
        check(layout.focused == id, "Tab reaches \(id)")
    }
    static func key(_ layout: PanelLayout, _ code: UInt16, _ chars: String = "", shift: Bool = false) {
        let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: shift ? [.shift] : [], timestamp: 0, windowNumber: 0, context: nil,
                                 characters: chars, charactersIgnoringModifiers: chars, isARepeat: false, keyCode: code)!
        guard let k = PanelLayout.key(e) else { failures.append("key \(code) not read"); return }
        layout.key(k.0, shift: k.1)
        settle(0.15)
    }
    static func saved(_ s: UserDefaults) -> ScreenLayout { ScreenLayout.read(s.string(forKey: ScreenLayout.key)).layout }
    static func behaviour() {
        let s = store(nil)
        // The quick switch keeps the preset in the layout; a relaunch opens on it.
        var layout = PanelLayout(store: s, measuring: true)
        check(layout.preset == .dashboard && s.string(forKey: ScreenLayout.key) == nil, "nothing stored opens the dashboard")
        layout.choosePreset(.cluster)
        check(saved(s).preset == .cluster && PanelLayout(store: s).preset == .cluster, "the quick switch keeps the cluster")
        host(layout)
        // What each object can change in the panel's cluster.
        check(layout.caps(.dials) == .init(size: true, shape: true) && layout.caps(.periods) == .init(), "the dials and the period buttons stay")
        check(layout.caps(.alerts) == .init(count: true, shape: true, move: true, hide: true) && layout.caps(.window) == .init(size: true, move: true, hide: true), "caps")
        layout.open()
        settle()
        check(layout.editing && layout.frames.count == 6, "the edit mode marks six objects")
        // Reduce Motion: nothing jiggles; otherwise the home-screen cycle, out of step.
        check(!PanelJiggle.moving(editing: true, lifted: false, still: true) && PanelJiggle.moving(editing: true, lifted: false, still: false), "no jiggle with Reduce Motion")
        let j = [0, 0.25, 0.5, 1.125].map(PanelJiggle.at)
        check(j[0] == (-0.3, 0.3) && j[1] == (0, -0.2) && j[2] == (0.3, 0.3) && abs(j[3].angle + 0.15) < 1e-9 && abs(j[3].dy - 0.05) < 1e-9, "the jiggle's cycle")
        check(PanelJiggle.delay(index: 2, element: 0) == 0.1 && PanelJiggle.delay(index: 1, element: 1) == 0, "the jiggle's steps")
        // Keyboard, as the web gate: Tab to the fuel, up twice, − counts from what shows.
        focus(layout, .fuel)
        key(layout, 126); key(layout, 126)
        check(saved(s).presets.cluster.order.firstIndex(of: .fuel)! < saved(s).presets.cluster.order.firstIndex(of: .alerts)!, "arrows move the fuel up")
        let fuelShown = layout.shown[.fuel] ?? 0
        key(layout, 27, "-")
        check(saved(s).presets.cluster.opts[.fuel]?.count == .value(max(3, min(max(fuelShown, 3), 8) - 1)), "− counts down from the \(fuelShown) shown: \(String(describing: saved(s).presets.cluster.opts[.fuel]?.count))")
        focus(layout, .dials)
        key(layout, 125, shift: true)
        check(saved(s).presets.cluster.opts[.dials]?.size == 1, "Shift+↓ makes the dials smaller")
        key(layout, 126)
        check(saved(s).presets.cluster.order.firstIndex(of: .dials) == 1, "the dials do not move")
        // Return opens the object's sheet; the gallery takes a shape at once; closing it goes back to the sheet.
        focus(layout, .alerts)
        key(layout, 36)
        check(layout.sheet == .object(.alerts) && layout.picked == .alerts, "Return opens the object's sheet")
        layout.showGallery(.alerts)
        layout.setShape(.alerts, "badge")
        check(saved(s).presets.cluster.opts[.alerts]?.shape == "badge" && layout.sheet == .gallery(.alerts), "a shape is taken and the gallery stays")
        key(layout, 53)
        check(layout.sheet == .object(.alerts), "closing the gallery goes back to the object's sheet")
        layout.step(.alerts, count: -1)
        check(saved(s).presets.cluster.opts[.alerts]?.count == .value(5), "the sheet's − counts")
        key(layout, 53)
        check(layout.sheet == nil && layout.picked == nil && layout.editing, "Escape closes the sheet first")
        // The grip: 44 points a step, a count sideways, a size along the diagonal, the value as the tip.
        layout.gripChanged(.alerts, start: .zero, at: CGPoint(x: -90, y: 3))
        check(saved(s).presets.cluster.opts[.alerts]?.count == .value(3) && layout.tip == "3개", "the grip counts: \(layout.tip ?? "-")")
        layout.gripEnded()
        layout.gripChanged(.window, start: .zero, at: CGPoint(x: 44, y: 44))
        check(saved(s).presets.cluster.opts[.window]?.size == 2 && layout.tip == "크게", "the grip sizes")
        layout.gripEnded()
        check(layout.tip == nil, "the tip goes with the grip")
        // − hides; a press-drag moves the window above the warnings; a short press picks.
        layout.hide(.odo)
        check(saved(s).presets.cluster.hidden.contains(.odo) && layout.hiddenCount == 1, "− hides")
        settle()
        guard let window = layout.frames[.window], let alerts = layout.frames[.alerts] else { failures.append("no frames to drag"); return }
        let start = CGPoint(x: window.midX, y: window.minY + 20)
        layout.pressChanged(.window, start: start, at: CGPoint(x: start.x, y: start.y - 3))
        check(layout.lifted == nil, "a short press does not lift")
        layout.pressChanged(.window, start: start, at: CGPoint(x: alerts.midX, y: alerts.minY + 2))
        check(layout.lifted == .window && layout.pointer.at != nil, "a drag lifts")
        layout.pressEnded(.window, at: CGPoint(x: alerts.midX, y: alerts.minY + 2))
        let o = saved(s).presets.cluster.order
        check(o.firstIndex(of: .window)! < o.firstIndex(of: .alerts)! && layout.lifted == nil, "the drop moves the window above the warnings: \(o)")
        layout.pressChanged(.fuel, start: .zero, at: .zero)
        layout.pressEnded(.fuel, at: .zero)
        check(layout.picked == .fuel && layout.sheet == .object(.fuel), "a click picks")
        layout.pick(.fuel)
        // The list: ↑↓, the switches (the dials and the period buttons cannot hide), reset.
        layout.showList()
        layout.listMove(.odo, -1)
        let o2 = saved(s).presets.cluster.order
        check(o2 == [.periods, .dials, .fuel, .window, .odo, .alerts, .temps], "the list's ↑ moves a hidden object too: \(o2.map(\.rawValue))")
        layout.setShown(.odo, true)
        check(!saved(s).presets.cluster.hidden.contains(.odo), "the list's switch shows it again")
        // A relaunch reads every change back.
        let before = saved(s)
        layout.close()
        layout = PanelLayout(store: s, measuring: true)
        check(layout.stored.layout == before && !layout.stored.locked, "a relaunch keeps the layout")
        layout.open()
        layout.reset()
        check(saved(s).presets.cluster == ScreenLayout.defaults.presets.cluster && saved(s).presets.dashboard == before.presets.dashboard, "reset starts the preset over")
        // The dashboard preset: its counts step from what shows (all sessions from the number shown), its tokens size.
        layout.choosePreset(.dashboard)
        host(layout)
        layout.open()
        settle()
        let sessionsShown = layout.shown[.sessions] ?? 0
        layout.step(.sessions, count: -1)
        check(saved(s).presets.dashboard.opts[.sessions]?.count == .value(max(3, min(max(sessionsShown, 3), 10) - 1)),
              "sessions count down from the \(sessionsShown) shown: \(String(describing: saved(s).presets.dashboard.opts[.sessions]?.count))")
        layout.step(.weekly, count: 1)
        check(saved(s).presets.dashboard.opts[.weekly]?.count == .value(6), "weekly steps 4 → 6")
        focus(layout, .tokens)
        key(layout, 123, shift: true)
        check(saved(s).presets.dashboard.opts[.tokens]?.size == 1, "Shift+← makes the tokens smaller")
        layout.showList()
        key(layout, 53); key(layout, 53)
        check(!layout.editing, "Escape leaves the edit mode")
        // Every section of the dashboard hidden keeps the gear, so the panel can be customized back.
        let bare = PanelLayout(store: store(#"{"v":1,"presets":{"dashboard":{"hidden":["tokens","weekly","resources","sessions"]}}}"#), measuring: true)
        host(bare)
        check(bare.parts == [.periods] && bare.marks["gear"] != nil, "with every section hidden the gear stays")
                // Outside the edit mode the panel measures nothing (its animations keep no geometry busy); customizing measures.
        let quiet = PanelLayout(store: store(nil))
        host(quiet)
        check(quiet.frames.isEmpty && quiet.marks.isEmpty, "nothing is measured outside the edit mode")
        quiet.open(); settle()
        check(quiet.frames.count == quiet.parts.count, "the edit mode measures every object")
        quiet.close()
                // The window opens on the page last shown while it is a tab, else on the sessions page while that is one, else on
        // the first chosen tab: never on a page without its tab.
        let pick = { (remembered: String, chosen: [ScreenLayout.Mode]?) in ClusterWindow.page(remembered, in: ClusterWindow.tabs(chosen)) }
        check(pick("sessions", [.system, .map]) == "system" && pick("map", [.system, .map]) == "map" && pick("heat", [.map, .sessions]) == "sessions"
              && pick("goals", nil) == "goals" && pick("flow", []) == "flow" && ClusterWindow.tabs([.system, .map]).map(\.0) == ["system", "map"], "the window's page")
                // A newer version's layout shows as the defaults and is never written over.
        let newer = store(#"{"v":2,"preset":"cluster"}"#)
        let locked = PanelLayout(store: newer)
        check(locked.stored.locked && locked.preset == .dashboard, "a newer version's layout shows the defaults")
        locked.open(); locked.hide(.weekly); locked.choosePreset(.cluster); locked.close()
        check(newer.string(forKey: ScreenLayout.key) == #"{"v":2,"preset":"cluster"}"#, "a newer version's layout is never written over")
        newer.removePersistentDomain(forName: suite)
    }

    /// Both presets from the defaults, the edit mode, a sheet of each kind, a drag, the grip's tip, a hidden object's
    /// chip and the three extremes.
    static func screenshots(_ folder: URL) {
        let cluster = #"{"v":1,"preset":"cluster"}"#
        let steps: [(String, String?, (PanelLayout) -> Void)] = [
            ("mac-cluster", cluster, { _ in }), ("mac-dashboard", nil, { _ in }),
            ("mac-cluster-edit", cluster, { $0.open() }), ("mac-cluster-object", cluster, { $0.open(); $0.pick(.alerts) }),
            ("mac-cluster-gallery", cluster, { $0.open(); $0.pick(.alerts); $0.showGallery(.alerts) }),
            ("mac-cluster-list", cluster, { $0.open(); $0.showList() }),
            ("mac-dashboard-edit", nil, { $0.open() }), ("mac-dashboard-object", nil, { $0.open(); $0.pick(.weekly) }),
            ("mac-dashboard-list", nil, { $0.open(); $0.showList() }),
            ("mac-cluster-hidden", cluster, { $0.open(); $0.hide(.odo) }),
            ("mac-cluster-drag", cluster, { l in
                l.open(); settle()
                if let w = l.frames[.window], let a = l.frames[.alerts] {
                    l.pressChanged(.window, start: CGPoint(x: w.midX, y: w.minY + 20), at: CGPoint(x: a.midX + 40, y: a.minY + 6))
                }
            }),
            ("mac-cluster-grip", cluster, { l in l.open(); l.gripChanged(.alerts, start: CGPoint(x: 380, y: 340), at: CGPoint(x: 336, y: 344)) })]
        for (name, raw, act) in steps {
            let layout = PanelLayout(store: store(raw), measuring: true), view = host(layout)
            act(layout)
            settle(0.8)
            shot(view, folder, name)
            layout.close()
        }
        for (i, g) in extremes.enumerated() {
            let layout = PanelLayout(store: store(#"{"v":1,"preset":"cluster","presets":{"cluster":"# + g + "}}"))
            let view = host(layout)
            settle(0.8)
            shot(view, folder, "mac-cluster-extreme\(i + 1)")
        }
        // Tabs that leave out the page last shown: the window opens on the first chosen tab.
        UserDefaults.standard.set("sessions", forKey: "clusterMode")
        let tabs = PanelLayout(store: store(#"{"v":1,"preset":"cluster","presets":{"cluster":{"opts":{"window":{"tabs":["system","map"]}}}}}"#))
        let tabsView = host(tabs)
        settle(0.8)
        shot(tabsView, folder, "mac-cluster-tabs")
        UserDefaults.standard.removeObject(forKey: "clusterMode")
                // English and Chinese: both presets, the edit mode and each sheet.
        for lang in ["en", "zh"] {
            UserDefaults.standard.set(lang, forKey: "dashboardLanguage")
            for (name, raw, act) in steps where ["mac-cluster", "mac-dashboard", "mac-cluster-edit", "mac-cluster-object", "mac-cluster-gallery", "mac-cluster-list",
                                                 "mac-dashboard-edit", "mac-dashboard-object", "mac-dashboard-list"].contains(name) {
                let layout = PanelLayout(store: store(raw), measuring: true), view = host(layout)
                act(layout)
                settle(0.8)
                shot(view, folder, name.replacingOccurrences(of: "mac-", with: "mac-\(lang)-"))
                layout.close()
            }
        }
        UserDefaults.standard.removeObject(forKey: "dashboardLanguage")
    }

    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let args = CommandLine.arguments
        guard args.count > 1 else { fatalError("usage: customize-checks <state.json> [<screenshots folder>]") }
        let snapshot = try JSONDecoder().decode(DesktopSnapshot.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
        model = DashboardModel(baseURL: URL(string: "http://127.0.0.1:9")!)
        model.snapshot = snapshot; model.connected = true; model.now = Date(timeIntervalSince1970: snapshot.updated ?? 0)
        let folder = args.count > 2 && !args[2].hasPrefix("-") ? URL(fileURLWithPath: args[2]) : nil
        if let folder { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        defer {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
            UserDefaults.standard.removePersistentDomain(forName: ProcessInfo.processInfo.processName)
        }
        behaviour()
        var rng = Seeded(state: 46)
        let clusters = extremes + (0..<9).map { _ in clusterGroup(&rng) }, dashboards = (0..<6).map { _ in dashboardGroup(&rng) }
        var drawn = 0
        for zoom in [1.0, 0.8, 1.6] {
            for (i, g) in clusters.enumerated() { drawn += geometry(#"{"v":1,"preset":"cluster","presets":{"cluster":"# + g + "}}", "cluster #\(i) ×\(zoom)", zoom: zoom) }
            for (i, g) in dashboards.enumerated() { drawn += geometry(#"{"v":1,"preset":"dashboard","presets":{"dashboard":"# + g + "}}", "dashboard #\(i) ×\(zoom)", zoom: zoom) }
        }
        if let folder { screenshots(folder) }
        window.contentView = nil
        if !failures.isEmpty {
            for f in failures.prefix(40) { print("FAIL", f) }
            print("\(failures.count) failures")
            exit(1)
        }
        print("Customize checks passed: G2 \(drawn) layouts (\(clusters.count) cluster, \(dashboards.count) dashboard at zoom 0.8, 1, 1.6) inside the panel and the housing, rings apart and nothing moved in the edit mode; G3 keys, grip, drag, sheets, gallery, list, reset, relaunch, the newer-version lock and Reduce Motion")
        // The same again with the other scrollers: a Mac with a mouse (and CI) shows ones that take room, a trackpad doesn't.
        if !args.contains("-AppleShowScrollBars"), let me = Bundle.main.executableURL {
            let again = Process(); again.executableURL = me
            again.arguments = [args[1], "-AppleShowScrollBars", NSScroller.preferredScrollerStyle == .overlay ? "Always" : "WhenScrolling"]
            try again.run(); again.waitUntilExit()
            if again.terminationStatus != 0 { exit(again.terminationStatus) }
        }
    }
}
