# Agy·Z.ai 계정 한도 연결 v1.0.0

2026-10-31. 기존 계정 한도 계약에 선택 필드를 추가합니다. Claude·Codex 데이터와 기존 `label`, `pct`, `reset`은 유지합니다.

## 수집 완료 범위

- Agy CLI의 `/usage`를 새 모델 대화 없이 조회합니다. `num_turns=0`, 빈 `conversation_id`, 토큰 사용 0과 `command.name=usage`를 확인합니다. 업데이트와 로그 저장은 끄고 `disableSlashCommands=false`를 명시합니다.
- 각 Agy `groups[]`는 서로 다른 한도 풀입니다. `Gemini Models`, `Claude and GPT models`, `Gemini 4 Argon`을 합산하지 않습니다. 각각 별도의 `account_quotas[]` 항목이며 표시 별칭의 기본값은 풀 이름입니다.
- Z.ai/GLM은 실행 중인 지원 CLI 환경, Claude 설정 또는 `ZAI_API_KEY`의 기존 키로 공식 조회 주소에 직접 GET합니다. 같은 호스트·키는 중복 조회하지 않습니다. 중국 Zhipu는 `open.bigmodel.cn`으로 분리합니다. 키·원본 환경·응답 본문을 릴레이로 내보내지 않습니다.
- 두 제공자 모두 120초 주기로 백그라운드에서 조회합니다. 화면/스냅샷 요청은 네트워크 호출을 하지 않습니다. 실패 시 이전 값을 오래된 값으로 남기고 초기화 시각이 지나면 `pct=null`로 처리합니다.

## 데이터

```json
{
  "id": "antigravity:opaque-pool-id",
  "kind": "Antigravity",
  "account_label": "Gemini 4 Argon",
  "alias": "Gemini 4 Argon",
  "provider": "Google Antigravity",
  "pool": "Gemini 4 Argon",
  "identity_source": "cli_profile",
  "identity_verified": false,
  "plan": "",
  "windows": [{
    "key": "gemini-argon-wtu-weekly",
    "period": "weekly",
    "label": "주간",
    "pct": 75.5,
    "reset": 1900000000,
    "seconds": 604800
  }],
  "updated": 1899500000,
  "stale": false
}
```

위 숫자는 형태를 설명하는 예시입니다. 실제 값은 조회 시점에 따라 달라집니다.

`period`는 `weekly`, `5h`, `daily`, `monthly`, `unknown` 중 하나입니다. `seconds`는 고정 기간일 때만 있으며 달력 월은 `null`입니다. GLM 창은 추가로 `scope=models|mcp`, `meter=TOKENS_LIMIT|CREDIT_LIMIT|TIME_LIMIT`을 가집니다. 월간 MCP는 모델 사용 한도와 다른 예산입니다.

GLM 신형 플랜은 실제 `CREDIT_LIMIT`의 사용/전체 크레딧 비율로 소수점 정확도를 유지합니다. 구형 플랜이 5시간 모델 한도와 월간 MCP만 보고하면 주간 창을 만들어 넣지 않습니다. 현재 로컬 실측도 이 구형 형태였습니다.

Agy 응답에는 사용자 계정 식별자가 없습니다. `id`는 현재 CLI 프로필과 풀을 식별하며 Google 계정이 검증됐다는 뜻이 아닙니다. 계정 전환 전후 이력이 섞이지 않도록 이 항목의 주간 소진 속도/세션 환산 학습은 하지 않습니다. 제공자가 보고한 현재 한도 비율은 표시합니다. GLM은 키 지문별로 구분하므로 서로 다른 키가 실제 같은 청구 계정인지까지 추정해 합치지 않습니다.

## 필요한 프론트 연결

기존 디자인을 유지하고 다음 데이터 선택 동작을 적용해야 합니다.

1. 대표 창은 모델용 주간 → 5시간 → 일간 → 그 외 모델 창 순서입니다. 모델 창이 없을 때만 MCP 등 다른 창을 선택합니다. 구형 Claude·Codex는 `period`가 없어도 기존 `label`로 선택합니다.
2. 대표 창의 실제 `label`을 표시합니다. 주간이 아닌 창에 주간 소진 속도를 붙이지 않습니다. 여러 제공자를 묶는 제목은 기존 번역이 있는 ‘계정 한도’가 맞습니다.
3. Agy의 각 풀 이름은 `alias`/`pool`로 구분합니다. `kind=Antigravity`를 Claude 계정 또는 독립 Gemini CLI 계정으로 바꾸지 않습니다.
4. 간략보기의 고정 4개 제한으로 새 제공자를 숨기지 않아야 합니다. 기존 대시보드 전체 한도 화면은 이미 모든 창을 순회합니다.
5. 상태 `provider_unavailable`, `invalid_response`, `no_quota`, `unsafe_cli_response`, `unsupported_cli`는 값 없음/오래된 값으로 표시합니다. 0% 또는 무제한이라는 뜻이 아닙니다.

확인 지점: `desktop/QuickDashboard.swift`, `desktop/DashboardModel.swift`, `agent/onetop/dist/quick.js`, `agent/onetop/dist/app.js`, `ios/OneTop/Model/Snapshot.swift`, `ios/OneTop/Views/QuickView.swift`, `mobile/src/dashboard.tsx`. 웹 원격 어댑터가 계정 한도를 재구성할 경우 선택 메타데이터도 보존해야 합니다.

## 검증과 출처

- 로컬 실측: Agy 1.4.12의 3개 독립 풀과 GLM 5시간·월간 창을 새 수집기에서 확인했습니다. 원본 키는 출력하지 않았습니다.
- Python 426개 검사 통과. 새 제공자 회귀 검사 15개를 포함합니다. 릴레이의 추가 필드·자격 증명 제외 검사는 `cloud/test/provider-quotas.test.ts`입니다.
- 프론트엔드 v1.20.0 동결 115개는 변경하지 않았습니다.
- [Google 공식 `/usage` 문서](https://antigravity.google/docs/cli/commands/usage), [CLI 설정과 인쇄 모드](https://antigravity.google/docs/cli/reference/).
- [Z.ai 공식 플러그인의 사용량 조회 코드](https://github.com/zai-org/zai-coding-plugins/blob/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs), [Z.ai Coding Plan](https://docs.z.ai/devpack/overview).

현재 작업은 설치본·공개 배포에 아직 포함하지 않았습니다. UI의 대표 창 선택과 표시 누락을 연결한 뒤 함께 검증해야 합니다. GLM 키가 실행 중인 프로세스에만 있다면 해당 CLI를 모두 닫은 뒤 1top을 새로 시작할 때는 키를 다시 발견할 수 없습니다. 이 버전은 키를 임의로 디스크나 키체인에 복사하지 않습니다.
