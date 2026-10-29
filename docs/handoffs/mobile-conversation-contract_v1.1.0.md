# Mobile conversation contract v1.1.0

The session detail has one conversation composer and one message timeline. Keep focus, pause, resume and terminate controls accessible. Sending a question and sending an instruction use the same `message` action so both have a correlated answer. Older computers with only `prompt` may send a text instruction with an explicit no-reply-reader notice.

## Photos

`POST /api/action` retains its existing authenticated device/session/control-key/request-ID fields. For `action: "message"` it additionally accepts:

```json
{"prompt":"Please inspect these screenshots.","attachments":[{"mime":"image/jpeg","data":"BASE64"}]}
```

- Advertise support with session capability `message_images`. Hide or disable attachment picking for older computers. Do not discard a picked image when switching to an unsupported session.
- Maximum 3 images, each at most 524288 decoded bytes. JPEG and PNG only. iPhone should resize to at most 1600 pixels on the long edge, re-encode to remove EXIF, and lower JPEG quality/dimensions to fit. Reject with an explanation if fitting fails.
- Use PhotosPicker; show picked previews and remove buttons. Preserve draft and images on a definite send failure. A timed-out send is unconfirmed, never automatically resent with a new request ID.
- Photos without text use an explicit default prompt such as "Please inspect the attached image(s)." localized in the chosen language.
- Relay forwards images to the authenticated computer without persisting image data or prompt content. The computer stores private files and gives their paths to the existing CLI session for inspection. No new model-provider account is involved.
- Image validation, safe generated filenames, storage limits and request-ID deduplication belong to the backend.
- Mailbox messages can include `attachments: [{id,name,mime,bytes}]`. This version does not expose a public image URL or download endpoint. Persisted rows may display a photo count/name when local previews are unavailable.

## Progress and delivery

Keep message delivery separate from the session's current work state:

- `queued`: waiting to enter the session.
- `sending` / `awaiting_reply`: delivery in progress / waiting for a correlated answer.
- `replied`: this message has an answer; does not claim the whole task is complete.
- `delivery_unconfirmed`, `source_changed`, `not_delivered`: retain their distinct error/uncertainty copy.
- The existing live session `status` and computer report freshness supply the work indicator: working, waiting for input, idle, paused, offline or stale. Display it within the conversation and keep it visible while composing.
- Do not derive a completion percentage from elapsed time or token usage. Do not display hidden reasoning or unfiltered tool output.

Claude owns iOS views, AppModel/Models and the request encoding needed by those views; Codex owns Python collector/controller/mailbox and cloud relay validation/transport. Keep native SwiftUI and the build-5 one-tap theme/language/reveal behavior.

## Request-scoped response activity

Mailbox rows additionally carry optional `activity: {phase: "responding" | "working" | "writing", observed_at: unix_seconds}` or `null`. This is derived only after the unique request marker is seen in the transcript and actual API/assistant/tool events follow it. It stops on a durable turn end, unrelated new input, a correlated answer, or a non-working session. It contains no text, tool arguments/results, or reasoning.

Use a separate, subtle animated typing indicator, visually distinct from message bubbles. Suggested labels: responding → 응답 준비 중…, working → 작업 중…, writing → 답변 작성 중…. Do not animate queued/received-only requests. Hide the typing animation for offline/stale reports. Reduce Motion uses static dots. A working session without request-scoped activity may show a plain session work status but must not claim this request is being answered.
