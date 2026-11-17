import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import {mailboxRows,snapshot} from '../src/protocol';
const next=(ws:WebSocket,type:string)=>new Promise<any>(resolve=>{const fn=(event:MessageEvent)=>{const value=JSON.parse(event.data as string);if(value.type===type){ws.removeEventListener('message',fn);resolve(value);}};ws.addEventListener('message',fn);});
async function socket(hub:any,role:string,id:string,control='1'){
 const result=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,control,expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});
 const ws=result.webSocket!;ws.accept();return ws as WebSocket;
}
describe('session correspondence',()=>{
 it('allowlists bounded message fields without paths or tool output',()=>{
  const row={id:crypto.randomUUID(),text:'question',reply:'answer',created:1,status:'replied',path:'/private',thinking:'private',tool_output:'private'};
  expect(JSON.stringify(mailboxRows([row]))).not.toContain('private');
  expect(()=>mailboxRows(Array(11).fill(row))).toThrow();
  expect(()=>mailboxRows([{...row,status:'invented'}])).toThrow();
 });
 it('routes only to the requesting viewer and does not store correspondence',async()=>{
  const hub=env.HUBS.get(env.HUBS.idFromName('mailbox-'+crypto.randomUUID())),did=crypto.randomUUID();
  const device=await socket(hub,'device',did),viewer=await socket(hub,'browser',crypto.randomUUID()),other=await socket(hub,'browser',crypto.randomUUID());
  let otherMail=0;other.addEventListener('message',e=>{if(JSON.parse(e.data as string).type==='mailbox')otherMail++;});
  await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+did,{received:Date.now(),snapshot:snapshot({sessions:[{id:'session',control_key:'key',capabilities:['mailbox','message']}]})}));
  const rid=crypto.randomUUID(),request=next(device,'mailbox_request'),reply=next(viewer,'mailbox');
  viewer.send(JSON.stringify({type:'mailbox_request',request_id:rid,device_id:did,session_id:'session',control_key:'key'}));
  expect((await request).session_id).toBe('session');
  device.send(JSON.stringify({type:'mailbox',request_id:crypto.randomUUID(),session_id:'session',messages:[]}));
  device.send(JSON.stringify({type:'mailbox',request_id:rid,session_id:'session',messages:[{id:crypto.randomUUID(),text:'PRIVATE QUESTION',reply:'PRIVATE REPLY',created:1,status:'replied',path:'HIDDEN PATH'}]}));
  const result=await reply;expect(result.messages[0].reply).toBe('PRIVATE REPLY');expect(JSON.stringify(result)).not.toContain('HIDDEN PATH');expect(otherMail).toBe(0);
  await runInDurableObject(hub,async(_i:any,state:any)=>{const stored=JSON.stringify([...await state.storage.list()]);expect(stored).not.toContain('PRIVATE');});
  device.close();viewer.close();other.close();
 });
 it('refuses read access to a device with control disabled',async()=>{
  const hub=env.HUBS.get(env.HUBS.idFromName('mailbox-disabled-'+crypto.randomUUID())),did=crypto.randomUUID();
  const device=await socket(hub,'device',did,'0'),viewer=await socket(hub,'browser',crypto.randomUUID());let forwarded=false;
  device.addEventListener('message',e=>{if(JSON.parse(e.data as string).type==='mailbox_request')forwarded=true;});
  await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+did,{received:Date.now(),snapshot:snapshot({sessions:[{id:'session',control_key:'key',capabilities:['mailbox']}]})}));
  const response=next(viewer,'mailbox');viewer.send(JSON.stringify({type:'mailbox_request',request_id:crypto.randomUUID(),device_id:did,session_id:'session',control_key:'key'}));
  expect((await response).error).toMatch(/unavailable/);expect(forwarded).toBe(false);device.close();viewer.close();
 });
});
