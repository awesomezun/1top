// 1top.si /app: relay snapshots become the desktop collector's /api/state for the unchanged dashboard,
// the demo relay goes through the same adapter, and the dashboard markup the site edits is still there.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {remoteState,findSession,mergeHistory} from '../site/src/remote-adapter.js';
import {dashboardMarkup,dashboardFiles} from '../site/scripts/dashboard-pages.mjs';
const require=createRequire(import.meta.url),{measure}=require('../agent/onetop/dist/speed.js'),weekly=require('../agent/onetop/dist/weekly.js');

const now=1.8e9*1000,t=now/1000;
const vec=n=>[n,n*2,0,n];
const flow1h={step:60,start:t-3540,end:t+60,as_of:t,reported:true,bins:Array.from({length:60},(_,i)=>({Claude:i<30?0:100}))};
const flow24h={step:900,start:t-85500,end:t+900,as_of:t,reported:true,bins:Array.from({length:96},()=>({Claude:1000}))};
const device=(id,name,sessions,extra={})=>({id,name,platform:'Darwin',online:true,received:now-1000,snapshot:{
 updated:t-1,recording_started:t-7200,version:'4.0.4',sessions,applications:[{name:'Orca'}],
 host:{cpu:50,used_memory:8,total_memory:16,cores:8},periods:[{key:'1h',label:'1h',tokens:vec(100),partial:false,observed_seconds:3600}],
 account_quotas:[{id:'claude:abc123',kind:'Claude',account_label:'Claude · abc123',plan:'max',updated:t-5,stale:false,note:'',windows:[{label:'5H',pct:10,reset:t+60},{label:'Weekly',pct:40,reset:t+600}],weekly:{'1h':{used_pp:2,observed_seconds:3600,partial:false}},usage_points:[[t-60,39,0],[t,40,0]]}],
 operations:{updated:t,installed_skills:3,observed_events:1,goals:[{thread_id:'g',runtime:'Codex',status:'active',tokens_used:5,time_used_seconds:60,session_connected:true,evidence:'reported'}],loop_state:'not_verified',skill_runtime:'partial'},
 speed_periods:[{key:'custom:604800',seconds:604800,tokens:604800,known:true,partial:false}],...extra}});
const session=(id,extra={})=>({id,control_key:'key-'+id,kind:'Claude',app:'Orca',terminal:'Tab '+id,project:'web',title:'web · Claude',model:'claude-sonnet-4-6',
 status:'working',tokens:vec(10),rate:2,windows:{'1h':vec(5)},cpu:3,rss:100,capabilities:['focus','pause','terminate'],root_session_id:id,parent_session_id:null,
 weekly_account:'claude:abc123',weekly_estimate:{'1h':{used_pp:1.5,partial:false,period_seconds:3600,tokens:20,account_id:'claude:abc123',calibration:{pp_per_token:.075,confidence:'limited',from:t-7200,to:t-3600,valid_until:t+60,source:''}}},...extra});
const a=device('d1','Studio',[session('s1'),session('s2',{root_session_id:'s1',parent_session_id:'s1',status:'working'})],{flow:{'1h':flow1h,'24h':flow24h}});
const b=device('d2','Laptop',[session('s1',{app:'Terminal',terminal:'/dev/ttys001',status:'paused',capabilities:['focus','resume']})],{host:{cpu:10,used_memory:4,total_memory:16,cores:24}});
const offline={...device('d3','Old',[session('s9')]),online:false};

const state=remoteState([a,b,offline],{now,tag:'REMOTE'});
assert.equal(state.ready,true);assert.equal(state.remote,true);assert.equal(state.tag,'REMOTE');
// Ids carry their computer, so two computers' "s1" stay apart and controls find the right one.
assert.deepEqual(state.sessions.map(s=>s.id),['d1:s1','d1:s2','d2:s1','d3:s9']);
assert.equal(findSession([a,b],'d2:s1').device.id,'d2');assert.equal(findSession([a,b],'d1:s3'),null);
// One row per tree with children's usage added once, as hierarchy.group_sessions.
const root=state.root_sessions.find(s=>s.id==='d1:s1');
assert.equal(root.usage.weekly_estimate['1h'].used_pp,3);assert.equal(root.usage.weekly_estimate['1h'].tokens,40);
assert.equal(root.children_count,1);assert.equal(root.children_working,1);assert.deepEqual(root.tokens,[20,40,0,20]);assert.deepEqual(root.usage.windows['1h'],[10,20,0,10]);
// Paused keeps both states; Orca sessions carry their tab; other apps their location; offline loses controls.
const paused=state.sessions.find(s=>s.id==='d2:s1');assert.equal(paused.status,'idle');assert.equal(paused.display_status,'paused');assert.equal(paused.orca_terminal,null);assert.equal(paused.location.app,'Terminal');
assert.equal(state.sessions[0].orca_terminal.title,'Tab s1');
const gone=state.sessions.find(s=>s.id==='d3:s9');assert.equal(gone.status,'unknown');assert.equal(gone.control_key,'');
// Period totals add the computers; speed counts the two live ones out of three.
assert.deepEqual(state.period_usage.windows.find(w=>w.key==='1h').tokens,[300,600,0,300]);
const reading=measure(state,'1h',t);assert.equal(reading.computers,2);assert.equal(reading.expected,3);assert.equal(reading.partial,true);
// Longer ranges read each computer's speed totals; the period itself stays unknown.
const week=remoteState([a,b],{now,period:'custom:604800'});
assert.equal(week.period_usage.windows.at(-1).key,'custom:604800');assert.equal(week.period_usage.windows.at(-1).tokens,null);
assert.equal(measure(week,'custom:604800',t).tokens,604800*2);assert.equal(measure(week,'custom:604800',t).computers,2);
// Token flow: the finest bins first and the coarser ones only before them, so nothing counts twice.
const lastHour=state.events.filter(e=>e.t>=flow1h.start).reduce((n,e)=>n+e.n,0);
assert.equal(lastHour,3000);assert.ok(state.events.every(e=>e.t<flow1h.start?e.n===1000:true));
// CPU weighs computers by cores; memory adds up. Weekly labels read as the dashboard's.
assert.equal(state.system.host.cpu,20);assert.equal(state.system.host.memory.total,32);assert.equal(state.system.host.memory.percent,37.5);
assert.equal(weekly.weekly(state.account_quotas[0]).pct,40);assert.equal(state.weekly_usage.accounts[0].periods['1h'].used_pp,2);
// A relay estimate shows its share; without the reference amounts it draws no burn dial.
const e=state.sessions[0].usage.weekly_estimate['1h'];assert.equal(weekly.estimate(e),'≈1.5%');assert.equal(e.calibration,undefined);
assert.equal(weekly.sessionBurn(e,2,state.account_quotas[0],t),null);
// Scope: one computer alone.
assert.deepEqual(remoteState([a,b],{now,scope:'d2'}).sessions.map(s=>s.id),['d2:s1']);

// Relay parity contract v1.0.1: what a 4.3 companion adds reads as the local collector's fields.
const flowWeek={step:2520,start:t-604800,end:t,as_of:t,reported:true,bins:Array.from({length:240},(_,i)=>({Codex:i})) };
const full=device('d4','Workstation',[session('w1',{title:'Fix the checkout total',effort:'high',effort_source:'codex_turn_context',effort_updated:t-60,last_usage:t-30,request_input:1200,context_size:400000,
  terminal_note:'note',pids:[4242],usage:{last_minute:vec(1),last_five_minutes:vec(4),output_rate:.5,history:[[t-60,9],[t,10]]},capabilities:['focus','rename'],
  windows:{'1h':vec(5),'custom:604800':vec(50)},weekly_estimate:{'custom:604800':{used_pp:4,partial:false,period_seconds:604800,tokens:150,account_id:'claude:abc123',calibration:{pp_per_token:.02,seconds:3600,used_pp:1,tokens:50}}}})],
 {features:['history','account_alias'],periods:[{key:'1h',label:'1h',tokens:vec(100),partial:false,observed_seconds:3600},{key:'custom:604800',seconds:604800,label:'',tokens:vec(1000),partial:true,observed_seconds:400000}],
  flow:{'custom:604800':flowWeek},host:{cpu:40,used_memory:8,total_memory:32,cores:16,network:{rx:10,tx:20,interfaces:['Ethernet']},disk:{total:100,free:40,percent:60,read:1,write:2},
   swap:{used:1,total:4},load:[1,2,3],uptime:9000,battery:null,process_count:300,unreadable_processes:2,platform:'Windows',os:'Windows 11'},
  system:{sampler_ms:30,monitor:{pid:7,cpu:1.5,rss:100},history:[{t:t-3,cpu:20,memory:30,rx:1,tx:2},{t,cpu:22,memory:31,rx:1,tx:2}],top:[{pid:1,ppid:0,name:'node',created:t-9,cpu:9,rss:5}],shared:[{pid:2,ppid:1,name:'codex',created:t-9,cpu:3,rss:6,id:'backend:2',count:4,pids:[2,3]}]},
  collection_ms:120,actions:[{t:t-30,action:'pause',sid:'w1',terminal:'T',project:'web',message:'done'}],resume_prompt:'Please continue.',quotas:[{kind:'GLM',plan:'',updated:t,stale:true,note:'n',windows:[]}],
  orca_terminals:1,process_counts:{Codex:2},account_quotas:[{id:'claude:abc123',kind:'Claude',account_label:'Claude · abc123',plan:'max',updated:t-5,stale:false,note:'',windows:[],weekly:{},usage_points:[],calibration:{pp_per_token:.02,seconds:3600,used_pp:1,tokens:50}}]});
const one=remoteState([full],{now,period:'custom:604800'}),w1=one.sessions[0];
assert.equal(w1.title,'Fix the checkout total');assert.equal(remoteState([a],{now}).sessions[0].title,'');assert.equal(w1.cwd,'Workstation');
assert.deepEqual([w1.effort_source,w1.last_usage,w1.request_input,w1.context_size,w1.terminal_note,w1.pids,w1.resources.pids],['codex_turn_context',t-30,1200,400000,'note',[4242],[4242]]);
assert.deepEqual(w1.usage.history,[[t-60,9],[t,10]]);assert.equal(w1.usage.output_rate,.5);assert.deepEqual(w1.usage.last_five_minutes,vec(4));
assert.equal(w1.usage.weekly_estimate['custom:604800'].calibration.tokens,50);assert.ok(w1.capabilities.includes('rename'));
// A range the computer reports reads like the six: its total, its own bins and bounds, every computer counted.
const weekWindow=one.period_usage.windows.at(-1);assert.deepEqual(weekWindow.tokens,vec(1000));assert.equal(weekWindow.partial,true);assert.equal(weekWindow.observed_seconds,400000);
assert.deepEqual(one.chart_range,{start:t-604800,end:t,step:2520});assert.equal(one.events.reduce((n,e)=>n+e.n,0),239*240/2);
assert.equal(measure(one,'custom:604800',t).computers,1);assert.equal(one.workspace_usage.devices.length,0);
// One computer's host, collector and log as reported; ids in the log carry the computer.
assert.deepEqual([one.system.host.load,one.system.host.uptime,one.system.host.process_count,one.system.host.os,one.system.host.swap.total,one.system.host.disk.percent],[[1,2,3],9000,300,'Windows 11',4,60]);
assert.equal(one.system.history.length,2);assert.equal(one.system.top[0].name,'node');assert.equal(one.system.shared[0].count,4);assert.equal(one.system.monitor.cpu,1.5);
assert.deepEqual([one.collection_ms,one.resume_prompt,one.orca_terminals,one.process_counts.Codex,one.quotas[0].kind,one.actions[0].sid],[120,'Please continue.',1,2,'GLM','d4:w1']);
assert.equal(one.weekly_usage.accounts[0].calibration.tokens,50);
// Several computers: load and uptime belong to one; processes name their computer; samples line up by time.
const both=remoteState([full,{...full,id:'d5',name:'Laptop'}],{now});
assert.equal(both.system.host.load,null);assert.equal(both.system.host.process_count,600);assert.equal(both.system.top[0].name,'node · Workstation');assert.equal(both.system.history.length,2);
assert.equal(both.system.monitor.cpu,3);assert.equal(both.orca_terminals,2);
// Histories of several computers add up by bins; a computer with other bins is left out.
const hist=(total,bins=[0,3600])=>({as_of:t,coverage:[{source:'collector'}],series:{start:0,end:7200,step:'3600',bins,total,by_model:[{key:'m',kind:'Claude',tokens:total}],by_project:[]},heatmap:{hours:[['2026-10-30',1,total[0]]],days:[['2026-10-30',total[0]]]}});
const merged=mergeHistory([{data:hist([1,null])},{data:hist([2,3])},{data:hist([5,5],[60,3660])}]);
assert.deepEqual(merged.series.total,[3,3]);assert.deepEqual(merged.series.by_model[0].tokens,[3,3]);assert.deepEqual(merged.heatmap.days,[['2026-10-30',3]]);

// The dashboard markup the site edits is still where the site expects it.
const {assets,body}=dashboardMarkup();
for(const id of ['remoteScope','remoteIdentity','remoteSignOut','remoteNotice','remoteComputers','remoteDisconnect','remoteDisconnectConfirm','helpButton','localVersion'])assert.ok(body.includes(`id="${id}"`),id);
assert.ok(assets.indexOf('dashboard/dashboard.js')<assets.indexOf('dashboard/app.js'));
assert.ok(dashboardFiles().includes('app.js')&&dashboardFiles().includes('benchmark.json'));

// The demo relay reports through the same adapter and answers controls like a computer.
const {demoRelay}=await import('../site/src/remote-demo.js');
const demo=demoRelay(),demoState=remoteState(demo.devices(),{tag:'DEMO'});
assert.ok(demoState.root_sessions.length>10);assert.ok(demoState.events.length>0);assert.ok(demoState.account_quotas.length===4);
const target=demo.devices()[0].snapshot.sessions.find(s=>s.status==='working');
const result=new Promise(done=>demo.onResult(done));
assert.equal((await demo.send({action:'pause',request_id:'r1',device_id:demo.devices()[0].id,session_id:target.id,control_key:'demo'})).status,'sent');
assert.equal((await result).status,'completed');
assert.equal(remoteState(demo.devices()).sessions.find(s=>s.source_id===target.id&&s.device_id==='demo-0').display_status,'paused');
// The demo relay carries the same fields and answers history, renames and account names.
const snap=demo.devices()[0].snapshot,keys=snap.periods.map(p=>p.key);
assert.deepEqual(snap.features,['history','account_alias']);assert.equal(keys.length,19);assert.ok(['custom:604800','custom:31536000','all'].every(k=>keys.includes(k)&&snap.flow[k]?.bins.length<=240));
assert.ok(snap.sessions.find(s=>s.tokens).windows['custom:2592000'].some(n=>n>0));assert.equal(snap.system.history.length,300);assert.ok(snap.host.swap.total>0&&snap.collection_ms>0&&snap.actions.length>=2);
const demoWeek=remoteState(demo.devices(),{period:'custom:604800'});assert.ok(demoWeek.events.length>0&&demoWeek.chart_range.step>=60&&demoWeek.period_usage.windows.at(-1).tokens.some(n=>n>0));
const history=await demo.history({device_id:'demo-0',period:'custom:604800',step:'3600'});
assert.equal(history.series.bins.length,history.series.total.length);assert.ok(history.series.by_project.every(r=>r.key.startsWith('project:')));assert.ok(history.heatmap.hours.length>=720);
const orca=demo.devices()[0].snapshot.sessions.find(s=>s.capabilities.includes('rename'));
const renamed=new Promise(done=>demo.onResult(m=>{if(m.request.action==='rename')done(m);}));
await demo.send({action:'rename',request_id:'r2',device_id:'demo-0',session_id:orca.id,control_key:orca.control_key,title:'Renamed tab'});
assert.match((await renamed).message,/Renamed tab/);assert.equal(demo.devices()[0].snapshot.sessions.find(s=>s.id===orca.id).terminal,'Renamed tab');
const named=new Promise(done=>demo.onResult(m=>{if(m.request.action==='account_alias')done(m);}));
await demo.alias({request_id:'r3',device_id:'demo-0',account_id:'demo-claude-4f1c2a',alias:'Main'});await named;
assert.equal(demo.devices()[0].snapshot.account_quotas.find(q=>q.id==='demo-claude-4f1c2a').alias,'Main');
// Disconnecting a demo computer takes it off this page only.
await demo.revoke('demo-1');assert.deepEqual(demo.devices().map(d=>d.id),['demo-0','demo-2']);
console.log('Remote workspace: relay snapshots as the collector state, trees, scope, periods, flow, speed, accounts, markup, contract v1.0.1 fields, history merge, demo relay requests and disconnecting passed.');
process.exit(0);
