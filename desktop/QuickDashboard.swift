import AppKit
import SwiftUI

private let panelBackground = Color(red: 0.055, green: 0.063, blue: 0.075)
private let panelAccent = Color(red: 0.43, green: 0.80, blue: 0.66)
struct QuickDashboard: View {
    static let panelSize = NSSize(width: 450, height: 720)
    @ObservedObject var model: DashboardModel
    @State private var hoveredSession: String?
    @AppStorage("weeklyTokensMode") private var tokensMode = false
    var openDashboard: () -> Void; var openBrowser: () -> Void
    var remoteOptions: () -> Void; var connectRemote: () -> Void
    var toggleLogin: () -> Void; var restart: () -> Void; var quit: () -> Void
    var control: (String, DesktopSession) -> Void
    var body: some View {
        VStack(spacing: 0) {
            header
            HStack(spacing: 4) {
                sectionTab("세션", accounts: false)
                sectionTab("계정 한도", accounts: true)
            }.padding(3).background(Color.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                .padding(.horizontal, 18).padding(.bottom, 8)
            Divider()
            if model.accounts { accountView } else { summary; CompactTokenMap(model: model); sessionList }
            if let message = model.message {
                HStack(alignment: .top) {
                    Text(message).font(.plex(size: 12)).foregroundStyle(model.messageIsError ? Color.orange : panelAccent)
                    Spacer(minLength: 4)
                    Button { model.message = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).accessibilityLabel("알림 닫기")
                }.padding(10).background(Color.white.opacity(0.04))
            }
            Divider()
            HStack(spacing: 12) {
                Button(action: openDashboard) {
                    HStack { Image(systemName: "rectangle.inset.filled"); Text("전체 대시보드"); Spacer(); Text("⌘O").foregroundStyle(.secondary) }
                        .font(.plex(size: 13, weight: .medium)).padding(.horizontal, 12).padding(.vertical, 8)
                        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
                }.buttonStyle(.plain).accessibilityLabel("전체 대시보드 열기")
                Button(action: openBrowser) { Image(systemName: "safari").font(.plex(size: 17)) }
                    .buttonStyle(.plain).help("브라우저에서 열기").accessibilityLabel("브라우저에서 열기")
            }.padding(.horizontal, 18).padding(.vertical, 10)
        }.frame(width: Self.panelSize.width, height: Self.panelSize.height)
            .background(panelBackground).preferredColorScheme(.dark).font(.plex(size: 13))
    }
    private func sectionTab(_ title: String, accounts: Bool) -> some View {
        Button { model.accounts = accounts } label: {
            Text(title).font(.plex(size: 13, weight: .medium)).frame(maxWidth: .infinity).padding(.vertical, 5)
                .foregroundStyle(model.accounts == accounts ? Color.primary : Color.secondary)
                .background(model.accounts == accounts ? Color.white.opacity(0.09) : .clear, in: RoundedRectangle(cornerRadius: 6))
        }.buttonStyle(.plain).accessibilityAddTraits(model.accounts == accounts ? .isSelected : [])
    }
    private var summary: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 4) {
                ForEach([("10m", "10분"), ("30m", "30분"), ("1h", "1시간"), ("5h", "5시간"), ("12h", "12시간"), ("24h", "24시간")], id: \.0) { key, title in
                    Button { model.selectedPeriod = key } label: {
                        Text(title).font(.plex(size: 12, weight: .medium)).frame(maxWidth: .infinity).padding(.vertical, 4)
                            .foregroundStyle(model.selectedPeriod == key ? panelAccent : Color.secondary)
                            .background(model.selectedPeriod == key ? panelAccent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 5))
                    }.buttonStyle(.plain).accessibilityLabel("최근 \(title)")
                        .accessibilityAddTraits(model.selectedPeriod == key ? .isSelected : [])
                }
            }.accessibilityElement(children: .contain).accessibilityLabel("사용량 기간")
            HStack {
                Text(tokensMode ? "기간 누적" : "주간 한도 · 계정별 100%").font(.plex(size: 12, weight: .medium)).foregroundStyle(.secondary)
                Spacer()
                Button(tokensMode ? "주간 한도 % 보기" : "토큰 보기") { tokensMode.toggle() }
                    .buttonStyle(.plain).font(.plex(size: 11)).foregroundStyle(panelAccent)
            }
            if !tokensMode { weeklyOverview } else {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(DesktopFormat.number(model.periodTokens)).font(.plex(size: 27, weight: .semibold)).monospacedDigit()
                        Text("tokens").font(.plex(size: 12)).foregroundStyle(.secondary)
                    }
                    Text(model.window?.partial == true ? "누적 사용량 · 일부 기록" : "누적 사용량 · 캐시 포함")
                        .font(.plex(size: 12)).foregroundStyle(.secondary).help(usageExplanation)
                }.frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text(DesktopFormat.number(model.rate)).font(.plex(size: 27, weight: .semibold)).monospacedDigit()
                        Text("tok/s").font(.plex(size: 12)).foregroundStyle(.secondary)
                        Image(systemName: "info.circle").font(.system(size: 11)).foregroundStyle(.secondary)
                            .help("최근 60초 평균 소비 속도\n" + usageExplanation)
                    }
                    usageTrend.frame(width: 164, height: 24)
                }
            }
            }
            HStack(spacing: 22) {
                resource("CPU", value: model.snapshot?.system?.host?.cpu)
                resource("메모리", value: model.snapshot?.system?.host?.memory?.percent)
            }
        }.padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 12)
    }
    private var weeklyOverview: some View {
        let rows = model.snapshot?.account_quotas ?? []
        return Group {
            if rows.isEmpty {
                Text("계정 한도에서 로그인 계정을 추가하세요.").font(.plex(size: 12)).foregroundStyle(.secondary)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                        ForEach(rows) { q in weeklyCard(q) }
                    }
                }.frame(height: rows.count > 2 ? 174 : 84)
            }
        }
    }
    private func weeklyCard(_ q: AccountQuota) -> some View {
        let w = q.windows.first { $0.label == "주간" }
        let p = model.snapshot?.weekly_usage?.accounts.first { $0.id == q.id }?.periods[model.selectedPeriod]
        let color = q.kind == "Codex" ? Color(red:0.56, green:0.67, blue:1) : panelAccent
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(q.kind == "Claude" ? "Claude Code" : q.kind).font(.plex(size: 12, weight: .semibold)).lineLimit(1)
                Text(q.plan ?? "").font(.plex(size: 10)).foregroundStyle(color).lineLimit(1)
                Spacer(minLength: 0)
                Text(DesktopFormat.quota(w?.pct)).font(.plex(size: 19, weight: .semibold)).monospacedDigit().fixedSize()
            }
            Text(q.account_label).font(.plex(size: 10)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            GeometryReader { geo in
                Capsule().fill(Color.white.opacity(0.08)).overlay(alignment: .leading) {
                    Capsule().fill(color.opacity(q.stale ? 0.4 : 0.8)).frame(width: geo.size.width * min(100,max(0,w?.pct ?? 0))/100)
                }
            }.frame(height: 3).padding(.vertical, 2)
            HStack(spacing: 4) {
                Text(p?.used_pp.map { "+" + DesktopFormat.quota($0).replacingOccurrences(of: "%", with: "%p") + (p?.partial == true ? " · 일부" : "") } ?? (q.stale ? "한도 조회 대기" : "다음 보고 대기"))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text(q.stale ? q.statusLabel : "남음 " + DesktopFormat.quota(w?.pct.map { max(0,100-$0) }))
                    .foregroundStyle(q.stale ? Color.orange : color)
            }.font(.plex(size: 10)).lineLimit(1)
        }.padding(8).frame(height: 82).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 7))
            .help("\(q.account_label)\n주간 한도 100% 중 사용 · \(q.note)\n선택 기간의 한도 증가량. 새 기록부터 계산하며 다른 계정과 합산하지 않습니다.")
    }
    private var weeklyExplanation: String {
        "계정의 주간 한도 증가량을 같은 구간의 세션 토큰 비중으로 배분한 추정입니다. 캐시·모델별 가중치 미반영 · 다른 기기의 사용이 섞일 수 있음 · 다른 계정끼리 합산하지 않음"
    }
    private var usageTrend: some View {
        let trend = DesktopUsageTrend(events: model.snapshot?.events, period: model.selectedPeriod, end: model.snapshot?.updated ?? model.now.timeIntervalSince1970)
        let peak = max(1, trend.bins.map(\.tokens).max() ?? 0)
        return Group {
            if trend.reported {
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(trend.bins) { bin in
                        RoundedRectangle(cornerRadius: 1).fill(panelAccent.opacity(bin.tokens > 0 ? 0.65 : 0.15))
                            .frame(maxWidth: .infinity).frame(height: max(1, CGFloat(bin.tokens / peak) * 22))
                            .help("\(Date(timeIntervalSince1970: bin.start).formatted(date: .omitted, time: .shortened))–\(Date(timeIntervalSince1970: bin.end).formatted(date: .omitted, time: .shortened))\n\(bin.tokens.formatted(.number.precision(.fractionLength(0)))) tokens · 캐시 포함")
                    }
                }.accessibilityElement(children: .ignore)
                    .accessibilityLabel("최근 \(model.window?.label ?? model.selectedPeriod) 전체 토큰 사용량 추이")
            } else {
                Text("추이 기록 미확인").font(.plex(size: 11)).foregroundStyle(.secondary)
            }
        }
    }
    private var usageExplanation: String {
        "누적: 선택 기간에 수집한 전체 사용량. 맵과 세션 목록: 현재 연결된 세션의 사용량.\n캐시 포함 · 청구 금액 아님 · \(model.knownCount)/\(model.sessions.count)개 세션 토큰 확인" +
            (model.window?.partial == true ? "\n일부 기간만 기록되었습니다." : "")
    }
    private var sessionList: some View {
        VStack(spacing: 0) {
            Divider()
            HStack {
                Text("세션").font(.plex(size: 13, weight: .semibold))
                Text("\(model.sessions.count)").font(.plex(size: 12)).foregroundStyle(.secondary); Spacer()
                Circle().fill(model.fresh ? panelAccent : Color.orange).frame(width: 5, height: 5)
                Text(model.fresh ? "작업 중 \(model.working)" : "마지막 기록")
                    .font(.plex(size: 12, weight: .medium)).foregroundStyle(model.fresh ? panelAccent : Color.orange)
            }.padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 7)
                .help("작업 중인 세션부터 표시합니다. 아래로 스크롤하면 모든 세션을 볼 수 있습니다.")
            if model.sessions.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "terminal").font(.plex(size: 25)).foregroundStyle(.secondary)
                    Text(model.snapshot?.ready == true ? "감지된 AI 세션이 없습니다" : "로컬 세션을 확인하고 있습니다").font(.plex(size: 14))
                    Text("실행 중인 AI 세션이 여기에 표시됩니다.").font(.plex(size: 12)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(model.sortedSessions) { session in
                            sessionRow(session); Divider().padding(.leading, 32).opacity(0.5)
                        }
                    }
                }.frame(maxHeight: .infinity)
            }
        }.frame(maxHeight: .infinity)
    }
    private var accountView: some View {
        VStack(spacing: 10) {
            HStack {
                Text("구독 계정 \(model.snapshot?.account_quotas?.count ?? 0)").font(.plex(size: 14, weight: .semibold))
                Spacer()
                Menu {
                    Button("Claude Code 계정 로그인…") { model.addAccount("Claude") }
                    Button("Codex 계정 로그인…") { model.addAccount("Codex") }
                } label: { Label("계정 추가", systemImage: "plus").font(.plex(size: 12, weight: .medium)) }
                    .menuStyle(.borderlessButton).fixedSize().disabled(!model.fresh || model.busy)
                    .accessibilityLabel("구독 계정 추가 로그인")
            }.padding(.horizontal, 18).padding(.top, 14)
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(model.snapshot?.account_quotas ?? []) { quota in compactQuota(quota) }
                    if (model.snapshot?.account_quotas ?? []).isEmpty {
                        VStack(spacing: 8) {
                            Text("로그인한 구독 계정을 확인하고 있습니다.")
                            Text("계정 추가로 다른 계정도 연결할 수 있습니다.").foregroundStyle(.secondary)
                        }.font(.plex(size: 13)).padding(.vertical, 35)
                    }
                }.padding(.horizontal, 16).padding(.bottom, 12)
            }
            Text("제공자 보고 사용률 · 토큰 합계와 별개 · 2분마다 확인")
                .font(.plex(size: 11)).foregroundStyle(.secondary).padding(.bottom, 12)
        }.frame(maxHeight: .infinity)
    }
    private func compactQuota(_ quota: AccountQuota) -> some View {
        let tint: Color = quota.kind == "Codex" ? Color(red: 0.56, green: 0.68, blue: 0.99) : panelAccent
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 2).fill(tint).frame(width: 5, height: 13)
                Text(quota.kind == "Claude" ? "Claude Code" : quota.kind).font(.plex(size: 13, weight: .semibold))
                Text(quota.plan ?? "").font(.plex(size: 10, weight: .medium)).foregroundStyle(tint)
                Spacer()
                Circle().fill(quota.stale ? Color.orange : panelAccent).frame(width: 5, height: 5)
                Text(quota.statusLabel)
                    .font(.plex(size: 10)).foregroundStyle(quota.stale ? Color.orange : Color.secondary)
            }
            Text(quota.account_label).font(.plex(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                .help(quota.account_label + " · " + quota.id.suffix(6))
            HStack(alignment: .top, spacing: 18) {
                ForEach(quota.windows) { window in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(window.label).foregroundStyle(.secondary); Spacer()
                            Text(window.pct.map { DesktopFormat.percent($0) } ?? "미확인").monospacedDigit()
                        }.font(.plex(size: 12, weight: .medium))
                        GeometryReader { geo in
                            Capsule().fill(Color.white.opacity(0.08)).overlay(alignment: .leading) {
                                if let pct = window.pct {
                                    Capsule().fill(pct >= 90 ? Color.orange : tint).frame(width: geo.size.width * min(100,max(0,pct))/100)
                                }
                            }
                        }.frame(height: 3).accessibilityLabel(window.pct == nil ? "사용률 미확인" : "사용률 \(Int(window.pct ?? 0))퍼센트")
                        Text(resetLabel(window.reset)).font(.plex(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }.frame(maxWidth: .infinity)
                }
            }.padding(.top, 2)
            if quota.stale, quota.status != nil {
                Text(quota.note).font(.plex(size: 10)).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
            }
        }.padding(.horizontal, 12).padding(.vertical, 10)
            .background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white.opacity(0.06)))
            .help(quota.note + (quota.updated > 0 ? " · " + Date(timeIntervalSince1970: quota.updated).formatted(date: .omitted, time: .shortened) : ""))
    }
    private func resetLabel(_ reset: Double) -> String {
        guard reset > 0 else { return "초기화 시각 미보고" }
        let minutes = Int(ceil((reset-model.now.timeIntervalSince1970)/60))
        if minutes <= 0 { return "초기화 보고 대기" }
        if minutes >= 1440 { return "\(minutes/1440)일 \((minutes%1440)/60)시간 후 초기화" }
        return minutes >= 60 ? "\(minutes/60)시간 \(minutes%60)분 후 초기화" : "\(minutes)분 후 초기화"
    }
    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform.path").font(.plex(size: 18, weight: .semibold)).foregroundStyle(panelAccent)
            Text("1top").font(.plex(size: 19, weight: .semibold)).accessibilityLabel("1top"); Spacer()
            Circle().fill(model.fresh ? panelAccent : Color.orange).frame(width: 6, height: 6)
            Text(model.connectionLabel).font(.plex(size: 12)).foregroundStyle(.secondary)
            Menu {
                Button("브라우저에서 열기", action: openBrowser)
                Button("지금 새로고침") { model.refresh() }
                Divider()
                Button(model.openAtLogin ? "✓ 로그인할 때 실행" : "로그인할 때 실행", action: toggleLogin)
                Button("원격 대시보드 (선택)", action: remoteOptions)
                Button("원격 기기 연결…", action: connectRemote)
                Divider()
                Button("로컬 수집기 다시 시작", action: restart)
                Button("1top 종료", action: quit)
            } label: { Image(systemName: "ellipsis.circle").font(.plex(size: 18)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 24).accessibilityLabel("1top 옵션")
        }.padding(.horizontal, 18).padding(.vertical, 9)
    }
    private func resource(_ label: String, value: Double?) -> some View {
        HStack(spacing: 7) {
            Text(label).foregroundStyle(.secondary)
            GeometryReader { geo in
                Capsule().fill(Color.white.opacity(0.08)).overlay(alignment: .leading) {
                    Capsule().fill((value ?? 0) > 90 ? Color.orange : panelAccent.opacity(0.7))
                        .frame(width: geo.size.width * min(100, max(0, value ?? 0)) / 100)
                }
            }.frame(height: 3)
            Text(DesktopFormat.percent(value)).monospacedDigit().frame(width: 31, alignment: .trailing)
        }.font(.plex(size: 12)).help("\(label) · 이 Mac 전체 사용률 \(DesktopFormat.percent(value))")
    }
    private func sessionRow(_ s: DesktopSession) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Circle().fill(s.state == "working" ? panelAccent : s.state == "waiting" ? Color.orange : Color.gray.opacity(0.5))
                .frame(width: 5, height: 5).help(s.stateLabel).accessibilityLabel(s.stateLabel)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(s.project ?? s.kind).font(.plex(size: 14, weight: .semibold)).lineLimit(1)
                }
                Text([s.kind == "Aside" ? (s.model ?? "모델 미확인") : (s.kind == "Claude" ? "Claude Code" : s.kind), s.locationLabel].joined(separator: " · "))
                    .font(.plex(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            }.frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).layoutPriority(-1)
                .help("\(s.project ?? s.kind)\n\(s.locationLabel) · \(s.model ?? s.kind)\n\(s.stateLabel)" + (s.title.map { "\n" + $0 } ?? ""))
            VStack(alignment: .trailing, spacing: 1) {
                Text(tokensMode ? DesktopFormat.number(DesktopFormat.total(s.tokens == nil ? nil : (s.usage?.windows?[model.selectedPeriod] ?? nil))) : (s.usage?.weekly_estimate?[model.selectedPeriod].map { "≈" + DesktopFormat.quota($0.used_pp) } ?? (DesktopFormat.number(DesktopFormat.total(s.usage?.windows?[model.selectedPeriod] ?? nil)) + " tok")))
                    .font(.plex(size: 14, weight: .medium)).monospacedDigit()
                Text(!tokensMode ? (s.usage?.weekly_estimate?[model.selectedPeriod].map { $0.partial ? "추정 · 일부 구간" : "추정" } ?? (s.usage?.weekly_account == nil ? "계정 연결 필요" : "다음 한도 보고 대기")) : s.state == "working" ? "\(DesktopFormat.number(s.tokens == nil ? nil : s.usage?.rate)) tok/s" : s.stateLabel)
                    .font(.plex(size: 11)).foregroundStyle(s.state == "working" ? panelAccent : .secondary).monospacedDigit()
            }.fixedSize().help(tokensMode ? "선택한 기간 누적 토큰 · 최근 60초 평균 소비 · \(s.stateLabel)" : weeklyExplanation)
            Button { control("focus", s) } label: { Image(systemName: "arrow.up.right").font(.plex(size: 14)) }
                .buttonStyle(.plain).frame(width: 22, height: 30).disabled(!model.fresh || model.busy || !s.allows("focus"))
                .accessibilityLabel("\(s.project ?? s.kind) · \(s.terminalName) 바로가기")
            Menu {
                Button("터미널 바로가기") { control("focus", s) }.disabled(!s.allows("focus"))
                Button("작업 일시정지…") { control("pause", s) }.disabled(!s.allows("pause"))
                Button("새 요청으로 재개…") { control("resume", s) }.disabled(!s.allows("resume"))
                Divider()
                Button("CLI 종료…", role: .destructive) { control("terminate", s) }.disabled(!s.allows("terminate"))
            } label: { Image(systemName: "ellipsis").font(.plex(size: 14)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 22)
                .disabled(!model.fresh || model.busy).accessibilityLabel("\(s.project ?? s.kind) 세션 제어")
        }.padding(.horizontal, 18).padding(.vertical, 6)
            .background(hoveredSession == s.id ? Color.white.opacity(0.035) : .clear)
            .onHover { hoveredSession = $0 ? s.id : nil }
    }
}
