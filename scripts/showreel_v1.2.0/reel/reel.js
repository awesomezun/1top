// 1top showreel v1.2.0: about 35 seconds at 1920x1080, silent, one cut per language (?lang=ko|en|zh).
// Scenes by their on-screen labels: intro, 01 GAUGES, 02 SESSIONS, 03 CONVERSATION, 04 MENU BAR · TRAY, 05 WEEKLY LIMITS,
// end card. v1.0.0's 05 EVERYWHERE and 06 LANGUAGE are left out; 03 CONVERSATION comes from the take that sends without a confirmation.
// Every style on the stage is a pure function of the time t, so render.py can draw any frame in any order:
// seek(t) sets the styles and the recorded frame each scene shows, and resolves once the images are decoded.
// The motion follows the landing's vocabulary (line mask up, clip reveal, fade and slide, scramble decode,
// easeOutQuart / easeOutCubic / easeInOutCubic); the ideas come from motion-reference, none of its code.
// The footage is the v7.0.0 recording build at full pixel size (showreel_v1.0.0's take.py and frames.py): invented
// projects and accounts, usage shaped like real work.
const LANG=new URLSearchParams(location.search).get('lang')||'ko';
const FRAMES='/build/showreel_v1.0.0/frames/',STILLS='/build/showreel_v1.0.0/stills/';
const MARK='/site/public/brand/v1.1.0/mark.png';
export const DURATION=35.4,FPS=30;
const LOGO_Y=430; // the logo's centre line on the first and the last frame

const COPY={
 ko:{tag:['흩어진 AI 작업,','한눈에 보이게.'],where:'macOS · Windows · 웹 · 휴대폰',
  gauges:['토큰 속도계','선택한 기간의 시간당 평균 속도와, 일이 몰리고 쉬는 흐름.'],
  sessions:['세션마다 상태와 계정','작업 중 · 확인 필요 · 일시정지, 그리고 어느 계정(1 · 2 · Studio)인지.'],
  talk:['세션과 바로 대화',['묻고','작업하고','답해요']],
  desk:['메뉴 막대에도,<br>트레이에도<br>같은 패널','macOS 메뉴 막대 · Windows 트레이'],
  weekly:['계정별 주간 한도','얼마나 썼는지, 시간당 몇 %씩 쓰는지.'],
  download:'다운로드'},
 en:{tag:['Your AI work.','In view.'],where:'macOS · Windows · Web · Phone',
  gauges:['A speedometer for tokens','Average tokens per hour for the period, and the bursts and breaks of real work.'],
  sessions:['Every session, its state and account','Working, needs attention or paused, and which account it runs on: 1, 2 or Studio.'],
  talk:['Chat with a session',['Ask','It works','It answers']],
  desk:['The same panel,<br>in the menu bar<br>and the tray','macOS menu bar · Windows tray'],
  weekly:['Weekly limits for every account','How much is used, and how many percent per hour.'],
  download:'Download'},
 zh:{tag:['分散的 AI 工作，','尽收眼底。'],where:'macOS · Windows · 网页 · 手机',
  gauges:['Token 速度表','所选时段的每小时平均速度，以及工作的忙碌与休息。'],
  sessions:['每个会话的状态和账户','工作中、需要确认、已暂停，以及使用哪个账户：1、2 或 Studio。'],
  talk:['直接与会话聊天',['提问','处理','回答']],
  desk:['菜单栏和托盘里，<br>同一个面板','macOS 菜单栏 · Windows 托盘'],
  weekly:['每个账户的每周额度','用了多少，每小时消耗多少 %。'],
  download:'下载'},
}[LANG];

// ---- time helpers
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const lin=x=>x,outCubic=x=>1-(1-x)**3,outQuart=x=>1-(1-x)**4,inCubic=x=>x*x*x,inOutCubic=x=>x<.5?4*x*x*x:1-(-2*x+2)**3/2;
const prog=(t,a,b,e=lin)=>e(clamp((t-a)/(b-a)));
/** Piecewise-linear map from reel time to take time. */
const track=(t,keys)=>{if(t<=keys[0][0])return keys[0][1];for(let i=1;i<keys.length;i++){const [t0,v0]=keys[i-1],[t1,v1]=keys[i];if(t<=t1)return v0+(v1-v0)*(t-t0)/(t1-t0);}return keys.at(-1)[1];};
const mix=(a,b,e)=>a+(b-a)*e;

// ---- camera: a key fits a rectangle of the window (points) into a box of the stage (pixels)
const SAFE=[96,56,1728,660],WHOLE=[0,0,1640,1068],FULLBOX=[150,40,1620,1000];
const fit=([x,y,w,h],[bx,by,bw,bh]=SAFE)=>({z:Math.min(bw/w,bh/h),px:x+w/2,py:y+h/2,qx:bx+bw/2,qy:by+bh/2});
function camera(t,keys){
 const k=keys.map(([kt,r,b])=>[kt,fit(r,b)]);let a=k[0][1],b=a,e=0;
 for(let i=1;i<k.length;i++){if(t<=k[i][0]){a=k[i-1][1];b=k[i][1];e=inOutCubic(prog(t,k[i-1][0],k[i][0]));break;}a=b=k[i][1];}
 const z=Math.exp(mix(Math.log(a.z),Math.log(b.z),e)),px=mix(a.px,b.px,e),py=mix(a.py,b.py,e),qx=mix(a.qx,b.qx,e),qy=mix(a.qy,b.qy,e);
 return {z,ox:qx-px*z,oy:qy-py*z};
}

// ---- DOM helpers
const stage=document.getElementById('stage');
// Images decode while painting, so a frame never shows a scene before its stills are drawn.
const el=(tag,cls,html,parent)=>{const n=document.createElement(tag);if(tag==='img')n.decoding='sync';if(cls)n.className=cls;if(html!=null)n.innerHTML=html;parent?.append(n);return n;};
/** Lines split at <br>, each inside a mask so it can rise into view. */
const lines=(cls,html,parent)=>{const box=el('div',cls,null,parent);return {box,parts:html.split('<br>').map(h=>el('span','t',h,el('span','l',null,box)))};};
/** Line Mask Up in (easeOutQuart, 95 ms per line) and the same lines rising out. */
function maskUp(parts,t,start,out=Infinity,dur=.78){
 parts.forEach((n,i)=>{const a=prog(t,start+i*.095,start+i*.095+dur,outQuart),b=prog(t,out+i*.05,out+i*.05+.36,inCubic);
  n.style.transform=`translateY(${((1-a)*108-b*108).toFixed(2)}%)`;n.style.opacity=(1-b).toFixed(3);});
}
/** Fade and slide (easeOutCubic). */
function fadeUp(n,t,start,out=Infinity,dist=24,dur=.7){
 const a=prog(t,start,start+dur,outCubic),b=prog(t,out,out+.36,inCubic);
 n.style.opacity=(a*(1-b)).toFixed(3);n.style.transform=`translateY(${((1-a)*dist-b*dist*.6).toFixed(2)}px)`;
}
/** Uppercase labels decode left to right, with glyphs picked from the frame number so every render matches. */
const GLYPHS='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function scramble(n,text,t,start,out=Infinity){
 const p=prog(t,start,start+.7),f=Math.floor(t*FPS);
 n.textContent=[...text].map((c,i)=>/[A-Z0-9]/.test(c)&&i/text.length>=p?GLYPHS[(i*7919+f*104729)%GLYPHS.length]:c).join('');
 n.style.opacity=(prog(t,start,start+.15)*(1-prog(t,out,out+.3))).toFixed(3);
}
const show=(n,on)=>{n.style.visibility=on?'visible':'hidden';};

// ---- recorded frames
let manifest={};
const loads=[];
/** Decode an image, loading it again if a request failed; a frame never goes out with an image missing. */
async function ready(img){
 for(let n=0;n<4;n++){try{await img.decode();if(img.naturalWidth)return;}catch{}
  const url=img.src.split('?')[0];img.src=`${url}?retry=${n+1}`;}
 throw Error(`could not load ${img.src}`);
}
/** An <img> that shows the frame of a take at take time s; seek() waits for its decode. */
function footage(img,name){
 return s=>{const m=manifest[`${name}-${LANG}`],i=clamp(Math.round((s-m.start)*m.fps),0,m.count-1);
  const url=`${FRAMES}${name}-${LANG}/${String(i).padStart(4,'0')}${m.ext}`;
  if(img.dataset.src!==url){img.dataset.src=url;img.src=url;loads.push(ready(img));}};
}

// ---- scenes: [start of the wipe that brings it in]. Each covers the one before with a clip reveal.
const WIPE=.8,T={intro:0,gauges:3.2,sessions:9.4,talk:14.2,desk:22.2,weekly:27.0,end:31.2};
const ORDER=Object.keys(T);
const next=id=>T[ORDER[ORDER.indexOf(id)+1]]??DURATION+1;
const scenes=[];
function scene(id,build,draw){
 const root=el('div','scene',null,stage),inner=el('div',null,null,root);inner.style.cssText='position:absolute;inset:0;transform-origin:50% 40%';
 el('div','backdrop',null,inner);const parts=build(inner);
 scenes.push({id,root,inner,draw:t=>draw(t,parts)});
}
/** A window film with a camera, a bottom or side scrim and a caption. */
function filmScene(id,take,{map,cam,kicker,title,sub,chips,side,capAt,extra}){
 scene(id,inner=>{
  const win=el('div','win',null,inner),img=el('img',null,null,win);img.alt='';
  const scrim=el('div',side?'scrim side':'scrim',null,inner);
  const cap=el('div',side?'cap narrow':'cap',null,inner),k=el('div','kicker',null,cap),ti=lines('title',title,cap);
  const su=sub?lines('sub',sub,cap):null,ch=chips?el('div','chips',null,cap):null;
  const chipEls=chips?chips.flatMap((c,i)=>[...(i?[el('span','arrow','→',ch)]:[]),el('span','chip',c,ch)]).filter(n=>n.className==='chip'):[];
  return {win,img,set:footage(img,take),scrim,k,ti,su,ch,chipEls,more:extra?.build?.(inner)};
 },(t,p)=>{
  const s=track(t,map),c=camera(t,cam);p.set(s);
  p.win.style.transform=`translate(${c.ox.toFixed(2)}px,${c.oy.toFixed(2)}px) scale(${c.z.toFixed(5)})`;
  const start=capAt??T[id]+.45,out=next(id)-.38;
  p.scrim.style.opacity=(prog(t,start-.3,start+.5)*(1-prog(t,out+.2,out+.6))).toFixed(3);
  scramble(p.k,kicker,t,start,out);maskUp(p.ti.parts,t,start+.08,out);
  if(p.su)maskUp(p.su.parts,t,start+.3,out,.7);
  if(p.ch)fadeUp(p.ch,t,start+.32,out);
  extra?.draw?.(t,s,c,p);
 });
}

// Intro: the logo, large, and the line from the landing hero.
scene('intro',inner=>{
 const logo=el('div','logo',null,inner);el('img',null,null,logo).src=MARK;el('span','wordmark','1top',logo);
 const tag=lines('center tagline',COPY.tag.join('<br>'),inner);tag.parts[1].classList.add('grad');
 const where=el('div','center platforms',COPY.where,inner);
 return {logo,tag,where};
},(t,{logo,tag,where})=>{
 // Frame 0 is the end card's last frame, so the reel loops without a jump.
 const up=prog(t,.25,1.15,outQuart);
 logo.style.transform=`translate(-50%,${(LOGO_Y-mix(0,90,up)).toFixed(2)}px) translateY(-50%)`;
 tag.box.style.top='516px';maskUp(tag.parts,t,.5,99);
 where.style.top='768px';fadeUp(where,t,1.25,99);
});

// 01 / GAUGES: token speedometer and token flow: the slider goes from 1 hour to 24 hours, then the flow shows bursts and breaks.
filmScene('gauges','dashboard',{
 map:[[3.2,.2],[5.0,1.8],[6.6,3.4],[10.2,4.4]],
 cam:[[3.2,WHOLE,FULLBOX],[4.45,WHOLE,FULLBOX],[5.55,[255,108,935,300]],[7.05,[255,108,935,300]],[8.1,[262,402,672,296]],[10.2,[282,418,632,278]]],
 capAt:5.0,kicker:'01 / GAUGES',title:COPY.gauges[0],sub:COPY.gauges[1]});

// 02 / SESSIONS: the session table: states first, then the idle, paused and attention rows, each with its AI tool and account number.
filmScene('sessions','dashboard',{
 map:[[9.4,10.2],[15.0,15.45]],
 cam:[[9.4,[264,40,900,520]],[11.5,[264,56,840,480]],[12.7,[264,546,840,440]],[15.0,[274,556,820,430]]],
 kicker:'02 / SESSIONS',title:COPY.sessions[0],sub:COPY.sessions[1]});

// 03 / CONVERSATION: a message with a photo to the checkout session: sent, the session writing, then its reply.
// Take seconds at which the sent message, the working dots and the answer appear (measured in the conversation takes).
// ko comes from the 3e41fe5 take that sends straight away; en and zh are still the 37066df takes with the confirmation
// and are measured again when those languages are recorded.
const TALK_STEPS={ko:[7.33,12.2,19.23],en:[8.87,14.23,20.3],zh:[8.97,14.23,20.27]}[LANG];
filmScene('talk','conversation',{
 map:[[14.2,1.0],[15.4,3.2],[17.0,7.4],[17.6,9.2],[21.0,20.6],[23.0,21.4]],
 cam:[[14.2,WHOLE,FULLBOX],[14.85,WHOLE,FULLBOX],[15.9,[1098,128,540,600],[640,24,1240,1032]],[23.0,[1098,146,540,600],[640,24,1240,1032]]],
 side:true,kicker:'03 / CONVERSATION',title:COPY.talk[0],chips:COPY.talk[1],
 // The chip of the step the message is at lights up: asked, the session working, its answer.
 extra:{draw:(t,src,c,p)=>{const at=TALK_STEPS.filter(x=>src>=x).length-1;p.chipEls.forEach((n,i)=>n.classList.toggle('on',i===at));}}});

// 04 / MENU BAR · TRAY: the macOS menu-bar panel and the Windows tray quick view side by side. The panel goes from 24 hours to the
// tray's 1 hour, then highlights rows as the pointer would.
scene('desk',inner=>{
 el('div','scrim side',null,inner).style.opacity='1';
 const mac=el('div','desk mac',null,inner),bar=el('div','menubar',null,mac);
 el('span','apple',null,bar);el('b',null,'Finder',bar);
 for(const w of {ko:['파일','편집','보기'],en:['File','Edit','View'],zh:['文件','编辑','显示']}[LANG])el('span',null,w,bar);
 const icon=el('i','status',null,bar);icon.style.left='323px';el('img',null,null,icon).src=MARK;el('time',null,'9:41',bar);
 const panel=el('div','panel',null,mac),pimg=el('img',null,null,panel);pimg.style.cssText='width:466px;height:826px';
 panel.style.cssText+=';left:107px;top:34px';el('span','tag','macOS',mac);
 const win=el('div','desk windows',null,inner),task=el('div','taskbar',null,win);
 el('i','start',null,task);for(let i=0;i<4;i++)el('i','app',null,task);
 const tray=el('span','tray',null,task);el('b',null,'^',tray);el('img',null,null,tray).src=MARK;el('time',null,'9:41',task);
 const quick=el('div','panel',null,win),qimg=el('img',null,null,quick);qimg.src=`${STILLS}tray-${LANG}.png`;qimg.style.cssText='width:440px;height:800px';
 quick.style.cssText+=';right:14px;bottom:60px;transform-origin:50% 100%';el('span','tag','WINDOWS',win).style.cssText='left:22px;top:22px;bottom:auto';
 const cap=el('div','cap narrow',null,inner),k=el('div','kicker',null,cap),ti=lines('title',COPY.desk[0],cap),su=lines('sub',COPY.desk[1],cap);
 return {mac,win,panel,set:footage(pimg,'menu'),quick,k,ti,su};
},(t,p)=>{
 const t0=T.desk,out=next('desk')-.38;p.set(track(t,[[t0,3.0],[next('desk')+WIPE,9.6]]));
 fadeUp(p.mac,t,t0+.1,99,60,.9);fadeUp(p.win,t,t0+.25,99,60,.9);
 const a=prog(t,t0+.55,t0+1.0,outCubic),b=prog(t,t0+.8,t0+1.25,outCubic);
 p.panel.style.opacity=a.toFixed(3);p.panel.style.transform=`scale(${mix(.94,1,a).toFixed(4)})`;
 p.quick.style.opacity=b.toFixed(3);p.quick.style.transform=`translateY(${((1-b)*26).toFixed(2)}px) scale(${mix(.96,1,b).toFixed(4)})`;
 scramble(p.k,'04 / MENU BAR · TRAY',t,t0+.45,out);maskUp(p.ti.parts,t,t0+.53,out);maskUp(p.su.parts,t,t0+.75,out,.7);
});

// 05 / WEEKLY LIMITS: weekly limits for each account, with the last 24 hours of use.
filmScene('weekly','accounts',{
 map:[[T.weekly,4.6],[next('weekly')+WIPE,9.4]],
 cam:[[T.weekly,[264,196,1350,770],FULLBOX],[T.weekly+1.0,[264,196,1350,770],FULLBOX],[T.weekly+2.2,[264,204,1350,356]],[next('weekly')+WIPE,[300,210,1290,340]]],
 capAt:T.weekly+1.3,kicker:'05 / WEEKLY LIMITS',title:COPY.weekly[0],sub:COPY.weekly[1]});

// End card: the logo again, the address and the download button. Its last frame is the reel's first.
scene('end',inner=>{
 const logo=el('div','logo',null,inner);const mark=el('img',null,null,logo);mark.src=MARK;const word=el('span','wordmark','1top',logo);
 const url=el('div','center url grad',null,inner);
 const dl=el('div','center',null,inner);const btn=el('span','download',`↓ ${COPY.download}<span>macOS · Windows · Android</span>`,dl);
 return {logo,mark,word,url,dl};
},(t,p)=>{
 const t0=T.end,a=prog(t,t0+.25,t0+1.05,outQuart),fade=prog(t,DURATION-.7,DURATION-.1,inOutCubic);
 p.logo.style.transform=`translate(-50%,${LOGO_Y}px) translateY(-50%) translateY(${((1-a)*60).toFixed(2)}px)`;p.logo.style.opacity=a.toFixed(3);
 p.url.style.top='604px';scramble(p.url,'1TOP.SI',t,t0+.7);
 const u=prog(t,t0+.7,t0+1.4,outCubic);p.url.textContent=p.url.textContent.toLowerCase();
 p.url.style.opacity=(u*(1-fade)).toFixed(3);p.url.style.transform=`translateY(${((1-u)*20+fade*14).toFixed(2)}px)`;
 p.dl.style.top='726px';const d=prog(t,t0+1.0,t0+1.7,outCubic);
 p.dl.style.opacity=(d*(1-fade)).toFixed(3);p.dl.style.transform=`translateY(${((1-d)*24+fade*14).toFixed(2)}px)`;
});

// ---- the frame at time t
function draw(t){
 scenes.forEach((s,i)=>{
  const from=T[s.id],to=next(s.id)+WIPE,on=t>=from&&t<to;show(s.root,on);if(!on)return;
  // Clip reveal (easeOutQuart) from the bottom edge, with the content settling from a slight zoom.
  const w=i?prog(t,from,from+WIPE,outQuart):1;
  s.root.style.clipPath=w<1?`inset(${((1-w)*100).toFixed(3)}% 0 0 0)`:'none';
  const leave=prog(t,next(s.id),next(s.id)+WIPE,inCubic);
  s.inner.style.transform=`scale(${(mix(1.04,1,w)*mix(1,.965,leave)).toFixed(5)})`;
  s.inner.style.filter=leave>0?`brightness(${mix(1,.55,leave).toFixed(3)})`:'none';
  s.draw(t);
 });
}
window.seek=async t=>{
 loads.length=0;draw(t);
 // Chrome may drop the decoded pixels of a still while its scene is hidden; decode every image on screen again.
 for(const s of scenes)if(s.root.style.visibility==='visible')for(const i of s.root.querySelectorAll('img'))if(i.src&&!i.dataset.src)loads.push(ready(i));
 await Promise.all(loads);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
};

// ---- ready once the manifest, the wordmark font and every still are in
(async()=>{
 document.documentElement.lang={ko:'ko',en:'en',zh:'zh-CN'}[LANG];
 manifest=await (await fetch(FRAMES+'frames.json')).json();
 // The wordmark glyphs come from the site's own inlined @font-face, so the logo matches the header.
 const css=await (await fetch('/site/src/typography.css')).text();
 const face=css.match(/@font-face\{font-family:"1top Wordmark";[^}]+\}/)[0];document.head.append(Object.assign(document.createElement('style'),{textContent:face}));
 await document.fonts.load('650 196px "1top Wordmark"');await document.fonts.ready;
 await Promise.all([...stage.querySelectorAll('img')].filter(i=>i.src).map(ready));
 window.reelReady=true;
})();
