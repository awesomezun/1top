import SwiftUI

struct SessionRow: View {
    var session: Session
    var period: Period
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(Tool.color(session.kind)).frame(width: 4, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text([Tool.name(session.kind), Tool.model(session.model), session.displayProject].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(Format.tokens(session.tokens(in: period))).font(.subheadline.weight(.semibold).monospacedDigit())
                Text(Format.status(session.status)).font(.caption2).foregroundStyle(session.isWorking ? Color.mint1top : .secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct ConnectionBadge: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let (label, color): (String, Color) = switch model.connection {
        case .live: ("실시간", Color.mint1top)
        case .demo: ("데모", .blue)
        case .connecting: ("연결 중", .orange)
        case .restricted: ("권한 필요", .orange)
        case .offline: ("오프라인", .orange)
        case .signedOut: ("로그인 필요", .secondary)
        }
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.footnote.weight(.medium))
        }
    }
}
