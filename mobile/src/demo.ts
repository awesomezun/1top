import type {Device,Flow,Quota,Session,Vector,WindowKey} from './types';
import type {Mail} from './thread';
import {bins,vector} from './demo-usage';
import {WORLD} from './demo-world';
import {machines,accounts,sessionNumbers,host,earlierMessages,type Machine} from './demo-model';
import type {Lang} from './i18n';
import {holdDemo,heldDemo} from './clock';
type T=(en:string,ko:string)=>string;

// The demo world every surface shows (site/src/demo-world.js, copied to demo-world.ts): the web demo, the
// desktop demo collector and the iPhone show these computers, sessions and accounts with the same numbers.
// Names are the world's own and read the same in every language.
const PERIODS:[WindowKey,number][]=[['10m',600],['30m',1800],['1h',3600],['5h',18000],['12h',43200],['24h',86400]];
/** When this demo began: the hours around it never rest, and sessions stopped before it stay stopped. */
let anchor=Date.now()/1000;
/** QA and filming (onetop://?qaDemoNow=<unix seconds>): hold the demo at one moment, the same moment the
 *  web page (/app?demo&demoNow=…), the desktop demo collector and the iPhone (-qaDemoNow) take (clock.ts). */
export function setDemoNow(seconds:number|null){holdDemo(seconds);anchor=heldDemo()??Date.now()/1000;}
export const demoClock=()=>heldDemo()??Date.now()/1000;
const total=(v:number[])=>v.reduce((a,b)=>a+b,0);
// The measured reference a collector reports with an estimate, as the web demo relay gives it (remote-demo.js).
const calibration=(per:number,now:number)=>({seconds:3600,used_pp:10,tokens:Math.round(10/per),pp_per_token:per,confidence:'limited',from:now-7200,to:now-3600,valid_until:now+86400,source:''});
// The last request's share of the context window; a world session may say it nearly filled it.
const context=(kind:string,share:number|undefined,input:number)=>{const capacity=kind==='Codex'?400000:kind==='Claude'?1000000:null;return {input_tokens:capacity&&share?Math.round(capacity*share):input,capacity};};

export function demoDevices(_t:T=(en)=>en,now=demoClock(),start=anchor):Device[]{
 const all=machines(WORLD,now,start),limits=accounts(WORLD,all,now,start),limitOf=(key:string|null)=>limits.find(a=>a.key===key);
 return all.map((m:Machine)=>{
  const computer=WORLD.computers[m.c],rows=WORLD.sessions.filter(r=>r[0]===m.c);
  const sessions=m.list.flatMap((s,j):Session[]=>{
   if(s.earlier)return [];
   const row=rows.find(r=>r[1]===(s.child?.lead||s.id))!,[,,kind,project,model,,,weight,app,terminal]=row,i=WORLD.sessions.indexOf(row);
   const status=s.child?s.child.status:row[5],n=weight>0?sessionNumbers(m,j,now,start,PERIODS):null,a=limitOf(s.account);
   const windows=(n?.windows||{}) as Partial<Record<WindowKey,Vector>>;
   return [{id:s.id,control_key:s.child?'':'demo-'+i,kind,app,terminal:s.child?'':terminal,project,title:project+' · '+kind,model:model||'',status,
    tokens:n?.tokens||null,rate:n?status==='working'?n.rate:0:null,windows,
    cpu:s.child?null:status==='working'?Math.round((1.5+Math.min(30,m.u.minutes[j][m.u.minutes[j].length-2]/4e4)+i%5*.7)*10)/10:status==='unknown'?.6:.3,rss:s.child?null:(160+i*24)*2**20,
    // The context in use, as the web demo shows it.
    context_usage:n?{basis:'last_request_input',...context(kind,WORLD.context?.[s.child?'':s.id],64000+i*6000),parts:[12000+i*2000,48000+i*4000,4000],observed_at:now,model:model||''}:null,
    // The sliding last minutes and the last minute with usage, as a 4.3 companion reports them (remote-demo-parity.js).
    usage:{last_minute:vector(m.sum(j,now-60)),last_five_minutes:vector(m.sum(j,now-300))},last_usage:lastUse(m,j,now)??(n?now-1800:null),
    capabilities:s.child?[]:WORLD.caps[s.id],root_session_id:s.child?s.child.lead:s.id,parent_session_id:s.child?s.child.lead:null,
    weekly_account:a&&n?a.id:null,weekly_estimate:a&&n?Object.fromEntries(PERIODS.map(([k])=>[k,{used_pp:Math.round(total(windows[k]!)*a.per*1e4)/1e4,partial:false,account_id:a.id,period_seconds:PERIODS.find(p=>p[0]===k)![1],tokens:total(windows[k]!),calibration:calibration(a.per,now)}])):null}];
  });
  const used=new Set(rows.map(r=>r[6]).filter(Boolean));
  const quotas=limits.filter(a=>used.has(a.key)).map((a):Quota=>{const points:number[][]=[];for(let t=a.start;t<=a.reportAt;t+=600)points.push([t,Math.round(a.used(a.start,t)*a.per),a.resetAt]);
   // The relay names an account by its tool and the end of its id; providers report limits in whole percent.
   return {id:a.id,kind:a.kind,account_label:a.kind+' · '+a.id.slice(-6),plan:a.plan,updated:a.reportAt,stale:!!a.stale,status:a.status??null,...(a.alias?{alias:a.alias}:{}),calibration:calibration(a.per,now),
    windows:[...(a.five!==null?[{key:'5h',label:'5H',pct:a.five,reset:a.fiveReset!}]:[]),{key:'7d',label:'주간',pct:a.weekly,reset:a.resetAt}],
    weekly:Object.fromEntries(PERIODS.map(([k,seconds])=>[k,{used_pp:Math.round(a.used(now-seconds)*a.per*1e4)/1e4,observed_seconds:seconds,partial:false}])),usage_points:points};});
  const kinds=m.list.map(s=>s.weight>0?s.kind:null);
  const flow=Object.fromEntries(PERIODS.map(([k,seconds])=>{const step=seconds<=3600?60:seconds<=18000?300:900;return [k,{step,...bins(m.u,kinds,now,seconds,step),reported:true} as Flow];}));
  const ops=WORLD.operations[m.c];
  // The computer's own period totals, the sum of its sessions' as the web demo relay reports them.
  const periods=PERIODS.map(([key,seconds])=>({key,label:key,tokens:[0,1,2,3].map(k=>sessions.reduce((n,s)=>n+(s.windows?.[key]?.[k]||0),0)),partial:false,observed_seconds:seconds}));
  return {id:computer.id,name:computer.name,platform:computer.platform,online:true,received:now*1000,...(computer.control?{}:{allow_control:false}),
   snapshot:{version:'4.0.0',updated:now,sessions,periods,host:host(WORLD,m),
    account_quotas:quotas,flow,operations:{installed_skills:ops.installed_skills,observed_events:ops.observed_events,goals:ops.goals.map(g=>({runtime:g.runtime,status:g.status,tokens_used:g.tokens_used,session_connected:g.session_connected}))}}};
 });
}

/** The start of a session's last minute with usage within the hour. */
function lastUse(m:Machine,j:number,now:number){for(let k=59;k>=0;k--){const t=Math.floor(now/60-59+k)*60;if(Math.round(m.sum(j,t,t+60))>0)return t;}return null;}

/** The conversation demo's earlier messages, as on the web and the desktop (demo-world.js): replies, a
 *  photo listed by name, one delivery not confirmed, and nothing being answered. Nothing here is sent. */
export function demoThread(sessionId:string,lang:Lang):Mail[]{
 return earlierMessages(WORLD,sessionId,demoClock(),lang).map(({changed,reply_at,...m})=>({...m,...(reply_at===null?{}:{reply_at})}));
}
