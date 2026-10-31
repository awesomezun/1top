# 4.4.0 빌드 준비 v1.0.0

2026-10-31. 백엔드와 버전 준비 기록입니다. **최종 프론트 병합·설치·공개 배포 완료 보고가 아닙니다.**

- 제품 버전: Python·macOS·iOS·Android `4.4.0`, Windows MSIX `4.4.0.0`.
- macOS와 네이티브 iOS 빌드 번호 `9`, Android versionCode `13`. Expo의 iOS 설정도 빌드 `9`입니다.
- macOS 빌드는 소스의 `__build__`를 사용합니다. 이전 스크립트의 고정된 빌드 번호 `3`을 제거했습니다.
- `/cluster.js`, `/cluster.css`를 정적 파일 허용 목록에 추가했습니다. 실제 프론트 파일은 최종 프론트 커밋에서 병합합니다.
- Gemini(Antigravity)·GLM(Z.ai) 수집과 계약은 `32e9e21`까지 푸시됐습니다. 필드 계약은 `docs/handoffs/provider-quotas-contract_v1.0.2.md`입니다. 이 브랜치에는 프론트의 표시 연결이 아직 없습니다.
- Python 430개 테스트 통과. 새 정적 파일의 MIME과 허용 목록 밖 파일 차단도 실제 로컬 HTTP로 확인했습니다.

## 인수와 빌드 순서

1. 프론트의 최종 커밋과 `frontend-freeze_v1.21.0.sha256`을 받습니다. 프론트 동결에는 이번 `ios/project.yml` 버전 값도 반영해야 합니다. 화면 코드는 백엔드에서 수정하지 않습니다.
2. 최종 커밋을 병합하고 동결·CI·한국어 화면을 검사합니다. 프론트 파일과 계기판 파일이 없는 준비 단계에서 최종 설치 파일을 만들지 않습니다.
3. macOS DMG, 네이티브 iPhone 개발 서명 빌드, Android APK·AAB, Windows EXE·테스트 MSIX를 만듭니다. Windows 버전은 Python 제품 버전으로 생성합니다.
4. 최종 산출물의 실제 버전·소스 커밋·해시를 `release/v4.4.0-rc.1/build-info.json`에 기록합니다. 준비 중에는 `build_complete: false`이며 최종 소스와 해시를 채워 넣지 않습니다.
5. 사용자 Mac과 iPhone `si.onetop.mobile.dev`에 설치합니다. 기존 앱 데이터와 서명 자격 증명을 유지합니다. 사용한 시뮬레이터만 검사 직후 종료합니다.

GitHub 공개 릴리스와 `1top.si`의 `release.json`은 승인 전까지 초안입니다. 이전 공개 파일·태그·설치 파일은 보존합니다. 현재 Apple Personal Team의 개발 서명은 App Store 배포나 macOS 공증을 대신하지 않습니다. 실물 설치·화면 검사와 시뮬레이터 검사는 별도로 보고합니다.
