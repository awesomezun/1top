import SwiftUI

/// The cluster's look (customizing): the 1top instruments, then the 72 themes drawn from this phone's readings, narrowed
/// by kind, as the dashboard's gallery shows them (cluster-themes.js picker). A card picks at once and the sheet stays,
/// so looks can be tried in turn.
struct ThemeGallerySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var looks = ClusterThemePrefs.shared
    @State private var hold = ClusterReadings.Hold()

    var body: some View {
        let now = Date().timeIntervalSince1970
        let r = ClusterReadings(model: model, now: now, pick: nil, only: nil, trip: nil, hold: hold)
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(L.t("Cluster design", "계기판 디자인")).font(.system(size: 17, weight: .bold))
                Spacer()
                Button(L.t("Close", "닫기")) { dismiss() }.font(.system(size: 15, weight: .semibold)).accessibilityIdentifier("theme-gallery-close")
            }
            Text(L.t("Only the instruments change. The window and the fuel stay as they are.", "계기 부분만 바뀝니다. 화면 창과 연료통은 그대로입니다.")).font(.system(size: 12.5)).foregroundStyle(.secondary)
            ThemeHostView(mode: .gallery(selected: looks.theme), key: "\(looks.theme ?? "")|\(model.period.rawValue)",
                          figures: { ClusterThemeFigures.make(r, period: model.period, now: now, odometer: r.tach.tokens ?? 0) },
                          onPress: { if case .pick(let id) = $0 { looks.theme = id } })
        }
        .padding(.horizontal, 16).padding(.top, 18)
        .presentationDetents([.large])
        .accessibilityElement(children: .contain).accessibilityIdentifier("theme-gallery-sheet")
    }
}
