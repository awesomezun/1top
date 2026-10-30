// What a computer's relay snapshot carries beyond sessions and the six ranges (relay-parity-contract_v1.0.1),
// for the demo relay (remote-demo.js): every slider range's windows, totals and flow, session details,
// host and collector figures, the control log, per-tool limits, and the history, rename and account-name
// requests. Figures follow the desktop demo collector (scripts/demo-state.mjs) for each demo computer.
import {machine,DAY,HISTORY_DAYS} from './demo-model.js';
import {vector} from './demo-usage.js';
import {WORLD} from './demo-world.js';

// The slider's ranges past the six, and how far the demo world's records go back.
const LONGER=[900,7200,10800,21600,172800,259200,604800,1209600,2592000,7776000,15552000,31536000];
const COVERED=HISTORY_DAYS*DAY;
const total=v=>Array.isArray(v)?v.reduce((a,b)=>a+b,0):0;
const round=(n,d=4)=>Math.round(n*10**d)/10**d;
// Notes and answers as the collector writes them (agent/onetop), in Korean; the dashboard translates them.
const NOTES={child:'하위 에이전트 · 부모 세션의 실행 위치에서 확인',aside:'Aside 내부 세션 · 터미널 CLI가 아님 · 바로가기는 Aside 앱 열기',
 other:'세션과 터미널 화면 제목의 고유한 일치를 확인하지 못했습니다.'};
const SOURCE={Codex:'codex_turn_context',Aside:'aside_session_configuration'};
const ANSWER={pause:'작업이 멈춘 것을 확인했습니다. 세션을 보존했으며, 재개 버튼으로 새 요청을 보낼 수 있습니다.',resume:'이어서 작업하는 새 요청을 보냈습니다.',
 terminate:'CLI 종료를 확인했습니다. Orca 탭과 대화 기록은 유지됩니다.'};
const RESUME={ko:'이어서 진행해 주세요.',en:'Please continue.',zh:'请继续。'};
const pageLanguage=()=>{const lang=globalThis.document?.documentElement.lang||'ko';return lang.startsWith('zh')?'zh':lang==='en'?'en':'ko';};

// Renames, account names and the control log of each demo relay (keyed by when it began).
const states=new Map();
// The log starts with the two controls the desktop demo collector lists, on the MacBook Pro.
const stateOf=anchor=>{if(!states.has(anchor))states.set(anchor,{titles:new Map(),aliases:new Map(),log:[
 {device:'demo-0',t:anchor-40*60,action:'focus',sid:'s1',terminal:'Checkout UI',project:'checkout-web',message:'Sent a request to bring the host application forward on that computer.'},
 {device:'demo-0',t:anchor-12*60,action:'pause',sid:'s7',terminal:'Mobile',project:'mobile-app',message:ANSWER.pause}]});return states.get(anchor);};

// A computer's whole record (90 days of minutes) and its per-tool minute sums, once a minute.
const longs=new Map();
function record(c,now,anchor,controls){
 const key=[c,Math.floor(now/60),anchor,JSON.stringify([...controls])].join('|');
 let r=longs.get(key);if(r)return r;
 const m=machine(c,now,anchor,{span:COVERED/60+15,controls}),kinds=[...new Set(m.list.filter(s=>s.weight>0).map(s=>s.kind))];
 // Prefix sums of every tool's minutes, so a range's bins are differences.
 const cum=Object.fromEntries(kinds.map(k=>{const s=new Float64Array(m.n+1);
  m.list.forEach((x,j)=>{if(x.kind!==k||!(x.weight>0))return;const row=m.u.minutes[j];for(let i=0;i<m.n;i++)s[i+1]+=row[i];});
  for(let i=0;i<m.n;i++)s[i+1]+=s[i];return [k,s];}));
 r={m,kinds,cum,at:t=>Math.min(m.n,Math.max(0,Math.ceil(t/60)-m.u.first))};
 if(longs.size>12)longs.clear();longs.set(key,r);return r;
}
// Bins for a range past the six: at most 240, ending at the snapshot clock, as the companion sends them.
function rangeFlow(r,now,seconds){
 const step=Math.max(60,Math.ceil(seconds/240/60)*60),count=Math.ceil(seconds/step),start=now-seconds;
 const bins=Array.from({length:count},(_,i)=>{const a=r.at(start+i*step),b=r.at(Math.min(now,start+(i+1)*step)),bin={};
  for(const k of r.kinds){const n=Math.round(r.cum[k][b]-r.cum[k][a]);if(n>0)bin[k]=n;}return bin;});
 return {step,start,end:start+count*step,as_of:now,reported:true,bins};
}
const PROCESSES={Darwin:['Orca','Visual Studio Code','Cursor','Ghostty','Aside','WindowServer','node','Safari','Finder','Terminal','Warp','iTerm2','mds_stores','Dock','Spotlight'],
 Windows:['Windows Terminal','Code','powershell','Windsurf','ChatGPT','explorer','node','MsMpEng','dwm','svchost','OneDrive','Teams','chrome','SearchHost','RuntimeBroker']};

/** device with the relay's other fields filled in, for demo computer m at now. */
export function parity(m,now,anchor,limits,controls,device){
 const snap=device.snapshot,{c,computer}=m,r=record(c,now,anchor,controls),L=r.m,state=stateOf(anchor);
 const keys=[...LONGER.map(s=>['custom:'+s,s]),['all',Math.floor(now-(anchor-COVERED))]];
 const limitOf=id=>limits.find(a=>a.id===id),calibration=a=>({seconds:3600,used_pp:10,tokens:Math.round(10/a.per),pp_per_token:a.per,confidence:'limited',from:now-7200,to:now-3600,valid_until:now+86400,source:''});
 snap.features=['history','account_alias'];
 snap.sessions.forEach(s=>{
  const j=L.list.findIndex(x=>x.id===s.id),row=WORLD.sessions.find(x=>x[1]===(s.parent_session_id||s.id)),i=WORLD.sessions.indexOf(row);
  if(s.tokens&&j>=0){
   for(const [key,seconds] of keys)s.windows[key]=vector(L.sum(j,now-seconds));
   const a=s.weekly_account&&limitOf(s.weekly_account);
   if(a)for(const [key,seconds] of keys){const tokens=total(s.windows[key]);s.weekly_estimate[key]={used_pp:round(tokens*a.per),partial:seconds>COVERED,period_seconds:seconds,tokens,account_id:a.id,calibration:calibration(a)};}
  }
  // The last hour's figures from this report's own minutes; the longer ranges from the whole record.
  const history=j<0?[]:Array.from({length:60},(_,k)=>{const t=Math.floor(now/60-59+k)*60;return [t,Math.round(m.sum(j,t,t+60))];}).filter(([,n])=>n>0);
  const pid=40100+c*1000+i*37,title=state.titles.get(s.id);
  // Titles as the desktop demo collector gives them: the tab's name, a subagent's name; a relay sends only
  // names someone gave, and the demo's read as such.
  Object.assign(s,{title:s.parent_session_id?s.id.slice(s.parent_session_id.length+1):row?.[9]||'',effort_source:s.effort?SOURCE[s.kind]||'claude_statusline':null,effort_updated:s.effort?now-900:null,
   last_usage:history.length?history.at(-1)[0]:s.tokens?now-1800:null,request_input:s.context_usage?.input_tokens??null,context_size:s.context_usage?.capacity??null,
   terminal_note:s.parent_session_id?NOTES.child:s.kind==='Aside'?NOTES.aside:s.app==='Orca'?'':NOTES.other,pids:s.parent_session_id?[]:[pid],
   usage:{last_minute:j<0?null:vector(m.sum(j,now-60)),last_five_minutes:j<0?null:vector(m.sum(j,now-300)),output_rate:j<0?null:round(m.sum(j,now-600)*.005/600,2),history},
   ...(title?{terminal:title}:{})});
 });
 // Totals past the six count every session of the record, ended ones too, as the collector counts them.
 const tracked=L.list.map((s,j)=>[s,j]).filter(([s])=>s.weight>0);
 for(const [key,seconds] of keys){
  snap.periods.push({key,label:key,seconds,tokens:vector(tracked.reduce((n,[,j])=>n+L.sum(j,now-seconds),0)),partial:seconds>COVERED,observed_seconds:Math.min(seconds,COVERED)});
  snap.flow[key]=rangeFlow(r,now,seconds);
 }
 for(const q of snap.account_quotas){
  const a=limitOf(q.id);if(!a)continue;q.calibration=calibration(a);if(state.aliases.has(q.id))q.alias=state.aliases.get(q.id)||undefined;
  for(const [key,seconds] of keys)q.weekly[key]={used_pp:round(a.used(now-seconds)*a.per),observed_seconds:Math.min(seconds,8*DAY),partial:seconds>8*DAY};
 }
 // The host and the collector, as the desktop demo collector reports the MacBook Pro.
 const h=snap.host,busy=t=>Math.min(1,L.list.reduce((n,s,j)=>n+(L.u.minutes[j][Math.floor(t/60)-L.u.first]||0),0)/(computer.scale*3));
 const windows=computer.platform==='Windows',b=busy(now-60);
 Object.assign(h,{swap:{used:Math.round((1.1+c*.4)*2**30),total:(windows?8:4)*2**30},load:windows?null:[round(1.4+computer.cores*.3*b,2),round(1.6+computer.cores*.2*b,2),2.1],uptime:(4+c*3)*DAY+5200,
  battery:c===0?{percent:84,plugged:true}:null,process_count:612+c*140,unreadable_processes:3+c,os:windows?'Windows 11 Pro':'macOS 27.0',platform:computer.platform,
  disk:{...computer.disk,percent:round((computer.disk.total-computer.disk.free)/computer.disk.total*100,1)}});
 const apps=[...new Set(snap.sessions.map(s=>s.app).filter(Boolean))],names=[...new Set([...apps,...PROCESSES[computer.platform]])].slice(0,15);
 snap.system={sampler_ms:38.5+c*4,monitor:{pid:39000+c,cpu:round(1.4+c*.3,1),rss:(118+c*6)*2**20},
  history:Array.from({length:300},(_,k)=>{const t=now-(299-k)*3,x=busy(t);return {t,cpu:round(computer.cpu[0]+computer.cpu[1]*x,1),memory:round(computer.used/computer.memory*100+3*x,1),
   rx:Math.round(computer.network.rx[0]+computer.network.rx[1]*x),tx:Math.round(computer.network.tx[0]+computer.network.tx[1]*x)};}),
  top:names.map((name,k)=>({pid:3100+c*500+k*11,ppid:1,name,created:anchor-DAY+k*600,cpu:round(Math.max(.2,(apps.includes(name)?18:6)*(1-k/15)*(.4+b)),1),rss:Math.round((820-k*45)*2**20)})),
  shared:snap.sessions.some(s=>s.kind==='Codex')?[{id:'backend:'+(5200+c),pid:5200+c,ppid:1,name:'codex',created:anchor-2*DAY,cpu:round(2+6*b,1),rss:Math.round((1.4+c*.3)*2**30),count:3,pids:[5200+c,5201+c,5202+c]}]:[]};
 // The collector's own figures, its last controls and per-tool limits for tools without an account.
 const shown=snap.sessions.filter(s=>!s.parent_session_id);
 Object.assign(snap,{collection_ms:round(184.2+c*21,1),resume_prompt:RESUME[pageLanguage()],
  actions:state.log.filter(a=>a.device===device.id).slice(-20).map(({device:_,...a})=>a),
  orca_terminals:shown.filter(s=>s.app==='Orca').length,
  process_counts:Object.fromEntries(['Claude','Codex','GLM','Aside','Antigravity','Gemini','OpenCode'].map(k=>[k,shown.filter(s=>s.kind===k).length]).filter(([,n])=>n)),
  quotas:[...new Set(shown.map(s=>s.kind))].filter(k=>['GLM','Antigravity'].includes(k)).map(kind=>({kind,plan:'',updated:now-120,stale:true,note:'공식 한도를 확인하지 못했습니다. 세션 토큰은 계속 수집합니다.',windows:[]}))});
 return device;
}

/** relay with the requests a 4.3 companion answers: history, renaming and account names. Answers come
 *  after a moment, as a computer's do; renames and names stay on this page. */
export function parityRelay(relay,{clock,started,refresh,results,devices}){
 const state=stateOf(started),wait=ms=>new Promise(done=>setTimeout(done,ms));
 const answer=(request,message)=>{for(const listener of results)listener({type:'result',request,status:'completed',message,created:Date.now()});};
 const send=relay.send;
 return {...relay,
  async send(command){
   if(command.action!=='rename'){const receipt=await send(command);
    if(ANSWER[command.action]){const s=devices().flatMap(d=>d.snapshot.sessions).find(x=>x.id===command.session_id);
     state.log.push({device:command.device_id,t:clock(),action:command.action,sid:command.session_id,terminal:s?.terminal||'',project:s?.project||'',message:ANSWER[command.action]});}
    return receipt;}
   await wait(400);
   setTimeout(()=>{state.titles.set(command.session_id,command.title);const s=devices().flatMap(d=>d.snapshot.sessions).find(x=>x.id===command.session_id),message=`터미널 제목을 ${command.title}(으)로 변경했습니다.`;
    state.log.push({device:command.device_id,t:clock(),action:'rename',sid:command.session_id,terminal:command.title,project:s?.project||'',message});refresh();answer(command,message);},700);
   return {status:'sent'};
  },
  async alias(command){
   await wait(400);
   setTimeout(()=>{state.aliases.set(command.account_id,command.alias);refresh();answer({action:'account_alias',...command},'');},700);
   return {status:'sent'};
  },
  async history({device_id,period,step,kind}){
   await wait(300);
   const c=WORLD.computers.findIndex(x=>x.id===device_id),now=clock();
   const data=demoHistory(record(c,now,started,new Map()).m,now,started,{period,step,kind});
   if(data.status===400)throw Object.assign(Error('400 too many bins'),{status:400});
   return data;
  },
 };
}

// Usage history for one demo computer (usage-history-contract_v1.0.0), as scripts/demo-state.mjs builds
// the MacBook Pro's; project keys are hashed as the relay carries them.
const pad=n=>String(n).padStart(2,'0'),day=t=>{const d=new Date(t*1000);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
function floorStep(t,step){const d=new Date(t*1000);if(step==='day'){d.setHours(0,0,0,0);return d.getTime()/1000;}
 if(step==='week'){d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()+6)%7);return d.getTime()/1000;}return Math.floor(t/step)*step;}
function nextStep(t,step){const d=new Date(t*1000);if(step==='day'){d.setDate(d.getDate()+1);return d.getTime()/1000;}if(step==='week'){d.setDate(d.getDate()+7);return d.getTime()/1000;}return t+step;}
const hash=text=>{let h=2166136261;for(const ch of text)h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;return h.toString(16).padStart(8,'0').repeat(8);};
function seconds(key,now,anchor){const fixed={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400}[key];return fixed||(key==='all'?Math.floor(now-(anchor-COVERED)):Number(String(key).slice(7))||3600);}
function demoHistory(m,now,anchor,{period='1h',step='60',kind=null}){
 const span=seconds(period,now,anchor),unit=/^\d+$/.test(String(step))?Number(step):step,covered=anchor-COVERED,bins=[];
 for(let t=floorStep(now-span,unit);t<now;t=nextStep(t,unit))bins.push(t);
 if(bins.length>400)return {status:400};
 const use=m.list.map((s,j)=>[s,j]).filter(([s])=>s.weight>0&&(!kind||s.kind===kind)),edges=[...bins.slice(1),Infinity];
 const cell=(j,i)=>bins[i]<covered?null:Math.round(m.sum(j,bins[i],edges[i]));
 const group=(keyOf,labelOf)=>{const map=new Map();for(const [s,j] of use){const key=keyOf(s),row=map.get(key)||{key,...labelOf(s),tokens:bins.map(()=>0)};
   bins.forEach((_,i)=>{const v=cell(j,i);row.tokens[i]=v===null||row.tokens[i]===null?null:row.tokens[i]+v;});map.set(key,row);}
  return [...map.values()].sort((a,b)=>total(b.tokens.map(v=>v||0))-total(a.tokens.map(v=>v||0)));};
 const byModel=group(s=>s.model||'unknown',s=>({kind:s.kind})),byProject=group(s=>'project:'+hash(m.computer.id+'/'+s.project),s=>({label:s.kind==='Aside'&&s.project==='0'?'Aside':s.project}));
 const totals=bins.map((_,i)=>byModel.some(r=>r.tokens[i]===null)?null:byModel.reduce((n,r)=>n+r.tokens[i],0));
 const sumAll=(from,to)=>use.reduce((n,[,j])=>n+m.sum(j,from,to),0),today=floorStep(now,'day'),hours=[],days=[];
 for(let t=floorStep(today-29*DAY,'day');t<nextStep(today,'day');t+=3600)hours.push([day(t),new Date(t*1000).getHours(),t<covered||t>now?null:Math.round(sumAll(t,t+3600))]);
 for(let t=floorStep(covered,'day');t<now;t=nextStep(t,'day'))days.push([day(t),Math.round(sumAll(t,nextStep(t,'day')))]);
 return {as_of:now,coverage:[{source:'collector',kind:null,from:anchor-2*DAY,to:now},{source:'claude_transcripts',kind:'Claude',from:covered,to:now},{source:'codex_sessions',kind:'Codex',from:covered,to:now}],
  heatmap:{days,hours},series:{bins,by_model:byModel,by_project:byProject,end:now,start:bins[0]??now,step:String(step),total:totals}};
}
