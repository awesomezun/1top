import SwiftUI
import UIKit

/// The edit mode over one screen's objects (customize.js, customizing-spec_v1.2.2), home-screen widget style: the
/// objects jiggle; − on a ring's corner hides one; a long press then a drag moves it; the grip in its lower right
/// changes its size or count, every 44 points one step, the value riding above the finger; a tap opens its own sheet
/// (size, count, shape into the gallery, shown) and fades the rest; 목록 shows every object at once. The marks run
/// just inside each object, so objects that touch never share a line and the screen keeps its spacing. Every change is
/// saved at once (LayoutStore).
@MainActor @Observable
final class CustomizeSession {
    typealias Item = ScreenLayout.Item
    /// The coordinate space of the scrolled content the objects and their marks share.
    nonisolated static let space = "customize"
    enum Sheet: Equatable { case object, list }
    struct Carry: Equatable { var id: Item; var at: CGPoint }
    struct Tip: Equatable { var text: String; var at: CGPoint }

    /// The preset these objects belong to.
    var preset: ScreenLayout.Preset
    var editing = false
    var selected: Item?
    var sheet: Sheet?
    /// The gallery pushed over the object's sheet or the list.
    var path: [Item] = []
    /// Each shown object's frame in the content.
    var frames: [Item: CGRect] = [:]
    /// How many items a count of 'as many as fit' / 'all' shows now, where steps start from.
    var shown: [Item: Int] = [:]
    var carry: Carry?
    var tip: Tip?
    /// The scrolled content's top on screen, so the value above the finger stays in view.
    var scrollTop: CGFloat = 0
    #if DEBUG
    /// Frames of the pieces inside the objects (tiles, fuel gauges, lights, the dials, the gear, the housing), for the
    /// geometry checks.
    var probes: [String: CGRect] = [:]
    #endif

    init(preset: ScreenLayout.Preset) { self.preset = preset }

    func begin() {
        guard !editing else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        editing = true; selected = nil; sheet = nil; path = []
    }
    func end() { editing = false; selected = nil; sheet = nil; path = []; carry = nil; tip = nil }
    /// A tap picks an object and opens its sheet; another tap on it lets go.
    func tap(_ id: Item) {
        if selected == id { selected = nil; sheet = nil } else { selected = id; sheet = .object }
        path = []
    }
    func list() { selected = nil; path = []; sheet = .list }

    #if DEBUG
    /// UI tests ask for less motion without the system setting: -czReduceMotion YES.
    static let forcedStill = UserDefaults.standard.bool(forKey: "czReduceMotion")
    #else
    static let forcedStill = false
    #endif
}

extension View {
    /// Marks this view as one of the screen's objects for customizing: the editor knows its frame, and while editing it
    /// jiggles, fades when another one is picked and fades further while it is carried. A long press enters editing
    /// (enters: false leaves the long press to the view, as rows with their own menus need).
    func czPart(_ id: ScreenLayout.Item, _ session: CustomizeSession?, enters: Bool = true) -> some View {
        modifier(CustomizePart(id: id, session: session, enters: enters))
    }
    /// Records a piece's frame for the geometry checks (debug builds only).
    @ViewBuilder func czProbe(_ name: String, _ session: CustomizeSession?) -> some View {
        #if DEBUG
        if let session {
            onGeometryChange(for: CGRect.self) { $0.frame(in: .named(CustomizeSession.space)) } action: { session.probes[name] = $0 }
                .onDisappear { session.probes[name] = nil }
        } else { self }
        #else
        self
        #endif
    }
    /// The long press that enters editing, for a part of an object (a heading) when the rest of it keeps its own.
    func czEnter(_ session: CustomizeSession?) -> some View {
        gesture(PressRecognizer(duration: 0.5) { state, _ in if state == .began { session?.begin() } })
    }
}

private struct CustomizePart: ViewModifier {
    let id: ScreenLayout.Item
    let session: CustomizeSession?
    var enters: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let editing = session?.editing == true, carried = session?.carry?.id == id
        let picked = session?.selected, still = reduceMotion || CustomizeSession.forcedStill
        let jiggle = editing && !carried && !still
        // Each object out of step (customize.js animation delays).
        let shift = Double((ScreenLayout.Item.allCases.firstIndex(of: id) ?? 0) * 7 % 10) / 40 / Jiggle.cycle
        // While editing, the marks' layer over each object takes its touches, so the object needs no blocking of its own.
        content
            .modifier(JiggleClock(on: jiggle, shift: shift))
            .opacity(carried ? 0.35 : picked != nil && picked != id ? 0.32 : 1)
            .animation(.easeOut(duration: 0.2), value: picked)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(CustomizeSession.space)) } action: { frame in
                if session?.frames[id] != frame { session?.frames[id] = frame }
            }
            .onDisappear { session?.frames[id] = nil }
            .gesture(PressRecognizer(duration: 0.5) { state, _ in if enters && state == .began { session?.begin() } })
            .id(id)
    }
}

/// Moves the wiggle on 30 times a second while it runs and not at all otherwise: the objects' own drawing is left alone,
/// and a still screen keeps no clock running.
private struct JiggleClock: ViewModifier {
    var on: Bool
    var shift: Double
    func body(content: Content) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !on)) { timeline in
            content.modifier(Jiggle(phase: (timeline.date.timeIntervalSinceReferenceDate / Jiggle.cycle).truncatingRemainder(dividingBy: 1),
                                    shift: shift, amount: on ? 1 : 0))
        }
    }
}

/// The home-screen wiggle (cluster.css czJigD): a tilt and a bob over 0.26 seconds, not mirrored.
private struct Jiggle: GeometryEffect {
    static let cycle = 0.26
    /// The keyframes: time, degrees, points down.
    private static let frames: [(t: Double, a: Double, y: Double)] = [(0, -0.3, 0.3), (0.25, 0, -0.2), (0.5, 0.3, 0.3), (0.75, 0, -0.2), (1, -0.3, 0.3)]
    var phase: Double
    var shift: Double
    var amount: Double
    var animatableData: Double {
        get { phase }
        set { phase = newValue }
    }
    func effectValue(size: CGSize) -> ProjectionTransform {
        guard amount > 0 else { return ProjectionTransform() }
        let t = (phase + shift).truncatingRemainder(dividingBy: 1)
        let k = max(1, Self.frames.firstIndex { $0.t >= t } ?? 1), a = Self.frames[k - 1], b = Self.frames[k]
        let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
        let angle = (a.a + (b.a - a.a) * f) * amount * .pi / 180, dy = (a.y + (b.y - a.y) * f) * amount
        let turn = CGAffineTransform(translationX: size.width / 2, y: size.height / 2 + dy).rotated(by: angle).translatedBy(x: -size.width / 2, y: -size.height / 2)
        return ProjectionTransform(turn)
    }
}

/// A press held for a moment, then followed as the finger moves (UIKit's long press, which lets the scroll view have a
/// drag that starts at once).
struct PressRecognizer: UIGestureRecognizerRepresentable {
    var duration: Double
    var action: (UIGestureRecognizer.State, CGPoint) -> Void
    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let press = UILongPressGestureRecognizer()
        press.minimumPressDuration = duration
        return press
    }
    func updateUIGestureRecognizer(_ recognizer: UILongPressGestureRecognizer, context: Context) { recognizer.minimumPressDuration = duration }
    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        action(recognizer.state, context.converter.location(in: .named(CustomizeSession.space)))
    }
}

// MARK: The marks over the objects

/// The ring just inside each shown object, the − on its top-left corner, the grip in its lower right, and what a drag
/// carries: the object's name under the finger and a line where it would land. Drawn over the scrolled content, in its
/// coordinates, so the marks scroll with the objects.
struct CustomizeMarks: View {
    typealias Item = ScreenLayout.Item
    let session: CustomizeSession
    let store: LayoutStore
    var theme: QuickTheme
    @State private var grip: GripStart?
    private struct GripStart { var id: Item; var at: CGPoint; var size: Int; var step: Int }
    private struct Part: Identifiable { var id: Item; var frame: CGRect }

    private var preset: ScreenLayout.Preset { session.preset }
    private var arrangement: ScreenLayout.Arrangement { store.layout.presets[preset] }
    /// The objects on screen (the period control always is).
    private var parts: [Part] {
        Customizing.known(preset).compactMap { id in
            guard !arrangement.hidden.contains(id) || id == .periods, let f = session.frames[id], f.width > 1, f.height > 1 else { return nil }
            return Part(id: id, frame: f)
        }
    }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .topLeading) {
                ForEach(parts) { part in marks(part.id, part.frame, width: width) }
                if let carry = session.carry { carried(carry) }
                if let tip = session.tip { tipView(tip, width: width) }
                #if DEBUG
                // UI tests read whether the objects jiggle.
                Color.clear.frame(width: 1, height: 1).accessibilityElement().accessibilityIdentifier("cz-motion")
                    .accessibilityLabel(CustomizeSession.forcedStill || UIAccessibility.isReduceMotionEnabled ? "still" : "jiggle")
                #endif
            }
            .frame(width: width, height: geo.size.height, alignment: .topLeading)
        }
    }

    @ViewBuilder private func marks(_ id: Item, _ r: CGRect, width: CGFloat) -> some View {
        let caps = Customizing.caps(id, in: preset), on = session.selected == id, name = Customizing.names[id] ?? id.rawValue
        let x0 = max(2, r.minX + 2), x1 = min(width - 2, r.maxX - 2), h = max(8, r.height - 4)
        let clampX = { (x: CGFloat, w: CGFloat) in max(3, min(width - w - 3, x)) }
        // The object itself takes the taps and the long press that carries it.
        Color.clear.contentShape(Rectangle())
            .frame(width: r.width, height: r.height).offset(x: r.minX, y: r.minY)
            .onTapGesture { session.tap(id) }
            .gesture(PressRecognizer(duration: 0.38) { state, at in carry(id, caps: caps, state: state, at: at) })
            .accessibilityElement().accessibilityLabel(name).accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
            .accessibilityIdentifier("cz-part-\(id.rawValue)")
        Group {
            if on {
                RoundedRectangle(cornerRadius: 16).stroke(theme.accent, lineWidth: 2)
                    .shadow(color: theme.accent.opacity(0.35), radius: 4)
            } else {
                RoundedRectangle(cornerRadius: 16).stroke(theme.muted.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
            }
        }
        .frame(width: max(8, x1 - x0), height: h).offset(x: x0, y: r.minY + 2)
        .allowsHitTesting(false)
        if caps.hide {
            Button { hide(id) } label: {
                Text("−").font(.system(size: 16, weight: .heavy)).foregroundStyle(.white)
                    .frame(width: 22, height: 22).background(Lane.rgb(0x3a4349), in: Circle()).shadow(color: .black.opacity(0.5), radius: 3, y: 2)
                    .frame(width: 34, height: 34).contentShape(Circle())
            }
            .buttonStyle(.plain)
            .offset(x: clampX(x0 - 9, 22) - 6, y: max(session.scrollTop + 2, r.minY - 7) - 6)
            .accessibilityLabel(L.t("Hide \(name)", "\(name) 숨기기")).accessibilityIdentifier("cz-hide-\(id.rawValue)")
        }
        if caps.size || caps.count {
            GripMark().stroke(theme.ink, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                .frame(width: 22, height: 22)
                .frame(width: 44, height: 44).contentShape(Circle())
                .offset(x: clampX(x1 - 24, 24) - 11, y: r.maxY - 26 - 11)
                .highPriorityGesture(DragGesture(minimumDistance: 0, coordinateSpace: .named(CustomizeSession.space))
                    .onChanged { v in resize(id, caps: caps, start: v.startLocation, at: v.location) }
                    .onEnded { _ in grip = nil; session.tip = nil })
                .accessibilityElement().accessibilityLabel(caps.count ? L.t("\(name) count", "\(name) 개수") : L.t("\(name) size", "\(name) 크기"))
                .accessibilityValue(caps.count ? Customizing.countText(id, arrangement.opts[id]?.count) : Customizing.sizes[arrangement.opts[id]?.size ?? 2])
                .accessibilityIdentifier("cz-grip-\(id.rawValue)")
                .accessibilityAdjustableAction { direction in
                    let d = direction == .increment ? 1 : -1
                    if caps.count { store.change(preset) { Customizing.step(id, by: d, shown: session.shown[id], &$0) } }
                    else { store.change(preset) { $0.opts[id, default: .init()].size = max(0, min(2, ($0.opts[id]?.size ?? 2) + d)) } }
                }
        }
    }

    private func hide(_ id: Item) {
        if session.selected == id { session.selected = nil; session.sheet = nil }
        store.change(preset) { Customizing.hide(id, &$0) }
    }

    // MARK: Carrying an object to a new place
    private func carry(_ id: Item, caps: Customizing.Caps, state: UIGestureRecognizer.State, at: CGPoint) {
        switch state {
        case .began:
            guard caps.move else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            session.selected = nil; session.sheet = nil
            session.carry = .init(id: id, at: at)
        case .changed:
            if session.carry?.id == id { session.carry?.at = at }
        case .ended:
            guard session.carry?.id == id else { return }
            let before = target(id, at: at).before
            store.change(preset) { Customizing.move(id, before: before, in: preset, &$0) }
            session.carry = nil
        default:
            session.carry = nil
        }
    }
    /// Where the carried object would land: before the first object that moves whose middle is below the finger, or
    /// after the last one.
    private func target(_ id: Item, at: CGPoint) -> (before: Item?, line: CGRect?) {
        let movable = parts.filter { $0.id != id && Customizing.caps($0.id, in: preset).move }.sorted { $0.frame.minY < $1.frame.minY }
        if let hit = movable.first(where: { at.y < $0.frame.midY }) {
            return (hit.id, CGRect(x: hit.frame.minX + 4, y: hit.frame.minY - 7.5, width: hit.frame.width - 8, height: 3))
        }
        return (nil, movable.last.map { CGRect(x: $0.frame.minX + 4, y: $0.frame.maxY + 4.5, width: $0.frame.width - 8, height: 3) })
    }
    @ViewBuilder private func carried(_ carry: CustomizeSession.Carry) -> some View {
        if let line = target(carry.id, at: carry.at).line {
            RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: line.width, height: line.height).offset(x: line.minX, y: line.minY)
                .allowsHitTesting(false)
        }
        Text(Customizing.names[carry.id] ?? "").font(.system(size: 14, weight: .bold)).foregroundStyle(theme.ink)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent))
            .shadow(color: .black.opacity(0.6), radius: 15, y: 8)
            .fixedSize()
            .position(carry.at)
            .allowsHitTesting(false)
            .accessibilityIdentifier("cz-carry")
    }

    // MARK: The grip
    private func resize(_ id: Item, caps: Customizing.Caps, start: CGPoint, at: CGPoint) {
        let o = arrangement.opts[id] ?? ScreenLayout.options(id)
        if grip?.id != id {
            let steps = Customizing.countSteps(id)
            grip = GripStart(id: id, at: start, size: o.size ?? 2, step: caps.count ? Customizing.startAt(id, steps, current: o.count, shown: session.shown[id]) : 0)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
        guard let g = grip else { return }
        let dx = at.x - g.at.x, dy = at.y - g.at.y
        if caps.count {
            let steps = Customizing.countSteps(id), v = steps[max(0, min(steps.count - 1, g.step + Int((dx / 44).rounded())))]
            if v != o.count { store.change(preset) { $0.opts[id, default: .init()].count = v } }
        } else {
            let v = max(0, min(2, g.size + Int(((dx + dy) / 2 / 44).rounded())))
            if v != (o.size ?? 2) {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                store.change(preset) { $0.opts[id, default: .init()].size = v }
            }
        }
        let now = store.layout.presets[preset].opts[id]
        session.tip = .init(text: caps.count ? Customizing.countText(id, now?.count) : Customizing.sizes[now?.size ?? 2], at: at)
    }
    /// The value above the finger, kept inside the screen.
    private func tipView(_ tip: CustomizeSession.Tip, width: CGFloat) -> some View {
        let w = CGFloat(tip.text.count) * 9 + 30, h: CGFloat = 30
        return Text(tip.text).font(.system(size: 14, weight: .heavy)).foregroundStyle(Lane.rgb(0x06261a))
            .padding(.horizontal, 12).frame(height: h)
            .background(theme.accent, in: RoundedRectangle(cornerRadius: 10))
            .fixedSize()
            .position(x: max(w / 2 + 4, min(width - w / 2 - 4, tip.at.x)), y: max(session.scrollTop + 4 + h / 2, tip.at.y - 44 - h / 2))
            .allowsHitTesting(false)
            .accessibilityIdentifier("cz-tip").accessibilityLabel(tip.text)
    }
}

/// The grip's corner: along the right edge and the bottom, rounded where they meet.
private struct GripMark: Shape {
    func path(in r: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: r.maxX - 2, y: r.minY + 2))
            p.addLine(to: CGPoint(x: r.maxX - 2, y: r.maxY - 11))
            p.addQuadCurve(to: CGPoint(x: r.maxX - 11, y: r.maxY - 2), control: CGPoint(x: r.maxX - 2, y: r.maxY - 2))
            p.addLine(to: CGPoint(x: r.minX + 2, y: r.maxY - 2))
        }
    }
}

// MARK: The bar on top while editing

/// 목록 on the left, 완료 on the right and, where both presets live in one place, the preset to edit between them
/// (otherwise the screen's name).
struct CustomizeBar: View {
    let session: CustomizeSession
    var theme: QuickTheme
    /// The preset choice, when both presets live on this screen.
    var choose: ((ScreenLayout.Preset) -> Void)?

    var body: some View {
        ZStack {
            if let choose {
                HStack(spacing: 2) {
                    ForEach([ScreenLayout.Preset.dashboard, .cluster], id: \.self) { p in
                        let on = session.preset == p
                        Button { if !on { choose(p) } } label: {
                            Text(Customizing.title(p)).font(.system(size: 14, weight: .semibold)).foregroundStyle(on ? theme.ink : theme.muted)
                                .padding(.horizontal, 14).frame(height: 28)
                                .background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 8))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                        .accessibilityIdentifier("cz-preset-\(p.rawValue)")
                    }
                }
                .padding(3)
                .background(theme.background, in: RoundedRectangle(cornerRadius: 11))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(theme.line))
                .accessibilityElement(children: .contain).accessibilityLabel(L.t("Preset", "프리셋"))
            } else {
                Text(L.t("Customize \(Customizing.title(session.preset))", "\(Customizing.title(session.preset)) 커스터마이징")).font(.system(size: 15, weight: .bold))
            }
            HStack {
                pill(L.t("List", "목록"), id: "cz-list", strong: false) { session.list() }
                Spacer()
                pill(L.t("Done", "완료", zh: "完成"), id: "cz-done", strong: true) { session.end() }
            }
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
    }
    private func pill(_ title: String, id: String, strong: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .bold)).foregroundStyle(strong ? Lane.rgb(0x06261a) : theme.ink)
                .padding(.horizontal, 14).frame(height: 32)
                .background(strong ? theme.accent : theme.raised, in: Capsule())
                .overlay(Capsule().stroke(strong ? theme.accent : theme.line))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain).accessibilityIdentifier(id)
    }
}

/// The gear into customizing, at the top right of what the preset shows first; hidden while customizing, without
/// moving anything.
struct CustomizeGear: View {
    let session: CustomizeSession
    var theme: QuickTheme
    var body: some View {
        Button { session.begin() } label: {
            Image(systemName: "gearshape").font(.system(size: 15, weight: .semibold)).foregroundStyle(theme.muted)
                .frame(width: 26, height: 26).contentShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .opacity(session.editing ? 0 : 1).allowsHitTesting(!session.editing)
        .czProbe("gear", session)
        .accessibilityHidden(session.editing)
        .accessibilityLabel(L.t("Customize", "커스터마이징")).accessibilityIdentifier("customize-gear")
    }
}

// MARK: The sheets

/// The picked object's own sheet, the gallery of its shapes, or every object at once, in the settings-sheet style.
struct CustomizeSheet<Preview: View>: View {
    typealias Item = ScreenLayout.Item
    @Bindable var session: CustomizeSession
    let store: LayoutStore
    var theme: QuickTheme
    /// Draws one object as the screen does, in a shape, for the gallery.
    @ViewBuilder var preview: (Item, String) -> Preview

    private var preset: ScreenLayout.Preset { session.preset }
    private var arrangement: ScreenLayout.Arrangement { store.layout.presets[preset] }
    private func opts(_ id: Item) -> ScreenLayout.Options { arrangement.opts[id] ?? ScreenLayout.options(id) }
    /// The reports' look lives apart from the layout (ReportPrefs) and opens its own sheet.
    @State private var reportSheet = false
    @State private var reportPrefs = ReportPrefs.shared
    /// The cluster's look (a theme or the 1top instruments), in the cluster's list only.
    @State private var themeSheet = false
    @State private var looks = ClusterThemePrefs.shared

    var body: some View {
        NavigationStack(path: $session.path) {
            Group {
                if session.sheet == .list { list } else if let id = session.selected { object(id) }
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Item.self) { gallery($0).toolbar(.hidden, for: .navigationBar) }
        }
        .foregroundStyle(theme.ink)
        .tint(theme.accent)
    }

    private func header(_ title: String, close: @escaping () -> Void) -> some View {
        HStack {
            Text(title).font(.system(size: 17, weight: .bold))
            Spacer()
            Button(action: close) {
                Text(L.t("Close", "닫기")).font(.system(size: 14, weight: .bold)).foregroundStyle(theme.ink)
                    .padding(.horizontal, 14).frame(height: 32).background(theme.raised, in: Capsule()).overlay(Capsule().stroke(theme.line))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain).accessibilityIdentifier("cz-close")
        }
    }
    private func row<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(spacing: 10) {
            Text(title).font(.system(size: 14.5, weight: .bold))
            Spacer(minLength: 8)
            content()
        }
        .padding(.horizontal, 12).frame(minHeight: 56)
        .background(theme.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line))
    }
    private func sizes(_ id: Item) -> some View {
        HStack(spacing: 2) {
            ForEach(Customizing.sizes.indices, id: \.self) { i in
                let on = (opts(id).size ?? 2) == i
                Button { store.change(preset) { $0.opts[id, default: .init()].size = i } } label: {
                    Text(Customizing.sizes[i]).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(on ? theme.ink : theme.muted)
                        .padding(.horizontal, 6).frame(minWidth: 44).frame(height: 30).background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 7))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : []).accessibilityIdentifier("cz-size-\(i)")
            }
        }
        .padding(2).overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.line))
    }
    private func counts(_ id: Item) -> some View {
        HStack(spacing: 2) {
            stepButton("−", L.t("Fewer", "줄이기"), id: "cz-count-down") { store.change(preset) { Customizing.step(id, by: -1, shown: session.shown[id], &$0) } }
            Text(Customizing.countText(id, opts(id).count)).font(.system(size: 13.5, weight: .bold)).monospacedDigit().frame(minWidth: 52)
                .accessibilityIdentifier("cz-count")
            stepButton("+", L.t("More", "늘리기", zh: "增加"), id: "cz-count-up") { store.change(preset) { Customizing.step(id, by: 1, shown: session.shown[id], &$0) } }
        }
        .padding(2).overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.line))
    }
    private func stepButton(_ glyph: String, _ name: String, id: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.system(size: 15, weight: .semibold)).frame(width: 40, height: 30).contentShape(Rectangle())
        }
        .buttonStyle(.plain).accessibilityLabel(name).accessibilityIdentifier(id)
    }
    private func shapeButton(_ id: Item) -> some View {
        Button { session.path = [id] } label: {
            Text((Customizing.shapeName(id, opts(id).shape) ?? "") + " ▸").font(.system(size: 13.5, weight: .medium))
                .padding(.horizontal, 10).frame(height: 32).overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.line)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).accessibilityLabel(L.t("Shape \(Customizing.shapeName(id, opts(id).shape) ?? "")", "모양 \(Customizing.shapeName(id, opts(id).shape) ?? "")")).accessibilityIdentifier("cz-shape-\(id.rawValue)")
    }
    private func shownSwitch(_ id: Item, enabled: Bool, hideFirst: Bool) -> some View {
        Toggle(L.t("Show", "보이기"), isOn: Binding(get: { !arrangement.hidden.contains(id) }, set: { on in
            if !on && hideFirst { session.selected = nil; session.sheet = nil }
            store.change(preset) { a in if on { a.hidden.removeAll { $0 == id } } else { Customizing.hide(id, &a) } }
        }))
        .labelsHidden().disabled(!enabled)
        .accessibilityIdentifier("cz-shown-\(id.rawValue)")
    }

    // The object's own sheet: its size, its count, its shape (into the gallery) and whether it shows.
    private func object(_ id: Item) -> some View {
        let caps = Customizing.caps(id, in: preset), name = Customizing.names[id] ?? id.rawValue
        return VStack(alignment: .leading, spacing: 10) {
            header(name) { session.selected = nil; session.sheet = nil }
            ScrollView {
                VStack(spacing: 6) {
                    if caps.size { row(L.t("Size", "크기")) { sizes(id) } }
                    if caps.count { row(L.t("Count", "개수")) { counts(id) } }
                    if caps.shape { row(L.t("Shape", "모양")) { shapeButton(id) } }
                    if caps.hide { row(L.t("Show", "보이기")) { shownSwitch(id, enabled: true, hideFirst: true) } }
                    if !(caps.size || caps.count || caps.shape || caps.hide) {
                        Text(L.t("You can only drag it to another place.", "끌어서 자리만 옮길 수 있습니다.")).font(.system(size: 14)).foregroundStyle(theme.muted).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            pillButton(L.t("Full list", "전체 목록"), id: "cz-all") { session.list() }
        }
        .padding(.horizontal, 14).padding(.top, 18).padding(.bottom, 10)
        .accessibilityElement(children: .contain).accessibilityIdentifier("cz-object-\(id.rawValue)")
    }
    private func pillButton(_ title: String, id: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 14, weight: .bold)).padding(.horizontal, 16).frame(height: 34)
                .background(theme.raised, in: Capsule()).overlay(Capsule().stroke(theme.line)).contentShape(Capsule())
        }
        .buttonStyle(.plain).frame(maxWidth: .infinity).accessibilityIdentifier(id)
    }

    // The shapes, each drawn by the screen's own component; the picked one is kept at once.
    private func gallery(_ id: Item) -> some View {
        let list = Customizing.shapes[id] ?? [], now = opts(id).shape ?? list.first?.value
        return VStack(alignment: .leading, spacing: 10) {
            header(L.t("\(Customizing.names[id] ?? "") · Shape", "\(Customizing.names[id] ?? "") · 모양")) { session.path = [] }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(list, id: \.value) { shape in
                            let on = shape.value == now
                            Button { store.change(preset) { $0.opts[id, default: .init()].shape = shape.value } } label: {
                                VStack(spacing: 8) {
                                    preview(id, shape.value).allowsHitTesting(false).frame(maxWidth: .infinity).clipped()
                                    Text(shape.label).font(.system(size: 14, weight: .semibold)).foregroundStyle(on ? theme.ink : theme.muted)
                                }
                                .padding(.horizontal, 8).padding(.top, 12).padding(.bottom, 10)
                                .background(theme.background, in: RoundedRectangle(cornerRadius: 16))
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(on ? theme.accent : theme.line, lineWidth: 2))
                                .contentShape(RoundedRectangle(cornerRadius: 16))
                            }
                            .buttonStyle(.plain)
                            .id(shape.value)
                            .accessibilityElement(children: .ignore).accessibilityLabel(shape.label)
                            .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
                            .accessibilityIdentifier("cz-card-\(shape.value)")
                        }
                    }
                    .padding(2)
                }
                .onAppear { if let now { proxy.scrollTo(now, anchor: .center) } }
            }
        }
        .padding(.horizontal, 14).padding(.top, 18).padding(.bottom, 10)
        .accessibilityElement(children: .contain).accessibilityIdentifier("cz-gallery-\(id.rawValue)")
    }

    // Every object at once: the phone's tabs on top, then each object's order, size or count, shape and shown, and
    // the defaults at the bottom.
    private var list: some View {
        let known = Customizing.known(preset), ids = arrangement.order.filter { known.contains($0) }
        let movable = ids.filter { Customizing.caps($0, in: preset).move }
        return VStack(alignment: .leading, spacing: 10) {
            header(L.t("\(Customizing.title(preset)) list", "\(Customizing.title(preset)) 목록")) { session.sheet = nil }
            ScrollView {
                VStack(spacing: 6) {
                    row(L.t("Dashboard and Cluster tabs", "대시보드·계기판 탭")) {
                        HStack(spacing: 2) {
                            ForEach([ScreenLayout.Tabs.two, .one], id: \.self) { t in
                                let on = store.layout.tabs == t
                                Button { store.change { $0.tabs = t } } label: {
                                    Text(t == .two ? L.t("Separate", "따로") : L.t("Combined", "하나로")).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(on ? theme.ink : theme.muted)
                                        .padding(.horizontal, 8).frame(minWidth: 52).frame(height: 30).background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 7))
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : []).accessibilityIdentifier("cz-tabs-\(t.rawValue)")
                            }
                        }
                        .padding(2).overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.line))
                    }
                    if preset == .cluster {
                        row(L.t("Cluster design", "계기판 디자인")) {
                            Button { themeSheet = true } label: {
                                Text(ClusterThemePrefs.name(looks.theme) + " ▸").font(.system(size: 14, weight: .semibold)).lineLimit(1).padding(.horizontal, 10).frame(height: 32)
                                    .background(theme.raised, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.line))
                            }
                            .buttonStyle(.plain).accessibilityIdentifier("cz-theme")
                        }
                    }
                    ForEach(ids, id: \.self) { id in listRow(id, first: id == movable.first, last: id == movable.last) }
                    row(L.t("Value · weekly report", "본전·주간 리포트")) {
                        Button { reportSheet = true } label: {
                            Text(ReportPrefs.name(reportPrefs.shape) + " ▸").font(.system(size: 14, weight: .semibold)).padding(.horizontal, 10).frame(height: 32)
                                .background(theme.raised, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.line))
                        }
                        .buttonStyle(.plain).accessibilityIdentifier("cz-reports")
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            pillButton(L.t("Reset to defaults", "기본값으로 되돌리기"), id: "cz-reset") { store.reset(preset); reportPrefs.reset(); if preset == .cluster { looks.theme = nil } }
        }
        .padding(.horizontal, 14).padding(.top, 18).padding(.bottom, 10)
        .sheet(isPresented: $reportSheet) { ReportSettingsSheet() }
        .sheet(isPresented: $themeSheet) { ThemeGallerySheet() }
        .accessibilityElement(children: .contain).accessibilityIdentifier("cz-list-sheet")
    }
    private func listRow(_ id: Item, first: Bool, last: Bool) -> some View {
        let caps = Customizing.caps(id, in: preset), hidden = arrangement.hidden.contains(id)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("≡").foregroundStyle(theme.dim).accessibilityHidden(true)
                Text(Customizing.names[id] ?? id.rawValue).font(.system(size: 14.5, weight: .bold)).lineLimit(1).fixedSize()
                Spacer(minLength: 6)
                shownSwitch(id, enabled: caps.hide || hidden, hideFirst: false)
                if caps.move {
                    HStack(spacing: 2) {
                        arrow("↑", L.t("Move up", "위로"), id: "cz-up-\(id.rawValue)", enabled: !first) { store.change(preset) { Customizing.shift(id, by: -1, in: preset, &$0) } }
                        arrow("↓", L.t("Move down", "아래로"), id: "cz-down-\(id.rawValue)", enabled: !last) { store.change(preset) { Customizing.shift(id, by: 1, in: preset, &$0) } }
                    }
                } else {
                    Color.clear.frame(width: 58, height: 28)
                }
            }
            if caps.size || caps.count || caps.shape {
                HStack(spacing: 8) {
                    if caps.size { sizes(id) } else if caps.count { counts(id) }
                    if caps.shape { shapeButton(id) }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 22)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(theme.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line))
        .accessibilityElement(children: .contain).accessibilityIdentifier("cz-row-\(id.rawValue)")
    }
    private func arrow(_ glyph: String, _ name: String, id: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.muted).frame(width: 28, height: 28)
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(theme.line)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(!enabled).opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(name).accessibilityIdentifier(id)
    }
}

/// While editing: the hidden objects wait under one chip that opens the list.
struct CustomizeHiddenChip: View {
    let session: CustomizeSession
    let store: LayoutStore
    var theme: QuickTheme
    var body: some View {
        let n = store.layout.presets[session.preset].hidden.filter { Customizing.known(session.preset).contains($0) }.count
        if session.editing && n > 0 && session.sheet == nil {
            Button { session.list() } label: {
                Text(L.t("＋ Hidden parts \(n)", "＋ 숨긴 부품 \(n)")).font(.system(size: 13)).foregroundStyle(theme.muted)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(theme.card, in: Capsule())
                    .overlay(Capsule().stroke(theme.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("cz-hidden-chip")
        }
    }
}
