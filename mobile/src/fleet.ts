import {fresh,total,valid} from './metrics';
import type {Device,Flow,Quota,Session,WindowKey} from './types';

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

/** Fine bins summed across computers, aligned on the newest bin. Only when every computer sends
 *  bins of the same length; otherwise the caller falls back to the nested period totals. */
export function fleetFlow(devices:Device[],period:WindowKey):Flow|undefined{
 const flows=devices.map(d=>d.snapshot.flow?.[period]).filter((f):f is Flow=>!!f&&Array.isArray(f.bins)&&f.bins.length>0&&f.step>0);
 if(!flows.length||flows.length!==devices.length||flows.some(f=>f.step!==flows[0].step))return undefined;
 if(flows.length===1)return flows[0];
 const n=Math.max(...flows.map(f=>f.bins.length)),bins:Record<string,number>[]=Array.from({length:n},()=>({}));
 for(const f of flows)f.bins.forEach((bin,i)=>{const at=n-f.bins.length+i;for(const [k,v] of Object.entries(bin))if(valid(v))bins[at][k]=(bins[at][k]||0)+v;});
 return {step:flows[0].step,bins};
}

/** Each subscription account once, from the freshest report that carries it. */
export function fleetQuotas(devices:Device[]):Quota[]{
 const by=new Map<string,Quota>();
 for(const d of devices)for(const q of d.snapshot.account_quotas||[]){const old=by.get(q.id);if(!old||(old.stale&&!q.stale)||(old.stale===q.stale&&(q.updated||0)>(old.updated||0)))by.set(q.id,q);}
 return [...by.values()];
}

/** Weekly % needs at least one numeric estimate; an empty object is not an estimate. */
export const hasEstimate=(s:Session)=>!!s.weekly_estimate&&Object.keys(s.weekly_estimate).some(k=>valid(s.weekly_estimate?.[k as WindowKey]?.used_pp));

export const SECONDS:Record<WindowKey,number>={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
/** The session's average over the selected period in tokens per hour. */
export const hourly=(s:Session,period:WindowKey)=>{const v=total(s.windows?.[period]);return v===null?null:v/SECONDS[period]*3600;};
/** 158M, 7.5M, 0. Unknown stays a dash, never zero. */
export function short(n:number|null|undefined){if(!valid(n))return '—';if(n<.5)return '0';const [d,u]=n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];const x=n/d;return (x>=10?String(Math.round(x)):String(Number(x.toFixed(1))))+u;}
