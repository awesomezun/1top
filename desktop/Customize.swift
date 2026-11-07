import AppKit
import SwiftUI

// Customizing the menu bar panel (customizing-spec_v1.2.2), as the web tray customizes itself (agent/onetop/dist/
// customize.js with quick.js as its host): the gear opens an edit mode over the preset shown; its objects jiggle like a
// home screen's, − hides one, a press-drag moves it, the corner grip sizes or counts it with the value above the
// pointer, a click opens its own sheet (size, count, shape into the gallery, shown) and 목록 lists every object. Each
// change is kept at once on this Mac (layoutV1), never over a layout a newer version wrote. The dials stay on top, the
// period buttons stay in their place, and the panel's cluster draws no CPU and memory (its resources page has them).

/// The customizing screens' words, as customize.js names them.
enum PanelWords {
    typealias Item = ScreenLayout.Item
    static let sizes = ["작게", "보통", "크게"]
    static let names: [Item: String] = [.periods: "기간 선택", .dials: "두 계기", .alerts: "경고등", .odo: "합계·트립", .temps: "CPU·메모리",
                                        .fuel: "남은 한도", .window: "창(탭)", .tokens: "토큰 사용", .weekly: "계정 한도",
                                        .resources: "CPU·메모리", .sessions: "세션 목록"]
    static let shapes: [Item: [(key: String, name: String)]] = [
        .periods: [("auto", "이 화면 기본"), ("tabs", "탭"), ("drum", "드럼"), ("tuner", "튜너"), ("roller", "롤러"), ("knob", "노브"), ("lever", "레버")],
        .dials: [("ring", "고리"), ("glow", "빛"), ("plate", "판")],
        .alerts: [("label", "이름표"), ("chips", "칩"), ("strip", "띠"), ("count", "숫자"), ("badge", "배지"), ("lens", "렌즈")],
        .odo: [("drum", "O5 드럼"), ("led", "O1 LED"), ("led0", "O2 LED 0 채움"), ("print", "O3 인쇄"), ("print0", "O4 인쇄 0 채움")]]
    static let units: [Item: String] = [.fuel: "칸", .alerts: "개", .weekly: "칸", .sessions: "줄"]
    static func name(_ id: Item) -> String { names[id] ?? id.rawValue }
    /// A count as the tip and the sheets say it: 6개, 4칸, 자동 for the fuel's as many as fit, 모두 for all.
    static func count(_ id: Item, _ v: ScreenLayout.Options.Count?) -> String {
        guard case .value(let n)? = v else { return id == .fuel ? "자동" : "모두" }
        return "\(n)" + (units[id] ?? "")
    }
    /// The shape stored for an object, or its first.
    static func shape(_ id: Item, _ key: String?) -> (key: String, name: String)? {
        guard let list = shapes[id], let first = list.first else { return nil }
        return list.first { $0.key == key } ?? first
    }
}

/// Where the pointer is while an object or a grip is held; apart from the layout, so only the ghost, the drop line and
/// the value tip redraw as it moves.
final class PanelPointer: ObservableObject {
    @Published var at: CGPoint?
}

/// The panel's layout and its edit mode. Every object is measured in the panel's own space (space), where the press,
/// the drag and the marks are placed.
final class PanelLayout: ObservableObject {
    typealias Item = ScreenLayout.Item
    typealias Count = ScreenLayout.Options.Count
    enum Sheet: Equatable { case object(Item), gallery(Item), list }
    /// What an object can change here (customize.js caps with the tray's narrowing): the period buttons stay as they
    /// are, the dials stay on top and shown.
    struct Caps: Equatable { var size = false, count = false, shape = false, move = false, hide = false }
    enum Key { case up, down, left, right, tab, enter, escape, minus, plus }
    static let space = "onetop.panel"

    @Published private(set) var stored: ScreenLayout.Stored
    @Published private(set) var editing = false
    @Published private(set) var picked: Item?
    @Published private(set) var sheet: Sheet?
    @Published private(set) var focused: Item?
    /// The object a press-drag lifted, and the one whose grip is held.
    @Published private(set) var lifted: Item?
    @Published private(set) var gripped: Item?
    let pointer = PanelPointer()
    /// As drawn: each object's frame in the panel's space, how many items an object with a count shows now, and the
    /// marks' frames (ring, −, grip, the gear, the housing) for the checks. Frames are measured only while customizing
    /// (or when the checks measure), so the panel's own animations outside it do not keep them busy.
    var frames: [Item: CGRect] = [:]
    var shown: [Item: Int] = [:]
    var marks: [String: CGRect] = [:]
    /// nil keeps the layout in memory only (the UI tests).
    private let store: UserDefaults?
    private let measuring: Bool
    var measures: Bool { editing || measuring }
    private var monitor: Any?
    private var press: (id: Item, moved: Bool)?
    private var hold: (id: Item, start: CGPoint, size: Int, at: Int)?

    init(store: UserDefaults? = .standard, measuring: Bool = false) {
        self.store = store
        self.measuring = measuring
        stored = store.map { ScreenLayout.load(from: $0) } ?? ScreenLayout.read(nil)
    }
    deinit { if let monitor { NSEvent.removeMonitor(monitor) } }

    var preset: ScreenLayout.Preset { stored.layout.preset }
    var cluster: Bool { preset == .cluster }
    var group: ScreenLayout.Arrangement { stored.layout.presets[preset] }
    func opts(_ id: Item) -> ScreenLayout.Options { group.opts[id] ?? ScreenLayout.options(id) }
    /// What each preset can show in the panel.
    var known: [Item] { cluster ? [.periods, .dials, .alerts, .odo, .fuel, .window] : [.periods, .tokens, .weekly, .resources, .sessions] }
    /// The objects shown, top to bottom: the period buttons first, the cluster's dials right under them, then the rest
    /// in the layout's order.
    var parts: [Item] {
        let g = group
        let rest = g.order.filter { known.contains($0) && $0 != .periods && $0 != .dials && !g.hidden.contains($0) }
        return (g.hidden.contains(.periods) ? [] : [.periods]) + (cluster ? [.dials] : []) + rest
    }
    func caps(_ id: Item) -> Caps {
        let k = id.kind, fixed = id == .periods
        return Caps(size: k.size != nil, count: k.counts != nil, shape: k.shapes != nil && !fixed, move: !fixed && id != .dials, hide: !fixed && id != .dials)
    }
    /// Hidden objects this preset could show, for the chip that leads to the list.
    var hiddenCount: Int { group.hidden.filter(known.contains).count }

    // MARK: Edit mode
    func open() {
        guard !editing else { return }
        editing = true; picked = nil; sheet = nil; focused = nil
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, let k = Self.key(event) else { return event }
            return self.key(k.0, shift: k.1) ? nil : event
        }
    }
    func close() {
        guard editing else { return }
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        editing = false; picked = nil; sheet = nil; focused = nil; lifted = nil; gripped = nil; press = nil; hold = nil; pointer.at = nil
    }
    /// A click picks an object (its sheet opens and the rest fade) or lets it go; the gallery and the list stay up.
    func pick(_ id: Item?, toggle: Bool = true) {
        picked = toggle && picked == id ? nil : id
        if let id = picked { focused = id }
        switch sheet {
        case .gallery?, .list?: break
        default: sheet = picked.map(Sheet.object)
        }
    }
    func showList() { picked = nil; sheet = .list }
    func showGallery(_ id: Item) { sheet = .gallery(id) }
    /// Closing the gallery goes back to the object's own sheet; closing that one lets the object go.
    func closeSheet() {
        if case .gallery(let id)? = sheet, picked == id { sheet = .object(id) } else { picked = nil; sheet = nil }
    }

    // MARK: Changes, each kept at once
    private func change(_ edit: (inout ScreenLayout.Arrangement) -> Void) {
        var next = stored.layout
        edit(&next.presets[next.preset])
        // Held as it is stored: hidden objects in their order, every value in its range.
        stored.layout = ScreenLayout.read(next.json.text).layout
        save()
    }
    private func save() { if let store { ScreenLayout.save(stored, to: store) } }
    /// The header's quick switch and the edit mode's segments: the preset goes into the layout (and the panel's old
    /// key, for an older version of the app).
    func choosePreset(_ preset: ScreenLayout.Preset) {
        stored.layout.preset = preset
        store?.set(preset == .cluster, forKey: "quickCluster")
        picked = nil; sheet = nil; focused = nil
        save()
    }
    func hide(_ id: Item) {
        if picked == id { picked = nil; sheet = nil }
        change { if !$0.hidden.contains(id) { $0.hidden.append(id) } }
    }
    func setShown(_ id: Item, _ on: Bool) {
        if !on && picked == id { picked = nil; sheet = nil }
        change { g in g.hidden = on ? g.hidden.filter { $0 != id } : g.hidden.contains(id) ? g.hidden : g.hidden + [id] }
    }
    func setSize(_ id: Item, _ size: Int) { change { $0.opts[id, default: ScreenLayout.options(id)].size = max(0, min(2, size)) } }
    func setCount(_ id: Item, _ count: Count) { change { $0.opts[id, default: ScreenLayout.options(id)].count = count } }
    func setShape(_ id: Item, _ shape: String) { change { $0.opts[id, default: ScreenLayout.options(id)].shape = shape } }
    func step(_ id: Item, size d: Int) { setSize(id, (opts(id).size ?? 2) + d) }
    func step(_ id: Item, count d: Int) {
        let s = countSteps(id)
        guard !s.isEmpty else { return }
        setCount(id, s[max(0, min(s.count - 1, startAt(id, s) + d))])
    }
    /// A count's steps, all ('as many as fit' / 'all') last where it has one.
    func countSteps(_ id: Item) -> [Count] {
        let k = id.kind
        if let steps = k.steps { return steps.map(Count.value) + [.all] }
        guard let range = k.counts else { return [] }
        return range.map(Count.value) + (k.count == .all ? [.all] : [])
    }
    /// Where a count stands among its steps; all stands at the number shown now.
    func startAt(_ id: Item, _ s: [Count]) -> Int {
        if let v = opts(id).count, v != .all { return s.firstIndex(of: v) ?? 0 }
        guard let n = shown[id] else { return s.count - 1 }
        return s.firstIndex { if case .value(let x) = $0 { x >= n } else { false } } ?? s.count - 2
    }
    /// One place up or down among the objects shown that move.
    func move(_ id: Item, back: Bool) {
        let movable = parts.filter { caps($0).move }
        guard let i = movable.firstIndex(of: id), movable.indices.contains(i + (back ? -1 : 1)) else { return }
        let other = movable[i + (back ? -1 : 1)]
        change { g in
            g.order.removeAll { $0 == id }
            let at = g.order.firstIndex(of: other) ?? g.order.count
            g.order.insert(id, at: back ? at : at + 1)
        }
    }
    /// The list's ↑↓: among every object of the list that moves, shown or hidden.
    func listMove(_ id: Item, _ d: Int) {
        let movable = group.order.filter { known.contains($0) && caps($0).move }
        guard let i = movable.firstIndex(of: id), movable.indices.contains(i + d) else { return }
        let other = movable[i + d]
        change { g in
            g.order.removeAll { $0 == id }
            let at = g.order.firstIndex(of: other) ?? g.order.count
            g.order.insert(id, at: d < 0 ? at : at + 1)
        }
    }
    func reset() {
        let preset = self.preset
        picked = nil
        change { $0 = ScreenLayout.defaults.presets[preset] }
    }

    // MARK: Pointer
    /// A press on an object: past 6 points it lifts and follows the pointer (a mouse needs no long press); a short
    /// click picks it.
    func pressChanged(_ id: Item, start: CGPoint, at p: CGPoint) {
        if press?.id != id { press = (id, false) }
        if press?.moved == false, hypot(p.x - start.x, p.y - start.y) > 6 {
            press?.moved = true
            if caps(id).move { lifted = id; picked = nil; if case .object? = sheet { sheet = nil } }
        }
        if lifted == id { pointer.at = p }
    }
    func pressEnded(_ id: Item, at p: CGPoint) {
        let moved = press?.moved == true
        if lifted == id { drop(id, at: p) } else if !moved { pick(id) }
        press = nil; lifted = nil; pointer.at = nil
    }
    /// Where a lifted object would land: before the first object that moves whose middle is below the pointer, else
    /// after the last.
    func target(_ id: Item, at p: CGPoint) -> (before: Item?, frame: CGRect?) {
        let list = parts.filter { caps($0).move && $0 != id }
        for other in list { if let r = frames[other], p.y < r.midY { return (other, r) } }
        return (nil, list.last.flatMap { frames[$0] })
    }
    func drop(_ id: Item, at p: CGPoint) {
        let before = target(id, at: p).before, movable = parts.filter { caps($0).move }
        change { g in
            g.order.removeAll { $0 == id }
            if let before, let at = g.order.firstIndex(of: before) { g.order.insert(id, at: at); return }
            let last = g.order.lastIndex { movable.contains($0) }
            g.order.insert(id, at: last.map { $0 + 1 } ?? g.order.count)
        }
    }
    /// The grip: every 44 points of travel is one step, sideways for a count, along the diagonal for a size.
    func gripChanged(_ id: Item, start: CGPoint, at p: CGPoint) {
        if hold?.id != id {
            let s = countSteps(id)
            hold = (id, start, opts(id).size ?? 2, caps(id).count ? startAt(id, s) : 0)
            gripped = id
        }
        guard let h = hold else { return }
        let dx = Double(p.x - h.start.x), dy = Double(p.y - h.start.y)
        if caps(id).count {
            let s = countSteps(id), v = s[max(0, min(s.count - 1, h.at + Int(floor(dx / 44 + 0.5))))]
            if v != opts(id).count { setCount(id, v) }
        } else {
            let v = max(0, min(2, h.size + Int(floor((dx + dy) / 2 / 44 + 0.5))))
            if v != (opts(id).size ?? 2) { setSize(id, v) }
        }
        pointer.at = p
    }
    func gripEnded() { hold = nil; gripped = nil; pointer.at = nil }
    /// The value the grip's tip shows.
    var tip: String? {
        gripped.map { id in caps(id).count ? PanelWords.count(id, opts(id).count) : PanelWords.sizes[opts(id).size ?? 2] }
    }

    // MARK: Keyboard
    /// Tab picks an object to work on; arrows move it, Shift+arrows size it, − and + count it, Return opens its sheet,
    /// Escape closes the sheet, then the edit mode. Keys with ⌘, ⌃ or ⌥ stay the menus'.
    static func key(_ e: NSEvent) -> (Key, Bool)? {
        guard e.modifierFlags.intersection([.command, .control, .option]).isEmpty else { return nil }
        let shift = e.modifierFlags.contains(.shift)
        switch e.keyCode {
        case 126: return (.up, shift)
        case 125: return (.down, shift)
        case 123: return (.left, shift)
        case 124: return (.right, shift)
        case 48: return (.tab, shift)
        case 36, 76: return (.enter, shift)
        case 53: return (.escape, shift)
        default:
            switch e.charactersIgnoringModifiers {
            case "-": return (.minus, shift)
            case "+", "=": return (.plus, shift)
            default: return nil
            }
        }
    }
    @discardableResult func key(_ k: Key, shift: Bool = false) -> Bool {
        guard editing else { return false }
        if k == .escape { if sheet != nil { closeSheet() } else { close() }; return true }
        if k == .tab {
            let list = parts.filter { frames.isEmpty || frames[$0] != nil }
            guard !list.isEmpty else { return true }
            let i = focused.flatMap { list.firstIndex(of: $0) }
            focused = list[i.map { ($0 + (shift ? list.count - 1 : 1)) % list.count } ?? (shift ? list.count - 1 : 0)]
            return true
        }
        // The gallery and the list take no object keys.
        if case .gallery? = sheet { return false }
        if case .list? = sheet { return false }
        guard let id = focused else { return false }
        let c = caps(id)
        switch k {
        case .up, .down, .left, .right:
            if shift { guard c.size else { return false }; step(id, size: k == .up || k == .right ? 1 : -1) }
            else { guard c.move else { return false }; move(id, back: k == .up || k == .left) }
        case .minus, .plus:
            guard c.count else { return false }
            step(id, count: k == .minus ? -1 : 1)
        case .enter: pick(id, toggle: false)
        default: return false
        }
        return true
    }
}

// MARK: Reported geometry

struct PanelFrames: PreferenceKey {
    static var defaultValue: [ScreenLayout.Item: CGRect] = [:]
    static func reduce(value: inout [ScreenLayout.Item: CGRect], nextValue: () -> [ScreenLayout.Item: CGRect]) { value.merge(nextValue()) { $1 } }
}
struct PanelShown: PreferenceKey {
    static var defaultValue: [ScreenLayout.Item: Int] = [:]
    static func reduce(value: inout [ScreenLayout.Item: Int], nextValue: () -> [ScreenLayout.Item: Int]) { value.merge(nextValue()) { $1 } }
}
struct PanelMarkFrames: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) { value.merge(nextValue()) { $1 } }
}
extension View {
    /// Reports this view's frame in the panel's space under a name (the gear, the housing, a mark) while on.
    func panelMark(_ name: String, _ on: Bool = true) -> some View {
        background { if on { GeometryReader { g in Color.clear.preference(key: PanelMarkFrames.self, value: [name: g.frame(in: .named(PanelLayout.space))]) } } }
    }
}

// MARK: Objects in the edit mode

/// czJigD, the home-screen cycle: a tilt and a bob, 0.26 s a turn, linear between its quarters; each object (and each
/// dial) out of step. Still with Reduce Motion, and for a lifted object.
struct PanelJiggle: ViewModifier {
    let id: ScreenLayout.Item
    var element = 0
    @ObservedObject var layout: PanelLayout
    var m: QuickMetrics
    /// Off for an object whose elements jiggle each on their own.
    var enabled = true
    @Environment(\.accessibilityReduceMotion) private var still
    static let period = 0.26
    /// The tilt in degrees and the bob in points at a phase in turns.
    static func at(_ phase: Double) -> (angle: Double, dy: Double) {
        let keys: [(Double, Double)] = [(-0.3, 0.3), (0, -0.2), (0.3, 0.3), (0, -0.2), (-0.3, 0.3)]
        var p = phase.truncatingRemainder(dividingBy: 1)
        if p < 0 { p += 1 }
        let i = min(3, Int(p * 4)), f = p * 4 - Double(i)
        return (keys[i].0 + (keys[i + 1].0 - keys[i].0) * f, keys[i].1 + (keys[i + 1].1 - keys[i].1) * f)
    }
    /// How far into its turn an object starts (customize.js: the i-th object's j-th element, in fortieths of a second).
    static func delay(index: Int, element: Int) -> Double { Double((index * 7 + element * 3) % 10) / 40 }
    static func moving(editing: Bool, lifted: Bool, still: Bool) -> Bool { editing && !lifted && !still }
    func body(content: Content) -> some View {
        let on = enabled && Self.moving(editing: layout.editing, lifted: layout.lifted == id, still: still)
        let delay = Self.delay(index: layout.parts.firstIndex(of: id) ?? 0, element: element)
        // 30 frames a second carry a 0.3° wiggle as well as the display's own rate, for less than half the work.
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !on)) { t in
            let j = on ? Self.at((t.date.timeIntervalSinceReferenceDate + delay) / Self.period) : (angle: 0, dy: 0)
            content.rotationEffect(.degrees(j.angle)).offset(y: m(CGFloat(j.dy)))
        }
    }
}

/// One object of the panel. Outside the edit mode it only says where it is; in it, it jiggles, fades while another is
/// picked, wears its ring just inside its edge (objects that touch never share a line, and the spacing stays), its −
/// on the ring's top-left corner and its grip in the bottom-right one, and takes the press, the drag and the click in
/// place of its own controls. The marks stay inside the panel.
struct PanelPart: ViewModifier {
    let id: ScreenLayout.Item
    @ObservedObject var layout: PanelLayout
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    /// The dials jiggle each on its own (PanelJiggle on each), under one ring.
    var jiggles = true
    func body(content: Content) -> some View {
        let editing = layout.editing
        let alpha: Double = !editing ? 1 : layout.lifted == id ? 0.35 : layout.picked != nil && layout.picked != id ? 0.32 : 1
        content
            .modifier(PanelJiggle(id: id, layout: layout, m: m, enabled: jiggles))
            .accessibilityHidden(editing)
            .opacity(alpha)
            .animation(.easeInOut(duration: 0.2), value: alpha)
            .overlay { if editing { PanelMarks(id: id, layout: layout, theme: theme, m: m, tr: tr) } }
            .background { if layout.measures { GeometryReader { g in Color.clear.preference(key: PanelFrames.self, value: [id: g.frame(in: .named(PanelLayout.space))]) } } }
            .id(id)
    }
}
/// An object's ring, − and grip, over the layer that takes its press, drag and click.
private struct PanelMarks: View {
    let id: ScreenLayout.Item
    @ObservedObject var layout: PanelLayout
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    var body: some View {
        GeometryReader { g in
            marks(g.frame(in: .named(PanelLayout.space)), width: m(440))
        }
    }
    private func marks(_ r: CGRect, width: CGFloat) -> some View {
        let c = layout.caps(id), on = layout.picked == id
        // The ring runs 2 points inside the object and inside the panel; the − rides its top-left corner and the grip
        // sits in its bottom-right one, both kept 3 points from the panel's sides. Both follow the app's zoom.
        let x0 = max(2, r.minX + 2), x1 = min(width - 2, r.maxX - 2)
        let ring = CGRect(x: x0 - r.minX, y: 2, width: max(8, x1 - x0), height: max(8, r.height - 4))
        func inside(_ x: CGFloat, _ w: CGFloat) -> CGFloat { max(3, min(width - w - 3, x)) - r.minX }
        let minus = CGPoint(x: inside(x0 - m(9), m(22)), y: max(2, r.minY - m(7)) - r.minY)
        let grip = CGPoint(x: inside(x1 - m(24), m(24)), y: r.height - m(26))
        let name = tr(PanelWords.name(id))
        return ZStack(alignment: .topLeading) {
            Color.clear.contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named(PanelLayout.space))
                    .onChanged { layout.pressChanged(id, start: $0.startLocation, at: $0.location) }
                    .onEnded { layout.pressEnded(id, at: $0.location) })
                .accessibilityElement().accessibilityLabel(name).accessibilityAddTraits(.isButton)
                .accessibilityAction { layout.pick(id) }
            ringView(on: on).frame(width: ring.width, height: ring.height).panelMark("ring:" + id.rawValue)
                .offset(x: ring.minX, y: ring.minY).allowsHitTesting(false)
            if layout.focused == id && !on {
                RoundedRectangle(cornerRadius: m(14)).strokeBorder(theme.accent, lineWidth: 2).allowsHitTesting(false)
            }
            if c.hide {
                Button { layout.hide(id) } label: {
                    Text("−").font(.system(size: m(16), weight: .heavy)).foregroundStyle(.white)
                        .frame(width: m(22), height: m(22)).background(Circle().fill(Color(red: 0x3a / 255, green: 0x43 / 255, blue: 0x49 / 255)))
                        .shadow(color: .black.opacity(0.53), radius: m(3), y: m(2)).contentShape(Circle())
                }
                .buttonStyle(.plain).accessibilityLabel(tr.pick("\(name) 숨기기", "Hide \(name)", "隐藏\(name)"))
                .panelMark("minus:" + id.rawValue).offset(x: minus.x, y: minus.y)
            }
            if c.size || c.count {
                PanelGrip().stroke(theme.ink, lineWidth: m(4)).frame(width: m(22), height: m(22))
                    .overlay(alignment: .bottomTrailing) {
                        Circle().fill(Color.clear).contentShape(Circle()).frame(width: m(44), height: m(44)).offset(x: m(12), y: m(12))
                            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .named(PanelLayout.space))
                                .onChanged { layout.gripChanged(id, start: $0.startLocation, at: $0.location) }
                                .onEnded { _ in layout.gripEnded() })
                    }
                    .accessibilityHidden(true)
                    .panelMark("grip:" + id.rawValue).offset(x: grip.x, y: grip.y)
            }
        }
        .frame(width: r.width, height: r.height, alignment: .topLeading)
    }
    @ViewBuilder private func ringView(on: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: m(16))
        if on {
            shape.strokeBorder(theme.accent, lineWidth: 2)
                .background(RoundedRectangle(cornerRadius: m(16) + 2).stroke(theme.accent.opacity(0.18), lineWidth: 4).padding(-2))
        } else {
            shape.strokeBorder(theme.muted.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [4.5, 3.5]))
        }
    }
}

/// The corner grip: the bottom and right edges of a rounded corner, drawn thick (cluster.css .cz-grip), on a 22-unit box.
private struct PanelGrip: Shape {
    func path(in r: CGRect) -> Path {
        let k = r.width / 22
        var p = Path()
        p.move(to: CGPoint(x: r.minX + 20 * k, y: r.minY)); p.addLine(to: CGPoint(x: r.minX + 20 * k, y: r.minY + 13 * k))
        p.addArc(center: CGPoint(x: r.minX + 13 * k, y: r.minY + 13 * k), radius: 7 * k, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + 20 * k))
        return p
    }
}

/// Places its one view with its bottom centre (or its centre) at a point, kept inside the bounds.
private struct PanelPinned: Layout {
    var point: CGPoint
    var above = true
    var inset: CGFloat = 4
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize { proposal.replacingUnspecifiedDimensions() }
    func placeSubviews(in b: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let v = subviews.first else { return }
        let s = v.sizeThatFits(.unspecified)
        let x = max(b.minX + s.width / 2 + inset, min(b.maxX - s.width / 2 - inset, b.minX + point.x))
        let y = above ? max(b.minY + s.height + inset, b.minY + point.y) : b.minY + point.y
        v.place(at: CGPoint(x: x, y: y), anchor: above ? .bottom : .center, proposal: .unspecified)
    }
}

/// What follows the pointer: the lifted object's name and the line where it would land, or the grip's value 44
/// points above the pointer, kept on screen.
struct PanelPointerLayer: View {
    @ObservedObject var layout: PanelLayout
    @ObservedObject var pointer: PanelPointer
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    var body: some View {
        ZStack(alignment: .topLeading) {
            if let p = pointer.at, let id = layout.lifted {
                let t = layout.target(id, at: p)
                if let r = t.frame {
                    RoundedRectangle(cornerRadius: 3).fill(theme.accent).frame(width: r.width, height: 3)
                        .offset(x: r.minX, y: t.before != nil ? r.minY - 6 : r.maxY + 6)
                }
                PanelPinned(point: p, above: false) {
                    Text(tr(PanelWords.name(id))).font(m.font(.title, .bold)).foregroundStyle(theme.ink)
                        .padding(.horizontal, m(14)).padding(.vertical, m(8))
                        .background(theme.card, in: RoundedRectangle(cornerRadius: m(12)))
                        .overlay(RoundedRectangle(cornerRadius: m(12)).stroke(theme.accent))
                        .shadow(color: .black.opacity(0.66), radius: m(15), y: m(16))
                }
            }
            if let p = pointer.at, let tip = layout.tip {
                PanelPinned(point: CGPoint(x: p.x, y: p.y - 44)) {
                    Text(tr(tip)).font(.system(size: m(14), weight: .heavy)).foregroundStyle(PanelStyle.accentOn)
                        .padding(.horizontal, m(12)).padding(.vertical, m(5))
                        .background(theme.accent, in: RoundedRectangle(cornerRadius: m(10)))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

// MARK: Controls in the customizing style (cluster.css .cz-*)

enum PanelStyle {
    static let accentOn = Color(red: 6 / 255, green: 38 / 255, blue: 26 / 255)
    static let minus = "−", plus = "＋"
}

/// A rounded pill: the top bar's buttons, a sheet's 닫기, 전체 목록 and 기본값으로 되돌리기.
struct PanelPill: View {
    var title: String
    var accent = false
    var theme: QuickTheme
    var m: QuickMetrics
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(m.font(.title, .bold)).lineLimit(1).fixedSize()
                .foregroundStyle(accent ? PanelStyle.accentOn : theme.ink)
                .padding(.horizontal, m(14)).frame(height: m(32))
                .background(accent ? theme.accent : theme.raised, in: Capsule())
                .overlay(Capsule().stroke(accent ? theme.accent : ClusterPalette(theme: theme).lineStrong))
                .contentShape(Capsule())
        }.buttonStyle(.plain)
    }
}

/// The settings sheet's switch.
struct PanelSwitch: View {
    var on: Bool
    var enabled = true
    var label: String
    var theme: QuickTheme
    var m: QuickMetrics
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Capsule().fill(on ? theme.accent : ClusterPalette(theme: theme).lineStrong)
                .frame(width: m(44), height: m(26))
                .overlay(alignment: on ? .trailing : .leading) { Circle().fill(.white).frame(width: m(20), height: m(20)).padding(m(3)) }
                .animation(.easeInOut(duration: 0.2), value: on)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain).disabled(!enabled).opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label).accessibilityValue(on ? "1" : "0").accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The small segmented row (크기) and the − n ＋ stepper (개수), in a thin frame.
struct PanelMini<Content: View>: View {
    var theme: QuickTheme
    var m: QuickMetrics
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: m(2)) { content }
            .padding(m(2))
            .overlay(RoundedRectangle(cornerRadius: m(9)).stroke(ClusterPalette(theme: theme).lineStrong))
    }
}
struct PanelMiniButton: View {
    var title: String
    var pressed = false
    var big = false
    var label: String? = nil
    var theme: QuickTheme
    var m: QuickMetrics
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.system(size: m(big ? 14 : 13), weight: .semibold)).lineLimit(1).fixedSize()
                .foregroundStyle(pressed ? theme.ink : theme.muted)
                .padding(.horizontal, m(8)).frame(minWidth: m(big ? 44 : 30)).frame(height: m(big ? 34 : 28))
                .background(pressed ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: m(7)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).accessibilityLabel(label ?? title).accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

/// The edit mode's top bar over the header: 목록 on the left, the preset segments in the middle, 완료 on the right.
struct PanelEditBar: View {
    @ObservedObject var layout: PanelLayout
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    var body: some View {
        ZStack {
            HStack(spacing: m(2)) {
                ForEach([(ScreenLayout.Preset.dashboard, "대시보드"), (.cluster, "계기판")], id: \.0) { preset, title in
                    let on = layout.preset == preset
                    Button { layout.choosePreset(preset) } label: {
                        Text(tr(title)).font(m.font(.title, .semibold)).lineLimit(1).fixedSize()
                            .foregroundStyle(on ? theme.ink : theme.muted)
                            .padding(.horizontal, m(14)).frame(height: m(28))
                            .background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: m(8)))
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(m(3)).background(theme.card, in: RoundedRectangle(cornerRadius: m(11)))
            .overlay(RoundedRectangle(cornerRadius: m(11)).stroke(ClusterPalette(theme: theme).lineStrong))
            .accessibilityElement(children: .contain).accessibilityLabel(tr("프리셋"))
            HStack {
                PanelPill(title: tr("목록"), theme: theme, m: m) { layout.showList() }
                Spacer()
                PanelPill(title: tr("완료"), accent: true, theme: theme, m: m) { layout.close() }
            }
        }
        .padding(.horizontal, m(12)).padding(.vertical, m(6))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.background)
        .overlay(alignment: .bottom) { Rectangle().fill(theme.line).frame(height: 1) }
        .contentShape(Rectangle())
    }
}

/// The gear into customizing: at the top-right of what the preset shows first, hidden (keeping its place) while
/// customizing.
struct PanelGear: View {
    @ObservedObject var layout: PanelLayout
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    @State private var hovered = false
    var body: some View {
        Button { layout.open() } label: {
            Image(systemName: "gearshape").font(.system(size: m(15), weight: .medium))
                .foregroundStyle(hovered ? theme.ink : theme.muted)
                .frame(width: m(26), height: m(26))
                .background(hovered ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: m(7)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).onHover { hovered = $0 }
        .help(tr("커스터마이징")).accessibilityLabel(tr("커스터마이징"))
        .opacity(layout.editing ? 0 : 1).disabled(layout.editing).accessibilityHidden(layout.editing)
        .panelMark("gear", layout.measures)
    }
}

/// A sheet from the bottom of the panel in the settings-sheet style: its title and 닫기, its rows (scrolling past the
/// sheet's limit), then one button. focus is the row to bring to the middle as it opens.
struct PanelSheetBox<Rows: View>: View {
    var title: String
    var limit: CGFloat
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    var close: () -> Void
    var footer: (title: String, action: () -> Void)?
    var focus: String? = nil
    @ViewBuilder var rows: Rows
    @State private var rowsHeight: CGFloat = .infinity
    var body: some View {
        // The title, the button, the gaps and the padding; the rows take the rest of the limit at most.
        let chrome = m(32) + m(10) + m(14) + m(18) + (footer == nil ? 0 : m(32) + m(10))
        VStack(spacing: m(10)) {
            HStack {
                Text(title).font(.system(size: m(17), weight: .bold)).lineLimit(1)
                Spacer(minLength: m(8))
                PanelPill(title: tr("닫기"), theme: theme, m: m, action: close)
            }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: m(6)) { rows }
                        .padding(m(2))
                        .background(GeometryReader { g in Color.clear.preference(key: PanelSheetHeight.self, value: g.size.height) })
                }
                .onAppear { if let focus { proxy.scrollTo(focus, anchor: .center) } }
            }
            .frame(maxHeight: min(rowsHeight, max(m(56), limit - chrome)))
            .onPreferenceChange(PanelSheetHeight.self) { rowsHeight = $0 }
            if let footer { PanelPill(title: footer.title, theme: theme, m: m, action: footer.action) }
        }
        .padding(.horizontal, m(14)).padding(.top, m(14)).padding(.bottom, m(18))
        .frame(maxWidth: .infinity)
        .background(theme.card, in: UnevenTop(radius: m(22)))
        .overlay(UnevenTop(radius: m(22)).stroke(ClusterPalette(theme: theme).lineStrong))
        .shadow(color: .black.opacity(0.56), radius: m(20), y: -m(16))
        .contentShape(Rectangle())
    }
}
private struct PanelSheetHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// A rectangle with its top corners rounded (a sheet from below).
struct UnevenTop: Shape {
    var radius: CGFloat
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.minY + radius))
        p.addArc(tangent1End: CGPoint(x: r.minX, y: r.minY), tangent2End: CGPoint(x: r.minX + radius, y: r.minY), radius: radius)
        p.addLine(to: CGPoint(x: r.maxX - radius, y: r.minY))
        p.addArc(tangent1End: CGPoint(x: r.maxX, y: r.minY), tangent2End: CGPoint(x: r.maxX, y: r.minY + radius), radius: radius)
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        return p
    }
}

/// A row of a sheet: a bordered line on the panel's ground.
struct PanelRow<Content: View>: View {
    var height: CGFloat
    var theme: QuickTheme
    var m: QuickMetrics
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: m(8)) { content }
            .padding(.horizontal, m(10)).frame(minHeight: height)
            .background(theme.background, in: RoundedRectangle(cornerRadius: m(12)))
            .overlay(RoundedRectangle(cornerRadius: m(12)).stroke(theme.line))
    }
}

/// A picked object's own sheet: its size, its count, its shape (into the gallery, when it has others) and whether it
/// shows; 전체 목록 leads to the list.
struct PanelObjectSheet: View {
    let id: ScreenLayout.Item
    @ObservedObject var layout: PanelLayout
    var limit: CGFloat
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    var body: some View {
        let c = layout.caps(id), o = layout.opts(id)
        let shape = c.shape ? PanelWords.shape(id, o.shape) : nil
        PanelSheetBox(title: tr(PanelWords.name(id)), limit: limit, theme: theme, m: m, tr: tr, close: { layout.pick(nil) },
                      footer: (tr("전체 목록"), { layout.showList() })) {
            if c.size {
                row(tr("크기")) {
                    PanelMini(theme: theme, m: m) {
                        ForEach(0..<3, id: \.self) { i in
                            PanelMiniButton(title: tr(PanelWords.sizes[i]), pressed: (o.size ?? 2) == i, big: true, theme: theme, m: m) { layout.setSize(id, i) }
                        }
                    }
                }
            }
            if c.count {
                row(tr("개수")) {
                    PanelMini(theme: theme, m: m) {
                        PanelMiniButton(title: PanelStyle.minus, big: true, label: tr("줄이기"), theme: theme, m: m) { layout.step(id, count: -1) }
                        Text(tr(PanelWords.count(id, o.count))).font(.system(size: m(14), weight: .bold)).frame(minWidth: m(56))
                        PanelMiniButton(title: PanelStyle.plus, big: true, label: tr("늘리기"), theme: theme, m: m) { layout.step(id, count: 1) }
                    }
                }
            }
            if let shape {
                row(tr("모양")) {
                    Button { layout.showGallery(id) } label: {
                        Text(tr(shape.name) + " ▸").font(.system(size: m(14))).foregroundStyle(theme.ink).lineLimit(1).fixedSize()
                            .padding(.horizontal, m(10)).frame(height: m(36))
                            .overlay(RoundedRectangle(cornerRadius: m(9)).stroke(ClusterPalette(theme: theme).lineStrong)).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }
            if c.hide {
                row(tr("보이기")) { PanelSwitch(on: !layout.group.hidden.contains(id), label: tr("보이기"), theme: theme, m: m) { layout.setShown(id, false) } }
            }
            if !c.size && !c.count && shape == nil && !c.hide {
                Text(tr(c.move ? "끌어서 자리만 옮길 수 있습니다." : "자리가 정해져 있습니다.")).font(m.font(.title)).foregroundStyle(theme.muted)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, m(2)).padding(.vertical, m(6))
            }
        }
    }
    private func row<Control: View>(_ title: String, @ViewBuilder _ control: () -> Control) -> some View {
        PanelRow(height: m(56), theme: theme, m: m) {
            Text(title).font(.system(size: m(14.5), weight: .bold))
            Spacer(minLength: m(8))
            control()
        }
    }
}

/// An object's shapes, each drawn by the real component; the one clicked is taken at once and the sheet stays up.
struct PanelGallery<Preview: View>: View {
    let id: ScreenLayout.Item
    @ObservedObject var layout: PanelLayout
    var limit: CGFloat
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    @ViewBuilder var preview: (String) -> Preview
    var body: some View {
        let list = PanelWords.shapes[id] ?? [], on = PanelWords.shape(id, layout.opts(id).shape)?.key
        PanelSheetBox(title: tr(PanelWords.name(id)) + " · " + tr("모양"), limit: limit, theme: theme, m: m, tr: tr, close: { layout.closeSheet() },
                      footer: nil, focus: on) {
            ForEach(list, id: \.key) { shape in card(shape, on: shape.key == on).id(shape.key).padding(.bottom, m(4)) }
        }
    }
    private func card(_ shape: (key: String, name: String), on: Bool) -> some View {
        Button { layout.setShape(id, shape.key) } label: {
            VStack(spacing: m(8)) {
                preview(shape.key).allowsHitTesting(false).accessibilityHidden(true)
                    .frame(maxWidth: .infinity).clipped()
                Text(tr(shape.name)).font(m.font(.title, .semibold)).foregroundStyle(on ? theme.ink : theme.muted)
            }
            .padding(.horizontal, m(8)).padding(.top, m(12)).padding(.bottom, m(10))
            .background(theme.background, in: RoundedRectangle(cornerRadius: m(16)))
            .overlay(RoundedRectangle(cornerRadius: m(16)).strokeBorder(on ? theme.accent : theme.line, lineWidth: 2))
            .contentShape(RoundedRectangle(cornerRadius: m(16)))
        }
        .buttonStyle(.plain).accessibilityLabel(tr(shape.name)).accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Every object at once: order, size or count, shape and shown; 기본값으로 되돌리기 starts the preset over.
struct PanelList: View {
    @ObservedObject var layout: PanelLayout
    var limit: CGFloat
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    var body: some View {
        let g = layout.group
        let screen = tr(layout.cluster ? "계기판" : "대시보드")
        return PanelSheetBox(title: tr.pick("\(screen) 목록", "\(screen) list", "\(screen)列表"), limit: limit, theme: theme, m: m, tr: tr,
                      close: { layout.closeSheet() }, footer: (tr("기본값으로 되돌리기"), { layout.reset() })) {
            ForEach(g.order.filter(layout.known.contains), id: \.self) { id in row(id, g) }
        }
    }
    private func row(_ id: ScreenLayout.Item, _ g: ScreenLayout.Arrangement) -> some View {
        // One line when it fits; a longer language puts the size or count and the shape on a second line.
        PanelRow(height: m(52), theme: theme, m: m) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: m(8)) { name(id); Spacer(minLength: 0); controls(id); ends(id, g) }
                VStack(alignment: .leading, spacing: m(6)) {
                    HStack(spacing: m(8)) { name(id); Spacer(minLength: 0); ends(id, g) }
                    HStack(spacing: m(8)) { Spacer(minLength: 0); controls(id) }
                }.padding(.vertical, m(8))
            }
        }
    }
    private func name(_ id: ScreenLayout.Item) -> some View {
        HStack(spacing: m(8)) {
            Text("≡").foregroundStyle(theme.dim).frame(width: m(18)).accessibilityHidden(true)
            Text(tr(PanelWords.name(id))).font(.system(size: m(14.5), weight: .bold)).lineLimit(1)
        }
    }
    /// Its size or count, then its shape.
    @ViewBuilder private func controls(_ id: ScreenLayout.Item) -> some View {
        let c = layout.caps(id), o = layout.opts(id)
        let shape = c.shape ? PanelWords.shape(id, o.shape) : nil
        if c.size {
            PanelMini(theme: theme, m: m) {
                ForEach(0..<3, id: \.self) { i in
                    PanelMiniButton(title: tr(PanelWords.sizes[i]), pressed: (o.size ?? 2) == i, theme: theme, m: m) { layout.setSize(id, i) }
                }
            }
        } else if c.count {
            PanelMini(theme: theme, m: m) {
                PanelMiniButton(title: PanelStyle.minus, label: tr("줄이기"), theme: theme, m: m) { layout.step(id, count: -1) }
                Text(tr(PanelWords.count(id, o.count))).font(.system(size: m(13), weight: .bold)).lineLimit(1).fixedSize().frame(minWidth: m(44))
                PanelMiniButton(title: PanelStyle.plus, label: tr("늘리기"), theme: theme, m: m) { layout.step(id, count: 1) }
            }
        }
        if let shape {
            Button { layout.showGallery(id) } label: {
                Text(tr(shape.name) + " ▸").font(.system(size: m(13))).foregroundStyle(theme.ink).lineLimit(1).fixedSize()
                    .padding(.horizontal, m(10)).frame(height: m(30))
                    .overlay(RoundedRectangle(cornerRadius: m(9)).stroke(ClusterPalette(theme: theme).lineStrong)).contentShape(Rectangle())
            }.buttonStyle(.plain)
        }
    }
    /// Its switch, then ↑↓ when it moves.
    @ViewBuilder private func ends(_ id: ScreenLayout.Item, _ g: ScreenLayout.Arrangement) -> some View {
        let c = layout.caps(id), hidden = g.hidden.contains(id)
        PanelSwitch(on: !hidden, enabled: c.hide || hidden, label: tr("보이기"), theme: theme, m: m) { layout.setShown(id, hidden) }
            .frame(width: m(46))
        if c.move {
            HStack(spacing: m(2)) {
                arrow("↑", tr("위로")) { layout.listMove(id, -1) }
                arrow("↓", tr("아래로")) { layout.listMove(id, 1) }
            }
        }
    }
    private func arrow(_ glyph: String, _ label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.system(size: m(13))).foregroundStyle(theme.muted).frame(width: m(28), height: m(28))
                .overlay(RoundedRectangle(cornerRadius: m(7)).stroke(theme.line)).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(label)
    }
}
