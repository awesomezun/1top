import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import {snapshot} from '../src/protocol';
// The relay's cost work (Workers Paid): a watched computer's 3-second reports reach viewers every time and storage at
// most every 30 seconds; the hub wakes hourly for cleanup, or sooner for a session's expiry.
const e:any=env;
function sample(){return {updated:Date.now()/1000,recording_started:0,version:'test',sessions:[{id:'session',control_key:'key',kind:'Claude',app:'Cursor',terminal:'test',project:'demo',title:'test',model:'test',status:'idle',tokens:[1,2,3,4],windows:{'1h':[1,2,3,4]},cpu:1,rss:100,capabilities:['terminate']}],host:{cpu:1,used_memory:10,total_memory:100,cores:2},periods:[]};}
const device=(received:number)=>({id:'cost-mac',name:'Mac',platform:'Darwin',received,snapshot:snapshot(sample())});

describe('relay cost',()=>{
 it('keeps every report for viewers and commands but writes one at most every 30 seconds',async()=>{
  const hub=e.HUBS.get(e.HUBS.idFromName('cost-writes'));
  await runInDurableObject(hub,async(instance:any,state:any)=>{
   const t=Date.now();
   await instance.keepDevice(device(t));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t);
   await instance.keepDevice(device(t+3000));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t);
   expect((await instance.readDevice('cost-mac')).received).toBe(t+3000);
   await instance.keepDevice(device(t+30000));
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t+30000);
   await instance.keepDevice(device(t+33000),true);
   expect((await state.storage.get('snapshot:cost-mac')).received).toBe(t+33000);
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
});
