# Workspace design benchmark v1.0.0

Scope: official public screenshots/docs and a pinned T3 Code source review, not authenticated competitor testing or a usability study. No third-party product images are distributed in 1top.

| Reference | Observed pattern | Application in 1top 2.0.0 |
| --- | --- | --- |
| [T3 Code](https://t3.codes/) and [sidebar source at 27e0c684](https://github.com/pingdotgg/t3code/blob/27e0c684c585f955252d65f06206dd11a143bff5/apps/web/src/components/sidebar/SidebarThreadRow.tsx) | Persistent project/thread context, restrained status color, secondary inspector | Persistent workspace navigation, clear app/terminal identity, nonmodal session inspector, explicit current/observed states |
| [Linear dashboards](https://linear.app/docs/dashboards) | Quiet panels, scoped filters, charts and tables with deliberate hierarchy | Neutral dark surfaces, contained six-window selector, tabular numeric values and searchable session table |
| [Datadog dashboard configuration](https://docs.datadoghq.com/dashboards/configure/) | Time-scoped operational investigation | Visible rolling windows and report coverage, resources next to session usage |
| [Langfuse token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking) | Provider/model usage context | Reported token components kept distinct from monetary billing; unknown remains unknown |

New information architecture: local Sessions, Activity, System, Measurement; optional hosted workspace with devices, sessions and minimized activity summaries. Free local monitoring is the primary flow. The web homepage clearly separates currently implemented local monitoring, limited managed access, and planned customer-owned cloud automation.

Visual implementation uses system fonts, 15px base text, 14px table values, 24–29px numeric summaries, a near-black canvas, subtle borders and one restrained blue selection color. Auxiliary labels are smaller; no decorative charts or generated usage values are shown in live data. Demo data remains explicitly synthetic.

Activity semantics: both Claude Code and Codex support Goal; `/loop` belongs to Claude Code. GLM is a model provider when used through Claude Code, not the owner of its `/loop` feature. Installed skill files do not establish enablement or successful execution.

Official behavior references: [Claude Code Goal](https://code.claude.com/docs/en/goal), [Claude Code scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks), [Codex Goals](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex). Local Claude Code 2.1.309 record shapes were inspected read-only; proprietary implementation code is not copied or distributed.
