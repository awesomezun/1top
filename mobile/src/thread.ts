// One conversation per session: what can be sent, how photos are fitted, and how delivery and
// the session's work are named. Pure functions only, so they can be tested without a phone.

export const PHOTO_LIMIT=524288,PHOTO_MAX=3,PHOTO_EDGE=1600,TEXT_MAX=4000;
// Long edges and JPEG qualities tried in order until a photo fits the limit.
export const EDGES=[1600,1280,1024,800,640],QUALITIES=[.82,.68,.55];

type T=(en:string,ko:string)=>string;
export type Attachment={mime:string;data:string};
/** A photo in a draft: its preview and the fitted JPEG that will be sent. */
export type DraftPhoto={id:string;uri:string;name:string;mime:string;data:string;bytes:number};
export type Draft={text:string;photos:DraftPhoto[]};
export const EMPTY:Draft={text:'',photos:[]};
/** A timeline row: the mailbox's own fields, plus what only this phone knows about a message it sent:
 *  photo previews, the draft it came from (to bring back after a refusal) and why it was refused. */
export type Mail={id:string;request_id?:string;text:string;created:number;status:string;reply:string;reply_at?:number;truncated?:boolean;local?:boolean;attachments?:{id?:string;name?:string;mime?:string;bytes?:number}[];photos?:{uri:string}[];instruction?:boolean;activity?:Activity|null;draft?:Draft;error?:string};
export type Activity={phase:Phase;observed_at:number};
export type Fitted={width:number;height:number;quality:number;bytes:number;data:string;uri:string};

/** Decoded size of base64 data. */
export function base64Bytes(data:string){const clean=data.replace(/\s/g,'');if(!clean)return 0;const pad=clean.endsWith('==')?2:clean.endsWith('=')?1:0;return Math.floor(clean.length*3/4)-pad;}

/** Scale to a long edge, keeping the aspect ratio and never enlarging. */
export function fitted(width:number,height:number,edge:number){const long=Math.max(width,height);if(!(long>0))return {width:0,height:0};const k=Math.min(1,edge/long);return {width:Math.max(1,Math.round(width*k)),height:Math.max(1,Math.round(height*k))};}

/** Sizes and qualities to try, largest first, without repeating a size the photo cannot reach. */
export function fitPlan(width:number,height:number){
 const long=Math.max(width,height),seen=new Set<number>(),plan:{width:number;height:number;quality:number}[]=[];
 for(const edge of EDGES){const e=Math.min(edge,long);if(seen.has(e))continue;seen.add(e);const size=fitted(width,height,e);for(const quality of QUALITIES)plan.push({...size,quality});}
 return plan;
}

/** Re-encodes until the decoded JPEG is within the limit. The encoder strips EXIF by re-encoding. */
export async function fitPhoto(width:number,height:number,encode:(width:number,height:number,quality:number)=>Promise<{data:string;uri:string}>):Promise<{ok:true;photo:Fitted}|{ok:false;smallest:number|null}>{
 let smallest:number|null=null;
 for(const step of fitPlan(width,height)){const out=await encode(step.width,step.height,step.quality),bytes=base64Bytes(out.data);
  if(bytes>0&&bytes<=PHOTO_LIMIT)return {ok:true,photo:{...step,bytes,data:out.data,uri:out.uri}};
  if(bytes>0)smallest=smallest===null?bytes:Math.min(smallest,bytes);}
 return {ok:false,smallest};
}

/** Why a set of attachments cannot be sent, or null when it can. */
export function checkAttachments(list:Attachment[]):'count'|'type'|'size'|'empty'|null{
 if(list.length>PHOTO_MAX)return 'count';
 for(const a of list){if(a.mime!=='image/jpeg'&&a.mime!=='image/png')return 'type';if(!a.data)return 'empty';if(base64Bytes(a.data)>PHOTO_LIMIT)return 'size';}
 return null;
}

/** Questions and instructions both go as a message, which brings a reply; older computers take a
 *  text-only instruction that cannot answer. */
export function sendMode(capabilities:string[]):{mode:'message'|'prompt'|'none';photos:boolean;replies:boolean}{
 const message=capabilities.includes('message'),prompt=capabilities.includes('prompt');
 return {mode:message?'message':prompt?'prompt':'none',photos:message&&capabilities.includes('message_images'),replies:message&&capabilities.includes('mailbox')};
}

export const defaultPrompt=(t:T)=>t('Please inspect the attached image(s).','첨부한 사진을 확인해 주세요.');

export type Delivery='queued'|'sending'|'awaiting_reply'|'replied'|'delivery_unconfirmed'|'source_changed'|'not_delivered'|'instruction_sent';
/** Under a sent message, as in a chat app: a short state, kept apart from the session's work. A message the
 *  session answered shows none; the AI's message says it all. */
export function deliveryLabel(status:string,t:T){
 return ({queued:t('Queued','차례 기다리는 중'),sending:t('Sending','보내는 중'),awaiting_reply:t('Sent','보냄'),replied:'',
  delivery_unconfirmed:t('Not confirmed','확인 안 됨'),source_changed:t('Session changed','세션이 바뀜'),
  not_delivered:t('Not sent','보내지 못함'),not_sent:t('Not sent','보내지 못함'),instruction_sent:t('Instruction sent','지시 보냄')} as Record<string,string>)[status]??status;
}
/** What a state means where its short word is not enough, read out with it (the desktop's title). */
export const deliveryMeaning=(status:string,t:T)=>({queued:t('Sends when the current work finishes.','지금 작업이 끝나면 보냅니다.'),
 delivery_unconfirmed:t('Could not confirm it was sent. Check the session before sending again.','보냈는지 확인하지 못했습니다. 다시 보내기 전에 세션을 확인하세요.'),
 source_changed:t('The session that got this message changed.','이 메시지를 받은 세션이 바뀌었습니다.'),
 not_delivered:t('Not sent: the session changed or the wait ran out.','세션이 바뀌었거나 기다리는 시간이 지나 보내지 못했습니다.'),
 instruction_sent:t('This session takes instructions only. See the result on the computer.','이 세션은 지시만 받습니다. 결과는 컴퓨터에서 확인하세요.')} as Record<string,string>)[status]||'';
/** The symbol beside each delivery state, as on the iPhone. */
export const deliveryIcon=(status:string)=>({queued:'clock',sending:'sending',awaiting_reply:'check',instruction_sent:'check',delivery_unconfirmed:'warning',source_changed:'branch',not_delivered:'failed',not_sent:'failed'} as Record<string,'clock'|'sending'|'check'|'warning'|'branch'|'failed'>)[status]||'check';
/** A message this phone sent that no receipt or mailbox moved past "sending" for 30 s is unconfirmed. */
export const effectiveStatus=(m:{status:string;local?:boolean;created:number},nowSeconds:number)=>m.local&&m.status==='sending'&&nowSeconds-m.created>30?'delivery_unconfirmed':m.status;
export function deliveryTone(status:string):'progress'|'done'|'problem'{return status==='replied'||status==='instruction_sent'?'done':['delivery_unconfirmed','source_changed','not_delivered','not_sent'].includes(status)?'problem':'progress';}

export type Work='working'|'waiting'|'idle'|'paused'|'offline'|'stale';
/** The session's work from its live status and how fresh its computer's report is. No percentages. */
export function workState(row:{status:string;device:{online:boolean;received:number}},now:number,limit=30000):Work{
 if(!row.device.online)return 'offline';
 if(!(now-row.device.received<limit))return 'stale';
 return row.status==='working'?'working':row.status==='waiting'?'waiting':row.status==='paused'||row.status==='resuming'?'paused':'idle';
}
export function workLabel(work:Work,t:T){return ({working:t('Working','작업 중'),waiting:t('Waiting for input','입력 대기'),idle:t('Idle','대기'),paused:t('Paused','일시정지'),offline:t('Computer offline','컴퓨터 오프라인'),stale:t('Report is old','오래된 보고')} as Record<Work,string>)[work];}

/** One session's sends reach the relay in the order they were made: each goes out once the one before it
 *  has its answer (accepted, refused or lost), so a text-only message never overtakes a slower one with
 *  photos. Nothing waits for the session's reply, and other sessions (other keys) do not wait. A failure
 *  ends only its own turn; the next send still goes. */
export function inTurn<T>(lanes:Map<string,Promise<unknown>>,key:string,work:()=>Promise<T>):Promise<T>{
 const mine=(lanes.get(key)??Promise.resolve()).then(work),turn=mine.catch(()=>{});
 lanes.set(key,turn);turn.then(()=>{if(lanes.get(key)===turn)lanes.delete(key);});
 return mine;
}
/** Only a send refused on the phone or by the relay (4xx) failed for sure. A server error (5xx), a timeout
 *  or a dropped connection may still have delivered it: unconfirmed, and never resent automatically. */
export const sendOutcome=(error:{status?:unknown;local?:boolean}):'failed'|'unconfirmed'=>error?.local===true||(typeof error?.status==='number'&&error.status>=400&&error.status<500)?'failed':'unconfirmed';

/** Photos stored with a mailbox row: a count, and names while they fit. */
export function attachmentSummary(list:{name?:string;bytes?:number}[]|null|undefined,t:T){
 if(!list?.length)return '';const names=list.map(a=>a.name).filter(Boolean) as string[];
 const count=list.length===1?t('1 photo','사진 1장'):t(`${list.length} photos`,`사진 ${list.length}장`);
 return names.length?count+' · '+names.join(', '):count;
}
export const kb=(bytes:number)=>Math.max(1,Math.round(bytes/1024))+'KB';

/** Request-scoped activity from the computer: seen only after this request entered the session and
 *  real work followed it. Shown as one typing indicator for the latest request that has it; never
 *  guessed from delivery status, a working session or a receipt, and hidden on an offline or old report. */
export type Phase='responding'|'working'|'writing';
const PHASES:Phase[]=['responding','working','writing'];
export function responseActivity(messages:{status:string;activity?:Activity|null}[],work:Work):Activity|null{
 if(work==='offline'||work==='stale')return null;
 let latest:Activity|null=null;
 for(const m of messages){const a=m.activity;
  // A reply, a queued request or a failed delivery ends or never started the activity.
  if(!a||!PHASES.includes(a.phase)||typeof a.observed_at!=='number'||!Number.isFinite(a.observed_at)||!['sending','awaiting_reply'].includes(m.status))continue;
  if(!latest||a.observed_at>latest.observed_at)latest=a;}
 return latest;
}
export const activityLabel=(phase:Phase,t:T)=>({responding:t('Thinking…','생각하는 중…'),working:t('Working…','작업 중…'),writing:t('Writing…','작성 중…')})[phase];

// Conversations are kept per session (device id : session id): each has its own draft and timeline,
// so sends that finish late only touch the session they were sent to.
export type Convo={draft:Draft;thread:Mail[]};
export const emptyDraft=(d:Draft)=>!d.text.trim()&&!d.photos.length;
const update=(c:Convo,id:string,change:(m:Mail)=>Mail|null):Convo=>({...c,thread:c.thread.flatMap(m=>m.id!==id?[m]:(x=>x?[x]:[])(change(m)))});

/** Sending empties the composer at once so the next message can be written while this one travels. */
export const startSend=(c:Convo,mail:Mail):Convo=>({draft:EMPTY,thread:[...c.thread,mail]});
/** A refusal brings the draft back only into an empty composer. Otherwise the refused message stays
 *  in the timeline, with its text and photos, until the reader brings it back. */
export const sendFailed=(c:Convo,id:string,reason:string):Convo=>{
 const row=c.thread.find(m=>m.id===id);if(!row)return c;
 if(emptyDraft(c.draft)&&row.draft)return {draft:row.draft,thread:c.thread.filter(m=>m.id!==id)};
 return update(c,id,m=>({...m,status:'not_sent',error:reason}));
};
export const sendUnconfirmed=(c:Convo,id:string):Convo=>update(c,id,m=>m.status==='sending'?{...m,status:'delivery_unconfirmed'}:m);
/** Appends a refused message to the current draft: text after a blank line, photos up to the limit.
 *  Photos that do not fit stay on the refused message. */
export function bringBack(c:Convo,id:string,max=PHOTO_MAX):Convo{
 const row=c.thread.find(m=>m.id===id);if(!row?.draft)return c;
 const have=new Set(c.draft.photos.map(p=>p.id)),incoming=row.draft.photos.filter(p=>!have.has(p.id)),room=Math.max(0,max-c.draft.photos.length);
 const text=[c.draft.text.trimEnd(),row.draft.text].filter(x=>x.trim()).join('\n\n'),moved=incoming.slice(0,room),left=incoming.slice(room);
 const draft={text,photos:[...c.draft.photos,...moved]};
 return left.length?{draft,thread:c.thread.map(m=>m.id===id?{...m,draft:{text:'',photos:left},photos:left.map(p=>({uri:p.uri}))}:m)}:{draft,thread:c.thread.filter(m=>m.id!==id)};
}

// Delivery only moves forward: a late or partial mailbox answer never takes a message back.
const RANK:Record<string,number>={sending:0,delivery_unconfirmed:0,not_sent:0,queued:1,awaiting_reply:2,instruction_sent:2,source_changed:3,not_delivered:3,replied:4};
export const forward=(old:string,next:string)=>(RANK[next]??2)>=(RANK[old]??2)?next:old;
const key=(m:{id:string;request_id?:string})=>m.request_id||m.id;

/** The mailbox returns only the latest changed open requests (up to 10), so it is merged by request,
 *  never used to replace the timeline: rows it leaves out stay, replies already shown stay, and
 *  activity is taken only from this answer. A message this phone sent matches its request id. */
export function mergeMailbox(thread:Mail[],server:Mail[]):Mail[]{
 const rows=thread.map(m=>m.activity?{...m,activity:null}:m),at=new Map(rows.map((m,i)=>[key(m),i]));
 for(const s of server){const i=at.get(key(s));
  if(i===undefined){at.set(key(s),rows.length);rows.push({...s,activity:s.activity??null});continue;}
  const old=rows[i];
  rows[i]={...old,...s,status:forward(old.status,s.status),reply:s.reply||old.reply,reply_at:s.reply_at??old.reply_at,photos:old.photos,draft:old.draft,local:false,activity:s.activity??null};}
 return rows.map((m,i)=>[m,i] as const).sort((a,b)=>(a[0].created-b[0].created)||(a[1]-b[1])).map(([m])=>m);
}

/** Relay receipts for this phone's sends, applied by request id. Every receipt is kept, so two
 *  results arriving together are both applied. */
export function applyReceipts(thread:Mail[],receipts:{status:string;request:{request_id:string}}[]):Mail[]{
 let changed=false;
 const next=thread.map(m=>{if(m.status!=='sending')return m;const r=receipts.find(x=>x.request?.request_id===key(m));if(!r)return m;changed=true;return {...m,status:r.status==='failed'?'delivery_unconfirmed':m.instruction?'instruction_sent':'awaiting_reply'};});
 return changed?next:thread;
}
