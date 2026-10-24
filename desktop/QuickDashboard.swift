import AppKit
import SwiftUI

private let panelBackground = Color(red: 0.055, green: 0.063, blue: 0.075)
private let panelAccent = Color(red: 0.43, green: 0.80, blue: 0.66)
struct QuickDashboard: View {
    @ObservedObject var model: DashboardModel
    var openDashboard: () -> Void; var openBrowser: () -> Void
    var remoteOptions: () -> Void; var connectRemote: () -> Void
    var toggleLogin: () -> Void; var restart: () -> Void; var quit: () -> Void
    var control: (String, DesktopSession) -> Void
    var body: some View {
        VStack(spacing: 0) {
            header
            Picker("보기", selection: $model.accounts) { Text("세션 요약").tag(false); Text("계정 한도 · 5H / 주간").tag(true) }
                .pickerStyle(.segmented).padding(.horizontal, 20).padding(.bottom, 16)
            Divider()
            if model.accounts { accountView } else { summary; sessionList }
            if let message = model.message {
                HStack(alignment: .top) {
                    Text(message).font(.system(size: 12)).foregroundStyle(model.messageIsError ? Color.orange : panelAccent)
                    Spacer(minLength: 4)
                    Button { model.message = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).accessibilityLabel("알림 닫기")
                }.padding(12).background(Color.white.opacity(0.04))
            }
            Divider()
            HStack(spacing: 12) {
                Button(action: openDashboard) {
                    HStack { Image(systemName: "rectangle.inset.filled"); Text("전체 대시보드"); Spacer(); Text("⌘O").foregroundStyle(.secondary) }
                        .font(.system(size: 14, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 11)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
                }.buttonStyle(.plain).accessibilityLabel("전체 대시보드 열기")
                Button(action: openBrowser) { Image(systemName: "safari").font(.system(size: 19)) }
                    .buttonStyle(.plain).help("브라우저에서 열기").accessibilityLabel("브라우저에서 열기")
            }.padding(16)
        }.frame(width: 450).background(panelBackground).preferredColorScheme(.dark)
    }
    private var summary: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                Text("사용량").font(.system(size: 15, weight: .semibold)); Spacer()
                Picker("최근 누적 기간", selection: $model.selectedPeriod) {
                    ForEach([("10m", "10분"), ("30m", "30분"), ("1h", "1시간"), ("5h", "5시간"), ("12h", "12시간"), ("24h", "24시간")], id: \.0) { Text("최근 \($0.1)").tag($0.0) }
                }.labelsHidden().frame(width: 130).accessibilityLabel("최근 누적 기간")
            }
            HStack(alignment: .top, spacing: 0) {
                metric(DesktopFormat.number(model.periodTokens), "누적 tokens", note: model.window?.partial == true ? "일부 기간만 기록됨" : "수집된 보고량")
                Spacer(minLength: 12)
                metric(DesktopFormat.number(model.rate), "tokens/s", note: "최근 60초 평균")
                Spacer(minLength: 12)
                metric(model.snapshot?.ready == true ? "\(model.working)" : "—", "작업 중", note: "전체 \(model.sessions.count)개")
            }
            HStack(spacing: 20) {
                resource("CPU", value: model.snapshot?.system?.host?.cpu)
                resource("메모리", value: model.snapshot?.system?.host?.memory?.percent)
            }
            Text("캐시 포함 · 요금 아님 · \(model.knownCount)/\(model.sessions.count)개 세션 토큰 확인")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }.padding(20)
    }
    private var sessionList: some View {
        VStack(spacing: 0) {
            Divider()
            HStack {
                Text("세션").font(.system(size: 15, weight: .semibold))
                Text("\(model.sessions.count)").foregroundStyle(.secondary); Spacer()
                Text("작업 중인 순서").font(.system(size: 12)).foregroundStyle(.secondary)
            }.padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 8)
            if model.sessions.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "terminal").font(.system(size: 25)).foregroundStyle(.secondary)
                    Text(model.snapshot?.ready == true ? "감지된 AI 세션이 없습니다" : "로컬 세션을 확인하고 있습니다").font(.system(size: 14))
                    Text("실행 중인 AI 세션이 여기에 표시됩니다.").font(.system(size: 12)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).frame(height: 155)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(model.sortedSessions) { session in
                            sessionRow(session); Divider().padding(.leading, 20)
                        }
                    }
                }.frame(height: min(270, CGFloat(model.sessions.count) * 89))
            }
        }
    }
    private var accountView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("로그인 계정별 플랜 한도").font(.system(size: 16, weight: .semibold))
                Text("토큰 합계와 별개인 제공자 보고 사용률입니다.").font(.system(size: 12)).foregroundStyle(.secondary)
                ForEach(model.snapshot?.account_quotas ?? []) { quota in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text(quota.kind).font(.system(size: 15, weight: .semibold)); Spacer(); Text(quota.plan ?? "").font(.system(size: 12)).foregroundStyle(.secondary) }
                        Text(quota.account_label + " · " + quota.id.suffix(6)).font(.system(size: 13)).lineLimit(1)
                        ForEach(quota.windows) { window in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(window.label); Spacer()
                                    Text(window.pct.map { DesktopFormat.percent($0) + " 사용" } ?? "미확인").monospacedDigit()
                                }.font(.system(size: 13))
                                ProgressView(value: min(100, max(0, window.pct ?? 0)), total: 100).tint((window.pct ?? 0) >= 90 ? .orange : panelAccent)
                                Text(window.reset > 0 ? "초기화 " + Date(timeIntervalSince1970: window.reset).formatted(date: .abbreviated, time: .shortened) : "초기화 시각 미보고")
                                    .font(.system(size: 11)).foregroundStyle(.secondary)
                            }
                        }
                        Text(quota.note).font(.system(size: 11)).foregroundStyle(quota.stale ? Color.orange : Color.secondary)
                        if quota.updated > 0 {
                            Text("마지막 확인 " + Date(timeIntervalSince1970: quota.updated).formatted(date: .omitted, time: .shortened))
                                .font(.system(size: 11)).foregroundStyle(.secondary)
                        }
                    }.padding(14).background(Color.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 8))
                }
                if (model.snapshot?.account_quotas ?? []).isEmpty {
                    Text("계정 한도를 확인하고 있습니다…").foregroundStyle(.secondary).padding(.vertical, 50)
                }
            }.padding(20)
        }.frame(height: 490)
    }
    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform.path").font(.system(size: 20, weight: .semibold)).foregroundStyle(panelAccent)
            Text("1top").font(.system(size: 22, weight: .semibold)); Spacer()
            Circle().fill(model.fresh ? panelAccent : Color.orange).frame(width: 6, height: 6)
            Text(model.connectionLabel).font(.system(size: 12)).foregroundStyle(.secondary)
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
            } label: { Image(systemName: "ellipsis.circle").font(.system(size: 18)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 24).accessibilityLabel("1top 옵션")
        }.padding(20)
    }
    private func metric(_ value: String, _ label: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(value).font(.system(size: 28, weight: .semibold, design: .rounded)).monospacedDigit()
            Text(label).font(.system(size: 13, weight: .medium))
            Text(note).font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }
    private func resource(_ label: String, value: Double?) -> some View {
        VStack(spacing: 7) {
            HStack { Text(label); Spacer(); Text(DesktopFormat.percent(value)).monospacedDigit() }.font(.system(size: 12)).foregroundStyle(.secondary)
            GeometryReader { geo in
                Capsule().fill(Color.white.opacity(0.08)).overlay(alignment: .leading) {
                    Capsule().fill((value ?? 0) > 90 ? Color.orange : panelAccent.opacity(0.7))
                        .frame(width: geo.size.width * min(100, max(0, value ?? 0)) / 100)
                }
            }.frame(height: 3)
        }
    }
    private func sessionRow(_ s: DesktopSession) -> some View {
        HStack(alignment: .center, spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(s.state == "working" ? panelAccent : Color.gray.opacity(0.4)).frame(width: 3, height: 38)
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(s.project ?? s.kind).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    Text(s.kind).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Text(s.locationLabel).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1).help(s.title ?? s.locationLabel)
                Text(s.stateLabel).font(.system(size: 11)).foregroundStyle(s.state == "working" ? panelAccent : .secondary)
            }.frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 5) {
                Text(DesktopFormat.number(DesktopFormat.total(s.tokens == nil ? nil : (s.usage?.windows?[model.selectedPeriod] ?? nil))))
                    .font(.system(size: 14, weight: .medium)).monospacedDigit()
                Text("\(DesktopFormat.number(s.tokens == nil ? nil : s.usage?.rate)) tok/s").font(.system(size: 11)).foregroundStyle(.secondary).monospacedDigit()
            }.help("선택한 기간 누적 토큰 · 최근 60초 평균 소비")
            Button { control("focus", s) } label: { Image(systemName: "arrow.up.right").font(.system(size: 14)) }
                .buttonStyle(.plain).disabled(!model.fresh || model.busy || !s.allows("focus"))
                .accessibilityLabel("\(s.project ?? s.kind) · \(s.terminalName) 바로가기")
            Menu {
                Button("터미널 바로가기") { control("focus", s) }.disabled(!s.allows("focus"))
                Button("작업 일시정지…") { control("pause", s) }.disabled(!s.allows("pause"))
                Button("새 요청으로 재개…") { control("resume", s) }.disabled(!s.allows("resume"))
                Divider()
                Button("CLI 종료…", role: .destructive) { control("terminate", s) }.disabled(!s.allows("terminate"))
            } label: { Image(systemName: "ellipsis").font(.system(size: 14)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 18)
                .disabled(!model.fresh || model.busy).accessibilityLabel("\(s.project ?? s.kind) 세션 제어")
        }.padding(.horizontal, 20).padding(.vertical, 12)
    }
}
