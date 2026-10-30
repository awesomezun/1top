import XCTest

/// The demo as App Review and a first user meet it, so it also runs against a Release build
/// (`xcodebuild test -configuration Release -only-testing:OneTopUITests/ReleaseDemoTests`): only `--demo`
/// at launch, the session opened by tapping it, and a photo chosen in the system picker. The simulator's
/// library needs one picture first (`xcrun simctl addmedia`). The demo sends nothing anywhere.
@MainActor
final class ReleaseDemoTests: XCTestCase {
    override func setUp() async throws { continueAfterFailure = false }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testDemoSendsAPhotoFromThePicker() {
        let app = XCUIApplication()
        // -qaGuard and -qaSession only exist in Debug builds; there they keep the send on the demo session.
        app.launchArguments = ["--demo", "-language", "en", "-qaGuard", "YES", "-qaSession", "s1"]
        app.launch()
        let row = element(app, "session-s1")
        for _ in 0..<4 where !(row.waitForExistence(timeout: 5) && row.isHittable) { app.swipeUp() }
        row.tap()
        XCTAssertTrue(element(app, "work-status").waitForExistence(timeout: 15), "Conversation did not open")

        element(app, "photo-pick").tap()
        let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo'")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 20), "No photo in the system picker")
        shot(app, "release-1-picker")
        photo.tap()
        // iOS 26 shows the picker's confirm button as a check mark: identifier "Add", label "Done".
        let add = app.buttons.matching(NSPredicate(format: "identifier == 'Add' OR label IN {'Add', 'Done'}")).firstMatch
        if add.waitForExistence(timeout: 3) { add.tap() }
        XCTAssertTrue(element(app, "photo-preview-0").waitForExistence(timeout: 15), "The chosen photo is not in the composer")
        shot(app, "release-2-composer")

        let draft = element(app, "mail-draft")
        draft.tap()
        draft.typeText("Does this screen look right?")
        element(app, "mail-send").tap()
        let confirm = element(app, "confirm-action")
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "No send confirmation")
        confirm.tap()
        XCTAssertFalse(element(app, "photo-preview-0").waitForExistence(timeout: 3), "The composer kept the photo after sending")
        // The sent message shows the picture itself; earlier demo photos are only listed by name.
        let sent = app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'mail-attachments' AND label == 'Photos: 1'")).firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 5), "The sent message shows no photo")
        shot(app, "release-3-sent")

        let replies = app.staticTexts.matching(identifier: "mail-reply")
        let repliedBefore = replies.count
        let replied = XCTNSPredicateExpectation(predicate: NSPredicate(format: "count > %d", repliedBefore), object: replies)
        XCTAssertEqual(XCTWaiter().wait(for: [replied], timeout: 30), .completed, "No demo reply")
        shot(app, "release-4-reply")
    }
}
