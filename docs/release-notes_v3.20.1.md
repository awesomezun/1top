# 1top v3.20.1

Includes [v3.20.0](release-notes_v3.20.0.md), with two presentation fixes:

- Preserve the time-range buttons across polling so an in-progress click or keyboard focus is not interrupted.
- Show both the date and time for token-flow ranges between one and seven days.

Validation: 281 Python tests passed for the v3.20.0 backend; gauge and session renderer checks passed. The browser suite covers custom ranges, saved selection, column resizing without reordering, stable period controls, theme/language changes, and narrow layouts. The installed Mac app was used to enter a 36-hour range and drag a column divider while preserving column order.
