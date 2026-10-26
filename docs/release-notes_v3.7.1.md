# 1top v3.7.1 — Windows startup fix

Windows no longer waits for the first complete session scan before opening the local dashboard. The app connects to a lightweight health endpoint, and local health/state requests bypass HTTP proxies. Collection readiness remains a separate state; pending data is not reported as collected usage.

Failed startup closes the collector owned by that window and presents a retry dialog instead of an unhandled Python exception. Local diagnostics are stored in `%LOCALAPPDATA%\1top\logs` (or the configured data directory). Externally started collectors remain running when the dashboard closes, and remote reconnection preserves the selected local port.

The previous installer smoke test started the collector separately before opening the app. It did not test ordinary first launch. The replacement tests install the EXE and exercise empty first launch, standalone app launch with a synthetic CLI, standalone launch with HTTP proxy settings, and an already running collector, using a Unicode data path. They check live data in WebView2 and child-process ownership/cleanup. Additional unit tests cover readiness before the first scan, unrelated local services, legacy collectors, timeout cleanup and child exit.

This release contains a Windows installer update. The macOS download remains v3.7.0 while Developer ID signing and Apple notarization are pending. The Windows EXE remains an unsigned preview; this startup fix does not establish SmartScreen reputation or replace publisher signing. The reporting user's Windows PC has not been remotely inspected or retested.
