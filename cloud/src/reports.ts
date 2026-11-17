// report-contract v1.2.0: reconstruct every nested field before persistence.
export const MAX_REPORT_BYTES=16*1024;
const MAX=Number.MAX_SAFE_INTEGER;
const object=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function need(ok:boolean){if(!ok)throw Error('Invalid report');}
function n(v:unknown,max=MAX):number{need(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max);return v as number;}
function optional(v:unknown,max=MAX){return v===null?null:n(v,max);}
function str(v:unknown,max:number):string{need(typeof v==='string'&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v));return v as string;}
function id(v:unknown,max=100){const s=str(v,max);need(/^[A-Za-z0-9_.:-]+$/.test(s));return s;}
function label(v:unknown,max=80){const s=str(v,max);return /[@\\/]/.test(s)?'':s;}
function rows(v:unknown,max:number):any[]{need(Array.isArray(v)&&v.length<=max);return v as any[];}
function date(v:unknown,month=false){const s=str(v,10);need(month?/^\d{4}-(0[1-9]|1[0-2])$/.test(s):/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s));if(!month)need(new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s);return s;}
const dollars=(v:unknown)=>n(v,1e12),ratio=(v:unknown)=>optional(v,1e12),stamp=(v:unknown)=>n(v,4102444800);
function value(v:any){
 need(object(v)&&v.currency==='USD'&&object(v.unpriced));
 const start=stamp(v.start),end=stamp(v.end);need(end>=start);
 return {month:date(v.month,true),start,end,currency:'USD' as const,prices_as_of:date(v.prices_as_of),
  plans:rows(v.plans,24).map(p=>{need(object(p)&&['detected','user','unknown'].includes(p.source));const price=optional(p.price,10000);need(p.source!=='unknown'||price===null);return {account_id:id(p.account_id),kind:id(p.kind,40),plan:id(p.plan,40),label:label(p.label),price,source:p.source as 'detected'|'user'|'unknown'};}),
  plan_total:dollars(v.plan_total),api_value:dollars(v.api_value),ratio:ratio(v.ratio),api_billed:dollars(v.api_billed),
  unpriced:{tokens:n(v.unpriced.tokens),models:rows(v.unpriced.models,128).map(m=>label(m,160)||'unknown')},
  ...(v.excluded===undefined?{}:{excluded:{api_value:dollars(v.excluded?.api_value),kinds:rows(v.excluded?.kinds,12).map(k=>id(k,40))}}),
  by_kind:rows(v.by_kind,12).map(k=>({kind:id(k?.kind,40),api_value:dollars(k?.api_value),plan_total:dollars(k?.plan_total),ratio:ratio(k?.ratio)})),
  by_model:rows(v.by_model,24).map(m=>{const tokens=rows(m?.tokens,4);need(tokens.length===4);return {model:label(m.model,160)||'unknown',kind:id(m.kind,40),api_value:dollars(m.api_value),tokens:tokens.map(t=>n(t))};}),
  months:rows(v.months,6).map(m=>({month:date(m?.month,true),api_value:dollars(m?.api_value),plan_total:dollars(m?.plan_total)}))};
}
function weekly(w:any){
 need(object(w)&&object(w.previous)&&typeof w.previous.partial==='boolean');
 const start=stamp(w.start),end=stamp(w.end);need(end>start&&end-start<=8*86400);
 const wait=w.longest_wait;need(wait===null||object(wait));
 return {start,end,since:stamp(w.since),working_s:n(w.working_s),waiting_s:n(w.waiting_s),
  longest_wait:wait===null?null:{session_id:id(wait.session_id,200),label:label(wait.label),kind:id(wait.kind,40),seconds:n(wait.seconds)},
  previous:{working_s:n(w.previous.working_s),waiting_s:n(w.previous.waiting_s),partial:w.previous.partial},
  days:rows(w.days,7).map(d=>({date:date(d?.date),working_s:n(d?.working_s),waiting_s:n(d?.waiting_s)}))};
}
export function reports(raw:any){
 if(raw==null)return undefined;
 try{
  need(object(raw)&&raw.version===1&&new TextEncoder().encode(JSON.stringify(raw)).length<=MAX_REPORT_BYTES);
  return {version:1 as const,as_of:stamp(raw.as_of),...(raw.value==null?{}:{value:value(raw.value)}),...(raw.weekly==null?{}:{weekly:weekly(raw.weekly)})};
 }catch{return undefined;} // Invalid optional reports do not disconnect otherwise healthy collectors.
}
