# Microsoft Store submission record · v1.0.0

Application version: 3.8.0.0 (x64). This record describes preparation, not Store certification or publication.

## Registered identity

The individual developer account and the `1top` MSIX product are registered in Partner Center.

| Field | Assigned value |
| --- | --- |
| Store product ID | `9N5QC53K1X5R` |
| Package/Identity/Name | `1top.1top` |
| Package/Identity/Publisher | `CN=C67D4C93-82EC-4ADD-871B-12E21D388915` |
| Package/Properties/PublisherDisplayName | `1top` |
| Package family | `1top.1top_r8xhxszfcrbgp` |
| Display name | `1top` |

These are public package identifiers, not credentials. `WINDOWS_STORE_IDENTITY` holds the four build identity properties in GitHub Actions.

## Store copy

Keep the product name `1top`. Use `AI Agent Monitor` in the English **Short description** field, rather than appending it to the installed app name. Use `AI 에이전트 모니터` for the Korean short description. The rest of the prepared listing is in [windows-store-listing_v3.8.0.md](windows-store-listing_v3.8.0.md).

Microsoft calls this field Short description, not Subtitle. Its placement depends on the Store view. These values are prepared copy; saving them in Partner Center must be verified separately.

## Submission artifact

- Build: [Windows installers and MSIX #40618196166](https://github.com/awesomezun/1top/actions/runs/40618196166), successful.
- Source: `65ee1c6dd9e0d96db8396e83fc1280c7eaed45cf`.
- File: `1top-3.8.0.0-windows-x64-store.msix`.
- Bytes: `27262940`.
- SHA-256: `54f439a9dae561fa8a7231352b5a01ff2e3efb5781717a70693d7d873ec6c7e2`.
- Manifest name, publisher, version, architecture and display name match the assigned identity.
- The artifact is unsigned for Partner Center submission. It is not a consumer download.

## Release gates

The registered product is a draft. Complete the listing, upload the package, review final-identity installation and Windows App Certification Kit results, complete age ratings and product settings, and submit for certification. Consumer Windows installation acceptance and Microsoft approval remain separate from CI results. Do not enable the public Store download button until the product is published.

## Initial final-identity validation

[Validation run #40618637617](https://github.com/awesomezun/1top/actions/runs/40618637617) installed and activated this exact identity successfully. Collection, Store update routing, package removal, temporary test-trust removal, and original artifact integrity were verified. The report is preserved in [qa/windows-store_v3.8.0](qa/windows-store_v3.8.0).

WACK returned `WARNING`, despite process exit code 0. Its required DPI-awareness check warned about the executable. The optional blocked-executables check also flagged process-launch API references and strings in bundled runtime/font files. This package therefore does not claim a clean WACK pass. Version 3.8.1 adds an explicit DPI manifest and must be checked separately.

## Sources

- [Microsoft Store short description](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/add-and-edit-store-listing-info#short-description)
- [MSIX package signing for Store submissions](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements#code-signing-for-microsoft-store-submissions)
