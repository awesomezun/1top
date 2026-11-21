import subprocess


def read(run):
    try:
        raw = run(['tmux', 'list-panes', '-a', '-F', '#{pane_id}\t#{pane_title}'], timeout=3)
        return dict(line.split('\t', 1) for line in raw.splitlines() if '\t' in line)
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
