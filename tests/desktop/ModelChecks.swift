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
        precondition(!DesktopUsageTrend(events:nil,period:"1h",end:599).reported)
        for period in ["10m","30m","1h","5h","12h","24h"] {
            let chart=DesktopUsageTrend(events:events,period:period,end:599)
            precondition(chart.bins.count <= 36 && chart.bins.last?.end == 600)
        }
        print("Desktop model checks passed: nullable usage, freshness, accounts, safe capabilities, no offline actions.")
    }
}
