# Codex 백엔드 인계 v1.0.10

작성: Claude (프론트엔드) · 2026-10-29 · 받는 쪽: Codex (백엔드·수집·빌드)

v1.0.9 이후 프론트엔드 22개 커밋(`8887b02`~`b06fe95`)의 내용과, 새 배포본(4.3.0)을 내려면 백엔드에서 해 주셔야 할 일을 정리했습니다. 오늘 Orca 메시지로 따로 보낸 요청 4건도 모두 이 문서에 담았습니다.

## 1. 시작점과 동결 확인

| 항목 | 값 |
|---|---|
| 브랜치 | `awesomezun/frontend-redesign` (작업 폴더 `/Users/kang/orca/workspaces/1top/frontend-redesign`) |
| 프론트엔드 마지막 커밋 | `b06fe95`, 그리고 이 문서가 들어 있는 커밋 |
| 동결 목록 | `docs/handoffs/frontend-freeze_v1.17.0.sha256` (106개) |

```bash
shasum -a 256 -c docs/handoffs/frontend-freeze_v1.17.0.sha256
```

**v1.16.0과 달라진 동결 범위**
- 새로 들어간 파일
  - 대시보드: `agent/onetop/dist/conversation.js`, `quick.html`, `quick.js`, `quick.css`
  - 맥: `desktop/QuickText.swift`
  - 아이폰: `ios/OneTop/Model/DemoUsage.swift`
  - 안드로이드: `mobile/modules/composer-reset/`, `mobile/src/` 새 파일들
  - 사이트: `site/app.html`, `site/vite.config.js`, `site/scripts/dashboard-pages.mjs`, `site/scripts/check-site-zh.mjs`, `site/src/remote-*.js`, `site/src/demo-usage.js`
  - 데모·테스트: `scripts/demo-state.mjs`, 프론트엔드 테스트 6개
- 빠진 파일
  - 지운 파일: `site/src/cockpit.js`, `maps.js`, `maps.css`, `usage-maps.js`, `zh.js`, `session-mailbox.js`, `tests/cockpit.mjs`
  - 랜딩 세션 몫으로 넘긴 파일: `site/src/landing.js`, `landing-v6.css`
- 동결하지 않았지만 프론트엔드가 고친 백엔드 쪽 파일입니다. 소유는 Codex이니 검토하고 필요하면 고쳐 주세요.
  - `agent/onetop/server.py`: 정적 파일 허용 목록에 `/quick.html`, `/quick.js`, `/quick.css` 추가
  - `agent/onetop/windows_runtime.py`: 트레이 근처 위치, 모니터 영역·배율, 작업 표시줄에서 숨기기
  - `agent/onetop/windows_text.py`(새 파일): 시작 실패·WebView2 안내 3개 언어
  - `desktop/windows/main.py`: 트레이 퀵뷰, 트레이 메뉴, 로그인할 때 실행(`--quick-view`)
  - `scripts/windows-smoke.py`: 퀵뷰 확인
  - CI 워크플로 2개

## 2. 이번에 바뀐 것 (사용자 요구: 앱·웹·윈도우·휴대폰이 같게 보이고 같게 작동)

1. **1top.si/app**
   - 앱 대시보드(`agent/onetop/dist`)를 그대로 씁니다. 웹 전용 대시보드는 지웠습니다.
   - `site/src/remote-app.js`가 대시보드의 `/api/*` 요청을 받아, relay snapshot을 앱 `/api/state` 모양으로 바꿔 답합니다(`remote-adapter.js`).
   - 체험 화면(`/app?demo`)도 같은 인터페이스의 데모 relay(`remote-demo.js`)를 거칩니다.
   - 컴퓨터 연결 해제는 '컴퓨터 리소스'의 컴퓨터 카드에 있습니다(relay `/api/devices/revoke`).
2. **세션 대화**: 앱 대시보드 세션 상세에 모바일과 같은 대화 기능을 넣었습니다(`conversation.js`, 계약 v1.2.0). 앱·웹·데모가 같은 코드를 씁니다.
3. **언어 버튼**
   - 모든 화면에서 버튼 하나를 누를 때마다 한 → EN → 中으로 바뀝니다. 드롭다운은 쓰지 않습니다(사용자 지시).
   - 1top.si 공개 페이지에도 중국어를 넣었습니다(`t(en,ko,zh)`).
4. **윈도우 트레이 퀵뷰**
   - 왼쪽 클릭이면 맥 메뉴 막대 패널과 같은 퀵뷰(`dist/quick.html`)가 뜹니다.
   - 트레이 메뉴와 창 제목('1top — 이 PC')은 3개 언어입니다.
   - 로고는 공식 브랜드 마크입니다.
5. **맥 퀵뷰**: 윈도우 퀵뷰와 같은 테마·언어 버튼을 넣었습니다. 퀵뷰·메뉴·확인창이 3개 언어로 나옵니다.
6. **'다시 연결'**: 맥이 아닌 곳에서는 '다시 로그인' 버튼이 그 계정의 공식 로그인 창을 엽니다(`app.js`). 백엔드는 맥에서만 macOS 승인 방식의 다시 연결을 지원하기 때문입니다.
7. **휴대폰 4.3.0**: iOS 4.3.0(7), Android 4.3.0(11)입니다.
   - Android를 아이폰 배치에 맞췄습니다.
   - 체험 데이터, 다계정 번호, 언어 버튼을 두 앱에서 같게 했습니다.
   - 같은 세션 연속 전송은 HTTP 접수까지 FIFO로 보냅니다(`b0b8430`).
   - Android 키보드가 보낸 단어를 다음 메시지에 되살리지 않게 했습니다(`mobile/modules/composer-reset`).
   - Android 키보드가 작성창을 가리던 문제도 고쳤습니다(`de10cb3`).
8. **데모 데이터**
   - 웹·아이폰·안드로이드·퀵뷰가 같은 시드 생성기를 씁니다. 실제 사용 모양을 따릅니다: 몰림과 휴식, 긴 꼬리, 한쪽으로 쏠린 AI 비중.
   - `scripts/demo-state.mjs`는 실제 수집기 `/api/state`의 키 524개를 모두 냅니다. 키 목록은 `tests/collector-keys.json`에 고정했습니다.
   - 계정 한도 창 %는 실제처럼 정수입니다.
9. **번역**: 수집기가 보내는 한국어 원문(계정 메모, 터미널 안내, 제어 결과 등)을 영어·중국어로 번역합니다. `tests/i18n-collector.mjs`가 `agent/onetop/*.py`의 원문 116개를 검사하므로, 백엔드에서 화면 문구를 추가하면 이 테스트가 잡습니다. `i18n.js`에 영어·중국어를 함께 넣어 주세요.

## 3. 백엔드 할 일

### P0 — 4.3.0 배포를 막는 일

1. **프론트엔드 병합**: `git merge awesomezun/frontend-redesign`을 하고 동결 목록을 확인합니다.
   - `server.py` 허용 목록과 `.github/workflows/checks.yml`이 겹칠 수 있습니다. 프론트엔드 테스트 줄은 모두 살려 주세요.
2. **정적 파일 허용**: `server.py` 허용 목록에 `/conversation.js`, `/quick.html`, `/quick.js`, `/quick.css`가 있어야 합니다. 없으면 설치판에서 대화 칸이 빠지고 윈도우 퀵뷰가 빈 화면이 됩니다.
3. **`POST /api/mailbox`**: 앱 대시보드의 대화 기록 읽기 경로입니다. 이 경로가 없으면 로컬 앱의 대화 칸이 나오지 않습니다.
   - 받는 값: `{session_id, control_key}`
   - 요청 조건: `/api/action`과 같은 X-Monitor-Token과 Origin 확인
   - 돌려줄 값: `Controller.read_mailbox` 결과 그대로 `{ok, messages}`, 오류는 ActionError 상태 코드
4. **대기 메시지 전달**: `flush_mailbox`가 relay 연결 루프에서만 돕니다. relay에 연결되지 않은 컴퓨터에서도 앱에서 보낸 대기 메시지가 전달되도록 수집기 루프에서 약 3초마다 돌려 주세요.
5. **윈도우 실제 확인**: windows-release 워크플로를 실제 윈도우에서 돌려 주세요.
   - 스모크 결과로 퀵뷰 준비 상태, 행 수, 연결 문구, 창 제목을 확인합니다.
   - 확인할 점:
     - 트레이 클릭 위치(100%·150% 배율, 다중 모니터, 작업 표시줄 위·왼쪽)
     - 작업 표시줄·Alt+Tab에서 퀵뷰가 빠지는지
     - 바깥을 누르면 닫히는지
     - 원형 전환이 되는지
     - 두 창의 언어·테마 동기화
     - 로그인할 때 실행

### P1 — 1top.si/app이 앱과 같게 작동하도록 relay에 필요한 값

전체 표는 `/Users/kang/orca/workspaces/1top/frontend-redesign/output/site-parity_v2.0.0/codex-needs.md`(16건)에 있습니다. 웹 전용 대체 화면은 만들지 않았고, 값이 오면 어댑터가 바로 읽도록 맞추겠습니다. 우선순위는 다음과 같습니다.

1. 기간 슬라이더 전 기간(24시간 초과 포함)의 세션 windows, flow bins, estimate. 지금은 24시간을 넘으면 토큰 흐름이 비어 있습니다.
2. `protocol.ts` `AgentSession`에 `effort`를 허용해 주세요. `bridge.py`는 보내지만 relay가 버립니다.
3. 소진 속도 다이얼용 calibration의 `seconds`, `used_pp`, `tokens`
4. host의 network, disk, swap, load, uptime, 프로세스 수
5. 세션 상세의 60초·5분 사용량, 출력 속도, 흐름
6. 원격 `/api/history`
7. relay action `rename`과 계정 이름 수정
8. 나머지

Goal 내용(#7)과 계정 표시 이름(#15)은 개인정보 범위를 정해야 하니 제안만 주세요.

### P2 — 선택

- 로컬 `/api/state` 세션에 bridge와 같은 `capabilities`를 넣어 주세요. 지금은 `conversation.js`가 같은 규칙을 따로 갖고 있습니다.

## 4. 배포 4.3.0

- 휴대폰 버전은 iOS 4.3.0(7), Android 4.3.0(11)입니다. 데스크톱(맥·윈도우)도 4.3.0으로 맞추는 것을 제안합니다.
- 설치 파일을 만듭니다.
  - 맥: 서명·공증 DMG
  - 윈도우: 워크플로 산출물
  - Android: 서명 APK/AAB
  - iOS: 아카이브
- **올리는 일은 사용자 승인 뒤에 합니다.** `main`의 `release.json` 갱신, 스토어 제출, 1top.si 배포가 여기에 해당합니다.
- 랜딩 v7(랜딩 세션, `/Users/kang/orca/workspaces/1top/landing-v7.0.0`)은 새 배포본의 `release.json`이 `main`에 올라온 뒤 함께 공개합니다. 올라오면 프론트엔드에 알려 주세요.

## 5. 검증

- 노드 테스트(CI `checks.yml`의 줄 그대로)
- `site/scripts/check-zh.mjs`, `site/scripts/check-site-zh.mjs`
- `python -m unittest discover -s tests -q`
- `python3 tests/dashboard-browser.py`(16개 항목)
- Swift 검사 세 줄(`ModelChecks`, `desktop/*.swift` 컴파일, `QuickTextChecks`)
- 모바일 테스트: `mobile/test/*.test.mjs`, iOS 단위·UI 테스트

## 6. 완료 보고에 넣어 주세요

- 병합 커밋, 동결 확인 결과(106개 OK 여부)
- P0 각 항목의 커밋과 테스트 결과, 윈도우 스모크 결과
- P1에서 끝낸 항목과 relay 계약 문서의 새 버전 파일
- 만든 설치 파일 경로와 버전
- 보고는 한국어로, Orca 메시지와 함께 터미널에도 남겨 주세요.
