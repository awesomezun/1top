/* Session conversation in the session detail: messages to a session and its replies, with up to three
   photos. Same contract as the phone (mobile-conversation-contract_v1.2.0) and the same composition as
   its conversation screen: work state, timeline, typing indicator, composer, confirmation.
   One `message` action carries questions and instructions; delivery states only move forward and rows
   are merged by ID. The collector answers POST /api/action and POST /api/mailbox; on 1top.si the
   remote workspace answers the same requests through the relay. */
(function(root){
 'use strict';
 const ORDER={queued:0,sending:1,awaiting_reply:2,replied:3};
 const MAX_PHOTOS=3,MAX_BYTES=524288,LONG_EDGE=1600,MAX_TEXT=4000,READ_EVERY=5000;
 const TOOLS=['Claude','GLM','Codex'];

 // Delivery moves forward only: queued < sending < awaiting_reply < replied. A reply proves arrival.
 function advance(old,next,hasReply){
  if(hasReply||old==='replied')return 'replied';
  if(!(next in ORDER)||!(old in ORDER))return next;
  return ORDER[next]>=ORDER[old]?next:old;
 }
 // The computer returns only recently changed rows: update or add by ID, never remove.
 function merge(shown,answer){
  const rows=shown.map(m=>({...m,activity:null}));
  for(const incoming of answer||[]){
   const i=rows.findIndex(r=>r.id===incoming.id);
   if(i<0){rows.push({...incoming,local:false});continue;}
   const row=rows[i],reply=incoming.reply||row.reply||'';
   rows[i]={...row,status:advance(row.status,incoming.status,!!reply),reply,reply_at:incoming.reply_at??row.reply_at,
    truncated:incoming.truncated??row.truncated,text:incoming.text||row.text,
    attachments:incoming.attachments?.length?incoming.attachments:row.attachments,activity:incoming.activity||null,local:false};
  }
  return rows.sort((a,b)=>a.created-b.created);
 }
 // What a session takes: the relay's capabilities, or the same rules as agent/onetop/bridge.py.
 function capabilities(s){
  if(Array.isArray(s?.capabilities))return new Set(s.capabilities);
  const caps=new Set();if(!s?.control_key)return caps;
  const state=s.status||'unknown',term=!!s.orca_terminal,verified=s.input_verified===true,tool=TOOLS.includes(s.kind);
  const instruction=s.kind==='Aside'?['working','idle','interrupted'].includes(state):term&&verified&&tool&&['idle','interrupted'].includes(state)&&s.display_status!=='resuming';
  const readable=!!s.path&&(tool||s.kind==='Aside');
  if(instruction)caps.add('prompt');
  if(readable){caps.add('mailbox');if(instruction||term&&verified&&tool&&['working','idle','interrupted'].includes(state)){caps.add('message');if(tool)caps.add('message_images');}}
  return caps;
 }
 // The session's work right now; message delivery is separate.
 function workState(s,fresh){
  if(s?.offline)return 'offline';if(!fresh)return 'stale';
  const state=s?.display_status||s?.status;return ['working','waiting','paused'].includes(state)?state:'idle';
 }
 const WORK={working:'작업 중',waiting:'입력 대기',paused:'일시정지',idle:'대기',offline:'오프라인',stale:'오래된 보고'};
 const DELIVERY={queued:['현재 작업이 끝나면 전달','◷',''],sending:['전송 중','↑',''],awaiting_reply:['답신 대기','…',''],replied:['답신 도착','✓',''],
  delivery_unconfirmed:['전달 미확인 · 재전송 전에 세션 확인','!','warn'],source_changed:['답신 연결 변경됨','⇄','warn'],
  not_delivered:['미전달 · 세션 변경 또는 대기 만료','×','error'],send_failed:['보내지 못함 · 거부됨','!','error']};
 const TYPING={responding:'응답 준비 중…',working:'작업 중…',writing:'답변 작성 중…'};
 const PHOTO_PROMPT={ko:'첨부한 사진을 확인해 주세요.',en:'Please inspect the attached image(s).',zh:'请查看附上的图片。'};
 const textLength=s=>String(s||'').length;

 // Why the composer cannot send as it is, or '' when it can.
 function sendBlock(s,draft,fresh){
  const caps=capabilities(s);
  if(!caps.has('message')&&!caps.has('prompt'))return '현재 이 세션의 입력 연결을 확인할 수 없습니다. 실행 중인 터미널은 먼저 작업을 중단한 뒤 확인하세요.';
  if(draft.photos.length&&!caps.has('message_images'))return '이 세션은 사진을 받을 수 없습니다. 사진을 지우거나 사진을 받을 수 있는 세션에서 보내세요.';
  if(textLength(draft.text)>MAX_TEXT)return '4,000자 이내로 입력하세요.';
  if(!fresh)return '이 컴퓨터의 최신 정보가 있어야 보낼 수 있습니다.';
  return '';
 }

 // Photos: JPEG or PNG in, a JPEG of at most 1600 px on the long edge and 512 KB out, without EXIF.
 async function preparePhoto(file){
  if(!['image/jpeg','image/png'].includes(file.type))throw Error('JPEG·PNG 사진만 보낼 수 있습니다.');
  let bitmap;try{bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});}catch{throw Error('사진을 읽지 못했습니다.');}
  let scale=Math.min(1,LONG_EDGE/Math.max(bitmap.width,bitmap.height));
  for(let attempt=0;attempt<8;attempt++){
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
   for(const quality of [.86,.76,.66,.56]){
    const blob=await new Promise(done=>canvas.toBlob(done,'image/jpeg',quality));
    if(blob&&blob.size<=MAX_BYTES){
     const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
     return {id:crypto.randomUUID(),mime:'image/jpeg',data:btoa(binary),bytes:blob.size,preview:canvas.toDataURL('image/jpeg',.7)};
    }
   }
   scale*=.8;
  }
  throw Error('사진을 512KB 이하로 줄이지 못했습니다.');
 }

 // ---------- Browser view ----------
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const drafts=new Map(),boxes=new Map(),failed=new Map(),sentPhotos=new Map(),sending=new Map();
 let root$=null,dialog$=null,current=null,context={},timer=0,reading=false,pending=null;
 const draftOf=key=>{if(!drafts.has(key))drafts.set(key,{text:'',photos:[],error:''});return drafts.get(key);};
 const boxOf=key=>{if(!boxes.has(key))boxes.set(key,{messages:[],error:'',missing:false});return boxes.get(key);};
 const language=()=>root.OneTopI18n?.language||'ko';
 const time=t=>new Date(t*1000).toLocaleTimeString(root.OneTopI18n?.locale?.()||'ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit'});

 async function post(path,body){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':context.token||''},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await response.json().catch(()=>({}));return {status:response.status,result};
 }

 function mount(element,confirmDialog){
  root$=element;dialog$=confirmDialog;
  root$.innerHTML=`<div class="conversation-log" role="log" aria-live="polite"></div><form class="composer"><div class="composer-state"></div><div class="composer-photos"></div><p class="composer-note" role="alert"></p><div class="composer-row"><label class="composer-photo" title="사진 추가"><input type="file" accept="image/jpeg,image/png" multiple hidden><span aria-hidden="true">＋</span><span class="visually-hidden">사진 추가</span></label><textarea rows="1" aria-label="세션에 보낼 메시지"></textarea><button type="submit" class="composer-send" aria-label="메시지 보내기">↑</button></div><small class="composer-foot">작업 중인 세션은 답신이 늦을 수 있습니다. 메시지 전송은 AI 토큰을 사용할 수 있습니다.</small></form>`;
  const form=root$.querySelector('form'),input=root$.querySelector('textarea'),file=root$.querySelector('input[type=file]');
  input.addEventListener('input',()=>{if(!current)return;const d=draftOf(current.id);d.text=input.value.slice(0,MAX_TEXT);if(input.value!==d.text)input.value=d.text;d.error='';fit(input);renderComposer();});
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();form.requestSubmit();}});
  form.addEventListener('submit',e=>{e.preventDefault();confirm();});
  file.addEventListener('change',async()=>{
   if(!current)return;const key=current.id,files=[...file.files];file.value='';const reasons=[];
   for(const f of files){
    if(draftOf(key).photos.length>=MAX_PHOTOS){reasons.push('사진은 3장까지 보낼 수 있습니다.');break;}
    try{draftOf(key).photos.push(await preparePhoto(f));}catch(error){reasons.push(error.message);}
   }
   draftOf(key).error=[...new Set(reasons)].join('\n');renderComposer();
  });
  root$.addEventListener('click',e=>{
   const remove=e.target.closest('[data-photo-remove]');
   if(remove&&current){const d=draftOf(current.id);d.photos=d.photos.filter(p=>p.id!==remove.dataset.photoRemove);renderComposer();return;}
   const back=e.target.closest('[data-bring-back]');
   if(back&&current)bringBack(back.dataset.bringBack,current.id);
  });
  dialog$.querySelector('[data-message-cancel]').onclick=()=>{pending=null;dialog$.close();};
  dialog$.querySelector('[data-message-confirm]').onclick=()=>{const ask=pending;pending=null;dialog$.close();if(ask)send(ask);};
  dialog$.addEventListener('cancel',()=>{pending=null;});
 }
 const fit=input=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,140)+'px';};

 // Called on every detail render with the current row; the composer keeps its text and caret.
 function show(session,ctx){
  if(!root$)return;
  const changed=current?.id!==session.id;current=session;context=ctx||{};root$.hidden=false;
  if(changed){const input=root$.querySelector('textarea');input.value=draftOf(session.id).text;fit(input);}
  renderTimeline();renderComposer();
  if(!timer){read();timer=setInterval(read,READ_EVERY);}
 }
 function hide(){if(root$)root$.hidden=true;clearInterval(timer);timer=0;current=null;}

 async function read(){
  const s=current;if(!s||reading)return;
  const caps=capabilities(s),box=boxOf(s.id);
  if(!caps.has('mailbox')||box.missing||!context.fresh)return;
  reading=true;
  try{
   const {status,result}=await post('/api/mailbox',{session_id:s.id,control_key:s.control_key});
   // A collector without the reader keeps what this page sent, with their delivery receipts.
   if(status===404||status===501){box.missing=true;return;}
   if(status>=400||result.ok===false){box.error=result.message||'';return;}
   box.messages=merge(box.messages,result.messages||[]);
   if(!box.messages.some(m=>m.status==='send_failed'))box.error='';
  }catch{/* The next read tries again. */}
  finally{reading=false;if(current?.id===s.id)renderTimeline();}
 }

 function confirm(){
  const s=current;if(!s)return;const d=draftOf(s.id),block=sendBlock(s,d,context.fresh);
  if(!d.text.trim()&&!d.photos.length)return;
  if(block){d.error=block;renderComposer();return;}
  const caps=capabilities(s),message=caps.has('message'),text=d.text.trim()?d.text:PHOTO_PROMPT[language()]||PHOTO_PROMPT.en;
  pending={session:s,action:message?'message':'prompt',text,photos:d.photos.length};
  dialog$.querySelector('[data-message-title]').textContent=message?'이 세션에 메시지를 보낼까요?':'이 AI에게 지시를 보낼까요?';
  dialog$.querySelector('[data-message-target]').textContent=`${context.name||s.project||''}\n${text}${d.photos.length?`\n📷 × ${d.photos.length}`:''}`;
  dialog$.querySelector('[data-message-explanation]').textContent=message?'작업 중인 세션에는 현재 작업이 끝난 뒤 접수 순서대로 전달됩니다. 메시지 전송은 AI 토큰을 사용할 수 있습니다.':'이 세션은 답신을 받을 수 없어 지시만 새 요청으로 전달됩니다. AI 토큰을 사용할 수 있습니다.';
  dialog$.showModal();dialog$.querySelector('[data-message-confirm]').focus();
 }

 // A definite refusal (4xx) keeps the draft; an unknown fate (5xx, time-out, lost connection) is
 // delivery unconfirmed and never resent on its own. The composer empties as soon as a send starts.
 async function send({session:s,action,text}){
  const key=s.id,draft=draftOf(key),kept={text:draft.text,photos:[...draft.photos],error:''},photos=kept.photos;
  drafts.set(key,{text:'',photos:[],error:''});if(current?.id===key)root$.querySelector('textarea').value='';
  const id=crypto.randomUUID(),box=boxOf(key);
  if(action==='message'){
   box.messages.push({id,text,created:Date.now()/1000,status:'sending',reply:'',local:true,attachments:photos.map((p,i)=>({name:`photo-${i+1}.jpg`,mime:p.mime,bytes:p.bytes}))});
   if(photos.length)sentPhotos.set(id,photos.map(p=>p.preview));
  }
  sending.set(key,(sending.get(key)||0)+1);render(key);
  try{
   const {status,result}=await post('/api/action',{action,session_id:s.id,control_key:s.control_key,request_id:id,prompt:text,
    ...(photos.length?{attachments:photos.map(p=>({mime:p.mime,data:p.data}))}:{})});
   if(status>=400&&status<500)throw Object.assign(Error(result.message||'보내지 못했습니다.'),{definite:true});
   if(status>=500)throw Error(result.message||'');
   if(action==='prompt'){box.note=result.message||'';return;}
   // The collector says whether the message waits for the session's turn; its queue is the truth over 'sending'.
   if(result.queued){const m=box.messages.find(m=>m.id===id);if(m&&m.status==='sending')m.status='queued';}
   else setStatus(key,id,result.status==='unconfirmed'?'delivery_unconfirmed':'awaiting_reply');
  }catch(error){
   if(error.definite){
    const now=draftOf(key);
    if(!now.text&&!now.photos.length){box.messages=box.messages.filter(m=>m.id!==id);sentPhotos.delete(id);drafts.set(key,{...kept,error:error.message});if(current?.id===key)root$.querySelector('textarea').value=kept.text;}
    else{failed.set(id,kept);const m=box.messages.find(m=>m.id===id);if(m)m.status='send_failed';box.error=error.message;}
   }else{setStatus(key,id,'delivery_unconfirmed');box.error='전달 미확인 · 재전송 전에 세션 확인';}
  }finally{sending.set(key,Math.max(0,(sending.get(key)||1)-1));render(key);}
 }
 function setStatus(key,id,status){const m=boxOf(key).messages.find(m=>m.id===id);if(m)m.status=advance(m.status,status,!!m.reply);}
 function bringBack(id,key){
  const kept=failed.get(id);if(!kept)return;failed.delete(id);
  const d=draftOf(key);d.text=d.text?d.text+'\n'+kept.text:kept.text;d.photos=[...d.photos,...kept.photos].slice(0,MAX_PHOTOS);
  const box=boxOf(key);box.messages=box.messages.filter(m=>m.id!==id);sentPhotos.delete(id);if(!box.messages.some(m=>m.status==='send_failed'))box.error='';
  if(current?.id===key)root$.querySelector('textarea').value=d.text;render(key);
 }
 const render=key=>{if(current?.id===key){renderTimeline();renderComposer();}};

 let shownTimeline='';
 function renderTimeline(){
  const s=current;if(!s)return;
  const caps=capabilities(s),box=boxOf(s.id),log=root$.querySelector('.conversation-log'),work=workState(s,context.fresh);
  const notes=[];
  if(!caps.has('message')&&caps.has('prompt'))notes.push(['warn','이 세션은 답신을 받을 수 없어 지시만 전달됩니다.']);
  else if(caps.has('message')&&!caps.has('mailbox'))notes.push(['warn','현재 이 세션의 메시지 연결을 확인할 수 없습니다.']);
  if(box.missing)notes.push(['','이 수집기는 아직 대화 기록을 읽을 수 없습니다. 보낸 메시지의 전달 상태만 표시합니다.']);
  const replies=caps.has('message');
  const bubble=m=>{const [label,icon,tone]=DELIVERY[m.status]||[m.status,'?',''],previews=sentPhotos.get(m.id)||[];
   const photos=previews.length?`<div class="mail-photos">${previews.map(src=>`<img src="${src}" alt="">`).join('')}</div>`:m.attachments?.length?`<p class="mail-files"><span>사진</span> <b>${m.attachments.length}</b><span data-user-content>${m.attachments.map(a=>a.name?' · '+esc(a.name):'').join('')}</span></p>`:'';
   return `<div class="mail-pair"><article class="mail-out">${photos}<p class="mail-text" data-user-content>${esc(m.text)}</p><small class="mail-status ${tone}" data-status="${esc(m.status)}"><i aria-hidden="true">${icon}</i><span>${esc(label)}</span></small>${failed.has(m.id)?`<button type="button" class="mail-back" data-bring-back="${esc(m.id)}">입력창으로 다시 가져오기</button>`:''}</article>${m.reply?`<article class="mail-in"><b>세션의 답신</b><p class="mail-text" data-user-content>${esc(m.reply)}</p>${m.truncated?'<small>긴 답신의 일부를 표시합니다.</small>':''}</article>`:''}</div>`;};
  const active=work==='offline'||work==='stale'?null:box.messages.filter(m=>m.activity).sort((a,b)=>b.created-a.created)[0];
  const html=`<p class="conversation-intro">이 세션에게 보낸 메시지와 답신입니다. 전체 작업 대화는 컴퓨터에 남습니다.</p>${notes.map(([tone,text])=>`<p class="conversation-note ${tone}">${text}</p>`).join('')}`+
   (box.messages.length?box.messages.map(bubble).join(''):`<div class="conversation-empty"><b>${replies?'이 세션에 물어보세요':'이 AI에게 지시하기'}</b><span>${replies?'“지금 어디까지 진행됐어?”':'이어서 테스트하고 오류 고쳐줘'}</span></div>`)+
   // Three moving dots only; the phase is read out to screen readers, not written under the work state.
   (active?`<div class="typing" role="status" data-phase="${esc(active.activity.phase)}"><span class="typing-dots" role="img" aria-label="${TYPING[active.activity.phase]||TYPING.writing}"><i></i><i></i><i></i></span></div>`:'')+
   (box.note?`<p class="conversation-note">${esc(box.note)}</p>`:'')+(box.error?`<p class="conversation-note error">${esc(box.error)}</p>`:'');
  if(html===shownTimeline)return;
  const nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<80;shownTimeline=html;log.innerHTML=html;if(nearEnd)log.scrollTop=log.scrollHeight;
 }
 function renderComposer(){
  const s=current;if(!s)return;
  const caps=capabilities(s),d=draftOf(s.id),block=sendBlock(s,d,context.fresh),work=workState(s,context.fresh),busy=(sending.get(s.id)||0)>0;
  root$.querySelector('.composer-state').innerHTML=`<span class="status ${work}"><i class="dot"></i>${WORK[work]}</span>${context.reported?`<small><span>마지막 보고</span> <time>${time(context.reported)}</time></small>`:''}`;
  root$.querySelector('.composer-photos').innerHTML=d.photos.map((p,i)=>`<span class="composer-preview"><img src="${p.preview}" alt=""><button type="button" data-photo-remove="${p.id}" aria-label="사진 지우기">×</button></span>`).join('');
  const note=root$.querySelector('.composer-note'),text=d.error||(block&&(d.text||d.photos.length)?block:'');note.textContent=text;note.className='composer-note'+(d.error?' error':' warn');note.hidden=!text;
  const photo=root$.querySelector('.composer-photo');photo.hidden=!caps.has('message_images');photo.classList.toggle('disabled',d.photos.length>=MAX_PHOTOS);photo.querySelector('input').disabled=d.photos.length>=MAX_PHOTOS;
  // i18n.js leaves text fields alone, so the hint is translated here.
  root$.querySelector('textarea').placeholder=(root.OneTopI18n?.t||(x=>x))(caps.has('message')?'메시지를 입력하세요…':'지시를 입력하세요…');
  const sendButton=root$.querySelector('.composer-send');sendButton.disabled=!!block||!(d.text.trim()||d.photos.length);sendButton.classList.toggle('busy',busy);
 }

 const api={advance,merge,capabilities,workState,sendBlock,DELIVERY,TYPING,WORK,MAX_PHOTOS,MAX_BYTES,MAX_TEXT,mount,show,hide};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopConversation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
