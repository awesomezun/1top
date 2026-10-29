# 1top v3.20.0

- Add a Custom range action beside the existing time buttons. Enter minutes, hours, or days, with a minimum of 10 minutes; All history selects the retained recording horizon. The chosen period survives reload and applies to token charts, usage maps, and session ranking.
- Keep local token reports beyond 24 hours. Previously deleted reports are not reconstructed. Provider quota history has its own retention and remains partial when the requested period exceeds the available reports.
- Aggregate long-range charts into at most 240 time bins per provider. Requests use a read-only database connection, preserve the exact period boundary, and do not change another client's selected range.
- Give Dashboard a larger, accented menu entry while keeping all menu labels aligned.
- Restrict column reordering to the column-name button. The thin divider only resizes width; it no longer sits inside a draggable header.

Includes the navigation naming/order, shared adaptive burn-rate scales, and compact Mac toolbar from v3.19.6.
