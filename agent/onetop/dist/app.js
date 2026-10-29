'use strict';
const $=id=>document.getElementById(id),kinds=['Claude','Codex','GLM','Antigravity','Aside'];
const colors={Claude:'#bd8965',Codex:'#378d76',GLM:'#7c86bd',Antigravity:'#619db9',Aside:'#a99bdb'};
const labels={working:'작업 중',waiting:'확인 필요',idle:'대기 중',unknown:'미확인',interrupted:'중단됨',paused:'일시정지',resuming:'재개 요청 중'};
let data=null,provider='all',view='sessions',selectedId=null,busy=false,actionBusy=false,pendingAction=null,toastTimer,benchmark=null,selectedPeriod=OneTopDashboard.state.period,usageUnit='weekly',mapGroup='session';
// Upgrade selections saved by the former continuous slider once; keep explicit
// text entries made with the new control on subsequent reloads.
if(OneTopDashboard.state.rangeScale!=='fixed-v1'){
 selectedPeriod=OneTopRanges.fromPosition(OneTopRanges.position(selectedPeriod));
 OneTopDashboard.state.rangeScale='fixed-v1';OneTopDashboard.rememberPeriod(selectedPeriod);
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'—':n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':Number(n.toFixed(1)).toLocaleString(OneTopI18n.locale());
const bytes=n=>n==null?'—':n>=2**30?(n/2**30).toFixed(1)+' GB':n>=2**20?(n/2**20).toFixed(0)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':Math.round(n)+' B';
const exact=n=>n==null?'확인 불가':Math.round(n).toLocaleString(OneTopI18n.locale());
const total=v=>v?v.reduce((a,b)=>a+b,0):null;
const pct=n=>n==null?'—':n.toFixed(1)+'%';
const loadAverage=values=>Array.isArray(values)&&values.length&&values.every(Number.isFinite)?values.map(n=>n.toFixed(2)).join(' / '):'미보고';
const time=t=>new Date(t*1000).toLocaleTimeString(OneTopI18n.locale(),{hour12:false,hour:'2-digit',minute:'2-digit'});
const ago=t=>{if(!t)return '보고 없음';const n=Math.max(0,Date.now()/1000-t);return n<5?'방금':n<60?Math.floor(n)+'초 전':n<3600?Math.floor(n/60)+'분 전':n<86400?Math.floor(n/3600)+'시간 전':Math.floor(n/86400)+'일 전';};
// How old a value that could not be refreshed is, so an old % never reads as current: "38분 전 보고".
const reportAge=t=>t?ago(t)+' 보고':'마지막 보고';
// A limit that cannot refresh until the account is connected again says so, not just how old it is.
const RECONNECT=new Set(['login_required','login_expired','credential_store_unavailable','access_denied']);
const staleLabel=q=>RECONNECT.has(q.status)?'재연결 필요':reportAge(q.updated);
const model=m=>(m||'모델 미확인').replace(/\[1m\]/gi,'').replace(/^claude-/,'').replace(/^gpt-/,'GPT-');
const reportedEffort=s=>typeof s.effort==='string'&&s.effort.trim()?s.effort:'';
const effortBadge=s=>reportedEffort(s)?` <span class="count" title="보고된 추론 강도 (reasoning effort)">${esc(reportedEffort(s))}</span>`:'';
const kindName=k=>k==='Claude'?'Claude Code':k==='Antigravity'?'Agy CLI':k;
// Several signed-in accounts of one tool are numbered by account name (Claude Code 1, 2), so a session
// and its account's limit tile can be matched at a glance. A tool with one account shows no number.
function accountNumbers(){const by={},out={};for(const q of data?.account_quotas||[])(by[q.kind]||=[]).push(q);
 for(const list of Object.values(by)){if(list.length<2)continue;const name=q=>String(q.account_label||q.id).toLowerCase();list.sort((a,b)=>name(a)<name(b)?-1:name(a)>name(b)?1:0).forEach((q,i)=>out[q.id]=i+1);}return out;}
const accountChip=(id,label)=>{const alias=id&&data?.account_quotas?.find(q=>q.id===id)?.alias,n=id&&accountNumbers()[id];
 return alias?` <span class="account-no is-alias" title="${esc(label||'')}" data-user-content>${esc(alias)}</span>`:n?` <span class="account-no" title="${esc(label||'')}">${n}</span>`:'';};
const sessionAccount=s=>s.usage?.weekly_estimate?.[selectedPeriod]?.account_id||s.usage?.weekly_account;
const hostApp=s=>s.orca_terminal?'Orca':s.location?.app||'실행 앱 미확인';
const runtimeLabel=s=>s.kind==='Aside'?'앱 내부 세션':s.kind==='Claude'||s.kind==='GLM'?'Claude Code':kindName(s.kind);
const display=s=>(s.children_working||0)>0?'working':s.display_status||s.status;
const visibleSessions=()=>data?.root_sessions??data?.sessions??[];
// Aside conversations opened without a project run in ~/.aside/u/<n>; show that as Aside's own workspace, not as a project named "0".
const asideHome=s=>s.kind==='Aside'&&/\/\.aside\/u\/[^/]+\/?$/.test(s.cwd||'');
function normalizeSessions(state){for(const s of state?.sessions||[])if(asideHome(s))s.project='Aside 기본 작업공간';for(const s of state?.root_sessions||[])if(asideHome(s))s.project='Aside 기본 작업공간';}
const expandedSessions=new Set();
const dot=k=>`<i class="dot" style="background:${colors[k]}"></i>`;
const status=s=>`<span class="status ${esc(display(s))}"><i class="dot"></i>${s.loading?'기록 읽는 중':labels[display(s)]||'미확인'}</span>`;
function showToast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?14000:8000);}
const ICONS={focus:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4.5h6v6M11.2 4.8 4.5 11.5"/></svg>',pause:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 4v8M10.5 4v8"/></svg>',resume:'<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.8 12 8l-6.5 4.2z"/></svg>',terminate:'<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1"/></svg>'};
function actions(s){
 const identified=!!s.control_key,fresh=data?.updated&&Date.now()/1000-data.updated<20;
 const stopped=['idle','interrupted'].includes(s.status),active=['working','waiting'].includes(s.status);
 const canPause=identified&&active&&(s.kind==='Aside'||(!!s.orca_terminal&&s.input_verified!==false&&['Claude','GLM','Codex'].includes(s.kind)));
 const controlState=s.display_status||s.status,paused=controlState==='paused',resuming=controlState==='resuming';
 const list=[['focus','↗',identified&&!!(s.orca_terminal||s.location?.app_path),'실행 앱·터미널 바로가기'],paused?['resume','재개',identified&&!!s.orca_terminal&&s.input_verified!==false&&stopped,'이어서 작업하는 새 요청 보내기']:['pause','일시정지',canPause&&!resuming,'현재 작업 중단 후 세션 보존'],['terminate','정지',s.kind!=='Aside'&&identified&&(stopped||canPause)&&!resuming,'해당 CLI 프로세스 종료']];
 return `<div class="session-actions">${list.map(([a,label,enabled,hint])=>`<button class="action-button ${a}" data-action="${a}" data-target="${esc(s.id)}" ${!enabled||!fresh||actionBusy?'disabled':''} title="${esc(label+' · '+(enabled?hint:'세션 연결 또는 작업 상태 확인 필요'))}" aria-label="${esc((s.orca_terminal?.title||s.project)+' · '+label)}">${ICONS[a]}</button>`).join('')}</div>`;
}
function selectView(next){view=next;$('pageTitle').textContent=({sessions:'대시보드',maps:'사용량 맵',accounts:'계정 한도',operations:'활동',system:'컴퓨터 리소스',benchmark:'측정 정보'})[next];for(const v of ['sessions','accounts','maps','operations','system','benchmark'])$(v+'View').hidden=v!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));requestAnimationFrame(()=>{drawCharts();renderMaps();drawWeeklyCharts();drawHistory();});if(next!=='maps')hideTip();}
function periodMeta(){return data?.period_usage?.windows.find(w=>w.key===selectedPeriod);}
function periodCaption(w=periodMeta()){return w?.key==='all'?'전체 기록':'최근 '+(w&&customPeriod(w.key)?OneTopRanges.label(w.key,OneTopI18n.language||'ko'):w?.label||selectedPeriod);}
const customPeriod=key=>key==='all'||key.startsWith('custom:');
function periodVector(w){const p=data.period_usage;return provider==='all'?(p.known_kinds.length?w.tokens:null):p.known_kinds.includes(provider)?(w.by_kind[provider]||[0,0,0,0]):null;}
function recordedDuration(seconds){const m=Math.floor(seconds/60);return m<1?'1분 미만':m<60?m+'분':Math.floor(m/60)+'시간'+(m%60?' '+m%60+'분':'');}
function selectPeriod(key){
 if(!OneTopDashboard.validPeriod(key))return;
 selectedPeriod=key;OneTopDashboard.rememberPeriod(key);
 if(customPeriod(key)||data?.chart_range)refresh();
 else render();
}
function rangeCaption(key){return OneTopI18n.t(key==='all'?'전체 기록':'최근 '+OneTopRanges.label(key,OneTopI18n.language||'ko'));}
function updateRangeControls(){
 const lang=OneTopI18n.language||'ko',max=OneTopRanges.stops.length-1;
 document.querySelectorAll('.range-buttons').forEach(el=>{
  const heading=el.closest('.range-toolbar').querySelector('[data-range-label]');
  if(!el.querySelector('.duration-slider')){
   el.innerHTML='<div class="range-slider-row"><div class="range-scale"><input class="duration-slider" type="range" min="0" max="18" step="1" aria-label="사용 기간"><div class="range-ticks"><button type="button" data-range-stop="0" style="left:0%">10분</button><button type="button" data-range-stop="3" style="left:16.6667%">1시간</button><button type="button" data-range-stop="6" style="left:33.3333%">5시간</button><button type="button" data-range-stop="9" style="left:50%">1일</button><button type="button" data-range-stop="12" style="left:66.6667%">1주일</button><button type="button" data-range-stop="14" style="left:77.7778%">1개월</button><button type="button" data-range-stop="18" style="left:100%">전체</button></div></div></div>';
   el.querySelectorAll('[data-range-stop]').forEach(button=>button.onclick=()=>{selectPeriod(OneTopRanges.fromPosition(button.dataset.rangeStop));updateRangeControls();});
   const slider=el.querySelector('.duration-slider');
   slider.oninput=()=>{slider.dataset.sliding='true';const key=OneTopRanges.fromPosition(slider.value);heading.textContent=rangeCaption(key);slider.setAttribute('aria-valuetext',OneTopRanges.label(key,OneTopI18n.language));slider.style.setProperty('--position',Number(slider.value)/Number(slider.max)*100+'%');};
   slider.onchange=()=>{delete slider.dataset.sliding;selectPeriod(OneTopRanges.fromPosition(slider.value));};
   slider.onpointercancel=()=>{delete slider.dataset.sliding;updateRangeControls();};
  }
  const slider=el.querySelector('.duration-slider');
  if(slider.dataset.sliding)return;
  heading.textContent=rangeCaption(selectedPeriod);
  slider.max=max;slider.value=OneTopRanges.position(selectedPeriod);slider.setAttribute('aria-valuetext',OneTopRanges.label(selectedPeriod,lang));slider.style.setProperty('--position',Number(slider.value)/Number(slider.max)*100+'%');
 });
}
function renderPeriods(){
 const p=data.period_usage;if(!p)return;
 const focus=document.activeElement?.dataset.period;
 $('periodCards').classList.remove('time-buttons');
 $('periodTitle').textContent='기간별 누적 사용량';
 $('periodScope').textContent=(provider==='all'?'수집된 세션 전체':kindName(provider)+'의 수집된 세션')+' · 종료된 세션 포함';
 $('periodCards').innerHTML=p.windows.map(w=>{const v=periodVector(w);return `<button class="period-card ${w.key===selectedPeriod?'selected':''}" data-period="${w.key}" aria-pressed="${w.key===selectedPeriod}" title="${v?exact(total(v))+' tokens':'수집된 사용량 보고 없음'}"><span class="period-label">최근 ${w.label}</span><b>${fmt(total(v))}<small> tokens</small></b><span class="period-output">${v?'출력 '+fmt(v[3]):'사용량 미확인'}</span></button>`;}).join('');
 if(focus)document.querySelector(`[data-period="${focus}"]`)?.focus({preventScroll:true});
 $('periodCoverage').textContent='기록된 사용량 · 미보고 사용량 제외';
 updateRangeControls();
 const w=periodMeta();if(w){const label=periodCaption(w),unit=usageUnit==='weekly'?'주간 한도 사용 %':'누적 tokens';if($('periodColumn').dataset.label!==label+unit){$('periodColumn').dataset.label=label+unit;$('periodColumn').innerHTML=`${esc(label)}<small class="column-unit">${unit}</small>`;}}
}

function render(){
 if(!data?.ready)return;
 $('localVersion').textContent='LOCAL · v'+data.version;
 $('footerVersion').textContent='1top '+data.version+' · 이 컴퓨터의 로컬 데이터';
 const scoped=visibleSessions().filter(s=>provider==='all'||s.kind===provider),known=scoped.filter(s=>s.tokens!==null);
 const selectedModel=$('modelFilter').value;
 $('modelFilter').innerHTML='<option value="all">모든 모델</option>'+[...new Set(data.sessions.map(s=>s.model||''))].sort().map(m=>`<option value="${esc(m)}">${esc(m||'모델 미확인')}</option>`).join('');
 $('modelFilter').value=[...$('modelFilter').options].some(o=>o.value===selectedModel)?selectedModel:'all';
 const work=scoped.filter(s=>display(s)==='working').length,paused=scoped.filter(s=>display(s)==='paused').length,rate=scoped.reduce((n,s)=>n+(s.usage?.rate||0),0);
 $('summary').innerHTML=`<div class="summary-item"><span class="label">열린 세션 / CLI</span><b>${scoped.length}<small>개</small></b></div><div class="summary-item"><span class="label">작업 중 · 일시정지</span><b class="accent">${work}<small>작업 · ${paused} 정지</small></b></div><div class="summary-item"><span class="label">현재 연결된 세션 누적</span><b>${known.length?fmt(known.reduce((n,s)=>n+total(s.tokens),0)):'—'}<small>tokens</small></b></div><div class="summary-item"><span class="label">현재 소비 속도</span><b class="accent">${known.length?fmt(rate):'—'}<small>tokens/s</small></b></div><div class="summary-note">${known.length}/${scoped.length}개 토큰 확인<br>Orca 탭 ${data.orca_terminals??'—'}개 · CLI ${Object.values(data.process_counts).reduce((a,b)=>a+b,0)}개</div>`;
 $('tableSubtitle').textContent=scoped.some(s=>s.children_count)?`상위 세션 ${scoped.length}개 · 하위 ${scoped.reduce((n,s)=>n+(s.children_count||0),0)}개 묶음`:`${scoped.filter(s=>s.orca_terminal).length}개 터미널 연결`;
 $('filterStrip').hidden=provider==='all';$('filterName').textContent=provider==='all'?'':kindName(provider)+' 세션';
 $('lastUpdated').textContent=`마지막 수집 ${time(data.updated)} · 토큰 변화 수집 시작 ${new Date(data.started*1000).toLocaleDateString(OneTopI18n.locale())} ${time(data.started)}`;
 $('notice').hidden=!data.error;
 $('notice').textContent=data.error?'일부 데이터 수집이 지연되고 있습니다. 마지막으로 확인한 수치를 표시합니다.':'';
 renderPeriods();renderFleetSpeed();renderWeekly();renderSessionSummary();renderHost();renderTable();renderMaps();renderQuotas();renderSystem();renderBenchmark();renderOperations();
 if(selectedId&&$('detailDialog').open)renderDetail(selectedId);
 drawCharts();
}
function renderSessionSummary(){
 const h=data.system?.host;
 const track=value=>OneTopWeekly.valid(value)?`<i class="summary-mini-track" aria-hidden="true"><i style="width:${Math.min(100,value)}%"></i></i>`:'';
 const resource=(name,value,hint,percent)=>`<button class="session-resource" data-summary-view="system" title="${esc(hint)}"><span>${name}</span><b>${value}</b>${track(percent)}</button>`;
 $('sessionResourceStrip').innerHTML=resource('CPU',pct(h?.cpu),'전체 컴퓨터 CPU 사용률',h?.cpu)+resource('메모리',pct(h?.memory?.percent),`${bytes(h?.memory?.used)} / ${bytes(h?.memory?.total)}`,h?.memory?.percent)+resource('네트워크',`${bytes(h?.network?.rx)}/s ↓`,`업로드 ${bytes(h?.network?.tx)}/s ↑`)+resource('디스크',bytes(h?.disk?.free),'남은 저장 공간');
 $('sessionAccountStrip').innerHTML=(data.account_quotas||[]).map(q=>{
  const n=OneTopWeekly.weekly(q)?.pct,known=OneTopWeekly.valid(n),current=known&&!q.stale;
  const label=q.account_label||q.plan||'계정 확인 중',shortLabel=label.includes('@')?label.split('@')[0]:label;
  const note=current?`${OneTopWeekly.percent(n)} 사용 · 주간 한도 100% 기준`:OneTopWeekly.valid(n)?`${reportAge(q.updated)} ${OneTopWeekly.percent(n)} · ${RECONNECT.has(q.status)?'재연결 필요':'최신 보고 대기'}`:'주간 사용량 보고 대기';
  return `<button class="session-account ${known?(current?'':'is-last-report'):'is-pending'}" data-summary-view="accounts" style="--account-color:${colors[q.kind]||'#8d9ba8'}" title="${esc(kindName(q.kind)+' · '+label+'\n'+note)}"><i></i><span class="session-account-identity"><b>${esc(kindName(q.kind))}${accountChip(q.id,q.account_label)}</b><small>${esc(shortLabel)}</small></span><strong>${known?OneTopWeekly.percent(n)+(current?'':`<small>${esc(staleLabel(q))}</small>`):'보고 대기'}</strong>${track(n)}</button>`;
 }).join('')||'<button class="session-accounts-empty" data-summary-view="accounts">계정 연결 · 사용량 보고 대기 ↗</button>';
}
let speedScale={key:null,max:1,lower:0,since:0};
function renderFleetSpeed(){
 const s=OneTopSpeed.measure(data,selectedPeriod),rate=s.rate===null?null:s.rate*3600,next=OneTopSpeed.niceMax(rate),now=Date.now();
 if(speedScale.key!==selectedPeriod||next>speedScale.max)speedScale={key:selectedPeriod,max:next,lower:0,since:0};
 else if(next<speedScale.max&&rate<speedScale.max*.4){if(speedScale.lower!==next){speedScale.lower=next;speedScale.since=now;}else if(now-speedScale.since>30000)speedScale.max=next;}
 else speedScale.lower=0;
 const displayRate=fmt(rate),parts=displayRate.match(/^(.+?)([kMBT])$/);
 $('fleetSpeedValue').innerHTML=parts?esc(parts[1])+'<small>'+parts[2]+'</small>':esc(displayRate);
 $('fleetSpeedUnit').textContent=OneTopI18n.t('tokens/시간');
 $('fleetSpeedScope').textContent=OneTopI18n.t('컴퓨터')+' '+(s.computers===s.expected?s.computers:s.computers+'/'+s.expected);
 $('fleetSpeedScope').title=OneTopI18n.t(s.partial?'확인된 기록 기준':'연결된 모든 AI 사용량');
 $('fleetSpeedValue').title=OneTopI18n.t('선택 기간 평균');
 const band=$('fleetSpeedBand');
 band.dataset.rate=rate===null?'':String(rate);band.dataset.max=String(speedScale.max);
 band.setAttribute('aria-label',fmt(rate)+' '+OneTopI18n.t('tokens/시간'));
 if(rate===null)band.removeAttribute('aria-valuenow');else band.setAttribute('aria-valuenow',rate);
 band.setAttribute('aria-valuemax',speedScale.max);
 drawFleetSpeed();
}
// Per-bin rates (tokens/hour) by AI tool for the radar, from the same events as the token flow chart.
function speedBins(){
 const minutes=(periodMeta()?.seconds||3600)/60,flow=tokenFlowData(data.events||[],minutes,data.updated,data.chart_range),per=3600/flow.step;
 let bins=flow.bins.map(bin=>({parts:flow.series.map(k=>[k,(bin[k]||0)*per])}));
 if(bins.length>96){const k=Math.ceil(bins.length/96);bins=Array.from({length:Math.ceil(bins.length/k)},(_,i)=>{const part=bins.slice(i*k,i*k+k);return {parts:flow.series.map((kind,j)=>[kind,part.reduce((n,b)=>n+b.parts[j][1],0)/part.length])};});}
 for(const bin of bins)bin.total=bin.parts.reduce((n,[,v])=>n+v,0);
 return bins;
}
// The instrument keeps one skeleton: the glow filter, a motion layer and the face. Polls only repaint the
// face, so the scanner keeps moving. A new reading glides from the previous one, the first one rises
// from zero, and on the radar the bars grow out from the centre when the period changes.
const speedView={style:null,moving:null,key:null,shown:null,from:null,to:null,start:0,grownAt:0,grow:1,frame:0,bars:[]};
function drawFleetSpeed(){
 const svg=$('fleetSpeedBand');if(!svg?.querySelector||!data?.ready)return;
 const rate=svg.dataset.rate===''?null:Number(svg.dataset.rate),style=OneTopDashboard.state.instrument==='scope'?'scope':'sweep';
 const still=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(!svg.querySelector('[data-face]')){svg.innerHTML=`<defs>${OneTopSpeed.glowFilter}</defs><g data-under></g><g data-face></g><g data-over></g>`;speedView.style=null;}
 const moving=rate>0&&!still;
 if(speedView.style!==style||speedView.moving!==moving){
  svg.querySelector('[data-under]').innerHTML=moving&&style==='scope'?OneTopSpeed.motion(style):'';
  svg.querySelector('[data-over]').innerHTML=moving&&style==='sweep'?OneTopSpeed.motion(style):'';
  speedView.style=style;speedView.moving=moving;
 }
 radarLoop(moving&&style==='scope');
 const key=selectedPeriod+'|'+style;
 if(still||rate===null){cancelAnimationFrame(speedView.frame);speedView.key=key;speedView.grow=1;speedView.shown=speedView.to=rate;paintFleetSpeed(rate);return;}
 if(speedView.key!==key){speedView.key=key;speedView.grownAt=performance.now();speedView.grow=0;if(speedView.shown===null)speedView.shown=0;speedView.from=speedView.shown;speedView.to=rate;speedView.start=performance.now();animateFleetSpeed();return;}
 if(rate!==speedView.to){speedView.from=speedView.shown??0;speedView.to=rate;speedView.start=performance.now();animateFleetSpeed();return;}
 if(!speedView.frame)paintFleetSpeed(speedView.shown);
}
function animateFleetSpeed(){
 cancelAnimationFrame(speedView.frame);
 const tick=now=>{
  const pe=Math.min(1,(now-speedView.start)/700),pg=Math.min(1,(now-speedView.grownAt)/800);
  speedView.shown=speedView.from+(speedView.to-speedView.from)*(1-(1-pe)**3);speedView.grow=1-(1-pg)**3;
  paintFleetSpeed(speedView.shown);
  speedView.frame=pe<1||pg<1?requestAnimationFrame(tick):0;
 };
 speedView.frame=requestAnimationFrame(tick);
}
function paintFleetSpeed(rate){
 const svg=$('fleetSpeedBand'),face=svg?.querySelector('[data-face]');if(!face)return;
 const t=s=>OneTopI18n.t(s),style=OneTopDashboard.state.instrument==='scope'?'scope':'sweep',caption=t(periodCaption());
 face.innerHTML=OneTopSpeed.face({style,rate,max:Number(svg.dataset.max)||1,grow:speedView.grow,color:k=>colors[k]||'#8b939f',bins:style==='scope'&&rate!==null?speedBins():null,
  text:{perHour:t('tokens/시간'),checking:t('확인 중'),connecting:t('수집기 연결 확인 중'),average:caption+' '+t('평균'),avgShort:t('평균'),range:t('범위'),rangeValue:caption,scale:t('눈금'),peak:t('최고'),low:t('최저'),now:t('지금')}});
 speedView.bars=[...face.querySelectorAll('.fs-bar')];
 if(radar.frame)lightRadar(radar.head);
}
// Radar beam: one turn every 4.5 s. Bars light up as it passes and fade until it comes round; the
// "now" marker breathes. Runs at about 30 fps only while the radar is shown and tokens flow.
const radar={frame:0,last:0,head:0};
function radarLoop(on){
 if(!on){cancelAnimationFrame(radar.frame);radar.frame=0;return;}
 if(radar.frame)return;
 const tick=now=>{
  radar.frame=requestAnimationFrame(tick);
  if(document.hidden||now-radar.last<33)return;
  radar.last=now;radar.head=(now/1000*80)%360;lightRadar(radar.head);
 };
 radar.frame=requestAnimationFrame(tick);
}
function lightRadar(head){
 const svg=$('fleetSpeedBand'),beam=svg?.querySelector('[data-radar]');if(!beam)return;
 beam.setAttribute('transform',`rotate(${head.toFixed(1)} 126 98)`);
 // Each bin rests at its age's brightness and lights up as the beam passes.
 for(const bar of speedView.bars){if(bar.classList.contains('is-now'))continue;const behind=(head-Number(bar.dataset.a)+720)%360,rest=Number(bar.dataset.rest)||.42;bar.style.opacity=(rest+(1-rest)*.75*Math.exp(-behind/75)).toFixed(2);}
 const marker=svg.querySelector('.fs-now');if(marker)marker.style.opacity=(.65+.35*Math.sin(performance.now()/1000*3.2)).toFixed(2);
}

function renderHost(){
 const h=data.system?.host;if(!h)return;
 const card=(title,value,unit,sub,percent,warn=false)=>`<article class="host-card ${warn?'warning':''}"><div class="label">${title}<span>${warn?'주의':''}</span></div><div class="value">${value}<small>${unit}</small></div><div class="sub">${sub}</div><div class="meter"><i style="width:${Math.min(100,Math.max(0,percent||0))}%"></i></div></article>`;
 $('hostCards').innerHTML=card('전체 CPU',h.cpu==null?'—':h.cpu.toFixed(1),'%',`${h.cores}개 논리 코어 · load ${loadAverage(h.load?.slice(0,1))}`,h.cpu,h.cpu>90)+card('메모리',bytes(h.memory.used),'',`${bytes(h.memory.total)} 중 ${h.memory.percent}% · swap ${bytes(h.swap.used)}`,h.memory.percent,h.memory.percent>90)+card('네트워크 · '+(h.network.interfaces.join(' + ')||'미확인'),bytes(h.network.rx),'/s ↓',`업로드 ${bytes(h.network.tx)}/s ↑ · 물리 인터페이스`,0)+card('디스크 여유',bytes(h.disk.free),'',`${h.disk.percent}% 사용 · 읽기 ${bytes(h.disk.read)}/s · 쓰기 ${bytes(h.disk.write)}/s`,h.disk.percent,h.disk.percent>95);
}
function renderSidebar(orderedRows){
 const roots=visibleSessions(),seen=new Set(orderedRows.map(s=>s.id)),ordered=[...orderedRows,...roots.filter(s=>!seen.has(s.id))];
 const toolKinds=[...new Set(ordered.map(s=>s.kind))].filter(k=>k!=='Aside');
 const tools=toolKinds.map(k=>`<button class="provider-nav ${provider===k?'active':''}" data-provider="${esc(k)}" aria-pressed="${provider===k}">${dot(k)}<span>${esc(kindName(k))}</span><small>${roots.filter(s=>s.kind===k).length}</small></button>`).join('');
 if($('providers').innerHTML!==tools)$('providers').innerHTML=tools;
 const query=$('search').value.toLocaleLowerCase(),apps=[...new Set(ordered.map(hostApp))];
 const hosts=apps.map(app=>`<button class="provider-nav ${query===app.toLocaleLowerCase()?'active':''}" data-app-filter="${esc(app)}" aria-pressed="${query===app.toLocaleLowerCase()}"><i class="dot" style="background:#8b939f"></i><span>${esc(app)}</span><small>${roots.filter(s=>hostApp(s)===app).length}</small></button>`).join('');
 if($('hostApps').innerHTML!==hosts)$('hostApps').innerHTML=hosts;
}
const SESSION_GROUPS=[['working','작업 중',['working','resuming']],['waiting','확인 필요',['waiting']],['paused','일시정지',['paused']],['idle','대기 중',['idle']],['other','상태 미확인',['unknown','interrupted']]];
const sessionGroup=s=>SESSION_GROUPS.find(g=>g[2].includes(display(s)))?.[0]||'other';
// The table has two bands, as the user asked: working roots first (a root with a working child
// counts as working), then every other session together. Each band is in selected-period token
// order, so waiting, paused and idle sessions never split the usage order. State chips still filter.
const TABLE_BANDS=[['working','작업 중'],['rest','작업 중 아님']];
const working=s=>display(s)==='working'||(s.children_working||0)>0;
const tableBand=s=>working(s)?'working':'rest';
const cleanTitle=t=>String(t||'').replace(/<[^>]*>?/g,' ').replace(/\s+/g,' ').trim();
function renderSessionStats(scoped){
 const filter=$('stateFilter').value,counts=Object.fromEntries(SESSION_GROUPS.map(([k])=>[k,0]));for(const s of scoped)counts[sessionGroup(s)]++;
 const html=SESSION_GROUPS.filter(([k])=>counts[k]||k==='working'||k==='idle').map(([k,label])=>{const value=k==='other'?'unknown':k,on=filter===value;return `<button type="button" class="session-stat ${k}" data-state-chip="${value}" aria-pressed="${on}"><i class="dot"></i>${label}<b>${counts[k]}</b></button>`;}).join('');
 if($('sessionStats').innerHTML!==html)$('sessionStats').innerHTML=html;
}
function renderTable(){
 if(!data?.ready||OneTopDashboard.interacting)return;const query=$('search').value.toLocaleLowerCase(),state=$('stateFilter').value,modelFilter=$('modelFilter').value;
 document.querySelectorAll('#hostApps [data-app-filter]').forEach(b=>{const selected=query===b.dataset.appFilter.toLocaleLowerCase();b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));});
 const matches=s=>(provider==='all'||s.kind===provider)&&(state==='all'||display(s)===state)&&(modelFilter==='all'||(s.model||'')===modelFilter)&&[s.project,s.title,s.kind,s.model,s.orca_terminal?.title,hostApp(s),s.location?.terminal,s.id,s.agent_path].join(' ').toLocaleLowerCase().includes(query);
 const children=s=>(s.children_ids||[]).map(id=>data.sessions.find(c=>c.id===id)).filter(Boolean);
 let rows=visibleSessions().filter(s=>matches(s)||children(s).some(matches));
 const order={working:0,waiting:1,resuming:2,paused:3,interrupted:4,unknown:5,idle:6},sort=$('sort').value;
 // Compare the same token unit across accounts, regardless of the displayed quota estimate.
 const numeric=s=>sort==='period'?total(s.usage?.windows?.[selectedPeriod]):sort==='rate'?s.usage?.rate:sort==='total'?total(s.tokens):s.resources?.[sort];
 const compare=(a,b)=>Number(working(b))-Number(working(a))||
  (sort==='status'?(order[display(a)]-order[display(b)]):sort==='terminal'?(a.orca_terminal?.title||'').localeCompare(b.orca_terminal?.title||''):((numeric(b)??-1)-(numeric(a)??-1)))||
  ((total(b.usage?.windows?.[selectedPeriod])??-1)-(total(a.usage?.windows?.[selectedPeriod])??-1))||String(a.id).localeCompare(String(b.id));
 // Status and usage changes apply on the next snapshot, including working children.
 rows.sort(compare);
 const bandOf=tableBand;
 renderSidebar(rows);renderSessionStats(visibleSessions().filter(s=>provider==='all'||s.kind===provider));
 $('tableCount').textContent=rows.length;$('tableEmpty').hidden=rows.length>0;
 const active=document.activeElement?.closest('[data-action],[data-group-toggle]'),focus=active?{a:active.dataset.action,id:active.dataset.target,group:active.dataset.groupToggle}:null;
 // A search or a filter opens both bands.
 const filtered=!!query||state!=='all'||modelFilter!=='all',collapsed=OneTopDashboard.state.collapsed||{};
 const cell=s=>{const r=s.resources,u=s.usage||{},pv=u.windows?.[selectedPeriod],period=periodMeta(),task=cleanTitle(s.title)||s.project;
  // The first line is whatever tells sessions apart: the terminal tab, else the conversation title.
  const term=s.is_subagent?(s.agent_path?.split('/').filter(Boolean).at(-1)||'하위 에이전트'):(s.orca_terminal?.title||(s.kind!=='Aside'&&s.location?.terminal)||''),primary=term||task;
  const place=s.kind==='Aside'?'Aside 앱 안에서 실행 · 별도 프로세스 없음':s.is_subagent?'하위 에이전트':s.pids.length===1?'PID '+s.pids[0]:'PID 연결 미확인';
  const second=[term?task:'',s.project].filter(Boolean);
  return `<tr class="${s.is_subagent?'subagent-row':''}" tabindex="0" data-session="${esc(s.id)}" data-group-of="${bandOf(s)}" aria-label="${esc(primary)} ${esc(s.project)} ${s.kind} ${labels[display(s)]}, 상세 보기"><td><div class="cell-line"><span class="cell-primary" title="${esc(s.terminal_note||primary)}" data-user-content>${s.is_subagent?'↳ ':''}${s.orca_terminal&&s.control_key&&!s.is_subagent?`<button type="button" class="terminal-rename" data-rename="${esc(s.id)}" title="터미널 제목 변경">${esc(term)}<span class="rename-pencil" aria-hidden="true">✎</span></button>`:esc(primary)}</span>${s.children_count?`<button class="children-toggle" data-children="${esc(s.id)}" aria-expanded="${expandedSessions.has(s.id)}" title="하위 사용량을 포함한 합계입니다"><span aria-hidden="true">${expandedSessions.has(s.id)?'▾':'▸'}</span> 하위 ${s.children_count}</button>`:''}</div><span class="cell-task" title="${esc(second.join(' · ')+'\n'+(s.cwd||'')+'\n'+place)}" data-user-content>${second.map((v,i)=>i===second.length-1&&second.length>1?`<span class="cell-project">${esc(v)}</span>`:esc(v)).join(' · ')}</span></td><td><span class="provider-cell">${s.kind==='Aside'?esc(model(s.model))+effortBadge(s):dot(s.kind)+esc(runtimeLabel(s))+accountChip(sessionAccount(s),data.account_quotas?.find(q=>q.id===sessionAccount(s))?.account_label)}</span><span class="cell-sub">${s.kind==='Aside'?'Aside 앱':esc(model(s.model))+effortBadge(s)}</span></td><td>${status(s)}</td><td class="num period-value" title="${pv?exact(total(pv))+' tokens':'사용량 미확인'}">${sessionWeeklyCell(s,pv,period)}</td><td class="num ${s.tokens?'':'unknown-value'}" title="${s.tokens?exact(total(s.tokens))+' tokens · 출력 '+fmt(s.tokens[3]):'유효한 사용량 보고 없음'}">${fmt(total(s.tokens))}</td><td class="num">${sessionBurnCell(s)}</td><td class="num" title="${r?r.count+'개 프로세스':s.kind==='Aside'?'Aside 앱 안에서 실행':'미귀속'}">${pct(r?.cpu)}</td><td class="num" title="${bytes(r?.rss)} / ${bytes(data.system?.host?.memory?.total)}">${memoryPercent(r?.rss)}</td><td>${actions(s)}</td></tr>`;};
 const html=TABLE_BANDS.map(([key,label])=>{
  const members=rows.filter(s=>bandOf(s)===key);if(!members.length)return '';
  const open=filtered||!(collapsed[key]??false);
  const tokens=members.reduce((n,s)=>n+(total(s.usage?.windows?.[selectedPeriod])||0),0),cpu=members.reduce((n,s)=>n+(s.resources?.cpu||0),0);
  const head=`<tr class="group-row ${key}" data-group="${key}"><td colspan="9"><div class="group-head"><button type="button" class="group-toggle" data-group-toggle="${key}" aria-expanded="${open}"><span class="group-chevron" aria-hidden="true"></span><i class="dot"></i><span>${label}</span><span class="count">${members.length}</span></button><span class="group-meta">${periodCaption()} ${fmt(tokens)} tokens · CPU ${pct(cpu)}</span></div></td></tr>`;
  return head+(open?members.flatMap(s=>[s,...(expandedSessions.has(s.id)?children(s):[])]).map(cell).join(''):'');
 }).join('');
 if($('sessionsBody').innerHTML!==html)$('sessionsBody').innerHTML=html;
 OneTopDashboard.afterTable();
 if(focus?.group)document.querySelector(`#sessionsBody [data-group-toggle="${focus.group}"]`)?.focus({preventScroll:true});
 else if(focus)document.querySelector(`#sessionsBody [data-target="${CSS.escape(focus.id)}"][data-action="${focus.a}"]`)?.focus({preventScroll:true});
}
function renderQuotas(){
 const accountRows=data.account_quotas||[],verifiedKinds=new Set(accountRows.map(q=>q.kind));
 const rows=[...accountRows,...data.quotas.filter(q=>!verifiedKinds.has(q.kind)).map(q=>({...q,account_label:'계정 연결 미확인',stale:true}))];
 const window=(w,k)=>`<div class="quota-window"><div class="quota-label"><span>${esc(w.label)}</span><b>${w.pct==null?'미확인':Number(w.pct.toFixed(1))+'% 사용'}</b></div><div class="track"><i style="background:${colors[k]||'#8d9ba8'};width:${Math.min(100,Math.max(0,w.pct||0))}%"></i></div><div class="quota-note">${w.reset?new Date(w.reset*1000).toLocaleString(OneTopI18n.locale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 초기화':'초기화 시각 미보고'}</div></div>`;
 $('quotas').innerHTML=rows.map(q=>`<article class="quota"><h3>${dot(q.kind)}${kindName(q.kind)}${accountChip(q.id,q.account_label)} <small>${esc(q.plan||'')}</small></h3><p class="quota-account">${esc(q.account_label)}${q.id?' · '+esc(q.id.slice(-6)):''}</p><div class="quota-window-pair">${(q.windows.length?q.windows:[{label:'5H',pct:null},{label:'주간',pct:null}]).map(w=>window(w,q.kind)).join('')}</div><div class="quota-note ${q.stale?'quota-stale':''}">${esc(q.note)} · ${q.updated?'마지막 확인 '+ago(q.updated):'확인 불가 · 0%를 뜻하지 않음'}</div></article>`).join('');
}
function renderSystem(){
 const sys=data.system;if(!sys)return;const h=sys.host;
 $('sharedResources').innerHTML=sys.shared.length?sys.shared.map(s=>`<div class="shared-row"><div>Codex 백엔드 <small>PID ${s.pid} · 전용 자식 포함 ${s.count}개 프로세스</small></div><div class="values">${pct(s.cpu)} CPU<small>${bytes(s.rss)} RSS</small></div></div>`).join(''):'<div class="empty">현재 공유 백엔드가 없습니다.</div>';
 $('machineMeta').textContent=`${h.platform} · ${h.cores}코어 · ${h.process_count}개 프로세스`;
 const fact=(a,b,c)=>`<article class="fact"><span>${a}</span><b>${b}</b><small>${c}</small></article>`;
 $('systemFacts').innerHTML=fact('가용 메모리',bytes(h.memory.available),'운영체제가 사용할 수 있다고 보고한 메모리')+fact('부팅 이후',Math.floor(h.uptime/86400)+'일 '+Math.floor(h.uptime/3600)%24+'시간',`load 1 / 5 / 15분: ${loadAverage(h.load)}`)+fact('배터리',h.battery?h.battery.percent+'%':'미지원',h.battery?(h.battery.plugged?'전원 연결됨':'배터리 사용 중'):'배터리 정보 미보고')+fact('GPU · 온도','미수집',esc(h.gpu_note));
 $('processBody').innerHTML=sys.top.map(p=>{const s=data.sessions.find(s=>s.id===p.owner);return `<tr><td>${esc(p.name)}</td><td>${p.pid}</td><td>${s?esc((s.orca_terminal?.title||s.project)+' · '+kindName(s.kind)):p.owner?.startsWith('backend:')?'Codex 공유 백엔드':'—'}</td><td class="num">${pct(p.cpu)}</td><td class="num">${bytes(p.rss)}</td></tr>`;}).join('');
}
function renderBenchmark(){
 const s=data.system;if(!s)return;
 $('overhead').innerHTML=[['모니터 CPU',pct(s.monitor.cpu),'수집기 프로세스 · 코어 1개 기준'],['모니터 메모리',bytes(s.monitor.rss),'수집기 RSS · 브라우저 제외'],['이번 수집 시간',fmt(data.collection_ms)+' ms','전체 세션·토큰·시스템 수집'],['리소스 수집 시간',fmt(s.sampler_ms)+' ms','시스템과 프로세스 자원 관측']].map(([a,b,c])=>`<article class="fact"><span>${a}</span><b>${b}</b><small>${c}</small></article>`).join('');
 $('audit').innerHTML=data.actions?.length?[...data.actions].reverse().map(a=>`<div class="audit-entry">${esc(a.terminal||a.project||'터미널 미확인')} · ${esc(a.message)}<small>${new Date(a.t*1000).toLocaleString(OneTopI18n.locale())}</small></div>`).join(''):'<div class="empty">이 버전에서 실행한 제어 기록이 없습니다.</div>';
 if(benchmark)$('benchmarkNumbers').innerHTML=`<table><thead><tr><th>버전</th><th>평균 CPU</th><th>평균 RSS</th><th>API 평균 응답</th><th>응답 크기</th></tr></thead><tbody>${benchmark.map(b=>`<tr><td>v${esc(b.version)}</td><td>${pct(b.cpu_one_core_mean)}</td><td>${bytes(b.rss_mean_bytes)}</td><td>${b.api_ms_mean.toFixed(1)} ms</td><td>${bytes(b.api_bytes_mean)}</td></tr>`).join('')}</tbody></table>`;
}
// Charts share the dashboard's type roles and theme colours, so they follow the theme and the app zoom.
function chartStyle(){const css=getComputedStyle(document.documentElement),v=n=>css.getPropertyValue(n).trim();return {font:v('--font')||'-apple-system, BlinkMacSystemFont, sans-serif',caption:v('--type-caption')||'11.5px',tiny:v('--type-tiny')||'10px',line:v('--line'),muted:v('--muted'),dim:v('--dim'),ink:v('--ink'),accent:v('--accent'),panel:v('--panel'),series:[1,2,3,4,5].map(i=>v('--series-'+i)),seriesOther:v('--series-other')};}
function withAlpha(color,alpha){const c=String(color||'').trim();let m=/^#([0-9a-f]{6})$/i.exec(c);if(m){const n=parseInt(m[1],16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${alpha})`;}m=/^rgba?\(([^)]+)\)$/i.exec(c);if(m){const [r,g,b]=m[1].split(',').map(x=>parseFloat(x));return `rgba(${r},${g},${b},${alpha})`;}return c;}
function endDot(ctx,x,y,color){ctx.fillStyle=withAlpha(color,.25);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,2.6,0,Math.PI*2);ctx.fill();}
// Axis numbers keep at most one decimal place.
function axisNumber(n){const [d,u]=n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];return (Math.round(n/d*10)/10).toLocaleString(OneTopI18n.locale())+u;}
function canvasBase(id){const canvas=$(id);if(!canvas||canvas.closest('[hidden]'))return null;const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;const dpr=devicePixelRatio||1;canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w:r.width,h:r.height,l:46,t:10,b:24,r:8,style:chartStyle()};}
// Solid hairline guides, a stronger baseline and right-aligned labels beside the plot.
function axes(c,max,unit='',ticks=3){const {ctx,w,h,l,t,b,r,style}=c;ctx.font=`${style.caption} ${style.font}`;ctx.textBaseline='middle';ctx.lineWidth=1;for(let i=0;i<ticks;i++){const f=i/(ticks-1),y=Math.round(t+(h-t-b)*f)+.5,base=i===ticks-1;ctx.strokeStyle=style.line;ctx.globalAlpha=base?1:.6;ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(w-r,y);ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle=style.dim;ctx.textAlign='right';ctx.fillText(axisNumber(max*(1-f))+unit,l-8,y);}ctx.textBaseline='alphabetic';}
function timeLabels(c,start,end,count){const {ctx,w,h,l,r,style}=c;ctx.font=`${style.caption} ${style.font}`;ctx.fillStyle=style.dim;for(let i=0;i<count;i++){const at=start+(end-start)*i/(count-1);ctx.textAlign=i===0?'left':i===count-1?'right':'center';ctx.fillText(end-start>86400?new Date(at*1000).toLocaleString(OneTopI18n.locale(),{month:'numeric',day:'numeric',...(end-start<=7*86400?{hour:'2-digit',minute:'2-digit',hour12:false}:{}),...(end-start>90*86400?{year:'2-digit'}:{})}):time(at),l+(w-l-r)*i/(count-1),h-6);}}
function tokenFlowData(events,minutes,updated,range){
 const end=range?.end??(Math.floor((Number.isFinite(updated)?updated:0)/60)*60+60),start=range?.start??(end-minutes*60),step=range?.step??Math.max(minutes>300?900:minutes>60?300:60,Math.ceil(minutes/240)*60),n=Math.max(1,Math.ceil((end-start)/step));
 const reports=events.map(e=>({t:e.t,kind:typeof e.kind==='string'&&e.kind.trim()?e.kind.trim():'unknown',n:e.n??((e.fresh??0)+(e.cached??0)+(e.written??0)+(e.output??0))})).filter(e=>Number.isFinite(e.t)&&e.t>=start&&e.t<end&&Number.isFinite(e.n)&&e.n>=0);
 const canonical=['Claude','Codex','GLM','Antigravity','Aside'],rank=k=>canonical.includes(k)?canonical.indexOf(k):canonical.length;
 const series=[...new Set(reports.map(e=>e.kind))].sort((a,b)=>rank(a)-rank(b)||(a<b?-1:a>b?1:0));
 const bins=Array.from({length:n},()=>Object.fromEntries(series.map(k=>[k,0])));
 for(const e of reports)bins[Math.floor((e.t-start)/step)][e.kind]+=e.n;
 const peak=Math.max(0,...bins.map(bin=>Object.values(bin).reduce((a,b)=>a+b,0))),power=peak>0?10**Math.floor(Math.log10(peak)):1;
 const max=peak>0?([1,2,5,10].find(v=>v>=peak/power)||10)*power:1;
 return {start,end,step,series,bins,peak,max};
}
// Token flow: stacked bars with rounded tops and a soft vertical fade, the current bin lit,
// and a dashed line at the period's average bin.
function tokenChart(id,events,minutes){
 const c=canvasBase(id);if(!c)return;
 const {start,end,series,bins,max}=tokenFlowData(events,minutes,data.updated,data.chart_range);axes(c,max,'',3);
 const {ctx,w,h,l,t,b,r,style}=c,pw=w-l-r,ph=h-t-b,base=h-b,step=pw/Math.max(1,bins.length),gap=Math.min(2,step*.28),bw=Math.max(1,step-gap);
 bins.forEach((v,i)=>{
  const total=series.reduce((n,k)=>n+(v[k]||0),0);if(!total)return;
  const x=l+i*step+gap/2,top=base-total/max*ph,now=i===bins.length-1,radius=Math.min(3,bw/2),shape=()=>{ctx.beginPath();if(ctx.roundRect)ctx.roundRect(x,top,bw,base-top,[radius,radius,0,0]);else ctx.rect(x,top,bw,base-top);};
  const topKind=[...series].reverse().find(k=>(v[k]||0)>0);
  if(now){ctx.save();ctx.shadowColor=withAlpha(colors[topKind]||style.accent,.7);ctx.shadowBlur=10;shape();ctx.fillStyle=withAlpha(colors[topKind]||style.accent,.35);ctx.fill();ctx.restore();}
  ctx.save();shape();ctx.clip();let y=base;
  for(const k of series){const bh=(v[k]||0)/max*ph;if(bh<=0)continue;const col=colors[k]||'#8b939f',g=ctx.createLinearGradient(0,y-bh,0,y);g.addColorStop(0,withAlpha(col,now?1:.9));g.addColorStop(1,withAlpha(col,now?.8:.55));ctx.fillStyle=g;ctx.fillRect(x,y-bh,bw,bh);y-=bh;}
  ctx.restore();
 });
 const average=bins.reduce((n,v)=>n+series.reduce((m,k)=>m+(v[k]||0),0),0)/Math.max(1,bins.length);
 if(average>0){const y=Math.round(base-average/max*ph)+.5,label=OneTopI18n.t('평균');ctx.strokeStyle=style.accent;ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(l,y);ctx.lineTo(w-r,y);ctx.stroke();ctx.setLineDash([]);
  ctx.font=`600 ${style.tiny} ${style.font}`;const tw=ctx.measureText(label).width+10;ctx.fillStyle=withAlpha(style.panel,.9);ctx.beginPath();if(ctx.roundRect)ctx.roundRect(w-r-tw,y-8,tw,16,8);else ctx.rect(w-r-tw,y-8,tw,16);ctx.fill();ctx.fillStyle=style.accent;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,w-r-tw/2,y+.5);ctx.textBaseline='alphabetic';}
 timeLabels(c,start,end,4);
}
function drawCharts(){
 if(!data?.ready)return;
 const tokenEvents=data.events.filter(e=>provider==='all'||e.kind===provider),minutes=(periodMeta()?.seconds||3600)/60;
 tokenChart('tokenChart',tokenEvents,minutes);tokenChart('accountTokenChart',tokenEvents,minutes);
 const legend=tokenFlowData(tokenEvents,minutes,data.updated,data.chart_range).series.map(k=>`<span>${dot(k)}${k==='Aside'?'앱 내부 세션':esc(kindName(k))}</span>`).join('');
 $('chartLegend').innerHTML=legend;$('accountChartLegend').innerHTML=legend;$('accountTokenPeriod').textContent=periodCaption();
 const c=canvasBase('systemChart'),hist=data.system?.history||[];
 if(c){axes(c,100,'%',3);const {ctx,w,h,l,t,b,r,style}=c,start=hist[0]?.t||0,end=hist.at(-1)?.t||start+1,x=v=>l+(v.t-start)/Math.max(1,end-start)*(w-l-r),y=n=>h-b-n/100*(h-t-b);
  for(const [key,color] of [['cpu',style.accent],['memory','#8f98e0']]){
   const segments=[];let run=[];for(const v of hist){if(v[key]==null){if(run.length)segments.push(run);run=[];continue;}run.push(v);}if(run.length)segments.push(run);
   for(const seg of segments){const trace=()=>seg.forEach((v,i)=>i?ctx.lineTo(x(v),y(v[key])):ctx.moveTo(x(v),y(v[key])));
    const g=ctx.createLinearGradient(0,t,0,h-b);g.addColorStop(0,withAlpha(color,.22));g.addColorStop(1,withAlpha(color,0));ctx.beginPath();trace();ctx.lineTo(x(seg.at(-1)),h-b);ctx.lineTo(x(seg[0]),h-b);ctx.closePath();ctx.fillStyle=g;ctx.fill();
    ctx.beginPath();trace();ctx.strokeStyle=color;ctx.lineWidth=1.6;ctx.lineJoin='round';ctx.stroke();}
   const last=segments.at(-1)?.at(-1);if(last)endDot(ctx,x(last),y(last[key]),color);
  }
  timeLabels(c,start,end,2);}
 if(selectedId&&$('detailDialog').open){const s=visibleSessions().find(s=>s.id===selectedId)||data.sessions.find(s=>s.id===selectedId);if(s)tokenChart('detailChart',(s.usage?.history||[]).map(([t,n])=>({t,n,kind:s.kind})),60);}
}
function detailPeriods(s){const p=data.period_usage;if(!p)return '';return `<section class="detail-periods"><h3>기간별 누적 사용량</h3><p>이 세션의 기록된 보고량 · 입력·캐시·출력 합계</p><div class="period-cards">${p.windows.map(w=>{const v=s.usage?.windows?.[w.key];return `<div class="period-card ${w.key===selectedPeriod?'selected':''}"><span class="period-label">최근 ${w.label}</span><b title="${exact(total(v))}">${fmt(total(v))}</b><span class="period-output">${v?'출력 '+fmt(v[3]):'사용량 미확인'}</span><span class="period-recording ${w.partial?'partial':''}">${w.partial?'일부 기록 · '+recordedDuration(w.observed_seconds):'기록된 보고량'}</span></div>`;}).join('')}</div></section>`;}
function renderDetail(id){
 const s=visibleSessions().find(s=>s.id===id)||data.sessions.find(s=>s.id===id);if(!s){$('detailContent').innerHTML='<h2>세션 연결이 종료되었습니다.</h2>';return;}const t=s.tokens,r=s.resources,u=s.usage||{};
 const entry=(a,b)=>`<div><dt>${a}</dt><dd>${esc(b??'확인 불가')}</dd></div>`;
 $('detailContent').innerHTML=`${status(s)}<h2 id="detailTitle">${esc(s.orca_terminal?.title||s.location?.app||'실행 위치 미확인')}</h2><p class="detail-project">${esc(s.title)}${s.children_count?' · 하위 '+s.children_count+'개 포함':''}<br>${esc(s.cwd)}</p><div class="detail-actions">${actions(s)}</div>${detailPeriods(s)}<div class="detail-metrics">${['새 입력','캐시 읽기','캐시 쓰기','출력'].map((label,i)=>`<div class="detail-metric"><span>${label} tokens</span><b title="${exact(t?.[i])}">${fmt(t?.[i])}</b></div>`).join('')}</div><h3 class="detail-chart-title">최근 1시간 토큰 흐름</h3><div class="chart-wrap"><canvas id="detailChart" role="img" aria-label="이 세션의 최근 1시간 토큰 보고량"></canvas></div><dl class="detail-list">${entry('세션 누적',t?exact(total(t))+' tokens':null)}${entry('최근 60초',u.last_minute?exact(total(u.last_minute))+' tokens · '+fmt(u.rate)+' tokens/s':null)}${entry('최근 5분',u.last_five_minutes?exact(total(u.last_five_minutes))+' tokens':null)}${entry('최근 출력 속도',u.output_rate!=null?fmt(u.output_rate)+' output tokens/s · 60초 평균':null)}${entry('CLI 자원',r?pct(r.cpu)+' CPU · '+bytes(r.rss)+' RSS · '+r.count+'개 프로세스':null)}${entry('모델',s.model||null)}${reportedEffort(s)?entry('추론 강도 (effort)',reportedEffort(s)):''}${entry('터미널 연결',s.terminal_note)}${entry('세션 ID',s.id)}${entry('CLI PID',s.pids.length===1?s.pids[0]:'개별 프로세스 미확인')}${entry('최근 사용량 보고',s.last_usage?new Date(s.last_usage*1000).toLocaleString(OneTopI18n.locale()):null)}${entry('최근 요청 입력',s.request_input!=null?exact(s.request_input)+' tokens':null)}${s.context_size?entry('컨텍스트 크기',exact(s.context_size)+' tokens'):''}${entry('사용량 출처',s.path||'해당 세션 기록 미확인')}</dl>${s.note?`<p class="detail-note">${esc(s.note)}</p>`:''}<p class="detail-note">누적값과 최근 소비 속도에는 반복 입력과 캐시가 포함됩니다. 실제 청구액이나 모델의 순간 생성 속도를 뜻하지 않습니다.</p>`;
}
function prepareAction(action,id){
 const s=data?.sessions.find(s=>s.id===id);if(!s||actionBusy)return;
 const request={action,session_id:s.id,control_key:s.control_key,request_id:crypto.randomUUID()};
 if(action==='focus'){sendAction(request);return;}pendingAction=request;
 const text={pause:['이 작업을 일시정지할까요?',s.kind==='Aside'?'Aside의 session stop으로 현재 작업 중단을 요청합니다. 세션은 보존되며 앱에서 이어서 작업할 수 있습니다.':'현재 작업에 Esc를 보내고 멈춘 상태를 확인합니다. 세션은 보존되며, 재개하면 이어서 진행하는 새 요청을 보냅니다.','일시정지'],resume:['이어서 작업할까요?','아래 문장을 새 요청으로 전송합니다. 터미널 입력 칸에 작성 중인 내용이 없는지 확인해 주세요. 재개하면 토큰을 다시 사용할 수 있습니다.','새 요청으로 재개'],terminate:['이 CLI를 정지할까요?','작업 중이면 중단을 먼저 요청합니다. 멈춘 상태가 확인되면 해당 CLI만 종료합니다. Orca 탭과 저장된 대화 기록은 유지됩니다.','CLI 정지']}[action];
 $('actionTitle').textContent=text[0];$('actionExplanation').textContent=text[1];$('confirmAction').textContent=text[2];$('confirmAction').classList.toggle('danger',action==='terminate');
 $('actionTarget').textContent=`${s.orca_terminal?.title||'Orca 탭 미연결'} · ${kindName(s.kind)}\n${s.title||s.project}\n${s.project} · PID ${s.pids.join(', ')}`;
 $('resumeText').hidden=action!=='resume';$('resumeText').textContent=data.resume_prompt||'';$('actionError').hidden=true;$('actionDialog').showModal();$('cancelAction').focus();
}
async function sendAction(request){
 if(actionBusy)return;actionBusy=true;$('confirmAction').disabled=true;$('cancelAction').disabled=true;renderTable();
 const original=$('confirmAction').textContent;$('confirmAction').textContent='상태 확인 중…';
 try{const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':data.action_token},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok||!result.ok)throw Error(result.message||'동작을 처리하지 못했습니다.');if($('actionDialog').open)$('actionDialog').close();pendingAction=null;showToast(result.message);await refresh();}
 catch(e){const message=e.name==='TimeoutError'?'응답을 확인하지 못했습니다. 다시 누르기 전에 해당 터미널 상태를 확인하세요.':e.message;if($('actionDialog').open){$('actionError').textContent=message;$('actionError').hidden=false;}else showToast(message,true);}
 finally{actionBusy=false;$('confirmAction').disabled=false;$('cancelAction').disabled=false;$('confirmAction').textContent=original;renderTable();if(selectedId&&$('detailDialog').open)renderDetail(selectedId);}
}
async function refresh(){
 if(busy)return;busy=true;const requested=selectedPeriod;try{const response=await fetch('/api/state'+(customPeriod(requested)?'?period='+encodeURIComponent(requested):''),{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('HTTP');const next=await response.json();if(requested!==selectedPeriod)return;data=next;normalizeSessions(data);const stale=data.updated&&Date.now()/1000-data.updated>20;$('liveDot').classList.toggle('offline',!!stale||!!data.error);$('connectionText').textContent=!data.ready?'수집 준비 중':data.error?'수집 지연':stale?'오래된 데이터':'실시간 연결';$('clock').textContent=new Date().toLocaleTimeString(OneTopI18n.locale(),{hour12:false});render();}
 catch(e){$('liveDot').classList.add('offline');$('connectionText').textContent='연결 끊김';$('notice').hidden=false;$('notice').textContent='로컬 수집기에 연결할 수 없습니다. 마지막 수집 값을 표시합니다. 1top 앱을 다시 열어 확인해 주세요.';}
 finally{busy=false;if(requested!==selectedPeriod)refresh();}
}
$('views').onclick=e=>{const b=e.target.closest('[data-view]');if(b)selectView(b.dataset.view);};
$('sessionSummary').onclick=e=>{const b=e.target.closest('[data-summary-view]');if(b)selectView(b.dataset.summaryView);};
$('providers').onclick=e=>{const b=e.target.closest('[data-provider]');if(!b)return;provider=provider===b.dataset.provider?'all':b.dataset.provider;selectView('sessions');render();};
$('hostApps').onclick=e=>{const b=e.target.closest('[data-app-filter]');if(!b)return;const selected=$('search').value.toLocaleLowerCase()===b.dataset.appFilter.toLocaleLowerCase();selectView('sessions');$('search').value=selected?'':b.dataset.appFilter;render();};
$('modelFilter').onchange=renderTable;
$('clearFilter').onclick=()=>{provider='all';render();};$('search').oninput=renderTable;$('stateFilter').onchange=renderTable;$('sort').onchange=renderTable;

$('usageMode').onclick=e=>{const b=e.target.closest('[data-unit]');if(b){usageUnit=b.dataset.unit;render();}};
$('periodCards').onclick=e=>{const b=e.target.closest('[data-period]');if(b)selectPeriod(b.dataset.period);};
function openDetail(e){if(e.target.closest('button'))return;const r=e.target.closest('[data-session]');if(!r)return;selectedId=r.dataset.session;renderDetail(selectedId);if(!$('detailDialog').open)$('detailDialog').show();document.body.classList.add('inspecting');drawCharts();}
$('sessionStats').onclick=e=>{const b=e.target.closest('[data-state-chip]');if(!b)return;$('stateFilter').value=$('stateFilter').value===b.dataset.stateChip?'all':b.dataset.stateChip;renderTable();};
$('sessionsBody').onclick=e=>{const g=e.target.closest('[data-group-toggle]');if(g?.dataset.groupToggle){e.preventDefault();OneTopDashboard.toggleGroup(g.dataset.groupToggle,g.getAttribute('aria-expanded')==='true');renderTable();return;}const b=e.target.closest('[data-children]');if(b){e.preventDefault();e.stopPropagation();const id=b.dataset.children;expandedSessions.has(id)?expandedSessions.delete(id):expandedSessions.add(id);renderTable();return;}openDetail(e);};$('sessionsBody').onkeydown=e=>{if(!e.target.closest('button')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(e);}};
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled){e.preventDefault();prepareAction(b.dataset.action,b.dataset.target);}});
$('confirmAction').onclick=()=>{if(pendingAction)sendAction(pendingAction);};$('cancelAction').onclick=()=>{pendingAction=null;$('actionDialog').close();};$('actionDialog').addEventListener('cancel',e=>{if(actionBusy)e.preventDefault();else pendingAction=null;});
$('closeDetail').onclick=()=>$('detailDialog').close();$('detailDialog').addEventListener('close',()=>document.body.classList.remove('inspecting'));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('detailDialog').open&&!$('actionDialog').open)$('detailDialog').close();});$('closeHelp').onclick=()=>$('helpDialog').close();$('helpButton').onclick=()=>$('helpDialog').showModal();$('refresh').onclick=refresh;
window.addEventListener('resize',drawCharts);refresh();setInterval(refresh,3000);
// Canvases are drawn for the current pixel ratio. App zoom and moving to another display change it,
// sometimes without a resize, so redraw them sharp whenever it changes.
(function watchPixelRatio(){if(typeof matchMedia!=='function')return;matchMedia(`(resolution: ${devicePixelRatio||1}dppx)`).addEventListener('change',()=>{drawCharts();drawWeeklyCharts();OneTopDashboard.drawGauges();drawHistory();watchPixelRatio();},{once:true});})();
fetch('/benchmark.json').then(r=>r.ok?r.json():null).then(x=>{benchmark=x;if(data?.ready)renderBenchmark();}).catch(()=>{});

function renderOperations(){
 const o=data?.operations;if(!o)return;
 const active=o.goals.filter(g=>g.status==='active').length;
 $('operationSummary').innerHTML=[['저장된 활성 Goal',o.goal_source_status==='reported'?active:'—','현재 세션 연결 여부는 아래에서 별도 표시'],['설치 확인 Skills',o.skills.length,'활성화·작업 성공 여부는 별도'],['관측된 호출 / 실행',o.events.length,'최근 로그 일부 · 전체 이력 아님'],['저장된 예약',(o.schedules||[]).length,'Claude Code · 세션 전용 예약은 별도']].map(([a,b,c])=>`<article class="fact"><span>${a}</span><b>${b}</b><small>${c}</small></article>`).join('');
 const expandedGoals=new Set([...document.querySelectorAll('[data-goal][open]')].map(e=>e.dataset.goal));
 const goalLabels={active:'활성',complete:'완료',paused:'일시정지',blocked:'차단됨',cleared:'해제됨',failed:'달성 불가',budget_limit:'예산 한도',usage_limit:'사용 한도'};
 $('goalRows').innerHTML=o.goals.length?o.goals.map(g=>`<article class="goal-row"><div><span class="status ${g.status==='active'?'working':''}">${esc(goalLabels[g.status]||g.status)}</span><details class="goal-objective" data-goal="${esc(g.goal_id)}" ${expandedGoals.has(g.goal_id)?'open':''}><summary>${esc(g.objective.length>180?g.objective.slice(0,180)+'…':g.objective)}</summary><p>${esc(g.objective)}</p></details><p>${esc(g.runtime)} · ${esc(g.location)} · ${g.evidence==='last_observed'?'마지막 관측 상태 · ':''}${g.session_connected?'현재 세션 연결됨':'저장된 상태 · 현재 실행 연결 미확인'}</p></div><div class="goal-metrics"><strong>${fmt(g.tokens_used)}<small> tokens</small></strong><span>예산 ${g.token_budget==null?'미설정':fmt(g.token_budget)}</span><span>사용 시간 ${g.time_used_seconds==null?'미보고':recordedDuration(g.time_used_seconds)}</span></div></article>`).join(''):`<div class="empty">${o.goal_source_status==='reported'?'확인된 Goal 기록이 없습니다. Claude Code는 최근 로그 범위만 관측합니다.':'Goal 저장소를 읽을 수 없습니다.'}</div>`;
 const labels={read_requested:'Skill 읽기 요청',stored:'예약 파일에 저장됨',invoked:'호출 관측',tool_returned:'도구 응답 확인',tool_error:'도구 오류',fire_observed:'예약 실행 관측'};
 const activity=[...(o.schedules||[]).map(x=>({...x,category:'loop'})),...o.events];
 $('operationEvents').innerHTML=activity.length?activity.slice(0,50).map(e=>`<div class="event-row"><span class="event-type">${e.category==='skill'?'SKILL':'LOOP'}</span><div><strong>${esc(e.name)}</strong><small>${esc(e.runtime||'Claude Code')} · ${esc(e.location)}${e.schedule?' · '+esc(e.schedule):''}</small></div><span>${esc(labels[e.state]||e.state)}</span><time>${e.observed_at?new Date(e.observed_at).toLocaleString(OneTopI18n.locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'시각 미보고'}</time></div>`).join(''):'<div class="empty">최근 로그 범위에서 확인된 호출이 없습니다. 실행하지 않았다는 뜻은 아닙니다.</div>';
 renderSkills();
}
function renderSkills(){
 const o=data?.operations;if(!o)return;const q=$('skillSearch').value.toLowerCase();
 const rows=o.skills.filter(s=>[s.name,s.path,...s.providers].join(' ').toLowerCase().includes(q));
 $('skillCount').textContent=rows.length;
 $('skillRows').innerHTML=rows.map(s=>`<tr><td><strong>${esc(s.name)}</strong><small class="skill-path">${esc(s.path)}</small></td><td>${esc(s.providers.join(' · '))}</td><td>${esc(s.scope)}</td><td><span class="status">설치 확인</span><small>세션 활성화 미확인</small></td></tr>`).join('')||'<tr><td colspan="4" class="empty">조건에 맞는 설치 파일이 없습니다.</td></tr>';
}
$('skillSearch').oninput=renderSkills;

$('addAccount').onclick=()=>$('accountDialog').showModal();
$('closeAccounts').onclick=()=>$('accountDialog').close();
let accountLoginBusy=false;
$('accountDialog').addEventListener('click',async e=>{
 const b=e.target.closest('[data-account-login]');if(!b||accountLoginBusy)return;
 accountLoginBusy=true;const buttons=[...document.querySelectorAll('[data-account-login]')];buttons.forEach(x=>x.disabled=true);
 $('accountLoginStatus').textContent='공식 로그인 창을 여는 중…';
 try{
  if(!data?.action_token||!data.ready||Date.now()/1000-data.updated>20)throw Error('수집기 연결을 확인한 뒤 다시 시도해 주세요.');
  const r=await fetch('/api/accounts/login',{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':data.action_token},body:JSON.stringify({kind:b.dataset.accountLogin}),signal:AbortSignal.timeout(20000)});
  const result=await r.json();if(!r.ok)throw Error(result.message||'로그인 창을 열지 못했습니다.');
  $('accountLoginStatus').textContent=result.message;
 }catch(error){$('accountLoginStatus').textContent=error.name==='TimeoutError'?'로그인 창 응답을 확인하지 못했습니다. 터미널을 먼저 확인해 주세요.':error.message;}
 finally{accountLoginBusy=false;buttons.forEach(x=>x.disabled=false);}
});

let usageMapSelectionId='';
function renderMaps(){
 if(!data?.ready||!['sessions','maps'].includes(view))return;
 const source=view==='maps'&&mapGroup!=='session'?data.sessions:visibleSessions();
 const sessions=source.filter(s=>provider==='all'||s.kind===provider);
 const result=OneTopMaps.usage(sessions,selectedPeriod,view==='sessions'?'session':mapGroup);
 if(view==='sessions'){
  $('sessionMapTotal').textContent=fmt(result.total)+' tokens';
  OneTopMaps.draw($('sessionUsageMap'),result.items);
  return;
 }
 $('mapTotal').innerHTML=fmt(result.total)+' <small>tokens · '+periodCaption()+'</small>';
 $('mapCoverage').textContent=result.known+'/'+sessions.length+'개 확인 · 미보고 '+result.unknown+'개 · 0 사용량 '+result.zero+'개'+(periodMeta()?.partial?' · 일부 기간만 기록':'');
 const selection=item=>$('mapSelection').textContent=item?item.label+' · '+exact(item.value)+' tokens · '+item.share.toFixed(1)+'%':'영역을 선택하면 세션 이름과 사용량을 확인할 수 있습니다.';
 selection(result.items.find(x=>x.id===usageMapSelectionId));
 OneTopMaps.draw($('usageMap'),result.items,{activate:item=>{if(!item)return;usageMapSelectionId=item.id;selection(item);}});
 $('usageLegend').innerHTML=OneTopMaps.legend(result.items);
 loadHistory();
}
$('mapGroups').onclick=e=>{const b=e.target.closest('[data-map-group]');if(!b)return;mapGroup=b.dataset.mapGroup;document.querySelectorAll('[data-map-group]').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.mapGroup===mapGroup)));renderMaps();};
window.addEventListener('resize',renderMaps);

// ---------- Usage history: trends by model and project, and the usage heatmap ----------
// Loaded from /api/history while the usage map is open: on opening, when the period or AI filter
// changes, and every minute. A collector without the endpoint (404) only changes these panels.
const historyView={key:'',at:0,data:null,error:'',loading:false,slots:{model:{},project:{}},geometry:{},hover:{}};
// Monday-first weekday labels, per language here: a bare '일' would collide with the day unit in i18n.js.
const weekdays=()=>({en:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],zh:['一','二','三','四','五','六','日']})[OneTopI18n.language]||['월','화','수','목','금','토','일'];
// One tooltip for every history chart, created on first use. Names inside are data, set as text.
let historyTipElement=null;
function historyTip(){
 if(!historyTipElement){historyTipElement=Object.assign(document.createElement('div'),{className:'history-tooltip',hidden:true});historyTipElement.setAttribute('role','tooltip');historyTipElement.dataset.userContent='';document.body.append(historyTipElement);}
 return historyTipElement;
}
async function loadHistory(force=false){
 if(view!=='maps'||historyView.loading)return;
 const key=selectedPeriod+'|'+provider;
 if(!force&&key===historyView.key&&Date.now()-historyView.at<60000)return;
 historyView.loading=true;historyView.key=key;historyView.at=Date.now();document.body.classList.add('history-loading');
 try{
  // "All" spans the whole record; a record longer than 400 days falls back to weekly bins.
  for(const step of selectedPeriod==='all'?['day','week']:[OneTopHistory.step(periodMeta()?.seconds||3600)]){
   const query=new URLSearchParams({period:selectedPeriod,step});if(provider!=='all')query.set('kind',provider);
   const response=await fetch('/api/history?'+query,{cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(response.status===400&&step==='day')continue;
   if(response.status===404){historyView.data=null;historyView.error='missing';break;}
   if(!response.ok)throw new Error(String(response.status));
   const body=await response.json();
   // A newer selection started while this one was loading; the next poll asks again.
   if(key!==selectedPeriod+'|'+provider){historyView.key='';break;}
   historyView.data=body;historyView.error='';break;
  }
 }catch{if(!historyView.data)historyView.error='failed';}
 finally{historyView.loading=false;document.body.classList.remove('history-loading');drawHistory();}
}
function historyMessage(what){
 const t=OneTopI18n.t;
 if(historyView.error==='missing')return [t('수집기 업데이트 후 표시됩니다'),t(what+' 기록은 새 수집기가 제공합니다.')];
 if(historyView.error==='failed')return [t('기록을 불러오지 못했습니다'),t('1분 뒤 다시 시도합니다.')];
 return historyView.data?null:[t('기록을 불러오고 있습니다'),''];
}
const spans=parts=>parts.filter(Boolean).map(p=>`<span>${esc(p)}</span>`).join('');
function binLabel(t,step,full=false){
 const d=new Date(t*1000),locale=OneTopI18n.locale();
 if(['60','300','900'].includes(step))return full?d.toLocaleString(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):time(t);
 if(step==='3600')return d.toLocaleString(locale,{month:full?'short':'numeric',day:'numeric',hour:'2-digit',hour12:false});
 return d.toLocaleDateString(locale,full?{month:'short',day:'numeric',weekday:'short'}:{month:'numeric',day:'numeric'});
}
function showTip(build,clientX,clientY){
 const tip=historyTip();tip.replaceChildren();build(tip);tip.hidden=false;
 const r=tip.getBoundingClientRect(),pad=12;
 let x=clientX+14,y=clientY+14;if(x+r.width>innerWidth-pad)x=clientX-r.width-14;if(y+r.height>innerHeight-pad)y=clientY-r.height-14;
 tip.style.left=Math.max(pad,x)+'px';tip.style.top=Math.max(pad,y)+'px';
}
const hideTip=()=>{if(historyTipElement)historyTipElement.hidden=true;};
function tipRow(parent,color,value,name,cls='tip-row'){
 const row=document.createElement('div');row.className=cls;const key=document.createElement('i'),b=document.createElement('b'),label=document.createElement('span');
 key.style.background=color||'transparent';b.textContent=value;label.textContent=name;row.append(key,b,label);parent.append(row);
}
function drawHistory(){if(view!=='maps')return;drawTrend('modelTrend','model');drawTrend('projectTrend','project');drawHeatmap();}
// Stacked areas, largest series at the bottom, with a surface gap between layers. Bins outside the
// record draw nothing; measured zero sits on the baseline.
function drawTrend(id,group){
 const canvas=$(id),empty=canvas.parentElement.querySelector('.history-empty'),legend=$(id+'Legend'),d=historyView.data,what=group==='model'?'모델별':'프로젝트별';
 $(id+'Caption').innerHTML=spans([`토큰 기준 상위 5개 ${group==='model'?'모델':'프로젝트'}`,periodCaption(),OneTopHistory.stepLabel(d?.series?.step||OneTopHistory.step(periodMeta()?.seconds||3600))]);
 const message=historyMessage(what);
 empty.hidden=!message;canvas.style.visibility=message?'hidden':'';
 if(message){empty.innerHTML=esc(message[0])+(message[1]?`<small>${esc(message[1])}</small>`:'');legend.innerHTML='';historyView.geometry[id]=null;return;}
 const s=d.series,{shown,other}=OneTopHistory.fold(s['by_'+group]||[]),slots=historyView.slots[group]=OneTopHistory.slots(historyView.slots[group],shown.map(r=>r.key));
 const c=canvasBase(id);if(!c)return;
 const {ctx,w,h,l,t,b,r,style}=c,n=s.bins.length,pw=w-l-r,ph=h-t-b,base=h-b;
 const layers=[...shown].sort((p,q)=>slots[p.key]-slots[q.key]).map(row=>({row,color:style.series[slots[row.key]],name:group==='model'?OneTopHistory.modelName(row.key):OneTopHistory.projectName(row)}));
 if(other)layers.push({row:other,color:style.seriesOther,name:OneTopI18n.t('기타'),folded:other.folded});
 const totals=s.bins.map((_,i)=>s.total[i]==null?null:layers.reduce((sum,L)=>sum+(L.row.tokens[i]||0),0));
 const peak=Math.max(0,...totals.filter(v=>v!=null)),max=OneTopHistory.axisMax(peak);
 axes(c,max,'',3);
 const x=i=>l+(i+.5)*pw/n,y=v=>base-v/max*ph,alpha=document.documentElement.dataset.theme==='light'?.32:.4;
 // Outside the record: a quiet hatch, never a zero line.
 ctx.save();ctx.beginPath();ctx.rect(l,t,pw,ph);ctx.clip();ctx.strokeStyle=style.line;ctx.lineWidth=1;
 totals.forEach((v,i)=>{if(v!=null)return;const x0=l+i*pw/n,x1=l+(i+1)*pw/n;for(let k=Math.floor((x0-ph)/6)*6;k<x1;k+=6){ctx.beginPath();ctx.moveTo(Math.max(x0,k),base-Math.max(0,x0-k));ctx.lineTo(Math.min(x1,k+ph),base-Math.min(ph,Math.min(x1,k+ph)-k));ctx.stroke();}});
 ctx.restore();
 const samples=Math.max(1,Math.min(8,Math.round(pw/n/4)));
 for(const [a,z] of OneTopHistory.runs(totals)){
  if(a===z){let acc=0;const bw=Math.max(3,pw/n*.6);for(const L of layers){const v=L.row.tokens[a]||0;if(!v)continue;ctx.fillStyle=withAlpha(L.color,alpha);ctx.fillRect(x(a)-bw/2,y(acc+v),bw,y(acc)-y(acc+v));acc+=v;}continue;}
  const sampled=layers.map(L=>OneTopHistory.smooth(L.row.tokens.slice(a,z+1).map(v=>v||0),samples)),xs=sampled[0].map(p=>x(a+p.x)),bounds=[xs.map(()=>0)];
  for(const S of sampled)bounds.push(S.map((p,k)=>bounds.at(-1)[k]+p.y));
  layers.forEach((L,j)=>{const lo=bounds[j],hi=bounds[j+1];ctx.beginPath();xs.forEach((X,k)=>k?ctx.lineTo(X,y(hi[k])):ctx.moveTo(X,y(hi[k])));for(let k=xs.length-1;k>=0;k--)ctx.lineTo(xs[k],y(lo[k]));ctx.closePath();ctx.fillStyle=withAlpha(L.color,alpha);ctx.fill();});
  // Translucent layers with each top drawn in its own colour, as in shadcn's stacked area chart.
  ctx.lineWidth=1.5;ctx.lineJoin='round';
  layers.forEach((L,j)=>{ctx.strokeStyle=L.color;ctx.beginPath();xs.forEach((X,k)=>k?ctx.lineTo(X,y(bounds[j+1][k])):ctx.moveTo(X,y(bounds[j+1][k])));ctx.stroke();});
 }
 // Time labels at even spacing, ends aligned to the plot edges.
 ctx.font=`${style.caption} ${style.font}`;ctx.fillStyle=style.dim;
 const count=Math.max(2,Math.min(6,Math.floor(pw/96)));
 for(let k=0;k<count;k++){const i=Math.round(k*(n-1)/(count-1));ctx.textAlign=k===0?'left':k===count-1?'right':'center';ctx.fillText(binLabel(s.bins[i],s.step),k===0?l:k===count-1?w-r:x(i),h-6);}
 const hover=historyView.hover[id];
 if(Number.isInteger(hover)&&hover<n&&totals[hover]!=null){
  const X=Math.round(x(hover))+.5;ctx.strokeStyle=style.ink;ctx.globalAlpha=.35;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X,t);ctx.lineTo(X,base);ctx.stroke();ctx.globalAlpha=1;
  let acc=0;for(const L of layers){const v=L.row.tokens[hover]||0;acc+=v;if(!v)continue;ctx.fillStyle=style.panel;ctx.beginPath();ctx.arc(X,y(acc),6,0,Math.PI*2);ctx.fill();ctx.fillStyle=L.color;ctx.beginPath();ctx.arc(X,y(acc),4,0,Math.PI*2);ctx.fill();}
 }
 const sum=layers.reduce((n,L)=>n+L.row.total,0)||1;
 legend.innerHTML=layers.map(L=>`<span class="history-legend-item"><i style="background:${esc(L.color)}"></i><span data-user-content>${esc(L.name)}${L.folded?` +${L.folded}`:''}</span><b>${fmt(L.row.total)}</b><small>${(L.row.total/sum*100).toFixed(1)}%</small></span>`).join('');
 canvas.setAttribute('aria-label',`${OneTopI18n.t(what+' 사용량 추이')} · ${layers.map(L=>`${L.name} ${fmt(L.row.total)}`).join(', ')}`);
 historyView.geometry[id]={l,pw,n,layers,bins:s.bins,step:s.step,totals};
}
function trendTip(id,index,clientX,clientY){
 const g=historyView.geometry[id];if(!g)return hideTip();
 showTip(tip=>{
  const title=document.createElement('strong');title.textContent=binLabel(g.bins[index],g.step,true);tip.append(title);
  if(g.totals[index]==null){const p=document.createElement('p');p.textContent=OneTopI18n.t('기록 없음');tip.append(p);return;}
  for(const L of [...g.layers].filter(L=>(L.row.tokens[index]||0)>0).sort((p,q)=>q.row.tokens[index]-p.row.tokens[index]))tipRow(tip,L.color,fmt(L.row.tokens[index]),L.name+(L.folded?` +${L.folded}`:''));
  tipRow(tip,'',fmt(g.totals[index]),OneTopI18n.t('합계')+' · tokens','tip-row tip-total');
 },clientX,clientY);
}
for(const id of ['modelTrend','projectTrend']){
 const canvas=$(id),index=clientX=>{const g=historyView.geometry[id];if(!g)return null;const r=canvas.getBoundingClientRect();return Math.max(0,Math.min(g.n-1,Math.floor((clientX-r.left-g.l)/g.pw*g.n)));};
 canvas.addEventListener('pointermove',e=>{const i=index(e.clientX);if(i===null)return;if(historyView.hover[id]!==i){historyView.hover[id]=i;drawTrend(id,id==='modelTrend'?'model':'project');}trendTip(id,i,e.clientX,e.clientY);});
 canvas.addEventListener('pointerleave',()=>{historyView.hover[id]=null;drawTrend(id,id==='modelTrend'?'model':'project');hideTip();});
 canvas.addEventListener('blur',()=>{historyView.hover[id]=null;drawTrend(id,id==='modelTrend'?'model':'project');hideTip();});
 canvas.addEventListener('keydown',e=>{const g=historyView.geometry[id];if(!g||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
  const now=historyView.hover[id]??g.n-1,i=e.key==='Home'?0:e.key==='End'?g.n-1:Math.max(0,Math.min(g.n-1,now+(e.key==='ArrowLeft'?-1:1)));historyView.hover[id]=i;drawTrend(id,id==='modelTrend'?'model':'project');
  const r=canvas.getBoundingClientRect();trendTip(id,i,r.left+g.l+(i+.5)*g.pw/g.n,r.top+16);});
}
// Heatmaps side by side: weekday × hour over the last 30 days (a daily average) and the last
// 53 weeks of daily totals, GitHub-style, with month names above.
function drawHeatmap(){
 const d=historyView.data,empty=document.querySelector('.heatmap-empty'),pair=document.querySelector('.heatmap-pair'),message=historyMessage('히트맵');
 empty.hidden=!message;pair.hidden=!!message;document.querySelector('.heatmap-foot').hidden=!!message;$('historyCoverage').hidden=!!message;
 if(message){empty.innerHTML=esc(message[0])+(message[1]?`<small>${esc(message[1])}</small>`:'');return;}
 drawHours($('heatmapHours'),d);drawYear($('heatmapYear'),d);
 const since=Math.min(...(d.coverage||[]).map(c=>c.from).filter(Number.isFinite)),names={collector:'1top 수집 기록',claude_transcripts:'Claude Code 대화 기록',codex_sessions:'Codex 대화 기록'};
 $('historyCoverage').innerHTML=Number.isFinite(since)?`<span>기록 시작</span> <b data-user-content>${esc(new Date(since*1000).toLocaleDateString(OneTopI18n.locale(),{year:'numeric',month:'short',day:'numeric'}))}</b> · <span>출처</span> ${[...new Set((d.coverage||[]).map(c=>names[c.source]).filter(Boolean))].map(x=>`<span>${esc(x)}</span>`).join(', ')}`:'';
}
function drawHours(grid,d){
 const cells=OneTopHistory.weekHours(d.heatmap?.hours||[]),max=Math.max(0,...cells.flat().filter(Boolean).map(c=>c.value)),dates=(d.heatmap?.hours||[]).map(h=>h[0]).sort();
 grid.innerHTML='<span></span>'+Array.from({length:24},(_,h)=>`<span class="heat-label is-hour">${h%3?'':h}</span>`).join('')+cells.map((row,w)=>`<span class="heat-label is-row" data-user-content>${weekdays()[w]}</span>`+row.map((c,h)=>`<i class="heat-cell${c?'':' is-null'}"${c?` data-level="${OneTopHistory.level(c.value,max)}"`:''} data-w="${w}" data-h="${h}"></i>`).join('')).join('');
 grid.cells=cells;
 const range=dates.length?[dates[0],dates.at(-1)].map(x=>new Date(x+'T00:00:00').toLocaleDateString(OneTopI18n.locale(),{month:'short',day:'numeric'})).join(' – '):'';
 $('hoursCaption').innerHTML=spans(['최근 30일 하루 평균'])+(range?`<span data-user-content>${esc(range)}</span>`:'');
 let peak=null;cells.forEach((row,w)=>row.forEach((c,h)=>{if(c&&c.value>0&&(!peak||c.value>peak.value))peak={...c,w,h};}));
 $('hoursSummary').innerHTML=peak?`<span>가장 많이 쓰는 시간</span> <b data-user-content>${esc(weekdays()[peak.w])} ${peak.h}:00</b> · <b>${fmt(peak.value)}</b> tokens`:'';
}
function drawYear(grid,d){
 const today=new Date(),todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
 const {weeks,months}=OneTopHistory.year(d.heatmap?.days||[],todayKey),values=weeks.flat().filter(c=>typeof c.value==='number'),max=Math.max(0,...values.map(c=>c.value));
 const monthName=m=>new Date(2026,m-1,1).toLocaleDateString(OneTopI18n.locale(),{month:'short'});
 grid.innerHTML=`<div class="year-months">${months.map(m=>`<span style="grid-column:${m.week+1}" data-user-content>${esc(monthName(m.month))}</span>`).join('')}</div>`+
  `<div class="year-body"><div class="year-days">${weekdays().map((w,i)=>`<span data-user-content>${i%2?'':esc(w)}</span>`).join('')}</div><div class="year-grid">${weeks.map((col,w)=>col.map((c,i)=>`<i class="heat-cell${c.future?' is-future':c.value===null?' is-null':''}${c.date===todayKey?' is-today':''}"${typeof c.value==='number'?` data-level="${OneTopHistory.level(c.value,max)}"`:''} data-i="${w*7+i}"></i>`).join('')).join('')}</div></div>`;
 grid.cells=weeks.flat();
 // Like GitHub, a narrow window shows the newest weeks and scrolls back in time.
 grid.scrollLeft=grid.scrollWidth;
 const first=(d.heatmap?.days||[])[0]?.[0];
 $('yearCaption').innerHTML=spans(['최근 1년 날짜별 합계'])+(first?`<span><b data-user-content>${esc(new Date(first+'T00:00:00').toLocaleDateString(OneTopI18n.locale(),{year:'numeric',month:'short',day:'numeric'}))}</b> <span>부터 기록</span></span>`:'');
 const sum=values.reduce((n,c)=>n+c.value,0),top=values.reduce((p,c)=>!p||c.value>p.value?c:p,null),used=values.filter(c=>c.value>0).length;
 $('yearSummary').innerHTML=values.length?`<span>합계</span> <b>${fmt(sum)}</b> · <span>사용한 날</span> <b>${used}</b> · <span>가장 많이 쓴 날</span> <b data-user-content>${esc(new Date(top.date+'T00:00:00').toLocaleDateString(OneTopI18n.locale(),{month:'short',day:'numeric'}))}</b> ${fmt(top.value)}`:'';
}
for(const id of ['heatmapHours','heatmapYear']){
 $(id).addEventListener('pointerover',e=>{
  const cell=e.target.closest('.heat-cell'),grid=$(id);if(!cell||cell.classList.contains('is-future'))return hideTip();
  const r=cell.getBoundingClientRect(),t=OneTopI18n.t;
  if(id==='heatmapHours'){const w=Number(cell.dataset.w),h=Number(cell.dataset.h),c=grid.cells?.[w]?.[h];
   showTip(tip=>{const title=document.createElement('strong');title.textContent=`${weekdays()[w]} ${h}:00–${h+1}:00`;tip.append(title);
    if(!c){const p=document.createElement('p');p.textContent=t('기록 없음');tip.append(p);return;}
    tipRow(tip,'',fmt(c.value),t('하루 평균')+' · tokens');const p=document.createElement('p');p.textContent=`${t('최근 30일')} · ${c.days}${t('일 기록')} · ${c.used}${t('일 사용')}`;tip.append(p);},r.right,r.top);}
  else{const c=grid.cells?.[Number(cell.dataset.i)];if(!c)return hideTip();
   showTip(tip=>{const title=document.createElement('strong');title.textContent=new Date(c.date+'T00:00:00').toLocaleDateString(OneTopI18n.locale(),{year:'numeric',month:'short',day:'numeric',weekday:'short'});tip.append(title);
    if(c.value===null){const p=document.createElement('p');p.textContent=t('기록 없음');tip.append(p);return;}
    tipRow(tip,'',fmt(c.value),'tokens');},r.right,r.top);}
 });
 $(id).addEventListener('pointerleave',hideTip);
}
window.addEventListener('resize',drawHistory);

function checkUpdates(){fetch('/api/updates').then(r=>r.json()).then(u=>{let b=$('updateNotice');if(!b){b=document.createElement('a');b.id='updateNotice';b.className='update-notice';b.target='_blank';b.rel='noopener';document.querySelector('.rail-bottom')?.append(b);}if(b){b.hidden=!u.available;b.textContent='새 버전 '+u.version+' · '+(u.status==='preview'?'미리보기 다운로드':'업데이트');b.href=u.release_url||'https://github.com/awesomezun/1top/releases';}}).catch(()=>{});}
checkUpdates();setInterval(checkUpdates,3600000);

function sessionWeeklyCell(s,pv,period){
 if(usageUnit==='tokens')return `<strong>${fmt(total(pv))}</strong><span class="cell-sub">${pv?'출력 '+fmt(pv[3]):'미확인'}${period?.partial?' · 일부 기록':''}</span>`;
 const e=s.usage?.weekly_estimate?.[selectedPeriod],q=data.account_quotas?.find(q=>q.id===(e?.account_id||s.usage?.weekly_account));
 const label=q?`${kindName(q.kind)} · ${q.account_label}`:'';
 const estimated=OneTopWeekly.valid(e?.used_pp),value=estimated?OneTopWeekly.estimate(e):fmt(total(pv))+(pv?' tokens':'');
 return `<strong title="${esc(label+'\n'+OneTopWeekly.explanation+'\n'+OneTopWeekly.basis(e))}">${value}</strong>`;
}
// One explicit click asks macOS once for an account's saved sign-in; the server may wait up to two
// minutes for that answer, so every reconnect button stays off until it returns. Never retried on its own.
let authorizing=null;const authorizeNotes={};
// Renaming an account: the draft survives the periodic redraw, and the server keeps the name (alias).
let aliasEditing=null,aliasDraft='',aliasSaving=false,aliasNote='';
function aliasMarkup(q){return `<form class="alias-form" data-alias-form="${esc(q.id)}"><label>계정 이름<input name="alias" maxlength="24" value="${esc(aliasDraft)}" placeholder="${esc(q.account_label||'')}" autocomplete="off"></label><button type="submit"${aliasSaving?' disabled':''}>저장</button><button type="button" data-alias-cancel>취소</button><small>${esc(aliasNote||'24자까지 쓸 수 있습니다. 비우고 저장하면 번호로 돌아갑니다.')}</small></form>`;}
function reconnectMarkup(q){return `<div class="weekly-reconnect"><button type="button" data-account-authorize="${esc(q.id)}"${authorizing?' disabled':''}>${authorizing===q.id?'macOS 승인 기다리는 중…':'다시 연결'}</button><small>${esc(authorizeNotes[q.id]||'macOS가 저장된 로그인 사용을 한 번 묻습니다. 다시 묻지 않습니다.')}</small></div>`;}
$('weeklyOverview').addEventListener('click',e=>{
 const edit=e.target.closest('[data-alias-edit]');
 if(edit){const q=data.account_quotas.find(q=>q.id===edit.dataset.aliasEdit);aliasEditing=q.id;aliasDraft=q.alias||'';aliasNote='';renderWeekly();document.querySelector('[data-alias-form] input')?.focus();return;}
 if(e.target.closest('[data-alias-cancel]')){aliasEditing=null;aliasNote='';renderWeekly();}
});
$('weeklyOverview').addEventListener('input',e=>{if(e.target.closest('[data-alias-form]'))aliasDraft=e.target.value;});
$('weeklyOverview').addEventListener('submit',async e=>{
 const form=e.target.closest('[data-alias-form]');if(!form)return;e.preventDefault();if(aliasSaving)return;
 const id=form.dataset.aliasForm,alias=aliasDraft.trim().slice(0,24);aliasSaving=true;renderWeekly();
 try{
  if(!data?.action_token||!data.ready)throw Error('수집기 연결을 확인한 뒤 다시 시도해 주세요.');
  const r=await fetch('/api/accounts/alias',{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':data.action_token},body:JSON.stringify({account_id:id,alias}),signal:AbortSignal.timeout(10000)});
  const result=await r.json().catch(()=>({}));if(!r.ok||result.ok===false)throw Error(result.message||'이름을 저장하지 못했습니다.');
  const q=data.account_quotas.find(q=>q.id===id);if(q)q.alias=result.alias||alias||null;aliasEditing=null;aliasNote='';
 }catch(error){aliasNote=error.name==='TimeoutError'?'저장 응답을 확인하지 못했습니다. 잠시 뒤 다시 확인해 주세요.':error.message;}
 finally{aliasSaving=false;render();}
});
$('weeklyOverview').addEventListener('click',async e=>{
 const b=e.target.closest('[data-account-authorize]');if(!b||authorizing)return;
 const id=b.dataset.accountAuthorize;authorizing=id;renderWeekly();
 try{
  if(!data?.action_token||!data.ready)throw Error('수집기 연결을 확인한 뒤 다시 시도해 주세요.');
  const r=await fetch('/api/accounts/authorize',{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':data.action_token},body:JSON.stringify({account_id:id}),signal:AbortSignal.timeout(125000)});
  const result=await r.json().catch(()=>({}));authorizeNotes[id]=result.message||(r.ok?'연결했습니다.':'연결하지 못했습니다.');
 }catch(error){authorizeNotes[id]=error.name==='TimeoutError'?'승인 응답을 확인하지 못했습니다. 계정 상태가 바뀌었는지 먼저 확인해 주세요.':error.message;}
 finally{authorizing=null;renderWeekly();}
});
function renderWeekly(){
 $('summary').hidden=false;$('weeklyOverview').hidden=false;
 document.querySelectorAll('[data-unit]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.unit===usageUnit)));
 const rows=(data.account_quotas||[]).filter(q=>provider==='all'||q.kind===provider);
 const periodLabel=periodMeta()?.label||selectedPeriod;
 $('weeklyOverview').innerHTML=rows.map(q=>{
  const w=OneTopWeekly.weekly(q),n=w?.pct,valid=OneTopWeekly.valid(n),a=data.weekly_usage?.accounts.find(a=>a.id===q.id),p=a?.periods[selectedPeriod];
  const current=valid&&!q.stale,delta=OneTopWeekly.valid(p?.used_pp),status=current?'제공자 보고':RECONNECT.has(q.status)?'재연결 필요':q.updated?reportAge(q.updated):'확인 필요';
  const rate=OneTopWeekly.accountBurn(p,q),rateKnown=OneTopWeekly.valid(rate);
  const rateNote=rateKnown?`최근 ${periodLabel}${p.partial?' 중 관측된 구간만 계산':''} · ${OneTopWeekly.duration(p.observed_seconds)} 관측에서 +${OneTopWeekly.number(p.used_pp)}%\n한도 증가량 ÷ 실제 관측 시간으로 계산한 평균입니다. 주간 한도 100%를 기준으로 한 시간당 소진 비율이며, 미래 소진량 예측이 아닙니다.`:'최소 2분의 유효한 한도 관측과 최신 계정 보고가 필요합니다.';
  return `<article class="weekly-card ${current?'':'is-stale'}" style="--quota-color:${colors[q.kind]||'#8d9ba8'}"><div class="weekly-card-heading"><b>${dot(q.kind)}${esc(kindName(q.kind))}${accountChip(q.id,q.account_label)}<button type="button" class="alias-edit" data-alias-edit="${esc(q.id)}" title="계정 이름 바꾸기" aria-label="계정 이름 바꾸기">✎</button></b><span>${esc(q.plan||'')} · ${status}</span></div><p class="weekly-account" title="${esc(q.account_label)}">${esc(q.account_label)}</p><div class="weekly-value"><strong>${valid?OneTopWeekly.percent(n):'—'}</strong><span>/ 100% 사용</span><b>${current?OneTopWeekly.percent(Math.max(0,100-n))+' 남음':''}</b></div><div class="track"><i style="width:${valid?Math.min(100,n):0}%;background:var(--quota-color)"></i></div><div class="weekly-period"><span>${periodCaption()}</span><strong>${delta?'+'+OneTopWeekly.number(p.used_pp)+'%':q.stale?'조회 필요':'다음 보고 대기'}</strong><span title="${esc(rateNote)}">${rateKnown?'평균 '+OneTopWeekly.burn(rate):delta?'소진 속도 확인 중':'한도 변화 기록 중'}</span></div><div class="weekly-chart" data-weekly-chart="${esc(q.id)}"></div><p class="weekly-note">${q.stale?esc(q.note):w?.reset?new Date(w.reset*1000).toLocaleString(OneTopI18n.locale(),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 초기화 · '+ago(q.updated)+' 확인':'주간 한도 확인 중'}</p>${q.stale&&RECONNECT.has(q.status)?reconnectMarkup(q):''}${aliasEditing===q.id?aliasMarkup(q):''}</article>`;
 }).join('')||'<div class="empty">계정을 연결하면 제공자가 보고한 주간 사용률이 표시됩니다. 아래 계정 한도에서 계정을 추가하세요.</div>';
 drawWeeklyCharts();
}
function drawWeeklyCharts(){
 if(!data?.ready||view!=='accounts')return;
 const seconds=periodMeta()?.seconds||3600,end=data.updated,start=end-seconds;
 for(const el of document.querySelectorAll('[data-weekly-chart]')){
  const a=data.weekly_usage?.accounts.find(a=>a.id===el.dataset.weeklyChart),trend=OneTopWeekly.quotaTrend(a,start,end);
  el.replaceChildren();
  el.title='실제 주간 사용률 · 최근 증가량과 별개';
  if(!trend.hasData){el.textContent='사용률 기록 대기';continue;}
  const canvas=document.createElement('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${periodCaption()} 실제 주간 사용률 · 마지막 ${OneTopWeekly.percent(trend.last.value)}`);el.append(canvas);
  const width=Math.max(1,el.clientWidth),height=110,dpr=devicePixelRatio||1,left=46,top=8,bottom=24,right=8,style=chartStyle();
  canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.width='100%';canvas.style.height=height+'px';
  const c=canvas.getContext('2d');c.scale(dpr,dpr);
  // The axis spans at least two percentage points, so a flat line reads 0% · 1% · 2% rather than fractions.
  const half=Math.max(1,(trend.max-trend.min)*.6),mid=(trend.max+trend.min)/2,upper=Math.min(100,Math.max(mid+half,2*half)),lower=Math.max(0,upper-2*half);
  const step=Math.max(1,10**Math.floor(Math.log10(upper-lower))/2);let axisMin=Math.max(0,Math.floor(lower/step)*step),axisMax=Math.min(100,Math.ceil(upper/step)*step);
  if(Math.round((axisMax-axisMin)/step)%2){if(axisMax+step<=100)axisMax+=step;else axisMin-=step;}
  const scale=axisMax-axisMin||1;
  const pw=Math.max(1,width-left-right),ph=height-top-bottom,color=getComputedStyle(el.closest('.weekly-card')).getPropertyValue('--quota-color').trim()||style.accent;
  c.font=`${style.caption} ${style.font}`;c.textBaseline='middle';c.lineWidth=1;
  for(let i=0;i<3;i++){const v=axisMin+scale*(2-i)/2,yy=Math.round(top+ph*i/2)+.5,base=i===2;c.strokeStyle=style.line;c.globalAlpha=base?1:.6;c.beginPath();c.moveTo(left,yy);c.lineTo(width-right,yy);c.stroke();c.globalAlpha=1;c.fillStyle=style.dim;c.textAlign='right';c.fillText(OneTopWeekly.percent(v),left-8,yy);}
  c.textBaseline='alphabetic';
  const x=t=>left+(t-start)/seconds*pw,y=value=>top+ph-(value-axisMin)/scale*ph;
  c.save();c.beginPath();c.rect(left,top-6,pw,ph+12);c.clip();
  for(const segment of trend.segments){
   const trace=()=>segment.forEach(({t,value},i)=>i?c.lineTo(x(t),y(value)):c.moveTo(x(t),y(value)));
   if(segment.length>1){const g=c.createLinearGradient(0,top,0,top+ph);g.addColorStop(0,withAlpha(color,.24));g.addColorStop(1,withAlpha(color,0));c.beginPath();trace();c.lineTo(x(segment.at(-1).t),top+ph);c.lineTo(x(segment[0].t),top+ph);c.closePath();c.fillStyle=g;c.fill();}
   c.beginPath();trace();c.strokeStyle=color;c.lineWidth=1.8;c.lineJoin='round';c.stroke();
  }
  if(trend.last)endDot(c,x(trend.last.t),y(trend.last.value),color);
  c.restore();
  c.font=`${style.caption} ${style.font}`;c.fillStyle=style.dim;c.textAlign='left';c.fillText(time(start),left,height-4);c.textAlign='right';c.fillText(time(end),width-right,height-4);
 }
}
window.addEventListener('resize',drawWeeklyCharts);

function memoryPercent(rss){const capacity=data?.system?.host?.memory?.total;return Number.isFinite(rss)&&Number.isFinite(capacity)&&capacity>0?pct(rss/capacity*100):'—';}
function sessionBurnCell(s){
 let e=s.usage?.weekly_estimate?.[selectedPeriod];
 const q=data.account_quotas?.find(q=>q.id===(e?.account_id||s.usage?.weekly_account));
 // Current burn does not depend on whether the selected history window has
 // token events. A known idle session still has a measurable zero burn rate.
 if(!e&&q){const c=data.weekly_usage?.accounts.find(a=>a.id===q.id)?.calibration;if(c)e={account_id:q.id,basis:'calibrated_token_equivalent',calibration:c};}
 const rate=s.tokens==null?null:OneTopWeekly.sessionBurn(e,s.usage?.rate,q);

 return OneTopDashboard.rateCell(rate,s.kind,OneTopWeekly.basis(e));
}
let renameRequest=null;
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-rename]');if(!button||actionBusy)return;
 const s=data?.sessions.find(s=>s.id===button.dataset.rename);if(!s?.orca_terminal||!s.control_key)return;
 renameRequest={action:'rename',session_id:s.id,control_key:s.control_key,request_id:crypto.randomUUID()};
 $('renameTarget').textContent=s.project+' · Orca';$('renameTitle').value=s.orca_terminal.title||'';$('renameError').hidden=true;$('renameDialog').showModal();$('renameTitle').focus();$('renameTitle').select();
});
$('cancelRename').onclick=()=>{$('renameDialog').close();renameRequest=null;};
$('renameForm').onsubmit=async event=>{
 event.preventDefault();if(!renameRequest||actionBusy)return;
 const title=$('renameTitle').value.trim();if(!title)return;actionBusy=true;$('saveRename').disabled=true;$('cancelRename').disabled=true;
 try{
  if(!data?.updated||Date.now()/1000-data.updated>20)throw Error('수집기 연결을 확인한 뒤 다시 시도해 주세요.');
  const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':data.action_token},body:JSON.stringify({...renameRequest,title}),signal:AbortSignal.timeout(15000)});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(result.message||'제목을 변경하지 못했습니다.');
  $('renameDialog').close();renameRequest=null;showToast(result.message);await refresh();
 }catch(error){$('renameError').textContent=error.name==='TimeoutError'?'응답을 확인하지 못했습니다. 터미널 제목을 먼저 확인하세요.':error.message;$('renameError').hidden=false;}
 finally{actionBusy=false;$('saveRename').disabled=false;$('cancelRename').disabled=false;renderTable();}
};
$('renameDialog').addEventListener('cancel',event=>{if(actionBusy)event.preventDefault();else renameRequest=null;});
OneTopDashboard.init({refresh:()=>{if(data?.ready)render();},layout:()=>{if(data?.ready){drawCharts();renderMaps();drawWeeklyCharts();drawFleetSpeed();drawHistory();}}});
