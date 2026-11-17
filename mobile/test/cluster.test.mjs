import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const {clusterState,readings,marks,tachMarks,feverLevel,burnMarks,burnLevel,rangeText,RECONNECT}=await import('../src/cluster-model.ts');
const {demoDevices,setDemoNow}=await import('../src/demo.ts');
const {remoteState}=await import('../../site/src/remote-adapter.js');
const require=createRequire(import.meta.url),desktop=require('../../agent/onetop/dist/cluster.js'),speed=require('../../agent/onetop/dist/speed.js'),weekly=require('../../agent/onetop/dist/weekly.js');
const display=s=>(s.children_working||0)>0?'working':s.display_status||s.status;

// What the cluster shows: every figure the dials, the window, the lights, the fuel, the gauge and the trip read.
const view=r=>({tach:[r.tach.rate,r.tach.max,r.tach.full,r.tach.tokens,r.tach.instant,r.tach.climb,r.tach.computers,r.tach.expected,JSON.stringify(r.tach.byKind)],
 speed:[r.speed.value,r.speed.cruise,r.speed.max,r.speed.account,r.speed.session,r.speed.picked,r.speed.subject?.type??null,r.speed.subject?.id??null,JSON.stringify(r.speed.multi),JSON.stringify(r.speed.reach)],
 accounts:r.accounts.map(a=>[a.id,a.kind,a.plan,a.who,a.pct,a.left,a.reset,a.current,a.reconnect,a.burn,a.added,a.weekly,a.range?.state??null,a.range?.at??null]),
 sessions:r.sessions.map(s=>[s.id,s.kind,s.state,s.tokens,s.estimate,s.burn,s.account]),working:r.working,
 tells:r.tells,heat:r.heat.value,trip:r.trip&&[r.trip.start,r.trip.tokens,r.trip.rate,r.trip.inRange,JSON.stringify(r.trip.accounts)]});
const phone=(devices,period,now,o={})=>{const state=clusterState(devices,now*1000);return readings(state,{period,now,...o});};
const web=(devices,period,now,o={})=>{const state=remoteState(devices,{period,now:now*1000});
 return desktop.readings(state,{period,now,speed,weekly,reconnect:RECONNECT,display,sessions:state.root_sessions,...o});};

test('the phone cluster reads the same numbers as the desktop and web cluster from the same reports',()=>{
 for(const at of [1_800_000_000,1_800_000_037]){
  setDemoNow(at);const devices=demoDevices();
  for(const period of ['10m','30m','1h','5h','12h','24h']){
   const a=phone(devices,period,at,{trip:at-5400}),b=web(devices,period,at,{trip:at-5400});
   assert.deepEqual(view(a),view(b),period+' at '+at);
  }
  // A picked account and a picked session read the same, and a picked session that is gone falls back.
  const base=web(devices,'1h',at),account=base.accounts.find(x=>x.id!==base.speed.account&&Number.isFinite(x.burn)),session=base.sessions.find(s=>Number.isFinite(s.burn)&&s.burn>0);
  assert.ok(account&&session,'the demo has a second burning account and a burning session');
  for(const pick of [{type:'account',id:account.id},{type:'session',id:session.id},{type:'session',id:'gone'}])
   assert.deepEqual(view(phone(devices,'1h',at,{pick})),view(web(devices,'1h',at,{pick})),JSON.stringify(pick));
  // A pressed warning shows only its sessions on both.
  for(const only of ['working','waiting','done'])assert.deepEqual(view(phone(devices,'1h',at,{only})),view(web(devices,'1h',at,{only})),only);
 }
 setDemoNow(null);
});

test('the phone demo shows the web demo cluster at the same moment',async()=>{
 const at=1_800_000_000;setDemoNow(at);globalThis.setInterval=()=>0;
 const {demoRelay}=await import('../../site/src/remote-demo.js'),site=demoRelay({demoNow:at}).devices(),devices=demoDevices();
 for(const period of ['10m','1h','24h'])assert.deepEqual(view(phone(devices,period,at,{trip:at-3600})),view(web(site,period,at,{trip:at-3600})),period);
 // The demo lights what it should: tools at work, a session waiting, a context nearly full, and the readings live.
 const r=phone(devices,'1h',at);
 assert.ok(r.tells.kinds.length>=2&&r.tells.waiting.length>=1&&r.tells.context.length>=1&&r.tells.fresh,JSON.stringify(r.tells));
 assert.ok(Number.isFinite(r.speed.value)&&r.speed.value>0&&Number.isFinite(r.tach.instant)&&r.tach.instant>0);
 setDemoNow(null);
});

test('the token dial runs to 200M and breaks its limit in 100M steps, as the desktop does',()=>{
 const devices=demoDevices(),now=1800000000,state=clusterState(devices,now*1000);
 for(const [rate,full,level] of [[0,2e8,0],[1.5e8,2e8,0],[2e8,2e8,0],[2.3e8,3e8,1],[3.7e8,4e8,2],[4.7e8,5e8,3],[6.5e8,7e8,3]]){
  const r=readings(state,{period:'1h',now,rate});assert.equal(r.tach.full,full,`${rate/1e6}M`);assert.equal(feverLevel(r.tach.full),level);}
 // A period's scale holds while it stays: after 470M an hour, 100M still reads on 500M.
 const hold={};readings(state,{period:'1h',now,rate:4.7e8,hold});assert.equal(readings(state,{period:'1h',now,rate:1e8,hold}).tach.full,5e8);
 // Numbers: the desktop's below 200M; past it hundreds of millions, at most six steps, the full scale always marked.
 for(const [full,div,major] of [[2e8,1e6,50],[3e8,1e6,100],[5e8,1e6,100],[6e8,1e6,100],[7e8,1e6,200],[1.2e9,1e9,.2]])assert.equal(tachMarks(full,div).major,major,`${full/1e6}M`);
 assert.deepEqual(tachMarks(7e8,1e6),{max:700,major:200,minor:40});
});
test('the burn dial keeps 2, 5, 10, 20 and breaks its 20%/h limit in steps of 20, as the desktop does',()=>{
 const devices=demoDevices(),now=1800000000,state=clusterState(devices,now*1000);
 for(const [burn,max,level] of [[.5,2,0],[3,5,0],[15,20,0],[20,20,0],[25,40,1],[45,60,2],[61,80,3],[85,100,3]]){
  const r=readings(state,{period:'1h',now,burn});assert.equal(r.speed.max,max,`${burn}%/h`);assert.equal(burnLevel(r.speed.max),level,`${burn}%/h level`);}
 // The scale holds while the period and subject stay: after 65%/h, 10%/h still reads on 80.
 const hold={};readings(state,{period:'1h',now,burn:65,hold});assert.equal(readings(state,{period:'1h',now,burn:10,hold}).speed.max,80);
 // Numbers: the desktop's to 20; past it tens, twenties, fifties, at most six steps, the full scale always marked.
 for(const [max,major] of [[20,5],[40,10],[60,10],[80,20],[100,20],[120,20],[140,50]])assert.equal(burnMarks(max).major,major,`${max}%/h`);
 assert.deepEqual(burnMarks(20),marks(20));assert.deepEqual(burnMarks(140),{max:140,major:50,minor:10});
});
test('the dials use the desktop scale marks',()=>{
 for(const max of [2e8,1e8,5e7,2,3,5,10])assert.deepEqual(marks(max),desktop.marks(max));
});

test('burn and the cruise belong to a weekly window of an account whose identity is not unverified',async()=>{
 const {accountWindow,burnAllowed}=await import('../src/cluster-model.ts');
 const week={label:'주간',pct:40,reset:1},five={label:'5시간',pct:20,reset:1};
 assert.equal(accountWindow({windows:[five,week]}),week);
 assert.equal(burnAllowed({},week),true);
 assert.equal(burnAllowed({identity_verified:false},week),false);
 assert.equal(burnAllowed({},five),false);
 const at=1_800_000_000;setDemoNow(at);const devices=demoDevices(),q=devices[0].snapshot.account_quotas[0];q.identity_verified=false;
 const a=phone(devices,'1h',at).accounts.find(x=>x.id===q.id);
 assert.deepEqual([a.burn,a.added],[null,null]);
 setDemoNow(null);
});

// The range rolls on the odometer's drum in the web's shape: one decimal under 10, whole hours to 999, two dashes unread.
test('range as the drum shows it',()=>{
 assert.deepEqual([4.62,9.94,9.96,23.4,140,1200,null,undefined,-1,Number.NaN].map(rangeText),['4.6','9.9','10','23','140','999','--','--','--','--']);
});

