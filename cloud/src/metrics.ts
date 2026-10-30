// Shared numeric allowlists. Never copy arbitrary agent objects into relay storage.
export const num=(v:unknown,max=Number.MAX_SAFE_INTEGER):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;
export const str=(v:unknown,max=180):string=>typeof v==='string'?v.slice(0,max):'';
export const vec=(v:unknown):number[]|null=>Array.isArray(v)&&v.length===4&&v.every(n=>num(n)!==null)?v:null;
const rows=(v:any,n:number):any[]=>Array.isArray(v)?v.slice(0,n):[];
const pid=(v:unknown)=>Number.isInteger(v)&&num(v,2**32)!==null?v as number:null;
export function calibration(c:any){
 if(!c||num(c.pp_per_token,100)===null||c.pp_per_token<=0)return undefined;
 return {pp_per_token:c.pp_per_token as number,confidence:['early','limited'].includes(c.confidence)?c.confidence:'',from:num(c.from),to:num(c.to),valid_until:num(c.valid_until),
 source:c.source==='historical_provider_calibration'?c.source:'',seconds:num(c.seconds),used_pp:num(c.used_pp,1e6),tokens:num(c.tokens)};
}
export function sessionMetrics(s:any){return {
 effort:str(s.effort,40),effort_source:str(s.effort_source,80),effort_updated:num(s.effort_updated),
 last_usage:num(s.last_usage),request_input:num(s.request_input),context_size:num(s.context_size),terminal_note:str(s.terminal_note,200),
 pids:rows(s.pids,64).filter(n=>pid(n)!==null),
 usage:{last_minute:vec(s.usage?.last_minute),last_five_minutes:vec(s.usage?.last_five_minutes),output_rate:num(s.usage?.output_rate),
 history:rows(s.usage?.history,60).filter(p=>Array.isArray(p)&&p.length===2&&p.every(n=>num(n)!==null)).map(p=>[p[0],p[1]])}
};}
export function hostMetrics(h:any){return {
 network:{rx:num(h?.network?.rx),tx:num(h?.network?.tx),interfaces:rows(h?.network?.interfaces,32).map(n=>str(n,80))},
 disk:{total:num(h?.disk?.total),free:num(h?.disk?.free),percent:num(h?.disk?.percent,100),read:num(h?.disk?.read),write:num(h?.disk?.write)},
 swap:{used:num(h?.swap?.used),total:num(h?.swap?.total)},load:rows(h?.load,3).map(n=>num(n)),uptime:num(h?.uptime),
 battery:h?.battery?{percent:num(h.battery.percent,100),plugged:h.battery.plugged===true}:null,
 process_count:num(h?.process_count,1e6),unreadable_processes:num(h?.unreadable_processes,1e6),platform:str(h?.platform,40),os:str(h?.os,40)
};}
const process=(r:any)=>({pid:pid(r?.pid),ppid:pid(r?.ppid),name:str(r?.name,80).split(/[\\/]/).pop()||'',created:num(r?.created),cpu:num(r?.cpu,100000),rss:num(r?.rss)});
export function systemMetrics(s:any){return {
 sampler_ms:num(s?.sampler_ms),monitor:{pid:pid(s?.monitor?.pid),cpu:num(s?.monitor?.cpu,100000),rss:num(s?.monitor?.rss)},
 history:rows(s?.history,300).map(r=>({t:num(r?.t),cpu:num(r?.cpu,100),memory:num(r?.memory,100),rx:num(r?.rx),tx:num(r?.tx)})),
 top:rows(s?.top,15).map(process),shared:rows(s?.shared,30).map(r=>({...process(r),id:str(r?.id,80),count:num(r?.count,10000),pids:rows(r?.pids,64).filter(n=>pid(n)!==null)}))
};}
export function quota(q:any){return {kind:str(q?.kind,40),plan:str(q?.plan,40),updated:num(q?.updated)||0,stale:q?.stale!==false,note:str(q?.note,180),
 windows:rows(q?.windows,8).map(w=>({label:str(w?.label,30),pct:num(w?.pct,100),reset:num(w?.reset)||0,t:num(w?.t)}))};}
export function extras(v:any){return {
 system:systemMetrics(v.system),collection_ms:num(v.collection_ms),resume_prompt:str(v.resume_prompt,4000),
 actions:rows(v.actions,20).map(a=>({t:num(a?.t),action:str(a?.action,30),sid:str(a?.sid,200),terminal:str(a?.terminal,120),project:str(a?.project,100),message:str(a?.message,400)})),
 quotas:rows(v.quotas,24).map(quota),orca_terminals:num(v.orca_terminals,10000),
 process_counts:Object.fromEntries(['Claude','Codex','GLM','Aside','Antigravity','Gemini','OpenCode','Unknown'].flatMap(k=>num(v.process_counts?.[k],10000)===null?[]:[[k,v.process_counts[k]]]))
};}
