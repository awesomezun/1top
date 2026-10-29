// 1top.si /app: relay snapshots become the desktop collector's /api/state for the unchanged dashboard,
// the demo relay goes through the same adapter, and the dashboard markup the site edits is still there.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {remoteState,findSession} from '../site/src/remote-adapter.js';
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

// The dashboard markup the site edits is still where the site expects it.
const {assets,body}=dashboardMarkup();
for(const id of ['remoteScope','remoteIdentity','remoteSignOut','remoteNotice','remoteComputers','helpButton','localVersion'])assert.ok(body.includes(`id="${id}"`),id);
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
console.log('Remote workspace: relay snapshots as the collector state, trees, scope, periods, flow, speed, accounts, markup and demo relay passed.');
process.exit(0);
