// Simplified Chinese for the /app dashboard, keyed by the English text. Terms follow the desktop
// dashboard's i18n.js (会话, 工作中, 每周额度, tokens/小时). Missing keys fall back to English;
// site/scripts/check-zh.mjs lists any that are missing.
export const ZH={
 // Shell and header
 'Language':'语言','Features':'功能','Download':'下载','Switch to dark theme':'切换到深色模式','Switch to light theme':'切换到浅色模式',
 'Dashboard':'仪表盘','Settings':'设置','Sign out':'退出登录','Sign in':'登录','Your AI work. In one place.':'你的 AI 工作，尽在一处。',
 'Privacy':'隐私','Source & support':'源代码与支持',
 'Your computers.<br>Within reach.':'你的电脑，<br>随时可及。',
 'Local monitoring is free and needs no sign-in. Sign in here for an approved managed remote workspace. New remote enrollment is currently closed.':'本地监控免费，无需登录。已获批准的托管远程工作区请在此登录。目前暂停新的远程注册。',
 'Continue with Google':'使用 Google 继续','Explore without signing in':'无需登录即可体验',
 // Sidebar
 'My workspace':'我的工作区','Checking access':'正在确认访问权限','Workspace sections':'工作区栏目',
 'AI tools':'AI 工具','Filter by AI tool':'按 AI 工具筛选','Apps':'运行应用','Filter by app':'按应用筛选',
 'Local monitoring is free':'本地监控免费','Open on this computer':'在此电脑上打开','Requires the companion running here':'需要此电脑上正在运行配套程序',
 'Understanding the numbers and controls':'了解指标与控制',
 // Session states
 'Working':'工作中','Idle':'空闲','Needs attention':'需要确认','Paused':'已暂停','Resume requested':'正在继续','Interrupted':'已中断','Unconfirmed':'未确认',
 // Dashboard
 'ILLUSTRATIVE DEMO · NO REAL DEVICE CONTROL':'示例演示 · 不会控制真实设备','Connecting':'连接中','Installation & access':'安装与访问',
 'Usage period':'用量时段','Sessions & locations':'会话与位置','Unknown usage means unreported, not zero.':'未知用量表示未报告，不代表为零。',
 'Find an app, project, or model':'搜索应用、项目或模型','Computer / app / session':'电脑 / 应用 / 会话','AI tool / model':'AI 工具 / 模型',
 'Status':'状态','Last hour':'最近 1 小时','Current pace':'当前速度','Controls':'控制',
 'Account limits · 5H / weekly':'账户额度 · 5 小时 / 每周',
 'Reported plan usage. Account labels match the last six characters shown locally.':'提供方报告的套餐用量。账户标签与本地显示的最后六个字符一致。',
 'Computers':'电脑','Choose a computer to narrow every view. CPU and memory are as last reported.':'选择一台电脑即可缩小所有视图的范围。CPU 和内存为最近一次报告的值。',
 'Reported summaries. Goal text and skill paths stay on each computer.':'已报告的摘要。目标内容和 Skill 路径保留在各台电脑上。',
 'Connected apps':'已连接应用','Apps each computer detected. An open app is not proof of an active AI session.':'各台电脑检测到的应用。应用已打开不代表 AI 会话正在运行。',
 'Remote “Open app” brings that app forward on the selected computer. This is not remote screen sharing.':'远程“打开应用”会在所选电脑上将该应用切换到前台，这不是远程屏幕共享。',
 'Managed remote access is not enabled for this account. Local monitoring and the demo are free.':'此账户未开通托管远程访问。本地监控和演示均免费。',
 'REMOTE ACCESS':'远程访问','Access required':'需要访问权限','Demo data':'演示数据','Live connection':'实时连接','Reconnecting':'正在重新连接',
 'Connect your first computer.':'连接你的第一台电脑。','Install the companion on the computer you want to monitor, then sign in with this account.':'在要监控的电脑上安装配套程序，然后用此账户登录。',
 'Get the companion':'获取配套程序','All computers':'全部电脑','Computer scope: ':'电脑范围：','Sessions':'会话','Online':'在线','Offline':'离线',
 'Last report':'上次报告','Memory':'内存','Unknown app':'应用未知','Showing ':'正在显示：','Clear filters':'清除筛选','Collection started: ':'开始采集：',
 'Totals include currently reporting computers only. Missing reports and earlier history are excluded.':'总计仅包含当前正在报告的电脑，不含缺失的报告和更早的记录。',
 'Usage appears after a computer connects.':'电脑连接后将显示用量。','Last ':'最近 ','No matching sessions.':'没有符合条件的会话。',
 'Waiting for your first computer.':'正在等待你的第一台电脑。','Terminal unconfirmed':'终端未知','Model unreported':'模型未知','In-app session':'应用内会话',
 'Lifetime':'累计','h':'小时','Messages':'消息','Open':'打开','Instruct AI':'发送指令','Pause':'暂停','Resume':'继续','Stop CLI':'停止 CLI',
 'Disconnect this computer':'断开此电脑','Detected apps':'检测到的应用',
 // Confirm dialog
 'AI instruction':'AI 指令','Continue testing and fix the errors.':'继续测试并修复错误。',
 'Up to 4,000 characters. This sends a new instruction and can use tokens.':'最多 4,000 个字符。这会发送新指令，可能消耗 Token。',
 'Cancel':'取消','Confirm':'确认','Send an instruction to this AI?':'向此 AI 发送指令？','Open the app on this computer?':'在此电脑上打开该应用？',
 'Interrupt the current turn?':'中断当前轮次？','Send a new continue request?':'发送新的继续请求？','End this CLI process?':'结束此 CLI 进程？',
 'This starts a new request and can use more tokens.':'这会开始新的请求，可能消耗更多 Token。',
 'Unsaved work may be lost. The selected CLI receives a termination signal; its host IDE is not the target.':'未保存的工作可能丢失。所选 CLI 会收到终止信号，其所在的 IDE 不受影响。',
 'The action runs on the selected computer.':'操作将在所选电脑上执行。','Send instruction':'发送指令',
 'Send your sign-in identity and connected summaries to ':'将你的登录身份和连接摘要发送到 ',
 'Enter an instruction up to 4,000 characters.':'请输入不超过 4,000 个字符的指令。','Demo only — no real command was sent.':'仅为演示，未发送真实命令。',
 'Completed':'已完成','Request sent. Waiting for the computer.':'请求已发送，正在等待电脑响应。',
 'Result unconfirmed. Check the computer before sending another request.':'结果未确认。再次发送请求前请先检查电脑。',
 // Goals · Loops · Skills
 'Installed skills':'已安装的 Skills','Observed calls / runs':'已观察到的调用 / 执行',
 'Claude Code /loop: current schedule and next run unverified. Skill success unverified.':'Claude Code /loop：当前计划和下次执行未确认，Skill 是否成功未确认。',
 'Session connected':'会话已连接','Saved / observed state':'已保存 / 已观察状态',' · Last observed':' · 上次观察','No goal summary received':'尚未收到目标摘要',
 'Activity appears when a compatible companion reports it.':'兼容的配套程序报告后将显示活动。',
 // Account limits and cockpit
 'Weekly':'每周','Unknown':'未知','Resets ':'重置于 ','Reset time not reported':'重置时间未知','Last reported / cached':'上次报告 / 缓存','Provider report':'提供方报告',
 'Account limits appear when a compatible companion reports them.':'兼容的配套程序报告后将显示账户额度。',
 'Average':'平均','Checking':'确认中','tokens/h':'tokens/小时','Other models':'其他模型','By model':'按模型','Checking usage':'正在确认用量',
 'No usage reported in this period':'此时段没有已报告的用量','Reconnect needed':'需要重新连接','Collecting':'采集中','/h':'/小时',
 'Connect subscription accounts in 1top on your computer.':'请在电脑上的 1top 中连接订阅账户。','Waiting for a computer to report.':'正在等待电脑报告。',
 'Token usage':'Token 用量','Weekly limits':'每周额度','100% per account':'每个账户 100%',
 // Usage map
 'Usage share map':'用量分布','Area = reported tokens in the selected window':'面积代表所选时段的已报告 Token','Group usage map':'用量分布分组',
 'Currently connected sessions on online computers. Unknown values are excluded, not treated as zero.':'基于在线电脑上当前连接的会话。未知值不计入，也不视为零。',
 'In-app runtime unreported':'应用内工具未报告','Other sessions':'其他会话','sessions':'个会话','groups':'组',
 'Uncached input':'新输入','Cache read':'缓存读取','Cache write':'缓存写入','Latest request input; not a content category.':'最新请求输入，并非内容分类。',
 'Reported input':'已报告输入','Remaining capacity':'剩余容量','Capacity minus last input; output and reserves are not included.':'容量减去上次输入，不含输出和预留部分。',
 'No reported usage in this window.':'此时段没有已报告的用量。','Input report unavailable':'输入用量未报告',
 'No context ratio is inferred from lifetime tokens.':'不会根据累计 Token 推算上下文比例。','capacity unknown':'容量未报告','Last request input':'上次请求输入','Capacity mismatch':'容量报告不一致',
 // Session messages
 'Sending':'发送中','Waiting for the current turn to finish':'正在等待当前轮次结束','Waiting for a reply':'正在等待回复','Replied':'已回复',
 'Delivery unconfirmed — check the session before resending':'送达未确认，重新发送前请先检查会话','Reply connection changed':'回复连接已变更',
 'Not delivered — session changed or waiting expired':'未送达：会话已变更或等待超时','Session reply':'会话回复','Long reply shortened.':'较长的回复已缩短。',
 'Ask this session':'向此会话提问','“How far along are you?”':'“进展到哪一步了？”','SESSION MESSAGES':'会话消息','Close messages':'关闭消息',
 'Your messages and this session’s replies. The full work conversation stays on your computer.':'你的消息和此会话的回复。完整的工作对话保留在你的电脑上。',
 'Message to session':'发给会话的消息','Write a message…':'输入消息…','A busy session may reply later. Messages can use AI tokens.':'忙碌的会话可能稍后回复，消息可能消耗 AI Token。',
 'Send message':'发送消息','Computer is offline. Reconnect to receive replies.':'电脑已离线，重新连接后才能接收回复。','Message connection unavailable.':'消息连接不可用。',
 'Reconnect before sending.':'请先重新连接再发送。','Demo reply: The first checks are finished. I am reviewing the remaining failures.':'演示回复：第一轮检查已完成，正在查看剩余的失败项。',
 'If delivery is uncertain, check the session before resending.':'如果无法确认是否送达，请先检查会话再重新发送。',
};

// Texts built around a number, as maps.js writes them.
const PATTERNS=[[/^(\d+) sessions$/,'$1 个会话'],[/^(\d+) groups$/,'$1 组']];
export function zhText(en){
 if(Object.prototype.hasOwnProperty.call(ZH,en))return ZH[en];
 for(const [pattern,to] of PATTERNS)if(pattern.test(en))return en.replace(pattern,to);
 return en;
}

// maps.js speaks only Korean and English; in Chinese it draws English and this replaces its texts.
// Names people gave (tile labels, legend names, the tooltip title) are left as they are, except the
// labels maps.js writes itself.
const USER_TEXT='.map-tile-label,.map-legend-item>span,.map-tooltip strong,[data-user-content]';
const MAP_LABELS=new Set(['Other sessions','Uncached input','Cache read','Cache write','Reported input','Remaining capacity','Input report unavailable','In-app runtime unreported','Model unreported']);
export const mapLabel=label=>MAP_LABELS.has(label)?ZH[label]:label;
export function translateTree(root){
 if(!root)return;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  const raw=node.nodeValue,text=raw.trim();if(!text)continue;
  const zh=node.parentElement?.closest(USER_TEXT)?mapLabel(text):zhText(text);if(zh!==text)node.nodeValue=raw.replace(text,zh);
 }
}
