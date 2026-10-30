// The 1top.si remote workspace (/app). The page is the desktop dashboard from agent/onetop/dist; this
// module runs first and answers its /api/* requests from relay snapshots, so the dashboard's own code
// draws the same screen and behaves the same way. The demo (/app?demo) is a relay too (remote-demo.js)
// and goes through the same adapter and the same control path as the signed-in one (remote-live.js).
import {remoteState,findSession,isFresh,mergeHistory} from './remote-adapter.js';
import './remote-app.css';

const demo=new URLSearchParams(location.search).has('demo');
// QA and filming: /app?demo&demoNow=<unix seconds> holds the demo at that moment, the same moment the
// desktop demo collector and the phones' QA options take, so every surface shows the same numbers. The
// page's clock holds there too, so resets, report ages and the header clock read alike. Only the demo holds.
const demoNow=demo&&Number(new URLSearchParams(location.search).get('demoNow'))||null;
if(demoNow){const Real=Date,at=demoNow*1000;globalThis.Date=class extends Real{constructor(...a){super(...(a.length?a:[at]));}static now(){return at;}};}
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
const ready=(demo?import('./remote-demo.js').then(m=>m.demoRelay({demoNow})):import('./remote-live.js').then(m=>m.liveRelay({onStatus:next=>{status=next;
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
// The computer's own answer to a request, or null when none comes within 25 seconds.
const resultOf=id=>new Promise(done=>{waiting.set(id,done);setTimeout(()=>{if(waiting.delete(id))done(null);},RESULT_WAIT);});
// A control goes to the computer as a relay action; the dashboard hears the computer's own answer,
// or after 25 seconds that the answer is not confirmed.
async function action(request){
 const relay=await ready,found=findSession(relay.devices(),request.session_id);
 if(request.action==='message')return message(relay,found,request);
 if(!found)return json({ok:false,message:'세션 연결이 종료되었습니다.'},404);
 if(!found.session.capabilities?.includes(request.action))return json({ok:false,message:'원격 워크스페이스에서는 아직 지원하지 않습니다'},409);
 const command={action:request.action,request_id:request.request_id,device_id:found.device.id,session_id:found.session.id,control_key:found.session.control_key,
  ...(request.action==='rename'?{title:request.title}:{})};
 const answer=resultOf(command.request_id);
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

// Usage history from each computer in the scope that offers it (snapshot feature 'history'), asked through
// the relay; several are added up by their bins. Without it the dashboard says remote has none yet.
async function history(params){
 const relay=await ready,list=relay.devices().filter(d=>(scope==='all'||d.id===scope)&&isFresh(d)&&(d.snapshot.features||[]).includes('history'));
 if(!list.length||!relay.history)return json({error:'remote'},501);
 const request={period:params.get('period'),step:params.get('step'),...(params.get('kind')?{kind:params.get('kind')}:{})},parts=[];
 for(const device of list){
  try{parts.push({device,data:await relay.history({device_id:device.id,...request})});}
  catch(error){if(/400|bins/i.test(error.message))return json({error:error.message},400);}
 }
 return parts.length?json(mergeHistory(parts)):json({error:'failed'},502);
}
// An account's display name, saved by a computer that has the account and offers 'account_alias'.
async function alias(request){
 const relay=await ready,device=relay.devices().find(d=>isFresh(d)&&(d.snapshot.features||[]).includes('account_alias')&&(d.snapshot.account_quotas||[]).some(q=>q.id===request.account_id));
 if(!device||!relay.alias)return json({ok:false,message:'원격 워크스페이스에서는 아직 지원하지 않습니다'},501);
 const command={request_id:crypto.randomUUID(),device_id:device.id,account_id:request.account_id,alias:String(request.alias||'').trim().slice(0,24)},answer=resultOf(command.request_id);
 try{const receipt=await relay.alias(command);if(receipt.status==='completed'){waiting.delete(command.request_id);return json({ok:true,alias:command.alias||null});}}
 catch(error){waiting.delete(command.request_id);return json({ok:false,message:error.message},error.status||502);}
 const m=await answer;
 if(!m)return json({ok:false,message:'저장 응답을 확인하지 못했습니다. 잠시 뒤 다시 확인해 주세요.'},504);
 return m.status==='completed'?json({ok:true,alias:command.alias||null}):json({ok:false,message:m.message||'이름을 저장하지 못했습니다.'},409);
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
  case '/api/history':return history(url.searchParams);
  case '/api/accounts/alias':return alias(JSON.parse(init.body||'{}'));
  // Provider sign-in and macOS reconnecting stay on each computer.
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
 disconnect:['연결 해제','Disconnect','断开连接'],cancel:['취소','Cancel','取消'],disconnecting:['해제하는 중…','Disconnecting…','正在断开…'],
 disconnectTitle:['{name}의 연결을 해제할까요?','Disconnect {name}?','要断开 {name} 吗？'],
 disconnectText:['원격 접근이 중단됩니다. 그 컴퓨터의 1top 앱에서 다시 연결할 수 있습니다.','Remote access will stop. You can connect it again from the 1top app on that computer.','远程访问将停止。可在该电脑的 1top 应用中重新连接。'],
 disconnectDemo:['체험 화면에서는 이 페이지에서만 사라지고, 새로고침하면 돌아옵니다.','In the demo it only leaves this page and comes back on reload.','演示中只会从此页面移除，刷新后会恢复。'],
 disconnectFailed:['연결을 해제하지 못했습니다: {error} 잠시 뒤 다시 시도하세요.','Could not disconnect: {error} Try again in a moment.','无法断开连接：{error} 请稍后再试。'],
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
 // A card chooses the scope; a computer's card also offers disconnecting it.
 const card=(id,name,detail,body,remove='')=>`<div class="remote-computer${scope===id?' selected':''}"><button type="button" class="remote-computer-pick" data-remote-scope="${esc(id)}" aria-pressed="${scope===id}"><b>${name}</b><small>${detail}</small>${body}</button>${remove}</div>`;
 const html=`<div class="remote-computers-head"><h2>${say('scope')}</h2><p>${say('scopeNote')}</p></div><div class="remote-computer-list">`+
  card('all',esc(say('all')),`${say('sum')} · ${all.length} · ${say('sessions')} ${all.reduce((n,d)=>n+roots(d),0)}`,'')+
  all.map(d=>{const on=isFresh(d),h=d.snapshot.host||{},mem=h.total_memory>0?h.used_memory/h.total_memory*100:null;
   return card(d.id,`<i class="dot ${on?'green':'offline'}"></i>${esc(d.name)}`,`${esc(d.platform||'')} · ${on?say('online'):say('offline')} · ${say('last')} ${time(d.received)}`,meter('CPU',h.cpu)+meter(say('memory'),mem)+`<small>${say('sessions')} ${roots(d)}</small>`,
    `<button type="button" class="remote-computer-disconnect" data-remote-disconnect="${esc(d.id)}">${say('disconnect')}</button>`);}).join('')+'</div>';
 if(html!==computersHtml){computersHtml=html;root.innerHTML=html;}
}
// Disconnect: confirm, ask the relay (or the demo relay), then the list without that computer; a
// refusal stays in the dialog with what the relay said.
let leaving=null;
function askDisconnect(id){
 const d=devices().find(x=>x.id===id),dialog=$('remoteDisconnect');if(!d||!dialog)return;leaving=d;
 $('remoteDisconnectTitle').textContent=say('disconnectTitle').replace('{name}',d.name||id);
 $('remoteDisconnectText').textContent=say('disconnectText')+(demo?' '+say('disconnectDemo'):'');
 $('remoteDisconnectError').hidden=true;$('remoteDisconnectCancel').textContent=say('cancel');
 const confirm=$('remoteDisconnectConfirm');confirm.textContent=say('disconnect');confirm.disabled=false;dialog.showModal();$('remoteDisconnectCancel').focus();
}
async function disconnect(){
 const d=leaving,confirm=$('remoteDisconnectConfirm');if(!d)return;
 confirm.disabled=true;$('remoteDisconnectCancel').disabled=true;confirm.textContent=say('disconnecting');
 try{
  await (await ready).revoke(d.id);
  leaving=null;$('remoteDisconnect').close();
  if(scope===d.id){scope='all';write(SCOPE,scope);}
  renderChrome();window.refresh?.();
 }catch(error){
  const note=$('remoteDisconnectError');note.textContent=say('disconnectFailed').replace('{error}',error.message||'');note.hidden=false;
 }finally{confirm.disabled=false;$('remoteDisconnectCancel').disabled=false;confirm.textContent=say('disconnect');}
}
document.addEventListener('click',e=>{
 const remove=e.target.closest('[data-remote-disconnect]');
 if(remove){askDisconnect(remove.dataset.remoteDisconnect);return;}
 if(e.target.closest('#remoteDisconnectCancel')){leaving=null;$('remoteDisconnect').close();return;}
 if(e.target.closest('#remoteDisconnectConfirm')){disconnect();return;}
 const pick=e.target.closest('[data-remote-scope]');
 if(pick){scope=pick.dataset.remoteScope;write(SCOPE,scope);renderChrome();window.refresh?.();return;}
 if(e.target.closest('#remoteSignOut'))ready.then(relay=>relay.signOut()).then(()=>location.assign('/'));
});
document.addEventListener('DOMContentLoaded',renderChrome);
