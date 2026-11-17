import XCTest
@testable import OneTop

/// Paywall B's words and the relay answer that opens it (docs/design/subscription/subscription-plan_v1.0.0.md).
@MainActor
final class SubscriptionTests: XCTestCase {
    func testPlannedPricesReadAsTheSheetShowsThem() async {
        let store = Subscription(backend: PreviewSubscriptions())
        await store.load()
        XCTAssertEqual(store.plans.map(\.yearly), [true, false], "the yearly plan comes first")
        XCTAssertEqual(store.plan?.yearly, true, "the yearly plan is chosen first")
        XCTAssertEqual(store.saving, 44)
        let yearly = try! XCTUnwrap(store.yearly)
        XCTAssertTrue(store.perMonth(yearly).contains("1.67"), store.perMonth(yearly))
        XCTAssertTrue(store.price(yearly).contains("19.99"))
        XCTAssertEqual(yearly.trialDays, 7)
    }

    func testThePreviewChargesNothing() async {
        let store = Subscription(backend: PreviewSubscriptions())
        await store.load()
        let bought = await store.buy()
        XCTAssertFalse(bought)
        XCTAssertNotNil(store.note)
        XCTAssertEqual(store.phase, .idle)
    }

    func testOnlyTheAccessCodeOpensTheSubscription() {
        XCTAssertTrue(Relay.Failure(status: 403, message: "", code: "hosted_access_required").needsSubscription)
        XCTAssertTrue(Relay.Failure(status: 403, message: "", code: "subscription_required").needsSubscription)
        XCTAssertFalse(Relay.Failure(status: 403, message: "").needsSubscription, "another refusal stays 권한 필요")
        XCTAssertFalse(Relay.Failure(status: 401, message: "", code: "hosted_access_required").needsSubscription)
    }

    func testTheDemoCanAskForThePaywallOnLaunch() {
        let model = AppModel(restoring: false)
        model.showDemo()
        XCTAssertEqual(model.connection, .demo)
        XCTAssertFalse(model.paywallOpen, "the demo alone never opens the subscription")
        XCTAssertFalse(model.needsSubscription)
    }
}
