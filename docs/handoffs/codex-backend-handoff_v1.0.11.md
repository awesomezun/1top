# Codex 백엔드 인계 v1.0.11

작성: Claude (프론트엔드) · 2026-10-30 · 받는 쪽: Codex (백엔드·수집·빌드)

v1.0.10(`1f798be`) 이후의 프론트엔드 변경과, Codex가 요청한 3건의 처리 결과입니다.

## 1. 동결 확인

| 항목 | 값 |
|---|---|
| 브랜치 | `awesomezun/frontend-redesign` (origin에 푸시됨) |
| 동결 목록 | `docs/handoffs/frontend-freeze_v1.18.0.sha256` (115개) |

```bash
shasum -a 256 -c docs/handoffs/frontend-freeze_v1.18.0.sha256
```

v1.17.0에 더해 `site/src/remote-demo-parity.js`, `demo-model.js`, `demo-world.js`, `scripts/demo-world.mjs`, `tests/dashboard-untitled.py`, 아이폰 `DemoWorld.swift` 등을 넣었습니다.

## 2. 요청 3건 처리

| 요청 | 커밋 | 내용 |
|---|---|---|
| iOS Release 빌드 오류(`PhotoPrep.demo`) | `b1cac3a` | 체험용 사진 준비를 DEBUG 밖으로 옮기고, UI 테스트 실행 옵션만 DEBUG로 남겼습니다. Release 빌드(기기·시뮬레이터)가 성공하고, Release 앱의 체험 사진 흐름 UI 테스트 `ReleaseDemoTests`가 통과했습니다. |
| 수집기 새 문구 11개 번역 | `4e897e1` | 백엔드 `8371af8` 코드 기준으로 `tests/i18n-collector.mjs`가 통과합니다(132개). |
| relay parity 계약 v1.0.1 어댑터 | `c85b85f` | 웹 `/app`이 새 세션·host·system·전 기간·history(WS)·rename·계정 이름을 읽습니다. `features`가 없는 컴퓨터는 지금처럼 '원격 미지원'으로 표시합니다. 데모 relay도 같은 필드를 냅니다. |

## 3. 그 밖의 변경

- `b646cb4`: 세션 대화의 진행 표시를 점만 보이게 했습니다. 데스크톱·웹·두 휴대폰 공통이고, 단계 글자는 화면 읽기용으로만 남깁니다.
- `08748ca`, `c85b85f`: 데모 정의를 하나로 묶었습니다(`site/src/demo-world.js`, 휴대폰 사본은 `scripts/demo-world.mjs`가 생성).
  - 촬영용 `demoNow` 옵션: 웹 `?demo&demoNow=…`, iOS `-qaDemoNow`, Android `onetop://?qaDemoNow=…`
  - 대화 대본(`CONVERSATION`)이 들어 있습니다.
- `0eefc07`
  - 세션 상세의 '최근 1시간' 흐름이 선택 기간과 상관없이 최근 60분을 그립니다.
  - 속성(aria-label 등)에도 이름 번역을 적용했습니다.
  - 제목이 빈 세션의 이음표를 정리했습니다.

## 4. 남은 백엔드 요청

- relay `system.top` 각 행에 세션 연결 값을 넣어 주세요. 지금은 원격 '자원 상위 프로세스' 표의 '세션 연결' 열이 비어 있습니다. 급하지 않습니다.

## 5. 배포 순서 (사용자 승인: "고쳤으면 커밋 푸시 배포까지 해")

1. 지금 할 일: 이 커밋까지 병합하고 동결·CI를 확인한 뒤 4.3.0 최종 빌드를 준비합니다.
2. 곧 이어질 커밋: 사용자 요청으로 세션 대화의 '답신' 문구를 요즘 채팅앱처럼 바꾸는 개편이 네 화면에 곧 들어옵니다.
   - AI 메시지 머리말을 AI 이름과 아이콘으로 바꿉니다.
   - '답신 대기·도착' 글자를 없애고, 보낸 메시지의 상태는 작은 표시로 둡니다.
   - 사용자 폰에 두 번 설치하지 않도록, 최종 배포와 폰 설치는 이 커밋을 받은 뒤 한 번에 해 주세요.
3. 배포 대상
   - 사용자 아이폰·안드로이드에 새 앱 설치(실기기 설치 가능 여부와 방법을 알려 주세요)
   - 맥 앱 업데이트
   - 윈도우 산출물
4. 1top.si(웹 `/app`과 랜딩 v7)는 랜딩 쪽 승인 뒤 따로 배포하니 이번에는 보류해 주세요.
5. 보고는 한국어로, Orca 메시지와 터미널에 남겨 주세요.
