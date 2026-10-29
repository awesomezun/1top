import SwiftUI

/// The app speaks Korean, English or Simplified Chinese, chosen on the dashboard or in Settings and
/// remembered on this iPhone.
enum Language: String, CaseIterable, Identifiable, Sendable {
    case ko, en, zh
    var id: String { rawValue }
    var name: String {
        switch self {
        case .ko: "한국어"
        case .en: "English"
        case .zh: "中文"
        }
    }

    /// The mark on the one-tap language button: 한, EN, 中.
    var mark: String {
        switch self {
        case .ko: "한"
        case .en: "EN"
        case .zh: "中"
        }
    }
    /// One tap moves on in a fixed order, 한 → EN → 中 → 한, as on the desktop dashboard.
    var next: Language { let all = Language.allCases; return all[(all.firstIndex(of: self)! + 1) % all.count] }

    static var saved: Language {
        if let raw = UserDefaults.standard.string(forKey: "language"), let value = Language(rawValue: raw) { return value }
        // Korean until chosen otherwise, as the app has always opened.
        return .ko
    }
    func save() { UserDefaults.standard.set(rawValue, forKey: "language") }
}

/// Light, dark, or whatever the iPhone uses; remembered like the language.
enum Appearance: String, CaseIterable, Identifiable, Sendable {
    case system, light, dark
    var id: String { rawValue }
    var label: String {
        switch self {
        case .system: L.t("System", "시스템")
        case .light: L.t("Light", "라이트")
        case .dark: L.t("Dark", "다크")
        }
    }
    var scheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }

    static var saved: Appearance {
        UserDefaults.standard.string(forKey: "appearance").flatMap(Appearance.init) ?? .system
    }
    func save() { UserDefaults.standard.set(rawValue, forKey: "appearance") }
}

/// The language every label reads. Observable, so any view whose body calls `L.t` redraws when it
/// changes, without rebuilding the tree: scroll positions, sheets and selections stay.
@Observable final class LanguageBox: @unchecked Sendable {
    var language = Language.saved
}

/// Every label goes through `L.t(english, korean)`. Chinese is looked up by the English text in
/// `Chinese`, so the call sites stay two-language.
enum L {
    static let box = LanguageBox()
    static var language: Language {
        get { box.language }
        set { box.language = newValue }
    }
    static func t(_ en: String, _ ko: String) -> String {
        switch language {
        case .ko: ko
        case .en: en
        case .zh: Chinese.text(en)
        }
    }
    static var locale: Locale {
        switch language {
        case .ko: Locale(identifier: "ko_KR")
        case .en: Locale(identifier: "en_US")
        case .zh: Locale(identifier: "zh_CN")
        }
    }

    /// Clock time for today's reports, date and time for older ones.
    static func time(_ date: Date, now: Date = Date()) -> String {
        let style = Date.FormatStyle(date: Calendar.current.isDate(date, inSameDayAs: now) ? .omitted : .abbreviated, time: .shortened).locale(locale)
        return date.formatted(style)
    }
}
