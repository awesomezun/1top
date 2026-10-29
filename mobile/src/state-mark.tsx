import React,{useEffect,useState} from 'react';
import {AccessibilityInfo,Animated,Easing,View} from 'react-native';

// States read by shape and motion, never by a tool's hue (Codex is green, GLM indigo):
// working is a moving wave in the LCD green, waiting an amber diamond, paused two bars, the rest a hollow ring.
const lcd='#9dff3c',amber='#e9b25c',muted='#9aa5ae',dim='#6c7882';
const WAVE=[[.4,1,.6,.4],[1,.5,.75,1],[.65,.85,.35,.65]];

export function StateMark({status,size=9}:{status:string;size?:number}){
 const [phase]=useState(()=>new Animated.Value(0)),[still,setStill]=useState(false);
 const working=status==='working';
 useEffect(()=>{let alive=true;AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(alive)setStill(v);}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>{if(!working||still)return;const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:1200,easing:Easing.inOut(Easing.ease),useNativeDriver:false}));loop.start();return()=>{loop.stop();phase.setValue(0);};},[working,still,phase]);
 if(working)return <View accessibilityElementsHidden importantForAccessibility="no" style={{width:size+1,height:size,flexDirection:'row',alignItems:'flex-end',gap:2}}>
  {WAVE.map((k,i)=><Animated.View key={i} style={{width:2,backgroundColor:lcd,height:still?k[0]*size:phase.interpolate({inputRange:[0,.33,.66,1],outputRange:k.map(v=>v*size)})}}/>)}
 </View>;
 if(status==='waiting')return <View style={{width:size,height:size,alignItems:'center',justifyContent:'center'}}><View style={{width:size*.72,height:size*.72,borderRadius:1.5,backgroundColor:amber,transform:[{rotate:'45deg'}]}}/></View>;
 if(status==='paused'||status==='resuming')return <View style={{width:size-1,height:size,flexDirection:'row',gap:2}}><View style={{width:3,height:size,backgroundColor:muted}}/><View style={{width:3,height:size,backgroundColor:muted}}/></View>;
 return <View style={{width:size-1,height:size-1,borderRadius:size,borderWidth:1.5,borderColor:dim}}/>;
}
