// Demo token use (site/src/demo-usage.js) has the shape of real use and gives the numbers the phones give
// (mobile/test/parity.test.mjs, ios/OneTopTests/DemoUsageTests.swift), and the /app?demo relay built on
// it reports periods, flow, sessions and limits that agree with each other.
import assert from 'node:assert/strict';
import {unit,usage,since,bins,computerMinutes,UNIT_CHECK} from '../site/src/demo-usage.js';

assert.deepEqual(UNIT_CHECK.map(([a,b,c])=>unit(a,b,c)),[0.638385457219556,0.416402937611565,0.8966296215076,0.9844421946909279]);
const now=1800000000.5,u=usage(23,1.2e6,[{weight:52,start:0,stop:Infinity},{weight:12,start:0,stop:now-3000}],now,now-600);
assert.deepEqual([since(u,0,now-3600),since(u,1,now-86400),since(u,0,now-600)].map(Math.round),[92181344,292954505,8620266]);
// Resting with another computer, working less often, and no waking hour around the start.
const quiet=usage(23,1.2e6,[{weight:52,start:0,stop:Infinity},{weight:12,start:0,stop:now-3000}],now,now-600,7,.4,false);
assert.deepEqual([since(quiet,0,now-86400),since(quiet,1,now-86400)].map(Math.round),[513711382,161355472]);
assert.deepEqual(bins(u,['Claude','Codex'],now,3600,300).bins.slice(-4),[{Claude:1511996},{Claude:1823151},{Claude:7315948},{Claude:3781}]);
// A stopped session takes nothing after it stopped.
assert.equal(since(u,1,now-3000),0);

// The shape of a day on three computers: about two thirds of minutes active, pauses, resting hours, a long tail.
for(const seed of [23,37,61]){
 const last=Math.floor(now/60),minutes=computerMinutes(seed,1.3e6,last-1439,last),active=minutes.filter(n=>n>0).sort((a,b)=>a-b);
 const share=active.length/minutes.length,hours=Array.from({length:24},(_,h)=>minutes.slice(h*60,h*60+60).reduce((a,b)=>a+b,0));
 assert.ok(share>.45&&share<.8,`seed ${seed}: ${share}`);
 assert.ok(hours.some(n=>n===0)||hours.some(n=>n<Math.max(...hours)*.1),`seed ${seed}: a quiet hour`);
 assert.ok(active.at(-1)>active[Math.floor(active.length/2)]*5,`seed ${seed}: a long tail`);
 let pauses=0;for(let i=1;i<minutes.length;i++)if(!minutes[i]&&minutes[i-1])pauses++;
 assert.ok(pauses>25,`seed ${seed}: work stops and starts (${pauses})`);
}

// The demo relay: the 1-hour period equals its flow, one tool carries most of the day, totals only grow.
globalThis.setInterval=()=>0;
const {demoRelay}=await import('../site/src/remote-demo.js');
const devices=demoRelay().devices(),byKind={};
for(const d of devices){
 const s=d.snapshot,hour=s.periods.find(p=>p.key==='1h').tokens.reduce((a,b)=>a+b,0),flow=s.flow['1h'].bins.reduce((n,b)=>n+Object.values(b).reduce((a,c)=>a+c,0),0);
 assert.ok(Math.abs(hour-flow)<=Math.max(60,hour*.05),`${d.name}: 1h ${hour} vs flow ${flow}`);
 for(const b of s.flow['24h'].bins)for(const [k,v] of Object.entries(b))byKind[k]=(byKind[k]||0)+v;
 for(const q of s.account_quotas){const points=q.usage_points.map(p=>p[1]);assert.ok(points.every((p,i)=>!i||p>=points[i-1]-1e-9),q.id+' rises only');}
}
const all=Object.values(byKind).reduce((a,b)=>a+b,0);
assert.ok(byKind.Claude/all>.6&&byKind.Codex/all<.3,JSON.stringify(byKind));
console.log('Demo usage: shared check values, the shape of a day, and a relay whose periods, flow and limits agree passed.');
process.exit(0);
