import Foundation
import CoreGraphics
@main struct ModelChecks {
    static func main() throws {
        let data = """
        {"ready":true,"updated":100,"sessions":[{"id":"unknown","kind":"Codex","tokens":null,"usage":{"rate":null,"windows":{"1h":null}}},{"id":"known","kind":"Aside","status":"working","tokens":[10,20,0,5],"control_key":"key","location":{"app":"Aside","app_path":"/Applications/Aside.app"},"usage":{"rate":3,"windows":{"1h":[1,2,0,1]}}}],"period_usage":{"known_kinds":["Aside"],"windows":[{"key":"1h","label":"1h","tokens":[1,2,0,1],"partial":true,"observed_seconds":100}]}}
        """.data(using:.utf8)!
        let snapshot = try JSONDecoder().decode(DesktopSnapshot.self, from:data)
        precondition(snapshot.isFresh(at:Date(timeIntervalSince1970:110)))
        precondition(!snapshot.isFresh(at:Date(timeIntervalSince1970:121)))
        let model = DashboardModel(baseURL:URL(string:"http://127.0.0.1:18899")!)
        model.snapshot=snapshot; model.now=Date(timeIntervalSince1970:110); model.connected=true
        precondition(model.fresh && model.working==1 && model.knownCount==1)
        precondition(model.rate==3 && model.periodTokens==4 && model.sortedSessions.first?.id=="known")
        let aside = model.sessions[1]
        precondition(aside.allows("pause") && aside.allows("focus") && !aside.allows("terminate") && !aside.allows("resume"))
        model.connected=false;precondition(!model.fresh)
        model.perform("pause",session:aside);precondition(model.messageIsError && !model.busy)
        precondition(DesktopFormat.number(nil)=="—" && DesktopFormat.number(0)=="0")
        let map = DesktopUsageMap(sessions:model.sessions, period:"1h")
        precondition(map.total == 4 && map.reported == 1 && map.unknown == 1 && map.zero == 0)
        precondition(DesktopUsageMap(sessions:model.sessions, period:"10m").unknown == 2)
        var samples: [DesktopSession] = []
        for i in 0..<12 {
            var row = aside; row.id = "row-\(i)"
            row.usage = DesktopSession.Usage(rate:0,windows:["1h":[Double(i),0,0,0]])
            samples.append(row)
        }
        let grouped = DesktopUsageMap(sessions:samples,period:"1h")
        precondition(grouped.tiles.count == 8 && grouped.total == 66 && grouped.zero == 1)
        precondition(grouped.tiles.reduce(0) { $0 + $1.value } == 66)
        let placed = grouped.layout(in:CGRect(x:0,y:0,width:410,height:100))
        precondition(abs(placed.reduce(0) { $0 + $1.rect.width * $1.rect.height } - 41000) < 0.001)
        for tile in placed {
            precondition(abs(tile.rect.width * tile.rect.height / 41000 - tile.tile.value / 66) < 0.000001)
        }
        precondition(grouped.layout(in:.zero).isEmpty)
        let eventData = """
        {"ready":true,"events":[{"t":-120,"n":99},{"t":0,"fresh":2,"cached":3,"written":1,"output":4},{"t":540,"n":8},{"t":600,"n":99},{"t":120,"n":-7}]}
        """.data(using:.utf8)!
        let events = try JSONDecoder().decode(DesktopSnapshot.self, from:eventData).events
        let trend = DesktopUsageTrend(events:events,period:"10m",end:599)
        precondition(trend.reported && trend.bins.count == 10)
        precondition(trend.bins.first?.tokens == 10 && trend.bins.last?.tokens == 8)
        precondition(trend.bins.reduce(0) { $0 + $1.tokens } == 18)
        precondition(trend.bins.first?.tokensByKind["unknown"] == 10)
        let colouredEvents = try JSONDecoder().decode(DesktopSnapshot.self, from:
            """
            {"ready":true,"events":[{"t":100,"n":30,"kind":"Claude"},{"t":110,"n":70,"kind":"Codex"},{"t":120,"n":5}]}
            """.data(using:.utf8)!).events
        let colouredTrend = DesktopUsageTrend(events:colouredEvents,period:"10m",end:599)
        precondition(colouredTrend.bins[1].tokens == 100)
        precondition(colouredTrend.bins[1].tokensByKind == ["Claude":30,"Codex":70])
        precondition(colouredTrend.bins[2].tokensByKind == ["unknown":5])
        precondition(!DesktopUsageTrend(events:nil,period:"1h",end:599).reported)
        for period in ["10m","30m","1h","5h","12h","24h"] {
            let chart=DesktopUsageTrend(events:events,period:period,end:599)
            precondition(chart.bins.count <= 36 && chart.bins.last?.end == 600)
        }
        let quotaData = """
        {"ready":true,"weekly_usage":{"accounts":[{"id":"a","periods":{"1h":{"used_pp":3,"partial":true,"observed_seconds":120}}}]},"sessions":[{"id":"s","kind":"Codex","usage":{"weekly_estimate":{"1h":{"used_pp":0.75,"account_id":"a","partial":true}}}}]}
        """.data(using:.utf8)!
        let quotaSnapshot = try JSONDecoder().decode(DesktopSnapshot.self, from:quotaData)
        precondition(quotaSnapshot.weekly_usage?.accounts[0].periods["1h"]?.used_pp == 3)
        precondition(quotaSnapshot.sessions?[0].usage?.weekly_estimate?["1h"]?.used_pp == 0.75)
        precondition(DesktopFormat.quota(nil) == "—" && DesktopFormat.quota(0) == "0%")
        precondition(DesktopFormat.quota(0.001) == "<0.01%" && DesktopFormat.quota(0.75) == "0.75%")
        let estimateData = """
        {"used_pp":3.3333,"account_id":"a","partial":false,"basis":"calibrated_token_equivalent","tokens":10000000,"calibration":{"tokens":3000000,"used_pp":1,"seconds":240,"confidence":"early"}}
        """.data(using:.utf8)!
        let estimate = try JSONDecoder().decode(WeeklyEstimate.self, from:estimateData)
        precondition(estimate.scopeLabel == "환산 추정 · 초기")
        precondition(estimate.calculationLabel.contains("10.00M tokens"))
        precondition(estimate.calculationLabel.contains("4분 관측"))

        // Ten percentage points observed over 30 minutes means 20 pp/hour,
        // even if the user selected a partially recorded 5-hour period.
        let partialPeriod = WeeklyUsage.Period(used_pp:10, partial:true, observed_seconds:1800)
        precondition(partialPeriod.burnPerHour == 20)
        precondition(WeeklyUsage.Period(used_pp:10, partial:false, observed_seconds:18000).burnPerHour == 2)
        precondition(WeeklyUsage.Period(used_pp:0, partial:true, observed_seconds:120).burnPerHour == 0)
        for seconds in [0.0, 119.9, -1, Double.nan, Double.infinity] {
            precondition(WeeklyUsage.Period(used_pp:1, partial:true, observed_seconds:seconds).burnPerHour == nil)
        }
        for delta: Double? in [nil, -1, .nan, .infinity, .greatestFiniteMagnitude] {
            precondition(WeeklyUsage.Period(used_pp:delta, partial:true, observed_seconds:120).burnPerHour == nil)
        }

        // 1 pp / 3M tokens at 1,000 tokens/s converts to 1.2 pp/hour.
        precondition(abs(estimate.burnPerHour(tokensPerSecond:1000)! - 1.2) < 0.000001)
        precondition(estimate.burnPerHour(tokensPerSecond:0) == 0)
        for rate: Double? in [nil, -1, .nan, .infinity] {
            precondition(estimate.burnPerHour(tokensPerSecond:rate) == nil)
        }
        var invalidEstimate = estimate
        invalidEstimate.calibration = nil
        precondition(invalidEstimate.burnPerHour(tokensPerSecond:0) == nil)
        invalidEstimate = estimate; invalidEstimate.basis = nil
        precondition(invalidEstimate.burnPerHour(tokensPerSecond:1000) == nil)
        for denominator in [0.0, -1, Double.nan, Double.infinity] {
            invalidEstimate = estimate; invalidEstimate.calibration?.tokens = denominator
            precondition(invalidEstimate.burnPerHour(tokensPerSecond:1000) == nil)
        }
        for delta in [0.0, -1, Double.nan, Double.infinity] {
            invalidEstimate = estimate; invalidEstimate.calibration?.used_pp = delta
            precondition(invalidEstimate.burnPerHour(tokensPerSecond:1000) == nil)
        }
        for seconds in [119.9, Double.nan, Double.infinity] {
            invalidEstimate = estimate; invalidEstimate.calibration?.seconds = seconds
            precondition(invalidEstimate.burnPerHour(tokensPerSecond:1000) == nil)
        }
        invalidEstimate = estimate; invalidEstimate.calibration?.tokens = 1
        precondition(invalidEstimate.burnPerHour(tokensPerSecond:.greatestFiniteMagnitude) == nil)
        var ratedUsage = DesktopSession.Usage(rate:1000, weekly_estimate:["5h":estimate], weekly_account:"a")
        precondition(abs(ratedUsage.weeklyBurnPerHour(period:"5h")! - 1.2) < 0.000001)
        precondition(ratedUsage.weeklyBurnPerHour(period:"24h") == nil)
        ratedUsage.weekly_account = "b"
        precondition(ratedUsage.weeklyBurnPerHour(period:"5h") == nil)
        ratedUsage.weekly_account = nil
        precondition(ratedUsage.weeklyBurnPerHour(period:"5h") == nil)

        precondition(DesktopFormat.burnRate(1.25) == "1.25%p/시간")
        precondition(DesktopFormat.burnRate(0) == "0%p/시간")
        precondition(DesktopFormat.burnRate(0.001) == "<0.01%p/시간")
        precondition(DesktopFormat.burnRate(nil) == "—" && DesktopFormat.burnRate(.nan) == "—")
        precondition(DesktopFormat.duration(59) == "1분 미만")
        precondition(DesktopFormat.duration(1740) == "29분")
        precondition(DesktopFormat.duration(3600) == "1시간")
        precondition(DesktopFormat.duration(3660) == "1시간 1분")
        precondition(DesktopFormat.duration(nil) == "—" && DesktopFormat.duration(.infinity) == "—")
        let historyData = """
        {"accounts":[{"id":"a","periods":{},"history":[[180,20],[300,22],[420,22],[540,23]]},{"id":"b","periods":{},"history":[[300,10],[420,15]]},{"id":"old","periods":{}}]}
        """.data(using:.utf8)!
        let histories = try JSONDecoder().decode(WeeklyUsage.self, from:historyData)
        precondition(histories.accounts[2].history == nil)
        let weeklyTrend = DesktopWeeklyUsageTrend(history:histories.accounts[0].history, period:"10m", end:600)
        precondition(weeklyTrend.reported && weeklyTrend.total == 3 && weeklyTrend.observedSeconds == 360)
        precondition(weeklyTrend.bins.filter { $0.usedPP == nil }.count == 7)
        precondition(weeklyTrend.bins.contains { $0.usedPP == 0 })
        precondition(weeklyTrend.observedFrom == 180 && weeklyTrend.observedTo == 540)
        let otherAccount = DesktopWeeklyUsageTrend(history:histories.accounts[1].history, period:"10m", end:600)
        precondition(otherAccount.total == 5 && weeklyTrend.total == 3) // no account sum
        precondition(!DesktopWeeklyUsageTrend(history:nil, period:"10m", end:600).reported)
        precondition(!DesktopWeeklyUsageTrend(history:[[300,10]], period:"10m", end:600).reported)
        let resetTrend = DesktopWeeklyUsageTrend(history:[[180,98],[300,1],[420,2]], period:"10m", end:600)
        precondition(resetTrend.total == 1 && resetTrend.observedSeconds == 120)
        let gapTrend = DesktopWeeklyUsageTrend(history:[[10,1],[400,8],[520,9]], period:"10m", end:600)
        precondition(gapTrend.total == 1 && gapTrend.observedSeconds == 120)
        let boundaryTrend = DesktopWeeklyUsageTrend(history:[[-100,1],[100,8],[220,9],[700,10]], period:"10m", end:600)
        precondition(boundaryTrend.total == 1 && boundaryTrend.observedSeconds == 120)
        let invalidTrend = DesktopWeeklyUsageTrend(history:[[100,1],[200,.nan],[300,3],[400,5]], period:"10m", end:600)
        precondition(invalidTrend.total == 2 && invalidTrend.observedSeconds == 100)
        let shortTrend = DesktopWeeklyUsageTrend(history:[[550,20],[580,20]], period:"10m", end:600)
        precondition(shortTrend.reported && shortTrend.total == 0 && shortTrend.observedSeconds == 30)
        let fullFlow = (0..<240).map { i in [Double(i * 120),Double((i + 1) * 120),0.1] }
        let thinnedHistory = (0...80).map { i in [Double(i * 360),10 + Double(i) * 0.3] }
        let fullTrend = DesktopWeeklyUsageTrend(history:thinnedHistory,flow:fullFlow,period:"24h",end:28800)
        precondition(abs(fullTrend.total - 24) < 0.000001 && fullTrend.observedSeconds == 28800)
        precondition(!DesktopWeeklyUsageTrend(history:thinnedHistory,period:"24h",end:28800).reported)
        precondition(!DesktopWeeklyUsageTrend(history:[[0,1],[120,2]],flow:[],period:"10m",end:600).reported)
        let flowBoundary = DesktopWeeklyUsageTrend(history:nil,flow:[[-10,110,3],[110,230,0],[230,600,4],[230,350,1]],period:"10m",end:600)
        precondition(flowBoundary.total == 1 && flowBoundary.observedSeconds == 240)
        print("Desktop model checks passed: nullable usage, freshness, accounts, observed and estimated burn rates, safe capabilities, no offline actions.")
    }
}
