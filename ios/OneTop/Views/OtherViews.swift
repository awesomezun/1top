import SwiftUI

/// Every session: working ones first, then the rest together, each by selected-period tokens.
/// Tap for the mailbox and controls; long-press or swipe for a control.
struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var detail: Session?
    @State private var request: ControlRequest?

    var body: some View {
        @Bindable var model = model
        let rows = model.orderedSessions.filter { s in
            query.isEmpty || [s.name, s.displayProject ?? "", s.model ?? "", Tool.name(s.kind), s.app ?? "", model.device(for: s)?.name ?? ""]
                .joined(separator: " ").localizedCaseInsensitiveContains(query)
        }
        let working = rows.filter(model.isWorking), rest = rows.filter { !model.isWorking($0) }
        NavigationStack {
            List {
                Section {
                    ConnectionNotice().listRowInsets(.init()).listRowBackground(Color.clear)
                    GlassSegments.periods($model.period)
                        .listRowBackground(Color.clear).listRowInsets(.init())
                    HStack(spacing: 28) {
                        stat("\(model.allSessions.count)", L.t("sessions", "세션"), .primary)
                        stat("\(model.allSessions.filter(model.isWorking).count)", L.t("working", "작업 중"), .primary, glyph: true)
                        Spacer()
                    }
                    .listRowBackground(Color.clear).listRowInsets(.init(top: 4, leading: 20, bottom: 4, trailing: 20))
                }
                if !working.isEmpty {
                    Section(L.t("Working \(working.count)", "작업 중 \(working.count)")) { ForEach(working, id: \.key) { row($0) } }
                }
                if !rest.isEmpty {
                    Section(L.t("Not working \(rest.count)", "작업 중 아님 \(rest.count)")) { ForEach(rest, id: \.key) { row($0) } }
                }
                if rows.isEmpty {
                    ContentUnavailableView(query.isEmpty ? L.t("No sessions yet", "아직 세션이 없습니다") : L.t("No results", "검색 결과 없음"), systemImage: "terminal",
                                           description: query.isEmpty ? Text(L.t("Connect a computer to your account. Its active sessions appear here.", "컴퓨터를 계정에 연결하면 활동 중인 세션이 표시됩니다.")) : nil)
                }
            }
            .searchable(text: $query, prompt: L.t("Session, project, model, computer", "세션, 프로젝트, 모델, 컴퓨터"))
            .navigationTitle(L.t("Sessions", "세션"))
            .toolbar {
                if model.devices.count > 1 {
                    ToolbarItem(placement: .topBarTrailing) { Menu { ComputerPicker() } label: { Label(model.scopeName, systemImage: "desktopcomputer") } }
                }
            }
            .refreshable { if model.connection != .demo { model.connect() } }
            .sheet(item: $detail) { SessionDetail(session: $0).detailSource("sessions", $0.id) }
            .controlConfirmation($request)
        }
    }

    private func stat(_ value: String, _ label: String, _ color: Color, glyph: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.title.weight(.semibold)).monospacedDigit().foregroundStyle(color)
            HStack(spacing: 5) {
                if glyph { StatusGlyph(status: "working") }
                Text(label).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private func row(_ s: Session) -> some View {
        let available = model.canControl(s) && model.pending[s.key] == nil
        Button { detail = s } label: { SessionRow(session: s, period: model.period).contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("session-" + s.id)
            .swipeActions(edge: .trailing) {
                if !model.isControlOff(s) {
                    Button { detail = s } label: { Label(L.t("Messages", "메시지함"), systemImage: "bubble.left") }.tint(.blue)
                }
                if s.can("terminate") {
                    Button { request = ControlRequest(session: s, action: "terminate") } label: { Label(AppModel.actionLabel("terminate"), systemImage: SessionDetail.icon("terminate")) }
                        .tint(.red).disabled(!available)
                }
            }
            .swipeActions(edge: .leading) {
                if s.can("pause") && s.status != "paused" {
                    Button { request = ControlRequest(session: s, action: "pause") } label: { Label(AppModel.actionLabel("pause"), systemImage: SessionDetail.icon("pause")) }
                        .tint(.orange).disabled(!available)
                }
                if s.can("resume") && s.status != "working" {
                    Button { request = ControlRequest(session: s, action: "resume") } label: { Label(AppModel.actionLabel("resume"), systemImage: SessionDetail.icon("resume")) }
                        .tint(.green).disabled(!available)
                }
            }
            .contextMenu { SessionActions(session: s, open: { detail = s }, request: $request) }
    }
}

/// Account limits: the weekly and five-hour windows as each provider reports them, with the
/// computer that reported them and when.
struct LimitsView: View {
    @Environment(AppModel.self) private var model

    private struct Entry: Identifiable { var quota: Quota; var computers: [String]; var fresh: Bool; var id: String { quota.id } }
    private var entries: [Entry] {
        var list: [Entry] = []
        for d in model.visibleDevices {
            for q in d.snapshot?.accountQuotas ?? [] {
                if let i = list.firstIndex(where: { $0.quota.id == q.id }) {
                    list[i].computers.append(d.name)
                    if (q.updated ?? 0) > (list[i].quota.updated ?? 0) { list[i].quota = q; list[i].fresh = model.isFresh(d) }
                } else { list.append(Entry(quota: q, computers: [d.name], fresh: model.isFresh(d))) }
            }
        }
        return list
    }

    var body: some View {
        NavigationStack {
            List {
                ConnectionNotice().listRowInsets(.init()).listRowBackground(Color.clear)
                let entries = entries
                if entries.isEmpty {
                    ContentUnavailableView(L.t("No account report yet", "계정 정보가 없습니다"), systemImage: "chart.bar.xaxis",
                                           description: Text(L.t("Sign in to your AI tools on the computer. Available limits will appear here.", "컴퓨터에서 AI 도구에 로그인하면 수집 가능한 한도가 표시됩니다.")))
                }
                ForEach(entries) { entry in
                    let quota = entry.quota
                    Section {
                        ForEach(Array(quota.windows.enumerated()), id: \.offset) { _, window in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(window.label == "주간" ? L.t("Weekly", "주간") : window.label).font(.subheadline)
                                    Spacer()
                                    Text(window.pct == nil ? L.t("Unknown", "미확인") : Format.percent(window.pct) + L.t(" used", " 사용")).font(.subheadline.weight(.semibold).monospacedDigit())
                                }
                                Meter(value: window.pct, color: (window.pct ?? 0) >= 85 ? .orange : Tool.color(quota.kind))
                                Text(Format.reset(window.reset)).font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    } header: {
                        HStack(spacing: 6) {
                            Circle().fill(Tool.color(quota.kind)).frame(width: 8, height: 8)
                            Text(Tool.name(quota.kind)); Text(quota.plan ?? "").foregroundStyle(.secondary)
                        }
                    } footer: {
                        // A value that could not be refreshed shows its age instead of a clock time.
                        let stale = quota.stale || !entry.fresh
                        Text([quota.accountLabel, entry.computers.joined(separator: ", "),
                              stale ? quota.staleLabel : quota.updated.map { L.t("Updated ", "업데이트 ") + L.time(Date(timeIntervalSince1970: $0)) }]
                            .compactMap { $0 }.joined(separator: " · "))
                    }
                }
                Section {} footer: {
                    Text(L.t("Add or switch AI accounts in the desktop app. Provider credentials stay on that computer.", "AI 계정 추가·전환은 데스크톱 앱에서 합니다. 제공업체 인증 정보는 해당 컴퓨터에 보관됩니다."))
                }
            }
            .navigationTitle(L.t("Account limits", "계정 한도"))
            .toolbar {
                if model.devices.count > 1 {
                    ToolbarItem(placement: .topBarTrailing) { Menu { ComputerPicker() } label: { Image(systemName: "desktopcomputer") } }
                }
            }
        }
    }
}

/// The connection server. It changes only while signed out, so a token never meets another relay.
struct RelaySettings: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var confirming = false

    var body: some View {
        let signedIn = model.token != nil
        Section {
            TextField("https://", text: $address)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                .disabled(signedIn || model.busy)
                .accessibilityLabel(L.t("Relay HTTPS address", "연결 서버 HTTPS 주소"))
            Button(L.t("Use this server", "이 서버 사용")) { confirming = true }
                .disabled(signedIn || model.busy || address.trimmingCharacters(in: .whitespaces).isEmpty || address == model.relay.absoluteString)
            if model.relay != Relay.managed && !signedIn {
                Button(L.t("Use the 1top managed server", "1top 관리형 서버 사용")) { address = Relay.managed.absoluteString; confirming = true }
            }
        } header: {
            Text(L.t("Connection server", "연결 서버"))
        } footer: {
            Text(L.t("Use your own trusted Cloudflare relay, or the 1top managed server. Sign out before changing it.",
                     "본인의 신뢰할 수 있는 Cloudflare 서버 또는 1top 관리형 서버를 사용합니다. 변경 전에 로그아웃하세요."))
        }
        .onAppear { address = model.relay.absoluteString }
        .onChange(of: model.relay) { _, value in address = value.absoluteString }
        .alert(L.t("Connect to this server?", "이 서버로 연결할까요?"), isPresented: $confirming) {
            Button(L.t("Cancel", "취소"), role: .cancel) {}
            Button(L.t("Use server", "사용")) {
                do { try model.changeRelay(address) } catch { model.message = error.localizedDescription }
            }
        } message: { Text(address) }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model

    private var version: String {
        let info = Bundle.main.infoDictionary
        return [info?["CFBundleShortVersionString"] as? String, (info?["CFBundleVersion"] as? String).map { "(\($0))" }].compactMap { $0 }.joined(separator: " ")
    }

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            List {
                Section(L.t("Connection", "연결")) {
                    LabeledContent(L.t("Status", "상태")) { ConnectionBadge() }
                    LabeledContent(L.t("Server", "서버"), value: Relay.label(model.relay))
                    if let message = model.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                    if model.connection != .demo && model.connection != .live && model.token != nil {
                        Button(L.t("Reconnect", "다시 연결")) { model.connect() }
                    }
                }
                Section {
                    Text(model.connection == .demo ? L.t("Demo workspace", "체험 워크스페이스")
                         : model.account?.role == "admin" ? L.t("Admin · Pro", "관리자 · Pro")
                         : [L.t("Connected account", "연결된 계정"), model.account?.plan?.capitalized].compactMap { $0 }.joined(separator: " · "))
                } header: { Text(L.t("Account", "계정")) } footer: {
                    Text(L.t("Remote access does not add AI credits. Usage is reported by your computer.", "원격 연결에 AI 사용 크레딧은 포함되지 않습니다. 사용량은 컴퓨터가 보고한 값입니다."))
                }
                Section(L.t("Computers", "컴퓨터")) {
                    computerRow(nil)
                    ForEach(model.devices) { computerRow($0) }
                }
                ForEach(model.visibleDevices) { device in
                    Section {
                        let host = device.snapshot?.host, ops = device.snapshot?.operations
                        Text([device.platform, "CPU " + Format.percent(host?.cpu),
                              host?.usedMemory.map { "RAM " + String(format: "%.1f GB", $0 / 1_073_741_824) }].compactMap { $0 }.joined(separator: " · "))
                            .font(.footnote).foregroundStyle(.secondary)
                        LabeledContent(L.t("Installed skills", "설치된 스킬"), value: ops?.installedSkills.map { String(Int($0)) } ?? "—")
                        LabeledContent(L.t("Observed events", "관측된 이벤트"), value: ops?.observedEvents.map { String(Int($0)) } ?? "—")
                        ForEach(Array((ops?.goals ?? []).enumerated()), id: \.offset) { _, goal in
                            LabeledContent([goal.runtime, goal.status].compactMap { $0 }.joined(separator: " · "),
                                           value: Format.tokens(goal.tokensUsed) + " tokens")
                        }
                    } header: {
                        Text(device.name + " · Goals · Loops · Skills")
                    } footer: {
                        Text(L.t("Loop activity is not yet verified. Installed skills do not mean they are running.", "Loop 실행 여부는 아직 검증하지 못했습니다. 설치된 스킬이 실행 중이라는 의미는 아닙니다."))
                    }
                }
                RelaySettings()
                // The same choices as the dashboard's theme and language menu, stored in the same place.
                Section(L.t("Theme and language", "테마와 언어")) {
                    Picker(L.t("Theme", "테마"), selection: $model.appearance) { ForEach(Appearance.allCases) { Text($0.label).tag($0) } }
                        .accessibilityIdentifier("settings-theme")
                    Picker(L.t("Language", "언어"), selection: $model.language) { ForEach(Language.allCases) { Text($0.name).tag($0) } }
                        .accessibilityIdentifier("settings-language")
                }
                Section {
                    Link(L.t("Get the desktop app ↗", "데스크톱 앱 다운로드 ↗"), destination: URL(string: "https://1top.si/#download")!)
                    Link(L.t("Privacy ↗", "개인정보 처리 ↗"), destination: URL(string: "https://1top.si/privacy")!)
                }
                Section {
                    if model.connection == .demo {
                        Button(L.t("Leave demo", "체험 종료")) { model.leaveDemo() }
                    } else {
                        Button(L.t("Sign out", "로그아웃"), role: .destructive) { Task { await model.signOut() } }.disabled(model.busy)
                    }
                } footer: {
                    Text("1top iPhone · " + version)
                }
            }
            .navigationTitle(L.t("Workspace", "워크스페이스"))
        }
    }

    private func computerRow(_ device: Device?) -> some View {
        Button { model.selectedDeviceID = device?.id } label: {
            HStack {
                if let device {
                    Circle().fill(model.isFresh(device) ? Color.mint1top : .orange).frame(width: 8, height: 8)
                    VStack(alignment: .leading) {
                        Text(device.name).foregroundStyle(.primary)
                        Text([device.platform, device.snapshot?.version.map { "v" + $0 },
                              model.isFresh(device) ? L.t("Online", "온라인") : L.t("Offline · last report ", "오프라인 · 마지막 보고 ") + L.time(device.receivedDate)]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    Image(systemName: "square.stack").foregroundStyle(Color.mint1top).frame(width: 8)
                    Text(L.t("All computers", "모든 컴퓨터") + " · \(model.devices.count)").foregroundStyle(.primary)
                }
                Spacer()
                if model.selectedDeviceID == device?.id { Image(systemName: "checkmark").foregroundStyle(Color.mint1top) }
            }
        }
        .accessibilityIdentifier("computer-" + (device?.id ?? "all"))
        .accessibilityAddTraits(model.selectedDeviceID == device?.id ? .isSelected : [])
    }
}
