import {env,runInDurableObject} from 'cloudflare:test';
import {expect,it} from 'vitest';
declare const __ONETOP_BENCHMARK__:boolean;
const enabled=__ONETOP_BENCHMARK__;
it.skipIf(!enabled)('measures isolated hubs with concurrent live viewers',async()=>{
 const accounts=25,perAccount=2,rounds=10,latencies:number[]=[],all:WebSocket[]=[],rows:any[]=[];
 const message=(ws:WebSocket,type:string)=>new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out: '+type)),5000);const listener=(e:MessageEvent)=>{const m=JSON.parse(e.data as string);if(m.type!==type)return;clearTimeout(timer);ws.removeEventListener('message',listener);resolve(m);};ws.addEventListener('message',listener);});
 const connect=async(hub:any,role:string,id:string)=>{const r=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});expect(r.status).toBe(101);const ws=r.webSocket!;ws.accept();all.push(ws);return ws;};
 try{
  for(let i=0;i<accounts;i++){
   const hub=env.HUBS.get(env.HUBS.idFromName('benchmark-'+i)),viewer=await connect(hub,'browser','viewer');await message(viewer,'state');
   const devices=[];for(let n=0;n<perAccount;n++)devices.push(await connect(hub,'device',i+'-'+n));
   rows.push({hub,viewer,devices,index:i});
  }
  let bytes=0;
  for(let round=0;round<rounds;round++){
   const received=rows.map(({viewer,index})=>new Promise<void>((resolve,reject)=>{let count=0;const start=performance.now(),timer=setTimeout(()=>reject(Error('Missing update')),5000);const listener=(event:MessageEvent)=>{const m=JSON.parse(event.data as string);if(m.type!=='snapshot')return;expect(m.device.id.startsWith(index+'-')).toBe(true);latencies.push(performance.now()-start);if(++count===perAccount){clearTimeout(timer);viewer.removeEventListener('message',listener);resolve();}};viewer.addEventListener('message',listener);}));
   for(const row of rows)for(const [n,device] of row.devices.entries()){
    const payload=JSON.stringify({type:'snapshot',data:{updated:Date.now()/1000,version:'benchmark',sessions:Array.from({length:30},(_,j)=>({id:row.index+'-'+n+'-'+j,kind:'Codex',project:'fixture',status:'idle',tokens:[j*7,j,0,j*3],windows:{'1h':[j*7,j,0,j*3]},capabilities:[]})),host:{cpu:20,used_memory:1024,total_memory:2048,cores:8},periods:[]}});bytes+=new TextEncoder().encode(payload).length;device.send(payload);
   }
   await Promise.all(received);if(round<rounds-1)await new Promise(r=>setTimeout(r,2100));
  }
  latencies.sort((a,b)=>a-b);
  expect({environment:'local workerd; not production capacity or invoice',accounts,devices:accounts*perAccount,viewers:accounts,sessions_per_device:30,snapshots:latencies.length,mean_ms:latencies.reduce((a,b)=>a+b,0)/latencies.length,p95_ms:latencies[Math.floor(latencies.length*.95)],max_ms:latencies.at(-1),mean_input_bytes:bytes/latencies.length,account_isolation:true}).toMatchSnapshot();
  expect(latencies).toHaveLength(accounts*perAccount*rounds);
 }finally{for(const ws of all)ws.close();for(const row of rows)await runInDurableObject(row.hub,async(_i:any,state:any)=>{await state.storage.deleteAll();});}
},45000);
