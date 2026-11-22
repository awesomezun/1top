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
    static func order(_ kind: String) -> Int { ["Claude", "Codex", "GLM", "Antigravity", "Aside", "Devin"].firstIndex(of: kind) ?? 9 }
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
struct MiniGauge: View {
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

/// The dashboard tab, in one of the layout's two presets (customizing-spec_v1.2.2): '대시보드' (the period, token use,
/// account limits, CPU and memory and the sessions, in the layout's order, sizes and counts) or '계기판' (ClusterCard).
/// With the phone's tabs apart, each tab keeps its own preset; as one home tab, the header's gauge switches between
/// them and the layout remembers the choice. The gear at the top right of what the preset shows first, or a long
/// press on an object, customizes the preset on screen.
struct QuickView: View {
    typealias Item = ScreenLayout.Item
    @Environment(AppModel.self) private var model
    @Environment(LayoutStore.self) private var layouts
    @Environment(\.colorScheme) private var scheme
    @AppStorage("weeklyTokensMode") private var tokensChosen = false
    /// The preset this tab always shows (the tabs apart), or nil for the one home tab with its quick switch.
    var fixed: ScreenLayout.Preset?
    @State private var cz: CustomizeSession
    /// session: the editor's state from outside (the geometry checks read its frames).
    init(fixed: ScreenLayout.Preset? = nil, session: CustomizeSession? = nil) {
        self.fixed = fixed
        _cz = State(initialValue: session ?? CustomizeSession(preset: fixed ?? .dashboard))
    }
    private var preset: ScreenLayout.Preset { fixed ?? layouts.layout.preset }
    /// The cluster (계기판) in place of the token card, weekly limits and resources.
    private var showCluster: Bool { preset == .cluster }
    private var arrangement: ScreenLayout.Arrangement { layouts.layout.presets[preset] }
    private func opts(_ id: Item) -> ScreenLayout.Options { arrangement.opts[id] ?? ScreenLayout.options(id) }
    /// Weekly % needs the collector's estimates; a collector that does not send them shows tokens.
    private var tokensMode: Bool { tokensChosen || !model.sessions.contains(where: \.hasEstimate) }
    @State private var detail: Session?
    /// Workspace (connection, account, computers, theme and language), opened from the header.
    @State private var workspace = false
    @State private var headerHeight: CGFloat = 48
    /// The header's Workspace button, shared with Android's: an account's circle, never a gear, which is
    /// customizing's.
    static let workspaceSymbol = "person.crop.circle"
    @State private var request: ControlRequest?
    @State private var narrow = false
    @Environment(\.verticalSizeClass) private var verticalSize
    @State private var themeFrame = CGRect.zero
    private static let paceColumn: CGFloat = 54, valueColumn: CGFloat = 70
    private var theme: QuickTheme { QuickTheme(light: scheme == .light) }
    /// The phone on its side with the cluster open: the period and the cluster alone fill the screen.
    private var sideways: Bool { showCluster && verticalSize == .compact }

    var body: some View {
        scroller
            // The header stays at the top like a navigation bar; content scrolling under it and the
            // status bar fades behind the system scroll edge effect instead of showing through. While customizing, the
            // editor's bar takes its place at the same height.
            .safeAreaBar(edge: .top) { topBar }
            .scrollEdgeEffectStyle(.hard, for: .top)
            .overlay(alignment: .bottom) { CustomizeHiddenChip(session: cz, store: layouts, theme: theme).padding(.bottom, 14) }
            .toolbar(sideways ? .hidden : .automatic, for: .tabBar)
            .statusBarHidden(sideways)
            // Only the cluster turns on its side; every other screen stays upright.
            .onAppear { Orientation.allowSideways(showCluster) }
            .onDisappear { Orientation.allowSideways(false); cz.end() }
            .onChange(of: showCluster) { Orientation.allowSideways(showCluster) }
            .onChange(of: preset, initial: true) { cz.preset = preset }
            .onChange(of: sideways) { if sideways { cz.end() } }
            .background(theme.background.ignoresSafeArea())
            .foregroundStyle(theme.ink)
            .refreshable { if model.connection != .demo && !cz.editing { model.connect() } }
            .sheet(item: $detail) { SessionDetail(session: $0).detailSource("row", $0.id) }
            .sheet(isPresented: customizing) { customizeSheet }
            .sheet(isPresented: $workspace) { SettingsView(close: { workspace = false }) }
            .controlConfirmation($request)
            #if DEBUG
            // Screenshot runs open the editor directly: -czEdit YES, then -czSelect alerts, -czList YES or -czGallery odo.
            .task {
                let d = UserDefaults.standard
                guard d.bool(forKey: "czEdit") else { return }
                try? await Task.sleep(for: .seconds(1.5))
                cz.begin()
                if let id = d.string(forKey: "czSelect").flatMap(Item.init) { cz.tap(id) }
                if d.bool(forKey: "czList") { cz.list() }
                if let id = d.string(forKey: "czGallery").flatMap(Item.init) { cz.tap(id); try? await Task.sleep(for: .seconds(0.6)); cz.path = [id] }
            }
            #endif
    }

    private var scroller: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    if !sideways { ConnectionNotice().padding(.horizontal, 14).padding(.bottom, 10) }
                    if showCluster { cluster } else { dashboard }
                }
                .overlay(alignment: .topLeading) { if cz.editing { CustomizeMarks(session: cz, store: layouts, theme: theme) } }
                .coordinateSpace(.named(CustomizeSession.space))
                .padding(.top, sideways ? 10 : 0).padding(.bottom, sideways ? 0 : 24)
            }
            .scrollIndicators(.hidden)
            .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, top in cz.scrollTop = top }
            // A picked object comes into view above its sheet.
            .onChange(of: cz.selected) {
                guard let id = cz.selected else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) { proxy.scrollTo(id, anchor: UnitPoint(x: 0.5, y: 0.28)) }
            }
        }
    }

    /// The cluster holds its own period control and, in its window, the sessions; its gear sits in the empty corner
    /// beside the right dial.
    private var cluster: some View {
        ClusterCard(theme: theme, landscape: sideways, layout: arrangement, cz: sideways ? nil : cz, open: { detail = $0 })
            .overlay(alignment: .topTrailing) { if !sideways { CustomizeGear(session: cz, theme: theme).padding(.top, 7).padding(.trailing, 7) } }
            .padding(.horizontal, sideways ? 8 : 14).padding(.bottom, 12)
    }

    /// While customizing the editor's bar stands in the header's place at its height, so nothing below moves; the
    /// header itself leaves, so its glass is not drawn unseen.
    @ViewBuilder private var topBar: some View {
        if !sideways {
            Group {
                if cz.editing {
                    CustomizeBar(session: cz, theme: theme, choose: chooser).frame(height: headerHeight)
                } else {
                    header.onGeometryChange(for: CGFloat.self) { $0.size.height } action: { headerHeight = $0 }
                }
            }
            .background(theme.background.opacity(cz.editing ? 0.94 : 0.01))
        }
    }

    private var customizing: Binding<Bool> {
        Binding(get: { cz.sheet != nil }, set: { if !$0 { cz.sheet = nil; cz.selected = nil; cz.path = [] } })
    }
    private var customizeSheet: some View {
        CustomizeSheet(session: cz, store: layouts, theme: theme) { id, shape in
            ClusterCard(theme: theme, layout: shaped(id, shape), preview: id)
        }
        .presentationDetents([.medium, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .presentationBackground(theme.card)
    }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Where both presets live in this one tab, the editor's bar chooses between them too.
    private var chooser: ((ScreenLayout.Preset) -> Void)? {
        guard fixed == nil else { return nil }
        return { choosePreset($0) }
    }
    /// The quick switch and the editor's preset choice keep the preset in the layout.
    private func choosePreset(_ p: ScreenLayout.Preset) {
        cz.selected = nil; cz.sheet = nil; cz.path = []
        layouts.change { $0.preset = p }
    }
    /// The cluster preset with one object in another shape, for the gallery.
    private func shaped(_ id: Item, _ shape: String) -> ScreenLayout.Arrangement {
        var a = layouts.layout.presets.cluster
        a.opts[id, default: ScreenLayout.options(id)].shape = shape
        return a
    }

    // MARK: The dashboard preset: the period on top, then its sections in the layout's order
    /// The first section shown under the period carries the gear.
    private var first: Item { arrangement.order.first { $0 != .periods && !arrangement.hidden.contains($0) } ?? .tokens }
    private var gear: some View { CustomizeGear(session: cz, theme: theme).padding(.vertical, -6) }

    @ViewBuilder private var dashboard: some View {
        @Bindable var model = model
        GlassSegments.periods($model.period).padding(4).czPart(.periods, cz).padding(.horizontal, 10).padding(.bottom, 6)
        VStack(spacing: 4) {
            ForEach(arrangement.order.filter { $0 != .periods && !arrangement.hidden.contains($0) }, id: \.self) { id in
                switch id {
                case .tokens:
                    Zoom(k: [0.7, 0.85, 1][opts(.tokens).size ?? 2]) { tokenSection.padding(.horizontal, 8).padding(.vertical, 6) }
                        .czPart(.tokens, cz).padding(.horizontal, 8)
                case .weekly: weeklyCard.padding(.horizontal, 6).padding(.vertical, 6).czPart(.weekly, cz).padding(.horizontal, 8)
                case .resources: resources.padding(.horizontal, 8).padding(.vertical, 8).czPart(.resources, cz).padding(.horizontal, 8)
                default: sessionList.padding(.top, 4).czPart(.sessions, cz, enters: false)
                }
            }
        }
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

    /// The computers in view for the header: the chosen computer's name, or all of them, in a long
    /// and a short form; the chip shows the long one when it fits.
    private func scope(short: Bool) -> String {
        if let selected = model.selectedDevice { return selected.name }
        if model.devices.count == 1 { return model.devices[0].name }
        return short ? L.t("All \(model.devices.count)", "전체 \(model.devices.count)")
            : L.t("All computers", "모든 컴퓨터") + " · \(model.devices.count)"
    }
    /// What the chip shows: the scope while reports flow, otherwise the connection state. The full
    /// state stays in the chip's accessibility label.
    private func chipText(short: Bool) -> String {
        switch model.connection {
        case .live, .demo: scope(short: short)
        case .connecting: L.t("Connecting", "연결 중")
        case .offline: L.t("Offline", "오프라인")
        case .restricted: L.t("Access required", "권한 필요")
        case .signedOut: L.t("Sign-in required", "로그인 필요")
        }
    }

    /// Logo on the left; on the right, in one glass group: the computers in view, a one-tap theme
    /// toggle, a one-tap language choice, and more. On narrow iPhones the logo text goes first.
    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform.path").font(.system(size: 17, weight: .semibold)).foregroundStyle(theme.accent)
            if !narrow { Text("1top").font(.system(size: 17, weight: .semibold)).fixedSize() }
            Spacer(minLength: 4)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    Menu {
                        ComputerPicker()
                        if !lastReport.isEmpty { Text(lastReport) }
                    } label: {
                        HStack(spacing: 5) {
                            Circle().fill(fresh ? theme.accent : theme.amber).frame(width: 6, height: 6)
                            ViewThatFits(in: .horizontal) {
                                ForEach([false, true], id: \.self) { short in
                                    Text(chipText(short: short)).font(.system(size: 11.5)).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.tail)
                                }
                            }
                        }
                    }
                    .buttonStyle(.glass).controlSize(.small)
                    .accessibilityLabel(connectionLabel)
                    .accessibilityIdentifier("connection")
                    .accessibilityValue(lastReport)
                    .layoutPriority(-1)
                    // The cluster view, one tap each way, where both presets live in this one tab.
                    if fixed == nil {
                    Button { choosePreset(showCluster ? .dashboard : .cluster) } label: {
                        Image(systemName: "gauge.with.needle").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(showCluster ? theme.accent : theme.ink).accessibilityHidden(true)
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                    .accessibilityLabel(showCluster ? L.t("Standard view", "기본 보기") : L.t("Cluster view", "계기판 보기"))
                    .accessibilityIdentifier("cluster-toggle")
                    .accessibilityAddTraits(showCluster ? .isSelected : [])
                    .fixedSize()
                    }
                    Button { toggleTheme() } label: {
                        Image(systemName: scheme == .dark ? "moon.fill" : "sun.max.fill").font(.system(size: 13, weight: .semibold))
                            .accessibilityHidden(true)
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { themeFrame = $0 }
                    .accessibilityLabel(L.t("Toggle theme", "테마 전환"))
                    .accessibilityIdentifier("theme-toggle")
                    .accessibilityValue(scheme == .dark ? "dark" : "light")
                    .fixedSize()
                    LanguageButton(identifier: "header-language")
                    Menu {
                        Button(L.t("Reconnect now", "지금 다시 연결")) { model.connect() }.disabled(model.connection == .demo)
                        Button(tokensChosen ? L.t("Show sessions as weekly limit %", "세션을 주간 한도 %로 보기") : L.t("Show sessions as tokens", "세션을 토큰으로 보기")) { tokensChosen.toggle() }
                        if model.connection == .demo && model.token == nil { Button(L.t("Leave demo", "데모 끝내기")) { model.leaveDemo() } }
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 13, weight: .semibold))
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                    .accessibilityLabel(L.t("More", "더 보기")).accessibilityIdentifier("more-menu")
                    .fixedSize()
                    // Workspace, at the right end: no longer a tab.
                    Button { workspace = true } label: {
                        Image(systemName: Self.workspaceSymbol).font(.system(size: 14, weight: .semibold)).accessibilityHidden(true)
                    }
                    .buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.small)
                    .accessibilityLabel(L.t("Workspace", "워크스페이스")).accessibilityIdentifier("workspace-button")
                    .fixedSize()
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 10)
        .onGeometryChange(for: Bool.self) { $0.size.width < 390 } action: { narrow = $0 }
    }

    /// Dark and light in one tap, from what is on screen now (a System setting flips to the other
    /// side). The System choice itself lives in Workspace settings.
    private func toggleTheme() {
        let next: Appearance = scheme == .dark ? .light : .dark
        Reveal.perform(at: CGPoint(x: themeFrame.midX, y: themeFrame.midY)) { model.appearance = next }
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
                if first == .tokens { gear }
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

    // The period's tokens by AI model (tool colour), largest first; past four, the rest folds into one.
    private func modelSlices() -> (slices: [UsageSlice], total: Double) {
        let usage = model.modelShares, rows = usage.rows, total = usage.total
        let shown = rows.count <= 4 ? rows : Array(rows.prefix(3))
        var seen: [String: Int] = [:]
        var slices = shown.map { row -> UsageSlice in
            let kind = row.kind ?? "", index = seen[kind, default: 0]; seen[kind] = index + 1
            // A model the computer could not name; without a tool, tokens from a computer that sends no split.
            let name = row.model ?? (usage.split ? L.t("No model info", "모델 정보 없음") : Tool.name(kind))
            return UsageSlice(id: kind + "|" + (row.model ?? ""), name: name, detail: row.kind.map(Tool.name) ?? L.t("Computers without a split", "내역 없는 컴퓨터"),
                              kind: row.kind, value: row.tokens, shade: row.kind == nil ? 1 : [1, 0.68, 0.46][min(index, 2)])
        }
        let counted = rows.reduce(0) { $0 + $1.tokens }
        let rest = total - shown.reduce(0) { $0 + $1.tokens }, others = rows.count - shown.count
        if total > 0, rest > total * 0.005 {
            // Only older collectors leave the ended sessions' tokens out of the rows.
            let ended = !usage.split && total - counted > total * 0.005
            slices.append(UsageSlice(id: "__rest__", name: others > 0 ? L.t("Other models", "기타 모델") : L.t("Ended sessions", "종료된 세션"),
                                     detail: others > 0 ? L.t("\(others) more", "\(others)개") + (ended ? " · " + L.t("incl. ended sessions", "종료 세션 포함") : "")
                                         : L.t("Not in the list", "목록에 없는 세션"), kind: nil, value: rest, shade: 1))
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
        // As many tiles as the layout's count (all of them when it has none).
        let rows = model.quotas, want = opts(.weekly).count.flatMap { if case .value(let v) = $0 { v } else { nil } }
        let shown = Quota.pickTiles(rows, count: want ?? rows.count)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                // A 5-hour or monthly tile among them makes the heading the providers' shared "계정 한도".
                Text(shown.allSatisfy { $0.representativeWindow?.isWeekly == true } ? L.t("Weekly limits", "주간 한도") : L.t("Account limits", "계정 한도"))
                    .font(.system(size: 12.5, weight: .semibold))
                Text(L.t("100% per account", "계정별 100%")).font(.system(size: 11.5)).foregroundStyle(theme.muted)
                Spacer()
                if first == .weekly { gear }
            }.padding(.horizontal, 2)
            if rows.isEmpty {
                Text(L.t("Connect subscription accounts in 1top on your computer.", "컴퓨터의 1top에서 구독 계정을 연결하면 표시됩니다.")).font(.system(size: 11.5)).foregroundStyle(theme.muted)
            } else {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                    ForEach(shown) { weeklyTile($0).czProbe("tile-\($0.id)", cz) }
                }
            }
        }
        .onChange(of: shown.count, initial: true) { cz.shown[.weekly] = shown.count }
    }

    private func weeklyTile(_ q: Quota) -> some View {
        // A 5-hour or monthly window, or an unverified pool, shows its value without a weekly burn rate.
        let w = q.representativeWindow, weekly = w?.isWeekly == true, color = Tool.color(q.kind)
        let rate = fresh && !q.stale && q.burnAllowed ? q.weekly?[model.period.rawValue]?.burnPerHour : nil
        // An Agy pool's long name sits under the tool name instead of on a chip. Where no weekly burn rate
        // is measured, the window's own name takes the rate's place; an old value keeps it on the left.
        let handle = (q.stale && !weekly && w != nil ? w!.name + " · " : "") + (q.pool ?? q.handle)
        let end = model.reportEnd, start = end - model.period.seconds
        let points = sparkPoints(q.usagePoints, start: start, end: end)
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Circle().fill(color).frame(width: 6, height: 6).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                // A long tool name and account chip give way before the percentage, so the tile keeps its column.
                Text(Tool.name(q.kind)).font(.system(size: 12.5, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.85)
                if q.pool == nil, let tag = model.accountTag(q.id) { AccountChip(text: tag) }
                Spacer(minLength: 4)
                Text(Format.percent(w?.pct)).font(.system(size: 17, weight: .semibold)).monospacedDigit().fixedSize()
                    .foregroundStyle(q.stale ? theme.muted : theme.ink)
            }
            // Fixed slots keep the small trend line in the same place in every tile.
            HStack(spacing: 6) {
                Text(handle).font(.system(size: 10.5)).foregroundStyle(theme.muted).lineLimit(1).truncationMode(.middle)
                    .frame(width: 78, alignment: .leading)
                WeeklySpark(points: points, start: start, end: end, color: color, faded: q.stale).frame(maxWidth: .infinity).frame(height: 14)
                Text(q.stale ? q.staleLabel : rate.map { Format.percent($0) + L.t("/h", "/시간") } ?? (weekly && q.identityVerified != false ? L.t("Collecting", "수집 중") : w?.name ?? L.t("No value", "값 없음")))
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
                let lead = device.id == list.first?.id && first == .resources
                VStack(alignment: .leading, spacing: 3) {
                    if list.count > 1 {
                        HStack(spacing: 5) {
                            Circle().fill(model.isFresh(device) ? theme.accent : theme.amber).frame(width: 5, height: 5)
                            Text(device.name).font(.system(size: 11.5, weight: .semibold)).lineLimit(1)
                            if !model.isFresh(device) {
                                Text(L.t("Last report ", "마지막 보고 ") + L.time(device.receivedDate)).font(.system(size: 10.5)).foregroundStyle(theme.amber)
                            }
                            if lead { Spacer(minLength: 4); gear }
                        }
                    }
                    HStack(spacing: 18) {
                        resource("CPU", value: device.snapshot?.host?.cpu)
                        resource(L.t("Memory", "메모리"), value: device.snapshot?.host?.memoryPercent)
                        if lead && list.count == 1 { gear }
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
        // As many rows as the layout's count (all of them when it has none).
        let limit = opts(.sessions).count.flatMap { if case .value(let v) = $0 { v } else { nil } }
        let all = model.groups, rows = Array(all.prefix(limit ?? .max))
        let paceScale = niceMaximum(max(1, rows.compactMap(pace).max() ?? 0))
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(L.t("Sessions", "세션")).font(.system(size: 12.5, weight: .semibold))
                Text("\(all.count)").font(.system(size: 11.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.muted)
                    .padding(.horizontal, 6).frame(height: 18).background(theme.raised, in: RoundedRectangle(cornerRadius: 5))
                HStack(spacing: 5) {
                    if fresh { StatusGlyph(status: "working") } else { Circle().fill(theme.amber).frame(width: 6, height: 6) }
                    Text(fresh ? L.t("Working \(all.filter(\.isWorking).count)", "작업 중 \(all.filter(\.isWorking).count)") : L.t("Last record", "마지막 기록"))
                }.font(.system(size: 11.5, weight: .medium)).foregroundStyle(fresh ? theme.ink : theme.amber).padding(.leading, 4)
                Spacer(minLength: 4)
                Text(tokensMode ? L.t("Tokens", "토큰") : L.t("Weekly limit used", "주간 한도 사용량")).font(.system(size: 10.5)).foregroundStyle(theme.muted)
                    .fixedSize().frame(width: Self.valueColumn, alignment: .trailing)
                if first == .sessions { gear }
            }
            .padding(.leading, 16).padding(.trailing, first == .sessions ? 8 : 16).padding(.vertical, 8)
            .overlay(alignment: .top) { Rectangle().fill(theme.line).frame(height: 1) }
            // The rows keep their long press for their menus; the heading enters customizing.
            .contentShape(Rectangle()).czEnter(cz)
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
        .onChange(of: rows.count, initial: true) { cz.shown[.sessions] = rows.count }
    }

    private func sessionRow(_ g: SessionGroup, paceScale: Double) -> some View {
        let s = g.root, burn = pace(g)
        let hub = g.isWorking ? theme.segmentOn : s.status == "waiting" ? theme.amber : theme.dim
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
                    if let tag = model.accountTag(model.account(of: s)) { AccountChip(text: tag) }
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

/// A view drawn at a fraction of its size, taking only that much room (the web's CSS zoom): the token section's sizes.
struct Zoom: Layout {
    var k: CGFloat
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let child = subviews.first else { return .zero }
        let s = child.sizeThatFits(ProposedViewSize(width: proposal.width.map { $0 / k }, height: proposal.height.map { $0 / k }))
        return CGSize(width: s.width * k, height: s.height * k)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(width: bounds.width / k, height: bounds.height / k))
    }
}
