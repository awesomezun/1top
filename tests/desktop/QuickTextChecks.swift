import Foundation

// The menu bar app speaks the dashboard's language: Korean source text, the dashboard's translations,
// and the labels the model builds around values.
@main struct QuickTextChecks {
    /// Korean that stays Korean in every language: the language button's own name for Korean, and the count units the
    /// sheets join to a number (6개, 4칸, 9줄), which translate as a whole.
    static let keptKorean: Set<String> = ["한", "한국어", "개", "칸", "줄"]
    /// Every string literal with Hangul in a Swift source, outside comments and inside interpolations too, and whether
    /// it opens a pick(ko, en, zh) or names a unit(…), which carry their own English and Chinese.
    static func koreanLiterals(_ s: String) -> [(String, Bool)] {
        let c = Array(s)
        var out: [(String, Bool)] = [], i = 0
        let hangul = { (t: String) in t.unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) } }
        // A literal from just past its opening quote; an interpolation is read as code, its own literals included.
        func literal(_ raw: Bool) -> String {
            var text = ""
            while i < c.count {
                if raw {
                    if c[i] == "\"" && i + 1 < c.count && c[i + 1] == "#" { i += 2; return text }
                } else if c[i] == "\\" && i + 1 < c.count && c[i + 1] == "(" {
                    i += 2; code(closing: true); text += "\\()"; continue
                } else if c[i] == "\\" {
                    text.append(c[i]); if i + 1 < c.count { text.append(c[i + 1]) }; i += 2; continue
                } else if c[i] == "\"" { i += 1; return text }
                text.append(c[i]); i += 1
            }
            return text
        }
        // Code up to the parenthesis that closes an interpolation (or the end).
        func code(closing: Bool) {
            var depth = 0
            while i < c.count {
                let ch = c[i]
                if ch == "/" && i + 1 < c.count && c[i + 1] == "/" { while i < c.count && c[i] != "\n" { i += 1 }; continue }
                if ch == "\"" || (ch == "#" && i + 1 < c.count && c[i + 1] == "\"") {
                    let raw = ch == "#", start = i
                    i += raw ? 2 : 1
                    let text = literal(raw)
                    if hangul(text) {
                        let before = String(c[max(0, start - 12)..<start]).replacingOccurrences(of: " ", with: "")
                        out.append((text, before.hasSuffix("pick(") || before.hasSuffix("unit(")))
                    }
                    continue
                }
                if closing && ch == "(" { depth += 1 }
                if closing && ch == ")" { if depth == 0 { i += 1; return }; depth -= 1 }
                i += 1
            }
        }
        code(closing: false)
        return out
    }
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
        // Limits from providers with 5-hour or monthly windows (Agy, GLM).
        precondition(en("계정 한도") == "Account limits" && zh("MCP · 월간") == "MCP · 月度" && en("값 없음") == "No value" && zh("조회 중단") == "已停止查询")
        // The cluster view reads the dashboard's cluster words.
        precondition(en("계기판 보기") == "Cluster view" && zh("기본 보기") == "标准视图" && en("소진 속도") == "Burn rate")
        precondition(en("%/시간 · 주간 한도 기준") == "%/h of the weekly limit" && en("최근 10분") == "Last 10m" && zh("남은 주간 한도") == "剩余每周额度")
        // No visible Korean is left in English or Chinese anywhere in the panel (both presets, the cluster, the edit mode,
        // its sheets): every Korean string in its sources translates, or carries its own English and Chinese in pick().
        let hangul = { (s: String) in s.unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) } }
        var untranslated: [String] = [], seen: Set<String> = []
        for file in ["desktop/QuickDashboard.swift", "desktop/ClusterPanel.swift", "desktop/Customize.swift"] {
            // Run from the repository root, as CI runs it.
            guard let source = try? String(contentsOfFile: file, encoding: .utf8) else { fatalError("read \(file) from the repository root") }
            for (text, _) in koreanLiterals(source) { seen.insert(text) }
            for (text, picked) in koreanLiterals(source) where !picked && !keptKorean.contains(text) {
                if text.contains("\\(") || hangul(en(text)) || hangul(zh(text)) { untranslated.append("\(file): \(text)") }
            }
        }
        precondition(untranslated.isEmpty, "untranslated:\n" + untranslated.joined(separator: "\n"))
        // The scan reaches literals inside interpolations and the customizing words.
        precondition(seen.count > 150 && seen.contains("숨긴 부품") && seen.contains("O4 인쇄 0 채움") && seen.contains("작업 가능"), "scanned \(seen.count) Korean texts")
        // The glossary's own wording, a count of each kind, and the words the web and Android name the same.
        for (k, e, z) in [("커스터마이징", "Customize", "自定义"), ("기본값으로 되돌리기", "Reset to defaults", "恢复默认"), ("합계·트립", "Total · Trip", "合计·小计"),
                          ("남은 한도", "Limit left", "剩余额度"), ("O2 LED 0 채움", "O2 LED, zero-padded", "O2 LED 补零"), ("4칸", "4 slots", "4 格"),
                          ("6개", "6", "6 个"), ("9줄", "9 rows", "9 行"), ("자동", "Auto", "自动"), ("완료", "Done", "完成"), ("트립", "Trip", "小计"),
                          ("방금 완료", "Just done", "刚完成"), ("내역 없는 컴퓨터", "Computers without a split", "无明细的电脑"), ("모델 정보 없음", "No model info", "无模型信息")] {
            precondition(en(k) == e && zh(k) == z, "\(k): \(en(k)) / \(zh(k))")
        }
        // Names never pass through a translation.
        precondition(en("checkout-web") == "checkout-web" && en("Orca · Gateway") == "Orca · Gateway")
        print("Quick text checks passed: three languages, model labels, formatted values, names left as they are.")
    }
}
