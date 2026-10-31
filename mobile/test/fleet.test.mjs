import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const {periodTokens,fleetFlow,fleetQuotas,hasEstimate,reporting,hourly,short}=await import('../src/fleet.ts');
const now=Date.now();
const dev=(id,extra={})=>({id,name:id,online:true,received:now,snapshot:{sessions:[],host:{},...extra}});
const s=w=>({windows:{'1h':w}});
test('period totals keep ended sessions; a computer without them falls back to its sessions',()=>{
 const a=dev('a',{periods:[{key:'1h',tokens:[100,200,0,0]}],sessions:[s([10,0,0,0])]}),b=dev('b',{sessions:[s([5,5,0,0]),s(null)]});
 assert.equal(periodTokens([a,b],'1h'),310);
 assert.equal(periodTokens([dev('c')],'1h'),null);
});
test('flow is summed on real time, and a bin a computer did not report stays unknown',()=>{
 const fa=dev('fa',{flow:{'1h':{step:60,start:0,end:180,bins:[{Claude:1},{Claude:2},{Codex:3}]}}});
 const fb=dev('fb',{flow:{'1h':{step:60,start:60,end:180,bins:[{Claude:10},{Codex:20}]}}});
 assert.deepEqual(fleetFlow([fa,fb],'1h').bins,[null,{Claude:12},{Codex:23}]);
 // A computer that reported one bin later: the axis ends where both have reported.
 const late=dev('late',{flow:{'1h':{step:60,start:120,end:240,bins:[{Claude:10},{Codex:20}]}}});
 const merged=fleetFlow([fa,late],'1h');
 assert.equal(merged.end,180);
 assert.deepEqual(merged.bins,[null,null,{Codex:3,Claude:10}]);
 assert.equal(fleetFlow([fa,dev('x')],'1h'),undefined);
 assert.equal(fleetFlow([fa,dev('y',{flow:{'1h':{step:300,start:0,bins:[{Claude:1}]}}})],'1h'),undefined);
});
test('each account once, the fresh report wins',()=>{
 const q=(id,updated,stale)=>({id,updated,stale,windows:[]});
 const qs=fleetQuotas([dev('q1',{account_quotas:[q('A',10,true),q('B',5,false)]}),dev('q2',{account_quotas:[q('A',8,false),q('B',9,false)]})]);
 assert.deepEqual(qs.map(x=>[x.id,x.updated]),[['A',8],['B',9]]);
});
test('an empty or non-numeric weekly estimate is not an estimate',()=>{
 assert.equal(hasEstimate({weekly_estimate:{}}),false);
 assert.equal(hasEstimate({weekly_estimate:{'1h':{used_pp:null}}}),false);
 assert.equal(hasEstimate({weekly_estimate:{'1h':{used_pp:0.4}}}),true);
});
test('stale computers drop out while any is fresh; otherwise the last reports stand in',()=>{
 const a=dev('a'),old={...dev('old'),received:now-120000};
 assert.deepEqual(reporting([a,old]).map(d=>d.id),['a']);
 assert.deepEqual(reporting([old]).map(d=>d.id),['old']);
});
test('session speed is the period average per hour',()=>{
 assert.equal(hourly({windows:{'5h':[50000,0,0,0]}},'5h'),10000);
 assert.equal(short(hourly({windows:{'10m':[1000,0,0,0]}},'10m')),'6k');
 assert.equal(hourly({windows:{}},'1h'),null);
});

// Agy pools and GLM (provider-quotas-contract v1.0.2): one representative window per tile, a burn
// rate only for a verified weekly window, four tiles spread over the providers, pools named.
test('provider quota windows, tiles and pool names follow the shared fixture',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {representative,isWeekly,burnAllowed,pickTiles,accountTags}=await import('../src/fleet.ts');
 const {staleLabel,windowName}=await import('../src/i18n.ts');
 const rows=JSON.parse(await readFile(new URL('../../tests/fixtures/provider-quotas_v1.0.2.json',import.meta.url),'utf8')).account_quotas;
 const by=Object.fromEntries(rows.map(q=>[q.id,q])),ko=(en,k)=>k;
 assert.equal(representative(by['claude:fixture-a']).label,'주간');assert.ok(burnAllowed(by['claude:fixture-a']));
 assert.equal(representative(by['antigravity:pool-claude-gpt']).key,'cg-weekly');assert.ok(!burnAllowed(by['antigravity:pool-gemini']));
 assert.equal(representative(by['glm:fixture-key']).label,'5H');assert.ok(!isWeekly(representative(by['glm:fixture-key'])));
 assert.equal(representative({...by['glm:fixture-key'],windows:by['glm:fixture-key'].windows.filter(w=>w.scope==='mcp')}).key,'mcp');
 assert.equal(representative(by['glm:fixture-down']),null);assert.equal(staleLabel(by['glm:fixture-down'],ko),'값 없음');
 assert.equal(windowName(by['glm:fixture-key'].windows[0],ko),'MCP · 월간');assert.equal(windowName(by['glm:fixture-key'].windows[1],(en)=>en),'5 hours');
 assert.deepEqual(pickTiles(rows).map(q=>q.id),['claude:fixture-a','codex:fixture-c','antigravity:pool-gemini','glm:fixture-key']);
 const tags=accountTags([dev('p',{account_quotas:rows})]);
 assert.equal(tags['antigravity:pool-gemini'],'Gemini Models');assert.equal(tags['claude:fixture-a'],'1');assert.equal(tags['claude:fixture-b'],'2');assert.equal(tags['glm:fixture-key'],'2');assert.equal(tags['glm:fixture-down'],'1');
});
