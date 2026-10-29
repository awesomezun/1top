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
    var segmentOn: Color { pick((116, 212, 177), (31, 138, 105)) }
    var segmentLead: Color { pick((196, 245, 226), (15, 90, 68)) }
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

    init(sessions: [Session], period: Period, periodTotal: Double?) {
        let seconds = period.seconds
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
        let sum = sessions.compactMap { $0.tokens(in: period) }
        let total = periodTotal ?? (sum.isEmpty ? nil : sum.reduce(0, +))
        average = total.map { $0 / seconds * 3600 }
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
            .accessibilityLabel("최근 \(period.label) 평균 토큰 사용 속도 시간당 \(Format.tokens(reading.average)) tokens")
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
                Text("평균").font(.system(size: 10.5)).foregroundStyle(theme.dim)
                SegmentDigits(value: reading.average, height: 29)
                Text(reading.average == nil ? "확인 중" : "tokens/시간").font(.system(size: 10.5)).foregroundStyle(theme.muted)
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
    private static let paceColumn: CGFloat = 54, valueColumn: CGFloat = 70
    private var theme: QuickTheme { QuickTheme(light: scheme == .light) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                periodPicker.padding(.horizontal, 14).padding(.bottom, 10)
                tokenSection.padding(.horizontal, 16)
                weeklyCard.padding(.horizontal, 14).padding(.top, 14)
                resources.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 10)
                sessionList
            }
            .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .background(theme.background.ignoresSafeArea())
        .foregroundStyle(theme.ink)
        .refreshable { if model.connection != .demo { model.connect() } }
    }

    // MARK: Header and period
    private var connectionLabel: String {
        let name = model.device?.name ?? "컴퓨터 없음"
        return switch model.connection {
        case .live: "실시간 · " + name
        case .demo: "데모 · " + name
        case .connecting: "연결 중"
        case .offline: "오프라인 · 마지막 기록"
        case .restricted: "권한 필요"
        case .signedOut: "로그인 필요"
        }
    }
    private var fresh: Bool { model.connection == .live || model.connection == .demo }

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform.path").font(.system(size: 17, weight: .semibold)).foregroundStyle(theme.accent)
            Text("1top").font(.system(size: 17, weight: .semibold))
            Spacer()
            HStack(spacing: 6) {
                Circle().fill(fresh ? theme.accent : theme.amber).frame(width: 6, height: 6)
                Text(connectionLabel).font(.system(size: 11.5)).foregroundStyle(theme.muted).lineLimit(1)
            }.padding(.horizontal, 9).frame(height: 24).overlay(Capsule().stroke(theme.line))
            Menu {
                if model.devices.count > 1 {
                    Picker("컴퓨터", selection: Binding(get: { model.device?.id ?? "" }, set: { model.selectedDeviceID = $0 })) {
                        ForEach(model.devices) { Text($0.name + ($0.online ? "" : " · 오프라인")).tag($0.id) }
                    }
                }
                Button("지금 새로고침") { model.connect() }.disabled(model.connection == .demo)
                if model.connection == .demo { Button("데모 끝내기") { model.leaveDemo() } }
            } label: { Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)).frame(width: 30, height: 30) }
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
    }

    private var periodPicker: some View {
        HStack(spacing: 2) {
            ForEach(Period.allCases) { period in
                let selected = model.period == period
                Button { model.period = period } label: {
                    Text(period.label).font(.system(size: 12.5, weight: selected ? .semibold : .medium)).frame(maxWidth: .infinity).frame(height: 28)
                        .foregroundStyle(selected ? theme.ink : theme.muted)
                        .background(selected ? theme.raised : Color.clear, in: RoundedRectangle(cornerRadius: 6))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("최근 \(period.label)").accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(3).background(theme.card, in: RoundedRectangle(cornerRadius: 9)).overlay(RoundedRectangle(cornerRadius: 9).stroke(theme.line))
    }

    // MARK: Tokens · average speed on the radar, split by model
    private var periodTotal: Double? {
        model.device?.snapshot?.periods?.first { $0.key == model.period.rawValue }?.tokens.map { $0.reduce(0, +) }
    }

    private var tokenSection: some View {
        let reading = SpeedReading(sessions: model.sessions, period: model.period, periodTotal: periodTotal), usage = modelSlices()
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("토큰 사용").font(.system(size: 12.5, weight: .semibold))
                Text("최근 \(model.period.label)").font(.system(size: 11.5)).foregroundStyle(theme.muted)
                Spacer()
            }
            HStack(alignment: .center, spacing: 16) {
                ScopeDial(reading: reading, period: model.period, theme: theme).frame(width: 182, height: 182)
                Group {
                    if usage.slices.isEmpty {
                        Text(reading.average == nil ? "사용량을 확인하고 있습니다" : "이 기간에 보고된 사용이 없습니다")
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
            slices.append(UsageSlice(id: "__rest__", name: others > 0 ? "기타 모델" : "종료된 세션",
                                     detail: others > 0 ? "\(others)개" : "목록에 없는 세션", kind: nil, value: rest, shade: 1))
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
            Text("모델별").font(.system(size: 10.5)).foregroundStyle(theme.muted)
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
                Text("주간 한도").font(.system(size: 12.5, weight: .semibold))
                Text("계정별 100%").font(.system(size: 11.5)).foregroundStyle(theme.muted)
                Spacer()
            }.padding(.horizontal, 2)
            if rows.isEmpty {
                Text("컴퓨터의 1top에서 구독 계정을 연결하면 표시됩니다.").font(.system(size: 11.5)).foregroundStyle(theme.muted)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(rows.prefix(4)) { weeklyTile($0) }
                }
            }
        }
    }

    private func weeklyTile(_ q: Quota) -> some View {
        let w = q.weekly, color = Tool.color(q.kind)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Circle().fill(color).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                Text(Tool.name(q.kind)).font(.system(size: 12.5, weight: .semibold)).lineLimit(1).fixedSize()
                Spacer(minLength: 4)
                Text(Format.percent(w?.pct)).font(.system(size: 17, weight: .semibold)).monospacedDigit().fixedSize()
                    .foregroundStyle(q.stale ? theme.muted : theme.ink)
            }
            HStack(spacing: 6) {
                Text(q.handle).font(.system(size: 10.5)).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                Text(q.stale ? "마지막 보고" : Format.reset(w?.reset).replacingOccurrences(of: " 후 초기화", with: " 후"))
                    .font(.system(size: 10.5, weight: .medium)).foregroundStyle(q.stale ? theme.amber : color).lineLimit(1)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8).frame(maxWidth: .infinity)
        .background(color.opacity(theme.light ? 0.08 : 0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Resources
    private var resources: some View {
        HStack(spacing: 18) {
            resource("CPU", value: model.device?.snapshot?.host?.cpu)
            resource("메모리", value: model.device?.snapshot?.host?.memoryPercent)
        }
    }
    private func resource(_ label: String, value: Double?) -> some View {
        HStack(spacing: 7) {
            Text(label).foregroundStyle(theme.muted)
            GeometryReader { geo in
                Capsule().fill(theme.line).overlay(alignment: .leading) {
                    Capsule().fill((value ?? 0) > 90 ? theme.amber : theme.accent).frame(width: geo.size.width * min(100, max(0, value ?? 0)) / 100)
                }
            }.frame(height: 3)
            Text(Format.percent(value)).monospacedDigit().frame(width: 40, alignment: .trailing)
        }.font(.system(size: 11.5))
    }

    // MARK: Sessions
    private var sessionList: some View {
        let rows = model.orderedSessions
        let paces = rows.compactMap { s in s.rate.flatMap { $0.isFinite && $0 >= 0 ? $0 * 3600 : nil } }
        let paceScale = niceMaximum(max(1, paces.max() ?? 0))
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("세션").font(.system(size: 12.5, weight: .semibold))
                Text("\(rows.count)").font(.system(size: 11.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.muted)
                    .padding(.horizontal, 6).frame(height: 18).background(theme.raised, in: RoundedRectangle(cornerRadius: 5))
                HStack(spacing: 5) {
                    Circle().fill(fresh ? theme.accent : theme.amber).frame(width: 6, height: 6)
                    Text(fresh ? "작업 중 \(rows.filter(\.isWorking).count)" : "마지막 기록")
                }.font(.system(size: 11.5, weight: .medium)).foregroundStyle(fresh ? theme.accent : theme.amber).padding(.leading, 4)
                Spacer(minLength: 4)
                Text("토큰").font(.system(size: 10.5)).foregroundStyle(theme.muted).frame(width: Self.valueColumn, alignment: .trailing)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
            if rows.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "terminal").font(.system(size: 22)).foregroundStyle(theme.muted)
                    Text("감지된 AI 세션이 없습니다").font(.system(size: 13))
                }.frame(maxWidth: .infinity).padding(.vertical, 32)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { session in
                        sessionRow(session, paceScale: paceScale)
                        Rectangle().fill(theme.line.opacity(0.7)).frame(height: 1).padding(.leading, 16 + Self.paceColumn + 9)
                    }
                }
            }
        }
    }

    private func sessionRow(_ s: Session, paceScale: Double) -> some View {
        let pace = fresh ? s.rate.flatMap { $0.isFinite && $0 >= 0 ? $0 * 3600 : nil } : nil
        let hub = s.isWorking ? theme.accent : s.status == "waiting" ? theme.amber : theme.dim
        let value = s.tokens(in: model.period)
        return HStack(alignment: .center, spacing: 9) {
            VStack(spacing: 2) {
                MiniGauge(value: pace, scale: paceScale, color: Tool.color(s.kind), hub: hub, theme: theme)
                Text(pace.map { Format.tokens($0) + "/시간" } ?? "—").font(.system(size: 9.5)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.85)
                    .foregroundStyle(pace == nil ? theme.dim : pace == 0 ? theme.muted : theme.ink)
            }
            .frame(width: Self.paceColumn)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                HStack(spacing: 4) {
                    Text(Tool.name(s.kind)).foregroundStyle(Tool.color(s.kind))
                    if let project = s.displayProject { Text("· " + project).foregroundStyle(theme.muted) }
                }.font(.system(size: 11.5)).lineLimit(1)
            }.frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            Text(Format.tokens(value)).font(.system(size: 13, weight: .semibold)).monospacedDigit().lineLimit(1)
                .foregroundStyle(value == nil ? theme.dim : theme.ink)
                .frame(width: Self.valueColumn, alignment: .trailing)
        }
        .padding(.horizontal, 16).frame(height: 50)
        .accessibilityElement(children: .combine)
    }

    private func niceMaximum(_ value: Double) -> Double {
        guard value > 0 else { return 1 }
        let p = pow(10, floor(log10(value)))
        return ([1, 2, 5, 10].map { $0 * p }.first { $0 >= value }) ?? 10 * p
    }
}
