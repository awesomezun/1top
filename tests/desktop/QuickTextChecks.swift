import Foundation

// The menu bar app speaks the dashboard's language: Korean source text, the dashboard's translations,
// and the labels the model builds around values.
@main struct QuickTextChecks {
    static func main() {
        let ko = QuickText("ko"), en = QuickText("en"), zh = QuickText("zh")
        precondition(QuickText("fr").lang == "ko" && QuickText(nil).lang == "ko")
        precondition(ko("간략 대시보드") == "간략 대시보드" && en("간략 대시보드") == "Quick view" && zh("간략 대시보드") == "简略仪表盘")
        precondition(en("1top — 이 Mac") == "1top — This Mac" && zh("1top — 이 Mac") == "1top — 这台 Mac")
        precondition(en("실시간 · 이 Mac") == "Live · This Mac")
        // Labels the model builds.
        precondition(en("38분 전 보고") == "Reported 38m ago" && zh("3시간 전 보고") == "3小时前报告" && ko("2일 전 보고") == "2일 전 보고")
        precondition(en("작업 중 · 하위 2개 작업 중") == "Working · 2 subsessions working")
        precondition(zh("확인 필요 · 하위 1개 작업 중") == "需要确认 · 1 个子会话工作中")
        precondition(en("기타 3개 세션") == "3 other sessions")
        precondition(en("환산 추정 · 초기") == "Converted estimate · early")
        precondition(en("선택 기간 1.20M tokens × (1% ÷ 2.00M tokens)\n기준 30분 관측 · 현재 계정 기준 환산")
                     == "Selected period 1.20M tokens × (1% ÷ 2.00M tokens)\nBased on 30 min observed · converted for the current account")
        precondition(en("1시간 30분") == "1h 30m" && zh("1시간 30분") == "1小时30分钟")
        // Values the panel formats itself.
        precondition(en.last("5시간") == "Last 5h" && ko.last("5시간") == "최근 5시간" && zh.last("10분") == "最近 10分钟")
        precondition(en.resetsIn(days: 3, hours: 2, minutes: 0) == "Resets in 3d 2h" && ko.resetsIn(days: 0, hours: 0, minutes: 12) == "12분 후 초기화")
        precondition(zh.resetsIn(days: 0, hours: 4, minutes: 5) == "4小时5分钟后重置")
        precondition(en.working(4) == "Working 4" && zh.children(2) == "子会话 2" && en.count(3) == "3 more" && ko.perHour == "/시간")
        // The cluster view reads the dashboard's cluster words.
        precondition(en("계기판 보기") == "Cluster view" && zh("기본 보기") == "标准视图" && en("소진 속도") == "Burn rate")
        precondition(en("%/시간 · 주간 한도 기준") == "%/h of the weekly limit" && en("최근 10분") == "Last 10m" && zh("남은 주간 한도") == "剩余每周额度")
        // Names never pass through a translation.
        precondition(en("checkout-web") == "checkout-web" && en("Orca · Gateway") == "Orca · Gateway")
        print("Quick text checks passed: three languages, model labels, formatted values, names left as they are.")
    }
}
