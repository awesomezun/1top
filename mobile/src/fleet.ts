import {fresh,total,valid} from './metrics';
import type {Device,Flow,Quota,QuotaWindow,Session,WindowKey} from './types';

// One reading for every computer in view: the same rules as the 1top.si cockpit.
// Computers with a fresh report count; when none is fresh, the last reports stand in.
export function reporting(devices:Device[]):Device[]{const live=devices.filter(d=>fresh(d));return live.length?live:devices;}

/** Tokens in the period for each computer: its collector's period total, which keeps sessions that
 *  already ended, else the sum of its current sessions. Null when nothing is reported. */
export function periodTokens(devices:Device[],period:WindowKey):number|null{
 let sum=0,known=false;
 for(const d of devices){const reported=total(d.snapshot.periods?.find(p=>p.key===period)?.tokens);
  const own=reported??(()=>{const v=d.snapshot.sessions.map(s=>total(s.windows?.[period])).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;})();
  if(own!==null){sum+=own;known=true;}}
 return known?sum:null;
}

/** Fine bins summed across computers on real time, not position: bin i of a report covers
 *  start+i*step. Computers report at different moments, so the axis ends where every one of them
 *  has reported; a bin some computer did not cover stays unknown (null), never zero. Only when every
 *  computer sends the same step; otherwise the caller falls back to the nested period totals. */
export function fleetFlow(devices:Device[],period:WindowKey):Flow|undefined{
 const flows=devices.map(d=>d.snapshot.flow?.[period]).filter((f):f is Flow=>!!f&&Array.isArray(f.bins)&&f.bins.length>0&&f.step>0);
 if(!flows.length||flows.length!==devices.length||flows.some(f=>f.step!==flows[0].step))return undefined;
 if(flows.length===1)return flows[0];
 if(flows.some(f=>!valid(f.start)))return undefined;
 const step=flows[0].step,end=Math.min(...flows.map(f=>valid(f.end)?f.end!:f.start!+f.bins.length*step)),n=Math.max(...flows.map(f=>f.bins.length));
 const bins=Array.from({length:n},(_,k)=>{const from=end-(n-k)*step,by:Record<string,number>={};
  for(const f of flows){const j=Math.round((from-f.start!)/step),bin=j>=0&&j<f.bins.length?f.bins[j]:null;if(!bin)return null;
   for(const [key,v] of Object.entries(bin))if(valid(v))by[key]=(by[key]||0)+v;}
  return by;});
 return {step,start:end-n*step,end,bins};
}

/** Each subscription account once, from the freshest report that carries it. */
export function fleetQuotas(devices:Device[]):Quota[]{
 const by=new Map<string,Quota>();
 for(const d of devices)for(const q of d.snapshot.account_quotas||[]){const old=by.get(q.id);if(!old||(old.stale&&!q.stale)||(old.stale===q.stale&&(q.updated||0)>(old.updated||0)))by.set(q.id,q);}
 return [...by.values()];
}

// Older Claude and Codex windows carry only a label; Agy and GLM also report a period.
const PERIOD_LABELS:Record<string,string>={'주간':'weekly',Weekly:'weekly','5H':'5h','5시간':'5h','24H':'daily'};
export const periodOf=(w:QuotaWindow|null|undefined)=>w?.period&&w.period!=='unknown'?w.period:w?.key==='7d'||w?.key==='weekly'?'weekly':w?.key==='5h'?'5h':PERIOD_LABELS[w?.label||'']||'unknown';
export const isWeekly=(w:QuotaWindow|null|undefined)=>!!w&&w.scope!=='mcp'&&periodOf(w)==='weekly';
/** The one window a tile shows: model weekly, then 5 hours, then daily, then any other model window.
 *  An MCP or other budget stands in only when the account reports no model window. */
export function representative(q:Quota):QuotaWindow|null{
 const all=(q.windows||[]).filter(Boolean),model=all.filter(w=>w.scope!=='mcp'),list=model.length?model:all;
 for(const period of ['weekly','5h','daily']){const w=list.find(w=>periodOf(w)===period);if(w)return w;}
 return list[0]||null;
}
/** A verified account's weekly window is the only one a burn rate is measured against. */
export const burnAllowed=(q:Quota)=>q.identity_verified!==false&&isWeekly(representative(q));
/** Four tiles: every provider gets one before any gets a second, in the computers' order. */
export function pickTiles(rows:Quota[],n=4):Quota[]{
 const kinds=[...new Set(rows.map(q=>q.kind))],taken=new Set<Quota>();
 for(let round=0;round<rows.length&&taken.size<Math.min(n,rows.length);round++)for(const kind of kinds){const q=rows.filter(r=>r.kind===kind)[round];if(q&&taken.size<n)taken.add(q);}
 return rows.filter(q=>taken.has(q));
}

/** What tells same-tool accounts apart, as on the desktop dashboard: the name given in the desktop app,
 *  or 1, 2… by account label once a tool has two or more accounts. A tool's only account has none. */
export function accountTags(devices:Device[]):Record<string,string>{
 const by=new Map<string,Quota[]>(),out:Record<string,string>={};
 for(const q of fleetQuotas(devices))by.set(q.kind,[...(by.get(q.kind)||[]),q]);
 for(const list of by.values()){
  const sorted=[...list].sort((a,b)=>{const x=a.account_label.toLowerCase(),y=b.account_label.toLowerCase();return x<y?-1:x>y?1:0;});
  // Pools of one Agy installation carry their own names and are not numbered.
  const numbered=sorted.filter(q=>!q.pool);
  sorted.forEach(q=>{const alias=(q.alias||'').trim()||(q.pool||'').trim();if(alias)out[q.id]=alias;else if(numbered.length>=2)out[q.id]=String(numbered.indexOf(q)+1);});
 }
 return out;
}
/** The account a session's weekly estimate belongs to in the selected period. */
export const sessionAccount=(s:Session,period:WindowKey)=>s.weekly_estimate?.[period]?.account_id||s.weekly_account||null;

/** Weekly % needs at least one numeric estimate; an empty object is not an estimate. */
export const hasEstimate=(s:Session)=>!!s.weekly_estimate&&Object.keys(s.weekly_estimate).some(k=>valid(s.weekly_estimate?.[k as WindowKey]?.used_pp));

export const SECONDS:Record<WindowKey,number>={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
/** The session's average over the selected period in tokens per hour. */
export const hourly=(s:Session,period:WindowKey)=>{const v=total(s.windows?.[period]);return v===null?null:v/SECONDS[period]*3600;};
/** 158M, 7.5M, 0. Unknown stays a dash, never zero. */
export function short(n:number|null|undefined){if(!valid(n))return '—';if(n<.5)return '0';const [d,u]=n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];const x=n/d;return (x>=10?String(Math.round(x)):String(Number(x.toFixed(1))))+u;}
