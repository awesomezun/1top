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

    /// Theme and language are changed through the dashboard menu, never pinned by launch arguments,
    /// and must survive a relaunch from what the app saved. The chosen computer and period must
    /// survive the switch itself.
    func test08_ThemeAndLanguagePersist() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-qaGuard", "YES"]
        app.launch()
        let menu = app.buttons["display-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        func choose(_ title: String) {
            XCTAssertTrue(wait(menu, "isHittable == true", timeout: 10), "Theme and language menu cannot be tapped")
            menu.tap()
            let item = app.buttons[title]
            XCTAssertTrue(item.waitForExistence(timeout: 5) && wait(item, "isHittable == true", timeout: 5), "No menu item \(title)")
            item.tap()
            XCTAssertTrue(menu.waitForExistence(timeout: 5))
        }
        // Start from Korean so the theme names are known; language names never change.
        choose("한국어")
        // Pick a computer and a period first; the switches below must keep them.
        element(app, "period-5h").tap()
        element(app, "connection").tap()
        let mini = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Mac mini'")).firstMatch
        XCTAssertTrue(mini.waitForExistence(timeout: 5))
        mini.tap()
        choose("다크")
        XCTAssertEqual(menu.value as? String, "dark ko")
        shot(app, "08a-dark-ko")
        choose("라이트")
        XCTAssertEqual(menu.value as? String, "light ko")
        choose("中文")
        XCTAssertEqual(menu.value as? String, "light zh")
        XCTAssertTrue(element(app, "period-5h").isSelected, "Period lost on switching")
        XCTAssertTrue((element(app, "connection").label).contains("Mac mini"), "Computer lost on switching")
        XCTAssertFalse(app.buttons["1top 계정으로 연결"].exists || app.buttons["使用 1top 账户连接"].exists, "Signed out on switching")
        shot(app, "08b-light-zh")
        app.terminate()
        app.launch()
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        XCTAssertEqual(menu.value as? String, "light zh", "Not kept after relaunch")
        XCTAssertTrue(app.tabBars.buttons["会话"].exists, "Tabs not in Chinese after relaunch")
        shot(app, "08c-relaunched")
        // Leave the simulator as it was: the iPhone's own theme, Korean.
        choose("跟随系统")
        choose("한국어")
        XCTAssertEqual(menu.value as? String, "system ko")
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
                XCTAssertTrue(app.buttons["display-menu"].waitForExistence(timeout: 10))
                sleep(2)
                shot(app, "20-\(look)-\(language)-dashboard")
                guard (look == "dark" && language == "zh") || (look == "light" && language == "ko") || (look == "dark" && language == "en") else { continue }
                app.buttons["display-menu"].tap(); sleep(1)
                shot(app, "20-\(look)-\(language)-display-menu")
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)).tap(); sleep(1)
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

    // MARK: Signed in, live (real device)

    private var restoreDisplay = false
    private static let liveLabel = "label BEGINSWITH '실시간' OR label BEGINSWITH 'Live' OR label BEGINSWITH '实时'"

    /// Whatever happened, leave the iPhone in Korean with the system theme.
    override func tearDown() async throws {
        guard restoreDisplay else { return }
        restoreDisplay = false
        let app = XCUIApplication()
        app.launchArguments = ["-qaGuard", "YES", "-qaSession", session]
        if app.state != .runningForeground { app.launch() }
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.02)).tap()
        let dashboard = app.tabBars.buttons.element(boundBy: 0)
        if dashboard.waitForExistence(timeout: 10) { dashboard.tap() }
        let menu = app.buttons["display-menu"]
        guard menu.waitForExistence(timeout: 15) else { return }
        for title in ["한국어", "시스템"] {
            menu.tap()
            let item = app.buttons[title]
            if item.waitForExistence(timeout: 5), wait(item, "isHittable == true", timeout: 5) { item.tap() }
        }
    }

    /// Signed in and live, never pinned by launch arguments: theme and language changes keep the
    /// chosen period and computer and the live connection, and come back after a relaunch.
    /// Sends nothing to any session.
    func test16_DisplayChangesKeepLiveSession() {
        restoreDisplay = true
        let app = XCUIApplication()
        app.launchArguments = ["-qaGuard", "YES", "-qaSession", session]
        app.launch()
        let connection = element(app, "connection"), menu = app.buttons["display-menu"]
        XCTAssertTrue(connection.waitForExistence(timeout: 20) && wait(connection, Self.liveLabel, timeout: 45), "Not live; is this iPhone signed in?")
        let dashboardTab = app.tabBars.buttons.element(boundBy: 0), workspaceTab = app.tabBars.buttons.element(boundBy: 4)
        // A scrolled list minimizes the iOS 26 tab bar, and a tap where a tab used to be lands on the
        // content below it. Scroll back to the top first and open a tab only once it can be tapped.
        func show(_ tab: XCUIElement, _ name: String) {
            XCTAssertFalse(app.buttons["Sheet Grabber"].exists, "A sheet covers the screen before opening \(name)")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.02)).tap()
            XCTAssertTrue(wait(tab, "isHittable == true", timeout: 10), "\(name) tab cannot be tapped")
            tab.tap()
            XCTAssertTrue(wait(tab, "isSelected == true", timeout: 10), "\(name) tab did not open")
        }
        func choose(_ title: String, expect value: String, step: String) {
            XCTAssertTrue(wait(menu, "isHittable == true", timeout: 10), "Theme and language menu cannot be tapped")
            menu.tap()
            let item = app.buttons[title]
            XCTAssertTrue(item.waitForExistence(timeout: 5) && wait(item, "isHittable == true", timeout: 5), "No menu item \(title)")
            item.tap()
            XCTAssertTrue(wait(menu, "value == '\(value)'", timeout: 5), "Expected \(value), got \(String(describing: menu.value))")
            check(step)
        }
        // The chosen scope: one computer from the Workspace list, read back by its selected trait.
        var computer = ""
        func check(_ step: String) {
            XCTAssertTrue(wait(connection, Self.liveLabel, timeout: 30), "Lost live after \(step): \(connection.label)")
            XCTAssertTrue(element(app, "period-5h").isSelected, "Period lost after \(step)")
            show(workspaceTab, "Workspace")
            let chosen = element(app, computer)
            XCTAssertTrue(chosen.waitForExistence(timeout: 10) && wait(chosen, "isHittable == true", timeout: 10) && chosen.isSelected, "Computer lost after \(step)")
            show(dashboardTab, "Dashboard")
            XCTAssertTrue(wait(menu, "isHittable == true", timeout: 10), "Dashboard header is covered after \(step)")
            shot(app, "16-" + step)
        }
        // Korean first, so the theme names below are known; nothing is chosen yet to check.
        menu.tap()
        XCTAssertTrue(app.buttons["한국어"].waitForExistence(timeout: 5) && wait(app.buttons["한국어"], "isHittable == true", timeout: 5))
        app.buttons["한국어"].tap()
        XCTAssertTrue(wait(menu, "value ENDSWITH ' ko'", timeout: 5))
        element(app, "period-5h").tap()
        show(workspaceTab, "Workspace")
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'computer-' AND identifier != 'computer-all'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10) && wait(row, "isHittable == true", timeout: 10), "No computer to choose")
        computer = row.identifier
        row.tap()
        XCTAssertFalse(app.buttons["Sheet Grabber"].exists, "Choosing a computer opened a sheet")
        show(dashboardTab, "Dashboard")
        check("01-scope-chosen")
        choose("다크", expect: "dark ko", step: "02-dark")
        choose("라이트", expect: "light ko", step: "03-light")
        choose("English", expect: "light en", step: "04-english")
        choose("中文", expect: "light zh", step: "05-chinese")
        // Relaunch: theme and language come back from what the app saved, and it is live again.
        app.terminate()
        app.launch()
        XCTAssertTrue(menu.waitForExistence(timeout: 20))
        XCTAssertEqual(menu.value as? String, "light zh", "Not restored after relaunch")
        XCTAssertTrue(wait(connection, Self.liveLabel, timeout: 45), "Not live after relaunch")
        shot(app, "16-06-relaunched")
        // The period and computer start over after a relaunch; choose them again for the last checks.
        element(app, "period-5h").tap()
        show(workspaceTab, "Workspace")
        XCTAssertTrue(element(app, computer).waitForExistence(timeout: 10) && wait(element(app, computer), "isHittable == true", timeout: 10))
        element(app, computer).tap()
        show(dashboardTab, "Dashboard")
        choose("한국어", expect: "light ko", step: "07-korean")
        choose("시스템", expect: "system ko", step: "08-system")
        restoreDisplay = false
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
