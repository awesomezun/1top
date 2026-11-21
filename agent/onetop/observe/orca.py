"""Raw live tab identities; no directory/title inference."""
import json
import subprocess
from ..discovery import orca_executable


def read(run):
    try:
        result = json.loads(run([orca_executable(), 'terminal', 'list', '--json'], timeout=5))['result']
        return result.get('terminals', [])
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        return None


def agents(run):
    """What Orca itself reports for each agent seat: state and conversation name."""
    try:
        result = json.loads(run([orca_executable(), 'worktree', 'ps', '--json'], timeout=5))['result']
        return [{'paneKey': a.get('paneKey'), 'type': a.get('agentType'), 'state': a.get('state'),
                 'interrupted': bool(a.get('interrupted')),
                 'verifiable': (a.get('activity') or {}).get('status') != 'unverifiable', 'since': a.get('stateStartedAt'),
                 'name': a.get('conversationName') or (a.get('activity') or {}).get('title') or ''}
                for w in result.get('worktrees', []) for a in w.get('agents', []) if a.get('paneKey')]
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
        return None
