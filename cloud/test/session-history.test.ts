import {expect,it} from 'vitest';
import {env,runInDurableObject} from 'cloudflare:test';
import {historyQuery,historyData} from '../src/history';
import {snapshot} from '../src/protocol';
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
it('preserves the declared session-history capability and rejects unknown capabilities',()=>{
 expect(snapshot({sessions:[],features:['history','usage_sessions','unknown']}).features).toEqual(['history','usage_sessions']);
 expect(snapshot({sessions:[],features:['history']}).features).not.toContain('usage_sessions');
});
it('routes session history using a sanitized device capability with controls disabled',async()=>{
 const hub=env.HUBS.get(env.HUBS.idFromName('session-capability-'+crypto.randomUUID())),did=crypto.randomUUID();
 const next=(ws:WebSocket,type:string)=>new Promise<any>((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.removeEventListener('message',read);reject(Error('Timed out '+type));},3000);
  const read=(e:MessageEvent)=>{const value=JSON.parse(e.data as string);if(value.type===type){clearTimeout(timer);ws.removeEventListener('message',read);resolve(value);}};
  ws.addEventListener('message',read);
 });
 const open=async(role:string,id:string)=>{const r=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,control:'0',expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});const ws=r.webSocket!;ws.accept();return ws as WebSocket;};
 const device=await open('device',did),viewer=await open('browser',crypto.randomUUID());
 try{
  await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+did,{id:did,received:Date.now(),snapshot:snapshot({sessions:[],features:['usage_sessions']})}));
  const request=next(device,'history_request'),response=next(viewer,'history'),rid=crypto.randomUUID();
  viewer.send(JSON.stringify({type:'history_request',request_id:rid,device_id:did,view:'sessions',period:'1h',offset:0,limit:50}));
  expect(await request).toMatchObject({request_id:rid,view:'sessions',period:'1h',offset:0,limit:50});
  device.send(JSON.stringify({type:'history',request_id:rid,data:data()}));
  const result=await response;expect(result.data.sessions[0]).toMatchObject({id:'ended',title:'Named task',listed:false});
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET/);
 }finally{device.close();viewer.close();}
});
