import Foundation

// One zoom for the whole app: the dashboard window's page zoom and the quick view's sizes.
// UI tests keep it in memory so they never change the saved setting.
final class AppZoom: ObservableObject {
    static let range = 0.8...1.6
    @Published private(set) var value: Double
    var onChange: (() -> Void)?
    private let persist: Bool
    init(persist: Bool) {
        self.persist = persist
        let saved = persist ? UserDefaults.standard.double(forKey: "dashboardZoom") : 0
        value = saved == 0 ? 1 : min(Self.range.upperBound, max(Self.range.lowerBound, saved))
    }
    // Tenths only, so repeated steps land on 0.8, 0.9 … 1.6.
    func set(_ next: Double) {
        let clamped = min(Self.range.upperBound, max(Self.range.lowerBound, (next * 10).rounded() / 10))
        guard clamped != value else { return }
        value = clamped
        if persist { UserDefaults.standard.set(clamped, forKey: "dashboardZoom") }
        onChange?()
    }
}
