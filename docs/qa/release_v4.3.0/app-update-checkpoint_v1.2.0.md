# 4.3.0 build 8 설치·배포 확인 v1.2.0

2026-10-30. v1.0.0과 v1.1.0을 보존한 후속 기록입니다. 앱 소스는 `6a1c6e304400b578a29a01b8e1429d6a877949cf`, 병합된 프론트엔드는 `3e41fe5`입니다.

세션 대화의 보내기 확인창을 제거한 최종 변경을 반영했습니다. 백엔드 오류 문구는 “이 세션과의 대화 연결을 확인하지 못했습니다. 메시지를 보내지 않았습니다.”입니다. 프론트엔드 동결 v1.20.0의 115개 파일은 빌드 후에도 모두 일치합니다.

## 공개 배포와 설치

- [4.3.0 build 8 Preview](https://github.com/awesomezun/1top/releases/tag/v4.3.0%2Bbuild.8)를 별도 공개했습니다. 기존 `v4.3.0` 태그와 배포 파일은 보존했습니다.
- macOS DMG, Windows EXE·테스트 MSIX, Android APK·AAB, SHA256SUMS, build-info 총 7개 파일을 제공합니다. GitHub 자산의 크기·SHA-256이 로컬 최종 파일과 모두 일치하며 APK·DMG·EXE의 비로그인 다운로드 응답은 200이고 파일 크기도 일치합니다.
- macOS 설치본은 4.3.0(8)로 교체·재실행했습니다. 수집기 ready, 45개 세션, 릴레이 Connected 및 제공되는 conversation.js와 최종 소스의 일치를 확인했습니다. 이전 설치본은 `build/backups/1top-v4.3.0-build3-before-direct-send.app`에 보존했습니다. 자격 증명 저장 도우미의 바이너리 해시는 이전 설치본과 같습니다.
- iPhone 15 Pro Max의 `si.onetop.mobile.dev`에 Personal Team 서명 4.3.0(8)을 업데이트 설치하고 실행했습니다. 실물 UI 테스트 러너 실패 후 일반 앱을 다시 실행해 성공을 확인했습니다. 앱 데이터와 별도 구형 `si.onetop.mobile` 앱은 삭제하지 않았습니다.
- Android는 versionCode 12로 빌드했습니다. 기존 배포 키로 서명한 APK를 API 36.1 에뮬레이터에 설치했습니다. 연결된 실물 Android는 없습니다.
- 홈페이지·웹 /app·랜딩·main release.json·스토어는 이번 배포에서 변경하지 않았습니다. iPhone 공개 IPA는 제공하지 않습니다. macOS Developer ID 공증과 Store 인증이 없는 Preview입니다.

## 검증 결과

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| [최종 소스 CI](https://github.com/awesomezun/1top/actions/runs/41127697572) | 통과 | `6a1c6e3` Python·릴레이·웹·모바일·데스크톱 검사 |
| [동일 소스 두 번째 CI](https://github.com/awesomezun/1top/actions/runs/41127693647) | 통과 | 최종 소스 재확인 |
| 프론트엔드 동결 | 115/115 일치 | v1.20.0 |
| 모바일 단위 검사 | 39/39 통과 | 타입 검사와 lint도 통과 |
| iOS 시뮬레이터 | 30/30 통과 | 단위 29개 및 전송 직후 다음 입력 유지 UI 검사 1개 |
| 한국어 브라우저 데모 | 통과 | 확인창 없는 두 메시지 전송, 다음 초안 보존, 글자 없는 응답 중 점 |
| Android 한국어 데모 | 수동 확인 | 최종 서명 APK에서 두 차례 전송·데모 응답 및 다음 초안 보존 |
| [Windows 설치·업데이트](https://github.com/awesomezun/1top/actions/runs/41128050109) | 11/11 통과 | EXE 4개, MSIX 5개, 업데이트 2개; 실제 Windows 러너 |
| iPhone 실물 설치·실행 | 성공 | 4.3.0(8), Personal Team 개발 서명 |
| iPhone 실물 UI 자동 검사 | 미완료 | 자동화 모드 초기화 시간 초과로 테스트 본문 실행 전 중단 |
| Android 실물 | 미실시 | 기기 미연결 |

브라우저 검사는 병합 커밋 `df151c3`에서 수행했으며 이후 `6a1c6e3`의 유일한 제품 변경은 Android versionCode 11→12입니다. 최종 CI와 Windows 빌드는 `6a1c6e3`에서 수행했습니다. 실제 AI 작업 세션에는 시험 메시지나 제어를 보내지 않았습니다.

Android에서 보내기 버튼이 아직 준비되지 않은 순간의 추가 탭은 전송되지 않았고 입력은 남았습니다. 버튼이 준비된 뒤 해당 입력을 전송했고, 두 번째 데모 응답 이후에도 다음 입력이 보존됐습니다. 이를 실물 네트워크에서 모든 연속 메시지 전달을 보장하는 검사로 간주하지 않습니다.

실물 iPhone 결과 번들에는 러너 초기화 실패 1개·통과 0개가 기록됐습니다. 오류는 `Timed out while enabling automation mode`이며 앱 기능 테스트의 assertion 실패가 아닙니다. 기기 자동화 허용과 잠금 해제 후 재검사가 필요합니다. Android 실물은 USB 디버깅·Mac 연결·기기 RSA 승인 후 같은 키로 서명한 APK를 `adb install -r`로 업데이트할 수 있습니다.

## iPhone 원격 연결 장애 복구

앱의 전체 기간 데이터가 운영 릴레이 1.10.0의 메시지 크기 제한을 초과해 WebSocket 1009로 끊기던 문제였습니다. 릴레이 1.11.0을 배포하고 활성 연결에도 새 코드를 적용했습니다. 초기 96초 관찰에서 재접속 0회, 정상 WebSocket 이벤트 20회, 예외 0개였고 실제 iPhone의 기기 목록·live-ticket 요청은 모두 200이었습니다. 이는 네트워크 복구 증거이며 실물 화면 검사를 대신하지 않습니다.

상세 원인·배포·관측은 [연결 복구 기록 v1.0.0](iphone-connection-recovery_v1.0.0.md)에 있습니다. 배포된 릴레이 버전 ID는 `d4715f2e-b958-4b2f-8687-fa5cac2863a7`입니다.

## 로컬 증거와 남은 검사

`build/qa_v4.3.0/direct-send/`에 `freeze-final.log`, `ci-final.json`, `ios-sim.xcresult`, `ios-sim-summary.json`, `ios-physical.xcresult`, `ios-physical-summary.json`, `ios-normal-launch.json`, `macos-install.json`, `chat-final-browser.json`, `android-final-summary.json`, 한국어 화면 캡처·영상, `windows-summary.json`, `windows-artifacts/`, `release-public-verified.json`을 보관했습니다. 최종 설치 파일은 `release/v4.3.0-rc.4/`, iPhone 아카이브는 `build/qa_v4.3.0/1top-v4.3.0-build8.xcarchive`입니다.

실물 iPhone UI 재검사와 실물 Android 설치·검사가 남아 있습니다. 이번 작업에서 사용한 iOS 시뮬레이터와 Android 에뮬레이터는 종료했습니다.
