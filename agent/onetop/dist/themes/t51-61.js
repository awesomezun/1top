/* 51–61 (v4.0.0)
   바늘 원칙: 바늘은 눈금 안쪽 끝까지, 눈금 숫자는 바늘 끝 바깥 고리, 읽음 값·이름은 바늘이 가지 않는 구역.
   글자 단계: 주 값 → 보조 값(주 값의 절반) → 라벨·단위 13–14px → 주행계 단위만 12px.
   모든 요소는 계기 중심축, 하우징 안쪽 여백선, 공유 기준선 중 하나에 맞춥니다. */
(function(O){
 'use strict';
 // 눈금 숫자는 d.rateMax·d.burnMax에서 만듭니다(H.rateScale·H.burnScale).
 // 기본 범위보다 숫자가 길어지면(0.4, 1000) 늘어난 반폭만큼 눈금 고리를 안쪽으로 옮깁니다. base: 기본 범위의 가장 긴 숫자 글자 수
 const ext=(labels,size,base)=>Math.max(0,Math.max(...labels.map(t=>t.length))-base)*size*.3;
 // 기어 격자: 3개 이하는 한 줄, 4개와 7개 이상은 4열, 5·6개는 3열. 줄마다 가운데 맞춥니다
 function gearGrid(n){const cols=n<=3?n:(n===4||n>6)?4:3,rows=Math.ceil(n/cols);
  return Array.from({length:n},(_,i)=>{const row=Math.floor(i/cols),k=Math.min(cols,n-row*cols);return {col:i%cols-(k-1)/2,row,rows,cols};});}

 // 안쪽으로 들어간 면: 바탕 + 위쪽이 어두운 그림자 + 아래 가장자리 가는 빛선
 function well(H,n,d,o={}){
  const base=H.lin(n,[[0,o.top||'#060708'],[1,o.bottom||'#121417']]);
  const sh=H.lin(n+'s',[[0,'#000',o.shade??.55],[o.depth??.14,'#000',0]]);
  return H.path(d,{fill:base})+H.path(d,{fill:sh})+H.path(d,{stroke:'#000',sw:1.5,op:.6});
 }
 // 둥근 사각 안쪽 면
 function wellRect(H,n,x,y,w,h,r,o={}){
  const d=`M${x+r} ${y}H${x+w-r}Q${x+w} ${y} ${x+w} ${y+r}V${y+h-r}Q${x+w} ${y+h} ${x+w-r} ${y+h}H${x+r}Q${x} ${y+h} ${x} ${y+h-r}V${y+r}Q${x} ${y} ${x+r} ${y}Z`;
  return well(H,n,d,o)+(o.lip===false?'':H.path(`M${x+r} ${y+h+.5}H${x+w-r}`,{stroke:'#fff',sw:1,op:o.lip??.08}));
 }
 // 눈금 숫자를 큰 눈금 끝에서 gap 이상 띄웁니다. 각도마다 글자 상자의 지지 함수 w/2·|sin a| + h/2·|cos a|만큼 더 밀어냅니다.
 // edge: 숫자 쪽 눈금 끝 반지름, dir: +1 바깥 / -1 안쪽
 function numsFit(H,cx,cy,edge,labels,o={}){
  const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1,size=o.size||16,gap=(o.gap??6)+1;
  return labels.map((t,i)=>{if(t===''||t==null)return '';const a=a0+sw*(n?i/n:0),rad=a*Math.PI/180;
   const w=t.length*size*.6,h=size*.76,sup=w/2*Math.abs(Math.sin(rad))+h/2*Math.abs(Math.cos(rad));
   return H.nums(cx,cy,edge+(o.dir??1)*(gap+sup),[t],{...o,a0:a,sweep:0,red:o.red!=null&&(n?i/n:0)>=o.red?0:null});}).join('');
 }
 // 좁은 칸의 기어 줄: 같은 간격(H.gear)으로 width에 들어가면 그대로 쓰고,
 // 넘치면 글자 폭에 맞춰 놓고 남는 폭을 고르게 나눕니다(기어 7개용).
 function gearFit(H,cx,y,d,o){
  const n=d.gears.length,size=o.size,offS=Math.max(11,size*.85),gap=o.gap;
  const w=d.gears.map(g=>g.length*(g===d.period?size:offS)*.6);
  if((n-1)*gap+(w[0]+w[n-1])/2<=o.width&&w.every(v=>v<gap-6))return H.gear(cx,y,d,{...o,width:undefined});
  const tw=w.reduce((a,b)=>a+b,0),sp=Math.min(gap,(o.width-tw)/Math.max(1,n-1));
  let x=cx-(tw+sp*(n-1))/2,out='';
  d.gears.forEach((g,i)=>{const on=g===d.period;
   out+=H.cl('period',g,H.text(x+w[i]/2,y,g,{size:on?size:offS,fill:on?(o.on||'#fff'):(o.off||'#666'),weight:on?700:400,font:o.font||'ui',base:'central'}));x+=w[i]+sp;});
  return out;
 }
 // 계정 이름: 같은 도구가 두 번 이상 나오면 plan을 붙여 구분합니다(Claude Max · Claude Pro)
 const acct=(F,f)=>f.plan&&F.filter(g=>g.name===f.name).length>1?f.name+' '+f.plan:f.name;
 // 글자 폭 어림값(넉넉하게): 한글은 글자 크기만큼, 공백·구두점은 0.32배, 나머지는 0.6배
 const tw=(t,size)=>[...String(t)].reduce((a,c)=>a+(/[가-힣]/.test(c)?1:/[ .,:·]/.test(c)?.32:.6),0)*size;
 // 계정 목록(0~8개): 첫 줄 기준선 y부터 bottom까지 1열 → 2열 순서로 들어가는 가장 큰 글자를 고릅니다.
 // 그래도 안 들어가면 앞쪽 몇 개와 '+3 계정'으로 줄입니다. 막대는 1열이고 자리가 남을 때만 그립니다.
 // o: {x,w,y,bottom,sp,size,cols,gap,ink,mute,low,bar:{x,w,h,dy,off,fill}}
 function fuelRows(H,d,o){
  const F=d.fuel,n=F.length,min=12,gap=o.gap??12;
  if(!n)return H.text(o.x,o.y,'계정 없음',{size:Math.min(14,o.size),fill:o.mute,anchor:'start'});
  const names=F.map(f=>acct(F,f)),pct=F.map(f=>Math.round(f.left)+'%');
  const draw=(list,cols,size,sp)=>{const cw=(o.w-(cols-1)*gap)/cols,rows=Math.ceil(list.length/cols);
   const nw=Math.max(...list.map(r=>r.name?tw(r.name,size):0)),pw=Math.max(...list.map(r=>tw(r.pct||'',size)));
   let bar=null;
   if(o.bar&&cols===1){let bx=o.bar.x,bw=o.bar.w;if(bx<o.x+nw+8){bx=o.x+nw+10;bw=Math.min(bw,o.x+cw-pw-10-bx);}if(bw>=40)bar={bx,bw};}
   let out='';
   list.forEach((r,i)=>{const c=Math.floor(i/rows),k=i%rows,x=o.x+c*(cw+gap),y=o.y+k*sp;
    if(r.more){out+=H.text(x,y,r.more,{size,fill:o.mute,anchor:'start'});return;}
    const low=r.f.left<40;
    out+=H.text(x,y,r.name,{size,fill:o.ink,anchor:'start'});
    if(bar)out+=H.rect(bar.bx,y-o.bar.dy,bar.bw,o.bar.h,{r:3,fill:o.bar.off})+H.rect(bar.bx,y-o.bar.dy,bar.bw*H.clamp(r.f.left/100),o.bar.h,{r:3,fill:low?o.low:o.bar.fill});
    out+=H.text(x+cw,y,r.pct,{size,fill:!bar&&low?o.low:o.ink,anchor:'end'});});
   return out;};
  const all=F.map((f,i)=>({f,name:names[i],pct:pct[i]}));
  for(let cols=1;cols<=(o.cols||1);cols++){
   const rows=Math.ceil(n/cols),sp=rows>1?Math.min(o.sp,(o.bottom-o.y)/(rows-1)):o.sp,cw=(o.w-(cols-1)*gap)/cols;
   if(rows>1&&sp<min/.66)continue;
   for(let size=Math.min(o.size,Math.floor(sp*.66));size>=min;size--){
    if(Math.max(...names.map(t=>tw(t,size)))+Math.max(...pct.map(t=>tw(t,size)))+8<=cw)return draw(all,cols,size,sp);}
  }
  // 줄임: 1열로 들어가는 줄 수만큼, 마지막 줄은 남은 개수
  const fit=Math.max(2,Math.floor((o.bottom-o.y)/(min/.66))+1),sp=(o.bottom-o.y)/(fit-1),size=Math.max(min,Math.min(o.size,Math.floor(sp*.66)));
  return draw([...all.slice(0,fit-1),{more:`+${n-fit+1} 계정`}],1,size,sp);
 }
 // 경고등 줄을 가운데 x에 맞춥니다
 const lampsAt=(H,cx,y,d,o={})=>{const gap=o.gap??40;return H.lamps(cx-1.5*gap,y,d,{...o,gap});};

 // ───────────────────────── 51 · Chevrolet Corvette C8
 O.theme({id:'51',name:'퍼포먼스 모드',about:'검은 후드 속 사다리꼴 파란 화면입니다. 가운데 둥근 판에 값만큼 차오르는 굵은 흰 호와 큰 숫자를 두고, 왼쪽 판에 기간·연료, 오른쪽 판에 소진 속도 표적을 같은 줄에 맞춰 놓았습니다.',draw(H,d){
  const ink='#eaf2fc',mute='#9db4d2',line='#2a4a74',acc='#ff8a2a',off='#13294a';
  let s=H.rect(0,0,1280,480,{fill:'#050506'});
  s+=H.housing('M64 28 Q640 -2 1216 28 L1252 448 Q640 476 28 448Z',{top:'#1e1f22',bottom:'#08090a',rim:.1});
  s+=H.path('M130 58 Q640 34 1150 58 L1188 418 Q640 442 92 418Z',{fill:H.lin('lip',[[0,'#000'],[1,'#141518']])});
  const SCR='M148 72 Q640 50 1132 72 L1168 404 Q640 426 112 404Z';
  s+=H.path(SCR,{fill:H.lin('scr',[[0,'#0e2d57'],[.55,'#081a36'],[1,'#040c1a']])});
  s+=H.path(SCR,{fill:H.lin('scrs',[[0,'#000',.45],[.1,'#000',0]])});
  s+=H.path(SCR,{stroke:'#4a78b0',sw:1,op:.35});
  // 판 가르는 선 (원본의 비스듬한 판 경계)
  s+=H.path('M476 96 L466 392',{stroke:line,sw:1.5})+H.path('M804 96 L814 392',{stroke:line,sw:1.5});
  const LX=186,LR=440,RX=840,RR=1094;
  // ── 왼쪽 판
  s+=H.gear((LX+LR)/2,116,d,{gap:40,width:LR-LX,size:14,on:ink,off:mute});
  s+=H.text(LX,170,d.clock,{size:38,fill:ink,anchor:'start',weight:300,font:'avenir'})+H.text(LR,170,d.periodLabel,{size:16,fill:ink,anchor:'end'});
  s+=H.line(LX,190,LR,190,{stroke:line});
  let fu=H.text(LX,218,'남은 주간 한도',{size:13,fill:mute,anchor:'start'});
  // 계정 줄: 250부터 아래 구분선(330) 위 318까지. 4개는 1열, 5개 이상은 2열
  fu+=fuelRows(H,d,{x:LX,w:LR-LX,y:250,bottom:318,sp:30,size:14,cols:2,gap:14,ink,mute,low:acc,bar:{x:256,w:130,h:6,dy:8,off,fill:ink}});
  s+=H.cl('gauge','fuel',fu);
  s+=H.line(LX,330,LR,330,{stroke:line});
  s+=H.text(LX,358,'누적',{size:13,fill:mute,anchor:'start'})+H.text(LR,358,H.fmt.odo(d.odo)+' M',{size:14,fill:ink,anchor:'end'});
  // ── 가운데 둥근 판 (바늘 없이 차오르는 호)
  const cx=640,cy=226,r=114,f=H.frac.rate(d),A0=-140,SW=280,RL=H.rateScale(d,10,{every:2});
  let g=H.circle(cx,cy,140,{fill:H.rad2('disc',[[0,'#0d2850'],[.8,'#081b38'],[1,'#030a18']])})+H.circle(cx,cy,140,{stroke:'#4a78b0',sw:1.5,op:.7});
  g+=H.arc(cx,cy,r,A0,A0+SW,{stroke:off,sw:18});
  g+=H.arc(cx,cy,r+14,A0+SW*.8,A0+SW,{stroke:acc,sw:3});
  g+=H.arc(cx,cy,r,A0,A0+SW*f,{stroke:'#f4f8ff',sw:18});
  g+=H.ticks(cx,cy,r-12,{a0:A0,sweep:SW,n:10,minor:1,len:7,mlen:4,w:2,mw:1,color:'#a6bddc'});
  g+=numsFit(H,cx,cy,r-19,RL,{dir:-1,a0:A0,sweep:SW,size:17,fill:ink,red:.8,redColor:acc,font:'avenir'});
  // 읽음 값이 네 자리(1000 이상)이면 안쪽 눈금 숫자 사이에 들어가도록 조금 작게 씁니다
  {const v=H.fmt.m(d.rate),dg=v.replace('.','').length;g+=H.text(cx,cy+16,v,{size:dg>=4&&!v.includes('.')?46:56,fill:'#fff',weight:300,font:'avenir'});}
  g+=H.text(cx,cy+42,'M tokens/시간',{size:13,fill:mute});
  g+=H.text(cx,cy+88,'토큰 속도',{size:14,fill:acc});
  s+=H.cl('gauge','rate',g);
  // ── 오른쪽 판: 소진 속도 표적
  s+=H.text(RR,120,'1top',{size:12,fill:mute,anchor:'end',weight:600});
  // 표적 바깥 원 = 최대값의 40% (기본 범위에서 8 %/시간)
  const gx=RX+64,gy=262,gr=58,tgt=d.burnMax*.4;
  g=H.text(RX,120,'소진 속도',{size:13,fill:mute,anchor:'start'});
  g+=H.text(RX,170,H.fmt.burn(d.burn),{size:38,fill:ink,anchor:'start',weight:300,font:'avenir'})+H.text(RR,170,'%/시간',{size:16,fill:mute,anchor:'end'});
  s+=H.line(RX,190,RR,190,{stroke:line});
  g+=H.circle(gx,gy,gr,{fill:'#06142a'})+H.circle(gx,gy,gr,{stroke:'#a6bddc',sw:1.5})+H.circle(gx,gy,gr/2,{stroke:line,sw:1});
  g+=H.line(gx-gr,gy,gx+gr,gy,{stroke:line})+H.line(gx,gy-gr,gx,gy+gr,{stroke:line});
  // 적정 속도를 모르면(null) 점선 원과 '적정' 글자를 숨깁니다
  const cr=d.cruise!=null&&isFinite(d.cruise);
  if(cr)g+=H.circle(gx,gy,gr*H.clamp(d.cruise/tgt),{stroke:mute,sw:1.5,dash:'3 3'});
  {const by=gy-gr*H.clamp(d.burn/tgt);g+=H.line(gx,gy,gx,by,{stroke:'#fff',sw:3,cap:'round'})+H.circle(gx,by,5.5,{fill:cr&&d.burn>d.cruise?acc:'#fff'});}
  if(cr)g+=H.text(RR,236,'적정',{size:13,fill:mute,anchor:'end'})+H.text(RR,260,d.cruise.toFixed(1)+' %/시간',{size:16,fill:ink,anchor:'end'});
  s+=H.cl('gauge','burn',g);
  s+=H.text(RR,290,'작업 가능',{size:13,fill:mute,anchor:'end'})+H.text(RR,314,H.fmt.hours(d.rangeH),{size:16,fill:ink,anchor:'end'});
  s+=H.line(RX,330,RR,330,{stroke:line});
  s+=H.cl('trip','',H.text(RX,358,'트립',{size:13,fill:mute,anchor:'start'})+H.text(RR,358,H.fmt.trip(d.trip)+' M',{size:14,fill:ink,anchor:'end'}));
  // ── 아래 줄 (하나의 기준선)
  const BY=388;
  s+=H.cl('gauge','heat',H.text(LX,BY,'엔진 온도',{size:13,fill:mute,anchor:'start'})+H.bars(256,BY-9,130,8,H.frac.heat(d),{n:20,gap:2,fill:ink,colors:[[.8,acc]],off})+H.text(LR,BY,Math.round(d.heat)+'°',{size:14,fill:ink,anchor:'end'}));
  s+=lampsAt(H,cx,BY-5,d,{size:17,gap:42,off:'#2a3f5e'});
  s+=H.cl('gauge','fuel',H.text(RX,BY,'남은 한도',{size:13,fill:mute,anchor:'start'})+H.bars(910,BY-9,130,8,H.frac.min(d),{n:20,gap:2,fill:ink,colors:[[0,acc],[.4,ink]],off})+H.text(RR,BY,Math.round(d.minLeft)+'%',{size:14,fill:ink,anchor:'end'}));
  return s;}});

 // ───────────────────────── 52 · Toyota Prius 2세대
 O.theme({id:'52',name:'센터 미터',about:'대시보드 맨 위 가운데의 넓은 미터 띠에 토큰 속도를 크게 띄우고, 그 아래 은빛 테두리 멀티정보 화면에 계정별 한도·작업 가능 시간·세션을 세 칸으로 나눠 넣었습니다.',draw(H,d){
  const cyan='#7ef3ff',ink='#e9f6ff',mute='#8fb3c4',dim='#0b252b',scrLine='#1d3d55';
  let s=H.rect(0,0,1280,480,{fill:'#0a0b0c'});
  s+=H.path('M0 204 Q640 188 1280 204 V480 H0Z',{fill:H.lin('dash',[[0,'#25272a'],[1,'#121315']])});
  // 미터 후드
  s+=H.housing('M72 26 Q640 4 1208 26 L1194 184 Q640 200 86 184Z',{top:'#2c2e32',bottom:'#141518',rim:.12});
  const W='M104 46 Q640 26 1176 46 L1164 166 Q640 182 116 166Z';
  s+=well(H,'mw',W,{top:'#000',bottom:'#05090b',shade:.7,depth:.2});
  // 세 칸 모두 같은 세 줄 기준선(라벨 84 · 내용 116 · 아래 154)에 맞춥니다
  const LC=278,RC=1002;
  s+=H.text(LC,84,'기간',{size:14,fill:mute});
  s+=H.gear(LC,116,d,{gap:40,width:300,size:15,on:cyan,off:'#4d7480'});
  s+=lampsAt(H,LC,150,d,{size:18,gap:44,off:'#1e2c30'});
  // 가운데: 토큰 속도 숫자 (미터 띠의 중심축)
  s+=H.cl('gauge','rate',H.seg(640,46,H.fmt.m(d.rate),82,{fill:cyan,gap:9,skew:0,anchor:'middle',dim})+H.text(640,154,'M tokens/시간',{size:14,fill:cyan}));
  // 오른쪽: 남은 한도 막대와 소진 속도
  s+=H.cl('gauge','fuel',H.text(RC,84,'남은 한도 '+Math.round(d.minLeft)+'%',{size:14,fill:mute})+H.text(RC-126,121,'E',{size:13,fill:mute,anchor:'start'})+H.bars(RC-104,108,208,16,H.frac.min(d),{n:12,gap:4,fill:cyan,off:dim,r:1})+H.text(RC+126,121,'F',{size:13,fill:mute,anchor:'end'}));
  s+=H.cl('gauge','burn',H.text(RC,154,'소진 '+H.fmt.burn(d.burn)+' %/시간',{size:15,fill:ink}));
  // 멀티정보 화면
  const x0=300,y0=222,w=680,h=230;
  s+=H.rect(x0-14,y0-14,w+28,h+28,{r:18,fill:H.lin('sil',[[0,'#d5d8dc'],[.45,'#8e9297'],[1,'#5c6065']]),filter:H.shadow('ss',5,10,.6)});
  s+=H.rect(x0-14,y0-14,w+28,h+28,{r:18,stroke:'#fff',sw:1,op:.35});
  s+=wellRect(H,'mfd',x0,y0,w,h,8,{top:'#07121d',bottom:'#0b1c2c',shade:.6,depth:.12,lip:false});
  const P=24,top=y0+30;
  s+=H.text(x0+P,top,d.periodLabel,{size:14,fill:mute,anchor:'start'})+H.cl('gauge','heat',H.text(x0+w/2,top,'엔진 온도 '+Math.round(d.heat)+'°',{size:14,fill:mute}))+H.text(x0+w-P,top,d.clock,{size:15,fill:ink,anchor:'end'});
  s+=H.line(x0+P,top+14,x0+w-P,top+14,{stroke:scrLine});
  const c1=x0+P,c2=x0+260,c3=x0+470,cE=x0+w-P,r0=top+44;
  s+=H.line(c2-16,top+28,c2-16,top+150,{stroke:scrLine})+H.line(c3-16,top+28,c3-16,top+150,{stroke:scrLine});
  let fu=H.text(c1,r0,'남은 주간 한도',{size:13,fill:mute,anchor:'start'});
  // 계정 줄: 아래 구분선(y0+h-44) 위까지. 넘치면 2열, 그래도 넘치면 앞쪽 몇 개와 '+N 계정'
  fu+=fuelRows(H,d,{x:c1,w:c2-34-c1,y:r0+34,bottom:y0+h-56,sp:32,size:14,cols:2,gap:12,ink,mute,low:'#f2b233',bar:{x:c1+66,w:96,h:7,dy:8,off:'#132c40',fill:cyan}});
  s+=H.cl('gauge','fuel',fu);
  const mid=(c2+c3-16)/2;
  s+=H.text(mid,r0,'작업 가능',{size:13,fill:mute})+H.text(mid,r0+50,H.fmt.hours(d.rangeH),{size:34,fill:ink,weight:300});
  if(d.cruise!=null&&isFinite(d.cruise))s+=H.text(mid,r0+98,'적정 '+d.cruise.toFixed(1)+' %/시간',{size:13,fill:mute});
  s+=H.text(c3,r0,'세션',{size:13,fill:mute,anchor:'start'});
  [['작업',d.sessions.working,cyan],['대기',d.sessions.waiting,'#f2b233'],['쉼',d.sessions.idle,'#55707c']].forEach(([k,n,c],i)=>{const y=r0+34+i*32;s+=H.circle(c3+5,y-5,4.5,{fill:c})+H.text(c3+18,y,k,{size:14,fill:ink,anchor:'start'})+H.text(cE,y,String(n),{size:14,fill:ink,anchor:'end'});});
  s+=H.line(x0+P,y0+h-44,x0+w-P,y0+h-44,{stroke:scrLine});
  const by=y0+h-18;
  s+=H.cl('trip','',H.text(c1,by,'트립 '+H.fmt.trip(d.trip)+' M',{size:13,fill:mute,anchor:'start'}))+H.text(mid,by,'누적 '+H.fmt.odo(d.odo)+' M',{size:13,fill:mute})+H.text(cE,by,'1top',{size:12,fill:mute,anchor:'end',weight:600});
  return s;}});

 // ───────────────────────── 53 · Honda Civic 8세대
 O.theme({id:'53',name:'2단 미터',about:'위층 차양 안에 파란 디지털 숫자와 양쪽 호 막대를, 아래층 굴 안에 토큰 속도 회전계와 좌우 정보 칸을 두는 2단 구성입니다.',draw(H,d){
  const blue='#4f9bff',lit='#78b4ff',gl=H.glow('g',1.6),ink='#e2ebff',mute='#86a2d0',off='#0f1a33';
  let s=H.rect(0,0,1280,480,{fill:'#0c0d0f'});
  // 위층 차양
  s+=H.housing('M96 14 Q640 -4 1184 14 L1160 172 Q640 190 120 172Z',{top:'#383b40',bottom:'#1a1c1f',rim:.12});
  s+=well(H,'uw','M128 32 Q640 16 1152 32 L1134 156 Q640 172 146 156Z',{top:'#000',bottom:'#04060d',shade:.7,depth:.22});
  const LB=144;
  s+=H.cl('gauge','rate',H.seg(640,40,H.fmt.m(d.rate),62,{fill:lit,gap:8,filter:gl,anchor:'middle',dim:'#0b1530'})+H.text(640,LB,'토큰 속도 · M tokens/시간',{size:14,fill:lit}));
  const arcBar=(x0,dir,frac)=>{let o='';const n=12;for(let i=0;i<n;i++){const t=i/(n-1),x=x0+dir*t*250,y=112-Math.sin(t*Math.PI*.5)*48;o+=H.rect(x-8,y-5,16,10,{fill:i<Math.round(frac*n)?blue:off,r:1.5});}return o;};
  s+=H.cl('gauge','heat',H.g(arcBar(214,1,H.frac.heat(d)),{filter:gl})+H.text(190,118,'C',{size:14,fill:blue})+H.text(490,70,'H',{size:14,fill:'#ff6a5a'})+H.text(339,LB,'엔진 온도',{size:13,fill:mute}));
  s+=H.cl('gauge','fuel',H.g(arcBar(1066,-1,H.frac.min(d)),{filter:gl})+H.text(1090,118,'E',{size:14,fill:'#ff6a5a'})+H.text(790,70,'F',{size:14,fill:blue})+H.text(941,LB,'남은 한도',{size:13,fill:mute}));
  // 아래층 굴
  s+=H.housing('M176 196 Q640 176 1104 196 L1084 470 H196Z',{top:'#2e3136',bottom:'#141619'});
  s+=well(H,'lw','M204 214 Q640 196 1076 214 L1060 452 H220Z',{top:'#050608',bottom:'#0d0f12',shade:.6,depth:.12});
  const cx=640,cy=334,r=104,a=-135+270*H.frac.rate(d),RL=H.rateScale(d,10,{every:2}),te=r-36-ext(RL,14,3);
  let g=H.bezel(cx,cy,r,10,{tone:'satin'})+H.face(cx,cy,r,{fill:'#0b1846',center:'#13246a',edge:'#050a22'});
  g+=numsFit(H,cx,cy,te,RL,{a0:-135,sweep:270,size:14,fill:ink,red:.8,redColor:'#ff5a4a'});
  g+=H.ticks(cx,cy,te,{a0:-135,sweep:270,n:10,minor:1,len:8,mlen:5,w:2.2,mw:1.2,color:'#cfe0ff',red:.8,redColor:'#ff4a3a'});
  g+=H.arc(cx,cy,te-12,-135,a,{stroke:blue,sw:3,op:.75});
  g+=H.rect(cx-38,cy+42,76,22,{r:3,fill:'#081a4a'})+H.text(cx,cy+58,H.fmt.odo(d.odo,6),{size:14,fill:'#a8d2ff',font:'din',ls:1});
  g+=H.text(cx,cy+80,'누적 M',{size:12,fill:mute});
  g+=H.needle(cx,cy,te-8,a,{style:'taper',w:5,color:'#eef3fb',tail:10})+H.hub(cx,cy,9,{fill:'#c9ced6',light:'#f4f6f8'});
  g+=H.glass(cx,cy,r);
  s+=H.cl('gauge','rate',g);
  // 좌우 칸 (같은 줄에 맞춤)
  const pod=(x)=>wellRect(H,'pd'+x,x-120,240,240,196,12,{top:'#020306',bottom:'#080b10',shade:.5,depth:.1,lip:false});
  const LP=370,RP=910,y1=268,y2=312,y3=362,y4=412;
  s+=pod(LP)+pod(RP);
  g=H.text(LP,y1,'소진 속도',{size:13,fill:mute});
  g+=H.text(LP+6,y2,H.fmt.burn(d.burn),{size:32,fill:ink,anchor:'end',font:'din'})+H.text(LP+14,y2,'%/시간',{size:14,fill:mute,anchor:'start'});
  g+=H.g(H.bars(LP-90,y2+16,180,10,H.frac.burn(d),{n:15,gap:3,fill:blue,colors:[[.7,'#ff5a4a']],off,r:1}),{filter:gl});
  if(d.cruise!=null&&isFinite(d.cruise)){const mx=LP-90+180*H.clamp(d.cruise/d.burnMax);g+=H.path(`M${mx} ${y2+30}l-5 7h10Z`,{fill:mute});
   g+=H.text(LP,y3+6,'적정 '+d.cruise.toFixed(1),{size:13,fill:mute});}
  s+=H.cl('gauge','burn',g);
  s+=lampsAt(H,LP,y4-5,d,{size:18,gap:42,off:'#1c2436'});
  s+=H.text(RP,y1,'기간',{size:13,fill:mute});
  // 기어 격자: 칸 안 216px 폭에 열 수만큼 나눠 넣고, 줄 수에 맞춰 위아래 가운데
  const GG=gearGrid(d.gears.length);
  d.gears.forEach((g,i)=>{const on=g===d.period,q=GG[i],sp=Math.min(60,216/q.cols),bw=Math.min(48,sp-6),x=RP+q.col*sp,y=y2-14+q.row*34+(2-q.rows)*17;let o='';
   if(on)o+=H.rect(x-bw/2,y-13,bw,26,{r:4,fill:'#16357a'})+H.rect(x-bw/2,y-13,bw,26,{r:4,stroke:blue,sw:1});
   o+=H.text(x,y,g,{size:on?15:14,fill:on?'#fff':'#7d8cab',weight:on?700:400,base:'central',font:'din'});
   s+=H.cl('period',g,o);});
  s+=H.text(RP-10,y3+6,d.periodLabel,{size:13,fill:mute,anchor:'end'});
  s+=H.cl('trip','',H.text(RP+10,y3+6,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:mute,anchor:'start'}));
  s+=H.text(RP,y4,'작업 가능 '+H.fmt.hours(d.rangeH),{size:14,fill:ink});
  s+=H.text(1118,LB,'1top',{size:12,fill:'#5d6575',weight:600,anchor:'end'});
  return s;}});

 // ───────────────────────── 54 · Lexus IS 300 1세대
 O.theme({id:'54',name:'크로노그래프',about:'은빛 큰 원 안에 작은 원 세 개를 넣은 크로노그래프입니다. 긴 빨간 바늘이 돋은 작은 원 아래로 지나 주황 고리를 가리키고, 양쪽 원 계기는 가운데 원 뒤로 들어갑니다.',draw(H,d){
  const wh='#eef0f2',org='#e9a23a',red='#e8302a',mute='#a9adb2',fn='helv';
  let s=H.rect(0,0,1280,480,{fill:'#111213'});
  const notC=H.clip('nc',`<path clip-rule="evenodd" d="M0 0H1280V480H0Z M418 240a222 222 0 1 0 444 0a222 222 0 1 0 -444 0Z"/>`);
  let bg=H.housing('M36 104 Q640 -36 1244 104 L1244 468 H36Z',{top:'#2b2d30',bottom:'#0f1011',rim:.1});
  bg+=well(H,'rc','M60 122 Q640 -6 1220 122 L1220 448 H60Z',{top:'#060607',bottom:'#141517',shade:.6,depth:.12});
  // 양쪽 원 (가운데 원 뒤)
  const side=(x,y)=>H.circle(x,y+3,154,{fill:'#000',op:.5,filter:H.shadow('ds'+x,2,6,.6)})+H.face(x,y,152,{fill:'#141518',center:'#18191c',edge:'#060607'})+H.circle(x,y,152,{stroke:'#3c3f43',sw:2});
  const lx=300,ly=250,rx=980,ry=250;
  s+=H.g(bg+side(lx,ly)+side(rx,ry),{clip:notC});
  // 왼쪽: 소진 속도
  const BL=H.burnScale(d,10,{every:2}),be=118-ext(BL,19,2);
  s+=H.cl('gauge','burn',H.band(lx,ly,be-14,be,-140+180*.8,40,{fill:'#c82822'})
   +H.ticks(lx,ly,be,{a0:-140,sweep:180,n:10,minor:1,len:14,mlen:7,w:3,mw:1.5,color:wh})
   +H.nums(lx,ly,136,BL,{a0:-140,sweep:180,size:19,fill:wh,font:fn})
   +H.text(lx,ly+60,H.fmt.burn(d.burn),{size:28,fill:wh,font:fn,weight:300})+H.text(lx,ly+84,'소진 속도 %/시간',{size:13,fill:mute})
   +H.needle(lx,ly,be-14,-140+180*H.frac.burn(d),{style:'taper',w:6,color:red,tail:12})+H.hub(lx,ly,13));
  // 오른쪽: 남은 한도
  {const [fx,fy]=H.pt(rx,ry,138,30),[ex,ey]=H.pt(rx,ry,138,150);
   s+=H.cl('gauge','fuel',H.ticks(rx,ry,120,{a0:30,sweep:120,n:4,minor:3,len:14,mlen:7,w:3,mw:1.5,color:wh})
    +H.text(fx,fy,'F',{size:19,fill:wh,base:'central',font:fn})+H.text(ex,ey,'E',{size:19,fill:'#ff5a4a',base:'central',font:fn})
    +H.text(918,238,Math.round(d.minLeft)+'%',{size:28,fill:wh,font:fn,weight:300})+H.text(918,262,'남은 한도',{size:13,fill:mute})
    +H.needle(rx,ry,106,150-120*H.frac.min(d),{style:'taper',w:5,color:red,tail:10})+H.hub(rx,ry,11));}
  s+=H.rect(878,318,132,28,{r:3,fill:'#3a4034'})+H.rect(878,318,132,28,{r:3,stroke:'#000',sw:1.5})+H.text(944,337,'작업 가능 '+H.fmt.hours(d.rangeH),{size:13,fill:'#dfe6cf'});
  s+=H.cl('trip','',H.text(944,378,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:mute}));
  // 아래 줄
  const BY=432;
  s+=H.gear(lx,BY-5,d,{gap:34,width:300,size:14,on:wh,off:'#80848a'});
  s+=lampsAt(H,rx,BY-5,d,{size:17,gap:38,off:'#34373b'});
  s+=H.text(1204,BY,'1top',{size:12,fill:'#6e7276',weight:600,anchor:'end'});
  // 가운데 크로노그래프
  const cx=640,cy=240;
  let g=H.bezel(cx,cy,214,10,{tone:'satin',inner:'#4a4d50'});
  g+=H.circle(cx,cy,214,{fill:H.rad2('bz',[[.72,'#64676a'],[.9,'#4a4d50'],[1,'#36383a']])});
  g+=H.ticks(cx,cy,210,{a0:-135,sweep:270,n:10,minor:1,dots:true,len:0,mlen:0,dot:4,mdot:2.4,color:wh});
  g+=H.nums(cx,cy,188,H.rateScale(d,10),{a0:-135,sweep:270,size:22,fill:wh,font:fn,upright:false});
  g+=H.circle(cx,cy,166,{fill:'#262829'})+H.circle(cx,cy,166,{stroke:'#121314',sw:2});
  g+=H.ticks(cx,cy,162,{a0:-135,sweep:270,n:20,minor:1,len:12,mlen:6,w:2.4,mw:1.2,color:org});
  g+=H.text(cx,cy+156,'토큰 속도 · M tokens/시간',{size:13,fill:org});
  g+=H.circle(cx,cy,144,{fill:H.rad2('sil',[[0,'#eeefef'],[.75,'#cbcdcf'],[1,'#8e9193']])});
  g+=H.circle(cx,cy,144,{stroke:'#000',sw:1.5,op:.5});
  g+=H.ticks(cx,cy,144,{a0:0,sweep:360,n:60,minor:0,len:5,w:1,color:'#6a6d70'});
  const sub=(x,y,f,lab)=>{let o=H.circle(x,y+1.5,44,{fill:'#000',op:.35})+H.circle(x,y,44,{fill:H.rad2('sb'+x+y,[[0,'#55585b'],[1,'#3e4144']])})+H.circle(x,y,44,{stroke:'#25272a',sw:2});
   o+=H.ticks(x,y,40,{a0:-120,sweep:240,n:4,minor:1,len:7,mlen:4,w:2,mw:1.2,color:wh});
   o+=H.text(x,y+28,lab,{size:13,fill:wh});
   o+=H.needle(x,y,33,-120+240*f,{style:'line',w:2.5,color:'#fff',tail:5,shadow:false})+H.circle(x,y,4,{fill:'#111'});return o;};
  // 긴 빨간 바늘: 은빛 판 위를 지나 주황 눈금 안쪽 끝까지. 작은 원(돋은 판) 아래로 들어가 그 안의 이름(CPU·메모리·온도)을 가로지르지 않습니다
  const SUBS=[[cx,cy-74],[cx+76,cy+4],[cx,cy+80]];
  const notSub=H.clip('ns',`<path clip-rule="evenodd" d="M0 0H1280V480H0Z ${SUBS.map(([x,y])=>`M${x-46} ${y}a46 46 0 1 0 92 0a46 46 0 1 0 -92 0Z`).join(' ')}"/>`);
  g+=H.g(H.needle(cx,cy,150,-135+270*H.frac.rate(d),{style:'taper',w:6,color:red,tail:26}),{clip:notSub});
  // 작은 원 셋은 큰 바늘이 지나가는 토큰 속도 묶음 안에 있어 따로 계기 표시를 붙이지 않습니다
  g+=sub(...SUBS[0],H.frac.cpu(d),'CPU');
  g+=sub(...SUBS[1],H.frac.mem(d),'메모리');
  g+=sub(...SUBS[2],H.frac.heat(d),'온도');
  g+=H.hub(cx,cy,13,{fill:'#1c1d1f',light:'#55585c'})+H.circle(cx,cy,4,{fill:red});
  s+=H.cl('gauge','rate',g);
  return s;}});

 // ───────────────────────── 55 · Lexus LS 400 1세대
 O.theme({id:'55',name:'블랙 발광',about:'검은 판 위에 하얗게 떠오르는 숫자와 바늘입니다. 숫자는 눈금 바깥에 두고, 가운데 세로 변속 표시를 기간 기어로 바꿨습니다.',draw(H,d){
  const gl=H.glow('g',2),wh='#f4f6ff',mute='#aab2c8',fn='helv';
  let s=H.rect(0,0,1280,480,{fill:'#0b0a09'});
  s+=H.housing('M36 82 Q640 38 1244 82 L1226 452 H54Z',{top:'#24211e',bottom:'#0b0a09',rim:.14});
  s+=well(H,'w','M66 104 Q640 64 1214 104 L1198 432 H82Z',{top:'#020203',bottom:'#08080a',shade:.8,depth:.16});
  const dial=(cx,cy,labels,f,l1,l2,red)=>{const a=-135+270*f;
   let o=H.ticks(cx,cy,130,{a0:-135,sweep:270,n:labels.length-1,minor:4,len:16,mlen:8,w:3.5,mw:2,color:wh,red,redColor:'#ff3528'});
   o+=numsFit(H,cx,cy,130,labels,{a0:-135,sweep:270,size:26,fill:wh,font:fn,red,redColor:'#ff4030'});
   o+=H.text(cx,cy+82,l1,{size:14,fill:mute})+H.text(cx,cy+102,l2,{size:13,fill:mute});
   return H.g(o,{filter:gl})+H.needle(cx,cy,114,a,{style:'taper',w:6,color:'#f6f8ff',shadow:false,glow:gl,tail:14})+H.hub(cx,cy,13,{fill:'#0d0d0e',light:'#2c2c2e'});};
  const CY=262;
  s+=H.cl('gauge','rate',dial(380,CY,H.rateScale(d,10,{every:2}),H.frac.rate(d),'토큰 속도','M tokens/시간',.8));
  // 트립: 바늘이 가지 않는 토큰 속도계 아래 틈
  s+=H.cl('trip','',H.text(380,CY+124,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:mute,filter:gl}));
  // 적정 눈금 표시: 적정 속도를 모르면(null) 숨깁니다
  {const cr=d.cruise!=null&&isFinite(d.cruise),a=-135+270*H.clamp((d.cruise||0)/d.burnMax),[x1,y1]=H.pt(900,CY,131,a),[x2,y2]=H.pt(900,CY,140,a);
   s+=H.cl('gauge','burn',dial(900,CY,H.burnScale(d,10,{every:2}),H.frac.burn(d),'소진 속도','%/시간')+(cr?H.line(x1,y1,x2,y2,{stroke:'#4be3a0',sw:4,filter:gl}):''));}
  // 가운데 축: 1top → 세로 기어 → 주행계 → 경고등
  s+=H.text(640,132,'1top',{size:12,fill:'#6f7488',weight:600});
  // 세로 기어: 162–318 안에 들어가게 간격을 줄이고, 개수가 적으면 같은 자리 가운데로 모읍니다
  {const n=d.gears.length,sp=n>1?Math.min(28,156/(n-1)):0,y0=162+Math.max(0,(140-(n-1)*sp)/2);
   d.gears.forEach((g,i)=>{const on=g===d.period,y=y0+i*sp;s+=H.cl('period',g,on?H.rect(616,y-12,48,24,{r:3,fill:wh,filter:gl})+H.text(640,y+5,g,{size:14,fill:'#111',weight:700}):H.text(640,y+5,g,{size:14,fill:'#8f96ac'}));});}
  s+=H.rect(584,338,112,26,{r:3,fill:'#121214',stroke:'#2a2a2e'})+H.text(640,356,H.fmt.odo(d.odo,6)+' M',{size:15,fill:'#e8e8ee',font:fn,ls:1});
  s+=lampsAt(H,640,396,d,{size:17,gap:34,off:'#24262c'});
  // 양끝 반쪽 계기
  const half=(cx,cy,f,l0,l1,side)=>{let o=H.ticks(cx,cy,84,{a0:side*30,sweep:side*110,n:4,minor:1,len:12,mlen:6,w:3,color:wh});
   const [ax,ay]=H.pt(cx,cy,100,side*22),[bx,by]=H.pt(cx,cy,100,side*148);
   o+=H.text(ax,ay,l1,{size:16,fill:wh,base:'central',font:fn})+H.text(bx,by,l0,{size:16,fill:wh,base:'central',font:fn});
   return H.g(o,{filter:gl})+H.needle(cx,cy,72,side*(140-110*f),{style:'taper',w:4.5,color:wh,shadow:false,tail:0,glow:gl});};
  const BY=404;
  s+=H.cl('gauge','heat',half(150,CY,H.frac.heat(d),'C','H',-1)+H.text(150,BY-20,'엔진 온도',{size:14,fill:mute,filter:gl})+H.text(150,BY,Math.round(d.heat)+'°',{size:13,fill:wh,filter:gl}));
  s+=H.cl('gauge','fuel',half(1130,CY,H.frac.min(d),'E','F',1)+H.text(1130,BY-20,'남은 한도',{size:14,fill:mute,filter:gl})+H.text(1130,BY,'작업 가능 '+H.fmt.hours(d.rangeH),{size:13,fill:wh,filter:gl}));
  return s;}});

 // ───────────────────────── 56 · Bugatti Tourbillon
 O.theme({id:'56',name:'스켈레톤 무브먼트',about:'깎아 낸 은빛 금속 다리 위에 해골 다이얼을 세웠습니다. 가운데 큰 원은 토큰 속도, 왼쪽 세 작은 원은 소진·한도·온도, 오른쪽 원은 CPU이고, 다리 아래 홈에 기간·경고등을 새겼습니다.',draw(H,d){
  const wh='#f2f4f6',mute='#b8c0c8',fn='helv';
  const metal=H.lin('m',[[0,'#f2f4f6'],[.22,'#aeb5bc'],[.5,'#e6eaee'],[.8,'#727a82'],[1,'#b9c0c6']],{dir:[0,0,.35,1]});
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#2a3c45'],[1,'#0d1418']])});
  const BR='M70 262 Q76 114 266 102 L462 50 Q640 6 818 50 L1014 102 Q1204 114 1210 262 L1210 386 Q1206 462 1120 462 L160 462 Q74 462 70 386Z';
  s+=H.path(BR,{fill:metal,filter:H.shadow('sh',8,14,.6)});
  s+=H.path('M70 262 Q76 114 266 102 L462 50 Q640 6 818 50 L1014 102 Q1204 114 1210 262',{stroke:'#fff',sw:1.5,op:.55});
  s+=H.path('M1210 386 Q1206 462 1120 462 L160 462 Q74 462 70 386',{stroke:'#000',sw:1.5,op:.3});
  // 아래 홈: 기간 · 경고등 · 작업 가능
  s+=wellRect(H,'gr',150,408,980,40,20,{top:'#06080a',bottom:'#151a1f',shade:.7,depth:.3,lip:.35});
  const BY=433;
  s+=H.text(176,BY,'작업 가능 '+H.fmt.hours(d.rangeH),{size:14,fill:'#e8ecf0',anchor:'start'});
  s+=H.cl('trip','',H.text(318,BY,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#b8c0c8',anchor:'start'}));
  s+=H.gear(640,BY-5,d,{gap:42,width:340,size:14,on:'#fff',off:'#8995a0'});
  s+=lampsAt(H,960,BY-5,d,{size:17,gap:38,off:'#2d353c'});
  s+=H.text(1104,BY,'1top',{size:12,fill:'#8995a0',weight:600,anchor:'end'});
  // 가운데 큰 원
  const cx=640,cy=214,r=170,a=-140+280*H.frac.rate(d);
  let g=H.bezel(cx,cy,r,12,{tone:'chrome',inner:'#16191d'});
  g+=H.circle(cx,cy,r,{fill:H.lin('rg',[[0,'#3c434a'],[1,'#1b2025']])});
  // 돌려 쓴 숫자라 네 자리(1000)도 고리 안에 들어갑니다. 네 자리일 때만 1px 안쪽으로 당겨 테두리 선과 띄웁니다
  {const RL=H.rateScale(d,10);g+=H.nums(cx,cy,r-16-(RL.some(t=>t.length>3)?1:0),RL,{a0:-140,sweep:280,size:17,fill:wh,font:fn,upright:false});}
  g+=H.ticks(cx,cy,r-30,{a0:-140,sweep:280,n:10,minor:4,len:12,mlen:6,w:2.2,mw:1.2,color:wh});
  g+=H.band(cx,cy,r-46,r-42,-140+280*.85,140,{fill:'#c8202a'});
  g+=H.circle(cx,cy,r-47,{stroke:'#9aa2aa',sw:2});
  g+=H.circle(cx,cy,r-50,{fill:H.rad2('dk',[[0,'#2a3037'],[1,'#0b0d10']])});
  for(const k of [45,135,225,315]){const [x,y]=H.pt(cx,cy,r-54,k);g+=H.line(cx,cy,x,y,{stroke:'#2e353c',sw:12,cap:'round'})+H.line(cx,cy,x,y,{stroke:'#4c555e',sw:2,cap:'round'});}
  const cog=(x,y,rr,n)=>{let o=H.circle(x,y,rr,{stroke:'#59626b',sw:2.5});for(let i=0;i<n;i++){const [p,q]=H.pt(x,y,rr,i*360/n),[u,v]=H.pt(x,y,rr+4,i*360/n);o+=H.line(p,q,u,v,{stroke:'#59626b',sw:2.5});}return o+H.circle(x,y,3,{fill:'#a0283c'});};
  g+=cog(cx-50,cy-36,28,18)+cog(cx+46,cy-44,17,11)+cog(cx+54,cy+14,20,13);
  g+=H.rect(cx-56,cy+56,112,36,{r:6,fill:'#07080a',stroke:'#7a828a',sw:1.5})+H.text(cx,cy+82,H.fmt.m(d.rate),{size:26,fill:'#fff',font:fn,weight:300});
  g+=H.text(cx,cy+110,'M tokens/시간',{size:13,fill:mute});
  g+=H.needle(cx,cy,r-42,a,{style:'lance',w:9,color:wh,tail:12})+H.hub(cx,cy,13,{fill:'#9aa2aa',light:'#f4f6f8'});
  g+=H.glass(cx,cy,r,{op:.06});
  s+=H.cl('gauge','rate',g);
  // 왼쪽 세 원 묶음
  const lx=268,ly=250;
  s+=H.bezel(lx,ly,130,9,{tone:'chrome',inner:'#121519'})+H.face(lx,ly,130,{fill:'#161a1f',edge:'#090b0d'});
  const sub=(x,y,f,lab,l0,l1,red)=>{let o=H.bezel(x,y,48,5,{tone:'satin',shadow:false})+H.face(x,y,48,{fill:'#1c2126',edge:'#0b0d10'});
   o+=H.ticks(x,y,45,{a0:-120,sweep:240,n:4,minor:1,len:7,mlen:4,w:2,mw:1.2,color:wh,red,redColor:'#ff3a3a'});
   // 끝 글자(0·E·C …)는 바늘이 가는 -120°~120° 밖, 아래 빈 구역(±146°)에 둡니다. 쉬는 중(0)에도 바늘과 닿지 않습니다
   const [ax,ay]=H.pt(x,y,27,-146),[bx,by]=H.pt(x,y,27,146);
   o+=H.text(ax,ay,l0,{size:12,fill:wh,base:'central',font:fn})+H.text(bx,by,l1,{size:12,fill:red!=null?'#ff5050':wh,base:'central',font:fn});
   o+=H.text(x,y+40,lab,{size:13,fill:mute});
   o+=H.needle(x,y,38,-120+240*f,{style:'baton',w:3,color:wh,tail:5,shadow:false})+H.hub(x,y,4.5,{fill:'#c6ccd2',light:'#fff'});
   return o;};
  {const BE=H.burnScale(d,5);
   s+=H.cl('gauge','burn',sub(lx-54,ly-44,H.frac.burn(d),'소진',BE[0],BE[5],.8));}
  s+=H.cl('gauge','fuel',sub(lx+54,ly-44,H.frac.min(d),'한도','E','F'));
  s+=H.cl('gauge','heat',sub(lx,ly+56,H.frac.heat(d),'온도','C','H',.8));
  // 오른쪽 원: CPU
  const rx=1012,ry=250,rr=124;
  s+=H.bezel(rx,ry,rr,9,{tone:'chrome',inner:'#121519'})+H.face(rx,ry,rr,{fill:'#1c2126',edge:'#0b0d10'});
  s+=H.nums(rx,ry,rr-17,['0','20','40','60','80','100'],{a0:-140,sweep:280,size:15,fill:wh,font:fn});
  s+=H.ticks(rx,ry,rr-32,{a0:-140,sweep:280,n:5,minor:3,len:11,mlen:5,w:2.2,mw:1.2,color:wh});
  s+=H.text(rx,ry+60,'CPU %',{size:14,fill:mute});
  s+=H.needle(rx,ry,rr-43,-140+280*H.frac.cpu(d),{style:'baton',w:4,color:wh,tail:8})+H.hub(rx,ry,8,{fill:'#c6ccd2',light:'#fff'});
  s+=H.glass(rx,ry,rr,{op:.05})+H.glass(lx,ly,130,{op:.05});
  return s;}});

 // ───────────────────────── 57 · Audi quattro 초기형
 O.theme({id:'57',name:'각진 랠리',about:'곧은 갈색 하우징 속 검은 면에 촘촘한 흰 눈금의 두 원을 두고, 가운데 기둥에 세로 눈금 계기 둘과 같은 크기의 경고등 칸 셋을 쌓았습니다. 오른쪽 원 아래에는 작은 시계가 있습니다.',draw(H,d){
  const wh='#f2f2ee',mute='#a9a9a2',fn='helv';
  let s=H.rect(0,0,1280,480,{fill:'#171210'});
  s+=H.housing('M28 24 H1252 V456 H28Z',{top:'#56443a',bottom:'#2a201b',rim:.16});
  s+=H.path('M28 24 H1252',{stroke:'#fff',sw:1.5,op:.12});
  s+=wellRect(H,'face',62,52,1156,376,8,{top:'#030303',bottom:'#0b0b0b',shade:.75,depth:.1,lip:.1});
  const cy=246;
  // te: 눈금 바깥 끝. 숫자가 기본(3자리)보다 길면 그만큼 안쪽으로 옮깁니다
  const dial=(cx,labels,te,red)=>{let o=H.ticks(cx,cy,te,{a0:-140,sweep:280,n:labels.length-1,minor:4,len:16,mlen:9,w:3.5,mw:2,color:wh});
   o+=numsFit(H,cx,cy,te,labels,{a0:-140,sweep:280,size:20,fill:wh,font:fn,weight:500});
   if(red!=null){for(let i=0;i<6;i++){const a0=-140+280*(red+(1-red)*i/6);o+=H.band(cx,cy,te-14,te,a0,a0+280*(1-red)/6-1.2,{fill:i%2?'#c82a24':'#6e1410'});}}
   return o;};
  const L=354,Rx=926;
  // 왼쪽: 토큰 속도 + 주행계
  const RL=H.rateScale(d,10),BL=H.burnScale(d,10,{every:2}),teR=150-ext(RL,20,3),teB=150-ext(BL,20,2);
  s+=H.cl('gauge','rate',dial(L,RL,teR,null)+H.odo(L-51,cy+46,H.fmt.odo(d.odo,6),{cw:17,ch:22,bg:'#0b0b0b',fg:wh,frame:'#000',font:fn})
   +H.text(L,cy+124,'토큰 속도 · M tokens/시간',{size:13,fill:mute})
   +H.needle(L,cy,teR-16,-140+280*H.frac.rate(d),{style:'taper',w:5,color:wh,tail:12})+H.hub(L,cy,11));
  s+=H.cl('trip','',H.text(L,cy+94,'트립 '+H.fmt.trip(d.trip)+' M',{size:13,fill:wh}));
  // 오른쪽: 소진 속도 + 시계
  const kx=Rx,ky=cy+68;s+=H.circle(kx,ky,30,{fill:'#0d0d0d',stroke:'#2e2e2e',sw:1.5})+H.ticks(kx,ky,28,{a0:0,sweep:360,n:12,minor:0,len:6,w:2,color:wh});
  const [hh,mm]=d.clock.split(':').map(Number);s+=H.needle(kx,ky,15,(hh%12+mm/60)*30,{style:'line',w:3,color:wh,tail:0,shadow:false})+H.needle(kx,ky,23,mm*6,{style:'line',w:1.8,color:'#d03030',tail:0,shadow:false})+H.circle(kx,ky,2.5,{fill:wh});
  s+=H.cl('gauge','burn',dial(Rx,BL,teB,.8)+H.text(Rx,cy+124,'소진 속도 · %/시간',{size:13,fill:mute})
   +H.needle(Rx,cy,teB-16,-140+280*H.frac.burn(d),{style:'taper',w:5,color:wh,tail:12})+H.hub(Rx,cy,11));
  // 가운데 기둥
  const C=640,CL=556,CR=724;
  s+=H.line(CL-8,72,CL-8,408,{stroke:'#1c1c1c',sw:2})+H.line(CR+8,72,CR+8,408,{stroke:'#1c1c1c',sw:2});
  const vgauge=(x,f,lab,top,bot)=>{let o='';for(let i=0;i<=8;i++){const y=104+i*14,w=12+(8-i)*3;o+=H.rect(x-w,y,w,i<2?6:3,{fill:i<2?'#c82a24':wh});}
   const ny=218-112*f;o+=H.path(`M${x+4} ${ny} l12 -6 v12Z`,{fill:wh});
   o+=H.text(x-18,92,top,{size:13,fill:wh,font:fn})+H.text(x-18,240,bot,{size:13,fill:wh,font:fn})+H.text(x-18,262,lab,{size:13,fill:mute});return o;};
  s+=H.cl('gauge','heat',vgauge(608,H.frac.heat(d),'온도','H','C'))+H.cl('gauge','fuel',vgauge(704,H.frac.min(d),'한도','F','E'));
  const slot=(y)=>wellRect(H,'sl'+y,CL,y,CR-CL,32,3,{top:'#050505',bottom:'#141414',shade:.6,depth:.3,lip:.06});
  const S1=282,S2=322,S3=362;
  s+=slot(S1)+slot(S2)+slot(S3);
  s+=lampsAt(H,C,S1+16,d,{size:17,gap:38,off:'#2c2c2c'});
  s+=gearFit(H,C,S2+16,d,{gap:27,width:CR-CL-12,size:13,on:'#fff',off:'#8a8a84'});
  s+=H.text(C,S3+21,'작업 가능 '+H.fmt.hours(d.rangeH),{size:13,fill:'#d4d4cc'});
  s+=H.text(C,416,'1top',{size:12,fill:'#6a6a64',weight:600});
  return s;}});

 // ───────────────────────── 58 · Lancia Delta Integrale
 O.theme({id:'58',name:'랠리 옐로',about:'검은 사각 패널 양끝에 노란 눈금의 큰 원 둘을 두었습니다. 왼쪽은 9시, 오른쪽은 3시에서 시작합니다. 가운데에는 작은 노란 원 넷과 경고등·계정 단추 두 묶음을 대칭으로 모았습니다.',draw(H,d){
  const Y='#f2b51e',Ym='#c9a04a',fn='helv';
  let s=H.rect(0,0,1280,480,{fill:'#0c0c0c'});
  s+=H.housing('M36 28 H1244 V452 H36Z',{top:'#303031',bottom:'#141415',rim:.12});
  s+=wellRect(H,'pn',62,52,1156,376,8,{top:'#0b0b0c',bottom:'#18191a',shade:.7,depth:.12,lip:.08});
  // te: 눈금 바깥 끝. 숫자가 기본보다 길면(0.4, 1000) 늘어난 반폭만큼 안쪽으로 옮깁니다
  const big=(cx,cy,labels,a0,sw,te)=>{let o=H.bezel(cx,cy,156,7,{tone:'black'})+H.face(cx,cy,156,{fill:'#101011',edge:'#060606'});
   o+=H.line(cx-110,cy,cx+110,cy,{stroke:Y,sw:1,op:.3})+H.line(cx,cy-110,cx,cy+110,{stroke:Y,sw:1,op:.3});
   o+=H.ticks(cx,cy,te,{a0,sweep:sw,n:labels.length-1,minor:1,len:13,mlen:7,w:2.6,mw:1.4,color:Y});
   o+=H.nums(cx,cy,138,labels,{a0,sweep:sw,size:16,fill:Y,font:fn,weight:500});return o;};
  const lx=228,rx=1052,cy=240;
  // 왼쪽: 소진 속도 (9시 → 7시), 이름은 바늘이 안 가는 왼쪽 아래
  const BL=H.burnScale(d,10),RL=H.rateScale(d,10),teB=118-ext(BL,16,2),teR=118-ext(RL,16,3);
  s+=H.cl('gauge','burn',big(lx,cy,BL,-90,300,teB)
   +H.text(lx-60,cy+42,'소진 속도',{size:13,fill:Y})+H.text(lx-60,cy+60,'%/시간',{size:13,fill:Ym})
   +H.needle(lx,cy,teB-13,-90+300*H.frac.burn(d),{style:'taper',w:6,color:Y,tail:12})+H.hub(lx,cy,11));
  // 오른쪽: 토큰 속도 (3시 → 12시), 이름은 바늘이 안 가는 오른쪽 위
  s+=H.cl('gauge','rate',big(rx,cy,RL,90,270,teR)
   +H.text(rx+58,cy-62,H.fmt.m(d.rate),{size:22,fill:Y,font:fn,weight:500})+H.text(rx+58,cy-42,'토큰 속도',{size:13,fill:Y})+H.text(rx+58,cy-24,'M tokens/시간',{size:13,fill:Ym})
   +H.needle(rx,cy,teR-13,90+270*H.frac.rate(d),{style:'taper',w:6,color:Y,tail:12})+H.hub(rx,cy,11));
  // 가운데 작은 원
  const small=(cx,cy,f,lab,l0,l1)=>{let o=H.bezel(cx,cy,56,4,{tone:'black',shadow:false})+H.face(cx,cy,56,{fill:'#101011',edge:'#060606'});
   const py=cy+10;
   o+=H.ticks(cx,py,46,{a0:-70,sweep:140,n:4,minor:1,len:8,mlen:4,w:2,mw:1.2,color:Y});
   o+=H.text(cx-38,py+2,l0,{size:12,fill:Y,base:'central',font:fn})+H.text(cx+38,py+2,l1,{size:12,fill:Y,base:'central',font:fn});
   o+=H.text(cx,cy+38,lab,{size:13,fill:Y});
   o+=H.needle(cx,py,38,-70+140*f,{style:'taper',w:4,color:Y,tail:4})+H.hub(cx,py,5);
   return o;};
  s+=small(640,138,H.frac.cpu(d),'CPU','0','100');
  s+=small(504,300,H.frac.mem(d),'메모리','0','100');
  s+=H.cl('gauge','fuel',small(640,300,H.frac.min(d),'남은 한도','E','F'));
  s+=H.cl('gauge','heat',small(776,300,H.frac.heat(d),'엔진 온도','C','H'));
  // 단추 두 묶음 (2 × 2, 가운데 축 대칭)
  const btn=(x,y,on,c,w=54)=>H.rect(x-w/2,y-14,w,28,{r:6,fill:on?c:'#202022'})+H.rect(x-w/2,y-14,w,28,{r:6,stroke:'#000',sw:1.5})+H.path(`M${x-w/2+5} ${y-13.5}H${x+w/2-5}`,{stroke:'#fff',sw:1,op:on?.35:.1});
  const lp=[['waiting','#f2b233'],['reconnect','#f2b233'],['empty','#ef4a3c'],['late','#f2b233']];
  const gx=[470,532],gy=[116,156];
  lp.forEach(([k,c],i)=>{const x=gx[i%2],y=gy[i>>1],on=d.lamps[k]>0;s+=H.cl('alert',k,btn(x,y,on,c)+H.g(O.ICONS[k](on?'#141414':'#6a6a6a',16),{t:`translate(${x-8} ${y-8})`}));});
  // 계정 단추: 2열, 4개까지는 경고등과 대칭인 2 × 2 자리(줄 116·156), 5개 이상은 CPU 원 옆 세로 폭(70–206)에 4줄까지.
  // 단추 폭은 가장 긴 이름에 맞추고(54–80), 쓸 수 있는 가로 폭(712–880)을 넘지 않게 합니다. 홀수 개면 마지막 단추를 가운데에 둡니다
  {const F=d.fuel,n=F.length,X0=712,X1=880;let fu='';
   if(!n)fu=H.text(1280-501,gy[0]+20,'계정 없음',{size:13,fill:Ym});
   else{const names=F.map(f=>acct(F,f)),rows=Math.ceil(n/2),sp=rows<=2?40:Math.min(40,(206-70-28)/(rows-1));
    let size=12,bw=Math.max(54,Math.ceil(Math.max(...names.map(t=>tw(t,size)))+10));
    if(2*bw+8>X1-X0){size=11;bw=Math.min((X1-X0-8)/2,Math.max(54,Math.ceil(Math.max(...names.map(t=>tw(t,size)))+10)));}
    const bx=Math.min(X1-bw-4,Math.max(1280-501,X0+bw+4)),ax=[bx-bw/2-4,bx+bw/2+4];
    F.forEach((f,i)=>{const last=i===n-1&&i%2===0,x=last?bx:ax[i%2],y=136+((i>>1)-(rows-1)/2)*sp,low=f.left<40;
     fu+=btn(x,y,low,Y,bw)+H.text(x,y+1,names[i],{size,fill:low?'#141414':Ym,base:'central',weight:600});});}
   s+=H.cl('gauge','fuel',fu);}
  // 기간 기어: 아래 원 줄 밑, 가운데 축
  s+=H.gear(640,400,d,{gap:44,width:340,size:14,on:Y,off:'#8a7444',font:fn});
  // 트립은 1top과 좌우 대칭으로 왼쪽 원 아래
  s+=H.cl('trip','',H.text(lx,444,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:Ym}));
  s+=H.text(rx,444,'1top',{size:12,fill:'#6a6a66',weight:600});
  return s;}});

 // ───────────────────────── 59 · Pontiac Firebird Trans Am 1977
 O.theme({id:'59',name:'머슬 알루미늄',about:'가로 솔 결 알루미늄 패널에 깊은 검은 원 계기를 박았습니다. 토큰 속도계 둘레의 초록·노랑·빨강 띠로 최대값의 50%·70%·85% 구간을 나눴습니다.',draw(H,d){
  // 솔 결 알루미늄: 가로 결 선을 아주 낮은 대비로
  H.def(`<pattern id="${H.id('et')}" width="240" height="6" patternUnits="userSpaceOnUse"><rect width="240" height="6" fill="#c3c6ca"/><path d="M0 1.5H240" stroke="#fff" stroke-opacity=".22" stroke-width=".8"/><path d="M0 4.2H240" stroke="#000" stroke-opacity=".05" stroke-width=".8"/></pattern>`);
  const wh='#f2f2ea',mute='#c8c8c0',ink='#2a2c2e',fn='helv';
  let s=H.rect(0,0,1280,480,{fill:'#111213'});
  const PN='M34 78 H1246 V402 Q640 438 34 402Z';
  s+=H.path(PN,{fill:H.url('et'),filter:H.shadow('ps',6,12,.6)});
  s+=H.path(PN,{fill:H.lin('pv',[[0,'#fff',.16],[.45,'#fff',0],[1,'#000',.3]])});
  s+=H.path('M34 78.5 H1246',{stroke:'#fff',sw:1.5,op:.5})+H.path('M1246 402 Q640 438 34 402',{stroke:'#000',sw:2,op:.45});
  const deep=(cx,cy,r)=>H.circle(cx,cy,r+18,{fill:H.lin('cup'+cx,[[0,'#050607'],[1,'#22262a']]),filter:H.shadow('dp'+cx+cy,3,5,.7)})+H.circle(cx,cy,r+18,{stroke:'#fff',sw:1,op:.25})+H.bezel(cx,cy,r,8,{tone:'black',shadow:false})+H.face(cx,cy,r,{fill:'#141a20',edge:'#07090b'});
  const GY=240;
  // 회전계 자리: 토큰 속도
  // 색 띠는 최대값에 대한 비율(0.5·0.7·0.85)로 둡니다
  const tx=316,tr=122,A=f=>-135+270*f,RL=H.rateScale(d,10,{every:2}),teR=tr-48-ext(RL,15,3);
  s+=deep(tx,GY,tr);
  s+=H.cl('gauge','rate',H.band(tx,GY,tr-12,tr-4,A(.5),A(.7),{fill:'#3ec04a'})+H.band(tx,GY,tr-12,tr-4,A(.7),A(.85),{fill:'#f0d02a'})+H.band(tx,GY,tr-12,tr-4,A(.85),A(1),{fill:'#e33a2a'})
   +numsFit(H,tx,GY,teR,RL,{a0:-135,sweep:270,size:15,fill:wh,font:fn})
   +H.ticks(tx,GY,teR,{a0:-135,sweep:270,n:10,minor:1,len:8,mlen:5,w:2.4,mw:1.2,color:wh})
   +H.text(tx,GY+62,'토큰 속도',{size:14,fill:wh})+H.text(tx,GY+82,'M tokens/시간',{size:13,fill:mute})
   +H.needle(tx,GY,teR-8,A(H.frac.rate(d)),{style:'taper',w:6,color:'#f4f4ee',tail:10})+H.hub(tx,GY,9));
  s+=H.cl('trip','',H.text(tx,GY+102,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:mute}));
  // 속도계 자리: 소진 속도
  const sx=964,sr=122,BL=H.burnScale(d,10,{every:2}),teB=sr-36-ext(BL,15,2);s+=deep(sx,GY,sr);
  s+=H.cl('gauge','burn',H.nums(sx,GY,sr-22,BL,{a0:-135,sweep:270,size:15,fill:wh,font:fn})
   +H.ticks(sx,GY,teB,{a0:-135,sweep:270,n:10,minor:4,len:10,mlen:5,w:2.4,mw:1.2,color:wh})
   +H.odo(sx-45,GY+44,H.fmt.odo(d.odo,6),{cw:15,ch:19,bg:'#0d0d0d',fg:'#eee',frame:'#000',font:fn})
   +H.text(sx,GY+88,'소진 속도 · %/시간',{size:13,fill:mute})
   +H.needle(sx,GY,teB-10,-135+270*H.frac.burn(d),{style:'taper',w:6,color:'#f4f4ee',tail:10})+H.hub(sx,GY,9));
  // 양끝 작은 원: 엔진 온도 · 남은 한도 (같은 크기, 같은 높이)
  const mini=(cx,f,l0,l1,lab)=>{let o=deep(cx,GY,44);
   o+=H.ticks(cx,GY+10,38,{a0:-60,sweep:120,n:4,minor:1,len:8,mlen:4,w:2,mw:1.2,color:wh});
   o+=H.text(cx-30,GY+18,l0,{size:12,fill:wh,base:'central',font:fn})+H.text(cx+30,GY+18,l1,{size:12,fill:wh,base:'central',font:fn});
   o+=H.needle(cx,GY+10,30,-60+120*f,{style:'taper',w:3.5,color:'#f4f4ee',tail:3})+H.hub(cx,GY+10,5);
   return o+H.text(cx,GY+92,lab,{size:13,fill:ink,weight:600});};
  s+=H.cl('gauge','heat',mini(108,H.frac.heat(d),'C','H','엔진 온도'));
  s+=H.cl('gauge','fuel',mini(1172,H.frac.min(d),'E','F','남은 한도'));
  // 가운데: CPU 작은 원 → 명판 → 경고등 → 기간
  const mx=640,my=164;s+=deep(mx,my,50);
  s+=H.ticks(mx,my+10,42,{a0:-60,sweep:120,n:4,minor:1,len:8,mlen:4,w:2,mw:1.2,color:wh});
  s+=H.text(mx,my+34,'CPU',{size:13,fill:mute});
  s+=H.needle(mx,my+10,34,-60+120*H.frac.cpu(d),{style:'taper',w:4,color:'#f4f4ee',tail:3})+H.hub(mx,my+10,5);
  s+=H.text(58,388,'1top',{size:12,fill:ink,weight:700,op:.7,anchor:'start'});
  s+=H.rect(mx-86,GY+16+26,172,30,{r:3,fill:H.lin('plq',[[0,'#f6f6f0'],[1,'#d6d6ce']])})+H.rect(mx-86,GY+42,172,30,{r:3,stroke:'#5a5c5e',sw:1.5})+H.text(mx,GY+62,'작업 가능 '+H.fmt.hours(d.rangeH),{size:14,fill:'#1d1f21',weight:600});
  s+=wellRect(H,'lmp',mx-100,GY+86,200,36,5,{top:'#08090a',bottom:'#1b1d20',shade:.6,depth:.3,lip:.3});
  s+=lampsAt(H,mx,GY+104,d,{size:18,gap:44,off:'#33373b'});
  s+=H.gear(mx,GY+150,d,{gap:40,width:320,size:14,on:'#111',off:'#4c5054'});
  return s;}});

 // ───────────────────────── 60 · Lotus Elise S2
 O.theme({id:'60',name:'라이트웨이트',about:'흰 테두리의 작은 하우징 하나에 왼쪽 작은 원과 오른쪽 큰 원을 두고, 빨간 바늘과 검은 큰 축을 옮겼습니다. 왼쪽 원 아래에 LCD 창, 오른쪽 원 아래에 경고등 줄을 둡니다.',draw(H,d){
  const wh='#f0f0f0',mute='#b9bfd0',fn='helv',lcd='#c8d4ac';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#1b1c1e'],[1,'#0c0c0d']])});
  const outer='M76 380 L98 146 Q110 52 238 46 L548 38 Q614 38 652 82 Q690 104 752 96 L1046 92 Q1190 98 1200 236 L1206 380 Q1206 450 1140 450 H142 Q76 450 76 380Z';
  const inner='M102 374 L122 152 Q134 72 244 68 L544 60 Q602 60 638 100 Q684 126 754 118 L1042 114 Q1166 120 1176 240 L1182 374 Q1182 426 1132 426 H150 Q102 426 102 374Z';
  s+=H.path(outer,{fill:H.lin('wb',[[0,'#ffffff'],[.6,'#e6e4de'],[1,'#c9c6bd']]),filter:H.shadow('sh',8,12,.6)});
  s+=H.path(outer,{stroke:'#fff',sw:1.5,op:.8});
  s+=well(H,'f',inner,{top:'#2b3246',bottom:'#121726',shade:.55,depth:.12});
  // 큰 원 둘레의 가는 판 경계선 (원본의 돋은 선)
  const rx=846,ry=284;
  // 왼쪽 작은 계기: 소진 속도
  const lx=350,ly=206,la=-100+200*H.frac.burn(d),BL=H.burnScale(d,10,{every:2}),teB=104-ext(BL,19,2);
  s+=H.cl('gauge','burn',H.nums(lx,ly,122,BL,{a0:-100,sweep:200,size:19,fill:wh,font:fn})
   +H.ticks(lx,ly,teB,{a0:-100,sweep:200,n:10,minor:1,len:14,mlen:7,w:3,mw:1.6,color:wh,red:.8,redColor:'#ff4040'})
   +H.text(lx,ly+50,'소진 속도',{size:14,fill:mute})+H.text(lx,ly+70,'%/시간',{size:13,fill:mute})
   +H.needle(lx,ly,teB-14,la,{style:'taper',w:6,color:'#e81a1a',tail:12})+H.hub(lx,ly,18,{fill:'#0a0a0a',light:'#3a3a3c'}));
  // LCD 창
  s+=wellRect(H,'lcd',230,302,240,64,5,{top:'#141a18',bottom:'#232b26',shade:.6,depth:.25,lip:.12});
  s+=H.text(350,330,H.fmt.odo(d.odo,6)+' M',{size:18,fill:lcd,font:fn,ls:1.5})+H.text(246,354,'작업 가능 '+H.fmt.hours(d.rangeH),{size:13,fill:lcd,anchor:'start'});
  s+=H.cl('trip','',H.text(454,354,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:lcd,anchor:'end'}));
  // 오른쪽 큰 계기: 토큰 속도
  const ra=-90+213*H.frac.rate(d);
  const RL=H.rateScale(d,10),teR=130-ext(RL,21,3);
  s+=H.cl('gauge','rate',numsFit(H,rx,ry,teR,RL,{a0:-90,sweep:213,size:21,fill:wh,font:fn})
   +H.ticks(rx,ry,teR,{a0:-90,sweep:213,n:10,minor:1,len:17,mlen:9,w:3,mw:1.8,color:wh,red:.85,redColor:'#ff4040'})
   +H.text(rx-44,ry+58,'토큰 속도',{size:14,fill:mute,anchor:'end'})+H.text(rx-44,ry+78,'M tokens/시간',{size:13,fill:mute,anchor:'end'})
   +H.needle(rx,ry,teR-17,ra,{style:'taper',w:8,color:'#e81a1a',tail:14})+H.hub(rx,ry,22,{fill:'#0a0a0a',light:'#3a3a3c'}));
  // 아래 줄 (같은 기준선)
  const BY=404;
  s+=H.gear(350,BY-5,d,{gap:36,width:250,size:13,on:'#fff',off:'#8d94ac'});
  s+=lampsAt(H,rx,BY-5,d,{size:17,gap:40,off:'#3a4258'});
  s+=H.cl('gauge','heat',H.text(1150,BY,'엔진 온도 '+Math.round(d.heat)+'°',{size:13,fill:mute,anchor:'end'}));
  s+=H.text(136,BY,'1top',{size:12,fill:'#8d94ac',weight:700,anchor:'start'});
  return s;}});

 // ───────────────────────── 61 · Renault Scénic II
 O.theme({id:'61',name:'센터 스트립',about:'대시보드 위쪽 가운데에 가로로 긴 청록 LCD 띠를 크게 두고, 한도·누적·온도·기간·소진·큰 숫자·시계를 칸마다 나눠 한 줄에 늘어놓았습니다.',draw(H,d){
  const c1='#4ff0e0',hi='#c8fff6',mute='#3fa89c',off='#0a1c1b',div='#123330';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#141517'],[1,'#08090a']])});
  // 차양 하우징: 위는 앞으로 나온 차양(곡선), 아래는 얇은 턱. 캔버스 높이를 거의 다 씁니다.
  s+=H.housing('M36 64 Q640 22 1244 64 L1244 424 Q640 446 36 424Z',{top:'#2b2d31',bottom:'#121316',rim:.14});
  s+=H.path('M36 64 Q640 22 1244 64 L1244 78 Q640 38 36 78Z',{fill:'#000',op:.25});
  const X0=82,X1=1198,Y0=90,Y1=396;
  s+=wellRect(H,'strip',X0-6,Y0-6,X1-X0+12,Y1-Y0+12,18,{top:'#08090a',bottom:'#1a1c1f',shade:.7,depth:.2,lip:.1});
  s+=wellRect(H,'lcd',X0,Y0,X1-X0,Y1-Y0,14,{top:'#000',bottom:'#030707',shade:.8,depth:.14,lip:false});
  const cells=[82,226,452,546,782,1066,1198];
  for(let i=1;i<cells.length-1;i++)s+=H.line(cells[i],Y0+30,cells[i],Y1-30,{stroke:div,sw:1.5});
  const L1=Y0+44,L3=Y1-30,BT=L1+24,BH=L3-24-BT;
  // 칸 1: 한도 막대
  s+=H.cl('gauge','fuel',H.text(154,L1,'한도',{size:15,fill:mute})+H.vbars(134,BT,40,BH,H.frac.min(d),{n:12,gap:5,fill:c1,off,r:1.5})+H.text(154,L3,Math.round(d.minLeft)+'%',{size:17,fill:hi,font:'din'}));
  // 칸 2: 누적 · 트립 · 세션 (라벨 왼쪽 여백선, 값 오른쪽 여백선)
  const l2=250,r2=428;
  s+=H.text(l2,L1,'누적',{size:15,fill:mute,anchor:'start'})+H.text(r2,L1+50,H.fmt.odo(d.odo)+' M',{size:34,fill:hi,anchor:'end',font:'din'});
  s+=H.line(l2,L1+72,r2,L1+72,{stroke:div,sw:1});
  s+=H.cl('trip','',H.text(l2,L1+104,'트립',{size:15,fill:mute,anchor:'start'})+H.text(r2,L1+154,H.fmt.trip(d.trip)+' M',{size:34,fill:hi,anchor:'end',font:'din'}));
  s+=H.text(l2,L3,'작업 중 세션',{size:14,fill:mute,anchor:'start'})+H.text(r2,L3,`${d.sessions.working} / ${d.sessions.total}`,{size:17,fill:hi,anchor:'end',font:'din'});
  // 칸 3: 엔진 온도 막대
  s+=H.cl('gauge','heat',H.text(499,L1,'온도',{size:15,fill:mute})+H.vbars(479,BT,40,BH,H.frac.heat(d),{n:12,gap:5,fill:c1,colors:[[.8,'#ff4a3a']],off,r:1.5})+H.text(499,L3,Math.round(d.heat)+'°',{size:17,fill:hi,font:'din'}));
  // 칸 4: 기간 · 소진 · 경고등
  const c4=664;
  // 기어 격자: 칸 폭 220px 안에서 열 수만큼 나눕니다
  const GG=gearGrid(d.gears.length);
  d.gears.forEach((g,i)=>{const on=g===d.period,q=GG[i],sp=Math.min(72,220/q.cols),x=c4+q.col*sp,y=L1+q.row*32;s+=H.cl('period',g,H.text(x,y,g,{size:on?18:15,fill:on?hi:mute,weight:on?700:400,font:'din'}));});
  s+=H.cl('gauge','burn',H.text(c4,L1+128,H.fmt.burn(d.burn)+' %/시간',{size:34,fill:hi,font:'din'})+H.text(c4,L1+156,'소진 속도'+(d.cruise!=null&&isFinite(d.cruise)?' · 적정 '+d.cruise.toFixed(1):''),{size:14,fill:mute}));
  s+=lampsAt(H,c4,L3-6,d,{size:22,gap:50,off:'#11302d'});
  // 칸 5: 토큰 속도 큰 숫자
  const c5=924;
  s+=H.cl('gauge','rate',H.text(c5,L1,'토큰 속도',{size:15,fill:mute})+H.seg(c5,L1+56,H.fmt.m(d.rate),118,{fill:hi,gap:9,skew:0,anchor:'middle',dim:'#0a1e1c'})+H.text(c5,L3,'M tokens/시간',{size:15,fill:c1}));
  // 칸 6: 시계 · 작업 가능 · 1top (오른쪽 여백선)
  const RE=1174;
  s+=H.text(RE,L1,d.clock,{size:20,fill:c1,anchor:'end',font:'din'});
  s+=H.text(RE,L1+120,H.fmt.hours(d.rangeH),{size:32,fill:hi,anchor:'end',font:'din'});
  s+=H.text(RE,L1+148,'작업 가능',{size:14,fill:mute,anchor:'end'});
  s+=H.text(RE,L3,'1top',{size:12,fill:mute,anchor:'end',weight:600});
  return s;}});
})(window.OneTop);
