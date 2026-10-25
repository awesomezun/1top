let active=null;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function closeMailbox(){if(active){clearInterval(active.timer);active.dialog.remove();active=null;}}
export function mailboxResponse(value){
 if(!active||value.type!=='mailbox'||value.device_id!==active.did||value.session_id!==active.sid||value.request_id!==active.requestId)return;
 active.error=value.error||'';
 if(!value.error){const known=new Set(value.messages.map(row=>row.id));active.rows=[...value.messages,...active.rows.filter(row=>row.local&&!known.has(row.id)).map(row=>Date.now()/1000-row.created>30?{...row,status:'delivery_unconfirmed'}:row)];}
 renderHistory();
}
export function mailboxReceipt(value){
 if(!active||value.request?.device_id!==active.did||value.request?.session_id!==active.sid)return;
 active.rows=active.rows.map(row=>row.id===value.request.request_id?{...row,status:value.status==='failed'?'delivery_unconfirmed':'awaiting_reply'}:row);
 if(value.status==='failed')active.error=value.message||value.status;
 renderHistory();
}
function renderHistory(){
 if(!active)return;const {dialog,t,rows}=active;
 const labels={sending:t('Sending','전송 중'),queued:t('Waiting for the current turn to finish','현재 작업이 끝나면 전달'),awaiting_reply:t('Waiting for a reply','답신 대기'),replied:t('Replied','답신 도착'),delivery_unconfirmed:t('Delivery unconfirmed — check the session before resending','전달 미확인 · 재전송 전에 세션 확인'),source_changed:t('Reply connection changed','답신 연결 변경됨'),not_delivered:t('Not delivered — session changed or waiting expired','미전달 · 세션 변경 또는 대기 만료')};
 const history=dialog.querySelector('.mailbox-history'),nearEnd=history.scrollHeight-history.scrollTop-history.clientHeight<80;
 history.innerHTML=rows.length?rows.map(row=>`<article class="mail-message outgoing"><p>${escape(row.text)}</p><small>${escape(labels[row.status]||row.status)}</small></article>${row.reply?`<article class="mail-message incoming"><small>${t('Session reply','세션의 답신')}</small><p>${escape(row.reply)}</p>${row.truncated?`<small>${t('Long reply shortened.','긴 답신의 일부를 표시합니다.')}</small>`:''}</article>`:''}`).join(''):`<div class="mail-empty"><b>${t('Ask this session','이 세션에 물어보세요')}</b><p>${t('“How far along are you?”','“지금 어디까지 진행됐어?”')}</p></div>`;
 dialog.querySelector('.mailbox-error').textContent=active.error;
 if(nearEnd)history.scrollTop=history.scrollHeight;
}
export function openMailbox({device,session,t,api,socket,current,demo}){
 closeMailbox();const dialog=document.createElement('dialog');dialog.className='session-mailbox';
 dialog.innerHTML=`<div class="mailbox-heading"><div><span>${t('SESSION MESSAGES','세션 메시지함')}</span><h2>${escape(session.project||session.title)}</h2><p>${escape([device.name,session.app,session.terminal].filter(Boolean).join(' · '))}</p></div><button class="secondary mailbox-close" aria-label="${t('Close messages','메시지함 닫기')}">✕</button></div><p class="mailbox-intro">${t('Your messages and this session’s replies. The full work conversation stays on your computer.','이 세션에게 보낸 메시지와 답신입니다. 전체 작업 대화는 컴퓨터에 남습니다.')}</p><div class="mailbox-history" role="log" aria-live="polite"></div><p class="mailbox-error" role="status"></p><form class="mailbox-compose"><textarea aria-label="${t('Message to session','세션에 보낼 메시지')}" maxlength="4000" rows="3" placeholder="${t('Write a message…','메시지를 입력하세요…')}"></textarea><div><small>${t('A busy session may reply later. Messages can use AI tokens.','작업 중인 세션은 답신이 늦을 수 있습니다. 메시지는 AI 토큰을 사용할 수 있습니다.')}</small><button class="primary" type="submit">${t('Send message','메시지 보내기')}</button></div></form>`;
 document.body.append(dialog);active={dialog,t,did:device.id,sid:session.id,rows:[],error:'',requestId:null};const opened=active;
 const refresh=()=>{
  if(active!==opened)return;
  const live=current(),ws=socket();
  const online=demo||(live?.device.online&&Date.now()-live.device.received<20000&&ws?.readyState===1);
  dialog.querySelector('button[type=submit]').disabled=!online||!live?.session.capabilities.includes('message')||opened.sending;
  if(demo)return;
  if(!online){opened.error=t('Computer is offline. Reconnect to receive replies.','컴퓨터 연결이 끊겼습니다. 재연결하면 답신을 확인할 수 있습니다.');renderHistory();return;}
  if(!live.session.capabilities.includes('mailbox')){opened.error=t('Message connection unavailable.','메시지 연결을 확인할 수 없습니다.');renderHistory();return;}
  opened.requestId=crypto.randomUUID();ws.send(JSON.stringify({type:'mailbox_request',request_id:opened.requestId,device_id:device.id,session_id:session.id,control_key:live.session.control_key}));
 };
 dialog.querySelector('.mailbox-close').onclick=closeMailbox;dialog.addEventListener('cancel',closeMailbox);
 dialog.querySelector('form').onsubmit=async event=>{
  event.preventDefault();const input=dialog.querySelector('textarea'),text=input.value,live=current();
  if(!text.trim()||text.length>4000||opened.sending||!live?.session.capabilities.includes('message'))return;
  if(!demo&&(!live.device.online||Date.now()-live.device.received>=20000||socket()?.readyState!==1)){opened.error=t('Reconnect before sending.','재연결 후 보내세요.');renderHistory();return;}
  const id=crypto.randomUUID();opened.sending=true;opened.error='';dialog.querySelector('button[type=submit]').disabled=true;
  try{
   if(!demo)await api('/api/action',{action:'message',request_id:id,device_id:device.id,session_id:session.id,control_key:live.session.control_key,prompt:text});
   if(active!==opened)return;
   input.value='';opened.rows.push({id,text,created:Date.now()/1000,status:demo?'replied':'sending',reply:demo?t('Demo reply: The first checks are finished. I am reviewing the remaining failures.','예시 답신: 첫 검사를 마쳤고 남은 오류를 확인하고 있습니다.'):'',local:true});renderHistory();
  }catch(error){if(active===opened){opened.error=error.message+' '+t('If delivery is uncertain, check the session before resending.','전달이 불확실하면 재전송 전에 세션을 확인하세요.');renderHistory();}}
  finally{opened.sending=false;if(active===opened)dialog.querySelector('button[type=submit]').disabled=false;}
 };
 renderHistory();dialog.showModal();refresh();opened.timer=setInterval(refresh,5000);dialog.querySelector('textarea').focus();
}
