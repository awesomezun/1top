import type {Device,Flow,Quota,Session,Vector,WindowKey} from './types';
import type {Mail} from './thread';
import {bins} from './demo-usage';
import {WORLD} from './demo-world';
import {machines,accounts,sessionNumbers,host,type Machine} from './demo-model';
import {holdDemo,heldDemo} from './clock';
type T=(en:string,ko:string)=>string;

// The demo world every surface shows (site/src/demo-world.js, copied to demo-world.ts): the web demo, the
// desktop demo collector and the iPhone show these computers, sessions and accounts with the same numbers.
// Names are the world's own and read the same in every language.
const PERIODS:[WindowKey,number][]=[['10m',600],['30m',1800],['1h',3600],['5h',18000],['12h',43200],['24h',86400]];
/** The message of the first conversation that carries two photos, shown as sent pictures. */
export const PHOTO_MESSAGE='00000000-0000-4000-8000-000000000002';
/** When this demo began: the hours around it never rest, and sessions stopped before it stay stopped. */
let anchor=Date.now()/1000;
/** QA and filming (onetop://?qaDemoNow=<unix seconds>): hold the demo at one moment, the same moment the
 *  web page (/app?demo&demoNow=…), the desktop demo collector and the iPhone (-qaDemoNow) take (clock.ts). */
export function setDemoNow(seconds:number|null){holdDemo(seconds);anchor=heldDemo()??Date.now()/1000;}
export const demoClock=()=>heldDemo()??Date.now()/1000;
const total=(v:number[])=>v.reduce((a,b)=>a+b,0);

export function demoDevices(_t:T=(en)=>en,now=demoClock(),start=anchor):Device[]{
 const all=machines(WORLD,now,start),limits=accounts(WORLD,all,now,start),limitOf=(key:string|null)=>limits.find(a=>a.key===key);
 return all.map((m:Machine)=>{
  const computer=WORLD.computers[m.c],rows=WORLD.sessions.filter(r=>r[0]===m.c);
  const sessions=m.list.flatMap((s,j):Session[]=>{
   if(s.earlier)return [];
   const row=rows.find(r=>r[1]===(s.child?.lead||s.id))!,[,,kind,project,model,,,weight,app,terminal]=row,i=WORLD.sessions.indexOf(row);
   const status=s.child?s.child.status:row[5],n=weight>0?sessionNumbers(m,j,now,start,PERIODS):null,a=limitOf(s.account);
   const windows=(n?.windows||{}) as Partial<Record<WindowKey,Vector>>;
   return [{id:s.id,control_key:s.child?'':'demo-'+i,kind,app,terminal:s.child?'':terminal,project,title:project+' · '+kind,model:model||'',status,
    tokens:n?.tokens||null,rate:n?status==='working'?n.rate:0:null,windows,
    cpu:s.child?null:status==='working'?Math.round((1.5+Math.min(30,m.u.minutes[j][m.u.minutes[j].length-2]/4e4)+i%5*.7)*10)/10:status==='unknown'?.6:.3,rss:s.child?null:(160+i*24)*2**20,
    // The context in use, as the web demo shows it.
    context_usage:n?{basis:'last_request_input',input_tokens:64000+i*6000,capacity:kind==='Codex'?400000:kind==='Claude'?1000000:null,parts:[12000+i*2000,48000+i*4000,4000],observed_at:now,model:model||''}:null,
    capabilities:s.child?[]:WORLD.caps[s.id],root_session_id:s.child?s.child.lead:s.id,parent_session_id:s.child?s.child.lead:null,
    weekly_account:a&&n?a.id:null,weekly_estimate:a&&n?Object.fromEntries(PERIODS.map(([k])=>[k,{used_pp:Math.round(total(windows[k]!)*a.per*1e4)/1e4,partial:false,account_id:a.id,calibration:{pp_per_token:a.per,confidence:'limited'}}])):null}];
  });
  const used=new Set(rows.map(r=>r[6]).filter(Boolean));
  const quotas=limits.filter(a=>used.has(a.key)).map((a):Quota=>{const points:number[][]=[];for(let t=a.start;t<=a.reportAt;t+=600)points.push([t,Math.round(a.used(a.start,t)*a.per),a.resetAt]);
   // The relay names an account by its tool and the end of its id; providers report limits in whole percent.
   return {id:a.id,kind:a.kind,account_label:a.kind+' · '+a.id.slice(-6),plan:a.plan,updated:a.reportAt,stale:!!a.stale,status:a.status??null,...(a.alias?{alias:a.alias}:{}),
    windows:[...(a.five!==null?[{key:'5h',label:'5H',pct:a.five,reset:a.fiveReset!}]:[]),{key:'7d',label:'주간',pct:a.weekly,reset:a.resetAt}],
    weekly:Object.fromEntries(PERIODS.map(([k,seconds])=>[k,{used_pp:Math.round(a.used(now-seconds)*a.per*1e4)/1e4,observed_seconds:seconds,partial:false}])),usage_points:points};});
  const kinds=m.list.map(s=>s.weight>0?s.kind:null);
  const flow=Object.fromEntries(PERIODS.map(([k,seconds])=>{const step=seconds<=3600?60:seconds<=18000?300:900;return [k,{step,...bins(m.u,kinds,now,seconds,step),reported:true} as Flow];}));
  const ops=WORLD.operations[m.c];
  return {id:computer.id,name:computer.name,platform:computer.platform,online:true,received:now*1000,...(computer.control?{}:{allow_control:false}),
   snapshot:{version:'4.0.0',updated:now,sessions,host:host(WORLD,m),
    account_quotas:quotas,flow,operations:{installed_skills:ops.installed_skills,observed_events:ops.observed_events,goals:ops.goals.map(g=>({runtime:g.runtime,status:g.status,tokens_used:g.tokens_used,session_connected:g.session_connected}))}}};
 });
}

/** The first conversation shows every delivery state once, a reply, photos and a reply being written;
 *  three more sessions show the other response phases. Nothing here is sent anywhere. */
export function demoThread(sessionId:string,t:T):Mail[]{
 const now=demoClock(),id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const message=(n:number,text:string,status:string,ago:number,extra:Partial<Mail>={}):Mail=>({id:id(n),text,created:now-ago,status,reply:'',...extra});
 const activity=(phase:'responding'|'working'|'writing')=>({phase,observed_at:now-3});
 if(sessionId==='s1')return [
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
 if(sessionId==='s3')return [message(10,t('Change how search results are sorted.','검색 결과 정렬 기준을 바꿔 줘.'),'awaiting_reply',120,{activity:activity('working')})];
 if(sessionId==='s5')return [message(11,t('Polish the notification copy.','알림 문구를 다듬어 줘.'),'awaiting_reply',20,{activity:activity('responding')})];
 // Awaiting a reply with no reported activity: nothing claims the request is being answered.
 if(sessionId==='s4')return [message(9,t('What rules do you use to clean the data?','데이터 정리 기준을 알려 줘.'),'awaiting_reply',240)];
 return [];
}
