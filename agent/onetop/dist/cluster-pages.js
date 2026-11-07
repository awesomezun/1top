/* Charts and the cluster window's hosted pages, shared by the dashboard (app.js) and the tray and menu bar
   panels (quick.js): both draw the token flow, the usage map, the hour heatmap, goals and computer resources
   with these same functions. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const spans=parts=>parts.filter(Boolean).map(p=>`<span>${esc(p)}</span>`).join('');
 // A working folder by its last name (billing-service); the full path is in its tooltip.
 const folder=p=>String(p||'').split(/[\\/]/).filter(Boolean).pop()||'';
 const pct=n=>n==null?'—':n.toFixed(1)+'%';
 const time=t=>new Date(t*1000).toLocaleTimeString(root.OneTopI18n?.locale()||'ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit'});
 const bytes=n=>n==null?'—':n>=2**30?(n/2**30).toFixed(1)+' GB':n>=2**20?(n/2**20).toFixed(0)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':Math.round(n)+' B';
 // Monday-first weekday labels, per language here: a bare '일' would collide with the day unit in i18n.js.
 const weekdays=()=>({en:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],zh:['一','二','三','四','五','六','日']})[root.OneTopI18n?.language]||['월','화','수','목','금','토','일'];
 function chartStyle(){const css=getComputedStyle(document.documentElement),v=n=>css.getPropertyValue(n).trim();return {font:v('--font')||'-apple-system, BlinkMacSystemFont, sans-serif',caption:v('--type-caption')||'11.5px',tiny:v('--type-tiny')||'10px',line:v('--line'),muted:v('--muted'),dim:v('--dim'),ink:v('--ink'),accent:v('--accent'),panel:v('--panel'),series:[1,2,3,4,5].map(i=>v('--series-'+i)),seriesOther:v('--series-other')};}
 function withAlpha(color,alpha){const c=String(color||'').trim();let m=/^#([0-9a-f]{6})$/i.exec(c);if(m){const n=parseInt(m[1],16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${alpha})`;}m=/^rgba?\(([^)]+)\)$/i.exec(c);if(m){const [r,g,b]=m[1].split(',').map(x=>parseFloat(x));return `rgba(${r},${g},${b},${alpha})`;}return c;}
 function endDot(ctx,x,y,color){ctx.fillStyle=withAlpha(color,.25);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,2.6,0,Math.PI*2);ctx.fill();}
 // Axis numbers keep at most one decimal place.
 function axisNumber(n){const [d,u]=n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];return (Math.round(n/d*10)/10).toLocaleString(OneTopI18n.locale())+u;}
 function canvasBase(target){const canvas=typeof target==='string'?document.getElementById(target):target;if(!canvas?.getBoundingClientRect||canvas.closest('[hidden]'))return null;const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;const dpr=devicePixelRatio||1;canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w:r.width,h:r.height,l:46,t:10,b:24,r:8,style:chartStyle()};}
 // Solid hairline guides, a stronger baseline and right-aligned labels beside the plot.
 function axes(c,max,unit='',ticks=3){const {ctx,w,h,l,t,b,r,style}=c;ctx.font=`${style.caption} ${style.font}`;ctx.textBaseline='middle';ctx.lineWidth=1;for(let i=0;i<ticks;i++){const f=i/(ticks-1),y=Math.round(t+(h-t-b)*f)+.5,base=i===ticks-1;ctx.strokeStyle=style.line;ctx.globalAlpha=base?1:.6;ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(w-r,y);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=style.dim;ctx.textAlign='right';ctx.fillText(axisNumber(max*(1-f))+unit,l-8,y);}ctx.textBaseline='alphabetic';}
 function timeLabels(c,start,end,count){const {ctx,w,h,l,r,style}=c;ctx.font=`${style.caption} ${style.font}`;ctx.fillStyle=style.dim;for(let i=0;i<count;i++){const at=start+(end-start)*i/(count-1);ctx.textAlign=i===0?'left':i===count-1?'right':'center';ctx.fillText(end-start>86400?new Date(at*1000).toLocaleString(OneTopI18n.locale(),{month:'numeric',day:'numeric',...(end-start<=7*86400?{hour:'2-digit',minute:'2-digit',hour12:false}:{}),...(end-start>90*86400?{year:'2-digit'}:{})}):time(at),l+(w-l-r)*i/(count-1),h-6);}}
 function tokenFlowData(events,minutes,updated,range){
  const end=range?.end??(Math.floor((Number.isFinite(updated)?updated:0)/60)*60+60),start=range?.start??(end-minutes*60),step=range?.step??Math.max(minutes>300?900:minutes>60?300:60,Math.ceil(minutes/240)*60),n=Math.max(1,Math.ceil((end-start)/step));
  const reports=events.map(e=>({t:e.t,kind:typeof e.kind==='string'&&e.kind.trim()?e.kind.trim():'unknown',n:e.n??((e.fresh??0)+(e.cached??0)+(e.written??0)+(e.output??0))})).filter(e=>Number.isFinite(e.t)&&e.t>=start&&e.t<end&&Number.isFinite(e.n)&&e.n>=0);
  const canonical=['Claude','Codex','GLM','Antigravity','Aside'],rank=k=>canonical.includes(k)?canonical.indexOf(k):canonical.length;
  const series=[...new Set(reports.map(e=>e.kind))].sort((a,b)=>rank(a)-rank(b)||(a<b?-1:a>b?1:0));
  const bins=Array.from({length:n},()=>Object.fromEntries(series.map(k=>[k,0])));
  for(const e of reports)bins[Math.floor((e.t-start)/step)][e.kind]+=e.n;
  const peak=Math.max(0,...bins.map(bin=>Object.values(bin).reduce((a,b)=>a+b,0))),power=peak>0?10**Math.floor(Math.log10(peak)):1;
  const max=peak>0?([1,2,5,10].find(v=>v>=peak/power)||10)*power:1;
  return {start,end,step,series,bins,peak,max};
 }
 // Token flow: stacked bars with rounded tops and a soft vertical fade, the current bin lit,
 // and a dashed line at the period's average bin. A longer period's bins (chart_range) belong to the
 // period charts; the session detail passes none and keeps its last hour.
 function tokenChart(id,events,minutes,range,{updated,colors={}}={}){
  const c=canvasBase(id);if(!c)return;
  const {start,end,series,bins,max}=tokenFlowData(events,minutes,updated,range);axes(c,max,'',3);
  const {ctx,w,h,l,t,b,r,style}=c,pw=w-l-r,ph=h-t-b,base=h-b,step=pw/Math.max(1,bins.length),gap=Math.min(2,step*.28),bw=Math.max(1,step-gap);
  bins.forEach((v,i)=>{
   const total=series.reduce((n,k)=>n+(v[k]||0),0);if(!total)return;
   const x=l+i*step+gap/2,top=base-total/max*ph,now=i===bins.length-1,radius=Math.min(3,bw/2),shape=()=>{ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,top,bw,base-top,[radius,radius,0,0]);else ctx.rect(x,top,bw,base-top);};
   const topKind=[...series].reverse().find(k=>(v[k]||0)>0);
   if(now){ctx.save();ctx.shadowColor=withAlpha(colors[topKind]||style.accent,.7);ctx.shadowBlur=10;shape();ctx.fillStyle=withAlpha(colors[topKind]||style.accent,.35);ctx.fill();ctx.restore();}
   ctx.save();shape();ctx.clip();let y=base;
   for(const k of series){const bh=(v[k]||0)/max*ph;if(bh<=0)continue;const col=colors[k]||'#8b939f',g=ctx.createLinearGradient(0,y-bh,0,y);g.addColorStop(0,withAlpha(col,now?1:.9));g.addColorStop(1,withAlpha(col,now?.8:.55));ctx.fillStyle=g;ctx.fillRect(x,y-bh,bw,bh);y-=bh;}
   ctx.restore();
  });
  const average=bins.reduce((n,v)=>n+series.reduce((m,k)=>m+(v[k]||0),0),0)/Math.max(1,bins.length);
  if(average>0){const y=Math.round(base-average/max*ph)+.5,label=OneTopI18n.t('평균');ctx.strokeStyle=style.accent;ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(w-r,y);ctx.stroke();ctx.setLineDash([]);
   ctx.font=`600 ${style.tiny} ${style.font}`;const tw=ctx.measureText(label).width+10;ctx.fillStyle=withAlpha(style.panel,.9);ctx.beginPath();if(ctx.roundRect)ctx.roundRect(w-r-tw,y-8,tw,16,8);else ctx.rect(w-r-tw,y-8,tw,16);ctx.fill();ctx.fillStyle=style.accent;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,w-r-tw/2,y+.5);ctx.textBaseline='alphabetic';}
  timeLabels(c,start,end,4);
 }
 // CPU and memory over the collector's recent samples, as percents.
 function systemChart(id,hist=[]){
  const c=canvasBase(id);
  if(c){axes(c,100,'%',3);const {ctx,w,h,l,t,b,r,style}=c,start=hist[0]?.t||0,end=hist.at(-1)?.t||start+1,x=v=>l+(v.t-start)/Math.max(1,end-start)*(w-l-r),y=n=>h-b-n/100*(h-t-b);
   for(const [key,color] of [['cpu',style.accent],['memory','#8f98e0']]){
    const segments=[];let run=[];for(const v of hist){if(v[key]==null){if(run.length)segments.push(run);run=[];continue;}run.push(v);}if(run.length)segments.push(run);
    for(const seg of segments){const trace=()=>seg.forEach((v,i)=>i?ctx.lineTo(x(v),y(v[key])):ctx.moveTo(x(v),y(v[key])));
     const g=ctx.createLinearGradient(0,t,0,h-b);g.addColorStop(0,withAlpha(color,.22));g.addColorStop(1,withAlpha(color,0));ctx.beginPath();trace();ctx.lineTo(x(seg.at(-1)),h-b);ctx.lineTo(x(seg[0]),h-b);ctx.closePath();ctx.fillStyle=g;ctx.fill();
     ctx.beginPath();trace();ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.lineJoin='round';ctx.stroke();}
    const last=segments.at(-1)?.at(-1);if(last)endDot(ctx,x(last),y(last[key]),color);
   }
   timeLabels(c,start,end,2);}
 }
 function hoursGrid(grid,d,{fmt=String}={}){
  const cells=OneTopHistory.weekHours(d.heatmap?.hours||[]),max=Math.max(0,...cells.flat().filter(Boolean).map(c=>c.value)),dates=(d.heatmap?.hours||[]).map(h=>h[0]).sort();
  grid.innerHTML='<span></span>'+Array.from({length:24},(_,h)=>`<span class="heat-label is-hour">${h%3?'':h}</span>`).join('')+cells.map((row,w)=>`<span class="heat-label is-row" data-user-content>${weekdays()[w]}</span>`+row.map((c,h)=>`<i class="heat-cell${c?'':' is-null'}"${c?` data-level="${OneTopHistory.level(c.value,max)}"`:''} data-w="${w}" data-h="${h}"></i>`).join('')).join('');
  grid.cells=cells;
  const range=dates.length?[dates[0],dates.at(-1)].map(x=>new Date(x+'T00:00:00').toLocaleDateString(OneTopI18n.locale(),{month:'short',day:'numeric'})).join(' – '):'';
  const caption=spans(['최근 30일 하루 평균'])+(range?`<span data-user-content>${esc(range)}</span>`:'');
  let peak=null;cells.forEach((row,w)=>row.forEach((c,h)=>{if(c&&c.value>0&&(!peak||c.value>peak.value))peak={...c,w,h};}));
  const summary=peak?`<span>가장 많이 쓰는 시간</span> <b data-user-content>${esc(weekdays()[peak.w])} ${peak.h}:00</b> · <b>${fmt(peak.value)}</b> tokens`:'';
  return {caption,summary};
 }

 // The last 53 weeks of daily totals, GitHub-style, with month names above; a narrow window shows the newest
 // weeks and scrolls back. Returns its caption and summary.
 function yearGrid(grid,d,{fmt=String}={}){
  const today=new Date(),todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const {weeks,months}=root.OneTopHistory.year(d.heatmap?.days||[],todayKey),values=weeks.flat().filter(c=>typeof c.value==='number'),max=Math.max(0,...values.map(c=>c.value));
  const monthName=m=>new Date(2026,m-1,1).toLocaleDateString((root.OneTopI18n?.locale()||'ko-KR'),{month:'short'});
  grid.innerHTML=`<div class="year-months">${months.map(m=>`<span style="grid-column:${m.week+1}" data-user-content>${esc(monthName(m.month))}</span>`).join('')}</div>`+
   `<div class="year-body"><div class="year-days">${weekdays().map((w,i)=>`<span data-user-content>${i%2?'':esc(w)}</span>`).join('')}</div><div class="year-grid">${weeks.map((col,w)=>col.map((c,i)=>`<i class="heat-cell${c.future?' is-future':c.value===null?' is-null':''}${c.date===todayKey?' is-today':''}"${typeof c.value==='number'?` data-level="${root.OneTopHistory.level(c.value,max)}"`:''} data-i="${w*7+i}"></i>`).join('')).join('')}</div></div>`;
  grid.cells=weeks.flat();
  // Like GitHub, a narrow window shows the newest weeks and scrolls back in time.
  grid.scrollLeft=grid.scrollWidth;
  const first=(d.heatmap?.days||[])[0]?.[0];
  const caption=spans(['최근 1년 날짜별 합계'])+(first?`<span><b data-user-content>${esc(new Date(first+'T00:00:00').toLocaleDateString((root.OneTopI18n?.locale()||'ko-KR'),{year:'numeric',month:'short',day:'numeric'}))}</b> <span>부터 기록</span></span>`:'');
  const sum=values.reduce((n,c)=>n+c.value,0),top=values.reduce((p,c)=>!p||c.value>p.value?c:p,null),used=values.filter(c=>c.value>0).length;
  const summary=values.length?`<span>합계</span> <b>${fmt(sum)}</b> · <span>사용한 날</span> <b>${used}</b> · <span>가장 많이 쓴 날</span> <b data-user-content>${esc(new Date(top.date+'T00:00:00').toLocaleDateString((root.OneTopI18n?.locale()||'ko-KR'),{month:'short',day:'numeric'}))}</b> ${fmt(top.value)}`:'';
  return {caption,summary};
 }
 // A history bin as a label: minutes and hours by the clock, longer steps by date; full for a tooltip.
 function binLabel(t,step,full=false){
  const d=new Date(t*1000),locale=root.OneTopI18n?.locale()||'ko-KR';
  if(['60','300','900'].includes(step))return full?d.toLocaleString(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):time(t);
  if(step==='3600')return d.toLocaleString(locale,{month:full?'short':'numeric',day:'numeric',hour:'2-digit',hour12:false});
  return d.toLocaleDateString(locale,full?{month:'short',day:'numeric',weekday:'short'}:{month:'numeric',day:'numeric'});
 }

 // Stacked areas of the top five models or projects over the history bins, the largest at the bottom with a
 // surface gap between layers; bins outside the record draw nothing and measured zero sits on the baseline. The
 // usage map view and the cluster's token flow page both draw it. store keeps each group's colour slots, so a
 // model or project keeps its colour; hover is a bin index. Returns what hovering needs, or null.
 function trendChart(canvas,legend,d,group,{slots:store={},hover=null,fmt=String}={}){
  const tr=root.OneTopI18n?.t||(x=>x),what=group==='model'?'모델별':'프로젝트별';
  const s=d.series,{shown,other}=root.OneTopHistory.fold(s['by_'+group]||[]),slots=store[group]=root.OneTopHistory.slots(store[group],shown.map(r=>r.key));
  const c=canvasBase(canvas);if(!c)return null;
  const {ctx,w,h,l,t,b,r,style}=c,n=s.bins.length,pw=w-l-r,ph=h-t-b,base=h-b;
  const layers=[...shown].sort((p,q)=>slots[p.key]-slots[q.key]).map(row=>({row,color:style.series[slots[row.key]],name:group==='model'?root.OneTopHistory.modelName(row.key):root.OneTopHistory.projectName(row)}));
  if(other)layers.push({row:other,color:style.seriesOther,name:tr('기타'),folded:other.folded});
  const totals=s.bins.map((_,i)=>s.total[i]==null?null:layers.reduce((sum,L)=>sum+(L.row.tokens[i]||0),0));
  const peak=Math.max(0,...totals.filter(v=>v!=null)),max=root.OneTopHistory.axisMax(peak);
  axes(c,max,'',3);
  const x=i=>l+(i+.5)*pw/n,y=v=>base-v/max*ph,alpha=document.documentElement.dataset.theme==='light'?.32:.4;
  // Outside the record: a quiet hatch, never a zero line.
  ctx.save();ctx.beginPath();ctx.rect(l,t,pw,ph);ctx.clip();ctx.strokeStyle=style.line;ctx.lineWidth=1;
  totals.forEach((v,i)=>{if(v!=null)return;const x0=l+i*pw/n,x1=l+(i+1)*pw/n;for(let k=Math.floor((x0-ph)/6)*6;k<x1;k+=6){ctx.beginPath();ctx.moveTo(Math.max(x0,k),base-Math.max(0,x0-k));ctx.lineTo(Math.min(x1,k+ph),base-Math.min(ph,Math.min(x1,k+ph)-k));ctx.stroke();}});
  ctx.restore();
  const samples=Math.max(1,Math.min(8,Math.round(pw/n/4)));
  for(const [a,z] of root.OneTopHistory.runs(totals)){
   if(a===z){let acc=0;const bw=Math.max(3,pw/n*.6);for(const L of layers){const v=L.row.tokens[a]||0;if(!v)continue;ctx.fillStyle=withAlpha(L.color,alpha);ctx.fillRect(x(a)-bw/2,y(acc+v),bw,y(acc)-y(acc+v));acc+=v;}continue;}
   const sampled=layers.map(L=>root.OneTopHistory.smooth(L.row.tokens.slice(a,z+1).map(v=>v||0),samples)),xs=sampled[0].map(p=>x(a+p.x)),bounds=[xs.map(()=>0)];
   for(const S of sampled)bounds.push(S.map((p,k)=>bounds.at(-1)[k]+p.y));
   layers.forEach((L,j)=>{const lo=bounds[j],hi=bounds[j+1];ctx.beginPath();xs.forEach((X,k)=>k?ctx.lineTo(X,y(hi[k])):ctx.moveTo(X,y(hi[k])));for(let k=xs.length-1;k>=0;k--)ctx.lineTo(xs[k],y(lo[k]));ctx.closePath();ctx.fillStyle=withAlpha(L.color,alpha);ctx.fill();});
   // Translucent layers with each top drawn in its own colour, as in shadcn's stacked area chart.
   ctx.lineWidth=1.5;ctx.lineJoin='round';
   layers.forEach((L,j)=>{ctx.strokeStyle=L.color;ctx.beginPath();xs.forEach((X,k)=>k?ctx.lineTo(X,y(bounds[j+1][k])):ctx.moveTo(X,y(bounds[j+1][k])));ctx.stroke();});
  }
  // Time labels at even spacing, ends aligned to the plot edges.
  ctx.font=`${style.caption} ${style.font}`;ctx.fillStyle=style.dim;
  const count=Math.max(2,Math.min(6,Math.floor(pw/96)));
  for(let k=0;k<count;k++){const i=Math.round(k*(n-1)/(count-1));ctx.textAlign=k===0?'left':k===count-1?'right':'center';ctx.fillText(binLabel(s.bins[i],s.step),k===0?l:k===count-1?w-r:x(i),h-6);}
  if(Number.isInteger(hover)&&hover<n&&totals[hover]!=null){
   const X=Math.round(x(hover))+.5;ctx.strokeStyle=style.ink;ctx.globalAlpha=.35;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X,t);ctx.lineTo(X,base);ctx.stroke();ctx.globalAlpha=1;
   let acc=0;for(const L of layers){const v=L.row.tokens[hover]||0;acc+=v;if(!v)continue;ctx.fillStyle=style.panel;ctx.beginPath();ctx.arc(X,y(acc),6,0,Math.PI*2);ctx.fill();ctx.fillStyle=L.color;ctx.beginPath();ctx.arc(X,y(acc),4,0,Math.PI*2);ctx.fill();}
  }
  const sum=layers.reduce((n,L)=>n+L.row.total,0)||1;
  legend.innerHTML=layers.map(L=>`<span class="history-legend-item"><i style="background:${esc(L.color)}"></i><span data-user-content>${esc(L.name)}${L.folded?` +${L.folded}`:''}</span><b>${fmt(L.row.total)}</b><small>${(L.row.total/sum*100).toFixed(1)}%</small></span>`).join('');
  canvas.setAttribute('aria-label',`${tr(what+' 사용량 추이')} · ${layers.map(L=>`${L.name} ${fmt(L.row.total)}`).join(', ')}`);
  return {l,pw,n,layers,bins:s.bins,step:s.step,totals};
 }
 // GET /api/history for a period (and a tool), as the usage map view reads it: "All" spans the whole record
 // and falls back to weekly bins past 400 days. Resolves to {data,error}; error is missing, remote or failed.
 async function fetchHistory(period,seconds,kind){
  try{
   for(const step of period==='all'?['day','week']:[root.OneTopHistory.step(seconds||3600)]){
    const query=new URLSearchParams({period,step});if(kind&&kind!=='all')query.set('kind',kind);
    const response=await fetch('/api/history?'+query,{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.status===400&&step==='day')continue;
    if(response.status===404)return {data:null,error:'missing'};
    // The 1top.si remote workspace answers 501: these records stay on each computer for now.
    if(response.status===501)return {data:null,error:'remote'};
    if(!response.ok)throw new Error(String(response.status));
    return {data:await response.json(),error:''};
   }
  }catch{}
  return {data:null,error:'failed'};
 }
 function historyMessage(error,data,what){
  const t=root.OneTopI18n?.t||(s=>s);
  if(error==='missing')return [t('수집기 업데이트 후 표시됩니다'),t(what+' 기록은 새 수집기가 제공합니다.')];
  if(error==='failed')return [t('기록을 불러오지 못했습니다'),t('1분 뒤 다시 시도합니다.')];
  if(error==='remote')return [t('원격 워크스페이스에서는 아직 지원하지 않습니다'),t(what+' 기록은 각 컴퓨터의 1top 앱에서 볼 수 있습니다.')];
  return data?null:[t('기록을 불러오고 있습니다'),''];
 }
 // The cluster window's hosted pages. env: state, sessions, period, caption, group (usage map grouping), fmt,
 // open(id), history: {load(), message(), data()}.
 function drawPage(page,el,env){
  if(!el)return;const head=el.querySelector('.cl-pane-h'),fmt=env.fmt,data=env.state;
  if(page==='map'){
   const r=root.OneTopMaps.usage(env.sessions,env.period,env.group||'session','ko',env.byModel);
   head.innerHTML=`<b>${fmt(r.total)}</b> <span>tokens</span> · <span>${esc(env.caption)}</span>`;
   root.OneTopMaps.draw(el.querySelector('.cl-map'),r.items,{activate:item=>{if(item&&(env.group||'session')==='session')env.open?.(item.id);}});
  }else if(page==='heat'){
   // Both heatmaps of the usage map view: weekday × hour, then the last year day by day.
   env.history.load();const message=env.history.message('히트맵'),hours=el.querySelector('.cl-heat'),year=el.querySelector('.cl-year'),yearHead=el.querySelector('.cl-year-h');
   if(message){hours.hidden=year.hidden=true;yearHead.innerHTML='';head.innerHTML=esc(message[0]);return;}
   hours.hidden=year.hidden=false;const d=env.history.data(),a=hoursGrid(hours,d,{fmt}),b=yearGrid(year,d,{fmt});head.innerHTML=a.summary||a.caption;yearHead.innerHTML=b.summary||b.caption;
   // The year scrolls to its newest weeks; a month name cut by the left edge stays hidden until it is whole.
   const months=()=>{const left=year.getBoundingClientRect().left+24;year.querySelectorAll('.year-months span').forEach(m=>m.style.visibility=m.getBoundingClientRect().left<left?'hidden':'');};
   months();year.onscroll=months;
  }else if(page==='flow'){
   // The token flow page by project: the usage map view's project trend over the same period.
   env.history.load();const message=env.history.message('프로젝트별'),box=el.querySelector('.cl-trend'),legend=el.querySelector('.cl-trend-legend'),empty=el.querySelector('.cl-trend-empty');
   if(message){box.hidden=true;legend.innerHTML='';empty.hidden=false;empty.innerHTML=esc(message[0]);return;}
   empty.hidden=true;box.hidden=false;trendChart(box.querySelector('canvas'),legend,env.history.data(),'project',{slots:env.slots,fmt});
  }else if(page==='goals'){
   const o=data.operations,labels={active:'활성',complete:'완료',paused:'일시정지',blocked:'차단됨',cleared:'해제됨',failed:'달성 불가',budget_limit:'예산 한도',usage_limit:'사용 한도'};
   const goals=[...(o?.goals||[])].sort((a,b)=>(b.status==='active')-(a.status==='active')),loops=o?.schedules||[];
   el.querySelector('.cl-goals').innerHTML=(goals.map(g=>`<div class="cl-goal" data-status="${esc(g.status)}"><span class="status ${g.status==='active'?'working':''}">${esc(labels[g.status]||g.status)}</span><b data-user-content>${esc(g.objective)}</b><small><span>${esc(g.runtime)}</span> · <span data-user-content title="${esc(g.location)}">${esc(folder(g.location))}</span> · <b>${fmt(g.tokens_used)}</b> tokens</small></div>`).join('')
    +loops.map(l=>`<div class="cl-goal"><span class="status">LOOP</span><b data-user-content>${esc(l.name)}</b><small><span>${esc(l.runtime||'Claude Code')}</span>${l.location?` · <span data-user-content title="${esc(l.location)}">${esc(folder(l.location))}</span>`:''}</small></div>`).join(''))
    ||`<div class="cl-empty">${o?.goal_source_status==='reported'?'저장된 Goal과 예약이 없습니다.':'Goal 기록을 확인하고 있습니다.'}</div>`;
  }else if(page==='system'){
   const h=data.system?.host,top=data.system?.top||[];
   // The heading names both lines in their colours, so it is the chart's legend too.
   head.innerHTML=h?`<span class="cl-key" style="--k:var(--accent)">CPU</span> <b>${pct(h.cpu)}</b> · <span class="cl-key" style="--k:#8f98e0">메모리</span> <b>${pct(h.memory?.percent??null)}</b>`:'';
   systemChart(el.querySelector('canvas'),data.system?.history||[]);
   el.querySelector('.cl-procs').innerHTML=(top.length?'<div class="cl-proc cl-proc-h"><span>앱</span><b>CPU</b><small>메모리</small></div>':'')+top.slice(0,4).map(p=>`<div class="cl-proc"><span data-user-content>${esc(p.name)}</span><b>${pct(p.cpu)}</b><small>${bytes(p.rss)}</small></div>`).join('');
  }
 }
 root.OneTopCharts={chartStyle,withAlpha,endDot,canvasBase,axes,timeLabels,tokenFlowData,tokenChart,systemChart};
 root.OneTopClusterPages={drawPage,hoursGrid,yearGrid,trendChart,binLabel,weekdays,fetchHistory,historyMessage};
})(typeof globalThis!=='undefined'?globalThis:this);
