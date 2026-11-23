import {env,runInDurableObject} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
const e:any=env;
// A computer's report as a gzip binary frame, and everything that is not one.
const sample=(tokens:number,extra:any={})=>({type:'snapshot',data:{updated:Date.now()/1000,recording_started:0,version:'test',sessions:[{id:'session',control_key:'key',kind:'Claude',app:'Cursor',terminal:'test',project:'demo',title:'가나다',model:'test',status:'idle',tokens:[1,2,3,4],windows:{'1h':[1,2,3,4]},cpu:1,rss:100,capabilities:['terminate']}],host:{cpu:1,used_memory:10,total_memory:100,cores:2},periods:[],speed_periods:[{key:'1h',seconds:3600,tokens,known:true}],...extra}});
async function gz(value:string|Uint8Array){const s=new CompressionStream('gzip'),w=s.writable.getWriter();w.write(typeof value==='string'?new TextEncoder().encode(value):value);w.close();return new Response(s.readable).arrayBuffer();}
const open=async(hub:any,role:string,id:string)=>{
 const response=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,name:id,platform:'Darwin',control:'1',expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});
 const ws=response.webSocket!,seen:any[]=[],closed:number[]=[];ws.addEventListener('message',(m:any)=>seen.push(JSON.parse(m.data)));ws.addEventListener('close',(c:any)=>closed.push(c.code));ws.accept();return {ws,seen,closed};
};
const until=async(test:()=>unknown)=>{for(let i=0;i<300;i++){if(await test())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');};
const hubOf=(name:string)=>e.HUBS.get(e.HUBS.idFromName('gzip-'+name));

describe('gzip reports',()=>{
 it('is announced to every computer, and a gzip report is the same as a text one',async()=>{
  const hub=hubOf('same'),viewer=await open(hub,'browser','v'),a=await open(hub,'device','a'),b=await open(hub,'device','b');
  await until(()=>a.seen.length);expect(a.seen.at(-1)).toMatchObject({type:'report_policy',gzip:true});
  const report=sample(42,{prompt:'SECRET',sessions:[{...sample(1).data.sessions[0],prompt:'SECRET'}]});
  a.ws.send(await gz(JSON.stringify(report)));b.ws.send(JSON.stringify(report));
  const got=(id:string)=>viewer.seen.find(m=>m.type==='snapshot'&&m.device.id===id);
  await until(()=>got('a')&&got('b'));
  expect(got('a').device.snapshot).toEqual(got('b').device.snapshot);
  expect(got('a').device.snapshot.sessions[0].title).toBe('가나다');
  // The allowlist applies to both.
  expect(JSON.stringify(viewer.seen)).not.toContain('SECRET');
  const usage:any=await (await hub.fetch('https://hub/usage?exclude=b')).json();expect(usage.devices[0]).toMatchObject({id:'a',online:true,periods:[{key:'1h',tokens:42}]});
  for(const c of [viewer,a,b])c.ws.close();
 });
 it('refuses a frame that is broken, cut short, not JSON or not a report',async()=>{
  const hub=hubOf('broken'),good=new Uint8Array(await gz(JSON.stringify(sample(1))));
  for(const [name,frame] of [['noise',new Uint8Array([1,2,3,4])],['cut',good.slice(0,good.length-20)],['empty',new Uint8Array()],['text',new Uint8Array(await gz('not json'))],['other',new Uint8Array(await gz('{"type":"nope"}'))],['utf8',new Uint8Array(await gz(new Uint8Array([0xff,0xfe,0xfd])))]] as [string,Uint8Array][]){
   const c=await open(hub,'device','d-'+name);c.ws.send(frame);await until(()=>c.closed.length);expect([name,c.closed[0]]).toEqual([name,1008]);
  }
  expect(await runInDurableObject(hub,async(i:any,s:any)=>[i.latest.size,(await s.storage.list({prefix:'snapshot:'})).size])).toEqual([0,0]);
 });
 it('stops unpacking a small frame that would become a huge one, and a large frame at once',async()=>{
  const hub=hubOf('bomb'),bomb=await gz('{"a":"'+' '.repeat(30_000_000)+'"}');expect(bomb.byteLength).toBeLessThan(100_000);
  const c=await open(hub,'device','bomb');c.ws.send(bomb);await until(()=>c.closed.length);expect(c.closed[0]).toBe(1008);
  const big=await open(hub,'device','big');big.ws.send(new Uint8Array(1048577));await until(()=>big.closed.length);expect(big.closed[0]).toBe(1009);
 });
 it('takes binary frames from computers only',async()=>{
  const v=await open(hubOf('viewer'),'browser','v');v.ws.send(await gz(JSON.stringify(sample(1))));await until(()=>v.closed.length);expect(v.closed[0]).toBe(1009);
 });
 it('keeps the pace limit of one report every two seconds',async()=>{
  const hub=hubOf('pace'),viewer=await open(hub,'browser','v'),a=await open(hub,'device','a');
  for(let i=0;i<5;i++)a.ws.send(await gz(JSON.stringify(sample(i))));
  await until(()=>viewer.seen.some(m=>m.type==='snapshot'));await new Promise(r=>setTimeout(r,150));
  expect(viewer.seen.filter(m=>m.type==='snapshot')).toHaveLength(1);viewer.ws.close();a.ws.close();
 });
});
