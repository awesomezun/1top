import Foundation

/// The app speaks Korean or English, chosen in Settings and remembered on this iPhone.
enum Language: String, CaseIterable, Identifiable, Sendable {
    case ko, en
    var id: String { rawValue }
    var name: String { self == .ko ? "한국어" : "English" }

    static var saved: Language {
        if let raw = UserDefaults.standard.string(forKey: "language"), let value = Language(rawValue: raw) { return value }
        // Korean until chosen otherwise, as the app has always opened; English is one tap away.
        return .ko
    }
    func save() { UserDefaults.standard.set(rawValue, forKey: "language") }
}

/// Every label goes through `L.t(english, korean)`. The root view is rebuilt when the language
/// changes, so helpers outside views read the same choice.
enum L {
    nonisolated(unsafe) static var ko = Language.saved == .ko
    static func t(_ en: String, _ ko: String) -> String { self.ko ? ko : en }
    static var locale: Locale { Locale(identifier: ko ? "ko_KR" : "en_US") }

    /// Clock time for today's reports, date and time for older ones.
    static func time(_ date: Date, now: Date = Date()) -> String {
        let style = Date.FormatStyle(date: Calendar.current.isDate(date, inSameDayAs: now) ? .omitted : .abbreviated, time: .shortened).locale(locale)
        return date.formatted(style)
    }
}
