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
 const accounts=state.account_quotas.map(q=>q.id);
 for(const pick of [null,accounts[1]??null]){
  const r=readings(state,{period,now,speed,weekly,reconnect:RECONNECT,display,sessions,pick:pick?{type:'account',id:pick}:null,trip:now-10800});
  cases.push({period,pick,state:`state-${period}.json`,expected:{tach:{rate:r.tach.rate,max:r.tach.max,tokens:r.tach.tokens,instant:r.tach.instant},
   speed:{value:r.speed.value,recent:r.speed.recent,cruise:r.speed.cruise,max:r.speed.max,account:r.speed.subject?.account??null,picked:r.speed.picked},
   accounts:r.accounts.map(a=>({id:a.id,pct:a.pct,left:a.left,burn:a.burn,reconnect:a.reconnect,range:a.range?.state??null})),
   tells:{kinds:r.tells.kinds.map(k=>[k.kind,k.working]),waiting:r.tells.waiting,reconnect:r.tells.reconnect,empty:r.tells.empty,context:r.tells.context,stalled:r.tells.stalled,fresh:r.tells.fresh},
   heat:r.heat.value,trip:r.trip?{tokens:r.trip.tokens,rate:r.trip.rate,inRange:r.trip.inRange,accounts:r.trip.accounts.map(a=>[a.id,a.used])}:null}});
  writeFileSync(join(dir,`state-${period}.json`),JSON.stringify(state));
 }
}
writeFileSync(join(dir,'cases.json'),JSON.stringify({now,cases}));
console.log(`${cases.length} cluster cases written to ${dir}`);
