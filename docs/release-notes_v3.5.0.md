# 1top v3.5.0 — remote AI instructions

Mobile and web can send a user-written instruction to an identified AI session through the existing authenticated, outbound connection. The phone and computer do not need the same LAN.

- Input-verified idle Orca sessions receive a new prompt. Active terminal work must first stop; permission prompts and ambiguous input targets are rejected.
- Running Aside sessions receive a queued follow-up; idle Aside sessions receive a resume prompt for the exact account/session.
- Delivery is recorded before input, uncertain actions are never replayed automatically, and changed prompt bodies cannot reuse a request ID.
- The relay stores delivery metadata and a SHA-256 fingerprint, not the instruction body. The recipient tool may retain the instruction in its conversation history.
- Mobile v1.4.0 retains working-first ordering and adds a multiline instruction composer with target confirmation.

Validation: 114 Python tests and 54 relay tests pass, including duplicate requests, changed bodies, stale/capability guards and body-free receipts. Web and mobile type checks pass. Real provider execution is distinct from transport tests; a received instruction is not proof that its task completed. Public installers remain previews until production signing/store publication are available.
