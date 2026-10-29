export const ACTIONS = ['focus', 'pause', 'resume', 'terminate', 'prompt', 'message'] as const;
export const CAPABILITIES = [...ACTIONS, 'mailbox', 'message_images'] as const;
export type Action = typeof ACTIONS[number];
export interface AgentSession {
  id: string; control_key?: string; kind: string; app: string; terminal: string;
  project: string; title: string; model: string; status: string;
  tokens: number[] | null; rate: number | null; windows: Record<string, number[] | null>;
  cpu: number | null; rss: number | null; capabilities: (typeof CAPABILITIES[number])[];
  context_usage?: {basis:'last_request_input';input_tokens:number;capacity:number|null;parts:number[]|null;observed_at:number;model:string}|null;
  weekly_account?:string; weekly_estimate?:Record<string,WeeklyEstimate>;
  root_session_id?:string; parent_session_id?:string|null;
}
export interface WeeklyEstimate {
  used_pp:number;partial:boolean;period_seconds:number|null;tokens:number|null;account_id:string;
  calibration?:{pp_per_token:number;confidence:string;from:number|null;to:number|null;valid_until:number|null;source:string};
}
export interface AccountQuota {
  id:string;kind:string;account_label:string;alias?:string;plan:string;updated:number;stale:boolean;note:string;
  status?:string;
  windows:Array<{label:string;pct:number|null;reset:number}>;
  weekly?:Record<string,{used_pp:number|null;observed_seconds:number;partial:boolean}>;
  usage_points?:Array<[number,number,number]>;
}
export interface DeviceSnapshot {
  flow?:Record<string,{step:number;start:number;end:number;as_of:number;reported:boolean;bins:Record<string,number>[]} >;
  speed_periods?: SpeedPeriod[];
  account_quotas:AccountQuota[];
  updated: number; recording_started: number; sessions: AgentSession[]; applications: Array<{name:string;evidence:string}>;
  host: { cpu: number | null; used_memory: number; total_memory: number; cores: number };
  periods: Array<{key: string; label: string; tokens: number[]; partial: boolean; observed_seconds: number}>;
  version: string;
  operations: { updated: number | null; installed_skills: number | null; observed_events: number | null;
    goals: Array<{thread_id:string;runtime:string;status:string;tokens_used:number|null;time_used_seconds:number|null;session_connected:boolean;evidence:string}>;
    loop_state: 'not_verified'; skill_runtime: 'partial' };
}
export const text = (v: unknown, max = 180): string => typeof v === 'string' ? v.slice(0, max) : '';
const number = (v: unknown, max = Number.MAX_SAFE_INTEGER): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
const vector = (v: unknown): number[] | null => Array.isArray(v) && v.length === 4 && v.every(x => number(x) !== null) ? v : null;
const KEYS = ['24h','12h','5h','1h','30m','10m'];
function weeklyEstimates(value:any,account:string):Record<string,WeeklyEstimate> {
  const result:Record<string,WeeklyEstimate>={};
  for(const key of KEYS){
    const p=value?.[key];
    if(!p||!account||text(p.account_id,100)!==account||number(p.used_pp,1e6)===null)continue;
    const estimate:WeeklyEstimate={used_pp:p.used_pp,partial:p.partial!==false,
      period_seconds:number(p.period_seconds,86400),tokens:number(p.tokens),account_id:account};
    const c=p.calibration;
    if(c&&number(c.pp_per_token,100)!==null&&c.pp_per_token>0){
      estimate.calibration={pp_per_token:c.pp_per_token,confidence:['early','limited'].includes(c.confidence)?c.confidence:'',
        from:number(c.from),to:number(c.to),valid_until:number(c.valid_until),
        source:c.source==='historical_provider_calibration'?c.source:''};
    }
    result[key]=estimate;
  }
  return result;
}
function tokenFlow(value:any):NonNullable<DeviceSnapshot['flow']>{
  const result:NonNullable<DeviceSnapshot['flow']>={};
  const kinds=['Claude','Codex','GLM','Aside','Antigravity','Gemini','OpenCode','unknown'];
  for(const key of KEYS){
    const p=value?.[key],seconds=SPEED_SECONDS[key];
    const step=seconds>18000?900:seconds>3600?300:60;
    if(!p||p.step!==step||number(p.start)===null||number(p.end)===null||number(p.as_of)===null||
       p.end-p.start!==seconds||p.as_of>p.end||!Array.isArray(p.bins)||p.bins.length!==seconds/step)continue;
    const bins=p.bins.map((b:any)=>Object.fromEntries(kinds.flatMap(k=>number(b?.[k])===null?[]:[[k,b[k]]])));
    result[key]={step,start:p.start,end:p.end,as_of:p.as_of,reported:p.reported===true,bins};
  }
  return result;
}
export interface SpeedPeriod {key:string;seconds:number;tokens:number;known:boolean;partial:boolean}
export const SPEED_SECONDS:Record<string,number>=Object.fromEntries([
  ['10m',600],['30m',1800],['1h',3600],['5h',18000],['12h',43200],['24h',86400],
  ...[900,7200,10800,21600,172800,259200,604800,1209600,2592000,7776000,15552000,31536000].map(n=>['custom:'+n,n])
]);
export function speedPeriods(value:unknown):SpeedPeriod[]{
  if(!Array.isArray(value))return [];
  const rows=new Map<string,SpeedPeriod>();
  for(const p of value.slice(0,19)){
    if(!p||!(p.key==='all'||p.key in SPEED_SECONDS)||number(p.tokens)===null||number(p.seconds)===null||p.seconds<=0)continue;
    if(p.key!=='all'&&p.seconds!==SPEED_SECONDS[p.key])continue;
    rows.set(p.key,{key:p.key,seconds:p.seconds,tokens:p.tokens,known:p.known===true,partial:p.partial===true});
  }
  return [...rows.values()];
}
// Construct an allowlisted object. Prompt bodies, paths, command arguments,
// provider credentials and arbitrary client fields never enter cloud storage.
export function snapshot(value: any): DeviceSnapshot {
  if (!value || !Array.isArray(value.sessions) || value.sessions.length > 250) throw new Error('Invalid snapshot');
  const sessions: AgentSession[] = value.sessions.map((s: any) => {
    if (!text(s.id, 200)) throw new Error('Missing session identity');
    return {
      id: text(s.id,200), control_key: text(s.control_key,200), kind:text(s.kind,40),
      app:text(s.app,80), terminal:text(s.terminal,120), project:text(s.project,100),
      title:text(s.title,160), model:text(s.model,80), status:text(s.status,30), tokens:vector(s.tokens),
      rate:number(s.rate), windows:Object.fromEntries(KEYS.map(k=>[k,vector(s.windows?.[k])])),
      cpu:number(s.cpu,100000),rss:number(s.rss),
      context_usage:contextUsage(s.context_usage),
      weekly_account:text(s.weekly_account,100),weekly_estimate:weeklyEstimates(s.weekly_estimate,text(s.weekly_account,100)),
      root_session_id:text(s.root_session_id,200)||text(s.id,200),parent_session_id:text(s.parent_session_id,200)||null,
      capabilities:Array.isArray(s.capabilities)?CAPABILITIES.filter(a=>s.capabilities.includes(a)):[]
    };
  });
  if (new Set(sessions.map(s=>s.id)).size!==sessions.length) throw new Error('Duplicate session identity');
  return {
    speed_periods:speedPeriods(value.speed_periods),
    flow:tokenFlow(value.flow),
    updated:number(value.updated)||0,recording_started:number(value.recording_started)||0,
    sessions,version:text(value.version,30),
    account_quotas:Array.isArray(value.account_quotas)?value.account_quotas.slice(0,24).map((q:any)=>({
      id:text(q.id,100),kind:text(q.kind,40),account_label:text(q.kind,40)+' · '+text(q.id,100).slice(-6),alias:text(q.alias,24),
      plan:text(q.plan,40),updated:number(q.updated)||0,stale:q.stale!==false,note:text(q.note,180),
      status:['login_required','login_expired','credential_store_unavailable','access_denied','account_changed','rate_limited','refresh_pending','last_report','report_pending'].includes(q.status)?q.status:'',
      windows:Array.isArray(q.windows)?q.windows.slice(0,8).map((w:any)=>({label:text(w.label,30),pct:number(w.pct,100),reset:number(w.reset)||0})):[],
      weekly:Object.fromEntries(KEYS.filter(k=>q.weekly?.[k]).map(k=>[k,{
        used_pp:number(q.weekly[k].used_pp,1e6),observed_seconds:number(q.weekly[k].observed_seconds,86400)||0,
        partial:q.weekly[k].partial!==false}])),
      usage_points:Array.isArray(q.usage_points)?q.usage_points.slice(-60).filter((p:any)=>Array.isArray(p)&&p.length===3&&
        number(p[0])!==null&&number(p[1],100)!==null&&number(p[2])!==null).map((p:any)=>[p[0],p[1],p[2]] as [number,number,number]):[]
    })):[],
    operations:{updated:number(value.operations?.updated),installed_skills:number(value.operations?.installed_skills,10000),
      observed_events:number(value.operations?.observed_events,10000),loop_state:'not_verified',skill_runtime:'partial',
      goals:Array.isArray(value.operations?.goals)?value.operations.goals.slice(0,100).map((g:any)=>({
        thread_id:text(g.thread_id,200),runtime:text(g.runtime,30),status:text(g.status,30),tokens_used:number(g.tokens_used),
        time_used_seconds:number(g.time_used_seconds),session_connected:g.session_connected===true,evidence:text(g.evidence,30)})):[]},
    applications:Array.isArray(value.applications)?value.applications.slice(0,60).map((a:any)=>({name:text(a.name,80),evidence:'application_process'})):[],
    host:{cpu:number(value.host?.cpu,100),used_memory:number(value.host?.used_memory)||0,
      total_memory:number(value.host?.total_memory)||0,cores:number(value.host?.cores,4096)||0},
    periods:Array.isArray(value.periods)?value.periods.filter((p:any)=>KEYS.includes(p.key)).slice(0,6).map((p:any)=>({key:p.key,label:text(p.label,30),tokens:vector(p.tokens)||[0,0,0,0],partial:p.partial===true,observed_seconds:number(p.observed_seconds,86400)||0})):[]
  };
}
function contextUsage(c:any):AgentSession['context_usage'] {
  if(c?.basis!=='last_request_input'||number(c.input_tokens)===null)return null;
  const parts=Array.isArray(c.parts)&&c.parts.length===3&&c.parts.every((n:unknown)=>number(n)!==null)&&Math.abs(c.parts.reduce((a:number,b:number)=>a+b,0)-c.input_tokens)<.01?c.parts:null;
  return {basis:'last_request_input',input_tokens:c.input_tokens,capacity:number(c.capacity)||null,
    parts,observed_at:number(c.observed_at)||0,model:text(c.model,80)};
}
export function imageAttachments(value: any) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>3)throw Error('Attach up to 3 images');
  return value.map(item=>{
    if(!['image/jpeg','image/png'].includes(item?.mime)||typeof item?.data!=='string'||item.data.length>699052||!item.data.length||item.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.data))throw Error('Invalid photo');
    let bytes:string;try{bytes=atob(item.data);}catch{throw Error('Invalid photo');}
    if(!bytes.length||bytes.length>524288)throw Error('Photo too large');
    const jpeg=bytes.startsWith('\xff\xd8')&&bytes.endsWith('\xff\xd9');
    const png=bytes.startsWith('\x89PNG\r\n\x1a\n')&&bytes.endsWith('\x00\x00\x00\x00IEND\xaeB\x60\x82');
    if(item.mime==='image/jpeg'?!jpeg:!png)throw Error('Invalid photo format');
    return {mime:item.mime as 'image/jpeg'|'image/png',data:item.data as string};
  });
}

export function action(value: any) {
  if (!value || !ACTIONS.includes(value.action) || !/^[a-f0-9-]{36}$/.test(value.request_id||'') ||
      !text(value.session_id,200) || !text(value.control_key,200) || !/^[a-f0-9-]{36}$/.test(value.device_id||'')) throw new Error('Invalid action');
  if(['prompt','message'].includes(value.action)&&(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>4000||/[\x00-\x08\x0b-\x1f\x7f]/.test(value.prompt)))throw new Error('Invalid instruction');
  const attachments=imageAttachments(value.attachments);
  if(attachments.length&&value.action!=='message')throw Error('Photos require a conversation message');
  return {action:value.action as Action,request_id:value.request_id as string,device_id:value.device_id as string,
    session_id:text(value.session_id,200),control_key:text(value.control_key,200),
    ...(['prompt','message'].includes(value.action)?{prompt:value.prompt as string}:{}),
    ...(attachments.length?{attachments}:{})};
}

export function mailboxRows(value:any) {
  if(!Array.isArray(value)||value.length>10)throw Error('Invalid mailbox');
  const statuses=['sending','queued','awaiting_reply','replied','delivery_unconfirmed','source_changed','not_delivered'];
  return value.map(row=>{
    if(!/^[a-f0-9-]{36}$/.test(row?.id||'')||!statuses.includes(row.status))throw Error('Invalid message');
    const attachments=Array.isArray(row.attachments)?row.attachments.slice(0,3).filter((v:any)=>/^[a-f0-9]{64}$/.test(v?.id||'')&&['image/jpeg','image/png'].includes(v?.mime)&&Number.isInteger(v?.bytes)&&v.bytes>0&&v.bytes<=524288).map((v:any)=>({id:v.id,name:text(v.name,80),mime:v.mime,bytes:v.bytes})):[];
    const a=row.activity,activity=row.status==='awaiting_reply'&&['responding','working','writing'].includes(a?.phase)&&number(a?.observed_at)?{phase:a.phase,observed_at:number(a.observed_at)}:null;
    return {id:row.id,text:text(row.text,4000),created:number(row.created)||0,status:row.status,attachments,activity,
      reply:text(row.reply,8000),reply_at:number(row.reply_at),truncated:row.truncated===true};
  });
}
