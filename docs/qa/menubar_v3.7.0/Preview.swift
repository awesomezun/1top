import AppKit
import SwiftUI
import CoreText

@main struct Preview {
    static var window: NSWindow!
    static var model: DashboardModel!
    static var host: NSHostingView<QuickDashboard>!
    static var original: DesktopSnapshot!
    static let out = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("build/menubar_v3.7.0")
    static func capture(_ name: String) {
        host.layoutSubtreeIfNeeded()
        guard let image = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("No bitmap") }
        host.cacheDisplay(in: host.bounds, to: image)
        try! image.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(name + ".png"))
        if let scroll = findScroll(host) {
            print("VIEW \(name): viewport=\(scroll.contentView.bounds), document=\(scroll.documentView?.bounds ?? .zero)")
        }
        fflush(stdout)
    }
    static func findScroll(_ view: NSView) -> NSScrollView? {
        if let scroll = view as? NSScrollView { return scroll }
        for child in view.subviews { if let scroll = findScroll(child) { return scroll } }
        return nil
    }
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory); app.appearance = NSAppearance(named: .darkAqua)
        let fontDir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("desktop/Fonts")
        for font in try FileManager.default.contentsOfDirectory(at: fontDir, includingPropertiesForKeys: nil) where font.pathExtension == "ttf" {
            CTFontManagerRegisterFontsForURL(font as CFURL, .process, nil)
        }
        original = try JSONDecoder().decode(DesktopSnapshot.self, from: Data(contentsOf: out.appendingPathComponent("fixture.json")))
        original.updated = Date().timeIntervalSince1970
        model = DashboardModel(baseURL: URL(string: "http://127.0.0.1:18899")!)
        model.snapshot = original; model.connected = true; model.now = Date()
        host = NSHostingView(rootView: QuickDashboard(model: model, openDashboard: {}, openBrowser: {}, remoteOptions: {}, connectRemote: {}, toggleLogin: {}, restart: {}, quit: {}, control: { _, _ in }))
        window = NSWindow(contentRect: NSRect(origin: .zero, size: QuickDashboard.panelSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "1top UI QA — synthetic data"; window.contentView = host; window.center(); window.makeKeyAndOrderFront(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            capture("sessions")
            if let scroll = findScroll(host), let doc = scroll.documentView {
                scroll.contentView.scroll(to: NSPoint(x: 0, y: max(0, doc.bounds.height - scroll.contentView.bounds.height)))
                scroll.reflectScrolledClipView(scroll.contentView)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { capture("sessions-bottom"); model.accounts = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { capture("accounts"); model.accounts = false; model.snapshot?.sessions = [] }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { capture("empty"); model.snapshot = original; model.connected = false; model.message = "연결 상태를 확인하세요."; model.messageIsError = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { capture("offline"); app.terminate(nil) }
        app.run()
    }
}
