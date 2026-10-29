# iPhone 네이티브 앱 기능 대조 v1.0.0

기준은 Expo 모바일 앱 v1.5.0입니다(`mobile/src/ui.tsx`, `workspace.tsx`, `mailbox.tsx`, `connection.ts`, `metrics.ts`). 비교 대상은 새 SwiftUI 앱(`ios/`, 4.0.0 빌드 3)입니다. API만 있고 화면이 없는 기능은 보존으로 치지 않았습니다.

## 누락 원인

새 iPhone 앱을 만들면서 Claude(프론트엔드)가 맥 메뉴바 간략보기를 대시보드 탭으로 옮기는 데만 집중했습니다. Expo 앱의 나머지 화면은 옮기지 않았습니다. 세션 상세 시트, 메시지함, 작업 제어와 AI 지시, 사용량 비율 지도, 연결 서버 변경, 언어 전환, Goals·Skills, 링크가 여기에 해당합니다. 세션·한도·설정 탭은 목록만 보여 주는 얇은 화면이었습니다. 앱 모델도 문제였습니다. 실시간 소켓의 `result`, `mailbox`, `offline`, `removed` 메시지를 처리하지 않았고, 소켓을 보관하지 않아 `mailbox_request`를 보낼 수 없었습니다. 그 결과 원격 명령, 메시지, 결과 확인이 사라졌습니다. 대조표를 만들지 않고 대시보드 포트를 완료로 본 것이 원인입니다. 이번 판에서 아래 표의 기능을 모두 다시 넣었습니다.

## 대조표

검증 열의 캡처는 `output/ios-parity_v1.0.0/`에 있습니다. 데모 데이터는 컴퓨터 2대, 세션 10개입니다.

| 기능 | 기존 Expo 경로 | 새 iOS 경로 | 검증 방법·결과 | 상태 |
|---|---|---|---|---|
| Google 로그인(1top.si/mobile-connect, SHA-256 challenge, `onetop://connected`) | `connection.ts` `signIn`, `ui.tsx` `SignIn` | `WelcomeView.signIn`, `Relay.signInRequest`, `AppModel.finishSignIn` | 실기기에서 로그인·실시간 연결 확인(이전 빌드 2) | 유지 |
| 체험 화면 | `SignIn` "체험 화면 보기", `demo.ts` | `WelcomeView` "체험 화면 보기", `DemoData`(컴퓨터 2대, 메시지 예시 포함) | 캡처 01–08 | 복구·보강 |
| 원격 연결 안내, 데스크톱 다운로드 링크(로그인 전) | `SignIn` | `WelcomeView` 안내문, "데스크톱 다운로드 ↗" | 캡처 12 | 복구 |
| EN/KO 언어 전환 | `workspace.tsx` `ko`, `SignIn`·`Settings` 버튼 | `Model/Language.swift`(`L.t`), 시작 화면·워크스페이스의 언어 선택. 바꾸면 화면 전체를 다시 그림 | 캡처 09–10(영어) | 복구 |
| 자체 relay 변경(로그아웃 상태에서만, HTTPS origin 검사, 확인 단계) | `RelaySettings`, `connection.ts` `relayOrigin`·`selectRelay` | `RelaySettings`(워크스페이스·시작 화면 "연결 서버"), `Relay.origin`·`select`·`current` | 빌드 확인. 로그인 중에는 입력이 비활성. 토큰은 승인한 relay와 함께 키체인에 저장되어 다른 relay로 가지 않음 | 복구(다른 relay 실연결은 미검증) |
| 연결 상태 배지 | `Shell` 배지 | 대시보드 머리말, 워크스페이스 `ConnectionBadge` | 캡처 01, 05 | 유지 |
| 컴퓨터 선택과 "모든 컴퓨터" | `Shell` `Picker` | `ComputerPicker`(대시보드 ⋯ 메뉴, 세션·사용량·한도 툴바), 워크스페이스 컴퓨터 목록. 기본값은 모든 컴퓨터 | 캡처 01("모든 컴퓨터 · 2"), 05 | 복구 |
| 모든 컴퓨터 집계 | `workspace.tsx` `visible`·`rows` | `AppModel.reportingDevices`: 기간 합계 합산, 흐름 구간(같은 간격일 때) 합산, 계정 한도 중복 제거, CPU·메모리는 컴퓨터별 | 캡처 01: 두 컴퓨터의 세션·한도·자원 표시 | 복구 |
| 재연결 버튼과 연결 오류 문구 | `Shell` 연결 카드 "다시 연결" | `ConnectionNotice`(대시보드·세션·사용량·한도), 워크스페이스 "다시 연결", ⋯ "지금 다시 연결", 당겨서 새로고침 | 빌드 확인(데모에서는 표시되지 않음) | 복구 |
| 오프라인 시각·수신 시각 | 세션 카드 수신 시각, `Shell` 안내 | 세션 행 "마지막 보고 HH:mm", 연결 안내의 마지막 보고, 컴퓨터 목록 "오프라인 · 마지막 보고", 세션 상세 "수신 시각" | 캡처 05, 07 | 복구 |
| 알림 문구(탭하여 닫기) | `Shell` `w.message` | `ConnectionNotice`(연결 중일 때 탭하여 닫기) | 빌드 확인 | 복구 |
| 세션 수·작업 중 수, 작업 중 먼저 | `Sessions` 통계, `sortSessions` | `SessionsView` 통계와 두 구역. 보고가 끊긴 컴퓨터의 세션은 작업 중으로 세지 않음 | 캡처 02 | 유지·보강 |
| 세션 카드(상태, 도구·모델, 앱·터미널, 컴퓨터, 속도, 수신 시각) | `Sessions` 카드(`tok/s`) | `SessionRow`: 상태 모양+글자, 기간 토큰, 지금 속도 **tokens/시간**, 컴퓨터·앱·터미널 | 캡처 02 | 복구(tok/s 제거) |
| 세션 상세 시트 | `SessionDetails` | `SessionDetail`: 대시보드·세션 탭에서 누르기, 길게 누르기 메뉴, 스와이프 "메시지함" | 캡처 06–07 | 복구 |
| 메시지함: 5초마다 읽기, 상태 7종, 답신, 긴 답신 표시, 보내기, 오류, 30초 지난 미확인 처리, 데모 답신 | `mailbox.tsx`, `connection.ts` `readMailbox` | `MailboxView`, `AppModel.readMailbox`(소켓 `mailbox_request`), `sendMessage`(`/api/action` `message`), `applyMailbox` | 캡처 06(질문·답신). 실기기 확인은 아래 참고 | 복구 |
| 결과 receipt | `connection.ts` `result` → `workspace.tsx` | `AppModel.applyReceipt`: 진행 표시 해제, "완료/실패 · 메시지", 메시지 상태 갱신. 상세 "결과" 구역 | 빌드 확인. 실제 명령은 보내지 않음 | 복구 |
| 컴퓨터에서 열기·일시정지·재개·CLI 종료와 확인 단계 | `SessionDetails` 버튼, `control()` `Alert` | 상세 "작업 제어", 길게 누르기 메뉴, 스와이프(왼쪽: 일시정지·재개, 오른쪽: CLI 종료). 모두 `controlConfirmation` 확인 후 실행. CLI 종료는 파괴적 스타일 | 캡처 07, 08(CLI 종료 확인: 컴퓨터·앱·터미널·프로젝트·유실 경고) | 복구 |
| AI 지시 보내기(4,000자, 글자 수, 입력 불가 안내, Aside 대기 안내, 확인에 300자 미리보기) | `SessionDetails` 지시 입력 | 상세 "이 AI에게 지시하기", `AppModel.control(action: "prompt")` | 캡처 07 | 복구 |
| 제어 조건(최신 보고 20초, 실시간 연결, capability, 진행 중 1건), 25초 결과 미확인, 데모 미전송 | `workspace.tsx` `control` | `AppModel.canControl`, `control` | 빌드 확인 | 복구 |
| 누적 토큰 | 상세 제어 탭 | 상세 "보고된 누적 토큰", 기간 토큰, 지금 속도, 상태 | 캡처 07 | 복구 |
| 사용량 비율(기간, 합계, 세션·앱·도구·모델 분류, 면적 지도, 영역 상세, 보고/미보고/0 수) | `Usage`, `Map`, `metrics.ts` `usage`·`layout` | `UsageView`(같은 분할 알고리즘, 같은 팔레트), 사용량 탭 | 캡처 03, 10 | 복구 |
| 플랜 한도(계정·플랜·컴퓨터, 창별 %·막대·초기화, 업데이트 시각, 빈 상태, 안내) | `Accounts` | `LimitsView`: 같은 계정은 한 번, 보고한 컴퓨터 이름 나열. 오래된 값은 경과 시간("N분 전 보고") | 캡처 04 | 복구·보강 |
| 계정 카드(데모/관리자/연결된 계정), 원격 크레딧 안내 | `Settings` | 워크스페이스 "계정" | 캡처 05 | 복구 |
| Goals·Loops·Skills(플랫폼·CPU·RAM, 설치된 스킬, 관측 이벤트, goal 목록, loop 미검증 안내) | `Settings` 컴퓨터 카드 | 워크스페이스 컴퓨터별 "Goals · Loops · Skills" 구역(`snapshot.operations`) | 캡처 05 | 복구 |
| 데스크톱 앱 다운로드·개인정보 링크 | `Settings` | 워크스페이스 링크 | 캡처 05 | 복구 |
| 로그아웃·체험 종료 | `Settings` | 워크스페이스 | 캡처 05 | 유지 |
| 버전 표시 | `Settings` "v1.2.0"(하드코딩) | 워크스페이스 맨 아래 "1top iPhone · 4.0.0 (3)"(Bundle 값) | 캡처 05 | iOS 정상. Expo 하드코딩은 Android 쪽에서 수정 |
| 기간 합계 | — | `AppModel.periodTokens`가 각 컴퓨터 `snapshot.periods[].tokens` 합을 씀(없을 때만 세션 합). 종료된 세션 사용량이 빠지지 않음 | 빌드 확인 | 수정 |
| 주간 % 환산 가능 판정 | — | `Session.hasEstimate`: 빈 `{}`가 아니라 유효한 `used_pp` 숫자가 있어야 % 모드 | 빌드 확인 | 수정 |
| 오래된 한도 값 | — | `Format.reportAge`: 방금 보고 / N분 전 보고 / N시간 전 보고 / N일 전 보고(맥 `reportAge`와 같은 규칙). 대시보드 타일과 한도 탭 아래 설명 | 실기기 캡처 20·22("1h ago", "1시간 전 보고") | 수정 |
| 색과 상태 모양 | — | 계기판 숫자·빔·최신 구간·CPU·메모리 막대는 액정 초록(다크 #9dff3c/#e2ffc4, 라이트 #6aa800/#3d6300). 작업 중은 액정 초록 3막대 파형(동작 줄이기면 정지), 확인 필요는 앰버 마름모, 일시정지는 두 막대, 그 외는 빈 원. 상태 글자는 잉크·뮤트색 | 캡처 01, 02, 11 | 수정 |
| 계정 재연결 필요 | — | `Quota.status`가 `login_required`, `login_expired`, `credential_store_unavailable`, `access_denied`이고 stale이면 "재연결 필요"/"Reconnect needed"(b179d59와 같은 규칙) | 빌드 확인 | 수정 |
| 여러 컴퓨터의 흐름 합산 | — | `AppModel.flow`: 실제 시각으로 맞춤. 축 끝은 모든 컴퓨터가 보고한 `min(end)`이고, 어느 컴퓨터든 덮지 못한 구간은 미확인(nil)으로 그리지 않음. step이 다르거나 start가 없으면 중첩 기간 합계로 돌아감(`fleetFlow`, cockpit `reading`과 같음) | 빌드 확인 | 수정 |
| 원격 제어 없이 연결된 컴퓨터 | — | `/api/devices`의 `allow_control`이 0/false인 기기 id를 기억합니다(`AppModel.controlOff`). 그 컴퓨터의 세션은 capabilities를 비워 제어·지시·메시지를 보이지 않습니다. 상세에는 "이 컴퓨터는 원격 제어 없이 연결되었습니다." 안내만 둡니다(Android f4cddcb와 같은 방식) | `output/ios-qa/sim/07-control-off.png`(`test07`) | 수정 |
| 메일함 응답 대조 | `connection.ts` `mailboxAsk` | 가장 최근 `mailbox_request`의 request_id·device_id·session_id가 모두 같을 때만 `mailbox` 응답을 반영합니다. 재연결하면 초기화합니다 | 빌드 확인 | 수정 |
| 대시보드 상단 겹침 | — | 머리말을 `safeAreaBar`로 고정하고 `scrollEdgeEffectStyle(.hard, for: .top)`을 적용. 스크롤해도 상태 막대 밑으로 내용이 비치지 않음 | `output/ios-qa/sim/06a-top.png`, `06b-scrolled.png` | 수정 |

## 실기기 확인

iPhone 15 Pro Max(00008130-000845A93A80011C)에 4.0.0 빌드 3(DEBUG)을 설치했습니다. 실제 relay 데이터로 다음을 확인했습니다.

- 대시보드(캡처 20 영어, 22 한국어): 실시간 · Mac.lan, 평균 속도, 모델별 비중(종료된 세션 포함), 계정 4개
- 오래된 Claude 한도: "1시간 전 보고" / "1h ago"
- CPU·메모리 액정 초록 막대, 세션 34개 중 작업 중 6개(3막대 파형)
- 세션 탭(캡처 21): 101개 세션, 컴퓨터·앱, tokens/시간
- 세션 상세(캡처 23): 실제 세션 "1top-프론트엔드"의 메시지함이 열렸습니다. 메시지 연결 불가 경고가 없으므로 relay가 그 세션의 `mailbox` capability를 보내고 있습니다.

### UI 테스트로 실기기 화면 누르기

`ios/OneTopUITests/DeviceQATests.swift`(XCUITest)가 실기기에서 화면을 누르고 단계마다 스크린샷을 남깁니다. 증거와 실행 방법은 `output/ios-qa/README.md`에 있습니다.

| 항목 | 테스트 | 결과 | 증거 |
|---|---|---|---|
| 설치·실행·실시간 연결 | `test01_InstallLaunchLive` | 통과 | `device-01-05/01-launch-live.png` |
| 로그인 유지(앱 재실행 후 키체인 토큰) | `test02_SignInSurvivesRelaunch` | 통과 | `device-02/02a`, `02b` |
| 실시간 갱신(40초 안에 새 보고 시각) | `test03_LiveReportsKeepArriving` | 통과 | `device-01-05/03a`, `03b` |
| 재연결(⋯ → 지금 다시 연결 → 실시간 복귀) | `test04_Reconnect` | 통과 | `device-01-05/04a`–`04c` |
| 탭 4개, 실제 세션 상세(메시지함·작업 제어), 확인 시트 열고 닫기 | `test05_ScreensAndConfirmation` | 통과(두 번째 실행). 첫 실행은 iOS 26 팝오버형 확인 시트를 닫지 못해 실패했고, 팝오버 닫기 영역을 누르도록 고쳤습니다. 닫은 뒤 결과 줄 없음, 즉 아무것도 보내지 않았습니다 | `device-01-05/05a`–`05h`, `device-05/05h`, `05i` |
| 대시보드 스크롤 시 상태 막대 겹침 | `test06_DashboardScrollEdge`(시뮬레이터 데모) | 통과 | `sim/06a`, `06b` |
| 질문/답변 | `test11` | 통과. 시험 세션(Codex `01a186e4…`)에 보낸 질문에 'Ready for mobile QA.' 답신이 메시지함에 도착했습니다 | `device-full/11a`–`11c` |
| 지시, 일시정지, 재개, 종료, receipt | `test10`, `test12`–`test14` | 통과(2026-10-29 05:32–05:33). receipt는 순서대로 '완료 · AI 지시를 보냈습니다', '완료 · 작업이 멈춘 것을 확인했습니다', '완료 · 이어서 작업하는 새 요청을 보냈습니다', '완료 · CLI 종료를 확인했습니다'였고, 상태가 작업 중 → 일시정지 → 재개 중 → 중단됨으로 바뀌었습니다. 앞선 두 번의 실행에서 고친 점: 확인 창이 키보드에 가려지던 문제(28c366a), 결과 줄이 화면 밖에 있던 문제(0a22a32). 일시정지는 세션이 작업 중일 때만 제공되므로 지시를 'sleep 150 후 OK'로 바꿔 작업 상태를 유지했습니다. 제어는 QA 보호(-qaGuard, -qaSession)로 시험 세션에만 보냈습니다 | `device-controls3/`, `sheet-controls3.jpg` |

안전장치를 두었습니다.

- 테스트는 앱을 `-qaGuard YES -qaSession <id>`로 실행합니다.
- DEBUG 앱은 이때 그 id가 아닌 세션에 제어나 메시지를 보내지 않습니다. 확인 시트를 실수로 눌러도 네트워크 요청 전에 막힙니다.
- 실제 사용자 세션에는 어떤 제어도 보내지 않았습니다.
- 첫 실행 중 확인 시트가 열린 채 실패한 세션은 "1top-프론트엔드"입니다. 열려 있던 것은 "컴퓨터에서 열기" 확인이었고, 누르지 않았습니다.

두 번째 실행 중 사람이 기간 선택을 눌러 일부 탭 화면이 섞였습니다. 그 캡처는 지웠고, 첫 실행의 같은 단계 캡처를 증거로 씁니다.

이 Mac의 로컬 `/api/state` 세션에는 `capabilities` 필드가 없습니다. capability는 relay로 보내는 `bridge.py` 스냅숏에서만 계산되므로 정상입니다.

## Codex 계약 답변(반영 완료)

1. 원격 제어 허용 여부는 `/api/devices`의 `devices[].allow_control`로 판단합니다. 실시간 스냅숏에는 없으므로 기기 id로 대조합니다.
2. `1top.si/mobile-connect?relay=<자체 HTTPS origin>`을 지원합니다. 사이트가 origin 변경 동의 화면을 먼저 보여 줍니다. 토큰을 relay와 묶어 섞지 않는 지금 설계를 유지합니다.
3. 메일함 응답은 가장 최근 요청의 request_id·device_id·session_id로 대조합니다.
4. `snapshot.periods`에는 종료된 세션이 포함됩니다. quota id는 컴퓨터 사이에 같고, `quota.updated`는 Unix 초입니다.
