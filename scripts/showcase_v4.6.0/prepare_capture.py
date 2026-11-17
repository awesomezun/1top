"""Build a recording-only copy using the real desktop renderer and native views.

Production sources and the installed app remain unchanged. The copy is pinned to
the synthetic loopback fixture, never starts a collector, and disables controls.
"""
from pathlib import Path
import subprocess
import shutil
import os

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/showcase_v4.6.0'
OUT.mkdir(parents=True, exist_ok=True)
shutil.copytree(ROOT / "desktop/Fonts", OUT / "Fonts", dirs_exist_ok=True)
s = (ROOT / 'desktop/OneTop.swift').read_text()
s = s.replace('let testing = CommandLine.arguments.contains("--ui-test")', 'let testing = true')
s = s.replace('?? 18766', '?? 18868')
s = s.replace('popover.behavior = .transient', 'popover.behavior = .applicationDefined')
s = s.replace('model.refresh()\n        if CommandLine.arguments', 'model.refresh()\n        setupRecording()\n        if CommandLine.arguments', 1)
s = s.replace('w.setFrameAutosaveName("1top.desktop.v2")', 'w.setFrame(NSRect(x: 20, y: 40, width: 1540, height: 1050), display: true)')
# No real control or browser navigation can be triggered by the recording copy.
s = s.replace('control: { [weak self] action, session in self?.control(action, session: session) }', 'control: { _, _ in }')
s += '''
extension OneTopApp {
    func setupRecording() {
        let scene = ProcessInfo.processInfo.environment["ONETOP_SCENE"] ?? "desktop"
        model.accounts = scene == "accounts"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            if scene == "menu" || scene == "accounts" {
                self.showPopover()
                if let panel = self.popover.contentViewController?.view.window {
                    print("RECORD_WINDOW \\(panel.windowNumber)"); fflush(stdout)
                }
            } else if let w = self.window {
                print("RECORD_WINDOW \\(w.windowNumber)"); fflush(stdout)
            }
        }
        if scene == "maps" {
            let steps: [(Double, String)] = [
                (1, "document.querySelector('[data-view=\\\"maps\\\"]').click();window.scrollTo(0,0)"),
                (5, "document.getElementById('mapGroup').value='app';document.getElementById('mapGroup').dispatchEvent(new Event('change'))"),
                (9, "document.getElementById('mapGroup').value='tool';document.getElementById('mapGroup').dispatchEvent(new Event('change'))"),
                (13, "document.getElementById('mapGroup').value='model';document.getElementById('mapGroup').dispatchEvent(new Event('change'))")
            ]
            for (delay, js) in steps { DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.webView?.evaluateJavaScript(js) } }
        } else if scene == "desktop" {
            let steps: [(Double, String)] = [
                (5, "document.querySelector('[data-period=\\\"10m\\\"]').click()"),
                (8, "document.querySelector('[data-session=\\\"demo-session-0\\\"]').click()"),
                (12, "document.getElementById('closeDetail').click();document.querySelector('[data-view=\\\"operations\\\"]').click();window.scrollTo(0,0)"),
                (16, "document.querySelector('[data-view=\\\"sessions\\\"]').click();document.querySelector('[data-period=\\\"1h\\\"]').click();window.scrollTo(0,0)")
            ]
            for (delay, js) in steps {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.webView?.evaluateJavaScript(js) }
            }
        } else if scene == "accounts" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 7) { self.scrollRecording(0) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) { self.scrollRecording(0) }
        } else if scene == "menu" {
            for (delay, period) in [(5.0,"10m"),(9.0,"5h"),(13.0,"1h")] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { self.model.selectedPeriod = period }
            }
        }
    }
    func scrollRecording(_ y: CGFloat) {
        func find(_ view: NSView) -> NSScrollView? {
            if let scroll = view as? NSScrollView { return scroll }
            for child in view.subviews { if let found = find(child) { return found } }
            return nil
        }
        if let view = popover.contentViewController?.view, let scroll = find(view) {
            let maxY = max(0, (scroll.documentView?.bounds.height ?? 0) - scroll.contentView.bounds.height)
            scroll.contentView.scroll(to: NSPoint(x: 0, y: min(y, maxY)))
            scroll.reflectScrolledClipView(scroll.contentView)
        }
    }
}
'''
(OUT / 'CaptureApp.swift').write_text(s)
subprocess.run(['xcrun', 'swiftc', '-O', '-framework', 'AppKit', '-framework', 'SwiftUI', '-framework', 'WebKit',
    str(OUT/'CaptureApp.swift'), str(ROOT/'desktop/DashboardModel.swift'), str(ROOT/'desktop/QuickDashboard.swift'), str(ROOT/'desktop/Typography.swift'), str(ROOT/'desktop/CompactTokenMap.swift'), '-framework', 'CoreText',
    '-o', str(OUT/'capture-app')], check=True, env={**os.environ, 'DEVELOPER_DIR': os.environ.get('DEVELOPER_DIR', '/Applications/Xcode.app/Contents/Developer')})
print(OUT/'capture-app')
