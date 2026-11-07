import AppKit
import CoreText
import SwiftUI

enum OneTopTypography {
    static func registerFonts() {
        guard let directory = Bundle.main.resourceURL?.appendingPathComponent("Fonts"),
              let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for file in files where file.pathExtension == "ttf" {
            CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
        }
    }
    static func name(for weight: Font.Weight) -> String {
        switch weight {
        case .bold, .heavy, .black: return "IBMPlexSansKR-Bold"
        case .semibold: return "IBMPlexSansKR-SemiBold"
        case .medium: return "IBMPlexSansKR-Medium"
        default: return "IBMPlexSansKR-Regular"
        }
    }
}

extension Font {
    static func plex(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        .custom(OneTopTypography.name(for: weight), size: size)
    }
}
