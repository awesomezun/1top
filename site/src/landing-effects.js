import './landing-effects.css';
// Landing motion v1.0.0: the hero entrance, scroll reveals and pointer accents on the landing markup (g-* classes).
// Every effect is decoration. Content shows without JS, with reduced motion, and before a reveal fires.
// The page re-renders right after load (sign-in state) and on a language switch. A re-render during the
// entrance resumes it where it was; a later one shows what is on screen at once instead of replaying it.
const ENTRANCE=2600;let entranceAt=null;
const GLYPHS='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const outCubic=t=>1-(1-t)**3;

/** Split at <br> into masked lines. Inline markup such as the gradient span stays inside its line. */
function splitLines(el){
 if(el.dataset.mSplit)return;el.dataset.mSplit='1';
 el.innerHTML=el.innerHTML.split(/<br\s*\/?>/i).map((part,i)=>`<span class="m-l"><span class="m-t" style="--i:${i}">${part}</span></span>`).join('');
}
/** Uppercase labels such as "01 / GAUGES" decode left to right. Labels in other scripts only fade. */
function scramble(el,frames){
 const final=el.textContent;if(!/^[\x20-\x7e]+$/.test(final))return;
 const start=performance.now(),duration=760;
 const step=now=>{const p=Math.min(1,(now-start)/duration);
  el.textContent=[...final].map((c,i)=>/[A-Z0-9]/i.test(c)&&i/final.length>=p?GLYPHS[Math.random()*GLYPHS.length|0]:c).join('');
  if(p<1)frames.add(requestAnimationFrame(step));else el.textContent=final;};
 frames.add(requestAnimationFrame(step));
}
/** "≈0.76%" counts up from zero with the same decimals. */
function countUp(el,frames){
 const m=el.textContent.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);if(!m)return;
 const [,pre,num,post]=m,places=(num.split('.')[1]||'').length,start=performance.now(),duration=1100;
 const step=now=>{const p=Math.min(1,(now-start)/duration);el.textContent=pre+(+num*outCubic(p)).toFixed(places)+post;if(p<1)frames.add(requestAnimationFrame(step));};
 frames.add(requestAnimationFrame(step));
}

export function mountLandingEffects(root){
 if(!root)return ()=>{};
 const off=[],frames=new Set(),q=s=>[...root.querySelectorAll(s)];
 const on=(target,type,fn,opts)=>{target.addEventListener(type,fn,opts);off.push(()=>target.removeEventListener(type,fn,opts));};
 const fine=matchMedia('(hover:hover) and (pointer:fine)').matches;

 // Scroll progress, shown with reduced motion too: it reports position and does not move content.
 const bar=document.createElement('div');bar.className='m-progress';bar.setAttribute('aria-hidden','true');bar.innerHTML='<i></i>';document.body.append(bar);off.push(()=>bar.remove());
 let pending=false;const progress=()=>{pending=false;const max=document.documentElement.scrollHeight-innerHeight;bar.style.setProperty('--p',max>0?Math.min(1,scrollY/max).toFixed(4):'0');};
 on(window,'scroll',()=>{if(!pending){pending=true;frames.add(requestAnimationFrame(progress));}},{passive:true});on(window,'resize',progress);progress();

 const cleanup=()=>{off.forEach(f=>f());frames.forEach(cancelAnimationFrame);frames.clear();};
 if(matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window))return cleanup;

 // Mark what moves and how. Hero items carry their own entrance delay.
 const mark=(els,kind,extra={})=>els.forEach(el=>{el.dataset.m=kind;for(const [k,v] of Object.entries(extra))el.style.setProperty(k,v);});
 const hero=root.querySelector('.g-hero');
 if(hero){
  q('.g-hero h1').forEach(splitLines);
  mark(q('.g-pill'),'rise',{'--d':'0ms'});mark(q('.g-hero h1'),'lines',{'--d':'90ms'});
  mark(q('.g-lede'),'rise',{'--d':'380ms'});mark(q('.g-ctas'),'rise',{'--d':'480ms'});mark(q('.g-meta'),'rise',{'--d':'560ms'});
  mark(q('.hero-motion'),'rise',{'--d':'640ms'});
 }
 q('.g-head h2,.g-menu-copy h2,.g-sec-head h2,.g-local h2,.g-download h2,.g-faq h2').forEach(el=>{splitLines(el);mark([el],'lines');});
 // Lists and grids stagger their own children; a child with its own motion keeps it.
 mark(q('.g-points,.g-steps,.g-legend,.g-faq,.g-index,.g-grid,.g-options,.g-phones'),'list');
 q('[data-m=list]').forEach(list=>{
  // Grid wave: a cell waits for its row and column, so a grid fills along the diagonal.
  const cols=getComputedStyle(list).display==='grid'?getComputedStyle(list).gridTemplateColumns.split(' ').length:1;
  [...list.children].filter(c=>!c.dataset.m).forEach((cell,i)=>cell.style.setProperty('--i',cols>1?(i%cols)+Math.floor(i/cols):i));
 });
 mark(q('.g-num,.g-kicker').filter(el=>!el.parentElement.closest('[data-m=list]')),'rise');
 mark(q('.g-head>p,.g-menu-copy>p,.g-local>div>p:not(.g-kicker),.g-download>p:not(.g-kicker),.g-cap,.g-try,.g-rec,.g-note'),'rise',{'--d':'140ms'});
 mark(q('.g-screen,.g-desk,.g-browser'),'screen');
 mark(q('.g-gauge'),'gauge');mark(q('.g-eq'),'count');
 q('.g-gauge').forEach(svg=>{const dash=parseFloat(svg.querySelector('.vl')?.getAttribute('stroke-dasharray'))||0;svg.style.setProperty('--f',(dash/100).toFixed(3));});

 const elapsed=entranceAt===null?0:performance.now()-entranceAt,instant=elapsed>=ENTRANCE,heroItems=hero?q('.g-hero [data-m],.hero-motion[data-m]'):[];
 const reveal=el=>{if(el.classList.contains('is-in'))return;el.classList.add('is-in');
  if(root.classList.contains('m-now')){if(/screen|list/.test(el.dataset.m))el.classList.add('is-done');return;}
  // A list drops its stagger delays once in, so hover states respond at once.
  if(el.dataset.m==='list'){const t=setTimeout(()=>el.classList.add('is-done'),1500);off.push(()=>clearTimeout(t));}
  if(el.matches('.g-num,.g-kicker'))scramble(el,frames);if(el.dataset.m==='count')countUp(el,frames);};
 root.classList.add('m-ready');
 if(instant){
  // A remount shows the hero and whatever is on screen at once, without transitions.
  root.classList.add('m-now');heroItems.forEach(reveal);
  q('[data-m]').forEach(el=>{const r=el.getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0)reveal(el);});
  frames.add(requestAnimationFrame(()=>frames.add(requestAnimationFrame(()=>root.classList.remove('m-now')))));
 }else{
  // Negative delays start each hero transition as far in as the entrance already got.
  [hero,root.querySelector('.hero-motion')].forEach(el=>el?.style.setProperty('--m-shift',Math.round(elapsed)+'ms'));
  frames.add(requestAnimationFrame(()=>frames.add(requestAnimationFrame(()=>{
   if(entranceAt===null)entranceAt=performance.now()-elapsed;
   heroItems.forEach(reveal);
   const h1=hero?.querySelector('h1'),wait=980-elapsed;if(h1&&wait>0){const t=setTimeout(()=>h1.classList.add('m-sheen'),wait);off.push(()=>clearTimeout(t));}
  }))));
 }
 const io=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){reveal(e.target);io.unobserve(e.target);}},{rootMargin:'0px 0px -9% 0px'});
 q('[data-m]').forEach(el=>{if(!el.classList.contains('is-in')&&!heroItems.includes(el))io.observe(el);});off.push(()=>io.disconnect());
 // Screens drop their clip once revealed so their shadows show again.
 on(root,'transitionend',e=>{if(e.propertyName==='clip-path'&&e.target.dataset.m==='screen')e.target.classList.add('is-done');});

 if(fine){
  // Magnetic buttons: the hero actions lean a few pixels toward the pointer and spring back.
  q('.g-ctas>*').forEach(b=>{b.classList.add('m-mag');
   on(b,'pointermove',e=>{const r=b.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/r.width,y=(e.clientY-r.top-r.height/2)/r.height;b.style.transform=`translate(${(x*7).toFixed(1)}px,${(y*6).toFixed(1)}px)`;});
   on(b,'pointerleave',()=>{b.style.transform='';});});
  // Card spotlight: a soft light follows the pointer across feature and download cards.
  q('.g-grid>article,.g-options>article').forEach(card=>{card.classList.add('m-spot');
   on(card,'pointermove',e=>{const r=card.getBoundingClientRect();card.style.setProperty('--mx',(e.clientX-r.left)+'px');card.style.setProperty('--my',(e.clientY-r.top)+'px');});});
 }
 return cleanup;
}
