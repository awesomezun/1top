import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Animated,type GestureResponderEvent,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import Svg,{Circle,Defs,G,Line,LinearGradient,Polygon,RadialGradient,Rect,Stop} from 'react-native-svg';
import {Text} from './typography';
import {onTheme,quick} from './theme';
import {useSay} from './customize';

// The cluster's period control above the window, in the shape chosen (customizing: the web's cluster.js gearMarkup and
// cluster.css .gd-*): drum (the phone's own, 'auto'), tabs, tuner, roller, knob or lever. Each turns by dragging or a
// press on a period, springs to the nearest stop and picks it there; with less motion asked for it is there at once.
// Spoken names go through t(english, korean).
export type PeriodKind='drum'|'tabs'|'tuner'|'roller'|'knob'|'lever';
type Props={index:number;width:number;labels:string[];pick:(i:number)=>void;calm?:boolean};
const MINT='#6ccfa9',RED='#ff3b30',TUNE=78,KY=70,KRY=56;

export function PeriodDial({kind,...p}:Props&{kind:string}){
 switch(kind){
  case 'tabs':return <Tabs {...p}/>;
  case 'tuner':return <Tuner {...p}/>;
  case 'roller':return <Roller {...p}/>;
  case 'knob':return <Knob {...p}/>;
  case 'lever':return <Lever {...p}/>;
  default:return <Drum {...p}/>;
 }
}

/** The turn shared by the shapes: a position that springs to the chosen stop, and a drag that turns it (sideways, or
 *  up and down for the roller) by unit points a stop, then picks the nearest. */
function useTurn({index,labels,pick,calm}:Props,unit:number,dir:number,upright=false){
 const last=labels.length-1,[p]=useState(()=>new Animated.Value(index)),cur=useRef(index),start=useRef({x:0,y:0}),drag=useRef<{at:number;from:number}|null>(null);
 useEffect(()=>{const id=p.addListener(({value})=>{cur.current=value;});return()=>p.removeListener(id);},[p]);
 const settle=(to:number)=>{if(calm)p.setValue(to);else Animated.spring(p,{toValue:to,friction:7,tension:60,useNativeDriver:true}).start();};
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{if(drag.current===null)settle(index);},[index,p,calm]);
 const along=(e:GestureResponderEvent)=>upright?e.nativeEvent.pageY:e.nativeEvent.pageX;
 const turn={
  onStartShouldSetResponderCapture:(e:GestureResponderEvent)=>{start.current={x:e.nativeEvent.pageX,y:e.nativeEvent.pageY};return false;},
  onMoveShouldSetResponderCapture:(e:GestureResponderEvent)=>{const dx=e.nativeEvent.pageX-start.current.x,dy=e.nativeEvent.pageY-start.current.y,a=upright?dy:dx,b=upright?dx:dy;return Math.abs(a)>6&&Math.abs(a)>Math.abs(b);},
  onResponderGrant:()=>{p.stopAnimation();drag.current={at:upright?start.current.y:start.current.x,from:cur.current};return true;},
  onResponderMove:(e:GestureResponderEvent)=>{const d=drag.current;if(d)p.setValue(Math.max(-.4,Math.min(last+.4,d.from+dir*(along(e)-d.at)/unit)));},
  onResponderRelease:()=>{drag.current=null;const to=Math.max(0,Math.min(last,Math.round(cur.current)));settle(to);pick(to);},
  onResponderTerminationRequest:()=>false,
  onResponderTerminate:()=>{drag.current=null;settle(index);}};
 return {p,turn,last};
}
// Positions sampled over the turn, so each part can follow it natively.
const samples=(last:number)=>Array.from({length:(last+3)*8+1},(_,k)=>-1.5+k/8);

/** drum: the periods on a cylinder turning sideways behind a lens, its surface finely ridged like a watch crown. */
function Drum(props:Props){
 const {t}=useSay();
 const {index,width,labels,pick}=props,R=width*.42,unit=R*24*Math.PI/180,{p,turn,last}=useTurn(props,unit,-1);
 const steps=useMemo(()=>samples(last),[last]);
 const place=(i:number)=>{const a=steps.map(s=>(i-s)*24),r=a.map(x=>Math.max(-80,Math.min(80,x))*Math.PI/180);
  return {transform:[{perspective:420},{translateX:p.interpolate({inputRange:steps,outputRange:r.map(x=>R*Math.sin(x))})},{rotateY:p.interpolate({inputRange:steps,outputRange:r.map(x=>(x*180/Math.PI)+'deg')})}],
   opacity:p.interpolate({inputRange:steps,outputRange:a.map((x,k)=>Math.abs(x)>78?0:Math.max(0,Math.cos(r[k]))**1.2)})};};
 // The ridges: 200 round the drum, so 1.8° apart; they slide with the turn under the shading of the cylinder.
 const spacing=R*Math.PI/100,ridges=Animated.multiply(Animated.modulo(Animated.multiply(p,unit),spacing),-1);
 return <View {...turn} accessibilityRole="adjustable" accessibilityLabel={t('Time window','기간')+' '+labels[index]} style={[st.drum,{width}]}>
  <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{transform:[{translateX:ridges}]}]}>
   <Svg width={width+spacing*2} height={50}>{Array.from({length:Math.ceil(width/spacing)+3},(_,k)=><G key={k}><Line x1={k*spacing} x2={k*spacing} y1={0} y2={50} stroke="#000" strokeOpacity={.4} strokeWidth={1.2}/><Line x1={k*spacing+1.3} x2={k*spacing+1.3} y1={0} y2={50} stroke="#fff" strokeOpacity={.08} strokeWidth={.8}/></G>)}</Svg>
  </Animated.View>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={50}>
   <Defs><LinearGradient id="drumShade" x1="0" x2="1" y1="0" y2="0"><Stop offset={0} stopColor="#000" stopOpacity={0.8}/><Stop offset={0.24} stopColor="#000" stopOpacity={0}/><Stop offset={0.76} stopColor="#000" stopOpacity={0}/><Stop offset={1} stopColor="#000" stopOpacity={0.8}/></LinearGradient>
    <LinearGradient id="drumLight" x1="0" x2="0" y1="0" y2="1"><Stop offset={0} stopColor="#000" stopOpacity={0.35}/><Stop offset={0.45} stopColor="#fff" stopOpacity={0.06}/><Stop offset={1} stopColor="#000" stopOpacity={0.45}/></LinearGradient></Defs>
   <Rect x={0} y={0} width={width} height={50} fill="url(#drumLight)"/><Rect x={0} y={0} width={width} height={50} fill="url(#drumShade)"/></Svg>
  <View pointerEvents="none" style={[st.lens,{left:width/2-39}]}/>
  {labels.map((l,i)=><Animated.View key={i} style={[st.drumItem,{left:width/2-40},place(i)]}><Pressable onPress={()=>pick(i)} hitSlop={6}><Text numberOfLines={1} style={[st.drumText,i===index&&{color:quick.ink}]}>{l}</Text></Pressable></Animated.View>)}
 </View>;
}

/** tabs: the periods as buttons in a row, sliding sideways where they do not fit. */
function Tabs({index,width,labels,pick}:Props){
 const {t}=useSay();
 const fits=labels.length*50+(labels.length-1)*2+10<=width;
 return <View accessibilityRole="tablist" accessibilityLabel={t('Time window','기간')} style={[st.tabs,{width}]}>
  <ScrollView horizontal scrollEnabled={!fits} showsHorizontalScrollIndicator={false} contentContainerStyle={{flexGrow:1,gap:2}}>
   {labels.map((l,i)=><Pressable key={i} accessibilityRole="tab" accessibilityState={{selected:i===index}} onPress={()=>pick(i)} style={[st.tab,i===index&&{backgroundColor:MINT}]}>
    <Text numberOfLines={1} style={[st.tabText,i===index&&{color:'#0b0d0f',fontWeight:'700'}]}>{l}</Text></Pressable>)}</ScrollView></View>;
}

/** tuner: a radio dial's strip of ticks and periods sliding under a fixed red needle, fading at both ends. */
function Tuner(props:Props){
 const {t}=useSay();
 const {index,width,labels,pick}=props,{p,turn,last}=useTurn(props,TUNE,-1),steps=useMemo(()=>samples(last),[last]),N=labels.length;
 const x=p.interpolate({inputRange:steps,outputRange:steps.map(s=>width/2-(s+.5)*TUNE)});
 return <View {...turn} accessibilityRole="adjustable" accessibilityLabel={t('Time window','기간')+' '+labels[index]} style={[st.box,{width,height:46}]}>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={46}><Defs><LinearGradient id="tunerBg" x1="0" x2="0" y1="0" y2="1"><Stop offset={0} stopColor="#0a0d0f"/><Stop offset={1} stopColor="#151a1d"/></LinearGradient></Defs><Rect width={width} height={46} fill="url(#tunerBg)"/></Svg>
  <Animated.View style={{position:'absolute',top:0,bottom:0,left:0,width:N*TUNE,transform:[{translateX:x}]}}>
   <Svg pointerEvents="none" style={{position:'absolute',left:0,bottom:0}} width={N*TUNE} height={8}>{Array.from({length:Math.floor(N*TUNE/13)},(_,k)=><Rect key={k} x={k*13+12} y={0} width={1} height={8} fill="#edf1f3" fillOpacity={.22}/>)}</Svg>
   {labels.map((l,i)=><Animated.View key={i} style={{position:'absolute',left:(i+.5)*TUNE-36,width:72,top:5,alignItems:'center',opacity:p.interpolate({inputRange:steps,outputRange:steps.map(s=>Math.max(.35,1-Math.abs(i-s)*.22))})}}>
    <Pressable onPress={()=>pick(i)} hitSlop={6}><Text numberOfLines={1} style={[st.dialText,i===index&&{color:MINT}]}>{l}</Text></Pressable>
    <View pointerEvents="none" style={{position:'absolute',top:22,width:2,height:12,borderRadius:1,backgroundColor:i===index?MINT:'rgba(237,241,243,0.45)'}}/></Animated.View>)}
  </Animated.View>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={46}>
   <Defs><LinearGradient id="tunerFade" x1="0" x2="1" y1="0" y2="0"><Stop offset={0} stopColor="#0f1316" stopOpacity={1}/><Stop offset={.16} stopColor="#0f1316" stopOpacity={0}/><Stop offset={.84} stopColor="#0f1316" stopOpacity={0}/><Stop offset={1} stopColor="#0f1316" stopOpacity={1}/></LinearGradient></Defs>
   <Rect width={width} height={46} fill="url(#tunerFade)"/>
   <Rect x={width/2-1} y={28} width={2} height={16} rx={1} fill={RED}/><Polygon points={`${width/2-4},${23} ${width/2+4},${23} ${width/2},${28}`} fill={RED}/></Svg>
 </View>;
}

/** roller: a drum turning up and down in a window, a step either side. */
function Roller(props:Props){
 const {t}=useSay();
 const {index,width,labels,pick}=props,{p,turn,last}=useTurn(props,30,-1,true),steps=useMemo(()=>samples(last),[last]);
 const place=(i:number)=>{const a=steps.map(s=>Math.max(-90,Math.min(90,(i-s)*34))),r=a.map(x=>x*Math.PI/180);
  return {transform:[{perspective:260},{translateY:p.interpolate({inputRange:steps,outputRange:r.map(x=>40*Math.sin(x))})},{rotateX:p.interpolate({inputRange:steps,outputRange:a.map(x=>(-x)+'deg')})}],
   opacity:p.interpolate({inputRange:steps,outputRange:r.map(x=>Math.max(0,Math.cos(x))**2)})};};
 const step=(d:number)=>pick(Math.max(0,Math.min(last,index+d)));
 return <View accessibilityRole="adjustable" accessibilityLabel={t('Time window','기간')+' '+labels[index]} style={[st.box,{width,height:46,flexDirection:'row'}]}>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={46}><Defs><LinearGradient id="rollBg" x1="0" x2="0" y1="0" y2="1"><Stop offset={0} stopColor="#050607"/><Stop offset={.3} stopColor="#1d2226"/><Stop offset={.5} stopColor="#2a3136"/><Stop offset={.7} stopColor="#1d2226"/><Stop offset={1} stopColor="#050607"/></LinearGradient></Defs><Rect width={width} height={46} fill="url(#rollBg)"/></Svg>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Previous time window','이전 기간')} onPress={()=>step(-1)} style={st.step}><Text style={st.stepText}>‹</Text></Pressable>
  <View {...turn} style={st.roll}>
   <View pointerEvents="none" style={[st.rollLine,{top:9}]}/><View pointerEvents="none" style={[st.rollLine,{bottom:9}]}/>
   {labels.map((l,i)=><Animated.View key={i} style={[{position:'absolute',left:0,right:0,top:14,alignItems:'center'},place(i)]}><Pressable onPress={()=>pick(i)} hitSlop={4}><Text numberOfLines={1} style={[st.dialText,i===index&&{color:MINT}]}>{l}</Text></Pressable></Animated.View>)}
  </View>
  <Pressable accessibilityRole="button" accessibilityLabel={t('Next time window','다음 기간')} onPress={()=>step(1)} style={st.step}><Text style={st.stepText}>›</Text></Pressable>
 </View>;
}

/** knob: a ridged knob turned to the period it points at, its periods on an arc above it. */
function Knob(props:Props){
 const {t}=useSay();
 const {index,width,labels,pick}=props,{p,turn}=useTurn(props,34,1),N=labels.length,KRX=Math.min(112,width/2-34);
 const at=(i:number)=>{const a=(-170+i*160/Math.max(1,N-1))*Math.PI/180;return [Math.cos(a)*KRX,KY+Math.sin(a)*KRY];};
 const pointing=labels.map((_,i)=>{const [x,y]=at(i);return Math.atan2(x,KY-y)*180/Math.PI;});
 const rotate=p.interpolate({inputRange:labels.map((_,i)=>i),outputRange:pointing.map(a=>a+'deg'),extrapolate:'clamp'});
 return <View {...turn} accessibilityRole="adjustable" accessibilityLabel={t('Time window','기간')+' '+labels[index]} style={[st.box,{width,height:94}]}>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={94}><Defs><RadialGradient id="knobBg" cx="50%" cy="100%" r="80%"><Stop offset={0} stopColor="#1c2226"/><Stop offset={.7} stopColor="#0b0e10"/></RadialGradient></Defs><Rect width={width} height={94} fill="url(#knobBg)"/></Svg>
  {labels.map((l,i)=>{const [x,y]=at(i);return <Pressable key={i} onPress={()=>pick(i)} hitSlop={4} style={{position:'absolute',left:width/2+x-30,top:y-10,width:60,height:20,alignItems:'center',justifyContent:'center'}}>
   <Text numberOfLines={1} style={[st.dialText,{fontSize:11},i===index&&{color:MINT}]}>{l}</Text></Pressable>;})}
  <Animated.View pointerEvents="none" style={{position:'absolute',left:width/2-21,top:KY-21,width:42,height:42,transform:[{rotate}]}}>
   <Svg width={42} height={42}><Defs><RadialGradient id="knobFace" cx="38%" cy="30%" r="70%"><Stop offset={0} stopColor="#57616a"/><Stop offset={.62} stopColor="#20262a"/><Stop offset={1} stopColor="#0a0c0e"/></RadialGradient></Defs>
    <Circle cx={21} cy={21} r={21} fill="#0a0d0f"/><Circle cx={21} cy={21} r={18} fill="url(#knobFace)"/>
    {Array.from({length:40},(_,k)=>{const a=k*9*Math.PI/180;return <Line key={k} x1={21+15*Math.sin(a)} y1={21-15*Math.cos(a)} x2={21+18*Math.sin(a)} y2={21-18*Math.cos(a)} stroke="#fff" strokeOpacity={.07} strokeWidth={1.2}/>;})}
    <Rect x={19.5} y={6} width={3} height={12} rx={1.5} fill={MINT}/></Svg></Animated.View>
 </View>;
}

/** lever: a lever sliding in a groove between notches, its periods underneath. */
function Lever(props:Props){
 const {t}=useSay();
 const {index,width,labels,pick}=props,N=labels.length,{p,turn,last}=useTurn(props,width/N,1),track=width*.92,x0=width*.04;
 const left=p.interpolate({inputRange:[0,last],outputRange:[x0+.5/N*track-15,x0+(last+.5)/N*track-15],extrapolate:'clamp'});
 return <View {...turn} accessibilityRole="adjustable" accessibilityLabel={t('Time window','기간')+' '+labels[index]} style={[st.box,{width,height:56}]}>
  <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={56}><Defs><LinearGradient id="leverBg" x1="0" x2="0" y1="0" y2="1"><Stop offset={0} stopColor="#121619"/><Stop offset={1} stopColor="#0b0e10"/></LinearGradient></Defs>
   <Rect width={width} height={56} fill="url(#leverBg)"/><Rect x={x0} y={10} width={track} height={12} rx={6} fill="#050708"/>
   {labels.map((_,i)=><Circle key={i} cx={x0+(i+.5)/N*track} cy={16} r={2} fill="#edf1f3" fillOpacity={.25}/>)}</Svg>
  <Animated.View pointerEvents="none" style={{position:'absolute',top:4,width:30,height:24,transform:[{translateX:left}]}}>
   <Svg width={30} height={24}><Defs><LinearGradient id="leverHandle" x1="0" x2="0" y1="0" y2="1"><Stop offset={0} stopColor="#68737b"/><Stop offset={.55} stopColor="#2c3337"/><Stop offset={1} stopColor="#1a1e21"/></LinearGradient></Defs>
    <Rect width={30} height={24} rx={8} fill="url(#leverHandle)"/><Rect x={14} y={5} width={2} height={14} rx={1} fill={MINT}/></Svg></Animated.View>
  <View style={{position:'absolute',left:x0,width:track,bottom:3,flexDirection:'row'}}>{labels.map((l,i)=><Pressable key={i} onPress={()=>pick(i)} style={{flex:1,alignItems:'center'}}><Text numberOfLines={1} style={[st.dialText,{fontSize:11},i===index&&{color:MINT}]}>{l}</Text></Pressable>)}</View>
 </View>;
}

const make=()=>StyleSheet.create({
 drum:{height:50,overflow:'hidden',borderRadius:12,borderWidth:1,borderColor:'#1a2024',backgroundColor:'#2a3136'},
 drumItem:{position:'absolute',top:14,width:80,alignItems:'center'},
 drumText:{fontSize:12.5,fontWeight:'600',color:'#9aa5ae',textShadowColor:'#000',textShadowRadius:2,textShadowOffset:{width:0,height:1}},
 lens:{position:'absolute',top:7,bottom:7,width:78,borderRadius:8,borderWidth:1,borderColor:MINT+'8c',backgroundColor:'rgba(6,8,9,0.55)'},
 box:{overflow:'hidden',borderRadius:12,borderWidth:1,borderColor:'#1a2024',backgroundColor:'#0b0e10'},
 dialText:{fontSize:12.5,fontWeight:'600',color:'#9aa5ae'},
 tabs:{height:40,padding:4,borderRadius:12,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 tab:{flexGrow:1,minWidth:50,paddingHorizontal:4,borderRadius:8,alignItems:'center',justifyContent:'center'},
 tabText:{fontSize:12,fontWeight:'600',color:quick.muted},
 step:{width:30,alignItems:'center',justifyContent:'center'},stepText:{fontSize:20,color:'#9aa5ae'},
 roll:{flex:1,overflow:'hidden',borderLeftWidth:1,borderRightWidth:1,borderColor:'#14191c'},
 rollLine:{position:'absolute',left:'18%',right:'18%',height:1,backgroundColor:MINT+'73'},
});
let st=make();onTheme(()=>{st=make();});
