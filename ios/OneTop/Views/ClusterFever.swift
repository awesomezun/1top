import SwiftUI

/// Past its limit a dial breaks through, as a racing car does (cluster.js paintFever, the chosen drive + zap + punch):
/// the token dial past 200M (levels at 300M, 400M, 500M and on), the burn dial past 20%/h (levels at 40, 60, 80%/h and
/// on). Entering a level the dial jumps forward and shakes, a discharge runs
/// round the whole rim and the level's word sweeps across; while the level stays, a glow hugging the rim beats in the
/// level's colour. Reduce Motion keeps only the glow, still. Nothing is drawn past an eighth of the radius outside the
/// rim, so the window and the lower row stay clear.
enum Fever {
    static let words = ["", "LIMIT BREAK", "OVER DRIVE", "FEVER"]
    /// Each level's colour and its second colour: orange, magenta, electric blue (past the red zone, never red).
    static let hues: [(Color, Color)] = [(.clear, .clear), (Lane.rgb(0xff8a1f), Lane.rgb(0xffd23f)),
                                         (Lane.rgb(0xff2fb4), Lane.rgb(0x9d5bff)), (Lane.rgb(0x33e7ff), Lane.rgb(0xffffff))]
    /// One beat of the rim's glow, in seconds, by level.
    static let beat = [1.6, 1.6, 1.05, 0.65]
    static let split = (Lane.rgb(0xff2a6a), Lane.rgb(0x22e6ff))
    static let rainbow = [Lane.rgb(0xff3b30), Lane.rgb(0xffd23f), Lane.rgb(0x57d36a), Lane.rgb(0x33e7ff), Lane.rgb(0x9d5bff)]
}

/// Each dial's level last shown, kept across the dial being drawn anew (turning the phone, switching the layout), so a
/// level bursts once and not again each time the dial reappears.
@MainActor private enum FeverMemory { static var shown: [String: Int] = [:] }

/// The dial's jump on a burst: forward and back with a bounce, and a short shake.
private struct Jolt { var scale = 1.0; var dx = 0.0; var dy = 0.0 }
/// The banner's sweep: in from the left, held, out to the right.
private struct Sweep { var x = -0.7; var opacity = 0.0; var grow = 1.0 }

struct FeverDial<Content: View>: View {
    let level: Int
    /// Which dial: the token dial and the burn dial keep their levels apart.
    var memory = "tach"
    let side: CGFloat
    let reduceMotion: Bool
    @ViewBuilder var content: () -> Content

    @State private var burst = 0
    @State private var burstLevel = 0
    @State private var zapping = false

    var body: some View {
        let level = max(0, min(3, self.level))
        content()
            .keyframeAnimator(initialValue: Jolt(), trigger: burst) { view, j in
                view.scaleEffect(j.scale).offset(x: j.dx * side, y: j.dy * side)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    CubicKeyframe(1.07, duration: 0.15)
                    SpringKeyframe(1, duration: 0.45, spring: .bouncy)
                }
                KeyframeTrack(\.dx) {
                    LinearKeyframe(-0.012, duration: 0.07); LinearKeyframe(0.014, duration: 0.07); LinearKeyframe(-0.008, duration: 0.07)
                    LinearKeyframe(0.006, duration: 0.07); LinearKeyframe(0, duration: 0.07)
                }
                KeyframeTrack(\.dy) {
                    LinearKeyframe(0.008, duration: 0.07); LinearKeyframe(-0.006, duration: 0.07); LinearKeyframe(-0.01, duration: 0.07)
                    LinearKeyframe(0.011, duration: 0.07); LinearKeyframe(0, duration: 0.07)
                }
            }
            .background {
                if level > 0 { FeverGlow(color: Fever.hues[level].0, beat: Fever.beat[level], side: side, still: reduceMotion).id(level) }
            }
            .overlay {
                ZStack {
                    FeverFlash(color: Fever.hues[max(1, burstLevel)].1, side: side, trigger: burst)
                    if zapping { FeverZap(level: max(1, burstLevel), side: side) }
                    FeverBanner(level: max(1, burstLevel), side: side, trigger: burst)
                }
                // As the web clips its layer: nothing past an eighth of the radius outside the rim.
                .mask(Circle().frame(width: side * 1.12, height: side * 1.12))
                .allowsHitTesting(false)
            }
            .onAppear { if level > FeverMemory.shown[memory, default: 0] { fire(level) }; FeverMemory.shown[memory] = level }
            .onChange(of: level) { old, new in if new > old && new > FeverMemory.shown[memory, default: 0] { fire(new) }; FeverMemory.shown[memory] = new }
    }

    /// A new level bursts once (the first reading past the limit too); Reduce Motion keeps it still.
    private func fire(_ l: Int) {
        guard !reduceMotion else { return }
        burstLevel = l; burst += 1; zapping = true
        let mark = burst
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(900))
            if burst == mark { zapping = false }
        }
    }
}

/// A glow hugging the rim in the level's colour, beating once a level's beat.
private struct FeverGlow: View {
    let color: Color
    let beat: Double
    let side: CGFloat
    let still: Bool
    @State private var on = false

    var body: some View {
        Circle().stroke(color.opacity(0.55), lineWidth: side * 0.03).blur(radius: side * 0.012)
            .frame(width: side * 0.996, height: side * 0.996)
            .scaleEffect(still ? 1 : on ? 1.02 : 0.985).opacity(still ? 0.8 : on ? 1 : 0.45)
            .onAppear {
                guard !still else { return }
                withAnimation(.easeInOut(duration: beat / 2).repeatForever(autoreverses: true)) { on = true }
            }
            .allowsHitTesting(false)
    }
}

/// The burst's flash in the level's second colour, in three steps over half a second.
private struct FeverFlash: View {
    let color: Color
    let side: CGFloat
    let trigger: Int

    var body: some View {
        Circle().fill(RadialGradient(colors: [color.opacity(0.7), .clear], center: .center, startRadius: 0, endRadius: side * 0.5))
            .frame(width: side, height: side)
            .keyframeAnimator(initialValue: 0.0, trigger: trigger) { view, o in view.opacity(o) } keyframes: { _ in
                KeyframeTrack {
                    MoveKeyframe(0); LinearKeyframe(0.85, duration: 0.06)
                    MoveKeyframe(0.85); LinearKeyframe(0.5, duration: 0.17); MoveKeyframe(0.3); LinearKeyframe(0, duration: 0.27)
                }
            }
    }
}

/// The discharge round the whole rim: about ten arcs and four bolts striking in, drawn anew every 70 ms, the outer
/// stroke in the level's colour and the core in its second colour, glowing.
private struct FeverZap: View {
    let level: Int
    let side: CGFloat

    var body: some View {
        let (hue, hue2) = Fever.hues[level], box = side * 1.24
        TimelineView(.animation(minimumInterval: 0.07)) { _ in
            Canvas { ctx, size in
                let k = side / 340, c = CGPoint(x: size.width / 2, y: size.height / 2)
                func at(_ a: Double, _ r: Double) -> CGPoint { CGPoint(x: c.x + cos(a) * r * k, y: c.y + sin(a) * r * k) }
                var bolts: [Path] = []
                for i in 0..<10 {
                    let mid = Double.random(in: 0..<(2 * .pi)), span = (0.18 + Double.random(in: 0..<0.25)) * 1.6
                    var p = Path()
                    for (j, t) in stride(from: -1.0, through: 1.0001, by: 0.125).enumerated() {
                        let r = 158 + (Double.random(in: 0..<1) - 0.5) * (10 + Double(level) * 4), point = at(mid + t * span / 2, r)
                        if j == 0 { p.move(to: point) } else { p.addLine(to: point) }
                    }
                    bolts.append(p)
                    if i < 4 {
                        var b = Path()
                        for (j, r) in stride(from: 158.0, to: 40, by: -14).enumerated() {
                            let point = at(mid, r), jx = (Double.random(in: 0..<1) - 0.5) * 14 * k, jy = (Double.random(in: 0..<1) - 0.5) * 14 * k
                            let q = CGPoint(x: point.x + jx, y: point.y + jy)
                            if j == 0 { b.move(to: q) } else { b.addLine(to: q) }
                        }
                        bolts.append(b)
                    }
                }
                ctx.drawLayer { layer in
                    layer.addFilter(.shadow(color: hue, radius: 9 * k))
                    for b in bolts { layer.stroke(b, with: .color(hue.opacity(0.45)), lineWidth: 6 * k) }
                }
                for b in bolts { ctx.stroke(b, with: .color(hue2), lineWidth: 1.6 * k) }
            }
        }
        .frame(width: box, height: box)
    }
}

/// LIMIT BREAK, OVER DRIVE, FEVER sweeping across the dial, leaning and split in colour; FEVER larger, in a rainbow.
private struct FeverBanner: View {
    let level: Int
    let side: CGFloat
    let trigger: Int

    var body: some View {
        let size = side * (level == 3 ? 0.15 : 0.11), word = Fever.words[level], (red, cyan) = Fever.split
        let font = Font.system(size: size, weight: .black).italic()
        ZStack {
            Text(word).font(font).foregroundStyle(red).offset(x: side * 0.006)
            Text(word).font(font).foregroundStyle(cyan).offset(x: -side * 0.006)
            if level == 3 {
                Text(word).font(font).foregroundStyle(LinearGradient(colors: Fever.rainbow, startPoint: .leading, endPoint: .trailing))
            } else {
                Text(word).font(font).foregroundStyle(Fever.hues[level].0)
            }
        }
        .lineLimit(1).fixedSize()
        .shadow(color: Fever.hues[level].0.opacity(0.8), radius: side * 0.04)
        .transformEffect(CGAffineTransform(a: 1, b: 0, c: tan(-18 * Double.pi / 180), d: 1, tx: 0, ty: 0))
        .keyframeAnimator(initialValue: Sweep(), trigger: trigger) { view, s in
            view.scaleEffect(s.grow).offset(x: s.x * side).opacity(s.opacity)
        } keyframes: { _ in
            KeyframeTrack(\.x) {
                MoveKeyframe(-0.7); CubicKeyframe(0, duration: 0.29); LinearKeyframe(0, duration: 0.83); CubicKeyframe(0.7, duration: 0.48)
            }
            KeyframeTrack(\.opacity) {
                MoveKeyframe(0); LinearKeyframe(1, duration: 0.29); LinearKeyframe(1, duration: 0.83); LinearKeyframe(0, duration: 0.48)
            }
            KeyframeTrack(\.grow) {
                MoveKeyframe(1); LinearKeyframe(1, duration: 0.29); LinearKeyframe(1.04, duration: 0.83); LinearKeyframe(1, duration: 0.48)
            }
        }
        .offset(y: -side * 0.08)
    }
}
