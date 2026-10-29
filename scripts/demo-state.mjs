// An invented collector for screenshots and demos of the desktop dashboard and the menu bar and tray
// panels: /api/state, /api/history and the mailbox in the shape the real collector answers with
// (agent/onetop/server.py), with token use shaped like real use (site/src/demo-usage.js). Projects,
// paths, accounts and terminals are made up.
//   node scripts/demo-state.mjs [now] [period] > state.json
//   import {demoState, demoHistory, demoMailbox} from './scripts/demo-state.mjs'
// lang ('ko', 'en' or 'zh') picks the language of what people wrote; the collector's own words stay Korean,
// as the real collector writes them, and the dashboard translates them.
// anchor is when the demo began: sessions stopped before it stay stopped, and limits reset relative to it.
import {usage,vector} from '../site/src/demo-usage.js';

const PERIODS=[['24h','24시간',86400],['12h','12시간',43200],['5h','5시간',18000],['1h','1시간',3600],['30m','30분',1800],['10m','10분',600]];
const DAY=86400,WEEK=7*DAY,HISTORY_DAYS=90,SEED=23,SCALE=1.3e6,REST=7;
const HOME='/Users/demo',ORCA=HOME+'/orca/workspaces';
const STARTED=30*3600; // the shown sessions began this long before the demo

// Limits. per: weekly percent per token, set once from a typical week of this demo (not from the
// window shown), so the weekly percent moves with the work. reset: seconds after the demo began.
// five: the 5-hour window's reset after the demo began and its percent per weekly percent.
// Notes are the collector's own words (agent/onetop/accounts.py), which the dashboard translates.
const ACCOUNTS=[
 {id:'claude-a',kind:'Claude',label:'dev@example.com',plan:'Max',per:1.46e-8,reset:266000,five:{reset:7400,factor:6},source:'claude_statusline'},
 {id:'claude-b',kind:'Claude',label:'studio@example.com',plan:'Pro',alias:'Studio',per:6.9e-8,reset:330000,five:{reset:14200,factor:6},source:'claude_statusline'},
 {id:'codex-a',kind:'Codex',label:'ops@example.com',plan:'Pro',per:1.8e-7,reset:300000},
 // A limit the computer could not refresh: its last report is 38 minutes old and it asks to sign in again.
 {id:'codex-b',kind:'Codex',label:'ml@example.com',plan:'Plus',per:1.9e-8,reset:220000,stale:2280,status:'login_required'},
];
// Shown sessions: [id, kind, project, model, status, account, weight, app, title, effort, extra].
// status 'paused' is idle underneath; 'waiting' asks for input (확인 필요); weight is a usual share.
const ROWS=[
 ['s1','Claude','checkout-web','claude-opus-5-5','working','claude-a',30,'Orca','Checkout UI','xhigh'],
 ['s2','Codex','billing-service','gpt-6.1-sol','working','codex-b',8,'Orca','Billing API','ultra'],
 ['s3','Claude','docs-site','claude-sonnet-5-5','working','claude-b',6,'Visual Studio Code','docs','high'],
 ['s4','GLM','data-sync','glm-5.3[1m]','waiting',null,2,'Orca','Nightly sync','high'],
 ['s5','Aside','0','gpt-6.1-sol','working',null,1.5,'Aside','Release notes','medium'],
 ['s6','Codex','api-gateway','gpt-6-astra','idle','codex-a',3,'Orca','Gateway','high'],
 ['s7','Claude','mobile-app','claude-haiku-5-5','paused','claude-a',2,'Orca','Mobile','low'],
 ['s8','Antigravity','research','gemini-3.5-pro','unknown',null,0,'Cursor','research',null],
 ['s9','Claude','design-tokens','claude-sonnet-5-5','waiting','claude-a',4,'Ghostty','tokens','medium'],
 ['s10','Gemini','release-bot',null,'unknown',null,0,'iTerm2','release',null],
 ['s11','Codex','data-pipeline','gpt-6-astra','idle','codex-a',2,'Terminal','etl','low'],
 ['s12','Claude','onboarding','claude-sonnet-5-5','idle','claude-b',1,'Warp','onboard','medium'],
];
// Subagents under a lead: [lead, name, share of the lead's weight, status].
const CHILDREN=[['s1','reviewer',.25,'working'],['s1','tester',.1,'idle'],['s2','migrator',.3,'working']];
// Earlier sessions that are no longer open: they fill the weekly windows and the history.
const EARLIER=[
 ['Claude','claude-a','claude-opus-5-5','storefront',30],['Claude','claude-a','claude-sonnet-5-5','design-system',8],
 ['Claude','claude-b','claude-sonnet-5-5','docs-site',6],['Codex','codex-a','gpt-6-astra','api-gateway',4],
 ['Codex','codex-b','gpt-6.1-sol','ml-pipeline',7],['GLM',null,'glm-5.3[1m]','data-sync',2],['Aside',null,'gpt-6.1-sol','0',1.5],
];
const APPS={Orca:'/Applications/Orca.app','Visual Studio Code':'/Applications/Visual Studio Code.app',Cursor:'/Applications/Cursor.app',
 Ghostty:'/Applications/Ghostty.app',iTerm2:'/Applications/iTerm.app',Terminal:'/System/Applications/Utilities/Terminal.app',
 Warp:'/Applications/Warp.app',Aside:'/Applications/Aside.app',Claude:'/Applications/Claude.app'};
const SOURCES={Claude:'Claude Code 세션 레지스트리',GLM:'Claude Code 세션 레지스트리',Codex:'Codex 백엔드가 열고 있는 세션 기록',
 Aside:'Aside local session database and per-request usage reports'};
const PROVIDERS={Codex:'openai-codex',GLM:'api.z.ai',Claude:''};
const round=(n,d=4)=>Math.round(n*10**d)/10**d;
// Aside sessions work in Aside's default workspace (project '0'); the others in a project folder.
const cwd=(project,kind)=>kind==='Aside'?`${HOME}/.aside/u/demo-user`:`${HOME}/projects/${project}`;
const pidOf=i=>40100+i*37;

export function periodSeconds(key,now,anchor=now){
 const fixed=PERIODS.find(p=>p[0]===key);if(fixed)return fixed[2];
 if(key==='all')return Math.floor(now-(anchor-HISTORY_DAYS*DAY));
 const m=/^custom:(\d+)$/.exec(key||'');return m?Number(m[1]):3600;
}

// Every stream of tokens: shown sessions, their subagents and earlier sessions, with when each took part.
function streams(anchor){
 const out=[];
 ROWS.forEach(([id,kind,project,model,status,account,weight],i)=>{
  const stop=status==='waiting'?anchor-(3+i)*60:status==='paused'?anchor-12*60:status==='idle'?anchor-(40+i*31)*60:Infinity;
  out.push({id,kind,project,model,account,weight,start:anchor-STARTED,stop,shown:true});
 });
 for(const [lead,name,share,status] of CHILDREN){const parent=out.find(s=>s.id===lead);
  out.push({...parent,id:lead+'-'+name,weight:parent.weight*share,stop:status==='working'?parent.stop:Math.min(parent.stop,anchor-25*60),child:{lead,name,status}});}
 EARLIER.forEach(([kind,account,model,project,weight],i)=>out.push({id:'earlier-'+i,kind,account,model,project,weight,start:anchor-HISTORY_DAYS*DAY,stop:anchor-STARTED}));
 return out;
}

// The minutes of the whole history, with sums over any span. Cached by minute and anchor.
let cached=null;
function minutes(now,anchor){
 const key=Math.floor(now/60)+':'+anchor;if(cached?.key===key)return cached;
 const list=streams(anchor),u=usage(SEED,SCALE,list,now,anchor,REST,1,true,HISTORY_DAYS*1440+15),n=u.minutes[0].length;
 const cum=u.minutes.map(row=>{const c=new Float64Array(n+1);for(let i=0;i<n;i++)c[i+1]=c[i]+row[i];return c;});
 const at=t=>Math.min(n,Math.max(0,Math.ceil(t/60)-u.first));
 const sum=(j,from,to=Infinity)=>{const a=at(from),b=to===Infinity?n:at(to);return b>a?cum[j][b]-cum[j][a]:0;};
 cached={key,list,u,n,sum};return cached;
}

function accountUsage(m,anchor){
 const used=(id,from,to)=>m.list.reduce((n,s,j)=>n+(s.account===id?m.sum(j,from,to):0),0);
 return ACCOUNTS.map(a=>{
  const reset=anchor+a.reset,start=reset-WEEK;
  return {...a,resetAt:reset,start,used,calibration:now=>({tokens:Math.round(1/a.per),used_pp:1,seconds:1800,
   // A Claude calibration holds until the weekly reset or a day after it was measured, whichever is first.
   from:now-7200,to:now-5400,pp_per_token:a.per,confidence:'limited',source:a.kind==='Claude'?'historical_provider_calibration':'provider_report',kind:a.kind,reset:Math.round(reset),
   valid_until:Math.min(Math.round(reset),now-5400+DAY),
   age_seconds:5400,report_source:a.source||'codex_rate_limits',account_observed_since:anchor-12*DAY,reused_before_correction:false})};
 });
}

/** The collector's /api/state at now for a period key (10m … 24h, custom:<seconds>, all). */
// What people wrote (goal objectives, the resume prompt, messages) in the demo's language.
const WRITTEN={
 goal1:{ko:'청구서 화면을 새 결제 흐름에 맞춥니다.',en:'Match the invoice screen to the new payment flow.',zh:'让账单页面符合新的支付流程。'},
 goal2:{ko:'문서 검색 결과의 정렬 기준을 정리합니다.',en:'Settle how docs search results are sorted.',zh:'整理文档搜索结果的排序规则。'},
 resume:{ko:'이어서 진행해 주세요.',en:'Please continue.',zh:'请继续。'},
 ask:{ko:'지금 어디까지 진행됐어?',en:'How far along are you?',zh:'现在进展到哪里了？'},
 reply:{ko:'결제 화면의 카드 입력 단계를 새 컴포넌트로 옮겼고, 남은 작업은 영수증 화면과 테스트 두 개입니다.',en:'I moved the card entry step of checkout to the new component. The receipt screen and two tests are left.',zh:'已将结账页面的银行卡输入步骤移到新组件，剩下收据页面和两个测试。'},
 receipt:{ko:'영수증 화면도 같은 기준으로 맞춰 줘.',en:'Match the receipt screen to the same rules.',zh:'收据页面也按同样的标准调整。'},
 tests:{ko:'테스트가 끝나면 알려 줘.',en:'Let me know when the tests finish.',zh:'测试完成后告诉我。'},
};
const say=(key,lang)=>WRITTEN[key][lang]||WRITTEN[key].ko;

export function demoState(now=Date.now()/1000,{period='1h',anchor=now,lang='ko'}={}){
 const m=minutes(now,anchor),seconds=periodSeconds(period,now,anchor),keys=[...PERIODS.map(p=>p[0]),...(PERIODS.some(p=>p[0]===period)?[]:[period])];
 const span=k=>periodSeconds(k,now,anchor),accounts=accountUsage(m,anchor),accountOf=id=>accounts.find(a=>a.id===id);
 const reportAt=a=>a.stale?now-a.stale:now,weeklyPct=a=>round(a.used(a.id,a.start,reportAt(a))*a.per,1);
 const minuteAt=(j,t)=>m.u.minutes[j][Math.floor(t/60)-m.u.first]||0,cpuOf=j=>Math.round((1.5+Math.min(30,minuteAt(j,now-60)/4e4))*10)/10;

 const session=(s,j,i)=>{
  const row=ROWS.find(r=>r[0]===(s.child?.lead||s.id)),[,kind,project,model,rowStatus,account,weight,app,title,effort]=row;
  const status=s.child?s.child.status:rowStatus,display=status,raw=status==='paused'?'idle':status,tracked=weight>0,a=account&&accountOf(account);
  const windows=tracked?Object.fromEntries(keys.map(k=>[k,vector(m.sum(j,now-span(k)))])):{};
  const estimate=a?Object.fromEntries(keys.map(k=>{const tokens=windows[k].reduce((x,y)=>x+y,0);
   return [k,{account_id:a.id,basis:'calibrated_token_equivalent',calibration:a.calibration(now),excluded_account_tokens:0,inferred_account_tokens:0,partial:false,
    period_seconds:span(k),tokens,used_pp:round(tokens*a.per)}];})):{};
  const history=Array.from({length:20},(_,k)=>{const t=Math.floor(now/60-19+k)*60;return [t,Math.round(m.sum(j,t,t+60))];}).filter(([,n])=>n>0);
  const id=s.id,root=s.child?s.child.lead:id,orca=app==='Orca',pid=pidOf(i),since=anchor-STARTED+i*600;
  const out={account_binding_source:a?(kind==='Claude'?'claude_statusline_session':'otel_session_identity'):null,active_session_id:id+'-active',child_session_ids:s.child?[]:CHILDREN.filter(c=>c[0]===id).map(c=>id+'-'+c[1]),
   config_dir:kind==='Claude'||kind==='GLM'?HOME+'/.claude':kind==='Codex'?HOME+'/.codex':null,configured_model:model,connected:status!=='unknown',context_size:null,
   context_usage:tracked?{basis:'last_request_input',capacity:kind==='Codex'?400000:kind==='Claude'?1000000:null,input_tokens:64000+i*6100,model,observed_at:now-30,parts:[12000+i*2000,48000+i*4000,4000]}:null,
   continuation_keys:[],continuation_processes:[],continuation_sources:[],control_key:'demo-'+id,counter_reset:false,cpu:raw==='working'?cpuOf(j):status==='unknown'?.6:.3,
   cwd:cwd(project,kind),display_status:display,effort:effort,effort_source:effort?(kind==='Codex'?'codex_turn_context':kind==='Aside'?'aside_session_configuration':'claude_statusline'):null,effort_updated:effort?now-900:null,
   id,input_verified:orca,is_subagent:!!s.child,kind,last_usage:tracked?Math.max(anchor-STARTED,...history.map(h=>h[0]),now-1800):null,loading:false,
   location:{app,app_path:APPS[app]||'/Applications/'+app+'.app',match:s.child?'parent_session':kind==='Aside'?'aside_database':orca?'tty':'process_ancestry',terminal:s.child?'':kind==='Aside'?'Aside 내부 세션':title},
   model,model_updated:now-1200,models:model?[model]:[],orca_terminal:orca&&!s.child?{handle:'term_demo_'+id,incarnationId:'inc-'+id,tabId:'tab-'+(i+1),title,worktreePath:ORCA+'/'+project}:undefined,
   parent_session_id:s.child?root:null,path:kind==='Codex'?`${HOME}/.codex/sessions/2026/10/rollout-${id}.jsonl`:`${HOME}/.claude/projects/-Users-demo-projects-${project}/${id}.jsonl`,
   pid,pids:[pid],process_birth:since,process_only:false,process_started:new Date(since*1000).toString().slice(0,24),progress:kind==='Aside'?100:null,project,
   provider:PROVIDERS[kind]??null,request_input:tracked?100000+i*1700:null,resources:{count:1,cpu:raw==='working'?cpuOf(j):.3,pids:[pid],rss:(160+i*24)*2**20},
   root_session_id:root,rss:(160+i*24)*2**20,source:SOURCES[kind]||'CLI executable and process ancestry',status:raw,status_at:now-(raw==='working'?20:300),
   telemetry:{account_id:a?.id||'',account_ids:a?[a.id]:[],account_since:anchor-12*DAY,agent_id:'agent-'+id,agent_id_at:now-600,duration_ms:2400+i*130,duration_ms_at:now-60,effort:effort||'',effort_at:now-900,
    error_count:0,first_seen:since,identity_at:now-600,kind,last_seen:now-20,model:model||'',model_at:now-1200,request_count:40+i*7,session_id:id,signals:['logs'],token_reports:120+i*9,
    tokens_24h:tracked?vector(m.sum(j,now-DAY)):[0,0,0,0],ttft_ms:900+i*40,ttft_ms_at:now-60},
   terminal_match:s.child?'parent_session':orca?'confirmed':'unavailable',
   terminal_note:s.child?'하위 에이전트 · 부모 세션의 실행 위치에서 확인':kind==='Aside'?'Aside 내부 세션 · 터미널 CLI가 아님 · 바로가기는 Aside 앱 열기':orca?'':'세션과 터미널 화면 제목의 고유한 일치를 확인하지 못했습니다.',terminal_owner_pid:pid-1,title:s.child?s.child.name:title,
   tokens:tracked?vector(weight*5e7+m.sum(j,now-DAY)):null,
   usage:{history,last_five_minutes:vector(m.sum(j,now-300)),last_minute:vector(m.sum(j,now-60)),output_rate:round(m.sum(j,now-600)*.005/600,2),rate:raw==='working'?Math.round(m.sum(j,now-600)/600):0,
    weekly_account:a?.id||null,weekly_estimate:estimate,window_seconds:60,windows},
   waiting_for:null};
  if(kind==='Aside')Object.assign(out,{aside_account:'Aside · demo',aside_session:'aside-'+id,native_status:raw==='working'?'running':'idle'});
  if(kind==='Codex')Object.assign(out,{billing_kind:'Codex',thread_name:title});
  if(kind==='Claude'&&!s.child)Object.assign(out,{effort_model:model,note:''});
  if(s.child)Object.assign(out,{location_parent_id:root});
  if(raw==='idle'&&!s.child)out.continuation_pending=false;
  // A session continued from an earlier conversation keeps where that came from.
  if(id==='s12')Object.assign(out,{continuation_keys:['s12-before'],continuation_processes:[pid-3],continuation_sources:[{path:`${HOME}/.claude/projects/-Users-demo-projects-onboarding/s12-before.jsonl`,session_id:'s12-before'}]});
  if(out.orca_terminal===undefined)delete out.orca_terminal;
  return out;
 };
 const sessions=m.list.map((s,j)=>s.shown||s.child?session(s,j,s.child?ROWS.findIndex(r=>r[0]===s.child.lead)+20+j:ROWS.findIndex(r=>r[0]===s.id)):null).filter(Boolean);
 // A lead's row also counts its subagents.
 const roots=sessions.filter(s=>!s.is_subagent).map(s=>{const kids=sessions.filter(k=>k.parent_session_id===s.id);if(!kids.length)return {...s,children_count:0,children_ids:[],children_working:0,group_usage_partial:false};
  const add=(x,y)=>x.map((v,i)=>v+y[i]),usageWindows=Object.fromEntries(Object.entries(s.usage.windows).map(([k,v])=>[k,kids.reduce((n,c)=>add(n,c.usage.windows[k]),v)]));
  const estimate=Object.fromEntries(Object.entries(s.usage.weekly_estimate).map(([k,e])=>[k,{...e,tokens:usageWindows[k].reduce((x,y)=>x+y,0),used_pp:round(kids.reduce((n,c)=>n+c.usage.weekly_estimate[k].used_pp,e.used_pp))}]));
  return {...s,children_count:kids.length,children_ids:kids.map(k=>k.id),children_working:kids.filter(k=>k.status==='working').length,group_usage_partial:false,
   tokens:kids.reduce((n,c)=>add(n,c.tokens),s.tokens),usage:{...s.usage,windows:usageWindows,weekly_estimate:estimate,rate:s.usage.rate+kids.reduce((n,c)=>n+c.usage.rate,0)}};});

 const kinds=[...new Set(m.list.map(s=>s.kind))],byKind=(from)=>Object.fromEntries(kinds.map(k=>[k,vector(m.list.reduce((n,s,j)=>n+(s.kind===k?m.sum(j,from):0),0))]).filter(([,v])=>v.some(Boolean)));
 const all=from=>vector(m.list.reduce((n,s,j)=>n+m.sum(j,from),0));
 // Events: one a minute for each tool over the last day, or 240 bins over a longer period, as the collector groups them.
 const range=seconds>DAY?{start:now-seconds,end:now,step:seconds/240}:null,events=[];
 const bin=range?range.step:60,from=range?range.start:Math.floor((now-DAY)/60)*60;
 for(let t=from;t<now;t+=bin)for(const k of kinds){const n=m.list.reduce((x,s,j)=>x+(s.kind===k?m.sum(j,t,Math.min(now+1,t+bin)):0),0);if(!n)continue;
  const [fresh,cached,written,output]=vector(n);events.push({cached,fresh,kind:k,output,t:range?t:Math.floor(t),written});}

 const quotas=accounts.map(a=>{const pct=weeklyPct(a),five=a.five&&Math.min(100,round(a.used(a.id,a.five?anchor+a.five.reset-5*3600:0,reportAt(a))*a.per*a.five.factor,1));
  const q={account_label:a.label,id:a.id,kind:a.kind,note:a.kind==='Claude'?'Claude Code 상태줄 보고':a.stale?'계정 조회 지연 · 마지막 보고값':'Codex 계정 사용률 · 2분마다 확인',plan:a.plan,source:a.source||'codex_rate_limits',stale:!!a.stale,updated:reportAt(a),verified_activity:true,
   windows:[...(a.five?[{label:'5시간',pct:five,reset:Math.round(anchor+a.five.reset)}]:[]),{label:'주간',pct,reset:Math.round(a.resetAt)}]};
  if(a.alias)q.alias=a.alias;if(a.status)q.status=a.status;return q;});
 const weekly={accounts:accounts.map(a=>{const to=reportAt(a),step=600,points=[];for(let t=a.start;t<=to;t+=step)points.push(t);
  const pct=t=>round(a.used(a.id,a.start,t)*a.per,2),flow=points.slice(1).map((t,i)=>[points[i],t,round(pct(t)-pct(points[i]),3)]);
  return {calibration:a.calibration(now),flow,history:points.filter((_,i)=>i%3===0).map(t=>[t,pct(t)]),history_quality:{correction_count:0,excluded_samples:0,last_correction:a.start,reconciled:true},
   id:a.id,increase_intervals:flow.map(([f,t,pp])=>[f,t,pp,pp>0]),kind:a.kind,
   periods:Object.fromEntries(keys.map(k=>[k,{observed_from:now-span(k),observed_seconds:span(k),observed_to:now,partial:false,sample_count:Math.round(span(k)/60),unattributed_pp:0,used_pp:round(a.used(a.id,now-span(k),Infinity)*a.per)}])),
   usage_points:points.map(t=>[t,pct(t),Math.round(a.resetAt)])};}),as_of:now,basis:'provider_weekly_percentage'};

 const busy=Math.min(1,m.list.reduce((n,s,j)=>n+minuteAt(j,now-60),0)/(SCALE*3)),apps=[...new Set(['Orca','Claude',...ROWS.map(r=>r[7])])];
 const history=Array.from({length:300},(_,k)=>{const t=now-(299-k)*3,b=Math.min(1,m.list.reduce((n,s,j)=>n+minuteAt(j,t),0)/(SCALE*3));
  return {cpu:round(9+45*b,1),memory:round(58+3*b,1),rx:Math.round(400e3+2.4e6*b),t,tx:Math.round(90e3+600e3*b)};});
 return {account_quotas:quotas,action_token:'demo-token',
  actions:[{action:'pause',message:'작업이 멈춘 것을 확인했습니다. 세션을 보존했으며, 재개 버튼으로 새 요청을 보낼 수 있습니다.',project:'mobile-app',sid:'s7',t:anchor-12*60,terminal:'Mobile'},
   {action:'focus',message:'Sent a request to bring the host application forward on that computer.',project:'checkout-web',sid:'s1',t:anchor-40*60,terminal:'Checkout UI'}],
  applications:apps.map((name,i)=>({evidence:'application_process',name,note:'',path:APPS[name]||'/Applications/'+name+'.app',pid:3100+i*11})),
  ...(range?{chart_range:range}:{}),collection_ms:184.2,error:null,events,history_started:anchor-2*DAY,
  operations:{claude_goal_source_status:'partial_log',events:[{category:'loop',job_id:'loop-demo-1',location:ORCA+'/checkout-web',name:'nightly-tests',next_run:null,observed_at:null,provider:'Claude',result:'ok',runtime:'Claude Code',schedule:'',session_id:'s1',source:'session tool log',state:'tool_returned'},
   {category:'skill',job_id:'skill-demo-1',location:ORCA+'/docs-site',name:'release-notes',next_run:null,observed_at:null,provider:'Codex',result:'ok',runtime:'Codex',schedule:'',session_id:'s6',source:'session tool log',state:'tool_returned'}],
   goal_source_status:'reported',goals:[{evidence:'reported',goal_id:'goal-demo-1',location:ORCA+'/billing-service',objective:say('goal1',lang),runtime:'Codex',session_connected:true,source:'Codex goal database',status:'paused',thread_id:'thread-demo-1',time_used_seconds:6300,token_budget:null,tokens_used:18400000,updated_at_ms:Math.round((now-900)*1000)},
    {evidence:'reported',goal_id:'goal-demo-2',location:ORCA+'/docs-site',objective:say('goal2',lang),runtime:'Codex',session_connected:false,source:'Codex goal database',status:'complete',thread_id:'thread-demo-2',time_used_seconds:2700,token_budget:null,tokens_used:6200000,updated_at_ms:Math.round((now-7200)*1000)}],
   history_scope:'Recent observed tool logs and persistent schedules; not complete history',loop_state:'persistent_subset',schedules:[],skill_runtime:'partial',
   skills:['release-notes','test-runner','design-review'].map((name,i)=>({availability:'not_verified',name,path:`${HOME}/.claude/skills/${name}/SKILL.md`,providers:['Shared'],scope:['user','project','local'][i],state:'installed'})),updated:now-30},
  orca_terminals:ROWS.filter(r=>r[7]==='Orca').length,
  period_usage:{as_of:now,known_kinds:kinds,recording_started:anchor-2*DAY,windows:keys.map(k=>({by_kind:byKind(now-span(k)),from:now-span(k),key:k,label:PERIODS.find(p=>p[0]===k)?.[1]||k,observed_seconds:span(k),partial:false,seconds:span(k),
   session_count:sessions.filter(s=>s.tokens&&s.usage.windows[k]?.some(Boolean)).length,tokens:all(now-span(k))}))},
  poll_seconds:2,process_counts:Object.fromEntries(['Claude','Codex','GLM','Aside','Antigravity','Gemini'].map(k=>[k,ROWS.filter(r=>r[1]===k).length])),
  quotas:['Claude','Codex','GLM','Antigravity'].map(kind=>{const q=quotas.find(x=>x.kind===kind);return {kind,note:q?.note||'',updated:Math.round(q?.updated||now),windows:(q?.windows||[]).map(w=>({...w,pct:Math.round(w.pct),t:Math.round(q.updated)}))};}),
  ready:true,recent:byKind(now-300),resume_prompt:say('resume',lang),root_sessions:roots,sessions,started:anchor-3*3600,
  system:{history,host:{battery:{percent:84,plugged:true},cores:12,cpu:round(9+45*busy,1),disk:{free:410*2**30,path:'/',percent:59.8,read:3.1*2**20,total:2**40,write:1.2*2**20},gpu:null,gpu_note:'GPU·온도 센서는 수집하지 않습니다.',
   load:[round(2.1+4*busy,2),2.4,2.2],memory:{available:13.2*2**30,percent:61.2,total:36*2**30,used:22*2**30},network:{interfaces:['en0'],rx:Math.round(400e3+2.4e6*busy),tx:Math.round(90e3+600e3*busy)},os:'macOS 27.0',platform:'Darwin',
   process_count:612,swap:{total:4*2**30,used:1.1*2**30},unreadable_processes:3,uptime:4*DAY+5200},
   monitor:{cpu:1.4,pid:39000,rss:118*2**20},sampler_ms:38.5,
   shared:[{count:3,cpu:2.1,id:'node-mcp',name:'node (MCP servers)',pid:38811,pids:[38811,38812,38813],rss:240*2**20},{count:1,cpu:.4,id:'orca-pty',name:'Orca pty host',pid:38500,pids:[38500],rss:96*2**20}],
   top:[['Orca',12.4],['Visual Studio Code',6.1],['Cursor',4.3],['Ghostty',1.2],['Aside',.9]].map(([name,cpu],i)=>({cpu,created:anchor-DAY+i*600,name,owner:'demo',pid:3100+i*11,ppid:1,rss:(820-i*90)*2**20}))},
  telemetry:{duplicate_records:12,ignored_records:3,last_received:now-4,mode:'supplement',received_records:18420,remote_export:false,retention_days:30,stored_records:18405,transport:'otlp/http',usage_authority:'jsonl'},
  updated:now,version:'4.2.2',weekly_usage:weekly,workspace_usage:{devices:[],updated:now}};
}

const pad=n=>String(n).padStart(2,'0'),day=t=>{const d=new Date(t*1000);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
function floorStep(t,step){const d=new Date(t*1000);if(step==='day'){d.setHours(0,0,0,0);return d.getTime()/1000;}
 if(step==='week'){d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d.getTime()/1000;}return Math.floor(t/step)*step;}
function nextStep(t,step){const d=new Date(t*1000);if(step==='day'){d.setDate(d.getDate()+1);return d.getTime()/1000;}if(step==='week'){d.setDate(d.getDate()+7);return d.getTime()/1000;}return t+step;}

/** The collector's /api/history (docs/handoffs/usage-history-contract_v1.0.0.md): trends by model and
 *  project for a period and step, and the heatmaps. Returns {status: 400} past 400 bins. */
export function demoHistory(now=Date.now()/1000,{period='1h',step='60',kind=null,anchor=now}={}){
 const m=minutes(now,anchor),seconds=periodSeconds(period,now,anchor),unitStep=/^\d+$/.test(String(step))?Number(step):step,covered=anchor-HISTORY_DAYS*DAY;
 const bins=[];for(let t=floorStep(now-seconds,unitStep);t<now;t=nextStep(t,unitStep))bins.push(t);
 if(bins.length>400)return {status:400,error:'too many bins'};
 const use=m.list.map((s,j)=>[s,j]).filter(([s])=>s.weight>0&&(!kind||s.kind===kind)),edges=[...bins.slice(1).map(t=>t),Infinity];
 const cell=(j,i)=>bins[i]<covered?null:Math.round(m.sum(j,bins[i],edges[i]));
 const group=(keyOf,labelOf)=>{const map=new Map();for(const [s,j] of use){const key=keyOf(s),row=map.get(key)||{key,...labelOf(s),tokens:bins.map(()=>0)};
   bins.forEach((_,i)=>{const v=cell(j,i);row.tokens[i]=v===null||row.tokens[i]===null?null:row.tokens[i]+v;});map.set(key,row);}
  const rows=[...map.values()].sort((a,b)=>b.tokens.reduce((x,y)=>x+(y||0),0)-a.tokens.reduce((x,y)=>x+(y||0),0));
  if(rows.length<=12)return rows;const rest=rows.slice(12);
  return [...rows.slice(0,12),{key:'__other__',folded:rest.length,tokens:bins.map((_,i)=>rest.some(r=>r.tokens[i]===null)?null:rest.reduce((n,r)=>n+r.tokens[i],0))}];};
 const byModel=group(s=>s.model||'unknown',s=>({kind:s.kind})),byProject=group(s=>cwd(s.project,s.kind),s=>({label:s.project}));
 const total=bins.map((_,i)=>byModel.some(r=>r.tokens[i]===null)?null:byModel.reduce((n,r)=>n+r.tokens[i],0));
 const sumAll=(from,to)=>use.reduce((n,[,j])=>n+m.sum(j,from,to),0);
 const today=floorStep(now,'day'),hours=[];
 // Every hour of the last 30 days, today's later hours included as not yet known.
 for(let t=floorStep(today-29*DAY,'day');t<nextStep(today,'day');t+=3600)hours.push([day(t),new Date(t*1000).getHours(),t<covered||t>now?null:Math.round(sumAll(t,t+3600))]);
 const days=[];for(let t=floorStep(covered,'day');t<now;t=nextStep(t,'day'))days.push([day(t),Math.round(sumAll(t,nextStep(t,'day')))]);
 return {as_of:now,coverage:[{from:anchor-2*DAY,kind:null,source:'collector',to:now},{from:covered,kind:'Claude',source:'claude_transcripts',to:now},
  {from:covered,kind:'GLM',source:'claude_transcripts',to:now},{from:covered,kind:'Codex',source:'codex_sessions',to:now}],
  heatmap:{days,hours},import:{failed:0,files_done:412,files_total:412,running:false},
  series:{bins,by_model:byModel,by_project:byProject,end:now,start:bins[0]??now,step:String(step),total}};
}

/** A session's mailbox as POST /api/mailbox answers it: a reply, a request being written, and one waiting. */
export function demoMailbox(sessionId,now=Date.now()/1000,lang='ko'){
 if(sessionId!=='s1')return [];
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 return [{id:id(1),text:say('ask',lang),created:now-1500,changed:now-1440,status:'replied',reply:say('reply',lang),reply_at:now-1440,truncated:false,attachments:[],activity:null},
  {id:id(2),text:say('receipt',lang),created:now-300,changed:now-5,status:'awaiting_reply',reply:'',reply_at:null,truncated:false,attachments:[],activity:{phase:'writing',observed_at:now-5}},
  {id:id(3),text:say('tests',lang),created:now-60,changed:now-60,status:'queued',reply:'',reply_at:null,truncated:false,attachments:[],activity:null}];
}

if(import.meta.url===`file://${process.argv[1]}`)process.stdout.write(JSON.stringify(demoState(Number(process.argv[2])||Date.now()/1000,{period:process.argv[3]||'1h'})));
