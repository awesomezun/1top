/* Shared by the local companion and public web dashboard. No dependencies. */
(function(root){
 'use strict';
 const palette=['#6cbda6','#829fd4','#bd9ad6','#d8af77','#7caebc','#cb8f99','#aab67a','#9ba5b6'];
 const safe=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
 const sum=v=>Array.isArray(v)&&v.length===4&&v.every(safe)?v.reduce((a,b)=>a+b,0):null;
 const format=n=>!safe(n)?'—':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1000?(n/1000).toFixed(1)+'k':Math.round(n).toLocaleString();
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const text=(lang,en,ko)=>lang==='en'?en:ko;
 const runtime=s=>s.kind==='Aside'?'':s.kind==='Claude'||s.kind==='GLM'?'Claude Code':s.kind==='Antigravity'?'Agy CLI':s.kind;
 const app=s=>s.app|| (s.orca_terminal?'Orca':s.location?.app)||'—';
 function usage(sessions,period,group='session',lang='ko'){
  let unknown=0,zero=0,known=0;const groups=new Map();
  for(const s of sessions){
   const value=sum(s.usage?.windows?.[period]??s.windows?.[period]);
   if(value==null){unknown++;continue;}known++;if(value===0){zero++;continue;}
   const key=group==='app'?app(s):group==='tool'?(runtime(s)||text(lang,'In-app runtime unreported','앱 내부 도구 미보고')):group==='model'?(s.model||text(lang,'Model unreported','모델 미확인')):s.map_id||s.id;
   const label=group==='session'?(s.project||s.title||s.id):key;
   if(!groups.has(key))groups.set(key,{id:key,label,value:0,count:0,detail:group==='session'?[s.device_name,app(s),s.orca_terminal?.title||s.terminal||s.location?.terminal,runtime(s),s.model].filter(Boolean).join(' · '):'',session:group==='session'?key:null});
   const row=groups.get(key);row.value+=value;row.count++;
  }
  let items=[...groups.values()].sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id));
  const total=items.reduce((n,x)=>n+x.value,0);
  // Keep tiny fragments accessible in the legend without hundreds of DOM tiles.
  if(items.length>48){const rest=items.splice(47);items.push({id:'other',label:text(lang,'Other sessions','그 외 세션'),value:rest.reduce((n,x)=>n+x.value,0),count:rest.reduce((n,x)=>n+x.count,0),detail:rest.length+text(lang,' groups','개 묶음')});}
  items=items.map((x,i)=>({...x,color:palette[i%palette.length],share:x.value/total*100}));
  return {items,total:known?total:null,known,unknown,zero};
 }
 // Balanced recursive partition: each rectangle preserves exact value / total area.
 function layout(items,width=100,height=100){
  const result=[];
  function split(nodes,x,y,w,h){
   if(!nodes.length)return;
   if(nodes.length===1){result.push({...nodes[0],x,y,w,h});return;}
   const total=nodes.reduce((n,v)=>n+v.value,0);let part=0,best=Infinity,cut=1;
   for(let i=1;i<nodes.length;i++){part+=nodes[i-1].value;const delta=Math.abs(total/2-part);if(delta<best){best=delta;cut=i;}}
   const left=nodes.slice(0,cut),right=nodes.slice(cut),ratio=left.reduce((n,v)=>n+v.value,0)/total;
   if(w>=h){split(left,x,y,w*ratio,h);split(right,x+w*ratio,y,w*(1-ratio),h);}
   else{split(left,x,y,w,h*ratio);split(right,x,y+h*ratio,w,h*(1-ratio));}
  }
  split(items.filter(v=>safe(v.value)&&v.value>0),0,0,width,height);return result;
 }
 function context(session,lang='ko'){
  let c=session?.context_usage;
  if(!c&&safe(session?.request_input))c={basis:'last_request_input',input_tokens:session.request_input,capacity:session.context_size,model:session.model,observed_at:session.last_usage};
  if(c?.basis!=='last_request_input'||!safe(c.input_tokens))return {available:false,items:[]};
  const used=c.input_tokens,cap=safe(c.capacity)&&c.capacity>0?c.capacity:null,validCapacity=cap!==null&&cap>=used;
  const labels=[text(lang,'Uncached input','새 입력'),text(lang,'Cache read','캐시 읽기'),text(lang,'Cache write','캐시 쓰기')];
  const parts=Array.isArray(c.parts)&&c.parts.length===3&&c.parts.every(safe)&&Math.abs(c.parts.reduce((a,b)=>a+b,0)-used)<.01?c.parts:null;
  const items=parts?parts.map((value,i)=>({id:'input-'+i,label:labels[i],value,color:palette[i],detail:text(lang,'Latest request input; not a content category.','최근 요청 입력 · 내용별 분류가 아닙니다.')})):[{id:'input',label:text(lang,'Reported input','보고된 입력'),value:used,color:palette[0]}];
  if(validCapacity&&cap>used)items.push({id:'free',label:text(lang,'Remaining capacity','입력 기준 여유'),value:cap-used,color:'#6b7787',free:true,detail:text(lang,'Capacity minus last input; output and reserves are not included.','보고 용량 − 마지막 입력 · 출력·예약 영역은 포함하지 않음')});
  const denominator=validCapacity?cap:used;
  return {available:true,used,cap,validCapacity,over:cap!==null&&cap<used,percent:validCapacity?used/cap*100:null,observed:c.observed_at||0,model:c.model||session.model,items:items.filter(v=>v.value>0).map(v=>({...v,share:denominator?v.value/denominator*100:0}))};
 }
 function draw(element,items,{lang='ko',empty,activate}={}){
  if(!element)return;
  const width=Math.max(1,element.clientWidth||600),height=Math.max(1,element.clientHeight||280);
  const html=layout(items,width,height).map(v=>{
   const detail=[v.label,format(v.value)+' tokens',v.share.toFixed(1)+'%',v.detail].filter(Boolean).join(' · ');
   return `<button type="button" class="map-tile ${v.free?'map-free':''} ${v.w<120||v.h<72?'map-tiny':v.w<210||v.h<135?'map-compact':''}" data-map-id="${esc(v.id)}" style="left:${v.x/width*100}%;top:${v.y/height*100}%;width:${v.w/width*100}%;height:${v.h/height*100}%;--tile-color:${v.color}" aria-label="${esc(detail)}"><span class="map-tile-label">${esc(v.label)}</span><span class="map-tile-value">${format(v.value)}<small> · ${v.share.toFixed(1)}%</small></span><span class="map-tile-detail">${esc(v.detail|| (v.count>1?v.count+text(lang,' sessions','개 세션'):''))}</span></button>`;
  }).join('')||`<div class="map-empty">${esc(empty||text(lang,'No reported usage in this window.','이 기간에 보고된 사용량이 없습니다.'))}</div>`;
  if(element.innerHTML!==html){const focused=element.contains(document.activeElement)?document.activeElement?.dataset.mapId:null;element.innerHTML=html;if(focused)element.querySelector(`[data-map-id="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});}
  // Hide a whole text layer if it cannot fit; never leave clipped fragments.
  element.querySelectorAll('.map-tile:not(.map-tiny)').forEach(tile=>{
   const children=[...tile.children].filter(c=>getComputedStyle(c).display!=='none');
   const style=getComputedStyle(tile),available=tile.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
   const needed=children.reduce((n,c)=>n+c.scrollHeight,0)+Math.max(0,children.length-1)*parseFloat(style.gap||0);
   if(needed>available||children.some(c=>c.scrollWidth>c.clientWidth+1))tile.classList.add('map-tiny');
  });
  const hide=()=>{const tip=document.getElementById('onetop-map-tooltip');if(tip)tip.hidden=true;};
  const show=(tile,event)=>{
   const item=items.find(x=>x.id===tile?.dataset.mapId);if(!item)return;
   let tip=document.getElementById('onetop-map-tooltip');
   if(!tip){tip=document.createElement('div');tip.id='onetop-map-tooltip';tip.className='map-tooltip';tip.setAttribute('role','tooltip');document.body.append(tip);}
   tip.replaceChildren();
   for(const [tag,content] of [['strong',item.label],['span',Math.round(item.value).toLocaleString()+' tokens · '+item.share.toFixed(1)+'%'],['small',item.detail||'']]){const node=document.createElement(tag);node.textContent=content;tip.append(node);}
   tile.setAttribute('aria-describedby',tip.id);tip.hidden=false;
   const rect=tile.getBoundingClientRect(),x=event?.clientX??rect.left+rect.width/2,y=event?.clientY??rect.top;
   tip.style.left=Math.max(10,Math.min(innerWidth-tip.offsetWidth-10,x+14))+'px';
   tip.style.top=Math.max(10,y+tip.offsetHeight+24>innerHeight?y-tip.offsetHeight-12:y+16)+'px';
  };
  element.onpointerover=e=>show(e.target.closest('[data-map-id]'),e);
  element.onpointermove=e=>show(e.target.closest('[data-map-id]'),e);
  element.onpointerleave=hide;
  element.onfocusin=e=>show(e.target.closest('[data-map-id]'));
  element.onfocusout=hide;
  element.onkeydown=e=>{if(e.key==='Escape')hide();};
  element.onclick=e=>{const tile=e.target.closest('[data-map-id]'),id=tile?.dataset.mapId;if(id){show(tile,e);activate?.(items.find(x=>x.id===id));}};
 }
 function legend(items,lang='ko'){
  return items.map(v=>`<span class="map-legend-item" title="${esc(v.detail)}"><i style="background:${v.color}"></i><span>${esc(v.label)}</span><b>${v.share.toFixed(1)}%</b></span>`).join('');
 }
 function contextMarkup(c,lang='ko'){
  if(!c.available)return `<div class="context-total">— <small>${text(lang,'Input report unavailable','입력 사용량 미보고')}</small></div><p class="map-explanation">${text(lang,'No context ratio is inferred from lifetime tokens.','세션 누적 토큰으로 컨텍스트 비율을 추정하지 않습니다.')}</p>`;
  return `<div class="context-total">${format(c.used)} <small>/ ${c.cap?format(c.cap):text(lang,'capacity unknown','용량 미보고')}</small><span class="context-percent">${c.percent===null?'—':c.percent.toFixed(1)+'%'}</span></div><p class="map-explanation">${text(lang,'Last request input','마지막 요청 입력')} · ${esc(c.model||'—')}${c.observed?' · '+new Date(c.observed*1000).toLocaleTimeString(lang==='en'?'en-US':'ko-KR',{hour:'2-digit',minute:'2-digit'}):''}${c.over?' · '+text(lang,'Capacity mismatch','용량 보고 불일치'):''}</p>`;
 }
 root.OneTopMaps={usage,layout,context,draw,legend,contextMarkup,format};
})(globalThis);
