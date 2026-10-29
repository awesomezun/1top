// Remote cockpit: the same instruments as the Mac menu bar quick view and the phone apps.
// The period picker governs every number below it. Data comes from relay snapshots.
const SECONDS={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
const KEYS=['10m','30m','1h','5h','12h','24h'];
const ORDER=['Claude','Codex','GLM','Antigravity','Aside'];
export const TOOL_COLORS={Claude:'#d4956b',Codex:'#3fae8c',GLM:'#8f98e0',Antigravity:'#619db9',Aside:'#a99bdb'};
const color=k=>TOOL_COLORS[k]||'#8b939f';
const rank=k=>{const i=ORDER.indexOf(k);return i<0?99:i;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const total=v=>Array.isArray(v)&&v.length&&v.every(valid)?v.reduce((a,b)=>a+b,0):null;
export const toolName=k=>k==='Claude'?'Claude Code':k==='Antigravity'?'Agy CLI':k;
/** 158M, 7.5M, 0. Unknown stays a dash, never zero. */
export function short(n){if(!valid(n))return '—';if(n<.5)return '0';const [d,u]=n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];const x=n/d;return (x>=10?String(Math.round(x)):String(Number(x.toFixed(1))))+u;}
export function pct(n){if(!valid(n))return '—';if(n===0)return '0%';if(n<.05)return '<0.1%';const t=Math.round(n*10)/10;return (Number.isInteger(t)?String(t):t.toFixed(1))+'%';}
const shortModel=s=>{let m=String(s.model||'').trim();if(!m)return toolName(s.kind);m=m.replace(/\[1m\]/ig,'');if(/^claude-/i.test(m))m=m.slice(7);if(/^gpt-/i.test(m))m='GPT-'+m.slice(4);return m;};

/** Working sessions first, then every other session together, each by selected-period tokens. */
export function orderSessions(rows,period){
 return [...rows].sort((a,b)=>Number(b.status==='working')-Number(a.status==='working')||(total(b.windows?.[period])??-1)-(total(a.windows?.[period])??-1)||String(a.id).localeCompare(String(b.id)));
}

/** Bins for the radar, newest first: the collector's flow when every computer sends it, else the
 *  nested period totals (for the last hour: the last 10 minutes, 10–30 and 30–60 minutes ago). */
export function reading(devices,rows,period,filter=null){
 // A tool or app filter narrows the reading to those sessions: computer-wide period totals no longer
 // apply, a tool keeps the fine bins but only its own share, and an app (not in the bins) uses the
 // nested period totals of the matching sessions.
 const seconds=SECONDS[period],periodTotals=filter?.tool||filter?.app?[]:devices.map(d=>(d.snapshot.periods||[]).find(p=>p.key===period)).filter(Boolean);
 const sums=rows.map(r=>total(r.windows?.[period])).filter(valid);
 const tokens=periodTotals.length?periodTotals.reduce((n,p)=>n+(total(p.tokens)||0),0):sums.length?sums.reduce((a,b)=>a+b,0):null;
 const average=tokens===null?null:tokens/seconds*3600;
 // Several computers line up on real time (bin i covers start+i*step), not position: they report at
 // different moments. The axis ends where every one has reported; a bin one of them lacks stays unknown.
 const flows=filter?.app?[]:devices.map(d=>d.snapshot.flow?.[period]).filter(f=>f&&Array.isArray(f.bins)&&f.step>0);
 if(flows.length&&flows.length===devices.length&&flows.every(f=>f.step===flows[0].step)&&(flows.length===1||flows.every(f=>valid(f.start)))){
  const step=flows[0].step,n=Math.max(...flows.map(f=>f.bins.length)),end=flows.length>1?Math.min(...flows.map(f=>valid(f.end)?f.end:f.start+f.bins.length*step)):null,bins=[];
  for(let i=0;i<n;i++){const by={};let known=true;
   for(const f of flows){const j=end===null?f.bins.length-1-i:Math.round((end-(i+1)*step-f.start)/step),v=j>=0&&j<f.bins.length?f.bins[j]:null;if(!v){known=false;break;}for(const [k,x] of Object.entries(v))if(valid(x)&&(!filter?.tool||k===filter.tool))by[k]=(by[k]||0)+x;}
   const parts=known?Object.entries(by).sort((a,b)=>rank(a[0])-rank(b[0])).map(([k,x])=>[k,x/step*3600]):[];bins.push({start:i*step,end:Math.min(seconds,(i+1)*step),parts,total:known?parts.reduce((s,p)=>s+p[1],0):null});}
  return {average,bins};
 }
 const edges=[[0,null],...KEYS.filter(k=>SECONDS[k]<seconds).map(k=>[SECONDS[k],k]),[seconds,period]];
 const kinds=[...new Set(rows.map(r=>r.kind))].sort((a,b)=>rank(a)-rank(b)),within=(r,k)=>k?(total(r.windows?.[k])??0):0;
 const bins=edges.slice(1).map(([b,kb],i)=>{const [a,ka]=edges[i];const parts=kinds.map(k=>[k,rows.filter(r=>r.kind===k).reduce((s,r)=>s+Math.max(0,within(r,kb)-within(r,ka)),0)/(b-a)*3600]);return {start:a,end:b,parts,total:parts.reduce((s,p)=>s+p[1],0)};});
 return {average,bins};
}

const P=(cx,cy,r,a)=>[cx+r*Math.cos(a*Math.PI/180),cy+r*Math.sin(a*Math.PI/180)];
const f2=n=>Math.round(n*100)/100;
function sector(cx,cy,r0,r1,a0,a1){const [x0,y0]=P(cx,cy,r1,a0),[x1,y1]=P(cx,cy,r1,a1),[x2,y2]=P(cx,cy,r0,a1),[x3,y3]=P(cx,cy,r0,a0),l=a1-a0>180?1:0;
 return `M${f2(x0)} ${f2(y0)}A${f2(r1)} ${f2(r1)} 0 ${l} 1 ${f2(x1)} ${f2(y1)}L${f2(x2)} ${f2(y2)}A${f2(r0)} ${f2(r0)} 0 ${l} 0 ${f2(x3)} ${f2(y3)}Z`;}
function arc(cx,cy,r,a0,a1){const [x0,y0]=P(cx,cy,r,a0),[x1,y1]=P(cx,cy,r,a1);return `M${f2(x0)} ${f2(y0)}A${f2(r)} ${f2(r)} 0 ${a1-a0>180?1:0} 1 ${f2(x1)} ${f2(y1)}`;}

/** Seven-segment digits: whole numbers on three places with the unit letter. */
function digits(value,h){
 const lit={'0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgedc','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',' ':''};
 let text='---',unit='';if(valid(value)){if(value<.5)text='  0';else{const [d,u]=value>=1e9?[1e9,'B']:value>=1e6?[1e6,'M']:value>=1e3?[1e3,'k']:[1,''];text=String(Math.min(999,Math.round(value/d))).padStart(3,' ');unit=u;}}
 const w=h*.55,gap=h*.15,ht=h*.0575,g=h*.031,slant=Math.tan(9*Math.PI/180),skew=h*slant,unitSize=h*.46,width=3*w+2*gap+(unit?gap+unitSize*.82:0)+skew;
 const hz=(y,x0,x1)=>`${f2(x0)},${f2(y)} ${f2(x0+ht)},${f2(y-ht)} ${f2(x1-ht)},${f2(y-ht)} ${f2(x1)},${f2(y)} ${f2(x1-ht)},${f2(y+ht)} ${f2(x0+ht)},${f2(y+ht)}`;
 const vt=(x,y0,y1)=>`${f2(x)},${f2(y0)} ${f2(x+ht)},${f2(y0+ht)} ${f2(x+ht)},${f2(y1-ht)} ${f2(x)},${f2(y1)} ${f2(x-ht)},${f2(y1-ht)} ${f2(x-ht)},${f2(y0+ht)}`;
 const seg={a:hz(ht,ht+g,w-ht-g),g:hz(h/2,ht+g,w-ht-g),d:hz(h-ht,ht+g,w-ht-g),f:vt(ht,ht+g,h/2-g),b:vt(w-ht,ht+g,h/2-g),e:vt(ht,h/2+g,h-ht-g),c:vt(w-ht,h/2+g,h-ht-g)};
 const polys=[...text].map((ch,i)=>[...'abcdefg'].map(k=>`<polygon points="${seg[k]}" class="${(lit[ch]||'').includes(k)?(valid(value)?'seg-on':'seg-dim'):'seg-off'}" transform="translate(${f2(i*(w+gap))} 0)"/>`).join('')).join('');
 return `<svg class="seg7" viewBox="0 0 ${f2(width)} ${f2(h)}" width="${f2(width)}" height="${f2(h)}" aria-hidden="true"><g transform="matrix(1 0 ${f2(-slant)} 1 ${f2(skew)} 0)">${polys}</g>${unit?`<text x="${f2(3*w+3*gap)}" y="${f2(h)}" class="seg-unit" font-size="${f2(unitSize)}">${unit}</text>`:''}</svg>`;
}

/** The scope's data layer: rings, bins by age (newest just right of ▼, older clockwise), average. */
function scopeData(data,period){
 const c=110,outer=103,inner=outer*.6,opening=12,end=270-opening,span=360-opening,seconds=SECONDS[period];
 const scale=Math.max(data.average??0,...data.bins.map(b=>b.total))*1.06,rr=v=>inner+(outer-inner)*(scale>0?Math.min(1,v/scale):0);
 let s=Array.from({length:12},(_,k)=>{const [x0,y0]=P(c,c,inner,-90+30*k),[x1,y1]=P(c,c,outer,-90+30*k);return `<line x1="${f2(x0)}" y1="${f2(y0)}" x2="${f2(x1)}" y2="${f2(y1)}" class="scope-spoke"/>`;}).join('');
 s+=[.25,.5,.75,1].map(f=>`<path d="${arc(c,c,inner+(outer-inner)*f,-90,end)}" class="scope-ring${f===1?' outer':''}"/>`).join('');
 s+=`<line x1="${c}" y1="${f2(c-inner)}" x2="${c}" y2="${f2(c-outer)}" class="scope-now-line"/>`;
 data.bins.forEach((bin,i)=>{if(!(bin.total>0))return;const a0=-90+bin.start/seconds*span+.6,a1=-90+bin.end/seconds*span-.6,age=data.bins.length>1?i/(data.bins.length-1):0,opacity=i===0?1:.9-.58*age;let r0=inner+1,acc=0;
  for(const [k,v] of bin.parts){if(!(v>0))continue;acc+=v;const r1=rr(acc);if(r1<=r0+.3)continue;s+=`<path d="${sector(c,c,r0,r1,a0,a1)}" fill="${color(k)}" opacity="${f2(opacity)}"/>`;r0=r1;}
  if(i===0&&r0>inner+1)s+=`<path d="${sector(c,c,inner+1,r0,a0,a1)}" class="scope-newest"/>`;});
 if(valid(data.average)&&data.average>0)s+=`<path d="${arc(c,c,rr(data.average),-90,end)}" class="scope-average"/>`;
 s+=`<circle cx="${c}" cy="${c}" r="${f2(inner-3)}" class="scope-disc"/><polygon points="${c-4},${c-outer-7} ${c+4},${c-outer-7} ${c},${c-outer-1}" class="scope-now"/>`;
 return s;
}
/** The beam layer never changes, so its CSS rotation keeps running across updates. */
export function scopeBeam(){
 const c=110,outer=103,inner=outer*.6;let s='';
 for(let j=0;j<12;j++)s+=`<path d="${sector(c,c,inner,outer,-90-(j+1)*4,-90-j*4)}" opacity="${f2(.26*Math.pow(1-j/12,1.6))}"/>`;
 return `<g class="scope-wake">${s}<line x1="${c}" y1="${f2(c-inner)}" x2="${c}" y2="${f2(c-outer-2)}" class="scope-beam"/></g>`;
}

/** How old a value that could not be refreshed is: "38m ago", "38분 전 보고". */
function age(updated,now,t){const s=valid(updated)?Math.max(0,now/1000-updated):null;if(s===null)return t('Last report','마지막 보고');const [n,en,ko,zh]=s<60?[0,'Just now','방금','刚刚']:s<3600?[Math.floor(s/60),'m','분 전',' 分钟前']:s<86400?[Math.floor(s/3600),'h','시간 전',' 小时前']:[Math.floor(s/86400),'d','일 전',' 天前'];return n?t(n+en+' ago',n+ko+' 보고',n+zh+'的报告'):t(en,ko+' 보고',zh+'的报告');}

/** The weekly % across the period, ending at the current report. */
function spark(points,start,end,stroke,faded){
 const pts=(points||[]).filter(p=>Array.isArray(p)&&valid(p[0])&&p[0]<=end&&valid(p[1])&&p[1]<=100).sort((a,b)=>a[0]-b[0]),first=pts.findIndex(p=>p[0]>=start),use=first<0?[]:pts.slice(Math.max(0,first-1));
 if(!use.length)return '<svg class="spark" viewBox="0 0 100 14" preserveAspectRatio="none"></svg>';
 let lo=Math.min(...use.map(p=>p[1])),hi=Math.max(...use.map(p=>p[1]));if(hi-lo<2){const m=(hi+lo)/2;lo=m-1;hi=m+1;}const pad=(hi-lo)*.15;lo-=pad;hi+=pad;if(lo<0){hi-=lo;lo=0;}
 const xy=p=>[f2((Math.max(start,p[0])-start)/(end-start)*94),f2(5+(1-(p[1]-lo)/(hi-lo))*4)],line=use.map((p,i)=>(i?'L':'M')+xy(p).join(' ')).join(''),[tx,ty]=xy(use[use.length-1]);
 return `<svg class="spark${faded?' faded':''}" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"><path d="${line}" stroke="${stroke}" fill="none" stroke-width="1.4" vector-effect="non-scaling-stroke"/><circle cx="${tx}" cy="${ty}" r="2.4" fill="${stroke}"/></svg>`;
}

/** Everything that changes with each snapshot: the scope's data and centre, the model legend,
 *  weekly limit tiles and each computer's CPU and memory. */
export function renderCockpit(root,{devices,rows,period,t,live,now,filter=null}){
 if(!root)return;const online=devices.filter(d=>d.online&&now-d.received<30000),scoped=rows.filter(r=>online.includes(r.device));
 const data=reading(online,scoped,period,filter),label=t(`Last ${period}`,'최근 '+{'10m':'10분','30m':'30분','1h':'1시간','5h':'5시간','12h':'12시간','24h':'24시간'}[period],'最近 '+{'10m':'10 分钟','30m':'30 分钟','1h':'1 小时','5h':'5 小时','12h':'12 小时','24h':'24 小时'}[period]);
 root.querySelector('[data-scope-data]').innerHTML=scopeData(data,period);
 root.querySelector('.scope').classList.toggle('moving',(data.average??0)>0);
 root.querySelector('[data-scope-center]').innerHTML=`<span>${t('Average','평균')}</span>${digits(data.average,29)}<small>${data.average===null?t('Checking','확인 중'):t('tokens/h','tokens/시간')}</small>`;
 root.querySelector('[data-period-label]').textContent=label;
 const by=new Map();for(const s of scoped){const v=total(s.windows?.[period]);if(!valid(v)||v<=0)continue;const m=shortModel(s),k=s.kind+'|'+m,o=by.get(k);if(o)o.v+=v;else by.set(k,{kind:s.kind,m,v});}
 const list=[...by.values()].sort((a,b)=>b.v-a.v),sumAll=list.reduce((n,x)=>n+x.v,0),shown=list.length<=4?list:list.slice(0,3),seen={};
 const slices=shown.map(x=>{const i=seen[x.kind]||0;seen[x.kind]=i+1;return {name:x.m,detail:toolName(x.kind),fill:color(x.kind),op:[1,.68,.46][Math.min(i,2)],v:x.v};});
 const rest=sumAll-shown.reduce((n,x)=>n+x.v,0);if(rest>sumAll*.005)slices.push({name:t('Other models','기타 모델'),detail:String(list.length-shown.length),fill:'#6c7882',op:1,v:rest});
 const share=v=>sumAll>0?(v/sumAll*100<1?'<1%':Math.round(v/sumAll*100)+'%'):'—';
 root.querySelector('[data-models]').innerHTML=slices.length?`<p class="cockpit-caption">${t('By model','모델별')}</p><div class="model-bar">${slices.map(x=>`<i style="flex:${x.v};background:${x.fill};opacity:${x.op}"></i>`).join('')}</div>${slices.map(x=>`<div class="model-row"><i style="background:${x.fill};opacity:${x.op}"></i><span><b>${esc(x.name)}</b><small>${esc(x.detail)}</small></span><em>${share(x.v)}</em></div>`).join('')}`
  :`<p class="cockpit-caption">${data.average===null?t('Checking usage','사용량을 확인하고 있습니다'):t('No usage reported in this period','이 기간에 보고된 사용이 없습니다')}</p>`;
 const quotas=new Map();for(const d of online)for(const q of d.snapshot.account_quotas||[])if(!quotas.has(q.id)&&(!filter?.tool||q.kind===filter.tool))quotas.set(q.id,{q,d});
 const end=Math.max(...online.map(d=>d.snapshot.updated||0),now/1000)||now/1000,start=end-SECONDS[period];
 root.querySelector('[data-weekly]').innerHTML=quotas.size?[...quotas.values()].slice(0,4).map(({q})=>{const w=(q.windows||[]).find(x=>['주간','Weekly','7d'].includes(x.label)),p=q.weekly?.[period],rate=!q.stale&&valid(p?.used_pp)&&valid(p?.observed_seconds)&&p.observed_seconds>=120?p.used_pp/p.observed_seconds*3600:null,tag=String(q.account_label||'').split(' · ').pop();
  return `<div class="weekly-tile" style="--tool:${color(q.kind)}"><div><i></i><b>${esc(toolName(q.kind))}</b><strong class="${q.stale?'stale':''}">${pct(w?.pct)}</strong></div><div><small>${esc(tag)}</small>${spark(q.usage_points,start,end,color(q.kind),q.stale)}<em class="${q.stale?'stale':''}">${q.stale?(['login_required','login_expired','credential_store_unavailable','access_denied'].includes(q.status)?t('Reconnect needed','재연결 필요'):age(q.updated,now,t)):rate===null?t('Collecting','수집 중'):pct(rate)+t('/h','/시간')}</em></div></div>`;}).join('')
  :`<p class="cockpit-caption">${t('Connect subscription accounts in 1top on your computer.','컴퓨터의 1top에서 구독 계정을 연결하면 표시됩니다.')}</p>`;
 root.querySelector('[data-hosts]').innerHTML=online.map(d=>{const h=d.snapshot.host||{},mem=valid(h.used_memory)&&h.total_memory>0?h.used_memory/h.total_memory*100:null;
  return `<div class="host-row"><b>${esc(d.name)}</b>${[['CPU',h.cpu],[t('Memory','메모리'),mem]].map(([n,v])=>`<span><small>${n}</small><i><u style="width:${Math.min(100,Math.max(0,v||0))}%"></u></i><em>${pct(v)}</em></span>`).join('')}</div>`;}).join('')||`<p class="cockpit-caption">${t('Waiting for a computer to report.','컴퓨터의 보고를 기다립니다.')}</p>`;
 root.classList.toggle('stale',!live);
}

/** The static frame, built once with the dashboard. */
export function cockpitMarkup(t){
 return `<section class="remote-cockpit" id="cockpit"><div class="cockpit-instrument"><div class="cockpit-head"><b>${t('Token usage','토큰 사용')}</b><small data-period-label></small></div>
  <div class="cockpit-dial"><div class="scope"><svg viewBox="0 0 220 220" aria-hidden="true"><g data-scope-data></g>${scopeBeam()}</svg><div class="scope-center" data-scope-center></div></div><div class="cockpit-models" data-models></div></div></div>
  <div class="cockpit-side"><div class="cockpit-head"><b>${t('Weekly limits','주간 한도')}</b><small>${t('100% per account','계정별 100%')}</small></div><div class="weekly-grid" data-weekly></div><div class="host-rows" data-hosts></div></div></section>`;
}
