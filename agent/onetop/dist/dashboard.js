/* Persistent presentation controls. No credentials or session data are stored here. */
window.OneTopDashboard=(()=>{
 'use strict';
 const key='onetop.dashboard.v1',ids=['session','model','status','period','total','rate','cpu','memory','controls'];
 const defaults={session:210,model:145,status:85,period:110,total:95,rate:120,cpu:65,memory:75,controls:155};
 // The narrowest each column can be without cutting its header, a product name or a control.
 const minima={session:130,model:140,status:80,period:105,total:95,rate:115,cpu:58,memory:64,controls:110};
 const panels=['speed','summary','flow','map','sessions','shared'];
 const state={theme:'dark',lang:'ko',period:'1h',columns:[...ids],widths:{...defaults},panels:[...panels],spans:{summary:9,speed:3,flow:6,map:6,sessions:12,shared:12},heights:{}};
 let hooks={},editing=false,dragging=false,frame,initialized=false;
 let gaugeScale={scope:null,max:1,lower:null,since:0};
 const list=(v,allowed)=>Array.isArray(v)&&v.length===allowed.length&&new Set(v).size===allowed.length&&v.every(x=>allowed.includes(x));
 function validPeriod(value){if(['10m','30m','1h','5h','12h','24h','all'].includes(value))return true;if(!/^custom:[0-9]{1,13}$/.test(value))return false;const n=Number(value.split(':')[1]);return Number.isSafeInteger(n)&&n>=600&&n%60===0&&n<=8e12;}
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved){
  for(const [k,values] of Object.entries({theme:['dark','light'],lang:['ko','en','zh']}))if(values.includes(saved[k]))state[k]=saved[k];
  if(list(saved.columns,ids))state.columns=saved.columns;if(list(saved.panels,panels))state.panels=saved.panels;else if(list(saved.panels,panels.filter(p=>p!=='speed'))){state.panels=[...saved.panels];state.panels.splice(state.panels.indexOf('summary')+1,0,'speed');}
  if(validPeriod(saved.period))state.period=saved.period;
  if(saved.rangeScale==='fixed-v1')state.rangeScale=saved.rangeScale;
  if(saved.cockpit==='boost-v1')state.cockpit=saved.cockpit;
  if(['sweep','scope'].includes(saved.instrument))state.instrument=saved.instrument;
  if(saved.collapsed&&typeof saved.collapsed==='object')state.collapsed=Object.fromEntries(Object.entries(saved.collapsed).filter(([k,v])=>['working','waiting','paused','idle','other'].includes(k)&&typeof v==='boolean'));
  if(Number.isFinite(saved.instrumentWidth))state.instrumentWidth=Math.max(200,Math.min(600,saved.instrumentWidth));
  for(const id of ids)if(Number.isFinite(saved.widths?.[id]))state.widths[id]=Math.max(minima[id],Math.min(700,saved.widths[id]));
  for(const id of panels){if(Number.isInteger(saved.spans?.[id]))state.spans[id]=Math.max(id==='summary'?6:3,Math.min(12,saved.spans[id]));if(Number.isFinite(saved.heights?.[id]))state.heights[id]=Math.max(150,Math.min(1200,saved.heights[id]));}
 }}catch{}
 // Migrate only the two overview panels; keep every other panel and table preference.
 if(state.cockpit!=='boost-v1'){state.panels=state.panels.filter(p=>p!=='speed');state.panels.splice(state.panels.indexOf('summary'),0,'speed');state.spans.speed=3;state.spans.summary=9;delete state.heights.speed;delete state.heights.summary;state.cockpit='boost-v1';}
 document.documentElement.dataset.theme=state.theme;document.documentElement.style.colorScheme=state.theme;
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(state));}catch{}};
 const t=s=>window.OneTopI18n?.t(s)||s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const queueDraw=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{hooks.layout?.();applyWidths();drawGauges();});};
 function move(array,from,to){const a=array.indexOf(from),b=array.indexOf(to);if(a<0||b<0||a===b)return;array.splice(a,1);array.splice(b,0,from);}
 const LANGS=[['ko','한','한국어'],['en','EN','English'],['zh','中','中文']];
 // The language the newest tap asked for, so quick taps keep moving forward before the page has switched.
 let langTarget=null;
 function prefs(){
  const toolbar=document.getElementById('dashboardPreferences');if(!toolbar)return;
  const at=Math.max(0,LANGS.findIndex(l=>l[0]===state.lang)),[,mark,name]=LANGS[at],next=LANGS[(at+1)%LANGS.length];
  toolbar.innerHTML=`<button class="theme-switch" type="button" aria-label="${t(state.theme==='dark'?'화이트 모드':'다크 모드')}" title="${t(state.theme==='dark'?'화이트 모드':'다크 모드')}" data-theme-switch>${state.theme==='dark'?'☀':'☾'}</button><button class="language-button" type="button" aria-label="${t('언어')}: ${name} → ${next[2]}" title="${t('언어')}: ${name} → ${next[2]}" data-language-switch lang="${state.lang}" data-user-content>${mark}</button><button class="edit-dashboard" type="button" aria-pressed="${editing}" id="editDashboard">${editing?'Done':'Edit'}</button>`;
  toolbar.querySelector('[data-theme-switch]').onclick=e=>window.OneTopEffects.reveal(e.currentTarget,()=>{state.theme=state.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.theme;document.documentElement.style.colorScheme=state.theme;save();prefs();hooks.layout?.();drawGauges();});
  // One language button, like the theme switch: each tap moves to the next language (한 → EN → 中),
  // and the change spreads from the button itself. No menu.
  toolbar.querySelector('[data-language-switch]').onclick=e=>{const from=Math.max(0,LANGS.findIndex(l=>l[0]===(langTarget||state.lang))),to=LANGS[(from+1)%LANGS.length][0];langTarget=to;
   window.OneTopEffects.reveal(e.currentTarget,()=>{state.lang=to;if(langTarget===to)langTarget=null;save();window.OneTopI18n.setLanguage(state.lang);prefs();hooks.refresh?.();afterTable();},to);};
  document.getElementById('editDashboard').onclick=()=>{editing=!editing;document.getElementById('dashboardGrid').classList.toggle('editing',editing);prefs();queueDraw();};
 }
 function panelSetup(){
  const root=document.getElementById('sessionsView'),range=root.querySelector('.range-toolbar');
  const grid=document.createElement('div');grid.id='dashboardGrid';root.prepend(grid);
  const summary=document.createElement('div');summary.id='cockpitSummary';summary.className='cockpit-summary';summary.append(range,document.getElementById('sessionSummary'));
  const elements={summary,speed:document.getElementById('fleetSpeed'),flow:root.querySelector('.token-flow-panel'),map:root.querySelector('.session-map-panel'),sessions:root.querySelector('.session-panel'),shared:root.querySelector('.shared-backend-panel')};
  for(const id of panels){const panel=elements[id];panel.dataset.panel=id;grid.append(panel);
   const tools=document.createElement('div');tools.className='panel-edit-tools';tools.innerHTML=`<button type="button" draggable="true" class="panel-drag" data-panel-drag="${id}" aria-label="패널 이동">⠿ <span>패널 이동</span></button><div>${id==='speed'?`<span class="instrument-choice" role="group" aria-label="계기 모양">${[['sweep','회전계'],['scope','스코프']].map(([v,n])=>`<button type="button" data-instrument="${v}" aria-pressed="${(state.instrument||'sweep')===v}">${n}</button>`).join('')}</span><button type="button" data-span="3">25%</button>`:id==='summary'?'<button type="button" data-span="9">75%</button>':''}<button type="button" data-span="6">50%</button><button type="button" data-span="12">100%</button></div>`;
   panel.prepend(tools);const resize=document.createElement('button');resize.type='button';resize.className='panel-resize';resize.setAttribute('aria-label','패널 크기 조절');panel.append(resize);
   tools.querySelectorAll('[data-span]').forEach(b=>b.onclick=()=>{state.spans[id]=Number(b.dataset.span);applyPanels();save();});
   tools.querySelectorAll('[data-instrument]').forEach(b=>b.onclick=()=>{state.instrument=b.dataset.instrument;tools.querySelectorAll('[data-instrument]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));save();hooks.layout?.();});
   const handle=tools.querySelector('.panel-drag');handle.ondragstart=e=>{if(!editing){e.preventDefault();return;}e.dataTransfer.setData('application/onetop-panel',id);};
   handle.onkeydown=e=>{if(!editing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const i=state.panels.indexOf(id),j=Math.max(0,Math.min(panels.length-1,i+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)));move(state.panels,id,state.panels[j]);applyPanels();save();handle.focus();};
   panel.ondragover=e=>{if(editing&&[...e.dataTransfer.types].includes('application/onetop-panel'))e.preventDefault();};
   panel.ondrop=e=>{const from=e.dataTransfer.getData('application/onetop-panel');if(!editing||!panels.includes(from))return;e.preventDefault();move(state.panels,from,id);applyPanels();save();};
   resize.onpointerdown=e=>{if(!editing)return;e.preventDefault();dragging=true;const rect=panel.getBoundingClientRect(),width=grid.getBoundingClientRect().width,x=e.clientX,y=e.clientY;resize.setPointerCapture(e.pointerId);
    const onmove=ev=>{if(id==='speed'&&panel.closest('.cockpit-overview'))state.instrumentWidth=Math.max(200,Math.min(600,Math.round(rect.width+ev.clientX-x)));else state.spans[id]=Math.max(id==='summary'?6:3,Math.min(12,Math.round((rect.width+ev.clientX-x+18)/(width+18)*12)));state.heights[id]=Math.max(id==='sessions'?250:150,Math.min(1200,Math.round(rect.height+ev.clientY-y)));applyPanels(false);};
    const end=()=>{dragging=false;resize.removeEventListener('pointermove',onmove);applyPanels();save();};resize.addEventListener('pointermove',onmove);resize.addEventListener('pointerup',end,{once:true});resize.addEventListener('pointercancel',end,{once:true});
   };
   resize.onkeydown=e=>{if(!editing||!e.key.startsWith('Arrow'))return;e.preventDefault();if(e.key==='ArrowLeft'||e.key==='ArrowRight')state.spans[id]=Math.max(id==='summary'?6:3,Math.min(12,state.spans[id]+(e.key==='ArrowLeft'?-1:1)));else state.heights[id]=Math.max(150,Math.min(1200,(state.heights[id]||panel.offsetHeight)+(e.key==='ArrowUp'?-20:20)));applyPanels(false);save();};
  }
  root.querySelector('.session-visuals')?.remove();applyPanels();
 }
 function applyPanels(reorder=true){
  const grid=document.getElementById('dashboardGrid');if(!grid)return;
  const elements=Object.fromEntries([...grid.querySelectorAll('[data-panel]')].map(p=>[p.dataset.panel,p]));
  const paired=state.panels.indexOf('summary')===state.panels.indexOf('speed')+1&&state.spans.speed===3&&state.spans.summary===9;
  let cockpit=grid.querySelector('.cockpit-overview');
  if(reorder||(!dragging&&paired!==!!cockpit)){for(const id of state.panels)grid.append(elements[id]);cockpit?.remove();cockpit=null;if(paired){cockpit=document.createElement('div');cockpit.className='cockpit-overview';elements.speed.before(cockpit);cockpit.append(elements.speed,elements.summary);}}
  if(cockpit)cockpit.style.setProperty('--instrument-width',state.instrumentWidth?state.instrumentWidth+'px':'clamp(280px,19vw,340px)');
  for(const id of state.panels){const panel=elements[id];panel.style.gridColumn='span '+state.spans[id];if(state.heights[id])panel.style.minHeight=state.heights[id]+'px';
   if(id==='sessions'&&state.heights[id])panel.style.height=Math.max(250,state.heights[id])+'px';
   const chart=panel.querySelector('.chart-wrap'),map=panel.querySelector('.map-surface');if(chart&&state.heights[id])chart.style.height=Math.max(130,state.heights[id]-90)+'px';if(map&&state.heights[id])map.style.height=Math.max(130,state.heights[id]-62)+'px';
  }queueDraw();
 }
 function setupColumns(){
  const table=document.querySelector('.sessions-table');table.style.tableLayout='fixed';
  const cols=document.createElement('colgroup');cols.innerHTML=ids.map(id=>`<col data-column="${id}">`).join('');table.prepend(cols);
  [...table.tHead.rows[0].cells].forEach((th,i)=>{
   const id=ids[i];th.dataset.column=id;th.draggable=false;
   const content=th.innerHTML;th.replaceChildren();const label=document.createElement('button');label.type='button';label.className='column-label';label.draggable=true;label.innerHTML=content;
   if(th.id){label.id=th.id;th.removeAttribute('id');}th.append(label);
   if(id==='rate'){const scale=document.createElement('span');scale.className='burn-scale';th.append(scale);}
   const resize=document.createElement('button');resize.type='button';resize.className='column-resize';resize.setAttribute('aria-label','열 너비 조절');resize.title='좌우로 끌어 열 너비 조절';th.append(resize);
   th.ondragstart=e=>{if(dragging||!e.target.closest('.column-label')){e.preventDefault();return;}e.dataTransfer.setData('application/onetop-column',id);};th.ondragover=e=>{if([...e.dataTransfer.types].includes('application/onetop-column'))e.preventDefault();};
   th.ondrop=e=>{const from=e.dataTransfer.getData('application/onetop-column');if(!ids.includes(from))return;e.preventDefault();move(state.columns,from,id);afterTable();save();};
   label.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const delta=e.key==='ArrowLeft'?-1:1;if(e.shiftKey)state.widths[id]=Math.max(minima[id],Math.min(700,state.widths[id]+delta*10));else{const i=state.columns.indexOf(id);move(state.columns,id,state.columns[Math.max(0,Math.min(ids.length-1,i+delta))]);}afterTable();save();label.focus();};
   resize.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();state.widths[id]=Math.max(minima[id],Math.min(700,state.widths[id]+(e.key==='ArrowLeft'?-10:10)));afterTable();save();};
   resize.onpointerdown=e=>{e.preventDefault();e.stopPropagation();dragging=true;const x=e.clientX,w=state.widths[id];resize.setPointerCapture(e.pointerId);const onmove=ev=>{state.widths[id]=Math.max(minima[id],Math.min(700,Math.round(w+ev.clientX-x)));applyWidths();};const end=()=>{dragging=false;resize.removeEventListener('pointermove',onmove);save();afterTable();};resize.addEventListener('pointermove',onmove);resize.addEventListener('pointerup',end,{once:true});resize.addEventListener('pointercancel',end,{once:true});};
  });
 }
 // Saved widths stay as they are. When the panel is narrower than their sum (a narrow window or app
 // zoom), CPU and memory give way before session names drop under about 190px, then each column
 // gives back its room above the minimum.
 // Columns also never get narrower than their header in the page's language ('Total tokens' is wider than
 // '세션 전체 누적'), and two never narrower than their widest content: the status badge ('Needs attention')
 // and the tool, account and effort chips of the model column (up to 220px). Saved widths stay as set.
 function fitted(table){
  const fit={},pads=el=>{const css=getComputedStyle(el);return parseFloat(css.paddingLeft)+parseFloat(css.paddingRight);};
  for(const th of table.querySelectorAll('thead th[data-column]')){
   const label=Math.max(0,...[...th.children].filter(k=>!k.classList.contains('column-resize')).map(k=>k.scrollWidth));
   if(label)fit[th.dataset.column]=Math.ceil(label+pads(th));
  }
  for(const id of ['status','model']){
   const cells=[...table.querySelectorAll(`tbody td[data-column="${id}"]`)].filter(td=>td.firstElementChild);if(!cells.length)continue;
   const content=Math.min(220,Math.ceil(Math.max(...cells.map(td=>Math.max(...[...td.querySelectorAll('*')].map(e=>e.scrollWidth))))+pads(cells[0])));
   fit[id]=Math.max(fit[id]||0,content);
  }
  return fit;
 }
 function applyWidths(){
  const table=document.querySelector('.sessions-table');if(!table)return;
  const fit=fitted(table),floor=id=>Math.max(minima[id],fit[id]||0),wanted=id=>Math.max(state.widths[id],fit[id]||0);
  const room=table.parentElement?.clientWidth||Infinity,spare=id=>Math.max(0,wanted(id)-floor(id));
  const compact=room<190+state.columns.filter(id=>id!=='session').reduce((n,id)=>n+Math.min(wanted(id),floor(id)),0);
  const shown=compact?state.columns.filter(id=>id!=='cpu'&&id!=='memory'):state.columns,sum=shown.reduce((n,id)=>n+wanted(id),0),slack=shown.reduce((n,id)=>n+spare(id),0);
  const cut=sum>room&&slack>0?Math.min(1,(sum-room)/slack):0,width=id=>Math.floor(wanted(id)-spare(id)*cut);
  // Room left over goes to the terminal and project column, whose names would otherwise be cut first.
  const total=shown.reduce((n,id)=>n+width(id),0),extra=Number.isFinite(room)?Math.max(0,room-total):0,final=id=>width(id)+(id==='session'?extra:0);
  table.classList.toggle('compact-columns',compact);
  table.style.width=total+extra+'px';table.style.minWidth='100%';
  table.querySelectorAll('col[data-column]').forEach(c=>c.style.width=final(c.dataset.column)+'px');
 }
 function afterTable(){
  if(!initialized)return;const table=document.querySelector('.sessions-table');
  [...table.tBodies[0].rows].filter(row=>!row.classList.contains('group-row')).forEach(row=>{[...row.cells].forEach((td,i)=>{if(!td.dataset.column)td.dataset.column=ids[i];});for(const id of state.columns){const td=row.querySelector(`td[data-column="${id}"]`);if(td)row.append(td);}});
  for(const id of state.columns){table.tHead.rows[0].append(table.tHead.querySelector(`[data-column="${id}"]`));table.querySelector('colgroup').append(table.querySelector(`col[data-column="${id}"]`));}
  applyWidths();drawGauges();window.OneTopI18n?.apply();
 }
 function number(n){const digits=1;return n>0&&n<10**-digits?'<' +(10**-digits):Number(n.toFixed(digits)).toLocaleString(state.lang==='ko'?'ko-KR':state.lang==='zh'?'zh-CN':'en-US');}
 const rateSuffix=()=>state.lang==='ko'?'%/시간':state.lang==='zh'?'%/小时':'%/h';
 function rateCell(rate,kind,note=''){
  const suffix=rateSuffix();
  if(!Number.isFinite(rate)||rate<0)return `<span class="burn-unavailable" title="${esc(note||t('환산 기준 수집 중'))}">—<small>${suffix}</small></span>`;
  return `<div class="burn-gauge${rate>0?'':' is-zero'}" title="${esc(note)}"><canvas width="72" height="36" data-burn-rate="${rate}" data-kind="${esc(kind)}" role="img" aria-label="${esc(number(rate))}${suffix}"></canvas><strong>${esc(number(rate))}<small>${suffix}</small></strong></div>`;
 }
 function nice(n){if(n<=0)return 1;const power=10**Math.floor(Math.log10(n)),ratio=n/power;return (ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power;}
 function sharedGaugeMax(peak,scope){
  const next=nice(Math.max(1,peak)),now=performance.now();
  // Expand immediately; shrink only after a sustained drop to avoid polling jitter.
  if(scope!==gaugeScale.scope||next>gaugeScale.max)gaugeScale={scope,max:next,lower:null,since:0};
  else if(next<gaugeScale.max&&peak<=gaugeScale.max*.4){
   if(gaugeScale.lower!==next){gaugeScale.lower=next;gaugeScale.since=now;}
   else if(now-gaugeScale.since>=30000)gaugeScale={scope,max:next,lower:null,since:0};
  }else{gaugeScale.lower=null;gaugeScale.since=0;}
  return gaugeScale.max;
 }
 function drawGauges(){
  const canvases=[...document.querySelectorAll('canvas[data-burn-rate]')].filter(c=>c.getBoundingClientRect().width>0),label=document.querySelector('.burn-scale');
  if(!canvases.length){if(label)label.textContent='';return;}
  const scope=state.period+'|'+canvases.map(c=>c.closest('tr')?.dataset.session||'').sort().join('|');
  const max=sharedGaugeMax(Math.max(0,...canvases.map(c=>Number(c.dataset.burnRate))),scope),range='0–'+number(max)+rateSuffix(),css=getComputedStyle(document.documentElement);
  if(label)label.textContent=range;
  for(const c of canvases){const {width:w,height:h}=c.getBoundingClientRect();if(!w||!h)continue;const dpr=devicePixelRatio||1;c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);const n=Number(c.dataset.burnRate),a=Math.PI+Math.PI*Math.min(1,n/max),color=c.dataset.kind==='Claude'?'#d4956b':'#3fae8c';
   c.dataset.burnMax=String(max);c.setAttribute('aria-label',number(n)+rateSuffix()+' ('+range+')');
   // A small speedometer: track, filled arc and needle, with 0 and the shared maximum under the arc ends.
   const cx=w/2,cy=h-12,r=Math.min(w/2-16,h-15),ink=css.getPropertyValue('--ink'),muted=css.getPropertyValue('--muted');
   x.lineCap='round';x.lineWidth=4;x.strokeStyle=css.getPropertyValue('--line');x.beginPath();x.arc(cx,cy,r,Math.PI,Math.PI*2);x.stroke();
   x.strokeStyle=color;x.beginPath();x.arc(cx,cy,r,Math.PI,a);x.stroke();
   x.lineWidth=1.6;x.strokeStyle=n>0?ink:muted;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(a)*(r-6),cy+Math.sin(a)*(r-6));x.stroke();
   x.fillStyle=n>0?ink:muted;x.beginPath();x.arc(cx,cy,2.2,0,Math.PI*2);x.fill();
   x.font=css.getPropertyValue('--type-tiny').trim()+' '+css.getPropertyValue('--font').trim();x.fillStyle=muted;x.textAlign='center';x.fillText('0',cx-r,h-1);x.fillText(number(max)+'%',cx+r,h-1);
  }
 }
 // The table is measured before the page's language is applied; size it again once the text is translated.
 document.addEventListener('onetop-translated',()=>{if(initialized)applyWidths();});
 function init(options){hooks=options;window.OneTopI18n?.setLanguage(state.lang);prefs();panelSetup();setupColumns();initialized=true;afterTable();new ResizeObserver(queueDraw).observe(document.getElementById('dashboardGrid'));}
 return {init,afterTable,rateCell,drawGauges,state,validPeriod,toggleGroup(key,open){state.collapsed={...(state.collapsed||{}),[key]:open};save();},rememberPeriod(value){if(validPeriod(value)){state.period=value;save();}},get interacting(){return dragging;}};
})();
