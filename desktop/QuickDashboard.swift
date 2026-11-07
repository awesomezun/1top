import AppKit
import SwiftUI

private let panelBackground = Color(red: 0.055, green: 0.063, blue: 0.075)
private let panelAccent = Color(red: 0.43, green: 0.80, blue: 0.66)
struct QuickDashboard: View {
    static let panelSize = NSSize(width: 520, height: 760)
    @ObservedObject var model: DashboardModel
    @State private var hoveredSession: String?
    @State private var selectedAccount: AccountQuota?
    @AppStorage("weeklyTokensMode") private var tokensMode = false
    @AppStorage("dashboardTheme") private var dashboardTheme = "dark"
    var openDashboard: () -> Void; var openBrowser: () -> Void
    var remoteOptions: () -> Void; var connectRemote: () -> Void
    var toggleLogin: () -> Void; var restart: () -> Void; var quit: () -> Void
    var control: (String, DesktopSession) -> Void
    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            summary
            VStack(spacing: 8) {
                CompactUsageFlow(model: model)
                CompactTokenMap(model: model)
            }.padding(.horizontal, 18).padding(.bottom, 8)
            sessionList
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
            .background(dashboardTheme == "light" ? Color(nsColor: .windowBackgroundColor) : panelBackground).preferredColorScheme(dashboardTheme == "light" ? .light : .dark).font(.plex(size: 14))
            .popover(item: $selectedAccount, arrowEdge: .bottom) { original in
                let current = model.snapshot?.account_quotas?.first { $0.id == original.id } ?? original
                compactQuota(current).padding(12).frame(width: 370).preferredColorScheme(dashboardTheme == "light" ? .light : .dark)
            }
    }
    private var summary: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 4) {
                ForEach([("10m", "10분"), ("30m", "30분"), ("1h", "1시간"), ("5h", "5시간"), ("12h", "12시간"), ("24h", "24시간")], id: \.0) { key, title in
                    Button { model.selectedPeriod = key } label: {
                        Text(title).font(.plex(size: 13, weight: .medium)).frame(maxWidth: .infinity).padding(.vertical, 5)
                            .foregroundStyle(model.selectedPeriod == key ? panelAccent : Color.secondary)
                            .background(model.selectedPeriod == key ? panelAccent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 5))
                    }.buttonStyle(.plain).accessibilityLabel("최근 \(title)")
                        .accessibilityAddTraits(model.selectedPeriod == key ? .isSelected : [])
                }
            }.accessibilityElement(children: .contain).accessibilityLabel("사용량 기간")
            HStack {
                Text("주간 한도").font(.plex(size: 13, weight: .semibold))
                Text("계정별 100%").font(.plex(size: 12)).foregroundStyle(.secondary)
                Spacer()
                Menu {
                    Button("Claude Code 계정 로그인…") { model.addAccount("Claude") }
                    Button("Codex 계정 로그인…") { model.addAccount("Codex") }
                } label: { Image(systemName: "plus").font(.system(size: 13, weight: .medium)) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 22)
                    .disabled(!model.fresh || model.busy).accessibilityLabel("구독 계정 추가 로그인")
            }
            weeklyOverview
            HStack(spacing: 22) {
                resource("CPU", value: model.snapshot?.system?.host?.cpu)
                resource("메모리", value: model.snapshot?.system?.host?.memory?.percent)
            }.padding(.top, 2)
        }.padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 8)
    }
    private var weeklyOverview: some View {
        let rows = model.snapshot?.account_quotas ?? []
        return Group {
            if rows.isEmpty {
                Text("+ 버튼으로 구독 계정을 연결하세요.").font(.plex(size: 13)).foregroundStyle(.secondary).padding(.vertical, 8)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                        ForEach(rows) { q in weeklyCard(q) }
                    }
                }.frame(height: rows.count > 2 ? 102 : 48)
            }
        }
    }
    private func weeklyCard(_ q: AccountQuota) -> some View {
        let w = q.windows.first { $0.label == "주간" }
        let p = model.snapshot?.weekly_usage?.accounts.first { $0.id == q.id }?.periods[model.selectedPeriod]
        let color = AgentPalette.color(q.kind)
        let rate = model.fresh && !q.stale ? p?.burnPerHour : nil
        return Button { selectedAccount = q } label: {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Circle().fill(color).frame(width: 5, height: 5)
                    Text(q.kind == "Claude" ? "Claude Code" : q.kind).font(.plex(size: 13, weight: .semibold)).lineLimit(1)
                    Text(q.plan ?? "").font(.plex(size: 11)).foregroundStyle(color).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(DesktopFormat.quota(w?.pct)).font(.plex(size: 20, weight: .semibold)).monospacedDigit().fixedSize()
                }
                HStack(spacing: 6) {
                    Text(q.account_label).font(.plex(size: 12)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 0)
                    Text(q.stale ? q.statusLabel : rate == nil ? "속도 수집 중" : DesktopFormat.burnRate(rate))
                        .font(.plex(size: 12, weight: .medium)).foregroundStyle(q.stale ? Color.orange : color).fixedSize()
                }
            }.padding(.horizontal, 8).frame(height: 48).frame(maxWidth: .infinity)
                .background(color.opacity(0.065), in: RoundedRectangle(cornerRadius: 7))
        }.buttonStyle(.plain).accessibilityLabel("\(q.kind == "Claude" ? "Claude Code" : q.kind) \(q.account_label) 한도 상세")
            .help("\(q.account_label)\n주간 한도 100% 중 사용 · \(q.note)\n속도: 관측된 한도 증가분 ÷ 실제 관측 시간. 1%/시간은 주간 한도의 1%를 한 시간에 소진한 평균입니다.\n클릭하면 5시간 한도와 초기화 시각을 확인합니다.")
    }
    private var weeklyExplanation: String {
        "선택 기간의 보고 토큰을 관측한 계정별 한도 변화율로 환산합니다. 실제 차감량이 아닙니다. 모델·캐시·다른 기기 사용에 따라 오차가 생깁니다. 과거 미귀속 토큰은 현재 계정 기준으로 환산합니다."
    }
    private var sessionList: some View {
        VStack(spacing: 0) {
            Divider()
            HStack {
                Text("세션").font(.plex(size: 15, weight: .semibold))
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
    private func compactQuota(_ quota: AccountQuota) -> some View {
        let tint = AgentPalette.color(quota.kind)
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
                Button(tokensMode ? "세션을 주간 한도 %로 보기" : "세션을 토큰으로 보기") { tokensMode.toggle() }
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
            Text(DesktopFormat.percent(value)).monospacedDigit().frame(width: 36, alignment: .trailing)
        }.font(.plex(size: 13)).help("\(label) · 이 Mac 전체 사용률 \(DesktopFormat.percent(value))")
    }
    private func sessionRow(_ s: DesktopSession) -> some View {
        let quota = model.snapshot?.account_quotas?.first { $0.id == s.usage?.weekly_account }
        let estimate = s.usage?.weekly_estimate?[model.selectedPeriod]
        let burn = model.fresh && estimate?.permitsBurnRate(for: quota, at: model.now.timeIntervalSince1970) == true
            ? s.usage?.weeklyBurnPerHour(period: model.selectedPeriod) : nil
        let pending = !model.fresh ? "마지막 기록" : quota?.stale == true ? (quota?.statusLabel ?? "한도 조회 대기") : s.usage?.weekly_account == nil ? "계정 연결 필요" : "환산 기준 수집 중"
        var modelLabel = "\(s.locationLabel) · \(s.model ?? s.kind)"
        if let effort = s.reportedEffort { modelLabel += " · effort \(effort)" }
        var helpLines = [s.project ?? s.kind, modelLabel, s.groupStateLabel]
        if let title = s.title { helpLines.append(title) }
        let sessionHelp = helpLines.joined(separator: "\n")
        return HStack(alignment: .center, spacing: 8) {
            Circle().fill(s.isWorkingGroup ? panelAccent : s.state == "waiting" ? Color.orange : Color.gray.opacity(0.5))
                .frame(width: 5, height: 5).help(s.groupStateLabel).accessibilityLabel(s.groupStateLabel)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(s.project ?? s.kind).font(.plex(size: 15, weight: .semibold)).lineLimit(1)
                    if let count = s.children_count, count > 0 {
                        Text("하위 \(count)").font(.plex(size: 12)).foregroundStyle(.secondary).fixedSize()
                            .help("하위 \(count)개 세션의 사용량을 포함합니다. 제어 버튼은 상위 세션에 적용됩니다." +
                                  (s.group_usage_partial == true ? " 일부 하위 세션의 토큰은 미보고 상태입니다." : ""))
                    }
                }
                HStack(spacing: 4) {
                    Text(s.kind == "Aside" ? (s.model ?? "앱 내부 세션") : s.kind == "Claude" ? "Claude Code" : s.kind).foregroundStyle(AgentPalette.color(s.kind))
                    if let effort = s.reportedEffort {
                        Text("· " + effort).foregroundStyle(.secondary).lineLimit(1).layoutPriority(1)
                            .help("현재 effort · " + effort)
                    }
                    Text("· " + s.locationLabel).foregroundStyle(.secondary)
                }.font(.plex(size: 13)).lineLimit(1)
            }.frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).layoutPriority(-1)
                .help(sessionHelp)
            VStack(alignment: .trailing, spacing: 1) {
                Text(tokensMode ? DesktopFormat.number(DesktopFormat.total(s.tokens == nil ? nil : (s.usage?.windows?[model.selectedPeriod] ?? nil))) : (s.usage?.weekly_estimate?[model.selectedPeriod].map { "≈" + DesktopFormat.quota($0.used_pp) } ?? (DesktopFormat.number(DesktopFormat.total(s.usage?.windows?[model.selectedPeriod] ?? nil)) + " tok")))
                    .font(.plex(size: 15, weight: .medium)).monospacedDigit()
                if tokensMode {
                    Text("\(DesktopFormat.number(model.fresh ? s.usage?.rate : nil)) tok/s")
                        .font(.plex(size: 12)).foregroundStyle(.secondary).monospacedDigit()
                } else if let burn {
                    Text(DesktopFormat.burnRate(burn))
                        .font(.plex(size: 12)).foregroundStyle(.secondary).monospacedDigit()
                }
            }.fixedSize().help(tokensMode ? "선택 기간의 누적 토큰 · 최근 60초 평균 소비" : weeklyExplanation + "\n최근 60초 토큰 속도로 환산한 시간당 소진 추정입니다.\n" + (s.usage?.weekly_estimate?[model.selectedPeriod]?.calculationLabel ?? "") + (burn == nil ? "\n" + pending : ""))
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
        }.padding(.horizontal, 18).frame(height: 54)
            .background(hoveredSession == s.id ? Color.white.opacity(0.035) : .clear)
            .onHover { hoveredSession = $0 ? s.id : nil }
    }
}
