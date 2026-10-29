import SwiftUI

/// Usage share: the period's tokens as areas, by session, app, tool or model, the same split as
/// the Android app and the web. Only sessions on computers that are reporting now count.
struct UsageView: View {
    enum Grouping: String, CaseIterable, Identifiable {
        case session, app, tool, model
        var id: String { rawValue }
        var label: String {
            switch self {
            case .session: L.t("Sessions", "세션")
            case .app: L.t("Apps", "실행 앱")
            case .tool: L.t("Tools", "실행 도구")
            case .model: L.t("Models", "모델")
            }
        }
    }
    struct Tile: Identifiable, Hashable {
        var id: String
        var label: String
        var value: Double
        var detail: String
        var color: Color
        var share: Double = 0
        var frame: CGRect = .zero
    }
    static let palette: [Color] = [Color(red: 0.459, green: 0.796, blue: 0.694), Color(red: 0.525, green: 0.651, blue: 0.875),
                                   Color(red: 0.741, green: 0.608, blue: 0.859), Color(red: 0.867, green: 0.718, blue: 0.467),
                                   Color(red: 0.514, green: 0.725, blue: 0.780), Color(red: 0.812, green: 0.576, blue: 0.612)]

    @Environment(AppModel.self) private var model
    @State private var grouping: Grouping = .session
    @State private var picked: Tile?

    private struct Summary { var tiles: [Tile]; var sum: Double?; var known: Int; var unknown: Int; var zero: Int }

    private func summary() -> Summary {
        var groups: [String: Tile] = [:], order: [String] = []
        var known = 0, unknown = 0, zero = 0
        for s in model.allSessions where model.isFresh(model.device(for: s)) {
            guard let value = s.tokens(in: model.period) else { unknown += 1; continue }
            known += 1
            if value == 0 { zero += 1; continue }
            let tool = s.kind == "Aside" ? "" : Tool.name(s.kind == "GLM" ? "Claude" : s.kind)
            let id: String = switch grouping {
            case .app: s.app ?? L.t("App unreported", "앱 미보고")
            case .tool: tool.isEmpty ? L.t("In-app runtime unreported", "실행 도구 미보고") : tool
            case .model: s.model ?? L.t("Model unreported", "모델 미보고")
            case .session: s.key
            }
            let detail = [model.device(for: s)?.name, s.app, s.terminal, tool, s.model].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if groups[id] != nil { groups[id]!.value += value }
            else { groups[id] = Tile(id: id, label: grouping == .session ? (s.displayProject ?? s.name) : id, value: value, detail: detail, color: .gray); order.append(id) }
        }
        var tiles = order.compactMap { groups[$0] }.sorted { $0.value > $1.value }
        let sum = tiles.reduce(0) { $0 + $1.value }
        if tiles.count > 32 {
            let rest = tiles[31...].reduce(0) { $0 + $1.value }
            tiles = Array(tiles.prefix(31)) + [Tile(id: "other", label: L.t("Other sessions", "기타 세션"), value: rest, detail: "", color: .gray)]
        }
        tiles = tiles.enumerated().map { i, t in var t = t; t.color = Self.palette[i % Self.palette.count]; t.share = sum > 0 ? t.value / sum * 100 : 0; return t }
        return Summary(tiles: tiles, sum: known > 0 ? sum : nil, known: known, unknown: unknown, zero: zero)
    }

    /// Splits the list where the two halves are closest in total, along the longer side.
    static func layout(_ tiles: [Tile], in rect: CGRect) -> [Tile] {
        var out: [Tile] = []
        func split(_ nodes: ArraySlice<Tile>, _ r: CGRect) {
            guard let first = nodes.first else { return }
            if nodes.count == 1 { var t = first; t.frame = r; out.append(t); return }
            let sum = nodes.reduce(0) { $0 + $1.value }
            var part = 0.0, best = Double.infinity, cut = nodes.startIndex + 1
            for i in (nodes.startIndex + 1)..<nodes.endIndex {
                part += nodes[i - 1].value
                let distance = abs(sum / 2 - part)
                if distance < best { best = distance; cut = i }
            }
            let a = nodes[nodes.startIndex..<cut], b = nodes[cut..<nodes.endIndex], ratio = a.reduce(0) { $0 + $1.value } / sum
            if r.width >= r.height {
                split(a, CGRect(x: r.minX, y: r.minY, width: r.width * ratio, height: r.height))
                split(b, CGRect(x: r.minX + r.width * ratio, y: r.minY, width: r.width * (1 - ratio), height: r.height))
            } else {
                split(a, CGRect(x: r.minX, y: r.minY, width: r.width, height: r.height * ratio))
                split(b, CGRect(x: r.minX, y: r.minY + r.height * ratio, width: r.width, height: r.height * (1 - ratio)))
            }
        }
        split(ArraySlice(tiles.filter { $0.value.isFinite && $0.value > 0 }), rect)
        return out
    }

    var body: some View {
        @Bindable var model = model
        let data = summary()
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ConnectionNotice()
                    Picker(L.t("Period", "기간"), selection: $model.period) { ForEach(Period.allCases) { Text($0.label).tag($0) } }
                        .pickerStyle(.segmented)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L.t("Last \(model.period.label) · reported tokens, including cache", "최근 \(model.period.label) · 보고된 토큰 · 캐시 포함"))
                            .font(.footnote).foregroundStyle(.secondary)
                        Text(Format.tokens(data.sum)).font(.system(size: 34, weight: .semibold)).monospacedDigit()
                    }
                    Picker(L.t("Group by", "분류"), selection: $grouping) { ForEach(Grouping.allCases) { Text($0.label).tag($0) } }
                        .pickerStyle(.segmented)
                    if data.tiles.isEmpty {
                        ContentUnavailableView(L.t("No positive reported usage in this period.", "이 기간에 보고된 양의 사용량이 없습니다."), systemImage: "square.grid.2x2")
                    } else {
                        map(data.tiles)
                        Text(L.t("Tap any area for the full label and exact token count.", "영역을 누르면 전체 이름과 정확한 토큰 수가 표시됩니다."))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Text(L.t("\(data.known) reported · \(data.unknown) unknown · \(data.zero) zero", "보고 \(data.known) · 미보고 \(data.unknown) · 사용량 0 세션 \(data.zero)"))
                        .font(.footnote).monospacedDigit().foregroundStyle(.secondary)
                    Text(L.t("Current fresh sessions only. This is not a billing amount.", "현재 최신 정보가 있는 세션 기준입니다. 청구 금액이 아닙니다."))
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .navigationTitle(L.t("Usage share", "사용량 비율"))
            .toolbar { if model.devices.count > 1 { ToolbarItem(placement: .topBarTrailing) { Menu { ComputerPicker() } label: { Image(systemName: "desktopcomputer") } } } }
            .sheet(item: $picked) { tile in
                NavigationStack {
                    List {
                        LabeledContent(L.t("Tokens", "토큰"), value: tile.value.formatted(.number.precision(.fractionLength(0))))
                        LabeledContent(L.t("Share", "비중"), value: tile.share.formatted(.number.precision(.fractionLength(2))) + "%")
                        if !tile.detail.isEmpty { Text(tile.detail).foregroundStyle(.secondary) }
                    }
                    .navigationTitle(tile.label).navigationBarTitleDisplayMode(.inline)
                }
                .presentationDetents([.medium])
            }
        }
    }

    private func map(_ tiles: [Tile]) -> some View {
        GeometryReader { geo in
            let laid = Self.layout(tiles, in: CGRect(origin: .zero, size: geo.size))
            ZStack(alignment: .topLeading) {
                ForEach(laid) { tile in
                    let show = tile.frame.width > 96 && tile.frame.height > 64
                    Button { picked = tile } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            if show {
                                Text(tile.label).font(.footnote.weight(.semibold)).lineLimit(2).foregroundStyle(.primary)
                                Spacer(minLength: 0)
                                Text(Format.tokens(tile.value)).font(.footnote.weight(.medium)).monospacedDigit().foregroundStyle(tile.color)
                            }
                        }
                        .padding(8)
                        .frame(width: max(0, tile.frame.width - 3), height: max(0, tile.frame.height - 3), alignment: .topLeading)
                        .background(tile.color.opacity(0.2), in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(tile.color.opacity(0.9), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .offset(x: tile.frame.minX, y: tile.frame.minY)
                    .accessibilityLabel(tile.label + ", " + Format.tokens(tile.value) + " tokens")
                }
            }
        }
        .frame(height: 260)
    }
}
