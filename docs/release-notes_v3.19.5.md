# 1top v3.19.5

- Column width handles are thin vertical lines with a wider drag target. Mouse and keyboard resizing remain available.
- Burn-rate gauges share a linear scale of 1, 2, 5, 10, 20, 50, 100, 200 percent per hour and beyond. The active range appears below the column heading. Higher rates expand the range immediately; a lower range requires a sustained drop to avoid flickering scales.
- Navigation reads Dashboard, Account limits, Computer resources, Usage map, Goals · Loops · Skills, Measurements.
- The Mac window uses a compact, single-row toolbar with icon buttons and accessible labels.

Validated with the browser presentation regression suite, gauge scale tests, session renderer tests, weekly usage tests, an optimized macOS build, and the installed v3.19.5 app. Browser mutation tests use mocked actions; no live terminal controls are exercised.

The local macOS build remains ad hoc signed. Developer ID signing and Apple notarization are not included.
