"""Anonymous replay fixtures from the same observers used by the collector."""
import json
import re
import subprocess
from pathlib import Path
from . import Observer


def anonymize(record):
    tokens = {}
    def token(kind, value):
        if not value:
            return value
        key = (kind, str(value))
        if key not in tokens:
            tokens[key] = f'{kind}{1 + sum(k[0] == kind for k in tokens)}'
        return tokens[key]
    def identifier(value):
        # Tab ids can embed a local checkout path; replace the whole id consistently.
        return token('tab', value)
    def transcript(value):
        if not value:
            return None
        return {'mtime':value.get('mtime'), 'partial':value.get('partial',False),
            'events':[{k:e[k] for k in ('t','type','subtype','stop','sidechain','tool_use','tool_result','payload','meta','local','interrupt') if k in e}
                      for e in value.get('events',[])],
            'subagents':[{'id':s['id'],**transcript(s)} for s in value.get('subagents',[])]}
    procs=[]
    for p in record['processes']:
        env=p.get('env') or {}
        procs.append({**{k:p.get(k) for k in ('pid','ppid','birth','tty','ai','argv','kind','role','explicit_session')},
            'name':p.get('name'), 'config_dir':token('C',p.get('config_dir')),
            'cwd':token('P',p.get('cwd')), 'env':{k:(identifier(v) if k=='ORCA_TAB_ID' else v) for k,v in env.items()}})
    regs={}
    for pid,r in record['claude_registry'].items():
        regs[pid]={k:r[k] for k in ('pid','sessionId','kind','status','statusUpdatedAt','procStart','jobId','parkedJobId','nameSource','entrypoint','waitingFor','version') if k in r}
        regs[pid].update(cwd=token('P',r.get('cwd')), name=token('N',r.get('name')))
    transcripts={}
    for p in record['processes']:
        sid=record['claude_registry'].get(str(p['pid']),{}).get('sessionId')
        if sid:
            root=p['config_dir']
            transcripts[token('C',root)+':'+sid]=transcript(record['claude_transcripts'].get(root+':'+sid))
    logs=[{**{k:l.get(k) for k in ('id','session_id','holders','is_subagent','parent_session_id','agent_depth')},
        'profile':token('C',l.get('profile')), 'cwd':token('P',l.get('cwd')),
        'title':token('N',l.get('title')), 'name':token('N',l.get('name')), **(transcript(l) or {})}
        for l in record['codex_logs']]
    terminals=[{**{k:t.get(k) for k in ('handle','connected','leafId')}, 'tabId':identifier(t.get('tabId')),
        'title':token('T',t.get('title')), 'worktree':token('P',t.get('worktreePath'))}
        for t in record.get('orca_terminals') or []]
    def pane(key):
        if not key or key.startswith('structured-agent-session-'):
            return key
        tab, _, leaf = key.rpartition(':')
        return identifier(tab)+':'+leaf
    agents=[{**a, 'paneKey':pane(a.get('paneKey')), 'name':token('N',a.get('name'))} for a in record.get('orca_agents') or []]
    antigravity=[{**a, 'root':token('C',a.get('root')), 'title':token('N',a.get('title'))} for a in record.get('antigravity_sessions',[])]
    openbot=[{'workspace':token('P',a.get('workspace')), 'name':token('N',a.get('name'))} for a in record.get('openbot_agents',[])]
    mausbot=[{**a, 'bot':token('N',a.get('bot'))} for a in record.get('openmausbot_threads') or []]
    from ..sessions.terminals import pane_thread_name
    panes={}
    for p in record['processes']:
        pane=(p.get('env') or {}).get('TMUX_PANE')
        title=record.get('tmux_panes',{}).get(pane)
        if title:
            name=pane_thread_name(title,p.get('cwd',''))
            panes[pane]=token('N',name)+' | '+token('P',p.get('cwd')) if name else token('T',title)
    # Aside metadata uses the same tokens; credentials and exact database paths are omitted.
    aside=[]
    for r in record.get('aside_sessions',[]):
        aside.append({**{k:r.get(k) for k in ('id','status','created','updated','parent','running')},
            'profile':token('A',r['profile']), 'db':token('DB',r['db']), 'title':token('N',r['title']),
            'cwd':token('P',r['cwd']), 'model':{k:r['model'][k] for k in ('modelId','provider','thinkingLevel') if k in r['model']},
            'trigger':{'type':r['trigger'].get('type')}, 'path':None, 'billing_accounts':{}})
    return {'schema':'onetop.session-capture.v1','captured_at':record['captured_at'],'platform':record['platform'],
        'claude_code_versions':sorted({r['version'] for r in regs.values() if r.get('version')}),
        'processes':procs,'claude_registry':regs,'claude_transcripts':transcripts,
        'codex_logs':logs,'orca_terminals':terminals if record.get('orca_terminals') is not None else None,'tmux_panes':panes,
        'aside_sessions':aside,'orca_agents':agents if record.get('orca_agents') is not None else None,'antigravity_sessions':antigravity,'openbot_agents':openbot,'openmausbot_threads':mausbot,
        'openmausbot_running':bool(record.get('openmausbot_running')),'tokens':list(tokens.values())}


def capture(path):
    def run(args, timeout=8):
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=timeout)
    record=anonymize(Observer().read(run))
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('x',encoding='utf-8') as stream:
        json.dump(record,stream,ensure_ascii=False,indent=1);stream.write('\n')
    return record
