import {env,runInDurableObject} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {snapshot,action,accountAlias,SPEED_SECONDS} from '../src/protocol';
import {historyData,historyQuery} from '../src/history';
const next=(ws:WebSocket,type:string)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out '+type)),3000);const fn=(e:MessageEvent)=>{const v=JSON.parse(e.data as string);if(v.type===type){clearTimeout(timer);ws.removeEventListener('message',fn);resolve(v);}};ws.addEventListener('message',fn);});
async function socket(hub:any,role:string,id:string,control='1'){
 const r=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,control,expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});
 const ws=r.webSocket!;ws.accept();return ws as WebSocket;
}
const report=()=>({as_of:100,coverage:[{source:'collector',kind:null,from:1,to:100}],
 series:{start:1,end:100,step:'60',bins:[1],total:[3],by_model:[{key:'opus',kind:'Claude',tokens:[3]}],by_project:[{key:'project:'+'a'.repeat(64),label:'demo',tokens:[3]}]},
 heatmap:{hours:[['2026-10-29',0,3]],days:[['2026-10-29',3]]}});
it('keeps every period and numeric evidence while dropping private nested fields',()=>{
 const c={pp_per_token:.01,seconds:300,used_pp:2,tokens:200,secret:'PRIVATE'};
 const keys=[...Object.keys(SPEED_SECONDS),'all'];
 const clean=snapshot({sessions:[{id:'s',effort:'high',weekly_account:'a',usage:{last_minute:[1,2,3,4],output_rate:3,history:[[1,4]],prompt:'PRIVATE'},
 windows:Object.fromEntries(keys.map(k=>[k,[1,2,3,4]])),weekly_estimate:Object.fromEntries(keys.map(k=>[k,{used_pp:1,period_seconds:SPEED_SECONDS[k]||1000,account_id:'a',calibration:c}]))}],
 flow:Object.fromEntries(keys.filter(k=>k.startsWith('custom:')||k==='all').map(k=>{const seconds=SPEED_SECONDS[k]||1000,step=Math.max(60,Math.ceil(seconds/240/60)*60);return[k,{start:100,end:100+seconds,as_of:100+seconds,step,bins:Array.from({length:Math.ceil(seconds/step)},()=>({Claude:1}))}];})),
 account_quotas:[{id:'a',account_label:'PRIVATE',calibration:c}],host:{network:{rx:10,ip:'PRIVATE'},disk:{free:3,path:'PRIVATE'}},system:{top:[{pid:1,name:'python',cmdline:'PRIVATE'}]},
 operations:{goals:[{objective:'PRIVATE'}]}});
 expect(Object.keys(clean.sessions[0].windows)).toHaveLength(19);expect(Object.keys(clean.sessions[0].weekly_estimate!)).toHaveLength(19);
 expect(Object.keys(clean.flow!)).toHaveLength(13);expect(clean.sessions[0].effort).toBe('high');
 expect(clean.account_quotas[0].calibration?.seconds).toBe(300);expect(clean.host.network.rx).toBe(10);expect(JSON.stringify(clean)).not.toContain('PRIVATE');
});
it('validates rename, alias, history bounds without truncating commands',()=>{
 const ids={request_id:crypto.randomUUID(),device_id:crypto.randomUUID(),session_id:'s',control_key:'k'};
 expect(action({...ids,action:'rename',title:'New'}).title).toBe('New');
 expect(()=>action({...ids,action:'rename',title:'bad\ncommand'})).toThrow();
 expect(()=>action({...ids,action:'rename',title:'x'.repeat(81)})).toThrow();
 expect(accountAlias({...ids,account_id:'a',alias:' Work '}).alias).toBe('Work');expect(()=>accountAlias({...ids,account_id:'a',alias:'x'.repeat(25)})).toThrow();
 expect(historyQuery({period:'custom:604800',step:3600})).toEqual({period:'custom:604800',step:'3600'});
 expect(()=>historyQuery({period:'__proto__'})).toThrow();expect(()=>historyQuery({step:'1'})).toThrow();
 const data:any=report();data.series.by_project[0].key='/private/path';expect(()=>historyData(data)).toThrow();
 data.series.by_project[0].key='unknown';data.series.total.push(1);expect(()=>historyData(data)).toThrow();
});
it('routes history only to the requesting account/socket, even with control disabled, without persistence',async()=>{
 const hub=env.HUBS.get(env.HUBS.idFromName('history-'+crypto.randomUUID())),did=crypto.randomUUID();
 const device=await socket(hub,'device',did,'0'),viewer=await socket(hub,'browser',crypto.randomUUID()),other=await socket(hub,'browser',crypto.randomUUID());
 let otherCount=0;other.addEventListener('message',e=>{if(JSON.parse(e.data as string).type==='history')otherCount++;});
 await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+did,{id:did,received:Date.now(),snapshot:snapshot({sessions:[],features:['history']})}));
 const rid=crypto.randomUUID(),request=next(device,'history_request'),response=next(viewer,'history');
 viewer.send(JSON.stringify({type:'history_request',device_id:did,request_id:rid,period:'1h',step:'60'}));
 expect((await request).period).toBe('1h');device.send(JSON.stringify({type:'history',request_id:rid,data:report()}));
 expect((await response).data.series.total).toEqual([3]);expect(otherCount).toBe(0);
 await runInDurableObject(hub,async(_i:any,state:any)=>{expect(JSON.stringify([...await state.storage.list()])).not.toContain('by_project');});
 const bad=next(other,'history');other.send(JSON.stringify({type:'history_request',device_id:crypto.randomUUID(),request_id:crypto.randomUUID(),period:'1h',step:'60'}));
 expect((await bad).error).toContain('unavailable');device.close();viewer.close();other.close();
});
it('rejects stale rename and unknown aliases; deduplicates accepted account edits',async()=>{
 const hub=env.HUBS.get(env.HUBS.idFromName('rename-'+crypto.randomUUID())),did=crypto.randomUUID(),device=await socket(hub,'device',did);
 await runInDurableObject(hub,async(_i:any,state:any)=>state.storage.put('snapshot:'+did,{id:did,received:Date.now(),snapshot:snapshot({sessions:[{id:'s',control_key:'k',capabilities:['rename']}],features:['account_alias'],account_quotas:[{id:'a'}]})}));
 const send=(path:string,data:any)=>hub.fetch('https://hub/'+path,{method:'POST',body:JSON.stringify(data)});
 const r=await send('action',{device_id:did,request_id:crypto.randomUUID(),action:'rename',session_id:'s',control_key:'stale',title:'Hi'});expect(r.status).toBe(409);
 const cmd={device_id:did,request_id:crypto.randomUUID(),account_id:'a',alias:'Work'},incoming=next(device,'action');
 expect((await send('accounts/alias',cmd)).status).toBe(202);expect((await incoming).account_id).toBe('a');
 expect((await send('accounts/alias',cmd)).status).toBe(200);expect((await send('accounts/alias',{...cmd,alias:'Changed'})).status).toBe(409);
 expect((await send('accounts/alias',{...cmd,request_id:crypto.randomUUID(),account_id:'foreign'})).status).toBe(409);device.close();
});
it('round-trips large snapshots across Durable Object storage value limits and removes chunks',async()=>{
 const hub=env.HUBS.get(env.HUBS.idFromName('chunks-'+crypto.randomUUID()));
 const keys=[...Object.keys(SPEED_SECONDS),'all'];
 const snap=snapshot({sessions:Array.from({length:250},(_,i)=>({id:'s'+i,terminal:'가'.repeat(100),weekly_account:'a'.repeat(64),
 weekly_estimate:Object.fromEntries(keys.map(k=>[k,{account_id:'a'.repeat(64),used_pp:2.123456789,period_seconds:31536000,tokens:17280000,calibration:{pp_per_token:.000000123,confidence:'limited',from:1793320000,to:1793320600,valid_until:1793321200,source:'historical_provider_calibration',seconds:600,used_pp:2.123456789,tokens:17280000}}])),
 usage:{history:Array.from({length:60},(_,j)=>[j,1e10])},windows:Object.fromEntries(keys.map(k=>[k,[1e10,2e10,3e10,4e10]]))}))});
 expect(new TextEncoder().encode(JSON.stringify(snap)).length).toBeGreaterThan(2*1024*1024);
 expect(new TextEncoder().encode(JSON.stringify(snap)).length).toBeLessThan(4*1024*1024);
 const device={id:crypto.randomUUID(),name:'test',platform:'test',received:Date.now(),snapshot:snap};
 await runInDurableObject(hub,async(i:any,state:any)=>{
   await i.storeDevice(device);expect(await i.readDevice(device.id)).toEqual(device);
   expect((await i.devices())[0].snapshot.sessions).toHaveLength(250);
   const stored=await state.storage.list({prefix:'snapshot-part:'});expect(stored.size).toBeGreaterThan(1);
   for(const value of stored.values())expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(128000);
   await i.storeDevice({...device,id:'second'});
 });
 const viewer=await socket(hub,'browser',crypto.randomUUID());
 const initial=next(viewer,'state'),overflow=next(viewer,'snapshot');
 const first=await initial,second=await overflow;
 expect(first.devices).toHaveLength(1);
 expect(new Set([first.devices[0].id,second.device.id])).toEqual(new Set([device.id,'second']));
 expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThan(4*1024*1024);
 viewer.close();
 await runInDurableObject(hub,async(i:any,state:any)=>{await i.removeDevice(device.id);await i.removeDevice('second');expect((await state.storage.list()).size).toBe(0);});
});
