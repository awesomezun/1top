import SwiftUI

// The phone's dashboard follows the Mac menu bar quick view: the same palette, sizes and order.
// The period picker governs every number below it.
struct QuickTheme {
    let light: Bool
    private func pick(_ dark: (Double, Double, Double), _ day: (Double, Double, Double)) -> Color {
        let c = light ? day : dark
        return Color(red: c.0 / 255, green: c.1 / 255, blue: c.2 / 255)
    }
    var background: Color { pick((11, 13, 15), (246, 247, 248)) }
    var card: Color { pick((18, 21, 24), (255, 255, 255)) }
    var raised: Color { pick((28, 33, 37), (238, 241, 243)) }
    var line: Color { pick((35, 41, 46), (227, 231, 234)) }
    var ink: Color { pick((237, 241, 243), (17, 21, 24)) }
    var muted: Color { pick((154, 165, 174), (91, 102, 112)) }
    var dim: Color { pick((108, 120, 130), (135, 146, 155)) }
    var accent: Color { pick((108, 207, 169), (19, 128, 95)) }
    /// LCD green for the digits, the beam, the newest bin and the resource bars, kept clear of the
    /// Codex teal so a tool colour never reads as an instrument light.
    var segmentOn: Color { pick((157, 255, 60), (106, 168, 0)) }
    var segmentLead: Color { pick((226, 255, 196), (61, 99, 0)) }
    var segmentOff: Color { pick((29, 35, 39), (238, 241, 243)) }
    var grid: Color { pick((43, 50, 56), (211, 218, 222)) }
    var amber: Color { pick((233, 178, 92), (154, 100, 16)) }
    var red: Color { pick((255, 100, 80), (207, 67, 52)) }
}

/// Time bins for the radar from the nested period totals the relay sends (10m, 30m, 1h, 5h, 12h,
/// 24h): for the last hour that is the last 10 minutes, 10–30 minutes ago and 30–60 minutes ago.
/// Each bin is a speed in tokens per hour by tool, so bins of different lengths compare fairly.
struct SpeedReading {
    struct Bin { var start: Double; var end: Double; var byKind: [(String, Double)]; var total: Double }
    var average: Double?
    var bins: [Bin]

    init(sessions: [Session], period: Period, periodTotal: Double?, flow: FlowSeries? = nil) {
        let seconds = period.seconds
        let sum = sessions.compactMap { $0.tokens(in: period) }
        let total = periodTotal ?? (sum.isEmpty ? nil : sum.reduce(0, +))
        average = total.map { $0 / seconds * 3600 }
        // Fine bins from the collector when the relay carries them: oldest first, tokens per bin.
        if let flow, !flow.bins.isEmpty, flow.step > 0 {
            let count = flow.bins.count
            bins = flow.bins.enumerated().reversed().map { index, bin in
                // An unknown bin draws nothing; it is not a zero.
                let values = bin ?? [:]
                let parts = values.sorted { Self.order($0.key) < Self.order($1.key) }.map { ($0.key, max(0, $0.value) / flow.step * 3600) }
                let ago = Double(count - 1 - index) * flow.step
                return Bin(start: ago, end: min(seconds, ago + flow.step), byKind: parts, total: parts.reduce(0) { $0 + $1.1 })
            }
            return
        }
        let edges = [0.0] + Period.allCases.map(\.seconds).filter { $0 < seconds } + [seconds]
        let kinds = Array(Set(sessions.map(\.kind))).sorted { Self.order($0) < Self.order($1) }
        func tokens(_ s: Session, within limit: Double) -> Double {
            limit == 0 ? 0 : (Period.allCases.first { $0.seconds == limit }.flatMap { s.tokens(in: $0) } ?? 0)
        }
        var bins: [Bin] = []
        for (a, b) in zip(edges, edges.dropFirst()) {
            let parts = kinds.map { kind -> (String, Double) in
                let amount = sessions.filter { $0.kind == kind }.reduce(0) { $0 + max(0, tokens($1, within: b) - tokens($1, within: a)) }
                return (kind, amount / (b - a) * 3600)
            }
            bins.append(Bin(start: a, end: b, byKind: parts, total: parts.reduce(0) { $0 + $1.1 }))
        }
        self.bins = bins
    }
    static func order(_ kind: String) -> Int { ["Claude", "Codex", "GLM", "Antigravity", "Aside"].firstIndex(of: kind) ?? 9 }
}

/// Scope: one turn is the period. The newest bin sits just right of ▼ (now) and the ring goes
/// back in time clockwise to an opening left of twelve o'clock. Bars stack by tool; the dashed ring
/// is the average shown in the centre; a beam sweeps while tokens flow.
struct ScopeDial: View {
    var reading: SpeedReading
    var period: Period
    var theme: QuickTheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var opened = Date.distantPast
    private static let opening = 12.0

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in dial(at: timeline.date) }
            .onAppear { opened = Date() }
            .onChange(of: period) { opened = Date() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L.t("Average token speed over the last \(period.label): \(Format.tokens(reading.average)) tokens per hour",
                                     "최근 \(period.label) 평균 토큰 사용 속도 시간당 \(Format.tokens(reading.average)) tokens"))
    }

    private func dial(at date: Date) -> some View {
        ZStack {
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2), outer = min(size.width, size.height) / 2 - 7
                let inner = outer * 0.6, scale = max(reading.average ?? 0, reading.bins.map(\.total).max() ?? 0) * 1.06
                let grow = reduceMotion ? 1 : 1 - pow(1 - min(1, max(0, date.timeIntervalSince(opened) / 0.8)), 3)
                func radius(_ value: Double) -> CGFloat { inner + (outer - inner) * CGFloat(scale > 0 ? min(1, max(0, value / scale)) * grow : 0) }
                func sector(_ r0: CGFloat, _ r1: CGFloat, _ a0: Double, _ a1: Double) -> Path {
                    Path { p in
                        p.addArc(center: c, radius: r1, startAngle: .degrees(a0), endAngle: .degrees(a1), clockwise: false)
                        p.addArc(center: c, radius: r0, startAngle: .degrees(a1), endAngle: .degrees(a0), clockwise: true)
                        p.closeSubpath()
                    }
                }
                let end = 270 - Self.opening
                func ring(_ r: CGFloat) -> Path { Path { p in p.addArc(center: c, radius: r, startAngle: .degrees(-90), endAngle: .degrees(end), clockwise: false) } }
                for k in 0..<12 {
                    let a = (-90 + 30 * Double(k)) * .pi / 180
                    var p = Path(); p.move(to: CGPoint(x: c.x + cos(a) * inner, y: c.y + sin(a) * inner))
                    p.addLine(to: CGPoint(x: c.x + cos(a) * outer, y: c.y + sin(a) * outer))
                    ctx.stroke(p, with: .color(theme.grid.opacity(0.7)), lineWidth: 0.7)
                }
                for f in [0.25, 0.5, 0.75, 1.0] {
                    ctx.stroke(ring(inner + (outer - inner) * f), with: .color(theme.grid), style: StrokeStyle(lineWidth: 0.8, dash: f == 1 ? [] : [1.5, 3]))
                }
                var nowLine = Path(); nowLine.move(to: CGPoint(x: c.x, y: c.y - inner)); nowLine.addLine(to: CGPoint(x: c.x, y: c.y - outer))
                ctx.stroke(nowLine, with: .color(theme.red.opacity(0.6)), lineWidth: 1)
                let sweeping = !reduceMotion && (reading.average ?? 0) > 0
                let head = (date.timeIntervalSinceReferenceDate * 80).truncatingRemainder(dividingBy: 360) - 90
                if sweeping {
                    for j in 0..<12 {
                        ctx.fill(sector(inner, outer, head - Double(j + 1) * 4, head - Double(j) * 4),
                                 with: .color(theme.segmentOn.opacity(0.26 * pow(1 - Double(j) / 12, 1.6))))
                    }
                }
                // Bins by age: angular width follows each bin's share of the period.
                let span = 360 - Self.opening, seconds = period.seconds
                for (i, bin) in reading.bins.enumerated() where bin.total > 0 {
                    let a0 = -90 + bin.start / seconds * span + 0.6, a1 = -90 + bin.end / seconds * span - 0.6
                    let age = reading.bins.count > 1 ? Double(i) / Double(reading.bins.count - 1) : 0
                    let rest = 0.9 - 0.58 * age, newest = i == 0
                    let behind = ((head - (a0 + a1) / 2).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
                    let lit = sweeping && !newest ? exp(-behind / 75) : 0
                    var r0 = inner + 1, value = 0.0
                    for (kind, part) in bin.byKind where part > 0 {
                        value += part
                        let r1 = radius(value)
                        guard r1 > r0 + 0.3 else { continue }
                        let path = sector(r0, r1, a0, a1)
                        ctx.fill(path, with: .color(Tool.color(kind).opacity(newest ? 1 : rest + (1 - rest) * 0.75 * lit)))
                        if lit > 0.05 { ctx.fill(path, with: .color(theme.segmentLead.opacity(0.22 * lit))) }
                        r0 = r1
                    }
                    if newest, r0 > inner + 1 { ctx.stroke(sector(inner + 1, r0, a0, a1), with: .color(theme.segmentLead.opacity(0.95)), lineWidth: 1) }
                }
                if sweeping {
                    let edge = head * .pi / 180
                    var beam = Path(); beam.move(to: CGPoint(x: c.x + cos(edge) * inner, y: c.y + sin(edge) * inner))
                    beam.addLine(to: CGPoint(x: c.x + cos(edge) * (outer + 2), y: c.y + sin(edge) * (outer + 2)))
                    ctx.stroke(beam, with: .color(theme.segmentLead.opacity(0.9)), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
                }
                if let average = reading.average, average > 0 {
                    ctx.stroke(ring(radius(average)), with: .color(theme.segmentLead), style: StrokeStyle(lineWidth: 1.1, dash: [3, 2.5]))
                }
                let disc = inner - 3
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - disc, y: c.y - disc, width: 2 * disc, height: 2 * disc)), with: .color(theme.card))
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - disc, y: c.y - disc, width: 2 * disc, height: 2 * disc)), with: .color(theme.grid), lineWidth: 0.8)
                var now = Path(); now.addLines([CGPoint(x: c.x - 3.5, y: c.y - outer - 6.5), CGPoint(x: c.x + 3.5, y: c.y - outer - 6.5), CGPoint(x: c.x, y: c.y - outer - 1)]); now.closeSubpath()
                ctx.fill(now, with: .color(theme.red.opacity(sweeping ? 0.65 + 0.35 * sin(date.timeIntervalSinceReferenceDate * 3.2) : 1)))
            }
            VStack(spacing: 1) {
                Text(L.t("Average", "평균")).font(.system(size: 10.5)).foregroundStyle(theme.dim)
                SegmentDigits(value: reading.average, height: 29)
                Text(reading.average == nil ? L.t("Checking", "확인 중") : L.t("tokens/h", "tokens/시간")).font(.system(size: 10.5)).foregroundStyle(theme.muted)
            }
        }
    }
}

private struct Slanted: Shape {
    func path(in r: CGRect) -> Path {
        let s = min(r.width * 0.4, r.height * 0.3)
        return Path { p in
            p.addLines([CGPoint(x: r.minX + s, y: r.minY), CGPoint(x: r.maxX, y: r.minY), CGPoint(x: r.maxX - s, y: r.maxY), CGPoint(x: r.minX, y: r.maxY)])
            p.closeSubpath()
        }
    }
}

/// The weekly % across the period, ending at the current report.
private struct WeeklySpark: View {
    var points: [(t: Double, pct: Double)]
    var start: Double
    var end: Double
    var color: Color
    var faded: Bool
    var body: some View {
        Canvas { ctx, size in
            guard let first = points.first, let last = points.last, end > start else { return }
            let plot = CGRect(x: 0, y: 5, width: size.width - 6, height: size.height - 10)
            var lo = points.map(\.pct).min() ?? 0, hi = points.map(\.pct).max() ?? 0
            if hi - lo < 2 { let mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1 }
            let pad = (hi - lo) * 0.15; lo -= pad; hi += pad
            if lo < 0 { hi -= lo; lo = 0 }
            func point(_ p: (t: Double, pct: Double)) -> CGPoint {
                CGPoint(x: plot.minX + CGFloat((max(start, p.t) - start) / (end - start)) * plot.width, y: plot.maxY - CGFloat((p.pct - lo) / (hi - lo)) * plot.height)
            }
            var line = Path()
            for (i, p) in points.enumerated() { i == 0 ? line.move(to: point(p)) : line.addLine(to: point(p)) }
            var area = line
            area.addLine(to: CGPoint(x: point(last).x, y: plot.maxY)); area.addLine(to: CGPoint(x: point(first).x, y: plot.maxY)); area.closeSubpath()
            ctx.fill(area, with: .linearGradient(Gradient(colors: [color.opacity(0.3), color.opacity(0.02)]), startPoint: CGPoint(x: 0, y: plot.minY), endPoint: CGPoint(x: 0, y: plot.maxY)))
            ctx.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round))
            let tip = point(last)
            ctx.fill(Path(ellipseIn: CGRect(x: tip.x - 4.5, y: tip.y - 4.5, width: 9, height: 9)), with: .color(color.opacity(0.25)))
            ctx.fill(Path(ellipseIn: CGRect(x: tip.x - 2.4, y: tip.y - 2.4, width: 4.8, height: 4.8)), with: .color(color))
        }
        .opacity(faded ? 0.5 : 1)
        .accessibilityHidden(true)
    }
}

/// A small speedometer that leads each session row: current tokens per hour on one shared scale,
/// with the hub showing the state.
private struct MiniGauge: View {
    var value: Double?
    var scale: Double
    var color: Color
    var hub: Color
    var theme: QuickTheme
    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height - 1.5), r = min(size.width / 2 - 1.5, size.height - 3)
            func arc(_ to: Double) -> Path { Path { p in p.addArc(center: c, radius: r, startAngle: .degrees(180), endAngle: .degrees(to), clockwise: false) } }
            ctx.stroke(arc(360), with: .color(theme.line), style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
            let pace = value ?? 0, angle = 180 + 180 * min(1, max(0, pace / max(scale, 0.0001)))
            if pace > 0 { ctx.stroke(arc(angle), with: .color(color), style: StrokeStyle(lineWidth: 2.6, lineCap: .round)) }
            if value != nil {
                let tip = CGPoint(x: c.x + cos(angle * .pi / 180) * (r - 1.5), y: c.y + sin(angle * .pi / 180) * (r - 1.5))
                ctx.stroke(Path { p in p.move(to: c); p.addLine(to: tip) }, with: .color(pace > 0 ? theme.ink : theme.dim), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
            }
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 2, y: c.y - 2, width: 4, height: 4)), with: .color(hub))
        }
        .frame(width: 20, height: 12)
        .accessibilityHidden(true)
    }
}

struct QuickView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.colorScheme) private var scheme
    @AppStorage("weeklyTokensMode") private var tokensChosen = false
    /// Weekly % needs the collector's estimates; a collector that does not send them shows tokens.
    private var tokensMode: Bool { tokensChosen || !model.sessions.contains(where: \.hasEstimate) }
    @State private var detail: Session?
    @State private var request: ControlRequest?
    private static let paceColumn: CGFloat = 54, valueColumn: CGFloat = 70
    private var theme: QuickTheme { QuickTheme(light: scheme == .light) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                ConnectionNotice().padding(.horizontal, 14).padding(.bottom, 10)
                periodPicker.padding(.horizontal, 14).padding(.bottom, 10)
                tokenSection.padding(.horizontal, 16)
                weeklyCard.padding(.horizontal, 14).padding(.top, 14)
                resources.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 10)
                sessionList
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        // The header stays at the top like a navigation bar; content scrolling under it and the
        // status bar fades behind the system scroll edge effect instead of showing through.
        .safeAreaBar(edge: .top) { header.background(theme.background.opacity(0.01)) }
        .scrollEdgeEffectStyle(.hard, for: .top)
        .background(theme.background.ignoresSafeArea())
        .foregroundStyle(theme.ink)
        .refreshable { if model.connection != .demo { model.connect() } }
        .sheet(item: $detail) { SessionDetail(session: $0) }
        .controlConfirmation($request)
    }

    // MARK: Header and period
    private var connectionLabel: String {
        let name = model.devices.isEmpty ? L.t("No computer", "컴퓨터 없음") : model.scopeName
        return switch model.connection {
        case .live: L.t("Live · ", "실시간 · ") + name
        case .demo: L.t("Demo · ", "데모 · ") + name
        case .connecting: L.t("Connecting", "연결 중")
        case .offline: L.t("Offline · last record", "오프라인 · 마지막 기록")
        case .restricted: L.t("Access required", "권한 필요")
        case .signedOut: L.t("Sign-in required", "로그인 필요")
        }
    }
    private var fresh: Bool { model.connection == .live || model.connection == .demo }
    /// The newest report time, read out with the connection state.
    private var lastReport: String {
        guard let last = model.devices.map(\.received).max(), last > 0 else { return "" }
        let date = Date(timeIntervalSince1970: last / 1000)
        return L.t("Last report ", "마지막 보고 ") + date.formatted(Date.FormatStyle(date: .omitted, time: .standard).locale(L.locale))
    }

    /// Brand on the left; on the right three glass buttons: the computers in view (with the
    /// connection state), display and language, and more.
    private var header: some View {
        @Bindable var model = model
        return HStack(spacing: 8) {
            Image(systemName: "waveform.path").font(.system(size: 17, weight: .semibold)).foregroundStyle(theme.accent)
            Text("1top").font(.system(size: 17, weight: .semibold)).fixedSize()
            Spacer(minLength: 4)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    Menu {
                        ComputerPicker()
                        if !lastReport.isEmpty { Text(lastReport) }
                    } label: {
                        HStack(spacing: 6) {
                            Circle().fill(fresh ? theme.accent : theme.amber).frame(width: 6, height: 6)
                            Text(connectionLabel).font(.system(size: 11.5)).foregroundStyle(theme.muted).lineLimit(1)
                        }
                    }
                    .buttonStyle(.glass).controlSize(.small)
                    .accessibilityLabel(connectionLabel)
                    .accessibilityIdentifier("connection")
                    .accessibilityValue(lastReport)
                    Menu {
                        Section(L.t("Theme", "테마")) {
                            Picker(L.t("Theme", "테마"), selection: $model.appearance) {
                                ForEach(Appearance.allCases) { Text($0.label).tag($0) }
                            }
                            .pickerStyle(.inline)
                        }
                        Section(L.t("Language", "언어")) {
                            Picker(L.t("Language", "언어"), selection: $model.language) {
                                ForEach(Language.allCases) { Text($0.name).tag($0) }
                            }
                            .pickerStyle(.inline)
                        }
                    } label: {
                        Image(systemName: "circle.lefthalf.filled").font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                    .accessibilityLabel(L.t("Theme and language", "테마와 언어"))
                    .accessibilityIdentifier("display-menu")
                    .accessibilityValue(model.appearance.rawValue + " " + model.language.rawValue)
                    Menu {
                        Button(L.t("Reconnect now", "지금 다시 연결")) { model.connect() }.disabled(model.connection == .demo)
                        Button(tokensChosen ? L.t("Show sessions as weekly limit %", "세션을 주간 한도 %로 보기") : L.t("Show sessions as tokens", "세션을 토큰으로 보기")) { tokensChosen.toggle() }
                        if model.connection == .demo { Button(L.t("Leave demo", "데모 끝내기")) { model.leaveDemo() } }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                    .accessibilityLabel(L.t("More", "더 보기")).accessibilityIdentifier("more-menu")
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
    }

    private var periodPicker: some View {
        @Bindable var model = model
        return GlassSegments.periods($model.period)
    }

    // MARK: Tokens · average speed on the radar, split by model
    /// Every reporting computer's own period total, so sessions that ended still count.
    private var periodTotal: Double? { model.periodTokens }

    private var tokenSection: some View {
        let reading = SpeedReading(sessions: model.sessions, period: model.period, periodTotal: periodTotal, flow: model.flow), usage = modelSlices()
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(L.t("Token usage", "토큰 사용")).font(.system(size: 12.5, weight: .semibold))
                Text(L.t("Last \(model.period.label)", "최근 \(model.period.label)")).font(.system(size: 11.5)).foregroundStyle(theme.muted)
                Spacer()
            }
            HStack(alignment: .center, spacing: 16) {
                ScopeDial(reading: reading, period: model.period, theme: theme).frame(width: 182, height: 182)
                Group {
                    if usage.slices.isEmpty {
                        Text(reading.average == nil ? L.t("Checking usage", "사용량을 확인하고 있습니다") : L.t("No usage reported in this period", "이 기간에 보고된 사용이 없습니다"))
                            .font(.system(size: 11.5)).foregroundStyle(theme.muted)
                    } else {
                        modelLegend(usage.slices, total: usage.total)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private struct UsageSlice: Identifiable { var id: String; var name: String; var detail: String; var kind: String?; var value: Double; var shade: Double }

    // The period's tokens by AI model (tool colour), largest first; the rest folds into one.
    private func modelSlices() -> (slices: [UsageSlice], total: Double) {
        var byModel: [String: (kind: String, model: String, tokens: Double)] = [:]
        for s in model.sessions {
            guard let tokens = s.tokens(in: model.period), tokens > 0 else { continue }
            let name = Tool.model(s.model) ?? Tool.name(s.kind)
            byModel[s.kind + "|" + name, default: (s.kind, name, 0)].tokens += tokens
        }
        let rows = byModel.values.sorted { $0.tokens == $1.tokens ? $0.model < $1.model : $0.tokens > $1.tokens }
        let sessionsTotal = rows.reduce(0) { $0 + $1.tokens }, total = max(sessionsTotal, periodTotal ?? 0)
        let shown = rows.count <= 4 ? rows : Array(rows.prefix(3))
        var seen: [String: Int] = [:]
        var slices = shown.map { row -> UsageSlice in
            let index = seen[row.kind, default: 0]; seen[row.kind] = index + 1
            return UsageSlice(id: row.kind + "|" + row.model, name: row.model, detail: Tool.name(row.kind), kind: row.kind, value: row.tokens, shade: [1, 0.68, 0.46][min(index, 2)])
        }
        let rest = total - shown.reduce(0) { $0 + $1.tokens }, others = rows.count - shown.count
        if total > 0, rest > total * 0.005 {
            slices.append(UsageSlice(id: "__rest__", name: others > 0 ? L.t("Other models", "기타 모델") : L.t("Ended sessions", "종료된 세션"),
                                     detail: others > 0 ? L.t("\(others) more", "\(others)개") : L.t("Not in the list", "목록에 없는 세션"), kind: nil, value: rest, shade: 1))
        }
        return (slices, total)
    }
    private func sliceColor(_ slice: UsageSlice) -> Color { slice.kind.map { Tool.color($0).opacity(slice.shade) } ?? theme.dim }
    private func share(_ value: Double, of total: Double) -> String {
        guard total > 0 else { return "—" }
        let p = value / total * 100
        return p < 1 ? "<1%" : "\(Int(p.rounded()))%"
    }

    private func modelLegend(_ slices: [UsageSlice], total: Double) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L.t("By model", "모델별")).font(.system(size: 10.5)).foregroundStyle(theme.muted)
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(slices) { slice in
                        Slanted().fill(sliceColor(slice)).frame(width: max(3, (geo.size.width - CGFloat(slices.count - 1) * 2) * CGFloat(slice.value / total)))
                    }
                }
            }.frame(height: 8)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(slices) { slice in
                    HStack(alignment: .top, spacing: 7) {
                        Circle().fill(sliceColor(slice)).frame(width: 6, height: 6).padding(.top, 4)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(slice.name).font(.system(size: 11.5, weight: .semibold)).lineLimit(1)
                            Text(slice.detail).font(.system(size: 10.5)).foregroundStyle(theme.muted).lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        Text(share(slice.value, of: total)).font(.system(size: 11.5, weight: .semibold)).monospacedDigit()
                    }
                }
            }
        }
    }

    // MARK: Weekly limits · compact tiles
    private var weeklyCard: some View {
        let rows = model.quotas
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(L.t("Weekly limits", "주간 한도")).font(.system(size: 12.5, weight: .semibold))
                Text(L.t("100% per account", "계정별 100%")).font(.system(size: 11.5)).foregroundStyle(theme.muted)
                Spacer()
            }.padding(.horizontal, 2)
            if rows.isEmpty {
                Text(L.t("Connect subscription accounts in 1top on your computer.", "컴퓨터의 1top에서 구독 계정을 연결하면 표시됩니다.")).font(.system(size: 11.5)).foregroundStyle(theme.muted)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(rows.prefix(4)) { weeklyTile($0) }
                }
            }
        }
    }

    private func weeklyTile(_ q: Quota) -> some View {
        let w = q.weeklyWindow, color = Tool.color(q.kind), rate = fresh && !q.stale ? q.weekly?[model.period.rawValue]?.burnPerHour : nil
        let end = model.reportEnd, start = end - model.period.seconds
        let points = sparkPoints(q.usagePoints, start: start, end: end)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Circle().fill(color).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                Text(Tool.name(q.kind)).font(.system(size: 12.5, weight: .semibold)).lineLimit(1).fixedSize()
                Spacer(minLength: 4)
                Text(Format.percent(w?.pct)).font(.system(size: 17, weight: .semibold)).monospacedDigit().fixedSize()
                    .foregroundStyle(q.stale ? theme.muted : theme.ink)
            }
            // Fixed slots keep the small trend line in the same place in every tile.
            HStack(spacing: 6) {
                Text(q.handle).font(.system(size: 10.5)).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.middle)
                    .frame(width: 78, alignment: .leading)
                WeeklySpark(points: points, start: start, end: end, color: color, faded: q.stale).frame(maxWidth: .infinity).frame(height: 14)
                Text(q.stale ? q.staleLabel : rate.map { Format.percent($0) + L.t("/h", "/시간") } ?? L.t("Collecting", "수집 중"))
                    .font(.system(size: 10.5, weight: .medium)).foregroundStyle(q.stale ? theme.amber : color).lineLimit(1).minimumScaleFactor(0.8)
                    .frame(width: 62, alignment: .trailing)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity)
        .background(color.opacity(theme.light ? 0.08 : 0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Resources
    /// CPU and memory per computer; one computer needs no name.
    private var resources: some View {
        let list = model.reportingDevices
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(list) { device in
                VStack(alignment: .leading, spacing: 3) {
                    if list.count > 1 {
                        HStack(spacing: 5) {
                            Circle().fill(model.isFresh(device) ? theme.accent : theme.amber).frame(width: 5, height: 5)
                            Text(device.name).font(.system(size: 11.5, weight: .semibold)).lineLimit(1)
                            if !model.isFresh(device) {
                                Text(L.t("Last report ", "마지막 보고 ") + L.time(device.receivedDate)).font(.system(size: 10.5)).foregroundStyle(theme.amber)
                            }
                        }
                    }
                    HStack(spacing: 18) {
                        resource("CPU", value: device.snapshot?.host?.cpu)
                        resource(L.t("Memory", "메모리"), value: device.snapshot?.host?.memoryPercent)
                    }
                }
            }
        }
    }
    private func resource(_ label: String, value: Double?) -> some View {
        HStack(spacing: 7) {
            Text(label).foregroundStyle(theme.muted)
            GeometryReader { geo in
                Capsule().fill(theme.line).overlay(alignment: .leading) {
                    Capsule().fill((value ?? 0) > 90 ? theme.amber : theme.segmentOn).frame(width: geo.size.width * min(100, max(0, value ?? 0)) / 100)
                }
            }.frame(height: 3)
            Text(Format.percent(value)).monospacedDigit().frame(width: 40, alignment: .trailing)
        }.font(.system(size: 11.5))
    }

    // MARK: Sessions
    private func pace(_ g: SessionGroup) -> Double? {
        guard fresh else { return nil }
        return tokensMode ? g.rate.map { $0 * 3600 } : g.pace(in: model.period)
    }

    private var sessionList: some View {
        let rows = model.groups
        let paceScale = niceMaximum(max(1, rows.compactMap(pace).max() ?? 0))
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(L.t("Sessions", "세션")).font(.system(size: 12.5, weight: .semibold))
                Text("\(rows.count)").font(.system(size: 11.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.muted)
                    .padding(.horizontal, 6).frame(height: 18).background(theme.raised, in: RoundedRectangle(cornerRadius: 5))
                HStack(spacing: 5) {
                    if fresh { StatusGlyph(status: "working") } else { Circle().fill(theme.amber).frame(width: 6, height: 6) }
                    Text(fresh ? L.t("Working \(rows.filter(\.isWorking).count)", "작업 중 \(rows.filter(\.isWorking).count)") : L.t("Last record", "마지막 기록"))
                }.font(.system(size: 11.5, weight: .medium)).foregroundStyle(fresh ? theme.ink : theme.amber).padding(.leading, 4)
                Spacer(minLength: 4)
                Text(tokensMode ? L.t("Tokens", "토큰") : L.t("Weekly limit used", "주간 한도 사용량")).font(.system(size: 10.5)).foregroundStyle(theme.muted)
                    .fixedSize().frame(width: Self.valueColumn, alignment: .trailing)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
            if rows.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "terminal").font(.system(size: 22)).foregroundStyle(theme.muted)
                    Text(L.t("No AI sessions detected", "감지된 AI 세션이 없습니다")).font(.system(size: 13))
                }.frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { group in
                        Button { detail = group.root } label: { sessionRow(group, paceScale: paceScale).contentShape(Rectangle()) }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("session-" + group.root.id)
                            .contextMenu { SessionActions(session: group.root, open: { detail = group.root }, request: $request) }
                        Rectangle().fill(theme.line.opacity(0.7)).frame(height: 1).padding(.leading, 16 + Self.paceColumn + 9)
                    }
                }
            }
        }
    }

    private func sessionRow(_ g: SessionGroup, paceScale: Double) -> some View {
        let s = g.root, burn = pace(g)
        let hub = g.isWorking ? theme.ink : s.status == "waiting" ? theme.amber : theme.dim
        let tokens = g.tokens(in: model.period)
        let value = tokensMode ? Format.tokens(tokens) : g.estimate(in: model.period).map { "≈" + Format.percent($0) } ?? (tokens == 0 ? "0%" : "—")
        return HStack(alignment: .center, spacing: 9) {
            VStack(spacing: 2) {
                MiniGauge(value: burn, scale: paceScale, color: Tool.color(s.kind), hub: hub, theme: theme)
                Text(burn.map { (tokensMode ? Format.tokens($0) : Format.percent($0)) + L.t("/h", "/시간") } ?? "—")
                    .font(.system(size: 9.5)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.85)
                    .foregroundStyle(burn == nil ? theme.dim : burn == 0 ? theme.muted : theme.ink)
            }
            .frame(width: Self.paceColumn)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    StatusGlyph(status: g.isWorking ? "working" : s.status)
                    Text(s.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    if g.childCount > 0 {
                        Text(L.t("+\(g.childCount) sub", "하위 \(g.childCount)")).font(.system(size: 10.5)).foregroundStyle(theme.muted).padding(.horizontal, 5).frame(height: 16)
                            .overlay(Capsule().stroke(theme.line)).fixedSize()
                    }
                }
                HStack(spacing: 4) {
                    Text(Tool.name(s.kind)).foregroundStyle(Tool.color(s.kind))
                    if let project = s.displayProject { Text("· " + project).foregroundStyle(theme.muted) }
                    if model.reportingDevices.count > 1, let device = model.device(for: s) { Text("· " + device.name).foregroundStyle(theme.dim) }
                }.font(.system(size: 11.5)).lineLimit(1)
            }.frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            Text(value).font(.system(size: 13, weight: .semibold)).monospacedDigit().lineLimit(1)
                .foregroundStyle(value == "—" ? theme.dim : theme.ink)
                .frame(width: Self.valueColumn, alignment: .trailing)
        }
        .padding(.horizontal, 16).frame(height: 50)
        .accessibilityElement(children: .combine)
    }

    /// Weekly % reports inside the period plus the one before it, so the line starts at the edge.
    private func sparkPoints(_ source: [[Double]]?, start: Double, end: Double) -> [(t: Double, pct: Double)] {
        let points = (source ?? []).compactMap { p -> (t: Double, pct: Double)? in
            guard p.count >= 2, p[0].isFinite, p[0] <= end, p[1].isFinite, p[1] >= 0, p[1] <= 100 else { return nil }
            return (p[0], p[1])
        }.sorted { $0.t < $1.t }
        guard let first = points.firstIndex(where: { $0.t >= start }) else { return [] }
        return Array(points[max(0, first - 1)...])
    }

    private func niceMaximum(_ value: Double) -> Double {
        guard value > 0 else { return 1 }
        let p = pow(10, floor(log10(value)))
        return ([1, 2, 5, 10].map { $0 * p }.first { $0 >= value }) ?? 10 * p
    }
}
