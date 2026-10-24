import {env,runInDurableObject} from 'cloudflare:test';
import {beforeAll,describe,expect,it,vi} from 'vitest';
vi.mock('jose',()=>({createRemoteJWKSet:()=>null,jwtVerify:async(token:string)=>{
 if(!'abcdefgh'.split('').some(c=>token===c.repeat(30)))throw Error('Invalid test identity');
 return {payload:{sub:token[0],exp:Math.floor(Date.now()/1000)+3600,email_verified:true,firebase:{sign_in_provider:'google.com'}}};
}}));
import worker,{hash} from '../src/index';
import {snapshot} from '../src/protocol';
import schema from '../schema.sql?raw';
// Most fixtures exercise enrollment in an explicitly enabled environment.
// Production defaults and the closed paths are covered separately below.
const e:any={...env,PAIRING_ENABLED:'true'};
const uid='a';
const req=(path:string,data?:unknown,token?:string,origin='https://1top.si')=>new Request('https://relay.test'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
const fetch=(path:string,data?:unknown,token?:string,origin?:string)=>worker.fetch(req(path,data,token,origin),e);
beforeAll(async()=>{
 for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await e.DB.prepare(sql).run();
 for(const id of ['a','b'])await e.DB.prepare('INSERT INTO hosted_access(user_id,kind,max_devices,created_at) VALUES(?,?,?,?)').bind(id,'operator',25,1).run();
});
function sample(){return {updated:Date.now()/1000,recording_started:0,version:'test',sessions:[{id:'session',control_key:'key',kind:'Claude',app:'Cursor',terminal:'test',project:'demo',title:'test',model:'test',status:'idle',tokens:[1,2,3,4],windows:{'1h':[1,2,3,4]},cpu:1,rss:100,capabilities:['terminate']}],host:{cpu:1,used_memory:10,total_memory:100,cores:2},periods:[]};}
function nextMessage(ws:WebSocket){return new Promise<any>((resolve,reject)=>{ws.addEventListener('message',e=>resolve(JSON.parse(e.data as string)),{once:true});setTimeout(()=>reject(Error('No socket message')),2500);});}
async function socket(hub:any,role:string,id:string){const r=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,control:'1',expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});expect(r.status).toBe(101);const ws=r.webSocket!;ws.accept();return ws;}

describe('account and device boundaries',()=>{
 it('returns server-derived admin entitlement without claiming a payment',async()=>{
  const response=await fetch('/api/devices',undefined,'a'.repeat(30));
  expect((await response.json() as any).account).toMatchObject({role:'admin',plan:'pro',grant:'operator'});
 });
 it('allowlists operational summaries without goals or skill file contents',()=>{
  const result=snapshot({...sample(),operations:{installed_skills:12,observed_events:2,goals:[{thread_id:'s',runtime:'Codex',status:'active',objective:'PRIVATE',path:'/private',tokens_used:500}],events:['PRIVATE'],skills:['PRIVATE']}});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(JSON.stringify(result)).not.toContain('/private');
  expect(result.operations.goals[0].tokens_used).toBe(500);
 });
 it('rejects hostile web origins before authentication',async()=>{expect((await fetch('/api/devices',undefined,'a'.repeat(30),'https://evil.example')).status).toBe(403);});
 it('does not return devices to anonymous callers',async()=>{expect((await fetch('/api/devices')).status).not.toBe(200);});
 it('never exposes another account device',async()=>{
  const id=crypto.randomUUID();await e.DB.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)').bind(id,'b','Private Mac','Darwin',await hash('private-'+id),1,null,1).run();
  const list:any=await(await fetch('/api/devices',undefined,'a'.repeat(30))).json();expect(list.devices.some((d:any)=>d.id===id)).toBe(false);
  const result=await fetch('/api/action',{device_id:id,session_id:'session',control_key:'key',action:'terminate',request_id:crypto.randomUUID()},'a'.repeat(30));expect(result.status).toBe(404);
  expect((await fetch('/api/devices/revoke',{device_id:id},'a'.repeat(30))).status).toBe(404);
 });
 it('pairing secret must be known and can only be claimed once',async()=>{
  const secret='f'.repeat(64),code='ABCDEF0123';await e.DB.prepare('INSERT INTO pairings VALUES(?,?,?,?,?,?,?)').bind(code,await hash(secret),'Test Mac','Darwin',Math.floor(Date.now()/1000)+60,'a',1).run();
  expect((await fetch('/api/pair/poll',{device_code:'e'.repeat(64)})).status).toBe(410);
  const first=await fetch('/api/pair/poll',{device_code:secret});expect(first.status).toBe(200);const content:any=await first.json();expect(content.device_token).toHaveLength(64);
  expect((await fetch('/api/pair/poll',{device_code:secret})).status).toBe(410);
  const row=await e.DB.prepare('SELECT token_hash FROM devices WHERE id=?').bind(content.device_id).first();expect(row.token_hash).not.toBe(content.device_token);
 });
 it('requires a fresh single-use browser connection ticket',async()=>{
  const r=await fetch('/api/live-ticket',{},'a'.repeat(30));expect(r.status).toBe(200);const t:any=await r.json();
  const request=()=>new Request('https://relay.test/api/live',{headers:{Origin:'https://1top.si',Upgrade:'websocket','Sec-WebSocket-Protocol':'1top, ticket.'+t.ticket}});
  const first=await worker.fetch(request(),e);expect(first.status).toBe(101);first.webSocket!.accept();first.webSocket!.close();
  expect((await worker.fetch(request(),e)).status).toBe(401);
 });
});

describe('relay and command safety',()=>{
 it('drops non-allowlisted fields and rejects malformed token vectors',()=>{const s:any=sample();s.secret='no';s.sessions[0].prompt='no';s.sessions[0].path='/private';s.sessions[0].tokens=[-1,2,3,4];const clean:any=snapshot(s);expect(clean.secret).toBeUndefined();expect(clean.sessions[0].prompt).toBeUndefined();expect(clean.sessions[0].path).toBeUndefined();expect(clean.sessions[0].tokens).toBeNull();});
 it('does not queue actions for an offline computer',async()=>{const hub=e.HUBS.get(e.HUBS.idFromName('offline'));const r=await hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify({action:'terminate',device_id:crypto.randomUUID(),session_id:'session',control_key:'key',request_id:crypto.randomUUID()})});expect(r.status).toBe(409);});
 it('sends an action only once and only to its selected device',async()=>{
  const account='command-'+crypto.randomUUID(),hub=e.HUBS.get(e.HUBS.idFromName(account)),id=crypto.randomUUID(),other=crypto.randomUUID();
  const target=await socket(hub,'device',id),otherSocket=await socket(hub,'device',other);let otherMessages=0;otherSocket.addEventListener('message',()=>otherMessages++);
  await runInDurableObject(hub,async(_instance:any,state:any)=>{await state.storage.put('snapshot:'+id,{id,name:'Mac',platform:'Darwin',received:Date.now(),snapshot:snapshot(sample())});});
  const command={action:'terminate',device_id:id,session_id:'session',control_key:'key',request_id:crypto.randomUUID()},receive=nextMessage(target);
  expect((await hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify(command)})).status).toBe(202);
  const message=await receive;expect(message.request_id).toBe(command.request_id);
  expect((await hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify(command)})).status).toBe(200);
  expect((await hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify({...command,action:'pause'})})).status).toBe(409);
  expect(otherMessages).toBe(0);target.close();otherSocket.close();
 });
 it('keeps snapshots inside their account hub',async()=>{
  const a=e.HUBS.get(e.HUBS.idFromName('isolation-a')),b=e.HUBS.get(e.HUBS.idFromName('isolation-b'));
  await runInDurableObject(a,async(_instance:any,state:any)=>{await state.storage.put('snapshot:private',{id:'private',name:'Private Mac',platform:'Darwin',received:Date.now(),snapshot:snapshot(sample())});});
  const response=await b.fetch('https://hub/ws?role=browser&id=test&expires='+String(Date.now()+60000),{headers:{Upgrade:'websocket'}}),ws=response.webSocket!;ws.accept();const message=await nextMessage(ws);expect(message.devices).toEqual([]);ws.close();
 });
});

describe('stale sessions, revocation, and concurrent clicks',()=>{
 it('rejects changed session keys and unsupported controls',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('capability-'+crypto.randomUUID())),id=crypto.randomUUID(),ws=await socket(hub,'device',id);
  await runInDurableObject(hub,async(_i:any,s:any)=>s.storage.put('snapshot:'+id,{id,received:Date.now(),snapshot:snapshot(sample())}));
  for(const changed of [{control_key:'old-key',action:'terminate'},{control_key:'key',action:'pause'}])expect((await hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify({device_id:id,session_id:'session',request_id:crypto.randomUUID(),...changed})})).status).toBe(409);ws.close();
 });
 it('rejects a stale report even while the socket remains open',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('stale-'+crypto.randomUUID())),id=crypto.randomUUID(),ws=await socket(hub,'device',id);
  await runInDurableObject(hub,async(_i:any,s:any)=>s.storage.put('snapshot:'+id,{id,received:Date.now()-21000,snapshot:snapshot(sample())}));
  expect((await hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify({device_id:id,session_id:'session',control_key:'key',action:'terminate',request_id:crypto.randomUUID()})})).status).toBe(409);ws.close();
 });
 it('deduplicates concurrent identical action submissions',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('concurrent-'+crypto.randomUUID())),id=crypto.randomUUID(),ws=await socket(hub,'device',id);let sent=0;ws.addEventListener('message',()=>sent++);
  await runInDurableObject(hub,async(_i:any,s:any)=>s.storage.put('snapshot:'+id,{id,received:Date.now(),snapshot:snapshot(sample())}));
  const cmd={device_id:id,session_id:'session',control_key:'key',action:'terminate',request_id:crypto.randomUUID()};
  await Promise.all(Array.from({length:8},()=>hub.fetch('https://hub/action',{method:'POST',body:JSON.stringify(cmd)})));
  await runInDurableObject(hub,()=>{});expect(sent).toBe(1);ws.close();
 });
 it('revocation prevents a stored device token from reconnecting',async()=>{
  const id=crypto.randomUUID(),secret='c'.repeat(64);await e.DB.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)').bind(id,'a','Revocation fixture','Darwin',await hash(secret),1,null,1).run();
  expect((await fetch('/api/devices/revoke',{device_id:id},'a'.repeat(30))).status).toBe(200);
  expect((await worker.fetch(new Request('https://relay.test/api/device/socket',{headers:{Authorization:'Bearer '+secret,Upgrade:'websocket'}}),e)).status).toBe(401);
 });
});

describe('managed access and cost admission',()=>{
 const grant=async(id:string,kind='trial',expires:number|null=Math.floor(Date.now()/1000)+3600,max=1,revoked:number|null=null)=>{
  await e.DB.prepare('INSERT INTO hosted_access VALUES(?,?,?,?,?,?)').bind(id,kind,expires,max,1,revoked).run();
 };
 it('rejects closed or unconfigured public enrollment without creating database work',async()=>{
  const blocked={...e,DB:{prepare(){throw Error('Closed enrollment must not access D1');}}};
  for(const mode of [undefined,'false','TRUE'])for(const path of ['/api/pair/start','/api/pair/info','/api/pair/approve','/api/pair/poll']){
   const r=await worker.fetch(req(path,{name:'Fixture',platform:'Darwin'}),{...blocked,PAIRING_ENABLED:mode});
   expect(r.status).toBe(403);expect((await r.json() as any).code).toBe('managed_pairing_paused');
  }
 });
 it('a Google account and client-supplied paid plan cannot create hosted access',async()=>{
  for(const [path,body] of [['/api/devices',undefined],['/api/live-ticket',{plan:'subscription'}],['/api/pair/approve',{code:'1234567890'}],['/api/action',{}]] as const){
   const r=await fetch(path,body,'c'.repeat(30));expect(r.status).toBe(403);expect((await r.json() as any).code).toBe('hosted_access_required');
  }
  expect(await e.DB.prepare('SELECT user_id FROM hosted_access WHERE user_id=?').bind('c').first()).toBeNull();
  expect(await e.DB.prepare('SELECT user_id FROM tickets WHERE user_id=?').bind('c').first()).toBeNull();
 });
 it('rejects expired and revoked access',async()=>{
  await grant('d','trial',Math.floor(Date.now()/1000)-1);
  await grant('e','subscription',Math.floor(Date.now()/1000)+60,1,1);
  for(const id of ['d','e'])expect((await fetch('/api/live-ticket',{},id.repeat(30))).status).toBe(403);
 });
 it('checks access again when a previously minted browser ticket is redeemed',async()=>{
  await grant('f');
  const issued:any=await(await fetch('/api/live-ticket',{},'f'.repeat(30))).json();expect(issued.ticket).toHaveLength(64);
  await e.DB.prepare('UPDATE hosted_access SET revoked_at=1 WHERE user_id=?').bind('f').run();
  const r=await worker.fetch(new Request('https://relay.test/api/live',{headers:{Origin:'https://1top.si',Upgrade:'websocket','Sec-WebSocket-Protocol':'1top, ticket.'+issued.ticket}}),e);
  expect(r.status).toBe(403);
 });
 it('a valid device token without hosted access cannot stream, but its owner can still revoke it',async()=>{
  const id=crypto.randomUUID(),secret=crypto.randomUUID().replaceAll('-','').repeat(2);
  await e.DB.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)').bind(id,'c','Denied fixture','Darwin',await hash(secret),1,null,1).run();
  const r=await worker.fetch(new Request('https://relay.test/api/device/socket',{headers:{Authorization:'Bearer '+secret,Upgrade:'websocket'}}),e);
  expect(r.status).toBe(403);
  expect((await fetch('/api/devices/revoke',{device_id:id},'c'.repeat(30))).status).toBe(200);
 });
 it('bounds an active device connection by grant expiry and rejects expired streaming',async()=>{
  const expires=Math.floor(Date.now()/1000)+300;await grant('g','subscription',expires);
  const id=crypto.randomUUID(),secret=crypto.randomUUID().replaceAll('-','').repeat(2);
  await e.DB.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)').bind(id,'g','Expiry fixture','Darwin',await hash(secret),1,null,1).run();
  const r=await worker.fetch(new Request('https://relay.test/api/device/socket',{headers:{Authorization:'Bearer '+secret,Upgrade:'websocket'}}),e);
  expect(r.status).toBe(101);const ws=r.webSocket!;ws.accept();const hub=e.HUBS.get(e.HUBS.idFromName('g'));
  await runInDurableObject(hub,async(_i:any,state:any)=>{
   const target=state.getWebSockets('device:'+id)[0],a=target.deserializeAttachment();expect(a.expires).toBe(expires*1000);
   target.serializeAttachment({...a,expires:Date.now()-1});
  });
  const closed=new Promise<number>((resolve,reject)=>{ws.addEventListener('close',event=>resolve(event.code),{once:true});setTimeout(()=>reject(Error('Expired socket did not close')),2500);});
  ws.send(JSON.stringify({type:'snapshot',data:sample()}));expect(await closed).toBe(4003);
  await runInDurableObject(hub,async(_i:any,state:any)=>expect(await state.storage.get('snapshot:'+id)).toBeUndefined());
 });
 it('enforces the granted device allowance when two pairings are claimed concurrently',async()=>{
  await grant('h','trial',Math.floor(Date.now()/1000)+300,1);
  const secrets=Array.from({length:2},()=>crypto.randomUUID().replaceAll('-','').repeat(2));
  for(const secret of secrets)await e.DB.prepare('INSERT INTO pairings VALUES(?,?,?,?,?,?,?)').bind(secret.slice(0,10).toUpperCase(),await hash(secret),'Limit fixture','Darwin',Math.floor(Date.now()/1000)+60,'h',1).run();
  const results=await Promise.all(secrets.map(device_code=>fetch('/api/pair/poll',{device_code})));
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const count:any=await e.DB.prepare('SELECT COUNT(*) n FROM devices WHERE user_id=? AND revoked_at IS NULL').bind('h').first();expect(count.n).toBe(1);
 });
});
