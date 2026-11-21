import XCTest

/// The cluster's look on the iPhone (cluster-themes plan v1.1.0), in the simulator with the demo: the customizing list
/// opens the gallery of themes, a card draws that theme in place of the dials, '크게 보기' shows it over the whole
/// screen on its side and closes again, and the list's reset goes back to the 1top instruments. The demo sends nothing
/// anywhere.
@MainActor
final class ClusterThemeTests: XCTestCase {
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

    func testGalleryPicksATheme() {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-qaDemoNow", "1793000000", "-language", "ko", "-layoutSeed", "none", "-screenTab", "cluster", "-clusterThemeV1", ""]
        app.launch()
        XCTAssertTrue(element(app, "cluster-tachometer").waitForExistence(timeout: 15), "The 1top dials show first")
        element(app, "customize-gear").tap()
        element(app, "cz-list").tap()
        XCTAssertTrue(element(app, "cz-theme").waitForExistence(timeout: 5), "The cluster's list names its look")
        element(app, "cz-theme").tap()
        XCTAssertTrue(element(app, "theme-gallery-sheet").waitForExistence(timeout: 5))
        sleep(4)
        shot(app, "theme-gallery")
        // The web view's cards read as switches (a pressed button), named by their theme.
        let card = app.switches.matching(NSPredicate(format: "label CONTAINS '01 · '")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15), "The gallery draws the themes")
        card.tap()
        sleep(1)
        element(app, "theme-gallery-close").tap()
        XCTAssertTrue(element(app, "cz-theme").label.hasPrefix("01 · "), "The list names the theme picked: \(element(app, "cz-theme").label)")
        element(app, "cz-done").tap()

        XCTAssertTrue(element(app, "cluster-theme").waitForExistence(timeout: 10), "The theme draws the instruments")
        XCTAssertFalse(element(app, "cluster-tachometer").exists, "The 1top dials step aside")
        shot(app, "theme-cluster")
        element(app, "cluster-theme-big").tap()
        XCTAssertTrue(element(app, "cluster-theme-close").waitForExistence(timeout: 5), "'크게 보기' covers the screen")
        sleep(2)
        shot(app, "theme-full")
        element(app, "cluster-theme-close").tap()
        XCTAssertTrue(element(app, "cluster-theme-big").waitForExistence(timeout: 5))

        // The list's reset takes the 1top instruments back.
        element(app, "customize-gear").tap()
        element(app, "cz-list").tap()
        element(app, "cz-reset").tap()
        element(app, "cz-done").tap()
        XCTAssertTrue(element(app, "cluster-tachometer").waitForExistence(timeout: 10))
    }
}
