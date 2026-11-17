import SwiftUI

/// The cluster's period control in the layout's shape (cluster.js gearDial, customizing-spec_v1.2.2): the drum by
/// default (and for 'auto', this screen's own), a row of tabs that scrolls sideways when it cannot fit, a radio tuner, a
/// roller, a knob or a lever. Each turns by dragging or a press on a period and springs to the nearest stop.
struct PeriodControl: View {
    var shape: String
    @Binding var period: Period
    var theme: QuickTheme

    var body: some View {
        switch shape {
        case "tabs": PeriodTabs(period: $period, theme: theme)
        case "tuner", "roller", "knob", "lever": PeriodDial(kind: shape, period: $period, theme: theme)
        default: PeriodDrum(period: $period, theme: theme)
        }
    }
}

/// The periods as tabs in one well, the one in use lit in the accent.
private struct PeriodTabs: View {
    @Binding var period: Period
    var theme: QuickTheme

    var body: some View {
        ViewThatFits(in: .horizontal) {
            row(fill: true)
            ScrollView(.horizontal) { row(fill: false) }.scrollIndicators(.hidden)
        }
        .frame(height: 40)
        .background(theme.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line))
        .accessibilityElement(children: .contain).accessibilityLabel(L.t("Time window", "기간"))
        .accessibilityIdentifier("period-tabs")
    }
    private func row(fill: Bool) -> some View {
        HStack(spacing: 2) {
            ForEach(Period.allCases) { item in
                let on = item == period
                Button { period = item } label: {
                    Text(item.label).font(.system(size: 12.5, weight: on ? .bold : .semibold)).lineLimit(1).fixedSize()
                        .foregroundStyle(on ? theme.background : theme.muted)
                        .padding(.horizontal, 6).frame(maxWidth: fill ? .infinity : nil).frame(height: 32)
                        .background(on ? theme.accent : .clear, in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
    }
}

/// The tuner, roller, knob and lever: a position that follows the finger and springs to the nearest period.
private struct PeriodDial: View {
    var kind: String
    @Binding var period: Period
    var theme: QuickTheme
    @State private var p: Double = 0
    @State private var start: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let items = Period.allCases

    static func height(_ kind: String) -> CGFloat { kind == "knob" ? 94 : kind == "lever" ? 56 : 46 }
    /// Points of drag per period, and which way a drag turns it.
    private func unit(_ w: CGFloat) -> Double { ["tuner": PeriodDialFace.tune, "roller": 30, "knob": 34][kind] ?? Double(w) / Double(items.count) }
    private var dir: Double { kind == "tuner" || kind == "roller" ? -1 : 1 }

    var body: some View {
        GeometryReader { geo in
            PeriodDialFace(kind: kind, p: p, items: items, theme: theme, select: select).frame(width: geo.size.width, height: geo.size.height)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 4).onChanged { v in
                    if start == nil { start = p }
                    let delta = kind == "roller" ? v.translation.height : v.translation.width
                    p = min(Double(items.count - 1) + 0.4, max(-0.4, start! + dir * Double(delta) / unit(geo.size.width)))
                }.onEnded { _ in
                    start = nil; select(Int(p.rounded()))
                })
        }
        .frame(height: Self.height(kind))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line.mix(with: .black, by: 0.3)))
        .onAppear { p = Double(items.firstIndex(of: period) ?? 0) }
        .onChange(of: period) { if start == nil { turn(to: items.firstIndex(of: period) ?? 0) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.t("Time window", "기간")).accessibilityValue(period.label)
        .accessibilityAdjustableAction { direction in select((items.firstIndex(of: period) ?? 0) + (direction == .increment ? 1 : -1)) }
        .accessibilityIdentifier("period-\(kind)")
    }
    private func turn(to i: Int) {
        if reduceMotion { p = Double(i) } else { withAnimation(.spring(response: 0.5, dampingFraction: 0.68)) { p = Double(i) } }
    }
    private func select(_ i: Int) {
        let i = min(items.count - 1, max(0, i))
        turn(to: i)
        if period != items[i] { period = items[i] }
    }
}

/// Where every part stands at position p (a fractional index while it turns), as cluster.js gearPlace draws it.
private struct PeriodDialFace: View, @preconcurrency Animatable {
    static let tune = 78.0
    var kind: String
    var p: Double
    var items: [Period]
    var theme: QuickTheme
    var select: (Int) -> Void
    var animatableData: Double {
        get { p }
        set { p = newValue }
    }
    private var last: Double { Double(items.count - 1) }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            switch kind {
            case "tuner": tuner(w, h)
            case "roller": roller(w, h)
            case "knob": knob(w, h)
            default: lever(w, h)
            }
        }
    }

    private func label(_ i: Int, size: CGFloat = 12.5) -> some View {
        let on = abs(Double(i) - p) < 0.5
        return Text(items[i].label).font(.system(size: size, weight: .semibold)).lineLimit(1).fixedSize()
            .foregroundStyle(on ? theme.accent : theme.muted)
            .shadow(color: on ? theme.accent.opacity(0.45) : .clear, radius: 5)
            .onTapGesture { select(i) }
    }

    // tuner: a radio dial's strip of ticks and periods sliding under a fixed red needle, fading at both ends.
    private func tuner(_ w: CGFloat, _ h: CGFloat) -> some View {
        let shift = w / 2 - CGFloat((p + 0.5) * Self.tune)
        return ZStack(alignment: .topLeading) {
            LinearGradient(colors: [Lane.rgb(0x0a0d0f), Lane.rgb(0x151a1d)], startPoint: .top, endPoint: .bottom)
            ZStack(alignment: .topLeading) {
                Canvas { ctx, size in
                    var x = shift.truncatingRemainder(dividingBy: 13) + 12
                    while x < size.width { ctx.fill(Path(CGRect(x: x, y: size.height - 8, width: 1, height: 8)), with: .color(theme.ink.opacity(0.22))); x += 13 }
                    for i in items.indices {
                        let on = abs(Double(i) - p) < 0.5, cx = shift + CGFloat((Double(i) + 0.5) * Self.tune)
                        ctx.fill(Path(roundedRect: CGRect(x: cx - 1, y: 32, width: 2, height: 12), cornerRadius: 1), with: .color(on ? theme.accent : theme.ink.opacity(0.45)))
                    }
                }
                ForEach(items.indices, id: \.self) { i in
                    label(i).opacity(max(0.35, 1 - abs(Double(i) - p) * 0.22))
                        .position(x: shift + CGFloat((Double(i) + 0.5) * Self.tune), y: 17)
                }
            }
            .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.16), .init(color: .black, location: 0.84),
                                         .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing))
            // The needle, with its small head.
            Path { p in p.addLines([CGPoint(x: w / 2 - 4, y: 23), CGPoint(x: w / 2 + 4, y: 23), CGPoint(x: w / 2, y: 28)]); p.closeSubpath() }
                .fill(Lane.needle)
            RoundedRectangle(cornerRadius: 1).fill(Lane.needle).frame(width: 2, height: max(0, h - 30))
                .shadow(color: Lane.needle, radius: 3).offset(x: w / 2 - 1, y: 28)
        }
    }

    // roller: a drum turning up and down in a window, a step either side.
    private func roller(_ w: CGFloat, _ h: CGFloat) -> some View {
        let at = Int(p.rounded())
        return ZStack {
            LinearGradient(stops: [.init(color: Lane.rgb(0x050607), location: 0), .init(color: Lane.rgb(0x1d2226), location: 0.3),
                                   .init(color: Lane.rgb(0x2a3136), location: 0.5), .init(color: Lane.rgb(0x1d2226), location: 0.7),
                                   .init(color: Lane.rgb(0x050607), location: 1)], startPoint: .top, endPoint: .bottom)
            HStack(spacing: 0) {
                step("‹", L.t("Previous period", "이전 기간")) { select(at - 1) }
                ZStack {
                    ForEach(items.indices, id: \.self) { i in
                        let a = min(90, max(-90, (Double(i) - p) * 34)), r = a * .pi / 180
                        label(i).rotation3DEffect(.degrees(-a), axis: (x: 1, y: 0, z: 0), perspective: 0.4)
                            .offset(y: 40 * sin(r)).opacity(pow(max(0, cos(r)), 2))
                    }
                    VStack {
                        Rectangle().fill(theme.accent.opacity(0.45)).frame(height: 1)
                        Spacer()
                        Rectangle().fill(theme.accent.opacity(0.45)).frame(height: 1)
                    }
                    .padding(.vertical, 9).padding(.horizontal, (w - 60) * 0.18).allowsHitTesting(false)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity).clipped()
                .overlay(HStack { Rectangle().fill(theme.line.opacity(0.6)).frame(width: 1); Spacer(); Rectangle().fill(theme.line.opacity(0.6)).frame(width: 1) })
                step("›", L.t("Next period", "다음 기간")) { select(at + 1) }
            }
        }
    }
    private func step(_ glyph: String, _ name: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(glyph).font(.system(size: 20, weight: .medium)).foregroundStyle(theme.muted).frame(width: 30).frame(maxHeight: .infinity).contentShape(Rectangle())
        }
        .buttonStyle(.plain).accessibilityLabel(name)
    }

    // knob: a ridged knob turned to the period it points at, its periods on an arc above it.
    private static let knobY = 70.0, knobRX = 112.0, knobRY = 56.0
    private func knobAt(_ i: Int) -> CGPoint {
        // The periods spread over the same arc as the web's seven stops.
        let a = (-170 + Double(i) * 160 / max(1, last)) * .pi / 180
        return CGPoint(x: cos(a) * Self.knobRX, y: Self.knobY + sin(a) * Self.knobRY)
    }
    private func knobTurn(_ p: Double) -> Double {
        let i = max(0, min(items.count - 2, Int(p.rounded(.down)))), f = p - Double(i)
        func ang(_ j: Int) -> Double { let pt = knobAt(j); return atan2(pt.x, Self.knobY - pt.y) * 180 / .pi }
        return ang(i) + (ang(i + 1) - ang(i)) * f
    }
    private func knob(_ w: CGFloat, _ h: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            RadialGradient(colors: [Lane.rgb(0x1c2226), Lane.rgb(0x0b0e10)], center: UnitPoint(x: 0.5, y: 1), startRadius: 0, endRadius: w * 0.42)
            ForEach(items.indices, id: \.self) { i in
                let pt = knobAt(i)
                label(i, size: 11.5).position(x: w / 2 + pt.x, y: pt.y)
            }
            ZStack {
                Circle().fill(RadialGradient(colors: [Lane.rgb(0x57616a), Lane.rgb(0x20262a), Lane.rgb(0x0a0c0e)], center: UnitPoint(x: 0.38, y: 0.3), startRadius: 0, endRadius: 30))
                Canvas { ctx, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    for k in 0..<40 {
                        let a = Double(k) * 9 * .pi / 180
                        var line = Path(); line.move(to: c); line.addLine(to: CGPoint(x: c.x + cos(a) * 21, y: c.y + sin(a) * 21))
                        ctx.stroke(line, with: .color(.white.opacity(0.07)), lineWidth: 1.6)
                    }
                }
                RoundedRectangle(cornerRadius: 2).fill(theme.accent).frame(width: 3, height: 13).shadow(color: theme.accent, radius: 3)
                    .offset(y: -21 + 3 + 6.5).rotationEffect(.degrees(knobTurn(min(last, max(0, p)))))
            }
            .frame(width: 42, height: 42)
            .shadow(color: .black.opacity(0.65), radius: 6, y: 5)
            .padding(3).background(Circle().fill(Lane.rgb(0x0a0d0f))).overlay(Circle().stroke(theme.line.opacity(0.7)))
            .position(x: w / 2, y: Self.knobY)
            .allowsHitTesting(false)
        }
    }

    // lever: a lever sliding in a groove between notches, its periods underneath.
    private func lever(_ w: CGFloat, _ h: CGFloat) -> some View {
        let x0 = w * 0.04, tw = w * 0.92, n = CGFloat(items.count)
        let at = x0 + tw * (CGFloat(min(last, max(0, p))) + 0.5) / n
        return ZStack(alignment: .topLeading) {
            LinearGradient(colors: [Lane.rgb(0x121619), Lane.rgb(0x0b0e10)], startPoint: .top, endPoint: .bottom)
            RoundedRectangle(cornerRadius: 6).fill(Lane.rgb(0x050708)).frame(width: tw, height: 12)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(.black.opacity(0.9), lineWidth: 1))
                .offset(x: x0, y: 10)
            ForEach(items.indices, id: \.self) { i in
                Circle().fill(theme.ink.opacity(0.25)).frame(width: 4, height: 4)
                    .position(x: x0 + tw * (CGFloat(i) + 0.5) / n, y: 16)
            }
            RoundedRectangle(cornerRadius: 8)
                .fill(LinearGradient(stops: [.init(color: Lane.rgb(0x68737b), location: 0), .init(color: Lane.rgb(0x2c3337), location: 0.55),
                                             .init(color: Lane.rgb(0x1a1e21), location: 1)], startPoint: .top, endPoint: .bottom))
                .overlay(RoundedRectangle(cornerRadius: 1).fill(theme.accent).frame(width: 2).padding(.vertical, 5).shadow(color: theme.accent, radius: 3))
                .frame(width: 30, height: 24).shadow(color: .black.opacity(0.65), radius: 5, y: 4)
                .position(x: at, y: 16).allowsHitTesting(false)
            HStack(spacing: 0) {
                ForEach(items.indices, id: \.self) { i in label(i, size: 11.5).frame(maxWidth: .infinity) }
            }
            .frame(width: tw).offset(x: x0, y: h - 23)
        }
    }
}
