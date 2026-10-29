// The 1top.si remote workspace (/app). The page is the desktop dashboard from agent/onetop/dist; this
// module runs first and answers its /api/* requests from relay snapshots, so the dashboard's own code
// draws the same screen and behaves the same way. The demo (/app?demo) is a relay too (remote-demo.js)
// and goes through the same adapter and the same control path as the signed-in one (remote-live.js).
import {remoteState,findSession,isFresh} from './remote-adapter.js';
import './remote-app.css';

const demo=new URLSearchParams(location.search).has('demo');
const PREFS='onetop.dashboard.v1',SCOPE='1top-remote-scope',RESULT_WAIT=25000;
const read=key=>{try{return localStorage.getItem(key);}catch{return null;}};
const write=(key,value)=>{try{localStorage.setItem(key,value);}catch{}};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// The site's language and theme carry into the dashboard's preferences before dashboard.js reads them,
// and a change made in the dashboard is the site's choice too.
(function carryPreferences(){
 let prefs={};try{prefs=JSON.parse(read(PREFS)||'{}')||{};}catch{}
 const lang=read('1top-language')||(navigator.language.startsWith('ko')?'ko':navigator.language.startsWith('zh')?'zh':'en');
 prefs.lang=['ko','en','zh'].includes(lang)?lang:'en';prefs.theme=read('1top-theme')==='light'?'light':'dark';
 write(PREFS,JSON.stringify(prefs));
})();
new MutationObserver(()=>{const html=document.documentElement,lang=html.lang.startsWith('zh')?'zh':html.lang;
 if(['ko','en','zh'].includes(lang))write('1top-language',lang);if(['dark','light'].includes(html.dataset.theme))write('1top-theme',html.dataset.theme);
 renderChrome();}).observe(document.documentElement,{attributes:true,attributeFilter:['lang','data-theme']});
document.documentElement.classList.add('remote');

let scope=read(SCOPE)||'all',status={state:demo?'live':'connecting'},source=null;
const waiting=new Map();
const ready=(demo?import('./remote-demo.js').then(m=>m.demoRelay()):import('./remote-live.js').then(m=>m.liveRelay({onStatus:next=>{status=next;
 if(next.state==='signed-out'){location.replace('/sign-in');return;}renderChrome();if(next.state==='live')window.refresh?.();}}))).then(relay=>{
 source=relay;relay.onResult(m=>{const done=waiting.get(m.request?.request_id);if(done){waiting.delete(m.request.request_id);done(m);}});return relay;});
const devices=()=>source?.devices()||[];
const tag=()=>demo?'DEMO':'REMOTE';

const json=(body,code=200)=>new Response(JSON.stringify(body),{status:code,headers:{'Content-Type':'application/json'}});
function state(period){
 if(!source||!['live','reconnecting'].includes(status.state))return {ready:false};
 if(scope!=='all'&&!devices().some(d=>d.id===scope))scope='all';
 const result=remoteState(devices(),{scope,period,tag:tag()});
 queueMicrotask(renderChrome);
 return result;
}
// A control goes to the computer as a relay action; the dashboard hears the computer's own answer,
// or after 25 seconds that the answer is not confirmed.
async function action(request){
 const relay=await ready,found=findSession(relay.devices(),request.session_id);
 if(request.action==='message')return message(relay,found,request);
 if(!found)return json({ok:false,message:'세션 연결이 종료되었습니다.'},404);
 if(!found.session.capabilities?.includes(request.action))return json({ok:false,message:'원격 워크스페이스에서는 아직 지원하지 않습니다'},409);
 const command={action:request.action,request_id:request.request_id,device_id:found.device.id,session_id:found.session.id,control_key:found.session.control_key};
 const answer=new Promise(done=>{waiting.set(command.request_id,done);setTimeout(()=>{if(waiting.delete(command.request_id))done(null);},RESULT_WAIT);});
 try{const receipt=await relay.send(command);if(receipt.status==='completed'){waiting.delete(command.request_id);return json({ok:true,message:receipt.message||'완료'});}}
 catch(error){waiting.delete(command.request_id);return json({ok:false,message:error.message},error.status||502);}
 const m=await answer;
 if(!m)return json({ok:true,message:'결과를 확인하지 못했습니다. 다시 요청하기 전에 컴퓨터 상태를 확인하세요.'});
 return json({ok:m.status==='completed',message:m.message||m.status},m.status==='completed'?200:409);
}

// A conversation message is accepted by the computer and answered later in its mailbox, so the
// dashboard hears the relay's receipt at once: a refusal (4xx) is definite, anything else unconfirmed.
async function message(relay,found,request){
 if(!found)return json({ok:false,message:'세션 연결이 종료되었습니다.'},404);
 if(!found.session.capabilities?.includes('message'))return json({ok:false,message:'현재 이 세션에 메시지를 보낼 수 없습니다.'},409);
 try{
  const receipt=await relay.send({action:'message',request_id:request.request_id,device_id:found.device.id,session_id:found.session.id,
   control_key:found.session.control_key,prompt:request.prompt,...(request.attachments?.length?{attachments:request.attachments}:{})});
  // Like the collector's own answer, say whether the message waits for the session's turn: the
  // computer's mailbox knows at once (a failed read leaves it to the next one).
  let queued=false;
  try{queued=(await relay.mailbox({device_id:found.device.id,session_id:found.session.id,control_key:found.session.control_key})).find(r=>r.id===request.request_id)?.status==='queued';}catch{}
  return json({ok:true,queued,status:receipt.status==='unconfirmed'?'unconfirmed':'sent',message:receipt.message||''});
 }catch(error){return json({ok:false,message:error.message},error.status||502);}
}
// The session's latest messages, read on the computer through the relay.
async function mailbox(request){
 const relay=await ready,found=findSession(relay.devices(),request.session_id);
 if(!found||!found.session.capabilities?.includes('mailbox'))return json({ok:false,message:'현재 이 세션의 메시지 연결을 확인할 수 없습니다.'},409);
 try{return json({ok:true,messages:await relay.mailbox({device_id:found.device.id,session_id:found.session.id,control_key:found.session.control_key})});}
 catch(error){return json({ok:false,message:error.message},error.status||502);}
}

// Same-origin /api/* requests from the dashboard; everything else goes to the network as usual.
const network=window.fetch.bind(window);
window.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
 if(url.origin!==location.origin)return network(input,init);
 if(url.pathname==='/benchmark.json')return network('/dashboard/benchmark.json',init);
 if(!url.pathname.startsWith('/api/'))return network(input,init);
 switch(url.pathname){
  case '/api/state':await ready;return json(state(url.searchParams.get('period')));
  case '/api/updates':return json({available:false});
  case '/api/action':return action(JSON.parse(init.body||'{}'));
  case '/api/mailbox':return mailbox(JSON.parse(init.body||'{}'));
  // Not in a relay snapshot yet: usage history, terminal renaming, account sign-in and names.
  case '/api/history':return json({error:'remote'},501);
  default:return json({ok:false,message:'원격 워크스페이스에서는 아직 지원하지 않습니다'},501);
 }
};

// Remote-only parts: the tag beside the logo, the breadcrumb, the sidebar foot, the computer
// scope in Computer resources and the account notice. Texts here are the page's own, in three languages.
const TEXT={
 all:['모든 컴퓨터','All computers','全部电脑'],demo:['체험 화면 · 예시 데이터','Demo · example data','演示 · 示例数据'],
 remote:['원격 워크스페이스','Remote workspace','远程工作区'],home:['1top.si 홈','1top.si home','1top.si 首页'],signOut:['로그아웃','Sign out','退出登录'],
 scope:['보기 범위','View','查看范围'],sum:['합산','Combined','合计'],online:['연결됨','Online','在线'],offline:['오프라인','Offline','离线'],
 sessions:['세션','Sessions','会话'],memory:['메모리','Memory','内存'],last:['마지막 보고','Last report','上次报告'],
 scopeNote:['컴퓨터를 고르면 모든 화면이 그 컴퓨터로 좁혀집니다. 모든 컴퓨터는 합산합니다.','Choose a computer to narrow every view; All computers adds them up.','选择一台电脑即可缩小所有视图的范围；全部电脑为合计。'],
 denied:['이 계정은 원격 접근이 활성화되지 않았습니다. 로컬 모니터링과 체험 화면은 무료입니다.','Remote access is not enabled for this account. Local monitoring and the demo are free.','此账户未开通远程访问。本地监控和演示均免费。'],
 empty:['연결된 컴퓨터가 없습니다. 모니터링할 컴퓨터에서 1top 앱을 실행하고 이 계정으로 로그인하세요.','No computer is connected. Open the 1top app on the computer to monitor and sign in with this account.','尚未连接电脑。请在要监控的电脑上打开 1top 应用并用此账户登录。'],
 reconnecting:['원격 연결을 다시 시도하고 있습니다.','Reconnecting to the relay.','正在重新连接中继。'],
};
const lang=()=>document.documentElement.lang.startsWith('zh')?2:document.documentElement.lang==='en'?1:0;
const say=key=>TEXT[key][lang()];
function renderChrome(){
 const brand=document.querySelector('.brand-tag');if(brand)brand.textContent=tag();
 const crumb=$('remoteScope');if(crumb)crumb.textContent=scope==='all'?say('all'):devices().find(d=>d.id===scope)?.name||say('all');
 const who=$('remoteIdentity');if(who)who.textContent=demo?say('demo'):status.user?.email||say('remote');
 const home=$('remoteHome');if(home)home.textContent=say('home')+' ↗';
 const out=$('remoteSignOut');if(out){out.textContent=say('signOut');out.hidden=demo;}
 const notice=$('remoteNotice');if(notice){const text=status.state==='denied'?say('denied'):status.state==='reconnecting'?say('reconnecting'):source&&status.state==='live'&&!devices().length?say('empty'):'';notice.textContent=text;notice.hidden=!text;}
 renderComputers();
}
const percent=v=>v==null||!Number.isFinite(v)?'—':Math.round(v)+'%';
const meter=(label,v)=>`<span class="remote-meter"><small>${label}</small><i><u style="width:${Math.max(0,Math.min(100,v||0))}%"></u></i><em>${percent(v)}</em></span>`;
let computersHtml='';
function renderComputers(){
 const root=$('remoteComputers');if(!root)return;
 const all=devices(),roots=d=>(d.snapshot.sessions||[]).filter(s=>!s.parent_session_id).length,time=ms=>ms?new Date(ms).toLocaleTimeString(document.documentElement.lang||'ko',{hour:'2-digit',minute:'2-digit'}):'—';
 const card=(id,name,detail,body)=>`<button type="button" class="remote-computer${scope===id?' selected':''}" data-remote-scope="${esc(id)}" aria-pressed="${scope===id}"><b>${name}</b><small>${detail}</small>${body}</button>`;
 const html=`<div class="remote-computers-head"><h2>${say('scope')}</h2><p>${say('scopeNote')}</p></div><div class="remote-computer-list">`+
  card('all',esc(say('all')),`${say('sum')} · ${all.length} · ${say('sessions')} ${all.reduce((n,d)=>n+roots(d),0)}`,'')+
  all.map(d=>{const on=isFresh(d),h=d.snapshot.host||{},mem=h.total_memory>0?h.used_memory/h.total_memory*100:null;
   return card(d.id,`<i class="dot ${on?'green':'offline'}"></i>${esc(d.name)}`,`${esc(d.platform||'')} · ${on?say('online'):say('offline')} · ${say('last')} ${time(d.received)}`,meter('CPU',h.cpu)+meter(say('memory'),mem)+`<small>${say('sessions')} ${roots(d)}</small>`);}).join('')+'</div>';
 if(html!==computersHtml){computersHtml=html;root.innerHTML=html;}
}
document.addEventListener('click',e=>{
 const pick=e.target.closest('[data-remote-scope]');
 if(pick){scope=pick.dataset.remoteScope;write(SCOPE,scope);renderChrome();window.refresh?.();return;}
 if(e.target.closest('#remoteSignOut'))ready.then(relay=>relay.signOut()).then(()=>location.assign('/'));
});
document.addEventListener('DOMContentLoaded',renderChrome);
