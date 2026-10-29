# 1top v4.0.4

Claude foreground-to-background continuations now keep one session row and follow the verified new executor and transcript. Daemon and PTY helper processes no longer create competing input targets. Copied transcript context is counted once; account identity stays attached to its source usage. Queued messages and replies follow verified continuations, while destructive actions still require the current process key. A completed Claude turn can leave a background shell running; its durable completion record now permits queued delivery when the registry matches that completion.

iPhone v4.1.0 build 5 adds direct theme and Korean/English/Chinese controls with circular reveal and preserves the live connection. The physical iPhone check passed, including relaunch and restoration.

Validation: 359 Python tests, all 10 JavaScript test files, Swift model checks, and all 75 frontend freeze entries passed. Real transcript replay recovered 71.3M tokens of recent usage with no additional events on reread. The installed Mac delivered one queued diagnostic message to the continued Claude session and the production reply reader found its correlated answer. See `docs/qa/continuation-and-iphone_v4.0.4.json` for scope and limits. Public download releases are unchanged.
