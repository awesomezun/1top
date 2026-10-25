import { DurableObject } from 'cloudflare:workers';
import { snapshot, action, text, type DeviceSnapshot } from './protocol';
export interface Env { DB:D1Database; HUBS:DurableObjectNamespace<AccountHub>; FIREBASE_PROJECT_ID:string; WEB_ORIGINS:string; WEB_URL:string; PAIRING_ENABLED?:string; }
type Attachment = {role:'device'|'browser';id:string;expires:number;name?:string;platform?:string;allow_control?:boolean};
type StoredDevice = {id:string;name:string;platform:string;received:number;snapshot:DeviceSnapshot};
type Receipt = {request:ReturnType<typeof action>;created:number;status:string;message?:string};
const json=(value:unknown,status=200)=>Response.json(value,{status});
export class AccountHub extends DurableObject<Env> {
  async fetch(request:Request):Promise<Response> {
    const u=new URL(request.url),path=u.pathname;
    if(path==='/ws') {
      const role=u.searchParams.get('role') as Attachment['role'];
      if(!['device','browser'].includes(role)||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'Invalid upgrade'},400);
      if(this.ctx.getWebSockets(role).filter(ws=>ws.readyState===1&&(ws.deserializeAttachment() as Attachment).id!==u.searchParams.get('id')).length>=(role==='browser'?12:25))return json({error:'Connection limit reached'},429);
      const id=u.searchParams.get('id')!;
      if(role==='device')for(const old of this.ctx.getWebSockets('device:'+id))old.close(4001,'New device connection');
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);
      const mobile=u.searchParams.get('mobile');
      this.ctx.acceptWebSocket(server,[role,role+':'+id,...(role==='browser'&&mobile?['mobile:'+mobile]:[])]);
      server.serializeAttachment({role,id,expires:Number(u.searchParams.get('expires')),name:u.searchParams.get('name')||'',platform:u.searchParams.get('platform')||'',allow_control:u.searchParams.get('control')==='1'} satisfies Attachment);
      if(role==='browser') {
        const records=await this.ctx.storage.list<StoredDevice>({prefix:'snapshot:'});
        server.send(JSON.stringify({type:'state',devices:[...records.values()].filter(v=>Date.now()-v.received<86400000).map(v=>({...v,online:this.isOnline(v.id)&&Date.now()-v.received<30000}))}));
      }
      await this.ctx.storage.setAlarm(Date.now()+60000);
      return new Response(null,{status:101,webSocket:client,headers:role==='browser'?{'Sec-WebSocket-Protocol':'1top'}:{}});
    }
    if(path==='/action'&&request.method==='POST') {
      const cmd=action(await request.json()),key='receipt:'+cmd.request_id;
      const previous=await this.ctx.storage.get<Receipt>(key);
      if(previous)return JSON.stringify(previous.request)===JSON.stringify(cmd)?json(previous):json({error:'Request ID already used'},409);
      const sockets=this.ctx.getWebSockets('device:'+cmd.device_id).filter(ws=>ws.readyState===1);
      const device=await this.ctx.storage.get<StoredDevice>('snapshot:'+cmd.device_id);
      const s=device?.snapshot.sessions.find(s=>s.id===cmd.session_id);
      if(sockets.length!==1 || !device || Date.now()-device.received>20000)return json({error:'Device is offline or stale. Nothing sent.'},409);
      const attached=sockets[0].deserializeAttachment() as Attachment;
      if(!attached.allow_control || !s || s.control_key!==cmd.control_key || !s.capabilities.includes(cmd.action))return json({error:'Action is not available for this session.'},409);
      // Save first; an ambiguous delivery is never automatically replayed.
      const record:Receipt={request:cmd,created:Date.now(),status:'sent'};
      await this.ctx.storage.put(key,record);
      try{sockets[0].send(JSON.stringify({type:'action',...cmd,expires_at:Date.now()+15000}));}
      catch{record.status='unconfirmed';await this.ctx.storage.put(key,record);return json(record,202);}
      return json(record,202);
    }
    if(path==='/mobile/revoke'&&request.method==='POST') {
      const {hash}=await request.json() as {hash:string};
      if(!/^[a-f0-9]{64}$/.test(hash))return json({error:'Invalid session'},400);
      for(const ws of this.ctx.getWebSockets('mobile:'+hash))ws.close(4003,'Mobile session signed out');
      return json({ok:true});
    }
    if(path==='/revoke'&&request.method==='POST') {
      const {id}=await request.json() as {id:string};
      for(const ws of this.ctx.getWebSockets('device:'+id))ws.close(4003,'Device disconnected by owner');
      await this.ctx.storage.delete('snapshot:'+id);this.broadcast({type:'removed',device_id:id});return json({ok:true});
    }
    return json({error:'Not found'},404);
  }
  isOnline(id:string){return this.ctx.getWebSockets('device:'+id).some(ws=>ws.readyState===1);}
  broadcast(value:unknown){const raw=JSON.stringify(value);for(const ws of this.ctx.getWebSockets('browser')){const a=ws.deserializeAttachment() as Attachment;if(a.expires<Date.now()){ws.close(4003,'Session expired');continue;}try{ws.send(raw);}catch{ws.close(1011,'Disconnected');}}}
  async webSocketMessage(ws:WebSocket, message:string|ArrayBuffer) {
    const a=ws.deserializeAttachment() as Attachment;
    if(ws.readyState!==1)return;
    if(a.expires<Date.now()){ws.close(4003,'Session expired');return;}
    if(typeof message!=='string'||message.length>256000){ws.close(1009,'Message too large');return;}
    if(message==='ping'){ws.send('pong');return;}
    if(a.role!=='device'){ws.close(1008,'Unsupported message');return;}
    try {
      const value=JSON.parse(message);
      if(value.type==='snapshot'){
        const clean=snapshot(value.data);
        if(Math.abs(Date.now()/1000-clean.updated)>120)throw Error('Clock differs');
        const old=await this.ctx.storage.get<StoredDevice>('snapshot:'+a.id);
        if(old&&Date.now()-old.received<2000)return; // bound each device's update rate
        const device:StoredDevice={id:a.id,name:a.name||'Computer',platform:a.platform||'',received:Date.now(),snapshot:clean};
        await this.ctx.storage.put('snapshot:'+a.id,device);this.broadcast({type:'snapshot',device:{...device,online:true}});
      } else if(value.type==='result') {
        const id=text(value.request_id,36),key='receipt:'+id,record=await this.ctx.storage.get<Receipt>(key);
        if(!record||record.request.device_id!==a.id||!['sent','unconfirmed'].includes(record.status))return;
        record.status=value.ok===true?'completed':'failed';record.message=text(value.message,400);
        await this.ctx.storage.put(key,record);this.broadcast({type:'result',...record});
      }else throw Error('Unsupported message');
    }catch{ws.close(1008,'Invalid device message');}
  }
  async webSocketClose(ws:WebSocket){const a=ws.deserializeAttachment() as Attachment;if(a.role==='device'&&!this.isOnline(a.id))this.broadcast({type:'offline',device_id:a.id});}
  async webSocketError(ws:WebSocket){ws.close(1011,'Connection error');}
  async alarm(){
    const now=Date.now();for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment() as Attachment;if(a.expires<now)ws.close(4003,'Session expired');}
    const snapshots=await this.ctx.storage.list<StoredDevice>({prefix:'snapshot:'});
    for(const [key,v] of snapshots)if(now-v.received>86400000)await this.ctx.storage.delete(key);
    const receipts=await this.ctx.storage.list<Receipt>({prefix:'receipt:'});
    for(const [key,v] of receipts)if(now-v.created>86400000)await this.ctx.storage.delete(key);
    if(this.ctx.getWebSockets().length||snapshots.size||receipts.size)await this.ctx.storage.setAlarm(now+60000);
  }
}
