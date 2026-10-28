import SwiftUI

// Shared identities with the full dashboard: Claude #bd8965, Codex #378d76.
enum AgentPalette {
    static func color(_ kind: String) -> Color {
        switch kind {
        case "Claude", "Claude Code": return Color(red: 189/255, green: 137/255, blue: 101/255)
        case "Codex": return Color(red: 55/255, green: 141/255, blue: 118/255)
        case "GLM": return Color(red: 124/255, green: 134/255, blue: 189/255)
        case "Antigravity": return Color(red: 97/255, green: 157/255, blue: 185/255)
        default: return Color(red: 169/255, green: 155/255, blue: 219/255)
        }
    }
}
