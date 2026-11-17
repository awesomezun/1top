import SwiftUI

/// The cluster's window (cluster.js cl-window): the period drum over seven pages, one at a time — running sessions,
/// the token flow, every account's limit, the usage map, the heatmaps, goals and the computers' resources. A session
/// row picks that session for the burn dial and its ↗ opens the session; an account card picks the account; pressing
/// either again lets go. Records the relay does not carry (the heatmaps, the project trend) say so, as the dashboard
/// does in a remote workspace. The layout picks the period control's shape, which tabs the window shows and in what
/// order, and its size (the page's height); the period control and the window are two objects to customize.
struct ClusterWindow: View {
    @Environment(AppModel.self) private var model
    var r: ClusterReadings
    var theme: QuickTheme
    var width: CGFloat
    var pageHeight: CGFloat
    /// The period's tokens as the odometer counts them, for the token flow page.
    var total: Double
    /// Tighter spacing in the middle column on its side.
    var compact = false
    /// The tabs to show, in their order.
    var tabs: [ScreenLayout.Mode] = ScreenLayout.Mode.allCases
    var periodShape = "auto"
    /// The editor over the period control and the window while customizing.
    var cz: CustomizeSession? = nil
    @Binding var mode: String
    @Binding var pick: ClusterReadings.Pick?
    var only: String?
    var open: (Session) -> Void

    /// Read on each draw, so the names follow the language chosen.
    static var modes: [(key: String, name: String)] {
        [("sessions", L.t("Sessions", "세션")), ("flow", L.t("Token flow", "토큰 흐름")), ("weekly", L.t("Limits", "한도")), ("map", L.t("Usage map", "사용량 맵")),
         ("heat", L.t("Heatmap", "히트맵")), ("goals", L.t("Goals", "목적지")), ("system", L.t("Resources", "리소스"))]
    }
    private var caption: String { L.t("Last \(model.period.label)", "최근 \(model.period.label)") }
    private var inner: CGFloat { width - (compact ? 16 : 20) }

    /// The tabs shown, and the page on screen: the one last chosen, or the first shown when that one is left out.
    private var shown: [(key: String, name: String)] { tabs.compactMap { t in Self.modes.first { $0.key == t.rawValue } } }
    private var current: String { Self.page(mode, tabs: tabs) }
    /// The page that opens: the one last chosen while its tab shows, else the first tab chosen (the sessions only when
    /// they are among them).
    static func page(_ mode: String, tabs: [ScreenLayout.Mode]) -> String {
        tabs.contains { $0.rawValue == mode } ? mode : tabs.first?.rawValue ?? "sessions"
    }

    var body: some View {
        @Bindable var model = model
        VStack(spacing: compact ? 6 : 8) {
            PeriodControl(shape: periodShape, period: $model.period, theme: theme).czPart(.periods, cz)
            VStack(spacing: compact ? 6 : 8) {
                tabRow
                ScrollView { page.frame(maxWidth: .infinity, alignment: .top).padding(.bottom, 6) }
                    .scrollIndicators(.hidden)
                    .frame(height: pageHeight)
            }
            .padding(compact ? 8 : 10)
            .background(theme.background, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(theme.line))
            .czPart(.window, cz)
        }
        .frame(width: width)
    }

    // MARK: Tabs: across the window when they fit, else scrolling sideways
    private var tabRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 2) { ForEach(shown, id: \.key) { tab($0.key, $0.name).frame(maxWidth: .infinity) } }.padding(3)
            ScrollView(.horizontal) { HStack(spacing: 2) { ForEach(shown, id: \.key) { tab($0.key, $0.name) } }.padding(3) }
                .scrollIndicators(.hidden)
        }
        .background(theme.ink.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain).accessibilityLabel(L.t("Display", "표시창"))
    }
    private func tab(_ key: String, _ name: String) -> some View {
        let on = current == key
        return Button { mode = key } label: {
            Text(name).font(.system(size: 11, weight: .semibold)).lineLimit(1).fixedSize()
                .foregroundStyle(on ? theme.ink : theme.muted)
                .padding(.horizontal, 7).frame(maxWidth: .infinity).frame(height: 28)
                .background(on ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 7))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityIdentifier("cluster-mode-\(key)")
    }

    @ViewBuilder private var page: some View {
        switch current {
        case "flow": flow
        case "weekly": weekly
        case "map": usageMap
        case "heat": note(L.t("Not available in the remote workspace yet", "원격 워크스페이스에서는 아직 지원하지 않습니다"),
                          L.t("Heatmap records are in the 1top app on each computer.", "히트맵 기록은 각 컴퓨터의 1top 앱에서 볼 수 있습니다."))
        case "goals": goals
        case "system": system
        default: sessions
        }
    }

    private func note(_ title: String, _ detail: String = "") -> some View {
        VStack(spacing: 4) {
            Text(title).font(.system(size: 12)).foregroundStyle(theme.muted)
            if !detail.isEmpty { Text(detail).font(.system(size: 11)).foregroundStyle(theme.dim) }
        }
        .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.vertical, 16)
    }

    // MARK: Sessions: each tree's burn on a small gauge, its state, tool and effort, and its share of the limit
    private var sessions: some View {
        LazyVStack(spacing: 2) {
            if r.rows.isEmpty { note(only == nil ? L.t("No sessions are working.", "작업 중인 세션이 없습니다.") : L.t("No matching sessions.", "해당하는 세션이 없습니다.")) }
            ForEach(r.rows) { sessionRow($0) }
        }
    }
    private func sessionRow(_ row: ClusterReadings.Row) -> some View {
        let s = row.group.root, color = Tool.color(s.kind), on = r.speed.session == row.id
        let hub = row.state == "working" ? theme.segmentOn : row.state == "waiting" ? theme.amber : theme.dim
        let value = row.estimate.map { $0 < 0.1 ? Format.percent($0) : "≈" + Format.percent($0) } ?? Format.tokens(row.tokens) + " tokens"
        return HStack(spacing: 8) {
            VStack(spacing: 1) {
                MiniGauge(value: row.burn, scale: r.speed.max, color: color, hub: hub, theme: theme)
                Text(row.burn.map { ClusterReadings.reading($0) + L.t("%/h", "%/시간") } ?? "—").font(.system(size: 9.5)).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.8).foregroundStyle(theme.muted)
            }
            .frame(width: 56)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    StatusGlyph(status: row.state)
                    Text(s.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.ink).lineLimit(1)
                }
                HStack(spacing: 6) {
                    // The tool in its own colour, then the effort it runs at.
                    Text(Tool.name(s.kind)).fontWeight(.semibold).foregroundStyle(color)
                    if let effort = s.effort, !effort.isEmpty, inner >= 280 {
                        Text(effort).foregroundStyle(theme.muted).padding(.horizontal, 5).background(theme.raised, in: RoundedRectangle(cornerRadius: 5))
                    }
                }
                .font(.system(size: 11)).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(value).font(.system(size: 12.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.ink).lineLimit(1)
            Button { open(s) } label: {
                Text("↗").font(.system(size: 14)).foregroundStyle(theme.dim).frame(width: 22, height: 30).contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityLabel(L.t("Session details", "세션 상세")).accessibilityIdentifier("cluster-open-\(s.id)")
        }
        .padding(.vertical, 6).padding(.horizontal, 4)
        .background(on ? Lane.burn.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? Lane.burn.opacity(0.53) : .clear))
        .contentShape(Rectangle())
        .onTapGesture { pick = on ? nil : .session(row.id) }
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("cluster-session-\(s.id)")
    }

    // MARK: Token flow: the period's total, its bins by AI, and by project where records allow
    private var flow: some View {
        let series = model.flow
        let kinds = Set((series?.bins ?? []).compactMap { $0 }.flatMap { $0.filter { $0.value > 0 }.keys }).sorted()
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(Int64(max(0, total).rounded()).formatted()).font(.system(size: 24, weight: .bold)).monospacedDigit().foregroundStyle(theme.ink)
                Text("tokens · \(caption)").font(.system(size: 11)).foregroundStyle(theme.muted)
            }
            HStack(spacing: 10) {
                Text(L.t("By AI", "AI별")).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(theme.ink)
                ForEach(kinds, id: \.self) { kind in
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 2).fill(Tool.color(kind)).frame(width: 8, height: 8)
                        Text(Tool.name(kind)).font(.system(size: 11)).foregroundStyle(theme.muted)
                    }
                }
            }
            .lineLimit(1)
            if series == nil { note(L.t("No flow recorded in this period.", "이 기간의 흐름 기록이 없습니다.")) } else { FlowBars(flow: series, theme: theme).frame(height: compact ? 64 : 96) }
            Text(L.t("By project", "프로젝트별")).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(theme.ink)
            note(L.t("Not available in the remote workspace yet", "원격 워크스페이스에서는 아직 지원하지 않습니다"),
                 L.t("Per-project records are in the 1top app on each computer.", "프로젝트별 기록은 각 컴퓨터의 1top 앱에서 볼 수 있습니다."))
        }
    }

    // MARK: Limits: every account's card; a red light pressed leaves only its accounts
    private var weekly: some View {
        let cards = only == "reconnect" ? r.accounts.filter { r.tells.reconnect.contains($0.id) }
            : only == "empty" ? r.accounts.filter { r.tells.empty.contains($0.id) } : r.accounts
        return Group {
            if cards.isEmpty { note(L.t("No subscription accounts connected.", "연결된 구독 계정이 없습니다.")) } else {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: inner > 460 ? 2 : 1), spacing: 8) {
                    ForEach(cards) { card($0) }
                }
            }
        }
    }
    private func card(_ a: ClusterReadings.Account) -> some View {
        let on = r.speed.account == a.id, color = Tool.color(a.kind), tool = a.kind == "Antigravity" ? "Agy" : Tool.name(a.kind)
        return Button { pick = on ? nil : .account(a.id) } label: {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Text(tool).fontWeight(.bold).foregroundStyle(color)
                    if let plan = a.plan { Text(plan) }
                    if let window = a.window { Text(window) }
                    Spacer(minLength: 4)
                    if let who = a.who { Text(who).foregroundStyle(theme.dim).lineLimit(1).truncationMode(.middle) }
                }
                .font(.system(size: 11)).foregroundStyle(theme.muted).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Format.percent(a.pct)).font(.system(size: 24, weight: .bold)).monospacedDigit().foregroundStyle(theme.ink)
                    Text(L.t("used", "사용")).font(.system(size: 11)).foregroundStyle(theme.muted)
                }
                Capsule().fill(theme.ink.opacity(0.09)).frame(height: 5).overlay(alignment: .leading) {
                    GeometryReader { geo in
                        Capsule().fill(color).opacity(a.current ? 1 : 0.45).frame(width: geo.size.width * min(1, max(0, (a.pct ?? 0) / 100)))
                    }
                }
                HStack(spacing: 3) {
                    if a.reconnect {
                        Text(L.t("Sign-in needed", "재로그인 필요")).fontWeight(.semibold).foregroundStyle(theme.amber)
                    } else {
                        Text(caption).foregroundStyle(theme.muted)
                        Text(a.added.map { "+" + Format.percent($0) } ?? "—").fontWeight(.bold).foregroundStyle(color)
                    }
                    Spacer(minLength: 4)
                    if let burn = a.burn {
                        Text(L.t("Average", "평균")).foregroundStyle(theme.muted)
                        Text(ClusterReadings.reading(burn) + L.t("%/h", "%/시간")).fontWeight(.bold).foregroundStyle(theme.ink)
                    }
                }
                .font(.system(size: 11)).lineLimit(1)
                range(a)
            }
            .padding(12)
            .background(on ? Lane.burn.opacity(0.07) : .clear, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? Lane.burn.opacity(0.53) : theme.line))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
    /// When the limit runs out at this burn, red when that comes before the reset.
    @ViewBuilder private func range(_ a: ClusterReadings.Account) -> some View {
        if let range = a.range {
            switch range.state {
            case .idle: Text(L.t("Not in use now", "지금은 쓰지 않음")).font(.system(size: 11)).foregroundStyle(theme.dim)
            case .enough: Text(L.t("Lasts until the reset", "초기화 전까지 충분")).font(.system(size: 11)).foregroundStyle(Lane.burn)
            case .empty:
                HStack(spacing: 3) {
                    Text(L.t("At this rate", "이 속도면"))
                    Text(range.at.map(Self.when) ?? "—").fontWeight(.bold).foregroundStyle(range.early ? Lane.zone : theme.ink)
                    Text(L.t("runs out", "바닥"))
                }
                .font(.system(size: 11)).foregroundStyle(range.early ? Lane.zone : theme.muted)
            }
        }
    }
    private static func when(_ t: Double) -> String {
        let f = DateFormatter()
        f.locale = L.locale; f.dateFormat = "E HH:mm"
        return f.string(from: Date(timeIntervalSince1970: t))
    }

    // MARK: Usage map: the period's tokens by session as areas; an area opens its session
    private var usageMap: some View {
        let data = UsageView.summary(model, grouping: .session)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                Text(Format.tokens(data.sum)).fontWeight(.bold).foregroundStyle(theme.ink)
                Text("tokens · \(caption)").foregroundStyle(theme.muted)
            }
            .font(.system(size: 11))
            if data.tiles.isEmpty { note(L.t("No reported usage in this window.", "이 기간에 보고된 사용량이 없습니다.")) } else {
                GeometryReader { geo in
                    let laid = UsageView.layout(data.tiles, in: CGRect(origin: .zero, size: geo.size))
                    ZStack(alignment: .topLeading) {
                        ForEach(laid) { tile in
                            let show = tile.frame.width > 64 && tile.frame.height > 34
                            Button { if let s = model.allSessions.first(where: { $0.key == tile.id }) { open(s) } } label: {
                                VStack(alignment: .leading, spacing: 1) {
                                    if show {
                                        Text(tile.label).font(.system(size: 10.5, weight: .semibold)).foregroundStyle(theme.ink).lineLimit(1)
                                        Text(Format.tokens(tile.value)).font(.system(size: 10.5, weight: .medium)).monospacedDigit().foregroundStyle(tile.color)
                                    }
                                }
                                .padding(5)
                                .frame(width: max(0, tile.frame.width - 2), height: max(0, tile.frame.height - 2), alignment: .topLeading)
                                .background(tile.color.opacity(0.2), in: RoundedRectangle(cornerRadius: 5))
                                .overlay(RoundedRectangle(cornerRadius: 5).stroke(tile.color.opacity(0.9), lineWidth: 1))
                            }
                            .buttonStyle(.plain)
                            .offset(x: tile.frame.minX, y: tile.frame.minY)
                            .accessibilityLabel(tile.label + ", " + Format.tokens(tile.value) + " tokens")
                        }
                    }
                }
                .frame(height: max(110, pageHeight - 34))
            }
        }
    }

    // MARK: Goals the computers report, active first
    private var goals: some View {
        let list: [Operations.Goal] = model.reportingDevices.flatMap { $0.snapshot?.operations?.goals ?? [] }
            .sorted { ($0.status == "active" ? 0 : 1) < ($1.status == "active" ? 0 : 1) }
        return VStack(spacing: 6) {
            if list.isEmpty { note(L.t("No goals recorded.", "기록된 목적지가 없습니다.")) }
            ForEach(Array(list.enumerated()), id: \.offset) { _, goal in
                let state = goalState(goal.status)
                VStack(alignment: .leading, spacing: 4) {
                    Text(state.label).font(.system(size: 10, weight: .semibold)).foregroundStyle(state.color)
                        .padding(.horizontal, 8).padding(.vertical, 2).background(state.color.opacity(0.15), in: Capsule())
                    Text(Self.about(goal)).font(.system(size: 11)).foregroundStyle(theme.muted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(theme.line))
            }
        }
    }
    /// Its runtime, the tokens it used and how long it ran.
    private static func about(_ goal: Operations.Goal) -> String {
        var parts: [String] = []
        if let runtime = goal.runtime { parts.append(runtime) }
        if let tokens = goal.tokensUsed, ClusterReadings.valid(tokens) { parts.append(Format.tokens(tokens) + " tokens") }
        if let seconds = goal.timeUsedSeconds, ClusterReadings.valid(seconds) { parts.append(L.t("\(Int((seconds / 60).rounded()))m", "\(Int((seconds / 60).rounded()))분")) }
        return parts.joined(separator: " · ")
    }
    private func goalState(_ status: String?) -> (label: String, color: Color) {
        switch status {
        case "active": (L.t("Active", "활성"), theme.segmentOn)
        case "complete": (L.t("Done", "완료", zh: "完成"), Lane.burn)
        case "paused": (L.t("Paused", "일시정지"), theme.amber)
        case "blocked": (L.t("Blocked", "차단됨"), Lane.zone)
        case "cleared": (L.t("Cleared", "해제됨"), theme.muted)
        case "failed": (L.t("Not achieved", "달성 불가"), Lane.zone)
        case "budget_limit": (L.t("Budget limit", "예산 한도"), Lane.zone)
        case "usage_limit": (L.t("Usage limit", "사용 한도"), Lane.zone)
        default: (status ?? "—", theme.muted)
        }
    }

    // MARK: Resources: each computer's CPU and memory
    private var system: some View {
        let list = model.reportingDevices
        return VStack(spacing: 6) {
            HStack(spacing: 10) {
                Text(L.t("Computer", "컴퓨터")).frame(maxWidth: .infinity, alignment: .leading)
                Text("CPU").frame(width: 64, alignment: .trailing)
                Text(L.t("Memory", "메모리")).frame(width: 64, alignment: .trailing)
            }
            .font(.system(size: 11)).foregroundStyle(theme.muted).opacity(0.8)
            if list.isEmpty { note(L.t("No resource records.", "리소스 기록이 없습니다.")) }
            ForEach(list) { device in
                HStack(spacing: 10) {
                    Text(device.name).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.ink).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(Self.share(device.snapshot?.host?.cpu)).frame(width: 64, alignment: .trailing)
                    Text(Self.share(device.snapshot?.host?.memoryPercent)).frame(width: 64, alignment: .trailing)
                }
                .font(.system(size: 12.5, weight: .semibold)).monospacedDigit().foregroundStyle(theme.ink)
                .padding(.vertical, 3)
            }
        }
    }
    private static func share(_ v: Double?) -> String { v.flatMap { ClusterReadings.valid($0) ? String(format: "%.1f%%", $0) : nil } ?? "—" }
}

/// The period's token bins as bars stacked by AI in each tool's colour (cluster.js tokenChart); a bin some computer
/// did not cover is a faint stub.
struct FlowBars: View {
    var flow: FlowSeries?
    var theme: QuickTheme
    var body: some View {
        Canvas { ctx, size in
            guard let flow, !flow.bins.isEmpty else { return }
            let n = flow.bins.count, pitch = size.width / CGFloat(n), w = max(0.6, pitch - (n > 60 ? 0.6 : 1.2))
            let top = flow.bins.compactMap { $0?.values.filter { $0.isFinite && $0 > 0 }.reduce(0, +) }.max() ?? 0
            ctx.fill(Path(CGRect(x: 0, y: size.height - 0.5, width: size.width, height: 0.5)), with: .color(theme.line))
            guard top > 0 else { return }
            for (i, bin) in flow.bins.enumerated() {
                let x = CGFloat(i) * pitch
                guard let bin else {
                    ctx.fill(Path(CGRect(x: x, y: size.height - 2, width: w, height: 2)), with: .color(theme.line))
                    continue
                }
                var y = size.height
                for (kind, v) in bin.sorted(by: { $0.key < $1.key }) where v.isFinite && v > 0 {
                    let h = size.height * CGFloat(v / top)
                    ctx.fill(Path(CGRect(x: x, y: y - h, width: w, height: h)), with: .color(Tool.color(kind)))
                    y -= h
                }
            }
        }
        .accessibilityHidden(true)
    }
}
