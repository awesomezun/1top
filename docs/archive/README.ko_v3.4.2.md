# 1top

AI 세션·터미널·토큰 사용량·컴퓨터 자원을 한곳에서 확인하는 오픈 소스 대시보드입니다.

[웹사이트](https://1top.si) · [설치 없이 체험](https://1top.si/app?demo=1) · [English](README.md)

**v3.4.2 · 초기 프리뷰**

기본 흐름은 **1top 실행 → 독립 데스크톱 대시보드**입니다. 로컬 모니터링은 무료이고 로그인이나 중앙 중계 서버가 필요하지 않습니다. [다운로드 페이지](https://1top.si/#download)에서 Mac Apple Silicon DMG, Windows x64 설치 파일, Android APK를 제공합니다. Mac은 로컬 서명이며 공증 전, Windows는 배포자 서명 전인 프리뷰입니다. Android APK는 서명되어 있으며, iOS 스토어 배포는 준비 중입니다.

- 메뉴 막대 아이콘을 누르면 간략 대시보드, 전체 보기에서는 독립 앱 창
- 로그인된 계정에서 보고하는 5H·주간 한도와 초기화 시각. 해당하지 않는 한도는 생략하고, 확인 실패와 이전 캐시는 구분합니다.
- Aside 내부 세션 상태와 보고된 요청별 토큰 사용량
- 다크 모드 세션 표와 상세 패널, 앱·터미널 위치, CPU·메모리
- 세션·앱·도구·모델별 사용량 비율 맵. 작은 영역도 마우스 오버 또는 선택으로 수치를 확인합니다.
- 24시간·12시간·5시간·1시간·30분·10분의 기록된 토큰 합계
- Claude Code와 Codex의 Goal 상태, Claude Code `/loop`의 관측된 활동
- Skills 설치 목록과 호출 기록. 설치·활성화·작업 성공은 구분합니다.
- 지원되는 세션의 바로가기·작업 중단·새 요청으로 재개·CLI 종료

원격 접속은 선택 사항입니다. 현재 관리형 원격은 서버에서 승인한 계정만 사용할 수 있고 신규 기기 등록은 닫혀 있습니다. 공개 유료 가입과 본인 클라우드 자동 설치는 아직 준비 중입니다. 관리자 권한과 실제 결제 내역은 별개입니다.

미보고 토큰은 0이 아닙니다. Claude Code Goal은 마지막으로 관측한 기록이며, Loop의 현재 예약 상태·다음 실행 시각과 skill의 전체 작업 성공 여부는 확인하지 않습니다. Aside는 읽기 전용 로컬 기록으로 최근 24시간 및 작업 중 세션을 감지합니다. 세션별 CPU·메모리는 추정하지 않으며, 앱 바로가기와 지원되는 세션 중단을 제공합니다. 공유 앱 전체를 종료하지 않습니다.

자세한 설치·빌드·제한은 [README](README.md), [변경 사항](docs/release-notes_v3.4.2.md), [운영 정책](docs/service-policy_v1.0.0.md)을 확인하세요. 이전 안내는 [보존본](docs/archive/README.ko_v1.1.1.md)에 있습니다.


Connection setup and managed billing configuration: [relay guide](cloud/README.md). Release validation and remaining signing gates: [v3.4.2 notes](docs/release-notes_v3.4.2.md).
