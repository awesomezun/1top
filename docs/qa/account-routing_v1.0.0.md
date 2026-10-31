# 종료 세션 식별·계정 자동 전환 검증 v1.0.0

2026-10-31 · 백엔드 소스 검증. 설치본·공개 릴리스 검증과 구분한다.

## 구현 결과

- 종료·미표시 세션 ID/저장된 이름/프로젝트/모델 복구와 영속 보관,
  로컬 `/api/usage-sessions` 및 relay `history_request(view=sessions)`.
- OmniRoute의 계정 선택·한도 판정·실패 분류를 Python으로 이식.
- Claude/Codex/GLM 네이티브 게이트웨이, 앱 공유 샘플러 연결,
  `/api/routing` 설정·상태, 새 CLI 실행 래퍼.
- 계정별 갱신과 비교 후 저장, 동시 갱신 공유, 401 한 번 갱신,
  여러 한도 창 검사, 영속 대기 시간, 응답 전 재시도.
- 네이티브 세션별 실제 요청 계정을 수집기 토큰 이벤트에 연결.
  기존 토큰 이벤트의 계정만 보정하고 사용량을 중복 추가하지 않음.

## 자동 검사

| 검사 | 결과 |
|---|---|
| `PYTHONPATH=agent python3 -m unittest discover -s tests -p 'test_*.py'` | 469 통과 |
| `cloud: npm run check` | TypeScript 통과 |
| `cloud: npm test -- --run` | 83 통과, 기존 1개 건너뜀 |
| `frontend-freeze_v1.23.2.sha256` | 132/132 OK |
| 원본 MIT 라이선스와 패키지 포함본 비교 | 바이트 일치, `licenses/*` 패키지 포함 |
| `git diff --check` | 통과 |

자동 전환 전용 18개 검사는 HTTP 서버를 실제로 열어 로컬 인증·Origin 검사·
SDK beta 쿼리·count_tokens·스트리밍을 확인한다. 상위 제공자 응답은 이 검사에서
합성한다. 계정 A 소진→B, 429 대기, 401 갱신, 400/연결 불명확 상태의 비재전송,
동시 갱신, 프로필-토큰 소유자 불일치, 재실행, 실제 계정 귀속 보정을 포함한다.

## 실제 데이터와 제공자 연결

1. 운영 DB를 읽기 전용으로 연결하고 복구 카탈로그는 메모리에 만들었다.
   24시간 기록 68세션 중 현재 목록 밖 4세션의 ID·프로젝트·모델을 확인했고,
   세션별 합계와 전체 토큰 벡터가 일치했다. 저장된 제목은 1세션에서 확인됐다.
   나머지 Claude 로그 3개는 전체 파일의 명시적 제목/summary/slug 필드도 검사했으며
   해당 필드가 없었다. 없는 이름을 만들어 넣지 않았다.
2. 별도 Codex 시험 요청: 실제 등록 계정 A, `gpt-6-luna`, HTTP 200,
   `response.completed`, 출력 `OK` 확인.
3. 첫 계정을 100% 소진 상태로 둔 **시험용 한도 스냅샷**으로 실제 로컬 HTTP
   게이트웨이에 요청했다. 운영 한도·계정 설정을 변경하지 않았다.
   실제 등록 계정 B가 선택됐고 HTTP 200, `response.completed`, 출력 `OK` 확인.
   실제 계정을 일부러 소진시킨 검사는 아니다.
4. Claude/GLM의 요청 전달·갱신·자동 전환은 합성 응답으로 검증했다.
   이번 실제 추론 요청 검증은 Codex 두 계정이다. 사용자의 일반 작업 세션에
   제어 메시지를 보내지 않았다.

## 설치·표시 상태

이 검증은 소스와 별도 시험 서버 기준이다. 사용자가 프론트 디자인을 확정하기
전 최종 빌드·설치를 보류하라는 지시에 따라 운영 앱은 교체하지 않았다.
프론트 변경 없이 132개 동결 해시가 유지됐다.
Google Antigravity는 한도 수집 대상이며 이번 추론 게이트웨이 지원 제공자에는
포함되지 않는다.

계약: `docs/handoffs/account-routing-contract_v1.0.0.md`,
`docs/handoffs/recorded-session-identity_v1.0.0.md`.
원본과 이식 범위: `third_party/omniroute/PORTING.md`.
