import SwiftUI

// The dashboard's cluster (계기판) in the menu bar panel, laid out as the Windows tray panel lays it out
// (agent/onetop/dist/quick.js): the burn speedometer and the token tachometer side by side, the warning
// lights, the odometer with the trip, and each account's weekly limit left as fuel. The readings are
// ClusterReadings, the numbers the dashboard's cluster shows. Needles spring to each reading and the odometer
// and trip run on each second at the last minute's rate until the next reading; with Reduce Motion they
// change only with the readings.
struct QuickCluster: View {
    @ObservedObject var model: DashboardModel
    var theme: QuickTheme
    var m: QuickMetrics
    var tr: QuickText
    /// "최근 1시간": the period the panel's picker chose.
    var caption: String
    @AppStorage("clusterTripStart") private var tripStart: Double = 0
    @State private var pick: String?
    @State private var readAt = Date()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var now: Double { model.now.timeIntervalSince1970 }
    private var readings: ClusterReadings {
        ClusterReadings(snapshot: model.snapshot, sessions: model.sessions, period: model.selectedPeriod, now: now,
                        pick: pick, trip: tripStart > 0 ? tripStart : nil)
    }

    var body: some View {
        let r = readings
        VStack(spacing: m(10)) {
            HStack(alignment: .center, spacing: m(16)) {
                speedometer(r).frame(width: m(206), height: m(206))
                tachometer(r).frame(width: m(158), height: m(158))
            }
            lamps(r)
            HStack(alignment: .top, spacing: m(10)) {
                odometer(r)
                Spacer(minLength: 0)
                trip(r)
            }
            fuel(r).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, m(16)).padding(.top, m(14)).padding(.bottom, m(16))
        .background(theme.card, in: RoundedRectangle(cornerRadius: m(28)))
        .overlay(RoundedRectangle(cornerRadius: m(28)).stroke(theme.line))
        .onAppear { if tripStart <= 0 { tripStart = floor(now) } }
        .onChange(of: model.snapshot?.updated) { _ in readAt = Date() }
        .accessibilityElement(children: .contain).accessibilityLabel(tr("계기판"))
    }

    // MARK: Warning lights: a light comes on for what is there; pressing an account's light picks that account
    private static let lamps: [(key: String, name: String, icon: String)] = [
        ("waiting", "확인 필요", "exclamationmark.triangle"), ("reconnect", "재연결 필요", "link"),
        ("empty", "한도 바닥 예상", "fuelpump"), ("context", "컨텍스트 거의 참", "doc.plaintext"),
        ("stalled", "멈춤 의심", "hourglass"), ("live", "수집 지연", "dot.radiowaves.left.and.right")]
    private func lampIDs(_ r: ClusterReadings, _ key: String) -> [String] {
        switch key {
        case "waiting": r.tells.waiting
        case "reconnect": r.tells.reconnect
        case "empty": r.tells.empty
        case "context": r.tells.context
        case "stalled": r.tells.stalled
        default: []
        }
    }
    private func lamps(_ r: ClusterReadings) -> some View {
        HStack(spacing: m(2)) {
            ForEach(Self.lamps, id: \.key) { lamp in lampButton(r, lamp) }
        }
        .padding(.horizontal, m(8)).frame(height: m(32))
        .background(theme.background.opacity(0.6), in: RoundedRectangle(cornerRadius: m(12)))
        .overlay(RoundedRectangle(cornerRadius: m(12)).stroke(theme.line))
        .accessibilityElement(children: .contain).accessibilityLabel(tr("경고등"))
    }
    private func lampButton(_ r: ClusterReadings, _ lamp: (key: String, name: String, icon: String)) -> some View {
        let live = lamp.key == "live", ids = lampIDs(r, lamp.key), lit = live || !ids.isEmpty
        let color = live ? (r.tells.fresh ? theme.segmentOn : theme.red) : lamp.key == "empty" ? theme.red : theme.amber
        let name = live ? (r.tells.fresh ? "실시간" : "수집 지연") : lamp.name
        let blink = !reduceMotion && ((lamp.key == "waiting" && lit) || (live && !r.tells.fresh)) && Int(now) % 2 == 1
        let label = tr(name) + (live ? "" : " \(ids.count)")
        return Button {
            // An account light picks the next account it lights for on the speedometer.
            guard ["reconnect", "empty"].contains(lamp.key), !ids.isEmpty else { return }
            let at = pick.flatMap { ids.firstIndex(of: $0) } ?? -1
            pick = ids[(at + 1) % ids.count]
        } label: {
            Image(systemName: lamp.icon).font(.system(size: m(14), weight: .semibold))
                .foregroundStyle(lit ? color : theme.muted.opacity(0.32))
                .shadow(color: lit ? color.opacity(0.55) : .clear, radius: m(4))
                .opacity(blink ? 0.4 : 1).animation(.easeInOut(duration: 0.6), value: blink)
                .frame(width: m(30), height: m(28)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).help(label).accessibilityLabel(label)
    }

    // MARK: Dials
    private func speedometer(_ r: ClusterReadings) -> some View {
        let s = r.speed, scale = ClusterReadings.marks(s.max), color = s.kind.map(AgentPalette.color) ?? theme.dim
        let f = { (v: Double) in min(1, max(0, v / s.max)) }
        var bands: [ClusterBand] = []
        if let c = s.cruise {
            bands = [.init(from: 0, to: f(c), color: theme.accent), .init(from: f(c), to: f(c * 1.5), color: theme.amber),
                     .init(from: f(c * 1.5), to: 1, color: theme.red)].filter { $0.to > $0.from }
        }
        let over = s.cruise != nil && s.value != nil && s.value! > s.cruise!
        var aux: [ClusterAux] = []
        if let c = s.cruise { aux.append(.init(label: tr("적정"), value: rate(c), color: over ? theme.amber : theme.accent)) }
        if let recent = s.recent { aux.append(.init(label: tr("최근 10분"), value: rate(recent), color: nil)) }
        let account = r.accounts.first { $0.id == s.account }
        return ClusterDial(scale: scale, fraction: f(s.value ?? 0), second: s.recent.map(f), color: color, bands: bands,
                           name: tr("소진 속도"), reading: ClusterReadings.reading(s.value), unit: tr("%/시간 · 주간 한도 기준"), aux: aux,
                           big: true, theme: theme, m: m, reduceMotion: reduceMotion) {
            HStack(spacing: m(4)) {
                if let kind = s.kind {
                    Circle().fill(color).frame(width: m(6), height: m(6))
                    Text(clusterToolName(kind)).fontWeight(.semibold).foregroundStyle(theme.ink)
                    if let tag = account.flatMap(accountTag) { Text(tag).foregroundStyle(theme.ink) }
                    if let plan = account?.plan { Text("· " + plan) }
                    if !s.picked { Text(tr("가장 빠름")).foregroundStyle(theme.dim) }
                } else {
                    Text(tr("계정 소진 속도 측정 중"))
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(tr("소진 속도")) \(ClusterReadings.reading(s.value))%/h")
    }
    private func tachometer(_ r: ClusterReadings) -> some View {
        let t = r.tach, scale = ClusterReadings.marks(t.max / 1e6), f = { (v: Double) in min(1, max(0, v / t.max)) }
        let shown = DesktopFormat.number(t.rate), unit = shown.last.flatMap { "kMBT".contains($0) ? String($0) : nil }
        let digits = unit == nil ? shown : String(shown.dropLast())
        let aux: [ClusterAux] = t.instant.map { [.init(label: tr("최근 1분"), value: DesktopFormat.number($0), color: nil)] } ?? []
        return ClusterDial(scale: scale, fraction: f(t.rate ?? 0), second: t.instant.map(f), color: theme.segmentOn, bands: [],
                           name: tr("토큰 속도"), reading: digits, unit: (unit.map { $0 + " " } ?? "") + "tokens" + tr.perHour, aux: aux,
                           big: false, theme: theme, m: m, reduceMotion: reduceMotion) { Text(caption + " " + tr("평균")) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(tr("토큰 속도")) \(shown) tokens\(tr.perHour) · \(caption)")
    }
    private func rate(_ v: Double) -> String { ClusterReadings.number(v) + "%" + tr.perHour }
    /// What tells same-tool accounts apart: the name given in the desktop app, else 1, 2… once a tool has two.
    private func accountTag(_ a: ClusterReadings.Account) -> String? {
        if let alias = a.alias?.trimmingCharacters(in: .whitespaces), !alias.isEmpty { return alias }
        let quotas = model.snapshot?.account_quotas ?? []
        let same = quotas.filter { $0.kind == a.kind }.sorted { $0.account_label.lowercased() < $1.account_label.lowercased() }
        guard same.count >= 2, let index = same.firstIndex(where: { $0.id == a.id }) else { return nil }
        return String(index + 1)
    }

    // MARK: Odometer and trip
    /// Between readings the odometer and the trip run on at the last minute's rate, for at most 30 seconds.
    private func elapsed(_ r: ClusterReadings) -> Double { reduceMotion ? 0 : min(30, max(0, model.now.timeIntervalSince(readAt))) }
    private func odometer(_ r: ClusterReadings) -> some View {
        let total = (r.tach.tokens ?? 0) + r.tach.climb * elapsed(r)
        return VStack(alignment: .leading, spacing: m(8)) {
            Text(tr("토큰") + " · " + caption).font(m.font(.caption, .semibold)).foregroundStyle(theme.muted).padding(.top, m(18))
            ClusterOdometer(value: total, theme: theme, m: m, animate: !reduceMotion)
        }
    }
    /// The trip since its last reset: tokens, their average speed and each account's weekly percent added.
    private func trip(_ r: ClusterReadings) -> some View {
        let add = r.tach.instant.map { $0 / ClusterReadings.hour * elapsed(r) } ?? 0
        let tokens = r.trip?.tokens.map { $0 + add }, hours = r.trip.map { (now - $0.start) / ClusterReadings.hour } ?? 0
        // As the dashboard writes it: "1. 15. 00:00", "1/15, 00:00", "1/15 00:00".
        let since = r.trip.map { start -> String in
            let f = DateFormatter(); f.dateFormat = tr.pick("M. d. HH:mm", "M/d, HH:mm", "M/d HH:mm")
            return f.string(from: Date(timeIntervalSince1970: start.start))
        } ?? ""
        let legs: [(id: String, kind: String, name: String, used: Double?)] = (r.trip?.accounts ?? []).compactMap { leg in
            r.accounts.first { $0.id == leg.id }.map { a in (a.id, a.kind, a.plan ?? accountTag(a) ?? clusterToolName(a.kind), leg.used) }
        }
        return VStack(alignment: .trailing, spacing: m(4)) {
            HStack(spacing: m(6)) {
                Text(tr("작업 트립")).font(m.font(.label, .semibold))
                Text(tr.pick("\(since) 부터", "since \(since)", "\(since) 起")).font(m.font(.caption)).foregroundStyle(theme.muted).lineLimit(1)
                Button { tripStart = floor(now) } label: {
                    Text(tr("리셋")).font(m.font(.caption, .semibold)).padding(.horizontal, m(7)).frame(height: m(20))
                        .overlay(RoundedRectangle(cornerRadius: m(6)).stroke(theme.line)).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(tr("작업 트립 리셋"))
            }
            if r.trip?.inRange == false {
                Text(tr("기록 범위 밖")).font(m.font(.caption)).foregroundStyle(theme.dim)
            } else {
                HStack(spacing: m(3)) {
                    Text(DesktopFormat.number(tokens)).fontWeight(.semibold).foregroundStyle(theme.ink)
                    Text(tr("토큰") + " · " + tr("평균"))
                    Text(DesktopFormat.number(tokens.flatMap { hours > 0 ? $0 / hours : nil })).fontWeight(.semibold).foregroundStyle(theme.ink)
                    Text("tokens" + tr.perHour)
                }.font(m.font(.caption)).foregroundStyle(theme.muted).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                // Each account's weekly percent since the start, wrapping right-aligned.
                ClusterFlow(spacing: m(10), lineSpacing: m(3)) {
                    ForEach(legs, id: \.id) { leg in
                        HStack(spacing: m(4)) {
                            Circle().fill(AgentPalette.color(leg.kind)).frame(width: m(6), height: m(6))
                            Text(leg.name).foregroundStyle(theme.muted)
                            Text(leg.used.map { "+" + ClusterReadings.number($0) + "%" } ?? "—").fontWeight(.bold).foregroundStyle(theme.ink)
                        }.font(m.font(.caption, .semibold)).monospacedDigit().lineLimit(1)
                    }
                }.frame(maxWidth: m(220), alignment: .trailing)
            }
        }
    }

    // MARK: Fuel: what is left of each account's weekly limit
    private func fuel(_ r: ClusterReadings) -> some View {
        HStack(alignment: .center, spacing: m(14)) {
            Text(tr("남은 주간 한도")).font(m.font(.caption, .semibold)).foregroundStyle(theme.muted)
            if r.accounts.isEmpty {
                Text(tr("연결된 구독 계정이 없습니다.")).font(m.font(.caption)).foregroundStyle(theme.dim)
            } else {
                HStack(alignment: .bottom, spacing: m(12)) {
                    ForEach(r.accounts) { a in can(a, on: r.speed.picked && r.speed.account == a.id) }
                }
            }
        }
    }
    private func can(_ a: ClusterReadings.Account, on: Bool) -> some View {
        let color = AgentPalette.color(a.kind), low = (a.left ?? 100) < 15
        let name = a.plan ?? accountTag(a) ?? clusterToolName(a.kind)
        let state = a.reconnect ? tr("재연결 필요") : a.left == nil ? tr("보고 대기") : ClusterReadings.number(a.left) + "% " + tr("남음")
        let help = [clusterToolName(a.kind) + (accountTag(a).map { " " + $0 } ?? "") + (a.plan.map { " · " + $0 } ?? ""), state,
                    tr("평균") + " " + (a.burn.map(rate) ?? "—")].joined(separator: "\n")
        return Button { pick = pick == a.id ? nil : a.id } label: {
            VStack(spacing: m(4)) {
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: m(4)).fill(theme.ink.opacity(0.09))
                    RoundedRectangle(cornerRadius: m(4)).fill(low ? theme.amber : color).opacity(a.current ? 1 : 0.45)
                        .frame(height: m(30) * CGFloat((a.left ?? 0) / 100))
                        .animation(reduceMotion ? nil : .easeOut(duration: 1), value: a.left)
                }
                .frame(width: m(15), height: m(30)).clipShape(RoundedRectangle(cornerRadius: m(4)))
                .overlay(RoundedRectangle(cornerRadius: m(4)).stroke(on ? color : a.reconnect ? theme.amber : .clear, lineWidth: on ? 1.5 : 1))
                .shadow(color: on ? color.opacity(0.6) : .clear, radius: m(5))
                Text(name).font(m.font(.tiny, .semibold)).foregroundStyle(on ? theme.ink : theme.muted).lineLimit(1)
            }.frame(minWidth: m(28)).contentShape(Rectangle())
        }
        .buttonStyle(.plain).help(help).accessibilityLabel(help.replacingOccurrences(of: "\n", with: ", "))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

func clusterToolName(_ kind: String) -> String {
    kind == "Claude" ? "Claude Code" : kind == "Antigravity" ? "Agy CLI" : kind
}

/// One round dial of the cluster on a 340-unit face, as cluster.js draws it: a rim, the 270° track, the lit
/// arc and ticks up to the reading, the scale numbers, cruise bands outside, a thin second needle and the main
/// needle, then the name, the reading and its notes, and an optional chip at the bottom.
struct ClusterBand { var from: Double; var to: Double; var color: Color }
struct ClusterAux { var label: String; var value: String; var color: Color? }
struct ClusterDial<Chip: View>: View {
    var scale: ClusterReadings.Scale
    var fraction: Double
    var second: Double?
    var color: Color
    var bands: [ClusterBand]
    var name: String
    var reading: String
    var unit: String
    var aux: [ClusterAux]
    var big: Bool
    var theme: QuickTheme
    var m: QuickMetrics
    var reduceMotion: Bool
    @ViewBuilder var chip: () -> Chip

    private var spring: Animation? { reduceMotion ? nil : .spring(response: 0.9, dampingFraction: 0.58) }
    private static func angle(_ f: Double) -> Double { 135 + 270 * min(1, max(0, f)) }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height), k = side / 340
            ZStack {
                Circle().fill(RadialGradient(colors: [theme.light ? .white : theme.raised, theme.light ? theme.raised : theme.background],
                                             center: UnitPoint(x: 0.5, y: 0.42), startRadius: 0, endRadius: side * 0.55))
                Circle().stroke(theme.line, lineWidth: 2 * k).frame(width: 320 * k, height: 320 * k)
                arc(0, 1, radius: 147 * k).stroke(theme.ink.opacity(0.07), lineWidth: 5 * k)
                ForEach(Array(bands.enumerated()), id: \.offset) { _, band in
                    arc(band.from, band.to, radius: 155 * k).stroke(band.color.opacity(0.8), lineWidth: 4 * k)
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
                            ctx.draw(Text(ClusterReadings.scaleNumber(v)).font(.system(size: max(8, 17 * k), weight: .semibold)).foregroundColor(theme.muted),
                                     at: CGPoint(x: c.x + cos(a) * 103 * k, y: c.y + sin(a) * 103 * k))
                        }
                    }
                }
                ClusterNeedle(thin: true).fill(theme.ink.opacity(0.78)).rotationEffect(.degrees(Self.angle(second ?? 0)))
                    .opacity(second == nil ? 0 : 1).animation(spring, value: second)
                ClusterNeedle(thin: false).fill(color).shadow(color: .black.opacity(0.6), radius: 6 * k)
                    .rotationEffect(.degrees(Self.angle(fraction))).animation(spring, value: fraction)
                Circle().fill(theme.raised).overlay(Circle().stroke(theme.line, lineWidth: 1.5 * k)).frame(width: 26 * k, height: 26 * k)
                Circle().fill(theme.background).frame(width: 10 * k, height: 10 * k)
                Text(name).font(.system(size: max(9, side * (big ? 0.042 : 0.06)), weight: .semibold)).kerning(0.6)
                    .foregroundStyle(theme.muted).lineLimit(1).position(x: side / 2, y: side * 0.34)
                VStack(spacing: 2 * k) {
                    Text(reading).font(.system(size: side * (big ? 0.15 : 0.15), weight: .semibold)).monospacedDigit()
                        .foregroundStyle(big ? theme.ink : theme.segmentLead).contentTransition(.numericText()).lineLimit(1).fixedSize()
                        .animation(reduceMotion ? nil : .easeOut(duration: 0.7), value: reading)
                    Text(unit).font(.system(size: max(7.5, side * (big ? 0.042 : 0.05)))).foregroundStyle(theme.muted).lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: side * (big ? 0.7 : 0.32))
                    ForEach(Array(aux.enumerated()), id: \.offset) { _, a in
                        // One text per line, so a long note shrinks as a whole between the scale's end numbers.
                        Text("\(a.label) \(Text(a.value).fontWeight(.bold).foregroundColor(a.color ?? theme.ink))")
                            .font(.system(size: max(7.5, side * (big ? 0.04 : 0.05)), weight: .semibold)).monospacedDigit()
                            .foregroundStyle(a.color ?? theme.muted).lineLimit(1).minimumScaleFactor(0.5)
                            .frame(maxWidth: side * (big ? 0.7 : 0.32))
                    }
                }
                // The small dial's notes stay between its 0 and its full-scale number.
                .position(x: side / 2, y: side * (big ? 0.62 : 0.59))
                chip().font(.system(size: max(8, side * 0.04))).foregroundStyle(theme.muted).lineLimit(1)
                    .padding(.horizontal, 8 * k).padding(.vertical, 3 * k)
                    .background(theme.card.opacity(0.85), in: Capsule()).overlay(Capsule().stroke(theme.line))
                    .frame(maxWidth: side * 0.8).fixedSize(horizontal: false, vertical: true)
                    .position(x: side / 2, y: side * 0.86)
                    .opacity(Chip.self == EmptyView.self ? 0 : 1)
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    private func arc(_ from: Double, _ to: Double, radius: CGFloat) -> some Shape {
        ClusterArc(from: from, to: to, radius: radius)
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
    var m: QuickMetrics
    var animate: Bool
    var body: some View {
        let total = max(0, min(9_999_999_999, value.rounded())), text = String(format: "%010.0f", total)
        let lead = 10 - String(format: "%.0f", total).count, h = m(21)
        HStack(spacing: 0) {
            ForEach(Array(text.enumerated()), id: \.offset) { k, ch in
                if k > 0 && (10 - k) % 3 == 0 {
                    Text(",").font(.system(size: m(14), weight: .semibold)).foregroundStyle(theme.muted.opacity(k <= lead ? 0.4 : 0.8))
                }
                let digit = Int(String(ch)) ?? 0
                VStack(spacing: 0) {
                    ForEach(0..<10, id: \.self) { d in
                        Text("\(d)").font(.system(size: m(16), weight: .semibold)).monospacedDigit().frame(height: h)
                    }
                }
                .offset(y: -CGFloat(digit) * h + 4.5 * h)
                .animation(animate ? .spring(response: 0.6, dampingFraction: 0.8) : nil, value: digit)
                .frame(width: m(10.5), height: h).clipped()
                .foregroundStyle(k < lead ? theme.muted.opacity(0.45) : theme.ink)
            }
        }
        .padding(.horizontal, m(10)).padding(.vertical, m(7))
        .background(theme.background, in: RoundedRectangle(cornerRadius: m(10)))
        .overlay(RoundedRectangle(cornerRadius: m(10)).stroke(theme.line))
        .accessibilityElement(children: .ignore).accessibilityLabel("\(Int(total)) tokens")
    }
}

/// Lines of items that wrap, right-aligned (the trip's account legs).
struct ClusterFlow: Layout {
    var spacing: CGFloat; var lineSpacing: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = lines(proposal.width ?? .infinity, subviews)
        return CGSize(width: rows.map(\.width).max() ?? 0, height: rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1)))
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in lines(bounds.width, subviews) {
            var x = bounds.maxX - row.width
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
