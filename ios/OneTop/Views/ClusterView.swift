import SwiftUI

/// The dashboard's cluster (계기판) on the Dashboard tab, drawn as the dashboard's cluster.js and cluster.css draw it:
/// two dials of one size (token speed, then the weekly-limit burn), each with its figure at the very centre, a pointer
/// riding the rim and its display (odometer, range) in the lower opening; the warning lights; CPU and memory with the
/// trip; each account's weekly limit left as fuel; and the window, the period drum over seven pages (ClusterWindow).
/// Upright the dials stand one above the other or side by side (the header's switch), then the lights, the lower row,
/// fuel and the window; on its side the phone shows dial · window · dial with the lower row, the lights and fuel
/// under them, as the dashboard's three axes. The readings are ClusterReadings. The pointers spring to each reading and shimmer while sessions work; between readings the trip runs
/// on four times a second at the last minute's rate and the odometer's wheels turn up every three seconds; with Reduce
/// Motion they change only with the readings.
/// The cluster preset's layout (layout.js, customizing-spec_v1.2.2) decides the rest, as cluster.js place() applies it:
/// upright the dials stay on top and the other objects stack under them in its order, hidden ones left out; the dials
/// and the window take its sizes, the lights and fuel its counts, the period control, the dials, the lights and the
/// odometer its shapes.
struct ClusterCard: View {
    typealias Item = ScreenLayout.Item
    @Environment(AppModel.self) private var model
    var theme: QuickTheme
    /// The phone on its side: dial · window · dial across the screen.
    var landscape = false
    /// The cluster preset's objects: their order, the hidden ones and each one's options.
    var layout = ScreenLayout.defaults.presets.cluster
    /// The editor over these objects while customizing (and to enter it by a long press).
    var cz: CustomizeSession? = nil
    /// Draws only this object, as the cluster draws it, for the customizing gallery.
    var preview: Item? = nil
    /// Opens a session's detail (the ↗ on its row in the window, or an area of the usage map).
    var open: (Session) -> Void = { _ in }
    @AppStorage("clusterTripStart") private var tripStart: Double = 0
    /// The window's page, remembered.
    @AppStorage("clusterMode") private var mode = "sessions"
    @State private var pick: ClusterReadings.Pick?
    /// A warning light pressed: the window shows only what it is about.
    @State private var only: String?
    @State private var readAt = Date()
    @State private var hold = ClusterReadings.Hold()
    @State private var wheels = OdometerWheels()
    /// The card's inner width, which sizes the dials and decides how many fuel gauges fit.
    @State private var width: CGFloat = 360
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The look chosen in customizing: a theme draws the instruments, the window and the fuel stay (ClusterTheme.swift).
    @State private var looks = ClusterThemePrefs.shared
    /// '크게 보기': the theme over the whole screen, on its side.
    @State private var bigTheme = false
    private var themed: String? { preview == nil ? looks.theme : nil }

    private var caption: String { L.t("Last \(model.period.label)", "최근 \(model.period.label)") }
    private var reportKey: Double { model.devices.map(\.received).max() ?? 0 }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { timeline in
            let now = DemoData.onScreen && DemoData.held != nil ? DemoData.shownNow() : timeline.date.timeIntervalSince1970
            let r = ClusterReadings(model: model, now: now, pick: pick, only: only, trip: tripStart > 0 ? tripStart : nil, hold: hold)
            let odometer = Odo(value: (r.tach.tokens ?? 0) + r.tach.climb * elapsed(timeline.date), clock: timeline.date)
            let card = preview == nil
            // The width offered, whatever the content asks for, so a wide part drawn before the width is known never
            // widens the card past the screen.
            FitWidth {
                if let preview { previewed(preview, r, now: now, odometer: odometer) }
                else if landscape { sideways(r, now: now, odometer: odometer) } else { upright(r, now: now, odometer: odometer) }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .padding(.horizontal, !card ? 0 : landscape ? 12 : 14).padding(.top, !card ? 0 : landscape ? 10 : 16).padding(.bottom, !card ? 0 : landscape ? 10 : 18)
            .background(card ? theme.card : .clear, in: RoundedRectangle(cornerRadius: 32))
            .overlay(RoundedRectangle(cornerRadius: 32).stroke(card ? theme.line : .clear))
            .onAppear { if tripStart <= 0 || tripStart > now { tripStart = Self.midnight(now) } }
            .fullScreenCover(isPresented: $bigTheme) { themeFull(r, now: now, odometer: odometer) }
        }
        .czProbe(preview == nil && !landscape ? "housing" : "preview", cz)
        .onChange(of: reportKey) { readAt = Date() }
        .accessibilityElement(children: .contain).accessibilityLabel(L.t("Cluster", "계기판"))
        .accessibilityIdentifier(preview == nil ? "cluster" : "cluster-preview")
    }

    /// One object alone, at the gallery card's width.
    @ViewBuilder private func previewed(_ id: Item, _ r: ClusterReadings, now: Double, odometer: Odo) -> some View {
        let side = floor(max(120, (width - 10) / 2))
        switch id {
        case .dials: HStack(spacing: 10) { tokenDial(r, side: side, odometer: odometer); burnDial(r, side: side) }
        case .alerts: lamps(r)
        case .odo: lowerRow(r, now: now, odometer: odometer, showOdometer: true, temps: false)
        default: periods(width: width)
        }
    }

    /// The first visit (or a start still to come, after the clock moved back) starts the trip at midnight, so it opens
    /// on today's tokens.
    private static func midnight(_ now: Double) -> Double {
        Calendar.current.startOfDay(for: Date(timeIntervalSince1970: now)).timeIntervalSince1970
    }
    /// The odometer's count and the clock that lets its wheels move every three seconds.
    private struct Odo { var value: Double; var clock: Date }
    private func odometer(_ odo: Odo, height: CGFloat) -> some View {
        Odometer(value: odo.value, period: model.period.rawValue, clock: odo.clock, wheels: wheels, height: height, reduceMotion: reduceMotion,
                 face: odoFace, led: led)
    }
    /// Between readings the odometer and the trip run on at the last minute's rate, for at most 30 seconds.
    private func elapsed(_ date: Date) -> Double { reduceMotion ? 0 : min(30, max(0, date.timeIntervalSince(readAt))) }

    // MARK: The layout
    /// The dials' and the window's size steps (cluster.js DIAL_K, WIN_K).
    static let dialK: [CGFloat] = [0.76, 0.88, 1], windowK: [CGFloat] = [0.7, 1, 1.35]
    private func opts(_ id: Item) -> ScreenLayout.Options { layout.opts[id] ?? ScreenLayout.options(id) }
    private func shows(_ id: Item) -> Bool { !layout.hidden.contains(id) }
    private var dialFace: String { opts(.dials).shape ?? "ring" }
    private var odoFace: String { opts(.odo).shape ?? "drum" }
    /// The odometer's and the range's lit colour when they show as lit segments (cluster.css data-led).
    private var led: Color { ["red": Lane.rgb(0xff3b30), "amber": Lane.rgb(0xffae2b)][opts(.dials).needle ?? ""] ?? DrumWheel.ink }
    private var periodShape: String { opts(.periods).shape ?? "auto" }

    // MARK: Arrangements
    /// The dashboard's phone order: the two dials side by side on top, then the layout's order (by default the lights,
    /// the trip, fuel, then the period control over the window). Beside each other the dials leave no room for the
    /// temperatures, so they are never drawn here. A hidden window leaves the period control in its place.
    private func upright(_ r: ClusterReadings, now: Double, odometer: Odo) -> some View {
        let side = floor(max(120, (width - 10) / 2) * Self.dialK[opts(.dials).size ?? 2])
        let rest = layout.order.filter { [.alerts, .odo, .fuel, .window].contains($0) && (shows($0) || $0 == .window) }
        return VStack(spacing: 14) {
            if let id = themed {
                // Below the card's gear, which sits in the housing's corner.
                themeCompact(id, r, now: now, odometer: odometer).padding(.top, cz == nil ? 24 : 0)
            } else {
                HStack(spacing: 10) { tokenDial(r, side: side, odometer: odometer); burnDial(r, side: side) }
                    .frame(maxWidth: .infinity)
                    .czPart(.dials, cz)
            }
            // Under a theme's two instruments the rest stays the 1top cluster's: the lights, the odometer and trip, fuel.
            ForEach(rest, id: \.self) { id in
                switch id {
                case .alerts: lamps(r).czPart(.alerts, cz)
                case .odo: lowerRow(r, now: now, odometer: odometer, showOdometer: themed != nil || side < 220, temps: false).czPart(.odo, cz)
                case .fuel: fuel(r, width: width).czPart(.fuel, cz)
                default:
                    if shows(.window) {
                        window(r, odometer: odometer, width: width, pageHeight: 300 * Self.windowK[opts(.window).size ?? 1])
                    } else {
                        periods(width: width).czPart(.periods, cz)
                    }
                }
            }
        }
    }

    /// The dashboard's three axes on a phone on its side: dial · drum over the window · dial, the window as tall as a
    /// dial; under them the lower row, the lights and fuel. The middle column gives the dials the room to keep the
    /// odometer in the token dial. As on the wide dashboard the window always shows, the lights stay in the middle and
    /// the odometer and fuel take the sides in the layout's order.
    private func sideways(_ r: ClusterReadings, now: Double, odometer: Odo) -> some View {
        let col: CGFloat = 10, mid = max(250, min(360, width * 0.32)), side = floor(min(300, max(150, (width - mid - 2 * col) / 2)))
        let foot = side + col, sides = layout.order.filter { $0 == .odo || $0 == .fuel }
        if let id = themed {
            return AnyView(VStack(spacing: 8) {
                themeStrip(id, r, now: now, odometer: odometer)
                HStack(alignment: .top, spacing: col) {
                    window(r, odometer: odometer, width: max(200, width - foot - col), pageHeight: 180, compact: true)
                    if shows(.fuel) { fuel(r, width: foot).frame(width: foot) }
                }
            })
        }
        return AnyView(VStack(spacing: 8) {
            HStack(alignment: .top, spacing: col) {
                tokenDial(r, side: side, odometer: odometer)
                window(r, odometer: odometer, width: mid, pageHeight: max(80, side - 106), compact: true)
                burnDial(r, side: side)
            }
            HStack(alignment: .center, spacing: 0) {
                footPart(sides.first ?? .odo, r, now: now, odometer: odometer, side: side, width: foot, col: col)
                Group { if shows(.alerts) { lamps(r) } else { Color.clear.frame(height: 1) } }.frame(width: mid)
                footPart(sides.last ?? .fuel, r, now: now, odometer: odometer, side: side, width: foot, col: col)
            }
        })
    }
    @ViewBuilder private func footPart(_ id: Item, _ r: ClusterReadings, now: Double, odometer: Odo, side: CGFloat, width: CGFloat, col: CGFloat) -> some View {
        if !shows(id) {
            Color.clear.frame(width: width, height: 1)
        } else if id == .odo {
            lowerRow(r, now: now, odometer: odometer, showOdometer: side < 220, temps: true, narrow: true).frame(width: width)
        } else {
            // The fuel may count the gap beside its column as room, as the web's lower row reaches into the gaps.
            fuel(r, width: width + col).frame(width: width)
        }
    }

    private func window(_ r: ClusterReadings, odometer: Odo, width: CGFloat, pageHeight: CGFloat, compact: Bool = false) -> some View {
        ClusterWindow(r: r, theme: theme, width: width, pageHeight: pageHeight, total: odometer.value, compact: compact,
                      tabs: opts(.window).tabs ?? ScreenLayout.Mode.allCases, periodShape: periodShape, periods: themed == nil || !compact, cz: compact ? nil : cz,
                      mode: $mode, pick: $pick, only: only, open: open)
    }
    private func periods(width: CGFloat) -> some View {
        @Bindable var model = model
        return PeriodControl(shape: periodShape, period: $model.period, theme: theme).frame(width: width)
    }

    // MARK: Theme
    /// What the theme's figures stand for: a new report, period, pick, pressed warning or trip redraws it.
    private func themeKey(_ r: ClusterReadings) -> String { "\(reportKey)|\(model.period.rawValue)|\(String(describing: pick))|\(only ?? "")|\(r.trip?.start ?? 0)" }
    /// Upright: the theme's two headline instruments cut out side by side, as large as the 1top dials (themes/compact.js),
    /// with '크게 보기' under them for the whole theme.
    private func themeCompact(_ id: String, _ r: ClusterReadings, now: Double, odometer: Odo) -> some View {
        let aspect = ClusterThemePrefs.compact[id] ?? 1280 / 480
        return VStack(alignment: .trailing, spacing: 6) {
            ThemeHostView(mode: .compact(id), key: themeKey(r), figures: { ClusterThemeFigures.make(r, period: model.period, now: now, odometer: odometer.value) },
                          onPress: { themePress($0, r) })
                .aspectRatio(aspect, contentMode: .fit)
                .frame(maxWidth: ClusterThemePrefs.compactTall * aspect)
                .frame(maxWidth: .infinity)
            Button { bigTheme = true } label: {
                Text("⤢ " + L.t("Full screen", "크게 보기")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 10).frame(height: 26).background(.black.opacity(0.6), in: Capsule()).overlay(Capsule().stroke(.white.opacity(0.28)))
            }
            .buttonStyle(.plain).accessibilityIdentifier("cluster-theme-big")
        }
        .czPart(.dials, cz)
    }
    /// On its side: the whole theme across the screen.
    private func themeStrip(_ id: String, _ r: ClusterReadings, now: Double, odometer: Odo) -> some View {
        ThemeHostView(mode: .theme(id), key: themeKey(r), figures: { ClusterThemeFigures.make(r, period: model.period, now: now, odometer: odometer.value) },
                      onPress: { themePress($0, r) })
            .aspectRatio(1280 / 480, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .czPart(.dials, cz)
    }
    /// The theme over the whole screen, on its side; a warning pressed closes it to show its sessions.
    private func themeFull(_ r: ClusterReadings, now: Double, odometer: Odo) -> some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let id = looks.theme {
                ThemeHostView(mode: .side(id), key: themeKey(r), figures: { ClusterThemeFigures.make(r, period: model.period, now: now, odometer: odometer.value) },
                              onPress: { themePress($0, r) })
                    .ignoresSafeArea()
            }
            Button { bigTheme = false } label: {
                Image(systemName: "xmark").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).frame(width: 36, height: 36)
                    .background(.black.opacity(0.55), in: Circle()).overlay(Circle().stroke(.white.opacity(0.3)))
            }
            .buttonStyle(.plain).padding(14).accessibilityLabel(L.t("Close", "닫기")).accessibilityIdentifier("cluster-theme-close")
        }
    }
    /// A theme's warning, gear or trip answers as the cluster's own.
    private func themePress(_ action: ThemeHostView.Press, _ r: ClusterReadings) {
        switch action {
        case .alert(let key): press(key, ids: lit(r, key)); if key != "live" { bigTheme = false }
        case .period(let raw): if let p = Period(rawValue: raw) { model.period = p }
        case .trip: tripStart = Date().timeIntervalSince1970
        case .pick: break
        }
    }

    // MARK: Dials
    /// The needles shimmer while any session works, as a running engine's do.
    private func running(_ r: ClusterReadings) -> Bool { !reduceMotion && !r.tells.working.isEmpty }

    private func tokenDial(_ r: ClusterReadings, side: CGFloat, odometer: Odo) -> some View {
        // The scale in M (B from a billion); the figure and the lit arc take the lane's colour at the reading.
        let t = r.tach, div = t.full >= 1e9 ? 1e9 : 1e6, f = min(1, max(0, (t.rate ?? 0) / t.full))
        let format = { (v: Double) in v == 0 ? "0" : ClusterReadings.scaleNumber(v / div) + (div == 1e9 ? "B" : "M") }
        let tone = t.rate == nil ? theme.muted : Lane.color(Lane.token, f)
        return FeverDial(level: ClusterReadings.feverLevel(t.full), memory: "tach", side: side, reduceMotion: reduceMotion) {
        ClusterDial(scale: ClusterReadings.tachMarks(t.full), format: format, fraction: f, lane: Lane.token, multi: [],
                           shimmer: running(r), phase: 0, theme: theme, reduceMotion: reduceMotion, side: side, face: dialFace) {
            SegDisplay(cells: Display.digits(t.rate), color: tone, height: side * (side < 280 ? 0.112 : 0.135))
        } unit: {
            Text(L.t("tokens/h", "tokens/시간"))
        } name: {
            Text(L.t("Token speed", "토큰 속도")).foregroundStyle(theme.muted)
        } display: {
            if side >= 220 {
                VStack(spacing: side * 0.008) {
                    if side >= 280 { Text(L.t("Total", "합계")).font(.system(size: max(9.5, side * 0.032), weight: .semibold)).foregroundStyle(theme.muted) }
                    self.odometer(odometer, height: max(11, side * 0.042) * 1.15)
                }
            }
        }
        }
        .czProbe("dial-tach", cz)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.t("Token speed \(ClusterReadings.tokens(t.rate)) tokens/h · \(caption)", "토큰 속도 \(ClusterReadings.tokens(t.rate)) tokens/시간 · \(caption)"))
        .accessibilityIdentifier("cluster-tachometer")
    }

    private func burnDial(_ r: ClusterReadings, side: CGFloat) -> some View {
        // One colour: the accent for every AI, the tool's colour (lifted a little) for a session or account picked.
        let s = r.speed, tone = s.kind.map { Tool.color($0).mix(with: .white, by: 0.22) } ?? Lane.burn
        let lane: [(Double, Color)] = [(0, tone), (1, tone)], f = min(1, max(0, (s.value ?? 0) / s.max))
        let account = r.accounts.first { $0.id == s.account }, session = model.groups.first { $0.id == s.session }?.root
        return FeverDial(level: ClusterReadings.burnLevel(s.max), memory: "burn", side: side, reduceMotion: reduceMotion) {
        ClusterDial(scale: ClusterReadings.burnMarks(s.max), format: ClusterReadings.scaleNumber, fraction: f, lane: lane, multi: s.multi,
                           shimmer: running(r), phase: 1.7, theme: theme, reduceMotion: reduceMotion, side: side, face: dialFace) {
            SegDisplay(cells: Display.burn(s.value), color: s.value == nil ? theme.muted : tone, height: side * (side < 280 ? 0.112 : 0.135))
        } unit: {
            Text(L.t("%/h", "%/시간"))
        } name: {
            HStack(spacing: 4) {
                if let kind = s.kind, let session {
                    // A session reads as its model and effort (Opus 5.5 · xhigh).
                    Circle().fill(Tool.color(kind)).frame(width: 6, height: 6)
                    Text(ClusterReadings.modelName(session.model) ?? session.name).fontWeight(.semibold).foregroundStyle(theme.ink)
                    if let effort = session.effort, !effort.isEmpty {
                        Text(effort).foregroundStyle(theme.muted).padding(.horizontal, 4).background(theme.raised, in: RoundedRectangle(cornerRadius: 4))
                    }
                } else if let kind = s.kind {
                    Circle().fill(Tool.color(kind)).frame(width: 6, height: 6)
                    Text(Tool.name(kind)).fontWeight(.semibold).foregroundStyle(theme.ink)
                    if let plan = account?.plan ?? account?.tag { Text(plan).foregroundStyle(theme.muted) }
                } else {
                    // One text, so a longer language's name scales down as a whole instead of cutting off its first word.
                    Text("\(Text(L.t("Limit burn", "한도 소진")).foregroundStyle(theme.muted)) \(Text(L.t("· All AI", "· 전체 AI")).foregroundStyle(Lane.burn))")
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { if s.picked { pick = nil } }
        } display: {
            if side >= 200 { range(r) }
        }
        }
        .czProbe("dial-burn", cz)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.t("Limit burn \(ClusterReadings.reading(s.value))%/h", "한도 소진 \(ClusterReadings.reading(s.value))%/시간") + (session.map { " · " + $0.name } ?? ""))
        .accessibilityIdentifier("cluster-speedometer")
    }

    /// Hours of work left before the limit runs out, red when that comes before the reset.
    private func range(_ r: ClusterReadings) -> some View {
        let reach = r.speed.reach, early = reach.early
        return VStack(spacing: 3) {
            if reach.state == .reconnect {
                Text(L.t("Sign-in needed", "재로그인 필요")).font(.system(size: 11, weight: .semibold)).foregroundStyle(theme.amber)
            } else {
                Text(L.t("Time left", "작업 가능")).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(early ? Lane.zone : theme.muted)
                HStack(alignment: .bottom, spacing: 4) {
                    // On drums the range rolls on the odometer's wheels; otherwise it is lit, as the odometer is.
                    Group {
                        if odoFace == "drum" {
                            RangeDrum(hours: reach.hours, height: 14.5, early: early, reduceMotion: reduceMotion)
                        } else {
                            SegDisplay(cells: Display.hours(reach.hours), color: early ? Lane.zone : led, height: 14.5).modifier(DrumPlate(em: 14.5 / 1.15, early: early))
                        }
                    }
                    .shadow(color: early ? Lane.zone.opacity(0.5) : .clear, radius: 5)
                    // Beside a figure the hour is a unit: 27 h, 27 小时.
                    Text(L.t("h", "시간")).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.muted)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(reach.state == .reconnect ? L.t("Sign-in needed", "재로그인 필요")
            : L.t("Time left \(Display.hours(reach.hours).cells.map(String.init).joined()) h", "작업 가능 \(Display.hours(reach.hours).cells.map(String.init).joined())시간"))
    }

    // MARK: Warning lights: every light in its place, dark until it has something to tell, then lit in its colour
    /// Live first (green while readings arrive on time, red 수집 지연 when they run late), then what is working, waiting
    /// and done, and the two account troubles in red. Working wears the sessions' own bars in their green, waiting their
    /// warning triangle.
    private var lamps: [(key: String, name: String, icon: String, color: Color)] {
        [("live", L.t("Live", "실시간"), "dot.radiowaves.left.and.right", Lane.rgb(0x9be23c)), ("working", L.t("Working", "작업 중"), "", theme.segmentOn),
         ("waiting", L.t("Waiting", "응답 대기"), "", Lane.rgb(0xe3b25a)), ("done", L.t("Done", "완료됨"), "doc.text", Lane.rgb(0x6ccfa9)),
         ("reconnect", L.t("Sign in", "재로그인"), "link", Lane.rgb(0xf2797d)), ("empty", L.t("Low limit", "한도 부족"), "fuelpump", Lane.rgb(0xf2797d))]
    }
    private func lit(_ r: ClusterReadings, _ key: String) -> [String] {
        switch key {
        case "working": r.tells.working
        case "waiting": r.tells.waiting
        case "done": r.tells.done
        case "reconnect": r.tells.reconnect
        case "empty": r.tells.empty
        default: []
        }
    }
    private typealias Lamp = (key: String, name: String, icon: String, color: Color)
    /// The lights in the layout's shape (cluster.css data-lamps), as many as its count: label (each named under its
    /// light), strip (lights alone), count (the count beside a lit light), badge (the count on its corner), lens (each
    /// in its own lens, three a row) or chips (only what is lit, as named chips, two a row).
    @ViewBuilder private func lamps(_ r: ClusterReadings) -> some View {
        let style = opts(.alerts).shape ?? "label", n = opts(.alerts).count.flatMap { if case .value(let v) = $0 { v } else { nil } } ?? 6
        let shown = Array(lamps.prefix(max(1, n)))
        Group {
            switch style {
            case "chips": chips(r)
            case "label":
                HStack(spacing: 0) { ForEach(shown, id: \.key) { lamp in lampButton(r, lamp) } }
                    .padding(.horizontal, 6).padding(.vertical, 4).frame(maxWidth: .infinity)
                    .background(Lane.rgb(0x0b0e10), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(theme.line))
            case "lens":
                LazyVGrid(columns: Array(repeating: GridItem(.fixed(44), spacing: 6), count: min(3, shown.count)), spacing: 6) {
                    ForEach(shown, id: \.key) { lamp in tell(r, lamp, style: style) }
                }
                .padding(8)
                .background(Lane.rgb(0x0b0e10), in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(theme.line))
            default:
                HStack(spacing: 4) { ForEach(shown, id: \.key) { lamp in tell(r, lamp, style: style) } }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Lane.rgb(0x0b0e10), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(theme.line))
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain).accessibilityLabel(L.t("Warning lights", "경고등"))
    }
    /// What pressing a light does: a lit one shows only what it is about, sessions on the sessions page and accounts on
    /// the limits page; pressing it again shows everything.
    private func press(_ key: String, ids: [String]) {
        let pressed = only == key
        guard key != "live", !ids.isEmpty || pressed else { return }
        only = pressed ? nil : key
        mode = ["reconnect", "empty"].contains(key) ? "weekly" : "sessions"
    }
    private func lampState(_ r: ClusterReadings, _ lamp: Lamp) -> (ids: [String], lit: Bool, color: Color, name: String, pressed: Bool) {
        let live = lamp.key == "live", ids = lit(r, lamp.key), late = live && !r.tells.fresh
        return (ids, live || !ids.isEmpty, late ? Lane.rgb(0xff4d40) : lamp.color, late ? L.t("Collection delayed", "수집 지연") : lamp.name, only == lamp.key)
    }
    @ViewBuilder private func lampIcon(_ key: String, _ icon: String, size: CGFloat = 22) -> some View {
        Group {
            switch key {
            case "working": WorkingBars().stroke(style: StrokeStyle(lineWidth: 2.6 * size / 22, lineCap: .round))
            case "waiting": WarningTriangle().stroke(style: StrokeStyle(lineWidth: 1.7 * size / 22, lineCap: .round, lineJoin: .round))
            default: Image(systemName: icon).font(.system(size: 17 * size / 22, weight: .semibold))
            }
        }
        .frame(width: size, height: size)
    }
    private func lampButton(_ r: ClusterReadings, _ lamp: Lamp) -> some View {
        let st = lampState(r, lamp), live = lamp.key == "live"
        return Button { press(lamp.key, ids: st.ids) } label: {
            VStack(spacing: 3) {
                lampIcon(lamp.key, lamp.icon)
                    .shadow(color: st.lit ? st.color.opacity(0.7) : .clear, radius: 4)
                Text(st.name).font(.system(size: 10, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(st.lit ? st.color : Lane.rgb(0x454d53))
            .frame(maxWidth: .infinity).frame(height: 44)
            .overlay(alignment: .topTrailing) {
                if !live && !st.ids.isEmpty {
                    Text("\(st.ids.count)").font(.system(size: 10, weight: .heavy)).monospacedDigit().foregroundStyle(st.color).padding(.trailing, 4)
                }
            }
            .background(st.pressed ? st.color.opacity(0.16) : .clear, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(st.pressed ? st.color.opacity(0.6) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .czProbe("lamp-\(lamp.key)", cz)
        .accessibilityLabel(st.name + (live || st.ids.isEmpty ? "" : " \(st.ids.count)"))
        .accessibilityAddTraits(st.pressed ? .isSelected : [])
        .accessibilityIdentifier("cluster-lamp-\(lamp.key)")
    }
    /// One light of the strip, count, badge and lens shapes: grey until lit, then in its colour.
    private func tell(_ r: ClusterReadings, _ lamp: Lamp, style: String) -> some View {
        let st = lampState(r, lamp), n = lamp.key == "live" ? 0 : st.ids.count, lens = style == "lens"
        return Button { press(lamp.key, ids: st.ids) } label: {
            HStack(spacing: 4) {
                lampIcon(lamp.key, lamp.icon).shadow(color: st.lit ? st.color.opacity(0.7) : .clear, radius: 4)
                if style == "count" && n > 0 { Text("\(n)").font(.system(size: 13, weight: .heavy)).monospacedDigit() }
            }
            .foregroundStyle(st.lit ? st.color : Lane.rgb(0x454d53))
            .padding(.horizontal, style == "count" && n > 0 ? 8 : 0)
            .frame(minWidth: lens ? 44 : 36).frame(height: lens ? 38 : 34)
            .background {
                if lens {
                    RoundedRectangle(cornerRadius: 9).fill(RadialGradient(colors: [st.lit ? st.color.opacity(0.18).mix(with: Lane.rgb(0x0b0d0e), by: 0.5) : Lane.rgb(0x15191c), Lane.rgb(0x080a0b)],
                                                                         center: UnitPoint(x: 0.5, y: 0.38), startRadius: 0, endRadius: 30))
                }
            }
            .overlay { if lens { RoundedRectangle(cornerRadius: 9).stroke(st.lit ? st.color.opacity(0.45) : theme.line.opacity(0.6)) } }
            .overlay(alignment: lens ? .bottomTrailing : .topTrailing) {
                if n > 0 && (style == "badge" || lens) {
                    if lens {
                        Text("\(n)").font(.system(size: 10, weight: .heavy)).monospacedDigit().foregroundStyle(st.color).padding(.trailing, 4).padding(.bottom, 2)
                    } else {
                        Text("\(n)").font(.system(size: 10, weight: .heavy)).monospacedDigit().foregroundStyle(Lane.rgb(0x0b0e10))
                            .padding(.horizontal, 3).frame(minWidth: 15, minHeight: 15).background(st.color, in: Capsule()).offset(x: 1, y: 1)
                    }
                }
            }
            .background(st.pressed ? st.color.opacity(0.16) : .clear, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(st.pressed ? st.color.opacity(0.6) : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .czProbe("lamp-\(lamp.key)", cz)
        .accessibilityLabel(st.name + (n > 0 ? " \(n)" : ""))
        .accessibilityAddTraits(st.pressed ? .isSelected : [])
        .accessibilityIdentifier("cluster-lamp-\(lamp.key)")
    }
    /// The chips: calm notes for what is working or just finished, then each warning that is lit; nothing when all is
    /// well. Two a row, the last one centred.
    @ViewBuilder private func chips(_ r: ClusterReadings) -> some View {
        let list = lamps.filter { lamp in
            lamp.key == "live" ? !r.tells.fresh : !lit(r, lamp.key).isEmpty
        }
        if !list.isEmpty {
            let rows = stride(from: 0, to: list.count, by: 2).map { Array(list[$0..<min(list.count, $0 + 2)]) }
            VStack(spacing: 6) {
                ForEach(rows.indices, id: \.self) { i in
                    HStack(spacing: 6) { ForEach(rows[i], id: \.key) { chip(r, $0) } }
                }
            }
            .frame(maxWidth: 300)
        }
    }
    private func chip(_ r: ClusterReadings, _ lamp: Lamp) -> some View {
        let st = lampState(r, lamp), note = lamp.key == "working" || lamp.key == "done"
        let color = lamp.key == "done" ? theme.accent : lamp.key == "live" || lamp.key == "empty" ? theme.red : note ? theme.segmentOn : theme.amber
        let name = lamp.key == "done" ? L.t("Just done", "방금 완료") : st.name, n = lamp.key == "live" ? 0 : st.ids.count
        return Button { press(lamp.key, ids: st.ids) } label: {
            HStack(spacing: note ? 6 : 7) {
                if note { Circle().fill(color).frame(width: 7, height: 7) } else { lampIcon(lamp.key, lamp.icon, size: 16).foregroundStyle(color) }
                Text(name).foregroundStyle(theme.ink)
                if n > 0 { Text("\(n)").fontWeight(.bold).monospacedDigit().foregroundStyle(note ? theme.ink : color) }
            }
            .font(.system(size: 12.5, weight: .semibold)).lineLimit(1)
            .frame(maxWidth: .infinity).frame(height: 26)
            .overlay(Capsule().stroke(st.pressed ? color : color.opacity(0.5).mix(with: theme.line, by: 0.3), lineWidth: st.pressed ? 2 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .frame(width: 147)
        .czProbe("lamp-\(lamp.key)", cz)
        .accessibilityLabel(name + (n > 0 ? " \(n)" : ""))
        .accessibilityAddTraits(st.pressed ? .isSelected : [])
        .accessibilityIdentifier("cluster-lamp-\(lamp.key)")
    }

    // MARK: Lower row: CPU and memory beside the trip (and the odometer when the dials are small)
    /// Under a dial on its side the row stacks: the temperatures, the odometer when it is not in the dial, the trip.
    private func lowerRow(_ r: ClusterReadings, now: Double, odometer: Odo, showOdometer: Bool, temps: Bool, narrow: Bool = false) -> some View {
        let gauges = HStack(spacing: 6) {
            TempGauge(label: "CPU", value: r.heat.cpu, theme: theme, reduceMotion: reduceMotion)
            TempGauge(label: L.t("Memory", "메모리"), value: r.heat.memory, theme: theme, reduceMotion: reduceMotion)
        }
        let total = VStack(spacing: 4) {
            Text(L.t("Total · \(caption)", "합계 · \(caption)")).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.muted)
            self.odometer(odometer, height: 15)
        }
        return Group {
            if narrow {
                VStack(spacing: 6) {
                    if temps { gauges }
                    if showOdometer { total }
                    trip(r, now: now)
                }
            } else {
                HStack(alignment: .center, spacing: 14) {
                    if temps { gauges }
                    if showOdometer { total }
                    trip(r, now: now)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
    private func trip(_ r: ClusterReadings, now: Double) -> some View {
        let add = r.tach.instant.map { $0 / ClusterReadings.hour * elapsed(Date()) } ?? 0
        let tokens = r.trip?.tokens.map { $0 + add }
        let since = r.trip.map { trip -> String in
            let date = Date(timeIntervalSince1970: trip.start), f = DateFormatter()
            f.dateFormat = Calendar.current.isDate(date, inSameDayAs: Date(timeIntervalSince1970: now)) ? "HH:mm" : "M. d. HH:mm"
            return f.string(from: date)
        } ?? ""
        return VStack(spacing: 4) {
            HStack(spacing: 4) {
                Text(L.t("Trip", "트립")).foregroundStyle(theme.muted)
                if r.trip?.inRange == false {
                    Text(L.t("Outside the record", "기록 범위 밖")).foregroundStyle(theme.amber)
                } else {
                    Text(ClusterReadings.short(tokens)).font(.system(size: 13.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.ink)
                    Text("tokens").foregroundStyle(theme.muted)
                }
            }
            HStack(spacing: 6) {
                // English puts the word first (since 09:00); Korean and Chinese after (09:00부터, 09:00起).
                Text(L.t("since \(since)", "\(since)부터")).foregroundStyle(theme.muted)
                Button { tripStart = floor(now) } label: {
                    Text(L.t("Reset", "리셋")).font(.system(size: 11.5, weight: .semibold)).padding(.horizontal, 8).frame(height: 22)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(theme.line)).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel(L.t("Reset the trip", "트립 리셋"))
            }
        }
        .font(.system(size: 11.5))
        .lineLimit(1)
    }

    // MARK: Fuel: what is left of each account's weekly limit, closer together the more there are
    /// Centre-to-centre spacing by how many gauges show: 2–4 → 58, 5 → 56, 6 → 54, 7 → 50, 8 → 47.
    private static let pitch: [CGFloat] = [0, 58, 58, 58, 58, 56, 54, 50, 47]
    /// Agy reports a pool for each model family; one gauge stands for them all, the pool nearest its end.
    private func fuel(_ r: ClusterReadings, width: CGFloat) -> some View {
        let agy = r.accounts.filter { $0.kind == "Antigravity" }
        let lead = agy.count > 1 ? agy.min { ($0.left ?? 101) < ($1.left ?? 101) } : nil
        let gauges = r.accounts.filter { $0.kind != "Antigravity" || lead == nil || $0.id == lead?.id }
        // The layout's count caps the gauges ('as many as fit' when it has none).
        let cap = opts(.fuel).count.flatMap { if case .value(let v) = $0 { v } else { nil } } ?? 8
        var n = min(8, cap, gauges.count)
        while n > 3 && CGFloat(n) * Self.pitch[n] > width - 8 { n -= 1 }
        let shown = ClusterReadings.pick(gauges, n), more = gauges.count - shown.count
        let weekly = model.quotas.allSatisfy { $0.representativeWindow?.isWeekly != false }
        return VStack(spacing: 6) {
            HStack(spacing: 4) {
                Text(weekly ? L.t("Weekly limit left", "남은 주간 한도") : L.t("Limit left", "남은 한도")).foregroundStyle(theme.muted)
                if more > 0 { Text("+\(more)").fontWeight(.bold).foregroundStyle(theme.ink) }
            }.font(.system(size: 11, weight: .semibold))
            if r.accounts.isEmpty {
                Text(L.t("No subscription accounts connected.", "연결된 구독 계정이 없습니다.")).font(.system(size: 11.5)).foregroundStyle(theme.dim)
            } else {
                HStack(alignment: .bottom, spacing: 0) {
                    ForEach(shown) { a in
                        can(a, pools: a.id == lead?.id ? agy.filter { $0.id != a.id } : [], on: r.speed.account == a.id, small: n >= 7).frame(width: Self.pitch[max(2, n)])
                            .czProbe("can-\(a.id)", cz)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onChange(of: shown.count, initial: true) { cz?.shown[.fuel] = shown.count }
    }
    private func can(_ a: ClusterReadings.Account, pools: [ClusterReadings.Account], on: Bool, small: Bool) -> some View {
        let color = Tool.color(a.kind), low = (a.left ?? 100) < 15
        let tool = ["Claude": "Claude", "Codex": "Codex", "Antigravity": "Agy", "GLM": "GLM"][a.kind] ?? Tool.name(a.kind)
        let plan = a.brief.isEmpty ? "—" : a.brief
        let state = a.reconnect ? L.t("Sign-in needed", "재로그인 필요") : a.left == nil ? L.t("Awaiting report", "보고 대기")
            : ClusterReadings.number(a.left) + L.t("% remaining", "% 남음")
        let others = pools.map { ", \($0.shortTag ?? "") " + ($0.left.map { ClusterReadings.number($0) + "%" } ?? "—") + L.t(" remaining", " 남음") }.joined()
        return Button { pick = on ? nil : .account(a.id) } label: {
            VStack(spacing: 4) {
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: 4).fill(theme.ink.opacity(0.09))
                    RoundedRectangle(cornerRadius: 4).fill(low ? theme.amber : color).opacity(a.current ? 1 : 0.45)
                        .frame(height: 44 * CGFloat((a.left ?? 0) / 100))
                        .animation(reduceMotion ? nil : .easeOut(duration: 1), value: a.left)
                }
                .frame(width: 16, height: 44).clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(on ? color : a.reconnect ? theme.amber : .clear, lineWidth: on ? 1.5 : 1))
                .shadow(color: on ? color.opacity(0.6) : .clear, radius: 5)
                VStack(spacing: 0) {
                    // The tool in its own colour, the plan under it.
                    Text(tool).font(.system(size: small ? 10 : 10.5, weight: .semibold)).foregroundStyle(color)
                    Text(plan).font(.system(size: small ? 10.5 : 11, weight: .bold)).foregroundStyle(on ? color : theme.ink)
                }.lineLimit(1).minimumScaleFactor(0.8)
            }.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(Tool.name(a.kind)) \(a.plan ?? a.tag ?? ""), \(state)\(others)")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Takes the width it is offered and centres its content in it, however wide the content asks to be.
struct FitWidth: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let s = subviews.first?.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil)) ?? .zero
        return CGSize(width: proposal.width ?? s.width, height: s.height)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: CGPoint(x: bounds.midX, y: bounds.minY), anchor: .top, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
}

/// The cluster's colours (cluster.js LANE, cluster.css): the token lane from green through yellow and orange to red,
/// the burn dial's accent, the red zone and needles.
enum Lane {
    static func rgb(_ hex: UInt32) -> Color {
        Color(red: Double(hex >> 16 & 255) / 255, green: Double(hex >> 8 & 255) / 255, blue: Double(hex & 255) / 255)
    }
    /// Green for the first half of the scale, then quickly yellow, orange and red.
    static let token: [(Double, Color)] = [(0, rgb(0x57d36a)), (0.5, rgb(0x57d36a)), (0.62, rgb(0xe2e04a)), (0.76, rgb(0xff9a2e)), (0.88, rgb(0xff3b30)), (1, rgb(0xff3b30))]
    static let burn = rgb(0x6ccfa9), zone = rgb(0xff3b30), needle = rgb(0xff3b30)
    /// The scale sweeps 240° from lower left, leaving the lower third open for the displays.
    static func angle(_ f: Double) -> Double { 150 + 240 * min(1, max(0, f)) }
    static func color(_ stops: [(Double, Color)], _ f: Double) -> Color {
        let f = min(1, max(0, f))
        var i = 1
        while i < stops.count - 1 && stops[i].0 < f { i += 1 }
        let (f0, c0) = stops[i - 1], (f1, c1) = stops[i]
        return c0.mix(with: c1, by: f1 > f0 ? min(1, max(0, (f - f0) / (f1 - f0))) : 1)
    }
}

/// One round dial on a 340-unit face, as cluster.js draws it: the lane faint along a 240° scale and lit up to the
/// reading, ticks and numbers (red in the top fifth, with a quiet red arc outside), each account's mark on the rim,
/// a pointer riding the rim; the figure at the very centre, its unit and name under it, and the display (odometer or
/// range) in the lower opening. Its face is the layout's: ring (the concentric face), glow (the face lit behind the
/// pointer) or plate (the figure on a dark plate).
struct ClusterDial<Figure: View, Unit: View, Name: View, Shown: View>: View {
    var scale: ClusterReadings.Scale
    var format: (Double) -> String
    var fraction: Double
    var lane: [(Double, Color)]
    var multi: [ClusterReadings.Mark]
    var shimmer: Bool
    var phase: Double
    var theme: QuickTheme
    var reduceMotion: Bool
    var side: CGFloat
    var face = "ring"
    @ViewBuilder var figure: () -> Figure
    @ViewBuilder var unit: () -> Unit
    @ViewBuilder var name: () -> Name
    @ViewBuilder var display: () -> Shown

    private var spring: Animation? { reduceMotion ? nil : .spring(response: 1.1, dampingFraction: 0.55) }
    /// A few degrees either way on uneven periods, never more than three, so it never settles into a rhythm.
    private static func wobble(_ t: Double) -> Double { 1.4 * sin(t * 2.7) + 0.9 * sin(t * 6.1 + 1.3) + 0.5 * sin(t * 11.3 + 0.4) }

    var body: some View {
        let k = side / 340
        ZStack {
            DialFace(fraction: fraction, scale: scale, format: format, lane: lane, multi: multi, theme: theme, fan: face == "glow")
                .animation(spring, value: fraction)
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !shimmer)) { tl in
                RimPointer().fill(Lane.needle).shadow(color: Lane.needle.opacity(0.55), radius: 3 * k).shadow(color: .black.opacity(0.55), radius: 5 * k)
                    .rotationEffect(.degrees(Lane.angle(fraction))).animation(spring, value: fraction)
                    .rotationEffect(.degrees(shimmer ? Self.wobble(tl.date.timeIntervalSinceReferenceDate + phase) : 0))
            }
            figure()
                .padding(.horizontal, face == "plate" ? side * 0.024 : 0).padding(.vertical, face == "plate" ? side * 0.006 : 0)
                .background {
                    if face == "plate" {
                        RoundedRectangle(cornerRadius: side * 0.026).fill(theme.background.mix(with: .black, by: 0.14))
                            .overlay(RoundedRectangle(cornerRadius: side * 0.026).stroke(theme.line))
                            .shadow(color: .black, radius: side * 0.015, y: side * 0.01)
                    }
                }
                .position(x: side / 2, y: side * 0.5)
            unit().font(.system(size: max(9.5, side * 0.04), weight: .semibold)).foregroundStyle(theme.ink.opacity(0.84)).lineLimit(1)
                .position(x: side / 2, y: side * 0.602)
            // On a small dial the name keeps a line's height under the unit instead of running into it.
            name().font(.system(size: max(9.5, side * 0.036), weight: .semibold)).kerning(0.4).lineLimit(1).minimumScaleFactor(0.7)
                .frame(maxWidth: side * 0.46).position(x: side / 2, y: side * 0.602 + max(side * 0.052, 11.5))
            display().position(x: side / 2, y: side * 0.79)
        }
        .frame(width: side, height: side)
    }
}

/// The dial's face; its fraction animates, so the lit lane and ticks follow the pointer's spring.
struct DialFace: View, @preconcurrency Animatable {
    var fraction: Double
    var scale: ClusterReadings.Scale
    var format: (Double) -> String
    var lane: [(Double, Color)]
    var multi: [ClusterReadings.Mark]
    var theme: QuickTheme
    /// The lit sector behind the pointer (the glow face).
    var fan = false
    var animatableData: Double {
        get { fraction }
        set { fraction = newValue }
    }

    var body: some View {
        Canvas { ctx, size in
            let side = min(size.width, size.height), k = side / 340, c = CGPoint(x: size.width / 2, y: size.height / 2), f = min(1, max(0, fraction))
            func pt(_ v: Double, _ r: Double, _ extra: Double = 0) -> CGPoint {
                let a = (Lane.angle(v) + extra) * .pi / 180
                return CGPoint(x: c.x + cos(a) * r * k, y: c.y + sin(a) * r * k)
            }
            func arc(_ f0: Double, _ f1: Double, _ r: Double) -> Path {
                Path { p in p.addArc(center: c, radius: r * k, startAngle: .degrees(150 + 240 * f0), endAngle: .degrees(150 + 240 * f1), clockwise: false) }
            }
            // Face, rim and the quiet concentric rings.
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 170 * k, y: c.y - 170 * k, width: 340 * k, height: 340 * k)),
                     with: .radialGradient(Gradient(colors: [theme.raised, theme.background]), center: CGPoint(x: c.x, y: c.y - 0.08 * side), startRadius: 0, endRadius: side * 0.55))
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - 160 * k, y: c.y - 160 * k, width: 320 * k, height: 320 * k)), with: .color(theme.line), lineWidth: 2 * k)
            for (r, dash) in [(118.0, false), (92.0, true), (66.0, false)] {
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r * k, y: c.y - r * k, width: 2 * r * k, height: 2 * r * k)), with: .color(theme.ink.opacity(0.07)),
                           style: StrokeStyle(lineWidth: 1.2 * k, dash: dash ? [2 * k, 6 * k] : []))
            }
            if fan && f > 0.002 {
                var sector = Path()
                sector.move(to: c)
                sector.addArc(center: c, radius: 140 * k, startAngle: .degrees(Lane.angle(0)), endAngle: .degrees(Lane.angle(f)), clockwise: false)
                sector.closeSubpath()
                ctx.fill(sector, with: .color(Lane.color(lane, f).opacity(0.13)))
            }
            // The lane: faint all the way, lit to the reading.
            ctx.stroke(arc(0, 1, 147), with: .color(theme.ink.opacity(0.08)), lineWidth: 5 * k)
            let pieces = 96
            for i in 0..<pieces {
                let f0 = Double(i) / Double(pieces), f1 = min(1, (Double(i) + 1.15) / Double(pieces))
                ctx.stroke(arc(f0, f1, 147), with: .color(Lane.color(lane, (Double(i) + 0.5) / Double(pieces)).opacity(0.2)), lineWidth: 5 * k)
            }
            if f > 0.002 {
                ctx.drawLayer { layer in
                    layer.addFilter(.shadow(color: Lane.color(lane, f).opacity(0.45), radius: 4 * k))
                    for i in 0..<pieces where Double(i) / Double(pieces) < f {
                        let f0 = Double(i) / Double(pieces), f1 = min(f, (Double(i) + 1.15) / Double(pieces))
                        layer.stroke(arc(f0, f1, 147), with: .color(Lane.color(lane, (Double(i) + 0.5) / Double(pieces))), lineWidth: 5 * k)
                    }
                    let end = pt(f, 147)
                    layer.fill(Path(ellipseIn: CGRect(x: end.x - 2.5 * k, y: end.y - 2.5 * k, width: 5 * k, height: 5 * k)), with: .color(Lane.color(lane, f)))
                }
            }
            // The red zone: a quiet arc outside the ticks over the top fifth.
            ctx.stroke(arc(0.8, 1, 155), with: .color(Lane.zone.opacity(0.5)), lineWidth: 3.5 * k)
            // Ticks and numbers; lit ticks take the lane's colour at their place, the top fifth red.
            // A full scale off the minor step (700M on 40M steps) gets its own last tick and always its number; a major
            // mark too close before it gives way.
            let n = Int((scale.max / scale.minor + 1e-6).rounded(.down)), extra = scale.max - Double(n) * scale.minor > scale.max * 1e-6 ? 1 : 0
            let offGrid = abs(scale.max / scale.major - (scale.max / scale.major).rounded()) > 1e-6
            for i in 0...max(0, n + extra) {
                let last = i == n + extra, v = i > n ? scale.max : Double(i) * scale.minor, at = v / scale.max
                let major = last || abs(v / scale.major - (v / scale.major).rounded()) < 1e-6
                let crowd = !last && major && offGrid && scale.max - v < scale.major * 0.6
                let lit = f > 0 && at <= f + 1e-4, red = at >= 0.8 - 1e-4
                let color = red ? (lit ? Lane.zone : Lane.zone.opacity(0.55)) : lit ? Lane.color(lane, at) : theme.muted.opacity(0.42)
                var line = Path(); line.move(to: pt(at, major ? 122 : 131)); line.addLine(to: pt(at, 141))
                ctx.stroke(line, with: .color(color), style: StrokeStyle(lineWidth: (major ? 3 : 1.5) * k, lineCap: .round))
                if major && !crowd {
                    // 0 and the full-scale number sit past the ends of the scale, in the corners of the opening.
                    let end = at < 1e-6 ? -1.0 : at > 1 - 1e-6 ? 1.0 : 0
                    ctx.draw(Text(format(v)).font(.system(size: max(9, 18 * k), weight: .semibold)).monospacedDigit()
                                .foregroundStyle(red ? Lane.zone : theme.ink.opacity(0.74)),
                             at: pt(at, end != 0 ? 126 : 100, end * 10))
                }
            }
            // Every account's own burn as a small mark in its tool's colour on the rim, pointing in.
            for m in multi {
                let a = Lane.angle(m.value / scale.max) * .pi / 180
                func p(_ r: Double, _ d: Double) -> CGPoint { CGPoint(x: c.x + r * k * cos(a + d), y: c.y + r * k * sin(a + d)) }
                var tri = Path(); tri.addLines([p(137, 0), p(157, 0.045), p(157, -0.045)]); tri.closeSubpath()
                ctx.fill(tri, with: .color(Tool.color(m.kind)))
                ctx.stroke(tri, with: .color(theme.background), lineWidth: 1.5 * k)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The pointer riding the rim (r 104–148 of the 340-unit face), pointing right; rotation turns it to the reading.
struct RimPointer: Shape {
    func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height), k = side / 340, c = CGPoint(x: rect.midX, y: rect.midY)
        func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: c.x + (x - 170) * k, y: c.y + (y - 170) * k) }
        return Path { p in p.addLines([at(276, 166), at(318, 168.8), at(318, 171.2), at(276, 174)]); p.closeSubpath() }
    }
}

/// A seven-segment display that draws only its lit cells (speed.js seg7 with center1): a lone 1 sits in the middle of
/// its cell, a decimal point lights between cells, the unit letter stands beside them.
struct SegDisplay: View {
    var cells: Display.Cells
    var color: Color
    var height: CGFloat
    var glow = true

    var body: some View {
        let h = height, w = h * 0.55, gap = h * 0.15, t = h * 0.115, room = t * 1.2
        let marks = cells.dp.map { [$0] } ?? []
        let n = cells.cells.count, slant = tan(9 * Double.pi / 180), skew = h * slant
        let unitSize = h * 0.46, uw = cells.unit.isEmpty ? 0 : gap + unitSize * 0.82
        func at(_ i: Int) -> CGFloat { CGFloat(i) * (w + gap) + room * CGFloat(marks.filter { $0 < i }.count) }
        let width = CGFloat(max(0, n - 1)) * (w + gap) + w + room * CGFloat(marks.count) + uw + skew
        return Canvas { context, _ in
            var ctx = context
            ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: -slant, d: 1, tx: skew, ty: 0))
            for (i, ch) in cells.cells.enumerated() {
                let x = at(i) - (ch == "1" ? w / 2 - t / 2 : 0)
                for key in Segments.lit[ch] ?? "" { ctx.fill(Segments.path(key, width: w, height: h).offsetBy(dx: x, dy: 0), with: .color(color)) }
            }
            for i in marks {
                let d = t * 1.05, x = at(i) + w + (gap + room - d) / 2
                ctx.fill(Path(roundedRect: CGRect(x: x, y: h - d, width: d, height: d), cornerRadius: d * 0.22), with: .color(color))
            }
            if !cells.unit.isEmpty {
                ctx.draw(Text(cells.unit).font(.system(size: unitSize, weight: .bold)).italic().foregroundStyle(color),
                         at: CGPoint(x: at(n - 1) + w + gap, y: h), anchor: .bottomLeading)
            }
        }
        .frame(width: width, height: h)
        .shadow(color: glow ? color.opacity(0.5) : .clear, radius: h * 0.06)
        .accessibilityHidden(true)
    }
}

/// The odometer's and the range's dark plate, in both themes (cluster.css .cl-led on the drum face); em is the
/// display's font size. The range's plate takes a red edge when the limit runs out before the reset.
struct DrumPlate: ViewModifier {
    var em: CGFloat
    var early = false
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, em * 0.3).padding(.vertical, em * 0.2)
            .background(Lane.rgb(0x0a0d0f), in: RoundedRectangle(cornerRadius: em * 0.45))
            .overlay(RoundedRectangle(cornerRadius: em * 0.45).stroke(early ? Lane.rgb(0x801e18) : Lane.rgb(0x1d2328)))
    }
}

/// One drum wheel in its own shaded window (cluster.css .cl-wheels[data-face=drum]): the digit at its turn and, while it
/// turns, the next one coming from below. dash, when given, is the strip's place of the dash (the range's). The
/// odometer's other faces turn the same wheel without its window: printed digits (print) or lit segments (led).
struct DrumWheel: View, @preconcurrency Animatable {
    static let ink = Lane.rgb(0xeef2f4), comma = Lane.rgb(0x8a949b)
    static let shade = LinearGradient(stops: [.init(color: .black, location: 0), .init(color: Lane.rgb(0x1d2226), location: 0.22),
                                              .init(color: Lane.rgb(0x2a3034), location: 0.5), .init(color: Lane.rgb(0x1d2226), location: 0.78),
                                              .init(color: .black, location: 1)], startPoint: .top, endPoint: .bottom)
    var turn: Double
    var em: CGFloat
    var dash: Int? = nil
    var face = "drum"
    var color = DrumWheel.ink
    var animatableData: Double {
        get { turn }
        set { turn = newValue }
    }

    var body: some View {
        let f = em * 1.1, pitch = f * 1.25, base = floor(turn + 1e-6), frac = CGFloat(max(0, turn - base)), i = Int(base)
        let drum = face == "drum", w = f * (face.hasPrefix("print") ? 0.62 : 0.78)
        ZStack {
            ForEach(0..<2, id: \.self) { k in
                let dy = (CGFloat(k) - frac) * pitch
                if dy < pitch {
                    Group {
                        if face.hasPrefix("led") {
                            SegGlyph(digit: Character(String((i + k) % 10)), color: color, height: f * 0.86)
                        } else {
                            Text(i + k == dash ? "-" : String((i + k) % 10)).font(.system(size: f, weight: .semibold)).monospacedDigit().foregroundStyle(Self.ink)
                        }
                    }
                    .frame(width: w, height: pitch).offset(y: dy)
                }
            }
        }
        .frame(width: w, height: pitch)
        .background(drum ? Self.shade : nil)
        .clipShape(RoundedRectangle(cornerRadius: 3))
        .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Color.white.opacity(drum ? 0.05 : 0), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// One digit in lit segments, leaning as the dials' figures do, for the odometer's LED faces.
struct SegGlyph: View {
    var digit: Character
    var color: Color
    var height: CGFloat
    var body: some View {
        Canvas { context, size in
            let h = height, w = h * 0.55, t = h * 0.115, slant = tan(6 * Double.pi / 180)
            var ctx = context
            ctx.translateBy(x: (size.width - w - h * slant) / 2, y: (size.height - h) / 2)
            ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: -slant, d: 1, tx: h * slant, ty: 0))
            // A lone 1 sits in the middle of its cell.
            let x = digit == "1" ? -(w / 2 - t / 2) : 0
            for key in Segments.lit[digit] ?? "" { ctx.fill(Segments.path(key, width: w, height: h).offsetBy(dx: x, dy: 0), with: .color(color)) }
        }
        .shadow(color: color.opacity(0.4), radius: height * 0.06)
    }
}

/// A comma or point between drum wheels, low on the line.
struct DrumMark: View {
    var text: String
    var em: CGFloat
    var color: Color
    var room: CGFloat = -1
    var body: some View {
        Text(text).font(.system(size: em * 1.1, weight: .semibold)).foregroundStyle(color)
            .frame(height: em * 1.1 * 1.25, alignment: .bottom).padding(.horizontal, room).accessibilityHidden(true)
    }
}

/// The total as a car's odometer (cluster.js odometer, drum face): a drum wheel per place, turning up only, from 9 on
/// to 0, over 1.6 seconds every three seconds (OdometerWheels); commas between thousands, no leading zeros. height is
/// the lit display's digit height the odometer stands in for. With Reduce Motion the digits change without turning.
/// Its face is the layout's (cluster.js odoFace): drum, led (lit segments), led0 (with dim leading zeros), print
/// (printed digits) or print0 (printed with dim leading zeros, ten places).
struct Odometer: View {
    var value: Double
    var period: String
    var clock: Date
    let wheels: OdometerWheels
    var height: CGFloat
    var reduceMotion: Bool
    var face = "drum"
    var led = DrumWheel.ink
    @State private var turns: [Double] = []

    var body: some View {
        let em = height / 1.15, n = turns.count, places = face.hasSuffix("0") ? max(10, n) : n
        let ink = face.hasPrefix("led") ? led : DrumWheel.comma
        HStack(spacing: face == "drum" ? 2 : 0) {
            ForEach((0..<places).reversed(), id: \.self) { place in
                if place < places - 1 && (place + 1) % 3 == 0 {
                    DrumMark(text: ",", em: em, color: ink).opacity(place >= n - 1 && places > n ? 0.32 : 1)
                }
                DrumWheel(turn: place < n ? turns[place] : 0, em: em, face: face, color: led).opacity(place >= n ? 0.32 : 1)
            }
        }
        .modifier(DrumPlate(em: em))
        .onAppear { turns = wheels.turns; roll() }
        .onChange(of: clock) { roll() }
        .onChange(of: period) { roll() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.t("Total \(Int64(wheels.shown ?? 0).formatted()) tokens", "합계 \(Int64(wheels.shown ?? 0).formatted()) tokens"))
    }

    private func roll() {
        guard wheels.take(value, period: period, now: clock.timeIntervalSince1970) else { return }
        if reduceMotion || turns.isEmpty { turns = wheels.turns; return }
        withAnimation(.timingCurve(0.22, 0.8, 0.3, 1, duration: 1.6)) { turns = wheels.turns }
    }
}

/// The range on the same drum wheels (cluster.js rangeWheels, RangeWheels): each wheel turns either way to its digit
/// over 1.6 seconds, the point between them; a new shape is set at once.
struct RangeDrum: View {
    var hours: Double?
    var height: CGFloat
    var early: Bool
    var reduceMotion: Bool
    @State private var wheels = RangeWheels()
    @State private var shape: [Character] = []
    @State private var shown: [Double] = []

    var body: some View {
        let em = height / 1.15, wheel = shape.indices.map { i in shape[..<i].filter { $0 != "." }.count }
        HStack(spacing: 2) {
            ForEach(shape.indices, id: \.self) { i in
                if shape[i] == "." {
                    DrumMark(text: ".", em: em, color: DrumWheel.ink, room: 1)
                } else if wheel[i] < shown.count {
                    DrumWheel(turn: shown[wheel[i]], em: em, dash: RangeWheels.dash)
                }
            }
        }
        .modifier(DrumPlate(em: em, early: early))
        .onAppear { roll() }
        .onChange(of: hours) { roll() }
    }

    private func roll() {
        let turns = wheels.take(hours), next = wheels.positions.map(Double.init)
        if !turns || reduceMotion { shape = Array(wheels.shape); shown = next; return }
        withAnimation(.timingCurve(0.22, 0.8, 0.3, 1, duration: 1.6)) { shown = next }
    }
}

/// CPU or memory on a small half dial: the token lane's colours along it, a white needle, the percent under it.
struct TempGauge: View {
    var label: String
    var value: Double?
    var theme: QuickTheme
    var reduceMotion: Bool
    var body: some View {
        let f = min(1, max(0, (value ?? 0) / 100))
        VStack(spacing: 2) {
            Text(label).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.muted)
            TempArc(fraction: f).frame(width: 50, height: 29).animation(reduceMotion ? nil : .spring(response: 1.1, dampingFraction: 0.6), value: f)
            Text(value.map { "\(Int($0.rounded()))%" } ?? "—").font(.system(size: 12.5, weight: .semibold)).monospacedDigit()
                .foregroundStyle((value ?? 0) >= 85 ? Lane.zone : theme.ink)
        }
        .accessibilityElement(children: .ignore).accessibilityLabel("\(label) \(value.map { "\(Int($0.rounded()))%" } ?? "—")")
    }
}
struct TempArc: View, @preconcurrency Animatable {
    var fraction: Double
    var animatableData: Double {
        get { fraction }
        set { fraction = newValue }
    }
    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height - 3), r = min(size.width / 2 - 3, size.height - 6)
            func arc(_ to: Double) -> Path { Path { p in p.addArc(center: c, radius: r, startAngle: .degrees(180), endAngle: .degrees(to), clockwise: false) } }
            let shade = GraphicsContext.Shading.linearGradient(Gradient(stops: Lane.token.map { .init(color: $0.1, location: $0.0) }),
                                                               startPoint: CGPoint(x: c.x - r, y: 0), endPoint: CGPoint(x: c.x + r, y: 0))
            var faint = ctx; faint.opacity = 0.2
            faint.stroke(arc(360), with: shade, style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
            if fraction > 0 { ctx.stroke(arc(180 + 180 * fraction), with: shade, style: StrokeStyle(lineWidth: 4.5, lineCap: .round)) }
            let a = (180 + 180 * fraction) * .pi / 180, tip = CGPoint(x: c.x + cos(a) * (r - 4), y: c.y + sin(a) * (r - 4))
            ctx.stroke(Path { p in p.move(to: c); p.addLine(to: tip) }, with: .color(.white), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 3, y: c.y - 3, width: 6, height: 6)), with: .color(.white))
        }
    }
}

/// The period as a drum turned sideways, like a watch crown: 200 faint straight ridges ride the barrel, the periods sit
/// on it and the one in the lens is in use. Drag it, or press a period, and it springs to the nearest stop.
struct PeriodDrum: View {
    @Binding var period: Period
    var theme: QuickTheme
    @State private var p: Double = 0
    @State private var start: Double?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let items = Period.allCases

    var body: some View {
        GeometryReader { geo in
            DrumFace(p: p, items: items, theme: theme, select: select).frame(width: geo.size.width, height: geo.size.height)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 4).onChanged { v in
                    if start == nil { start = p }
                    p = min(Double(items.count) - 0.6, max(-0.4, start! - Double(v.translation.width) / Double(geo.size.width * 0.17)))
                }.onEnded { _ in
                    start = nil; select(Int(p.rounded()))
                })
        }
        .frame(height: 50)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.line))
        .onAppear { p = Double(items.firstIndex(of: period) ?? 0) }
        .onChange(of: period) { if start == nil { turn(to: items.firstIndex(of: period) ?? 0) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.t("Time window", "기간")).accessibilityValue(period.label)
        .accessibilityAdjustableAction { direction in
            let i = (items.firstIndex(of: period) ?? 0) + (direction == .increment ? 1 : -1)
            select(i)
        }
        .accessibilityIdentifier("period-drum")
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
struct DrumFace: View, @preconcurrency Animatable {
    var p: Double
    var items: [Period]
    var theme: QuickTheme
    var select: (Int) -> Void
    var animatableData: Double {
        get { p }
        set { p = newValue }
    }
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack {
                LinearGradient(stops: [.init(color: Lane.rgb(0x040506), location: 0), .init(color: Lane.rgb(0x1b2024), location: 0.18),
                                       .init(color: Lane.rgb(0x3a4248), location: 0.5), .init(color: Lane.rgb(0x1b2024), location: 0.82),
                                       .init(color: Lane.rgb(0x040506), location: 1)], startPoint: .leading, endPoint: .trailing)
                // The ridges, strongest at the top and bottom edges and quiet behind the words.
                Canvas { ctx, size in
                    let turn = p * 24, n = 200
                    for j in 0..<n {
                        let a = ((Double(j) * 360 / Double(n) - turn).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180
                        guard abs(a) <= 86 else { continue }
                        let r = a * .pi / 180, cs = cos(r), x = size.width / 2 + size.width / 2 * sin(r), wd = max(0.16, 2 * cs)
                        let alpha = (0.25 + 0.75 * cs) * 0.3
                        let shade = GraphicsContext.Shading.linearGradient(Gradient(stops: [.init(color: .white.opacity(alpha), location: 0), .init(color: .white.opacity(alpha * 0.28), location: 0.4),
                                                                                           .init(color: .white.opacity(alpha * 0.28), location: 0.6), .init(color: .white.opacity(alpha), location: 1)]),
                                                                          startPoint: .zero, endPoint: CGPoint(x: 0, y: size.height))
                        ctx.fill(Path(CGRect(x: x - wd / 2, y: 0, width: wd, height: size.height)), with: shade)
                    }
                }
                LinearGradient(stops: [.init(color: .white.opacity(0.1), location: 0), .init(color: .clear, location: 0.3), .init(color: .clear, location: 0.7),
                                       .init(color: .black.opacity(0.35), location: 1)], startPoint: .top, endPoint: .bottom)
                LinearGradient(stops: [.init(color: .black.opacity(0.75), location: 0), .init(color: .clear, location: 0.22), .init(color: .clear, location: 0.78),
                                       .init(color: .black.opacity(0.75), location: 1)], startPoint: .leading, endPoint: .trailing)
                RoundedRectangle(cornerRadius: 8).fill(Color.black.opacity(0.45)).frame(width: 78, height: h - 14)
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    let d = Double(i) - p, a = d * 24, far = abs(a) > 78, r = min(72, max(-72, a)), on = abs(d) < 0.5
                    Text(item.label).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(on ? theme.accent : theme.muted)
                        .shadow(color: .black.opacity(0.9), radius: 1, y: 1)
                        .rotation3DEffect(.degrees(r), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
                        .offset(x: w * 0.42 * sin(r * .pi / 180))
                        .opacity(far ? 0 : pow(max(0, cos(r * .pi / 180)), 1.2))
                        .onTapGesture { if !far { select(i) } }
                }
                RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.55)).frame(width: 78, height: h - 14).allowsHitTesting(false)
            }
        }
    }
}
