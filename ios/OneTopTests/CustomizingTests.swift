import XCTest
@testable import OneTop

/// Customizing on the iPhone edits the layout as the web's customize.js does: what each object can change on the
/// phone, the steps a count takes ('as many as fit' / 'all' starting from what shows now), where a drop or ↑↓ puts an
/// object, every change saved at once and never over a newer version's layout, and the phone's tabs in one place.
@MainActor
final class CustomizingTests: XCTestCase {
    typealias Item = ScreenLayout.Item
    private let suite = "si.onetop.customizing-tests"


    override func setUp() async throws { saved = L.language; L.language = .ko }
    override func tearDown() async throws {
        L.language = saved
        UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
    }
    private var saved = Language.ko

    func testWhatEachObjectCanChangeOnThePhone() {
        // The cluster: the period control keeps its place and only changes shape; the dials stay on top and shown.
        XCTAssertEqual(Customizing.known(.cluster), [.periods, .dials, .alerts, .odo, .fuel, .window])
        XCTAssertEqual(Customizing.caps(.periods, in: .cluster), .init(size: false, count: false, shape: true, move: false, hide: false))
        XCTAssertEqual(Customizing.caps(.dials, in: .cluster), .init(size: true, count: false, shape: true, move: false, hide: false))
        XCTAssertEqual(Customizing.caps(.alerts, in: .cluster), .init(size: false, count: true, shape: true, move: true, hide: true))
        XCTAssertEqual(Customizing.caps(.odo, in: .cluster), .init(size: false, count: false, shape: true, move: true, hide: true))
        XCTAssertEqual(Customizing.caps(.fuel, in: .cluster), .init(size: false, count: true, shape: false, move: true, hide: true))
        XCTAssertEqual(Customizing.caps(.window, in: .cluster), .init(size: true, count: false, shape: false, move: true, hide: true))
        // The dashboard: its period control is plain, the rest move and hide.
        XCTAssertEqual(Customizing.known(.dashboard), [.periods, .tokens, .weekly, .resources, .sessions])
        XCTAssertEqual(Customizing.caps(.periods, in: .dashboard), .init())
        XCTAssertEqual(Customizing.caps(.tokens, in: .dashboard), .init(size: true, count: false, shape: false, move: true, hide: true))
        XCTAssertEqual(Customizing.caps(.weekly, in: .dashboard), .init(size: false, count: true, shape: false, move: true, hide: true))
        XCTAssertEqual(Customizing.caps(.resources, in: .dashboard), .init(size: false, count: false, shape: false, move: true, hide: true))
        // Names and shapes in customize.js's words.
        XCTAssertEqual(Customizing.names[.window], "창(탭)")
        XCTAssertEqual(Customizing.shapes[.odo]?.map(\.label), ["O5 드럼", "O1 LED", "O2 LED 0 채움", "O3 인쇄", "O4 인쇄 0 채움"])
        XCTAssertEqual(Customizing.shapes[.periods]?.map(\.value), ScreenLayout.Item.periods.kind.shapes)
        XCTAssertEqual(Customizing.shapes[.alerts]?.map(\.value), ScreenLayout.Item.alerts.kind.shapes)
    }

    func testCountsStepFromWhatShowsNow() {
        XCTAssertEqual(Customizing.countSteps(.alerts), [3, 4, 5, 6].map(ScreenLayout.Options.Count.value))
        XCTAssertEqual(Customizing.countSteps(.weekly), [.value(2), .value(4), .value(6), .all])
        XCTAssertEqual(Customizing.countSteps(.fuel).last, .all)
        XCTAssertEqual(Customizing.countSteps(.sessions).count, 9)
        XCTAssertEqual(Customizing.countText(.fuel, .all), "자동")
        XCTAssertEqual(Customizing.countText(.sessions, .all), "모두")
        XCTAssertEqual(Customizing.countText(.weekly, .value(4)), "4칸")
        var a = ScreenLayout.defaults.presets.cluster
        // Fuel on 'as many as fit' with five showing: one less is four, one more six.
        Customizing.step(.fuel, by: -1, shown: 5, &a)
        XCTAssertEqual(a.opts[.fuel]?.count, .value(4))
        a = ScreenLayout.defaults.presets.cluster
        Customizing.step(.fuel, by: 1, shown: 5, &a)
        XCTAssertEqual(a.opts[.fuel]?.count, .value(6))
        // Nothing known about what shows: a step down from the end.
        a = ScreenLayout.defaults.presets.cluster
        Customizing.step(.fuel, by: -1, shown: nil, &a)
        XCTAssertEqual(a.opts[.fuel]?.count, .value(8))
        // The ends hold.
        a = ScreenLayout.defaults.presets.cluster
        Customizing.step(.alerts, by: 5, shown: nil, &a)
        XCTAssertEqual(a.opts[.alerts]?.count, .value(6))
        var d = ScreenLayout.defaults.presets.dashboard
        Customizing.step(.weekly, by: 1, shown: nil, &d)
        XCTAssertEqual(d.opts[.weekly]?.count, .value(6))
        Customizing.step(.weekly, by: 1, shown: nil, &d)
        XCTAssertEqual(d.opts[.weekly]?.count, .all)
        // 'All' sessions with seven rows: one less is six.
        Customizing.step(.sessions, by: -1, shown: 7, &d)
        XCTAssertEqual(d.opts[.sessions]?.count, .value(6))
    }

    func testDropsAndArrowsPutObjectsWhereTheWebDoes() {
        var a = ScreenLayout.defaults.presets.cluster
        Customizing.move(.fuel, before: .alerts, in: .cluster, &a)
        XCTAssertEqual(a.order, [.periods, .dials, .fuel, .alerts, .odo, .temps, .window])
        // Dropped below everything: after the last object that moves.
        Customizing.move(.alerts, before: nil, in: .cluster, &a)
        XCTAssertEqual(a.order, [.periods, .dials, .fuel, .odo, .temps, .window, .alerts])
        // ↑ and ↓ step over the objects that move here, not over temps or the dials.
        Customizing.shift(.alerts, by: -1, in: .cluster, &a)
        XCTAssertEqual(a.order, [.periods, .dials, .fuel, .odo, .temps, .alerts, .window])
        Customizing.shift(.alerts, by: -1, in: .cluster, &a)
        XCTAssertEqual(a.order, [.periods, .dials, .fuel, .alerts, .odo, .temps, .window])
        Customizing.shift(.fuel, by: -1, in: .cluster, &a)
        XCTAssertEqual(a.order, [.periods, .dials, .fuel, .alerts, .odo, .temps, .window], "the first that moves stays first")
        var d = ScreenLayout.defaults.presets.dashboard
        Customizing.shift(.tokens, by: 1, in: .dashboard, &d)
        XCTAssertEqual(d.order, [.periods, .weekly, .tokens, .resources, .sessions])
        Customizing.move(.sessions, before: .weekly, in: .dashboard, &d)
        XCTAssertEqual(d.order, [.periods, .sessions, .weekly, .tokens, .resources])
        Customizing.hide(.resources, &d); Customizing.hide(.resources, &d)
        XCTAssertEqual(d.hidden, [.resources])
        Customizing.toggle(.resources, &d)
        XCTAssertEqual(d.hidden, [])
    }

    func testEveryChangeIsSavedAtOnceAndNeverOverANewerLayout() throws {
        let store = try XCTUnwrap(UserDefaults(suiteName: suite))
        store.removePersistentDomain(forName: suite)
        let layouts = LayoutStore(store: store)
        XCTAssertEqual(layouts.layout, ScreenLayout.defaults)
        layouts.change(.cluster) { $0.opts[.alerts]?.shape = "badge"; Customizing.hide(.odo, &$0) }
        layouts.change { $0.tabs = .one; $0.preset = .cluster }
        // A new start on this device reads the same layout back.
        let again = LayoutStore(store: store).layout
        XCTAssertEqual(again.presets.cluster.opts[.alerts]?.shape, "badge")
        XCTAssertEqual(again.presets.cluster.hidden, [.odo, .temps], "hidden in the objects' order")
        XCTAssertEqual(again.tabs, .one)
        XCTAssertEqual(again.preset, .cluster)
        // The defaults again for one preset only.
        layouts.change(.dashboard) { Customizing.hide(.weekly, &$0) }
        layouts.reset(.cluster)
        let reset = LayoutStore(store: store).layout
        XCTAssertEqual(reset.presets.cluster, ScreenLayout.defaults.presets.cluster)
        XCTAssertEqual(reset.presets.dashboard.hidden, [.weekly])
        XCTAssertEqual(reset.tabs, .one)
        // A newer version's layout shows as the defaults and is never written over.
        let newer = #"{"v":2,"tabs":"one","future":true}"#
        store.set(newer, forKey: ScreenLayout.key)
        let locked = LayoutStore(store: store)
        XCTAssertTrue(locked.locked)
        XCTAssertEqual(locked.layout, ScreenLayout.defaults)
        locked.change(.cluster) { Customizing.hide(.alerts, &$0) }
        XCTAssertEqual(locked.layout.presets.cluster.hidden, [.temps, .alerts], "the change shows")
        XCTAssertEqual(store.string(forKey: ScreenLayout.key), newer, "but is not saved")
    }

    /// Every word of customizing in the glossary's terms (customizing-glossary_v1.0.0.md), English and Chinese; the
    /// editor's 완료 is Done / 完成 while the cluster's 완료됨 light stays Done / 已完成.
    func testCustomizingSpeaksTheGlossary() {
        L.language = .en
        XCTAssertEqual(Customizing.names[.periods], "Time window picker")
        XCTAssertEqual(Customizing.names[.window], "Window (tabs)")
        XCTAssertEqual(Customizing.sizes, ["Small", "Medium", "Large"])
        XCTAssertEqual(Customizing.shapes[.alerts]?.map(\.label), ["Labels", "Chips", "Strip", "Counts", "Badges", "Lenses"])
        XCTAssertEqual(Customizing.shapes[.odo]?.map(\.label), ["O5 Drum", "O1 LED", "O2 LED, zero-padded", "O3 Print", "O4 Print, zero-padded"])
        XCTAssertEqual([Customizing.countText(.fuel, .all), Customizing.countText(.sessions, .all), Customizing.countText(.weekly, .value(4)),
                        Customizing.countText(.alerts, .value(6)), Customizing.countText(.sessions, .value(5))], ["Auto", "All", "4 slots", "6", "5 rows"])
        XCTAssertEqual(L.t("Customize \(Customizing.title(.cluster))", ""), "Customize Cluster")
        XCTAssertEqual(L.t("Done", "완료", zh: "完成"), "Done")
        L.language = .zh
        XCTAssertEqual(Customizing.names[.periods], "时段选择器")
        XCTAssertEqual([Item.dials, .alerts, .odo, .fuel, .window, .tokens, .weekly, .sessions].map { Customizing.names[$0]! },
                       ["双仪表", "警示灯", "合计·小计", "剩余额度", "窗口（标签页）", "Token 用量", "账户额度", "会话列表"])
        XCTAssertEqual(Customizing.sizes, ["小", "中", "大"])
        XCTAssertEqual(Customizing.shapes[.periods]?.map(\.label), ["本屏默认", "标签页", "滚筒", "调谐尺", "滚轮", "旋钮", "拨杆"])
        XCTAssertEqual(Customizing.shapes[.dials]?.map(\.label), ["圆环", "光晕", "面板"])
        XCTAssertEqual(Customizing.shapes[.alerts]?.map(\.label), ["名称", "胶囊", "灯条", "数字", "徽章", "透镜"])
        XCTAssertEqual(Customizing.shapes[.odo]?.map(\.label), ["O5 滚筒", "O1 LED", "O2 LED 补零", "O3 印刷", "O4 印刷 补零"])
        XCTAssertEqual([Customizing.countText(.fuel, .all), Customizing.countText(.sessions, .all), Customizing.countText(.weekly, .value(4)),
                        Customizing.countText(.alerts, .value(6)), Customizing.countText(.sessions, .value(5))], ["自动", "全部", "4 格", "6 个", "5 行"])
        let title = Customizing.title(.cluster)
        XCTAssertEqual(L.t("Customize \(title)", ""), "自定义组合仪表")
        XCTAssertEqual(L.t("\(title) list", ""), "组合仪表列表")
        XCTAssertEqual(L.t("\(Customizing.names[.alerts]!) · Shape", ""), "警示灯 · 样式")
        XCTAssertEqual(L.t("Hide \(Customizing.names[.odo]!)", ""), "隐藏合计·小计")
        XCTAssertEqual(L.t("＋ Hidden parts 2", ""), "＋ 已隐藏的部件 2")
        XCTAssertEqual(L.t("Done", "완료", zh: "完成"), "完成")
        XCTAssertEqual(L.t("Done", "완료됨"), "已完成", "the cluster's light keeps its word")
        XCTAssertEqual(L.t("More", "늘리기", zh: "增加"), "增加")
        XCTAssertEqual(["List", "Close", "Show", "Size", "Count", "Shape", "Full list", "Move up", "Move down", "Reset to defaults",
                        "Dashboard and Cluster tabs", "Separate", "Combined", "You can only drag it to another place.", "Preset", "Workspace"].map { L.t($0, "") },
                       ["列表", "关闭", "显示", "大小", "数量", "样式", "完整列表", "上移", "下移", "恢复默认", "仪表盘与组合仪表标签页", "分开", "合并", "只能拖动改变位置。", "预设", "工作区"])
    }

    /// The cluster's window opens on the page last chosen only while its tab shows; otherwise on the first tab chosen.
    func testTheWindowOpensOnAChosenTab() {
        XCTAssertEqual(ClusterWindow.page("sessions", tabs: [.system, .map]), "system")
        XCTAssertEqual(ClusterWindow.page("map", tabs: [.system, .map]), "map")
        XCTAssertEqual(ClusterWindow.page("sessions", tabs: [.map, .sessions]), "sessions")
        XCTAssertEqual(ClusterWindow.page("weekly", tabs: ScreenLayout.Mode.allCases), "weekly")
    }

    /// The tab bar in one place: apart, the cluster right after the dashboard; together, one home tab. Workspace is
    /// the header's button, so the bar never folds a tab into More.
    func testThePhonesTabs() {
        XCTAssertEqual(RootView.screens(.two), [.dashboard, .cluster, .sessions, .usage, .limits])
        XCTAssertEqual(RootView.screens(.one), [.dashboard, .sessions, .usage, .limits])
        XCTAssertLessThanOrEqual(RootView.screens(.two).count, 5)
        XCTAssertNotEqual(QuickView.workspaceSymbol.prefix(4), "gear")
    }

    /// Apart, the app opens on the preset's own tab and moving between 대시보드 and 계기판 keeps the preset, so the next
    /// launch reopens where it was left; as one home tab nothing changes.
    func testTheTabsRememberThePreset() throws {
        var layout = ScreenLayout.defaults
        XCTAssertEqual(RootView.opening(layout), .dashboard)
        layout.preset = .cluster
        XCTAssertEqual(RootView.opening(layout), .cluster)
        layout.tabs = .one
        XCTAssertEqual(RootView.opening(layout), .dashboard, "one home tab shows the preset itself")
        XCTAssertEqual(RootView.remembered(.cluster, tabs: .two), .cluster)
        XCTAssertEqual(RootView.remembered(.dashboard, tabs: .two), .dashboard)
        XCTAssertNil(RootView.remembered(.sessions, tabs: .two))
        XCTAssertNil(RootView.remembered(.dashboard, tabs: .one))
        // The panel's cluster chosen before anything was saved opens on 계기판.
        let store = try XCTUnwrap(UserDefaults(suiteName: suite))
        store.removePersistentDomain(forName: suite)
        store.set(true, forKey: "quickCluster")
        XCTAssertEqual(RootView.opening(LayoutStore(store: store).layout), .cluster)
        XCTAssertEqual(ScreenLayout.defaults.tabs, .two)
    }
}
