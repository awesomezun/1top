import AppKit
import SwiftUI

struct CompactTokenMap: View {
    @ObservedObject var model: DashboardModel
    @State private var selected: DesktopUsageMap.Tile?
    @State private var hoveredID: String?
    private let palette: [Color] = [Color(red:0.43,green:0.80,blue:0.66),Color(red:0.51,green:0.65,blue:0.87),
        Color(red:0.74,green:0.60,blue:0.82),Color(red:0.85,green:0.69,blue:0.47),
        Color(red:0.44,green:0.68,blue:0.74),Color(red:0.76,green:0.53,blue:0.60),
        Color(red:0.66,green:0.73,blue:0.47),Color(red:0.60,green:0.65,blue:0.73)]
    private var report: DesktopUsageMap {
        var report = DesktopUsageMap(sessions: model.sessions, period: model.selectedPeriod)
        // The wider map can identify more sessions than the original tiny preview.
        var tiles = model.sessions.compactMap { session -> DesktopUsageMap.Tile? in
            guard session.tokens != nil, let values = session.usage?.windows?[model.selectedPeriod] ?? nil,
                  !values.isEmpty, values.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return nil }
            let value = values.reduce(0, +)
            guard value.isFinite, value > 0 else { return nil }
            let tool = session.kind == "Claude" ? "Claude Code" : session.kind
            return DesktopUsageMap.Tile(id: session.id, title: session.project ?? session.title ?? session.kind,
                detail: [session.locationLabel, tool, session.model].compactMap { $0 }.joined(separator: " · "), value: value)
        }.sorted { $0.value == $1.value ? $0.id < $1.id : $0.value > $1.value }
        if tiles.count > 16 {
            let remaining = Array(tiles.dropFirst(15))
            tiles = Array(tiles.prefix(15)) + [DesktopUsageMap.Tile(id: "__other__", title: "외 \(remaining.count)개",
                detail: remaining.map { "\($0.title) · \(DesktopFormat.number($0.value)) tokens\n\($0.detail)" }.joined(separator: "\n"),
                value: remaining.reduce(0) { $0 + $1.value })]
        }
        report.tiles = report.total > 0 ? tiles : []
        return report
    }
    private func placements(_ data: DesktopUsageMap, size: CGSize) -> [DesktopUsageMap.Placement] {
        guard data.tiles.count >= 4, data.total > 0 else { return data.layout(in: CGRect(origin: .zero, size: size)) }
        // Two weighted bands keep this wide, short surface genuinely two-dimensional.
        // Their area remains exactly proportional to the selected-period token total.
        var sum = 0.0, distance = Double.infinity, cut = 1
        for index in 1..<data.tiles.count {
            sum += data.tiles[index - 1].value
            if abs(sum - data.total / 2) < distance { distance = abs(sum - data.total / 2); cut = index }
        }
        let groups = [Array(data.tiles.prefix(cut)), Array(data.tiles.dropFirst(cut))]
        let indices = Dictionary(uniqueKeysWithValues: data.tiles.enumerated().map { ($0.element.id, $0.offset) })
        var y = 0.0
        return groups.flatMap { tiles -> [DesktopUsageMap.Placement] in
            var band = data; band.tiles = tiles; band.total = tiles.reduce(0) { $0 + $1.value }
            let height = size.height * band.total / data.total
            defer { y += height }
            return band.layout(in: CGRect(x: 0, y: y, width: size.width, height: height)).map { item in
                DesktopUsageMap.Placement(tile: item.tile, rect: item.rect, colorIndex: indices[item.id] ?? 0)
            }
        }
    }
    private func share(_ value: Double, _ total: Double) -> String {
        guard total > 0 else { return "0%" }
        return String(format: "%.0f%%", value / total * 100)
    }
    private func details(_ tile: DesktopUsageMap.Tile, _ total: Double) -> String {
        "\(tile.title)\n\(tile.value.formatted(.number.precision(.fractionLength(0)))) tokens · \(String(format:"%.1f", total > 0 ? tile.value / total * 100 : 0))%\n\(tile.detail)"
    }
    var body: some View {
        let data = report
        VStack(alignment: .leading, spacing: 4) {
            if data.tiles.isEmpty {
                Text(data.reported == 0 ? "이 기간의 사용량 보고가 없습니다" : "이 기간의 보고된 사용량은 0입니다")
                    .font(.system(size: 13)).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 112)
                    .background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 6))
            } else {
                GeometryReader { geometry in
                    ZStack(alignment: .topLeading) {
                        ForEach(placements(data, size: geometry.size)) { item in
                            let width = max(0, item.rect.width - 2), height = max(0, item.rect.height - 2)
                            let tint = palette[item.colorIndex % palette.count]
                            Button { selected = item.tile } label: {
                                ZStack(alignment: .topLeading) {
                                    RoundedRectangle(cornerRadius: 4).fill(tint.opacity(hoveredID == item.id ? 0.32 : 0.17))
                                    if width >= 92 && height >= 42 {
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(item.tile.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                                            Text(share(item.tile.value, data.total)).font(.system(size: 13, weight: .medium)).monospacedDigit().foregroundStyle(tint)
                                        }.padding(4)
                                    } else if width >= 42 && height >= 24 {
                                        Text(share(item.tile.value, data.total))
                                            .font(.system(size: 12, weight: .medium)).foregroundStyle(tint).padding(5)
                                    }
                                }.frame(width: width, height: height).contentShape(Rectangle()).clipped()
                                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(tint.opacity(0.55), lineWidth: 0.7))
                            }.buttonStyle(.plain).offset(x:item.rect.minX, y:item.rect.minY)
                                .onHover { hoveredID = $0 ? item.id : nil }
                                .help(details(item.tile, data.total)).accessibilityLabel(details(item.tile, data.total))
                        }
                    }
                }.frame(height: 112)
            }
        }.frame(height: 112, alignment: .top)
            .help("선택 기간의 현재 세션 \(DesktopFormat.number(data.total)) tokens · 캐시 포함\n색상은 세션별 구분입니다. 작은 영역에 마우스를 올리거나 누르면 세션과 비중을 확인합니다.")
            .popover(item: $selected, arrowEdge: .bottom) { original in
                let current = data.tiles.first { $0.id == original.id } ?? original
                VStack(alignment: .leading, spacing: 8) {
                    Text(current.title).font(.system(size: 15, weight: .semibold))
                    Text("\(share(current.value, data.total)) · \(current.value.formatted(.number.precision(.fractionLength(0)))) tokens").font(.system(size: 17, weight: .semibold)).monospacedDigit()
                    Text(current.detail).font(.system(size: 12)).foregroundStyle(.secondary)
                    if !model.fresh { Text("마지막 수신 기록").font(.system(size: 12)).foregroundStyle(.orange) }
                }.padding(18).frame(width: 290, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            }
    }
}
