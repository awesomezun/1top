import './maps.js';
import './maps.css';
const M=globalThis.OneTopMaps;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedContext='',selectedUsage='';
export function mapsMarkup(t){return `<section id="usageMaps"><div class="maps-grid"><section class="map-panel"><div class="map-heading"><div><h2>${t('Usage share map','사용량 비율 맵')}</h2><p>${t('Area = reported tokens in the selected window','면적 = 선택 기간의 보고된 토큰')}</p></div><select id="remoteMapGroup" aria-label="${t('Group usage map','사용량 맵 묶음')}"><option value="session">${t('Sessions','세션별')}</option><option value="app">${t('Apps','실행 앱별')}</option><option value="tool">${t('Tools','실행 도구별')}</option><option value="model">${t('Models','모델별')}</option></select></div><div class="map-usage-summary"><div id="remoteMapTotal" class="map-metric"></div><p id="remoteMapCoverage"></p></div><div id="remoteUsageMap" class="map-surface"></div><div id="remoteUsageLegend" class="map-legend"></div><div id="remoteMapSelection" class="map-selection"></div><div class="map-foot">${t('Currently connected sessions on online computers. Unknown values are excluded, not treated as zero.','현재 보고 중인 기기의 연결된 세션 기준입니다. 미보고 값은 면적에서 제외하고 0 사용량과 구분합니다.')}</div></section><section class="map-panel context-panel"><div class="map-heading"><h2>${t('Context map','컨텍스트 맵')}</h2><select id="remoteContextSession" class="map-session-select" aria-label="${t('Select context session','컨텍스트를 볼 세션')}"></select></div><div id="remoteContextSummary" class="context-summary"></div><div id="remoteContextMap" class="map-surface"></div><div id="remoteContextLegend" class="map-legend"></div><div class="map-foot">${t('Last request input, excluding output and reserves. File and system-prompt breakdowns are unreported. Capacity is never guessed from model names.','마지막 요청 입력 기준 · 출력·예약 영역 제외. 파일·시스템 프롬프트별 구성은 미보고이며, 모델명으로 용량을 추정하지 않습니다.')}</div></section></div></section>`;}
export function renderUsageMaps(rows,period,lang){
 const $=id=>document.getElementById(id),t=(en,ko)=>lang==='en'?en:ko;
 if(!$('remoteUsageMap'))return;
 const sessions=rows.filter(s=>s.device.online&&Date.now()-s.device.received<30000).map(s=>({...s,map_id:s.device.id+':'+s.id,device_name:s.device.name}));
 const result=M.usage(sessions,period,$('remoteMapGroup').value,lang);
 $('remoteMapTotal').innerHTML=M.format(result.total)+` <small>tokens · ${esc(period)}</small>`;
 $('remoteMapCoverage').textContent=t(`${result.known} reported · ${result.unknown} unknown · ${result.zero} zero usage`,`${result.known}개 확인 · ${result.unknown}개 미보고 · ${result.zero}개 0 사용량`);
 const selection=item=>$('remoteMapSelection').textContent=item?item.label+' · '+M.format(item.value)+' tokens · '+item.share.toFixed(1)+'%':'';
 selection(result.items.find(x=>x.id===selectedUsage));
 M.draw($('remoteUsageMap'),result.items,{lang,activate:item=>{if(!item)return;selectedUsage=item.id;selection(item);if(item.session){selectedContext=item.session;context();}}});
 $('remoteUsageLegend').innerHTML=M.legend(result.items,lang);
 function context(){
  if(!sessions.some(s=>s.map_id===selectedContext))selectedContext=(sessions.find(s=>M.context(s,lang).validCapacity)||sessions.find(s=>M.context(s,lang).available)||sessions[0])?.map_id||'';
  const select=$('remoteContextSession'),options=sessions.map(s=>`<option value="${esc(s.map_id)}">${esc(s.project)} · ${esc(s.device_name)} · ${esc(s.app)}</option>`).join('');
  if(select.innerHTML!==options)select.innerHTML=options;select.value=selectedContext;
  const c=M.context(sessions.find(s=>s.map_id===selectedContext),lang);
  $('remoteContextSummary').innerHTML=M.contextMarkup(c,lang);
  M.draw($('remoteContextMap'),c.items,{lang,empty:c.available?t('Reported input is zero.','보고된 입력은 0입니다.'):t('Context usage unreported. This does not mean 0%.','컨텍스트 사용량 미보고 · 0%를 뜻하지 않습니다.')});
  $('remoteContextLegend').innerHTML=M.legend(c.items,lang);
 }
 context();$('remoteMapGroup').onchange=()=>renderUsageMaps(rows,period,lang);
 $('remoteContextSession').onchange=e=>{selectedContext=e.target.value;context();};
}
