"""Launch a new native CLI through the local gateway without editing its profile."""
import json
import os
import subprocess
import urllib.request

from .accounts import read_json
from .account_login import executable
from .platform_support import cli_command


def command(provider,args,directory,port=18767):
    if provider not in ('Claude','Codex','GLM'):raise ValueError('Unsupported gateway client')
    key=read_json(directory/'gateway-key.json').get('key')
    if not isinstance(key,str) or len(key)<32:raise ValueError('Run 1top gateway first')
    base='http://127.0.0.1:'+str(port)
    request=urllib.request.Request(base+'/status',headers={'Authorization':'Bearer '+key})
    with urllib.request.urlopen(request,timeout=3) as response:
        if response.status!=200:raise ValueError('Gateway unavailable')
    cli=executable('codex' if provider=='Codex' else 'claude')
    if not cli:raise ValueError('Native CLI unavailable')
    env=dict(os.environ)
    if provider in ('Claude','GLM'):
        for name in ('ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN'):env.pop(name,None)
        env['ANTHROPIC_BASE_URL']=base+('/claude' if provider=='Claude' else '/glm')
        env['ANTHROPIC_AUTH_TOKEN']=key
        argv=cli_command(cli,*args)
    else:
        env['ONETOP_GATEWAY_KEY']=key
        options={'model_provider':'onetop','model_providers.onetop.name':'1top',
                 'model_providers.onetop.base_url':base+'/codex/v1',
                 'model_providers.onetop.env_key':'ONETOP_GATEWAY_KEY',
                 'model_providers.onetop.wire_api':'responses',
                 'model_providers.onetop.requires_openai_auth':False,
                 'model_providers.onetop.supports_websockets':False}
        config=[part for k,v in options.items() for part in ('-c',k+'='+json.dumps(v))]
        argv=cli_command(cli,*config,*args)
    return argv,env


def run(provider,args,directory,port=18767):
    argv,env=command(provider,args,directory,port)
    return subprocess.call(argv,env=env)
