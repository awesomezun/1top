/* Selected-period throughput. Use event totals, never grouped session rows. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const sum=v=>Array.isArray(v)&&v.length===4&&v.every(valid)?v.reduce((a,b)=>a+b,0):null;
 function measure(state,key,now=Date.now()/1000){
  const w=state?.period_usage?.windows?.find(p=>p.key===key);
  const local=sum(w?.tokens),rows=[],seen=new Set();
  const known=local!==null&&(local>0||state?.period_usage?.known_kinds?.length>0);
  let expected=1;
  if(known&&now-state.updated<=20&&!state.error)rows.push({tokens:local,seconds:key==='all'?Math.max(1,now-(state.history_started??state.started)):w.seconds,partial:w.partial});
  for(const device of state?.workspace_usage?.devices||[]){
   if(!device.id||seen.has(device.id))continue;seen.add(device.id);
   if(!device.online||now-device.received/1000>90)continue;
   expected++;
   const p=device.periods?.find(p=>p.key===key);
   if(p?.known&&valid(p.tokens)&&valid(p.seconds)&&p.seconds>0)rows.push(p);
  }
  const seconds=key==='all'?Math.max(0,...rows.map(r=>r.seconds)):w?.seconds;
  const tokens=rows.reduce((n,r)=>n+r.tokens,0);
  return {tokens:rows.length?tokens:null,rate:rows.length&&seconds>0?tokens/seconds:null,
   seconds,computers:rows.length,expected,partial:rows.length<expected||rows.some(r=>r.partial)};
 }
 function niceMax(value){if(!valid(value)||value===0)return 1;const power=10**Math.floor(Math.log10(value));return [1,2,5,10].map(n=>n*power).find(n=>n>=value)||10*power;}
 const api={measure,niceMax};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopSpeed=api;
})(typeof window==='undefined'?globalThis:window);
