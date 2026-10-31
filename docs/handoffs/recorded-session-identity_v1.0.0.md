# 기록된 세션 식별 API v1.0.0

2026-10-31. 종료된 세션의 정체를 복원하는 책임은 백엔드에 있다.
모델별 합계만 제공했던 period-model-breakdown_v1.1.0에 개별 세션 조회를 추가한다.

## 로컬 및 원격

`GET /api/usage-sessions?period=24h&offset=0&limit=100`

기본 6개 기간·custom:초·all을 지원한다. limit은 1~200이며 next_offset이 null일 때 마지막 페이지다.
원격은 기존 인증된 history_request에 `view:"sessions", period, offset, limit`을 전달한다.
장치 features에 `usage_sessions`가 있으면 지원한다. 동일한 history 응답의 data로 반환한다.
원격 기간은 기존 슬라이더의 19개 기간이다. 사용자가 따로 확인/제어할 대상 세션을 복구하는 기능은 아니다.

```json
{
  "view": "sessions", "period": "24h", "as_of": 1000, "start": 0, "end": 1000,
  "session_count": 1, "tokens": [12, 3, 4, 5], "offset": 0, "next_offset": null,
  "sessions": [{
    "id": "recorded-session-id", "kind": "Codex", "title": "기존 세션 이름",
    "project": "프로젝트명", "app": "Orca", "model": "gpt-6-astra",
    "identity_source": "collector", "listed": false,
    "tokens": [12, 3, 4, 5], "first_usage": 900, "last_usage": 950,
    "models": [{"model": "gpt-6-astra", "tokens": [12, 3, 4, 5]}]
  }]
}
```

tokens는 fresh/cached/written/output 순서다. 전체 tokens/session_count는 페이지에 관계없이 기간 전체 값이다.
세션은 토큰량 내림차순·ID 순이며 각 세션의 models 합계는 해당 세션 tokens와 같다.
기간 경계는 기존 집계와 동일한 `(now-duration, now]`이며 기록 시작 이전을 제외한다.

## 식별 정보

- 수집 시 세션 이름·프로젝트·모델·앱을 session_catalog에 저장하고 프로세스가 사라져도 유지한다.
- 기존 종료 기록은 이벤트의 ID/프로젝트/모델과 Codex threads, Claude sessions-index 및 명시적
  custom-title/summary/slug, Aside 세션 레지스트리로 보완한다.
- `listed:false`는 현재 수집 목록에 없음을 뜻한다. 프로세스 종료를 임의로 단정하지 않는다.
- 저장된 이름이 없으면 title=null이다. 세션 ID·프로젝트·모델은 그대로 제공한다.
- 모델 변경은 models에 기록 당시 모델별로 보존하며 model은 마지막 기록의 모델이다.
- 경로, 원문 프롬프트, 자격 증명, control_key, PID/제어 권한은 이 API에 넣지 않는다.

프론트의 역할은 제공된 식별 정보를 표시하는 것이다. 현재 목록에서 이름을 추론하거나
차액을 모두 “종료된 세션”으로 만들어야 하는 데이터 계약이 아니다.

## 실제 기록 확인

실행 중인 앱의 조회 시각을 기준으로 원본 DB를 읽기 전용 연결하고, 메모리 DB에만 메타데이터를 복원했다.
최근 24시간 68개 세션 중 현재 목록에 없는 4개를 식별했다.
3개는 GitReels-opus의 Claude Opus 5.5 세션이며 저장된 이름은 없었고, 각 실제 UUID와 프로젝트·모델을 제공했다.
1개는 1top-hosted의 Codex GPT-6-astra 세션으로 저장된 title을 복원했다.
전체 세션 토큰의 성분별 합계가 기간 전체 토큰과 일치했다. 원본 DB와 설치 앱은 바꾸지 않았다.
