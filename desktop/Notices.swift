import Foundation
import UserNotifications

/// The collector decides when to tell (report-contract v1.2.0 `notices`: a weekly limit that runs out before its
/// reset, last week's summary); the app shows each one once as a macOS notification. Switching a kind off is the
/// collector's setting, so the dashboard, this app and Windows agree.
enum Notices {
    private static let shownKey = "noticesShown"
    private static var asked = false

    static func show(_ list: [DesktopSnapshot.Notice]?, now: Double = Date().timeIntervalSince1970) {
        guard let list, !list.isEmpty else { return }
        let defaults = UserDefaults.standard
        var shown = defaults.stringArray(forKey: shownKey) ?? []
        // Only what is new and recent: a notice an hour old is history by the time the app starts.
        let fresh = list.filter { !shown.contains($0.id) && now - ($0.at ?? 0) < 3600 }
        guard !fresh.isEmpty else { return }
        shown.append(contentsOf: fresh.map(\.id)); defaults.set(Array(shown.suffix(100)), forKey: shownKey)
        let center = UNUserNotificationCenter.current()
        let post = {
            for n in fresh {
                let content = UNMutableNotificationContent()
                let (title, body) = text(n, lang: QuickText.current.lang)
                content.title = title ?? "1top"; content.body = body ?? ""; content.sound = .default
                content.threadIdentifier = n.type ?? "notice"
                center.add(UNNotificationRequest(identifier: "onetop." + n.id, content: content, trigger: nil))
            }
        }
        if asked { post(); return }
        asked = true
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in if granted { post() } }
    }

    /// A notice's title and body in the dashboard's language. The collector writes them in Korean and sends the numbers
    /// with them, which make the English and the Chinese (the Windows app does the same, agent/onetop/windows_notices.py).
    static func text(_ n: DesktopSnapshot.Notice, lang: String) -> (String?, String?) {
        guard lang == "en" || lang == "zh", let at = n.at else { return (n.title, n.body) }
        let zh = lang == "zh"
        if n.type == "limit", let end = n.end, let reset = n.reset {
            let name = n.account_label ?? n.kind ?? "1top", at = when(end, now: at, zh: zh), early = duration(reset - end, zh: zh)
            return zh ? ("\(name) 额度将在重置前用尽", "按此速度将在\(at)用尽 · 比重置早 \(early)")
                : ("\(name) runs out before its reset", "At this pace it runs out \(at) · \(early) before the reset")
        }
        if n.type == "weekly", let work = n.working_s, let wait = n.waiting_s {
            let month = Calendar.current.component(.month, from: Date(timeIntervalSince1970: at))
            if zh { return ("上周智能体工作 \(duration(work, zh: true))", "等你的时间 \(duration(wait, zh: true))" + (n.ratio.map { String(format: " · %d月 回本 %.1f 倍", month, $0) } ?? "")) }
            let name = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]
            return ("Agents worked \(duration(work, zh: false)) last week", "Waiting for you \(duration(wait, zh: false))" + (n.ratio.map { String(format: " · %@ value %.1f×", name, $0) } ?? ""))
        }
        return (n.title, n.body)
    }
    private static func duration(_ s: Double, zh: Bool) -> String {
        let m = max(0, Int((s / 60).rounded())), h = m / 60, r = m % 60
        if zh { return h > 0 && r > 0 ? "\(h)小时\(r)分钟" : h > 0 ? "\(h)小时" : "\(r)分钟" }
        return h > 0 && r > 0 ? "\(h)h \(r)m" : h > 0 ? "\(h)h" : "\(r)m"
    }
    /// Today, tomorrow, a weekday within the week, else a date; English reads "today at 3:00 PM".
    private static func when(_ t: Double, now: Double, zh: Bool) -> String {
        let cal = Calendar.current, d = Date(timeIntervalSince1970: t), locale = Locale(identifier: zh ? "zh_CN" : "en_US")
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date(timeIntervalSince1970: now)), to: cal.startOfDay(for: d)).day ?? 0
        let day = days == 0 ? (zh ? "今天" : "today") : days == 1 ? (zh ? "明天" : "tomorrow")
            : days < 7 ? d.formatted(.dateTime.weekday(.wide).locale(locale)) : d.formatted(.dateTime.month(.abbreviated).day().locale(locale))
        let time = d.formatted(.dateTime.hour().minute().locale(locale))
        return zh ? "\(day) \(time)" : "\(day) at \(time)"
    }
}
