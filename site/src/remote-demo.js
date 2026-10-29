// The /app?demo relay: three example computers whose relay snapshots keep arriving, and controls
// answered the way a computer answers them. It goes through the same adapter and control path as the
// signed-in relay (remote-live.js). Tool kinds, app names and model ids are the ones the collector
// reports (agent/onetop/discovery.py); every project, terminal and account name is invented.
// Token use follows demo-usage.js: bursts and pauses, resting hours, one session carrying most of it.
import {usage,since,bins,vector} from './demo-usage.js';
const PERIODS=[['24h',86400],['12h',43200],['5h',18000],['1h',3600],['30m',1800],['10m',600]];
const LONGER=[900,7200,10800,21600,172800,259200,604800,1209600,2592000,7776000,15552000,31536000];
const total=v=>Array.isArray(v)?v.reduce((a,b)=>a+b,0):0;

const COMPUTERS=[
 {id:'demo-0',name:'MacBook Pro',seed:23,scale:1.3e6,duty:1,platform:'Darwin',cores:12,memory:32,used:19,cpu:22,network:{interfaces:['en0'],rx:1.8*2**20,tx:420*2**10},disk:{total:2**40,free:410*2**30,read:3.1*2**20,write:1.2*2**20}},
 {id:'demo-1',name:'Mac mini',seed:61,scale:.3e6,duty:.2,platform:'Darwin',cores:10,memory:24,used:15,cpu:35,network:{interfaces:['en0','en1'],rx:640*2**10,tx:120*2**10},disk:{total:2**39,free:188*2**30,read:.8*2**20,write:.3*2**20}},
 {id:'demo-2',name:'Workstation',seed:37,scale:.6e6,duty:.3,platform:'Windows',cores:16,memory:64,used:38,cpu:41,network:{interfaces:['Ethernet'],rx:2.6*2**20,tx:780*2**10},disk:{total:2*2**40,free:1.1*2**40,read:5.4*2**20,write:2.2*2**20}},
];
// Two accounts for each of Claude Code and Codex. per: weekly percent per token, set once from a typical
// week of this demo, so a limit is the tokens of its weekly window times per and moves with the work.
// reset: seconds after the demo opened (the window began 7 days before); five: the 5-hour window's reset
// and its percent per weekly percent.
const ACCOUNTS={
 claude1:{id:'demo-claude-4f1c2a',kind:'Claude',plan:'Max',per:1.1e-8,reset:276000,five:{reset:8040,factor:6}},
 claude2:{id:'demo-claude-9b07e3',kind:'Claude',plan:'Pro',per:3.3e-7,reset:311000,five:{reset:14200,factor:6}},
 codex1:{id:'demo-codex-61d8f0',kind:'Codex',plan:'Pro',per:4.2e-7,reset:250000},
 codex2:{id:'demo-codex-c2a957',kind:'Codex',plan:'Plus',per:2.7e-8,reset:337000},
};
const calibration=a=>({seconds:3600,used_pp:10,tokens:Math.round(10/a.per)});
// [computer, project, kind, app, terminal, model, effort, weight, status, account]. weight is a session's
// usual share of its computer. Gemini, Qwen Code, OpenCode and GitHub Copilot report sessions without
// token counts, as the collector sees them.
const SESSIONS=[
 [0,'checkout-web','Claude','Orca','Checkout UI','claude-opus-5-5','xhigh',30,'working','claude1'],
 [0,'api-gateway','Codex','Visual Studio Code','gateway','gpt-6-astra','high',5,'working','codex2'],
 [0,'design-tokens','Claude','Cursor','tokens','claude-sonnet-5-5','medium',7,'waiting','claude1'],
 [0,'ml-notebooks','Aside','Aside','','claude-opus-5-5','max',1.5,'working'],
 [0,'docs-site','GLM','Zed','docs','glm-5.3[1m]','high',2,'idle'],
 [0,'release-bot','Gemini','iTerm2','release','','',0,'unknown'],
 [0,'onboarding','Claude','Warp','onboard','claude-sonnet-5-5','medium',3,'idle','claude1'],
 [1,'billing-service','Codex','Orca','Billing API','gpt-6.1-sol','ultra',12,'working','codex1'],
 [1,'mobile-app','Claude','Orca','Mobile','claude-sonnet-5-5','high',9,'paused','claude2'],
 [1,'search-index','Antigravity','Ghostty','indexer','claude-sonnet-5-5','medium',2,'working'],
 [1,'data-pipeline','Codex','IntelliJ IDEA','etl','gpt-6-astra','low',3,'idle','codex1'],
 [1,'support-replies','Claude','Claude','','claude-haiku-5-5','low',2,'idle','claude2'],
 [1,'prototype','Qwen Code','Terminal','proto','','',0,'unknown'],
 [2,'game-engine','Claude','Windows Terminal','engine','claude-fable-5-1','max',14,'working','claude1'],
 [2,'infra-scripts','Codex','powershell','infra','gpt-6.1-sol','medium',3,'waiting','codex2'],
 [2,'analytics','GLM','Windsurf','analytics','glm-5.3[1m]','xhigh',1.5,'working'],
 [2,'ui-kit','OpenCode','Windows Terminal','ui','','',0,'unknown'],
 [2,'notes','GitHub Copilot','Visual Studio Code','copilot','','',0,'unknown'],
 [2,'research','Codex','ChatGPT','','gpt-6-astra','high',1,'idle','codex1'],
];
// Subagents under a lead session: [lead project, name, share of the lead, status].
const CHILDREN=[['checkout-web','reviewer',.2,'working'],['checkout-web','tester',.1,'idle'],['billing-service','migrator',.25,'working']];
const GOALS=[
 {installed_skills:14,observed_events:9,goals:[{thread_id:'demo-goal-1',runtime:'Codex',status:'active',tokens_used:18.4e6,time_used_seconds:6300,session_connected:true,evidence:'reported'}]},
 {installed_skills:8,observed_events:3,goals:[{thread_id:'demo-goal-2',runtime:'Claude Code',status:'complete',tokens_used:6.2e6,time_used_seconds:2700,session_connected:false,evidence:'last_observed'}]},
 {installed_skills:11,observed_events:5,goals:[{thread_id:'demo-goal-3',runtime:'Codex',status:'paused',tokens_used:9.1e6,time_used_seconds:4100,session_connected:true,evidence:'reported'}]},
];
// What a computer answers to each control (agent/onetop/controls.py).
const ANSWERS={
 focus:'Sent a request to bring the host application forward on that computer.',
 pause:'작업이 멈춘 것을 확인했습니다. 세션을 보존했으며, 재개 버튼으로 새 요청을 보낼 수 있습니다.',
 resume:'이어서 작업하는 새 요청을 보냈습니다.',
 terminate:'CLI 종료를 확인했습니다. Orca 탭과 대화 기록은 유지됩니다.',
 prompt:'AI 지시를 보냈고 새 작업 시작을 확인했습니다.',
};
// The controls a computer offers for a session (agent/onetop/bridge.py export_snapshot). A paused
// session is idle underneath, as the collector reports it.
function capabilities(s){
 if(!s.control_key)return [];
 const orca=s.app==='Orca',tool=['Claude','GLM','Codex'].includes(s.kind),active=['working','waiting'].includes(s.status),canPause=orca&&tool,caps=['focus'];
 const state=s.status==='paused'?'idle':s.status,instruction=s.kind==='Aside'?['working','idle','interrupted'].includes(state):orca&&tool&&['idle','interrupted'].includes(state);
 if((canPause||s.kind==='Aside')&&active)caps.push('pause');
 if(canPause&&s.status==='paused')caps.push('resume');
 if(instruction)caps.push('prompt');
 if(s.tokens&&(tool||s.kind==='Aside')){caps.push('mailbox');if(instruction||orca&&tool&&['working','idle','interrupted'].includes(state)){caps.push('message');if(tool)caps.push('message_images');}}
 if(s.kind!=='Aside'&&(!orca||['idle','paused'].includes(s.status)||canPause&&active))caps.push('terminate');
 return caps;
}
// What a session answers in the demo, in the page's language: session content, not interface text.
const REPLY={ko:'예시 답신: 첫 검사를 마쳤고 남은 오류를 확인하고 있습니다.',en:'Demo reply: I have finished the first checks and am reviewing the remaining failures.',zh:'示例回复：第一轮检查已完成，正在查看剩余的错误。'};
const PHOTO_REPLY={ko:' 보내 주신 사진도 확인했습니다.',en:' I have looked at the photos too.',zh:' 也已查看您发送的照片。'};
const pageLanguage=()=>{const lang=globalThis.document?.documentElement.lang||'ko';return lang.startsWith('zh')?'zh':lang==='en'?'en':'ko';};

// When a session takes part in its computer's work: working sessions all along, the others until they
// stopped a while before the demo opened. A pause or an end from this page stops it then; what it used
// before stays in its computer's history, as a collector keeps ended sessions' tokens.
function stream(weight,status,index,started,control){
 const start=index%4===3?started-(5+index%7)*3600:started-30*3600;
 const stop=control?.removed||control?.status==='paused'?control.at:control?.status==='working'?Infinity:
  status==='waiting'?started-(2+index%4)*60:status==='paused'?started-12*60:status==='idle'?started-(40+index*37%180)*60:Infinity;
 return {weight,start,stop};
}

function session([,project,kind,app,terminal,model,effort,weight,status,account],index,now,control,u,j,base,started){
 const id='demo-'+project,current=control?.status||status,tracked=weight>0;
 const windows=tracked?Object.fromEntries(PERIODS.map(([key,seconds])=>[key,vector(since(u,j,now-seconds))])):{};
 const recent=tracked?since(u,j,now-600):0,lastMinute=tracked?u.minutes[j].at(-2):0;
 const s={id,control_key:'demo-'+index,kind,app,terminal,project,title:project+' · '+kind,model,effort:effort||null,status:current,
  tokens:tracked?vector(base+since(u,j,started)):null,rate:tracked?current==='working'?Math.round(recent/600):0:null,windows,
  cpu:current==='working'?Math.round((1.5+Math.min(30,lastMinute/4e4)+index%5*.7)*10)/10:status==='unknown'?.6:.3,rss:(160+index*24)*2**20,
  context_usage:tracked?{basis:'last_request_input',input_tokens:64000+index*6000,capacity:kind==='Codex'?400000:kind==='Claude'?1000000:null,parts:[12000+index*2000,48000+index*4000,4000],observed_at:now,model}:null,
  root_session_id:id,parent_session_id:null,account};
 s.capabilities=capabilities(s);
 return s;
}

// One report from every example computer at time now. Controls already answered stay applied.
// bases: each session's tokens before the demo opened, fixed on first sight so totals only grow.
function report(now,started,controls,bases){
 const machines=COMPUTERS.map((computer,c)=>{
  const rows=SESSIONS.map((row,i)=>[row,i]).filter(([row])=>row[0]===c);
  // Subagents share their lead's work: [row index of the lead, name, share, status].
  const children=CHILDREN.map(([lead,name,share,status])=>[rows.findIndex(([row])=>row[1]===lead),name,share,status]).filter(([k])=>k>=0);
  // Earlier sessions of each account on this computer, closed before the shown ones began: they fill
  // the weekly windows and never show in the last day.
  const earlier=[...new Set(rows.map(([row])=>row[9]).filter(Boolean))].map(key=>({key,weight:rows.reduce((n,[row])=>n+(row[9]===key?row[7]:0),0)}));
  const streams=[...rows.map(([row,i])=>stream(row[7],row[8],i,started,controls.get('demo-'+row[1]))),
   ...children.map(([k,,share,status])=>{const lead=stream(rows[k][0][7],rows[k][0][8],rows[k][1],started,controls.get('demo-'+rows[k][0][1]));
    return {...lead,weight:lead.weight*share,stop:status==='working'?lead.stop:Math.min(lead.stop,started-25*60)};}),
   ...earlier.map(({weight})=>({weight,start:started-8*86400,stop:started-30*3600}))];
  const owners=[...rows.map(([row])=>ACCOUNTS[row[9]]?.id),...children.map(([k])=>ACCOUNTS[rows[k][0][9]]?.id),...earlier.map(({key})=>ACCOUNTS[key].id)];
  // One person's computers rest together (seed 7), and that person is at work when the demo opens.
  const u=usage(computer.seed,computer.scale,streams,now,started,7,computer.duty);
  // Each stream's tokens from its account's weekly window start until the demo opened, read once.
  if(!bases.has('week:'+computer.id)){const long=usage(computer.seed,computer.scale,streams,started,started,7,computer.duty,true,8*1440+15);
   bases.set('week:'+computer.id,owners.map((owner,j)=>{const a=Object.values(ACCOUNTS).find(x=>x.id===owner);return a?since(long,j,started+a.reset-604800):0;}));}
  const week=bases.get('week:'+computer.id);
  const base=(key,j)=>{if(!bases.has(key))bases.set(key,streams[j].weight*6e7+since(u,j,now-86400));return bases.get(key);};
  let sessions=rows.map(([row,i],j)=>session(row,i,now,controls.get('demo-'+row[1]),u,j,base('demo-'+row[1],j),started));
  children.forEach(([k,name,,status],n)=>{const parent=sessions[k],j=rows.length+n,id=parent.id+'-'+name,windows=Object.fromEntries(PERIODS.map(([key,seconds])=>[key,vector(since(u,j,now-seconds))]));
   sessions.push({...parent,id,control_key:'',terminal:'',status,capabilities:[],cpu:null,rss:null,
    tokens:vector(base(id,j)+since(u,j,started)),rate:status==='working'?Math.round(since(u,j,now-600)/600):0,windows,root_session_id:parent.id,parent_session_id:parent.id});});
  return {computer,c,u,sessions,controls,owners,week};
 });
 // An account's tokens since a moment over every computer it works on, and its weekly percent: the
 // tokens of its weekly window (before the demo opened, then since) times its per-token percent.
 const used=(id,from)=>machines.reduce((n,m)=>n+m.owners.reduce((k,owner,j)=>k+(owner===id?since(m.u,j,from):0),0),0);
 const weekly=a=>(machines.reduce((n,m)=>n+m.owners.reduce((k,owner,j)=>k+(owner===a.id?m.week[j]:0),0),0)+used(a.id,started))*a.per;
 return machines.map(({computer,c,u,sessions})=>{
  const accounts=[...new Set(sessions.filter(s=>!controls.get(s.root_session_id)?.removed).map(s=>s.account).filter(Boolean))].map(key=>ACCOUNTS[key]);
  for(const s of sessions){
   const a=ACCOUNTS[s.account];delete s.account;if(!a||!s.tokens)continue;
   const ratio=a.per;
   s.weekly_account=a.id;
   s.weekly_estimate=Object.fromEntries(PERIODS.map(([key,seconds])=>{const tokens=total(s.windows[key]);
    return [key,{used_pp:Math.round(tokens*ratio*1e4)/1e4,partial:false,period_seconds:seconds,tokens,account_id:a.id,calibration:{...calibration(a),pp_per_token:ratio,confidence:'limited',from:now-7200,to:now-3600,valid_until:now+86400,source:''}}];}));
  }
  const periods=PERIODS.map(([key,seconds])=>({key,label:key,tokens:[0,1,2,3].map(j=>sessions.reduce((n,s)=>n+(s.windows?.[key]?.[j]||0),0)),partial:false,observed_seconds:seconds}));
  const day=total(periods[0].tokens),kinds=sessions.map(s=>s.tokens?s.kind:null);
  const shown=sessions.filter(s=>!controls.get(s.root_session_id)?.removed);
  const flow=Object.fromEntries(PERIODS.map(([key,seconds])=>{const step=seconds>18000?900:seconds>3600?300:60;return [key,{step,...bins(u,kinds,now,seconds,step),as_of:now,reported:true}];}));
  // The host is as busy as its last minute of tokens.
  const busy=Math.min(1,u.minutes.reduce((n,row)=>n+row.at(-2),0)/(computer.scale*3));
  return {id:computer.id,name:computer.name,platform:computer.platform,online:true,received:now*1000,snapshot:{
   version:'demo',updated:now,recording_started:started-259200,sessions:shown,periods,flow,
   speed_periods:[...periods.map(p=>({key:p.key,seconds:p.observed_seconds,tokens:total(p.tokens),known:true,partial:false})),
    ...LONGER.map(seconds=>({key:'custom:'+seconds,seconds,tokens:Math.round(seconds<=86400?sessions.reduce((n,s,j)=>n+(s.tokens?since(u,j,now-seconds):0),0):day*seconds/86400*.7),known:true,partial:seconds>259200})),
    {key:'all',seconds:now-started+259200,tokens:Math.round(day*2.4),known:true,partial:false}],
   host:{cpu:Math.round((computer.cpu*.35+48*busy)*10)/10,used_memory:Math.round(computer.used*2**30*(1+.04*busy)),total_memory:computer.memory*2**30,cores:computer.cores,
    network:{interfaces:computer.network.interfaces,rx:computer.network.rx*(.2+1.4*busy),tx:computer.network.tx*(.2+1.2*busy)},disk:computer.disk},
   applications:[...new Set([...shown.map(s=>s.app),...(computer.platform==='Windows'?['Windows Terminal','powershell']:['Terminal','Orca'])])].map(name=>({name,evidence:'application_process'})),
   operations:{updated:now,loop_state:'not_verified',skill_runtime:'partial',...GOALS[c]},
   account_quotas:accounts.map(a=>{
    // Providers report limits in whole percent, so the windows and their history are whole numbers.
    const ratio=a.per,round=n=>Math.round(n),exact=weekly(a),pct=round(exact);
    return {id:a.id,kind:a.kind,account_label:a.kind+' · '+a.id.slice(-6),plan:a.plan,updated:now,stale:false,note:'',status:'',
     windows:[...(a.five?[{label:'5H',pct:Math.min(100,round(used(a.id,started+a.five.reset-18000)*ratio*a.five.factor)),reset:started+a.five.reset}]:[]),{label:'Weekly',pct,reset:started+a.reset}],
     weekly:Object.fromEntries(PERIODS.map(([key,seconds])=>[key,{used_pp:Math.round(used(a.id,now-seconds)*ratio*1e4)/1e4,observed_seconds:seconds,partial:false}])),
     usage_points:Array.from({length:145},(_,i)=>{const t=now-86400+i*600;return [t,Math.max(0,round(exact-used(a.id,t)*ratio)),started+a.reset];})};
   }),
  }};
 });
}

// The demo relay: the same interface as remote-live.js. Controls are confirmed after a moment, as a
// computer confirms them, and change only this page.
export function demoRelay(){
 const started=Date.now()/1000,controls=new Map(),results=new Set(),mailboxes=new Map(),removed=new Set(),bases=new Map();
 const reportNow=()=>report(Date.now()/1000,started,controls,bases).filter(d=>!removed.has(d.id));
 let devices=report(started,started,controls,bases);
 setInterval(()=>{devices=reportNow();},3000);
 return {
  devices:()=>devices,
  async send(command){
   await new Promise(done=>setTimeout(done,400));
   if(command.action==='message')return converse(command);
   setTimeout(()=>{
    const key=command.session_id;
    if(command.action==='pause')controls.set(key,{status:'paused',at:Date.now()/1000});
    if(command.action==='resume')controls.set(key,{status:'working',at:Date.now()/1000});
    if(command.action==='terminate')controls.set(key,{removed:true,at:Date.now()/1000});
    if(command.action!=='focus')devices=reportNow();
    for(const listener of results)listener({type:'result',request:command,status:'completed',message:ANSWERS[command.action]||'',created:Date.now()});
   },900);
   return {status:'sent'};
  },
  onResult:listener=>results.add(listener),
  // The demo's computers leave this page only; a reload brings them back.
  async revoke(id){await new Promise(done=>setTimeout(done,600));removed.add(id);devices=devices.filter(d=>d.id!==id);},
  // The session's latest messages, as the computer reads them: at most ten recently changed rows.
  async mailbox(request){
   await new Promise(done=>setTimeout(done,250));
   return [...(mailboxes.get(request.session_id)||[])].sort((a,b)=>b.changed-a.changed).slice(0,10).sort((a,b)=>a.created-b.created).map(({changed,...row})=>({...row}));
  },
  signOut:async()=>{},
 };
 // A message waits for a working session's turn, then the session prepares, works and writes its
 // reply, a few seconds each, so every delivery state and the typing indicator can be seen.
 function converse(command){
  const rows=mailboxes.get(command.session_id)||[];mailboxes.set(command.session_id,rows);
  if(rows.some(r=>r.id===command.request_id))return {status:'sent'};
  const session=devices.flatMap(d=>d.snapshot.sessions).find(s=>s.id===command.session_id),now=()=>Date.now()/1000;
  const row={id:command.request_id,text:command.prompt,created:now(),changed:now(),status:session?.status==='working'?'queued':'awaiting_reply',reply:'',reply_at:null,truncated:false,activity:null,
   attachments:(command.attachments||[]).map((a,i)=>({id:String(i).padStart(64,'0'),name:`photo-${i+1}.jpg`,mime:a.mime,bytes:Math.floor(a.data.length*3/4)}))};
  rows.push(row);
  const steps=[...(row.status==='queued'?[()=>{row.status='awaiting_reply';}]:[]),...['responding','working','writing'].map(phase=>()=>{row.activity={phase,observed_at:now()};}),
   ()=>{const lang=pageLanguage();row.status='replied';row.activity=null;row.reply=REPLY[lang]+(row.attachments.length?PHOTO_REPLY[lang]:'');row.reply_at=now();}];
  steps.forEach((step,i)=>setTimeout(()=>{step();row.changed=now();},2500*(i+1)));
  return {status:'sent'};
 }
}
