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
// Weekly limit percent per token, by tool.
const PER:Record<string,number>={Codex:1.1e-7,Claude:3.2e-8};

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
function stream(status:string,weight:number,index:number):Stream{
 const start=index%4===3?ANCHOR-(5+index%7)*3600:ANCHOR-30*3600;
 const stop=status==='waiting'?ANCHOR-(2+index%4)*60:status==='paused'?ANCHOR-12*60:status==='idle'?ANCHOR-(40+index*37%180)*60:Infinity;
 return {weight,start,stop};
}

function machine(c:typeof COMPUTERS[number],now:number){
 const rows=DEMO_ROWS.map((row,i)=>({row,i})).filter(({row})=>row[0].startsWith(c.prefix));
 const streams=rows.map(({row,i})=>stream(row[6],row[7],i));
 // Tokens from a day before the demo began until it began, fixed, so totals only grow.
 const u=usage(c.seed,c.scale,streams,now,ANCHOR,REST,c.duty),before=usage(c.seed,c.scale,streams,ANCHOR,ANCHOR,REST,c.duty);
 return {rows,u,before};
}

export function demoDevices(t:T=(en)=>en):Device[]{
 const now=Date.now()/1000,machines=COMPUTERS.map(c=>({c,...machine(c,now)}));
 const sessions=machines.map(({rows,u,before})=>rows.map(({row:[id,kind,model,project,en,ko,status,weight,account,capabilities]},j):Session=>{
  const windows=Object.fromEntries(PERIODS.map(([k,seconds])=>[k,vector(since(u,j,now-seconds))])) as Record<WindowKey,Vector>;
  const per=PER[kind]??PER.Claude,lastMinute=u.minutes[j][u.minutes[j].length-2];
  const estimate=account?Object.fromEntries(PERIODS.map(([k])=>[k,{used_pp:windows[k].reduce((a,b)=>a+b,0)*per,partial:false,account_id:account,calibration:{pp_per_token:per,confidence:'stable'}}])):null;
  return {id,control_key:'demo',kind,app:kind==='Codex'?'Orca':'Terminal',terminal:t(en,ko),project,title:'',model,status,
   tokens:vector(weight*4e7+since(before,j,ANCHOR-86400)+since(u,j,ANCHOR)),rate:status==='working'?since(u,j,now-600)/600:0,
   windows,cpu:status==='working'?Math.round((1.5+Math.min(30,lastMinute/4e4))*10)/10:.3,rss:410,capabilities,weekly_account:account,weekly_estimate:estimate};
 }));
 // An account's tokens since a moment, over both computers.
 const used=(account:string,from:number)=>machines.reduce((n,{rows,u})=>n+rows.reduce((k,{row},j)=>k+(row[8]===account?since(u,j,from):0),0),0);
 // weekly and five are the limits when the demo began; they rise with the tokens used since.
 const quota=(id:string,kind:string,label:string,plan:string,weekly:number,weeklyReset:number,five:number|null,fiveReset:number,updated:number,extra:Partial<Quota>={}):Quota=>{
  const per=PER[kind],pct=weekly+used(id,ANCHOR)*per,reset=now+weeklyReset;
  return {id,kind,account_label:label,plan,updated,stale:false,...extra,
   windows:[...(five===null?[]:[{key:'5h',label:'5H',pct:Math.min(100,five+used(id,ANCHOR)*per*4),reset:now+fiveReset}]),{key:'7d',label:'주간',pct,reset}],
   weekly:Object.fromEntries(PERIODS.map(([k,s])=>[k,{used_pp:used(id,now-s)*per,observed_seconds:s,partial:false}])),
   usage_points:Array.from({length:24},(_,i)=>{const at=now-(23-i)*3600;return [at,Math.max(0,pct-used(id,at)*per),reset];})};
 };
 const claudeA=quota('demo:claude-a','Claude','Claude · 4f21a8','max',27,290_000,38,9_400,now-40);
 const claudeB=quota('demo:claude-b','Claude','Claude · b7e3c1','pro',46,350_000,12,14_200,now-70,{alias:'Team'});
 const codexA=quota('demo:codex-a','Codex','Codex · 9c03e2','pro',23,410_000,null,0,now-55);
 // A limit the computer could not refresh: it shows how old it is instead of a rate.
 const codexB=quota('demo:codex-b','Codex','Codex · 2d5f90','plus',64,220_000,null,0,now-38*60,{stale:true});
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
