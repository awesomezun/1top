import AppKit
import SwiftUI

// Quick view for the menu bar. The period picker governs every number below it:
// a token card (average speed on the scope, usage by session), weekly limits with
// their trend over the period, and the session list.
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
    // Readouts, meters and the working state wear a yellow-green LCD tone so they never read as Codex's teal.
    var segmentOn: Color { pick((157, 255, 60), (106, 168, 0)) }
    var segmentLead: Color { pick((226, 255, 196), (61, 99, 0)) }
    var segmentOff: Color { pick((29, 35, 39), (238, 241, 243)) }
    var grid: Color { pick((43, 50, 56), (211, 218, 222)) }
    var amber: Color { pick((233, 178, 92), (154, 100, 16)) }
    var red: Color { pick((255, 100, 80), (207, 67, 52)) }
}

// Sizes for the quick view. Text uses named roles like the dashboard's type tokens, and every size,
// space and stroke follows the app zoom (보기 › 확대·축소). The panel is laid out again at the new
// size rather than stretched, so text, digits and charts stay sharp.
struct QuickMetrics {
    enum Role: Double {
        case tiny = 9.5, caption = 10.5, label = 11.5, body = 12.5, title = 13, figure = 17, display = 22
    }
    var zoom: CGFloat
    func callAsFunction(_ value: CGFloat) -> CGFloat { value * zoom }
    func font(_ role: Role, _ weight: Font.Weight = .regular) -> Font { .system(size: CGFloat(role.rawValue) * zoom, weight: weight) }
}

private let periodSeconds: [String: Double] = ["10m": 600, "30m": 1800, "1h": 3600, "5h": 18000, "12h": 43200, "24h": 86400]
private let toolOrder = ["Claude", "Codex", "GLM", "Antigravity", "Aside"]
private func toolName(_ kind: String) -> String {
    kind == "Claude" ? "Claude Code" : kind == "Antigravity" ? "Agy CLI" : kind == "Aside" ? "Aside" : kind
}

// Speed is the selected period's average in tokens per hour: period total ÷ period length × 3600,
// like the dashboard instrument. The ring shows the same unit per bin across the period.
private struct SpeedReading {
    struct Bin { var total: Double; var byKind: [(String, Double)] }
    var average: Double?
    var bins: [Bin]
    var scale: Double { DesktopUsageTrend.niceMaximum(max(average ?? 0, bins.map(\.total).max() ?? 0)) }
    init(model: DashboardModel) {
        let fresh = model.fresh, end = model.snapshot?.updated ?? model.now.timeIntervalSince1970
        let seconds = periodSeconds[model.selectedPeriod] ?? 3600
        average = fresh ? model.periodTokens.map { $0 / seconds * 3600 } : nil
        let trend = DesktopUsageTrend(events: model.snapshot?.events, period: model.selectedPeriod, end: end)
        let binSeconds = trend.bins.first.map { $0.end - $0.start } ?? 60, order = trend.series
        bins = fresh && trend.reported ? trend.bins.map { bin in
            Bin(total: bin.tokens / binSeconds * 3600, byKind: order.map { ($0, (bin.tokensByKind[$0] ?? 0) / binSeconds * 3600) })
        } : []
    }
}

// Whole numbers on three digit places with the unit letter, like the dashboard instrument.
private func segmentReading(_ value: Double?) -> (digits: [Character], unit: String) {
    guard let value, value.isFinite, value >= 0 else { return (["-", "-", "-"], "") }
    if value < 0.5 { return ([" ", " ", "0"], "") }
    func unit(_ v: Double) -> (Double, String) { v >= 1e9 ? (1e9, "B") : v >= 1e6 ? (1e6, "M") : v >= 1e3 ? (1e3, "k") : (1, "") }
    var (divisor, suffix) = unit(value)
    var whole = (value / divisor).rounded()
    if whole >= 1000 && suffix != "B" { (divisor, suffix) = unit(whole * divisor); whole = (value / divisor).rounded() }
    let text = String(Int(min(999, whole)))
    return (Array(String(repeating: " ", count: max(0, 3 - text.count)) + text), suffix)
}
private func shortNumber(_ value: Double?) -> String {
    guard let value, value.isFinite, value >= 0 else { return "—" }
    if value < 0.5 { return "0" }
    let (divisor, suffix): (Double, String) = value >= 1e9 ? (1e9, "B") : value >= 1e6 ? (1e6, "M") : value >= 1e3 ? (1e3, "k") : (1, "")
    let x = value / divisor
    // Trim trailing zeros only after a decimal point: 200M stays 200M, 7.50M becomes 7.5M.
    let text = x >= 10 ? String(Int(x.rounded())) : String(format: "%.1f", x)
    return (text.contains(".") ? text.replacingOccurrences(of: #"\.?0+$"#, with: "", options: .regularExpression) : text) + suffix
}

// Percentages and speeds carry at most one decimal place: 21%, 4.1%, <0.1%.
private func pct1(_ value: Double?) -> String {
    guard let value, value.isFinite, value >= 0 else { return "—" }
    if value == 0 { return "0%" }
    if value < 0.05 { return "<0.1%" }
    let tenths = (value * 10).rounded() / 10
    return (tenths == tenths.rounded() ? String(Int(tenths)) : String(format: "%.1f", tenths)) + "%"
}
private func rate1(_ value: Double?, _ tr: QuickText = .current) -> String { value == nil ? "—" : pct1(value) + tr.perHour }

private struct SegmentDigits: View {
    var value: Double?
    var height: CGFloat
    var theme: QuickTheme
    var body: some View {
        let reading = segmentReading(value), w = height * 0.55, gap = height * 0.15
        let skew = height * tan(9 * .pi / 180), unitSize = height * 0.46
        let unitWidth = reading.unit.isEmpty ? 0 : gap + unitSize * 0.82
        let width = 3 * w + 2 * gap + unitWidth + skew
        Canvas { context, _ in
            var ctx = context
            ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: -tan(9 * .pi / 180), d: 1, tx: skew, ty: 0))
            let lit = value != nil
            for (index, character) in reading.digits.enumerated() {
                let on = SevenSegment.lit[character] ?? ""
                for key in "abcdefg" {
                    let path = SevenSegment.path(key, width: w, height: height).offsetBy(dx: CGFloat(index) * (w + gap), dy: 0)
                    ctx.fill(path, with: .color(on.contains(key) ? (lit ? theme.segmentOn : theme.segmentOn.opacity(0.4)) : theme.segmentOff))
                }
            }
            if !reading.unit.isEmpty {
                ctx.draw(Text(reading.unit).font(.system(size: unitSize, weight: .bold)).italic().foregroundColor(theme.segmentOn),
                         at: CGPoint(x: 3 * w + 3 * gap, y: height), anchor: .bottomLeading)
            }
        }
        .frame(width: width, height: height)
        .shadow(color: theme.light ? .clear : theme.segmentOn.opacity(0.6), radius: height * 0.055)
        .shadow(color: theme.light ? .clear : theme.segmentOn.opacity(0.3), radius: height * 0.17)
        .accessibilityHidden(true)
    }
}
private enum SevenSegment {
    static let lit: [Character: String] = ["0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd",
                                           "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": ""]
    static func path(_ key: Character, width w: CGFloat, height h: CGFloat) -> Path {
        let t = h * 0.115, ht = t / 2, g = h * 0.031
        func horizontal(_ y: CGFloat, _ x0: CGFloat, _ x1: CGFloat) -> Path {
            Path { p in p.addLines([CGPoint(x: x0, y: y), CGPoint(x: x0 + ht, y: y - ht), CGPoint(x: x1 - ht, y: y - ht),
                                    CGPoint(x: x1, y: y), CGPoint(x: x1 - ht, y: y + ht), CGPoint(x: x0 + ht, y: y + ht)]); p.closeSubpath() }
        }
        func vertical(_ x: CGFloat, _ y0: CGFloat, _ y1: CGFloat) -> Path {
            Path { p in p.addLines([CGPoint(x: x, y: y0), CGPoint(x: x + ht, y: y0 + ht), CGPoint(x: x + ht, y: y1 - ht),
                                    CGPoint(x: x, y: y1), CGPoint(x: x - ht, y: y1 - ht), CGPoint(x: x - ht, y: y0 + ht)]); p.closeSubpath() }
        }
        switch key {
        case "a": return horizontal(ht, ht + g, w - ht - g)
        case "g": return horizontal(h / 2, ht + g, w - ht - g)
        case "d": return horizontal(h - ht, ht + g, w - ht - g)
        case "f": return vertical(ht, ht + g, h / 2 - g)
        case "b": return vertical(w - ht, ht + g, h / 2 - g)
        case "e": return vertical(ht, h / 2 + g, h - ht - g)
        default: return vertical(w - ht, h / 2 + g, h - ht - g)
        }
    }
}

// 03 · Scope: one turn is the selected period, twelve o'clock is now; bars are stacked by tool and
// the dashed ring is the average shown in the centre.
private struct ScopeDial: View {
    var reading: SpeedReading
    var period: String
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var from: Double?
    @State private var to: Double?
    @State private var changed = Date.distantPast
    // When the panel opens or the period changes, the bars grow out from the centre.
    @State private var opened = Date.distantPast
    // Degrees left open before twelve o'clock, after the oldest bin.
    private static let opening = 12.0
    private func shown(at date: Date) -> Double? {
        guard let to else { return reading.average }
        guard let from, !reduceMotion else { return to }
        let progress = min(1, max(0, date.timeIntervalSince(changed) / 0.7))
        return from + (to - from) * (1 - pow(1 - progress, 3))
    }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { timeline in
            dial(at: timeline.date)
        }
        .onAppear { from = reading.average; to = reading.average; opened = Date() }
        .onChange(of: reading.average) { next in from = shown(at: Date()); to = next; changed = Date() }
        .onChange(of: period) { _ in opened = Date() }
    }
    private func dial(at date: Date) -> some View {
        let value = shown(at: date)
        return ZStack {
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2), outer = min(size.width, size.height) / 2 - m(7)
                // The busiest bin nearly reaches the outer ring, so the history uses the whole band.
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
                for k in 0..<12 {
                    let a = (-90 + 30 * Double(k)) * .pi / 180
                    var p = Path(); p.move(to: CGPoint(x: c.x + cos(a) * inner, y: c.y + sin(a) * inner))
                    p.addLine(to: CGPoint(x: c.x + cos(a) * outer, y: c.y + sin(a) * outer))
                    ctx.stroke(p, with: .color(theme.grid.opacity(0.7)), lineWidth: m(0.7))
                }
                // The newest bin sits just right of ▼ (now) and the ring goes back in time clockwise, ending
                // at the oldest bin before a small opening left of twelve o'clock, where the rings stay open.
                let end = 270 - Self.opening
                func ring(_ r: CGFloat) -> Path {
                    Path { p in p.addArc(center: c, radius: r, startAngle: .degrees(-90), endAngle: .degrees(end), clockwise: false) }
                }
                for f in [0.25, 0.5, 0.75, 1.0] {
                    ctx.stroke(ring(inner + (outer - inner) * f), with: .color(theme.grid),
                               style: StrokeStyle(lineWidth: m(0.8), dash: f == 1 ? [] : [m(1.5), m(3)]))
                }
                // The now line under ▼: the newest bin starts here.
                var nowLine = Path(); nowLine.move(to: CGPoint(x: c.x, y: c.y - inner)); nowLine.addLine(to: CGPoint(x: c.x, y: c.y - outer))
                ctx.stroke(nowLine, with: .color(theme.red.opacity(0.6)), lineWidth: m(1))
                // Radar beam: one turn every four and a half seconds while tokens flow, with a bright
                // leading edge and a fading wake behind it.
                let sweeping = !reduceMotion && (reading.average ?? 0) > 0
                let head = (date.timeIntervalSinceReferenceDate * 80).truncatingRemainder(dividingBy: 360) - 90
                if sweeping {
                    for j in 0..<12 {
                        ctx.fill(sector(inner, outer, head - Double(j + 1) * 4, head - Double(j) * 4),
                                 with: .color(theme.segmentOn.opacity(0.26 * pow(1 - Double(j) / 12, 1.6))))
                    }
                }
                // History in tool colours, stacked from the inside out like the dashboard's token flow.
                // Older bins rest dimmer, so the ring brightens toward now; each lights up as the beam passes.
                let bins = reading.bins, step = bins.isEmpty ? 0 : (360 - Self.opening) / Double(bins.count)
                for (i, bin) in bins.enumerated() where bin.total > 0 {
                    var r0 = inner + m(1), value = 0.0
                    let a0 = -90 + Double(bins.count - 1 - i) * step + 0.5, a1 = -90 + Double(bins.count - i) * step - 0.5
                    let behind = ((head - (a0 + a1) / 2).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
                    let newest = i == bins.count - 1, rest = bins.count > 1 ? 0.32 + 0.58 * Double(i) / Double(bins.count - 1) : 1
                    let lit = sweeping && !newest ? exp(-behind / 75) : 0
                    for (kind, part) in bin.byKind where part > 0 {
                        value += part
                        let r1 = radius(value)
                        guard r1 > r0 + 0.3 else { continue }
                        let path = sector(r0, r1, a0, a1)
                        ctx.fill(path, with: .color(AgentPalette.color(kind).opacity(newest ? 1 : rest + (1 - rest) * 0.75 * lit)))
                        if lit > 0.05 { ctx.fill(path, with: .color(theme.segmentLead.opacity(0.22 * lit))) }
                        r0 = r1
                    }
                    // The newest bin, next to ▼, carries a bright edge.
                    if newest, r0 > inner + m(1) {
                        ctx.stroke(sector(inner + m(1), r0, a0, a1), with: .color(theme.segmentLead.opacity(0.95)), lineWidth: m(1))
                    }
                }
                if sweeping {
                    let edge = head * .pi / 180
                    var beam = Path(); beam.move(to: CGPoint(x: c.x + cos(edge) * inner, y: c.y + sin(edge) * inner))
                    beam.addLine(to: CGPoint(x: c.x + cos(edge) * (outer + m(2)), y: c.y + sin(edge) * (outer + m(2))))
                    ctx.stroke(beam, with: .color(theme.segmentLead.opacity(0.9)), style: StrokeStyle(lineWidth: m(1.4), lineCap: .round))
                }
                if let average = reading.average, average > 0 {
                    ctx.stroke(ring(radius(average)), with: .color(theme.segmentLead), style: StrokeStyle(lineWidth: m(1.1), dash: [m(3), m(2.5)]))
                }
                let disc = inner - m(3)
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - disc, y: c.y - disc, width: 2 * disc, height: 2 * disc)), with: .color(theme.card))
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - disc, y: c.y - disc, width: 2 * disc, height: 2 * disc)), with: .color(theme.grid), lineWidth: m(0.8))
                var now = Path(); now.addLines([CGPoint(x: c.x - m(3.5), y: c.y - outer - m(6.5)), CGPoint(x: c.x + m(3.5), y: c.y - outer - m(6.5)), CGPoint(x: c.x, y: c.y - outer - m(1))]); now.closeSubpath()
                // The "now" marker breathes while tokens flow.
                ctx.fill(now, with: .color(theme.red.opacity(sweeping ? 0.65 + 0.35 * sin(date.timeIntervalSinceReferenceDate * 3.2) : 1)))
            }
            VStack(spacing: m(1)) {
                Text(tr("평균")).font(m.font(.caption)).foregroundStyle(theme.dim)
                SegmentDigits(value: value, height: m(29), theme: theme)
                Text(tr(reading.average == nil ? "확인 중" : "tokens/시간")).font(m.font(.caption)).foregroundStyle(theme.muted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(reading.average.map { tr.pick("\(period) 평균 토큰 사용 속도 시간당 \(DesktopFormat.number($0)) tokens", "\(period) average token rate, \(DesktopFormat.number($0)) tokens per hour", "\(period) 平均 Token 消耗速度，每小时 \(DesktopFormat.number($0)) tokens") } ?? tr("토큰 사용 속도 확인 중"))
        .help(tr.pick("가운데: \(period) 평균 토큰 사용 속도(tokens/시간)\n고리: 같은 기간의 구간별 속도를 AI 도구 색으로 쌓았습니다 · ▼(12시) 바로 오른쪽이 가장 최근 구간이고 시계 방향으로 갈수록 과거입니다 · 12시 왼쪽 빈틈 앞이 기간의 시작 · 밝을수록 최근 구간\n점선: 평균",
                       "Centre: \(period) average token rate (tokens/h)\nRing: the rate in each interval of the same period, stacked in AI tool colours · just right of ▼ (12 o’clock) is the latest interval, going back in time clockwise · the gap left of 12 o’clock is where the period starts · brighter is more recent\nDashed line: average",
                       "中心：\(period) 平均 Token 消耗速度（tokens/小时）\n圆环：同一时段各区间的速度，按 AI 工具颜色叠加 · ▼（12 点）右侧是最近的区间，顺时针越往后越早 · 12 点左侧空隙之前是时段的开始 · 越亮越近\n虚线：平均"))
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

// Weekly % reports inside the period, plus one point before it so the line starts at the edge.
// Prefers reconciled usage_points over raw history, like the dashboard's quotaTrend.
private func weeklyPoints(_ account: WeeklyUsage.Account?, start: Double, end: Double) -> [(t: Double, pct: Double)] {
    let source = account?.usage_points ?? account?.history ?? []
    let points = source.compactMap { p -> (t: Double, pct: Double)? in
        guard p.count >= 2, p[0].isFinite, p[0] <= end, p[1].isFinite, p[1] >= 0, p[1] <= 100 else { return nil }
        return (p[0], p[1])
    }.sorted { $0.t < $1.t }
    guard let first = points.firstIndex(where: { $0.t >= start }) else { return [] }
    var result: [(t: Double, pct: Double)] = []
    for point in points[max(0, first - 1)...] where result.last.map({ point.t > $0.t }) ?? true { result.append(point) }
    return result
}

// 04 · Trend line: the weekly % across the period, ending at the current report.
private struct WeeklySpark: View {
    var points: [(t: Double, pct: Double)]
    var start: Double
    var end: Double
    var color: Color
    var faded: Bool
    var m: QuickMetrics
    var body: some View {
        Canvas { ctx, size in
            guard let first = points.first, let last = points.last, end > start else { return }
            let plot = CGRect(x: 0, y: m(5), width: size.width - m(6), height: size.height - m(10))
            var lo = points.map(\.pct).min() ?? 0, hi = points.map(\.pct).max() ?? 0
            if hi - lo < 2 { let mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1 }
            let pad = (hi - lo) * 0.15; lo -= pad; hi += pad
            if lo < 0 { hi -= lo; lo = 0 }
            func point(_ p: (t: Double, pct: Double)) -> CGPoint {
                CGPoint(x: plot.minX + CGFloat((p.t - start) / (end - start)) * plot.width,
                        y: plot.maxY - CGFloat((p.pct - lo) / (hi - lo)) * plot.height)
            }
            var context = ctx
            context.clip(to: Path(CGRect(origin: .zero, size: size)))
            var line = Path()
            for (i, p) in points.enumerated() { i == 0 ? line.move(to: point(p)) : line.addLine(to: point(p)) }
            var area = line
            area.addLine(to: CGPoint(x: point(last).x, y: plot.maxY)); area.addLine(to: CGPoint(x: point(first).x, y: plot.maxY)); area.closeSubpath()
            context.fill(area, with: .linearGradient(Gradient(colors: [color.opacity(0.3), color.opacity(0.02)]),
                                                     startPoint: CGPoint(x: 0, y: plot.minY), endPoint: CGPoint(x: 0, y: plot.maxY)))
            context.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: m(1.4), lineCap: .round, lineJoin: .round))
            let tip = point(last)
            context.fill(Path(ellipseIn: CGRect(x: tip.x - m(4.5), y: tip.y - m(4.5), width: m(9), height: m(9))), with: .color(color.opacity(0.25)))
            context.fill(Path(ellipseIn: CGRect(x: tip.x - m(2.4), y: tip.y - m(2.4), width: m(4.8), height: m(4.8))), with: .color(color))
        }
        .opacity(faded ? 0.5 : 1)
        .accessibilityHidden(true)
    }
}

private func shortModel(_ s: DesktopSession) -> String {
    var name = (s.model ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if name.isEmpty { return toolName(s.kind) }
    name = name.replacingOccurrences(of: "[1m]", with: "", options: .caseInsensitive)
    if name.lowercased().hasPrefix("claude-") { name = String(name.dropFirst(7)) }
    if name.lowercased().hasPrefix("gpt-") { name = "GPT-" + name.dropFirst(4) }
    return name
}

// One slice per session of the period's tokens; the rest, including ended sessions, folds into one.
private struct UsageSlice: Identifiable {
    var id: String; var name: String; var detail: String; var kind: String?; var value: Double; var shade: Double
}
// A small speedometer that leads each session row: the arc and needle show the current pace on
// one scale shared by all rows, and the hub shows the state (working, needs a check, idle).
private struct MiniGauge: View {
    var value: Double?
    var scale: Double
    var color: Color
    var hub: Color
    var theme: QuickTheme
    var m: QuickMetrics
    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height - m(1.5)), r = min(size.width / 2 - m(1.5), size.height - m(3))
            func arc(_ to: Double) -> Path { Path { p in p.addArc(center: c, radius: r, startAngle: .degrees(180), endAngle: .degrees(to), clockwise: false) } }
            ctx.stroke(arc(360), with: .color(theme.line), style: StrokeStyle(lineWidth: m(2.6), lineCap: .round))
            let pace = value ?? 0, angle = 180 + 180 * min(1, max(0, pace / max(scale, 0.0001)))
            if pace > 0 { ctx.stroke(arc(angle), with: .color(color), style: StrokeStyle(lineWidth: m(2.6), lineCap: .round)) }
            if value != nil {
                let tip = CGPoint(x: c.x + cos(angle * .pi / 180) * (r - m(1.5)), y: c.y + sin(angle * .pi / 180) * (r - m(1.5)))
                ctx.stroke(Path { p in p.move(to: c); p.addLine(to: tip) }, with: .color(pace > 0 ? theme.ink : theme.dim),
                           style: StrokeStyle(lineWidth: m(1.2), lineCap: .round))
            }
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - m(2), y: c.y - m(2), width: m(4), height: m(4))), with: .color(hub))
        }
        .frame(width: m(20), height: m(12))
        .accessibilityHidden(true)
    }
}

struct QuickDashboard: View {
    // The panel at 100%. App zoom scales it, up to the height of the screen it opens on.
    static func panelSize(zoom: Double, room: CGFloat = .greatestFiniteMagnitude) -> NSSize {
        NSSize(width: (440 * zoom).rounded(), height: min((800 * zoom).rounded(), room.rounded(.down)))
    }
    private static let paceColumn: CGFloat = 54, valueColumn: CGFloat = 70
    @ObservedObject var model: DashboardModel
    @ObservedObject var zoom: AppZoom
    @State private var hoveredSession: String?
    @State private var selectedAccount: AccountQuota?
    @AppStorage("weeklyTokensMode") private var tokensMode = false
    // The cluster (계기판) in place of the token card, weekly limits and resources; remembered.
    @AppStorage("quickCluster") private var showCluster = false
    @AppStorage("dashboardTheme") private var dashboardTheme = "dark"
    // The dashboard's language (한·EN·中); the quick view, the menus and the dashboard window share it.
    @AppStorage("dashboardLanguage") private var language = "ko"
    var openDashboard: () -> Void; var openBrowser: () -> Void
    var remoteOptions: () -> Void; var connectRemote: () -> Void
    var toggleLogin: () -> Void; var restart: () -> Void; var quit: () -> Void
    var control: (String, DesktopSession) -> Void
    // The dashboard's theme switch and one-tap language button; the app spreads the change from the button.
    var switchTheme: () -> Void = {}; var switchLanguage: () -> Void = {}
    private var theme: QuickTheme { QuickTheme(light: dashboardTheme == "light") }
    private var tr: QuickText { QuickText(language) }
    private var m: QuickMetrics { QuickMetrics(zoom: CGFloat(zoom.value)) }
    var body: some View {
        VStack(spacing: 0) {
            header
            periodPicker.padding(.horizontal, m(14)).padding(.bottom, m(10))
            if showCluster {
                QuickCluster(model: model, theme: theme, m: m, tr: tr, caption: periodLabel)
                    .padding(.horizontal, m(14)).padding(.bottom, m(10))
            } else {
                tokenSection.padding(.horizontal, m(16))
                weeklyCard.padding(.horizontal, m(14)).padding(.top, m(14))
                resources.padding(.horizontal, m(16)).padding(.top, m(12)).padding(.bottom, m(10))
            }
            sessionList
            if let message = model.message {
                HStack(alignment: .top) {
                    Text(tr(message)).font(m.font(.body)).foregroundStyle(model.messageIsError ? theme.amber : theme.accent)
                    Spacer(minLength: m(4))
                    Button { model.message = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain).accessibilityLabel(tr("알림 닫기"))
                }.padding(m(10)).background(theme.raised)
            }
            footer
        }
        // AppKit sizes the panel from the zoom and the screen; the content fills it.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.background)
        .foregroundStyle(theme.ink)
        .preferredColorScheme(theme.light ? .light : .dark).font(m.font(.title))
        .popover(item: $selectedAccount, arrowEdge: .bottom) { original in
            let current = model.snapshot?.account_quotas?.first { $0.id == original.id } ?? original
            compactQuota(current).padding(m(12)).frame(width: m(340)).preferredColorScheme(theme.light ? .light : .dark)
        }
    }

    // MARK: Header and period
    private var header: some View {
        HStack(spacing: m(8)) {
            Image(systemName: "waveform.path").font(m.font(.figure, .semibold)).foregroundStyle(theme.accent)
            Text("1top").font(m.font(.figure, .semibold)).accessibilityLabel("1top")
            Spacer()
            HStack(spacing: m(6)) {
                Circle().fill(model.fresh ? theme.segmentOn : theme.amber).frame(width: m(6), height: m(6))
                Text(tr(model.connectionLabel)).font(m.font(.label)).foregroundStyle(theme.muted)
            }.padding(.horizontal, m(9)).frame(height: m(24)).overlay(Capsule().stroke(theme.line))
            preferenceButtons
            Menu {
                Button(tr("브라우저에서 열기"), action: openBrowser)
                Button(tr("지금 새로고침")) { model.refresh() }
                Button(tr(tokensMode ? "세션을 주간 한도 %로 보기" : "세션을 토큰으로 보기")) { tokensMode.toggle() }
                // The same zoom as 보기 › 확대·축소 (⌘+ ⌘− ⌘0); it also scales the dashboard window.
                Menu(tr.zoom(Int((zoom.value * 100).rounded()))) {
                    Button(tr("확대")) { zoom.set(zoom.value + 0.1) }.disabled(zoom.value >= AppZoom.range.upperBound)
                    Button(tr("축소")) { zoom.set(zoom.value - 0.1) }.disabled(zoom.value <= AppZoom.range.lowerBound)
                    Button(tr("기본 크기")) { zoom.set(1) }.disabled(zoom.value == 1)
                }
                Divider()
                Button(tr(model.openAtLogin ? "✓ 로그인할 때 실행" : "로그인할 때 실행"), action: toggleLogin)
                Button(tr("원격 대시보드 (선택)"), action: remoteOptions)
                Button(tr("원격 기기 연결…"), action: connectRemote)
                Divider()
                Button(tr("로컬 수집기 다시 시작"), action: restart)
                Button(tr("1top 종료"), action: quit)
            } label: { Image(systemName: "ellipsis").font(m.font(.title, .semibold)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: m(26)).accessibilityLabel(tr("1top 옵션"))
        }.padding(.horizontal, m(16)).padding(.top, m(12)).padding(.bottom, m(10))
    }
    private static let languages: [(String, String, String)] = [("ko", "한", "한국어"), ("en", "EN", "English"), ("zh", "中", "中文")]
    // ☀/☾ like the dashboard's theme switch, and one language button that moves 한 → EN → 中 on each tap.
    private var preferenceButtons: some View {
        let light = dashboardTheme == "light", themeLabel = tr(light ? "다크 모드" : "화이트 모드")
        let at = Self.languages.firstIndex { $0.0 == tr.lang } ?? 0, next = Self.languages[(at + 1) % Self.languages.count]
        let languageLabel = "\(tr("언어")): \(Self.languages[at].2) → \(next.2)"
        let clusterLabel = tr(showCluster ? "기본 보기" : "계기판 보기")
        return HStack(spacing: m(8)) {
            // The cluster view, one tap each way.
            Button { showCluster.toggle() } label: {
                Image(systemName: "gauge.with.needle").font(.system(size: m(14), weight: .semibold))
                    .foregroundStyle(showCluster ? theme.accent : theme.muted)
                    .frame(width: m(24), height: m(24)).contentShape(Rectangle())
            }.buttonStyle(.plain).help(clusterLabel).accessibilityLabel(clusterLabel)
                .accessibilityAddTraits(showCluster ? .isSelected : [])
            Button(action: switchTheme) {
                Text(light ? "☾" : "☀").font(.system(size: m(15))).foregroundStyle(theme.muted)
                    .frame(width: m(24), height: m(24)).contentShape(Rectangle())
            }.buttonStyle(.plain).help(themeLabel).accessibilityLabel(themeLabel)
            Button(action: switchLanguage) {
                Text(Self.languages[at].1).font(m.font(.label, .semibold)).foregroundStyle(theme.ink)
                    .frame(minWidth: m(18)).padding(.horizontal, m(6)).frame(height: m(24))
                    .background(theme.card, in: RoundedRectangle(cornerRadius: m(6)))
                    .overlay(RoundedRectangle(cornerRadius: m(6)).stroke(theme.line)).contentShape(Rectangle())
            }.buttonStyle(.plain).help(languageLabel).accessibilityLabel(languageLabel)
        }
    }
    private var periodPicker: some View {
        HStack(spacing: m(2)) {
            ForEach([("10m", "10분"), ("30m", "30분"), ("1h", "1시간"), ("5h", "5시간"), ("12h", "12시간"), ("24h", "24시간")], id: \.0) { key, title in
                let selected = model.selectedPeriod == key
                Button { model.selectedPeriod = key } label: {
                    Text(tr(title)).font(m.font(.body, selected ? .semibold : .medium)).frame(maxWidth: .infinity).frame(height: m(24))
                        .foregroundStyle(selected ? theme.ink : theme.muted)
                        .background(selected ? theme.raised : Color.clear, in: RoundedRectangle(cornerRadius: m(6)))
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(tr.last(title)).accessibilityAddTraits(selected ? .isSelected : [])
            }
        }.padding(m(3)).background(theme.card, in: RoundedRectangle(cornerRadius: m(9))).overlay(RoundedRectangle(cornerRadius: m(9)).stroke(theme.line))
            .accessibilityElement(children: .contain).accessibilityLabel(tr("사용량 기간"))
    }

    private var periodLabel: String {
        tr.last(model.window?.label ?? ["10m": "10분", "30m": "30분", "1h": "1시간", "5h": "5시간", "12h": "12시간", "24h": "24시간"][model.selectedPeriod] ?? model.selectedPeriod)
    }

    // MARK: Tokens · average speed on the radar, split by model
    private var tokenSection: some View {
        let reading = SpeedReading(model: model), usage = modelSlices()
        return VStack(alignment: .leading, spacing: m(8)) {
            HStack(alignment: .firstTextBaseline, spacing: m(6)) {
                Text(tr("토큰 사용")).font(m.font(.body, .semibold))
                Text(periodLabel).font(m.font(.label)).foregroundStyle(theme.muted)
                Spacer()
            }
            .help(usage.total > 0 ? tr.pick("\(periodLabel) 동안 \(shortNumber(usage.total)) tokens", "\(periodLabel): \(shortNumber(usage.total)) tokens", "\(periodLabel)：\(shortNumber(usage.total)) tokens") : "")
            HStack(alignment: .center, spacing: m(18)) {
                ScopeDial(reading: reading, period: periodLabel, theme: theme, m: m, tr: tr).frame(width: m(190), height: m(190))
                Group {
                    if usage.slices.isEmpty {
                        Text(tr(reading.average == nil ? "사용량을 확인하고 있습니다" : "이 기간에 보고된 사용이 없습니다"))
                            .font(m.font(.label)).foregroundStyle(theme.muted)
                    } else {
                        modelLegend(usage.slices, total: usage.total)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    // The period's tokens by AI model (tool colour), largest first; the rest folds into one.
    private func modelSlices() -> (slices: [UsageSlice], total: Double) {
        var byModel: [String: (kind: String, model: String, tokens: Double)] = [:]
        for s in model.sessions where s.tokens != nil {
            guard let window = s.usage?.windows?[model.selectedPeriod] ?? nil, !window.isEmpty,
                  window.allSatisfy({ $0.isFinite && $0 >= 0 }) else { continue }
            let tokens = window.reduce(0, +), name = shortModel(s), key = s.kind + "|" + name
            if tokens > 0 { byModel[key, default: (s.kind, name, 0)].tokens += tokens }
        }
        let rows = byModel.values.sorted { $0.tokens == $1.tokens ? $0.model < $1.model : $0.tokens > $1.tokens }
        let sessionsTotal = rows.reduce(0) { $0 + $1.tokens }
        // The period total also counts sessions that have ended; it matches the speed on the radar.
        let total = max(sessionsTotal, model.periodTokens ?? 0)
        let shown = rows.count <= 4 ? rows : Array(rows.prefix(3))
        var seen: [String: Int] = [:]
        var slices = shown.map { row -> UsageSlice in
            let index = seen[row.kind, default: 0]; seen[row.kind] = index + 1
            return UsageSlice(id: row.kind + "|" + row.model, name: row.model, detail: toolName(row.kind),
                              kind: row.kind, value: row.tokens, shade: [1, 0.68, 0.46][min(index, 2)])
        }
        let rest = total - shown.reduce(0) { $0 + $1.tokens }, others = rows.count - shown.count
        if total > 0, rest > total * 0.005 {
            slices.append(UsageSlice(id: "__rest__", name: tr(others > 0 ? "기타 모델" : "종료된 세션"),
                                     detail: others > 0 ? tr.count(others) + (total - sessionsTotal > total * 0.005 ? " · " + tr("종료 세션 포함") : "") : tr("목록에 없는 세션"),
                                     kind: nil, value: rest, shade: 1))
        }
        return (slices, total)
    }
    private func sliceColor(_ slice: UsageSlice) -> Color {
        slice.kind.map { AgentPalette.color($0).opacity(slice.shade) } ?? theme.dim
    }
    private func sharePercent(_ value: Double, of total: Double) -> String {
        guard total > 0 else { return "—" }
        let share = value / total * 100
        return share < 1 ? "<1%" : "\(Int(share.rounded()))%"
    }
    // 05 · Stacked bar and legend: model, tool and share. The colours are the radar's colours.
    private func modelLegend(_ slices: [UsageSlice], total: Double) -> some View {
        VStack(alignment: .leading, spacing: m(10)) {
            Text(tr("모델별")).font(m.font(.caption)).foregroundStyle(theme.muted)
            GeometryReader { geo in
                HStack(spacing: m(2)) {
                    ForEach(slices) { slice in
                        Slanted().fill(sliceColor(slice))
                            .frame(width: max(m(3), (geo.size.width - CGFloat(slices.count - 1) * m(2)) * CGFloat(slice.value / total)))
                    }
                }
            }.frame(height: m(8))
            VStack(alignment: .leading, spacing: m(8)) {
                ForEach(slices) { slice in
                    HStack(alignment: .top, spacing: m(7)) {
                        Circle().fill(sliceColor(slice)).frame(width: m(6), height: m(6)).padding(.top, m(4))
                        VStack(alignment: .leading, spacing: 0) {
                            Text(slice.name).font(m.font(.label, .semibold)).lineLimit(1)
                            Text(slice.detail).font(m.font(.caption)).foregroundStyle(theme.muted).lineLimit(1)
                        }
                        Spacer(minLength: m(4))
                        Text(sharePercent(slice.value, of: total)).font(m.font(.label, .semibold)).monospacedDigit()
                    }.help("\(slice.name) · \(slice.detail)\n\(shortNumber(slice.value)) tokens · \(sharePercent(slice.value, of: total))")
                }
            }
        }
    }

    // MARK: Weekly limits · compact tiles with a small trend line
    private var weeklyCard: some View {
        let rows = model.snapshot?.account_quotas ?? []
        return VStack(alignment: .leading, spacing: m(7)) {
            HStack(alignment: .firstTextBaseline, spacing: m(6)) {
                Text(tr("주간 한도")).font(m.font(.body, .semibold))
                Text(tr("계정별 100%")).font(m.font(.label)).foregroundStyle(theme.muted)
                Spacer()
                Menu {
                    Button(tr("Claude Code 계정 로그인…")) { model.addAccount("Claude") }
                    Button(tr("Codex 계정 로그인…")) { model.addAccount("Codex") }
                } label: { Image(systemName: "plus").font(m.font(.label, .semibold)) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: m(18), height: m(14))
                    .disabled(!model.fresh || model.busy).accessibilityLabel(tr("구독 계정 추가 로그인"))
            }.padding(.horizontal, m(2))
            if rows.isEmpty {
                Text(tr("+ 버튼으로 구독 계정을 연결하세요.")).font(m.font(.label)).foregroundStyle(theme.muted)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: m(8)), GridItem(.flexible(), spacing: m(8))], spacing: m(8)) {
                    ForEach(rows.prefix(4)) { weeklyRow($0) }
                }
            }
        }
    }
    private func weeklyRow(_ q: AccountQuota) -> some View {
        let w = q.windows.first { $0.label == "주간" }
        let account = model.snapshot?.weekly_usage?.accounts.first { $0.id == q.id }
        let p = account?.periods[model.selectedPeriod]
        let color = AgentPalette.color(q.kind)
        let rate = model.fresh && !q.stale ? p?.burnPerHour : nil
        let handle = q.account_label.split(separator: "@").first.map(String.init) ?? q.account_label
        let end = model.snapshot?.updated ?? model.now.timeIntervalSince1970, start = end - (periodSeconds[model.selectedPeriod] ?? 3600)
        let points = weeklyPoints(account, start: start, end: end)
        return Button { selectedAccount = q } label: {
            VStack(alignment: .leading, spacing: m(3)) {
                HStack(alignment: .firstTextBaseline, spacing: m(5)) {
                    Circle().fill(color).frame(width: m(6), height: m(6)).alignmentGuide(.firstTextBaseline) { $0[.bottom] - m(1) }
                    Text(toolName(q.kind)).font(m.font(.body, .semibold)).lineLimit(1).fixedSize()
                    accountChip(q.id)
                    Spacer(minLength: m(4))
                    Text(pct1(w?.pct)).font(m.font(.figure, .semibold)).monospacedDigit().fixedSize()
                        .foregroundStyle(q.stale ? theme.muted : theme.ink)
                }
                // Fixed slots keep the small trend line in the same place in every tile.
                // No report in the period leaves it empty; the status on the right says why.
                HStack(spacing: m(6)) {
                    Text(handle).font(m.font(.caption)).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.middle)
                        .frame(width: m(78), alignment: .leading)
                    WeeklySpark(points: points, start: start, end: end, color: color, faded: q.stale, m: m)
                        .frame(maxWidth: .infinity).frame(height: m(14))
                    Text(q.stale ? tr(q.statusLabel) : rate == nil ? tr("수집 중") : rate1(rate, tr))
                        .font(m.font(.caption, .medium)).foregroundStyle(q.stale ? theme.amber : color).lineLimit(1)
                        .frame(width: m(54), alignment: .trailing)
                }
            }
            .padding(.horizontal, m(10)).padding(.vertical, m(8)).frame(maxWidth: .infinity)
            .background(color.opacity(theme.light ? 0.08 : 0.07), in: RoundedRectangle(cornerRadius: m(8)))
            .contentShape(RoundedRectangle(cornerRadius: m(8)))
        }.buttonStyle(.plain).accessibilityLabel("\(toolName(q.kind)) \(q.account_label) \(tr("주간 한도")) \(pct1(w?.pct))")
            .help("\(q.account_label) · \(q.plan ?? "")\n" + tr.pick("선: \(periodLabel) 동안의 주간 한도 사용률\n오른쪽 아래: 같은 기간 평균 소진 속도\n클릭하면 5시간 한도와 초기화 시각을 확인합니다.",
                                                                     "Line: weekly limit used, \(periodLabel)\nBottom right: average burn rate over the same period\nClick to see the 5-hour limit and reset times.",
                                                                     "线：\(periodLabel)的每周额度使用率\n右下：同一时段的平均消耗速度\n点击查看 5 小时额度和重置时间。"))
    }

    // MARK: Resources
    private var resources: some View {
        HStack(spacing: m(18)) {
            resource("CPU", value: model.snapshot?.system?.host?.cpu)
            resource("메모리", value: model.snapshot?.system?.host?.memory?.percent)
        }
    }
    private func resource(_ label: String, value: Double?) -> some View {
        HStack(spacing: m(7)) {
            Text(tr(label)).foregroundStyle(theme.muted)
            GeometryReader { geo in
                Capsule().fill(theme.line).overlay(alignment: .leading) {
                    Capsule().fill((value ?? 0) > 90 ? theme.amber : theme.segmentOn)
                        .frame(width: geo.size.width * min(100, max(0, value ?? 0)) / 100)
                }
            }.frame(height: m(3))
            Text(DesktopFormat.percent(value)).monospacedDigit().frame(width: m(34), alignment: .trailing)
        }.font(m.font(.label)).help("\(tr(label)) · \(tr.pick("이 Mac 전체 사용률", "Total use on this Mac", "这台 Mac 的总使用率")) \(DesktopFormat.percent(value))")
    }

    // MARK: Sessions
    private func paceCell(gauge: MiniGauge, text: String, ink: Color, help: String, label: String) -> some View {
        VStack(spacing: m(2)) {
            gauge
            Text(text).font(m.font(.tiny)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.85).foregroundStyle(ink)
        }
        .frame(width: m(Self.paceColumn))
        .help(help)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }

    private var orderedSessions: [DesktopSession] {
        let sorted = model.sortedSessions
        return sorted.filter(\.isWorkingGroup) + sorted.filter { !$0.isWorkingGroup }
    }
    private var sessionList: some View {
        VStack(spacing: 0) {
            HStack(spacing: m(8)) {
                Text(tr("세션")).font(m.font(.body, .semibold))
                Text("\(model.sessions.count)").font(m.font(.label, .semibold)).monospacedDigit().foregroundStyle(theme.muted)
                    .padding(.horizontal, m(6)).frame(height: m(18)).background(theme.raised, in: RoundedRectangle(cornerRadius: m(5)))
                HStack(spacing: m(5)) {
                    if model.fresh { WorkingWave(color: theme.segmentOn, size: m(9)) } else { Circle().fill(theme.amber).frame(width: m(6), height: m(6)) }
                    Text(model.fresh ? tr.working(model.working) : tr("마지막 기록"))
                }.font(m.font(.label, .medium)).foregroundStyle(model.fresh ? theme.ink : theme.amber).padding(.leading, m(4))
                Spacer(minLength: m(4))
                Text(tr(tokensMode ? "토큰" : "주간 한도 사용량")).font(m.font(.caption)).foregroundStyle(theme.muted)
                    .fixedSize().frame(width: m(Self.valueColumn), alignment: .trailing)
                Color.clear.frame(width: m(55), height: 1)
            }.padding(.horizontal, m(16)).padding(.vertical, m(8))
                .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
                .help(tr("작업 중인 세션부터 표시합니다. 아래로 스크롤하면 모든 세션을 볼 수 있습니다."))
            if model.sessions.isEmpty {
                VStack(spacing: m(6)) {
                    Image(systemName: "terminal").font(m.font(.display)).foregroundStyle(theme.muted)
                    Text(tr(model.snapshot?.ready == true ? "감지된 AI 세션이 없습니다" : "로컬 세션을 확인하고 있습니다")).font(m.font(.title))
                    Text(tr("실행 중인 AI 세션이 여기에 표시됩니다.")).font(m.font(.label)).foregroundStyle(theme.muted)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                let rows = orderedSessions
                let paceScale = DesktopUsageTrend.niceMaximum(max(1, rows.compactMap(sessionPace).max() ?? 0))
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { session in
                            sessionRow(session, paceScale: paceScale)
                            Rectangle().fill(theme.line.opacity(0.7)).frame(height: 1).padding(.leading, m(16 + Self.paceColumn + 9))
                        }
                    }
                }.frame(maxHeight: .infinity)
            }
        }.frame(maxHeight: .infinity)
    }
    private func sessionName(_ s: DesktopSession) -> String {
        if let title = s.orca_terminal?.title, !title.isEmpty { return title }
        if s.kind == "Aside", let title = s.title, !title.isEmpty { return title }
        return s.project ?? s.kind
    }
    private func periodValue(_ s: DesktopSession, estimate: WeeklyEstimate?) -> String {
        let window: [Double]? = s.usage?.windows?[model.selectedPeriod] ?? nil
        let tokens = s.tokens == nil ? nil : DesktopFormat.total(window)
        if tokensMode { return shortNumber(tokens) }
        if let estimate, estimate.used_pp.isFinite, estimate.used_pp >= 0 { return "≈" + pct1(estimate.used_pp) }
        return tokens == 0 ? "0%" : "—"
    }
    // Current pace from the last 60 s: % of the weekly limit per hour, or tokens per hour in token mode.
    private func sessionPace(_ s: DesktopSession) -> Double? {
        guard model.fresh else { return nil }
        if tokensMode { return s.tokens == nil ? nil : s.usage?.rate.flatMap { $0.isFinite && $0 >= 0 ? $0 * 3600 : nil } }
        let quota = model.snapshot?.account_quotas?.first { $0.id == s.usage?.weekly_account }
        let estimate = s.usage?.weekly_estimate?[model.selectedPeriod]
        return estimate?.permitsBurnRate(for: quota, at: model.now.timeIntervalSince1970) == true
            ? s.usage?.weeklyBurnPerHour(period: model.selectedPeriod) : nil
    }
    private func sessionRow(_ s: DesktopSession, paceScale: Double) -> some View {
        let quota = model.snapshot?.account_quotas?.first { $0.id == s.usage?.weekly_account }
        let estimate = s.usage?.weekly_estimate?[model.selectedPeriod]
        let burn = sessionPace(s)
        let pending = tr(!model.fresh ? "마지막 기록" : quota?.stale == true ? (quota?.statusLabel ?? "한도 조회 대기") : s.usage?.weekly_account == nil ? "계정 연결 필요" : "환산 기준 수집 중")
        let project = s.project == "0" ? tr("Aside 기본 작업공간") : (s.project ?? s.kind)
        let tool = s.kind == "Aside" ? (s.model ?? "Aside") : toolName(s.kind)
        var helpLines = [project, "\(tr(s.locationLabel)) · \(s.model ?? s.kind)" + (s.reportedEffort.map { " · effort \($0)" } ?? ""), tr(s.groupStateLabel)]
        if let title = s.title { helpLines.append(title) }
        let hub = s.isWorkingGroup ? theme.segmentOn : s.state == "waiting" ? theme.amber : theme.dim
        // Small, typed pieces: older Swift compilers time out type-checking this row as one expression.
        let paceText: String = burn.map { tokensMode ? shortNumber($0) + " tokens" + tr.perHour : rate1($0, tr) } ?? tr("확인 중")
        let gaugeText: String = burn.map { tokensMode ? shortNumber($0) + tr.perHour : rate1($0, tr) } ?? "—"
        let gaugeInk: Color = burn == nil ? theme.dim : burn == 0 ? theme.muted : theme.ink
        let pendingLine: String = burn == nil && !tokensMode ? "\n" + pending : ""
        let paceHelp: String = tr(s.groupStateLabel) + "\n" + tr("지금 속도") + ": " + paceText + " · " + tr("최근 60초의 토큰 속도로 계속 쓸 때") + pendingLine
        let paceLabel: String = tr(s.groupStateLabel) + ", " + tr("지금 속도") + " " + paceText
        let gauge = MiniGauge(value: burn, scale: paceScale, color: AgentPalette.color(s.kind), hub: hub, theme: theme, m: m)
        return HStack(alignment: .center, spacing: m(9)) {
            paceCell(gauge: gauge, text: gaugeText, ink: gaugeInk, help: paceHelp, label: paceLabel)
            VStack(alignment: .leading, spacing: m(2)) {
                HStack(spacing: m(6)) {
                    Text(sessionName(s)).font(m.font(.title, .semibold)).lineLimit(1)
                    if let count = s.children_count, count > 0 {
                        Text(tr.children(count)).font(m.font(.caption)).foregroundStyle(theme.muted).padding(.horizontal, m(5)).frame(height: m(16))
                            .overlay(Capsule().stroke(theme.line)).fixedSize()
                            .help(tr.pick("하위 \(count)개 세션의 사용량을 포함합니다. 제어 버튼은 상위 세션에 적용됩니다.", "Includes the usage of \(count) subsessions. Controls apply to the root session.", "包含 \(count) 个子会话的用量。控制按钮作用于上级会话。") +
                                  (s.group_usage_partial == true ? " " + tr("일부 하위 세션의 토큰은 미보고 상태입니다.") : ""))
                    }
                }
                HStack(spacing: m(4)) {
                    Text(tool).foregroundStyle(AgentPalette.color(s.kind))
                    accountChip(s.usage?.weekly_estimate?[model.selectedPeriod]?.account_id ?? s.usage?.weekly_account)
                    Text("· " + project).foregroundStyle(theme.muted)
                }.font(m.font(.label)).lineLimit(1)
            }.frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).layoutPriority(-1)
                .help(helpLines.joined(separator: "\n"))
            let value = periodValue(s, estimate: estimate)
            Text(value).font(m.font(.title, .semibold)).monospacedDigit().lineLimit(1)
                .foregroundStyle(value == "—" ? theme.dim : theme.ink)
                .frame(width: m(Self.valueColumn), alignment: .trailing)
                .help(tokensMode ? tr.pick("\(periodLabel) 동안 이 세션이 쓴 토큰", "Tokens this session used, \(periodLabel)", "此会话在\(periodLabel)使用的 token") :
                      tr.pick("≈ \(periodLabel) 동안 이 세션이 쓴 토큰을 계정의 주간 한도로 환산한 추정치", "≈ This session’s tokens, \(periodLabel), converted to the account’s weekly limit", "≈ 将此会话在\(periodLabel)使用的 token 换算为账户每周额度的估算值") +
                      (estimate == nil ? "\n" + pending : "\n" + tr(estimate?.calculationLabel ?? "")))
            Button { control("focus", s) } label: { Image(systemName: "arrow.up.right").font(m.font(.body, .medium)).frame(width: m(24), height: m(24)) }
                .buttonStyle(.plain).foregroundStyle(theme.muted).disabled(!model.fresh || model.busy || !s.allows("focus"))
                .accessibilityLabel("\(sessionName(s)) \(tr("바로가기"))")
            Menu {
                Button(tr("터미널 바로가기")) { control("focus", s) }.disabled(!s.allows("focus"))
                Button(tr("작업 일시정지…")) { control("pause", s) }.disabled(!s.allows("pause"))
                Button(tr("새 요청으로 재개…")) { control("resume", s) }.disabled(!s.allows("resume"))
                Divider()
                Button(tr("CLI 종료…"), role: .destructive) { control("terminate", s) }.disabled(!s.allows("terminate"))
            } label: { Image(systemName: "ellipsis").font(m.font(.body, .semibold)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: m(22))
                .disabled(!model.fresh || model.busy).accessibilityLabel("\(sessionName(s)) \(tr("세션 제어"))")
        }.padding(.horizontal, m(16)).frame(height: m(46))
            .background(hoveredSession == s.id ? theme.raised.opacity(0.6) : .clear)
            .onHover { hoveredSession = $0 ? s.id : nil }
    }

    // MARK: Footer and account detail
    private var footer: some View {
        HStack(spacing: m(8)) {
            Button(action: openDashboard) {
                HStack(spacing: m(8)) {
                    Image(systemName: "rectangle.inset.filled").font(m.font(.body))
                    Text(tr("전체 대시보드")).font(m.font(.body, .semibold))
                    Spacer()
                    Text("⌘O").font(m.font(.label)).foregroundStyle(theme.muted)
                }.padding(.horizontal, m(12)).frame(height: m(32))
                    .background(theme.card, in: RoundedRectangle(cornerRadius: m(8))).overlay(RoundedRectangle(cornerRadius: m(8)).stroke(theme.line))
                    .contentShape(RoundedRectangle(cornerRadius: m(8)))
            }.buttonStyle(.plain).accessibilityLabel(tr("전체 대시보드 열기"))
            Button(action: openBrowser) {
                Image(systemName: "safari").font(m.font(.title)).frame(width: m(32), height: m(32))
                    .background(theme.card, in: RoundedRectangle(cornerRadius: m(8))).overlay(RoundedRectangle(cornerRadius: m(8)).stroke(theme.line))
            }.buttonStyle(.plain).help(tr("브라우저에서 열기")).accessibilityLabel(tr("브라우저에서 열기"))
        }.padding(.horizontal, m(14)).padding(.vertical, m(10))
            .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
    }
    /// Several accounts of one tool are numbered by account name (Claude Code 1, 2), so a session and
    /// its account's limit tile match at a glance. A tool with one account shows no number.
    private var accountNumbers: [String: Int] {
        let quotas = model.snapshot?.account_quotas ?? []
        var out: [String: Int] = [:]
        for kind in Set(quotas.map(\.kind)) {
            let list = quotas.filter { $0.kind == kind }.sorted { $0.account_label.lowercased() < $1.account_label.lowercased() }
            if list.count > 1 { for (i, q) in list.enumerated() { out[q.id] = i + 1 } }
        }
        return out
    }
    @ViewBuilder private func accountChip(_ id: String?) -> some View {
        let quota = model.snapshot?.account_quotas?.first { $0.id == id }
        if let alias = quota?.alias, !alias.isEmpty {
            Text(alias).font(m.font(.caption, .semibold)).foregroundStyle(theme.ink).lineLimit(1)
                .padding(.horizontal, m(5)).frame(minHeight: m(15))
                .background(theme.raised, in: RoundedRectangle(cornerRadius: m(4))).fixedSize()
                .help(quota?.account_label ?? "")
        } else if let id, let n = accountNumbers[id] {
            Text("\(n)").font(m.font(.caption, .semibold)).monospacedDigit().foregroundStyle(theme.ink)
                .padding(.horizontal, m(4)).frame(minWidth: m(15), minHeight: m(15))
                .background(theme.raised, in: RoundedRectangle(cornerRadius: m(4))).fixedSize()
                .help(model.snapshot?.account_quotas?.first { $0.id == id }?.account_label ?? "")
        }
    }
    private func compactQuota(_ quota: AccountQuota) -> some View {
        let tint = AgentPalette.color(quota.kind)
        return VStack(alignment: .leading, spacing: m(5)) {
            HStack(spacing: m(7)) {
                RoundedRectangle(cornerRadius: m(2)).fill(tint).frame(width: m(5), height: m(13))
                Text(toolName(quota.kind)).font(m.font(.title, .semibold))
                accountChip(quota.id)
                Text(quota.plan ?? "").font(m.font(.caption, .medium)).foregroundStyle(tint)
                Spacer()
                Circle().fill(quota.stale ? theme.amber : theme.segmentOn).frame(width: m(5), height: m(5))
                Text(tr(quota.statusLabel)).font(m.font(.caption)).foregroundStyle(quota.stale ? theme.amber : theme.muted)
            }
            Text(quota.account_label).font(m.font(.label)).foregroundStyle(theme.muted).lineLimit(1)
                .help(quota.account_label + " · " + quota.id.suffix(6))
            HStack(alignment: .top, spacing: m(18)) {
                ForEach(quota.windows) { window in
                    VStack(alignment: .leading, spacing: m(4)) {
                        HStack {
                            Text(tr(window.label)).foregroundStyle(theme.muted); Spacer()
                            Text(window.pct.map { DesktopFormat.percent($0) } ?? tr("미확인")).monospacedDigit()
                        }.font(m.font(.body, .medium))
                        GeometryReader { geo in
                            Capsule().fill(theme.line).overlay(alignment: .leading) {
                                if let pct = window.pct {
                                    Capsule().fill(pct >= 90 ? theme.amber : tint).frame(width: geo.size.width * min(100, max(0, pct)) / 100)
                                }
                            }
                        }.frame(height: m(3)).accessibilityLabel(window.pct == nil ? tr("사용률 미확인") : tr.pick("사용률 \(Int(window.pct ?? 0))퍼센트", "\(Int(window.pct ?? 0)) percent used", "已用 \(Int(window.pct ?? 0))%"))
                        Text(resetLabel(window.reset)).font(m.font(.caption)).foregroundStyle(theme.muted).lineLimit(1)
                    }.frame(maxWidth: .infinity)
                }
            }.padding(.top, m(2))
            if quota.stale, quota.status != nil {
                Text(tr(quota.note)).font(m.font(.caption)).foregroundStyle(theme.amber).fixedSize(horizontal: false, vertical: true)
            }
            if quota.needsReconnect { reconnectButton(quota) }
            AccountNameField(quota: quota, model: model, m: m, theme: theme, tr: tr)
        }.padding(.horizontal, m(12)).padding(.vertical, m(10))
            .background(theme.card, in: RoundedRectangle(cornerRadius: m(8)))
            .overlay(RoundedRectangle(cornerRadius: m(8)).stroke(theme.line))
            .help(tr(quota.note) + (quota.updated > 0 ? " · " + Date(timeIntervalSince1970: quota.updated).formatted(date: .omitted, time: .shortened) : ""))
    }
    /// macOS asks once for the saved sign-in; the button stays off while that question is open.
    private func reconnectButton(_ quota: AccountQuota) -> some View {
        let waiting = model.authorizing == quota.id
        return VStack(alignment: .leading, spacing: m(4)) {
            Button { model.authorizeAccount(quota.id) } label: {
                Text(tr(waiting ? "macOS 승인 기다리는 중…" : "다시 연결")).font(m.font(.label, .semibold))
                    .padding(.horizontal, m(10)).frame(height: m(26))
                    .background(theme.raised, in: RoundedRectangle(cornerRadius: m(6)))
            }.buttonStyle(.plain).disabled(model.authorizing != nil || !model.fresh)
            Text(tr("macOS가 저장된 로그인 사용을 한 번 묻습니다. 다시 묻지 않습니다.")).font(m.font(.caption)).foregroundStyle(theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }.padding(.top, m(2))
    }
    private func resetLabel(_ reset: Double) -> String {
        guard reset > 0 else { return tr("초기화 시각 미보고") }
        let minutes = Int(ceil((reset - model.now.timeIntervalSince1970) / 60))
        if minutes <= 0 { return tr("초기화 보고 대기") }
        if minutes >= 1440 { return tr.resetsIn(days: minutes / 1440, hours: (minutes % 1440) / 60, minutes: 0) }
        return tr.resetsIn(days: 0, hours: minutes / 60, minutes: minutes % 60)
    }
}

/// "Working" is a moving three-bar wave, never a dot in a tool's hue. Still when Reduce Motion is on.
private struct WorkingWave: View {
    var color: Color
    var size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var still
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20, paused: still)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: size * 0.17) {
                ForEach(0..<3, id: \.self) { i in
                    Capsule().fill(color)
                        .frame(width: size * 0.22, height: size * (still ? [0.45, 1, 0.7][i] : 0.35 + 0.65 * abs(sin(t * 2.6 + Double(i) * 1.1))))
                }
            }.frame(width: size, height: size, alignment: .bottom)
        }.accessibilityHidden(true)
    }
}

/// Renames an account from its detail: up to 24 characters, saved empty to go back to the number.
private struct AccountNameField: View {
    let quota: AccountQuota
    @ObservedObject var model: DashboardModel
    let m: QuickMetrics
    let theme: QuickTheme
    let tr: QuickText
    @State private var name = ""
    var body: some View {
        HStack(spacing: m(6)) {
            TextField(tr("계정 이름(24자, 비우면 번호)"), text: $name)
                .textFieldStyle(.roundedBorder).font(m.font(.label))
                .onChange(of: name) { value in if value.count > 24 { name = String(value.prefix(24)) } }
                .onSubmit(save)
            Button(tr("저장"), action: save).controlSize(.small)
                .disabled(model.busy || !model.fresh || name.trimmingCharacters(in: .whitespaces) == (quota.alias ?? ""))
        }
        .padding(.top, m(2))
        .onAppear { name = quota.alias ?? "" }
    }
    private func save() { model.renameAccount(quota.id, to: name) }
}
