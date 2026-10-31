import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const {clusterState,readings,marks,RECONNECT}=await import('../src/cluster-model.ts');
const {demoDevices,setDemoNow}=await import('../src/demo.ts');
const {remoteState}=await import('../../site/src/remote-adapter.js');
const require=createRequire(import.meta.url),desktop=require('../../agent/onetop/dist/cluster.js'),speed=require('../../agent/onetop/dist/speed.js'),weekly=require('../../agent/onetop/dist/weekly.js');
const display=s=>(s.children_working||0)>0?'working':s.display_status||s.status;

// What the cluster shows: every figure the dials, the window, the lights, the fuel, the gauge and the trip read.
const view=r=>({tach:[r.tach.rate,r.tach.max,r.tach.tokens,r.tach.instant,r.tach.climb,r.tach.computers,r.tach.expected,JSON.stringify(r.tach.byKind)],
 speed:[r.speed.value,r.speed.recent,r.speed.cruise,r.speed.max,r.speed.account,r.speed.session,r.speed.picked,r.speed.subject?.id??null],
 accounts:r.accounts.map(a=>[a.id,a.kind,a.plan,a.who,a.pct,a.left,a.reset,a.current,a.reconnect,a.burn,a.added,a.range?.state??null,a.range?.at??null]),
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
