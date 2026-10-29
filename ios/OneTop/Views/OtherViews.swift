import SwiftUI

/// Every session: working ones first, then the rest together, each by selected-period tokens.
struct SessionsView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        @Bindable var model = model
        let rows = model.orderedSessions.filter { query.isEmpty || [$0.name, $0.displayProject ?? "", $0.model ?? "", Tool.name($0.kind)].joined(separator: " ").localizedCaseInsensitiveContains(query) }
        NavigationStack {
            List {
                Section {
                    Picker("기간", selection: $model.period) { ForEach(Period.allCases) { Text($0.label).tag($0) } }
                        .pickerStyle(.segmented).listRowBackground(Color.clear).listRowInsets(.init())
                }
                let working = rows.filter(\.isWorking), rest = rows.filter { !$0.isWorking }
                if !working.isEmpty {
                    Section("작업 중 \(working.count)") { ForEach(working) { SessionRow(session: $0, period: model.period) } }
                }
                if !rest.isEmpty {
                    Section("작업 중 아님 \(rest.count)") { ForEach(rest) { SessionRow(session: $0, period: model.period) } }
                }
                if rows.isEmpty {
                    ContentUnavailableView(query.isEmpty ? "세션이 없습니다" : "검색 결과 없음", systemImage: "terminal")
                }
            }
            .searchable(text: $query, prompt: "세션, 프로젝트, 모델")
            .navigationTitle("세션")
        }
    }
}

/// Account limits: the weekly and five-hour windows as each provider reports them.
struct LimitsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        NavigationStack {
            List {
                if model.quotas.isEmpty {
                    ContentUnavailableView("연결된 계정 한도가 없습니다", systemImage: "chart.bar.xaxis",
                                           description: Text("컴퓨터의 1top에서 구독 계정을 연결하면 여기에 표시됩니다."))
                }
                ForEach(model.quotas) { quota in
                    Section {
                        ForEach(quota.windows, id: \.label) { window in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(window.label).font(.subheadline)
                                    Spacer()
                                    Text(window.pct == nil ? "미확인" : Format.percent(window.pct) + " 사용").font(.subheadline.weight(.semibold).monospacedDigit())
                                }
                                Meter(value: window.pct, color: (window.pct ?? 0) >= 90 ? .orange : Tool.color(quota.kind))
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
                        Text(quota.accountLabel + (quota.stale ? " · 마지막 보고" : ""))
                    }
                }
            }
            .navigationTitle("계정 한도")
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        NavigationStack {
            List {
                Section("연결") {
                    LabeledContent("상태") { ConnectionBadge() }
                    LabeledContent("릴레이", value: Relay.managed.host() ?? "")
                    if let message = model.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                }
                Section("컴퓨터") {
                    ForEach(model.devices) { device in
                        Button { model.selectedDeviceID = device.id } label: {
                            HStack {
                                Circle().fill(device.online ? Color.mint1top : .secondary).frame(width: 8, height: 8)
                                VStack(alignment: .leading) {
                                    Text(device.name).foregroundStyle(.primary)
                                    Text([device.platform, device.snapshot?.version.map { "v" + $0 }].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if device.id == model.device?.id { Image(systemName: "checkmark").foregroundStyle(Color.mint1top) }
                            }
                        }
                    }
                }
                Section {
                    if model.connection == .demo {
                        Button("데모 끝내기") { model.leaveDemo() }
                    } else {
                        Button("로그아웃", role: .destructive) { Task { await model.signOut() } }
                    }
                }
                Section {
                    LabeledContent("앱 버전", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                }
            }
            .navigationTitle("설정")
        }
    }
}
