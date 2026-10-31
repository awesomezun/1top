import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,Easing,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Svg,{Circle,Defs,G,Line,Path,RadialGradient,Stop,Text as SvgText} from 'react-native-svg';
import {Text,fonts} from './typography';
import {useWorkspace} from './workspace';
import {AccountChip,Screen,SessionDetails,periodLabel} from './ui';
import {accountTags,fleetFlow,reporting} from './fleet';
import {PERIOD_NAMES,locale} from './i18n';
import {onTheme,quick,toolColor,toolName} from './theme';
import {StateMark} from './state-mark';
import {heldDemo,now as shownNow} from './clock';
import {clusterState,fmt,marks,pctNumber,reading,readings,scaleNumber,valid,type ClusterSession,type Pick,type Readings} from './cluster-model';
import type {Device,Flow,SessionRow,WindowKey} from './types';

// The cluster, as on the desktop dashboard and the web (agent/onetop/dist/cluster.js) at a phone's width:
// the speedometer (weekly-limit burn in %/h) first, the tachometer (tokens per minute) below it at the same size,
// the window with its three pages, then the gear (time window), the load and fuel gauges, the odometer
// and the trip. The numbers are the desktop's (cluster-model.ts). Needles spring to each reading; between
// readings the odometer and the trip run on at the last minute's rate, unless the phone asks for less motion.
type T=(en:string,ko:string)=>string;
type Mode='sessions'|'flow'|'weekly';
const MODES:[Mode,string,string][]=[['sessions','Running sessions','실행 중인 세션'],['flow','Token flow','토큰 흐름'],['weekly','Weekly limits','주간 한도']];
const SAVED={mode:'onetop.cluster.mode',trip:'onetop.cluster.trip'};
const HOUR=3600;
type LampKind='waiting'|'reconnect'|'empty'|'context'|'stalled'|'live';
const LAMPS:[LampKind,string,string][]=[['waiting','Needs input','확인 필요'],['reconnect','Reconnect needed','재연결 필요'],['empty','Limit runs out early','한도 바닥 예상'],
 ['context','Context nearly full','컨텍스트 거의 참'],['stalled','Possibly stalled','멈춤 의심'],['live','Collection delayed','수집 지연']];

function useCalm(){
 const [calm,setCalm]=useState(false);
 useEffect(()=>{AccessibilityInfo.isReduceMotionEnabled().then(setCalm).catch(()=>{});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setCalm);return()=>sub.remove();},[]);
 return calm;
}
const clamp=(f:number)=>Math.max(0,Math.min(1,Number.isFinite(f)?f:0));
const C=170,ang=(f:number)=>(135+270*f)*Math.PI/180,pt=(f:number,r:number)=>[C+r*Math.cos(ang(f)),C+r*Math.sin(ang(f))];
function arc(a:number,b:number,r:number){if(!(b>a))return '';const [x0,y0]=pt(a,r),[x1,y1]=pt(b,r);return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${(b-a)*270>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;}

/** A needle that springs to its fraction of full scale; on the first reading it sweeps to full scale and back. */
function useNeedle(target:number|null,calm:boolean){
 const [turn]=useState(()=>new Animated.Value(0)),started=useRef(false);
 useEffect(()=>{if(target===null)return;const to=clamp(target);
  if(calm){turn.setValue(to);started.current=true;return;}
  if(!started.current){started.current=true;Animated.sequence([Animated.timing(turn,{toValue:1,duration:620,easing:Easing.inOut(Easing.cubic),useNativeDriver:true}),
   Animated.spring(turn,{toValue:to,friction:7,tension:34,useNativeDriver:true})]).start();return;}
  Animated.spring(turn,{toValue:to,friction:6.5,tension:38,useNativeDriver:true}).start();},[target,calm,turn]);
 return turn.interpolate({inputRange:[0,1],outputRange:['135deg','405deg']});
}

/** While sessions work, a needle shimmers a few degrees about its reading, like a running engine's; the figure stays exact. */
const SHIMMER:[number,number][]=[[2.6,.17],[-1.1,.14],[3.4,.17],[.4,.15],[-2,.16],[1.2,.12],[0,.09]];
function useShimmer(on:boolean,period:number,delay:number){
 const [a]=useState(()=>new Animated.Value(0));
 useEffect(()=>{if(!on){a.stopAnimation();a.setValue(0);return;}
  const loop=Animated.loop(Animated.sequence(SHIMMER.map(([to,share])=>Animated.timing(a,{toValue:to,duration:period*share,easing:Easing.inOut(Easing.sin),useNativeDriver:true}))));
  const id=setTimeout(()=>loop.start(),delay);return()=>{clearTimeout(id);loop.stop();};},[on,period,delay,a]);
 return a.interpolate({inputRange:[-10,10],outputRange:['-10deg','10deg']});
}

/** One dial: scale, lit arc, cruise bands (speedometer), the needle and the readout. */
function Dial({size,value,max,color,name,read,unit,aux,sub,band,calm,label,shake}:{size:number;value:number|null;max:number;color:string;name:string;read:string;unit:string;
 aux:React.ReactNode;sub?:React.ReactNode;band?:number|null;calm:boolean;label:string;shake:{on:boolean;period:number;delay:number}}){
 const g=marks(max),f=value===null?0:clamp(value/max),n=Math.round(g.max/g.minor);
 const rotate=useNeedle(value===null?0:value/max,calm),wobble=useShimmer(shake.on&&!calm,shake.period,shake.delay);
 const ticks:React.ReactNode[]=[],nums:React.ReactNode[]=[];
 for(let i=0;i<=n;i++){const v=i*g.minor,tf=v/g.max,major=Math.abs(v/g.major-Math.round(v/g.major))<1e-6,[x1,y1]=pt(tf,major?122:131),[x2,y2]=pt(tf,141);
  ticks.push(<Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={tf<=f+1e-4&&value!==null&&value>0?color:quick.dim} strokeOpacity={tf<=f+1e-4&&value!==null&&value>0?1:.55} strokeWidth={major?3.2:1.6} strokeLinecap="round"/>);
  if(major){const [x,y]=pt(tf,103);nums.push(<SvgText key={i} x={x} y={y+6} fill={quick.muted} fontSize={17} fontFamily={fonts.semibold} textAnchor="middle">{scaleNumber(v)}</SvgText>);}}
 const c=band??null,bf=(v:number)=>clamp(v/max),bands=c===null?[]:[[0,c,quick.mint],[c,c*1.5,quick.amber],[c*1.5,max,quick.red]] as [number,number,string][];
 return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{width:size,height:size,alignSelf:'center'}}>
  <Svg width={size} height={size} viewBox="0 0 340 340">
   <Defs><RadialGradient id="face" cx="50%" cy="42%" r="60%"><Stop offset="0" stopColor={quick.raised}/><Stop offset="1" stopColor={quick.background}/></RadialGradient></Defs>
   <Circle cx={C} cy={C} r={168} fill="url(#face)"/>
   <Circle cx={C} cy={C} r={160} fill="none" stroke={quick.line} strokeWidth={2}/>
   <Path d={arc(0,1,147)} fill="none" stroke={quick.ink} strokeOpacity={.07} strokeWidth={5}/>
   {bands.map(([a,b,col],i)=>bf(b)>bf(a)?<Path key={i} d={arc(bf(a),bf(b),155)} fill="none" stroke={col} strokeOpacity={.8} strokeWidth={4}/>:null)}
   {f>0&&<Path d={arc(0,f,147)} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"/>}
   <G>{ticks}</G><G>{nums}</G>
  </Svg>
  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{transform:[{rotate}]}]}><Animated.View style={[StyleSheet.absoluteFill,{transform:[{rotate:wobble}]}]}><Svg width={size} height={size} viewBox="0 0 340 340">
   <Path d="M158 166.4 L301 169.3 L301 170.7 L158 173.6 Z" fill={color}/></Svg></Animated.View></Animated.View>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 340 340"><Circle cx={C} cy={C} r={13} fill={quick.raised} stroke={quick.line} strokeWidth={1.5}/><Circle cx={C} cy={C} r={5} fill={quick.background}/></Svg>
  <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:size*.315,alignItems:'center'}}><Text style={{fontSize:Math.max(10,size*.036),fontWeight:'600',letterSpacing:.6,color:quick.muted}}>{name}</Text></View>
  <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:size*.52,alignItems:'center',gap:1}}>
   <Text style={{fontSize:size*.13,lineHeight:size*.15,fontWeight:'700',letterSpacing:-1,color:quick.ink,fontVariant:['tabular-nums']}}>{read}</Text>
   <Text style={{fontSize:Math.max(9.5,size*.033),color:quick.muted}}>{unit}</Text>
   {aux}
  </View>
  {sub&&<View style={{position:'absolute',left:0,right:0,top:size*.83,alignItems:'center'}}>{sub}</View>}
 </View>;
}

/** The warning lights' shapes, as on the desktop cluster. */
function Lamp({kind,color}:{kind:LampKind;color:string}){
 const p={stroke:color,strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,fill:'none'};
 const body=(()=>{switch(kind){
  case 'waiting':return <><Path d="M12 3.6 21.6 20H2.4Z" {...p}/><Path d="M12 9.6v5" {...p}/><Circle cx={12} cy={17.2} r={.9} fill={color}/></>;
  case 'reconnect':return <><Path d="M10 14.2 8.1 16.1a3.3 3.3 0 0 1-4.7-4.7L5.3 9.5" {...p}/><Path d="M14 9.8l1.9-1.9a3.3 3.3 0 0 1 4.7 4.7l-1.9 1.9" {...p}/><Path d="M8.2 3.6v2.6M3.6 8.2h2.6M15.8 20.4v-2.6M20.4 15.8h-2.6" {...p}/></>;
  case 'empty':return <><Path d="M5 20.4V5.6A1.6 1.6 0 0 1 6.6 4h6.2a1.6 1.6 0 0 1 1.6 1.6v14.8M3.4 20.4h12.6M7.4 8.2h5" {...p}/><Path d="M14.4 10.6h1.4a1.4 1.4 0 0 1 1.4 1.4v4.2a1.5 1.5 0 0 0 3 0V8.6L18 6.4" {...p}/></>;
  case 'context':return <><Path d="M8 4H6.2A2.2 2.2 0 0 0 4 6.2v11.6A2.2 2.2 0 0 0 6.2 20H8M16 4h1.8A2.2 2.2 0 0 1 20 6.2v11.6a2.2 2.2 0 0 1-2.2 2.2H16" {...p}/><Path d="M8.4 8.6h7.2M8.4 12h7.2M8.4 15.4h7.2" {...p}/></>;
  case 'stalled':return <><Path d="M6.6 3.6h10.8M6.6 20.4h10.8" {...p}/><Path d="M8 3.6c0 4.6 8 4.4 8 8.4s-8 3.8-8 8.4M16 3.6c0 4.6-8 4.4-8 8.4s8 3.8 8 8.4" {...p}/></>;
  case 'live':return <><Path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8" {...p}/><Circle cx={12} cy={12} r={1.5} fill={color}/></>;
 }})();
 return <Svg width={20} height={20} viewBox="0 0 24 24">{body}</Svg>;
}

/** A session row's small gauge: its burn on the speedometer's scale. */
function Mini({value,max,color}:{value:number|null;max:number;color:string}){
 const g=valid(value)?Math.min(1,value/max):0,a=Math.PI*(1-g),x=32+25*Math.cos(a),y=32-25*Math.sin(a),nx=32+20*Math.cos(a),ny=32-20*Math.sin(a);
 return <Svg width={30} height={18} viewBox="0 0 64 36" style={{opacity:valid(value)?1:.3}}>
  <Path d="M7 32 A25 25 0 0 1 57 32" fill="none" stroke={quick.ink} strokeOpacity={.12} strokeWidth={5} strokeLinecap="round"/>
  {g>0&&<Path d={`M7 32 A25 25 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"/>}
  <Line x1={32} y1={32} x2={nx} y2={ny} stroke={quick.ink} strokeWidth={2.6} strokeLinecap="round"/></Svg>;
}

/** One digit wheel of the odometer, rolling to its digit. */
function Wheel({digit,lead,calm,h}:{digit:number;lead:boolean;calm:boolean;h:number}){
 const [y]=useState(()=>new Animated.Value(-digit*h));
 useEffect(()=>{if(calm)y.setValue(-digit*h);else Animated.timing(y,{toValue:-digit*h,duration:900,easing:Easing.out(Easing.cubic),useNativeDriver:true}).start();},[digit,calm,h,y]);
 return <View style={{width:h*.56,height:h,overflow:'hidden'}}><Animated.View style={{transform:[{translateY:y}]}}>
  {Array.from({length:10},(_,d)=><Text key={d} style={{height:h,lineHeight:h,fontSize:h*.8,fontWeight:'600',textAlign:'center',color:lead?'#5b666d':'#e9eef0',fontVariant:['tabular-nums']}}>{d}</Text>)}</Animated.View></View>;
}
function Odometer({value,calm}:{value:number|null;calm:boolean}){
 const total=Math.max(0,Math.min(9999999999,Math.round(value||0))),s=String(total).padStart(10,'0'),lead=10-String(total).length,h=22;
 return <View accessible accessibilityRole="image" accessibilityLabel={total.toLocaleString()+' tokens'} style={st.odo}>
  {[...s].map((ch,k)=><React.Fragment key={k}>{k>0&&(10-k)%3===0&&<Text style={{color:'#5b666d',fontSize:16,fontWeight:'600'}}>,</Text>}<Wheel digit={Number(ch)} lead={k<lead} calm={calm} h={h}/></React.Fragment>)}</View>;
}

/** The token flow page: the period's bins by tool, oldest at left. */
function FlowBars({flow,width}:{flow?:Flow;width:number}){
 const bins=(flow?.bins||[]).map(b=>Object.entries(b||{}).filter(([,v])=>valid(v)&&v>0) as [string,number][]),totals=bins.map(b=>b.reduce((n,[,v])=>n+v,0)),top=Math.max(1,...totals),h=150,n=Math.max(1,bins.length),bw=width/n;
 return <Svg width={width} height={h}>
  {[.25,.5,.75].map(f=><Line key={f} x1={0} x2={width} y1={h*f} y2={h*f} stroke={quick.grid} strokeWidth={.6} strokeDasharray="2 3"/>)}
  {bins.map((parts,i)=>{let y=h;return <G key={i}>{parts.map(([kind,v])=>{const bh=v/top*(h-6),r=<Path key={kind} d={`M${(i*bw+bw*.12).toFixed(2)} ${(y-bh).toFixed(2)}h${(bw*.76).toFixed(2)}v${bh.toFixed(2)}h${(-bw*.76).toFixed(2)}Z`} fill={toolColor(kind)}/>;y-=bh;return r;})}</G>;})}
 </Svg>;
}

export function Cluster(){
 const w=useWorkspace(),t:T=w.t,period:WindowKey=w.period,calm=useCalm(),{width}=useWindowDimensions();
 const [hold]=useState<{period?:string;tpm?:number}>(()=>({})),[pick,setPick]=useState<Pick>(null),[mode,setModeState]=useState<Mode>('sessions'),[trip,setTrip]=useState<number|null>(null),[detail,setDetail]=useState<SessionRow|null>(null),[lamp,setLamp]=useState<LampKind|null>(null);
 const visible:Device[]=w.visible||[],tags=accountTags(w.devices||[]),at=w.clock/1000;
 // The trip runs from the last reset, kept on this phone; the first visit starts it.
 useEffect(()=>{Promise.all([SecureStore.getItemAsync(SAVED.mode),SecureStore.getItemAsync(SAVED.trip)]).then(([m,tr])=>{if(MODES.some(([k])=>k===m))setModeState(m as Mode);const n=Number(tr);
  if(n>0&&n<=shownNow()/1000)setTrip(n);else{const start=Math.floor(shownNow()/1000);setTrip(start);SecureStore.setItemAsync(SAVED.trip,String(start)).catch(()=>{});}}).catch(()=>setTrip(Math.floor(shownNow()/1000)));},[]);
 const setMode=(m:Mode)=>{setModeState(m);SecureStore.setItemAsync(SAVED.mode,m).catch(()=>{});};
 const resetTrip=()=>{const start=Math.floor(shownNow()/1000);setTrip(start);SecureStore.setItemAsync(SAVED.trip,String(start)).catch(()=>{});};
 const state=clusterState(visible,at*1000),r:Readings=readings(state,{period,now:at,pick,trip:trip!==null&&trip<=at?trip:null,sessions:state.root_sessions,hold});
 // Between readings the odometer and the trip run on at the last minute's rate from the report's time, for
 // up to 30 seconds, as on the desktop; with less motion asked for, or a demo held for filming, they wait.
 const [real,setReal]=useState(0),running=!calm&&!(w.demo&&heldDemo()!==null);
 useEffect(()=>{if(!running)return;const id=setInterval(()=>setReal(Date.now()/1000),1000);return()=>clearInterval(id);},[running]);
 const el=running&&real>0?Math.min(30,Math.max(0,real-state.updated)):0,odo=r.tach.tokens===null?null:r.tach.tokens+r.tach.climb*el;
 const add=valid(r.tach.instant)?r.tach.instant/HOUR*el:0,tr=r.trip,tripTokens=tr?.inRange&&tr.tokens!==null?tr.tokens+add:null,tripHours=tr?(at+el-tr.start)/HOUR:0;
 const lang=w.lang,loc=locale(lang),caption=t('Last ','최근 ')+periodLabel(period,t),percent=(n:number|null|undefined)=>pctNumber(n)+(valid(n)?'%':''),burn=(n:number|null|undefined)=>valid(n)?pctNumber(n)+t('%/h','%/시간'):'—';
 const rowOf=(id:string)=>(w.rows as SessionRow[]).find(x=>x.key===id)||null,name=(s:ClusterSession)=>(s.terminal||'').trim()||(s.project==='0'&&s.kind==='Aside'?t('Aside default workspace','Aside 기본 작업공간'):s.project)||toolName(s.kind);
 const alert=(kind:LampKind)=>{setLamp(kind);setTimeout(()=>setLamp(old=>old===kind?null:old),3200);if(kind==='live')return;const ids=r.tells[kind];if(!ids.length)return;
  const type=kind==='empty'||kind==='reconnect'?'account':'session',i=pick?.type===type?ids.indexOf(pick.id):-1;setPick({type,id:ids[(i+1)%ids.length]});setMode(type==='account'?'weekly':'sessions');};
 const when=(s:number)=>{const d=new Date(s*1000);return d.toLocaleDateString(loc,{weekday:'short'})+' '+d.toLocaleTimeString(loc,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});};
 const eta=(a:Readings['accounts'][number])=>!a.range?null:a.range.state==='idle'?<Text style={[st.tiny,{color:quick.dim}]}>{t('Not in use now','지금은 쓰지 않음')}</Text>
  :a.range.state==='enough'?<Text style={[st.tiny,{color:quick.mint}]}>{t('Lasts until the reset','초기화 전까지 충분')}</Text>
  :<Text style={[st.tiny,{color:a.range.early?quick.red:quick.muted}]}>{t('At this rate','이 속도면')} <Text style={[st.tiny,{fontWeight:'700',color:a.range.early?quick.red:quick.ink}]}>{when(a.range.at!)}</Text> {t('runs out','바닥')}</Text>;
 // The two dials are the same size, like a car's pair; the speedometer comes first at a phone's width.
 const inner=Math.min(width,820)-32-28,dial=Math.min(inner,300),working=r.working>0;
 // Speedometer: the subject's %/h of its account's weekly limit at its last minute's tokens, in that tool's colour.
 const sub=r.speed.subject,acct=sub&&r.accounts.find(a=>a.id===sub.account),subject=sub?toolColor(sub.kind):quick.dim,over=r.speed.cruise!==null&&r.speed.live!==null&&r.speed.live>r.speed.cruise;
 // Tachometer: tokens per minute; the scale and the figure share one unit, k or M.
 const div=r.tach.tpmMax>=1e6?1e6:1e3,tpm=r.tach.now===null?null:r.tach.now/60/div,tachShown=tpm===null?'—':tpm.toFixed(tpm<10?2:tpm<100?1:0),tpmUnit=(div===1e6?'M':'k')+' tpm';
 const kinds=r.tells.kinds,flow=fleetFlow(reporting(visible),period);
 return <Screen title={t('Cluster','계기판')}>
  <View style={st.housing}>
   {/* Top: the tools working now, then the warning lights. */}
   <View style={{alignItems:'center',gap:8}}>
    {kinds.length>0&&<View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:6}}>{kinds.map(k=><View key={k.kind} style={[st.kind,{borderColor:toolColor(k.kind)+'55'}]}><View style={[st.dot,{backgroundColor:toolColor(k.kind)}]}/><Text style={st.kindText}>{toolName(k.kind)}</Text><Text style={[st.kindText,{color:quick.muted}]}>{k.working}</Text></View>)}</View>}
    <View accessibilityRole="toolbar" accessibilityLabel={t('Warning lights','경고등')} style={st.lamps}>{LAMPS.map(([k,en,ko])=>{const n=k==='live'?null:r.tells[k].length,on=k==='live'||n!>0,stale=k==='live'&&!r.tells.fresh;
     const color=!on?quick.dim+'66':k==='empty'||stale?quick.red:k==='live'?quick.accent:quick.amber,label=k==='live'?(r.tells.fresh?t('Live','실시간'):t(en,ko)):t(en,ko);
     return <Pressable key={k} accessibilityRole="button" accessibilityLabel={label+(n?' '+n:'')} accessibilityState={{disabled:!n&&k!=='live'}} onPress={()=>alert(k)} hitSlop={4} style={st.lamp}><Lamp kind={k} color={color}/></Pressable>;})}</View>
    {lamp&&<Text style={[st.tiny,{color:quick.muted}]}>{lamp==='live'?(r.tells.fresh?t('Live','실시간'):t('Collection delayed','수집 지연')):t(LAMPS.find(x=>x[0]===lamp)![1],LAMPS.find(x=>x[0]===lamp)![2])} <Text style={[st.tiny,{color:quick.ink,fontWeight:'700'}]}>{lamp==='live'?'':r.tells[lamp].length}</Text></Text>}
   </View>
   <Dial size={dial} value={r.speed.live} max={r.speed.max} color={subject} name={t('Burn rate','소진 속도')} read={reading(r.speed.live)} unit={t('%/h of the weekly limit','%/시간 · 주간 한도 기준')} band={r.speed.cruise} calm={calm}
    shake={{on:working,period:3100,delay:400}} label={t('Burn rate','소진 속도')+' '+reading(r.speed.live)+'%/h'}
    aux={<View style={{alignItems:'center'}}>{r.speed.cruise!==null&&<Text style={[st.aux,{color:over?quick.amber:quick.mint}]}>{t('Cruise','적정')} <Text style={[st.aux,{fontWeight:'700',color:over?quick.amber:quick.mint}]}>{burn(r.speed.cruise)}</Text></Text>}
     {r.speed.value!==null&&r.speed.live!==r.speed.value&&<Text style={st.aux}>{caption} {t('Average','평균')} <Text style={[st.aux,{fontWeight:'700',color:quick.ink}]}>{burn(r.speed.value)}</Text></Text>}</View>}
    sub={<View style={st.subChip}>{!sub?<Text style={st.tiny}>{t('Measuring account burn','계정 소진 속도 측정 중')}</Text>:<>
     <View style={[st.dot,{backgroundColor:subject}]}/>{sub.type==='session'&&sub.session?<><Text numberOfLines={1} style={[st.tiny,{color:quick.ink,fontWeight:'600',flexShrink:1}]}>{name(sub.session)}</Text><Text style={st.tiny}>· {toolName(sub.kind)}</Text></>
      :<><Text style={[st.tiny,{color:quick.ink,fontWeight:'600'}]}>{toolName(sub.kind)}</Text><AccountChip text={tags[sub.id]}/>{!!acct?.plan&&<Text style={st.tiny}>· {acct.plan}</Text>}{!r.speed.picked&&<Text style={[st.tiny,{color:quick.dim}]}>{t('Fastest','가장 빠름')}</Text>}</>}</>}</View>}/>
   {/* Tachometer: tokens per minute, like rpm; the needle and the figure the last minute, the period's average under them. */}
   <Dial size={dial} value={tpm} max={r.tach.tpmMax/div} color={quick.accent} name={t('Token speed','토큰 속도')} read={tachShown}
    unit={tpmUnit} calm={calm} shake={{on:working,period:2300,delay:0}} label={t('Token speed','토큰 속도')+' '+tachShown+tpmUnit}
    aux={r.tach.live&&r.tach.rate!==null?<Text style={st.aux}>{caption} {t('Average','평균')} <Text style={[st.aux,{fontWeight:'700',color:quick.ink}]}>{fmt(r.tach.rate/60,loc)}</Text> tpm</Text>:null}
    sub={<View style={st.subChip}><Text style={st.tiny}>{r.tach.live?t('Last 1m','최근 1분'):caption+' '+t('Average','평균')}</Text></View>}/>
   {/* The window: three pages behind tabs. */}
   <View style={st.window}>
    <View style={st.modes} accessibilityRole="tablist">{MODES.map(([k,en,ko])=><Pressable key={k} accessibilityRole="tab" accessibilityState={{selected:mode===k}} onPress={()=>setMode(k)} style={[st.mode,mode===k&&{backgroundColor:quick.raised}]}><Text numberOfLines={1} style={[st.modeText,mode===k&&{color:quick.ink}]}>{t(en,ko)}</Text></Pressable>)}</View>
    <Text style={[st.tiny,{alignSelf:'flex-end'}]}>{caption}</Text>
    {mode==='sessions'&&(r.sessions.length?r.sessions.map(x=>{const s=x.session,on=r.speed.session===x.id,color=toolColor(s.kind);
     return <Pressable key={x.id} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>{if(on){const row=rowOf(x.id);if(row)setDetail(row);}else setPick({type:'session',id:x.id});}} style={[st.session,on&&{borderColor:quick.mint+'88',backgroundColor:quick.mint+'14'}]}>
      <StateMark status={x.state}/>
      <View style={{flex:1,minWidth:0,gap:2}}><Text numberOfLines={1} style={st.sessionName}>{name(s)}</Text><View style={{flexDirection:'row',alignItems:'center',gap:5}}><View style={[st.dot,{backgroundColor:color}]}/><Text numberOfLines={1} style={st.tiny}>{toolName(s.kind)}</Text>{!!x.account&&<AccountChip text={tags[x.account]}/>}</View></View>
      <View style={{alignItems:'flex-end',gap:2}}><Text style={st.fig}>{x.estimate!==null?'≈'+percent(x.estimate):fmt(x.tokens,loc)+' tokens'}</Text><Text style={st.tiny}>{burn(x.burn)}</Text></View>
      <Mini value={x.burn} max={r.speed.max} color={color}/>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Session details','세션 상세')} hitSlop={8} onPress={()=>{const row=rowOf(x.id);if(row)setDetail(row);}} style={{paddingHorizontal:2}}><Text style={{color:quick.dim,fontSize:14}}>↗</Text></Pressable></Pressable>;})
     :<Text style={st.empty}>{t('No sessions are working.','작업 중인 세션이 없습니다.')}</Text>)}
    {mode==='flow'&&<View style={{gap:8}}><View style={{flexDirection:'row',alignItems:'baseline',gap:6}}><Text style={st.big}>{fmt(odo,loc)}</Text><Text style={st.tiny}>{t('Tokens','토큰')}</Text></View>
     <FlowBars flow={flow} width={inner-24}/>
     <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{[...new Set((flow?.bins||[]).flatMap(b=>Object.keys(b||{})))].map(k=><View key={k} style={{flexDirection:'row',alignItems:'center',gap:5}}><View style={[st.dot,{backgroundColor:toolColor(k)}]}/><Text style={st.tiny}>{toolName(k)}</Text></View>)}</View></View>}
    {mode==='weekly'&&(r.accounts.length?r.accounts.map(a=>{const on=r.speed.account===a.id&&r.speed.picked,color=toolColor(a.kind);
     return <Pressable key={a.id} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>setPick(on?null:{type:'account',id:a.id})} style={[st.card,on&&{borderColor:quick.mint+'88',backgroundColor:quick.mint+'12'}]}>
      <View style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={[st.dot,{backgroundColor:color}]}/><Text style={[st.tiny,{color:quick.ink,fontWeight:'600'}]}>{toolName(a.kind)}</Text><AccountChip text={tags[a.id]}/>{!!a.plan&&<Text style={st.tiny}>{a.plan}</Text>}{!!a.window&&!a.weekly&&<Text style={st.tiny}>· {a.window}</Text>}<View style={{flex:1}}/>{!!a.who&&a.who.toLowerCase()!==String(a.alias||'').toLowerCase()&&<Text numberOfLines={1} style={[st.tiny,{color:quick.dim,flexShrink:1}]}>{a.who}</Text>}</View>
      <View style={{flexDirection:'row',alignItems:'baseline',gap:6}}><Text style={st.big}>{percent(a.pct)}</Text><Text style={st.tiny}>{t('/ 100% used','/ 100% 사용')}</Text></View>
      <View style={st.bar}><View style={{width:`${a.pct===null?0:Math.min(100,a.pct)}%`,height:'100%',backgroundColor:color,opacity:a.current?1:.45}}/></View>
      <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:4}}>{a.reconnect?<Text style={[st.tiny,{color:quick.amber,fontWeight:'600'}]}>{t('Reconnect needed','재연결 필요')}</Text>
       :<Text style={st.tiny}>{caption} <Text style={[st.tiny,{fontWeight:'700',color}]}>{a.added===null?'—':'+'+percent(a.added)}</Text></Text>}
       <Text style={st.tiny}>{t('Average','평균')} <Text style={[st.tiny,{fontWeight:'700',color:quick.ink}]}>{burn(a.burn)}</Text></Text></View>
      {eta(a)}</Pressable>;})
     :<Text style={st.empty}>{t('No subscription accounts connected.','연결된 구독 계정이 없습니다.')}</Text>)}
   </View>
   {/* Gear: the time window, shared with every tab. */}
   <View style={{gap:6,alignItems:'center'}}><Text style={st.label}>{t('Time window','기간')}</Text>
    <View accessibilityRole="radiogroup" style={st.gears}>{PERIOD_NAMES.map(([k,en,ko])=><Pressable key={k} accessibilityRole="radio" accessibilityState={{checked:k===period}} onPress={()=>w.setPeriod(k)} style={[st.gear,k===period&&{backgroundColor:quick.mint}]}><Text style={[st.gearText,k===period&&{color:quick.onAccent}]}>{t(en,ko)}</Text></Pressable>)}</View></View>
   {/* Load at left of the fuel: the busiest computer's CPU or memory, cold (C) to hot (H). Fuel: each account's weekly limit left. */}
   <View style={{flexDirection:'row',alignItems:'flex-end',gap:18}}>
    <View style={{alignItems:'center',gap:3}}><Text style={[st.label,{alignSelf:'flex-start'}]}>{t('Load','부하')}</Text>
     <Svg width={66} height={38} viewBox="0 0 80 46"><Path d="M8 40 A32 32 0 0 1 72 40" fill="none" stroke={quick.ink} strokeOpacity={.12} strokeWidth={5} strokeLinecap="round"/><Path d="M64.6 21.4 A32 32 0 0 1 72 40" fill="none" stroke={quick.red} strokeOpacity={.65} strokeWidth={5} strokeLinecap="round"/>
      {(()=>{const v=r.heat.value??0,a=Math.PI*(1-v/100),hot=r.heat.value!==null&&r.heat.value>=85;return <Line x1={40} y1={40} x2={40+26*Math.cos(a)} y2={40-26*Math.sin(a)} stroke={hot?quick.red:quick.ink} strokeWidth={2.2} strokeLinecap="round"/>;})()}
      <Circle cx={40} cy={40} r={3.5} fill={quick.ink}/><SvgText x={3} y={45} fontSize={9} fill={quick.muted} fontWeight="700">C</SvgText><SvgText x={71} y={45} fontSize={9} fill={quick.muted} fontWeight="700">H</SvgText></Svg>
     <Text style={[st.tiny,{fontWeight:'600',color:r.heat.value!==null&&r.heat.value>=85?quick.red:quick.muted}]}>{r.heat.value===null?'—':Math.round(r.heat.value)+'%'}</Text></View>
    <View style={{flex:1,gap:6}}><Text style={st.label}>{r.accounts.some(a=>a.window&&!a.weekly)?t('Limit left','남은 한도'):t('Weekly limit left','남은 주간 한도')}</Text>
     {r.accounts.length?<View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{r.accounts.map(a=>{const on=r.speed.account===a.id&&r.speed.picked,low=a.left!==null&&a.left<15,color=toolColor(a.kind);
      return <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={toolName(a.kind)+' '+(tags[a.id]||'')+' '+(a.left===null?'—':percent(a.left))} accessibilityState={{selected:on}} onPress={()=>setPick(on?null:{type:'account',id:a.id})} style={{alignItems:'center',gap:5}}>
       <View style={[st.can,a.reconnect&&{borderWidth:1,borderColor:quick.amber},on&&{borderWidth:1.5,borderColor:color}]}><View style={{position:'absolute',left:0,right:0,bottom:0,height:`${a.left===null?0:a.left}%`,backgroundColor:low?quick.amber:color,opacity:a.current?1:.45}}/></View>
       <Text style={[st.tiny,{fontWeight:'600',color:on?quick.ink:quick.muted}]}>{a.plan||tags[a.id]||toolName(a.kind)}{a.window&&!a.weekly?' · '+a.window:''}</Text></Pressable>;})}</View>
      :<Text style={st.tiny}>{t('No subscription accounts connected.','연결된 구독 계정이 없습니다.')}</Text>}</View>
   </View>
   {/* Odometer: the period's tokens, digit wheels rolling to the new count. Trip: since the last reset. */}
   <View style={{gap:7}}>
    <Text style={st.label}>{t('Tokens','토큰')} · {caption}</Text>
    <Odometer value={odo} calm={calm}/>
    <View style={{flexDirection:'row',alignItems:'center',gap:7}}><Text style={[st.tiny,{color:quick.ink,fontWeight:'700',letterSpacing:.4}]}>{t('Work trip','작업 트립')}</Text>
     {tr&&<Text style={st.tiny}>{new Date(tr.start*1000).toLocaleString(loc,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})} {t('since','부터')}</Text>}
     <Pressable accessibilityRole="button" onPress={resetTrip} style={st.reset}><Text style={[st.tiny,{fontWeight:'600'}]}>{t('Reset','리셋')}</Text></Pressable></View>
    {tr&&(tr.inRange?<Text style={st.tiny}><Text style={[st.tiny,{fontWeight:'700',color:quick.ink}]}>{fmt(tripTokens,loc)}</Text> {t('Tokens','토큰')} · {t('Average','평균')} <Text style={[st.tiny,{fontWeight:'700',color:quick.ink}]}>{tripTokens!==null&&tripHours>0?fmt(tripTokens/tripHours,loc):'—'}</Text> {t('tokens/h','tokens/시간')}</Text>
     :<Text style={[st.tiny,{color:quick.amber}]}>{t('Outside the record','기록 범위 밖')}</Text>)}
    {tr&&tr.accounts.length>0&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>{tr.accounts.map(x=>{const a=r.accounts.find(a=>a.id===x.id);if(!a)return null;
     return <View key={x.id} style={{flexDirection:'row',alignItems:'center',gap:4}}><View style={[st.dot,{width:6,height:6,backgroundColor:toolColor(a.kind)}]}/><Text style={st.tiny}>{a.plan||tags[a.id]||toolName(a.kind)} <Text style={[st.tiny,{fontWeight:'700',color:quick.ink}]}>{x.used===null?'—':'+'+percent(x.used)}</Text></Text></View>;})}</View>}
   </View>
  </View>
  <SessionDetails key={detail?.key||'none'} row={detail} close={()=>setDetail(null)}/>
 </Screen>;
}

const make=()=>StyleSheet.create({
 housing:{gap:18,paddingHorizontal:14,paddingTop:16,paddingBottom:24,borderRadius:36,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 dot:{width:7,height:7,borderRadius:4},
 kind:{flexDirection:'row',alignItems:'center',gap:6,height:26,paddingHorizontal:10,borderRadius:13,borderWidth:1,backgroundColor:quick.background+'b3'},
 kindText:{fontSize:11.5,fontWeight:'600',color:quick.ink},
 lamps:{flexDirection:'row',gap:2,paddingHorizontal:6,paddingVertical:2,borderRadius:12,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 lamp:{width:36,height:32,alignItems:'center',justifyContent:'center',borderRadius:8},
 aux:{fontSize:11,fontWeight:'600',color:quick.muted},
 tiny:{fontSize:11,color:quick.muted},
 label:{fontSize:10.5,fontWeight:'600',letterSpacing:.6,color:quick.muted},
 subChip:{flexDirection:'row',alignItems:'center',gap:5,maxWidth:'84%',paddingHorizontal:10,paddingVertical:4,borderRadius:14,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 window:{gap:8,padding:12,borderRadius:16,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 modes:{flexDirection:'row',gap:2,padding:3,borderRadius:10,backgroundColor:quick.ink+'0d'},
 mode:{flex:1,height:28,alignItems:'center',justifyContent:'center',borderRadius:7,paddingHorizontal:4},
 modeText:{fontSize:11.5,fontWeight:'600',color:quick.muted},
 session:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:7,paddingHorizontal:6,borderRadius:10,borderWidth:1,borderColor:'transparent'},
 sessionName:{fontSize:13,fontWeight:'600',color:quick.ink},
 fig:{fontSize:13,fontWeight:'600',color:quick.ink,fontVariant:['tabular-nums']},
 empty:{fontSize:12.5,color:quick.muted,textAlign:'center',paddingVertical:18},
 big:{fontSize:26,fontWeight:'700',letterSpacing:-.6,color:quick.ink,fontVariant:['tabular-nums']},
 card:{gap:7,padding:12,borderRadius:12,borderWidth:1,borderColor:quick.line},
 bar:{height:5,borderRadius:3,backgroundColor:quick.ink+'17',overflow:'hidden'},
 gears:{flexDirection:'row',alignSelf:'stretch',padding:4,gap:2,borderRadius:12,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 gear:{flex:1,height:32,alignItems:'center',justifyContent:'center',borderRadius:9},
 gearText:{fontSize:12,fontWeight:'600',color:quick.muted},
 can:{width:15,height:46,borderRadius:4,backgroundColor:quick.ink+'17',overflow:'hidden'},
 odo:{flexDirection:'row',alignItems:'center',alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:5,borderRadius:10,borderWidth:1,borderColor:quick.line,backgroundColor:'#14181b'},
 reset:{height:22,paddingHorizontal:8,justifyContent:'center',borderRadius:6,borderWidth:1,borderColor:quick.line},
});
let st=make();onTheme(()=>{st=make();});
