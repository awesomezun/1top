import AuthenticationServices
import SwiftUI

/// Over the demo, above the tab bar: the examples are examples, and 내 컴퓨터 연결 leads to the live view, through
/// sign-in and the subscription when they are still needed (paywall B, docs/design/subscription/paywall-options_v1.0.0).
struct DemoConnectBar: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var signingIn = false

    var body: some View {
        HStack(spacing: 10) {
            Label(L.t("Example data", "예시 데이터"), systemImage: "circle.fill")
                .labelStyle(DotLabel()).font(.footnote).foregroundStyle(.orange)
            Spacer(minLength: 4)
            Button {
                Task {
                    if model.token == nil {
                        signingIn = true; defer { signingIn = false }
                        await signIn(model, webAuthenticationSession)
                    } else {
                        await model.connectFromDemo()
                    }
                }
            } label: {
                Text(signingIn || model.busy ? L.t("Connecting…", "연결하는 중…") : L.t("＋ Connect my computer", "＋ 내 컴퓨터 연결"))
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Color.segmentOn)
            }
            .disabled(signingIn || model.busy)
            .accessibilityIdentifier("demo-connect")
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 16).padding(.bottom, 6)
    }
}

private struct DotLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) { configuration.icon.font(.system(size: 7)); configuration.title }
    }
}

/// Signs this iPhone in to the 1top account through 1top.si; the welcome screen and the demo's bar share it.
@MainActor func signIn(_ model: AppModel, _ session: WebAuthenticationSession) async {
    let request = Relay.signInRequest(relay: model.relay)
    do {
        let callback = try await session.authenticate(using: request.url, callbackURLScheme: Relay.callbackScheme)
        await model.finishSignIn(callback: callback, token: request.token, state: request.state)
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
        model.message = L.t("Sign-in was cancelled.", "로그인을 취소했습니다.")
    } catch {
        model.message = error.localizedDescription
    }
}

/// Paywall B: a sheet over the demo, which stays where it was when the sheet closes. The store supplies the prices and
/// the trial; Apple's review asks for the price and period, the renewal terms, restore, the terms of use and privacy.
struct PaywallSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var store = Subscription()
    @State private var waiting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                Text(L.t("Subscribe to connect your computer", "내 컴퓨터를 연결하려면 구독이 필요해요"))
                    .font(.title3.bold()).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                // Closing goes back to the demo where it was.
                Button { model.paywallOpen = false } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                .accessibilityLabel(L.t("Close", "닫기")).accessibilityIdentifier("paywall-close")
            }
            Label(L.t("You are looking at example data", "지금은 예시 데이터를 보고 있어요"), systemImage: "lock.fill")
                .font(.footnote).foregroundStyle(.orange)
            VStack(spacing: 8) {
                if store.plans.isEmpty {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 120)
                }
                ForEach(store.plans) { plan in planRow(plan) }
            }
            Button { Task { await subscribe() } } label: {
                VStack(spacing: 2) {
                    Text(waiting ? L.t("Connecting your computer…", "내 컴퓨터를 연결하는 중…") : ctaTitle).font(.headline)
                    if let detail = ctaDetail { Text(detail).font(.caption).opacity(0.75) }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.glassProminent).tint(Color.segmentOn).foregroundStyle(.black)
            .disabled(store.plan == nil || store.phase != .idle || waiting)
            .accessibilityIdentifier("paywall-subscribe")
            if let note = store.note {
                Text(note).font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity).multilineTextAlignment(.center)
            }
            HStack(spacing: 16) {
                Button(L.t("Restore purchases", "구매 복원")) { Task { if await store.restore() { await connectAfterPurchase() } } }
                    .disabled(store.phase != .idle || waiting)
                Button(L.t("Terms of use", "이용약관")) { openURL(URL(string: "https://1top.si/terms")!) }
                Button(L.t("Privacy", "개인정보 처리방침")) { openURL(URL(string: "https://1top.si/privacy")!) }
            }
            .font(.footnote).foregroundStyle(.secondary).buttonStyle(.plain).frame(maxWidth: .infinity)
            Text(L.t("Unless cancelled, the trial turns into a paid subscription, and the subscription renews each period. Cancel any time in your Apple ID settings, at least 24 hours before the period ends.",
                     "취소하지 않으면 체험이 끝난 뒤 자동으로 결제되고, 구독은 기간마다 자동 갱신됩니다. 기간이 끝나기 24시간 전까지 Apple ID 설정에서 언제든 해지할 수 있습니다."))
                .font(.caption2).foregroundStyle(.tertiary).multilineTextAlignment(.center).frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 20).padding(.top, 22).padding(.bottom, 12)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task { await store.load() }
    }

    private func planRow(_ plan: Subscription.Plan) -> some View {
        let on = store.plan == plan
        return Button { store.chosen = plan.id } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(on ? Color.segmentOn : .secondary).font(.title3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(plan.yearly ? L.t("Yearly", "연간") : L.t("Monthly", "월간")).font(.body.weight(.semibold))
                    if plan.yearly { Text(L.t("\(store.perMonth(plan)) a month", "월 \(store.perMonth(plan))꼴")).font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 1) {
                    Text(store.price(plan)).font(.body.bold()).monospacedDigit()
                    Text(plan.yearly ? L.t("/year", "/년") : L.t("/month", "/월")).font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14).fill(on ? Color.segmentOn.opacity(0.08) : Color.secondary.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(on ? Color.segmentOn : Color.secondary.opacity(0.3), lineWidth: 1.5))
            .overlay(alignment: .topLeading) {
                if plan.yearly, let saving = store.saving {
                    Text(L.t("Save \(saving)%", "\(saving)% 절약")).font(.caption2.bold()).foregroundStyle(.black)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(Capsule().fill(Color.segmentOn)).offset(x: 12, y: -9)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var ctaTitle: String {
        guard let plan = store.plan else { return L.t("Subscribe", "구독하기") }
        return plan.trialDays.map { L.t("Start \($0)-day free trial", "\($0)일 무료로 시작") } ?? L.t("Subscribe", "구독하기")
    }
    private var ctaDetail: String? {
        guard let plan = store.plan else { return nil }
        let price = store.price(plan)
        let then = plan.yearly ? L.t("then \(price) a year", "체험 후 연 \(price)") : L.t("then \(price) a month", "체험 후 월 \(price)")
        let plain = plan.yearly ? L.t("\(price) a year", "연 \(price)") : L.t("\(price) a month", "월 \(price)")
        return (plan.trialDays == nil ? plain : then) + L.t(" · cancel any time", " · 언제든 취소")
    }

    private func subscribe() async {
        if await store.buy() { await connectAfterPurchase() }
    }
    private func connectAfterPurchase() async {
        waiting = true; defer { waiting = false }
        if !(await model.awaitAccess()) {
            store.note = L.t("The subscription is active; your computer will connect in a moment.", "구독이 시작됐습니다. 잠시 뒤 내 컴퓨터가 연결됩니다.")
        }
    }
}
