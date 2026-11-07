import AppKit
import Combine
import SwiftUI

// The dashboard's cluster (계기판) in the menu bar panel, laid out as the web menu bar lays it out (agent/onetop/
// dist/cluster.js and cluster.css, the tray arrangement): the token tachometer and the burn speedometer one above the
// other (or side by side, by the switch beside the logo), the warning lights, the trip with the odometer, each
// account's weekly limit left as fuel, then the window's seven pages under their tabs, the sessions page holding the
// panel's own list. The readings are ClusterReadings, the numbers the dashboard's cluster shows. Each dial turns 240°
// from 0 at the lower left, its figure in the very centre, a short red pointer riding the rim and a faint red zone in
// the top fifth. Needles spring to each reading and shimmer while sessions work; with Reduce Motion they only move.

typealias ClusterRGB = (Double, Double, Double)

private func rgb(_ hex: String) -> ClusterRGB {
    let v = Int(hex.dropFirst(), radix: 16) ?? 0
    return (Double((v >> 16) & 255), Double((v >> 8) & 255), Double(v & 255))
}
private func color(_ c: ClusterRGB, _ alpha: Double = 1) -> Color { Color(red: c.0 / 255, green: c.1 / 255, blue: c.2 / 255).opacity(alpha) }

/// The token lane's colours along the scale: green for the first half, then quickly yellow, orange and red.
private let lane: [(Double, ClusterRGB)] = [(0, rgb("#57d36a")), (0.5, rgb("#57d36a")), (0.62, rgb("#e2e04a")), (0.76, rgb("#ff9a2e")),
                                            (0.88, rgb("#ff3b30")), (1, rgb("#ff3b30"))]
private func colorAt(_ stops: [(Double, ClusterRGB)], _ at: Double) -> ClusterRGB {
    let f = min(1, max(0, at.isFinite ? at : 0))
    var i = 1
    while i < stops.count - 1 && stops[i].0 < f { i += 1 }
    let (f0, c0) = stops[i - 1], (f1, c1) = stops[i], k = f1 > f0 ? min(1, max(0, (f - f0) / (f1 - f0))) : 1
    return ((c0.0 + (c1.0 - c0.0) * k).rounded(), (c0.1 + (c1.1 - c0.1) * k).rounded(), (c0.2 + (c1.2 - c0.2) * k).rounded())
}
/// A tool colour lifted a little, so a darker one still reads as a lit display.
private func lift(_ c: ClusterRGB) -> ClusterRGB { ((c.0 + (255 - c.0) * 0.22).rounded(), (c.1 + (255 - c.1) * 0.22).rounded(), (c.2 + (255 - c.2) * 0.22).rounded()) }

/// The dashboard's colours the cluster uses beyond the panel's own (dashboard.css, cluster.css).
struct ClusterPalette {
    let theme: QuickTheme
    private func pick(_ dark: String, _ day: String) -> Color { color(rgb(theme.light ? day : dark)) }
    var panel2: Color { pick("#161a1e", "#f8f9fa") }
    var lineStrong: Color { pick("#2f363c", "#d3d9de") }
    var faceHi: Color { pick("#1f2428", "#ffffff") }
    var faceLo: Color { pick("#08090a", "#f8f9fa") }
    var halo: Color { pick("#090a0c", "#ffffff") }
    var off: Color { theme.muted.opacity(theme.light ? 0.36 : 0.42) }
    /// The red zone and every needle: a car's red.
    var zone: Color { pick("#ff3b30", "#e0261c") }
    var red: Color { pick("#f08a8a", "#b8403d") }
    /// The lit displays (odometer, range) and the warning lights sit on their own dark plate in both themes.
    static let led = color(rgb("#eef2f4")), plate = color(rgb("#0a0d0f")), strip = color(rgb("#0b0e10")), dark = color(rgb("#454d53"))
}

// MARK: Seven-segment displays

/// Cells for the seven-segment display: digits, a decimal point after cell dp, commas after the cells listed.
struct ClusterCells: Equatable {
    var c: [Character]; var dp: Int? = nil; var commas: [Int] = []; var unit = ""
    /// speed.js digits: three places with k, M or B (108M); dashes without a reading.
    static func tokens(_ v: Double?) -> ClusterCells {
        guard let v, v.isFinite, v >= 0 else { return ClusterCells(c: ["-", "-", "-"]) }
        if v < 0.5 { return ClusterCells(c: [" ", " ", "0"]) }
        func unit(_ n: Double) -> (Double, String) { n >= 1e9 ? (1e9, "B") : n >= 1e6 ? (1e6, "M") : n >= 1e3 ? (1e3, "k") : (1, "") }
        var (d, u) = unit(v), x = (v / d).rounded()
        if x >= 1000 && u != "B" { (d, u) = unit(x * d); x = (v / d).rounded() }
        let s = String(Int(min(999, x)))
        return ClusterCells(c: Array(String(repeating: " ", count: max(0, 3 - s.count)) + s), unit: u)
    }
    /// The burn on three cells with its decimal point: 0.51, 12.4, 135.
    static func burn(_ v: Double?) -> ClusterCells {
        guard let v, v.isFinite, v >= 0 else { return ClusterCells(c: ["-", "-", "-"]) }
        let s = v < 9.995 ? String(format: "%.2f", v) : v < 99.95 ? String(format: "%.1f", v) : String(Int(min(999, v.rounded())))
        let dot = s.firstIndex(of: ".").map { s.distance(from: s.startIndex, to: $0) }
        return ClusterCells(c: Array(s.replacingOccurrences(of: ".", with: "")), dp: dot.map { $0 - 1 })
    }
    /// Only the lit digits are drawn: blank leading cells dropped, so the figure sits centred.
    var lit: ClusterCells {
        let lead = c.firstIndex { $0 != " " } ?? 0
        guard lead > 0 else { return self }
        return ClusterCells(c: Array(c.dropFirst(lead)), dp: dp.map { $0 - lead }, commas: commas.map { $0 - lead }, unit: unit)
    }
}

private enum Segments {
    static let lit: [Character: String] = ["0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd",
                                           "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": ""]
    /// speed.js segPolys on the 40-unit cell: w 22, stroke 4.6, a 0.9 gap at each joint.
    static func path(_ key: Character, w: Double = 22, h: Double = 40, t: Double = 4.6) -> Path {
        let ht = t / 2, g = 0.9
        func horizontal(_ cy: Double, _ x0: Double, _ x1: Double) -> Path {
            Path { p in p.addLines([CGPoint(x: x0, y: cy), CGPoint(x: x0 + ht, y: cy - ht), CGPoint(x: x1 - ht, y: cy - ht),
                                    CGPoint(x: x1, y: cy), CGPoint(x: x1 - ht, y: cy + ht), CGPoint(x: x0 + ht, y: cy + ht)]); p.closeSubpath() }
        }
        func vertical(_ cx: Double, _ y0: Double, _ y1: Double) -> Path {
            Path { p in p.addLines([CGPoint(x: cx, y: y0), CGPoint(x: cx + ht, y: y0 + ht), CGPoint(x: cx + ht, y: y1 - ht),
                                    CGPoint(x: cx, y: y1), CGPoint(x: cx - ht, y: y1 - ht), CGPoint(x: cx - ht, y: y0 + ht)]); p.closeSubpath() }
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

/// The dashboard's seven-segment figure (speed.js seg7): only lit segments, a 1 centred in its cell, slanted 9°, glowing
/// on the dark theme. height is the display's box, the digits' 40 units plus their tail.
private struct ClusterLCD: View {
    var cells: ClusterCells
    var height: CGFloat
    var color: Color
    var glow: Bool
    private static let h = 40.0, w = 22.0, gap = 6.0, t = 4.6, us = 18.4, slant = tan(9 * Double.pi / 180)
    var body: some View {
        let g = cells.lit, h = Self.h, w = Self.w, gap = Self.gap, t = Self.t, room = t * 1.2
        let marks: [(Int, Bool)] = (g.dp.map { [($0, false)] } ?? []) + g.commas.map { ($0, true) }
        let bodyWidth = Double(g.c.count - 1) * (w + gap) + w + (g.unit.isEmpty ? 0 : gap + Self.us * 0.8) + room * Double(marks.count)
        let box = ceil(bodyWidth + h * Self.slant + 2), k = Double(height) / (h + (g.commas.isEmpty ? 2 : 8))
        Canvas { context, _ in
            var ctx = context
            ctx.scaleBy(x: k, y: k); ctx.translateBy(x: 0, y: 1)
            let x0 = (box - (bodyWidth + h * Self.slant)) / 2
            ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: -Self.slant, d: 1, tx: x0 + Self.slant * h, ty: 0))
            func at(_ i: Int) -> Double { Double(i) * (w + gap) + room * Double(marks.filter { $0.0 < i }.count) }
            var lit = Path()
            for (i, ch) in g.c.enumerated() {
                let x = at(i) - (ch == "1" ? w / 2 - t / 2 : 0)
                for key in Segments.lit[ch] ?? "" { lit.addPath(Segments.path(key), transform: CGAffineTransform(translationX: x, y: 0)) }
            }
            for (i, comma) in marks {
                let d = t * 1.05, x = at(i) + w + (gap + room - d) / 2
                lit.addRoundedRect(in: CGRect(x: x, y: h - d, width: d, height: d), cornerSize: CGSize(width: d * 0.22, height: d * 0.22))
                if comma {
                    lit.move(to: CGPoint(x: x + d, y: h - d * 0.3)); lit.addLine(to: CGPoint(x: x + d, y: h + d * 0.55))
                    lit.addLine(to: CGPoint(x: x - d * 0.15, y: h + d * 1.45)); lit.addLine(to: CGPoint(x: x + d * 0.3, y: h)); lit.closeSubpath()
                }
            }
            ctx.fill(lit, with: .color(color))
            if !g.unit.isEmpty {
                ctx.draw(Text(g.unit).font(.system(size: Self.us, weight: .bold).italic()).foregroundColor(color),
                         at: CGPoint(x: at(g.c.count - 1) + w + gap, y: h + 3), anchor: .bottomLeading)
            }
        }
        .frame(width: CGFloat(box * k), height: height)
        .shadow(color: glow ? color.opacity(0.55) : .clear, radius: CGFloat(2.3 * k))
        .accessibilityHidden(true)
    }
}

/// A car's lit display on its own dark plate: the odometer and the range.
private struct ClusterLED<Content: View>: View {
    var size: CGFloat
    var early = false
    /// The drum face sits closer to the plate's edge (cluster.css .cl-wheels[data-face=drum]).
    var drum = false
    var palette: ClusterPalette
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(.vertical, size * (drum ? 0.2 : 0.24)).padding(.horizontal, size * (drum ? 0.3 : 0.5))
            .background(ClusterPalette.plate, in: RoundedRectangle(cornerRadius: size * 0.45))
            .overlay(RoundedRectangle(cornerRadius: size * 0.45).stroke(early ? palette.red.opacity(0.5) : palette.theme.line.opacity(0.7), lineWidth: 1))
            .shadow(color: early ? palette.red.opacity(0.6) : .clear, radius: early ? 5 : 0)
    }
}

// MARK: Icons

/// The warning lights' symbols on a 24-unit grid (cluster.js ICON). Working wears the sessions' working bars and
/// waiting the warning triangle, so a light and the rows it filters look alike.
enum ClusterIcon: String {
    case live, working, waiting, done, reconnect, empty
    var path: Path {
        var p = Path()
        func line(_ a: CGPoint, _ b: CGPoint) { p.move(to: a); p.addLine(to: b) }
        switch self {
        case .live:
            for r in [9.6, 4.8] {
                p.move(to: CGPoint(x: 12 + r * cos(Double.pi * 0.75), y: 12 + r * sin(Double.pi * 0.75)))
                p.addArc(center: CGPoint(x: 12, y: 12), radius: r, startAngle: .degrees(135), endAngle: .degrees(225), clockwise: false)
                p.move(to: CGPoint(x: 12 + r * cos(-Double.pi * 0.25), y: 12 + r * sin(-Double.pi * 0.25)))
                p.addArc(center: CGPoint(x: 12, y: 12), radius: r, startAngle: .degrees(315), endAngle: .degrees(405), clockwise: false)
            }
        case .working:
            line(CGPoint(x: 6.5, y: 19), CGPoint(x: 6.5, y: 13)); line(CGPoint(x: 12, y: 19), CGPoint(x: 12, y: 5)); line(CGPoint(x: 17.5, y: 19), CGPoint(x: 17.5, y: 10))
        case .waiting:
            p.addLines([CGPoint(x: 12, y: 3.6), CGPoint(x: 21.6, y: 20), CGPoint(x: 2.4, y: 20)]); p.closeSubpath()
            line(CGPoint(x: 12, y: 9.6), CGPoint(x: 12, y: 14.6))
        case .done:
            p.move(to: CGPoint(x: 8.5, y: 4))
            p.addArc(tangent1End: CGPoint(x: 5, y: 4), tangent2End: CGPoint(x: 5, y: 20), radius: 1.8)
            p.addArc(tangent1End: CGPoint(x: 5, y: 20), tangent2End: CGPoint(x: 8.5, y: 20), radius: 1.8); p.addLine(to: CGPoint(x: 8.5, y: 20))
            p.move(to: CGPoint(x: 15.5, y: 4))
            p.addArc(tangent1End: CGPoint(x: 19, y: 4), tangent2End: CGPoint(x: 19, y: 20), radius: 1.8)
            p.addArc(tangent1End: CGPoint(x: 19, y: 20), tangent2End: CGPoint(x: 15.5, y: 20), radius: 1.8); p.addLine(to: CGPoint(x: 15.5, y: 20))
            for y in [9.0, 12, 15] { line(CGPoint(x: 9, y: y), CGPoint(x: 15, y: y)) }
        case .reconnect:
            p.move(to: CGPoint(x: 10, y: 14.2)); p.addLine(to: CGPoint(x: 8.1, y: 16.1))
            p.addArc(center: CGPoint(x: 5.75, y: 13.75), radius: 3.32, startAngle: .degrees(45), endAngle: .degrees(225), clockwise: false)
            p.addLine(to: CGPoint(x: 5.3, y: 9.5))
            p.move(to: CGPoint(x: 14, y: 9.8)); p.addLine(to: CGPoint(x: 15.9, y: 7.9))
            p.addArc(center: CGPoint(x: 18.25, y: 10.25), radius: 3.32, startAngle: .degrees(225), endAngle: .degrees(405), clockwise: false)
            p.addLine(to: CGPoint(x: 18.7, y: 14.5))
            line(CGPoint(x: 8.2, y: 3.6), CGPoint(x: 8.2, y: 6.2)); line(CGPoint(x: 3.6, y: 8.2), CGPoint(x: 6.2, y: 8.2))
            line(CGPoint(x: 15.8, y: 20.4), CGPoint(x: 15.8, y: 17.8)); line(CGPoint(x: 20.4, y: 15.8), CGPoint(x: 17.8, y: 15.8))
        case .empty:
            p.move(to: CGPoint(x: 5, y: 20.4))
            p.addArc(tangent1End: CGPoint(x: 5, y: 4), tangent2End: CGPoint(x: 14.4, y: 4), radius: 1.6)
            p.addArc(tangent1End: CGPoint(x: 14.4, y: 4), tangent2End: CGPoint(x: 14.4, y: 20.4), radius: 1.6); p.addLine(to: CGPoint(x: 14.4, y: 20.4))
            line(CGPoint(x: 3.4, y: 20.4), CGPoint(x: 16, y: 20.4)); line(CGPoint(x: 7.4, y: 8.2), CGPoint(x: 12.4, y: 8.2))
            p.move(to: CGPoint(x: 14.4, y: 10.6))
            p.addArc(tangent1End: CGPoint(x: 17.2, y: 10.6), tangent2End: CGPoint(x: 17.2, y: 16.2), radius: 1.4); p.addLine(to: CGPoint(x: 17.2, y: 16.2))
            p.addArc(center: CGPoint(x: 18.7, y: 16.2), radius: 1.5, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
            p.addLine(to: CGPoint(x: 20.2, y: 8.6)); p.addLine(to: CGPoint(x: 18, y: 6.4))
        }
        return p
    }
    /// Filled dots: the live light's centre and the triangle's point.
    var dot: CGPoint? { self == .live ? CGPoint(x: 12, y: 12) : self == .waiting ? CGPoint(x: 12, y: 17.2) : nil }
    var width: Double { self == .working ? 3 : 1.8 }
}

struct ClusterGlyph: View {
    var icon: ClusterIcon
    var color: Color
    var size: CGFloat
    var body: some View {
        Canvas { ctx, _ in
            let k = size / 24
            ctx.scaleBy(x: k, y: k)
            ctx.stroke(icon.path, with: .color(color), style: StrokeStyle(lineWidth: icon.width, lineCap: .round, lineJoin: .round))
            if let d = icon.dot { ctx.fill(Path(ellipseIn: CGRect(x: d.x - 1.5, y: d.y - 1.5, width: 3, height: 3)), with: .color(color)) }
        }
        .frame(width: size, height: size).accessibilityHidden(true)
    }
}

// MARK: Housing

/// The housing: its upper corners share the dials' centres, the lower ones are small.
private struct ClusterHousing: Shape {
    var rx: CGFloat; var ry: CGFloat; var rb: CGFloat
    func path(in r: CGRect) -> Path {
        let rx = min(rx, r.width / 2), ry = min(ry, max(0, r.height - rb)), rb = min(rb, r.width / 2), k: CGFloat = 0.5523
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY + ry))
        p.addCurve(to: CGPoint(x: r.minX + rx, y: r.minY), control1: CGPoint(x: r.minX, y: r.minY + ry * (1 - k)), control2: CGPoint(x: r.minX + rx * (1 - k), y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - rx, y: r.minY))
        p.addCurve(to: CGPoint(x: r.maxX, y: r.minY + ry), control1: CGPoint(x: r.maxX - rx * (1 - k), y: r.minY), control2: CGPoint(x: r.maxX, y: r.minY + ry * (1 - k)))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - rb))
        p.addArc(tangent1End: CGPoint(x: r.maxX, y: r.maxY), tangent2End: CGPoint(x: r.maxX - rb, y: r.maxY), radius: rb)
        p.addLine(to: CGPoint(x: r.minX + rb, y: r.maxY))
        p.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.minX, y: r.maxY - rb), radius: rb)
        p.closeSubpath()
        return p
    }
}

// MARK: Dial

/// cl-shimmer's keyframes: a needle's wobble in degrees across one turn.
private let shimmerKeys: [(Double, Double)] = [(0, 0), (0.17, 2.4), (0.31, -1.1), (0.48, 3), (0.63, 0.4), (0.79, -2), (0.91, 1.2), (1, 0)]
/// Fuel gauges' centre-to-centre spacing by how many show: 2–4 → 58, 5 → 56, 6 → 54, 7 → 50, 8 → 47.
private let fuelPitch: [CGFloat] = [0, 58, 58, 58, 58, 56, 54, 50, 47]
private let goalLabels = ["active": "활성", "complete": "완료", "paused": "일시정지", "blocked": "차단됨", "cleared": "해제됨",
                          "failed": "달성 불가", "budget_limit": "예산 한도", "usage_limit": "사용 한도"]

/// One dial on the 340-unit face of cluster.js: rim, faint rings, the lane faint along the scale and lit to the reading,
/// ticks and numbers with the red zone, each account's mark on the rim and the red pointer; the figure in the centre,
/// its unit, the name and the display below it.
private struct ClusterDial<Name: View, Display: View>: View {
    var d: CGFloat
    var zoom: CGFloat
    var palette: ClusterPalette
    var scale: ClusterReadings.Scale
    var number: (Double) -> String
    var fraction: Double
    var stops: [(Double, ClusterRGB)]
    var marks: [(f: Double, color: Color)] = []
    var figure: ClusterCells
    var figureColor: Color
    var unit: String
    var running: Bool
    /// The shimmer's turn in seconds, its start and whether it runs backwards, so the two needles never move together.
    var shimmer: (period: Double, delay: Double, reverse: Bool)
    var testing: Bool
    var igniting: Bool
    var name: Name
    var display: Display
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var s: CGFloat { d / 340 }
    private var small: Bool { d / zoom < 280 }
    private var tiny: Bool { d / zoom < 200 }
    private var shown: Double { testing ? 1 : min(1, max(0, fraction.isFinite ? fraction : 0)) }
    private func point(_ f: Double, _ r: Double, turn: Double = 0) -> CGPoint {
        let a = (150 + 240 * f) * Double.pi / 180 + turn
        return CGPoint(x: Double(d) / 2 + r * Double(s) * cos(a), y: Double(d) / 2 + r * Double(s) * sin(a))
    }
    private func arc(_ f0: Double, _ f1: Double, _ r: Double) -> Path {
        Path { p in p.addArc(center: CGPoint(x: d / 2, y: d / 2), radius: r * s, startAngle: .degrees(150 + 240 * f0), endAngle: .degrees(150 + 240 * f1), clockwise: false) }
    }
    private func lanePieces(_ ctx: inout GraphicsContext) {
        let n = 96
        for i in 0..<n {
            let f0 = Double(i) / Double(n), f1 = min(1, (Double(i) + 1.15) / Double(n))
            ctx.stroke(arc(f0, f1, 147), with: .color(color(colorAt(stops, (Double(i) + 0.5) / Double(n)))), lineWidth: 5 * s)
        }
    }
    private var face: some View {
        Canvas { context, _ in
            let ctx = context
            let c = CGPoint(x: d / 2, y: d / 2), ink = palette.theme.ink
            ctx.fill(Path(ellipseIn: CGRect(x: 0, y: 0, width: d, height: d)),
                     with: .radialGradient(Gradient(colors: [palette.faceHi, palette.faceLo]), center: CGPoint(x: c.x, y: 142.8 * s), startRadius: 0, endRadius: 187.5 * s))
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - 160 * s, y: c.y - 160 * s, width: 320 * s, height: 320 * s)), with: .color(palette.lineStrong), lineWidth: 2 * s)
            for (r, dash) in [(118.0, false), (92, true), (66, false)] {
                let rr = CGFloat(r) * s
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - rr, y: c.y - rr, width: 2 * rr, height: 2 * rr)), with: .color(ink.opacity(0.07)),
                           style: StrokeStyle(lineWidth: 1.2 * s, dash: dash ? [2 * s, 6 * s] : []))
            }
            ctx.stroke(arc(0, 1, 147), with: .color(ink.opacity(0.08)), lineWidth: 5 * s)
            var faint = ctx; faint.opacity = 0.2; lanePieces(&faint)
            ctx.stroke(arc(0.8, 1, 155), with: .color(palette.zone.opacity(0.5)), lineWidth: 3.5 * s)
            // Ticks every minor step, the majors longer; lit up to the reading in the lane's colour, the top fifth red.
            let count = Int((scale.max / scale.minor).rounded()), lit = shown
            for i in 0...max(0, count) {
                let v = Double(i) * scale.minor, f = v / scale.max, major = abs(v / scale.major - (v / scale.major).rounded()) < 1e-6
                let red = f >= 0.8 - 1e-4, on = f <= lit + 1e-4
                let stroke: Color = red ? (on ? palette.zone : palette.zone.opacity(0.55)) : on ? color(colorAt(stops, f)) : palette.off
                var tick = Path(); tick.move(to: point(f, major ? 122 : 131)); tick.addLine(to: point(f, 141))
                ctx.stroke(tick, with: .color(stroke), style: StrokeStyle(lineWidth: (major ? 3 : 1.5) * s, lineCap: .round))
                guard major else { continue }
                // 0 and the full-scale number sit past the ends of the scale, in the corners of the opening.
                let end: Double = f < 1e-6 ? -1 : f > 1 - 1e-6 ? 1 : 0
                let size = (tiny ? 23.0 : small ? 20 : 18) * Double(s)
                ctx.draw(Text(number(v)).font(.system(size: size, weight: .semibold)).monospacedDigit()
                            .foregroundColor(red ? palette.zone : ink.opacity(0.74)),
                         at: point(f, end != 0 ? 126 : 100, turn: end * 10 * Double.pi / 180), anchor: .center)
            }
            for mark in marks {
                let f = min(1, max(0, mark.f))
                var tri = Path(); tri.addLines([point(f, 137), point(f, 157, turn: 0.045), point(f, 157, turn: -0.045)]); tri.closeSubpath()
                ctx.fill(tri, with: .color(mark.color))
                ctx.stroke(tri, with: .color(palette.faceLo), style: StrokeStyle(lineWidth: 1.5 * s, lineJoin: .round))
            }
        }
    }
    /// The lane lit up to the reading: the whole lane, shown through an arc that springs with the needle.
    private var litLane: some View {
        Canvas { context, _ in var ctx = context; lanePieces(&ctx) }
            .mask(
                Circle().trim(from: 0, to: CGFloat(shown * 240 / 360))
                    .stroke(style: StrokeStyle(lineWidth: 5 * s, lineCap: .round))
                    .rotationEffect(.degrees(150))
                    .frame(width: 294 * s, height: 294 * s)
            )
            .shadow(color: color(colorAt(stops, shown)).opacity(0.45), radius: 4 * s)
    }
    /// The short red pointer riding the rim, with no hub across the figure.
    private var pointer: some View {
        Path { p in
            let c = d / 2
            p.addLines([CGPoint(x: c + 106 * s, y: c - 4 * s), CGPoint(x: c + 148 * s, y: c - 1.2 * s),
                        CGPoint(x: c + 148 * s, y: c + 1.2 * s), CGPoint(x: c + 106 * s, y: c + 4 * s)])
            p.closeSubpath()
        }
        .fill(palette.zone)
        .shadow(color: palette.theme.light ? .black.opacity(0.3) : palette.zone.opacity(0.55), radius: palette.theme.light ? 1.5 : 3)
        .shadow(color: palette.theme.light ? .clear : .black.opacity(0.55), radius: 5)
        .frame(width: d, height: d)
    }
    /// A running engine: the needle wavers within ±3° of its reading (cl-shimmer), easing between its keyframes.
    private func wobble(_ t: Double) -> Double {
        var p = ((t - shimmer.delay) / shimmer.period).truncatingRemainder(dividingBy: 1)
        if p < 0 { p += 1 }
        if shimmer.reverse { p = 1 - p }
        for i in 1..<shimmerKeys.count where p <= shimmerKeys[i].0 {
            let (p0, v0) = shimmerKeys[i - 1], (p1, v1) = shimmerKeys[i], k = (p - p0) / (p1 - p0), e = k * k * (3 - 2 * k)
            return v0 + (v1 - v0) * e
        }
        return 0
    }
    var body: some View {
        let motion: Animation? = reduceMotion ? nil : igniting ? .easeInOut(duration: 0.72) : .spring(response: 0.95, dampingFraction: 0.62)
        let ring = max(4 * zoom, 0.016 * d)
        let fig = (small ? 0.112 : 0.135) * d
        let unitSize = max((small ? 9.5 : 10.5) * zoom, 0.04 * d)
        ZStack {
            Circle().stroke(palette.theme.light ? palette.theme.line.opacity(0.6) : palette.theme.background.opacity(0.7), lineWidth: ring).padding(-ring / 2)
            face
            litLane.animation(motion, value: shown)
            Group {
                if running && !reduceMotion {
                    TimelineView(.animation(minimumInterval: 1.0 / 30)) { t in pointer.rotationEffect(.degrees(wobble(t.date.timeIntervalSinceReferenceDate))) }
                } else { pointer }
            }
            .rotationEffect(.degrees(150 + 240 * shown)).animation(motion, value: shown)
            ClusterLCD(cells: figure, height: fig, color: figureColor, glow: !palette.theme.light)
                .shadow(color: palette.theme.light ? .clear : palette.halo, radius: 0.012 * d)
                .position(x: d / 2, y: d / 2)
            Text(unit).font(.system(size: unitSize, weight: .semibold)).foregroundStyle(palette.theme.ink.opacity(0.84)).lineLimit(1).fixedSize()
                .shadow(color: palette.halo, radius: unitSize * 0.5)
                .position(x: d / 2, y: d / 2 + 0.102 * d)
            if !tiny { name.position(x: d / 2, y: d / 2 + 0.154 * d) }
            display.position(x: d / 2, y: d / 2 + 0.29 * d)
        }
        .frame(width: d, height: d)
        .background(Circle().fill(palette.faceLo).shadow(color: .black.opacity(palette.theme.light ? 0.12 : 0.45), radius: (palette.theme.light ? 8 : 12) * zoom, y: (palette.theme.light ? 7 : 10) * zoom))
    }
}

// MARK: Odometer

/// One wheel of the drum face (cluster.css .cl-wheels[data-face=drum] i): printed digits on a strip in their own shaded
/// window, the strip standing at place, a glyph's height a step.
private struct ClusterDrum: View {
    var glyphs: [String]
    var place: Double
    var size: CGFloat
    var zoom: CGFloat
    static func cell(_ size: CGFloat) -> CGFloat { size * 1.1 * 1.25 }
    static func width(_ size: CGFloat) -> CGFloat { size * 1.1 * 0.78 }
    private static let shade = Gradient(stops: [.init(color: .black, location: 0), .init(color: color(rgb("#1d2226")), location: 0.22),
                                                .init(color: color(rgb("#2a3034")), location: 0.5), .init(color: color(rgb("#1d2226")), location: 0.78),
                                                .init(color: .black, location: 1)])
    var body: some View {
        let cell = Self.cell(size), w = Self.width(size), shape = RoundedRectangle(cornerRadius: 3 * zoom)
        VStack(spacing: 0) {
            ForEach(glyphs.indices, id: \.self) { k in
                Text(glyphs[k]).font(.system(size: size * 1.1, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(ClusterPalette.led).frame(width: w, height: cell)
            }
        }
        .offset(y: -CGFloat(place) * cell)
        .frame(width: w, height: cell, alignment: .top)
        .background(LinearGradient(gradient: Self.shade, startPoint: .top, endPoint: .bottom))
        .overlay(shape.strokeBorder(Color.white.opacity(0.05), lineWidth: 1))
        .clipShape(shape)
    }
}

/// The odometer rolls like a car's: each digit a wheel that only ever turns up (9 rolls on to 0), the count never goes
/// back while the period stays, and it moves once every three seconds, slowly. Printed digits, each in its own shaded
/// window (the drum face), no leading zeros.
private struct ClusterOdometer: View {
    var tokens: Double?
    var climb: Double
    var readAt: Date
    var period: String
    var size: CGFloat
    var zoom: CGFloat
    var palette: ClusterPalette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double?
    @State private var shownPeriod = ""
    /// Each wheel's place on a strip of 0–9 twice, so a wheel passing 9 keeps turning up.
    @State private var wheels: [Double] = []
    private let tick = Timer.publish(every: 3, on: .main, in: .common).autoconnect()
    private static let strip = (0..<20).map { String($0 % 10) }
    var body: some View {
        let n = wheels.count
        ClusterLED(size: size, drum: true, palette: palette) {
            HStack(alignment: .bottom, spacing: 2 * zoom) {
                ForEach(0..<n, id: \.self) { i in
                    if i > 0 && (n - i) % 3 == 0 {
                        Text(",").font(.system(size: size * 1.1, weight: .semibold)).foregroundStyle(color(rgb("#8a949b")))
                            .frame(height: ClusterDrum.cell(size), alignment: .bottom).padding(.horizontal, -zoom)
                    }
                    ClusterDrum(glyphs: Self.strip, place: wheels[i], size: size, zoom: zoom)
                }
                if n == 0 { ClusterDrum(glyphs: Self.strip, place: 0, size: size, zoom: zoom) }
            }
        }
        .onAppear { roll(force: true) }
        .onReceive(tick) { _ in roll(force: false) }
        .onChange(of: period) { _ in roll(force: true) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel((shown.map { DesktopFormat.number($0) } ?? "—") + " tokens")
    }
    private func roll(force: Bool) {
        let elapsed = reduceMotion ? 0 : min(30, max(0, Date().timeIntervalSince(readAt)))
        let target = max(0, min(9_999_999_999, ((tokens ?? 0) + climb * elapsed).rounded()))
        if shownPeriod != period { shownPeriod = period; shown = nil }
        let total = shown.map { max($0, target) } ?? target
        guard force || shown == nil || total != shown else { return }
        shown = total
        let digits = String(Int(total)).compactMap { $0.wholeNumberValue }.map(Double.init)
        if digits.count != wheels.count || reduceMotion {
            var t = Transaction(); t.disablesAnimations = true
            withTransaction(t) { wheels = digits }
            return
        }
        // Up only: a wheel that would go down turns on past 9 to the digit on the strip's second turn, then settles.
        let next = zip(wheels, digits).map { was, d in d >= was.truncatingRemainder(dividingBy: 10) ? d : d + 10 }
        withAnimation(.timingCurve(0.22, 0.8, 0.3, 1, duration: 1.6)) { wheels = next }
        if next.contains(where: { $0 >= 10 }) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.65) {
                var t = Transaction(); t.disablesAnimations = true
                withTransaction(t) { wheels = wheels.map { $0.truncatingRemainder(dividingBy: 10) } }
            }
        }
    }
}

/// The range rolls on the odometer's drum wheels (cluster.js rangeWheels): a wheel per digit that turns either way to
/// the new hour (4.6, 23, 140), the point between them, dashes without a reading. A new shape of digits shows at once.
private struct ClusterRangeWheels: View {
    var hours: Double?
    var size: CGFloat
    var zoom: CGFloat
    var early: Bool
    var palette: ClusterPalette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shape = ""
    @State private var places: [Double] = []
    private static let strip = (0..<10).map(String.init) + ["-"]
    static func text(_ h: Double?) -> String {
        guard let h, h.isFinite, h >= 0 else { return "--" }
        return h < 9.95 ? String(format: "%.1f", h) : String(Int(min(999, h.rounded())))
    }
    var body: some View {
        let s = Self.text(hours), chars = Array(shape.isEmpty ? s.map { $0 == "." ? "." : "0" } : Array(shape))
        var k = -1
        let slots: [(dot: Bool, i: Int)] = chars.map { c in c == "." ? (true, k) : { k += 1; return (false, k) }() }
        ClusterLED(size: size, early: early, drum: true, palette: palette) {
            HStack(alignment: .bottom, spacing: 2 * zoom) {
                ForEach(slots.indices, id: \.self) { j in
                    if slots[j].dot {
                        Text(".").font(.system(size: size * 1.1, weight: .semibold)).foregroundStyle(ClusterPalette.led)
                            .frame(height: ClusterDrum.cell(size), alignment: .bottom).padding(.horizontal, zoom)
                    } else {
                        ClusterDrum(glyphs: Self.strip, place: slots[j].i < places.count ? places[slots[j].i] : 10, size: size, zoom: zoom)
                    }
                }
            }
        }
        .onAppear { take(s) }
        .onChange(of: s) { take($0) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(hours == nil ? "—" : s + " 시간")
    }
    private func take(_ s: String) {
        let next = s.compactMap { $0 == "." ? nil : $0 == "-" ? 10.0 : $0.wholeNumberValue.map(Double.init) }
        let form = String(s.map { $0 == "." ? "." : "0" })
        if form != shape || places.count != next.count || reduceMotion {
            var t = Transaction(); t.disablesAnimations = true
            withTransaction(t) { shape = form; places = next }
            return
        }
        withAnimation(.timingCurve(0.22, 0.8, 0.3, 1, duration: 1.6)) { places = next }
    }
}

// MARK: The cluster

/// What the sessions page asks of the panel's own list: which rows (nil for all), the row picked and how to pick one.
struct ClusterSessions {
    var ids: [String]?
    var picked: String?
    var choose: (String) -> Void
}

struct QuickCluster<SessionsPage: View>: View {
    @ObservedObject var model: DashboardModel
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    /// "최근 1시간": the period the panel's picker chose.
    var caption: String
    @ViewBuilder var sessionsPage: (ClusterSessions) -> SessionsPage
    @AppStorage("clusterTripStart") private var tripStart: Double = 0
    @AppStorage("clusterLayout") private var layout = "stack"
    @AppStorage("clusterMode") private var mode = "sessions"
    @State private var pick: ClusterReadings.Pick?
    @State private var only: String?
    @State private var hold = ClusterReadings.Hold()
    @State private var readAt = Date()
    @State private var testing = false
    @State private var igniting = false
    @State private var history = ClusterHeat.Load()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var palette: ClusterPalette { ClusterPalette(theme: theme) }
    private var now: Double { model.now.timeIntervalSince1970 }
    private static var accountTells: Set<String> { ["reconnect", "empty"] }
    private static var modes: [(String, String)] { [("sessions", "세션"), ("flow", "토큰 흐름"), ("weekly", "한도"), ("map", "사용량 맵"), ("heat", "히트맵"), ("goals", "목적지"), ("system", "리소스")] }
    private func readings() -> ClusterReadings {
        let filter = only.flatMap { Self.accountTells.contains($0) ? nil : $0 }
        return ClusterReadings(snapshot: model.snapshot, sessions: model.sessions, period: model.selectedPeriod, now: now, pick: pick, only: filter,
                               trip: tripStart > 0 ? tripStart : nil, hold: hold)
    }
    private func count(_ r: ClusterReadings, _ kind: String) -> Int {
        switch kind {
        case "working": r.working
        case "waiting": r.tells.waiting.count
        case "done": r.tells.done.count
        case "reconnect": r.tells.reconnect.count
        case "empty": r.tells.empty.count
        default: 0
        }
    }

    var body: some View {
        let r = readings()
        // A pressed warning whose count went to nothing lets go.
        let only = self.only.flatMap { count(r, $0) > 0 ? $0 : nil }
        let pair = layout == "pair"
        let px = m(12), pt = m(12), col = m(10), gap = m(12), rb = m(26)
        let content = m(440 - 28) - 2 * px
        let d = pair ? min(m(360), (content - col) / 2) : min(m(280), content)
        let ox = pair ? max(0, (content - 2 * d - col) / 2) : (content - d) / 2
        let rx = pair ? px + ox + d / 2 : px + content / 2, ry = pair ? rx : pt + content / 2
        // From 220px the odometer sits in the token dial's lower opening; smaller dials keep it in the lower row.
        let odoInDial = d >= m(220)
        VStack(spacing: gap) {
            if pair {
                HStack(spacing: col) { tach(r, d: d, odo: odoInDial); speed(r, d: d) }.padding(.top, ox)
            } else {
                tach(r, d: d, odo: odoInDial).padding(.top, ox)
                speed(r, d: d)
            }
            tells(r, only: only)
            HStack(spacing: m(14)) {
                if !odoInDial { lowerOdometer(r) }
                trip(r)
            }.frame(maxWidth: .infinity)
            fuel(r, room: content - m(8))
            window(r, only: only, px: px)
        }
        .padding(.horizontal, px).padding(.top, pt).padding(.bottom, rb)
        .background(
            ClusterHousing(rx: rx, ry: ry, rb: rb)
                .fill(LinearGradient(stops: [.init(color: palette.panel2, location: 0), .init(color: theme.card, location: 0.55), .init(color: theme.background, location: 1)],
                                     startPoint: .top, endPoint: .bottom))
                .overlay(ClusterHousing(rx: rx, ry: ry, rb: rb).stroke(theme.line))
                .shadow(color: .black.opacity(theme.light ? 0.07 : 0.35), radius: m(20), y: m(18))
        )
        .onAppear {
            if tripStart <= 0 { tripStart = Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 }
            ignite()
        }
        .onChange(of: model.snapshot?.updated) { _ in
            readAt = Date()
            let r = readings()
            if pick != nil && !r.speed.picked { pick = nil }
            if let o = self.only, count(r, o) == 0 { self.only = nil }
        }
        .onExitCommand { if pick != nil { pick = nil } else { self.only = nil } }
        .accessibilityElement(children: .contain).accessibilityLabel(tr("계기판"))
    }
    /// Ignition: when the view opens both needles test full scale, then settle on their readings.
    private func ignite() {
        guard !reduceMotion else { return }
        igniting = true; testing = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.72) { testing = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { igniting = false }
    }

    // MARK: Dials
    private func tach(_ r: ClusterReadings, d: CGFloat, odo inDial: Bool) -> some View {
        let full = r.tach.full, div = full >= 1e9 ? 1e9 : 1e6, unit = div == 1e9 ? "B" : "M"
        let f = r.tach.rate.map { $0 / full } ?? 0
        let tone: Color = r.tach.rate == nil ? theme.muted : color(colorAt(lane, f))
        let small = d / m.zoom < 280, chip = max(m(small ? 9.5 : 10), 0.032 * d), led = max(m(11), 0.042 * d)
        return ClusterDial(d: d, zoom: m.zoom, palette: palette, scale: ClusterReadings.marks(full / div),
                           number: { $0 == 0 ? "0" : ClusterReadings.scaleNumber($0) + unit }, fraction: f, stops: lane,
                           figure: .tokens(r.tach.rate), figureColor: tone, unit: "tokens/시간", running: r.working > 0 && !reduceMotion,
                           shimmer: (2.3, 0, false), testing: testing, igniting: igniting,
                           name: dialName(Text(tr("토큰 속도")), d: d),
                           display: Group {
                               if inDial {
                                   VStack(spacing: led * 0.3) {
                                       if !small { Text("합계").font(.system(size: chip, weight: .semibold)).foregroundStyle(theme.muted) }
                                       odometer(r, size: led)
                                   }.help("합계 · " + caption)
                               }
                           })
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(tr("토큰 속도")) \(r.tach.rate.map(Self.figure) ?? "—") tokens/시간 · \(caption)")
    }
    private func speed(_ r: ClusterReadings, d: CGFloat) -> some View {
        let sub = r.speed.subject, picked = sub != nil && sub?.type != .all
        let tone = lift(picked ? AgentPalette.rgb(sub?.kind ?? "") : rgb("#6ccfa9"))
        let figure: Color = r.speed.value == nil ? theme.muted : color(tone)
        let marks = (r.speed.multi ?? []).map { (f: $0.value / r.speed.max, color: AgentPalette.color($0.kind)) }
        return ClusterDial(d: d, zoom: m.zoom, palette: palette, scale: ClusterReadings.marks(r.speed.max), number: ClusterReadings.scaleNumber,
                           fraction: r.speed.value.map { $0 / r.speed.max } ?? 0, stops: [(0, tone), (1, tone)], marks: marks,
                           figure: .burn(r.speed.value), figureColor: figure, unit: "%/시간", running: r.working > 0 && !reduceMotion,
                           shimmer: (3.1, -1.2, true), testing: testing, igniting: igniting,
                           name: subjectName(r, d: d), display: range(r, d: d))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("\(tr("한도 소진")) \(ClusterReadings.reading(r.speed.value))%/시간")
    }
    private func nameSize(_ d: CGFloat) -> CGFloat { max(m(d / m.zoom < 280 ? 9.5 : 10), 0.036 * d) }
    private func dialName(_ text: Text, d: CGFloat) -> some View {
        text.font(.system(size: nameSize(d), weight: .semibold)).kerning(nameSize(d) * 0.04).foregroundColor(theme.muted).lineLimit(1).fixedSize()
            .shadow(color: palette.halo, radius: nameSize(d) * 0.5)
    }
    /// The burn dial's name line names its subject: 한도 소진 · 전체 AI, a session's model and effort, or an account.
    private func subjectName(_ r: ClusterReadings, d: CGFloat) -> some View {
        let sub = r.speed.subject, size = nameSize(d)
        let account = r.accounts.first { $0.id == sub?.account }
        return HStack(spacing: size * 0.4) {
            if let sub, sub.type != .all {
                Circle().fill(AgentPalette.color(sub.kind ?? "")).frame(width: size * 0.6, height: size * 0.6)
                if sub.type == .session, let s = sub.session {
                    Text(s.model.map(Self.modelName) ?? (s.project ?? s.kind)).foregroundStyle(theme.ink).lineLimit(1).truncationMode(.tail)
                    if let effort = s.reportedEffort {
                        Text(effort).padding(.horizontal, size * 0.4).background(theme.raised, in: RoundedRectangle(cornerRadius: size * 0.4))
                    }
                } else {
                    Text(account.map(Self.tool) ?? (sub.kind ?? "")).foregroundStyle(theme.ink)
                    if let plan = account.map(Self.plan), !plan.isEmpty { Text(plan) }
                }
            } else {
                Text(tr("한도 소진")) + Text(" · 전체 AI").foregroundColor(theme.accent)
            }
        }
        .font(.system(size: size, weight: .semibold)).foregroundStyle(theme.muted).lineLimit(1)
        .frame(maxWidth: 0.46 * d)
        .shadow(color: palette.halo, radius: size * 0.5)
        .contentShape(Rectangle())
        .onTapGesture { if r.speed.picked { pick = nil } }
        .help(subjectHelp(r))
    }
    private func subjectHelp(_ r: ClusterReadings) -> String {
        let why = r.speed.cruise.map { " · 테두리 띠의 초록 끝 \(Self.burnText($0))로 쓰면 초기화 때 한도가 딱 맞습니다" } ?? ""
        guard let sub = r.speed.subject else { return "한도 소진" + why }
        if sub.type == .all { return "한도 소진: 주간 한도를 보고하는 계정 \(sub.count)개의 평균 · 테두리의 삼각형은 계정별" + why }
        let s = sub.session
        return [sub.type == .session ? (s?.project ?? "") : "", s?.model ?? "", s?.reportedEffort ?? ""].filter { !$0.isEmpty }.joined(separator: " · ") + why + " · 누르면 전체 AI"
    }
    /// Range: hours of work left before the limit runs out, red when that comes before the reset.
    private func range(_ r: ClusterReadings, d: CGFloat) -> some View {
        let reach = r.speed.reach, small = d / m.zoom < 280, chip = max(m(small ? 9.5 : 10), 0.032 * d), led = max(m(11), 0.042 * d)
        return Group {
            if d / m.zoom >= 200 {
                if reach.state == .reconnect {
                    Text("재로그인 필요").font(.system(size: chip, weight: .semibold)).foregroundStyle(theme.amber)
                } else {
                    VStack(spacing: led * 0.3) {
                        Text("작업 가능").font(.system(size: chip, weight: .semibold)).foregroundStyle(reach.early ? palette.red : theme.muted)
                        HStack(alignment: .bottom, spacing: chip * 0.4) {
                            ClusterRangeWheels(hours: reach.hours, size: led, zoom: m.zoom, early: reach.early, palette: palette)
                            Text("시간").font(.system(size: chip, weight: .semibold)).foregroundStyle(theme.muted).padding(.bottom, chip * 0.3)
                        }
                    }
                }
            }
        }
        .help(rangeHelp(r))
    }
    private func rangeHelp(_ r: ClusterReadings) -> String {
        let reach = r.speed.reach
        if reach.state == .reconnect { return "로그인이 끊긴 계정이라 남은 한도를 읽을 수 없습니다" }
        if reach.state == .idle { return "지금은 한도를 쓰지 않습니다" }
        guard let hours = reach.hours else { return "이 대상은 주간 한도가 없어 계산할 수 없습니다" }
        let first = r.accounts.first { $0.id == reach.account }, who = first.map { (Self.tool($0) + " " + Self.plan($0)).trimmingCharacters(in: .whitespaces) } ?? ""
        return "이 속도면 약 \(ClusterReadings.reading(hours))시간 뒤 한도 바닥" + (r.speed.subject?.type == .all && !who.isEmpty ? " · \(who)이 가장 먼저" : "")
            + (reach.early ? " · 초기화 전에 바닥납니다" : " · 그 전에 초기화됩니다")
    }
    private func odometer(_ r: ClusterReadings, size: CGFloat) -> some View {
        ClusterOdometer(tokens: r.tach.tokens, climb: r.tach.climb, readAt: readAt, period: model.selectedPeriod, size: size, zoom: m.zoom, palette: palette)
    }

    // MARK: Warning lights
    private static var tellsList: [(key: String, label: String, icon: ClusterIcon, color: String)] {
        [("live", "실시간", .live, "#9be23c"), ("working", "작업 중", .working, ""), ("waiting", "응답 대기", .waiting, "#e3b25a"),
         ("done", "완료됨", .done, "#6ccfa9"), ("reconnect", "재로그인", .reconnect, "#f2797d"), ("empty", "한도 부족", .empty, "#f2797d")]
    }
    /// A car's tell-tale strip: every light in its place, dark until it has something to tell, then lit in its colour with
    /// its name under it and its count at the corner. The live light is green while readings arrive and turns red as
    /// 수집 지연 when they run late. Pressing a lit one shows only what it is about; pressing it again shows all.
    private func tells(_ r: ClusterReadings, only: String?) -> some View {
        HStack(spacing: m(4)) {
            ForEach(Self.tellsList, id: \.key) { tell in tellLight(tell, r: r, only: only) }
        }
        .padding(.vertical, m(6)).padding(.horizontal, m(10))
        .background(ClusterPalette.strip, in: RoundedRectangle(cornerRadius: m(14)))
        .overlay(RoundedRectangle(cornerRadius: m(14)).stroke(theme.line.opacity(0.7)))
        .accessibilityElement(children: .contain).accessibilityLabel(tr("경고등"))
    }
    /// One light of the strip. Kept apart from the strip with its types spelled out: as one closure it took the type
    /// checker over two seconds, which timed out CI.
    private func tellLight(_ tell: (key: String, label: String, icon: ClusterIcon, color: String), r: ClusterReadings, only: String?) -> some View {
        let live: Bool = tell.key == "live", n: Int = live ? 0 : count(r, tell.key), late: Bool = live && !r.tells.fresh
        let lit: Bool = live || n > 0, pressed: Bool = only == tell.key, label: String = late ? "수집 지연" : tell.label
        let tint: Color = late ? color(rgb("#ff4d40")) : tell.color.isEmpty ? theme.segmentOn : color(rgb(tell.color))
        let shown: Color = lit ? tint : ClusterPalette.dark, said: String = label + (n > 0 ? " \(n)" : "")
        return Button {
            guard !live, n > 0 else { return }
            self.only = pressed ? nil : tell.key
            mode = Self.accountTells.contains(tell.key) ? "weekly" : "sessions"
        } label: {
            tellFace(icon: tell.icon, label: label, shown: shown, tint: tint, n: n, pressed: pressed)
        }
        .buttonStyle(.plain)
        .help(said)
        .accessibilityLabel(said)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }
    private func tellFace(icon: ClusterIcon, label: String, shown: Color, tint: Color, n: Int, pressed: Bool) -> some View {
        VStack(spacing: m(2)) {
            ClusterGlyph(icon: icon, color: shown, size: m(22))
            Text(label).font(.system(size: m(10), weight: .semibold)).foregroundStyle(shown).lineLimit(1).fixedSize()
        }
        .frame(width: m(54), height: m(46))
        .overlay(alignment: .topTrailing) {
            if n > 0 {
                Text("\(n)").font(.system(size: m(10), weight: .heavy)).monospacedDigit().foregroundStyle(tint).padding(.top, m(2)).padding(.trailing, m(6))
            }
        }
        .background(pressed ? tint.opacity(0.16) : Color.clear, in: RoundedRectangle(cornerRadius: m(9)))
        .overlay(RoundedRectangle(cornerRadius: m(9)).stroke(pressed ? tint.opacity(0.6) : Color.clear))
        .contentShape(Rectangle())
    }

    // MARK: Lower row: odometer, trip and fuel
    private func lowerOdometer(_ r: ClusterReadings) -> some View {
        VStack(spacing: m(5)) {
            Text("합계 · " + caption).font(.system(size: m(11), weight: .semibold)).foregroundStyle(theme.muted).lineLimit(1)
            odometer(r, size: m(15 * 0.95))
        }
    }
    /// Trip: the tokens since the last reset, running on at the last minute's rate between readings.
    private func trip(_ r: ClusterReadings) -> some View {
        let t = r.trip, size = m(11.5)
        return VStack(spacing: m(4)) {
            TimelineView(.periodic(from: Date(), by: 0.25)) { context in
                HStack(alignment: .firstTextBaseline, spacing: m(4)) {
                    Text("트립")
                    if let t, t.inRange {
                        let add = reduceMotion ? 0 : r.tach.climb * min(30, max(0, context.date.timeIntervalSince(readAt)))
                        Text(Self.short((t.tokens ?? 0) + add)).font(.system(size: size * 1.15, weight: .semibold)).monospacedDigit().foregroundStyle(theme.ink)
                        Text("tokens")
                    } else if t != nil {
                        Text("기록 범위 밖").foregroundStyle(theme.amber)
                    } else { Text("—").foregroundStyle(theme.ink) }
                }
            }
            HStack(spacing: m(6)) {
                if let t { Text(Self.since(t.start)) }
                Button { tripStart = floor(Date().timeIntervalSince1970) } label: {
                    Text("리셋").font(.system(size: size, weight: .semibold)).padding(.horizontal, size * 0.7).frame(height: size * 1.9)
                        .overlay(RoundedRectangle(cornerRadius: m(6)).stroke(theme.line)).contentShape(Rectangle())
                }.buttonStyle(.plain).help("지금부터 다시 셉니다")
            }
        }
        .font(.system(size: size)).foregroundStyle(theme.muted).lineLimit(1)
    }
    /// Fuel: a gauge per account (as many as the row holds, up to eight, every provider before a second of one, then +N),
    /// filled with what is left of its weekly limit; pressing one picks it for the burn dial.
    private func fuel(_ r: ClusterReadings, room: CGFloat) -> some View {
        var n = min(8, max(1, r.accounts.count))
        while n > 3 && CGFloat(n) * m(fuelPitch[n]) > room { n -= 1 }
        let ids = Set(AccountQuota.pickTiles(model.snapshot?.account_quotas ?? [], count: n).map(\.id))
        let cans = r.accounts.filter { ids.contains($0.id) }, rest = r.accounts.filter { !ids.contains($0.id) }
        let width = m(fuelPitch[max(2, min(8, cans.count))])
        let heading = cans.contains { !$0.weekly } ? "남은 한도" : "남은 주간 한도"
        let names = cans.map { (Self.tool($0) + " " + Self.plan($0)).trimmingCharacters(in: .whitespaces) }
        return VStack(spacing: m(5)) {
            HStack(spacing: m(4)) {
                Text(heading)
                if !rest.isEmpty {
                    Text("+\(rest.count)").fontWeight(.bold).foregroundStyle(theme.ink)
                        .help(rest.map { (Self.tool($0) + " " + Self.plan($0)).trimmingCharacters(in: .whitespaces) }.joined(separator: ", "))
                }
            }.font(.system(size: m(11), weight: .semibold)).foregroundStyle(theme.muted)
            if r.accounts.isEmpty {
                Text("연결된 구독 계정이 없습니다.").font(m.font(.caption)).foregroundStyle(theme.muted).padding(.vertical, m(4))
            } else {
                HStack(spacing: 0) {
                    ForEach(Array(cans.enumerated()), id: \.element.id) { i, a in
                        can(a, r: r, width: width, twin: names.filter { $0 == names[i] }.count > 1, small: cans.count >= 7)
                    }
                }
            }
        }.frame(maxWidth: .infinity)
    }
    private func can(_ a: ClusterReadings.Account, r: ClusterReadings, width: CGFloat, twin: Bool, small: Bool) -> some View {
        let on = r.speed.account == a.id && r.speed.picked, low = (a.left ?? 100) < 15, tint = AgentPalette.color(a.kind)
        let plan = Self.plan(a), brief = ["Business": "Biz", "Enterprise": "Ent"][plan] ?? plan
        let second = brief + (twin && !a.who.isEmpty && a.who != plan ? " · " + a.who : "")
        let lab = m(small ? 10.5 : 11)
        return Button { pick = on ? nil : .account(a.id) } label: {
            VStack(spacing: m(4)) {
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: m(4)).fill(theme.ink.opacity(0.09))
                    Rectangle().fill(low ? theme.amber : tint).opacity(a.current ? 1 : 0.45).frame(height: m(36) * CGFloat(min(100, max(0, a.left ?? 0))) / 100)
                }
                .frame(width: m(14), height: m(36)).clipShape(RoundedRectangle(cornerRadius: m(4)))
                .overlay(RoundedRectangle(cornerRadius: m(4)).stroke(on ? tint : a.reconnect ? theme.amber : .clear, lineWidth: on ? 1.5 : 1))
                .shadow(color: on ? tint : .clear, radius: on ? m(5) : 0)
                VStack(spacing: 0) {
                    Text(Self.tool(a)).font(.system(size: lab - 0.5, weight: .semibold)).foregroundStyle(tint)
                    Text(second.isEmpty ? "—" : second).font(.system(size: lab + 0.5, weight: .bold)).foregroundStyle(on ? tint : theme.ink).truncationMode(.tail)
                }.lineLimit(1).frame(maxWidth: width)
            }
            .frame(width: width).padding(.vertical, m(2)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).help(canHelp(a)).accessibilityLabel(Self.tool(a) + " " + plan + " " + (a.left.map { ClusterReadings.number($0) + "% 남음" } ?? "보고 대기"))
    }
    private func canHelp(_ a: ClusterReadings.Account) -> String {
        var lines = [(Self.tool(a) + " " + Self.plan(a)).trimmingCharacters(in: .whitespaces)]
        if !a.who.isEmpty { lines.append(a.who) }
        lines.append(a.reconnect ? "재로그인 필요" : a.left == nil ? "보고 대기" : (a.window.map { $0 + " " } ?? "") + ClusterReadings.number(a.left) + "% 남음")
        if let reset = a.reset { lines.append("초기화 " + Self.date(reset)) }
        if let burn = a.burn { lines.append("평균 " + Self.burnText(burn)) }
        if let eta = eta(a) { lines.append(eta.text) }
        return lines.joined(separator: "\n")
    }
    /// When this account's limit runs out at its current burn, or that it lasts to the reset.
    private func eta(_ a: ClusterReadings.Account) -> (text: String, color: Color)? {
        guard let range = a.range else { return nil }
        switch range.state {
        case .idle: return ("지금은 쓰지 않음", theme.dim)
        case .enough: return ("초기화 전까지 충분", theme.accent)
        case .empty: return ("이 속도면 \(range.at.map(Self.when) ?? "—") 바닥", range.early ? palette.red : theme.muted)
        }
    }

    // MARK: Window
    private func window(_ r: ClusterReadings, only: String?, px: CGFloat) -> some View {
        let current = Self.modes.contains { $0.0 == mode } ? mode : "sessions"
        return VStack(spacing: m(8)) {
            HStack(spacing: 0) {
                ForEach(Self.modes, id: \.0) { key, label in
                    let on = key == current
                    Button { mode = key; self.only = nil } label: {
                        Text(label).font(.system(size: m(11), weight: .semibold)).lineLimit(1).fixedSize()
                            .foregroundStyle(on ? theme.ink : theme.muted)
                            .frame(maxWidth: .infinity).frame(height: m(28))
                            .background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: m(7)))
                            .shadow(color: on ? .black.opacity(0.25) : .clear, radius: 1, y: 1)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(m(3)).background(theme.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: m(10)))
            .accessibilityElement(children: .contain).accessibilityLabel("표시창")
            page(current, r: r, only: only, px: px)
        }
    }
    @ViewBuilder private func page(_ key: String, r: ClusterReadings, only: String?, px: CGFloat) -> some View {
        switch key {
        case "flow": flowPage(r).frame(height: m(280))
        case "weekly": weeklyPage(r, only: only)
        case "map": mapPage().frame(height: m(280))
        case "heat": heatPage().frame(height: m(280))
        case "goals": goalsPage()
        case "system": systemPage().frame(height: m(280))
        default:
            // The panel's own list, edge to edge: its gauges, shortcuts and menus; a row picks the session for the burn dial.
            let filtered = only.map { ["working", "waiting", "done"].contains($0) } ?? false
            sessionsPage(ClusterSessions(ids: filtered ? r.sessions.map(\.id) : nil, picked: r.speed.session) { id in
                pick = pick == .session(id) ? nil : .session(id)
            })
            .padding(.horizontal, -(px + m(14)))
        }
    }
    private func paneHead(_ text: Text) -> some View {
        text.font(m.font(.caption)).foregroundColor(theme.muted).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
    }
    private func empty(_ text: String) -> some View {
        Text(text).font(m.font(.label)).foregroundStyle(theme.muted).multilineTextAlignment(.center).padding(.vertical, m(18)).padding(.horizontal, m(6)).frame(maxWidth: .infinity)
    }

    /// Token flow: the period's total, then the tokens by AI in the dashboard's buckets, stacked in tool colours.
    private func flowPage(_ r: ClusterReadings) -> some View {
        let trend = DesktopUsageTrend(events: model.snapshot?.events, period: model.selectedPeriod, end: model.snapshot?.updated ?? now)
        let top = trend.maximum
        return VStack(alignment: .leading, spacing: m(6)) {
            HStack(alignment: .firstTextBaseline, spacing: m(6)) {
                Text(r.tach.tokens.map(Self.figure) ?? "—").font(.system(size: m(20), weight: .semibold)).monospacedDigit().foregroundStyle(theme.ink)
                Text("tokens").font(m.font(.caption)).foregroundStyle(theme.muted)
            }.padding(.horizontal, m(4))
            legend("AI별") {
                ForEach(trend.series, id: \.self) { kind in
                    HStack(spacing: m(5)) { RoundedRectangle(cornerRadius: 2).fill(AgentPalette.color(kind)).frame(width: m(8), height: m(8)); Text(Self.kindName(kind)) }
                }
            }
            if !trend.reported {
                Text("사용 기록 대기").font(m.font(.label)).foregroundStyle(theme.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Canvas { ctx, size in
                    let left = m(30), top6 = m(6), h = size.height - m(16), plot = h - top6, n = max(1, trend.bins.count), w = (size.width - left) / CGFloat(n)
                    func y(_ v: Double) -> CGFloat { h - plot * CGFloat(min(1, v / top)) }
                    for k in 0...2 {
                        let v = top * Double(k) / 2
                        ctx.stroke(Path { p in p.move(to: CGPoint(x: left, y: y(v))); p.addLine(to: CGPoint(x: size.width, y: y(v))) },
                                   with: .color(theme.line.opacity(k == 0 ? 1 : 0.6)), lineWidth: 1)
                        ctx.draw(Text(Self.short(v)).font(m.font(.tiny)).foregroundColor(theme.dim), at: CGPoint(x: left - m(5), y: y(v)), anchor: .trailing)
                    }
                    for (i, bin) in trend.bins.enumerated() where bin.tokens > 0 {
                        var base = h
                        for kind in trend.series {
                            let part = bin.tokensByKind[kind] ?? 0
                            guard part > 0 else { continue }
                            let bar = plot * CGFloat(part / top)
                            ctx.fill(Path(CGRect(x: left + CGFloat(i) * w + w * 0.12, y: base - bar, width: w * 0.76, height: bar)), with: .color(AgentPalette.color(kind)))
                            base -= bar
                        }
                    }
                    // The period's average per bucket, dashed, named at its end.
                    let average = trend.bins.reduce(0) { $0 + $1.tokens } / Double(n)
                    if average > 0 {
                        ctx.stroke(Path { p in p.move(to: CGPoint(x: left, y: y(average))); p.addLine(to: CGPoint(x: size.width, y: y(average))) },
                                   with: .color(theme.accent), style: StrokeStyle(lineWidth: 1, dash: [m(3), m(3)]))
                        ctx.draw(Text("평균").font(m.font(.tiny, .semibold)).foregroundColor(theme.accent), at: CGPoint(x: size.width, y: y(average) - m(2)), anchor: .bottomTrailing)
                    }
                    for k in 0...3 {
                        let t = (trend.bins.first?.start ?? 0) + ((trend.bins.last?.end ?? 0) - (trend.bins.first?.start ?? 0)) * Double(k) / 3
                        ctx.draw(Text(Self.clock(t)).font(m.font(.tiny)).foregroundColor(theme.dim),
                                 at: CGPoint(x: left + (size.width - left) * CGFloat(k) / 3, y: size.height), anchor: k == 0 ? .bottomLeading : k == 3 ? .bottomTrailing : .bottom)
                    }
                }
            }
            projectTrend()
        }
        .help("토큰 흐름 · " + caption)
        .onAppear { loadHistory() }
        .onChange(of: model.selectedPeriod) { _ in loadHistory() }
        .onChange(of: model.snapshot?.updated) { _ in loadHistory() }
    }
    /// A chart's name with its legend; names keep their length and what does not fit fades out at the end.
    private func legend<Items: View>(_ title: String, @ViewBuilder items: () -> Items) -> some View {
        HStack(spacing: m(10)) {
            Text(title).font(.system(size: m(10.5), weight: .semibold)).foregroundStyle(theme.ink).fixedSize()
            Color.clear.frame(height: m(14))
                .overlay(alignment: .leading) { HStack(spacing: m(10)) { items() }.font(m.font(.tiny)).foregroundStyle(theme.muted).lineLimit(1).fixedSize() }
                .mask(LinearGradient(stops: [.init(color: .black, location: 0.88), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
                .clipped()
        }.padding(.horizontal, m(4))
    }
    private static var seriesDark: [String] { ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] }
    private static var seriesDay: [String] { ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] }
    /// By project, under the AI chart: the usage map view's project trend over the same period, from the history.
    private func projectTrend() -> some View {
        let series = history.series
        let fold = series.map { ClusterHeat.fold($0.by_project ?? []) }
        let palette = (theme.light ? Self.seriesDay : Self.seriesDark).map { color(rgb($0)) }
        let other = color(rgb(theme.light ? "#6b7178" : "#a7aeb5"))
        let layers: [(row: ClusterHeat.Series.Row, color: Color, name: String)] = fold.map { f in
            f.shown.enumerated().map { i, row in (row, palette[(history.slots[row.key] ?? i) % palette.count], ClusterHeat.projectName(row)) }
                .sorted { (history.slots[$0.row.key] ?? 0) < (history.slots[$1.row.key] ?? 0) }
                + (f.other.map { [($0, other, "기타")] } ?? [])
        } ?? []
        return VStack(alignment: .leading, spacing: m(2)) {
            legend("프로젝트별") {
                ForEach(Array(layers.enumerated()), id: \.offset) { _, layer in
                    HStack(spacing: m(5)) { RoundedRectangle(cornerRadius: 2).fill(layer.color).frame(width: m(8), height: m(8)); Text(layer.name) }
                }
            }
            if let series, !layers.isEmpty {
                trendChart(series, layers: layers)
            } else {
                Text(series == nil ? history.message : "이 기간의 사용량 보고가 없습니다").font(m.font(.label)).foregroundStyle(theme.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
    private func trendChart(_ s: ClusterHeat.Series, layers: [(row: ClusterHeat.Series.Row, color: Color, name: String)]) -> some View {
        let n = s.bins.count
        let totals: [Double?] = (0..<n).map { i in (i < s.total.count ? s.total[i] : nil) == nil ? nil : layers.reduce(0) { $0 + ((i < $1.row.tokens.count ? $1.row.tokens[i] : nil) ?? 0) } }
        let top = ClusterHeat.axisMax(totals.compactMap { $0 }.max() ?? 0), alpha = theme.light ? 0.32 : 0.4
        return Canvas { ctx, size in
            let left = m(30), top6 = m(6), base = size.height - m(16), plot = base - top6, pw = size.width - left
            guard n > 0 else { return }
            func x(_ i: Double) -> CGFloat { left + CGFloat(i + 0.5) * pw / CGFloat(n) }
            func y(_ v: Double) -> CGFloat { base - CGFloat(v / top) * plot }
            for k in 0...2 {
                let v = top * Double(k) / 2
                ctx.stroke(Path { p in p.move(to: CGPoint(x: left, y: y(v))); p.addLine(to: CGPoint(x: size.width, y: y(v))) }, with: .color(theme.line.opacity(k == 0 ? 1 : 0.6)), lineWidth: 1)
                ctx.draw(Text(Self.short(v)).font(m.font(.tiny)).foregroundColor(theme.dim), at: CGPoint(x: left - m(5), y: y(v)), anchor: .trailing)
            }
            let samples = max(1, min(8, Int((pw / CGFloat(n) / 4).rounded())))
            for (a, z) in ClusterHeat.runs(totals) {
                let sampled = layers.map { L in ClusterHeat.smooth((a...z).map { i in (i < L.row.tokens.count ? L.row.tokens[i] : nil) ?? 0 }, samples: samples) }
                let xs = sampled[0].map { x(Double(a) + $0.x) }
                var bounds: [[Double]] = [xs.map { _ in 0 }]
                for S in sampled { bounds.append(zip(bounds.last!, S).map { $0 + $1.y }) }
                for (j, L) in layers.enumerated() {
                    var area = Path()
                    for (k, X) in xs.enumerated() { k == 0 ? area.move(to: CGPoint(x: X, y: y(bounds[j + 1][k]))) : area.addLine(to: CGPoint(x: X, y: y(bounds[j + 1][k]))) }
                    for k in xs.indices.reversed() { area.addLine(to: CGPoint(x: xs[k], y: y(bounds[j][k]))) }
                    area.closeSubpath()
                    ctx.fill(area, with: .color(L.color.opacity(alpha)))
                    var line = Path()
                    for (k, X) in xs.enumerated() { k == 0 ? line.move(to: CGPoint(x: X, y: y(bounds[j + 1][k]))) : line.addLine(to: CGPoint(x: X, y: y(bounds[j + 1][k]))) }
                    ctx.stroke(line, with: .color(L.color), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
                }
            }
            let count = max(2, min(6, Int(pw / 96)))
            for k in 0..<count {
                let i = Int((Double(k) * Double(n - 1) / Double(count - 1)).rounded())
                ctx.draw(Text(Self.clock(s.bins[i])).font(m.font(.tiny)).foregroundColor(theme.dim),
                         at: CGPoint(x: k == 0 ? left : k == count - 1 ? size.width : x(Double(i)), y: size.height), anchor: k == 0 ? .bottomLeading : k == count - 1 ? .bottomTrailing : .bottom)
            }
        }
    }
    /// Weekly limits: a card per account (only those a pressed warning is about); pressing one picks it for the burn
    /// dial. The last card adds an account; an account signed out has its sign-in button.
    private func weeklyPage(_ r: ClusterReadings, only: String?) -> some View {
        let accounts = only.flatMap { o -> [ClusterReadings.Account]? in
            guard Self.accountTells.contains(o) else { return nil }
            let ids = o == "reconnect" ? r.tells.reconnect : r.tells.empty
            return r.accounts.filter { ids.contains($0.id) }
        } ?? r.accounts
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: m(8)), GridItem(.flexible(), spacing: m(8))], spacing: m(8)) {
            ForEach(accounts) { a in card(a, r: r) }
            if only == nil { addCard }
        }
    }
    private func card(_ a: ClusterReadings.Account, r: ClusterReadings) -> some View {
        let on = r.speed.account == a.id && r.speed.picked, tint = AgentPalette.color(a.kind), plan = Self.plan(a)
        return VStack(alignment: .leading, spacing: m(7)) {
            HStack(spacing: m(6)) {
                Text(Self.tool(a)).foregroundStyle(tint)
                if !plan.isEmpty { Text(plan).fontWeight(.medium).foregroundStyle(theme.muted) }
                if let window = a.window { Text(window).fontWeight(.medium).foregroundStyle(theme.muted) }
                if !a.who.isEmpty && a.who.lowercased() != (a.alias ?? "").lowercased() {
                    Spacer(minLength: m(2))
                    Text(a.who).fontWeight(.regular).foregroundStyle(theme.dim).truncationMode(.tail)
                }
            }.font(.system(size: m(10.5), weight: .semibold)).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: m(6)) {
                Text(a.pct.map { ClusterReadings.number($0) + "%" } ?? "—").font(.system(size: m(24), weight: .semibold)).monospacedDigit().foregroundStyle(theme.ink)
                Text("사용").font(m.font(.caption)).foregroundStyle(theme.muted)
            }
            GeometryReader { geo in
                Capsule().fill(theme.ink.opacity(0.09)).overlay(alignment: .leading) {
                    Capsule().fill(tint).opacity(a.current ? 1 : 0.45).frame(width: geo.size.width * CGFloat(min(100, max(0, a.pct ?? 0))) / 100)
                }
            }.frame(height: m(5))
            cardFoot(a, tint: tint)
        }
        .padding(.horizontal, m(12)).padding(.vertical, m(10)).frame(maxWidth: .infinity, alignment: .leading)
        .background(on ? theme.accent.opacity(0.07) : theme.ink.opacity(0.025), in: RoundedRectangle(cornerRadius: m(12)))
        .overlay(RoundedRectangle(cornerRadius: m(12)).stroke(on ? theme.accent.opacity(0.42) : theme.line))
        .contentShape(RoundedRectangle(cornerRadius: m(12)))
        .onTapGesture { pick = on ? nil : .account(a.id) }
        .help(canHelp(a))
    }
    private func cardFoot(_ a: ClusterReadings.Account, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: m(2)) {
            HStack(spacing: m(8)) {
                if a.reconnect {
                    let waiting = model.authorizing == a.id
                    Button { model.authorizeAccount(a.id) } label: {
                        Text(tr(waiting ? "macOS 승인 기다리는 중…" : "다시 로그인")).font(m.font(.caption, .semibold)).foregroundStyle(theme.amber)
                            .padding(.horizontal, m(10)).frame(height: m(26))
                            .background(theme.amber.opacity(0.12), in: RoundedRectangle(cornerRadius: m(8)))
                            .overlay(RoundedRectangle(cornerRadius: m(8)).stroke(theme.amber.opacity(0.55)))
                    }.buttonStyle(.plain).disabled(model.authorizing != nil || !model.fresh)
                } else {
                    Text(caption + " ") + Text(a.added.map { "+" + ClusterReadings.number($0) + "%" } ?? "—").fontWeight(.semibold).foregroundColor(tint)
                }
                if let burn = a.burn {
                    Spacer(minLength: 0)
                    Text("평균 ") + Text(Self.burnText(burn)).fontWeight(.semibold).foregroundColor(theme.ink)
                }
            }
            if let eta = eta(a) { Text(eta.text).foregroundStyle(eta.color) }
        }
        .font(m.font(.tiny)).foregroundStyle(theme.muted).lineLimit(1)
    }
    private var addCard: some View {
        Button { addAccountMenu() } label: {
            VStack(spacing: m(4)) {
                Text("+").font(.system(size: m(20), weight: .medium)).foregroundStyle(theme.ink)
                    .frame(width: m(30), height: m(30)).overlay(Circle().stroke(palette.lineStrong))
                Text("계정 추가").font(m.font(.body, .semibold)).foregroundStyle(theme.ink)
                Text("공식 로그인으로 구독 한도를 연결합니다").font(m.font(.tiny)).foregroundStyle(theme.muted).multilineTextAlignment(.center)
            }
            .padding(m(10)).frame(maxWidth: .infinity, minHeight: m(120))
            .overlay(RoundedRectangle(cornerRadius: m(12)).stroke(theme.line, style: StrokeStyle(lineWidth: 1, dash: [m(4), m(3)])))
            .contentShape(RoundedRectangle(cornerRadius: m(12)))
        }
        .buttonStyle(.plain).disabled(!model.fresh || model.busy).accessibilityLabel(tr("구독 계정 추가 로그인"))
    }
    /// The panel's own account menu, the same as the + beside its weekly limits.
    private func addAccountMenu() {
        let menu = NSMenu()
        for (title, kind) in [("Claude Code 계정 로그인…", "Claude"), ("Codex 계정 로그인…", "Codex")] {
            let action = ClusterMenuAction { [model] in model.addAccount(kind) }
            let item = NSMenuItem(title: tr(title), action: #selector(ClusterMenuAction.run), keyEquivalent: "")
            item.target = action; item.representedObject = action
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }
    /// The usage map: the period's tokens by session, each tile by its share; the figures are in its tooltip.
    private func mapPage() -> some View {
        let map = DesktopUsageMap(sessions: model.sessions, period: model.selectedPeriod)
        let tints: [Color] = ["#6ecca8", "#82a6de", "#bd99d1", "#d9b078", "#70adbd", "#c28799", "#a8ba78", "#99a6ba"].map { color(rgb($0)) }
        return VStack(spacing: m(8)) {
            paneHead(Text(Self.figure(map.total)).fontWeight(.semibold).foregroundColor(theme.ink) + Text(" tokens · " + caption))
            if map.tiles.isEmpty {
                empty(map.reported == 0 ? "이 기간의 사용량 보고가 없습니다" : "이 기간의 보고된 사용량은 0입니다").frame(maxHeight: .infinity)
            } else {
                GeometryReader { geo in
                    ZStack(alignment: .topLeading) {
                        ForEach(map.layout(in: CGRect(origin: .zero, size: geo.size))) { item in
                            let tint = tints[item.colorIndex % tints.count], w = max(0, item.rect.width - 2), h = max(0, item.rect.height - 2)
                            ZStack(alignment: .topLeading) {
                                RoundedRectangle(cornerRadius: m(4)).fill(tint.opacity(0.17))
                                if w >= m(36) && h >= m(18) {
                                    Text(item.tile.title).font(m.font(.tiny, .semibold)).foregroundStyle(theme.ink).lineLimit(1).truncationMode(.tail)
                                        .padding(.horizontal, m(7)).padding(.vertical, m(5))
                                }
                            }
                            .frame(width: w, height: h).clipped()
                            .overlay(RoundedRectangle(cornerRadius: m(4)).stroke(tint.opacity(0.55), lineWidth: 0.7))
                            .offset(x: item.rect.minX, y: item.rect.minY)
                            .help("\(item.tile.title)\n\(DesktopFormat.number(item.tile.value)) tokens · \(String(format: "%.1f", item.tile.value / map.total * 100))%\n\(item.tile.detail)")
                        }
                    }
                }
            }
        }
    }
    /// Both heatmaps of the usage map view from the collector's history: weekday × hour, then the last year day by day.
    private func heatPage() -> some View {
        let data = history.data
        return VStack(alignment: .leading, spacing: m(6)) {
            if let data {
                let hours = ClusterHeat.weekHours(data.hours)
                paneHead(hourSummary(hours))
                hourGrid(hours).frame(height: m(16) + 7 * m(13.6))
                paneHead(yearSummary(data.days)).padding(.top, m(4))
                yearGrid(data.days).frame(height: m(14) + 7 * m(13.6))
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
                Text(history.message).font(m.font(.label)).foregroundStyle(theme.muted).frame(maxWidth: .infinity)
                Spacer(minLength: 0)
            }
        }
        .onAppear { loadHistory() }
        .onChange(of: model.selectedPeriod) { _ in loadHistory() }
        .onChange(of: model.snapshot?.updated) { _ in loadHistory() }
    }
    /// /api/history, once a minute at most while the page shows (cluster-pages.js fetchHistory).
    private func loadHistory() {
        let period = model.selectedPeriod
        guard !history.loading, history.key != period || Date().timeIntervalSince(history.at) >= 60 else { return }
        history.loading = true; history.key = period; history.at = Date()
        let seconds: Double = ["10m": 600, "30m": 1800, "1h": 3600, "5h": 18000, "12h": 43200, "24h": 86400][period] ?? 3600
        var url = URLComponents(url: model.baseURL.appendingPathComponent("api/history"), resolvingAgainstBaseURL: false)
        url?.queryItems = [URLQueryItem(name: "period", value: period), URLQueryItem(name: "step", value: seconds <= 3600 ? "60" : seconds <= 21600 ? "300" : "900")]
        guard let target = url?.url else { history.loading = false; return }
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = "GET"
        URLSession.shared.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let reply = status == 200 ? data.flatMap { try? JSONDecoder().decode(ClusterHeat.Reply.self, from: $0) } : nil
            DispatchQueue.main.async {
                history.loading = false
                if let reply {
                    history.data = reply.heatmap; history.series = reply.series; history.message = ""
                    history.slots = ClusterHeat.slots(history.slots, (reply.series?.by_project).map { ClusterHeat.fold($0).shown.map(\.key) } ?? [])
                }
                else if status == 404 { history.data = nil; history.message = "수집기 업데이트 후 표시됩니다" }
                else if history.data == nil { history.message = "기록을 불러오지 못했습니다" }
            }
        }.resume()
    }
    private func heatColor(_ level: Int?) -> Color {
        let dark = ["#1b2024", "#104281", "#1c5cab", "#2a78d6", "#5598e7", "#9ec5f4"], day = ["#f0f2f4", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#1c5cab"]
        return color(rgb((theme.light ? day : dark)[min(5, max(0, level ?? 0))]))
    }
    /// A cell with no record: the panel with faint diagonal hatching.
    private func hatch(_ ctx: GraphicsContext, _ rect: CGRect) {
        ctx.fill(Path(roundedRect: rect, cornerRadius: m(2)), with: .color(theme.card))
        var lines = Path(), x = rect.minX - rect.height
        while x < rect.maxX { lines.move(to: CGPoint(x: x, y: rect.maxY)); lines.addLine(to: CGPoint(x: x + rect.height, y: rect.minY)); x += m(5) }
        var clipped = ctx; clipped.clip(to: Path(rect))
        clipped.stroke(lines, with: .color(theme.ink.opacity(0.07)), lineWidth: 1)
    }
    private static var weekdays: [String] { ["월", "화", "수", "목", "금", "토", "일"] }
    private func hourSummary(_ cells: [[ClusterHeat.Cell?]]) -> Text {
        var peak: (w: Int, h: Int, v: Double)?
        for (w, row) in cells.enumerated() { for (h, c) in row.enumerated() { if let c, c.value > 0, c.value > (peak?.v ?? 0) { peak = (w, h, c.value) } } }
        guard let peak else { return Text("최근 30일 하루 평균") }
        return Text("가장 많이 쓰는 시간 ") + Text("\(Self.weekdays[peak.w]) \(peak.h):00").fontWeight(.semibold).foregroundColor(theme.ink)
            + Text(" · ") + Text(Self.figure(peak.v)).fontWeight(.semibold).foregroundColor(theme.ink) + Text(" tokens")
    }
    private func hourGrid(_ cells: [[ClusterHeat.Cell?]]) -> some View {
        let peak = cells.flatMap { $0 }.compactMap { $0?.value }.max() ?? 0
        return Canvas { ctx, size in
            let label = m(18), gap = m(2), head = m(16), col = (size.width - label - 24 * gap) / 24, row = m(11.6)
            for h in stride(from: 0, to: 24, by: 3) {
                ctx.draw(Text("\(h)").font(m.font(.tiny)).foregroundColor(theme.muted), at: CGPoint(x: label + gap + CGFloat(h) * (col + gap) + col / 2, y: head / 2), anchor: .center)
            }
            for (w, cellsRow) in cells.enumerated() {
                let y = head + CGFloat(w) * (row + gap)
                ctx.draw(Text(Self.weekdays[w]).font(m.font(.tiny)).foregroundColor(theme.muted), at: CGPoint(x: 0, y: y + row / 2), anchor: .leading)
                for (h, c) in cellsRow.enumerated() {
                    let rect = CGRect(x: label + gap + CGFloat(h) * (col + gap), y: y, width: col, height: row)
                    if let c { ctx.fill(Path(roundedRect: rect, cornerRadius: m(2)), with: .color(heatColor(ClusterHeat.level(c.value, peak)))) } else { hatch(ctx, rect) }
                }
            }
        }
    }
    private func yearSummary(_ days: [ClusterHeat.Day]) -> Text {
        let values = days.compactMap { d in d.value.map { (d.date, $0) } }
        guard let top = values.max(by: { $0.1 < $1.1 }) else { return Text("최근 1년 날짜별 합계") }
        let parts = top.0.split(separator: "-").compactMap { Int($0) }
        return Text("합계 ") + Text(Self.figure(values.reduce(0) { $0 + $1.1 })).fontWeight(.semibold).foregroundColor(theme.ink)
            + Text(" · 사용한 날 ") + Text("\(values.filter { $0.1 > 0 }.count)").fontWeight(.semibold).foregroundColor(theme.ink)
            + Text(" · 가장 많이 쓴 날 ") + Text(parts.count == 3 ? "\(parts[1])월 \(parts[2])일" : top.0).fontWeight(.semibold).foregroundColor(theme.ink) + Text(" " + Self.figure(top.1))
    }
    /// The newest weeks that fit, Monday first, with each month's name over its first week (a narrow window on the year).
    private func yearGrid(_ days: [ClusterHeat.Day]) -> some View {
        let year = ClusterHeat.year(days, today: model.now)
        let peak = year.weeks.flatMap { $0 }.compactMap { $0.value }.max() ?? 0
        return Canvas { ctx, size in
            let label = m(18), gap = m(2), head = m(14), cell = m(11.6), fit = min(year.weeks.count, Int((size.width - label) / (cell + gap)))
            let first = year.weeks.count - fit
            for month in year.months where month.week >= first {
                ctx.draw(Text("\(month.month)월").font(m.font(.tiny)).foregroundColor(theme.muted), at: CGPoint(x: label + CGFloat(month.week - first) * (cell + gap), y: head / 2), anchor: .leading)
            }
            for i in stride(from: 0, to: 7, by: 2) {
                ctx.draw(Text(Self.weekdays[i]).font(m.font(.tiny)).foregroundColor(theme.muted), at: CGPoint(x: 0, y: head + CGFloat(i) * (cell + gap) + cell / 2), anchor: .leading)
            }
            for (w, col) in year.weeks.dropFirst(first).enumerated() {
                for (i, c) in col.enumerated() where !c.future {
                    let rect = CGRect(x: label + CGFloat(w) * (cell + gap), y: head + CGFloat(i) * (cell + gap), width: cell, height: cell)
                    if let v = c.value { ctx.fill(Path(roundedRect: rect, cornerRadius: m(2)), with: .color(heatColor(ClusterHeat.level(v, peak)))) } else { hatch(ctx, rect) }
                    if c.today { ctx.stroke(Path(roundedRect: rect.insetBy(dx: -1, dy: -1), cornerRadius: m(2.5)), with: .color(theme.accent), lineWidth: 1.5) }
                }
            }
        }
    }
    /// Goals and loops the collector found, active first.
    private func goalsPage() -> some View {
        let o = model.snapshot?.operations
        let goals = (o?.goals ?? []).enumerated().sorted { a, b in
            let x = a.element.status == "active", y = b.element.status == "active"
            return x != y ? x : a.offset < b.offset
        }.map(\.element)
        let loops = o?.schedules ?? []
        return VStack(spacing: m(6)) {
            if goals.isEmpty && loops.isEmpty {
                empty(o?.goal_source_status == "reported" ? "저장된 Goal과 예약이 없습니다." : "Goal 기록을 확인하고 있습니다.")
            }
            ForEach(goals) { g in
                goal(status: goalLabels[g.status ?? ""] ?? (g.status ?? ""), tone: goalTone(g.status), title: g.objective ?? "",
                     detail: Text(g.runtime ?? "") + Text(" · " + Self.folder(g.location) + " · ") + Text(Self.figure(g.tokens_used ?? 0)).fontWeight(.semibold) + Text(" tokens"),
                     help: g.location ?? "")
            }
            ForEach(Array(loops.enumerated()), id: \.offset) { _, l in
                goal(status: "LOOP", tone: theme.muted, title: l.name ?? "",
                     detail: Text(l.runtime ?? "Claude Code") + Text(l.location.map { " · " + Self.folder($0) } ?? ""), help: l.location ?? "")
            }
        }
    }
    private func goalTone(_ status: String?) -> Color {
        switch status {
        case "active": theme.segmentOn
        case "complete": theme.accent
        case "paused": theme.amber
        case "blocked", "failed", "budget_limit", "usage_limit": palette.red
        default: theme.muted
        }
    }
    private func goal(status: String, tone: Color, title: String, detail: Text, help: String) -> some View {
        VStack(alignment: .leading, spacing: m(4)) {
            Text(status).font(.system(size: m(9.5), weight: .semibold)).foregroundStyle(tone).padding(.horizontal, m(8)).frame(height: m(20))
                .background(tone.opacity(0.15), in: Capsule())
            Text(title).font(m.font(.label, .semibold)).foregroundStyle(theme.ink).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            detail.font(m.font(.tiny)).foregroundColor(theme.muted).lineLimit(1).truncationMode(.middle).help(help)
        }
        .padding(.horizontal, m(10)).padding(.vertical, m(8)).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: m(10)).stroke(theme.line))
    }
    /// Computer resources: CPU and memory over the collector's recent window, then the busiest apps.
    private func systemPage() -> some View {
        let system = model.snapshot?.system, host = system?.host, history = system?.history ?? [], top = Array((system?.top ?? []).prefix(4))
        let memory = color(rgb("#8f98e0"))
        return VStack(alignment: .leading, spacing: m(8)) {
            if let host {
                HStack(spacing: m(5)) {
                    RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: m(8), height: m(8)); Text("CPU"); Text(Self.pc(host.cpu)).fontWeight(.semibold).foregroundStyle(theme.ink)
                    Text("·")
                    RoundedRectangle(cornerRadius: 2).fill(memory).frame(width: m(8), height: m(8)); Text(tr("메모리")); Text(Self.pc(host.memory?.percent)).fontWeight(.semibold).foregroundStyle(theme.ink)
                }.font(m.font(.caption)).foregroundStyle(theme.muted).lineLimit(1)
            }
            Canvas { ctx, size in
                let left = m(32), bottom = m(14), lift = m(7), h = size.height - bottom, w = size.width - left
                for k in 0...2 {
                    let y = h - (h - lift) * CGFloat(k) / 2
                    ctx.stroke(Path { p in p.move(to: CGPoint(x: left, y: y)); p.addLine(to: CGPoint(x: size.width, y: y)) }, with: .color(theme.line.opacity(0.7)), lineWidth: 1)
                    ctx.draw(Text("\(k * 50)%").font(m.font(.tiny)).foregroundColor(theme.dim), at: CGPoint(x: left - m(4), y: y), anchor: .trailing)
                }
                guard let first = history.first?.t, let last = history.last?.t, last > first else { return }
                func x(_ t: Double) -> CGFloat { left + CGFloat((t - first) / (last - first)) * w }
                func y(_ v: Double) -> CGFloat { h - CGFloat(min(100, max(0, v)) / 100) * (h - lift) }
                for (cpu, tint) in [(true, theme.accent), (false, memory)] {
                    let points = history.compactMap { p -> CGPoint? in (cpu ? p.cpu : p.memory).map { CGPoint(x: x(p.t), y: y($0)) } }
                    guard let a = points.first, let b = points.last else { continue }
                    var line = Path(); line.addLines(points)
                    var area = line; area.addLine(to: CGPoint(x: b.x, y: h)); area.addLine(to: CGPoint(x: a.x, y: h)); area.closeSubpath()
                    ctx.fill(area, with: .linearGradient(Gradient(colors: [tint.opacity(0.22), tint.opacity(0)]), startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))
                    ctx.stroke(line, with: .color(tint), style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))
                    ctx.fill(Path(ellipseIn: CGRect(x: b.x - 2.5, y: b.y - 2.5, width: 5, height: 5)), with: .color(tint))
                }
                ctx.draw(Text(Self.clock(first)).font(m.font(.tiny)).foregroundColor(theme.dim), at: CGPoint(x: left, y: size.height), anchor: .bottomLeading)
                ctx.draw(Text(Self.clock(last)).font(m.font(.tiny)).foregroundColor(theme.dim), at: CGPoint(x: size.width, y: size.height), anchor: .bottomTrailing)
            }.frame(minHeight: m(80))
            if !top.isEmpty {
                VStack(spacing: m(3)) {
                    procRow("앱", "CPU", tr("메모리"), header: true)
                    ForEach(Array(top.enumerated()), id: \.offset) { _, p in procRow(p.name ?? "—", Self.pc(p.cpu), Self.bytes(p.rss), header: false) }
                }
            }
        }
    }
    private func procRow(_ name: String, _ cpu: String, _ memory: String, header: Bool) -> some View {
        HStack(spacing: m(10)) {
            Text(name).foregroundStyle(header ? theme.dim : theme.ink).lineLimit(1).truncationMode(.tail).frame(maxWidth: .infinity, alignment: .leading)
            Text(cpu).fontWeight(.semibold).foregroundStyle(header ? theme.dim : theme.ink).monospacedDigit()
            Text(memory).foregroundStyle(header ? theme.dim : theme.muted).monospacedDigit().frame(width: m(64), alignment: .trailing)
        }.font(header ? m.font(.tiny, .semibold) : m.font(.caption))
    }

    // MARK: Words and numbers, as the dashboard writes them
    /// An account's short name: the tool (Agy for Antigravity) and its plan.
    static func tool(_ a: ClusterReadings.Account) -> String { ["Claude": "Claude", "Codex": "Codex", "Antigravity": "Agy", "GLM": "GLM"][a.kind] ?? kindName(a.kind) }
    static func plan(_ a: ClusterReadings.Account) -> String {
        if let plan = a.plan { return plan }
        return (a.alias ?? "").replacingOccurrences(of: #"\s+models?$"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^Claude and GPT$"#, with: "Claude·GPT", options: [.regularExpression, .caseInsensitive])
    }
    static func kindName(_ kind: String) -> String { kind == "Claude" ? "Claude Code" : kind == "Antigravity" ? "Agy CLI" : kind }
    /// A model as the dashboard names it: claude-opus-5-5 → Opus 5.5, gpt-6.1-sol → GPT-6.1-sol.
    static func modelName(_ model: String) -> String {
        var s = model.replacingOccurrences(of: "[1m]", with: "", options: .caseInsensitive)
        if s.hasPrefix("claude-") { s.removeFirst(7) }
        if s.hasPrefix("gpt-") { s = "GPT-" + s.dropFirst(4) }
        if let m = s.range(of: #"^(opus|sonnet|haiku|fable)-(\d+)-(\d+)"#, options: .regularExpression) {
            let parts = s[m].split(separator: "-")
            return parts[0].prefix(1).uppercased() + parts[0].dropFirst() + " " + parts[1] + "." + parts[2]
        }
        return s
    }
    /// quick.js clusterNumber: 1.23B, 108.40M, 12.3k.
    static func figure(_ n: Double) -> String {
        n >= 1e9 ? String(format: "%.2fB", n / 1e9) : n >= 1e6 ? String(format: "%.2fM", n / 1e6) : n >= 1e3 ? String(format: "%.1fk", n / 1e3) : ClusterReadings.number(n)
    }
    /// The trip reads as the token dial does: three digits and k, M or B (396M).
    static func short(_ v: Double) -> String {
        let g = ClusterCells.tokens(v)
        return String(g.c).trimmingCharacters(in: .whitespaces) + g.unit
    }
    static func burnText(_ v: Double) -> String { ClusterReadings.reading(v) + "%/시간" }
    static func pc(_ v: Double?) -> String { v.map { String(format: "%.1f%%", $0) } ?? "—" }
    static func bytes(_ n: Double?) -> String {
        guard let n else { return "—" }
        return n >= 1_073_741_824 ? String(format: "%.1f GB", n / 1_073_741_824) : n >= 1_048_576 ? String(format: "%.0f MB", n / 1_048_576)
            : n >= 1024 ? String(format: "%.1f KB", n / 1024) : "\(Int(n.rounded())) B"
    }
    static func folder(_ path: String?) -> String { (path ?? "").split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? "" }
    private static func format(_ t: Double, _ pattern: String) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.dateFormat = pattern
        return f.string(from: Date(timeIntervalSince1970: t))
    }
    static func clock(_ t: Double?) -> String { t.map { format($0, "HH:mm") } ?? "" }
    static func when(_ t: Double) -> String { format(t, "E HH:mm") }
    static func date(_ t: Double) -> String { format(t, "M. d. (E) a h:mm") }
    /// The trip's start: its time today, else its date and time.
    static func since(_ t: Double) -> String {
        format(t, Calendar.current.isDateInToday(Date(timeIntervalSince1970: t)) ? "HH:mm" : "M. d. HH:mm") + "부터"
    }
}

/// The collector's usage heatmaps (/api/history), read as history.js reads them.
struct ClusterHeat: Decodable {
    struct Reply: Decodable { var heatmap: ClusterHeat?; var series: Series? }
    /// The trend series: the bins' starts, each project's tokens per bin (null outside the record) and the total.
    struct Series: Decodable {
        var bins: [Double]; var total: [Double?]; var by_project: [Row]?
        struct Row: Decodable { var key: String; var label: String?; var tokens: [Double?]; var folded: Int? }
    }
    /// [date, hour, tokens]: a day's hour on record; tokens null when it was not.
    struct Hour: Decodable {
        var date: String; var hour: Int; var value: Double?
        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            date = try c.decode(String.self); hour = Int(try c.decode(Double.self)); value = try c.decodeIfPresent(Double.self)
        }
    }
    /// [date, tokens]: a day's total.
    struct Day: Decodable {
        var date: String; var value: Double?
        init(from decoder: Decoder) throws {
            var c = try decoder.unkeyedContainer()
            date = try c.decode(String.self); value = try c.decodeIfPresent(Double.self)
        }
    }
    struct Cell { var value: Double; var days: Int }
    struct YearCell { var date: String; var value: Double?; var future: Bool; var today: Bool }
    var hours: [Hour]; var days: [Day]
    /// What the page has loaded: the period it asked for and when, so it asks again once a minute at most.
    struct Load {
        var key = ""; var at = Date.distantPast; var loading = false; var data: ClusterHeat?; var series: Series?; var message = "기록을 불러오고 있습니다"
        /// Each project's colour slot, kept across refreshes.
        var slots: [String: Int] = [:]
    }
    /// history.js fold: the top rows by total; the rest, with the server's own folded row, become one "other" row.
    static func fold(_ rows: [Series.Row], count: Int = 5) -> (shown: [Series.Row], other: Series.Row?) {
        let total = { (r: Series.Row) in r.tokens.reduce(0) { $0 + ($1 ?? 0) } }
        let ranked = rows.filter { $0.key != "__other__" && total($0) > 0 }.sorted { total($0) > total($1) }
        let rest = Array(ranked.dropFirst(count)) + rows.filter { $0.key == "__other__" }, length = rows.first?.tokens.count ?? 0
        guard !rest.isEmpty else { return (Array(ranked.prefix(count)), nil) }
        let tokens: [Double?] = (0..<length).map { i in rest.allSatisfy { i >= $0.tokens.count || $0.tokens[i] == nil } ? nil : rest.reduce(0) { $0 + ((i < $1.tokens.count ? $1.tokens[i] : nil) ?? 0) } }
        let other = Series.Row(key: "__other__", label: nil, tokens: tokens, folded: rest.reduce(0) { $0 + ($1.key == "__other__" ? ($1.folded ?? 0) : 1) })
        return (Array(ranked.prefix(count)), tokens.contains { ($0 ?? 0) > 0 } ? other : nil)
    }
    /// Colour slots that stay with a project: survivors keep theirs, newcomers take the lowest free slot.
    static func slots(_ previous: [String: Int], _ keys: [String], count: Int = 5) -> [String: Int] {
        var out: [String: Int] = [:], used = Set<Int>()
        for k in keys { if let s = previous[k], s < count, !used.contains(s) { out[k] = s; used.insert(s) } }
        for k in keys where out[k] == nil { var s = 0; while used.contains(s) { s += 1 }; out[k] = s; used.insert(s) }
        return out
    }
    static func projectName(_ row: Series.Row) -> String {
        if row.key == "unknown" { return "프로젝트 미확인" }
        if row.key.range(of: #"/\.aside/u/[^/]+$"#, options: .regularExpression) != nil || row.label == "0" { return "Aside 기본 작업공간" }
        return (row.label?.isEmpty == false ? row.label : nil) ?? row.key
    }
    /// Axis top for a stacked total: steps whose halves are round too.
    static func axisMax(_ peak: Double) -> Double {
        guard peak > 0 else { return 1 }
        let p = pow(10, floor(log10(peak)))
        return ([1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].first { $0 * p >= peak } ?? 10) * p
    }
    /// Runs of bins on record; null bins are outside the record and draw nothing.
    static func runs(_ total: [Double?]) -> [(Int, Int)] {
        var out: [(Int, Int)] = [], start = -1
        for (i, v) in total.enumerated() {
            if v != nil && start < 0 { start = i }
            if v == nil && start >= 0 { out.append((start, i - 1)); start = -1 }
        }
        if start >= 0 { out.append((start, total.count - 1)) }
        return out
    }
    /// Monotone cubic samples (Fritsch–Carlson): never overshoots, so stacked layers never cross.
    static func smooth(_ values: [Double], samples: Int = 6) -> [(x: Double, y: Double)] {
        let n = values.count
        guard n >= 2 else { return values.enumerated().map { (Double($0.offset), $0.element) } }
        let d = (0..<(n - 1)).map { values[$0 + 1] - values[$0] }
        // Written out step by step: the chained ternary in one closure timed out the type checker on CI.
        var m = [Double](repeating: 0, count: n)
        for i in 0..<n {
            if i == 0 { m[i] = d[0] } else if i == n - 1 { m[i] = d[n - 2] }
            else { let before: Double = d[i - 1], after: Double = d[i]; m[i] = before * after <= 0 ? 0 : (before + after) / 2 }
        }
        for i in 0..<(n - 1) {
            if d[i] == 0 { m[i] = 0; m[i + 1] = 0; continue }
            let a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b
            if s > 9 { let t = 3 / s.squareRoot(); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i] }
        }
        var out: [(x: Double, y: Double)] = []
        for i in 0..<(n - 1) {
            for k in 0..<samples {
                let t = Double(k) / Double(samples), t2: Double = t * t, t3: Double = t2 * t
                let h00: Double = 2 * t3 - 3 * t2 + 1, h10: Double = t3 - 2 * t2 + t, h01: Double = 3 * t2 - 2 * t3, h11: Double = t3 - t2
                let y: Double = h00 * values[i] + h10 * m[i] + h01 * values[i + 1] + h11 * m[i + 1]
                out.append((Double(i) + t, max(0, y)))
            }
        }
        out.append((Double(n - 1), values[n - 1]))
        return out
    }
    private static func parts(_ date: String) -> DateComponents? {
        let p = date.split(separator: "-").compactMap { Int($0) }
        return p.count == 3 ? DateComponents(year: p[0], month: p[1], day: p[2]) : nil
    }
    /// Monday-first weekday of a local "YYYY-MM-DD" date.
    static func weekday(_ date: String) -> Int? {
        guard let c = parts(date), let day = Calendar(identifier: .gregorian).date(from: c) else { return nil }
        return (Calendar(identifier: .gregorian).component(.weekday, from: day) + 5) % 7
    }
    /// Weekday × hour: the average over the days each cell was on record.
    static func weekHours(_ hours: [Hour]) -> [[Cell?]] {
        var sum = Array(repeating: Array(repeating: 0.0, count: 24), count: 7), days = Array(repeating: Array(repeating: 0, count: 24), count: 7)
        for h in hours { guard let v = h.value, (0..<24).contains(h.hour), let w = weekday(h.date) else { continue }; sum[w][h.hour] += v; days[w][h.hour] += 1 }
        return (0..<7).map { (w: Int) -> [Cell?] in
            (0..<24).map { (h: Int) -> Cell? in
                let n: Int = days[w][h]
                return n > 0 ? Cell(value: sum[w][h] / Double(n), days: n) : nil
            }
        }
    }
    /// Five equal classes of the largest value; measured zero is its own class.
    static func level(_ value: Double, _ max: Double) -> Int { !(value > 0) || !(max > 0) ? 0 : Swift.max(1, Swift.min(5, Int(ceil(5 * value / max)))) }
    /// The last 53 Monday-first weeks ending this week; days before the record are null, days after today future.
    static func year(_ days: [Day], today: Date) -> (weeks: [[YearCell]], months: [(week: Int, month: Int)]) {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = .current
        let key = { (d: Date) -> String in let c = calendar.dateComponents([.year, .month, .day], from: d); return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!) }
        let todayKey = key(today), values = Dictionary(days.map { ($0.date, $0.value) }, uniquingKeysWith: { a, _ in a }), first = days.first?.date ?? todayKey
        let start = calendar.date(byAdding: .day, value: -((calendar.component(.weekday, from: today) + 5) % 7) - 52 * 7, to: calendar.startOfDay(for: today))!
        var weeks: [[YearCell]] = [], months: [(week: Int, month: Int)] = []
        for w in 0..<53 {
            var col: [YearCell] = []
            for i in 0..<7 {
                let day = calendar.date(byAdding: .day, value: w * 7 + i, to: start)!, k = key(day)
                col.append(YearCell(date: k, value: k > todayKey || k < first ? nil : values[k] ?? nil, future: k > todayKey, today: k == todayKey))
                if calendar.component(.day, from: day) == 1 { months.append((w, calendar.component(.month, from: day))) }
            }
            weeks.append(col)
        }
        return (weeks, months)
    }
}

/// An NSMenu item's action that runs a closure.
private final class ClusterMenuAction: NSObject {
    let action: () -> Void
    init(_ action: @escaping () -> Void) { self.action = action }
    @objc func run() { action() }
}

/// The layout switch beside the logo: the dials one above the other, or side by side.
struct ClusterLayoutIcon: View {
    var color: Color
    var size: CGFloat
    var body: some View {
        Canvas { ctx, _ in
            let k = size / 24
            ctx.scaleBy(x: k, y: k)
            var p = Path()
            p.addEllipse(in: CGRect(x: 3, y: 3.5, width: 9, height: 9)); p.addEllipse(in: CGRect(x: 12, y: 3.5, width: 9, height: 9))
            p.addRoundedRect(in: CGRect(x: 3, y: 15, width: 18, height: 6), cornerSize: CGSize(width: 1.6, height: 1.6))
            ctx.stroke(p, with: .color(color), lineWidth: 1.7)
        }.frame(width: size, height: size).accessibilityHidden(true)
    }
}
