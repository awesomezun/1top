import './maps.js';
import './maps.css';
const M=globalThis.OneTopMaps;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedUsage='';
export function mapsMarkup(t){return `<section id="usageMaps"><div class="maps-grid"><section class="map-panel"><div class="map-heading"><div><h2>${t('Usage share map','사용량 비율 맵')}</h2><p>${t('Area = reported tokens in the selected window','면적 = 선택 기간의 보고된 토큰')}</p></div><select id="remoteMapGroup" aria-label="${t('Group usage map','사용량 맵 묶음')}"><option value="session">${t('Sessions','세션별')}</option><option value="app">${t('Apps','실행 앱별')}</option><option value="tool">${t('Tools','실행 도구별')}</option><option value="model">${t('Models','모델별')}</option></select></div><div class="map-usage-summary"><div id="remoteMapTotal" class="map-metric"></div><p id="remoteMapCoverage"></p></div><div id="remoteUsageMap" class="map-surface"></div><div id="remoteUsageLegend" class="map-legend"></div><div id="remoteMapSelection" class="map-selection"></div><div class="map-foot">${t('Currently connected sessions on online computers. Unknown values are excluded, not treated as zero.','현재 보고 중인 기기의 연결된 세션 기준입니다. 미보고 값은 면적에서 제외하고 0 사용량과 구분합니다.')}</div></section></div></section>`;}
export function renderUsageMaps(rows,period,lang){
 const $=id=>document.getElementById(id),t=(en,ko)=>lang==='en'?en:ko;
 if(!$('remoteUsageMap'))return;
 const sessions=rows.filter(s=>s.device.online&&Date.now()-s.device.received<30000).map(s=>({...s,map_id:s.device.id+':'+s.id,device_name:s.device.name}));
 const result=M.usage(sessions,period,$('remoteMapGroup').value,lang);
 $('remoteMapTotal').innerHTML=M.format(result.total)+` <small>tokens · ${esc(period)}</small>`;
 $('remoteMapCoverage').textContent=t(`${result.known} reported · ${result.unknown} unknown · ${result.zero} zero usage`,`${result.known}개 확인 · ${result.unknown}개 미보고 · ${result.zero}개 0 사용량`);
 const selection=item=>$('remoteMapSelection').textContent=item?item.label+' · '+M.format(item.value)+' tokens · '+item.share.toFixed(1)+'%':'';
 selection(result.items.find(x=>x.id===selectedUsage));
 M.draw($('remoteUsageMap'),result.items,{lang,activate:item=>{if(!item)return;selectedUsage=item.id;selection(item);}});
 $('remoteUsageLegend').innerHTML=M.legend(result.items,lang);
 $('remoteMapGroup').onchange=()=>renderUsageMaps(rows,period,lang);
}
