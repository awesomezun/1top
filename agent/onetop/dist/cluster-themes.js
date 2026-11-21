/* Cluster themes (4.9.0): the 72 instrument looks the design session drew (themes/, from
   output/1top-cockpit-themes_v4.1.0), fed by the cluster's own readings. A theme draws only the instruments; the window,
   the fuel cans and what each warning does stay the cluster's. The look is a per-device setting kept apart from the
   layout, as the reports' look is, so an older app that saves the layout keeps it. */
(function(root){
 'use strict';
 // The theme files sit in themes/ beside this script, wherever the dashboard is served from (/ on the collector,
 // /dashboard/ on 1top.si).
 const SELF=root.document?.currentScript?.src||'';
 const KEY='onetop.clusterTheme.v1',FILES=['t01-06','t07-17','t18-28','t29-39','t40-50','t51-61','t62-72'];
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const pick=v=>typeof v==='string'&&/^\d\d$/.test(v)?v:null;
 function settings(){try{return {theme:pick(JSON.parse(root.localStorage?.getItem(KEY)||'null')?.theme)};}catch{return {theme:null};}}
 function save(v){const s={theme:pick(v?.theme)};try{root.localStorage?.setItem(KEY,JSON.stringify(s));}catch{}return s;}

 // The drawing code loads once, when a theme is first wanted: the shared parts, then the seven files of themes and
 // 1top's own two (pairs.js, where each theme's two headline instruments sit; compact.js, which cuts them out).
 let loading=null;
 function load(base=SELF?new URL('themes/',SELF).href:'themes/'){
  if(root.OneTop?.THEMES?.length>=72)return Promise.resolve(root.OneTop);
  if(loading)return loading;
  const add=name=>new Promise((ok,no)=>{const s=root.document.createElement('script');s.src=base+name+'.js';s.onload=ok;s.onerror=()=>no(new Error(name));root.document.head.append(s);});
  loading=add('core').then(()=>Promise.all([...FILES,'pairs','compact'].map(add))).then(()=>root.OneTop).catch(e=>{loading=null;throw e;});
  return loading;
 }
 const list=()=>(root.OneTop?.THEMES||[]).slice().sort((a,b)=>a.id.localeCompare(b.id));
 const find=id=>list().find(t=>t.id===id)||null;

 // The cluster's readings (cluster.js readings()) as the themes' figures (themes/core.js snapshot()): the same scales the
 // cluster's dials run to, the subject picked, the hottest computer, the trip since its start and the four warnings.
 const SHORT={Claude:'Claude',Codex:'Codex',Antigravity:'Agy',GLM:'GLM'};
 const SPAN={m:60,h:3600,d:86400,w:604800};
 const seconds=p=>{const m=/^(\d+)([mhdw])$/.exec(p||'');return m?Number(m[1])*SPAN[m[2]]:3600;};
 const short=n=>n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?Math.round(n/1e3)+'K':String(Math.round(n));
 // The period in 24 slices of tokens, oldest first, from the minute events the collector keeps (zeros past them).
 function flow(state,period,now){
  const span=seconds(period),start=now-span,bins=Array(24).fill(0);
  for(const e of state?.events||[]){if(!(e.t>=start&&e.t<=now))continue;const v=e.n??((e.fresh??0)+(e.cached??0)+(e.written??0)+(e.output??0));if(valid(v))bins[Math.min(23,Math.floor((e.t-start)/span*24))]+=v;}
  return bins;
 }
 function figures(r,o={}){
  const O=root.OneTop,now=o.now??Date.now()/1000,base=o.gears||O.GEARS;
  const fuel=(r.accounts||[]).filter(a=>valid(a.left)).map(a=>({name:SHORT[a.kind]||a.kind||'',plan:a.plan||'',left:a.left,burn:valid(a.burn)?a.burn:0}));
  const counts={working:0,waiting:0,idle:0};for(const s of r.sessions||[])counts[s.state==='working'?'working':s.state==='waiting'?'waiting':'idle']++;
  const hot=r.heat?.hottest,reach=r.speed?.reach;
  return {period:r.period,periodLabel:O.periodKo(r.period),gears:base.includes(r.period)?base.slice():[...base,r.period],
   rate:valid(r.tach?.rate)?r.tach.rate:0,rateMax:r.tach?.full||200e6,tokens:r.tach?.tokens||0,
   burn:valid(r.speed?.value)?r.speed.value:0,burnMax:r.speed?.max||20,cruise:valid(r.speed?.cruise)?r.speed.cruise:null,
   heat:valid(r.heat?.value)?r.heat.value:0,cpu:valid(hot?.cpu)?hot.cpu:0,mem:valid(hot?.memory)?hot.memory:0,
   fuel,fuelLeft:fuel.length?Math.round(fuel.reduce((n,f)=>n+f.left,0)/fuel.length):0,minLeft:fuel.length?Math.min(...fuel.map(f=>f.left)):0,
   rangeH:valid(reach?.hours)?Math.min(99,reach.hours):null,
   odo:valid(o.odo)?o.odo:(r.tach?.tokens||0),trip:valid(r.trip?.tokens)?r.trip.tokens:0,
   sessions:{...counts,total:(r.sessions||[]).length},
   // The window's sessions in its order (working, then waiting, then the rest), named as the window names them.
   list:(r.sessions||[]).slice(0,7).map(x=>({name:String((o.name?o.name(x.session):x.session?.project)||x.kind||''),state:x.state==='working'||x.state==='waiting'?x.state:'idle',tok:short(x.tokens||0),tokens:x.tokens||0})),
   flow:flow(o.state,r.period,now),
   lamps:{waiting:r.tells?.waiting?.length||0,reconnect:r.tells?.reconnect?.length||0,empty:r.tells?.empty?.length||0,late:r.tells?.fresh?0:1},
   clock:new Date(now*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}),temp:''};
 }
 // One theme's SVG for the figures; '' when the theme is not loaded.
 function svg(id,d){const t=find(id);return t?root.OneTop.render(t,d):'';}
 // Its two headline instruments for a narrow cluster (themes/compact.js), as markup.
 function cutout(id,d){const t=find(id);return t?(root.OneTop.compact?root.OneTop.compact(t,d):root.OneTop.render(t,d)):'';}
 const T=s=>root.OneTopI18n?.t?root.OneTopI18n.t(s):s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // The 1top instruments' card: two dials and the window between them, in the cluster's own colours.
 const OWN='<svg viewBox="0 0 1280 480"><rect width="1280" height="480" rx="40" fill="#0d1013"/>'+[[300,'#5ee08f'],[980,'#7fd6c2']].map(([x,c])=>`<circle cx="${x}" cy="240" r="170" fill="none" stroke="#2a3038" stroke-width="16"/><path d="M${x-120} ${360}A170 170 0 1 1 ${x+120} ${360}" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" opacity=".7"/><line x1="${x}" y1="240" x2="${x+70}" y2="140" stroke="#ff3b30" stroke-width="9" stroke-linecap="round"/>`).join('')+'<rect x="520" y="110" width="240" height="260" rx="22" fill="#151a20" stroke="#2a3038" stroke-width="4"/><text x="640" y="258" text-anchor="middle" fill="#e9ebef" font-size="64" font-weight="650" font-family="system-ui,sans-serif">1top</text></svg>';
 // The name the customizing list shows for the chosen look.
 const nameOf=id=>id?(find(id)?.name?`${id} · ${find(id).name}`:`${T('테마')} ${id}`):T('1top 기본');

 // ---------- the gallery (customizing) ----------
 // The customizing look (cluster.css .cz-sheet), as the reports' look sheet: the cluster's own instruments first, then
 // the 72 themes drawn from this computer's readings as they come into view, narrowed by kind. A card picks at once and
 // the sheet stays, so looks can be tried in turn. o: {figures() → the cluster's figures, onChange()}.
 let open=null,catalog=null;
 function close(){if(!open)return;const s=open;open=null;s.classList.remove('up');setTimeout(()=>s.remove(),320);}
 function picker(o){
  close();const d=root.document,s=d.createElement('div');open=s;
  s.className='cz-sheet cz-gallery th-sheet'+((root.innerWidth||0)>=760?' wide':'');s.setAttribute('role','dialog');s.setAttribute('aria-label',T('계기판 디자인'));
  const kinds=[['all','전체'],['아날로그','아날로그'],['디지털','디지털'],['혼합','혼합']];let kind='all';
  const paint=()=>{
   const now=settings().theme,cat=catalog||[],typeOf=id=>cat.find(c=>c.rank===id)?.type||'';
   const cards=[`<div role="button" tabindex="0" class="cz-card th-card${now?'':' on'}" data-th="" aria-pressed="${!now}"><div class="th-prev th-own" aria-hidden="true">${OWN}</div><b>${esc(T('1top 기본'))}</b><small>${esc(T('지금의 계기판'))}</small></div>`]
    .concat(list().filter(t=>kind==='all'||typeOf(t.id)===kind).map(t=>`<div role="button" tabindex="0" class="cz-card th-card${now===t.id?' on':''}" data-th="${t.id}" aria-pressed="${now===t.id}"><div class="th-prev" data-th-prev="${t.id}" aria-hidden="true"></div><b>${esc(t.id+' · '+t.name)}</b><small>${esc(T(typeOf(t.id)))}</small></div>`));
   s.innerHTML=`<div class="cz-sh"><b>${esc(T('계기판 디자인'))}</b><button type="button" data-th-close>${esc(T('닫기'))}</button></div>
    <div class="cz-mini th-kinds" role="tablist">${kinds.map(([k,l])=>`<button type="button" data-th-kind="${k}" aria-pressed="${kind===k}">${esc(T(l))}</button>`).join('')}</div>
    <p class="th-note">${esc(T('계기 부분만 바뀝니다. 화면 창과 연료통은 그대로입니다.'))}</p><div class="cz-cards th-cards">${cards.join('')}</div>`;
   // Each preview is drawn when it scrolls into view, from this computer's readings.
   const fig=o.figures?.();const io=root.IntersectionObserver?new root.IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;io.unobserve(e.target);if(fig)e.target.innerHTML=svg(e.target.dataset.thPrev,fig);}),{root:s,rootMargin:'200px'}):null;
   s.querySelectorAll('[data-th-prev]').forEach(el=>io?io.observe(el):fig&&(el.innerHTML=svg(el.dataset.thPrev,fig)));
   s.querySelector('.th-card.on')?.scrollIntoView({block:'nearest'});
  };
  const choose=card=>{save({theme:card.dataset.th||null});s.querySelectorAll('.th-card').forEach(x=>{const on=x===card;x.classList.toggle('on',on);x.setAttribute('aria-pressed',String(on));});o.onChange?.();};
  s.onclick=e=>{const b=e.target.closest('button,.th-card');if(!b)return;
   if('thClose' in b.dataset)return close();
   if(b.dataset.thKind){kind=b.dataset.thKind;return paint();}
   if(b.classList.contains('th-card'))choose(b);};
  s.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();return;}const c=e.target.closest('.th-card');if(c&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(c);}};
  s.innerHTML=`<div class="cz-sh"><b>${esc(T('계기판 디자인'))}</b><button type="button" data-th-close>${esc(T('닫기'))}</button></div><p class="th-note">${esc(T('불러오는 중…'))}</p>`;
  d.body.append(s);root.requestAnimationFrame(()=>s.classList.add('up'));
  const base=SELF?new URL('themes/',SELF).href:'themes/';
  Promise.all([load(base),catalog?null:root.fetch?.(base+'catalog.json').then(r=>r.json()).then(c=>{catalog=c;}).catch(()=>{catalog=[];})]).then(()=>{if(open===s)paint();})
   .catch(()=>{if(open===s)s.querySelector('.th-note').textContent=T('계기판 디자인을 불러오지 못했습니다.');});
 }

 // ---------- the small cluster (menu bar and tray panels) ----------
 // It keeps its 1top shape and takes the chosen theme's colours and type (themes/mini.json, from the design session):
 // set as CSS variables on the compact cluster, as desktop/ClusterPanel.swift reads the same file.
 const FONTS={ui:'-apple-system,BlinkMacSystemFont,"Helvetica Neue","Apple SD Gothic Neo",Arial,sans-serif',
  din:'"DIN Alternate","DIN Condensed",Bahnschrift,"Roboto Condensed","Arial Narrow",-apple-system,sans-serif',
  cond:'"DIN Condensed","Avenir Next Condensed","Bahnschrift Condensed","Arial Narrow",-apple-system,sans-serif',
  futura:'Futura,"Century Gothic","Avenir Next",-apple-system,sans-serif',avenir:'"Avenir Next",Avenir,"Segoe UI",-apple-system,sans-serif',
  wide:'Eurostile,Microgramma,Michroma,"Arial Black",-apple-system,sans-serif',gill:'"Gill Sans","Gill Sans MT",Calibri,-apple-system,sans-serif',
  helv:'"Helvetica Neue",Helvetica,Arial,sans-serif',rounded:'"SF Pro Rounded","Arial Rounded MT Bold","Varela Round",-apple-system,sans-serif'};
 let minis=null,miniLoading=null;
 function loadMini(base=SELF?new URL('themes/',SELF).href:'themes/'){
  if(minis)return Promise.resolve(minis);
  return miniLoading||(miniLoading=root.fetch(base+'mini.json').then(r=>r.json()).then(m=>(minis=m)).catch(()=>(minis={})));
 }
 const MINI_VARS=['--m-bg','--m-face','--m-rim','--m-tick','--m-num','--m-needle','--m-hub','--m-lcd','--m-dim','--m-accent','--m-warn','--m-font'];
 // Paints el (the compact .cluster) in the chosen theme's colours; true when it did, false without a theme. A palette
 // still loading calls again() when it arrives.
 function paintMini(el,again){
  const id=settings().theme;
  if(!id){if(el.dataset.mini){delete el.dataset.mini;delete el.dataset.miniLight;MINI_VARS.forEach(k=>el.style.removeProperty(k));}return false;}
  if(!minis){loadMini().then(()=>again?.());return false;}
  const m=minis[id];if(!m)return false;
  if(el.dataset.mini===id)return true;
  el.dataset.mini=id;el.dataset.miniLight=m.light?'1':'0';
  const v={'--m-bg':m.bg,'--m-face':m.face,'--m-rim':m.rim,'--m-tick':m.tick,'--m-num':m.num,'--m-needle':m.needle,'--m-hub':m.hub,'--m-lcd':m.lcd,'--m-dim':m.lcdDim,'--m-accent':m.accent,'--m-warn':m.warn,'--m-font':FONTS[m.font]||FONTS.ui};
  for(const [k,x] of Object.entries(v))el.style.setProperty(k,x);
  return true;
 }

 const api={KEY,FILES,settings,save,load,list,find,figures,svg,cutout,nameOf,picker,close,loadMini,paintMini};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopClusterThemes=api;
})(typeof window==='undefined'?globalThis:window);
