# Mobile conversation contract v1.2.0

This extends v1.1.0 with burst-message handling. Its photo and request-scoped activity contracts are unchanged.

## Accept before dispatch

All `message` actions enter the computer's private, durable queue before the acceptance receipt. They do not compete with a long-running control for a terminal-input lock. The collecting computer revalidates process identity when it dispatches the message. Messages for one terminal are dispatched in accepted order; input is not repeated after an ambiguous send. An existing request ID with the same session, text and photo identities returns its existing state, including after restart. Different content with that ID is rejected.

A new message can be accepted while the preceding message's terminal turn is starting. This does not make destructive controls available during that transition. A busy session cannot starve the queue of another session.

Up to 100 unresolved messages are retained. A full queue explicitly refuses a new request; the client must retain its draft. History pruning retains the latest 200 terminal outcomes and never removes unresolved requests. An undelivered message expires after 15 minutes or when its verified session identity is replaced; its row remains `not_delivered`. An uncertain transport is never resent automatically.

## Mailbox responses are updates

The response contains at most 10 **recently changed** rows, sorted chronologically within that window. The computer reads replies for every unresolved request, including earlier requests pushed out of the initial display window by a burst. A late reply re-enters the update window; current response activity takes priority.

Clients must merge rows **by request ID within the exact device/session**, retaining earlier known rows. They must not replace the whole timeline with each response. Clear cached activity on refresh, then apply the received activity fields, so a phase does not remain animated after its row stops reporting activity. A server-confirmed row is no longer a local-only pending row. A delayed delivery receipt must not regress `replied` to `awaiting_reply`.

## Drafts while sending

Keep drafts and photos per device/session. A late success or failure for one send must not erase or replace newly typed text/photos, including text entered for the same session during the request. Keep the immutable sent payload associated with its request ID. Preserve explicit rejection versus ambiguous delivery; do not automatically generate another request ID and resend.

Required checks include rapid sequential sends, input during an earlier request, switching sessions during a request, reordered receipt/reply events, more than 10 messages followed by an early reply, reconnection and collector restart.
