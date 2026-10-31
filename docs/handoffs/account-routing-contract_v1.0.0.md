# 계정 유지·자동 전환 백엔드 계약 v1.0.0

2026-10-31 · Codex 백엔드 담당 · 프론트 파일 변경 없음.

## 구현된 실행 경로

Claude Code, Codex, GLM의 **네이티브 요청을 로컬 게이트웨이로 연결한 세션**에
자동 계정 선택과 전환이 적용된다. 같은 제공자와 모델을 유지한다.
CLI의 기존 로그인 파일이나 실행 중 세션의 설정을 바꾸지 않는다.

- 독립 실행: `1top gateway` (기본 `127.0.0.1:18767`).
- 연결해 새 CLI 실행: `1top gateway-claude -- <Claude 인수>`,
  `1top gateway-codex -- <Codex 인수>`, `1top gateway-glm -- <Claude 인수>`.
- 다른 포트: 위 명령의 `--` 앞에 `--gateway-port 18767` 지정.
- 앱 안에서는 아래 설정 API로 켠다. 기존 수집기의 계정 샘플러를 공유한다.
  설정은 재실행 후에도 유지된다.
- 로컬 인증 키는 1top 데이터 디렉터리의 `gateway-key.json`에 권한 0600으로
  저장한다. 실행 래퍼가 읽어 자식 프로세스 환경에만 전달하며 인수에 넣지 않는다.

현재 자동 전환 제공자: `Claude`, `Codex`, `GLM`.
Google Antigravity는 기존 한도 수집 대상이며, 이번 네이티브 게이트웨이의
요청 어댑터에는 포함되지 않는다.

## 수집기 API

`GET /api/routing` → 다음 상태. 키·OAuth 토큰·프롬프트는 반환하지 않는다.

```json
{
  "enabled": true,
  "running": true,
  "threshold": 100,
  "account_priority": ["codex:..."],
  "port": 18767,
  "error": null,
  "providers": ["Claude", "Codex", "GLM"],
  "accounts": [],
  "recent_requests": []
}
```

`POST /api/routing` → `enabled`(필수 bool), `threshold`(1~100, 기본 100),
`account_priority`(계정 ID 배열, 기본 빈 배열).
기존 제어 API와 같은 Host·Origin·`X-Monitor-Token` 검사 후 변경한다.
반환은 `{ok:true, ...상태}`다. `enabled:false`면 리스너를 종료한다.
잘못된 저장 설정이나 점유된 포트는 수집기 전체를 종료시키지 않는다.

`accounts`는 현재 계정별 한도·stale·상태다.
`recent_requests`는 최근 50회 시도의 `request_id, at, account_id, model,
status, attempt, reason`이다. `accepted`는 상위 제공자가 요청을 받아 응답을
시작했다는 뜻이며, 완성된 답변 상태나 읽음 확인을 뜻하지 않는다.

## 네이티브 요청 API

로컬 키로 `Authorization: Bearer ...` 또는 `x-api-key` 인증한다.
브라우저 Origin이 있는 직접 추론 요청은 받지 않는다.

| 제공자 | POST 경로 |
|---|---|
| Claude | `/claude/v1/messages`, `/claude/v1/messages/count_tokens` |
| Codex | `/codex/v1/responses`, `/codex/v1/responses/compact` |
| GLM | `/glm/v1/messages`, `/glm/v1/messages/count_tokens`, `/glm/v1/chat/completions` |

`/v1/messages`는 `glm-` 모델이면 GLM, 나머지는 Claude로 선택한다.
`/v1/responses`는 Codex다. `?beta=true`와 같은 SDK 쿼리가 있어도 경로를 인식한다.
Codex 네이티브 Responses 요청은 스트리밍을 사용한다.
프로토콜 간 변환 없이 각 제공자의 요청·응답 구조를 유지한다.

응답 헤더 `X-1top-Account`는 실제 선택된 계정 ID,
`X-1top-Request-Id`는 시도 기록의 ID다.
가용 계정이 없으면 503, `error.code=no_available_account`, 확인된 가장 빠른
재시도 시각 `error.retry_at`와 `Retry-After`를 돌려준다.

## 선택·갱신·전환 규칙

1. 해당 모델에 적용되는 보고된 모든 한도를 검사한다. MCP 한도와 다른 모델의
   전용 한도는 제외한다. 오래된 보고나 이미 초기화된 창을 현재 소진으로 단정하지 않는다.
2. 이전 요청 계정이 가용하면 유지한다. 그다음 사용자가 정한 우선순위와 계정 ID 순이다.
3. 401이면 같은 계정의 인증을 한 번 갱신하고 재시도한다. 계속 거절되거나 403,
   429, 500/502/503/504 응답이면 제한 시간 동안 해당 계정을 제외하고 다음 계정으로 간다.
4. 실제 한도 소진과 단기 빈도 제한을 구분하며 `Retry-After` 숫자·HTTP 날짜를 읽는다.
   계정별/모델별 대기 시간은 SQLite에 저장해 재시작 후에도 보존한다.
5. 400 등 잘못된 요청은 다음 계정으로 반복하지 않는다. 수신 여부가 불명확한
   연결 실패나 이미 시작한 스트림은 다른 계정으로 재전송하지 않는다.

Claude는 관리 프로필별 갱신 잠금, 저장 직전 계정·토큰 비교, 실제 토큰 소유자
확인을 사용한다. 여러 동시 401은 먼저 갱신된 토큰을 공유한다. Codex의 회전·저장은
네이티브 CLI에 맡긴다. GLM은 발견된 계정별 키와 공식 한도 수집을 연결한다.
프로필 이름이 같다는 이유로 다른 계정 토큰을 사용하지 않는다.

## 실제 사용 계정과 사용량 연결

게이트웨이는 네이티브 세션 ID와 요청을 실제 처리한 계정, 시작·종료 시각을
`gateway.sqlite`에 남긴다. 프롬프트나 답변 본문은 저장하지 않는다.
수집기는 이 구간을 사용해 기존 CLI 토큰 이벤트의 계정을 연결한다. 전환 후에도
원래 프로필의 계정에 계속 귀속시키지 않는다. 토큰 이벤트를 새로 더하지 않아
중복 집계하지 않는다. 수집 순서가 앞뒤로 어긋난 기존 이벤트도 다음 수집에서 보정한다.

CLI가 마지막 바이트를 받은 뒤 기록을 쓰는 지연을 위해 종료 후 2초까지 연결한다.
서로 다른 계정의 요청 구간이 겹쳐 특정 이벤트를 확정할 수 없으면 account는 null이다.
이 연결 구간 밖의 이벤트에는 현재 프로필 계정을 무조건 적용하지 않는다.

## 프론트 인계 범위

프론트는 위 상태·설정 API를 표시·조작하는 부분만 맡는다. 디자인은 프론트 담당이 정한다.
종료 세션의 이름·프로젝트·모델은 별도 `recorded-session-identity_v1.0.0.md` 계약을 사용한다.
사용자가 계기판을 확정하기 전 최종 앱 빌드·설치를 진행하지 않는다.
