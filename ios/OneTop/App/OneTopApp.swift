import SwiftUI

@main
struct OneTopApp: App {
    @State private var model = AppModel()
    var body: some Scene {
        WindowGroup {
            RootView().environment(model)
        }
    }
}

struct RootView: View {
    enum Screen: String { case dashboard, sessions, usage, limits, settings }
    @Environment(AppModel.self) private var model
    @State private var screen: Screen = .dashboard
    #if DEBUG
    @State private var launchDetail: Session?
    #endif

    var body: some View {
        Group {
            if model.connection == .signedOut && model.devices.isEmpty {
                WelcomeView()
            } else {
                TabView(selection: $screen) {
                    Tab(L.t("Dashboard", "대시보드"), systemImage: "gauge.with.needle", value: .dashboard) { QuickView() }
                    Tab(L.t("Sessions", "세션"), systemImage: "terminal", value: .sessions) { SessionsView() }
                    Tab(L.t("Usage", "사용량"), systemImage: "square.grid.2x2", value: .usage) { UsageView() }
                    Tab(L.t("Limits", "한도"), systemImage: "chart.bar.xaxis", value: .limits) { LimitsView() }
                    Tab(L.t("Workspace", "워크스페이스"), systemImage: "gearshape", value: .settings) { SettingsView() }
                }
                .tabBarMinimizeBehavior(.onScrollDown)
            }
        }
        .preferredColorScheme(model.appearance.scheme)
        #if DEBUG
        // Screenshot runs open a screen directly: -screenTab usage, -screenDetail d1, -screenPane controls.
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
            SessionDetail(session: s, pane: UserDefaults.standard.string(forKey: "screenPane") == "controls" ? .controls : .messages)
        }
        #endif
    }
}
