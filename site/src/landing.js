import release from '../public/release.json';
// Landing v6.0.0: 1top as the instrument cluster for AI work, in the order of the app v3.19.4 story:
// gauges first, then the macOS menu bar, weekly limits and the editable dashboard.
const MEDIA='/media/v6.0.0/';
// The films were recorded from the app build below; the download card follows release.json.
const FILM_APP='3.20.1';
const FILM={dashboard:[1512,948],gauges:[1200,964],accounts:[1512,948],customize:[1512,948],menu:[546,786]};
export function landingMarkup(t,repo){
 const mac=release.platforms.macos,lang=t('en','ko');
 // Downloads follow public/release.json, so a new release only updates the metadata.
 const winPreview=release.platforms.windows.legacy_preview,android=release.platforms.android;
 const film=(name,label,localized=true)=>{const file=localized?`${name}-${lang}`:name,[w,h]=FILM[name];return `<video class="product-film g-video" data-film="${name}" autoplay loop muted playsinline preload="auto" poster="${MEDIA}${file}.jpg" aria-label="${label}" width="${w}" height="${h}"><source src="${MEDIA}${file}.mp4" type="video/mp4"></video>`};
 const menuBar=`<div class="g-menubar" aria-hidden="true"><span class="g-apple"></span><b>Finder</b><span>${t('File','파일')}</span><span>${t('Edit','편집')}</span><i class="g-status"><svg viewBox="0 0 24 18"><path d="M1.5 9h2.6l1.6-3.2 2.2 8.4 2.4-12.2 2.6 15.4 2.4-12 2.2 7.6 1.6-4h3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></i><time>9:41</time></div>`;
 const gauge=(v,max,color)=>{const f=Math.min(1,v/max);return `<svg class="g-gauge" viewBox="0 0 120 70" aria-hidden="true"><path class="tr" d="M12 62 A48 48 0 0 1 108 62"/><path class="vl" d="M12 62 A48 48 0 0 1 108 62" pathLength="100" stroke-dasharray="${(f*100).toFixed(1)} 100" style="stroke:${color}"/><line x1="60" y1="62" x2="${(60-44*Math.cos(Math.PI*f)).toFixed(1)}" y2="${(62-44*Math.sin(Math.PI*f)).toFixed(1)}" style="stroke:${color}"/><circle cx="60" cy="62" r="5"/></svg>`};
 return `<main class="product-landing gauge-landing">
 <section class="g-hero">
  <a class="g-pill" href="#gauges"><i class="g-pip"></i>${t('v'+mac.version+' · Burn-rate gauges and an editable dashboard','v'+mac.version+' · 소진 속도 게이지와 편집하는 대시보드')}<span>↘</span></a>
  <h1>${t('The instrument panel<br><span>for your AI work.</span>','AI 작업의<br><span>계기판.</span>')}</h1>
  <p class="g-lede">${t('Which AI is running, where, and how fast it uses your weekly limit.<br>Read sessions, tokens, limits and your computer at a glance.','어떤 AI가 어디서 돌고, 주간 한도를 시간당 몇 %씩 쓰는지.<br>세션·토큰·한도·컴퓨터를 계기판처럼 한눈에 읽으세요.')}</p>
  <div class="g-ctas"><a class="g-primary" href="#download">↓ ${t('Download 1top','1top 다운로드')}</a><button class="g-secondary" data-demo>${t('Try the live demo','설치 없이 체험하기')} ↗</button></div>
  <p class="g-meta">${t('Free locally. Open source. Your own AI accounts.','로컬은 무료. 소스는 공개. AI 계정은 그대로.')}<br><span>${t('macOS preview','macOS 프리뷰')} v${mac.version} · ${t('Windows Store release in preparation','Windows Store 배포 준비 중')}</span></p>
 </section>
 <div class="hero-motion" data-hero-motion></div>
 <nav class="g-index" aria-label="${t('Product tour','제품 둘러보기')}"><a href="#gauges"><b>01</b>${t('Gauges','계기판')}</a><a href="#menubar"><b>02</b>${t('Menu bar','메뉴 막대')}</a><a href="#weekly"><b>03</b>${t('Weekly limits','주간 한도')}</a><a href="#yours"><b>04</b>${t('Your layout','내 방식대로')}</a></nav>

 <section class="g-films" id="features" aria-label="${t('The app in motion','움직이는 실제 앱 화면')}">
  <div class="g-rec"><p><i class="g-pip"></i>${t('Recorded from the macOS app v'+FILM_APP+' · Example data','macOS 앱 v'+FILM_APP+' 화면 녹화 · 예시 데이터')}</p><button class="g-toggle" data-motion-toggle data-play="${t('Play animations','애니메이션 재생')}" data-pause="${t('Pause animations','애니메이션 일시정지')}" aria-pressed="false">Ⅱ ${t('Pause animations','애니메이션 일시정지')}</button></div>

  <article class="g-film" id="gauges">
   <div class="g-head"><div><span class="g-num">01 / GAUGES</span><h2>${t('One dashboard.<br>A speedometer for every session.','한 화면의 계기판,<br>세션마다 속도계.')}</h2></div><p>${t('Pick a time window from 10 minutes to 24 hours, or set your own. The token flow, the usage map and every session follow it, next to computer resources and each account’s weekly usage. Each session gets its own burn-rate gauge.','10분부터 24시간까지 기간을 고르거나 직접 지정하면 토큰 흐름, 사용량 맵, 모든 세션이 함께 바뀝니다. 컴퓨터 자원과 계정별 주간 사용률도 같은 화면에 있고, 세션마다 소진 속도 게이지가 붙습니다.')}</p></div>
   <div class="g-screen">${film('dashboard',t('Dashboard: time window, resources, weekly usage, token flow, usage map and sessions with burn-rate gauges','대시보드: 기간, 컴퓨터 자원, 주간 사용률, 토큰 흐름, 사용량 맵, 소진 속도 게이지가 있는 세션 목록'))}</div>
   <div class="g-cap"><span>${t('Time window → Resources · Weekly usage → Token flow · Usage map → Sessions','기간 → 컴퓨터 · 주간 사용 → 토큰 흐름 · 사용량 맵 → 세션')}</span><span>${t('Actual interface · Example sessions','실제 인터페이스 · 예시 세션')}</span></div>
   <div class="g-read">
    <div class="g-screen g-close">${film('gauges',t('Close-up of the session table: weekly-limit share and burn-rate gauges','세션 표 확대: 주간 한도 환산과 소진 속도 게이지'))}</div>
    <dl class="g-legend"><p class="g-kicker">${t('How to read the gauges','계기판 읽는 법')}</p>
     <div>${gauge(1.21,2,'#bd8965')}<dt>${t('Burn rate · %/h','소진 속도 · %/시간')}</dt><dd>${t('How fast a session is using its account’s weekly limit right now: its current token speed, converted to percent of the weekly limit per hour. All gauges share one scale of 1, 2, 5, 10 %/h and up, so needles compare at a glance. It is not a forecast.','세션이 지금 계정의 주간 한도를 얼마나 빨리 쓰는지 보여 줍니다. 현재 토큰 속도를 주간 한도 %로 환산한 시간당 비율입니다. 모든 게이지가 1·2·5·10 %/시간 단위의 같은 눈금을 써서 바늘끼리 바로 비교할 수 있습니다. 앞으로의 사용량 예측은 아닙니다.')}</dd></div>
     <div><b class="g-eq">≈0.76%</b><dt>${t('Weekly-limit share','주간 한도 환산')}</dt><dd>${t('The tokens a session used in the selected window, as an estimated share of its account’s weekly limit. Accounts are never added together.','선택한 기간에 세션이 쓴 토큰을 계정의 주간 한도 %로 환산한 추정치입니다. 서로 다른 계정의 %는 더하지 않습니다.')}</dd></div>
     <div><b class="g-win"><i>10${t('m','분')}</i><i class="on">1${t('h','시간')}</i><i>${t('Custom','지정')}</i></b><dt>${t('Time window','기간')}</dt><dd>${t('Six windows from 10 minutes to 24 hours, or a custom range in minutes, hours or days, up to all recorded history. The table, token flow and usage map all follow it.','10분부터 24시간까지 여섯 가지 기간에 더해, 분·시간·일 단위로 기간을 직접 지정하거나 전체 기록을 고를 수 있습니다. 표, 토큰 흐름, 사용량 맵이 모두 그 기간을 따릅니다.')}</dd></div>
    </dl>
   </div>
  </article>

  <article class="g-film g-menu" id="menubar">
   <div class="g-menu-copy"><span class="g-num">02 / MENU BAR</span><h2>${t('The same gauges.<br>In the menu bar.','같은 계기판을,<br>메뉴 막대에서.')}</h2><p>${t('Click the 1top icon in the macOS menu bar. One panel holds weekly usage for every account, CPU and memory, the token flow, the usage map and your sessions with their gauges.','macOS 메뉴 막대의 1top 아이콘을 누르면 패널 하나에 계정별 주간 사용률, CPU·메모리, 토큰 흐름, 사용량 맵, 게이지가 붙은 세션이 모두 담겨 있습니다.')}</p>
    <ul class="g-points"><li>${t('Weekly % and hourly pace for each account','계정마다 주간 사용률과 시간당 속도')}</li><li>${t('Every session with its ≈% and burn rate','세션마다 ≈%와 소진 속도')}</li><li>${t('↗ jumps to the app a session runs in','↗로 세션이 실행 중인 앱 열기')}</li><li>${t('The full dashboard is one click away','전체 대시보드도 바로 열기')}</li></ul>
    <div class="g-cap"><span>${t('Native macOS panel · Example data','macOS 기본 패널 · 예시 데이터')}</span></div></div>
   <div class="g-desk">${menuBar}${film('menu',t('Native menu-bar panel with weekly account usage, resources, token flow, usage map and sessions','계정별 주간 사용률, 컴퓨터 자원, 토큰 흐름, 사용량 맵, 세션이 담긴 메뉴 막대 패널'),false)}</div>
  </article>

  <article class="g-film" id="weekly">
   <div class="g-head"><div><span class="g-num">03 / WEEKLY LIMITS</span><h2>${t('This week’s limit.<br>How much, and how fast.','이번 주 한도를<br>얼마나, 얼마나 빨리.')}</h2></div><p>${t('Each account shows the weekly percentage its provider reports, how much it rose in the selected window and its average per hour. Claude Code values come from the status line Claude Code already reports.','계정마다 제공자가 보고한 주간 사용률, 선택한 기간에 늘어난 폭, 시간당 평균을 보여 줍니다. Claude Code 값은 Claude Code가 상태 줄에 이미 보고하는 값을 씁니다.')}</p></div>
   <div class="g-screen">${film('accounts',t('Account usage: weekly percentages, increases and hourly averages','계정 사용량: 주간 사용률, 기간 증가, 시간당 평균'))}</div>
   <div class="g-cap"><span>${t('Weekly % → Rise in the window → Hourly average','주간 사용률 → 기간 증가 → 시간당 평균')}</span><span>${t('Provider reports · Accounts are never added together','제공자 보고값 기준 · 계정끼리 더하지 않음')}</span></div>
  </article>

  <article class="g-film" id="yours">
   <div class="g-head"><div><span class="g-num">04 / YOUR LAYOUT</span><h2>${t('Arrange it<br>your way.','내 방식대로<br>배치하세요.')}</h2></div><p>${t('Press Edit to move and resize panels. Drag table columns to reorder or resize them. Switch between dark and light, and between English, Korean and Chinese. 1top remembers your layout.','편집을 누르면 패널을 옮기고 크기를 바꿀 수 있습니다. 표의 열은 끌어서 순서와 너비를 바꿉니다. 다크·라이트 테마와 영어·한국어·중국어를 고를 수 있고, 배치는 그대로 기억합니다.')}</p></div>
   <div class="g-screen">${film('customize',t('Editing the dashboard layout, reordering columns, and switching theme and language','대시보드 배치 편집, 열 순서 변경, 테마와 언어 전환'))}</div>
   <div class="g-try"><p>${t('Try it on this page','이 페이지에서도 바꿔 보세요')}</p><button type="button" data-theme-toggle>${t('Switch theme','테마 바꾸기')}</button><button type="button" data-language>${t('한국어로 보기','View in English')}</button></div>
  </article>
  <p class="g-note">${t('Demo values change faster to show the workflow. Your dashboard follows the reports from your tools and accounts.','동작을 보여 드리려고 예시 수치를 빠르게 갱신했습니다. 실제 대시보드는 도구와 계정에서 보고되는 값을 표시합니다.')}</p>
 </section>

 <section class="g-features"><div class="g-sec-head"><p class="g-kicker">${t('Less searching. More clarity.','덜 찾고, 더 분명하게.')}</p><h2>${t('Everything on one panel.','필요한 건 모두 한 판에.')}</h2></div><div class="g-grid">${[
  [t('A gauge for every session','세션마다 게이지'),t('Burn rate in %/h next to each session’s estimated share of the weekly limit. Subagents fold under the session that started them.','세션마다 주간 한도 환산 ≈%와 시간당 소진 속도를 나란히 보여 줍니다. 하위 에이전트는 시작한 세션 아래로 묶입니다.')],
  [t('The right session, in the right app','어느 앱의 어떤 세션인지'),t('AI tool, model and reasoning effort, host app and terminal, CPU and memory share for every session.','세션마다 AI 도구·모델·추론 강도, 실행 앱·터미널, CPU와 메모리 점유율을 구분합니다.')],
  [t('Weekly limits, in percent','주간 한도를 %로'),t('Provider-reported weekly usage per account, how much it rose in the selected window, and the hourly average.','계정마다 제공자가 보고한 주간 사용률과 선택한 기간에 늘어난 폭, 시간당 평균을 봅니다.')],
  [t('Editable dashboard, any time range','편집하는 대시보드, 원하는 기간'),t('Move and resize panels, reorder and resize columns, and set a custom range up to all recorded history. Your layout, range, theme and language are remembered.','패널 위치와 크기, 열 순서와 너비를 바꾸고, 전체 기록까지 기간을 직접 지정합니다. 배치·기간·테마·언어를 기억합니다.')],
  [t('Back to the work that needs you','확인이 필요한 작업으로 바로'),t('Open the host app, interrupt a supported task, stop a verified CLI, or rename a confirmed Orca terminal.','실행 앱으로 이동하고, 지원되는 작업을 중단하거나 확인된 CLI를 종료하고, 확인된 Orca 터미널의 이름을 바꿉니다.')],
  ['Goals · Loops · Skills',t('Goals in Claude Code and Codex, Claude Code loop observations and installed skills. Reported activity stays distinct from verified success.','Claude Code·Codex의 Goal, Claude Code의 Loop 관측 기록, 설치된 Skill을 봅니다. 실행 관측과 작업 성공은 구분합니다.')]
 ].map(([h,p],i)=>`<article><span>${String(i+1).padStart(2,'0')}</span><h3>${h}</h3><p>${p}</p></article>`).join('')}</div></section>

 <section class="g-local" id="how"><div><p class="g-kicker">${t('At home on your Mac','내 Mac에서 그대로')}</p><h2>${t('Your setup.<br>Your accounts.','쓰던 도구 그대로.<br>쓰던 계정 그대로.')}</h2><p>${t('1top reads supported local reports. It doesn’t buy or resell AI tokens. Local monitoring works without a 1top account.','1top은 지원되는 로컬 기록을 읽습니다. AI 토큰을 판매하지 않으며, 로컬 모니터링에는 1top 로그인이 필요 없습니다.')}</p><a href="${repo}" target="_blank" rel="noopener" class="g-link">${t('Read the source','소스 코드 보기')} ↗</a></div><ol class="g-steps">
  <li><b>1</b><div><h3>${t('Open 1top','1top 실행')}</h3><p>${t('The dashboard window when you need detail, the menu-bar panel when you don’t.','자세히 볼 때는 대시보드 창, 빠르게 볼 때는 메뉴 막대 패널.')}</p></div></li>
  <li><b>2</b><div><h3>${t('Keep using your AI tools','평소처럼 AI 도구 사용')}</h3><p>${t('Supported sessions and usage reports appear automatically.','지원되는 세션과 사용량 기록이 자동으로 나타납니다.')}</p></div></li>
  <li><b>3</b><div><h3>${t('Add remote access if you need it','원격 접속은 필요할 때만')}</h3><p>${t('Check sessions from another computer or your phone, and send a message to a verified session. Managed access is currently limited to approved accounts.','다른 컴퓨터나 휴대폰에서 세션을 확인하고, 확인된 세션에 메시지를 보낼 수 있습니다. 현재 관리형 원격 접속은 승인된 계정에 한정됩니다.')}</p></div></li></ol></section>

 <section class="g-download" id="download"><p class="g-kicker">${t('Get 1top','1top 받기')}</p><h2>${t('Put your AI work on the gauges.','내 AI 작업을 계기판 위에.')}</h2><p>${t('Install on your computer. Check in from anywhere.','컴퓨터에 설치하고, 어디서든 확인하세요.')}</p><div class="g-options">
  <article><span class="g-sym">⌘</span><div><h3>macOS</h3><p>Apple silicon · macOS 13+</p></div><span class="g-state">PREVIEW</span><p>${t('Burn-rate gauges, an editable dashboard, the menu-bar panel and dark/light themes. Preview build: Apple notarization is not complete.','소진 속도 게이지, 편집하는 대시보드, 메뉴 막대 패널, 다크·라이트 테마. Apple 공증 전 프리뷰 배포본입니다.')}</p><a class="g-primary" href="${mac.url}">${t('Download DMG','DMG 다운로드')} ↓</a><small>v${mac.version}</small></article>
  <article><span class="g-sym">⊞</span><div><h3>Windows</h3><p>x64 · Windows 10 / 11</p></div><span class="g-state">COMING TO STORE</span><p>${t('Desktop dashboard and system tray. Microsoft Store distribution is in preparation. Installation will be available after certification.','데스크톱 대시보드와 시스템 트레이. Microsoft Store 배포를 준비 중입니다. 심사 완료 후 설치할 수 있습니다.')}</p><button class="g-primary" disabled>${t('Microsoft Store · Coming soon','Microsoft Store · 준비 중')}</button>${winPreview?.url?`<a class="g-link" href="${winPreview.url}">${t('Unsigned EXE preview','미서명 EXE 프리뷰')} v${winPreview.version} ↓</a>`:''}</article>
  <article><span class="g-sym">▯</span><div><h3>Android</h3><p>${t('Native mobile app','네이티브 모바일 앱')}</p></div><span class="g-state">PREVIEW</span><p>${t('Sessions, usage maps, and account limits on your phone. Install the signed APK or explore its built-in demo. Remote access uses an approved managed account or your own relay.','휴대폰에서 세션·사용량 맵·계정 한도를 확인합니다. 서명된 APK를 설치해 데모를 체험할 수 있습니다. 원격 연결은 승인된 계정에서 이용할 수 있습니다.')}</p><a class="g-primary" href="${android.url}">${t('Download APK','APK 다운로드')} ↓</a><small>v${android.version} · Android 7+</small></article>
  <article><span class="g-sym">▯</span><div><h3>iPhone · iPad</h3><p>${t('Native mobile app','네이티브 모바일 앱')}</p></div><span class="g-state">${t('IN DEVELOPMENT','개발 중')}</span><p>${t('Native screens for your remote workspace. A public TestFlight or App Store release is not available yet.','원격 워크스페이스를 위한 네이티브 화면을 준비하고 있습니다. 공개 TestFlight·App Store 배포 전입니다.')}</p><button class="g-secondary" data-demo>${t('Try the web dashboard','웹 대시보드 체험')} ↗</button></article>
 </div><p class="g-fine">${t('Remote access uses an approved managed account or your own relay. Local desktop monitoring works without signing in.','원격 접속은 승인된 관리형 계정 또는 본인 서버를 이용합니다. 데스크톱 로컬 모니터링은 로그인 없이 작동합니다.')} <a class="g-link" href="${repo}/releases">${t('Release notes & checksums','배포 안내 · 체크섬')} ↗</a></p></section>

 <section class="g-faq"><h2>${t('A few things to know.','궁금하실 것들.')}</h2>${[
  [t('Is 1top free?','무료인가요?'),t('Local monitoring is free and open source. Managed remote access is limited to approved accounts; public subscription plans are not open yet.','로컬 모니터링은 무료·오픈소스입니다. 관리형 원격 접속은 현재 승인된 계정에 한정되며 공개 유료 가입은 아직 열리지 않았습니다.')],
  [t('Do I need to sign in?','로그인이 필요한가요?'),t('Not for local monitoring. Google sign-in is used for the optional remote workspace.','내 컴퓨터에서 볼 때는 필요 없습니다. 선택 기능인 원격 워크스페이스에서 Google 로그인을 사용합니다.')],
  [t('What does the burn-rate gauge show?','소진 속도 게이지는 무엇을 보여 주나요?'),t('A session’s current token speed, converted with its account’s recent provider reports into percent of the weekly limit per hour. It shows the pace right now, not a forecast. Until the account has enough reports to convert, the gauge shows that it is still measuring.','세션의 현재 토큰 속도를 계정의 최근 제공자 보고값으로 환산해, 주간 한도의 시간당 %로 보여 줍니다. 지금의 속도이며 예측이 아닙니다. 환산할 보고값이 쌓이기 전에는 확인 중으로 표시합니다.')],
  [t('What do the other numbers mean?','다른 숫자는 무엇을 의미하나요?'),t('Tokens are reported input, cache and output usage; token speed is a 60-second average. Weekly percentages are what each provider reports for the account. A session’s ≈% is an estimate from its tokens in the selected window, not a provider charge.','토큰은 보고된 입력·캐시·출력 사용량이고, 토큰 속도는 최근 60초 평균입니다. 주간 %는 제공자가 계정별로 보고한 값입니다. 세션의 ≈%는 선택한 기간의 토큰으로 환산한 추정치이며, 실제 청구와 다릅니다.')],
  [t('How does 1top get Claude Code limits?','Claude Code 한도는 어떻게 가져오나요?'),t('From the status-line report Claude Code already produces. 1top adds a reversible hook that keeps your existing status line, and it does not read your Claude credentials. Values refresh after Claude Code’s next response.','Claude Code가 상태 줄에 보고하는 값을 받아 씁니다. 기존 상태 줄은 그대로 두고 되돌릴 수 있는 연결만 더하며, Claude 인증 정보는 읽지 않습니다. 값은 Claude Code가 다음 응답을 마친 뒤 갱신됩니다.')],
  [t('What stays on my computer?','어떤 데이터가 컴퓨터에 남나요?'),t('Local session logs and credentials stay on your computer. If you enable remote access, bounded monitoring summaries are shared with your account; raw conversations and provider credentials are excluded.','로컬 세션 기록과 인증 정보는 컴퓨터에 남습니다. 원격 접속을 켜면 본인 계정으로 모니터링 요약을 전송하며, 대화 원문과 제공자 인증 정보는 제외합니다.')]
 ].map(([q,a])=>`<details><summary>${q}<span>+</span></summary><p>${a}</p></details>`).join('')}</section>
 </main>`;
}
