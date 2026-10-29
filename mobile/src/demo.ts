import type {Device,Flow,Quota,Session,Vector,WindowKey} from './types';
import type {Mail} from './thread';
type T=(en:string,ko:string)=>string;

// Two made-up computers for trying the app without an account. No real projects or accounts.
// The iPhone's demo (ios/OneTop/Model/DemoData.swift) carries the same computers, sessions, accounts
// and conversation, so both phones show the same thing. Names follow the chosen language.
const CONTROLS=['focus','pause','resume','terminate','prompt','message','mailbox','message_images'];
const PERIODS:[WindowKey,number][]=[['10m',600],['30m',1800],['1h',3600],['5h',18000],['12h',43200],['24h',86400]];
const SHARE:Record<WindowKey,number>={'10m':.21,'30m':.55,'1h':1,'5h':3.6,'12h':7.4,'24h':12.8};
/** The message of the first conversation that carries two photos, shown as sent pictures. */
export const PHOTO_MESSAGE='00000000-0000-4000-8000-000000000002';

const vector=(total:number):Vector=>[total*.01,total*.92,total*.04,total*.03];
function session(id:string,kind:string,model:string,project:string,terminal:string,status:string,hour:number,account:string|null,capabilities=CONTROLS):Session{
 const windows=Object.fromEntries(PERIODS.map(([k])=>[k,vector(hour*SHARE[k])])) as Record<WindowKey,Vector>;
 const per=kind==='Codex'?1.1e-7:3.2e-8;
 const estimate=account?Object.fromEntries(PERIODS.map(([k])=>[k,{used_pp:windows[k].reduce((a,b)=>a+b,0)*per,partial:false,account_id:account,calibration:{pp_per_token:per,confidence:'stable'}}])):null;
 return {id,control_key:'demo',kind,app:kind==='Codex'?'Orca':'Terminal',terminal,project,title:'',model,status,tokens:vector(hour*40),rate:status==='working'?hour/3600:0,
  windows,cpu:status==='working'?12.4:.3,rss:410,capabilities,weekly_account:account,weekly_estimate:estimate};
}
const weekly=(perHour:number)=>Object.fromEntries(PERIODS.map(([k,s])=>[k,{used_pp:perHour*s/3600,observed_seconds:s,partial:false}]));
const points=(from:number,to:number,reset:number,now:number)=>Array.from({length:24},(_,i)=>[now-(23-i)*3600,from+(to-from)*i/23+(i%5===0?.4:0),reset]);
function flow(claudeRate:number,codexRate:number,now:number){
 return Object.fromEntries(PERIODS.map(([k,seconds])=>{const step=seconds<=3600?60:seconds<=18000?300:900,count=Math.floor(seconds/step);
  return [k,{step,start:now-seconds,end:now,reported:true,bins:Array.from({length:count},(_,i)=>{const wave=.55+.45*Math.sin(i/4.3)*Math.cos(i/11),busy=i%17<3?.25:1,scale=step/60;
   return {Claude:claudeRate*scale*Math.max(.05,wave)*busy,Codex:codexRate*scale*Math.max(.05,1-wave*.6)};})} as Flow];}));
}

export function demoDevices(t:T=(en)=>en):Device[]{
 const now=Date.now()/1000;
 // Two accounts per tool, numbered 1 and 2 the way the desktop dashboard numbers them; one has a name
 // given in the desktop app.
 const studio=[
  session('d1','Claude','claude-opus-5-5','storefront',t('Checkout redesign','결제 화면 개편'),'working',52_400_000,'demo:claude-a'),
  session('d2','Codex','gpt-6-astra','api-gateway',t('Rate limit tests','요청 제한 테스트'),'working',31_800_000,'demo:codex-a'),
  session('d3','Claude','claude-opus-5-5','docs-site',t('Better docs search','문서 검색 개선'),'working',12_900_000,'demo:claude-b'),
  session('d4','Codex','gpt-6.1-sol','ml-pipeline',t('Training data cleanup','학습 데이터 정리'),'waiting',9_600_000,'demo:codex-b'),
  // An older computer's session: instructions only, no reply reader.
  session('d5','GLM','glm-5.3[1m]','storefront',t('Translation review','번역 검수'),'idle',4_100_000,null,['focus','prompt']),
  // Working, since a request is only answered by a working session (contract v1.1.0).
  session('d6','Claude','claude-sonnet-5-5','mobile-app',t('Notification settings','알림 설정 화면'),'working',2_700_000,'demo:claude-a'),
  session('d7','Codex','gpt-6-astra','infra',t('Deploy script','배포 스크립트'),'paused',1_200_000,'demo:codex-a'),
  session('d8','Claude','claude-opus-5-5','design-system',t('Design token cleanup','토큰 정리'),'idle',0,'demo:claude-b'),
 ];
 const mini=[
  session('m1','Codex','gpt-6.1-sol','data-sync',t('Nightly sync','야간 동기화'),'working',8_400_000,'demo:codex-b'),
  session('m2','Claude','claude-sonnet-5-5','billing',t('Invoice template','청구서 템플릿'),'idle',1_900_000,'demo:claude-a'),
 ];
 const claudeA:Quota={id:'demo:claude-a',kind:'Claude',account_label:'Claude · 4f21a8',plan:'max',updated:now-40,stale:false,
  windows:[{key:'5h',label:'5H',pct:38,reset:now+9_400},{key:'7d',label:'주간',pct:27,reset:now+290_000}],weekly:weekly(4.2),usage_points:points(21.5,27,now+290_000,now)};
 const claudeB:Quota={id:'demo:claude-b',kind:'Claude',account_label:'Claude · b7e3c1',plan:'pro',updated:now-70,stale:false,alias:'Team',
  windows:[{key:'5h',label:'5H',pct:12,reset:now+14_200},{key:'7d',label:'주간',pct:46,reset:now+350_000}],weekly:weekly(1.4),usage_points:points(43,46,now+350_000,now)};
 const codexA:Quota={id:'demo:codex-a',kind:'Codex',account_label:'Codex · 9c03e2',plan:'pro',updated:now-55,stale:false,
  windows:[{key:'7d',label:'주간',pct:23,reset:now+410_000}],weekly:weekly(2.1),usage_points:points(19.5,23,now+410_000,now)};
 // A limit the computer could not refresh: it shows how old it is instead of a rate.
 const codexB:Quota={id:'demo:codex-b',kind:'Codex',account_label:'Codex · 2d5f90',plan:'plus',updated:now-38*60,stale:true,
  windows:[{key:'7d',label:'주간',pct:64,reset:now+220_000}],weekly:weekly(.9),usage_points:points(61,64,now+220_000,now)};
 const received=now*1000;
 return [
  {id:'demo-mac',name:t('Demo Mac Studio','데모 Mac Studio'),platform:'macOS',online:true,received:received-2000,snapshot:{version:'4.0.0',updated:now,sessions:studio,
   host:{cpu:31.5,used_memory:61.4e9,total_memory:128e9,cores:16},account_quotas:[claudeA,claudeB,codexA],flow:flow(1_150_000,520_000,now),
   operations:{installed_skills:18,observed_events:7,goals:[{runtime:'Codex',status:'active',tokens_used:1_240_000,session_connected:true}]}}},
  // Paired without remote control, so its sessions show usage only.
  {id:'demo-mini',name:t('Demo Mac mini','데모 Mac mini'),platform:'macOS',online:true,allow_control:false,received:received-4000,snapshot:{version:'4.0.0',updated:now-3,sessions:mini,
   host:{cpu:12.2,used_memory:9.8e9,total_memory:24e9,cores:10},account_quotas:[codexB,claudeA],flow:flow(40_000,120_000,now),
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
