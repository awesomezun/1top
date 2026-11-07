import SwiftUI

// Shared identities with the full dashboard: Claude #bd8965, Codex #378d76.
enum AgentPalette {
    static func color(_ kind: String) -> Color {
        let c = rgb(kind)
        return Color(red: c.0 / 255, green: c.1 / 255, blue: c.2 / 255)
    }
    /// The same colours as 0–255 channels, for a tone mixed from one (the cluster's burn figure).
    static func rgb(_ kind: String) -> (Double, Double, Double) {
        switch kind {
        case "Claude", "Claude Code": return (189, 137, 101)
        case "Codex": return (55, 141, 118)
        case "GLM": return (124, 134, 189)
        case "Antigravity": return (97, 157, 185)
        default: return (169, 155, 219)
        }
    }
}
