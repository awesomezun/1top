import Foundation

/// Customizing (customizing-spec_v1.1.0): which objects each screen shows, in what order, and their size, count and
/// shape, kept on this device under layoutV1. Read exactly as the web reads it (agent/onetop/dist/layout.js): anything
/// unknown, out of range or broken falls back to the defaults, which draw today's screens; a layout written by a newer
/// version is shown as the defaults and never written over. The Mac (desktop/LayoutModel.swift) and the iPhone
/// (ios/OneTop/Model/Layout.swift) keep identical copies, both checked against tests/fixtures/layout_v1.json.
struct ScreenLayout: Equatable, Sendable {
    static let key = "layoutV1", version = 1

    /// The phone's tabs: the dashboard and the cluster each their own, or one home tab.
    enum Tabs: String, Sendable { case two, one }
    enum Preset: String, Sendable { case cluster, dashboard }
    /// The objects of the narrow screens' presets and of the wide cluster screen.
    enum Item: String, CaseIterable, Sendable { case periods, dials, alerts, odo, temps, fuel, window, tokens, weekly, resources, sessions }
    /// The wide dashboard's panels.
    enum Panel: String, CaseIterable, Sendable { case speed, summary, flow, map, sessions, shared }
    /// The cluster window's tabs.
    enum Mode: String, CaseIterable, Sendable { case sessions, flow, weekly, map, heat, goals, system }
    /// The wide dashboard's token speed instrument: the tachometer's sweep or the scope.
    enum Instrument: String, Sendable { case sweep, scope }

    /// An object's options, nil where it has none of that kind: size a step 0–2, count a whole number in its range or
    /// all ('as many as fit' / 'all', stored as null), shape and needle one of its list, the window's tabs in order.
    struct Options: Equatable, Sendable {
        enum Count: Equatable, Sendable { case all, value(Int) }
        var size: Int? = nil, count: Count? = nil, shape: String? = nil, needle: String? = nil, tabs: [Mode]? = nil
    }
    /// One screen's objects: their order, the hidden ones in that order, and each one's options.
    struct Arrangement: Equatable, Sendable { var order: [Item]; var hidden: [Item]; var opts: [Item: Options] }
    /// The wide dashboard: its panels' order, the hidden ones, widths in twelfths, the heights set by hand, the
    /// instrument and its width, and the session rows (nil for as many as fit).
    struct Dashboard: Equatable, Sendable {
        static let spans: [Panel: Int] = [.speed: 3, .summary: 9, .flow: 6, .map: 6, .sessions: 12, .shared: 12]
        var panels: [Panel]; var hidden: [Panel]; var spans: [Panel: Int]; var heights: [Panel: Int]
        var instrument: Instrument; var instrumentWidth: Int?; var rows: Int?
    }
    struct Presets: Equatable, Sendable {
        var cluster: Arrangement, dashboard: Arrangement
        subscript(preset: Preset) -> Arrangement {
            get { preset == .cluster ? cluster : dashboard }
            set { if preset == .cluster { cluster = newValue } else { dashboard = newValue } }
        }
    }
    struct Wide: Equatable, Sendable { var dashboard: Dashboard; var cluster: Arrangement }
    /// The old settings taken over the first time nothing is stored: the web dashboard's own entry
    /// (onetop.dashboard.v1, which the Mac and the iPhone do not have) and the panel's chosen view (quickCluster).
    struct Legacy: Sendable { var dashboard: String? = nil; var quickCluster: Bool? = nil }
    /// locked: a newer version wrote it; show the defaults and do not save over it.
    struct Stored: Equatable, Sendable { var layout: ScreenLayout; var locked: Bool }

    var tabs: Tabs, preset: Preset, presets: Presets, wide: Wide

    /// What an object can change: its size step, its count's range and default (with the steps it snaps to), its
    /// shapes and needles (the first is today's; 'auto' is each screen's own: the tray's period buttons, the phone's
    /// and dashboard's drum), and the window's tabs.
    struct Kind: Sendable {
        var size: Int? = nil
        var counts: ClosedRange<Int>? = nil, count: Options.Count? = nil, steps: [Int]? = nil
        var shapes: [String]? = nil, needles: [String]? = nil, tabs = false
    }
    /// A screen's defaults: today's order and hidden objects; plain objects have no options there.
    struct Base: Sendable {
        static let cluster = Base(order: [.periods, .dials, .alerts, .odo, .temps, .fuel, .window], hidden: [.temps])
        static let dashboard = Base(order: [.periods, .tokens, .weekly, .resources, .sessions], hidden: [], plain: [.periods])
        static let wideCluster = Base(order: [.periods, .dials, .alerts, .odo, .temps, .fuel, .window], hidden: [])
        var order: [Item]; var hidden: [Item]; var plain: [Item] = []
    }

    static var defaults: ScreenLayout {
        // The panels open on the dashboard today, so the dashboard preset comes first until one is chosen.
        ScreenLayout(tabs: .two, preset: .dashboard,
                     presets: Presets(cluster: readArrangement(nil, .cluster), dashboard: readArrangement(nil, .dashboard)),
                     wide: Wide(dashboard: readDashboard(nil), cluster: readArrangement(nil, .wideCluster)))
    }

    /// raw is the stored text or nil.
    static func read(_ raw: String?, legacy: Legacy = Legacy()) -> Stored {
        guard let raw, !raw.isEmpty else { return Stored(layout: fromLegacy(legacy), locked: false) }
        guard let v = object(raw), case .number(let version)? = v["v"], version.isFinite else { return Stored(layout: defaults, locked: false) }
        if version > Double(Self.version) { return Stored(layout: defaults, locked: true) }
        var layout = defaults
        if case .string(let s)? = v["tabs"], let tabs = Tabs(rawValue: s) { layout.tabs = tabs }
        if case .string(let s)? = v["preset"], let preset = Preset(rawValue: s) { layout.preset = preset }
        if let presets = v["presets"], presets.isObject {
            layout.presets = Presets(cluster: readArrangement(presets["cluster"], .cluster), dashboard: readArrangement(presets["dashboard"], .dashboard))
        }
        if let wide = v["wide"], wide.isObject {
            layout.wide = Wide(dashboard: readDashboard(wide["dashboard"]), cluster: readArrangement(wide["cluster"], .wideCluster))
        }
        return Stored(layout: layout, locked: false)
    }

    /// The stored form: the layout read back as any stored one is, keys in a fixed order so every platform writes the
    /// same text.
    static func write(_ layout: ScreenLayout) -> String { read(layout.json.text).layout.json.text }

    /// This device's layout; the first time, the panel's chosen view is taken over.
    static func load(from store: UserDefaults = .standard) -> Stored {
        read(store.string(forKey: key), legacy: Legacy(quickCluster: store.object(forKey: "quickCluster") as? Bool))
    }

    /// Keeps the layout on this device, never over one a newer version wrote.
    @discardableResult static func save(_ stored: Stored, to store: UserDefaults = .standard) -> Bool {
        guard !stored.locked else { return false }
        store.set(write(stored.layout), forKey: key)
        return true
    }

    /// An object's options as today's screens draw it.
    static func options(_ id: Item, plain: Bool = false) -> Options {
        let k = plain ? Kind() : id.kind
        return Options(size: k.size, count: k.count, shape: k.shapes?.first, needle: k.needles?.first, tabs: k.tabs ? Mode.allCases : nil)
    }

    private static func readOptions(_ id: Item, _ raw: JSON?, plain: Bool) -> Options {
        let k = plain ? Kind() : id.kind
        var o = options(id, plain: plain)
        guard let raw, raw.isObject else { return o }
        if k.size != nil, let n = whole(raw["size"]) { o.size = clamp(n, 0...2) }
        if let counts = k.counts {
            if case .null? = raw["count"] { o.count = k.count == .all || id == .weekly ? .all : k.count }
            else if let n = whole(raw["count"]) {
                if let steps = k.steps { o.count = .value(steps.dropFirst().reduce(steps[0]) { abs(Double($1) - n) < abs(Double($0) - n) ? $1 : $0 }) }
                else { o.count = .value(clamp(n, counts)) }
            }
        }
        if let shapes = k.shapes, case .string(let s)? = raw["shape"], shapes.contains(s) { o.shape = s }
        if let needles = k.needles, case .string(let s)? = raw["needle"], needles.contains(s) { o.needle = s }
        if k.tabs, case .array(let items)? = raw["tabs"] {
            var tabs: [Mode] = []
            for case .string(let s) in items { if let mode = Mode(rawValue: s), !tabs.contains(mode) { tabs.append(mode) } }
            if !tabs.isEmpty { o.tabs = tabs }
        }
        return o
    }

    /// Known IDs once each, in the stored order; a missing one goes back right after the nearest earlier one it follows
    /// by default (or first).
    private static func readOrder<ID: RawRepresentable & Equatable>(_ raw: JSON?, _ base: [ID]) -> [ID] where ID.RawValue == String {
        var out: [ID] = []
        if case .array(let items)? = raw {
            for case .string(let s) in items { if let id = base.first(where: { $0.rawValue == s }), !out.contains(id) { out.append(id) } }
        }
        for (i, id) in base.enumerated() where !out.contains(id) {
            var at = 0
            for earlier in base[..<i].reversed() { if let k = out.firstIndex(of: earlier) { at = k + 1; break } }
            out.insert(id, at: at)
        }
        return out
    }

    private static func readHidden<ID: RawRepresentable>(_ raw: JSON?, _ order: [ID]) -> [ID]? where ID.RawValue == String {
        guard case .array(let items)? = raw else { return nil }
        return order.filter { items.contains(.string($0.rawValue)) }
    }

    private static func readArrangement(_ raw: JSON?, _ base: Base) -> Arrangement {
        var a = Arrangement(order: base.order, hidden: base.hidden,
                            opts: Dictionary(uniqueKeysWithValues: base.order.map { ($0, options($0, plain: base.plain.contains($0))) }))
        guard let raw, raw.isObject else { return a }
        a.order = readOrder(raw["order"], base.order)
        if let hidden = readHidden(raw["hidden"], a.order) { a.hidden = hidden }
        // Nothing left to show would be an empty screen: start that screen over.
        if a.hidden.count >= a.order.count { return readArrangement(nil, base) }
        if let opts = raw["opts"], opts.isObject {
            for id in base.order { a.opts[id] = readOptions(id, opts[id.rawValue], plain: base.plain.contains(id)) }
        }
        return a
    }

    private static func readDashboard(_ raw: JSON?) -> Dashboard {
        var d = Dashboard(panels: Panel.allCases, hidden: [], spans: Dashboard.spans, heights: [:], instrument: .sweep, instrumentWidth: nil, rows: nil)
        guard let raw, raw.isObject else { return d }
        d.panels = readOrder(raw["panels"], Panel.allCases)
        // Every panel hidden would be an empty screen: they all stay.
        if let hidden = readHidden(raw["hidden"], d.panels), hidden.count < d.panels.count { d.hidden = hidden }
        if let spans = raw["spans"], spans.isObject {
            for id in Panel.allCases { if let n = whole(spans[id.rawValue]) { d.spans[id] = clamp(n, id == .summary ? 6...12 : 3...12) } }
        }
        if let heights = raw["heights"], heights.isObject {
            for id in Panel.allCases { if let n = whole(heights[id.rawValue]) { d.heights[id] = clamp(n, id == .sessions ? 250...1200 : 150...1200) } }
        }
        if case .string(let s)? = raw["instrument"], let instrument = Instrument(rawValue: s) { d.instrument = instrument }
        if let n = whole(raw["instrumentWidth"]) { d.instrumentWidth = clamp(n, 200...600) }
        // null, like anything but a number, leaves as many rows as fit.
        if let n = whole(raw["rows"]) { d.rows = clamp(n, 3...50) }
        return d
    }

    /// The dashboard's own saved panels and the panel's chosen view are taken over once, the first time nothing has
    /// been saved under the new key.
    private static func fromLegacy(_ legacy: Legacy) -> ScreenLayout {
        var layout = defaults
        if let d = object(legacy.dashboard) {
            // Only its panels, widths, heights and instrument.
            let kept = ["panels", "spans", "heights", "instrument", "instrumentWidth"].compactMap { k in d[k].map { (key: k, value: $0) } }
            layout.wide.dashboard = readDashboard(.object(kept))
        }
        if let cluster = legacy.quickCluster { layout.preset = cluster ? .cluster : .dashboard }
        return layout
    }

    /// The text as JSON when it is a JSON object, else nil.
    private static func object(_ text: String?) -> JSON? { text.flatMap(JSON.parse).flatMap { $0.isObject ? $0 : nil } }

    /// A finite number rounded as JavaScript's Math.round rounds it (halves toward +∞); text, null or anything else is nil.
    private static func whole(_ v: JSON?) -> Double? {
        guard case .number(let n)? = v, n.isFinite else { return nil }
        let down = n.rounded(.down)
        return n - down >= 0.5 ? down + 1 : down
    }

    private static func clamp(_ v: Double, _ range: ClosedRange<Int>) -> Int { Int(max(Double(range.lowerBound), min(Double(range.upperBound), v))) }
}

extension ScreenLayout.Item {
    var kind: ScreenLayout.Kind {
        switch self {
        case .periods: .init(shapes: ["auto", "tabs", "drum", "tuner", "roller", "knob", "lever"])
        case .dials: .init(size: 2, shapes: ["ring", "glow", "plate"], needles: ["default", "red", "amber"])
        case .alerts: .init(counts: 3...6, count: .value(6), shapes: ["label", "chips", "strip", "count", "badge", "lens"])
        case .odo: .init(shapes: ["drum", "led", "led0", "print", "print0"])
        case .temps, .resources: .init()
        case .fuel: .init(counts: 3...8, count: .all)
        case .window: .init(size: 1, tabs: true)
        case .tokens: .init(size: 2)
        case .weekly: .init(counts: 2...6, count: .value(4), steps: [2, 4, 6])
        case .sessions: .init(counts: 3...10, count: .all)
        }
    }
}

// The stored form, keys in layout.js's order.
extension ScreenLayout {
    var json: JSON {
        .object([("v", .number(Double(Self.version))), ("tabs", .string(tabs.rawValue)), ("preset", .string(preset.rawValue)),
                 ("presets", .object([("cluster", presets.cluster.json), ("dashboard", presets.dashboard.json)])),
                 ("wide", .object([("dashboard", wide.dashboard.json), ("cluster", wide.cluster.json)]))])
    }
    fileprivate static func ids<ID: RawRepresentable>(_ list: [ID]) -> JSON where ID.RawValue == String { .array(list.map { .string($0.rawValue) }) }
    fileprivate static func number(_ n: Int?) -> JSON { n.map { .number(Double($0)) } ?? .null }
}

extension ScreenLayout.Options {
    var json: ScreenLayout.JSON {
        var pairs: [(key: String, value: ScreenLayout.JSON)] = []
        if let size { pairs.append(("size", .number(Double(size)))) }
        if let count {
            switch count {
            case .all: pairs.append(("count", .null))
            case .value(let n): pairs.append(("count", .number(Double(n))))
            }
        }
        if let shape { pairs.append(("shape", .string(shape))) }
        if let needle { pairs.append(("needle", .string(needle))) }
        if let tabs { pairs.append(("tabs", ScreenLayout.ids(tabs))) }
        return .object(pairs)
    }
}

extension ScreenLayout.Arrangement {
    var json: ScreenLayout.JSON {
        .object([("order", ScreenLayout.ids(order)), ("hidden", ScreenLayout.ids(hidden)),
                 ("opts", .object(ScreenLayout.Item.allCases.compactMap { id in opts[id].map { (key: id.rawValue, value: $0.json) } }))])
    }
}

extension ScreenLayout.Dashboard {
    var json: ScreenLayout.JSON {
        let panels = ScreenLayout.Panel.allCases
        return .object([("panels", ScreenLayout.ids(self.panels)), ("hidden", ScreenLayout.ids(hidden)),
                        ("spans", .object(panels.compactMap { id in spans[id].map { (key: id.rawValue, value: .number(Double($0))) } })),
                        ("heights", .object(panels.compactMap { id in heights[id].map { (key: id.rawValue, value: .number(Double($0))) } })),
                        ("instrument", .string(instrument.rawValue)), ("instrumentWidth", ScreenLayout.number(instrumentWidth)),
                        ("rows", ScreenLayout.number(rows))])
    }
}

extension ScreenLayout {
    /// A JSON value as JavaScript's JSON.parse gives it: numbers as doubles (too large ones infinite), an object's keys
    /// in first-seen order with a repeated key's last value, and nothing outside the JSON grammar.
    enum JSON: Equatable, Sendable {
        case null, bool(Bool), number(Double), string(String), array([JSON]), object([(key: String, value: JSON)])

        subscript(key: String) -> JSON? {
            if case .object(let pairs) = self { pairs.first { $0.key == key }?.value } else { nil }
        }
        var isObject: Bool { if case .object = self { true } else { false } }

        static func == (a: JSON, b: JSON) -> Bool {
            switch (a, b) {
            case (.null, .null): true
            case let (.bool(x), .bool(y)): x == y
            case let (.number(x), .number(y)): x == y
            case let (.string(x), .string(y)): x == y
            case let (.array(x), .array(y)): x == y
            // Objects are the same whatever their keys' order.
            case let (.object(x), .object(y)): x.count == y.count && x.allSatisfy { p in y.contains { $0.key == p.key && $0.value == p.value } }
            default: false
            }
        }

        /// As JSON.stringify writes it; a layout's numbers are all whole.
        var text: String {
            switch self {
            case .null: "null"
            case .bool(let b): b ? "true" : "false"
            case .number(let n): n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : "\(n)"
            case .string(let s): Self.quote(s)
            case .array(let items): "[" + items.map(\.text).joined(separator: ",") + "]"
            case .object(let pairs): "{" + pairs.map { Self.quote($0.key) + ":" + $0.value.text }.joined(separator: ",") + "}"
            }
        }

        private static func quote(_ s: String) -> String {
            var out = "\""
            for c in s.unicodeScalars {
                switch c {
                case "\"": out += "\\\""
                case "\\": out += "\\\\"
                case "\u{8}": out += "\\b"
                case "\u{C}": out += "\\f"
                case "\n": out += "\\n"
                case "\r": out += "\\r"
                case "\t": out += "\\t"
                case _ where c.value < 0x20: out += "\\u00" + (c.value < 0x10 ? "0" : "") + String(c.value, radix: 16)
                default: out.unicodeScalars.append(c)
                }
            }
            return out + "\""
        }

        /// JSON.parse, or nil where it would throw.
        static func parse(_ text: String) -> JSON? {
            var reader = Reader(s: Array(text.unicodeScalars))
            return reader.document()
        }
    }

    /// Reads JSON with the open arrays and objects on a list of its own rather than the call stack, so no depth of
    /// nesting can overflow it. Arrays and objects nested past anything a layout reads are kept empty, so freeing them
    /// cannot overflow it either.
    private struct Reader {
        enum Open { case array([JSON]), object([(key: String, value: JSON)], key: String) }
        static let deepest = 32
        let s: [Unicode.Scalar]
        var i = 0
        var next: Unicode.Scalar? { i < s.count ? s[i] : nil }

        mutating func eat(_ c: Unicode.Scalar) -> Bool {
            guard next == c else { return false }
            i += 1
            return true
        }
        mutating func skip() { while let c = next, c == " " || c == "\t" || c == "\n" || c == "\r" { i += 1 } }

        mutating func document() -> JSON? {
            var open: [Open] = []
            while true {
                skip()
                var value: JSON
                if eat("[") {
                    skip()
                    if eat("]") { value = .array([]) } else { open.append(.array([])); continue }
                } else if eat("{") {
                    skip()
                    if eat("}") { value = .object([]) } else { guard let k = key() else { return nil }; open.append(.object([], key: k)); continue }
                } else {
                    guard let v = scalar() else { return nil }
                    value = v
                }
                // Close every array and object this value completes.
                closing: while true {
                    skip()
                    let kept = open.count <= Self.deepest
                    switch open.popLast() {
                    case nil: return i == s.count ? value : nil
                    case .array(var items)?:
                        if kept { items.append(value) }
                        if eat(",") { open.append(.array(items)); break closing }
                        guard eat("]") else { return nil }
                        value = .array(items)
                    case .object(var pairs, let k)?:
                        if let at = pairs.firstIndex(where: { $0.key == k }) { pairs[at].value = value } else if kept { pairs.append((k, value)) }
                        if eat(",") {
                            skip()
                            guard let k = key() else { return nil }
                            open.append(.object(pairs, key: k))
                            break closing
                        }
                        guard eat("}") else { return nil }
                        value = .object(pairs)
                    }
                }
            }
        }

        mutating func key() -> String? {
            guard next == "\"", let k = string() else { return nil }
            skip()
            return eat(":") ? k : nil
        }

        mutating func scalar() -> JSON? {
            switch next {
            case "\"": string().map(JSON.string)
            case "t": literal("true", .bool(true))
            case "f": literal("false", .bool(false))
            case "n": literal("null", .null)
            default: number().map(JSON.number)
            }
        }

        mutating func literal(_ word: String, _ value: JSON) -> JSON? {
            for c in word.unicodeScalars { guard eat(c) else { return nil } }
            return value
        }

        /// Kept as UTF-16, as JavaScript keeps it, so an escaped pair joins; a lone half can never be a known ID and
        /// reads as U+FFFD.
        mutating func string() -> String? {
            guard eat("\"") else { return nil }
            var units: [UInt16] = []
            while let c = next {
                i += 1
                switch c {
                case "\"": return String(decoding: units, as: UTF16.self)
                case "\\":
                    guard let e = next else { return nil }
                    i += 1
                    switch e {
                    case "\"", "\\", "/": units.append(UInt16(e.value))
                    case "b": units.append(0x8)
                    case "f": units.append(0xC)
                    case "n": units.append(0xA)
                    case "r": units.append(0xD)
                    case "t": units.append(0x9)
                    case "u":
                        guard i + 4 <= s.count, s[i..<i + 4].allSatisfy(\.properties.isASCIIHexDigit),
                              let u = UInt16(text(i..<i + 4), radix: 16) else { return nil }
                        i += 4
                        units.append(u)
                    default: return nil
                    }
                case _ where c.value < 0x20: return nil
                default: UTF16.encode(c) { units.append($0) }
                }
            }
            return nil
        }

        /// -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?, rounded to the nearest double as JavaScript rounds it.
        mutating func number() -> Double? {
            let start = i
            _ = eat("-")
            if !eat("0") { guard digits() else { return nil } }
            if eat("."), !digits() { return nil }
            if eat("e") || eat("E") {
                _ = eat("+") || eat("-")
                guard digits() else { return nil }
            }
            return Double(text(start..<i))
        }

        mutating func digits() -> Bool {
            let start = i
            while let c = next, ("0"..."9").contains(c) { i += 1 }
            return i > start
        }

        func text(_ range: Range<Int>) -> String {
            var t = ""
            t.unicodeScalars.append(contentsOf: s[range])
            return t
        }
    }
}
