// Relay snapshots (cloud/src/protocol.ts DeviceSnapshot) in the shape of the desktop collector's
// /api/state, so the desktop dashboard (agent/onetop/dist) draws the remote workspace unchanged.
// Values a relay snapshot does not carry stay null or empty; nothing is invented.
const PERIODS=[['24h','24시간',86400],['12h','12시간',43200],['5h','5시간',18000],['1h','1시간',3600],['30m','30분',1800],['10m','10분',600]];
const FRESH_MS=30000;
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const vector=v=>Array.isArray(v)&&v.length===4&&v.every(valid)?v:null;
const add=(values)=>{const known=values.map(vector).filter(Boolean);return known.length?[0,1,2,3].map(i=>known.reduce((n,v)=>n+v[i],0)):null;};
// Remote session ids are prefixed with their computer, so two computers never share an id.
export const remoteId=(device,id)=>device.id+':'+id;
export const isFresh=(device,now=Date.now())=>device.online!==false&&now-(device.received||0)<FRESH_MS;

function periodLabel(seconds){return seconds%86400===0?seconds/86400+'일':seconds%3600===0?seconds/3600+'시간':Math.round(seconds/60)+'분';}
function weeklyLabel(label){return ['주간','Weekly','weekly','7d','7D'].includes(label)?'주간':label;}

// A relay estimate's calibration gives the burn rate only with the measured reference (seconds,
// used_pp, tokens), as the collector reports it; pp_per_token alone draws no dial.
function estimate(e){
 const c=e.calibration,full=c&&valid(c.seconds)&&valid(c.used_pp)&&valid(c.tokens);
 return {used_pp:e.used_pp,partial:e.partial,tokens:e.tokens,account_id:e.account_id,period_seconds:e.period_seconds,basis:c?'calibrated_token_equivalent':'',
  ...(full?{calibration:{seconds:c.seconds,used_pp:c.used_pp,tokens:c.tokens,confidence:c.confidence||'',source:c.source||'',from:c.from??null,to:c.to??null}}:{})};
}

// Aside's default workspace is project 0; the relay carries no paths, so the name comes from that, as the
// phones name it (the desktop dashboard names it from the session's folder).
const asideHome=s=>s.kind==='Aside'&&s.project==='0';

function session(device,s,online){
 const caps=new Set(s.capabilities||[]),orca=s.app==='Orca',status=online?s.status||'unknown':'unknown';
 // The relay folds a paused or resuming session into status; the dashboard keeps both, as the collector does.
 const base={paused:'idle',resuming:'working'}[status]||status;
 const estimates=Object.fromEntries(Object.entries(s.weekly_estimate||{}).map(([key,e])=>[key,estimate(e)]));
 return {
  id:remoteId(device,s.id),device_id:device.id,device_name:device.name,source_id:s.id,
  kind:s.kind||'unknown',model:s.model||'',project:asideHome(s)?'Aside 기본 작업공간':s.project||'',title:device.name||'',cwd:'',
  status:base,display_status:status,effort:s.effort??null,context_usage:s.context_usage||null,
  tokens:vector(s.tokens),
  usage:{rate:valid(s.rate)?s.rate:null,windows:s.windows||{},weekly_account:s.weekly_account||null,weekly_estimate:estimates},
  resources:valid(s.cpu)||valid(s.rss)?{cpu:valid(s.cpu)?s.cpu:null,rss:valid(s.rss)?s.rss:null,count:1,pids:[]}:null,
  pids:[],location:{app:s.app&&s.app!=='Unknown'?s.app:'',terminal:s.terminal||'',app_path:caps.has('focus')&&!orca?'remote':''},
  orca_terminal:orca?{title:s.terminal||''}:null,
  // Controls follow what the computer reported it accepts, and only while it is connected.
  control_key:online&&caps.size?s.control_key||'':'',input_verified:caps.has('pause')||caps.has('resume'),capabilities:online?[...caps]:[],
  offline:!online,reported:(device.received||0)/1000,
  is_subagent:!!s.parent_session_id,parent_session_id:s.parent_session_id?remoteId(device,s.parent_session_id):null,
  root_session_id:remoteId(device,s.root_session_id||s.id),note:''
 };
}

// One display row per session tree, as agent/onetop/hierarchy.py group_sessions: children add their usage once.
function group(sessions){
 const byId=new Map(sessions.map(s=>[s.id,s])),members=new Map();
 for(const s of sessions){const root=byId.has(s.root_session_id)?s.root_session_id:s.id;if(!members.has(root))members.set(root,[]);members.get(root).push(s);}
 return [...members].map(([rootId,rows])=>{
  const root=byId.get(rootId),children=rows.filter(s=>s.id!==rootId);
  const row={...root,usage:{...root.usage},children_ids:children.map(s=>s.id),children_count:children.length,
   children_working:children.filter(s=>(s.display_status||s.status)==='working').length};
  if(!children.length)return row;
  row.tokens=add(rows.map(s=>s.tokens));
  const rates=rows.map(s=>s.usage.rate).filter(valid);row.usage.rate=rates.length?rates.reduce((a,b)=>a+b,0):null;
  const keys=new Set(rows.flatMap(s=>Object.keys(s.usage.windows||{})));
  row.usage.windows=Object.fromEntries([...keys].map(k=>[k,add(rows.map(s=>s.usage.windows?.[k]))]));
  const accounts=new Set(rows.map(s=>s.usage.weekly_account)),account=accounts.size===1?[...accounts][0]:null;row.usage.weekly_account=account;row.usage.weekly_estimate={};
  // A tree's estimate adds its members' only when every member with usage has one on the same account and reference.
  for(const key of account?keys:[]){
   const estimates=[];let complete=true;
   for(const s of rows){const v=vector(s.usage.windows?.[key]);if(!v){complete=false;break;}if(!v.some(n=>n>0))continue;
    const e=s.usage.weekly_estimate?.[key];if(!e||e.account_id!==account||e.basis!=='calibrated_token_equivalent'||!valid(e.used_pp)||!valid(e.tokens)){complete=false;break;}estimates.push(e);}
   if(complete&&estimates.length&&estimates.every(e=>JSON.stringify(e.calibration)===JSON.stringify(estimates[0].calibration)))
    row.usage.weekly_estimate[key]={...estimates[0],used_pp:Math.round(estimates.reduce((n,e)=>n+e.used_pp,0)*1e4)/1e4,tokens:estimates.reduce((n,e)=>n+e.tokens,0),partial:estimates.some(e=>e.partial)};
  }
  return row;
 });
}

// Token flow from each computer's per-period bins: the finest bins first, coarser ones only before them.
function events(devices){
 const out=[];
 for(const d of devices){
  const flows=Object.values(d.snapshot.flow||{}).filter(f=>Array.isArray(f?.bins)).sort((a,b)=>a.step-b.step||a.start-b.start);
  let covered=Infinity;
  for(const f of flows){
   f.bins.forEach((bin,i)=>{const t=f.start+i*f.step;if(t+f.step>covered)return;for(const [kind,n] of Object.entries(bin))if(valid(n)&&n>0)out.push({t,kind,n});});
   covered=Math.min(covered,f.start);
  }
 }
 return out.sort((a,b)=>a.t-b.t);
}

function host(devices){
 const hosts=devices.map(d=>d.snapshot.host||{}),cores=hosts.reduce((n,h)=>n+(valid(h.cores)?h.cores:0),0);
 const cpuHosts=hosts.filter(h=>valid(h.cpu)),each=(get)=>{const v=hosts.map(get);return v.length&&v.every(valid)?v.reduce((a,b)=>a+b,0):null;};
 // CPU across computers weighs each by its logical cores; memory adds up.
 const cpu=!cpuHosts.length?null:cores?cpuHosts.reduce((n,h)=>n+h.cpu*(h.cores||0),0)/Math.max(1,cpuHosts.reduce((n,h)=>n+(h.cores||0),0)):cpuHosts.reduce((n,h)=>n+h.cpu,0)/cpuHosts.length;
 const total=hosts.reduce((n,h)=>n+(valid(h.total_memory)?h.total_memory:0),0),used=hosts.reduce((n,h)=>n+(valid(h.used_memory)?h.used_memory:0),0);
 return {cpu:cpu===null?null:Math.round(cpu*10)/10,cores,load:null,
  memory:{total:total||null,used:total?used:null,available:total?total-used:null,percent:total?Math.round(used/total*1000)/10:null},
  // Network and disk only when every computer in the scope reports them (host.network, host.disk).
  swap:{used:null,total:null},network:{interfaces:[...new Set(hosts.flatMap(h=>h.network?.interfaces||[]))],rx:each(h=>h.network?.rx),tx:each(h=>h.network?.tx)},
  disk:(()=>{const total=each(h=>h.disk?.total),free=each(h=>h.disk?.free);return {path:'',total,free,percent:total&&free!==null?Math.round((total-free)/total*1000)/10:null,read:each(h=>h.disk?.read),write:each(h=>h.disk?.write)};})(),
  battery:null,uptime:null,process_count:null,unreadable_processes:null,platform:[...new Set(devices.map(d=>d.platform).filter(Boolean))].join(' · '),os:'',gpu:null,gpu_note:''};
}

function quotas(devices){
 const byId=new Map();
 for(const d of devices)for(const q of d.snapshot.account_quotas||[]){const old=byId.get(q.id);if(!old||(q.updated||0)>(old.updated||0))byId.set(q.id,q);}
 return [...byId.values()].map(q=>({...q,alias:q.alias||null,windows:(q.windows||[]).map(w=>({...w,label:weeklyLabel(w.label)}))}));
}

// The selected period: a fixed one from the computers' period totals, any other one as unknown.
function windows(devices,sessions,key,now){
 const list=PERIODS.map(([k,label,seconds])=>{
  const reports=devices.map(d=>(d.snapshot.periods||[]).find(p=>p.key===k)).filter(Boolean);
  const by_kind={};for(const s of sessions){const v=vector(s.usage.windows?.[k]);if(v)by_kind[s.kind]=add([by_kind[s.kind],v]);}
  return {key:k,label,seconds,tokens:reports.length?add(reports.map(p=>p.tokens)):null,by_kind,
   partial:reports.length<devices.length||reports.some(p=>p.partial),observed_seconds:reports.length?Math.min(...reports.map(p=>p.observed_seconds||0)):0,session_count:sessions.length};
 });
 if(key&&!PERIODS.some(([k])=>k===key)){
  const started=Math.min(...devices.map(d=>d.snapshot.recording_started||now/1000)),seconds=key==='all'?Math.max(600,now/1000-started):Number(key.slice(7));
  if(valid(seconds))list.push({key,label:key==='all'?'전체 기록':periodLabel(seconds),seconds,tokens:null,by_kind:{},partial:true,observed_seconds:0,session_count:sessions.length});
 }
 return list;
}

export function remoteState(all,{scope='all',period=null,now=Date.now(),tag='REMOTE'}={}){
 const devices=all.filter(d=>scope==='all'||d.id===scope),live=devices.filter(d=>isFresh(d,now));
 // Ranges past the six reported periods take their speed from each computer's speed totals instead.
 const fixed=!period||PERIODS.some(([k])=>k===period);
 const sessions=devices.flatMap(d=>(d.snapshot.sessions||[]).map(s=>session(d,s,isFresh(d,now))));
 const account_quotas=quotas(devices),updated=live.length?Math.max(...live.map(d=>d.received))/1000:Math.max(0,...devices.map(d=>d.received||0))/1000;
 const started=devices.length?Math.min(...devices.map(d=>d.snapshot.recording_started||updated)):updated;
 const counts={};for(const s of sessions)if(!s.is_subagent&&s.kind!=='Aside')counts[s.kind]=(counts[s.kind]||0)+1;
 const ops=devices.map(d=>({device:d,o:d.snapshot.operations})).filter(x=>x.o);
 return {
  ready:true,remote:true,tag,version:devices[0]?.snapshot.version||'',updated,started,history_started:started,error:null,poll_seconds:3,
  sessions,root_sessions:group(sessions),events:events(live),chart_range:null,
  period_usage:{computers:fixed?live.length:0,expected:fixed?devices.length:0,as_of:updated,recording_started:started,known_kinds:[...new Set(sessions.filter(s=>s.tokens).map(s=>s.kind))].sort(),windows:windows(devices,sessions,period,now)},
  quotas:[],account_quotas,
  weekly_usage:{accounts:account_quotas.map(q=>({id:q.id,kind:q.kind,periods:q.weekly||{},usage_points:q.usage_points||[]})),basis:'relay',as_of:updated},
  process_counts:counts,orca_terminals:sessions.filter(s=>s.orca_terminal&&!s.is_subagent).length,
  applications:devices.flatMap(d=>(d.snapshot.applications||[]).map(a=>({name:a.name,evidence:a.evidence||'application_process',device:d.name}))),
  system:{host:host(live.length?live:devices),shared:[],top:[],history:[],sampler_ms:null,monitor:{pid:null,cpu:null,rss:null}},
  operations:{updated:Math.max(0,...ops.map(x=>x.o.updated||0))||null,goal_source_status:ops.length?'reported':'unavailable',skills:[],events:[],schedules:[],
   goals:ops.flatMap(({device,o})=>(o.goals||[]).map(g=>({goal_id:device.id+':'+g.thread_id,objective:'',runtime:g.runtime,location:device.name,status:g.status,
    tokens_used:g.tokens_used,token_budget:null,time_used_seconds:g.time_used_seconds,session_connected:g.session_connected,evidence:g.evidence}))),
   installed_skills:ops.reduce((n,x)=>n+(x.o.installed_skills||0),0),observed_events:ops.reduce((n,x)=>n+(x.o.observed_events||0),0),loop_state:'not_verified',skill_runtime:'partial'},
  actions:[],resume_prompt:'',action_token:'remote',collection_ms:null,telemetry:null,
  workspace_usage:{devices:fixed?[]:devices.map(d=>({id:d.id,name:d.name,online:isFresh(d,now),received:d.received||0,periods:d.snapshot.speed_periods||[]})),updated}
 };
}

// The computer and the session a dashboard request names.
export function findSession(all,id){
 for(const d of all){const prefix=d.id+':';if(!String(id).startsWith(prefix))continue;const s=(d.snapshot.sessions||[]).find(x=>x.id===id.slice(prefix.length));if(s)return {device:d,session:s};}
 return null;
}
