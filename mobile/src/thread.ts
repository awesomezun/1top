// One conversation per session: what can be sent, how photos are fitted, and how delivery and
// the session's work are named. Pure functions only, so they can be tested without a phone.

export const PHOTO_LIMIT=524288,PHOTO_MAX=3,PHOTO_EDGE=1600,TEXT_MAX=4000;
// Long edges and JPEG qualities tried in order until a photo fits the limit.
export const EDGES=[1600,1280,1024,800,640],QUALITIES=[.82,.68,.55];

type T=(en:string,ko:string)=>string;
export type Attachment={mime:string;data:string};
/** A timeline row: the mailbox's own fields, plus local previews of photos sent from this phone. */
export type Mail={id:string;text:string;created:number;status:string;reply:string;reply_at?:number;truncated?:boolean;local?:boolean;attachments?:{id?:string;name?:string;mime?:string;bytes?:number}[];photos?:{uri:string}[];instruction?:boolean;activity?:Activity|null};
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
/** Delivery of one message, kept apart from the session's work. "Replied" covers this message only. */
export function deliveryLabel(status:string,t:T){
 return ({queued:t('Queued · enters when the current turn ends','대기 중 · 현재 작업이 끝나면 전달'),sending:t('Sending','전송 중'),awaiting_reply:t('Delivered · waiting for a reply','전달됨 · 답신 대기'),replied:t('Replied','답신 도착'),
  delivery_unconfirmed:t('Delivery unconfirmed · check the session before sending again','전달 미확인 · 다시 보내기 전에 세션 확인'),source_changed:t('Reply source changed · the session was replaced','답신 연결 변경됨 · 세션이 바뀌었습니다'),
  not_delivered:t('Not delivered · the session changed or the wait expired','미전달 · 세션이 바뀌었거나 대기가 만료됨'),instruction_sent:t('Instruction delivered · this session cannot reply','지시 전달됨 · 이 세션은 답신할 수 없음')} as Record<string,string>)[status]||status;
}
/** A message this phone sent that no receipt or mailbox moved past "sending" for 30 s is unconfirmed. */
export const effectiveStatus=(m:{status:string;local?:boolean;created:number},nowSeconds:number)=>m.local&&m.status==='sending'&&nowSeconds-m.created>30?'delivery_unconfirmed':m.status;
export function deliveryTone(status:string):'progress'|'done'|'problem'{return status==='replied'||status==='instruction_sent'?'done':['delivery_unconfirmed','source_changed','not_delivered'].includes(status)?'problem':'progress';}

export type Work='working'|'waiting'|'idle'|'paused'|'offline'|'stale';
/** The session's work from its live status and how fresh its computer's report is. No percentages. */
export function workState(row:{status:string;device:{online:boolean;received:number}},now:number,limit=30000):Work{
 if(!row.device.online)return 'offline';
 if(!(now-row.device.received<limit))return 'stale';
 return row.status==='working'?'working':row.status==='waiting'?'waiting':row.status==='paused'||row.status==='resuming'?'paused':'idle';
}
export function workLabel(work:Work,t:T){return ({working:t('Working','작업 중'),waiting:t('Waiting for input','입력 대기'),idle:t('Idle','대기'),paused:t('Paused','일시정지'),offline:t('Computer offline','컴퓨터 오프라인'),stale:t('Report is old','오래된 보고')} as Record<Work,string>)[work];}

/** A send refused on the phone or answered by the relay failed for sure; a timeout or a dropped connection may
 *  still have delivered it, so it stays unconfirmed and is never resent automatically. */
export const sendOutcome=(error:{status?:unknown;local?:boolean}):'failed'|'unconfirmed'=>typeof error?.status==='number'||error?.local===true?'failed':'unconfirmed';

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
export const activityLabel=(phase:Phase,t:T)=>({responding:t('Preparing a reply…','응답 준비 중…'),working:t('Working…','작업 중…'),writing:t('Writing a reply…','답변 작성 중…')})[phase];
