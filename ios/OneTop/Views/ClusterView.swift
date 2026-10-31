import SwiftUI

/// The dashboard's cluster (계기판) on the Dashboard tab, as the dashboard lays it out at phone width: the burn
/// speedometer first, the token tachometer at the same size, the warning lights (centred, as in the menu bar and tray
/// panels), the odometer with the trip, and each account's weekly limit left as fuel. The period picker above and the session list below stay. The readings
/// are ClusterReadings, the numbers the 1top.si dashboard's cluster shows for the same reports. Needles spring
/// to each reading and shimmer while sessions work, and the odometer and trip run on each second at the last
/// minute's rate until the next reading; with Reduce Motion they change only with the readings.
struct ClusterCard: View {
    @Environment(AppModel.self) private var model
    var theme: QuickTheme
    @AppStorage("clusterTripStart") private var tripStart: Double = 0
    @State private var pick: String?
    @State private var readAt = Date()
    @State private var hold = ClusterReadings.TachHold()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var caption: String { L.t("Last \(model.period.label)", "최근 \(model.period.label)") }
    private var reportKey: Double { model.devices.map(\.received).max() ?? 0 }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let now = DemoData.onScreen && DemoData.held != nil ? DemoData.shownNow() : timeline.date.timeIntervalSince1970
            let r = ClusterReadings(model: model, now: now, pick: pick, trip: tripStart > 0 ? tripStart : nil, hold: hold)
            VStack(spacing: 14) {
                speedometer(r).frame(width: 300, height: 300)
                tachometer(r).frame(width: 300, height: 300)
                lamps(r, now: now)
                VStack(alignment: .leading, spacing: 12) {
                    odometer(r, now: timeline.date)
                    trip(r, now: now, date: timeline.date)
                    fuel(r)
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 20)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 32))
            .overlay(RoundedRectangle(cornerRadius: 32).stroke(theme.line))
            .onAppear { if tripStart <= 0 { tripStart = floor(now) } }
        }
        .onChange(of: reportKey) { readAt = Date() }
        .accessibilityElement(children: .contain).accessibilityLabel(L.t("Cluster", "계기판"))
        .accessibilityIdentifier("cluster")
    }

    // MARK: Warning lights: a light comes on for what is there; pressing an account's light picks that account
    private static let lamps: [(key: String, en: String, ko: String, icon: String)] = [
        ("waiting", "Needs attention", "확인 필요", "exclamationmark.triangle"), ("reconnect", "Reconnect needed", "재연결 필요", "link"),
        ("empty", "Limit runs out early", "한도 바닥 예상", "fuelpump"), ("context", "Context nearly full", "컨텍스트 거의 참", "doc.plaintext"),
        ("stalled", "Possibly stalled", "멈춤 의심", "hourglass"), ("live", "Collection delayed", "수집 지연", "dot.radiowaves.left.and.right")]
    private func ids(_ r: ClusterReadings, _ key: String) -> [String] {
        switch key {
        case "waiting": r.tells.waiting
        case "reconnect": r.tells.reconnect
        case "empty": r.tells.empty
        case "context": r.tells.context
        case "stalled": r.tells.stalled
        default: []
        }
    }
    /// The warning lights, centred as in the menu bar and tray panels.
    private func lamps(_ r: ClusterReadings, now: Double) -> some View {
        HStack(spacing: 2) {
            ForEach(Self.lamps, id: \.key) { lamp in lampButton(r, lamp, now: now) }
        }
        .padding(.horizontal, 8).frame(height: 36)
        .background(theme.background.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line))
        .accessibilityElement(children: .contain).accessibilityLabel(L.t("Warning lights", "경고등"))
    }
    private func lampButton(_ r: ClusterReadings, _ lamp: (key: String, en: String, ko: String, icon: String), now: Double) -> some View {
        let live = lamp.key == "live", list = ids(r, lamp.key), lit = live || !list.isEmpty
        let color = live ? (r.tells.fresh ? theme.segmentOn : theme.red) : lamp.key == "empty" ? theme.red : theme.amber
        let name = live ? (r.tells.fresh ? L.t("Live", "실시간") : L.t(lamp.en, lamp.ko)) : L.t(lamp.en, lamp.ko)
        let blink = !reduceMotion && ((lamp.key == "waiting" && lit) || (live && !r.tells.fresh)) && Int(now) % 2 == 1
        return Button {
            // An account's light picks the next account it lights for on the speedometer.
            guard ["reconnect", "empty"].contains(lamp.key), !list.isEmpty else { return }
            let at = pick.flatMap { list.firstIndex(of: $0) } ?? -1
            pick = list[(at + 1) % list.count]
        } label: {
            Image(systemName: lamp.icon).font(.system(size: 14, weight: .semibold))
                .foregroundStyle(lit ? color : theme.muted.opacity(0.32))
                .shadow(color: lit ? color.opacity(0.55) : .clear, radius: 4)
                .opacity(blink ? 0.4 : 1).animation(.easeInOut(duration: 0.6), value: blink)
                .frame(width: 30, height: 30).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name + (live ? "" : " \(list.count)"))
        .accessibilityIdentifier("cluster-lamp-\(lamp.key)")
    }

    // MARK: Dials
    private func rate(_ v: Double) -> String { ClusterReadings.number(v) + L.t("%/h", "%/시간") }
    /// The needles shimmer while any session works, as a running engine's do.
    private func running(_ r: ClusterReadings) -> Bool { !reduceMotion && !r.tells.kinds.isEmpty }
    private func speedometer(_ r: ClusterReadings) -> some View {
        let s = r.speed, scale = ClusterReadings.marks(s.max), color = s.kind.map(Tool.color) ?? theme.dim
        let f = { (v: Double) in min(1, max(0, v / s.max)) }
        var bands: [ClusterBand] = []
        if let c = s.cruise {
            bands = [.init(from: 0, to: f(c), color: theme.accent), .init(from: f(c), to: f(c * 1.5), color: theme.amber),
                     .init(from: f(c * 1.5), to: 1, color: theme.red)].filter { $0.to > $0.from }
        }
        let over = s.cruise != nil && s.live != nil && s.live! > s.cruise!
        var aux: [ClusterAux] = []
        if let c = s.cruise { aux.append(.init(label: L.t("Cruise", "적정"), value: rate(c), color: over ? theme.amber : theme.accent)) }
        if let v = s.value, s.live != v { aux.append(.init(label: caption + " " + L.t("average", "평균"), value: rate(v), color: nil)) }
        let account = r.accounts.first { $0.id == s.account }
        return ClusterDial(scale: scale, fraction: f(s.live ?? 0), color: color, bands: bands,
                           name: L.t("Burn rate", "소진 속도"), reading: ClusterReadings.reading(s.live),
                           unit: L.t("%/h of the weekly limit", "%/시간 · 주간 한도 기준"), aux: aux, lead: false,
                           shimmer: running(r), phase: 1.7, theme: theme, reduceMotion: reduceMotion) {
            HStack(spacing: 4) {
                if let kind = s.kind {
                    Circle().fill(color).frame(width: 6, height: 6)
                    Text(Tool.name(kind)).fontWeight(.semibold).foregroundStyle(theme.ink)
                    if let tag = account?.tag { Text(tag).foregroundStyle(theme.ink) }
                    if let plan = account?.plan { Text("· " + plan) }
                    if !s.picked { Text(L.t("Fastest", "가장 빠름")).foregroundStyle(theme.dim) }
                } else {
                    Text(L.t("Measuring account burn", "계정 소진 속도 측정 중"))
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(L.t("Burn rate", "소진 속도")) \(ClusterReadings.reading(s.live))%/h")
        .accessibilityIdentifier("cluster-speedometer")
    }
    private func tachometer(_ r: ClusterReadings) -> some View {
        // Tokens per minute, like rpm; the scale and the figure share one unit (k or M) so they agree.
        let t = r.tach, div = t.tpmMax >= 1e6 ? 1e6 : 1e3, unit = (div == 1e6 ? "M" : "k") + " tpm"
        let scale = ClusterReadings.marks(t.tpmMax / div), v = t.now.map { $0 / 60 / div }
        let shown = v.map { String(format: $0 < 10 ? "%.2f" : $0 < 100 ? "%.1f" : "%.0f", $0) } ?? "—"
        let minute = L.t("Last 1 min", "최근 1분"), average = caption + " " + L.t("average", "평균")
        let aux: [ClusterAux] = t.live && t.rate != nil ? [.init(label: average, value: ClusterReadings.tokens(t.rate! / 60) + " tpm", color: nil)] : []
        return ClusterDial(scale: scale, fraction: min(1, max(0, (t.now ?? 0) / 60 / t.tpmMax)), color: theme.segmentOn, bands: [],
                           name: L.t("Token speed", "토큰 속도"), reading: shown, unit: unit, aux: aux, lead: true,
                           shimmer: running(r), phase: 0, theme: theme, reduceMotion: reduceMotion) { Text(t.live ? minute : average) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(L.t("Token speed", "토큰 속도")) \(shown) \(unit) · \(t.live ? minute : caption)")
    }

    // MARK: Odometer and trip
    /// Between readings the odometer and the trip run on at the last minute's rate, for at most 30 seconds.
    private func elapsed(_ date: Date) -> Double { reduceMotion ? 0 : min(30, max(0, date.timeIntervalSince(readAt))) }
    private func odometer(_ r: ClusterReadings, now date: Date) -> some View {
        let total = (r.tach.tokens ?? 0) + r.tach.climb * elapsed(date)
        return VStack(alignment: .leading, spacing: 6) {
            Text(L.t("Tokens", "토큰") + " · " + caption).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(theme.muted)
            ClusterOdometer(value: total, theme: theme, animate: !reduceMotion)
        }
    }
    private func trip(_ r: ClusterReadings, now: Double, date: Date) -> some View {
        let add = r.tach.instant.map { $0 / ClusterReadings.hour * elapsed(date) } ?? 0
        let tokens = r.trip?.tokens.map { $0 + add }, hours = r.trip.map { (now - $0.start) / ClusterReadings.hour } ?? 0
        let since = r.trip.map { start -> String in
            let f = DateFormatter(); f.dateFormat = L.language == .ko ? "M. d. HH:mm" : L.language == .zh ? "M/d HH:mm" : "M/d, HH:mm"
            return f.string(from: Date(timeIntervalSince1970: start.start))
        } ?? ""
        let legs: [(id: String, kind: String, name: String, used: Double?)] = (r.trip?.accounts ?? []).compactMap { leg in
            r.accounts.first { $0.id == leg.id }.map { a in (a.id, a.kind, a.plan ?? a.tag ?? Tool.name(a.kind), leg.used) }
        }
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(L.t("Work trip", "작업 트립")).font(.system(size: 12.5, weight: .semibold))
                Text(L.language == .ko ? "\(since) 부터" : L.language == .zh ? "\(since) 起" : "since \(since)")
                    .font(.system(size: 11.5)).foregroundStyle(theme.muted).lineLimit(1)
                Button { tripStart = floor(now) } label: {
                    Text(L.t("Reset", "리셋")).font(.system(size: 11.5, weight: .semibold)).padding(.horizontal, 8).frame(height: 22)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(theme.line)).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(L.t("Reset the work trip", "작업 트립 리셋"))
            }
            if r.trip?.inRange == false {
                Text(L.t("Outside the record", "기록 범위 밖")).font(.system(size: 11.5)).foregroundStyle(theme.dim)
            } else {
                HStack(spacing: 3) {
                    Text(ClusterReadings.tokens(tokens)).fontWeight(.semibold).foregroundStyle(theme.ink)
                    Text(L.t("Tokens", "토큰") + " · " + L.t("Average", "평균"))
                    Text(ClusterReadings.tokens(tokens.flatMap { hours > 0 ? $0 / hours : nil })).fontWeight(.semibold).foregroundStyle(theme.ink)
                    Text(L.t("tokens/h", "tokens/시간"))
                }.font(.system(size: 11.5)).foregroundStyle(theme.muted).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                ClusterFlow(spacing: 10, lineSpacing: 3, trailing: false) {
                    ForEach(legs, id: \.id) { leg in
                        HStack(spacing: 4) {
                            Circle().fill(Tool.color(leg.kind)).frame(width: 6, height: 6)
                            Text(leg.name).foregroundStyle(theme.muted)
                            Text(leg.used.map { "+" + ClusterReadings.number($0) + "%" } ?? "—").fontWeight(.bold).foregroundStyle(theme.ink)
                        }.font(.system(size: 11.5, weight: .semibold)).monospacedDigit().lineLimit(1)
                    }
                }
            }
        }
    }

    // MARK: Fuel: what is left of each account's weekly limit
    private func fuel(_ r: ClusterReadings) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L.t("Weekly limit left", "남은 주간 한도")).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(theme.muted)
            if r.accounts.isEmpty {
                Text(L.t("No subscription accounts connected.", "연결된 구독 계정이 없습니다.")).font(.system(size: 11.5)).foregroundStyle(theme.dim)
            } else {
                HStack(alignment: .bottom, spacing: 14) {
                    ForEach(r.accounts) { a in can(a, on: r.speed.picked && r.speed.account == a.id) }
                }
            }
        }
    }
    private func can(_ a: ClusterReadings.Account, on: Bool) -> some View {
        let color = Tool.color(a.kind), low = (a.left ?? 100) < 15, name = a.plan ?? a.tag ?? Tool.name(a.kind)
        let state = a.reconnect ? L.t("Reconnect needed", "재연결 필요") : a.left == nil ? L.t("Awaiting report", "보고 대기")
            : ClusterReadings.number(a.left) + "% " + L.t("remaining", "남음")
        return Button { pick = pick == a.id ? nil : a.id } label: {
            VStack(spacing: 5) {
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: 4).fill(theme.ink.opacity(0.09))
                    RoundedRectangle(cornerRadius: 4).fill(low ? theme.amber : color).opacity(a.current ? 1 : 0.45)
                        .frame(height: 40 * CGFloat((a.left ?? 0) / 100))
                        .animation(reduceMotion ? nil : .easeOut(duration: 1), value: a.left)
                }
                .frame(width: 16, height: 40).clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(on ? color : a.reconnect ? theme.amber : .clear, lineWidth: on ? 1.5 : 1))
                .shadow(color: on ? color.opacity(0.6) : .clear, radius: 5)
                Text(name).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(on ? theme.ink : theme.muted).lineLimit(1)
            }.frame(minWidth: 30).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(Tool.name(a.kind))\(a.tag.map { " " + $0 } ?? "")\(a.plan.map { " · " + $0 } ?? ""), \(state)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

struct ClusterBand { var from: Double; var to: Double; var color: Color }
struct ClusterAux { var label: String; var value: String; var color: Color? }

/// One round dial of the cluster on a 340-unit face, as cluster.js draws it: a rim, the 270° track, the lit
/// arc and ticks up to the reading, the scale numbers, cruise bands outside and the needle, then the name, the
/// reading and its notes, and a chip at the bottom. Both dials draw at one size.
struct ClusterDial<Chip: View>: View {
    var scale: ClusterReadings.Scale
    var fraction: Double
    var color: Color
    var bands: [ClusterBand]
    var name: String
    var reading: String
    var unit: String
    var aux: [ClusterAux]
    /// The reading in the segment display's colour (the tachometer) rather than ink.
    var lead: Bool
    /// While sessions work the needle shimmers about its reading; phase keeps two dials from moving together.
    var shimmer: Bool
    var phase: Double
    var theme: QuickTheme
    var reduceMotion: Bool
    @ViewBuilder var chip: () -> Chip

    private var spring: Animation? { reduceMotion ? nil : .spring(response: 0.9, dampingFraction: 0.58) }
    private static func angle(_ f: Double) -> Double { 135 + 270 * min(1, max(0, f)) }
    /// A few degrees either way on uneven periods, so it never settles into a visible rhythm.
    private static func wobble(_ t: Double) -> Double { 1.6 * sin(t * 2.7) + 1.0 * sin(t * 6.1 + 1.3) + 0.6 * sin(t * 11.3 + 0.4) }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height), k = side / 340
            ZStack {
                Circle().fill(RadialGradient(colors: [theme.light ? .white : theme.raised, theme.light ? theme.raised : theme.background],
                                             center: UnitPoint(x: 0.5, y: 0.42), startRadius: 0, endRadius: side * 0.55))
                Circle().stroke(theme.line, lineWidth: 2 * k).frame(width: 320 * k, height: 320 * k)
                ClusterArc(from: 0, to: 1, radius: 147 * k).stroke(theme.ink.opacity(0.07), lineWidth: 5 * k)
                ForEach(Array(bands.enumerated()), id: \.offset) { _, band in
                    ClusterArc(from: band.from, to: band.to, radius: 155 * k).stroke(band.color.opacity(0.8), lineWidth: 4 * k)
                }
                Circle().trim(from: 0, to: 0.75 * min(1, max(0, fraction))).rotation(.degrees(135))
                    .stroke(color, style: StrokeStyle(lineWidth: 5 * k, lineCap: .round)).frame(width: 294 * k, height: 294 * k)
                    .shadow(color: color.opacity(0.4), radius: 5 * k).animation(spring, value: fraction)
                Canvas { ctx, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2), n = Int((scale.max / scale.minor).rounded())
                    for i in 0...max(0, n) {
                        let v = Double(i) * scale.minor, f = v / scale.max, a = Self.angle(f) * .pi / 180
                        let major = abs(v / scale.major - (v / scale.major).rounded()) < 1e-6
                        var line = Path()
                        line.move(to: CGPoint(x: c.x + cos(a) * (major ? 122 : 131) * k, y: c.y + sin(a) * (major ? 122 : 131) * k))
                        line.addLine(to: CGPoint(x: c.x + cos(a) * 141 * k, y: c.y + sin(a) * 141 * k))
                        let on = f <= fraction + 1e-4 && fraction > 0
                        ctx.stroke(line, with: .color(on ? color : theme.muted.opacity(0.55)), style: StrokeStyle(lineWidth: (major ? 3.2 : 1.6) * k, lineCap: .round))
                        if major {
                            ctx.draw(Text(ClusterReadings.scaleNumber(v)).font(.system(size: max(9, 17 * k), weight: .semibold)).foregroundStyle(theme.muted),
                                     at: CGPoint(x: c.x + cos(a) * 103 * k, y: c.y + sin(a) * 103 * k))
                        }
                    }
                }
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !shimmer)) { tl in
                    ClusterNeedle(thin: false).fill(color).shadow(color: .black.opacity(0.6), radius: 6 * k)
                        .rotationEffect(.degrees(Self.angle(fraction))).animation(spring, value: fraction)
                        .rotationEffect(.degrees(shimmer ? Self.wobble(tl.date.timeIntervalSinceReferenceDate + phase) : 0))
                }
                Circle().fill(theme.raised).overlay(Circle().stroke(theme.line, lineWidth: 1.5 * k)).frame(width: 26 * k, height: 26 * k)
                Circle().fill(theme.background).frame(width: 10 * k, height: 10 * k)
                Text(name).font(.system(size: max(10, side * 0.042), weight: .semibold)).kerning(0.6)
                    .foregroundStyle(theme.muted).lineLimit(1).position(x: side / 2, y: side * 0.34)
                VStack(spacing: 2 * k) {
                    Text(reading).font(.system(size: side * 0.15, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(lead ? theme.segmentLead : theme.ink).contentTransition(.numericText()).lineLimit(1).fixedSize()
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.7), value: reading)
                    Text(unit).font(.system(size: max(9, side * 0.042))).foregroundStyle(theme.muted).lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: side * 0.62)
                    ForEach(Array(aux.enumerated()), id: \.offset) { _, a in
                        // One text per line, so a long note shrinks as a whole between the scale's end numbers.
                        Text("\(a.label) \(Text(a.value).fontWeight(.bold).foregroundColor(a.color ?? theme.ink))")
                            .font(.system(size: max(9, side * 0.04), weight: .semibold)).monospacedDigit()
                            .foregroundStyle(a.color ?? theme.muted).lineLimit(1).minimumScaleFactor(0.5)
                            .frame(maxWidth: side * 0.62)
                    }
                }
                // The notes stay between the scale's 0 and its full-scale number.
                .position(x: side / 2, y: side * 0.62)
                chip().font(.system(size: max(9, side * 0.04))).foregroundStyle(theme.muted).lineLimit(1)
                    .padding(.horizontal, 8 * k).padding(.vertical, 3 * k)
                    .background(theme.card.opacity(0.85), in: Capsule()).overlay(Capsule().stroke(theme.line))
                    .frame(maxWidth: side * 0.8).fixedSize(horizontal: false, vertical: true)
                    .position(x: side / 2, y: side * 0.86)
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// A stretch of the dial's 270° sweep, as fractions of full scale.
struct ClusterArc: Shape {
    var from: Double; var to: Double; var radius: CGFloat
    var animatableData: AnimatablePair<Double, Double> {
        get { AnimatablePair(from, to) }
        set { from = newValue.first; to = newValue.second }
    }
    func path(in rect: CGRect) -> Path {
        Path { p in
            p.addArc(center: CGPoint(x: rect.midX, y: rect.midY), radius: radius, startAngle: .degrees(135 + 270 * from),
                     endAngle: .degrees(135 + 270 * to), clockwise: false)
        }
    }
}

/// A needle pointing right from the centre of a 340-unit face; rotation turns it to the reading.
struct ClusterNeedle: Shape {
    var thin: Bool
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height), k = side / 340, c = CGPoint(x: rect.midX, y: rect.midY)
        func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: c.x + (x - 170) * k, y: c.y + (y - 170) * k) }
        return Path { p in
            if thin {
                p.addLines([at(170, 168.9), at(292, 169.6), at(292, 170.4), at(170, 171.1)]); p.closeSubpath()
                p.addEllipse(in: CGRect(x: c.x + 119 * k, y: c.y - 3 * k, width: 6 * k, height: 6 * k))
            } else {
                p.addLines([at(158, 166.4), at(301, 169.3), at(301, 170.7), at(158, 173.6)]); p.closeSubpath()
            }
        }
    }
}

/// The odometer: ten digit wheels rolling to the count, the unused leading places dimmed.
struct ClusterOdometer: View {
    var value: Double
    var theme: QuickTheme
    var animate: Bool
    var body: some View {
        let total = max(0, min(9_999_999_999, value.rounded())), text = String(format: "%010.0f", total)
        let lead = 10 - String(format: "%.0f", total).count, h: CGFloat = 26
        HStack(spacing: 0) {
            ForEach(Array(text.enumerated()), id: \.offset) { k, ch in
                if k > 0 && (10 - k) % 3 == 0 {
                    Text(",").font(.system(size: 17, weight: .semibold)).foregroundStyle(theme.muted.opacity(k <= lead ? 0.4 : 0.8))
                }
                let digit = Int(String(ch)) ?? 0
                VStack(spacing: 0) {
                    ForEach(0..<10, id: \.self) { d in
                        Text("\(d)").font(.system(size: 20, weight: .semibold)).monospacedDigit().frame(height: h)
                    }
                }
                .offset(y: -CGFloat(digit) * h + 4.5 * h)
                .animation(animate ? .spring(response: 0.6, dampingFraction: 0.8) : nil, value: digit)
                .frame(width: 13, height: h).clipped()
                .foregroundStyle(k < lead ? theme.muted.opacity(0.45) : theme.ink)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(theme.background, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line))
        .accessibilityElement(children: .ignore).accessibilityLabel("\(Int(total)) tokens")
    }
}

/// Lines of items that wrap (the trip's account legs).
struct ClusterFlow: Layout {
    var spacing: CGFloat; var lineSpacing: CGFloat; var trailing = true
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = lines(proposal.width ?? .infinity, subviews)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in lines(bounds.width, subviews) {
            var x = trailing ? bounds.maxX - row.width : bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: .unspecified)
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }
    private func lines(_ width: CGFloat, _ subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
        for (i, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            if let last = rows.last, last.width + spacing + size.width <= width {
                rows[rows.count - 1].items.append(i); rows[rows.count - 1].width += spacing + size.width
                rows[rows.count - 1].height = max(last.height, size.height)
            } else { rows.append(([i], size.width, size.height)) }
        }
        return rows
    }
}
