import SwiftUI

/// Whole numbers on three seven-segment places with the unit letter, like the desktop instrument.
struct SegmentDigits: View {
    var value: Double?
    var height: CGFloat
    @Environment(\.colorScheme) private var scheme

    private var reading: (digits: [Character], unit: String) {
        guard let value, value.isFinite, value >= 0 else { return (["-", "-", "-"], "") }
        if value < 0.5 { return ([" ", " ", "0"], "") }
        func unit(_ v: Double) -> (Double, String) { v >= 1e9 ? (1e9, "B") : v >= 1e6 ? (1e6, "M") : v >= 1e3 ? (1e3, "k") : (1, "") }
        var (divisor, suffix) = unit(value)
        var whole = (value / divisor).rounded()
        if whole >= 1000 && suffix != "B" { (divisor, suffix) = unit(whole * divisor); whole = (value / divisor).rounded() }
        let text = String(Int(min(999, whole)))
        return (Array(String(repeating: " ", count: max(0, 3 - text.count)) + text), suffix)
    }

    var body: some View {
        let reading = reading, w = height * 0.55, gap = height * 0.15, slant = tan(9 * Double.pi / 180)
        let skew = height * slant, unitSize = height * 0.46
        let width = 3 * w + 2 * gap + (reading.unit.isEmpty ? 0 : gap + unitSize * 0.82) + skew
        let theme = QuickTheme(light: scheme == .light)
        let on = theme.segmentOn, off = theme.segmentOff
        Canvas { context, _ in
            var ctx = context
            ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: -slant, d: 1, tx: skew, ty: 0))
            for (index, character) in reading.digits.enumerated() {
                let lit = Segments.lit[character] ?? ""
                for key in "abcdefg" {
                    let path = Segments.path(key, width: w, height: height).offsetBy(dx: CGFloat(index) * (w + gap), dy: 0)
                    ctx.fill(path, with: .color(lit.contains(key) ? (value == nil ? on.opacity(0.4) : on) : off))
                }
            }
            if !reading.unit.isEmpty {
                ctx.draw(Text(reading.unit).font(.system(size: unitSize, weight: .bold)).italic().foregroundStyle(on),
                         at: CGPoint(x: 3 * w + 3 * gap, y: height), anchor: .bottomLeading)
            }
        }
        .frame(width: width, height: height)
        .shadow(color: scheme == .dark ? on.opacity(0.55) : .clear, radius: height * 0.06)
        .shadow(color: scheme == .dark ? on.opacity(0.28) : .clear, radius: height * 0.18)
        .accessibilityHidden(true)
    }
}

enum Segments {
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

/// The phone's radar: the ring splits the selected period's tokens by session in tool colours,
/// largest first from twelve o'clock clockwise; a beam sweeps while tokens flow and the centre
/// shows the period's average speed in tokens per hour.
struct RadarDial: View {
    struct Slice: Identifiable { var id: String; var value: Double; var color: Color }
    var slices: [Slice]
    var average: Double?
    var caption: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme
    @State private var opened = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || !(average ?? 0 > 0))) { timeline in
            dial(at: timeline.date)
        }
        .onAppear { opened = Date() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(caption) 평균 토큰 사용 속도 시간당 \(Format.tokens(average)) tokens")
    }

    private func dial(at date: Date) -> some View {
        let grid = scheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.07)
        let beamColor = scheme == .dark ? Color.segmentOn : Color.mint1top
        return ZStack {
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2), outer = min(size.width, size.height) / 2 - 6
                let inner = outer * 0.74, total = slices.reduce(0) { $0 + $1.value }
                let grow = reduceMotion ? 1 : 1 - pow(1 - min(1, max(0, date.timeIntervalSince(opened) / 0.9)), 3)
                func arc(_ r0: CGFloat, _ r1: CGFloat, _ a0: Double, _ a1: Double) -> Path {
                    Path { p in
                        p.addArc(center: c, radius: r1, startAngle: .degrees(a0), endAngle: .degrees(a1), clockwise: false)
                        p.addArc(center: c, radius: r0, startAngle: .degrees(a1), endAngle: .degrees(a0), clockwise: true)
                        p.closeSubpath()
                    }
                }
                ctx.fill(arc(inner, outer, 0, 360), with: .color(grid))
                for k in 0..<60 where k % 5 == 0 {
                    let a = Double(k) * 6 * .pi / 180 - .pi / 2
                    var tick = Path(); tick.move(to: CGPoint(x: c.x + cos(a) * (inner - 9), y: c.y + sin(a) * (inner - 9)))
                    tick.addLine(to: CGPoint(x: c.x + cos(a) * (inner - 4), y: c.y + sin(a) * (inner - 4)))
                    ctx.stroke(tick, with: .color(grid.opacity(2.2)), lineWidth: 1)
                }
                let sweeping = !reduceMotion && (average ?? 0) > 0
                let head = (date.timeIntervalSinceReferenceDate * 80).truncatingRemainder(dividingBy: 360) - 90
                if total > 0 {
                    var start = -90.0
                    for slice in slices where slice.value > 0 {
                        let span = 360 * slice.value / total * grow
                        let end = start + span, gap = min(1.2, span * 0.3)
                        let mid = (start + end) / 2
                        let behind = ((head - mid).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
                        let lit = sweeping ? exp(-behind / 90) : 0
                        ctx.fill(arc(inner + 1, outer - 1, start + gap / 2, end - gap / 2), with: .color(slice.color.opacity(0.62 + 0.38 * lit)))
                        start = end
                    }
                }
                if sweeping {
                    for j in 0..<14 {
                        ctx.fill(arc(inner, outer, head - Double(j + 1) * 3.5, head - Double(j) * 3.5),
                                 with: .color(beamColor.opacity(0.22 * pow(1 - Double(j) / 14, 1.6))))
                    }
                    let edge = head * .pi / 180
                    var beam = Path(); beam.move(to: CGPoint(x: c.x + cos(edge) * (inner - 2), y: c.y + sin(edge) * (inner - 2)))
                    beam.addLine(to: CGPoint(x: c.x + cos(edge) * (outer + 3), y: c.y + sin(edge) * (outer + 3)))
                    ctx.stroke(beam, with: .color(beamColor), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                }
                var now = Path(); now.addLines([CGPoint(x: c.x - 4, y: c.y - outer - 7), CGPoint(x: c.x + 4, y: c.y - outer - 7), CGPoint(x: c.x, y: c.y - outer - 1)])
                now.closeSubpath()
                ctx.fill(now, with: .color(Color(red: 0.94, green: 0.36, blue: 0.29)))
            }
            VStack(spacing: 4) {
                Text("평균").font(.caption).foregroundStyle(.secondary)
                SegmentDigits(value: average, height: 44)
                Text(average == nil ? "확인 중" : "tokens/시간").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

/// A thin capsule meter for percentages.
struct Meter: View {
    var value: Double?
    var color: Color
    var body: some View {
        GeometryReader { geo in
            Capsule().fill(.quaternary).overlay(alignment: .leading) {
                Capsule().fill(color).frame(width: geo.size.width * min(1, max(0, (value ?? 0) / 100)))
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}
