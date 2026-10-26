// Hero explainer: agent sessions scattered across apps and computers gather into one
// 1top view, then time windows, token maps, account limits and the menu bar.
// Every frame is a pure function of time, so live playback and the video render match.
const T=24,CH=[0,9.6,13,16,19.2,T],CAP=[0,3,5.6,9.6,13,16,19.2,T],REP=[7.1,12.7,15.2,18.6,21.5];
const clamp=v=>v<0?0:v>1?1:v,seg=(t,a,b)=>clamp((t-a)/(b-a)),lerp=(a,b,p)=>a+(b-a)*p,lerpA=(a,b,p)=>a.map((v,i)=>lerp(v,b[i],p));
const out3=p=>1-(1-p)**3,io3=p=>p<.5?4*p*p*p:1-(-2*p+2)**3/2,expo=p=>p>=1?1:1-2**(-10*p);
const fade=(t,a,b,i=.35,o=.35)=>Math.min(out3(seg(t,a,a+i)),1-io3(seg(t,b-o,b)));
const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)),rgba=c=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${c[3].toFixed(3)})`;
const fmt=k=>k>=999.95?(k/1000).toFixed(2)+'M':k.toFixed(1)+'k';

// Cursor keeps its English menus in both languages, as the app does by default.
const CURSOR_MENUS=['File','Edit','Selection','View','Go','Run','Terminal','Window','Help'];
const COPY={
 en:{label:'Animated overview of 1top. Agent sessions from several apps and computers gather into one dashboard that shows where each session runs, its token usage over time windows, a token map, account limits and a menu-bar panel.',
  cap:['Your AI agents run across apps, terminals and computers.','1top gathers every session into one view.','See what’s running, where it runs, and what it uses.','Switch the time window — every number follows.','Token maps show where your usage goes.','Every subscription’s limits, side by side.','Jump back to any session from the menu bar.'],
  ch:['Sessions','Usage','Token maps','Limits','Menu bar'],show:'Show',
  zones:['MacBook Pro · This Mac','Mac Studio · Remote'],win:'1top — This Mac',live:'Live',
  head:['Sessions','Usage','Token map','Account limits'],meta:['6 sessions · 2 computers','Last hour · by session','4 accounts'],
  th:['Session','AI tool · model','App · computer','Status','Tokens · 1h','CPU'],status:['Idle','Working','Paused'],hl:['Where it runs','What it uses'],
  win6:['24h','12h','5h','1h','30m','10m'],span:['last 24 hours','last 12 hours','last 5 hours','last hour','last 30 minutes','last 10 minutes'],
  ago:['24h ago','12h ago','5h ago','1h ago','30m ago','10m ago'],now:'now',unit:s=>`tokens · ${s}`,rate:'tok/s · 60-second average',
  five:'5-hour',week:'Weekly',reset:s=>`resets in ${s}`,who:['Personal','Work'],
  stats:['tokens · 1h','tok/s','working'],sessions:'Sessions',full:'Open full dashboard',toast:'Cursor brought forward on MacBook Pro',apps:['Finder','Cursor'],menus:[['File','Edit','View','Go','Window','Help'],CURSOR_MENUS],clock:['Mon Oct 26','9:41 AM'],
  desc:['Frontend','Backend','Docs refresh','Notes','iOS client','Data jobs'],
  resets:[['2h 08m','2d 4h'],['2h 15m','3d 0h'],['2h 30m','4d 0h'],['2h 45m','5d 0h']]},
 ko:{label:'1top 동작 개요 애니메이션입니다. 여러 앱과 컴퓨터에 흩어진 에이전트 세션이 하나의 대시보드로 모이고, 실행 위치와 기간별 토큰 사용량, 토큰 맵, 계정 한도, 메뉴 막대 패널을 차례로 보여줍니다.',
  cap:['AI 에이전트는 여러 앱·터미널·컴퓨터에서 동시에 돌아갑니다.','1top이 모든 세션을 한 화면으로 모읍니다.','무엇이, 어디서, 얼마나 쓰는지 바로 보입니다.','기간을 바꾸면 모든 수치가 함께 바뀝니다.','토큰 맵으로 사용량이 어디에 쓰였는지 봅니다.','구독마다 5시간·주간 한도를 나란히 봅니다.','메뉴 막대에서 원하는 세션으로 바로 돌아갑니다.'],
  ch:['세션','사용량','토큰 맵','한도','메뉴 막대'],show:'보기',
  zones:['MacBook Pro · 이 Mac','Mac Studio · 원격'],win:'1top — 이 Mac',live:'실시간',
  head:['세션','사용량','토큰 맵','계정 한도'],meta:['세션 6개 · 컴퓨터 2대','최근 1시간 · 세션별','계정 4개'],
  th:['세션','AI 도구 · 모델','앱 · 컴퓨터','상태','토큰 · 1시간','CPU'],status:['대기 중','작업 중','일시정지'],hl:['어디서 실행 중인지','얼마나 쓰는지'],
  win6:['24시간','12시간','5시간','1시간','30분','10분'],span:['최근 24시간','최근 12시간','최근 5시간','최근 1시간','최근 30분','최근 10분'],
  ago:['24시간 전','12시간 전','5시간 전','1시간 전','30분 전','10분 전'],now:'현재',unit:s=>`토큰 · ${s}`,rate:'tok/s · 최근 60초 평균',
  five:'5시간',week:'주간',reset:s=>`${s} 후 초기화`,who:['개인','회사'],
  stats:['토큰 · 1시간','tok/s','작업 중'],sessions:'세션',full:'전체 대시보드',toast:'MacBook Pro에서 Cursor를 앞으로 가져왔습니다',apps:['Finder','Cursor'],menus:[['파일','편집','보기','이동','윈도우','도움말'],CURSOR_MENUS],clock:['10월 26일 (월)','오전 9:41'],
  desc:['프론트엔드','백엔드','문서 정리','리서치 노트','iOS 앱','데이터 작업'],
  resets:[['2시간 8분','2일 4시간'],['2시간 15분','3일 0시간'],['2시간 30분','4일 0시간'],['2시간 45분','5일 0시간']]}
};

const TOOL={claude:['Claude Code','#ec9a6d'],codex:['Codex','#82edc6'],aside:['Aside','#b69cff']};
const PCS=['MacBook Pro','Mac Studio'];
const SESS=[
 {id:'website',tool:'claude',model:'sonnet-4.6',app:'Cursor',pc:0,st:1,tok:51.6,cpu:'10.8%'},
 {id:'api-service',tool:'codex',model:'gpt-5.4',app:'Terminal',pc:0,st:1,tok:59.4,cpu:'14.8%'},
 {id:'docs',tool:'claude',model:'glm-5',app:'iTerm',pc:1,st:1,tok:38.2,cpu:'6.1%'},
 {id:'research',tool:'aside',model:'gpt-5.4',app:'Aside',pc:0,st:0,tok:67.2,cpu:'—'},
 {id:'mobile',tool:'claude',model:'sonnet-4.6',app:'Orca',pc:1,st:1,tok:22.9,cpu:'9.4%'},
 {id:'pipeline',tool:'codex',model:'gpt-5.4',app:'VS Code',pc:1,st:2,tok:14,cpu:'3.2%'}];
const SUM=SESS.reduce((a,s)=>a+s.tok,0),TOTAL=[3040,1770,759.6,SUM,151.9,63.3],SPAN=[24,12,5,1,.5,1/6];
const ACCT=[{tool:'claude',plan:'Max',who:0,v:[27,61]},{tool:'codex',plan:'Pro',who:0,v:[41,72]},{tool:'claude',plan:'Team',who:1,v:[15,35]},{tool:'codex',plan:'Business',who:1,v:[11,48]}];
const PICK=[[10.45,0],[11.25,2],[12.05,3]];
// Brand mark: the waveform.path symbol traced from site/public/brand/v1.1.0/mark.png.
const MARK='M401.0 0.0 L394.5 1.5 L387.0 6.0 L381.8 12.5 L378.8 22.0 L340.5 465.5 L339.5 464.5 L338.8 461.2 L306.5 174.2 L304.5 168.0 L300.0 161.2 L293.2 156.2 L286.5 154.0 L276.2 154.0 L267.8 157.2 L263.8 160.2 L260.2 164.2 L256.0 173.5 L216.8 436.2 L215.5 440.2 L214.8 439.2 L182.5 284.2 L179.0 277.2 L174.0 272.0 L168.8 269.0 L160.8 267.0 L150.8 268.0 L144.0 271.0 L138.0 276.2 L134.0 282.8 L109.0 381.2 L107.2 384.8 L25.0 384.8 L19.0 386.0 L10.5 390.8 L4.2 397.8 L0.8 406.0 L0.0 416.0 L2.0 423.5 L6.2 430.5 L10.5 434.8 L14.8 437.5 L24.0 440.5 L126.0 440.8 L132.2 439.8 L137.2 438.0 L141.8 435.5 L147.0 430.8 L150.5 425.0 L154.8 411.2 L155.8 410.8 L195.0 596.8 L199.0 604.2 L201.8 607.2 L206.2 610.2 L214.0 613.2 L225.0 613.5 L231.5 611.5 L237.8 607.8 L242.5 601.8 L244.5 596.5 L275.8 387.8 L277.2 382.0 L278.0 383.8 L318.0 739.0 L321.0 747.0 L324.5 751.8 L328.8 755.2 L333.0 757.5 L339.0 759.2 L347.8 759.2 L356.2 756.2 L363.0 750.8 L367.2 743.2 L368.8 736.0 L403.2 338.8 L404.5 333.2 L405.2 334.5 L440.5 737.8 L443.8 747.5 L449.0 753.8 L457.0 758.2 L463.0 759.5 L467.8 759.5 L475.8 757.5 L482.0 753.8 L488.0 746.5 L491.0 737.8 L531.0 382.8 L531.5 382.2 L533.0 387.5 L564.2 595.5 L567.5 603.5 L571.8 608.2 L579.5 612.5 L585.2 613.8 L595.2 613.2 L602.2 610.5 L606.2 608.0 L609.5 604.8 L613.8 597.0 L653.2 408.8 L655.0 410.2 L659.0 422.8 L662.2 428.0 L666.5 432.8 L670.5 435.8 L676.5 438.8 L686.0 440.8 L780.5 440.8 L786.2 439.8 L795.0 435.5 L801.8 428.8 L805.8 420.5 L806.8 410.8 L804.8 402.2 L799.8 394.2 L793.2 388.8 L785.0 385.2 L701.5 384.5 L699.0 377.0 L676.5 288.0 L673.8 280.2 L669.5 274.2 L663.0 269.2 L654.8 266.5 L647.8 266.2 L640.8 268.0 L635.5 271.0 L630.5 276.0 L627.0 282.8 L594.0 439.5 L593.2 440.2 L592.0 436.2 L552.8 173.2 L548.8 164.5 L542.5 158.2 L533.2 154.2 L523.0 154.0 L514.5 157.0 L508.0 162.5 L504.2 168.8 L502.2 176.2 L470.0 461.2 L469.2 464.5 L468.2 465.5 L430.2 21.5 L429.0 16.5 L426.8 11.8 L424.0 8.0 L420.0 4.5 L411.0 0.5Z';
const FIELDS=['dot','name','desc','tool','model','app','pc','status','tok','cpu','wave','pct','open','card'],RIGHT=new Set(['tok','cpu','wave','open']);

const WIDE={W:1280,H:800,n:0,zones:[[40,40,540,600],[700,40,540,600]],chip:[290,88],at:[[80,118],[230,268],[750,150],[90,420],[910,300],[760,452]],
 mark:[640,340],win:[40,36,1200,640],head:[72,98],meta:1208,row:[56,186,1168,64,70],
 th:[[80,158],[366,158],[616,158],[856,158],[1076,158,1],[1196,158,1]],thD:[816,158],hl:[[604,146,232,468],[946,146,272,468]],
 compact:k=>[800,186+k*62,400,54],seg:[72,156,84,44],big:[72,224],unit:[72,330],rate:[752,332],chart:[72,380,680,200],
 tree:[68,160,1144,492],card:k=>[68+(k%2)*586,160+(k>>1)*258,558,234],icon:960,mbh:32,sys:[34,66,95,124],menuN:9,date:1,panel:[770,42,380,564],host:[60,112,520,436],cur:[640,560],toast:[320,48]};
const NARROW={W:640,H:700,n:1,zones:[[20,24,600,280],[20,396,600,280]],chip:[270,86],at:[[40,72],[330,108],[40,446],[60,206],[330,486],[60,578]],
 mark:[320,350],win:[16,20,608,612],head:[44,80],meta:596,row:[28,160,584,70,74],
 th:[[46,134],[296,134],null,null,[594,134,1],null],thD:null,hl:[[30,124,232,488],[462,124,150,488]],
 compact:k=>[28+(k%2)*300,446+(k>>1)*60,284,52],seg:[44,124,88,42],big:[44,180],unit:[44,264],rate:[596,266],chart:[44,304,552,118],
 tree:[28,124,584,496],card:k=>[28,124+k*124,584,114],icon:430,mbh:40,sys:[38,72,0,102],menuN:2,date:0,panel:[240,50,380,574],host:[-150,116,360,430],cur:[330,560],toast:[320,636]};

function rate(h,dx){
 const a=f=>clamp(1.5-f*dx*4/6.283),g=(c,w,k)=>k*Math.exp(-(((h-c)/w)**2));
 return .42+.13*Math.sin(h*.34+1)+.09*Math.sin(h*1.7)+.07*a(5.3)*Math.sin(h*5.3+2)+.05*a(23)*Math.sin(h*23+.4)+.04*a(61)*Math.sin(h*61+1.3)+.03*a(173)*Math.sin(h*173+2.1)+.025*a(611)*Math.sin(h*611)+g(20.5,.7,.5)+g(23.4,.3,.38)+g(9,1.3,.3)+g(23.9,.06,.25);
}
const YMAX=SPAN.map(d=>{let m=0;for(let j=0;j<=400;j++)m=Math.max(m,rate(24-d+(d+.4)*j/400,d/140));return m*1.18});

function squarify(vals,[x,y,w,h]){
 const total=vals.reduce((a,v)=>a+v.v,0),k=w*h/total,out=[];
 let items=vals.map(v=>({...v,a:v.v*k}));
 const worst=(row,side)=>{const s=row.reduce((a,v)=>a+v.a,0),mx=Math.max(...row.map(v=>v.a)),mn=Math.min(...row.map(v=>v.a));return Math.max(side*side*mx/(s*s),s*s/(side*side*mn))};
 while(items.length){
  const side=Math.min(w,h);let row=[items[0]],best=worst(row,side),n=1;
  while(n<items.length){const next=row.concat(items[n]),v=worst(next,side);if(v>best)break;row=next;best=v;n++}
  const s=row.reduce((a,v)=>a+v.a,0);
  if(w>=h){const cw=s/h;let cy=y;for(const v of row){const ch=v.a/cw;out[v.i]=[x,cy,cw,ch];cy+=ch}x+=cw;w-=cw}
  else{const ch=s/w;let cx=x;for(const v of row){const cw=v.a/ch;out[v.i]=[cx,y,cw,ch];cx+=cw}y+=ch;h-=ch}
  items=items.slice(row.length);
 }
 return out.map(([x,y,w,h])=>[x+4,y+4,w-8,h-8]);
}

const pickAt=t=>{let a=3,b=3,s=-1;for(const [ts,k] of PICK)if(t>=ts){a=b;b=k;s=ts}return {a,b,p:s<0?1:io3(seg(t,s,s+.55))}};
const tokAt=(i,t)=>{const s=SESS[i];if(t<9.6)return s.st?s.tok*(.9+.1*io3(seg(t,0,9.6))):s.tok;const w=pickAt(t);return s.tok*lerp(TOTAL[w.a],TOTAL[w.b],w.p)/SUM+(t>19.2&&s.st===1?(t-19.2)*.06:0)};

export function mountHeroMotion(root,{lang='en',capture=false}={}){
 const S=COPY[lang]||COPY.en,ver=Math.random().toString(36).slice(2,7);
 const card=i=>{const a=ACCT[i],[tn,c]=TOOL[a.tool];return `<div class="hm-f f-card" style="--c:${c}"><div class="cd-h"><i></i>${tn}<em>${a.plan}</em><span>${S.who[a.who]}</span></div><div class="cd-bs">${[S.five,S.week].map((l,k)=>`<div class="cd-b"><label>${l}</label><strong>0%</strong><div class="tr"><s style="background:${a.v[k]>=70?'#e7bd77':k?'#8caeff':'#82edc6'}"></s></div><small>${S.reset(S.resets[i][k])}</small></div>`).join('')}</div></div>`};
 const item=(s,i)=>{const [tn,c]=TOOL[s.tool];return `<div class="hm-item" style="--c:${c}"><i class="hm-f f-dot"></i><b class="hm-f f-name">${s.id}</b><span class="hm-f f-desc">${S.desc[i]}</span><span class="hm-f f-tool">${tn}</span><span class="hm-f f-model">${s.model}</span><span class="hm-f f-app">${s.app}</span><span class="hm-f f-pc">${PCS[s.pc]}</span><span class="hm-f f-status s${s.st}">${S.status[s.st]}</span><span class="hm-f r f-tok"></span><span class="hm-f r f-cpu">${s.cpu}</span><span class="hm-f r f-wave">${'<i></i>'.repeat(5)}</span><span class="hm-f f-pct">${(s.tok/SUM*100).toFixed(1)}%</span><span class="hm-f r f-open">↗</span>${i<4?card(i):''}</div>`};
 const mark=(w,h,inner='')=>`<svg width="${w}" height="${h}" viewBox="0 0 806.8 759.5" aria-hidden="true">${inner}<path d="${MARK}"/></svg>`;
 root.classList.add('hm');root.classList.toggle('hm--capture',capture);root.setAttribute('role','group');root.setAttribute('aria-label',S.label);
 root.innerHTML=`<div class="hm-stage"><div class="hm-canvas" aria-hidden="true"><div class="hm-grid"></div><div class="hm-a hm-glow g1"></div><div class="hm-a hm-glow g2"></div><div class="hm-world"><div class="hm-a hm-desk"></div>
  ${S.zones.map(z=>`<div class="hm-a hm-zone"><span><i></i>${z}</span></div>`).join('')}
  <svg class="hm-wires"><defs><filter id="hmg${ver}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>${SESS.map(()=>`<path pathLength="1" stroke-dasharray="1 1"/>`).join('')}${SESS.map(()=>'<circle r="4"/><circle r="4"/><circle r="4"/>').join('')}</svg>
  <div class="hm-a hm-halo"></div>
  <div class="hm-a hm-win"><div class="tb"><i></i><i></i><i></i><b>${S.win}</b><em>${S.live}</em></div></div>
  ${S.head.map(h=>`<div class="hm-a hm-head">${h}</div>`).join('')}${S.meta.map(m=>`<div class="hm-a hm-meta">${m}</div>`).join('')}
  ${S.th.map((h,k)=>`<div class="hm-a hm-th${k>3?' r':''}">${h}</div>`).join('')}
  <div class="hm-a hm-seg"><i class="pill"></i>${S.win6.map(w=>`<span>${w}</span>`).join('')}</div><div class="hm-a hm-big"></div><div class="hm-a hm-unit"></div><div class="hm-a hm-rate"><b>560</b> ${S.rate}</div>
  <svg class="hm-a hm-chart"><defs><linearGradient id="hma${ver}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#82edc6" stop-opacity=".32"/><stop offset="1" stop-color="#82edc6" stop-opacity="0"/></linearGradient><clipPath id="hmc${ver}"><rect x="-10" y="-20" height="400" width="0"/></clipPath></defs><line class="gl"/><line class="gl"/><line class="gl"/><g clip-path="url(#hmc${ver})"><path class="ar" fill="url(#hma${ver})"/><path class="ln"/><circle class="nd" r="6" fill="#82edc6"/><circle class="nr" r="6" fill="none" stroke="#82edc6" stroke-width="2"/></g><text class="t0"></text><text class="t1" text-anchor="end">${S.now}</text></svg>
  <div class="hm-a hm-host"><div class="tb"><i></i><i></i><i></i><b>website — Cursor</b></div><div class="bd"><div class="tree">${[70,52,84,60,46,72].map(w=>`<i style="width:${w}%"></i>`).join('')}</div><div class="code">${[[38,'#8caeff'],[62,0],[54,0],[30,'#ec9a6d'],[72,0],[48,'#82edc6'],[66,0],[40,0],[58,'#b69cff'],[34,0]].map(([w,c])=>`<i style="width:${w}%;${c?`background:${c}55`:''}"></i>`).join('')}</div></div><div class="term"><b>Claude Code</b> › Build the landing page<br><em>●</em> Working · 51.6k tokens</div></div>
  <div class="hm-a hm-panel"><svg class="ar" viewBox="0 0 24 11" aria-hidden="true"><path d="M0 11C5.5 11 8.6 1.2 12 1.2S18.5 11 24 11"/></svg><div class="ph">${mark(24,23)}1top<span class="hm-live">${S.live} · ${PCS[0]}</span></div><div class="ps"><div><b class="p0"></b><small>${S.stats[0]}</small></div><div><b class="p1"></b><small>${S.stats[1]}</small></div><div><b>4</b><small>${S.stats[2]}</small></div></div><div class="pl">${S.sessions}</div><div class="pf"><span>${S.full}</span><kbd>⌘O</kbd></div></div>
  ${SESS.map(item).join('')}
  ${S.hl.map(h=>`<div class="hm-a hm-hl"><span>${h}</span></div>`).join('')}
  <div class="hm-a hm-mb">${S.apps.map((a,k)=>`<div class="lf"><i class="ap"></i><b>${a}</b>${S.menus[k].map(m=>`<span>${m}</span>`).join('')}</div>`).join('')}<i class="press"></i><i class="ic bt"></i><svg class="ic wf" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 6.5a14.5 14.5 0 0 1 20 0M5.2 9.9a9.8 9.8 0 0 1 13.6 0M8.4 13.2a5.2 5.2 0 0 1 7.2 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.7" fill="currentColor"/></svg><svg class="ic sp" viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.4" cy="7.4" r="5.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11.6 11.6l4.8 4.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><svg class="ic cc" viewBox="0 0 20 17" aria-hidden="true"><rect x="1" y="1.2" width="18" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15.8" cy="4.2" r="1.8" fill="currentColor"/><rect x="1" y="9.8" width="18" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="4.2" cy="12.8" r="1.8" fill="currentColor"/></svg><time><span>${S.clock[0]}</span>${S.clock[1]}</time></div>
  <div class="hm-a hm-mark"><svg width="150" height="141" viewBox="0 0 806.8 759.5" aria-hidden="true"><defs><clipPath id="hmk${ver}"><rect x="-40" y="-40" height="840" width="0"/></clipPath></defs><g clip-path="url(#hmk${ver})"><path d="${MARK}"/></g></svg></div>
  <div class="hm-a hm-ripple"></div><div class="hm-a"><div class="hm-toast" style="transform:translateX(-50%)"><i>↗</i>${S.toast}</div></div>
  <svg class="hm-a hm-cursor" viewBox="0 0 26 34"><path d="M3 2v25l6.5-6 4.4 10.2 4.4-1.9-4.3-10H22z" fill="#fff" stroke="#0a0c0f" stroke-width="1.6" stroke-linejoin="round"/></svg>
 </div></div></div>
 <div class="hm-hud"><div class="hm-cap" aria-hidden="true"><i></i>${S.cap.map(c=>`<span>${c}</span>`).join('')}</div><div class="hm-ch">${S.ch.map(c=>`<button type="button" aria-label="${S.show}: ${c}">${c}<i><b></b></i></button>`).join('')}</div></div>`;

 const q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)];
 const E={stage:q('.hm-stage'),canvas:q('.hm-canvas'),world:q('.hm-world'),g1:q('.g1'),g2:q('.g2'),zones:qa('.hm-zone'),wires:q('.hm-wires'),paths:qa('.hm-wires path'),dots:qa('.hm-wires circle'),
  halo:q('.hm-halo'),win:q('.hm-win'),tb:q('.hm-win .tb'),heads:qa('.hm-head'),metas:qa('.hm-meta'),th:qa('.hm-th'),hl:qa('.hm-hl'),seg:q('.hm-seg'),pill:q('.hm-seg .pill'),segs:qa('.hm-seg span'),
  big:q('.hm-big'),unit:q('.hm-unit'),rate:q('.hm-rate'),rateN:q('.hm-rate b'),chart:q('.hm-chart'),gl:qa('.hm-chart .gl'),ar:q('.hm-chart .ar'),ln:q('.hm-chart .ln'),nd:q('.hm-chart .nd'),nr:q('.hm-chart .nr'),clip:q(`#hmc${ver} rect`),t0:q('.hm-chart .t0'),t1:q('.hm-chart .t1'),
  desk:q('.hm-desk'),host:q('.hm-host'),panel:q('.hm-panel'),arrow:q('.hm-panel .ar'),apps:qa('.hm-mb .lf'),p0:q('.hm-panel .p0'),p1:q('.hm-panel .p1'),mb:q('.hm-mb'),press:q('.hm-mb .press'),mark:q('.hm-mark'),mpath:q('.hm-mark path'),mclip:q(`#hmk${ver} rect`),
  ripple:q('.hm-ripple'),toast:q('.hm-toast').parentNode,cursor:q('.hm-cursor'),cap:q('.hm-cap'),capBg:q('.hm-cap>i'),caps:qa('.hm-cap span'),chs:qa('.hm-ch button'),fills:qa('.hm-ch b')};
 const IT=qa('.hm-item').map(el=>{const f={};for(const k of FIELDS)f[k]=el.querySelector('.f-'+k);return {el,f,bars:[...el.querySelectorAll('.f-wave i')],strong:[...el.querySelectorAll('.cd-b strong')],fill:[...el.querySelectorAll('.cd-b s')]}});

 const css=(el,p,v)=>{const c=el._c||(el._c={});if(c[p]!==v){el.style[p]=v;c[p]=v}};
 const put=(el,x,y,s=1,o=1)=>{const op=o<.002?0:o>.998?1:+o.toFixed(3);css(el,'opacity',String(op));css(el,'visibility',op?'visible':'hidden');if(op)css(el,'transform',`translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)${s!==1?` scale(${s.toFixed(4)})`:''}`)};
 const size=(el,w,h)=>{css(el,'width',w.toFixed(1)+'px');css(el,'height',h.toFixed(1)+'px')};
 const txt=(el,s)=>{if(el._x!==s){el.textContent=s;el._x=s}};
 let L=WIDE,TREE=[],now=0,capR=[];

 const flash=(i,t)=>{const a=4.1+i*.06;return seg(t,a,a+.15)*(1-seg(t,a+.2,a+.9))};
 const gone=st=>({...st,r:[st.r[0]+st.r[2]*.2,st.r[1]+st.r[3]*.2,st.r[2]*.6,st.r[3]*.6],o:0});
 function lay(i,m,t){
  const s=SESS[i];
  if(m==='chip'){const [w,h]=L.chip,[x,y]=L.at[i],e=out3(seg(t,.25+i*.09,1.05+i*.09)),fy=7*Math.sin((t/5+i*.17)*6.283),fx=4*Math.sin((t/7+i*.29)*6.283);
   return {r:[x+fx,y+fy+(1-e)*26,w,h],o:e,rad:16,bg:[17,21,26,1],bd:lerpA([255,255,255,.09],[130,237,198,.75],flash(i,t)),f:{dot:[18,25,1,1],tool:[36,15,1.04,1],app:[18,53,.9,.72],tok:[18,53,.95,1],wave:[18,18,1,1]}}}
  if(m==='row'){const [x,y,w,h,g]=L.row;
   return {r:[x,y+i*g,w,h],o:1,rad:12,bg:[19,23,28,1],bd:[255,255,255,.05],f:L.n?{name:[18,12,1.04,1],app:[18,41,.88,.75],dot:[250,19,1,1],tool:[268,12,1,1],model:[268,41,1,1],tok:[18,12,1.06,1],cpu:[18,42,.9,1]}
    :{name:[24,10,1,1],desc:[24,36,1,1],dot:[310,27,1,1],tool:[328,10,1,1],model:[328,36,1,1],app:[560,10,1,1],pc:[560,36,1,1],status:[800,16,1,1],tok:[148,11,1.04,1],cpu:[28,12,1,1]}}}
  if(m==='compact'){const r=L.compact(i),c=r[3]/2;return {r,o:1,rad:12,bg:[21,25,30,1],bd:[255,255,255,.08],f:{dot:[16,c-5,1,1],name:[34,c-12,.95,1],tok:[16,c-12,.95,1]}}}
  if(m==='tile'){const r=TREE[i],c=hex(TOOL[s.tool][1]),roomy=r[3]>150&&r[2]>170;
   return {r,o:1,rad:14,bg:[...lerpA([14,17,21],c,.17),1],bd:[...c,.5],f:{name:[18,16,1.04,1],pct:[18,46,r[2]<220?.8:1,1],...(r[2]>190?{tok:[16,18,.88,.75]}:{}),...(roomy?{dot:[18,r[3]-30,1,1],tool:[36,r[3]-39,.85,.8]}:{})}}}
  if(i>3)return gone(lay(i,'tile',t));
  if(m==='card')return {r:L.card(i),o:1,rad:16,bg:[19,23,28,1],bd:[255,255,255,.09],f:{card:[0,0,1,1]}};
  if(m==='tuck'){const [x,y,w,h]=L.card(i),k=.55,ax=L.icon,ay=L.mbh/2;return {r:[ax+(x-ax)*k,ay+(y-ay)*k,w*k,h*k],o:0,rad:16*k,bg:[19,23,28,1],bd:[255,255,255,.09],f:{card:[0,0,k,0]}}}
  const P=L.panel,hit=i?0:seg(t,21.38,21.5);
  return {r:[P[0]+12,P[1]+222+i*66-(m==='pop'?8:0),P[2]-24,58],o:m==='prow'?1:0,rad:12,bg:lerpA([22,26,31,1],[24,44,38,1],hit),bd:lerpA([255,255,255,.05],[130,237,198,.75],hit),f:{dot:[16,24,1,1],name:[34,9,1,1],app:[34,33,.84,.7],tok:[54,17,.95,1],open:[12,14,1,1],card:[0,0,(P[2]-24)/L.card(i)[2],0]}};
 }
 function mix(A,B,p){
  const f={};
  for(const k in A.f){const a=A.f[k],b=B.f[k];f[k]=b?[lerp(a[0],b[0],p),lerp(a[1],b[1],p),lerp(a[2],b[2],p),lerp(a[3],b[3],p)]:[a[0],a[1],a[2],a[3]*(1-seg(p,0,k==='card'?.22:.4))]}
  for(const k in B.f)if(!A.f[k]){const b=B.f[k];f[k]=[b[0],b[1],b[2],b[3]*seg(p,k==='card'?.45:.6,1)]}
  return {r:lerpA(A.r,B.r,p),o:lerp(A.o,B.o,p),rad:lerp(A.rad,B.rad,p),bg:lerpA(A.bg,B.bg,p),bd:lerpA(A.bd,B.bd,p),f};
 }
  // [mode, start, duration, stagger per item]; the popover rows open and close together.
 const MODES=[['chip',0,0],['row',4.6,1],['compact',9.6,.8],['tile',13.1,.85],['card',16,.8],['tuck',19.3,.45,.02],['pop',20.5,.01,0],['prow',20.52,.22,0],['shut',21.8,.16,0]];
 function itemAt(i,t){
  const at=j=>MODES[j][1]+i*(MODES[j][3]??.055);let k=0;for(let j=1;j<MODES.length;j++)if(t>=at(j))k=j;
  const B=lay(i,MODES[k][0],t);if(!k)return B;
  const p=io3(seg(t,at(k),at(k)+MODES[k][2]));
  return p>=1?B:mix(lay(i,MODES[k-1][0],t),B,p);
 }
 function drawItem(it,st){
  const [x,y,w,h]=st.r;put(it.el,x,y,1,st.o);if(st.o<.002)return;
  size(it.el,w,h);css(it.el,'borderRadius',st.rad.toFixed(1)+'px');css(it.el,'background',rgba(st.bg));css(it.el,'borderColor',rgba(st.bd));
  for(const k of FIELDS){const fe=it.f[k];if(!fe)continue;const v=st.f[k];if(!v){put(fe,0,0,1,0);continue}put(fe,RIGHT.has(k)?-v[0]:v[0],v[1],v[2],v[3])}
 }

 function applyLayout(next){
  L=next;const {W,H}=L;root.classList.toggle('hm--narrow',!!L.n);
  size(E.canvas,W,H);E.wires.setAttribute('width',W);E.wires.setAttribute('height',H);E.wires.setAttribute('viewBox',`0 0 ${W} ${H}`);
  TREE=squarify(SESS.map((s,i)=>({i,v:s.tok})).sort((a,b)=>b.v-a.v),L.tree);
  E.metas.forEach(m=>{css(m,'left','auto');css(m,'right',W-L.meta+'px')});
  E.th.forEach((el,k)=>{const p=L.th[k];if(p&&p[2]){css(el,'left','auto');css(el,'right',W-p[0]+'px')}});
  css(E.rate,'left','auto');css(E.rate,'right',W-L.rate[0]+'px');
  const [,,sw,sh]=L.seg;E.segs.forEach(s=>size(s,sw,sh-8));size(E.pill,sw,sh-8);
  const [,,cw,ch]=L.chart;E.chart.setAttribute('width',cw);E.chart.setAttribute('height',ch+30);E.chart.setAttribute('viewBox',`0 0 ${cw} ${ch+30}`);
  E.gl.forEach((g,k)=>{const y=(ch*(k+1)/4).toFixed(1);g.setAttribute('x1',0);g.setAttribute('x2',cw);g.setAttribute('y1',y);g.setAttribute('y2',y)});
  E.t0.setAttribute('x',0);E.t0.setAttribute('y',ch+26);E.t1.setAttribute('x',cw);E.t1.setAttribute('y',ch+26);
  size(E.desk,W,H);size(E.mb,W,L.mbh);E.apps.forEach(g=>g.querySelectorAll('span').forEach((s,k)=>{s.style.display=k<L.menuN?'':'none'}));
  E.press.style.left=L.icon+'px';E.mb.querySelectorAll('.ic').forEach((el,k)=>{el.style.display=L.sys[k]?'':'none';el.style.left=L.icon+L.sys[k]+'px'});E.mb.querySelector('time span').style.display=L.date?'':'none';
  E.arrow.style.left=L.icon-L.panel[0]-12+'px';
  size(E.panel,L.panel[2],L.panel[3]);size(E.host,L.host[2],L.host[3]);IT.slice(0,4).forEach((it,i)=>{const c=L.card(i);size(it.f.card,c[2],c[3])});
  fit();
 }
 function fit(){const w=root.clientWidth||L.W;css(E.canvas,'transform',`scale(${(w/L.W).toFixed(5)})`);css(E.stage,'aspectRatio',`${L.W}/${L.H}`);if(capture)css(q('.hm-hud'),'zoom',(w/L.W).toFixed(4));measureCaps()}
 // Caption widths as a share of the caption row; ratios stay correct under the capture zoom.
 function measureCaps(){const w=E.cap.getBoundingClientRect().width;capR=w?E.caps.map(c=>c.getBoundingClientRect().width/w):[]}

 function render(t){
  t=((t%T)+T)%T;now=t;const {W,H}=L;
  const outP=io3(seg(t,23.25,23.95));put(E.world,0,0,1-.03*outP,1-outP);
  put(E.g1,W*(.3+.06*Math.sin(t*.26)),H*(.42+.05*Math.cos(t*.21)));put(E.g2,W*(.72+.05*Math.cos(t*.23)),H*(.52+.06*Math.sin(t*.19)));
  E.zones.forEach((z,k)=>{const [x,y,w,h]=L.zones[k];put(z,x,y+(1-out3(seg(t,0,.8)))*12,1,fade(t,.05+k*.12,3.75,.6,.6));size(z,w,h)});

  // Wires: each session reports into the 1top mark.
  const [mx,my]=L.mark,wireOn=t>3.2&&t<4.9;
  for(let i=0;i<6;i++){
   const path=E.paths[i],d=i*.06;
   if(!wireOn){css(path,'opacity','0');for(let k=0;k<3;k++)css(E.dots[i*3+k],'opacity','0');continue}
   const [x,y,w,h]=lay(i,'chip',t).r;let ax,ay,c1,c2;
   if(L.n){ax=x+w/2;ay=y+h/2<my?y+h:y;c1=[ax,lerp(ay,my,.6)];c2=[mx,lerp(ay,my,.4)]}else{ax=x+w/2<mx?x+w:x;ay=y+h/2;c1=[lerp(ax,mx,.6),ay];c2=[lerp(ax,mx,.4),my]}
   path.setAttribute('d',`M${ax.toFixed(1)} ${ay.toFixed(1)}C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${mx} ${my}`);
   css(path,'strokeDashoffset',(1-io3(seg(t,3.3+d,4.15+d))).toFixed(4));css(path,'opacity',((1-seg(t,4.5,4.85))*.85).toFixed(3));
   const env=seg(t,3.85+d,4.05+d)*(1-seg(t,4.45,4.8));
   for(let k=0;k<3;k++){const u=(((t-3.85-d)*.85+k/3)%1+1)%1,v=1-u,dot=E.dots[i*3+k];
    dot.setAttribute('cx',(v*v*v*ax+3*v*v*u*c1[0]+3*v*u*u*c2[0]+u*u*u*mx).toFixed(1));dot.setAttribute('cy',(v*v*v*ay+3*v*v*u*c1[1]+3*v*u*u*c2[1]+u*u*u*my).toFixed(1));css(dot,'opacity',(env*Math.sin(Math.PI*u)).toFixed(3))}
  }

  // The mark grows, docks in the title bar, then becomes the menu-bar icon.
  const dock=io3(seg(t,4.6,5.4)),mbar=io3(seg(t,19.3,19.85)),Wr=L.win;
  let x=lerp(mx,Wr[0]+96,dock),y=lerp(my,Wr[1]+23,dock),s=lerp(1,.156,dock);x=lerp(x,L.icon,mbar);y=lerp(y,L.mbh/2,mbar);s=lerp(s,L.n?.15:.128,mbar);
  put(E.mark,x,y,s,seg(t,3.05,3.15));
  // The mark is traced in from left to right, rises from the baseline and breathes until it docks.
  {const rise=out3(seg(t,3.1,3.75)),live=1+.05*Math.sin(t*5.2)*(1-dock);E.mclip.setAttribute('width',(890*io3(seg(t,3.05,3.6))).toFixed(1));E.mpath.setAttribute('transform',`translate(0 ${(412*(1-(.2+.8*rise)*live)).toFixed(2)}) scale(1 ${((.2+.8*rise)*live).toFixed(4)})`);css(E.mpath,'fill',rgba([...lerpA([110,204,168],[255,255,255],mbar),1]))}
  const ho=out3(seg(t,3.2,3.8))*(1-seg(t,4.5,5));put(E.halo,mx,my,.85+.15*ho+.03*Math.sin(t*3),ho);

  // Window frame grows out of the mark and later folds into the menu-bar icon.
  // It shrinks toward the menu-bar icon together with the account cards while the desktop shows through.
  const grow=expo(seg(t,4.75,5.55)),fold=io3(seg(t,19.3,19.75)),ax=L.icon,ay=L.mbh/2;
  const wr=lerpA(lerpA([mx-90,my-60,180,120],Wr,grow),[ax+(Wr[0]-ax)*.55,ay+(Wr[1]-ay)*.55,Wr[2]*.55,Wr[3]*.55],fold);
  put(E.win,wr[0],wr[1],1,out3(seg(t,4.75,5))*(1-seg(t,19.3,19.7)));size(E.win,wr[2],wr[3]);css(E.tb,'opacity',(seg(t,5.1,5.5)*(1-seg(t,19.3,19.55))).toFixed(3));

  [[5.4,9.75],[9.75,13.15],[13.15,16.1],[16.1,19.4]].forEach(([a,b],k)=>{const o=fade(t,a,b,.4,.3);put(E.heads[k],L.head[0],L.head[1]+(1-o)*8,1,o)});
  [[5.6,9.75],[13.3,16.1],[16.3,19.4]].forEach(([a,b],k)=>{const o=fade(t,a,b,.4,.3);put(E.metas[k],0,L.head[1]+8+(1-o)*8,1,o)});
  E.th.forEach((el,k)=>{const p=L.th[k];if(!p)return put(el,0,0,1,0);
   if(!k&&L.thD){const m=io3(seg(t,9.6,10.4));put(el,lerp(p[0],L.thD[0],m),lerp(p[1],L.thD[1],m),1,fade(t,5.45,13.15,.4,.3))}
   else put(el,p[2]?0:p[0],p[1],1,fade(t,5.45,9.75,.4,.3))});
  E.hl.forEach((el,k)=>{const [x,y,w,h]=L.hl[k],o=k?fade(t,7.95,9.5,.3,.3):fade(t,6.35,7.95,.3,.3);put(el,x,y+(1-o)*6,1,o);size(el,w,h)});

  for(let i=0;i<6;i++){const it=IT[i];drawItem(it,itemAt(i,t));txt(it.f.tok,fmt(tokAt(i,t)));
   if(t<5.8)it.bars.forEach((b,k)=>css(b,'height',(SESS[i].st===1?6+12*Math.abs(Math.sin(t*(5+i*.7)+k*1.3+i)):SESS[i].st?5:3).toFixed(1)+'px'));
   if(i<4&&t>15.9&&t<23.6){const p=out3(seg(t,16.7+i*.12,17.7+i*.12));ACCT[i].v.forEach((v,k)=>{txt(it.strong[k],Math.round(v*p)+'%');css(it.fill[k],'width',(v*p).toFixed(2)+'%')})}}

  // Usage scene: the selected window drives the big number, chart span and every row.
  const uo=fade(t,9.95,13.2,.5,.35);
  if(uo>0){
   const w=pickAt(t),tot=lerp(TOTAL[w.a],TOTAL[w.b],w.p),[sx,sy,sw,sh]=L.seg;
   put(E.seg,sx,sy+(1-uo)*10,1,uo);size(E.seg,sw*6+8+10,sh);css(E.pill,'transform',`translateX(${(4+lerp(w.a,w.b,w.p)*(sw+2)).toFixed(2)}px)`);
   E.segs.forEach((s,k)=>css(s,'color',k===w.b?'#e9fbf4':'#8a9199'));
   put(E.big,L.big[0],L.big[1]+(1-uo)*14,1,uo);txt(E.big,fmt(tot));put(E.unit,L.unit[0],L.unit[1]+(1-uo)*14,1,uo);txt(E.unit,S.unit(S.span[w.b]));
   put(E.rate,0,L.rate[1]+(1-uo)*14,1,uo*seg(t,10.3,10.8));txt(E.rateN,String(560+Math.round(14*Math.sin(t*2.3))));
   const [cx,cy,cw,ch]=L.chart,D=Math.exp(lerp(Math.log(SPAN[w.a]),Math.log(SPAN[w.b]),w.p)),ym=lerp(YMAX[w.a],YMAX[w.b],w.p),he=24+t/60,N=140;
   put(E.chart,cx,cy+(1-uo)*14,1,uo);let dd='',ly=0;
   for(let j=0;j<=N;j++){const v=rate(he-D+D*j/N,D/N);ly=ch-Math.min(1,v/ym)*ch*.94;dd+=(j?'L':'M')+(cw*j/N).toFixed(1)+' '+ly.toFixed(1)}
   E.ln.setAttribute('d',dd);E.ar.setAttribute('d',dd+`L${cw} ${ch}L0 ${ch}Z`);E.clip.setAttribute('width',((cw+20)*out3(seg(t,10.05,10.9))).toFixed(1));
   E.nd.setAttribute('cx',cw);E.nd.setAttribute('cy',ly.toFixed(1));E.nr.setAttribute('cx',cw);E.nr.setAttribute('cy',ly.toFixed(1));const ring=(t*1.2)%1;E.nr.setAttribute('r',(6+14*ring).toFixed(1));css(E.nr,'opacity',(1-ring).toFixed(3));
   txt(E.t0,S.ago[w.b]);
  }else[E.seg,E.big,E.unit,E.rate,E.chart].forEach(el=>put(el,0,0,1,0));

  // Desktop: the wallpaper and menu bar appear, the pointer clicks the 1top icon, its popover opens under it,
  // and picking a session closes the popover and brings Cursor forward (the menu bar switches from Finder to Cursor).
  const P=L.panel,ix=L.icon-2,iy=L.mbh/2-2,tx=P[0]+P[2]-39,ty=P[1]+251;
  put(E.desk,0,0,1,io3(seg(t,19.3,19.8)));
  const mo=io3(seg(t,19.3,19.75)),sw=seg(t,21.74,21.86);put(E.mb,0,lerp(-12,0,mo),1,mo);css(E.apps[0],'opacity',(1-sw).toFixed(3));css(E.apps[1],'opacity',sw.toFixed(3));
  css(E.press,'opacity',(seg(t,20.5,20.56)*(1-seg(t,21.8,21.95))).toFixed(3));
  const po=out3(seg(t,20.52,20.74))*(1-io3(seg(t,21.8,21.96)));put(E.panel,P[0],P[1]-8*(1-out3(seg(t,20.52,20.74))),1,po);
  if(po>0){txt(E.p0,fmt(SUM+(t-19.2)*.2));txt(E.p1,String(560+Math.round(14*Math.sin(t*2.3))))}
  const lit=out3(seg(t,21.74,21.95)),hb=Math.sin(Math.PI*seg(t,21.74,22.3));
  const hi=out3(seg(t,19.55,20));put(E.host,L.host[0],L.host[1]+(1-hi)*10,1+.012*hb,hi);E.host.classList.toggle('lit',lit>.5);
  css(E.host,'borderColor',rgba(lerpA([38,43,49,1],[130,237,198,.7],lit*(1-seg(t,22.6,23.2)))));css(E.host,'boxShadow',`0 30px 70px -24px rgba(0,0,0,.7),0 0 ${(40*lit).toFixed(0)}px -10px rgba(130,237,198,${(.35*lit).toFixed(3)})`);
  const m1=io3(seg(t,19.95,20.45)),m2=io3(seg(t,20.82,21.42)),press=Math.sin(Math.PI*seg(t,20.46,20.6))+Math.sin(Math.PI*seg(t,21.55,21.7));
  const cx=lerp(lerp(L.cur[0],ix,m1)+40*Math.sin(Math.PI*m1),tx,m2)-30*Math.sin(Math.PI*m2),cy=lerp(lerp(L.cur[1],iy,m1),ty,m2);
  put(E.cursor,cx,cy,1-.14*press,out3(seg(t,19.85,20.05))*(1-seg(t,22.5,22.9)));
  const rp=seg(t,21.58,21.92);put(E.ripple,tx,ty,.3+.9*out3(rp),t>21.58?1-rp:0);
  const to=fade(t,21.95,23.1,.3,.35);put(E.toast,L.toast[0],L.toast[1]-(1-to)*10,.96+.04*to,to);

  if(capR.length){const k=CAP.findIndex((a,j)=>t>=a&&t<CAP[j+1]),b=CAP[k+1],r=lerp(capR[k],capR[(k+1)%capR.length],io3(seg(t,b-.34,b)));css(E.capBg,'width',(r*100).toFixed(3)+'%')}
  E.caps.forEach((c,k)=>{const a=CAP[k],b=CAP[k+1],i=out3(seg(t,a+.12,a+.5)),o=io3(seg(t,b-.32,b)),v=Math.min(i,1-o);css(c,'opacity',v.toFixed(3));css(c,'transform',`translateY(${((1-i)*8-o*8).toFixed(2)}px)`)});
  E.chs.forEach((b,k)=>{const on=t>=CH[k]&&t<CH[k+1];b.classList.toggle('on',on);css(E.fills[k],'transform',`scaleX(${(on?seg(t,CH[k],CH[k+1]):0).toFixed(4)})`);on?b.setAttribute('aria-current','step'):b.removeAttribute('aria-current')});
 }

 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let clock=0,last=0,raf=0,visible=true,pageHold=false;
 const host=root.closest('.product-landing');
 const playing=()=>!capture&&!reduce.matches&&visible&&!pageHold&&!document.hidden;
 const loop=ms=>{raf=0;if(!playing()){last=0;return}const dt=last?Math.min(.05,(ms-last)/1000):0;last=ms;clock=(clock+dt)%T;render(clock);raf=requestAnimationFrame(loop)};
 const sync=()=>{if(playing()){if(!raf){last=0;raf=requestAnimationFrame(loop)}}else{if(raf)cancelAnimationFrame(raf);raf=0;last=0}};
 const pick=k=>{clock=playing()?CH[k]+.01:REP[k];render(clock)};
 E.chs.forEach((b,k)=>b.addEventListener('click',()=>pick(k)));
 const ro=new ResizeObserver(()=>{const n=(root.clientWidth||1280)<560?NARROW:WIDE;n!==L?applyLayout(n):fit();render(clock)});
 // Font swaps change caption widths after mount.
 const cro=new ResizeObserver(()=>{measureCaps();render(now)});E.caps.forEach(c=>cro.observe(c));
 const io=new IntersectionObserver(es=>{visible=es[0].isIntersecting;sync()},{threshold:.05});
 const mo=host&&new MutationObserver(()=>{pageHold=host.classList.contains('motion-paused');sync()});
 const motion=()=>{if(reduce.matches){clock=REP[0];render(clock)}sync()};
 applyLayout((root.clientWidth||1280)<560?NARROW:WIDE);
 if(!capture){ro.observe(root);io.observe(root);if(mo){pageHold=host.classList.contains('motion-paused');mo.observe(host,{attributes:true,attributeFilter:['class']})}reduce.addEventListener('change',motion);document.addEventListener('visibilitychange',sync)}
 clock=reduce.matches&&!capture?REP[0]:0;render(clock);sync();
 const stop=()=>{if(raf)cancelAnimationFrame(raf);raf=0;ro.disconnect();cro.disconnect();io.disconnect();mo?.disconnect();reduce.removeEventListener('change',motion);document.removeEventListener('visibilitychange',sync)};
 return Object.assign(stop,{render,duration:T,layout:n=>{applyLayout(n?NARROW:WIDE);render(now)}});
}
