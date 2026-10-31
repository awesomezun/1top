import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AccountHub, type Env } from './hub';
import { accountAlias, action, text } from './protocol';
import { AccessDenied, accessDeadline, requireHostedAccess } from './access';
import {billingReady,billingStatus,portal,webhook} from './billing';
import { MOBILE_TOKEN, mobileIdentity, authorizeMobile } from './mobile';
export { AccountHub };
const KEYS=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const now=()=>Math.floor(Date.now()/1000);
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function hash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const bearer=(req:Request)=>req.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9._-]{20,8000})$/)?.[1];
async function body(req:Request,max=8192){
 const reader=req.body?.getReader();if(!reader)throw Error('Missing body');
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('Body too large');}parts.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
 return JSON.parse(new TextDecoder().decode(all));
}
async function user(req:Request,env:Env,googleOnly=false):Promise<{id:string;expires:number;mobileHash?:string}>{
 const token=bearer(req);if(!token)throw new Error('Authentication required');
 if(MOBILE_TOKEN.test(token)){
  if(googleOnly)throw new Error('Fresh Google sign-in required');
  const mobile=await mobileIdentity(env.DB,await hash(token),now());
  if(env.DEPLOYMENT_MODE==='self_hosted'&&mobile.id!==env.OWNER_USER_ID)throw new AccessDenied();
  return mobile;
 }
 const {payload}=await jwtVerify(token,KEYS,{issuer:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,audience:env.FIREBASE_PROJECT_ID,algorithms:['RS256']});
 if(!payload.sub || payload.sub.length>128 || payload.email_verified!==true || (payload.firebase as any)?.sign_in_provider!=='google.com')throw new Error('Google sign-in required');
 if(env.DEPLOYMENT_MODE==='self_hosted'){
  if(!env.OWNER_USER_ID||payload.sub!==env.OWNER_USER_ID)throw new AccessDenied();
  await env.DB.prepare("INSERT INTO hosted_access(user_id,kind,max_devices,created_at) VALUES(?,'operator',25,?) ON CONFLICT(user_id) DO NOTHING").bind(payload.sub,now()).run();
 }
 return {id:payload.sub,expires:payload.exp!*1000};
}
async function approvedUser(req:Request,env:Env){
 const u=await user(req,env),access=await requireHostedAccess(env.DB,u.id);
 return {...u,access,expires:accessDeadline(access,u.expires)};
}
async function limit(db:D1Database,key:string,max:number,seconds=60){
 const bucket=Math.floor(now()/seconds),id=key+':'+bucket;
 const row=await db.prepare('INSERT INTO request_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(id,now()+seconds*2).first<{count:number}>();
 return (row?.count||0)<=max;
}
function hub(env:Env,uid:string){return env.HUBS.get(env.HUBS.idFromName(uid));}
async function device(req:Request,env:Env){
 const token=bearer(req);if(!token)return null;
 return env.DB.prepare('SELECT id,user_id,name,platform,allow_control FROM devices WHERE token_hash=? AND revoked_at IS NULL').bind(await hash(token)).first<{id:string;user_id:string;name:string;platform:string;allow_control:number}>();
}
async function handle(req:Request,env:Env):Promise<Response>{
 const url=new URL(req.url),path=url.pathname;
 if(path==='/api/billing/webhook'&&req.method==='POST')return webhook(req,env);
 if(path==='/api/billing'&&req.method==='GET'){
   const u=await user(req,env);
   if(!await limit(env.DB,'billing-status:'+u.id,12))return json({error:'Please wait before refreshing billing.'},429);
   return json(await billingStatus(env,u.id));
 }
 if(['/api/billing/checkout','/api/billing/portal'].includes(path)&&req.method==='POST'){
   const u=await user(req,env,true);
   if(!await limit(env.DB,'billing:'+u.id,6,600))return json({error:'Too many billing requests. Try again later.'},429);
   return path.endsWith('/checkout')?hub(env,u.id).fetch(new Request('https://hub/billing/checkout',{method:'POST',body:JSON.stringify({uid:u.id})})):portal(env,u.id);
 }
 if(path==='/health')return json({ok:true,service:'1top relay',version:'1.11.0',access:'approved-accounts',billing_enabled:billingReady(env),mode:env.DEPLOYMENT_MODE==='self_hosted'?'self_hosted':'managed',pairing_enabled:env.PAIRING_ENABLED==='true'});
 if(path==='/api/mobile/authorize'&&req.method==='POST'){
   const u=await user(req,env,true),access=await requireHostedAccess(env.DB,u.id);
   if(!await limit(env.DB,'mobile:'+u.id,10,600))return json({error:'Too many mobile sign-ins. Try again later.'},429);
   const data=await body(req),result=await authorizeMobile(env.DB,u.id,data.challenge,data.platform,now(),access.expires_at);
   return result?json(result):json({error:'This request was already used or the account has five mobile sign-ins.'},409);
 }
 if(path==='/api/mobile/logout'&&req.method==='POST'){
   const u=await user(req,env);if(!u.mobileHash)return json({error:'Mobile session required'},400);
   await env.DB.batch([env.DB.prepare('DELETE FROM mobile_sessions WHERE token_hash=? AND user_id=?').bind(u.mobileHash,u.id),env.DB.prepare('DELETE FROM tickets WHERE mobile_hash=?').bind(u.mobileHash)]);
   return hub(env,u.id).fetch(new Request('https://hub/mobile/revoke',{method:'POST',body:JSON.stringify({hash:u.mobileHash})}));
 }
 // Stop all public pairing work before touching D1 while enrollment is closed.
 if(path.startsWith('/api/pair/')&&env.PAIRING_ENABLED!=='true')return json({error:'New managed connections are paused while remote-access plans are prepared. Existing approved connections remain available.',code:'managed_pairing_paused'},403);
 if(path==='/api/pair/start'&&req.method==='POST'){
   const ip=await hash(req.headers.get('CF-Connecting-IP')||'local');
   if(!await limit(env.DB,'pair:'+ip,12,600))return json({error:'Too many connection attempts. Try again later.'},429);
   const data=await body(req),name=text(data.name,80),platform=text(data.platform,30);
   if(!name||!platform)return json({error:'Computer name and platform are required.'},400);
   const secret=random(),code=random().slice(0,10).toUpperCase();
   await env.DB.prepare('INSERT INTO pairings(code,secret_hash,name,platform,expires_at) VALUES(?,?,?,?,?)').bind(code,await hash(secret),name,platform,now()+600).run();
   return json({device_code:secret,user_code:code,expires_in:600,interval:3,verification_uri_complete:env.WEB_URL+'/connect'+(env.DEPLOYMENT_MODE==='self_hosted'?'?relay='+encodeURIComponent(url.origin):'')+'#'+code});
 }
 if(path==='/api/pair/info'&&req.method==='POST'){
   const {code}=await body(req);if(!/^[A-F0-9]{10}$/.test(code||''))return json({error:'Invalid connection code'},400);
   const r=await env.DB.prepare('SELECT name,platform,expires_at FROM pairings WHERE code=? AND expires_at>?').bind(code,now()).first();
   return r?json(r):json({error:'This connection request expired.'},410);
 }
 if(path==='/api/pair/approve'&&req.method==='POST'){
   const u=await approvedUser(req,env),data=await body(req);
   if(!/^[A-F0-9]{10}$/.test(data.code||''))return json({error:'Invalid connection code'},400);
   const count=await env.DB.prepare('SELECT COUNT(*) n FROM devices WHERE user_id=? AND revoked_at IS NULL').bind(u.id).first<{n:number}>();
   if((count?.n||0)>=u.access.max_devices)return json({error:'This account has reached its device allowance.'},409);
   const r=await env.DB.prepare('UPDATE pairings SET user_id=?,allow_control=? WHERE code=? AND expires_at>? AND user_id IS NULL RETURNING name').bind(u.id,data.allow_control===false?0:1,data.code,now()).first();
   return r?json({ok:true}):json({error:'Request expired or already connected.'},409);
 }
 if(path==='/api/pair/poll'&&req.method==='POST'){
   const data=await body(req);if(!/^[a-f0-9]{64}$/.test(data.device_code||''))return json({error:'Invalid device request'},400);
   const key=await hash(data.device_code);
   if(!await limit(env.DB,'poll:'+key,30))return json({error:'slow_down'},429);
   const pending=await env.DB.prepare('SELECT expires_at,user_id FROM pairings WHERE secret_hash=?').bind(key).first<{expires_at:number;user_id:string|null}>();
   if(!pending||pending.expires_at<now())return json({error:'expired'},410);
   if(!pending.user_id)return json({status:'pending'},202);
   const access=await requireHostedAccess(env.DB,pending.user_id);
   const p=await env.DB.prepare('DELETE FROM pairings WHERE secret_hash=? AND user_id IS NOT NULL AND expires_at>? RETURNING user_id,name,platform,allow_control').bind(key,now()).first<{user_id:string;name:string;platform:string;allow_control:number}>();
   if(!p)return json({error:'Already claimed. Connect this computer again.'},409);
   const token=random(),id=crypto.randomUUID();
   const inserted=await env.DB.prepare('INSERT INTO devices(id,user_id,name,platform,token_hash,created_at,allow_control) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM devices WHERE user_id=? AND revoked_at IS NULL)<? RETURNING id').bind(id,p.user_id,p.name,p.platform,await hash(token),now(),p.allow_control,p.user_id,access.max_devices).first();
   if(!inserted)return json({error:'Device limit reached. Remove a computer before connecting another.'},409);
   return json({device_id:id,device_token:token,relay_url:url.origin.replace(/^http/,'ws')+'/api/device/socket'});
 }
 if(path==='/api/device/usage'&&req.method==='GET'){
   const d=await device(req,env);if(!d)return json({error:'Device authentication required'},401);
   await requireHostedAccess(env.DB,d.user_id);
   if(!await limit(env.DB,'usage:'+d.id,12))return json({error:'Refresh limit reached'},429);
   return hub(env,d.user_id).fetch('https://hub/usage?exclude='+encodeURIComponent(d.id));
 }
 if(path==='/api/device/socket'){
   const d=await device(req,env);if(!d)return json({error:'Device authentication required'},401);
   const access=await requireHostedAccess(env.DB,d.user_id);
   const target=new URL('https://hub/ws');for(const [k,v] of Object.entries({role:'device',id:d.id,name:d.name,platform:d.platform,control:String(d.allow_control),expires:String(accessDeadline(access,Date.now()+86400000))}))target.searchParams.set(k,v);
   return hub(env,d.user_id).fetch(new Request(target,{headers:{Upgrade:'websocket'}}));
 }
 if(path==='/api/live-ticket'&&req.method==='POST'){
   const u=await approvedUser(req,env);if(!await limit(env.DB,'ticket:'+u.id,30))return json({error:'Reconnect limit reached'},429);
   const ticket=random();await env.DB.prepare('INSERT INTO tickets(hash,user_id,expires_at,auth_expires,mobile_hash) VALUES(?,?,?,?,?)').bind(await hash(ticket),u.id,Math.min(now()+30,Math.floor(u.expires/1000)),u.expires,u.mobileHash||null).run();
   return json({ticket,socket_url:url.origin.replace(/^http/,'ws')+'/api/live',expires_at:u.expires});
 }
 if(path==='/api/live'){
   const origin=req.headers.get('Origin');if(!origin||!env.WEB_ORIGINS.split(',').includes(origin))return json({error:'Origin not allowed'},403);
   const protocols=(req.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(x=>x.trim());
   const token=protocols.find(x=>x.startsWith('ticket.'))?.slice(7);
   if(!protocols.includes('1top')||!token)return json({error:'Connection ticket required'},401);
   const t=await env.DB.prepare('DELETE FROM tickets WHERE hash=? AND expires_at>? RETURNING user_id,auth_expires,mobile_hash').bind(await hash(token),now()).first<{user_id:string;auth_expires:number;mobile_hash:string|null}>();
   if(!t)return json({error:'Connection ticket expired'},401);
   if(t.mobile_hash)await mobileIdentity(env.DB,t.mobile_hash,now());
   const access=await requireHostedAccess(env.DB,t.user_id);
   const target=new URL('https://hub/ws');target.searchParams.set('role','browser');target.searchParams.set('id',crypto.randomUUID());target.searchParams.set('expires',String(accessDeadline(access,Math.min(Date.now()+30*60000,t.auth_expires))));
   if(t.mobile_hash)target.searchParams.set('mobile',t.mobile_hash);
   return hub(env,t.user_id).fetch(new Request(target,{headers:{Upgrade:'websocket'}}));
 }
 if(path==='/api/devices'&&req.method==='GET'){
   const u=await approvedUser(req,env);const r=await env.DB.prepare('SELECT id,name,platform,created_at,allow_control FROM devices WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at').bind(u.id).all();return json({devices:r.results,account:{role:u.access.kind==='operator'?'admin':'member',plan:u.access.kind==='trial'?'trial':'pro',grant:u.access.kind,max_devices:u.access.max_devices,expires_at:u.access.expires_at}});
 }
 if(path==='/api/devices/revoke'&&req.method==='POST'){
   const u=await user(req,env),data=await body(req);
   const d=await env.DB.prepare('UPDATE devices SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL RETURNING id').bind(now(),data.device_id,u.id).first();
   if(!d)return json({error:'Device not found'},404);
   return hub(env,u.id).fetch(new Request('https://hub/revoke',{method:'POST',body:JSON.stringify({id:data.device_id})}));
 }
 if(['/api/action','/api/accounts/alias'].includes(path)&&req.method==='POST'){
   const u=await approvedUser(req,env);
   if(!await limit(env.DB,'action:'+u.id,30))return json({error:'Action limit reached. Check your devices before retrying.'},429);
   const cmd=path==='/api/accounts/alias'?accountAlias(await body(req,4096)):action(await body(req,2200000));
   const d=await env.DB.prepare('SELECT id FROM devices WHERE id=? AND user_id=? AND revoked_at IS NULL AND allow_control=1').bind(cmd.device_id,u.id).first();
   if(!d)return json({error:'Device not found or control is disabled'},404);
   return hub(env,u.id).fetch(new Request(path==='/api/accounts/alias'?'https://hub/accounts/alias':'https://hub/action',{method:'POST',body:JSON.stringify(cmd)}));
 }
 return json({error:'Not found'},404);
}
export default {
 async fetch(req:Request,env:Env):Promise<Response>{
   const origin=req.headers.get('Origin'),allowed=origin&&env.WEB_ORIGINS.split(',').includes(origin);
   if(origin&&!allowed)return json({error:'Origin not allowed'},403);
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin||env.WEB_URL,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});
   let response:Response;
   try{response=await handle(req,env);}catch(e){response=e instanceof AccessDenied?json({error:e.message,code:e.code},e.status):json({error:e instanceof SyntaxError?'Invalid JSON':'Request rejected. Sign in again or refresh the page.'},400);}
   if(response.status===101)return response;
   const headers=new Headers(response.headers);if(allowed){headers.set('Access-Control-Allow-Origin',origin!);headers.set('Vary','Origin');}headers.set('Cache-Control','no-store');
   return new Response(response.body,{status:response.status,headers});
 },
 async scheduled(_event:ScheduledEvent,env:Env){await env.DB.batch([env.DB.prepare('DELETE FROM pairings WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM tickets WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM request_limits WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM mobile_sessions WHERE expires_at<?').bind(now())]);}
};
