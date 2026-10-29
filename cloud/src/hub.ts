import { DurableObject } from 'cloudflare:workers';
import {reconcileSubscription,checkout} from './billing';
import { snapshot, action, text, mailboxRows, SPEED_SECONDS, type DeviceSnapshot } from './protocol';
export interface Env { DB:D1Database; HUBS:DurableObjectNamespace<AccountHub>; FIREBASE_PROJECT_ID:string; WEB_ORIGINS:string; WEB_URL:string; PAIRING_ENABLED?:string; BILLING_ENABLED?:string; STRIPE_SECRET_KEY?:string; STRIPE_WEBHOOK_SECRET?:string; STRIPE_PRICE_ID?:string; PLAN_MAX_DEVICES?:string; DEPLOYMENT_MODE?:string; OWNER_USER_ID?:string; }
type Attachment = {role:'device'|'browser';id:string;expires:number;name?:string;platform?:string;allow_control?:boolean;
  mailbox_at?:number;mailbox?:{request_id:string;device_id:string;session_id:string;expires:number}};
type StoredDevice = {id:string;name:string;platform:string;received:number;snapshot:DeviceSnapshot};
type Receipt = {request:Omit<ReturnType<typeof action>,'prompt'|'attachments'>;fingerprint?:string;created:number;status:string;message?:string};
const json=(value:unknown,status=200)=>Response.json(value,{status});
export class AccountHub extends DurableObject<Env> {
  constructor(ctx:DurableObjectState,env:Env){super(ctx,env);ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));}
  reportPolicy(){
    const watching=this.ctx.getWebSockets('browser').some(ws=>ws.readyState===1&&(ws.deserializeAttachment() as Attachment).expires>Date.now());
    for(const ws of this.ctx.getWebSockets('device'))if(ws.readyState===1)ws.send(JSON.stringify({type:'report_policy',interval:watching?3:60}));
  }
  async fetch(request:Request):Promise<Response> {
    const u=new URL(request.url),path=u.pathname;
    if(path==='/usage'&&request.method==='GET'){
      const records=await this.ctx.storage.list<StoredDevice>({prefix:'snapshot:'});
      const devices=[...records.values()].filter(d=>d.id!==u.searchParams.get('exclude')).map(d=>{
        const current=this.ctx.getWebSockets('device:'+d.id).some(ws=>ws.readyState===1&&(ws.deserializeAttachment() as Attachment).expires>Date.now());
        const periods=d.snapshot.speed_periods?.length?d.snapshot.speed_periods:d.snapshot.periods.map(p=>({
          key:p.key,seconds:SPEED_SECONDS[p.key],tokens:p.tokens.reduce((a,b)=>a+b,0),
          known:d.snapshot.sessions.some(s=>s.tokens!==null)||p.tokens.some(n=>n>0),partial:p.partial}));
        return {id:d.id,received:d.received,online:current&&Date.now()-d.received<90000,periods};
      });
      return json({devices});
    }
    if(path==='/billing/checkout'&&request.method==='POST'){
      const {uid}=await request.json() as {uid:string};
      if(typeof uid!=='string'||!uid||uid.length>128)return json({error:'Invalid account'},400);
      return this.ctx.blockConcurrencyWhile(async()=>{
        try{return await checkout(this.env,uid,this.ctx.storage);}
        catch{return json({error:'Checkout is temporarily unavailable. No access was granted.'},503);}
      });
    }
    if(path==='/billing/sync'&&request.method==='POST') {
      const {uid,customer}=await request.json() as {uid:string;customer:string};
      if(typeof uid!=='string'||!/^cus_[A-Za-z0-9]+$/.test(customer))return json({error:'Invalid customer'},400);
      return this.ctx.blockConcurrencyWhile(async()=>{
        try{
          const state=await reconcileSubscription(this.env,uid,customer);
          if(state.changed)for(const ws of this.ctx.getWebSockets())ws.close(4003,'Subscription updated; reconnect');
          return json({received:true});
        }catch{return json({error:'Billing reconciliation unavailable'},503);}
      });
    }
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
      this.reportPolicy();
      await this.ctx.storage.setAlarm(Date.now()+60000);
      return new Response(null,{status:101,webSocket:client,headers:role==='browser'?{'Sec-WebSocket-Protocol':'1top'}:{}});
    }
    if(path==='/action'&&request.method==='POST') {
      const cmd=action(await request.json()),key='receipt:'+cmd.request_id;
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(cmd))))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const previous=await this.ctx.storage.get<Receipt>(key);
      if(previous)return (previous.fingerprint?previous.fingerprint===fingerprint:JSON.stringify(previous.request)===JSON.stringify(cmd))?json(previous):json({error:'Request ID already used'},409);
      const sockets=this.ctx.getWebSockets('device:'+cmd.device_id).filter(ws=>ws.readyState===1);
      const device=await this.ctx.storage.get<StoredDevice>('snapshot:'+cmd.device_id);
      const s=device?.snapshot.sessions.find(s=>s.id===cmd.session_id);
      if(sockets.length!==1 || !device || Date.now()-device.received>20000)return json({error:'Device is offline or stale. Nothing sent.'},409);
      const attached=sockets[0].deserializeAttachment() as Attachment;
      if(!attached.allow_control || !s || s.control_key!==cmd.control_key || !s.capabilities.includes(cmd.action))return json({error:'Action is not available for this session.'},409);
      if(cmd.attachments?.length&&!s.capabilities.includes('message_images'))return json({error:'Update this computer before sending photos.'},409);
      // Save first; an ambiguous delivery is never automatically replayed.
      const {prompt:instruction,attachments:photos,...metadata}=cmd;
      const record:Receipt={request:metadata,fingerprint,created:Date.now(),status:'sent'};
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
    try {
      const value=JSON.parse(message);
      if(a.role==='browser') {
        if(value.type!=='mailbox_request'||!/^[a-f0-9-]{36}$/.test(value.request_id||'')||!/^[a-f0-9-]{36}$/.test(value.device_id||''))throw Error('Invalid mailbox request');
        const fail=(error:string)=>ws.send(JSON.stringify({type:'mailbox',request_id:value.request_id,device_id:value.device_id,session_id:text(value.session_id,200),error}));
        if(Date.now()-(a.mailbox_at||0)<2000){fail('Please wait before refreshing this mailbox.');return;}
        a.mailbox_at=Date.now();a.mailbox=undefined;ws.serializeAttachment(a);
        const device=await this.ctx.storage.get<StoredDevice>('snapshot:'+value.device_id);
        const session=device?.snapshot.sessions.find(s=>s.id===value.session_id&&s.control_key===value.control_key);
        const sockets=this.ctx.getWebSockets('device:'+value.device_id).filter(s=>s.readyState===1);
        if(!device||Date.now()-device.received>20000||sockets.length!==1||!session?.capabilities.includes('mailbox')||!(sockets[0].deserializeAttachment() as Attachment).allow_control){fail('This session mailbox is unavailable.');return;}
        a.mailbox={request_id:value.request_id,device_id:value.device_id,session_id:session.id,expires:Date.now()+15000};ws.serializeAttachment(a);
        sockets[0].send(JSON.stringify({type:'mailbox_request',request_id:value.request_id,device_id:value.device_id,session_id:session.id,control_key:session.control_key,expires_at:a.mailbox.expires}));
        return;
      }
      if(value.type==='snapshot'){
        const clean=snapshot(value.data);
        if(Math.abs(Date.now()/1000-clean.updated)>120)throw Error('Clock differs');
        const old=await this.ctx.storage.get<StoredDevice>('snapshot:'+a.id);
        if(old&&Date.now()-old.received<2000)return; // bound each device's update rate
        const device:StoredDevice={id:a.id,name:a.name||'Computer',platform:a.platform||'',received:Date.now(),snapshot:clean};
        await this.ctx.storage.put('snapshot:'+a.id,device);this.broadcast({type:'snapshot',device:{...device,online:true}});
      } else if(value.type==='mailbox') {
        // Reply content is forwarded only to its requesting socket; never put in storage.
        for(const browser of this.ctx.getWebSockets('browser')) {
          const attached=browser.deserializeAttachment() as Attachment,pending=attached.mailbox;
          if(browser.readyState!==1||attached.expires<Date.now()||!pending||pending.expires<Date.now()||pending.request_id!==value.request_id||pending.device_id!==a.id||pending.session_id!==value.session_id)continue;
          const result=value.error?{error:text(value.error,200)}:{messages:mailboxRows(value.messages)};
          browser.send(JSON.stringify({type:'mailbox',request_id:pending.request_id,device_id:a.id,session_id:pending.session_id,...result}));
          attached.mailbox=undefined;browser.serializeAttachment(attached);
        }
      } else if(value.type==='result') {
        const id=text(value.request_id,36),key='receipt:'+id,record=await this.ctx.storage.get<Receipt>(key);
        if(!record||record.request.device_id!==a.id||!['sent','unconfirmed'].includes(record.status))return;
        record.status=value.ok===true?'completed':'failed';record.message=text(value.message,400);
        await this.ctx.storage.put(key,record);this.broadcast({type:'result',...record});
      }else throw Error('Unsupported message');
    }catch{ws.close(1008,'Invalid device message');}
  }
  async webSocketClose(ws:WebSocket){this.reportPolicy();const a=ws.deserializeAttachment() as Attachment;if(a.role==='device'&&!this.isOnline(a.id))this.broadcast({type:'offline',device_id:a.id});}
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
