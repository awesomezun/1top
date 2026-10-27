# Windows Store distribution · v3.8.0

1top is moving to a Microsoft Store MSIX package. The Store listing has not been published. Test packages are not consumer installers and must not be linked from the public download button.

## Registration and identity

Register an individual developer account at https://storedeveloper.microsoft.com/. The account owner completes Microsoft sign-in, agreement acknowledgement, and identity verification. Reserve the product name, choosing **MSIX or PWA**, then copy these exact values from **Product management → Product identity**:

| JSON property | Partner Center field |
| --- | --- |
| `name` | Package/Identity/Name |
| `publisher` | Package/Identity/Publisher |
| `publisher_display_name` | Package/Properties/PublisherDisplayName |
| `display_name` | Reserved app display name |

Save the JSON as the repository Actions variable `WINDOWS_STORE_IDENTITY`. These values are public package identity, not signing secrets. The build rejects the CI identity and placeholder values for Store submissions. No real identity is checked in until Microsoft assigns it.

Run **Windows installers and MSIX** with `store_package=true`. It builds and tests the app, then creates:

```
release/v3.8.0/msix/store/1top-3.8.0.0-windows-x64-store.msix
```

This unsigned submission artifact is uploaded to Partner Center. Microsoft signs the final package after certification. It is not a file for users to double-click before certification. Keep the fourth version component at zero for submission.

## Packaging and runtime

- x64 desktop package, minimum Windows build 19041. Windows SDK MakeAppx performs manifest and payload validation.
- The Python runtime and collector are bundled; Python and Node.js are not required to run 1top. Node is used only by the synthetic CI fixture.
- `runFullTrust` is the only restricted capability. No administrator elevation, service, driver, or firewall exemption is requested.
- The collector binds to `127.0.0.1`. Local monitoring requires no account. Optional remote access uses an outbound connection and existing account authorization.
- The writable data path remains `%LOCALAPPDATA%\1top`, subject to Windows package virtualization. No credentials or user data are written into the immutable installation directory.
- WebView cookies and local storage use the per-user `webview` directory. Store updates must preserve these preferences.
- Microsoft’s signed Evergreen WebView2 bootstrapper is included and its Authenticode signature is verified at build time. If the runtime is missing, first launch offers to install it without requesting elevation. That setup requires an internet connection. A failure offers a recovery message and starts no collector.
- Packaged apps send update checks to Microsoft Store; the app does not replace its packaged executable or offer an EXE updater.
- Closing the window keeps the tray app running. **Quit 1top** ends its owned collector and leaves an independently started collector running.

## Validation

`scripts/test-windows-msix.ps1` runs only on a disposable GitHub Actions runner. It creates a short-lived test signing certificate, trusts it on that runner, installs the MSIX using Add-AppxPackage, and activates its registered Application User Model ID through IApplicationActivationManager. Both certificate entries and the package are removed afterwards. No test trust is installed on a user's machine.

`scripts/windows-msix-smoke.py` checks the rendered dashboard, live collector data, exact synthetic tokens, package identity, process ownership, persistent WebView state, loopback proxy isolation, and update behavior. Read the saved report for the actual results; a successful build alone is not install acceptance or Store certification.

Before a public submission, run Windows App Certification Kit in an active Windows desktop session using the final identity package, review all findings, and verify first launch on a consumer Windows installation. The GitHub Windows Server runner is not equivalent to every consumer machine. No assertion of Microsoft certification is made by this repository.

## Submission checklist

1. Finish account verification, reserve the name, and build with the assigned identity.
2. Upload the Store MSIX. Use the listing and reviewer notes in `windows-store-listing_v3.8.0.md`.
3. Provide actual Windows screenshots; complete age ratings, availability, and the capability explanation. Choose free local functionality. Managed remote access is not an open paid offering.
4. Review Windows App Certification Kit results and the final installation QA. Submit for Microsoft certification.
5. Only after publication, add the assigned `https://apps.microsoft.com/detail/<ProductId>` link to 1top.si and release metadata. The public Windows button must not point at the CI validation package.

## Sources

- [MSIX package components](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-manual-conversion)
- [Store package and signing requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements)
- [Packaged app filesystem behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes)
- [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Windows App Certification Kit](https://learn.microsoft.com/en-us/windows/uwp/debug-test-perf/windows-app-certification-kit)
