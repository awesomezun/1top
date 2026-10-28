# Microsoft Store submission record · v1.1.0

Application version: 3.8.1.0 (x64). Supersedes the 3.8.0 package described in [v1.0.0](windows-store-submission_v1.0.0.md), which remains preserved. This is a submission candidate, not a certified consumer installer.

## Identity and copy

The individual developer account and `1top` product are registered. Store product ID: `9N5QC53K1X5R`. Package name: `1top.1top`. Publisher: `CN=C67D4C93-82EC-4ADD-871B-12E21D388915`. Publisher display name and installed display name: `1top`. Package family: `1top.1top_r8xhxszfcrbgp`.

Keep the product name `1top`. The prepared English Short description is `AI Agent Monitor`; the Korean equivalent is `AI 에이전트 모니터`. This field serves as a subtitle in supported Store layouts. These descriptions have not yet been saved in Partner Center.

## Artifact and checks

- [Build #40619202111](https://github.com/awesomezun/1top/actions/runs/40619202111): successful; 7 installed MSIX scenarios and 4 installed EXE scenarios passed.
- Application source: `f00420e421541e8252b326e8bb3ef13dfae596f2`.
- Submission filename: `1top-3.8.1.0-windows-x64-store.msix`.
- Size: `27262860` bytes.
- SHA-256: `3a69036f78693893e346a0a6ec2bdf0d809a3599a6a9bbf940159adec4bcc863`.
- The manifest matches the Store identity. There is no `AppxSignature.p7x`; Microsoft signs during publishing after certification.
- [Final-identity validation #40619968408](https://github.com/awesomezun/1top/actions/runs/40619968408): installation, registered activation, collection, and Store update routing worked. A separately test-signed copy was used only in the disposable runner. The source file stayed unchanged, and package/test certificate cleanup passed.
- The embedded EXE manifest declares `PerMonitorV2, PerMonitor`. The running process independently reported `GetProcessDpiAwareness` HRESULT 0, awareness 2 (per-monitor aware).

## Open validation finding

The final-identity validation workflow is **failed**, because it deliberately rejects unresolved mandatory Windows App Certification Kit findings. WACK's process exit code was 0, but its XML overall result was `WARNING`:

1. Required `DPIAwarenessValidation`: `WARNING`, saying it failed to process the binary. This remains unresolved despite the embedded manifest and runtime evidence above. Do not describe WACK as passed.
2. Optional `Blocked executables`: `FAIL`, for process-launch API references and string matches in bundled runtimes/font files. This is an optional informational test. The collector launches its bundled child executable; the signed Microsoft WebView2 bootstrapper is used when the runtime is missing. Windows S-mode acceptance is not claimed.

Evidence: [verification.json](qa/windows-store_v3.8.1/verification.json), [full WACK XML](qa/windows-store_v3.8.1/wack.xml), and [installed screenshot](qa/windows-store_v3.8.1/store-installed.png). Tests ran on Windows Server 2025 in GitHub Actions; consumer Windows acceptance remains outstanding. The remaining WACK warning needs consumer Windows confirmation or Microsoft review before a clean certification-readiness claim.

## Partner Center status

The product remains a draft. Package upload, listing save, age ratings, final settings, certification submission, and publication have not been completed. Chrome is authenticated. Native UI input was blocked by `window_not_focused` / no focused window; the owner was asked to foreground the existing Chrome window. The public website still correctly shows Store preparation rather than a live download.

## References

- [Microsoft Store Short description field](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info#short-description)
- [Required versus optional Desktop Bridge tests](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-desktop-bridge-app-tests#required-versus-optional-tests)
- [Microsoft DPI awareness manifest guidance](https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process)
