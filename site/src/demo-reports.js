// Each demo computer's reports (report-contract v1.2.0), alike on the web demo, the desktop demo collector and both
// phones: this month's API value grows with the demo clock at the pace of the computer's sessions and their models;
// its plans are the demo accounts it works with; the week counts the demo's agent hours, Monday first, local time.
import {WORLD} from './demo-world.js';

const HOUR=3600,DAY=86400;
// Dollars an hour for one unit of a session's weight, by model: the demo's share of the public API prices.
const RATE={'claude-opus-5-5':.074,'claude-sonnet-5-5':.037,'claude-haiku-5-5':.004,'claude-fable-5-1':.16,'gpt-6.1-sol':.036,'gpt-6-astra':.16,'glm-5.3':.012,'gemini-3.5-pro':.03};
// What each demo account costs a month and how the collector knows it: read from the account, set by the user, or
// unknown (a GLM Pro and an Agy pool, whose prices are not confirmed).
const PLANS={dev:['max','Claude Max',100,'detected'],studio:['pro','Claude Pro',20,'detected'],ops:['pro','ChatGPT Pro',200,'user'],ml:['plus','ChatGPT Plus',20,'detected'],
 gemini:['','Agy Gemini',null,'unknown'],glm:['pro','GLM Pro',null,'unknown']};
// Agent hours a day on each computer, working and waiting for a person; last week ran a little lighter.
const HOURS=[[6.8,.9],[2.9,.35],[3.6,.4]];
const PAST=[.45,.6,.75,.85,.95];
const round=(n,d=2)=>Math.round(n*10**d)/10**d;
const baseModel=m=>String(m||'').replace(/\[.*\]$/,'');
const ymd=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');

function rows(c){
 const now=WORLD.sessions.filter(r=>r[0]===c).map(r=>({kind:r[2],account:r[6],model:baseModel(r[4]),weight:r[7],project:r[3],state:r[5]}));
 const earlier=WORLD.earlier.filter(r=>r[0]===c).map(r=>({kind:r[1],account:r[2],model:baseModel(r[3]),weight:r[5],project:r[4]}));
 // Aside bills through its own key, not a subscription here, so it stays out of the month's value.
 return [...now,...earlier].filter(r=>RATE[r.model]!==undefined&&r.kind!=='Aside');
}
export function demoReports(c,now){
 const list=rows(c),d=new Date(now*1000),first=new Date(d.getFullYear(),d.getMonth(),1).getTime()/1000;
 const pace={};for(const r of list){const k=r.model+'|'+r.kind;pace[k]=(pace[k]||0)+r.weight*RATE[r.model];}
 const hours=(now-first)/HOUR,api=Object.fromEntries(Object.entries(pace).map(([k,v])=>[k,v*hours*.35]));
 const by_model=Object.entries(api).map(([k,v])=>{const [model,kind]=k.split('|');return {model,kind,api_value:round(v)};}).sort((a,b)=>b.api_value-a.api_value);
 const keys=[...new Set(list.map(r=>r.account).filter(k=>PLANS[k]))];
 const plans=keys.map(k=>{const a=WORLD.accounts.find(x=>x.key===k),[plan,label,price,source]=PLANS[k];return {account_id:a.id,kind:a.kind,plan,label,price,source};});
 const plan_total=plans.reduce((n,p)=>n+(p.price||0),0),api_value=round(by_model.reduce((n,m)=>n+m.api_value,0));
 const kinds=[...new Set(by_model.map(m=>m.kind))];
 // The multiple and the past months count the tools whose plans all have a price, as the collector does.
 const unknownKinds=new Set(plans.filter(p=>p.price===null).map(p=>p.kind));
 const by_kind=kinds.map(kind=>{const v=round(by_model.filter(m=>m.kind===kind).reduce((n,m)=>n+m.api_value,0)),p=plans.filter(x=>x.kind===kind).reduce((n,x)=>n+(x.price||0),0);return {kind,api_value:v,plan_total:p,ratio:p&&!unknownKinds.has(kind)?round(v/p,3):null};});
 const perMonth=Object.entries(pace).filter(([k])=>!unknownKinds.has(k.split('|')[1])).reduce((n,[,v])=>n+v,0)*24*30*.35;
 const knownPlan=plans.filter(p=>!unknownKinds.has(p.kind)).reduce((n,p)=>n+(p.price||0),0);
 const months=PAST.map((f,i)=>{const m=new Date(d.getFullYear(),d.getMonth()-PAST.length+i,1);return {month:m.getFullYear()+'-'+String(m.getMonth()+1).padStart(2,'0'),api_value:round(perMonth*f),plan_total:knownPlan};});
 // The week from Monday 0:00: whole days at the computer's hours, today by the share of it gone.
 const monday=new Date(d.getFullYear(),d.getMonth(),d.getDate()-((d.getDay()+6)%7)),start=monday.getTime()/1000,[w,q]=HOURS[c]||[0,0];
 const days=[];for(let i=0;i<7;i++){const day=new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i),t=day.getTime()/1000;if(t>now)break;
  const part=Math.min(1,(now-t)/DAY),wave=1+.12*Math.sin(i*1.7+c);days.push({date:ymd(day),working_s:Math.round(w*HOUR*part*wave),waiting_s:Math.round(q*HOUR*part*(2-wave))});}
 const working_s=days.reduce((n,x)=>n+x.working_s,0),waiting_s=days.reduce((n,x)=>n+x.waiting_s,0);
 const waiting=WORLD.sessions.find(r=>r[0]===c&&r[5]==='waiting');
 return {version:1,as_of:now,
  value:{month:months.length?new Date(first*1000).getFullYear()+'-'+String(new Date(first*1000).getMonth()+1).padStart(2,'0'):'',start:first,end:now,currency:'USD',prices_as_of:'2026-11-07',
   plans,plan_total,api_value,ratio:knownPlan?round(by_kind.filter(k=>k.ratio!==null).reduce((n,k)=>n+k.api_value,0)/knownPlan,3):null,unpriced:{tokens:0,models:[]},api_billed:0,by_kind,by_model,months},
  weekly:{start,end:start+7*DAY,since:start-30*DAY,working_s,waiting_s,
   longest_wait:waiting?{session_id:waiting[1],label:waiting[3],kind:waiting[2],seconds:Math.round(q*HOUR*.35)}:null,
   // Last week up to the same weekday and time, so a Thursday compares with last Thursday.
   previous:{working_s:Math.round(working_s*.86),waiting_s:Math.round(waiting_s*1.35),partial:false},days}};
}
