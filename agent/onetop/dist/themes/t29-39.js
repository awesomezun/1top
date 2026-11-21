/* 29–39 (v4.0.0)
   원칙
   - 바늘은 눈금 고리 끝까지 닿고, 눈금 숫자는 바늘 끝 바깥 고리에 둡니다. 읽음 숫자·단위는 바늘이 가지 않는 6시 구역에만 둡니다.
   - 글자는 테마마다 네 단계: 주 값 · 보조 값 · 라벨 13–14px · 기어 13–15px. 글꼴은 숫자용 하나와 정보용(ui) 하나만 씁니다.
   - 경고등·기어·1top은 계기 중심축, 화면 안쪽 여백선, 공유 기준선 중 하나에 맞춥니다.
   - 원본에 없는 글로는 쓰지 않습니다. 강조색은 테마마다 하나입니다(경고등 켜짐 색은 예외). */
(function(O){
 'use strict';
 const rr=(x,y,w,h,r)=>`M${x+r} ${y}H${x+w-r}A${r} ${r} 0 0 1 ${x+w} ${y+r}V${y+h-r}A${r} ${r} 0 0 1 ${x+w-r} ${y+h}H${x+r}A${r} ${r} 0 0 1 ${x} ${y+h-r}V${y+r}A${r} ${r} 0 0 1 ${x+r} ${y}Z`;
 const LAMP=[['waiting','응답 대기','#f2b233'],['reconnect','재로그인','#f2b233'],['empty','한도 부족','#ef4a3c'],['late','수집 지연','#f2b233']];

 // 원형 계기: 눈금 고리(to) 바깥에 숫자 고리(nr), 바늘 끝은 눈금 고리 바깥 끝까지 닿습니다.
 function dial(H,o){
  const {cx,cy,r}=o,a0=o.a0??-135,sw=o.sweep??270,f=H.clamp(o.f);
  let to=r*(o.to??.72);const tl=o.tl??r*.1,ml=o.ml??r*.05,nr=r*(o.nr??.86);
  // fit: 숫자 상자는 큰 눈금 바깥 끝에서 g px, 다이얼 가장자리에서 4px 이상 떨어집니다. 모자라면 눈금 고리를 안으로 줄입니다.
  const nsz=o.ns??Math.max(13,r*.12),fg=o.fit===true?6:o.fit,n0=o.labels.length-1,lim=o.lim??r-4;
  const sup=(t,i)=>{const a=(a0+sw*(n0?i/n0:0))*Math.PI/180;return tw(t,nsz,o.nw)/2*Math.abs(Math.sin(a))+nsz*.4*Math.abs(Math.cos(a));};
  if(o.fit)o.labels.forEach((t,i)=>{if(t)to=Math.min(to,lim-2*sup(t,i)-fg);});
  let s='';
  if(o.tone)s+=H.bezel(cx,cy,r,o.bw??Math.max(8,r*.07),{tone:o.tone});
  if(o.faceFill!==null)s+=H.face(cx,cy,r,{fill:o.faceFill||'#141518',center:o.center,edge:o.edge});
  if(o.under)s+=o.under;
  s+=H.ticks(cx,cy,to,{a0,sweep:sw,n:o.labels.length-1,minor:o.minor??4,len:tl,mlen:ml,w:o.tw??Math.max(2,r*.016),mw:o.mw??Math.max(1,r*.008),color:o.tick||'#f2f2f2',mcolor:o.mtick,red:o.red,redColor:o.redColor});
  const nso={a0,sweep:sw,size:o.ns??Math.max(13,r*.12),fill:o.num||o.tick||'#f2f2f2',font:o.font||'helv',weight:o.nw,red:o.red,redColor:o.redNum||o.redColor};
  if(o.fit){ // 숫자 상자가 큰 눈금 바깥 끝에서 각도마다 6px 이상 떨어지도록 지지 함수로 반지름을 정합니다.
   s+=o.labels.map((t,i)=>{if(!t)return '';const rad=Math.min(lim-sup(t,i),Math.max(nr,to+fg+sup(t,i)));const lb=o.labels.map((x,j)=>j===i?x:'');return H.nums(cx,cy,rad,lb,nso);}).join('');
  }else s+=H.nums(cx,cy,nr,o.labels,nso);
  if(o.inner)s+=o.inner;
  const ang=a0+sw*f,nl=o.nl??(to-.5);
  if(o.rim){const [x1,y1]=H.pt(cx,cy,o.rim,ang),[x2,y2]=H.pt(cx,cy,nl,ang);
   s+=H.line(x1+1.5,y1+2,x2+1.5,y2+2,{stroke:'#000',sw:o.nwid??5,cap:'round',op:.35})+H.line(x1,y1,x2,y2,{stroke:o.needle||'#ff3b1f',sw:o.nwid??5,cap:'round'});}
  else s+=H.needle(cx,cy,nl,ang,{style:o.nstyle||'taper',w:o.nwid??Math.max(4,r*.045),color:o.needle||'#ff3b1f',tail:o.tail??r*.12});
  if(!o.rim&&o.hub!==false)s+=H.hub(cx,cy,o.hubR??Math.max(6,Math.round(r*.09)),o.hub||{});
  if(o.glass!==false)s+=glass(H,cx,cy,r,o.glassOp??.05);
  return s;
 }
 // 유리 반사: 다이얼 전체를 덮는 원에 위쪽만 옅게 비치는 그라데이션 (숫자를 가르는 경계선이 없음)
 function glass(H,cx,cy,r,op=.05){return H.circle(cx,cy,r,{fill:H.lin('gls'+cx+'_'+cy,[[0,'#fff',op],[.42,'#fff',0],[1,'#fff',0]],{dir:[0,0,0,1]})});}
 // 라벨과 값을 한 줄에: parts=[[글자,{size,fill,weight,font,dx}],…]
 // 글자 너비 추정 (시스템 산세리프 기준)
 function tw(str,size,weight){let w=0;for(const c of String(str)){
   w+=/[가-힣]/.test(c)?.92:/[0-9]/.test(c)?.6:/[.:,]/.test(c)?.28:c===' '?.27:c==='%'?.84:c==='°'?.4:c==='/'?.36:c==='·'?.3:/[A-Z]/.test(c)?.66:/[a-z]/.test(c)?.54:.6;}
  return w*size*(weight>=600?1.03:1);}
 function tx(H,x,y,parts,o={}){
  const P=parts.map(([str,p={}],i)=>({str,p,w:tw(str,p.size||14,p.weight),dx:i?(p.dx??8):0}));
  const t=(q,px,anchor)=>H.text(px,y,q.str,{size:q.p.size||14,fill:q.p.fill||'#fff',weight:q.p.weight,font:q.p.font||o.font,anchor,base:o.base});
  let s='';
  // 오른쪽 맞춤은 끝에서부터 거꾸로 놓아, 추정 오차가 바깥 기준선이 아니라 사이 간격에만 생기게 합니다
  if(o.anchor==='end'){let cx=x;for(let i=P.length-1;i>=0;i--){s+=t(P[i],cx,'end');cx-=P[i].w+P[i].dx;}return s;}
  const total=P.reduce((a,q)=>a+q.dx+q.w,0);
  let cx=o.anchor==='start'?x:x-total/2;
  for(const q of P){cx+=q.dx;s+=t(q,cx,'start');cx+=q.w;}
  return s;
 }
 // 계정 이름: 같은 도구가 여러 번 나오면 plan을 붙여 구분합니다(Claude Max, Claude Pro)
 function fuelNames(fuel){const c={};fuel.forEach(f=>{c[f.name]=(c[f.name]||0)+1;});
  return fuel.map(f=>c[f.name]>1&&f.plan?`${f.name} ${f.plan}`:f.name);}
 // 계정 목록을 칸 수(max)에 맞춥니다. 넘치면 앞쪽 max-1개와 '+K' 한 칸을 돌려줍니다
 function fuelFit(fuel,max){const names=fuelNames(fuel),rows=fuel.map((f,i)=>({name:names[i],left:Math.round(H0clamp(f.left))}));
  return rows.length<=max?{rows,more:0}:{rows:rows.slice(0,max-1),more:rows.length-(max-1)};}
 const H0clamp=v=>isFinite(v)?Math.max(0,Math.min(100,v)):0;
 // 표 한 줄: 왼쪽 라벨, 오른쪽 값
 function kv(H,x0,x1,y,label,value,o={}){
  return H.text(x0,y,label,{size:o.ls||13,fill:o.lf||'#9aa1aa',anchor:'start'})+H.text(x1,y,value,{size:o.vs||14,fill:o.vf||'#fff',weight:o.vw||600,anchor:'end',font:o.vfont});
 }
 // 안으로 들어간 면: 위가 어둡고, 위 가장자리 그림자, 아래 가장자리에 가는 빛선
 function well(H,d,box,o={}){
  const n='wl'+(o.id||box.join('_'));const [x,y,w,h]=box;
  const g=H.lin(n,[[0,o.top||'#040506'],[1,o.bottom||'#111316']]);
  const sh=H.lin(n+'s',[[0,'#000',o.shadow??.55],[1,'#000',0]]);
  const cl=H.clip(n+'c',`<path d="${d}"/>`);
  return H.path(d,{fill:g})+H.g(H.rect(x,y,w,Math.min(16,h*.3),{fill:sh}),{clip:cl})+H.path(d,{stroke:'#000',sw:1.2,op:.8})+H.g(H.rect(x,y+h-1.2,w,1.2,{fill:'#fff',op:o.lip??.08}),{clip:cl});
 }
 // 경고등 하나
 // 경고등 하나 (누를 수 있게 data-cl-alert로 감쌉니다). extra: 같은 칸에 넣을 이름표 등
 function lamp(H,d,k,x,y,sz,off,on,extra=''){
  const it=LAMP.find(l=>l[0]===k),lit=d.lamps[k]>0;
  return H.cl('alert',k,H.g(O.ICONS[k](lit?(on?.[k]||it[2]):off,sz),{t:`translate(${H.r2(x-sz/2)} ${H.r2(y-sz/2)})`})+extra);
 }
 // 눈금 숫자 고리 맞추기: 숫자 상자가 눈금 고리(to)에서 gap, 바깥 한계(lim) 안에 들도록 반지름을 정합니다.
 //  긴 숫자(1000)가 들어가지 않으면 글자를 줄이지 않고 눈금 고리를 안쪽으로 옮깁니다. → {to, nums(H,cx,cy,o)}
 function fitRing(labels,o){
  const {a0,sweep:sw,size,weight,nr,gap=6,lim}=o,n=labels.length-1;
  const sup=labels.map((t,i)=>{if(!t)return 0;const a=(a0+sw*(n?i/n:0))*Math.PI/180;return tw(t,size,weight)/2*Math.abs(Math.sin(a))+size*.4*Math.abs(Math.cos(a));});
  let to=o.to;sup.forEach(s=>{if(s)to=Math.min(to,lim-2*s-gap);});
  const rad=sup.map(s=>Math.min(lim-s,Math.max(nr,to+gap+s)));
  return {to,nums:(H,cx,cy,no)=>labels.map((t,i)=>t?H.nums(cx,cy,rad[i],labels.map((x,j)=>j===i?x:''),{a0,sweep:sw,size,weight,...no}):'').join('')};
 }
 // 기간 기어 줄 (현재 기어만 강조색, 아래 짧은 밑줄)
 // o.width: 기어 줄이 쓸 수 있는 폭. 기어가 많으면 간격을 폭/개수로 줄이고, 그래도 넘치면 글자를 13px까지 줄입니다.
 function gears(H,d,x,y,o={}){
  const n=d.gears.length;let gap=o.gap||40,size=o.size||14,s='';
  if(o.width&&n>1)gap=Math.min(gap,o.width/n);
  const wmax=Math.max(...d.gears.map(g=>tw(g,size,700)));
  if(wmax+8>gap)size=Math.max(13,size*(gap-8)/wmax);
  d.gears.forEach((g,i)=>{const on=g===d.period,px=x+(i-(n-1)/2)*gap;
   let one=H.text(px,y,g,{size:on?size:Math.max(13,size-1),fill:on?(o.on||'#fff'):(o.off||'#777'),weight:on?700:400,font:o.font||'ui'});
   if(on&&o.bar!==false)one+=H.rect(px-8,y+6,16,2,{fill:o.bar||o.on||'#fff',r:1});
   s+=H.cl('period',g,one);});
  return s;
 }
 // 토큰 흐름 (최근 기록)
 function flow(H,x,y,w,h,o={}){
  const F0=(H.d&&H.d.flow&&H.d.flow.length)?H.d.flow.map(v=>Math.max(0,+v||0)):Array(24).fill(0),D=F0.length>1?F0:[F0[0],F0[0]],mx=Math.max(...D)*1.08||1,P=D.map((v,i)=>[H.r2(x+w*i/(D.length-1)),H.r2(y+h-h*v/mx)]);
  const line='M'+P.map(p=>p.join(' ')).join('L');
  const g=H.lin('flw'+(o.id||''),[[0,o.color||'#3a8fd6',o.areaOp??.22],[1,o.color||'#3a8fd6',0]],{dir:[0,0,0,1]});
  let s='';
  if(o.grid)for(let k=1;k<=3;k++)s+=H.line(x,y+h*k/4,x+w,y+h*k/4,{stroke:o.grid,sw:1});
  s+=H.path(line+`L${x+w} ${y+h}L${x} ${y+h}Z`,{fill:g})+H.path(line,{stroke:o.color||'#3a8fd6',sw:o.sw||2,join:'round'});
  s+=H.line(x,y+h,x+w,y+h,{stroke:o.base||'#c9d0d7',sw:1});
  return s;
 }

 // 29 · Hyundai IONIQ 5 — 밝은 흰 화면, 얇은 선, 양옆 곡면 날개
 O.theme({id:'29',name:'화이트 큐브',about:'어두운 테두리 안 밝은 흰 화면에 얇은 선을 쓰고, 양옆 곡면 날개에 토큰 속도와 소진 속도를, 가운데에 토큰 흐름을 실었습니다.',draw(H,d){
  const blue='#2a7cc9',ink='#1c242c',sub='#5c6874',mute='#9aa5b0';
  let s=H.rect(0,0,1280,480,{fill:H.lin('dash',[[0,'#c4c8cc'],[1,'#86898d']])});
  s+=H.housing(rr(48,36,1184,408,28),{top:'#303236',bottom:'#141517',rim:.14});
  s+=H.path(rr(62,50,1156,380,17),{fill:'#08090a'});
  s+=H.path(rr(66,54,1148,372,14),{fill:H.lin('scr',[[0,'#fdfefe'],[.6,'#f2f5f8'],[1,'#e3e8ed']])});
  // 화면 안쪽 여백선: x 116 – 1164
  // 위 줄 (y 100): 기간 표지 · 기어 · 경고등
  s+=H.circle(138,98,22,{fill:'#fff',stroke:'#d8402f',sw:4})+H.text(138,98,d.period,{size:14,fill:ink,weight:700,base:'central'});
  s+=H.text(172,103,d.periodLabel+' 평균',{size:14,fill:sub,anchor:'start'});
  s+=gears(H,d,640,103,{gap:46,size:14,on:blue,off:mute,width:520});
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,1046+i*39,98,20,'#c6ced6',{waiting:'#d98c0a'});});
  // 주 값
  const rateRead=H.text(114,212,H.fmt.m(d.rate),{size:76,fill:blue,font:'helv',weight:200,anchor:'start'})
   +tx(H,118,242,[['토큰 속도',{fill:ink,weight:600}],['M tokens/시간',{fill:sub}]],{anchor:'start'});
  s+=tx(H,118,266,[['작업 가능',{fill:sub,size:13}],[H.fmt.hours(d.rangeH),{fill:ink,weight:600}]],{anchor:'start'});
  const burnRead=H.text(1166,212,H.fmt.burn(d.burn),{size:76,fill:ink,font:'helv',weight:200,anchor:'end'})
   +tx(H,1162,242,[['소진 속도',{fill:ink,weight:600}],['%/시간',{fill:sub}]],{anchor:'end'});
  s+=d.cruise!=null?tx(H,1162,266,[['적정',{fill:sub,size:13}],[H.fmt.burn(d.cruise)+'%/시간',{fill:ink,weight:600}]],{anchor:'end'}):tx(H,1162,266,[['엔진 온도',{fill:sub,size:13}],[Math.round(d.heat)+'°',{fill:ink,weight:600}]],{anchor:'end'});
  // 곡면 날개: 바깥 (116, 296) 에서 안쪽 (548, 352) 으로 내려오는 띠. 안쪽으로 갈수록 두꺼워집니다.
  const wing=(dir,f,id)=>{const X=x=>640-dir*(x-640);
   const P=t=>{const u=1-t;return [u*u*116+2*u*t*360+t*t*548,u*u*296+2*u*t*296+t*t*350];};
   const th=t=>6+12*t,n=34;let o='';
   // 띠 아래 그림자면과 가장자리 선
   let top='',bot='';for(let i=0;i<=40;i++){const t=i/40,[x,y]=P(t);top+=(i?'L':'M')+H.r2(X(x))+' '+H.r2(y);bot=`L${H.r2(X(x))} ${H.r2(y+th(t)+3)}`+bot;}
   o+=H.path(top+bot+'Z',{fill:H.lin('wg'+id,[[0,'#e9edf1'],[1,'#d3dae1']])});
   o+=H.path(top,{stroke:'#fff',sw:1.5});
   const on=Math.round(H.clamp(f)*n);
   for(let i=0;i<on;i++){const t=i/n,t2=(i+.84)/n,[ax,ay]=P(t),[bx,by]=P(t2);
    o+=H.path(`M${H.r2(X(ax))} ${H.r2(ay)}L${H.r2(X(bx))} ${H.r2(by)}L${H.r2(X(bx))} ${H.r2(by+th(t2)+3)}L${H.r2(X(ax))} ${H.r2(ay+th(t)+3)}Z`,{fill:blue,op:.4+.6*t});}
   let lip='';for(let i=0;i<=40;i++){const t=i/40,[x,y]=P(t);lip+=(i?'L':'M')+H.r2(X(x))+' '+H.r2(y+th(t)+3);}
   o+=H.path(lip,{stroke:'#b9c2cb',sw:1});
   return o;};
  s+=H.cl('gauge','rate',rateRead+wing(-1,H.frac.rate(d),'l'))+H.cl('gauge','burn',burnRead+wing(1,H.frac.burn(d),'r')); // dir -1 = 왼쪽
  // 가운데 토큰 흐름
  s+=flow(H,524,146,232,150,{id:'29',color:blue,base:'#c3cbd3',grid:'#edf0f3'});
  s+=H.text(640,324,'토큰 흐름',{size:13,fill:sub});
  // 아래 정보 줄 (y 404)
  s+=H.line(116,378,1164,378,{stroke:'#d3d9df',sw:1});
  const B=404;
  s+=tx(H,116,B,[['남은 한도',{fill:sub,size:13}],[Math.round(d.minLeft)+'%',{fill:blue,weight:600}]],{anchor:'start'});
  s+=tx(H,300,B,[['엔진 온도',{fill:sub,size:13}],[d.heat+'°',{fill:ink,weight:600}]],{anchor:'start'});
  s+=tx(H,484,B,[['세션',{fill:sub,size:13}],[`${d.sessions.working} 작업 · ${d.sessions.waiting} 대기`,{fill:ink,weight:600}]],{anchor:'start'});
  {const tp=[['트립',{fill:sub,size:13}],[H.fmt.trip(d.trip)+'M',{fill:ink,weight:600}]],tw0=tw('트립',13)+8+tw(H.fmt.trip(d.trip)+'M',14,600);
   s+=tx(H,1110-tw0-12,B,[['누적',{fill:sub,size:13}],[H.fmt.odo(d.odo)+' M',{fill:ink,weight:600}]],{anchor:'end'})+H.cl('trip','',tx(H,1110,B,tp,{anchor:'end'}));}
  s+=H.text(1164,B,'1top',{size:12,fill:mute,weight:700,anchor:'end'});
  return s;}});

 // 30 · Kia EV6 — 짙은 곡면 화면, 양끝 원근 날개와 바깥 빨간 띠, 정보를 넓게 분산
 O.theme({id:'30',name:'다크 와이드',about:'짙은 곡면 화면 양끝에 원근 날개를 세우고 바깥 빨간 띠가 값만큼 차오르게 했으며, 숫자와 토큰 흐름을 넓게 흩어 놓았습니다.',draw(H,d){
  const red='#e3192b',ink='#f2f4f6',sub='#9ba2ab',mute='#646a73';
  let s=H.rect(0,0,1280,480,{fill:'#050506'});
  s+=H.housing('M44 90 Q640 46 1236 90 L1214 426 Q640 452 66 426Z',{top:'#1e2023',bottom:'#0a0b0c',rim:.1});
  s+=H.path('M64 106 Q640 64 1216 106 L1196 408 Q640 432 84 408Z',{fill:'#000'});
  s+=H.path('M68 110 Q640 68 1212 110 L1192 404 Q640 428 88 404Z',{fill:H.lin('scr',[[0,'#0d1015'],[1,'#030406']])});
  // 원근 날개: 바깥 모서리 x 104 (y 160–352), 안쪽 모서리 x 300 (y 210–328)
  const plane=(dir,f,col)=>{const X=x=>640-dir*(x-640),xo=104,xi=300,yo0=160,yo1=352,yi0=210,yi1=328,n=20,on=Math.round(H.clamp(f)*n);
   let o=H.path(`M${X(xo)} ${yo0}L${X(xi)} ${yi0}L${X(xi)} ${yi1}L${X(xo)} ${yo1}Z`,{fill:H.lin('pl'+dir,[[0,'#16181c'],[1,'#0b0c0f']],{dir:dir<0?[0,0,1,0]:[1,0,0,0]})});
   for(let i=0;i<n;i++){const k0=i/n,k1=(i+.55)/n,yo=k=>yo1-(yo1-yo0)*k,yi=k=>yi1-(yi1-yi0)*k;
    o+=H.path(`M${X(xo+10)} ${H.r2(yo(k0))}L${X(xi)} ${H.r2(yi(k0))}L${X(xi)} ${H.r2(yi(k1))}L${X(xo+10)} ${H.r2(yo(k1))}Z`,{fill:i<on?col:'#1d2025',op:i<on?.35+.65*i/n:1});}
   // 바깥 빨간 띠 (값만큼 아래에서 위로)
   const yF=yo1-(yo1-yo0)*H.clamp(f);
   o+=H.rect(dir<0?X(xo)-2:X(xo)-6,yo0,8,yo1-yo0,{fill:'#2a0d11'})+H.rect(dir<0?X(xo)-2:X(xo)-6,yF,8,yo1-yF,{fill:red});
   o+=H.line(X(xi),yi0,X(xi),yi1,{stroke:'#2f333a',sw:1});
   return o;};
  // 주 값 (안쪽 모서리에서 36px)
  const rateRead=H.text(334,232,H.fmt.m(d.rate),{size:68,fill:ink,font:'avenir',weight:300,anchor:'start'})
   +tx(H,337,262,[['토큰 속도',{fill:red,weight:600}],['M tokens/시간',{fill:sub}]],{anchor:'start'});
  s+=tx(H,337,288,[['남은 한도',{fill:sub,size:13}],[Math.round(d.minLeft)+'%',{fill:ink,weight:600}]],{anchor:'start'});
  const burnRead=H.text(946,232,H.fmt.burn(d.burn),{size:68,fill:ink,font:'avenir',weight:300,anchor:'end'})
   +tx(H,943,262,[['소진 속도',{fill:ink,weight:600}],['%/시간',{fill:sub}]],{anchor:'end'});
  s+=H.cl('gauge','rate',plane(-1,H.frac.rate(d),red)+rateRead)+H.cl('gauge','burn',plane(1,H.frac.burn(d),'#b9bec5')+burnRead);
  s+=tx(H,943,288,[['작업 가능',{fill:sub,size:13}],[H.fmt.hours(d.rangeH),{fill:ink,weight:600}]],{anchor:'end'});
  // 가운데 토큰 흐름
  s+=flow(H,556,180,168,118,{id:'30',color:red,base:'#2c2f35',areaOp:.2});
  s+=H.text(640,324,'토큰 흐름',{size:13,fill:sub});
  // 위 줄 (y 140): 경고등은 왼쪽 값 열, 기어는 가운데, 시계는 오른쪽 값 열에 맞춥니다
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,345+i*36,135,18,'#2c3036');});
  s+=gears(H,d,640,140,{gap:42,size:15,on:ink,off:mute,bar:red,width:320});
  s+=tx(H,943,140,[[d.clock,{fill:ink,weight:600}],[`CPU ${Math.round(d.cpu)}%`,{fill:sub,dx:10}]],{anchor:'end'});
  // 아래 줄 (y 384)
  s+=tx(H,337,384,[['누적',{fill:sub,size:13}],[H.fmt.odo(d.odo)+' M',{fill:ink,weight:600}]],{anchor:'start'});
  {const x=337+tw('누적',13)+8+tw(H.fmt.odo(d.odo)+' M',14,600)+16;s+=H.cl('trip','',tx(H,x,384,[['트립',{fill:sub,size:13}],[H.fmt.trip(d.trip)+'M',{fill:ink,weight:600}]],{anchor:'start'}));}
  s+=H.text(640,384,d.periodLabel+' 평균',{size:13,fill:sub});
  s+=tx(H,943,384,[['엔진 온도',{fill:sub,size:13}],[d.heat+'°',{fill:ink,weight:600}]],{anchor:'end'});
  s+=H.text(1176,384,'1top',{size:12,fill:mute,weight:700,anchor:'end'});
  return s;}});

 // 31 · Genesis GV80 — 화면 양끝에 걸친 큰 원형 계기, 금빛 바늘, 가운데 세션 목록
 O.theme({id:'31',name:'골든 크레센트',about:'와이드 화면 양끝에 큰 원형 계기와 금빛 바늘을 두고, 가운데에 세션 목록을 둔 디지털 구성입니다.',draw(H,d){
  const gold='#e2b04a',ink='#eef2f7',sub='#93a3b9',mute='#5d6f88';
  let s=H.rect(0,0,1280,480,{fill:H.lin('bg',[[0,'#15120e'],[1,'#0a0908']])});
  s+=H.housing('M50 66 Q640 22 1230 66 L1230 438 L50 438Z',{top:'#2b2d31',bottom:'#0e0f11',rim:.13});
  s+=H.path('M62 78 Q640 36 1218 78 L1218 426 L62 426Z',{fill:H.lin('scr',[[0,'#060910'],[1,'#020306']])});
  const ring=H.lin('rg',[[0,'#e6ebf1'],[.5,'#7c8896'],[1,'#c4ccd6']]);
  const CY=246;
  const half=(cx,f,labels,lab,read,rev)=>{
   let o=H.face(cx,CY,160,{fill:'#0b1424',center:'#17273f',edge:'#04070c'})+H.circle(cx,CY,163,{stroke:ring,sw:4});
   // 숫자 고리는 진행 호(151) 안쪽에 두고, 1000처럼 긴 숫자가 들어가지 않으면 눈금 고리(110)를 안으로 옮깁니다
   const lb=rev?labels.slice().reverse():labels,R=fitRing(lb,{a0:-135,sweep:270,size:19,nr:134,to:110,gap:6,lim:153.5});
   o+=H.ticks(cx,CY,R.to,{a0:-135,sweep:270,n:lb.length-1,minor:4,len:12,mlen:6,w:2,mw:1,color:'#e7edf5',mcolor:'#6f809a',red:rev?null:.85,redColor:'#e8574a'});
   o+=R.nums(H,cx,CY,{fill:'#e7edf5',font:'avenir'});
   const ang=rev?135-270*f:-135+270*f;
   o+=H.arc(cx,CY,151,-135,135,{stroke:'#1a2638',sw:3})+H.arc(cx,CY,151,rev?ang:-135,rev?135:ang,{stroke:gold,sw:3});
   o+=H.text(cx,CY+64,read,{size:36,fill:'#fff',font:'avenir',weight:300})+H.text(cx,CY+88,lab,{size:13,fill:sub});
   o+=H.needle(cx,CY,R.to-.5,ang,{style:'taper',w:7,color:gold,tail:14})+H.hub(cx,CY,14,{fill:'#9c7426',light:'#f3d58b'});
   return H.cl('gauge',rev?'burn':'rate',o);};
  s+=half(262,H.frac.rate(d),H.rateScale(d,10),'M tokens/시간',H.fmt.m(d.rate),false)+half(1018,H.frac.burn(d),H.burnScale(d,10),'소진 %/시간',H.fmt.burn(d.burn),true);
  // 가운데 열 (x 504–776, 축 640)
  const X0=504,X1=776;
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,568+i*42,104,18,'#2a3850');});
  s+=gears(H,d,640,146,{gap:44,size:14,on:gold,off:mute,width:X1-X0});
  s+=H.line(X0,166,X1,166,{stroke:'#1f2b3c',sw:1});
  s+=tx(H,X0,192,[['세션',{fill:sub,size:13}],[`${d.sessions.working} 작업 중 · ${d.sessions.waiting} 응답 대기`,{fill:ink,weight:600,size:15}]],{anchor:'start'});
  s+=H.sessions(X0,218,X1-X0,{rows:4,size:13,lh:25,fill:'#cdd7e4',dim:'#8696ac',wait:gold});
  s+=H.line(X0,312,X1,312,{stroke:'#1f2b3c',sw:1});
  s+=kv(H,X0,X1,338,'남은 한도',Math.round(d.minLeft)+'%',{lf:sub,vf:ink});
  s+=kv(H,X0,X1,362,'작업 가능',H.fmt.hours(d.rangeH),{lf:sub,vf:ink});
  s+=kv(H,X0,X1,386,'엔진 온도',d.heat+'°',{lf:sub,vf:ink});
  {const od='누적 '+H.fmt.odo(d.odo)+' M';s+=H.text(X0,410,od,{size:13,fill:sub,anchor:'start'})+H.cl('trip','',H.text(X0+tw(od,13)+18,410,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:sub,anchor:'start'}));}
  s+=H.text(X1,410,'1top',{size:12,fill:mute,weight:700,anchor:'end'});
  return s;}});

 // 32 · Mazda RX-7 FD — 가운데 큰 회전계, 왼쪽에 같은 크기 보조 계기 셋, 주황 조명
 O.theme({id:'32',name:'로터리 오렌지',about:'가운데 큰 회전계를 중심으로 왼쪽에 같은 크기 보조 계기 셋을 삼각으로 모으고, 검은 면에 주황 조명 숫자를 밝혔습니다.',draw(H,d){
  const orange='#ff8a2a',dim='#b8651f',face='#0d0806';
  let s=H.rect(0,0,1280,480,{fill:'#030303'});
  s+=H.housing('M26 470 C42 92 312 18 640 18 C968 18 1238 92 1254 470Z',{top:'#211f1d',bottom:'#070707',rim:.09});
  const base={tone:'black',faceFill:face,center:'#1b0f08',edge:'#040302',tick:orange,num:orange,needle:'#ff4a1a',hub:{fill:'#2a2522',light:'#6a5a4a'},font:'helv'};
  // 보조 계기 셋: 모두 r 62, 삼각 배치 (원본: 연료 · 유압 · 수온)
  const small=(cx,cy,f,lab,l0,l1)=>dial(H,{...base,cx,cy,r:62,f,labels:[l0,'','',l1],a0:-60,sweep:120,minor:1,ns:13,nw:600,nr:.78,to:.6,fit:true,tl:6,ml:3,nwid:4,tail:7,hubR:6,red:.75,redColor:'#ff3a1a',bw:10,
   inner:H.text(cx,cy+30,lab,{size:13,fill:orange})});
  s+=small(312,154,H.frac.cpu(d),'CPU','0','100');
  s+=H.cl('gauge','fuel',small(168,262,H.frac.min(d),'남은 한도','E','F'));
  s+=H.cl('gauge','heat',small(312,370,H.frac.heat(d),'엔진 온도','C','H'));
  // 가운데 회전계 = 토큰 속도
  const TX=590,TY=236;
  s+=H.cl('gauge','rate',dial(H,{...base,cx:TX,cy:TY,r:168,f:H.frac.rate(d),labels:H.rateScale(d,10),ns:21,nw:600,red:.8,redColor:'#ff2a1a',nwid:9,bw:16,fit:true,
   inner:H.text(TX,TY+70,H.fmt.m(d.rate),{size:36,fill:orange,font:'helv',weight:600})+H.text(TX,TY+94,'토큰 속도 · M tokens/시간',{size:13,fill:dim})}));
  // 오른쪽 = 소진 속도 + LCD
  const SX=968,SY=246,cruiseA=d.cruise!=null?-135+270*H.clamp(d.cruise/d.burnMax):null;
  s+=H.cl('gauge','burn',dial(H,{...base,cx:SX,cy:SY,r:156,f:H.frac.burn(d),labels:H.burnScale(d,10),ns:19,nw:600,red:.8,redColor:'#ff2a1a',nwid:8,bw:16,fit:true,
   under:cruiseA==null?'':(()=>{const [x1,y1]=H.pt(SX,SY,90,cruiseA),[x2,y2]=H.pt(SX,SY,80,cruiseA);return H.line(x1,y1,x2,y2,{stroke:'#f4efe8',sw:4,cap:'round'});})(),
   inner:H.text(SX,SY+48,'소진 속도 · %/시간',{size:13,fill:dim})+H.path(rr(SX-52,SY+60,104,56,5),{fill:'#120803',stroke:'#3a2412'})+H.seg(SX,SY+67,H.fmt.burn(d.burn),18,{fill:orange,anchor:'middle',dim:'#24120a'})+H.seg(SX,SY+93,H.fmt.odo(d.odo,6),14,{fill:orange,anchor:'middle',dim:'#24120a'})}));
  // 아래 띠: 기어는 회전계 축, 경고등은 속도계 축에 맞춥니다
  s+=gears(H,d,TX,452,{gap:42,size:14,on:orange,off:'#9a6232',width:300});
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,SX-63+i*42,447,18,'#3a322c');});
  s+=H.cl('trip','',H.text(1136,452,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:dim,anchor:'end'}));
  s+=H.text(1176,452,'1top',{size:12,fill:'#8a5a2c',weight:700,anchor:'end'});
  return s;}});

 // 33 · Subaru WRX STI 2005 — 두꺼운 은빛 링 세 개, 가운데 높이 솟은 회전계, 붉은 숫자
 O.theme({id:'33',name:'실버 트리플',about:'두꺼운 은빛 링 세 개를 나란히 두고 가운데 회전계를 높이 올렸으며, 검은 면에 붉은 숫자와 바늘을 밝혔습니다.',draw(H,d){
  const red='#ff2d2d',dim='#c43a3a';
  let s=H.rect(0,0,1280,480,{fill:'#0a0b0c'});
  s+=H.housing('M46 470 C66 104 330 22 640 22 C950 22 1214 104 1234 470Z',{top:'#2a2d30',bottom:'#0b0c0d',rim:.09});
  const face={faceFill:'#0d0d0e',center:'#1a1a1a',edge:'#050505'};
  const base={tone:'chrome',bw:40,...face,tick:red,num:red,needle:red,hub:{fill:'#2a2a2c',light:'#707278'},font:'helv'};
  const LX=300,RX=980,SY=290,SR=126;
  // 왼쪽: 남은 한도 · 엔진 온도 보조 계기 + 작업 가능 창
  s+=H.bezel(LX,SY,SR,40,{tone:'chrome'})+H.face(LX,SY,SR,face);
  const mini=(cx,cy,f,lab,l0,l1)=>H.circle(cx,cy,48,{fill:'#121213',stroke:'#2a2a2c',sw:1.5})+dial(H,{cx,cy,r:48,f,labels:[l0,'',l1],a0:-65,sweep:130,minor:1,faceFill:null,tick:red,num:red,ns:13,nw:600,nr:.78,to:.58,tl:6,ml:3,needle:red,nwid:3.5,tail:6,hubR:5,hub:{fill:'#2a2a2c'},glass:false,
   inner:H.text(cx,cy+28,lab,{size:13,fill:red})});
  s+=H.cl('gauge','fuel',mini(LX-54,SY-14,H.frac.min(d),'남은 한도','E','F'))+H.cl('gauge','heat',mini(LX+54,SY-14,H.frac.heat(d),'엔진 온도','C','H'));
  s+=H.text(LX,SY-82,'1top',{size:12,fill:'#8c8c90',weight:700});
  s+=H.path(rr(LX-64,SY+48,128,32,4),{fill:'#160505',stroke:'#2e0c0c'})+H.text(LX,SY+69,'작업 가능 '+H.fmt.hours(d.rangeH),{size:14,fill:red,weight:600});
  s+=H.cl('trip','',H.text(LX,SY+100,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:dim}));
  s+=glass(H,LX,SY,SR,.05);
  // 오른쪽: 소진 속도 + LCD
  s+=H.cl('gauge','burn',dial(H,{...base,cx:RX,cy:SY,r:SR,f:H.frac.burn(d),labels:H.burnScale(d,5),ns:20,nw:600,nwid:6,
   inner:H.text(RX,SY+34,'소진 %/시간',{size:13,fill:dim})+H.path(rr(RX-46,SY+46,92,50,4),{fill:'#160505',stroke:'#2e0c0c'})+H.seg(RX,SY+52,H.fmt.burn(d.burn),17,{fill:red,anchor:'middle',dim:'#2a0a0a'})+H.seg(RX,SY+76,H.fmt.odo(d.odo,6),13,{fill:red,anchor:'middle',dim:'#2a0a0a'})}));
  // 가운데: 토큰 속도 (위로 올림)
  const CX=640,CY=222;
  s+=H.cl('gauge','rate',dial(H,{...base,cx:CX,cy:CY,r:158,f:H.frac.rate(d),labels:H.rateScale(d,10,{every:2}),ns:22,nw:600,nwid:8,red:.85,redColor:'#ff5a3a',fit:true,
   inner:H.text(CX,CY+66,H.fmt.m(d.rate),{size:36,fill:red,font:'helv',weight:600})+H.text(CX,CY+90,'M tokens/시간',{size:13,fill:dim})}));
  // 회전계 아래 정보 띠 (원본: REV·TRIP 사이 경고등 창)
  s+=well(H,rr(436,410,408,42,6),[436,410,408,42],{id:'strip',top:'#020202',bottom:'#141414'});
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,464+i*34,431,18,'#3a1a1a',{waiting:'#ff8a2a'});});
  s+=H.line(586,420,586,442,{stroke:'#2a2a2a',sw:1});
  s+=gears(H,d,716,436,{gap:39,size:14,on:red,off:'#9a4444',bar:false,width:248});
  return s;}});

 // 34 · Mitsubishi Lancer Evolution IX — 회색 사각 하우징, 붉은 안쪽 링 큰 계기 둘, 오른쪽 작은 계기와 경고등 원
 O.theme({id:'34',name:'랠리 레드링',about:'회색 사각 하우징 안에 붉은 안쪽 링을 두른 큰 계기 둘과, 오른쪽에 작은 계기 둘과 경고등 원을 모았습니다.',draw(H,d){
  const red='#ff3030',dim='#c94040';
  let s=H.rect(0,0,1280,480,{fill:'#0d0d0e'});
  s+=H.housing('M40 44 L1240 44 L1218 452 L62 452Z',{top:'#8a8d91',bottom:'#3f4245',rim:.3});
  s+=well(H,'M64 66 L1216 66 L1197 432 L83 432Z',[64,66,1152,366],{id:'face',top:'#2a2d30',bottom:'#4a4d51',shadow:.6,lip:.18});
  // 원본의 어두운 차양 탭 (계기 사이 위쪽)
  const tab=x=>H.path(`M${x-34} 66 L${x+34} 66 L${x+18} 92 L${x-18} 92Z`,{fill:'#1e2023'});
  s+=tab(436)+tab(770);
  const ring=(cx,cy,r)=>H.circle(cx,cy,r-2.5,{stroke:red,sw:2});
  const base={tone:'satin',bw:22,faceFill:'#0e0e0f',center:'#1a1a1a',edge:'#060606',tick:red,num:red,needle:red,hub:{fill:'#262626',light:'#6a6a6a'},font:'helv'};
  // 왼쪽 = 소진 속도
  s+=H.cl('gauge','burn',dial(H,{...base,cx:270,cy:256,r:144,f:H.frac.burn(d),labels:H.burnScale(d,10),minor:1,ns:18,nw:600,nr:.82,nwid:7,under:ring(270,256,144),
   inner:H.text(270,302,'소진 %/시간',{size:13,fill:dim})+H.text(270,336,H.fmt.burn(d.burn),{size:28,fill:red,font:'helv',weight:600})}));
  // 가운데 = 토큰 속도
  s+=H.cl('gauge','rate',dial(H,{...base,cx:602,cy:252,r:156,f:H.frac.rate(d),labels:H.rateScale(d,5),ns:22,nw:600,nr:.82,nwid:8,fit:true,red:.8,redColor:'#ff6a3a',under:ring(602,252,156),
   inner:H.text(602,298,H.fmt.m(d.rate),{size:30,fill:red,font:'helv',weight:600})+H.text(602,318,'M tokens/시간',{size:13,fill:dim})+H.path(rr(540,330,124,50,4),{fill:'#1b0505',stroke:'#3a1010'})+H.text(602,350,'작업 가능 '+H.fmt.hours(d.rangeH),{size:13,fill:red,weight:600})+H.seg(602,358,H.fmt.odo(d.odo,6),14,{fill:red,anchor:'middle',dim:'#2a0808'})}));
  // 오른쪽 작은 계기 둘 (축 x 874)
  const small=(cx,cy,f,lab,l0,l1)=>dial(H,{...base,cx,cy,r:62,bw:12,f,labels:[l0,'',l1],a0:-70,sweep:140,minor:1,ns:14,nw:600,nr:.78,to:.6,tl:7,ml:4,nwid:4,tail:7,hubR:6,glass:false,
   under:ring(cx,cy,62),inner:H.text(cx,cy+32,lab,{size:13,fill:red})});
  s+=H.cl('gauge','heat',small(874,166,H.frac.heat(d),'엔진 온도','C','H'));
  s+=H.cl('gauge','fuel',small(874,342,H.frac.min(d),'남은 한도','E','F'));
  // 경고등 원 (원본: 경고등과 차명 글자가 든 작은 원) — 축 x 1072
  const WX=1072,WY=226;
  s+=H.bezel(WX,WY,70,12,{tone:'satin'})+H.face(WX,WY,70,{fill:'#0e0e0f',edge:'#060606'})+ring(WX,WY,70);
  s+=lamp(H,d,'waiting',WX-20,WY-30,20,'#3a2a2a')+lamp(H,d,'reconnect',WX+20,WY-30,20,'#3a2a2a');
  s+=H.text(WX,WY+5,'1top',{size:13,fill:red,weight:700,base:'central'});
  s+=lamp(H,d,'empty',WX-20,WY+38,20,'#3a2a2a')+lamp(H,d,'late',WX+20,WY+38,20,'#3a2a2a');
  s+=glass(H,WX,WY,70,.05);
  // 트립 (경고등 원과 기어 창 사이, 같은 축)
  s+=H.cl('trip','',H.text(WX,334,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:dim}));
  // 기어 줄 (경고등 원 축 아래). 기어가 7개면 창을 하우징 안쪽 여백까지 넓힙니다.
  const GW=Math.min(228,Math.max(216,d.gears.length*31+10));
  s+=well(H,rr(WX-GW/2,354,GW,38,6),[WX-GW/2,354,GW,38],{id:'gear',top:'#141516',bottom:'#232527'});
  s+=gears(H,d,WX,378,{gap:33,size:13,on:'#fff',off:'#9a9da1',bar:false,width:GW-12});
  return s;}});

 // 35 · Alfa Romeo Giulia Quadrifoglio — 깊은 원통형 후드 두 개, 안쪽 깊이 앉은 계기, 가운데 화면
 O.theme({id:'35',name:'트윈 터널',about:'깊은 원통형 후드 두 개 안쪽에 계기를 깊숙이 앉히고, 가운데 화면에 기간과 정보를 모았습니다.',draw(H,d){
  const red='#e8302a',ink='#f2f2f2',sub='#9a9a9a';
  let s=H.rect(0,0,1280,480,{fill:'#030303'});
  s+=H.housing('M26 472 C36 136 300 56 640 66 C980 56 1244 136 1254 472Z',{top:'#161618',bottom:'#09090a',rim:.07});
  const tunnel=(cx,cy)=>{const k=.96,a=v=>H.r2(v*k);
   // 후드 아래 끝은 하우징 아래 테(472) 위 26px에서 둥글게 닫습니다.
   const sh=`M${cx-a(215)} ${cy+150} C${cx-a(225)} ${cy-135} ${cx-a(135)} ${cy-200} ${cx} ${cy-200} C${cx+a(135)} ${cy-200} ${cx+a(225)} ${cy-135} ${cx+a(215)} ${cy+150} C${cx+a(212)} 446 ${cx+a(196)} 446 ${cx+a(176)} 446 L${cx-a(176)} 446 C${cx-a(196)} 446 ${cx-a(212)} 446 ${cx-a(215)} ${cy+150}Z`;
   const t=H.rad2('t'+cx,[[0,'#000'],[.55,'#080808'],[.8,'#1b1b1d'],[.93,'#333336'],[1,'#0a0a0a']]);
   const cl=H.clip('tc'+cx,`<path d="${sh}"/>`);
   let rings='';for(let k2=0;k2<4;k2++)rings+=H.circle(cx,cy,182-k2*13,{stroke:'#19191b',sw:6-k2});
   return H.path(sh,{fill:t,filter:H.shadow('ts'+cx,6,10,.6)})+H.g(rings,{clip:cl})+H.path(`M${cx-a(200)} ${cy-20} C${cx-a(185)} ${cy-140} ${cx-a(110)} ${cy-190} ${cx} ${cy-190} C${cx+a(110)} ${cy-190} ${cx+a(185)} ${cy-140} ${cx+a(200)} ${cy-20}`,{stroke:H.lin('rim'+cx,[[0,'#e2e4e6'],[1,'#5c5f63']],{dir:[0,0,0,1]}),sw:6,cap:'round'});};
  s+=tunnel(320,270)+tunnel(960,270);
  const base={faceFill:'#060606',center:'#0f0f10',edge:'#030303',tick:ink,num:ink,needle:'#f4f4f4',nstyle:'baton',nwid:5,hub:{fill:'#1a1a1a',light:'#5a5a5c'},font:'helv',ns:18,nw:500,to:.68,nr:.87};
  const pod=(cx,f,labels,read,lab,red2)=>H.circle(cx,275,131,{stroke:'#2a2a2c',sw:4})+dial(H,{...base,cx,cy:275,r:128,f,labels,red:red2,redColor:red,fit:3,lim:128.5,
   inner:H.text(cx,275+52,read,{size:30,fill:'#fff',font:'helv',weight:500})+H.text(cx,275+74,lab,{size:13,fill:sub})});
  s+=H.cl('gauge','rate',pod(320,H.frac.rate(d),H.rateScale(d,10,{every:2}),H.fmt.m(d.rate),'M tokens/시간',.8));
  s+=H.cl('gauge','burn',pod(960,H.frac.burn(d),H.burnScale(d,10,{every:2}),H.fmt.burn(d.burn),'소진 %/시간',null));
  // 가운데 화면 (두 후드 사이, 축 640)
  const X0=562,X1=718;
  s+=H.path(rr(546,138,188,250,10),{fill:'#000'})+H.path(rr(550,142,180,242,7),{fill:H.lin('scr',[[0,'#0c0d10'],[1,'#060708']])});
  s+=H.text(X0,166,d.clock,{size:13,fill:ink,weight:600,anchor:'start'})+H.text(640,166,'1top',{size:12,fill:'#8a2a2a',weight:700})+H.text(X1,166,`CPU ${Math.round(d.cpu)}%`,{size:13,fill:ink,weight:600,anchor:'end'});
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,595+i*30,192,16,'#2c2c2e');});
  s+=H.text(640,248,d.period,{size:46,fill:'#fff',font:'helv',weight:500});
  s+=H.text(640,272,d.periodLabel+' 평균',{size:13,fill:sub});
  s+=H.rect(X0,286,X1-X0,2,{fill:red});
  s+=kv(H,X0,X1,309,'남은 한도',Math.round(d.minLeft)+'%',{lf:sub,vf:ink});
  s+=kv(H,X0,X1,330,'작업 가능',H.fmt.hours(d.rangeH),{lf:sub,vf:ink});
  s+=kv(H,X0,X1,351,'엔진 온도',d.heat+'°',{lf:sub,vf:ink});
  s+=H.cl('trip','',kv(H,X0,X1,372,'트립',H.fmt.trip(d.trip)+'M',{lf:sub,vf:ink}));
  // 기어 줄: 화면 아래, 같은 축 (두 후드 사이 폭 안)
  s+=gears(H,d,640,424,{gap:36,size:14,on:'#fff',off:'#7a7a7a',bar:red,width:220});
  return s;}});

 // 36 · Maserati GranTurismo — 타원 후드 둘, 크롬 링 파란 다이얼과 겹친 보조 계기, 가운데 회색 정보창
 O.theme({id:'36',name:'블루 투어러',about:'타원 후드 두 개 안에 크롬 링을 두른 파란 다이얼과 바깥쪽에 겹친 작은 보조 계기를 넣고, 가운데 다리에 회색 정보창을 두었습니다.',draw(H,d){
  const ink='#f3f6fb',sub='#a9b0b8',lcdInk='#1b1e1c',lcdSub='#3d443e';
  let s=H.rect(0,0,1280,480,{fill:'#141518'});
  // 가운데 다리 → 타원 후드 둘
  // 기어가 7개 이상이면 다리를 조금 넓혀 기어 줄이 다리 안에 들게 합니다
  const many=d.gears.length>6,BW=many?256:220;
  s+=H.housing(rr(640-BW/2,96,BW,330,22),{top:'#26282c',bottom:'#0d0e10',rim:.1});
  const pod=cx=>{const e=`M${cx-246} 250 A246 190 0 1 1 ${cx+246} 250 A246 190 0 1 1 ${cx-246} 250Z`,ei=`M${cx-232} 250 A232 176 0 1 1 ${cx+232} 250 A232 176 0 1 1 ${cx-232} 250Z`;
   return H.housing(e,{top:'#2f3135',bottom:'#0c0d0f',rim:.14})+well(H,ei,[cx-232,74,464,352],{id:'pod'+cx,top:'#050506',bottom:'#16171a'});};
  s+=pod(332)+pod(948);
  const base={tone:'chrome',bw:12,faceFill:'#1d3c84',center:'#2f5aa8',edge:'#0b1a42',tick:ink,num:ink,font:'helv',nw:500,needle:'#f1f3f6',nstyle:'lance',hub:{fill:'#9aa0a8',light:'#eef1f4'}};
  // 보조 계기 (바깥쪽 아래, 큰 다이얼 테두리 뒤로 25px 들어감). 이름은 계기 축 아래 후드 면에 둡니다.
  const sub2=(cx,f,a0,labels,lab,k)=>H.cl('gauge',k,dial(H,{...base,cx,cy:292,r:56,bw:8,f,labels,a0,sweep:120,minor:1,ns:14,nr:.72,to:.5,tl:6,ml:3,nwid:4,tail:6,hubR:6,glass:false})
   +H.text(cx,292+84,lab,{size:13,fill:sub}));
  s+=sub2(196,H.frac.min(d),-150,['E','½','F'],'남은 한도','fuel');
  s+=sub2(1084,H.frac.heat(d),30,['C','','H'],'엔진 온도','heat');
  // 큰 다이얼 둘 (보조 계기 앞)
  const big=(cx,f,labels,read,lab,k)=>H.cl('gauge',k,H.circle(cx,252,140,{fill:'#000',op:.5,filter:H.shadow('bs'+cx,3,6,.7)})+dial(H,{...base,cx,cy:250,r:132,f,labels,a0:-130,sweep:260,ns:20,nr:.86,to:.66,nwid:7,fit:3,lim:133.5,
   inner:H.text(cx,250+58,read,{size:32,fill:'#fff',font:'helv',weight:500})+H.text(cx,250+80,lab,{size:13,fill:'#c9d8f4'})}));
  s+=big(362,H.frac.rate(d),H.rateScale(d,5),H.fmt.m(d.rate),'M tokens/시간','rate');
  s+=big(918,H.frac.burn(d),H.burnScale(d,5),H.fmt.burn(d.burn),'소진 %/시간','burn');
  // 가운데 정보창 (축 640)
  s+=well(H,rr(560,118,160,200,8),[560,118,160,200],{id:'lcdw',top:'#0a0b0c',bottom:'#1c1e21'});
  s+=H.path(rr(568,126,144,184,4),{fill:H.lin('lcd',[[0,'#b2b9ae'],[1,'#8e958b']])});
  const X0=580,X1=700;
  s+=H.text(640,162,d.period,{size:30,fill:lcdInk,font:'helv',weight:600})+H.text(640,184,d.periodLabel+' 평균',{size:13,fill:lcdSub});
  s+=H.line(X0,198,X1,198,{stroke:'#6f766d',sw:1});
  s+=kv(H,X0,X1,222,'남은 한도',Math.round(d.minLeft)+'%',{lf:lcdSub,vf:lcdInk});
  s+=kv(H,X0,X1,246,'작업 가능',H.fmt.hours(d.rangeH),{lf:lcdSub,vf:lcdInk});
  s+=H.cl('trip','',kv(H,X0,X1,270,'트립',H.fmt.trip(d.trip)+'M',{lf:lcdSub,vf:lcdInk}));
  s+=H.text(X0,294,H.fmt.odo(d.odo)+' M',{size:13,fill:lcdSub,anchor:'start'})+H.text(X1,294,'1top',{size:12,fill:lcdSub,weight:700,anchor:'end'});
  // 다리 위 기어 · 경고등 (같은 축)
  // 기어가 7개 이상이면 다리가 더 넓은 아래 줄(392)로 기어를, 위 줄(354)로 경고등을 바꿉니다
  const GY=many?392:354,LY=many?350:392;
  s+=gears(H,d,640,GY,{gap:many?34:31,size:14,on:'#9fc0f4',off:'#7c828c',width:many?BW-16:196});
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,583+i*38,LY,18,'#3c3f45');});
  return s;}});

 // 37 · Cadillac Escalade 2021 — 가로로 넓은 곡면 OLED, 가운데 큰 원과 큰 숫자, 아래 양쪽 가로 눈금
 O.theme({id:'37',name:'OLED 파노라마',about:'가로로 길게 휜 OLED 화면 가운데 큰 원과 큰 숫자를 두고, 양쪽 아래에 소진 속도와 남은 한도 가로 눈금을 펼쳤습니다.',draw(H,d){
  const blue='#4aa3ff',ink='#e6eaf0',sub='#8e97a3',mute='#59616c';
  let s=H.rect(0,0,1280,480,{fill:'#000'});
  s+=H.housing('M36 112 Q640 24 1244 112 L1244 408 Q640 390 36 408Z',{top:'#2a2c30',bottom:'#121315',rim:.16});
  s+=H.path('M50 122 Q640 38 1230 122 L1230 394 Q640 376 50 394Z',{fill:'#000',stroke:'#3c4048',sw:1.5});
  // 가운데 큰 원 (토큰 속도)
  const cx=640,cy=238,f=H.frac.rate(d),a=-150+300*f;
  // 바깥부터: 진행 호(144) → 숫자 고리(123) → 눈금(92–104) → 바늘(70–104) → 가운데 원(66)
  {const RG=fitRing(H.rateScale(d,10),{a0:-150,sweep:300,size:14,nr:123,to:104,gap:5,lim:140});let g='';
  g+=H.arc(cx,cy,144,-150,150,{stroke:'#1a1e25',sw:3})+H.arc(cx,cy,144,-150,a,{stroke:blue,sw:3});
  g+=H.ticks(cx,cy,RG.to,{a0:-150,sweep:300,n:10,minor:1,len:12,mlen:6,w:2,mw:1,color:'#d7dde5',mcolor:'#4d5560'});
  g+=RG.nums(H,cx,cy,{fill:'#aeb6c1',font:'helv'});
  {const [x1,y1]=H.pt(cx,cy,70,a),[x2,y2]=H.pt(cx,cy,RG.to,a);g+=H.line(x1+1,y1+1.5,x2+1,y2+1.5,{stroke:'#000',sw:3,cap:'round',op:.5})+H.line(x1,y1,x2,y2,{stroke:'#fff',sw:3,cap:'round'});}
  g+=H.circle(cx,cy,66,{fill:'#000',stroke:'#d7dde5',sw:2});
  g+=H.text(cx,cy+14,H.fmt.m(d.rate),{size:46,fill:'#fff',font:'helv',weight:300});
  g+=H.text(cx,cy+38,'M tokens/시간',{size:13,fill:sub});
  s+=H.cl('gauge','rate',g);}
  // 양쪽 칸: 라벨 줄(14) → 큰 값(46) → 보조 줄(14) → 가로 눈금 → 아래 줄. 두 칸이 같은 기준선을 씁니다.
  const LX0=150,LX1=470,RX0=810,RX1=1130,YL=160,YH=214,YS=252,yb=322,YB=370;
  let fuelG='';
  const wid=(t,z)=>[...t].reduce((w,c)=>w+(c==='.'?.278:/[0-9]/.test(c)?.556:.6),0)*z;
  const hero=(x,v,u)=>H.text(x,YH,v,{size:46,fill:'#fff',font:'helv',weight:300,anchor:'start'})+H.text(x+wid(v,46)+8,YH,u,{size:16,fill:sub,anchor:'start'});
  // 왼쪽: 소진 속도
  {let g=H.text(LX0,YL,'소진 속도',{size:14,fill:sub,anchor:'start'})+(d.cruise!=null?H.text(LX1,YL,'적정 '+H.fmt.burn(d.cruise)+' %/시간',{size:14,fill:sub,anchor:'end'}):'');
  g+=hero(LX0,H.fmt.burn(d.burn),'%/시간');
  // 가로 눈금: 10칸, 2칸마다 숫자, 끝 20%는 빨간 구간
  const BL=H.burnScale(d,10,{every:2});
  g+=H.line(LX0,yb,LX1,yb,{stroke:'#2e333b',sw:2});
  for(let i=0;i<=10;i++){const x=LX0+(LX1-LX0)*i/10,hot=i>=8;g+=H.line(x,yb,x,yb-(i%2?5:10),{stroke:hot?'#ff4a3a':'#c9d0d9',sw:i%2?1:1.6});if(BL[i])g+=H.text(x,yb+20,BL[i],{size:13,fill:hot?'#ff6a5a':sub,font:'helv'});}
  g+=H.rect(LX0,yb-2,(LX1-LX0)*H.frac.burn(d),4,{fill:blue});
  if(d.cruise!=null){const xc=LX0+(LX1-LX0)*H.clamp(d.cruise/d.burnMax);g+=H.path(`M${H.r2(xc)} ${yb-13}l-4 -7h8z`,{fill:ink})}
  s+=H.cl('gauge','burn',g);}
  s+=H.sessions(LX0,YS,LX1-LX0,{rows:2,size:14,lh:26,fill:'#cfd5dd',dim:'#8a929d'});
  // 오른쪽: 남은 한도
  {let s='';s+=H.text(RX0,YL,'남은 한도',{size:14,fill:sub,anchor:'start'})+H.text(RX1,YL,'작업 가능 '+H.fmt.hours(d.rangeH),{size:14,fill:ink,anchor:'end'});
  const nF=d.fuel.length;
  s+=nF?hero(RX0,String(Math.round(d.minLeft)),'%'):H.text(RX0,YH,'—',{size:46,fill:'#fff',font:'helv',weight:300,anchor:'start'});
  // 계정 줄: 3개까지는 한 줄 세 칸(이름 위, 막대 아래). 4개부터는 두 열 세 줄(이름·%·가는 막대)로 바꾸고, 7개부터는 앞 5개와 '+K'를 보여 줍니다.
  if(!nF)s+=H.text(RX0,YS,'계정 없음',{size:14,fill:sub,anchor:'start',base:'central'});
  else if(nF<=3&&fuelNames(d.fuel).every(n=>tw(n,14)<=60)){const {rows}=fuelFit(d.fuel,3);rows.forEach((fu,i)=>{const x=RX0+i*114,w=92;s+=H.text(x,YS,fu.name,{size:14,fill:'#c6ccd4',anchor:'start',base:'central'})+H.text(x+w,YS,fu.left+'%',{size:14,fill:ink,anchor:'end',base:'central'});
   s+=H.rect(x,YS+20,w,4,{r:2,fill:'#1a1e24'})+H.rect(x,YS+20,w*fu.left/100,4,{r:2,fill:fu.left<40?'#ff9a2a':blue});});}
  else{const {rows,more}=fuelFit(d.fuel,6),CW=(RX1-RX0-24)/2,Y0=236,P=26;
   rows.forEach((fu,i)=>{const x=RX0+(i%2)*(CW+24),y=Y0+Math.floor(i/2)*P;s+=H.text(x,y,fu.name,{size:13,fill:'#c6ccd4',anchor:'start',base:'central'})+H.text(x+CW,y,fu.left+'%',{size:13,fill:ink,anchor:'end',base:'central'});
    s+=H.rect(x,y+10,CW,3,{r:1.5,fill:'#1a1e24'})+H.rect(x,y+10,CW*fu.left/100,3,{r:1.5,fill:fu.left<40?'#ff9a2a':blue});});
   if(more){const i=rows.length;s+=H.text(RX0+(i%2)*(CW+24),Y0+Math.floor(i/2)*P,`+${more}`,{size:13,fill:sub,anchor:'start',base:'central'});}}
  s+=H.line(RX0,yb,RX1,yb,{stroke:'#2e333b',sw:2});
  for(let i=0;i<=8;i++){const x=RX0+(RX1-RX0)*i/8;s+=H.line(x,yb,x,yb-(i%2?5:10),{stroke:i===0?'#ff4a3a':'#c9d0d9',sw:i%2?1:1.6});}
  s+=H.text(RX0,yb+20,'E',{size:13,fill:'#ff6a5a',font:'helv'})+H.text(RX0+(RX1-RX0)/2,yb+20,'½',{size:13,fill:sub,font:'helv'})+H.text(RX1,yb+20,'F',{size:13,fill:sub,font:'helv'});
  s+=H.rect(RX0,yb-2,(RX1-RX0)*H.frac.min(d),4,{fill:blue});
  fuelG=H.cl('gauge','fuel',s);}
  s+=fuelG;
  // 아래 줄: 경고등은 왼쪽 눈금 시작, 누적은 왼쪽 끝, 기어는 오른쪽 눈금 축, 1top은 오른쪽 끝
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,LX0+8+i*32,YB-5,16,'#2a2e34');});
  {const tr='트립 '+H.fmt.trip(d.trip)+'M';s+=H.cl('trip','',H.text(LX1,YB,tr,{size:13,fill:sub,anchor:'end'}))+H.text(LX1-tw(tr,13)-16,YB,'누적 '+H.fmt.odo(d.odo)+' M',{size:13,fill:sub,anchor:'end'});}
  s+=gears(H,d,(RX0+RX1)/2-24,YB,{gap:38,size:14,on:'#fff',off:mute,bar:blue,width:270});
  s+=H.text(RX1,YB,'1top',{size:12,fill:mute,weight:700,anchor:'end'});
  return s;}});

 // 38 · Dodge Challenger 1970 — 큰 원 하나와 오른쪽으로 이어지는 작은 원 넷, 주황 바늘
 O.theme({id:'38',name:'머슬 로우',about:'운전석 앞 큰 원 하나와 옆으로 줄지어 이어지는 깊은 작은 원 네 개, 주황 바늘과 브러시드 패널을 옮겼습니다.',draw(H,d){
  const orange='#ff8a1e',ink='#f0eee8',sub='#a8a6a0';
  let s=H.rect(0,0,1280,480,{fill:'#0b0b0c'});
  // 하우징: 큰 원 후드(250, 240, r 190) + 작은 원 줄을 감싼 띠
  const hp='M369 92 H1170 A16 16 0 0 1 1186 108 V388 A16 16 0 0 1 1170 404 H346 A190 190 0 1 1 369 92Z';
  s+=H.housing(hp,{top:'#2c2e31',bottom:'#141517',rim:.13});
  const cl=H.clip('pn',`<path d="${hp}"/>`);
  let br='';for(let y=52;y<430;y+=3)br+=H.line(56,y,1190,y,{stroke:'#fff',sw:.6,op:.022});
  s+=H.g(br,{clip:cl});
  const base={tone:'chrome',faceFill:'#0f0f10',center:'#181818',edge:'#060606',tick:ink,num:ink,needle:orange,nstyle:'bar',hub:{fill:'#222',light:'#666'},font:'helv'};
  // 큰 원 = 토큰 속도
  s+=H.circle(250,240,176,{fill:'#060607'});
  s+=H.cl('gauge','rate',dial(H,{...base,cx:250,cy:240,r:160,bw:12,f:H.frac.rate(d),labels:H.rateScale(d,10,{every:2}),a0:-140,sweep:280,ns:20,nw:500,nwid:6,fit:true,red:.85,redColor:'#e8402a',
   inner:H.text(250,288,'M tokens/시간',{size:13,fill:sub})+H.odo(199,304,H.fmt.odo(d.odo,6),{cw:17,ch:24,bg:'#161616',fg:'#e8e2d0',frame:'#000',font:'helv'})}));
  // 트립: 주행계 바로 아래 (계기 묶음 밖의 형제 요소로 둡니다)
  s+=H.cl('trip','',H.text(250,348,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:sub}));
  // 작은 원 넷 (깊은 컵 안, 같은 크기와 기준선)
  const SY=206,SR=76,XS=[534,714,894,1074];
  const small=(cx,f,labels,lab)=>H.circle(cx,SY,SR+11,{fill:'#060607'})+H.circle(cx,SY,SR+11,{stroke:'#fff',sw:1,op:.06})+dial(H,{...base,cx,cy:SY,r:SR,bw:8,f,labels,a0:-120,sweep:240,minor:1,ns:14,nw:500,nr:.8,to:.62,tl:7,fit:true,ml:4,nwid:4,tail:8,hubR:7,glass:false,
   inner:H.text(cx,SY+40,lab,{size:13,fill:sub})});
  s+=H.cl('gauge','burn',small(XS[0],H.frac.burn(d),H.burnScale(d,5),'소진 %/시간'));
  s+=H.cl('gauge','fuel',small(XS[1],H.frac.min(d),['E','½','F'],'남은 한도'));
  s+=H.cl('gauge','heat',small(XS[2],H.frac.heat(d),['C','','H'],'엔진 온도'));
  s+=small(XS[3],H.frac.cpu(d),['0','50','100'],'CPU');
  // 작은 원 아래 오목한 띠: 기어는 1·2번 원 사이 축, 경고등은 3·4번 원 사이 축
  s+=well(H,rr(442,314,724,72,8),[442,314,724,72],{id:'band',top:'#050506',bottom:'#141517'});
  s+=gears(H,d,(XS[0]+XS[1])/2,356,{gap:42,size:14,on:orange,off:'#86888c',width:340});
  const LC=(XS[2]+XS[3])/2;
  // 아이콘(아래 끝 343)과 이름표(글자 윗선 약 350) 사이를 7px 띄웁니다.
  // 경고등 하나 = 아이콘 + 이름표를 한 칸으로 감쌉니다
  LAMP.forEach(([k,lab,c],i)=>{const n=d.lamps[k],x=LC-1.5*66+i*66;s+=lamp(H,d,k,x,334,18,'#3a3d42',null,H.text(x,360,lab+(n>1?' '+n:''),{size:13,fill:n>0?c:'#6b7077'}));});
  s+=H.text(1152,361,'1top',{size:12,fill:'#7c7e82',weight:700,anchor:'end'});
  return s;}});

 // 39 · Jeep Wrangler JL — 두 원 사이 가운데 컬러 화면, 주황 진행 띠, 화면 양옆 작은 반원 계기 둘
 O.theme({id:'39',name:'트레일 듀오',about:'두 아날로그 원 사이에 컬러 화면을 넣고, 값만큼 차는 주황 띠와 화면 양옆 작은 반원 계기 둘을 더한 오프로더 구성입니다.',draw(H,d){
  const orange='#ff7a1a',ink='#eef0f2',sub='#a3aab3',mute='#80868e';
  let s=H.rect(0,0,1280,480,{fill:H.lin('conc',[[0,'#8a8783'],[1,'#5a5754']])});
  s+=H.housing('M58 250 C58 84 196 44 340 44 L940 44 C1084 44 1222 84 1222 250 C1222 416 1084 456 940 456 L340 456 C196 456 58 416 58 250Z',{top:'#1c1d20',bottom:'#08090a',rim:.13});
  const CY=250;
  const big=(cx,f,labels,lab,read)=>{
   // 진행 띠(바깥) → 눈금 → 숫자 → 가운데 원 + 읽음. 바늘은 가운데 원 밖에서 눈금 끝까지.
   let o=H.bezel(cx,CY,158,14,{tone:'black'})+H.face(cx,CY,158,{fill:'#16181c',center:'#202328',edge:'#0a0b0d'});
   // 바깥부터: 진행 띠(146–152) → 숫자 고리(125) → 눈금(91–105) → 바늘(70–105) → 가운데 원(64)
   o+=H.band(cx,CY,146,152,-135,135,{fill:'#24272c'})+H.band(cx,CY,146,152,-135,-135+270*H.clamp(f),{fill:orange});
   // 1000처럼 긴 숫자는 진행 띠(146) 안에 들도록 눈금 고리(105)를 안으로 옮깁니다
   const RG=fitRing(labels,{a0:-135,sweep:270,size:20,nr:125,to:105,gap:2,lim:147});
   o+=H.ticks(cx,CY,RG.to,{a0:-135,sweep:270,n:labels.length-1,minor:4,len:14,mlen:7,w:2.4,mw:1.2,color:'#eef0f2'});
   o+=RG.nums(H,cx,CY,{fill:'#eef0f2',font:'din'});
   const ang=-135+270*H.clamp(f),[x1,y1]=H.pt(cx,CY,70,ang),[x2,y2]=H.pt(cx,CY,RG.to-.5,ang);
   o+=H.line(x1+1.5,y1+2,x2+1.5,y2+2,{stroke:'#000',sw:6,cap:'round',op:.35})+H.line(x1,y1,x2,y2,{stroke:orange,sw:6,cap:'round'});
   o+=H.circle(cx,CY,64,{stroke:H.lin('rg'+cx,[[0,'#eef1f4'],[1,'#8c929a']]),sw:4})+H.circle(cx,CY,60,{fill:'#0e1013'});
   o+=H.text(cx,CY+8,read,{size:32,fill:'#fff',font:'din'})+H.text(cx,CY+30,lab,{size:13,fill:sub});
   o+=glass(H,cx,CY,158,.04);
   return o;};
  s+=H.cl('gauge','rate',big(282,H.frac.rate(d),H.rateScale(d,5),'M tokens/시간',H.fmt.m(d.rate)));
  s+=H.cl('gauge','burn',big(998,H.frac.burn(d),H.burnScale(d,5),'소진 %/시간',H.fmt.burn(d.burn)));
  // 화면 양옆 작은 반원 계기 (원본: 화면 위 모서리 옆)
  const SY=176,SR=40;
  const semi=(cx,f,lab,l0,l1)=>H.path(`M${cx-SR-6} ${SY+4} A${SR+6} ${SR+6} 0 0 1 ${cx+SR+6} ${SY+4}Z`,{fill:'#2a2c30'})+H.path(`M${cx-SR} ${SY} A${SR} ${SR} 0 0 1 ${cx+SR} ${SY}Z`,{fill:'#121418'})
   +H.ticks(cx,SY,SR-4,{a0:-80,sweep:160,n:4,minor:1,len:7,mlen:4,w:2,mw:1,color:'#eef0f2',red:.8,redColor:orange})
   +H.needle(cx,SY,SR-4.5,-80+160*H.clamp(f),{style:'taper',w:4,color:orange,tail:4})+H.hub(cx,SY,5)+H.text(cx,SY+24,lab,{size:13,fill:sub});
  s+=H.cl('gauge','fuel',semi(500,H.frac.min(d),'남은 한도','E','F'))+H.cl('gauge','heat',semi(780,H.frac.heat(d),'엔진 온도','C','H'));
  // 가운데 컬러 화면 (축 640)
  s+=H.path(rr(564,112,152,264,10),{fill:'#030507',stroke:'#3a3d42',sw:2});
  s+=H.path(rr(570,118,140,252,6),{fill:H.lin('scr',[[0,'#0f2a3e'],[1,'#06121c']])});
  const X0=582,X1=698;
  LAMP.forEach(([k],i)=>{s+=lamp(H,d,k,595+i*30,140,16,'#2a3e50');});
  s+=H.text(640,172,d.periodLabel+' 평균',{size:13,fill:'#9cc4e4'});
  s+=H.text(640,208,d.period,{size:36,fill:'#fff',font:'din'});
  // 계정 줄 (y 222–290): 3개까지 이름이 짧으면 이름·막대·%, 아니면 이름과 %만 네 줄까지(넘치면 앞 3개와 '+K')
  {const nF=d.fuel.length,names=fuelNames(d.fuel);
  if(!nF)s+=H.text(640,256,'계정 없음',{size:13,fill:'#9cc4e4'});
  else if(nF<=3&&names.every(n=>tw(n,13)<=44)){fuelFit(d.fuel,3).rows.forEach((fu,i)=>{const y=238+i*22;s+=H.text(X0,y,fu.name,{size:13,fill:'#cfe0ee',anchor:'start'})+H.rect(X0+46,y-8,34,6,{r:3,fill:'#1b2f40'})+H.rect(X0+46,y-8,34*fu.left/100,6,{r:3,fill:fu.left<40?orange:'#9cc4e4'})+H.text(X1,y,fu.left+'%',{size:13,fill:'#fff',weight:600,anchor:'end'});});}
  else{const {rows,more}=fuelFit(d.fuel,4),P=rows.length+(more?1:0)>3?17:22,Y0=P===17?234:238;
   rows.forEach((fu,i)=>{const y=Y0+i*P;s+=H.text(X0,y,fu.name,{size:13,fill:'#cfe0ee',anchor:'start'})+H.text(X1,y,fu.left+'%',{size:13,fill:fu.left<40?orange:'#fff',weight:600,anchor:'end'});});
   if(more)s+=H.text(X0,Y0+rows.length*P,`+${more}`,{size:13,fill:'#9cc4e4',anchor:'start'});}}
  s+=H.line(X0,296,X1,296,{stroke:'#22405a',sw:1});
  s+=H.text(640,316,'작업 가능 '+H.fmt.hours(d.rangeH),{size:14,fill:'#fff',weight:600});
  s+=H.cl('trip','',H.text(640,337,'트립 '+H.fmt.trip(d.trip)+'M',{size:13,fill:'#fff'}));
  s+=H.text(X0,358,H.fmt.odo(d.odo)+' M',{size:13,fill:'#9cc4e4',anchor:'start'})+H.text(X1,358,'1top',{size:12,fill:'#6f93b3',weight:700,anchor:'end'});
  // 기어 줄: 화면 아래, 같은 축
  s+=gears(H,d,640,416,{gap:38,size:14,on:orange,off:mute,width:340});
  return s;}});
})(window.OneTop);
