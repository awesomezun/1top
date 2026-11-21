"""Best-effort, type-only diagnostics: a broken log sink must not stop collection."""


def failure(component, error):
    try:
        print(component + ':', type(error).__name__, flush=True)
    except Exception:
        # In particular EMFILE/ENOSPC, or a closed stdout during shutdown.
        pass
