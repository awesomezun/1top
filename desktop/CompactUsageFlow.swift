import SwiftUI

struct CompactUsageFlow: View {
    @ObservedObject var model: DashboardModel
    private let plotHeight: CGFloat = 64
    private let axisWidth: CGFloat = 72
    private var end: Double { model.snapshot?.updated ?? model.now.timeIntervalSince1970 }
    var body: some View {
        tokenChart.frame(height: 90, alignment: .top).accessibilityElement(children: .contain)
            .accessibilityLabel("토큰 사용 흐름 · 최근 \(model.window?.label ?? model.selectedPeriod)")
    }
    private var tokenChart: some View {
        let trend = DesktopUsageTrend(events: model.snapshot?.events, period: model.selectedPeriod, end: end)
        let scale = trend.maximum
        return VStack(alignment: .leading, spacing: 8) {
            plot(scale: scale) {
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(trend.bins) { bin in tokenBar(bin, scale: scale, series: trend.series) }
                }
                if !trend.reported {
                    Text("사용 기록 대기").font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
            timeAxis(start: trend.bins.first?.start, finish: trend.bins.last?.end)
        }
    }
    private func tokenBar(_ bin: DesktopUsageTrend.Bin, scale: Double, series: [String]) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            ForEach(Array(series.reversed()), id: \.self) { kind in
                Rectangle().fill(color(kind).opacity(0.86))
                    .frame(height: plotHeight * (bin.tokensByKind[kind] ?? 0) / scale)
            }
        }.frame(maxWidth: .infinity).frame(height: plotHeight).contentShape(Rectangle())
            .help("\(time(bin.start))–\(time(bin.end))\n\(DesktopFormat.number(bin.tokens)) tokens · 캐시 포함\n" +
                  bin.tokensByKind.keys.sorted().map {
                      "\($0 == "unknown" ? "도구 미확인" : tool($0)): \(DesktopFormat.number(bin.tokensByKind[$0]))"
                  }.joined(separator: " · "))
    }
    private func plot<Content: View>(scale: Double, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 6) {
            GeometryReader { geometry in
                ForEach(0..<3) { index in
                    let value = scale * Double(2 - index) / 2
                    Text(axisLabel(value) + " tokens")
                        .font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
                        .frame(width: axisWidth, alignment: .trailing)
                        .position(x: axisWidth / 2, y: plotHeight * CGFloat(index) / 2)
                }
            }.frame(width: axisWidth, height: plotHeight)
            ZStack {
                GeometryReader { geometry in
                    Path { path in
                        for index in 0..<3 {
                            let y = plotHeight * CGFloat(index) / 2
                            path.move(to: CGPoint(x: 0, y: y))
                            path.addLine(to: CGPoint(x: geometry.size.width, y: y))
                        }
                    }.stroke(Color.white.opacity(0.12), lineWidth: 0.5)
                }
                content()
            }.frame(height: plotHeight)
        }.frame(height: plotHeight)
    }
    private func timeAxis(start: Double?, finish: Double?) -> some View {
        HStack(spacing: 4) {
            Text(time(start)); Spacer(minLength: 4); Text(time(finish))
        }.font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
            .padding(.leading, axisWidth + 6).frame(height: 18)
    }
    private func axisLabel(_ value: Double) -> String {
        let scale: Double = value >= 1e9 ? 1e9 : value >= 1e6 ? 1e6 : value >= 1e3 ? 1e3 : 1
        let suffix = scale == 1e9 ? "B" : scale == 1e6 ? "M" : scale == 1e3 ? "k" : ""
        return (value / scale).formatted(.number.precision(.significantDigits(1...3))) + suffix
    }
    private func color(_ kind: String) -> Color {
        ["Claude", "Codex", "GLM", "Antigravity", "Aside"].contains(kind)
            ? AgentPalette.color(kind) : Color(red: 139/255, green: 147/255, blue: 159/255)
    }
    private func time(_ timestamp: Double?) -> String {
        guard let timestamp, timestamp.isFinite else { return "—" }
        return Date(timeIntervalSince1970: timestamp).formatted(date: .omitted, time: .shortened)
    }
    private func tool(_ kind: String) -> String { kind == "Claude" ? "Claude Code" : kind }
}
