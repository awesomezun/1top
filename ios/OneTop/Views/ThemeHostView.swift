import SwiftUI
import WebKit

/// The dashboard's theme page (Resources/ThemeHost.html, written by scripts/theme-bundle.mjs) in a web view: it draws the
/// chosen theme from the figures the app hands it (whole, on its side, or only its two headline instruments cut out for
/// a phone held upright: compact), or the gallery of every theme, and posts back what was pressed. The
/// figures go over only when they change (key), so the cluster's quarter-second clock never restarts the needles' glide.
struct ThemeHostView: UIViewRepresentable {
    enum Mode: Equatable { case theme(String), side(String), compact(String), gallery(selected: String?) }
    var mode: Mode
    /// What the figures stand for (the report, the period, the pick, the warning pressed); a new key redraws.
    var key: String
    var figures: () -> [String: Any]
    var onPress: (Press) -> Void = { _ in }
    enum Press { case alert(String), period(String), trip, pick(String?) }

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "onetop")
        let view = WKWebView(frame: .zero, configuration: config)
        view.isOpaque = false; view.backgroundColor = .clear; view.scrollView.backgroundColor = .clear
        view.scrollView.isScrollEnabled = { if case .gallery = mode { true } else { false } }()
        view.scrollView.bounces = false
        view.accessibilityIdentifier = { if case .gallery = mode { "theme-gallery" } else { "cluster-theme" } }()
        if let url = Bundle.main.url(forResource: "ThemeHost", withExtension: "html") { view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent()) }
        context.coordinator.view = view
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.push()
    }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "onetop")
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        var parent: ThemeHostView
        weak var view: WKWebView?
        private var ready = false, sent = ""
        init(_ parent: ThemeHostView) { self.parent = parent }
        /// Draws when the page is ready and the mode or the key has changed since the last drawing.
        func push() {
            guard ready, let view else { return }
            let stamp = "\(parent.mode)|\(parent.key)"
            guard stamp != sent else { return }
            sent = stamp
            let json = ClusterThemeFigures.json(parent.figures())
            switch parent.mode {
            case .theme(let id): view.evaluateJavaScript("OneTopHost.compact(false);OneTopHost.side(false);OneTopHost.draw('\(id)',\(json))")
            case .side(let id): view.evaluateJavaScript("OneTopHost.compact(false);OneTopHost.side(true);OneTopHost.draw('\(id)',\(json))")
            case .compact(let id): view.evaluateJavaScript("OneTopHost.compact(true);OneTopHost.side(false);OneTopHost.draw('\(id)',\(json))")
            case .gallery(let selected):
                let kinds = (try? JSONSerialization.data(withJSONObject: ClusterThemePrefs.kinds)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
                let labels = ["전체", "아날로그", "디지털", "혼합", "1top 기본", "지금의 계기판"].map { "\"\($0)\":\"\(L.t(english($0), $0))\"" }.joined(separator: ",")
                view.evaluateJavaScript("OneTopHost.gallery({figures:\(json),theme:'\(selected ?? "")',kinds:\(kinds),labels:{\(labels)}})")
            }
        }
        private func english(_ ko: String) -> String {
            ["전체": "All", "아날로그": "Analog", "디지털": "Digital", "혼합": "Mixed", "1top 기본": "1top default", "지금의 계기판": "Current cluster"][ko] ?? ko
        }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            if body["ready"] != nil { ready = true; sent = ""; push(); return }
            if let a = body["alert"] as? String { parent.onPress(.alert(a)) }
            else if let p = body["period"] as? String { parent.onPress(.period(p)) }
            else if body["trip"] != nil { parent.onPress(.trip) }
            else if let p = body["pick"] as? String { parent.onPress(.pick(p.isEmpty ? nil : p)) }
        }
    }
}
