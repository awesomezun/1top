# 1top v3.8.0 · Windows MSIX distribution

Windows now has a Microsoft Store MSIX build path. Account verification, the assigned Partner Center identity, final certification checks, and Store publication remain pending. No consumer Store-signed package is published by this change.

The package bundles Python and the collector, declares only `runFullTrust`, and includes Microsoft's signed Evergreen WebView2 bootstrapper for PCs missing the runtime. Store packages use writable per-user storage and direct updates to Microsoft Store. Test certificates are limited to disposable Windows CI runners and removed after the test.

Windows does not provide Unix load averages. Formatting the missing metric previously interrupted dashboard rendering and produced a misleading connection error. The renderer now shows the metric as unreported, while the sessions, token map, CPU and memory continue to update. On small work areas the native window opens maximized.

Installation validation uses the actual MSIX registration and Application User Model ID, then verifies live rendered data, zero-session startup, Unicode paths, bad proxy settings, collector ownership, persisted browser state, legacy user data, and an in-place MSIX update. It checks both lifetime and recently recorded synthetic usage. It does not consume a real AI subscription.

See [Windows Store distribution](windows-store_v3.8.0.md), [submission copy](windows-store-listing_v3.8.0.md), and [verification evidence](qa/windows-msix_v3.8.0/verification.json). Windows App Certification Kit with the final assigned identity, a consumer Windows acceptance pass, and Microsoft's certification remain release gates. Existing macOS, Android and iOS distribution states are unchanged.
