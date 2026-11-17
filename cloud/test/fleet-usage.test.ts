import {env,runInDurableObject} from 'cloudflare:test';
import {beforeAll,expect,it} from 'vitest';
import worker,{hash} from '../src/index';
import {snapshot,speedPeriods} from '../src/protocol';
import schema from '../schema.sql?raw';
const e:any=env;
beforeAll(async()=>{for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await e.DB.prepare(sql).run();});
it('only exports fixed, valid numerical speed periods',()=>{
 const rows=speedPeriods([{key:'custom:604800',seconds:604800,tokens:100,known:true,private:'SECRET'},
  {key:'custom:604800',seconds:604800,tokens:200,known:true},
  {key:'1h',seconds:1,tokens:99},{key:'all',seconds:10,tokens:-1},
  {key:'1h',seconds:3600,tokens:Infinity}]);
 expect(rows).toEqual([{key:'custom:604800',seconds:604800,tokens:200,known:true,partial:false}]);
});
it('device credentials read only other computers numerical totals within their own account',async()=>{
 const uid='speed-owner',id=crypto.randomUUID(),other=crypto.randomUUID(),token='t'.repeat(64);
 await e.DB.prepare('INSERT INTO hosted_access(user_id,kind,max_devices,created_at) VALUES(?,?,?,?)').bind(uid,'operator',25,1).run();
 await e.DB.prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)').bind(id,uid,'Mac','Darwin',await hash(token),1,null,1).run();
 const hub=e.HUBS.get(e.HUBS.idFromName(uid));
 const connected=await hub.fetch('https://hub/ws?'+new URLSearchParams({role:'device',id:other,expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});
 const ws=connected.webSocket!;ws.accept();
 const clean=snapshot({updated:Date.now()/1000,sessions:[{id:'private-session',project:'PRIVATE',control_key:'SECRET',tokens:[1,0,0,0]}],
  speed_periods:[{key:'1h',seconds:3600,tokens:3600,known:true}]});
 await runInDurableObject(hub,async(_i:any,s:any)=>{
  await s.storage.put('snapshot:'+id,{id,received:Date.now(),snapshot:clean});
  await s.storage.put('snapshot:'+other,{id:other,received:Date.now(),snapshot:clean});
 });
 const privateHub=e.HUBS.get(e.HUBS.idFromName('another-owner'));
 await runInDurableObject(privateHub,async(_i:any,s:any)=>s.storage.put('snapshot:private',{id:'private',received:Date.now(),snapshot:clean}));
 const request=(credential?:string)=>worker.fetch(new Request('https://relay.test/api/device/usage',{
  headers:credential?{Authorization:'Bearer '+credential}:{}
 }),e);
 expect((await request()).status).toBe(401);
 const result=await request(token);expect(result.status).toBe(200);
 const value:any=await result.json();
 expect(value.devices).toHaveLength(1);expect(value.devices[0]).toMatchObject({id:other,online:true,periods:[{key:'1h',tokens:3600}]});
 expect(JSON.stringify(value)).not.toMatch(/PRIVATE|SECRET|private-session|another-owner/);
 await e.DB.prepare('UPDATE devices SET revoked_at=1 WHERE id=?').bind(id).run();
 expect((await request(token)).status).toBe(401);
 ws.close();
});
