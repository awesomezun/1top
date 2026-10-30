# 앱 4.3.0 최종 설치·미리보기 배포 확인 v1.1.0

2026-10-30. v1.0.0을 보존한 후속 기록입니다. 최종 앱 소스는 `b03f3c84b60f6c9fbec2d078310652b2bd58d652`, 프론트는 `37066df`입니다.

## 배포와 설치

- [GitHub v4.3.0 Preview](https://github.com/awesomezun/1top/releases/tag/v4.3.0)를 공개했습니다. macOS DMG, Windows EXE·검증용 MSIX, Android APK·AAB, SHA256SUMS, build-info를 제공합니다. v4.3.0 태그는 위 최종 소스를 가리킵니다.
- macOS 설치본을 최종 빌드로 교체·재실행했습니다. 앱과 수집기가 각각 하나만 실행되고 API가 4.3.0·ready를 반환하며, 제공되는 conversation.js가 최종 소스와 바이트 단위로 일치합니다. 이전 4.3.0 후보는 로컬 `build/backups/1top-v4.3.0-rc.2.app`에 보존했습니다.
- iPhone 15 Pro Max에 Release 아카이브의 Personal Team 개발 서명 앱을 업데이트 설치했습니다. 기존 `si.onetop.mobile.dev`의 4.3.0(7)을 확인했습니다. 앱 데이터는 삭제하지 않았습니다. 별도 구형 `si.onetop.mobile` 1.5.0은 제거하지 않았습니다.
- Android 실물 기기는 연결되지 않았습니다. 기존 배포 인증서로 APK/AAB를 서명하고, 별도 읽기 전용 API 36.1 에뮬레이터에 APK를 설치해 검사한 뒤 에뮬레이터를 종료했습니다.
- 1top.si 웹·랜딩, 운영 릴레이, 앱 스토어는 배포하지 않았습니다. macOS Developer ID 서명·공증 및 Store 인증이 없는 미리보기 배포입니다. iPhone 개발 아카이브는 공개 다운로드에 포함하지 않았습니다.

## 검증

- 동결 v1.19.0의 115개 파일이 빌드 전후 모두 일치합니다. 요청된 controls.py 문구만 백엔드에서 수정했습니다.
- [통합 CI 41013072033](https://github.com/awesomezun/1top/actions/runs/41013072033) 전부 통과: Python 411개, 릴레이 73개(별도 1개 건너뜀), 모바일 39개, Swift 모델·번역·데스크탑 컴파일, 웹 검사·빌드.
- 수집기 번역 132개 통과. 세 언어 브라우저 검사에서 AI 이름, 작은 전송 상태, 글자 없는 점, 응답 후 상태 제거, 연속 두 메시지와 다음 초안 보존을 확인했습니다. 실제 AI 작업 세션으로 시험 제어를 보내지 않았습니다.
- iOS 단위 29개 및 `test25_TypingRightAfterSending` 통과. `test26_SendShowsDotsThenReply`는 첫 실행에서 여러 접근성 조회 도중 점이 사라져 실패했으며, 동일 코드 재실행에서 한·영·중 모두 통과했습니다. 원본 실패 로그도 보존했습니다.
- iOS Release 서명 아카이브와 서명 검증이 성공했습니다. Release 사진 UI 검사에 Debug 전용 단위 테스트가 함께 빌드되는 문제는 생성된 로컬 UI 전용 scheme으로 분리했습니다. 이어진 사진 자동 검사는 시스템 사진 선택기의 첫 Image를 XCTest가 누를 수 없는 요소로 판정해 실패했습니다. 같은 Release 앱을 Orca로 직접 조작해 사진 선택→첨부→전송→이미지가 포함된 메시지→응답까지 확인했습니다. 자동 사진 테스트가 통과한 것으로 간주하지 않습니다.
- Android 에뮬레이터에서 대시보드·새 채팅 화면·AI 이름·작은 전송 상태·응답 중 점·두 차례 데모 전송 및 응답·다음 초안 유지와 재진입을 확인했습니다. 자동 텍스트 주입이 일부 끝 글자를 놓친 사례가 있어 실물 키보드 입력 신뢰성까지 검증했다고 주장하지 않습니다.
- [Windows 41013066392](https://github.com/awesomezun/1top/actions/runs/41013066392)의 설치·퀵뷰·MSIX 업데이트 검사가 성공했습니다. 실제 러너는 100% 배율이며 다른 모니터 배치는 좌표 계산 검사 범위입니다.
- GitHub 업로드 파일의 SHA-256과 크기가 로컬 최종 파일과 일치합니다. APK·DMG·EXE 공개 다운로드도 비로그인 HEAD 요청으로 확인합니다.

## 남아 있는 실물 검사

iPhone 설치는 성공했지만, 화면 자동 조작을 위해 요청한 사용 가능 답변은 아직 없고 마지막 확인 때 잠겨 있었습니다. 실물 UI 검사는 미완료입니다. Android는 실물 연결 자체가 없어 설치·실물 UI 검사가 미완료입니다. USB 디버깅을 켜고 Mac에 연결해 RSA 승인을 마치면 기존 인증서의 APK를 `adb install -r`로 데이터 유지 업데이트할 수 있습니다.

원격 프로세스 연결의 `system.top.owner`에 기기 ID를 붙이는 어댑터 후속 작업은 웹 배포 범위로 프론트 담당에게 전달했습니다. 이번 앱 배포에 포함됐다고 주장하지 않습니다.

## 로컬 증거

`build/qa_v4.3.0/` 아래에 `macos-final-install.json`, `ios-final-install.log`, `1top-v4.3.0-final.xcarchive`, `ios-final-sim.log`, `ios-final-dots-retry.xcresult`, `ios-final-dots-attachments/`, `ios-final-release-ui.xcresult`, `ios-final-photo-compose.png`, `ios-final-active.png`, `android-final-qa.json`, `android-final-chat.mp4`, `chat-final-browser.json`, `windows-final/`, `github-final-public.json`을 보관했습니다. 최종 배포 파일은 `release/v4.3.0-rc.3/`에 있습니다.
