/* Customizing (customizing-spec_v1.1.0): the edit mode over a screen's objects, the same on the tray, the dashboard
   and the cluster. The objects jiggle; − hides one; a long press (a drag with a mouse) moves it; the corner grip
   changes its size or count with the value above the pointer; a tap opens a small bar right under it for its count
   and 모양 ▸, which lists its shapes in a sheet drawn from the real screen; 목록 shows every object at once. The host
   says which objects there are and redraws after each change; this file never knows the screens' markup. */
(function(root){
 'use strict';
 const L=()=>root.OneTopLayout;
 const T=s=>root.OneTopI18n?root.OneTopI18n.t(s):s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const SIZES=['작게','보통','크게'];
 const NAMES={periods:'기간 선택',dials:'두 계기',alerts:'경고등',odo:'합계·트립',temps:'CPU·메모리',fuel:'남은 한도',window:'창(탭)',tokens:'토큰 사용',weekly:'계정 한도',resources:'CPU·메모리',sessions:'세션 목록'};
 const SHAPES={
  periods:[['auto','이 화면 기본'],['tabs','탭'],['drum','드럼'],['tuner','튜너'],['roller','롤러'],['knob','노브'],['lever','레버']],
  dials:[['ring','고리'],['glow','빛'],['plate','판']],
  alerts:[['label','이름표'],['chips','칩'],['strip','띠'],['count','숫자'],['badge','배지'],['lens','렌즈']],
  odo:[['drum','O5 드럼'],['led','O1 LED'],['led0','O2 LED 0 채움'],['print','O3 인쇄'],['print0','O4 인쇄 0 채움']]
 };
 const UNIT={fuel:'칸',alerts:'개',weekly:'칸',sessions:'줄'};
 let E=null;
 // The wiggle comes in variants a–e for comparison (ONETOP_CZ_JIGGLE).
 const variant=(k,d)=>/^[a-e]$/.test(root[k]||'')?root[k]:d;
 const reduced=()=>root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const haptic=()=>{try{root.navigator?.vibrate?.(12);}catch{}};

 // What one object can change here: the host may narrow it (a preset that keeps temps hidden, a fixed dial).
 function caps(id){
  const O=L().OBJECTS[id]||{},h=E.host,fixed=h.fixed?.(id);
  return {size:'size' in O&&!h.noSize?.(id),count:!!O.count,shape:!!SHAPES[id]&&O.shape&&!h.noShape?.(id),move:!fixed&&!h.noMove?.(id),hide:!fixed&&id!=='dials'&&!h.noHide?.(id)};
 }
 const group=()=>E.host.group();
 const opts=id=>group().opts[id]||(group().opts[id]={});
 // Where a count stands among its steps; 'as many as fit' / 'all' stands at the number shown now, or at itself when
 // that is more than the largest number, so one step down is the largest.
 function startAt(id,s){const v=opts(id).count;if(v!=null)return Math.max(0,s.indexOf(v));const n=E.host.shown?.(id);if(!Number.isInteger(n))return s.length-1;const i=s.findIndex(x=>x!==null&&x>=n);return i<0?s.length-1:i;}
 function countSteps(id){const O=L().OBJECTS[id];if(O.steps)return [...O.steps,null];const [lo,hi,def]=O.count,out=[];for(let n=lo;n<=hi;n++)out.push(n);if(def===null)out.push(null);return out;}
 const countText=(id,v)=>v===null||v===undefined?(id==='fuel'?'자동':'모두'):v+(UNIT[id]||'');
 function change(fn){if(!E)return;fn();E.host.apply();L().save(E.host.state);paint();}

 function open(host){
  close();
  E={host,sel:null,layer:null,bar:null,sheet:null,drag:null};
  const box=host.container;box.classList.add('cz-on');if(!reduced())box.classList.add('cz-jig','cz-j-'+variant('ONETOP_CZ_JIGGLE','d'));
  E.layer=document.createElement('div');E.layer.className='cz-layer';box.append(E.layer);
  E.top=document.createElement('div');E.top.className='cz-top';
  E.top.innerHTML=`${host.presets?`<div class="cz-seg" role="group" aria-label="${esc(T('프리셋'))}">${host.presets.map(([k,l])=>`<button type="button" data-cz-preset="${k}">${esc(T(l))}</button>`).join('')}</div>`:`<b>${esc(T(host.title+' 커스터마이징'))}</b>`}
   <button type="button" class="cz-list-btn" data-cz="list">${esc(T('목록'))}</button><button type="button" class="cz-done" data-cz="done">${esc(T('완료'))}</button>`;
  (host.topHost||box).prepend(E.top);
  E.top.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.cz==='done')close();else if(b.dataset.cz==='list'){E.sel=null;paint();list();}else if(b.dataset.czPreset){host.setPreset(b.dataset.czPreset);E.sel=null;closeSheet();paint();}};
  E.onscroll=()=>place();(host.scroller||box).addEventListener('scroll',E.onscroll,{passive:true});root.addEventListener('resize',E.onscroll);
  E.onkey=e=>keys(e);root.addEventListener('keydown',E.onkey);
  E.down=e=>pointerDown(e);box.addEventListener('pointerdown',E.down);
  E.click=e=>{if(E?.drag?.moved){e.preventDefault();e.stopPropagation();}else if(e.target.closest('[data-cz-part]')&&!e.target.closest('.cz-layer,.cz-top')){e.preventDefault();e.stopPropagation();}};
  box.addEventListener('click',E.click,true);
  host.apply();paint();
 }
 function close(){
  if(!E)return;const h=E.host,box=h.container;
  closeSheet();E.layer?.remove();E.top?.remove();E.bar?.remove();
  box.classList.remove('cz-on','cz-jig','cz-dim',...[...box.classList].filter(c=>/^cz-[jb]-/.test(c)));box.querySelectorAll('[data-cz-part]').forEach(el=>{el.removeAttribute('data-cz-part');el.removeAttribute('tabindex');el.classList.remove('cz-picked','cz-lifted');el.style.animationDelay='';});
  (h.scroller||box).removeEventListener('scroll',E.onscroll);root.removeEventListener('resize',E.onscroll);root.removeEventListener('keydown',E.onkey);
  box.removeEventListener('pointerdown',E.down);box.removeEventListener('click',E.click,true);
  E=null;h.apply();h.closed?.();
 }
 // Each shown object's box in the container's own coordinates (the dials are one object over two elements).
 function rect(els){const b=E.host.container.getBoundingClientRect(),sx=E.host.container.scrollLeft,sy=E.host.container.scrollTop;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const el of els){const r=el.getBoundingClientRect();if(!r.width&&!r.height)continue;x0=Math.min(x0,r.left);y0=Math.min(y0,r.top);x1=Math.max(x1,r.right);y1=Math.max(y1,r.bottom);}
  return x1<x0?null:{x:x0-b.left+sx,y:y0-b.top+sy,w:x1-x0,h:y1-y0};}
 function paint(){
  if(!E)return;const h=E.host,parts=h.parts(),g=group();
  E.top.querySelectorAll('[data-cz-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.czPreset===h.preset?.())));
  parts.forEach((p,i)=>p.els.forEach((el,j)=>{el.dataset.czPart=p.id;el.tabIndex=0;el.classList.toggle('cz-picked',E.sel===p.id);el.setAttribute('aria-label',T(NAMES[p.id]||p.id));el.style.animationDelay=`-${((i*7+j*3)%10)/40}s`;}));
  h.container.classList.toggle('cz-dim',!!E.sel);
  E.parts=parts;place();
  const hidden=g.hidden.filter(id=>parts.some(p=>p.id===id)||h.known?.includes(id)).length;
  let chip=E.layer.querySelector('.cz-chip');
  if(hidden){if(!chip){chip=document.createElement('button');chip.type='button';chip.className='cz-chip';chip.onclick=()=>list();E.host.container.append(chip);E.chip=chip;}chip.textContent=`＋ ${T('숨긴 부품')} ${hidden}`;}
  else{E.chip?.remove();E.chip=null;}
 }
 function place(){
  if(!E)return;const L2=E.layer;L2.textContent='';const box=E.host.container,Wd=box.clientWidth+box.scrollLeft,clampX=(x,w)=>Math.max(box.scrollLeft+3,Math.min(Wd-w-3,x));
  // The marks of what scrolls stay inside its window, as the objects do; one scrolled out of sight has none.
  const sc=E.host.scroller,clip=sc&&document.createElement('div'),b0=box.getBoundingClientRect(),sr=sc?.getBoundingClientRect(),st=sr?sr.top-b0.top+box.scrollTop:0;
  if(clip){const l=sr.left-b0.left+box.scrollLeft;clip.className='cz-clip';clip.style.clipPath=`polygon(${l}px ${st}px,${l+sr.width}px ${st}px,${l+sr.width}px ${st+sr.height}px,${l}px ${st+sr.height}px)`;L2.append(clip);}
  for(const p of E.parts){const r=rect(p.els);if(!r)continue;const c=caps(p.id),inner=!!clip&&sc.contains(p.els[0]),at=inner?clip:L2;
   if(inner&&(r.y+r.h<st||r.y>st+sr.height))continue;
   // The ring runs just inside the object, so touching objects never share a line.
   const x0=Math.max(box.scrollLeft+2,r.x+2),x1=Math.min(Wd-2,r.x+r.w-2);
   const ring=document.createElement('div');ring.className='cz-ring'+(E.sel===p.id?' on':'');Object.assign(ring.style,{left:x0+'px',top:r.y+2+'px',width:x1-x0+'px',height:Math.max(8,r.h-4)+'px'});at.append(ring);
   if(c.hide){const b=document.createElement('button');b.type='button';b.className='cz-minus';b.textContent='−';b.setAttribute('aria-label',T(NAMES[p.id]+' 숨기기'));
    // The − sits on the ring's top-left corner, as on a home screen.
    b.style.left=clampX(x0-9,22)+'px';b.style.top=Math.max(inner?st+2:box.scrollTop+2,r.y-7)+'px';
    b.onclick=e=>{e.stopPropagation();change(()=>{const g=group();if(!g.hidden.includes(p.id))g.hidden.push(p.id);if(E.sel===p.id)E.sel=null;});};at.append(b);}
   if(c.size||c.count){const gr=document.createElement('div');gr.className='cz-grip';gr.dataset.czGrip=p.id;gr.setAttribute('aria-hidden','true');gr.style.left=clampX(x1-24,24)+'px';gr.style.top=r.y+r.h-26+'px';at.append(gr);}
  }
  bar();
 }

 // A picked object's own sheet, in the settings-sheet style: its size, its count, its shape (into the gallery, when it
 // has other shapes) and whether it shows. It follows every change and closes when nothing is picked.
 function bar(){
  if(!E||(E.sheet&&!E.sheet.dataset.obj))return;// the gallery or the list is up
  const id=E.sel,open=E.sheet?.dataset.obj;
  if(!id){if(open)closeSheet();return;}
  const c=caps(id),o=opts(id),g=group(),shape=c.shape&&(SHAPES[id].find(([v])=>v===(o.shape??SHAPES[id][0][0]))||SHAPES[id][0]);
  const rows=(c.size?`<div class="cz-row cz-orow"><b>${esc(T('크기'))}</b><div class="cz-mini">${SIZES.map((l,i)=>`<button type="button" data-cz-set="size" data-v="${i}" aria-pressed="${(o.size??2)===i}">${esc(T(l))}</button>`).join('')}</div></div>`:'')
   +(c.count?`<div class="cz-row cz-orow"><b>${esc(T('개수'))}</b><div class="cz-mini"><button type="button" data-cz-step="-1" aria-label="${esc(T('줄이기'))}">−</button><b>${esc(T(countText(id,o.count)))}</b><button type="button" data-cz-step="1" aria-label="${esc(T('늘리기'))}">＋</button></div></div>`:'')
   +(shape?`<div class="cz-row cz-orow"><b>${esc(T('모양'))}</b><button type="button" class="cz-shp" data-cz-shape>${esc(T(shape[1]))} ▸</button></div>`:'')
   +(c.hide?`<div class="cz-row cz-orow"><b>${esc(T('보이기'))}</b><button type="button" class="cz-sw" role="switch" aria-checked="${!g.hidden.includes(id)}" aria-label="${esc(T('보이기'))}"></button></div>`:'');
  const html=`<div class="cz-sh"><b>${esc(T(NAMES[id]))}</b><button type="button" data-cz-close>${esc(T('닫기'))}</button></div><div class="cz-rows">${rows||`<p class="cz-none">${esc(T(c.move?'끌어서 자리만 옮길 수 있습니다.':'자리가 정해져 있습니다.'))}</p>`}</div><button type="button" class="cz-reset" data-cz-list>${esc(T('전체 목록'))}</button>`;
  if(open===id){if(E.sheet.dataset.html!==html){E.sheet.dataset.html=html;E.sheet.innerHTML=html;}return;}
  const s=sheet('cz-obj',html);s.dataset.obj=id;s.dataset.html=html;
  E.parts.find(x=>x.id===id)?.els[0]?.scrollIntoView({block:'center',behavior:reduced()?'auto':'smooth'});
  s.onclick=e=>{const b=e.target.closest('button');if(!b)return;
   if('czClose' in b.dataset){E.sel=null;paint();return;}
   if('czList' in b.dataset){E.sel=null;paint();return list();}
   if('czShape' in b.dataset)return gallery(id);
   if(b.classList.contains('cz-sw')){E.sel=null;change(()=>{const g2=group();if(!g2.hidden.includes(id))g2.hidden.push(id);});return;}
   if(b.dataset.czSet==='size')return change(()=>{opts(id).size=Number(b.dataset.v);});
   if(b.dataset.czStep)return step(id,'count',Number(b.dataset.czStep));};
 }
 function step(id,k,d){
  change(()=>{const o=opts(id);if(k==='size'){o.size=Math.max(0,Math.min(2,(o.size??2)+d));return;}
   const s=countSteps(id);o.count=s[Math.max(0,Math.min(s.length-1,startAt(id,s)+d))];});
 }

 // Pointer: the grip resizes; a press (long on touch) on an object drags it; a short tap picks it.
 function pointerDown(e){
  if(!E||e.button>0)return;
  const grip=e.target.closest('[data-cz-grip]');if(grip){e.preventDefault();return gripDrag(e,grip.dataset.czGrip);}
  if(e.target.closest('.cz-layer button,.cz-bar,.cz-top,.cz-sheet,.cz-chip'))return;
  const el=e.target.closest('[data-cz-part]');if(!el)return;const id=el.dataset.czPart;
  const d=E.drag={id,x:e.clientX,y:e.clientY,moved:false,live:false,timer:0};
  const box=E.host.container;
  const start=()=>{if(!E||E.drag!==d||!caps(id).move)return;d.live=true;haptic();E.sel=null;E.bar?.remove();
   E.parts.find(p=>p.id===id)?.els.forEach(x=>x.classList.add('cz-lifted'));
   d.ghost=document.createElement('div');d.ghost.className='cz-ghost';d.ghost.textContent=T(NAMES[id]);box.append(d.ghost);d.line=document.createElement('div');d.line.className='cz-drop';box.append(d.line);moveGhost(d.x,d.y);};
  if(e.pointerType==='touch')d.timer=setTimeout(start,380);
  const move=ev=>{const dx=ev.clientX-d.x,dy=ev.clientY-d.y;if(!d.moved&&Math.hypot(dx,dy)>6){d.moved=true;if(e.pointerType!=='touch')start();else if(!d.live)clearTimeout(d.timer);}if(d.live){ev.preventDefault();moveGhost(ev.clientX,ev.clientY);}};
  const up=ev=>{root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',up);clearTimeout(d.timer);
   if(d.live)drop(ev.clientX,ev.clientY);else if(!d.moved){E.sel=E.sel===id?null:id;paint();}
   d.ghost?.remove();d.line?.remove();E.parts?.forEach(p=>p.els.forEach(x=>x.classList.remove('cz-lifted')));setTimeout(()=>{if(E&&E.drag===d)E.drag=null;},0);};
  root.addEventListener('pointermove',move,{passive:false});root.addEventListener('pointerup',up);root.addEventListener('pointercancel',up);
 }
 // Where the moved object would land: before the first movable object whose middle it is above (or left of, wide).
 function target(cx,cy){const axis=E.host.axis||'y',box=E.host.container.getBoundingClientRect(),list=E.parts.filter(p=>caps(p.id).move&&p.id!==E.drag.id);
  for(const p of list){const r=rect(p.els);if(!r)continue;const mid=axis==='y'?box.top+r.y-E.host.container.scrollTop+r.h/2:box.left+r.x+r.w/2;if((axis==='y'?cy:cx)<mid)return {before:p.id,r};}
  const last=list[list.length-1];return {before:null,r:last?rect(last.els):null};}
 function moveGhost(cx,cy){const d=E.drag,b=E.host.container.getBoundingClientRect(),sx=E.host.container.scrollLeft,sy=E.host.container.scrollTop;
  d.ghost.style.left=cx-b.left+sx+'px';d.ghost.style.top=cy-b.top+sy+'px';const t=target(cx,cy);if(!t.r){d.line.hidden=true;return;}d.line.hidden=false;
  const y=t.before?t.r.y-6:t.r.y+t.r.h+6;Object.assign(d.line.style,E.host.axis==='x'?{left:(t.before?t.r.x-6:t.r.x+t.r.w+6)+'px',top:t.r.y+'px',width:'3px',height:t.r.h+'px'}:{left:t.r.x+'px',top:y+'px',width:t.r.w+'px',height:'3px'});}
 function drop(cx,cy){const id=E.drag.id,t=target(cx,cy);change(()=>{const o=group().order;o.splice(o.indexOf(id),1);if(t.before)o.splice(o.indexOf(t.before),0,id);else{const movable=E.parts.filter(p=>caps(p.id).move).map(p=>p.id),lastMovable=[...o].reverse().find(x=>movable.includes(x));o.splice(lastMovable?o.indexOf(lastMovable)+1:o.length,0,id);}});}
 // The grip: every 44px of travel is one step; the value rides above the pointer.
 function gripDrag(e,id){
  const c=caps(id),box=E.host.container,b=box.getBoundingClientRect(),tip=document.createElement('div');tip.className='cz-tip';box.append(tip);
  const x0=e.clientX,y0=e.clientY,o=opts(id),size0=o.size??2,steps=c.count?countSteps(id):null,at0=steps?startAt(id,steps):0;
  const show=(cx,cy)=>{tip.textContent=T(c.count?countText(id,opts(id).count):SIZES[opts(id).size??2]);const w=tip.offsetWidth,x=cx-b.left+box.scrollLeft,y=cy-b.top+box.scrollTop-44;
   tip.style.left=Math.max(box.scrollLeft+w/2+4,Math.min(box.scrollLeft+box.clientWidth-w/2-4,x))+'px';tip.style.top=Math.max(box.scrollTop+tip.offsetHeight+4,y)+'px';};
  show(x0,y0);haptic();
  const move=ev=>{ev.preventDefault();const dx=ev.clientX-x0,dy=ev.clientY-y0;
   if(c.count){const n=Math.round(dx/44),v=steps[Math.max(0,Math.min(steps.length-1,at0+n))];if(v!==opts(id).count)change(()=>{opts(id).count=v;});}
   else{const n=Math.round((dx+dy)/2/44),v=Math.max(0,Math.min(2,size0+n));if(v!==(opts(id).size??2)){haptic();change(()=>{opts(id).size=v;});}}
   show(ev.clientX,ev.clientY);};
  const up=()=>{root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',up);tip.remove();};
  root.addEventListener('pointermove',move,{passive:false});root.addEventListener('pointerup',up);root.addEventListener('pointercancel',up);
 }
 // Keyboard: Tab to an object; arrows move it; Shift+arrows size it; − / + count; Enter its shapes; Escape leaves.
 function keys(e){
  if(!E)return;if(e.key==='Escape'){if(E.sheet){const back=E.sheet.classList.contains('cz-gallery');closeSheet();if(back&&E.sel)bar();}else close();e.preventDefault();return;}
  const el=document.activeElement?.closest?.('[data-cz-part]');if(!el)return;const id=el.dataset.czPart,c=caps(id);
  if(!e.shiftKey&&['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key)&&c.move){e.preventDefault();const back=['ArrowUp','ArrowLeft'].includes(e.key);
   change(()=>{const o=group().order,movable=E.parts.filter(p=>caps(p.id).move).map(p=>p.id),i=movable.indexOf(id),j=i+(back?-1:1);if(j<0||j>=movable.length)return;o.splice(o.indexOf(id),1);const at=o.indexOf(movable[j]);o.splice(back?at:at+1,0,id);});
   E.host.container.querySelector(`[data-cz-part="${id}"]`)?.focus();return;}
  if(e.shiftKey&&c.size&&['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(e.key)){e.preventDefault();step(id,'size',['ArrowUp','ArrowRight'].includes(e.key)?1:-1);return;}
  if(c.count&&['-','+','='].includes(e.key)){e.preventDefault();step(id,'count',e.key==='-'?-1:1);return;}
  if(e.key==='Enter'){e.preventDefault();E.sel=id;paint();}
 }

 // A sheet from below (a drawer on the right when wide).
 function sheet(cls,html){closeSheet();const s=document.createElement('div');s.className='cz-sheet '+cls+(E.host.wide?' wide':'');s.innerHTML=html;document.body.append(s);E.sheet=s;requestAnimationFrame(()=>s.classList.add('up'));return s;}
 function closeSheet(){if(!E?.sheet)return;const s=E.sheet;E.sheet=null;s.classList.remove('up');setTimeout(()=>s.remove(),320);}
 // A preview is a picture: it keeps its own tags, which its styles select, but takes no focus and no clicks (its
 // frame is inert).
 function inert(html){const t=document.createElement('template');t.innerHTML=html;
  t.content.querySelectorAll('a[href]').forEach(el=>el.removeAttribute('href'));
  t.content.querySelectorAll('button,a,[tabindex]').forEach(el=>el.setAttribute('tabindex','-1'));
  t.content.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));
  return t.innerHTML;}
 // Shapes: each drawn by the real screen once (the host redraws with it), then the picked one is kept.
 function gallery(id){
  const o=opts(id),was=o.shape,list=SHAPES[id].filter(([v])=>id!=='periods'||v!=='auto'||E.host.autoPeriods),cards=[];
  for(const [v,l] of list){o.shape=v;E.host.apply();const p=E.host.parts().find(x=>x.id===id);cards.push({v,l,html:p?inert(E.host.snapshot(p)):''});}
  o.shape=was;E.host.apply();
  const s=sheet('cz-gallery',`<div class="cz-sh"><b>${esc(T(NAMES[id]))} · ${esc(T('모양'))}</b><button type="button" data-cz-close>${esc(T('닫기'))}</button></div>
   <div class="cz-cards">${cards.map(c=>`<div role="button" tabindex="0" class="cz-card${(was??list[0][0])===c.v?' on':''}" data-v="${esc(c.v)}" aria-pressed="${(was??list[0][0])===c.v}"><div class="cz-prev" inert aria-hidden="true">${c.html}</div><b>${esc(T(c.l))}</b></div>`).join('')}</div>`);
  const take=b=>{s.querySelectorAll('.cz-card').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});change(()=>{opts(id).shape=b.dataset.v;});};
  // Closing the gallery goes back to the object's own sheet.
  s.onclick=e=>{if(e.target.closest('[data-cz-close]')){closeSheet();if(E?.sel===id)bar();return;}const b=e.target.closest('.cz-card');if(b)take(b);};
  s.onkeydown=e=>{const b=e.target.closest('.cz-card');if(b&&(e.key==='Enter'||e.key===' ')){e.preventDefault();take(b);}};
  s.querySelector('.cz-card.on')?.scrollIntoView({block:'center'});
 }
 // Every object at once: order, size or count, shape and shown.
 function list(){
  const h=E.host,g=group(),parts=h.known||g.order;
  const rows=g.order.filter(id=>parts.includes(id)).map(id=>{const c=caps(id),o=g.opts[id]||{};
   const val=c.size?`<div class="cz-mini">${SIZES.map((l,i)=>`<button type="button" data-cz-set="size" data-v="${i}" aria-pressed="${(o.size??2)===i}">${esc(T(l))}</button>`).join('')}</div>`
    :c.count?`<div class="cz-mini"><button type="button" data-cz-step="-1">−</button><b>${esc(T(countText(id,o.count)))}</b><button type="button" data-cz-step="1">＋</button></div>`:'<span></span>';
   return `<div class="cz-row" data-id="${id}"><span class="cz-hd" aria-hidden="true">≡</span><b>${esc(T(NAMES[id]))}</b>${val}${c.shape?`<button type="button" class="cz-shp" data-cz-shape>${esc(T((SHAPES[id].find(([v])=>v===(o.shape??SHAPES[id][0][0]))||SHAPES[id][0])[1]))} ▸</button>`:'<span></span>'}
    <button type="button" class="cz-sw" role="switch" aria-checked="${!g.hidden.includes(id)}" aria-label="${esc(T('보이기'))}" ${c.hide||g.hidden.includes(id)?'':'disabled'}></button>${c.move?`<span class="cz-ud"><button type="button" data-cz-move="-1" aria-label="${esc(T('위로'))}">↑</button><button type="button" data-cz-move="1" aria-label="${esc(T('아래로'))}">↓</button></span>`:'<span></span>'}</div>`;}).join('');
  const s=sheet('cz-list',`<div class="cz-sh"><b>${esc(T(h.title+' 목록'))}</b><button type="button" data-cz-close>${esc(T('닫기'))}</button></div>
   ${h.tabs?`<div class="cz-row cz-tabs"><b>${esc(T('대시보드·계기판 탭'))}</b><div class="cz-mini"><button type="button" data-cz-tabs="two" aria-pressed="${h.state.layout.tabs!=='one'}">${esc(T('따로'))}</button><button type="button" data-cz-tabs="one" aria-pressed="${h.state.layout.tabs==='one'}">${esc(T('하나로'))}</button></div></div>`:''}
   <div class="cz-rows">${rows}${h.reports&&root.OneTopReports?`<div class="cz-row cz-orow"><b>${esc(T('본전·주간 리포트'))}</b><button type="button" class="cz-shp" data-cz-reports>${esc(T(root.OneTopReports.NAMES[root.OneTopReports.settings().shape]))} ▸</button></div>`:''}</div><button type="button" class="cz-reset" data-cz-reset>${esc(T('기본값으로 되돌리기'))}</button>`);
  s.onclick=e=>{const b=e.target.closest('button');if(!b)return;const id=b.closest('.cz-row')?.dataset.id;
   if('czClose' in b.dataset)return closeSheet();
   // The reports' look is kept apart from the layout (reports.js) and goes back to its defaults with it.
   if('czReset' in b.dataset){change(()=>h.reset());if(h.reports&&root.OneTopReports){root.OneTopReports.save(root.OneTopReports.DEFAULTS);h.reports().onChange?.();}return list();}
   if('czReports' in b.dataset){closeSheet();setTimeout(()=>root.OneTopReports.openSettings(h.reports()),330);return;}
   if(b.dataset.czTabs){change(()=>{h.state.layout.tabs=b.dataset.czTabs;});return list();}
   if(!id)return;
   if(b.classList.contains('cz-sw')){change(()=>{const g2=group();g2.hidden=g2.hidden.includes(id)?g2.hidden.filter(x=>x!==id):[...g2.hidden,id];});return list();}
   if(b.dataset.czSet==='size'){change(()=>{opts(id).size=Number(b.dataset.v);});return list();}
   if(b.dataset.czStep){step(id,'count',Number(b.dataset.czStep));return list();}
   if(b.dataset.czMove){const d=Number(b.dataset.czMove);change(()=>{const o=group().order,movable=o.filter(x=>parts.includes(x)&&caps(x).move),i=movable.indexOf(id),j=i+d;if(j<0||j>=movable.length)return;o.splice(o.indexOf(id),1);const at=o.indexOf(movable[j]);o.splice(d<0?at:at+1,0,id);});return list();}
   if('czShape' in b.dataset){gallery(id);}
  };
 }
 // The host redrew on its own (new readings): put the marks back on the redrawn objects.
 const refresh=()=>{if(E&&!E.drag?.live)paint();};
 const api={open,close,refresh,isOpen:()=>!!E,NAMES,SHAPES};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopCustomize=api;
})(typeof globalThis!=='undefined'?globalThis:this);
