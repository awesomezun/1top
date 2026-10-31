# 4.4.0 최종 후보 검증 v1.0.0

2026-10-31. **Mac과 연결된 iPhone에 4.4.0 (9)를 설치했습니다.** Android APK·AAB와 Windows EXE·테스트 MSIX도 생성했습니다. GitHub 릴리스는 초안만 만들며, 공개 release.json·웹·스토어는 변경하지 않습니다.

## 소스와 CPU 계산

- 최종 프론트 `803a83a0db4228b61c3ac446f4f7ee3b57264a15`, 통합 `7bb9842a5c77aa177ce4ce33f3d499611154f119`.
- CPU 계산 수정 `000c26e`, 설명 동기화 `f64efc72be21d9e5c1c9b228a3e0b5ee3dac0b9a`.
- 모든 프로세스·세션·공유 백엔드·수집기 CPU를 전체 논리 코어 합계가 100%가 되도록 계산합니다. 공식은 `(프로세스 CPU 시간 증가 / 경과 시간) × 100 / 논리 코어 수`입니다. 단순 문구 변경이 아닙니다. 원래 전체 CPU 기준인 호스트 수치와 추이 그래프는 다시 나누지 않습니다. 실제 자원 소모를 줄이는 성능 변경은 아닙니다.
- 16코어 검증에서 1코어 프로세스 6.25%, 2코어 자식 12.5%, 세션 합계 18.8%와 호스트 그래프 50% 유지, 공유 프로세스 귀속, relay 이중 환산 방지를 확인했습니다.
- 사용자 요청과 계산의 일치를 위해 CPU 설명 네 곳만 동기화했습니다. 계기판·레이아웃 디자인은 변경하지 않았습니다. 수정 전 정적 파일은 로컬 백업으로 보존했습니다.
- 원본 동결 v1.23.0을 보존하고 파생 동결 `frontend-freeze_v1.23.1.sha256`을 생성했습니다. **132/132 일치**합니다. 관련 계약은 `docs/handoffs/cpu-basis-contract_v1.0.0.md`입니다.

## 자동 검사

- Python **432개 통과**, cloud **76개 통과·1개 건너뜀**, TypeScript 통과.
- 모바일 타입·lint 통과, 단위검사 **44개 통과**.
- iOS Debug 단위검사 **32개 통과**. 별도 Release 기기 archive 생성 성공.
- macOS 13 대상 전체 Swift 컴파일과 ClusterChecks 6개 시나리오 통과.
- 한국어 웹·트레이 fixture 시나리오 **6개 통과**, JavaScript·HTTP 오류 0건. fixture 검사는 실제 연결 검사가 아닙니다. 실제 AI 세션에 시험 제어 명령을 보내지 않았습니다.
- 사이트 정적 빌드 성공. 배포는 하지 않았습니다.
- [최종 Checks](https://github.com/awesomezun/1top/actions/runs/41177106228) 성공. [Windows 최종 CI](https://github.com/awesomezun/1top/actions/runs/41177104179) 성공.

## 설치와 실행 증거

| 플랫폼 | 버전·산출물 | 확인한 범위와 제한 |
| --- | --- | --- |
| macOS | 4.4.0 (9), ARM64 DMG | 기존 앱 백업 후 설치·재실행. 앱과 수집기 한 벌만 실행됨. 실제 한국어 대시보드 계기판·컴퓨터 리소스 화면 확인. API `cpu_basis=host_total`, 패키지 정적 파일 해시 일치. 키체인 helper 해시 유지. 메뉴 막대 팝오버는 자동 캡처에서 독립된 창으로 확인하지 못했으므로 실물 팝오버 전체 검사 완료로 세지 않음. |
| iPhone 실물 | 4.4.0 (9), `si.onetop.mobile.dev` | 개발 서명 검증·실물 설치·설치 버전 조회·실행 성공. 저장된 연결이 유지되고 한국어 실제 사용량 대시보드와 새 계기판을 캡처해 확인. XCTest 자동 UI 검사는 automation mode 준비 중 timeout으로 본문 실행 전 실패. 대신 실제 기기의 직접 실행·스크린샷으로 확인한 범위만 인정하며 전체 UI 조작 검사 완료로 세지 않음. |
| Android 에뮬레이터 | 4.4.0, versionCode 13, APK·AAB | 기존 배포 인증서 일치. 서명 APK 설치 후 한국어 체험 대시보드·계기판 확인. 첫 UIAutomator 읽기는 애니메이션 중 idle 상태를 얻지 못해 이전 XML을 읽었고 실패로 기록. 재검사는 실제 route 실행과 스크린샷으로 확인. 연결된 Android 실물은 없어 실물 설치·실제 원격 연결 검사는 하지 않음. |
| Windows CI | EXE 4.4.0, 테스트 MSIX 4.4.0.0 | 실제 Windows runner에서 EXE 4개·MSIX 5개·업데이트 2개 실행 시나리오 통과. `4.4.1.0`은 업데이트 검사용 파일이라 배포 후보에서 제외. MSIX는 시험 인증서 서명본이며 Store 제출본이 아님. |

macOS와 Windows 산출물 소스는 `f64efc7`입니다. iOS·Android 빌드 소스는 `7bb9842`이며, 이후 최종 커밋까지 `ios/`, `mobile/`, `desktop/` 소스 차이가 없음을 확인했습니다. macOS에 내장된 백엔드·웹 자산은 최종 `f64efc7`입니다.

사용한 1top iOS 시뮬레이터와 임시 read-only Android 에뮬레이터를 모두 종료했습니다. TyveCC-QA는 건드리지 않았습니다.

## 산출물과 공개 범위

- 최종 산출물·출처·SHA-256: 로컬 `release/v4.4.0-rc.3/`의 `build-info.json`, `SHA256SUMS`. 설치 파일 5개와 manifest 해시 검증 완료.
- 상세 원본 로그와 한국어 스크린샷: `build/qa_v4.4.0/final/`. Windows 원본 보고서: `build/qa_v4.4.0/windows-f64efc7/`.
- Mac DMG는 ad-hoc Preview 서명이며 Apple 공증본이 아닙니다. iPhone은 개발용 설치본이고 App Store 배포본이 아닙니다.
- GitHub 초안 `v4.4.0+build.9`로 정리합니다. 공개 릴리스 전환·공개 release.json·웹사이트·스토어 반영은 별도 승인 전까지 보류합니다.
