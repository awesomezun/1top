import hashlib
import re
from pathlib import Path
from ..effort import level

PROVIDERS = {'openai-codex':'Codex','claude-code':'Claude','zai':'GLM','google':'Antigravity'}


def build(records):
    rows = []
    for r in records:
        sid, profile = r['id'], r['profile']
        config, origin = r['model'], r['trigger']
        parent = r.get('parent')
        parent = parent if isinstance(parent, str) and parent != sid and re.fullmatch(r'[A-Za-z0-9_-]{1,120}', parent) else None
        # A turn that ended in an error is over: it reads as interrupted, not as an unknown state.
        state = {'running':'working','streaming':'working','executing':'working','errored':'interrupted','error':'interrupted',
                 'failed':'interrupted','cancelled':'interrupted','canceled':'interrupted','aborted':'interrupted'}.get(r['status'], r['status'])
        row = {'id':f'aside:{profile}:{sid}', 'conversation_id':sid, 'kind':'Aside', 'config_dir':str(Path(r['db']).parent),
            'cwd':r.get('cwd') or '', 'title':r['title'], 'connected':r['running'], 'runs':[], 'pids':[], 'pid':None,
            'path':r['path'], 'configured_model':config.get('modelId',''), 'provider':config.get('provider',''),
            'control_key':hashlib.sha256(f'{r["db"]}:{sid}:{r["created"]}'.encode()).hexdigest() if r['running'] else None,
            'process_started':None, 'process_birth':None, 'orca_terminal':None, 'input_verified':False,
            'terminal_match':'aside_database', 'location':{'app':'Aside','app_path':'/Applications/Aside.app',
                'terminal':'Aside 내부 세션','match':'aside_database'},
            'terminal_note':'Aside 내부 세션 · 터미널 CLI가 아님 · 바로가기는 Aside 앱 열기',
            'source':'Aside local session database and per-request usage reports',
            'aside_account':'u'+profile, 'aside_session':sid, 'native_status':r['status'],
            'is_subagent':bool(parent) or origin.get('type')=='subagent',
            'parent_session_id':f'aside:{profile}:{parent}' if parent else None,
            'billing_kind':PROVIDERS.get(config.get('provider')), 'billing_account':r['billing_accounts'].get(config.get('provider')),
            '_registries':[{'status':state, 'statusUpdatedAt':r['updated']}], '_transcript':None}
        effort = level(config.get('thinkingLevel'))
        if effort and config.get('modelId'):
            row.update(effort=effort, effort_model=config['modelId'], effort_source='aside_session_configuration', effort_updated=r['updated'])
        rows.append(row)
    return rows
