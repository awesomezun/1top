/* Selected-period throughput. Use event totals, never grouped session rows. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const sum=v=>Array.isArray(v)&&v.length===4&&v.every(valid)?v.reduce((a,b)=>a+b,0):null;
 function measure(state,key,now=Date.now()/1000){
  const w=state?.period_usage?.windows?.find(p=>p.key===key);
  const local=sum(w?.tokens),rows=[],seen=new Set();
  const known=local!==null&&(local>0||state?.period_usage?.known_kinds?.length>0);
  // The 1top.si remote workspace's totals already add up several computers: period_usage.computers out of .expected.
  const covers=state?.period_usage?.computers??1;
  let expected=state?.period_usage?.expected??1;
  if(known&&now-state.updated<=20&&!state.error)rows.push({tokens:local,seconds:key==='all'?Math.max(1,now-(state.history_started??state.started)):w.seconds,partial:w.partial,computers:covers});
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
   seconds,computers:rows.reduce((n,r)=>n+(r.computers??1),0),expected,partial:rows.reduce((n,r)=>n+(r.computers??1),0)<expected||rows.some(r=>r.partial)};
 }
 function niceMax(value){if(!valid(value)||value===0)return 1;const power=10**Math.floor(Math.log10(value));return [1,2,5,10].map(n=>n*power).find(n=>n>=value)||10*power;}
 // The dial's resting full scale by period: longer periods hold more idle time, so their hourly
 // average runs lower. Up to an hour 200M, up to a week 100M, beyond that 50M tokens per hour.
 function baseMax(seconds){return !valid(seconds)||seconds<=3600?2e8:seconds<=604800?1e8:5e7;}
 // The full scale for a reading: the period's resting scale, raised to a 1-2-5 step when exceeded.
 function scaleMax(rate,seconds){return Math.max(baseMax(seconds),valid(rate)?niceMax(rate):0);}

 /* Instrument face for the speed panel: a 252×196 SVG drawn from the same rate and
    scale as before. 'sweep' is the segment tachometer, 'scope' adds the selected
    period's per-bin rates around the reading. Motion is CSS-only (see dashboard.css). */
 const n2=v=>+v.toFixed(2),rad=d=>d*Math.PI/180,clamp=v=>Math.max(0,Math.min(1,v));
 const P=(cx,cy,r,a)=>[cx+r*Math.cos(rad(a)),cy+r*Math.sin(rad(a))];
 function sector(cx,cy,r0,r1,a0,a1){const [x0,y0]=P(cx,cy,r1,a0),[x1,y1]=P(cx,cy,r1,a1),[x2,y2]=P(cx,cy,r0,a1),[x3,y3]=P(cx,cy,r0,a0),l=a1-a0>180?1:0;
  return `M${n2(x0)} ${n2(y0)}A${r1} ${r1} 0 ${l} 1 ${n2(x1)} ${n2(y1)}L${n2(x2)} ${n2(y2)}A${r0} ${r0} 0 ${l} 0 ${n2(x3)} ${n2(y3)}Z`;}
 function arc(cx,cy,r,a0,a1){const [x0,y0]=P(cx,cy,r,a0),[x1,y1]=P(cx,cy,r,a1);return `M${n2(x0)} ${n2(y0)}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${n2(x1)} ${n2(y1)}`;}
 const unitOf=n=>n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];
 function axis(v,max,last){const [d,u]=unitOf(max),x=v/d,s=Math.abs(x-Math.round(x))<1e-6?String(Math.round(x)):x.toFixed(1);return s+(last?u:'');}
 function short(n){if(!valid(n))return '—';if(n<.5)return '0';const [d,u]=unitOf(n),v=n/d;return String(v>=100?Math.round(v):v>=10?+v.toFixed(1):+v.toFixed(2))+u;}
 // Seven-segment digits: four places, a decimal point slot after the first three.
 const SEG={0:'abcdef',1:'bc',2:'abged',3:'abgcd',4:'fgbc',5:'afgcd',6:'afgedc',7:'abc',8:'abcdefg',9:'abcdfg','-':'g',' ':''},polys={};
 function segPolys(w,h,t){const key=w+'/'+h+'/'+t;if(polys[key])return polys[key];const g=.9,ht=t/2;
  const H=(cy,x0,x1)=>`${n2(x0)},${n2(cy)} ${n2(x0+ht)},${n2(cy-ht)} ${n2(x1-ht)},${n2(cy-ht)} ${n2(x1)},${n2(cy)} ${n2(x1-ht)},${n2(cy+ht)} ${n2(x0+ht)},${n2(cy+ht)}`;
  const V=(cx,y0,y1)=>`${n2(cx)},${n2(y0)} ${n2(cx+ht)},${n2(y0+ht)} ${n2(cx+ht)},${n2(y1-ht)} ${n2(cx)},${n2(y1)} ${n2(cx-ht)},${n2(y1-ht)} ${n2(cx-ht)},${n2(y0+ht)}`;
  return polys[key]={a:H(ht,ht+g,w-ht-g),g:H(h/2,ht+g,w-ht-g),d:H(h-ht,ht+g,w-ht-g),f:V(ht,ht+g,h/2-g),b:V(w-ht,ht+g,h/2-g),e:V(ht,h/2+g,h-ht-g),c:V(w-ht,h/2+g,h-ht-g)};}
 function digits(v){
  if(!valid(v))return {c:['-','-','-'],u:''};
  if(v<.5)return {c:[' ',' ','0'],u:''};
  let [d,u]=unitOf(v),x=Math.round(v/d);
  if(x>=1000&&u!=='B'){[d,u]=unitOf(x*d);x=Math.round(v/d);}
  return {c:[...String(Math.min(999,x)).padStart(3,' ')],u};
 }
 function seg7(g,cx,yb,w,h,t,gap,dim){
  const S=segPolys(w,h,t),pitch=w+gap,us=n2(h*.46),uw=g.u?gap+us*.8:0,bw=2*pitch+w+uw,x0=cx-(bw+h*Math.tan(rad(9)))/2;let off='',on='';
  g.c.forEach((ch,i)=>{const lit=SEG[ch]??'';for(const k of 'abcdefg'){const p=`<polygon points="${S[k]}" transform="translate(${n2(i*pitch)} 0)"/>`;if(lit.includes(k))on+=p;else off+=p;}});
  if(g.u)on+=`<text x="${n2(2*pitch+w+gap)}" y="${h}" class="fs-unit-led" font-size="${us}">${g.u}</text>`;
  return `<g transform="translate(${n2(x0)} ${yb}) skewX(-9) translate(0 ${-h})"><g class="fs-off">${off}</g><g class="fs-digit${dim?' fs-dim':' fs-glow'}">${on}</g></g>`;
 }
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function unitLine(x,y,size,g,o){
  return `<text x="${x}" y="${y}" class="fs-mut" font-size="${size}" text-anchor="middle">${esc(valid(o.rate)?o.text.perHour:o.text.checking)}</text>`;
 }
 function sweep(o){
  const cx=126,cy=108,Ro=82,Ri=69,Rs=63,N=36,A0=150,S=240,step=S/N,gp=1.5,live=valid(o.rate),frac=live?clamp(o.rate/o.max):0,lead=o.rate>0?frac*N:0;let s='',lit='';
  for(let i=0;i<=50;i++){const a=A0+S*i/50,maj=i%10===0,[x0,y0]=P(cx,cy,Ro+3,a),[x1,y1]=P(cx,cy,Ro+(maj?9:6),a);
   s+=`<line x1="${n2(x0)}" y1="${n2(y0)}" x2="${n2(x1)}" y2="${n2(y1)}" class="${o.rate>0&&i/50<=frac+1e-9?'fs-tick-on':maj?'fs-tick-major':'fs-tick'}"/>`;}
  for(let k=0;k<=5;k++){const [x,y]=P(cx,cy,Ro+17,A0+48*k);s+=`<text x="${n2(x)}" y="${n2(y)}" class="fs-scale" text-anchor="middle" dominant-baseline="central">${axis(o.max*k/5,o.max,k===5)}</text>`;}
  const leadIdx=Math.ceil(lead)-1;
  for(let i=0;i<N;i++){const d=sector(cx,cy,Ri,Ro,A0+i*step+gp/2,A0+(i+1)*step-gp/2),f=clamp(lead-i);
   s+=`<path d="${d}" class="fs-off"/>`;
   if(f>0)lit+=i===leadIdx?`<path d="${d}" class="fs-lead" opacity="${n2(.35+.65*f)}"/>`:`<path d="${d}" class="fs-on" opacity="${n2(.38+.55*i/Math.max(1,lead))}"/>`;}
  s+=`<g class="fs-glow">${lit}</g><path d="${arc(cx,cy,Rs,A0,A0+S)}" class="fs-track" stroke-dasharray="1 3.2"/>`;
  const [ex,ey]=P(cx,cy,Ro,A0),[fx]=P(cx,cy,Ro,A0+S);
  s+=`<path d="M${n2(ex)} ${n2(ey)}L${n2(ex+12)} ${n2(ey+12)}H${n2(fx-12)}L${n2(fx)} ${n2(ey)}" class="fs-track"/>`;
  const g=digits(o.rate);
  s+=seg7(g,cx,123,22,40,4.6,6,!live)+unitLine(cx,141,10.5,g,o);
  s+=`<text x="${cx}" y="181" class="fs-mut" font-size="10.5" text-anchor="middle">${esc(live?o.text.average:o.text.connecting)}</text>`;
  return s;
 }
 // Radar: one turn is the selected period, twelve o'clock is now. Bars are stacked by AI tool and the
 // busiest bin nearly reaches the outer ring; the dashed ring is the average shown in the centre.
 // o.bins: [{total, parts:[[kind, tokensPerHour]]}], o.color(kind), o.grow 0–1 while the bars grow in.
 // Degrees left open before twelve o'clock, after the scope's oldest bin.
 const SCOPE_OPENING=12;
 function scope(o){
  const cx=126,cy=98,R=88,r0=50,live=valid(o.rate),bins=live&&Array.isArray(o.bins)?o.bins:null;
  const peak=bins?Math.max(0,...bins.map(b=>b.total)):0,sc=Math.max(o.rate||0,peak)*1.06,grow=valid(o.grow)?clamp(o.grow):1;
  const rr=f=>r0+(R-r0)*clamp(f)*grow;let s='';
  // The newest bin sits just right of ▼ (now) and the ring goes back in time clockwise, ending at
  // the oldest bin before a small opening left of twelve o'clock, where the rings stay open. Older
  // bins rest dimmer, so the ring is brightest next to now.
  const start=-90,end=270-SCOPE_OPENING;
  for(let k=0;k<12;k++){const a=-90+30*k,[x0,y0]=P(cx,cy,r0,a),[x1,y1]=P(cx,cy,R,a);s+=`<line x1="${n2(x0)}" y1="${n2(y0)}" x2="${n2(x1)}" y2="${n2(y1)}" class="fs-spoke"/>`;}
  for(const f of [.25,.5,.75,1])s+=`<path d="${arc(cx,cy,r0+(R-r0)*f,start,end)}" class="fs-ring${f===1?' is-outer':''}"/>`;
  s+=`<line x1="${cx}" y1="${cy-r0}" x2="${cx}" y2="${cy-R}" class="fs-now-line"/>`;
  if(bins&&o.rate>0&&sc>0){const n=bins.length,st=(end-start)/n;let bars='';
   bins.forEach((b,i)=>{const a0=start+(n-1-i)*st+.55,a1=start+(n-i)*st-.55,now=i===n-1,rest=n>1?.32+.58*i/(n-1):1;let r=r0+1,acc=0,parts='';
    for(const [kind,v] of b.parts||[]){if(!(v>0))continue;acc+=v;const r1=rr(acc/sc);if(r1<=r+.3)continue;parts+=`<path d="${sector(cx,cy,r,r1,a0,a1)}" fill="${esc(o.color?o.color(kind):'')}"/>`;r=r1;}
    if(parts)bars+=now?`<g class="fs-bar is-now fs-glow" data-a="${n2((a0+a1)/2+90)}">${parts}<path d="${sector(cx,cy,r0+1,r,a0,a1)}" class="fs-bar-edge"/></g>`
     :`<g class="fs-bar" data-a="${n2((a0+a1)/2+90)}" data-rest="${n2(rest)}" opacity="${n2(rest)}">${parts}</g>`;});
   s+=`<g class="fs-bars">${bars}</g><path d="${arc(cx,cy,r0+(R-r0)*clamp(o.rate/sc)*grow,start,end)}" class="fs-average"/>`;}
  s+=`<circle cx="${cx}" cy="${cy}" r="${r0-3}" class="fs-disc"/><path d="M122 1L130 1L126 7.5Z" class="fs-now"/>`;
  const g=digits(o.rate);
  s+=`<text x="${cx}" y="80" class="fs-mut" font-size="9.5" text-anchor="middle">${esc(o.text.avgShort||'')}</text>`;
  return s+seg7(g,cx,108,15,28,3.4,4.5,!live)+unitLine(cx,123,10,g,o);
 }
 function face(o){return o.style==='scope'?scope(o):sweep(o);}
 // Moving layer, built once per style: the sweep's scanner light with a fading trail (each copy runs
 // the same CSS animation a little later than the bright head) and the scope's rotating radar.
 // Only shown while tokens flow.
 function motion(style){
  if(style==='scope')return `<g class="fs-radar" data-radar>${Array.from({length:12},(_,j)=>`<path d="${sector(126,98,50,88,-90-(j+1)*4,-90-j*4)}" opacity="${n2(.26*(1-j/12)**1.6)}"/>`).join('')}<line x1="126" y1="48" x2="126" y2="8" class="fs-beam fs-glow"/></g>`;
  // 18 copies 0.04 s apart: at the sweep's fastest (about 120°/s) they sit about 5° apart, under the
  // 8° arc, so the trail reads as one continuous fade with no gaps. The tail is a little fainter so
  // the overlaps don't add up to a brighter band.
  return `<g class="fs-scanner">${Array.from({length:18},(_,j)=>`<path d="${arc(126,108,63,266,274)}" class="fs-scan${j?'':' fs-glow'}" style="animation-delay:${n2(-.72+j*.04)}s" opacity="${n2(j?.72*(1-j/18)**1.6:1)}"/>`).join('')}</g>`;
 }
 // Bloom in each element's own colour, as in the cockpit candidates.
 const glowFilter='<filter id="fsGlow" filterUnits="userSpaceOnUse" x="-12" y="-12" width="276" height="220" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="2.3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
 function instrument(o){return (o.style==='scope'?'':face(o))+(o.rate>0?motion(o.style):'')+(o.style==='scope'?face(o):'');}
 const api={measure,niceMax,baseMax,scaleMax,instrument,face,motion,glowFilter,digits};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopSpeed=api;
})(typeof window==='undefined'?globalThis:window);
