import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import {action,snapshot} from '../src/protocol';
const request=()=>({action:'prompt',request_id:crypto.randomUUID(),device_id:crypto.randomUUID(),session_id:'test',control_key:'key',prompt:'이어서 테스트하고 오류 고쳐줘'});
describe('remote AI instructions',()=>{
 it('requires bounded plain text',()=>{for(const prompt of ['', ' ', 'a'.repeat(4001), '\u001b[200~','hello\rquit'])expect(()=>action({...request(),prompt})).toThrow();expect(action({...request(),prompt:'line one\nline two'}).prompt).toBe('line one\nline two');});
 it('delivers once, checks the capability, and stores only a body fingerprint',async()=>{
  const hub=env.HUBS.get(env.HUBS.idFromName('instructions-'+crypto.randomUUID())),cmd=request();
  const r=await hub.fetch('https://hub/ws?'+new URLSearchParams({role:'device',id:cmd.device_id,control:'1',expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});const ws=r.webSocket!;ws.accept();let sent=0;
  const received=new Promise<any>(resolve=>ws.addEventListener('message',e=>{const value=JSON.parse(e.data as string);if(value.type==='action'){sent++;resolve(value);}}));
  const session={id:'test',control_key:'key',kind:'Claude',status:'idle',capabilities:['prompt']};
  await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+cmd.device_id,{received:Date.now(),snapshot:snapshot({sessions:[session]})}));
  const post=(value:any)=>hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify(value)});
  const first=await post(cmd);expect(first.status).toBe(202);expect(await first.text()).not.toContain(cmd.prompt);expect((await received).prompt).toBe(cmd.prompt);
  expect((await post(cmd)).status).toBe(200);expect((await post({...cmd,prompt:'different'})).status).toBe(409);
  await runInDurableObject(hub,async(_i:any,state:any)=>{const receipt=await state.storage.get('receipt:'+cmd.request_id);expect(JSON.stringify(receipt)).not.toContain(cmd.prompt);expect(receipt.fingerprint).toHaveLength(64);});
  expect(sent).toBe(1);
  await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+cmd.device_id,{received:Date.now(),snapshot:snapshot({sessions:[{...session,capabilities:[]}]})}));
  expect((await post({...cmd,request_id:crypto.randomUUID()})).status).toBe(409);ws.close();
 });
});
