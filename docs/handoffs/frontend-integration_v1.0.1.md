# 1top 프론트엔드 기술 인수인계 v1.0.1

## 담당 범위

프론트엔드와 디자인은 Claude가 담당한다. **디자인 판단은 Claude에게 전적으로 맡긴다.** 이 문서는 디자인 제안서가 아니며, 현재 외형을 유지하라는 지침도 아니다. 코드 위치, 데이터 의미, 연결 규칙과 실행 방법만 기록한다.

Codex는 프론트엔드에서 빠진 상태다. 백엔드·수집 작업은 사용자가 별도로 맡길 예정이며, 이번 인수인계가 그 작업의 재개 지시는 아니다. 데이터 계약 변경이 필요하면 필요한 필드·단위·동작을 명시해 별도 조율한다.

## 이어받을 위치와 기준점

| 항목 | 확인한 값 |
|---|---|
| 실제 작업 디렉터리 | `/Users/kang/orca/workspaces/1top/claude-tracking-v3.9.0` |
| 브랜치 | `awesomezun/claude-tracking-v3.9.0` |
| 인수인계 기준 코드 | `6fcade9` — Add compact Boost cockpit and restore Claude percentage burn rates |
| 코드·설치 앱·실행 중 API 버전 | 모두 `3.26.2` |
| 설치 앱 | `/Users/kang/Applications/1top.app` |
| 로컬 대시보드 | `http://127.0.0.1:18766/` |
| 상태 API | `http://127.0.0.1:18766/api/state` |
| 기존 PR | https://github.com/awesomezun/1top/pull/12 |

작성 시 tracked 파일 변경은 없었고, 기존 `output/`만 untracked였다. `output/`에는 디자인 후보 등 이전 산출물이 있으므로 일괄 삭제하거나 함께 stage하지 않는다. 다른 작업자가 이후 변경했을 수 있으므로 시작 시 `git status`와 HEAD를 다시 확인한다. 대화의 기본 cwd인 `claude-statusline`은 위 구현 worktree와 다르다.

## 코드 지도

아래 경로는 실제 작업 디렉터리를 기준으로 한다. `agent/onetop/dist/`는 현재 직접 수정하는 HTML/CSS/JavaScript 소스이자 앱에 포함되는 정적 자산이다. 별도 React/Vite 빌드 결과를 덮어쓰는 구조가 아니다.

| 위치 | 역할 |
|---|---|
| `agent/onetop/dist/index.html` | DOM, 스타일·스크립트 로딩 순서 |
| `agent/onetop/dist/app.js` | API polling, 화면 렌더링, 기간·필터·정렬, 세션 제어, 계기판 Canvas |
| `agent/onetop/dist/dashboard.js` | 저장 설정, Edit, 패널·열 이동/리사이즈, 세션 소진율 표시 |
| `agent/onetop/dist/dashboard.css`, `style.css`, `typography.css` | 대시보드와 공통 스타일·서체 |
| `agent/onetop/dist/weekly.js` | 계정 한도 및 세션 퍼센트 환산의 프론트엔드 검증·계산 함수 |
| `agent/onetop/dist/speed.js` | 선택 기간의 전체 토큰 속도 계산 |
| `agent/onetop/dist/ranges.js` | 기간 key, 고정 단계, 언어별 라벨 |
| `agent/onetop/dist/i18n.js`, `effects.js` | 번역과 테마·언어 전환 동작 |
| `agent/onetop/dist/maps.js`, `maps.css` | 사용량 맵 |
| `desktop/OneTop.swift` | macOS 앱 수명주기·창·웹뷰 |
| `desktop/QuickDashboard.swift`, `DashboardModel.swift` | 메뉴막대 간략보기와 별도 Swift 데이터 해석 |
| `desktop/CompactUsageFlow.swift`, `CompactTokenMap.swift` | 간략보기의 그래프·맵 |
| `mobile/src/` | 별도 모바일 UI. 수정할 경우 먼저 `mobile/AGENTS.md` 확인 |

웹 대시보드, Swift 간략보기, 모바일은 별도 소비자다. 웹의 표시 함수를 바꿔도 나머지 화면이 자동으로 바뀌지는 않는다. 새로운 디자인은 자유롭게 구성하되, 기존 함수와 DOM 연결을 함께 교체해야 한다. 단순히 element ID만 제거하면 `app.js` 초기화·polling이 중단될 수 있다.

## 데이터 계약

상태 요청은 현재 3초마다 수행한다. `updated`는 Unix 초이며, `ready`, `error`와 함께 연결 상태 판단에 쓰인다. 기간을 바꾸는 동안 도착한 이전 요청 결과는 현재 선택을 덮어쓰지 않도록 폐기한다.

| 필드 | 의미와 사용 시 주의점 |
|---|---|
| `sessions` | 개별 세션. 모델은 `model`, 보고된 reasoning effort는 `effort` |
| `root_sessions` | 부모와 하위 세션의 사용량을 합친 목록. `children_ids`, `children_count` 포함 |
| `tokens`, `usage.windows[key]` | `[fresh input, cache read, cache write, output]` 순서의 토큰 벡터 |
| `usage.rate` | 현재 세션 토큰 속도. 내부 단위는 **tokens/s**. 수집기는 최근 최대 60초의 기록으로 산출 |
| `usage.weekly_account` | 현재 연결된 계정 식별자 |
| `usage.weekly_estimate[key]` | 선택 기간의 주간 한도 환산값과 기준. 실제 제공자의 세션별 청구 내역은 아님 |
| `account_quotas` | 계정별 제공자 한도 보고. `windows` 중 `label === '주간'`을 주간 한도에 사용 |
| `weekly_usage.accounts` | 계정 한도 이력·기간별 변화·환산 기준 `calibration` |
| `period_usage.windows` | 선택 기간의 전체 및 제공자별 기록 토큰. 전체 속도계의 분자는 이 합계를 사용 |
| `workspace_usage.devices` | 연결 컴퓨터의 기간별 숫자 집계. 해당 `received`는 밀리초이므로 로컬 `updated`와 단위가 다름 |
| `system.host`, `resources` | 컴퓨터 전체 자원과 개별 세션 프로세스 자원 |

### 서로 다른 두 속도

- **전체 토큰 사용 속도:** `OneTopSpeed.measure(data, selectedPeriod)`의 `rate`는 tokens/s다. 표시할 때 한 번만 `× 3600`하여 **tokens/시간**으로 만든다. 선택 기간 토큰 합계 ÷ 기간 길이로 계산하며, 세션 태그 필터로 전체 값이 바뀌지 않는다.
- **세션 소진 속도:** `OneTopWeekly.sessionBurn(...)`는 **주간 한도의 %/시간**을 반환한다. 이 반환값에 다시 3600을 곱하지 않는다. 현재 토큰 속도 × 같은 계정의 `used_pp / tokens` × 3600이다.
- 선택 기간의 누적 한도 사용량과 현재 세션 소진 속도는 다른 측정값이다. 둘을 같은 값으로 대체하지 않는다.
- 부모 합계와 자식 행을 다시 더하면 중복된다. 전체 토큰 집계는 `period_usage`를 쓰고, 계정별 퍼센트는 분모가 다르므로 서로 더해 전체 속도로 만들지 않는다.

### 실제 0과 미확인

`null` 또는 누락은 측정값 0이 아니다. 토큰 보고가 있고 현재 측정 속도가 정확히 0이면 `0%/시간`을 표시할 수 있다. 유효한 양의 환산 기준이 없으면 숫자를 만들지 않고 미확인으로 둔다. 세션 소진 속도 칸을 `tokens/시간`으로 바꾸는 fallback은 제거된 상태다.

계정 연결은 모델명이 아니라 확인된 계정 식별자를 따른다. Aside의 실행 앱과 결제 제공자는 별개이며, 명시된 제공자 계정 ID를 기존 모니터링 계정에 연결한다. 이전 미귀속 토큰을 실제 결제 계정이 확인된 기록처럼 다시 쓰지 않는다.

### Claude 환산 수정의 현재 상태

`weekly_usage.py`는 토큰 기록과 제공자 퍼센트 보고가 늦게 도착할 수 있음을 처리한다. 계정이 확인된 연속 구간의 토큰과 뒤이어 보고된 퍼센트 증가를 연결하되, 데이터 공백·미귀속 이벤트·reset·정정 구간을 건너 연결하지 않는다.

정정 이후 새 양의 기준이 없을 때는 정정에 영향받지 않은 동일 계정·동일 주기의 이전 정상 구간을 사용할 수 있다. 기존 최대 1일 및 reset 만료 조건은 유지한다. `weekly.js`도 계정·source·reset·만료를 검증하므로 숫자를 표시하기 위해 이 검증을 제거하지 않는다. stale 한도 보고 자체를 새 보고로 바꾸는 기능은 아니다.

## 기간·저장 설정·기존 동작

기간 key는 `10m`, `30m`, `1h`, `5h`, `12h`, `24h`, `custom:<초>`, `all`을 사용한다. 긴 기간과 전체 기록은 `/api/state?period=...`로 요청한다. 고정 단계는 `ranges.js`의 `stops`가 기준이며 총 19개다. `all`은 보존된 전체 기록을 뜻한다.

표시 설정은 localStorage의 `onetop.dashboard.v1`에 있다. 주요 항목은 `theme`, `lang`, `period`, `columns`, `widths`, `panels`, `spans`, `heights`, `instrumentWidth`이며, `rangeScale: fixed-v1`, `cockpit: boost-v1`은 기존 migration 식별자다. 새 구조로 바꿀 때는 사용자 설정을 전부 지우기보다 필요한 항목을 명시적으로 이행한다.

유지해야 할 기능상의 연결은 다음과 같다. 이것은 디자인 배치 지시가 아니다.

- 기본 목록 순위는 선택 기간 사용량 기준이며, polling마다 순서를 바꾸지 않도록 최대 60초 유지한다. 기간·필터·정렬 변경은 즉시 반영한다.
- 태그는 선택·해제가 가능하고, 순서는 세션의 선택 기간 사용량 순위를 따른다.
- 하위 세션은 기본적으로 접혀 있으며, polling 중 사용자가 펼친 상태를 유지한다.
- 열 너비 조절과 열 이동은 다른 입력 경로다. 크기 조절 중 DOM을 옮겨 pointer capture를 잃지 않게 한다.
- 모델 effort는 실제 보고값을 표시한다. 모델별로 값이 다르므로 공통 단계표를 임의 적용하지 않는다.
- 한도 그래프의 절대 퍼센트와 선택 기간 증가분을 혼용하지 않는다. 최신 한도 100%와 그래프 끝값이 서로 다른 지표가 되지 않도록 데이터 의미를 구분한다.

## 제어 API

`POST /api/action`은 `Content-Type: application/json`, `X-Monitor-Token: data.action_token`을 사용한다. 기본 payload는 `action`, `session_id`, `control_key`, 새 `request_id`다. 지원 동작은 `focus`, `pause`, `resume`, `terminate`, `rename`; rename에는 `title`이 추가된다.

현재 활성화 조건은 `app.js`의 `actions()`, 요청 처리는 `prepareAction()`, `sendAction()` 및 rename handler를 참고한다. 그룹 행의 제어 대상은 실제 부모 세션이며 자식 전체에 명령을 보내는 뜻이 아니다. action token은 상태를 받은 실행 중 수집기의 값이고, 파일·문서·스크린샷에 하드코딩할 값이 아니다. 타임아웃이 났다고 같은 제어 요청을 자동 재전송하지 않는다.

계정 로그인은 별도 `POST /api/accounts/login`이다. UI QA 때문에 실제 로그인이나 실행 중인 AI 세션의 정지·재개를 호출할 필요는 없다. 아래 브라우저 테스트는 제어 요청을 mock 처리한다.

## 검증 방법과 증거

작업 디렉터리에서 실행한다. 프론트엔드 변경 범위에 맞는 검증을 선택한다.

```sh
node tests/speed.mjs
node tests/session-groups.mjs
node tests/dashboard-gauges.mjs
node tests/ranges.mjs
node tests/weekly.mjs
python3 tests/dashboard-browser.py
```

`dashboard-browser.py`는 실행 중인 로컬 API에서 읽기 전용 snapshot을 가져온 뒤, **수정 중인 source assets**와 mock API를 별도 포트에서 서비스한다. 실제 제어 POST를 앱으로 전달하지 않는다. 현재 시스템 Python에 Playwright가 설치되어 있다. 이미지·레이아웃을 변경하면 예전 외형을 검사하는 assertion과 screenshot 버전도 새 작업에 맞게 갱신한다. 예전 screenshot의 버전을 최신 설치 증거로 제시하지 않는다.

백엔드 회귀 검증 명령은 다음과 같다. 이번 프론트엔드 인수인계에서 백엔드를 바꾸라는 의미는 아니다.

```sh
PYTHONPATH=agent /Users/kang/orca/projects/1top/.venv/bin/python -m unittest discover -s tests
```

직전 검증의 증거 파일은 아래와 같다. 인수인계 작성 중 테스트를 다시 실행한 것은 아니다.

- `build/python-tests-v3.26.1.log`: 최종 계산 로직의 Python 테스트 293개 통과. v3.26.2에서는 프론트엔드 밀도·곡선과 버전만 추가 변경했다.
- `build/dashboard-browser-v3.26.2.json`: 브라우저 기능·저장 설정·언어·테마·좁은 화면 검증, page error 없음.
- `build/installed-verification-v3.26.2.json`: 설치 앱/API 버전, source와 제공 자산의 SHA-256 일치, 실제 Claude 환산 확인.
- `build/dashboard-default-v3.26.2.png`: source preview이며 설치 앱 캡처와 구분한다.

## 빌드와 실제 앱 반영

source 파일만 고쳐서는 이미 설치된 앱의 내장 자산이 바뀌지 않는다. 배포판의 두 버전 선언은 `agent/onetop/__init__.py`, `pyproject.toml`에 있다. 현재 마지막 설치 버전은 v3.26.2이며, 다음 변경은 변경 규모에 맞는 새 semantic version을 쓴다.

```sh
PYTHONPATH=agent \
ONETOP_PYTHON=/Users/kang/orca/projects/1top/.venv/bin/python \
ONETOP_MACOS_SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk \
scripts/build-macos.sh
```

결과는 `build/1top_v<version>/1top.app`이다. 스크립트는 같은 버전의 기존 앱이 있으면 중단한다. 기존 빌드와 산출물을 삭제해 덮어쓰지 않는다.

설치 순서는 새 앱 서명 검증 → 1top만 종료 → 로컬 수집기 종료 확인 → 기존 앱을 `~/Library/Application Support/1top/app-backups/`의 고유 버전 경로에 보존 → 새 앱 설치 → 절대 경로 `/Users/kang/Applications/1top.app`로 실행이다. 서명 검증은 `codesign --verify --deep --strict <앱 경로>`를 사용한다. 서명된 설치 번들 내부 파일을 직접 고치지 않는다.

마지막으로 실제 앱 화면, `/api/state`의 버전, 제공되는 JS/CSS와 source의 일치를 확인한다. 사용자 창 크기와 선택 기간을 검증 편의로 초기화하지 않는다. 현재 로컬 빌드는 ad-hoc 서명이며 공증된 공개 다운로드와 동일하지 않다. 홈페이지 공개 배포는 별도 결과로 구분한다.

## 백엔드 연결이 필요한 경우 참고할 위치

| 파일 | 책임 |
|---|---|
| `agent/onetop/server.py` | 수집 조립, 상태 snapshot, API |
| `agent/onetop/usage.py`, `time_ranges.py` | 토큰 이벤트와 기간 집계 |
| `agent/onetop/weekly_usage.py` | 계정 귀속·주간 한도 이력·환산 |
| `agent/onetop/accounts.py` | 계정 및 제공자 한도 보고 |
| `agent/onetop/aside.py`, `hierarchy.py`, `effort.py` | Aside 계정·세션 계층·보고된 effort |
| `agent/onetop/controls.py` | 실제 세션 제어 |
| `cloud/src/`, `agent/onetop/bridge.py` | 원격 연결과 컴퓨터 간 집계 경로 |

상태 데이터는 macOS에서 기본적으로 `~/Library/Application Support/1top/monitor.sqlite`에 저장된다. `ONETOP_DATA` 등으로 경로를 바꿀 수 있다. UI 문제를 해결하기 위해 실제 사용 이력 DB를 초기화하지 않는다.

아직 양의 변화가 관측되지 않은 계정, 식별되지 않은 세션, 집계에 포함되지 못한 연결 컴퓨터는 완전한 값이 아닐 수 있다. 이런 경우 필요한 백엔드 입력을 구체적으로 남긴다. 외형만 바꾸어 측정 완료처럼 표시하지 않는다. 실제 여러 물리 컴퓨터를 동시에 연결한 최종 검증과 공개 Mac 공증은 직전 로컬 앱 검증에 포함되지 않았다.
