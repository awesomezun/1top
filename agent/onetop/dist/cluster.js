/* The cluster view (docs/design/cluster/cluster-design-spec_v1.0.0.md): two dials of one size either side of a centre
   column, and a lower row on the same three axes. Token speed (left) = the dashboard's token speed, the chosen
   period's average per hour; burn (right) = %/h of a weekly limit for the session or account picked, else the
   average of every account, each account's own burn marked on the rim; the centre column = the period above seven
   pages; the lower row = the odometer and trip under the token dial, the warnings in the middle and the fuel (each
   weekly limit left) under the burn dial, with CPU and memory on whichever side has room. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const KINDS=['Claude','Codex','GLM','Antigravity','Aside'],rank=k=>KINDS.includes(k)?KINDS.indexOf(k):KINDS.length;
 // Marks on a 1-2-2.5-5 step so a dial reads four or five numbers: 200 → 50, 100 → 25, 50 → 10, 2 → 0.5.
 function marks(max){
  const p=10**Math.floor(Math.log10(max)),major=[5,2.5,2,1,.5,.25,.2,.1].map(m=>m*p).find(s=>max/s>=4-1e-9)||p/10;
  return {max,major,minor:major/5};
 }
 // The burn dial past its 20%/h limit counts in tens, twenties, fifties …, at most six steps to the full scale.
 function burnMarks(max){
  if(max<=20)return marks(max);
  const s=[10,20,50,100,200,500].find(k=>max/k<=6)||1000;
  return {max,major:s,minor:s/5};
 }
 // Fever levels: the token dial at 300M, 400M and 500M and above; the burn dial at 40, 60 and 80%/h and above.
 const tachLevel=full=>full<=200e6?0:full<=300e6?1:full<=400e6?2:3,burnLevel=max=>max<=20?0:max<=40?1:max<=60?2:3;
 // The token dial past its 200M limit counts in hundreds of millions, at most six steps to the full scale.
 function tachMarks(full,div){
  if(full<=200e6)return marks(full/div);
  const u=Math.round(full/100e6),s=[1,2,5,10,20,50].find(k=>u/k<=6)||100;
  return {max:full/div,major:s*100e6/div,minor:s*100e6/div/5};
 }
 const local=label=>{const s=String(label||'');return s.includes('@')?s.split('@')[0]:s;};
 const HOUR=3600,STALL=15*60,CONTEXT=.9;
 // Range: at the account's current burn, when its weekly limit runs out and whether that comes before
 // the reset. idle when it is not being used; null when either number is unknown.
 function range(a,now){
  if(!a||a.left===null||!valid(a.burn))return null;
  if(a.burn===0)return {state:'idle',at:null,early:false};
  const at=now+a.left/a.burn*HOUR;
  return a.reset&&at>=a.reset?{state:'enough',at,early:false}:{state:'empty',at,early:!!a.reset};
 }
 // Cruise: the steady %/h that spends what is left of the weekly limit exactly by its reset.
 const cruise=(a,now)=>a&&a.weekly!==false&&a.left!==null&&a.reset&&a.reset>now?a.left/((a.reset-now)/HOUR):null;
 // A session's context is nearly full at 90% of its capacity; a working session is suspected stalled
 // when it has reported no usage for 15 minutes (an unreported last use, 0, never counts).
 const contextFull=s=>{const c=s?.context_usage;return valid(c?.input_tokens)&&valid(c?.capacity)&&c.capacity>0&&c.input_tokens/c.capacity>=CONTEXT;};
 const stalled=(s,state,now)=>state==='working'&&valid(s?.last_usage)&&s.last_usage>0&&now-s.last_usage>STALL;
 // Trip: tokens since start from the token events (minute totals over the last day, or the chosen longer
 // range), their average per hour, and each account's weekly percent used since start. Before the events
 // begin the tokens are outside the record.
 function trip(state,start,now,W){
  if(!valid(start)||start>now)return null;
  const from=state?.chart_range?.start??((valid(state?.updated)?state.updated:now)-86400),inRange=start>=from;
  const tokens=inRange?(state?.events||[]).reduce((n,e)=>{const v=e.n??((e.fresh??0)+(e.cached??0)+(e.written??0)+(e.output??0));return e.t>=start&&e.t<=now&&valid(v)?n+v:n;},0):null;
  const hours=(now-start)/HOUR;
  const accounts=(state?.weekly_usage?.accounts||[]).map(a=>{const r=W.increaseTrend(a,start,now);return {id:a.id,used:r.hasData&&valid(r.increase)?r.increase:null};});
  return {start,tokens,rate:tokens===null||hours<=0?null:tokens/hours,inRange,accounts};
 }
 // Engine temperature: each computer's load is the higher of its CPU and memory use; the gauge reads the hottest.
 function heat(state){
  const list=state?.system?.computers?.length?state.system.computers:state?.system?.host?[{name:null,cpu:state.system.host.cpu,memory:state.system.host.memory?.percent}]:[];
  const computers=list.map(c=>({name:c.name||null,cpu:valid(c.cpu)?c.cpu:null,memory:valid(c.memory)?c.memory:null})).filter(c=>c.cpu!==null||c.memory!==null)
   .map(c=>({...c,load:Math.min(100,Math.max(c.cpu??0,c.memory??0))}));
  const hottest=computers.slice().sort((a,b)=>b.load-a.load)[0]||null;
  return {value:hottest?hottest.load:null,hottest,computers};
 }
 // The last minute's tokens per hour, in all and by tool, from each top-level session's sliding last minute (a
 // lead's figures include its subagents); null when no session reports one. It only runs the odometer, the trip
 // and the flow chart on between readings; the dials read the period's average.
 function instant(state){
  const rows=state?.root_sessions?.length?state.root_sessions:(state?.sessions||[]).filter(s=>!s.is_subagent),by={};let all=null;
  for(const s of rows){const v=s.usage?.last_minute;if(!Array.isArray(v))continue;const n=v.reduce((a,b)=>a+(valid(b)?b:0),0)*HOUR/(s.usage.window_seconds||60);
   all=(all||0)+n;by[s.kind]=(by[s.kind]||0)+n;}
  return {rate:all,by};
 }
 // The tachometer's scale, held per page while the period stays (see readings).
 const tachHold={};
 // pick is {type:'session'|'account',id} or null.
 function readings(state,o){
  const W=o.weekly,now=o.now??Date.now()/1000,w=state?.period_usage?.windows?.find(x=>x.key===o.period);
  // Collection running late keeps the last reading (the speed as of the last collection) and lights its warning.
  const late=!!state&&!state.error&&valid(state.updated)&&now-state.updated>20;
  const m=o.speed.measure(state,o.period,late?state.updated:now),rate=m.rate===null?null:m.rate*3600,live=instant(state);
  // The dashboard's own dial scale (it holds a while before shrinking), handed over or computed alone.
  const max=Math.max(o.tachMax||0,o.speed.scaleMax(rate,w?.seconds));
  // The dial runs to 200M tokens an hour in every period; past that it breaks its limit in steps of 100M (300M, 400M,
  // 500M, …), and it holds while the period stays so the needle never jumps when use eases.
  let full=(rate||0)<=200e6?200e6:Math.ceil(rate/100e6)*100e6;
  if(o.hold){if(o.hold.period===o.period&&o.hold.full>full)full=o.hold.full;o.hold.period=o.period;o.hold.full=full;}
  const tach={rate,max,full,tokens:m.tokens,computers:m.computers,expected:m.expected,instant:live.rate,byKind:live.by,climb:valid(live.rate)?live.rate/HOUR:0};
  // Each account reads its representative window (weekly, else 5 hours, else daily); only a verified
  // account's weekly window gets a burn, a range and a cruise, which are all in %/h of the weekly limit.
  const accounts=(state?.account_quotas||[]).map(q=>{
   const p=state.weekly_usage?.accounts?.find(a=>a.id===q.id)?.periods?.[o.period],week=W.representative(q),weekly=W.isWeekly(week),burns=W.burnAllowed(q,week),pct=valid(week?.pct)?week.pct:null;
   return {id:q.id,kind:q.kind,label:q.account_label,plan:q.plan||null,alias:q.alias||null,who:local(q.account_label),pct,left:pct===null?null:Math.max(0,100-pct),
    reset:valid(week?.reset)?week.reset:null,current:pct!==null&&q.stale===false,reconnect:!!o.reconnect?.has(q.status),burn:burns?W.accountBurn(p,q):null,
    added:burns&&valid(p?.used_pp)?p.used_pp:null,weekly,window:weekly?null:week?.label||null};
  });
  for(const a of accounts)a.range=range(a,now);
  const tokens=s=>{const v=s.usage?.windows?.[o.period];return Array.isArray(v)?v.reduce((a,b)=>a+(valid(b)?b:0),0):0};
  const burn=s=>{
   let e=s.usage?.weekly_estimate?.[o.period];const id=e?.account_id||s.usage?.weekly_account,q=state.account_quotas?.find(q=>q.id===id);
   if(!e&&q){const c=state.weekly_usage?.accounts?.find(a=>a.id===q.id)?.calibration;if(c)e={account_id:q.id,basis:'calibrated_token_equivalent',calibration:c};}
   if(s.tokens==null)return null;const b=W.sessionBurn(e,s.usage?.rate,q,now);
   // A signed-out account's last report still prices the session's tokens; the range below says to sign in again.
   return b!==null||!q||q.stale===false?b:W.sessionBurn(e,s.usage?.rate,{...q,stale:false},now);
  };
  const list=(o.sessions||[]).map(s=>({s,state:o.display(s),tokens:tokens(s)}));
  const row=r=>({id:r.s.id,kind:r.s.kind,state:r.state,tokens:r.tokens,estimate:valid(r.s.usage?.weekly_estimate?.[o.period]?.used_pp)?r.s.usage.weekly_estimate[o.period].used_pp:null,
   burn:burn(r.s),account:r.s.usage?.weekly_estimate?.[o.period]?.account_id||r.s.usage?.weekly_account||null,session:r.s});
  // Every session, the window scrolling: working first, then those waiting for a look, then the rest, each by its
  // tokens in the period and then by its last use. A warning pressed (o.only: working, waiting or just done) shows
  // only its sessions.
  const done=r=>r.state==='idle'&&valid(r.s.last_usage)&&r.s.last_usage>0&&now-r.s.last_usage<=600;
  const only={working:r=>r.state==='working',waiting:r=>r.state==='waiting',done}[o.only],step=r=>r.state==='working'?0:r.state==='waiting'?1:2;
  const rows=(only?list.filter(only):list).slice().sort((a,b)=>step(a)-step(b)||b.tokens-a.tokens||(b.s.last_usage||0)-(a.s.last_usage||0)).map(row);
  // The burn dial reads one subject: the session or account picked; with nothing picked, every account with a burn,
  // their average on the needle and each one's own on the rim. A pick with no rate yet reads as not measured.
  let subject=null,multi=null;const pick=o.pick;
  if(pick?.type==='session'){const l=list.find(x=>x.s.id===pick.id);if(l){const r=row(l);subject={type:'session',id:r.id,kind:r.kind,value:r.burn,account:r.account,session:r.session};}}
  else if(pick?.type==='account'){const a=accounts.find(x=>x.id===pick.id);if(a)subject={type:'account',id:a.id,kind:a.kind,value:a.burn,account:a.id};}
  const picked=!!subject;
  if(!subject){const live=accounts.filter(a=>valid(a.burn)).sort((a,b)=>b.burn-a.burn),cs=live.map(a=>cruise(a,now)).filter(valid);
   if(live.length){subject={type:'all',id:null,kind:null,value:live.reduce((n,a)=>n+a.burn,0)/live.length,account:null,count:live.length,cruise:cs.length?cs.reduce((n,c)=>n+c,0)/cs.length:null};
    multi=live.map(a=>({id:a.id,kind:a.kind,value:a.burn}));}}
  const value=valid(subject?.value)?subject.value:null,target=subject?.type==='all'?subject.cruise:cruise(accounts.find(a=>a.id===subject?.account),now);
  // The scale reaches past the reading, past one and a half times the cruise and past every rim mark.
  const top=Math.max(value||0,(target||0)*1.6,...(multi||[]).map(x=>x.value));
  // The scale steps 2, 5, 10, 20 and past 20%/h breaks its limit in steps of 20 (40, 60, 80, …); it holds while the
  // period and subject stay, so the needle never jumps when use eases.
  let smax=top<=20?Math.max(2,o.speed.niceMax(top)):Math.ceil(top/20)*20;const skey=o.period+'|'+(subject?.type||'')+'|'+(subject?.id||'');
  if(o.hold){if(o.hold.skey===skey&&o.hold.smax>smax)smax=o.hold.smax;o.hold.skey=skey;o.hold.smax=smax;}
  // Range, like a car's distance to empty: the hours of work left at this burn before the weekly limit runs out. A
  // session or an account reads what is left of its account at the subject's burn; every AI together reads the account
  // that runs out first. early: before its reset. A burn of 0 has no end (idle); an account to sign in again has no
  // reading (reconnect); a subject without a weekly limit has none at all (unknown).
  let reach={state:'unknown'};
  if(subject?.type==='all'){const ends=accounts.filter(a=>valid(a.burn)&&a.burn>0&&a.left!==null).map(a=>({a,h:a.left/a.burn})).sort((x,y)=>x.h-y.h);
   reach=ends.length?{hours:ends[0].h,early:!!ends[0].a.reset&&now+ends[0].h*HOUR<ends[0].a.reset,account:ends[0].a.id}:{state:'idle'};}
  else if(subject){const a=accounts.find(x=>x.id===subject.account);
   reach=!a?{state:'unknown'}:a.reconnect?{state:'reconnect',account:a.id}:a.left===null||value===null?{state:'unknown'}:value===0?{state:'idle'}
    :{hours:a.left/value,early:!!a.reset&&now+a.left/value*HOUR<a.reset,account:a.id};}
  const speed={value,multi,cruise:target,max:smax,subject,picked,reach,account:subject?.type==='account'?subject.id:null,session:subject?.type==='session'?subject.id:null};
  // Tell-tales light only for what is there: tools with working sessions, sessions waiting for a look,
  // accounts to sign in again, and whether the readings are live.
  const working={};for(const r of list)if(r.state==='working')working[r.s.kind]=(working[r.s.kind]||0)+1;
  const tells={kinds:Object.keys(working).sort((a,b)=>rank(a)-rank(b)||(a<b?-1:1)).map(k=>({kind:k,working:working[k]})),waiting:list.filter(r=>r.state==='waiting').map(r=>r.s.id),
   reconnect:accounts.filter(a=>a.reconnect).map(a=>a.id),fresh:!!state&&!state.error&&valid(state.updated)&&now-state.updated<=20,
   empty:accounts.filter(a=>a.range?.early).map(a=>a.id),done:list.filter(done).map(r=>r.s.id),context:list.filter(r=>contextFull(r.s)).map(r=>r.s.id),stalled:list.filter(r=>stalled(r.s,r.state,now)).map(r=>r.s.id)};
  return {period:o.period,tach,speed,accounts,sessions:rows,working:list.filter(r=>r.state==='working').length,tells,heat:heat(state),trip:trip(state,o.trip,now,W)};
 }

 // Drawing. The skeleton is built once; each refresh moves needles and updates rows in place, so needles
 // spring between readings, figures count to their new values and the page's translation keeps up.
 // The scale sweeps 240° from lower left to lower right, which leaves the lower third open for the figures.
 // The scale: 240° from lower left, or (down) 270° from straight below. The face: the figure at the very centre with a
 // pointer riding the rim (center, the default), or (hub) the needle from the hub with the figures below it.
 const DOWN=root.ONETOP_CLUSTER_SWEEP==='down',CENTER=DOWN||root.ONETOP_CLUSTER_FACE!=='hub',A0=DOWN?90:150,SWEEP=DOWN?270:240,C=170,ang=f=>(A0+SWEEP*f)*Math.PI/180,pt=(f,r)=>[C+r*Math.cos(ang(f)),C+r*Math.sin(ang(f))],n1=v=>v.toFixed(1),clamp=f=>Math.max(0,Math.min(1,f||0));
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ring=(cls,r)=>`<circle class="${cls}" cx="170" cy="170" r="${r}" pathLength="360" stroke-dasharray="0 360" transform="rotate(${A0} 170 170)"/>`;
 // A dial: the face (rim, scale, needle) in one svg; below the hub, in the opening the needle never sweeps, the figure,
 // its unit and the dial's name (the burn dial's names its subject too), level on both dials; below them, inside the
 // scale's circle, the token dial's odometer and the burn dial's range, both on a lit display like a car's.
 const RANGE_MARKUP='<div class="cl-rng"><small class="cl-rng-k">작업 가능</small><b class="cl-led"></b><small class="cl-rng-u">시간</small><small class="cl-rng-w" hidden>재로그인 필요</small></div>';
 let uid=0;
 // The needle and hub are a second svg over the face on a layer of their own: the needle's shimmer and swing then repaint
 // only that layer, not the face with its glowing lane under the same filters.
 const dial=(cls,name,id='clLit'+(++uid))=>`<div class="cl-dial ${cls}" role="group"><svg class="cl-face" viewBox="0 0 340 340" aria-hidden="true"><circle class="cl-rim" cx="170" cy="170" r="160"/>
  <g class="cl-face-rings"><circle cx="170" cy="170" r="118"/><circle cx="170" cy="170" r="92"/><circle cx="170" cy="170" r="66"/></g><path class="cl-fan" d=""/>
  <circle class="cl-track" cx="170" cy="170" r="147" pathLength="360" stroke-dasharray="${SWEEP} 360" transform="rotate(${A0} 170 170)"/>
  <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="340" height="340">${ring('cl-arc',147)}</mask><g class="cl-lane cl-lane-bg"></g><g class="cl-lane cl-lane-on" mask="url(#${id})"></g>
  ${ring('cl-red',155)}<g class="cl-ticks"></g><g class="cl-multi"></g><g class="cl-nums"></g>
  </svg><svg class="cl-ptr" viewBox="0 0 340 340" aria-hidden="true"><g class="cl-needle"><g class="cl-shake"><path d="${CENTER?'M276 166 L318 168.8 L318 171.2 L276 174 Z':'M156 166.6 L301 169.3 L301 170.7 L156 173.4 Z'}"/></g></g><circle class="cl-hub" cx="170" cy="170" r="13"/><circle class="cl-hub2" cx="170" cy="170" r="5"/></svg>
  <div class="cl-low"><div class="cl-read"><b>—</b><small></small></div><div class="cl-name">${name}</div></div>${cls==='cl-speed'?RANGE_MARKUP:''}</div>`;
 function scaleMarkup(el,g,fmt){
  const key=g.max+'|'+fmt(g.max);if(el.dataset.max===key)return;el.dataset.max=key;
  // A full scale off the minor step (700M on 40M steps) gets its own last tick.
  let ticks='',nums='';const n=Math.floor(g.max/g.minor+1e-6),extra=g.max-n*g.minor>g.max*1e-6?1:0;
  for(let i=0;i<=n+extra;i++){const v=i>n?g.max:i*g.minor,f=v/g.max,last=i===n+extra,major=last||Math.abs(v/g.major-Math.round(v/g.major))<1e-6,[x1,y1]=pt(f,major?122:131),[x2,y2]=pt(f,141);
   ticks+=`<line class="${major?'mj':'mn'}" data-f="${f.toFixed(4)}" x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}"/>`;
   // The 0 and the full-scale numbers sit past the ends of the scale, in the corners of the opening, so the figure's
   // line holds the figure alone; the others sit inside the ticks.
   const crowd=!last&&major&&(g.max-v)<g.major*.6&&Math.abs(g.max/g.major-Math.round(g.max/g.major))>1e-6;
   if(major&&!crowd){const end=DOWN?0:f<1e-6?-1:f>1-1e-6?1:0,a=ang(f)+end*10*Math.PI/180,r=end?126:100,x=C+r*Math.cos(a),y=C+r*Math.sin(a);nums+=`<text data-f="${f.toFixed(4)}" x="${n1(x)}" y="${n1(y)}" text-anchor="middle" dominant-baseline="central">${fmt(v)}</text>`;}}
  el.querySelector('.cl-ticks').innerHTML=ticks;el.querySelector('.cl-nums').innerHTML=nums;delete el.dataset.red;
 }
 // The red zone, as a car's redline: the top fifth of either scale has red ticks, red numbers and a red arc along the ticks.
 function redline(el,from){
  const key=String(from);if(el.dataset.red===key)return;el.dataset.red=key;
  el.querySelectorAll('.cl-ticks line,.cl-nums text').forEach(t=>t.classList.toggle('red',from<1&&Number(t.dataset.f)>=from-1e-4));
  el.querySelector('.cl-red').setAttribute('stroke-dasharray',from<1?`0 ${(SWEEP*from).toFixed(2)} ${(SWEEP*(1-from)).toFixed(2)} 360`:'0 360');
 }
 // The token lane's colours along the scale, as [fraction, colour] stops: green, yellow, orange, red as the speed rises.
 // Green for the first half of the scale, then quickly yellow, orange and red.
 const LANE=[[0,'#57d36a'],[.5,'#57d36a'],[.62,'#e2e04a'],[.76,'#ff9a2e'],[.88,'#ff3b30'],[1,'#ff3b30']];
 const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
 const lift=c=>'#'+hex(c).map(v=>Math.round(v+(255-v)*.22).toString(16).padStart(2,'0')).join('');
 function colorAt(stops,f){
  f=clamp(f);let i=1;while(i<stops.length-1&&stops[i][0]<f)i++;const [f0,c0]=stops[i-1],[f1,c1]=stops[i],k=f1>f0?clamp((f-f0)/(f1-f0)):1;
  return '#'+hex(c0).map((v,j)=>Math.round(v+(hex(c1)[j]-v)*k).toString(16).padStart(2,'0')).join('');
 }
 // The lane is drawn in short pieces, each in the colour at its place, faint along the whole scale and lit through the
 // lit arc's mask up to the reading, so it springs with the needle.
 function lane(el,stops){
  el._stops=stops;const key=JSON.stringify(stops);if(el.dataset.lane===key)return;el.dataset.lane=key;
  const N=96,piece=i=>{const [x0,y0]=pt(i/N,147),[x1,y1]=pt(Math.min(1,(i+1.15)/N),147);return `<path d="M${n1(x0)} ${n1(y0)}A147 147 0 0 1 ${n1(x1)} ${n1(y1)}" stroke="${colorAt(stops,(i+.5)/N)}"/>`;};
  const html=Array.from({length:N},(_,i)=>piece(i)).join('');el.querySelector('.cl-lane-bg').innerHTML=html;el.querySelector('.cl-lane-on').innerHTML=html;
  delete el.dataset.lit;
 }
 const turn=f=>`rotate(${(A0+SWEEP*clamp(f)).toFixed(2)}deg)`;
 // The lit sector behind the needle (the glow face) for a fraction of full scale.
 const fanPath=f=>{f=clamp(f);if(f<.002)return '';const R=140,p=a=>[170+R*Math.cos(a),170+R*Math.sin(a)].map(v=>v.toFixed(1)).join(' ');
  return `M170 170 L${p(ang(0))} A${R} ${R} 0 ${SWEEP*f>180?1:0} 1 ${p(ang(f))} Z`;};
 // The needle, the lit arc and the lit ticks for a fraction of full scale; lit (0..1) is how far the ignition sweep has run.
 function needle(el,f,lit=1){
  f=clamp(f);el._f=f;el.querySelector('.cl-fan').setAttribute('d',fanPath(f));el.querySelector('.cl-needle').style.transform=turn(f);
  el.querySelector('.cl-arc').setAttribute('stroke-dasharray',`${(SWEEP*f).toFixed(2)} 360`);
  const ticks=el.querySelectorAll('.cl-ticks line'),n=ticks.length-1,stops=el._stops||LANE;
  ticks.forEach((t,i)=>{const at=Number(t.dataset.f),on=at<=f+1e-4;t.classList.toggle('on',on);t.style.stroke=on&&!t.classList.contains('red')?colorAt(stops,at):'';
   t.style.opacity=lit>=1?'':String(Math.max(0,Math.min(1,(lit*(n+4)-i)/4)));});
 }
 const scaleNumber=v=>String(+v.toFixed(v<1?2:1));
 // A session's small gauge, as the menu bar draws it: its %/h on the burn dial's scale in its tool's colour, the hub
 // lit blue while it works and yellow while it waits.
 function mini(v,max,tint,state){
  const cx=13,cy=13,r=11,f=valid(v)?clamp(v/Math.max(max,1e-4)):0,a=d=>[cx+r*Math.cos(d*Math.PI/180),cy+r*Math.sin(d*Math.PI/180)],to=180+180*f,[x1,y1]=a(to),[nx,ny]=[cx+(r-2.5)*Math.cos(to*Math.PI/180),cy+(r-2.5)*Math.sin(to*Math.PI/180)];
  const hub=state==='working'?'var(--work)':state==='waiting'?'var(--amber)':'var(--dim)';
  return `<path d="M2 13A11 11 0 0 1 24 13" class="mt"/>${f>0?`<path d="M2 13A${r} ${r} 0 0 1 ${n1(x1)} ${n1(y1)}" class="mv" style="stroke:${tint}"/>`:''}${valid(v)?`<path d="M${cx} ${cy}L${n1(nx)} ${n1(ny)}" class="mn${f>0?'':' idle'}"/>`:''}<circle cx="${cx}" cy="${cy}" r="2.4" style="fill:${hub}"/>`;
 }
 // A model as the dashboard names it, a Claude family in words: claude-opus-5-5 → Opus 5.5, gpt-6.1-sol → GPT-6.1-sol.
 const modelName=m=>{const s=String(m||'').replace(/\[1m\]/gi,'').replace(/^claude-/,'').replace(/^gpt-/,'GPT-'),c=/^(opus|sonnet|haiku|fable)-(\d+)-(\d+)/.exec(s);
  return c?c[1][0].toUpperCase()+c[1].slice(1)+' '+c[2]+'.'+c[3]:s;};
 const reading=v=>!valid(v)?'—':v>=100?String(Math.round(v)):v>=10?v.toFixed(1):v.toFixed(2);
 // The trip reads as the token dial does: three digits and k, M or B (396M).
 const short=(v,S)=>{if(!valid(v))return '—';const g=S?.digits?.(v);return g?g.c.join('').trim()+g.u:String(Math.round(v));};
 // Every burn in the cluster reads as the dial does: two decimals in %/h.
 const burnText=v=>valid(v)?reading(v)+'%/시간':'—';
 const calm=()=>!!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 // Figures count from what they showed to the new value instead of jumping.
 function count(el,value,format){
  if(!el)return;const to=valid(value)?value:null,from=el.dataset.v===undefined||el.dataset.v===''?null:Number(el.dataset.v);
  el.dataset.v=to===null?'':String(to);cancelAnimationFrame(Number(el.dataset.raf||0));
  if(to===null||from===null||from===to||calm()){el.textContent=to===null?'—':format(to);return;}
  const t0=performance.now(),D=700,step=t=>{const p=Math.min(1,(t-t0)/D),e=1-(1-p)**3;el.textContent=format(from+(to-from)*e);if(p<1)el.dataset.raf=String(requestAnimationFrame(step));};
  el.dataset.raf=String(requestAnimationFrame(step));
 }
 // Gears: the six presets, then a custom gear that opens the dashboard's duration slider and, once a
 // longer or in-between window is chosen, shows its name (2일, 1주, 전체 기록).
 const GEARS=['10m','30m','1h','5h','12h','24h'];
 // Period dials (ONETOP_CLUSTER_DIAL; the drum by default, the others kept to compare): the six periods and the custom one, turned
 // like a physical control. drum: a horizontal cylinder behind a lens; tuner: a radio dial's strip sliding under a fixed
 // needle; roller: a vertical drum in a window with steps either side; knob: a round knob below its labels on an arc;
 // lever: a gear lever sliding between notches. Each turns by dragging, the wheel, the arrow keys or a press on a label,
 // springs to the nearest stop and picks it there.
 // The customized layout being drawn (layout.js, customizing-spec_v1.1.0): which objects, in what order, their size,
 // count and shape. A comparison page's ONETOP_CLUSTER_* globals still win; with neither, today's look.
 let LAY=null;
 const chosen=(id,k,list,fallback)=>{const v=LAY?.opts?.[id]?.[k];return list.includes(v)?v:fallback;};
 const DIALS=['tabs','drum','tuner','roller','knob','lever'],dialKind=()=>DIALS.includes(root.ONETOP_CLUSTER_DIAL)?root.ONETOP_CLUSTER_DIAL:chosen('periods','shape',DIALS,'drum');
 const ITEMS=[...GEARS,'custom'],LAST=ITEMS.length-1,clampI=i=>Math.max(0,Math.min(LAST,i)),TUNE=78,KY=70,KRX=112,KRY=56,KNOB0=-170,KNOBSTEP=26.7;
 const GD={p:0,v:0,target:0,raf:0,drag:null,wheel:0};
 // The drum's surface, like a watch crown (ONETOP_CLUSTER_CROWN): fine knurl, coarse flutes, diamond knurl, grip bands
 // at the edges or rubber ridges. Its ridges ride the cylinder, narrowing and darkening as they turn away.
 // The fine straight knurl (the default: 200 ridges around the barrel, faint) or the others to compare;
 // ONETOP_CLUSTER_KNURL sets the strength (0–1, 0.28 by default), ONETOP_CLUSTER_RIDGES the straight ridges' count.
 const CROWNS={fine:200,flute:36,diamond:0,band:60,rubber:28},crown=()=>root.ONETOP_CLUSTER_CROWN in CROWNS?root.ONETOP_CLUSTER_CROWN:'fine';
 const knurl=()=>typeof root.ONETOP_CLUSTER_KNURL==='number'?Math.max(0,Math.min(1,root.ONETOP_CLUSTER_KNURL)):.28;
 const ridges=()=>crown()==='fine'&&root.ONETOP_CLUSTER_RIDGES>0?Math.round(root.ONETOP_CLUSTER_RIDGES):CROWNS[crown()];
 const knobAt=i=>{const a=(KNOB0+i*KNOBSTEP)*Math.PI/180;return [Math.cos(a)*KRX,KY+Math.sin(a)*KRY];};
 const knobTurn=p=>{const i=Math.max(0,Math.min(LAST-1,Math.floor(p))),f=p-i,ang=j=>{const [x,y]=knobAt(j);return Math.atan2(x,KY-y)*180/Math.PI;};return ang(i)+(ang(i+1)-ang(i))*f;};
 function gearMarkup(kind,label){
  const btn=(k,i,style='')=>`<button type="button" data-cluster-period="${k}" data-i="${i}"${k==='custom'?' aria-haspopup="true"':''}${style?` style="${style}"`:''}>${esc(label(k))}</button>`;
  if(kind==='drum')return `<div class="gd-knurl" data-crown="${crown()}" style="--k:${knurl()};--rw:${ridges()>100?2:3}px">${'<i></i>'.repeat(ridges())}</div><i class="gd-shade"></i><div class="gd-cyl">${ITEMS.map((k,i)=>btn(k,i)).join('')}</div><i class="gd-lens"></i>`;
  if(kind==='roller')return `<button type="button" class="gd-step" data-gear-step="-1" aria-label="이전 기간">‹</button><div class="gd-roll">${ITEMS.map((k,i)=>btn(k,i)).join('')}</div><button type="button" class="gd-step" data-gear-step="1" aria-label="다음 기간">›</button>`;
  if(kind==='tuner')return `<div class="gd-strip" style="width:${ITEMS.length*TUNE}px">${ITEMS.map((k,i)=>btn(k,i,`left:${(i+.5)*TUNE}px`)).join('')}</div><i class="gd-needle"></i>`;
  if(kind==='knob')return `${ITEMS.map((k,i)=>{const [x,y]=knobAt(i);return btn(k,i,`left:calc(50% + ${x.toFixed(1)}px);top:${y.toFixed(1)}px`);}).join('')}<div class="gd-k"><i></i></div>`;
  return `<div class="gd-track">${ITEMS.map((k,i)=>`<i style="left:${((i+.5)/ITEMS.length*100).toFixed(3)}%"></i>`).join('')}<b class="gd-lv"></b></div><div class="gd-labels">${ITEMS.map((k,i)=>btn(k,i)).join('')}</div>`;
 }
 // Where every part stands at position p (a fractional index while it turns).
 function gearPlace(box,p){
  const kind=box.dataset.kind,w=box.clientWidth||300;
  box.querySelectorAll('[data-i]').forEach(b=>{const d=Number(b.dataset.i)-p,on=Math.abs(d)<.5;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));
   // The drum shows three stops either side, the furthest tilted 72°; any further round the back are hidden.
   if(kind==='drum'){const a=d*24,far=Math.abs(a)>78,r=Math.max(-72,Math.min(72,a))*Math.PI/180;b.style.visibility=far?'hidden':'';
    b.style.transform=`translate(-50%,-50%) translateX(${(w*.42*Math.sin(r)).toFixed(1)}px) rotateY(${(r*180/Math.PI).toFixed(1)}deg)`;b.style.opacity=far?'0':(Math.max(0,Math.cos(r))**1.2).toFixed(3);}
   if(kind==='roller'){const a=Math.max(-90,Math.min(90,d*34)),r=a*Math.PI/180;b.style.transform=`translate(-50%,-50%) translateY(${(40*Math.sin(r)).toFixed(1)}px) rotateX(${(-a).toFixed(1)}deg)`;b.style.opacity=(Math.max(0,Math.cos(r))**2).toFixed(3);}
   if(kind==='tuner')b.style.opacity=Math.max(.35,1-Math.abs(d)*.22).toFixed(3);});
  if(kind==='drum'){const kn=box.querySelector('.gd-knurl'),ridges=kn.children,N=ridges.length,R=w/2,turn=p*26;
   // Each ridge at its angle on the cylinder; the diamond knurl is a pattern that slides with the turn instead.
   if(!N)kn.style.backgroundPosition=`${(-turn*R*Math.PI/180).toFixed(1)}px 0,${(-turn*R*Math.PI/180).toFixed(1)}px 0`;
   for(let j=0;j<N;j++){let a=((j*360/N-turn)%360+540)%360-180;const el=ridges[j];if(Math.abs(a)>86){el.style.opacity='0';continue;}
    const r=a*Math.PI/180,c=Math.cos(r);el.style.opacity=((.25+.75*c)*(crown()==='fine'?knurl()/.28*.55:1)).toFixed(3);el.style.transform=`translateX(${(R+R*Math.sin(r)).toFixed(1)}px) scaleX(${Math.max(.08,c).toFixed(3)})`;}}
  if(kind==='tuner')box.querySelector('.gd-strip').style.transform=`translateX(${(w/2-(p+.5)*TUNE).toFixed(1)}px)`;
  if(kind==='knob')box.querySelector('.gd-k').style.transform=`rotate(${knobTurn(clamp(p/LAST)*LAST).toFixed(2)}deg)`;
  if(kind==='lever')box.querySelector('.gd-lv').style.left=`${((Math.max(0,Math.min(LAST,p))+.5)/ITEMS.length*100).toFixed(3)}%`;
 }
 // A spring with a little overshoot carries it to its stop; with less motion asked for, it is there at once.
 function gearRun(box){
  cancelAnimationFrame(GD.raf);
  if(calm()){GD.p=GD.target;GD.v=0;gearPlace(box,GD.p);return;}
  const step=()=>{if(GD.drag)return;GD.v=(GD.v+(GD.target-GD.p)*.16)*.72;GD.p+=GD.v;
   if(Math.abs(GD.target-GD.p)<.002&&Math.abs(GD.v)<.002){GD.p=GD.target;GD.v=0;gearPlace(box,GD.p);return;}
   gearPlace(box,GD.p);GD.raf=requestAnimationFrame(step);};
  GD.raf=requestAnimationFrame(step);
 }
 function gearCommit(rootEl,i){const k=ITEMS[clampI(Math.round(i))];if(k==='custom')toggleRange(rootEl,true);else{toggleRange(rootEl,false);last?.ctx.selectPeriod?.(k);}}
 function gearBind(box,rootEl){
  // Pixels of drag per stop, and which way a drag turns it.
  const unit={drum:()=>box.clientWidth*.17,tuner:()=>TUNE,roller:()=>30,knob:()=>34,lever:()=>box.clientWidth/ITEMS.length}[box.dataset.kind],dir={drum:-1,tuner:-1,roller:-1,knob:1,lever:1}[box.dataset.kind];
  box.onpointerdown=e=>{if(e.button!==0||e.target.closest('[data-gear-step]'))return;GD.drag={x:e.clientX,y:e.clientY,p:GD.p,id:e.pointerId,moved:false};cancelAnimationFrame(GD.raf);};
  box.onpointermove=e=>{const d=GD.drag;if(!d)return;const delta=box.dataset.kind==='roller'?e.clientY-d.y:e.clientX-d.x;
   if(!d.moved&&Math.abs(delta)>4){d.moved=true;box.setPointerCapture?.(d.id);}if(!d.moved)return;GD.p=Math.max(-.4,Math.min(LAST+.4,d.p+dir*delta/unit()));gearPlace(box,GD.p);};
  box.onpointerup=box.onpointercancel=e=>{const d=GD.drag;GD.drag=null;if(!d)return;
   if(d.moved){GD.target=clampI(Math.round(GD.p));box.dataset.dragged='1';setTimeout(()=>delete box.dataset.dragged,0);gearRun(box);gearCommit(rootEl,GD.target);return;}
   // A press between labels picks the nearest one shown.
   if(!e.target.closest('button')){let best=null,gap=1/0;box.querySelectorAll('[data-i]').forEach(b=>{if(b.style.visibility==='hidden')return;const r=b.getBoundingClientRect(),g=Math.abs(r.left+r.width/2-e.clientX);if(g<gap){gap=g;best=b;}});
    if(best){GD.target=Number(best.dataset.i);gearRun(box);gearCommit(rootEl,GD.target);return;}}
   gearRun(box);};
  box.onwheel=e=>{const sgn=Math.sign(e.deltaY||e.deltaX);if(!sgn)return;e.preventDefault();GD.target=clampI(GD.target+sgn);gearRun(box);clearTimeout(GD.wheel);GD.wheel=setTimeout(()=>{GD.wheel=0;gearCommit(rootEl,GD.target);},280);};
  box.onkeydown=e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();GD.target=clampI(GD.target+(e.key==='ArrowRight'?1:-1));gearRun(box);gearCommit(rootEl,GD.target);};
 }
 function gearDial(rootEl,r,lang){
  const box=rootEl.querySelector('.cl-gear>div'),kind=dialKind(),R=root.OneTopRanges,preset=GEARS.includes(r.period);
  const label=k=>k==='custom'?(preset?'기간 지정':r.period==='all'?'전체 기록':R?R.label(r.period,lang):r.period):R?R.label(k,lang):k;
  const key=kind+'|'+lang+'|'+label('custom'),at=preset?GEARS.indexOf(r.period):LAST;
  // One kind's class at a time: a picker that was another kind before keeps none of its look.
  if(box.dataset.key!==key){const first=!box.dataset.kind;box.dataset.key=key;box.dataset.kind=kind;box.className='gd gd-'+kind;box.tabIndex=0;box.innerHTML=gearMarkup(kind,label);gearBind(box,rootEl);if(first)GD.p=GD.target=at;}
  if(!GD.drag&&GD.target!==at&&!GD.wheel)GD.target=at;
  gearPlace(box,GD.p);if(!GD.drag)gearRun(box);
 }
 // The window's pages, short names in one row; the last one shown is remembered in this browser. The last four are
 // the dashboard's own views (usage map, hour heatmap, goals, computer resources), drawn by the host (ctx.drawPage).
 const MODES=[['sessions','세션'],['flow','토큰 흐름'],['weekly','한도'],['map','사용량 맵'],['heat','히트맵'],['goals','목적지'],['system','리소스']],STORE='onetop.cluster.v1';
 const HOSTED=['map','heat','goals','system'];
 // Warning lights: only what needs a hand now, each a short name with its count. Pressing one shows only what it is
 // about (its sessions on the sessions page, its accounts on the limits page); pressing it again shows everything.
 // Collection running late has no target.
 const ICON={
  waiting:'<path d="M12 3.6 21.6 20H2.4Z"/><path d="M12 9.6v5"/><circle cx="12" cy="17.2" r=".6"/>',
  reconnect:'<path d="M10 14.2 8.1 16.1a3.3 3.3 0 0 1-4.7-4.7L5.3 9.5"/><path d="M14 9.8l1.9-1.9a3.3 3.3 0 0 1 4.7 4.7l-1.9 1.9"/><path d="M8.2 3.6v2.6M3.6 8.2h2.6M15.8 20.4v-2.6M20.4 15.8h-2.6"/>',
  empty:'<path d="M5 20.4V5.6A1.6 1.6 0 0 1 6.6 4h6.2a1.6 1.6 0 0 1 1.6 1.6v14.8M3.4 20.4h12.6M7.4 8.2h5"/><path d="M14.4 10.6h1.4a1.4 1.4 0 0 1 1.4 1.4v4.2a1.5 1.5 0 0 0 3 0V8.6L18 6.4"/>',
  live:'<path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/><circle cx="12" cy="12" r="1.5"/>'};
 const LAMPS=[['waiting','응답 대기','답을 기다리는 세션만 보기'],['reconnect','재로그인','로그인이 끊긴 계정만 보기'],['empty','한도 부족','초기화 전에 바닥나는 계정만 보기'],['live','수집 지연','데이터 수신 지연']];
 const NOTES_MARKUP=`<div class="cl-notes" aria-live="polite"><button type="button" class="cl-note working" data-cluster-alert="working" title="작업 중인 세션만 보기" hidden><i></i><span>작업 중</span> <b></b></button><button type="button" class="cl-note done" data-cluster-alert="done" title="방금 끝난 세션만 보기" hidden><i></i><span>방금 완료</span> <b></b></button></div>`;
 const LAMPS_MARKUP=`<div class="cl-lamps" role="group" aria-label="경고등">${LAMPS.map(([k,label,about])=>`<button type="button" class="cl-lamp ${k}" data-cluster-alert="${k}" title="${about}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span class="cl-lamp-label"><span>${label}</span> <b></b></span></button>`).join('')}</div>`;
 // Warning lights as a car's tell-tale strip (ONETOP_CLUSTER_LAMPS): every light always in its place, dark until it has
 // something to tell, then lit in its colour. label (the default): its name under it, flat; strip: icons alone; count:
 // the count beside a lit icon; badge: the count on its corner; lens: each light in its own lens; chips: named chips.
 const LAMP_STYLES=['chips','strip','count','badge','lens','label'],lampStyle=()=>LAMP_STYLES.includes(root.ONETOP_CLUSTER_LAMPS)?root.ONETOP_CLUSTER_LAMPS:chosen('alerts','shape',LAMP_STYLES,'label');
 // The working light wears the sessions' own working bars, as waiting wears the warning triangle, so a light and the
 // rows it filters look alike.
 ICON.working='<path d="M6.5 19v-6M12 19V5M17.5 19v-9" stroke-width="3"/>';
 ICON.done='<path d="M8.5 4H6.8A1.8 1.8 0 0 0 5 5.8v12.4A1.8 1.8 0 0 0 6.8 20h1.7M15.5 4h1.7A1.8 1.8 0 0 1 19 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-1.7"/><path d="M9 9h6M9 12h6M9 15h6"/>';
 // Live first (green while readings arrive, red as collection running late), then what is working, waiting and done,
 // and the two account troubles in red.
 const TELLS=[['live','실시간','#9be23c'],['working','작업 중','var(--lcd)'],['waiting','응답 대기','#e3b25a'],['done','완료됨','#6ccfa9'],['reconnect','재로그인','#f2797d'],['empty','한도 부족','#f2797d']];
 const TELLS_MARKUP=`<div class="cl-tells" role="group" aria-label="경고등">${TELLS.map(([k,label,c])=>`<button type="button" class="cl-tell ${k}" data-cluster-alert="${k}" style="--c:${c}" title="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><b></b><span>${label}</span></button>`).join('')}</div>`;
 const ALERTS_MARKUP=`<div class="cl-alerts">${NOTES_MARKUP}${LAMPS_MARKUP}${TELLS_MARKUP}</div>`;
 const TEMP=(k,label)=>`<div class="cl-temp ${k}" tabindex="0"><small>${label}</small><svg viewBox="0 0 80 46" aria-hidden="true"><defs><linearGradient id="clTemp-${k}" x1="8" x2="72" gradientUnits="userSpaceOnUse">${LANE.map(([f,c])=>`<stop offset="${f}" stop-color="${c}"/>`).join('')}</linearGradient></defs><path class="t-track" d="M8 40 A32 32 0 0 1 72 40" stroke="url(#clTemp-${k})"/><path class="t-val" d="M8 40 A32 32 0 0 1 72 40" pathLength="100" stroke-dasharray="0 100" stroke="url(#clTemp-${k})"/><line class="t-needle" x1="40" y1="40" x2="40" y2="14"/><circle cx="40" cy="40" r="3.5"/></svg><b class="t-read">—</b><span class="cl-tip t-tip" role="tooltip"></span></div>`;
 const ODO_MARKUP=`<div class="cl-lf"><div class="cl-temps">${TEMP('cpu','CPU')}${TEMP('memory','메모리')}</div><div class="cl-odo"><small><span>합계</span><span class="cl-odo-of"> · <span class="cl-odo-span"></span></span></small><b class="cl-led" role="img"></b></div>
     <div class="cl-trip"><div class="cl-trip-v"><span>트립</span> <b class="cl-trip-n"></b> <span class="cl-trip-u">tokens</span><span class="cl-trip-out" hidden>기록 범위 밖</span></div>
     <div class="cl-trip-h"><span class="cl-trip-since"></span><button type="button" data-cluster-trip title="지금부터 다시 셉니다">리셋</button></div></div></div>`;
 // Fuel gauges' centre-to-centre spacing by how many show: 2–4 → 58px, 5 → 56, 6 → 54, 7 → 50, 8 → 47.
 const PITCH=[0,58,58,58,58,56,54,50,47];
 const FUEL_MARKUP=`<div class="cl-fuel"><small>남은 주간 한도</small><div></div></div>`;
 const stored=()=>{try{return JSON.parse(root.localStorage?.getItem(STORE)||'{}')||{};}catch{return {};}};
 const save=patch=>{try{root.localStorage?.setItem(STORE,JSON.stringify({...stored(),...patch}));}catch{}};
 const now=()=>Date.now()/1000,midnight=()=>{const d=new Date();d.setHours(0,0,0,0);return Math.floor(d.getTime()/1000);};
 // Faces and lower rows to compare (a comparison page sets ONETOP_CLUSTER_STYLE and ONETOP_CLUSTER_LAYOUT); each one
 // keeps every rule of the spec. ring: the concentric face (default); glow: the face lit behind the needle; plate:
 // the figures on a dark plate. row: the lower row on the housing (default); cards: each axis in its own well;
 // band: the lower row in one well across the housing.
 const STYLES=['ring','glow','plate'],LAYOUTS=['row','cards','band'],LEDS=['default','red','amber'];
 const ledScheme=()=>LEDS.includes(root.ONETOP_CLUSTER_LED)?root.ONETOP_CLUSTER_LED:chosen('dials','needle',LEDS,'default');
 // With 0 straight below, where the unit, the name and the display sit around the centred figure (t1 … t5).
 const TEXTS=['t1','t2','t3','t4','t5'],textPlace=()=>TEXTS.includes(root.ONETOP_CLUSTER_TEXT)?root.ONETOP_CLUSTER_TEXT:'t5';
 const dialStyle=()=>STYLES.includes(root.ONETOP_CLUSTER_STYLE)?root.ONETOP_CLUSTER_STYLE:chosen('dials','shape',STYLES,'ring');
 const lowerRow=()=>LAYOUTS.includes(root.ONETOP_CLUSTER_LAYOUT)?root.ONETOP_CLUSTER_LAYOUT:'row';
 // The two dials always sit side by side, on a phone held upright and in the tray as on the dashboard.
 const layout=()=>'pair';
 let tabs=MODES,mounted=null,pick=null,only=null,mode=null,rangeOpen=false,rangeFrom=null,last=null,igniting=false,ignition=false,tripStart=null,ticker=null;
 const ACCOUNT_TELLS=['reconnect','empty'];
 function press(rootEl,kind){
  if(kind==='live')return;only=only===kind?null:kind;
  setMode(rootEl,ACCOUNT_TELLS.includes(kind)?'weekly':'sessions',true);
 }
 function mount(rootEl,ctx){
  // Pages the host cannot draw are left out.
  tabs=MODES.filter(([k])=>(k!=='flow'||ctx.drawFlow)&&(!HOSTED.includes(k)||ctx.drawPage));
  const want=ctx.layout?.opts?.window?.tabs;if(Array.isArray(want)&&want.length){const kept=want.map(k=>tabs.find(t=>t[0]===k)).filter(Boolean);if(kept.length)tabs=kept;}
  // A page that is no longer among the chosen tabs gives way to the first of them.
  mode=tabs.some(([k])=>k===stored().mode)?stored().mode:tabs.some(([k])=>k==='sessions')?'sessions':tabs[0][0];only=null;clearInterval(P.ticker);
  // A hosted list is lifted out before the markup is rebuilt, so it survives a remount.
  if(ctx.sessionsHost&&rootEl.contains(ctx.sessionsHost))ctx.sessionsHost.remove();
  rootEl.innerHTML=`<div class="cluster${ctx.panel?' tray':''}" aria-label="계기판"><div class="cl-body"></div>
   <div class="cl-main">${dial('cl-tach','토큰 속도')}<div class="cl-window" aria-live="off"><div class="cl-gear"><div role="group" aria-label="기간"></div><div class="range-toolbar cl-range" hidden><h2 data-range-label>최근 1시간</h2><div class="chart-periods range-buttons" role="group" aria-label="계기판 기간"></div></div></div><div class="cl-box">
    <div class="cl-modes" role="tablist" aria-label="표시창">${tabs.map(([k,label])=>`<button type="button" role="tab" data-cluster-mode="${k}">${label}</button>`).join('')}</div>
    <div class="cl-page" data-page="sessions" role="tabpanel"><div class="cl-sessions"></div></div>
    <div class="cl-page" data-page="flow" role="tabpanel"><div class="cl-big"><b></b> <small>tokens</small></div>
     <section class="cl-flow-sec"><div class="cl-flow-k"><span>AI별</span><div class="chart-foot cl-legend" id="clusterChartLegend"></div></div><div class="cl-chart"><canvas id="clusterTokenChart"></canvas></div></section>
     ${ctx.drawPage?'<section class="cl-flow-sec"><div class="cl-flow-k"><span>프로젝트별</span><div class="cl-trend-legend history-legend"></div></div><div class="cl-chart cl-trend"><canvas aria-label="프로젝트별 사용량 추이"></canvas></div><div class="cl-empty cl-trend-empty" hidden></div></section>':''}</div>
    <div class="cl-page" data-page="weekly" role="tabpanel"><div class="cl-cards"></div></div>
    <div class="cl-page" data-page="map" role="tabpanel"><div class="cl-pane-h"></div><div class="cl-map map-surface" aria-label="사용량 맵"></div></div>
    <div class="cl-page" data-page="heat" role="tabpanel"><div class="cl-pane-h"></div><div class="cl-heat heatmap is-hours"></div><div class="cl-pane-h cl-year-h"></div><div class="cl-year heatmap-year"></div></div>
    <div class="cl-page" data-page="goals" role="tabpanel"><div class="cl-goals"></div></div>
    <div class="cl-page" data-page="system" role="tabpanel"><div class="cl-pane-h"></div><div class="cl-sys"><canvas id="clusterSystemChart"></canvas></div><div class="cl-procs"></div></div>
   </div></div>${dial('cl-speed','한도 소진')}</div>
   <div class="cl-foot">${ODO_MARKUP}${ALERTS_MARKUP}<div class="cl-left">${FUEL_MARKUP}</div></div></div>`;
  if(ctx.sessionsHost){const pg=rootEl.querySelector('.cl-page[data-page="sessions"]');pg.textContent='';pg.append(ctx.sessionsHost);pg.classList.add('hosted');}
  const ctxNow=()=>last?.ctx||ctx;
  const choose=next=>{pick=next;render(rootEl,ctxNow());};
  const session=row=>{const id=row.dataset.clusterSession||row.dataset.sessionRow;choose(pick?.type==='session'&&pick.id===id?null:{type:'session',id});};
  const account=card=>{const id=card.dataset.clusterAccount;choose(pick?.type==='account'&&pick.id===id?null:{type:'account',id});};
  rootEl.onclick=e=>{
   // The host's own buttons (a hosted list's shortcuts and menus) are the host's to answer.
   if(e.target.closest('[data-act]'))return;
   if(e.target.closest('[data-cluster-clear]')){choose(null);return;}
   const m=e.target.closest('[data-cluster-mode]');if(m){setMode(rootEl,m.dataset.clusterMode);return;}
   const w=e.target.closest('[data-cluster-alert]');if(w){press(rootEl,w.dataset.clusterAlert);return;}
   if(e.target.closest('[data-cluster-trip]')){save({trip:Math.floor(now())});render(rootEl,ctxNow());return;}
   const o=e.target.closest('[data-cluster-open]');if(o){ctxNow().open?.(o.dataset.clusterOpen);return;}
   const st=e.target.closest('[data-gear-step]');if(st){const box=st.closest('.gd');GD.target=clampI(GD.target+Number(st.dataset.gearStep));gearRun(box);gearCommit(rootEl,GD.target);return;}
   const g=e.target.closest('[data-cluster-period]');if(g&&g.closest('[data-dragged]'))return;if(g){if(g.dataset.clusterPeriod==='custom')toggleRange(rootEl,!rangeOpen);else{toggleRange(rootEl,false);ctxNow().selectPeriod?.(g.dataset.clusterPeriod);}return;}
   if(e.target.closest('[data-cluster-add]')){ctxNow().addAccount?.();return;}
   const re=e.target.closest('[data-cluster-reconnect]');if(re){ctxNow().relogin?.(re.dataset.clusterReconnect);return;}
   const a=e.target.closest('[data-cluster-account]');if(a){account(a);return;}
   const s=e.target.closest('[data-cluster-session],[data-session-row]');if(s)session(s);
  };
  rootEl.onkeydown=e=>{
   const tab=e.target.closest('[data-cluster-mode]');
   if(tab&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();const i=tabs.findIndex(([k])=>k===mode),next=tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length][0];setMode(rootEl,next);rootEl.querySelector(`[data-cluster-mode="${next}"]`).focus();return;}
   if(e.key==='Escape'&&rangeOpen){toggleRange(rootEl,false);rootEl.querySelector('[data-cluster-period="custom"]')?.focus();return;}
   if(e.key==='Escape'&&(pick||only)){if(pick)choose(null);else{only=null;render(rootEl,ctxNow());}return;}
   const s=e.target.closest('[data-cluster-session]');if(s&&e.target===s&&(e.key==='Enter'||e.key===' ')){e.preventDefault();session(s);}
   const card=e.target.closest('.cl-card[data-cluster-account]');if(card&&e.target===card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();account(card);}
  };
  // Esc lets go of a picked session or account wherever the focus is, while the cluster shows.
  root.document?.addEventListener('keydown',e=>{if(e.key==='Escape'&&!rangeOpen&&pick&&mounted===rootEl&&rootEl.isConnected&&rootEl.offsetParent)choose(null);});
  // The slider closes when the pointer goes down anywhere outside it.
  root.document?.addEventListener('pointerdown',e=>{if(rangeOpen&&rootEl.isConnected&&!e.target.closest('.cl-range,[data-cluster-period="custom"]'))toggleRange(rootEl,false);});
  mounted=rootEl;showMode(rootEl);ctx.rangeControls?.();
  clearInterval(ticker);ticker=setInterval(()=>tick(rootEl),250);
 }
 function showMode(rootEl){
  rootEl.querySelectorAll('[data-cluster-mode]').forEach(b=>{const on=b.dataset.clusterMode===mode;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;b.classList.toggle('on',on);});
  // On a narrow window the tab row scrolls; the chosen tab stays in view.
  const on=rootEl.querySelector('[data-cluster-mode].on'),row=on?.parentElement;
  if(on&&row&&row.scrollWidth>row.clientWidth){const at=on.getBoundingClientRect().left-row.getBoundingClientRect().left+row.scrollLeft;row.scrollLeft=Math.max(0,Math.min(at-(row.clientWidth-on.offsetWidth)/2,row.scrollWidth-row.clientWidth));}
  rootEl.querySelectorAll('.cl-page').forEach(p=>p.hidden=p.dataset.page!==mode);
 }
 // keep: a warning's filter stays (it chose the page); choosing a tab yourself shows everything again.
 function setMode(rootEl,next,keep=false){
  if(!tabs.some(([k])=>k===next))return;mode=next;if(!keep)only=null;
  save({mode});
  showMode(rootEl);if(last)render(rootEl,last.ctx);if(mode==='flow')root.requestAnimationFrame?.(()=>last?.ctx.drawFlow?.());
 }
 function toggleRange(rootEl,open){
  rangeOpen=open;rangeFrom=open?last?.r.period:null;const box=rootEl.querySelector('.cl-range');if(box)box.hidden=!open;
  // A dial turns to the custom stop while the slider is open and back to the period in use when it closes.
  const dial=rootEl.querySelector('.cl-gear>.gd');if(dial&&last){GD.target=open?LAST:GEARS.includes(last.r.period)?GEARS.indexOf(last.r.period):LAST;gearRun(dial);}
  rootEl.querySelector('[data-cluster-period="custom"]')?.setAttribute('aria-expanded',String(open));
  if(open)last?.ctx.rangeControls?.();
 }
 // Rows keep their elements while the same items stay in the same order, so bars and needles inside them
 // move instead of being redrawn; otherwise the list is built again.
 function keyed(box,items,key,build,update){
  const keys=items.map(key).join('\n');
  if(box.dataset.keys!==keys||box.children.length!==items.length){box.dataset.keys=keys;box.innerHTML=items.map(build).join('');}
  [...box.children].forEach((el,i)=>update(el,items[i]));
 }
 // The odometer rolls like a car's: each digit a wheel that only ever turns up (9 rolls on to 0), the count never goes
 // back while the period stays, and it moves once every three seconds, slowly. ONETOP_CLUSTER_ODO picks the wheels'
 // face: drum (printed digits each in its own shaded window, the default), led (lit segments), led0 (with dim leading
 // zeros), print (printed digits), print0 (printed with dim leading zeros, as the earlier odometer).
 const ODOS=['led','led0','print','print0','drum'],odoFace=()=>ODOS.includes(root.ONETOP_CLUSTER_ODO)?root.ONETOP_CLUSTER_ODO:chosen('odo','shape',ODOS,'drum');
 const ODO={shown:null,period:null,at:0};
 let glyphs=null;
 const odoGlyph=(d,S)=>{if(!S?.seg7)return String(d);glyphs||=Array.from({length:10},(_,k)=>{const h=40,w=22,W=Math.ceil(w+h*Math.tan(9*Math.PI/180)+2);
  return `<svg class="cl-lcd" viewBox="0 -1 ${W} ${h+2}" style="aspect-ratio:${W}/${h+2}" aria-hidden="true">${S.seg7({c:[String(k)],u:'',center1:true},W/2,h,w,h,h*.115,6,false)}</svg>`;});return glyphs[d];};
 function odometer(rootEl,value,S,force=false){
  const el=rootEl.querySelector('.cl-odo>.cl-led');if(!el)return;const period=last?.r.period,target=Math.max(0,Math.min(9999999999,Math.round(value||0)));
  if(ODO.period!==period){ODO.period=period;ODO.shown=null;}
  // A new face (customizing) redraws at once; otherwise the wheels move once every three seconds.
  const face=odoFace();if(!force&&ODO.shown!==null&&now()-ODO.at<3&&ODO.face===face)return;ODO.at=now();ODO.face=face;
  const total=ODO.shown===null?target:Math.max(ODO.shown,target),zeros=face==='led0'||face==='print0',n=zeros?10:String(total).length,s=String(total).padStart(n,'0');
  ODO.shown=total;el.setAttribute('aria-label',total.toLocaleString(root.OneTopI18n?.locale()||'ko-KR')+' tokens');
  const key=face+'|'+n;
  if(el.dataset.wheels!==key){el.dataset.wheels=key;el.dataset.face=face;el.classList.add('cl-wheels');
   const strip=Array.from({length:20},(_,k)=>`<b>${face.startsWith('led')?odoGlyph(k%10,S):k%10}</b>`).join('');
   el.innerHTML=Array.from({length:n},(_,i)=>`${i&&(n-i)%3===0?'<em>,</em>':''}<i data-d="0"><span>${strip}</span></i>`).join('');}
  const lead=n-String(total).length;
  el.querySelectorAll('i').forEach((w,i)=>{const d=Number(s[i]),was=Number(w.dataset.d),sp=w.firstElementChild;w.classList.toggle('lead',i<lead);
   if(d===was)return;w.dataset.d=String(d);
   // Up only: the strip runs 0–9 twice, so a wheel passing 9 turns on into the second run, then settles unseen on the
   // same digit in the first.
   const to=d<was?10+d:d,at=k=>`translateY(${(-k/20*100).toFixed(3)}%)`;
   if(to>=10){sp.style.transform=at(to);sp.addEventListener('transitionend',()=>{sp.style.transition='none';sp.style.transform=at(d);sp.offsetHeight;sp.style.transition='';},{once:true});}
   else sp.style.transform=at(d);});
  let k=0;for(const c of el.children){if(c.tagName==='EM')c.classList.toggle('lead',k<=lead);else k++;}
 }
 // On the drum face the range rolls on the same wheels: a wheel per digit that turns either way to the new hour (4.6,
 // 23, 140), the point between them, dashes without a reading.
 function rangeWheels(el,h){
  const s=valid(h)?(h<9.95?h.toFixed(1):String(Math.min(999,Math.round(h)))):'--',shape=s.replace(/[\d-]/g,'0'),at=d=>`translateY(${(-d/11*100).toFixed(3)}%)`;
  const ds=[...s.replace('.','')].map(ch=>ch==='-'?10:Number(ch));
  if(el.dataset.wheels!==shape){el.dataset.wheels=shape;el.dataset.face='drum';el.classList.add('cl-wheels');delete el.dataset.lcd;
   const strip=Array.from({length:11},(_,k)=>`<b>${k<10?k:'-'}</b>`).join('');let k=0;
   el.innerHTML=[...s].map(ch=>ch==='.'?'<em>.</em>':`<i data-d="${ds[k]}"><span style="transform:${at(ds[k++])}">${strip}</span></i>`).join('');return;}
  el.querySelectorAll('i').forEach((w,i)=>{if(Number(w.dataset.d)===ds[i])return;w.dataset.d=String(ds[i]);w.firstElementChild.style.transform=at(ds[i]);});
 }
 // Between readings the odometer (every three seconds), the trip and the flow chart's current bar run on at the last
 // minute's rate. Capped so a stalled refresh does not run away.
 function tick(rootEl,L=last){
  if(!L||!rootEl.isConnected||rootEl.hidden||calm())return;
  const {r,ctx,at}=L,el=Math.min(30,Math.max(0,now()-at));if(!el)return;
  const total=Math.max(0,(r.tach.tokens||0)+r.tach.climb*el);odometer(rootEl,total,ctx.speed);
  const big=rootEl.querySelector('.cl-page[data-page="flow"] .cl-big b');if(big&&ctx.fmt)big.textContent=ctx.fmt(total);
  const tr=r.trip,add=r.tach.climb*el;
  if(tr?.inRange)rootEl.querySelector('.cl-trip-n').textContent=short(tr.tokens+add,ctx.speed);
  if(L===last&&mode==='flow'&&add>0&&(L.flowAt=(L.flowAt||0)+1)%4===0)ctx.drawFlow?.(Object.entries(r.tach.byKind).filter(([,v])=>v>0).map(([kind,v])=>({t:now(),kind,n:v/HOUR*el})));
 }
 // What every painter reads: the page's translation and locale, the dashboard's colours and numbers, and an
 // account's short name: tool and plan (Claude Max, Codex Pro), an Agy pool by its short name (Agy Gemini), GLM alone.
 function kit(rootEl,ctx){
  const locale=root.OneTopI18n?.locale()||'ko-KR';
  const when=t=>{const d=new Date(t*1000);return d.toLocaleDateString(locale,{weekday:'short'})+' '+d.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});};
  const tool=a=>({Claude:'Claude',Codex:'Codex',Antigravity:'Agy',GLM:'GLM'})[a.kind]||ctx.kindName(a.kind);
  const plan=a=>a.plan||(a.alias||'').replace(/\s+models?$/i,'').replace(/^Claude and GPT$/i,'Claude·GPT');
  return {q:s=>rootEl.querySelector(s),t:k=>root.OneTopI18n?root.OneTopI18n.t(k):k,lang:root.OneTopI18n?.language||'ko',W:ctx.weekly,locale,tool,plan,when,
   color:k=>ctx.colors[k]||'var(--dim)',fmt:v=>ctx.fmt?ctx.fmt(v):reading(v),
   // Range line: when this account's limit runs out at its current burn, or that it lasts to the reset.
   eta:a=>!a.range?'':a.range.state==='idle'?'<span class="eta idle">지금은 쓰지 않음</span>':a.range.state==='enough'?'<span class="eta ok">초기화 전까지 충분</span>'
    :`<span class="eta${a.range.early?' warn':''}"><span>이 속도면</span> <b>${esc(when(a.range.at))}</b> <span>바닥</span></span>`};
 }
 // Both figures on the dashboard's own seven-segment display, drawn by the same OneTopSpeed seg7 as its instrument:
 // the token speed in three cells with k, M or B beside them (108M), the burn in three cells with its decimal point
 // (0.51, 12.4, 135).
 function burnDigits(v){
  if(!valid(v))return {c:['-','-','-'],u:'',dp:0};
  const s=v<9.995?v.toFixed(2):v<99.95?v.toFixed(1):String(Math.min(999,Math.round(v))),dot=s.indexOf('.');
  return {c:[...s.replace('.','')],u:'',dp:dot<0?null:dot-1};
 }
 function lcd(el,v,S,cells){
  if(!S?.seg7)return void(el.textContent=cells?reading(v):v===null?'—':String(Math.round(v)));
  // Only the lit digits are drawn, blank leading cells dropped and a 1 centred in its cell, so the figure sits centred
  // and evenly spaced with nothing behind it.
  let g={...(cells||S.digits)(v),center1:true};const lead=g.c.findIndex(ch=>ch!==' ');if(lead>0)g={...g,c:g.c.slice(lead),dp:Number.isInteger(g.dp)?g.dp-lead:g.dp};
  const key=g.c.join('')+g.u+(g.dp??'')+(g.commas||'');if(el.dataset.lcd===key)return;el.dataset.lcd=key;
  const h=40,w=h*.55,gap=h*.15,us=h*.46,n=g.c.length,m=(Number.isInteger(g.dp)?1:0)+(g.commas?.length||0),tail=g.commas?.length?8:2;
  const W=Math.ceil((n-1)*(w+gap)+w+(g.u?gap+us*.8:0)+m*h*.115*1.2+h*Math.tan(9*Math.PI/180)+2);
  el.innerHTML=`<svg class="cl-lcd" viewBox="0 -1 ${W} ${h+tail}" style="aspect-ratio:${W}/${h+tail}" aria-hidden="true"><defs>${S.glowFilter||''}</defs>${S.seg7(g,W/2,h,w,h,h*.115,gap,false)}</svg>`;
 }
 // The odometer: every digit of the count with lit commas (108,302,097), as a car's odometer.
 const odoDigits=v=>{const s=String(Math.max(0,Math.round(v||0))),n=s.length;return {c:[...s],u:'',commas:[...s].map((_,i)=>i).filter(i=>i<n-1&&(n-1-i)%3===0)};};
 // The range in hours on three cells: 4.6, 23, 140 (999 at most); without a reading, dashes.
 const rangeDigits=h=>{if(!valid(h))return {c:['-','-','-'],u:''};const s=h<9.95?h.toFixed(1):String(Math.min(999,Math.round(h))),d=s.indexOf('.'),c=[...s.replace('.','')];
  while(c.length<3)c.unshift(' ');return {c,u:'',dp:d<0?null:d-1+(3-s.replace('.','').length)};};
 // The two dials, drawn the same on the dashboard and on the tray's panels. busy holds the needles while the
 // ignition sweep runs.
 // Fever: past its limit a dial breaks through, as a racing car does. The token dial's limit is 200M (levels at 300M,
 // 400M, 500M and above), the burn dial's 20%/h (levels at 40, 60, 80%/h and above); past the third the scale goes on
 // without more show. Crossing into a level bursts
 // once; while it stays, the level's effect runs on. ONETOP_CLUSTER_FEVER picks the effect: flash (a white flash and
 // shock rings), flame (a ring of fire round the rim), warp (speed lines streaming out), drive (LIMIT BREAK, OVER
 // DRIVE, FEVER sweeping across), bolt (lightning along the rim at the needle) or spark (sparks off the needle's tip);
 // punch adds the dial jumping forward on a burst and zap a discharge round the whole rim on a burst only. Effects
 // join with '+'; the chosen one (the default) bursts with punch, zap and the drive banner, and keeps the rim's glow
 // beating in the level's colour after.
 const FEVERS=['flash','flame','warp','drive','bolt','spark','punch','zap'];
 const feverKind=()=>{const k=String(root.ONETOP_CLUSTER_FEVER||'').split('+').filter(x=>FEVERS.includes(x));return k.length?k.join(' '):'drive zap punch';};
 const FEVER_WORD=['','LIMIT BREAK','OVER DRIVE','FEVER'],FEVER_HUE=[null,['#ff8a1f','#ffd23f'],['#ff2fb4','#9d5bff'],['#33e7ff','#ffffff']];
 function paintFever(tach,level){
  const kind=feverKind(),was=tach._fl||0;
  if(!tach.querySelector('.cl-fv')){tach.insertAdjacentHTML('afterbegin','<i class="cl-fv-under" aria-hidden="true"></i>');
   tach.insertAdjacentHTML('beforeend','<div class="cl-fv" aria-hidden="true"><i class="fv-flash"></i><i class="fv-ring"></i><i class="fv-ring"></i><i class="fv-ring"></i><b class="fv-t"></b><canvas></canvas></div>');}
  tach._fl=level;tach.dataset.fk=kind;
  if(level){tach.dataset.fever=String(level);const [a,b]=FEVER_HUE[level];tach.style.setProperty('--fv',a);tach.style.setProperty('--fv2',b);tach.querySelector('.fv-t').textContent=FEVER_WORD[level];}
  else{delete tach.dataset.fever;tach.style.removeProperty('--fv');tach.style.removeProperty('--fv2');}
  // A new level bursts once (the first reading past the limit too); the motion setting keeps it still.
  if(level>was&&!calm()){delete tach.dataset.burst;void tach.offsetWidth;tach.dataset.burst=String(level);clearTimeout(tach._fb);
   tach._fb=setTimeout(()=>delete tach.dataset.burst,2200);tach._burstAt=performance.now();}
  // Lightning and sparks run on a canvas while the level stays; a zap only for the burst's discharge.
  const drawn=level&&!calm()&&(/\b(bolt|spark)\b/.test(kind)||/\bzap\b/.test(kind)&&tach.dataset.burst);
  if(drawn&&!tach._raf)feverLoop(tach);
  if(!drawn&&tach._raf){cancelAnimationFrame(tach._raf);tach._raf=0;const c=tach.querySelector('.cl-fv canvas');c.getContext('2d').clearRect(0,0,c.width,c.height);tach._parts=[];}
 }
 // Lightning and sparks drawn on a canvas a twenty-fifth wider than the dial on every side, in the dial's own 340 units.
 function feverLoop(tach){
  const c=tach.querySelector('.cl-fv canvas'),g=c.getContext('2d');let prev=performance.now(),arcs=[],arcAt=0;tach._parts=tach._parts||[];
  const step=now=>{
   const zapOnly=!/\b(bolt|spark)\b/.test(tach.dataset.fk);
   if(!tach.isConnected||!tach.dataset.fever||zapOnly&&!(tach._burstAt&&now-tach._burstAt<900)){tach._raf=0;g.clearRect(0,0,c.width,c.height);return;}
   tach._raf=requestAnimationFrame(step);
   const dpr=Math.min(2,root.devicePixelRatio||1),w=tach.clientWidth*1.08;if(!w)return;
   if(c.width!==Math.round(w*dpr)){c.width=c.height=Math.round(w*dpr);}
   const k=c.width/(340*1.08),o=c.width/2-170*k,X=x=>o+x*k,level=Number(tach.dataset.fever),[hue,hue2]=FEVER_HUE[level],dt=Math.min(.05,(now-prev)/1000);prev=now;
   const burst=tach._burstAt&&now-tach._burstAt<900,f=tach._f||0,tip=ang(f);
   g.clearRect(0,0,c.width,c.height);g.globalCompositeOperation='lighter';
   if(/\b(bolt|zap)\b/.test(tach.dataset.fk)){
    // New bolts every 70 ms: one to four arcs crawling along the rim round the needle, more and brighter by level.
    if(now-arcAt>70){arcAt=now;arcs=[];const n=burst?10:[0,1,2,4][level];
     for(let i=0;i<n;i++){const mid=burst?Math.random()*Math.PI*2:tip+(Math.random()-.5)*.5*(level),span=(.18+Math.random()*.25)*(burst?1.6:1),pts=[];
      for(let t=-1;t<=1.0001;t+=.125){const a=mid+t*span/2,rr=158+(Math.random()-.5)*(10+level*4);pts.push([170+rr*Math.cos(a),170+rr*Math.sin(a)]);}
      arcs.push(pts);if(burst&&i<4){const a=mid,bp=[];for(let r=158;r>40;r-=14)bp.push([170+(r)*Math.cos(a)+(Math.random()-.5)*14,170+r*Math.sin(a)+(Math.random()-.5)*14]);arcs.push(bp);}}}
    for(const pts of arcs)for(const [width,colour,blur] of [[6,hue,18],[1.6,hue2,6]]){g.beginPath();pts.forEach(([x,y],i)=>i?g.lineTo(X(x),X(y)):g.moveTo(X(x),X(y)));g.lineWidth=width*k;g.strokeStyle=colour;g.shadowColor=hue;g.shadowBlur=blur*k;g.globalAlpha=width>3?.45:1;g.stroke();}
    g.globalAlpha=1;g.shadowBlur=0;
   }else{
    // Sparks thrown off the tip as off a grinding wheel: hot white cooling to the level's colour, falling as they go.
    const P=tach._parts,emit=(n,spread)=>{for(let i=0;i<n;i++){const a=tip+(Math.random()-.5)*spread,v=90+Math.random()*(160+level*60),side=tip+Math.PI/2;
      P.push({x:170+150*Math.cos(tip),y:170+150*Math.sin(tip),vx:Math.cos(a)*v*.6+Math.cos(side)*v*.7,vy:Math.sin(a)*v*.6+Math.sin(side)*v*.7,life:.45+Math.random()*.6,age:0});}};
    if(tach.dataset.burst===String(level)&&!tach._burstDone){tach._burstDone=true;emit([0,120,200,320][level],Math.PI*2);}
    if(!tach.dataset.burst)tach._burstDone=false;
    tach._acc=(tach._acc||0)+dt*[0,26,60,120][level];const n=Math.floor(tach._acc);tach._acc-=n;emit(n,.9);
    for(let i=P.length-1;i>=0;i--){const p=P[i];p.age+=dt;if(p.age>p.life){P.splice(i,1);continue;}p.vy+=260*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
     const t=p.age/p.life;g.strokeStyle=t<.3?hue2:hue;g.globalAlpha=1-t;g.lineWidth=(2.2-t*1.4)*k;g.beginPath();g.moveTo(X(p.x),X(p.y));g.lineTo(X(p.x-p.vx*.03),X(p.y-p.vy*.03));g.stroke();}
    g.globalAlpha=1;if(P.length>900)P.splice(0,P.length-900);
   }
   g.globalCompositeOperation='source-over';
  };
  tach._raf=requestAnimationFrame(step);
 }
 function paintDials(rootEl,r,ctx,busy){
  const {q,t,W,color,fmt,tool,plan}=kit(rootEl,ctx);
  // Token speed: the period's average in tokens an hour; the scale in M (B from a billion), each number with its unit.
  const div=r.tach.full>=1e9?1e9:1e6,tach=q('.cl-tach');
  scaleMarkup(tach,tachMarks(r.tach.full,div),v=>v===0?'0':scaleNumber(v)+(div===1e9?'B':'M'));paintFever(tach,tachLevel(r.tach.full));
  lcd(tach.querySelector('.cl-read b'),r.tach.rate,ctx.speed);lane(tach,LANE);redline(tach,.8);
  tach.style.setProperty('--now',r.tach.rate===null?'var(--muted)':colorAt(LANE,r.tach.rate/r.tach.full));
  tach.querySelector('.cl-read small').innerHTML='<span>tokens/시간</span>';
  tach.setAttribute('aria-label',`${t('토큰 속도')} ${r.tach.rate===null?'—':fmt(r.tach.rate)} ${t('tokens/시간')} · ${ctx.caption}`);
  // Burn: the subject's %/h of its weekly limit, in its tool's colour (the accent for every AI together).
  const speed=q('.cl-speed'),sub=r.speed.subject;scaleMarkup(speed,burnMarks(r.speed.max),scaleNumber);paintFever(speed,burnLevel(r.speed.max));
  speed.style.setProperty('--subject',sub&&sub.type!=='all'?color(sub.kind):'var(--accent)');
  lcd(speed.querySelector('.cl-read b'),r.speed.value,ctx.speed,burnDigits);
  speed.querySelector('.cl-read small').innerHTML='<span>%/시간</span>';
  const c=r.speed.cruise;
  speed.querySelector('.cl-name').title=c===null?'주간 한도를 쓰는 속도':`주간 한도를 쓰는 속도 · ${burnText(c)}로 쓰면 초기화 때 한도가 딱 맞습니다`;
  // The name line names the subject: 한도 소진 · 전체 AI, or the session's model and effort (Opus 5.5 · xhigh), or the
  // account (Claude Max). A picked subject lets go when its row, card or gauge is pressed again, on Esc or on its name.
  const acct=sub&&r.accounts.find(a=>a.id===sub.account),nameEl=speed.querySelector('.cl-name'),s=sub?.session;
  const html=!sub||sub.type==='all'?'<span>한도 소진</span><em> · 전체 AI</em>'
   :sub.type==='session'?`<i style="background:${color(sub.kind)}"></i><b data-user-content>${esc(s.model?modelName(s.model):ctx.name(s))}</b>${s.effort?`<u>${esc(s.effort)}</u>`:''}`
   :`<i style="background:${color(sub.kind)}"></i><b>${esc(acct?tool(acct):ctx.kindName(sub.kind))}</b>${acct&&plan(acct)?`<span>${esc(plan(acct))}</span>`:''}`;
  if(nameEl.dataset.html!==html){nameEl.dataset.html=html;nameEl.innerHTML=html;}
  nameEl.classList.toggle('picked',!!r.speed.picked);nameEl.toggleAttribute('data-cluster-clear',!!r.speed.picked);
  const why=c===null?'':` · ${burnText(c)}로 쓰면 초기화 때 한도가 딱 맞습니다`;
  nameEl.title=sub?.type==='all'?`한도 소진: 주간 한도를 보고하는 계정 ${sub.count}개의 평균 · 테두리의 삼각형은 계정별${why}`
   :r.speed.picked?[sub.type==='session'?ctx.name(s):'',s?.model,s?.effort].filter(Boolean).join(' · ')+why+' · 누르면 전체 AI':'한도 소진'+why;
  // Range: hours of work left before the limit runs out, red when that comes before the reset.
  const rg=speed.querySelector('.cl-rng'),reach=r.speed.reach||{state:'unknown'},sign=reach.state==='reconnect';
  // Beside a figure the hour is a unit (27 h, 27 小时), not the word the page translates alone (Hour).
  const ru=rg.querySelector('.cl-rng-u'),unit=({en:'h',zh:'小时'})[root.OneTopI18n?.language]||'시간';if(ru.textContent!==unit)ru.textContent=unit;
  rg.classList.toggle('early',!!reach.early);rg.classList.toggle('sign',sign);rg.querySelector('.cl-rng-w').hidden=!sign;
  const rl=rg.querySelector('.cl-led');rl.setAttribute('aria-label',valid(reach.hours)?`${reach.hours<9.95?reach.hours.toFixed(1):Math.min(999,Math.round(reach.hours))} 시간`:'—');
  if(odoFace()==='drum')rangeWheels(rl,reach.hours);
  else{if(rl.dataset.wheels){rl.classList.remove('cl-wheels');delete rl.dataset.wheels;delete rl.dataset.face;}lcd(rl,valid(reach.hours)?reach.hours:null,ctx.speed,rangeDigits);}
  const first=reach.account&&r.accounts.find(a=>a.id===reach.account),who=first?(tool(first)+' '+plan(first)).trim():'';
  rg.title=sign?'로그인이 끊긴 계정이라 남은 한도를 읽을 수 없습니다':reach.state==='idle'?'지금은 한도를 쓰지 않습니다':!valid(reach.hours)?'이 대상은 주간 한도가 없어 계산할 수 없습니다'
   :`이 속도면 약 ${reading(reach.hours)}시간 뒤 한도 바닥${sub?.type==='all'&&who?` · ${who}이 가장 먼저`:''}${reach.early?' · 초기화 전에 바닥납니다':' · 그 전에 초기화됩니다'}`;
  speed.setAttribute('aria-label',`${t('한도 소진')} ${reading(r.speed.value)}%/h`);
  // The burn lane and figure keep one colour: the accent for every AI, the tool's colour for a session or an account,
  // lifted a little so a darker tool colour still reads as a lit display.
  const tone=lift(sub&&sub.type!=='all'&&/^#[0-9a-f]{6}$/i.test(ctx.colors[sub.kind]||'')?ctx.colors[sub.kind]:'#6ccfa9');
  lane(speed,[[0,tone],[1,tone]]);redline(speed,.8);
  speed.style.setProperty('--now',r.speed.value===null?'var(--muted)':tone);
  rootEl.querySelector('.cluster')?.classList.toggle('running',r.working>0);
  // Every account's own burn as a small mark in its tool's colour on the rim, pointing in; nothing crosses the figures.
  speed.querySelector('.cl-multi').innerHTML=(r.speed.multi||[]).map(m=>{const a=ang(clamp(m.value/r.speed.max)),p=(rr,d)=>[170+rr*Math.cos(a+d),170+rr*Math.sin(a+d)].map(v=>v.toFixed(1)).join(',');
   return `<polygon points="${p(137,0)} ${p(157,.045)} ${p(157,-.045)}" style="fill:${color(m.kind)}"/>`;}).join('');
  if(!busy){needle(tach,r.tach.rate===null?0:r.tach.rate/r.tach.full);needle(speed,r.speed.value===null?0:r.speed.value/r.speed.max);}
 }
 // filter: the warning pressed, shown as held down; live is false on the compact panels, whose warnings only tell.
 function paintLamps(rootEl,r,filter,live=true){
  const q=s=>rootEl.querySelector(s),t=k=>root.OneTopI18n?root.OneTopI18n.t(k):k;
  for(const [k,n] of [['working',r.working],['done',r.tells.done?.length||0]]){const el=q(`.cl-note.${k}`);if(!el)continue;el.hidden=!n;el.querySelector('b').textContent=String(n);
   el.setAttribute('aria-pressed',String(filter===k));el.setAttribute('aria-disabled',String(!live||!n));}
  for(const [k,label] of LAMPS){const el=q(`.cl-lamp.${k}`),n=k==='live'?null:r.tells[k].length,on=k==='live'?!r.tells.fresh:n>0;
   el.classList.toggle('lit',on);el.setAttribute('aria-disabled',String(!live||k==='live'||!n));el.setAttribute('aria-pressed',String(filter===k));el.querySelector('.cl-lamp-label b').textContent=n===null?'':String(n);
   el.setAttribute('aria-label',`${t(label)}${n===null?'':' '+n}`);}
  // The tell-tale strip: the live light is green while readings arrive and red, named for it, when they run late.
  for(const [k,label] of TELLS){const el=q(`.cl-tell.${k}`);if(!el)continue;const n=k==='working'?r.working:k==='live'?null:r.tells[k]?.length||0,late=k==='live'&&!r.tells.fresh;
   el.classList.toggle('lit',k==='live'||n>0);el.classList.toggle('late',late);el.querySelector('b').textContent=n?String(n):'';
   el.querySelector('span').textContent=late?'수집 지연':label;el.title=`${late?'수집 지연':label}${n?' '+n:''}`;
   el.setAttribute('aria-disabled',String(!live||k==='live'||!n));el.setAttribute('aria-pressed',String(filter===k));}
 }
 function paintFuel(rootEl,r,ctx){
  const {q,t,W,color,locale,eta,tool,plan,when}=kit(rootEl,ctx);
  // CPU and memory sit beside the trip under the token dial, whatever the number of saved limits.
  const lf=q('.cl-lf'),temps=q('.cl-temps');
  if(lf&&temps&&temps.parentElement!==lf)lf.prepend(temps);
  // From 220px the odometer sits in the token dial's lower opening, level with the burn dial's subject, so both
  // dials fill to the same depth; the trip stays in the lower row. Smaller dials keep both in the lower row, side by side.
  const odo=q('.cl-odo'),trip=q('.cl-trip'),tach=q('.cl-tach');
  if(odo)odo.title=`합계 · ${ctx.caption}`;
  if(lf&&odo&&trip&&tach&&!rootEl.querySelector('.cluster.compact')){const inDial=tach.offsetWidth>=220;
   if(inDial&&odo.parentElement!==tach)tach.append(odo);
   if(!inDial&&odo.parentElement!==lf)lf.insertBefore(odo,trip);}
  // Fuel: a gauge per account (as many as the room beside it holds, up to eight, by provider first, then +N) filled with
  // what is left of its weekly limit, named by tool and plan; the details show on hover or focus, and pressing one
  // picks it for the burn dial. The gauges sit closer as there are more of them (PITCH, centre to centre), never so
  // close that two names touch; seven and eight take a smaller name.
  const box=q('.cl-fuel'),fuel=q('.cl-fuel>div'),title=q('.cl-fuel>small');
  const room=box.parentElement.clientWidth-(box.previousElementSibling?.offsetWidth||0)-8;
  // Agy reports a pool for each model family; one gauge stands for them all, the pool nearest its end, with the
  // others in its details.
  const agy=r.accounts.filter(a=>a.kind==='Antigravity'),lead=agy.length>1?[...agy].sort((a,b)=>(a.left??101)-(b.left??101))[0]:null;
  const gauges=lead?r.accounts.filter(a=>a.kind!=='Antigravity'||a===lead).map(a=>a===lead?{...a,pools:agy.filter(x=>x!==lead)}:a):r.accounts;
  const cap=LAY?.opts?.fuel?.count,fits=()=>{if(room<=0)return Math.min(4,cap||4);let n=Math.min(8,cap||8,gauges.length||1);while(n>3&&n*PITCH[n]>room)n--;return n;};
  const draw=n=>{
  fuel.dataset.n=String(n);fuel.style.setProperty('--can-w',PITCH[Math.max(2,n)]+'px');
  const cans=W.pick(gauges,n),more=gauges.length-cans.length;
  const heading=cans.some(a=>a.weekly===false)?'남은 한도':'남은 주간 한도';
  // The account that runs out first before its reset, said in one line beside the heading (reports.js says the same
  // on the account cards).
  const first=r.accounts.filter(a=>a.range?.state==='empty'&&a.range.early).sort((x,y)=>x.range.at-y.range.at)[0];
  const ahead=first?t('{0} {1} 바닥').replace('{0}',(tool(first)+' '+plan(first)).trim()).replace('{1}',when(first.range.at)):'',key=heading+'|'+more+'|'+ahead;
  const short=a=>(tool(a)+' '+plan(a)).trim();
  const rest=gauges.filter(a=>!cans.includes(a)).map(short).join(', ');
  if(title.dataset.key!==key+rest){title.dataset.key=key+rest;title.innerHTML=`<span>${heading}</span>${more?` <em class="cl-more" title="${esc(rest)}">+${more}</em>`:''}${ahead?` <em class="cl-ahead" title="초기화 전에 바닥납니다">${esc(ahead)}</em>`:''}`;}
  if(!r.accounts.length){fuel.dataset.keys='';fuel.innerHTML='<div class="cl-empty">연결된 구독 계정이 없습니다.</div>';}
  else keyed(fuel,cans,a=>a.id,a=>`<button type="button" class="cl-can" data-cluster-account="${esc(a.id)}" style="--c:${color(a.kind)}"><i><s></s></i><b></b><span class="cl-tip" role="tooltip"></span></button>`,
   (el,a)=>{const on=r.speed.account===a.id&&r.speed.picked,low=a.left!==null&&a.left<15;
    el.classList.toggle('on',on);el.classList.toggle('low',low);el.classList.toggle('stale',!a.current);el.classList.toggle('warn',a.reconnect);el.setAttribute('aria-pressed',String(on));
    el.querySelector('i>s').style.height=(a.left===null?0:a.left)+'%';
    // Under a gauge the plan stays one short word (Max, Pro, Biz; an Agy pool by its last name, Gemini 4 Argon as
    // Argon); the account and the whole name are in its details, so nothing is cut short.
    const whole=plan(a),last=/\s/.test(whole)?whole.split(/\s+/).pop():whole,cap=last.charAt(0).toUpperCase()+last.slice(1);
    const second=({Business:'Biz',Enterprise:'Ent'})[cap]||cap;
    const name=`<span class="can-tool">${esc(tool(a))}</span><span class="can-plan">${esc(second||'—')}</span>`,nb=el.querySelector('b');if(nb.dataset.html!==name){nb.dataset.html=name;nb.innerHTML=name;}
    const reset=a.reset?new Date(a.reset*1000).toLocaleString(locale,{month:'numeric',day:'numeric',weekday:'short',hour:'numeric',minute:'2-digit'}):'';
    const tip=`<span class="cl-tip-h"><i></i><span>${esc(tool(a))}</span>${plan(a)?`<em>${esc(plan(a))}</em>`:''}</span>${a.who?`<span class="cl-tip-who" data-user-content>${esc(a.who)}</span>`:''}
     ${a.reconnect?'<span class="warn">재로그인 필요</span>':a.left===null?'<span>보고 대기</span>':`<span>${a.window?`<span>${esc(a.window)}</span> `:''}<b>${W.percent(a.left)}</b> <span>남음</span></span>`}
     ${reset?`<span class="cl-reset"><span>초기화</span> <span>${esc(reset)}</span></span>`:''}${valid(a.burn)?`<span><span>평균</span> <span>${burnText(a.burn)}</span></span>`:''}${eta(a)}
     ${(a.pools||[]).map(p=>`<span class="cl-tip-pool"><span>${esc(plan(p))}</span> <b>${p.left===null?'—':W.percent(p.left)}</b> <span>남음</span></span>`).join('')}`;
    const tp=el.querySelector('.cl-tip');if(tp.dataset.html!==tip){tp.dataset.html=tip;tp.innerHTML=tip;}});
  return cans.length;};
  draw(fits());
 }
 function paintTrip(rootEl,r,ctx){
  const {q,locale}=kit(rootEl,ctx);
  // Trip: the tokens since the last reset; before the record begins they are outside it.
  const tr=r.trip,outside=!!tr&&!tr.inRange;
  const d=tr?new Date(tr.start*1000):null,today=d&&d.toDateString()===new Date().toDateString();
  // English puts the word first (since 09:00); Korean and Chinese after (09:00부터, 09:00起).
  const at=tr?esc(d.toLocaleString(locale,{...(today?{}:{month:'numeric',day:'numeric'}),hour:'2-digit',minute:'2-digit',hourCycle:'h23'})):'';
  q('.cl-trip-since').innerHTML=!tr?'':root.OneTopI18n?.language==='en'?`<span>since</span> <span>${at}</span>`:`<span>${at}</span><span>부터</span>`;
  q('.cl-trip-v').classList.toggle('outside',outside);q('.cl-trip-out').hidden=!outside;
  q('.cl-trip-n').textContent=tr?.inRange?short(tr.tokens,ctx.speed):'—';
  // Odometer: the period's tokens, digit wheels rolling to the new count.
  q('.cl-odo-span').textContent=ctx.caption;odometer(rootEl,r.tach.tokens,ctx.speed);
 }
 // CPU and memory, each the busiest computer's; the details list every computer.
 function paintTemps(rootEl,r){
  const q=s=>rootEl.querySelector(s),t=k=>root.OneTopI18n?root.OneTopI18n.t(k):k,pc=v=>v===null?'—':Math.round(v)+'%';
  const tip=r.heat.computers.length?r.heat.computers.map(c=>`<span class="cl-tip-h"><span>${c.name?esc(c.name):'이 컴퓨터'}</span></span><span><span>CPU</span> ${pc(c.cpu)} · <span>메모리</span> ${pc(c.memory)}</span>`).join(''):'<span>보고 대기</span>';
  for(const [k,label] of [['cpu','CPU'],['memory','메모리']]){const el=q(`.cl-temp.${k}`);if(!el)continue;const vs=r.heat.computers.map(c=>c[k]).filter(v=>v!==null),v=vs.length?Math.max(...vs):null;
   el.querySelector('.t-needle').style.transform=`rotate(${(-90+180*(v??0)/100).toFixed(1)}deg)`;el.querySelector('.t-val').setAttribute('stroke-dasharray',`${Math.max(0,Math.min(100,v??0)).toFixed(1)} 100`);
   el.classList.toggle('hot',v!==null&&v>=85);el.classList.toggle('warm',v!==null&&v>=70&&v<85);
   el.querySelector('.t-read').textContent=pc(v);const tp=el.querySelector('.t-tip');if(tp.dataset.html!==tip){tp.dataset.html=tip;tp.innerHTML=tip;}el.setAttribute('aria-label',`${label==='CPU'?'CPU':t(label)} ${pc(v)}`);}
 }
 // Order, hiding and size from the layout. Upright (and in the tray) the dials stay on top, where the housing takes their
 // round shape, and the rest stack below in the layout's order. Wide, the dials and the window keep their axes, the
 // warnings stay in the middle of the lower row and the odometer and fuel take the sides in the layout's order. The
 // dials are always shown.
 const PARTS={dials:['.cl-tach','.cl-speed'],alerts:['.cl-alerts'],odo:['.cl-lf'],temps:['.cl-temps'],fuel:['.cl-left'],window:['.cl-window'],periods:['.cl-gear']};
 const DIAL_K=[.76,.88,1],WIN_K=[.7,1,1.35];
 function place(c){
  const o=LAY?.order||[],hide=new Set(LAY?.hidden||[]),sides=o.filter(id=>id==='odo'||id==='fuel');
  for(const [id,sels] of Object.entries(PARTS))for(const sel of sels){const el=c.querySelector(sel);if(!el)continue;
   const at=o.indexOf(id);el.style.setProperty('--o',at<0?'':id==='dials'?String(sel==='.cl-speed'?-1:-2):String(at*2));
   el.style.setProperty('--fo',!LAY?'':id==='alerts'?'2':sides.includes(id)?String(sides.indexOf(id)*2+1):'');
   el.classList.toggle('cl-off',id!=='dials'&&hide.has(id));}
  // The period picker sits on top of the window: hidden, the window keeps it and lets only its tabs and pages go.
  const win=c.querySelector('.cl-window'),bare=hide.has('window')&&!c.classList.contains('tray');
  if(win){win.classList.toggle('cl-off',hide.has('window')&&!bare);win.classList.toggle('cl-bare',bare);}
  const size=(id,K)=>{const n=LAY?.opts?.[id]?.size;return Number.isInteger(n)&&K[n]?String(K[n]):'';};
  c.style.setProperty('--dk',size('dials',DIAL_K));c.style.setProperty('--wk',size('window',WIN_K));
  const n=LAY?.opts?.alerts?.count;c.querySelectorAll('.cl-tell').forEach((t,i)=>t.classList.toggle('cl-off',Number.isInteger(n)&&i>=n));
 }
 function render(rootEl,ctx){
  LAY=ctx.layout||null;const built=JSON.stringify(LAY?.opts?.window?.tabs||null);
  if(mounted!==rootEl||!rootEl.querySelector('.cluster')||rootEl.dataset.built!==built){rootEl.dataset.built=built;mount(rootEl,ctx);}
  // The trip runs from the last reset, kept in this browser; the first visit starts it at midnight, so it opens on
  // today's tokens.
  tripStart=stored().trip;if(!valid(tripStart)){tripStart=midnight();save({trip:tripStart});}
  const c=rootEl.querySelector('.cluster');c.classList.toggle('pair',layout()==='pair');place(c);c.dataset.style=dialStyle();c.dataset.layout=lowerRow();c.dataset.led=ledScheme();c.dataset.sweep=DOWN?'down':'side';c.dataset.face=CENTER?'center':'hub';c.dataset.lamps=lampStyle();c.dataset.text=textPlace();
  const r=readings(ctx.state,{...ctx,pick,only:ACCOUNT_TELLS.includes(only)?null:only,trip:tripStart,hold:tachHold});last={r,ctx,at:now()};
  // A pick that left the readings (a session that ended) lets the burn dial go back to every AI.
  if(pick&&!r.speed.picked)pick=null;
  if(rangeOpen&&r.period!==rangeFrom)toggleRange(rootEl,false);
  // A host's sessions list that went back to its own place (the tray showed its dashboard) returns to the window's page.
  if(ctx.sessionsHost&&!rootEl.contains(ctx.sessionsHost)){const pg=rootEl.querySelector('.cl-page[data-page="sessions"]');if(pg){pg.textContent='';pg.append(ctx.sessionsHost);pg.classList.add('hosted');}}
  const {q,lang,W,color,fmt,eta,tool,plan}=kit(rootEl,ctx);
  // A pressed warning whose count went to nothing lets go.
  if(only&&!(only==='working'?r.working:r.tells[only]?.length))only=null;
  paintDials(rootEl,r,ctx,igniting);paintLamps(rootEl,r,only);
  if(HOSTED.includes(mode)||mode==='flow')ctx.drawPage?.(mode,q(`.cl-page[data-page="${mode}"]`));
  // Page 1, running sessions: a row picks the session for the burn dial; ↗ opens its detail.
  const box=q('.cl-sessions');
  rootEl.querySelectorAll('[data-session-row]').forEach(el=>el.classList.toggle('cl-picked',el.dataset.sessionRow===r.speed.session));
  // A hosted list follows a pressed warning too: only the rows in its state show.
  const hostPage=q('.cl-page.hosted');if(hostPage){if(only&&!ACCOUNT_TELLS.includes(only))hostPage.dataset.only=only;else delete hostPage.dataset.only;}
  if(box&&!r.sessions.length){box.dataset.keys='';box.innerHTML='<div class="cl-empty">작업 중인 세션이 없습니다.</div>';}
  else if(box)keyed(box,r.sessions,x=>x.id,x=>`<div class="cl-session" role="button" tabindex="0" data-cluster-session="${esc(x.id)}"><div class="cl-pace"><svg viewBox="0 0 26 15" aria-hidden="true"></svg><span></span></div>
    <div class="cl-what"><b><span class="cl-state"><i class="dot"></i></span><span class="cl-nm" data-user-content></span></b><span></span></div><div class="cl-figs"><b></b></div><button type="button" class="cl-open" data-cluster-open="${esc(x.id)}" aria-label="세션 상세" title="세션 상세">↗</button></div>`,
   (el,x)=>{const s=x.session,on=r.speed.session===x.id,nm=ctx.name(s);el.classList.toggle('on',on);el.setAttribute('aria-pressed',String(on));el.style.setProperty('--c',color(s.kind));
    el.querySelector('.cl-state').className='cl-state '+x.state;el.querySelector('.cl-nm').textContent=nm;el.title=[nm,s.model,s.effort].filter(Boolean).join(' · ');
    const pace=el.querySelector('.cl-pace svg'),pk=(valid(x.burn)?x.burn:'-')+'|'+r.speed.max+'|'+x.state;
    if(pace.dataset.k!==pk){pace.dataset.k=pk;pace.innerHTML=mini(x.burn,r.speed.max,color(s.kind),x.state);}
    el.querySelector('.cl-pace span').textContent=valid(x.burn)?burnText(x.burn):'—';
    const meta=`<span class="cl-tool" style="color:${color(s.kind)}">${esc(ctx.kindName(s.kind))}</span><em data-user-content>${esc(s.model||'')}</em>${s.effort?`<u>${esc(s.effort)}</u>`:''}`;
    const span=el.querySelector('.cl-what>span');if(span.dataset.html!==meta){span.dataset.html=meta;span.innerHTML=meta;}
    const v=el.querySelector('.cl-figs b'),kind=x.estimate!==null?'pp':'tokens';if(v.dataset.kind!==kind){v.dataset.kind=kind;delete v.dataset.v;}
    count(v,kind==='pp'?x.estimate:x.tokens,kind==='pp'?n=>W.estimate({used_pp:n}):n=>fmt(n)+' tokens');});
  // Page 2, token flow: the period's total; app.js draws the dashboard's own token flow chart and legend into it.
  q('.cl-page[data-page="flow"] .cl-big b').textContent=fmt(r.tach.tokens);
  // Page 3, weekly limits: a card per account (only those a pressed warning is about); pressing one picks it for the burn dial.
  // The last card adds an account (the dashboard's sign-in dialog); an account signed out has its sign-in button.
  const cards=q('.cl-cards'),accounts=ACCOUNT_TELLS.includes(only)?r.accounts.filter(a=>r.tells[only].includes(a.id)):r.accounts;
  const acts=ctx.accountActs,items=[...accounts,...((ctx.addAccount||acts)&&!only?[{add:true,id:'+add'}]:[])];
  if(!items.length){cards.dataset.keys='';cards.innerHTML='<div class="cl-empty">연결된 구독 계정이 없습니다.</div>';}
  else keyed(cards,items,a=>a.id,a=>a.add?`<button type="button" class="cl-card cl-add" ${acts?.add||'data-cluster-add'}><b aria-hidden="true">+</b><span>계정 추가</span><small>공식 로그인으로 구독 한도를 연결합니다</small></button>`
   :`<div class="cl-card" role="button" tabindex="0" data-cluster-account="${esc(a.id)}" style="--c:${color(a.kind)}"><span class="cl-card-h"></span>
    <span class="cl-card-w"><strong></strong> <small>사용</small></span><span class="cl-card-bar"><s></s></span><span class="cl-card-f"></span></div>`,
   (el,a)=>{if(a.add)return;const on=r.speed.account===a.id&&r.speed.picked;el.classList.toggle('on',on);el.classList.toggle('stale',!a.current);el.setAttribute('aria-pressed',String(on));
    const who=a.who&&a.who.toLowerCase()!==String(a.alias||'').toLowerCase()?`<small data-user-content title="${esc(a.who)}">${esc(a.who)}</small>`:'';
    const h=`<span class="cl-tool">${esc(tool(a))}</span>${plan(a)?`<em>${esc(plan(a))}</em>`:''}${a.window?`<em>${esc(a.window)}</em>`:''}${who}`,hd=el.querySelector('.cl-card-h');if(hd.dataset.html!==h){hd.dataset.html=h;hd.innerHTML=h;}
    count(el.querySelector('.cl-card-w strong'),a.pct,n=>W.percent(n));el.querySelector('.cl-card-bar s').style.width=(a.pct===null?0:Math.min(100,a.pct))+'%';
    const first=a.reconnect?(acts?`<button type="button" class="cl-relogin" ${acts.relogin(a)}>다시 로그인</button>`:ctx.relogin?`<button type="button" class="cl-relogin" data-cluster-reconnect="${esc(a.id)}">다시 로그인</button>`:'<b class="warn">재로그인 필요</b>'):`<span><span>${esc(ctx.caption)}</span> <b>${a.added===null?'—':'+'+W.percent(a.added)}</b></span>`;
    const foot=`${first}${valid(a.burn)?`<span><span>평균</span> <b>${burnText(a.burn)}</b></span>`:''}${eta(a)}`,ft=el.querySelector('.cl-card-f');if(ft.dataset.html!==foot){ft.dataset.html=foot;ft.innerHTML=foot;}});
  // Gear: the time window, shared with the dashboard's slider.
  const preset=GEARS.includes(r.period),gearBox=q('.cl-gear>div'),gearKey=r.period+'|'+lang;
  if(dialKind()!=='tabs')gearDial(rootEl,r,lang);
  else if(gearBox.dataset.key!==gearKey){gearBox.dataset.key=gearKey;
   // Back to plain tabs from a turning picker: its look, focus and handlers go; the tabs scroll sideways when they do not fit.
   if(gearBox.dataset.kind){delete gearBox.dataset.kind;gearBox.removeAttribute('tabindex');gearBox.onpointerdown=gearBox.onpointermove=gearBox.onpointerup=gearBox.onpointercancel=gearBox.onwheel=gearBox.onkeydown=null;}
   gearBox.className='gd-tabs';
   gearBox.innerHTML=GEARS.map(k=>`<button type="button" data-cluster-period="${k}" aria-pressed="${k===r.period}"${k===r.period?' class="on"':''}>${esc(root.OneTopRanges?root.OneTopRanges.label(k,lang):k)}</button>`).join('')
    +`<button type="button" data-cluster-period="custom" aria-haspopup="true" aria-expanded="${rangeOpen}" aria-pressed="${!preset}"${preset?'':' class="on"'}>${preset?'기간 지정':esc(r.period==='all'?'전체 기록':root.OneTopRanges?root.OneTopRanges.label(r.period,lang):r.period)}</button>`;}
  paintFuel(rootEl,r,ctx);paintTemps(rootEl,r);paintTrip(rootEl,r,ctx);
  // The seven page names stay in one row when they fit and take two when they do not (a longer language, a narrow
  // window), measured after the page's translation has run.
  const md=q('.cl-modes');if(md)requestAnimationFrame(()=>{const key=md.clientWidth+'|'+md.textContent;if(md.dataset.fit===key)return;md.dataset.fit=key;
   md.classList.remove('wrap');md.classList.toggle('wrap',md.scrollWidth>md.clientWidth+1);});
  if(ignition){ignition=false;ignite(rootEl);}
 }
 // Ignition: when the view opens the ticks light in a sweep and both needles test full scale, then settle
 // on their readings. Skipped when the system asks for less motion.
 function ignite(rootEl){
  // Opened before the first reading arrives: the sweep runs on the first render instead.
  if(!rootEl?.querySelector('.cluster')||!last){ignition=true;return;}
  if(!calm())sweep(rootEl,()=>last.r,v=>{igniting=v;});
 }
 function sweep(rootEl,now,hold){
  const dials=[rootEl.querySelector('.cl-tach'),rootEl.querySelector('.cl-speed')],start=performance.now(),D=1500;
  const target=()=>{const r=now();return [r.tach.rate===null?0:r.tach.rate/r.tach.full,r.speed.value===null?0:r.speed.value/r.speed.max];};
  const out=p=>1-(1-p)**3,io=p=>p<.5?4*p*p*p:1-(-2*p+2)**3/2;
  hold(true);rootEl.querySelector('.cluster').classList.add('igniting');
  const step=t=>{const p=Math.min(1,(t-start)/D),lit=out(Math.min(1,p/.45)),up=io(Math.min(1,p/.4)),down=io(Math.max(0,(p-.45)/.55)),goal=target();
   dials.forEach((d,i)=>needle(d,p<.45?up:1-(1-goal[i])*down,lit));
   if(p<1)root.requestAnimationFrame(step);else{hold(false);rootEl.querySelector('.cluster').classList.remove('igniting');dials.forEach((d,i)=>needle(d,goal[i]));}};
  root.requestAnimationFrame(step);
 }
 // The compact cluster on the menu bar and tray panels (desktop/QuickDashboard.swift draws the same): both dials side
 // by side, the warnings, then the odometer with the trip and the fuel. The panel's own period picker sets the window.
 // Its pick is its own; the trip runs from the dashboard's reset, kept in the same storage. A fuel gauge picks for the
 // burn dial; the warnings only tell, as the panel's own session list sits below.
 const P={el:null,last:null,pick:null,igniting:false,ignition:false,ticker:null};
 function mountCompact(rootEl){
  rootEl.innerHTML=`<div class="cluster compact" aria-label="계기판"><div class="cl-body"></div>
   <div class="cl-main">${dial('cl-tach','토큰 속도')}${dial('cl-speed','한도 소진')}</div>
   <div class="cl-foot">${ODO_MARKUP}${ALERTS_MARKUP}<div class="cl-left">${FUEL_MARKUP}</div></div></div>`;
  const again=()=>{if(P.last)compact(rootEl,P.last.ctx);};
  rootEl.onclick=e=>{
   if(e.target.closest('[data-cluster-clear]')){P.pick=null;again();return;}
   if(e.target.closest('[data-cluster-trip]')){save({trip:Math.floor(now())});again();return;}
   const a=e.target.closest('[data-cluster-account]');if(a){const id=a.dataset.clusterAccount;P.pick=P.pick?.type==='account'&&P.pick.id===id?null:{type:'account',id};again();}
  };
  rootEl.onkeydown=e=>{if(e.key==='Escape'&&P.pick){P.pick=null;again();}};
  P.el=rootEl;mounted=null;clearInterval(ticker);clearInterval(P.ticker);P.ticker=setInterval(()=>tick(rootEl,P.last),250);
 }
 function compact(rootEl,ctx){
  if(P.el!==rootEl||!rootEl.querySelector('.cluster'))mountCompact(rootEl);
  let trip=stored().trip;if(!valid(trip)){trip=midnight();save({trip});}
  const r=readings(ctx.state,{...ctx,pick:P.pick,trip,hold:P.hold||(P.hold={})});P.last={r,ctx,at:now()};
  if(P.pick&&!r.speed.picked)P.pick=null;
  const c=rootEl.querySelector('.cluster');c.dataset.style=dialStyle();c.dataset.layout=lowerRow();c.dataset.led=ledScheme();c.dataset.sweep=DOWN?'down':'side';c.dataset.face=CENTER?'center':'hub';c.dataset.lamps=lampStyle();c.dataset.text=textPlace();
  paintDials(rootEl,r,ctx,P.igniting);paintLamps(rootEl,r,null,false);paintTrip(rootEl,r,ctx);paintFuel(rootEl,r,ctx);
  if(P.ignition){P.ignition=false;igniteCompact(rootEl);}
 }
 function igniteCompact(rootEl){
  if(!rootEl?.querySelector('.cluster')||!P.last){P.ignition=true;return;}
  if(!calm())sweep(rootEl,()=>P.last.r,v=>{P.igniting=v;});
 }
 const api={marks,readings,range,cruise,trip,heat,instant,render,ignite,compact,igniteCompact,layout,dialStyle};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopCluster=api;
})(typeof window!=='undefined'?window:globalThis);
