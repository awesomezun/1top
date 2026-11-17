# 1top.si 랜딩 v5.0.2 보존본

2026-10-28에 1top.si에 게시되어 있던 랜딩 페이지 소스입니다. 계기판 컨셉의 v6.0.0으로 개편하기 전 상태를 그대로 보존합니다.

- `src/landing.js`, `src/landing.css`: 랜딩 구성과 스타일입니다. 섹션 순서는 01 한눈에 보기, 02 주간 한도, 03 사용량 맵, 04 메뉴 막대였습니다.
- `src/hero-motion.js`, `src/hero-motion.css`, `src/landing-motion.js`: 히어로 모션그래픽 v2.0.0입니다(24초, 장 다섯 개). 설계 문서는 `docs/design/hero-motion_v2.0.0/`에 있습니다.
- `src/main.js`, `src/typography.css`, `index.html`, `package.json`, `public/release.json`: 게시 당시의 라우팅, 글꼴 설정, OG 메타, 버전, 다운로드 메타데이터(macOS v3.19.4)입니다.

이 판이 참조하던 영상과 이미지(`public/media/v5.0.0/`, `public/media/v4.2.0/icons/`)는 `site/public/media/`에 그대로 남아 있습니다. 되돌리려면 이 폴더의 파일을 `site/`의 같은 경로에 복사합니다.
