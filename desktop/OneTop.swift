import AppKit
import Foundation

final class OneTopApp: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    var statusLabel: NSTextField!
    var detailLabel: NSTextField!
    var process: Process?
    var timer: Timer?
    var startItem: NSMenuItem!
    let dataDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/1top")
    let loginAgent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/si.1top.companion.plist")
    let testing = CommandLine.arguments.contains("--ui-test")
    func applicationDidFinishLaunching(_ notification: Notification) {
        if !testing, NSRunningApplication.runningApplications(withBundleIdentifier: "si.1top.companion").filter({$0.processIdentifier != ProcessInfo.processInfo.processIdentifier}).count > 0 { NSApp.terminate(nil); return }
        NSApp.setActivationPolicy(.accessory)
        try? FileManager.default.createDirectory(at: dataDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "1top"
        let menu = NSMenu()
        menu.addItem(withTitle: "1top — Your AI workspace", action: #selector(showWindow), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Open dashboard", action: #selector(dashboard), keyEquivalent: "o")
        menu.addItem(withTitle: "Connection status", action: #selector(showWindow), keyEquivalent: "")
        menu.addItem(withTitle: "Connect / reconnect with Google", action: #selector(reconnect), keyEquivalent: "")
        menu.addItem(withTitle: "Open local dashboard", action: #selector(localDashboard), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())
        startItem = menu.addItem(withTitle: "Open at login", action: #selector(toggleLogin), keyEquivalent: "")
        startItem.state = FileManager.default.fileExists(atPath: loginAgent.path) ? .on : .off
        menu.addItem(withTitle: "Quit 1top", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem.menu = menu
        makeWindow()
        if !testing { launch(pair: !FileManager.default.fileExists(atPath: dataDir.appendingPathComponent("device.json").path)) }
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
        if testing || !FileManager.default.fileExists(atPath: dataDir.appendingPathComponent("device.json").path) { showWindow() }
    }
    func makeWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 340), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "1top"; window.isReleasedWhenClosed = false; window.center()
        let content = NSStackView(); content.orientation = .vertical; content.alignment = .leading; content.spacing = 18; content.translatesAutoresizingMaskIntoConstraints = false
        let title = NSTextField(labelWithString: "Your AI agents, together."); title.font = .systemFont(ofSize: 27, weight: .semibold)
        statusLabel = NSTextField(wrappingLabelWithString: testing ? "Preview — no computer connected" : "Starting your connection…"); statusLabel.font = .systemFont(ofSize: 18, weight: .medium)
        detailLabel = NSTextField(wrappingLabelWithString: "Sign in once in your browser. Then view this computer from 1top.si on any device."); detailLabel.font = .systemFont(ofSize: 15); detailLabel.textColor = .secondaryLabelColor
        let buttons = NSStackView(); buttons.orientation = .horizontal; buttons.spacing = 12
        let open = NSButton(title: "Open dashboard", target: self, action: #selector(dashboard)); open.bezelStyle = .rounded
        let connect = NSButton(title: "Connect with Google", target: self, action: #selector(reconnect)); connect.bezelStyle = .rounded
        buttons.addArrangedSubview(open); buttons.addArrangedSubview(connect)
        let note = NSTextField(wrappingLabelWithString: "Keep 1top running in the menu bar. Quitting 1top stops monitoring; your AI sessions keep running."); note.font = .systemFont(ofSize: 13); note.textColor = .secondaryLabelColor
        [title, statusLabel, detailLabel, buttons, note].forEach { content.addArrangedSubview($0) }
        window.contentView!.addSubview(content)
        NSLayoutConstraint.activate([content.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 30), content.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -30), content.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 30)])
    }
    func launch(pair: Bool) {
        guard !testing else { return }
        if process?.isRunning == true { process?.terminate(); process?.waitUntilExit() }
        let binary = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/agent/onetop-agent")
        let p = Process(); p.executableURL = binary; p.arguments = pair ? ["connect"] : ["run", "--headless"]
        var env = ProcessInfo.processInfo.environment; env["ONETOP_DATA"] = dataDir.path; env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? ""); p.environment = env
        let log = dataDir.appendingPathComponent("companion.log")
        if let size = try? FileManager.default.attributesOfItem(atPath: log.path)[.size] as? Int, size > 1_000_000 { try? FileManager.default.removeItem(at: log) }
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        if let handle = try? FileHandle(forWritingTo: log) { try? handle.seekToEnd(); p.standardOutput = handle; p.standardError = handle }
        do { try p.run(); process = p; statusLabel.stringValue = pair ? "Opening Google sign-in…" : "Connecting…" }
        catch { statusLabel.stringValue = "Could not start the companion."; detailLabel.stringValue = "Please reopen 1top or check the latest verified release." }
    }
    func refresh() {
        guard !testing else { return }
        if let bytes = try? Data(contentsOf: dataDir.appendingPathComponent("status.json")), let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
            let fresh = Date().timeIntervalSince1970 - (value["updated"] as? Double ?? 0) < 10
            if fresh { statusLabel.stringValue = value["status"] as? String ?? "Connecting…"; detailLabel.stringValue = value["detail"] as? String ?? "" }
            else if process?.isRunning != true { statusLabel.stringValue = "Companion stopped"; detailLabel.stringValue = "Use Connect with Google to start again. Your AI sessions are unaffected." }
        }
    }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    @objc func dashboard() { NSWorkspace.shared.open(URL(string: "https://1top.si/app")!) }
    @objc func localDashboard() { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:18766")!) }
    @objc func reconnect() { showWindow(); launch(pair: true) }
    @objc func toggleLogin() {
        if testing { return }
        do {
            if FileManager.default.fileExists(atPath: loginAgent.path) { try FileManager.default.removeItem(at: loginAgent); startItem.state = .off; return }
            let path = Bundle.main.bundleURL.path
            guard path.hasPrefix("/Applications/") || path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path+"/") else { let alert = NSAlert(); alert.messageText = "Move 1top to Applications first"; alert.informativeText = "Drag 1top into Applications, then reopen it and enable Open at login."; alert.runModal(); return }
            try FileManager.default.createDirectory(at: loginAgent.deletingLastPathComponent(), withIntermediateDirectories: true)
            let plist: [String: Any] = ["Label": "si.1top.companion", "ProgramArguments": ["/usr/bin/open", "-a", path], "RunAtLoad": true]
            let bytes = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0); try bytes.write(to: loginAgent, options: .atomic); startItem.state = .on
        } catch { let alert = NSAlert(); alert.messageText = "Could not update Open at login"; alert.informativeText = error.localizedDescription; alert.runModal() }
    }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { timer?.invalidate(); if process?.isRunning == true { process?.terminate() } }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
}
let app = NSApplication.shared
let delegate = OneTopApp()
app.delegate = delegate
app.run()
