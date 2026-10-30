# 앱 4.3.0 업데이트 확인 v1.0.0

2026-10-30. 앱 배포 승인을 받은 뒤의 중간 기록입니다. 웹·랜딩·운영 릴레이는 이번 작업에서 공개하지 않았습니다.

## 소스와 설치

- 프론트 `4e897e1`까지 `7e0a73a`로 병합했습니다. 점만 표시하는 `b646cb4`, 공통 데모 데이터, 수집기 문구 11개 번역을 포함합니다.
- macOS 설치본을 4.2.2에서 4.3.0으로 교체·재실행했습니다. 기존 앱은 `build/backups/1top-v4.2.2-before-4.3.0.app`에 보관했습니다. 단일 앱과 수집기, API 버전 4.3.0, 45개 세션의 준비 상태를 확인했고 실제 제공되는 `conversation.js`가 새 소스와 일치했습니다.
- iPhone 15 Pro Max의 `si.onetop.mobile.dev`를 4.1.0(5)에서 4.3.0(7) 개발 서명 빌드로 업데이트했습니다. 설치 후 기기의 앱 목록에서 버전을 확인했습니다. 삭제 후 재설치하지 않았습니다. 별도로 설치된 구형 `si.onetop.mobile` 1.5.0은 제거하지 않았습니다.
- Android 실물 기기는 연결되지 않았습니다. 별도 읽기 전용 API 36.1 에뮬레이터에 서명 APK를 업데이트 설치한 뒤 종료했습니다. 다른 촬영용 에뮬레이터를 조작하지 않았습니다.

## 검증

- 소스 `7e0a73a`의 [Checks 41005115940](https://github.com/awesomezun/1top/actions/runs/41005115940): Python·Swift, 릴레이·웹, 모바일 작업 모두 성공.
- 번역 검사: 한국어 원문 132개가 영어·중국어로 변환됨을 확인했습니다.
- Android: 39개 테스트, 타입·린트 검사, Release APK/AAB 빌드와 기존 인증서 서명 검증 통과.
- Android 에뮬레이터: 대시보드·대화 열기, 글자 없는 점 표시, 데모 메시지·답신, 키보드 위 작성창을 확인했습니다. 두 번째 메시지를 보낸 직후 `thirdDraft`를 입력해 보낸 글과 다음 초안이 분리됨을 확인했습니다. Orca type에서 한 번 입력이 잘려 직접 adb 입력으로 확인했으므로 실제 키보드 전체 범위 검사로 주장하지 않습니다.
- iOS: 단위 검사 28개와 한·영·중 세 언어의 `test26_SendShowsDotsThenReply` 통과. 캡처에서 점 옆에 단계 문구가 없음을 확인했습니다. 실물 UI 자동 검사는 사용 가능 답변을 기다리고 있습니다.
- [Windows 41005115935](https://github.com/awesomezun/1top/actions/runs/41005115935): 설치 및 MSIX 업데이트 검사 성공. Windows 배율·모니터 검증의 범위는 기존 통합 보고와 같습니다.
- main의 새 데모 테스트가 선택 필드 기본값 추가를 거부해 PR 통합 검사가 한 번 실패했습니다. main을 통합하고 `50f084d`에서 제공된 모든 값이 보존되는 검사로 수정했습니다. 해당 테스트 2개와 TypeScript 검사 통과; 새 CI 결과는 별도로 확인해야 합니다.

모든 메시지·제어 UI 검사는 데모에서만 수행했습니다. 실제 AI 작업 세션에는 시험 명령을 보내지 않았습니다.

## 산출물과 남은 작업

`release/v4.3.0-rc.2/`의 macOS DMG, Windows EXE·테스트 MSIX, Android APK·AAB 및 SHA256SUMS를 GitHub v4.3.0 **비공개 초안**에 업로드했습니다. GitHub의 각 SHA-256이 로컬 파일과 일치합니다. macOS Developer ID 서명·공증, Windows Store 인증, iPhone App Store/TestFlight 배포는 완료되지 않았습니다.

프론트 담당의 iOS Release 오류 수정 및 동결 v1.18.0이 아직 도착하지 않았습니다. 새 커밋에 포함되는 앱 변경을 다시 검증·빌드하고 Release 아카이브를 만든 뒤 최종 설치 파일을 공개해야 합니다. 이 기록은 전체 배포 완료 보고가 아닙니다.

원시 증거는 로컬 `build/qa_v4.3.0/`의 `macos-install.json`, `ios-device-install-dots.log`, `ios-simulator-dots.xcresult`, `android-native-dots.json`, `android-dots.mp4`, `github-draft-assets.json`, `windows-dots/`에 보관했습니다.
