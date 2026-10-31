import {expect,it} from 'vitest';
import {historyQuery,historyData} from '../src/history';
const data=()=>({view:'sessions',period:'1h',as_of:1000,start:0,end:1000,session_count:1,tokens:[2,3,4,5],offset:0,next_offset:null,
 sessions:[{id:'ended',kind:'Codex',title:'Named task',project:'project',app:'Orca',model:'model',identity_source:'collector',listed:false,
  tokens:[2,3,4,5],models:[{model:'model',tokens:[2,3,4,5]}],first_usage:900,last_usage:950,cwd:'/PRIVATE',control_key:'SECRET'}]});
it('passes archived identity and model usage, without control or local path fields',()=>{
 const value=historyData(data());expect(value).toMatchObject({view:'sessions',sessions:[{id:'ended',title:'Named task',listed:false}]});
 expect(JSON.stringify(value)).not.toContain('PRIVATE');expect(JSON.stringify(value)).not.toContain('SECRET');
});
it('validates pagination and session model totals',()=>{
 expect(historyQuery({view:'sessions',period:'all',offset:200,limit:200})).toMatchObject({view:'sessions',offset:200,limit:200});
 for(const q of [{offset:-1},{limit:201},{limit:0},{period:'invalid'}])expect(()=>historyQuery({view:'sessions',...q})).toThrow();
 const bad=data();bad.sessions[0].models[0].tokens=[0,0,0,0];expect(()=>historyData(bad)).toThrow();
});
