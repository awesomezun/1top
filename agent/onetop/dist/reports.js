/* Reports: what this month's subscriptions bought at API prices, the week's agent hours, when a weekly limit runs out
   at its current burn, and a share card. The collector sends `reports` (docs/design/growth-features/report-contract);
   the look is a per-device setting kept apart from the layout, so an older app that saves the layout keeps it. */
(function(root){
 'use strict';
 const W=root.OneTopWeekly,S=root.OneTopSpeed,HOUR=3600;
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const locale=()=>root.OneTopI18n?.locale?.()||'ko-KR',T=s=>root.OneTopI18n?.t?root.OneTopI18n.t(s):s,lang=()=>root.OneTopI18n?.language||'ko';
 // A sentence around values is one dictionary entry (i18n.js) with {0}, {1}… where the values go, so it reads whole in
 // every language; FH fills the places with markup the caller has escaped.
 const F=(s,...a)=>T(s).replace(/\{(\d)\}/g,(_,i)=>a[i]??''),FH=(s,...a)=>esc(T(s)).replace(/\{(\d)\}/g,(_,i)=>a[i]??'');
 // A sentence's full stop, and the space before the next one (none in Chinese).
 const stop=s=>s+(lang()==='zh'?'。':'.'),gap=()=>lang()==='zh'?'':' ';
 // A trip computer, a receipt, one big multiple, the monthly trend, a strip: the same five for the panel and the card.
 const SHAPES=['trip','receipt','big','trend','strip'],BASES=['month','prorated'];
 const DEFAULTS={shape:'trip',share:'trend',basis:'month',hidden:false},KEY='onetop.reports.v1';
 const NAMES={trip:'트립 컴퓨터',receipt:'영수증',big:'큰 배수',trend:'월별 추이',strip:'요약 띠'};
 function normalize(v){
  const o=v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  return {shape:SHAPES.includes(o.shape)?o.shape:DEFAULTS.shape,share:SHAPES.includes(o.share)?o.share:DEFAULTS.share,
   basis:BASES.includes(o.basis)?o.basis:DEFAULTS.basis,hidden:o.hidden===true};
 }
 function settings(){try{return normalize(JSON.parse(root.localStorage?.getItem(KEY)||'null'));}catch{return normalize(null);}}
 function save(v){const s=normalize(v);try{root.localStorage?.setItem(KEY,JSON.stringify(s));}catch{}return s;}
 const kindName=k=>k==='Claude'?'Claude Code':k==='Antigravity'?'Agy CLI':k;
 const COLORS={Claude:'#bd8965',Codex:'#378d76',GLM:'#7c86bd',Antigravity:'#619db9',Aside:'#a99bdb'};
 const money=v=>!valid(v)?'—':v>=100?'$'+Math.round(v).toLocaleString('en-US'):'$'+v.toFixed(2);
 const times=r=>valid(r)?(r<99.95?r.toFixed(1):String(Math.round(r))):'—';
 const monthName=m=>{const [y,n]=String(m||'').split('-').map(Number);return y&&n?new Date(y,n-1,1).toLocaleDateString(locale(),{month:'short'}):'';};
 const clock=t=>new Date(t*1000).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'});
 const dateTime=t=>new Date(t*1000).toLocaleString(locale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 // Today, tomorrow, a weekday within the week, else a date; always with the time.
 function when(t,now){
  const d=new Date(t*1000),n=new Date(now*1000),days=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(n.getFullYear(),n.getMonth(),n.getDate()))/864e5);
  const day=days===0?T('오늘'):days===1?T('내일'):days<7?d.toLocaleDateString(locale(),{weekday:'long'}):d.toLocaleDateString(locale(),{month:'short',day:'numeric'});
  return lang()==='en'?`${days<2?day.toLowerCase():day} at ${clock(t)}`:day+' '+clock(t);
 }
 const dur=s=>W.duration(Math.max(0,Math.round(s))),D=s=>T(dur(s));
 const hoursShort=s=>s>=HOUR?Math.round(s/HOUR)+'시간':Math.max(1,Math.round(s/60))+'분';

 // ---------- the numbers ----------
 // The month: API value against the whole month's subscriptions (month), or against the share of them that has passed
 // (prorated). The projection appears once a day has passed, at the month's own pace so far.
 function value(state,basis='month'){
  const v=state?.reports?.value;if(!v||!valid(v.api_value))return null;
  const [y,m]=String(v.month||'').split('-').map(Number),first=y&&m?new Date(y,m-1,1).getTime()/1000:v.start,next=y&&m?new Date(y,m,1).getTime()/1000:null;
  const end=valid(v.end)?v.end:Date.now()/1000,share=next&&end>first?Math.min(1,(end-first)/(next-first)):1;
  // A tool with a plan whose price is unknown (a ChatGPT Pro tier, an API key) stays out of the value, the plans and the
  // multiple, so its tokens never count against too little; the footnote says how much was left out.
  const plansAll=Array.isArray(v.plans)?v.plans:[],unknownKinds=new Set(plansAll.filter(p=>!valid(p?.price)).map(p=>p.kind));
  const kinds=(Array.isArray(v.by_kind)?v.by_kind:[]).filter(k=>valid(k?.api_value)).map(k=>{const known=!unknownKinds.has(k.kind)&&valid(k.plan_total)&&k.plan_total>0,p=known?(basis==='prorated'?k.plan_total*share:k.plan_total):null;return {kind:k.kind,name:kindName(k.kind),api:k.api_value,plan:known?k.plan_total:0,ratio:p?k.api_value/p:null};});
  const counted=kinds.filter(k=>k.ratio!==null),api=counted.reduce((n,k)=>n+k.api,0),planSum=counted.reduce((n,k)=>n+k.plan,0);
  const plan=planSum>0?planSum:null,cost=plan===null?null:basis==='prorated'?plan*share:plan,ratio=cost?api/cost:null,elapsed=end-first;
  const left=kinds.filter(k=>k.ratio===null&&k.api>0);
  const models=(Array.isArray(v.by_model)?v.by_model:[]).filter(x=>valid(x?.api_value)&&counted.some(k=>k.kind===x.kind)).map(x=>({model:String(x.model||''),kind:x.kind,api:x.api_value})).sort((a,b)=>b.api-a.api);
  const months=(Array.isArray(v.months)?v.months:[]).filter(x=>valid(x?.api_value)).slice(-5).map(x=>({month:x.month,label:monthName(x.month),api:x.api_value,plan:valid(x.plan_total)?x.plan_total:0}));
  const unknown=plansAll.filter(p=>p?.source==='unknown'||!valid(p?.price)).length;
  return {month:v.month,label:monthName(v.month),first,end,share,api,plan,cost,ratio,saved:plan===null?null:api-plan,kinds,models,months,
   proj:next&&elapsed>=86400?api/elapsed*(next-first):null,plans:plansAll.filter(p=>valid(p?.price)&&!unknownKinds.has(p.kind)).length,unknown,unpriced:v.unpriced?.tokens||0,billed:valid(v.api_billed)?v.api_billed:0,prices:v.prices_as_of||'',
   left:left.reduce((n,k)=>n+k.api,0),leftNames:left.map(k=>k.name)};
 }
 // The week: agent time added over sessions, Monday to Sunday; counted since the collector began keeping states.
 function week(state){
  const w=state?.reports?.weekly;if(!w||!valid(w.working_s)||!valid(w.waiting_s))return null;
  const days=Array.from({length:7},(_,i)=>{const d=new Date((w.start+i*86400+43200)*1000),key=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'),r=(w.days||[]).find(x=>x?.date===key);
   return {label:d.toLocaleDateString(locale(),{weekday:'short'}),work:valid(r?.working_s)?r.working_s:null,wait:valid(r?.waiting_s)?r.waiting_s:null};});
  return {start:w.start,work:w.working_s,wait:w.waiting_s,partial:valid(w.since)&&w.since>w.start,prev:w.previous&&valid(w.previous.working_s)?{work:w.previous.working_s,wait:w.previous.waiting_s||0,partial:!!w.previous.partial}:null,
   longest:w.longest_wait&&valid(w.longest_wait.seconds)?{label:String(w.longest_wait.label||''),kind:w.longest_wait.kind,seconds:w.longest_wait.seconds}:null,days};
 }
 // The weekly limit at the account's own burn for the chosen period, as cluster.js reads its range: empty before the
 // reset (with how much earlier), enough to the reset, or idle at no burn. null without a verified weekly window.
 function burnOf(state,q,period){const w=W.representative(q);if(!W.burnAllowed(q,w))return null;return W.accountBurn(state?.weekly_usage?.accounts?.find(a=>a.id===q.id)?.periods?.[period],q);}
 function forecast(state,q,period,now){
  const w=W.weekly(q),rate=burnOf(state,q,period);if(!w||!valid(w.pct)||!valid(rate))return null;
  const left=Math.max(0,100-w.pct),reset=valid(w.reset)?w.reset:null;
  if(rate===0)return {state:'idle',left,reset};
  const end=now+left/rate*HOUR;
  return reset&&end>=reset?{state:'enough',left,reset,end}:{state:'empty',left,reset,end,hours:left/rate,early:reset?reset-end:null};
 }
 // The same tool's account that lasts to its reset with the most left, offered when this one runs out first.
 function alternative(state,q,period,now){
  const others=(state?.account_quotas||[]).filter(o=>o.kind===q.kind&&o.id!==q.id&&o.stale===false).map(o=>({o,f:forecast(state,o,period,now)})).filter(x=>x.f&&x.f.state!=='empty');
  others.sort((a,b)=>b.f.left-a.f.left);return others[0]||null;
 }
 // The five-hour window: about to reset while nearly used, just reset, or plain.
 function fiveHour(q,now){
  const w=(q?.windows||[]).find(x=>x&&x.scope!=='mcp'&&W.periodOf(x)==='5h');if(!w||!valid(w.pct))return null;
  const left=valid(w.reset)?w.reset-now:null;
  return {pct:w.pct,reset:w.reset,soon:w.pct>=80&&left!==null&&left>0&&left<=HOUR,left};
 }
 function sentences(state,q,period,now,label){
  const f=forecast(state,q,period,now);if(!f)return null;
  const out={f,warn:f.state==='empty'};
  if(f.state==='empty'){out.main=F('이 속도면 {0}에 바닥납니다',when(f.end,now));out.sub=f.early?F('초기화보다 {0} 빠릅니다',T(hoursShort(f.early))):'';
   const alt=alternative(state,q,period,now);if(alt)out.alt=F('{0} 계정은 {1}% 남아 초기화까지 넉넉합니다',label(alt.o),Math.round(alt.f.left));}
  else if(f.state==='enough'){out.main=T('초기화 전에 바닥나지 않습니다');out.sub=f.reset?F('{0} 초기화 · {1}% 남음',dateTime(f.reset),Math.round(f.left)):'';}
  else {out.main=T('지금은 쓰지 않고 있습니다');out.sub='';}
  const h=fiveHour(q,now);
  // The five-hour window only when it matters now: nearly used up and about to reset.
  if(h?.soon)out.h5=FH('5시간 한도가 {0} 뒤 초기화됩니다({1}% 사용). 큰 작업은 그 뒤에 시작하세요.',`<b>${esc(D(h.left))}</b>`,Math.round(h.pct));
  return out;
 }

 // ---------- drawing ----------
 // The cluster's seven-segment digits (speed.js seg7), lit in the given colour.
 function lcd(v,{dec=1,color='var(--lcd)',cls=''}={}){
  if(!valid(v)||!S?.seg7)return `<span class="cl-led ${cls}"><b class="rp-led-text">—</b></span>`;
  const s=v>=999.95?'999':v.toFixed(dec),g={c:[...s.replace('.','')],u:'',dp:s.includes('.')?s.indexOf('.')-1:null,center1:true};
  const h=40,w=h*.55,gap=h*.15,n=g.c.length,m=Number.isInteger(g.dp)?1:0,W2=Math.ceil((n-1)*(w+gap)+w+m*h*.115*1.2+h*Math.tan(9*Math.PI/180)+2);
  return `<span class="cl-led ${cls}" style="--led:${color}"><svg class="cl-lcd" viewBox="0 -1 ${W2} ${h+2}" style="aspect-ratio:${W2}/${h+2}" aria-hidden="true"><defs>${S.glowFilter||''}</defs>${S.seg7(g,W2/2,h,w,h,h*.115,gap,false)}</svg></span>`;
 }
 const sign=d=>(d>=0?'+':'−')+dur(Math.abs(d));
 const dotk=k=>`<i class="rp-dot" style="background:${COLORS[k]||'#8d9ba8'}"></i>`;
 const head=(title,sub)=>`<div class="panel-heading rp-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><div class="rp-actions"><button type="button" class="rp-btn" data-report-shape>${esc(T('모양'))}</button><button type="button" class="rp-btn" data-report-share>${esc(T('공유 카드'))}</button></div></div>`;
 function foot(v){
  const notes=[T('긴 문맥 요금과 가격을 모르는 모델은 빼고 계산해 실제보다 낮게 나올 수 있습니다')];
  if(v?.left)notes.push(F('요금제를 모르는 {0} {1}은 빼고 계산했습니다',v.leftNames.join(', '),money(v.left)));
  if(v?.billed)notes.push(F('API 키로 쓴 {0}은 빼고 계산했습니다',money(v.billed)));
  return `<div class="panel-foot rp-foot"><span>${notes.map(esc).join(' · ')}</span>${v?.prices?`<span>${esc(F('가격 {0} 기준',v.prices))}</span>`:''}</div>`;
 }
 const period=v=>`${new Date(v.first*1000).toLocaleDateString(locale(),{month:'short',day:'numeric'})} ~ ${dateTime(v.end)}`;
 const basisNote=(v,o)=>o.basis==='prorated'?F('지난 {0}% 기간의 구독료 {1}와 비교',Math.max(1,Math.round(v.share*100)),money(v.cost)):F('이번 달 구독료 {0} 전체와 비교',money(v.plan));
 const weekNote=wk=>wk.partial?' · '+T('4.8.0 설치 이후'):'';
 // No multiple reads as a dash alone, never '—배'.
 const ratioText=r=>valid(r)?F('{0}배',times(r)):'—';
 const PANELS={
  trip(v,wk,o){return `<section class="panel rp rp-trip">${head(F('{0} 본전 · 이번 주',v.label),F('API 가격으로 환산 · {0}',period(v)))}<div class="rp-trip-body">
   <div class="rp-cell"><small>본전 배수</small><div class="rp-big">${lcd(v.ratio)}<b>배</b></div><em>${esc(basisNote(v,o))}</em></div>
   <div class="rp-cell"><small>${esc(F('{0} 지금까지',v.label))}</small><dl class="rp-rows"><div><dt>API 가격 환산</dt><dd>${money(v.api)}</dd></div><div><dt>${esc(F('구독료 · 요금제 {0}개',v.plans))}</dt><dd>${money(v.plan)}</dd></div><div class="rp-good"><dt>아낀 돈</dt><dd>${valid(v.saved)?'+'+money(v.saved):v.saved===null?'—':'−'+money(-v.saved)}</dd></div></dl></div>
   <div class="rp-cell"><small>이번 주 에이전트 시간 · 세션 합${weekNote(wk||{})}</small>${wk?`<div class="rp-wk">${lcd(wk.work/HOUR)}<span>시간 작업</span>${lcd(wk.wait/HOUR,{color:'var(--amber)'})}<span>시간 대기로 멈춤</span>${wk.prev?`<em>${esc(F('지난주 같은 때보다 작업 {0} · 대기 {1}',T(sign(wk.work-wk.prev.work)),T(sign(wk.wait-wk.prev.wait))))}</em>`:''}</div>`:'<p class="rp-empty">주간 기록을 모으는 중입니다</p>'}</div>
  </div><div class="rp-chips">${v.kinds.map(k=>`<span class="rp-chip">${dotk(k.kind)}${esc(k.name)}${k.plan?`<b>${esc(ratioText(k.ratio))}</b>${money(k.api)} / ${money(k.plan)}`:`<span>${money(k.api)} · 요금제 확인 필요</span>`}</span>`).join('')}</div>${foot(v)}</section>`;},
  receipt(v,wk,o){const max=Math.max(36000,...(wk?.days||[]).map(d=>(d.work||0)+(d.wait||0)));
   return `<section class="panel rp rp-receipt">${head(F('{0} 사용 영수증',v.label),F('API 가격으로 계산하면 · {0}',period(v)))}<div class="rp-receipt-body"><div class="rp-paper"><h3>1TOP RECEIPT</h3><div class="rp-sub">${esc(period(v))}</div>
   ${v.models.slice(0,8).map(m=>`<div class="rp-l"><span>${esc(m.model)}</span><i></i><b>${money(m.api)}</b></div>`).join('')}<hr><div class="rp-l"><span>API 가격 합계</span><i></i><b>${money(v.api)}</b></div>
   <div class="rp-l"><span>${esc(F('구독료 {0}개',v.plans))}</span><i></i><b>−${money(v.plan)}</b></div><hr><div class="rp-l rp-total"><span>아낀 돈</span><i></i><b>${money(v.saved)}</b></div><div class="rp-stampw"><span class="rp-stamp">${esc(F('본전 {0}배',times(v.ratio)))}</span></div></div>
   <div class="rp-sheet"><h3>이번 주 근무표${weekNote(wk||{})}</h3>${wk?wk.days.map(d=>`<div class="rp-day"><span>${esc(d.label)}</span><div class="rp-bar">${d.work!==null?`<i class="w" style="width:${d.work/max*100}%"></i><i class="q" style="width:${(d.wait||0)/max*100}%"></i>`:''}</div><span>${d.work!==null?`${(d.work/HOUR).toFixed(1)}h · ${esc(F('대기 {0}h',((d.wait||0)/HOUR).toFixed(1)))}`:'—'}</span></div>`).join('')+
   `<div class="rp-tot"><span>${FH('작업 {0} · 대기 {1}',`<b>${esc(D(wk.work))}</b>`,`<b class="rp-warn">${esc(D(wk.wait))}</b>`)}</span><em>세션 합</em></div>${wk.longest?`<div class="rp-tot"><em>${FH('가장 오래 멈춘 세션: {0} · {1} · {2}',`<span data-user-content>${esc(wk.longest.label)}</span>`,esc(kindName(wk.longest.kind)),esc(D(wk.longest.seconds)))}</em></div>`:''}`:'<p class="rp-empty">주간 기록을 모으는 중입니다</p>'}</div></div>${foot(v)}</section>`;},
  big(v,wk,o){const top=Math.max(v.api,v.cost||0)||1,maxK=Math.max(...v.kinds.map(k=>k.ratio||0),1),max=Math.max(36000,...(wk?.days||[]).map(d=>(d.work||0)+(d.wait||0)));
   return `<section class="panel rp rp-big-shape">${head(F('{0} 본전 · 이번 주',v.label),period(v))}<div class="rp-big-body"><div class="rp-big-l"><div class="rp-hero"><strong>${times(v.ratio)}</strong><span>배</span></div>
   <p class="rp-say">${FH('구독료 {0}로 API 가격 기준 {1}어치를 썼습니다.',`<b>${money(o.basis==='prorated'?v.cost:v.plan)}</b>`,`<b>${money(v.api)}</b>`)}</p>
   <div class="rp-hbar"><span>구독료</span><div class="tr"><i style="width:${(v.cost||0)/top*100}%;background:#5a6270"></i></div><b>${money(v.cost)}</b></div>
   <div class="rp-hbar"><span>API 환산</span><div class="tr"><i style="width:${v.api/top*100}%;background:var(--green)"></i></div><b>${money(v.api)}</b></div>
   <div class="rp-tools">${v.kinds.map(k=>`<div class="rp-tool"><span>${dotk(k.kind)}${esc(k.name)}</span><div class="tr"><i style="width:${(k.ratio||0)/maxK*100}%;background:${COLORS[k.kind]||'#8d9ba8'}"></i></div><b>${esc(ratioText(k.ratio))}</b></div>`).join('')}</div></div>
   <div class="rp-big-r">${wk?`<div class="rp-two"><div><small>이번 주 작업 · 세션 합${weekNote(wk)}</small><strong>${dur(wk.work)}</strong>${wk.prev?`<em class="rp-good">${esc(F('지난주 같은 때보다 {0}',T(sign(wk.work-wk.prev.work))))}</em>`:''}</div><div><small>대기로 멈춘 시간</small><strong class="rp-warn">${dur(wk.wait)}</strong>${wk.prev?`<em class="${wk.wait<=wk.prev.wait?'rp-good':'rp-warn'}">${esc(F('지난주 같은 때보다 {0}',T(sign(wk.wait-wk.prev.wait))))}</em>`:''}</div></div>
   <div class="rp-days">${wk.days.map(d=>`<div class="rp-col"><div class="st">${d.work!==null?`<i style="height:${d.work/max*92}px;background:var(--green)"></i><i style="height:${(d.wait||0)/max*92}px;background:var(--amber)"></i>`:''}</div><small>${esc(d.label)}</small></div>`).join('')}</div>${wk.longest?`<div class="rp-long">${FH('가장 오래 멈춘 세션 {0} · {1} · {2}',`<b data-user-content>${esc(wk.longest.label)}</b>`,esc(kindName(wk.longest.kind)),esc(D(wk.longest.seconds)))}</div>`:''}`:'<p class="rp-empty">주간 기록을 모으는 중입니다</p>'}</div></div>${foot(v)}</section>`;},
  trend(v,wk,o){const rows=[...v.months,{label:v.label,api:v.api,plan:v.plan||0,now:true}],max=Math.max(v.proj||0,...rows.map(r=>r.api),1)*1.12,W2=440,H=210,pad=20,bw=36,step=(W2-pad*2)/rows.length,yv=x=>H-24-(x/max)*(H-48);
   let svg=`<svg class="rp-svg" viewBox="0 0 ${W2} ${H}" role="img" aria-label="월별 API 환산액과 구독료">`;[0,.5,1].forEach(f=>{const y=yv(max*f/1.12);svg+=`<line x1="${pad}" x2="${W2-pad}" y1="${y}" y2="${y}" class="grid"/>`;});
   rows.forEach((r,i)=>{const cx=pad+step*i+step/2,y=yv(r.api);if(r.now&&v.proj){const yp=yv(v.proj);svg+=`<rect x="${cx-bw/2}" y="${yp}" width="${bw}" height="${y-yp}" rx="4" class="proj"/><text x="${cx}" y="${yp-8}" text-anchor="middle">월말 예상</text>`;}
    svg+=`<rect x="${cx-bw/2}" y="${y}" width="${bw}" height="${H-24-y}" rx="4" class="${r.now?'now':'past'}"/><text x="${cx}" y="${H-6}" text-anchor="middle" class="${r.now?'lab':''}">${esc(r.label)}</text>${r.plan?`<text x="${cx}" y="${y-8}" text-anchor="middle" class="rat">${esc(ratioText(r.api/(r.now&&o.basis==='prorated'?v.cost:r.plan)))}</text>`:''}`;});
   const pts=rows.filter(r=>r.plan);svg+=pts.length?`<polyline class="plan" points="${rows.map((r,i)=>r.plan?`${pad+step*i+step/2},${yv(r.plan)}`:'').filter(Boolean).join(' ')}"/>`:'';svg+='</svg>';
   return `<section class="panel rp rp-trend">${head('본전 추이 · 이번 주','월별 API 환산액과 구독료')}<div class="rp-trend-body"><div class="rp-trend-l"><div class="rp-kpi"><strong>${esc(ratioText(v.ratio))}</strong><span>${esc(F('{0} 지금까지 {1} / 구독료 {2}',v.label,money(v.api),money(v.cost)))}</span></div>${svg}
   <div class="rp-leg"><span><i style="background:var(--green)"></i>API 환산</span><span><i style="background:var(--amber)"></i>구독료</span></div>${v.proj?`<div class="rp-proj">${FH('이 속도면 {0} 말 {1} · {2}배 예상',esc(v.label),`<b>${money(v.proj)}</b>`,times(v.plan?v.proj/v.plan:null))}</div>`:''}</div>
   <div class="rp-trend-r">${wk?`<div class="rp-kpi"><strong>${dur(wk.work)}</strong><span>${FH('이번 주 작업 · 대기 {0}',`<b class="rp-warn">${esc(D(wk.wait))}</b>`)}${esc(weekNote(wk))}</span></div><div class="rp-wkbars">${wk.days.map(d=>{const m=Math.max(36000,...wk.days.map(x=>(x.work||0)+(x.wait||0)));return `<div class="rp-col"><div class="st">${d.work!==null?`<i style="height:${d.work/m*120}px;background:var(--green)"></i><i style="height:${(d.wait||0)/m*120}px;background:var(--amber)"></i>`:''}</div><small>${esc(d.label)}</small></div>`;}).join('')}</div><div class="rp-leg"><span><i style="background:var(--green)"></i>작업 시간</span><span><i style="background:var(--amber)"></i>대기로 멈춤</span></div>`:'<p class="rp-empty">주간 기록을 모으는 중입니다</p>'}</div></div>${foot(v)}</section>`;},
  strip(v,wk,o){const top=o.top;
   return `<section class="rp rp-strip"><div class="rp-strip-row"><div class="rp-it"><small>${esc(F('{0} 본전',v.label))}</small><b>${esc(ratioText(v.ratio))}</b><em>${money(v.api)} / ${money(v.cost)}</em></div>
   <div class="rp-it"><small>이번 주 작업</small><b>${wk?dur(wk.work):'—'}</b><em>세션 합${weekNote(wk||{})}</em></div><div class="rp-it"><small>대기로 멈춤</small><b class="rp-warn">${wk?dur(wk.wait):'—'}</b><em>${wk?.longest?FH('최장 {0} {1}',`<span data-user-content>${esc(wk.longest.label)}</span>`,esc(D(wk.longest.seconds))):''}</em></div>
   ${top?`<div class="rp-it ${top.warn?'rp-alert':''}"><small>${esc(top.label)}</small><b>${top.warn?esc(F('{0} 바닥',when(top.f.end,o.now))):'넉넉함'}</b><em>${esc(top.sub||'')}</em></div>`:''}
   <div class="rp-it rp-it-btns"><button type="button" class="rp-more" data-report-more aria-expanded="${!!o.open}">${o.open?'접기':'자세히'}</button><button type="button" class="rp-btn" data-report-shape>모양</button><button type="button" class="rp-btn" data-report-share>공유 카드</button></div></div>
   <div class="rp-strip-detail" ${o.open?'':'hidden'}><div><h3>${esc(F('{0} 모델별 API 환산',v.label))}</h3><table>${v.models.slice(0,8).map(m=>`<tr><td>${dotk(m.kind)}${esc(m.model)}</td><td>${money(m.api)}</td></tr>`).join('')}<tr><td>${esc(F('구독료 {0}개',v.plans))}</td><td>−${money(v.plan)}</td></tr><tr><td><b>아낀 돈</b></td><td><b class="rp-good">${money(v.saved)}</b></td></tr></table></div>
   <div><h3>이번 주 요일별</h3><table>${wk?wk.days.filter(d=>d.work!==null).map(d=>`<tr><td>${esc(d.label)}</td><td>${(d.work/HOUR).toFixed(1)}h</td><td class="rp-warn">${esc(F('대기 {0}h',((d.wait||0)/HOUR).toFixed(1)))}</td></tr>`).join(''):''}</table></div></div>${foot(v)}</section>`;}
 };
 // The panel for the usage page; nothing when the collector sends no reports yet.
 function panel(state,o={}){
  const s=o.settings||settings();if(s.hidden)return '';
  const v=value(state,s.basis);if(!v)return state?.ready?`<section class="panel rp rp-waiting"><div class="panel-heading"><div><h2>본전 · 이번 주</h2><p>수집기 업데이트 후 표시됩니다</p></div></div></section>`:'';
  return PANELS[s.shape](v,week(state),{...o,basis:s.basis});
 }
 // What each account card adds under its burn rate, in the panel's look.
 function prediction(state,q,o){
  const s=o.settings||settings(),p=sentences(state,q,o.period,o.now,o.label||(x=>kindName(x.kind)));if(!p)return '';
  const f=p.f,alt=p.alt?`<p class="rp-p-alt">${esc(p.alt)}</p>`:'',h5=p.h5?`<p class="rp-p-h5">${p.h5}</p>`:'';
  // An idle account says so in one quiet line in every look; only a limit that runs out first gets the LCD.
  if(f.state==='idle')return `<p class="rp-p-idle">${esc(p.main)}</p>${h5}`;
  if(s.shape==='trip')return p.warn?`<div class="rp-pred rp-pred-trip warn">${lcd(f.hours,{color:'var(--amber)'})}<div><b>${esc(p.main)}</b><span>${esc(p.sub)}</span></div></div>${h5}${alt}`:`<p class="rp-p-ok"><b>${esc(p.main)}</b>${p.sub?' · '+esc(p.sub):''}</p>${h5}`;
  if(s.shape==='receipt')return `<div class="rp-pred rp-pred-list"><p class="${p.warn?'warn':'ok'}">${esc(stop(p.main))}${p.sub?gap()+esc(stop(p.sub)):''}</p>${p.alt?`<p>${esc(stop(p.alt))}</p>`:''}${p.h5?`<p>${p.h5}</p>`:''}</div>`;
  if(s.shape==='big'){const span=f.reset?f.reset-o.now:null,x=f.state==='empty'&&span>0?Math.min(1,(f.end-o.now)/span):1;
   return `<div class="rp-pred rp-pred-line"><div class="tl"><i style="width:${x*100}%"></i>${f.state==='empty'?`<span class="mk" style="left:${Math.min(84,Math.max(16,x*100))}%">${esc(F('바닥 {0}',when(f.end,o.now)))}</span>`:''}<span class="lb">지금</span>${f.reset?`<span class="lb r">${esc(F('초기화 {0}',when(f.reset,o.now)))}</span>`:''}</div><p class="${p.warn?'warn':'ok'}"><b>${esc(p.main)}</b>${p.sub?' · '+esc(p.sub):''}</p>${alt}${h5}</div>`;}
  if(s.shape==='trend'){const w=W.weekly(q),rate=burnOf(state,q,o.period),t0=o.now-6*HOUR,t1=(f.reset||o.now+7*86400)+3*HOUR,X=t=>10+(t-t0)/(t1-t0)*420,Y=v=>96-v/100*86;
   let svg=`<svg class="rp-svg rp-pred-svg" viewBox="0 0 440 110" aria-hidden="true"><line x1="10" x2="430" y1="${Y(100)}" y2="${Y(100)}" class="cap"/><text x="12" y="${Y(100)-5}">100%</text>`;
   if(f.reset)svg+=`<line x1="${X(f.reset)}" x2="${X(f.reset)}" y1="6" y2="96" class="reset"/><text x="${X(f.reset)}" y="108" text-anchor="middle">초기화</text>`;
   svg+=`<polyline class="past" style="stroke:var(--quota-color)" points="${X(t0)},${Y(Math.max(0,w.pct-(rate||0)*6))} ${X(o.now)},${Y(w.pct)}"/>`;
   if(f.state==='empty')svg+=`<line x1="${X(o.now)}" y1="${Y(w.pct)}" x2="${X(f.end)}" y2="${Y(100)}" class="ahead"/><circle cx="${X(f.end)}" cy="${Y(100)}" r="4" class="end"/>`;
   svg+=`<circle cx="${X(o.now)}" cy="${Y(w.pct)}" r="3.5" style="fill:var(--quota-color)"/><text x="${X(o.now)}" y="108" text-anchor="middle">지금</text></svg>`;
   return `<div class="rp-pred rp-pred-chart">${svg}<p class="${p.warn?'warn':'ok'}"><b>${esc(p.main)}</b>${p.sub?' · '+esc(p.sub):''}</p>${alt}${h5}</div>`;}
  return `<div class="rp-pred rp-pred-chip"><span class="chip ${p.warn?'warn':'ok'}">${p.warn?esc(F('{0} 바닥',when(f.end,o.now))):'초기화까지 넉넉함'}</span><p>${esc(stop(p.main))}${p.sub?gap()+esc(stop(p.sub)):''}${p.alt?gap()+esc(stop(p.alt)):''}</p>${h5}</div>`;
 }
 // The account to put on the strip: the one that runs out soonest, else the first with a reading.
 function soonest(state,period,now,label){
  const rows=(state?.account_quotas||[]).map(q=>({q,p:sentences(state,q,period,now,label)})).filter(x=>x.p);
  rows.sort((a,b)=>(a.p.warn?a.p.f.end:Infinity)-(b.p.warn?b.p.f.end:Infinity));
  const r=rows[0];return r?{...r.p,label:label(r.q)}:null;
 }

 // ---------- the share card (1200 × 630) ----------
 const UI='-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI","Malgun Gothic",sans-serif',MONO='ui-monospace,"SF Mono",Menlo,Consolas,monospace';
 function bg(x,c){x.fillStyle=c;x.fillRect(0,0,1200,630);}
 function brand(x,mark,color='#e9ebef',side=false,top=false){const X=side?72:1200-72-268,Y=top?40:630-92;if(mark?.complete&&mark.naturalWidth)x.drawImage(mark,X,Y,52,52);x.fillStyle=color;x.font='650 50px "1top Wordmark",'+UI;x.fillText('1top',X+62,Y+43);x.fillStyle='#9ba1ad';x.font='600 28px '+UI;x.fillText('1top.si',X+200,Y+40);}
 function kindsRow(x,v,X,Y){let cx=X;v.kinds.filter(k=>valid(k.ratio)).slice(0,3).forEach(k=>{x.fillStyle=COLORS[k.kind]||'#8d9ba8';x.beginPath();x.arc(cx+12,Y-12,12,0,Math.PI*2);x.fill();x.fillStyle='#c9ced6';x.font='700 34px '+UI;const t=F('{0} {1}배',k.name.replace(' Code',''),times(k.ratio));x.fillText(t,cx+34,Y);cx+=x.measureText(t).width+76;});}
 function hbar(x,X,Y,w,f,col,l,val){x.fillStyle='#9ba1ad';x.font='700 30px '+UI;x.fillText(l,X,Y+30);x.fillStyle='#22262d';x.beginPath();x.roundRect(X+160,Y,w,40,8);x.fill();x.fillStyle=col;x.beginPath();x.roundRect(X+160,Y,Math.max(10,w*f),40,8);x.fill();x.fillStyle='#e9ebef';x.font='800 34px '+UI;x.fillText(val,X+180+w,Y+32);}
 function dash(x,a,y,b){x.strokeStyle='#a39d8f';x.setLineDash([6,6]);x.lineWidth=2;x.beginPath();x.moveTo(a,y);x.lineTo(b,y);x.stroke();x.setLineDash([]);}
 function lcdSVG(v,color){const s=v.toFixed(1),g={c:[...s.replace('.','')],u:'',dp:s.indexOf('.')-1,center1:true},h=40,w=h*.55,gap=h*.15,n=g.c.length,W2=Math.ceil((n-1)*(w+gap)+w+h*.115*1.2+h*Math.tan(9*Math.PI/180)+8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W2}" height="${h+4}" viewBox="0 -2 ${W2} ${h+4}"><defs><filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><style>.fs-off{display:none}.fs-digit{fill:${color}}.fs-glow{filter:url(#g)}</style>${S.seg7(g,W2/2,h,w,h,h*.115,gap,false)}</svg>`;}
 const L=s=>T(s);
 const CARDS={
  async trip(x,v,wk,o){bg(x,'#07090a');x.strokeStyle='rgba(255,255,255,.04)';for(let i=0;i<1200;i+=40){x.beginPath();x.moveTo(i,0);x.lineTo(i,630);x.stroke();}for(let j=0;j<630;j+=40){x.beginPath();x.moveTo(0,j);x.lineTo(1200,j);x.stroke();}
   x.fillStyle='#9ba1ad';x.font='600 40px '+UI;x.fillText(F('{0} AI 코딩 연비',v.label),72,104);
   const img=await svgImage(lcdSVG(valid(v.ratio)?v.ratio:0,'#9dff3c')),k=4.6,w=img.width*k;x.drawImage(img,60,126,w,img.height*k);
   x.fillStyle='#9dff3c';x.font='italic 800 92px '+UI;x.fillText(L('배'),84+w,320);
   x.fillStyle='#e9ebef';x.font='700 44px '+UI;x.fillText(F('구독료 {0} → API 가격 {1}',money(v.cost),money(v.api)),72,430);
   x.fillStyle='#82cba7';x.fillText(F('아낀 돈 {0}','+'+money(Math.max(0,v.saved||0))),72,494);kindsRow(x,v,72,556);brand(x,o.mark,'#e9ebef',false,true);},
  async receipt(x,v,wk,o){bg(x,'#1a1c20');const L0=470,Wd=660;
   x.fillStyle='#9ba1ad';x.font='600 34px '+UI;x.fillText(F('{0} AI 코딩 영수증',v.label),72,140);x.fillStyle='#e9ebef';x.font='800 120px '+UI;x.fillText(times(v.ratio),66,280);const bw0=x.measureText(times(v.ratio)).width;x.font='800 54px '+UI;x.fillStyle='#9ba1ad';x.fillText(L('배'),80+bw0,280);
   x.fillStyle='#82cba7';x.font='700 38px '+UI;x.fillText(F('아낀 돈 {0}',money(v.saved)),72,350);x.fillStyle='#c9ced6';x.font='600 30px '+UI;x.fillText(F('구독료 {0}',money(v.plan)),72,402);
   x.save();x.translate(L0,18);x.fillStyle='#f4f1e8';x.fillRect(0,0,Wd,580);x.fillStyle='#1a1c20';for(let i=0;i<Wd/14;i++){x.beginPath();x.arc(7+i*14,580,6,0,Math.PI*2);x.fill();}
   x.fillStyle='#1d1c19';x.textAlign='center';x.font='800 36px '+MONO;x.fillText('1TOP RECEIPT',Wd/2,60);x.font='24px '+MONO;x.fillStyle='#6c675c';x.fillText(F('{0} · API 가격 기준',v.label),Wd/2,96);x.textAlign='left';
   let y=146;const line=(l,r,big)=>{x.font=(big?'800 32px ':'25px ')+MONO;x.fillStyle='#1d1c19';x.fillText(l,40,y);x.textAlign='right';x.fillText(r,Wd-40,y);const rw=x.measureText(r).width;x.textAlign='left';const a=40+x.measureText(l).width+10,b=Wd-40-rw-10;
    if(b>a){x.strokeStyle='#a39d8f';x.setLineDash([2,6]);x.lineWidth=2;x.beginPath();x.moveTo(a,y-8);x.lineTo(b,y-8);x.stroke();x.setLineDash([]);}y+=big?52:40;};
   v.models.slice(0,6).forEach(m=>line(m.model,money(m.api)));dash(x,40,y-24,Wd-40);y+=6;line(L('API 가격 합계'),money(v.api));line(F('구독료 {0}개',v.plans),'−'+money(v.plan));dash(x,40,y-24,Wd-40);y+=10;line(L('아낀 돈'),money(v.saved),true);
   x.save();x.translate(Wd-170,Math.min(530,y+18));x.rotate(-.12);x.strokeStyle='#c2412d';x.lineWidth=5;x.strokeRect(-140,-40,280,70);x.fillStyle='#c2412d';x.font='800 40px '+MONO;x.textAlign='center';x.fillText(F('본전 {0}배',times(v.ratio)),0,10);x.restore();
   x.restore();brand(x,o.mark,'#e9ebef',true);},
  async big(x,v,wk,o){const gr=x.createLinearGradient(0,0,1200,630);gr.addColorStop(0,'#101318');gr.addColorStop(1,'#16211b');x.fillStyle=gr;x.fillRect(0,0,1200,630);
   x.fillStyle='#9ba1ad';x.font='600 40px '+UI;x.fillText(F('{0} · 구독 본전',v.label),72,100);
   x.fillStyle='#e9ebef';x.font='800 236px '+UI;const t=times(v.ratio);x.fillText(t,60,318);const tw=x.measureText(t).width;x.font='800 96px '+UI;x.fillStyle='#9ba1ad';x.fillText(L('배'),84+tw,318);
   x.fillStyle='#e9ebef';x.font='700 42px '+UI;x.fillText(F('구독료 {0} → API 가격 {1}',money(v.cost),money(v.api)),72,404);
   const top=Math.max(v.api,v.cost||0)||1;hbar(x,72,452,640,(v.cost||0)/top,'#5a6270',L('구독료'),money(v.cost));hbar(x,72,512,640,v.api/top,'#82cba7',L('API 환산'),money(v.api));brand(x,o.mark,'#e9ebef',false,true);},
  async trend(x,v,wk,o){bg(x,'#101114');x.fillStyle='#e9ebef';x.font='800 58px '+UI;x.fillText(F('{0} 본전 {1}배',v.label,times(v.ratio)),72,104);
   x.fillStyle='#9ba1ad';x.font='600 32px '+UI;x.fillText(F('API 가격 {0} · 구독료 {1}',money(v.api),money(v.cost))+(v.proj?' · '+F('월말 예상 {0}',money(v.proj)):''),72,152);
   const rows=[...v.months,{label:v.label,api:v.api,plan:v.plan||0,now:true}],max=Math.max(v.proj||0,...rows.map(r=>r.api),1)*1.08,H0=530,HH=300,st=Math.min(160,980/rows.length);
   rows.forEach((r,i)=>{const cx=72+st*i+st/2,h=r.api/max*HH;if(r.now&&v.proj){const hp=v.proj/max*HH;x.setLineDash([10,8]);x.strokeStyle='#82cba7';x.lineWidth=3;x.strokeRect(cx-46,H0-hp,92,hp);x.setLineDash([]);}
    x.fillStyle=r.now?'#82cba7':'#3d6b57';x.beginPath();x.roundRect(cx-46,H0-h,92,Math.max(2,h),[10,10,0,0]);x.fill();x.textAlign='center';x.fillStyle=r.now?'#e9ebef':'#9ba1ad';x.font='700 30px '+UI;x.fillText(r.label,cx,H0+42);
    if(r.plan){x.fillStyle='#9dff3c';x.font='800 30px '+UI;x.fillText(ratioText(r.api/(r.now?v.cost||r.plan:r.plan)),cx,H0-h-16);}x.textAlign='left';});
   brand(x,o.mark,'#e9ebef',false,true);},
  async strip(x,v,wk,o){bg(x,'#0d0e11');x.fillStyle='#9ba1ad';x.font='600 40px '+UI;x.fillText(F('{0}, 1top으로 본 내 AI 코딩',v.label),72,128);
   x.fillStyle='#e9ebef';x.font='800 118px '+UI;x.fillText(F('구독료의 {0}배',times(v.ratio)),66,276);
   x.font='700 44px '+UI;x.fillStyle='#c9ced6';x.fillText(F('API 가격으로 {0}어치',money(v.api)),72,360);if(wk)x.fillText(F('이번 주 에이전트 작업 {0}',D(wk.work)),72,420);
   kindsRow(x,v,72,506);brand(x,o.mark);}
 };
 function svgImage(svg){return new Promise((ok,no)=>{const img=new Image();img.onload=()=>ok(img);img.onerror=no;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});}
 let markImage=null;
 function mark(src){if(!src)return Promise.resolve(null);if(markImage?.src.endsWith(src))return Promise.resolve(markImage);return new Promise(ok=>{const img=new Image();img.onload=()=>{markImage=img;ok(img);};img.onerror=()=>ok(null);img.src=src;});}
 // Draws the chosen card on a 1200 × 630 canvas; resolves false when there is nothing to show.
 async function drawShare(canvas,state,o={}){
  const s=o.settings||settings(),v=value(state,s.basis);if(!v)return false;
  canvas.width=1200;canvas.height=630;const x=canvas.getContext('2d');x.clearRect(0,0,1200,630);
  try{await root.document?.fonts?.load?.('650 50px "1top Wordmark"');}catch{}
  await CARDS[o.shape||s.share](x,v,week(state),{mark:await mark(o.markSrc||root.document?.querySelector('.brand-mark')?.getAttribute('src')||'/brand-mark_v1.1.0.png')});return true;
 }

 // ---------- the settings sheet and the share sheet ----------
 // The customizing look (cluster.css .cz-sheet): from below, or a drawer on the right when wide. The report's own
 // 모양 button and the customizing list open the same sheet.
 let openSheet=null;
 function sheet(cls,html){closeSheet();const d=root.document,s=d.createElement('div');s.className='cz-sheet rp-sheet '+cls+((root.innerWidth||0)>=760?' wide':'');s.setAttribute('role','dialog');s.innerHTML=html;d.body.append(s);openSheet=s;
  root.requestAnimationFrame(()=>s.classList.add('up'));s.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closeSheet();}});return s;}
 function closeSheet(){if(!openSheet)return;const s=openSheet;openSheet=null;s.classList.remove('up');setTimeout(()=>s.remove(),320);}
 function inert(html){const t=root.document.createElement('template');t.innerHTML=html;t.content.querySelectorAll('button,a,[tabindex]').forEach(el=>el.setAttribute('tabindex','-1'));t.content.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));return t.innerHTML;}
 const tabsBar=(on,local)=>`<div class="cz-mini rp-tabs" role="tablist">${[['shape','리포트 모양'],['share','공유 카드'],...(local?[['plans','요금제']]:[]),['more',local?'기준·알림':'기준·보이기']].map(([k,l])=>`<button type="button" role="tab" data-rp-tab="${k}" aria-pressed="${on===k}">${esc(T(l))}</button>`).join('')}</div>`;
 // o: {state, now, period, label, onChange(settings)}
 function openSettings(o,tab='shape'){
  const s=settings(),v=value(o.state,s.basis),wk=week(o.state);
  let body='';
  if(tab==='shape')body=`<div class="cz-cards rp-cards">${SHAPES.map(k=>`<div role="button" tabindex="0" class="cz-card${s.shape===k?' on':''}" data-rp-shape="${k}" aria-pressed="${s.shape===k}"><div class="cz-prev rp-prev" inert aria-hidden="true"><div class="rp-prevbox report-slot">${v?inert(PANELS[k](v,wk,{...o,basis:s.basis})):''}</div></div><b>${esc(T(NAMES[k]))}${k===DEFAULTS.shape?' · '+esc(T('기본')):''}</b></div>`).join('')}</div>`;
  else if(tab==='share')body=`<div class="cz-cards rp-cards">${SHAPES.map(k=>`<div role="button" tabindex="0" class="cz-card${s.share===k?' on':''}" data-rp-share="${k}" aria-pressed="${s.share===k}"><canvas class="rp-thumb" width="1200" height="630" data-rp-thumb="${k}" aria-hidden="true"></canvas><b>${esc(T(NAMES[k]))}${k===DEFAULTS.share?' · '+esc(T('기본')):''}</b></div>`).join('')}</div>`;
  else body=`<div class="cz-rows"><div class="cz-row cz-orow"><b>${esc(T('본전 배수 기준'))}</b><div class="cz-mini">${[['month','구독료 전체'],['prorated','지난 날짜만큼']].map(([k,l])=>`<button type="button" data-rp-basis="${k}" aria-pressed="${s.basis===k}">${esc(T(l))}</button>`).join('')}</div></div>
   <p class="rp-help">${esc(T(s.basis==='month'?'이번 달 구독료 전체와 비교합니다. 달 초에는 작게 시작해 월말에 커집니다.':'지난 날짜만큼 나눈 구독료와 비교합니다. 달 초에도 지난달과 같은 크기로 비교됩니다.'))}</p>
   <div class="cz-row cz-orow"><b>${esc(T('사용량 화면에 보이기'))}</b><button type="button" class="cz-sw" role="switch" data-rp-hidden aria-checked="${!s.hidden}" aria-label="${esc(T('보이기'))}"></button></div></div>
   <button type="button" class="cz-reset" data-rp-reset>${esc(T('기본값으로 되돌리기'))}</button>`;
  // The plans and the notices live in this computer's collector, so only its own dashboard changes them.
  const local=!!o.post;
  if(tab==='plans')body=`<div class="cz-rows">${(o.state?.reports?.value?.plans||[]).map(p=>`<div class="cz-row cz-orow rp-plan" data-account="${esc(p.account_id)}"><b>${esc(p.label||kindName(p.kind))}<small>${esc(T(p.source==='user'?'직접 고침':p.source==='detected'?'계정에서 읽음':'확인 필요'))}</small></b><label class="rp-price">$<input type="number" min="0" max="10000" step="1" inputmode="decimal" value="${valid(p.price)?p.price:''}" placeholder="${esc(T('모름'))}" aria-label="${esc(T('월 가격(달러)'))}"></label></div>`).join('')||`<p class="rp-help">${esc(T('연결된 구독 계정이 없습니다.'))}</p>`}
   <p class="rp-help">${esc(T('계정마다 한 달 구독료를 달러로 적습니다. 비우면 계정에서 읽은 값으로 돌아갑니다.'))}</p><div class="rp-share-actions"><button type="button" class="cz-reset" data-rp-plans>${esc(T('저장'))}</button></div><p class="rp-share-note" aria-live="polite"></p></div>`;
  if(tab==='more'&&local){const n=o.state?.notification_settings||{limit:true,weekly:true};body=body.replace('</div>\n   <button type="button" class="cz-reset" data-rp-reset>',`<div class="cz-row cz-orow"><b>${esc(T('한도가 초기화 전에 바닥날 때 알림'))}</b><button type="button" class="cz-sw" role="switch" data-rp-notify="limit" aria-checked="${n.limit!==false}" aria-label="${esc(T('한도 알림'))}"></button></div><div class="cz-row cz-orow"><b>${esc(T('월요일에 지난주 요약 알림'))}</b><button type="button" class="cz-sw" role="switch" data-rp-notify="weekly" aria-checked="${n.weekly!==false}" aria-label="${esc(T('주간 알림'))}"></button></div></div>\n   <button type="button" class="cz-reset" data-rp-reset>`);}
  const el=sheet('cz-gallery rp-settings',`<div class="cz-sh"><b>${esc(T('본전·주간 리포트'))}</b><button type="button" data-rp-close>${esc(T('닫기'))}</button></div>${tabsBar(tab,local)}${body}`);
  if(tab==='share'&&v)el.querySelectorAll('[data-rp-thumb]').forEach(c=>drawShare(c,o.state,{shape:c.dataset.rpThumb,settings:s,markSrc:o.markSrc}));
  const set=patch=>{const next=save({...settings(),...patch});o.onChange?.(next);return next;};
  const pick=b=>{if(b.dataset.rpShape){set({shape:b.dataset.rpShape});}else if(b.dataset.rpShare){set({share:b.dataset.rpShare});}el.querySelectorAll('.cz-card').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});};
  el.onclick=e=>{const b=e.target.closest('button,.cz-card');if(!b)return;
   if('rpClose' in b.dataset)return closeSheet();
   if(b.dataset.rpTab)return openSettings(o,b.dataset.rpTab);
   if(b.dataset.rpBasis){set({basis:b.dataset.rpBasis});return openSettings(o,'more');}
   if('rpHidden' in b.dataset){set({hidden:!settings().hidden});return openSettings(o,'more');}
   if('rpReset' in b.dataset){save(DEFAULTS);o.onChange?.(settings());return openSettings(o,'more');}
   if(b.dataset.rpNotify){const on=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(on));o.post('/api/notifications',{[b.dataset.rpNotify]:on}).then(r=>{if(o.state)o.state.notification_settings=r.settings;}).catch(()=>b.setAttribute('aria-checked',String(!on)));return;}
   if('rpPlans' in b.dataset){const note=el.querySelector('.rp-share-note'),rows=[...el.querySelectorAll('.rp-plan')];
    Promise.all(rows.map(r=>{const p=(o.state?.reports?.value?.plans||[]).find(x=>x.account_id===r.dataset.account),v=r.querySelector('input').value.trim(),price=v===''?null:Number(v);
     if(price!==null&&!(price>=0&&price<=10000))return Promise.reject(Error('price'));
     if(price===(p?.price??null)&&(price!==null||p?.source!=='user'))return null;
     return o.post('/api/reports/plan',price===null?{account_id:r.dataset.account,plan:null,price:null}:{account_id:r.dataset.account,plan:p?.plan||'',price});}))
     .then(()=>{note.textContent=T('저장했습니다. 다음 갱신에 반영됩니다.');o.onChange?.(settings());}).catch(()=>{note.textContent=T('0~10000 사이 숫자로 적어 주세요.');});return;}
   if(b.classList.contains('cz-card'))pick(b);};
  el.onkeydown=e=>{const b=e.target.closest('.cz-card');if(b&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pick(b);}};
  el.querySelector('.cz-card.on')?.scrollIntoView({block:'nearest'});
 }
 // The share sheet: the chosen card, its other looks, then save, copy or share. The image never holds an email,
 // a session name or a path.
 function openShare(o){
  const s=settings();if(!value(o.state,s.basis))return;
  const el=sheet('rp-share-sheet',`<div class="cz-sh"><b>${esc(T('공유 카드'))}</b><button type="button" data-rp-close>${esc(T('닫기'))}</button></div>
   <div class="rp-share-body"><canvas class="rp-share-canvas" width="1200" height="630" role="img" aria-label="${esc(T('공유 카드 미리보기'))}"></canvas>
   <div class="cz-mini rp-share-looks">${SHAPES.map(k=>`<button type="button" data-rp-look="${k}" aria-pressed="${s.share===k}">${esc(T(NAMES[k]))}</button>`).join('')}</div>
   <p class="rp-help">${esc(T('공개 API 단가로 계산한 추정치입니다. 이메일·세션 이름·경로는 넣지 않습니다.'))}</p>
   <div class="rp-share-actions"><button type="button" class="cz-reset" data-rp-save>${esc(T('PNG 저장'))}</button><button type="button" class="cz-reset" data-rp-copy>${esc(T('복사'))}</button>${root.navigator?.canShare?`<button type="button" class="cz-reset" data-rp-send>${esc(T('공유'))}</button>`:''}</div><p class="rp-share-note" aria-live="polite"></p></div>`);
  const c=el.querySelector('canvas'),note=el.querySelector('.rp-share-note');
  const draw=()=>drawShare(c,o.state,{settings:settings(),markSrc:o.markSrc});draw();
  const blob=()=>new Promise(ok=>c.toBlob(ok,'image/png'));
  const name=()=>`1top-${value(o.state,settings().basis)?.month||'report'}.png`;
  el.onclick=async e=>{const b=e.target.closest('button');if(!b)return;
   if('rpClose' in b.dataset)return closeSheet();
   if(b.dataset.rpLook){save({...settings(),share:b.dataset.rpLook});el.querySelectorAll('[data-rp-look]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));o.onChange?.(settings());return draw();}
   try{
    if('rpSave' in b.dataset){const u=URL.createObjectURL(await blob()),a=root.document.createElement('a');a.href=u;a.download=name();root.document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);note.textContent=T('저장했습니다.');}
    if('rpCopy' in b.dataset){await root.navigator.clipboard.write([new root.ClipboardItem({'image/png':blob()})]);note.textContent=T('복사했습니다.');}
    if('rpSend' in b.dataset){const f=new root.File([await blob()],name(),{type:'image/png'});if(root.navigator.canShare({files:[f]}))await root.navigator.share({files:[f]});}
   }catch(err){if(err?.name!=='AbortError')note.textContent=T('이 브라우저에서는 할 수 없습니다. PNG 저장을 써 주세요.');}
  };
 }
 const api={SHAPES,BASES,DEFAULTS,NAMES,KEY,normalize,settings,save,value,week,forecast,alternative,fiveHour,sentences,panel,prediction,soonest,drawShare,openSettings,openShare,closeSheet,money,times};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopReports=api;
})(typeof window==='undefined'?globalThis:window);
