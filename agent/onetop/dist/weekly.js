/* Provider percentages and token-share estimates are separate measurements. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const number=n=>!valid(n)?'—':n>0&&n<.01?'<0.01':Number(n.toFixed(2)).toLocaleString('ko-KR');
 const percent=n=>number(n)+(valid(n)?'%':'');
 const estimate=e=>valid(e?.used_pp)?'≈'+percent(e.used_pp):'측정 중';
 const weekly=q=>q?.windows?.find(w=>w.label==='주간');
 const explanation='선택 기간의 보고 토큰 × (기준 구간에서 소진한 주간 한도 % ÷ 같은 구간의 관측 토큰)입니다. 현재 계정 기준의 참고용 환산이며 실제 차감량이 아닙니다. 모델·캐시 구성과 다른 기기의 사용에 따라 달라집니다. 과거 미귀속 토큰의 실제 결제 계정을 복원하지 않습니다.';
 const pending=(account,quota,tokens)=>!account?'계정 연결 필요':quota?.stale?'한도 조회 대기':tokens===0?'이 기간의 보고 토큰 없음':'환산 기준 수집 중';
 const duration=s=>s<60?'1분 미만':s<3600?Math.floor(s/60)+'분':Math.floor(s/3600)+'시간 '+Math.floor(s%3600/60)+'분';
 const scope=e=>e?.basis==='calibrated_token_equivalent'?'환산 추정'+(e.calibration?.confidence==='early'?' · 초기 기준':'')+(e.partial?' · 일부 토큰':''):'관측 구간 추정';
 const basis=e=>e?.calibration?`${duration(e.calibration.seconds)} 기준 · ${number(e.calibration.used_pp)}% / ${Math.round(e.calibration.tokens).toLocaleString('ko-KR')} tokens${e.calibration.source==='historical_provider_calibration'&&valid(e.calibration.to)?' · 저장된 제공자 보고 · '+new Date(e.calibration.to*1000).toLocaleString('ko-KR'):''}`:'';
 // Partial periods must use the observed duration, never the selected window length.
 const accountBurn=(period,quota)=>{
  if(!quota||quota.stale!==false||!valid(period?.used_pp)||!valid(period?.observed_seconds)||period.observed_seconds<120)return null;
  const rate=period.used_pp/period.observed_seconds*3600;
  return valid(rate)?rate:null;
 };
 const historicalCalibration=(estimate,quota,now=Date.now()/1000)=>{
  const c=estimate?.calibration,reset=weekly(quota)?.reset;
  return [true,false].includes(quota?.stale)&&quota.kind==='Claude'&&c?.kind==='Claude'&&c.source==='historical_provider_calibration'&&['claude_statusline','historical_provider_report'].includes(c.report_source)&&valid(now)&&valid(c.to)&&c.to>0&&c.to<=now&&valid(c.reset)&&c.reset>now&&valid(reset)&&Math.abs(reset-c.reset)<=60&&valid(c.valid_until)&&c.valid_until>now&&c.valid_until<=Math.min(c.reset,c.to+86400);
 };
 const sessionBurn=(estimate,tokensPerSecond,quota,now=Date.now()/1000)=>{
  // A measured zero token rate is zero burn even before a positive quota step.
  if(tokensPerSecond===0)return 0;
  const c=estimate?.calibration;
  if(!quota||(c?.source==='historical_provider_calibration'?!historicalCalibration(estimate,quota,now):quota.stale!==false)||estimate?.account_id!==quota.id||estimate?.basis!=='calibrated_token_equivalent'||!valid(tokensPerSecond)||!valid(c?.tokens)||c.tokens<=0||!valid(c?.used_pp)||c.used_pp<=0||!valid(c?.seconds)||c.seconds<120)return null;
  const rate=tokensPerSecond*(c.used_pp/c.tokens)*3600;
  return valid(rate)?rate:null;
 };
 const burn=value=>valid(value)?number(value)+'%/시간':'—';
 // Connect actual reported usage as one ordinary line, including reset drops.
 // Keep one known point before the boundary for clipping, without adding values.
 const quotaTrend=(account,start,end)=>{
  const result={segments:[],gaps:[],min:null,max:null,last:null,hasData:false};
  if(!valid(start)||!valid(end)||end<=start)return result;
  const source=Array.isArray(account?.usage_points)?account.usage_points:account?.history;
  const points=(Array.isArray(source)?source:[]).filter(p=>Array.isArray(p)&&valid(p[0])&&p[0]<=end&&valid(p[1])&&p[1]<=100).slice().sort((a,b)=>a[0]-b[0]);
  const first=points.findIndex(p=>p[0]>=start);
  if(first<0)return result;
  const segment=[];
  for(const [t,value] of points.slice(Math.max(0,first-1))){
   if(segment.length&&t<=segment[segment.length-1].t)continue;
   segment.push({t,value});
  }
  result.segments=[segment];result.hasData=true;result.last=segment[segment.length-1];
  result.min=Math.min(...segment.map(p=>p.value));result.max=Math.max(...segment.map(p=>p.value));
  return result;
 };
 // Cumulative increase within the selection, not the account's absolute allowance.
 // A boundary-crossing interval is omitted: quota changes cannot be apportioned
 // accurately by elapsed time. Unknown gaps break the line, retaining known totals.
 const increaseTrend=(account,start,end)=>{
  const result={segments:[],max:0,increase:0,hasData:false,observedSeconds:0,partial:true};
  if(!valid(start)||!valid(end)||end<=start)return result;
  let intervals;
  const completeIntervals=Array.isArray(account?.increase_intervals);
  if(completeIntervals){
   // Match the period total while keeping uncertain timing visibly disconnected.
   intervals=account.increase_intervals.filter(Array.isArray).map(row=>row.slice(0,4));
  }else if(Array.isArray(account?.flow)){
   // An explicitly empty flow is authoritative; do not revive rejected history.
   intervals=account.flow.filter(Array.isArray).map(row=>row.slice(0,3));
  }else{
   const points=(Array.isArray(account?.history)?account.history:[])
    .filter(p=>Array.isArray(p)&&valid(p[0])).slice().sort((a,b)=>a[0]-b[0]);
   intervals=[];
   for(let i=1;i<points.length;i++){
    const before=points[i-1],after=points[i];
    if(!valid(before[1])||before[1]>100||!valid(after[1])||after[1]>100)continue;
    intervals.push([before[0],after[0],after[1]-before[1]]);
   }
  }
  intervals=intervals.filter(([a,b,d])=>valid(a)&&valid(b)&&valid(d)&&b>a&&(completeIntervals||b-a<=300)&&a>=start&&b<=end)
   .sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let lastEnd=null,uncertainTiming=false;
  for(const [a,b,delta,uncertain] of intervals){
   if(lastEnd!==null&&a<lastEnd)continue; // Do not count overlapping reports twice.
   const next=result.increase+delta;
   if(!valid(next))continue;
   if(completeIntervals&&(b-a>300||uncertain!==false)){
    result.segments.push([{t:a,value:result.increase}],[{t:b,value:next}]);
    uncertainTiming=true;
   }else{
    if(a!==lastEnd)result.segments.push([{t:a,value:result.increase}]);
    result.segments[result.segments.length-1].push({t:b,value:next});
   }
   result.increase=next;result.observedSeconds+=b-a;lastEnd=b;
  }
  result.hasData=result.segments.length>0;
  result.max=result.increase;
  result.partial=!result.hasData||uncertainTiming||result.observedSeconds<end-start-1e-6;
  return result;
 };
 const api={valid,number,percent,estimate,weekly,pending,explanation,duration,scope,basis,accountBurn,historicalCalibration,sessionBurn,burn,increaseTrend,quotaTrend};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopWeekly=api;
})(typeof globalThis!=='undefined'?globalThis:this);
