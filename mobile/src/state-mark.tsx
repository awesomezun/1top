import React,{useEffect,useState} from 'react';
import {AccessibilityInfo,Animated,Easing,View} from 'react-native';
import Svg,{Circle,Path} from 'react-native-svg';
import {quick} from './theme';

// States read by shape and motion, never by a tool's hue (Codex is green, GLM indigo):
// working is a moving wave in the LCD green, waiting the amber warning triangle (as its warning light), paused two
// bars, the rest a hollow ring.
const WAVE=[[.4,1,.6,.4],[1,.5,.75,1],[.65,.85,.35,.65]];

export function StateMark({status,size=9}:{status:string;size?:number}){
 const [phase]=useState(()=>new Animated.Value(0)),[still,setStill]=useState(false);
 const working=status==='working',{segmentOn:lcd,amber,muted,dim}=quick;
 // Less motion asked for, now or later, holds the wave still.
 useEffect(()=>{let alive=true;AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(alive)setStill(v);}).catch(()=>{});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setStill);return()=>{alive=false;sub.remove();};},[]);
 // The bars grow from their foot on the native driver, so a page of working sessions costs the JavaScript thread nothing.
 useEffect(()=>{if(!working||still)return;const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:1200,easing:Easing.inOut(Easing.ease),useNativeDriver:true}));loop.start();return()=>{loop.stop();phase.setValue(0);};},[working,still,phase]);
 if(working)return <View accessibilityElementsHidden importantForAccessibility="no" style={{width:size+1,height:size,flexDirection:'row',alignItems:'flex-end',gap:2}}>
  {WAVE.map((k,i)=><Animated.View key={i} style={{width:2,height:size,backgroundColor:lcd,transformOrigin:'bottom',transform:[{scaleY:still?k[0]:phase.interpolate({inputRange:[0,.33,.66,1],outputRange:k})}]}}/>)}
 </View>;
 if(status==='waiting')return <Svg width={size+3} height={size+3} viewBox="0 0 24 24" style={{marginHorizontal:-1.5}}><Path d="M12 3.6 21.6 20H2.4Z" fill="none" stroke={amber} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"/><Path d="M12 9.6v5" stroke={amber} strokeWidth={2.2} strokeLinecap="round"/><Circle cx={12} cy={17.2} r={.9} fill={amber} stroke={amber} strokeWidth={1.2}/></Svg>;
 if(status==='paused'||status==='resuming')return <View style={{width:size-1,height:size,flexDirection:'row',gap:2}}><View style={{width:3,height:size,backgroundColor:muted}}/><View style={{width:3,height:size,backgroundColor:muted}}/></View>;
 return <View style={{width:size-1,height:size-1,borderRadius:size,borderWidth:1.5,borderColor:dim}}/>;
}
