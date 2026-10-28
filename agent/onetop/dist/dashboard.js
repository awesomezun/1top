/* Persistent presentation controls. No credentials or session data are stored here. */
window.OneTopDashboard=(()=>{
 'use strict';
 const key='onetop.dashboard.v1',ids=['session','model','status','period','total','rate','cpu','memory','controls'];
 const defaults={session:210,model:145,status:85,period:110,total:95,rate:120,cpu:65,memory:75,controls:155};
 const minima={session:120,model:100,status:75,period:95,total:85,rate:120,cpu:65,memory:75,controls:150};
 const panels=['summary','flow','map','sessions','shared'];
 const state={theme:'dark',lang:'ko',unit:'hour',period:'1h',columns:[...ids],widths:{...defaults},panels:[...panels],spans:{summary:12,flow:6,map:6,sessions:12,shared:12},heights:{}};
 let hooks={},editing=false,dragging=false,frame,initialized=false;
 const list=(v,allowed)=>Array.isArray(v)&&v.length===allowed.length&&new Set(v).size===allowed.length&&v.every(x=>allowed.includes(x));
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved){
  for(const [k,values] of Object.entries({theme:['dark','light'],lang:['ko','en','zh'],unit:['hour','minute']}))if(values.includes(saved[k]))state[k]=saved[k];
  if(list(saved.columns,ids))state.columns=saved.columns;if(list(saved.panels,panels))state.panels=saved.panels;
  if(['10m','30m','1h','5h','12h','24h'].includes(saved.period))state.period=saved.period;
  for(const id of ids)if(Number.isFinite(saved.widths?.[id]))state.widths[id]=Math.max(minima[id],Math.min(700,saved.widths[id]));
  for(const id of panels){if(Number.isInteger(saved.spans?.[id]))state.spans[id]=Math.max(id==='summary'?6:3,Math.min(12,saved.spans[id]));if(Number.isFinite(saved.heights?.[id]))state.heights[id]=Math.max(150,Math.min(1200,saved.heights[id]));}
 }}catch{}
 document.documentElement.dataset.theme=state.theme;document.documentElement.style.colorScheme=state.theme;
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(state));}catch{}};
 const t=s=>window.OneTopI18n?.t(s)||s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const queueDraw=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{hooks.layout?.();drawGauges();});};
 function move(array,from,to){const a=array.indexOf(from),b=array.indexOf(to);if(a<0||b<0||a===b)return;array.splice(a,1);array.splice(b,0,from);}
 function prefs(){
  const toolbar=document.getElementById('dashboardPreferences');if(!toolbar)return;
  toolbar.innerHTML=`<button class="theme-switch" type="button" aria-label="${t(state.theme==='dark'?'화이트 모드':'다크 모드')}" title="${t(state.theme==='dark'?'화이트 모드':'다크 모드')}" data-theme-switch>${state.theme==='dark'?'☀':'☾'}</button><div class="pref-segment" role="group" aria-label="${t('언어')}">${[['en','EN'],['ko','한'],['zh','中']].map(([v,n])=>`<button type="button" data-language="${v}" lang="${v}" aria-pressed="${state.lang===v}">${n}</button>`).join('')}</div><button class="edit-dashboard" type="button" aria-pressed="${editing}" id="editDashboard">${editing?'Done':'Edit'}</button>`;
  toolbar.querySelector('[data-theme-switch]').onclick=e=>window.OneTopEffects.reveal(e.currentTarget,()=>{state.theme=state.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=state.theme;document.documentElement.style.colorScheme=state.theme;save();prefs();hooks.layout?.();drawGauges();});
  toolbar.querySelectorAll('[data-language]').forEach(b=>b.onclick=()=>{const next=b.dataset.language;if(next===state.lang&&!window.OneTopEffects.running)return;window.OneTopEffects.reveal(b,()=>{state.lang=next;save();window.OneTopI18n.setLanguage(state.lang);prefs();hooks.refresh?.();afterTable();},next);});
  document.getElementById('editDashboard').onclick=()=>{editing=!editing;document.getElementById('dashboardGrid').classList.toggle('editing',editing);prefs();queueDraw();};
 }
 function panelSetup(){
  const root=document.getElementById('sessionsView'),range=root.querySelector('.range-toolbar');root.prepend(range);
  const grid=document.createElement('div');grid.id='dashboardGrid';range.after(grid);
  const elements={summary:document.getElementById('sessionSummary'),flow:root.querySelector('.token-flow-panel'),map:root.querySelector('.session-map-panel'),sessions:root.querySelector('.session-panel'),shared:root.querySelector('.shared-backend-panel')};
  for(const id of panels){const panel=elements[id];panel.dataset.panel=id;grid.append(panel);
   const tools=document.createElement('div');tools.className='panel-edit-tools';tools.innerHTML=`<button type="button" draggable="true" class="panel-drag" data-panel-drag="${id}" aria-label="패널 이동">⠿ <span>패널 이동</span></button><div><button type="button" data-span="6">½</button><button type="button" data-span="12">↔</button></div>`;
   panel.prepend(tools);const resize=document.createElement('button');resize.type='button';resize.className='panel-resize';resize.setAttribute('aria-label','패널 크기 조절');panel.append(resize);
   tools.querySelectorAll('[data-span]').forEach(b=>b.onclick=()=>{state.spans[id]=Number(b.dataset.span);applyPanels();save();});
   const handle=tools.querySelector('.panel-drag');handle.ondragstart=e=>{if(!editing){e.preventDefault();return;}e.dataTransfer.setData('application/onetop-panel',id);};
   handle.onkeydown=e=>{if(!editing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const i=state.panels.indexOf(id),j=Math.max(0,Math.min(panels.length-1,i+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)));move(state.panels,id,state.panels[j]);applyPanels();save();handle.focus();};
   panel.ondragover=e=>{if(editing&&[...e.dataTransfer.types].includes('application/onetop-panel'))e.preventDefault();};
   panel.ondrop=e=>{const from=e.dataTransfer.getData('application/onetop-panel');if(!editing||!panels.includes(from))return;e.preventDefault();move(state.panels,from,id);applyPanels();save();};
   resize.onpointerdown=e=>{if(!editing)return;e.preventDefault();dragging=true;const rect=panel.getBoundingClientRect(),width=grid.getBoundingClientRect().width,x=e.clientX,y=e.clientY;resize.setPointerCapture(e.pointerId);
    const onmove=ev=>{state.spans[id]=Math.max(id==='summary'?6:3,Math.min(12,Math.round((rect.width+ev.clientX-x+18)/(width+18)*12)));state.heights[id]=Math.max(id==='sessions'?250:150,Math.min(1200,Math.round(rect.height+ev.clientY-y)));applyPanels(false);};
    const end=()=>{dragging=false;resize.removeEventListener('pointermove',onmove);save();};resize.addEventListener('pointermove',onmove);resize.addEventListener('pointerup',end,{once:true});resize.addEventListener('pointercancel',end,{once:true});
   };
   resize.onkeydown=e=>{if(!editing||!e.key.startsWith('Arrow'))return;e.preventDefault();if(e.key==='ArrowLeft'||e.key==='ArrowRight')state.spans[id]=Math.max(id==='summary'?6:3,Math.min(12,state.spans[id]+(e.key==='ArrowLeft'?-1:1)));else state.heights[id]=Math.max(150,Math.min(1200,(state.heights[id]||panel.offsetHeight)+(e.key==='ArrowUp'?-20:20)));applyPanels(false);save();};
  }
  root.querySelector('.session-visuals')?.remove();applyPanels();
 }
 function applyPanels(reorder=true){
  const grid=document.getElementById('dashboardGrid');if(!grid)return;
  for(const id of state.panels){const panel=grid.querySelector(`[data-panel="${id}"]`);if(reorder)grid.append(panel);panel.style.gridColumn='span '+state.spans[id];if(state.heights[id])panel.style.minHeight=state.heights[id]+'px';
   if(id==='sessions'&&state.heights[id])panel.style.height=Math.max(250,state.heights[id])+'px';
   const chart=panel.querySelector('.chart-wrap'),map=panel.querySelector('.map-surface');if(chart&&state.heights[id])chart.style.height=Math.max(130,state.heights[id]-90)+'px';if(map&&state.heights[id])map.style.height=Math.max(130,state.heights[id]-62)+'px';
  }queueDraw();
 }
 function setupColumns(){
  const table=document.querySelector('.sessions-table');table.style.tableLayout='fixed';
  const cols=document.createElement('colgroup');cols.innerHTML=ids.map(id=>`<col data-column="${id}">`).join('');table.prepend(cols);
  [...table.tHead.rows[0].cells].forEach((th,i)=>{
   const id=ids[i];th.dataset.column=id;th.draggable=true;
   const content=th.innerHTML;th.replaceChildren();const label=document.createElement('button');label.type='button';label.className='column-label';label.innerHTML=content;
   if(th.id){label.id=th.id;th.removeAttribute('id');}th.append(label);
   if(id==='rate'){const choices=document.createElement('div');choices.className='rate-units pref-segment';choices.innerHTML='<button type="button" data-rate-unit="hour">시간</button><button type="button" data-rate-unit="minute">분</button>';th.append(choices);choices.onclick=e=>{const b=e.target.closest('[data-rate-unit]');if(b){state.unit=b.dataset.rateUnit;save();hooks.refresh?.();afterTable();}};}
   const resize=document.createElement('button');resize.type='button';resize.className='column-resize';resize.setAttribute('aria-label','열 너비 조절');th.append(resize);
   th.ondragstart=e=>{if(e.target.closest('.column-resize,.rate-units')){e.preventDefault();return;}e.dataTransfer.setData('application/onetop-column',id);};th.ondragover=e=>{if([...e.dataTransfer.types].includes('application/onetop-column'))e.preventDefault();};
   th.ondrop=e=>{const from=e.dataTransfer.getData('application/onetop-column');if(!ids.includes(from))return;e.preventDefault();move(state.columns,from,id);afterTable();save();};
   label.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const delta=e.key==='ArrowLeft'?-1:1;if(e.shiftKey)state.widths[id]=Math.max(minima[id],Math.min(700,state.widths[id]+delta*10));else{const i=state.columns.indexOf(id);move(state.columns,id,state.columns[Math.max(0,Math.min(ids.length-1,i+delta))]);}afterTable();save();label.focus();};
   resize.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();state.widths[id]=Math.max(minima[id],Math.min(700,state.widths[id]+(e.key==='ArrowLeft'?-10:10)));afterTable();save();};
   resize.onpointerdown=e=>{e.preventDefault();e.stopPropagation();dragging=true;const x=e.clientX,w=state.widths[id];resize.setPointerCapture(e.pointerId);const onmove=ev=>{state.widths[id]=Math.max(minima[id],Math.min(700,Math.round(w+ev.clientX-x)));applyWidths();};const end=()=>{dragging=false;resize.removeEventListener('pointermove',onmove);save();afterTable();};resize.addEventListener('pointermove',onmove);resize.addEventListener('pointerup',end,{once:true});resize.addEventListener('pointercancel',end,{once:true});};
  });
 }
 function applyWidths(){const table=document.querySelector('.sessions-table');if(!table)return;table.style.width=state.columns.reduce((n,id)=>n+state.widths[id],0)+'px';table.style.minWidth='100%';table.querySelectorAll('col[data-column]').forEach(c=>c.style.width=state.widths[c.dataset.column]+'px');}
 function afterTable(){
  if(!initialized)return;const table=document.querySelector('.sessions-table');
  [...table.tBodies[0].rows].forEach(row=>{[...row.cells].forEach((td,i)=>{if(!td.dataset.column)td.dataset.column=ids[i];});for(const id of state.columns){const td=row.querySelector(`td[data-column="${id}"]`);if(td)row.append(td);}});
  for(const id of state.columns){table.tHead.rows[0].append(table.tHead.querySelector(`[data-column="${id}"]`));table.querySelector('colgroup').append(table.querySelector(`col[data-column="${id}"]`));}
  document.querySelectorAll('[data-rate-unit]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.rateUnit===state.unit)));applyWidths();drawGauges();window.OneTopI18n?.apply();
 }
 function number(n){const digits=state.unit==='minute'?3:2;return n>0&&n<10**-digits?'<' +(10**-digits):Number(n.toFixed(digits)).toLocaleString(state.lang==='ko'?'ko-KR':state.lang==='zh'?'zh-CN':'en-US');}
 function rateCell(rate,kind,note=''){
  if(!Number.isFinite(rate)||rate<0)return '<span class="unknown-value">—</span>';
  const suffix=state.lang==='ko'?(state.unit==='hour'?'%/시간':'%/분'):state.lang==='zh'?(state.unit==='hour'?'%/小时':'%/分钟'):(state.unit==='hour'?'%/h':'%/min');
  return `<div class="burn-gauge" title="${esc(note)}"><canvas width="96" height="46" data-burn-rate="${rate}" data-kind="${esc(kind)}" role="img" aria-label="${esc(number(rate/(state.unit==='minute'?60:1)))}${suffix}"></canvas><strong>${esc(number(rate/(state.unit==='minute'?60:1)))}<small>${suffix}</small></strong></div>`;
 }
 function nice(n){if(n<=0)return 1;const power=10**Math.floor(Math.log10(n)),ratio=n/power;return (ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power;}
 function drawGauges(){
  const canvases=[...document.querySelectorAll('canvas[data-burn-rate]')],max=nice(Math.max(1,...canvases.map(c=>Number(c.dataset.burnRate)))),css=getComputedStyle(document.documentElement);
  for(const c of canvases){const {width:w,height:h}=c.getBoundingClientRect();if(!w||!h)continue;const dpr=devicePixelRatio||1;c.width=w*dpr;c.height=h*dpr;const x=c.getContext('2d');x.scale(dpr,dpr);const cx=w/2,cy=h-11,r=Math.min(29,w/2-13),n=Number(c.dataset.burnRate),a=Math.PI+Math.PI*Math.min(1,n/max),color=c.dataset.kind==='Claude'?'#bd8965':'#378d76';
   x.lineWidth=5;x.strokeStyle=css.getPropertyValue('--line');x.beginPath();x.arc(cx,cy,r,Math.PI,Math.PI*2);x.stroke();x.strokeStyle=color;x.beginPath();x.arc(cx,cy,r,Math.PI,a);x.stroke();x.lineWidth=1.5;x.beginPath();x.moveTo(cx,cy);x.lineTo(cx+Math.cos(a)*(r-8),cy+Math.sin(a)*(r-8));x.stroke();x.font='11px "IBM Plex Sans",sans-serif';x.fillStyle=css.getPropertyValue('--muted');x.textAlign='left';x.fillText('0',4,h-1);x.textAlign='right';x.fillText(number(max/(state.unit==='minute'?60:1))+'%',w-2,h-1);
  }
 }
 function init(options){hooks=options;window.OneTopI18n?.setLanguage(state.lang);prefs();panelSetup();setupColumns();initialized=true;afterTable();new ResizeObserver(queueDraw).observe(document.getElementById('dashboardGrid'));}
 return {init,afterTable,rateCell,drawGauges,state,rememberPeriod(value){state.period=value;save();},get interacting(){return dragging;}};
})();
