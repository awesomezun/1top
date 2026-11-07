# Contributing

Add a provider in small, independently reviewable changes. Keep process detection, token parsing, application attribution, and action capabilities separate. Use synthetic logs in tests; do not commit conversations or credentials.

A token adapter must handle repeated records, cumulative counters, resets, cache accounting, partial records, and missing values. A control adapter must identify the exact live process/terminal, fail closed on mismatches, and never target the whole IDE as a shortcut. Pause means interrupting the current request where supported; resume sends a new request and may consume additional tokens.

Run the Python tests and the relevant desktop checks listed in .github/workflows/checks.yml. Update the support table when behavior changes. Include the OS/tool version and a reproducible synthetic case in bug reports.
