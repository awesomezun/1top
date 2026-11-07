import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {demoState} from '../scripts/demo-state.mjs';
const require=createRequire(import.meta.url),speed=require('../agent/onetop/dist/speed.js'),weekly=require('../agent/onetop/dist/weekly.js');
const {marks,readings,range,cruise,trip,heat,instant}=require('../agent/onetop/dist/cluster.js');
const RECONNECT=new Set(['login_required','login_expired','credential_store_unavailable','access_denied']);
const display=s=>(s.children_working||0)>0?'working':s.display_status||s.status;
const now=1800000000,state=demoState(now,{period:'1h'});
const read=(o={})=>readings(state,{period:'1h',now,speed,weekly,reconnect:RECONNECT,display,sessions:state.sessions,...o});

// Scale marks: four or more major steps, five minor steps each.
for(const [max,major,minor] of [[2e8,5e7,1e7],[1e8,2.5e7,5e6],[5e7,1e7,2e6],[2,.5,.1]])assert.deepEqual(marks(max),{max,major,minor});

// The tachometer reads the dashboard's token speed in tokens per hour on the dashboard's scale.
const r=read(),m=speed.measure(state,'1h',now);
assert.equal(r.tach.rate,m.rate*3600);
assert.equal(r.tach.max,speed.scaleMax(r.tach.rate,3600));
assert.equal(r.tach.tokens,m.tokens);
assert.equal(read({tachMax:5e8}).tach.max,5e8);
// The dial runs to 200M in every period and past that in 100M steps (300M, 400M, 500M, 700M for 650M an hour), each
// step one level of fever up to the third; a period's scale never shrinks while it stays.
const at=rate=>read({speed:{...speed,measure:(...a)=>({...speed.measure(...a),rate:rate/3600})}}).tach.full;
for(const [rate,full] of [[0,2e8],[1.5e8,2e8],[2e8,2e8],[2.3e8,3e8],[3.7e8,4e8],[4.7e8,5e8],[6.5e8,7e8]])assert.equal(at(rate),full,`${rate/1e6}M`);
// The burn dial keeps 2, 5, 10, 20 and past 20%/h breaks its limit in steps of 20: 40, 60, 80, 100.
const burnAt=b=>read({weekly:{...weekly,accountBurn:()=>b}}).speed.max;
for(const [b,max] of [[.5,2],[3,5],[15,20],[20,20],[25,40],[45,60],[61,80],[85,100]])assert.equal(burnAt(b),max,`${b}%/h`);
const hold={};read({hold,speed:{...speed,measure:(...a)=>({...speed.measure(...a),rate:4.7e8/3600})}});
assert.equal(read({hold,speed:{...speed,measure:(...a)=>({...speed.measure(...a),rate:1e8/3600})}}).tach.full,5e8);

// Nothing picked, the speedometer reads all the AI accounts: their average burn, with a needle for each; a pick
// reads that account or session alone.
const burning=r.accounts.filter(a=>Number.isFinite(a.burn)).sort((a,b)=>b.burn-a.burn);
assert(burning.length>=2,'the demo has at least two accounts with a burn rate');
const mean=burning.reduce((n,a)=>n+a.burn,0)/burning.length;
assert.deepEqual([r.speed.account,r.speed.subject.type,r.speed.picked,r.speed.session],[null,'all',false,null]);
assert(Math.abs(r.speed.value-mean)<1e-9);
assert.deepEqual(r.speed.multi.map(m=>m.id),burning.map(a=>a.id));
assert(r.speed.max>=r.speed.value&&r.speed.max>=2);
const p=read({pick:{type:'account',id:burning[1].id}});
assert.deepEqual([p.speed.account,p.speed.value,p.speed.picked],[burning[1].id,burning[1].burn,true]);
assert.equal(read({pick:{type:'account',id:'nobody'}}).speed.subject.type,'all');
const quiet=r.accounts.find(a=>!Number.isFinite(a.burn));
if(quiet)assert.deepEqual([read({pick:{type:'account',id:quiet.id}}).speed.value,read({pick:{type:'account',id:quiet.id}}).speed.account],[null,quiet.id]);
// A picked session reads its own burn and names its account; a session that is gone falls back.
const row=r.sessions.find(s=>Number.isFinite(s.burn)&&s.burn>0)||r.sessions[0],ps=read({pick:{type:'session',id:row.id}});
assert.deepEqual([ps.speed.session,ps.speed.account,ps.speed.value,ps.speed.picked,ps.speed.subject.account],[row.id,null,Number.isFinite(row.burn)?row.burn:null,true,row.account]);
assert.equal(read({pick:{type:'session',id:'gone'}}).speed.picked,false);

// Fuel: every account, with what is left of its weekly limit; an account that needs signing in again is flagged.
assert.equal(r.accounts.length,state.account_quotas.length);
assert.deepEqual(r.accounts.map(a=>a.plan),state.account_quotas.map(q=>q.plan||null));
assert.deepEqual(r.accounts.map(a=>a.who),state.account_quotas.map(q=>String(q.account_label||'').split('@')[0]));
for(const a of r.accounts){const p=state.weekly_usage.accounts.find(x=>x.id===a.id)?.periods?.['1h'];assert.equal(a.added,Number.isFinite(p?.used_pp)?p.used_pp:null);}
for(const a of r.accounts)if(a.pct!==null)assert.equal(a.left,Math.max(0,100-a.pct));
assert.deepEqual(r.accounts.filter(a=>a.reconnect).map(a=>a.id),state.account_quotas.filter(q=>RECONNECT.has(q.status)).map(q=>q.id));

// The window: every session (it scrolls), working first, then waiting, then the rest, each group by tokens.
assert.equal(r.sessions.length,state.sessions.length);
const step=s=>s.state==='working'?0:s.state==='waiting'?1:2;
for(let i=1;i<r.sessions.length;i++){const a=r.sessions[i-1],b=r.sessions[i];assert(step(a)<step(b)||step(a)===step(b)&&a.tokens>=b.tokens);}
// A pressed warning shows only its sessions.
const waitingOnly=read({only:'waiting'});
assert.deepEqual(waitingOnly.sessions.map(s=>s.id).sort(),r.tells.waiting.slice().sort());
assert.equal(r.working,state.sessions.filter(s=>display(s)==='working').length);

// Tell-tales: sessions waiting for a look, accounts to reconnect and fresh data.
assert.deepEqual(r.tells.waiting,state.sessions.filter(s=>display(s)==='waiting').map(s=>s.id));
assert.deepEqual(r.tells.reconnect,state.account_quotas.filter(q=>RECONNECT.has(q.status)).map(q=>q.id));
assert.equal(r.tells.fresh,true);
// Only tools with working sessions light up, each with its count.
assert(r.tells.kinds.every(k=>k.working>0));
assert.deepEqual(Object.fromEntries(r.tells.kinds.map(k=>[k.kind,k.working])),state.sessions.filter(s=>display(s)==='working').reduce((o,s)=>(o[s.kind]=(o[s.kind]||0)+1,o),{}));
assert.equal(readings({...state,updated:now-21},{period:'1h',now,speed,weekly,display,sessions:[]}).tells.fresh,false);
assert.equal(readings({...state,error:'down'},{period:'1h',now,speed,weekly,display,sessions:[]}).tells.fresh,false);

// No data yet: the dials rest at zero and nothing throws.
const empty=readings({},{period:'1h',now,speed,weekly,display,sessions:[]});
assert.deepEqual([empty.tach.rate,empty.speed.value,empty.accounts.length,empty.sessions.length,empty.tells.fresh],[null,null,0,0,false]);
// Range: what is left over the current burn gives when the limit runs out; before the reset it warns.
const H=3600,soon={left:39,burn:1.5,reset:now+70*H};
assert.deepEqual(range(soon,now),{state:'empty',at:now+26*H,early:true});
assert.deepEqual(range({...soon,burn:.5},now),{state:'enough',at:now+78*H,early:false});
assert.deepEqual(range({...soon,burn:0},now),{state:'idle',at:null,early:false});
assert.deepEqual(range({...soon,reset:null},now),{state:'empty',at:now+26*H,early:false});
assert.equal(range({...soon,left:null},now),null);assert.equal(range({...soon,burn:null},now),null);
// Cruise: what is left spread evenly until the reset.
assert.equal(cruise({left:40,reset:now+80*H},now),.5);
assert.equal(cruise({left:40,reset:now-1},now),null);assert.equal(cruise({left:null,reset:now+H},now),null);
// In the demo the busiest account runs dry before its reset, so its warning light is on; with nothing picked the
// speedometer's green zone ends at the accounts' average steady rate, and picking the busiest gives its own.
const first=r.accounts.find(a=>a.id===burning[0].id),steady=burning.map(a=>cruise(a,now)).filter(Number.isFinite);
assert(Math.abs(r.speed.cruise-steady.reduce((n,c)=>n+c,0)/steady.length)<1e-9);
assert.equal(read({pick:{type:'account',id:first.id}}).speed.cruise,cruise(first,now));
const busiest=read({pick:{type:'account',id:first.id}});
assert(busiest.speed.cruise>0&&busiest.speed.value>busiest.speed.cruise,'the busiest demo account runs over its steady rate');
assert(r.speed.max>=r.speed.cruise*1.6);
assert.deepEqual(r.tells.empty,r.accounts.filter(a=>a.range?.early).map(a=>a.id));
assert(r.tells.empty.includes(first.id));
// A session picked from a warning light reads its account's cruise and stays in the window.
const ctxRow=state.sessions.find(s=>s.id==='s3'),pc=read({pick:{type:'session',id:'s3'}});
assert(pc.sessions.some(x=>x.id==='s3'));
assert.equal(pc.speed.cruise,cruise(pc.accounts.find(a=>a.id===pc.speed.subject.account),now));
// Context nearly full at 90% of the window; a working session with no usage for 15 minutes is suspected stalled.
assert(ctxRow.context_usage.input_tokens/ctxRow.context_usage.capacity>=.9);
assert.deepEqual(r.tells.context,state.sessions.filter(s=>s.context_usage?.capacity>0&&s.context_usage.input_tokens/s.context_usage.capacity>=.9).map(s=>s.id));
assert(r.tells.context.includes('s3'));
const one=(extra)=>readings(state,{period:'1h',now,speed,weekly,display,sessions:[{id:'x',kind:'Claude',status:'working',...extra}]}).tells;
assert.deepEqual(one({last_usage:now-16*60}).stalled,['x']);
assert.deepEqual(one({last_usage:now-14*60}).stalled,[]);
assert.deepEqual(one({last_usage:0}).stalled,[]);
assert.deepEqual(one({last_usage:now-3600,status:'idle'}).stalled,[]);
assert.deepEqual(one({context_usage:{input_tokens:899,capacity:1000}}).context,[]);
assert.deepEqual(one({context_usage:{input_tokens:900,capacity:1000}}).context,['x']);
assert.deepEqual(one({context_usage:{input_tokens:900,capacity:null}}).context,[]);
// Trip: tokens since the start from the minute events, their hourly average and each account's weekly
// percent; a start before the events begin is outside the record.
const tripState={updated:now,events:[{t:now-8000,n:999},{t:now-1800,fresh:10,cached:20,written:30,output:40},{t:now-60,n:300}],
 weekly_usage:{accounts:[{id:'a',increase_intervals:[[now-3000,now-2900,1.5,'exact'],[now-600,now-500,.5,'exact'],[now-9000,now-8900,4,'exact']]},{id:'b'}]}};
const tp=trip(tripState,now-2*H,now,weekly);
assert.deepEqual([tp.tokens,tp.rate,tp.inRange],[400,200,true]);
assert.deepEqual(tp.accounts,[{id:'a',used:2},{id:'b',used:null}]);
const far=trip(tripState,now-2*86400,now,weekly);
assert.deepEqual([far.tokens,far.rate,far.inRange],[null,null,false]);
assert.equal(trip({...tripState,chart_range:{start:now-3*86400}},now-2*86400,now,weekly).inRange,true);
assert.equal(trip(tripState,null,now,weekly),null);assert.equal(trip(tripState,now+5,now,weekly),null);
// Engine temperature: the hottest computer by the higher of CPU and memory; one computer from the host.
assert.deepEqual(heat({system:{computers:[{name:'A',cpu:20,memory:40},{name:'B',cpu:91,memory:30},{name:'C',cpu:null,memory:null}]}}).value,91);
assert.deepEqual(heat({system:{computers:[{name:'A',cpu:20,memory:40},{name:'B',cpu:91,memory:30}]}}).computers.map(c=>c.load),[40,91]);
assert.deepEqual(heat({system:{host:{cpu:15.5,memory:{percent:61.2}}}}).value,61.2);
assert.equal(heat({}).value,null);
assert.equal(r.heat.value,Math.max(state.system.host.cpu,state.system.host.memory.percent));
// Live motion: the last minute's tokens per hour from the top-level sessions (a lead counts its subagents),
// in all and by tool.
const live=instant(state),roots=state.root_sessions;
assert.equal(live.rate,roots.reduce((n,s)=>n+(s.usage?.last_minute||[]).reduce((a,b)=>a+b,0)*3600/(s.usage?.window_seconds||60),0));
assert.equal(Object.values(live.by).reduce((a,b)=>a+b,0),live.rate);
assert.deepEqual(instant({sessions:[{kind:'Claude',usage:{last_minute:[1,2,3,4],window_seconds:60}},{kind:'Claude',is_subagent:true,usage:{last_minute:[9,9,9,9]}}]}),{rate:600,by:{Claude:600}});
assert.deepEqual(instant({sessions:[{kind:'Claude',usage:{}}]}),{rate:null,by:{}});
// Between readings the odometer runs on at that rate; the dials read the period's average only.
assert.equal(r.tach.instant,live.rate);
assert.equal(r.tach.climb,live.rate/3600);
assert.deepEqual(Object.keys(r.speed).sort(),['account','cruise','max','multi','picked','reach','session','subject','value']);
// Range: every AI reads the account that runs out first, in hours at its own burn.
{const ends=r.accounts.filter(a=>a.burn>0&&a.left!==null).map(a=>a.left/a.burn);
 if(ends.length)assert(Math.abs(r.speed.reach.hours-Math.min(...ends))<1e-9);else assert.equal(r.speed.reach.state,'idle');}
// The burn scale reaches past every account's own mark on the rim.
assert(r.speed.multi.every(m=>m.value<=r.speed.max));
// Agy pools and GLM read their representative window; a non-weekly or unverified one gets no burn, range or cruise.
const providers=JSON.parse(require('node:fs').readFileSync(new URL('./fixtures/provider-quotas_v1.0.2.json',import.meta.url),'utf8')).account_quotas;
const mixed=readings({...state,account_quotas:[...state.account_quotas,...providers]},{period:'1h',now,speed,weekly,reconnect:RECONNECT,display,sessions:state.sessions});
for(const q of providers){
 const a=mixed.accounts.find(x=>x.id===q.id),w=weekly.representative(q);
 assert(a,q.id);assert.equal(a.weekly,weekly.isWeekly(w));assert.equal(a.pct,Number.isFinite(w?.pct)?w.pct:null);
 if(!weekly.burnAllowed(q,w)){assert.equal(a.burn,null);assert.equal(a.added,null);assert.equal(a.range,null);}
 if(!a.weekly){assert.equal(a.window,w?.label??null);assert.equal(cruise(a,now),null);}
}
assert(mixed.accounts.some(a=>a.weekly===false),'the fixture has a non-weekly window');
assert(!providers.some(q=>q.id===mixed.speed.account),'the speedometer never falls back to a pool with no weekly burn');
console.log('Cluster: scale marks, token speed, picked subject, fuel and weekly cards, session window, tell-tales, range, cruise, context and stall warnings, trip, engine temperature, odometer motion, and provider windows passed.');
