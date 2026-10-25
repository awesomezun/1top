export const ACTIONS = ['focus', 'pause', 'resume', 'terminate', 'prompt'] as const;
export type Action = typeof ACTIONS[number];
export interface AgentSession {
  id: string; control_key?: string; kind: string; app: string; terminal: string;
  project: string; title: string; model: string; status: string;
  tokens: number[] | null; rate: number | null; windows: Record<string, number[] | null>;
  cpu: number | null; rss: number | null; capabilities: Action[];
  context_usage?: {basis:'last_request_input';input_tokens:number;capacity:number|null;parts:number[]|null;observed_at:number;model:string}|null;
}
export interface AccountQuota {
  id:string;kind:string;account_label:string;plan:string;updated:number;stale:boolean;note:string;
  windows:Array<{label:string;pct:number|null;reset:number}>;
}
export interface DeviceSnapshot {
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
      capabilities:Array.isArray(s.capabilities)?ACTIONS.filter(a=>s.capabilities.includes(a)):[]
    };
  });
  if (new Set(sessions.map(s=>s.id)).size!==sessions.length) throw new Error('Duplicate session identity');
  return {
    updated:number(value.updated)||0,recording_started:number(value.recording_started)||0,
    sessions,version:text(value.version,30),
    account_quotas:Array.isArray(value.account_quotas)?value.account_quotas.slice(0,24).map((q:any)=>({
      id:text(q.id,100),kind:text(q.kind,40),account_label:text(q.kind,40)+' · '+text(q.id,100).slice(-6),
      plan:text(q.plan,40),updated:number(q.updated)||0,stale:q.stale!==false,note:text(q.note,180),
      windows:Array.isArray(q.windows)?q.windows.slice(0,8).map((w:any)=>({label:text(w.label,30),pct:number(w.pct,100),reset:number(w.reset)||0})):[]
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
export function action(value: any) {
  if (!value || !ACTIONS.includes(value.action) || !/^[a-f0-9-]{36}$/.test(value.request_id||'') ||
      !text(value.session_id,200) || !text(value.control_key,200) || !/^[a-f0-9-]{36}$/.test(value.device_id||'')) throw new Error('Invalid action');
  if(value.action==='prompt'&&(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>4000||/[\x00-\x08\x0b-\x1f\x7f]/.test(value.prompt)))throw new Error('Invalid instruction');
  return {action:value.action as Action,request_id:value.request_id as string,device_id:value.device_id as string,
    session_id:text(value.session_id,200),control_key:text(value.control_key,200),
    ...(value.action==='prompt'?{prompt:value.prompt as string}:{})};
}
