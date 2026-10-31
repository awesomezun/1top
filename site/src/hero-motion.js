// Hero motion v3.1.0 "Cluster": 1top as the instrument cluster for AI work. The gauges wake with an
// ignition sweep, a speedometer reads each session's weekly-limit burn rate, the same cluster lives in
// the macOS menu bar, the time window shifts like a gear, and each account's weekly limit is a fuel gauge.
// Every frame is a pure function of time, so live playback, stills and the video render match.
// v3.1.0: the tachometer reads the app's token speed (the time window's average in M tokens per hour), the
// numbers and the menu-bar panel come from the v7.0.0 films' demo data, and the captions add Chinese.
const T=28,CH=[0,10,16,20.5,T],CAP=[0,3,10,16,20.5,T],REP=[4.4,13.1,18.75,22.6];
const clamp=v=>v<0?0:v>1?1:v,seg=(t,a,b)=>clamp((t-a)/(b-a)),lerp=(a,b,p)=>a+(b-a)*p;
const out3=p=>1-(1-p)**3,io3=p=>p<.5?4*p*p*p:1-(-2*p+2)**3/2,back=p=>1+2.4*(p-1)**3+1.4*(p-1)**2;
const fade=(t,a,b,i=.35,o=.35)=>Math.min(out3(seg(t,a,a+i)),1-io3(seg(t,b-o,b)));
const noise=(a,b)=>{const x=Math.sin(a*12.9898+b*78.233)*43758.5453;return x-Math.floor(x)};
const fmtM=k=>k>=999950?(k/1e6).toFixed(2)+'B':k>=999.95?(k/1000).toFixed(2)+'M':k.toFixed(1)+'k';

const COPY={
 en:{label:'Animated overview of 1top as an instrument cluster. The gauges wake up, a speedometer shows how fast each session uses its weekly subscription limit in percent per hour, the same gauges open from the macOS menu bar, the time window changes the token flow, and each account shows how much of its weekly limit is used and how fast.',
  cap:['Start 1top and your AI work comes up on the gauges.','A speedometer for every session: how fast it uses your weekly limit.','The same gauges, one click away in the macOS menu bar.','Shift the time window — the token flow and every number follow.','Each account’s weekly limit: how much is used, and how fast.'],
  ch:['Speedometer','Menu bar','Time window','Weekly limits'],show:'Show',
  tach:'Token speed',tachU:'M tokens/h · window average',speed:'Burn rate',speedU:'%/h of weekly limit',
  tells:['Claude Code 5','Codex 3','GLM 1','Needs attention 2','Live'],
  sess:'Running sessions',flow:'Token flow',acct:'Weekly limits',gear:'Time window',fuel:'Weekly limit left',odo:'tokens',
  win6:['10m','30m','1h','5h','12h','24h','Custom'],cust:'36h',span:['last 10 min','last 30 min','last hour','last 5 hours','last 12 hours','last 24 hours','last 36 hours'],
  kids:n=>`${n} sub`,rate:v=>`${v}%/h`,used:'/ 100% used',inc:v=>`Last hour +${v}%`,avg:v=>`avg ${v}%/h`,
  apps:'Finder',menus:['File','Edit','View','Go','Window','Help'],clock:['Wed Oct 28','9:41 AM'],host:'checkout-web — Orca',term:'Checkout UI'},
 ko:{label:'1top을 자동차 계기판처럼 보여 주는 애니메이션입니다. 계기판이 켜지고, 속도계가 세션마다 주간 구독 한도를 시간당 몇 %씩 쓰는지 보여 줍니다. 같은 계기판을 macOS 메뉴 막대에서 열고, 기간에 따라 토큰 흐름이 바뀌며, 계정마다 주간 한도를 얼마나, 얼마나 빨리 쓰는지 보여 줍니다.',
  cap:['1top을 켜면 AI 작업이 계기판에 올라옵니다.','세션마다 주간 한도를 시간당 몇 %씩 쓰는지, 속도계로 봅니다.','같은 계기판을 macOS 메뉴 막대에서 바로 엽니다.','기간을 바꾸면 토큰 흐름과 모든 수치가 함께 바뀝니다.','계정마다 이번 주 한도를 얼마나, 얼마나 빨리 쓰는지 봅니다.'],
  ch:['속도계','메뉴 막대','기간','주간 한도'],show:'보기',
  tach:'토큰 속도',tachU:'M tokens/시간 · 기간 평균',speed:'소진 속도',speedU:'%/시간 · 주간 한도 기준',
  tells:['Claude Code 5','Codex 3','GLM 1','확인 필요 2','실시간'],
  sess:'실행 중인 세션',flow:'토큰 흐름',acct:'주간 한도',gear:'기간',fuel:'남은 주간 한도',odo:'토큰',
  win6:['10분','30분','1시간','5시간','12시간','24시간','기간 지정'],cust:'36시간',span:['최근 10분','최근 30분','최근 1시간','최근 5시간','최근 12시간','최근 24시간','최근 36시간'],
  kids:n=>`하위 ${n}`,rate:v=>`${v}%/시간`,used:'/ 100% 사용',inc:v=>`최근 1시간 +${v}%`,avg:v=>`평균 ${v}%/시간`,
  apps:'Finder',menus:['파일','편집','보기','이동','윈도우','도움말'],clock:['10월 28일 (수)','오전 9:41'],host:'checkout-web — Orca',term:'Checkout UI'},
 zh:{label:'把 1top 当作汽车仪表盘来展示的动画。仪表盘亮起，速度表显示每个会话每小时消耗每周订阅额度的百分比；同样的仪表可从 macOS 菜单栏打开；切换时段时 Token 趋势随之变化；每个账户显示每周额度用了多少、用得多快。',
  cap:['打开 1top，你的 AI 工作就会出现在仪表盘上。','每个会话一个速度表：它消耗每周额度有多快。','同样的仪表，在 macOS 菜单栏中一键打开。','切换时段，Token 趋势和所有数字一起变化。','每个账户的每周额度：用了多少、用得多快。'],
  ch:['速度表','菜单栏','时段','每周额度'],show:'查看',
  tach:'Token 速度',tachU:'M tokens/小时 · 时段平均',speed:'消耗速度',speedU:'%/小时 · 按每周额度',
  tells:['Claude Code 5','Codex 3','GLM 1','需要确认 2','实时'],
  sess:'运行中的会话',flow:'Token 趋势',acct:'每周额度',gear:'时段',fuel:'剩余每周额度',odo:'Token',
  win6:['10分钟','30分钟','1小时','5小时','12小时','24小时','自定义'],cust:'36小时',span:['最近 10 分钟','最近 30 分钟','最近 1 小时','最近 5 小时','最近 12 小时','最近 24 小时','最近 36 小时'],
  kids:n=>`子会话 ${n}`,rate:v=>`${v}%/小时`,used:'/ 100% 已用',inc:v=>`最近 1 小时 +${v}%`,avg:v=>`平均 ${v}%/小时`,
  apps:'Finder',menus:['文件','编辑','显示','前往','窗口','帮助'],clock:['10月28日 周三','上午9:41'],host:'checkout-web — Orca',term:'Checkout UI'}
};

// Tool identities match the app palette (AgentPalette.swift); the light tone is for text and needles on dark faces.
const TOOL={claude:['Claude Code','#bd8965','#e3b796'],codex:['Codex','#378d76','#72d1b0'],glm:['GLM','#7c86bd','#aeb6ee']};
// Example data from the v7.0.0 films' generator (scripts/demo-state.mjs: invented sessions and accounts, use
// shaped like real work), taken while the sessions were working: eq = estimated share of the account's weekly
// limit in the last hour, burn = current %/h of the weekly limit (the app's 소진 속도 gauge).
const SESS=[
 {id:'Checkout UI',tool:'claude',model:'opus-5-5',eff:'xhigh',eq:.52,burn:.93,kids:2},
 {id:'Billing API',tool:'codex',model:'gpt-6.1-sol',eff:'ultra',eq:.15,burn:.42,kids:1},
 {id:'docs-site',tool:'claude',model:'sonnet-5-5',eff:'high',eq:.94,burn:.70},
 {id:'Gateway',tool:'codex',model:'gpt-6-astra',eff:'high',eq:.02,burn:0}];
// Accounts go by the names shown in the app, so the label is the same in every language.
// Weekly percents are the demo world's at its capture moment (demoNow 1800000000), as every film and phone shows them.
const ACCT=[{tool:'claude',plan:'Max',who:'dev',week:61,inc:.85,burn:.85},{tool:'codex',plan:'Pro',who:'ops',week:71,inc:.41,burn:.41},
 {tool:'claude',plan:'Pro',who:'studio',week:33,inc:.95,burn:.95},{tool:'codex',plan:'Plus',who:'ml',week:18,inc:.26,burn:.26}];
// Tokens in thousands for 10m, 30m, 1h, 5h, 12h, 24h and a custom 36-hour range: bursts and rest, as in the films,
// read from scripts/demo-state.mjs at the same capture moment.
const TOTAL=[9901,47849,108202,493637,902283,1846909,2819087],HOUR=2,CUSTOM=6;
// The tachometer is the dashboard's token speed: the window's tokens per hour, on its resting 200M scale.
const SPEED={max:2,major:.5,minor:.1,fmt:v=>String(+v.toFixed(1))},TACH={max:200,major:50,minor:10,fmt:v=>String(v)};

// Who the speedometer reads: [time, session (s) or account (a) index]. Rates are never added across accounts.
const SUBJ=[[0,'s',0],[5.4,'s',1],[7.8,'s',2],[16,'s',0],[20.6,'a',0],[21.9,'a',1],[23.2,'a',2],[24.5,'a',3]];
// The time window shifts like a gear: [time, period index].
const GEAR=[[0,HOUR],[16.8,5],[17.8,CUSTOM],[18.8,0],[19.8,HOUR]];
// Menu-bar panel captured from the v7.0.0 recording build in each language; boxes (weekly limits, sessions) are fractions of the image.
const PANEL_IMG=lang=>`/media/v7.0.0/menu-panel-${lang}.png`,PANEL_ASPECT=932/1652,PANEL_HL=[[.06,.418,.884,.145],[.06,.642,.884,.278]];
const MARK='M401.0 0.0 L394.5 1.5 L387.0 6.0 L381.8 12.5 L378.8 22.0 L340.5 465.5 L339.5 464.5 L338.8 461.2 L306.5 174.2 L304.5 168.0 L300.0 161.2 L293.2 156.2 L286.5 154.0 L276.2 154.0 L267.8 157.2 L263.8 160.2 L260.2 164.2 L256.0 173.5 L216.8 436.2 L215.5 440.2 L214.8 439.2 L182.5 284.2 L179.0 277.2 L174.0 272.0 L168.8 269.0 L160.8 267.0 L150.8 268.0 L144.0 271.0 L138.0 276.2 L134.0 282.8 L109.0 381.2 L107.2 384.8 L25.0 384.8 L19.0 386.0 L10.5 390.8 L4.2 397.8 L0.8 406.0 L0.0 416.0 L2.0 423.5 L6.2 430.5 L10.5 434.8 L14.8 437.5 L24.0 440.5 L126.0 440.8 L132.2 439.8 L137.2 438.0 L141.8 435.5 L147.0 430.8 L150.5 425.0 L154.8 411.2 L155.8 410.8 L195.0 596.8 L199.0 604.2 L201.8 607.2 L206.2 610.2 L214.0 613.2 L225.0 613.5 L231.5 611.5 L237.8 607.8 L242.5 601.8 L244.5 596.5 L275.8 387.8 L277.2 382.0 L278.0 383.8 L318.0 739.0 L321.0 747.0 L324.5 751.8 L328.8 755.2 L333.0 757.5 L339.0 759.2 L347.8 759.2 L356.2 756.2 L363.0 750.8 L367.2 743.2 L368.8 736.0 L403.2 338.8 L404.5 333.2 L405.2 334.5 L440.5 737.8 L443.8 747.5 L449.0 753.8 L457.0 758.2 L463.0 759.5 L467.8 759.5 L475.8 757.5 L482.0 753.8 L488.0 746.5 L491.0 737.8 L531.0 382.8 L531.5 382.2 L533.0 387.5 L564.2 595.5 L567.5 603.5 L571.8 608.2 L579.5 612.5 L585.2 613.8 L595.2 613.2 L602.2 610.5 L606.2 608.0 L609.5 604.8 L613.8 597.0 L653.2 408.8 L655.0 410.2 L659.0 422.8 L662.2 428.0 L666.5 432.8 L670.5 435.8 L676.5 438.8 L686.0 440.8 L780.5 440.8 L786.2 439.8 L795.0 435.5 L801.8 428.8 L805.8 420.5 L806.8 410.8 L804.8 402.2 L799.8 394.2 L793.2 388.8 L785.0 385.2 L701.5 384.5 L699.0 377.0 L676.5 288.0 L673.8 280.2 L669.5 274.2 L663.0 269.2 L654.8 266.5 L647.8 266.2 L640.8 268.0 L635.5 271.0 L630.5 276.0 L627.0 282.8 L594.0 439.5 L593.2 440.2 L592.0 436.2 L552.8 173.2 L548.8 164.5 L542.5 158.2 L533.2 154.2 L523.0 154.0 L514.5 157.0 L508.0 162.5 L504.2 168.8 L502.2 176.2 L470.0 461.2 L469.2 464.5 L468.2 465.5 L430.2 21.5 L429.0 16.5 L426.8 11.8 L424.0 8.0 L420.0 4.5 L411.0 0.5Z';

const WIDE={W:1280,H:640,n:0,body:[46,22,1188,596],tach:[262,300,1],speed:[1018,300,1],tells:[640,64],mid:[420,118,1],
 gear:[640,516],fuel:[118,486],odo:[1162,486],mbh:30,panel:(k,x)=>[Math.min(x-264*k,1272-528*k),40,528*k,528],host:[64,96,620,436],cur:[700,600]};
const NARROW={W:640,H:900,n:1,body:[16,16,608,868],tach:[170,248,.74],speed:[470,248,.74],tells:[320,52],mid:[48,452,1.2],
 gear:[320,404],fuel:null,odo:null,mbh:36,panel:k=>[320-370*k,46,740*k,740],host:null,cur:[320,860]};

// Token flow for the flow page; the same curve family as the dashboard films.
function rate(h){return .42+.13*Math.sin(h*.34+1)+.09*Math.sin(h*1.7)+.07*Math.sin(h*5.3+2)+.05*Math.sin(h*23+.4)+.04*Math.sin(h*61+1.3)+.3*Math.exp(-(((h-20.5)/.7)**2))+.25*Math.exp(-(((h-23.4)/.3)**2))}
const SPAN=[1/6,.5,1,5,12,24,36],share=h=>{const c=.42+.08*Math.sin(h*.9+.5)+.04*Math.sin(h*7.1),x=.38+.07*Math.sin(h*1.3+2)+.03*Math.sin(h*11.3+1);return [c,x,Math.max(.05,1-c-x)]};
const BARS=SPAN.map(d=>{const v=Array.from({length:36},(_,j)=>{const h=24-d+d*(j+.5)/36;return rate(h)*(.82+.36*noise(d*7,j))}),m=Math.max(...v);return v.map((x,j)=>{const s=share(24-d+d*j/36);return s.map(k=>x/m*k)})});

function track(t,keys,dur,ease=back){let v=keys[0][1];for(let i=1;i<keys.length;i++){const [k,x]=keys[i];if(t<k)break;v=lerp(v,x,ease(seg(t,k,k+dur)))}return v}
const at=(t,keys)=>{let k=keys[0];for(const x of keys)if(t>=x[0])k=x;return k};

function dialSVG(id,g,label){
 const C=170,ang=f=>(135+270*f)*Math.PI/180,pt=(f,r)=>[C+r*Math.cos(ang(f)),C+r*Math.sin(ang(f))],n=Math.round(g.max/g.minor);
 let ticks='',labels='';
 for(let i=0;i<=n;i++){const v=i*g.minor,f=v/g.max,maj=Math.abs(v/g.major-Math.round(v/g.major))<1e-6,[x1,y1]=pt(f,maj?122:131),[x2,y2]=pt(f,141);
  ticks+=`<line class="${maj?'mj':'mn'}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  if(maj){const [lx,ly]=pt(f,103);labels+=`<text x="${lx.toFixed(1)}" y="${(ly+6).toFixed(1)}" text-anchor="middle">${g.fmt(v)}</text>`}}
 return `<svg viewBox="0 0 340 340" aria-hidden="true"><defs><radialGradient id="${id}f" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#161c20"/><stop offset=".78" stop-color="#0c1012"/><stop offset="1" stop-color="#090b0d"/></radialGradient></defs>
  <circle class="face" cx="170" cy="170" r="160" fill="url(#${id}f)"/><circle class="rim" cx="170" cy="170" r="160"/><circle class="rim2" cx="170" cy="170" r="151"/>
  <circle class="trk" cx="170" cy="170" r="147" pathLength="360" stroke-dasharray="270 360" transform="rotate(135 170 170)"/>
  <circle class="val" cx="170" cy="170" r="147" pathLength="360" stroke-dasharray="0 360" transform="rotate(135 170 170)"/>
  <g class="tk">${ticks}</g><g class="lb">${labels}</g>
  <g class="nd"><path d="M158 166.4 L301 169.3 L301 170.7 L158 173.6 Z"/></g><circle class="hub" cx="170" cy="170" r="13"/><circle class="hub2" cx="170" cy="170" r="5"/></svg>
  <div class="hx-dl">${label}</div><div class="hx-read"><b>0</b><small></small></div><div class="hx-sub"><i></i><span></span></div>`;
}

export function mountHeroMotion(root,{lang='en',capture=false}={}){
 const S=COPY[lang]||COPY.en,ver=Math.random().toString(36).slice(2,7);
 const mini=`<svg viewBox="0 0 64 36" aria-hidden="true"><path class="mt" d="M7 32 A25 25 0 0 1 57 32"/><path class="mv" d="M7 32 A25 25 0 0 1 57 32" pathLength="100" stroke-dasharray="0 100"/><line class="mn" x1="32" y1="32" x2="32" y2="12"/></svg>`;
 const row=(s,i)=>{const [tn,c,l]=TOOL[s.tool];return `<div class="hx-row" style="--c:${c};--l:${l}"><div class="nm"><b><i></i>${s.id}${s.kids?`<u>${S.kids(s.kids)}</u>`:''}</b><span>${tn} · ${s.model}<em>${s.eff}</em></span></div><div class="eq">≈${s.eq.toFixed(2)}%</div><div class="mg">${mini}<span>${S.rate(s.burn.toFixed(2))}</span></div></div>`};
 const card=(a,i)=>{const [tn,c,l]=TOOL[a.tool];return `<div class="hx-card" style="--c:${c};--l:${l}"><div class="h"><i></i>${tn}<em>${a.plan}</em><span>${a.who}</span></div><div class="w"><strong>0%</strong><small>${S.used}</small></div><div class="bar"><s></s></div><div class="f"><span>${S.inc(a.inc.toFixed(2))}</span><span>${S.avg(a.burn.toFixed(2))}</span></div></div>`};
 // Ten digits: a day of real use passes a billion tokens.
 const digits=Array.from({length:10},(_,k)=>`${k&&(10-k)%3===0?'<em>,</em>':''}<i><span>${[0,1,2,3,4,5,6,7,8,9,0].map(d=>`<b>${d}</b>`).join('')}</span></i>`).join('');
 root.classList.add('hx');root.classList.toggle('hx--capture',capture);root.setAttribute('role','group');root.setAttribute('aria-label',S.label);
 root.innerHTML=`<div class="hx-stage"><div class="hx-canvas" aria-hidden="true"><div class="hx-glow"></div>
  <div class="hx-desk"></div>
  <div class="hx-host"><div class="tb"><i></i><i></i><i></i><b>${S.host}</b></div><div class="bd"><div class="tree">${[70,52,84,60,46,72,58].map(w=>`<i style="width:${w}%"></i>`).join('')}</div><div class="code">${[[38,'#69bda1'],[62,0],[54,0],[30,'#bd8965'],[72,0],[48,'#378d76'],[66,0],[40,0],[58,'#7c86bd'],[34,0],[52,0]].map(([w,c])=>`<i style="width:${w}%;${c?`background:${c}66`:''}"></i>`).join('')}</div></div><div class="term"><b>Claude Code</b> › ${S.term}<br><em>●</em> opus-5-5 · xhigh</div></div>
  <div class="hx-cluster"><div class="hx-body"></div>
   <div class="hx-tells">${S.tells.map((x,k)=>`<span class="tl t${k}" style="--c:${['#e3b796','#72d1b0','#aeb6ee','#e3b45a','#82edc6'][k]}"><i></i>${x}</span>`).join('')}</div>
   <div class="hx-dial tach">${dialSVG('hxt'+ver,TACH,S.tach)}</div><div class="hx-dial speed">${dialSVG('hxs'+ver,SPEED,S.speed)}</div>
   <div class="hx-mid"><div class="pg logo"><svg viewBox="0 0 806.8 759.5"><path d="${MARK}"/></svg><b>1top</b></div>
    <div class="pg sess"><div class="ph"><b>${S.sess}</b><span>${S.span[HOUR]}</span></div>${SESS.map(row).join('')}</div>
    <div class="pg flow"><div class="ph"><b>${S.flow}</b><span class="fs"></span></div><div class="big"><strong></strong><small>${S.odo}</small></div><div class="bars">${'<i><b></b><b></b><b></b></i>'.repeat(36)}</div><div class="leg">${['claude','codex','glm'].map(k=>`<span style="--c:${TOOL[k][1]}">${TOOL[k][0]}</span>`).join('')}</div></div>
    <div class="pg acct"><div class="ph"><b>${S.acct}</b><span>${S.span[HOUR]}</span></div><div class="cards">${ACCT.map(card).join('')}</div></div></div>
   <div class="hx-gear"><small>${S.gear}</small><div><i class="pill"></i>${S.win6.map(w=>`<span>${w}</span>`).join('')}</div></div>
   <div class="hx-fuel"><small>${S.fuel}</small><div>${ACCT.map(a=>`<span style="--c:${TOOL[a.tool][1]};--l:${TOOL[a.tool][2]}"><i><s></s></i><b>${a.plan}</b></span>`).join('')}</div></div>
   <div class="hx-odo"><small></small><div>${digits}</div></div>
  </div>
  <div class="hx-mb"><div class="lf"><svg class="ap" viewBox="0 0 17 20"><path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.3c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3 0 1.8-.8 3.3-.8s2 .8 3.4.8 2.2-1.3 3.1-2.6c1-1.5 1.4-2.9 1.4-3-.1 0-2.7-1-2.7-4.2zM11.5 3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" fill="currentColor"/></svg><b>${S.apps}</b>${S.menus.map(m=>`<span>${m}</span>`).join('')}</div>
   <div class="rt"><span class="st"><i class="press"></i><svg class="one" viewBox="0 0 24 18"><path d="M1.5 9h2.6l1.6-3.2 2.2 8.4 2.4-12.2 2.6 15.4 2.4-12 2.2 7.6 1.6-4h3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><svg class="ic" viewBox="0 0 24 18"><path d="M2 6.5a14.5 14.5 0 0 1 20 0M5.2 9.9a9.8 9.8 0 0 1 13.6 0M8.4 13.2a5.2 5.2 0 0 1 7.2 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.2" r="1.7" fill="currentColor"/></svg><svg class="ic" viewBox="0 0 26 13"><rect x=".8" y=".8" width="21.5" height="11.4" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="2.8" y="2.8" width="15" height="7.4" rx="1.6" fill="currentColor"/><path d="M23.6 4.6v3.8c.9-.3 1.5-1.1 1.5-1.9s-.6-1.6-1.5-1.9z" fill="currentColor"/></svg><time><span>${S.clock[0]}</span>${S.clock[1]}</time></div></div>
  <div class="hx-panel"><img src="${PANEL_IMG(COPY[lang]?lang:'en')}" alt="">${PANEL_HL.map(()=>'<i></i>').join('')}</div>
  <svg class="hx-cursor" viewBox="0 0 26 34"><path d="M3 2v25l6.5-6 4.4 10.2 4.4-1.9-4.3-10H22z" fill="#fff" stroke="#0a0c0f" stroke-width="1.6" stroke-linejoin="round"/></svg>
 </div></div>
 <div class="hx-hud"><div class="hx-cap" aria-hidden="true"><i></i>${S.cap.map(c=>`<span>${c}</span>`).join('')}</div><div class="hx-ch">${S.ch.map(c=>`<button type="button" aria-label="${S.show}: ${c}">${c}<i><b></b></i></button>`).join('')}</div></div>`;

 const q=s=>root.querySelector(s),qa=s=>[...root.querySelectorAll(s)];
 const dial=el=>({el,val:el.querySelector('.val'),nd:el.querySelector('.nd'),ticks:[...el.querySelectorAll('.tk line')],lb:el.querySelector('.lb'),read:el.querySelector('.hx-read b'),unit:el.querySelector('.hx-read small'),sub:el.querySelector('.hx-sub'),subDot:el.querySelector('.hx-sub i'),subTxt:el.querySelector('.hx-sub span'),dl:el.querySelector('.hx-dl')});
 const E={stage:q('.hx-stage'),canvas:q('.hx-canvas'),glow:q('.hx-glow'),desk:q('.hx-desk'),host:q('.hx-host'),cluster:q('.hx-cluster'),body:q('.hx-body'),tells:qa('.hx-tells .tl'),tellBox:q('.hx-tells'),
  tach:dial(q('.hx-dial.tach')),speed:dial(q('.hx-dial.speed')),mid:q('.hx-mid'),pages:Object.fromEntries(qa('.hx-mid .pg').map(p=>[p.classList[1],p])),
  rows:qa('.hx-row').map(r=>({el:r,mv:r.querySelector('.mv'),mn:r.querySelector('.mn')})),fs:q('.flow .fs'),fbig:q('.flow .big strong'),bars:qa('.flow .bars i').map(b=>[...b.children]),
  cards:qa('.hx-card').map(c=>({el:c,pct:c.querySelector('strong'),bar:c.querySelector('.bar s')})),
  gear:q('.hx-gear'),pill:q('.hx-gear .pill'),gears:qa('.hx-gear span'),fuel:q('.hx-fuel'),fuels:qa('.hx-fuel span').map(s=>({el:s,f:s.querySelector('s')})),
  odo:q('.hx-odo'),odoL:q('.hx-odo small'),odoD:qa('.hx-odo i').map(i=>i.firstElementChild).reverse(),odoC:qa('.hx-odo i').reverse(),
  mb:q('.hx-mb'),press:q('.hx-mb .press'),icon:q('.hx-mb .one'),iconBox:q('.hx-mb .st'),panel:q('.hx-panel'),phl:qa('.hx-panel i'),cursor:q('.hx-cursor'),
  cap:q('.hx-cap'),capBg:q('.hx-cap>i'),caps:qa('.hx-cap span'),chs:qa('.hx-ch button'),fills:qa('.hx-ch b')};
 E.speed.unit.textContent=S.speedU;E.tach.unit.textContent=S.tachU;

 const css=(el,p,v)=>{const c=el._c||(el._c={});if(c[p]!==v){el.style[p]=v;c[p]=v}};
 const put=(el,x,y,s=1,o=1)=>{const op=o<.002?0:o>.998?1:+o.toFixed(3);css(el,'opacity',String(op));css(el,'visibility',op?'visible':'hidden');if(op)css(el,'transform',`translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)${s!==1?` scale(${s.toFixed(4)})`:''}`)};
 const txt=(el,s)=>{if(el._x!==s){el.textContent=s;el._x=s}};
 let L=WIDE,now=0,capR=[],ix=0;

 function applyLayout(n){
  L=n;const {W,H}=L;root.classList.toggle('hx--narrow',!!L.n);
  for(const el of [E.canvas,E.desk])css(el,'width',W+'px'),css(el,'height',H+'px');
  const [bx,by,bw,bh]=L.body;css(E.body,'left',bx+'px');css(E.body,'top',by+'px');css(E.body,'width',bw+'px');css(E.body,'height',bh+'px');
  css(E.mb,'width',W+'px');css(E.mb,'height',L.mbh+'px');
  const [,,pw,ph]=L.panel(PANEL_ASPECT,0);css(E.panel,'width',pw+'px');css(E.panel,'height',ph+'px');
  PANEL_HL.forEach(([x,y,w,h],k)=>{const b=E.phl[k];css(b,'left',x*100+'%');css(b,'top',y*100+'%');css(b,'width',w*100+'%');css(b,'height',h*100+'%')});
  if(L.host){css(E.host,'width',L.host[2]+'px');css(E.host,'height',L.host[3]+'px')}
  fit();
 }
 function fit(){const w=root.clientWidth||L.W;css(E.canvas,'transform','none');const c=E.canvas.getBoundingClientRect(),r=E.iconBox.getBoundingClientRect();ix=r.width?r.left+r.width/2-c.left:L.W-200;css(E.canvas,'transform',`scale(${(w/L.W).toFixed(5)})`);css(E.stage,'aspectRatio',`${L.W}/${L.H}`);if(capture)css(q('.hx-hud'),'zoom',(w/L.W).toFixed(4));measureCaps()}
 function measureCaps(){const w=E.cap.getBoundingClientRect().width;capR=w?E.caps.map(c=>c.getBoundingClientRect().width/w):[]}

 // Dial state: needle value, lit ticks (the ignition sweep and power-down), value arc and readout.
 function drawDial(D,g,v,lit,color,read,sub,subColor){
  const f=clamp(v/g.max);css(D.nd,'transform',`rotate(${(135+270*f).toFixed(2)}deg)`);D.val.setAttribute('stroke-dasharray',`${(270*f).toFixed(2)} 360`);css(D.val,'stroke',color);css(D.nd,'fill',color);
  const n=D.ticks.length-1;D.ticks.forEach((k,i)=>{const on=clamp((lit*(n+4)-i)/4),under=i/n<=f+1e-4;css(k,'opacity',(on*(under?1:.42)).toFixed(3));css(k,'stroke',under?color:'#c9d2d6')});
  css(D.lb,'opacity',lit.toFixed(3));txt(D.read,read);css(D.read.parentNode,'opacity',clamp(lit*1.6-.4).toFixed(3));
  if(sub!==undefined){txt(D.subTxt,sub);css(D.subDot,'background',subColor)}
 }

 function render(t){
  t=((t%T)+T)%T;now=t;const {W,H}=L;
  // Ignition: body warms up, ticks light in a sweep, needles self-test to full scale and settle. Power-down mirrors it.
  const on=Math.min(seg(t,.15,1.25),1-seg(t,26.5,27.5)),warm=Math.min(io3(seg(t,0,.9)),1-io3(seg(t,27.1,28)));
  put(E.glow,W/2,H*.47,1,.35+.65*warm);
  const sweep=t<2.7?Math.min(io3(seg(t,.55,1.35)),1-out3(seg(t,1.5,2.6))):0;

  // Menu bar: the cluster folds into its status icon, the panel opens beneath it, then the cluster unfolds again.
  const fold=io3(seg(t,10.05,10.8))*(1-io3(seg(t,15.15,15.9))),desk=Math.min(io3(seg(t,10,10.6)),1-io3(seg(t,15.35,16)));
  const iy=L.mbh/2,sc=lerp(1,.012,fold);
  put(E.cluster,ix*(1-sc),iy*(1-sc),sc,1-seg(fold,.75,1));
  put(E.desk,0,0,1,desk);put(E.mb,0,lerp(-10,0,desk),1,desk);
  if(L.host){const h=fade(t,10.25,15.7,.5,.4);put(E.host,L.host[0],L.host[1]+(1-h)*12,1,h)}else put(E.host,0,0,1,0);
  const [px,py,pw,ph]=L.panel(PANEL_ASPECT,ix),po=out3(seg(t,11.62,11.86))*(1-io3(seg(t,14.95,15.2)));
  put(E.panel,px,py-10*(1-out3(seg(t,11.62,11.86))),1,po);
  PANEL_HL.forEach((_,k)=>{const a=12.25+k*1.35,o=fade(t,a,a+1.25,.25,.25);css(E.phl[k],'opacity',o.toFixed(3))});
  css(E.press,'opacity',(seg(t,11.5,11.56)*(1-seg(t,14.95,15.1))).toFixed(3));
  css(E.icon,'transform',`scale(${(1+.35*Math.sin(Math.PI*seg(t,10.72,11.05))).toFixed(3)})`);
  const m1=io3(seg(t,10.85,11.45)),m2=io3(seg(t,11.95,12.5)),m3=io3(seg(t,13.4,13.95)),pr=Math.sin(Math.PI*seg(t,11.45,11.6));
  const tg=k=>{const [x,y,w,h]=PANEL_HL[k];return [px+pw*(x+w*.72),py+ph*(y+h*.45)]},[ax,ay]=tg(0),[bx,by]=tg(1);
  let cx=lerp(L.cur[0],ix-4,m1)+40*Math.sin(Math.PI*m1),cy=lerp(L.cur[1],iy-2,m1);cx=lerp(cx,ax,m2);cy=lerp(cy,ay,m2);cx=lerp(cx,bx,m3);cy=lerp(cy,by,m3);
  put(E.cursor,cx,cy,1-.14*pr,out3(seg(t,10.8,11))*(1-seg(t,14.7,15)));

  // Tell-tales: everything lights at ignition, then only live states stay on.
  const [tx,ty]=L.tells;put(E.tellBox,tx,ty,1,1);
  E.tells.forEach((el,k)=>{const test=seg(t,.3+k*.06,.45+k*.06)*(1-seg(t,1.7,2)),live=seg(t,2+k*.08,2.3+k*.08)*(1-seg(t,26.4+k*.05,26.8+k*.05)),blink=k===3?.75+.25*Math.cos(t*4):1;
   css(el,'opacity',(.16+.84*Math.max(test,live*blink)).toFixed(3));el.classList.toggle('lit',Math.max(test,live)>.5)});

  // Speedometer subject and needle.
  const [,kind,idx]=at(t,SUBJ),subj=kind==='s'?SESS[idx]:ACCT[idx],tool=TOOL[subj.tool];
  const keys=SUBJ.map(([k,kd,i])=>[k,(kd==='s'?SESS[i]:ACCT[i]).burn]),live=(a,b)=>.014*Math.sin(t*a)+.008*Math.sin(t*b+1);
  let sv=track(t,keys,.8)+live(2.1,5.3)*on;sv=lerp(sv,SPEED.max,sweep);sv*=t>26.4?1-io3(seg(t,26.4,27.4)):1;sv*=t<1.4?seg(t,.5,.55):1;
  const subLabel=kind==='s'?`${subj.id} · ${tool[0]}`:`${tool[0]} · ${subj.plan}`;
  const [sx,sy,ss]=L.speed;put(E.speed.el,sx-170*ss,sy-170*ss,ss,.4+.6*warm);
  drawDial(E.speed,SPEED,sv,on,tool[2],t<2.4?(sv).toFixed(2):Math.max(0,sv).toFixed(2),subLabel,tool[1]);
  css(E.speed.sub,'opacity',(on*seg(t,2.2,2.6)).toFixed(3));
  // Tachometer: every tool's tokens in the window, per hour; it follows the gear like the odometer.
  let tv=Math.exp(track(t,GEAR.map(([k,i])=>[k,Math.log(TOTAL[i]/1000/SPAN[i])]),.8,io3))*(1+.012*Math.sin(t*2.3))*seg(t,2.3,2.9);tv=Math.max(tv,lerp(0,TACH.max,sweep));tv*=t>26.4?1-io3(seg(t,26.4,27.4)):1;
  const [hx,hy,hs]=L.tach;put(E.tach.el,hx-170*hs,hy-170*hs,hs,.4+.6*warm);
  drawDial(E.tach,TACH,tv,on,'#82edc6',tv.toFixed(1));css(E.tach.sub,'opacity','0');

  // Centre display pages.
  const [mx,my,ms]=L.mid;put(E.mid,mx,my,ms,1);
  const pv={logo:fade(t,.45,2.55,.45,.35),sess:fade(t,2.55,10.85,.45,.05),flow:fade(t,15.2,20.65,.05,.3),acct:fade(t,20.6,26.6,.45,.4)};
  for(const k in pv)put(E.pages[k],0,(1-out3(Math.min(1,pv[k]*1.4)))*8,1,pv[k]);
  if(pv.sess)E.rows.forEach((r,i)=>{const s=SESS[i],hi=kind==='s'&&idx===i?1:0,f=clamp((s.burn+live(2.7+i,4.1+i)*1.5)/2)*seg(t,2.8+i*.12,3.5+i*.12);r.el.classList.toggle('on',!!hi);
   r.mv.setAttribute('stroke-dasharray',`${(100*f).toFixed(1)} 100`);css(r.mn,'transform',`rotate(${(-90+180*f).toFixed(1)}deg)`);put(r.el,0,i*64+(1-out3(seg(t,2.7+i*.1,3.3+i*.1)))*10,1,out3(seg(t,2.7+i*.1,3.3+i*.1)))});
  // The gear: pill slides between periods; the odometer rolls to the period total.
  const gi=track(t,GEAR,.5,io3),gk=at(t,GEAR)[1],tot=Math.exp(track(t,GEAR.map(([k,i])=>[k,Math.log(TOTAL[i])]),.8,io3));
  const [gx,gy]=L.gear;put(E.gear,gx,gy,1,on);css(E.pill,'transform',`translateX(${(gi*100).toFixed(2)}%)`);E.gears.forEach((s,k)=>s.classList.toggle('on',k===gk));txt(E.gears[CUSTOM],gk===CUSTOM?S.cust:S.win6[CUSTOM]);
  if(pv.flow){txt(E.fs,S.span[gk]);txt(E.fbig,fmtM(tot));const a=at(t,GEAR),pa=GEAR[Math.max(0,GEAR.indexOf(a)-1)][1];
   E.bars.forEach((b,j)=>{const p=io3(seg(t,a[0]+j*.012,a[0]+.45+j*.012)),grow=out3(seg(t,15.6+j*.015,16.1+j*.015));b.forEach((x,k)=>css(x,'height',(92*grow*lerp(BARS[pa][j][k],BARS[gk][j][k],p)).toFixed(2)+'%'))})}
  if(pv.acct)E.cards.forEach((c,i)=>{const a=ACCT[i],g=out3(seg(t,20.75+i*.1,21.75+i*.1));txt(c.pct,Math.round(a.week*g)+'%');css(c.bar,'transform',`scaleX(${(a.week/100*g).toFixed(4)})`);c.el.classList.toggle('on',kind==='a'&&idx===i)});
  if(L.odo){const [ox,oy]=L.odo;put(E.odo,ox,oy,1,on);txt(E.odoL,`${S.odo} · ${S.span[gk]}`);
   const n=tot*1000+TOTAL[HOUR]*1000/3600*Math.max(0,t-2.6)*(t<16||t>20.5?1:0);
   E.odoD.forEach((d,k)=>{const p=10**k,lower=(n%p)/p,pos=Math.floor(n/p)%10+(k?clamp((lower-1+1/p)*p):0);css(d,'transform',`translateY(${(-pos*9.0909).toFixed(3)}%)`);E.odoC[k].classList.toggle('lead',p>n)})}else put(E.odo,0,0,1,0);
  if(L.fuel){const [fx,fy]=L.fuel;put(E.fuel,fx,fy,1,on);E.fuels.forEach((f,i)=>{const g=out3(seg(t,1.1+i*.12,2.2+i*.12))*(1-io3(seg(t,26.5,27.3)));css(f.f,'transform',`scaleY(${((100-ACCT[i].week)/100*g).toFixed(4)})`);f.el.classList.toggle('on',kind==='a'&&idx===i)})}else put(E.fuel,0,0,1,0);
  put(E.body,0,0,1,.55+.45*warm);

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
 const cro=new ResizeObserver(()=>{fit();render(now)});E.caps.forEach(c=>cro.observe(c));
 const io=new IntersectionObserver(es=>{visible=es[0].isIntersecting;sync()},{threshold:.05});
 const mo=host&&new MutationObserver(()=>{pageHold=host.classList.contains('motion-paused');sync()});
 const motion=()=>{if(reduce.matches){clock=REP[0];render(clock)}sync()};
 applyLayout((root.clientWidth||1280)<560?NARROW:WIDE);
 if(!capture){ro.observe(root);io.observe(root);if(mo){pageHold=host.classList.contains('motion-paused');mo.observe(host,{attributes:true,attributeFilter:['class']})}reduce.addEventListener('change',motion);document.addEventListener('visibilitychange',sync)}
 clock=reduce.matches&&!capture?REP[0]:0;render(clock);sync();
 const stop=()=>{if(raf)cancelAnimationFrame(raf);raf=0;ro.disconnect();cro.disconnect();io.disconnect();mo?.disconnect();reduce.removeEventListener('change',motion);document.removeEventListener('visibilitychange',sync)};
 return Object.assign(stop,{render,duration:T,layout:n=>{applyLayout(n?NARROW:WIDE);render(now)}});
}
