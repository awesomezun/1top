import SwiftUI

/// A control the person picked; it runs only after the confirmation below.
struct ControlRequest: Identifiable {
    let id = UUID()
    var session: Session
    var action: String
    var instruction: String?
}

extension View {
    /// Every control asks first, as on the web and the Android app: what runs, where, and what it costs.
    func controlConfirmation(_ request: Binding<ControlRequest?>) -> some View { modifier(ControlConfirmation(request: request)) }
}

private struct ControlConfirmation: ViewModifier {
    @Environment(AppModel.self) private var model
    @Binding var request: ControlRequest?

    func body(content: Content) -> some View {
        content.confirmationDialog(request.map { AppModel.actionLabel($0.action) } ?? "",
                                   isPresented: Binding(get: { request != nil }, set: { if !$0 { request = nil } }),
                                   titleVisibility: .visible, presenting: request) { r in
            Button(AppModel.actionLabel(r.action), role: r.action == "terminate" ? .destructive : nil) {
                Task { await model.control(r.session, action: r.action, instruction: r.instruction) }
            }
            .accessibilityIdentifier("confirm-action")
            Button(L.t("Cancel", "취소"), role: .cancel) {}
                .accessibilityIdentifier("confirm-cancel")
        } message: { r in
            Text(describe(r))
        }
    }

    private func describe(_ r: ControlRequest) -> String {
        let s = r.session
        let place = [model.device(for: s)?.name, s.app, s.terminal].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        let head = place + "\n" + (s.displayProject ?? s.name)
        switch r.action {
        case "prompt":
            let text = r.instruction ?? "", preview = text.count > 300 ? String(text.prefix(300)) + "…" : text
            return head + "\n\n" + preview + "\n\n" + L.t("Sends a new instruction to this AI session. It may use tokens.", "이 AI 세션에 새 지시를 보내며 토큰을 사용할 수 있습니다.")
        case "terminate":
            return head + "\n" + L.t("This ends the CLI process. Unsaved work may be lost.", "CLI 프로세스를 종료합니다. 저장하지 않은 작업은 유실될 수 있습니다.")
        default:
            return head + "\n" + L.t("Runs on the selected computer.", "선택한 컴퓨터에서 실행됩니다.")
        }
    }
}

/// The long-press menu on a session row: open its detail, or one of the controls it reports.
struct SessionActions: View {
    @Environment(AppModel.self) private var model
    var session: Session
    var open: () -> Void
    @Binding var request: ControlRequest?

    var body: some View {
        Button(model.isControlOff(session) ? L.t("Session details", "세션 정보 열기") : L.t("Messages and controls", "메시지·제어 열기"),
               systemImage: "bubble.left.and.text.bubble.right", action: open)
        let available = model.canControl(session) && model.pending[session.key] == nil
        ForEach(SessionDetail.controls.filter(session.can), id: \.self) { action in
            Button(AppModel.actionLabel(action), systemImage: SessionDetail.icon(action), role: action == "terminate" ? .destructive : nil) {
                request = ControlRequest(session: session, action: action)
            }
            .disabled(!available)
        }
    }
}

/// One session: its mailbox and its controls. The sheet follows the live report for the same session.
struct SessionDetail: View {
    enum Pane: Hashable { case messages, controls }
    static let controls = ["focus", "pause", "resume", "terminate"]
    static func icon(_ action: String) -> String {
        ["focus": "macwindow.and.cursorarrow", "pause": "pause.circle", "resume": "play.circle", "terminate": "xmark.octagon"][action] ?? "circle"
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var session: Session
    @State private var pane: Pane
    @State private var instruction = ""
    @State private var request: ControlRequest?

    init(session: Session, pane: Pane? = nil) {
        self.session = session
        _pane = State(initialValue: pane ?? (session.can("mailbox") || session.can("message") ? .messages : .controls))
    }

    private var current: Session { model.allSessions.first { $0.key == session.key } ?? session }
    /// Present in the latest report, from a computer that reported in the last 20 seconds.
    private var available: Bool { model.allSessions.contains { $0.key == session.key } && model.canControl(current) }

    var body: some View {
        let remoteOff = model.isControlOff(current)
        NavigationStack {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 10) {
                    Text(place).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
                    if !remoteOff {
                        Picker("", selection: $pane) {
                            Text(L.t("Messages", "메시지함")).tag(Pane.messages)
                            Text(L.t("Controls", "작업 제어")).tag(Pane.controls)
                        }
                        .pickerStyle(.segmented)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 8)
                // A computer paired without remote control shows the session's usage only.
                switch remoteOff ? .controls : pane {
                case .messages: MailboxView(session: current)
                case .controls: controlList
                }
            }
            .navigationTitle(current.displayProject ?? current.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() } } }
        }
        .controlConfirmation($request)
        .presentationDragIndicator(.visible)
        #if DEBUG
        .onAppear {
            if let action = UserDefaults.standard.string(forKey: "screenConfirm"), current.can(action) {
                request = ControlRequest(session: current, action: action, instruction: action == "prompt" ? "이어서 테스트하고 오류 고쳐줘" : nil)
            }
        }
        #endif
    }

    private var place: String {
        [model.device(for: current)?.name, current.app, current.terminal, Tool.name(current.kind), Tool.model(current.model)]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private var controlList: some View {
        let s = current, busy = model.pending[s.key] != nil, remoteOff = model.isControlOff(s)
        return List {
            Section {
                LabeledContent(L.t("Reported total", "보고된 누적 토큰"), value: Format.tokens(s.total))
                LabeledContent(L.t("Last \(model.period.label)", "최근 \(model.period.label)"), value: Format.tokens(s.tokens(in: model.period)))
                LabeledContent(L.t("Current pace", "지금 속도"), value: Format.perHour(s.rate))
                LabeledContent(L.t("State", "상태"), value: Format.status(s.status))
            } footer: {
                Text(L.t("Reported tokens include cache.", "보고된 토큰 · 캐시 포함"))
            }

            if remoteOff {
                Section {
                    Label(L.t("This computer was connected without remote control.", "이 컴퓨터는 원격 제어 없이 연결되었습니다."), systemImage: "lock")
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("control-off")
                }
            } else {
                Section {
                    let actions = Self.controls.filter(s.can)
                    ForEach(actions, id: \.self) { action in
                        Button(role: action == "terminate" ? .destructive : nil) {
                            request = ControlRequest(session: s, action: action)
                        } label: {
                            Label(AppModel.actionLabel(action), systemImage: Self.icon(action))
                        }
                        .disabled(!available || busy)
                        .accessibilityIdentifier("control-" + action)
                    }
                    if actions.isEmpty {
                        Text(L.t("No controls reported for this session.", "이 세션에서 사용 가능한 제어가 없습니다.")).foregroundStyle(.secondary)
                    }
                } header: {
                    Text(L.t("Session controls", "세션 제어"))
                } footer: {
                    if !available { Text(L.t("Controls require a fresh report from this computer.", "이 컴퓨터의 최신 정보가 있어야 제어할 수 있습니다.")) }
                }

                Section {
                    TextField(L.t("Continue testing and fix the errors.", "이어서 테스트하고 오류 고쳐줘"), text: $instruction, axis: .vertical)
                        .lineLimit(4...10)
                        .onChange(of: instruction) { _, value in if value.utf16.count > 4000 { instruction = String(value.utf16.prefix(4000)) ?? value } }
                        .accessibilityLabel(L.t("AI instruction", "AI 지시 내용"))
                        .accessibilityIdentifier("instruction")
                    Button {
                        request = ControlRequest(session: s, action: "prompt", instruction: instruction)
                    } label: {
                        Label(L.t("Send instruction", "지시 보내기"), systemImage: "paperplane")
                    }
                    .accessibilityIdentifier("instruction-send")
                    .disabled(!available || !s.can("prompt") || busy || instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } header: {
                    Text(L.t("Tell this AI what to do", "이 AI에게 지시하기"))
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(instruction.utf16.count)/4,000 · " + L.t("A new instruction can use tokens.", "새 지시는 토큰을 사용할 수 있습니다."))
                        if !s.can("prompt") {
                            Text(L.t("Input is unavailable for this session right now. For a running terminal, pause the work first.",
                                     "현재 이 세션의 입력 연결을 확인할 수 없습니다. 실행 중인 터미널은 먼저 작업을 중단한 뒤 확인하세요."))
                        }
                        if s.kind == "Aside" && s.status == "working" {
                            Text(L.t("Queued after the current step.", "현재 단계가 끝난 뒤 이어서 실행합니다."))
                        }
                    }
                }
            }

            if let note = model.notes[s.key] {
                Section {
                    HStack(spacing: 8) {
                        if !note.final { ProgressView() }
                        Text(note.text).font(.callout)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("control-note")
                } header: { Text(L.t("Result", "결과")) }
            }

            if let device = model.device(for: s) {
                Section {
                    LabeledContent(L.t("Received", "수신 시각"), value: L.time(device.receivedDate))
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

/// Messages to one session and its replies. The full work conversation stays on the computer;
/// the relay carries the latest ten when asked.
struct MailboxView: View {
    @Environment(AppModel.self) private var model
    var session: Session
    @State private var draft = ""
    @State private var sending = false
    @State private var failure: String?

    private func label(_ status: String) -> String {
        switch status {
        case "sending": L.t("Sending", "전송 중")
        case "queued": L.t("Waiting for this session to finish its current turn", "현재 작업이 끝나면 전달")
        case "awaiting_reply": L.t("Waiting for a reply", "답신 대기")
        case "replied": L.t("Replied", "답신 도착")
        case "delivery_unconfirmed": L.t("Delivery unconfirmed — check the session before resending", "전달 미확인 · 재전송 전에 세션 확인")
        case "source_changed": L.t("Reply source changed", "답신 연결 변경됨")
        case "not_delivered": L.t("Not delivered — the session changed or the wait expired", "미전달 · 세션 변경 또는 대기 만료")
        default: status
        }
    }

    var body: some View {
        let box = model.mailboxes[session.key] ?? AppModel.Mailbox()
        let readable = session.can("mailbox"), live = model.connection == .live
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L.t("Messages to this session and its replies. Your full work conversation stays on the computer.",
                         "이 세션에게 보낸 메시지와 답신입니다. 전체 작업 대화는 컴퓨터에 남습니다."))
                    .font(.footnote).foregroundStyle(.secondary)
                if !readable {
                    Text(L.t("A message connection is not available for this session yet.", "현재 이 세션의 메시지 연결을 확인할 수 없습니다."))
                        .font(.footnote).foregroundStyle(.orange)
                }
                if box.messages.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L.t("Ask this session", "이 세션에 물어보세요")).font(.title3.weight(.semibold))
                        Text(L.t("“How far along are you?”", "“지금 어디까지 진행됐어?”")).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 20)
                }
                ForEach(box.messages) { m in
                    VStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(m.text).textSelection(.enabled)
                            Text(label(m.status)).font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("mail-status")
                        }
                        .padding(12)
                        .background(Color.mint1top.opacity(0.18), in: RoundedRectangle(cornerRadius: 16))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.leading, 32)
                        if let reply = m.reply, !reply.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(L.t("Session reply", "세션의 답신")).font(.caption.weight(.semibold)).foregroundStyle(Color.mint1top)
                                Text(reply).textSelection(.enabled).accessibilityIdentifier("mail-reply")
                                if m.truncated == true {
                                    Text(L.t("Long reply shortened.", "긴 답신의 일부를 표시합니다.")).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            .padding(12)
                            .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 16))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.trailing, 32)
                        }
                    }
                }
                if let error = failure ?? box.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(16)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { composer }
        .task(id: session.key + (live ? "|live" : "")) {
            guard readable, live else { return }
            while !Task.isCancelled {
                model.readMailbox(session)
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    private var composer: some View {
        let ready = model.canControl(session) && session.can("message") && !sending
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(L.t("Write a message…", "메시지를 입력하세요…"), text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20))
                    .onChange(of: draft) { _, value in if value.utf16.count > 4000 { draft = String(value.utf16.prefix(4000)) ?? value } }
                    .accessibilityLabel(L.t("Message to session", "세션에 보낼 메시지"))
                    .accessibilityIdentifier("mail-draft")
                Button { send() } label: {
                    Image(systemName: sending ? "ellipsis" : "arrow.up").font(.body.weight(.semibold)).frame(width: 30, height: 30)
                }
                .buttonStyle(.glassProminent).buttonBorderShape(.circle)
                .disabled(!ready)
                .accessibilityLabel(L.t("Send message", "메시지 보내기"))
                .accessibilityIdentifier("mail-send")
            }
            Text(L.t("A busy session may reply later. Sending can use AI tokens.", "작업 중인 세션은 답신이 늦을 수 있습니다. 메시지 전송은 AI 토큰을 사용할 수 있습니다."))
                .font(.caption2).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 6)
    }

    private func send() {
        let text = draft
        sending = true; failure = nil
        Task {
            do { try await model.sendMessage(session, text: text); draft = "" }
            catch {
                failure = error.localizedDescription + " " + L.t("If delivery is uncertain, check the session before sending again.", "전달이 불확실하면 재전송 전에 세션을 확인하세요.")
            }
            sending = false
        }
    }
}

/// Every computer together, or one of them.
struct ComputerPicker: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        Picker(L.t("Computer", "컴퓨터"), selection: Binding(get: { model.selectedDeviceID ?? "" }, set: { model.selectedDeviceID = $0.isEmpty ? nil : $0 })) {
            Text(L.t("All computers", "모든 컴퓨터") + " · \(model.devices.count)").tag("")
            ForEach(model.devices) { d in
                Text(d.name + (model.isFresh(d) ? "" : L.t(" · offline", " · 오프라인"))).tag(d.id)
            }
        }
    }
}

/// When the live connection is down: why, when the last report came in, and a way to retry.
/// Otherwise the latest notice, dismissed with a tap.
struct ConnectionNotice: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        switch model.connection {
        case .offline, .connecting, .restricted, .signedOut:
            VStack(alignment: .leading, spacing: 8) {
                Text(model.message ?? (model.connection == .connecting ? L.t("Connecting to your computers.", "컴퓨터에 연결하고 있습니다.")
                                       : L.t("Waiting for a connection. Previous reports stay visible with their timestamp.", "연결을 기다립니다. 이전 정보는 수신 시각과 함께 표시됩니다.")))
                    .font(.footnote).foregroundStyle(.secondary)
                if let last = model.devices.map(\.received).max(), last > 0 {
                    Text(L.t("Last report ", "마지막 보고 ") + L.time(Date(timeIntervalSince1970: last / 1000))).font(.caption).foregroundStyle(.secondary)
                }
                if model.connection == .signedOut {
                    Button(L.t("Sign in again", "다시 로그인")) { model.devices = [] }.buttonStyle(.glass)
                } else if model.connection != .connecting {
                    Button(L.t("Reconnect", "다시 연결")) { model.connect() }.buttonStyle(.glass)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        case .live, .demo:
            if let message = model.message {
                Button { model.message = nil } label: {
                    Text(message).font(.footnote).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12).background(Color.mint1top.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
                .accessibilityHint(L.t("Dismiss", "닫기"))
            }
        }
    }
}
