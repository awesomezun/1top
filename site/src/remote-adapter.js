// Relay snapshots (cloud/src/protocol.ts DeviceSnapshot, relay-parity-contract_v1.0.1) in the shape of the
// desktop collector's /api/state, so the desktop dashboard (agent/onetop/dist) draws the remote workspace
// unchanged. Values a relay snapshot does not carry (older companions) stay null or empty; nothing is invented.
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

// Older companions sent 'project · kind' as a title; a title is the conversation's or nothing.
const conversationTitle=s=>s.title&&s.title!==`${s.project} · ${s.kind}`?s.title:'';
const number=v=>valid(v)?v:null;

function session(device,s,online){
 const caps=new Set(s.capabilities||[]),orca=s.app==='Orca',status=online?s.status||'unknown':'unknown',pids=Array.isArray(s.pids)?s.pids.filter(Number.isInteger):[];
 // The relay folds a paused or resuming session into status; the dashboard keeps both, as the collector does.
 const base={paused:'idle',resuming:'working'}[status]||status;
 const estimates=Object.fromEntries(Object.entries(s.weekly_estimate||{}).map(([key,e])=>[key,estimate(e)]));
 return {
  id:remoteId(device,s.id),device_id:device.id,device_name:device.name,source_id:s.id,
  // No path crosses the relay: the computer's name stands where the local dashboard shows the folder.
  kind:s.kind||'unknown',model:s.model||'',project:asideHome(s)?'Aside 기본 작업공간':s.project||'',title:conversationTitle(s),cwd:device.name||'',
  status:base,display_status:status,effort:s.effort||null,effort_source:s.effort_source||null,effort_updated:number(s.effort_updated),
  context_usage:s.context_usage||null,last_usage:number(s.last_usage),request_input:number(s.request_input),context_size:number(s.context_size),terminal_note:s.terminal_note||'',
  tokens:vector(s.tokens),
  usage:{rate:valid(s.rate)?s.rate:null,windows:s.windows||{},weekly_account:s.weekly_account||null,weekly_estimate:estimates,
   last_minute:vector(s.usage?.last_minute),last_five_minutes:vector(s.usage?.last_five_minutes),output_rate:number(s.usage?.output_rate),
   history:Array.isArray(s.usage?.history)?s.usage.history.filter(p=>Array.isArray(p)&&p.length===2&&p.every(valid)):[]},
  resources:valid(s.cpu)||valid(s.rss)?{cpu:valid(s.cpu)?s.cpu:null,rss:valid(s.rss)?s.rss:null,count:pids.length||1,pids}:null,
  pids,location:{app:s.app&&s.app!=='Unknown'?s.app:'',terminal:s.terminal||'',app_path:caps.has('focus')&&!orca?'remote':''},
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
 const one=hosts.length===1?hosts[0]:null,names=get=>[...new Set(hosts.map(get).filter(Boolean))].join(' · ');
 return {cpu:cpu===null?null:Math.round(cpu*10)/10,cores,
  memory:{total:total||null,used:total?used:null,available:total?total-used:null,percent:total?Math.round(used/total*1000)/10:null},
  // Measurements only when every computer in the scope reports them; load, uptime and battery belong to one computer.
  swap:{used:each(h=>h.swap?.used),total:each(h=>h.swap?.total)},network:{interfaces:[...new Set(hosts.flatMap(h=>h.network?.interfaces||[]))],rx:each(h=>h.network?.rx),tx:each(h=>h.network?.tx)},
  disk:(()=>{const total=each(h=>h.disk?.total),free=each(h=>h.disk?.free);return {path:'',total,free,percent:total&&free!==null?Math.round((total-free)/total*1000)/10:null,read:each(h=>h.disk?.read),write:each(h=>h.disk?.write)};})(),
  load:Array.isArray(one?.load)&&one.load.length&&one.load.every(valid)?one.load:null,uptime:number(one?.uptime),battery:one?.battery&&valid(one.battery.percent)?one.battery:null,
  process_count:each(h=>h.process_count),unreadable_processes:each(h=>h.unreadable_processes),
  platform:names(h=>h.platform)||[...new Set(devices.map(d=>d.platform).filter(Boolean))].join(' · '),os:names(h=>h.os),gpu:null,gpu_note:''};
}

// Collector figures: one computer's as they are; several side by side, the process list naming each one.
function system(devices){
 const several=devices.length>1,systems=devices.map(d=>({d,s:d.snapshot.system||{}}));
 const history=(()=>{
  if(!several)return (systems[0]?.s.history||[]).filter(r=>valid(r?.t));
  // Samples of different computers line up by time (3-second buckets): CPU by cores, memory by size.
  const buckets=new Map();
  for(const {d,s} of systems)for(const r of s.history||[]){if(!valid(r?.t))continue;const k=Math.round(r.t/3),h=d.snapshot.host||{},b=buckets.get(k)||{t:k*3,cpu:0,cores:0,memory:0,size:0,rx:0,tx:0};
   if(valid(r.cpu)){b.cpu+=r.cpu*(h.cores||1);b.cores+=h.cores||1;}if(valid(r.memory)){b.memory+=r.memory*(h.total_memory||1);b.size+=h.total_memory||1;}b.rx+=r.rx||0;b.tx+=r.tx||0;buckets.set(k,b);}
  return [...buckets.values()].sort((a,b)=>a.t-b.t).map(b=>({t:b.t,cpu:b.cores?Math.round(b.cpu/b.cores*10)/10:null,memory:b.size?Math.round(b.memory/b.size*10)/10:null,rx:b.rx,tx:b.tx}));
 })();
 const named=(d,p)=>several?{...p,name:`${p.name} · ${d.name}`}:p;
 const top=systems.flatMap(({d,s})=>(s.top||[]).map(p=>named(d,p))).sort((a,b)=>(b.cpu||0)-(a.cpu||0)).slice(0,15);
 const shared=systems.flatMap(({d,s})=>(s.shared||[]).map(p=>named(d,p)));
 const monitors=systems.map(({s})=>s.monitor).filter(m=>valid(m?.cpu));
 const sampler=systems.map(({s})=>s.sampler_ms).filter(valid);
 return {host:host(devices),history,top,shared,sampler_ms:sampler.length?Math.max(...sampler):null,
  monitor:monitors.length?{pid:several?null:monitors[0].pid??null,cpu:monitors.reduce((n,m)=>n+m.cpu,0),rss:monitors.every(m=>valid(m.rss))?monitors.reduce((n,m)=>n+m.rss,0):null}:{pid:null,cpu:null,rss:null}};
}

function quotas(devices){
 const byId=new Map();
 for(const d of devices)for(const q of d.snapshot.account_quotas||[]){const old=byId.get(q.id);if(!old||(q.updated||0)>(old.updated||0))byId.set(q.id,q);}
 return [...byId.values()].map(q=>({...q,alias:q.alias||null,windows:(q.windows||[]).map(w=>({...w,label:weeklyLabel(w.label)}))}));
}

// Period totals for the six ranges and the selected one, from what each computer reports for that key.
// A computer that does not report a key (an older companion) leaves it unknown.
function windows(devices,sessions,key,now){
 const started=()=>Math.min(...devices.map(d=>d.snapshot.recording_started||now/1000));
 const keys=[...PERIODS,...(key&&!PERIODS.some(([k])=>k===key)?[[key,null,null]]:[])];
 return keys.map(([k,label,fixed])=>{
  const reports=devices.map(d=>(d.snapshot.periods||[]).find(p=>p.key===k)).filter(Boolean);
  const seconds=fixed??(Math.max(0,...reports.map(p=>p.seconds||0))||(k==='all'?Math.max(600,now/1000-started()):Number(k.slice(7))));
  const by_kind={};for(const s of sessions){const v=vector(s.usage.windows?.[k]);if(v)by_kind[s.kind]=add([by_kind[s.kind],v]);}
  return {key:k,label:label??(k==='all'?'전체 기록':periodLabel(seconds)),seconds,tokens:reports.length?add(reports.map(p=>p.tokens)):null,by_kind,
   partial:reports.length<devices.length||reports.some(p=>p.partial),observed_seconds:reports.length?Math.min(...reports.map(p=>p.observed_seconds||0)):0,session_count:sessions.length};
 });
}

// A longer range's flow is the computers' own bins for that range, with their bounds as the chart's.
function rangeFlow(devices,key){
 const flows=devices.map(d=>d.snapshot.flow?.[key]).filter(f=>Array.isArray(f?.bins)&&valid(f.step)&&valid(f.start));
 if(!flows.length)return null;
 const events=flows.flatMap(f=>f.bins.flatMap((bin,i)=>Object.entries(bin).filter(([,n])=>valid(n)&&n>0).map(([kind,n])=>({t:f.start+i*f.step,kind,n}))));
 return {events:events.sort((a,b)=>a.t-b.t),chart_range:{start:Math.min(...flows.map(f=>f.start)),end:Math.max(...flows.map(f=>f.end??f.start+f.step*f.bins.length)),step:Math.max(...flows.map(f=>f.step))}};
}

const sum=(rows,get)=>{const v=rows.map(get);return v.length&&v.every(valid)?v.reduce((a,b)=>a+b,0):null;};
// Each computer's legacy per-tool limits; one per tool, the latest.
function toolQuotas(devices){
 const byKind=new Map();for(const d of devices)for(const q of d.snapshot.quotas||[]){const old=byKind.get(q.kind);if(!old||(q.updated||0)>(old.updated||0))byKind.set(q.kind,q);}
 return [...byKind.values()];
}

export function remoteState(all,{scope='all',period=null,now=Date.now(),tag='REMOTE'}={}){
 const devices=all.filter(d=>scope==='all'||d.id===scope),live=devices.filter(d=>isFresh(d,now));
 // A range every computer reports is read like the six; one an older computer lacks takes its speed
 // from each computer's speed totals instead.
 const reported=!period||PERIODS.some(([k])=>k===period)||devices.length>0&&devices.every(d=>(d.snapshot.periods||[]).some(p=>p.key===period));
 const sessions=devices.flatMap(d=>(d.snapshot.sessions||[]).map(s=>session(d,s,isFresh(d,now))));
 const account_quotas=quotas(devices),updated=live.length?Math.max(...live.map(d=>d.received))/1000:Math.max(0,...devices.map(d=>d.received||0))/1000;
 const started=devices.length?Math.min(...devices.map(d=>d.snapshot.recording_started||updated)):updated;
 const counts={};for(const s of sessions)if(!s.is_subagent&&s.kind!=='Aside')counts[s.kind]=(counts[s.kind]||0)+1;
 const ops=devices.map(d=>({device:d,o:d.snapshot.operations})).filter(x=>x.o);
 // The six ranges draw from every computer's finest bins; a longer range from its own bins and bounds.
 const range=period&&!PERIODS.some(([k])=>k===period)?rangeFlow(live,period):null;
 const reportedCounts=devices.length&&devices.every(d=>d.snapshot.process_counts&&typeof d.snapshot.process_counts==='object');
 const processCounts=reportedCounts?devices.reduce((n,d)=>{for(const [k,v] of Object.entries(d.snapshot.process_counts))if(valid(v))n[k]=(n[k]||0)+v;return n;},{}):counts;
 const actions=devices.flatMap(d=>(d.snapshot.actions||[]).map(a=>({...a,sid:a.sid?remoteId(d,a.sid):a.sid}))).filter(a=>valid(a.t)).sort((a,b)=>a.t-b.t).slice(-20);
 const collection=devices.map(d=>d.snapshot.collection_ms).filter(valid);
 return {
  ready:true,remote:true,tag,version:devices[0]?.snapshot.version||'',updated,started,history_started:started,error:null,poll_seconds:3,
  sessions,root_sessions:group(sessions),events:range?range.events:events(live),chart_range:range?range.chart_range:null,
  period_usage:{computers:reported?live.length:0,expected:reported?devices.length:0,as_of:updated,recording_started:started,known_kinds:[...new Set(sessions.filter(s=>s.tokens).map(s=>s.kind))].sort(),windows:windows(devices,sessions,period,now)},
  quotas:toolQuotas(devices),account_quotas,
  weekly_usage:{accounts:account_quotas.map(q=>({id:q.id,kind:q.kind,periods:q.weekly||{},usage_points:q.usage_points||[],
   ...(q.calibration&&valid(q.calibration.seconds)&&valid(q.calibration.used_pp)&&valid(q.calibration.tokens)?{calibration:q.calibration}:{})})),basis:'relay',as_of:updated},
  process_counts:processCounts,
  orca_terminals:sum(devices,d=>d.snapshot.orca_terminals)??sessions.filter(s=>s.orca_terminal&&!s.is_subagent).length,
  applications:devices.flatMap(d=>(d.snapshot.applications||[]).map(a=>({name:a.name,evidence:a.evidence||'application_process',device:d.name}))),
  system:system(live.length?live:devices),
  operations:{updated:Math.max(0,...ops.map(x=>x.o.updated||0))||null,goal_source_status:ops.length?'reported':'unavailable',skills:[],events:[],schedules:[],
   goals:ops.flatMap(({device,o})=>(o.goals||[]).map(g=>({goal_id:device.id+':'+g.thread_id,objective:'',runtime:g.runtime,location:device.name,status:g.status,
    tokens_used:g.tokens_used,token_budget:null,time_used_seconds:g.time_used_seconds,session_connected:g.session_connected,evidence:g.evidence}))),
   installed_skills:ops.reduce((n,x)=>n+(x.o.installed_skills||0),0),observed_events:ops.reduce((n,x)=>n+(x.o.observed_events||0),0),loop_state:'not_verified',skill_runtime:'partial'},
  actions,resume_prompt:devices.map(d=>d.snapshot.resume_prompt).find(Boolean)||'',action_token:'remote',collection_ms:collection.length?Math.max(...collection):null,telemetry:null,
  workspace_usage:{devices:reported?[]:devices.map(d=>({id:d.id,name:d.name,online:isFresh(d,now),received:d.received||0,periods:d.snapshot.speed_periods||[]})),updated}
 };
}

// Several computers' usage histories (usage-history-contract_v1.0.0) as one: bins that start at the same
// times add up; a computer whose bins differ (another time zone) is left out rather than shifted.
// null (not covered) stays null only where no computer covers the bin.
const plus=(a,b)=>a===null||a===undefined?b??null:b===null||b===undefined?a:a+b;
function rows(lists,width){
 const byKey=new Map();
 for(const row of lists.flat()){const old=byKey.get(row.key);byKey.set(row.key,old?{...old,folded:(old.folded||0)+(row.folded||0)||undefined,tokens:old.tokens.map((v,i)=>plus(v,row.tokens[i]))}:{...row,tokens:[...row.tokens]});}
 const all=[...byKey.values()],other=all.filter(r=>r.key==='__other__'),named=all.filter(r=>r.key!=='__other__').sort((a,b)=>b.tokens.reduce((n,v)=>n+(v||0),0)-a.tokens.reduce((n,v)=>n+(v||0),0));
 const rest=[...named.slice(12),...other];
 return rest.length?[...named.slice(0,12),{key:'__other__',folded:named.slice(12).length+other.reduce((n,r)=>n+(r.folded||0),0),tokens:Array.from({length:width},(_,i)=>rest.reduce((n,r)=>plus(n,r.tokens[i]),null))}]:named;
}
export function mergeHistory(parts){
 if(parts.length===1)return parts[0].data;
 const base=parts[0].data,bins=JSON.stringify(base.series?.bins||[]),same=parts.filter(p=>JSON.stringify(p.data.series?.bins||[])===bins).map(p=>p.data),width=base.series?.bins?.length||0;
 const cells=(get,key)=>{const map=new Map();for(const d of same)for(const c of get(d)||[]){const k=key(c),old=map.get(k);map.set(k,old?[...old.slice(0,-1),plus(old.at(-1),c.at(-1))]:[...c]);}return [...map.values()];};
 return {as_of:Math.max(...same.map(d=>d.as_of||0)),coverage:same.flatMap(d=>d.coverage||[]),
  series:{...base.series,total:Array.from({length:width},(_,i)=>same.reduce((n,d)=>plus(n,d.series.total?.[i]??null),null)),
   by_model:rows(same.map(d=>d.series.by_model||[]),width),by_project:rows(same.map(d=>d.series.by_project||[]),width)},
  heatmap:{hours:cells(d=>d.heatmap?.hours,c=>c[0]+'|'+c[1]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]-b[1]),days:cells(d=>d.heatmap?.days,c=>c[0]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)}};
}

// The computer and the session a dashboard request names.
export function findSession(all,id){
 for(const d of all){const prefix=d.id+':';if(!String(id).startsWith(prefix))continue;const s=(d.snapshot.sessions||[]).find(x=>x.id===id.slice(prefix.length));if(s)return {device:d,session:s};}
 return null;
}
