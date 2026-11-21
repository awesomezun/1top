/* 40–50 (v4.0.0: 습작 징후를 없앤 판) */
(function(O){
 'use strict';
 // 200M·20% 기본 범위의 눈금 숫자 (숫자 링 위치를 맞추는 기준으로만 씁니다)
 const DEF={rateMax:200e6,burnMax:20};
 // 적정 소진 속도 표기 (0.19, 1.9, 4.75처럼 꼬리 0 없이)
 const cru=d=>O.fmtScale(d.cruise);
 // 적정 속도를 알 때만 그 비율(0–1)을, 모르면 null을 돌려줍니다
 const cruF=d=>d.cruise==null||!isFinite(d.cruise)?null:d.cruise/d.burnMax;
 // CPU 표기 (값이 없으면 빈 글자)
 const cpuT=d=>d.cpu==null||!isFinite(d.cpu)?'':`CPU ${Math.round(d.cpu)}%`;
 // 칸이 넉넉한 기계식 주행계 (다이얼 숫자와 같은 글꼴을 씁니다)
 function odo2(H,x,y,str,o={}){
  const cw=o.cw||16,ch=o.ch||20,n=str.length;let out=H.rect(x-2,y-2,cw*n+4,ch+4,{fill:o.frame||'#000',r:2});
  for(let i=0;i<n;i++){const last=i>=n-(o.tenths||0);
   out+=H.rect(x+i*cw+1,y,cw-2,ch,{fill:last?(o.tbg||'#e8e2d0'):(o.bg||'#111')});
   out+=H.text(x+i*cw+cw/2,y+ch/2+1,str[i],{size:o.fs||Math.round(ch*.6),fill:last?(o.tfg||'#111'):(o.fg||'#e8e2d0'),font:o.font||'helv',weight:600,base:'central'});}
  // 숫자 바퀴의 위아래 그늘
  out+=H.rect(x,y,cw*n,ch,{fill:H.lin('og'+Math.round(x)+'_'+Math.round(y),[[0,'#000',.45],[.3,'#000',0],[.7,'#000',0],[1,'#000',.45]])});
  return out;
 }
 // 허브 밖 바깥 구간만 그리는 바늘 (가운데 화면 뒤에서 나오는 바늘)
 //  w: 밑동 폭, w1: 끝 폭(기본 w×.4)
 function ptr(H,cx,cy,r0,r1,a,w,color,w1=w*.4){
  const g=`<path d="M${-w/2} ${-r0} L${-w1/2} ${-r1} L${w1/2} ${-r1} L${w/2} ${-r0}Z" fill="${color}"/>`;
  return `<g transform="translate(${cx} ${cy}) rotate(${H.r2(a)})"><g transform="translate(1.5 2)" opacity=".35">${g.replace(/fill="[^"]+"/,'fill="#000"')}</g>${g}</g>`;
 }
 // 위쪽 빛을 받는 크롬 테두리 선
 const chromeStroke=(H,n)=>H.lin(n,[[0,'#f2f4f6'],[.3,'#8d939b'],[.55,'#d5d9de'],[1,'#5d636a']],{dir:[0,0,0,1]});
 // 창 안에 중심이 든 숫자만 그리는 드럼 (창 밖 숫자가 라벨과 겹치지 않게)
 function drum(H,x,y,w,h,value,o){
  const step=o.step,cur=value/step,base=Math.floor(cur),fr=cur-base,lh=o.lh,n='dr'+Math.round(x);
  const clip=H.clip(n,`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>`);let t='';
  for(let k=-2;k<=3;k++){const v=(base+k)*step;if(v<0||v>o.max)continue;const yy=y+h/2+(fr-k)*lh;if(yy<y+4||yy>y+h-4)continue;
   t+=H.text(x+w/2,yy,o.fmt?o.fmt(v):String(v),{size:o.size,fill:o.fill,font:o.font,weight:o.weight,base:'central'});}
  return H.rect(x,y,w,h,{fill:o.bg,r:4})+H.g(t,{clip})+H.rect(x,y,w,h,{fill:H.lin(n+'s',[[0,'#000',.6],[.28,'#000',0],[.72,'#000',0],[1,'#000',.6]]),r:4})+H.line(x-4,y+h/2,x+w+4,y+h/2,{stroke:o.mark,sw:2});
 }
 // 눈금 숫자: 글자 상자가 눈금 바깥 끝(rt)에서 gap 이상 떨어지도록 각도마다 반지름을 정합니다 (지지 함수 w/2·|sin a| + h/2·|cos a|)
 //  o.cw: 글자 하나의 반폭(기본 size×.29), o.hh: 글자 반높이(기본 size×.37)
 const numPos=(t,a,rt,o)=>{const sz=o.size||16,hw=t.length*(o.cw??sz*.29),hh=o.hh??sz*.37,ra=a*Math.PI/180,ux=Math.abs(Math.sin(ra)),uy=Math.abs(Math.cos(ra));
  const rc=rt+(o.gap??7)+hw*ux+hh*uy;return {rc,hw,hh,ext:Math.hypot(rc*ux+hw,rc*uy+hh)};};
 function numsS(H,cx,cy,rt,labels,o={}){
  const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1,sz=o.size||16;
  return labels.map((t,i)=>{if(!t)return '';const f=i/n,a=a0+sw*f,[x,y]=H.pt(cx,cy,numPos(t,a,rt,o).rc,a);const red=o.red!=null&&f>=o.red;
   return H.text(x,y,t,{size:sz,fill:red?(o.redColor||'#e53b2c'):o.fill,font:o.font,weight:o.weight,base:'central'});}).join('');
 }
 // 숫자 글자 상자의 가장 먼 모서리 (중심에서의 거리)
 const extent=(labels,rt,o)=>{const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1;let m=0;labels.forEach((t,i)=>{if(t)m=Math.max(m,numPos(t,a0+sw*i/n,rt,o).ext);});return m;};
 // 눈금 고리 반지름: 기본 범위 숫자가 닿는 바깥 한계 안에 지금 숫자가 들어가도록 눈금 고리를 안쪽으로 옮깁니다.
 //  글자 크기는 그대로 두고, 기본 범위(200M·20%)에서는 rt를 바꾸지 않습니다.
 function ringFit(labels,defLabels,rt,o={}){const lim=extent(defLabels,rt,o)+.5;let r=rt;while(r>rt-60&&extent(labels,r,o)>lim)r-=.5;return r;}
 // 속도·소진 눈금 숫자와 그 기본 범위 숫자
 const rateL=(H,d,n,every)=>[H.rateScale(d,n,{every}),H.rateScale(DEF,n,{every})];
 const burnL=(H,d,n,every)=>[H.burnScale(d,n,{every}),H.burnScale(DEF,n,{every})];
 // 기간 기어 줄: 칸 폭(width) 안에 넣고, 간격을 먼저 줄인 뒤 넘치면 글자를 13px까지 줄입니다
 //  o: gap, width, size(꺼진 기어), onSize(현재 기어), on, off, box, font
 function gearRow(H,d,x,y,o={}){
  const n=d.gears.length,L=Math.max(...d.gears.map(g=>g.length));let gap=o.gap||34;if(o.width&&n>1)gap=Math.min(gap,o.width/n);
  let size=o.size||14,on=o.onSize||size+1;const fit=(gap-5)/(L*.6);if(fit<size)size=Math.max(13,fit);
  // 현재 기어는 양옆 기어와 5px 이상 떨어지는 만큼만 크게 씁니다
  const Lc=String(d.period).length,onFit=(2*(gap-5)-L*.6*size)/(Lc*.6);if(onFit<on)on=Math.max(size,onFit);
  let out='';
  d.gears.forEach((g,i)=>{const cur=g===d.period,px=x+(i-(n-1)/2)*gap;let one='';
   if(cur&&o.box){const bw=Math.max(gap-4,g.length*on*.62+10);one+=H.rect(px-bw/2,y-on*.85,bw,on*1.4,{r:o.r??3,fill:o.box});}
   one+=H.text(px,y,g,{size:cur?on:size,fill:cur?(o.on||'#fff'):(o.off||'#777'),weight:cur?700:400,font:o.font||'ui',base:'central'});
   out+=H.cl('period',g,one);});
  return out;
 }
 // 칸으로 된 경고등 줄: 칸 바탕과 아이콘을 한 덩어리로 묶어 누를 수 있게 합니다
 const LAMPS=[['waiting','#f2b233'],['reconnect','#f2b233'],['empty','#ef4a3c'],['late','#f2b233']];
 function lampCells(H,d,x0,y,cw,o){let out='';
  LAMPS.forEach(([k,c],i)=>{const on=d.lamps[k]>0,col=on?c:o.off,x=x0+i*cw;
   out+=H.cl('alert',k,H.rect(x+o.pad,y,cw-2*o.pad,o.h,{r:2,fill:o.bg,stroke:o.stroke})+H.g(O.ICONS[k](col,o.size),{t:`translate(${H.r2(x+cw/2-o.size/2)} ${H.r2(y+o.h/2-o.size/2)})`}));});
  return out;}
 // 드럼 한 칸 값: 최대값의 1/20을 1·2·5 꼴로 맞춥니다 (200→10, 2→0.1, 50→5, 1000→50)
 const drumStep=max=>{const s=max/20,e=10**Math.floor(Math.log10(s)+1e-9),m=Math.round(s/e*100)/100;return (m===2.5?5:m)*e;};
 // 눈금 숫자 링 바깥에 바늘 끝이 닿는 표준 계기 조각
 const tickTip=(H,cx,cy,a,r0,r1,col,sw)=>{const [x1,y1]=H.pt(cx,cy,r0,a),[x2,y2]=H.pt(cx,cy,r1,a);return H.line(x1,y1,x2,y2,{stroke:col,sw});};

 // 40 · Chrysler 300 (2015) — 땅콩 모양 하우징, 파란 조명 링, 가운데 디지털 화면
 O.theme({id:'40',name:'블루 헤일로',about:'두 원을 잇는 땅콩 모양 크롬 테두리 안에 파란 조명 링과 크롬 베젤 두 계기를 두고, 가운데 화면에 테두리 숫자·막대·경고등을 한 판으로 정리했습니다.',draw(H,d){
  const CY=240,LX=296,RX=984;
  let s=H.rect(0,0,1280,480,{fill:'#000'});
  const shell='M296 32 C440 32 500 88 640 88 C780 88 840 32 984 32 A208 208 0 0 1 984 448 C840 448 780 410 640 410 C500 410 440 448 296 448 A208 208 0 0 1 296 32Z';
  s+=H.housing(shell,{top:'#0d1020',bottom:'#03040a',rim:0});
  s+=H.path(shell,{stroke:'#4a55c8',sw:7,op:.22});
  s+=H.path(shell,{stroke:chromeStroke(H,'cs'),sw:3});
  const ring=H.rad2('ring',[[0,'#000'],[.84,'#000'],[.875,'#0f2a9a'],[.94,'#3a6cff'],[.985,'#1c3fd0'],[1,'#081040']]);
  const dial=(key,cx,f,[labels,def],lab,unit,val,cruise)=>{
   const no={size:20,fill:'#e9eeff',font:'helv'},rt=ringFit(labels,def,108,no);
   let o=H.circle(cx,CY,184,{fill:ring});
   o+=H.bezel(cx,CY,153,7,{tone:'chrome',shadow:false});
   o+=H.face(cx,CY,153,{fill:'#0a0e1a',center:'#131a2e',edge:'#03040a'});
   o+=numsS(H,cx,CY,rt,labels,no);
   o+=H.ticks(cx,CY,rt,{n:labels.length-1,minor:4,len:13,mlen:7,w:3,mw:1.4,color:'#86a6ff',mcolor:'#3f63dc'});
   o+=H.circle(cx,CY,56,{stroke:'#5b6a94',sw:1.5});
   if(cruise!=null)o+=tickTip(H,cx,CY,-135+270*cruise,rt,rt-15,'#54f0b0',4);
   o+=H.text(cx,CY+76,val,{size:22,fill:'#fff',font:'helv',weight:500});
   o+=H.text(cx,CY+97,unit,{size:13,fill:'#aab4d4'});
   o+=H.text(cx,CY+117,lab,{size:14,fill:'#8fa8ff'});
   o+=H.needle(cx,CY,rt-7,-135+270*f,{style:'baton',w:5,color:'#f2f5ff',tail:22})+H.hub(cx,CY,12,{fill:'#1d3fb8',light:'#7c9bff'});
   return H.cl('gauge',key,o);};
  s+=dial('rate',LX,H.frac.rate(d),rateL(H,d,10,2),'토큰 속도','M tokens/시간',H.fmt.m(d.rate));
  s+=dial('burn',RX,H.frac.burn(d),burnL(H,d,10,1),'소진 속도','%/시간',H.fmt.burn(d.burn),cruF(d));
  // 가운데 화면
  const X0=488,X1=792;
  s+=H.rect(X0-3,105,X1-X0+6,286,{r:13,fill:'#0b0e1c'});
  s+=H.rect(X0,108,X1-X0,280,{r:10,fill:H.lin('scr',[[0,'#070a16'],[1,'#020309']]),stroke:'#1b2552'});
  s+=H.text(X0+18,138,H.fmt.hours(d.rangeH),{size:15,fill:'#fff',anchor:'start',weight:600})+H.text(X0+18,156,'작업 가능',{size:13,fill:'#8e98bb',anchor:'start'});
  s+=H.text(640,146,d.periodLabel,{size:14,fill:'#fff',weight:600});
  s+=H.cl('gauge','heat',H.text(X1-18,138,Math.round(d.heat)+'°',{size:15,fill:'#fff',anchor:'end',weight:600})+H.text(X1-18,156,'엔진 온도',{size:13,fill:'#8e98bb',anchor:'end'}));
  s+=H.line(X0+16,170,X1-16,170,{stroke:'#26368a',sw:1});
  s+=H.cl('gauge','rate',H.text(640,232,H.fmt.m(d.rate),{size:64,fill:'#fff',font:'helv',weight:700})+H.text(640,254,'M tokens/시간',{size:13,fill:'#aab4d4'}));
  // 막대: 엔진 온도 | 남은 한도 → 그 아래 기간 기어 줄
  const bar=(x,f)=>H.rect(x,272,108,8,{r:2,fill:'#101c4a'})+H.rect(x,272,108*H.clamp(f),8,{r:2,fill:'#3a7bff'});
  s+=H.cl('gauge','heat',H.text(X0+18,281,'C',{size:13,fill:'#8e98bb',anchor:'start'})+bar(X0+34,H.frac.heat(d)));
  s+=H.cl('gauge','fuel',bar(X1-142,H.frac.min(d))+H.text(X1-18,281,'F',{size:13,fill:'#8e98bb',anchor:'end'}));
  s+=gearRow(H,d,640,297,{gap:44,width:X1-X0-36,size:13,onSize:15,on:'#fff',off:'#7f8aa8',box:'#1d3fb8'});
  s+=H.line(X0+16,314,X1-16,314,{stroke:'#26368a',sw:1});
  s+=H.lamps(640-78,336,d,{size:18,gap:52,off:'#2a3352'});
  s+=H.cl('trip','',H.text(X0+18,368,H.fmt.odo(d.odo)+' · 트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#7f8aa8',anchor:'start',font:'helv'}));
  s+=H.brand(X1-18,368,{fill:'#8fa8ff',anchor:'end'});
  return s;}});

 // 41 · Volvo 240 — 깊은 사각 상자 하우징, 세 개의 원, 아래쪽 네모 경고등 칸
 O.theme({id:'41',name:'스웨디시 박스',about:'깊은 사각 상자의 경사 벽 안쪽 평면에 세 원을 나란히 두고, 그 아래 네모 칸 줄에 경고등과 기간을 넣었습니다.',draw(H,d){
  const W='#ecebe6',NEE='#f07a1e';
  let s=H.rect(0,0,1280,480,{fill:'#8a8783'});
  // 상자: 바깥 테 → 경사 벽(위는 그늘, 아래는 빛) → 안쪽 평면
  s+=H.housing('M64 10 H1216 Q1228 10 1228 22 V458 Q1228 470 1216 470 H64 Q52 470 52 458 V22 Q52 10 64 10Z',{top:'#262626',bottom:'#121212',rim:.1});
  const IX0=112,IX1=1168,IY0=62,IY1=424,OX0=68,OX1=1212,OY0=24,OY1=456;
  s+=H.path(`M${OX0} ${OY0} H${OX1} L${IX1} ${IY0} H${IX0}Z`,{fill:H.lin('wt',[[0,'#0c0c0c'],[1,'#171717']])});
  s+=H.path(`M${OX0} ${OY0} L${IX0} ${IY0} V${IY1} L${OX0} ${OY1}Z`,{fill:H.lin('wl',[[0,'#2c2c2c'],[1,'#1a1a1a']],{dir:[0,0,1,0]})});
  s+=H.path(`M${OX1} ${OY0} L${IX1} ${IY0} V${IY1} L${OX1} ${OY1}Z`,{fill:H.lin('wr',[[0,'#1a1a1a'],[1,'#2c2c2c']],{dir:[0,0,1,0]})});
  s+=H.path(`M${OX0} ${OY1} L${IX0} ${IY1} H${IX1} L${OX1} ${OY1}Z`,{fill:H.lin('wb',[[0,'#2a2a2a'],[1,'#333']])});
  s+=H.rect(IX0,IY0,IX1-IX0,IY1-IY0,{fill:'#0d0d0d'});
  s+=H.rect(IX0,IY0,IX1-IX0,26,{fill:H.lin('is',[[0,'#000',.7],[1,'#000',0]])});
  s+=H.line(IX0,IY1,IX1,IY1,{stroke:'#fff',sw:1,op:.08});
  const cy=226,LX=362,CX=640,RX=918;
  const dial=(cx,r)=>H.circle(cx,cy+3,r+2,{fill:'#000',op:.5})+H.circle(cx,cy,r+2,{fill:'#3a3a3a'})+H.face(cx,cy,r,{fill:'#141516',center:'#1b1c1e',edge:'#060607'});
  // 왼쪽: 소진 속도
  { const [lb,db]=burnL(H,d,10,2),no={size:17,fill:W,font:'helv'},rt=ringFit(lb,db,94,no);let g=dial(LX,124);
   g+=H.band(LX,cy,rt-6,rt,-135+270*.8,135,{fill:W});
   g+=H.ticks(LX,cy,rt,{n:10,minor:1,len:12,mlen:7,w:3,mw:2,color:W});
   g+=numsS(H,LX,cy,rt,lb,no);
   if(cruF(d)!=null)g+=tickTip(H,LX,cy,-135+270*cruF(d),rt,rt-12,'#4be3a0',3);
   g+=H.text(LX,cy+56,'소진 속도',{size:13,fill:'#cfcfca'})+H.text(LX,cy+74,'%/시간',{size:13,fill:'#9a9a96'});
   g+=H.needle(LX,cy,rt-10,-135+270*H.frac.burn(d),{style:'taper',w:6,color:NEE,tail:14})+H.hub(LX,cy,11);
   s+=H.cl('gauge','burn',g); }
  // 가운데: 토큰 속도 + 주행계
  { const [lr,dr]=rateL(H,d,10,2),no={size:18,fill:W,font:'helv'},rt=ringFit(lr,dr,104,no);let g=dial(CX,146);
   g+=H.ticks(CX,cy,rt,{n:10,minor:1,len:12,mlen:8,w:3,mw:2,color:W});
   g+=numsS(H,CX,cy,rt,lr,no);
   g+=odo2(H,CX-45.5,cy+42,H.fmt.odo(d.odo,7),{cw:13,ch:19,tenths:1,bg:'#111',fg:W});
   g+=H.text(CX,cy+103,'M tokens/시간',{size:13,fill:'#9a9a96'});
   g+=H.needle(CX,cy,rt-4,-135+270*H.frac.rate(d),{style:'taper',w:7,color:NEE,tail:16})+H.hub(CX,cy,13);
   s+=H.cl('gauge','rate',g); }
  s+=H.cl('trip','',H.text(CX,cy+84,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:'#cfcfca'}));
  // 오른쪽: 엔진 온도 + 남은 한도 (두 개의 짧은 호)
  s+=dial(RX,124);
  s+=H.cl('gauge','heat',H.arc(RX,cy,96,-150,-60,{stroke:W,sw:3})+H.band(RX,cy,86,100,-150,-139,{fill:W})+H.text(RX-46,cy-48,`온도 ${Math.round(d.heat)}°`,{size:13,fill:'#cfcfca'})+H.needle(RX,cy,92,-150+90*H.frac.heat(d),{style:'taper',w:5,color:NEE,tail:6}));
  s+=H.cl('gauge','fuel',H.arc(RX,cy,96,60,150,{stroke:W,sw:3})+H.band(RX,cy,86,100,139,150,{fill:W})+H.text(RX+46,cy-48,`한도 ${Math.round(d.minLeft)}%`,{size:13,fill:'#cfcfca'})+H.needle(RX,cy,92,150-90*H.frac.min(d),{style:'taper',w:5,color:NEE,tail:6}));
  s+=H.brand(RX,cy+80,{fill:'#9a9a96'});
  s+=H.hub(RX,cy,10);
  // 아래 네모 경고등 칸: 경고등 네 칸 + 기간 칸(d.gears 개수만큼)
  const cw=48,n=4+d.gears.length,x0=CX-(n*cw-4)/2,y0=382;
  s+=H.rect(x0-4,y0-4,n*cw+4,38,{r:3,fill:'#080808'});
  s+=lampCells(H,d,x0-2,y0,cw,{pad:2,h:30,bg:'#151515',stroke:'#2a2a2a',size:19,off:'#3a3a3a'});
  d.gears.forEach((g,i)=>{const on=g===d.period,x=x0+(4+i)*cw;s+=H.cl('period',g,H.rect(x,y0,cw-4,30,{r:2,fill:'#151515',stroke:'#2a2a2a'})+H.text(x+(cw-4)/2,y0+15,g,{size:on?14:13,fill:on?'#f2c12e':'#80807c',weight:on?700:400,base:'central'}));});
  return s;}});

 // 42 · Saab 900 Turbo — 검은 패널, 노란 바늘, 왼쪽 회전계와 시계, 오른쪽 터보 압력 계기
 O.theme({id:'42',name:'터보 부스트',about:'노란 바늘 세 원 구성에서 터보 압력계를 소진 속도로 바꾸고, 왼쪽 원의 녹색 구간을 엔진 온도의 여유 범위로 썼습니다. 경고등과 기간은 원본처럼 위 띠에 둡니다.',draw(H,d){
  const Y='#f4c21c',WH='#f4f4f0',OR='#f06a22';
  let s=H.rect(0,0,1280,480,{fill:'#e9e6df'});
  s+=H.housing('M92 46 H1188 Q1220 46 1220 78 V422 Q1220 454 1188 454 H92 Q60 454 60 422 V78 Q60 46 92 46Z',{top:'#1e1e1e',bottom:'#0a0a0a',rim:.12});
  s+=H.rect(76,60,1128,380,{r:22,fill:H.lin('p',[[0,'#0e0e0e'],[.18,'#181818'],[1,'#121212']])});
  const gauge=(cx,cy,r)=>H.circle(cx,cy+3,r+3,{fill:'#000',op:.6})+H.circle(cx,cy,r+3,{fill:'#2c2c2c'})+H.face(cx,cy,r,{fill:'#0b0b0b',center:'#121212',edge:'#030303'});
  // 위 띠: 왼쪽 원 축에 경고등, 오른쪽 원 축에 기간, 가운데 원 양옆에 방향 화살표
  const TY=94;
  s+=H.lamps(270-72,TY,d,{size:18,gap:48,off:'#333'});
  s+=H.gear(1010,TY,d,{gap:40,width:300,size:14,on:Y,off:'#7e7e7a'});
  s+=H.path(`M${640-196} ${TY} l14 -9 v5 h12 v8 h-12 v5Z`,{fill:'#2e2e2e'})+H.path(`M${640+196} ${TY} l-14 -9 v5 h-12 v8 h12 v5Z`,{fill:'#2e2e2e'});
  // 왼쪽: 엔진 온도 회전계 + 시계 (엔진 온도 0–100% 눈금은 토큰 범위와 무관한 고정 눈금입니다)
  const lx=270,ly=276;
  { let g=gauge(lx,ly,148);
   g+=H.arc(lx,ly,142,-135,-135+270*.6,{stroke:'#2fae4a',sw:4});
   g+=H.arc(lx,ly,142,-135+270*.85,135,{stroke:OR,sw:5});
   g+=H.nums(lx,ly,122,['0','20','40','60','80','100'],{size:19,fill:WH,font:'helv',red:.85,redColor:OR});
   g+=H.ticks(lx,ly,104,{n:5,minor:1,len:13,mlen:6,w:3,mw:2,color:WH});
   const [hh,mm]=d.clock.split(':').map(Number);
   g+=H.circle(lx,ly+68,42,{fill:'#050505',stroke:'#333',sw:1.5});
   g+=H.ticks(lx,ly+68,40,{a0:0,sweep:330,n:11,minor:0,len:4,w:1.5,color:'#999'});
   g+=H.nums(lx,ly+68,29,['12','3','6','9'],{a0:0,sweep:270,size:12,fill:'#ddd',font:'helv'});
   g+=H.needle(lx,ly+68,14,(hh%12+mm/60)*30,{style:'baton',w:4,color:Y,tail:4,shadow:false})+H.needle(lx,ly+68,21,mm*6,{style:'baton',w:3,color:Y,tail:4,shadow:false})+H.circle(lx,ly+68,3,{fill:Y});
   g+=H.text(lx,ly+128,'엔진 온도',{size:13,fill:'#cfcfca'});
   g+=H.needle(lx,ly,91,-135+270*H.frac.heat(d),{style:'baton',w:8,color:Y,tail:20})+H.hub(lx,ly,10);
   s+=H.cl('gauge','heat',g); }
  // 가운데: 토큰 속도
  const cx=640,cy=262;
  { const [lr,dr]=rateL(H,d,10,1),no={a0:-140,sweep:280,size:16,fill:WH,font:'helv'},rt=ringFit(lr,dr,120,no);let g=gauge(cx,cy,160);
   g+=H.path(`M${cx-6} ${cy-156} L${cx+6} ${cy-156} L${cx} ${cy-149}Z`,{fill:OR});
   g+=numsS(H,cx,cy,rt,lr,no);
   g+=H.ticks(cx,cy,rt,{a0:-140,sweep:280,n:20,minor:1,len:11,mlen:6,w:2.5,mw:1.5,color:WH});
   g+=odo2(H,cx-56,cy+66,H.fmt.odo(d.odo,8).slice(1),{cw:16,ch:20,tenths:1,bg:'#ddd',fg:'#111',tbg:OR});
   g+=H.text(cx,cy+134,'M tokens/시간',{size:13,fill:Y})+H.text(cx,cy+151,'토큰 속도',{size:13,fill:'#cfcfca'});
   g+=H.needle(cx,cy,rt-9,-140+280*H.frac.rate(d),{style:'baton',w:9,color:Y,tail:24})+H.hub(cx,cy,12);
   s+=H.cl('gauge','rate',g); }
  s+=H.cl('trip','',odo2(H,cx-40,cy+94,(H.fmt.trip(d.trip).replace('.','')).padStart(5,'0'),{cw:16,ch:20,tenths:1,bg:'#ddd',fg:'#111',tbg:OR}));
  // 오른쪽: 터보 압력 → 소진 속도
  const rx=1010,ry=276,tc=ry-12;
  { const bl=H.burnScale(d,5);let g=gauge(rx,ry,148);
   g+=H.arc(rx,tc,110,-80,40,{stroke:'#e6e6e6',sw:4})+H.arc(rx,tc,110,40,80,{stroke:OR,sw:10});
   const [x0,y0]=H.pt(rx,tc,128,-82),[x1,y1]=H.pt(rx,tc,128,82);g+=H.text(x0,y0+4,bl[0],{size:14,fill:WH,font:'helv'})+H.text(x1,y1+4,bl[bl.length-1],{size:14,fill:WH,font:'helv'});
   if(cruF(d)!=null)g+=tickTip(H,rx,tc,-80+160*cruF(d),118,100,'#2fae4a',4);
   g+=H.text(rx,tc+28,'소진 속도',{size:14,fill:WH})+H.text(rx,tc+48,H.fmt.burn(d.burn)+' %/시간',{size:14,fill:'#fff',font:'helv'});
   g+=H.needle(rx,tc,104,-80+160*H.frac.burn(d),{style:'baton',w:7,color:Y,tail:4})+H.hub(rx,tc,8);
   s+=H.cl('gauge','burn',g); }
  // 작은 바늘 둘: 남은 한도, 메모리
  const smallN=(x,f,l0,l1,lab)=>{const sy=ry+112;let o=H.arc(x,sy,50,-40,40,{stroke:'#e6e6e6',sw:2})+H.text(x-44,sy-34,l0,{size:12,fill:'#ddd',font:'helv'})+H.text(x+44,sy-34,l1,{size:12,fill:'#ddd',font:'helv'})+H.text(x,sy+14,lab,{size:13,fill:'#cfcfca'});
   o+=H.needle(x,sy,49,-40+80*f,{style:'baton',w:5,color:Y,tail:2})+H.circle(x,sy,4,{fill:'#222'});return o;};
  s+=H.cl('gauge','fuel',smallN(rx-58,H.frac.min(d),'E','F','한도'))+smallN(rx+58,H.frac.mem(d),'0','100','메모리');
  s+=H.brand(1188,428,{fill:'#6c6c6a',anchor:'end'});
  return s;}});

 // 43 · Peugeot 3008 — 위로 넓은 사다리꼴 화면, 크롬 테두리, 아래쪽 파란 띠
 O.theme({id:'43',name:'지오메트릭',about:'위가 넓은 기하학적 화면에 가운데 네모 숫자, 왼쪽 막대 목록(실제 값), 오른쪽 세션 동심 타원을 배치했습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('dash',[[0,'#3a3b3e'],[1,'#1a1b1d']])});
  const shp='M150 64 Q640 18 1130 64 Q1182 74 1152 136 L1022 404 Q1004 436 962 436 H318 Q276 436 258 404 L128 136 Q98 74 150 64Z';
  s+=H.housing(shp,{top:'#14161a',bottom:'#050608',rim:0});
  s+=H.path(shp,{stroke:chromeStroke(H,'c43'),sw:5});
  const clip=H.clip('sc',`<path d="${shp}"/>`);
  let g=H.path(shp,{fill:H.lin('scr',[[0,'#0b0c0f'],[1,'#050507']])});
  // 바닥의 휘어진 길 (원근)
  g+=H.path('M300 334 Q640 282 980 334 L1040 440 H240Z',{fill:H.lin('fl',[[0,'#241010'],[1,'#08080a']])});
  g+=H.path('M300 334 Q640 282 980 334',{stroke:'#8a3a30',sw:1.5});
  // 위 가운데 기간 탭: 원본의 P 표시처럼 위 테두리에서 내려온 사다리꼴 칸. 기어 수에 맞춰 폭을 넓힙니다
  const th=Math.max(104,d.gears.length*19+30);
  g+=H.path(`M${640-th} 40 L${640-th+20} 108 H${640+th-20} L${640+th} 40Z`,{fill:H.lin('tab',[[0,'#17181c'],[1,'#0d0e11']])});
  g+=H.path(`M${640-th} 40 L${640-th+20} 108 H${640+th-20} L${640+th} 40`,{stroke:'#4a4a50',sw:1.2});
  g+=gearRow(H,d,640,84,{gap:40,width:2*th-58,size:14,onSize:20,on:'#fff',off:'#8a8a90'});
  g+=H.lamps(640-72,124,d,{size:16,gap:48,off:'#3c3c3c'});
  // 가운데 네모 숫자
  g+=H.cl('gauge','rate',H.rect(570,146,140,82,{r:12,fill:'#08090b',stroke:'#fff',sw:3})+H.text(640,202,H.fmt.m(d.rate),{size:44,fill:'#fff',weight:500})+H.text(640,250,'M tokens/시간',{size:13,fill:'#b8b8bc'}));
  g+=H.cl('gauge','burn',H.circle(620,282,20,{fill:'#fff',stroke:'#e2231a',sw:4})+H.text(620,282,H.fmt.burn(d.burn),{size:13,fill:'#111',weight:700,base:'central'})+H.text(648,282,'%/시간',{size:13,fill:'#b8b8bc',anchor:'start',base:'central'}));
  // 왼쪽 막대 목록 (기준선 x 300, 값 오른쪽 끝 x 540)
  g+=H.text(300,154,'다이내믹',{size:14,fill:'#fff',anchor:'start',weight:600});
  const rows=[['토큰 속도',H.frac.rate(d),H.fmt.m(d.rate)+'M'],['소진 속도',H.frac.burn(d),H.fmt.burn(d.burn)+'%'],['엔진 온도',H.frac.heat(d),Math.round(d.heat)+'°']];
  rows.forEach(([n,f,v],i)=>{const y=190+i*30;g+=H.text(300,y,n,{size:13,fill:'#cfcfd3',anchor:'start',base:'central'})+H.rect(374,y-4,96,8,{r:4,fill:'#24252a'})+H.rect(374,y-4,96*f,8,{r:4,fill:'#e8e8ec'})+H.text(540,y,v,{size:13,fill:'#fff',anchor:'end',base:'central',weight:600});});
  g+=H.path('M300 292 Q420 312 540 292',{stroke:'#e86a4a',sw:3,cap:'round'});
  // 왼쪽 세로 막대: 남은 한도
  g+=H.cl('gauge','fuel',H.vbars(236,152,12,136,H.frac.min(d),{n:12,gap:3,fill:'#3fbf5a',colors:[[0,'#e2231a'],[.25,'#f0a020'],[.4,'#3fbf5a']],off:'#222'})+H.text(242,140,'F',{size:13,fill:'#b8b8bc',base:'central'})+H.text(242,302,'E',{size:13,fill:'#e2231a',base:'central'}));
  // 오른쪽 동심 타원: 세션 (기준선 x 740–980)
  g+=H.text(980,154,'세션',{size:14,fill:'#fff',anchor:'end',weight:600});
  const ex=860,ey=240;
  for(const r of [36,72,108])g+=`<ellipse cx="${ex}" cy="${ey}" rx="${r}" ry="${r*.34}" fill="none" stroke="#8a8a90" stroke-width="1.2"/>`;
  g+=H.circle(ex,ey,6,{fill:'#fff'});
  const pts=[[0.82,20],[0.6,80],[0.4,150],[0.92,205],[0.5,262],[0.72,320]];
  pts.forEach(([k,a],i)=>{const x=ex+108*k*Math.cos(a*Math.PI/180),y=ey+37*k*Math.sin(a*Math.PI/180);g+=H.circle(x,y,4.5,{fill:i<d.sessions.waiting?'#f2b233':'#39d98a'});});
  g+=H.text(752,190,`작업 중 ${d.sessions.working}`,{size:13,fill:'#cfcfd3',anchor:'start',base:'central'})+H.text(968,190,`응답 대기 ${d.sessions.waiting}`,{size:13,fill:'#f2b233',anchor:'end',base:'central'});
  g+=H.path('M740 292 Q860 312 980 292',{stroke:'#e86a4a',sw:3,cap:'round'});
  // 오른쪽 세로 막대: 엔진 온도
  g+=H.cl('gauge','heat',H.vbars(1032,152,12,136,H.frac.heat(d),{n:12,gap:3,fill:'#ddd',colors:[[.75,'#e2231a']],off:'#222'})+H.text(1038,140,'H',{size:13,fill:'#e2231a',base:'central'})+H.text(1038,302,'C',{size:13,fill:'#b8b8bc',base:'central'}));
  // 아래 주행계 띠
  g+=H.path('M500 358 H780 L756 388 H524Z',{fill:'#101114',stroke:'#3a3a40'});
  g+=H.text(548,373,H.fmt.odo(d.odo),{size:13,fill:'#ddd',anchor:'start',base:'central'})+H.cl('trip','',H.text(732,373,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#ddd',anchor:'end',base:'central'}));
  g+=H.text(640,410,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:13,fill:'#b8b8bc',base:'central'});
  g+=H.brand(940,410,{fill:'#6c6c72',anchor:'end'});
  // 아래 테두리 안쪽의 파란 앰비언트 띠 (원본처럼 화면 아래 테두리를 따라 붙습니다)
  g+=H.path('M266 404 Q284 428 322 428 H958 Q996 428 1014 404',{stroke:'#2a6dff',sw:2.5,cap:'round',op:.9});
  s+=H.g(g,{clip});
  return s;}});

 // 44 · Citroën CX — 바늘 대신 창 안에서 굴러가는 숫자 드럼
 O.theme({id:'44',name:'로터리 드럼',about:'바늘 대신 노란 창 안에서 숫자 드럼이 굴러가고, 위쪽 띠에 경고등과 기간을 늘어놓았습니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#5e3d2b'],[1,'#3e2618']])});
  // 호두나무 무늬목 하우징: 앞쪽 두께(아래 턱) → 몸체 → 가로 결 → 위에서 오는 빛과 옻칠 광택
  const shell='M52 100 Q640 20 1228 100 L1186 446 H94Z';
  s+=H.path('M52 108 Q640 28 1228 108 L1186 456 H94Z',{fill:'#1e0f08',filter:H.shadow('w44s',8,14,.6)});
  s+=H.path(shell,{fill:H.lin('wb',[[0,'#8a5634'],[.5,'#6e4127'],[1,'#4f2d1a']])});
  let rnd=7;const rn=()=>{rnd=(rnd*16807)%2147483647;return rnd/2147483647;};
  const grain=(x0,x1,y0,y1,step,dark,light,amp)=>{let o='';
   for(let y=y0;y<y1;y+=step*(.6+rn()*.8)){const a=(rn()-.5)*amp,b=(rn()-.5)*amp,c=(rn()-.5)*amp,dk=rn()<.68;
    o+=H.path(`M${x0} ${H.r2(y)} C${H.r2(x0+(x1-x0)*.3)} ${H.r2(y+a)} ${H.r2(x0+(x1-x0)*.62)} ${H.r2(y+b)} ${x1} ${H.r2(y+c)}`,{stroke:dk?dark:light,sw:H.r2(.6+rn()*(dk?1.8:.9)),op:H.r2(dk?.12+rn()*.22:.05+rn()*.08)});}
   return o;};
  // 결은 무늬(pattern)로 칠해 글자 아래에 선 요소가 깔리지 않게 합니다
  const pat=(n,inner)=>{H.def(`<pattern id="${H.id(n)}" patternUnits="userSpaceOnUse" x="0" y="0" width="1280" height="480">${inner}</pattern>`);return H.url(n);};
  s+=H.path(shell,{fill:pat('wg',grain(40,1240,24,460,4.2,'#2a1408','#d8a072',9))});
  s+=H.path(shell,{fill:H.lin('wl',[[0,'#fff',.16],[.18,'#fff',.03],[.6,'#000',0],[1,'#000',.28]])});
  s+=H.path('M52 100 Q640 20 1228 100',{stroke:'#f2c9a0',sw:1.2,op:.45});
  s+=H.path('M1186 446 H94',{stroke:'#000',sw:1.5,op:.5});
  // 비스듬히 깎아 들어간 테(위 면은 그늘, 아래 면은 빛) → 안쪽으로 들어간 짙은 무늬목 면
  const X0=150,X1=1130,Y0=108,Y1=424,B=11;
  s+=H.path(`M${X0} ${Y0} H${X1} L${X1-B} ${Y0+B} H${X0+B}Z`,{fill:'#2e180c'});
  s+=H.line(X0,Y0+.5,X1,Y0+.5,{stroke:'#f2c9a0',sw:1,op:.35});
  s+=H.path(`M${X0} ${Y1} H${X1} L${X1-B} ${Y1-B} H${X0+B}Z`,{fill:'#b47a50'});
  s+=H.path(`M${X0} ${Y0} L${X0+B} ${Y0+B} V${Y1-B} L${X0} ${Y1}Z`,{fill:H.lin('bvl',[[0,'#3a2112'],[1,'#7a4c30']])});
  s+=H.path(`M${X1} ${Y0} L${X1-B} ${Y0+B} V${Y1-B} L${X1} ${Y1}Z`,{fill:H.lin('bvr',[[0,'#3a2112'],[1,'#7a4c30']])});
  s+=H.rect(X0,Y0,X1-X0,Y1-Y0,{stroke:'#000',sw:1,op:.35});
  const IX=X0+B,IY=Y0+B,IW=X1-X0-2*B,IH=Y1-Y0-2*B;
  s+=H.rect(IX,IY,IW,IH,{fill:H.lin('in',[[0,'#3a2316'],[1,'#4c2e1d']])});
  s+=H.rect(IX,IY,IW,IH,{fill:pat('ig',grain(IX,IX+IW,IY,IY+IH,4.4,'#140904','#a0704c',6)),op:.8});
  // 위 테 아래로 드리운 그늘
  s+=H.rect(IX,IY,IW,IH,{fill:H.lin('ish',[[0,'#000',.5],[.1,'#000',.12],[.3,'#000',0],[1,'#000',.08]])});
  // 위쪽 경고등 띠: 경고등 네 칸 + 기간 칸(d.gears 개수만큼)
  { const cw=46,n=4+d.gears.length,x0=640-(n*cw)/2;s+=H.rect(x0-6,130,n*cw+12,46,{r:4,fill:'#1a1513'});
   s+=lampCells(H,d,x0,136,cw,{pad:3,h:34,bg:'#0b0909',stroke:'#2a2422',size:20,off:'#3a3230'});
   d.gears.forEach((g,i)=>{const on=g===d.period,x=x0+(4+i)*cw;s+=H.cl('period',g,H.rect(x+3,136,cw-6,34,{r:2,fill:'#0b0909',stroke:'#2a2422'})+H.text(x+cw/2,153,g,{size:on?14:13,fill:on?'#ffd24a':'#8a7a66',weight:on?700:400,base:'central'}));}); }
  // 창 테두리 (모든 창은 y 196–346 한 줄)
  // 창은 나무 면을 파낸 구멍: 짙은 테, 위쪽 그늘, 아래 모서리에 빛이 맺힘
  const win=(x,w)=>H.rect(x-6,196,w+12,150,{r:5,fill:'#120905'})+H.rect(x-6,196,w+12,6,{r:3,fill:'#000',op:.5})+H.line(x-3,346.5,x+w+3,346.5,{stroke:'#d9a274',sw:1,op:.45});
  // 시계 (왼쪽 네모 창)
  s+=win(190,140)+H.rect(190,202,140,138,{fill:'#111'});
  const [hh,mm]=d.clock.split(':').map(Number);
  s+=H.circle(260,271,58,{fill:'#1c1c1c',stroke:'#444'})+H.ticks(260,271,56,{a0:0,sweep:330,n:11,minor:0,len:6,w:2,color:'#ddd'});
  s+=H.nums(260,271,42,['12','','','3','','','6','','','9','',''],{a0:0,sweep:330,size:12,fill:'#ddd',font:'helv'});
  s+=H.needle(260,271,30,(hh%12+mm/60)*30,{style:'baton',w:4,color:'#e23a2a',tail:4,shadow:false})+H.needle(260,271,46,mm*6,{style:'baton',w:3,color:'#e23a2a',tail:4,shadow:false})+H.circle(260,271,3.5,{fill:'#e23a2a'});
  // 드럼 숫자는 눈금 범위를 따릅니다: 한 칸 = 최대값의 1/20 (200M → 10, 2M → 0.1, 1B → 50)
  const rM=d.rateMax/1e6,rs=drumStep(rM),bs=drumStep(d.burnMax);
  const LY=370;
  // 드럼 1: 토큰 속도
  s+=H.cl('gauge','rate',win(370,180)+drum(H,370,202,180,138,d.rate/1e6,{step:rs,max:rM,lh:60,size:42,bg:'#e6c64a',fill:'#2a2010',font:'helv',weight:700,mark:'#c22',fmt:O.fmtScale})
   +H.text(460,LY,'토큰 속도 · M tokens/시간',{size:13,fill:'#f2dcc8',base:'central'}));
  // 가운데 작은 디지털 창
  s+=H.rect(578,212,124,52,{r:3,fill:'#0b0909',stroke:'#2a2422'})+H.text(640,229,'주행계',{size:12,fill:'#9a8a70',base:'central'})+H.text(640,250,H.fmt.odo(d.odo,6),{size:18,fill:'#d9c9a0',font:'helv',weight:600,base:'central'});
  s+=H.cl('trip','',H.rect(578,278,124,52,{r:3,fill:'#0b0909',stroke:'#2a2422'})+H.text(640,295,'트립',{size:12,fill:'#9a8a70',base:'central'})+H.text(640,316,H.fmt.trip(d.trip)+'M',{size:18,fill:'#d9c9a0',font:'helv',weight:600,base:'central'}));
  // 드럼 2: 소진 속도
  s+=H.cl('gauge','burn',win(730,180)+drum(H,730,202,180,138,d.burn,{step:bs,max:d.burnMax,lh:60,size:42,bg:'#e6c64a',fill:'#2a2010',font:'helv',weight:700,mark:'#c22',fmt:O.fmtScale})
   +H.text(820,LY,'소진 속도 · %/시간'+(cruF(d)!=null?` (적정 ${cru(d)})`:''),{size:13,fill:'#f2dcc8',base:'central'}));
  // 오른쪽: 연료·온도 막대
  s+=win(950,140)+H.rect(950,202,140,138,{fill:'#111'});
  s+=H.cl('gauge','fuel',H.vbars(975,214,26,96,H.frac.min(d),{n:10,gap:3,fill:'#e8e0d0',colors:[[0,'#e23a2a'],[.3,'#e8e0d0']],off:'#2a2422'})+H.text(988,327,'한도',{size:13,fill:'#ccc',base:'central'}));
  s+=H.cl('gauge','heat',H.vbars(1039,214,26,96,H.frac.heat(d),{n:10,gap:3,fill:'#e8e0d0',colors:[[.8,'#e23a2a']],off:'#2a2422'})+H.text(1052,327,'온도',{size:13,fill:'#ccc',base:'central'}));
  // 창 아래 라벨 줄 (한 기준선)
  s+=H.text(640,LY,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:13,fill:'#f2dcc8',base:'central',weight:600});
  s+=H.brand(1100,396,{fill:'#d8b8a0',anchor:'end'});
  return s;}});

 // 45 · Fiat 500 — 원 하나 안에 세 겹: 바깥 토큰 속도, 안쪽 소진 속도, 가운데 화면
 O.theme({id:'45',name:'동심원',about:'둥근 하우징 하나 안에 크림색 바깥 눈금, 검은 안쪽 눈금, 가운데 둥근 화면을 겹쳤습니다. 바깥 바늘은 원본처럼 가운데 화면 뒤에서 나옵니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:'#ecebe8'});
  const cx=640,cy=240;
  // 고정 날개 (하우징과 같은 검은 수지)
  const tab=H.lin('tb',[[0,'#3a3a3c'],[1,'#121213']]);
  s+=H.rect(cx-122,10,30,46,{r:4,fill:tab})+H.rect(cx+92,10,30,46,{r:4,fill:tab});
  s+=H.circle(cx-107,26,5,{fill:'#ecebe8'})+H.circle(cx+107,26,5,{fill:'#ecebe8'});
  s+=H.rect(cx-262,356,96,30,{r:6,fill:tab})+H.rect(cx+166,356,96,30,{r:6,fill:tab});
  s+=H.circle(cx-240,371,6,{fill:'#ecebe8'})+H.circle(cx+240,371,6,{fill:'#ecebe8'});
  s+=H.circle(cx,cy+5,226,{fill:'#000',op:.35,filter:H.shadow('ds',6,12,.5)});
  s+=H.circle(cx,cy,226,{fill:H.lin('sh',[[0,'#3a3a3a'],[.2,'#1c1c1c'],[1,'#050505']])});
  s+=H.circle(cx,cy,225,{stroke:'#fff',sw:1,op:.14});
  s+=H.circle(cx,cy,206,{fill:'#141414'});
  // 크림색 바깥 링: 토큰 속도
  { let g=H.circle(cx,cy,194,{fill:H.rad2('cr',[[.7,'#ffffff'],[.96,'#efece4'],[1,'#d4d0c6']])});
   g+=H.circle(cx,cy,194,{fill:H.rad2('cri',[[.9,'#000',0],[1,'#000',.25]],{cy:.53})});
   g+=H.nums(cx,cy,177,H.rateScale(d,10),{a0:-110,sweep:220,size:17,fill:'#111',font:'helv',weight:700,upright:false});
   g+=H.ticks(cx,cy,164,{a0:-110,sweep:220,n:20,minor:1,len:14,mlen:7,w:2,mw:1.4,color:'#111'});
   g+=H.band(cx,cy,150,164,-110,-105,{fill:'#d81e1e'});
   // 바깥 바늘: 가운데 화면 뒤에서 나와 바깥 눈금 안쪽 끝까지
   //  안쪽 검은 링(r 140) 아래에 숨는 구간은 그리지 않아 소진 속도 숫자를 지나가지 않습니다 (보이는 모양은 그대로)
   g+=ptr(H,cx,cy,138,150,-110+220*H.frac.rate(d),4.8,'#d81e1e',3.6);
   s+=H.cl('gauge','rate',g); }
  s+=H.cl('trip','',H.text(cx,cy+172,H.fmt.odo(d.odo)+' · 트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#333',weight:600,base:'central'}));
  // 기간 기어: 크림색 링 아래쪽 빈 구간 (눈금이 없는 6시 방향)
  s+=gearRow(H,d,cx,cy+146,{gap:36,width:236,size:13,onSize:15,on:'#d81e1e',off:'#555'});
  // 검은 안쪽 링: 소진 속도
  { let g=H.circle(cx,cy,140,{fill:'#0d0d0d'});
   g+=H.circle(cx,cy,140,{stroke:'#000',sw:2,op:.6});
   g+=H.band(cx,cy,128,134,-110+220*.75,110,{fill:'#8a1a16'});
   // 숫자는 눈금 안쪽 끝과 가운데 화면(r 94) 사이 띠에 들어갑니다. '0.4'처럼 길어지면 글자는 그대로 두고 큰 눈금을 짧게 합니다
   const bl=H.burnScale(d,10,{every:2}),bn=bl.length-1,tw=t=>[...t].reduce((a,c)=>a+(c==='.'?.28:.56),0)*14/2;
   const sup=(t,i)=>{const ra=(-110+220*i/bn)*Math.PI/180;return tw(t)*Math.abs(Math.sin(ra))+5.2*Math.abs(Math.cos(ra));};
   const smax=Math.max(...bl.map((t,i)=>t?sup(t,i):0)),rIn=Math.max(120,94+6+2*smax),len=Math.min(14,134-rIn);
   g+=H.ticks(cx,cy,134,{a0:-110,sweep:220,n:10,minor:1,len,mlen:Math.min(7,len-3),w:3,mw:1.6,color:'#e8e8e8',red:.75,redColor:'#e8302a'});
   bl.forEach((t,i)=>{if(!t)return;const f=i/bn,a=-110+220*f,[x,y]=H.pt(cx,cy,Math.min(109,134-len-3-sup(t,i)),a);
    g+=H.text(x,y,t,{size:14,fill:f>=.75?'#e8302a':'#ddd',font:'helv',base:'central'});});
   // 소진 속도 표시 = 안쪽 눈금을 따라 움직이는 빨간 표식 (눈금 안쪽 끝까지)
   const a=-110+220*H.frac.burn(d),[x1,y1]=H.pt(cx,cy,136,a),[x2,y2]=H.pt(cx,cy,120,a);g+=H.line(x1,y1,x2,y2,{stroke:'#ff3a2a',sw:6,cap:'round'});
   s+=H.cl('gauge','burn',g); }
  // 가운데 화면
  s+=H.circle(cx,cy,94,{fill:'#c8c8c8'})+H.circle(cx,cy,91,{fill:'#050608'});
  s+=H.text(cx,cy-50,d.periodLabel,{size:13,fill:'#9ab',base:'central'});
  s+=H.cl('gauge','rate',H.text(cx,cy+4,H.fmt.m(d.rate),{size:46,fill:'#fff',font:'helv',weight:300})+H.text(cx,cy+24,'M tokens/시간',{size:13,fill:'#aab',base:'central'}));
  s+=H.text(cx,cy+46,`소진 ${H.fmt.burn(d.burn)} · 한도 ${Math.round(d.minLeft)}%`,{size:13,fill:'#ddd',base:'central'});
  s+=H.text(cx,cy+64,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:13,fill:'#9ab',base:'central'});
  s+=H.lamps(cx-51,cy+114,d,{size:16,gap:34,off:'#3a3a3a'});
  s+=H.brand(cx,cy+216,{fill:'#8a8a8a',size:11});
  return s;}});

 // 46 · Pagani Huayra — 금속 가공 테두리의 큰 두 원, 아래 작은 두 원, 가운데 세로 화면
 O.theme({id:'46',name:'아틀리에 메탈',about:'볼트가 박힌 깊은 금속 테두리 두 원과 아래 작은 두 원, 가운데 크롬 테두리 세로 화면을 배치했습니다. 경고등은 화면 줄에 맞춰 세로로 둡니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:H.rad2('bg',[[0,'#141416'],[1,'#050505']],{cy:.4,r:.8})});
  const metal=(cx,cy,r,w)=>{let o=H.circle(cx,cy+4,r+w,{fill:'#000',op:.6,filter:H.shadow('ms'+cx,4,8,.6)});
   o+=H.circle(cx,cy,r+w,{fill:H.lin('m'+cx+cy,[[0,'#f3f3f3'],[.3,'#6b6e72'],[.55,'#d8dadd'],[.8,'#3a3c3f'],[1,'#a8abb0']],{dir:[0,0,1,1]})});
   o+=H.circle(cx,cy,r+w*.55,{stroke:'#1a1a1a',sw:1.5})+H.circle(cx,cy,r+w*.55+1.5,{stroke:'#fff',sw:1,op:.25})+H.circle(cx,cy,r+3,{fill:'#1a1a1a'});
   for(let i=0;i<8;i++){const [x,y]=H.pt(cx,cy,r+w*.55+(w*.45-3)/2+1,i*45+22.5);o+=H.circle(x,y,w*.15,{fill:'#4a4c50',stroke:'#e2e2e2',sw:1})+H.circle(x,y,w*.05,{fill:'#111'});}
   return o;};
  const big=(key,cx,f,[labels,def],lab,unit,red)=>{
   // 눈금 숫자: 글자 상자 안쪽 끝이 눈금 바깥 끝에서 5px 떨어지게 각도마다 반지름을 정합니다. 숫자가 길면 눈금 고리를 안쪽으로 옮깁니다
   const no={size:18,fill:'#f2f2f2',font:'helv',gap:5,cw:5.1,hh:6.5,red,redColor:'#ff4a3a'},rt=ringFit(labels,def,108,no);
   let o=metal(cx,215,150,22)+H.face(cx,215,150,{fill:'#1a1c1f',center:'#272a2e',edge:'#060607'});
   o+=numsS(H,cx,215,rt,labels,no);
   o+=H.ticks(cx,215,rt,{n:labels.length-1,minor:4,len:14,mlen:6,w:3,mw:1.3,color:'#f2f2f2',red,redColor:'#e8302a'});
   o+=H.text(cx,290,unit,{size:13,fill:'#b8b8b8'});
   o+=H.text(cx,312,lab,{size:14,fill:'#e6e6e6'});
   o+=H.needle(cx,215,rt-14,-135+270*f,{style:'lance',w:9,color:'#e6e6e6',tail:24})+H.hub(cx,215,20,{fill:'#6a6d72',light:'#e8eaec'})+H.circle(cx,215,7,{fill:'#111'});
   return H.cl('gauge',key,o);};
  s+=big('rate',330,H.frac.rate(d),rateL(H,d,10,2),'토큰 속도','M tokens/시간',.8);
  s+=big('burn',950,H.frac.burn(d),burnL(H,d,10,2),'소진 속도','%/시간',.8);
  const small=(cx,f,lab,labels)=>{let o=metal(cx,385,66,12)+H.face(cx,385,66,{fill:'#1a1c1f',edge:'#060607'});
   o+=H.nums(cx,385,55,labels,{a0:-120,sweep:240,size:12,fill:'#eee',font:'helv'});
   o+=H.ticks(cx,385,44,{a0:-120,sweep:240,n:4,minor:3,len:8,mlen:4,w:2,mw:1.2,color:'#eee',red:.75,redColor:'#ff3a2a'});
   o+=H.text(cx,421,lab,{size:12,fill:'#ccc',base:'central'});
   o+=H.needle(cx,385,36,-120+240*f,{style:'taper',w:5,color:'#ff3a2a',tail:8})+H.hub(cx,385,7);return o;};
  // 엔진 온도 0–100% 눈금은 토큰 범위와 무관한 고정 눈금입니다
  s+=H.cl('gauge','heat',small(105,H.frac.heat(d),'엔진 온도',['0','','50','','100']))+H.cl('gauge','fuel',small(1175,H.frac.min(d),'남은 한도',['E','','½','','F']));
  // 가운데 세로 화면 (크롬 테두리 → 남색 테 → 검은 화면)
  const X0=560,X1=720;
  s+=H.rect(X0-14,56,X1-X0+28,286,{r:22,fill:'#0a0a0b',stroke:chromeStroke(H,'c46'),sw:3});
  s+=H.rect(X0-6,64,X1-X0+12,270,{r:16,fill:'#1d2d4a'});
  s+=H.rect(X0,70,X1-X0,258,{r:12,fill:'#000'});
  s+=H.rect(X0,70,X1-X0,28,{r:6,fill:'#1d5fbf'})+H.text(X0+12,84,d.clock,{size:13,fill:'#fff',anchor:'start',base:'central',font:'helv'})+H.cl('period',d.period,H.text(X1-12,84,d.period,{size:14,fill:'#fff',anchor:'end',base:'central',weight:700}))+H.brand(640,88,{fill:'#cfe0ff',size:12});
  const rows=[['토큰 속도',H.fmt.m(d.rate),'M tokens/시간'],['소진 속도',H.fmt.burn(d.burn),'%/시간'],['작업 가능',H.fmt.hours(d.rangeH),'한도 '+Math.round(d.minLeft)+'%']];
  rows.forEach(([a,b,c],i)=>{const y=124+i*56;s+=H.cl('gauge',['rate','burn','fuel'][i],H.text(X0+12,y,a,{size:13,fill:'#9ab',anchor:'start'})+H.text(X1-12,y+22,b,{size:22,fill:'#fff',anchor:'end',weight:600,font:'helv'})+H.text(X0+12,y+22,c,{size:13,fill:'#ddd',anchor:'start'}));});
  s+=H.cl('trip','',H.rect(X0,290,X1-X0,38,{r:6,fill:'#1d5fbf'})+H.text(640,309,H.fmt.odo(d.odo)+' · 트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#fff',base:'central',font:'helv'}));
  // 경고등 칸: 화면 아래 같은 축에 깎아 넣은 크롬 테 홈 (원본의 화면 위 표시등 줄을 화면 축 위에 모읍니다)
  const SY=358,SH=44,SX0=X0-14,SX1=X1+14;
  s+=H.rect(SX0,SY,SX1-SX0,SH,{r:SH/2,fill:'#0a0a0b',stroke:chromeStroke(H,'c46b'),sw:3,filter:H.shadow('sls',3,5,.6)});
  s+=H.rect(SX0+6,SY+6,SX1-SX0-12,SH-12,{r:(SH-12)/2,fill:H.lin('slf',[[0,'#000'],[1,'#141416']])});
  s+=H.rect(SX0+6,SY+6,SX1-SX0-12,SH-12,{r:(SH-12)/2,stroke:'#000',sw:1.5,op:.8});
  s+=H.lamps(640-63,SY+SH/2,d,{size:18,gap:42,colors:{waiting:'#ff3a2a'},off:'#3a2a2a'});
  // 기간 기어 줄: 경고등 홈 아래 같은 화면 축
  s+=gearRow(H,d,640,436,{gap:46,width:320,size:14,onSize:15,on:'#fff',off:'#7c8088',box:'#1d5fbf'});
  return s;}});

 // 47 · Koenigsegg Jesko — SmartCluster 화면을 정면에서 똑바로 크게
 O.theme({id:'47',name:'퍼플 스크린',about:'운전대 위 작은 화면을 정면에서 똑바로 크게 그렸습니다. 둥근 사각 검은 테 안에 보라 분할 호(토큰 속도), 녹색 호(소진 속도), 가운데 큰 기간 글자를 두었습니다.',draw(H,d){
  const cx=640,cy=234,P='#8b5cf6',PL='#b9a8f0',PD='#3a2c66',G='#7ee04a';
  let s=H.rect(0,0,1280,480,{fill:H.rad2('bg',[[0,'#1d1f24'],[1,'#07080a']],{r:.75})});
  // 테: 바깥 금속 선 → 검은 수지 테 → 화면 홈 → 화면
  s+=H.rect(330,8,620,464,{r:54,fill:H.lin('fr',[[0,'#3c3f45'],[.1,'#1e2024'],[1,'#0b0c0e']]),filter:H.shadow('frs',8,16,.7)});
  s+=H.rect(331,9,618,462,{r:53,stroke:H.lin('frr',[[0,'#e0e3e8'],[.4,'#6a7078'],[1,'#26282c']]),sw:2});
  s+=H.rect(348,26,584,428,{r:38,fill:'#000'});
  s+=H.rect(352,30,576,420,{r:34,fill:H.lin('scr',[[0,'#0e0922'],[.6,'#07041a'],[1,'#03020a']])});
  s+=H.circle(cx,cy,210,{fill:H.rad2('vg',[[0,'#1d1342',.85],[.75,'#120a2c',.45],[1,'#07041a',0]])});
  // 보라 분할 호: 토큰 속도
  const A0=-140,SW=280;
  s+=H.cl('gauge','rate',H.arc(cx,cy,192,A0,A0+SW,{stroke:PD,sw:1.5})
   +H.arcBars(cx,cy,186,H.frac.rate(d),{a0:A0,sweep:SW,n:28,w:24,gapA:3,fill:P,off:'#1e1538'})
   +H.arc(cx,cy,158,A0,A0+SW,{stroke:PD,sw:1.5})
   +H.nums(cx,cy,143,H.rateScale(d,5),{a0:A0,sweep:SW,size:14,fill:PL,font:'din',weight:600}));
  // 녹색 호: 소진 속도 (화살표가 값을 가리킴, 흰 눈금은 적정 속도)
  const gA0=-122,gSW=244,fb=H.frac.burn(d),ab=gA0+gSW*fb;
  s+=H.cl('gauge','burn',H.arc(cx,cy,124,gA0,gA0+gSW,{stroke:'#1f3a1a',sw:4})
   +H.arc(cx,cy,124,gA0,ab,{stroke:G,sw:4})
   +(cruF(d)!=null?`<g transform="translate(${cx} ${cy}) rotate(${H.r2(gA0+gSW*cruF(d))}) translate(0 -118)"><path d="M-5 8 L5 8 L0 0Z" fill="#e8e4ff"/></g>`:'')
   +`<g transform="translate(${cx} ${cy}) rotate(${H.r2(ab)}) translate(0 -124)"><path d="M-6 -7 L8 0 L-6 7Z" fill="${G}"/></g>`);
  // 가운데: 큰 기간 글자 → 토큰 속도 → 소진·한도
  s+=H.cl('period',d.period,H.rect(598,132,84,46,{r:8,fill:'#140c2c',stroke:P,sw:2})+H.text(cx,156,d.period,{size:34,fill:'#fff',weight:700,font:'din',base:'central'}));
  s+=H.cl('gauge','rate',H.text(cx,250,H.fmt.m(d.rate),{size:58,fill:'#fff',weight:700,font:'din'})+H.text(cx,274,'M tokens/시간',{size:14,fill:PL}));
  s+=H.line(586,292,694,292,{stroke:PD,sw:1.5});
  s+=H.cl('gauge','burn',H.text(cx-42,322,H.fmt.burn(d.burn),{size:26,fill:'#fff',weight:700,font:'din'})+H.text(cx-42,342,'%/시간',{size:13,fill:PL}));
  s+=H.cl('gauge','fuel',H.text(cx+42,322,Math.round(d.minLeft)+'%',{size:26,fill:'#fff',weight:700,font:'din'})+H.text(cx+42,342,'남은 한도',{size:13,fill:PL}));
  // 아래 빈 구간: 기간 기어 줄, 작업 가능 시간, 주행계
  s+=gearRow(H,d,cx,382,{gap:40,width:230,size:13,onSize:15,on:'#fff',off:'#8e80c0',box:'#3a2c66'});
  s+=H.text(cx-10,414,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:'#e2d9ff',weight:600,anchor:'end'});
  s+=H.cl('trip','',H.text(cx+10,414,H.fmt.odo(d.odo)+' · 트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#8e80c0',font:'din',anchor:'start'}));
  s+=H.brand(cx,438,{fill:'#6a5f98',size:11});
  // 네 모서리 원 아이콘 = 경고등
  const corners=[[398,76],[882,76],[398,404],[882,404]];
  const keys=['waiting','reconnect','empty','late'],cols={waiting:'#f2b233',reconnect:'#f2b233',empty:'#ef4a3c',late:'#f2b233'};
  corners.forEach(([x,y],i)=>{const k=keys[i],on=d.lamps[k]>0,c=on?cols[k]:'#3d3560';s+=H.cl('alert',k,H.circle(x,y,21,{fill:'#0c0820',stroke:on?c:'#4a4078',sw:1.5})+H.g(O.ICONS[k](c,22),{t:`translate(${x-11} ${y-11})`}));});
  // 양옆 세로 막대: 엔진 온도(보라), 남은 한도(녹색)
  s+=H.cl('gauge','heat',H.vbars(392,128,12,196,H.frac.heat(d),{n:14,gap:3,fill:P,off:'#1e1538'})+H.text(398,346,'온도',{size:13,fill:PL}));
  s+=H.cl('gauge','fuel',H.vbars(876,128,12,196,H.frac.min(d),{n:14,gap:3,fill:G,off:'#1a2a1a'})+H.text(882,346,'한도',{size:13,fill:PL}));
  // 유리: 위쪽 옅은 반사
  s+=H.rect(352,30,576,150,{r:34,fill:H.lin('gl',[[0,'#fff',1],[1,'#fff',0]]),op:.06});
  return s;}});

 // 48 · Suzuki Jimny (2019) — 네모 하우징 속 두 원, 주황 발광 눈금, 가운데 좁은 빨강 LCD
 O.theme({id:'48',name:'트레일 사각틀',about:'네모난 홈 속 두 원에 주황 발광 눈금을 두고, 가운데 좁은 붉은 화면에 기간·연료·경고등을 한 판으로 넣었습니다.',draw(H,d){
  const O_='#ff5a1e',lc='#ff4a2a';
  let s=H.rect(0,0,1280,480,{fill:'#0b0b0c'});
  const box=(cx)=>H.housing(`M${cx-155} 24 H${cx+155} Q${cx+215} 24 ${cx+215} 84 V396 Q${cx+215} 456 ${cx+155} 456 H${cx-155} Q${cx-215} 456 ${cx-215} 396 V84 Q${cx-215} 24 ${cx-155} 24Z`,{top:'#26262a',bottom:'#0e0e10',rim:.12})+[-1,1].map(k=>H.circle(cx+k*178,62,13,{fill:'#050505',stroke:'#3a3a3c',sw:1.5})).join('');
  s+=box(330)+box(950);
  const cy=244;
  const well=(cx)=>H.circle(cx,cy,190,{fill:'#000',op:.6})+H.circle(cx,cy,188,{fill:'#1c1c1e'})+H.face(cx,cy,184,{fill:'#060606',center:'#0a0a0a',edge:'#020202'});
  // 왼쪽: 토큰 속도 (회색 원판)
  const L=330;
  { const [lr,dr]=rateL(H,d,10,2),no={size:20,fill:O_,font:'helv',weight:500},rt=ringFit(lr,dr,138,no);let g=well(L);
   g+=numsS(H,L,cy,rt,lr,no);
   g+=H.ticks(L,cy,rt,{n:10,minor:1,len:15,mlen:9,w:5,mw:3,color:O_,red:.8,redColor:'#e8302a'});
   g+=H.circle(L,cy,106,{fill:H.rad2('gd',[[0,'#7c7c7c'],[.85,'#5a5a5a'],[1,'#3a3a3a']])});
   g+=H.text(L,cy+58,H.fmt.m(d.rate),{size:24,fill:'#eee',font:'helv',weight:500});
   g+=H.text(L,cy+150,'M tokens/시간',{size:13,fill:O_});
   g+=H.needle(L,cy,rt-12,-135+270*H.frac.rate(d),{style:'taper',w:7,color:'#ff3a1a',tail:0})+H.hub(L,cy,24);
   s+=H.cl('gauge','rate',g); }
  // 오른쪽: 소진 속도 + 6시 방향 작은 엔진 온도 원
  const R=950;
  { const [lb,db]=burnL(H,d,10,2),no={size:20,fill:O_,font:'helv',weight:500},rt=ringFit(lb,db,138,no);let g=well(R);
   g+=numsS(H,R,cy,rt,lb,no);
   g+=H.ticks(R,cy,rt,{n:10,minor:1,len:15,mlen:9,w:5,mw:3,color:O_});
   if(cruF(d)!=null)g+=tickTip(H,R,cy,-135+270*cruF(d),rt,rt-15,'#4be3a0',4);
   g+=H.text(R,cy+52,'%/시간',{size:13,fill:O_});
   g+=H.needle(R,cy,rt-15,-135+270*H.frac.burn(d),{style:'taper',w:7,color:'#ff3a1a',tail:0})+H.hub(R,cy,22);
   s+=H.cl('gauge','burn',g); }
  // 엔진 온도: 바늘이 가지 않는 6시 방향의 작은 원
  { const ty=cy+102,tr=28;
   let g=H.circle(R,ty,tr+3,{fill:'#000',op:.6})+H.circle(R,ty,tr,{fill:'#141414',stroke:'#2e2e2e',sw:1.5});
   g+=H.ticks(R,ty,tr-4,{a0:-60,sweep:120,n:4,minor:0,len:5,w:1.6,color:'#9a9a9a'});
   g+=H.needle(R,ty,tr-6,-60+120*H.frac.heat(d),{style:'thin',w:2,color:'#ff8a3a',tail:0})+H.hub(R,ty,4);
   g+=H.text(R,ty+tr+20,'엔진 온도 '+Math.round(d.heat)+'°',{size:13,fill:'#aaa'});
   s+=H.cl('gauge','heat',g); }
  // 가운데 좁은 LCD 기둥
  s+=H.housing('M572 24 H708 Q722 24 722 38 V442 Q722 456 708 456 H572 Q558 456 558 442 V38 Q558 24 572 24Z',{top:'#1e1e20',bottom:'#0c0c0e',rim:.1});
  const X0=572,X1=708;
  s+=H.rect(X0,72,X1-X0,318,{r:4,fill:'#120303',stroke:'#2a0a06'});
  // 왼쪽 위는 바깥 온도 대신 CPU (값이 없으면 시계만 가운데에)
  s+=(cpuT(d)?H.text(X0+12,96,cpuT(d),{size:14,fill:lc,anchor:'start',font:'helv',base:'central'}):'')+H.text(cpuT(d)?X1-12:640,96,d.clock,{size:14,fill:lc,anchor:'end',font:'helv',base:'central'});
  s+=H.line(X0+8,114,X1-8,114,{stroke:lc,sw:1,op:.45});
  s+=H.text(640,132,d.periodLabel,{size:13,fill:lc,base:'central'});
  s+=H.cl('period',d.period,H.text(640,166,d.period,{size:44,fill:lc,weight:800,font:'helv',base:'central'}));
  // 기간 기어: 기어가 넷 이하면 한 줄, 다섯 이상이면 두 줄로 나눕니다
  { const n=d.gears.length,rows=n>4?2:1,cols=Math.ceil(n/rows),w=(X1-X0-8)/cols,y0=rows>1?198:206;
   d.gears.forEach((g,i)=>{const r=Math.floor(i/cols),c=i%cols,inRow=Math.min(cols,n-r*cols),cur=g===d.period;
    s+=H.cl('period',g,H.text(640+(c-(inRow-1)/2)*w,y0+r*17,g,{size:cur?14:13,fill:cur?lc:'#9a3a28',weight:cur?700:400,font:'helv',base:'central'}));}); }
  s+=H.line(X0+8,226,X1-8,226,{stroke:lc,sw:1,op:.45});
  s+=H.text(640,244,'작업 가능',{size:13,fill:lc,base:'central'})+H.text(640,264,H.fmt.hours(d.rangeH),{size:18,fill:lc,weight:700,font:'helv',base:'central'});
  s+=H.cl('gauge','fuel',H.text(X0+12,294,'E',{size:13,fill:lc,anchor:'start',base:'central'})+H.bars(X0+28,288,80,12,H.frac.min(d),{n:10,gap:2,fill:lc,off:'#2a0a06'})+H.text(X1-12,294,'F',{size:13,fill:lc,anchor:'end',base:'central'}));
  s+=H.line(X0+8,314,X1-8,314,{stroke:lc,sw:1,op:.45});
  s+=H.lamps(640-48,336,d,{size:16,gap:32,off:'#4a2a24',colors:{waiting:'#ff5a1e'}});
  s+=H.text(640,362,H.fmt.odo(d.odo),{size:13,fill:'#b0503a',font:'helv',base:'central'});
  s+=H.cl('trip','',H.text(640,379,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#b0503a',base:'central'}));
  s+=H.brand(640,424,{fill:'#5a5a5c'});
  return s;}});

 // 49 · Mercedes-Benz S-Class W223 — 독립 화면, 은백색 입체 원판 두 개, 가운데 정보 상자
 O.theme({id:'49',name:'플로팅 실버',about:'검은 독립 화면에 은빛 입체 원판 두 개와 가는 바늘, 가운데 속도 표지·큰 숫자·정보 상자를 띄우고, 아래 줄을 두 원판 축과 가운데 축에 맞췄습니다.',draw(H,d){
  const LX=250,RX=1030,CY=228,R=168,FR=R-8,TK=112;
  let s=H.rect(0,0,1280,480,{fill:'#111'});
  s+=H.rect(30,30,1220,420,{r:28,fill:'#08090c',stroke:chromeStroke(H,'c49'),sw:3,filter:H.shadow('ss',6,12,.6)});
  s+=H.rect(40,40,1200,400,{r:22,fill:H.lin('sc',[[0,'#05060a'],[.6,'#121826'],[1,'#1d2738']])});
  // 원판 재질: 선반 가공한 가장자리 모따기(위 밝음·아래 어두움) → 은빛 면 → 동심 결 → 위 테 아래 얕은 그림자 → 돔 반사
  const edge=H.lin('de',[[0,'#ffffff'],[.4,'#d3d8df'],[.75,'#8e96a3'],[1,'#4f5662']]);
  const face=H.rad2('df',[[0,'#fbfcfd'],[.55,'#e8ebf0'],[.86,'#cfd4dc'],[1,'#a9b0bb']],{cy:.44});
  const ins=H.rad2('di',[[.86,'#000',0],[1,'#000',.24]],{cy:.53});
  const spec=H.rad2('dsp',[[0,'#fff',.42],[.55,'#fff',.16],[1,'#fff',0]],{cy:.35});
  let lathe='';for(let r=14;r<FR-2;r+=3.2)lathe+=H.circle(0,0,r,{stroke:(Math.round(r/3.2)%2)?'#fff':'#5a6270',sw:.6,op:(Math.round(r/3.2)%2)?.10:.035});
  // 눈금 숫자: 글자 상자의 안쪽 끝이 눈금 바깥 끝에서 6px 떨어지도록 각도마다 반지름을 정합니다. 숫자가 길면 눈금 고리를 안쪽으로 옮깁니다
  const dial=(key,cx,f,[labels,def],lab,unit,red)=>{
   const no={a0:-130,sweep:260,size:18,fill:'#3a404a',font:'helv',weight:300,gap:6,cw:5.1,hh:7,red,redColor:'#c8302a'},tk=ringFit(labels,def,TK,no);
   let o=H.circle(cx,CY+5,R,{fill:'#000',op:.7,filter:H.shadow('dsh'+cx,4,7,.7)});
   o+=H.circle(cx,CY,R,{fill:edge})+H.circle(cx,CY,R-.6,{stroke:'#fff',sw:1,op:.5});
   o+=H.circle(cx,CY,FR,{fill:face})+H.g(lathe,{t:`translate(${cx} ${CY})`})+H.circle(cx,CY,FR,{fill:ins});
   o+=H.circle(cx,CY,FR,{stroke:'#5d6470',sw:1.2,op:.7});
   o+=`<ellipse cx="${cx}" cy="${CY-FR*.46}" rx="${FR*.78}" ry="${FR*.46}" fill="${spec}"/>`;
   o+=numsS(H,cx,CY,tk,labels,no);
   o+=H.ticks(cx,CY,tk,{a0:-130,sweep:260,n:labels.length-1,minor:4,len:12,mlen:6,w:2,mw:1,color:'#3f4550',mcolor:'#868c96',red,redColor:'#c8302a'});
   o+=H.text(cx,CY+66,unit,{size:13,fill:'#5f6570'})+H.text(cx,CY+88,lab,{size:15,fill:'#2f343c',weight:600});
   o+=H.g(H.needle(cx,CY,tk-12,-130+260*f,{style:'taper',w:4,color:'#000',tail:0}),{t:'translate(1.5 2.5)',op:.22});
   o+=H.needle(cx,CY,tk-12,-130+260*f,{style:'taper',w:4,color:'#22262d',tail:0})+H.hub(cx,CY,7,{fill:'#2a2e36',light:'#7a808a'});
   return H.cl('gauge',key,o);};
  s+=dial('rate',LX,H.frac.rate(d),rateL(H,d,10,2),'토큰 속도','M tokens/시간');
  s+=dial('burn',RX,H.frac.burn(d),burnL(H,d,10,2),'소진 속도','%/시간',.8);
  // 가운데 기둥: 경고등 줄 → 기간 표지와 큰 숫자 → 정보 상자 (모두 x=640 축, 상자 폭 300)
  const BL=490,BR=790;
  s+=H.lamps(640-60,70,d,{size:16,gap:40,off:'#3a404c'});
  s+=H.cl('period',d.period,H.circle(BL+24,132,22,{fill:'#fff',stroke:'#e2231a',sw:4})+H.text(BL+24,132,d.period,{size:13,fill:'#111',weight:700,base:'central'}));
  s+=H.cl('gauge','rate',H.text(640,150,H.fmt.m(d.rate),{size:52,fill:'#fff',weight:300,font:'helv'})+H.text(640,174,'M tokens/시간',{size:13,fill:'#aab'}));
  s+=H.text(640,196,d.periodLabel,{size:13,fill:'#8a93a8'});
  s+=H.rect(BL,214,BR-BL,140,{r:14,fill:'#000',op:.35})+H.rect(BL,214,BR-BL,140,{r:14,stroke:'#8a909a',sw:1.5,fill:'none'});
  s+=H.text(640,246,`기간 합계 ${H.fmt.m(d.tokens)}M`,{size:17,fill:'#fff',weight:600});
  s+=H.line(BL+18,262,BR-18,262,{stroke:'#4a5060',sw:1});
  s+=H.cl('trip','',H.text(565,292,`트립 ${H.fmt.trip(d.trip)}M`,{size:14,fill:'#fff'}))+H.text(715,292,cruF(d)!=null?`적정 ${cru(d)} %/시간`:`작업 중 세션 ${d.sessions.working}`,{size:14,fill:'#fff'});
  s+=H.line(640,276,640,336,{stroke:'#4a5060',sw:1});
  s+=H.cl('gauge','fuel',H.text(565,326,`한도 ${Math.round(d.minLeft)}%`,{size:14,fill:'#f08a3a'}))+H.text(715,326,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:'#f08a3a'});
  // 아래 줄: 왼쪽 원판 축, 가운데 축, 오른쪽 원판 축
  const BY=424;
  s+=H.text(LX,BY,d.clock,{size:15,fill:'#ddd',font:'helv'});
  s+=H.text(640,BY,'주행 '+H.fmt.odo(d.odo),{size:13,fill:'#8a93a8'});
  s+=H.cl('gauge','heat',H.text(RX,BY,(cpuT(d)?cpuT(d)+' · ':'')+'엔진 '+Math.round(d.heat)+'°',{size:15,fill:'#ddd'}));
  // 기간 기어 줄: 정보 상자 아래, 가운데 축
  s+=gearRow(H,d,640,384,{gap:46,width:BR-BL,size:14,onSize:15,on:'#fff',off:'#8a93a8',box:'#2a3346'});
  s+=H.brand(1214,BY,{fill:'#7a8294',anchor:'end'});
  return s;}});

 // 50 · BMW i4 — 각진 사선 눈금 두 개, 삼각 격자 배경, 가운데 큰 디지털 숫자
 O.theme({id:'50',name:'커브드 앵귤러',about:'원 대신 비스듬한 직선 눈금 두 개로 양쪽을 감싸고, 삼각 격자 배경 가운데에 큰 숫자를 띄웠습니다. 아래 정보 줄은 가운데 축에 좌우 대칭입니다.',draw(H,d){
  let s=H.rect(0,0,1280,480,{fill:'#0a0b0d'});
  const scr='M76 44 Q640 12 1204 44 V430 Q1204 444 1190 444 H90 Q76 444 76 430Z';
  s+=H.housing(scr,{top:'#0e1b28',bottom:'#03070a',rim:.12});
  s+=H.path(scr,{fill:H.lin('sc',[[0,'#0d1a26',0],[.75,'#061018',.4],[1,'#020508',.8]])});
  // 사선 눈금: 바깥 끝은 바닥선, 안쪽 위로 올라감
  const ladder=(key,x0,y0,x1,y1,f,labels,side,title,unit)=>{
   let o='';const n=labels.length-1,mx=side<0?1:-1,id='pn'+(side<0?'l':'r');
   // 눈금 안쪽 유리 칸: 눈금선과 평행한 평행사변형 한 장. 값 아래쪽은 밝게 차오릅니다.
   const W=150,Ty=y1+28,Tx=x1+mx*W,kx=(x0-x1)/(y0-y1),Bx=Tx+kx*(y0-Ty);
   const P=`M${x0} ${y0} L${x1} ${y1} L${H.r2(Tx)} ${Ty} L${H.r2(Bx)} ${y0}Z`;
   const pc=H.clip(id+'c',`<path d="${P}"/>`);
   o+=H.path(P,{fill:H.lin(id,[[0,'#1c4460'],[.55,'#0d2436'],[1,'#071420']],{dir:side<0?[0,0,1,0]:[1,0,0,0]})});
   const fx=x0+(x1-x0)*f,fy=y0+(y1-y0)*f;
   o+=H.g(H.rect(0,fy,1280,y0-fy,{fill:H.lin(id+'v',[[0,'#3f86b4',.55],[1,'#2a6a96',.2]])})+H.line(fx,fy,fx+mx*(W+40),fy,{stroke:'#fff',sw:2,op:.9}),{clip:pc});
   o+=H.path(`M${x1} ${y1} L${H.r2(Tx)} ${Ty} L${H.r2(Bx)} ${y0}`,{stroke:'#6a9aba',sw:1,op:.55});
   o+=H.line(x0,y0,x1,y1,{stroke:'#6a7a8a',sw:3});
   for(let i=0;i<=n;i++){const k=i/n,x=x0+(x1-x0)*k,y=y0+(y1-y0)*k;o+=H.line(x,y,x+mx*14,y,{stroke:'#aab4c0',sw:2})+(labels[i]?H.text(x-mx*12,y,labels[i],{size:15,fill:'#dde3ea',anchor:side<0?'end':'start',font:'helv',base:'central'}):'');}
   o+=H.line(x0,y0,fx,fy,{stroke:'#fff',sw:6,cap:'round'});
   o+=H.text(x1+mx*10,y1-34,unit,{size:13,fill:'#8a96a6',anchor:side<0?'start':'end',base:'central'})+H.text(x1+mx*10,y1-16,title,{size:14,fill:'#d4dae2',anchor:side<0?'start':'end',base:'central',weight:600});
   return H.cl('gauge',key,o);};
  s+=ladder('rate',170,380,300,96,H.frac.rate(d),H.rateScale(d,10),-1,'토큰 속도','M tokens/시간');
  s+=ladder('burn',1110,380,980,96,H.frac.burn(d),H.burnScale(d,10),1,'소진 속도','%/시간'+(cruF(d)!=null?` · 적정 ${cru(d)}`:''));
  if(cruF(d)!=null){const k=cruF(d),x=1110+(980-1110)*k,y=380+(96-380)*k;s+=H.cl('gauge','burn',H.path(`M${H.r2(x-22)} ${H.r2(y)} L${H.r2(x-32)} ${H.r2(y-6)} L${H.r2(x-32)} ${H.r2(y+6)}Z`,{fill:'#4be3a0'}));}
  s+=H.line(170,380,1110,380,{stroke:'#6a7a8a',sw:2});
  // 가운데 숫자
  s+=H.lamps(640-60,92,d,{size:16,gap:40,off:'#34404c'});
  s+=H.cl('gauge','rate',H.text(640,250,H.fmt.m(d.rate),{size:96,fill:'#fff',weight:200,font:'helv'})+H.text(640,280,'M tokens/시간',{size:14,fill:'#b8c2ce'}));
  s+=H.gear(640,322,d,{gap:42,width:400,size:14,on:'#fff',off:'#7a8696'});
  // 아래 줄 (가운데 축 대칭: 150↔1130, 430↔850)
  const BY=414;
  s+=H.cl('gauge','fuel',H.text(150,BY,`남은 한도 ${Math.round(d.minLeft)}%`,{size:15,fill:'#ddd',anchor:'start',base:'central'}));
  s+=H.text(430,BY,d.clock,{size:15,fill:'#ddd',font:'helv',base:'central'});
  s+=H.text(630,BY,'주행 '+H.fmt.odo(d.odo),{size:13,fill:'#8a96a6',anchor:'end',base:'central'});
  s+=H.cl('trip','',H.text(650,BY,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#8a96a6',anchor:'start',base:'central'}));
  s+=H.cl('gauge','heat',H.text(850,BY,'엔진 온도 '+Math.round(d.heat)+'°',{size:15,fill:'#ddd',base:'central'}));
  s+=H.text(1130,BY,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:15,fill:'#ddd',anchor:'end',base:'central'});
  s+=H.brand(640,64,{fill:'#7a8696'});
  return s;}});
})(window.OneTop);
