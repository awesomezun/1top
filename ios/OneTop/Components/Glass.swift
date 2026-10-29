import SwiftUI

/// One choice among a few, on Liquid Glass: the options sit as text on one regular glass capsule,
/// and the selected one is a tinted, interactive glass capsule that morphs to the next choice.
/// With Reduce Motion the selection moves without the morph; with Reduce Transparency the system
/// draws the glass opaque.
struct GlassSegments<Value: Hashable>: View {
    struct Item {
        var value: Value
        var label: String
        /// Read by VoiceOver instead of the label, e.g. "Last 10m" for "10m".
        var spoken: String?
        var identifier: String?
    }

    var items: [Item]
    @Binding var selection: Value
    var height: CGFloat = 32

    @Namespace private var glass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var scheme

    /// A neutral tint keeps the selection readable in both modes without borrowing a tool colour.
    private var tint: Color { scheme == .dark ? Color.white.opacity(0.18) : Color.black.opacity(0.07) }

    var body: some View {
        GlassEffectContainer(spacing: 6) {
            HStack(spacing: 0) {
                ForEach(items, id: \.value) { item in
                    let selected = item.value == selection
                    Button {
                        guard !selected else { return }
                        if reduceMotion { selection = item.value } else { withAnimation(.bouncy(duration: 0.32)) { selection = item.value } }
                    } label: {
                        Text(item.label)
                            .font(.system(size: 12.5, weight: selected ? .semibold : .medium))
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .foregroundStyle(selected ? Color.primary : Color.secondary)
                            // Only the capsule morphs. Interpolating the weight change drew Hangul half-way
                            // ("10" for "10분") for a moment, so the text switches at once.
                            .contentTransition(.identity)
                            .transaction { $0.animation = nil }
                            .frame(maxWidth: .infinity).frame(height: height - 6)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .background {
                        if selected {
                            Color.clear
                                .glassEffect(.regular.tint(tint).interactive(), in: .capsule)
                                .glassEffectID("selection", in: glass)
                        }
                    }
                    .accessibilityLabel(item.spoken ?? item.label)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityIdentifier(item.identifier ?? "")
                }
            }
            .padding(3)
            .glassEffect(.regular, in: .capsule)
        }
    }
}

extension GlassSegments where Value == Period {
    /// The six periods, as on every screen that has a period.
    static func periods(_ selection: Binding<Period>, height: CGFloat = 32) -> GlassSegments<Period> {
        GlassSegments(items: Period.allCases.map { .init(value: $0, label: $0.label, spoken: L.t("Last \($0.label)", "최근 \($0.label)"), identifier: "period-" + $0.rawValue) },
                      selection: selection, height: height)
    }
}
