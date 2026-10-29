/* Quick view for the Windows tray: the macOS menu bar panel (desktop/QuickDashboard.swift) in HTML.
   Same order and rules: the period picker governs every number below it — the token radar and
   models, weekly limits with their trend, resources and the session list. Reads /api/state like the
   dashboard; session controls use the collector's guarded HTTP API, never the shell bridge. */
(function(root){
 'use strict';
 const PERIODS=[['10m','10분',600],['30m','30분',1800],['1h','1시간',3600],['5h','5시간',18000],['12h','12시간',43200],['24h','24시간',86400]];
 const SECONDS=Object.fromEntries(PERIODS.map(([k,,s])=>[k,s]));
 const CANONICAL=['Claude','Codex','GLM','Antigravity','Aside'];
 const COLORS={Claude:'#bd8965','Claude Code':'#bd8965',Codex:'#378d76',GLM:'#7c86bd',Antigravity:'#619db9'};
 const color=k=>COLORS[k]||'#a99bdb';
 const toolName=k=>k==='Claude'?'Claude Code':k==='Antigravity'?'Agy CLI':k;
 const finite=n=>typeof n==='number'&&Number.isFinite(n);
 const sum=v=>Array.isArray(v)?v.reduce((a,b)=>a+b,0):null;

 // Numbers like the panel: whole numbers past ten, one decimal below, trailing zeros trimmed.
 function shortNumber(v){
  if(!finite(v)||v<0)return '—';if(v<.5)return '0';
  const [d,u]=v>=1e9?[1e9,'B']:v>=1e6?[1e6,'M']:v>=1e3?[1e3,'k']:[1,''],x=v/d;
  const text=x>=10?String(Math.round(x)):x.toFixed(1);
  return (text.includes('.')?text.replace(/\.?0+$/,''):text)+u;
 }
 function pct1(v){
  if(!finite(v)||v<0)return '—';if(v===0)return '0%';if(v<.05)return '<0.1%';
  const tenths=Math.round(v*10)/10;return (Number.isInteger(tenths)?String(tenths):tenths.toFixed(1))+'%';
 }
 const percent0=v=>finite(v)?Math.round(v)+'%':'—';
 function niceMaximum(peak){if(!finite(peak)||peak<=0)return 1;const power=10**Math.floor(Math.log10(peak)),f=peak/power;return ([1,2,5,10].find(n=>n>=f)||10)*power;}

 // Sessions: grouped root rows, working first, then the selected period's tokens.
 const stateOf=s=>s.display_status||s.status||'unknown';
 const working=s=>stateOf(s)==='working'||(s.children_working||0)>0;
 function amount(s,period){const w=s.usage?.windows?.[period];if(!Array.isArray(w)||!w.length||!w.every(n=>finite(n)&&n>=0))return -1;return sum(w);}
 function orderSessions(rows,period){
  const sorted=[...rows].sort((a,b)=>working(a)!==working(b)?(working(a)?-1:1):amount(b,period)-amount(a,period)||(a.id<b.id?-1:a.id>b.id?1:0));
  return [...sorted.filter(working),...sorted.filter(s=>!working(s))];
 }
 function allows(s,action){
  if(!s.control_key)return false;
  const status=s.status||'',state=stateOf(s),stopped=['idle','interrupted'].includes(status);
  const canPause=!!s.orca_terminal&&s.input_verified!==false&&['working','waiting'].includes(status)&&['Claude','GLM','Codex'].includes(s.kind);
  if(action==='focus')return !!s.orca_terminal||!!s.location?.app_path;
  if(action==='pause')return (s.kind==='Aside'&&['working','waiting'].includes(state))||canPause&&state!=='resuming'&&state!=='paused';
  if(action==='resume')return state==='paused'&&stopped&&!!s.orca_terminal&&s.input_verified!==false;
  if(action==='terminate')return s.kind!=='Aside'&&(stopped||canPause)&&state!=='resuming';
  return false;
 }
 function shortModel(s){
  let name=String(s.model||'').trim();if(!name)return toolName(s.kind);
  name=name.replace(/\[1m\]/ig,'');if(/^claude-/i.test(name))name=name.slice(7);if(/^gpt-/i.test(name))name='GPT-'+name.slice(4);
  return name;
 }
 // The period's tokens by model, largest first; past four the rest folds into one slice.
 function modelSlices(rows,period,periodTokens){
  const by=new Map();
  for(const s of rows){if(s.tokens==null)continue;const w=s.usage?.windows?.[period];if(!Array.isArray(w)||!w.length||!w.every(n=>finite(n)&&n>=0))continue;
   const tokens=sum(w),name=shortModel(s),key=s.kind+'|'+name;if(tokens>0){const row=by.get(key)||{kind:s.kind,model:name,tokens:0};row.tokens+=tokens;by.set(key,row);}}
  const list=[...by.values()].sort((a,b)=>a.tokens===b.tokens?(a.model<b.model?-1:1):b.tokens-a.tokens);
  const sessionsTotal=list.reduce((n,r)=>n+r.tokens,0),total=Math.max(sessionsTotal,finite(periodTokens)?periodTokens:0);
  const shown=list.length<=4?list:list.slice(0,3),seen={};
  const slices=shown.map(r=>{const i=seen[r.kind]||0;seen[r.kind]=i+1;return {id:r.kind+'|'+r.model,name:r.model,detail:toolName(r.kind),kind:r.kind,value:r.tokens,shade:[1,.68,.46][Math.min(i,2)]};});
  const rest=total-shown.reduce((n,r)=>n+r.tokens,0),others=list.length-shown.length;
  if(total>0&&rest>total*.005)slices.push({id:'__rest__',rest:true,others,endedToo:total-sessionsTotal>total*.005,kind:null,value:rest,shade:1});
  return {slices,total};
 }
 // Weekly estimate rules, as in DashboardModel.swift.
 function burnPerHour(estimate,tokensPerSecond){
  const c=estimate?.calibration;
  if(estimate?.basis!=='calibrated_token_equivalent'||!c||!(finite(c.tokens)&&c.tokens>0)||!(finite(c.used_pp)&&c.used_pp>0)||!(finite(c.seconds)&&c.seconds>=120)||!(finite(tokensPerSecond)&&tokensPerSecond>=0))return null;
  const v=tokensPerSecond*(c.used_pp/c.tokens)*3600;return finite(v)?v:null;
 }
 function permitsBurnRate(estimate,quota,now){
  if(!estimate||!quota||quota.id!==estimate.account_id||!finite(now))return false;
  const c=estimate.calibration;if(c?.source!=='historical_provider_calibration')return !quota.stale;
  const current=quota.windows?.find(w=>w.label==='주간')?.reset;
  return quota.kind==='Claude'&&c.kind==='Claude'&&finite(c.reset)&&finite(c.valid_until)&&finite(c.to)&&c.to>0&&c.to<=now&&finite(current)&&current>now&&Math.abs(c.reset-current)<=60&&c.valid_until>now&&c.valid_until<=Math.min(c.reset,c.to+86400);
 }
 function weeklyBurnPerHour(s,period){
  const e=s.usage?.weekly_estimate?.[period],account=s.usage?.weekly_account;
  return e&&account&&e.account_id===account?burnPerHour(e,s.usage?.rate):null;
 }
 function periodBurn(p){if(!p||!finite(p.used_pp)||p.used_pp<0||!finite(p.observed_seconds)||p.observed_seconds<120)return null;const v=p.used_pp/p.observed_seconds*3600;return finite(v)?v:null;}
 // Weekly % reports inside the period plus one before it, so the line starts at the edge.
 function weeklyPoints(account,start,end){
  const source=account?.usage_points||account?.history||[];
  const points=source.filter(p=>Array.isArray(p)&&p.length>=2&&finite(p[0])&&p[0]<=end&&finite(p[1])&&p[1]>=0&&p[1]<=100).map(p=>({t:p[0],pct:p[1]})).sort((a,b)=>a.t-b.t);
  const first=points.findIndex(p=>p.t>=start);if(first<0)return [];
  const out=[];for(const p of points.slice(Math.max(0,first-1)))if(!out.length||p.t>out.at(-1).t)out.push(p);return out;
 }
 // Radar bins: snapshot clock, minute boundary, 1/5/15-minute buckets, stacked by tool.
 function trend(events,period,end){
  const seconds=SECONDS[period]||3600,finish=Math.floor((finite(end)?end:0)/60)*60+60,start=finish-seconds;
  const step=seconds>18000?900:seconds>3600?300:60,count=Math.round(seconds/step);
  const bins=Array.from({length:count},()=>({tokens:0,byKind:{}}));
  for(const e of events||[]){const total=e.n??((e.fresh??0)+(e.cached??0)+(e.written??0)+(e.output??0));
   if(!finite(e.t)||!finite(total)||total<0||e.t<start||e.t>=finish)continue;
   const i=Math.min(count-1,Math.floor((e.t-start)/step)),kind=String(e.kind||'').trim()||'unknown';bins[i].tokens+=total;bins[i].byKind[kind]=(bins[i].byKind[kind]||0)+total;}
  const kinds=new Set(bins.flatMap(b=>Object.keys(b.byKind)));
  const series=[...CANONICAL.filter(k=>kinds.has(k)),...[...kinds].filter(k=>!CANONICAL.includes(k)).sort()];
  return {step,series,reported:Array.isArray(events),bins:bins.map(b=>({total:b.tokens/step*3600,byKind:series.map(k=>[k,(b.byKind[k]||0)/step*3600])}))};
 }
 function accountNumbers(quotas){
  const out={},kinds=new Set((quotas||[]).map(q=>q.kind));
  for(const kind of kinds){const list=quotas.filter(q=>q.kind===kind).sort((a,b)=>String(a.account_label).toLowerCase()<String(b.account_label).toLowerCase()?-1:1);if(list.length>1)list.forEach((q,i)=>out[q.id]=i+1);}
  return out;
 }
 const api={shortNumber,pct1,niceMaximum,orderSessions,allows,shortModel,modelSlices,burnPerHour,permitsBurnRate,weeklyBurnPerHour,periodBurn,weeklyPoints,trend,accountNumbers,toolName};
 if(typeof module!=='undefined'){module.exports=api;return;}
 root.OneTopQuick=api;
 if(typeof document==='undefined')return;

 /* ---------- The panel ---------- */
 const $=id=>document.getElementById(id);
 const T=s=>root.OneTopI18n?root.OneTopI18n.t(s):s;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const KEY='onetop.quick.v1';
 let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{}
 const S={data:null,connected:false,period:'1h',tokensMode:saved.tokensMode===true,zoom:finite(saved.zoom)?Math.min(1.6,Math.max(.8,saved.zoom)):1,
  lang:'ko',now:Date.now()/1000,shown:false,fetching:false,busy:false,authorizing:null,message:null,layer:null,login:{enabled:false,managed:false},html:{},hovered:null};
 const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify({tokensMode:S.tokensMode,zoom:S.zoom}));}catch{}};
 const native=()=>root.pywebview?.api||null;
 const fallback={open_dashboard:()=>root.open('/','_blank'),open_browser:()=>root.open('/','_blank'),open_remote:()=>root.open('https://1top.si/app','_blank'),relay_default:()=>'https://onetop-relay.gitreels.workers.dev',login:()=>S.login};
 async function call(name,...args){const bridge=native();if(bridge&&typeof bridge[name]==='function'){try{return await bridge[name](...args);}catch{return null;}}return fallback[name]?fallback[name](...args):null;}
 const reduced=()=>root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

 // Language and theme are the dashboard's own choice, kept in its storage. The quick view's two buttons
 // change that same choice, like the dashboard's: the theme switch, and one language button that moves
 // 한 → EN → 中 on each tap. The shell then reloads the dashboard window so both stay in step.
 const DASHBOARD='onetop.dashboard.v1',LANGS=[['ko','한','한국어'],['en','EN','English'],['zh','中','中文']];
 function preferences(){try{const s=JSON.parse(localStorage.getItem(DASHBOARD)||'null')||{};return {theme:s.theme==='light'?'light':'dark',lang:['ko','en','zh'].includes(s.lang)?s.lang:'ko'};}catch{return {theme:'dark',lang:'ko'};}}
 function choose(change){let s={};try{s=JSON.parse(localStorage.getItem(DASHBOARD)||'null')||{};}catch{}try{localStorage.setItem(DASHBOARD,JSON.stringify({...s,...change}));}catch{}}
 function applyPreferences(origin='dashboard'){
  const p=preferences();document.documentElement.dataset.theme=p.theme;document.documentElement.style.colorScheme=p.theme;
  S.lang=p.lang;root.OneTopI18n?.setLanguage(p.lang);document.title=T('1top · 간략 대시보드');palette=null;S.html={};dial.digits='';call('preferences',p.lang,p.theme,origin);
 }
 let langTarget=null;
 function switchTheme(button){root.OneTopEffects.reveal(button,()=>{choose({theme:preferences().theme==='dark'?'light':'dark'});applyPreferences('quick');render();});}
 function switchLanguage(button){
  const from=Math.max(0,LANGS.findIndex(l=>l[0]===(langTarget||S.lang))),to=LANGS[(from+1)%LANGS.length][0];langTarget=to;
  root.OneTopEffects.reveal(button,()=>{choose({lang:to});if(langTarget===to)langTarget=null;applyPreferences('quick');render();},to);
 }
 const perHour=()=>({ko:'/시간',en:'/h',zh:'/小时'})[S.lang];
 const rate1=v=>v==null?'—':pct1(v)+perHour();
 const count=n=>({ko:n+'개',en:n+' more',zh:n+' 个'})[S.lang];
 function resetLabel(reset){
  if(!(reset>0))return T('초기화 시각 미보고');
  const minutes=Math.ceil((reset-S.now)/60);if(minutes<=0)return T('초기화 보고 대기');
  const d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60,L=S.lang;
  const span=minutes>=1440?(L==='ko'?`${d}일 ${h}시간`:L==='zh'?`${d}天${h}小时`:`${d}d ${h}h`):minutes>=60?(L==='ko'?`${Math.floor(minutes/60)}시간 ${m}분`:L==='zh'?`${Math.floor(minutes/60)}小时${m}分钟`:`${Math.floor(minutes/60)}h ${m}m`):(L==='ko'?`${minutes}분`:L==='zh'?`${minutes}分钟`:`${minutes}m`);
  return L==='ko'?span+' 후 초기화':L==='zh'?span+'后重置':'Resets in '+span;
 }
 // How old an unrefreshed value is, so an old % never reads as current: "38분 전 보고".
 function reportAge(updated){
  const s=Math.max(0,S.now-updated),L=S.lang;if(s<60)return T('방금 보고');
  const [n,ko,en,zh]=s<3600?[Math.floor(s/60),'분','m','分钟']:s<86400?[Math.floor(s/3600),'시간','h','小时']:[Math.floor(s/86400),'일','d','天'];
  return L==='ko'?`${n}${ko} 전 보고`:L==='zh'?`${n}${zh}前报告`:`Reported ${n}${en} ago`;
 }
 function statusLabel(q){
  if(!q.stale)return T('확인됨');
  switch(q.status){case 'last_report':return reportAge(q.updated);case 'report_pending':return T('보고 대기');
   case 'login_required':case 'login_expired':case 'credential_store_unavailable':case 'access_denied':return T('재연결 필요');
   case 'refresh_pending':return T('갱신 중');case 'rate_limited':return T('조회 제한');default:return q.updated>0?reportAge(q.updated):T('조회 지연');}
 }
 const RECONNECT=new Set(['login_required','login_expired','credential_store_unavailable','access_denied']);

 const fresh=()=>{const d=S.data;return !!(S.connected&&d?.ready&&!d.error&&finite(d.updated)&&S.now-d.updated>=-5&&S.now-d.updated<=20);};
 const sessions=()=>S.data?.root_sessions||S.data?.sessions||[];
 const quotas=()=>S.data?.account_quotas||[];
 function connectionLabel(){
  if(fresh())return T('실시간 · 이 PC');
  if(!S.data)return T(S.connected?'세션 수집 중':'수집기 연결 중');
  if(S.data.ready===false)return T('세션 수집 중');
  return T(S.connected?'수집 지연 · 마지막 기록':'연결 끊김 · 마지막 기록');
 }
 const periodLabel=()=>T('최근 '+PERIODS.find(p=>p[0]===S.period)[1]);
 function periodTokens(){const pu=S.data?.period_usage;if(!pu?.known_kinds?.length)return null;return sum(pu.windows?.find(w=>w.key===S.period)?.tokens);}
 function reading(){
  const seconds=SECONDS[S.period],ok=fresh(),tokens=periodTokens(),end=S.data?.updated??S.now;
  const average=ok&&finite(tokens)?tokens/seconds*3600:null,flow=trend(S.data?.events,S.period,end);
  return {average,bins:ok&&flow.reported?flow.bins:[]};
 }

 /* Icons drawn like the SF Symbols the macOS panel uses. */
 const icon={
  more:'<svg width="15" height="4" viewBox="0 0 15 4" fill="currentColor"><circle cx="2" cy="2" r="1.6"/><circle cx="7.5" cy="2" r="1.6"/><circle cx="13" cy="2" r="1.6"/></svg>',
  plus:'<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 1v8M1 5h8"/></svg>',
  open:'<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9 9.5 2.5M4 2.5h5.5V8"/></svg>',
  close:'<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
  dashboard:'<svg width="15" height="12" viewBox="0 0 15 12" fill="none"><rect x=".75" y=".75" width="13.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="2.8" y="2.8" width="9.4" height="6.4" rx=".8" fill="currentColor"/></svg>',
  browser:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.6"/><path d="M10.9 5.1 9.2 9.2 5.1 10.9l1.7-4.1z" stroke-linejoin="round"/></svg>',
  terminal:'<svg width="26" height="22" viewBox="0 0 26 22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="1" width="24" height="20" rx="3.5"/><path d="M6 7l4 4-4 4M12.5 15h7"/></svg>'
 };
 const wave=size=>`<span class="q-wave" style="--w:${size}px" aria-hidden="true"><i></i><i></i><i></i></span>`;
 function chip(id){
  const q=quotas().find(x=>x.id===id);if(!id||!q&&!accountNumbers(quotas())[id])return '';
  if(q?.alias)return `<span class="q-chip alias" title="${esc(q.account_label)}">${esc(q.alias)}</span>`;
  const n=accountNumbers(quotas())[id];return n?`<span class="q-chip" title="${esc(q?.account_label||'')}">${n}</span>`:'';
 }
 function update(id,html){if(S.html[id]===html)return false;S.html[id]=html;$(id).innerHTML=html;return true;}

 function renderHead(){
  const theme=preferences().theme,at=Math.max(0,LANGS.findIndex(l=>l[0]===S.lang)),[,mark,name]=LANGS[at],next=LANGS[(at+1)%LANGS.length][2];
  const themeLabel=T(theme==='dark'?'화이트 모드':'다크 모드'),langLabel=`${T('언어')}: ${name} → ${next}`;
  update('qHead',`<div class="q-brand"><img class="q-mark" src="/brand-mark_v1.1.0.png" alt="" width="28" height="28"><span>1top</span></div><span class="q-spacer"></span><span class="q-pill"><i class="q-dot${fresh()?'':' warn'}"></i><span id="quickConnection">${esc(connectionLabel())}</span></span><button class="q-pref q-theme" data-act="theme" aria-label="${esc(themeLabel)}" title="${esc(themeLabel)}">${theme==='dark'?'☀':'☾'}</button><button class="q-pref q-lang" data-act="language" lang="${S.lang}" aria-label="${esc(langLabel)}" title="${esc(langLabel)}">${mark}</button><button class="q-more" data-act="menu" data-menu="head" aria-label="${esc(T('1top 옵션'))}" aria-haspopup="menu">${icon.more}</button>`);
  update('qPeriods',PERIODS.map(([k,l])=>`<button type="button" data-act="period" data-period="${k}" aria-pressed="${S.period===k}" aria-label="${esc(T('최근 '+l))}">${esc(T(l))}</button>`).join(''));
  $('qPeriods').setAttribute('aria-label',T('사용량 기간'));
 }
 function renderTokens(r){
  const usage=modelSlices(sessions(),S.period,periodTokens());
  update('qTokensHead',`<b id="qTokensTitle">${esc(T('토큰 사용'))}</b><span>${esc(periodLabel())}</span><span class="q-spacer"></span>`);
  $('qTokensHead').title=usage.total>0?`${periodLabel()} · ${shortNumber(usage.total)} tokens`:'';
  let legend;
  if(!usage.slices.length)legend=`<p class="q-empty-note">${esc(T(r.average==null?'사용량을 확인하고 있습니다':'이 기간에 보고된 사용이 없습니다'))}</p>`;
  else{
   const fill=s=>s.kind?`color-mix(in srgb,${color(s.kind)} ${Math.round(s.shade*100)}%,transparent)`:'var(--dim)';
   const share=v=>usage.total>0?(v/usage.total*100<1?'<1%':Math.round(v/usage.total*100)+'%'):'—';
   const name=s=>s.rest?T(s.others>0?'기타 모델':'종료된 세션'):s.name;
   const detail=s=>s.rest?(s.others>0?count(s.others)+(s.endedToo?' · '+T('종료 세션 포함'):''):T('목록에 없는 세션')):s.detail;
   legend=`<div class="q-legend-title">${esc(T('모델별'))}</div><div class="q-stack">${usage.slices.map(s=>`<i style="flex:${s.value/usage.total} 1 0;background:${fill(s)};--s:2.4px"></i>`).join('')}</div><div class="q-slices">${usage.slices.map(s=>`<div class="q-slice" title="${esc(name(s)+' · '+detail(s)+'\n'+shortNumber(s.value)+' tokens · '+share(s.value))}"><i style="background:${fill(s)}"></i><div><b>${esc(name(s))}</b><small>${esc(detail(s))}</small></div><span>${share(s.value)}</span></div>`).join('')}</div>`;
  }
  update('qLegend',legend);
 }
 function weeklyTile(q){
  const w=q.windows?.find(x=>x.label==='주간'),account=S.data?.weekly_usage?.accounts?.find(a=>a.id===q.id),p=account?.periods?.[S.period];
  const rate=fresh()&&!q.stale?periodBurn(p):null,handle=String(q.account_label||'').split('@')[0];
  const status=q.stale?statusLabel(q):rate==null?T('수집 중'):rate1(rate);
  const label=`${toolName(q.kind)} ${q.account_label} ${T('주간 한도')} ${pct1(w?.pct)}`;
  return `<button type="button" class="q-tile" style="--tint:${color(q.kind)}" data-act="account" data-account="${esc(q.id)}" aria-label="${esc(label)}" title="${esc(q.account_label+' · '+(q.plan||'')+'\n'+T('클릭하면 5시간 한도와 초기화 시각을 확인합니다.'))}"><span class="q-tile-top"><i></i><b>${esc(toolName(q.kind))}</b>${chip(q.id)}<strong class="${q.stale?'stale':''}">${pct1(w?.pct)}</strong></span><span class="q-tile-bottom"><span>${esc(handle)}</span><svg class="q-spark" data-spark="${esc(q.id)}" aria-hidden="true"></svg><span class="${q.stale?'stale':''}">${esc(status)}</span></span></button>`;
 }
 function renderWeekly(){
  const rows=quotas(),disabled=!fresh()||S.busy;
  const changed=update('qWeekly',`<div class="q-heading"><b>${esc(T('주간 한도'))}</b><span>${esc(T('계정별 100%'))}</span><span class="q-spacer"></span><button class="q-plus" data-act="menu" data-menu="accounts" aria-label="${esc(T('구독 계정 추가 로그인'))}" ${disabled?'disabled':''}>${icon.plus}</button></div>${rows.length?`<div class="q-weekly-grid">${rows.slice(0,4).map(weeklyTile).join('')}</div>`:`<p class="q-empty-note">${esc(T('+ 버튼으로 구독 계정을 연결하세요.'))}</p>`}`);
  if(changed)drawSparks();
 }
 function drawSparks(){
  const end=S.data?.updated??S.now,start=end-SECONDS[S.period];
  document.querySelectorAll('[data-spark]').forEach(svg=>{
   const q=quotas().find(x=>x.id===svg.dataset.spark),account=S.data?.weekly_usage?.accounts?.find(a=>a.id===q?.id),points=weeklyPoints(account,start,end);
   const W=svg.getBoundingClientRect().width/(S.zoom||1)||40,H=14;svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
   if(!points.length||end<=start){svg.innerHTML='';return;}
   const plot={x:0,y:5,w:W-6,h:H-10};let lo=Math.min(...points.map(p=>p.pct)),hi=Math.max(...points.map(p=>p.pct));
   if(hi-lo<2){const mid=(hi+lo)/2;lo=mid-1;hi=mid+1;}const pad=(hi-lo)*.15;lo-=pad;hi+=pad;if(lo<0){hi-=lo;lo=0;}
   const P=p=>[plot.x+(p.t-start)/(end-start)*plot.w,plot.y+plot.h-(p.pct-lo)/(hi-lo)*plot.h];
   const xy=points.map(P),line=xy.map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join(''),tip=xy.at(-1),c=color(q.kind),g='g'+q.id.replace(/\W/g,'');
   svg.innerHTML=`<defs><linearGradient id="${g}" x1="0" y1="${plot.y}" x2="0" y2="${plot.y+plot.h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${c}" stop-opacity=".3"/><stop offset="1" stop-color="${c}" stop-opacity=".02"/></linearGradient><clipPath id="c${g}"><rect width="${W}" height="${H}"/></clipPath></defs><g clip-path="url(#c${g})" opacity="${q.stale?.5:1}"><path d="${line}L${tip[0].toFixed(2)} ${plot.y+plot.h}L${xy[0][0].toFixed(2)} ${plot.y+plot.h}Z" fill="url(#${g})"/><path d="${line}" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${tip[0]}" cy="${tip[1]}" r="4.5" fill="${c}" fill-opacity=".25"/><circle cx="${tip[0]}" cy="${tip[1]}" r="2.4" fill="${c}"/></g>`;
  });
 }
 function renderResources(){
  const h=S.data?.system?.host,row=(label,v)=>`<div class="q-resource" title="${esc(T(label)+' · '+T('이 PC 전체 사용률')+' '+percent0(v))}"><span>${esc(T(label))}</span><div class="q-bar"><i class="${(v??0)>90?'hot':''}" style="width:${Math.min(100,Math.max(0,v??0))}%"></i></div><span>${percent0(v)}</span></div>`;
  update('qResources',row('CPU',h?.cpu)+row('메모리',h?.memory?.percent));
 }
 function sessionPace(s){
  if(!fresh())return null;
  if(S.tokensMode)return s.tokens==null?null:finite(s.usage?.rate)&&s.usage.rate>=0?s.usage.rate*3600:null;
  const quota=quotas().find(q=>q.id===s.usage?.weekly_account),e=s.usage?.weekly_estimate?.[S.period];
  return permitsBurnRate(e,quota,S.now)?weeklyBurnPerHour(s,S.period):null;
 }
 function gauge(value,scale,tint,hub){
  const cx=10,cy=10.5,r=8.5,pace=value??0,angle=180+180*Math.min(1,Math.max(0,pace/Math.max(scale,1e-4))),pt=(a,rr)=>[cx+Math.cos(a*Math.PI/180)*rr,cy+Math.sin(a*Math.PI/180)*rr];
  const arc=to=>{const [x0,y0]=pt(180,r),[x1,y1]=pt(to,r);return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;};
  const [tx,ty]=pt(angle,r-1.5);
  return `<svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true"><path d="${arc(359.9)}" fill="none" stroke="var(--line)" stroke-width="2.6" stroke-linecap="round"/>${pace>0?`<path d="${arc(Math.max(180.1,angle))}" fill="none" stroke="${tint}" stroke-width="2.6" stroke-linecap="round"/>`:''}${value!=null?`<path d="M${cx} ${cy}L${tx.toFixed(2)} ${ty.toFixed(2)}" stroke="${pace>0?'var(--ink)':'var(--dim)'}" stroke-width="1.2" stroke-linecap="round"/>`:''}<circle cx="${cx}" cy="${cy}" r="2" fill="${hub}"/></svg>`;
 }
 const STATE={working:'작업 중',waiting:'확인 필요',idle:'대기',paused:'일시정지',resuming:'재개 요청 중',interrupted:'중단됨'};
 const stateLabel=s=>T(STATE[stateOf(s)]||'미확인');
 const groupStateLabel=s=>{const n=s.children_working||0;return n>0?stateLabel(s)+({ko:` · 하위 ${n}개 작업 중`,en:` · ${n} subsessions working`,zh:` · ${n} 个子会话工作中`})[S.lang]:stateLabel(s);};
 const sessionName=s=>s.orca_terminal?.title||(s.kind==='Aside'&&s.title)||s.project||s.kind;
 const projectName=s=>s.project==='0'?T('Aside 기본 작업공간'):(s.project||s.kind);
 const locationLabel=s=>{const name=s.orca_terminal?.title||s.location?.app||T('실행 위치 미확인');return s.orca_terminal?'Orca · '+name:name;};
 function sessionRow(s,scale){
  const quota=quotas().find(q=>q.id===s.usage?.weekly_account),e=s.usage?.weekly_estimate?.[S.period],burn=sessionPace(s);
  const pending=!fresh()?T('마지막 기록'):quota?.stale?(statusLabel(quota)||T('한도 조회 대기')):!s.usage?.weekly_account?T('계정 연결 필요'):T('환산 기준 수집 중');
  const tool=s.kind==='Aside'?(s.model||'Aside'):toolName(s.kind),hub=working(s)?'var(--lcd)':stateOf(s)==='waiting'?'var(--amber)':'var(--dim)';
  const paceText=burn==null?T('확인 중'):S.tokensMode?shortNumber(burn)+' tokens/'+perHour().slice(1):rate1(burn);
  const gaugeText=burn==null?'—':S.tokensMode?shortNumber(burn)+perHour():rate1(burn),ink=burn==null?'var(--dim)':burn===0?'var(--muted)':'var(--ink)';
  const w=s.usage?.windows?.[S.period],tokens=s.tokens==null||!Array.isArray(w)?null:sum(w);
  const value=S.tokensMode?shortNumber(tokens):e&&finite(e.used_pp)&&e.used_pp>=0?'≈'+pct1(e.used_pp):tokens===0?'0%':'—';
  const help=[projectName(s),`${locationLabel(s)} · ${s.model||s.kind}`+(s.effort?.trim()?` · effort ${s.effort.trim()}`:''),groupStateLabel(s),s.title].filter(Boolean).join('\n');
  const valueHelp=S.tokensMode?T('선택 기간 동안 이 세션이 쓴 토큰'):T('≈ 선택 기간 동안 이 세션이 쓴 토큰을 계정의 주간 한도로 환산한 추정치')+(e?'':'\n'+pending);
  const off=!fresh()||S.busy;
  return `<div class="q-row" data-session-row="${esc(s.id)}"><div class="q-pace" title="${esc(groupStateLabel(s)+'\n'+T('지금 속도')+': '+paceText+(burn==null&&!S.tokensMode?'\n'+pending:''))}" aria-label="${esc(groupStateLabel(s)+', '+T('지금 속도')+' '+paceText)}">${gauge(burn,scale,color(s.kind),hub)}<span style="color:${ink}">${esc(gaugeText)}</span></div><div class="q-row-main" title="${esc(help)}"><div class="q-row-title"><b>${esc(sessionName(s))}</b>${s.children_count>0?`<span class="q-sub" title="${esc(T('하위 세션의 사용량을 포함합니다. 제어 버튼은 상위 세션에 적용됩니다.'))}">${esc(T('하위'))} ${s.children_count}</span>`:''}</div><div class="q-row-line"><span style="color:${color(s.kind)}">${esc(tool)}</span>${chip(e?.account_id||s.usage?.weekly_account)}<span>· ${esc(projectName(s))}</span></div></div><span class="q-value${value==='—'?' none':''}" title="${esc(valueHelp)}">${esc(value)}</span><button class="q-icon-button" data-act="control" data-action="focus" data-session="${esc(s.id)}" aria-label="${esc(sessionName(s)+' '+T('바로가기'))}" ${off||!allows(s,'focus')?'disabled':''}>${icon.open}</button><button class="q-more" data-act="menu" data-menu="session" data-session="${esc(s.id)}" aria-label="${esc(sessionName(s)+' '+T('세션 제어'))}" ${off?'disabled':''}>${icon.more}</button></div>`;
 }
 function renderSessions(){
  const rows=orderSessions(sessions(),S.period),ok=fresh();
  update('qSessionsHead',`<b>${esc(T('세션'))}</b><span class="q-count">${sessions().length}</span><span class="q-working${ok?'':' stale'}">${ok?wave(9):'<i class="q-dot warn"></i>'}<span>${esc(ok?T('작업 중')+' '+sessions().filter(working).length:T('마지막 기록'))}</span></span><span class="q-spacer"></span><span class="q-col-label">${esc(T(S.tokensMode?'토큰':'주간 한도 사용량'))}</span><span class="q-col-gap"></span>`);
  if(!rows.length){update('qSessions',`<div class="q-empty">${icon.terminal}<b>${esc(T(S.data?.ready?'감지된 AI 세션이 없습니다':'로컬 세션을 확인하고 있습니다'))}</b><small>${esc(T('실행 중인 AI 세션이 여기에 표시됩니다.'))}</small></div>`);return;}
  const scale=niceMaximum(Math.max(1,...rows.map(sessionPace).filter(v=>v!=null)));
  const list=$('qSessions'),top=list.scrollTop;
  if(update('qSessions',rows.map(s=>sessionRow(s,scale)).join('')))list.scrollTop=top;
 }
 function renderMessage(){
  const m=S.message;update('qMessage',m?`<div class="q-message${m.error?' error':''}"><p>${esc(m.text)}</p><button class="q-icon-button" data-act="dismiss" aria-label="${esc(T('알림 닫기'))}">${icon.close}</button></div>`:'');
 }
 function renderFoot(){
  update('qFoot',`<button type="button" data-act="dashboard" aria-label="${esc(T('전체 대시보드 열기'))}">${icon.dashboard}<span>${esc(T('전체 대시보드'))}</span><span>Ctrl+O</span></button><button type="button" data-act="browser" title="${esc(T('브라우저에서 열기'))}" aria-label="${esc(T('브라우저에서 열기'))}">${icon.browser}</button>`);
 }

 /* Floating layer: menus, the account sheet and confirmations. */
 function menuItems(kind,id){
  const s=sessions().find(x=>x.id===id),z=Math.round(S.zoom*100);
  if(kind==='head')return [['open_browser','브라우저에서 열기'],['refresh','지금 새로고침'],['units',S.tokensMode?'세션을 주간 한도 %로 보기':'세션을 토큰으로 보기'],['zoom',T('화면 크기')+` ${z}%`,{sub:true}],'-',['login',(S.login.enabled?'✓ ':'')+T('로그인할 때 실행')],['open_remote','원격 대시보드 (선택)'],['connect','원격 기기 연결…'],'-',['restart','로컬 수집기 다시 시작'],['quit','1top 종료']];
  if(kind==='zoom')return [['zoom_in','확대',{off:S.zoom>=1.6}],['zoom_out','축소',{off:S.zoom<=.8}],['zoom_reset','기본 크기',{off:S.zoom===1}]];
  if(kind==='accounts')return [['add:Claude','Claude Code 계정 로그인…'],['add:Codex','Codex 계정 로그인…']];
  if(kind==='session'&&s)return [['focus','터미널 바로가기',{off:!allows(s,'focus')}],['pause','작업 일시정지…',{off:!allows(s,'pause')}],['resume','새 요청으로 재개…',{off:!allows(s,'resume')}],'-',['terminate','CLI 종료…',{off:!allows(s,'terminate'),danger:true}]];
  return [];
 }
 function menuMarkup(kind,id,style){
  return `<div class="q-menu" role="menu" style="${style}" data-menu-kind="${kind}">${menuItems(kind,id).map(item=>item==='-'?'<hr>':`<button type="button" role="menuitem" data-act="item" data-item="${esc(item[0])}" data-session="${esc(id||'')}" class="${item[2]?.danger?'danger':''}" ${item[2]?.off?'disabled':''}>${item[2]&&'check' in item[2]?`<span class="check">${item[2].check?'✓':''}</span>`:''}<span>${esc(T(item[1]))}</span>${item[2]?.sub?'<span class="arrow">›</span>':''}</button>`).join('')}</div>`;
 }
 function quotaSheet(q){
  const tint=color(q.kind),busy=S.authorizing!=null;
  return `<div class="q-quota" style="--tint:${tint}"><div class="q-quota-top"><i></i><b>${esc(toolName(q.kind))}</b>${chip(q.id)}<em>${esc(q.plan||'')}</em><i class="q-dot${q.stale?' warn':''}"></i><small class="${q.stale?'stale':''}">${esc(statusLabel(q))}</small></div><div class="q-quota-label" title="${esc(q.account_label+' · '+String(q.id).slice(-6))}">${esc(q.account_label)}</div><div class="q-quota-windows">${(q.windows||[]).map(w=>`<div class="q-quota-window"><div><span>${esc(T(w.label))}</span><span class="num">${w.pct==null?esc(T('미확인')):percent0(w.pct)}</span></div><div class="q-bar">${w.pct==null?'':`<i style="width:${Math.min(100,Math.max(0,w.pct))}%;${w.pct>=90?'background:var(--amber)':''}"></i>`}</div><small>${esc(resetLabel(w.reset))}</small></div>`).join('')}</div>${q.stale&&q.status?`<p class="q-quota-note">${esc(T(q.note||''))}</p>`:''}${q.stale&&RECONNECT.has(q.status)?reconnect(q,busy):''}<form class="q-name" data-act="rename" data-account="${esc(q.id)}"><input name="alias" maxlength="24" value="${esc(S.layer.draft??q.alias??'')}" placeholder="${esc(T('계정 이름(24자, 비우면 번호)'))}" aria-label="${esc(T('계정 이름'))}"><button type="submit" ${S.busy||!fresh()?'disabled':''}>${esc(T('저장'))}</button></form></div>`;
 }
 // On a Mac, reconnecting asks macOS once for the saved sign-in; elsewhere the account's official sign-in opens again.
 const macHost=()=>(S.data?.system?.host?.os||'Darwin')==='Darwin';
 function reconnect(q,busy){
  const mac=macHost(),waiting=S.authorizing===q.id;
  return `<div class="q-reconnect"><button type="button" data-act="${mac?'authorize':'relogin'}" data-account="${esc(q.id)}" data-kind="${esc(q.kind)}" ${busy||!fresh()?'disabled':''}>${esc(T(mac?(waiting?'macOS 승인 기다리는 중…':'다시 연결'):(waiting?'로그인 창을 여는 중…':'다시 로그인')))}</button><small>${esc(T(mac?'macOS가 저장된 로그인 사용을 한 번 묻습니다. 다시 묻지 않습니다.':'이 계정의 공식 로그인 창을 엽니다. 같은 계정으로 다시 로그인하세요.'))}</small></div>`;
 }
 const CONFIRM={pause:['작업을 일시정지할까요?','현재 작업에 Esc를 보냅니다. 세션은 유지되며, 실제 중단 여부는 수집 후 확인됩니다.','일시정지'],resume:['새 요청으로 작업을 재개할까요?','이전 작업을 이어서 진행하라는 새 요청을 보냅니다. 토큰을 다시 사용할 수 있습니다. 터미널에 작성 중인 입력이 없는지 확인하세요.','새 요청으로 재개'],terminate:['이 CLI를 종료할까요?','작업 중이면 먼저 중단을 요청하고, 멈춘 상태가 확인되면 해당 CLI만 종료합니다. 터미널 탭과 저장된 기록은 유지됩니다.','CLI 종료']};
 function renderLayer(){
  const L=S.layer,host=$('qLayer');
  if(!L){host.innerHTML='';return;}
  if(L.type==='menu'){
   const panel=$('quick').getBoundingClientRect(),a=L.anchor,width=230,z=S.zoom||1;
   const left=Math.max(8,Math.min(panel.width/z-width-8,a.right/z-width)),below=a.bottom/z+4,items=menuItems(L.kind,L.id).length;
   const top=below+items*28>panel.height/z-8?Math.max(8,a.top/z-4-items*28-10):below;
   let html=`<div class="q-scrim" data-act="close"></div>`+menuMarkup(L.kind,L.id,`left:${left}px;top:${top}px;width:${width}px`);
   if(L.sub)html+=menuMarkup(L.sub,null,`left:${Math.max(8,left-160)}px;top:${top+3*28+6}px;width:150px`);
   host.innerHTML=html;host.querySelector('.q-menu button:not(:disabled)')?.focus();
  }else if(L.type==='account'){
   const q=quotas().find(x=>x.id===L.id);if(!q){S.layer=null;host.innerHTML='';return;}
   const input=host.querySelector('input[name=alias]');if(input&&document.activeElement===input)return;
   host.innerHTML=`<div class="q-scrim" data-act="close"></div><div class="q-sheet" style="top:${L.top}px" role="dialog" aria-label="${esc(toolName(q.kind)+' '+q.account_label)}">${quotaSheet(q)}</div>`;
  }else if(L.type==='confirm'){
   const s=sessions().find(x=>x.id===L.id),[title,detail,ok]=CONFIRM[L.action];
   const body=s?`${s.project||s.kind} · ${locationLabel(s)}\n\n`+T(s.kind==='Aside'?'Aside session stop으로 현재 작업 중단을 요청합니다. 세션은 유지됩니다. 실제 상태는 다음 수집 때 확인합니다.':detail):T(detail);
   host.innerHTML=`<div class="q-scrim dim" data-act="close"></div><div class="q-dialog" role="alertdialog" aria-modal="true" aria-labelledby="qDialogTitle"><h2 id="qDialogTitle">${esc(T(title))}</h2><p>${esc(body)}</p><div class="q-dialog-actions"><button type="button" data-act="close">${esc(T('취소'))}</button><button type="button" class="${L.action==='terminate'?'danger':'primary'}" data-act="confirm">${esc(T(ok))}</button></div></div>`;
   host.querySelector('[data-act=confirm]').focus();
  }else if(L.type==='connect'){
   host.innerHTML=`<div class="q-scrim dim" data-act="close"></div><form class="q-dialog" role="dialog" aria-modal="true" aria-labelledby="qDialogTitle" data-act="connect"><h2 id="qDialogTitle">${esc(T('원격 기기 연결'))}</h2><p>${esc(T('1top 관리형 서버 또는 본인의 Cloudflare 서버 주소를 입력하세요. 선택한 서버에 로그인 식별정보와 기기 요약을 전달합니다.'))}</p><input name="relay" value="${esc(L.value||'')}" spellcheck="false" autocomplete="off" aria-label="${esc(T('서버 주소'))}"><div class="q-dialog-actions"><button type="button" data-act="close">${esc(T('취소'))}</button><button type="submit" class="primary">${esc(T('연결'))}</button></div></form>`;
   host.querySelector('input').focus();
  }
 }

 /* Data and actions */
 let palette=null,timer=null;
 function render(){
  S.now=Date.now()/1000;
  try{const r=reading();renderHead();renderTokens(r);renderWeekly();renderResources();renderSessions();renderMessage();renderFoot();setDial(r);
   if(S.layer?.type==='account')renderLayer();api.error=null;}
  catch(error){api.error=String(error?.stack||error);}
 }
 async function refresh(){
  if(S.fetching)return;S.fetching=true;
  const controller=new AbortController(),stop=setTimeout(()=>controller.abort(),5000);
  try{const response=await fetch('/api/state',{cache:'no-store',signal:controller.signal});
   if(response.status===200){S.data=await response.json();S.connected=true;}else S.connected=false;}
  catch{S.connected=false;}
  finally{clearTimeout(stop);S.fetching=false;}
  render();api.ready=true;
  const n=sessions().length;call('status',`${connectionLabel()} · ${T('작업 중')} ${sessions().filter(working).length} / ${T('전체')} ${n}`);
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(async()=>{await refresh();schedule();},(S.shown||!fresh()?3:15)*1000);}
 async function post(path,body,timeout){
  const controller=new AbortController(),stop=setTimeout(()=>controller.abort(),timeout*1000);
  try{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Monitor-Token':S.data?.action_token||''},body:JSON.stringify(body),signal:controller.signal});
   let value=null;try{value=await response.json();}catch{}return {status:response.status,value};}
  catch{return {status:0,value:null};}finally{clearTimeout(stop);}
 }
 const say=(text,error)=>{S.message=text?{text:T(text),error:!!error}:null;render();};
 // Mutations are sent once. A timeout never replays a control.
 async function perform(action,s){
  S.now=Date.now()/1000;
  const current=sessions().find(x=>x.id===s.id&&x.control_key===s.control_key&&allows(x,action));
  if(!fresh()||S.busy||!current||!S.data?.action_token){say('세션 상태가 변경되었습니다. 새로고침 후 다시 확인하세요.',true);return;}
  S.busy=true;S.message=null;render();
  const id=root.crypto?.randomUUID?.()||String(Date.now())+Math.random().toString(16).slice(2);
  const {status,value}=await post('/api/action',{action,session_id:s.id,control_key:s.control_key||'',request_id:id},30);
  S.busy=false;say(value?.message||'응답을 확인하지 못했습니다. 다시 누르기 전에 터미널 상태를 확인하세요.',!(status===200&&value?.ok===true));refresh();
 }
 async function rename(id,name){
  if(!fresh()||S.busy||!S.data?.action_token)return;S.busy=true;render();
  const {status,value}=await post('/api/accounts/alias',{account_id:id,alias:String(name).trim().slice(0,24)},10);
  S.busy=false;const ok=status===200&&value?.ok!==false;if(ok&&S.layer)S.layer.draft=undefined;
  say(ok?'계정 이름을 저장했습니다.':value?.message||'계정 이름을 저장하지 못했습니다.',!ok);refresh();
 }
 async function authorize(id){
  if(!fresh()||S.busy||S.authorizing||!S.data?.action_token)return;S.authorizing=id;renderLayer();
  const {status,value}=await post('/api/accounts/authorize',{account_id:id},125);
  S.authorizing=null;say(value?.message||'연결 결과를 확인하지 못했습니다. 계정 상태가 바뀌었는지 먼저 확인해 주세요.',status!==200);refresh();
 }
 async function relogin(id,kind){
  if(!fresh()||S.busy||S.authorizing||!S.data?.action_token)return;S.authorizing=id;renderLayer();
  const {status,value}=await post('/api/accounts/login',{kind},20);
  S.authorizing=null;say(value?.message||(status===200?'로그인 창을 열었습니다.':'로그인 창을 열지 못했습니다.'),status!==200);
 }
 async function addAccount(kind){
  if(!fresh()||S.busy||!S.data?.action_token)return;S.busy=true;render();
  const {status,value}=await post('/api/accounts/login',{kind},20);
  S.busy=false;say(value?.message||'로그인 창을 확인하지 못했습니다. 다시 시도하기 전에 터미널을 확인해 주세요.',status!==200);
 }
 function setZoom(value){
  S.zoom=Math.min(1.6,Math.max(.8,Math.round(value*10)/10));persist();
  document.documentElement.style.zoom=S.zoom===1?'':String(S.zoom);call('zoom',S.zoom);S.html={};render();
 }
 function control(action,id){
  const s=sessions().find(x=>x.id===id);if(!s)return;
  if(action==='focus'){perform('focus',s);return;}
  if(!fresh()||S.busy||!allows(s,action))return;
  S.layer={type:'confirm',action,id};renderLayer();
 }
 async function askConnect(){S.layer={type:'connect',value:await call('relay_default')||''};renderLayer();}
 async function item(name,id){
  S.layer=null;renderLayer();
  if(name==='open_browser'||name==='open_remote')call(name);
  else if(name==='refresh')refresh();
  else if(name==='units'){S.tokensMode=!S.tokensMode;persist();render();}
  else if(name==='zoom'){/* handled as a submenu */}
  else if(name==='zoom_in')setZoom(S.zoom+.1);else if(name==='zoom_out')setZoom(S.zoom-.1);else if(name==='zoom_reset')setZoom(1);
  else if(name==='login'){const r=await call('toggle_login');if(r){S.login={enabled:!!r.enabled,managed:!!r.managed};if(r.message)say(r.message,!r.ok);}}
  else if(name==='connect')askConnect();
  else if(name==='restart'){const r=await call('restart');if(r?.message)say(r.message,!r.ok);refresh();}
  else if(name==='quit')call('quit');
  else if(name.startsWith('add:'))addAccount(name.slice(4));
  else control(name,id);
 }

 /* Radar: one turn is the selected period, twelve o'clock is now; bars are stacked by tool and the
    dashed ring is the average in the centre. Drawn in the panel's 190-point space. */
 const dial={reading:{average:null,bins:[]},from:null,to:null,changed:0,opened:0,digits:''};
 function setDial(r){
  const t=performance.now()/1000;
  if(dial.to===null&&dial.from===null){dial.from=r.average;dial.to=r.average;dial.opened=t;}
  else if(r.average!==dial.to){dial.from=shownValue(t);dial.to=r.average;dial.changed=t;}
  dial.reading=r;dial.dirty=true;
 }
 function shownValue(t){
  if(dial.to==null)return dial.reading.average;if(dial.from==null||reduced())return dial.to;
  const p=Math.min(1,Math.max(0,(t-dial.changed)/.7));return dial.from+(dial.to-dial.from)*(1-(1-p)**3);
 }
 function colors(){
  if(palette)return palette;const css=getComputedStyle(document.documentElement),v=n=>css.getPropertyValue(n).trim();
  return palette={grid:v('--q-grid'),red:v('--q-red'),on:v('--lcd'),lead:v('--lcd-lead'),card:v('--panel')};
 }
 function rgba(hex,a){const m=/^#?([0-9a-f]{6})$/i.exec(hex);if(!m)return hex;const n=parseInt(m[1],16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;}
 function drawDial(){
  const canvas=$('qDial');if(!canvas)return;const rect=canvas.getBoundingClientRect();if(!rect.width)return;
  const dpr=root.devicePixelRatio||1,W=Math.round(rect.width*dpr),H=Math.round(rect.height*dpr);
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  const ctx=canvas.getContext('2d'),k=W/190;ctx.setTransform(k,0,0,k,0,0);ctx.clearRect(0,0,190,190);
  const c=colors(),r=dial.reading,now=performance.now()/1000,still=reduced(),clock=Date.now()/1000;
  const cx=95,cy=95,outer=95-7,inner=outer*.6,scale=Math.max(r.average??0,...r.bins.map(b=>b.total),0)*1.06;
  const grow=still?1:1-(1-Math.min(1,Math.max(0,(now-dial.opened)/.8)))**3;
  const radius=v=>inner+(outer-inner)*(scale>0?Math.min(1,Math.max(0,v/scale))*grow:0);
  const rad=d=>d*Math.PI/180;
  const sector=(r0,r1,a0,a1)=>{ctx.beginPath();ctx.arc(cx,cy,r1,rad(a0),rad(a1),false);ctx.arc(cx,cy,r0,rad(a1),rad(a0),true);ctx.closePath();};
  ctx.lineWidth=.7;ctx.strokeStyle=rgba(c.grid,.7);
  for(let i=0;i<12;i++){const a=rad(-90+30*i);ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*inner,cy+Math.sin(a)*inner);ctx.lineTo(cx+Math.cos(a)*outer,cy+Math.sin(a)*outer);ctx.stroke();}
  const end=270-12,ring=rr=>{ctx.beginPath();ctx.arc(cx,cy,rr,rad(-90),rad(end),false);};
  ctx.strokeStyle=c.grid;ctx.lineWidth=.8;for(const f of [.25,.5,.75,1]){ctx.setLineDash(f===1?[]:[1.5,3]);ring(inner+(outer-inner)*f);ctx.stroke();}ctx.setLineDash([]);
  ctx.strokeStyle=rgba(c.red,.6);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,cy-inner);ctx.lineTo(cx,cy-outer);ctx.stroke();
  const sweeping=!still&&(r.average??0)>0,head=(clock*80)%360-90;
  if(sweeping)for(let j=0;j<12;j++){sector(inner,outer,head-(j+1)*4,head-j*4);ctx.fillStyle=rgba(c.on,.26*(1-j/12)**1.6);ctx.fill();}
  const bins=r.bins,step=bins.length?(360-12)/bins.length:0;
  bins.forEach((bin,i)=>{
   if(!(bin.total>0))return;let r0=inner+1,value=0;
   const a0=-90+(bins.length-1-i)*step+.5,a1=-90+(bins.length-i)*step-.5,behind=(((head-(a0+a1)/2)%360)+360)%360;
   const newest=i===bins.length-1,rest=bins.length>1?.32+.58*i/(bins.length-1):1,lit=sweeping&&!newest?Math.exp(-behind/75):0;
   for(const [kind,part] of bin.byKind){if(!(part>0))continue;value+=part;const r1=radius(value);if(r1<=r0+.3)continue;
    sector(r0,r1,a0,a1);ctx.fillStyle=rgba(color(kind),newest?1:rest+(1-rest)*.75*lit);ctx.fill();
    if(lit>.05){ctx.fillStyle=rgba(c.lead,.22*lit);ctx.fill();}r0=r1;}
   if(newest&&r0>inner+1){sector(inner+1,r0,a0,a1);ctx.strokeStyle=rgba(c.lead,.95);ctx.lineWidth=1;ctx.stroke();}
  });
  if(sweeping){const e=rad(head);ctx.strokeStyle=rgba(c.lead,.9);ctx.lineWidth=1.4;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(cx+Math.cos(e)*inner,cy+Math.sin(e)*inner);ctx.lineTo(cx+Math.cos(e)*(outer+2),cy+Math.sin(e)*(outer+2));ctx.stroke();ctx.lineCap='butt';}
  if((r.average??0)>0){ctx.strokeStyle=c.lead;ctx.lineWidth=1.1;ctx.setLineDash([3,2.5]);ring(radius(r.average));ctx.stroke();ctx.setLineDash([]);}
  const disc=inner-3;ctx.beginPath();ctx.arc(cx,cy,disc,0,Math.PI*2);ctx.fillStyle=c.card;ctx.fill();ctx.strokeStyle=c.grid;ctx.lineWidth=.8;ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-3.5,cy-outer-6.5);ctx.lineTo(cx+3.5,cy-outer-6.5);ctx.lineTo(cx,cy-outer-1);ctx.closePath();
  ctx.fillStyle=rgba(c.red,sweeping?.65+.35*Math.sin(clock*3.2):1);ctx.fill();
  drawDigits(shownValue(now));
 }
 function drawDigits(value){
  const g=root.OneTopSpeed.digits(value),key=g.c.join('')+g.u+(value==null)+S.lang;if(key===dial.digits)return;dial.digits=key;
  const h=29,w=h*.55,gap=h*.15,us=h*.46,width=2*(w+gap)+w+(g.u?gap+us*.8:0)+h*Math.tan(9*Math.PI/180),W=Math.ceil(width+2);
  $('qDialCenter').innerHTML=`<small class="q-dim">${esc(T('평균'))}</small><svg width="${W}" height="${h+2}" viewBox="0 -1 ${W} ${h+2}" aria-hidden="true"><defs>${root.OneTopSpeed.glowFilter}</defs>${root.OneTopSpeed.seg7(g,W/2,h,w,h,h*.115,gap,value==null)}</svg><small class="q-muted">${esc(T(dial.reading.average==null?'확인 중':'tokens/시간'))}</small>`;
  const avg=dial.reading.average;$('qDialCenter').parentElement.setAttribute('aria-label',avg==null?T('토큰 사용 속도 확인 중'):`${periodLabel()} ${T('평균')} ${shortNumber(avg)} tokens/${perHour().slice(1)}`);
 }
 // About 30 frames a second while the panel is open; while hidden, only when the data changes.
 let last=0;
 function frame(t){
  const open=S.shown||!native();
  if(open?t-last>=33||!last:dial.dirty){last=t;dial.dirty=false;drawDial();}
  requestAnimationFrame(frame);
 }

 /* Events */
 function onClick(e){
  const el=e.target.closest('[data-act]');if(!el||el.disabled)return;
  const act=el.dataset.act;
  if(act==='period'){S.period=el.dataset.period;dial.opened=performance.now()/1000;render();}
  else if(act==='theme')switchTheme(el);
  else if(act==='language')switchLanguage(el);
  else if(act==='menu'){const rect=el.getBoundingClientRect();S.layer={type:'menu',kind:el.dataset.menu,id:el.dataset.session||null,anchor:{top:rect.top,bottom:rect.bottom,right:rect.right}};renderLayer();}
  else if(act==='item'){if(el.dataset.item==='zoom'){S.layer.sub=S.layer.sub?null:'zoom';renderLayer();return;}item(el.dataset.item,el.dataset.session);}
  else if(act==='close'){S.layer=null;renderLayer();}
  else if(act==='account'){const rect=el.getBoundingClientRect(),panel=$('quick').getBoundingClientRect(),z=S.zoom||1;S.layer={type:'account',id:el.dataset.account,top:Math.max(8,Math.min(panel.height/z-260,(rect.bottom-panel.top)/z+6))};renderLayer();}
  else if(act==='authorize')authorize(el.dataset.account);
  else if(act==='relogin')relogin(el.dataset.account,el.dataset.kind);
  else if(act==='control')control(el.dataset.action,el.dataset.session);
  else if(act==='confirm'){const L=S.layer;S.layer=null;renderLayer();const s=sessions().find(x=>x.id===L.id);if(s)perform(L.action,s);}
  else if(act==='dismiss'){S.message=null;render();}
  else if(act==='dashboard')call('open_dashboard');
  else if(act==='browser')call('open_browser');
 }
 function onSubmit(e){
  const form=e.target.closest('form[data-act]');if(!form)return;e.preventDefault();
  if(form.dataset.act==='rename')rename(form.dataset.account,form.elements.alias.value);
  else if(form.dataset.act==='connect'){
   const value=form.elements.relay.value.trim();let ok=false;
   try{const u=new URL(value);ok=u.protocol==='https:'&&u.hostname.includes('.')&&!u.username&&!u.password&&!u.search&&!u.hash&&['','/'].includes(u.pathname)&&!u.port;}catch{}
   S.layer=null;renderLayer();
   if(!ok){say('HTTPS 서버 주소만 입력하세요.',true);return;}
   call('connect',value).then(r=>{if(r?.message)say(r.message,!r.ok);refresh();});
  }
 }
 function init(){
  applyPreferences();setZoom(S.zoom);
  const panel=$('quick');panel.addEventListener('click',onClick);panel.addEventListener('submit',onSubmit);
  panel.addEventListener('input',e=>{if(e.target.name==='alias'&&S.layer)S.layer.draft=e.target.value;});
  document.addEventListener('keydown',e=>{
   if(e.key==='Escape'){if(S.layer){if(S.layer.sub){S.layer.sub=null;}else S.layer=null;renderLayer();}else call('hide');e.preventDefault();}
   else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){call('open_dashboard');e.preventDefault();}
   else if((e.ctrlKey||e.metaKey)&&(e.key==='='||e.key==='+')){setZoom(S.zoom+.1);e.preventDefault();}
   else if((e.ctrlKey||e.metaKey)&&e.key==='-'){setZoom(S.zoom-.1);e.preventDefault();}
   else if((e.ctrlKey||e.metaKey)&&e.key==='0'){setZoom(1);e.preventDefault();}
  });
  // Transient like the macOS popover: clicking anywhere else closes it.
  root.addEventListener('blur',()=>{if(S.shown){S.shown=false;call('hide');}});
  root.addEventListener('storage',e=>{if(e.key==='onetop.dashboard.v1'){applyPreferences();render();}});
  root.addEventListener('pywebviewready',async()=>{const r=await call('login');if(r)S.login={enabled:!!r.enabled,managed:!!r.managed};applyPreferences();});
  setInterval(()=>{S.now=Date.now()/1000;renderHead();},1000);
  render();refresh().then(schedule);requestAnimationFrame(frame);
 }
 // Called by the shell each time the panel opens.
 api.opened=()=>{S.shown=true;dial.opened=performance.now()/1000;applyPreferences();render();refresh();schedule();call('login').then(r=>{if(r)S.login={enabled:!!r.enabled,managed:!!r.managed};});};
 api.refresh=refresh;api.askConnect=askConnect;api.ready=false;api.error=null;api.state=S;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(typeof window==='undefined'?globalThis:window);
