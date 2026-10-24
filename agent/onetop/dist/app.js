'use strict';
const $=id=>document.getElementById(id),kinds=['Claude','Codex','GLM','Antigravity'];
const colors={Claude:'#bd8965',Codex:'#378d76',GLM:'#7c86bd',Antigravity:'#619db9'};
const labels={working:'작업 중',waiting:'확인 필요',idle:'대기 중',unknown:'미확인',interrupted:'중단됨',paused:'일시정지',resuming:'재개 요청 중'};
let data=null,provider='all',view='sessions',selectedId=null,busy=false,actionBusy=false,pendingAction=null,toastTimer,benchmark=null,selectedPeriod='1h';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n==null?'—':n>=1e9?(n/1e9).toFixed(2)+'B':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':Number(n.toFixed(1)).toLocaleString('ko-KR');
const bytes=n=>n==null?'—':n>=2**30?(n/2**30).toFixed(1)+' GB':n>=2**20?(n/2**20).toFixed(0)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':Math.round(n)+' B';
const exact=n=>n==null?'확인 불가':Math.round(n).toLocaleString('ko-KR');
const total=v=>v?v.reduce((a,b)=>a+b,0):null;
const pct=n=>n==null?'—':n.toFixed(1)+'%';
const time=t=>new Date(t*1000).toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit'});
const ago=t=>{if(!t)return '보고 없음';const n=Math.max(0,Date.now()/1000-t);return n<5?'방금':n<60?Math.floor(n)+'초 전':n<3600?Math.floor(n/60)+'분 전':n<86400?Math.floor(n/3600)+'시간 전':Math.floor(n/86400)+'일 전';};
const model=m=>(m||'모델 미확인').replace(/\[1m\]/gi,'').replace(/^claude-/,'').replace(/^gpt-/,'GPT-');
const kindName=k=>k==='Antigravity'?'Agy CLI':k;
const display=s=>s.display_status||s.status;
const dot=k=>`<i class="dot" style="background:${colors[k]}"></i>`;
const status=s=>`<span class="status ${esc(display(s))}"><i class="dot"></i>${s.loading?'기록 읽는 중':labels[display(s)]||'미확인'}</span>`;
function showToast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?14000:8000);}
function actions(s){
 const identified=!!s.control_key,fresh=data?.updated&&Date.now()/1000-data.updated<20;
 const stopped=['idle','interrupted'].includes(s.status),active=['working','waiting'].includes(s.status);
 const canPause=identified&&!!s.orca_terminal&&s.input_verified!==false&&active&&['Claude','GLM','Codex'].includes(s.kind);
 const paused=display(s)==='paused',resuming=display(s)==='resuming';
 const list=[['focus','↗',identified&&!!(s.orca_terminal||s.location?.app_path),'실행 앱·터미널 바로가기'],paused?['resume','재개',identified&&!!s.orca_terminal&&s.input_verified!==false&&stopped,'이어서 작업하는 새 요청 보내기']:['pause','일시정지',canPause&&!resuming,'현재 작업 중단 후 세션 보존'],['terminate','정지',identified&&(stopped||canPause)&&!resuming,'해당 CLI 프로세스 종료']];
 return `<div class="session-actions">${list.map(([a,label,enabled,hint])=>`<button class="action-button ${a}" data-action="${a}" data-target="${esc(s.id)}" ${!enabled||!fresh||actionBusy?'disabled':''} title="${esc(enabled?hint:'세션 연결 또는 작업 상태 확인 필요')}" aria-label="${esc((s.orca_terminal?.title||s.project)+' · '+hint)}">${label}</button>`).join('')}</div>`;
}
function selectView(next){view=next;$('pageTitle').textContent=({sessions:'세션',operations:'활동',system:'컴퓨터 리소스',benchmark:'측정 정보'})[next];for(const v of ['sessions','operations','system','benchmark'])$(v+'View').hidden=v!==view;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));requestAnimationFrame(drawCharts);}
function periodMeta(){return data?.period_usage?.windows.find(w=>w.key===selectedPeriod);}
function periodVector(w){const p=data.period_usage;return provider==='all'?(p.known_kinds.length?w.tokens:null):p.known_kinds.includes(provider)?(w.by_kind[provider]||[0,0,0,0]):null;}
function recordedDuration(seconds){const m=Math.floor(seconds/60);return m<1?'1분 미만':m<60?m+'분':Math.floor(m/60)+'시간'+(m%60?' '+m%60+'분':'');}
function selectPeriod(key){selectedPeriod=key;$('sort').value='period';render();}
function renderPeriods(){
 const p=data.period_usage;if(!p)return;
 const focus=document.activeElement?.dataset.period;
 $('periodScope').textContent=(provider==='all'?'수집된 세션 전체':kindName(provider)+'의 수집된 세션')+' · 종료된 세션 기록 포함 · 현재 연결 세션은 아래 표에서 확인';
 $('periodCards').innerHTML=p.windows.map(w=>{const v=periodVector(w);return `<button class="period-card ${w.key===selectedPeriod?'selected':''}" data-period="${w.key}" aria-pressed="${w.key===selectedPeriod}" title="${v?exact(total(v))+' tokens':'수집된 사용량 보고 없음'}"><span class="period-label">최근 ${w.label}</span><b>${fmt(total(v))}<small> tokens</small></b><span class="period-output">${v?'출력 '+fmt(v[3]):'사용량 미확인'}</span><span class="period-recording ${w.partial?'partial':''}">${w.partial?'일부 기록 · '+recordedDuration(w.observed_seconds):'기록된 보고량'}</span></button>`;}).join('');
 if(focus)document.querySelector(`[data-period="${focus}"]`)?.focus({preventScroll:true});
 $('periodCoverage').textContent='수집 시작 '+new Date(p.recording_started*1000).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})+' · 수집 전·미확인 세션 사용량 제외';
 const w=periodMeta();if(w){$('periodColumn').textContent='최근 '+w.label+' 누적';$('range').value=String(w.seconds/60);$('tokenChartTitle').textContent='최근 '+w.label+' 토큰 흐름';}
}
function render(){
 if(!data?.ready)return;
 const scoped=data.sessions.filter(s=>provider==='all'||s.kind===provider),known=scoped.filter(s=>s.tokens!==null);
 $('providers').innerHTML=[...new Set([...kinds,...data.sessions.map(s=>s.kind)])].map(k=>`<button class="provider-nav ${provider===k?'active':''}" data-provider="${k}" aria-pressed="${provider===k}">${dot(k)}<span>${kindName(k)}</span><small>${data.sessions.filter(s=>s.kind===k).length}</small></button>`).join('');
 const work=scoped.filter(s=>display(s)==='working').length,paused=scoped.filter(s=>display(s)==='paused').length,rate=scoped.reduce((n,s)=>n+(s.usage?.rate||0),0);
 $('summary').innerHTML=`<div class="summary-item"><span class="label">열린 세션 / CLI</span><b>${scoped.length}<small>개</small></b></div><div class="summary-item"><span class="label">작업 중 · 일시정지</span><b class="accent">${work}<small>작업 · ${paused} 정지</small></b></div><div class="summary-item"><span class="label">현재 연결된 세션 누적</span><b>${known.length?fmt(known.reduce((n,s)=>n+total(s.tokens),0)):'—'}<small>tokens</small></b></div><div class="summary-item"><span class="label">최근 60초 평균 소비</span><b class="accent">${known.length?fmt(rate):'—'}<small>tokens/s</small></b></div><div class="summary-note">${known.length}/${scoped.length}개 토큰 확인<br>Orca 탭 ${data.orca_terminals??'—'}개 · CLI ${Object.values(data.process_counts).reduce((a,b)=>a+b,0)}개</div>`;
 $('tableSubtitle').textContent=`${scoped.filter(s=>s.orca_terminal).length}개 터미널 이름 연결 · ${scoped.length-known.length}개 토큰 미확인`;
 $('filterStrip').hidden=provider==='all';$('filterName').textContent=provider==='all'?'':kindName(provider)+' 세션';
 $('lastUpdated').textContent=`마지막 수집 ${time(data.updated)} · 토큰 변화 수집 시작 ${new Date(data.started*1000).toLocaleDateString('ko-KR')} ${time(data.started)}`;
 const loading=data.sessions.filter(s=>s.loading).length;
 $('notice').hidden=!data.error&&!loading;
 $('notice').textContent=data.error?'일부 데이터 수집이 지연되고 있습니다. 마지막으로 확인한 수치를 표시합니다.':`${loading}개 세션의 누적 기록을 읽고 있습니다. 수치가 준비되면 자동으로 갱신됩니다.`;
 renderPeriods();renderHost();renderTable();renderQuotas();renderSystem();renderBenchmark();renderOperations();
 if(selectedId&&$('detailDialog').open)renderDetail(selectedId);
 drawCharts();
}
function renderHost(){
 const h=data.system?.host;if(!h)return;
 const card=(title,value,unit,sub,percent,warn=false)=>`<article class="host-card ${warn?'warning':''}"><div class="label">${title}<span>${warn?'주의':''}</span></div><div class="value">${value}<small>${unit}</small></div><div class="sub">${sub}</div><div class="meter"><i style="width:${Math.min(100,Math.max(0,percent||0))}%"></i></div></article>`;
 $('hostCards').innerHTML=card('전체 CPU',h.cpu==null?'—':h.cpu.toFixed(1),'%',`${h.cores}개 논리 코어 · load ${h.load[0].toFixed(2)}`,h.cpu,h.cpu>90)+card('메모리',bytes(h.memory.used),'',`${bytes(h.memory.total)} 중 ${h.memory.percent}% · swap ${bytes(h.swap.used)}`,h.memory.percent,h.memory.percent>90)+card('네트워크 · '+(h.network.interfaces.join(' + ')||'미확인'),bytes(h.network.rx),'/s ↓',`업로드 ${bytes(h.network.tx)}/s ↑ · 물리 인터페이스`,0)+card('디스크 여유',bytes(h.disk.free),'',`${h.disk.percent}% 사용 · 읽기 ${bytes(h.disk.read)}/s · 쓰기 ${bytes(h.disk.write)}/s`,h.disk.percent,h.disk.percent>95);
}
function renderTable(){
 if(!data?.ready)return;const query=$('search').value.toLocaleLowerCase(),state=$('stateFilter').value;
 let rows=data.sessions.filter(s=>(provider==='all'||s.kind===provider)&&(state==='all'||display(s)===state)&&[s.project,s.title,s.kind,s.model,s.orca_terminal?.title,s.location?.app,s.location?.terminal,s.id].join(' ').toLocaleLowerCase().includes(query));
 const order={working:0,waiting:1,resuming:2,paused:3,interrupted:4,unknown:5,idle:6},sort=$('sort').value;
 const numeric=s=>sort==='period'?total(s.usage?.windows?.[selectedPeriod]):sort==='rate'?s.usage?.rate:sort==='total'?total(s.tokens):s.resources?.[sort];
 rows.sort((a,b)=>sort==='status'?(order[display(a)]-order[display(b)]||b.last_usage-a.last_usage):sort==='terminal'?(a.orca_terminal?.title||'').localeCompare(b.orca_terminal?.title||''):(numeric(b)??-1)-(numeric(a)??-1));
 $('tableCount').textContent=rows.length;$('tableEmpty').hidden=rows.length>0;
 const active=document.activeElement?.closest('[data-action]'),focus=active?{a:active.dataset.action,id:active.dataset.target}:null;
 const html=rows.map(s=>{const r=s.resources,u=s.usage||{},term=s.orca_terminal?.title||s.location?.terminal||s.location?.app,pv=u.windows?.[selectedPeriod],period=periodMeta();
 return `<tr tabindex="0" data-session="${esc(s.id)}" aria-label="${esc(s.project)} ${s.kind} ${esc(term||'터미널 미확인')} ${labels[display(s)]}, 상세 보기"><td><span class="cell-primary ${term?'':'unknown-value'}" title="${esc(s.terminal_note)}">${esc(term||'실행 위치 미확인')}</span><span class="cell-task" title="${esc(s.title)}">${esc(s.title||s.project)}</span><span class="cell-sub" title="${esc(s.cwd)}">${esc(s.project)} · ${s.pids.length===1?'PID '+s.pids[0]:'PID 연결 미확인'}</span></td><td><span class="provider-cell">${dot(s.kind)}${kindName(s.kind)}</span><span class="cell-sub">${esc(model(s.model))}</span></td><td>${status(s)}</td><td class="num period-value" title="${pv?exact(total(pv))+' tokens':'사용량 미확인'}"><strong>${fmt(total(pv))}</strong><span class="cell-sub">${pv?'출력 '+fmt(pv[3]):'미확인'}${period?.partial?' · 일부 기록':''}</span></td><td class="num ${s.tokens?'':'unknown-value'}" title="${s.tokens?exact(total(s.tokens))+' tokens':'유효한 사용량 보고 없음'}">${fmt(total(s.tokens))}<span class="cell-sub">${s.tokens?'출력 '+fmt(s.tokens[3]):'토큰 미확인'}</span></td><td class="num"><span class="rate-value ${u.rate?'':'zero'}">${fmt(u.rate)}</span><span class="cell-sub">${s.last_usage?ago(s.last_usage):'보고 없음'}</span></td><td class="num">${pct(r?.cpu)}<span class="cell-sub">${r?r.count+'개 프로세스':'미귀속'}</span></td><td class="num">${bytes(r?.rss)}</td><td>${actions(s)}</td></tr>`;}).join('');
 if($('sessionsBody').innerHTML!==html)$('sessionsBody').innerHTML=html;
 if(focus)document.querySelector(`#sessionsBody [data-target="${CSS.escape(focus.id)}"][data-action="${focus.a}"]`)?.focus({preventScroll:true});
}
function renderQuotas(){
 const open=new Set([...document.querySelectorAll('[data-quota][open]')].map(e=>e.dataset.quota));
 const window=(w,k)=>`<div class="quota-window"><div class="quota-label"><span>${esc(w.label)}</span><b>${w.pct==null?'갱신 대기':Number(w.pct.toFixed(1))+'% 사용'}</b></div><div class="track"><i style="background:${colors[k]};width:${Math.min(100,Math.max(0,w.pct||0))}%"></i></div><div class="quota-note">${w.reset?new Date(w.reset*1000).toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' 리셋':'리셋 시각 미보고'}</div></div>`;
 $('quotas').innerHTML=data.quotas.map(q=>`<article class="quota"><h3>${dot(q.kind)}${kindName(q.kind)}</h3>${q.windows.slice(0,2).map(w=>window(w,q.kind)).join('')}${q.windows.length>2?`<details data-quota="${q.kind}" ${open.has(q.kind)?'open':''}><summary>한도 ${q.windows.length-2}개 더 보기</summary>${q.windows.slice(2).map(w=>window(w,q.kind)).join('')}</details>`:''}<div class="quota-note">${esc(q.note)}<br>${q.updated?'마지막 보고 '+ago(q.updated):'확인 불가 · 0%를 뜻하지 않음'}</div></article>`).join('');
}
function renderSystem(){
 const sys=data.system;if(!sys)return;const h=sys.host;
 $('sharedResources').innerHTML=sys.shared.length?sys.shared.map(s=>`<div class="shared-row"><div>Codex 백엔드 <small>PID ${s.pid} · 전용 자식 포함 ${s.count}개 프로세스</small></div><div class="values">${pct(s.cpu)} CPU<small>${bytes(s.rss)} RSS</small></div></div>`).join(''):'<div class="empty">현재 공유 백엔드가 없습니다.</div>';
 $('machineMeta').textContent=`${h.platform} · ${h.cores}코어 · ${h.process_count}개 프로세스`;
 const fact=(a,b,c)=>`<article class="fact"><span>${a}</span><b>${b}</b><small>${c}</small></article>`;
 $('systemFacts').innerHTML=fact('가용 메모리',bytes(h.memory.available),'운영체제가 사용할 수 있다고 보고한 메모리')+fact('부팅 이후',Math.floor(h.uptime/86400)+'일 '+Math.floor(h.uptime/3600)%24+'시간',`load 1 / 5 / 15분: ${h.load.map(n=>n.toFixed(2)).join(' / ')}`)+fact('배터리',h.battery?h.battery.percent+'%':'미지원',h.battery?(h.battery.plugged?'전원 연결됨':'배터리 사용 중'):'배터리 정보 미보고')+fact('GPU · 온도','미수집',esc(h.gpu_note));
 $('processBody').innerHTML=sys.top.map(p=>{const s=data.sessions.find(s=>s.id===p.owner);return `<tr><td>${esc(p.name)}</td><td>${p.pid}</td><td>${s?esc((s.orca_terminal?.title||s.project)+' · '+kindName(s.kind)):p.owner?.startsWith('backend:')?'Codex 공유 백엔드':'—'}</td><td class="num">${pct(p.cpu)}</td><td class="num">${bytes(p.rss)}</td></tr>`;}).join('');
}
function renderBenchmark(){
 const s=data.system;if(!s)return;
 $('overhead').innerHTML=[['모니터 CPU',pct(s.monitor.cpu),'수집기 프로세스 · 코어 1개 기준'],['모니터 메모리',bytes(s.monitor.rss),'수집기 RSS · 브라우저 제외'],['이번 수집 시간',fmt(data.collection_ms)+' ms','전체 세션·토큰·시스템 수집'],['리소스 수집 시간',fmt(s.sampler_ms)+' ms','시스템과 프로세스 자원 관측']].map(([a,b,c])=>`<article class="fact"><span>${a}</span><b>${b}</b><small>${c}</small></article>`).join('');
 $('audit').innerHTML=data.actions?.length?[...data.actions].reverse().map(a=>`<div class="audit-entry">${esc(a.terminal||a.project||'터미널 미확인')} · ${esc(a.message)}<small>${new Date(a.t*1000).toLocaleString('ko-KR')}</small></div>`).join(''):'<div class="empty">이 버전에서 실행한 제어 기록이 없습니다.</div>';
 if(benchmark)$('benchmarkNumbers').innerHTML=`<table><thead><tr><th>버전</th><th>평균 CPU</th><th>평균 RSS</th><th>API 평균 응답</th><th>응답 크기</th></tr></thead><tbody>${benchmark.map(b=>`<tr><td>v${esc(b.version)}</td><td>${pct(b.cpu_one_core_mean)}</td><td>${bytes(b.rss_mean_bytes)}</td><td>${b.api_ms_mean.toFixed(1)} ms</td><td>${bytes(b.api_bytes_mean)}</td></tr>`).join('')}</tbody></table>`;
}
function canvasBase(id){const canvas=$(id);if(!canvas||canvas.closest('[hidden]'))return null;const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;const dpr=devicePixelRatio||1;canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w:r.width,h:r.height,l:58,t:10,b:30,r:9};}
function axes(c,max,unit=''){const {ctx,w,h,l,t,b,r}=c;ctx.font='13px -apple-system,sans-serif';for(let i=0;i<4;i++){const y=t+(h-t-b)*i/3;ctx.strokeStyle='#272a30';ctx.beginPath();ctx.moveTo(l,y+.5);ctx.lineTo(w-r,y+.5);ctx.stroke();ctx.fillStyle='#9198a5';ctx.textAlign='left';ctx.fillText(fmt(max*(1-i/3))+unit,0,y+3);}}
function tokenChart(id,events,minutes){const c=canvasBase(id);if(!c)return;const end=Math.floor(Date.now()/60000)*60+60,start=end-minutes*60,step=minutes>300?900:minutes>60?300:60,n=(end-start)/step,bins=Array.from({length:n},()=>Object.fromEntries(kinds.map(k=>[k,0])));for(const e of events){const i=Math.floor((e.t-start)/step);if(i>=0&&i<n)bins[i][e.kind]+=e.n??(e.fresh+e.cached+e.written+e.output);}const max=Math.max(1,...bins.map(b=>Object.values(b).reduce((a,v)=>a+v,0)));axes(c,max);const {ctx,w,h,l,t,b,r}=c,bw=(w-l-r)/n;bins.forEach((v,i)=>{let y=h-b;for(const k of kinds){const bh=v[k]/max*(h-t-b);ctx.fillStyle=colors[k];ctx.globalAlpha=.86;ctx.fillRect(l+i*bw+1,y-bh,Math.max(1,bw-2),bh);y-=bh;}ctx.globalAlpha=1;});ctx.fillStyle='#9198a5';for(let i=0;i<4;i++){ctx.textAlign=i===0?'left':i===3?'right':'center';ctx.fillText(time(start+(end-start)*i/3),l+(w-l-r)*i/3,h-5);}}
function drawCharts(){
 if(!data?.ready)return;
 tokenChart('tokenChart',data.events.filter(e=>provider==='all'||e.kind===provider),Number($('range').value));$('chartLegend').innerHTML=kinds.map(k=>`<span>${dot(k)}${kindName(k)}</span>`).join('');
 const c=canvasBase('systemChart'),hist=data.system?.history||[];
 if(c){axes(c,100,'%');const {ctx,w,h,l,t,b,r}=c,start=hist[0]?.t||0,end=hist.at(-1)?.t||start+1;for(const [key,color] of [['cpu','#398f77'],['memory','#7d88bc']]){ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.beginPath();let started=false;for(const v of hist){if(v[key]==null){started=false;continue;}const x=l+(v.t-start)/Math.max(1,end-start)*(w-l-r),y=h-b-v[key]/100*(h-t-b);if(started)ctx.lineTo(x,y);else ctx.moveTo(x,y);started=true;}ctx.stroke();}ctx.fillStyle='#9198a5';ctx.textAlign='left';ctx.fillText(time(start),l,h-5);ctx.textAlign='right';ctx.fillText(time(end),w-r,h-5);}
 if(selectedId&&$('detailDialog').open){const s=data.sessions.find(s=>s.id===selectedId);if(s)tokenChart('detailChart',(s.usage?.history||[]).map(([t,n])=>({t,n,kind:s.kind})),60);}
}
function detailPeriods(s){const p=data.period_usage;if(!p)return '';return `<section class="detail-periods"><h3>기간별 누적 사용량</h3><p>이 세션의 기록된 보고량 · 입력·캐시·출력 합계</p><div class="period-cards">${p.windows.map(w=>{const v=s.usage?.windows?.[w.key];return `<div class="period-card ${w.key===selectedPeriod?'selected':''}"><span class="period-label">최근 ${w.label}</span><b title="${exact(total(v))}">${fmt(total(v))}</b><span class="period-output">${v?'출력 '+fmt(v[3]):'사용량 미확인'}</span><span class="period-recording ${w.partial?'partial':''}">${w.partial?'일부 기록 · '+recordedDuration(w.observed_seconds):'기록된 보고량'}</span></div>`;}).join('')}</div></section>`;}
function renderDetail(id){
 const s=data.sessions.find(s=>s.id===id);if(!s){$('detailContent').innerHTML='<h2>세션 연결이 종료되었습니다.</h2>';return;}const t=s.tokens,r=s.resources,u=s.usage||{};
 const entry=(a,b)=>`<div><dt>${a}</dt><dd>${esc(b??'확인 불가')}</dd></div>`;
 $('detailContent').innerHTML=`${status(s)}<h2 id="detailTitle">${esc(s.orca_terminal?.title||s.location?.app||'실행 위치 미확인')}</h2><p class="detail-project">${esc(s.title)}<br>${esc(s.cwd)}</p><div class="detail-actions">${actions(s)}</div>${detailPeriods(s)}<div class="detail-metrics">${['새 입력','캐시 읽기','캐시 쓰기','출력'].map((label,i)=>`<div class="detail-metric"><span>${label} tokens</span><b title="${exact(t?.[i])}">${fmt(t?.[i])}</b></div>`).join('')}</div><h3 class="detail-chart-title">최근 1시간 토큰 흐름</h3><div class="chart-wrap"><canvas id="detailChart" role="img" aria-label="이 세션의 최근 1시간 토큰 보고량"></canvas></div><dl class="detail-list">${entry('세션 누적',t?exact(total(t))+' tokens':null)}${entry('최근 60초',u.last_minute?exact(total(u.last_minute))+' tokens · '+fmt(u.rate)+' tokens/s':null)}${entry('최근 5분',u.last_five_minutes?exact(total(u.last_five_minutes))+' tokens':null)}${entry('최근 출력 속도',u.output_rate!=null?fmt(u.output_rate)+' output tokens/s · 60초 평균':null)}${entry('CLI 자원',r?pct(r.cpu)+' CPU · '+bytes(r.rss)+' RSS · '+r.count+'개 프로세스':null)}${entry('모델',s.model||null)}${entry('터미널 연결',s.terminal_note)}${entry('세션 ID',s.id)}${entry('CLI PID',s.pids.length===1?s.pids[0]:'개별 프로세스 미확인')}${entry('최근 사용량 보고',s.last_usage?new Date(s.last_usage*1000).toLocaleString('ko-KR'):null)}${entry('최근 요청 입력',s.request_input!=null?exact(s.request_input)+' tokens':null)}${s.context_size?entry('컨텍스트 크기',exact(s.context_size)+' tokens'):''}${entry('사용량 출처',s.path||'해당 세션 기록 미확인')}</dl>${s.note?`<p class="detail-note">${esc(s.note)}</p>`:''}<p class="detail-note">누적값과 최근 소비 속도에는 반복 입력과 캐시가 포함됩니다. 실제 청구액이나 모델의 순간 생성 속도를 뜻하지 않습니다.</p>`;
}
function prepareAction(action,id){
 const s=data?.sessions.find(s=>s.id===id);if(!s||actionBusy)return;
 const request={action,session_id:s.id,control_key:s.control_key,request_id:crypto.randomUUID()};
 if(action==='focus'){sendAction(request);return;}pendingAction=request;
 const text={pause:['이 작업을 일시정지할까요?','현재 작업에 Esc를 보내고 멈춘 상태를 확인합니다. 세션은 보존되며, 재개하면 이어서 진행하는 새 요청을 보냅니다.','일시정지'],resume:['이어서 작업할까요?','아래 문장을 새 요청으로 전송합니다. 터미널 입력 칸에 작성 중인 내용이 없는지 확인해 주세요. 재개하면 토큰을 다시 사용할 수 있습니다.','새 요청으로 재개'],terminate:['이 CLI를 정지할까요?','작업 중이면 중단을 먼저 요청합니다. 멈춘 상태가 확인되면 해당 CLI만 종료합니다. Orca 탭과 저장된 대화 기록은 유지됩니다.','CLI 정지']}[action];
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
 if(busy)return;busy=true;try{const response=await fetch('/api/state',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('HTTP');data=await response.json();const stale=data.updated&&Date.now()/1000-data.updated>20;$('liveDot').classList.toggle('offline',!!stale||!!data.error);$('connectionText').textContent=!data.ready?'수집 준비 중':data.error?'수집 지연':stale?'오래된 데이터':'실시간 연결';$('clock').textContent=new Date().toLocaleTimeString('ko-KR',{hour12:false});render();}
 catch(e){$('liveDot').classList.add('offline');$('connectionText').textContent='연결 끊김';$('notice').hidden=false;$('notice').textContent='로컬 수집기에 연결할 수 없습니다. 마지막 수집 값을 표시합니다. 1top 앱을 다시 열어 확인해 주세요.';}
 finally{busy=false;}
}
$('views').onclick=e=>{const b=e.target.closest('[data-view]');if(b)selectView(b.dataset.view);};
$('providers').onclick=e=>{const b=e.target.closest('[data-provider]');if(!b)return;provider=provider===b.dataset.provider?'all':b.dataset.provider;selectView('sessions');render();};
$('clearFilter').onclick=()=>{provider='all';render();};$('search').oninput=renderTable;$('stateFilter').onchange=renderTable;$('sort').onchange=renderTable;$('range').onchange=()=>{const w=data?.period_usage?.windows.find(w=>w.seconds===Number($('range').value)*60);if(w)selectPeriod(w.key);};
$('periodCards').onclick=e=>{const b=e.target.closest('[data-period]');if(b)selectPeriod(b.dataset.period);};
function openDetail(e){if(e.target.closest('button'))return;const r=e.target.closest('[data-session]');if(!r)return;selectedId=r.dataset.session;renderDetail(selectedId);if(!$('detailDialog').open)$('detailDialog').show();document.body.classList.add('inspecting');drawCharts();}
$('sessionsBody').onclick=openDetail;$('sessionsBody').onkeydown=e=>{if(!e.target.closest('button')&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(e);}};
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled){e.preventDefault();prepareAction(b.dataset.action,b.dataset.target);}});
$('confirmAction').onclick=()=>{if(pendingAction)sendAction(pendingAction);};$('cancelAction').onclick=()=>{pendingAction=null;$('actionDialog').close();};$('actionDialog').addEventListener('cancel',e=>{if(actionBusy)e.preventDefault();else pendingAction=null;});
$('closeDetail').onclick=()=>$('detailDialog').close();$('detailDialog').addEventListener('close',()=>document.body.classList.remove('inspecting'));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('detailDialog').open&&!$('actionDialog').open)$('detailDialog').close();});$('closeHelp').onclick=()=>$('helpDialog').close();$('helpButton').onclick=()=>$('helpDialog').showModal();$('refresh').onclick=refresh;
window.addEventListener('resize',drawCharts);refresh();setInterval(refresh,3000);
fetch('/benchmark.json').then(r=>r.ok?r.json():null).then(x=>{benchmark=x;if(data?.ready)renderBenchmark();}).catch(()=>{});

function renderOperations(){
 const o=data?.operations;if(!o)return;
 const active=o.goals.filter(g=>g.status==='active').length;
 $('operationSummary').innerHTML=[['저장된 활성 Goal',o.goal_source_status==='reported'?active:'—','현재 세션 연결 여부는 아래에서 별도 표시'],['설치 확인 Skills',o.skills.length,'활성화·작업 성공 여부는 별도'],['관측된 호출 / 실행',o.events.length,'최근 로그 일부 · 전체 이력 아님'],['Loop 다음 실행','미확인','예약 엔진의 현재 상태를 추정하지 않음']].map(([a,b,c])=>`<article class="fact"><span>${a}</span><b>${b}</b><small>${c}</small></article>`).join('');
 const expandedGoals=new Set([...document.querySelectorAll('[data-goal][open]')].map(e=>e.dataset.goal));
 const goalLabels={active:'활성',complete:'완료',paused:'일시정지',blocked:'차단됨',cleared:'해제됨',failed:'달성 불가',budget_limit:'예산 한도',usage_limit:'사용 한도'};
 $('goalRows').innerHTML=o.goals.length?o.goals.map(g=>`<article class="goal-row"><div><span class="status ${g.status==='active'?'working':''}">${esc(goalLabels[g.status]||g.status)}</span><details class="goal-objective" data-goal="${esc(g.goal_id)}" ${expandedGoals.has(g.goal_id)?'open':''}><summary>${esc(g.objective.length>180?g.objective.slice(0,180)+'…':g.objective)}</summary><p>${esc(g.objective)}</p></details><p>${esc(g.runtime)} · ${esc(g.location)} · ${g.evidence==='last_observed'?'마지막 관측 상태 · ':''}${g.session_connected?'현재 세션 연결됨':'저장된 상태 · 현재 실행 연결 미확인'}</p></div><div class="goal-metrics"><strong>${fmt(g.tokens_used)}<small> tokens</small></strong><span>예산 ${g.token_budget==null?'미설정':fmt(g.token_budget)}</span><span>사용 시간 ${g.time_used_seconds==null?'미보고':recordedDuration(g.time_used_seconds)}</span></div></article>`).join(''):`<div class="empty">${o.goal_source_status==='reported'?'확인된 Goal 기록이 없습니다. Claude Code는 최근 로그 범위만 관측합니다.':'Goal 저장소를 읽을 수 없습니다.'}</div>`;
 const labels={invoked:'호출 관측',tool_returned:'도구 응답 확인',tool_error:'도구 오류',fire_observed:'예약 실행 관측'};
 $('operationEvents').innerHTML=o.events.length?o.events.slice(0,30).map(e=>`<div class="event-row"><span class="event-type">${e.category==='skill'?'SKILL':'LOOP'}</span><div><strong>${esc(e.name)}</strong><small>${esc(e.location)}${e.schedule?' · '+esc(e.schedule):''}</small></div><span>${esc(labels[e.state]||e.state)}</span><time>${e.observed_at?new Date(e.observed_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'시각 미보고'}</time></div>`).join(''):'<div class="empty">최근 로그 범위에서 확인된 호출이 없습니다. 실행하지 않았다는 뜻은 아닙니다.</div>';
 renderSkills();
}
function renderSkills(){
 const o=data?.operations;if(!o)return;const q=$('skillSearch').value.toLowerCase();
 const rows=o.skills.filter(s=>[s.name,s.path,...s.providers].join(' ').toLowerCase().includes(q));
 $('skillCount').textContent=rows.length;
 $('skillRows').innerHTML=rows.map(s=>`<tr><td><strong>${esc(s.name)}</strong><small class="skill-path">${esc(s.path)}</small></td><td>${esc(s.providers.join(' · '))}</td><td>${esc(s.scope)}</td><td><span class="status">설치 확인</span><small>세션 활성화 미확인</small></td></tr>`).join('')||'<tr><td colspan="4" class="empty">조건에 맞는 설치 파일이 없습니다.</td></tr>';
}
$('skillSearch').oninput=renderSkills;
