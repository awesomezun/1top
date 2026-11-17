import XCTest

/// Customizing gate G3 on the iPhone (customizing-spec_v1.2.2), in the simulator with the demo: the gear and a long
/// press open the edit mode; − hides, the grip sizes, the object's sheet counts, a long press carries an object, the
/// gallery changes a shape and returns to the sheet, the list shows and moves objects and resets them, the phone's
/// tabs go from apart to one and back, everything survives a relaunch, and Reduce Motion keeps the objects still.
/// The demo sends nothing anywhere.
@MainActor
final class CustomizeFlowTests: XCTestCase {
    override func setUp() async throws { continueAfterFailure = false }

    private func launch(_ extra: [String] = [], fresh: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-qaDemoNow", "1793000000", "-language", "ko"] + (fresh ? ["-layoutSeed", "none"] : []) + extra
        app.launch()
        return app
    }
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }
    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func edit(_ app: XCUIApplication) {
        let gear = element(app, "customize-gear")
        XCTAssertTrue(gear.waitForExistence(timeout: 15), "No customizing gear")
        gear.tap()
        XCTAssertTrue(element(app, "cz-done").waitForExistence(timeout: 5), "The edit mode did not open")
    }
    private func top(_ app: XCUIApplication, _ id: String) -> CGFloat { element(app, "cz-part-" + id).frame.minY }

    func testDashboardHideCountSizeMoveListAndReset() {
        let app = launch(["-screenTab", "dashboard"])
        edit(app)
        XCTAssertFalse(element(app, "cluster-toggle").exists, "Apart, the dashboard tab has no quick switch")
        XCTAssertTrue(element(app, "cz-part-tokens").exists && element(app, "cz-part-sessions").exists)
        XCTAssertFalse(element(app, "cz-hide-periods").exists, "The period control cannot be hidden")
        shot(app, "dashboard-edit")

        // − hides; the hidden object waits under the chip.
        element(app, "cz-hide-resources").tap()
        XCTAssertTrue(element(app, "cz-part-resources").waitForNonExistence(timeout: 3))
        XCTAssertTrue(element(app, "cz-hidden-chip").waitForExistence(timeout: 3))

        // The object's own sheet counts.
        element(app, "cz-part-weekly").tap()
        XCTAssertTrue(element(app, "cz-object-weekly").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "cz-count").label, "4칸")
        element(app, "cz-count-up").tap()
        XCTAssertEqual(element(app, "cz-count").label, "6칸")
        shot(app, "dashboard-object-sheet")
        element(app, "cz-close").tap()
        XCTAssertTrue(element(app, "cz-object-weekly").waitForNonExistence(timeout: 3))

        // The grip: two steps of 44 points back make the token section small.
        let grip = element(app, "cz-grip-tokens")
        XCTAssertEqual(grip.value as? String, "크게")
        let from = grip.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        from.press(forDuration: 0.1, thenDragTo: from.withOffset(CGVector(dx: -95, dy: -95)))
        XCTAssertEqual(element(app, "cz-grip-tokens").value as? String, "작게")

        // A long press carries the sessions above the token section.
        let sessions = element(app, "cz-part-sessions"), tokens = element(app, "cz-part-tokens")
        let pick = sessions.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: sessions.frame.width / 2, dy: 24))
        pick.press(forDuration: 0.8, thenDragTo: tokens.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: tokens.frame.width / 2, dy: 8)))
        XCTAssertLessThan(top(app, "sessions"), top(app, "tokens"), "The sessions did not move above the tokens")

        // The list: shown again, one down, then the defaults.
        element(app, "cz-list").tap()
        XCTAssertTrue(element(app, "cz-list-sheet").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "cz-tabs-two").isSelected)
        element(app, "cz-shown-resources").tap()
        XCTAssertTrue(element(app, "cz-part-resources").waitForExistence(timeout: 3))
        element(app, "cz-down-sessions").tap()
        XCTAssertGreaterThan(top(app, "sessions"), top(app, "tokens"))
        shot(app, "dashboard-list")
        element(app, "cz-reset").tap()
        XCTAssertLessThan(top(app, "tokens"), top(app, "weekly"))
        XCTAssertLessThan(top(app, "resources"), top(app, "sessions"))
        element(app, "cz-close").tap()
        element(app, "cz-done").tap()
        XCTAssertTrue(element(app, "cz-done").waitForNonExistence(timeout: 3))
        XCTAssertTrue(element(app, "customize-gear").waitForExistence(timeout: 3))
    }

    func testClusterShapeTabsAndRelaunch() {
        var app = launch(["-screenTab", "cluster"])
        // Apart: five tabs, the cluster's after the dashboard's, and Workspace not among them.
        XCTAssertTrue(app.tabBars.buttons["계기판"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.tabBars.buttons.count, 5)
        XCTAssertFalse(app.tabBars.buttons["워크스페이스"].exists)
        // A long press on an object enters too.
        let dial = element(app, "cluster-tachometer")
        XCTAssertTrue(dial.waitForExistence(timeout: 15))
        dial.press(forDuration: 1.0)
        XCTAssertTrue(element(app, "cz-done").waitForExistence(timeout: 5), "A long press did not open the edit mode")
        XCTAssertFalse(element(app, "cz-hide-dials").exists, "The dials cannot be hidden")
        XCTAssertFalse(element(app, "cz-preset-cluster").exists, "Apart, the bar has no preset choice")

        // The gallery: a card applies its shape, closing returns to the object's sheet.
        element(app, "cz-part-alerts").tap()
        XCTAssertTrue(element(app, "cz-object-alerts").waitForExistence(timeout: 5))
        element(app, "cz-shape-alerts").tap()
        XCTAssertTrue(element(app, "cz-gallery-alerts").waitForExistence(timeout: 5))
        XCTAssertEqual(app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'cz-card-'")).count, 6)
        element(app, "cz-card-badge").tap()
        XCTAssertTrue(element(app, "cz-card-badge").isSelected)
        shot(app, "cluster-gallery")
        element(app, "cz-close").tap()
        XCTAssertTrue(element(app, "cz-object-alerts").waitForExistence(timeout: 3), "Closing the gallery did not return to the sheet")
        XCTAssertEqual(element(app, "cz-shape-alerts").label, "모양 배지")
        element(app, "cz-close").tap()
        element(app, "cz-hide-odo").tap()
        XCTAssertTrue(element(app, "cz-part-odo").waitForNonExistence(timeout: 3))
        element(app, "cz-done").tap()

        // Everything survives a relaunch.
        app.terminate()
        app = launch(["-screenTab", "cluster"], fresh: false)
        edit(app)
        XCTAssertFalse(element(app, "cz-part-odo").exists, "The hidden odometer came back")
        element(app, "cz-list").tap()
        XCTAssertTrue(element(app, "cz-list-sheet").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "cz-shape-alerts").label, "모양 배지")

        // One home tab: the cluster tab goes and the home tab shows the cluster it was left on; the header switches
        // and the bar chooses the preset.
        element(app, "cz-tabs-one").tap()
        XCTAssertTrue(app.tabBars.buttons["계기판"].waitForNonExistence(timeout: 5), "The cluster tab stayed")
        XCTAssertEqual(app.tabBars.buttons.count, 4)
        let toggle = element(app, "cluster-toggle")
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "No quick switch in the one home tab")
        XCTAssertTrue(element(app, "cluster").waitForExistence(timeout: 5), "The home tab did not keep the cluster")
        toggle.tap()
        XCTAssertTrue(element(app, "cluster").waitForNonExistence(timeout: 5))
        toggle.tap()
        XCTAssertTrue(element(app, "cluster").waitForExistence(timeout: 5))
        edit(app)
        XCTAssertTrue(element(app, "cz-preset-cluster").isSelected)
        element(app, "cz-preset-dashboard").tap()
        XCTAssertTrue(element(app, "cz-part-tokens").waitForExistence(timeout: 5))
        shot(app, "one-tab-edit")
        element(app, "cz-list").tap()
        element(app, "cz-tabs-two").tap()
        XCTAssertTrue(app.tabBars.buttons["계기판"].waitForExistence(timeout: 5), "The cluster tab did not come back")
    }

    /// Apart, the app reopens on the tab last chosen of 대시보드 and 계기판, and a cluster chosen in the old panel opens
    /// on 계기판.
    func testTheAppReopensOnTheTabLeft() {
        var app = launch()
        XCTAssertTrue(app.tabBars.buttons["대시보드"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["대시보드"].isSelected)
        app.tabBars.buttons["계기판"].tap()
        XCTAssertTrue(element(app, "cluster").waitForExistence(timeout: 5))
        app.terminate()
        app = launch(fresh: false)
        XCTAssertTrue(app.tabBars.buttons["계기판"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["계기판"].isSelected, "Did not reopen on 계기판")
        app.tabBars.buttons["사용량"].tap()
        app.tabBars.buttons["대시보드"].tap()
        app.terminate()
        app = launch(fresh: false)
        XCTAssertTrue(app.tabBars.buttons["대시보드"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["대시보드"].isSelected, "Did not reopen on 대시보드")
        app.terminate()
        // Nothing saved yet and the old panel on its cluster: 계기판.
        app = launch(["-quickCluster", "<true/>"])
        XCTAssertTrue(app.tabBars.buttons["계기판"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.tabBars.buttons["계기판"].isSelected, "The old cluster choice did not open on 계기판")
    }

    /// In English and Chinese no Hangul shows anywhere on the dashboard, the cluster and its window's pages, the edit
    /// mode, the objects' sheets, the galleries and the lists (a language's own name on the language button aside).
    func testEnglishAndChineseShowNoHangul() {
        for language in ["en", "zh"] {
            let app = XCUIApplication()
            app.launchArguments = ["--demo", "-qaDemoNow", "1793000000", "-language", language, "-layoutSeed", "none", "-screenTab", "dashboard"]
            app.launch()
            func check(_ place: String) {
                sleep(1)
                let found = app.debugDescription.split(separator: "\n").filter {
                    $0.range(of: "[가-힣]", options: .regularExpression) != nil && !$0.contains("language")
                }
                XCTAssertTrue(found.isEmpty, "\(language) · \(place):\n" + found.prefix(6).joined(separator: "\n"))
                shot(app, "\(language)-\(place)")
            }
            XCTAssertTrue(element(app, "customize-gear").waitForExistence(timeout: 15))
            check("dashboard")
            edit(app)
            check("dashboard-edit")
            element(app, "cz-part-weekly").tap()
            XCTAssertTrue(element(app, "cz-object-weekly").waitForExistence(timeout: 5))
            check("dashboard-object-sheet")
            element(app, "cz-close").tap()
            element(app, "cz-list").tap()
            XCTAssertTrue(element(app, "cz-list-sheet").waitForExistence(timeout: 5))
            check("dashboard-list")
            element(app, "cz-close").tap()
            element(app, "cz-done").tap()
            app.tabBars.buttons.element(boundBy: 1).tap()
            XCTAssertTrue(element(app, "cluster").waitForExistence(timeout: 10))
            for page in ["sessions", "flow", "weekly", "map", "heat", "goals", "system"] {
                element(app, "cluster-mode-" + page).tap()
                check("cluster-" + page)
            }
            element(app, "cluster-mode-sessions").tap()
            edit(app)
            check("cluster-edit")
            element(app, "cz-part-alerts").tap()
            XCTAssertTrue(element(app, "cz-object-alerts").waitForExistence(timeout: 5))
            check("cluster-object-sheet")
            element(app, "cz-shape-alerts").tap()
            XCTAssertTrue(element(app, "cz-gallery-alerts").waitForExistence(timeout: 5))
            check("gallery-alerts")
            element(app, "cz-close").tap()
            element(app, "cz-close").tap()
            element(app, "cz-hide-odo").tap()
            check("cluster-hidden-chip")
            element(app, "cz-list").tap()
            XCTAssertTrue(element(app, "cz-list-sheet").waitForExistence(timeout: 5))
            check("cluster-list")
            for id in ["odo", "periods", "dials"] {
                element(app, "cz-shape-" + id).tap()
                XCTAssertTrue(element(app, "cz-gallery-" + id).waitForExistence(timeout: 5))
                check("gallery-" + id)
                element(app, "cz-close").tap()
                XCTAssertTrue(element(app, "cz-list-sheet").waitForExistence(timeout: 5))
            }
            app.terminate()
        }
    }

    /// A window whose chosen tabs leave out the page last shown opens on the first of them.
    func testTheWindowOpensOnTheFirstChosenTab() {
        // The page remembered is the sessions; the layout shows only the resources and the usage map.
        let seeded = launchSeeded(#"{"v":1,"presets":{"cluster":{"opts":{"window":{"tabs":["system","map"]}}}}}"#)
        XCTAssertTrue(element(seeded, "cluster-mode-system").waitForExistence(timeout: 15))
        XCTAssertTrue(element(seeded, "cluster-mode-system").isSelected, "Did not open on the first chosen tab")
        XCTAssertFalse(element(seeded, "cluster-mode-sessions").exists)
    }
    private func launchSeeded(_ layout: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--demo", "-qaDemoNow", "1793000000", "-language", "ko", "-layoutSeed", layout, "-screenTab", "cluster", "-clusterMode", "sessions"]
        app.launch()
        return app
    }

    /// Workspace is the button at the right end of the dashboard's and the cluster's header, never a tab.
    func testWorkspaceOpensFromTheHeader() {
        let app = launch(["-screenTab", "cluster"])
        for tab in ["계기판", "대시보드"] {
            app.tabBars.buttons[tab].tap()
            let button = element(app, "workspace-button")
            XCTAssertTrue(button.waitForExistence(timeout: 10), "No Workspace button on \(tab)")
            button.tap()
            XCTAssertTrue(app.navigationBars["워크스페이스"].waitForExistence(timeout: 5), "Workspace did not open from \(tab)")
            shot(app, "workspace-from-\(tab)")
            element(app, "workspace-close").tap()
            XCTAssertTrue(app.navigationBars["워크스페이스"].waitForNonExistence(timeout: 5))
        }
    }

    func testReduceMotionKeepsTheObjectsStill() {
        var app = launch(["-screenTab", "dashboard"])
        edit(app)
        XCTAssertEqual(element(app, "cz-motion").label, "jiggle")
        app.terminate()
        app = launch(["-screenTab", "dashboard", "-czReduceMotion", "YES"])
        edit(app)
        XCTAssertEqual(element(app, "cz-motion").label, "still")
    }
}
