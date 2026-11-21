/* The phones' theme page (scripts/theme-bundle.mjs puts it with the themes into one HTML for the iPhone and Android
   apps): the app hands it the cluster's figures (cluster-themes.js figures(), worked out in the app from its own
   readings) and it draws the chosen theme as the dashboard does, its needles gliding and testing full scale when the
   theme first shows. A warning, gear or trip pressed goes back to the app, which answers as its own cluster does. The
   gallery mode draws every theme small from the same figures for the customizing sheet. */
(function(root){
 'use strict';
 const O=root.OneTop,doc=root.document;
 const post=m=>{try{root.webkit?.messageHandlers?.onetop?.postMessage(m);}catch{}try{root.ReactNativeWebView?.postMessage(JSON.stringify(m));}catch{}};
 const find=id=>O.THEMES.find(t=>t.id===id)||null;
 const GLIDE=['rate','burn','heat','cpu','mem','fuelLeft','minLeft'];
 const io=p=>p<.5?4*p*p*p:1-(-2*p+2)**3/2,calm=()=>!!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const here={id:null,shown:null,frame:0,compact:false};
 // compact: only the theme's two headline instruments, cut out side by side (themes/compact.js), for a phone held upright.
 function paint(art,d){const t=find(here.id);if(!t)return;art.innerHTML=here.compact?O.compact(t,d):O.render(t,d);here.shown=d;
  art.querySelectorAll('[data-cl-period]').forEach(g=>{if(g.dataset.clPeriod===d.period)g.setAttribute('aria-pressed','true');});}
 // draw(id, figures): the first figures of a theme ignite it; the next ones glide to their values.
 // The period's Korean name comes with the theme code when the app leaves it out.
 const named=d=>d&&!d.periodLabel?{...d,periodLabel:O.periodKo(d.period)}:d;
 function draw(id,d){
  d=named(d);const art=doc.getElementById('art');cancelAnimationFrame(here.frame);
  const how=calm()?null:here.id!==id?'ignite':'glide',from=here.shown||d;here.id=id;
  if(!how){paint(art,d);return;}
  const start=performance.now(),D=how==='ignite'?1500:450;
  const step=t=>{const p=Math.min(1,(t-start)/D);let f;
   if(how==='ignite'){const up=io(Math.min(1,p/.4)),down=io(Math.max(0,(p-.45)/.55)),full=O.ignition(d,1);f=p<.45?O.ignition(d,up):{...d,...Object.fromEntries(GLIDE.map(k=>[k,full[k]+(d[k]-full[k])*down])),fuel:d.fuel};}
   else{const k=io(p);f={...d,...Object.fromEntries(GLIDE.map(n=>[n,(from[n]??d[n])+(d[n]-(from[n]??d[n]))*k]))};}
   paint(art,p<1?f:d);if(p<1)here.frame=requestAnimationFrame(step);};
  here.frame=requestAnimationFrame(step);
 }
 // side(on): on its side over the whole screen (the phone held upright, '크게 보기').
 function side(on){doc.body.classList.toggle('side',!!on);}
 function compact(on){here.compact=!!on;}
 doc.addEventListener('click',e=>{
  const a=e.target.closest('[data-cl-alert]');if(a)return post({alert:a.dataset.clAlert});
  const g=e.target.closest('[data-cl-period]');if(g)return post({period:g.dataset.clPeriod});
  if(e.target.closest('[data-cl-trip]'))return post({trip:true});
  const c=e.target.closest('[data-pick]');if(c)return post({pick:c.dataset.pick});
  const k=e.target.closest('[data-kind]');if(k){kind=k.dataset.kind;gallery(last);}
 });
 // gallery({figures, theme, kinds, labels}): the 1top instruments, then the themes narrowed by kind; a card posts its pick.
 let kind='all',last=null;
 function gallery(o){
  o={...o,figures:named(o.figures)};last=o;const g=doc.getElementById('gallery'),L=o.labels||{};doc.body.classList.add('picking');
  const type=id=>(o.kinds||{})[id]||'',tag=k=>L[k]||k;
  const card=(id,name,sub,svg)=>`<button type="button" class="card${(o.theme||'')===id?' on':''}" data-pick="${id}" aria-pressed="${(o.theme||'')===id}"><span class="prev">${svg}</span><b>${name}</b><small>${sub}</small></button>`;
  g.innerHTML=`<div class="kinds">${['all','아날로그','디지털','혼합'].map(k=>`<button type="button" data-kind="${k}" aria-pressed="${kind===k}">${tag(k==='all'?'전체':k)}</button>`).join('')}</div><div class="cards">`
   +card('',tag('1top 기본'),tag('지금의 계기판'),OWN)
   +O.THEMES.slice().sort((a,b)=>a.id.localeCompare(b.id)).filter(t=>kind==='all'||type(t.id)===kind).map(t=>card(t.id,`${t.id} · ${(o.names||{})[t.id]||t.name}`,tag(type(t.id)),O.render(t,o.figures))).join('')+'</div>';
 }
 const OWN='<svg viewBox="0 0 1280 480"><rect width="1280" height="480" rx="40" fill="#0d1013"/>'+[[300,'#5ee08f'],[980,'#7fd6c2']].map(([x,c])=>`<circle cx="${x}" cy="240" r="170" fill="none" stroke="#2a3038" stroke-width="16"/><path d="M${x-120} 360A170 170 0 1 1 ${x+120} 360" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" opacity=".7"/><line x1="${x}" y1="240" x2="${x+70}" y2="140" stroke="#ff3b30" stroke-width="9" stroke-linecap="round"/>`).join('')+'<rect x="520" y="110" width="240" height="260" rx="22" fill="#151a20" stroke="#2a3038" stroke-width="4"/><text x="640" y="258" text-anchor="middle" fill="#e9ebef" font-size="64" font-weight="650" font-family="system-ui,sans-serif">1top</text></svg>';
 root.OneTopHost={draw,side,compact,gallery};
 post({ready:true});
})(window);
