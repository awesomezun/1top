import Foundation

/// The words of the menu bar app in the dashboard's language (한·EN·中). Korean is the source text and the
/// translations are the dashboard's own (agent/onetop/dist/i18n.js), so the quick view, the menus and the
/// dashboard window read alike. Project, terminal and account names never pass through here.
struct QuickText {
    static let languages = ["ko", "en", "zh"]
    let lang: String
    init(_ lang: String?) { self.lang = Self.languages.contains(lang ?? "") ? lang! : "ko" }
    /// The language last chosen in the dashboard or the quick view.
    static var current: QuickText { QuickText(UserDefaults.standard.string(forKey: "dashboardLanguage")) }

    func callAsFunction(_ ko: String) -> String {
        guard lang != "ko" else { return ko }
        if let row = Self.table[ko] { return lang == "en" ? row.0 : row.1 }
        return patterns(ko)
    }
    func pick(_ ko: String, _ en: String, _ zh: String) -> String { lang == "en" ? en : lang == "zh" ? zh : ko }
    func unit(_ korean: String) -> String {
        switch korean {
        case "분": return pick("분", "m", "分钟")
        case "시간": return pick("시간", "h", "小时")
        case "일": return pick("일", "d", "天")
        default: return pick("초", "s", "秒")
        }
    }
    var perHour: String { pick("/시간", "/h", "/小时") }
    /// "최근 1시간" for a period title like "1시간".
    func last(_ title: String) -> String { lang == "ko" ? "최근 " + title : pick("", "Last ", "最近 ") + self(title) }
    func count(_ n: Int) -> String { pick("\(n)개", "\(n) more", "\(n) 个") }
    func working(_ n: Int) -> String { pick("작업 중 \(n)", "Working \(n)", "工作中 \(n)") }
    func children(_ n: Int) -> String { pick("하위 \(n)", "Subsessions \(n)", "子会话 \(n)") }
    func zoom(_ percent: Int) -> String { pick("화면 크기 \(percent)%", "Size \(percent)%", "显示大小 \(percent)%") }
    func resetsIn(days: Int, hours: Int, minutes: Int) -> String {
        let span = days > 0 ? pick("\(days)일 \(hours)시간", "\(days)d \(hours)h", "\(days)天\(hours)小时")
            : hours > 0 ? pick("\(hours)시간 \(minutes)분", "\(hours)h \(minutes)m", "\(hours)小时\(minutes)分钟")
            : pick("\(minutes)분", "\(minutes)m", "\(minutes)分钟")
        return pick(span + " 후 초기화", "Resets in " + span, span + "后重置")
    }

    // Labels the model builds around values: "38분 전 보고", "작업 중 · 하위 2개 작업 중", "5시간" and the
    // conversion's explanation. Anything else without a translation stays as it is.
    private func patterns(_ text: String) -> String {
        if text.contains("\n") { return text.components(separatedBy: "\n").map { self($0) }.joined(separator: "\n") }
        if let m = match(#"^(\d+)(분|시간|일) 전 보고$"#, text) {
            return pick(text, "Reported \(m[1])\(unit(m[2])) ago", "\(m[1])\(unit(m[2]))前报告")
        }
        if let m = match(#"^(.+) · 하위 (\d+)개 작업 중$"#, text) {
            return self(m[1]) + pick("", " · \(m[2]) subsessions working", " · \(m[2]) 个子会话工作中")
        }
        if let m = match(#"^기타 (\d+)개 세션$"#, text) { return pick(text, "\(m[1]) other sessions", "其他 \(m[1]) 个会话") }
        if let m = match(#"^선택 기간 (.+)$"#, text) { return pick(text, "Selected period ", "所选时段 ") + m[1] }
        if let m = match(#"^기준 (\d+)분 관측 · 현재 계정 기준 환산$"#, text) {
            return pick(text, "Based on \(m[1]) min observed · converted for the current account", "基于 \(m[1]) 分钟观察 · 按当前账户换算")
        }
        if let m = match(#"^최근 (\d+)(분|시간|일)$"#, text) { return pick("", "Last ", "最近 ") + m[1] + unit(m[2]) }
        if let m = match(#"^(\d+)(분|시간|일)$"#, text) { return m[1] + unit(m[2]) }
        if let m = match(#"^(\d+)시간 (\d+)분$"#, text) { return m[1] + unit("시간") + (lang == "zh" ? "" : " ") + m[2] + unit("분") }
        if text.contains(" · ") {
            let parts = text.components(separatedBy: " · ")
            if parts.allSatisfy({ Self.table[$0] != nil }) { return parts.map { self($0) }.joined(separator: " · ") }
            if parts.first == "이전 제공자 관측 기준" { return ([self(parts[0])] + parts.dropFirst()).joined(separator: " · ") }
        }
        return text
    }
    private func match(_ pattern: String, _ text: String) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let m = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (0..<m.numberOfRanges).map { Range(m.range(at: $0), in: text).map { String(text[$0]) } ?? "" }
    }

    static let table: [String: (String, String)] = [
        // The cluster (계기판) view, in the dashboard's words.
        "계기판": ("Cluster", "组合仪表"),
        "계기판 보기": ("Cluster view", "仪表视图"),
        "기본 보기": ("Standard view", "标准视图"),
        "경고등": ("Warning lights", "警示灯"),
        "한도 바닥 예상": ("Limit runs out early", "额度将提前用完"),
        "컨텍스트 거의 참": ("Context nearly full", "上下文将满"),
        "멈춤 의심": ("Possibly stalled", "疑似停滞"),
        "실시간": ("Live", "实时"),
        "수집 지연": ("Collection delayed", "采集延迟"),
        "소진 속도": ("Burn rate", "消耗速度"),
        "토큰 속도": ("Token speed", "Token 速度"),
        "%/시간 · 주간 한도 기준": ("%/h of the weekly limit", "%/小时 · 按每周额度"),
        "적정": ("Cruise", "适宜"),
        "가장 빠름": ("Fastest", "最快"),
        "계정 소진 속도 측정 중": ("Measuring account burn", "正在测量账户消耗速度"),
        "작업 트립": ("Work trip", "工作行程"),
        "리셋": ("Reset", "重置"),
        "작업 트립 리셋": ("Reset the work trip", "重置工作行程"),
        "기록 범위 밖": ("Outside the record", "超出记录范围"),
        "남은 주간 한도": ("Weekly limit left", "剩余每周额度"),
        "연결된 구독 계정이 없습니다.": ("No subscription accounts connected.", "没有已连接的订阅账户。"),
        "남음": ("remaining", "剩余"),
        "평균": ("Average", "平均"),
        "확인 중": ("Checking", "确认中"),
        "tokens/시간": ("tokens/h", "tokens/小时"),
        "토큰 사용 속도 확인 중": ("Checking the token usage rate", "正在确认 Token 消耗速度"),
        "알림 닫기": ("Close notice", "关闭通知"),
        "브라우저에서 열기": ("Open in browser", "在浏览器中打开"),
        "지금 새로고침": ("Refresh now", "立即刷新"),
        "세션을 주간 한도 %로 보기": ("Show sessions as weekly limit %", "以每周额度 % 显示会话"),
        "세션을 토큰으로 보기": ("Show sessions as tokens", "以 token 显示会话"),
        "확대": ("Zoom in", "放大"),
        "축소": ("Zoom out", "缩小"),
        "기본 크기": ("Actual size", "默认大小"),
        "✓ 로그인할 때 실행": ("✓ Open at login", "✓ 登录时启动"),
        "로그인할 때 실행": ("Open at login", "登录时启动"),
        "원격 대시보드 (선택)": ("Remote dashboard (optional)", "远程仪表盘（可选）"),
        "원격 기기 연결…": ("Connect a remote device…", "连接远程设备…"),
        "로컬 수집기 다시 시작": ("Restart the local collector", "重启本地采集器"),
        "1top 종료": ("Quit 1top", "退出 1top"),
        "1top 옵션": ("1top options", "1top 选项"),
        "10분": ("10m", "10分钟"),
        "30분": ("30m", "30分钟"),
        "1시간": ("1h", "1小时"),
        "5시간": ("5h", "5小时"),
        "12시간": ("12h", "12小时"),
        "24시간": ("24h", "24小时"),
        "사용량 기간": ("Usage period", "用量时段"),
        "토큰 사용": ("Token usage", "Token 用量"),
        "사용량을 확인하고 있습니다": ("Checking usage", "正在确认用量"),
        "이 기간에 보고된 사용이 없습니다": ("No usage reported in this period", "此时段没有报告的用量"),
        "기타 모델": ("Other models", "其他模型"),
        "종료된 세션": ("Ended sessions", "已结束的会话"),
        "목록에 없는 세션": ("Sessions not listed", "未列出的会话"),
        "모델별": ("By model", "按模型"),
        "주간 한도": ("Weekly limit", "每周额度"),
        "계정별 100%": ("100% per account", "每个账户 100%"),
        "Claude Code 계정 로그인…": ("Sign in to a Claude Code account…", "登录 Claude Code 账户…"),
        "Codex 계정 로그인…": ("Sign in to a Codex account…", "登录 Codex 账户…"),
        "구독 계정 추가 로그인": ("Sign in to another subscription account", "登录其他订阅账户"),
        "+ 버튼으로 구독 계정을 연결하세요.": ("Connect a subscription account with the + button.", "用 + 按钮连接订阅账户。"),
        "주간": ("Weekly", "每周"),
        "수집 중": ("Collecting", "采集中"),
        "메모리": ("Memory", "内存"),
        "세션": ("Sessions", "会话"),
        "마지막 기록": ("Last record", "最后记录"),
        "토큰": ("Tokens", "Token"),
        "주간 한도 사용량": ("Weekly limit used", "每周额度用量"),
        "감지된 AI 세션이 없습니다": ("No AI sessions detected", "未检测到 AI 会话"),
        "로컬 세션을 확인하고 있습니다": ("Checking local sessions", "正在确认本地会话"),
        "실행 중인 AI 세션이 여기에 표시됩니다.": ("Running AI sessions appear here.", "正在运行的 AI 会话会显示在这里。"),
        "한도 조회 대기": ("Waiting for the limit", "等待额度查询"),
        "계정 연결 필요": ("Account not linked", "需要关联账户"),
        "환산 기준 수집 중": ("Collecting the conversion basis", "正在收集换算基准"),
        "Aside 기본 작업공간": ("Aside default workspace", "Aside 默认工作区"),
        "터미널 바로가기": ("Go to terminal", "前往终端"),
        "작업 일시정지…": ("Pause work…", "暂停工作…"),
        "새 요청으로 재개…": ("Resume with a new request…", "以新请求继续…"),
        "CLI 종료…": ("Quit CLI…", "退出 CLI…"),
        "전체 대시보드": ("Full dashboard", "完整仪表盘"),
        "전체 대시보드 열기": ("Open the full dashboard", "打开完整仪表盘"),
        "미확인": ("Unknown", "未知"),
        "macOS 승인 기다리는 중…": ("Waiting for macOS approval…", "正在等待 macOS 批准…"),
        "다시 연결": ("Reconnect", "重新连接"),
        "macOS가 저장된 로그인 사용을 한 번 묻습니다. 다시 묻지 않습니다.": ("macOS asks once to use the saved sign-in and won’t ask again.", "macOS 会询问一次是否使用已保存的登录，之后不再询问。"),
        "초기화 시각 미보고": ("Reset time unavailable", "重置时间未知"),
        "초기화 보고 대기": ("Awaiting the reset report", "等待重置报告"),
        "계정 이름(24자, 비우면 번호)": ("Account name (24 characters, empty for the number)", "账户名称（24 个字符，留空为编号）"),
        "저장": ("Save", "保存"),
        "1top 업데이트": ("1top update", "1top 更新"),
        "닫기": ("Close", "关闭"),
        "작업을 일시정지할까요?": ("Pause this work?", "要暂停这项工作吗？"),
        "현재 작업에 Esc를 보냅니다. 세션은 유지되며, 실제 중단 여부는 수집 후 확인됩니다.": ("Sends Esc to the current work. The session stays; whether it actually stopped is confirmed after collection.", "向当前工作发送 Esc。会话会保留，实际是否停止会在采集后确认。"),
        "일시정지": ("Pause", "暂停"),
        "새 요청으로 작업을 재개할까요?": ("Resume with a new request?", "要以新请求继续工作吗？"),
        "이전 작업을 이어서 진행하라는 새 요청을 보냅니다. 토큰을 다시 사용할 수 있습니다. 터미널에 작성 중인 입력이 없는지 확인하세요.": ("Sends a new request to continue the previous work. This can use tokens again. Make sure nothing is being typed in the terminal.", "发送一个继续之前工作的新请求，可能会再次使用 token。请确认终端中没有正在输入的内容。"),
        "새 요청으로 재개": ("Resume with a new request", "发送新请求继续"),
        "이 CLI를 종료할까요?": ("Quit this CLI?", "要退出此 CLI 吗？"),
        "작업 중이면 먼저 중단을 요청하고, 멈춘 상태가 확인되면 해당 CLI만 종료합니다. 터미널 탭과 저장된 기록은 유지됩니다.": ("If it is working, a stop is requested first, and only this CLI quits once it is confirmed stopped. The terminal tab and saved history stay.", "如果正在工作，会先请求停止，确认停止后只退出此 CLI。终端标签页和已保存的记录会保留。"),
        "CLI 종료": ("Quit CLI", "退出 CLI"),
        "Aside session stop으로 현재 작업 중단을 요청합니다. 세션은 유지됩니다. 실제 상태는 다음 수집 때 확인합니다.": ("Requests a stop of the current work with Aside session stop. The session stays; its actual state is checked at the next collection.", "通过 Aside session stop 请求停止当前工作。会话会保留，实际状态在下次采集时确认。"),
        "취소": ("Cancel", "取消"),
        "원격 기기 연결": ("Connect a remote device", "连接远程设备"),
        "1top 관리형 서버 또는 본인의 Cloudflare 서버 주소를 입력하세요. 선택한 서버에 로그인 식별정보와 기기 요약을 전달합니다.": ("Enter the 1top managed server or your own Cloudflare server address. Your sign-in identity and a summary of this device go to the server you choose.", "输入 1top 托管服务器或你自己的 Cloudflare 服务器地址。登录身份和设备摘要会发送到所选服务器。"),
        "연결": ("Connect", "连接"),
        "HTTPS 서버 주소만 입력하세요.": ("Enter an HTTPS server address only.", "请只输入 HTTPS 服务器地址。"),
        "실행 위치 미확인": ("Unknown host", "运行位置未知"),
        "작업 중": ("Working", "工作中"),
        "확인 필요": ("Needs attention", "需要确认"),
        "대기": ("Idle", "空闲"),
        "재개 요청 중": ("Resuming", "正在继续"),
        "중단됨": ("Interrupted", "已中断"),
        "환산 추정": ("Converted estimate", "换算估计"),
        "1분 미만": ("Under 1 minute", "不到 1 分钟"),
        "세션 수집 중": ("Collecting sessions", "正在采集会话"),
        "수집기 연결 중": ("Connecting to the collector", "正在连接采集器"),
        "수집 지연 · 마지막 기록": ("Delayed · Last record", "采集延迟 · 最后记录"),
        "연결 끊김 · 마지막 기록": ("Disconnected · Last record", "连接断开 · 最后记录"),
        "세션 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.": ("The session changed. Refresh and check again.", "会话状态已变化。请刷新后再确认。"),
        "응답을 확인하지 못했습니다. 다시 누르기 전에 터미널 상태를 확인하세요.": ("The response was not confirmed. Check the terminal before pressing again.", "未能确认响应。再次点击前请先查看终端状态。"),
        "계정 이름을 저장했습니다.": ("Saved the account name.", "已保存账户名称。"),
        "계정 이름을 저장하지 못했습니다.": ("Could not save the account name.", "无法保存账户名称。"),
        "연결 결과를 확인하지 못했습니다. 계정 상태가 바뀌었는지 먼저 확인해 주세요.": ("The result was not confirmed. Check whether the account status changed first.", "未能确认连接结果。请先查看账户状态是否已变化。"),
        "로그인 창을 확인하지 못했습니다. 다시 시도하기 전에 터미널을 확인해 주세요.": ("The sign-in window was not confirmed. Check the terminal before trying again.", "未能确认登录窗口。重试前请先查看终端。"),
        "확인됨": ("Checked", "已确认"),
        "보고 대기": ("Awaiting report", "等待报告"),
        "재연결 필요": ("Reconnect needed", "需要重新连接"),
        "갱신 중": ("Refreshing", "更新中"),
        "조회 제한": ("Rate limited", "查询受限"),
        "조회 지연": ("Delayed", "查询延迟"),
        "방금 보고": ("Reported just now", "刚刚报告"),
        "작업 중인 세션부터 표시합니다. 아래로 스크롤하면 모든 세션을 볼 수 있습니다.": ("Working sessions come first. Scroll down to see every session.", "工作中的会话排在前面。向下滚动可查看全部会话。"),
        "사용률 미확인": ("Usage unknown", "使用率未知"),
        "1top 간략 대시보드": ("1top quick view", "1top 简略仪表盘"),
        "간략 대시보드": ("Quick view", "简略仪表盘"),
        "업데이트 확인…": ("Check for Updates…", "检查更新…"),
        "1top 가리기": ("Hide 1top", "隐藏 1top"),
        "편집": ("Edit", "编辑"),
        "실행 취소": ("Undo", "撤销"),
        "잘라내기": ("Cut", "剪切"),
        "복사": ("Copy", "拷贝"),
        "붙여넣기": ("Paste", "粘贴"),
        "전체 선택": ("Select All", "全选"),
        "보기": ("View", "显示"),
        "새로고침": ("Reload", "重新载入"),
        "창 닫기": ("Close Window", "关闭窗口"),
        "업데이트 정보를 확인할 수 없습니다.": ("Could not check for updates.", "无法获取更新信息。"),
        "배포 페이지 열기": ("Open the releases page", "打开发布页面"),
        "로컬 수집기에 연결하고 있습니다…\n연결되면 대시보드가 자동으로 열립니다.\n간략 보기의 수집기 다시 시작을 사용할 수 있습니다.": ("Connecting to the local collector…\nThe dashboard opens on its own once connected.\nYou can restart the collector from the quick view.", "正在连接本地采集器…\n连接后仪表盘会自动打开。\n可在简略视图中重启采集器。"),
        "1top — 이 Mac": ("1top — This Mac", "1top — 这台 Mac"),
        "이 Mac의 대시보드를 여는 중…": ("Opening this Mac’s dashboard…", "正在打开这台 Mac 的仪表盘…"),
        "간략 보기": ("Quick view", "简略视图"),
        "브라우저": ("Browser", "浏览器"),
        "대시보드 연결을 다시 확인하고 있습니다…\n상단 새로고침으로 다시 연결할 수 있습니다.": ("Checking the dashboard connection again…\nUse Reload at the top to reconnect.", "正在重新确认仪表盘连接…\n可点击顶部的“重新载入”重新连接。"),
        "로컬 수집기를 시작하지 못했습니다. 앱을 다시 열어 주세요.": ("The local collector could not start. Reopen the app.", "无法启动本地采集器。请重新打开应用。"),
        "1top을 Applications 폴더로 옮긴 뒤 설정해 주세요.": ("Move 1top to the Applications folder first.", "请先将 1top 移到“应用程序”文件夹。"),
        "로그인 시 실행 설정을 저장하지 못했습니다.": ("Could not save the open-at-login setting.", "无法保存登录时启动的设置。"),
        "환산 기준 미확인": ("Conversion basis unknown", "换算基准未知"),
        "실시간 · 이 Mac": ("Live · This Mac", "实时 · 这台 Mac"),
        "초기": ("early", "初期"),
        "일부 토큰": ("partial tokens", "部分 token"),
        "화이트 모드": ("Light mode", "浅色模式"),
        "다크 모드": ("Dark mode", "深色模式"),
        "언어": ("Language", "语言"),
        "이전 제공자 관측 기준": ("Based on an earlier provider observation", "基于之前的提供方观察"),
        "종료 세션 포함": ("incl. ended sessions", "含已结束会话"),
        "지금 속도": ("Current rate", "当前速度"),
        "최근 60초의 토큰 속도로 계속 쓸 때": ("if it keeps the token rate of the last 60 seconds", "按最近 60 秒的 token 速度继续使用时"),
        "일부 하위 세션의 토큰은 미보고 상태입니다.": ("Some subsessions have not reported tokens.", "部分子会话的 token 尚未报告。"),
        "바로가기": ("Go to", "前往"),
        "세션 제어": ("Session controls", "会话控制"),
        "새 버전": ("New version", "新版本"),
        "설치 버전": ("Installed", "已安装版本"),
        "배포 버전": ("Released", "发布版本"),
        "미리보기 설치본은 자동 교체하지 않습니다.": ("Preview installs are not replaced automatically.", "预览版不会被自动替换。"),
        "전체": ("All", "全部")
    ]
}
