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

// Limits agree with the tokens behind them: the sessions' estimates add up to no more than the account's
// period, the periods shrink from a day to an hour, a day is a plausible part of the week, and the weekly
// percent itself comes from the tokens of its window.
function limits(name,accounts){
 for(const {id,weekly,periods,sessions} of accounts){
  const at=k=>periods[k];
  for(const k of ['24h','5h','1h'])assert.ok(sessions(k)<=at(k)+1e-3,`${name} ${id} ${k}: sessions ${sessions(k)} > account ${at(k)}`);
  assert.ok(at('24h')+1e-3>=at('5h')&&at('5h')+1e-3>=at('1h'),`${name} ${id}: ${at('24h')} ≥ ${at('5h')} ≥ ${at('1h')}`);
  assert.ok(at('24h')<=weekly+.05,`${name} ${id}: a day ${at('24h')} > weekly ${weekly}`);
  assert.ok(weekly>0&&at('24h')/weekly>=.05&&at('24h')/weekly<=.5,`${name} ${id}: a day is ${Math.round(at('24h')/weekly*100)}% of the week`);
 }
}
const realNow=Date.now;
for(const start of [1800000000,1800040000,1800130000,1800333000,1801000000]){
 Date.now=()=>start*1000;const d=demoRelay().devices();Date.now=realNow;
 const quotas=new Map(d.flatMap(x=>x.snapshot.account_quotas).map(q=>[q.id,q])),shown=d.flatMap(x=>x.snapshot.sessions);
 for(const q of quotas.values())assert.ok(q.windows.every(w=>Number.isInteger(w.pct))&&q.usage_points.every(p=>Number.isInteger(p[1])),'web '+q.id+': whole percent limits');
 limits('web '+start,[...quotas.values()].map(q=>({id:q.id,weekly:q.windows.find(w=>w.label==='Weekly').pct,periods:Object.fromEntries(Object.entries(q.weekly).map(([k,v])=>[k,v.used_pp])),
  sessions:k=>shown.filter(s=>s.weekly_account===q.id).reduce((n,s)=>n+s.weekly_estimate[k].used_pp,0)})));
}

// The invented collector answers with every key the real one does (tests/collector-keys.json), and its
// limits follow the same rules.
const {demoState,demoHistory}=await import('../scripts/demo-state.mjs');
const {readFileSync}=await import('node:fs');
const expected=JSON.parse(readFileSync(new URL('./collector-keys.json',import.meta.url),'utf8'));
function paths(v,prefix='',out=new Set(),parent=''){
 if(Array.isArray(v)){for(const x of v)if(x&&typeof x==='object')paths(x,prefix+'[]',out,parent);}
 else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){
  const key=/^(10m|30m|1h|5h|12h|24h|all|custom:\d+)$/.test(k)?'<period>':['recent','process_counts','by_kind'].includes(parent)?'<kind>':k,p=prefix?prefix+'.'+key:key;
  out.add(p);paths(x,p,out,k);}
 return out;
}
for(const now of [1800000000,1800333000]){
 const state=demoState(now,{period:'1h'}),missing=expected.state.filter(p=>!paths(state).has(p));
 assert.deepEqual(missing,[],'keys the demo state lacks');
 assert.deepEqual(expected.history.filter(p=>!paths(demoHistory(now,{period:'1h',step:'60'})).has(p)),[],'keys the demo history lacks');
 const statuses=new Set(state.sessions.map(s=>s.display_status));
 for(const s of ['working','waiting','paused','idle','unknown'])assert.ok(statuses.has(s),'a '+s+' session');
 assert.ok(state.sessions.some(s=>s.is_subagent)&&state.sessions.some(s=>s.orca_terminal)&&state.root_sessions.some(s=>s.children_count>0));
 const weekly=state.weekly_usage.accounts;
 // Limits arrive in whole percent, as providers report them; estimates and period use stay fractional.
 for(const q of state.account_quotas)assert.ok(q.windows.every(w=>Number.isInteger(w.pct)),q.id+': whole percent windows');
 for(const a of weekly)assert.ok(a.usage_points.every(p=>Number.isInteger(p[1]))&&a.history.every(p=>Number.isInteger(p[1])),a.id+': whole percent history');
 assert.ok(state.sessions.some(s=>Object.values(s.usage.weekly_estimate).some(e=>!Number.isInteger(e.used_pp))),'session estimates stay fractional');
 limits('state '+now,state.account_quotas.map(q=>({id:q.id,weekly:q.windows.find(w=>w.label==='주간').pct,periods:Object.fromEntries(Object.entries(weekly.find(a=>a.id===q.id).periods).map(([k,v])=>[k,v.used_pp])),
  sessions:k=>state.sessions.filter(s=>s.usage.weekly_account===q.id).reduce((n,s)=>n+s.usage.weekly_estimate[k].used_pp,0)})));
 // A long period arrives in 240 bins with its range, as the collector sends it.
 const week=demoState(now,{period:'custom:604800'});
 assert.equal(week.chart_range.step,2520);assert.ok(week.period_usage.windows.some(w=>w.key==='custom:604800'));
 // The history: every bin's models and projects add up to its total, and more than 400 bins is refused.
 const history=demoHistory(now,{period:'24h',step:'900'}),s=history.series;
 s.total.forEach((t,i)=>{if(t===null)return;for(const rows of [s.by_model,s.by_project])assert.equal(rows.reduce((n,r)=>n+r.tokens[i],0),t);});
 assert.equal(history.heatmap.hours.length,720);assert.equal(demoHistory(now,{period:'24h',step:'60'}).status,400);
}
console.log('Demo usage: shared check values, the shape of a day, a relay whose periods, flow and limits agree, and an invented collector with every real key passed.');
process.exit(0);
