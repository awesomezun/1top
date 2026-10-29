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
            button.setAccessibilityLabel("1top 간략 대시보드")
        }
        model.openAtLogin = FileManager.default.fileExists(atPath: loginAgent.path)
        popover = NSPopover(); popover.behavior = .transient; popover.animates = true
        popover.appearance = NSAppearance(named: .darkAqua)
        let quick = NSHostingController(rootView: QuickDashboard(
            model: model, zoom: zoom, openDashboard: { [weak self] in self?.showDashboard() },
            openBrowser: { [weak self] in self?.openBrowser() }, remoteOptions: { [weak self] in self?.remoteDashboard() },
            connectRemote: { [weak self] in self?.connectDialog() }, toggleLogin: { [weak self] in self?.toggleLogin() },
            restart: { [weak self] in self?.launch(pair: false) }, quit: { NSApp.terminate(nil) },
            control: { [weak self] action, session in self?.control(action, session: session) }))
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
    func makeMainMenu() {
        let main = NSMenu(); let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu(title: "1top"); appItem.submenu = appMenu
        add("전체 대시보드", #selector(showDashboard), "o", appMenu)
        add("간략 대시보드", #selector(togglePopover), "1", appMenu); appMenu.addItem(.separator())
        add("업데이트 확인…", #selector(checkUpdate), "", appMenu)
        add("1top 가리기", #selector(NSApplication.hide(_:)), "h", appMenu, NSApp)
        add("1top 종료", #selector(NSApplication.terminate(_:)), "q", appMenu, NSApp)
        let editItem = NSMenuItem(); main.addItem(editItem); let edit = NSMenu(title: "편집"); editItem.submenu = edit
        for (title, selector, key) in [("실행 취소", "undo:", "z"), ("잘라내기", "cut:", "x"), ("복사", "copy:", "c"), ("붙여넣기", "paste:", "v"), ("전체 선택", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let viewItem = NSMenuItem(); main.addItem(viewItem); let view = NSMenu(title: "보기"); viewItem.submenu = view
        add("새로고침", #selector(reloadDashboard), "r", view)
        add("확대", #selector(zoomIn), "+", view); add("축소", #selector(zoomOut), "-", view)
        add("기본 크기", #selector(resetZoom), "0", view); add("창 닫기", #selector(closeDashboard), "w", view)
        NSApp.mainMenu = main
    }
    func add(_ title: String, _ action: Selector, _ key: String, _ menu: NSMenu, _ target: AnyObject? = nil) {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key); item.target = target ?? self
    }
    @objc func checkUpdate() {
        URLSession.shared.dataTask(with: URL(string: "http://127.0.0.1:18766/api/updates")!) { data, _, _ in
            let value = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            DispatchQueue.main.async {
                let alert = NSAlert(); let version = value?["version"] as? String
                alert.messageText = value?["available"] as? Bool == true ? "새 버전 \(version ?? "")" : "1top 업데이트"
                alert.informativeText = version == nil ? "업데이트 정보를 확인할 수 없습니다." : "설치 버전: \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") · 배포 버전: \(version!). 미리보기 설치본은 자동 교체하지 않습니다."
                alert.addButton(withTitle: "배포 페이지 열기"); alert.addButton(withTitle: "닫기")
                if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(URL(string: "https://github.com/awesomezun/1top/releases")!) }
            }
        }.resume()
    }
    func updateStatusTitle() {
        statusItem.button?.title = ""
        statusItem.button?.toolTip = "\(model.connectionLabel) · 작업 중 \(model.working) / 전체 \(model.sessions.count)"
    }
    func updated() {
        updateStatusTitle()
        syncDashboardAppearance()
        if model.connected, window != nil, !webLoaded, !webLoading { loadDashboard() }
        if !model.connected, !webLoaded { loadingLabel?.stringValue = "로컬 수집기에 연결하고 있습니다…\n연결되면 대시보드가 자동으로 열립니다.\n간략 보기의 수집기 다시 시작을 사용할 수 있습니다." }
    }
    func syncDashboardAppearance() {
        guard webLoaded, let webView else { return }
        webView.evaluateJavaScript("document.documentElement.dataset.theme") { [weak self] value, _ in
            guard let self, let theme = value as? String, ["light", "dark"].contains(theme) else { return }
            let appearance = NSAppearance(named: theme == "light" ? .aqua : .darkAqua)
            self.window?.appearance = appearance; self.popover?.appearance = appearance
            self.window?.backgroundColor = theme == "light" ? .windowBackgroundColor : NSColor(calibratedWhite: 0.055, alpha: 1)
            self.webView?.underPageBackgroundColor = self.window?.backgroundColor
            if !self.testing, UserDefaults.standard.string(forKey: "dashboardTheme") != theme { UserDefaults.standard.set(theme, forKey: "dashboardTheme") }
        }
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
        w.title = "1top — 이 Mac"; w.minSize = NSSize(width: 1040, height: 680)
        w.isReleasedWhenClosed = false; w.delegate = self; w.backgroundColor = NSColor(calibratedWhite: 0.055, alpha: 1)
        w.appearance = NSAppearance(named: .darkAqua); w.center(); w.setFrameAutosaveName("1top.desktop.v2")
        let toolbar = NSToolbar(identifier: "1top.toolbar"); toolbar.delegate = self; toolbar.displayMode = .iconOnly
        w.toolbar = toolbar; w.toolbarStyle = .unifiedCompact
        let config = WKWebViewConfiguration(); config.websiteDataStore = testing ? .nonPersistent() : .default()
        // No privileged native bridge. The renderer uses the existing guarded HTTP controls.
        let web = WKWebView(frame: .zero, configuration: config); web.navigationDelegate = self; web.uiDelegate = self
        web.underPageBackgroundColor = w.backgroundColor; web.translatesAutoresizingMaskIntoConstraints = false
        web.pageZoom = zoom.value
        w.contentView!.addSubview(web)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: w.contentView!.leadingAnchor), web.trailingAnchor.constraint(equalTo: w.contentView!.trailingAnchor), web.topAnchor.constraint(equalTo: w.contentView!.topAnchor), web.bottomAnchor.constraint(equalTo: w.contentView!.bottomAnchor)])
        let label = NSTextField(wrappingLabelWithString: "이 Mac의 대시보드를 여는 중…")
        label.alignment = .center; label.font = NSFont.systemFont(ofSize: 17); label.textColor = .secondaryLabelColor; label.translatesAutoresizingMaskIntoConstraints = false
        w.contentView!.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: web.centerXAnchor), label.centerYAnchor.constraint(equalTo: web.centerYAnchor), label.widthAnchor.constraint(equalToConstant: 620)])
        window = w; webView = web; loadingLabel = label
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(toolbar) }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.init("quick"), .flexibleSpace, .init("browser"), .init("reload")] }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let options: [String: (String, String, Selector)] = ["quick":("간략 보기", "menubar.rectangle", #selector(togglePopover)), "browser":("브라우저", "safari", #selector(openBrowser)), "reload":("새로고침", "arrow.clockwise", #selector(reloadDashboard))]
        guard let (title, symbol, action) = options[id.rawValue] else { return nil }
        let item = NSToolbarItem(itemIdentifier: id); item.label = title; item.toolTip = title
        item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title); item.target = self; item.action = action; return item
    }
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
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { webLoading = false; webLoaded = true; loadingLabel?.isHidden = true; syncDashboardAppearance() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failedNavigation() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failedNavigation() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failedNavigation(); model.refresh() }
    func failedNavigation() { webLoading = false; webLoaded = false; loadingLabel?.isHidden = false; loadingLabel?.stringValue = "대시보드 연결을 다시 확인하고 있습니다…\n상단 새로고침으로 다시 연결할 수 있습니다." }
    func control(_ action: String, session: DesktopSession) {
        if action == "focus" { model.perform(action, session: session); return }
        guard model.fresh, !model.busy, session.allows(action) else { return }; popover.performClose(nil)
        let choices = ["pause":("작업을 일시정지할까요?", "현재 작업에 Esc를 보냅니다. 세션은 유지되며, 실제 중단 여부는 수집 후 확인됩니다.", "일시정지"), "resume":("새 요청으로 작업을 재개할까요?", "이전 작업을 이어서 진행하라는 새 요청을 보냅니다. 토큰을 다시 사용할 수 있습니다. 터미널에 작성 중인 입력이 없는지 확인하세요.", "새 요청으로 재개"), "terminate":("이 CLI를 종료할까요?", "작업 중이면 먼저 중단을 요청하고, 멈춘 상태가 확인되면 해당 CLI만 종료합니다. 터미널 탭과 저장된 기록은 유지됩니다.", "CLI 종료")]
        guard let (title, detail, confirm) = choices[action] else { return }
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = "\(session.project ?? session.kind) · \(session.locationLabel)\n\n" + (session.kind == "Aside" ? "Aside session stop으로 현재 작업 중단을 요청합니다. 세션은 유지됩니다. 실제 상태는 다음 수집 때 확인합니다." : detail)
        alert.alertStyle = action == "terminate" ? .warning : .informational; alert.addButton(withTitle: "취소"); alert.addButton(withTitle: confirm)
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertSecondButtonReturn { model.perform(action, session: session) }; showPopover()
    }
    func connectDialog() {
        popover.performClose(nil)
        let alert=NSAlert();alert.messageText="원격 기기 연결"
        alert.informativeText="1top 관리형 서버 또는 본인의 Cloudflare 서버 주소를 입력하세요. 선택한 서버에 로그인 식별정보와 기기 요약을 전달합니다."
        let input=NSTextField(string:"https://onetop-relay.gitreels.workers.dev");input.frame=NSRect(x:0,y:0,width:430,height:28);alert.accessoryView=input
        alert.addButton(withTitle:"연결");alert.addButton(withTitle:"취소")
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
