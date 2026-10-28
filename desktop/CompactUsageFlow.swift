import SwiftUI

struct CompactUsageFlow: View {
    @ObservedObject var model: DashboardModel
    @State private var weeklyMode = false
    @State private var selectedAccountID: String?
    private var end: Double { model.snapshot?.updated ?? model.now.timeIntervalSince1970 }
    private var accounts: [AccountQuota] { model.snapshot?.account_quotas ?? [] }
    private var selectedAccount: AccountQuota? {
        if let selected = accounts.first(where: { $0.id == selectedAccountID }) { return selected }
        return accounts.reduce(accounts.first) { best, candidate in
            observedConsumption(candidate) > (best.map(observedConsumption) ?? -1) ? candidate : best
        }
    }
    private func observedConsumption(_ quota: AccountQuota) -> Double {
        let account = model.snapshot?.weekly_usage?.accounts.first { $0.id == quota.id }
        return account?.periods[model.selectedPeriod]?.used_pp ??
            DesktopWeeklyUsageTrend(history: account?.history, flow: account?.flow, period: model.selectedPeriod, end: end).total
    }
    private var weeklyTrend: DesktopWeeklyUsageTrend {
        let account = model.snapshot?.weekly_usage?.accounts.first {
            $0.id == selectedAccount?.id
        }
        return DesktopWeeklyUsageTrend(history: account?.history, flow: account?.flow,
                                       period: model.selectedPeriod, end: end)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text(weeklyMode ? "주간 소진 %p" : "토큰 흐름")
                    .font(.plex(size: 12, weight: .semibold)).lineLimit(1)
                Spacer(minLength: 2)
                modeButton("토큰", weekly: false)
                modeButton("한도 %", weekly: true)
            }.frame(height: 23)
            if weeklyMode { weeklyChart } else { tokenChart }
        }.frame(height: 108, alignment: .top).accessibilityElement(children: .contain)
            .accessibilityLabel("사용량 흐름 · 최근 \(model.window?.label ?? model.selectedPeriod)")
    }
    private func modeButton(_ title: String, weekly: Bool) -> some View {
        Button { weeklyMode = weekly } label: {
            Text(title).font(.plex(size: 12, weight: .medium)).padding(.horizontal, 6).padding(.vertical, 3)
                .foregroundStyle(weeklyMode == weekly ? Color.primary : Color.secondary)
                .background(weeklyMode == weekly ? Color.white.opacity(0.10) : Color.clear,
                            in: RoundedRectangle(cornerRadius: 5))
        }.buttonStyle(.plain).accessibilityLabel(weekly ? "주간 한도 소진 흐름" : "토큰 사용 흐름")
            .accessibilityAddTraits(weeklyMode == weekly ? .isSelected : [])
    }
    private var tokenChart: some View {
        let trend = DesktopUsageTrend(events: model.snapshot?.events, period: model.selectedPeriod, end: end)
        let peak = trend.bins.map(\.tokens).max() ?? 0
        return VStack(alignment: .leading, spacing: 3) {
            Text(trend.reported ? "최대 \(DesktopFormat.number(peak)) tokens" : "사용 기록 대기")
                .font(.plex(size: 12)).foregroundStyle(.secondary).lineLimit(1).frame(height: 18)
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(trend.bins) { bin in
                    tokenBar(bin, peak: peak)
                }
            }.frame(height: 34, alignment: .bottom)
            HStack(spacing: 2) {
                Text(time(trend.bins.first?.start))
                Spacer(minLength: 0)
                Text(model.window?.partial == true ? "일부 기록" : "캐시 포함")
                Spacer(minLength: 0)
                Text(time(trend.bins.last?.end))
            }.font(.plex(size: 12)).foregroundStyle(.secondary).lineLimit(1).frame(height: 18)
        }
    }
    private func tokenBar(_ bin: DesktopUsageTrend.Bin, peak: Double) -> some View {
        GeometryReader { geometry in
            if bin.tokens > 0 {
                VStack(spacing: 0) {
                    ForEach(bin.tokensByKind.keys.sorted(), id: \.self) { kind in
                        Rectangle().fill(kind == "unknown" ? Color.gray : AgentPalette.color(kind))
                            .frame(height: geometry.size.height * (bin.tokensByKind[kind] ?? 0) / bin.tokens)
                    }
                }
            } else { Color.gray.opacity(0.18) }
        }.frame(maxWidth: .infinity).frame(height: max(2, 34 * bin.tokens / max(1, peak)))
            .clipShape(RoundedRectangle(cornerRadius: 1.5))
            .help("\(time(bin.start))–\(time(bin.end))\n\(DesktopFormat.number(bin.tokens)) tokens · 캐시 포함\n" +
                  bin.tokensByKind.keys.sorted().map {
                      "\($0 == "unknown" ? "도구 미확인" : tool($0)): \(DesktopFormat.number(bin.tokensByKind[$0]))"
                  }.joined(separator: " · "))
    }
    private var weeklyChart: some View {
        let trend = weeklyTrend
        let peak = trend.bins.compactMap(\.usedPP).max() ?? 0
        let account = selectedAccount
        let tint = AgentPalette.color(account?.kind ?? "")
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Menu {
                    ForEach(accounts) { q in
                        Button("\(tool(q.kind)) · \(q.account_label) · \(q.plan ?? "")") {
                            selectedAccountID = q.id
                        }
                    }
                } label: {
                    Text(account.map { "\(tool($0.kind)) · \($0.account_label)" } ?? "계정 없음")
                        .font(.plex(size: 12)).lineLimit(1).truncationMode(.middle).foregroundStyle(tint)
                }.menuStyle(.borderlessButton).disabled(accounts.isEmpty)
                    .help(account.map { "\(tool($0.kind)) · \($0.account_label)\n한 계정의 주간 한도 변화만 표시합니다." } ?? "계정을 연결하면 기록이 표시됩니다.")
                    .accessibilityLabel("흐름을 볼 계정 선택")
                Spacer(minLength: 0)
                Text(trend.reported ? "최대 \(DesktopFormat.quota(peak))p" : "기록 대기")
                    .font(.plex(size: 12)).foregroundStyle(.secondary).fixedSize()
            }.frame(height: 18)
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(trend.bins) { bin in
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(bin.usedPP == nil ? Color.white.opacity(0.10) : tint.opacity(0.85))
                        .frame(maxWidth: .infinity)
                        .frame(height: bin.usedPP.map { max(3, 34 * $0 / max(0.01, peak)) } ?? 1)
                        .help("\(time(bin.start))–\(time(bin.end))\n" + (bin.usedPP.map {
                            "보고 시점 기준 +\(DesktopFormat.quota($0))p · 주간 한도\n0은 보고된 변화 없음이며, 미보고 구간과 구분합니다."
                        } ?? "이 구간의 유효한 한도 변화 기록 없음") )
                }
            }.frame(height: 34, alignment: .bottom)
                .accessibilityLabel(trend.reported ? "주간 한도 관측 증가 \(DesktopFormat.quota(trend.total))p" : "주간 한도 변화 기록 대기")
            HStack(spacing: 2) {
                Text(time(trend.bins.first?.start))
                Spacer(minLength: 0)
                Text(account?.stale == true || !model.fresh ? "마지막 기록" : "관측 \(DesktopFormat.duration(trend.observedSeconds))")
                Spacer(minLength: 0)
                Text(time(trend.bins.last?.end))
            }.font(.plex(size: 12)).foregroundStyle(.secondary).lineLimit(1).frame(height: 18)
                .help("선택 기간 중 관측 \(DesktopFormat.duration(trend.observedSeconds)). 빈 구간은 미보고이며, 초기화·감소·5분 넘는 공백은 제외합니다. 계정별 한도를 합산하거나 미관측 과거를 추정하지 않습니다.")
        }
    }
    private func time(_ timestamp: Double?) -> String {
        guard let timestamp, timestamp.isFinite else { return "—" }
        return Date(timeIntervalSince1970: timestamp).formatted(date: .omitted, time: .shortened)
    }
    private func tool(_ kind: String) -> String { kind == "Claude" ? "Claude Code" : kind }
}
