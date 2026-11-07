"""Application/terminal attribution independent of any terminal vendor.

Only named CLI executables/package entrypoints create agent session rows.
An open IDE alone is an application observation, not evidence of an active AI turn.
"""
from pathlib import Path
import os,re,shutil,subprocess
import psutil
from .platform_support import owned_process, process_terminal

CLI_NAMES={'claude':'Claude','codex':'Codex','gemini':'Gemini','opencode':'OpenCode',
           'aider':'Aider','goose':'Goose','agy':'Antigravity','qwen':'Qwen Code',
           'copilot':'GitHub Copilot','droid':'Droid','amp':'Amp'}
PACKAGES={'@anthropic-ai/claude-code':'Claude','@openai/codex':'Codex',
          '@google/gemini-cli':'Gemini','@github/copilot':'GitHub Copilot',
          '@qwen-code/qwen-code':'Qwen Code','opencode-ai':'OpenCode'}
APP_NAMES={'Cursor','Visual Studio Code','Code','Code - Insiders','Windsurf','Zed',
           'WindowsTerminal','Windows Terminal','powershell','pwsh','cmd','conhost','OpenConsole','Antigravity','Terminal','iTerm','iTerm2','Warp','Ghostty','Alacritty',
           'WezTerm','IntelliJ IDEA','PyCharm','WebStorm','Orca','ChatGPT','Claude'}

def cli_kind(name,args):
    executable=Path(name).name.lower().removesuffix('.exe')
    if executable in CLI_NAMES:return CLI_NAMES[executable]
    if executable in ('node','nodejs','python','python3','python3.11','python3.12','python3.13'):
        # The entrypoint only; never classify based on a prompt in later arguments.
        entry=str(args[1]).replace('\\','/') if len(args)>1 else ''
        for package,kind in PACKAGES.items():
            if '/node_modules/'+package+'/' in entry:return kind
        if executable.startswith('python') and len(args)>2 and args[1]=='-m' and args[2]=='aider':return 'Aider'
    return None

def app_from(path,name=''):
    match=re.search(r'([^/]+)\.app(?:/|$)',path or '')
    if match:return match.group(1),str(path).split('.app',1)[0]+'.app'
    base=Path(name).stem
    return (base,path or '') if base in APP_NAMES else ('','')

def inventory():
    rows={}
    for p in psutil.process_iter(['pid','ppid','name','exe','cmdline','cwd','create_time']):
        try:
            d=p.info
            if not owned_process(p):continue
            rows[p.pid]={'pid':p.pid,'ppid':d['ppid'],'name':d['name'] or '',
                'app':app_from(d['exe'],d['name']),'kind':cli_kind(d['name'] or '',d['cmdline'] or []),
                'cwd':d['cwd'] or '', 'birth':d['create_time'], 'tty':process_terminal(p)}
        except (psutil.Error,AttributeError):continue
    return rows

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
