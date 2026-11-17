import Foundation
import Observation

/// Customizing on the iPhone (customizing-spec_v1.2.2), as the web's customize.js edits a screen: which objects each
/// preset offers here, what each one can change, its names and shapes in the words customize.js uses, the steps a
/// count takes, and the edits themselves on a layout. The phone keeps the period control in place (its shape only), the
/// two dials always on top, and never draws CPU and memory in the upright cluster, so those are not offered. The words
/// are read in the language chosen, in the terms of docs/design/customizing/customizing-glossary_v1.0.0.md.
enum Customizing {
    typealias Item = ScreenLayout.Item
    typealias Preset = ScreenLayout.Preset
    typealias Count = ScreenLayout.Options.Count

    static var sizes: [String] { [L.t("Small", "작게"), L.t("Medium", "보통"), L.t("Large", "크게")] }
    static var names: [Item: String] {
        [.periods: L.t("Time window picker", "기간 선택"), .dials: L.t("Dials", "두 계기"), .alerts: L.t("Warning lights", "경고등"),
         .odo: L.t("Total · Trip", "합계·트립"), .temps: L.t("CPU · Memory", "CPU·메모리"), .fuel: L.t("Limit left", "남은 한도"),
         .window: L.t("Window (tabs)", "창(탭)"), .tokens: L.t("Token usage", "토큰 사용"), .weekly: L.t("Account limits", "계정 한도"),
         .resources: L.t("CPU · Memory", "CPU·메모리"), .sessions: L.t("Session list", "세션 목록")]
    }
    /// Each shape and its name, the first today's ('auto' is this screen's own: the phone's drum).
    static var shapes: [Item: [(value: String, label: String)]] {
        [.periods: [("auto", L.t("Screen default", "이 화면 기본")), ("tabs", L.t("Tabs", "탭")), ("drum", L.t("Drum", "드럼")), ("tuner", L.t("Tuner", "튜너")),
                    ("roller", L.t("Roller", "롤러")), ("knob", L.t("Knob", "노브")), ("lever", L.t("Lever", "레버"))],
         .dials: [("ring", L.t("Ring", "고리")), ("glow", L.t("Glow", "빛")), ("plate", L.t("Plate", "판"))],
         .alerts: [("label", L.t("Labels", "이름표")), ("chips", L.t("Chips", "칩")), ("strip", L.t("Strip", "띠")), ("count", L.t("Counts", "숫자")),
                   ("badge", L.t("Badges", "배지")), ("lens", L.t("Lenses", "렌즈"))],
         .odo: [("drum", L.t("O5 Drum", "O5 드럼")), ("led", L.t("O1 LED", "O1 LED")), ("led0", L.t("O2 LED, zero-padded", "O2 LED 0 채움")),
                ("print", L.t("O3 Print", "O3 인쇄")), ("print0", L.t("O4 Print, zero-padded", "O4 인쇄 0 채움"))]]
    }
    static func title(_ preset: Preset) -> String { preset == .cluster ? L.t("Cluster", "계기판") : L.t("Dashboard", "대시보드") }

    /// The objects each preset offers on the phone, in their default order.
    static func known(_ preset: Preset) -> [Item] {
        preset == .cluster ? [.periods, .dials, .alerts, .odo, .fuel, .window] : [.periods, .tokens, .weekly, .resources, .sessions]
    }

    /// What one object can change here.
    struct Caps: Equatable { var size = false, count = false, shape = false, move = false, hide = false }
    static func caps(_ id: Item, in preset: Preset) -> Caps {
        let kind = id.kind, fixed = id == .periods
        // The dashboard's period control has no options of its own (plain); the cluster's turns into other shapes.
        let plain = preset == .dashboard && id == .periods
        return Caps(size: kind.size != nil, count: kind.counts != nil, shape: !plain && shapes[id] != nil,
                    move: !fixed && id != .dials, hide: !fixed && id != .dials)
    }

    /// The counts a step goes through: the range, then 'as many as fit' / 'all' where it has one; the account limits
    /// snap to 2, 4 and 6.
    static func countSteps(_ id: Item) -> [Count] {
        let kind = id.kind
        guard let range = kind.counts else { return [] }
        let numbers = (kind.steps ?? Array(range)).map(Count.value)
        return numbers + (kind.count == .all || id == .weekly ? [.all] : [])
    }
    /// Where a count stands among its steps; 'as many as fit' / 'all' stands at the number shown now.
    static func startAt(_ id: Item, _ steps: [Count], current: Count?, shown: Int?) -> Int {
        if case .value(let v)? = current { return max(0, steps.firstIndex(of: .value(v)) ?? 0) }
        guard let shown else { return steps.count - 1 }
        let i = steps.firstIndex { if case .value(let n) = $0 { n >= shown } else { false } }
        return i ?? max(0, steps.count - 2)
    }
    static func countText(_ id: Item, _ count: Count?) -> String {
        guard case .value(let n)? = count else { return id == .fuel ? L.t("Auto", "자동") : L.t("All", "모두") }
        switch id {
        case .fuel, .weekly: return L.t("\(n) slots", "\(n)칸")
        case .sessions: return L.t("\(n) rows", "\(n)줄")
        default: return L.t("\(n)", "\(n)개", zh: "\(n) 个")
        }
    }
    static func shapeName(_ id: Item, _ shape: String?) -> String? {
        guard let list = shapes[id] else { return nil }
        return (list.first { $0.value == shape } ?? list[0]).label
    }

    // MARK: Edits on one preset's arrangement
    static func hide(_ id: Item, _ a: inout ScreenLayout.Arrangement) { if !a.hidden.contains(id) { a.hidden.append(id) } }
    static func toggle(_ id: Item, _ a: inout ScreenLayout.Arrangement) {
        if a.hidden.contains(id) { a.hidden.removeAll { $0 == id } } else { a.hidden.append(id) }
    }
    static func step(_ id: Item, by d: Int, shown: Int?, _ a: inout ScreenLayout.Arrangement) {
        let steps = countSteps(id)
        guard !steps.isEmpty else { return }
        let at = startAt(id, steps, current: a.opts[id]?.count, shown: shown)
        a.opts[id, default: .init()].count = steps[max(0, min(steps.count - 1, at + d))]
    }
    /// Moves an object before another (nil: after the last object that moves), as a drop does.
    static func move(_ id: Item, before: Item?, in preset: Preset, _ a: inout ScreenLayout.Arrangement) {
        guard id != before, let from = a.order.firstIndex(of: id) else { return }
        a.order.remove(at: from)
        if let before, let at = a.order.firstIndex(of: before) { a.order.insert(id, at: at); return }
        let movable = known(preset).filter { caps($0, in: preset).move }
        if let last = a.order.lastIndex(where: { movable.contains($0) }) { a.order.insert(id, at: last + 1) } else { a.order.append(id) }
    }
    /// Moves an object one place up or down among the objects here that move (the list's ↑ and ↓).
    static func shift(_ id: Item, by d: Int, in preset: Preset, _ a: inout ScreenLayout.Arrangement) {
        let movable = a.order.filter { known(preset).contains($0) && caps($0, in: preset).move }
        guard let i = movable.firstIndex(of: id), movable.indices.contains(i + d), let from = a.order.firstIndex(of: id) else { return }
        a.order.remove(at: from)
        let at = a.order.firstIndex(of: movable[i + d])!
        a.order.insert(id, at: d < 0 ? at : at + 1)
    }
}

/// This device's layout, read once and saved after every change (never over a layout a newer version wrote), shared by
/// every screen so the dashboard, the cluster and the tabs never write over each other's changes.
@MainActor @Observable
final class LayoutStore {
    private(set) var stored: ScreenLayout.Stored
    @ObservationIgnored private let store: UserDefaults

    init(store: UserDefaults = .standard) {
        self.store = store
        #if DEBUG
        // Tests start from a layout of their own: -layoutSeed '{"v":1,…}', or -layoutSeed none for nothing stored. Read
        // from the arguments themselves, as UserDefaults would take the JSON for a property list.
        let args = ProcessInfo.processInfo.arguments
        if let at = args.firstIndex(of: "-layoutSeed"), at + 1 < args.count {
            let seed = args[at + 1]
            if seed == "none" { store.removeObject(forKey: ScreenLayout.key) } else { store.set(seed, forKey: ScreenLayout.key) }
        }
        #endif
        stored = ScreenLayout.load(from: store)
    }

    var layout: ScreenLayout { stored.layout }
    /// A newer version wrote this device's layout: the screens draw the defaults and nothing is saved.
    var locked: Bool { stored.locked }

    func change(_ edit: (inout ScreenLayout) -> Void) {
        edit(&stored.layout)
        ScreenLayout.save(stored, to: store)
    }
    func change(_ preset: ScreenLayout.Preset, _ edit: (inout ScreenLayout.Arrangement) -> Void) {
        change { edit(&$0.presets[preset]) }
    }
    /// One preset back to its defaults, order and options included.
    func reset(_ preset: ScreenLayout.Preset) { change { $0.presets[preset] = ScreenLayout.defaults.presets[preset] } }
}
