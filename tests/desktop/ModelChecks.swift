import Foundation
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
        print("Desktop model checks passed: nullable usage, freshness, accounts, safe capabilities, no offline actions.")
    }
}
