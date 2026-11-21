import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Animated,Easing,Modal,Pressable,ScrollView,type ScrollViewInstance,type StyleProp,StyleSheet,View,type ViewStyle,useWindowDimensions} from 'react-native';
import {SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import {StatusBar} from 'expo-status-bar';
import {useIsFocused} from 'expo-router';
import Svg,{Circle,Defs,G,Line,LinearGradient,Path,Polygon,RadialGradient,Rect,Stop,Text as SvgText} from 'react-native-svg';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {Map as UsageMap,SessionDetails,periodLabel} from './ui';
import {BrandHeader} from './header';
import {fleetFlow,pickTiles,reporting,short} from './fleet';
import {usage} from './metrics';
import {PERIOD_NAMES,locale} from './i18n';
import {onTheme,quick,themeName,toolColor,toolName} from './theme';
import {StateMark} from './state-mark';
import {heldDemo,now as shownNow,pinnedBurnRate,pinnedTachRate} from './clock';
import {burnLevel,burnMarks,clusterState,feverLevel,fmt,pctNumber,readings,scaleNumber,tachMarks,valid,type ClusterSession,type Hold,type Only,type Pick,type Readings} from './cluster-model';
import {Lcd,Odometer,RangeWheels,burnCells,drumPlate,rangeCells,tokenCells} from './lcd';
import {PeriodDial} from './periods';
import {Canvas,Editor,Gear,Part,useCalm,useEditor,useLayout,useQuiet,useSay} from './customize';
import * as M from './customize-model';
import {ThemeView,figures as themeFigures,shownFigures,useClusterTheme,type Press as ThemePress} from './cluster-themes';
import {THEME_COMPACT} from './theme-host';
import type {ObjectId} from './layout';
import type {Device,Flow,SessionRow,WindowKey} from './types';

// The cluster, as on the desktop dashboard and the web (agent/onetop/dist/cluster.js, cluster.css): two dials of one
// size, the figure at each one's centre with a red pointer riding the rim, the token lane lit green to red as the
// speed rises, the burn dial in one tone, displays for the odometer and the range in the lower opening, the warning
// lights, CPU and memory with the trip, the fuel, and the window: the period drum over seven pages. Upright the dials
// stack or sit side by side (the switch at the top); on its side the cluster fills the screen with three axes,
// dial · window · dial. The numbers are the desktop's (cluster-model.ts). New words are Korean for now.
// With a theme chosen (customizing, cluster-themes plan v1.1.0): upright its two headline instruments, cut out of it
// (themes/compact.js), stand in place of the dials and the rest stays the cluster's own; '크게 보기' shows the whole
// theme over the screen on its side. On its side the whole theme draws across the housing, in place of the dials, the
// lights, the odometer row and the period control. Its warnings, gear and trip answer as the cluster's own.
type Mode='sessions'|'flow'|'weekly'|'map'|'heat'|'goals'|'system';
const MODES:[Mode,string,string][]=[['sessions','Sessions','세션'],['flow','Token flow','토큰 흐름'],['weekly','Limits','한도'],['map','Usage map','사용량 맵'],['heat','Heatmap','히트맵'],['goals','Goals','목적지'],['system','Resources','리소스']];
const SAVED={mode:'onetop.cluster.mode',trip:'onetop.cluster.trip'};
const HOUR=3600,RED='#ff3b30',MINT='#6ccfa9';
// The displays' colour (the dials' needle option, cluster.css data-led): white, red or amber.
const LED:Record<string,string>={default:'#eef2f4',red:'#ff3b30',amber:'#ffae2b'};
type Tell='live'|'working'|'waiting'|'done'|'reconnect'|'empty';
// Live first (green while readings arrive, red '수집 지연' when they run late), then what is working (in the LCD
// green), waiting and done, and the two account troubles in red.
const TELLS:[Tell,string,string,string|null][]=[['live','Live','실시간','#9be23c'],['working','Working','작업 중',null],['waiting','Waiting','응답 대기','#e3b25a'],['done','Done','완료됨',MINT],['reconnect','Sign in','재로그인','#f2797d'],['empty','Low limit','한도 부족','#f2797d']];
// Green for the first half of the token scale, then quickly yellow, orange and red.
const LANE:[number,string][]=[[0,'#57d36a'],[.5,'#57d36a'],[.62,'#e2e04a'],[.76,'#ff9a2e'],[.88,'#ff3b30'],[1,'#ff3b30']];

const clamp=(f:number)=>Math.max(0,Math.min(1,Number.isFinite(f)?f:0));
const hex=(c:string)=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
function colorAt(stops:[number,string][],f:number){
 f=clamp(f);let i=1;while(i<stops.length-1&&stops[i][0]<f)i++;const [f0,c0]=stops[i-1],[f1,c1]=stops[i],k=f1>f0?clamp((f-f0)/(f1-f0)):1;
 return '#'+hex(c0).map((v,j)=>Math.round(v+(hex(c1)[j]-v)*k).toString(16).padStart(2,'0')).join('');
}
// A tool's colour lifted a fifth of the way to white, so it reads on the dark face.
const lift=(c:string)=>/^#[0-9a-f]{6}$/i.test(c)?'#'+hex(c).map(v=>Math.round(v+(255-v)*.22).toString(16).padStart(2,'0')).join(''):c;
// The scale sweeps 240° from lower left, which leaves the lower third open for the displays.
const C=170,A0=150,SWEEP=240,ang=(f:number)=>(A0+SWEEP*f)*Math.PI/180,pt=(f:number,r:number)=>[C+r*Math.cos(ang(f)),C+r*Math.sin(ang(f))];
// The lit sector behind the needle (the glow face) for a fraction of full scale.
const fan=(f:number)=>{const R=140,[x0,y0]=pt(0,R),[x1,y1]=pt(clamp(f),R);return `M${C} ${C} L${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${SWEEP*clamp(f)>180?1:0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z`;};
function arc(a:number,b:number,r:number){if(!(b>a))return '';const [x0,y0]=pt(a,r),[x1,y1]=pt(b,r);return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${(b-a)*SWEEP>180?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;}

/** A pointer that springs to its fraction of full scale; on the first reading it sweeps to full scale and back. */
function useNeedle(target:number|null,calm:boolean){
 const [turn]=useState(()=>new Animated.Value(0)),started=useRef(false);
 useEffect(()=>{if(target===null)return;const to=clamp(target);
  if(calm){turn.setValue(to);started.current=true;return;}
  if(!started.current){started.current=true;Animated.sequence([Animated.timing(turn,{toValue:1,duration:620,easing:Easing.inOut(Easing.cubic),useNativeDriver:true}),
   Animated.spring(turn,{toValue:to,friction:7,tension:34,useNativeDriver:true})]).start();return;}
  Animated.spring(turn,{toValue:to,friction:6.5,tension:38,useNativeDriver:true}).start();},[target,calm,turn]);
 return turn.interpolate({inputRange:[0,1],outputRange:[A0+'deg',(A0+SWEEP)+'deg']});
}
/** While sessions work, a pointer shimmers a few degrees about its reading, like a running engine's; the figure stays exact. */
const SHIMMER:[number,number][]=[[2.4,.17],[-1.1,.14],[3,.17],[.4,.15],[-2,.16],[1.2,.12],[0,.09]];
function useShimmer(on:boolean,period:number,delay:number){
 const [a]=useState(()=>new Animated.Value(0));
 useEffect(()=>{if(!on){a.stopAnimation();a.setValue(0);return;}
  const loop=Animated.loop(Animated.sequence(SHIMMER.map(([to,share])=>Animated.timing(a,{toValue:to,duration:period*share,easing:Easing.inOut(Easing.sin),useNativeDriver:true}))));
  const id=setTimeout(()=>loop.start(),delay);return()=>{clearTimeout(id);loop.stop();};},[on,period,delay,a]);
 return a.interpolate({inputRange:[-10,10],outputRange:['-10deg','10deg']});
}

type Scale={max:number;major:number;minor:number};
/** A dial's face: the faint lane lit up to the reading, ticks and numbers (the top fifth red), the outer redline and
 *  the rim marks. tone is one colour for the burn dial, or null for the token lane. Drawn again only when these change. */
function Face({id,lit,tone,scale,unit,rim,theme,num}:{id:string;lit:number;tone:string|null;scale:Scale;unit:string;rim:string;theme:string;num:number}){
 return useMemo(()=>{
  const stops:[number,string][]=tone?[[0,tone],[1,tone]]:LANE,N=96,lane:React.ReactNode[]=[],on:React.ReactNode[]=[],ticks:React.ReactNode[]=[],nums:React.ReactNode[]=[];
  // A full scale off the minor step (700M on 40M steps) gets its own last tick, and always its number.
  const n=Math.floor(scale.max/scale.minor+1e-6),extra=scale.max-n*scale.minor>scale.max*1e-6?1:0;
  for(let i=0;i<N;i++){const a=i/N,b=Math.min(1,(i+1.15)/N),c=colorAt(stops,(i+.5)/N),d=arc(a,b,147);lane.push(<Path key={i} d={d} stroke={c} strokeWidth={5} fill="none"/>);if((i+.5)/N<=lit)on.push(<Path key={i} d={d} stroke={c} strokeWidth={5} fill="none"/>);}
  for(let i=0;i<=n+extra;i++){const v=i>n?scale.max:i*scale.minor,tf=v/scale.max,last=i===n+extra,major=last||Math.abs(v/scale.major-Math.round(v/scale.major))<1e-6,red=tf>=.8-1e-4,isLit=lit>0&&tf<=lit+1e-4;
   const [x1,y1]=pt(tf,major?122:131),[x2,y2]=pt(tf,141);
   ticks.push(<Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={red?RED:isLit?colorAt(stops,tf):quick.muted} strokeOpacity={isLit?1:red?.55:.42} strokeWidth={major?3:1.5} strokeLinecap="round"/>);
   // The 0 and the full-scale number sit past the ends of the scale, in the corners of the opening.
   const crowd=!last&&major&&(scale.max-v)<scale.major*.6&&Math.abs(scale.max/scale.major-Math.round(scale.max/scale.major))>1e-6;
   if(major&&!crowd){const end=tf<1e-6?-1:tf>1-1e-6?1:0,a=ang(tf)+end*10*Math.PI/180,r=end?126:100,label=v===0?'0':scaleNumber(v)+unit;
    nums.push(<SvgText key={i} x={C+r*Math.cos(a)} y={C+r*Math.sin(a)+6} fill={red?RED:quick.ink} fillOpacity={red?1:.74} fontSize={num} fontWeight="600" textAnchor="middle">{label}</SvgText>);}}
  const marksOnRim=(JSON.parse(rim) as [string,string,number][]).map(([key,color,value])=>{const a=ang(clamp(value/scale.max)),p=(r:number,d:number)=>`${(C+r*Math.cos(a+d)).toFixed(1)},${(C+r*Math.sin(a+d)).toFixed(1)}`;
   return <Polygon key={key} points={`${p(137,0)} ${p(157,.045)} ${p(157,-.045)}`} fill={color} stroke={quick.background} strokeWidth={1.5}/>;});
  return <>
   <Defs><RadialGradient id={'face'+id} cx="50%" cy="42%" r="60%"><Stop offset={0} stopColor={quick.raised}/><Stop offset={1} stopColor={quick.background}/></RadialGradient></Defs>
   <Circle cx={C} cy={C} r={168} fill={`url(#face${id})`}/>
   <Circle cx={C} cy={C} r={160} fill="none" stroke={quick.line} strokeWidth={2}/>
   {[118,92,66].map(r=><Circle key={r} cx={C} cy={C} r={r} fill="none" stroke={quick.ink} strokeOpacity={.07} strokeWidth={1.2} strokeDasharray={r===92?'2 6':undefined}/>)}
   <Path d={arc(0,1,147)} fill="none" stroke={quick.ink} strokeOpacity={.08} strokeWidth={5}/>
   <G opacity={.2}>{lane}</G><G>{on}</G>
   <Path d={arc(.8,1,155)} fill="none" stroke={RED} strokeOpacity={.5} strokeWidth={3.5}/>
   <G>{ticks}</G><G>{marksOnRim}</G><G>{nums}</G></>;
  // theme stands for the palette, which changes in place.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[id,lit,tone,scale.max,scale.major,scale.minor,unit,rim,theme,num]);
}

// Fever: past its limit a dial breaks through, as the web's (cluster.js paintFever, cluster.css Fever): the token dial
// past 200M (300M the first level, 400M the second, 500M and above the third), the burn dial past 20%/h (40, 60, 80 and
// above), each level in its colours and each dial on its own. Entering a level bursts once:
// the dial jumps forward and shakes, a discharge runs round the rim and the level's word sweeps across; while it stays,
// a glow hugging the rim beats in the level's colour. With less motion asked for only the glow shows, still. Nothing is
// drawn further than an eighth of the radius past the rim.
type Fever={level:number;burst:{level:number;key:number}|null};
const FEVER_WORD=['','LIMIT BREAK','OVER DRIVE','FEVER'],FEVER_BEAT=[0,1600,1050,650],RAINBOW=['#ff3b30','#ffd23f','#57d36a','#33e7ff','#9d5bff'];
const FEVER_HUE:[string,string][]=[['#000000','#000000'],['#ff8a1f','#ffd23f'],['#ff2fb4','#9d5bff'],['#33e7ff','#ffffff']];
// A burst's parts keep running through the screen's own re-renders: they redraw only for a new burst or size.
const sameBurst=(a:{size:number;burst:{level:number;key:number}},b:{size:number;burst:{level:number;key:number}})=>a.size===b.size&&a.burst.key===b.burst.key&&a.burst.level===b.burst.level;
/** The glow hugging the rim, beating by level (.45 to full, 1.6 s, 1.05 s, 0.65 s); in a box 20 units past the dial. */
const FeverGlow=React.memo(function FeverGlow({size,level,calm}:{size:number;level:number;calm:boolean}){
 const [beat]=useState(()=>new Animated.Value(1));
 useEffect(()=>{beat.stopAnimation();if(!level||calm){beat.setValue(1);return;}beat.setValue(0);
  const half=FEVER_BEAT[level]/2,step=(to:number)=>Animated.timing(beat,{toValue:to,duration:half,easing:Easing.inOut(Easing.ease),useNativeDriver:true});
  const loop=Animated.loop(Animated.sequence([step(1),step(0)]));loop.start();return()=>loop.stop();},[level,calm,beat]);
 if(!level)return null;
 const hue=FEVER_HUE[level][0],k=size/340,box=380*k;
 const motion=calm?{}:{opacity:beat.interpolate({inputRange:[0,1],outputRange:[.45,1]}),transform:[{scale:beat.interpolate({inputRange:[0,1],outputRange:[.985,1.02]})}]};
 return <Animated.View pointerEvents="none" style={[{position:'absolute',left:-20*k,top:-20*k,width:box,height:box},motion]}>
  <Svg width={box} height={box} viewBox="-20 -20 380 380"><Defs><RadialGradient id="fvGlow" cx={170} cy={170} r={180} fx={170} fy={170} gradientUnits="userSpaceOnUse">
   <Stop offset={159.3/180} stopColor={hue} stopOpacity={0}/><Stop offset={169.4/180} stopColor={hue} stopOpacity={.55}/><Stop offset={179.5/180} stopColor={hue} stopOpacity={0}/></RadialGradient></Defs>
   <Circle cx={170} cy={170} r={180} fill="url(#fvGlow)"/></Svg></Animated.View>;
});
/** The burst's discharge: for 0.9 s, new bolts every 120 ms round the whole rim and four striking in, wide in the
 *  level's colour and fine in its second, over a flash of the second colour (lighter than the web's 70 ms, three
 *  strokes, which a phone's SVG redraw could not keep up with). */
const FeverZap=React.memo(function FeverZap({size,burst}:{size:number;burst:{level:number;key:number}}){
 const [bolts,setBolts]=useState<string[]>([]),[flash]=useState(()=>new Animated.Value(0));
 useEffect(()=>{const level=burst.level,draw=()=>{const out:string[]=[],line=(pts:number[][])=>pts.map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)).join('');
   for(let i=0;i<10;i++){const mid=Math.random()*Math.PI*2,span=(.18+Math.random()*.25)*1.6,pts:number[][]=[];
    for(let t=-1;t<=1.0001;t+=.125){const a=mid+t*span/2,rr=158+(Math.random()-.5)*(10+level*4);pts.push([170+rr*Math.cos(a),170+rr*Math.sin(a)]);}
    out.push(line(pts));if(i<4){const bp:number[][]=[];for(let r=158;r>40;r-=14)bp.push([170+r*Math.cos(mid)+(Math.random()-.5)*14,170+r*Math.sin(mid)+(Math.random()-.5)*14]);out.push(line(bp));}}
   setBolts(out);};
  draw();const id=setInterval(draw,120),stop=setTimeout(()=>{clearInterval(id);setBolts([]);},900);
  flash.setValue(0);Animated.sequence([Animated.timing(flash,{toValue:.85,duration:60,useNativeDriver:true}),Animated.timing(flash,{toValue:.5,duration:170,useNativeDriver:true}),Animated.timing(flash,{toValue:0,duration:270,useNativeDriver:true})]).start();
  return()=>{clearInterval(id);clearTimeout(stop);};},[burst.key,burst.level,flash]);
 const [hue,hue2]=FEVER_HUE[burst.level],k=size/340,box=380*k;
 return <View pointerEvents="none" style={{position:'absolute',left:-20*k,top:-20*k,width:box,height:box}}>
  <Animated.View style={[StyleSheet.absoluteFill,{opacity:flash}]}><Svg width={box} height={box} viewBox="-20 -20 380 380"><Defs><RadialGradient id="fvFlash" cx={170} cy={170} r={172} fx={170} fy={170} gradientUnits="userSpaceOnUse">
   <Stop offset={0} stopColor={hue2} stopOpacity={.7}/><Stop offset={1} stopColor={hue2} stopOpacity={0}/></RadialGradient></Defs><Circle cx={170} cy={170} r={172} fill="url(#fvFlash)"/></Svg></Animated.View>
  <Svg width={box} height={box} viewBox="-20 -20 380 380" style={StyleSheet.absoluteFill}>{bolts.map((d,i)=><G key={i}>
   <Path d={d} stroke={hue} strokeOpacity={.4} strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
   <Path d={d} stroke={hue2} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round"/></G>)}</Svg></View>;
},sameBurst);
/** The level's word sweeping across over the discharge, slanted, its colour split red and sky (FEVER in a rainbow,
 *  larger): in from the left, held, out to the right in 1.6 s, within a circle an eighth past the rim. */
const FeverBanner=React.memo(function FeverBanner({size,burst}:{size:number;burst:{level:number;key:number}}){
 const [t]=useState(()=>new Animated.Value(0));
 useEffect(()=>{t.setValue(0);const run=Animated.timing(t,{toValue:1,duration:1600,easing:Easing.bezier(.2,.8,.3,1),useNativeDriver:true});run.start();return()=>run.stop();},[burst.key,t]);
 // Made once, so a redraw never hands the view fresh values that would undo the running sweep.
 const [opacity,tx,scale]=useMemo(()=>{const K=[0,.18,.7,1];return [t.interpolate({inputRange:K,outputRange:[0,1,1,0]}),t.interpolate({inputRange:K,outputRange:[-.9*size,0,0,.9*size]}),t.interpolate({inputRange:K,outputRange:[1,1,1.04,1.04]})];},[t,size]);
 const level=burst.level,word=FEVER_WORD[level],hue=FEVER_HUE[level][0],fs=size*(level===3?.15:.11),cut=size*.06,inner=size+2*cut,split=size*.006;
 const text=(color:string|null,dx:number,glow:boolean)=><Text numberOfLines={1} style={{position:'absolute',left:0,right:0,textAlign:'center',transform:[{translateX:dx}],fontSize:fs,lineHeight:fs*1.15,fontWeight:'900',fontStyle:'italic',letterSpacing:fs*.08,
   color:color||hue,...(glow?{textShadowColor:hue,textShadowOffset:{width:0,height:0},textShadowRadius:size*.04}:{})}}>
  {color===null&&level===3?[...word].map((ch,i)=><Text key={i} style={{color:RAINBOW[i%RAINBOW.length]}}>{ch}</Text>):word}</Text>;
 return <View pointerEvents="none" style={{position:'absolute',left:-cut,top:-cut,width:inner,height:inner,borderRadius:inner/2,overflow:'hidden'}}>
  <Animated.View style={{position:'absolute',left:0,right:0,top:cut+size*.42-fs*.6,height:fs*1.2,opacity,transform:[{translateX:tx},{scale},{skewX:'-18deg'}]}}>
   {text('#ff2a6a',split,false)}{text('#22e6ff',-split,false)}{text(null,0,true)}</Animated.View></View>;
},sameBurst);

/** A dial's fever bursts: entering a higher level bursts once for 2.2 s; the level is remembered per dial. */
function useFever(level:number,calm:boolean){
 const was=useRef(0),count=useRef(0),[burst,setBurst]=useState<{level:number;key:number}|null>(null);
 useEffect(()=>{const before=was.current;was.current=level;if(level<=before||calm)return;
  setBurst({level,key:++count.current});const id=setTimeout(()=>setBurst(null),2200);return()=>clearTimeout(id);},[level,calm]);
 return burst;
}
/** One dial: the face, the rim pointer, and at the centre the figure, its unit and name, with the display in the lower
 *  opening. Below 280 the figure and type tighten and the numbers grow; below 200 the name and the display give way.
 *  The token dial also carries its fever: the glow under it, and on a burst the jump, the discharge and the banner. */
// Its face (customizing, cluster.css data-style): ring (the default); glow, the face lit behind the needle in the gauge's
// colour; plate, the figure on a dark plate.
function Dial({id,size,f,tone,scale,unit,figure,figUnit,name,display,rim,calm,label,shake,fever,shape='ring',gauge}:{id:string;size:number;f:number|null;tone:string|null;scale:Scale;unit:string;fever?:Fever;
 figure:React.ReactNode;figUnit:string;name:React.ReactNode;display?:React.ReactNode;rim?:[string,string,number][];calm:boolean;label:string;shake:{on:boolean;period:number;delay:number};shape?:string;gauge?:string}){
 const burst=fever&&!calm?fever.burst:null,[pop]=useState(()=>new Animated.Value(0)),[jolt]=useState(()=>new Animated.Value(0));
 // A burst: the dial jumps forward (1 → 1.07, back with a bounce, 0.6 s) and shakes (0.35 s).
 useEffect(()=>{if(!burst)return;pop.setValue(0);jolt.setValue(0);Animated.parallel([Animated.sequence([Animated.timing(pop,{toValue:1,duration:150,easing:Easing.out(Easing.quad),useNativeDriver:true}),
  Animated.timing(pop,{toValue:0,duration:450,easing:Easing.out(Easing.back(2.2)),useNativeDriver:true})]),Animated.timing(jolt,{toValue:1,duration:350,easing:Easing.linear,useNativeDriver:true})]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[burst?.key]);
 const J=[0,.2,.4,.6,.8,1],jump=[{translateX:jolt.interpolate({inputRange:J,outputRange:[0,-.012,.014,-.008,.006,0].map(v=>v*size)})},
  {translateY:jolt.interpolate({inputRange:J,outputRange:[0,.008,-.006,-.01,.011,0].map(v=>v*size)})},{scale:pop.interpolate({inputRange:[0,1],outputRange:[1,1.07]})}];
 const rotate=useNeedle(f,calm),wobble=useShimmer(shake.on&&!calm,shake.period,shake.delay),lit=f===null?0:Math.round(clamp(f)*96)/96;
 const small=size<280,tiny=size<200,fig=size*(small?.112:.135),at=(k:number)=>size*(.5+k),unitSize=Math.max(small?9.5:10.5,size*.04),nameSize=Math.max(small?9.5:10,size*.036);
 return <View accessible accessibilityRole="image" accessibilityLabel={label} style={{width:size,height:size,overflow:'visible'}}>
  {fever&&<FeverGlow size={size} level={fever.level} calm={calm}/>}
  <Animated.View style={[StyleSheet.absoluteFill,fever?{transform:jump}:null]}>
  <Svg width={size} height={size} viewBox="0 0 340 340"><Face id={id} lit={lit} tone={tone} scale={scale} unit={unit} rim={JSON.stringify(rim||[])} theme={quick.background} num={tiny?23:small?20:18}/></Svg>
  {shape==='glow'&&f!==null&&clamp(f)>=.002&&<Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={size} height={size} viewBox="0 0 340 340"><Path d={fan(f)} fill={gauge||quick.segmentOn} opacity={.13}/></Svg>}
  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{transform:[{rotate}]}]}><Animated.View style={[StyleSheet.absoluteFill,{transform:[{rotate:wobble}]}]}>
   <Svg width={size} height={size} viewBox="0 0 340 340"><Path d="M276 166 L318 168.8 L318 171.2 L276 174 Z" fill={RED}/></Svg></Animated.View></Animated.View>
  <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:at(0)-fig/2,height:fig,alignItems:'center',justifyContent:'center'}}>{shape==='plate'?<View style={{paddingVertical:size*.006,paddingHorizontal:size*.024,borderRadius:size*.026,borderWidth:1,borderColor:quick.line,backgroundColor:themeName()==='light'?'#1b2024':'#07090a'}}>{figure}</View>:figure}</View>
  <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:at(.102)-unitSize*.65,alignItems:'center'}}><Text numberOfLines={1} style={{fontSize:unitSize,fontWeight:'600',color:quick.ink,opacity:.84,paddingHorizontal:2}}>{figUnit}</Text></View>
  {!tiny&&<View style={{position:'absolute',left:size*.27,right:size*.27,top:at(.154)-nameSize*.65,alignItems:'center'}}>{name}</View>}
  {display&&!tiny&&<View style={{position:'absolute',left:size*.14,right:size*.14,top:at(.29)-size*.05,alignItems:'center'}}>{display}</View>}
  </Animated.View>
  {burst&&<FeverZap key={'z'+burst.key} size={size} burst={burst}/>}{burst&&<FeverBanner key={'b'+burst.key} size={size} burst={burst}/>}
 </View>;
}

/** A lit display on its own dark plate: the odometer or the range. */
// An early range edges its plate in red mixed half with black (cluster.css .cl-rng.early .cl-led).
const half=(c:string)=>'#'+[1,3,5].map(i=>Math.round(parseInt(c.slice(i,i+2),16)/2).toString(16).padStart(2,'0')).join('');
function Plate({children,style}:{children:React.ReactNode;style?:StyleProp<ViewStyle>}){return <View style={[st.plate,style]}>{children}</View>;}

/** The warning lights' symbols: working wears the sessions' working bars and waiting the warning triangle, so a light
 *  and the rows it filters look alike. */
function TellIcon({kind,color}:{kind:Tell;color:string}){
 const p={stroke:color,strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,fill:'none'};
 const body=(()=>{switch(kind){
  case 'waiting':return <><Path d="M12 3.6 21.6 20H2.4Z" {...p}/><Path d="M12 9.6v5" {...p}/><Circle cx={12} cy={17.2} r={.9} fill={color}/></>;
  case 'reconnect':return <><Path d="M10 14.2 8.1 16.1a3.3 3.3 0 0 1-4.7-4.7L5.3 9.5" {...p}/><Path d="M14 9.8l1.9-1.9a3.3 3.3 0 0 1 4.7 4.7l-1.9 1.9" {...p}/><Path d="M8.2 3.6v2.6M3.6 8.2h2.6M15.8 20.4v-2.6M20.4 15.8h-2.6" {...p}/></>;
  case 'empty':return <><Path d="M5 20.4V5.6A1.6 1.6 0 0 1 6.6 4h6.2a1.6 1.6 0 0 1 1.6 1.6v14.8M3.4 20.4h12.6M7.4 8.2h5" {...p}/><Path d="M14.4 10.6h1.4a1.4 1.4 0 0 1 1.4 1.4v4.2a1.5 1.5 0 0 0 3 0V8.6L18 6.4" {...p}/></>;
  case 'done':return <><Path d="M8.5 4H6.8A1.8 1.8 0 0 0 5 5.8v12.4A1.8 1.8 0 0 0 6.8 20h1.7M15.5 4h1.7A1.8 1.8 0 0 1 19 5.8v12.4a1.8 1.8 0 0 1-1.8 1.8h-1.7" {...p}/><Path d="M9 9h6M9 12h6M9 15h6" {...p}/></>;
  case 'working':return <Path d="M6.5 19v-6M12 19V5M17.5 19v-9" {...p} strokeWidth={3}/>;
  case 'live':return <><Path d="M5.2 18.8a9.6 9.6 0 0 1 0-13.6M18.8 5.2a9.6 9.6 0 0 1 0 13.6M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8" {...p}/><Circle cx={12} cy={12} r={1.5} fill={color}/></>;
 }})();
 return <Svg width={22} height={22} viewBox="0 0 24 24">{body}</Svg>;
}

/** A session's small gauge, as the menu bar draws it: its %/h on the burn dial's scale in its tool's colour, the hub
 *  lit green while it works and yellow while it waits. */
function Mini({value,max,color,state}:{value:number|null;max:number;color:string;state:string}){
 const f=valid(value)?clamp(value/Math.max(max,1e-4)):0,to=(180+180*f)*Math.PI/180,x1=13+11*Math.cos(to),y1=13+11*Math.sin(to),nx=13+8.5*Math.cos(to),ny=13+8.5*Math.sin(to);
 const hub=state==='working'?quick.segmentOn:state==='waiting'?quick.amber:quick.dim;
 return <Svg width={28} height={16} viewBox="0 0 26 15">
  <Path d="M2 13A11 11 0 0 1 24 13" stroke={quick.ink} strokeOpacity={.14} strokeWidth={3} strokeLinecap="round" fill="none"/>
  {f>0&&<Path d={`M2 13A11 11 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`} stroke={color} strokeWidth={3} strokeLinecap="round" fill="none"/>}
  {valid(value)&&<Line x1={13} y1={13} x2={nx} y2={ny} stroke={f>0?quick.ink:quick.dim} strokeWidth={1.4} strokeLinecap="round"/>}
  <Circle cx={13} cy={13} r={2.4} fill={hub}/></Svg>;
}

/** CPU or memory: the token lane's colours along a small arc, lit up to the reading, and a white needle. */
function Temp({id,label,value}:{id:string;label:string;value:number|null}){
 const v=value===null?0:Math.max(0,Math.min(100,value)),a=Math.PI*(1-v/100),x=40+32*Math.cos(a),y=40-32*Math.sin(a),hot=value!==null&&value>=85;
 return <View style={{alignItems:'center',gap:2}}>
  <Text style={st.label}>{label}</Text>
  <Svg width={56} height={32} viewBox="0 0 80 46">
   <Defs><LinearGradient id={'temp'+id} x1="8" x2="72" y1="0" y2="0" gradientUnits="userSpaceOnUse">{LANE.map(([o,c])=><Stop key={o} offset={o} stopColor={c}/>)}</LinearGradient></Defs>
   <Path d="M8 40 A32 32 0 0 1 72 40" stroke={`url(#temp${id})`} strokeOpacity={.2} strokeWidth={5} strokeLinecap="round" fill="none"/>
   {v>0&&<Path d={`M8 40 A32 32 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} stroke={`url(#temp${id})`} strokeWidth={5} strokeLinecap="round" fill="none"/>}
   <Line x1={40} y1={40} x2={40+26*Math.cos(a)} y2={40-26*Math.sin(a)} stroke={quick.ink} strokeWidth={2.2} strokeLinecap="round"/><Circle cx={40} cy={40} r={3.5} fill={quick.ink}/></Svg>
  <Text style={[st.temp,hot&&{color:quick.red}]}>{value===null?'—':Math.round(value)+'%'}</Text></View>;
}

/** The token flow page's bars: the period's bins by tool, oldest at left. */
function FlowBars({flow,width}:{flow?:Flow;width:number}){
 const bins=(flow?.bins||[]).map(b=>Object.entries(b||{}).filter(([,v])=>valid(v)&&v>0) as [string,number][]),totals=bins.map(b=>b.reduce((n,[,v])=>n+v,0)),top=Math.max(1,...totals),h=96,n=Math.max(1,bins.length),bw=width/n;
 return <Svg width={width} height={h}>
  {[.25,.5,.75].map(f=><Line key={f} x1={0} x2={width} y1={h*f} y2={h*f} stroke={quick.grid} strokeWidth={.6} strokeDasharray="2 3"/>)}
  {bins.map((parts,i)=>{let y=h;return <G key={i}>{parts.map(([kind,v])=>{const bh=v/top*(h-6),r=<Path key={kind} d={`M${(i*bw+bw*.12).toFixed(2)} ${(y-bh).toFixed(2)}h${(bw*.76).toFixed(2)}v${bh.toFixed(2)}h${(-bw*.76).toFixed(2)}Z`} fill={toolColor(kind)}/>;y-=bh;return r;})}</G>;})}
 </Svg>;
}

// A gauge's two lines (cluster.js kit): the tool's short name, and the plan, or the account's models when it has none.
const toolShort=(kind:string)=>({Claude:'Claude',Codex:'Codex',Antigravity:'Agy',GLM:'GLM'} as Record<string,string>)[kind]||toolName(kind);
const planOf=(a:{plan:string|null;alias:string|null})=>a.plan||(a.alias||'').replace(/\s+models?$/i,'').replace(/^Claude and GPT$/i,'Claude·GPT');
// Under a gauge the plan stays one short word, as the web writes it (Max, Pro, Biz; an Agy pool by its last name,
// Gemini 4 Argon as Argon), so nothing is cut short.
const briefOf=(a:{plan:string|null;alias:string|null})=>{const whole=planOf(a),last=/\s/.test(whole)?whole.split(/\s+/).pop()||'':whole,cap=last.charAt(0).toUpperCase()+last.slice(1);
 return ({Business:'Biz',Enterprise:'Ent'} as Record<string,string>)[cap]||cap;};
const midnight=()=>{const d=new Date(shownNow());d.setHours(0,0,0,0);return Math.floor(d.getTime()/1000);};
// claude-opus-4-7 → Opus 4.7, gpt-6.1 → GPT-6.1, for the burn dial's name line (cluster.js modelName).
const modelName=(m:string)=>{const s=m.replace(/\[1m\]/gi,'').replace(/^claude-/,'').replace(/^gpt-/,'GPT-'),c=/^(opus|sonnet|haiku|fable)-(\d+)-(\d+)/.exec(s);return c?c[1][0].toUpperCase()+c[1].slice(1)+' '+c[2]+'.'+c[3]:s;};

/** The warning lights in the shape chosen (customizing, cluster.css data-lamps): label (the default, its name under each
 *  light), strip (the lights alone), count (the count beside a lit one), badge (on its corner), lens (each behind its
 *  own lens, two rows of three) or chips (only what needs a hand, named). The first count of them show. */
function Lights({shape,count,room,tells,only,late,press,landscape}:{shape:string;count:number;room:number;tells:{k:Tell;n:number}[];only:Tell|null;late:boolean;press:(k:Tell)=>void;landscape?:boolean}){
 const {t}=useSay(),work=quick.segmentOn,off='#454d53',color=(k:Tell)=>k==='live'&&late?'#ff4d40':TELLS.find(x=>x[0]===k)?.[3]||work;
 const name=(k:Tell)=>{const x=TELLS.find(y=>y[0]===k);return k==='live'&&late?t('Collection delayed','수집 지연'):x?t(x[1],x[2]):k;};
 if(shape==='chips'){
  // Chips: working and just done as notes, then the account troubles and late collection, each only while it has something.
  const CHIP:[Tell,string,string][]=[['working','Working','작업 중'],['done','Just done','방금 완료'],['waiting','Waiting','응답 대기'],['reconnect','Sign in','재로그인'],['empty','Low limit','한도 부족'],['live','Collection delayed','수집 지연']];
  const lit=CHIP.filter(([k])=>k==='live'?late:(tells.find(x=>x.k===k)?.n||0)>0);if(!lit.length)return null;
  const wide=Math.min(room,340),chipW=Math.floor((wide-6)/2);
  return <View accessibilityRole="toolbar" accessibilityLabel={t('Warning lights','경고등')} style={[st.chips,{width:wide}]}>{lit.map(([k,en,ko])=>{const n=tells.find(x=>x.k===k)?.n||0,c=k==='live'?'#ff4d40':color(k),label=t(en,ko);
   return <Pressable key={k} accessibilityRole="button" accessibilityLabel={label+(n?' '+n:'')} accessibilityState={{selected:only===k,disabled:k==='live'||!n}} onPress={()=>press(k)}
    style={[st.chip,{width:chipW,borderColor:c+'73'},only===k&&{borderColor:c,backgroundColor:c+'1f'}]}>{k==='working'||k==='done'?<View style={[st.dot,{backgroundColor:c}]}/>:<View style={{width:16,height:16,alignItems:'center',justifyContent:'center'}}><View style={{transform:[{scale:.73}]}}><TellIcon kind={k} color={c}/></View></View>}
    <Text numberOfLines={1} style={st.chipText}>{label}{n?<Text style={[st.chipText,{color:c,fontWeight:'700'}]}> {n}</Text>:null}</Text></Pressable>;})}</View>;
 }
 const list=tells.slice(0,count),cell=landscape?Math.min(52,M.tellCell(shape,list.length,room)):M.tellCell(shape,list.length,room),lens=shape==='lens';
 return <View accessibilityRole="toolbar" accessibilityLabel={t('Warning lights','경고등')} style={[st.tells,shape!=='label'&&{gap:4,paddingHorizontal:10,paddingVertical:6},lens&&{flexDirection:'row',flexWrap:'wrap',width:3*44+2*6+16+2,gap:6,paddingHorizontal:8,paddingVertical:8}]}>{list.map(({k,n})=>{
  const lit=k==='live'||n>0,c=color(k),label=name(k),ink=lit?c:off,tone=shape==='label';
  return <Pressable key={k} accessibilityRole="button" accessibilityLabel={label+(n?' '+n:'')} accessibilityState={{selected:only===k,disabled:k==='live'||!n}} onPress={()=>press(k)}
   style={[st.tell,{width:tone?cell:lens?44:shape==='count'&&lit&&n>0?cell:Math.min(36,cell),height:tone?46:lens?38:34},shape==='count'&&lit&&n>0&&{flexDirection:'row',gap:3},
    lens&&{borderColor:lit?c+'73':'#1b2125',overflow:'hidden'},only===k&&{backgroundColor:c+'29',borderColor:c+'99'}]}>
   {lens&&<Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={44} height={38}><Defs><RadialGradient id={'lens'+k} cx="50%" cy={lit?'40%':'35%'} r="70%"><Stop offset={0} stopColor={lit?c:'#15191c'} stopOpacity={lit?.18:1}/><Stop offset={1} stopColor="#080a0b"/></RadialGradient></Defs><Rect width={44} height={38} fill={`url(#lens${k})`}/></Svg>}
   {!tone&&!lens&&lit&&<View pointerEvents="none" style={{position:'absolute',width:26,height:26,borderRadius:13,backgroundColor:c+'1c'}}/>}
   <TellIcon kind={k} color={ink}/>
   {tone&&<Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} style={[st.tellLabel,{color:ink}]}>{label}</Text>}
   {n>0&&(tone?<Text style={[st.tellCount,{color:c}]}>{n}</Text>:shape==='count'?<Text style={{fontSize:13,fontWeight:'800',color:c}}>{n}</Text>
    :shape==='badge'?<View style={[st.badge,{backgroundColor:c}]}><Text style={st.badgeText}>{n}</Text></View>:lens?<Text style={[st.tellCount,{top:undefined,bottom:2,right:4,color:c}]}>{n}</Text>:null)}</Pressable>;})}</View>;
}

/** The cluster tab: the cluster preset, customized in place. */
export function Cluster(){const scroll=useRef<ScrollViewInstance>(null);return <Editor screen="cluster" preset="cluster" scrollRef={scroll}><ClusterView scrollRef={scroll}/></Editor>;}
/** The cluster, as its tab or (embedded) under the dashboard's header when one tab holds both presets. On its side it
 *  fills the screen either way. */
export function ClusterView({scrollRef,embedded}:{scrollRef?:React.RefObject<ScrollViewInstance|null>;embedded?:boolean}){
 const w=useWorkspace(),t=w.t,period:WindowKey=w.period,calm=useCalm(),{width,height}=useWindowDimensions(),inset=useSafeAreaInsets(),focused=useIsFocused();
 const L=useLayout(),g=L.state.layout.presets.cluster,edit=useEditor(),quiet=useQuiet();
 const [hold]=useState<Hold>(()=>({})),[pick,setPickState]=useState<Pick>(null),[only,setOnly]=useState<Tell|null>(null),[mode,setModeState]=useState<Mode>('sessions');
 const [trip,setTrip]=useState<number|null>(null),[detail,setDetail]=useState<SessionRow|null>(null);
 const [wrapKey,setWrapKey]=useState(''),modesBox=useRef({w:0,content:0,wk:'',ck:''}),look=useClusterTheme(),[big,setBig]=useState(false);
 const visible:Device[]=w.visible||[],at=w.clock/1000;
 // The page and the trip are kept on this phone; the first visit starts the trip at midnight.
 useEffect(()=>{Promise.all([SecureStore.getItemAsync(SAVED.mode),SecureStore.getItemAsync(SAVED.trip)]).then(([m,tr])=>{
  if(MODES.some(([k])=>k===m))setModeState(m as Mode);const n=Number(tr);
  if(n>0&&n<=shownNow()/1000)setTrip(n);else{const start=midnight();setTrip(start);SecureStore.setItemAsync(SAVED.trip,String(start)).catch(()=>{});}}).catch(()=>setTrip(midnight()));},[]);
 const setMode=(m:Mode,keep=false)=>{setModeState(m);if(!keep)setOnly(null);SecureStore.setItemAsync(SAVED.mode,m).catch(()=>{});};
 const setPick=quiet((p:Pick)=>setPickState(p));
 const resetTrip=quiet(()=>{const start=Math.floor(shownNow()/1000);setTrip(start);SecureStore.setItemAsync(SAVED.trip,String(start)).catch(()=>{});});
 const sessionOnly:Only=only==='working'||only==='waiting'||only==='done'?only:null;
 const state=clusterState(visible,at*1000),r:Readings=readings(state,{period,now:at,pick,only:sessionOnly,trip:trip!==null&&trip<=at?trip:null,sessions:state.root_sessions,hold,rate:w.demo?pinnedTachRate():null,burn:w.demo?pinnedBurnRate():null});
 // Each dial's fever on its own: entering a higher level (the first reading past the limit too) bursts once for 2.2 s.
 const level=feverLevel(r.tach.full),burst=useFever(level,calm),burnFever=burnLevel(r.speed.max),burnBurst=useFever(burnFever,calm);
 const count=(k:Tell)=>k==='working'?r.working:k==='live'?0:(r.tells[k] as string[]).length,late=!r.tells.fresh,left=only?count(only):0;
 // A pick that left the readings lets the burn dial go back to every AI; a pressed light with nothing left lets go.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(pick&&!r.speed.picked)setPickState(null);if(only&&!left)setOnly(null);},[pick,r.speed.picked,only,left]);
 // Between readings the odometer and the trip run on at the last minute's rate (the odometer turns every three
 // seconds); with less motion asked for, or a demo held for filming, they wait.
 const [real,setReal]=useState(0),running=!calm&&!(w.demo&&heldDemo()!==null);
 useEffect(()=>{if(!running)return;const id=setInterval(()=>setReal(Date.now()/1000),1000);return()=>clearInterval(id);},[running]);
 const el=running&&real>0?Math.min(30,Math.max(0,real-state.updated)):0,odo=r.tach.tokens===null?null:r.tach.tokens+r.tach.climb*el;
 const add=valid(r.tach.instant)?r.tach.instant/HOUR*el:0,tr=r.trip,tripTokens=tr?.inRange&&tr.tokens!==null?tr.tokens+add:null;
 const loc=locale(w.lang),caption=t('Last ','최근 ')+periodLabel(period,t),percent=(n:number|null|undefined)=>pctNumber(n)+(valid(n)?'%':'');
 const burnText=(n:number|null|undefined)=>valid(n)?(n>=100?String(Math.round(n)):n>=10?n.toFixed(1):n.toFixed(2))+t('%/h','%/시간'):'—';
 const rowOf=(id:string)=>(w.rows as SessionRow[]).find(x=>x.key===id)||null,name=(s:ClusterSession)=>s.display_name||(s.terminal||'').trim()||(s.project==='0'&&s.kind==='Aside'?t('Aside default workspace','Aside 기본 작업공간'):s.project)||toolName(s.kind);
 // The theme's figures, sent again for a new report, period, pick, pressed light, trip or language.
 const themeFig=()=>themeFigures(r,state,{now:at,odo,name}),stamp=[state.updated,period,pick?pick.type+pick.id:'',only||'',trip??'',w.lang].join('|');
 useEffect(()=>{shownFigures.current=themeFig;});
 const press=quiet((k:Tell)=>{if(k==='live'||!count(k))return;const next=only===k?null:k;setOnly(next);setMode(k==='reconnect'||k==='empty'?'weekly':'sessions',true);});
 // A theme's light shows what it is about (closing the full screen to show it), its gear the period, its trip resets.
 const themePress=(p:ThemePress)=>{
  if('alert' in p){const k=TELLS.find(([x])=>x===p.alert)?.[0];if(k&&k!=='live'&&count(k)){press(k);setBig(false);}}
  else if('period' in p){const k=PERIOD_NAMES.find(([x])=>x===p.period)?.[0];if(k)quiet(()=>w.setPeriod(k))();}
  else if('trip' in p)resetTrip();};
 const work=quick.segmentOn;
 // The layout (customizing): the dials' size, face and display colour, the lights' shape and count, the odometer's face,
 // the fuel's count, the window's size and pages, the period control's shape.
 const dialK=M.DIAL_K[M.sizeOf(g,'dials')],winK=M.WIN_K[M.sizeOf(g,'window')],face=g.opts.dials?.shape||'ring',led=LED[g.opts.dials?.needle||'default']||LED.default;
 const lamps=g.opts.alerts?.shape||'label',lampCount=g.opts.alerts?.count??6,odoFace=g.opts.odo?.shape||'drum',tabs=M.windowTabs(g,MODES),shownMode=M.windowPage(g,MODES,mode);

 // Layout: on its side the cluster fills the screen (no status bar, no tabs) with three axes, the dials taking what the
 // centre column and the lower row leave; upright the dials sit side by side on top.
 // Sideways, as the web's wide layout (cluster.css): the centre column at least 300 (32% of the width, at most 360), the
 // dial what the width leaves beside it or the height less the lower row, whichever is smaller, and the centre column
 // the rest; the lower row's ends may reach past their dial into the gap beside it (spill). Sized from the screen
 // area actually given, so the three axes and the lower row always sit inside it.
 const landscape=width>height&&height<600,[box,setBox]=useState<{w:number;h:number}|null>(null),OUT=8,PX=24,PT=10,COL=16,GAP=8,FOOT=84,spill=16;
 const room=width-inset.left-inset.right,housingW=landscape?(box?.w??room)-2*OUT-2*PX-2:Math.min(room,820)-32-28,housingH=(box?.h??height-inset.top-inset.bottom)-2*OUT-2*PT-2;
 const mid=landscape?Math.max(300,Math.min(360,housingW*.32)):0;
 const full=Math.floor(landscape?Math.max(150,Math.min((housingW-mid-2*COL)/2,housingH-FOOT-GAP)):(housingW-10)/2),dial=Math.floor(full*dialK);
 // With a theme on its side the window and the fuel share the row under it.
 const tFoot=Math.floor(Math.min(320,housingW*.34)),themeSide=landscape&&!!look;
 const winW=themeSide?housingW-(g.hidden.includes('fuel')?0:tFoot+COL):landscape?housingW-2*dial-2*COL:housingW;
 // The edit mode belongs to the upright screen.
 useEffect(()=>{if(landscape&&edit?.on)edit.close();},[landscape,edit]);
 // Under a theme's instruments the odometer joins the trip in the lower row.
 const working=r.working>0,odoInDial=!look&&dial>=220,plateH=Math.max(13,Math.min(20,dial*.052));
 // Token dial: the period's average in tokens an hour on the lane; the figure in the colour at the reading.
 const div=r.tach.full>=1e9?1e9:1e6,tachF=r.tach.rate===null?null:r.tach.rate/r.tach.full,tachColor=tachF===null?quick.muted:colorAt(LANE,tachF);
 const odometer=(h:number,kind=odoFace)=><Plate style={kind==='drum'?drumPlate(h):undefined}><Odometer key={period} value={odo} height={h} color="#eef2f4" calm={calm} face={kind} led={led}/></Plate>;
 // Burn dial: one tone, the accent for every AI, the tool's colour (a little lifted) for a session or an account.
 const sub=r.speed.subject,acct=sub&&r.accounts.find(a=>a.id===sub.account),tone=sub&&sub.type!=='all'&&sub.kind?lift(toolColor(sub.kind)):MINT;
 const s=sub?.session,reach=r.speed.reach;
 const subjectLine=!sub||sub.type==='all'?<Text numberOfLines={1} style={st.name}>{t('Limit burn','한도 소진')}<Text style={[st.name,{color:MINT}]}>{' · '+t('All AI','전체 AI')}</Text></Text>
  :<Pressable accessibilityRole="button" accessibilityLabel={t('Back to all AI','전체 AI로 돌아가기')} onPress={()=>setPick(null)} style={{flexDirection:'row',alignItems:'center',gap:5,maxWidth:'100%'}}>
   <View style={[st.dot,{backgroundColor:toolColor(sub.kind||'')}]}/>
   {sub.type==='session'&&s?<><Text numberOfLines={1} style={[st.name,{color:quick.ink,flexShrink:1}]}>{s.model?modelName(s.model):name(s)}</Text>{!!s.effort&&<Text style={st.effort}>{s.effort}</Text>}</>
    :<><Text numberOfLines={1} style={[st.name,{color:quick.ink}]}>{acct?toolShort(acct.kind):toolName(sub.kind||'')}</Text>{!!acct&&!!planOf(acct)&&<Text style={st.name}>{planOf(acct)}</Text>}</>}</Pressable>;
 const range=<View style={{alignItems:'center',gap:3}}>{reach.state==='reconnect'?<Text style={[st.dispLabel,{color:quick.amber}]}>{t('Sign-in needed','재로그인 필요')}</Text>:<>
  <Text style={[st.dispLabel,reach.early&&{color:quick.red}]}>{t('Time left','작업 가능')}</Text>
  <View style={{flexDirection:'row',alignItems:'flex-end',gap:5}}><Plate style={[odoFace==='drum'&&drumPlate(plateH),reach.early&&{borderColor:half(quick.red)}]}>{odoFace==='drum'?<RangeWheels hours={reach.hours} height={plateH} calm={calm}/>:<Lcd cells={rangeCells(reach.hours)} height={plateH} color={led}/>}</Plate><Text style={[st.dispLabel,{paddingBottom:3}]}>{t('h','시간')}</Text></View></>}</View>;

 const dials=(size:number,shape:string)=>{const sm=size<280,lh=size*(sm?.112:.135),ph=Math.max(13,Math.min(20,size*.052)),inDial=size>=220&&!g.hidden.includes('odo');return [
  <Dial key="t" id="t" size={size} f={tachF} tone={null} scale={tachMarks(r.tach.full,div)} unit={div===1e9?'B':'M'} fever={{level,burst}} shape={shape} gauge={tachColor}
   figure={<Lcd cells={tokenCells(r.tach.rate)} height={lh} color={tachColor}/>} figUnit={t('tokens/h','tokens/시간')} name={<Text style={st.name}>{t('Token speed','토큰 속도')}</Text>}
   display={inDial?<View style={{alignItems:'center',gap:3}}>{size>=280&&<Text style={st.dispLabel}>{t('Total','합계')}</Text>}{odometer(ph)}</View>:undefined}
   calm={calm} shake={{on:working,period:2300,delay:0}} label={t('Token speed','토큰 속도')+' '+(r.tach.rate===null?'—':fmt(r.tach.rate,loc))+' '+t('tokens/h','tokens/시간')}/>,
  <Dial key="s" id="s" size={size} f={r.speed.value===null?null:r.speed.value/r.speed.max} tone={tone} scale={burnMarks(r.speed.max)} unit="" fever={{level:burnFever,burst:burnBurst}} shape={shape} gauge={tone}
   figure={<Lcd cells={burnCells(r.speed.value)} height={lh} color={r.speed.value===null?quick.muted:tone}/>} figUnit={t('%/h','%/시간')} name={subjectLine} display={range}
   rim={(r.speed.multi||[]).map(m=>[m.id,toolColor(m.kind),m.value] as [string,string,number])} calm={calm} shake={{on:working,period:3100,delay:1200}} label={t('Limit burn','한도 소진')+' '+burnText(r.speed.value)}/>];};

 // Warning lights: every light in its place, dark until it has something to tell; pressing a lit one shows only what it is about.
 const tells=TELLS.map(([k])=>({k,n:count(k)})),lightsFor=(shape:string,room:number)=><Lights shape={shape} count={lampCount} room={room} tells={tells} only={only} late={late} press={press} landscape={landscape}/>;
 // CPU and memory with the trip, under the token dial; side by side the temperatures give way.
 const cpu=r.heat.computers.map(c=>c.cpu).filter(valid),mem=r.heat.computers.map(c=>c.memory).filter(valid);
 const since=tr?new Date(tr.start*1000):null,today=since&&since.toDateString()===new Date(shownNow()).toDateString();
 // English puts the word first (since 09:00); Korean and Chinese after (09:00부터, 09:00起).
 const sinceAt=since?since.toLocaleString(loc,{...(today?{}:{month:'numeric',day:'numeric'}),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'',sinceText=w.lang==='en'?'since '+sinceAt:sinceAt+t('since','부터');
 const lowerFor=(kind:string)=><>
  {landscape&&<><Temp id="cpu" label="CPU" value={cpu.length?Math.max(...cpu):null}/><Temp id="mem" label={t('Memory','메모리')} value={mem.length?Math.max(...mem):null}/></>}
  {!odoInDial&&<View style={{alignItems:'center',gap:4}}><Text style={st.dispLabel}>{t('Total','합계')}</Text>{odometer(15,kind)}</View>}
  <View style={{alignItems:'center',gap:4}}><Text style={st.trip}>{t('Trip','트립')+' '}<Text style={[st.trip,{color:quick.ink,fontWeight:'700'}]}>{tr?.inRange?short(tripTokens):'—'}</Text> tokens</Text>
   <View style={{flexDirection:'row',alignItems:'center',gap:6}}>{since&&<Text style={st.trip}>{sinceText}</Text>}
    <Pressable accessibilityRole="button" onPress={resetTrip} style={st.reset}><Text style={st.trip}>{t('Reset','리셋')}</Text></Pressable></View></View></>;
 // Fuel: as many gauges as the row holds (up to eight, or the count chosen), spaced by how many show, then +N. Agy
 // reports a pool for each model family; one gauge stands for them all, the pool nearest its end.
 const agy=r.accounts.filter(a=>a.kind==='Antigravity'),lead=agy.length>1?[...agy].sort((a,b)=>(a.left??101)-(b.left??101))[0]:null;
 const gauges=lead?r.accounts.filter(a=>a.kind!=='Antigravity'||a===lead):r.accounts;
 const fuelRoom=themeSide?tFoot:landscape?dial+2*spill-8:housingW,cans=M.fuelCans(fuelRoom,gauges.length,g.opts.fuel?.count);
 const shown=pickTiles(gauges,cans),more=gauges.length-shown.length,pitch=M.PITCH[Math.max(2,cans)];
 const fuel=<><Text style={st.label}>{r.accounts.some(a=>!a.weekly)?t('Limit left','남은 한도'):t('Weekly limit left','남은 주간 한도')}{more>0&&<Text style={[st.label,{color:quick.ink}]}> +{more}</Text>}</Text>
  {r.accounts.length?<View style={{flexDirection:'row',justifyContent:'center'}}>{shown.map(a=>{const on=r.speed.account===a.id&&r.speed.picked,low=a.left!==null&&a.left<15,color=toolColor(a.kind),plan=briefOf(a);
   const others=a===lead?agy.filter(x=>x!==a).map(x=>', '+planOf(x)+' '+(x.left===null?'—':percent(x.left))).join(''):'';
   return <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={toolName(a.kind)+' '+planOf(a)+' '+(a.left===null?'—':percent(a.left))+others} accessibilityState={{selected:on}} onPress={()=>setPick(on?null:{type:'account',id:a.id})} style={{width:pitch,alignItems:'center',gap:4}}>
    <View style={[st.can,landscape&&{height:34},a.reconnect&&{borderWidth:1,borderColor:quick.amber},on&&{borderWidth:1.5,borderColor:color}]}><View style={{position:'absolute',left:0,right:0,bottom:0,height:`${a.left===null?0:a.left}%`,backgroundColor:low?quick.amber:color,opacity:a.current?1:.45}}/></View>
    <View style={{alignItems:'center'}}><Text numberOfLines={1} style={[st.canTool,{color}]}>{toolShort(a.kind)}</Text><Text numberOfLines={1} style={[st.canPlan,cans>=7&&{fontSize:10.5}]}>{plan||'—'}</Text></View></Pressable>;})}</View>
   :<Text style={st.tiny}>{t('No subscription accounts connected.','연결된 구독 계정이 없습니다.')}</Text>}</>;

 // The window: seven pages (or those chosen), under the period control.
 const flow=fleetFlow(reporting(visible),period),pageH=themeSide?180:landscape?Math.max(100,dial-122):Math.round(300*winK);
 const cards=only==='reconnect'||only==='empty'?r.accounts.filter(a=>(r.tells[only] as string[]).includes(a.id)):r.accounts;
 const when=(sec:number)=>{const d=new Date(sec*1000);return d.toLocaleDateString(loc,{weekday:'short'})+' '+d.toLocaleTimeString(loc,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});};
 const goals=visible.flatMap(d=>d.snapshot.operations?.goals||[]);
 const GOAL:Record<string,[string,string]>={active:[t('Active','활성'),work],complete:[t('Done','완료','完成'),MINT],paused:[t('Paused','일시정지'),quick.amber],blocked:[t('Blocked','차단됨'),quick.red],cleared:[t('Cleared','해제됨'),quick.muted],
  failed:[t('Not achieved','달성 불가'),quick.red],budget_limit:[t('Budget limit','예산 한도'),quick.red],usage_limit:[t('Usage limit','사용 한도'),quick.red]};
 const page=(()=>{switch(shownMode){
  case 'sessions':return r.sessions.length?r.sessions.map(x=>{const ss=x.session,on=r.speed.session===x.id,color=toolColor(ss.kind);
   return <Pressable key={x.id} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>setPick(on?null:{type:'session',id:x.id})} style={[st.session,on&&{borderColor:MINT+'88',backgroundColor:MINT+'14'}]}>
    <View style={{width:56,alignItems:'center',gap:1}}><Mini value={x.burn} max={r.speed.max} color={color} state={x.state}/><Text numberOfLines={1} style={st.pace}>{burnText(x.burn)}</Text></View>
    <View style={{flex:1,minWidth:0,gap:2}}><View style={{flexDirection:'row',alignItems:'center',gap:6}}><StateMark status={x.state}/><Text numberOfLines={1} style={[st.sessionName,{flexShrink:1}]}>{name(ss)}</Text></View>
     <View style={{flexDirection:'row',alignItems:'center',gap:6}}><Text numberOfLines={1} style={[st.tiny,{color,fontWeight:'600'}]}>{toolName(ss.kind)}</Text>{!!ss.effort&&<Text style={st.effort}>{ss.effort}</Text>}</View></View>
    <Text style={st.fig}>{x.estimate!==null?(x.estimate<.1?'':'≈')+percent(x.estimate):fmt(x.tokens,loc)+' tokens'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Session details','세션 상세')} hitSlop={8} onPress={quiet(()=>{const row=rowOf(x.id);if(row)setDetail(row);})} style={{paddingHorizontal:2}}><Text style={{color:quick.dim,fontSize:14}}>↗</Text></Pressable></Pressable>;})
   :<Text style={st.empty}>{only?t('No matching sessions.','해당하는 세션이 없습니다.'):t('No sessions.','세션이 없습니다.')}</Text>;
  case 'flow':return <View style={{gap:8}}><View style={{flexDirection:'row',alignItems:'baseline',gap:6}}><Text style={st.big}>{fmt(odo,loc)}</Text><Text style={st.tiny}>tokens · {caption}</Text></View>
   <View style={{flexDirection:'row',alignItems:'center',gap:10,flexWrap:'wrap'}}><Text style={st.section}>{t('By AI','AI별')}</Text>{[...new Set((flow?.bins||[]).flatMap(b=>Object.keys(b||{})))].map(k=><View key={k} style={{flexDirection:'row',alignItems:'center',gap:4}}><View style={[st.square,{backgroundColor:toolColor(k)}]}/><Text style={st.tiny}>{toolName(k)}</Text></View>)}</View>
   <FlowBars flow={flow} width={winW-24}/>
   <Text style={st.section}>{t('By project','프로젝트별')}</Text><Text style={st.empty}>{t('Not available in the remote workspace yet.','원격 워크스페이스에서는 아직 지원하지 않습니다.')}</Text></View>;
  case 'weekly':return cards.length?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{cards.map(a=>{const on=r.speed.account===a.id&&r.speed.picked,color=toolColor(a.kind),cw=winW>460?(winW-24-8)/2:winW-24;
   return <Pressable key={a.id} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>setPick(on?null:{type:'account',id:a.id})} style={[st.card,{width:cw},on&&{borderColor:MINT+'88',backgroundColor:MINT+'12'}]}>
    <View style={{flexDirection:'row',alignItems:'center',gap:6}}><Text style={[st.tiny,{color,fontWeight:'700'}]}>{toolShort(a.kind)}</Text>{!!planOf(a)&&<Text style={st.tiny}>{planOf(a)}</Text>}{!!a.window&&!a.weekly&&<Text style={st.tiny}>{a.window}</Text>}<View style={{flex:1}}/>{!!a.who&&a.who.toLowerCase()!==String(a.alias||'').toLowerCase()&&<Text numberOfLines={1} style={[st.tiny,{color:quick.dim,flexShrink:1}]}>{a.who}</Text>}</View>
    <View style={{flexDirection:'row',alignItems:'baseline',gap:6}}><Text style={st.big}>{percent(a.pct)}</Text><Text style={st.tiny}>{t('used','사용')}</Text></View>
    <View style={st.bar}><View style={{width:`${a.pct===null?0:Math.min(100,a.pct)}%`,height:'100%',backgroundColor:color,opacity:a.current?1:.45}}/></View>
    <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:4}}>{a.reconnect?<Text style={[st.tiny,{color:quick.amber,fontWeight:'600'}]}>{t('Sign-in needed','재로그인 필요')}</Text>
     :<Text style={st.tiny}>{caption} <Text style={[st.tiny,{fontWeight:'700',color}]}>{a.added===null?'—':'+'+percent(a.added)}</Text></Text>}
     {valid(a.burn)&&<Text style={st.tiny}>{t('Average','평균')+' '}<Text style={[st.tiny,{fontWeight:'700',color:quick.ink}]}>{burnText(a.burn)}</Text></Text>}</View>
    {!a.range?null:a.range.state==='idle'?<Text style={[st.tiny,{color:quick.dim}]}>{t('Not in use now','지금은 쓰지 않음')}</Text>:a.range.state==='enough'?<Text style={[st.tiny,{color:MINT}]}>{t('Lasts until the reset','초기화 전까지 충분')}</Text>
     :<Text style={[st.tiny,{color:a.range.early?quick.red:quick.muted}]}>{t('At this rate','이 속도면')+' '}<Text style={[st.tiny,{fontWeight:'700',color:a.range.early?quick.red:quick.ink}]}>{a.range.at===null?"—":when(a.range.at)}</Text>{' '+t('runs out','바닥')}</Text>}</Pressable>;})}</View>
   :<Text style={st.empty}>{t('No subscription accounts connected.','연결된 구독 계정이 없습니다.')}</Text>;
  case 'map':{const data=usage(w.rows||[],period,'session',t);return <View style={{gap:8}}><Text style={st.tiny}><Text style={[st.tiny,{color:quick.ink,fontWeight:'700'}]}>{fmt(data.sum,loc)}</Text> tokens · {caption}</Text><UsageMap items={data.items}/></View>;}
  case 'heat':return <Text style={st.empty}>{t('Not available in the remote workspace yet.','원격 워크스페이스에서는 아직 지원하지 않습니다.')}</Text>;
  case 'goals':return goals.length?<View style={{gap:6}}>{goals.map((g,i)=>{const [label,c]=GOAL[g.status]||[g.status,quick.muted];
   return <View key={i} style={st.goal}><Text style={[st.goalStatus,{color:c,backgroundColor:c+'26'}]}>{label}</Text><Text style={st.tiny}>{g.runtime}{valid(g.tokens_used)?' · '+fmt(g.tokens_used,loc)+' tokens':''}</Text></View>;})}</View>
   :<Text style={st.empty}>{t('No goals recorded.','기록된 목적지가 없습니다.')}</Text>;
  case 'system':return <View style={{gap:6}}>
   <View style={[st.proc,{opacity:.7}]}><Text style={[st.tiny,{flex:1}]}>{t('Computer','컴퓨터')}</Text><Text style={[st.tiny,st.col]}>CPU</Text><Text style={[st.tiny,st.col]}>{t('Memory','메모리')}</Text></View>
   {r.heat.computers.length?r.heat.computers.map((c,i)=><View key={c.id||i} style={st.proc}><Text numberOfLines={1} style={[st.sessionName,{flex:1,fontSize:12.5}]}>{c.name||t('Computer','컴퓨터')}</Text><Text style={[st.fig,st.col]}>{c.cpu==null?'—':c.cpu.toFixed(1)+'%'}</Text><Text style={[st.fig,st.col]}>{c.memory==null?'—':c.memory.toFixed(1)+'%'}</Text></View>)
    :<Text style={st.empty}>{t('No resource records.','리소스 기록이 없습니다.')}</Text>}</View>;
 }})();
 const periodIndex=Math.max(0,PERIOD_NAMES.findIndex(([k])=>k===period)),periodLabels=PERIOD_NAMES.map(([,en,ko])=>t(en,ko));
 const periods=(kind:string,wd:number)=><PeriodDial kind={kind} index={periodIndex} width={wd} labels={periodLabels} pick={quiet((i:number)=>w.setPeriod(PERIOD_NAMES[i][0]))} calm={calm}/>;
 // The page names stay in one row when they fit and take two when they do not, as on the web: measured once per
 // language, width and set of pages.
 const modesKey=w.lang+'|'+winW+'|'+tabs.length,wrapModes=wrapKey===modesKey;
 // Each size counts only for what it was measured under (the width for the row, the language, width and pages for
 // the names): a turn of the phone leaves the other width's sizes behind.
 const overflow=()=>{const b=modesBox.current;if(b.wk===String(winW)&&b.ck===modesKey&&b.w>0&&b.content>b.w+1&&wrapKey!==modesKey)setWrapKey(modesKey);};
 const tabButtons=tabs.map(([k,en,ko])=><Pressable key={k} accessibilityRole="tab" accessibilityState={{selected:shownMode===k}} onPress={quiet(()=>setMode(k))} style={[st.mode,wrapModes&&{flexBasis:'22%'},shownMode===k&&{backgroundColor:quick.raised}]}><Text numberOfLines={1} style={[st.modeText,shownMode===k&&{color:quick.ink}]}>{t(en,ko)}</Text></Pressable>);
 const windowBox=<View style={[st.window,{width:winW}]}>
  {wrapModes?<View style={[st.modes,{flexWrap:'wrap',rowGap:2}]}>{tabButtons}</View>
   :<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.modes} onLayout={e=>{modesBox.current.w=e.nativeEvent.layout.width;modesBox.current.wk=String(winW);overflow();}} onContentSizeChange={cw=>{modesBox.current.content=cw;modesBox.current.ck=modesKey;overflow();}}>{tabButtons}</ScrollView>}
  <ScrollView nestedScrollEnabled style={{height:pageH}} contentContainerStyle={{gap:2,paddingBottom:6}}>{page}</ScrollView>
 </View>;

 const hide=new Set(g.hidden),sides=M.clusterSides(g),preview=width-52,kind=M.periodKind(g);
 const sideOf=(id:'odo'|'fuel',key:string)=>hide.has(id)?<View key={key} style={{width:dial+2*spill}}/>:id==='odo'
  ?<View key={key} style={{width:dial+2*spill,marginLeft:key==='l'?-spill:0,marginRight:key==='r'?-spill:0}}><View style={st.lf}>{lowerFor(odoFace)}</View></View>
  :<View key={key} style={{width:dial+2*spill,marginLeft:key==='l'?-spill:0,marginRight:key==='r'?-spill:0,alignItems:'center',gap:4}}>{fuel}</View>;
 // Upright: each object in its place, customizable (Part); the gear in the empty corner beside the right dial.
 const object=(id:ObjectId)=>{switch(id){
  // Below the gear, which sits in the housing's corner.
  case 'dials':return look?<Part key={id} id={id} style={{paddingTop:edit?.on?0:24}}>{themeCompact(look)}</Part>
   :<Part key={id} id={id} style={{flexDirection:'row',justifyContent:'center',gap:Math.max(10,housingW-2*full)}} preview={v=><View style={{flexDirection:'row',gap:8}}>{dials(Math.floor((preview-8)/2),v)}</View>}>{dials(dial,face)}</Part>;
  case 'alerts':return <Part key={id} id={id} style={{alignSelf:'center'}} preview={v=>lightsFor(v,preview)}>{lightsFor(lamps,housingW)}</Part>;
  case 'odo':return <Part key={id} id={id} style={st.lf} preview={v=><View style={[st.lf,{width:preview}]}>{lowerFor(v)}</View>}>{lowerFor(odoFace)}</Part>;
  case 'fuel':return <Part key={id} id={id} style={{alignItems:'center',gap:6}} shown={cans}>{fuel}</Part>;
  case 'periods':return <Part key={id} id={id} style={{alignSelf:'center',marginBottom:hide.has('window')?0:-8}} preview={v=>periods(v,Math.min(winW,preview))}>{periods(kind,winW)}</Part>;
  case 'window':return <Part key={id} id={id} style={{alignSelf:'center'}}>{windowBox}</Part>;
  default:return null;
 }};
 const themeStrip=(id:string)=><View style={{width:housingW,aspectRatio:1280/480,alignSelf:'center'}}>
  <ThemeView mode={{kind:'theme',id}} stamp={stamp} figures={themeFig} onPress={themePress} style={StyleSheet.absoluteFill} testID="cluster-theme"/></View>;
 // Upright: the two instruments cut out, at most 240 high (themes/compact.js), with '크게 보기' under them.
 const themeCompact=(id:string)=>{const a=THEME_COMPACT[id]||1280/480;return <View style={{gap:6}}>
  <View style={{width:Math.min(housingW,240*a),aspectRatio:a,alignSelf:'center'}}><ThemeView mode={{kind:'compact',id}} stamp={stamp} figures={themeFig} onPress={themePress} style={StyleSheet.absoluteFill} testID="cluster-theme"/></View>
  {!edit?.on&&<Pressable accessibilityRole="button" testID="cluster-theme-big" onPress={quiet(()=>setBig(true))} style={st.themeBig}><Text style={st.themeBigText}>{'⤢ '+t('Full screen','크게 보기')}</Text></Pressable>}</View>;};
 const housing=themeSide&&look?<View style={[st.housing,{gap:GAP,paddingHorizontal:PX,paddingVertical:PT}]}>{themeStrip(look)}
   <View style={{flexDirection:'row',gap:COL,alignItems:'flex-start',justifyContent:'center'}}>{windowBox}{!hide.has('fuel')&&<View style={{width:tFoot,alignItems:'center',gap:4}}>{fuel}</View>}</View></View>
  :landscape?<View style={[st.housing,{gap:GAP,paddingHorizontal:PX,paddingVertical:PT}]}>
   <View style={{flexDirection:'row',gap:COL,alignItems:'flex-start',justifyContent:'center'}}>{dials(dial,face)[0]}<View style={{gap:8,width:winW}}>{periods(kind,winW)}{windowBox}</View>{dials(dial,face)[1]}</View>
   <View style={{flexDirection:'row',alignItems:'center',justifyContent:'center',height:FOOT}}>{sideOf(sides[0]||'odo','l')}<View style={{width:winW,alignItems:'center'}}>{!hide.has('alerts')&&lightsFor(lamps,winW)}</View>{sideOf(sides[1]||'fuel','r')}</View></View>
  :<Canvas style={st.housing}>{M.clusterOrder(g).map(object)}<Gear style={{position:'absolute',top:7,right:9}}/></Canvas>;
 // '크게 보기': the theme over the whole screen, on its side.
 const sheet=<><SessionDetails key={detail?.key||'none'} row={detail} close={()=>setDetail(null)}/>
  <Modal visible={big&&!!look} animationType={calm?'none':'fade'} onRequestClose={()=>setBig(false)} statusBarTranslucent navigationBarTranslucent supportedOrientations={['portrait','landscape']}>
   <View style={{flex:1,backgroundColor:'#000'}}>{look&&<ThemeView mode={{kind:'side',id:look}} stamp={stamp} figures={themeFig} onPress={themePress} style={{flex:1}} testID="cluster-theme-full"/>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('Close','닫기')} testID="cluster-theme-close" hitSlop={8} onPress={()=>setBig(false)} style={[st.themeClose,{top:inset.top+14}]}><Text style={st.themeCloseText}>✕</Text></Pressable></View></Modal></>;
 if(landscape)return <SafeAreaView edges={['top','left','right','bottom']} style={{flex:1,backgroundColor:quick.background}}>{focused&&<StatusBar hidden style={w.theme==='light'?'dark':'light'}/>}<ScrollView onLayout={e=>{const {width:w0,height:h0}=e.nativeEvent.layout;if(!box||box.w!==w0||box.h!==h0)setBox({w:w0,h:h0});}} contentContainerStyle={{flexGrow:1,justifyContent:'center',padding:OUT}}>{housing}</ScrollView>{sheet}</SafeAreaView>;
 if(embedded)return <>{housing}{sheet}</>;
 // Its own tab: the 1top header as on the dashboard's tab and the iPhone's, the housing under it.
 return <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:quick.background}}>
  <ScrollView ref={scrollRef} scrollEnabled={edit?.scrollable??true} contentContainerStyle={{paddingBottom:120+(edit?.room??0)}}><BrandHeader/><View style={{paddingHorizontal:16}}>{housing}</View></ScrollView>{sheet}</SafeAreaView>;
}

const make=()=>StyleSheet.create({
 housing:{gap:16,paddingHorizontal:14,paddingTop:18,paddingBottom:22,borderRadius:36,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 square:{width:8,height:8,borderRadius:2},
 dot:{width:6.5,height:6.5,borderRadius:4},
 name:{fontSize:10.8,fontWeight:'600',letterSpacing:.4,color:quick.muted},
 effort:{fontSize:10,color:quick.muted,paddingHorizontal:5,borderRadius:5,backgroundColor:quick.raised,overflow:'hidden'},
 dispLabel:{fontSize:10.5,fontWeight:'600',color:quick.muted},
 plate:{paddingHorizontal:7,paddingVertical:4,borderRadius:7,borderWidth:1,borderColor:'#1a2024',backgroundColor:'#0a0d0f'},
 tells:{flexDirection:'row',gap:1,paddingHorizontal:5,paddingVertical:4,borderRadius:14,borderWidth:1,borderColor:'#1b2125',backgroundColor:'#0b0e10'},
 tell:{width:52,height:46,alignItems:'center',justifyContent:'center',gap:2,borderRadius:9,borderWidth:1,borderColor:'transparent'},
 tellLabel:{fontSize:9.5,fontWeight:'600'},
 tellCount:{position:'absolute',top:2,right:5,fontSize:10,fontWeight:'800'},
 badge:{position:'absolute',top:1,right:1,minWidth:15,height:15,paddingHorizontal:3,borderRadius:8,alignItems:'center',justifyContent:'center'},badgeText:{fontSize:10,lineHeight:12,fontWeight:'800',color:'#0b0e10'},
 chips:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:6},
 chip:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,height:28,paddingHorizontal:10,borderRadius:999,borderWidth:1},
 chipText:{fontSize:12,fontWeight:'600',color:quick.ink},
 lf:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:14,flexWrap:'wrap'},
 label:{fontSize:11,fontWeight:'600',letterSpacing:.3,color:quick.muted},
 temp:{fontSize:12.5,fontWeight:'600',color:quick.ink},
 trip:{fontSize:11.5,color:quick.muted},
 reset:{height:22,paddingHorizontal:8,justifyContent:'center',borderRadius:6,borderWidth:1,borderColor:quick.line},
 can:{width:18,height:50,borderRadius:4,backgroundColor:quick.ink+'17',overflow:'hidden'},
 canTool:{fontSize:10.5,fontWeight:'600'},
 canPlan:{fontSize:11.5,fontWeight:'700',color:quick.ink},
 window:{gap:8,padding:10,borderRadius:16,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 modes:{flexDirection:'row',gap:2,padding:3,borderRadius:10,backgroundColor:quick.ink+'0d',flexGrow:1},
 mode:{height:28,alignItems:'center',justifyContent:'center',borderRadius:7,paddingHorizontal:7,flexGrow:1},
 modeText:{fontSize:11,fontWeight:'600',color:quick.muted},
 section:{fontSize:11.5,fontWeight:'600',color:quick.ink},
 session:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:6,paddingHorizontal:4,borderRadius:10,borderWidth:1,borderColor:'transparent'},
 pace:{fontSize:9.5,color:quick.muted,fontVariant:['tabular-nums']},
 sessionName:{fontSize:13,fontWeight:'600',color:quick.ink},
 fig:{fontSize:12.5,fontWeight:'600',color:quick.ink,fontVariant:['tabular-nums']},
 col:{width:64,textAlign:'right'},
 tiny:{fontSize:11,color:quick.muted},
 empty:{fontSize:12,color:quick.muted,textAlign:'center',paddingVertical:16,lineHeight:18},
 big:{fontSize:24,fontWeight:'700',letterSpacing:-.6,color:quick.ink,fontVariant:['tabular-nums']},
 card:{gap:7,padding:12,borderRadius:12,borderWidth:1,borderColor:quick.line},
 bar:{height:5,borderRadius:3,backgroundColor:quick.ink+'17',overflow:'hidden'},
 goal:{gap:4,padding:10,borderRadius:10,borderWidth:1,borderColor:quick.line},
 goalStatus:{alignSelf:'flex-start',fontSize:10,fontWeight:'600',paddingHorizontal:8,paddingVertical:2,borderRadius:10,overflow:'hidden'},
 proc:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:3},
 themeBig:{alignSelf:'flex-end',height:26,paddingHorizontal:10,justifyContent:'center',borderRadius:13,borderWidth:1,borderColor:'rgba(255,255,255,.28)',backgroundColor:'rgba(0,0,0,.6)'},
 themeBigText:{fontSize:12,fontWeight:'600',color:'#fff'},
 themeClose:{position:'absolute',right:14,width:36,height:36,borderRadius:18,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'rgba(255,255,255,.3)',backgroundColor:'rgba(0,0,0,.55)'},
 themeCloseText:{fontSize:15,fontWeight:'600',color:'#fff'},
});
let st=make();onTheme(()=>{st=make();});
