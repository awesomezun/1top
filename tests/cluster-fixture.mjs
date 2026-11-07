// Writes the demo collector's /api/state and the dashboard cluster's readings of it (cluster.js) into a
// folder, for tests/desktop/ClusterChecks.swift: the menu bar's cluster must read the same numbers.
// node tests/cluster-fixture.mjs <folder>
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {demoState} from '../scripts/demo-state.mjs';
const require=createRequire(import.meta.url),speed=require('../agent/onetop/dist/speed.js'),weekly=require('../agent/onetop/dist/weekly.js');
const {readings}=require('../agent/onetop/dist/cluster.js');
const RECONNECT=new Set(['login_required','login_expired','credential_store_unavailable','access_denied']);
const display=s=>(s.children_working||0)>0?'working':s.display_status||s.status;
const dir=process.argv[2];if(!dir)throw new Error('usage: node tests/cluster-fixture.mjs <folder>');
mkdirSync(dir,{recursive:true});
const now=1800000000,cases=[];
for(const period of ['1h','10m','24h']){
 const state=demoState(now,{period}),sessions=state.root_sessions??state.sessions;
 const accounts=state.account_quotas.map(q=>q.id),busy=sessions.find(s=>display(s)==='working')?.id??null;
 // Nothing picked (every AI), an account, a session, and a warning's filter of the session window.
 for(const [pick,only] of [[null,null],[accounts[1]?{type:'account',id:accounts[1]}:null,null],[busy?{type:'session',id:busy}:null,null],[null,'waiting']]){
  const r=readings(state,{period,now,speed,weekly,reconnect:RECONNECT,display,sessions,pick,only,trip:now-10800});
  const reach=r.speed.reach;
  cases.push({period,pick,only,state:`state-${period}.json`,expected:{tach:{rate:r.tach.rate,max:r.tach.max,full:r.tach.full,tokens:r.tach.tokens,instant:r.tach.instant},
   speed:{value:r.speed.value,cruise:r.speed.cruise,max:r.speed.max,subject:r.speed.subject?.type??null,subjectAccount:r.speed.subject?.account??null,count:r.speed.subject?.count??0,
    picked:r.speed.picked,account:r.speed.account,session:r.speed.session,multi:(r.speed.multi||[]).map(m=>[m.id,m.value]),
    reach:{state:reach.state??'hours',hours:reach.hours??null,early:!!reach.early,account:reach.account??null}},
   accounts:r.accounts.map(a=>({id:a.id,pct:a.pct,left:a.left,burn:a.burn,added:a.added,reconnect:a.reconnect,weekly:a.weekly,range:a.range?.state??null})),
   sessions:r.sessions.map(s=>[s.id,s.burn]),working:r.working,
   tells:{kinds:r.tells.kinds.map(k=>[k.kind,k.working]),waiting:r.tells.waiting,reconnect:r.tells.reconnect,empty:r.tells.empty,done:r.tells.done,context:r.tells.context,stalled:r.tells.stalled,fresh:r.tells.fresh},
   heat:r.heat.value,trip:r.trip?{tokens:r.trip.tokens,rate:r.trip.rate,inRange:r.trip.inRange,accounts:r.trip.accounts.map(a=>[a.id,a.used])}:null}});
  writeFileSync(join(dir,`state-${period}.json`),JSON.stringify(state));
 }
}
writeFileSync(join(dir,'cases.json'),JSON.stringify({now,cases}));
console.log(`${cases.length} cluster cases written to ${dir}`);
