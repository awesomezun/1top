// The /app?demo relay: the demo world's three computers (demo-world.js), whose relay snapshots keep
// arriving, and controls answered the way a computer answers them. It goes through the same adapter and
// control path as the signed-in relay (remote-live.js). The numbers come from demo-model.js, the same
// steps the desktop demo collector and both phones take, so every surface shows the same world.
import {bins,vector} from './demo-usage.js';
import {WORLD} from './demo-world.js';
import {machines,accounts as worldAccounts,sessionNumbers,capabilities,host,DAY} from './demo-model.js';
const PERIODS=[['24h',86400],['12h',43200],['5h',18000],['1h',3600],['30m',1800],['10m',600]];
const LONGER=[900,7200,10800,21600,172800,259200,604800,1209600,2592000,7776000,15552000,31536000];
const total=v=>Array.isArray(v)?v.reduce((a,b)=>a+b,0):0;
const calibration=a=>({seconds:3600,used_pp:10,tokens:Math.round(10/a.per)});
// What a computer answers to each control (agent/onetop/controls.py).
const ANSWERS={
 focus:'Sent a request to bring the host application forward on that computer.',
 pause:'작업이 멈춘 것을 확인했습니다. 세션을 보존했으며, 재개 버튼으로 새 요청을 보낼 수 있습니다.',
 resume:'이어서 작업하는 새 요청을 보냈습니다.',
 terminate:'CLI 종료를 확인했습니다. Orca 탭과 대화 기록은 유지됩니다.',
 prompt:'AI 지시를 보냈고 새 작업 시작을 확인했습니다.',
};
// What a session answers in the demo, in the page's language: session content, not interface text.
const REPLY={ko:'예시 답신: 첫 검사를 마쳤고 남은 오류를 확인하고 있습니다.',en:'Demo reply: I have finished the first checks and am reviewing the remaining failures.',zh:'示例回复：第一轮检查已完成，正在查看剩余的错误。'};
const PHOTO_REPLY={ko:' 보내 주신 사진도 확인했습니다.',en:' I have looked at the photos too.',zh:' 也已查看您发送的照片。'};
const pageLanguage=()=>{const lang=globalThis.document?.documentElement.lang||'ko';return lang.startsWith('zh')?'zh':lang==='en'?'en':'ko';};


// One report from every computer at time now. Controls already answered stay applied; an ended session
// leaves the list but its tokens stay in its computer's history.
function report(now,started,controls){
 const all=machines(now,started,{controls}),limits=worldAccounts(all,now,started),limitOf=key=>limits.find(a=>a.key===key);
 return all.map(m=>{
  const {computer,c,u,list}=m,rows=WORLD.sessions.filter(r=>r[0]===c);
  const sessions=list.map((s,j)=>{
   if(s.earlier)return null;
   const row=rows.find(r=>r[1]===(s.child?.lead||s.id)),[,,kind,project,model,,,weight,app,terminal,effort]=row,i=WORLD.sessions.indexOf(row);
   const control=controls.get(row[1]),status=s.child?s.child.status:control?.status||row[5],tracked=weight>0,n=tracked?sessionNumbers(m,j,now,started,PERIODS):null;
   const out={id:s.id,control_key:s.child?'':'demo-'+i,kind,app,terminal:s.child?'':terminal,project,title:project+' · '+kind,model,effort:effort||null,status,
    tokens:n?.tokens||null,rate:n?status==='working'?n.rate:0:null,windows:n?.windows||{},
    cpu:s.child?null:status==='working'?Math.round((1.5+Math.min(30,u.minutes[j].at(-2)/4e4)+i%5*.7)*10)/10:status==='unknown'?.6:.3,rss:s.child?null:(160+i*24)*2**20,
    context_usage:tracked?{basis:'last_request_input',input_tokens:64000+i*6000,capacity:kind==='Codex'?400000:kind==='Claude'?1000000:null,parts:[12000+i*2000,48000+i*4000,4000],observed_at:now,model}:null,
    root_session_id:s.child?s.child.lead:s.id,parent_session_id:s.child?s.child.lead:null};
   out.capabilities=s.child?[]:capabilities(out);
   const a=s.account&&limitOf(s.account);
   if(a&&out.tokens){out.weekly_account=a.id;out.weekly_estimate=Object.fromEntries(PERIODS.map(([key,seconds])=>{const tokens=total(out.windows[key]);
    return [key,{used_pp:Math.round(tokens*a.per*1e4)/1e4,partial:false,period_seconds:seconds,tokens,account_id:a.id,calibration:{...calibration(a),pp_per_token:a.per,confidence:'limited',from:now-7200,to:now-3600,valid_until:now+86400,source:''}}];}));}
   return out;
  }).filter(Boolean);
  const periods=PERIODS.map(([key,seconds])=>({key,label:key,tokens:[0,1,2,3].map(k=>sessions.reduce((n,s)=>n+(s.windows?.[key]?.[k]||0),0)),partial:false,observed_seconds:seconds}));
  const day=total(periods[0].tokens),kinds=list.map(s=>s.weight>0?s.kind:null);
  const shown=sessions.filter(s=>!controls.get(s.root_session_id)?.removed);
  const flow=Object.fromEntries(PERIODS.map(([key,seconds])=>{const step=seconds>18000?900:seconds>3600?300:60;return [key,{step,...bins(u,kinds,now,seconds,step),as_of:now,reported:true}];}));
  const h=host(m,now);
  const used=new Set(shown.map(s=>rows.find(r=>r[1]===s.root_session_id)?.[6]).filter(Boolean));
  return {id:computer.id,name:computer.name,platform:computer.platform,online:true,received:now*1000,snapshot:{
   version:'demo',updated:now,recording_started:started-259200,sessions:shown,periods,flow,
   speed_periods:[...periods.map(p=>({key:p.key,seconds:p.observed_seconds,tokens:total(p.tokens),known:true,partial:false})),
    ...LONGER.map(seconds=>({key:'custom:'+seconds,seconds,tokens:Math.round(seconds<=86400?list.reduce((n,s,j)=>n+(s.weight>0&&!s.earlier?m.sum(j,now-seconds):0),0):day*seconds/86400*.7),known:true,partial:seconds>259200})),
    {key:'all',seconds:now-started+259200,tokens:Math.round(day*2.4),known:true,partial:false}],
   host:{cpu:h.cpu,used_memory:h.used_memory,total_memory:h.total_memory,cores:h.cores,network:{interfaces:computer.network.interfaces,rx:h.rx,tx:h.tx},disk:computer.disk},
   applications:[...new Set([...shown.map(s=>s.app),...(computer.platform==='Windows'?['Windows Terminal','powershell']:['Terminal','Orca'])])].map(name=>({name,evidence:'application_process'})),
   operations:{updated:now,loop_state:'not_verified',skill_runtime:'partial',...WORLD.operations[c]},
   // The relay names an account by its tool and the end of its id; the computer itself shows the e-mail.
   account_quotas:limits.filter(a=>used.has(a.key)).map(a=>({id:a.id,kind:a.kind,account_label:a.kind+' · '+a.id.slice(-6),plan:a.plan,updated:a.reportAt,stale:!!a.stale,note:'',status:a.status||'',...(a.alias?{alias:a.alias}:{}),
    windows:[...(a.five!==null?[{label:'5H',pct:a.five,reset:a.fiveReset}]:[]),{label:'Weekly',pct:a.weekly,reset:a.resetAt}],
    weekly:Object.fromEntries(PERIODS.map(([key,seconds])=>[key,{used_pp:Math.round(a.used(now-seconds)*a.per*1e4)/1e4,observed_seconds:seconds,partial:false}])),
    usage_points:Array.from({length:Math.floor((a.reportAt-a.start)/600)+1},(_,k)=>{const t=a.start+k*600;return [t,Math.round(a.used(a.start,t)*a.per),a.resetAt];})})),
  }};
 });
}

// The demo relay: the same interface as remote-live.js. Controls are confirmed after a moment, as a
// computer confirms them, and change only this page.
// demoNow (seconds) holds the demo at one moment, for screenshots taken alike on every surface: the
// web page (/app?demo&demoNow=…), the desktop demo collector and both phones' QA options take the same.
export function demoRelay({demoNow=null}={}){
 const clock=()=>demoNow??Date.now()/1000,started=clock(),controls=new Map(),results=new Set(),mailboxes=new Map(),removed=new Set();
 const reportNow=()=>report(clock(),started,controls).filter(d=>!removed.has(d.id));
 let devices=report(started,started,controls);
 setInterval(()=>{devices=reportNow();},3000);
 return {
  devices:()=>devices,
  async send(command){
   await new Promise(done=>setTimeout(done,400));
   if(command.action==='message')return converse(command);
   setTimeout(()=>{
    const key=command.session_id;
    if(command.action==='pause')controls.set(key,{status:'paused',at:clock()});
    if(command.action==='resume')controls.set(key,{status:'working',at:clock()});
    if(command.action==='terminate')controls.set(key,{removed:true,at:clock()});
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
