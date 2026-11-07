"""Exercise the actual Windows installer, collector, and WebView2 window in CI."""
import json, os, subprocess, tempfile, time, urllib.request, uuid
from pathlib import Path
from onetop import __version__

root=Path(__file__).resolve().parents[1]
installer=root/f'release/v{__version__}/1top-{__version__}-windows-x64-setup.exe'
target=root/'build/windows/installed'
subprocess.run([str(installer),'/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',f'/DIR={target}'],check=True)
assert (target/'1top.exe').is_file()
with tempfile.TemporaryDirectory() as tmp:
    temp=Path(tmp);profile=temp/'profile';sid=str(uuid.uuid4())
    log=profile/'projects'/'fixture'/f'{sid}.jsonl';log.parent.mkdir(parents=True)
    log.write_text(json.dumps({'type':'assistant','timestamp':time.time(),'message':{'id':'fixture-response','model':'test-model','usage':{'input_tokens':100,'cache_read_input_tokens':200,'cache_creation_input_tokens':10,'output_tokens':20}}})+'\n',encoding='utf-8')
    (profile/'sessions').mkdir()
    script=temp/'node_modules/@anthropic-ai/claude-code/cli.js';script.parent.mkdir(parents=True)
    script.write_text('const fs=require("fs"),p=require("path");fs.writeFileSync(p.join(process.env.CLAUDE_CONFIG_DIR,"sessions",process.pid+".json"),JSON.stringify({sessionId:process.env.FIXTURE_SESSION,status:"idle",cwd:process.cwd()}));setInterval(()=>{},1000);',encoding='utf-8')
    env={**os.environ,'CLAUDE_CONFIG_DIR':str(profile),'FIXTURE_SESSION':sid,'ONETOP_DATA':str(temp/'state')}
    fixture=subprocess.Popen(['node',str(script)],env=env)
    agent=subprocess.Popen([str(target/'1top.exe'),'--agent','--port','18789'],env=env)
    try:
        state=None
        for _ in range(120):
            try:
                with urllib.request.urlopen('http://127.0.0.1:18789/api/state',timeout=1) as response:state=json.load(response)
                match=next((s for s in state.get('sessions',[]) if s['id']==sid and s.get('tokens')),None)
                if match:break
            except Exception:pass
            time.sleep(.5)
        else:raise RuntimeError('Packaged collector did not report the synthetic CLI')
        assert match['tokens']==[100,200,10,20],match
        assert match['context_usage']['input_tokens']==310
        assert state['system']['host']['os']=='Windows'
        assert state['system']['host']['memory']['total']>0
        report=root/'build/windows/smoke-report.json'
        ui=subprocess.Popen([str(target/'1top.exe')],env={**env,'ONETOP_PORT':'18789','ONETOP_SMOKE_REPORT':str(report)})
        try:ui.wait(90)
        except subprocess.TimeoutExpired:ui.terminate();ui.wait();raise
        assert ui.returncode==0
        result=json.loads(report.read_text());assert result['maps'] and result['ready'],result
        result.update({'installer':True,'collector_version':state['version'],'exact_fixture_usage':True,'context':310,'host_resources':True})
        report.write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps(result))
    finally:
        for process in [agent,fixture]:
            if process.poll() is None:process.terminate()
            process.wait(10)
