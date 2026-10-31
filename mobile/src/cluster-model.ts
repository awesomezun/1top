// The cluster's readings on the phone: the numbers the desktop and web cluster read (agent/onetop/dist/cluster.js
// readings), from the relay reports the phone receives, taken the way the web dashboard's adapter takes them
// (site/src/remote-adapter.js) under the dashboard's weekly and speed rules (weekly.js, speed.js).
// mobile/test/cluster.test.mjs runs both on the same reports and compares them.
import type {Device,WindowKey} from './types';

type V4=[number,number,number,number];
type Any=any;
export const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const vector=(v:unknown):V4|null=>Array.isArray(v)&&v.length===4&&v.every(valid)?v as V4:null;
const add=(values:unknown[]):V4|null=>{const known=values.map(vector).filter((v):v is V4=>!!v);return known.length?[0,1,2,3].map(i=>known.reduce((n,v)=>n+v[i],0)) as V4:null;};
const sum4=(v:unknown)=>{const x=vector(v);return x?x[0]+x[1]+x[2]+x[3]:null;};
const number=(v:unknown)=>valid(v)?v:null;
const HOUR=3600,STALL=15*60,CONTEXT=.9,FRESH_MS=30000;
export const PERIODS:[WindowKey,number][]=[['24h',86400],['12h',43200],['5h',18000],['1h',3600],['30m',1800],['10m',600]];
export const RECONNECT=new Set(['login_required','login_expired','credential_store_unavailable','access_denied']);

// The relay reports in the shape the dashboard reads (remote-adapter.js remoteState), for the parts the cluster uses.
const isFresh=(d:Device,now:number)=>d.online!==false&&now-(d.received||0)<FRESH_MS;
const weeklyLabel=(label:string)=>['주간','Weekly','weekly','7d','7D'].includes(label)?'주간':label;
function estimate(e:Any){
 const c=e.calibration,full=c&&valid(c.seconds)&&valid(c.used_pp)&&valid(c.tokens);
 return {used_pp:e.used_pp,partial:e.partial,tokens:e.tokens,account_id:e.account_id,period_seconds:e.period_seconds,basis:c?'calibrated_token_equivalent':'',
  ...(full?{calibration:{seconds:c.seconds,used_pp:c.used_pp,tokens:c.tokens,confidence:c.confidence||'',source:c.source||'',from:c.from??null,to:c.to??null}}:{})};
}
function session(d:Device,s:Any,online:boolean){
 const status=online?s.status||'unknown':'unknown',base=({paused:'idle',resuming:'working'} as Record<string,string>)[status]||status;
 return {id:d.id+':'+s.id,device:d.id,source:s.id,kind:s.kind||'unknown',model:s.model||'',effort:s.effort||null,project:s.project||'',terminal:s.terminal||'',title:s.title||'',
  status:base,display_status:status,context_usage:s.context_usage||null,last_usage:number(s.last_usage),tokens:vector(s.tokens),
  usage:{rate:valid(s.rate)?s.rate:null,windows:s.windows||{},weekly_account:s.weekly_account||null,
   weekly_estimate:Object.fromEntries(Object.entries(s.weekly_estimate||{}).map(([k,e])=>[k,estimate(e)])) as Any,last_minute:vector(s.usage?.last_minute)},
  is_subagent:!!s.parent_session_id,root_session_id:d.id+':'+(s.root_session_id||s.id),children_working:0,children_count:0};
}
export type ClusterSession=ReturnType<typeof session>;
// One row per session tree (remote-adapter.js group): children add their usage once.
function group(sessions:ClusterSession[]):ClusterSession[]{
 const byId=new Map(sessions.map(s=>[s.id,s])),members=new Map<string,ClusterSession[]>();
 for(const s of sessions){const root=byId.has(s.root_session_id)?s.root_session_id:s.id;if(!members.has(root))members.set(root,[]);members.get(root)!.push(s);}
 return [...members].map(([rootId,rows])=>{
  const root=byId.get(rootId)!,children=rows.filter(s=>s.id!==rootId);
  const row={...root,usage:{...root.usage},children_count:children.length,children_working:children.filter(s=>(s.display_status||s.status)==='working').length};
  if(!children.length)return row;
  row.tokens=add(rows.map(s=>s.tokens));
  const rates=rows.map(s=>s.usage.rate).filter(valid);row.usage.rate=rates.length?rates.reduce((a,b)=>a+b,0):null;
  const keys=new Set(rows.flatMap(s=>Object.keys(s.usage.windows||{})));
  row.usage.windows=Object.fromEntries([...keys].map(k=>[k,add(rows.map(s=>s.usage.windows?.[k]))]));
  const accounts=new Set(rows.map(s=>s.usage.weekly_account)),account=accounts.size===1?[...accounts][0]:null;row.usage.weekly_account=account;row.usage.weekly_estimate={};
  // A tree's estimate adds its members' only when every member with usage has one on the same account and reference.
  for(const key of account?keys:[]){
   const estimates:Any[]=[];let complete=true;
   for(const s of rows){const v=vector(s.usage.windows?.[key]);if(!v){complete=false;break;}if(!v.some(n=>n>0))continue;
    const e=s.usage.weekly_estimate?.[key];if(!e||e.account_id!==account||e.basis!=='calibrated_token_equivalent'||!valid(e.used_pp)||!valid(e.tokens)){complete=false;break;}estimates.push(e);}
   if(complete&&estimates.length&&estimates.every(e=>JSON.stringify(e.calibration)===JSON.stringify(estimates[0].calibration)))
    row.usage.weekly_estimate[key]={...estimates[0],used_pp:Math.round(estimates.reduce((n,e)=>n+e.used_pp,0)*1e4)/1e4,tokens:estimates.reduce((n,e)=>n+e.tokens,0),partial:estimates.some(e=>e.partial)};
  }
  return row;
 });
}
// Token events from each computer's bins: the finest first, coarser ones only before them.
function events(devices:Device[]){
 const out:{t:number;kind:string;n:number}[]=[];
 for(const d of devices){
  const flows=Object.values(d.snapshot.flow||{}).filter((f:Any)=>Array.isArray(f?.bins)).sort((a:Any,b:Any)=>a.step-b.step||a.start-b.start) as Any[];
  let covered=Infinity;
  for(const f of flows){
   f.bins.forEach((bin:Any,i:number)=>{const t=f.start+i*f.step;if(t+f.step>covered)return;for(const [kind,n] of Object.entries(bin||{}))if(valid(n)&&n>0)out.push({t,kind,n});});
   covered=Math.min(covered,f.start);
  }
 }
 return out.sort((a,b)=>a.t-b.t);
}
function quotas(devices:Device[]){
 const byId=new Map<string,Any>();
 for(const d of devices)for(const q of d.snapshot.account_quotas||[]){const old=byId.get(q.id);if(!old||(q.updated||0)>(old.updated||0))byId.set(q.id,q);}
 return [...byId.values()].map(q=>({...q,alias:q.alias||null,windows:(q.windows||[]).map((w:Any)=>({...w,label:weeklyLabel(w.label)}))}));
}
export type ClusterState=ReturnType<typeof clusterState>;
/** The computers in view as one report, at now (milliseconds). */
export function clusterState(devices:Device[],now:number){
 const live=devices.filter(d=>isFresh(d,now)),sessions=devices.flatMap(d=>(d.snapshot.sessions||[]).map(s=>session(d,s,isFresh(d,now))));
 const account_quotas=quotas(devices),updated=live.length?Math.max(...live.map(d=>d.received))/1000:Math.max(0,...devices.map(d=>d.received||0))/1000;
 const windows=PERIODS.map(([key,seconds])=>{const reports=devices.map(d=>(d.snapshot.periods||[]).find(p=>p.key===key)).filter((p):p is NonNullable<typeof p>=>!!p);
  return {key,seconds,tokens:reports.length?add(reports.map(p=>p.tokens)):null,partial:reports.length<devices.length||reports.some(p=>p.partial)};});
 return {updated,error:null as string|null,sessions,root_sessions:group(sessions),events:events(live),chart_range:null as {start:number}|null,
  period_usage:{computers:live.length,expected:devices.length,known_kinds:[...new Set(sessions.filter(s=>s.tokens).map(s=>s.kind))].sort(),windows},
  account_quotas,
  weekly_usage:{accounts:account_quotas.map(q=>({id:q.id,kind:q.kind,periods:q.weekly||{},usage_points:q.usage_points||[],
   ...(q.calibration&&valid(q.calibration.seconds)&&valid(q.calibration.used_pp)&&valid(q.calibration.tokens)?{calibration:q.calibration}:{})}))},
  // Each computer's own load, for the temperature gauge.
  system:{computers:(live.length?live:devices).map(d=>{const h:Any=d.snapshot.host||{};return {id:d.id,name:d.name,cpu:valid(h.cpu)?h.cpu:null,
   memory:valid(h.used_memory)&&valid(h.total_memory)&&h.total_memory>0?Math.round(h.used_memory/h.total_memory*1000)/10:null};})}};
}

// The dashboard's weekly rules (weekly.js).
export const weekly=(q:Any)=>q?.windows?.find((w:Any)=>w.label==='주간');
// Partial periods use the observed duration, never the selected window length.
export function accountBurn(period:Any,quota:Any){
 if(!quota||quota.stale!==false||!valid(period?.used_pp)||!valid(period?.observed_seconds)||period.observed_seconds<120)return null;
 const rate=period.used_pp/period.observed_seconds*3600;return valid(rate)?rate:null;
}
function historicalCalibration(estimate:Any,quota:Any,now:number){
 const c=estimate?.calibration,reset=weekly(quota)?.reset;
 return [true,false].includes(quota?.stale)&&quota.kind==='Claude'&&c?.kind==='Claude'&&c.source==='historical_provider_calibration'&&['claude_statusline','historical_provider_report'].includes(c.report_source)&&valid(now)&&valid(c.to)&&c.to>0&&c.to<=now&&valid(c.reset)&&c.reset>now&&valid(reset)&&Math.abs(reset-c.reset)<=60&&valid(c.valid_until)&&c.valid_until>now&&c.valid_until<=Math.min(c.reset,c.to+86400);
}
export function sessionBurn(estimate:Any,tokensPerSecond:unknown,quota:Any,now:number){
 // A measured zero token rate is zero burn even before a positive quota step.
 if(tokensPerSecond===0)return 0;
 const c=estimate?.calibration;
 if(!quota||(c?.source==='historical_provider_calibration'?!historicalCalibration(estimate,quota,now):quota.stale!==false)||estimate?.account_id!==quota.id||estimate?.basis!=='calibrated_token_equivalent'||!valid(tokensPerSecond)||!valid(c?.tokens)||c.tokens<=0||!valid(c?.used_pp)||c.used_pp<=0||!valid(c?.seconds)||c.seconds<120)return null;
 const rate=tokensPerSecond*(c.used_pp/c.tokens)*3600;return valid(rate)?rate:null;
}
// The cumulative increase within a stretch; intervals that cross its edges or overlap are left out.
function increaseTrend(account:Any,start:number,end:number){
 const result={increase:0,hasData:false};
 if(!valid(start)||!valid(end)||end<=start)return result;
 let intervals:Any[];const complete=Array.isArray(account?.increase_intervals);
 if(complete)intervals=account.increase_intervals.filter(Array.isArray).map((row:Any[])=>row.slice(0,4));
 else if(Array.isArray(account?.flow))intervals=account.flow.filter(Array.isArray).map((row:Any[])=>row.slice(0,3));
 else{const points=(Array.isArray(account?.history)?account.history:[]).filter((p:Any)=>Array.isArray(p)&&valid(p[0])).slice().sort((a:Any,b:Any)=>a[0]-b[0]);
  intervals=[];for(let i=1;i<points.length;i++){const before=points[i-1],after=points[i];if(!valid(before[1])||before[1]>100||!valid(after[1])||after[1]>100)continue;intervals.push([before[0],after[0],after[1]-before[1]]);}}
 intervals=intervals.filter(([a,b,d])=>valid(a)&&valid(b)&&valid(d)&&b>a&&(complete||b-a<=300)&&a>=start&&b<=end).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 let lastEnd:number|null=null,segments=0;
 for(const [a,b,delta] of intervals){if(lastEnd!==null&&a<lastEnd)continue;const next=result.increase+delta;if(!valid(next))continue;segments++;result.increase=next;lastEnd=b;}
 result.hasData=segments>0;return result;
}
// The dashboard's speed rules (speed.js): the period's token total over its length.
function measure(state:ClusterState,key:WindowKey,now:number){
 const w=state.period_usage.windows.find(p=>p.key===key),local=sum4(w?.tokens),rows:{tokens:number;seconds:number;computers:number}[]=[];
 const known=local!==null&&(local>0||state.period_usage.known_kinds.length>0),expected=state.period_usage.expected??1;
 if(known&&now-state.updated<=20&&!state.error)rows.push({tokens:local!,seconds:w!.seconds,computers:state.period_usage.computers??1});
 const tokens=rows.reduce((n,r)=>n+r.tokens,0),seconds=w?.seconds??0;
 return {tokens:rows.length?tokens:null,rate:rows.length&&seconds>0?tokens/seconds:null,computers:rows.reduce((n,r)=>n+r.computers,0),expected};
}
export function niceMax(value:number){if(!valid(value)||value===0)return 1;const power=10**Math.floor(Math.log10(value));return [1,2,5,10].map(n=>n*power).find(n=>n>=value)||10*power;}
const baseMax=(seconds:number|undefined)=>!valid(seconds)||seconds<=3600?2e8:seconds<=604800?1e8:5e7;
const scaleMax=(rate:number|null,seconds:number|undefined)=>Math.max(baseMax(seconds),valid(rate)?niceMax(rate):0);

// Marks on a 1-2-2.5-5 step so a dial reads four or five numbers.
export function marks(max:number){
 const p=10**Math.floor(Math.log10(max)),major=[5,2.5,2,1,.5,.25,.2,.1].map(m=>m*p).find(s=>max/s>=4-1e-9)||p/10;
 return {max,major,minor:major/5};
}
const local=(label:string)=>{const s=String(label||'');return s.includes('@')?s.split('@')[0]:s;};
type Account={id:string;kind:string;label:string;plan:string|null;alias:string|null;who:string;pct:number|null;left:number|null;reset:number|null;current:boolean;reconnect:boolean;burn:number|null;added:number|null;range?:{state:'idle'|'enough'|'empty';at:number|null;early:boolean}|null};
// When an account's weekly limit runs out at its current burn, and whether that comes before the reset.
function range(a:Account,now:number){
 if(a.left===null||!valid(a.burn))return null;
 if(a.burn===0)return {state:'idle' as const,at:null,early:false};
 const at=now+a.left/a.burn*HOUR;
 return a.reset&&at>=a.reset?{state:'enough' as const,at,early:false}:{state:'empty' as const,at,early:!!a.reset};
}
// The steady %/h that spends what is left exactly by the reset.
const cruise=(a:Account|undefined,now:number)=>a&&a.left!==null&&a.reset&&a.reset>now?a.left/((a.reset-now)/HOUR):null;
const contextFull=(s:ClusterSession)=>{const c=s.context_usage;return valid(c?.input_tokens)&&valid(c?.capacity)&&c.capacity>0&&c.input_tokens/c.capacity>=CONTEXT;};
const stalled=(s:ClusterSession,state:string,now:number)=>state==='working'&&valid(s.last_usage)&&s.last_usage>0&&now-s.last_usage>STALL;
export const display=(s:ClusterSession)=>(s.children_working||0)>0?'working':s.display_status||s.status;
function trip(state:ClusterState,start:number|null,now:number){
 if(!valid(start)||start>now)return null;
 const from=state.chart_range?.start??((valid(state.updated)?state.updated:now)-86400),inRange=start>=from;
 const tokens=inRange?state.events.reduce((n,e)=>e.t>=start&&e.t<=now&&valid(e.n)?n+e.n:n,0):null,hours=(now-start)/HOUR;
 const accounts=state.weekly_usage.accounts.map(a=>{const r=increaseTrend(a,start,now);return {id:a.id,used:r.hasData&&valid(r.increase)?r.increase:null};});
 return {start,tokens,rate:tokens===null||hours<=0?null:tokens/hours,inRange,accounts};
}
function heat(state:ClusterState){
 const computers=state.system.computers.filter(c=>c.cpu!==null||c.memory!==null).map(c=>({...c,load:Math.min(100,Math.max(c.cpu??0,c.memory??0))}));
 const hottest=computers.slice().sort((a,b)=>b.load-a.load)[0]||null;
 return {value:hottest?hottest.load:null,hottest,computers};
}
// The last minute's tokens per hour, in all and by tool, from each top-level session's sliding last minute.
function instant(state:ClusterState){
 const rows=state.root_sessions.length?state.root_sessions:state.sessions.filter(s=>!s.is_subagent),by:Record<string,number>={};let all:number|null=null;
 for(const s of rows){const v=s.usage.last_minute;if(!v)continue;const n=v.reduce((a,b)=>a+(valid(b)?b:0),0)*HOUR/60;all=(all||0)+n;by[s.kind]=(by[s.kind]||0)+n;}
 return {rate:all,by};
}
export type Pick={type:'session'|'account';id:string}|null;
export type Readings=ReturnType<typeof readings>;
const KINDS=['Claude','Codex','GLM','Antigravity','Aside'],rank=(k:string)=>KINDS.includes(k)?KINDS.indexOf(k):KINDS.length;
/** The cluster's readings (cluster.js readings): period, now in seconds, the subject picked, the trip's start. */
export function readings(state:ClusterState,o:{period:WindowKey;now:number;pick?:Pick;trip?:number|null;tachMax?:number|null;sessions?:ClusterSession[]}){
 const now=o.now,w=state.period_usage.windows.find(x=>x.key===o.period),m=measure(state,o.period,now),rate=m.rate===null?null:m.rate*3600;
 // Between readings the window's total runs on at the last minute's rate; the next reading sets it true.
 const live=instant(state),climb=valid(live.rate)?live.rate/HOUR:0;
 const tach={rate,max:o.tachMax||scaleMax(rate,w?.seconds),tokens:m.tokens,computers:m.computers,expected:m.expected,instant:live.rate,byKind:live.by,climb};
 const accounts:Account[]=state.account_quotas.map(q=>{
  const p=state.weekly_usage.accounts.find(a=>a.id===q.id)?.periods?.[o.period],week=weekly(q),pct=valid(week?.pct)?week.pct:null;
  return {id:q.id,kind:q.kind,label:q.account_label,plan:q.plan||null,alias:q.alias||null,who:local(q.account_label),pct,left:pct===null?null:Math.max(0,100-pct),
   reset:valid(week?.reset)?week.reset:null,current:pct!==null&&q.stale===false,reconnect:RECONNECT.has(q.status),burn:accountBurn(p,q),added:valid(p?.used_pp)?p.used_pp:null};
 });
 for(const a of accounts)a.range=range(a,now);
 const tokens=(s:ClusterSession)=>{const v=s.usage.windows?.[o.period];return Array.isArray(v)?v.reduce((a:number,b:number)=>a+(valid(b)?b:0),0):0;};
 const burn=(s:ClusterSession,period:string=o.period)=>{
  let e:Any=s.usage.weekly_estimate?.[period];const id=e?.account_id||s.usage.weekly_account,q=state.account_quotas.find(q=>q.id===id);
  if(!e&&q){const c=(state.weekly_usage.accounts.find(a=>a.id===q.id) as Any)?.calibration;if(c)e={account_id:q.id,basis:'calibrated_token_equivalent',calibration:c};}
  return s.tokens==null?null:sessionBurn(e,s.usage.rate,q,now);
 };
 const list=(o.sessions||state.root_sessions).map(s=>({s,state:display(s),tokens:tokens(s)}));
 const row=(r:typeof list[number])=>({id:r.s.id,kind:r.s.kind,state:r.state,tokens:r.tokens,estimate:valid(r.s.usage.weekly_estimate?.[o.period]?.used_pp)?r.s.usage.weekly_estimate[o.period].used_pp as number:null,
  burn:burn(r.s),account:(r.s.usage.weekly_estimate?.[o.period]?.account_id||r.s.usage.weekly_account||null) as string|null,session:r.s});
 // Working sessions first, then the rest that used tokens in the period, each by tokens; six fit the window.
 const order=list.filter(r=>r.state==='working'||r.tokens>0).sort((a,b)=>Number(b.state==='working')-Number(a.state==='working')||b.tokens-a.tokens);
 // A picked session stays in the window in place of the last row.
 const held=o.pick?.type==='session'?list.find(x=>x.s.id===o.pick!.id):null,shown=order.slice(0,6);
 if(held&&!shown.includes(held))shown.splice(Math.min(5,shown.length),1,held);
 const rows=shown.map(row);
 // The speedometer reads one subject and never adds rates across accounts: the session or account picked,
 // else the account burning fastest. Its second needle reads the same subject over the last ten minutes.
 type Subject={type:'session'|'account';id:string;kind:string;value:number|null;account:string|null;session?:ClusterSession;recent:number|null};
 let subject:Subject|null=null;const pick=o.pick,RECENT='10m';
 const recentOf=(a:Account)=>{const q=state.account_quotas.find(q=>q.id===a.id),p=state.weekly_usage.accounts.find(x=>x.id===a.id)?.periods?.[RECENT];return p?accountBurn(p,q):null;};
 if(pick?.type==='session'){const l=list.find(x=>x.s.id===pick.id);if(l){const r=row(l);subject={type:'session',id:r.id,kind:r.kind,value:r.burn,account:r.account,session:r.session,recent:burn(l.s,RECENT)};}}
 else if(pick?.type==='account'){const a=accounts.find(x=>x.id===pick.id);if(a)subject={type:'account',id:a.id,kind:a.kind,value:a.burn,account:a.id,recent:recentOf(a)};}
 const picked=!!subject;
 if(!subject){const a=accounts.filter(a=>valid(a.burn)).sort((a,b)=>b.burn!-a.burn!)[0];if(a)subject={type:'account',id:a.id,kind:a.kind,value:a.burn,account:a.id,recent:recentOf(a)};}
 const value=valid(subject?.value)?subject!.value:null,target=cruise(accounts.find(a=>a.id===subject?.account),now),recent=o.period!==RECENT&&valid(subject?.recent)?subject!.recent:null;
 const speed={value,recent,cruise:target,max:Math.max(2,niceMax(Math.max(value||0,(target||0)*1.6,recent||0))),subject,picked,account:subject?.type==='account'?subject.id:null,session:subject?.type==='session'?subject.id:null};
 // Tell-tales light only for what is there.
 const working:Record<string,number>={};for(const r of list)if(r.state==='working')working[r.s.kind]=(working[r.s.kind]||0)+1;
 const tells={kinds:Object.keys(working).sort((a,b)=>rank(a)-rank(b)||(a<b?-1:1)).map(k=>({kind:k,working:working[k]})),waiting:list.filter(r=>r.state==='waiting').map(r=>r.s.id),
  reconnect:accounts.filter(a=>a.reconnect).map(a=>a.id),fresh:!state.error&&valid(state.updated)&&now-state.updated<=20,
  empty:accounts.filter(a=>a.range?.early).map(a=>a.id),context:list.filter(r=>contextFull(r.s)).map(r=>r.s.id),stalled:list.filter(r=>stalled(r.s,r.state,now)).map(r=>r.s.id)};
 return {period:o.period,tach,speed,accounts,sessions:rows,working:list.filter(r=>r.state==='working').length,tells,heat:heat(state),trip:trip(state,o.trip??null,now)};
}

// Figures as the desktop cluster writes them.
export const reading=(v:number|null|undefined)=>!valid(v)?'—':v>=100?String(Math.round(v)):v>=10?v.toFixed(1):v.toFixed(2);
export const scaleNumber=(v:number)=>String(+v.toFixed(v<1?2:1));
/** 108.20M, 7.5k, 12: the dashboard's token figure (app.js fmt). */
export const fmt=(n:number|null|undefined,locale='ko-KR')=>n==null||!Number.isFinite(n)?'—':n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':Number(n.toFixed(1)).toLocaleString(locale);
/** 12.3, <0.1 (weekly.js number). */
export const pctNumber=(n:number|null|undefined)=>!valid(n)?'—':n>0&&n<.1?'<0.1':Number(n.toFixed(1)).toLocaleString('ko-KR');
