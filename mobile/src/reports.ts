// The collector's reports (report-contract v1.2.0) on the phone: this month's API value of the subscriptions and the
// week's agent hours, added up over the computers shown with each plan counted once (site/src/remote-adapter.js
// mergeReports), the figures and sentences agent/onetop/dist/reports.js draws, and the look chosen on this phone.
import * as SecureStore from 'expo-secure-store';
import {useEffect,useState} from 'react';
import type {Device,Quota,WindowKey} from './types';
import {accountBurn,valid} from './cluster-model';
import {isWeekly,periodOf} from './fleet';

type Any=any;
export type Plan={account_id:string;kind:string;plan?:string;label?:string;price:number|null;source?:string};
export type Reports={version?:number;as_of?:number;value?:{month:string;start:number;end:number;currency?:string;prices_as_of?:string;ratio?:number|null;plans?:Plan[];plan_total?:number;api_value:number;api_billed?:number;
 unpriced?:{tokens:number;models:string[]};by_kind?:{kind:string;api_value:number;plan_total:number;ratio:number|null}[];by_model?:{model:string;kind:string;api_value:number}[];months?:{month:string;api_value:number;plan_total:number}[]};
 weekly?:{start:number;end:number;since?:number;working_s:number;waiting_s:number;longest_wait?:{session_id?:string;label:string;kind:string;seconds:number}|null;previous?:{working_s:number;waiting_s:number;partial?:boolean}|null;days?:{date:string;working_s:number;waiting_s:number}[]}};

const RANK:Record<string,number>={user:0,detected:1,unknown:2};
export function mergeReports(parts:(Reports|undefined|null)[]):Reports|undefined{
 const list=parts.filter((r):r is Reports=>!!r&&typeof r==='object');if(!list.length)return undefined;
 const out:Reports={version:1,as_of:Math.max(...list.map(r=>r.as_of||0))};
 const vals=list.map(r=>r.value).filter((v):v is NonNullable<Reports['value']>=>!!v&&valid(v.api_value)&&!!v.month),month=vals.map(v=>v.month).sort().pop();
 const same=vals.filter(v=>v.month===month);
 if(same.length&&month){
  const plans=new Map<string,Plan>();for(const v of same)for(const p of v.plans||[]){const old=plans.get(p.account_id);if(!old||(RANK[p.source||'']??3)<(RANK[old.source||'']??3))plans.set(p.account_id,p);}
  const plan=[...plans.values()],plan_total=plan.reduce((n,p)=>n+(valid(p.price)?p.price:0),0),api_value=same.reduce((n,v)=>n+v.api_value,0);
  const models=new Map<string,{model:string;kind:string;api_value:number}>();for(const v of same)for(const m of v.by_model||[]){const k=m.kind+'|'+m.model,o=models.get(k)||{model:m.model,kind:m.kind,api_value:0};o.api_value+=m.api_value||0;models.set(k,o);}
  const kinds=[...new Set([...models.values()].sort((a,b)=>b.api_value-a.api_value).map(m=>m.kind))].map(kind=>{const v=[...models.values()].filter(m=>m.kind===kind).reduce((n,m)=>n+m.api_value,0),p=plan.filter(x=>x.kind===kind).reduce((n,x)=>n+(valid(x.price)?x.price:0),0);return {kind,api_value:v,plan_total:p,ratio:p?v/p:null};});
  const months=new Map<string,{month:string;api_value:number;plan_total:number}>();for(const v of same)for(const m of v.months||[]){const o=months.get(m.month)||{month:m.month,api_value:0,plan_total:0};o.api_value+=m.api_value||0;o.plan_total=Math.max(o.plan_total,m.plan_total||0);months.set(m.month,o);}
  out.value={month,start:Math.min(...same.map(v=>v.start)),end:Math.max(...same.map(v=>v.end)),prices_as_of:same.map(v=>v.prices_as_of||'').sort().pop(),plans:plan,plan_total,api_value,
   api_billed:same.reduce((n,v)=>n+(v.api_billed||0),0),unpriced:{tokens:same.reduce((n,v)=>n+(v.unpriced?.tokens||0),0),models:[...new Set(same.flatMap(v=>v.unpriced?.models||[]))]},
   by_kind:kinds,by_model:[...models.values()].sort((a,b)=>b.api_value-a.api_value),months:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month))};
 }
 const weeks=list.map(r=>r.weekly).filter((w):w is NonNullable<Reports['weekly']>=>!!w&&valid(w.start)&&valid(w.working_s)),start=Math.max(...weeks.map(w=>w.start),-Infinity),wk=weeks.filter(w=>w.start===start);
 if(wk.length){
  const days=new Map<string,{date:string;working_s:number;waiting_s:number}>();for(const w of wk)for(const d of w.days||[]){const o=days.get(d.date)||{date:d.date,working_s:0,waiting_s:0};o.working_s+=d.working_s||0;o.waiting_s+=d.waiting_s||0;days.set(d.date,o);}
  const longest=wk.map(w=>w.longest_wait).filter(Boolean).sort((a:Any,b:Any)=>b.seconds-a.seconds)[0]||null,prev=wk.map(w=>w.previous).filter(Boolean) as NonNullable<Reports['weekly']>['previous'][];
  out.weekly={start,end:Math.max(...wk.map(w=>w.end||start+604800)),since:Math.max(...wk.map(w=>w.since||start)),working_s:wk.reduce((n,w)=>n+w.working_s,0),waiting_s:wk.reduce((n,w)=>n+(w.waiting_s||0),0),longest_wait:longest,
   previous:prev.length?{working_s:prev.reduce((n,p)=>n+(p!.working_s||0),0),waiting_s:prev.reduce((n,p)=>n+(p!.waiting_s||0),0),partial:prev.some(p=>p!.partial)||prev.length<wk.length}:null,days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date))};
 }
 return out.value||out.weekly?out:undefined;
}
export const reportsOf=(devices:Device[])=>mergeReports(devices.map(d=>(d.snapshot as Any)?.reports));

// ---------- the look ----------
export const SHAPES=['trip','receipt','big','trend','strip'] as const;
export type Shape=typeof SHAPES[number];
export type Prefs={shape:Shape;share:Shape;basis:'month'|'prorated';hidden:boolean};
export const DEFAULTS:Prefs={shape:'trip',share:'trend',basis:'month',hidden:false};
export const KEY='onetop.reports.v1';
export function normalize(v:Any):Prefs{const o=v&&typeof v==='object'&&!Array.isArray(v)?v:{};
 return {shape:SHAPES.includes(o.shape)?o.shape:DEFAULTS.shape,share:SHAPES.includes(o.share)?o.share:DEFAULTS.share,basis:o.basis==='prorated'?'prorated':'month',hidden:o.hidden===true};}
let current:Prefs={...DEFAULTS},loaded=false;const listeners=new Set<(p:Prefs)=>void>();
export function setPrefs(patch:Partial<Prefs>){current=normalize({...current,...patch});listeners.forEach(f=>f(current));SecureStore.setItemAsync(KEY,JSON.stringify(current)).catch(()=>{});}
export function resetPrefs(){setPrefs(DEFAULTS);}
/** The look, read once from the phone's store; every screen using it redraws when it changes. */
export function usePrefs():Prefs{
 const [p,setP]=useState(current);
 useEffect(()=>{listeners.add(setP);if(!loaded){loaded=true;SecureStore.getItemAsync(KEY).then(raw=>{if(raw){try{current=normalize(JSON.parse(raw));listeners.forEach(f=>f(current));}catch{}}}).catch(()=>{});}return ()=>{listeners.delete(setP);};},[]);
 return p;
}
export const shapeName=(s:string,t:(en:string,ko:string)=>string)=>({receipt:t('Receipt','영수증'),big:t('Big multiple','큰 배수'),trend:t('Monthly trend','월별 추이'),strip:t('Strip','요약 띠')} as Record<string,string>)[s]||t('Trip computer','트립 컴퓨터');

// ---------- the figures ----------
export const money=(v:number|null|undefined)=>!valid(v)?'—':v>=100?'$'+Math.round(v).toLocaleString('en-US'):'$'+v.toFixed(2);
export const times=(r:number|null|undefined)=>valid(r)?(r<99.95?r.toFixed(1):String(Math.round(r))):'—';
export function figures(r:Reports|undefined,basis:Prefs['basis'],locale:string){
 const v=r?.value;if(!v||!valid(v.api_value))return null;
 const [y,m]=String(v.month||'').split('-').map(Number),first=y&&m?new Date(y,m-1,1).getTime()/1000:v.start,next=y&&m?new Date(y,m,1).getTime()/1000:null;
 const end=valid(v.end)?v.end:Date.now()/1000,share=next&&end>first?Math.min(1,(end-first)/(next-first)):1;
 // A tool with a plan whose price is unknown (a ChatGPT Pro tier, an API key) stays out of the value, the plans and the
 // multiple, so its tokens never count against too little (reports.js does the same).
 const plansAll=v.plans||[],unknownKinds=new Set(plansAll.filter(p=>!valid(p.price)).map(p=>p.kind));
 const kinds=(v.by_kind||[]).filter(k=>valid(k.api_value)).map(k=>{const known=!unknownKinds.has(k.kind)&&valid(k.plan_total)&&k.plan_total>0,p=known?(basis==='prorated'?k.plan_total*share:k.plan_total):null;return {kind:k.kind,api:k.api_value,plan:known?k.plan_total:0,ratio:p?k.api_value/p:null};});
 const counted=kinds.filter(k=>k.ratio!==null),api=counted.reduce((n,k)=>n+k.api,0),planSum=counted.reduce((n,k)=>n+k.plan,0),left=kinds.filter(k=>k.ratio===null&&k.api>0);
 const plan=planSum>0?planSum:null,cost=plan===null?null:basis==='prorated'?plan*share:plan,elapsed=end-first;
 const label=(k:string)=>{const [a,b]=k.split('-').map(Number);return a&&b?new Date(a,b-1,1).toLocaleDateString(locale,{month:'short'}):'';};
 return {label:label(v.month),first,end,share,api,plan,cost,ratio:cost?api/cost:null,saved:plan===null?null:api-plan,kinds,left:left.reduce((n,k)=>n+k.api,0),leftKinds:left.map(k=>k.kind),
  models:(v.by_model||[]).filter(x=>valid(x.api_value)&&counted.some(k=>k.kind===x.kind)).sort((a,b)=>b.api_value-a.api_value),
  months:(v.months||[]).filter(x=>valid(x.api_value)).slice(-5).map(x=>({label:label(x.month),api:x.api_value,plan:valid(x.plan_total)?x.plan_total:0})),
  proj:next&&elapsed>=86400?api/elapsed*(next-first):null,plans:plansAll.filter(p=>valid(p.price)&&!unknownKinds.has(p.kind)).length,unknown:(v.plans||[]).filter(p=>p.source==='unknown'||!valid(p.price)).length,billed:v.api_billed||0,prices:v.prices_as_of||''};
}
export type Figures=NonNullable<ReturnType<typeof figures>>;
export function week(r:Reports|undefined,locale:string){
 const w=r?.weekly;if(!w||!valid(w.working_s)||!valid(w.waiting_s))return null;
 const days=Array.from({length:7},(_,i)=>{const d=new Date((w.start+i*86400+43200)*1000),key=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),x=(w.days||[]).find(y=>y.date===key);
  return {label:d.toLocaleDateString(locale,{weekday:'short'}),work:valid(x?.working_s)?x!.working_s:null,wait:valid(x?.waiting_s)?x!.waiting_s:null};});
 return {start:w.start,work:w.working_s,wait:w.waiting_s,partial:valid(w.since)&&w.since>w.start,prev:w.previous&&valid(w.previous.working_s)?{work:w.previous.working_s,wait:w.previous.waiting_s||0}:null,
  longest:w.longest_wait&&valid(w.longest_wait.seconds)?w.longest_wait:null,days};
}
export type Week=NonNullable<ReturnType<typeof week>>;

// ---------- the forecast (cluster.js range, reports.js sentences) ----------
export function forecast(q:Quota,period:WindowKey,now:number){
 const w=q.windows.find(x=>isWeekly(x));if(!w||!valid(w.pct)||q.identity_verified===false||!isWeekly(w))return null;
 const rate=accountBurn(q.weekly?.[period],q);if(!valid(rate))return null;
 const left=Math.max(0,100-w.pct),reset=valid(w.reset)?w.reset:null;
 if(rate===0)return {state:'idle' as const,left,reset};
 const end=now+left/rate*3600;
 return reset&&end>=reset?{state:'enough' as const,left,reset,end}:{state:'empty' as const,left,reset,end,hours:left/rate,early:reset?reset-end:null};
}
export const duration=(s:number,t:(en:string,ko:string)=>string)=>{const m=Math.max(0,Math.round(s/60)),h=Math.floor(m/60),r=m%60;return h&&r?t(`${h}h ${r}m`,`${h}시간 ${r}분`):h?t(`${h}h`,`${h}시간`):t(`${r}m`,`${r}분`);};
const hoursShort=(s:number,t:(en:string,ko:string)=>string)=>s>=3600?t(`${Math.round(s/3600)}h`,`${Math.round(s/3600)}시간`):t(`${Math.max(1,Math.round(s/60))}m`,`${Math.max(1,Math.round(s/60))}분`);
export function when(at:number,now:number,locale:string,t:(en:string,ko:string)=>string){
 const d=new Date(at*1000),n=new Date(now*1000),days=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime()-new Date(n.getFullYear(),n.getMonth(),n.getDate()).getTime())/864e5);
 const day=days===0?t('Today','오늘'):days===1?t('Tomorrow','내일'):days<7?d.toLocaleDateString(locale,{weekday:'long'}):d.toLocaleDateString(locale,{month:'short',day:'numeric'});
 const time=d.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'});
 // English reads 'runs out today at 3:00 PM', as the dashboard says it.
 return locale.startsWith('en')?`${days<2?day.toLowerCase():day} at ${time}`:day+' '+time;
}
export function sentences(q:Quota,quotas:Quota[],period:WindowKey,now:number,locale:string,t:(en:string,ko:string)=>string,name:(q:Quota)=>string){
 const f=forecast(q,period,now);if(!f)return null;
 const out:{f:typeof f;warn:boolean;main:string;sub:string;alt?:string;h5?:string}={f,warn:f.state==='empty',main:'',sub:''};
 if(f.state==='empty'){const at=when(f.end,now,locale,t);out.main=t(`At this pace it runs out ${at}`,`이 속도면 ${at}에 바닥납니다`);out.sub=f.early?t(`${hoursShort(f.early,t)} before the reset`,`초기화보다 ${hoursShort(f.early,t)} 빠릅니다`):'';
  const others=quotas.filter(o=>o.kind===q.kind&&o.id!==q.id&&o.stale===false).map(o=>({o,f:forecast(o,period,now)})).filter(x=>x.f&&x.f.state!=='empty').sort((a,b)=>b.f!.left-a.f!.left);
  if(others[0])out.alt=t(`${name(others[0].o)} has ${Math.round(others[0].f!.left)}% left and lasts to its reset`,`${name(others[0].o)} 계정은 ${Math.round(others[0].f!.left)}% 남아 초기화까지 넉넉합니다`);}
 else if(f.state==='enough'){out.main=t('It lasts to the reset','초기화 전에 바닥나지 않습니다');out.sub=f.reset?(at=>t(`Resets ${at}`,`${at} 초기화`))(new Date(f.reset*1000).toLocaleString(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}))+' · '+t(`${Math.round(f.left)}% left`,`${Math.round(f.left)}% 남음`):'';}
 else out.main=t('Not in use now','지금은 쓰지 않고 있습니다');
 const h=q.windows.find(w=>w&&w.scope!=='mcp'&&periodOf(w)==='5h');
 if(h&&valid(h.pct)&&valid(h.reset)&&h.pct>=80&&h.reset-now>0&&h.reset-now<=3600)out.h5=t(`The 5-hour limit resets in ${duration(h.reset-now,t)} (${Math.round(h.pct)}% used). Start big work after that.`,`5시간 한도가 ${duration(h.reset-now,t)} 뒤 초기화됩니다(${Math.round(h.pct)}% 사용). 큰 작업은 그 뒤에 시작하세요.`);
 return out;
}
