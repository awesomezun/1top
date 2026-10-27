# Microsoft Store listing draft · v3.8.0

This is submission copy, not a published listing. Reserved app name and publisher identity remain assigned by Partner Center.

## English

**Name:** 1top

**Short description:** Your AI sessions, token usage, and computer resources in one dashboard.

**Description:**

Keep track of your AI work across applications and terminals. 1top brings running sessions, reported token usage, and computer resources into one desktop dashboard, with a tray icon for quick access.

See where each session is running. Compare token totals over 10 minutes, 30 minutes, 1 hour, 5 hours, 12 hours, or 24 hours. Explore the usage map, check CPU and memory, and inspect account limits when your provider reports them. Missing or partial usage stays clearly identified.

Local monitoring is free and does not require a 1top account. Your AI tools and subscriptions remain your own. Optional remote access lets approved accounts view linked computers from the web or mobile interface. Available session controls depend on the session's connection and permissions.

1top is open source. It reads local session records and process information to create the dashboard. It does not provide an AI subscription or sell model tokens. It needs Microsoft Edge WebView2 Runtime; if missing, first launch offers the Microsoft runtime setup, which needs internet access.

**Features:**

- Sessions grouped by application, AI tool, model, and location.
- Rolling token totals and an interactive usage map.
- Computer CPU and memory monitoring.
- Reported subscription limits and reset times.
- Desktop dashboard and system tray access.
- Free local monitoring without a 1top login.

## 한국어

**이름:** 1top

**간단한 설명:** AI 세션·토큰 사용량·컴퓨터 자원을 한 화면에서 확인하세요.

**설명:**

여러 앱과 터미널에 흩어진 AI 작업을 한곳에서 확인하세요. 1top은 실행 중인 세션, 보고된 토큰 사용량, 컴퓨터 자원을 데스크톱 대시보드에 모아 보여줍니다. 시스템 트레이에서도 빠르게 열 수 있습니다.

각 세션이 어느 앱과 터미널에서 돌아가는지 확인하고, 최근 10분·30분·1시간·5시간·12시간·24시간의 토큰 합계를 비교하세요. 사용량 맵과 CPU·메모리, 제공자가 보고하는 구독 한도를 함께 살펴볼 수 있습니다. 미보고 수치와 일부 기간만 수집된 기록은 구분해서 표시합니다.

로컬 모니터링은 무료이며 1top 로그인이 필요 없습니다. 기존 AI 도구와 구독을 그대로 사용합니다. 선택 기능인 원격 접속은 승인된 계정에 한해 연결한 컴퓨터를 웹·모바일에서 확인할 수 있습니다. 세션 제어는 각 연결에서 제공하는 기능과 권한에 따라 달라집니다.

1top은 오픈 소스입니다. 로컬 세션 기록과 프로세스 정보를 읽어 대시보드를 구성합니다. AI 구독이나 모델 토큰을 판매하는 앱이 아닙니다. Microsoft Edge WebView2 Runtime이 필요하며, 없으면 처음 실행할 때 Microsoft 런타임 설치를 안내합니다. 이 초기 설정에는 인터넷 연결이 필요합니다.

## Product details

- Proposed category: Developer tools (confirm available Partner Center taxonomy).
- Price: free local app; no public managed-remote purchase flow is enabled.
- Website: https://1top.si
- Privacy policy: https://1top.si/privacy
- Support: https://github.com/awesomezun/1top/issues
- License/source: https://github.com/awesomezun/1top
- Required architecture: x64. Final ARM64 or x86 support must not be selected without native build and installation QA.

## Notes for certification

Local dashboard functionality needs no sign-in or test account. Start 1top from Start, allow first collection to finish, and inspect the resource cards. A computer without active AI tools can legitimately show zero sessions. To exercise token reports, run an AI CLI with its normal local history enabled; the app reads reported usage rather than generating artificial charges. Synthetic CI records are test-only and are not presented to customers as real usage.

The app stays in the system tray after the window closes. Use **Quit 1top** in the tray menu to exit. The app starts an owned collector child and shuts down that child on quit. It does not terminate user AI sessions merely because the dashboard closes. Existing collectors started by another 1top process are preserved.

The `runFullTrust` capability is needed for the existing Win32/Python desktop app, local process resource inspection, reading user-owned AI session reports, the loopback collector, system tray integration, and explicit session controls. It runs as the signed-in user. It does not request administrator rights or install a driver or Windows service.

Remote access is optional and currently restricted to approved accounts. It is not required to evaluate the app's local purpose. Any request to review remote features must be handled with a separate, limited test account; do not provide a personal account or private local history in submission notes.
