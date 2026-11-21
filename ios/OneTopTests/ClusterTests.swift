import XCTest
@testable import OneTop

/// The cluster on the Dashboard tab reads what the dashboard's cluster (cluster.js) reads: the token speed as the
/// period's average on a 100M or 200M scale; with nothing picked, the average burn of every account with one and each
/// account on the rim, with the hours left of the account that runs out first; an account picked reads that account;
/// every account's weekly limit left; the warning lights; the displays' cells; the odometer's wheels.
@MainActor final class ClusterTests: XCTestCase {
    func testDemoReadings() throws {
        let model = AppModel(restoring: false)
        model.showDemo(); model.period = .h1
        let now = DemoData.now(), r = ClusterReadings(model: model, now: now)
        // Token dial: the period's average per hour, on 100M while it stays at 90M or below, else 200M.
        XCTAssertEqual(try XCTUnwrap(r.tach.rate), try XCTUnwrap(model.averagePerHour), accuracy: 1e-6)
        XCTAssertEqual(r.tach.full, ClusterReadings.fullScale(r.tach.rate))
        XCTAssertTrue(r.tach.full == 200e6 || r.tach.full > 200e6 && r.tach.full.truncatingRemainder(dividingBy: 100e6) == 0)
        // Between readings the odometer runs on at the last minute's rate; the demo has quiet minutes, so the rate is
        // checked against that minute rather than held above zero.
        if let instant = r.tach.instant { XCTAssertEqual(r.tach.climb, instant / ClusterReadings.hour, accuracy: 1e-9) }
        else { XCTAssertEqual(r.tach.climb, 0) }
        XCTAssertGreaterThanOrEqual(r.tach.climb, 0)
        let hold = ClusterReadings.Hold(); hold.period = "1h"; hold.full = 500e6
        XCTAssertEqual(ClusterReadings(model: model, now: now, hold: hold).tach.full, 500e6)
        // The themes' flow: the hour in 24 slices from the same token bins, with tokens in it.
        XCTAssertEqual(r.flow.count, 24)
        XCTAssertGreaterThan(r.flow.reduce(0, +), 0)
        // Burn dial: every AI, the average of the accounts' burns, each account on the rim.
        let burning = r.accounts.filter { ClusterReadings.valid($0.burn) }
        XCTAssertFalse(burning.isEmpty)
        XCTAssertEqual(r.speed.subject, .all(count: burning.count))
        XCTAssertEqual(try XCTUnwrap(r.speed.value), burning.reduce(0) { $0 + $1.burn! } / Double(burning.count), accuracy: 1e-9)
        XCTAssertEqual(r.speed.multi.map(\.id), burning.map(\.id))
        XCTAssertFalse(r.speed.picked)
        XCTAssertGreaterThanOrEqual(r.speed.max, max(2, r.speed.value ?? 0, r.speed.multi.map(\.value).max() ?? 0))
        // Range: the account that runs out first, in hours at its own burn.
        let ends = burning.filter { $0.burn! > 0 && $0.left != nil }.map { $0.left! / $0.burn! }
        if let first = ends.min() { XCTAssertEqual(try XCTUnwrap(r.speed.reach.hours), first, accuracy: 1e-9) } else { XCTAssertEqual(r.speed.reach.state, .idle) }
        // An account picked reads that account; a signed-out one reads as needing a sign-in.
        let other = try XCTUnwrap(burning.first)
        let picked = ClusterReadings(model: model, now: now, pick: .account(other.id))
        XCTAssertEqual(picked.speed.account, other.id)
        XCTAssertTrue(picked.speed.picked)
        XCTAssertEqual(try XCTUnwrap(picked.speed.value), try XCTUnwrap(other.burn), accuracy: 1e-9)
        if let out = r.accounts.first(where: \.reconnect) {
            XCTAssertEqual(ClusterReadings(model: model, now: now, pick: .account(out.id)).speed.reach.state, .reconnect)
        }
        // A session picked reads its own burn against its account, in its tool's colour; its row is lit.
        let row = try XCTUnwrap(r.rows.first { ClusterReadings.valid($0.burn) })
        let chosen = ClusterReadings(model: model, now: now, pick: .session(row.id))
        XCTAssertEqual(chosen.speed.session, row.id)
        XCTAssertEqual(chosen.speed.kind, row.group.root.kind)
        XCTAssertTrue(chosen.speed.picked)
        XCTAssertEqual(try XCTUnwrap(chosen.speed.value), try XCTUnwrap(row.burn), accuracy: 1e-9)
        XCTAssertTrue(chosen.speed.multi.isEmpty)
        // A pick that is gone reads every AI again.
        XCTAssertFalse(ClusterReadings(model: model, now: now, pick: .session("gone")).speed.picked)
        // Rows: working first, then waiting, then the rest; a warning light leaves only its own.
        let steps = r.rows.map { $0.state == "working" ? 0 : $0.state == "waiting" ? 1 : 2 }
        XCTAssertEqual(steps, steps.sorted())
        XCTAssertEqual(r.rows.count, model.groups.count)
        let waiting = ClusterReadings(model: model, now: now, only: "waiting").rows
        XCTAssertEqual(waiting.map(\.id).sorted(), r.tells.waiting.sorted())
        XCTAssertTrue(waiting.allSatisfy { $0.state == "waiting" })
        // Fuel: every account with what is left of its weekly limit.
        XCTAssertEqual(r.accounts.map(\.id), model.quotas.map(\.id))
        for a in r.accounts { if let pct = a.pct { XCTAssertEqual(a.left, max(0, 100 - pct)) } }
        // Warning lights: working groups, accounts to sign in again, live readings.
        XCTAssertEqual(r.tells.reconnect, model.quotas.filter(\.needsReconnect).map(\.id))
        XCTAssertEqual(r.tells.working.count, model.groups.filter { g in g.members.contains { model.isWorking($0) } }.count)
        XCTAssertTrue(r.tells.fresh)
        // Trip: tokens since the start from the token bins, inside the record.
        let trip = try XCTUnwrap(ClusterReadings(model: model, now: now, trip: now - 3600).trip)
        XCTAssertTrue(trip.inRange)
        XCTAssertGreaterThan(try XCTUnwrap(trip.tokens), 0)
        XCTAssertFalse(try XCTUnwrap(ClusterReadings(model: model, now: now, trip: now - 3 * 86_400).trip).inRange)
    }

    func testScalesAndFigures() {
        for (max, major, minor) in [(2e8, 5e7, 1e7), (1e8, 2.5e7, 5e6), (5e7, 1e7, 2e6), (2.0, 0.5, 0.1)] {
            XCTAssertEqual(ClusterReadings.marks(max), .init(max: max, major: major, minor: minor))
        }
        // The token dial runs to 200M in every period and past it in 100M steps, each step a level of the limit break
        // up to the third (500M and on), as cluster.js does.
        for (rate, full, level) in [(nil, 2e8, 0), (1.5e8, 2e8, 0), (2e8, 2e8, 0), (2.3e8, 3e8, 1), (3.7e8, 4e8, 2), (4.7e8, 5e8, 3), (6.5e8, 7e8, 3)] as [(Double?, Double, Int)] {
            XCTAssertEqual(ClusterReadings.fullScale(rate), full)
            XCTAssertEqual(ClusterReadings.feverLevel(full), level)
        }
        // Past the limit the marks count in hundreds of millions, at most six steps to the full scale.
        XCTAssertEqual(ClusterReadings.tachMarks(2e8), ClusterReadings.marks(2e8))
        for (full, major) in [(3e8, 1e8), (5e8, 1e8), (6e8, 1e8), (7e8, 2e8), (1.2e9, 2e8)] {
            XCTAssertEqual(ClusterReadings.tachMarks(full), .init(max: full, major: major, minor: major / 5))
        }
        // The burn dial keeps 2, 5, 10, 20 and past 20%/h breaks its limit in steps of 20, a level at 40, 60, 80 and on.
        for (top, max, level) in [(0.5, 2.0, 0), (3, 5, 0), (15, 20, 0), (20, 20, 0), (25, 40, 1), (45, 60, 2), (61, 80, 3), (85, 100, 3)] as [(Double, Double, Int)] {
            XCTAssertEqual(ClusterReadings.burnScale(top), max, "\(top)%/h")
            XCTAssertEqual(ClusterReadings.burnLevel(max), level, "\(max)")
        }
        // Past the limit its marks count in tens, twenties, fifties …, at most six steps to the full scale.
        XCTAssertEqual(ClusterReadings.burnMarks(20), ClusterReadings.marks(20))
        for (max, major) in [(40.0, 10.0), (60, 10), (80, 20), (100, 20), (120, 20), (140, 50)] {
            XCTAssertEqual(ClusterReadings.burnMarks(max), .init(max: max, major: major, minor: major / 5))
        }
        XCTAssertEqual(ClusterReadings.reading(1.4253), "1.43")
        XCTAssertEqual(ClusterReadings.reading(108.2), "108")
        XCTAssertEqual(ClusterReadings.tokens(108_201_744), "108.20M")
        XCTAssertEqual(ClusterReadings.short(396_400_000), "396M")
        XCTAssertEqual(ClusterReadings.modelName("claude-opus-5-5"), "Opus 5.5")
        XCTAssertEqual(ClusterReadings.modelName("glm-5.3[1m]"), "glm-5.3")
        XCTAssertEqual(ClusterReadings.modelName("gpt-6.1-sol"), "GPT-6.1-sol")
        XCTAssertEqual(ClusterReadings.range(left: 39, burn: 1.4253, reset: 1e12, now: 0)?.state, .empty)
        XCTAssertEqual(ClusterReadings.range(left: 39, burn: 0, reset: nil, now: 0)?.state, .idle)
        XCTAssertNil(ClusterReadings.cruise(left: 39, reset: 10, now: 20))
        // The displays light only their digits: 108M, 0.53 with its point, -.-- unknown, hours.
        XCTAssertEqual(Display.digits(108_200_000), .init(cells: ["1", "0", "8"], unit: "M"))
        XCTAssertEqual(Display.digits(4_000_000), .init(cells: ["4"], unit: "M"))
        XCTAssertEqual(Display.burn(0.531), .init(cells: ["0", "5", "3"], dp: 0))
        XCTAssertEqual(Display.burn(12.44), .init(cells: ["1", "2", "4"], dp: 1))
        XCTAssertEqual(Display.burn(nil), .init(cells: ["-", "-", "-"], dp: 0))
        XCTAssertEqual(Display.hours(4.62), .init(cells: ["4", "6"], dp: 0))
        XCTAssertEqual(Display.hours(27.4), .init(cells: ["2", "7"]))
    }

    func testFuelPicksEveryProviderFirst() {
        func account(_ id: String, _ kind: String, tag: String? = nil) -> ClusterReadings.Account {
            .init(id: id, kind: kind, tag: tag, current: true, reconnect: false)
        }
        let list = [account("c1", "Claude"), account("c2", "Claude"), account("x1", "Codex"), account("x2", "Codex"),
                    account("a1", "Antigravity", tag: "Gemini Models"), account("g1", "GLM", tag: "Claude and GPT")]
        // Four fit: each provider once before a second, in the accounts' own order.
        XCTAssertEqual(ClusterReadings.pick(list, 4).map(\.id), ["c1", "x1", "a1", "g1"])
        XCTAssertEqual(ClusterReadings.pick(list, 5).map(\.id), ["c1", "c2", "x1", "a1", "g1"])
        XCTAssertEqual(ClusterReadings.pick(list, 8).map(\.id), list.map(\.id))
        // A gauge names the plan short, as the web does.
        XCTAssertEqual(list[4].shortTag, "Gemini")
        XCTAssertEqual(list[5].shortTag, "Claude·GPT")
        // Under the gauge the plan is one short word, so a name is never cut short.
        var max = list[0]; max.plan = "max"; XCTAssertEqual(max.brief, "Max")
        var biz = list[2]; biz.plan = "Business"; XCTAssertEqual(biz.brief, "Biz")
        XCTAssertEqual(account("a3", "Antigravity", tag: "Gemini 4 Argon").brief, "Argon")
        XCTAssertEqual(list[5].brief, "Claude·GPT")
        XCTAssertEqual(account("g2", "GLM").brief, "")
    }

    func testRangeWheelsTurnEitherWay() {
        let wheels = RangeWheels()
        // The first hours are set at once: a wheel per digit, the point between them below 10.
        XCTAssertFalse(wheels.take(27.4))
        XCTAssertEqual(wheels.shape, "00"); XCTAssertEqual(wheels.positions, [2, 7])
        // Fewer hours turn the wheels down, more turn them up; the same hours leave them.
        XCTAssertTrue(wheels.take(23)); XCTAssertEqual(wheels.positions, [2, 3])
        XCTAssertTrue(wheels.take(45)); XCTAssertEqual(wheels.positions, [4, 5])
        XCTAssertFalse(wheels.take(45.2))
        // A new shape is set anew: 4.6 on two wheels with the point, 140 on three, 999 at most.
        XCTAssertFalse(wheels.take(4.62)); XCTAssertEqual(wheels.shape, "0.0"); XCTAssertEqual(wheels.positions, [4, 6])
        XCTAssertFalse(wheels.take(140)); XCTAssertEqual(wheels.shape, "000"); XCTAssertEqual(wheels.positions, [1, 4, 0])
        XCTAssertTrue(wheels.take(5_000)); XCTAssertEqual(wheels.positions, [9, 9, 9])
        // Without a reading two dashes, which the wheels of a two-digit range turn on to past their 9.
        XCTAssertFalse(wheels.take(nil)); XCTAssertEqual(wheels.shape, "00"); XCTAssertEqual(wheels.positions, [RangeWheels.dash, RangeWheels.dash])
        XCTAssertTrue(wheels.take(31)); XCTAssertEqual(wheels.positions, [3, 1])
    }

    func testClusterSpeaksEnglishAndChinese() {
        let saved = L.language
        defer { L.language = saved }
        // The user's glossary: the lights, the range with its unit, the burn name and the window's pages.
        L.language = .en
        XCTAssertEqual(["Waiting", "Done", "Sign in", "Low limit"].map { L.t($0, "") }, ["Waiting", "Done", "Sign in", "Low limit"])
        XCTAssertEqual(ClusterWindow.modes.map(\.name), ["Sessions", "Token flow", "Limits", "Usage map", "Heatmap", "Goals", "Resources"])
        XCTAssertEqual(L.t("since 09:00", "09:00부터"), "since 09:00")
        L.language = .zh
        XCTAssertEqual(ClusterWindow.modes.map(\.name), ["会话", "Token 趋势", "额度", "用量分布", "热力图", "目标", "资源"])
        XCTAssertEqual(L.t("Waiting", "응답 대기"), "等待回复")
        XCTAssertEqual(L.t("Done", "완료됨"), "已完成")
        XCTAssertEqual(L.t("Sign in", "재로그인"), "重新登录")
        XCTAssertEqual(L.t("Low limit", "한도 부족"), "额度不足")
        XCTAssertEqual(L.t("Limit burn", "한도 소진") + L.t("· All AI", "· 전체 AI"), "额度消耗· 全部 AI")
        XCTAssertEqual(L.t("Time left", "작업 가능"), "可用时长")
        XCTAssertEqual(L.t("h", "시간"), "小时")
        XCTAssertEqual(L.t("Trip", "트립"), "小计")
        XCTAssertEqual(L.t("By AI", "AI별"), "按 AI")
        // Texts around a figure or the period keep the figure and read the rest in Chinese.
        XCTAssertEqual(L.t("since 09:00", "09:00부터"), "09:00起")
        XCTAssertEqual(L.t("Time left 27 h", "작업 가능 27시간"), "可用时长 27 小时")
        XCTAssertEqual(L.t("Limit burn 0.51%/h", "한도 소진 0.51%/시간"), "额度消耗 0.51%/小时")
        let caption = L.t("Last \(Period.h1.label)", "최근 \(Period.h1.label)")
        XCTAssertEqual(caption, "最近1小时")
        XCTAssertEqual(L.t("Total · \(caption)", "합계 · \(caption)"), "合计 · 最近1小时")
    }

    func testOdometerTurnsUpOnly() {
        let wheels = OdometerWheels()
        // The first count shows at once, a place per digit, units first.
        XCTAssertTrue(wheels.take(1_289, period: "1h", now: 0))
        XCTAssertEqual(wheels.turns, [9, 8, 2, 1])
        // Within three seconds the wheels stay; after that they move.
        XCTAssertFalse(wheels.take(1_300, period: "1h", now: 2))
        XCTAssertTrue(wheels.take(1_300, period: "1h", now: 3))
        // 9 turns on to 0 (a full turn later), never back: 1,289 → 1,300.
        XCTAssertEqual(wheels.turns, [10, 10, 3, 1])
        XCTAssertEqual(wheels.shown, 1_300)
        // While the period stays the count never goes back.
        XCTAssertFalse(wheels.take(1_200, period: "1h", now: 6))
        XCTAssertEqual(wheels.shown, 1_300)
        // A new place joins without a leading zero.
        XCTAssertTrue(wheels.take(10_004, period: "1h", now: 9))
        XCTAssertEqual(wheels.turns, [14, 10, 10, 10, 1])
        // Another period counts afresh, still turning up: 10,004 → 512.
        XCTAssertTrue(wheels.take(512, period: "24h", now: 10))
        XCTAssertEqual(wheels.shown, 512)
        XCTAssertEqual(wheels.turns, [22, 11, 15])
    }
}
