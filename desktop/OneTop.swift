import AppKit
import SwiftUI
import WebKit

// One zoom for the whole app: the dashboard window's page zoom and the quick view's sizes.
// UI tests keep it in memory so they never change the saved setting.
final class AppZoom: ObservableObject {
    static let range = 0.8...1.6
    @Published private(set) var value: Double
    var onChange: (() -> Void)?
    private let persist: Bool
    init(persist: Bool) {
        self.persist = persist
        let saved = persist ? UserDefaults.standard.double(forKey: "dashboardZoom") : 0
        value = saved == 0 ? 1 : min(Self.range.upperBound, max(Self.range.lowerBound, saved))
    }
    // Tenths only, so repeated steps land on 0.8, 0.9 … 1.6.
    func set(_ next: Double) {
        let clamped = min(Self.range.upperBound, max(Self.range.lowerBound, (next * 10).rounded() / 10))
        guard clamped != value else { return }
        value = clamped
        if persist { UserDefaults.standard.set(clamped, forKey: "dashboardZoom") }
        onChange?()
    }
}

@main
final class OneTopApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, NSToolbarDelegate {
    static func main() {
        let app = NSApplication.shared; let delegate = OneTopApp(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
    var statusItem: NSStatusItem!; var popover: NSPopover!; var window: NSWindow?
    var webView: WKWebView?; var loadingLabel: NSTextField?; var process: Process?; var timer: Timer?
    var ticks = 0; var webLoaded = false; var webLoading = false; var stopping = false
    let dataDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/1top")
    let loginAgent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/si.1top.companion.plist")
    let testing = CommandLine.arguments.contains("--ui-test")
    lazy var zoom = AppZoom(persist: !testing)
    var popoverScreen: NSScreen?
    lazy var model: DashboardModel = {
        // Test fixtures never run the collector or control real sessions.
        let value = testing ? ProcessInfo.processInfo.environment["ONETOP_UI_TEST_PORT"] : nil
        let port = value.flatMap(Int.init).flatMap { (1024...65535).contains($0) ? $0 : nil } ?? 18766
        return DashboardModel(baseURL: URL(string: "http://127.0.0.1:\(port)")!)
    }()
    func applicationDidFinishLaunching(_ notification: Notification) {
        if !testing, NSRunningApplication.runningApplications(withBundleIdentifier: "si.1top.companion").contains(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) { NSApp.terminate(nil); return }
        NSApp.setActivationPolicy(.accessory); NSApp.appearance = NSAppearance(named: .darkAqua)
        if !testing { try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        makeMainMenu()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.title = ""; button.image = NSImage(systemSymbolName: "waveform.path", accessibilityDescription: "1top")
            button.image?.isTemplate = true; button.imagePosition = .imageOnly
            button.target = self; button.action = #selector(togglePopover); button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.setAccessibilityLabel(QuickText.current("1top 간략 대시보드"))
        }
        model.openAtLogin = FileManager.default.fileExists(atPath: loginAgent.path)
        popover = NSPopover(); popover.behavior = .transient; popover.animates = true
        popover.appearance = NSAppearance(named: .darkAqua)
        let quick = NSHostingController(rootView: QuickDashboard(
            model: model, zoom: zoom, openDashboard: { [weak self] in self?.showDashboard() },
            openBrowser: { [weak self] in self?.openBrowser() }, remoteOptions: { [weak self] in self?.remoteDashboard() },
            connectRemote: { [weak self] in self?.connectDialog() }, toggleLogin: { [weak self] in self?.toggleLogin() },
            restart: { [weak self] in self?.launch(pair: false) }, quit: { NSApp.terminate(nil) },
            control: { [weak self] action, session in self?.control(action, session: session) },
            switchTheme: { [weak self] in self?.switchTheme() }, switchLanguage: { [weak self] in self?.switchLanguage() }))
        // The popover size comes from the zoom and the screen, not from the SwiftUI content.
        quick.sizingOptions = []
        popover.contentViewController = quick
        zoom.onChange = { [weak self] in self?.zoomChanged() }
        model.onUpdate = { [weak self] in self?.updated() }
        if !testing { launch(pair: false) }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }; self.model.tick(); self.ticks += 1
            let interval = self.popover.isShown || !self.model.fresh ? 3 : 15
            if self.ticks % interval == 0 { self.model.refresh() }; self.updateStatusTitle()
        }
        model.refresh()
        if CommandLine.arguments.contains("--quick-view") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.showPopover() }
        } else { showDashboard() }
    }
    // Built again when the language changes, so the menus follow the dashboard's language.
    func makeMainMenu() {
        let main = NSMenu(); let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(title: "1top"); appItem.submenu = appMenu
        add("전체 대시보드", #selector(showDashboard), "o", appMenu)
        add("간략 대시보드", #selector(togglePopover), "1", appMenu); appMenu.addItem(.separator())
        add("업데이트 확인…", #selector(checkUpdate), "", appMenu)
        add("1top 가리기", #selector(NSApplication.hide(_:)), "h", appMenu, NSApp)
        add("1top 종료", #selector(NSApplication.terminate(_:)), "q", appMenu, NSApp)
        let t = QuickText.current
        let editItem = NSMenuItem(); main.addItem(editItem); let edit = NSMenu(title: t("편집")); editItem.submenu = edit
        for (title, selector, key) in [("실행 취소", "undo:", "z"), ("잘라내기", "cut:", "x"), ("복사", "copy:", "c"), ("붙여넣기", "paste:", "v"), ("전체 선택", "selectAll:", "a")] {
            edit.addItem(withTitle: t(title), action: Selector(selector), keyEquivalent: key)
        }
        let viewItem = NSMenuItem(); main.addItem(viewItem); let view = NSMenu(title: t("보기")); viewItem.submenu = view
        add("새로고침", #selector(reloadDashboard), "r", view)
        add("확대", #selector(zoomIn), "+", view); add("축소", #selector(zoomOut), "-", view)
        add("기본 크기", #selector(resetZoom), "0", view); add("창 닫기", #selector(closeDashboard), "w", view)
        NSApp.mainMenu = main
    }
    func add(_ title: String, _ action: Selector, _ key: String, _ menu: NSMenu, _ target: AnyObject? = nil) {
        let item = menu.addItem(withTitle: QuickText.current(title), action: action, keyEquivalent: key); item.target = target ?? self
    }
    @objc func checkUpdate() {
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:18766/api/updates")!) { data, _, _ in
            let value = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async {
                let alert = NSAlert(); let version = value?["version"] as? String, t = QuickText.current
                alert.messageText = value?["available"] as? Bool == true ? "\(t("새 버전")) \(version ?? "")" : t("1top 업데이트")
                alert.informativeText = version == nil ? t("업데이트 정보를 확인할 수 없습니다.") : "\(t("설치 버전")): \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") · \(t("배포 버전")): \(version!). \(t("미리보기 설치본은 자동 교체하지 않습니다."))"
                alert.addButton(withTitle: t("배포 페이지 열기")); alert.addButton(withTitle: t("닫기"))
                if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(URL(string: "https://github.com/awesomezun/1top/releases")!) }
            }
        }.resume()
    }
    func updateStatusTitle() {
        statusItem.button?.title = ""
        let t = QuickText.current
        statusItem.button?.toolTip = "\(t(model.connectionLabel)) · \(t.working(model.working)) / \(t("전체")) \(model.sessions.count)"
    }
    func updated() {
        updateStatusTitle()
        syncDashboardAppearance()
        if model.connected, window != nil, !webLoaded, !webLoading { loadDashboard() }
        if !model.connected, !webLoaded { loadingLabel?.stringValue = QuickText.current("로컬 수집기에 연결하고 있습니다…\n연결되면 대시보드가 자동으로 열립니다.\n간략 보기의 수집기 다시 시작을 사용할 수 있습니다.") }
    }
    // The dashboard keeps its theme and language in its own storage; the quick view and the menus follow them.
    func syncDashboardAppearance() {
        guard webLoaded, !pushingPreferences, let webView else { return }
        webView.evaluateJavaScript("(()=>{try{const s=JSON.parse(localStorage.getItem('onetop.dashboard.v1')||'{}')||{};return [s.theme||'dark',s.lang||'ko']}catch(e){return ['dark','ko']}})()") { [weak self] value, _ in
            guard let self, !self.pushingPreferences, let pair = value as? [String], pair.count == 2 else { return }
            let theme = pair[0] == "light" ? "light" : "dark", lang = QuickText(pair[1]).lang
            self.applyAppearance(theme)
            guard !self.testing else { return }
            if UserDefaults.standard.string(forKey: "dashboardTheme") != theme { UserDefaults.standard.set(theme, forKey: "dashboardTheme") }
            if QuickText.current.lang != lang { UserDefaults.standard.set(lang, forKey: "dashboardLanguage"); self.languageChanged() }
        }
    }
    func applyAppearance(_ theme: String) {
        let appearance = NSAppearance(named: theme == "light" ? .aqua : .darkAqua)
        window?.appearance = appearance; popover?.appearance = appearance
        window?.backgroundColor = theme == "light" ? .windowBackgroundColor : NSColor(calibratedWhite: 0.055, alpha: 1)
        webView?.underPageBackgroundColor = window?.backgroundColor
    }
    // MARK: Theme and language from the quick view
    var pushingPreferences = false
    var revealOverlay: NSView?
    /// A choice made while the dashboard window was closed waits here for its next page load.
    var pendingPreferences: Bool {
        get { UserDefaults.standard.bool(forKey: "dashboardPreferencesPending") }
        set { UserDefaults.standard.set(newValue, forKey: "dashboardPreferencesPending") }
    }
    var currentTheme: String { UserDefaults.standard.string(forKey: "dashboardTheme") == "light" ? "light" : "dark" }
    func switchTheme() {
        reveal(language: false) { UserDefaults.standard.set(self.currentTheme == "light" ? "dark" : "light", forKey: "dashboardTheme") }
    }
    func switchLanguage() {
        let order = QuickText.languages, at = order.firstIndex(of: QuickText.current.lang) ?? 0
        reveal(language: true) { UserDefaults.standard.set(order[(at + 1) % order.count], forKey: "dashboardLanguage"); self.languageChanged() }
    }
    static func storeScript(theme: String, lang: String) -> String {
        "(()=>{const k='onetop.dashboard.v1';let s={};try{s=JSON.parse(localStorage.getItem(k)||'{}')||{}}catch(e){}s.theme='\(theme)';s.lang='\(lang)';try{localStorage.setItem(k,JSON.stringify(s))}catch(e){}})();"
    }
    // The dashboard holds its choice in memory and would write the old one back, so it reloads from the shared storage.
    func pushPreferences() {
        applyAppearance(currentTheme)
        guard !testing else { return }
        guard let webView, webLoaded else { pendingPreferences = true; return }
        pushingPreferences = true
        webView.evaluateJavaScript(Self.storeScript(theme: currentTheme, lang: QuickText.current.lang) + "location.reload();")
    }
    /// The new look opens as a circle from the clicked button, like the dashboard's theme and language switches:
    /// a picture of the old panel stays on top with a growing hole. A second tap finishes the first at once.
    func reveal(language: Bool, _ change: @escaping () -> Void) {
        revealOverlay?.removeFromSuperview(); revealOverlay = nil
        guard popover.isShown, let host = popover.contentViewController?.view, host.bounds.width > 0,
              !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
              let picture = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { change(); pushPreferences(); return }
        host.cacheDisplay(in: host.bounds, to: picture)
        let image = NSImage(size: host.bounds.size); image.addRepresentation(picture)
        let overlay = NSView(frame: host.bounds); overlay.wantsLayer = true; overlay.autoresizingMask = [.width, .height]
        let cover = NSImageView(frame: overlay.bounds); cover.image = image; cover.imageScaling = .scaleAxesIndependently; cover.wantsLayer = true
        overlay.addSubview(cover); host.addSubview(overlay); revealOverlay = overlay
        change(); pushPreferences()
        let bounds = overlay.bounds, inWindow = host.window?.convertPoint(fromScreen: NSEvent.mouseLocation) ?? .zero
        var center = overlay.convert(inWindow, from: nil)
        if !bounds.contains(center) { center = CGPoint(x: bounds.maxX - 60, y: bounds.maxY - 24) }
        let radius = hypot(max(center.x, bounds.width - center.x), max(center.y, bounds.height - center.y))
        let circle = { (r: CGFloat) in CGRect(x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r) }
        let hole = { (r: CGFloat) -> CGPath in let p = CGMutablePath(); p.addRect(bounds); p.addEllipse(in: circle(r)); return p }
        let mask = CAShapeLayer(); mask.frame = bounds; mask.fillRule = .evenOdd; mask.path = hole(radius)
        cover.layer?.mask = mask
        let duration = language ? 0.9 : 0.7, easing = CAMediaTimingFunction(controlPoints: 0.22, 0.8, 0.24, 1)
        CATransaction.begin()
        CATransaction.setCompletionBlock { [weak self, weak overlay] in
            overlay?.removeFromSuperview(); if self?.revealOverlay === overlay { self?.revealOverlay = nil }
        }
        let grow = CABasicAnimation(keyPath: "path"); grow.fromValue = hole(0.5); grow.toValue = hole(radius)
        grow.duration = duration; grow.timingFunction = easing; mask.add(grow, forKey: "reveal")
        if language {
            // The language change rides a soft ring in the LCD green at the circle's edge.
            let green = currentTheme == "light" ? NSColor(red: 106/255, green: 168/255, blue: 0, alpha: 1) : NSColor(red: 157/255, green: 1, blue: 60/255, alpha: 1)
            let ring = CAShapeLayer(); ring.frame = bounds; ring.fillColor = nil; ring.strokeColor = green.withAlphaComponent(0.55).cgColor
            ring.lineWidth = 7; ring.shadowColor = green.cgColor; ring.shadowRadius = 6; ring.shadowOpacity = 0.9; ring.shadowOffset = .zero
            ring.path = CGPath(ellipseIn: circle(radius), transform: nil); ring.opacity = 0
            overlay.layer?.addSublayer(ring)
            let path = CABasicAnimation(keyPath: "path"); path.fromValue = CGPath(ellipseIn: circle(0.5), transform: nil); path.toValue = ring.path
            path.duration = duration; path.timingFunction = easing
            let fade = CAKeyframeAnimation(keyPath: "opacity"); fade.values = [0, 1, 1, 0]; fade.keyTimes = [0, 0.08, 0.7, 1]; fade.duration = duration
            ring.add(path, forKey: "grow"); ring.add(fade, forKey: "fade")
        }
        CATransaction.commit()
    }
    func languageChanged() {
        let t = QuickText.current
        makeMainMenu()
        window?.title = t("1top — 이 Mac")
        statusItem.button?.setAccessibilityLabel(t("1top 간략 대시보드"))
        for item in window?.toolbar?.items ?? [] {
            guard let title = Self.toolbarTitles[item.itemIdentifier.rawValue] else { continue }
            item.label = t(title); item.toolTip = t(title)
        }
        updateStatusTitle()
    }
    @objc func togglePopover() { if popover.isShown { popover.performClose(nil) } else { showPopover() } }
    func showPopover() {
        guard let button = statusItem.button else { return }
        let point = NSEvent.mouseLocation
        popoverScreen = NSScreen.screens.first { $0.frame.contains(point) } ?? button.window?.screen ?? NSScreen.main
        model.refresh(); NSApp.activate(ignoringOtherApps: true)
        popover.contentSize = quickPanelSize()
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        placePopover(near: point)
    }
    func quickPanelSize() -> NSSize {
        QuickDashboard.panelSize(zoom: zoom.value, room: (popoverScreen ?? NSScreen.main).map { $0.visibleFrame.height - 16 } ?? .greatestFiniteMagnitude)
    }
    // AppKit can anchor a resized popover above the menu bar on vertically stacked displays,
    // so keep it below the status item and on the screen it opened on.
    func placePopover(near point: NSPoint) {
        guard let button = statusItem.button else { return }
        for delay in [0.0, 0.12, 0.35] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, self.popover.isShown, let panel = self.popover.contentViewController?.view.window, let screen = self.popoverScreen else { return }
                let visible = screen.visibleFrame.insetBy(dx: 8, dy: 8)
                let anchor = button.window?.convertToScreen(button.convert(button.bounds, to: nil))
                var frame = panel.frame
                frame.size.height = min(frame.height, visible.height)
                frame.size.width = min(frame.width, visible.width)
                let anchorIsHere = anchor.map { screen.frame.intersects($0) } ?? false
                let x = anchorIsHere ? (anchor!.midX - frame.width / 2) : point.x - frame.width / 2
                let top = anchorIsHere ? min(visible.maxY, anchor!.minY - 5) : visible.maxY
                frame.origin.x = min(max(x, visible.minX), visible.maxX - frame.width)
                frame.origin.y = max(visible.minY, top - frame.height)
                panel.setFrame(frame, display: true)
            }
        }
    }
    @objc func showDashboard() {
        popover?.performClose(nil); NSApp.setActivationPolicy(.regular)
        if window == nil { makeWindow() }; window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        if !webLoaded && !webLoading && model.connected { loadDashboard() }; model.refresh()
    }
    func makeWindow() {
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1380, height: 880), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = QuickText.current("1top — 이 Mac"); w.minSize = NSSize(width: 1040, height: 680)
        w.isReleasedWhenClosed = false; w.delegate = self; w.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1)
        w.appearance = NSAppearance(named: .darkAqua); w.center(); w.setFrameAutosaveName("1top.desktop.v2")
        let toolbar = NSToolbar(identifier: "1top.toolbar"); toolbar.delegate = self; toolbar.displayMode = .iconOnly
        w.toolbar = toolbar; w.toolbarStyle = .unifiedCompact
        let config = WKWebViewConfiguration(); config.websiteDataStore = testing ? .nonPersistent() : .default()
        // A theme or language picked in the quick view while this window was closed is in place before the page reads it.
        if pendingPreferences, !testing {
            config.userContentController.addUserScript(WKUserScript(source: Self.storeScript(theme: currentTheme, lang: QuickText.current.lang), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // No privileged native bridge. The renderer uses the existing guarded HTTP controls.
        let web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self; web.uiDelegate = self
        web.underPageBackgroundColor = w.backgroundColor; web.translatesAutoresizingMaskIntoConstraints = false
        web.pageZoom = zoom.value
        w.contentView!.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: w.contentView!.leadingAnchor), web.trailingAnchor.constraint(equalTo: w.contentView!.trailingAnchor), web.topAnchor.constraint(equalTo: w.contentView!.topAnchor), web.bottomAnchor.constraint(equalTo: w.contentView!.bottomAnchor)])
        let label = NSTextField(wrappingLabelWithString: QuickText.current("이 Mac의 대시보드를 여는 중…"))
        label.alignment = .center; label.font = NSFont.systemFont(ofSize: 17); label.textColor = .secondaryLabelColor; label.translatesAutoresizingMaskIntoConstraints = false
        w.contentView!.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: web.centerXAnchor), label.centerYAnchor.constraint(equalTo: web.centerYAnchor), label.widthAnchor.constraint(equalToConstant: 620)])
        window = w; webView = web; loadingLabel = label
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(toolbar) }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.init("quick"), .flexibleSpace, .init("browser"), .init("reload")] }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let options: [String: (String, Selector)] = ["quick":("menubar.rectangle", #selector(togglePopover)), "browser":("safari", #selector(openBrowser)), "reload":("arrow.clockwise", #selector(reloadDashboard))]
        guard let (symbol, action) = options[id.rawValue], let source = Self.toolbarTitles[id.rawValue] else { return nil }
        let title = QuickText.current(source)
        let item = NSToolbarItem(itemIdentifier: id); item.label = title; item.toolTip = title
        item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title); item.target = self; item.action = action; return item
    }
    static let toolbarTitles = ["quick": "간략 보기", "browser": "브라우저", "reload": "새로고침"]
    func loadDashboard() { guard let webView else { return }; webLoading = true; loadingLabel?.isHidden = false; webView.load(URLRequest(url: model.baseURL)) }
    @objc func reloadDashboard() { webLoaded = false; webLoading = false; loadDashboard(); model.refresh() }
    @objc func openBrowser() { NSWorkspace.shared.open(model.baseURL) }
    func remoteDashboard() { NSWorkspace.shared.open(URL(string: "https://1top.si/app")!) }
    @objc func closeDashboard() { window?.performClose(nil) }
    // 보기 › 확대·축소 works from the dashboard window and from the quick view alike.
    @objc func zoomIn() { zoom.set(zoom.value + 0.1) }; @objc func zoomOut() { zoom.set(zoom.value - 0.1) }
    @objc func resetZoom() { zoom.set(1) }
    func zoomChanged() {
        webView?.pageZoom = zoom.value
        guard popover.isShown else { return }
        popover.contentSize = quickPanelSize(); placePopover(near: NSEvent.mouseLocation)
    }
    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        webView?.navigationDelegate = nil; webView?.stopLoading()
        webLoaded = false; webLoading = false; webView = nil; loadingLabel = nil; window = nil
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showDashboard(); return true }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http" && url.host == "127.0.0.1" && url.port == model.baseURL.port { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated && ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.navigationType == .linkActivated, let url = action.request.url, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; return nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webLoading = false; webLoaded = true; loadingLabel?.isHidden = true
        if pendingPreferences, !testing { pendingPreferences = false; webView.configuration.userContentController.removeAllUserScripts() }
        pushingPreferences = false; syncDashboardAppearance()
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failedNavigation() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failedNavigation() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failedNavigation(); model.refresh() }
    func failedNavigation() { webLoading = false; webLoaded = false; pushingPreferences = false; loadingLabel?.isHidden = false; loadingLabel?.stringValue = QuickText.current("대시보드 연결을 다시 확인하고 있습니다…\n상단 새로고침으로 다시 연결할 수 있습니다.") }
    func control(_ action: String, session: DesktopSession) {
        if action == "focus" { model.perform(action, session: session); return }
        guard model.fresh, !model.busy, session.allows(action) else { return }; popover.performClose(nil)
        let choices = ["pause":("작업을 일시정지할까요?", "현재 작업에 Esc를 보냅니다. 세션은 유지되며, 실제 중단 여부는 수집 후 확인됩니다.", "일시정지"), "resume":("새 요청으로 작업을 재개할까요?", "이전 작업을 이어서 진행하라는 새 요청을 보냅니다. 토큰을 다시 사용할 수 있습니다. 터미널에 작성 중인 입력이 없는지 확인하세요.", "새 요청으로 재개"), "terminate":("이 CLI를 종료할까요?", "작업 중이면 먼저 중단을 요청하고, 멈춘 상태가 확인되면 해당 CLI만 종료합니다. 터미널 탭과 저장된 기록은 유지됩니다.", "CLI 종료")]
        guard let (title, detail, confirm) = choices[action] else { return }
        let t = QuickText.current
        let alert = NSAlert(); alert.messageText = t(title); alert.informativeText = "\(session.project ?? session.kind) · \(t(session.locationLabel))\n\n" + t(session.kind == "Aside" ? "Aside session stop으로 현재 작업 중단을 요청합니다. 세션은 유지됩니다. 실제 상태는 다음 수집 때 확인합니다." : detail)
        alert.alertStyle = action == "terminate" ? .warning : .informational; alert.addButton(withTitle: t("취소")); alert.addButton(withTitle: t(confirm))
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn { model.perform(action, session: session) }; showPopover()
    }
    func connectDialog() {
        popover.performClose(nil)
        let t = QuickText.current
        let alert=NSAlert();alert.messageText=t("원격 기기 연결")
        alert.informativeText=t("1top 관리형 서버 또는 본인의 Cloudflare 서버 주소를 입력하세요. 선택한 서버에 로그인 식별정보와 기기 요약을 전달합니다.")
        let input=NSTextField(string:"https://onetop-relay.gitreels.workers.dev");input.frame=NSRect(x:0,y:0,width:430,height:28);alert.accessoryView=input
        alert.addButton(withTitle:t("연결"));alert.addButton(withTitle:t("취소"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard let url=URL(string:input.stringValue),url.scheme=="https",url.host?.contains(".")==true,url.user==nil,url.password==nil,url.query==nil,url.fragment==nil,["","/"].contains(url.path),url.port==nil else { model.message="HTTPS 서버 주소만 입력하세요.";model.messageIsError=true;return }
        launch(pair:true,relay:input.stringValue)
    }
    func launch(pair: Bool, relay: String? = nil) {
        guard !testing, !stopping else { return }
        guard let running = process, running.isRunning else { startCollector(pair: pair, relay: relay); return }
        stopping = true
        running.terminationHandler = { [weak self] _ in DispatchQueue.main.async { guard let self else { return }; self.stopping = false; self.startCollector(pair: pair, relay: relay) } }
        running.terminate()
    }
    func startCollector(pair: Bool, relay: String? = nil) {
        guard !testing else { return }; let p = Process()
        p.executableURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/agent/onetop-agent"); p.arguments = pair ? ["connect"] + (relay.map { ["--relay", $0] } ?? []) : ["run", "--headless"]
        var env = ProcessInfo.processInfo.environment; env["ONETOP_DATA"] = dataDir.path
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? ""); p.environment = env
        let log = dataDir.appendingPathComponent("companion.log")
        if let size = try? FileManager.default.attributesOfItem(atPath: log.path)[.size] as? Int, size > 1_000_000 { try? FileManager.default.removeItem(at: log) }
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        if let handle = try? FileHandle(forWritingTo: log) { _ = try? handle.seekToEnd(); p.standardOutput = handle; p.standardError = handle }
        do { try p.run(); process = p; model.refresh() } catch { model.message = "로컬 수집기를 시작하지 못했습니다. 앱을 다시 열어 주세요."; model.messageIsError = true }
    }
    func toggleLogin() {
        guard !testing else { return }
        do {
            if FileManager.default.fileExists(atPath: loginAgent.path) { try FileManager.default.removeItem(at: loginAgent); model.openAtLogin = false; return }
            let path = Bundle.main.bundleURL.path
            guard path.hasPrefix("/Applications/") || path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path + "/") else { model.message = "1top을 Applications 폴더로 옮긴 뒤 설정해 주세요."; model.messageIsError = true; return }
            try FileManager.default.createDirectory(at: loginAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
            let plist: [String: Any] = ["Label":"si.1top.companion", "ProgramArguments":["/usr/bin/open", "-a", path, "--args", "--quick-view"], "RunAtLoad":true]
            try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0).write(to: loginAgent, options: .atomic); model.openAtLogin = true
        } catch { model.message = "로그인 시 실행 설정을 저장하지 못했습니다."; model.messageIsError = true }
    }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); model.stop(); if let process, process.isRunning { process.terminationHandler = nil; process.terminate() } }
}
