import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import weekly from '../agent/onetop/dist/weekly.js';
import ranges from '../agent/onetop/dist/ranges.js';
import speed from '../agent/onetop/dist/speed.js';

// Execute the real renderer with a small DOM seam. No network or session action runs.
const html=fs.readFileSync(new URL('../agent/onetop/dist/index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../agent/onetop/dist/app.js',import.meta.url),'utf8');
const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
 value:'',innerHTML:'',dataset:{},children:[],setAttribute(){},removeAttribute(){},addEventListener(){},querySelectorAll(){return [];},
 classList:{add(){},remove(){},toggle(){}}
}]));
const context=vm.createContext({
 document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
 window:{addEventListener(){}},fetch:()=>new Promise(()=>{}),setInterval(){},setTimeout(){},clearTimeout(){},
 AbortSignal,URL,Date,OneTopWeekly:weekly,OneTopRanges:ranges,OneTopSpeed:speed,
 OneTopDashboard:{init(){},afterTable(){},rateCell:(rate)=>JSON.stringify({rate}),interacting:false,validPeriod:()=>true,state:{period:'1h',collapsed:{idle:false,other:false}},rememberPeriod(){}},
 OneTopI18n:{locale:()=> 'ko-KR',t:s=>s,language:'ko'}
});
vm.runInContext(source,context);
vm.runInContext(`data={ready:true,updated:Date.now()/1000,account_quotas:[],period_usage:{windows:[{key:'1h',label:'1시간',seconds:3600}]}};`,context);
const controlFixture={id:'root',kind:'Codex',status:'idle',display_status:'paused',children_working:1,
 control_key:'fixture',orca_terminal:{title:'Fixture root'},input_verified:true};
function buttons(fixture){
 context.fixture=fixture;
 const result=vm.runInContext('actions(fixture)',context);
 return Object.fromEntries([...result.matchAll(/<button\b([^>]+)>/g)].map(([,attrs])=>[
  /data-action="([^"]+)"/.exec(attrs)[1],!attrs.includes('disabled')
 ]));
}
assert.equal(buttons(controlFixture).resume,true);
assert.equal(vm.runInContext('display(fixture)',context),'working'); // Group badge still reflects its child.
const resuming=buttons({...controlFixture,status:'working',display_status:'resuming'});
assert.equal(resuming.pause,false);
assert.equal(resuming.terminate,false);
assert.equal(buttons({...controlFixture,control_key:null}).resume,false);

vm.runInContext(`
 const child={id:'child',kind:'Codex',status:'idle',project:'fixture',model:'child-model',pids:[],
  is_subagent:true,tokens:[1,0,0,0],usage:{windows:{'1h':[1,0,0,0]}}};
 const sibling={...child,id:'busy-child',status:'working'};
 const root={...child,id:'root',is_subagent:false,status:'working',model:'root-model',
  children_ids:['child','busy-child'],children_count:2};
 data.sessions=[root,child,sibling];data.root_sessions=[root];
`,context);
nodes.search.value='';nodes.modelFilter.value='all';nodes.sort.value='status';
const rowIDs=()=>[...nodes.sessionsBody.innerHTML.matchAll(/\bdata-session="([^"]+)"/g)].map(([,id])=>id);
nodes.stateFilter.value='idle';
vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['root']); // Filters find the parent but never open its children automatically.
assert.equal(nodes.tableCount.textContent,1);
nodes.stateFilter.value='all';
vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['root']); // Resetting the filter restores the collapsed group.
vm.runInContext("expandedSessions.add('root');renderTable();",context);
assert.deepEqual(rowIDs(),['root','child','busy-child']);
console.log('Session groups: root controls retain their own state; filters find matching descendants without auto-expansion.');

vm.runInContext(`
 data.system={host:{cpu:27.5,memory:{percent:64,used:64*2**30,total:100*2**30},network:{rx:1024,tx:512},disk:{free:20*2**30}}};
 data.account_quotas=[
  {kind:'Claude',account_label:'fresh@example.test',stale:false,windows:[{label:'주간',pct:4}]},
  {kind:'Claude',account_label:'cached@example.test',stale:true,status:'last_report',windows:[{label:'주간',pct:12}]},
  {kind:'Codex',account_label:'zero@example.test',stale:false,windows:[{label:'주간',pct:0}]},
  {kind:'Codex',account_label:'pending@example.test',stale:true,windows:[]}
 ];
 renderSessionSummary();
`,context);
assert.equal((nodes.sessionResourceStrip.innerHTML.match(/data-summary-view="system"/g)||[]).length,4);
assert.equal((nodes.sessionResourceStrip.innerHTML.match(/summary-mini-track/g)||[]).length,2); // CPU/RAM only, no invented network/disk capacity.
assert.match(nodes.sessionResourceStrip.innerHTML,/27\.5%/);
assert.equal((nodes.sessionAccountStrip.innerHTML.match(/data-summary-view="accounts"/g)||[]).length,4);
assert.equal((nodes.sessionAccountStrip.innerHTML.match(/summary-mini-track/g)||[]).length,3); // Missing report gets no fake bar.
assert.match(nodes.sessionAccountStrip.innerHTML,/<strong>12%<small>마지막 보고<\/small><\/strong>/);
assert.match(nodes.sessionAccountStrip.innerHTML,/<strong>0%<\/strong>/);
assert.match(nodes.sessionAccountStrip.innerHTML,/<strong>보고 대기<\/strong>/);
assert.doesNotMatch(nodes.sessionAccountStrip.innerHTML,/%\/시간|5H/);
assert.ok(html.indexOf('id="sessionSummary"')<html.indexOf('id="sessionPeriodTitle"'));
console.log('Session summary: four resources and four accounts; stale, true zero and missing quota remain distinct.');

let rankingClock=Date.now();
context.Date=class extends Date{static now(){return rankingClock;}};
vm.runInContext(`
 usageUnit='tokens';selectedPeriod='1h';expandedSessions.clear();
 data.period_usage.windows.push({key:'30m',label:'30분',seconds:1800});
 const ranked=(id,hour,half,rate)=>({id,kind:'Codex',status:'working',project:id,pids:[],tokens:[hour,0,0,0],
  usage:{rate,windows:{'1h':[hour,0,0,0],'30m':[half,0,0,0]}}});
 data.sessions=[ranked('a',100,10,1),ranked('b',50,40,1000)];data.root_sessions=data.sessions;
`,context);
nodes.sort.value='period';nodes.stateFilter.value='all';
vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['a','b']); // Selected-period tokens, not lifetime, percent or burn rate.
vm.runInContext(`data.sessions[1].usage.windows['1h']=[500,0,0,0];renderTable();`,context);
assert.deepEqual(rowIDs(),['b','a']); // Usage updates reorder immediately.
assert.match(nodes.sessionsBody.innerHTML,/<strong>500<\/strong>/);
vm.runInContext(`data.sessions[0].usage.windows['30m']=[1000,0,0,0];selectedPeriod='30m';renderTable();`,context);
assert.deepEqual(rowIDs(),['a','b']);
vm.runInContext(`data.sessions.push(ranked('new',2000,2000,0));renderTable();`,context);
assert.deepEqual(rowIDs(),['new','a','b']);
vm.runInContext(`data.sessions=data.sessions.filter(s=>s.id!=='a');data.root_sessions=data.sessions;renderTable();`,context);
assert.deepEqual(rowIDs(),['new','b']);
nodes.sort.value='rate';vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['b','new']); // Explicit alternate sorts still work within the working group.
nodes.sort.value='period';vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['new','b']);
// Every non-working session shares one usage order: states never split it into bands.
vm.runInContext(`
 data.sessions=[ranked('w',10,10,0),{...ranked('idle-big',900,0,0),status:'idle'},{...ranked('waiting-mid',500,0,0),status:'waiting'},{...ranked('paused-small',100,0,0),status:'idle',display_status:'paused'},{...ranked('parent',5,0,0),status:'idle',children_working:1}];
 data.root_sessions=data.sessions;selectedPeriod='1h';OneTopDashboard.state.collapsed={};renderTable();`,context);
assert.deepEqual(rowIDs(),['w','parent','idle-big','waiting-mid','paused-small']);
assert.equal((nodes.sessionsBody.innerHTML.match(/class="group-row /g)||[]).length,2);
const sortOptions=/<select id="sort"[^>]*>(.*?)<\/select>/.exec(html)[1];
assert.match(sortOptions,/^<option value="period">/);
console.log('Session ordering: selected-period tokens, immediate usage/period changes, insertion and removal.');

const allIDs=[...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>id);
assert.equal(new Set(allIDs).size,allIDs.length);
context.chartCalls=[];
vm.runInContext(`
 tokenChart=(id,events,minutes)=>chartCalls.push({id,events,minutes});canvasBase=()=>null;
 data.events=[{kind:'Claude',t:data.updated-1,n:10},{kind:'Codex',t:data.updated-1,n:20}];provider='Claude';selectedPeriod='30m';
 drawCharts();
`,context);
assert.deepEqual(context.chartCalls.map(c=>c.id),['tokenChart','accountTokenChart']);
assert.deepEqual(context.chartCalls.map(c=>c.minutes),[30,30]);
assert.ok(context.chartCalls.every(c=>c.events.length===1&&c.events[0].kind==='Claude'));
assert.match(nodes.accountChartLegend.innerHTML,/Claude Code/);
assert.doesNotMatch(nodes.accountChartLegend.innerHTML,/Codex/);
assert.equal(nodes.accountTokenPeriod.textContent,'최근 30분');
const hostChips=['Orca','Terminal'].map(app=>({dataset:{appFilter:app},attributes:{},classList:{toggle(){}},setAttribute(key,value){this.attributes[key]=value;}}));
context.document.querySelectorAll=selector=>selector==='#hostApps [data-app-filter]'?hostChips:[];
nodes.search.value='Orca';
vm.runInContext('renderTable()',context);
assert.deepEqual(hostChips.map(c=>c.attributes['aria-pressed']),['true','false']);
nodes.search.value='';
vm.runInContext('renderTable()',context);
assert.deepEqual(hostChips.map(c=>c.attributes['aria-pressed']),['false','false']);
console.log('Account detail chart shares the chosen period and provider filter; host chips expose and clear their selected state.');

vm.runInContext(`
 provider='all';selectedPeriod='1h';selectedId=null;
 data.sessions=['high','xhigh','max','<script>alert(1)</script>',null].map((effort,i)=>({...ranked('effort-'+i,10,5,0),effort,model:'test-model'}));data.root_sessions=data.sessions;
 renderTable();
`,context);
for(const value of ['high','xhigh','max'])assert.ok(nodes.sessionsBody.innerHTML.includes(`>${value}</span>`));
assert.match(nodes.sessionsBody.innerHTML,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(nodes.sessionsBody.innerHTML,/<script>/);
assert.equal((nodes.sessionsBody.innerHTML.match(/reasoning effort/g)||[]).length,4);
vm.runInContext("renderDetail('effort-1')",context);
// The figures, effort among them, sit below the conversation in #detailMore.
assert.match(nodes.detailMore.innerHTML,/추론 강도 \(effort\)<\/dt><dd>xhigh<\/dd>/);
vm.runInContext("renderDetail('effort-4')",context);
assert.doesNotMatch(nodes.detailContent.innerHTML+nodes.detailMore.innerHTML,/추론 강도/);
assert.doesNotMatch(source,/setLineDash\(\[4,4\]\)|보고 공백/);
console.log('Effort: actual high/xhigh/max values render and escape safely; missing values are omitted. Quota chart has no dashed-gap rendering.');

vm.runInContext(`
 usageUnit='weekly';provider='all';selectedPeriod='1h';
 const idleHeavy={...ranked('idle-heavy',100000,100000,10000),status:'idle'};
 const idleOther={...ranked('idle-other',200000,200000,10000),status:'idle'};
 const activeClaude={...ranked('active-claude',200,10,0),kind:'Claude'};
 const activeCodex={...ranked('active-codex',100,30,2000)};
 activeCodex.usage.weekly_estimate={'1h':{used_pp:50,tokens:100}};
 const activeChild={...ranked('child-active-group',150,200,0),status:'idle',children_working:1};
 data.sessions=[idleHeavy,idleOther,activeCodex,activeClaude,activeChild];data.root_sessions=data.sessions;
 renderTable();
`,context);
assert.deepEqual(rowIDs(),['active-claude','child-active-group','active-codex','idle-other','idle-heavy']);
vm.runInContext(`activeCodex.usage.windows['1h']=[999,0,0,0];renderTable();`,context);
assert.deepEqual(rowIDs(),['active-codex','active-claude','child-active-group','idle-other','idle-heavy']);
vm.runInContext(`idleHeavy.status='working';renderTable();`,context);
assert.deepEqual(rowIDs(),['idle-heavy','active-codex','active-claude','child-active-group','idle-other']);
vm.runInContext(`activeClaude.status='idle';renderTable();`,context);
assert.deepEqual(rowIDs(),['idle-heavy','active-codex','child-active-group','idle-other','active-claude']);
assert.match(nodes.sessionsBody.innerHTML,/<tr[^>]*data-session="active-claude"[^>]*data-group-of="rest"/);
vm.runInContext(`selectedPeriod='30m';renderTable();`,context);
assert.deepEqual(rowIDs(),['idle-heavy','child-active-group','active-codex','idle-other','active-claude']);
vm.runInContext(`activeChild.children_working=0;renderTable();`,context);
assert.deepEqual(rowIDs(),['idle-heavy','active-codex','idle-other','child-active-group','active-claude']);
console.log('Working roots first, including working children; status changes move bands immediately and each band follows selected-period tokens.');


vm.runInContext(`
 selectedPeriod='1h';usageUnit='weekly';
 data.account_quotas=[{id:'compact-account',kind:'Codex',account_label:'test@example.test',stale:false}];
 const compactEstimate={used_pp:17.7,account_id:'compact-account',basis:'calibrated_token_equivalent',tokens:12345,calibration:{tokens:3000000,used_pp:1,seconds:240}};
 const compactSession={tokens:[100,0,0,0],usage:{rate:18000,weekly_estimate:{'1h':compactEstimate}}};
`,context);
const visibleText=markup=>markup.replace(/\s(?:title|aria-label)="[^"]*"/g,'').replace(/<[^>]*>/g,'');
const compactCell=vm.runInContext('sessionWeeklyCell(compactSession,[100,0,0,0],null)',context);
assert.equal(visibleText(compactCell),'≈17.7%');
assert.equal((compactCell.match(/class="cell-sub"/g)||[]).length,0);
assert.equal(JSON.parse(vm.runInContext('sessionBurnCell(compactSession)',context)).rate,21.6);
const tokenFallback=vm.runInContext('sessionWeeklyCell({tokens:[100,0,0,0],usage:{}},[100,0,0,0],null)',context);
assert.equal(visibleText(tokenFallback),'100 tokens');
const unknownCell=vm.runInContext('sessionWeeklyCell({tokens:null,usage:{}},null,null)',context);
assert.equal(visibleText(unknownCell),'—');
vm.runInContext('data.account_quotas[0].stale=true',context);
assert.equal(visibleText(vm.runInContext('sessionWeeklyCell(compactSession,[100,0,0,0],null)',context)),'≈17.7%');
assert.equal(JSON.parse(vm.runInContext('sessionBurnCell(compactSession)',context)).rate,null);
assert.doesNotMatch(source,/주간 한도 환산/);
console.log('Period usage and burn rate stay in separate columns; stale rates are unknown, missing estimates use tokens once.');
vm.runInContext(`
 data.account_quotas[0].stale=false;
 data.weekly_usage={accounts:[{id:'compact-account',calibration:compactEstimate.calibration}]};
 const asideIdle={kind:'Aside',tokens:[100,0,0,0],usage:{rate:0,weekly_account:'compact-account',weekly_estimate:{}}};
`,context);
assert.equal(JSON.parse(vm.runInContext('sessionBurnCell(asideIdle)',context)).rate,0);
vm.runInContext('asideIdle.usage.rate=18000',context);
assert.equal(JSON.parse(vm.runInContext('sessionBurnCell(asideIdle)',context)).rate,21.6);
console.log('Aside current burn uses matched account calibration even when the selected period has no events.');

// Exercise real delegated click handlers. Only unrelated render sections are stubbed.
nodes.modelFilter.options=[{value:'all'}];nodes.search.value='';nodes.stateFilter.value='all';nodes.modelFilter.value='all';
vm.runInContext(`
 provider='all';usageUnit='tokens';selectedPeriod='1h';expandedSessions.clear();
 data.process_counts={};data.started=Date.now()/1000;data.updated=Date.now()/1000;
 data.sessions=[{...ranked('root',100,50,0),kind:'Claude',orca_terminal:{title:'Test'},children_count:1,children_ids:['child']},
 {...ranked('child',10,5,0),kind:'Claude',is_subagent:true,orca_terminal:{title:'Test'}}];data.root_sessions=[data.sessions[0]];
 selectView=next=>{view=next;};
 renderPeriods=renderWeekly=renderSessionSummary=renderHost=renderMaps=renderQuotas=renderSystem=renderBenchmark=renderOperations=drawCharts=()=>{};
 render();
`,context);
const click=(node,dataset)=>node.onclick({target:{closest:()=>({dataset})},preventDefault(){},stopPropagation(){}});
click(nodes.providers,{provider:'Claude'});
assert.equal(vm.runInContext('provider',context),'Claude');
assert.match(nodes.providers.innerHTML,/data-provider="Claude" aria-pressed="true"/);
click(nodes.providers,{provider:'Claude'});
assert.equal(vm.runInContext('provider',context),'all');
assert.match(nodes.providers.innerHTML,/data-provider="Claude" aria-pressed="false"/);
click(nodes.hostApps,{appFilter:'Orca'});
assert.equal(nodes.search.value,'Orca');assert.equal(hostChips[0].attributes['aria-pressed'],'true');
vm.runInContext("provider='Claude'",context);
click(nodes.hostApps,{appFilter:'Orca'});
assert.equal(nodes.search.value,'');assert.equal(hostChips[0].attributes['aria-pressed'],'false');
assert.equal(vm.runInContext('provider',context),'Claude'); // Host toggling preserves the AI filter.
nodes.search.value='custom search';
click(nodes.providers,{provider:'Claude'});
assert.equal(nodes.search.value,'custom search'); // AI deselection never clears a manual query.
nodes.search.value='Orca';vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['root']);
click(nodes.sessionsBody,{children:'root'});assert.deepEqual(rowIDs(),['root','child']);
vm.runInContext('render()',context);assert.deepEqual(rowIDs(),['root','child']);
click(nodes.sessionsBody,{children:'root'});assert.deepEqual(rowIDs(),['root']);
vm.runInContext('render()',context);assert.deepEqual(rowIDs(),['root']);
nodes.search.value='';
click(nodes.sessionsBody,{children:'root'});assert.deepEqual(rowIDs(),['root','child']);
click(nodes.sessionsBody,{children:'root'});assert.deepEqual(rowIDs(),['root']);
const css=fs.readFileSync(new URL('../agent/onetop/dist/style.css',import.meta.url),'utf8');
assert.match(css,/\.rail nav#providers,\.rail nav#hostApps\{[^}]*flex-direction:column;align-items:flex-start;flex-wrap:nowrap/);
assert.match(css,/\.range-toolbar\{[^}]*justify-content:flex-start/);
console.log('Actual clicks: provider/host tags toggle off, other filters persist, child groups stay collapsed by default and retain explicit toggles across polls.');

vm.runInContext(`
 provider='all';selectedPeriod='1h';expandedSessions.clear();
 const tagClaude={...ranked('tag-claude',300,1000,0),kind:'Claude',location:{app:'Zed'}};
 const tagCodex={...ranked('tag-codex',200,30,0),kind:'Codex',orca_terminal:{title:'Test'}};
 const tagOtherCodex={...ranked('tag-codex-2',100,20,0),kind:'Codex',location:{app:'Terminal'}};
 const tagGLM={...ranked('tag-glm',99999,99999,0),kind:'GLM',status:'idle',location:{app:'Aside'}};
 data.root_sessions=[tagGLM,tagCodex,tagOtherCodex,tagClaude];
 data.sessions=[...data.root_sessions,{...ranked('hidden-child',1,1,0),kind:'Antigravity',is_subagent:true,location:{app:'Child app'}}];
 render();
`,context);
const providerTags=()=>[...nodes.providers.innerHTML.matchAll(/data-provider="([^"]+)"/g)].map(([,kind])=>kind);
const appTags=()=>[...nodes.hostApps.innerHTML.matchAll(/data-app-filter="([^"]+)"/g)].map(([,app])=>app);
assert.deepEqual(providerTags(),['Claude','Codex','GLM']); // Same working-first order as the table.
assert.deepEqual(appTags(),['Zed','Orca','Terminal','Aside']);
assert.match(nodes.providers.innerHTML,/data-provider="Codex"[^>]*>[\s\S]*?<small>2<\/small>/);
vm.runInContext(`tagCodex.usage.windows['1h']=[5000,0,0,0];render();`,context);
assert.deepEqual(providerTags(),['Codex','Claude','GLM']); // Same immediate order as the table.
rankingClock+=60000;vm.runInContext('render()',context);
assert.deepEqual(providerTags(),['Codex','Claude','GLM']);
vm.runInContext(`selectedPeriod='30m';render();`,context);
assert.deepEqual(providerTags(),['Claude','Codex','GLM']);
assert.deepEqual(appTags(),['Zed','Orca','Terminal','Aside']);
assert.match(html,/<img class="brand-mark" src="\/brand-mark_v1\.1\.0\.png"/);
assert.deepEqual(fs.readFileSync(new URL('../agent/onetop/dist/brand-mark_v1.1.0.png',import.meta.url)),fs.readFileSync(new URL('../site/public/brand/v1.1.0/mark.png',import.meta.url)));
assert.match(css,/\.session-summary \.summary-mini-track\{position:absolute;/);
console.log('Sidebar follows actual working-first root order and period changes; canonical logo and compact absolute-positioned summary bars preserved.');

const flow=(events,minutes,updated=3600)=>{context.flowEvents=events;context.flowMinutes=minutes;context.flowUpdated=updated;return JSON.parse(vm.runInContext('JSON.stringify(tokenFlowData(flowEvents,flowMinutes,flowUpdated))',context));};
const flowFixture=[{t:3060,kind:'Codex',n:200},{t:3060,kind:'Claude',n:100},{t:3659,kind:' Zeta ',n:20},{t:3659,kind:'Alpha',n:10},{t:3659,kind:' ',n:5},{t:3660,kind:'GLM',n:900},{t:3059,kind:'Aside',n:700},{t:3060,kind:'Bad',n:NaN}];
const flowSample=flow(flowFixture,10);
assert.deepEqual(flowSample.series,['Claude','Codex','Alpha','Zeta','unknown']);
assert.equal(flowSample.bins.length,10);assert.equal(flowSample.start,3060);assert.equal(flowSample.end,3660);
assert.equal(flowSample.bins[0].Claude,100);assert.equal(flowSample.bins[0].Codex,200);assert.equal(flowSample.max,500);
for(const [minutes,step,count] of [[10,60,10],[30,60,30],[60,60,60],[300,300,60],[720,900,48],[1440,900,96]]){
 const f=flow(flowFixture,minutes);assert.equal(f.step,step);assert.equal(f.bins.length,count);assert.equal(f.end,3660);assert.equal(f.start,3660-minutes*60);
}
assert.equal(flow([],60).max,1);
console.log('Token-flow aggregation: six native-matched resolutions, snapshot clock, canonical stacking, half-open bins and shared nice axis.');
