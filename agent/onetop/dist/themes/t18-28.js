/* 18–28 (v4.0.0: 글자 위계, 공유 축, 화면 채우기, 층 있는 깊이) */
(function(O){
 'use strict';
 // 기본 범위(200M·20%)의 눈금입니다. 화면에 쓰지 않고, 숫자 자리를 정하는 기준으로만 씁니다.
 const ref=(max,n,every=1)=>Array.from({length:n+1},(_,i)=>i%every?'':O.fmtScale(max*i/n));
 const R0=ref(200,10),R2=ref(200,10,2),B0=ref(20,10),B2=ref(20,10,2);
 // 적정 소진 속도 글자 (범위에 따라 0.2, 1.9, 4.8처럼)
 // d.cruise가 null(적정 속도를 모름)이면 적정 표시를 숨기도록 hasCruise로 먼저 확인합니다
 const hasCruise=d=>d.cruise!=null&&isFinite(d.cruise);
 const cruise=d=>hasCruise(d)?(Math.round(d.cruise*10)/10).toFixed(1):'—';
 const cpuTxt=d=>`CPU ${Math.round(d.cpu)}%`;
 // 글자 크기 단계: 라벨 14, 단위 13 (11–12는 주행계 같은 부수 정보만)
 const LB=14,UN=13;
 // 유리 반사: 숫자 아래 깔리는 아주 옅은 광택이라 검사에서 빼도록 pointer-events를 끕니다
 const glass=(H,cx,cy,r,op)=>`<g pointer-events="none">${H.glass(cx,cy,r,{op})}</g>`;
 // 하우징에 파인 원형 소켓: 위가 어둡고 아래가 밝아 안으로 들어간 느낌을 줍니다
 const socket=(H,n,cx,cy,r,top,bot)=>H.circle(cx,cy,r,{fill:H.lin(n,[[0,top],[1,bot]])})+H.circle(cx,cy,r-.5,{stroke:'#000',sw:1,op:.35});
 // 안으로 들어간 사각 창: 위 안쪽 그림자, 아래 가는 빛선
 const well=(H,n,x,y,w,h,o={})=>H.rect(x,y,w,h,{r:o.r??6,fill:o.fill||'#0c0d0f'})+H.rect(x,y,w,8,{r:o.r??6,fill:H.lin(n,[[0,'#000',.6],[1,'#000',0]])})+H.line(x+(o.r??6),y+h+.5,x+w-(o.r??6),y+h+.5,{stroke:'#fff',sw:1,op:o.lip??.18});
 // 숫자 글자 상자(잉크) 크기와 반경 방향 지지 함수: w/2·|sin a| + h/2·|cos a| (0°=위, 시계 방향)
 const nbox=(t,sz)=>[t.length*sz*.6,sz*.76];
 const sup=(t,sz,a)=>{const [w,h]=nbox(t,sz),r=a*Math.PI/180;return w/2*Math.abs(Math.sin(r))+h/2*Math.abs(Math.cos(r));};
 const angs=(labels,a0,sw)=>labels.map((_,i)=>a0+sw*(labels.length>1?i/(labels.length-1):0));
 // 눈금 바깥 끝(rt)에서 6px 이상 떨어지게 각도마다 숫자를 바깥으로 둡니다
 function numsOut(H,cx,cy,rt,labels,o){const A=angs(labels,o.a0,o.sweep),n=labels.length-1;
  return labels.map((t,i)=>{if(!t)return '';const a=A[i],[x,y]=H.pt(cx,cy,rt+6+sup(t,o.size,a),a),red=o.red!=null&&i/n>=o.red;
   return H.text(x,y,t,{size:o.size,fill:red?(o.redColor||'#e53b2c'):o.fill,font:o.font,weight:o.weight,base:'central'});}).join('');}
 // 바깥 한계 lim 안에 숫자가 들어가도록 눈금 바깥 끝 반경을 정합니다
 const fitR=(labels,a0,sw,sz,lim)=>{const A=angs(labels,a0,sw);return lim-Math.max(...labels.map((t,i)=>t?6+2*sup(t,sz,A[i]):0));};
 // 눈금 안쪽 끝(ri)에서 6px 이상 떨어지게 숫자를 안쪽으로 둡니다
 function numsIn(H,cx,cy,ri,labels,o){const A=angs(labels,o.a0,o.sweep),n=labels.length-1;
  return labels.map((t,i)=>{if(!t)return '';const a=A[i],[x,y]=H.pt(cx,cy,ri-6-sup(t,o.size,a),a),red=o.red!=null&&i/n>=o.red;
   return H.text(x,y,t,{size:o.size,fill:red?(o.redColor||'#e53b2c'):o.fill,font:o.font,weight:o.weight,base:'central'});}).join('');}
 // 기본 범위에서 정한 숫자 자리(nR)와 눈금(tR)을 기준으로, 더 넓은 숫자(0.4, 1000)는 바깥 한계를 넘지 않게 안쪽으로 당기고
 // 눈금 고리도 같은 틈만큼 안쪽으로 옮깁니다. 기본 범위에서는 원래 자리 그대로입니다.
 function ringFit(labels,def,a0,sw,sz,nR,tR){
  const A=angs(labels,a0,sw),Ad=angs(def,a0,sw);
  const sd=def.map((t,i)=>t?sup(t,sz,Ad[i]):0),OUT=nR+Math.max(...sd);
  const G=Math.min(...def.map((t,i)=>t?nR-sd[i]:1e9))-tR;
  const rs=labels.map((t,i)=>t?Math.min(nR,OUT-sup(t,sz,A[i])):nR);
  const inner=Math.min(...labels.map((t,i)=>t?rs[i]-sup(t,sz,A[i]):1e9));
  return {rs,tR:Math.min(tR,inner-G)};}
 // 숫자마다 반경이 다른 눈금 숫자
 function numsAt(H,cx,cy,rs,labels,o){const A=angs(labels,o.a0,o.sweep),n=labels.length-1;
  return labels.map((t,i)=>{if(!t)return '';const [x,y]=H.pt(cx,cy,rs[i],A[i]),red=o.red!=null&&i/n>=o.red;
   return H.text(x,y,t,{size:o.size,fill:red?(o.redColor||'#e53b2c'):o.fill,font:o.font,weight:o.weight,base:'central'});}).join('');}
 // 아날로그 계기: 재질 테두리·다이얼면·눈금·숫자·바늘·허브
 // 숫자는 바깥 고리, 눈금은 그 안쪽, 바늘은 눈금 바깥 끝까지. mid 글자는 바늘이 가지 않는 아래쪽에 둡니다.
 function gauge(H,o){
  const {cx,cy,r}=o,a0=o.a0??-135,sw=o.sweep??270,f=H.clamp(o.f||0);
  let s='';
  if(o.tone!==null)s+=H.bezel(cx,cy,r,o.bw??10,{tone:o.tone||'chrome',shadow:o.shadow});
  s+=H.face(cx,cy,r,o.face||{});
  if(o.glass!==false)s+=glass(H,cx,cy,r,o.glassOp);
  if(o.under)s+=o.under;
  const sz=o.size||16,nR=r-sz*.78-6;let tR=nR-sz*.72-5,rf=null;
  if(o.fit)tR=Math.min(tR,fitR(o.labels,a0,sw,sz,r-9));
  else if(o.ref){rf=ringFit(o.labels,o.ref,a0,sw,sz,nR,tR);tR=rf.tR;}
  s+=H.ticks(cx,cy,tR,{a0,sweep:sw,n:o.labels.length-1,minor:o.minor??4,len:o.len??12,mlen:o.mlen??6,w:o.tw??2.4,mw:o.mw??1.2,color:o.tick||'#f2f2f0',mcolor:o.mtick,red:o.red,redColor:o.redColor});
  const no={a0,sweep:sw,size:sz,fill:o.num||'#f2f2f0',font:o.font||'helv',weight:o.weight,red:o.red,redColor:o.redColor};
  s+=o.fit?numsOut(H,cx,cy,tR,o.labels,no):rf?numsAt(H,cx,cy,rf.rs,o.labels,no):H.nums(cx,cy,nR,o.labels,no);
  if(o.mid)s+=o.mid;
  s+=H.needle(cx,cy,tR-1,a0+sw*f,{style:o.ns||'taper',w:o.nw||6,color:o.nc||'#f07a1a',tail:o.tail??Math.round(r*.14)});
  s+=H.hub(cx,cy,o.hubR||Math.max(6,Math.round(r*.08)),{fill:o.hubFill,light:o.hubLight});
  return o.kind?H.cl('gauge',o.kind,s):s;
 }
 // 작은 반원 계기 (위쪽 120° 호, 바늘 축은 원 아래쪽)
 function minor(H,o){
  const {cx,cy,r,f}=o;let s='';
  s+=H.bezel(cx,cy,r,o.bw??8,{tone:o.tone||'black'})+H.face(cx,cy,r,o.face||{});
  const py=cy+r*.3,fnt=o.font||'helv';
  s+=H.ticks(cx,py,r*.98,{a0:-60,sweep:120,n:4,minor:1,len:Math.round(r*.16),mlen:Math.round(r*.09),w:2,mw:1.2,color:o.tick||'#eee',red:o.red,redColor:o.redColor});
  const [lx,ly]=H.pt(cx,py,r*.76,-84),[hx,hy]=H.pt(cx,py,r*.76,84);
  s+=H.text(lx+3,ly+9,o.lo,{size:UN,fill:o.num||'#eee',font:fnt})+H.text(hx-3,hy+9,o.hi,{size:UN,fill:o.num||'#eee',font:fnt});
  s+=H.text(cx,cy+r*.68,o.label,{size:UN,fill:o.labelFill||'#d6d6d6',font:o.labelFont||'ui'});
  s+=H.needle(cx,py,r*.86,-60+120*H.clamp(f),{style:'taper',w:4,color:o.nc||'#f07a1a',tail:4});
  s+=H.hub(cx,py,5);
  return o.kind?H.cl('gauge',o.kind,s):s;
 }

 // 18 · Lamborghini Countach — 황갈색 가죽 패널에 박힌 다섯 개의 검은 원
 O.theme({id:'18',name:'웨지 패널',about:'황갈색 가죽 패널에 파인 소켓마다 검은 원을 한 축으로 박고, 아래 창 셋에 작업 가능 시간·기간·경고등을 두었습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#0e0e0e'],[1,'#050505']])});
  s+=H.housing('M14 58 Q14 34 38 34 H1242 Q1266 34 1266 58 V422 Q1266 446 1242 446 H38 Q14 446 14 422Z',{top:'#d6c29b',bottom:'#9c845f',rim:.45});
  s+=H.path('M14 422 Q14 446 38 446 H1242 Q1266 446 1266 422',{stroke:'#000',sw:2,op:.35});
  const cy=212,face={fill:'#111',center:'#1a1a1a',edge:'#030303'},num='#bfe8c8',tick='#d8f0de',lab='#ece6d6';
  const sock=(n,cx,r)=>socket(H,n,cx,cy,r,'#4e3f2b','#c7b088');
  // 소켓 → 테두리 → 다이얼
  s+=sock('s1',104,74)+sock('s2',376,162)+sock('s3',640,86)+sock('s4',904,162)+sock('s5',1176,74);
  const small=(cx,f,label,lo,hi,kind)=>minor(H,{cx,cy,r:62,f,label,lo,hi,kind,tone:'black',bw:10,face,num,tick,labelFill:lab,nc:'#ff8a1a'});
  s+=small(104,H.frac.min(d),'남은 한도','E','F','fuel');
  s+=gauge(H,{kind:'rate',cx:376,fit:1,cy,r:146,tone:'black',bw:14,face,labels:H.rateScale(d,10),f:H.frac.rate(d),minor:4,len:14,tw:2.6,size:19,num,tick,nc:'#ff8a1a',nw:6,
   mid:H.text(376,cy+52,'토큰 속도',{size:LB,fill:lab})+H.text(376,cy+72,'M tokens/시간',{size:UN,fill:'#a9a59b'})+H.rect(334,cy+88,84,26,{r:3,fill:'#000',stroke:'#3a3a3a'})+H.text(376,cy+106,H.fmt.odo(d.odo,6),{size:15,fill:'#e8e8e8',font:'helv',ls:1.5})});
  s+=minor(H,{kind:'heat',cx:640,cy,r:74,f:H.frac.heat(d),label:'엔진 온도',lo:'C',hi:'H',red:.8,tone:'black',bw:10,face,num,tick,labelFill:lab,nc:'#ff8a1a'});
  s+=gauge(H,{kind:'burn',cx:904,fit:1,cy,r:146,tone:'black',bw:14,face,labels:H.burnScale(d,10),f:H.frac.burn(d),minor:4,len:14,tw:2.6,size:19,num,tick,red:.8,redColor:'#e8462a',nc:'#ff8a1a',nw:6,
   mid:H.text(904,cy+52,'소진 속도',{size:LB,fill:lab})+H.text(904,cy+72,'%/시간',{size:UN,fill:'#a9a59b'})+(hasCruise(d)?H.text(904,cy+104,`적정 ${cruise(d)}`,{size:LB,fill:num}):'')});
  s+=small(1176,H.frac.cpu(d),'CPU','0','100');
  // 아래 창 셋: 작은 계기 축과 가운데 축에 맞추고 같은 기준선에 둡니다
  const WY=350,WH=50;
  s+=well(H,'w1',42,WY,124,WH)+H.text(104,WY+20,'작업 가능',{size:UN,fill:'#c9c2b0'})+H.text(104,WY+40,H.fmt.hours(d.rangeH),{size:16,fill:'#fff',weight:600});
  s+=well(H,'w2',520,WY,240,WH)+H.gear(640,WY+WH/2,d,{gap:38,width:224,size:14,on:'#ff8a1a',off:'#8a8270'});
  s+=well(H,'w3',1114,WY,124,WH)+H.lamps(1131,WY+WH/2,d,{size:18,gap:30,off:'#3f3a31'});
  // 트립: 가운데 축(온도계와 기어 창 사이)
  s+=H.cl('trip','',H.text(640,327,`트립 ${H.fmt.trip(d.trip)}M`,{size:LB,fill:'#3a2e1f',weight:600}));
  s+=H.brand(640,428,{size:12,fill:'#5a4930',op:1});
  return s;}});

 // 19 · Tesla Model 3 — 운전석 앞은 비우고 가운데 가로 화면 하나
 O.theme({id:'19',name:'센터 스크린',about:'운전석 앞을 비우고 대시보드 한가운데 가로 화면 하나에 기간·속도·세션 지도를 모았습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#202326'],[1,'#0a0b0c']])});
  const X=70,Y=36,W=1140,Hh=408;
  s+=H.rect(X-12,Y-12,W+24,Hh+24,{r:26,fill:H.lin('bz',[[0,'#1c1d20'],[1,'#050505']]),filter:H.shadow('scr',10,18,.6)})+H.rect(X-12,Y-12,W+24,Hh+24,{r:26,stroke:'#fff',sw:1,op:.1});
  s+=H.rect(X-2,Y-2,W+4,Hh+4,{r:14,fill:'#000'})+H.rect(X,Y,W,Hh,{r:12,fill:'#f2f3f5'});
  // 왼쪽 주행 칸
  const LW=360,lc=X+218;
  s+=H.path(`M${X+12} ${Y}H${X+LW}V${Y+Hh}H${X+12}Q${X} ${Y+Hh} ${X} ${Y+Hh-12}V${Y+12}Q${X} ${Y} ${X+12} ${Y}Z`,{fill:'#fff'})+H.line(X+LW+.5,Y+16,X+LW+.5,Y+Hh-16,{stroke:'#e1e4e8'});
  s+=H.lamps(X+46,Y+34,d,{size:18,gap:40,off:'#cfd3d8'});
  // 기간 목록: Y+84~Y+234 칸 안에서 개수에 맞춰 줄 간격을 나눕니다
  const gn=d.gears.length,gs=gn>1?Math.min(30,150/(gn-1)):0;
  d.gears.forEach((g,i)=>{const on=g===d.period;s+=H.cl('period',g,H.text(X+36,Y+84+i*gs,g,{size:on?15:14,fill:on?'#111':'#a1a6ac',weight:on?700:400,anchor:'start',base:'central'}));});
  s+=H.cl('gauge','rate',H.text(lc,Y+150,H.fmt.m(d.rate),{size:76,fill:'#111',weight:300})+
   H.text(lc,Y+180,'M tokens/시간',{size:UN,fill:'#5f646b'})+
   H.bars(lc-100,Y+196,200,6,H.frac.rate(d),{n:32,gap:1.5,fill:'#3e6ae1',off:'#e4e6ea'}));
  s+=H.text(lc,Y+228,`작업 ${d.sessions.working} · 대기 ${d.sessions.waiting}`,{size:LB,fill:'#33373c'});
  s+=H.line(X+36,Y+254,X+LW-28,Y+254,{stroke:'#eceef1'});
  const row=(y,k,v)=>H.text(X+36,y,k,{size:LB,fill:'#6b7076',anchor:'start'})+H.text(X+LW-28,y,v,{size:16,fill:'#111',anchor:'end',weight:500});
  s+=H.cl('gauge','burn',row(Y+284,'소진 속도',H.fmt.burn(d.burn)+' %/시간'))+row(Y+314,'작업 가능',H.fmt.hours(d.rangeH))+H.cl('gauge','fuel',row(Y+344,'남은 한도',Math.round(d.minLeft)+'%')+
   H.rect(X+36,Y+364,LW-64,6,{fill:'#e4e6ea',r:3})+H.rect(X+36,Y+364,(LW-64)*H.frac.min(d),6,{fill:'#3e6ae1',r:3}));
  // 오른쪽: 상태 줄 · 세션 지도 · 바닥 줄
  const mx=X+LW+16,mw=W-LW-32,my=Y+54,mh=Hh-108;
  s+=H.text(mx+4,Y+30,`${d.periodLabel} 합계 ${H.fmt.m(d.tokens)}M`,{size:LB,fill:'#2c3036',anchor:'start',weight:500,base:'central'})+H.text(X+W-20,Y+30,d.clock,{size:LB,fill:'#2c3036',anchor:'end',weight:500,base:'central'});
  s+=H.rect(mx,my,mw,mh,{r:8,fill:'#e6e9ed'});
  const L=d.list||[];
  if(!L.length)s+=H.text(mx+mw/2,my+mh/2,'세션 없음',{size:15,fill:'#6b737c',base:'central'});
  H.treemap(L,mx,my,mw,mh).forEach(({x,y,w:ww,h,s:se})=>{const w=se.state==='waiting';
   s+=H.rect(x+4,y+4,ww-8,h-8,{fill:w?'#f6e4bb':se.state==='idle'?'#e1e4e8':'#d5e5da',r:5});
   if(ww>=70&&h>=42){s+=H.text(x+18,y+28,H.ellipsis(se.name,ww-34,15,'ui',500),{size:15,fill:'#22262b',anchor:'start',weight:500});
    if(h>=64)s+=H.text(x+18,y+50,w?'응답 대기':(se.tok||''),{size:UN,fill:w?'#8a5400':'#55606a',anchor:'start'});}});
  s+=H.text(mx+4,Y+Hh-26,`누적 ${H.fmt.odo(d.odo)} M`,{size:UN,fill:'#5f646b',anchor:'start',base:'central'})+H.text(mx+112,Y+Hh-26,'·',{size:UN,fill:'#5f646b',base:'central'});
  s+=H.cl('trip','',H.text(mx+122,Y+Hh-26,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#5f646b',anchor:'start',base:'central'}));
  s+=H.brand(X+W-20,Y+Hh-26,{size:12,fill:'#8a9097',op:1,anchor:'end'});
  return s;}});

 // 20 · Volkswagen Golf GTI Mk7 — 하우징 속 크롬 링 두 원과 가운데 세로 화면
 O.theme({id:'20',name:'트윈 후드',about:'짙은 하우징 안 두 원에 은빛 링을 두르고 빨간 바늘을 달았으며, 그 사이 세로 화면에 기간 정보를 넣었습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1c1d20'],[1,'#08090a']])});
  s+=H.housing('M28 458 C34 126 150 28 340 24 H940 C1130 28 1246 126 1252 458Z',{top:'#303236',bottom:'#0e0f11',rim:.14});
  s+=H.path('M84 458 C90 154 190 78 350 74 H930 C1090 78 1190 154 1196 458Z',{fill:H.lin('rc',[[0,'#000'],[.25,'#060607'],[1,'#0b0c0d']])})+H.path('M84 458 C90 154 190 78 350 74 H930 C1090 78 1190 154 1196 458',{stroke:'#000',sw:2,op:.8});
  const cy=262,face={fill:'#17181b',center:'#202226',edge:'#08090a'};
  const sub=(cx,y,f,lab,lo,hi)=>{let o=H.circle(cx,y,33,{fill:'#0a0b0c',stroke:'#c9cdd2',sw:1.5});
   o+=H.ticks(cx,y,31,{a0:-90,sweep:180,n:4,minor:0,len:5,w:1.5,color:'#ddd'});
   o+=H.text(cx-19,y+14,lo,{size:UN,fill:'#ddd'})+H.text(cx+19,y+14,hi,{size:UN,fill:'#ddd'})+H.text(cx,y+50,lab,{size:UN,fill:'#bdbdbd'});
   return o+H.needle(cx,y,26,-90+180*H.clamp(f),{style:'taper',w:3,color:'#e8402a',tail:3,shadow:false})+H.hub(cx,y,4);};
  const pod=(kind,cx,labels,f,lab,unit,red,sf,slab,slo,shi)=>gauge(H,{kind,cx,cy,r:160,fit:1,tone:'chrome',bw:12,face,labels,a0:-130,sweep:260,f,minor:4,len:13,tw:2.6,size:20,red,redColor:'#e8402a',nc:'#e8402a',nw:6,hubFill:'#7a1a10',hubLight:'#e8604a',
   mid:H.text(cx,cy+36,lab,{size:LB,fill:'#e2e2e2'})+H.text(cx,cy+54,unit,{size:UN,fill:'#9a9a9a'})+sub(cx,cy+98,sf,slab,slo,shi)});
  s+=pod('rate',304,H.rateScale(d,10),H.frac.rate(d),'토큰 속도','M tokens/시간',.8,H.frac.heat(d),'온도','C','H');
  s+=pod('burn',976,H.burnScale(d,10),H.frac.burn(d),'소진 속도','%/시간',undefined,H.frac.min(d),'한도','E','F');
  // 가운데 세로 화면과 아래 턱
  const X=508,Y=110,W=264,Hh=284;
  s+=H.rect(X-6,Y-6,W+12,Hh+42,{r:12,fill:H.lin('chin',[[0,'#1a1b1d'],[1,'#050506']])})+H.rect(X-6,Y-6,W+12,Hh+42,{r:12,stroke:'#fff',sw:1,op:.08});
  s+=H.rect(X,Y,W,Hh,{r:7,fill:H.lin('scr',[[0,'#0d131b'],[1,'#05070a']])});
  s+=H.text(640,Y+32,d.periodLabel,{size:15,fill:'#e6edf5',weight:500});
  s+=H.text(640,Y+94,H.fmt.m(d.tokens)+'M',{size:46,fill:'#fff',weight:300});
  s+=H.text(640,Y+120,'기간 합계 토큰',{size:UN,fill:'#8a96a3'});
  s+=H.line(X+24,Y+140,X+W-24,Y+140,{stroke:'#fff',op:.1});
  s+=H.text(640,Y+168,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:15,fill:'#fff'});
  s+=H.text(640,Y+192,hasCruise(d)?`적정 ${cruise(d)} %/시간`:cpuTxt(d),{size:UN,fill:'#8a96a3'});
  s+=H.lamps(640-66,Y+224,d,{size:18,gap:44,off:'#323a44'});
  s+=H.gear(640,Y+258,d,{gap:40,width:W-28,size:14,on:'#fff',off:'#7c8794'});
  // 아래 턱: 왼쪽 1top, 오른쪽 트립 (화면 안쪽 여백선에 맞춤)
  s+=H.brand(X+14,Y+Hh+22,{size:12,fill:'#7a7d82',op:1,anchor:'start'});
  s+=H.cl('trip','',H.text(X+W-14,Y+Hh+22,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#9aa3ad',anchor:'end'}));
  return s;}});

 // 21 · MINI Cooper R56 — 대시보드 가운데 거대한 원형 계기, 양옆 작은 원
 O.theme({id:'21',name:'센터 서클',about:'대시보드 한가운데 거대한 크림색 원에 토큰 속도·남은 한도 점·주황 LCD를 두고, 양옆 같은 높이의 작은 원에 소진 속도와 온도를 두었습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#26282b'],[1,'#0c0d0e']])});
  const cy=236,org='#ff8a2a';
  // 양옆 작은 원: 가운데 원과 같은 축
  const pod=(kind,cx,labels,ref0,f,val,lab,sub,red)=>gauge(H,{kind,cx,cy,r:122,tone:'black',bw:16,face:{fill:'#141416',edge:'#050506'},labels,ref:ref0,f,minor:4,len:11,size:16,red,redColor:'#e8642a',nc:'#ff7a1a',nw:5,
   mid:H.text(cx,cy+50,val,{size:24,fill:org,font:'cond',weight:600})+H.text(cx,cy+74,lab,{size:LB,fill:'#e2e2e2'})+H.text(cx,cy+96,sub,{size:UN,fill:'#9a9a9a'})});
  s+=pod('burn',176,H.burnScale(d,5),ref(20,5),H.frac.burn(d),H.fmt.burn(d.burn),'소진 속도','%/시간',.8);
  s+=pod('heat',1104,['0','25','50','75','100'],null,H.frac.heat(d),Math.round(d.heat)+'°','엔진 온도',`작업 가능 ${H.fmt.hours(d.rangeH)}`,.8);
  // 가운데 큰 원: 검은 두꺼운 테 → 크롬 선 → 크림색 면
  const cx=640,r=192;
  s+=H.bezel(cx,cy,r,22,{tone:'black'})+H.circle(cx,cy,r+1,{stroke:'#d9dce0',sw:2.5});
  let g=H.face(cx,cy,r-1,{fill:'#f3efe6',center:'#fbf9f4',edge:'#d6cfbf'})+glass(H,cx,cy,r-1,.1);
  // 숫자가 넓어지면(1000) 숫자와 눈금 고리를 함께 안쪽으로 옮깁니다
  const RL=H.rateScale(d,10),rf=ringFit(RL,R0,-128,256,22,r-24,r-46);
  g+=H.ticks(cx,cy,rf.tR,{a0:-128,sweep:256,n:10,minor:4,len:16,mlen:8,w:3,mw:1.6,color:'#c8371a',mcolor:'#dc6a4c'});
  g+=numsAt(H,cx,cy,rf.rs,RL,{a0:-128,sweep:256,size:22,fill:'#c3351a',font:'cond',weight:600});
  g+=H.text(cx,cy+38,'M tokens/시간',{size:LB,fill:'#7a3020'});
  // 남은 한도 점 (원본의 연료 점), 바늘이 가지 않는 아래쪽
  const nDots=7,on=Math.round(H.frac.min(d)*nDots);let fu=H.text(cx,cy+60,`남은 한도 ${Math.round(d.minLeft)}%`,{size:UN,fill:'#4a4a4a'});
  for(let i=0;i<nDots;i++){const a=147+66*i/(nDots-1);const [x,y]=H.pt(cx,cy,88,a);fu+=H.circle(x,y,5.5,{fill:i<on?'#1a1a1a':'#e2ddd1',stroke:'#aaa294',sw:i<on?0:1});}
  // 주황 LCD: 기간 기어 한 줄, 그 아래 면 위에 경고등
  const LX=cx-104,LY=cy+100,LW=208,LH=34;
  const lcdBox=H.rect(LX,LY,LW,LH,{r:6,fill:'#140803'})+H.rect(LX,LY,LW,LH,{r:6,stroke:'#000',sw:1.5})+H.line(LX+6,LY+LH+.5,LX+LW-6,LY+LH+.5,{stroke:'#fff',op:.5});
  g+=H.needle(cx,cy,rf.tR-1,-128+256*H.frac.rate(d),{style:'taper',w:7,color:'#ff5a1a',tail:22})+H.hub(cx,cy,22,{fill:'#9da1a6',light:'#eef0f2'});
  // 다이얼면·눈금·바늘은 rate, 아래 남은 한도 점은 fuel, LCD 기어·경고등·트립은 각각 따로 표시합니다
  s+=H.cl('gauge','rate',g)+H.cl('gauge','fuel',fu)+lcdBox;
  s+=H.gear(cx,LY+LH/2,d,{gap:33,width:LW-12,size:d.gears.length>6?13:14,on:org,off:'#8a4c22'});
  s+=H.lamps(cx-54,cy+154,d,{size:16,gap:36,off:'#cbc4b4'});
  s+=H.cl('trip','',H.text(cx,cy+178,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#6a6359'}));
  s+=H.brand(cx,462,{size:12,fill:'#8a8378',op:1});
  return s;}});

 // 22 · Rolls-Royce Phantom VII — 회전계 대신 Power Reserve, 크롬 링, 가는 흰 바늘
 O.theme({id:'22',name:'파워 리저브',about:'회전계 자리에 Power Reserve처럼 남은 한도 여유를 두고, 가운데 큰 원에 토큰 속도를 가는 흰 바늘로 그렸습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#141416'],[1,'#060607']])});
  const hs='M24 436 C24 112 112 28 262 26 H1018 C1168 28 1256 112 1256 436 Q1256 456 1236 456 H44 Q24 456 24 436Z';
  s+=H.housing(hs,{top:'#2c2a27',bottom:'#0f0e0d',rim:.12});
  s+=H.path('M50 424 C50 128 130 54 270 52 H1010 C1150 54 1230 128 1230 424 Q1230 440 1214 440 H66 Q50 440 50 424Z',{fill:H.lin('rc',[[0,'#050505'],[.3,'#121110'],[1,'#191816']])});
  const face={fill:'#1d1e21',center:'#27292d',edge:'#0b0c0d'},F='avenir',wh='#efeeea';
  const sy=212,L=226,Rx=1054,sr=128;
  // 왼쪽 Power Reserve = 남은 한도 (바늘이 가지 않는 오른쪽 아래에 이름)
  s+=gauge(H,{kind:'fuel',cx:L,fit:1,cy:sy,r:sr,tone:'chrome',bw:14,face,labels:['0','20','40','60','80','100'],a0:-150,sweep:210,f:H.frac.min(d),minor:3,len:11,tw:2,size:19,font:F,nc:wh,ns:'line',nw:2.5,tail:0,hubR:8,
   under:H.band(L,sy,64,69,-150,-108,{fill:'#4a72c8'}),mid:H.text(L+36,sy+50,'남은 한도',{size:LB,fill:wh,font:F})+H.text(L+36,sy+70,'여유 %',{size:UN,fill:'#a9a9a9',font:F})});
  // 가운데 큰 원 = 토큰 속도
  const cy=232;
  s+=gauge(H,{kind:'rate',cx:640,cy,r:176,fit:1,tone:'chrome',bw:14,face,labels:H.rateScale(d,10),a0:-140,sweep:280,f:H.frac.rate(d),minor:4,len:14,tw:2.2,mw:1,size:23,font:F,nc:wh,ns:'line',nw:3,tail:0,hubR:9,
   mid:H.text(640,cy+56,'M tokens/시간',{size:LB,fill:'#d6d6d4',font:F})});
  // 소진 속도 창은 바늘이 가지 않는 아래쪽에 따로 묶고, 그 아래 트립
  s+=H.cl('gauge','burn',H.rect(598,cy+74,84,38,{r:5,fill:'#0b0c0e'})+H.rect(598,cy+74,84,38,{r:5,stroke:'#000',sw:1})+H.text(640,cy+100,H.fmt.burn(d.burn),{size:21,fill:wh,font:F})+H.text(640,cy+132,'소진 %/시간',{size:UN,fill:'#a9a9a9',font:F}));
  s+=H.cl('trip','',H.text(640,cy+154,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#a9a9a9',font:F}));
  // 오른쪽 연료·온도 갈래 계기: 왼쪽 호는 E(아래)→F(위), 오른쪽 호는 C(아래)→H(위)
  s+=H.bezel(Rx,sy,sr,14,{tone:'chrome'})+H.face(Rx,sy,sr,face)+glass(H,Rx,sy,sr);
  s+=H.ticks(Rx,sy,121,{a0:-150,sweep:120,n:4,minor:1,len:11,w:2,color:'#eee'})+H.ticks(Rx,sy,121,{a0:30,sweep:120,n:4,minor:1,len:11,w:2,color:'#eee'});
  const lt=(s2,a)=>{const [x,y]=H.pt(Rx,sy,90,a);return H.text(x,y,s2,{size:17,fill:wh,font:F,base:'central'});};
  s+=lt('F',-42)+lt('E',-138)+lt('H',42)+lt('C',138);
  s+=H.text(Rx,sy+78,'연료 · 온도',{size:UN,fill:'#bdbdbd',font:F});
  s+=H.needle(Rx,sy,109,-150+120*H.frac.fuel(d),{style:'line',w:2.5,color:wh,tail:0});
  s+=H.needle(Rx,sy,109,150-120*H.frac.heat(d),{style:'line',w:2.5,color:wh,tail:0});
  s+=H.hub(Rx,sy,8);
  // 아래 창: 옆 계기 축에 맞추고 같은 기준선
  // 오른쪽 창: 위 기간 기어 줄, 아래 기간 이름 · 작업 가능
  const WY=364,WH=56;
  s+=well(H,'w1',L-118,WY,236,WH,{fill:'#0d131d'})+H.lamps(L-78,WY+WH/2,d,{size:18,gap:52,off:'#34404e'});
  s+=well(H,'w2',Rx-118,WY,236,WH,{fill:'#0d131d'})+H.gear(Rx,WY+19,d,{gap:36,width:220,size:14,on:'#e6eeff',off:'#6f84a6',font:F});
  s+=H.text(Rx,WY+44,`${d.periodLabel} · 작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:UN,fill:'#a9bcdf',font:F});
  s+=H.brand(640,431,{size:12,fill:'#77736d',op:1,font:F});
  return s;}});

 // 23 · Bentley Continental GT 2019 — 굵은 크롬 테두리 화면, 가는 선 두 원
 O.theme({id:'23',name:'윙드 디지털',about:'굵은 크롬 테두리의 둥근 화면 안에 로즈골드 선으로 그린 두 원을 두고, 가운데에 기간과 합계, 아래 띠에 시각·경고등·기온을 모았습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1b1e23'],[1,'#08090b']])});
  const shape='M196 40 C470 22 810 22 1084 40 C1180 46 1222 70 1236 128 C1254 200 1254 280 1236 352 C1222 410 1180 434 1084 440 C810 458 470 458 196 440 C100 434 58 410 44 352 C26 280 26 200 44 128 C58 70 100 46 196 40Z';
  s+=H.path(shape,{fill:'#000',filter:H.shadow('fr',8,16,.7)});
  s+=H.path(shape,{fill:H.lin('sc',[[0,'#0b0b0e'],[1,'#030304']]),stroke:H.lin('cr',[[0,'#ffffff'],[.35,'#9aa0a7'],[.55,'#f2f3f4'],[.8,'#6b7077'],[1,'#c9cdd2']]),sw:16});
  s+=H.path(shape,{stroke:'#000',sw:2.5,op:.7});
  const rose='#d9b2a6',dim='#c4aaa2';
  const thin=(kind,cx,f,labels,lab,big,unit)=>{const cy=240,r=158;
   let o=H.circle(cx,cy,r,{stroke:rose,sw:2})+H.circle(cx,cy,r-9,{stroke:'#6a4a46',sw:1});
   o+=H.band(cx,cy,r-7.5,r-1.5,-135,-135+270*H.clamp(f),{fill:'#e9b9a8',op:.9});
   const tr=fitR(labels,-135,270,17,r-13);
   o+=H.ticks(cx,cy,tr,{a0:-135,sweep:270,n:labels.length-1,minor:4,len:11,mlen:5,w:1.8,mw:.9,color:'#f4e6e0',mcolor:'#a88c86'});
   o+=numsOut(H,cx,cy,tr,labels,{a0:-135,sweep:270,size:17,fill:'#f4e6e0',font:'avenir'});
   o+=H.path(`M${cx-56} ${cy+70}a56 34 0 1 0 112 0a56 34 0 1 0 -112 0`,{stroke:rose,sw:1.5,fill:'#0d0b0c'});
   o+=H.text(cx,cy+68,big,{size:22,fill:'#fff',font:'avenir'})+H.text(cx,cy+89,unit,{size:UN,fill:dim})+H.text(cx,cy+128,lab,{size:LB,fill:'#e6d6d0'});
   o+=H.needle(cx,cy,tr-11,-135+270*H.clamp(f),{style:'line',w:2.5,color:'#f6efe9',tail:0})+H.hub(cx,cy,7,{fill:'#3a3230',light:'#e9d6cf'});
   return H.cl('gauge',kind,o);};
  s+=thin('rate',330,H.frac.rate(d),H.rateScale(d,10,{every:2}),'토큰 속도',H.fmt.m(d.rate),'M tokens/시간');
  s+=thin('burn',950,H.frac.burn(d),H.burnScale(d,10,{every:2}),'소진 속도',H.fmt.burn(d.burn),'%/시간');
  // 가운데 정보 (원본의 날짜 띠·중앙 화면·아래 띠)
  s+=H.brand(640,74,{size:12,fill:'#8c7d78',op:1,font:'avenir'});
  s+=H.text(640,108,d.periodLabel,{size:15,fill:'#efe6e2',font:'avenir'});
  s+=H.line(540,124,740,124,{stroke:rose,op:.45});
  s+=H.gear(640,150,d,{gap:40,width:260,size:14,on:'#fff',off:'#8d8380',font:'avenir'});
  s+=H.text(640,236,H.fmt.m(d.tokens)+'M',{size:48,fill:'#fff',font:'avenir',weight:300})+H.text(640,262,'기간 합계 토큰',{size:UN,fill:dim});
  s+=H.text(640,302,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:15,fill:'#f0f0f0'})+H.text(640,326,`남은 한도 ${Math.round(d.minLeft)}% · 온도 ${Math.round(d.heat)}°`,{size:UN,fill:dim});
  // 아래 띠: 괄호선 안에 시각 · 경고등 · 기온
  const by=392;
  s+=H.path('M508 362 V356 H772 V362',{stroke:rose,sw:1,op:.5});
  s+=H.text(536,by,d.clock,{size:LB,fill:'#e6d6d0',font:'avenir',base:'central'})+H.text(744,by,cpuTxt(d),{size:LB,fill:'#e6d6d0',font:'avenir',base:'central'});
  s+=H.lamps(586,by,d,{size:16,gap:36,off:'#3a3536'});
  // 트립: 아래 띠 밑, 가운데 축
  s+=H.cl('trip','',H.text(640,416,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:dim,font:'avenir'}));
  return s;}});

 // 24 · Bugatti Chiron — 크롬 받침 위 가운데 아날로그, 양옆 푸른 화면
 O.theme({id:'24',name:'센트럴 아날로그',about:'가운데 크롬 테 아날로그 토큰 속도계가 양옆 푸른 화면 앞에 겹쳐 서고, 왼쪽 화면에 소진 속도 호, 오른쪽 화면에 세션을 띄웠습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#05070b'],[1,'#000']])});
  // 양옆 화면 (가운데 계기 뒤로 들어감)
  const scr=H.lin('sg',[[0,'#0f1a2c'],[1,'#03060c']]);
  const left='M40 112 Q40 86 66 84 L470 64 V416 L66 402 Q40 400 40 374Z';
  const right='M1240 112 Q1240 86 1214 84 L810 64 V416 L1214 402 Q1240 400 1240 374Z';
  for(const p of [left,right])s+=H.path(p,{fill:scr,filter:H.shadow('sd'+p.length,4,10,.6)})+H.path(p,{stroke:'#8fa2bd',sw:1.5,op:.35});
  // 왼쪽: 소진 속도 디지털 호
  const lx=264,ly=244,blue='#3f8fff';
  // 숫자는 눈금 안쪽. 넓은 숫자(0.4)는 눈금에 닿지 않게 안쪽으로 당깁니다
  const BL=H.burnScale(d,5),bf=ringFit(BL,ref(20,5),-120,165,15,116,0);
  let bg=H.arcBars(lx,ly,152,H.frac.burn(d),{a0:-120,sweep:165,n:33,w:12,fill:blue,off:'#15253d'});
  bg+=H.ticks(lx,ly,136,{a0:-120,sweep:165,n:BL.length-1,minor:0,len:6,w:2,color:'#5a8acc'});
  bg+=numsAt(H,lx,ly,bf.rs,BL,{a0:-120,sweep:165,size:15,fill:'#8fb6f0',font:'helv'});
  bg+=H.text(lx+6,ly+24,H.fmt.burn(d.burn),{size:56,fill:'#e6efff',font:'helv',weight:300});
  bg+=H.text(lx+6,ly+54,'소진 속도',{size:LB,fill:'#a9c2e8'})+H.text(lx+6,ly+74,'%/시간',{size:UN,fill:'#6f8fbf'});
  s+=H.cl('gauge','burn',bg);
  const by=372;
  s+=H.text(84,by,'누적 '+H.fmt.odo(d.odo)+' M',{size:UN,fill:'#6f8fbf',anchor:'start',base:'central'})+H.cl('trip','',H.text(196,by,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#6f8fbf',anchor:'start',base:'central'}))+H.text(420,by,'작업 가능 '+H.fmt.hours(d.rangeH),{size:LB,fill:'#b9d0f2',anchor:'end',base:'central'});
  // 오른쪽: 세션과 기간
  s+=H.text(860,118,'세션',{size:LB,fill:'#7fb0ff',anchor:'start',weight:600})+H.text(1196,118,d.clock,{size:LB,fill:'#8fa8cc',anchor:'end'});
  s+=H.sessions(860,152,336,{rows:5,lh:30,fill:'#d2e0f5',dim:'#7f98bf',size:LB});
  s+=H.gear(1028,322,d,{gap:46,width:336,size:14,on:'#fff',off:'#7a8aa3'});
  s+=H.lamps(976,by,d,{size:18,gap:36,off:'#22324a'});
  const cx=640,cy=232;
  s+=gauge(H,{kind:'rate',cx,cy,r:176,fit:1,tone:'chrome',bw:14,face:{fill:'#0d131e',center:'#162034',edge:'#05070b'},labels:H.rateScale(d,10),a0:-140,sweep:280,f:H.frac.rate(d),minor:4,len:16,mlen:7,tw:2,mw:1,size:21,tick:'#e6ebf2',mtick:'#8e9bb0',num:'#e6ebf2',nc:'#e9edf2',nw:6,hubR:14,hubFill:'#5a5e64',hubLight:'#f0f2f4',
   mid:H.text(cx,cy+52,'M tokens/시간',{size:UN,fill:'#9aa8bf'})+H.rect(cx-60,cy+70,120,44,{r:6,fill:'#000',stroke:'#3a4558'})+H.text(cx,cy+101,H.fmt.m(d.rate),{size:28,fill:'#fff',font:'helv',weight:300})+H.brand(cx,cy+142,{size:12,fill:'#7d8aa0',op:1})});
  return s;}});

 // 25 · Aston Martin DB9 — 은빛 금속 판, 반대 방향으로 도는 회전계
 O.theme({id:'25',name:'역회전 쌍둥이',about:'은빛 금속 판 위에 다이얼 두 개를 대칭으로 두고, 오른쪽 토큰 속도계는 반대 방향(시계 반대)으로 올라갑니다. 기어 창과 경고등 창은 두 원 사이 축에 둡니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#141416'],[1,'#060607']])});
  s+=H.housing('M30 438 C30 138 150 42 330 36 H950 C1130 42 1250 138 1250 438 Q1250 452 1236 452 H44 Q30 452 30 438Z',{top:'#222326',bottom:'#0b0b0d',rim:.12});
  const plate='M74 426 C74 160 178 80 340 74 H940 C1102 80 1206 160 1206 426Z';
  s+=H.path(plate,{fill:H.lin('m',[[0,'#d5d8dc'],[.55,'#a6aaaf'],[1,'#74787d']])});
  s+=H.path(plate,{fill:H.lin('mv',[[0,'#000',.35],[.08,'#000',0]])})+H.path(plate,{stroke:'#fff',sw:1,op:.4});
  const face={fill:'#cdd0d4',center:'#e7e9eb',edge:'#8f9398'},F='helv',lcd='#dfe23e',cy=246;
  const big=(kind,cx,labels,sw,a0,f,lab,unit,r1,r2,red)=>gauge(H,{kind,cx,cy,r:148,fit:1,tone:'satin',bw:12,face,labels,a0,sweep:sw,f,minor:4,len:12,mlen:6,tw:2.6,mw:1.2,tick:'#1e1e1e',num:'#1a1a1a',size:19,font:F,red,redColor:'#c8301e',ns:'taper',nc:'#1b1b1b',nw:5,tail:18,hubR:11,hubFill:'#2a2a2a',hubLight:'#8a8a8a',glassOp:.12,
   mid:H.rect(cx-48,cy+36,96,50,{r:4,fill:'#0b0b0b'})+H.rect(cx-48,cy+36,96,50,{r:4,stroke:'#5b5e62',sw:1})+H.text(cx,cy+60,r1,{size:20,fill:lcd,font:'din'})+H.text(cx,cy+78,r2,{size:UN,fill:'#a9ab52',font:'din'})+H.text(cx,cy+104,unit,{size:UN,fill:'#3a3a3a',font:F})+H.text(cx,cy+122,lab,{size:LB,fill:'#1e1e1e',font:F,weight:600})});
  s+=big('burn',476,H.burnScale(d,10),270,-135,H.frac.burn(d),'소진 속도','%/시간',H.fmt.burn(d.burn),H.fmt.odo(d.odo)+' M');
  // 반대 방향: 오른쪽 아래에서 시작해 시계 반대로
  s+=big('rate',804,H.rateScale(d,10,{every:2}),-270,135,H.frac.rate(d),'토큰 속도','M tokens/시간',H.fmt.m(d.rate),d.periodLabel,.8);
  const small=(kind,cx,f,lo,hi,lab)=>minor(H,{kind,cx,cy:296,r:64,f,lo,hi,label:lab,tone:'satin',bw:8,face,tick:'#222',num:'#222',labelFill:'#2a2a2a',nc:'#1b1b1b'});
  s+=small('fuel',206,H.frac.min(d),'E','F','남은 한도')+small('heat',1074,H.frac.heat(d),'C','H','엔진 온도');
  // 작은 계기 아래 같은 기준선의 LCD 창 둘: 왼쪽 기간 기어 줄, 오른쪽 트립
  const lcdWin=(cx)=>H.rect(cx-110,382,220,32,{r:5,fill:'#0b0b0b'})+H.rect(cx-110,382,220,32,{r:5,stroke:'#5b5e62'});
  s+=lcdWin(206)+H.gear(206,398,d,{gap:32,width:204,size:14,on:lcd,off:'#7f8140',font:'din'});
  s+=lcdWin(1074)+H.cl('trip','',H.text(1074,398,`트립 ${H.fmt.trip(d.trip)}M`,{size:15,fill:lcd,font:'din',base:'central'}));
  // 두 원 사이 축: 위 기어 창, 아래 경고등 창
  s+=H.rect(594,102,92,38,{r:5,fill:'#0b0b0b'})+H.rect(594,102,92,38,{r:5,stroke:'#5b5e62'})+H.text(626,129,d.period,{size:21,fill:lcd,font:'din'})+H.text(668,127,'1top',{size:11,fill:'#8c8e4a',font:'din'});
  s+=H.rect(568,366,144,34,{r:5,fill:'#0b0b0b'})+H.rect(568,366,144,34,{r:5,stroke:'#5b5e62'})+H.lamps(586,383,d,{size:16,gap:36,off:'#34363a'});
  return s;}});

 // 26 · McLaren 720S — 후드 아래 넓은 화면, 회전 호와 큰 숫자, 주황 기어
 O.theme({id:'26',name:'슬림 띠',about:'후드 아래 넓은 화면 가운데에 회전 호와 큰 숫자·주황 기어를 두고, 양옆 줄에 소진·누적 정보를 정렬했습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('in',[[0,'#26272a'],[.6,'#121315'],[1,'#08090a']])});
  s+=H.housing('M22 462 C28 132 150 20 640 16 C1130 20 1252 132 1258 462Z',{top:'#26272a',bottom:'#0b0b0c',rim:.14});
  const scr='M70 446 C76 168 190 66 640 62 C1090 66 1204 168 1210 446Z';
  s+=H.path(scr,{fill:'#000'})+H.path(scr,{fill:H.lin('sg',[[0,'#0e0f12'],[1,'#060708']]),stroke:'#000',sw:3});
  const cx=640,cy=262,r=184,a0=-120,sw=240,org='#ff7a1a',f=H.frac.rate(d);
  // 회전 호: 바깥 진행 띠 → 눈금 → 숫자 (빨간 구역은 원본처럼 0.8부터)
  let g=H.band(cx,cy,r-4,r+2,a0,a0+sw,{fill:'#1c1e22'})+H.band(cx,cy,r-4,r+2,a0,a0+sw*f,{fill:'#f4f4f4'});
  g+=H.band(cx,cy,r+5,r+9,a0+sw*.8,a0+sw,{fill:'#e3201a'});
  g+=H.ticks(cx,cy,r-10,{a0,sweep:sw,n:5,minor:3,len:16,mlen:8,w:2.6,mw:1.2,color:'#e8e8e8',mcolor:'#8a8d92',red:.8,redColor:'#e3201a'});
  // 숫자는 눈금 안쪽. 넓은 숫자(1000)는 눈금에 닿지 않게 안쪽으로 당깁니다
  const RL=H.rateScale(d,10,{every:2}),rf=ringFit(RL,R2,a0,sw,19,r-46,0);
  g+=numsAt(H,cx,cy,rf.rs,RL,{a0,sweep:sw,size:19,fill:'#e8e8e8',font:'din',red:.8,redColor:'#ff5a3a'});
  // 진행 끝 표시: 띠 끝의 흰 막대 (d에서 계산)
  const [ax,ay]=H.pt(cx,cy,r-28,a0+sw*f),[bx,by2]=H.pt(cx,cy,r+2,a0+sw*f);
  g+=H.line(ax,ay,bx,by2,{stroke:'#fff',sw:4,cap:'round'});
  g+=H.text(cx,cy+18,H.fmt.m(d.rate),{size:84,fill:'#fff',font:'din',weight:600});
  g+=H.text(cx,cy+52,'M tokens/시간',{size:LB,fill:'#9a9da3'});
  s+=H.cl('gauge','rate',g);
  s+=H.text(cx,cy+118,d.period,{size:44,fill:org,font:'din',weight:700});
  // 양옆 정보 줄
  const row=(x0,x1,y,k,v)=>H.text(x0,y,k,{size:LB,fill:'#8d9097',anchor:'start',base:'central'})+H.text(x1,y,v,{size:18,fill:'#f2f2f2',anchor:'end',font:'din',base:'central'})+H.line(x0,y+18,x1,y+18,{stroke:'#fff',op:.07});
  const L0=150,L1=410,R0=870,R1=1130,ys=[186,232,278,324];
  s+=H.cl('gauge','burn',row(L0,L1,ys[0],'소진 속도',H.fmt.burn(d.burn)+' %/시간'))+(hasCruise(d)?row(L0,L1,ys[1],'적정 속도',cruise(d)+' %/시간'):row(L0,L1,ys[1],'CPU',Math.round(d.cpu)+'%'))+row(L0,L1,ys[2],'작업 가능',H.fmt.hours(d.rangeH))+H.cl('gauge','fuel',row(L0,L1,ys[3],'남은 한도',Math.round(d.minLeft)+'%'));
  s+=row(R0,R1,ys[0],'누적',H.fmt.odo(d.odo)+' M')+H.cl('trip','',row(R0,R1,ys[1],'트립',H.fmt.trip(d.trip)+'M'))+H.cl('gauge','heat',row(R0,R1,ys[2],'엔진 온도',Math.round(d.heat)+'°'))+row(R0,R1,ys[3],'시각',d.clock);
  // 바닥 기준선: 왼쪽 기간 기어 줄(옆 정보 줄 폭) · 경고등 · 오른쪽 기간 이름과 1top
  const by=398;
  s+=H.gear((L0+L1)/2,by,d,{gap:40,width:L1-L0,size:14,on:org,off:'#7c7f86',font:'din'});
  s+=H.lamps(cx-57,by,d,{size:18,gap:38,off:'#2a2c30'});
  s+=H.text(R0,by,d.periodLabel,{size:LB,fill:'#c9ccd1',anchor:'start',base:'central'});
  s+=H.brand(R1,by+4,{size:12,fill:'#6f7278',op:1,anchor:'end'});
  return s;}});

 // 27 · Jaguar E-Type Series 1 — 운전자 앞 큰 두 원, 알루미늄 판의 작은 계기와 토글 스위치
 O.theme({id:'27',name:'토글 패널',about:'검은 가죽 대시 위 크롬 링 큰 두 원과, 같은 높이의 알루미늄 판 위 작은 계기 셋·기간 토글 스위치 줄을 나란히 두었습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1d1e21'],[1,'#08090a']])});
  const face={fill:'#121418',center:'#1b1e23',edge:'#050607'};
  // 알루미늄 판과 검은 대시: 같은 위·아래 선
  const T=48,Bt=444;
  s+=H.rect(24,T+4,452,Bt-T,{r:10,fill:'#000',op:.55})+H.rect(24,T,452,Bt-T,{r:10,fill:H.lin('al',[[0,'#d6dade'],[.5,'#b4b9be'],[1,'#969ca2']])})+H.rect(24.5,T+.5,451,Bt-T-1,{r:10,stroke:'#fff',sw:1,op:.55});
  s+=H.housing(`M520 ${T+16} Q520 ${T} 536 ${T} H1240 Q1256 ${T} 1256 ${T+16} V${Bt-16} Q1256 ${Bt} 1240 ${Bt} H536 Q520 ${Bt} 520 ${Bt-16}Z`,{top:'#232427',bottom:'#0b0b0c',rim:.12});
  // 작은 계기 셋
  const sm=(cx,f,lab,lo,hi,kind)=>minor(H,{kind,cx,cy:140,r:54,f,label:lab,lo,hi,tone:'chrome',bw:8,face,nc:'#f2f2f2'});
  s+=sm(110,H.frac.heat(d),'엔진 온도','C','H','heat')+sm(250,H.frac.min(d),'남은 한도','E','F','fuel')+sm(390,H.frac.cpu(d),'CPU','0','100');
  // 토글 스위치 줄 (기간)
  const py=292;
  s+=H.line(56,py+48,444,py+48,{stroke:'#000',op:.12});
  // 판 안쪽 폭(기본 6개 × 68) 안에서 개수에 맞춰 간격을 나눕니다
  const gn=d.gears.length,gsp=Math.min(68,408/gn);let out='';
  d.gears.forEach((g,i)=>{const x=250+(i-(gn-1)/2)*gsp,on=g===d.period;let s='';
   s+=H.circle(x,py,16,{fill:H.rad2('tb'+i,[[0,'#f4f5f6'],[.7,'#8a8f95'],[1,'#4a4e53']],{cx:.4,cy:.35})})+H.circle(x,py,16,{stroke:'#000',sw:1,op:.35});
   s+=H.path(on?`M${x-4} ${py}L${x-3} ${py-36}Q${x} ${py-40} ${x+3} ${py-36}L${x+4} ${py}Z`:`M${x-4} ${py}L${x-3} ${py+36}Q${x} ${py+40} ${x+3} ${py+36}L${x+4} ${py}Z`,{fill:H.lin('bat'+i,[[0,'#ffffff'],[1,'#8f949a']],{dir:[0,0,1,0]})});
   s+=H.text(x,py+70,g,{size:on?15:14,fill:on?'#111':'#41454a',weight:on?700:400});
   out+=H.cl('period',g,s);});
  s+=out;
  s+=H.rect(44,Bt-60,412,40,{r:6,fill:'#141619'})+H.rect(44,Bt-60,412,8,{r:6,fill:H.lin('ls',[[0,'#000',.6],[1,'#000',0]])});
  s+=H.lamps(76,Bt-40,d,{size:18,gap:40,off:'#3e4247'})+H.cl('trip','',H.text(250,Bt-40,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#c9cdd2',anchor:'start',base:'central'}))+H.brand(436,Bt-36,{size:12,fill:'#8e9399',op:1,anchor:'end'});
  // 큰 두 원
  const cy=246;
  const big=(kind,cx,labels,f,lab,unit,red,box,bw=128)=>gauge(H,{kind,cx,cy,r:156,fit:1,tone:'chrome',bw:14,face,labels,f,minor:4,len:12,tw:2.2,size:20,red,redColor:'#e04a2a',ns:'line',nw:3,nc:'#f4f4f4',tail:16,hubR:10,
   mid:H.text(cx,cy+46,lab,{size:LB,fill:'#e2e2e2'})+H.text(cx,cy+65,unit,{size:UN,fill:'#9a9a9a'})+H.rect(cx-bw/2,cy+80,bw,28,{r:3,fill:'#000',stroke:'#2e3034'})+box});
  s+=big('burn',698,H.burnScale(d,10),H.frac.burn(d),'소진 속도','%/시간',undefined,H.text(698,cy+99,'작업 가능 '+H.fmt.hours(d.rangeH),{size:LB,fill:'#eee'}));
  s+=big('rate',1078,H.rateScale(d,10),H.frac.rate(d),'토큰 속도','M tokens/시간',.8,H.text(1078,cy+100,H.fmt.odo(d.odo,6),{size:16,fill:'#eee',font:'helv',ls:1.5}),108);
  return s;}});

 // 28 · Range Rover — 두꺼운 눈금 링 안쪽 검은 원과 큰 숫자, 가운데 세션 상태
 O.theme({id:'28',name:'링 디지털',about:'넓은 화면 양쪽 두꺼운 눈금 링에 은빛 진행 띠를 채우고 안쪽 검은 원에 큰 숫자를, 가운데 차량 자리에 세션 상태를 두었습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1c1b19'],[1,'#080808']])});
  s+=H.housing('M28 66 Q640 26 1252 66 L1238 438 Q640 466 42 438Z',{top:'#1a1b1d',bottom:'#08090a',rim:.14});
  const scr='M52 86 Q640 50 1228 86 L1216 420 Q640 446 64 420Z';
  s+=H.path(scr,{fill:H.lin('sc',[[0,'#161a1f'],[1,'#07080a']])})+H.path(scr,{stroke:'#000',sw:2});
  const cy=240,Ro=146,Ri=108,a0=-135,sw=270;
  const ring=(kind,cx,labels,f,top,big,unit,red)=>{let o='';
   o+=H.band(cx,cy,Ri,Ro,a0,a0+sw,{fill:'#2a2d32'});
   o+=H.band(cx,cy,Ri,Ro,a0,a0+sw*H.clamp(f),{fill:H.lin('pg'+cx,[[0,'#e8eaed'],[1,'#8f949a']]),op:.6});
   o+=H.circle(cx,cy,Ro+1,{stroke:'#a4a9b0',sw:1.5,op:.8})+H.circle(cx,cy,Ri,{fill:'#030304',stroke:'#000',sw:2});
   o+=H.ticks(cx,cy,Ro-2,{a0,sweep:sw,n:labels.length-1,minor:4,len:9,mlen:5,w:2,mw:1,color:'#f2f3f5',mcolor:'#9aa0a6',red,redColor:'#e8402a'});
   o+=numsIn(H,cx,cy,Ri-2,labels,{a0,sweep:sw,size:15,fill:'#f2f3f5',font:'helv',weight:600,red,redColor:'#ff5a3a'});
   // 진행 끝 표시 (d에서 계산)
   const a=a0+sw*H.clamp(f),[x1,y1]=H.pt(cx,cy,Ri+1,a),[x2,y2]=H.pt(cx,cy,Ro-1,a);o+=H.line(x1,y1,x2,y2,{stroke:'#fff',sw:3});
   // 끝 숫자가 4자리(1000)면 안쪽으로 들어오므로 단위 글자를 조금 올려 틈을 둡니다
   const up=Math.max(0,labels[labels.length-1].length-3)*4;
   o+=H.text(cx,cy-46,top,{size:LB,fill:'#aeb3b9'})+H.text(cx,cy+20,big,{size:60,fill:'#fff',font:'helv',weight:300})+H.text(cx,cy+50-up,unit,{size:LB,fill:'#aeb3b9'});
   return H.cl('gauge',kind,o);};
  // 아래 틈의 분할 호 (원본의 연료·온도 막대)와 그 이름: 링과 따로 묶습니다
  const gap=(kind,cx,frac,cols,lab)=>H.cl('gauge',kind,H.arcBars(cx,cy,Ro-4,frac,{a0:146,sweep:68,n:10,w:12,colors:cols,off:'#2a2d32'})+H.text(cx,cy+Ro+24,lab,{size:LB,fill:'#c9cdd2'}));
  s+=ring('rate',290,H.rateScale(d,10,{every:2}),H.frac.rate(d),'토큰 속도',H.fmt.m(d.rate),'M tokens/시간',.8);
  s+=gap('fuel',290,H.frac.min(d),[[0,'#e8402a'],[.25,'#f2f3f5']],`남은 한도 ${Math.round(d.minLeft)}% · 작업 가능 ${H.fmt.hours(d.rangeH)}`);
  s+=ring('burn',990,H.burnScale(d,10,{every:2}),H.frac.burn(d),`소진 ${H.fmt.burn(d.burn)} %/시간`,d.period,d.periodLabel,undefined);
  s+=gap('heat',990,H.frac.heat(d),[[0,'#4a8ad8'],[.75,'#e8402a']],`엔진 온도 ${Math.round(d.heat)}°`);
  // 위 기준선: 1top · 시각 · 기온
  const ty=112;
  s+=H.brand(92,ty,{size:12,fill:'#6f7378',op:1,anchor:'start'});
  s+=H.text(586,ty,d.clock,{size:LB,fill:'#d6d8db',base:'central'})+H.text(694,ty,cpuTxt(d),{size:LB,fill:'#d6d8db',base:'central'});
  s+=H.lamps(574,150,d,{size:18,gap:40,off:'#34363a'});
  // 가운데: 세션 상태 (원본의 차량 자리)
  s+=H.rect(596,182,88,140,{r:34,fill:'#141518'})+H.rect(596,182,88,140,{r:34,stroke:'#9ca1a8',sw:1.5,op:.7});
  for(let i=0;i<d.sessions.total&&i<12;i++){const st=i<d.sessions.working?'#39d98a':i<d.sessions.working+d.sessions.waiting?'#f2b233':'#4d4f53';s+=H.circle(620+(i%3)*20,208+Math.floor(i/3)*30,6,{fill:st});}
  s+=H.text(640,350,`작업 ${d.sessions.working} · 대기 ${d.sessions.waiting}`,{size:15,fill:'#e6e6e6'});
  // 기간 기어 줄: 두 링 사이 가운데 축
  s+=H.gear(640,377,d,{gap:40,width:300,size:14,on:'#fff',off:'#7d8288'});
  s+=H.text(632,cy+Ro+24,`${H.fmt.odo(d.odo)} M`,{size:UN,fill:'#8b9096',anchor:'end'})+H.text(640,cy+Ro+24,'·',{size:UN,fill:'#8b9096'});
  s+=H.cl('trip','',H.text(648,cy+Ro+24,`트립 ${H.fmt.trip(d.trip)}M`,{size:UN,fill:'#8b9096',anchor:'start'}));
  return s;}});
})(window.OneTop);
