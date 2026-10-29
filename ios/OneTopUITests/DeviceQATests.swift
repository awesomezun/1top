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
