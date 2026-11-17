import SwiftUI

@main
struct OneTopApp: App {
    @UIApplicationDelegateAdaptor(Orientation.self) private var orientation
    @State private var model = AppModel()
    @State private var layouts = LayoutStore()
    var body: some Scene {
        WindowGroup {
            RootView().environment(model).environment(layouts)
        }
    }
}

/// The phone stays upright on every screen but the cluster, which fills the screen on its side as the dashboard's does.
final class Orientation: NSObject, UIApplicationDelegate {
    @MainActor private static var sideways = false

    /// Lets the phone turn on its side (the cluster on screen) or brings it back upright.
    @MainActor static func allowSideways(_ on: Bool) {
        guard sideways != on else { return }
        sideways = on
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
            // No error handler: UIKit calls it on a background queue, and a closure formed here would belong to the main
            // actor, which stops the app when it runs off the main thread (4.7.0 build 16 on a real iPhone).
            if !on { scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) }
        }
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        Self.sideways ? .allButUpsideDown : .portrait
    }
}

struct RootView: View {
    enum Screen: String { case dashboard, cluster, sessions, usage, limits }
    @Environment(AppModel.self) private var model
    @Environment(LayoutStore.self) private var layouts
    @State private var screen: Screen = .dashboard
    @State private var opened = false

    /// The tab bar, in one place (customizing-spec_v1.2.2). With the dashboard and the cluster apart (the layout's
    /// 'two', the default) the cluster comes right after the dashboard, as on Android, and each tab customizes its own
    /// preset; as one home tab the dashboard's header switches between them. Workspace is not a tab: it opens from the
    /// button at the right end of the dashboard's and the cluster's header, so the bar never folds a tab into More.
    static func screens(_ tabs: ScreenLayout.Tabs) -> [Screen] {
        tabs == .two ? [.dashboard, .cluster, .sessions, .usage, .limits] : [.dashboard, .sessions, .usage, .limits]
    }
    /// The tab the app opens on: with the tabs apart, the preset's own, so it reopens where it was left (and a cluster
    /// chosen before the tabs came apart opens on 계기판); as one home tab, the dashboard, which shows the preset.
    static func opening(_ layout: ScreenLayout) -> Screen { layout.tabs == .two && layout.preset == .cluster ? .cluster : .dashboard }
    /// The preset a tab keeps: with the tabs apart, moving between 대시보드 and 계기판 remembers it, as the menu bar's
    /// quick switch does; any other tab, or one home tab, leaves it.
    static func remembered(_ screen: Screen, tabs: ScreenLayout.Tabs) -> ScreenLayout.Preset? {
        guard tabs == .two else { return nil }
        return screen == .cluster ? .cluster : screen == .dashboard ? .dashboard : nil
    }
    private func title(_ s: Screen) -> String {
        switch s {
        case .dashboard: L.t("Dashboard", "대시보드")
        case .cluster: L.t("Cluster", "계기판")
        case .sessions: L.t("Sessions", "세션")
        case .usage: L.t("Usage", "사용량")
        case .limits: L.t("Limits", "한도")
        }
    }
    private func symbol(_ s: Screen) -> String {
        switch s {
        case .dashboard: "gauge.with.needle"
        case .cluster: "gauge.open.with.lines.needle.33percent"
        case .sessions: "terminal"
        case .usage: "square.grid.2x2"
        case .limits: "chart.bar.xaxis"
        }
    }
    @ViewBuilder private func content(_ s: Screen, tabs: ScreenLayout.Tabs) -> some View {
        switch s {
        case .dashboard: QuickView(fixed: tabs == .two ? .dashboard : nil)
        case .cluster: QuickView(fixed: .cluster)
        case .sessions: SessionsView()
        case .usage: UsageView()
        case .limits: LimitsView()
        }
    }
    #if DEBUG
    @State private var launchDetail: Session?
    #endif

    var body: some View {
        @Bindable var model = model
        Group {
            if model.connection == .signedOut && model.devices.isEmpty {
                WelcomeView()
            } else {
                let tabs = layouts.layout.tabs
                TabView(selection: $screen) {
                    ForEach(Self.screens(tabs), id: \.self) { s in
                        Tab(title(s), systemImage: symbol(s), value: s) {
                            content(s, tabs: tabs)
                                .safeAreaInset(edge: .bottom) { if model.connection == .demo { DemoConnectBar() } }
                        }
                    }
                }
                .tabBarMinimizeBehavior(.onScrollDown)
                // The cluster tab going away (one home tab) leaves its place to the dashboard.
                .onChange(of: tabs) { if !Self.screens(tabs).contains(screen) { screen = .dashboard } }
                .onAppear {
                    guard !opened else { return }
                    opened = true
                    #if DEBUG
                    // A screenshot run's -screenTab opens its own tab.
                    if UserDefaults.standard.string(forKey: "screenTab") != nil { return }
                    #endif
                    screen = Self.opening(layouts.layout)
                }
                .onChange(of: screen) {
                    if let preset = Self.remembered(screen, tabs: layouts.layout.tabs), preset != layouts.layout.preset { layouts.change { $0.preset = preset } }
                }
            }
        }
        .preferredColorScheme(model.appearance.scheme)
        .sheet(isPresented: $model.paywallOpen) { PaywallSheet() }
        #if DEBUG
        // Screenshot runs open a screen directly: -screenTab usage, -screenDetail s1.
        .task {
            let defaults = UserDefaults.standard
            if let tab = defaults.string(forKey: "screenTab").flatMap(Screen.init) { screen = tab }
            if let computer = defaults.string(forKey: "screenComputer") { model.selectedDeviceID = computer }
            // Live sessions arrive a few seconds after launch; wait up to 30 seconds for the one asked for.
            guard let id = defaults.string(forKey: "screenDetail") else { return }
            for _ in 0..<60 {
                if let s = model.allSessions.first(where: { $0.id == id }) { launchDetail = s; return }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        .sheet(item: $launchDetail) { s in
            SessionDetail(session: s)
                .detailSource("launch", s.id)
        }
        #endif
    }
}
