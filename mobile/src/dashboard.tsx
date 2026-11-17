import React,{startTransition,useEffect,useMemo,useRef,useState} from 'react';
import {Pressable,ScrollView,type ScrollViewInstance,StyleSheet,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from 'expo-router';
import Svg,{Circle,G,Line,Path,Polygon} from 'react-native-svg';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {fresh,projectName,total,valid} from './metrics';
import {accountTags,burnAllowed,fleetFlow,fleetQuotas,hasEstimate,isWeekly,modelShares,periodTokens,pickTiles,reporting,representative,sessionAccount,short} from './fleet';
import {AccountChip,PeriodPicker,SessionDetails,periodLabel} from './ui';
import {staleLabel,windowName} from './i18n';
import {onTheme,quick,toolColor,toolName} from './theme';
import {StateMark} from './state-mark';
import {Canvas,Editor,Gear,Part,shownPreset,useCalm,useEditor,useLayout,useQuiet} from './customize';
import {BrandHeader} from './header';
import * as M from './customize-model';
import {ClusterView} from './cluster';
import type {ObjectId} from './layout';
import type {Device,Flow,Quota,SessionRow,WindowKey} from './types';

// The phone dashboard follows the Mac menu bar quick view: the same palette, sizes and order.
// The period picker governs every number below it.
// Instruments glow in LCD green, apart from every tool colour (Codex teal sat only ΔE 10–12 from the old mint).
// The palette lives in theme.ts (dark and light, the iPhone's values); kept importable from here.
export {quick,toolColor,toolName};
const PERIODS:[WindowKey][]=[['10m'],['30m'],['1h'],['5h'],['12h'],['24h']];
const SECONDS:Record<WindowKey,number>={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
const ORDER=['Claude','Codex','GLM','Antigravity','Aside'];

export function pct(n:number|null|undefined){if(!valid(n))return '—';if(n===0)return '0%';if(n<.05)return '<0.1%';const t=Math.round(n*10)/10;return (Number.isInteger(t)?String(t):t.toFixed(1))+'%';}
type T=(en:string,ko:string)=>string;
const display=(s:SessionRow,t:T)=>projectName(s,t);
const nameOf=(s:SessionRow,t:T)=>(s.terminal||'').trim()||display(s,t)||s.kind;

/** Bins from the nested period totals: for the last hour, the last 10 minutes, 10–30 and 30–60 minutes ago.
 *  Each bin is a speed in tokens per hour by tool, so bins of different lengths compare fairly. */
function reading(rows:SessionRow[],period:WindowKey,periodTotal:number|null,flow?:Flow){
 const seconds=SECONDS[period],sum=rows.map(r=>total(r.windows[period])).filter(valid),totalTokens=periodTotal??(sum.length?sum.reduce((a,b)=>a+b,0):null),average=totalTokens===null?null:totalTokens/seconds*3600;
 // Fine bins from the collector when the relay carries them: oldest first, tokens per bin.
 if(flow?.bins?.length&&flow.step>0){const n=flow.bins.length;return {average,bins:flow.bins.map((values,i)=>{const parts=Object.entries(values||{}).sort((a,b)=>(ORDER.indexOf(a[0])+99)%99-(ORDER.indexOf(b[0])+99)%99).map(([k,v])=>[k,Math.max(0,v)/flow.step*3600] as [string,number]);const ago=(n-1-i)*flow.step;return {start:ago,end:Math.min(seconds,ago+flow.step),parts,total:parts.reduce((a,p)=>a+p[1],0)};}).reverse()};}
 const keys=PERIODS.map(([k])=>k).filter(k=>SECONDS[k]<seconds);
 const edges:[number,WindowKey|null][]=[[0,null],...keys.map(k=>[SECONDS[k],k] as [number,WindowKey]),[seconds,period]];
 const kinds=[...new Set(rows.map(r=>r.kind))].sort((a,b)=>(ORDER.indexOf(a)+99)%99-(ORDER.indexOf(b)+99)%99);
 const within=(r:SessionRow,k:WindowKey|null)=>k?total(r.windows[k])??0:0;
 const bins=edges.slice(1).map(([b,kb],i)=>{const [a,ka]=edges[i];const parts=kinds.map(kind=>[kind,rows.filter(r=>r.kind===kind).reduce((n,r)=>n+Math.max(0,within(r,kb)-within(r,ka)),0)/(b-a)*3600] as [string,number]);return {start:a,end:b,parts,total:parts.reduce((n,p)=>n+p[1],0)};});
 return {bins,average};
}

const P=(cx:number,cy:number,r:number,a:number)=>[cx+r*Math.cos(a*Math.PI/180),cy+r*Math.sin(a*Math.PI/180)];
function sector(cx:number,cy:number,r0:number,r1:number,a0:number,a1:number){const [x0,y0]=P(cx,cy,r1,a0),[x1,y1]=P(cx,cy,r1,a1),[x2,y2]=P(cx,cy,r0,a1),[x3,y3]=P(cx,cy,r0,a0),l=a1-a0>180?1:0;
 return `M${x0} ${y0}A${r1} ${r1} 0 ${l} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${l} 0 ${x3} ${y3}Z`;}
function arc(cx:number,cy:number,r:number,a0:number,a1:number){const [x0,y0]=P(cx,cy,r,a0),[x1,y1]=P(cx,cy,r,a1);return `M${x0} ${y0}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1} ${y1}`;}

/** Seven-segment digits: whole numbers on three places with the unit letter. */
function Digits({value,height}:{value:number|null;height:number}){
 const lit:Record<string,string>={'0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgedc','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',' ':''};
 let digits='---',unit='';
 if(valid(value)){if(value<.5)digits='  0';else{const [d,u]=value>=1e9?[1e9,'B']:value>=1e6?[1e6,'M']:value>=1e3?[1e3,'k']:[1,''];digits=String(Math.min(999,Math.round(value/d))).padStart(3,' ');unit=u;}}
 const h=height,w=h*.55,gap=h*.15,t=h*.115,ht=t/2,g=h*.031,slant=Math.tan(9*Math.PI/180),skew=h*slant,unitSize=h*.46;
 const hz=(y:number,x0:number,x1:number)=>`${x0},${y} ${x0+ht},${y-ht} ${x1-ht},${y-ht} ${x1},${y} ${x1-ht},${y+ht} ${x0+ht},${y+ht}`;
 const vt=(x:number,y0:number,y1:number)=>`${x},${y0} ${x+ht},${y0+ht} ${x+ht},${y1-ht} ${x},${y1} ${x-ht},${y1-ht} ${x-ht},${y0+ht}`;
 const seg:Record<string,string>={a:hz(ht,ht+g,w-ht-g),g:hz(h/2,ht+g,w-ht-g),d:hz(h-ht,ht+g,w-ht-g),f:vt(ht,ht+g,h/2-g),b:vt(w-ht,ht+g,h/2-g),e:vt(ht,h/2+g,h-ht-g),c:vt(w-ht,h/2+g,h-ht-g)};
 const width=3*w+2*gap+(unit?gap+unitSize*.82:0)+skew,on=valid(value)?quick.segmentOn:quick.segmentOn+'66';
 return <View style={{width,height:h}}>
  <Svg width={width} height={h}><G transform={`matrix(1 0 ${-slant} 1 ${skew} 0)`}>
   {[...digits].map((ch,i)=>[...'abcdefg'].map(k=><Polygon key={i+k} points={seg[k]} fill={(lit[ch]||'').includes(k)?on:quick.segmentOff} transform={`translate(${i*(w+gap)} 0)`}/>))}
  </G></Svg>
  {!!unit&&<Text style={{position:'absolute',left:3*w+3*gap,bottom:-h*.06,color:quick.segmentOn,fontSize:unitSize,fontWeight:'700',fontStyle:'italic'}}>{unit}</Text>}
 </View>;
}

/** Scope: one turn is the period. The newest bin sits just right of ▼ (now) and the ring goes back
 *  in time clockwise to an opening left of twelve o'clock. A beam sweeps while tokens flow. */
function Scope({data,size,period}:{data:ReturnType<typeof reading>;size:number;period:WindowKey}){
 const t=useWorkspace().t;
 // With less motion asked for the scope holds still: drawn at once, no beam, nothing to redraw between readings.
 const calm=useCalm(),[head,setHead]=useState(-90),[grow,setGrow]=useState(0),moving=(data.average??0)>0&&!calm,focused=useIsFocused();
 // The first frame resets the grow-in; state changes only happen in animation frames, as transitions, so the sweep never
 // holds back the screen's other updates (a tap's result, a new reading, customizing), only while the tab shows and
 // only while it moves (the grow-in, then the beam while tokens flow).
 useEffect(()=>{if(!focused)return;if(calm){startTransition(()=>{setGrow(1);setHead(-90);});return;}const start=Date.now();let frame=0;const tick=()=>{const t=(Date.now()-start)/1000;startTransition(()=>{setGrow(Math.min(1,1-Math.pow(1-Math.min(1,t/.8),3)));setHead(moving?(Date.now()/1000*80)%360-90:-90);});if(moving||t<.8)frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[period,moving,focused,calm]);
 const c=size/2,outer=size/2-7,inner=outer*.6,opening=12,end=270-opening,span=360-opening,seconds=SECONDS[period];
 const scale=Math.max(data.average??0,...data.bins.map(b=>b.total))*1.06,rr=(v:number)=>inner+(outer-inner)*(scale>0?Math.min(1,v/scale)*grow:0);
 const bars:React.ReactNode[]=[];
 data.bins.forEach((bin,i)=>{if(!(bin.total>0))return;const a0=-90+bin.start/seconds*span+.6,a1=-90+bin.end/seconds*span-.6,age=data.bins.length>1?i/(data.bins.length-1):0,rest=.9-.58*age,newest=i===0;
  const behind=(((head-(a0+a1)/2)%360)+360)%360,lit=moving&&!newest?Math.exp(-behind/75):0;let r0=inner+1,acc=0;
  for(const [kind,v] of bin.parts){if(!(v>0))continue;acc+=v;const r1=rr(acc);if(r1<=r0+.3)continue;bars.push(<Path key={i+kind} d={sector(c,c,r0,r1,a0,a1)} fill={toolColor(kind)} opacity={newest?1:rest+(1-rest)*.75*lit}/>);r0=r1;}
  if(newest&&r0>inner+1)bars.push(<Path key={'edge'+i} d={sector(c,c,inner+1,r0,a0,a1)} fill="none" stroke={quick.segmentLead} strokeWidth={1}/>);});
 return <View style={{width:size,height:size}}>
  <Svg width={size} height={size}>
   {Array.from({length:12},(_,k)=>{const [x0,y0]=P(c,c,inner,-90+30*k),[x1,y1]=P(c,c,outer,-90+30*k);return <Line key={'s'+k} x1={x0} y1={y0} x2={x1} y2={y1} stroke={quick.grid} strokeOpacity={.7} strokeWidth={.7}/>;})}
   {[.25,.5,.75,1].map(f=><Path key={'r'+f} d={arc(c,c,inner+(outer-inner)*f,-90,end)} fill="none" stroke={quick.grid} strokeWidth={.8} strokeDasharray={f===1?undefined:'1.5 3'}/>)}
   <Line x1={c} y1={c-inner} x2={c} y2={c-outer} stroke={quick.red} strokeOpacity={.6} strokeWidth={1}/>
   {moving&&Array.from({length:12},(_,j)=><Path key={'w'+j} d={sector(c,c,inner,outer,head-(j+1)*4,head-j*4)} fill={quick.segmentOn} opacity={.26*Math.pow(1-j/12,1.6)}/>)}
   {bars}
   {moving&&(()=>{const [x0,y0]=P(c,c,inner,head),[x1,y1]=P(c,c,outer+2,head);return <Line x1={x0} y1={y0} x2={x1} y2={y1} stroke={quick.segmentLead} strokeOpacity={.9} strokeWidth={1.4} strokeLinecap="round"/>;})()}
   {valid(data.average)&&data.average>0&&<Path d={arc(c,c,rr(data.average),-90,end)} fill="none" stroke={quick.segmentLead} strokeWidth={1.1} strokeDasharray="3 2.5"/>}
   <Circle cx={c} cy={c} r={inner-3} fill={quick.card} stroke={quick.grid} strokeWidth={.8}/>
   <Polygon points={`${c-3.5},${c-outer-6.5} ${c+3.5},${c-outer-6.5} ${c},${c-outer-1}`} fill={quick.red}/>
  </Svg>
  <View style={[StyleSheet.absoluteFill,{alignItems:'center',justifyContent:'center'}]} pointerEvents="none">
   <Text style={{color:quick.dim,fontSize:10.5}}>{t('Average','평균')}</Text>
   <Digits value={data.average} height={Math.round(29*size/182)}/>
   <Text style={{color:quick.muted,fontSize:10.5,marginTop:2}}>{data.average===null?t('Checking','확인 중'):t('tokens/h','tokens/시간')}</Text>
  </View>
 </View>;
}

/** A small speedometer that leads each session row: current tokens per hour on a shared scale. The state sits by the name as a shape. */
function MiniGauge({value,scale,color,hub}:{value:number|null;scale:number;color:string;hub:string}){
 const w=20,h=12,c={x:w/2,y:h-1.5},r=Math.min(w/2-1.5,h-3),pace=value??0,angle=180+180*Math.min(1,Math.max(0,pace/Math.max(scale,.0001)));
 const a=(to:number)=>{const [x0,y0]=P(c.x,c.y,r,180),[x1,y1]=P(c.x,c.y,r,to);return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`;};
 const [tx,ty]=P(c.x,c.y,r-1.5,angle);
 return <Svg width={w} height={h}><Path d={a(359.9)} stroke={quick.line} strokeWidth={2.6} strokeLinecap="round" fill="none"/>
  {pace>0&&<Path d={a(angle)} stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none"/>}
  {value!==null&&<Line x1={c.x} y1={c.y} x2={tx} y2={ty} stroke={pace>0?quick.ink:quick.dim} strokeWidth={1.2} strokeLinecap="round"/>}
  <Circle cx={c.x} cy={c.y} r={2} fill={hub}/></Svg>;
}

/** A root session with its subagents. Usage adds up; weekly estimates add up only within the root's account. */
type Group={root:SessionRow;members:SessionRow[]};
function groups(rows:SessionRow[]):Group[]{const by=new Map<string,SessionRow[]>();for(const r of rows){const k=r.device.id+':'+(r.root_session_id||r.id);by.set(k,[...(by.get(k)||[]),r]);}
 return [...by.entries()].map(([k,m])=>({root:m.find(r=>r.device.id+':'+r.id===k)||m[0],members:m}));}
const gTokens=(g:Group,p:WindowKey)=>{const v=g.members.map(r=>total(r.windows[p])).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};
const gWorking=(g:Group)=>g.members.some(r=>r.status==='working');
const gRate=(g:Group)=>{const v=g.members.map(r=>r.rate).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};
function sameAccount(g:Group,p:WindowKey){const acct=g.root.weekly_estimate?.[p]?.account_id||g.root.weekly_account;if(!acct)return [];return g.members.map(r=>[r,r.weekly_estimate?.[p]] as const).filter(([,e])=>e&&e.account_id===acct);}
const gEstimate=(g:Group,p:WindowKey)=>{const v=sameAccount(g,p).map(([,e])=>e?.used_pp).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};
const gPace=(g:Group,p:WindowKey)=>{const v=sameAccount(g,p).map(([r,e])=>valid(r.rate)&&valid(e?.calibration?.pp_per_token)?r.rate*e!.calibration!.pp_per_token!*3600:null).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};

/** The weekly % across the period, ending at the current report. */
function Spark({points,start,end,color,faded}:{points:number[][];start:number;end:number;color:string;faded:boolean}){
 const [w,setW]=useState(0),h=14;
 const pts=points.filter(p=>p.length>=2&&valid(p[0])&&p[0]<=end&&valid(p[1])&&p[1]<=100).sort((a,b)=>a[0]-b[0]);const first=pts.findIndex(p=>p[0]>=start),use=first<0?[]:pts.slice(Math.max(0,first-1));
 let lo=Math.min(...use.map(p=>p[1])),hi=Math.max(...use.map(p=>p[1]));if(hi-lo<2){const m=(hi+lo)/2;lo=m-1;hi=m+1;}const pad=(hi-lo)*.15;lo-=pad;hi+=pad;if(lo<0){hi-=lo;lo=0;}
 const pw=Math.max(1,w-6),xy=(p:number[])=>[(Math.max(start,p[0])-start)/(end-start)*pw,5+(1-(p[1]-lo)/(hi-lo))*(h-10)];
 const line=use.map((p,i)=>{const [x,y]=xy(p);return (i?'L':'M')+x+' '+y;}).join(''),tip=use.length?xy(use[use.length-1]):null;
 return <View style={{flex:1,height:h,opacity:faded?.5:1}} onLayout={e=>setW(e.nativeEvent.layout.width)}>{w>0&&use.length>0&&<Svg width={w} height={h}><Path d={line} stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round"/>{tip&&<><Circle cx={tip[0]} cy={tip[1]} r={4.5} fill={color} opacity={.25}/><Circle cx={tip[0]} cy={tip[1]} r={2.4} fill={color}/></>}</Svg>}</View>;
}

const nice=(v:number)=>{if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v));return ([1,2,5,10].map(n=>n*p).find(n=>n>=v))||10*p;};

/** The dashboard tab: the dashboard preset, or with one tab either preset, customized in place. */
export function Dashboard(){
 const scroll=useRef<ScrollViewInstance>(null),L=useLayout(),preset=shownPreset(L.state.layout,'index');
 return <Editor screen="index" preset={preset} scrollRef={scroll}><DashboardView scrollRef={scroll} preset={preset}/></Editor>;
}
function DashboardView({scrollRef,preset}:{scrollRef:React.RefObject<ScrollViewInstance|null>;preset:'cluster'|'dashboard'}){
 const w=useWorkspace(),t=w.t,period:WindowKey=w.period,rows:SessionRow[]=w.rows;
 const L=useLayout(),g=L.state.layout.presets.dashboard,edit=useEditor(),quiet=useQuiet(),{width,height}=useWindowDimensions(),landscape=width>height&&height<600;
 const periodName=(k:WindowKey)=>periodLabel(k,t),tags=accountTags(w.devices||[]);
 const [detail,setDetail]=useState<SessionRow|null>(null);
 const visible:Device[]=w.visible||[],basis=reporting(visible),live=w.demo||w.connection?.state==='live';
 // Every number in the instrument covers the computers in view, not just the first one.
 const scoped=rows.filter(r=>basis.includes(r.device));
 const data=reading(scoped,period,periodTokens(basis,period),fleetFlow(basis,period));
 const ordered=useMemo(()=>groups(rows).sort((a,b)=>{const wa=gWorking(a),wb=gWorking(b);if(wa!==wb)return wa?-1:1;const ta=gTokens(a,period)??-1,tb=gTokens(b,period)??-1;return ta!==tb?tb-ta:a.root.key<b.root.key?-1:1;}),[rows,period]);
 // Weekly % needs the collector's estimates; a collector that does not send them shows tokens.
 const tokensMode=w.tokensChosen||!rows.some(hasEstimate);
 // The period's tokens by tool and model; past four, the rest folds into one. Only an older collector, which
 // splits no period, leaves the ended sessions' tokens out of the rows.
 const slices=(()=>{const {rows:list,total:sum,split}=modelShares(basis,period,scoped),shown=list.length<=4?list:list.slice(0,3),seen:Record<string,number>={};
  const out=shown.map(x=>{const kind=x.kind||'',i=seen[kind]||0;seen[kind]=i+1;
   // A model the computer could not name; without a tool, tokens from a computer that sends no split.
   return {id:kind+'|'+(x.model||''),name:x.model??(split?t('No model info','모델 정보 없음'):toolName(kind)),detail:x.kind?toolName(x.kind):t('Computers without a split','내역 없는 컴퓨터'),
    color:x.kind?toolColor(x.kind):quick.dim,opacity:x.kind?[1,.68,.46][Math.min(i,2)]:1,value:x.tokens};});
  const rest=sum-shown.reduce((n,x)=>n+x.tokens,0),others=list.length-shown.length,ended=!split&&sum-list.reduce((n,x)=>n+x.tokens,0)>sum*.005;
  if(sum>0&&rest>sum*.005)out.push({id:'rest',name:others?t('Other models','기타 모델'):t('Ended sessions','종료된 세션'),
   detail:others?t(`${others} more`,`${others}개`)+(ended?' · '+t('incl. ended sessions','종료 세션 포함'):''):t('Not in the list','목록에 없는 세션'),color:quick.dim,opacity:1,value:rest});
  return {out,sum};})();
 // The layout (customizing): how many account tiles and session rows show ('all' for null).
 const want=g.opts.weekly?.count,all=fleetQuotas(basis),quotas:Quota[]=pickTiles(all,want===undefined?4:want??all.length),now:number=w.clock/1000;
 const hosts=basis.map(d=>{const h=d.snapshot.host;return {id:d.id,name:d.name,fresh:fresh(d),received:d.received,cpu:h?.cpu??null,memory:h&&valid(h.used_memory)&&valid(h.total_memory)&&h.total_memory>0?h.used_memory/h.total_memory*100:null};});
 const paces=ordered.map(g=>tokensMode?(()=>{const r=gRate(g);return r===null?null:r*3600;})():gPace(g,period)),scale=nice(Math.max(1,...paces.filter(valid)));
 const end=Math.max(0,...basis.map(d=>d.snapshot.updated||0))||now,start=end-SECONDS[period];
 const listed=ordered.slice(0,g.opts.sessions?.count??Infinity);
 // With one tab holding both presets, the header's quick switch (the gauge) picks one, kept in the layout; on its
 // side the cluster takes the whole screen as its own tab does.
 if(preset==='cluster'&&landscape)return <ClusterView/>;
 const gearAt=M.gearSection(g),gear=(id:string)=>gearAt===id&&<><View style={{flex:1}}/><Gear style={st.gear}/></>;
 const section=(id:ObjectId)=>{switch(id){
  case 'periods':return <Part key={id} id={id} style={{marginHorizontal:14,marginBottom:10}}><PeriodPicker/></Part>;
  case 'tokens':return <Part key={id} id={id} style={{paddingHorizontal:16}}>
    <View style={st.titleRow}><Text style={st.title}>{t('Token usage','토큰 사용')}</Text><Text style={st.sub}>{t('Last ','최근 ')+periodName(period)}</Text>{gear(id)}</View>
    <View style={{flexDirection:'row',alignItems:'center',gap:16}}>
     <Scope data={data} size={Math.round(182*M.TOKENS_K[M.sizeOf(g,'tokens')])} period={period}/>
     <View style={{flex:1,gap:10}}>
      {slices.out.length?<><Text style={{color:quick.muted,fontSize:10.5}}>{t('By model','모델별')}</Text>
       <View style={{flexDirection:'row',gap:2,height:8}}>{slices.out.map(x=><View key={x.id} style={{flex:x.value,backgroundColor:x.color,opacity:x.opacity,transform:[{skewX:'-20deg'}]}}/>)}</View>
       <View style={{gap:8}}>{slices.out.map(x=><View key={x.id} style={{flexDirection:'row',alignItems:'flex-start',gap:7}}><View style={[st.dot,{backgroundColor:x.color,opacity:x.opacity,marginTop:5}]}/><View style={{flex:1}}><Text numberOfLines={1} style={{color:quick.ink,fontSize:11.5,fontWeight:'600'}}>{x.name}</Text><Text numberOfLines={1} style={{color:quick.muted,fontSize:10.5}}>{x.detail}</Text></View><Text style={{color:quick.ink,fontSize:11.5,fontWeight:'600'}}>{slices.sum>0?(x.value/slices.sum*100<1?'<1%':Math.round(x.value/slices.sum*100)+'%'):'—'}</Text></View>)}</View></>
       :<Text style={{color:quick.muted,fontSize:11.5}}>{data.average===null?t('Checking usage','사용량을 확인하고 있습니다'):t('No usage reported in this period','이 기간에 보고된 사용이 없습니다')}</Text>}
     </View>
    </View></Part>;
  case 'weekly':return <Part key={id} id={id} style={{paddingHorizontal:14,paddingTop:14,gap:7}} shown={quotas.length}>
    <View style={[st.titleRow,{paddingHorizontal:2,marginBottom:0}]}><Text style={st.title}>{quotas.every(q=>isWeekly(representative(q)))?t('Weekly limits','주간 한도'):t('Account limits','계정 한도')}</Text><Text style={st.sub}>{t('100% per account','계정별 100%')}</Text>{gear(id)}</View>
    {quotas.length?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{quotas.map(q=>{
      // A 5-hour or monthly window, or an unverified pool, shows its value without a weekly burn rate.
      const wk=representative(q),weekly=isWeekly(wk),color=toolColor(q.kind),mins=wk?.reset?Math.ceil((wk.reset-now)/60):0;
      const name=q.account_label.includes(' · ')?q.account_label.split(' · ').pop():q.account_label.split('@')[0];
      // An Agy pool's long name sits under the tool name instead of on a chip. Where no weekly burn rate
      // is measured, the window's own name takes the rate's place; an old value keeps it on the left.
      const handle=(q.stale&&!weekly&&wk?windowName(wk,t)+' · ':'')+(q.pool||name),label=wk?windowName(wk,t):t('No value','값 없음');
      return <View key={q.id} style={[st.tile,{backgroundColor:color+'12'}]}><View style={{flexDirection:'row',alignItems:'center',gap:5}}><View style={[st.dot,{backgroundColor:color}]}/><Text style={{color:quick.ink,fontSize:12.5,fontWeight:'600'}}>{toolName(q.kind)}</Text>{!q.pool&&<AccountChip text={tags[q.id]}/>}<View style={{flex:1}}/><Text style={{color:q.stale?quick.muted:quick.ink,fontSize:17,fontWeight:'600'}}>{pct(wk?.pct)}</Text></View>
       <View style={{flexDirection:'row',alignItems:'center',gap:6}}><Text numberOfLines={1} style={{width:62,color:quick.muted,fontSize:10.5}}>{handle}</Text>
        <Spark points={q.usage_points||[]} start={start} end={end} color={color} faded={q.stale}/>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={{width:q.stale?78:62,textAlign:'right',color:q.stale?quick.amber:color,fontSize:10.5,fontWeight:'500'}}>{q.stale?staleLabel(q,t):!burnAllowed(q)?label:(()=>{const p=q.weekly?.[period];return valid(p?.used_pp)&&valid(p?.observed_seconds)&&p.observed_seconds>=120?pct(p.used_pp/p.observed_seconds*3600)+t('/h','/시간'):mins>0?(mins>=1440?t(`in ${Math.floor(mins/1440)}d`,`${Math.floor(mins/1440)}일 후`):t(`in ${Math.floor(mins/60)}h`,`${Math.floor(mins/60)}시간 후`)):t('Collecting','수집 중');})()}</Text></View></View>;})}</View>
     :<Text style={{color:quick.muted,fontSize:11.5}}>{t('Connect subscription accounts in 1top on your computer.','컴퓨터의 1top에서 구독 계정을 연결하면 표시됩니다.')}</Text>}
   </Part>;
  case 'resources':return <Part key={id} id={id} style={{paddingHorizontal:16,paddingTop:12,paddingBottom:10,gap:8}}>
    {hosts.map((h,i)=><View key={h.id} style={{gap:4}}>{hosts.length>1&&<View style={{flexDirection:'row',alignItems:'center',gap:5}}><View style={{width:5,height:5,borderRadius:3,backgroundColor:h.fresh?quick.mint:quick.amber}}/><Text numberOfLines={1} style={{color:quick.ink,fontSize:11.5,fontWeight:'600',flexShrink:1}}>{h.name}</Text>{!h.fresh&&<Text style={{color:quick.amber,fontSize:10.5}}>{t('Last report ','마지막 보고 ')+w.when(h.received)}</Text>}</View>}
     <View style={{flexDirection:'row',alignItems:'center',gap:18}}>{([['CPU',h.cpu],[t('Memory','메모리'),h.memory]] as [string,number|null][]).map(([name,v])=><View key={name} style={{flex:1,flexDirection:'row',alignItems:'center',gap:7}}><Text style={{color:quick.muted,fontSize:11.5}}>{name}</Text><View style={st.track}><View style={{width:`${Math.min(100,Math.max(0,v||0))}%`,height:3,borderRadius:2,backgroundColor:(v||0)>90?quick.amber:quick.accent}}/></View><Text style={{color:quick.ink,fontSize:11.5,width:44,textAlign:'right'}}>{pct(v)}</Text></View>)}{i===0&&gearAt===id&&<Gear style={[st.gear,{marginLeft:-8}]}/>}</View></View>)}
   </Part>;
  case 'sessions':return <Part key={id} id={id} shown={listed.length}>
    <View style={st.listHead}><Text style={st.title}>{t('Sessions','세션')}</Text><Text style={st.count}>{ordered.length}</Text>{live?<View style={{marginLeft:4}}><StateMark status="working"/></View>:<View style={[st.dot,{backgroundColor:quick.amber,marginLeft:4}]}/>}<Text style={{color:live?quick.ink:quick.amber,fontSize:11.5,fontWeight:'500'}}>{live?t(`${ordered.filter(gWorking).length} working`,`작업 중 ${ordered.filter(gWorking).length}`):t('Last report','마지막 기록')}</Text><View style={{flex:1}}/><Text style={{color:quick.muted,fontSize:10.5,width:78,textAlign:'right'}}>{tokensMode?t('Tokens','토큰'):t('Weekly limit','주간 한도 사용량')}</Text>{gearAt===id&&<Gear style={st.gear}/>}</View>
    {listed.map((g0,i)=>{const s=g0.root,pace=live?paces[i]:null,hub=valid(pace)&&pace>0?quick.ink:quick.dim,state=gWorking(g0)?'working':s.status,tokens=gTokens(g0,period),est=gEstimate(g0,period);
     const value=tokensMode?short(tokens):est!==null?'≈'+pct(est):tokens===0?'0%':'—',children=g0.members.length-1;
     return <Pressable key={s.key} accessibilityRole="button" accessibilityHint={t('Opens messages and controls','메시지와 작업 제어를 엽니다')} onPress={quiet(()=>setDetail(s))} style={({pressed})=>[st.row,pressed&&{backgroundColor:quick.raised},!fresh(s.device)&&{opacity:.55}]}><View style={{width:54,alignItems:'center',gap:2}}><MiniGauge value={pace} scale={scale} color={toolColor(s.kind)} hub={hub}/><Text numberOfLines={1} style={{fontSize:9.5,color:pace===null?quick.dim:pace===0?quick.muted:quick.ink}}>{pace===null?'—':(tokensMode?short(pace):pct(pace))+t('/h','/시간')}</Text></View>
      <View style={{flex:1,minWidth:0}}><View style={{flexDirection:'row',alignItems:'center',gap:6}}><StateMark status={state}/><Text numberOfLines={1} style={{flexShrink:1,color:quick.ink,fontSize:13,fontWeight:'600'}}>{nameOf(s,t)}</Text>{children>0&&<Text style={st.badge}>{t(`+${children}`,`하위 ${children}`)}</Text>}</View><View style={{flexDirection:'row',alignItems:'center',gap:4}}><Text style={{fontSize:11.5,color:toolColor(s.kind)}}>{toolName(s.kind)}</Text><AccountChip text={tags[sessionAccount(s,period)||'']}/><Text numberOfLines={1} style={{fontSize:11.5,color:quick.muted,flexShrink:1}}>{display(s,t)?'· '+display(s,t):''}{basis.length>1?' · '+s.device.name:''}</Text></View></View>
      <Text style={{width:70,textAlign:'right',color:value==='—'?quick.dim:quick.ink,fontSize:13,fontWeight:'600'}}>{value}</Text><Text style={{color:quick.dim,fontSize:13}}>›</Text></Pressable>;})}
    {!ordered.length&&<Text style={{color:quick.muted,fontSize:11.5,paddingHorizontal:16,paddingVertical:14}}>{t('Connect a computer to your account. Its sessions appear here.','컴퓨터를 계정에 연결하면 세션이 표시됩니다.')}</Text>}
   </Part>;
  default:return null;
 }};
 return <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:quick.background}}>
  <ScrollView ref={scrollRef} scrollEnabled={edit?.scrollable??true} contentContainerStyle={{paddingBottom:120+(edit?.room??0)}}>
   <BrandHeader preset={preset}/>
   {preset==='cluster'?<View style={{paddingHorizontal:16}}><ClusterView embedded/></View>:<Canvas>{M.dashboardOrder(g).map(section)}</Canvas>}
  </ScrollView>
  <SessionDetails key={detail?.key||'none'} row={detail} close={()=>setDetail(null)}/>
 </SafeAreaView>;
}

const make=()=>StyleSheet.create({
 header:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:8,paddingBottom:10},
 pill:{flexDirection:'row',alignItems:'center',gap:6,height:30,paddingHorizontal:11,borderRadius:15,backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine,maxWidth:170},
 circle:{width:30,height:30,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine},
 dot:{width:6,height:6,borderRadius:3},
 titleRow:{flexDirection:'row',alignItems:'baseline',gap:6,marginBottom:8},
 // The gear keeps its row's height (customizing-spec_v1.2.2): it reaches 6 above and below.
 gear:{alignSelf:'center',marginVertical:-6,marginRight:-6},
 title:{color:quick.ink,fontSize:12.5,fontWeight:'600'},sub:{color:quick.muted,fontSize:11.5},
 tile:{width:'48.8%',gap:3,paddingHorizontal:10,paddingVertical:8,borderRadius:8},
 track:{flex:1,height:3,borderRadius:2,backgroundColor:quick.line,overflow:'hidden'},
 listHead:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingVertical:8,borderTopWidth:1,borderTopColor:quick.line},
 count:{color:quick.muted,fontSize:11.5,fontWeight:'600',paddingHorizontal:6,borderRadius:5,backgroundColor:quick.raised,overflow:'hidden'},
 badge:{color:quick.muted,fontSize:10.5,paddingHorizontal:5,borderRadius:8,borderWidth:1,borderColor:quick.line},
 row:{flexDirection:'row',alignItems:'center',gap:9,height:50,paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:quick.line+'b3'},
 notice:{marginHorizontal:14,marginBottom:10,padding:10,borderRadius:8,backgroundColor:quick.notice},
 offline:{flexDirection:'row',alignItems:'center',gap:10,marginHorizontal:14,marginBottom:10,padding:10,borderRadius:8,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 retry:{paddingHorizontal:10,paddingVertical:6,borderRadius:6,backgroundColor:quick.raised},
});
let st=make();onTheme(()=>{st=make();});
