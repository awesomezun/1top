# 1top v2.4.0 · Site v4.2.0

- Added proportional token treemaps for sessions, host applications, execution tools and models. The selected 10-minute through 24-hour window determines the areas. Unknown reports are excluded and remain distinct from reported zero usage.
- Selecting a session tile opens its context map. The map shows the latest reported request input, partitioned into fresh input, cache reads and cache writes when available. Output and reserved tokens are excluded. Reported capacity enables an input-based free-space region; unknown capacity is never guessed from a model name. File and system-prompt breakdowns are not currently reported.
- Context summaries cross the relay as allowlisted numeric data. Raw prompts, file contents and private paths are not added to the payload. Older collectors remain compatible.
- Local session details and the remote web dashboard include context maps. Existing session, AI, application, model, account, activity and control views remain available.
- The landing page displays a fourth native recording for the maps. Menu and account scenes include a macOS menu bar with the same waveform symbol used by the installed app, aligned over the popup. All public recordings use synthetic fixtures.

Validation: 88 Python tests; map aggregation, unknown/zero distinctions, exact area and non-overlap checks; 24 relay tests and TypeScript checking; native macOS build and signature verification. Browser checks cover period/group changes, session selection, known/unknown capacity, remote demo maps and mobile layout. Public distribution signing and notarization remain in preparation.
