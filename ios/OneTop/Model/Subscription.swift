import Foundation
import Observation

/// The remote subscription's plans and purchases (docs/design/subscription/subscription-plan_v1.0.0.md). RevenueCat
/// supplies the store's own prices, trial and purchases once its key is in the app; until then, and in previews and UI
/// tests, the preview backend shows the planned prices and buys nothing. Remote access itself is decided by the relay.
@MainActor @Observable final class Subscription {
    struct Plan: Identifiable, Equatable, Sendable {
        let id: String
        let yearly: Bool
        let amount: Decimal
        let currency: String
        /// Days of the introductory free trial this account can still use; nil when there is none.
        let trialDays: Int?
    }
    enum Phase: Equatable { case idle, loading, buying, restoring }

    private(set) var plans: [Plan] = []
    var chosen: String?
    private(set) var phase: Phase = .idle
    var note: String?
    let backend: any SubscriptionBackend

    init(backend: any SubscriptionBackend = PreviewSubscriptions()) { self.backend = backend }

    var plan: Plan? { plans.first { $0.id == chosen } ?? plans.first }
    var yearly: Plan? { plans.first(where: \.yearly) }
    var monthly: Plan? { plans.first { !$0.yearly } }

    func load() async {
        guard plans.isEmpty, phase == .idle else { return }
        phase = .loading; defer { phase = .idle }
        do {
            plans = try await backend.plans().sorted { $0.yearly && !$1.yearly }
            chosen = chosen ?? yearly?.id ?? plans.first?.id
        } catch { note = error.localizedDescription }
    }

    /// True when the store took the payment; the relay grants access once RevenueCat tells it.
    func buy() async -> Bool {
        guard let plan, phase == .idle else { return false }
        phase = .buying; defer { phase = .idle }
        do { note = nil; return try await backend.buy(plan.id) } catch { note = error.localizedDescription; return false }
    }

    func restore() async -> Bool {
        guard phase == .idle else { return false }
        phase = .restoring; defer { phase = .idle }
        do {
            note = nil
            let found = try await backend.restore()
            if !found { note = L.t("No subscription was found for this Apple ID.", "이 Apple ID로 구독한 내역이 없습니다.") }
            return found
        } catch { note = error.localizedDescription; return false }
    }

    // MARK: Words

    func price(_ plan: Plan) -> String { Self.money(plan.amount, plan.currency) }
    /// The yearly plan per month, for comparison: $1.67.
    func perMonth(_ plan: Plan) -> String { Self.money((plan.amount / 12 * 100).rounded() / 100, plan.currency) }
    /// The yearly plan against twelve monthly payments, in whole percent: 44.
    var saving: Int? {
        guard let yearly, let monthly, monthly.amount > 0, yearly.currency == monthly.currency else { return nil }
        let share = NSDecimalNumber(decimal: yearly.amount / (monthly.amount * 12)).doubleValue
        return share < 1 ? Int(((1 - share) * 100).rounded(.down)) : nil
    }

    static func money(_ amount: Decimal, _ currency: String) -> String {
        let format = NumberFormatter()
        format.numberStyle = .currency; format.currencyCode = currency
        format.locale = Locale.current
        return format.string(from: NSDecimalNumber(decimal: amount)) ?? "\(currency) \(amount)"
    }
}

extension Decimal {
    fileprivate func rounded() -> Decimal {
        var value = self, result = Decimal()
        NSDecimalRound(&result, &value, 0, .plain)
        return result
    }
}

protocol SubscriptionBackend: Sendable {
    /// False for the preview: the sheet says that nothing will be charged.
    var live: Bool { get }
    func plans() async throws -> [Subscription.Plan]
    func buy(_ id: String) async throws -> Bool
    func restore() async throws -> Bool
}

/// The planned prices (월 $2.99 · 연 $19.99, 7-day trial) with no store behind them.
struct PreviewSubscriptions: SubscriptionBackend {
    var live: Bool { false }
    func plans() async throws -> [Subscription.Plan] {
        [.init(id: "si.onetop.remote.yearly", yearly: true, amount: Decimal(string: "19.99")!, currency: "USD", trialDays: 7),
         .init(id: "si.onetop.remote.monthly", yearly: false, amount: Decimal(string: "2.99")!, currency: "USD", trialDays: 7)]
    }
    func buy(_ id: String) async throws -> Bool {
        throw Relay.Failure(status: nil, message: L.t("Subscriptions open soon. Nothing was charged.", "구독은 곧 열립니다. 결제된 것은 없습니다."))
    }
    func restore() async throws -> Bool { false }
}
