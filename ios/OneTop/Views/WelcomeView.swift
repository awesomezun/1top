import AuthenticationServices
import SwiftUI

/// First screen: connect this iPhone to the 1top account that the computers report to.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var busy = false
    @State private var serverOpen = false

    var body: some View {
        @Bindable var model = model
        ScrollView {
            VStack(spacing: 28) {
                Image(systemName: "waveform.path").font(.system(size: 56, weight: .semibold)).foregroundStyle(Color.mint1top).padding(.top, 60)
                VStack(spacing: 8) {
                    Text("1top").font(.largeTitle.bold())
                    Text(L.t("See the AI sessions running on your computers,\ntheir tokens and your plan limits on iPhone.",
                             "컴퓨터에서 돌고 있는 AI 세션과\n토큰 사용량, 계정 한도를 iPhone에서 확인합니다."))
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                VStack(spacing: 12) {
                    Button { Task { await signIn() } } label: {
                        Label(busy ? L.t("Connecting…", "연결하는 중…") : L.t("Connect with your 1top account", "1top 계정으로 연결"), systemImage: "person.crop.circle.badge.checkmark")
                            .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.glassProminent).disabled(busy)
                    Button(L.t("Explore the demo", "체험 화면 보기")) { model.showDemo() }
                        .buttonStyle(.glass)
                    if let message = model.message {
                        Text(message).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                    }
                    Text(L.t("Remote access is available to approved accounts. Install 1top on your computer to collect local activity.",
                             "원격 연결은 승인된 계정에서 이용할 수 있습니다. 컴퓨터의 활동을 수집하려면 컴퓨터에 1top을 설치하세요."))
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(.horizontal, 24)

                VStack(spacing: 14) {
                    Button { serverOpen = true } label: {
                        Label(L.t("Connection server · ", "연결 서버 · ") + Relay.label(model.relay), systemImage: "server.rack").font(.footnote)
                    }
                    Link(L.t("Desktop downloads ↗", "데스크톱 다운로드 ↗"), destination: URL(string: "https://1top.si/#download")!).font(.footnote)
                    Picker(L.t("Language", "언어"), selection: $model.language) { ForEach(Language.allCases) { Text($0.name).tag($0) } }
                        .pickerStyle(.segmented).frame(width: 200)
                    Text(L.t("Sign-in stays in this iPhone's keychain only.", "로그인 정보는 이 iPhone의 키체인에만 저장됩니다."))
                        .font(.caption).foregroundStyle(.tertiary)
                }
                .padding(.bottom, 24)
            }
            .frame(maxWidth: .infinity)
            .padding()
        }
        .sheet(isPresented: $serverOpen) {
            NavigationStack {
                List { RelaySettings() }
                    .navigationTitle(L.t("Connection server", "연결 서버")).navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { serverOpen = false } } }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func signIn() async {
        busy = true; defer { busy = false }
        let request = Relay.signInRequest(relay: model.relay)
        do {
            let callback = try await webAuthenticationSession.authenticate(using: request.url, callbackURLScheme: Relay.callbackScheme)
            await model.finishSignIn(callback: callback, token: request.token, state: request.state)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            model.message = L.t("Sign-in was cancelled.", "로그인을 취소했습니다.")
        } catch {
            model.message = error.localizedDescription
        }
    }
}
