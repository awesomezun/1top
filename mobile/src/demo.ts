import type {Device,Flow,Quota,Session,Vector,WindowKey} from './types';
import type {Mail} from './thread';
import {usage,since,bins,vector,type Stream} from './demo-usage';
type T=(en:string,ko:string)=>string;

// Two made-up computers for trying the app without an account. No real projects or accounts.
// The iPhone's demo (ios/OneTop/Model/DemoData.swift) carries the same computers, sessions, accounts
// and conversation, so both phones show the same thing. Names follow the chosen language.
const CONTROLS=['focus','pause','resume','terminate','prompt','message','mailbox','message_images'];
const PERIODS:[WindowKey,number][]=[['10m',600],['30m',1800],['1h',3600],['5h',18000],['12h',43200],['24h',86400]];
/** The message of the first conversation that carries two photos, shown as sent pictures. */
export const PHOTO_MESSAGE='00000000-0000-4000-8000-000000000002';
/** When this demo began: the hours around it never rest, and sessions stopped before it stay stopped. */
const ANCHOR=Date.now()/1000;
/** Two accounts per tool, as on the iPhone (DemoData.swift) and the web demo (site/src/remote-demo.js).
 *  per: weekly percent per token, set once from a typical week of this demo, so a limit is the tokens of its
 *  weekly window times per and moves with the work. reset: seconds after the demo began (the window began
 *  7 days before). five: the 5-hour window's reset and its percent per weekly percent. ago: how old the
 *  report is; stale: the computer could not refresh it. */
export const DEMO_ACCOUNTS:{id:string;kind:string;label:string;plan:string;per:number;reset:number;five?:{reset:number;factor:number};ago:number;stale?:boolean;alias?:string}[]=[
 {id:'demo:claude-a',kind:'Claude',label:'Claude · 4f21a8',plan:'max',per:9.4e-9,reset:276_000,five:{reset:9_400,factor:6},ago:40},
 {id:'demo:claude-b',kind:'Claude',label:'Claude · b7e3c1',plan:'pro',per:5.4e-8,reset:290_000,five:{reset:14_200,factor:6},ago:70,alias:'Team'},
 {id:'demo:codex-a',kind:'Codex',label:'Codex · 9c03e2',plan:'pro',per:2.4e-8,reset:250_000,ago:55},
 // A limit the computer could not refresh: it shows how old it is instead of a rate.
 {id:'demo:codex-b',kind:'Codex',label:'Codex · 2d5f90',plan:'plus',per:2e-7,reset:337_000,ago:38*60,stale:true},
];
const ACCOUNT=Object.fromEntries(DEMO_ACCOUNTS.map(a=>[a.id,a]));

/** [id, kind, model, project, terminal (en, ko), status, weight, account, capabilities]. weight is the
 *  session's usual share of its computer; the iPhone's DemoData.swift lists the same rows. */
export const DEMO_ROWS:[string,string,string,string,string,string,string,number,string|null,string[]][]=[
 ['d1','Claude','claude-opus-5-5','storefront','Checkout redesign','결제 화면 개편','working',52,'demo:claude-a',CONTROLS],
 ['d2','Codex','gpt-6-astra','api-gateway','Rate limit tests','요청 제한 테스트','working',12,'demo:codex-a',CONTROLS],
 ['d3','Claude','claude-opus-5-5','docs-site','Better docs search','문서 검색 개선','working',13,'demo:claude-b',CONTROLS],
 ['d4','Codex','gpt-6.1-sol','ml-pipeline','Training data cleanup','학습 데이터 정리','waiting',4,'demo:codex-b',CONTROLS],
 // An older computer's session: instructions only, no reply reader.
 ['d5','GLM','glm-5.3[1m]','storefront','Translation review','번역 검수','idle',3,null,['focus','prompt']],
 // Working, since a request is only answered by a working session (contract v1.1.0).
 ['d6','Claude','claude-sonnet-5-5','mobile-app','Notification settings','알림 설정 화면','working',6,'demo:claude-a',CONTROLS],
 ['d7','Codex','gpt-6-astra','infra','Deploy script','배포 스크립트','paused',2,'demo:codex-a',CONTROLS],
 ['d8','Claude','claude-opus-5-5','design-system','Design token cleanup','토큰 정리','idle',0,'demo:claude-b',CONTROLS],
 ['m1','Codex','gpt-6.1-sol','data-sync','Nightly sync','야간 동기화','working',8,'demo:codex-b',CONTROLS],
 ['m2','Claude','claude-sonnet-5-5','billing','Invoice template','청구서 템플릿','idle',3,'demo:claude-a',CONTROLS],
];
/** The demo computers: id, rows by id prefix, hash seed, the median tokens of an active minute and how
 *  often the computer works next to the main one. */
const COMPUTERS=[{id:'demo-mac',prefix:'d',seed:23,scale:1.2e6,duty:1},{id:'demo-mini',prefix:'m',seed:61,scale:.25e6,duty:.3}];
// One person's computers rest together.
const REST=7;

// When a session takes part in its computer's work: working ones all along, the others until a while
// before the demo began (demo-usage.ts shapes the minutes).
function stream(status:string,weight:number,index:number,anchor:number):Stream{
 const start=index%4===3?anchor-(5+index%7)*3600:anchor-30*3600;
 const stop=status==='waiting'?anchor-(2+index%4)*60:status==='paused'?anchor-12*60:status==='idle'?anchor-(40+index*37%180)*60:Infinity;
 return {weight,start,stop};
}

// What stays fixed while one demo runs: the day before it began and each account's weekly window then.
const fixed=new Map<string,{before:ReturnType<typeof usage>;week:number[]}>();
function machine(c:typeof COMPUTERS[number],now:number,anchor:number){
 const rows=DEMO_ROWS.map((row,i)=>({row,i})).filter(({row})=>row[0].startsWith(c.prefix));
 // Earlier sessions of each account on this computer, closed before the shown ones began: they fill the
 // weekly window and never show in the last day.
 const earlier=[...new Set(rows.map(({row})=>row[8]).filter((a):a is string=>!!a))].map(id=>({id,weight:rows.reduce((n,{row})=>n+(row[8]===id?row[7]:0),0)}));
 const streams=[...rows.map(({row,i})=>stream(row[6],row[7],i,anchor)),...earlier.map(({weight})=>({weight,start:anchor-8*86400,stop:anchor-30*3600}))];
 const owners=[...rows.map(({row})=>row[8]),...earlier.map(({id})=>id)];
 const u=usage(c.seed,c.scale,streams,now,anchor,REST,c.duty);
 const key=c.id+':'+anchor;
 if(!fixed.has(key)){
  // Tokens from a day before the demo began until it began, so totals only grow; and each stream's tokens
  // from its account's weekly window start until the demo began.
  const long=usage(c.seed,c.scale,streams,anchor,anchor,REST,c.duty,true,8*1440+15);
  fixed.set(key,{before:usage(c.seed,c.scale,streams,anchor,anchor,REST,c.duty),week:owners.map((id,j)=>id&&ACCOUNT[id]?since(long,j,anchor+ACCOUNT[id].reset-604800):0)});
 }
 return {rows,u,owners,...fixed.get(key)!};
}

export function demoDevices(t:T=(en)=>en,now=Date.now()/1000,anchor=ANCHOR):Device[]{
 const machines=COMPUTERS.map(c=>({c,...machine(c,now,anchor)}));
 const sessions=machines.map(({rows,u,before})=>rows.map(({row:[id,kind,model,project,en,ko,status,weight,account,capabilities]},j):Session=>{
  const windows=Object.fromEntries(PERIODS.map(([k,seconds])=>[k,vector(since(u,j,now-seconds))])) as Record<WindowKey,Vector>;
  const per=account?ACCOUNT[account].per:0,lastMinute=u.minutes[j][u.minutes[j].length-2];
  const estimate=account?Object.fromEntries(PERIODS.map(([k])=>[k,{used_pp:windows[k].reduce((a,b)=>a+b,0)*per,partial:false,account_id:account,calibration:{pp_per_token:per,confidence:'stable'}}])):null;
  return {id,control_key:'demo',kind,app:kind==='Codex'?'Orca':'Terminal',terminal:t(en,ko),project,title:'',model,status,
   tokens:vector(weight*4e7+since(before,j,anchor-86400)+since(u,j,anchor)),rate:status==='working'?since(u,j,now-600)/600:0,
   windows,cpu:status==='working'?Math.round((1.5+Math.min(30,lastMinute/4e4))*10)/10:.3,rss:410,capabilities,weekly_account:account,weekly_estimate:estimate};
 }));
 // An account's tokens since a moment over both computers, and its weekly percent: the tokens of its weekly
 // window (before the demo began, then since) times its per-token percent.
 const used=(id:string,from:number)=>machines.reduce((n,m)=>n+m.owners.reduce((k,owner,j)=>k+(owner===id?since(m.u,j,from):0),0),0);
 const weekly=(a:typeof DEMO_ACCOUNTS[number])=>(machines.reduce((n,m)=>n+m.owners.reduce((k,owner,j)=>k+(owner===a.id?m.week[j]:0),0),0)+used(a.id,anchor))*a.per;
 const round=(n:number)=>Math.round(n*10)/10;
 const quota=(a:typeof DEMO_ACCOUNTS[number]):Quota=>{
  const exact=weekly(a),reset=anchor+a.reset;
  return {id:a.id,kind:a.kind,account_label:a.label,plan:a.plan,updated:now-a.ago,stale:!!a.stale,...(a.alias?{alias:a.alias}:{}),
   // Providers report limits in whole percent, as the collector shows them; use and points keep decimals.
   windows:[...(a.five?[{key:'5h',label:'5H',pct:Math.min(100,Math.round(used(a.id,anchor+a.five.reset-18000)*a.per*a.five.factor)),reset:anchor+a.five.reset}]:[]),{key:'7d',label:'주간',pct:Math.round(exact),reset}],
   weekly:Object.fromEntries(PERIODS.map(([k,s])=>[k,{used_pp:used(a.id,now-s)*a.per,observed_seconds:s,partial:false}])),
   usage_points:Array.from({length:145},(_,i)=>{const at=now-86400+i*600;return [at,Math.max(0,round(exact-used(a.id,at)*a.per)),reset];})};
 };
 const [claudeA,claudeB,codexA,codexB]=DEMO_ACCOUNTS.map(quota);
 const flow=(m:typeof machines[number])=>Object.fromEntries(PERIODS.map(([k,seconds])=>{const step=seconds<=3600?60:seconds<=18000?300:900;
  return [k,{step,...bins(m.u,m.rows.map(({row})=>row[1]),now,seconds,step),reported:true} as Flow];}));
 // The host is as busy as its last minute of tokens.
 const busy=(m:typeof machines[number])=>Math.min(1,m.u.minutes.reduce((n,row)=>n+row[row.length-2],0)/(m.c.scale*3));
 const received=now*1000,[mac,mini]=machines;
 return [
  {id:'demo-mac',name:t('Demo Mac Studio','데모 Mac Studio'),platform:'macOS',online:true,received:received-2000,snapshot:{version:'4.0.0',updated:now,sessions:sessions[0],
   host:{cpu:Math.round((8+48*busy(mac))*10)/10,used_memory:61.4e9,total_memory:128e9,cores:16},account_quotas:[claudeA,claudeB,codexA],flow:flow(mac),
   operations:{installed_skills:18,observed_events:7,goals:[{runtime:'Codex',status:'active',tokens_used:1_240_000,session_connected:true}]}}},
  // Paired without remote control, so its sessions show usage only.
  {id:'demo-mini',name:t('Demo Mac mini','데모 Mac mini'),platform:'macOS',online:true,allow_control:false,received:received-4000,snapshot:{version:'4.0.0',updated:now-3,sessions:sessions[1],
   host:{cpu:Math.round((4+48*busy(mini))*10)/10,used_memory:9.8e9,total_memory:24e9,cores:10},account_quotas:[codexB,claudeA],flow:flow(mini),
   operations:{installed_skills:6,observed_events:2,goals:[]}}},
 ];
}

/** The first conversation shows every delivery state once, a reply, photos and a reply being written;
 *  three more sessions show the other response phases. Nothing here is sent anywhere. */
export function demoThread(sessionId:string,t:T):Mail[]{
 const now=Date.now()/1000,id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const message=(n:number,text:string,status:string,ago:number,extra:Partial<Mail>={}):Mail=>({id:id(n),text,created:now-ago,status,reply:'',...extra});
 const activity=(phase:'responding'|'working'|'writing')=>({phase,observed_at:now-3});
 if(sessionId==='d1')return [
  message(1,t('How far along are you?','지금 어디까지 진행됐어?'),'replied',1500,{reply:t('I moved the card entry step of checkout to the new component. The receipt screen and two tests are left.','결제 화면의 카드 입력 단계를 새 컴포넌트로 옮겼고, 남은 작업은 영수증 화면과 테스트 두 개입니다.'),reply_at:now-1440}),
  message(2,t('The buttons look misaligned on these two screens. Please check.','이 두 화면에서 버튼 정렬이 어긋나 보여. 확인해 줘.'),'replied',1200,{reply:t('I checked both photos. The pay button\'s bottom margin was 8 pt off, so I matched it.','두 사진 모두 확인했습니다. 결제 버튼의 아래 여백이 8pt 달라서 맞췄습니다.'),reply_at:now-1140,
   attachments:[{id:'IMG_0412.jpg',name:'IMG_0412.jpg',mime:'image/jpeg',bytes:180_000},{id:'IMG_0413.jpg',name:'IMG_0413.jpg',mime:'image/jpeg',bytes:180_000}],photos:[{uri:'demo:1'},{uri:'demo:2'}]}),
  message(3,t('Match the receipt screen to the same rules.','영수증 화면도 같은 기준으로 맞춰 줘.'),'awaiting_reply',900,{activity:activity('writing')}),
  message(4,t('Let me know when the tests finish.','테스트가 끝나면 알려 줘.'),'queued',600),
  message(5,t('Where is the log file?','로그 파일 경로를 알려 줘.'),'delivery_unconfirmed',420),
  message(6,t('Compare it with the previous branch too.','이전 브랜치 결과도 비교해 줘.'),'source_changed',300),
  message(7,t('Also do the cleanup I asked for yesterday.','어제 요청한 정리도 해 줘.'),'not_delivered',200),
  message(8,t('Sum up the current screen in one line.','지금 화면을 한 줄로 요약해 줘.'),'sending',5),
 ];
 if(sessionId==='d3')return [message(10,t('Change how search results are sorted.','검색 결과 정렬 기준을 바꿔 줘.'),'awaiting_reply',120,{activity:activity('working')})];
 if(sessionId==='d6')return [message(11,t('Polish the notification copy.','알림 문구를 다듬어 줘.'),'awaiting_reply',20,{activity:activity('responding')})];
 // Awaiting a reply with no reported activity: nothing claims the request is being answered.
 if(sessionId==='d4')return [message(9,t('What rules do you use to clean the data?','데이터 정리 기준을 알려 줘.'),'awaiting_reply',240)];
 return [];
}
