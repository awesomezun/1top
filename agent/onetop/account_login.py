"""Explicit local account enrollment via each installed CLI's official login.

Only a user-initiated, CSRF-guarded local request can launch this flow. Scripts
contain no credentials. A separate profile leaves existing CLI sessions alone.
"""
import os
import json
import sys
import base64
import re
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from .platform_support import data_directory, cli_command


def managed_profiles_dir(home=None):
    home = home or Path.home()
    data = data_directory(home)
    return Path(data)/'accounts'


def executable(name):
    candidates = [shutil.which(name), str(Path.home()/'.local/bin'/name), '/opt/homebrew/bin/'+name, '/usr/local/bin/'+name]
    candidates += [str(p) for p in sorted((Path.home()/'.nvm/versions/node').glob('*/bin/'+name), reverse=True)]
    return next((p for p in candidates if p and Path(p).is_file() and os.access(p, os.X_OK)), None)


def login_script(kind, cli, profile):
    # A clean environment prevents inherited gateway/API-key credentials from
    # taking precedence over the newly chosen subscription account.
    env = {k: os.environ[k] for k in ('HOME','USER','LOGNAME','TMPDIR','LANG') if k in os.environ}
    env['PATH'] = str(Path(cli).parent)+':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    if kind == 'Claude':
        env['CLAUDE_CONFIG_DIR'] = str(profile)
        args = [cli, 'auth', 'login', '--claudeai']
    else:
        env['CODEX_HOME'] = str(profile)
        args = [cli, '-c', 'cli_auth_credentials_store="file"', 'login']
    command = ['/usr/bin/env', '-i', *[k+'='+v for k,v in env.items()], *args]
    return '#!/bin/sh\numask 077\ncd '+shlex.quote(str(profile))+'\n'+shlex.join(command)+'\n'


def statusline_command(spec):
    args = [sys.executable]
    if not getattr(sys, 'frozen', False):
        args += ['-m', 'onetop.cli']
    args += ['statusline', '--config', str(spec)]
    return subprocess.list2cmdline(args) if os.name == 'nt' else shlex.join(args)


def install_new_claude_statusline(profile):
    """Initialize only a newly created, empty 1top-owned account profile."""
    profile = Path(profile).resolve()
    if any(profile.iterdir()):
        raise FileExistsError('New profile is not empty')
    spec = profile/'1top-statusline.json'
    values = [(spec, {'profile': str(profile), 'original_command': '',
                     'report_directory': str(Path(data_directory()).resolve()/'claude-statusline')}),
              (profile/'settings.json', {'statusLine': {'type': 'command',
                                                       'command': statusline_command(spec)}})]
    for path, value in values:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, separators=(',', ':'))


class AccountLogin:
    def __init__(self, directory=None):
        self.directory = directory or managed_profiles_dir()
        self.lock = threading.Lock()
        self.last = 0

    def start(self, kind):
        from .controls import ActionError
        if kind not in ('Claude', 'Codex'):
            raise ActionError('이 제공자의 추가 로그인 방식은 아직 연결되지 않았습니다.', 400)
        cli = executable('claude' if kind == 'Claude' else 'codex')
        if not cli:
            raise ActionError(('Claude Code' if kind == 'Claude' else 'Codex')+' CLI를 먼저 설치해 주세요.', 409)
        if kind == 'Claude':
            try:
                result = subprocess.run(cli_command(cli,'--version'),capture_output=True,text=True,timeout=5)
                match = re.search(r'(\d+)\.(\d+)\.(\d+)',result.stdout)
                if not match or tuple(map(int,match.groups())) < (2,1,310):
                    raise ValueError()
            except (OSError,ValueError,subprocess.SubprocessError):
                raise ActionError('계정 분리를 위해 Claude Code 2.1.310 이상으로 업데이트해 주세요.',409)
        with self.lock:
            if time.monotonic()-self.last < 10:
                raise ActionError('방금 연 로그인 창을 확인해 주세요.',409)
            parent = self.directory/kind.lower()
            parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            if len(list(parent.iterdir())) >= 32:
                raise ActionError('저장된 프로필이 많습니다. 계정 프로필 폴더를 확인해 주세요.',409)
            profile = parent/str(uuid.uuid4())
            profile.mkdir(mode=0o700)
            try:
                if kind == 'Claude':install_new_claude_statusline(profile)
                if os.name=='nt':
                    quote=lambda x:"'"+str(x).replace("'","''")+"'"
                    key='CLAUDE_CONFIG_DIR' if kind=='Claude' else 'CODEX_HOME'
                    args=['auth','login','--claudeai'] if kind=='Claude' else ['-c','cli_auth_credentials_store="file"','login']
                    command=cli_command(cli,*args)
                    script='; '.join(["Remove-Item Env:ANTHROPIC_API_KEY,Env:ANTHROPIC_AUTH_TOKEN,Env:ANTHROPIC_BASE_URL,Env:OPENAI_API_KEY -ErrorAction SilentlyContinue",'$env:'+key+'='+quote(profile),'Set-Location '+quote(profile),'& '+' '.join(quote(x) for x in command)])
                    encoded=base64.b64encode(script.encode('utf-16le')).decode()
                    subprocess.Popen(['powershell.exe','-NoLogo','-NoProfile','-NoExit','-EncodedCommand',encoded],creationflags=subprocess.CREATE_NEW_CONSOLE)
                else:
                    script = profile/'Sign in to 1top.command'
                    script.write_text(login_script(kind,cli,profile));script.chmod(0o700)
                    subprocess.run(['/usr/bin/open','-a','Terminal',str(script)],check=True,timeout=8,
                                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            except (OSError,subprocess.SubprocessError):
                raise ActionError('로그인 터미널을 열지 못했습니다. 다시 시도해 주세요.',500)
            self.last = time.monotonic()
        return {'message':'공식 로그인 터미널을 열었습니다. 브라우저에서 로그인하면 최대 2분 내에 계정이 표시됩니다.'}
