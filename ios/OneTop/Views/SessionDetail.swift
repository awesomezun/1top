import PhotosUI
import SwiftUI

/// A control the person picked; it runs only after the confirmation below. `composer` marks the
/// conversation's own send, which takes the session's draft (text and photos) as it is.
struct ControlRequest: Identifiable {
    let id = UUID()
    var session: Session
    var action: String
    var instruction: String?
    var photos = 0
    var composer = false
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
                if r.composer { Task { await model.sendConversation(r.session) } }
                else { Task { await model.control(r.session, action: r.action, instruction: r.instruction) } }
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
        case "prompt", "message":
            let text = r.instruction ?? "", preview = text.count > 300 ? String(text.prefix(300)) + "…" : text
            var lines = [head, "", preview]
            if r.photos > 0 { lines.append(L.t("Photos: \(r.photos)", "사진 \(r.photos)장")) }
            lines.append("")
            lines.append(r.action == "message"
                ? L.t("Sends a message to this AI session; its reply appears here. It may use tokens.", "이 AI 세션에 메시지를 보내며 답신이 이 화면에 표시됩니다. 토큰을 사용할 수 있습니다.")
                : L.t("Sends a new instruction to this AI session. It may use tokens.", "이 AI 세션에 새 지시를 보내며 토큰을 사용할 수 있습니다."))
            return lines.joined(separator: "\n")
        case "terminate":
            return head + "\n" + L.t("This ends the CLI process. Unsaved work may be lost.", "CLI 프로세스를 종료합니다. 저장하지 않은 작업은 유실될 수 있습니다.")
        default:
            return head + "\n" + L.t("Runs on the selected computer.", "선택한 컴퓨터에서 실행됩니다.")
        }
    }
}

/// The long-press menu on a session row: open its conversation, or one of the controls it reports.
struct SessionActions: View {
    @Environment(AppModel.self) private var model
    var session: Session
    var open: () -> Void
    @Binding var request: ControlRequest?

    var body: some View {
        Button(model.isControlOff(session) ? L.t("Session details", "세션 정보 열기") : L.t("Open conversation", "대화 열기"),
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

/// One session as one conversation: what it is doing now and its controls at the top, the messages
/// and replies in the middle, and one composer for text and photos at the bottom. The sheet follows
/// the live report for the same session.
struct SessionDetail: View {
    static let controls = ["focus", "pause", "resume", "terminate"]
    static func icon(_ action: String) -> String {
        ["focus": "macwindow.and.cursorarrow", "pause": "pause.circle", "resume": "play.circle", "terminate": "xmark.octagon"][action] ?? "circle"
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var session: Session
    @State private var request: ControlRequest?

    init(session: Session) { self.session = session }

    private var current: Session { model.allSessions.first { $0.key == session.key } ?? session }
    /// Present in the latest report, from a computer that reported in the last 20 seconds.
    private var available: Bool { model.allSessions.contains { $0.key == session.key } && model.canControl(current) }

    var body: some View {
        let s = current, remoteOff = model.isControlOff(s)
        NavigationStack {
            VStack(spacing: 0) {
                top(s, remoteOff: remoteOff)
                Divider()
                if remoteOff {
                    Spacer()
                } else {
                    ConversationTimeline(session: s)
                        .safeAreaInset(edge: .bottom) { Composer(session: s, request: $request) }
                }
            }
            .navigationTitle(s.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() } } }
        }
        .controlConfirmation($request)
        .presentationDragIndicator(.visible)
        #if DEBUG
        .onAppear {
            let defaults = UserDefaults.standard
            if let action = defaults.string(forKey: "screenConfirm"), current.can(action) {
                request = ControlRequest(session: current, action: action, instruction: action == "prompt" ? "이어서 테스트하고 오류 고쳐줘" : nil)
            }
            let count = defaults.integer(forKey: "qaDemoImages")
            if count > 0, (model.drafts[current.key]?.photos ?? []).isEmpty {
                model.drafts[current.key, default: Draft()].photos = PhotoPrep.demo(count)
            }
        }
        #endif
    }

    /// Stays above the conversation while typing: where the session runs, its work state, usage, the
    /// controls and the latest control result.
    private func top(_ s: Session, remoteOff: Bool) -> some View {
        let busy = model.pending[s.key] != nil, actions = Self.controls.filter(s.can)
        return VStack(alignment: .leading, spacing: 8) {
            Text(place(s)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            WorkState(session: s)
            Text([L.t("Total ", "누적 ") + Format.tokens(s.total), L.t("Last \(model.period.label)", "최근 \(model.period.label)") + " " + Format.tokens(s.tokens(in: model.period)),
                  Format.perHour(s.rate)].joined(separator: " · "))
                .font(.caption).monospacedDigit().foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.85)
            if remoteOff {
                Label(L.t("This computer was connected without remote control.", "이 컴퓨터는 원격 제어 없이 연결되었습니다."), systemImage: "lock")
                    .font(.footnote).foregroundStyle(.secondary)
                    .accessibilityIdentifier("control-off")
            } else if !actions.isEmpty {
                // The whole row changes together: labels, smaller labels, then icons alone.
                GlassEffectContainer(spacing: 6) {
                    ViewThatFits(in: .horizontal) {
                        controlRow(s, actions, busy: busy, font: .footnote, labels: true)
                        controlRow(s, actions, busy: busy, font: .caption, labels: true)
                        controlRow(s, actions, busy: busy, font: .footnote, labels: false)
                    }
                }
                if !available {
                    Text(L.t("Controls require a fresh report from this computer.", "이 컴퓨터의 최신 정보가 있어야 제어할 수 있습니다."))
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if let note = model.notes[s.key] {
                HStack(spacing: 6) {
                    if !note.final { ProgressView().controlSize(.small) }
                    Text(note.text).font(.footnote)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("control-note")
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func controlRow(_ s: Session, _ actions: [String], busy: Bool, font: Font, labels: Bool) -> some View {
        HStack(spacing: 6) {
            ForEach(actions, id: \.self) { action in
                Button(role: action == "terminate" ? .destructive : nil) {
                    request = ControlRequest(session: s, action: action)
                } label: {
                    Group {
                        if labels { Label(Self.shortLabel(action), systemImage: Self.icon(action)).lineLimit(1).fixedSize() }
                        else { Image(systemName: Self.icon(action)).frame(maxWidth: .infinity) }
                    }
                    .font(font.weight(.medium))
                }
                .buttonStyle(.glass).controlSize(.small)
                .tint(action == "terminate" ? .red : nil)
                .disabled(!available || busy)
                .accessibilityLabel(AppModel.actionLabel(action))
                .accessibilityIdentifier("control-" + action)
            }
        }
    }

    private static func shortLabel(_ action: String) -> String {
        switch action {
        case "focus": L.t("Open", "열기")
        case "pause": L.t("Pause", "일시정지")
        case "resume": L.t("Resume", "재개")
        case "terminate": L.t("Quit CLI", "CLI 종료")
        default: AppModel.actionLabel(action)
        }
    }

    private func place(_ s: Session) -> String {
        [model.device(for: s)?.name, s.app, s.terminal == s.name ? nil : s.terminal, model.toolName(s), Tool.model(s.model)]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// The session's work right now, from its live status and how fresh the computer's report is.
/// Separate from message delivery: a reply does not mean the work is done.
struct WorkState: View {
    @Environment(AppModel.self) private var model
    var session: Session

    var body: some View {
        let device = model.device(for: session), code = model.workState(session), text = AppModel.workLabel(code)
        HStack(spacing: 6) {
            StatusGlyph(status: code == "working" || code == "waiting" || code == "paused" ? code : "idle", size: 11)
            Text(text).font(.subheadline.weight(.semibold))
            if let device {
                Text(L.t("Last report ", "마지막 보고 ") + L.time(device.receivedDate)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("work-status")
        .accessibilityValue(code)
    }
}

/// Messages to the session and its replies. The full work conversation stays on the computer; the
/// relay carries the latest ten when asked. Delivery is shown per message, apart from the work state.
struct ConversationTimeline: View {
    @Environment(AppModel.self) private var model
    var session: Session

    static func delivery(_ status: String) -> (text: String, icon: String, color: Color) {
        switch status {
        case "queued": (L.t("Waiting for this session to finish its current turn", "현재 작업이 끝나면 전달"), "clock", .secondary)
        case "sending": (L.t("Sending", "전송 중"), "arrow.up.circle", .secondary)
        case "awaiting_reply": (L.t("Waiting for a reply", "답신 대기"), "ellipsis.bubble", .secondary)
        case "replied": (L.t("Replied", "답신 도착"), "checkmark.bubble", .secondary)
        case "delivery_unconfirmed": (L.t("Delivery unconfirmed — check the session before resending", "전달 미확인 · 재전송 전에 세션 확인"), "exclamationmark.triangle", .orange)
        case "source_changed": (L.t("Reply source changed", "답신 연결 변경됨"), "arrow.triangle.branch", .orange)
        case "not_delivered": (L.t("Not delivered — the session changed or the wait expired", "미전달 · 세션 변경 또는 대기 만료"), "xmark.circle", .red)
        case "send_failed": (L.t("Not sent — the relay refused it", "보내지 못함 · 릴레이가 거부했습니다"), "exclamationmark.circle", .red)
        default: (status, "questionmark.circle", .secondary)
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
                if !session.can("message") && session.can("prompt") {
                    Label(L.t("This session cannot send replies, so only the instruction is delivered.", "이 세션은 답신을 받을 수 없어 지시만 전달됩니다."),
                          systemImage: "arrow.up.message")
                        .font(.footnote).foregroundStyle(.orange)
                        .accessibilityIdentifier("prompt-only")
                } else if !readable && session.can("message") {
                    Text(L.t("A message connection is not available for this session yet.", "현재 이 세션의 메시지 연결을 확인할 수 없습니다."))
                        .font(.footnote).foregroundStyle(.orange)
                }
                if box.messages.isEmpty {
                    // A session without replies takes instructions, so the example is one.
                    let replies = session.can("message")
                    VStack(alignment: .leading, spacing: 8) {
                        Text(replies ? L.t("Ask this session", "이 세션에 물어보세요") : L.t("Tell this AI what to do", "이 AI에게 지시하기"))
                            .font(.title3.weight(.semibold))
                        Text(replies ? L.t("“How far along are you?”", "“지금 어디까지 진행됐어?”") : L.t("Continue testing and fix the errors.", "이어서 테스트하고 오류 고쳐줘"))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 20)
                }
                ForEach(box.messages) { m in bubble(m) }
                responseActivity(box.messages)
                if let error = box.error {
                    Text(error).font(.footnote).foregroundStyle(.red)
                }
            }
            .padding(16)
        }
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .task(id: session.key + (live ? "|live" : "")) {
            guard readable, live else { return }
            while !Task.isCancelled {
                model.readMailbox(session)
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    /// The typing indicator, only for a request the computer reports as being answered (its row's
    /// `activity`), the most recent one. Nothing for queued, sent or merely received requests, and
    /// nothing while the report is offline or stale: the top of the screen then says why.
    @ViewBuilder private func responseActivity(_ messages: [MailMessage]) -> some View {
        let code = model.workState(session)
        if code != "offline", code != "stale",
           let active = messages.filter({ $0.activity != nil }).max(by: { $0.created < $1.created }), let phase = active.activity?.phase {
            TypingIndicator(phase: phase)
        }
    }

    private func bubble(_ m: MailMessage) -> some View {
        let state = Self.delivery(m.status), previews = model.sentPhotos[m.id] ?? []
        return VStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 6) {
                if !previews.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(Array(previews.enumerated()), id: \.offset) { _, image in
                            Image(uiImage: image).resizable().scaledToFill().frame(width: 72, height: 72).clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(L.t("Photos: \(previews.count)", "사진 \(previews.count)장"))
                    .accessibilityIdentifier("mail-attachments")
                } else if let files = m.attachments, !files.isEmpty {
                    Label(L.t("Photos: \(files.count)", "사진 \(files.count)장") + " · " + files.compactMap(\.name).joined(separator: ", "), systemImage: "photo.on.rectangle")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        .accessibilityIdentifier("mail-attachments")
                }
                Text(m.text).textSelection(.enabled)
                Label(state.text, systemImage: state.icon)
                    .font(.caption).foregroundStyle(state.color)
                    .accessibilityIdentifier("mail-status")
                    .accessibilityValue(m.status)
                if model.failedSends[m.id] != nil {
                    // Refused while a new draft was being written: nothing is lost, it comes back on request.
                    Button(L.t("Bring back to the composer", "입력창으로 다시 가져오기"), systemImage: "arrow.uturn.down") {
                        model.bringBack(m.id, key: session.key)
                    }
                    .font(.caption.weight(.semibold)).buttonStyle(.glass).controlSize(.small)
                    .accessibilityIdentifier("bring-back")
                }
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
}

/// What the session is doing for the request, under the last message: three small dots that rise
/// and fade in turn, not a message bubble. Still with Reduce Motion. VoiceOver reads the words once,
/// not the animation.
struct TypingIndicator: View {
    var phase: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static func words(_ phase: String) -> String {
        switch phase {
        case "responding": L.t("Preparing a reply…", "응답 준비 중…")
        case "working": L.t("Working…", "작업 중…")
        default: L.t("Writing a reply…", "답변 작성 중…")
        }
    }

    var body: some View {
        let words = Self.words(phase)
        HStack(spacing: 8) {
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
                let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                HStack(spacing: 4) {
                    ForEach(0..<3, id: \.self) { i in
                        let lift = reduceMotion ? 0.5 : (sin(t * 5.5 - Double(i) * 0.75) + 1) / 2
                        Circle().fill(Color.secondary).frame(width: 6, height: 6)
                            .opacity(0.3 + 0.6 * lift).offset(y: -2.5 * lift)
                    }
                }
                .frame(height: 12)
            }
            Text(words).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.leading, 6).padding(.top, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(words)
        .accessibilityIdentifier("typing-indicator")
        .accessibilityValue(phase)
    }
}

/// One composer for questions and instructions: text, up to three photos when the session takes
/// them, and one send button. Sending asks for confirmation first.
struct Composer: View {
    @Environment(AppModel.self) private var model
    var session: Session
    @Binding var request: ControlRequest?
    @State private var picked: [PhotosPickerItem] = []
    @FocusState private var typing: Bool

    private var draft: Binding<Draft> {
        Binding(get: { model.drafts[session.key] ?? Draft() }, set: { model.drafts[session.key] = $0 })
    }

    var body: some View {
        let d = draft.wrappedValue, block = model.sendBlock(session), photosOK = session.can("message_images")
        // Messages can follow one another while earlier ones are still on their way; an instruction-only
        // session takes one control at a time.
        let busy = (model.sending[session.key] ?? 0) > 0 || model.pending[session.key] != nil
        let ready = model.canControl(session) && block == nil && !d.isEmpty && !(model.pending[session.key] != nil && !session.can("message"))
        VStack(alignment: .leading, spacing: 8) {
            if !d.photos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(d.photos.enumerated()), id: \.element.id) { i, photo in
                            Image(uiImage: photo.preview).resizable().scaledToFill().frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(alignment: .topTrailing) {
                                    Button { draft.wrappedValue.photos.removeAll { $0.id == photo.id } } label: {
                                        Image(systemName: "xmark.circle.fill").font(.system(size: 20))
                                            .symbolRenderingMode(.palette).foregroundStyle(.white, .black.opacity(0.55))
                                            .frame(width: 30, height: 30).contentShape(Circle())
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(L.t("Remove photo \(i + 1)", "사진 \(i + 1) 지우기"))
                                    .accessibilityIdentifier("photo-remove-\(i)")
                                }
                                .accessibilityElement(children: .contain)
                                .accessibilityIdentifier("photo-preview-\(i)")
                        }
                    }
                    .padding(.top, 2)
                }
            }
            if let error = d.error {
                Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("composer-error")
            } else if let block, !d.isEmpty {
                Text(block).font(.footnote).foregroundStyle(.orange).accessibilityIdentifier("composer-block")
            }
            HStack(alignment: .bottom, spacing: 8) {
                if photosOK {
                    PhotosPicker(selection: $picked, maxSelectionCount: max(1, PhotoPrep.maxPhotos - d.photos.count), matching: .images) {
                        Image(systemName: "photo.on.rectangle").font(.body.weight(.semibold)).frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle)
                    .disabled(d.photos.count >= PhotoPrep.maxPhotos)
                    .accessibilityLabel(L.t("Add photos", "사진 추가"))
                    .accessibilityIdentifier("photo-pick")
                }
                TextField(session.can("message") ? L.t("Write a message…", "메시지를 입력하세요…") : L.t("Write an instruction…", "지시를 입력하세요…"),
                          text: draft.text, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($typing)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 20))
                    .onChange(of: d.text) { _, value in
                        if value.utf16.count > 4000 { draft.wrappedValue.text = String(value.utf16.prefix(4000)) ?? value }
                        if draft.wrappedValue.error != nil { draft.wrappedValue.error = nil }
                    }
                    .accessibilityLabel(L.t("Message to session", "세션에 보낼 메시지"))
                    .accessibilityIdentifier("mail-draft")
                Button { confirm() } label: {
                    Image(systemName: "arrow.up").font(.body.weight(.semibold)).frame(width: 30, height: 30)
                        .overlay(alignment: .topTrailing) { if busy { Circle().fill(.white.opacity(0.9)).frame(width: 7, height: 7).offset(x: 3, y: -3) } }
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
        .background(.bar)
        .onChange(of: picked) { _, items in load(items) }
    }

    /// Prepares picked photos one by one; a photo that cannot be fitted is left out with the reason.
    private func load(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        picked = []
        let key = session.key
        Task {
            var reasons: [String] = []
            for item in items {
                guard (model.drafts[key]?.photos.count ?? 0) < PhotoPrep.maxPhotos else { break }
                do {
                    guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                    let photo = try PhotoPrep.prepare(data)
                    model.drafts[key, default: Draft()].photos.append(photo)
                } catch { reasons.append(error.localizedDescription) }
            }
            model.drafts[key, default: Draft()].error = reasons.isEmpty ? nil : reasons.joined(separator: "\n")
        }
    }

    private func confirm() {
        let d = draft.wrappedValue
        let text = d.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? AppModel.photoPrompt : d.text
        // Put the keyboard away first, or the confirmation opens behind it and cannot be tapped.
        typing = false
        let ask = ControlRequest(session: session, action: session.can("message") ? "message" : "prompt", instruction: text,
                                 photos: d.photos.count, composer: true)
        Task { @MainActor in try? await Task.sleep(for: .milliseconds(350)); request = ask }
    }
}

/// Every computer together, or one of them.
extension View {
    /// Debug builds name each detail sheet by the path that opened it (row, sessions, launch) and its
    /// session, so a UI test's accessibility record shows why a sheet is on screen.
    @ViewBuilder func detailSource(_ source: String, _ id: String) -> some View {
        #if DEBUG
        self.accessibilityElement(children: .contain).accessibilityIdentifier("detail-\(source)-\(id)")
        #else
        self
        #endif
    }
}

struct ComputerPicker: View {
    @Environment(AppModel.self) private var model
    // Buttons rather than a Picker, so each choice carries its own identifier (scope-all, scope-<id>).
    var body: some View {
        choice(L.t("All computers", "모든 컴퓨터") + " · \(model.devices.count)", id: nil, key: "scope-all")
        ForEach(model.devices) { d in
            choice(d.name + (model.isFresh(d) ? "" : L.t(" · offline", " · 오프라인")), id: d.id, key: "scope-" + d.id)
        }
    }
    private func choice(_ title: String, id: String?, key: String) -> some View {
        let on = model.selectedDeviceID == id
        return Button { model.selectedDeviceID = id } label: {
            if on { Label(title, systemImage: "checkmark") } else { Text(title) }
        }
        .accessibilityIdentifier(key)
        .accessibilityAddTraits(on ? .isSelected : [])
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
