import SwiftUI

/// A session in the list: what it is, where it runs, the period's tokens and its pace per hour.
struct SessionRow: View {
    @Environment(AppModel.self) private var model
    var session: Session
    var period: Period
    var body: some View {
        let device = model.device(for: session), fresh = model.isFresh(device)
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 2).fill(Tool.color(session.kind)).frame(width: 4, height: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text([model.toolName(session), Tool.model(session.model), session.displayProject].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Text([device?.name, session.app, session.terminal == session.name ? nil : session.terminal].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                Text(Format.tokens(session.tokens(in: period))).font(.subheadline.weight(.semibold).monospacedDigit())
                Text(fresh ? Format.perHour(session.rate) : "—").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
                HStack(spacing: 4) {
                    StatusGlyph(status: fresh ? session.status : "stale")
                    Text(fresh ? Format.status(session.status) : L.t("Last report ", "마지막 보고 ") + (device.map { L.time($0.receivedDate) } ?? "—"))
                        .font(.caption2).foregroundStyle(fresh && session.isWorking ? .primary : .secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Tells same-tool accounts apart, as the desktop dashboard does: "1", "2", or the account's name.
struct AccountChip: View {
    var text: String
    var body: some View {
        Text(text).font(.system(size: 10, weight: .semibold)).monospacedDigit().lineLimit(1)
            .padding(.horizontal, 4.5).frame(minWidth: 16, minHeight: 15)
            .background(Color.secondary.opacity(0.16), in: RoundedRectangle(cornerRadius: 4))
            .fixedSize()
            .accessibilityLabel(L.t("Account \(text)", "계정 \(text)"))
    }
}

/// State by shape, so colour stays for tools: a moving LCD-green three-bar wave while working, an amber
/// diamond when it needs input, two bars when paused, an empty ring otherwise.
struct StatusGlyph: View {
    var status: String
    var size: CGFloat = 10
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let theme = QuickTheme(light: scheme == .light)
        Group {
            switch status {
            case "working":
                TimelineView(.animation(minimumInterval: 1.0 / 20, paused: reduceMotion)) { timeline in
                    let t = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                    HStack(alignment: .center, spacing: size * 0.14) {
                        ForEach(0..<3, id: \.self) { i in
                            let rest: [Double] = [0.55, 1, 0.75]
                            let level = reduceMotion ? rest[i] : 0.35 + 0.65 * abs(sin(t * 5.2 + Double(i) * 1.1))
                            Capsule().fill(theme.segmentOn).frame(width: size * 0.2, height: size * level)
                        }
                    }
                }
            case "waiting":
                Rectangle().fill(theme.amber).frame(width: size * 0.62, height: size * 0.62).rotationEffect(.degrees(45))
            case "paused":
                HStack(spacing: size * 0.18) {
                    ForEach(0..<2, id: \.self) { _ in RoundedRectangle(cornerRadius: 1).fill(theme.muted).frame(width: size * 0.24, height: size * 0.8) }
                }
            default:
                Circle().stroke(theme.muted, lineWidth: 1.2).frame(width: size * 0.7, height: size * 0.7)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct ConnectionBadge: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        let (label, color): (String, Color) = switch model.connection {
        case .live: (L.t("Live", "실시간"), Color.mint1top)
        case .demo: (L.t("Demo", "데모"), .blue)
        case .connecting: (L.t("Connecting", "연결 중"), .orange)
        case .restricted: (L.t("Access required", "권한 필요"), .orange)
        case .offline: (L.t("Offline", "오프라인"), .orange)
        case .signedOut: (L.t("Sign-in required", "로그인 필요"), .secondary)
        }
        HStack(spacing: 6) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.footnote.weight(.medium))
        }
    }
}
