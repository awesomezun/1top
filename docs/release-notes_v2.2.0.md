# 1top v2.2.0 / landing v4.0.0

Session views and existing AI filters remain available. The local sidebar adds host-application navigation, and the session table adds an independent model selector. Aside appears as a host app; its session row displays the actual reported model. Claude Code is spelled out in the interface. Host application inventory now recognizes arbitrary macOS app bundles without requiring a product-name allowlist; this observation alone does not imply an active AI task.

The menu-bar label is always 1top. The compact panel uses a stable height with scrollable content so switching to account quotas does not clip the header or change its anchor.

The public landing page shows three separate automatically playing recordings: the desktop dashboard, native compact panel, and account quotas. The recordings use the production UI with generated fixture data, never local conversations or account details. There are no preview tabs. Offscreen media pauses, and reduced-motion preferences and a pause control are respected. Source hashes and output checksums are retained in scripts/showcase_v4.0.0/manifest.json. Existing versions are preserved under local checkpoints and README archives.

Validation: 73 Python tests and native model checks pass; the complete app compiles and its local signature verifies. Browser checks retain AI filtering, add app filtering and model selection, and restore all example sessions after clearing filters. The three recordings are visually inspected and the landing page is checked at desktop and narrow widths. Public desktop installer signing/notarization remains pending.
