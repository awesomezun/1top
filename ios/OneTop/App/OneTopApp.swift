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
    @Environment(AppModel.self) private var model
    var body: some View {
        if model.connection == .signedOut && model.devices.isEmpty {
            WelcomeView()
        } else {
            TabView {
                Tab("대시보드", systemImage: "gauge.with.needle") { QuickView() }
                Tab("세션", systemImage: "terminal") { SessionsView() }
                Tab("한도", systemImage: "chart.bar.xaxis") { LimitsView() }
                Tab("설정", systemImage: "gearshape") { SettingsView() }
            }
            .tabBarMinimizeBehavior(.onScrollDown)
        }
    }
}
