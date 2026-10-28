# Editable digital dashboard — v3.19.1

This local release extends the v3.18.0 overview without replacing its collectors, account calibration, session hierarchy, or controls. v3.19.0 introduced the dashboard; v3.19.1 adds the GitReels preference animations and corrects composite language labels. Both earlier application bundles are preserved in versioned backups.

## Behavior

- The main view is named Dashboard. The prominent time buttons precede compact resource/account rows, the token chart, quilt map, and session table. Detailed account, map, resource, and operations views remain available.
- Selected-period usage occupies its own column. A separate burn-rate gauge supports percent per hour or minute. Missing calibration remains unknown. Session memory is RSS divided by total host RAM; exact bytes remain on hover. Open, pause, resume, and stop controls retain their original eligibility checks.
- Table headers support mouse drag to reorder and edge drag to resize. Keyboard arrows reorder a focused header; Shift+arrows resize it. Resizer buttons also accept arrows. The changes survive polling and reload.
- Edit enables dashboard panel move/resize controls. Panel positions, widths, and heights persist. A resized session panel scrolls its table within the chosen height.
- The sun/moon and EN/한/中 controls follow the user-owned GitReels design. Theme changes reveal the new page in a 700 ms circle from the button. Language changes use the same 1,100 ms expanding green character ring as GitReels `Prefs.tsx` and `matrixVeil.ts`. Reduced-motion mode or an engine without View Transitions applies preferences immediately. Rapid picks retain the latest choice and remove temporary canvases.
- Confirmed Orca terminal titles can be edited through the pencil/title button. The backend validates title text, re-resolves process/terminal identity, and invokes the CLI with an argument array. Idempotent requests do not repeat the mutation. No terminal input, pause, or termination is used for renaming. Other terminal hosts do not acquire an unsupported rename control.
- Only display/layout preferences are saved in browser storage. The production WKWebView now preserves that storage across restarts; test WebViews remain ephemeral. Native summary appearance follows the dashboard theme. The native macOS menus/popover text and some diagnostic descriptions remain Korean; the three-language switch covers dashboard interface labels.

## Verification

- 275 Python tests passed, including rename validation, exact arguments, stale terminal rejection, idempotency, and immediate metadata publication. Existing Keychain, passive reporting, calibration, hierarchy, controls, and server safeguards remain covered.
- JavaScript session renderer/click, weekly, and map suites passed. The session test now asserts selected-period usage and burn rate separately, including unknown stale rates.
- `tests/dashboard-browser.py` uses a read-only live snapshot in an isolated preview server; every control POST is mocked. It checks retained controls, percent memory, units/periods, real mouse column dragging/resizing, keyboard panel edits, scrolling after panel height changes, persistent layout/preferences, languages, light/dark readability, guarded rename payloads, and widths 1100/768/390 without outer overflow.
- Animation QA confirms an active View Transition animation, nontransparent pixels in the language ring canvas, cleanup, rapid sequential picks, and reduced-motion behavior. Theme/language transition screenshots were visually inspected.
- Full Swift typecheck and optimized macOS builds passed. Both v3.19.0 and v3.19.1 passed strict ad-hoc signature verification.
- The installed collector reports v3.19.1 and 45 root sessions. Served HTML, application JS, dashboard JS/CSS, translations, and effects match source byte-for-byte. Installed native UI confirms the renamed main view, separate rate gauge, RAM percentages, controls, and preferences. Light theme and English selection persisted when replacing/restarting the app. The user continued interacting with the installed dashboard during verification.

No real AI session was paused, stopped, or renamed for UI QA. No public release, notarization, Store submission, or hosted/mobile deployment is claimed.

Local evidence: `build/tests-v3.19.1.log`, `build/dashboard-browser-v3.19.1.json`, `build/runtime-qa-v3.19.1.json`, `build/theme-reveal-v3.19.1.png`, `build/language-reveal-v3.19.1.png`, and `build/macos-build-v3.19.1.log`.
