import AuthenticationServices
import SwiftUI

/// First screen: connect this iPhone to the 1top account that the computers report to.
struct WelcomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession
    @State private var busy = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "waveform.path").font(.system(size: 56, weight: .semibold)).foregroundStyle(Color.mint1top)
            VStack(spacing: 8) {
                Text("1top").font(.largeTitle.bold())
                Text("컴퓨터에서 돌고 있는 AI 세션과\n토큰 사용량, 계정 한도를 iPhone에서 확인합니다.")
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            Spacer()
            VStack(spacing: 12) {
                Button { Task { await signIn() } } label: {
                    Label(busy ? "연결하는 중…" : "1top 계정으로 연결", systemImage: "person.crop.circle.badge.checkmark")
                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.glassProminent).disabled(busy)
                Button("데모 보기") { model.showDemo() }
                    .buttonStyle(.glass)
                if let message = model.message {
                    Text(message).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 24)
            Text("로그인 정보는 이 iPhone의 키체인에만 저장됩니다.").font(.caption).foregroundStyle(.tertiary).padding(.bottom, 8)
        }
        .padding()
    }

    private func signIn() async {
        busy = true; defer { busy = false }
        let request = Relay.signInRequest()
        do {
            let callback = try await webAuthenticationSession.authenticate(using: request.url, callbackURLScheme: Relay.callbackScheme)
            await model.finishSignIn(callback: callback, token: request.token, state: request.state)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            model.message = "로그인을 취소했습니다."
        } catch {
            model.message = error.localizedDescription
        }
    }
}
