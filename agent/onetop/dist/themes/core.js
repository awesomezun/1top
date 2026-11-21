/* 1top 계기판 테마 v3.0.0 — 공용 데이터와 SVG 부품입니다.
   모든 테마는 1280 × 480 좌표 안에 같은 1top 수치를 그립니다.
   - 토큰 속도: 고른 기간의 평균, tokens/시간 (계기 눈금은 M 단위, 0–200M)
   - 소진 속도: 주간 한도를 쓰는 속도, %/시간 (0–20), 적정 속도(크루즈) 표시
   - 기간 기어: 10m · 30m · 1h · 5h · 12h · 24h
   - 경고등: 응답 대기 · 재로그인 · 한도 부족 · 수집 지연
   - 연료: 계정별 남은 주간 한도 %, 작업 가능 시간
   - 주행계: 누적 토큰, 트립: 시작 후 토큰
   - 엔진 온도: 컴퓨터 CPU·메모리 중 높은 값 */
(function(G){
 'use strict';
 const GEARS=['10m','30m','1h','5h','12h','24h'];
 const GEAR_KO={'10m':'최근 10분','30m':'최근 30분','1h':'최근 1시간','5h':'최근 5시간','12h':'최근 12시간','24h':'최근 24시간'};
 // 기간마다 다른 예시 값입니다. 속도는 언제나 그 기간의 평균입니다.
 const DEMO={
  '10m':{rate:124.8e6,burn:4.6,tokens:20.8e6},
  '30m':{rate:108.2e6,burn:3.9,tokens:54.1e6},
  '1h':{rate:86.4e6,burn:3.1,tokens:86.4e6},
  '5h':{rate:61.7e6,burn:2.2,tokens:308.5e6},
  '12h':{rate:38.9e6,burn:1.4,tokens:466.8e6},
  '24h':{rate:24.3e6,burn:0.9,tokens:583.2e6}
 };
 // 기간 이름(예: 15m, 4h, 7d)을 한국어로 풉니다
 function periodKo(g){if(GEAR_KO[g])return GEAR_KO[g];const m=/^(\d+)([mhdw])$/.exec(g||'');return m?`최근 ${m[1]}${({m:'분',h:'시간',d:'일',w:'주'})[m[2]]}`:g;}
 // opt: {rateMax, burnMax, gears} — 실제 계기판처럼 눈금 범위와 기간 목록이 바뀌는 경우를 흉내 냅니다
 function snapshot(period,opt={}){
  const gears=opt.gears||GEARS;
  if(!gears.includes(period))period=gears.includes('1h')?'1h':gears[Math.min(2,gears.length-1)];
  const rateMax=opt.rateMax||200e6,burnMax=opt.burnMax||20,kr=rateMax/200e6,kb=burnMax/20;
  const p0=DEMO[period]||DEMO['1h'],p={rate:p0.rate*kr,burn:p0.burn*kb,tokens:p0.tokens*kr};
  // opt.fuelN: 계정 수(0~8). 같은 도구가 여러 번 나올 수 있습니다
  const ALL=[['Claude','Max',58,1.15],['Codex','Pro',34,.8],['GLM','Coding',81,.3],['Claude','Pro',67,.1],['Codex','Plus',82,0],['Agy','',76,0],['Claude','Team',45,.4],['Codex','Team',23,.6]];
  const fuel=ALL.slice(0,opt.fuelN??3).map(([name,plan,left,k])=>({name,plan,left,burn:p.burn*k}));
  const minLeft=fuel.length?Math.min(...fuel.map(f=>f.left)):0;
  return {
   period,periodLabel:periodKo(period),gears,
   rate:p.rate,rateMax,tokens:p.tokens,
   burn:p.burn,burnMax,cruise:opt.cruise!==undefined?opt.cruise:1.9*kb,
   heat:64,cpu:37,mem:64,
   fuel,fuelLeft:fuel.length?Math.round(fuel.reduce((a,f)=>a+f.left,0)/fuel.length):0,minLeft,
   rangeH:opt.rangeH!==undefined?opt.rangeH:Math.min(99,58/(p0.burn*1.15)),
   odo:1284516220,trip:42.6e6,
   sessions:{working:6,waiting:2,idle:4,total:12},
   // 화면 창과 같은 순서(작업 중 → 응답 대기 → 나머지)의 세션 최대 7개. opt.listN, opt.longName으로 바꿔 시험합니다
   list:demoList(opt),
   // 고른 기간을 24칸으로 나눈 토큰 양(오래된 것부터). opt.flowZero면 모두 0
   flow:opt.flowZero?Array(24).fill(0):FLOW.map(v=>v*1e6*kr),
   lamps:{waiting:2,reconnect:0,empty:1,late:0},
   clock:'14:32',temp:opt.temp!==undefined?opt.temp:'18°'
  };
 }
 function demoList(opt){
  const order={working:0,waiting:1,idle:2};
  let L=SESSIONS.map(x=>({...x,tokens:parseFloat(x.tok)*1e6})).sort((a,b)=>order[a.state]-order[b.state]);
  if(opt.longName&&L.length)L[0]={...L[0],name:'결제-서버-마이그레이션-2026-11-정리'};
  return L.slice(0,opt.listN??7);
 }
 // 시동을 걸 때 바늘이 끝까지 갔다가 돌아오는 장면용 값입니다.
 function ignition(d,s){
  const k=Math.max(0,Math.min(1,s));
  return {...d,rate:d.rateMax*k,burn:d.burnMax*k,heat:100*k,cpu:100*k,mem:100*k,fuelLeft:100*k,minLeft:100*k,
   fuel:d.fuel.map(f=>({...f,left:100*k})),ignition:true};
 }

 // ── 숫자 표기
 // 눈금 숫자: 0.2, 0.5, 1, 2.5, 40, 1000처럼 꼬리 0 없이
 function fmtScale(v){if(Math.abs(v)<1e-9)return '0';const r=Math.round(v*100)/100;return String(r);}
 let MCTX;function measureCtx(){if(MCTX!==undefined)return MCTX;try{MCTX=typeof document!=='undefined'?document.createElement('canvas').getContext('2d'):null;}catch(e){MCTX=null;}return MCTX;}
 const fmt={
  m:v=>v==null||!isFinite(v)?'—':(v/1e6).toFixed(v>=100e6?0:1),              // 86.4
  mInt:v=>Math.round(v/1e6).toString(),             // 86
  pct:v=>v==null||!isFinite(v)?'—':Math.round(v).toString(),
  burn:v=>v==null||!isFinite(v)?'—':v.toFixed(1),
  comma:v=>Math.round(v).toLocaleString('en-US'),
  odo:(v,n=7)=>String(Math.floor(v/1e6)%10**n).padStart(n,'0'),   // 백만 토큰 단위
  trip:v=>(v/1e6).toFixed(1),
  // 작업 가능 시간을 모르면(null) '—'
  hours:h=>h==null||!isFinite(h)?'—':h>=10?Math.round(h)+'시간':h.toFixed(1)+'시간'
 };

 // ── SVG 도우미 (각 렌더마다 새로 만듭니다; id가 겹치지 않게 접두어를 붙입니다)
 let SEQ=0;
 function makeH(prefix){
  const P=prefix+'_'+(SEQ++).toString(36)+'_';
  const defs=[];
  const r2=n=>Math.round(n*100)/100;
  const rad=a=>(a-90)*Math.PI/180;               // 0도 = 12시, 시계 방향
  const pt=(cx,cy,r,a)=>[r2(cx+r*Math.cos(rad(a))),r2(cy+r*Math.sin(rad(a)))];
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const H={P,pt,rad,clamp,esc,r2,fmt,
   id:n=>P+n,
   url:n=>`url(#${P+n})`,
   def:s=>{defs.push(s);return H;},
   defs:()=>defs.length?`<defs>${defs.join('')}</defs>`:'',
   lin(n,stops,o={}){const [x1,y1,x2,y2]=o.dir||[0,0,0,1];
    defs.push(`<linearGradient id="${P+n}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${o.user?` gradientUnits="userSpaceOnUse"`:''}>${stops.map(([o2,c,a])=>`<stop offset="${o2}" stop-color="${c}"${a!=null?` stop-opacity="${a}"`:''}/>`).join('')}</linearGradient>`);return `url(#${P+n})`;},
   rad2(n,stops,o={}){const {cx=.5,cy=.5,r=.5,fx,fy}=o;
    defs.push(`<radialGradient id="${P+n}" cx="${cx}" cy="${cy}" r="${r}"${fx!=null?` fx="${fx}" fy="${fy}"`:''}>${stops.map(([o2,c,a])=>`<stop offset="${o2}" stop-color="${c}"${a!=null?` stop-opacity="${a}"`:''}/>`).join('')}</radialGradient>`);return `url(#${P+n})`;},
   glow(n,std=3,color){defs.push(`<filter id="${P+n}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${std}" result="b"/>${color?`<feFlood flood-color="${color}"/><feComposite in2="b" operator="in" result="b"/>`:''}<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);return `url(#${P+n})`;},
   shadow(n,dy=4,std=6,op=.6){defs.push(`<filter id="${P+n}" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="${dy}" stdDeviation="${std}" flood-color="#000" flood-opacity="${op}"/></filter>`);return `url(#${P+n})`;},
   clip(n,inner){defs.push(`<clipPath id="${P+n}">${inner}</clipPath>`);return `url(#${P+n})`;},

   // 글자. o: size, fill, weight, anchor(start|middle|end), font, ls(자간), op, italic, base(dominant-baseline)
   text(x,y,s,o={}){
    const f=o.font||'ui';const fam=FONTS[f]||f;
    return `<text x="${r2(x)}" y="${r2(y)}" font-family='${fam}' font-size="${o.size||14}" fill="${o.fill||'#fff'}"${o.weight?` font-weight="${o.weight}"`:''} text-anchor="${o.anchor||'middle'}"${o.ls!=null?` letter-spacing="${o.ls}"`:''}${o.op!=null?` opacity="${o.op}"`:''}${o.italic?' font-style="italic"':''}${o.base?` dominant-baseline="${o.base}"`:''}${o.filter?` filter="${o.filter}"`:''}${o.stroke?` stroke="${o.stroke}" stroke-width="${o.sw||1}" paint-order="stroke"`:''}${o.rot?` transform="rotate(${o.rot} ${r2(x)} ${r2(y)})"`:''}${o.skew?` transform="skewX(${o.skew})" transform-origin="${r2(x)} ${r2(y)}"`:''}>${esc(s)}</text>`;
   },
   rect(x,y,w,h,o={}){return `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"${o.r!=null?` rx="${o.r}"`:''} fill="${o.fill||'none'}"${o.stroke?` stroke="${o.stroke}" stroke-width="${o.sw||1}"`:''}${o.op!=null?` opacity="${o.op}"`:''}${o.filter?` filter="${o.filter}"`:''}/>`;},
   circle(cx,cy,r,o={}){return `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="${o.fill||'none'}"${o.stroke?` stroke="${o.stroke}" stroke-width="${o.sw||1}"`:''}${o.op!=null?` opacity="${o.op}"`:''}${o.filter?` filter="${o.filter}"`:''}${o.dash?` stroke-dasharray="${o.dash}"`:''}/>`;},
   line(x1,y1,x2,y2,o={}){return `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${o.stroke||'#fff'}" stroke-width="${o.sw||1}"${o.cap?` stroke-linecap="${o.cap}"`:''}${o.op!=null?` opacity="${o.op}"`:''}${o.dash?` stroke-dasharray="${o.dash}"`:''}${o.filter?` filter="${o.filter}"`:''}/>`;},
   path(d,o={}){return `<path d="${d}" fill="${o.fill||'none'}"${o.stroke?` stroke="${o.stroke}" stroke-width="${o.sw||1}"`:''}${o.cap?` stroke-linecap="${o.cap}"`:''}${o.join?` stroke-linejoin="${o.join}"`:''}${o.op!=null?` opacity="${o.op}"`:''}${o.filter?` filter="${o.filter}"`:''}${o.dash?` stroke-dasharray="${o.dash}"`:''}${o.rule?` fill-rule="${o.rule}"`:''}/>`;},
   g(inner,o={}){return `<g${o.t?` transform="${o.t}"`:''}${o.op!=null?` opacity="${o.op}"`:''}${o.clip?` clip-path="${o.clip}"`:''}${o.filter?` filter="${o.filter}"`:''}>${inner}</g>`;},
   // 원호 경로 (a0→a1, 시계 방향)
   arcD(cx,cy,r,a0,a1){if(a1<a0)[a0,a1]=[a1,a0];if(a1-a0>=359.99)a1=a0+359.99;const [x0,y0]=pt(cx,cy,r,a0),[x1,y1]=pt(cx,cy,r,a1);return `M${x0} ${y0}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1} ${y1}`;},
   arc(cx,cy,r,a0,a1,o={}){if(Math.abs(a1-a0)<.05)return '';return H.path(H.arcD(cx,cy,r,a0,a1),{stroke:o.stroke||'#fff',sw:o.sw||4,cap:o.cap,op:o.op,filter:o.filter,dash:o.dash});},
   // 두께 있는 원호 띠 (채움)
   band(cx,cy,r0,r1,a0,a1,o={}){if(a1<a0)[a0,a1]=[a1,a0];if(a1-a0<.05)return '';const big=a1-a0>180?1:0;const [ax,ay]=pt(cx,cy,r1,a0),[bx,by]=pt(cx,cy,r1,a1),[cx2,cy2]=pt(cx,cy,r0,a1),[dx,dy]=pt(cx,cy,r0,a0);
    return H.path(`M${ax} ${ay}A${r1} ${r1} 0 ${big} 1 ${bx} ${by}L${cx2} ${cy2}A${r0} ${r0} 0 ${big} 0 ${dx} ${dy}Z`,{fill:o.fill||'#fff',op:o.op,filter:o.filter,stroke:o.stroke,sw:o.sw});},

   // 눈금. o: a0, sweep, n(큰 눈금 간격 수), minor(큰 눈금 사이 작은 눈금 수), len, mlen, w, mw, color, mcolor, inset, dots
   ticks(cx,cy,r,o={}){
    const a0=o.a0??-135,sw=o.sweep??270,n=o.n??10,m=o.minor??4,out=[];
    const total=n*(m+1);
    for(let i=0;i<=total;i++){
     const f=i/total,a=a0+sw*f,major=i%(m+1)===0;
     if(o.skip&&o.skip(f,major))continue;
     const red=o.red!=null&&f>=o.red;
     const len=major?(o.len??14):(o.mlen??7),w=major?(o.w??2.4):(o.mw??1.2);
     const col=red?(o.redColor||'#e53b2c'):(major?(o.color||'#fff'):(o.mcolor||o.color||'#fff'));
     if(o.dots){const [x,y]=pt(cx,cy,r-len/2,a);out.push(H.circle(x,y,major?(o.dot??3):(o.mdot??1.4),{fill:col}));continue;}
     const [x1,y1]=pt(cx,cy,r,a),[x2,y2]=pt(cx,cy,r-len,a);
     out.push(H.line(x1,y1,x2,y2,{stroke:col,sw:w,cap:o.cap||'butt'}));
    }
    return out.join('');
   },
   // 눈금 숫자. labels: 문자열 배열, 각도는 고르게 나눕니다.
   nums(cx,cy,r,labels,o={}){
    const a0=o.a0??-135,sw=o.sweep??270,n=labels.length-1;
    return labels.map((s,i)=>{if(s===''||s==null)return '';const f=n?i/n:0,a=a0+sw*f,[x,y]=pt(cx,cy,r,a);
     const red=o.red!=null&&f>=o.red;
     return H.text(x,y,s,{size:o.size||16,fill:red?(o.redColor||'#e53b2c'):(o.fill||'#fff'),font:o.font||'ui',weight:o.weight,base:'central',italic:o.italic,ls:o.ls,rot:o.upright===false?a:0});}).join('');
   },
   // 바늘. a: 각도. style: bar | taper | lance | baton | thin | line
   needle(cx,cy,r,a,o={}){
    const st=o.style||'taper',col=o.color||'#f05a28',tail=o.tail??Math.round(r*.18),w=o.w??6;
    let shape;
    if(st==='taper')shape=`<path d="M${-w/2} ${tail}L${-w*.16} ${-r}L${w*.16} ${-r}L${w/2} ${tail}Z" fill="${col}"/>`;
    else if(st==='lance')shape=`<path d="M0 ${-r}L${w/2} ${-r*.2}L${w*.3} ${tail}L${-w*.3} ${tail}L${-w/2} ${-r*.2}Z" fill="${col}"/>`;
    else if(st==='baton')shape=`<rect x="${-w/2}" y="${-r}" width="${w}" height="${r+tail}" rx="${w/2}" fill="${col}"/>`;
    else if(st==='bar')shape=`<rect x="${-w/2}" y="${-r}" width="${w}" height="${r+tail}" fill="${col}"/>`;
    else if(st==='split')shape=`<rect x="${-w/2}" y="${-r}" width="${w}" height="${r*.55}" fill="${col}"/><rect x="${-w*.3}" y="${-r*.45}" width="${w*.6}" height="${r*.45+tail}" fill="${o.color2||'#222'}"/>`;
    else shape=`<line x1="0" y1="${tail}" x2="0" y2="${-r}" stroke="${col}" stroke-width="${w}" stroke-linecap="round"/>`;
    const glow=o.glow?` filter="${o.glow}"`:'';
    return `<g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(a)})"${glow}>${o.shadow!==false?`<g transform="translate(2 3)" opacity=".35">${shape.replace(/fill="[^"]+"/g,'fill="#000"').replace(/stroke="[^"]+"/g,'stroke="#000"')}</g>`:''}${shape}</g>`;
   },
   cap(cx,cy,r,o={}){return H.circle(cx,cy,r,{fill:o.fill||'#111',stroke:o.stroke||'#333',sw:o.sw||1.5});},
   // 7세그먼트 숫자. s: 문자열(0-9, -, ., 공백, :), h: 글자 높이
   seg(x,y,s,h,o={}){
    const col=o.fill||'#ff3b1f',dim=o.dim,w=h*.55,t=h*.12,gap=o.gap??h*.18,sk=o.skew??-6;
    const SEG={'0':'abcdef','1':'bc','2':'abdeg','3':'abcdg','4':'bcfg','5':'acdfg','6':'acdefg','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',' ':'','E':'adefg','F':'aefg','H':'bcefg','L':'def','P':'abefg','r':'eg','n':'ceg','o':'cdeg','h':'cefg','d':'bcdeg','t':'defg','C':'adef','A':'abcefg','U':'bcdef','b':'cdefg'};
    const hh=h/2;
    const S={a:[t,0,w-t,0,w-t*1.5,t,t*1.5,t],d:[t*1.5,h-t,w-t*1.5,h-t,w-t,h,t,h],g:[t,hh,t*1.5,hh-t/2,w-t*1.5,hh-t/2,w-t,hh,w-t*1.5,hh+t/2,t*1.5,hh+t/2],
     f:[0,t,t,t*1.5,t,hh-t*.7,0,hh-t*.2],b:[w,t,w,hh-t*.2,w-t,hh-t*.7,w-t,t*1.5],e:[0,hh+t*.2,t,hh+t*.7,t,h-t*1.5,0,h-t],c:[w,hh+t*.2,w,h-t,w-t,h-t*1.5,w-t,hh+t*.7]};
    let out='',cx=0;const chars=String(s).split('');
    const total=chars.reduce((a,c)=>a+(c==='.'?t*1.9:c===':'?t*1.6:w+gap),0)-gap;
    let x0=o.anchor==='end'?x-total:o.anchor==='middle'?x-total/2:x;
    for(const c of chars){
     if(c==='.'){out+=`<rect x="${r2(x0+cx-gap*.5+t*.15)}" y="${r2(y+h-t*1.05)}" width="${r2(t*1.05)}" height="${r2(t*1.05)}" fill="${col}"/>`;cx+=t*1.9;continue;}
     if(c===':'){out+=`<rect x="${r2(x0+cx)}" y="${r2(y+h*.28)}" width="${r2(t)}" height="${r2(t)}" fill="${col}"/><rect x="${r2(x0+cx)}" y="${r2(y+h*.66)}" width="${r2(t)}" height="${r2(t)}" fill="${col}"/>`;cx+=t*1.6;continue;}
     const on=SEG[c]??'';
     for(const k of 'abcdefg'){const p=S[k];let d='M';for(let i=0;i<p.length;i+=2)d+=`${r2(x0+cx+p[i])} ${r2(y+p[i+1])}${i<p.length-2?'L':'Z'}`;
      if(on.includes(k))out+=`<path d="${d}" fill="${col}"/>`;else if(dim)out+=`<path d="${d}" fill="${dim}"/>`;}
     cx+=w+gap;
    }
    return `<g transform="skewX(${sk})" transform-origin="${r2(x)} ${r2(y+h)}"${o.filter?` filter="${o.filter}"`:''}>${out}</g>`;
   },
   // 막대 그래프 (가로). frac: 0–1, n: 칸 수, colors: [[from, color], ...]
   bars(x,y,w,h,frac,o={}){
    const n=o.n||30,gap=o.gap??2,bw=(w-gap*(n-1))/n,on=Math.round(clamp(frac)*n);let out='';
    for(let i=0;i<n;i++){const f=(i+1)/n;let col=o.fill||'#3fe07a';if(o.colors)for(const [k,c] of o.colors)if(f>k)col=c;
     const hh=o.rise?h*(o.rise[0]+(o.rise[1]-o.rise[0])*i/(n-1)):h;
     out+=H.rect(x+i*(bw+gap),y+h-hh,bw,hh,{fill:i<on?col:(o.off||'#1b1f22'),r:o.r});}
    return out;
   },
   // 세로 막대 (아래→위)
   vbars(x,y,w,h,frac,o={}){
    const n=o.n||12,gap=o.gap??2,bh=(h-gap*(n-1))/n,on=Math.round(clamp(frac)*n);let out='';
    for(let i=0;i<n;i++){let col=o.fill||'#3fe07a';const f=(i+1)/n;if(o.colors)for(const [k,c] of o.colors)if(f>k)col=c;
     out+=H.rect(x,y+h-(i+1)*bh-i*gap,w,bh,{fill:i<on?col:(o.off||'#1b1f22'),r:o.r});}
    return out;
   },
   // 원호 막대 (분할). a0, sweep, n, w(두께)
   arcBars(cx,cy,r,frac,o={}){
    const a0=o.a0??-135,sw=o.sweep??270,n=o.n||40,gapA=o.gapA??(sw/n*.28),on=Math.round(clamp(frac)*n),bw=o.w||14;let out='';
    for(let i=0;i<n;i++){const s=a0+sw*i/n,e=a0+sw*(i+1)/n-gapA;let col=o.fill||'#3fe07a';const f=(i+1)/n;if(o.colors)for(const [k,c] of o.colors)if(f>k)col=c;
     out+=H.band(cx,cy,r-bw,r,s,e,{fill:i<on?col:(o.off||'#1b1f22')});}
    return out;
   },
   // 경고등 네 개. style: icon | chip | text
   lamps(x,y,d,o={}){
    const items=[['waiting','응답 대기',d.lamps.waiting,'#f2b233'],['reconnect','재로그인',d.lamps.reconnect,'#f2b233'],['empty','한도 부족',d.lamps.empty,'#ef4a3c'],['late','수집 지연',d.lamps.late,'#f2b233']];
    const sz=o.size||22,gap=o.gap??(sz*2.1),off=o.off||'#2a2d31',vertical=o.vertical;let out='';
    items.forEach(([k,label,n,c],i)=>{const on=n>0,col=on?(o.colors?.[k]||c):off;const px=vertical?x:x+i*gap,py=vertical?y+i*gap:y;
     let one=H.g(ICONS[k](col,sz),{t:`translate(${r2(px-sz/2)} ${r2(py-sz/2)})`});
     if(o.labels)one+=H.text(px,py+sz*.5+12,label+(on&&n>1?' '+n:''),{size:Math.max(11,o.labelSize||11),fill:on?col:(o.labelOff||'#6b7077'),font:o.font||'ui'});
     out+=H.cl('alert',k,one);
    });
    return out;
   },
   // 기간 기어 표시 (자동변속 P R N D처럼). style: row
   // o.width: 기어 줄이 쓸 수 있는 최대 폭. 기어 수가 늘면 간격을 줄여 이 폭 안에 넣습니다
   gear(x,y,d,o={}){
    const n=d.gears.length,size=o.size||15;let gap=o.gap||34;if(o.width&&n>1)gap=Math.min(gap,o.width/n);let out='';
    d.gears.forEach((g,i)=>{const on=g===d.period;const px=x+(i-(n-1)/2)*gap;let one='';
     if(on&&o.box)one+=H.rect(px-gap/2+2,y-size*.85,gap-4,size*1.4,{r:o.r??3,fill:o.box});
     one+=H.text(px,y,g,{size:on?size:Math.max(11,size*.85),fill:on?(o.on||'#fff'):(o.off||'#666'),weight:on?700:400,font:o.font||'ui',base:'central'});
     out+=H.cl('period',g,one);});
    return out;
   },
   // 누를 수 있는 부품 표시. kind: alert | period | trip | gauge
   //  H.cl('gauge','rate', 그림)  →  <g data-cl-gauge="rate">그림</g>
   cl(kind,val,inner){if(kind==='alert'&&val==='late')val='live';return `<g data-cl-${kind}="${val??''}">${inner}</g>`;},
   // 눈금 숫자 만들기. max: 최대값(1·2·5×10^n), n: 칸 수(5 또는 10을 권장)
   //  o.unit: 나눌 단위(토큰은 1e6), o.every: k번째마다만 숫자(나머지는 '')
   scale(max,n=10,o={}){const u=o.unit||1,every=o.every||1;
    return Array.from({length:n+1},(_,i)=>i%every?'':fmtScale(max*i/n/u));},
   rateScale(d,n=10,o={}){return H.scale(d.rateMax,n,{unit:1e6,...o});},
   burnScale(d,n=10,o={}){return H.scale(d.burnMax,n,o);},
   // 기계식 주행계 숫자 바퀴
   odo(x,y,str,o={}){
    const cw=o.cw||14,ch=o.ch||20,n=str.length;let out=H.rect(x-2,y-2,cw*n+4,ch+4,{fill:o.frame||'#000',r:2});
    for(let i=0;i<n;i++){const last=i>=n-(o.tenths||0);
     out+=H.rect(x+i*cw+1,y,cw-2,ch,{fill:last?(o.tbg||'#e8e2d0'):(o.bg||'#111')});
     out+=H.text(x+i*cw+cw/2,y+ch/2+1,str[i],{size:ch*.75,fill:last?(o.tfg||'#111'):(o.fg||'#e8e2d0'),font:o.font||'mono',base:'central'});}
    return out;
   },
   // 둥근 사각 패널
   panel(x,y,w,h,o={}){return H.rect(x,y,w,h,{r:o.r??12,fill:o.fill||'#0b0d10',stroke:o.stroke,sw:o.sw,op:o.op,filter:o.filter});},
   // 금속 링 (크롬)
   chrome(cx,cy,r,w,o={}){const n='chr'+(SEQ++);const g=H.lin(n,o.stops||[[0,'#f4f6f8'],[.35,'#7c838b'],[.5,'#e8ecef'],[.7,'#4b5157'],[1,'#c9ced3']],{dir:[0,0,1,1]});
    return H.circle(cx,cy,r-w/2,{stroke:g,sw:w});},
   // 꺾은선 기록 (토큰 흐름)
   spark(x,y,w,h,data,o={}){data=(data&&data.length?data:Array(24).fill(0)).map(v=>Math.max(0,+v||0));if(data.length===1)data=[data[0],data[0]];const mx=Math.max(...data)*1.1||1;const P=data.map((v,i)=>[x+w*i/(data.length-1),y+h-h*v/mx]);
    const d='M'+P.map(p=>p.map(r2).join(' ')).join('L');
    return (o.area?H.path(d+`L${x+w} ${y+h}L${x} ${y+h}Z`,{fill:o.area}):'')+H.path(d,{stroke:o.stroke||'#6cf',sw:o.sw||2,join:'round'});},
   // 세로 막대 기록
   histo(x,y,w,h,data,o={}){data=(data&&data.length?data:Array(24).fill(0)).map(v=>Math.max(0,+v||0));const mx=Math.max(...data)*1.05||1,n=data.length,gap=o.gap??2,bw=(w-gap*(n-1))/n;
    return data.map((v,i)=>H.rect(x+i*(bw+gap),y+h-h*v/mx,bw,h*v/mx,{fill:typeof o.fill==='function'?o.fill(i,v):(o.fill||'#6cf'),r:o.r})).join('');},
   // 세션 목록 (상태 점 + 이름 + 토큰). 목록은 o.list 또는 d.list. 비면 '세션 없음'
   sessions(x,y,w,o={}){const list=o.list||(H.d&&H.d.list)||[],rows=list.slice(0,o.rows||5),lh=o.lh||22,sz=o.size||12,font=o.font||'ui';let out='';
    if(!rows.length)return H.text(x,y,o.empty||'세션 없음',{size:sz,fill:o.dim||'#888',anchor:'start',base:'central',font});
    rows.forEach((s,i)=>{const cy=y+i*lh;const c=s.state==='waiting'?(o.wait||'#f2b233'):s.state==='working'?(o.work||'#39d98a'):(o.idle||'#666');
     const right=s.state==='waiting'?'응답 대기':(s.tok||'');const rw=H.tw(right,sz,font);
     out+=H.circle(x+5,cy,4,{fill:c});out+=H.text(x+16,cy,H.ellipsis(s.name,w-16-rw-12,sz,font),{size:sz,fill:o.fill||'#ddd',anchor:'start',base:'central',font});
     out+=H.text(x+w,cy,right,{size:sz,fill:s.state==='waiting'?c:(o.dim||'#888'),anchor:'end',base:'central',font});});
    return out;},
   // 세션 타일 지도: list를 토큰 양에 비례한 사각형으로 나눕니다(목록 순서 유지, 긴 변을 반으로 자르기)
   //  돌려주는 값: [{x,y,w,h,s(세션),i}]
   treemap(list,x,y,w,h){list=list||[];if(!list.length)return [];
    const tot=list.reduce((a,v)=>a+(+v.tokens||0),0)||1,wt=list.map(v=>Math.max(+v.tokens||0,tot*.06));const out=[];
    const go=(a,b,x,y,w,h)=>{if(b-a===1){out.push({x,y,w,h,s:list[a],i:a});return;}
     const sum=wt.slice(a,b).reduce((p,q)=>p+q,0);let m=a+1,acc=wt[a];while(m<b-1&&acc+wt[m]<=sum/2){acc+=wt[m];m++;}
     const f=acc/sum;if(w>=h){go(a,m,x,y,w*f,h);go(m,b,x+w*f,y,w*(1-f),h);}else{go(a,m,x,y,w,h*f);go(m,b,x,y+h*f,w,h*(1-f));}};
    go(0,list.length,x,y,w,h);return out;},
   // 글자 폭(px). 브라우저면 캔버스로 재고, 아니면 글자 종류로 어림합니다
   tw(str,size=14,font='ui',weight){str=String(str??'');const ctx=measureCtx();
    if(ctx){ctx.font=`${weight||400} ${size}px ${FONTS[font]||font}`;return ctx.measureText(str).width;}
    let w=0;for(const ch of str)w+=/[\u3131-\uD79D]/.test(ch)?1:/[0-9]/.test(ch)?.6:/[A-Z]/.test(ch)?.66:/[mwMW]/.test(ch)?.8:.52;return w*size;},
   // maxW 안에 들어가게 끝을 '…'로 자릅니다
   ellipsis(str,maxW,size=14,font='ui',weight){str=String(str??'');if(maxW<=0)return '';if(H.tw(str,size,font,weight)<=maxW)return str;
    let a=[...str];while(a.length>1&&H.tw(a.join('')+'…',size,font,weight)>maxW)a.pop();return a.join('').replace(/[\s\-_·]+$/,'')+'…';},
   // 숫자 드럼 (창 안에서 굴러가는 숫자). value 0–max를 위아래 숫자와 함께
   drum(x,y,w,h,value,o={}){const step=o.step||10,cur=value/step,base=Math.floor(cur),fr=cur-base,lh=o.lh||h*.42;const n='drm'+(SEQ++);
    H.clip(n,`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r??4}"/>`);let s='';
    for(let k=-2;k<=3;k++){const v=(base+k)*step;if(v<0||v>(o.max??1e9))continue;const yy=y+h/2+(fr-k)*lh;
     s+=H.text(x+w/2,yy,String(o.fmt?o.fmt(v):v),{size:o.size||lh*.7,fill:o.fill||'#111',font:o.font||'ui',weight:o.weight||600,base:'central'});}
    return H.rect(x,y,w,h,{fill:o.bg||'#efe6c8',r:o.r??4})+H.g(s,{clip:`url(#${P}${n})`})+H.rect(x,y,w,h,{fill:H.lin(n+'s',[[0,'#000',.55],[.3,'#000',0],[.7,'#000',0],[1,'#000',.55]]),r:o.r??4})+H.line(x-4,y+h/2,x+w+4,y+h/2,{stroke:o.mark||'#d33',sw:2});
   },
   // 1top 글자
   brand(x,y,o={}){return H.text(x,y,'1top',{size:o.size||12,fill:o.fill||'#fff',weight:700,font:o.font||'ui',op:o.op??.75,ls:o.ls??.5,anchor:o.anchor||'middle'});}
  };
  // ── 재질 부품 (v3.0.0): 빛은 언제나 위에서 옵니다. 같은 테마 안에서는 같은 tone을 씁니다.
  const TONES={
   chrome:[[0,'#f7f9fb'],[.18,'#c9ced4'],[.45,'#6d747c'],[.55,'#9aa1a8'],[.8,'#e3e7eb'],[1,'#7d848b']],
   satin:[[0,'#b9bec4'],[.5,'#5d6369'],[1,'#8c9298']],
   black:[[0,'#4a4d52'],[.35,'#1c1e21'],[1,'#0b0c0d']],
   gold:[[0,'#f3e2b3'],[.4,'#a8874a'],[.6,'#d7bb7c'],[1,'#7c6332']],
   bronze:[[0,'#a58f74'],[.5,'#4d4034'],[1,'#7a6855']]
  };
  // 원형 테두리: 바깥 그림자 → 금속 링 → 안쪽 가는 어둠선
  H.bezel=(cx,cy,r,w,o={})=>{const n='bz'+(SEQ++);const g=H.lin(n,TONES[o.tone||'chrome']||TONES.chrome,{dir:[0,0,0,1]});
   const sh=o.shadow===false?'':H.circle(cx,cy+3,r+w/2,{fill:'#000',op:.45,filter:H.shadow('bzs'+n,2,5,.6)});
   return sh+H.circle(cx,cy,r+w/2,{fill:g})+H.circle(cx,cy,r,{fill:o.inner||'#050506'})+H.circle(cx,cy,r-.5,{stroke:'#000',sw:1.5,op:.7})+H.circle(cx,cy,r+w/2-.5,{stroke:'#fff',sw:1,op:.12});};
  // 다이얼면: 가운데가 조금 밝고 가장자리로 어두워지며, 위쪽 테두리 아래에 얕은 그림자
  H.face=(cx,cy,r,o={})=>{const n='fc'+(SEQ++);const base=o.fill||'#15171a',edge=o.edge||'#08090a';
   const g=H.rad2(n,[[0,o.center||base],[.82,base],[1,edge]],{cy:.46});
   const ins=H.rad2(n+'i',[[.86,'#000',0],[1,'#000',.55]],{cy:.53});
   return H.circle(cx,cy,r,{fill:g})+H.circle(cx,cy,r,{fill:ins});};
  // 유리 반사: 위쪽에 아주 옅은 반달 한 장
  H.glass=(cx,cy,r,o={})=>{const n='gl'+(SEQ++);const g=H.lin(n,[[0,'#fff',o.op??.07],[1,'#fff',0]],{dir:[0,0,0,1]});
   return H.path(`M${H.r2(cx-r*.86)} ${H.r2(cy-r*.2)}A${r} ${r} 0 0 1 ${H.r2(cx+r*.86)} ${H.r2(cy-r*.2)}Q${cx} ${H.r2(cy-r*.42)} ${H.r2(cx-r*.86)} ${H.r2(cy-r*.2)}Z`,{fill:g});};
  // 바늘 허브: 둥근 금속 덮개
  H.hub=(cx,cy,r,o={})=>{const n='hb'+(SEQ++);const g=H.rad2(n,[[0,o.light||'#5a5e64'],[.6,o.fill||'#1c1e21'],[1,'#050506']],{cx:.4,cy:.35});
   return H.circle(cx,cy+1.5,r,{fill:'#000',op:.5})+H.circle(cx,cy,r,{fill:g})+H.circle(cx,cy,r-.5,{stroke:'#fff',sw:.8,op:.12});};
  // 하우징·패널: 위쪽 빛을 받는 표면과 위 가장자리의 가는 빛선
  H.housing=(d,o={})=>{const n='hs'+(SEQ++);const g=H.lin(n,[[0,o.top||'#26282c'],[1,o.bottom||'#0c0d0f']],{dir:[0,0,0,1]});
   return H.path(d,{fill:g,filter:o.shadow===false?undefined:H.shadow('hss'+n,6,14,.55)})+H.path(d,{stroke:'#fff',sw:1,op:o.rim??.07});};
  H.tones=TONES;
  // ── 1top 값으로 만든 표준 계기 (가장 많이 쓰는 두 계기)
  // H.tach: 토큰 속도계 (0–200M tokens/시간)
  H.frac={rate:d=>clamp(d.rate/d.rateMax),burn:d=>clamp(d.burn/d.burnMax),heat:d=>clamp(d.heat/100),fuel:d=>clamp(d.fuelLeft/100),cpu:d=>clamp(d.cpu/100),mem:d=>clamp(d.mem/100),min:d=>clamp(d.minLeft/100)};
  H.labels={rate:['0','20','40','60','80','100','120','140','160','180','200'],rate5:['0','50','100','150','200'],rate4:['0','40','80','120','160','200'],rate2:['0','','40','','80','','120','','160','','200'],
   burn:['0','2','4','6','8','10','12','14','16','18','20'],burn5:['0','5','10','15','20'],burn4:['0','4','8','12','16','20'],burn2:['0','','4','','8','','12','','16','','20'],pct:['0','25','50','75','100'],pct5:['0','20','40','60','80','100'],fuel:['E','½','F'],heat:['C','','H']};
  return H;
 }
 const FONTS={
  ui:'-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue","Apple SD Gothic Neo",Arial,sans-serif',
  din:'"DIN Alternate","DIN Condensed","Bahnschrift","Roboto Condensed","Arial Narrow",-apple-system,"Apple SD Gothic Neo",sans-serif',
  cond:'"DIN Condensed","Avenir Next Condensed","Bahnschrift Condensed","Arial Narrow",-apple-system,"Apple SD Gothic Neo",sans-serif',
  futura:'Futura,"Century Gothic","Avenir Next",-apple-system,"Apple SD Gothic Neo",sans-serif',
  avenir:'"Avenir Next",Avenir,"Segoe UI",-apple-system,"Apple SD Gothic Neo",sans-serif',
  serif:'Didot,"Bodoni 72","Times New Roman",Georgia,"Apple SD Gothic Neo",serif',
  classic:'Georgia,"Times New Roman","Apple SD Gothic Neo",serif',
  mono:'"SF Mono",Menlo,Consolas,"Courier New",monospace',
  wide:'"Eurostile","Microgramma","Michroma","Arial Black",-apple-system,"Apple SD Gothic Neo",sans-serif',
  gill:'"Gill Sans","Gill Sans MT",Calibri,-apple-system,"Apple SD Gothic Neo",sans-serif',
  helv:'"Helvetica Neue",Helvetica,Arial,"Apple SD Gothic Neo",sans-serif',
  rounded:'"SF Pro Rounded","Arial Rounded MT Bold","Varela Round",-apple-system,"Apple SD Gothic Neo",sans-serif'
 };
 const SESSIONS=[
  {name:'api-refactor',state:'working',tok:'21.4M'},
  {name:'landing-motion',state:'waiting',tok:'8.2M'},
  {name:'ios-widget',state:'working',tok:'14.9M'},
  {name:'collector-bg',state:'working',tok:'11.3M'},
  {name:'docs-review',state:'waiting',tok:'3.6M'},
  {name:'billing-sync',state:'working',tok:'9.8M'},
  {name:'perf-trace',state:'idle',tok:'2.1M'}
 ];
 const FLOW=[42,51,48,66,72,58,61,79,88,74,69,83,91,86,77,84,96,89,81,86,92,87,84,86];
 // 경고등 아이콘 (24 × 24 기준, sz로 크기 조절)
 const ICONS={
  waiting:(c,s)=>`<g transform="scale(${s/24})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v10H10l-4 4v-4H4z"/><circle cx="9" cy="10" r=".6" fill="${c}"/><circle cx="12" cy="10" r=".6" fill="${c}"/><circle cx="15" cy="10" r=".6" fill="${c}"/></g>`,
  reconnect:(c,s)=>`<g transform="scale(${s/24})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/></g>`,
  empty:(c,s)=>`<g transform="scale(${s/24})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M3 20h13M7 8h5"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/></g>`,
  late:(c,s)=>`<g transform="scale(${s/24})" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="${c}"/></g>`
 };
 const THEMES=[];
 G.OneTop={GEARS,GEAR_KO,periodKo,fmtScale,snapshot,ignition,makeH,FONTS,ICONS,SESSIONS,FLOW,THEMES,fmt,
  theme(t){THEMES.push(t);},
  // 테마 하나를 SVG 문자열로 그립니다
  render(t,d){const H=makeH('t'+t.id);H.d=d;let body='';try{body=t.draw(H,d);}catch(e){body=`<text x="640" y="240" fill="#f55" font-size="20" text-anchor="middle">${String(e).replace(/</g,'')}</text>`;console.error(t.id,e);}
   return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 480" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${t.name} 계기판">${H.defs()}${body}</svg>`;}
 };
})(typeof window!=='undefined'?window:globalThis);
