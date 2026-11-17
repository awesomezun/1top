import SwiftUI

/// The month's subscriptions at API prices and the week's agent hours, on top of the usage tab, in the five looks the
/// web dashboard has (reports.js); the forecast on each account card; the settings and share sheets.
enum ReportColor {
    static let green = Color(red: 0.51, green: 0.796, blue: 0.655)
    static let amber = Color(red: 0.914, green: 0.698, blue: 0.361)
    static let lcd = Color(red: 0.616, green: 1, blue: 0.235)
    static let paper = Color(red: 0.957, green: 0.945, blue: 0.91)
    static let ink = Color(red: 0.114, green: 0.11, blue: 0.098)
    static let stamp = Color(red: 0.761, green: 0.255, blue: 0.176)
}

/// Seven segments with a decimal point (5.2, 41.2), lit in one colour, the cluster's LCD figure.
struct DecimalSegments: View {
    var value: Double?
    var color: Color = ReportColor.lcd
    var height: CGFloat
    var body: some View {
        let text: String = { guard let value, value.isFinite, value >= 0 else { return "--" }; return value >= 999.95 ? "999" : String(format: "%.1f", value) }()
        let chars = Array(text.replacingOccurrences(of: ".", with: "")), dot = text.firstIndex(of: ".").map { text.distance(from: text.startIndex, to: $0) - 1 }
        let w = height * 0.55, gap = height * 0.15, room = height * 0.14, slant = tan(9 * Double.pi / 180), skew = height * slant
        let width = CGFloat(chars.count) * w + CGFloat(max(0, chars.count - 1)) * gap + (dot == nil ? 0 : room) + skew
        Canvas { context, _ in
            var ctx = context
            ctx.concatenate(CGAffineTransform(a: 1, b: 0, c: -slant, d: 1, tx: skew, ty: 0))
            var x: CGFloat = 0
            for (i, ch) in chars.enumerated() {
                let lit = Segments.lit[ch] ?? ""
                // A 1 sits in the middle of its cell, as the cluster draws it, so a figure has no hole in it.
                let shift = ch == "1" ? -(w / 2 - height * 0.115 / 2) : 0
                for key in "abcdefg" where lit.contains(key) { ctx.fill(Segments.path(key, width: w, height: height).offsetBy(dx: x + shift, dy: 0), with: .color(color)) }
                x += w + gap
                if i == dot { let d = height * 0.12; ctx.fill(Path(roundedRect: CGRect(x: x - gap / 2 - d / 2 + room / 4, y: height - d, width: d, height: d), cornerRadius: d * 0.2), with: .color(color)); x += room }
            }
        }
        .frame(width: width, height: height)
        .shadow(color: color.opacity(0.5), radius: height * 0.06)
        .padding(.horizontal, height * 0.22).padding(.vertical, height * 0.16)
        .background(Color(red: 0.04, green: 0.05, blue: 0.06), in: RoundedRectangle(cornerRadius: height * 0.22))
        .accessibilityHidden(true)
    }
}

struct ReportPanel: View {
    @Environment(AppModel.self) private var model
    @State private var prefs = ReportPrefs.shared
    @State private var settings = false
    @State private var sharing = false
    @State private var open = false

    var body: some View {
        if !prefs.hidden {
            if let r = model.reports, let v = ReportFigures(r.value, basis: prefs.basis) {
                ReportBody(shape: prefs.shape, v: v, w: WeekFigures(r.weekly), basis: prefs.basis, open: $open, settings: $settings, sharing: $sharing)
                    .sheet(isPresented: $settings) { ReportSettingsSheet().environment(model) }
                    .sheet(isPresented: $sharing) { ShareCardSheet(v: v, w: WeekFigures(r.weekly)) }
            } else if !model.devices.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L.t("Value · this week", "본전 · 이번 주")).font(.subheadline.weight(.semibold))
                    Text(L.t("Shown after the collector update", "수집기 업데이트 후 표시됩니다")).font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
        }
    }
}

/// One look of the panel; the settings sheet draws every look with the same figures.
struct ReportBody: View {
    var shape: String
    var v: ReportFigures
    var w: WeekFigures?
    var basis: String
    @Binding var open: Bool
    @Binding var settings: Bool
    @Binding var sharing: Bool
    var preview = false

    private var period: String {
        Date(timeIntervalSince1970: v.first).formatted(.dateTime.month(.abbreviated).day().locale(L.locale)) + " ~ " + Date(timeIntervalSince1970: v.end).formatted(.dateTime.month(.abbreviated).day().hour().minute().locale(L.locale))
    }
    private func sign(_ d: Double) -> String { (d >= 0 ? "+" : "−") + ForecastText.duration(abs(d)) }
    private var basisNote: String {
        basis == "prorated" ? L.t("Against \(ReportFormat.money(v.cost)), the share of this month's subscriptions so far", "지난 \(Int((v.share * 100).rounded()))% 기간의 구독료 \(ReportFormat.money(v.cost))와 비교")
            : L.t("Against this month's \(ReportFormat.money(v.plan)) in subscriptions", "이번 달 구독료 \(ReportFormat.money(v.plan)) 전체와 비교")
    }
    private var weekNote: String { w?.partial == true ? L.t(" · since 4.8.0", " · 4.8.0 설치 이후") : "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if shape != "strip" { header }
            Group {
                switch shape {
                case "receipt": receipt
                case "big": big
                case "trend": trend
                case "strip": strip
                default: trip
                }
            }
            .padding(14)
            footer
        }
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.primary.opacity(0.08)))
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(shape == "receipt" ? L.t("\(v.label) usage receipt", "\(v.label) 사용 영수증") : shape == "trend" ? L.t("Value trend · this week", "본전 추이 · 이번 주") : L.t("\(v.label) value · this week", "\(v.label) 본전 · 이번 주"))
                    .font(.subheadline.weight(.semibold))
                Text(L.t("At API prices · ", "API 가격으로 환산 · ") + period).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            buttons
        }
        .padding([.horizontal, .top], 14)
    }
    private var buttons: some View {
        HStack(spacing: 6) {
            Button(L.t("Shape", "모양")) { settings = true }
            Button(L.t("Share card", "공유 카드")) { sharing = true }
        }
        .buttonStyle(.bordered).controlSize(.small).font(.caption.weight(.semibold))
        .disabled(preview)
    }
    private var footer: some View {
        var notes = [L.t("Long-context rates and models without a known price are left out, so this may read low", "긴 문맥 요금과 가격을 모르는 모델은 빼고 계산해 실제보다 낮게 나올 수 있습니다")]
        if v.left > 0 { let names = v.leftKinds.map { Tool.name($0) }.joined(separator: ", "); notes.append(L.t("\(names) \(ReportFormat.money(v.left)) left out: plan price unknown", "요금제를 모르는 \(names) \(ReportFormat.money(v.left))은 빼고 계산했습니다")) }
        if !v.prices.isEmpty { notes.append(L.t("Prices as of \(v.prices)", "가격 \(v.prices) 기준")) }
        return Text(notes.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
            .padding(.horizontal, 14).padding(.bottom, 12)
    }

    // A · trip computer
    private var trip: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(L.t("Value multiple", "본전 배수")).font(.caption).foregroundStyle(.secondary)
                HStack(alignment: .lastTextBaseline, spacing: 8) { DecimalSegments(value: v.ratio, height: 40); Text(L.t("×", "배")).font(.title3.italic().weight(.bold)).foregroundStyle(ReportColor.lcd) }
                Text(basisNote).font(.caption2).foregroundStyle(.secondary)
            }
            Divider()
            VStack(spacing: 8) {
                row(L.t("At API prices", "API 가격 환산"), ReportFormat.money(v.api))
                row(L.t("Subscriptions · \(v.plans) plans", "구독료 · 요금제 \(v.plans)개"), ReportFormat.money(v.plan))
                row(L.t("Saved", "아낀 돈"), v.saved.map { ($0 >= 0 ? "+" : "−") + ReportFormat.money(abs($0)) } ?? "—", color: ReportColor.green)
            }
            Divider()
            if let w {
                VStack(alignment: .leading, spacing: 8) {
                    Text(L.t("Agent hours this week · all sessions", "이번 주 에이전트 시간 · 세션 합") + weekNote).font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 10) { DecimalSegments(value: w.work / 3600, height: 22); Text(L.t("hours working", "시간 작업")).font(.footnote).foregroundStyle(.secondary) }
                    HStack(spacing: 10) { DecimalSegments(value: w.wait / 3600, color: ReportColor.amber, height: 22); Text(L.t("hours waiting for you", "시간 대기로 멈춤")).font(.footnote).foregroundStyle(.secondary) }
                    if let p = w.prev { Text(L.t("Versus last week at this time: work \(sign(w.work - p.work)) · waiting \(sign(w.wait - p.wait))", "지난주 같은 때보다 작업 \(sign(w.work - p.work)) · 대기 \(sign(w.wait - p.wait))")).font(.caption).foregroundStyle(.secondary) }
                }
            }
            FlowChips(kinds: v.kinds)
        }
    }
    private func row(_ k: String, _ value: String, color: Color = .primary) -> some View {
        HStack { Text(k).font(.footnote).foregroundStyle(.secondary); Spacer(); Text(value).font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(color) }
    }

    // B · receipt
    private var receipt: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(spacing: 4) {
                Text("1TOP RECEIPT").font(.system(size: 14, weight: .bold, design: .monospaced)).kerning(1.5)
                Text(period).font(.system(size: 11, design: .monospaced)).foregroundStyle(ReportColor.ink.opacity(0.6))
                ForEach(v.models.prefix(8), id: \.model) { m in dotted(m.model, ReportFormat.money(m.apiValue)) }
                DashedLine()
                dotted(L.t("At API prices", "API 가격 합계"), ReportFormat.money(v.api))
                dotted(L.t("Subscriptions \(v.plans)", "구독료 \(v.plans)개"), "−" + ReportFormat.money(v.plan))
                DashedLine()
                dotted(L.t("Saved", "아낀 돈"), ReportFormat.money(v.saved), bold: true)
                Text(L.t("Value \(ReportFormat.times(v.ratio))×", "본전 \(ReportFormat.times(v.ratio))배")).font(.system(size: 16, weight: .heavy, design: .monospaced))
                    .foregroundStyle(ReportColor.stamp).padding(.horizontal, 10).padding(.vertical, 3)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(ReportColor.stamp, lineWidth: 2.5)).rotationEffect(.degrees(-8)).padding(.top, 8)
            }
            .foregroundStyle(ReportColor.ink).padding(14).background(ReportColor.paper, in: RoundedRectangle(cornerRadius: 4))
            if let w {
                Text(L.t("This week's timesheet", "이번 주 근무표") + weekNote).font(.subheadline.weight(.semibold))
                let top = max(36000, w.days.map { ($0.work ?? 0) + ($0.wait ?? 0) }.max() ?? 0)
                ForEach(w.days) { d in
                    HStack(spacing: 8) {
                        Text(d.label).font(.caption).frame(width: 26, alignment: .leading)
                        GeometryReader { g in HStack(spacing: 2) {
                            Rectangle().fill(ReportColor.green).frame(width: g.size.width * (d.work ?? 0) / top)
                            Rectangle().fill(ReportColor.amber).frame(width: g.size.width * (d.wait ?? 0) / top)
                            Spacer(minLength: 0)
                        } }
                        .frame(height: 10).background(Color.primary.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 3))
                        Text(d.work == nil ? "—" : String(format: "%.1fh · ", (d.work ?? 0) / 3600) + L.t("wait ", "대기 ") + String(format: "%.1fh", (d.wait ?? 0) / 3600))
                            .font(.caption2).monospacedDigit().foregroundStyle(.secondary).frame(width: 104, alignment: .trailing)
                    }
                }
                Text(L.t("Work \(ForecastText.duration(w.work)) · waiting \(ForecastText.duration(w.wait)) · all sessions", "작업 \(ForecastText.duration(w.work)) · 대기 \(ForecastText.duration(w.wait)) · 세션 합")).font(.footnote)
                if let l = w.longest { Text(L.t("Longest wait: \(l.label) · \(Tool.name(l.kind)) · \(ForecastText.duration(l.seconds))", "가장 오래 멈춘 세션: \(l.label) · \(Tool.name(l.kind)) · \(ForecastText.duration(l.seconds))")).font(.caption).foregroundStyle(.secondary) }
            }
        }
    }
    private func dotted(_ l: String, _ r: String, bold: Bool = false) -> some View {
        HStack(alignment: .lastTextBaseline, spacing: 6) {
            Text(l).lineLimit(1)
            Line().stroke(style: StrokeStyle(lineWidth: 1.2, dash: [1.5, 3])).foregroundStyle(ReportColor.ink.opacity(0.4)).frame(height: 1)
            Text(r).fontWeight(bold ? .heavy : .semibold)
        }
        .font(.system(size: bold ? 15 : 13, design: .monospaced))
    }

    // C · one big multiple
    private var big: some View {
        let top = max(v.api, v.cost ?? 0, 1), maxK = max(v.kinds.compactMap(\.ratio).max() ?? 1, 1)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .lastTextBaseline, spacing: 4) { Text(ReportFormat.times(v.ratio)).font(.system(size: 52, weight: .bold)).monospacedDigit(); Text(L.t("×", "배")).font(.title2.weight(.semibold)).foregroundStyle(.secondary) }
            Text(L.t("\(ReportFormat.money(basis == "prorated" ? v.cost : v.plan)) in subscriptions bought \(ReportFormat.money(v.api)) at API prices.", "구독료 \(ReportFormat.money(basis == "prorated" ? v.cost : v.plan))로 API 가격 기준 \(ReportFormat.money(v.api))어치를 썼습니다.")).font(.footnote).foregroundStyle(.secondary)
            bar(L.t("Plans", "구독료"), (v.cost ?? 0) / top, Color.gray, ReportFormat.money(v.cost))
            bar(L.t("API value", "API 환산"), v.api / top, ReportColor.green, ReportFormat.money(v.api))
            Divider()
            ForEach(v.kinds) { k in bar(Tool.name(k.kind), (k.ratio ?? 0) / maxK, Tool.color(k.kind), k.plan > 0 ? ReportFormat.times(k.ratio) + L.t("×", "배") : "—", thin: true) }
            if let w { weekColumns(w) }
        }
    }
    private func bar(_ label: String, _ f: Double, _ color: Color, _ value: String, thin: Bool = false) -> some View {
        HStack(spacing: 10) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 84, alignment: .leading).lineLimit(1)
            GeometryReader { g in ZStack(alignment: .leading) { Capsule().fill(Color.primary.opacity(0.08)); Capsule().fill(color).frame(width: max(4, g.size.width * min(1, f))) } }.frame(height: thin ? 6 : 12)
            Text(value).font(.caption.weight(.semibold)).monospacedDigit().frame(width: 64, alignment: .trailing)
        }
    }
    private func weekColumns(_ w: WeekFigures) -> some View {
        let top = max(36000, w.days.map { ($0.work ?? 0) + ($0.wait ?? 0) }.max() ?? 0)
        return VStack(alignment: .leading, spacing: 10) {
            Divider()
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) { Text(L.t("Working this week", "이번 주 작업") + weekNote).font(.caption).foregroundStyle(.secondary); Text(ForecastText.duration(w.work)).font(.title3.weight(.bold)).monospacedDigit()
                    if let p = w.prev { Text(L.t("vs last week \(sign(w.work - p.work))", "지난주 같은 때보다 \(sign(w.work - p.work))")).font(.caption2).foregroundStyle(ReportColor.green) } }
                Spacer()
                VStack(alignment: .leading, spacing: 3) { Text(L.t("Waiting for you", "대기로 멈춘 시간")).font(.caption).foregroundStyle(.secondary); Text(ForecastText.duration(w.wait)).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(ReportColor.amber)
                    if let p = w.prev { Text(L.t("vs last week \(sign(w.wait - p.wait))", "지난주 같은 때보다 \(sign(w.wait - p.wait))")).font(.caption2).foregroundStyle(w.wait <= p.wait ? ReportColor.green : ReportColor.amber) } }
            }
            HStack(alignment: .bottom, spacing: 8) {
                ForEach(w.days) { d in
                    VStack(spacing: 4) {
                        VStack(spacing: 2) { Spacer(minLength: 0); RoundedRectangle(cornerRadius: 3).fill(ReportColor.amber).frame(height: 90 * (d.wait ?? 0) / top); RoundedRectangle(cornerRadius: 3).fill(ReportColor.green).frame(height: 90 * (d.work ?? 0) / top) }
                            .frame(height: 92)
                        Text(d.label).font(.caption2).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            if let l = w.longest { Text(L.t("Longest wait \(l.label) · \(Tool.name(l.kind)) · \(ForecastText.duration(l.seconds))", "가장 오래 멈춘 세션 \(l.label) · \(Tool.name(l.kind)) · \(ForecastText.duration(l.seconds))")).font(.caption).foregroundStyle(.secondary) }
        }
    }

    // D · monthly trend
    private var trend: some View {
        let rows = v.months + [ReportFigures.MonthRow(label: v.label, api: v.api, plan: v.plan ?? 0, now: true)]
        let top = max(v.proj ?? 0, rows.map(\.api).max() ?? 1, 1) * 1.12
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(ReportFormat.times(v.ratio) + L.t("×", "배")).font(.title2.weight(.bold)).monospacedDigit()
                Text(L.t("\(v.label) so far \(ReportFormat.money(v.api)) / plans \(ReportFormat.money(v.cost))", "\(v.label) 지금까지 \(ReportFormat.money(v.api)) / 구독료 \(ReportFormat.money(v.cost))")).font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .bottom, spacing: 10) {
                ForEach(rows) { r in
                    VStack(spacing: 4) {
                        if r.plan > 0 { Text(ReportFormat.times(r.api / (r.now && basis == "prorated" ? (v.cost ?? r.plan) : r.plan)) + L.t("×", "배")).font(.system(size: 10, weight: .bold)).foregroundStyle(ReportColor.lcd) }
                        ZStack(alignment: .bottom) {
                            if r.now, let p = v.proj { RoundedRectangle(cornerRadius: 4).stroke(ReportColor.green, style: StrokeStyle(lineWidth: 1, dash: [4, 3])).frame(height: 130 * p / top) }
                            RoundedRectangle(cornerRadius: 4).fill(r.now ? ReportColor.green : ReportColor.green.opacity(0.45)).frame(height: max(2, 130 * r.api / top))
                        }
                        .frame(height: 130, alignment: .bottom)
                        Text(r.label).font(.caption2.weight(r.now ? .semibold : .regular)).foregroundStyle(r.now ? .primary : .secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            if let p = v.proj { Text(L.t("At this pace \(ReportFormat.money(p)) by month end · \(ReportFormat.times(v.plan.map { p / $0 }))×", "이 속도면 \(v.label) 말 \(ReportFormat.money(p)) · \(ReportFormat.times(v.plan.map { p / $0 }))배 예상")).font(.caption).foregroundStyle(.secondary) }
            if let w { weekColumns(w) }
        }
    }

    // E · strip
    private var strip: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 10) {
                cell(L.t("\(v.label) value", "\(v.label) 본전"), ReportFormat.times(v.ratio) + L.t("×", "배"), ReportFormat.money(v.api) + " / " + ReportFormat.money(v.cost))
                cell(L.t("Working this week", "이번 주 작업"), w.map { ForecastText.duration($0.work) } ?? "—", L.t("All sessions", "세션 합") + weekNote)
                cell(L.t("Waiting for you", "대기로 멈춤"), w.map { ForecastText.duration($0.wait) } ?? "—", w?.longest.map { L.t("Longest \($0.label)", "최장 \($0.label)") } ?? "", color: ReportColor.amber)
            }
            HStack {
                Button(open ? L.t("Less", "접기") : L.t("Details", "자세히")) { withAnimation { open.toggle() } }.disabled(preview)
                Spacer()
                buttons
            }
            .font(.caption.weight(.semibold))
            if open {
                Divider()
                ForEach(v.models.prefix(8), id: \.model) { m in HStack { Circle().fill(Tool.color(m.kind ?? "")).frame(width: 7, height: 7); Text(m.model).font(.caption); Spacer(); Text(ReportFormat.money(m.apiValue)).font(.caption).monospacedDigit() } }
                HStack { Text(L.t("Saved", "아낀 돈")).font(.caption.weight(.semibold)); Spacer(); Text(ReportFormat.money(v.saved)).font(.caption.weight(.semibold)).foregroundStyle(ReportColor.green) }
            }
        }
    }
    private func cell(_ k: String, _ value: String, _ note: String, color: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(value).font(.callout.weight(.bold)).monospacedDigit().foregroundStyle(color).lineLimit(1)
            Text(note).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

private struct FlowChips: View {
    var kinds: [ReportFigures.KindRow]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(kinds) { k in
                HStack(spacing: 6) {
                    Circle().fill(Tool.color(k.kind)).frame(width: 7, height: 7)
                    Text(Tool.name(k.kind)).font(.caption)
                    if k.plan > 0 { Text(ReportFormat.times(k.ratio) + L.t("×", "배")).font(.caption.weight(.bold)).foregroundStyle(ReportColor.lcd); Text(ReportFormat.money(k.api) + " / " + ReportFormat.money(k.plan)).font(.caption2).foregroundStyle(.secondary) }
                    else { Text(ReportFormat.money(k.api) + " · " + L.t("plan to confirm", "요금제 확인 필요")).font(.caption2).foregroundStyle(.secondary) }
                }
                .monospacedDigit()
            }
        }
    }
}

private struct Line: Shape { func path(in r: CGRect) -> Path { Path { $0.move(to: CGPoint(x: 0, y: r.midY)); $0.addLine(to: CGPoint(x: r.maxX, y: r.midY)) } } }
private struct DashedLine: View { var body: some View { Line().stroke(style: StrokeStyle(lineWidth: 1.2, dash: [4, 4])).foregroundStyle(ReportColor.ink.opacity(0.4)).frame(height: 1).padding(.vertical, 4) } }

/// What an account card adds under its windows, in the panel's look; nothing without a verified weekly burn.
struct ForecastBlock: View {
    @Environment(AppModel.self) private var model
    var quota: Quota
    var quotas: [Quota]
    @State private var prefs = ReportPrefs.shared

    var body: some View {
        let now = DemoData.shownNow()
        if let t = ForecastText(quota, quotas: quotas, period: model.period, now: now, name: { q in Tool.name(q.kind) + (model.accountTag(q.id).map { " " + $0 } ?? "") }) {
            VStack(alignment: .leading, spacing: 6) {
                if t.forecast.state == .idle {
                    Text(t.main).font(.caption).foregroundStyle(.secondary)
                } else {
                    switch prefs.shape {
                    case "trip" where t.warn:
                        HStack(spacing: 10) {
                            DecimalSegments(value: t.forecast.hours, color: ReportColor.amber, height: 18)
                            VStack(alignment: .leading, spacing: 2) { Text(t.main).font(.footnote.weight(.semibold)).foregroundStyle(ReportColor.amber); Text(t.sub).font(.caption).foregroundStyle(.secondary) }
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(ReportColor.amber.opacity(0.4)))
                    case "big" where t.forecast.reset != nil:
                        timeline(t, now: now)
                    case "strip":
                        Text(t.warn ? L.t("Runs out \(ForecastText.when(t.forecast.end ?? now, now: now))", "\(ForecastText.when(t.forecast.end ?? now, now: now)) 바닥") : L.t("Lasts to the reset", "초기화까지 넉넉함"))
                            .font(.caption2.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 2)
                            .background((t.warn ? ReportColor.amber : ReportColor.green).opacity(0.16), in: Capsule()).foregroundStyle(t.warn ? ReportColor.amber : ReportColor.green)
                        Text(t.main + (t.sub.isEmpty ? "" : " · " + t.sub)).font(.caption).foregroundStyle(.secondary)
                    default:
                        (Text(t.main).foregroundStyle(t.warn ? ReportColor.amber : ReportColor.green).fontWeight(.semibold) + Text(t.sub.isEmpty ? "" : " · " + t.sub).foregroundStyle(.secondary)).font(.caption)
                    }
                    if let alt = t.alt { Text(alt).font(.caption).foregroundStyle(.secondary) }
                }
                if let h = t.fiveHour { Text(h).font(.caption).foregroundStyle(.secondary) }
            }
            .padding(.vertical, 2)
        }
    }
    private func timeline(_ t: ForecastText, now: Double) -> some View {
        let span = (t.forecast.reset ?? now) - now, f = t.warn && span > 0 ? min(1, ((t.forecast.end ?? now) - now) / span) : 1
        return VStack(alignment: .leading, spacing: 4) {
            GeometryReader { g in ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Capsule().fill(Tool.color(quota.kind).opacity(0.7)).frame(width: g.size.width * f)
                if t.warn { Rectangle().fill(ReportColor.amber).frame(width: 2, height: 16).offset(x: g.size.width * f - 1) }
            } }
            .frame(height: 8)
            HStack { Text(L.t("Now", "지금")); Spacer(); Text(L.t("Resets \(ForecastText.when(t.forecast.reset ?? now, now: now))", "초기화 \(ForecastText.when(t.forecast.reset ?? now, now: now))")) }.font(.caption2).foregroundStyle(.secondary)
            (Text(t.main).foregroundStyle(t.warn ? ReportColor.amber : ReportColor.green).fontWeight(.semibold) + Text(t.sub.isEmpty ? "" : " · " + t.sub).foregroundStyle(.secondary)).font(.caption)
        }
    }
}

/// The report's sheet, also opened from the customizing list: the panel's look (each drawn with today's figures), the
/// share card's look, the multiple's basis and whether the panel shows.
struct ReportSettingsSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var prefs = ReportPrefs.shared
    @State private var tab = "shape"
    @State private var thumbs: [String: UIImage] = [:]

    var body: some View {
        NavigationStack {
            let v = model.reports.flatMap { ReportFigures($0.value, basis: prefs.basis) }, w = WeekFigures(model.reports?.weekly)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Picker("", selection: $tab) {
                        Text(L.t("Report shape", "리포트 모양")).tag("shape"); Text(L.t("Share card", "공유 카드")).tag("share"); Text(L.t("Basis · show", "기준·보이기")).tag("more")
                    }
                    .pickerStyle(.segmented)
                    if tab == "shape", let v {
                        ForEach(ReportPrefs.shapes, id: \.self) { s in
                            card(selected: prefs.shape == s, title: ReportPrefs.name(s) + (s == "trip" ? L.t(" · default", " · 기본") : "")) {
                                ReportBody(shape: s, v: v, w: w, basis: prefs.basis, open: .constant(false), settings: .constant(false), sharing: .constant(false), preview: true).allowsHitTesting(false)
                            } action: { prefs.shape = s }
                        }
                    } else if tab == "share", let v {
                        ForEach(ReportPrefs.shapes, id: \.self) { s in
                            card(selected: prefs.share == s, title: ReportPrefs.name(s) + (s == "trend" ? L.t(" · default", " · 기본") : "")) {
                                Group { if let img = thumbs[s] { Image(uiImage: img).resizable().aspectRatio(1200 / 630, contentMode: .fit) } else { Color.black.aspectRatio(1200 / 630, contentMode: .fit) } }
                                    .clipShape(RoundedRectangle(cornerRadius: 8))
                                    .task { if thumbs[s] == nil { thumbs[s] = ShareCard.image(shape: s, v: v, w: w, scale: 0.5) } }
                            } action: { prefs.share = s }
                        }
                    } else if tab == "more" {
                        Picker(L.t("Value multiple against", "본전 배수 기준"), selection: $prefs.basis) {
                            Text(L.t("The whole month's plans", "구독료 전체")).tag("month"); Text(L.t("The share so far", "지난 날짜만큼")).tag("prorated")
                        }
                        .pickerStyle(.segmented)
                        Text(prefs.basis == "month" ? L.t("Compares with this month's subscriptions in full. Small early in the month, large at its end.", "이번 달 구독료 전체와 비교합니다. 달 초에는 작게 시작해 월말에 커집니다.")
                             : L.t("Compares with the part of the subscriptions the days so far stand for. The same size as last month even early on.", "지난 날짜만큼 나눈 구독료와 비교합니다. 달 초에도 지난달과 같은 크기로 비교됩니다."))
                            .font(.footnote).foregroundStyle(.secondary)
                        Toggle(L.t("Show on the usage tab", "사용량 화면에 보이기"), isOn: Binding(get: { !prefs.hidden }, set: { prefs.hidden = !$0 }))
                        Button(L.t("Back to defaults", "기본값으로 되돌리기")) { prefs.reset() }.buttonStyle(.bordered)
                    }
                    if v == nil && tab != "more" { Text(L.t("Shown after the collector update", "수집기 업데이트 후 표시됩니다")).foregroundStyle(.secondary) }
                }
                .padding(16)
            }
            .navigationTitle(L.t("Value · weekly report", "본전·주간 리포트")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L.t("Done", "완료")) { dismiss() } } }
        }
    }
    private func card<C: View>(selected: Bool, title: String, @ViewBuilder content: () -> C, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) { content(); Text(title).font(.footnote.weight(.semibold)).foregroundStyle(selected ? .primary : .secondary) }
                .padding(10).frame(maxWidth: .infinity)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(selected ? Color.accentColor : Color.primary.opacity(0.12), lineWidth: 2))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The share sheet: the chosen card drawn at 1200 × 630, its other looks, then the system share sheet (save to
/// Photos, Messages, …). The image never holds an e-mail, a session name or a path.
struct ShareCardSheet: View {
    var v: ReportFigures
    var w: WeekFigures?
    @Environment(\.dismiss) private var dismiss
    @State private var prefs = ReportPrefs.shared
    @State private var image: UIImage?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Group { if let image { Image(uiImage: image).resizable().aspectRatio(1200 / 630, contentMode: .fit) } else { Color.black.aspectRatio(1200 / 630, contentMode: .fit) } }
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Picker("", selection: $prefs.share) { ForEach(ReportPrefs.shapes, id: \.self) { Text(ReportPrefs.name($0)).tag($0) } }.pickerStyle(.menu)
                    Text(L.t("An estimate at public API prices. No e-mail, session name or path is on the card.", "공개 API 단가로 계산한 추정치입니다. 이메일·세션 이름·경로는 넣지 않습니다.")).font(.footnote).foregroundStyle(.secondary)
                    if let image {
                        let shown = Image(uiImage: image)
                        ShareLink(item: shown, preview: SharePreview("1top", image: shown)) { Label(L.t("Share", "공유"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }
                            .buttonStyle(.borderedProminent)
                    }
                }
                .padding(16)
            }
            .navigationTitle(L.t("Share card", "공유 카드")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L.t("Done", "완료")) { dismiss() } } }
            .task(id: prefs.share) { image = ShareCard.image(shape: prefs.share, v: v, w: w) }
        }
    }
}

/// The five share cards at 1200 × 630, the same layouts as reports.js draws on its canvas.
struct ShareCard: View {
    var shape: String
    var v: ReportFigures
    var w: WeekFigures?
    @MainActor static func image(shape: String, v: ReportFigures, w: WeekFigures?, scale: CGFloat = 1) -> UIImage? {
        let r = ImageRenderer(content: ShareCard(shape: shape, v: v, w: w).environment(\.colorScheme, .dark)); r.scale = scale
        return r.uiImage
    }
    private let ui = Color(red: 0.914, green: 0.922, blue: 0.937), muted = Color(red: 0.608, green: 0.631, blue: 0.678)

    var body: some View {
        ZStack(alignment: .topLeading) {
            switch shape {
            case "trip": trip
            case "receipt": receipt
            case "big": big
            case "strip": strip
            default: trend
            }
        }
        .frame(width: 1200, height: 630, alignment: .topLeading)
        .clipped()
    }
    private var brand: some View {
        HStack(spacing: 12) {
            Image(systemName: "waveform.path").font(.system(size: 44, weight: .semibold)).foregroundStyle(Color.mint1top).frame(width: 52, height: 52)
            Text("1top").font(.system(size: 50, weight: .semibold)).foregroundStyle(ui)
            Text("1top.si").font(.system(size: 28, weight: .semibold)).foregroundStyle(muted)
        }
    }
    private func kindsRow(_ size: CGFloat = 34) -> some View {
        HStack(spacing: 40) {
            ForEach(v.kinds.filter { $0.ratio != nil }.prefix(3)) { k in
                HStack(spacing: 12) { Circle().fill(Tool.color(k.kind)).frame(width: 24, height: 24); Text(Tool.name(k.kind).replacingOccurrences(of: " Code", with: "") + " " + ReportFormat.times(k.ratio) + L.t("×", "배")).font(.system(size: size, weight: .bold)).foregroundStyle(Color(red: 0.79, green: 0.81, blue: 0.84)) }
            }
        }
    }
    private var trip: some View {
        ZStack(alignment: .topLeading) {
            Color(red: 0.027, green: 0.035, blue: 0.039)
            VStack(alignment: .leading, spacing: 0) {
                Text(L.t("\(v.label) AI coding mileage", "\(v.label) AI 코딩 연비")).font(.system(size: 40, weight: .semibold)).foregroundStyle(muted).padding(.top, 64)
                HStack(alignment: .lastTextBaseline, spacing: 18) {
                    DecimalSegments(value: v.ratio, height: 180).padding(.leading, -36)
                    Text(L.t("×", "배")).font(.system(size: 92, weight: .heavy).italic()).foregroundStyle(ReportColor.lcd)
                }
                .padding(.top, 10)
                Text(L.t("Plans \(ReportFormat.money(v.cost)) → API prices \(ReportFormat.money(v.api))", "구독료 \(ReportFormat.money(v.cost)) → API 가격 \(ReportFormat.money(v.api))")).font(.system(size: 44, weight: .bold)).foregroundStyle(ui).padding(.top, 28)
                Text(L.t("Saved +\(ReportFormat.money(max(0, v.saved ?? 0)))", "아낀 돈 +\(ReportFormat.money(max(0, v.saved ?? 0)))")).font(.system(size: 44, weight: .bold)).foregroundStyle(ReportColor.green).padding(.top, 10)
                kindsRow().padding(.top, 22)
            }
            .padding(.leading, 72)
            brand.position(x: 1200 - 72 - 134, y: 66)
        }
    }
    private var receipt: some View {
        ZStack(alignment: .topLeading) {
            Color(red: 0.102, green: 0.11, blue: 0.125)
            VStack(alignment: .leading, spacing: 18) {
                Text(L.t("\(v.label) AI coding receipt", "\(v.label) AI 코딩 영수증")).font(.system(size: 34, weight: .semibold)).foregroundStyle(muted)
                HStack(alignment: .lastTextBaseline, spacing: 10) { Text(ReportFormat.times(v.ratio)).font(.system(size: 120, weight: .heavy)).foregroundStyle(ui); Text(L.t("×", "배")).font(.system(size: 54, weight: .heavy)).foregroundStyle(muted) }
                Text(L.t("Saved \(ReportFormat.money(v.saved))", "아낀 돈 \(ReportFormat.money(v.saved))")).font(.system(size: 38, weight: .bold)).foregroundStyle(ReportColor.green)
                Text(L.t("Plans \(ReportFormat.money(v.plan))", "구독료 \(ReportFormat.money(v.plan))")).font(.system(size: 30, weight: .semibold)).foregroundStyle(Color(red: 0.79, green: 0.81, blue: 0.84))
            }
            .padding(.leading, 72).padding(.top, 104)
            VStack(spacing: 10) {
                Text("1TOP RECEIPT").font(.system(size: 36, weight: .heavy, design: .monospaced))
                Text(v.label + " · " + L.t("at API prices", "API 가격 기준")).font(.system(size: 24, design: .monospaced)).foregroundStyle(ReportColor.ink.opacity(0.6))
                ForEach(v.models.prefix(6), id: \.model) { m in line(m.model, ReportFormat.money(m.apiValue)) }
                line(L.t("At API prices", "API 가격 합계"), ReportFormat.money(v.api)).padding(.top, 6)
                line(L.t("Plans \(v.plans)", "구독료 \(v.plans)"), "−" + ReportFormat.money(v.plan))
                line(L.t("Saved", "아낀 돈"), ReportFormat.money(v.saved), big: true).padding(.top, 6)
                Text(L.t("Value \(ReportFormat.times(v.ratio))×", "본전 \(ReportFormat.times(v.ratio))배")).font(.system(size: 40, weight: .heavy, design: .monospaced)).foregroundStyle(ReportColor.stamp)
                    .padding(.horizontal, 22).padding(.vertical, 6).overlay(RoundedRectangle(cornerRadius: 6).stroke(ReportColor.stamp, lineWidth: 5)).rotationEffect(.degrees(-7)).padding(.top, 10)
            }
            .foregroundStyle(ReportColor.ink).padding(.horizontal, 40).padding(.vertical, 30).frame(width: 660, height: 580, alignment: .top)
            .background(ReportColor.paper).position(x: 470 + 330, y: 18 + 290)
            brand.position(x: 72 + 134, y: 630 - 66)
        }
    }
    private func line(_ l: String, _ r: String, big: Bool = false) -> some View {
        HStack(alignment: .lastTextBaseline) { Text(l).lineLimit(1); Line().stroke(style: StrokeStyle(lineWidth: 2, dash: [2, 6])).foregroundStyle(ReportColor.ink.opacity(0.4)).frame(height: 2); Text(r) }
            .font(.system(size: big ? 32 : 25, weight: big ? .heavy : .regular, design: .monospaced))
    }
    private var big: some View {
        ZStack(alignment: .topLeading) {
            LinearGradient(colors: [Color(red: 0.063, green: 0.075, blue: 0.094), Color(red: 0.086, green: 0.129, blue: 0.106)], startPoint: .topLeading, endPoint: .bottomTrailing)
            VStack(alignment: .leading, spacing: 0) {
                Text(v.label + " · " + L.t("Subscription value", "구독 본전")).font(.system(size: 40, weight: .semibold)).foregroundStyle(muted).padding(.top, 62)
                HStack(alignment: .lastTextBaseline, spacing: 14) { Text(ReportFormat.times(v.ratio)).font(.system(size: 236, weight: .heavy)).foregroundStyle(ui); Text(L.t("×", "배")).font(.system(size: 96, weight: .heavy)).foregroundStyle(muted) }
                    .frame(height: 250)
                Text(L.t("Plans \(ReportFormat.money(v.cost)) → API prices \(ReportFormat.money(v.api))", "구독료 \(ReportFormat.money(v.cost)) → API 가격 \(ReportFormat.money(v.api))")).font(.system(size: 42, weight: .bold)).foregroundStyle(ui).padding(.top, 12)
                let top = max(v.api, v.cost ?? 0, 1)
                hbar(L.t("Plans", "구독료"), (v.cost ?? 0) / top, Color(red: 0.353, green: 0.384, blue: 0.439), ReportFormat.money(v.cost)).padding(.top, 34)
                hbar(L.t("API value", "API 환산"), v.api / top, ReportColor.green, ReportFormat.money(v.api)).padding(.top, 20)
            }
            .padding(.leading, 72)
            brand.position(x: 1200 - 72 - 134, y: 66)
        }
    }
    private func hbar(_ l: String, _ f: Double, _ c: Color, _ value: String) -> some View {
        HStack(spacing: 20) {
            Text(l).font(.system(size: 30, weight: .bold)).foregroundStyle(muted).frame(width: 140, alignment: .leading)
            ZStack(alignment: .leading) { RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.133, green: 0.149, blue: 0.176)).frame(width: 640); RoundedRectangle(cornerRadius: 8).fill(c).frame(width: max(10, 640 * min(1, f))) }.frame(height: 40)
            Text(value).font(.system(size: 34, weight: .heavy)).foregroundStyle(ui)
        }
    }
    private var trend: some View {
        let rows = v.months + [ReportFigures.MonthRow(label: v.label, api: v.api, plan: v.plan ?? 0, now: true)]
        let top = max(v.proj ?? 0, rows.map(\.api).max() ?? 1, 1) * 1.08
        return ZStack(alignment: .topLeading) {
            Color(red: 0.063, green: 0.067, blue: 0.078)
            VStack(alignment: .leading, spacing: 10) {
                Text(L.t("\(v.label) value \(ReportFormat.times(v.ratio))×", "\(v.label) 본전 \(ReportFormat.times(v.ratio))배")).font(.system(size: 58, weight: .heavy)).foregroundStyle(ui)
                Text(L.t("API prices \(ReportFormat.money(v.api)) · plans \(ReportFormat.money(v.cost))", "API 가격 \(ReportFormat.money(v.api)) · 구독료 \(ReportFormat.money(v.cost))") + (v.proj.map { L.t(" · month end \(ReportFormat.money($0))", " · 월말 예상 \(ReportFormat.money($0))") } ?? ""))
                    .font(.system(size: 32, weight: .semibold)).foregroundStyle(muted)
            }
            .padding(.leading, 72).padding(.top, 52)
            HStack(alignment: .bottom, spacing: 0) {
                ForEach(rows) { r in
                    VStack(spacing: 14) {
                        if r.plan > 0 { Text(ReportFormat.times(r.api / (r.now ? (v.cost ?? r.plan) : r.plan)) + L.t("×", "배")).font(.system(size: 30, weight: .heavy)).foregroundStyle(ReportColor.lcd) }
                        ZStack(alignment: .bottom) {
                            if r.now, let p = v.proj { RoundedRectangle(cornerRadius: 10).stroke(ReportColor.green, style: StrokeStyle(lineWidth: 3, dash: [10, 8])).frame(width: 92, height: 300 * p / top) }
                            UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10).fill(r.now ? ReportColor.green : Color(red: 0.239, green: 0.42, blue: 0.341)).frame(width: 92, height: max(2, 300 * r.api / top))
                        }
                        .frame(height: 300, alignment: .bottom)
                        Text(r.label).font(.system(size: 30, weight: .bold)).foregroundStyle(r.now ? ui : muted)
                    }
                    .frame(width: min(160, 980 / CGFloat(rows.count)))
                }
            }
            .padding(.leading, 72).frame(height: 630, alignment: .bottom).padding(.bottom, 54)
            brand.position(x: 1200 - 72 - 134, y: 66)
        }
    }
    private var strip: some View {
        ZStack(alignment: .topLeading) {
            Color(red: 0.051, green: 0.055, blue: 0.067)
            VStack(alignment: .leading, spacing: 0) {
                Text(L.t("\(v.label), my AI coding on 1top", "\(v.label), 1top으로 본 내 AI 코딩")).font(.system(size: 40, weight: .semibold)).foregroundStyle(muted).padding(.top, 90)
                Text(L.t("\(ReportFormat.times(v.ratio))× my plans", "구독료의 \(ReportFormat.times(v.ratio))배")).font(.system(size: 118, weight: .heavy)).foregroundStyle(ui).padding(.top, 20)
                Text(L.t("\(ReportFormat.money(v.api)) at API prices", "API 가격으로 \(ReportFormat.money(v.api))어치")).font(.system(size: 44, weight: .bold)).foregroundStyle(Color(red: 0.79, green: 0.81, blue: 0.84)).padding(.top, 24)
                if let w { Text(L.t("Agents worked \(ForecastText.duration(w.work)) this week", "이번 주 에이전트 작업 \(ForecastText.duration(w.work))")).font(.system(size: 44, weight: .bold)).foregroundStyle(Color(red: 0.79, green: 0.81, blue: 0.84)).padding(.top, 14) }
                kindsRow().padding(.top, 40)
            }
            .padding(.leading, 72)
            brand.position(x: 1200 - 72 - 134, y: 630 - 66)
        }
    }
}
