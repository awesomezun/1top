# 4.4.0 빌드 경로 검증 v1.0.0

2026-10-31. **빌드 경로 검증 결과입니다. 설치·공개 완료 보고가 아닙니다.** 사용자가 프론트 수정을 추가 요청했으므로, 최종 프론트 인계 후 공개 후보를 다시 빌드합니다. 현재 사용자 Mac·iPhone 설치본과 공개 릴리스·웹사이트는 교체하지 않았습니다.

## 소스와 검사

- 통합 커밋: `2a680f4749bcb6ab5212557504660c17b0f27140`.
- 프론트: `34dfdb0424308ab4b63ea360f363835c08fd6c5c`. `frontend-freeze_v1.22.0.sha256` **132/132 일치**.
- 프론트 담당이 제공한 macOS 13 컴파일 호환 수정과 Android 중복 키 제거를 병합했습니다. 백엔드에서 동결 화면 파일을 수정하지 않았습니다.
- [GitHub Checks 41174758001](https://github.com/awesomezun/1top/actions/runs/41174758001), [41174754484](https://github.com/awesomezun/1top/actions/runs/41174754484): 성공. Python 430개, 루트 Node·클라우드·웹 검사 포함.
- 모바일 타입 검사·lint 통과, 단위검사 **44/44** 통과.
- iOS Debug 단위검사 **32/32** 통과. Release archive도 성공했습니다. 전체 단위검사에는 Debug 전용 테스트 함수가 있어 Release 전체 단위검사 실행은 지원되지 않았습니다. Release 앱 빌드와 Debug 단위검사 결과를 구분합니다.
- 한국어 웹·트레이의 격리된 API fixture 검사 6개 통과, JavaScript·HTTP 오류 0건. 실제 AI 세션으로 제어 명령을 보내지 않았습니다. 이 결과는 수정 전 계기판의 동작 검사이며 새 디자인 승인이나 실물 검사를 대신하지 않습니다.

## 플랫폼별 결과

| 플랫폼 | 결과 | 확인 범위 |
| --- | --- | --- |
| macOS | `4.4.0 (9)` 앱·DMG 생성 | macOS 13 대상 컴파일, 코드 서명 검증, DMG 읽기 전용 마운트와 내장 수집기 버전 확인. 소스 정적 파일과 패키지 파일 전부 일치. 기존 키체인 helper 해시 동일. Preview 서명이며 공증된 공개 배포본은 아님. |
| iPhone | `4.4.0 (9)` Release archive 생성 | `si.onetop.mobile.dev` 개발 서명 검증. 소스는 `ae5e30b`; 이후 통합 커밋까지 iOS 소스 차이 없음. 이번 빌드의 실물 설치는 보류. |
| Android | `4.4.0`, versionCode `13`, APK·AAB 생성 | ARM64·ARM32·x86·x86_64 포함. 기존 배포 키로 서명하고 인증서 일치 검증. 이번 빌드의 에뮬레이터·실물 UI 검사는 아직 하지 않음. |
| Windows | EXE·테스트 MSIX `4.4.0.0` 생성 | [CI 41174036002](https://github.com/awesomezun/1top/actions/runs/41174036002), 소스 `ae5e30b`. 실제 Windows CI에서 EXE 4개·MSIX 5개 실행 시나리오 통과. `4.4.1.0` 파일은 업데이트 검사 전용 fixture이며 배포 후보에서 제외. 테스트 MSIX는 스토어 인증본이 아님. |

산출물과 메타데이터: `release/v4.4.0-pipeline.2/`. iPhone archive: `build/qa_v4.4.0/1top-v4.4.0-build9.xcarchive`. Windows 원본 CI 파일: `build/qa_v4.4.0/windows-ae5e30b/`. 상세 로그·JSON: `build/qa_v4.4.0/integration/`.

사용한 `1top-QA-v4.4.0` 시뮬레이터는 검사 후 종료했습니다. `TyveCC-QA`는 건드리지 않았습니다. 사용자 리소스 사용량 질문에는 읽기 전용 측정으로 답했으며, 이를 근거로 성능 관련 코드나 설정을 변경하지 않았습니다.

## 남은 작업

1. 수정된 최종 프론트 커밋과 동결 목록을 받아 병합하고 변경된 화면을 한국어로 검사합니다.
2. 동일한 최종 소스 기준으로 각 플랫폼 후보를 다시 빌드하고 버전·서명·해시를 확인합니다.
3. 사용자 Mac과 iPhone에 최종 후보를 설치하고 실물 결과를 따로 기록합니다. Android 실물 연결 가능 여부도 설치 시점에 다시 확인합니다.
4. GitHub 공개 릴리스와 공개 `release.json`은 사용자 승인 전까지 초안으로 유지합니다.
