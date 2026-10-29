import XCTest

/// Drives the installed app on a real iPhone and keeps a screenshot of every step.
///
/// The app runs with `-qaGuard YES`: it refuses every control and message except to the session
/// whose id is given as QA_SESSION (`TEST_RUNNER_QA_SESSION=<id> xcodebuild test …`). Tests 01–05
/// need no test session; they only open screens and confirmation sheets. Tests 10–15 act on the
/// test session and are skipped without one.
@MainActor
final class DeviceQATests: XCTestCase {
    private var session: String { ProcessInfo.processInfo.environment["QA_SESSION"] ?? "" }

    override func setUp() async throws { continueAfterFailure = false }

    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-language", "ko", "-qaGuard", "YES", "-qaSession", session] + extra
        app.launch()
        return app
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// A screenshot with the accessibility record beside it, and which detail sheet (if any) is open
    /// and by which path, so a sheet that covers the screen can be traced to its cause.
    private func evidence(_ app: XCUIApplication, _ name: String) {
        shot(app, name)
        let detail = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'detail-'")).firstMatch
        let note = XCTAttachment(string: "sheet: \(app.buttons["Sheet Grabber"].exists)\ndetail: \(detail.exists ? detail.identifier : "none")\n\n" + app.debugDescription)
        note.name = name + "-ax"
        note.lifetime = .keepAlways
        add(note)
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @discardableResult
    private func wait(_ object: XCUIElement, _ format: String, timeout: TimeInterval) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: object)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    private func waitLive(_ app: XCUIApplication, timeout: TimeInterval = 45) -> Bool {
        let connection = element(app, "connection")
        guard connection.waitForExistence(timeout: 15) else { return false }
        return wait(connection, "label BEGINSWITH '실시간'", timeout: timeout)
    }

    /// Closes a confirmation without choosing its action. iOS 26 shows it as a popover without a
    /// Cancel button, so tap its dismiss region, or the sheet's title, which is outside the popover.
    private func dismissConfirmation(_ app: XCUIApplication) {
        let cancel = element(app, "confirm-cancel"), region = app.otherElements["PopoverDismissRegion"]
        if cancel.exists && cancel.isHittable { cancel.tap() }
        else if region.exists { region.tap() }
        else { app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.11)).tap() }
    }

    /// Taps once the element can be tapped, so a covering sheet or a reveal in progress fails clearly.
    private func tapWhenReady(_ element: XCUIElement, _ what: String, timeout: TimeInterval = 10) {
        XCTAssertTrue(element.waitForExistence(timeout: timeout) && wait(element, "isHittable == true", timeout: timeout), "\(what) cannot be tapped")
        element.tap()
    }

    /// Opens a tab. After scrolling, the iOS 26 tab bar shrinks to the current tab alone; scroll back
    /// and, if needed, tap it so all five tabs are there before choosing one.
    private func openTab(_ app: XCUIApplication, _ index: Int) {
        let bar = app.tabBars.firstMatch
        if bar.buttons.count < 5 { app.swipeDown(velocity: .fast) }
        if bar.buttons.count < 5 { bar.buttons.firstMatch.tap() }
        XCTAssertTrue(wait(bar, "buttons.@count >= 5", timeout: 5) || bar.buttons.count >= 5, "Tab bar stayed minimized")
        let tab = bar.buttons.element(boundBy: index)
        tapWhenReady(tab, "tab \(index)")
        XCTAssertTrue(wait(tab, "isSelected == true", timeout: 5), "Tab \(index) did not open")
    }

    /// The header's one-tap theme toggle, until the screen shows `look` ("dark" or "light").
    private func showTheme(_ app: XCUIApplication, _ look: String) {
        let toggle = app.buttons["theme-toggle"]
        for _ in 0..<2 where (toggle.value as? String) != look {
            tapWhenReady(toggle, "Theme toggle")
            sleep(1)  // the reveal takes half a second
        }
        XCTAssertEqual(toggle.value as? String, look, "Theme did not become \(look)")
    }

    /// The header's one-tap language choice.
    private func showLanguage(_ app: XCUIApplication, _ code: String) {
        let segment = app.buttons["header-language-" + code]
        tapWhenReady(segment, "Language \(code)")
        XCTAssertTrue(wait(segment, "isSelected == true", timeout: 5), "Language \(code) not selected")
        sleep(1)
    }

    /// The System theme is only in Workspace settings; choose it there and come back.
    private func chooseSystemTheme(_ app: XCUIApplication) {
        openTab(app, 4)
        let picker = element(app, "settings-theme")
        for _ in 0..<6 where !(picker.exists && picker.isHittable) { app.swipeUp() }
        tapWhenReady(picker, "Theme setting")
        let system = app.buttons.matching(NSPredicate(format: "label IN %@", ["시스템", "System", "跟随系统"])).firstMatch
        tapWhenReady(system, "System theme")
        openTab(app, 0)
    }

    // MARK: Without a test session

    func test01_InstallLaunchLive() {
        let app = launch()
        XCTAssertFalse(app.buttons["1top 계정으로 연결"].waitForExistence(timeout: 3), "Saved sign-in was not used")
        XCTAssertTrue(waitLive(app), "No live connection")
        shot(app, "01-launch-live")
    }

    func test02_SignInSurvivesRelaunch() {
        let app = launch()
        XCTAssertTrue(waitLive(app))
        shot(app, "02a-before-relaunch")
        app.terminate()
        app.launch()
        XCTAssertFalse(app.buttons["1top 계정으로 연결"].waitForExistence(timeout: 3), "Sign-in screen after relaunch")
        XCTAssertTrue(waitLive(app), "Not live after relaunch")
        shot(app, "02b-after-relaunch")
    }

    func test03_LiveReportsKeepArriving() {
        let app = launch()
        XCTAssertTrue(waitLive(app))
        let connection = element(app, "connection"), first = connection.value as? String ?? ""
        shot(app, "03a-first-report")
        XCTAssertTrue(wait(connection, "value != %@".replacingOccurrences(of: "%@", with: "'\(first)'"), timeout: 40), "No new report in 40 s after \(first)")
        shot(app, "03b-next-report")
    }

    func test04_Reconnect() {
        let app = launch()
        XCTAssertTrue(waitLive(app))
        element(app, "more-menu").tap()
        let reconnect = app.buttons["지금 다시 연결"]
        XCTAssertTrue(reconnect.waitForExistence(timeout: 5))
        shot(app, "04a-menu")
        reconnect.tap()
        shot(app, "04b-reconnecting")
        XCTAssertTrue(waitLive(app), "Did not come back live")
        shot(app, "04c-live-again")
    }

    func test05_ScreensAndConfirmation() {
        let app = launch()
        XCTAssertTrue(waitLive(app))
        shot(app, "05a-dashboard")
        for (tab, name) in [("세션", "05b-sessions"), ("사용량", "05c-usage"), ("한도", "05d-limits"), ("워크스페이스", "05e-workspace")] {
            app.tabBars.buttons[tab].tap()
            sleep(2)
            shot(app, name)
        }
        app.tabBars.buttons["세션"].tap()
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'session-'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.buttons["작업 제어"].waitForExistence(timeout: 10), "Session detail did not open")
        sleep(3)
        shot(app, "05f-detail-messages")
        app.buttons["작업 제어"].tap()
        sleep(1)
        shot(app, "05g-detail-controls")
        // Open one confirmation and close it. The QA guard refuses this session even if tapped.
        let control = ["control-pause", "control-focus", "control-resume", "control-terminate"]
            .map { element(app, $0) }.first { $0.exists && $0.isEnabled }
        guard let control else { shot(app, "05h-no-enabled-control"); return }
        control.tap()
        XCTAssertTrue(element(app, "confirm-action").waitForExistence(timeout: 5), "No confirmation")
        shot(app, "05h-confirmation")
        dismissConfirmation(app)
        XCTAssertFalse(element(app, "confirm-action").waitForExistence(timeout: 2), "Confirmation still open")
        let note = element(app, "control-note")
        XCTAssertTrue(!note.exists || note.label.contains("QA 보호"), "Something was sent: \(note.label)")
        shot(app, "05i-closed-nothing-sent")
    }

    /// Demo data: scroll the dashboard and check that nothing shows through the status bar.
    func test06_DashboardScrollEdge() {
        let app = launch(["--demo"])
        XCTAssertTrue(element(app, "connection").waitForExistence(timeout: 10))
        shot(app, "06a-top")
        app.swipeUp(velocity: .slow)
        sleep(1)
        shot(app, "06b-scrolled")
    }

    /// Demo data: the Mac mini is paired without remote control, so its session offers nothing to send.
    func test07_ComputerWithoutRemoteControl() {
        let app = launch(["--demo", "-screenDetail", "m1"])
        XCTAssertTrue(element(app, "control-off").waitForExistence(timeout: 10), "No notice for a computer without remote control")
        XCTAssertFalse(app.buttons["작업 제어"].exists, "Pane picker shown")
        XCTAssertFalse(element(app, "control-pause").exists || element(app, "instruction").exists || element(app, "mail-draft").exists, "A control is offered")
        shot(app, "07-control-off")
    }

    /// Theme and language are changed with the header's one-tap controls, never pinned by launch
    /// arguments, and come back after a relaunch from what the app saved. The chosen computer, the
    /// period, the demo session and the scroll position survive each change.
    func test08_ThemeAndLanguagePersist() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-qaGuard", "YES"]
        app.launch()
        let toggle = app.buttons["theme-toggle"], connection = app.buttons["connection"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        showLanguage(app, "ko")
        // One tap flips the theme, whatever it was.
        let before = toggle.value as? String ?? ""
        tapWhenReady(toggle, "Theme toggle")
        XCTAssertTrue(wait(toggle, "value != '\(before)'", timeout: 3), "One tap did not flip the theme")
        sleep(1)
        // Choose a computer and a period, and scroll a little; the changes below must keep them.
        tapWhenReady(element(app, "period-5h"), "5h")
        tapWhenReady(connection, "Computer menu")
        tapWhenReady(app.buttons["scope-demo-mini"], "Mac mini")
        app.swipeUp(velocity: .slow)
        sleep(1)
        let row = app.buttons["session-m1"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let top = row.frame.minY
        func kept(_ step: String) {
            XCTAssertTrue(element(app, "period-5h").isSelected, "Period lost after \(step)")
            XCTAssertTrue(connection.label.contains("Mac mini"), "Computer lost after \(step): \(connection.label)")
            XCTAssertTrue(connection.label.hasPrefix("데모") || connection.label.hasPrefix("Demo") || connection.label.hasPrefix("演示"), "Demo ended after \(step)")
            XCTAssertLessThan(abs(row.frame.minY - top), 3, "Scroll moved after \(step)")
        }
        showTheme(app, "dark")
        kept("dark")
        shot(app, "08a-dark-ko")
        showTheme(app, "light")
        kept("light")
        showLanguage(app, "zh")
        kept("Chinese")
        shot(app, "08b-light-zh")
        app.terminate()
        app.launch()
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        XCTAssertEqual(toggle.value as? String, "light", "Theme not kept after relaunch")
        XCTAssertTrue(app.buttons["header-language-zh"].isSelected, "Language not kept after relaunch")
        XCTAssertTrue(app.tabBars.buttons["会话"].exists, "Tabs not in Chinese after relaunch")
        shot(app, "08c-relaunched")
        // Leave the simulator as it was: Korean and the iPhone's own theme.
        showLanguage(app, "ko")
        chooseSystemTheme(app)
    }

    /// Every period changes the dashboard; the session detail still opens its messages and controls.
    func test09_PeriodsAndSessionDetail() {
        let app = launch(["--demo"])
        XCTAssertTrue(element(app, "period-1h").waitForExistence(timeout: 10))
        shot(app, "09a-before-morph")
        for (key, label) in [("10m", "10분"), ("30m", "30분"), ("1h", "1시간"), ("5h", "5시간"), ("12h", "12시간"), ("24h", "24시간")] {
            let button = element(app, "period-" + key)
            button.tap()
            XCTAssertTrue(wait(button, "isSelected == true", timeout: 3), "\(key) not selected")
            XCTAssertTrue(app.staticTexts["최근 " + label].waitForExistence(timeout: 3), "Dashboard did not follow \(key)")
            if key == "10m" { shot(app, "09b-after-morph-10m") }
        }
        element(app, "period-1h").tap()
        let row = element(app, "session-d2")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(element(app, "mail-draft").waitForExistence(timeout: 5), "Messages did not open")
        shot(app, "09c-detail-messages")
        app.buttons["작업 제어"].tap()
        let pause = element(app, "control-pause")
        XCTAssertTrue(pause.waitForExistence(timeout: 5))
        shot(app, "09d-detail-controls")
        pause.tap()
        XCTAssertTrue(element(app, "confirm-action").waitForExistence(timeout: 5), "No confirmation")
        shot(app, "09e-confirmation")
        dismissConfirmation(app)
        XCTAssertFalse(element(app, "confirm-action").waitForExistence(timeout: 2), "Confirmation still open")
        XCTAssertFalse(element(app, "control-note").exists, "Something was sent")
    }

    /// Simulator only: the dashboard in dark and light for each language, and the other screens
    /// once per theme. Arguments pin theme and language here, which reads them without saving.
    func test20_CaptureMatrix() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Capture matrix runs in the simulator.")
        #endif
        for look in ["dark", "light"] {
            for language in ["ko", "en", "zh"] {
                let app = XCUIApplication()
                app.launchArguments = ["--demo", "-qaGuard", "YES", "-appearance", look, "-language", language]
                app.launch()
                XCTAssertTrue(app.buttons["theme-toggle"].waitForExistence(timeout: 10))
                sleep(2)
                shot(app, "20-\(look)-\(language)-dashboard")
                guard (look == "dark" && language == "zh") || (look == "light" && language == "ko") || (look == "dark" && language == "en") else { continue }
                element(app, "connection").tap(); sleep(1)
                shot(app, "20-\(look)-\(language)-computer-menu")
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)).tap(); sleep(1)
                for (index, name) in [(1, "sessions"), (2, "usage")] {
                    app.tabBars.buttons.element(boundBy: index).tap(); sleep(2)
                    shot(app, "20-\(look)-\(language)-\(name)")
                }
                app.terminate()
                app.launchArguments += ["-screenDetail", "d2", "-screenPane", "controls"]
                app.launch()
                XCTAssertTrue(element(app, "control-pause").waitForExistence(timeout: 15))
                sleep(1)
                shot(app, "20-\(look)-\(language)-detail-controls")
            }
        }
    }

    /// Simulator only: two period changes, slow enough to film. A screen recording around this test
    /// shows the selection morphing, or jumping when Reduce Motion is on.
    func test21_PeriodMorphForFilming() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Filmed in the simulator.")
        #endif
        let app = launch(["--demo"])
        XCTAssertTrue(element(app, "period-1h").waitForExistence(timeout: 10))
        sleep(2)
        element(app, "period-10m").tap()
        sleep(2)
        element(app, "period-24h").tap()
        sleep(2)
    }

    /// Simulator only: a theme toggle and a language change, slow enough to film the reveal.
    func test22_RevealForFilming() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Filmed in the simulator.")
        #endif
        let app = launch(["--demo"])
        let toggle = app.buttons["theme-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        sleep(2)
        toggle.tap()
        sleep(2)
        app.buttons["header-language-zh"].tap()
        sleep(2)
        toggle.tap()
        sleep(2)
        // Back to Korean, as the simulator was; the two toggles cancel out.
        app.buttons["header-language-ko"].tap()
        sleep(1)
    }

    /// Simulator only: rapid taps on the theme and language controls never leave a snapshot behind;
    /// taps during a reveal are ignored, and the controls keep working afterwards.
    func test23_RapidTapsDuringReveal() throws {
        #if !targetEnvironment(simulator)
        throw XCTSkip("Simulator only.")
        #endif
        let app = launch(["--demo"])
        let toggle = app.buttons["theme-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        let start = toggle.value as? String ?? ""
        for _ in 0..<4 { toggle.tap() }
        for code in ["en", "zh", "ko", "en"] { app.buttons["header-language-" + code].tap() }
        sleep(2)
        shot(app, "23a-after-rapid-taps")
        // Still responsive: one more tap flips the theme, and Korean can be chosen.
        let now = toggle.value as? String ?? ""
        tapWhenReady(toggle, "Theme toggle after rapid taps")
        XCTAssertTrue(wait(toggle, "value != '\(now)'", timeout: 3), "Theme toggle stuck after rapid taps")
        sleep(1)
        showLanguage(app, "ko")
        if (toggle.value as? String) != start { tapWhenReady(toggle, "Theme toggle back"); sleep(1) }
        XCTAssertTrue(element(app, "period-1h").isHittable, "Dashboard covered after rapid taps")
        shot(app, "23b-responsive")
    }

    // MARK: Signed in, live (real device)

    private var restoreDisplay = false
    private static let liveLabel = "label BEGINSWITH '실시간' OR label BEGINSWITH 'Live' OR label BEGINSWITH '实时'"

    /// Whatever happened, leave the iPhone in Korean with the system theme. The System theme is
    /// chosen in Workspace settings, as a person would; nothing is deleted from UserDefaults.
    override func tearDown() async throws {
        guard restoreDisplay else { return }
        restoreDisplay = false
        let app = XCUIApplication()
        app.launchArguments = ["-qaGuard", "YES", "-qaSession", session]
        if app.state != .runningForeground { app.launch() }
        if app.buttons["Sheet Grabber"].exists { app.swipeDown(velocity: .fast) }
        openTab(app, 0)
        if app.buttons["header-language-ko"].waitForExistence(timeout: 15) { showLanguage(app, "ko") }
        chooseSystemTheme(app)
    }

    /// Signed in and live, never pinned by launch arguments: the header's theme toggle and language
    /// choice keep the computer chosen in the header menu, the chosen period and the live connection,
    /// and come back after a relaunch. Everything happens on the dashboard; nothing is sent to any session.
    func test16_DisplayChangesKeepLiveSession() {
        restoreDisplay = true
        let app = XCUIApplication()
        app.launchArguments = ["-qaGuard", "YES", "-qaSession", session]
        app.launch()
        let connection = app.buttons["connection"], toggle = app.buttons["theme-toggle"]
        evidence(app, "16-00a-launched")
        XCTAssertTrue(connection.waitForExistence(timeout: 20) && wait(connection, Self.liveLabel, timeout: 45), "Not live; is this iPhone signed in?")
        evidence(app, "16-00b-live-before-first-tap")
        // The scope: the first computer in the header menu; its name then shows in the connection label.
        var computer = ""
        func chooseScope() {
            let first = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'scope-' AND identifier != 'scope-all'")).firstMatch
            tapWhenReady(connection, "Computer menu")
            XCTAssertTrue(first.waitForExistence(timeout: 5) && wait(first, "isHittable == true", timeout: 5), "No computer to choose")
            computer = first.label.components(separatedBy: " · ").first ?? first.label
            first.tap()
            tapWhenReady(element(app, "period-5h"), "5h")
        }
        func check(_ step: String) {
            XCTAssertFalse(app.buttons["Sheet Grabber"].exists, "A sheet covers the dashboard after \(step)")
            XCTAssertTrue(wait(connection, Self.liveLabel, timeout: 30), "Lost live after \(step): \(connection.label)")
            XCTAssertTrue(connection.label.contains(computer), "Computer \(computer) lost after \(step): \(connection.label)")
            XCTAssertTrue(element(app, "period-5h").isSelected, "Period lost after \(step)")
            shot(app, "16-" + step)
        }
        showLanguage(app, "ko")
        // Record the screen right after the first header tap and a few seconds later.
        evidence(app, "16-00c-after-first-tap")
        sleep(2); evidence(app, "16-00d-2s-later")
        sleep(2); evidence(app, "16-00e-4s-later")
        chooseScope()
        check("01-scope-chosen")
        showTheme(app, "dark"); check("02-dark")
        showTheme(app, "light"); check("03-light")
        showLanguage(app, "en"); check("04-english")
        showLanguage(app, "zh"); check("05-chinese")
        // Relaunch: theme and language come back from what the app saved, and it is live again.
        app.terminate()
        app.launch()
        XCTAssertTrue(toggle.waitForExistence(timeout: 20))
        XCTAssertEqual(toggle.value as? String, "light", "Theme not restored after relaunch")
        XCTAssertTrue(app.buttons["header-language-zh"].isSelected, "Language not restored after relaunch")
        XCTAssertTrue(wait(connection, Self.liveLabel, timeout: 45), "Not live after relaunch")
        shot(app, "16-06-relaunched")
        // The period and computer start over after a relaunch; choose them again for the last checks.
        chooseScope()
        showLanguage(app, "ko"); check("07-korean")
        // The System theme is restored in tearDown, from Workspace settings.
    }

    // MARK: With the test session (QA_SESSION)

    private func openTestSession(_ pane: String) throws -> XCUIApplication {
        try XCTSkipIf(session.isEmpty, "No QA_SESSION; controls are not sent to real sessions.")
        let app = launch(["-screenDetail", session, "-screenPane", pane])
        XCTAssertTrue(app.buttons["작업 제어"].waitForExistence(timeout: 40), "Test session \(session) did not open")
        return app
    }

    /// Confirms one control on the test session and waits for the computer's receipt.
    private func control(_ action: String, step: String) throws {
        let app = try openTestSession("controls")
        let button = element(app, "control-" + action)
        XCTAssertTrue(button.waitForExistence(timeout: 60) && wait(button, "isEnabled == true", timeout: 60), "\(action) not available")
        shot(app, step + "a-before")
        button.tap()
        let confirm = element(app, "confirm-action")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        shot(app, step + "b-confirmation")
        confirm.tap()
        let note = element(app, "control-note")
        XCTAssertTrue(note.waitForExistence(timeout: 15), "No result line")
        shot(app, step + "c-sent")
        XCTAssertTrue(wait(note, "label CONTAINS '완료' OR label CONTAINS '실패' OR label CONTAINS '미확인'", timeout: 40), "No receipt: \(note.label)")
        shot(app, step + "d-receipt")
        XCTAssertTrue(note.label.contains("완료"), "Receipt: \(note.label)")
    }

    func test10_Instruction() throws {
        let app = try openTestSession("controls")
        let field = element(app, "instruction")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("1top QA instruction test. Run sleep 150 in the shell, then reply OK only. Do not change any files.")
        shot(app, "10a-typed")
        let send = element(app, "instruction-send")
        XCTAssertTrue(wait(send, "isEnabled == true", timeout: 20))
        send.tap()
        let confirm = element(app, "confirm-action")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        shot(app, "10b-confirmation")
        confirm.tap()
        let note = element(app, "control-note")
        XCTAssertTrue(note.waitForExistence(timeout: 15))
        shot(app, "10c-sent")
        XCTAssertTrue(wait(note, "label CONTAINS '완료' OR label CONTAINS '실패' OR label CONTAINS '미확인'", timeout: 40), "No receipt: \(note.label)")
        shot(app, "10d-receipt")
        XCTAssertTrue(note.label.contains("완료"), "Receipt: \(note.label)")
    }

    func test11_QuestionAndReply() throws {
        let app = try openTestSession("messages")
        let draft = element(app, "mail-draft")
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        draft.tap()
        draft.typeText("1top QA question: reply with one short line about your state.")
        shot(app, "11a-typed")
        let send = element(app, "mail-send")
        XCTAssertTrue(wait(send, "isEnabled == true", timeout: 20))
        send.tap()
        XCTAssertTrue(element(app, "mail-status").waitForExistence(timeout: 15), "Message did not appear")
        shot(app, "11b-sent")
        XCTAssertTrue(element(app, "mail-reply").waitForExistence(timeout: 240), "No reply in 4 minutes")
        shot(app, "11c-reply")
    }

    func test12_Pause() throws { try control("pause", step: "12") }
    func test13_Resume() throws { try control("resume", step: "13") }
    func test14_Terminate() throws { try control("terminate", step: "14") }
}
