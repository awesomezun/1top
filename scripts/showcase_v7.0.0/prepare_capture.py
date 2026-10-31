"""Build a recording-only copy of the app at a given commit from git objects.

Sources are read with `git archive`, never from another worktree. The copy is
pinned to the synthetic loopback fixture (fixture_server.mjs), never starts a
collector, disables controls, and only adds hooks that drive the real views on a
fixed timeline. Display preferences (language, column order) are seeded into the
ephemeral test WebView's localStorage, the same key the dashboard itself writes;
the menu-bar panel's theme and language start from the recording build's own
defaults domain (capture-app), never the installed app's (si.1top.companion).
It also builds window-film (window_film.swift), the recorder record.py uses.

Usage: prepare_capture.py [commit]   (default 3e41fe5: the modern conversation screens, sending without a confirmation, and the demo world's one conversation script; 37066df: the same screens with a confirmation before sending; 08748ca: one demo world for the web, desktop and phones, with the demo moment the captures hold; before it d5b1952: the demo collector state with every real key and whole-percent limits, the dashboard translations, table columns that fit each language and the Windows tray logo)
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys

COMMIT = sys.argv[1] if len(sys.argv) > 1 else '3e41fe5'
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'build/showcase_v7.0.0'
SRC = OUT / 'src'
if SRC.exists():
    shutil.rmtree(SRC)
SRC.mkdir(parents=True)
# The app, every renderer file it serves, and the demo state generator with the world and usage model it imports.
archive = subprocess.run(['git', '-C', str(ROOT), 'archive', COMMIT, 'desktop', 'agent/onetop/dist',
                          'scripts/demo-state.mjs', 'site/src/demo-usage.js', 'site/src/demo-world.js', 'site/src/demo-model.js',
                          'site/public/demo/checkout.png'],
                         check=True, capture_output=True).stdout
subprocess.run(['tar', '-x', '-C', str(SRC)], input=archive, check=True)
(OUT / 'commit.txt').write_text(subprocess.run(['git', '-C', str(ROOT), 'rev-parse', COMMIT], check=True, capture_output=True, text=True).stdout)
DESKTOP = SRC / 'desktop'
DIST = SRC / 'agent/onetop/dist'
shutil.copytree(DESKTOP / 'Fonts', OUT / 'Fonts', dirs_exist_ok=True)


def patch(text, old, new, count=1):
    assert text.count(old) == count, f'expected {count} match(es) for {old!r}'
    return text.replace(old, new)


# The conversation reads its mailbox every 5 s; the film reads every second so each delivery step shows
# when the fixture reaches it instead of up to five seconds later. Nothing else in the renderer changes.
c = (DIST / 'conversation.js').read_text()
(DIST / 'conversation.js').write_text(patch(c, 'READ_EVERY=5000', 'READ_EVERY=1000'))
# The conversation scene sends the demo world's scripted message (CONVERSATION.script in site/src/demo-world.js)
# with its photo, an invented checkout form (first drawn by make_photo.py), served by the fixture.
shutil.copyfile(SRC / 'site/public/demo/checkout.png', DIST / 'rec-photo.png')
SCRIPT_TEXT = json.loads(subprocess.run(['node', '-e', 'import(process.argv[1]).then(m=>console.log(JSON.stringify(m.CONVERSATION.script.text)))',
                                         (SRC / 'site/src/demo-world.js').as_uri()], check=True, capture_output=True, text=True).stdout)

s = (DESKTOP / 'OneTop.swift').read_text()
s = patch(s, 'let testing = CommandLine.arguments.contains("--ui-test")', 'let testing = true')
s = patch(s, '18766', '18868', 2)
s = patch(s, 'popover.behavior = .transient', 'popover.behavior = .applicationDefined')
s = patch(s, 'model.openAtLogin = FileManager.default.fileExists(atPath: loginAgent.path)', 'model.openAtLogin = false')
s = patch(s, 'model.refresh()\n        if CommandLine.arguments', 'model.refresh()\n        setupRecording()\n        if CommandLine.arguments')
# 1640 x 1028 on the widest screen, so English headers, badges and session names all fit (the built-in
# display is only 1512 points wide).
s = patch(s, 'w.setFrameAutosaveName("1top.desktop.v2")',
          'w.setFrame({ let v = NSScreen.screens.max { $0.visibleFrame.width < $1.visibleFrame.width }?.visibleFrame ?? .zero; '
          'return NSRect(x: v.minX + 40, y: v.maxY - 1068, width: 1640, height: 1028) }(), display: true)')
# The panel starts dark in the scene's language, in the recording build's own defaults domain.
s = patch(s, 'func applicationDidFinishLaunching(_ notification: Notification) {\n',
          'func applicationDidFinishLaunching(_ notification: Notification) {\n'
          '        UserDefaults.standard.set(ProcessInfo.processInfo.environment["ONETOP_LANG"] ?? "ko", forKey: "dashboardLanguage")\n'
          '        UserDefaults.standard.set("dark", forKey: "dashboardTheme")\n')
# The test WebView stays ephemeral; the scene's preferences are written before the dashboard reads them.
s = patch(s, 'config.websiteDataStore = testing ? .nonPersistent() : .default()',
          'config.websiteDataStore = .nonPersistent()\n'
          '        config.userContentController.addUserScript(WKUserScript(source: recordingPreferences, injectionTime: .atDocumentStart, forMainFrameOnly: true))')
# The panel opens as if its menu-bar icon was clicked, wherever the pointer happens to be.
s = patch(s, 'let point = NSEvent.mouseLocation',
          'let point = button.window.map { w in let r = w.convertToScreen(button.convert(button.bounds, to: nil)); return NSPoint(x: r.midX, y: r.midY) } ?? NSEvent.mouseLocation')
# No real control or browser navigation can be triggered by the recording copy.
s = patch(s, 'control: { [weak self] action, session in self?.control(action, session: session) }', 'control: { _, _ in }')
s += r'''
extension OneTopApp {
    var scene: String { ProcessInfo.processInfo.environment["ONETOP_SCENE"] ?? "dashboard" }
    var recordingPreferences: String {
        let prefs = ProcessInfo.processInfo.environment["ONETOP_PREFS"] ?? "{}"
        // With a demo moment (ONETOP_DEMO_NOW), the page's clock starts there and runs on, as the panel's DemoClock does.
        let clock = ProcessInfo.processInfo.environment["ONETOP_DEMO_NOW"].flatMap(Double.init).map { held in
            "(()=>{const R=Date,off=\(held * 1000)-R.now();window.Date=class extends R{constructor(...a){super(...(a.length?a:[R.now()+off]))}static now(){return R.now()+off}}})();"
        } ?? ""
        return clock + "try{localStorage.setItem('onetop.dashboard.v1',JSON.stringify(\(prefs)))}catch(e){}"
    }
    func setupRecording() {
        let view = ["dashboard": "sessions", "gauges": "sessions", "customize": "sessions", "conversation": "sessions", "accounts": "accounts"][scene]
        // Wait until the renderer has data, then announce the window to the recorder.
        for delay in [2.0, 3.0] {
            at(delay) {
                self.js(Self.helpers)
                if let view { self.js("document.querySelector('[data-view=\"\(view)\"]').click();window.scrollTo(0,0)") }
                if self.scene == "gauges" { self.js("scrollTo(0,document.querySelector('.session-panel .table-scroll').getBoundingClientRect().top+scrollY-14)") }
            }
        }
        at(3.4) { if self.scene == "gauges" { self.reportCrop() } }
        at(3.5) {
            let target = self.scene == "menu" ? self.popover.contentViewController?.view.window : self.window
            if let target { print("RECORD_WINDOW \(target.windowNumber) \(target.frame.width) \(target.frame.height)"); fflush(stdout) }
            // The recorder writes one line when its first frame is captured.
            DispatchQueue.global().async {
                _ = readLine()
                DispatchQueue.main.async { self.timeline() }
            }
        }
    }
    func js(_ source: String) {
        webView?.evaluateJavaScript(source) { _, error in
            if let error { FileHandle.standardError.write("JS error: \(error) in \(source.prefix(120))\n".data(using: .utf8)!) }
        }
    }
    func at(_ delay: Double, _ action: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: action)
    }
    // Recording helpers that dispatch the same events a mouse or keyboard would.
    static let helpers = """
    window.__rec=window.__rec||(()=>{
     const ease=x=>x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2,q=s=>document.querySelector(s);
     const tween=(d,f,done)=>{const t0=performance.now(),g=n=>{const x=Math.min(1,(n-t0)/d);f(ease(x));if(x<1)requestAnimationFrame(g);else done?.();};requestAnimationFrame(g);};
     const pointer=(el,type,x,y)=>el.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,composed:true,pointerId:1,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1}));
     return {
      click:s=>q(s)?.click(),
      // The time slider moves one stop at a time, as a drag does, and settles on release.
      slide:(to,d=900)=>{const el=q('.view:not([hidden]) .duration-slider');if(!el)return;const from=Number(el.value);let last=from;
       tween(d,e=>{const v=Math.round(from+(to-from)*e);if(v!==last){last=v;el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));}},()=>{el.value=to;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});},
      scroll:(y,d=1100)=>{const y0=scrollY,y1=Math.max(0,y);tween(d,e=>scrollTo(0,y0+(y1-y0)*e));},
      top:s=>q(s).getBoundingClientRect().top+scrollY,
      movePanel:(from,to)=>{const src=q('[data-panel-drag="'+from+'"]'),dst=q('[data-panel="'+to+'"]'),dt=new DataTransfer(),ev=(el,type)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));
       ev(src,'dragstart');ev(dst,'dragenter');ev(dst,'dragover');ev(dst,'drop');ev(src,'dragend');},
      drag:(s,dx,dy,d=900)=>{const el=q(s),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
       pointer(el,'pointerdown',x,y);tween(d,e=>pointer(el,'pointermove',x+dx*e,y+dy*e),()=>pointer(el,'pointerup',x+dx,y+dy));},
      // Session details open from a click on the row, as the pointer would.
      open:id=>{const row=q('[data-session="'+id+'"]');row?.scrollIntoView({block:'center'});row?.querySelector('td,div')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));},
      // The detail sheet scrolls its conversation into view.
      toConversation:(d=900)=>{const box=q('#detailDialog'),c=q('#conversation');if(!box||!c)return;const y0=box.scrollTop,y1=Math.max(0,c.offsetTop-90);tween(d,e=>box.scrollTop=y0+(y1-y0)*e);},
      type:(text,d=1800)=>{const el=q('#conversation textarea');if(!el)return;el.focus();const chars=[...text];
       tween(d,e=>{const n=Math.round(chars.length*e);if(el.value.length!==chars.slice(0,n).join('').length){el.value=chars.slice(0,n).join('');el.dispatchEvent(new Event('input',{bubbles:true}));}});},
      photo:async()=>{const input=q('#conversation input[type=file]'),blob=await (await fetch('/rec-photo.png')).blob(),dt=new DataTransfer();
       dt.items.add(new File([blob],'checkout.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));},
      // The composer lets go of focus before the message goes. Otherwise macOS draws its input-source badge by the
      // caret, where it stays over the conversation.
      submit:()=>{document.activeElement?.blur();q('#conversation form')?.requestSubmit();},
      values:()=>[...document.querySelectorAll('#sessionsBody tr')].map(r=>[r.querySelector('[data-column=session] .cell-sub')?.textContent.split(' · ')[0],r.querySelector('[data-column=period]')?.innerText.trim(),r.querySelector('[data-column=rate]')?.innerText.replace(/\\s+/g,'')].join(' | ')).join('\\n')+'\\nscrollY '+scrollY
     };
    })();
    """
    // Eased document scroll, slow enough to read at the capture frame rate.
    func scrollPage(_ target: String, duration: Int = 1100) { js("__rec.scroll(\(target),\(duration))") }
    // Slider stops: 0 = 10 minutes, 3 = 1 hour, 6 = 5 hours, 9 = 24 hours.
    func slide(_ stop: Int) { js("__rec.slide(\(stop))") }
    // The table region the gauges film keeps: header plus five rows of the first four columns.
    func reportCrop() {
        guard let webView, let window else { return }
        let rect = webView.convert(webView.bounds, to: nil), top = window.frame.height - rect.maxY
        webView.evaluateJavaScript("(()=>{const t=document.querySelector('.sessions-table'),h=t.tHead.rows[0].cells,r=t.tBodies[0].rows,a=h[0].getBoundingClientRect(),b=h[3].getBoundingClientRect(),c=r[Math.min(5,r.length-1)].getBoundingClientRect();return [a.left,a.top,b.right-a.left,c.bottom-a.top].map(Math.round).join(' ')})()") { value, error in
            if let error { FileHandle.standardError.write("Crop error: \(error)\n".data(using: .utf8)!) }
            guard let parts = (value as? String)?.split(separator: " ").compactMap({ Double($0) }), parts.count == 4 else { return }
            print("RECORD_CROP \(rect.minX + parts[0]) \(top + parts[1]) \(parts[2]) \(parts[3])"); fflush(stdout)
        }
    }
    // Pull the native title bar along right after a theme reveal (the app itself waits for its next poll).
    func followTheme(_ delay: Double) { at(delay) { self.syncDashboardAppearance() } }
    func reportValues() {
        webView?.evaluateJavaScript("__rec.values()") { value, _ in
            print("RECORD_VALUES\n\(value as? String ?? "")\nRECORD_VALUES_END"); fflush(stdout)
        }
    }
    func timeline() {
        let lang = ProcessInfo.processInfo.environment["ONETOP_LANG"] ?? "ko"
        let message = __SCRIPT_TEXT__[lang] ?? ""
        switch scene {
        case "dashboard":
            at(2.0) { self.slide(9) }
            at(4.6) { self.slide(0) }
            at(7.2) { self.slide(3) }
            at(8.7) { self.scrollPage("__rec.top('[data-panel=sessions]')-16", duration: 1500) }
            at(16.0) { self.reportValues() }
        case "gauges":
            at(5.6) { self.slide(6) }
            at(12.0) { self.reportValues() }
        case "accounts":
            at(5.0) { self.slide(9) }
            at(10.0) { self.slide(3) }
            at(15.0) { self.reportValues() }
        case "conversation":
            at(1.0) { self.js("__rec.open('s1')") }
            at(2.4) { self.js("__rec.toConversation()") }
            at(3.6) { self.js("__rec.type(\(String(reflecting: message)))") }
            at(5.8) { self.js("__rec.photo()") }
            at(7.2) { self.js("__rec.submit()") }
            at(23.5) { self.reportValues() }
        case "customize":
            at(1.0) { self.js("__rec.click('#editDashboard')") }
            at(2.3) { self.js("__rec.movePanel('flow','map')") }
            at(3.6) { self.js("__rec.drag('[data-panel=map] .panel-resize',0,90,900)") }
            at(5.3) { self.js("__rec.click('#editDashboard')") }
            at(6.0) { self.scrollPage("__rec.top('.sessions-table')-170") }
            at(7.4) { self.js("__rec.drag('.sessions-table th[data-column=model] .column-resize',110,0,900)") }
            at(8.6) { self.scrollPage("0") }
            at(10.4) { self.js("__rec.click('[data-theme-switch]')") }
            self.followTheme(10.9)
            at(12.5) { self.js("__rec.click('[data-theme-switch]')") }
            self.followTheme(13.0)
            // One language button: each tap moves 한 → EN → 中, so three taps come back to the start.
            for delay in [14.2, 15.8, 17.4] { at(delay) { self.js("__rec.click('[data-language-switch]')") } }
            at(19.3) { self.reportValues() }
        case "menu":
            for (delay, period) in [(2.0, "10m"), (4.5, "24h"), (7.0, "1h")] {
                at(delay) { self.model.selectedPeriod = period }
            }
            for (delay, id) in [(8.4, "s1"), (9.3, "s2"), (10.2, "s3"), (11.1, "")] {
                at(delay) { NotificationCenter.default.post(name: .init("OneTopRecordingHover"), object: id) }
            }
            at(11.4) { self.scrollSessions(to: 230, duration: 1.0) }
            at(13.2) { self.scrollSessions(to: 0, duration: 1.0) }
            // The film ends here, back at 1h with the list at the top. The theme and language buttons are
            // basic features, so the panel no longer switches them on camera.
        default: break
        }
    }
    func sessionScroll() -> NSScrollView? {
        func all(_ view: NSView) -> [NSScrollView] {
            ((view as? NSScrollView).map { [$0] } ?? []) + view.subviews.flatMap(all)
        }
        guard let root = popover.contentViewController?.view else { return nil }
        // The session list is the tallest scroll view.
        return all(root).max { $0.frame.height < $1.frame.height }
    }
    func scrollSessions(to target: CGFloat, duration: Double) {
        guard let scroll = sessionScroll() else { return }
        let maxY = max(0, (scroll.documentView?.bounds.height ?? 0) - scroll.contentView.bounds.height)
        let start = scroll.contentView.bounds.origin.y, end = min(target, maxY), steps = Int(duration * 60)
        for step in 1...steps {
            at(Double(step) / 60) {
                let x = Double(step) / Double(steps), eased = x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2
                scroll.contentView.scroll(to: NSPoint(x: 0, y: start + (end - start) * eased))
                scroll.reflectScrolledClipView(scroll.contentView)
            }
        }
    }
}
'''
s = patch(s, '__SCRIPT_TEXT__', '[' + ', '.join(f'{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in SCRIPT_TEXT.items()) + ']')
(OUT / 'CaptureApp.swift').write_text(s)

q = (DESKTOP / 'QuickDashboard.swift').read_text()
# The timeline highlights rows the way the pointer would; the detail popover is not opened.
q = patch(q, '        .popover(item: $selectedAccount, arrowEdge: .bottom) { original in',
          '        .onReceive(NotificationCenter.default.publisher(for: .init("OneTopRecordingHover"))) { note in\n'
          '            hoveredSession = (note.object as? String).flatMap { $0.isEmpty ? nil : $0 }\n'
          '        }\n'
          '        .popover(item: $selectedAccount, arrowEdge: .bottom) { original in')
(OUT / 'QuickDashboard.swift').write_text(q)

# The panel reads report ages, resets and freshness from its own clock. With a demo moment it starts there and runs
# on, so the panel reads as the held demo state does on every other surface (as the page's clock does above).
d = (DESKTOP / 'DashboardModel.swift').read_text()
d = patch(d, 'func isFresh(at now: Date = Date())', 'func isFresh(at now: Date = DemoClock.date)')
d = patch(d, '@Published var now = Date()', '@Published var now = DemoClock.date')
d = patch(d, 'func tick() { now = Date() }', 'func tick() { now = DemoClock.date }')
d = patch(d, 'self.now = Date()', 'self.now = DemoClock.date')
d = patch(d, 'static func reportAge(_ updated: Double, now: Double = Date().timeIntervalSince1970)',
          'static func reportAge(_ updated: Double, now: Double = DemoClock.date.timeIntervalSince1970)')
d += '''
enum DemoClock {
    static let offset: TimeInterval = ProcessInfo.processInfo.environment["ONETOP_DEMO_NOW"].flatMap(Double.init).map { $0 - Date().timeIntervalSince1970 } ?? 0
    static var date: Date { Date().addingTimeInterval(offset) }
}
'''
(OUT / 'DashboardModel.swift').write_text(d)

sources = [OUT / 'CaptureApp.swift', OUT / 'QuickDashboard.swift', OUT / 'DashboardModel.swift'] + [DESKTOP / name for name in [
    'QuickText.swift', 'Typography.swift', 'CompactTokenMap.swift', 'CompactUsageFlow.swift', 'AgentPalette.swift']]
xcode = {**os.environ, 'DEVELOPER_DIR': os.environ.get('DEVELOPER_DIR', '/Applications/Xcode.app/Contents/Developer')}
subprocess.run(['xcrun', 'swiftc', '-O', '-framework', 'AppKit', '-framework', 'SwiftUI', '-framework', 'WebKit',
                '-framework', 'CoreText', *map(str, sources), '-o', str(OUT / 'capture-app')], check=True, env=xcode)
# The window recorder used by record.py.
subprocess.run(['xcrun', 'swiftc', '-O', str(Path(__file__).resolve().parent / 'window_film.swift'), '-o', str(OUT / 'window-film')],
               check=True, env=xcode)
print(OUT / 'capture-app', OUT / 'window-film')
