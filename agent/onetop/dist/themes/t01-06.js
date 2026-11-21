/* 01–06 (v4.1.0)
   공통 규칙: 바늘은 아래 약 100°를 비우고 돌며, 꼬리는 허브 안에 숨깁니다.
   바늘 끝은 눈금 안쪽 끝까지 닿고, 눈금 숫자는 바늘 끝 바깥 고리에 둡니다.
   읽음 숫자·계기 이름·단위는 바늘이 가지 않는 아래쪽 구역에 둡니다.
   글자 단계: 주 값 → 보조 값(주 값의 절반 정도) → 라벨·단위 13–14px → 기어 13–15px.
   글꼴은 테마마다 두 가지(숫자용 하나, 정보용 하나)입니다.
   v4.1.0: 눈금 숫자는 d.rateMax·d.burnMax에서 만들고, 숫자가 넓어지면 눈금 고리를 안쪽으로 옮깁니다.
   경고등·기어·트립·계기 묶음에 H.cl 표시를 붙이고, 기어는 d.gears를 따릅니다. */
(function(O){
 'use strict';
 // 눈금 숫자 한 개가 반지름 방향으로 차지하는 반폭(글자 상자를 그 각도로 본 폭의 절반)
 const spAt=(t,a,sz,cw=.58)=>{const ra=a*Math.PI/180;return String(t).length*sz*cw/2*Math.abs(Math.sin(ra))+sz*.74/2*Math.abs(Math.cos(ra));};
 // 같은 자리 숫자끼리 견주어, 기본 범위보다 가장 많이 넓어진 반폭
 const spGrow=(labels,ref,o)=>{const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1,sz=o.size||16;let m=0;
  labels.forEach((t,i)=>{if(t===''||t==null)return;const a=a0+sw*(n?i/n:0);m=Math.max(m,spAt(t,a,sz,o.cw)-(ref[i]?spAt(ref[i],a,sz,o.cw):0));});return m;};
 // 범위에 맞춘 눈금 숫자와, 기본 범위(200M·20%)보다 숫자가 넓어진 만큼의 반폭 증가 k.
 //  가운데 정렬 숫자는 중심을 k, 눈금 고리는 2k만큼 안쪽으로 옮기면 바깥 여백과 눈금 간격이 그대로 남습니다.
 const scaleFit=(H,d,kind,n,o={})=>{const ev=o.every?{every:o.every}:{};const lab=kind==='rate'?H.rateScale(d,n,ev):H.burnScale(d,n,ev);
  const ref=H.scale(kind==='rate'?200:20,n,ev);return {lab,k:Math.max(0,spGrow(lab,ref,o))};};
 // 눈금 숫자: 글자 폭·높이로 각도마다 반지름을 정해, 큰 눈금 끝에서 글자 상자까지 clear(6px)를 띄웁니다.
 // dir=+1이면 눈금 바깥 끝(rT)보다 바깥, -1이면 눈금 안쪽 끝(rT)보다 안쪽에 둡니다.
 const fitNums=(H,cx,cy,rT,labels,o={})=>{const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1,sz=o.size||16,cw=o.cw??.58,dir=o.dir??1,cl=o.clear??6;
  return labels.map((t,i)=>{if(t===''||t==null)return '';const f=n?i/n:0,a=a0+sw*f,ra=a*Math.PI/180,w=String(t).length*sz*cw,h=sz*.74;
   const sp=w/2*Math.abs(Math.sin(ra))+h/2*Math.abs(Math.cos(ra)),[x,y]=H.pt(cx,cy,rT+dir*(cl+sp),a),red=o.red!=null&&f>=o.red;
   return H.text(x,y,t,{size:sz,fill:red?(o.redColor||'#e53b2c'):(o.fill||'#fff'),font:o.font||'ui',weight:o.weight,base:'central'});}).join('');};
 // 적정 소진 속도 표시 (눈금 안쪽 짧은 선)
 const cruiseMark=(H,d,cx,cy,r0,r1,a0,sweep,col)=>{if(d.cruise==null||!isFinite(d.cruise))return '';const a=a0+sweep*H.clamp(d.cruise/d.burnMax),[x1,y1]=H.pt(cx,cy,r0,a),[x2,y2]=H.pt(cx,cy,r1,a);return H.line(x1,y1,x2,y2,{stroke:col||'#4be3a0',sw:3.5,cap:'round'});};
 // 기간 기어: 모든 칸을 같은 크기로, 현재 기어만 굵게·강조색
 //  o.width: 기어 줄이 쓸 수 있는 폭. 기어가 많으면 간격을 width/개수로 줄이고, 그래도 좁으면 글자를 13px까지 줄입니다.
 const gw=g=>[...g].reduce((a,c)=>a+(c==='m'?.86:.6),0);
 const gearRow=(H,x,y,d,o={})=>{const n=d.gears.length;let gap=o.gap||40,size=o.size||14,out='';
  if(o.width&&n>1)gap=Math.min(gap,o.width/n);
  const mw=Math.max(...d.gears.map(gw));if(mw*size>gap-10)size=Math.max(13,(gap-10)/mw);
  d.gears.forEach((g,i)=>{const on=g===d.period,px=x+(i-(n-1)/2)*gap;let one='';
   if(on&&o.box){const bw=Math.max(gap-6,Math.min(gap-2,gw(g)*size*1.08+12));one+=H.rect(px-bw/2,y-size*.8,bw,size*1.6,{r:o.r??4,fill:o.box});}
   one+=H.text(px,y,g,{size,fill:on?(o.on||'#fff'):(o.off||'#777'),weight:on?700:400,font:o.font||'ui',base:'central'});
   out+=H.cl('period',g,one);});
  return out;};
 const trip=(H,x,y,o={})=>H.cl('trip','',H.text(x,y,`트립 ${H.fmt.trip(o.d.trip)}M`,{size:13,fill:o.fill||'#aaa',anchor:o.anchor||'middle',base:'central',font:o.font}));
 // v4.2.0 계정 목록(d.fuel 0~8개): 같은 도구가 여러 번 나오면 plan을 붙여 구분합니다(Claude Max·Claude Pro).
 //  max줄을 넘으면 앞쪽 max-1개와 '+K' 줄로 줄입니다. 남은 값이 숫자가 아니면 0으로 둡니다(NaN 방지).
 const fuelList=(d,max)=>{const f=d.fuel||[],cnt={};f.forEach(a=>{cnt[a.name]=(cnt[a.name]||0)+1;});
  const rows=f.map(a=>({name:cnt[a.name]>1&&a.plan?a.name+' '+a.plan:String(a.name??''),left:Math.max(0,Math.min(100,Number.isFinite(+a.left)?+a.left:0))}));
  const more=rows.length>max?rows.length-(max-1):0;return {rows:more?rows.slice(0,max-1):rows,more,slots:more?max:rows.length};};
 // 줄 중심 m개: 기본 간격 step, mid를 가운데로 두되 lo~hi를 넘지 않게 간격을 줄이고 밀어 넣습니다
 const rowYs=(m,mid,step,lo,hi)=>{if(m<1)return [];if(m===1)return [Math.max(lo,Math.min(hi,mid))];step=Math.min(step,(hi-lo)/(m-1));
  let y0=mid-(m-1)*step/2;y0=Math.max(lo,Math.min(hi-(m-1)*step,y0));return Array.from({length:m},(_,i)=>y0+i*step);};
 // 이름 글자 폭 어림 (ui 글꼴, 라틴 글자)
 const nameW=(t,sz)=>String(t).length*sz*.58;

 // 01 · Mercedes-Benz S-Class W222 — 검은 유리 화면 하나, 은빛 테두리 두 원, 가운데 정보 화면
 O.theme({id:'01',name:'이그제큐티브 트윈',about:'넓은 검은 유리 위에 은빛 테두리의 두 원을 띄우고, 가운데 화면에 기간 합계와 기어를 둡니다.',draw(H,d){
  const NUM='helv',C1='#e6edfb',C2='#a9bddd',C3='#7489ad',ACC='#ff4b3a';
  let s=H.rect(0,0,1280,480,{fill:'#030407'});
  s+=H.housing('M50 28 H1230 Q1250 28 1250 48 V432 Q1250 452 1230 452 H50 Q30 452 30 432 V48 Q30 28 50 28Z',{top:'#0c1424',bottom:'#03050a',rim:.12});
  // 유리 안쪽으로 들어간 면: 위가 어둡게
  s+=H.rect(30,28,1220,40,{r:20,fill:H.lin('s1top',[[0,'#000',.45],[1,'#000',0]])});
  const cy=242,r=168;
  const dial=(cx,kind,label,unit,f,read,win)=>{
   const {lab:labels,k}=scaleFit(H,d,kind,10,{a0:-130,sweep:260,size:18});
   let o=H.bezel(cx,cy,r,7,{tone:'chrome'})+H.face(cx,cy,r,{fill:'#0b1830',center:'#14325a',edge:'#040a16'});
   o+=H.ticks(cx,cy,r-34-2*k,{a0:-130,sweep:260,n:10,minor:4,len:13,mlen:6,w:2.4,mw:1.2,color:C1,mcolor:'#6f86ad'});
   o+=H.nums(cx,cy,r-16-k,labels,{a0:-130,sweep:260,size:18,fill:C1,font:NUM});
   if(kind==='burn')o+=cruiseMark(H,d,cx,cy,r-36-2*k,r-46-2*k,-130,260);
   o+=H.text(cx,cy+62,read,{size:42,fill:'#fff',font:NUM,weight:300});
   o+=H.text(cx,cy+88,label,{size:14,fill:C2})+H.text(cx,cy+106,unit,{size:13,fill:C3});
   // 6시 방향 창 (원본의 연료·냉각수 창 자리)
   o+=H.rect(cx-64,cy+120,128,28,{r:14,fill:'#060d1a',stroke:'#24365a',sw:1})+H.text(cx,cy+134,win,{size:13,fill:C2,base:'central'});
   o+=H.needle(cx,cy,r-46-2*k,-130+260*f,{style:'taper',w:6,color:ACC,tail:8})+H.hub(cx,cy,13,{fill:'#16233a',light:'#5b6b86'});
   return H.cl('gauge',kind,o);};
  s+=dial(254,'rate','토큰 속도','M tokens/시간',H.frac.rate(d),H.fmt.m(d.rate),`남은 한도 ${Math.round(d.minLeft)}%`);
  s+=dial(1026,'burn','소진 속도','%/시간',H.frac.burn(d),H.fmt.burn(d.burn),`엔진 온도 ${Math.round(d.heat)}°`);
  // 위 상태 줄: 시계 · 경고등 · CPU (가운데 화면 폭에 맞춤)
  s+=H.text(476,78,d.clock,{size:15,fill:C2,anchor:'start',base:'central',font:NUM});
  s+=H.text(804,78,`CPU ${Math.round(d.cpu)}%`,{size:15,fill:C2,anchor:'end',base:'central',font:NUM});
  s+=H.lamps(574,78,d,{size:20,gap:44,off:'#24324a'});
  s+=H.line(476,100,804,100,{stroke:'#22324e',sw:1});
  // 가운데 화면
  s+=H.rect(476,120,328,232,{r:18,fill:'#050b16',stroke:'#24365a',sw:1.5});
  s+=H.text(640,152,d.periodLabel+' 합계',{size:14,fill:C2});
  s+=H.text(640,216,H.fmt.m(d.tokens)+'M',{size:56,fill:'#fff',weight:200,font:NUM});
  s+=H.text(640,242,'tokens',{size:13,fill:C3});
  s+=gearRow(H,640,280,d,{gap:46,size:14,on:'#fff',off:'#5d6f8e',width:300});
  s+=H.line(500,302,780,302,{stroke:'#1d2b42',sw:1});
  s+=H.text(640,328,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:C2});
  // 아래 주행계 줄 (가운데 축)
  s+=H.odo(520,386,H.fmt.odo(d.odo),{cw:16,ch:20,bg:'#071020',fg:C2,frame:'#0b1628',font:NUM})+trip(H,652,396,{d,fill:C2,anchor:'start'});
  s+=H.brand(1222,430,{size:12,fill:'#5d6f8e',anchor:'end'});
  return s;}});

 // 02 · BMW M3 E46 — 회색 다이얼 두 개, 굵은 주황 바늘, 회전계 경고 구간 점, 양옆 작은 계기, 아래 붉은 LCD 띠
 O.theme({id:'02',name:'레드 니들 트윈',about:'회색 다이얼 두 개와 굵은 주황 바늘, 토큰 속도계 안쪽의 노랑·빨강 경고 점, 양옆 작은 계기를 옮겼습니다.',draw(H,d){
  const NUM='helv',INK='#f2efe6',ACC='#ff6b2c',LCD='#ff8a3a';
  let s=H.rect(0,0,1280,480,{fill:'#040404'});
  s+=H.housing('M60 458 C72 160 300 34 640 34 C980 34 1208 160 1220 458Z',{top:'#1f2022',bottom:'#070707',rim:.08});
  s+=H.path('M60 458 C72 160 300 34 640 34 C980 34 1208 160 1220 458',{stroke:'#000',sw:6,op:.35});
  const cy=246;
  // 큰 계기 하나: 다이얼 → (안쪽 표시) → 바늘. 숫자가 넓어지면 눈금 고리(rT)를 안쪽으로 옮깁니다
  const big=(cx,kind,f,label,unit,red,read)=>{const r=156;
   const {lab:labels,k}=scaleFit(H,d,kind,10,{every:2,a0:-120,sweep:240,size:24});const rT=r-58-2*k,r0n=rT-14;
   let o=H.bezel(cx,cy,r,6,{tone:'satin'})+H.face(cx,cy,r,{fill:'#4a4d51',center:'#5c5f63',edge:'#26282b'});
   o+=H.ticks(cx,cy,rT,{a0:-120,sweep:240,n:labels.length-1,minor:4,len:14,mlen:7,w:3,mw:1.4,color:INK,red,redColor:'#e8502c'});
   o+=fitNums(H,cx,cy,rT,labels,{a0:-120,sweep:240,size:24,fill:INK,font:NUM,weight:500,red,redColor:'#ff7040'});
   o+=H.text(cx,cy+54,label,{size:14,fill:'#ece8de'})+H.text(cx,cy+72,unit,{size:13,fill:'#c4c0b6'});
   o+=H.rect(cx-44,cy+86,88,30,{fill:'#140904',r:4,stroke:'#2e1c10'})+H.text(cx,cy+101,read,{size:18,fill:LCD,font:NUM,weight:500,base:'central'});
   // 토큰 속도계: 숫자 안쪽 경고 구간 점 (최대값의 60–100%)
   if(kind==='rate')for(let i=0;i<10;i++){const q=.6+.4*i/9,a=-120+240*q,[x,y]=H.pt(cx,cy,r0n-8,a);o+=H.circle(x,y,3.6,{fill:i<6?'#f6c33a':'#ff3b2a',op:f>=q-.001?1:.22});}
   if(kind==='burn')o+=cruiseMark(H,d,cx,cy,rT,rT-12,-120,240);
   o+=H.needle(cx,cy,r0n,-120+240*f,{style:'taper',w:10,color:ACC,tail:10})+H.hub(cx,cy,17,{fill:'#141414'});
   return H.cl('gauge',kind,o);};
  s+=big(468,'rate',H.frac.rate(d),'토큰 속도','M tokens/시간',.8,H.fmt.m(d.rate));
  s+=big(812,'burn',H.frac.burn(d),'소진 속도','%/시간',.75,H.fmt.burn(d.burn));
  // 작은 계기: 바늘은 위쪽 부채꼴, 이름은 허브 아래
  const small=(cx,kind,f,lab,l0,l1)=>{const scy=292,r=70,py=scy+10;
   let o=H.bezel(cx,scy,r,5,{tone:'satin'})+H.face(cx,scy,r,{fill:'#4a4d51',center:'#56595d',edge:'#26282b'});
   o+=H.ticks(cx,py,62,{a0:-55,sweep:110,n:4,minor:1,len:10,mlen:5,w:2.4,mw:1.2,color:INK,red:.75,redColor:'#ff6040'});
   o+=H.text(cx-36,py+12,l0,{size:13,fill:INK,font:NUM,weight:500})+H.text(cx+36,py+12,l1,{size:13,fill:INK,font:NUM,weight:500});
   o+=H.text(cx,py+36,lab,{size:13,fill:'#e0dcd2'});
   o+=H.needle(cx,py,52,-55+110*f,{style:'taper',w:6,color:ACC,tail:4})+H.hub(cx,py,7,{fill:'#141414'});return H.cl('gauge',kind,o);};
  s+=small(202,'heat',H.frac.heat(d),'엔진 온도','C','H')+small(1078,'fuel',H.frac.min(d),'남은 한도','E','F');
  // 경고등: 두 큰 계기 사이 위쪽, 가운데 축
  s+=H.lamps(574,62,d,{size:18,gap:44,colors:{waiting:'#ffb02e'},off:'#2a2a2a'});
  // 아래 붉은 LCD 띠: 주행계 · 기어 · 트립
  s+=H.rect(424,414,432,30,{fill:'#140904',r:5,stroke:'#2e1c10'});
  s+=H.text(440,429,H.fmt.odo(d.odo,6),{size:15,fill:LCD,font:NUM,weight:500,anchor:'start',base:'central',ls:1});
  s+=gearRow(H,640,429,d,{gap:34,size:13,on:LCD,off:'#7a5a44',width:238});
  s+=trip(H,840,429,{d,fill:LCD,anchor:'end'});
  s+=H.brand(1078,414,{fill:'#6a6d70'});
  return s;}});

 // 03 · Porsche 911 991 — 다섯 원이 사슬처럼 겹쳐 선 구성, 가운데가 가장 크고 앞, 오른쪽 둘째 원은 화면
 O.theme({id:'03',name:'다섯 원',about:'다섯 원을 겹쳐 세우고, 가운데 큰 원에 토큰 속도를, 오른쪽 둘째 원에 계정 화면을 넣었습니다.',draw(H,d){
  const NUM='helv',INK='#f3f3ee',ACC='#ff6a1a',RED='#ff5a3a';
  let s=H.rect(0,0,1280,480,{fill:'#0a0a0a'});
  s+=H.housing('M34 456 C54 112 320 26 640 26 C960 26 1226 112 1246 456Z',{top:'#1a1a1c',bottom:'#060606',rim:.07});
  const ring=(cx,cy,r,w)=>H.bezel(cx,cy,r,w,{tone:'black'})+H.circle(cx,cy,r+w/2-1.5,{stroke:'#8b8d90',sw:1,op:.55})+H.face(cx,cy,r,{fill:'#111214',center:'#1a1b1d',edge:'#060607'});
  // 옆 계기: 앞 원에 가려지는 쪽은 눈금을 비웁니다
  const sub=(cx,cy,r,f,a0,sw,lab,unit,labels,red,read,k=0)=>{let o=ring(cx,cy,r,8);
   const to=r-22-2*k,len=10;
   o+=H.ticks(cx,cy,to,{a0,sweep:sw,n:labels.length-1,minor:1,len,mlen:5,w:2.2,mw:1.1,color:INK,red,redColor:RED});
   o+=H.nums(cx,cy,r-11-k,labels,{a0,sweep:sw,size:13,fill:INK,font:NUM,weight:500,red,redColor:RED});
   if(read)o+=H.text(cx,cy+r*.36,read,{size:24,fill:'#fff',font:NUM,weight:300});
   o+=H.text(cx,cy+r*.36+(read?22:0),lab,{size:13,fill:'#cfd0cc'});
   if(unit)o+=H.text(cx,cy+r*.36+38,unit,{size:13,fill:'#8e8e88'});
   o+=H.needle(cx,cy,to-len,a0+sw*f,{style:'taper',w:5,color:ACC,tail:5})+H.hub(cx,cy,8);return o;};
  // 바깥 두 원 (가장 뒤): CPU·엔진 온도는 0–100% 고정 눈금입니다
  s+=sub(178,292,86,H.frac.cpu(d),-140,170,'CPU','',['0','25','50','75','100'],.8);
  s+=H.cl('gauge','heat',sub(1102,292,86,H.frac.heat(d),-30,170,'엔진 온도','',['0','25','50','75','100'],.75));
  // 둘째 원
  {const {lab,k}=scaleFit(H,d,'burn',5,{a0:-130,sweep:170,size:13});
   s+=H.cl('gauge','burn',sub(374,254,116,H.frac.burn(d),-130,170,'소진 속도','%/시간',lab,.8,H.fmt.burn(d.burn),k)+cruiseMark(H,d,374,254,92-2*k,82-2*k,-130,170));}
  {const cx=906,cy=254;
   s+=ring(cx,cy,116,9);
   s+=H.circle(cx,cy,104,{fill:'#0a0e14'})+H.circle(cx,cy,104,{stroke:'#1d2632',sw:1.5});
   s+=H.text(cx+8,cy-60,d.periodLabel,{size:13,fill:'#8fa3b8'});
   // 계정 줄: 원 안 cy-35~cy+23에 최대 4줄(넘치면 3줄 + '+K'). 이름이 길면 이름 칸을 왼쪽으로 넓히고 막대를 줄입니다
   {const {rows,more,slots}=fuelList(d,4),ys=rowYs(slots,cy-6,26,cy-36,cy+24);
    const nw=Math.max(0,...rows.map(f=>nameW(f.name,13))),x0=Math.max(cx-80,cx-58-Math.max(0,nw+8-52)),bx=x0+Math.max(52,nw+8),bw=Math.max(26,cx+42-bx);
    let fu=rows.map((f,i)=>{const y=ys[i];return H.text(x0,y,f.name,{size:13,fill:'#dfe6ee',anchor:'start',base:'central'})+H.rect(bx,y-4,bw,8,{fill:'#20262e',r:2})+H.rect(bx,y-4,bw*f.left/100,8,{fill:f.left<40?'#ff9a2a':'#5fd08a',r:2})+H.text(cx+78,y,Math.round(f.left)+'%',{size:13,fill:'#9fb0c2',anchor:'end',base:'central'});}).join('');
    if(more)fu+=H.text(x0,ys[slots-1],'+'+more,{size:13,fill:'#8fa3b8',anchor:'start',base:'central'});
    if(!slots)fu+=H.text(cx+8,cy-6,'계정 없음',{size:13,fill:'#6f8193',base:'central'});
    s+=H.cl('gauge','fuel',fu);}
   s+=H.line(cx-50,cy+34,cx+66,cy+34,{stroke:'#1d2632',sw:1});
   // 적정 속도를 모르면 적정 줄을 빼고 작업 가능을 남은 칸 가운데로 내립니다
   const hasCruise=d.cruise!=null&&isFinite(d.cruise);
   s+=H.text(cx+8,cy+(hasCruise?56:64),`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:'#fff'});
   if(hasCruise)s+=H.text(cx+8,cy+76,`적정 ${H.fmt.burn(d.cruise)}%/시간`,{size:13,fill:'#4be3a0'});}
  // 가운데 회전계 (가장 크고 앞)
  const cx=640,cy=230,r=166;
  {const {lab,k}=scaleFit(H,d,'rate',10,{every:2,a0:-130,sweep:260,size:26});let o=ring(cx,cy,r,11);
   o+=H.ticks(cx,cy,r-50-2*k,{a0:-130,sweep:260,n:10,minor:4,len:16,mlen:8,w:3,mw:1.4,color:'#f5f5f0',red:.8,redColor:'#e8402a'});
   o+=H.nums(cx,cy,r-24-k,lab,{a0:-130,sweep:260,size:26,fill:'#f5f5f0',font:NUM,weight:500,red:.8,redColor:RED});
   o+=H.text(cx,cy+62,H.fmt.m(d.rate),{size:40,fill:'#fff',font:NUM,weight:300});
   o+=H.text(cx,cy+86,'토큰 속도',{size:14,fill:'#cfcfc9'})+H.text(cx,cy+104,'M tokens/시간',{size:13,fill:'#8e8e88'});
   o+=H.needle(cx,cy,r-66-2*k,-130+260*H.frac.rate(d),{style:'taper',w:9,color:ACC,tail:12})+H.hub(cx,cy,17);
   s+=H.cl('gauge','rate',o);}
  // 경고등은 바늘이 가지 않는 6시 구역
  s+=H.lamps(574,cy+130,d,{size:18,gap:44,off:'#2a2b2d'});
  // 아래 가운데 축: 누적 토큰 · 기간 기어 · 트립
  s+=H.text(452,430,`누적 ${H.fmt.odo(d.odo)} M`,{size:13,fill:'#9a9a94',font:NUM,ls:.5,anchor:'end'});
  s+=gearRow(H,cx,430,d,{gap:40,size:14,on:'#fff',off:'#77776f',width:300});
  s+=trip(H,828,430,{d,fill:'#9a9a94',anchor:'start',font:NUM});
  s+=H.brand(1170,430,{fill:'#6a6a66'});
  return s;}});

 // 04 · Ferrari 458 Italia — 가운데 큰 노란 회전계, 왼쪽 화면, 오른쪽 검은 원
 O.theme({id:'04',name:'지알로 첸트랄레',about:'가운데 커다란 노란 다이얼에 토큰 속도를, 왼쪽 화면에 연료와 엔진 온도를, 오른쪽 검은 원에 소진 속도를 두었습니다.',draw(H,d){
  const NUM='helv',Y='#ffd640';
  let s=H.rect(0,0,1280,480,{fill:'#040404'});
  // 하우징: 어깨를 둥글게 세워 왼쪽 화면이 곡선 안쪽에 온전히 들어갑니다
  const hood='M40 466 V196 C40 92 150 40 300 34 H980 C1130 40 1240 92 1240 196 V466Z';
  s+=H.housing(hood,{top:'#1c1c1d',bottom:'#060606',rim:.08});
  // 가운데 노란 회전계
  const cx=640,cy=250,r=180;
  {const {lab,k}=scaleFit(H,d,'rate',10,{every:2,a0:-130,sweep:260,size:30,cw:.62}),rT=r-64-2*k;
   let o=H.bezel(cx,cy,r,14,{tone:'bronze'})+H.face(cx,cy,r,{fill:'#efc12b',center:'#f8d550',edge:'#b8860c'});
   o+=H.band(cx,cy,rT,rT+6,-130+260*.8,130,{fill:'#d11a1a'});
   o+=H.ticks(cx,cy,rT,{a0:-130,sweep:260,n:10,minor:4,len:18,mlen:9,w:4,mw:2,color:'#111',red:.8,redColor:'#7a0000'});
   o+=H.nums(cx,cy,r-32-k,lab,{a0:-130,sweep:260,size:30,fill:'#111',font:NUM,weight:700,red:.8,redColor:'#b0101a'});
   o+=H.rect(cx-54,cy+50,108,40,{r:6,fill:'#111',stroke:'#3a2e05',sw:1})+H.text(cx,cy+71,H.fmt.m(d.rate),{size:26,fill:Y,font:NUM,weight:600,base:'central'});
   o+=H.text(cx,cy+114,'토큰 속도',{size:14,fill:'#2e2404',weight:600})+H.text(cx,cy+132,'M tokens/시간',{size:13,fill:'#4a3c0a'});
   o+=H.needle(cx,cy,rT-18,-130+260*H.frac.rate(d),{style:'taper',w:12,color:'#c8141a',tail:14})+H.hub(cx,cy,22,{fill:'#141414'});
   s+=H.cl('gauge','rate',o);}

  // 왼쪽 화면: 가로 축 250 (오른쪽 원 1030과 좌우 대칭)
  const X0=90,X1=410,Y0=112,Y1=388,P=16,ax=(X0+X1)/2;
  s+=H.rect(X0-4,Y0-4,X1-X0+8,Y1-Y0+8,{r:18,fill:'#000',op:.5});
  s+=H.rect(X0,Y0,X1-X0,Y1-Y0,{r:14,fill:'#0a0d12',stroke:'#2c2e33',sw:2});
  s+=H.rect(X0+P,Y0+P,X1-X0-P*2,30,{r:6,fill:'#d6d6d6'});
  s+=H.text(X0+P+12,Y0+P+15,d.clock,{size:14,fill:'#111',anchor:'start',weight:700,base:'central',font:NUM});
  s+=H.text(X1-P-12,Y0+P+15,d.periodLabel,{size:14,fill:'#111',anchor:'end',weight:600,base:'central'});
  s+=trip(H,ax,Y0+P+15,{d,fill:'#333',font:NUM});
  // 계정 줄: 머리 띠와 엔진 온도 줄 사이(Y0+62~Y0+152)에 최대 6줄(넘치면 5줄 + '+K'). 이름이 길면 막대 시작을 오른쪽으로 옮깁니다
  const {rows:FR,more:FM,slots:FS}=fuelList(d,6),fys=rowYs(FS,Y0+110,30,Y0+62,Y0+152),fstep=FS>1?fys[1]-fys[0]:30,fbh=Math.min(14,fstep-5);
  const lx=X0+P,vx=X1-P,bx=lx+Math.max(74,...FR.map(f=>nameW(f.name,13)+10)),bw=vx-44-bx;
  {let fu=FR.map((f,i)=>{const y=fys[i];return H.text(lx,y,f.name,{size:13,fill:'#ddd',anchor:'start',base:'central'})+H.bars(bx,y-fbh/2,bw,fbh,f.left/100,{n:17,gap:3,fill:f.left<40?'#ff8a1a':Y,off:'#23272d'})+H.text(vx,y,Math.round(f.left)+'%',{size:13,fill:'#aaa',anchor:'end',base:'central'});}).join('');
   if(FM)fu+=H.text(lx,fys[FS-1],'+'+FM,{size:13,fill:'#8a8a8a',anchor:'start',base:'central'});
   if(!FS)fu+=H.text(ax,Y0+110,'계정 없음',{size:13,fill:'#7a7a7a',base:'central'});
   s+=H.cl('gauge','fuel',fu);}
  {const y=Y0+170;s+=H.cl('gauge','heat',H.text(lx,y,'엔진 온도',{size:13,fill:'#ddd',anchor:'start',base:'central'})+H.bars(bx,y-7,bw,14,H.frac.heat(d),{n:17,gap:3,colors:[[0,'#3fa9ff'],[.5,Y],[.85,'#e3201a']],off:'#23272d'})+H.text(vx,y,Math.round(d.heat)+'°',{size:13,fill:'#aaa',anchor:'end',base:'central'}));}
  s+=H.line(lx,Y0+192,vx,Y0+192,{stroke:'#22262c',sw:1});
  s+=H.lamps(lx+10,Y0+214,d,{size:18,gap:34,off:'#2d3036'})+H.text(vx,Y0+214,H.fmt.odo(d.odo)+' M',{size:13,fill:'#8a8a8a',font:NUM,anchor:'end',base:'central'});
  s+=gearRow(H,ax,Y0+248,d,{gap:46,size:14,on:'#111',off:'#7a7a7a',box:Y,width:vx-lx});
  // 오른쪽 검은 원 = 소진 속도
  {const cx2=1030,cy2=250,r2=148,f=H.frac.burn(d),{lab,k}=scaleFit(H,d,'burn',10,{a0:-130,sweep:260,size:17});let o='';
   o+=H.bezel(cx2,cy2,r2,8,{tone:'black'})+H.face(cx2,cy2,r2,{fill:'#0d121c',center:'#151c2b',edge:'#16245e'});
   o+=H.ticks(cx2,cy2,r2-36-2*k,{a0:-130,sweep:260,n:10,minor:1,len:12,mlen:6,w:2.5,mw:1.2,color:'#e8ecf5'});
   o+=H.nums(cx2,cy2,r2-18-k,lab,{a0:-130,sweep:260,size:17,fill:'#e8ecf5',font:NUM,weight:500});
   o+=cruiseMark(H,d,cx2,cy2,r2-38-2*k,r2-48-2*k,-130,260);
   o+=H.text(cx2,cy2+56,H.fmt.burn(d.burn),{size:30,fill:'#fff',font:NUM,weight:500});
   o+=H.text(cx2,cy2+80,'소진 속도',{size:14,fill:'#c6cde0'})+H.text(cx2,cy2+98,'%/시간',{size:13,fill:'#8f9ab8'});
   o+=H.text(cx2,cy2+122,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:13,fill:Y});
   o+=H.needle(cx2,cy2,r2-48-2*k,-130+260*f,{style:'taper',w:7,color:'#f2f2f2',tail:10})+H.hub(cx2,cy2,14,{fill:'#141414'});
   s+=H.cl('gauge','burn',o);}
  s+=H.brand(X0,Y1+40,{fill:'#5e5e5e',anchor:'start'});
  return s;}});

 // 05 · Lamborghini Aventador — 육각 테두리, 가운데 큰 숫자, 양옆 세로 막대, 날개 화면
 O.theme({id:'05',name:'에어로 헥스',about:'육각형 화면 안에 거대한 숫자와 각진 눈금을 두고, 양옆 세로 막대와 날개 화면에 소진 속도·엔진 온도·연료를 나눴습니다.',draw(H,d){
  const NUM='wide',ACC='#e8d84a',T1='#e9edf2',T2='#9aa3ad',OFF='#191d22';
  let s=H.rect(0,0,1280,480,{fill:'#000'});
  s+=H.housing('M150 68 L330 24 H950 L1130 68 L1236 300 L1090 456 H190 L44 300Z',{top:'#121519',bottom:'#030405',rim:.14});
  s+=H.path('M162 82 L336 40 H944 L1118 82 L1218 300 L1082 440 H198 L62 300Z',{stroke:'#000',sw:2,op:.6});
  const cx=640,cy=246;
  const hex=(r)=>{let p='';for(let i=0;i<6;i++){const [x,y]=H.pt(cx,cy,r,i*60);p+=(i?'L':'M')+x+' '+y;}return p+'Z';};
  s+=H.path(hex(202),{fill:H.lin('hx',[[0,'#a1aab4'],[.5,'#3c434b'],[1,'#77808a']]),filter:H.shadow('hxs',3,6,.6)});
  s+=H.path(hex(190),{fill:'#05070a'})+H.path(hex(184),{stroke:'#1e242b',sw:1});
  const f=H.frac.rate(d);
  // 숫자는 눈금 안쪽에 있으므로, 넓어진 만큼 숫자 고리를 안쪽으로 옮깁니다(넓은 글꼴이라 폭을 넉넉히 잡습니다)
  {const {lab,k}=scaleFit(H,d,'rate',10,{every:2,a0:-150,sweep:300,size:17,cw:.8});let o='';
   o+=H.arcBars(cx,cy,154,f,{a0:-150,sweep:300,n:60,w:12,gapA:1.2,colors:[[0,ACC],[.75,'#ff8a1a'],[.9,'#ff2a1a']],off:OFF});
   o+=H.ticks(cx,cy,136,{a0:-150,sweep:300,n:10,minor:1,len:10,mlen:5,w:2.5,mw:1.2,color:T1});
   o+=H.nums(cx,cy,102-k,lab,{a0:-150,sweep:300,size:17,fill:T1,font:NUM,weight:700});
   o+=H.text(cx,cy-40,d.period,{size:18,fill:ACC,font:NUM,weight:800});
   o+=H.text(cx,cy+20,H.fmt.m(d.rate),{size:58,fill:'#fff',font:NUM,weight:800});
   o+=H.text(cx,cy+46,'M tokens/시간',{size:14,fill:ACC});
   // 오른쪽 아래 끝 숫자가 네 자리('1000')면 계기 이름을 내려 같은 줄로 붙지 않게 합니다
   o+=H.text(cx,cy+108+(lab[lab.length-1].length>3?12:0),'토큰 속도',{size:13,fill:T2});
   s+=H.cl('gauge','rate',o);}
  // 양옆 세로 막대: 육각 옆면(470/810, 148–344)과 같은 높이
  const flank=(x,fr,lab,val,unit,cols)=>H.text(x,132,lab,{size:13,fill:ACC})+H.vbars(x-12,148,24,196,fr,{n:14,gap:3,colors:cols,off:OFF})+H.text(x,368,val,{size:17,fill:'#fff',font:NUM,weight:700})+(unit?H.text(x,388,unit,{size:13,fill:T2}):'');
  const hasCruise=d.cruise!=null&&isFinite(d.cruise);
  {const yc=148+196*(1-H.clamp(d.cruise/d.burnMax));
   s+=H.cl('gauge','burn',flank(422,H.frac.burn(d),'소진',H.fmt.burn(d.burn),'%/시간',[[0,ACC],[.75,'#ff2a1a']])+(hasCruise?H.line(406,yc,438,yc,{stroke:'#4be3a0',sw:2.5,cap:'round'}):''));}
  s+=H.cl('gauge','heat',flank(858,H.frac.heat(d),'온도',Math.round(d.heat)+'°','',[[0,'#3fa9ff'],[.5,ACC],[.85,'#ff2a1a']]));
  // 왼쪽 날개 화면: 시계 · 기간 · 기어 · 작업 가능 (오른쪽 끝 376에 맞춤)
  const lp='M176 116 H388 V384 H170 L91 300 Z',rp='M1104 116 H892 V384 H1110 L1189 300 Z';
  for(const p of [lp,rp])s+=H.path(p,{fill:H.lin('wg'+p.length,[[0,'#0b0e12'],[1,'#06080a']]),stroke:'#262c33',sw:1.5});
  const RX=370;
  s+=H.text(RX,178,d.clock,{size:40,fill:'#fff',font:NUM,weight:700,anchor:'end'});
  s+=H.text(RX,204,d.periodLabel,{size:14,fill:ACC,anchor:'end'});
  {// 글자 사이 빈칸을 모두 같게: 글자 폭을 어림해 왼쪽 190–오른쪽 RX 안에 고르게 폅니다.
   // 기어가 많아 빈칸이 9px보다 좁아지면, 왼쪽 시작을 날개 빗변 쪽(최대 150)으로 넓힙니다
   const cwid={m:.86,h:.58},ws=d.gears.map(g=>[...g].reduce((a,c)=>a+13*(cwid[c]??.58),0)),sum=ws.reduce((a,b)=>a+b,0),n=ws.length;
   const X0=Math.max(150,Math.min(190,RX-sum-9*(n-1))),gp=n>1?(RX-X0-sum)/(n-1):0;let x=n>1?X0:(X0+RX-sum)/2;
   s+=H.line(X0,226,RX,226,{stroke:'#262c33',sw:1});
   d.gears.forEach((g,i)=>{const on=g===d.period;s+=H.cl('period',g,H.text(x+ws[i]/2,256,g,{size:13,fill:on?ACC:'#6b737c',weight:on?700:400,font:'ui',base:'central'}));x+=ws[i]+gp;});}
  s+=H.text(RX,302,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:'#fff',anchor:'end'});
  // 적정 속도를 모르면 그 줄에 CPU를 둡니다(빈 줄 없이)
  s+=H.text(RX,326,hasCruise?`적정 ${H.fmt.burn(d.cruise)}%/시간`:`CPU ${Math.round(d.cpu)}%`,{size:13,fill:T2,anchor:'end'});
  s+=H.text(RX,352,`누적 ${H.fmt.odo(d.odo)} M`,{size:13,fill:T2,anchor:'end'});
  // 오른쪽 날개 화면: 계정별 연료 (왼쪽 끝 910에 맞춤)
  const LX=910,BW=164;
  // 계정 줄: '연료' 아래 172~304에 최대 6줄(넘치면 5줄 + '+K'), 경고등 줄(342) 위에서 끝납니다. 줄이 촘촘하면 막대를 얇게 합니다
  {const {rows,more,slots}=fuelList(d,6),ys=rowYs(slots,230,46,172,304),st=slots>1?ys[1]-ys[0]:46,bh=Math.max(5,Math.min(12,st-20));
   let fu=H.text(LX,150,'연료',{size:14,fill:ACC,anchor:'start'})+rows.map((fu,i)=>{const y=ys[i];return H.text(LX,y,fu.name,{size:13,fill:'#c8cdd2',anchor:'start'})+H.text(LX+BW,y,Math.round(fu.left)+'%',{size:13,fill:'#fff',anchor:'end',font:NUM,weight:700})+H.bars(LX,y+(st<40?6:8),BW,bh,fu.left/100,{n:20,gap:2,fill:fu.left<40?'#ff8a1a':ACC,off:OFF});}).join('');
   if(more)fu+=H.text(LX,ys[slots-1],'+'+more,{size:13,fill:T2,anchor:'start'});
   if(!slots)fu+=H.text(LX,190,'계정 없음',{size:13,fill:T2,anchor:'start'});
   s+=H.cl('gauge','fuel',fu);}
  s+=H.cl('trip','',H.text(LX+BW,150,`트립 ${H.fmt.trip(d.trip)}M`,{size:13,fill:T2,anchor:'end'}));
  s+=H.lamps(LX+10,342,d,{size:18,gap:36,off:'#2a3036'});
  s+=H.brand(1074,420,{fill:'#6d7680',anchor:'end'});
  return s;}});

 // 06 · Audi TT Virtual Cockpit — 넓은 화면 대부분을 세션 지도로, 양쪽 원
 O.theme({id:'06',name:'버추얼 워크스페이스',about:'지도 대신 세션 지도(세션별 사용량 칸)를 넓게 깔고, 양쪽 원은 작게 줄였습니다.',draw(H,d){
  const NUM='avenir',T1='#eef2f4',T2='#b5bdc4',T3='#7d868e',ACC='#e8382c';
  let s=H.rect(0,0,1280,480,{fill:'#000'});
  s+=H.housing('M64 58 Q640 18 1216 58 L1244 410 Q640 464 36 410Z',{top:'#1c1f23',bottom:'#08090a',rim:.1});
  const scr='M92 82 Q640 44 1188 82 L1212 384 Q640 434 68 384Z';
  const clip=H.clip('scr',`<path d="${scr}"/>`);
  let bg=H.rect(0,0,1280,480,{fill:H.lin('scbg',[[0,'#0d1a14'],[1,'#07100c']])});
  // 세션 지도 (가운데 380–900)
  // 세션 타일: d.list를 토큰 양만큼 나눕니다. 좁은 타일은 글자를 줄이거나 뺍니다
  const green=['#2f6a4b','#2a5f44','#25553d','#214c37'],L=d.list||[];
  if(!L.length)bg+=H.rect(382,110,516,232,{fill:'#16241d',r:4})+H.text(640,226,'세션 없음',{size:15,fill:'#7fa08c',base:'central'});
  H.treemap(L,380,108,520,236).forEach(({x,y,w,h,s:se,i})=>{const wait=se.state==='waiting',c=wait?'#5e4c18':se.state==='idle'?'#2a3330':green[Math.min(3,i)];
   bg+=H.rect(x+2,y+2,w-4,h-4,{fill:c,r:4})+H.rect(x+2,y+2,w-4,1.5,{fill:'#fff',op:.12});
   if(w>=64&&h>=40){bg+=H.text(x+14,y+24,H.ellipsis(se.name,w-26,14,'ui',600),{size:14,fill:'#f2f7f3',anchor:'start',weight:600});
    if(h>=58)bg+=H.text(x+14,y+44,wait?'응답 대기':(se.tok||''),{size:13,fill:wait?'#ffc24a':'#bcd9c6',anchor:'start'});}});
  s+=H.g(bg,{clip});
  s+=H.path(scr,{stroke:'#000',sw:3,op:.7})+H.path(scr,{stroke:'#fff',sw:1,op:.06});
  const mini=(cx,kind,f,lab,unit,read)=>{const cy=238,r=126,labels=kind==='rate'?H.rateScale(d,5):H.burnScale(d,5);
   let o=H.bezel(cx,cy,r,4,{tone:'satin',inner:'#050607'})+H.face(cx,cy,r,{fill:'#08090a',center:'#0f1113',edge:'#030304'});
   o+=H.arc(cx,cy,r-5,-135,135,{stroke:'#1c1f22',sw:6});
   o+=H.arc(cx,cy,r-5,-135,-135+270*f,{stroke:ACC,sw:6});
   o+=H.ticks(cx,cy,r-12,{a0:-135,sweep:270,n:labels.length-1,minor:1,len:11,mlen:5,w:2.2,mw:1.1,color:T1});
   o+=fitNums(H,cx,cy,r-23,labels,{a0:-135,sweep:270,size:16,fill:T1,font:NUM,weight:500,dir:-1});
   o+=H.text(cx,cy-30,lab,{size:13,fill:T2});
   o+=H.text(cx,cy+14,read,{size:38,fill:'#fff',font:NUM,weight:500});
   o+=H.text(cx,cy+40,unit,{size:13,fill:T3});
   const an=-135+270*f,[x1,y1]=H.pt(cx,cy,r-26,an),[x2,y2]=H.pt(cx,cy,r-2,an);o+=H.line(x1,y1,x2,y2,{stroke:'#ff4a3a',sw:4,cap:'round'});
   return H.cl('gauge',kind,o);};
  s+=mini(232,'rate',H.frac.rate(d),'토큰 속도','M tokens/시간',H.fmt.m(d.rate));
  s+=mini(1048,'burn',H.frac.burn(d),'소진 속도','%/시간',H.fmt.burn(d.burn));
  // 위 상태 줄 (지도 폭 380–900에 맞춤)
  s+=H.text(382,90,d.clock,{size:14,fill:T1,anchor:'start',base:'central',font:NUM,weight:500});
  s+=trip(H,436,90,{d,fill:T2,anchor:'start'});
  s+=H.lamps(574,90,d,{size:18,gap:44,off:'#33403a'});
  s+=H.cl('gauge','heat',H.text(898,90,'엔진 온도 '+Math.round(d.heat)+'°',{size:13,fill:T2,anchor:'end',base:'central'}));
  // 아래 상태 줄
  s+=H.text(382,370,`누적 ${H.fmt.odo(d.odo)} M`,{size:13,fill:T2,anchor:'start',base:'central'});
  s+=gearRow(H,640,370,d,{gap:40,size:14,on:'#fff',off:'#7f8a84',width:280});
  s+=H.text(898,370,`작업 가능 ${H.fmt.hours(d.rangeH)}`,{size:14,fill:T1,anchor:'end',base:'central'});
  s+=H.brand(640,432,{fill:'#6a7076'});
  return s;}});
})(window.OneTop);
