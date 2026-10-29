# Codex 백엔드 인계 v1.0.0

작성: Claude (프론트엔드) · 2026-10-29 · 받는 쪽: Codex (백엔드·수집·빌드)

사용자 지시는 "Codex가 빌드하고 문제를 고쳐서 완성하되, 우리가 만든 프론트엔드를 그대로 두라"입니다. 두 에이전트가 충돌하지 않도록 아래 규칙을 지켜 주세요.

## 1. 시작점

| 브랜치 | 커밋 | 내용 |
|---|---|---|
| `awesomezun/frontend-redesign` | `db319c3` | 프론트엔드 전체 개편(Claude) |
| 같은 브랜치 | `c940ca8` | 세션 정렬(Codex가 이 작업 폴더에 남긴 변경을 Claude가 검토 후 커밋) |
| 같은 브랜치 | 이 문서가 포함된 커밋 | 계약서, 인계 문서, 프론트엔드 지문 목록, 시험 집계 스크립트 |
| 같은 브랜치 | 그다음 커밋 | 웹 표 정렬(작업 중 먼저, 나머지 전체를 선택 기간 토큰 순) |
| 같은 브랜치 | `21f8486`, `16a6124`, `99a2be6` | iPhone 네이티브 앱(`ios/`), Android 대시보드(`mobile/`). 지문 목록은 `frontend-freeze_v1.8.0.sha256`이 최신이며 `ios/`·`mobile/src/` 화면 파일과 1top.si 원격 대시보드(`site/src/main.js`, `site/src/cockpit.js`, `site/src/style.css`)를 포함합니다. 인증·릴레이 연결 파일(`ios/OneTop/Model/Relay.swift`, `mobile/src/connection.ts`)은 Codex가 고칠 수 있도록 제외했고, 고치면 변경 내용을 알려 주세요. |

`db319c3`에는 다음이 들어 있습니다.
- 웹 대시보드: 계기판, 디자인 시스템, 글자 역할 토큰, 확대·축소 대응, 차트 재설계, 사용량 맵의 히트맵과 모델별·프로젝트별 추이
- macOS 메뉴 막대 간략 보기: 개편, 앱 배율 연동

`c940ca8`의 내용은 다음과 같습니다.
- `agent/onetop/session_order.py`, `server.py` 2줄, `tests/test_session_order.py`, `desktop/DashboardModel.swift`의 `sortedSessions`, `tests/desktop/ModelChecks.swift`
- Claude가 검토했고, 단위 테스트 8개와 Swift 모델 검사가 통과했습니다.
- `session_order.py`와 `test_session_order.py`는 Codex 작업 폴더의 같은 파일과 내용이 똑같습니다.

## 2. 충돌을 막는 규칙

1. **각자 자기 작업 폴더에서만 씁니다.**
   - Codex: `/Users/kang/orca/workspaces/1top/claude-tracking-v3.9.0`
   - Claude: `/Users/kang/orca/workspaces/1top/frontend-redesign`
   - 상대 폴더는 읽기만 합니다.
2. **통합 순서**:
   1. Codex는 아직 커밋하지 않은 v3.27.0 작업(텔레메트리, 세션 정렬 등)을 Codex 브랜치에 먼저 커밋합니다.
   2. 그다음 `git merge awesomezun/frontend-redesign`으로 프론트엔드를 받습니다.
   - `session_order.py`와 테스트는 양쪽 내용이 같습니다.
   - `server.py`는 같은 두 줄(`import`와 `ordered_snapshot(...)` 호출)이 겹칠 수 있습니다. Codex 쪽 내용으로 정리하면 됩니다.
3. **파일 소유**:
   - **프론트엔드(Claude)**: 아래 동결 목록의 32개 파일입니다.
     - `agent/onetop/dist/` 전체
     - `desktop/*.swift`
     - `site/src/maps.css`, `site/src/maps.js`
   - **백엔드(Codex)**: `agent/onetop/*.py`, `scripts/`, `pyproject.toml`, 빌드·설치·릴리스 파일, 백엔드 테스트입니다.
   - **공유 데이터 모델 `desktop/DashboardModel.swift`**: 새 API 필드를 디코딩할 필드 추가만 허용합니다. 정렬·표시 규칙은 Claude가 바꿉니다.
4. **프론트엔드를 바꿔야 할 것 같으면 직접 고치지 않습니다**:
   - 백엔드는 계약대로 계속 진행하고, `docs/handoffs/frontend-request_<버전>.md`에 파일, 이유, 원하는 동작을 적습니다.
   - 사용자에게 알리면 Claude가 반영합니다.
   - 계약서와 실제 응답이 어긋나면 응답을 계약에 맞추는 것이 우선입니다.

## 3. 프론트엔드 동결 확인

작업을 마치고 보고하기 전에 저장소 루트에서 실행해 주세요. 모든 줄이 `OK`여야 완료입니다.

```bash
shasum -a 256 -c docs/handoffs/frontend-freeze_v1.8.0.sha256
```

병합이나 충돌 해결 중에 동결 파일이 바뀌었다면, 이 커밋의 내용으로 되돌린 뒤 4번 규칙대로 요청해 주세요.

## 4. 할 일

### 4-1. `/api/history` 구현

- 명세: `docs/handoffs/usage-history-contract_v1.0.0.md`. 필드, 단위, `null`/`0` 구분, 정렬과 상위 12개+나머지, 과거 기록 가져오기, 검증 항목이 모두 들어 있습니다.
- 프론트엔드는 이미 이 API를 호출합니다(`agent/onetop/dist/history.js`, `app.js`의 `loadHistory`). 404이면 세 패널이 "수집기 업데이트 후 표시됩니다"로 바뀌고 다른 화면에는 영향이 없습니다.
- 참고 구현은 `docs/handoffs/usage-history-reference_v1.0.0/` 아래에 있습니다. 제품 코드가 아니라 화면 개발용 시험 집계입니다.
  - `build_records.py`: Claude Code·Codex 대화 기록에서 시각·도구·모델·작업 폴더·토큰만 분 단위로 집계합니다.
  - `history_fixture.py`: 그 집계로 계약 형식의 응답을 만듭니다.
  - 이 컴퓨터에서 9월 12일부터 집계됐고, 10월 28일 합계는 수집기 DB 값과 거의 같았습니다(12.2억 vs 12.1억 토큰).
- 실제 데이터로 그린 기준 화면은 `/Users/kang/orca/workspaces/1top/frontend-redesign/output/usage-history-reference_v1.0.0/`에 있습니다.
  - 실제 프로젝트 이름이 보이므로 커밋하거나 공개하지 마세요.
  - 실제 API를 붙인 화면이 이 기준과 같은 구성으로 그려지면 됩니다. 1개월 일별 추이, 시간대별·월간 히트맵, 툴팁이 그 구성입니다.

### 4-2. 세션별 주간 한도 환산 추정치(≈) 바로잡기

v3.27.0의 `/api/state`에서 2026-10-29 03시 무렵 확인한 내용입니다.

- **Codex 계정(`codex:9058…`)**: 세션 ≈ 합계와 계정의 실제 증가가 대체로 맞습니다. 1시간 1.40 대 2.0, 5시간 6.94 대 6.0, 24시간 25.63 대 25.0입니다.
- **Claude 계정(`claude:8c66…`)**:
  - 보정값은 있습니다. `confidence: limited`, 1,512초 표본, 3%p / 93,479,604 토큰입니다.
  - 1시간 계정 증가는 6.0%p입니다.
  - 그런데 계정에 연결된 Claude 세션 15개 모두 `weekly_estimate`가 없습니다. 화면에는 "—"만 보입니다.
- **이전 v3.26.x(10월 28일)**에서는 반대로 과대였습니다. 같은 계정 세션들의 1시간 ≈ 합계가 9.7%였는데 계정 증가는 4%p였습니다. 짧은 초기 표본으로 만든 보정이 원인으로 보였습니다.

요청 사항은 다음과 같습니다.
1. 보정 근거가 충분한 Claude 세션에는 추정치를 다시 내 주세요.
2. 정확도 기준: 완료된 구간에서 계정별 세션 ≈ 합계가 같은 구간 계정 `used_pp`와 ±25% 또는 ±1%p 안이어야 합니다.
3. 원인 후보:
   - 짧거나 오래된 보정 표본
   - 토큰 항목 구성의 차이: 원시 합계는 캐시 읽기가 대부분이라, 캐시 비율이 보정 때와 달라지면 1토큰당 환산이 크게 흔들립니다. 항목별 가중이 필요한지 검토해 주세요.
   - 다른 기기나 미귀속 사용
4. 근거가 부족하면 지금처럼 `null`로 두고, 화면이 이유를 표시할 수 있게 해 주세요. 값을 지어내지 않습니다.
5. 계정별 비교표를 검증 결과로 남겨 주세요.

### 4-3. 빌드와 검증

1. 테스트:
   - 백엔드 단위 테스트 전체
   - `node tests/*.mjs`(8개)
   - `python3 tests/dashboard-browser.py`(16개 항목)
   - Swift 모델 검사(`desktop/DashboardModel.swift` + `tests/desktop/ModelChecks.swift`)
2. 3절 동결 확인
3. macOS 앱 빌드와 설치본 검증(`scripts/build-macos.sh` 등 기존 절차). 버전 번호는 기존 릴리스 절차를 따릅니다.
4. 배포, 푸시, 공개 릴리스는 사용자 승인 전에는 하지 않습니다.

## 5. 완료 보고에 넣어 주세요

- 커밋 목록과 각 커밋이 바꾼 범위
- 4-3의 테스트 출력과 동결 확인 출력(전부 `OK`)
- 실제 API로 그린 사용량 맵 스크린샷. 다크·라이트, 1시간·1개월, 히트맵 두 형태를 포함해 주세요.
- 4-2의 계정별 비교표(세션 ≈ 합계 대 계정 `used_pp`, 기간별)
- 프론트엔드 요청서가 있다면 그 경로
