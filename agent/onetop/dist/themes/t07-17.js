/* 07–17 · v4.0.0 — 습작 징후(E1–9)를 걷어 낸 판입니다. */
(function(O){
 'use strict';
 // 글자 상자의 반지름 방향 반폭: 각도 a에서 글자(w×h)가 원 중심 방향으로 차지하는 절반 길이
 const radSpan=(t,a,sz,cw=.58)=>{const ra=a*Math.PI/180,w=String(t).length*sz*cw,h=sz*.74;return w/2*Math.abs(Math.sin(ra))+h/2*Math.abs(Math.cos(ra));};
 const maxSpan=(labels,a0,sw,sz,cw)=>{const n=labels.length-1;let m=0;labels.forEach((t,i)=>{if(t!==''&&t!=null)m=Math.max(m,radSpan(t,a0+sw*(n?i/n:0),sz,cw));});return m;};
 // 원형 계기 치수: 숫자는 바깥 고리, 눈금은 그 안쪽. '1000'처럼 숫자가 넓어지면 글자 크기는 그대로 두고 눈금 고리를 안쪽으로 옮깁니다.
 function dialGeom(c){
  const a0=c.a0??-135,sw=c.sweep??270,ns=c.numSize||18;
  const hasNum=c.labels.some(v=>v!=='');
  if(!hasNum)return {a0,sw,ns,hasNum,numR:0,tickR:c.r-(c.tin??4)};
  const pad=c.numPad??2,ms=maxSpan(c.labels,a0,sw,ns);
  const numR=Math.min(c.r-ns*1.05-pad,c.r-pad-ms);
  const tickR=Math.min(numR-ns*.95-4,numR-ms-4);
  return {a0,sw,ns,hasNum,numR,tickR};
 }
 // 이 파일 전용 원형 계기. 숫자는 바깥 고리, 눈금은 그 안쪽 고리, 바늘은 눈금 바깥 끝까지 닿습니다.
 function dial(H,c){
  const {a0,sw,ns,hasNum,numR,tickR}=dialGeom(c),n=c.labels.length-1,len=c.len??14;
  let o='';
  if(c.face)o+=H.circle(c.cx,c.cy,c.r,{fill:c.face});
  if(c.redBand!=null)o+=H.band(c.cx,c.cy,tickR-len,tickR,a0+sw*c.redBand,a0+sw,{fill:c.redBandColor||'#d8301e'});
  o+=H.ticks(c.cx,c.cy,tickR,{a0,sweep:sw,n,minor:c.minor??4,len,mlen:c.mlen??7,w:c.tw??2.6,mw:c.mw??1.2,color:c.tick||'#fff',mcolor:c.mtick,red:c.red,redColor:c.redColor});
  if(hasNum)o+=H.nums(c.cx,c.cy,numR,c.labels,{a0,sweep:sw,size:ns,fill:c.num||'#fff',font:c.font||'helv',weight:c.weight,red:c.red,redColor:c.redColor});
  if(c.extra)o+=c.extra;
  o+=H.needle(c.cx,c.cy,tickR,a0+sw*H.clamp(c.f),{style:c.nstyle||'taper',w:c.nw??7,color:c.needle||'#ff5a1f',tail:c.tail});
  o+=H.hub(c.cx,c.cy,c.cap??Math.max(6,c.r*.1),{fill:c.capFill||'#1c1e21',light:c.capLight});
  return o;
 }
 // 눈금 숫자: 글자 폭·높이로 각도마다 반지름을 정해, 큰 눈금 끝에서 글자 상자까지 clear(6px)를 띄웁니다.
 // dir=+1이면 눈금 바깥 끝(rT)보다 바깥, -1이면 눈금 안쪽 끝(rT)보다 안쪽에 둡니다.
 const fitNums=(H,cx,cy,rT,labels,o={})=>{const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1,sz=o.size||16,cw=o.cw??.58,dir=o.dir??1,cl=o.clear??6;
  return labels.map((t,i)=>{if(t===''||t==null)return '';const f=n?i/n:0,a=a0+sw*f,sp=radSpan(t,a,sz,cw),[x,y]=H.pt(cx,cy,rT+dir*(cl+sp),a),red=o.red!=null&&f>=o.red;
   return H.text(x,y,t,{size:sz,fill:red?(o.redColor||'#e53b2c'):(o.fill||'#fff'),font:o.font||'ui',weight:o.weight,base:'central'});}).join('');};
 // 고리 숫자(한 원 위, 눈금 안쪽): 기본 반지름 r은 200M 숫자 폭에 맞춘 것입니다. '1000'처럼 더 넓으면 늘어난 폭만큼 안쪽 원으로 옮깁니다
 const ringNums=(H,cx,cy,r,labels,ref,o={})=>{const a0=o.a0??-135,sw=o.sweep??270,sz=o.size||16;
  return H.nums(cx,cy,r-Math.max(0,maxSpan(labels,a0,sw,sz,o.cw)-maxSpan(ref,a0,sw,sz,o.cw)),labels,o);};
 // 기간 기어: 모든 칸이 같은 크기, 현재 기어만 강조색·굵게.
 // o.width: 기어 줄이 쓸 수 있는 폭. 기어가 많으면 간격을 폭/개수로 줄이고, 그래도 넘치면 글자를 13px까지 줄입니다.
 const gearFit=(d,gap,size,width)=>{const n=d.gears.length,ml=Math.max(...d.gears.map(g=>g.length));
  if(width&&n>1)gap=Math.min(gap,width/n);size=Math.min(size,Math.max(13,(gap-6)/(ml*.6)));return {gap,size};};
 function gears(H,cx,y,d,o={}){
  const {gap,size}=gearFit(d,o.gap||40,o.size||14,o.width),n=d.gears.length;let s='';
  d.gears.forEach((g,i)=>{const on=g===d.period,px=cx+(i-(n-1)/2)*gap;let one='';
   if(on&&o.box)one+=H.rect(px-gap/2+4,y-size*.85,gap-8,size*1.7,{r:o.r??3,fill:o.box});
   one+=H.text(px,y,g,{size,fill:on?(o.on||'#fff'):(o.off||'#777'),weight:on?700:500,font:o.font||'ui',base:'central'});
   s+=H.cl('period',g,one);});
  return s;
 }
 // 경고등 줄: 가운데 정렬
 const lampsAt=(H,cx,y,d,o={})=>{const gap=o.gap||40;return H.lamps(cx-1.5*gap,y,d,{...o,gap});};
 // 경고등 하나 (bg: 칸 바탕까지 함께 감쌉니다)
 const LAMP=[['waiting','#f2b233'],['reconnect','#f2b233'],['empty','#ef4a3c'],['late','#f2b233']];
 const lamp=(H,i,x,y,d,sz,off,bg='')=>{const [k,c]=LAMP[i],on=d.lamps[k]>0;return H.cl('alert',k,bg+H.g(O.ICONS[k](on?c:off,sz),{t:`translate(${H.r2(x-sz/2)} ${H.r2(y-sz/2)})`}));};
 // 이름·값·단위를 한 축에 쌓습니다. y는 이름 줄 중심입니다.
 function stack(H,cx,y,o){
  const ls=o.ls||13,vs=o.vs||24,g=o.gap??5;let s='';
  if(o.label)s+=H.text(cx,y,o.label,{size:ls,fill:o.lc||'#b9b9b9',base:'central'});
  const vy=o.label?y+ls/2+g+vs*.42:y;
  s+=H.text(cx,vy,o.value,{size:vs,fill:o.vc||'#fff',font:o.vf||'helv',weight:o.vw||500,base:'central'});
  if(o.unit)s+=H.text(cx,vy+vs*.42+g+ls/2,o.unit,{size:ls,fill:o.uc||o.lc||'#9a9a9a',base:'central'});
  return s;
 }
 // 눈금 숫자는 d의 범위에서 만듭니다 (200M·20%일 때 원본과 같은 숫자)
 const R6=(H,d)=>H.rateScale(d,10,{every:2});
 const B6=(H,d)=>H.burnScale(d,10,{every:2});
 const B10=(H,d)=>H.burnScale(d,10);
 // v4.2.0 계정 목록(d.fuel 0~8개): 같은 도구가 여러 번 나오면 plan을 붙여 구분하고, max줄을 넘으면 앞쪽 max-1개와 '+K' 줄로 줄입니다
 const fuelList=(d,max)=>{const f=d.fuel||[],cnt={};f.forEach(a=>{cnt[a.name]=(cnt[a.name]||0)+1;});
  const rows=f.map(a=>({name:cnt[a.name]>1&&a.plan?a.name+' '+a.plan:String(a.name??''),left:Math.max(0,Math.min(100,Number.isFinite(+a.left)?+a.left:0))}));
  const more=rows.length>max?rows.length-(max-1):0;return {rows:more?rows.slice(0,max-1):rows,more,slots:more?max:rows.length};};
 const nameW=(t,sz)=>String(t).length*sz*.58;
 const trip=(H,x,y,d,o={})=>H.cl('trip','',H.text(x,y,'트립 '+H.fmt.trip(d.trip)+'M',{size:o.size||13,fill:o.fill||'#bbb',anchor:o.anchor||'middle',base:'central',font:o.font}));

 // 07 · Toyota Supra A80 — 크롬 테두리 세 원, 가운데 회전계가 한 단 높음, 오른쪽은 연료·온도 겸용, 어깨에 초록 표시창
 O.theme({id:'07',name:'트리플 포드',about:'겹치지 않는 세 원을 크롬 테두리로 감싸고, 가운데 토큰 속도계를 한 단 높게 세웠습니다.',draw(H,d){
  const W='#f2efe6',AC='#ff5a2a',LB='#c9c5ba';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1d1e20'],[1,'#0b0b0c']])});
  s+=H.housing('M92 300 C92 170 176 104 290 104 C372 104 410 62 460 62 L500 62 C530 30 580 18 640 18 C700 18 750 30 780 62 L820 62 C870 62 908 104 990 104 C1104 104 1188 170 1188 300 C1188 404 1112 464 990 464 L290 464 C168 464 92 404 92 300Z',{top:'#232528',bottom:'#0c0d0e',rim:.1});
  const pod=(cx,cy,r)=>H.bezel(cx,cy,r,16,{tone:'chrome'})+H.face(cx,cy,r,{fill:'#141517',center:'#1b1c1f',edge:'#060607'});
  // 왼쪽: 소진 속도
  const L={cx:280,cy:284,r:150};
  s+=H.cl('gauge','burn',pod(L.cx,L.cy,L.r)+dial(H,{...L,labels:B6(H,d),f:H.frac.burn(d),tick:W,num:W,numSize:24,minor:4,len:14,mlen:7,red:.8,redColor:AC,needle:AC,nw:6,cap:14,
   extra:stack(H,L.cx,L.cy+52,{label:'소진 속도',value:H.fmt.burn(d.burn),unit:'%/시간',vs:26,vc:AC,lc:LB})}));
  // 가운데: 토큰 속도 (한 단 위)
  const C={cx:640,cy:198,r:150};
  s+=H.cl('gauge','rate',pod(C.cx,C.cy,C.r)+dial(H,{...C,labels:R6(H,d),f:H.frac.rate(d),tick:W,num:W,numSize:26,red:.8,redBand:.8,redBandColor:AC,redColor:AC,needle:AC,nw:7,cap:15,
   extra:stack(H,C.cx,C.cy+50,{label:'토큰 속도',value:H.fmt.m(d.rate),unit:'M tokens/시간',vs:32,vc:AC,lc:LB})}));
  // 오른쪽: 연료(왼쪽 위 사분면)·엔진 온도(오른쪽 아래 사분면)
  const R={cx:1000,cy:284,r:150};
  s+=pod(R.cx,R.cy,R.r);
  // 원본 겸용 계기처럼 축을 둘로 나눕니다: 위는 연료(큰 부채꼴), 아래는 엔진 온도(작은 부채꼴). 두 바늘은 서로의 눈금에 닿지 않습니다.
  const F={x:R.cx,y:R.cy+34},T={x:R.cx,y:R.cy+118},ft=118,tt=42;
  let fu=H.ticks(F.x,F.y,ft,{a0:-60,sweep:120,n:4,minor:1,len:14,mlen:7,w:2.6,mw:1.2,color:W})+(()=>{const [x1,y1]=H.pt(F.x,F.y,ft,-60),[x2,y2]=H.pt(F.x,F.y,ft-14,-60);return H.line(x1,y1,x2,y2,{stroke:AC,sw:2.6});})();
  const fl=(a,t,c)=>{const [x,y]=H.pt(F.x,F.y,ft+18,a);return H.text(x,y,t,{size:22,fill:c||W,font:'helv',base:'central'});};
  fu+=fl(-60,'E',AC)+fl(0,'½')+fl(60,'F');
  let he=H.ticks(T.x,T.y,tt,{a0:-60,sweep:120,n:2,minor:1,len:10,mlen:5,w:2.4,mw:1.2,color:W,red:.99,redColor:AC});
  const tl=(a,t,c)=>{const [x,y]=H.pt(T.x,T.y,tt+14,a);return H.text(x,y,t,{size:16,fill:c||W,font:'helv',base:'central'});};
  he+=tl(-60,'C')+tl(60,'H',AC);
  fu+=stack(H,R.cx-84,R.cy+30,{label:'남은 한도',value:Math.round(d.minLeft)+'%',vs:22,vc:W,lc:LB});
  he+=stack(H,R.cx+84,R.cy+30,{label:'엔진 온도',value:Math.round(d.heat)+'°',vs:22,vc:W,lc:LB});
  fu+=H.needle(F.x,F.y,ft-14,-60+120*H.frac.min(d),{style:'taper',w:6,color:AC,tail:0})+H.hub(F.x,F.y,12);
  he+=H.needle(T.x,T.y,tt-10,-60+120*H.frac.heat(d),{style:'taper',w:4,color:AC,tail:0})+H.hub(T.x,T.y,8);
  s+=H.cl('gauge','heat',he)+H.cl('gauge','fuel',fu);
  // 어깨의 초록 표시창 둘 (원본의 녹색 사각 램프 자리)
  const win=(cx,i0)=>H.rect(cx-30,84,60,40,{r:6,fill:'#050606',stroke:'#2e3134',sw:1.5})+lamp(H,i0,cx-14,104,d,20,'#24302a')+lamp(H,i0+1,cx+14,104,d,20,'#24302a');
  s+=win(455,0)+win(825,2);
  // 가운데 아래: 주행계·기어·1top을 한 축에
  // 주행계 창 오른쪽 칸에 트립
  s+=H.rect(546,362,188,26,{r:4,fill:'#050506',stroke:'#2e3134'})+H.text(592,375,H.fmt.odo(d.odo,6),{size:16,fill:W,font:'helv',ls:2,base:'central'})+H.line(638,366,638,384,{stroke:'#2e3134'});
  s+=trip(H,686,375,d,{fill:LB});
  s+=gears(H,640,410,d,{gap:40,size:14,on:AC,off:'#8a8780',width:300});
  s+=H.brand(640,442,{fill:'#77746d',size:11});
  return s;}});

 // 08 · Ford Mustang 1967 — 검은 대시에 크롬 몰딩, 크롬 다리로 이어진 큰 원 둘, 위쪽 작은 원 셋
 O.theme({id:'08',name:'크롬 트윈 67',about:'크롬 다리로 이어진 큰 원 둘과 위쪽 작은 원 셋, 좁은 산세리프 숫자로 67년 대시를 옮겼습니다.',draw(H,d){
  const W='#ebe8df',AC='#e2462a',LB='#bdb9ae',F='cond';
  let s=H.rect(0,0,1280,480,{fill:'#070707'});
  const dash='M40 74 Q640 26 1240 74 L1240 450 Q640 478 40 450Z';
  s+=H.housing(dash,{top:'#1b1b1b',bottom:'#0b0b0b',rim:0});
  s+=H.path('M40 74 Q640 26 1240 74',{stroke:H.lin('trim',[[0,'#6f6f6f'],[.5,'#e2e2e2'],[1,'#6f6f6f']],{dir:[0,0,1,0]}),sw:3});
  const face=(cx,cy,r)=>H.face(cx,cy,r,{fill:'#2a2e33',center:'#363b41',edge:'#121417'});
  // 크롬 다리
  s+=H.rect(560,262,160,48,{fill:H.lin('br',[[0,'#f2f2f2'],[.45,'#8b8f94'],[.55,'#5f6368'],[1,'#c9ccd0']])})+H.line(560,262,720,262,{stroke:'#fff',op:.4});
  s+=H.text(640,286,'1top',{size:12,fill:'#2a2c2f',weight:700,base:'central',ls:.5});
  const big=(k,cx,f,labels,red,lab,val,unit)=>{const cy=286,r=140;
   let o=H.bezel(cx,cy,r,32,{tone:'chrome'})+face(cx,cy,r)+H.circle(cx,cy,r-1,{stroke:'#000',sw:2,op:.6});
   o+=dial(H,{cx,cy,r,labels,f,tick:W,num:W,numSize:26,font:F,minor:4,len:14,mlen:7,tw:2.6,red,redColor:AC,needle:AC,nw:5,cap:22,capFill:'#8d9196',capLight:'#f4f5f6',
    extra:H.text(cx,cy+46,lab,{size:13,fill:LB,base:'central'})+H.rect(cx-38,cy+60,76,28,{r:3,fill:'#0b0c0d',stroke:'#4a4d51'})+H.text(cx,cy+74.5,val,{size:20,fill:W,font:F,base:'central',ls:1})+H.text(cx,cy+102,unit,{size:13,fill:LB,base:'central'})});
   return H.cl('gauge',k,o);};
  s+=big('rate',440,H.frac.rate(d),R6(H,d),.8,'토큰 속도',H.fmt.m(d.rate),'M tokens/시간');
  s+=big('burn',840,H.frac.burn(d),B6(H,d),.8,'소진 속도',H.fmt.burn(d.burn),'%/시간');
  // 작은 원: 눈금 호는 위쪽, 이름은 아래쪽 (바늘이 가지 않는 자리)
  const small=(cx,cy,f,l0,l1,lab,k)=>{const r=50;
   let o=H.bezel(cx,cy,r,12,{tone:'chrome'})+face(cx,cy,r);
   o+=H.ticks(cx,cy,r-5,{a0:-60,sweep:120,n:4,minor:0,len:8,w:2,color:W,red:.99,redColor:AC});
   const [ex,ey]=H.pt(cx,cy,r-15,-80),[fx,fy]=H.pt(cx,cy,r-15,80);
   o+=H.text(ex+2,ey,l0,{size:13,fill:W,font:F,base:'central'})+H.text(fx-2,fy,l1,{size:13,fill:W,font:F,base:'central'});
   o+=H.text(cx,cy+27,lab,{size:13,fill:LB,base:'central'});
   o+=H.needle(cx,cy,r-6,-60+120*H.clamp(f),{style:'taper',w:4,color:AC,tail:0})+H.hub(cx,cy,8,{fill:'#8d9196',light:'#f4f5f6'});
   return k?H.cl('gauge',k,o):o;};
  s+=small(170,152,H.frac.min(d),'E','F','남은 한도','fuel');
  s+=small(640,128,H.frac.heat(d),'C','H','엔진 온도','heat');
  s+=small(1110,152,H.frac.cpu(d),'0','100','CPU');
  // 작은 원 사이의 표시 창 둘 (원본의 와이퍼·브레이크 창 자리)
  const slot=(cx,i0)=>H.rect(cx-40,82,80,30,{r:3,fill:'#050505',stroke:'#5a5a5a',sw:1.5})+lamp(H,i0,cx-16,97,d,18,'#34322e')+lamp(H,i0+1,cx+16,97,d,18,'#34322e');
  s+=slot(405,0)+slot(875,2);
  s+=trip(H,640,334,d,{fill:LB,font:F,size:14});
  s+=gears(H,640,438,d,{gap:36,size:15,on:W,off:'#77746c',font:F,width:220});
  return s;}});

 // 09 · Tesla Model S 초기형 — 은색 테두리의 넓은 화면, 가운데 원, 왼쪽 범위, 오른쪽 기록 그래프
 O.theme({id:'09',name:'일렉트릭 오벌',about:'은빛 테두리 화면 가운데 원 하나에 토큰 속도와 남은 한도 막대를 넣고, 오른쪽에 토큰 흐름 그래프를 그렸습니다.',draw(H,d){
  const TX='#eef3f8',DIM='#9fb0c2',MUT='#6f8193',BL='#6fb6ff',GR='#47d16b';
  let s=H.rect(0,0,1280,480,{fill:'#050607'});
  const outer='M100 34 H1180 Q1226 34 1222 80 L1196 406 Q1192 450 1148 450 H132 Q88 450 84 406 L58 80 Q54 34 100 34Z';
  s+=H.path(outer,{fill:H.lin('bz',H.tones.satin,{dir:[0,0,0,1]}),filter:H.shadow('bzs',6,14,.6)})+H.path(outer,{stroke:'#fff',sw:1,op:.25});
  s+=H.path('M110 48 H1170 Q1208 48 1205 84 L1180 400 Q1177 436 1140 436 H140 Q103 436 100 400 L75 84 Q72 48 110 48Z',{fill:'#000'});
  const scr='M120 60 H1160 Q1192 60 1190 90 L1166 394 Q1163 424 1132 424 H148 Q117 424 114 394 L90 90 Q88 60 120 60Z';
  s+=H.path(scr,{fill:H.lin('sc',[[0,'#26323e'],[.55,'#1a232c'],[1,'#10161c']])});
  // 가운데 원
  const cx=640,cy=234;
  let rg=H.circle(cx,cy,158,{fill:'#0b1016',stroke:'#3e4d5c',sw:2})+H.circle(cx,cy,155,{stroke:'#9aa6b2',sw:1,op:.35});
  rg+=H.face(cx,cy,148,{fill:'#132130',center:'#1c2c3d',edge:'#070b10'});
  rg+=H.arc(cx,cy,152,-120,120,{stroke:'#22303d',sw:5})+H.arc(cx,cy,152,-120,-120+240*H.frac.rate(d),{stroke:BL,sw:5});
  rg+=H.ticks(cx,cy,144,{a0:-120,sweep:240,n:10,minor:1,len:9,mlen:5,w:2,color:'#cfd8e2',mcolor:'#6d7d8e'});
  rg+=fitNums(H,cx,cy,135,H.rateScale(d,10),{a0:-120,sweep:240,size:14,fill:'#cfd8e2',font:'helv',dir:-1});
  rg+=H.brand(cx,cy-72,{fill:MUT,size:11});
  rg+=H.text(cx,cy-24,H.fmt.m(d.rate),{size:62,fill:'#fff',font:'helv',weight:300,base:'central'});
  rg+=H.text(cx,cy+16,'M tokens/시간',{size:13,fill:DIM,base:'central'});
  s+=H.cl('gauge','rate',rg);
  s+=H.rect(cx-62,cy+34,124,10,{fill:'#16202a',r:3})+H.rect(cx-62,cy+34,124*H.frac.min(d),10,{fill:GR,r:3});
  s+=H.text(cx,cy+66,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:16,fill:TX,base:'central'});
  s+=H.text(cx,cy+88,'남은 한도 '+Math.round(d.minLeft)+'%',{size:13,fill:DIM,base:'central'});
  // 아래 상태 줄: 기어(원본 PRND 자리)·주행계·트립·온도·시계가 한 기준선
  const by=406;
  s+=gears(H,cx,by,d,{gap:36,size:14,on:'#fff',off:MUT,width:300});
  s+=H.text(160,by,'누적 '+H.fmt.comma(d.odo/1e6)+'M',{size:13,fill:DIM,anchor:'start',base:'central'})+trip(H,262,by,d,{fill:DIM,anchor:'start'});
  s+=H.text(1120,by,d.clock,{size:13,fill:DIM,anchor:'end',base:'central'});
  // 왼쪽 단: 소진 속도·계정 한도
  const lx=160,lw=270,hasCruise=d.cruise!=null&&isFinite(d.cruise);
  let bg=H.text(lx,104,'소진 속도',{size:14,fill:DIM,anchor:'start',base:'central'});
  bg+=H.text(lx,140,H.fmt.burn(d.burn),{size:36,fill:'#fff',anchor:'start',font:'helv',weight:300,base:'central'})+H.text(lx+84,146,'%/시간',{size:13,fill:DIM,anchor:'start',base:'central'});
  bg+=H.rect(lx,170,lw,8,{fill:'#2a3642',r:2})+H.rect(lx,170,lw*H.frac.burn(d),8,{fill:'#d8b04a',r:2})+(hasCruise?H.rect(lx+lw*H.clamp(d.cruise/d.burnMax)-1,165,2,18,{fill:GR}):'');
  bg+=H.text(lx,194,'0',{size:12,fill:MUT,anchor:'start',base:'central'})+H.text(lx+lw,194,O.fmtScale(d.burnMax),{size:12,fill:MUT,anchor:'end',base:'central'})+(hasCruise?H.text(lx+lw,104,'적정 '+O.fmtScale(d.cruise),{size:13,fill:GR,anchor:'end',base:'central'}):'');
  s+=H.cl('gauge','burn',bg);
  let fu=H.text(lx,236,'계정별 남은 주간 한도',{size:13,fill:DIM,anchor:'start',base:'central'});
  // 계정 줄: 268부터 아래 상태 줄(406) 위 378까지 최대 6줄(넘치면 5줄 + '+K'). 이름이 길면 막대 시작을 오른쪽으로 옮깁니다
  {const {rows,more,slots}=fuelList(d,6),st=slots>1?Math.min(32,110/(slots-1)):32,bx=lx+Math.max(70,...rows.map(f=>nameW(f.name,14)+10)),bw=lx+230-bx;
   rows.forEach((f,i)=>{const y=268+i*st;fu+=H.text(lx,y,f.name,{size:14,fill:TX,anchor:'start',base:'central'})+H.rect(bx,y-4,bw,8,{fill:'#2a3642',r:2})+H.rect(bx,y-4,bw*f.left/100,8,{fill:f.left<40?'#e0a030':GR,r:2})+H.text(lx+lw,y,Math.round(f.left)+'%',{size:13,fill:DIM,anchor:'end',base:'central'});});
   if(more)fu+=H.text(lx,268+(slots-1)*st,'+'+more,{size:14,fill:DIM,anchor:'start',base:'central'});
   if(!slots)fu+=H.text(lx,268,'계정 없음',{size:14,fill:MUT,anchor:'start',base:'central'});}
  s+=H.cl('gauge','fuel',fu);
  // 오른쪽 단: 토큰 흐름
  const rx=850,rw=270;
  s+=H.text(rx,104,'토큰 흐름',{size:14,fill:DIM,anchor:'start',base:'central'})+H.text(rx+rw,104,d.periodLabel,{size:13,fill:MUT,anchor:'end',base:'central'});
  for(let k=0;k<4;k++)s+=H.line(rx,140+k*40,rx+rw,140+k*40,{stroke:'#33414f',sw:1,op:.6});
  s+=H.spark(rx,132,rw,128,d.flow,{stroke:'#f0a030',sw:2,area:H.lin('ar',[[0,'#f0a030',.4],[1,'#f0a030',0]])});
  s+=H.line(rx,260,rx+rw,260,{stroke:'#4a5a6a'});
  s+=H.cl('gauge','heat',H.text(rx,290,'엔진 온도 '+Math.round(d.heat)+'°  ·  CPU '+Math.round(d.cpu)+'%',{size:13,fill:DIM,anchor:'start',base:'central'}));
  for(let i=0;i<4;i++)s+=lamp(H,i,rx+9+i*44,334,d,18,'#3a4856');
  return s;}});

 // 10 · Chevrolet Corvette C4 — 액정 세 칸: 왼쪽·오른쪽 휘어 오르는 막대, 가운데 숫자 창
 O.theme({id:'10',name:'리퀴드 크리스털',about:'액정 세 칸에 휘어 오르는 컬러 막대와 호박색 숫자 창을 옮겼습니다.',draw(H,d){
  const AM='#ffb21f',AL='#e8a43a',DM='#1c1306',GN='#2ee05a';
  let s=H.rect(0,0,1280,480,{fill:'#050505'});
  s+=H.housing('M60 40 H1220 Q1240 40 1240 60 V428 Q1240 448 1220 448 H60 Q40 448 40 428 V60 Q40 40 60 40Z',{top:'#1a1b1d',bottom:'#0c0d0e',rim:.1});
  const lcd=(x,y,w,h)=>H.rect(x-3,y-3,w+6,h+6,{r:9,fill:'#000'})+H.rect(x,y,w,h,{r:6,fill:H.lin('lc'+x,[[0,'#0b0e0b'],[1,'#060706']])})+H.rect(x,y,w,h,{r:6,stroke:'#fff',sw:1,op:.06});
  // 휘어 오르는 막대: 아래 왼쪽에서 위 오른쪽으로
  const fan=(x0,y0,w,h,f,n,cols)=>{let o='';const on=Math.round(H.clamp(f)*n);
   const p=t=>[x0+w*Math.pow(t,1.6)*.92,y0-h*t];
   for(let i=0;i<n;i++){const k=i/n,k2=(i+.72)/n;const [ax,ay]=p(k),[bx,by]=p(k2);const L=22+72*k;
    let col=cols[0][1];for(const [kk,c] of cols)if(k>=kk)col=c;
    o+=H.path(`M${H.r2(ax)} ${H.r2(ay)}L${H.r2(ax+L)} ${H.r2(ay)}L${H.r2(bx+L)} ${H.r2(by)}L${H.r2(bx)} ${H.r2(by)}Z`,{fill:i<on?col:'#151a14'});}
   return o;};
  const side=(k,x,f,labels,val,unit,lab)=>{let o=lcd(x,70,336,350);
   o+=fan(x+46,396,200,290,f,26,[[0,GN],[.6,'#e8e03a'],[.85,'#ff7a1a']]);
   labels.forEach((v,i)=>{const t=i/5;o+=H.text(x+46+200*Math.pow(t,1.6)*.92-10,396-290*t-6,v,{size:13,fill:AL,anchor:'end',base:'central'});});
   o+=H.text(x+320,96,lab,{size:14,fill:AL,anchor:'end',base:'central'});
   o+=H.seg(x+320,320,val,54,{fill:AM,dim:DM,anchor:'end'});
   o+=H.text(x+320,396,unit,{size:13,fill:AL,anchor:'end',base:'central'});
   return H.cl('gauge',k,o);};
  s+=side('rate',64,H.frac.rate(d),H.rateScale(d,5),H.fmt.m(d.rate),'M tokens/시간','토큰 속도');
  s+=side('burn',880,H.frac.burn(d),H.burnScale(d,5),H.fmt.burn(d.burn),'%/시간','소진 속도');
  // 가운데 칸
  s+=lcd(420,70,440,350);
  const box=(x,y,w,h,lab,val,unit)=>H.rect(x,y,w,h,{r:4,stroke:AL,sw:1.5,op:.9})+H.text(x+12,y+16,lab,{size:13,fill:AL,anchor:'start',base:'central'})+H.text(x+12,y+h-15,unit,{size:13,fill:AL,anchor:'start',base:'central'})+H.seg(x+w-12,y+h-48,val,36,{fill:AM,dim:DM,anchor:'end'});
  s+=box(442,88,154,84,'소진 속도',H.fmt.burn(d.burn),'%/시간');
  s+=H.cl('gauge','heat',box(684,88,154,84,'엔진 온도',String(Math.round(d.heat)),'도'));
  // 원본의 초록 사각 표시: 응답 대기
  { const on=d.lamps.waiting>0;s+=H.cl('alert','waiting',H.rect(610,98,60,64,{r:3,fill:on?'#22c84a':'#0c2410'})+H.g(O.ICONS.waiting(on?'#04210c':'#1d4a26',28),{t:'translate(626 108)'})+H.text(640,150,on?String(d.lamps.waiting):'0',{size:13,fill:on?'#04210c':'#1d4a26',weight:700,base:'central'})); }
  // 둘째 줄: 작업 가능 | 남은 한도
  s+=H.rect(442,186,396,62,{r:4,stroke:AL,sw:1.5,op:.9})+H.line(640,194,640,240,{stroke:AL,op:.5});
  s+=H.text(454,202,'작업 가능',{size:13,fill:AL,anchor:'start',base:'central'})+H.text(454,232,'시간',{size:13,fill:AL,anchor:'start',base:'central'})+H.seg(626,200,d.rangeH==null||!isFinite(d.rangeH)?'--':String(Math.round(d.rangeH)),34,{fill:AM,dim:DM,anchor:'end'});
  s+=H.cl('gauge','fuel',H.text(652,202,'남은 한도',{size:13,fill:AL,anchor:'start',base:'central'})+H.text(652,232,'%',{size:13,fill:AL,anchor:'start',base:'central'})+H.seg(826,200,String(Math.round(d.minLeft)),34,{fill:AM,dim:DM,anchor:'end'}));
  // 셋째 줄: 누적 토큰
  s+=H.text(454,272,'누적 M',{size:13,fill:AL,anchor:'start',base:'central'})+trip(H,454,292,d,{fill:AL,anchor:'start'})+H.seg(826,266,H.fmt.odo(d.odo),30,{fill:AM,dim:DM,anchor:'end',skew:0});
  // 기어와 나머지 경고등
  s+=gears(H,640,330,d,{gap:52,size:15,on:AM,off:'#6a5226',width:400});
  [1,2,3].forEach((i,k)=>{s+=lamp(H,i,584+k*56,380,d,20,'#2a2b2d');});
  s+=H.brand(640,436,{fill:'#5a5a5a',size:11});
  return s;}});

 // 11 · Lexus LFA — 은빛 링을 두른 큰 원 하나, 가운데 큰 숫자와 기어, 양옆 휘어진 보조 막대
 O.theme({id:'11',name:'소닉 링',about:'두꺼운 은빛 링 안의 남색 원에 큰 숫자와 기어를 넣고, 양옆 휘어진 띠에 보조 값을 그렸습니다.',draw(H,d){
  const cx=640,cy=240,BL='#86c1ee',TX='#e6eef6',DIM='#8aa0b4',RED='#ff4a22';
  let s=H.rect(0,0,1280,480,{fill:H.rad2('vg',[[0,'#0a1424'],[.65,'#02050a'],[1,'#000']],{r:.75})});
  // 양옆 휘어진 띠 넷
  const RS=284,BW=12;
  const seg=(a0,a1,f,rev)=>{const sp=a1-a0,k=H.clamp(f);let o=H.arc(cx,cy,RS,a0,a1,{stroke:'#1a2532',sw:BW});
   o+=rev?H.arc(cx,cy,RS,a1-sp*k,a1,{stroke:BL,sw:BW}):H.arc(cx,cy,RS,a0,a0+sp*k,{stroke:BL,sw:BW});
   o+=H.ticks(cx,cy,RS+18,{a0,sweep:sp,n:4,minor:1,len:7,mlen:4,w:2,mw:1.2,color:'#c9d6e2',mcolor:'#6c8196'});return o;};
  const segHeat=seg(-84,-50,H.frac.heat(d)),segFuel=seg(-130,-96,H.frac.min(d)),segBurn=seg(50,84,H.frac.burn(d),true);
  s+=seg(96,130,H.frac.cpu(d),true);
  // 양옆 글자: 왼쪽은 오른쪽 맞춤 x=322, 오른쪽은 왼쪽 맞춤 x=958
  const col=(x,anc,y,lab,val)=>H.text(x,y,lab,{size:13,fill:DIM,anchor:anc,base:'central'})+H.text(x,y+26,val,{size:24,fill:TX,anchor:anc,font:'helv',base:'central'});
  s+=H.cl('gauge','heat',segHeat+col(322,'end',104,'엔진 온도',Math.round(d.heat)+'°'))+H.cl('gauge','fuel',segFuel+col(322,'end',350,'남은 한도',Math.round(d.minLeft)+'%'));
  s+=H.cl('gauge','burn',segBurn+col(958,'start',104,'소진 %/시간',H.fmt.burn(d.burn)))+col(958,'start',350,'CPU',Math.round(d.cpu)+'%');
  // 바깥 온도 자리: 작업 가능 시간(모르면 '—')
  s+=H.text(322,214,'작업 가능',{size:13,fill:DIM,anchor:'end',base:'central'})+H.text(322,240,H.fmt.hours(d.rangeH),{size:26,fill:TX,anchor:'end',font:'helv',base:'central'})+H.text(958,240,d.clock,{size:26,fill:TX,anchor:'start',font:'helv',base:'central'});
  s+=lampsAt(H,322-9-1.5*34,446,d,{size:18,gap:34,off:'#26313c'});
  s+=H.brand(958,446,{fill:'#5a6a7a',anchor:'start',size:11});
  // 은빛 링
  s+=H.circle(cx,cy+3,212,{fill:'#000',op:.6,filter:H.shadow('rs',3,8,.8)});
  s+=H.chrome(cx,cy,210,24,{stops:[[0,'#f3f6f8'],[.3,'#7d8790'],[.55,'#e6ebef'],[.8,'#4a535b'],[1,'#c6ced4']]});
  s+=H.circle(cx,cy,209.5,{stroke:'#fff',sw:1,op:.25})+H.circle(cx,cy,186.5,{stroke:'#000',sw:1.5,op:.7});
  [30,60,120,150,210,240,300,330].forEach(a=>{const [x1,y1]=H.pt(cx,cy,216,a),[x2,y2]=H.pt(cx,cy,228,a);s+=H.line(x1,y1,x2,y2,{stroke:'#d6dde3',sw:4});});
  let rg=H.face(cx,cy,186,{fill:'#1f3654',center:'#3b5d86',edge:'#0a1422'});
  const tR=180;
  rg+=H.band(cx,cy,tR-14,tR,-150+300*.85,150,{fill:'#e0301e'});
  rg+=H.ticks(cx,cy,tR,{a0:-150,sweep:300,n:10,minor:4,len:12,mlen:6,w:2.5,color:'#fff',mcolor:'#a8bbd0'});
  // 눈금 숫자(M 단위): '1000'처럼 넓어지면 큰 눈금 안쪽 끝에서 떨어지도록 숫자 고리를 안쪽으로 옮깁니다
  rg+=ringNums(H,cx,cy,146,H.rateScale(d,10),H.labels.rate,{a0:-150,sweep:300,size:22,fill:'#fff',font:'helv'});
  rg+=H.text(cx,cy-50,H.fmt.m(d.rate),{size:54,fill:'#fff',font:'helv',weight:500,base:'central'});
  rg+=H.text(cx,cy-16,'M tokens/시간',{size:13,fill:'#c8d6e4',base:'central'});
  rg+=H.needle(cx,cy,tR,-150+300*H.frac.rate(d),{style:'taper',w:8,color:RED,tail:-106,shadow:false});
  s+=H.cl('gauge','rate',rg);
  s+=H.line(cx-54,cy,cx+54,cy,{stroke:'#c8d6e4',sw:1,op:.5});
  // 기간 기어: 현재 기어만 크게, 나머지는 같은 줄에 작게. 줄 폭은 옆 눈금 숫자에 닿지 않게 ±135 안에 둡니다
  { const n=d.gears.length,ci=Math.max(0,d.gears.indexOf(d.period)),cw=76,q=n>1?Math.min(44,(270-cw)/(n-1)):0;
   const fs=Math.min(15,Math.max(13,(q-8)/(Math.max(...d.gears.map(g=>g.length))*.6)));
   const x0=cx-(cw+(n-1)*q)/2;
   d.gears.forEach((g,i)=>{const on=i===ci,x=i<ci?x0+q*(i+.5):i===ci?x0+q*ci+cw/2:x0+q*(i-1)+cw+q/2;
    s+=H.cl('period',g,on?H.text(x,cy+30,g,{size:38,fill:'#fff',font:'helv',weight:600,base:'central'}):H.text(x,cy+32,g,{size:fs,fill:'#6f88a3',font:'helv',base:'central'}));}); }
  s+=H.cl('trip','',H.text(cx,cy+76,'트립 '+H.fmt.trip(d.trip)+'M',{size:14,fill:TX,base:'central'}));
  s+=H.text(cx,cy+96,'누적 '+H.fmt.comma(d.odo/1e6)+'M',{size:13,fill:'#c8d6e4',base:'central'});
  return s;}});

 // 12 · Nissan Skyline GT-R R34 NISMO — 회색 다이얼 큰 둘(주황 숫자), 양끝 작은 온도·연료
 O.theme({id:'12',name:'레드라인',about:'짙은 회색 다이얼에 주황 숫자와 빨강 바늘, 양끝 작은 온도·연료 계기를 두었습니다.',draw(H,d){
  const OR='#ff9a3a',ND='#ff3a1a',LB='#d8d4cc',DIM='#9a958c';
  let s=H.rect(0,0,1280,480,{fill:'#060708'});
  s+=H.housing('M40 470 C56 170 290 46 640 46 C990 46 1224 170 1240 470Z',{top:'#202328',bottom:'#08090b',rim:.08});
  const face=(cx,cy,r)=>H.face(cx,cy,r,{fill:'#2b2e33',center:'#36393f',edge:'#18191c'});
  const big=(k,cx,labels,f,lab,val,unit,red,win)=>{const cy=226,r=158;
   const wt=H.text(cx,cy+120.5,win,{size:15,fill:'#111',font:'helv',weight:500,base:'central',ls:1});
   return H.cl('gauge',k,H.bezel(cx,cy,r,10,{tone:'black'})+face(cx,cy,r)+dial(H,{cx,cy,r,labels,f,tick:OR,num:OR,numSize:26,font:'helv',red,redColor:ND,needle:ND,nw:6,len:15,mlen:8,cap:16,
    extra:stack(H,cx,cy+44,{label:lab,value:val,unit,vs:26,vc:OR,lc:LB,uc:DIM})+H.rect(cx-46,cy+108,92,24,{r:3,fill:'#c8ccc0'})+(k==='rate'?H.cl('trip','',wt):wt)}));};
  s+=big('rate',470,R6(H,d),H.frac.rate(d),'토큰 속도',H.fmt.m(d.rate),'M tokens/시간',.8,'트립 '+H.fmt.trip(d.trip));
  s+=big('burn',810,B6(H,d),H.frac.burn(d),'소진 속도',H.fmt.burn(d.burn),'%/시간',.8,H.fmt.odo(d.odo,6));
  // 양끝 작은 계기: 축은 안쪽, 눈금 호는 바깥쪽
  const sideG=(k,cx,f,top,bot,lab,pivotRight)=>{const cy=300,r=78,px=pivotRight?cx+24:cx-24;
   const a0=pivotRight?-130:50,sw=80;
   let o=H.bezel(cx,cy,r,10,{tone:'black'})+face(cx,cy,r);
   o+=H.ticks(px,cy,66,{a0,sweep:sw,n:2,minor:1,len:10,mlen:5,w:2.4,mw:1.4,color:OR});
   const [tx,ty]=H.pt(px,cy,62,pivotRight?-38:38),[bx,by]=H.pt(px,cy,62,pivotRight?-142:142);
   o+=H.text(tx,ty,top,{size:16,fill:pivotRight?ND:OR,font:'helv',base:'central'})+H.text(bx,by,bot,{size:16,fill:OR,font:'helv',base:'central'});
   o+=H.text(px,cy+34,lab,{size:13,fill:LB,base:'central'});
   const ang=pivotRight?-130+sw*H.clamp(f):130-sw*H.clamp(f);
   o+=H.needle(px,cy,66,ang,{style:'taper',w:5,color:ND,tail:0})+H.hub(px,cy,8);
   return H.cl('gauge',k,o);};
  s+=sideG('heat',178,H.frac.heat(d),'H','C','엔진 온도',true);
  s+=sideG('fuel',1102,H.frac.min(d),'F','E','남은 한도',false);
  // 아래 한 줄: 기어(왼쪽 원 축)·1top(가운데)·경고등(오른쪽 원 축)
  s+=gears(H,470,428,d,{gap:40,size:14,on:OR,off:'#7c776e',width:260});
  s+=H.brand(640,432,{fill:'#6a655c',size:11});
  s+=lampsAt(H,810,428,d,{size:18,gap:40,off:'#3a3c40'});
  return s;}});

 // 13 · Honda S2000 — 반원 하우징 위로 휘어 도는 주황 막대, 가운데 빨간 액정, 오른쪽 작은 호 막대 둘, 아래 표시 띠
 O.theme({id:'13',name:'레드존 바',about:'반원 위를 따라 휘어 도는 주황 막대와 빨간 액정 속 큰 숫자, 오른쪽 작은 호 막대 둘을 옮겼습니다.',draw(H,d){
  const OR='#ff8a1a',RD='#ff2a1a',OFF='#2a1a10',TX='#ececec',DIM='#a8a8a8';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#26282b'],[1,'#0f1011']])});
  s+=H.housing('M70 396 C70 150 330 44 640 44 C950 44 1210 150 1210 396Z',{top:'#141516',bottom:'#08090a',rim:.12});
  s+=H.housing('M100 404 H1180 Q1200 404 1200 424 V440 Q1200 460 1180 460 H100 Q80 460 80 440 V424 Q80 404 100 404Z',{top:'#1e1f21',bottom:'#0e0f10',rim:.1});
  s+=H.rect(120,414,1040,36,{r:6,fill:'#060606',stroke:'#2a2b2d'});
  // 휘어 도는 막대: 타원 중심 (640, 410)
  const E={cx:640,cy:410,rx:500,ry:320,w:46,t0:-78,t1:26};
  const ep=(t,dr)=>{const a=t*Math.PI/180;return [H.r2(E.cx+(E.rx-dr)*Math.sin(a)),H.r2(E.cy-(E.ry-dr)*Math.cos(a))];};
  const n=54,on=Math.round(H.frac.rate(d)*n);let rg='';
  for(let i=0;i<n;i++){const ta=E.t0+(E.t1-E.t0)*i/n,tb=E.t0+(E.t1-E.t0)*(i+.72)/n;
   const [ax,ay]=ep(ta,0),[bx,by]=ep(tb,0),[cx2,cy2]=ep(tb,E.w),[dx,dy]=ep(ta,E.w);
   const col=i/n>=.8?RD:OR;
   rg+=H.path(`M${ax} ${ay}L${bx} ${by}L${cx2} ${cy2}L${dx} ${dy}Z`,{fill:i<on?col:OFF});}
  H.rateScale(d,10).forEach((v,i)=>{const t=E.t0+(E.t1-E.t0)*i/10;const [x,y]=ep(t,E.w+22);
   rg+=H.text(x,y,v,{size:18,fill:i>=8?RD:TX,font:'helv',weight:500,base:'central'});});
  // 가운데 빨간 액정
  s+=H.rect(486,206,300,108,{r:8,fill:'#2a0505',stroke:'#4a0e0e',sw:2});
  s+=H.brand(502,222,{fill:'#a8402c',size:11,anchor:'start'});
  rg+=H.seg(708,224,H.fmt.m(d.rate),64,{fill:RD,dim:'#3d0a0a',anchor:'end',skew:-4});
  rg+=H.text(720,264,'M tokens',{size:13,fill:'#ff5a3a',anchor:'start',base:'central'})+H.text(720,282,'/시간',{size:13,fill:'#ff5a3a',anchor:'start',base:'central'});
  s+=H.cl('gauge','rate',rg);
  s+=H.rect(486,324,300,44,{r:6,fill:'#2a0505',stroke:'#4a0e0e',sw:2});
  s+=H.cl('gauge','burn',H.text(502,346,'소진 속도',{size:13,fill:'#ff5a3a',anchor:'start',base:'central'})+H.seg(708,333,H.fmt.burn(d.burn),26,{fill:RD,dim:'#3d0a0a',anchor:'end',skew:-4})+H.text(720,346,'%/시간',{size:13,fill:'#ff5a3a',anchor:'start',base:'central'}));
  // 오른쪽 작은 호 막대 둘
  const mini=(k,cx,cy,f,l0,l1,lab,val)=>{let o=H.arcBars(cx,cy,60,f,{a0:-90,sweep:180,n:16,w:16,colors:[[0,OR],[.8,RD]],off:OFF});
   o+=H.text(cx-52,cy+16,l0,{size:14,fill:TX,font:'helv',base:'central'})+H.text(cx+52,cy+16,l1,{size:14,fill:RD,font:'helv',base:'central'});
   o+=H.text(cx,cy-16,val,{size:20,fill:TX,font:'helv',base:'central'})+H.text(cx,cy+16,lab,{size:13,fill:DIM,base:'central'});return H.cl('gauge',k,o);};
  s+=mini('heat',1010,232,H.frac.heat(d),'C','H','엔진 온도',Math.round(d.heat)+'°');
  s+=mini('fuel',1010,340,H.frac.min(d),'E','F','남은 한도',Math.round(d.minLeft)+'%');
  // 아래 표시 띠: 기어(왼쪽)·트립(가운데)·경고등(오른쪽)
  s+=gears(H,380,432,d,{gap:44,size:14,on:RD,off:'#7a7a7a',width:380});
  s+=trip(H,640,432,d,{fill:DIM});
  s+=lampsAt(H,900,432,d,{size:18,gap:48,off:'#3a3b3d'});
  return s;}});

 // 14 · Porsche 911 클래식 — 다섯 원이 사슬처럼 겹침: 가운데 회전계가 맨 앞, 옆 원은 그 뒤, 바깥 원은 다시 그 뒤
 O.theme({id:'14',name:'클래식 다섯 원',about:'두꺼운 검은 테와 가는 크롬 선의 다섯 원을 사슬처럼 겹쳐 세우고, 가운데 큰 회전계에 주황 바늘을 썼습니다.',draw(H,d){
  const OR='#ff8a1a',W='#f4f4f0',LB='#c4c4c0',F='din';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1d1d1e'],[1,'#070707']])});
  s+=H.housing('M24 128 Q640 -20 1256 128 L1256 420 Q640 480 24 420Z',{top:'#171718',bottom:'#0a0a0a',rim:.06});
  const CY=232,BZ=16,CH=2,OV=14;
  H.def(`<filter id="${H.id('cast')}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter>`);
  // 반지름(다이얼면)과 바깥 반지름(검은 테 포함)
  const rc=142,rn=112,ro=84,out=r=>r+CH+BZ;
  const xn=out(rc)+out(rn)-OV,xo=xn+out(rn)+out(ro)-OV;
  const P={c:[640,rc],nl:[640-xn,rn],nr:[640+xn,rn],ol:[640-xo,ro],or:[640+xo,ro]};
  // 원 하나: 앞 원의 그림자 → 검은 테 → 가는 크롬 선 → 다이얼면
  const cup=(cx,r)=>{const R=out(r);
   return H.circle(cx,CY+4,R+2,{fill:'#000',op:.85,filter:H.url('cast')})+
    H.circle(cx,CY,R,{fill:H.lin('cup'+cx,[[0,'#3c3d3f'],[.18,'#1b1c1d'],[1,'#070707']])})+H.circle(cx,CY,R-.5,{stroke:'#fff',sw:1,op:.1})+
    H.circle(cx,CY,r+CH/2,{stroke:H.lin('chl'+cx,H.tones.chrome),sw:CH})+H.face(cx,CY,r,{fill:'#101011',center:'#141415',edge:'#050505'});};
  const g=(k,labels,f,o={})=>{const [cx,r]=P[k];const ns=o.ns||Math.round(r*.17);
   return cup(cx,r)+dial(H,{cx,cy:CY,r,labels,f,tick:W,num:W,numSize:ns,font:F,minor:o.minor??4,len:Math.round(r*.1),mlen:Math.round(r*.05),tw:o.tw??2.6,red:o.red,redColor:OR,redBand:o.band,redBandColor:OR,needle:OR,nw:o.nw||Math.max(4,Math.round(r*.045)),nstyle:'bar',cap:Math.round(r*.1),extra:o.extra});};
  // 바깥 원 둘(맨 뒤) → 옆 원 둘 → 가운데(맨 앞)
  s+=H.cl('gauge','heat',g('ol',['C','','','','H'],H.frac.heat(d),{minor:1,red:.99,extra:stack(H,P.ol[0],CY+42,{label:'엔진 온도',value:Math.round(d.heat)+'°',vs:18,vf:F,lc:LB})}));
  s+=g('or',['0','25','50','75','100'],H.frac.cpu(d),{minor:1,red:.99,ns:14,extra:stack(H,P.or[0],CY+42,{label:'CPU',value:Math.round(d.cpu)+'%',vs:18,vf:F,lc:LB})});
  s+=H.cl('gauge','fuel',g('nl',['E','¼','½','¾','F'],H.frac.min(d),{minor:1,extra:stack(H,P.nl[0],CY+40,{label:'남은 한도',value:Math.round(d.minLeft)+'%',vs:22,vf:F,lc:LB})}));
  s+=H.cl('gauge','burn',g('nr',B6(H,d),H.frac.burn(d),{red:.8,extra:stack(H,P.nr[0],CY+40,{label:'소진 속도',value:H.fmt.burn(d.burn),unit:'%/시간',vs:22,vf:F,lc:LB})}));
  s+=H.cl('gauge','rate',g('c',R6(H,d),H.frac.rate(d),{ns:26,band:.85,extra:stack(H,640,CY+44,{label:'토큰 속도',value:H.fmt.m(d.rate),unit:'M tokens/시간',vs:30,vf:F,lc:LB})+H.cl('trip','',H.text(640,CY+112,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:LB,base:'central'}))+H.brand(640,CY+132,{fill:'#77776f',size:11})}));
  // 경고등: 원 사이 아래 홈 네 곳, 같은 기준선
  const notch=(a,b)=>{const [x1,r1]=P[a],[x2,r2]=P[b],R1=out(r1),R2=out(r2),dd=x2-x1;return x1+(R1*R1-R2*R2+dd*dd)/(2*dd);};
  const LY=334;
  [['ol','nl'],['nl','c'],['c','nr'],['nr','or']].forEach(([a,b],i)=>{const x=notch(a,b);s+=lamp(H,i,x,LY,d,18,'#3a3a3a',H.circle(x,LY,15,{fill:'#050505',stroke:'#2a2a2a'}));});
  s+=gears(H,640,432,d,{gap:42,size:14,on:OR,off:'#707070',font:F,width:300});
  return s;}});

 // 15 · Mercedes-Benz W123 — 둥근 사각 하우징, 왼쪽 겸용 계기, 가운데 노란 안쪽 눈금, 오른쪽 시계형, 아래 표시등 띠
 O.theme({id:'15',name:'세 구획 클래식',about:'둥근 사각 하우징에 세 구획 계기를 두고, 왼쪽 겸용 계기·가운데 노란 눈금·오른쪽 시계형 계기와 아래 표시등 띠를 옮겼습니다.',draw(H,d){
  const YE='#f0b830',W='#eeeeea',LB='#bdbdb8';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1c1b19'],[1,'#0a0a09']])});
  s+=H.housing('M96 52 Q640 30 1184 52 Q1226 54 1226 96 L1220 400 Q1218 452 1170 452 L110 452 Q62 452 60 400 L54 96 Q54 54 96 52Z',{top:'#1a1a1a',bottom:'#060606',rim:.12});
  s+=H.path('M110 66 Q640 48 1170 66 Q1204 68 1204 100 L1200 372 Q1198 390 1180 390 L100 390 Q82 390 80 372 L76 100 Q76 68 110 66Z',{fill:H.lin('pl',[[0,'#020202'],[.25,'#0d0d0d'],[1,'#111']])});
  const cup=(cx,cy,r)=>H.bezel(cx,cy,r,10,{tone:'black'})+H.face(cx,cy,r,{fill:'#0c0c0c',center:'#111',edge:'#040404'});
  const silver={capFill:'#8c8c8c',capLight:'#f2f2f2'};
  // 왼쪽 겸용: 연료(위)·엔진 온도(왼아래)·CPU(오른아래)
  const LX=300,CY=222,LR=134;
  s+=cup(LX,CY,LR);
  const sub=(a0,sw,f,l0,l1,lab,lp)=>{let o=H.arc(LX,CY,74,a0,a0+sw,{stroke:W,sw:2})+H.ticks(LX,CY,75,{a0,sweep:sw,n:2,minor:1,len:9,mlen:5,w:2.4,mw:1.4,color:W});
   const [x0,y0]=H.pt(LX,CY,90,a0),[x1,y1]=H.pt(LX,CY,90,a0+sw),[xl,yl,an]=lp;
   o+=H.text(x0,y0,l0,{size:13,fill:W,font:'helv',base:'central'})+H.text(x1,y1,l1,{size:13,fill:W,font:'helv',base:'central'})+H.text(xl,yl,lab,{size:13,fill:LB,anchor:an,base:'central'});
   o+=H.needle(LX,CY,74,a0+sw*H.clamp(f),{style:'bar',w:4,color:YE,tail:0});return o;};
  s+=H.cl('gauge','fuel',sub(-45,90,H.frac.min(d),'E','F','남은 한도',[LX,CY-108,'middle']));
  s+=H.cl('gauge','heat',sub(-150,50,H.frac.heat(d),'C','H','엔진 온도',[LX-8,CY+106,'end']));
  s+=sub(100,50,H.frac.cpu(d),'0','100','CPU',[LX+8,CY+106,'start']);
  s+=H.hub(LX,CY,13,{fill:'#8c8c8c',light:'#f2f2f2'});
  // 가운데: 토큰 속도. 노란 안쪽 눈금은 숫자 폭에 따라 옮겨지는 흰 눈금 고리를 따라갑니다
  const CX=640,CR=150;
  { const rc={cx:CX,cy:CY,r:CR,a0:-135,sweep:270,labels:R6(H,d),numSize:22},g=104+dialGeom(rc).tickR-dialGeom({...rc,labels:H.labels.rate2}).tickR;
   s+=H.cl('gauge','rate',cup(CX,CY,CR)+dial(H,{...rc,f:H.frac.rate(d),tick:W,num:W,font:'helv',needle:YE,nw:6,nstyle:'bar',cap:14,len:14,mlen:7,...silver,
    extra:H.ticks(CX,CY,g-20,{a0:-135,sweep:270,n:20,minor:0,len:7,w:1.6,color:YE})+stack(H,CX,CY+44,{label:'토큰 속도',value:H.fmt.m(d.rate),unit:'M tokens/시간',vs:26,vc:YE,lc:LB})+H.odo(CX-45,CY+108,H.fmt.odo(d.odo,6),{cw:15,ch:20,bg:'#151515',fg:W,font:'helv'})})); }
  // 오른쪽: 시계처럼 둘러선 소진 속도 (6시 자리에 이름)
  const RX=980;
  s+=H.cl('gauge','burn',cup(RX,CY,LR)+dial(H,{cx:RX,cy:CY,r:LR,a0:-150,sweep:300,labels:B10(H,d),f:H.frac.burn(d),tick:W,num:W,numSize:18,font:'helv',minor:4,len:11,mlen:5,needle:YE,nw:5,nstyle:'bar',cap:12,...silver,
   extra:stack(H,RX,CY+56,{label:'소진 %/시간',value:H.fmt.burn(d.burn),vs:20,vc:YE,lc:LB})}));
  // 아래 표시등 띠: 경고등(왼쪽 원 축)·기어(가운데 축)·1top(오른쪽 원 축)
  s+=H.rect(96,400,1088,40,{r:5,fill:'#040404',stroke:'#3a3a38'})+H.line(100,401,1180,401,{stroke:'#fff',op:.12});
  s+=lampsAt(H,LX,420,d,{size:20,gap:48,off:'#3a3a3a'});
  s+=gears(H,CX,420,d,{gap:46,size:14,on:YE,off:'#6a6a66',width:400});
  s+=trip(H,RX,420,d,{fill:LB});
  s+=H.brand(1168,424,{fill:'#77776f',size:11,anchor:'end'});
  return s;}});

 // 16 · BMW M3 E30 — 각진 후드 안 회색 판, 검은 큰 원 둘, 양끝 낮은 작은 원, 아래 세 칸 표시 띠
 O.theme({id:'16',name:'클래식 투 다이얼',about:'각진 후드 안 회색 판에 큰 원 둘과 양끝 작은 원을 두고, 아래 세 칸 표시 띠와 주황 바늘을 살렸습니다.',draw(H,d){
  const W='#f2f2ee',AC='#ff4a1a',LB='#c4c4c0',DIM='#8c8c88';
  let s=H.rect(0,0,1280,480,{fill:'#050505'});
  s+=H.housing('M180 26 L1100 26 Q1130 26 1142 54 L1262 444 Q1268 472 1238 472 L42 472 Q12 472 18 444 L138 54 Q150 26 180 26Z',{top:'#18191a',bottom:'#0b0b0c',rim:.08});
  // 회색 판(움푹 들어간 면): 위가 어둡고 아래로 밝아짐
  s+=H.path('M222 50 L1058 50 Q1080 50 1088 72 L1218 438 Q1224 456 1204 456 L76 456 Q56 456 62 438 L192 72 Q200 50 222 50Z',{fill:H.lin('pn',[[0,'#1d1f22'],[.25,'#2b2d31'],[1,'#33363a']])});
  const face=(cx,cy,r)=>H.bezel(cx,cy,r,8,{tone:'black'})+H.face(cx,cy,r,{fill:'#0f1011',center:'#141516',edge:'#060607'});
  const BY=222;
  const big=(k,cx,labels,f,lab,val,unit,red,extra)=>H.cl('gauge',k,face(cx,BY,146)+dial(H,{cx,cy:BY,r:146,a0:-135,sweep:270,labels,f,tick:W,num:W,numSize:22,font:'helv',weight:500,minor:4,len:14,mlen:7,tw:2.6,red,redColor:AC,redBand:red,redBandColor:AC,needle:AC,nw:6,nstyle:'taper',cap:14,
   extra:stack(H,cx,BY+44,{label:lab,value:val,unit,vs:26,vc:W,lc:LB,uc:DIM})+(extra||'')}));
  s+=big('rate',470,R6(H,d),H.frac.rate(d),'토큰 속도',H.fmt.m(d.rate),'M tokens/시간',null,H.odo(470-42,BY+110,H.fmt.odo(d.odo,6),{cw:14,ch:18,bg:'#0a0a0a',fg:W,font:'helv'}));
  s+=big('burn',810,B10(H,d),H.frac.burn(d),'소진 속도',H.fmt.burn(d.burn),'%/시간',.8);
  // 양끝 작은 원: 판 높이 아래쪽, 큰 원과 같은 밑선 근처
  const small=(k,cx,f,l0,l1,lab,hot)=>{const cy=290,r=70;
   return H.cl('gauge',k,face(cx,cy,r)+dial(H,{cx,cy,r,a0:-60,sweep:120,labels:[l0,'',l1],f,tick:W,num:W,numSize:15,font:'helv',minor:1,len:9,mlen:5,tw:2.2,red:hot?.99:null,redColor:AC,needle:AC,nw:4,cap:8,
    extra:H.text(cx,cy+30,lab,{size:13,fill:LB,base:'central'})}));};
  s+=small('fuel',222,H.frac.min(d),'E','F','남은 한도');
  s+=small('heat',1058,H.frac.heat(d),'C','H','엔진 온도',true);
  s+=H.brand(640,96,{fill:'#77776f',size:11})+trip(H,640,118,d,{fill:LB});
  // 아래 표시 띠: 세 칸 유리창. 왼쪽 기어, 가운데 작업 가능 표시등, 오른쪽 경고등
  const SY=396,SH=48,MY=SY+SH/2;
  s+=H.rect(104,SY-6,1072,SH+12,{r:6,fill:'#141516'});
  const cell=(x,w)=>H.rect(x,SY,w,SH,{r:4,fill:H.lin('cl'+x,[[0,'#050606'],[1,'#0b0d0c']])})+H.rect(x,SY,w,SH,{r:4,stroke:'#fff',sw:1,op:.07});
  s+=cell(116,404)+cell(530,220)+cell(760,404);
  s+=gears(H,318,MY,d,{gap:52,size:14,on:'#ffffff',off:'#6f726f',width:380});
  { const nL=8,lit=Math.round(H.frac.min(d)*nL);s+=H.text(546,MY,'작업 가능',{size:13,fill:LB,anchor:'start',base:'central'});
   for(let i=0;i<nL;i++){const col='#5fd86a';s+=H.rect(612+i*10,MY-4,7,8,{r:1.5,fill:i<lit?col:'#1f2420'});}
   s+=H.text(744,MY,H.fmt.hours(d.rangeH),{size:13,fill:W,anchor:'end',base:'central'}); }
  for(let i=0;i<4;i++)s+=lamp(H,i,842+i*80,MY,d,20,'#3b3e3c');
  return s;}});

 // 17 · Ferrari F40 — 검은 펠트 패널, 가운데 큰 원 둘, 양옆 작은 원 넷, 흰 숫자와 흰 바늘
 O.theme({id:'17',name:'펠트 레이서',about:'장식 없는 검은 펠트 패널에 큰 원 둘과 작은 원 넷, 흰 숫자와 흰 바늘을 그대로 옮겼습니다.',draw(H,d){
  const W='#f4f4f2',LB='#c2c2c0',RD='#e8301a';
  let s=H.rect(0,0,1280,480,{fill:'#111'});
  H.def(`<filter id="${H.id('felt')}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .07 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>`);
  const hood='M60 470 C70 150 300 30 640 30 C980 30 1210 150 1220 470Z';
  s+=H.housing(hood,{top:'#101010',bottom:'#070707',rim:.06})+H.path(hood,{fill:'#000',filter:H.url('felt')});
  const rim=(cx,cy,r)=>H.bezel(cx,cy,r,16,{tone:'black'})+H.circle(cx,cy,r+1,{stroke:'#6a6a6a',sw:1.5})+H.face(cx,cy,r,{fill:'#0d0d0d',center:'#131313',edge:'#040404'});
  const BY=214;
  const big=(k,cx,labels,f,lab,val,unit,red)=>H.cl('gauge',k,rim(cx,BY,140)+dial(H,{cx,cy:BY,r:140,a0:-140,sweep:280,labels,f,tick:W,num:W,numSize:22,font:'helv',minor:4,len:13,mlen:6,tw:2.2,red,redColor:RD,needle:W,nw:4,nstyle:'line',cap:13,
   extra:stack(H,cx,BY+42,{label:lab,value:val,unit,vs:24,vc:W,lc:LB})}));
  s+=big('rate',486,R6(H,d),H.frac.rate(d),'토큰 속도',H.fmt.m(d.rate),'M tokens/시간',.85);
  s+=big('burn',794,B6(H,d),H.frac.burn(d),'소진 속도',H.fmt.burn(d.burn),'%/시간',.8);
  const small=(cx,cy,f,labels,lab,k)=>(k?(x=>H.cl('gauge',k,x)):(x=>x))(rim(cx,cy,62)+dial(H,{cx,cy,r:62,a0:-120,sweep:240,labels,f,tick:W,num:W,numSize:14,font:'helv',minor:1,len:7,mlen:4,tw:1.8,needle:W,nw:2.5,nstyle:'line',cap:6,
   extra:H.text(cx,cy+34,lab,{size:13,fill:LB,base:'central'})}));
  s+=small(258,206,H.frac.min(d),['E','','½','','F'],'남은 한도','fuel');
  s+=small(1022,206,H.frac.heat(d),['0','','50','','100'],'엔진 온도','heat');
  s+=small(270,356,H.frac.cpu(d),['0','','50','','100'],'CPU');
  s+=small(1010,356,H.frac.mem(d),['0','','50','','100'],'메모리');
  // 두 큰 원이 만나는 축: 위에 1top, 아래에 경고등·기어
  s+=H.brand(640,74,{fill:'#7a7a78',size:11})+trip(H,640,98,d,{fill:LB});
  s+=lampsAt(H,640,394,d,{size:18,gap:44,off:'#333'});
  s+=gears(H,640,436,d,{gap:42,size:14,on:'#fff',off:'#6a6a6a',width:320});
  return s;}});
})(window.OneTop);
