/* The cluster view: the landing hero's instrument cluster, read from the collector's own state.
   Speedometer (the main dial) = weekly-limit burn in %/h of the session or account picked, else of the
   fastest account; tachometer = the dashboard's token speed (the selected period's average); gear = the
   time window; fuel = each account's weekly limit left; warning lights = what needs a look; odometer =
   the period's tokens; trip = tokens since a reset; temperature = the busiest computer's load.
   The window in the middle shows one of three pages: the running sessions, the token flow or the weekly limits. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const KINDS=['Claude','Codex','GLM','Antigravity','Aside'],rank=k=>KINDS.includes(k)?KINDS.indexOf(k):KINDS.length;
 // Marks on a 1-2-2.5-5 step so a dial reads four or five numbers: 200 → 50, 100 → 25, 50 → 10, 2 → 0.5.
 function marks(max){
  const p=10**Math.floor(Math.log10(max)),major=[5,2.5,2,1,.5,.25,.2,.1].map(m=>m*p).find(s=>max/s>=4-1e-9)||p/10;
  return {max,major,minor:major/5};
 }
 const local=label=>{const s=String(label||'');return s.includes('@')?s.split('@')[0]:s;};
 const HOUR=3600,STALL=15*60,CONTEXT=.9;
 // Range: at the account's current burn, when its weekly limit runs out and whether that comes before
 // the reset. idle when it is not being used; null when either number is unknown.
 function range(a,now){
  if(!a||a.left===null||!valid(a.burn))return null;
  if(a.burn===0)return {state:'idle',at:null,early:false};
  const at=now+a.left/a.burn*HOUR;
  return a.reset&&at>=a.reset?{state:'enough',at,early:false}:{state:'empty',at,early:!!a.reset};
 }
 // Cruise: the steady %/h that spends what is left of the weekly limit exactly by its reset.
 const cruise=(a,now)=>a&&a.left!==null&&a.reset&&a.reset>now?a.left/((a.reset-now)/HOUR):null;
 // A session's context is nearly full at 90% of its capacity; a working session is suspected stalled
 // when it has reported no usage for 15 minutes (an unreported last use, 0, never counts).
 const contextFull=s=>{const c=s?.context_usage;return valid(c?.input_tokens)&&valid(c?.capacity)&&c.capacity>0&&c.input_tokens/c.capacity>=CONTEXT;};
 const stalled=(s,state,now)=>state==='working'&&valid(s?.last_usage)&&s.last_usage>0&&now-s.last_usage>STALL;
 // Trip: tokens since start from the token events (minute totals over the last day, or the chosen longer
 // range), their average per hour, and each account's weekly percent used since start. Before the events
 // begin the tokens are outside the record.
 function trip(state,start,now,W){
  if(!valid(start)||start>now)return null;
  const from=state?.chart_range?.start??((valid(state?.updated)?state.updated:now)-86400),inRange=start>=from;
  const tokens=inRange?(state?.events||[]).reduce((n,e)=>{const v=e.n??((e.fresh??0)+(e.cached??0)+(e.written??0)+(e.output??0));return e.t>=start&&e.t<=now&&valid(v)?n+v:n;},0):null;
  const hours=(now-start)/HOUR;
  const accounts=(state?.weekly_usage?.accounts||[]).map(a=>{const r=W.increaseTrend(a,start,now);return {id:a.id,used:r.hasData&&valid(r.increase)?r.increase:null};});
  return {start,tokens,rate:tokens===null||hours<=0?null:tokens/hours,inRange,accounts};
 }
 // Engine temperature: each computer's load is the higher of its CPU and memory use; the gauge reads the hottest.
 function heat(state){
  const list=state?.system?.computers?.length?state.system.computers:state?.system?.host?[{name:null,cpu:state.system.host.cpu,memory:state.system.host.memory?.percent}]:[];
  const computers=list.map(c=>({name:c.name||null,cpu:valid(c.cpu)?c.cpu:null,memory:valid(c.memory)?c.memory:null})).filter(c=>c.cpu!==null||c.memory!==null)
   .map(c=>({...c,load:Math.min(100,Math.max(c.cpu??0,c.memory??0))}));
  const hottest=computers.slice().sort((a,b)=>b.load-a.load)[0]||null;
  return {value:hottest?hottest.load:null,hottest,computers};
 }
 // The last minute's tokens per hour, in all and by tool, from each top-level session's sliding last
 // minute (a lead's figures include its subagents). null when no session reports one.
 function instant(state){
  const rows=state?.root_sessions?.length?state.root_sessions:(state?.sessions||[]).filter(s=>!s.is_subagent),by={};let all=null;
  for(const s of rows){const v=s.usage?.last_minute;if(!Array.isArray(v))continue;const n=v.reduce((a,b)=>a+(valid(b)?b:0),0)*HOUR/(s.usage.window_seconds||60);
   all=(all||0)+n;by[s.kind]=(by[s.kind]||0)+n;}
  return {rate:all,by};
 }
 // The tachometer reads the same totals as the dashboard's speed panel (OneTopSpeed.measure).
 // pick is {type:'session'|'account',id} or null.
 function readings(state,o){
  const W=o.weekly,now=o.now??Date.now()/1000,w=state?.period_usage?.windows?.find(x=>x.key===o.period);
  const m=o.speed.measure(state,o.period,now),rate=m.rate===null?null:m.rate*3600;
  // The dashboard hands over its own dial scale, which holds a while before shrinking; alone it is computed.
  // Between readings the window's total runs on at the last minute's rate; the next reading sets it true.
  const live=instant(state),climb=valid(live.rate)?live.rate/HOUR:0;
  const tach={rate,max:o.tachMax||o.speed.scaleMax(rate,w?.seconds),tokens:m.tokens,computers:m.computers,expected:m.expected,instant:live.rate,byKind:live.by,climb};
  const accounts=(state?.account_quotas||[]).map(q=>{
   const p=state.weekly_usage?.accounts?.find(a=>a.id===q.id)?.periods?.[o.period],week=W.weekly(q),pct=valid(week?.pct)?week.pct:null;
   return {id:q.id,kind:q.kind,label:q.account_label,plan:q.plan||null,alias:q.alias||null,who:local(q.account_label),pct,left:pct===null?null:Math.max(0,100-pct),
    reset:valid(week?.reset)?week.reset:null,current:pct!==null&&q.stale===false,reconnect:!!o.reconnect?.has(q.status),burn:W.accountBurn(p,q),
    added:valid(p?.used_pp)?p.used_pp:null};
  });
  for(const a of accounts)a.range=range(a,now);
  const tokens=s=>{const v=s.usage?.windows?.[o.period];return Array.isArray(v)?v.reduce((a,b)=>a+(valid(b)?b:0),0):0};
  const burn=(s,period=o.period)=>{
   let e=s.usage?.weekly_estimate?.[period];const id=e?.account_id||s.usage?.weekly_account,q=state.account_quotas?.find(q=>q.id===id);
   if(!e&&q){const c=state.weekly_usage?.accounts?.find(a=>a.id===q.id)?.calibration;if(c)e={account_id:q.id,basis:'calibrated_token_equivalent',calibration:c};}
   return s.tokens==null?null:W.sessionBurn(e,s.usage?.rate,q,now);
  };
  const list=(o.sessions||[]).map(s=>({s,state:o.display(s),tokens:tokens(s)}));
  const row=r=>({id:r.s.id,kind:r.s.kind,state:r.state,tokens:r.tokens,estimate:valid(r.s.usage?.weekly_estimate?.[o.period]?.used_pp)?r.s.usage.weekly_estimate[o.period].used_pp:null,
   burn:burn(r.s),account:r.s.usage?.weekly_estimate?.[o.period]?.account_id||r.s.usage?.weekly_account||null,session:r.s});
  // Working sessions first, then the rest that used tokens in the period, each by tokens; six fit the window.
  const order=list.filter(r=>r.state==='working'||r.tokens>0).sort((a,b)=>(b.state==='working')-(a.state==='working')||b.tokens-a.tokens);
  // A picked session (one a warning light pointed at, say) stays in the window in place of the last row.
  const held=o.pick?.type==='session'?list.find(x=>x.s.id===o.pick.id):null,shown=order.slice(0,6);
  if(held&&!shown.includes(held))shown.splice(Math.min(5,shown.length),1,held);
  const rows=shown.map(row);
  // The speedometer reads one subject and never adds rates across accounts: the session or account picked,
  // else the account burning fastest. A pick with no rate yet reads as not measured rather than falling back.
  let subject=null;const pick=o.pick;
  // Its second, thinner needle reads the same subject over the last ten minutes.
  const RECENT='10m',recentOf=a=>{const q=state.account_quotas?.find(q=>q.id===a.id),p=state.weekly_usage?.accounts?.find(x=>x.id===a.id)?.periods?.[RECENT];return p?W.accountBurn(p,q):null;};
  if(pick?.type==='session'){const l=list.find(x=>x.s.id===pick.id);if(l){const r=row(l);subject={type:'session',id:r.id,kind:r.kind,value:r.burn,account:r.account,session:r.session,recent:burn(l.s,RECENT)};}}
  else if(pick?.type==='account'){const a=accounts.find(x=>x.id===pick.id);if(a)subject={type:'account',id:a.id,kind:a.kind,value:a.burn,account:a.id,recent:recentOf(a)};}
  const picked=!!subject;
  if(!subject){const a=accounts.filter(a=>valid(a.burn)).sort((a,b)=>b.burn-a.burn)[0];if(a)subject={type:'account',id:a.id,kind:a.kind,value:a.burn,account:a.id,recent:recentOf(a)};}
  const value=valid(subject?.value)?subject.value:null,target=cruise(accounts.find(a=>a.id===subject?.account),now),recent=o.period!==RECENT&&valid(subject?.recent)?subject.recent:null;
  const speed={value,recent,cruise:target,max:Math.max(2,o.speed.niceMax(Math.max(value||0,(target||0)*1.6,recent||0))),subject,picked,account:subject?.type==='account'?subject.id:null,session:subject?.type==='session'?subject.id:null};
  // Tell-tales light only for what is there: tools with working sessions, sessions waiting for a look,
  // accounts to sign in again, and whether the readings are live.
  const working={};for(const r of list)if(r.state==='working')working[r.s.kind]=(working[r.s.kind]||0)+1;
  const tells={kinds:Object.keys(working).sort((a,b)=>rank(a)-rank(b)||(a<b?-1:1)).map(k=>({kind:k,working:working[k]})),waiting:list.filter(r=>r.state==='waiting').map(r=>r.s.id),
   reconnect:accounts.filter(a=>a.reconnect).map(a=>a.id),fresh:!!state&&!state.error&&valid(state.updated)&&now-state.updated<=20,
   empty:accounts.filter(a=>a.range?.early).map(a=>a.id),context:list.filter(r=>contextFull(r.s)).map(r=>r.s.id),stalled:list.filter(r=>stalled(r.s,r.state,now)).map(r=>r.s.id)};
  return {period:o.period,tach,speed,accounts,sessions:rows,working:list.filter(r=>r.state==='working').length,tells,heat:heat(state),trip:trip(state,o.trip,now,W)};
 }

 // Drawing. The skeleton is built once; each refresh moves needles and updates rows in place, so needles
 // spring between readings, figures count to their new values and the page's translation keeps up.
 // Between readings a one-second tick runs the odometer, the trip and the flow chart's current bar on at
 // the last minute's rate, until the next reading sets them true. With less motion asked for, or a held
 // clock, nothing moves between readings.
 const C=170,ang=f=>(135+270*f)*Math.PI/180,pt=(f,r)=>[C+r*Math.cos(ang(f)),C+r*Math.sin(ang(f))],n1=v=>v.toFixed(1);
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ring=(cls,r)=>`<circle class="${cls}" cx="170" cy="170" r="${r}" pathLength="360" stroke-dasharray="0 360" transform="rotate(135 170 170)"/>`;
 const dial=(cls,name)=>`<div class="cl-dial ${cls}" role="img"><svg viewBox="0 0 340 340" aria-hidden="true"><circle class="cl-rim" cx="170" cy="170" r="160"/>
  <circle class="cl-track" cx="170" cy="170" r="147" pathLength="360" stroke-dasharray="270 360" transform="rotate(135 170 170)"/>${ring('cl-arc',147)}
  <g class="cl-band">${ring('ok',155)}${ring('hi',155)}${ring('over',155)}</g><g class="cl-ticks"></g><g class="cl-nums"></g>
  <g class="cl-needle2"><path d="M170 168.9 L292 169.6 L292 170.4 L170 171.1 Z"/><circle cx="292" cy="170" r="3"/></g>
  <g class="cl-needle"><path d="M158 166.4 L301 169.3 L301 170.7 L158 173.6 Z"/></g><circle class="cl-hub" cx="170" cy="170" r="13"/><circle class="cl-hub2" cx="170" cy="170" r="5"/></svg>
  <div class="cl-name">${name}</div><div class="cl-read"><b>—</b><small></small><em class="cl-aux"></em></div><div class="cl-sub"></div></div>`;
 function scaleMarkup(el,g,fmt){
  if(el.dataset.max===String(g.max))return;el.dataset.max=String(g.max);
  let ticks='',nums='';const n=Math.round(g.max/g.minor);
  for(let i=0;i<=n;i++){const v=i*g.minor,f=v/g.max,major=Math.abs(v/g.major-Math.round(v/g.major))<1e-6,[x1,y1]=pt(f,major?122:131),[x2,y2]=pt(f,141);
   ticks+=`<line class="${major?'mj':'mn'}" data-f="${f.toFixed(4)}" x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}"/>`;
   if(major){const [x,y]=pt(f,103);nums+=`<text x="${n1(x)}" y="${n1(y+6)}" text-anchor="middle">${fmt(v)}</text>`;}}
  el.querySelector('.cl-ticks').innerHTML=ticks;el.querySelector('.cl-nums').innerHTML=nums;
 }
 const turn=f=>`rotate(${(135+270*Math.max(0,Math.min(1,f||0))).toFixed(2)}deg)`;
 // The needle and the lit arc for a fraction of full scale; lit (0..1) is how far the ignition sweep has run.
 function needle(el,f,lit=1){
  f=Math.max(0,Math.min(1,f||0));el.querySelector('.cl-needle').style.transform=turn(f);
  el.querySelector('.cl-arc').setAttribute('stroke-dasharray',`${(270*f).toFixed(2)} 360`);
  const ticks=el.querySelectorAll('.cl-ticks line'),n=ticks.length-1;
  ticks.forEach((t,i)=>{t.classList.toggle('on',Number(t.dataset.f)<=f+1e-4);t.style.opacity=lit>=1?'':String(Math.max(0,Math.min(1,(lit*(n+4)-i)/4)));});
 }
 // The second needle: the last minute on the tachometer, the last ten minutes on the speedometer.
 const needle2=(el,f)=>{const g=el.querySelector('.cl-needle2');g.classList.toggle('off',f===null);if(f!==null)g.style.transform=turn(f);};
 const scaleNumber=v=>String(+v.toFixed(v<1?2:1));
 const reading=v=>!valid(v)?'—':v>=100?String(Math.round(v)):v>=10?v.toFixed(1):v.toFixed(2);
 const digits=Array.from({length:10},(_,k)=>`${k&&(10-k)%3===0?'<em>,</em>':''}<i><span>${[0,1,2,3,4,5,6,7,8,9].map(d=>`<b>${d}</b>`).join('')}</span></i>`).join('');
 const calm=()=>!!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 // Figures count from what they showed to the new value instead of jumping.
 function count(el,value,format){
  if(!el)return;const to=valid(value)?value:null,from=el.dataset.v===undefined||el.dataset.v===''?null:Number(el.dataset.v);
  el.dataset.v=to===null?'':String(to);cancelAnimationFrame(Number(el.dataset.raf||0));
  if(to===null||from===null||from===to||calm()){el.textContent=to===null?'—':format(to);return;}
  const t0=performance.now(),D=700,step=t=>{const p=Math.min(1,(t-t0)/D),e=1-(1-p)**3;el.textContent=format(from+(to-from)*e);if(p<1)el.dataset.raf=String(requestAnimationFrame(step));};
  el.dataset.raf=String(requestAnimationFrame(step));
 }
 // Gears: the six presets, then a custom gear that opens the dashboard's duration slider and, once a
 // longer or in-between window is chosen, shows its name (2일, 1주, 전체 기록).
 const GEARS=['10m','30m','1h','5h','12h','24h'];
 // The window's pages; the last one shown is remembered in this browser.
 const MODES=[['sessions','실행 중인 세션'],['flow','토큰 흐름'],['weekly','주간 한도']],STORE='onetop.cluster.v1';
 // Warning lights, drawn as a car's are: a light comes on for what is there; hovering names it and counts,
 // pressing goes to the session or account it is about.
 const ICON={
  waiting:'<path d="M12 3.6 21.6 20H2.4Z"/><path d="M12 9.6v5"/><circle cx="12" cy="17.2" r=".6"/>',
  reconnect:'<path d="M10 14.2 8.1 16.1a3.3 3.3 0 0 1-4.7-4.7L5.3 9.5"/><path d="M14 9.8l1.9-1.9a3.3 3.3 0 0 1 4.7 4.7l-1.9 1.9"/><path d="M8.2 3.6v2.6M3.6 8.2h2.6M15.8 20.4v-2.6M20.4 15.8h-2.6"/>',
  empty:'<path d="M5 20.4V5.6A1.6 1.6 0 0 1 6.6 4h6.2a1.6 1.6 0 0 1 1.6 1.6v14.8M3.4 20.4h12.6M7.4 8.2h5"/><path d="M14.4 10.6h1.4a1.4 1.4 0 0 1 1.4 1.4v4.2a1.5 1.5 0 0 0 3 0V8.6L18 6.4"/>',
  context:'<path d="M8 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20H8M16 4h1.8A2.2 2.2 0 0 1 20 6.2v11.6a2.2 2.2 0 0 1-2.2 2.2H16"/><path d="M8.4 8.6h7.2M8.4 12h7.2M8.4 15.4h7.2"/>',
  stalled:'<path d="M6.6 3.6h10.8M6.6 20.4h10.8"/><path d="M8 3.6c0 4.6 8 4.4 8 8.4s-8 3.8-8 8.4M16 3.6c0 4.6-8 4.4-8 8.4s8 3.8 8 8.4"/>',
  live:'<path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/><circle cx="12" cy="12" r="1.5"/>'};
 const LAMPS=[['waiting','확인 필요'],['reconnect','재연결 필요'],['empty','한도 바닥 예상'],['context','컨텍스트 거의 참'],['stalled','멈춤 의심'],['live','수집 지연']];
 const LAMPS_MARKUP=`<div class="cl-lamps" role="group" aria-label="경고등">${LAMPS.map(([k,label])=>`<button type="button" class="cl-lamp ${k}" data-cluster-alert="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span class="cl-tip" role="tooltip"><span class="cl-lamp-name">${label}</span> <b></b></span></button>`).join('')}</div>`;
 const ODO_MARKUP=`<div class="cl-odo"><small><span>토큰</span> · <span class="cl-odo-span"></span></small><div role="img">${digits}</div>
     <div class="cl-trip"><div class="cl-trip-h"><b>작업 트립</b><span class="cl-trip-since"></span><button type="button" data-cluster-trip>리셋</button></div><div class="cl-trip-v"><b class="cl-trip-n"></b> <span>토큰</span> · <span>평균</span> <b class="cl-trip-r"></b> <span>tokens/시간</span><span class="cl-trip-out" hidden>기록 범위 밖</span></div><div class="cl-trip-a"></div></div></div>`;
 const stored=()=>{try{return JSON.parse(root.localStorage?.getItem(STORE)||'{}')||{};}catch{return {};}};
 const save=patch=>{try{root.localStorage?.setItem(STORE,JSON.stringify({...stored(),...patch}));}catch{}};
 const now=()=>Date.now()/1000;
 let mounted=null,pick=null,mode=null,rangeOpen=false,rangeFrom=null,last=null,igniting=false,ignition=false,tripStart=null,ticker=null;
 // A warning light points at what it is about: each press picks the next session (or account) it lights for,
 // on the page that shows it.
 function nextPick(r,kind,current){
  const ids=r?.tells[kind]||[];if(!Array.isArray(ids)||!ids.length)return null;
  const type=kind==='empty'||kind==='reconnect'?'account':'session',at=current?.type===type?ids.indexOf(current.id):-1;
  return {type,id:ids[(at+1)%ids.length]};
 }
 function alert(rootEl,kind){
  const next=nextPick(last?.r,kind,pick);if(!next)return;
  pick=next;setMode(rootEl,next.type==='account'?'weekly':'sessions');
 }
 function mount(rootEl,ctx){
  mode=MODES.some(([k])=>k===stored().mode)?stored().mode:'sessions';
  rootEl.innerHTML=`<div class="cluster" aria-label="계기판"><div class="cl-body"></div>
   <div class="cl-top"><div class="cl-kinds"></div>${LAMPS_MARKUP}</div>
   <div class="cl-main">${dial('cl-tach','토큰 속도')}<div class="cl-window" aria-live="off">
    <div class="cl-head"><div class="cl-modes" role="tablist" aria-label="표시창">${MODES.map(([k,label])=>`<button type="button" role="tab" data-cluster-mode="${k}">${label}</button>`).join('')}</div><span class="cl-span"></span></div>
    <div class="cl-page" data-page="sessions" role="tabpanel"><div class="cl-sessions"></div></div>
    <div class="cl-page" data-page="flow" role="tabpanel"><div class="cl-big"><b></b> <small>토큰</small></div><div class="cl-chart"><canvas id="clusterTokenChart"></canvas></div><div class="chart-foot cl-legend" id="clusterChartLegend"></div></div>
    <div class="cl-page" data-page="weekly" role="tabpanel"><div class="cl-cards"></div></div>
   </div>${dial('cl-speed','소진 속도')}</div>
   <div class="cl-foot"><div class="cl-left"><div class="cl-temp" tabindex="0"><small>부하</small><svg viewBox="0 0 80 46" aria-hidden="true"><path class="t-track" d="M8 40 A32 32 0 0 1 72 40"/><path class="t-hot" d="M8 40 A32 32 0 0 1 72 40" pathLength="100" stroke-dasharray="0 75 25 100"/><line class="t-needle" x1="40" y1="40" x2="40" y2="14"/><circle cx="40" cy="40" r="3.5"/><text x="3" y="45">C</text><text x="71" y="45">H</text></svg><b class="t-read">—</b><span class="cl-tip t-tip" role="tooltip"></span></div>
     <div class="cl-fuel"><small>남은 주간 한도</small><div></div></div></div>
    <div class="cl-gear"><small>기간</small><div role="group" aria-label="기간"></div>
     <div class="range-toolbar cl-range" hidden><h2 data-range-label>최근 1시간</h2><div class="chart-periods range-buttons" role="group" aria-label="계기판 기간"></div></div></div>
    ${ODO_MARKUP}</div></div>`;
  const ctxNow=()=>last?.ctx||ctx;
  const choose=next=>{pick=next;render(rootEl,ctxNow());};
  const session=row=>{const id=row.dataset.clusterSession;if(pick?.type==='session'&&pick.id===id)ctxNow().open?.(id);else choose({type:'session',id});};
  rootEl.onclick=e=>{
   const m=e.target.closest('[data-cluster-mode]');if(m){setMode(rootEl,m.dataset.clusterMode);return;}
   const w=e.target.closest('[data-cluster-alert]');if(w){alert(rootEl,w.dataset.clusterAlert);return;}
   if(e.target.closest('[data-cluster-trip]')){save({trip:Math.floor(now())});render(rootEl,ctxNow());return;}
   const o=e.target.closest('[data-cluster-open]');if(o){ctxNow().open?.(o.dataset.clusterOpen);return;}
   const g=e.target.closest('[data-cluster-period]');if(g){if(g.dataset.clusterPeriod==='custom')toggleRange(rootEl,!rangeOpen);else{toggleRange(rootEl,false);ctxNow().selectPeriod(g.dataset.clusterPeriod);}return;}
   const a=e.target.closest('[data-cluster-account]');if(a){const id=a.dataset.clusterAccount;choose(pick?.type==='account'&&pick.id===id?null:{type:'account',id});return;}
   const s=e.target.closest('[data-cluster-session]');if(s)session(s);
  };
  rootEl.onkeydown=e=>{
   const tab=e.target.closest('[data-cluster-mode]');
   if(tab&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();const i=MODES.findIndex(([k])=>k===mode),next=MODES[(i+(e.key==='ArrowRight'?1:MODES.length-1))%MODES.length][0];setMode(rootEl,next);rootEl.querySelector(`[data-cluster-mode="${next}"]`).focus();return;}
   if(e.key==='Escape'&&rangeOpen){toggleRange(rootEl,false);rootEl.querySelector('[data-cluster-period="custom"]')?.focus();return;}
   const s=e.target.closest('[data-cluster-session]');if(s&&e.target===s&&(e.key==='Enter'||e.key===' ')){e.preventDefault();session(s);}
  };
  // The slider closes when the pointer goes down anywhere outside it.
  root.document?.addEventListener('pointerdown',e=>{if(rangeOpen&&rootEl.isConnected&&!e.target.closest('.cl-range,[data-cluster-period="custom"]'))toggleRange(rootEl,false);});
  mounted=rootEl;showMode(rootEl);ctx.rangeControls?.();
  clearInterval(ticker);ticker=setInterval(()=>tick(rootEl),1000);
 }
 function showMode(rootEl){
  rootEl.querySelectorAll('[data-cluster-mode]').forEach(b=>{const on=b.dataset.clusterMode===mode;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;b.classList.toggle('on',on);});
  rootEl.querySelectorAll('.cl-page').forEach(p=>p.hidden=p.dataset.page!==mode);
 }
 function setMode(rootEl,next){
  if(!MODES.some(([k])=>k===next))return;mode=next;
  save({mode});
  showMode(rootEl);if(last)render(rootEl,last.ctx);if(mode==='flow')root.requestAnimationFrame?.(()=>last?.ctx.drawFlow?.());
 }
 function toggleRange(rootEl,open){
  rangeOpen=open;rangeFrom=open?last?.r.period:null;const box=rootEl.querySelector('.cl-range');if(box)box.hidden=!open;
  rootEl.querySelector('[data-cluster-period="custom"]')?.setAttribute('aria-expanded',String(open));
  if(open)last?.ctx.rangeControls?.();
 }
 // Rows keep their elements while the same items stay in the same order, so bars and needles inside them
 // move instead of being redrawn; otherwise the list is built again.
 function keyed(box,items,key,build,update){
  const keys=items.map(key).join('\n');
  if(box.dataset.keys!==keys||box.children.length!==items.length){box.dataset.keys=keys;box.innerHTML=items.map(build).join('');}
  [...box.children].forEach((el,i)=>update(el,items[i]));
 }
 function odometer(rootEl,value){
  const total=Math.max(0,Math.min(9999999999,Math.round(value||0))),s=String(total).padStart(10,'0');
  rootEl.querySelectorAll('.cl-odo>[role=img] i').forEach((w,k)=>{w.firstElementChild.style.transform=`translateY(${-Number(s[k])*10}%)`;w.classList.toggle('lead',k<s.length-String(total).length);});
  rootEl.querySelector('.cl-odo>[role=img]').setAttribute('aria-label',total.toLocaleString(root.OneTopI18n?.locale()||'ko-KR')+' tokens');
 }
 // Between readings the odometer, the trip and the flow chart's current bar run on at the last minute's
 // rate. Capped so a stalled refresh does not run away.
 function tick(rootEl,L=last){
  if(!L||!rootEl.isConnected||rootEl.hidden||calm())return;
  const {r,ctx,at}=L,el=Math.min(30,Math.max(0,now()-at));if(!el)return;
  const total=Math.max(0,(r.tach.tokens||0)+r.tach.climb*el);odometer(rootEl,total);
  const big=rootEl.querySelector('.cl-page[data-page="flow"] .cl-big b');if(big&&ctx.fmt)big.textContent=ctx.fmt(total);
  const tr=r.trip,add=valid(r.tach.instant)?r.tach.instant/HOUR*el:0;
  if(tr?.inRange){const n=tr.tokens+add,h=(now()-tr.start)/HOUR;rootEl.querySelector('.cl-trip-n').textContent=ctx.fmt?ctx.fmt(n):String(Math.round(n));if(h>0)rootEl.querySelector('.cl-trip-r').textContent=ctx.fmt?ctx.fmt(n/h):reading(n/h);}
  if(L===last&&mode==='flow'&&add>0)ctx.drawFlow?.(Object.entries(r.tach.byKind).filter(([,v])=>v>0).map(([kind,v])=>({t:now(),kind,n:v/HOUR*el})));
 }
 // What every painter reads: the page's translation and locale, the dashboard's colours, numbers and account chips.
 function kit(rootEl,ctx){
  const locale=root.OneTopI18n?.locale()||'ko-KR';
  const when=t=>{const d=new Date(t*1000);return d.toLocaleDateString(locale,{weekday:'short'})+' '+d.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});};
  return {q:s=>rootEl.querySelector(s),t:k=>root.OneTopI18n?root.OneTopI18n.t(k):k,lang:root.OneTopI18n?.language||'ko',W:ctx.weekly,locale,
   color:k=>ctx.colors[k]||'var(--dim)',chip:id=>ctx.accountChip(id)||'',fmt:v=>ctx.fmt?ctx.fmt(v):reading(v),
   // Range line: when this account's limit runs out at its current burn, or that it lasts to the reset.
   eta:a=>!a.range?'':a.range.state==='idle'?'<span class="eta idle">지금은 쓰지 않음</span>':a.range.state==='enough'?'<span class="eta ok">초기화 전까지 충분</span>'
    :`<span class="eta${a.range.early?' warn':''}"><span>이 속도면</span> <b>${esc(when(a.range.at))}</b> <span>바닥</span></span>`};
 }
 // The two dials, the warning lights, the fuel gauges and the odometer with its trip, drawn the same on the
 // dashboard's cluster and on the panels' compact one. busy holds the needles while the ignition sweep runs.
 function paintDials(rootEl,r,ctx,busy){
  const {q,t,W,color,chip,fmt}=kit(rootEl,ctx);
  // Tachometer (the smaller dial): tokens per hour on the dashboard's scale; the thin needle is the last minute.
  const tach=q('.cl-tach'),tg=marks(r.tach.max/1e6);scaleMarkup(tach,tg,scaleNumber);
  // The readout is the dashboard's own figure, so the two pages show the same number.
  const shown=fmt(r.tach.rate),unit=String(shown).match(/^(.+?)([kMBT])$/);
  tach.querySelector('.cl-read b').textContent=unit?unit[1]:shown;
  tach.querySelector('.cl-read small').innerHTML=(unit?`<span>${unit[2]}</span> `:'')+'<span>tokens/시간</span>';
  tach.querySelector('.cl-aux').innerHTML=valid(r.tach.instant)?`<span class="aux-now"><span>최근 1분</span> <b>${esc(fmt(r.tach.instant))}</b></span>`:'';
  tach.querySelector('.cl-sub').innerHTML=`<span>${esc(ctx.caption)}</span> <span>평균</span>`;
  tach.setAttribute('aria-label',`${t('토큰 속도')} ${shown} ${t('tokens/시간')} · ${ctx.caption}`);
  // Speedometer (the main dial): the subject's %/h of its account's weekly limit, in that tool's colour,
  // labelled 'session · tool' or 'tool · plan'; the thin needle is its last ten minutes.
  const speed=q('.cl-speed'),sg=marks(r.speed.max),sub=r.speed.subject;scaleMarkup(speed,sg,scaleNumber);
  speed.style.setProperty('--subject',sub?color(sub.kind):'var(--dim)');
  speed.querySelector('.cl-read b').textContent=reading(r.speed.value);
  speed.querySelector('.cl-read small').textContent='%/시간 · 주간 한도 기준';
  const acct=sub&&r.accounts.find(a=>a.id===sub.account);
  speed.querySelector('.cl-sub').innerHTML=!sub?'<span>계정 소진 속도 측정 중</span>':sub.type==='session'
   ?`<i style="background:${color(sub.kind)}"></i><b data-user-content>${esc(ctx.name(sub.session))}</b><span>·</span><span>${esc(ctx.kindName(sub.kind))}</span>`
   :`<i style="background:${color(sub.kind)}"></i><b>${esc(ctx.kindName(sub.kind))}</b>${chip(sub.id)}${acct?.plan?`<span>·</span><span>${esc(acct.plan)}</span>`:''}${r.speed.picked?'':'<span class="cl-pick">가장 빠름</span>'}`;
  speed.setAttribute('aria-label',`${t('소진 속도')} ${reading(r.speed.value)}%/h`);
  // Cruise zones on the speedometer: green up to the steady rate that lasts until the reset, amber past it,
  // red past one and a half times it.
  const c=r.speed.cruise,f=v=>Math.max(0,Math.min(1,v/r.speed.max)),band=[[0,c],[c,c*1.5],[c*1.5,r.speed.max]];
  speed.querySelectorAll('.cl-band circle').forEach((el,i)=>{const [a,b]=band[i];el.setAttribute('stroke-dasharray',c===null||!(f(b)>f(a))?'0 360':`0 ${(270*f(a)).toFixed(2)} ${(270*(f(b)-f(a))).toFixed(2)} 360`);});
  speed.classList.toggle('over',c!==null&&r.speed.value!==null&&r.speed.value>c);
  speed.querySelector('.cl-aux').innerHTML=(c===null?'':`<span class="aux-cruise"><span>적정</span> <b>${W.burn(c)}</b></span>`)
   +(r.speed.recent===null?'':`<span class="aux-now"><span>최근 10분</span> <b>${W.burn(r.speed.recent)}</b></span>`);
  if(!busy){needle(tach,r.tach.rate===null?0:r.tach.rate/r.tach.max);needle(speed,r.speed.value===null?0:r.speed.value/r.speed.max);
   needle2(tach,valid(r.tach.instant)?r.tach.instant/r.tach.max:null);needle2(speed,r.speed.recent===null?null:r.speed.recent/r.speed.max);}
 }
 function paintLamps(rootEl,r){
  const q=s=>rootEl.querySelector(s),t=k=>root.OneTopI18n?root.OneTopI18n.t(k):k;
  for(const [k] of LAMPS){const el=q(`.cl-lamp.${k}`),n=k==='live'?null:r.tells[k].length,on=k==='live'?true:n>0;
   el.classList.toggle('lit',on);el.classList.toggle('stale',k==='live'&&!r.tells.fresh);el.setAttribute('aria-disabled',String(k==='live'||!n));
   const name=k==='live'?(r.tells.fresh?'실시간':'수집 지연'):LAMPS.find(x=>x[0]===k)[1];el.querySelector('.cl-lamp-name').textContent=name;el.querySelector('.cl-tip b').textContent=n===null?'':String(n);
   el.setAttribute('aria-label',`${t(name)}${n===null?'':' '+n}`);}
 }
 function paintFuel(rootEl,r,ctx){
  const {q,W,color,chip,locale,eta}=kit(rootEl,ctx);
  // Fuel: a gauge per account filled with what is left of its weekly limit, named by plan; the details
  // show on hover or focus, and pressing one picks it for the speedometer.
  const fuel=q('.cl-fuel>div');
  if(!r.accounts.length){fuel.dataset.keys='';fuel.innerHTML='<div class="cl-empty">연결된 구독 계정이 없습니다.</div>';}
  else keyed(fuel,r.accounts,a=>a.id,a=>`<button type="button" class="cl-can" data-cluster-account="${esc(a.id)}" style="--c:${color(a.kind)}"><i><s></s></i><b></b><span class="cl-tip" role="tooltip"></span></button>`,
   (el,a)=>{const on=r.speed.account===a.id&&r.speed.picked,low=a.left!==null&&a.left<15;
    el.classList.toggle('on',on);el.classList.toggle('low',low);el.classList.toggle('stale',!a.current);el.classList.toggle('warn',a.reconnect);el.setAttribute('aria-pressed',String(on));
    el.querySelector('i>s').style.height=(a.left===null?0:a.left)+'%';
    const name=a.plan?esc(a.plan):chip(a.id)||esc(ctx.kindName(a.kind)),nb=el.querySelector('b');if(nb.dataset.html!==name){nb.dataset.html=name;nb.innerHTML=name;}
    const reset=a.reset?new Date(a.reset*1000).toLocaleString(locale,{month:'numeric',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'}):'';
    const tip=`<span class="cl-tip-h"><i></i><span>${esc(ctx.kindName(a.kind))}</span>${chip(a.id)}${a.plan?`<em>${esc(a.plan)}</em>`:''}</span>
     ${a.reconnect?'<span class="warn">재연결 필요</span>':a.left===null?'<span>보고 대기</span>':`<span><b>${W.percent(a.left)}</b> <span>남음</span></span>`}
     ${reset?`<span class="cl-reset"><span>초기화</span> <span>${esc(reset)}</span></span>`:''}<span><span>평균</span> <span>${W.burn(a.burn)}</span></span>${eta(a)}`;
    const tp=el.querySelector('.cl-tip');if(tp.dataset.html!==tip){tp.dataset.html=tip;tp.innerHTML=tip;}});
 }
 function paintTrip(rootEl,r,ctx){
  const {q,color,chip,locale,fmt,W}=kit(rootEl,ctx);
  // Trip: since the last reset, the tokens used, their average speed and each account's weekly percent.
  const tr=r.trip,outside=!!tr&&!tr.inRange;
  q('.cl-trip-since').innerHTML=tr?`<span>${esc(new Date(tr.start*1000).toLocaleString(locale,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}))}</span> <span>부터</span>`:'';
  q('.cl-trip-v').classList.toggle('outside',outside);q('.cl-trip-out').hidden=!outside;
  q('.cl-trip-n').textContent=tr?.inRange?fmt(tr.tokens):'';q('.cl-trip-r').textContent=tr?.inRange?fmt(tr.rate):'';
  const legs=tr?tr.accounts.map(x=>{const a=r.accounts.find(a=>a.id===x.id);if(!a)return '';
   return `<span style="--c:${color(a.kind)}"><i></i>${a.plan?esc(a.plan):chip(a.id)||esc(ctx.kindName(a.kind))} <b>${x.used===null?'—':'+'+W.percent(x.used)}</b></span>`;}).join(''):'',ta=q('.cl-trip-a');
  if(ta.dataset.html!==legs){ta.dataset.html=legs;ta.innerHTML=legs;}
  // Odometer: the period's tokens, digit wheels rolling to the new count.
  q('.cl-odo-span').textContent=ctx.caption;odometer(rootEl,r.tach.tokens);
 }
 function render(rootEl,ctx){
  if(mounted!==rootEl||!rootEl.querySelector('.cluster'))mount(rootEl,ctx);
  // The trip runs from the last reset, kept in this browser; the first visit starts it.
  tripStart=stored().trip;if(!valid(tripStart)){tripStart=Math.floor(now());save({trip:tripStart});}
  const r=readings(ctx.state,{...ctx,pick,trip:tripStart});last={r,ctx,at:now()};
  // A pick that left the readings (a session that ended) lets the speedometer go back to the fastest account.
  if(pick&&!r.speed.picked)pick=null;
  if(rangeOpen&&r.period!==rangeFrom)toggleRange(rootEl,false);
  const {q,t,lang,W,color,chip,fmt,eta}=kit(rootEl,ctx);
  paintDials(rootEl,r,ctx,igniting);
  // Top: the tools working now, then the warning lights.
  q('.cl-kinds').innerHTML=r.tells.kinds.map(k=>`<span class="cl-kind" style="--c:${color(k.kind)}"><i></i><span>${esc(ctx.kindName(k.kind))}</span><b>${k.working}</b></span>`).join('');
  paintLamps(rootEl,r);
  q('.cl-span').textContent=ctx.caption;
  // Page 1, running sessions: a row picks the session for the speedometer; a second press, or ↗, opens its detail.
  // Its small gauge reads the session's burn on the speedometer's scale.
  const mini='<svg class="cl-mini" viewBox="0 0 64 36" aria-hidden="true"><path class="mt" d="M7 32 A25 25 0 0 1 57 32"/><path class="mv" d="M7 32 A25 25 0 0 1 57 32" pathLength="100" stroke-dasharray="0 100"/><line class="mn" x1="32" y1="32" x2="32" y2="12"/></svg>';
  const box=q('.cl-sessions');
  if(!r.sessions.length){box.dataset.keys='';box.innerHTML='<div class="cl-empty">작업 중인 세션이 없습니다.</div>';}
  else keyed(box,r.sessions,x=>x.id,x=>`<div class="cl-session" role="button" tabindex="0" data-cluster-session="${esc(x.id)}"><span class="cl-state"><i class="dot"></i></span>
    <div class="cl-what"><b data-user-content></b><span></span></div><div class="cl-figs"><b></b><span></span></div>${mini}<button type="button" class="cl-open" data-cluster-open="${esc(x.id)}" aria-label="세션 상세" title="세션 상세">↗</button></div>`,
   (el,x)=>{const s=x.session,on=r.speed.session===x.id;el.classList.toggle('on',on);el.setAttribute('aria-pressed',String(on));el.style.setProperty('--c',color(s.kind));
    el.querySelector('.cl-state').className='cl-state '+x.state;el.querySelector('.cl-what b').textContent=ctx.name(s);
    const meta=`<i style="background:${color(s.kind)}"></i>${esc(ctx.kindName(s.kind))}${x.account?chip(x.account):''}<em data-user-content>${esc(s.model||'')}</em>${s.effort?`<u>${esc(s.effort)}</u>`:''}`;
    const span=el.querySelector('.cl-what span');if(span.dataset.html!==meta){span.dataset.html=meta;span.innerHTML=meta;}
    const v=el.querySelector('.cl-figs b'),kind=x.estimate!==null?'pp':'tokens';if(v.dataset.kind!==kind){v.dataset.kind=kind;delete v.dataset.v;}
    count(v,kind==='pp'?x.estimate:x.tokens,kind==='pp'?n=>'≈'+W.percent(n):n=>fmt(n)+' tokens');count(el.querySelector('.cl-figs span'),x.burn,n=>W.burn(n));
    const g=valid(x.burn)?Math.min(1,x.burn/r.speed.max):0;el.querySelector('.cl-mini .mv').setAttribute('stroke-dasharray',`${(g*100).toFixed(1)} 100`);
    el.querySelector('.cl-mini .mn').style.transform=`rotate(${(-90+180*g).toFixed(1)}deg)`;el.querySelector('.cl-mini').classList.toggle('off',!valid(x.burn));});
  // Page 2, token flow: the period's total; app.js draws the dashboard's own token flow chart and legend into it.
  q('.cl-page[data-page="flow"] .cl-big b').textContent=fmt(r.tach.tokens);
  // Page 3, weekly limits: a card per account; pressing one picks it for the speedometer.
  const cards=q('.cl-cards');
  if(!r.accounts.length){cards.dataset.keys='';cards.innerHTML='<div class="cl-empty">연결된 구독 계정이 없습니다.</div>';}
  else keyed(cards,r.accounts,a=>a.id,a=>`<button type="button" class="cl-card" data-cluster-account="${esc(a.id)}" style="--c:${color(a.kind)}"><span class="cl-card-h"></span>
    <span class="cl-card-w"><strong></strong> <small>/ 100% 사용</small></span><span class="cl-card-bar"><s></s></span><span class="cl-card-f"></span></button>`,
   (el,a)=>{const on=r.speed.account===a.id&&r.speed.picked;el.classList.toggle('on',on);el.classList.toggle('stale',!a.current);el.setAttribute('aria-pressed',String(on));
    const who=a.who&&a.who.toLowerCase()!==String(a.alias||'').toLowerCase()?`<small data-user-content>${esc(a.who)}</small>`:'';
    const h=`<i></i><span>${esc(ctx.kindName(a.kind))}</span>${chip(a.id)}${a.plan?`<em>${esc(a.plan)}</em>`:''}${who}`,hd=el.querySelector('.cl-card-h');if(hd.dataset.html!==h){hd.dataset.html=h;hd.innerHTML=h;}
    count(el.querySelector('.cl-card-w strong'),a.pct,n=>W.percent(n));el.querySelector('.cl-card-bar s').style.width=(a.pct===null?0:Math.min(100,a.pct))+'%';
    const first=a.reconnect?'<b class="warn">재연결 필요</b>':`<span><span>${esc(ctx.caption)}</span> <b>${a.added===null?'—':'+'+W.percent(a.added)}</b></span>`;
    const foot=`${first}<span><span>평균</span> <b>${W.burn(a.burn)}</b></span>${eta(a)}`,ft=el.querySelector('.cl-card-f');if(ft.dataset.html!==foot){ft.dataset.html=foot;ft.innerHTML=foot;}});
  // Gear: the time window, shared with the dashboard's slider.
  const preset=GEARS.includes(r.period),gearBox=q('.cl-gear>div'),gearKey=r.period+'|'+lang;
  if(gearBox.dataset.key!==gearKey){gearBox.dataset.key=gearKey;
   gearBox.innerHTML=GEARS.map(k=>`<button type="button" data-cluster-period="${k}" aria-pressed="${k===r.period}"${k===r.period?' class="on"':''}>${esc(root.OneTopRanges?root.OneTopRanges.label(k,lang):k)}</button>`).join('')
    +`<button type="button" data-cluster-period="custom" aria-haspopup="true" aria-expanded="${rangeOpen}" aria-pressed="${!preset}"${preset?'':' class="on"'}>${preset?'기간 지정':esc(r.period==='all'?'전체 기록':root.OneTopRanges?root.OneTopRanges.label(r.period,lang):r.period)}</button>`;}
  paintFuel(rootEl,r,ctx);
  // Engine temperature: the hottest computer's load from cold (C) to hot (H); every computer on hover.
  const temp=q('.cl-temp'),hv=r.heat.value,pc=v=>v===null?'—':Math.round(v)+'%';
  temp.querySelector('.t-needle').style.transform=`rotate(${(-90+180*(hv??0)/100).toFixed(1)}deg)`;
  temp.classList.toggle('hot',hv!==null&&hv>=85);temp.querySelector('.t-read').textContent=pc(hv);
  temp.querySelector('.t-tip').innerHTML=r.heat.computers.length?r.heat.computers.map(c=>`<span class="cl-tip-h"><span>${c.name?esc(c.name):'이 컴퓨터'}</span><b>${pc(c.load)}</b></span><span><span>CPU</span> ${pc(c.cpu)} · <span>메모리</span> ${pc(c.memory)}</span>`).join(''):'<span>보고 대기</span>';
  temp.setAttribute('aria-label',`${t('부하')} ${pc(hv)}`);
  paintTrip(rootEl,r,ctx);
  if(ignition){ignition=false;ignite(rootEl);}
 }
 // Ignition: when the view opens the ticks light in a sweep and both needles test full scale, then settle
 // on their readings. Skipped when the system asks for less motion.
 function ignite(rootEl){
  // Opened before the first reading arrives: the sweep runs on the first render instead.
  if(!rootEl?.querySelector('.cluster')||!last){ignition=true;return;}
  if(!calm())sweep(rootEl,()=>last.r,v=>{igniting=v;});
 }
 function sweep(rootEl,now,hold){
  const dials=[rootEl.querySelector('.cl-tach'),rootEl.querySelector('.cl-speed')],start=performance.now(),D=1500;
  const target=()=>{const r=now();return [r.tach.rate===null?0:r.tach.rate/r.tach.max,r.speed.value===null?0:r.speed.value/r.speed.max];};
  const out=p=>1-(1-p)**3,io=p=>p<.5?4*p*p*p:1-(-2*p+2)**3/2;
  hold(true);rootEl.querySelector('.cluster').classList.add('igniting');
  const step=t=>{const p=Math.min(1,(t-start)/D),lit=out(Math.min(1,p/.45)),up=io(Math.min(1,p/.4)),down=io(Math.max(0,(p-.45)/.55)),goal=target();
   dials.forEach((d,i)=>needle(d,p<.45?up:1-(1-goal[i])*down,lit));
   if(p<1)root.requestAnimationFrame(step);else{hold(false);rootEl.querySelector('.cluster').classList.remove('igniting');dials.forEach((d,i)=>needle(d,goal[i]));
    const r=now();needle2(dials[0],valid(r.tach.instant)?r.tach.instant/r.tach.max:null);needle2(dials[1],r.speed.recent===null?null:r.speed.recent/r.speed.max);}};
  root.requestAnimationFrame(step);
 }
 // The compact cluster on the menu bar and tray panels (desktop/QuickDashboard.swift draws the same): the
 // speedometer large, the tachometer small, the warning lights, the odometer with the trip, then each account's
 // weekly limit left. The panel's own period picker sets the window. Its pick is its own; the trip runs from
 // the dashboard's reset, kept in the same storage. A warning light or a fuel gauge picks for the speedometer.
 const P={el:null,last:null,pick:null,igniting:false,ignition:false,ticker:null};
 function mountCompact(rootEl){
  rootEl.innerHTML=`<div class="cluster compact" aria-label="계기판"><div class="cl-body"></div>
   <div class="cl-main">${dial('cl-speed','소진 속도')}${dial('cl-tach','토큰 속도')}</div>
   <div class="cl-top">${LAMPS_MARKUP}</div>${ODO_MARKUP}
   <div class="cl-left"><div class="cl-fuel"><small>남은 주간 한도</small><div></div></div></div></div>`;
  const again=()=>{if(P.last)compact(rootEl,P.last.ctx);};
  rootEl.onclick=e=>{
   const w=e.target.closest('[data-cluster-alert]');if(w){const next=nextPick(P.last?.r,w.dataset.clusterAlert,P.pick);if(next){P.pick=next;again();}return;}
   if(e.target.closest('[data-cluster-trip]')){save({trip:Math.floor(now())});again();return;}
   const a=e.target.closest('[data-cluster-account]');if(a){const id=a.dataset.clusterAccount;P.pick=P.pick?.type==='account'&&P.pick.id===id?null:{type:'account',id};again();}
  };
  P.el=rootEl;clearInterval(P.ticker);P.ticker=setInterval(()=>tick(rootEl,P.last),1000);
 }
 function compact(rootEl,ctx){
  if(P.el!==rootEl||!rootEl.querySelector('.cluster'))mountCompact(rootEl);
  let trip=stored().trip;if(!valid(trip)){trip=Math.floor(now());save({trip});}
  const r=readings(ctx.state,{...ctx,pick:P.pick,trip});P.last={r,ctx,at:now()};
  if(P.pick&&!r.speed.picked)P.pick=null;
  paintDials(rootEl,r,ctx,P.igniting);paintLamps(rootEl,r);paintTrip(rootEl,r,ctx);paintFuel(rootEl,r,ctx);
  if(P.ignition){P.ignition=false;igniteCompact(rootEl);}
 }
 function igniteCompact(rootEl){
  if(!rootEl?.querySelector('.cluster')||!P.last){P.ignition=true;return;}
  if(!calm())sweep(rootEl,()=>P.last.r,v=>{P.igniting=v;});
 }
 const api={marks,readings,range,cruise,trip,heat,instant,render,ignite,compact,igniteCompact};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopCluster=api;
})(typeof window!=='undefined'?window:globalThis);
