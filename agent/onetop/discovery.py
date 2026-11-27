"""Application/terminal attribution independent of any terminal vendor.

Only named CLI executables/package entrypoints create agent session rows.
An open IDE alone is an application observation, not evidence of an active AI turn.
"""
from pathlib import Path
import os,re,shutil,subprocess
import psutil
from .platform_support import owned_process, process_terminal
from . import _rust_bridge

APP_NAMES={'Cursor','Visual Studio Code','Code','Code - Insiders','Windsurf','Zed',
           'WindowsTerminal','Windows Terminal','powershell','pwsh','cmd','conhost','OpenConsole','Antigravity','Terminal','iTerm','iTerm2','Warp','Ghostty','Alacritty',
           'WezTerm','IntelliJ IDEA','PyCharm','WebStorm','Orca','ChatGPT','Claude'}

def cli_kind(name,args,exe=''):
    from .observe.processes import cli_kind as classify
    return classify(name,args,exe)

def _py_app_from(path,name=''):
    match=re.search(r'([^/]+)\.app(?:/|$)',path or '')
    if match:return match.group(1),str(path).split('.app',1)[0]+'.app'
    base=Path(name).stem
    return (base,path or '') if base in APP_NAMES else ('','')

def app_from(path,name=''):
    m=_rust_bridge.mode()
    if m=='old':return _py_app_from(path,name)
    if m=='new':return _rust_bridge.native.proc_app_from(str(path or ''),str(name or ''))
    return _rust_bridge.shadow_check('discovery.app_from',_py_app_from(path,name),
                                     _rust_bridge.native.proc_app_from(str(path or ''),str(name or '')))

# Claude Code 2.1 writes busy/shell/idle/waiting; busy and shell are an active turn.
REGISTRY_STATES={'busy':'working','shell':'working'}


def registry_status(reg):
    status=reg.get('status','unknown')
    return REGISTRY_STATES.get(status,status)


def claude_transcript(root, sid):
    """Match exact session identity inside its own profile, never a global SID index."""
    if not isinstance(sid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]+',sid):return None
    paths=list((Path(root).expanduser()/'projects').glob('*/'+sid+'.jsonl'))
    return str(paths[0]) if len(paths)==1 else None


def inventory():
    from .observe.processes import Reader
    return {row['pid']:row for row in Reader().read()}

def context(pid,rows):
    visited=set();current=pid;nearest=None
    while current and current not in visited and current in rows:
        visited.add(current);row=rows[current]
        if row['app'][0]:
            nearest=row['app']
            if nearest[0] in APP_NAMES:break
        current=row['ppid']
    row=rows.get(pid,{})
    return {'app':nearest[0] if nearest else ('Terminal' if row.get('tty') else 'Background process'),
            'app_path':nearest[1] if nearest else '', 'terminal':row.get('tty',''),
            'match':'process_ancestry' if nearest else 'tty' if row.get('tty') else 'process'}

def applications(rows):
    seen={}
    for row in rows.values():
        name,path=row['app']
        # Bundle ancestry identifies arbitrary host applications; the name list
        # is only a fallback for processes whose executable path is unavailable.
        if name and (path or name in APP_NAMES) and (name not in seen or row['pid']<seen[name]['pid']):
            seen[name]={'name':name,'pid':row['pid'],'path':path,'evidence':'application_process',
                        'note':'App detected; embedded AI sessions require a usage adapter.'}
    return list(seen.values())

def orca_executable():
    explicit=os.environ.get('ORCA_CLI_COMMAND')
    if explicit:return explicit
    # Prefer the current per-user installation over a stale system-wide launcher.
    local=Path.home()/'.local/bin/orca'
    return str(local) if local.is_file() else shutil.which('orca') or str(local)
