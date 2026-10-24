"""Small OS boundaries shared by the collector and desktop launchers."""
import getpass
import os
import platform
from pathlib import Path


def data_directory(home=None):
    home = home or Path.home()
    override = os.environ.get('ONETOP_DATA') or os.environ.get('AGENT_MONITOR_DATA')
    if override:
        return Path(override)
    if platform.system() == 'Windows':
        return Path(os.environ.get('LOCALAPPDATA', str(home/'AppData/Local')))/'1top'
    if platform.system() == 'Darwin':
        return home/'Library/Application Support/1top'
    return Path(os.environ.get('XDG_STATE_HOME', str(home/'.local/state')))/'1top'


def lock_instance(handle):
    if os.name == 'nt':
        import msvcrt
        handle.seek(0)
        if not handle.read(1):
            handle.write('0'); handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError as error:
            raise BlockingIOError('Already running') from error
    else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def owned_process(process):
    if os.name == 'nt':
        import psutil
        return process.username().casefold() == psutil.Process().username().casefold()
    return process.uids().real == os.getuid()


def process_terminal(process):
    return process.terminal() or '' if hasattr(process, 'terminal') else ''


def cli_command(executable, *args):
    """Resolve npm launchers without feeding paths or arguments into cmd.exe."""
    if os.name != 'nt' or Path(executable).suffix.lower() not in ('.cmd', '.bat'):
        return [executable, *args]
    import shutil
    entries = {'codex':'@openai/codex/bin/codex.js', 'claude':'@anthropic-ai/claude-code/cli.js'}
    entry = entries.get(Path(executable).stem.lower())
    script = Path(executable).parent/'node_modules'/(entry or '_missing_')
    node = shutil.which('node')
    if node and script.is_file():
        return [node, str(script), *args]
    raise OSError('The installed CLI launcher could not be resolved safely.')
