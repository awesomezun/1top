import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import {snapshot} from '../src/protocol';
// The relay's cost work (Workers Paid): a watched computer's 3-second reports reach viewers every time and storage only as an
// hourly backup, when the last viewer leaves and when the computer disconnects; the hub wakes hourly for cleanup, or sooner for a session's expiry.
const e:any=env;
function sample(){return {updated:Date.now()/1000,recording_started:0,version:'test',sessions:[{id:'session',control_key:'key',kind:'Claude',app:'Cursor',terminal:'test',project:'demo',title:'test',model:'test',status:'idle',tokens:[1,2,3,4],windows:{'1h':[1,2,3,4]},cpu:1,rss:100,capabilities:['terminate']}],host:{cpu:1,used_memory:10,total_memory:100,cores:2},periods:[]};}
const device=(received:number)=>({id:'cost-mac',name:'Mac',platform:'Darwin',received,snapshot:snapshot(sample())});

describe('relay cost',()=>{
 it('keeps every report for viewers and commands but backs one up at most hourly',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-writes'));
  await runInDurableObject(hub,async(instance:any,state:any)=>{
   const t=Date.now();
   await instance.keepDevice(device(t));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t);
   await instance.keepDevice(device(t+3000));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t);
   expect((await instance.readDevice('cost-mac')).received).toBe(t+3000);
   await instance.keepDevice(device(t+3599000));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t);
   await instance.keepDevice(device(t+3600000));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t+3600000);
   await instance.keepDevice(device(t+3603000),true);
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t+3603000);
  });
 });
 it('reads storage once the object has let its memory go',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-cold'));
  await runInDurableObject(hub,async(instance:any,state:any)=>{
   const t=Date.now();await instance.keepDevice(device(t));await instance.keepDevice(device(t+3000));
   instance.latest.clear();instance.persisted.clear();
   expect((await instance.readDevice('cost-mac')).received).toBe(t);
   await instance.keepDevice(device(t+6000));
   expect((await instance.readDevice('cost-mac')).received).toBe(t+6000);
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t);
   await instance.removeDevice('cost-mac');
   expect(await instance.readDevice('cost-mac')).toBeUndefined();
  });
 });
 it('wakes hourly for cleanup, or at a session expiry when that is sooner',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-alarm'));
  await runInDurableObject(hub,async(instance:any,state:any)=>{
   const t=Date.now();await instance.schedule();
   const hourly=await state.storage.getAlarm();
   expect(hourly).toBeGreaterThanOrEqual(t+3600000-1000);expect(hourly).toBeLessThanOrEqual(Date.now()+3600000);
   await state.storage.setAlarm(t+60000);await instance.schedule();
   expect(await state.storage.getAlarm()).toBe(t+60000);
  });
 });

 // Real sockets from here on: the hub's own messages, attachments and storage.
 const open=async(hub:any,role:string,id:string,ms=60000)=>{
  const response=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,name:id,platform:'Darwin',control:'1',expires:String(Date.now()+ms)}),{headers:{Upgrade:'websocket'}});
  const ws=response.webSocket!,seen:any[]=[];ws.addEventListener('message',(m:any)=>seen.push(JSON.parse(m.data)));ws.accept();return {ws,seen};
 };
 const until=async(test:()=>unknown)=>{for(let i=0;i<200;i++){if(await test())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
 const policies=(c:{seen:any[]})=>c.seen.filter(m=>m.type==='report_policy');
 const report=(tokens:number)=>JSON.stringify({type:'snapshot',data:{...sample(),speed_periods:[{key:'1h',seconds:3600,tokens,known:true}]}});
 const stored=(hub:any,id:string)=>runInDurableObject(hub,async(_i:any,s:any)=>s.storage.get('snapshot:'+id));
 const forget=(hub:any)=>runInDurableObject(hub,async(i:any)=>{i.latest.clear();i.persisted.clear();});
 const usage=async(hub:any,exclude:string)=>(await (await hub.fetch('https://hub/usage?exclude='+exclude)).json() as any).devices;

 it('tells a lone computer that there is no other, and each computer when that changes',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-others')),a=await open(hub,'device','a');
  await until(()=>policies(a).length);expect(policies(a).at(-1)).toEqual({type:'report_policy',interval:300,others:false});
  const viewer=await open(hub,'browser','v');await until(()=>policies(a).at(-1).interval===3);expect(policies(a).at(-1).others).toBe(false);
  const b=await open(hub,'device','b');await until(()=>policies(a).at(-1).others===true&&policies(b).length);expect(policies(b).at(-1).others).toBe(true);
  // The same computer connecting again is not another computer.
  const b2=await open(hub,'device','b');await until(()=>policies(b2).length);expect(policies(b2).at(-1).others).toBe(true);
  b2.ws.close();b.ws.close();await until(()=>policies(a).at(-1).others===false);
  viewer.ws.close();await until(()=>policies(a).at(-1).interval===300);a.ws.close();
 });
 it('answers other-computer totals from the connection once memory is gone, without newer storage',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-totals')),b=await open(hub,'device','b');
  b.ws.send(report(100));await until(()=>stored(hub,'b'));const first=(await stored(hub,'b')).received;
  await runInDurableObject(hub,async(i:any)=>{const d=i.latest.get('b');i.latest.set('b',{...d,received:d.received-400000});
   for(const ws of i.ctx.getWebSockets('device:b')){const at=ws.deserializeAttachment();ws.serializeAttachment({...at,totals:{...at.totals,received:at.totals.received-400000}});}});
  expect((await usage(hub,'a'))[0]).toMatchObject({id:'b',online:false});
  b.ws.send(report(250));await until(async()=>(await usage(hub,'a'))[0].periods[0].tokens===250);
  await forget(hub);
  const rows=await usage(hub,'a');expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:'b',online:true,periods:[{key:'1h',tokens:250}]});
  expect((await stored(hub,'b')).received).toBe(first);
  expect(await usage(hub,'b')).toEqual([]);
  b.ws.close();await until(async()=>(await usage(hub,'a'))[0].online===false);
 });
 it('reads a computer whose connection carries no totals yet from its backup',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-old-socket')),b=await open(hub,'device','cost-mac');
  await runInDurableObject(hub,async(i:any)=>{await i.keepDevice(device(Date.now()),true);i.latest.clear();i.persisted.clear();});
  expect((await usage(hub,'a'))[0]).toMatchObject({id:'cost-mac',online:true});b.ws.close();
 });
 it('backs up the screen when the last viewer leaves, unless the backup is under five minutes old',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-leave')),a=await open(hub,'device','a'),one=await open(hub,'browser','one'),two=await open(hub,'browser','two');
  a.ws.send(report(1));await until(()=>stored(hub,'a'));
  const age=(ms:number)=>runInDurableObject(hub,async(i:any,s:any)=>{const row=await s.storage.get('snapshot:a');await s.storage.put('snapshot:a',{...row,received:row.received-ms});i.persisted.set('a',row.received-ms);return i.latest.get('a').received;});
  const last=await age(200000);
  one.ws.close();await until(()=>runInDurableObject(hub,async(i:any)=>i.connected('browser').length===1));
  two.ws.close();await until(()=>policies(a).at(-1).interval===300);expect((await stored(hub,'a')).received).toBe(last-200000);
  const again=await open(hub,'browser','three'),other=await open(hub,'browser','four');await until(()=>policies(a).at(-1).interval===3);
  await age(200000);
  again.ws.close();await until(()=>runInDurableObject(hub,async(i:any)=>i.connected('browser').length===1));expect((await stored(hub,'a')).received).toBe(last-400000);
  other.ws.close();await until(async()=>(await stored(hub,'a')).received===last);a.ws.close();
 });
 it('leaves the last report of a computer that disconnects, for a viewer who opens later',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-offline')),a=await open(hub,'device','a');
  a.ws.send(report(1));await until(()=>stored(hub,'a'));
  await runInDurableObject(hub,async(i:any)=>{const d=i.latest.get('a');i.latest.set('a',{...d,received:d.received+60000,name:'newest'});});
  a.ws.close();await until(async()=>(await stored(hub,'a')).name==='newest');await forget(hub);
  const viewer=await open(hub,'browser','v');await until(()=>viewer.seen.length);
  expect(viewer.seen[0]).toMatchObject({type:'state',devices:[{id:'a',name:'newest',online:false}]});expect(viewer.seen[0].devices[0].snapshot.sessions).toHaveLength(1);viewer.ws.close();
 });
 it('shows the backup first, then the live report',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-first')),a=await open(hub,'device','a');
  a.ws.send(report(1));await until(()=>stored(hub,'a'));
  await runInDurableObject(hub,async(i:any,s:any)=>{const row=await s.storage.get('snapshot:a');await s.storage.put('snapshot:a',{...row,received:row.received-3000000});i.latest.clear();i.persisted.clear();});
  const viewer=await open(hub,'browser','v');await until(()=>viewer.seen.length);
  expect(viewer.seen[0].devices[0]).toMatchObject({id:'a',online:false});
  await until(()=>policies(a).at(-1).interval===3);
  a.ws.send(report(2));await until(()=>viewer.seen.some(m=>m.type==='snapshot'&&m.device.online));
  expect(viewer.seen.find(m=>m.type==='snapshot').device.snapshot.speed_periods[0].tokens).toBe(2);viewer.ws.close();a.ws.close();
 });
 it('writes a watched hour as one backup, not one every 30 seconds',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-hour'));
  await runInDurableObject(hub,async(instance:any)=>{
   let writes=0;const original=instance.storeDevice.bind(instance);instance.storeDevice=async(d:any)=>{writes++;return original(d);};
   const t=Date.now();for(let i=0;i<1200;i++)await instance.keepDevice(device(t+i*3000));
   expect(writes).toBe(1);
   instance.storeDevice=original;
  });
 });
});
