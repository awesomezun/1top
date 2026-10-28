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
    private var report: DesktopUsageMap { DesktopUsageMap(sessions: model.sessions, period: model.selectedPeriod) }
    private func details(_ tile: DesktopUsageMap.Tile, _ total: Double) -> String {
        "\(tile.title)\n\(tile.value.formatted(.number.precision(.fractionLength(0)))) tokens · \(String(format:"%.1f", total > 0 ? tile.value / total * 100 : 0))%\n\(tile.detail)"
    }
    var body: some View {
        let data = report
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("사용량 비중").font(.plex(size: 12, weight: .medium))
                Spacer()
                Image(systemName: "info.circle").font(.system(size: 12)).foregroundStyle(.secondary)
                    .help("선택한 기간 · 현재 연결된 세션만 비교\n보고 \(data.reported) · 미보고 \(data.unknown) · 0 사용량 \(data.zero) · 캐시 포함\n작은 영역은 마우스를 올리거나 눌러 확인하세요.")
            }
            if data.tiles.isEmpty {
                Text(data.reported == 0 ? "이 기간의 사용량 보고가 없습니다" : "이 기간의 보고된 사용량은 0입니다")
                    .font(.plex(size: 12)).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 64)
                    .background(Color.white.opacity(0.025), in: RoundedRectangle(cornerRadius: 6))
            } else {
                GeometryReader { geometry in
                    ZStack(alignment: .topLeading) {
                        ForEach(data.layout(in: CGRect(origin: .zero, size: geometry.size))) { item in
                            let width = max(0, item.rect.width - 2), height = max(0, item.rect.height - 2)
                            let tint = palette[item.colorIndex % palette.count]
                            let font = NSFont(name: "IBMPlexSansKR-SemiBold", size: 12) ?? .systemFont(ofSize: 11)
                            let titleWidth = (item.tile.title as NSString).size(withAttributes: [.font:font]).width
                            Button { selected = item.tile } label: {
                                ZStack(alignment: .topLeading) {
                                    RoundedRectangle(cornerRadius: 4).fill(tint.opacity(hoveredID == item.id ? 0.32 : 0.17))
                                    if width >= 64 && height >= 48 {
                                        VStack(alignment: .leading, spacing: 3) {
                                            if titleWidth <= width - 14 { Text(item.tile.title).font(.plex(size: 12, weight: .semibold)).fixedSize() }
                                            Text(DesktopFormat.number(item.tile.value)).font(.plex(size: 12, weight: .medium)).monospacedDigit().foregroundStyle(tint)
                                        }.padding(7)
                                    } else if width >= 38 && height >= 24 {
                                        Text("\(Int((item.tile.value / data.total * 100).rounded()))%")
                                            .font(.plex(size: 12, weight: .medium)).foregroundStyle(tint).padding(5)
                                    }
                                }.frame(width: width, height: height).contentShape(Rectangle())
                                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(tint.opacity(0.55), lineWidth: 0.7))
                            }.buttonStyle(.plain).offset(x:item.rect.minX, y:item.rect.minY)
                                .onHover { hoveredID = $0 ? item.id : nil }
                                .help(details(item.tile, data.total)).accessibilityLabel(details(item.tile, data.total))
                        }
                    }
                }.frame(height: 64)
            }
            Text("\(DesktopFormat.number(data.total)) tokens").font(.plex(size: 12)).foregroundStyle(.secondary).monospacedDigit()
        }
            .popover(item: $selected, arrowEdge: .bottom) { original in
                let current = data.tiles.first { $0.id == original.id } ?? original
                VStack(alignment: .leading, spacing: 8) {
                    Text(current.title).font(.plex(size: 15, weight: .semibold))
                    Text("\(current.value.formatted(.number.precision(.fractionLength(0)))) tokens").font(.plex(size: 17, weight: .semibold)).monospacedDigit()
                    Text(current.detail).font(.plex(size: 12)).foregroundStyle(.secondary)
                    if !model.fresh { Text("마지막 수신 기록").font(.plex(size: 12)).foregroundStyle(.orange) }
                }.padding(18).frame(width: 290, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            }
    }
}
