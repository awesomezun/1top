export const ACTIONS = ['focus', 'pause', 'resume', 'terminate'] as const;
export type Action = typeof ACTIONS[number];
export interface AgentSession {
  id: string; control_key?: string; kind: string; app: string; terminal: string;
  project: string; title: string; model: string; status: string;
  tokens: number[] | null; rate: number | null; windows: Record<string, number[] | null>;
  cpu: number | null; rss: number | null; capabilities: Action[];
}
export interface DeviceSnapshot {
  updated: number; recording_started: number; sessions: AgentSession[]; applications: Array<{name:string;evidence:string}>;
  host: { cpu: number | null; used_memory: number; total_memory: number; cores: number };
  periods: Array<{key: string; label: string; tokens: number[]; partial: boolean; observed_seconds: number}>;
  version: string;
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
      capabilities:Array.isArray(s.capabilities)?ACTIONS.filter(a=>s.capabilities.includes(a)):[]
    };
  });
  if (new Set(sessions.map(s=>s.id)).size!==sessions.length) throw new Error('Duplicate session identity');
  return {
    updated:number(value.updated)||0,recording_started:number(value.recording_started)||0,
    sessions,version:text(value.version,30),
    applications:Array.isArray(value.applications)?value.applications.slice(0,60).map((a:any)=>({name:text(a.name,80),evidence:'application_process'})):[],
    host:{cpu:number(value.host?.cpu,100),used_memory:number(value.host?.used_memory)||0,
      total_memory:number(value.host?.total_memory)||0,cores:number(value.host?.cores,4096)||0},
    periods:Array.isArray(value.periods)?value.periods.filter((p:any)=>KEYS.includes(p.key)).slice(0,6).map((p:any)=>({key:p.key,label:text(p.label,30),tokens:vector(p.tokens)||[0,0,0,0],partial:p.partial===true,observed_seconds:number(p.observed_seconds,86400)||0})):[]
  };
}
export function action(value: any) {
  if (!value || !ACTIONS.includes(value.action) || !/^[a-f0-9-]{36}$/.test(value.request_id||'') ||
      !text(value.session_id,200) || !text(value.control_key,200) || !/^[a-f0-9-]{36}$/.test(value.device_id||'')) throw new Error('Invalid action');
  return {action:value.action as Action,request_id:value.request_id as string,device_id:value.device_id as string,
    session_id:text(value.session_id,200),control_key:text(value.control_key,200)};
}
