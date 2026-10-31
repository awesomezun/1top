// The numbers of the demo world (demo-world.js) at a moment: each computer's minutes split among its
// sessions, the sessions' periods and totals, and each account's limits over every computer it works on.
// The web demo relay and the desktop demo collector both use this; the phones carry the same steps
// (mobile/src/demo-model.ts, ios/OneTop/Model/DemoData.swift), held equal by the parity tests.
// anchor is when the demo began: sessions stopped before it stay stopped and limits reset relative to it.
import {usage,vector} from './demo-usage.js';
import {WORLD} from './demo-world.js';

export const DAY=86400,WEEK=7*DAY,HISTORY_DAYS=90;
// The shown sessions began this long before the demo; earlier sessions closed then.
export const STARTED=30*3600;
// Enough minutes for any weekly window (a window begins at most 7 days before its reset).
export const WEEK_SPAN=8*1440+15;

/** A computer's streams: its shown sessions in world order, their subagents, then its earlier sessions.
 *  controls (the web demo only): pauses and ends from the page stop a session then. */
export function streams(c,anchor,controls=new Map()){
 const out=[];
 WORLD.sessions.forEach(([computer,id,kind,project,model,status,account,weight],i)=>{
  if(computer!==c)return;
  const control=controls.get(id);
  const stop=control?.removed||control?.status==='paused'?control.at:control?.status==='working'?Infinity:
   status==='waiting'?anchor-(3+i)*60:status==='paused'?anchor-12*60:status==='idle'?anchor-(40+i*31)*60:Infinity;
  out.push({id,kind,project,model,account,weight,status,start:anchor-STARTED,stop,row:i});
 });
 for(const [lead,name,share,status] of WORLD.children){const parent=out.find(s=>s.id===lead);if(!parent)continue;
  out.push({...parent,id:lead+'-'+name,weight:parent.weight*share,status,stop:status==='working'?parent.stop:Math.min(parent.stop,anchor-25*60),child:{lead,name,status}});}
 WORLD.earlier.forEach(([computer,kind,account,model,project,weight],i)=>{
  if(computer===c)out.push({id:'earlier-'+i,kind,account,model,project,weight,start:anchor-HISTORY_DAYS*DAY,stop:anchor-STARTED,earlier:true});});
 return out;
}

/** A computer's minutes from span minutes before now, with sums over any stretch: sum(j, from, to). */
export function machine(c,now,anchor,{span=WEEK_SPAN,controls}={}){
 const computer=WORLD.computers[c],list=streams(c,anchor,controls);
 const u=usage(computer.seed,computer.scale,list,now,anchor,WORLD.rest,computer.duty,true,span),n=u.minutes[0].length;
 const cum=u.minutes.map(row=>{const s=new Float64Array(n+1);for(let i=0;i<n;i++)s[i+1]=s[i]+row[i];return s;});
 // Stretches start on whole minutes, except within the last minute: there the minute before the current one
 // counts by its share inside the stretch, so a sliding last minute moves every few seconds as the
 // collector's does. A stretch reaching now takes all of the current minute, which is still being written.
 // On whole minutes every sum is the minute sum it was, so the phones' copies agree at their check moment.
 const current=now/60-u.first;
 const at=t=>{const x=t/60-u.first;return x>=current||x>=n?n:x>=current-1?Math.max(0,x):Math.min(n,Math.max(0,Math.ceil(x)));};
 const cut=(j,x)=>{const i=Math.floor(x);return i>=n?cum[j][n]:cum[j][i]+(x-i)*(cum[j][i+1]-cum[j][i]);};
 const sum=(j,from,to=Infinity)=>{const a=at(from),b=to===Infinity?n:at(to);return b>a?cut(j,b)-cut(j,a):0;};
 return {c,computer,list,u,n,sum};
}

/** Every computer at now: the first with span minutes (the desktop keeps a long history), the rest a week. */
export function machines(now,anchor,{span=WEEK_SPAN,first=span,controls}={}){
 return WORLD.computers.map((_,c)=>machine(c,now,anchor,{span:c===0?first:span,controls}));
}

/** A session's numbers: tokens over each period, its recent rate and its total since a day before the demo.
 *  A subagent's total starts where its lead's does, as the desktop demo collector counts it. */
export function sessionNumbers(m,j,now,anchor,keys){
 const s=m.list[j],base=s.child?m.list.find(p=>p.id===s.child.lead).weight:s.weight;
 return {windows:Object.fromEntries(keys.map(([key,seconds])=>[key,vector(m.sum(j,now-seconds))])),rate:Math.round(m.sum(j,now-600)/600),
  tokens:vector(base*5e7+m.sum(j,anchor-DAY))};
}

/** Each account's limits over every computer it works on. Providers report limits in whole percent. */
export function accounts(all,now,anchor){
 const used=(key,from,to=Infinity)=>all.reduce((n,m)=>n+m.list.reduce((k,s,j)=>k+(s.account===key?m.sum(j,from,to):0),0),0);
 return WORLD.accounts.map(a=>{
  const reset=anchor+a.reset,start=reset-WEEK,reportAt=a.stale?now-a.stale:now;
  return {...a,resetAt:reset,start,reportAt,used:(from,to)=>used(a.key,from,to),
   weekly:Math.round(used(a.key,start,reportAt)*a.per),
   five:a.five?Math.min(100,Math.round(used(a.key,anchor+a.five.reset-5*3600,reportAt)*a.per*a.five.factor)):null,
   fiveReset:a.five?anchor+a.five.reset:null};
 });
}

/** A computer's host at now: as busy as its last whole minute of tokens (the current one is partial). */
export function host(m,now){
 const {computer}=m,busy=Math.min(1,m.u.minutes.reduce((n,row)=>n+row[row.length-2],0)/(computer.scale*3)),{rx,tx}=computer.network;
 return {busy,cpu:Math.round((computer.cpu[0]+computer.cpu[1]*busy)*10)/10,used_memory:Math.round(computer.used*2**30),total_memory:computer.memory*2**30,cores:computer.cores,
  rx:Math.round(rx[0]+rx[1]*busy),tx:Math.round(tx[0]+tx[1]*busy)};
}

/** The conversation's earlier messages at now, in a language, as a computer's mailbox lists them
 *  (POST /api/mailbox): oldest first, none being answered. Other sessions have none. */
export function earlierMessages(sessionId,now,lang='ko'){
 const c=WORLD.conversation;if(sessionId!==c.session)return [];
 return c.earlier.map((m,i)=>{const created=now-m.ago,reply_at=m.replied?created+m.replied:null;
  return {id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),text:m.text[lang]??m.text.en,created,changed:reply_at??created,status:m.status,
   reply:m.reply?m.reply[lang]??m.reply.en:'',reply_at,truncated:false,attachments:(m.photos||[]).map(name=>({id:name,name,mime:'image/png',bytes:184320})),activity:null};});
}

/** What a sent message shows once the script reaches a step, at time at: its delivery, the phase the
 *  session reports and, at the end, the reply. Its own text and photos stay. */
export function scriptStep(step,lang='ko',at){
 const {reply}=WORLD.conversation.script;
 return {status:step.status,activity:step.activity?{phase:step.activity,observed_at:at}:null,...(step.status==='replied'?{reply:reply[lang]??reply.en,reply_at:at}:{})};
}

/** The controls a computer offers for a session (agent/onetop/bridge.py export_snapshot). A paused
 *  session is idle underneath; a session whose CLI sends no replies takes instructions only. */
export function capabilities(s){
 if(!s.control_key)return [];
 const orca=s.app==='Orca',tool=['Claude','GLM','Codex'].includes(s.kind),active=['working','waiting'].includes(s.status),canPause=orca&&tool,caps=['focus'];
 const state=s.status==='paused'?'idle':s.status,instruction=s.kind==='Aside'?['working','idle','interrupted'].includes(state):orca&&tool&&['idle','interrupted'].includes(state);
 const replies=!WORLD.noReplies.includes(s.id);
 if((canPause||s.kind==='Aside')&&active)caps.push('pause');
 if(canPause&&s.status==='paused')caps.push('resume');
 if(instruction)caps.push('prompt');
 if(replies&&s.tokens&&(tool||s.kind==='Aside')){caps.push('mailbox');if(instruction||orca&&tool&&['working','idle','interrupted'].includes(state)){caps.push('message');if(tool)caps.push('message_images');}}
 if(s.kind!=='Aside'&&(!orca||['idle','paused'].includes(s.status)||canPause&&active))caps.push('terminate');
 // A root session found in an Orca terminal can have that terminal renamed, as bridge.py offers.
 if(orca&&!s.parent_session_id&&s.tokens)caps.push('rename');
 return caps;
}
