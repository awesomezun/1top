# 1top v3.6.0 — session messages

Send a separate message to a session from the web or mobile workspace and receive its corresponding reply in a message inbox. This does not mirror the session’s full work conversation.

The companion routes messages through a verified input adapter and asks the same AI session to mark its reply. Only matching visible assistant text is shown; unrelated output, tool results, and reasoning are excluded. A reply is not claimed until that marker is observed. This is a separate presentation, not a separate model context or an independent parallel AI turn.

A working Orca terminal queues messages until its current turn finishes. Queued messages expire after 15 minutes and are never retargeted after session identity changes. Aside uses its next-step queue. Ambiguous delivery is not automatically retried.

The local private mailbox retains at most 200 messages. An open inbox requests its latest ten records; the relay forwards these only to the requesting authenticated viewer, with no message-body storage. Offline devices cannot deliver replies. Input capabilities continue to depend on verified adapters.

macOS and Windows downloads remain previews: macOS is ad-hoc signed, and Windows publisher signing is pending. Production store distribution and billing onboarding remain separate requirements.
