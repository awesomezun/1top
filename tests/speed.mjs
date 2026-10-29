import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{measure,niceMax}=require('../agent/onetop/dist/speed.js');
const now=1e9;
const state={updated:now,started:now-3600,history_started:now-3600,
 period_usage:{known_kinds:['Codex','Claude'],windows:[{key:'1h',seconds:3600,tokens:[18000,18000,0,0]},{key:'all',seconds:3600,tokens:[36000,0,0,0]}]},
 sessions:[{tokens:[999999999,0,0,0]}],root_sessions:[{tokens:[999999999,0,0,0]}]};
assert.equal(measure(state,'1h',now).rate,10);
const remote={id:'two',received:now*1000,online:true,periods:[{key:'1h',seconds:3600,tokens:72000,known:true},{key:'all',seconds:7200,tokens:72000,known:true}]};
state.workspace_usage={devices:[remote,remote,{...remote,id:'offline',online:false},{...remote,id:'stale',received:(now-91)*1000}]};
assert.deepEqual([measure(state,'1h',now).rate,measure(state,'1h',now).tokens,measure(state,'1h',now).computers],[30,108000,2]);
assert.equal(measure(state,'all',now).rate,15); // Common elapsed horizon, not sum of computer-hours.
state.workspace_usage.devices=[{...remote,periods:[]}];
assert.equal(measure(state,'1h',now).partial,true);
assert.equal(measure(state,'1h',now).expected,2);
assert.equal(measure(state,'1h',now).rate,10);
state.workspace_usage.devices=[];state.updated=now-21;
assert.equal(measure(state,'1h',now).rate,null);
state.updated=now;state.period_usage.windows[0].tokens=[0,0,0,0];
assert.equal(measure(state,'1h',now).rate,0);
state.period_usage.known_kinds=[];
assert.equal(measure(state,'1h',now).rate,null);
for(const n of [0,.3,1,3,10,90,999,12345,1e8])assert(niceMax(n)>=n);
console.log('Fleet speed: period totals, normalized rates, multi-device deduplication, offline/stale/missing coverage and all-history horizon passed.');
