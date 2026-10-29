// The /app?demo relay: three example computers whose relay snapshots keep arriving, and controls
// answered the way a computer answers them. It goes through the same adapter and control path as the
// signed-in relay (remote-live.js). Tool kinds, app names and model ids are the ones the collector
// reports (agent/onetop/discovery.py); every project, terminal and account name is invented.
const PERIODS=[['24h',86400],['12h',43200],['5h',18000],['1h',3600],['30m',1800],['10m',600]];
// Recent periods run busier than long ones, as a working day with breaks does.
const PACE={'10m':1.5,'30m':1.3,'1h':1,'5h':.8,'12h':.6,'24h':.45};
const LONGER=[900,7200,10800,21600,172800,259200,604800,1209600,2592000,7776000,15552000,31536000];
const HOURLY=600000; // tokens an hour for one unit of weight below
const total=v=>Array.isArray(v)?v.reduce((a,b)=>a+b,0):0;
const wave=(t,period,phase)=>Math.sin(t/period+phase);
const split=n=>{const v=[Math.round(n*.22),Math.round(n*.63),Math.round(n*.03)];return [...v,Math.round(n)-v.reduce((a,b)=>a+b,0)];};

const COMPUTERS=[
 {id:'demo-0',name:'MacBook Pro',platform:'Darwin',cores:12,memory:32,used:19,cpu:22,network:{interfaces:['en0'],rx:1.8*2**20,tx:420*2**10},disk:{total:2**40,free:410*2**30,read:3.1*2**20,write:1.2*2**20}},
 {id:'demo-1',name:'Mac mini',platform:'Darwin',cores:10,memory:24,used:15,cpu:35,network:{interfaces:['en0','en1'],rx:640*2**10,tx:120*2**10},disk:{total:2**39,free:188*2**30,read:.8*2**20,write:.3*2**20}},
 {id:'demo-2',name:'Workstation',platform:'Windows',cores:16,memory:64,used:38,cpu:41,network:{interfaces:['Ethernet'],rx:2.6*2**20,tx:780*2**10},disk:{total:2*2**40,free:1.1*2**40,read:5.4*2**20,write:2.2*2**20}},
];
// Two accounts for each of Claude Code and Codex. calibration: weekly % over the tokens of one reference hour.
const ACCOUNTS={
 claude1:{id:'demo-claude-4f1c2a',kind:'Claude',plan:'Max',weekly:61,five:24,calibration:{seconds:3600,used_pp:10,tokens:60e6}},
 claude2:{id:'demo-claude-9b07e3',kind:'Claude',plan:'Pro',weekly:33,five:41,calibration:{seconds:3600,used_pp:10,tokens:15e6}},
 codex1:{id:'demo-codex-61d8f0',kind:'Codex',plan:'Pro',weekly:72,calibration:{seconds:3600,used_pp:10,tokens:40e6}},
 codex2:{id:'demo-codex-c2a957',kind:'Codex',plan:'Plus',weekly:18,calibration:{seconds:3600,used_pp:10,tokens:20e6}},
};
// [computer, project, kind, app, terminal, model, effort, weight, status, account]. Gemini, Qwen Code,
// OpenCode and GitHub Copilot report sessions without token counts, as the collector sees them.
const SESSIONS=[
 [0,'checkout-web','Claude','Orca','Checkout UI','claude-opus-5-5','xhigh',30,'working','claude1'],
 [0,'api-gateway','Codex','Visual Studio Code','gateway','gpt-6-astra','high',18,'working','codex2'],
 [0,'design-tokens','Claude','Cursor','tokens','claude-sonnet-5-5','medium',7,'waiting','claude1'],
 [0,'ml-notebooks','Aside','Aside','','claude-opus-5-5','max',6,'working'],
 [0,'docs-site','GLM','Zed','docs','glm-5.3[1m]','high',5,'idle'],
 [0,'release-bot','Gemini','iTerm2','release','','',0,'unknown'],
 [0,'onboarding','Claude','Warp','onboard','claude-sonnet-5-5','medium',2,'idle','claude1'],
 [1,'billing-service','Codex','Orca','Billing API','gpt-6.1-sol','ultra',20,'working','codex1'],
 [1,'mobile-app','Claude','Orca','Mobile','claude-sonnet-5-5','high',9,'paused','claude2'],
 [1,'search-index','Antigravity','Ghostty','indexer','claude-sonnet-5-5','medium',4,'working'],
 [1,'data-pipeline','Codex','IntelliJ IDEA','etl','gpt-6-astra','low',3,'idle','codex1'],
 [1,'support-replies','Claude','Claude','','claude-haiku-5-5','low',2,'idle','claude2'],
 [1,'prototype','Qwen Code','Terminal','proto','','',0,'unknown'],
 [2,'game-engine','Claude','Windows Terminal','engine','claude-fable-5-1','max',14,'working','claude1'],
 [2,'infra-scripts','Codex','powershell','infra','gpt-6.1-sol','medium',6,'waiting','codex2'],
 [2,'analytics','GLM','Windsurf','analytics','glm-5.3[1m]','xhigh',4,'working'],
 [2,'ui-kit','OpenCode','Windows Terminal','ui','','',0,'unknown'],
 [2,'notes','GitHub Copilot','Visual Studio Code','copilot','','',0,'unknown'],
 [2,'research','Codex','ChatGPT','','gpt-6-astra','high',3,'idle','codex1'],
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

// Per-period token flow in the relay's bins (protocol.ts tokenFlow), shaped by a steady wave in time.
function flow(sessions,now){
 const result={},kinds=[...new Set(sessions.filter(s=>s.tokens).map(s=>s.kind))];
 for(const [key,seconds] of PERIODS){
  const step=seconds>18000?900:seconds>3600?300:60,n=seconds/step,end=Math.floor(now/step)*step+step;
  const bins=Array.from({length:n},()=>({}));
  kinds.forEach((kind,k)=>{
   const amount=sessions.filter(s=>s.kind===kind).reduce((sum,s)=>sum+total(s.windows?.[key]),0);if(!amount)return;
   const weights=bins.map((_,i)=>{const t=(end-seconds+i*step)/60;return 1+.45*wave(t,7,k*1.7)+.25*wave(t,2.3,k);});
   const sum=weights.reduce((a,b)=>a+b,0);weights.forEach((w,i)=>bins[i][kind]=Math.round(amount*w/sum));
  });
  result[key]={step,start:end-seconds,end,as_of:now,reported:true,bins};
 }
 return result;
}

function session([,project,kind,app,terminal,model,effort,weight,status,account],index,now,started,control){
 const id='demo-'+project,current=control?.status||status,tracked=weight>0,elapsed=now-started;
 const windows=tracked?Object.fromEntries(PERIODS.map(([key,seconds])=>[key,split(weight*HOURLY*PACE[key]*seconds/3600*(1+.06*wave(now,180,index+key.length)))])):{};
 const rate=tracked&&current==='working'?Math.round(weight*HOURLY*PACE['10m']/3600*(1+.3*wave(now,45,index))):tracked?0:null;
 const s={id,control_key:'demo-'+index,kind,app,terminal,project,title:project+' · '+kind,model,effort:effort||null,status:current,
  tokens:tracked?split(weight*HOURLY*PACE['24h']*24*6+(current==='working'?weight*HOURLY*PACE['10m']/3600*elapsed:0)):null,rate,windows,
  cpu:current==='working'?Math.round((4+index%5*2.2+wave(now,17,index))*10)/10:status==='unknown'?.6:.3,rss:(160+index*24)*2**20,
  context_usage:tracked?{basis:'last_request_input',input_tokens:64000+index*6000,capacity:kind==='Codex'?400000:kind==='Claude'?1000000:null,parts:[12000+index*2000,48000+index*4000,4000],observed_at:now,model}:null,
  root_session_id:id,parent_session_id:null,account};
 s.capabilities=capabilities(s);
 return s;
}

// One report from every example computer at time now. Controls already answered stay applied.
function report(now,started,controls){
 return COMPUTERS.map((computer,c)=>{
  let sessions=SESSIONS.map((row,i)=>[row,i]).filter(([row])=>row[0]===c).map(([row,i])=>session(row,i,now,started,controls.get('demo-'+row[1])));
  for(const [lead,name,share,status] of CHILDREN){
   const parent=sessions.find(s=>s.project===lead);if(!parent)continue;
   sessions.push({...parent,id:parent.id+'-'+name,control_key:'',terminal:'',status,capabilities:[],cpu:null,rss:null,
    tokens:parent.tokens.map(v=>Math.round(v*share)),rate:status==='working'?Math.round(parent.rate*share):0,
    windows:Object.fromEntries(Object.entries(parent.windows).map(([k,v])=>[k,v.map(n=>Math.round(n*share))])),root_session_id:parent.id,parent_session_id:parent.id});
  }
  sessions=sessions.filter(s=>!controls.get(s.root_session_id)?.removed);
  const accounts=[...new Set(sessions.map(s=>s.account).filter(Boolean))].map(key=>ACCOUNTS[key]);
  for(const s of sessions){
   const a=ACCOUNTS[s.account];delete s.account;if(!a||!s.tokens)continue;
   const ratio=a.calibration.used_pp/a.calibration.tokens;
   s.weekly_account=a.id;
   s.weekly_estimate=Object.fromEntries(PERIODS.map(([key,seconds])=>{const tokens=total(s.windows[key]);
    return [key,{used_pp:Math.round(tokens*ratio*1e4)/1e4,partial:false,period_seconds:seconds,tokens,account_id:a.id,calibration:{...a.calibration,pp_per_token:ratio,confidence:'limited',from:now-7200,to:now-3600,valid_until:now+86400,source:''}}];}));
  }
  const periods=PERIODS.map(([key,seconds])=>({key,label:key,tokens:[0,1,2,3].map(j=>sessions.reduce((n,s)=>n+(s.windows?.[key]?.[j]||0),0)),partial:false,observed_seconds:seconds}));
  const day=total(periods[0].tokens),hour=total(periods[3].tokens),elapsed=now-started;
  return {id:computer.id,name:computer.name,platform:computer.platform,online:true,received:now*1000,snapshot:{
   version:'demo',updated:now,recording_started:started-259200,sessions,periods,flow:flow(sessions,now),
   speed_periods:[...periods.map(p=>({key:p.key,seconds:p.observed_seconds,tokens:total(p.tokens),known:true,partial:false})),
    ...LONGER.map(seconds=>({key:'custom:'+seconds,seconds,tokens:Math.round(seconds<86400?hour*seconds/3600*.9:day*seconds/86400*.7),known:true,partial:seconds>259200})),
    {key:'all',seconds:now-started+259200,tokens:Math.round(day*2.4),known:true,partial:false}],
   host:{cpu:Math.round((computer.cpu+6*wave(now,20,c))*10)/10,used_memory:Math.round(computer.used*2**30*(1+.03*wave(now,60,c))),total_memory:computer.memory*2**30,cores:computer.cores,
    network:{interfaces:computer.network.interfaces,rx:computer.network.rx*(1+.4*wave(now,9,c)),tx:computer.network.tx*(1+.3*wave(now,13,c))},disk:computer.disk},
   applications:[...new Set([...sessions.map(s=>s.app),...(computer.platform==='Windows'?['Windows Terminal','powershell']:['Terminal','Orca'])])].map(name=>({name,evidence:'application_process'})),
   operations:{updated:now,loop_state:'not_verified',skill_runtime:'partial',...GOALS[c]},
   account_quotas:accounts.map(a=>{
    const used=key=>sessions.filter(s=>s.weekly_account===a.id).reduce((n,s)=>n+(s.weekly_estimate[key]?.used_pp||0),0),pct=Math.round((a.weekly+elapsed/3600*.4)*10)/10,last=Math.min(pct,used('24h'));
    return {id:a.id,kind:a.kind,account_label:a.kind+' · '+a.id.slice(-6),plan:a.plan,updated:now,stale:false,note:'',status:'',
     windows:[...(a.five?[{label:'5H',pct:Math.round((a.five+elapsed/3600*2)*10)/10,reset:started+8040}]:[]),{label:'Weekly',pct,reset:started+172800}],
     weekly:Object.fromEntries(PERIODS.map(([key,seconds])=>[key,{used_pp:Math.round(used(key)*100)/100,observed_seconds:seconds,partial:false}])),
     usage_points:Array.from({length:145},(_,i)=>{const t=now-86400+i*600;return [t,Math.round((pct-last+last*i/144)*10)/10,0];})};
   }),
  }};
 });
}

// The demo relay: the same interface as remote-live.js. Controls are confirmed after a moment, as a
// computer confirms them, and change only this page.
export function demoRelay(){
 const started=Date.now()/1000,controls=new Map(),results=new Set(),mailboxes=new Map();
 let devices=report(started,started,controls);
 setInterval(()=>{devices=report(Date.now()/1000,started,controls);},3000);
 return {
  devices:()=>devices,
  async send(command){
   await new Promise(done=>setTimeout(done,400));
   if(command.action==='message')return converse(command);
   setTimeout(()=>{
    const key=command.session_id;
    if(command.action==='pause')controls.set(key,{status:'paused'});
    if(command.action==='resume')controls.set(key,{status:'working'});
    if(command.action==='terminate')controls.set(key,{removed:true});
    if(command.action!=='focus')devices=report(Date.now()/1000,started,controls);
    for(const listener of results)listener({type:'result',request:command,status:'completed',message:ANSWERS[command.action]||'',created:Date.now()});
   },900);
   return {status:'sent'};
  },
  onResult:listener=>results.add(listener),
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
