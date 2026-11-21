/* 62–72 (v4.0.0)
   원칙
   - 모든 계기판은 정면에서 본 모습으로, 하우징은 좌우 대칭으로 그립니다.
   - 깊이는 하우징 → 안쪽으로 들어간 면 → 계기 테두리 → 다이얼면 순서로 만듭니다.
   - 바늘 계기는 눈금 숫자를 눈금 바깥에 두고, 바늘은 눈금 안쪽 끝까지 닿습니다.
   - 글자 크기: 주 값(크게) · 보조 값 · 라벨 13–14px · 기간 기어 13–15px.
   - 차 실내 소품(운전대, 송풍구, 대시보드 면, 하늘)은 그리지 않습니다. */
(function(O){
 'use strict';
 let K=0;

 // 화면형 계기: 검은 베젤(위 가장자리 빛선) → 안쪽 검은 턱 → 화면
 function screen(H,x,y,w,h,r,o={}){
  const n='sc'+(K++),b=o.bezel??14,ir=Math.max(4,r-b);
  const bez=H.lin(n+'b',[[0,o.bezelTop||'#3a3d42'],[.06,'#17181b'],[1,'#08090a']]);
  const face=H.lin(n+'f',o.face||[[0,'#0c1a2e'],[1,'#060c16']]);
  let s=H.rect(x,y,w,h,{r,fill:bez,filter:H.shadow(n+'d',8,16,.6)});
  s+=H.rect(x+.5,y+.5,w-1,h-1,{r,stroke:'#fff',sw:1,op:.1});
  s+=H.rect(x+b-1.5,y+b-1.5,w-2*b+3,h-2*b+3,{r:ir+1.5,fill:'#000'});
  s+=H.rect(x+b,y+b,w-2*b,h-2*b,{r:ir,fill:face});
  if(o.sheen)s+=H.rect(x+b,y+b,w-2*b,h-2*b,{r:ir,fill:H.lin(n+'s',[[0,'#fff',o.sheen],[.4,'#fff',0],[1,'#fff',0]])});
  return s;
 }
 // 바늘 계기: 눈금 안쪽, 숫자 바깥. 가로 방향 숫자는 글자 폭만큼 더 띄웁니다.
 function outerDial(H,cx,cy,o){
  const a0=o.a0??-130,sw=o.sweep??260,r=o.r,n=o.labels.length-1,size=o.size||18;
  let s=H.ticks(cx,cy,r,{a0,sweep:sw,n,minor:o.minor??4,len:o.len??16,mlen:o.mlen??8,w:o.w??3,mw:o.mw??1.4,color:o.tick,mcolor:o.mtick||o.tick,red:o.red,redColor:o.redColor});
  o.labels.forEach((t,i)=>{if(!t)return;const f=i/n,a=a0+sw*f,half=t.length*size*.3;
   const rr=r+(o.gap??22)+Math.abs(Math.sin(a*Math.PI/180))*Math.max(0,half-size*.35);
   const [x,y]=H.pt(cx,cy,rr,a);const red=o.red!=null&&f>=o.red;
   s+=H.text(x,y,t,{size,fill:red?o.redColor:(o.num||o.tick),font:o.font||'helv',weight:o.weight,base:'central'});});
  return s;
 }

 // 62 · BYD Seal — 둥근 가로 화면, 양쪽 원형 링, 가운데 상태, 아래 남은 한도 띠
 O.theme({id:'62',name:'블루 오션 와이드',about:'독립된 가로 화면 양쪽에 파란 원형 링을 두고, 가운데에 기간과 토큰 흐름, 세션, 남은 한도 띠를 한 축에 모았습니다.',draw(H,d){
  const A='#5cb8ff',TXT='#eaf2fa',SUB='#8fb0cf',TRK='#173457';
  let s=H.rect(0,0,1280,480,{fill:H.lin('cab',[[0,'#1b1d21'],[1,'#0a0b0d']])});
  s+=screen(H,56,32,1168,416,36,{face:[[0,'#0f2c4e'],[.55,'#0a1c37'],[1,'#061124']],bezel:16,bezelTop:'#565a60'});
  const cy=236,R=142;
  const ring=(cx,f,val,unit,lab,labels,burn)=>{const n='rg'+cx;
   let o=H.circle(cx,cy,R+14,{stroke:'#2f5d90',sw:1.2,op:.7});
   o+=H.circle(cx,cy,R,{fill:H.rad2(n,[[0,'#134274'],[.7,'#0c2749'],[1,'#071631']])});
   o+=H.band(cx,cy,R-14,R-4,-135,135,{fill:TRK});
   if(burn)o+=H.band(cx,cy,R-14,R-4,-135+270*.6,135,{fill:'#4a2036'});
   o+=H.band(cx,cy,R-14,R-4,-135,-135+270*f,{fill:A});
   if(burn&&d.cruise!=null){const a=-135+270*H.clamp(d.cruise/d.burnMax),[x1,y1]=H.pt(cx,cy,R-18,a),[x2,y2]=H.pt(cx,cy,R,a);o+=H.line(x1,y1,x2,y2,{stroke:'#fff',sw:3});}
   o+=H.ticks(cx,cy,R-22,{a0:-135,sweep:270,n:labels.length-1,minor:4,len:8,mlen:4,w:2,mw:1,color:'#9cc1e6',mcolor:'#3c6794'});
   o+=H.nums(cx,cy,R-44,labels,{a0:-135,sweep:270,size:13,fill:SUB});
   o+=H.text(cx,cy+14,val,{size:60,fill:TXT,weight:300,font:'helv'});
   o+=H.text(cx,cy+48,unit,{size:15,fill:TXT})+H.text(cx,cy+70,lab,{size:13,fill:SUB});
   return H.cl('gauge',burn?'burn':'rate',o);};
  s+=ring(252,H.frac.burn(d),H.fmt.burn(d.burn),'%/시간','소진 속도',H.burnScale(d,5),true);
  s+=ring(1028,H.frac.rate(d),H.fmt.m(d.rate),'M tokens/시간','토큰 속도',H.rateScale(d,5),false);
  // 위 상태줄: 가운데 축에 대칭 (기간 이름은 한국어로, 기어 줄은 아래 기준선에)
  s+=H.text(500,94,d.clock,{size:17,fill:TXT})+H.text(640,95,d.periodLabel,{size:22,fill:'#fff',weight:600})+H.text(780,94,`CPU ${Math.round(d.cpu)}%`,{size:17,fill:TXT});
  s+=H.lamps(580,132,d,{size:18,gap:40,off:'#2a4466'});
  // 토큰 흐름
  s+=H.histo(472,158,336,62,d.flow,{fill:(i)=>i===(d.flow||[]).length-1?A:'#26548a',gap:3,r:1});
  s+=H.line(472,224,808,224,{stroke:'#2d5b8f',sw:1});
  // 세션 세 칸 (같은 크기, 같은 기준선)
  s+=H.text(540,276,String(d.sessions.waiting),{size:30,fill:'#f2b233',weight:300})+H.text(540,298,'응답 대기',{size:13,fill:SUB});
  s+=H.rect(598,244,84,66,{r:14,fill:'#0b1a30',stroke:'#6f8fb3',sw:1.5})+H.text(640,276,String(d.sessions.working),{size:30,fill:'#fff',weight:300})+H.text(640,298,'작업 중',{size:13,fill:SUB});
  s+=H.text(740,276,String(d.sessions.total),{size:30,fill:TXT,weight:300})+H.text(740,298,'전체 세션',{size:13,fill:SUB});
  // 남은 한도 띠
  s+=H.cl('gauge','fuel',H.rect(472,330,336,6,{r:3,fill:TRK})+H.rect(472,330,336*H.frac.min(d),6,{r:3,fill:A})
   +H.text(472,362,`${Math.round(d.minLeft)}%`,{size:18,fill:'#fff',anchor:'start'})+H.text(640,362,'남은 한도',{size:13,fill:SUB})+H.text(808,362,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:15,fill:'#fff',anchor:'end'}));
  // 아래 기준선: 왼쪽 1top, 가운데 기간 기어, 오른쪽 주행계
  s+=H.brand(96,412,{fill:'#5f83a8',anchor:'start'});
  s+=H.gear(640,408,d,{gap:48,width:336,size:15,on:'#fff',off:'#6f93ba'});
  s+=H.text(1184,412,`${H.fmt.odo(d.odo)} M`,{size:13,fill:SUB,anchor:'end'});
  s+=H.cl('trip','',H.text(1184,390,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:SUB,anchor:'end'}));
  return s;}});

 // 63 · NIO ET7 — 낮고 긴 독립 화면, 왼쪽 큰 숫자, 가운데 청록 흐름, 오른쪽 값 목록
 O.theme({id:'63',name:'롱 슬레이트',about:'낮고 긴 검은 화면을 세 칸으로 나눠 왼쪽 큰 숫자, 가운데 청록 흐름과 기간, 오른쪽 값 목록을 같은 기준선에 놓았습니다.',draw(H,d){
  const A='#4fe0c8',TXT='#e8eef2',SUB='#9aa6ad',DIM='#5f666c',RULE='#22272b';
  let s=H.rect(0,0,1280,480,{fill:H.lin('cab',[[0,'#24272a'],[1,'#0e0f10']])});
  s+=screen(H,40,58,1200,364,26,{face:[[0,'#0b0d0f'],[1,'#050607']],bezelTop:'#8b9095',bezel:14});
  // 세 칸의 공통 기준선: 위 줄 120 · 아래 줄 382. 칸 가장자리: 96–336 · 440–840 · 944–1184
  const TOP=120,BOT=382;
  s+=H.brand(96,TOP,{fill:DIM,anchor:'start'});
  s+=H.text(640,TOP,d.periodLabel,{size:17,fill:TXT});
  s+=H.lamps(1184-9-3*34,TOP-5,d,{size:18,gap:34,off:'#2a2f33'});
  s+=H.line(96,TOP+22,1184,TOP+22,{stroke:RULE});
  // 왼쪽: 큰 숫자
  s+=H.cl('gauge','rate',H.text(216,252,H.fmt.m(d.rate),{size:100,fill:'#fff',weight:200,font:'helv'})+H.text(216,282,'M tokens/시간',{size:15,fill:SUB}));
  s+=H.line(96,304,336,304,{stroke:'#30363b'});
  s+=H.cl('gauge','burn',H.text(96,336,'소진 속도',{size:14,fill:SUB,anchor:'start'})+H.text(336,336,`${H.fmt.burn(d.burn)} %/시간`,{size:18,fill:TXT,anchor:'end'}));
  s+=H.cl('gauge','fuel',H.rect(96,BOT-12,30,14,{r:3,stroke:'#cfd6da',sw:1.4})+H.rect(99,BOT-9,24*H.frac.min(d),8,{fill:A,r:1})+H.rect(127,BOT-8,3,6,{fill:'#cfd6da',r:1})
   +H.text(140,BOT,`남은 ${Math.round(d.minLeft)}%`,{size:15,fill:TXT,anchor:'start'})+H.text(336,BOT,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:SUB,anchor:'end'}));
  // 가운데: 기간 합계와 흐름
  s+=H.text(440,174,`기간 합계 ${H.fmt.m(d.tokens)}M tokens`,{size:14,fill:SUB,anchor:'start'})+H.text(840,174,`작업 중 세션 ${d.sessions.working}`,{size:14,fill:SUB,anchor:'end'});
  const F=(d.flow&&d.flow.length>1?d.flow:Array(24).fill(0)).map(v=>Math.max(0,+v||0)),FM=Math.max(...F)||1;
  const P=F.map((v,i)=>[440+i*400/(F.length-1),326-v/FM*125]);
  const line='M'+P.map(p=>p.map(H.r2).join(' ')).join('L');
  s+=H.path(line+'L840 326L440 326Z',{fill:H.lin('tq',[[0,'#1fa89a',.8],[1,'#0b4e48',.1]])});
  s+=H.path(line,{stroke:A,sw:2,join:'round'});
  s+=H.line(440,326,840,326,{stroke:'#2a3a38',sw:1});
  s+=H.gear(640,BOT-5,d,{gap:64,width:400,size:15,on:A,off:'#6f7a80'});
  // 오른쪽 값 목록: 네 줄, 줄마다 가는 구분선
  const rows=[['엔진 온도',Math.round(d.heat)+'°'],['CPU',Math.round(d.cpu)+'%'],['메모리',Math.round(d.mem)+'%'],['세션',`${d.sessions.working} / ${d.sessions.total}`]];
  rows.forEach(([k,v],i)=>{const y=184+i*44;const row=H.text(944,y,k,{size:14,fill:SUB,anchor:'start'})+H.text(1184,y,v,{size:18,fill:TXT,anchor:'end'});s+=i?row:H.cl('gauge','heat',row);if(i<3)s+=H.line(944,y+20,1184,y+20,{stroke:RULE});});
  s+=H.cl('trip','',H.text(944,BOT,`트립 ${H.fmt.trip(d.trip)}M`,{size:15,fill:TXT,anchor:'start'}));
  s+=H.text(1184,BOT,d.clock,{size:16,fill:TXT,anchor:'end'});
  return s;}});

 // 64 · Lucid Air — 얇고 넓은 곡면 화면, 가운데 원과 큰 가는 숫자, 양옆 대칭 정보
 O.theme({id:'64',name:'글래스 콕핏',about:'얇고 넓은 곡면 화면 가운데에 가는 원과 큰 숫자를 두고, 양옆 정보 칸을 가운데 축에 대칭으로 놓았습니다.',draw(H,d){
  const TXT='#eef1f3',SUB='#99a2aa',DIM='#5d656d',RULE='#2c3238',ACC='#e07a5a';
  let s=H.rect(0,0,1280,480,{fill:H.lin('cab',[[0,'#1a1c1f'],[1,'#08090a']])});
  // 하우징 → 검은 턱 → 화면 (위아래로 캔버스를 채우는 얇은 곡면)
  s+=H.housing('M50 96 Q640 58 1230 96 L1212 438 Q640 474 68 438Z',{top:'#2a2e33',bottom:'#0b0d10',rim:.14});
  s+=H.path('M66 110 Q640 72 1214 110 L1198 420 Q640 446 82 420Z',{fill:'#000'});
  s+=H.path('M69 113 Q640 75 1211 113 L1195 417 Q640 443 85 417Z',{fill:H.lin('scr',[[0,'#13161a'],[.65,'#0b0d10'],[1,'#0f141a']])});
  s+=H.path('M69 113 Q640 75 1211 113',{stroke:'#000',sw:6,op:.5});
  // 가운데 원
  const cx=640,cy=250,R=132,f=H.frac.rate(d),a=-120+240*f;
  let g='';
  g+=H.circle(cx,cy,R+10,{fill:'#000',op:.35,filter:H.shadow('ds',4,10,.6)});
  g+=H.face(cx,cy,R+2,{fill:'#0b0c0e',center:'#121417',edge:'#050607'});
  g+=H.arc(cx,cy,R,-120,120,{stroke:'#252a30',sw:3});
  g+=H.arc(cx,cy,R,-120,a,{stroke:'#aeb6be',sw:3});
  g+=H.ticks(cx,cy,R-7,{a0:-120,sweep:240,n:8,minor:4,len:12,mlen:5,w:2,mw:1.2,color:'#828b93',mcolor:'#3a4148'});
  { const [x1,y1]=H.pt(cx,cy,R-1,a),[x2,y2]=H.pt(cx,cy,R-40,a);
    g+=H.line(x1+1.5,y1+2.5,x2+1.5,y2+2.5,{stroke:'#000',sw:3,cap:'round',op:.5})+H.line(x1,y1,x2,y2,{stroke:'#fff',sw:3,cap:'round'}); }
  g+=H.text(cx,cy+24,H.fmt.m(d.rate),{size:82,fill:'#f4f6f8',weight:200,font:'helv'});
  g+=H.text(cx,cy+56,'M tokens/시간',{size:14,fill:ACC});
  s+=H.cl('gauge','rate',g);
  // 적정 표지 (원본의 제한속도 표지 자리, 원 오른쪽 중심축)
  if(d.cruise!=null)s+=H.rect(cx+R+16,cy-28,48,56,{r:6,fill:'#e8eaec'})+H.rect(cx+R+19,cy-25,42,50,{r:4,stroke:'#111',sw:1.2})+H.text(cx+R+40,cy-6,'적정',{size:13,fill:'#111'})+H.text(cx+R+40,cy+16,H.fmt.burn(d.cruise),{size:18,fill:'#111',weight:600});
  // 원 아래 남은 한도 (원본의 배터리 자리)
  s+=H.cl('gauge','fuel',H.rect(604,392,28,13,{r:2.5,stroke:'#dfe3e6',sw:1.3})+H.rect(606.5,394.5,23*H.frac.min(d),8,{fill:'#dfe3e6',r:1})+H.rect(633,395.5,2.5,6,{fill:'#dfe3e6',r:1})
   +H.text(644,404,`${Math.round(d.minLeft)}%`,{size:15,fill:TXT,anchor:'start'}));
  // 양옆 정보 칸: 축 300 · 980, 폭 240, 원의 중심축(cy)을 기준으로 위아래 대칭
  // hook: [종류, 값] — 제목과 첫 줄을 함께 감쌀 때는 행 0에 head:true
  const panel=(x,title,rows,foot,head)=>{
   let t=H.text(x,cy-74,title,{size:16,fill:TXT,weight:600}),o='';
   o+=H.line(x-120,cy-58,x+120,cy-58,{stroke:'#4a525a',sw:1});
   rows.forEach(([k,v,big,hook],i)=>{const y=cy-20+i*42;
    let r=H.text(x-120,y,k,{size:14,fill:SUB,anchor:'start'})+H.text(x+120,y+(big?2:0),v,{size:big?24:17,fill:'#fff',weight:big?300:400,anchor:'end',font:big?'helv':'ui'});
    if(i===0&&head){r=t+r;t='';}
    o+=hook?H.cl(hook[0],hook[1],r):r;
    o+=H.line(x-120,y+16,x+120,y+16,{stroke:RULE,sw:1});});
   return t+o+foot;};
  s+=panel(300,'트립 A',[['토큰',H.fmt.trip(d.trip)+'M',1,['trip','']],['소진 속도',H.fmt.burn(d.burn)+' %/시간',0,['gauge','burn']],['주행계',H.fmt.odo(d.odo)+' M']],
   H.lamps(300-1.5*40,cy+120,d,{size:18,gap:40,off:'#2f353b'}),true);
  s+=panel(980,'남은 한도',[['작업 가능',H.fmt.hours(d.rangeH),1],['작업 중 세션',`${d.sessions.working} / ${d.sessions.total}`],['시각',d.clock]],
   H.gear(980,cy+120,d,{gap:40,width:240,size:15,on:'#fff',off:'#6a737b'}));
  // 1top: 아래 턱 가운데 (원의 중심축)
  s+=H.brand(cx,449,{size:12,fill:'#7a828a'});
  return s;}});

 // 65 · Rivian R1T — 밝은 화면, 왼쪽 차선, 큰 숫자, 세로 기어, 오른쪽 가는 호
 O.theme({id:'65',name:'트레일 라이트',about:'옅은 녹회색 화면에 차선과 큰 숫자, 세로 기어, 오른쪽 가는 호를 두어 밝고 간결하게 만들었습니다.',draw(H,d){
  const A='#2f7ed8',INK='#3a3b3d',SUB='#5d6062';
  let s=H.rect(0,0,1280,480,{fill:H.lin('cab',[[0,'#26282a'],[1,'#0e0f10']])});
  s+=screen(H,72,40,1136,400,36,{face:[[0,'#e8efe6'],[1,'#ccd8cb']],bezelTop:'#46484a',bezel:16,sheen:.2});
  // 차선 (축 330에 대칭)
  s+=H.path('M242 380 C266 280 287 160 300 56',{stroke:'#bccabb',sw:3})+H.path('M418 380 C394 280 373 160 360 56',{stroke:'#bccabb',sw:3});
  // 차선 안 응답 대기 표시
  s+=H.circle(330,290,15,{fill:'#5a89d6'})+H.text(330,295,String(d.sessions.waiting),{size:15,fill:'#fff',weight:600});
  s+=H.text(330,330,'응답 대기',{size:13,fill:SUB});
  // 큰 숫자
  s+=H.cl('gauge','rate',H.text(740,270,H.fmt.m(d.rate),{size:132,fill:INK,weight:300,font:'helv'})+H.text(740,308,'M tokens/시간',{size:15,fill:SUB}));
  // 세로 기어: 숫자 높이 가운데에 맞춤. 기어가 늘면 152–292 칸 안에서 줄 간격을 줄입니다
  { const n=d.gears.length,step=n>1?Math.min(28,140/(n-1)):0;
    d.gears.forEach((g,i)=>{const on=g===d.period;s+=H.cl('period',g,H.text(904,152+i*step,g,{size:on?18:14,fill:on?'#1f2022':'#7d807e',weight:on?700:400,anchor:'start',base:'central'}));}); }
  // 오른쪽 호 = 소진 속도
  const ax=740,ay=230,AR=320,bf=H.frac.burn(d);
  s+=H.cl('gauge','burn',H.arc(ax,ay,AR,64,116,{stroke:'#b3beb3',sw:4})+H.arc(ax,ay,AR,116-52*bf,116,{stroke:A,sw:7,cap:'round'})
   +H.text(1124,222,H.fmt.burn(d.burn),{size:26,fill:A,weight:600})+H.text(1124,244,'%/시간',{size:13,fill:SUB})+H.text(1124,262,'소진 속도',{size:13,fill:SUB}));
  // 아래 기준선
  s+=H.brand(112,92,{fill:'#7a7d7a',anchor:'start'});
  s+=H.text(112,404,`${H.fmt.odo(d.odo)} M`,{size:13,fill:SUB,anchor:'start'})+H.cl('trip','',H.text(196,404,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:SUB,anchor:'start'}));
  s+=H.lamps(689,399,d,{size:16,gap:34,off:'#a6b0a6'});
  s+=H.cl('gauge','fuel',H.text(1104,404,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:13,fill:INK,anchor:'end'})
   +H.rect(1116,392,56,16,{r:8,stroke:'#555',sw:1.5})+H.rect(1119,395,50*H.frac.min(d),10,{r:5,fill:A}));
  return s;}});

 // 66 · Nissan 300ZX Z31 — 녹색 형광 계기판 + 오른쪽 둥근 녹색 계기 둘과 세션 창
 O.theme({id:'66',name:'제트 디지털',about:'모서리를 깎은 녹색 형광 계기판에 숫자 칸과 오르는 막대, 붉은 곡선, 기간 창을 두고, 오른쪽에 둥근 녹색 계기 둘을 같은 높이에 놓았습니다.',draw(H,d){
  const gl=H.glow('g',2.2);const G='#4cff7a',DIM='#0e2414',SUBG='#3fb860';
  let s=H.rect(0,0,1280,480,{fill:H.lin('dash',[[0,'#2a2c2e'],[1,'#131415']])});
  // 계기 하우징
  s+=H.housing('M32 56 H752 L800 104 V424 H32Z',{top:'#202225',bottom:'#0c0d0e',rim:.1});
  s+=H.path('M48 72 H744 L784 112 V408 H48Z',{fill:'#030604',stroke:'#000',sw:2});
  // 소진 칸
  { let o=H.rect(72,112,260,56,{fill:'none',stroke:G,sw:1.4,op:.8});
    o+=H.seg(92,122,H.fmt.burn(d.burn),36,{fill:G,dim:DIM,filter:gl});
    o+=H.text(316,136,'%/시간',{size:13,fill:G,anchor:'end'})+H.text(316,158,'소진 속도',{size:13,fill:G,anchor:'end'});
    o+=H.bars(72,180,260,7,H.frac.burn(d),{n:40,gap:1.5,fill:G,off:'#0f2016'});
    const bl=H.burnScale(d,5);bl.forEach((v,i)=>o+=H.text(72+i*260/(bl.length-1),206,v,{size:13,fill:SUBG}));
    s+=H.cl('gauge','burn',o); }
  // 기간 기어 줄: 위 가장자리 빈 띠
  s+=H.gear(316,92,d,{gap:56,width:488,size:15,on:G,off:SUBG});
  // 시각 칸
  s+=H.rect(356,112,204,56,{fill:'none',stroke:G,sw:1.4,op:.45});
  s+=H.seg(376,126,d.clock.replace(':',''),28,{fill:G,dim:DIM,filter:gl});
  s+=H.text(544,158,'시각',{size:13,fill:G,anchor:'end'});
  // 토큰 속도: 녹색 막대 + 막대 위를 지나는 붉은 곡선
  let rg=H.rect(72,236,488,140,{fill:'none',stroke:G,sw:1,op:.45});
  rg+=H.seg(92,250,H.fmt.m(d.rate),30,{fill:G,dim:DIM,filter:gl});
  rg+=H.text(544,270,'토큰 속도 · M tokens/시간',{size:13,fill:G,anchor:'end'});
  const bx=92,bw=452,by=300,bh=62,n=44,step=bw/n;
  let curve='';for(let i=0;i<n;i++){const x=bx+i*step+step/2,top=by+bh-bh*(.18+.82*i/(n-1));curve+=(i?'L':'M')+x.toFixed(1)+' '+(top-8).toFixed(1);}
  rg+=H.path(curve,{stroke:'#ff3b2f',sw:2.2,op:.9});
  rg+=H.bars(bx,by,bw,bh,H.frac.rate(d),{n,gap:2.5,fill:G,off:'#0f2016',rise:[.18,1]});
  const rl=H.rateScale(d,10);rl.forEach((v,i)=>{const f=i/(rl.length-1);rg+=H.text(bx+f*bw,398,v,{size:13,fill:f>=.85?'#ff4a3a':SUBG});});
  s+=H.cl('gauge','rate',rg);
  // 오른쪽 기간 창과 경고등 (축 668)
  s+=H.lamps(608,92,d,{size:20,gap:40,colors:{waiting:G,reconnect:G,empty:'#ff4a3a',late:G},off:'#1a2a1e'});
  s+=H.rect(588,112,160,124,{r:4,fill:'#06140a',stroke:G,sw:1.4});
  s+=H.text(668,184,d.period,{size:46,fill:G,font:'din',weight:600,filter:gl});
  s+=H.text(668,218,d.periodLabel,{size:13,fill:G});
  s+=H.cl('gauge','fuel',H.text(668,270,'남은 한도',{size:13,fill:SUBG})+H.text(668,296,`${Math.round(d.minLeft)}%`,{size:20,fill:G,weight:600}));
  s+=H.seg(668,318,H.fmt.odo(d.odo),15,{fill:G,dim:DIM,anchor:'middle'});
  s+=H.text(668,352,'누적 M tokens',{size:13,fill:SUBG});
  s+=H.cl('trip','',H.text(668,372,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:G}));
  s+=H.brand(668,398,{fill:'#5f7a66'});
  // 오른쪽 하우징: 둥근 계기 둘 + 세션 창
  s+=H.housing('M832 56 H1248 V424 H832Z',{top:'#26282b',bottom:'#111214',rim:.1});
  const gcy=158;
  const round=(cx,f,lab,labels,val)=>{let o=H.bezel(cx,gcy,80,10,{tone:'black'})+H.face(cx,gcy,80,{fill:'#030805',edge:'#010301'});
   o+=H.ticks(cx,gcy,54,{a0:-120,sweep:240,n:labels.length-1,minor:1,len:9,mlen:5,w:2,color:G});
   o+=H.nums(cx,gcy,67,labels,{a0:-120,sweep:240,size:13,fill:G});
   o+=H.text(cx,gcy+36,lab,{size:13,fill:G})+H.text(cx,gcy+56,val,{size:14,fill:G,weight:600});
   o+=H.needle(cx,gcy,46,-120+240*f,{style:'baton',w:4,color:'#7bff9a',tail:6,glow:gl})+H.hub(cx,gcy,7,{fill:'#0a2a12',light:'#3a8a4a'});return o;};
  s+=H.cl('gauge','burn',round(936,H.frac.burn(d),'소진 속도',H.burnScale(d,5),H.fmt.burn(d.burn)+' %/시간'));
  s+=H.cl('gauge','heat',round(1144,H.frac.heat(d),'엔진 온도',['C','','','','H'],Math.round(d.heat)+'°'));
  s+=H.rect(856,268,368,132,{r:4,fill:'#040a06',stroke:'#000',sw:2});
  s+=H.sessions(872,292,336,{rows:4,lh:28,size:13,fill:G,dim:SUBG,work:G,wait:'#ffcc33'});
  return s;}});

 // 67 · Toyota AE86 — 각진 사각 패널, 흰 굵은 눈금, 노란 막대 바늘, 아래 가로 소형 계기
 O.theme({id:'67',name:'스트레이트 패널',about:'모서리를 깎은 좌우 대칭 사각 패널 안에 흰 굵은 눈금의 두 계기와 노란 막대 바늘, 양옆 기간·경고등 줄과 가로 소형 계기를 놓았습니다.',draw(H,d){
  const yel='#f1b62a',W='#f3f3ee',SUB='#a9a9a2';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#2c2925'],[1,'#141210']])});
  s+=H.housing('M48 56 H1232 L1252 92 L1232 428 H48 L28 92Z',{top:'#2c2d2f',bottom:'#121314'});
  s+=H.path('M72 80 H1208 L1226 104 L1210 404 H70 L54 104Z',{fill:H.lin('rc',[[0,'#000'],[.12,'#070808'],[1,'#0d0e0f']]),stroke:'#000',sw:2});
  s+=H.path('M70 404 H1210',{stroke:'#fff',sw:1,op:.08});
  const cy=256;
  // 계기: 9시에서 시작해 오른쪽 아래까지 (-90° → 135°)
  const dial=(cx,labels,minor,f,lab,unit,red,size,key)=>{
   let o=outerDial(H,cx,cy,{a0:-90,sweep:225,r:118,labels,minor,len:22,mlen:12,w:5,mw:3,tick:W,red,redColor:'#e0302a',gap:24,size});
   o+=H.text(cx-62,cy+58,lab,{size:15,fill:W})+H.text(cx-62,cy+78,unit,{size:13,fill:SUB});
   o+=H.needle(cx,cy,96,-90+225*f,{style:'bar',w:7,color:yel,tail:0})+H.hub(cx,cy,20,{fill:'#1a1b1c',light:'#4a4b4d'});
   return H.cl('gauge',key,o);};
  s+=dial(430,H.rateScale(d,5),3,H.frac.rate(d),'토큰 속도','M tokens/시간',.88,20,'rate');
  s+=dial(850,H.burnScale(d,10),1,H.frac.burn(d),'소진 속도','%/시간',null,18,'burn');
  // 기계식 트립·주행계: 바늘이 가지 않는 왼쪽 아래
  s+=H.cl('trip','',H.odo(320,354,String(Math.round(d.trip/1e5)).padStart(6,'0'),{cw:15,ch:19,bg:'#111',fg:'#ddd',tenths:1})+H.text(420,368,'트립',{size:13,fill:SUB,anchor:'start'}));
  s+=H.odo(740,354,H.fmt.odo(d.odo,6),{cw:15,ch:19,bg:'#111',fg:'#ddd'})+H.text(840,368,'누적',{size:13,fill:SUB,anchor:'start'});
  // 방향 표시 (가운데 축)
  s+=H.path('M606 124 l14 -9 v18Z',{fill:'#2f6f62'})+H.path('M674 124 l-14 -9 v18Z',{fill:'#2f6f62'});
  // 가로 소형 계기 (양옆 같은 높이)
  const flat=(x,y,f,l,r,lab)=>{let o=H.rect(x,y,120,32,{r:2,fill:'#141516',stroke:'#2e3032'});
   for(let i=0;i<=4;i++)o+=H.line(x+30+i*15,y+4,x+30+i*15,y+(i%2?9:13),{stroke:'#ddd',sw:2});
   o+=H.text(x+10,y+27,l,{size:13,fill:'#ddd',anchor:'start'})+H.text(x+110,y+27,r,{size:13,fill:'#e0302a',anchor:'end'});
   const px=x+30+60*H.clamp(f);o+=H.line(px-4,y+28,px,y+6,{stroke:'#ff7a1a',sw:3,cap:'round'});
   o+=H.text(x+60,y+52,lab,{size:13,fill:SUB});return o;};
  s+=H.cl('gauge','heat',flat(92,318,H.frac.heat(d),'C','H','엔진 온도'));
  s+=H.cl('gauge','fuel',flat(1068,318,H.frac.min(d),'E','F','남은 한도'));
  // 왼쪽 기간 줄 · 오른쪽 경고등 줄 (각 소형 계기 축 위). 기어가 늘면 128–268 칸 안에서 줄 간격을 줄입니다
  { const n=d.gears.length,step=n>1?Math.min(28,140/(n-1)):0;
    d.gears.forEach((g,i)=>{const on=g===d.period;s+=H.cl('period',g,H.text(152,128+i*step,g,{size:on?15:14,fill:on?yel:'#7d7d77',weight:on?700:400,base:'central'}));}); }
  s+=H.lamps(1128,128,d,{size:20,gap:42,vertical:true,off:'#2e2f30'});
  s+=H.brand(640,380,{fill:'#5f6061'});
  return s;}});

 // 68 · Toyota Soarer Z20 — 녹색 VFD, 위 가로 그래프, 큰 숫자, 양옆 계단 표시
 O.theme({id:'68',name:'그린 VFD',about:'녹색 발광 숫자와 화면 위쪽을 가로지르는 넓은 그래프, 양옆 계단식 표시창, 아래 시각·경고등·주행계 줄을 한 하우징 안에 옮겼습니다.',draw(H,d){
  const gl=H.glow('g',2);const G='#5ff0b0',DIM='#0c1d16',OFF='#0d1f18';
  let s=H.rect(0,0,1280,480,{fill:H.lin('dash',[[0,'#38393a'],[1,'#1b1c1d']])});
  s+=H.housing('M48 40 Q640 22 1232 40 L1180 440 H100Z',{top:'#35373b',bottom:'#1a1b1d',rim:.12});
  s+=H.path('M80 62 Q640 46 1200 62 L1160 390 H120Z',{fill:H.lin('rc',[[0,'#0c0d0e'],[1,'#1c1d1f']])});
  // 가운데 VFD 창
  s+=H.path('M300 76 H980 L962 316 H318Z',{fill:'#030706',stroke:'#1d2a24',sw:2});
  const xs=344,xw=592;let rg='';
  const rl=H.rateScale(d,10);rl.forEach((v,i)=>{const f=i/(rl.length-1);rg+=H.text(xs+f*xw,104,v,{size:14,fill:f>=.87?'#ff5050':G,filter:gl});});
  rg+=H.bars(xs,116,xw,20,H.frac.rate(d),{n:64,gap:2,fill:G,off:OFF,colors:[[0,G],[.87,'#ff5050']]});
  rg+=H.text(640,160,'토큰 속도',{size:13,fill:G});
  rg+=H.seg(640,180,H.fmt.m(d.rate),66,{fill:G,dim:DIM,filter:gl,anchor:'middle',skew:-4});
  rg+=H.text(640,284,'M tokens/시간',{size:13,fill:G});
  s+=H.cl('gauge','rate',rg);
  const vb=(x,f,top,bot,lab,colors)=>H.text(x+18,176,top,{size:13,fill:G})+H.vbars(x,186,36,68,f,{n:7,gap:3,fill:G,off:OFF,colors})+H.text(x+18,274,bot,{size:13,fill:G})+H.text(x+18,298,lab,{size:13,fill:G});
  s+=H.cl('gauge','fuel',vb(380,H.frac.min(d),'F','E','연료'));
  s+=H.cl('gauge','heat',vb(864,H.frac.heat(d),'H','C','온도',[[.8,'#ff5050']]));
  // 왼쪽 계단 = 기간 기어
  s+=H.path('M118 80 H284 L268 316 H138Z',{fill:'#0a0d0c'});
  s+=H.text(206,104,'기간',{size:13,fill:'#d8d8d2'});
  // 계단 칸: 118–302 안에서 기어 수에 맞춰 칸 간격을 줄입니다 (기본 6칸 = 32 간격)
  { const n=d.gears.length,step=n>1?Math.min(32,160/(n-1)):32,bh=Math.min(24,step-4),k=step/32;
    d.gears.slice().reverse().forEach((g,i)=>{const y=118+i*step,on=g===d.period,x=136+i*3*k,w=136-i*6*k;let o='';
     o+=H.rect(x,y,w,bh,{r:2,fill:on?'#173226':'#8f908a',op:on?1:.5});
     o+=H.text(x+w-10,y+bh/2,g,{size:14,fill:on?G:'#1d1e1d',anchor:'end',weight:600,base:'central'});
     if(on)o+=H.rect(x+8,y+bh/2-5,5,10,{fill:G});
     s+=H.cl('period',g,o);}); }
  // 오른쪽 계단 = 계정 남은 한도와 소진
  s+=H.path('M996 80 H1162 L1142 316 H1012Z',{fill:'#0a0d0c'});
  s+=H.text(1076,104,'남은 한도 %',{size:13,fill:'#d8d8d2'});
  // 계정 칸: 118–214 안에 최대 4줄. 5개 이상이면 앞 3개와 '+N 계정', 이름이 겹치면 plan을 붙입니다
  { const F=d.fuel||[],cnt={};F.forEach(f=>cnt[f.name]=(cnt[f.name]||0)+1);
    const nm=f=>cnt[f.name]>1&&f.plan?`${f.name} ${f.plan}`:f.name;
    const show=F.length>4?F.slice(0,3):F,more=F.length-show.length,rows=show.length+(more?1:0);
    const step=rows?Math.min(32,96/rows):32,bh=Math.min(24,step-4),sz=bh<22?13:14;
    if(!F.length)s+=H.text(1076,166,'계정 없음',{size:13,fill:'#8f908a'});
    show.forEach((f,i)=>{const y=118+i*step,x=1004+i*3,w=136-i*6,left=Number.isFinite(f.left)?f.left:null,low=left!=null&&left<40;
     s+=H.rect(x,y,w,bh,{r:2,fill:low?'#ff6a5a':'#8f908a',op:low?1:.5})+H.text(x+8,y+bh/2,nm(f),{size:13,fill:'#141514',anchor:'start',weight:600,base:'central'})+H.text(x+w-8,y+bh/2,H.fmt.pct(left),{size:sz,fill:'#141514',anchor:'end',weight:700,base:'central'});});
    if(more){const i=show.length,y=118+i*step;s+=H.text(1004+i*3+8,y+bh/2,`+${more} 계정`,{size:13,fill:'#d8d8d2',anchor:'start',base:'central'});} }
  s+=H.cl('gauge','burn',H.rect(1014,222,122,74,{r:2,fill:'#05100b'})+H.text(1026,242,'소진 속도',{size:13,fill:G,anchor:'start'})+H.seg(1026,252,H.fmt.burn(d.burn),24,{fill:G,dim:DIM,filter:gl})+H.text(1126,286,'%/시간',{size:13,fill:G,anchor:'end'}));
  // 아래 줄: 시각 · 경고등 · 주행계
  s+=H.rect(146,334,128,32,{r:2,fill:'#040806'})+H.seg(164,341,d.clock.replace(':',''),18,{fill:G,dim:DIM,filter:gl});
  s+=H.lamps(574,350,d,{size:20,gap:44,off:'#45474a'});
  s+=H.cl('trip','',H.text(990,355,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:G,anchor:'end'}));
  s+=H.rect(1004,334,140,32,{r:2,fill:'#040806'})+H.seg(1018,341,H.fmt.odo(d.odo,6),18,{fill:G,dim:DIM,filter:gl});
  s+=H.brand(640,414,{fill:'#77786f'});
  return s;}});

 // 69 · Opel Kadett GSi — 노랑 VFD 큰 숫자, 왼쪽 상승 막대 넷, 오른쪽 계단처럼 오르는 숫자 띠
 O.theme({id:'69',name:'옐로 일렉트로닉',about:'가운데 노란 발광 큰 숫자와 주행계 두 창, 왼쪽 위로 휘는 막대 넷, 오른쪽 계단처럼 오르는 그래프를 같은 아래 기준선 위에 놓았습니다.',draw(H,d){
  const gl=H.glow('g',2.2);const Y='#ffc21a',OFF='#2a2208',SUB='#b08a22',RED='#ff4a1a';
  let s=H.rect(0,0,1280,480,{fill:'#060504'});
  s+=H.housing('M72 52 Q640 28 1208 52 L1184 432 H96Z',{top:'#1c1916',bottom:'#0a0908',rim:.1});
  s+=H.path('M104 76 Q640 54 1176 76 L1156 404 H124Z',{fill:H.lin('rc',[[0,'#040302'],[1,'#0d0b08']]),stroke:'#000',sw:2});
  // 왼쪽 네 줄
  const rows=[['소진',H.frac.burn(d),'burn'],['온도',H.frac.heat(d),'heat'],['CPU',H.frac.cpu(d)],['연료',H.frac.min(d),'fuel']];
  rows.forEach(([lab,f,key],i)=>{const y=132+i*60;
   let o=H.rect(168,y-15,48,28,{r:3,fill:'#1d1606',stroke:Y,sw:1.2})+H.text(192,y+4,lab,{size:13,fill:Y});
   for(let k=0;k<14;k++){const x=232+k*16,lift=Math.max(0,k-5)*2.4,on=(k+1)/14<=f;
    o+=H.rect(x,y-lift-5,12,10,{fill:on?(k>=12&&i<2?RED:Y):OFF,filter:on?gl:null});}
   s+=key?H.cl('gauge',key,o):o;});
  // 가운데 큰 숫자 + 두 창
  s+=H.cl('gauge','rate',H.rect(524,104,232,112,{r:4,fill:'#140c03'})
   +H.seg(640,120,H.fmt.m(d.rate),80,{fill:Y,dim:'#2a1c06',filter:gl,skew:-3,gap:8,anchor:'middle'})
   +H.text(640,240,'토큰 속도 · M tokens/시간',{size:13,fill:Y}));
  s+=H.rect(524,262,112,34,{r:3,fill:'#140c03'})+H.seg(580,270,H.fmt.odo(d.odo,6),18,{fill:Y,dim:'#2a1c06',filter:gl,anchor:'middle'});
  s+=H.cl('trip','',H.rect(644,262,112,34,{r:3,fill:'#140c03'})+H.seg(700,270,H.fmt.trip(d.trip),18,{fill:Y,dim:'#2a1c06',filter:gl,anchor:'middle'})+H.text(700,318,'트립 M',{size:13,fill:SUB}));
  s+=H.text(580,318,'누적 M',{size:13,fill:SUB});
  // 오른쪽 계단 그래프 = 토큰 속도
  // 눈금은 범위에 맞춰 5칸(0·40·…·200 / 0·0.4·…·2 / 0·200·…·1000), 칸마다 막대 5개
  const labels=H.rateScale(d,5),NS=labels.length-1,PER=Math.round(24/NS);
  const pts=labels.map((v,i)=>{const t=i/NS;return [872+t*220,346-Math.pow(t,.75)*220];});
  const f=H.frac.rate(d);let st='';
  for(let i=0;i<NS;i++){const [x0,y0]=pts[i],[x1,y1]=pts[i+1];
   for(let k=0;k<PER;k++){const t=(i*PER+k+1)/(NS*PER),on=t<=f;const xa=x0+(x1-x0)*k/PER,ya=y0+(y1-y0)*k/PER;
    st+=H.line(xa+3,ya,xa+(x1-x0)/PER-1,ya+(y1-y0)/PER,{stroke:on?(t>.87?RED:Y):OFF,sw:7,filter:on?gl:null});}}
  labels.forEach((v,i)=>{if(!v)return;const [x,y]=pts[i];st+=H.text(x-18,y-12,v,{size:16,fill:i/NS>=.87?RED:Y,weight:600,anchor:'end'});});
  st+=H.text(1124,346,'M tokens/시간',{size:13,fill:SUB,anchor:'end'});
  s+=H.cl('gauge','rate',st);
  // 아래 기준선: 경고등(왼쪽 칸 축) · 기간(가운데 축) · 1top(오른쪽 칸 끝)
  s+=H.lamps(254,384,d,{size:18,gap:44,off:'#3a3012'});
  s+=H.gear(640,384,d,{gap:40,width:300,size:14,on:Y,off:'#7a6224'});
  s+=H.brand(1124,388,{fill:'#5a4a20',anchor:'end'});
  return s;}});

 // 70 · Ford GT 2017 — 크게 펼친 꺾인 그래프, 가운데 큰 숫자, 오른쪽 게이지 세 칸
 O.theme({id:'70',name:'트랙 그래프',about:'왼쪽 아래에서 솟아 위로 길게 뻗는 꺾인 그래프와 가운데 큰 숫자, 오른쪽 세 칸 게이지와 경고등 줄을 한 화면 안에 옮겼습니다.',draw(H,d){
  const W='#e6e9ec',SUB='#9a9ea2',RED='#c4141a';
  let s=H.rect(0,0,1280,480,{fill:'#08080a'});
  s+=H.housing('M44 60 Q640 24 1236 60 L1214 428 Q640 452 66 428Z',{top:'#1e1b20',bottom:'#0c0b0d'});
  s+=screen(H,72,84,1136,324,14,{face:[[0,'#030304'],[1,'#010101']],bezel:8});
  // 그래프 (그래프·눈금·큰 숫자를 토큰 속도 계기 하나로 감쌉니다)
  const s0=s.length;
  const f=H.frac.rate(d);
  const clip=H.clip('fill',`<rect x="140" y="100" width="${(740*f).toFixed(1)}" height="260"/>`);
  s+=H.g(H.path('M140 334 L352 160 H876 V220 H424 L244 334Z',{fill:H.lin('gf',[[0,'#8a929a'],[1,'#e6e9ec']],{dir:[0,0,1,0]}),op:.35}),{clip});
  s+=H.path('M140 334 L352 160 H876',{stroke:W,sw:3,join:'round'})+H.path('M244 334 L424 220 H876',{stroke:W,sw:3,join:'round'});
  s+=H.rect(848,161,28,42,{fill:RED});
  // 눈금: 0–40%는 사선(244,334 → 424,220), 40–100%는 가로선(424 → 862, 끝은 붉은 칸)
  const RL=H.rateScale(d,5);
  RL.forEach((v,i)=>{const fr=i/(RL.length-1),diag=fr<.4-1e-9;let x,y;
   if(diag){const t=fr/.4;x=244+180*t;y=334-114*t;}else{x=424+(fr-.4)/.6*438;y=220;}
   s+=(diag?H.line(x,y,x+7,y-10,{stroke:W,sw:2}):H.line(x,y,x,y-12,{stroke:W,sw:2}))+H.text(x-(diag?6:0),y+(diag?-4:24),v,{size:16,fill:fr>=1?'#ff3a2a':W,anchor:diag?'end':'middle'});});
  // 가운데 큰 숫자와 세션 단
  s+=H.text(640,268,'토큰 속도 · M tokens/시간',{size:14,fill:'#c9cdd1'});
  s+=H.text(640,346,H.fmt.m(d.rate),{size:72,fill:'#fff',font:'wide',weight:800});
  s=s.slice(0,s0)+H.cl('gauge','rate',s.slice(s0));
  s+=H.path('M460 320 H520',{stroke:'#6f7378',sw:2,dash:'2 6'})+H.path('M760 320 H820',{stroke:'#6f7378',sw:2,dash:'2 6'});
  s+=H.text(400,290,`대기 ${d.sessions.waiting}`,{size:13,fill:'#f2b233'});
  s+=H.rect(366,302,68,30,{r:4,fill:W})+H.text(400,323,`작업 ${d.sessions.working}`,{size:14,fill:'#111',weight:600});
  s+=H.text(400,352,`전체 ${d.sessions.total}`,{size:13,fill:SUB});
  // 왼쪽 위 정보: 라벨 열과 값 열
  s+=H.cl('gauge','fuel',H.text(104,124,'작업 가능',{size:13,fill:SUB,anchor:'start'})+H.text(176,126,H.fmt.hours(d.rangeH),{size:20,fill:'#fff',anchor:'start',weight:600})
   +H.rect(176,134,80,4,{fill:'#2a2a2c'})+H.rect(176,134,80*H.frac.min(d),4,{fill:RED}));
  s+=H.cl('gauge','heat',H.text(104,162,'엔진 온도',{size:13,fill:SUB,anchor:'start'})+H.text(176,164,Math.round(d.heat)+'°',{size:20,fill:'#fff',anchor:'start',weight:600}));
  // 오른쪽 게이지 칸
  s+=H.rect(904,100,250,292,{fill:W})+H.rect(906,102,246,30,{fill:'#0a0a0a'})+H.text(918,123,'게이지',{size:14,fill:'#fff',anchor:'start'});
  const cols=[['CPU',H.frac.cpu(d),Math.round(d.cpu)+'','%'],['메모리',H.frac.mem(d),Math.round(d.mem)+'','%'],['소진',H.frac.burn(d),H.fmt.burn(d.burn),'%/시간']];
  cols.forEach(([lab,fr,v,u],i)=>{const x=906+i*82.67,w=80.67;let o=H.rect(x,134,w,180,{fill:'#0a0a0a'});
   o+=H.text(x+w/2,158,lab,{size:13,fill:'#fff'});
   o+=H.rect(x+12,176,w-24,124,{fill:'#141416'});
   o+=H.line(x+12,176+124*(1-fr),x+w-12,176+124*(1-fr),{stroke:i===2?'#ff9a2a':'#e6c14a',sw:3});
   o+=H.rect(x,316,w,74,{fill:'#0a0a0a'})+H.text(x+w/2,352,v,{size:22,fill:'#fff',weight:600})+H.text(x+w/2,374,u,{size:13,fill:'#c9cdd1'});
   s+=i===2?H.cl('gauge','burn',o):o;});
  s+=H.lamps(1176,124,d,{size:18,gap:34,vertical:true,off:'#2e2e30',colors:{waiting:'#f2b233',empty:'#e83a2e'}});
  // 아래 기준선
  s+=H.gear(260,380,d,{gap:40,width:300,size:15,on:'#fff',off:'#7a7e82'});
  s+=H.brand(640,384,{fill:'#5a5a5e'});
  s+=H.cl('trip','',H.text(876,384,`트립 ${H.fmt.trip(d.trip)}M`,{size:14,fill:'#fff',anchor:'end',weight:600}));
  return s;}});

 // 71 · Renault Twingo I — 대시보드 가운데 위의 둥근 갓 속 숫자 창 (크게 확대)
 O.theme({id:'71',name:'센터 팟',about:'대시보드 가운데 위 둥근 갓 속의 작은 숫자 창 하나를 화면 가득 키워, 숫자 계기를 한 줄 기준선에 모았습니다.',draw(H,d){
  const C='#9dffcf',DIM='#10241b',SUB='#5fae8a';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#151821'],[1,'#0a0c10']])});
  // 청회색 갓 (좌우 대칭)
  s+=H.housing('M96 170 Q640 18 1184 170 L1166 414 Q640 438 114 414Z',{top:'#7d88a6',bottom:'#3b4258',rim:.2});
  s+=H.path('M96 170 Q640 18 1184 170',{stroke:'#fff',sw:1.2,op:.18});
  // 창: 검은 턱 → 화면
  s+=H.rect(168,160,944,228,{r:26,fill:'#05070a',stroke:'#000',sw:2});
  s+=H.rect(182,174,916,200,{r:14,fill:H.lin('lcd',[[0,'#071210'],[1,'#040a08']])});
  // A. 토큰 속도 (큰 숫자)
  s+=H.cl('gauge','rate',H.seg(212,202,H.fmt.m(d.rate),96,{fill:C,dim:DIM})
   +H.text(212,332,'토큰 속도',{size:14,fill:C,anchor:'start'})+H.text(212,352,'M tokens/시간',{size:13,fill:SUB,anchor:'start'}));
  s+=H.cl('trip','',H.text(496,352,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:SUB,anchor:'end'}));
  // B. 남은 한도
  s+=H.cl('gauge','fuel',H.vbars(552,202,20,96,H.frac.min(d),{n:8,gap:3,fill:C,off:DIM})
   +H.text(586,268,`${Math.round(d.minLeft)}%`,{size:28,fill:C,anchor:'start',weight:600})
   +H.text(552,332,'남은 한도',{size:14,fill:C,anchor:'start'})+H.text(552,352,H.fmt.hours(d.rangeH),{size:13,fill:SUB,anchor:'start'}));
  // C. 소진 속도
  s+=H.cl('gauge','burn',H.seg(728,234,H.fmt.burn(d.burn),64,{fill:C,dim:DIM})
   +H.text(728,332,'소진 속도',{size:14,fill:C,anchor:'start'})+H.text(728,352,'%/시간',{size:13,fill:SUB,anchor:'start'}));
  // D. 기간 · 경고등 · 주행계
  s+=H.text(1068,230,d.period,{size:30,fill:C,anchor:'end',weight:600});
  s+=H.lamps(953,272,d,{size:18,gap:34,off:'#24382f',colors:{waiting:'#f2b233',empty:'#ef4a3c'}});
  s+=H.text(1068,332,d.periodLabel,{size:14,fill:C,anchor:'end'})+H.text(1068,352,H.fmt.odo(d.odo)+' M',{size:13,fill:SUB,anchor:'end'});
  // 칸 사이 가는 구분선
  [520,700,920].forEach(x=>s+=H.line(x,202,x,298,{stroke:'#1a3529',sw:1}));
  // 기간 기어 줄: 창 위 갓 면에 새긴 글자
  s+=H.gear(640,136,d,{gap:64,width:448,size:15,on:'#0b0e16',off:'#3a4258'});
  s+=H.brand(640,410,{fill:'#c3cadb',op:.6});
  return s;}});

 // 72 · Hyundai Grandeur 1세대 — 각진 검은 갓, 깊이 들어간 밝은 은회색 계기판
 O.theme({id:'72',name:'각진 갓 은회색',about:'좌우 대칭으로 각진 검은 갓 안쪽 깊이 들어간 은회색 판 위에, 밝은 다이얼면의 바늘 계기 둘과 양옆 발광 막대 칸을 놓았습니다.',draw(H,d){
  const INK='#1d1d1b',SUB='#55524b',ACC='#d9481f',VFD='#7fe39a',VOFF='#13261a';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#26272a'],[1,'#121314']])});
  // 1. 바깥 갓: 좌우 대칭, 모서리를 깎은 각진 윤곽
  s+=H.housing('M60 40 H1220 L1252 92 L1236 444 H44 L28 92Z',{top:'#2e2f32',bottom:'#0d0d0e',rim:.14});
  s+=H.path('M28 92 H1252',{stroke:'#fff',sw:1,op:.06});
  // 2. 안쪽으로 들어간 면: 위가 어둡고 아래 턱에 빛
  s+=H.path('M90 66 H1190 L1214 104 L1200 420 H80 L66 104Z',{fill:H.lin('rc',[[0,'#000'],[.2,'#08080a'],[1,'#1a1b1d']])});
  s+=H.path('M80 420 H1200',{stroke:'#fff',sw:1.2,op:.16});
  // 3. 은회색 판 (가는 사선 무늬)
  H.def(`<pattern id="${H.id('hatch')}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><rect width="7" height="7" fill="#b8b4aa"/><rect width="1.2" height="7" fill="#a9a59b"/></pattern>`);
  s+=H.rect(96,96,1088,308,{r:6,fill:'#000',op:.6,filter:H.shadow('pls',3,4,.6)});
  s+=H.rect(96,96,1088,308,{r:6,fill:H.url('hatch')});
  s+=H.rect(96,96,1088,308,{r:6,fill:'#6a655a',op:.12});
  s+=H.rect(96,96,1088,308,{r:6,fill:H.lin('pl',[[0,'#000',.42],[.16,'#000',.08],[.6,'#000',0],[1,'#000',.12]])});
  s+=H.rect(96.5,96.5,1087,307,{r:6,stroke:'#fff',sw:1,op:.18});
  // 판 위쪽에 갓 그림자 (위가 어둡게)
  s+=H.rect(96,96,1088,14,{r:6,fill:H.lin('lip',[[0,'#000',.5],[1,'#000',0]])});
  const cy=250;
  // 4. 바늘 계기 둘: 검은 테 → 밝은 다이얼면
  const dial=(cx,labels,minor,f,val,unit,lab,red,key)=>{const R=130;
   let o=H.bezel(cx,cy,R,8,{tone:'black'});
   o+=H.face(cx,cy,R,{fill:'#d6d2c7',center:'#e2dfd6',edge:'#a8a396'});
   o+=H.circle(cx,cy,R-1,{stroke:'#77725f',sw:1,op:.5});
   // 숫자가 4자리(1000)로 길어지면 글자를 줄이지 않고 눈금 고리를 안쪽으로 옮깁니다
   const L=Math.max(...labels.map(t=>t.length)),tr=86-Math.max(0,L-3)*6;
   o+=outerDial(H,cx,cy,{r:tr,labels,minor,len:14,mlen:7,w:3,mw:1.5,tick:INK,red,redColor:ACC,gap:15,size:16,weight:500});
   o+=H.text(cx,cy+52,val,{size:28,fill:INK,weight:600,font:'helv'});
   o+=H.text(cx,cy+72,unit,{size:13,fill:SUB})+H.text(cx,cy+90,lab,{size:14,fill:INK});
   o+=H.needle(cx,cy,tr-13,-130+260*f,{style:'taper',w:7,color:ACC,tail:16});
   o+=H.hub(cx,cy,13,{fill:'#141414',light:'#5a5a5a'});
   return H.cl('gauge',key,o);};
  s+=dial(472,H.burnScale(d,5),4,H.frac.burn(d),H.fmt.burn(d.burn),'%/시간','소진 속도',.6,'burn');
  s+=dial(808,H.rateScale(d,10),1,H.frac.rate(d),H.fmt.m(d.rate),'M tokens/시간','토큰 속도',.85,'rate');
  // 5. 가운데 경고등 줄: 판에 파인 좁은 검은 창
  s+=H.rect(620,148,40,188,{r:6,fill:'#0b0b0c',stroke:'#000',sw:1.5})+H.rect(620,148,40,188,{r:6,stroke:'#fff',sw:1,op:.1});
  s+=H.lamps(640,176,d,{size:20,gap:44,vertical:true,off:'#2b2c2e'});
  s+=H.brand(640,376,{fill:'#4a473f',op:.9});
  // 6. 양옆 발광 막대 칸: 판에 들어간 검은 창 (좌우 같은 크기·같은 높이)
  const module=(x)=>H.rect(x,124,184,252,{r:6,fill:'#000',op:.55,filter:H.shadow('md'+x,-2,3,.7)})+H.rect(x,124,184,252,{r:6,fill:H.lin('mf'+x,[[0,'#040605'],[1,'#0b0f0c']]),stroke:'#2b2a27',sw:2})+H.rect(x+1,125,182,250,{r:5,stroke:'#fff',sw:1,op:.08});
  s+=module(116)+module(980);
  // 왼쪽: 남은 한도 · 엔진 온도
  [['남은 한도',H.frac.min(d),'F','E',null,'fuel'],['엔진 온도',H.frac.heat(d),'H','C',[[.84,'#ff5a3a']],'heat']].forEach(([lab,f,top,bot,colors,key],i)=>{const x=172+i*72;
   s+=H.cl('gauge',key,H.text(x,152,top,{size:13,fill:VFD,base:'central'})
    +H.vbars(x-13,166,26,150,f,{n:12,gap:3,fill:VFD,off:VOFF,colors})
    +H.text(x,330,bot,{size:13,fill:VFD,base:'central'})+H.text(x,356,lab,{size:13,fill:VFD,base:'central'}));});
  // 오른쪽: 기간 기어(세로) · 주행계
  // 기어가 늘면 152–282 칸 안에서 줄 간격을 줄입니다 (기본 6개 = 26 간격)
  { const n=d.gears.length,step=n>1?Math.min(26,130/(n-1)):0,bh=Math.min(22,step-2);
    d.gears.forEach((g,i)=>{const on=g===d.period,y=152+i*step;let o='';
     if(on)o+=H.rect(1040,y-bh/2,64,bh,{r:3,fill:'#173322'});
     o+=H.text(1072,y,g,{size:on?15:14,fill:on?VFD:'#4d7a5a',weight:on?700:400,base:'central'});
     s+=H.cl('period',g,o);}); }
  s+=H.seg(1072,306,H.fmt.odo(d.odo),15,{fill:VFD,dim:VOFF,anchor:'middle'});
  s+=H.cl('trip','',H.text(1072,336,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:VFD,base:'central'}));
  s+=H.text(1072,356,'누적 M tokens',{size:13,fill:VFD,base:'central'});
  return s;}});
})(window.OneTop);
