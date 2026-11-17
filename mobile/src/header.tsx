import React,{useState} from 'react';
import {Image,Pressable,StyleSheet,View,useWindowDimensions} from 'react-native';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {Button,ComputerList,LanguageButton,Sheet,WorkspaceButton} from './ui';
import {Icon} from './icons';
import {onTheme,quick} from './theme';
import {usePresetSwitch,useLayout} from './customize';
import {pillFits} from './customize-model';
import type {Device} from './types';

// The 1top header of the dashboard's and the cluster's tabs, as on the iPhone: the brand on the left; on the right the
// computers in view, the quick switch when one tab holds both presets, a one-tap theme toggle, a one-tap language
// choice, more and the workspace. Where the row is short the computers' pill gives way to their count. Notices and the
// offline note follow it.
export function BrandHeader({preset}:{preset?:'cluster'|'dashboard'}){
 const w=useWorkspace(),t=w.t,L=useLayout(),setPreset=usePresetSwitch(),{width}=useWindowDimensions(),[choosing,setChoosing]=useState(false),[more,setMore]=useState(false);
 const visible:Device[]=w.visible||[],devices:Device[]=w.devices||[],live=w.demo||w.connection?.state==='live',gauge=!!preset&&L.state.layout.tabs==='one';
 const computer=w.selected==='all'?(devices.length===1?devices[0].name:t('All computers','모든 컴퓨터')+' · '+devices.length):visible[0]?.name||t('Choose computer','컴퓨터 선택');
 const chip=live?computer:w.connection?.state==='connecting'?t('Connecting','연결 중'):t('Offline','오프라인');
 // Where the computers' label does not fit beside the round buttons it becomes their count.
 const short=live&&!pillFits(chip,width,gauge?5:4)&&w.selected==='all'&&devices.length>1;
 const lastReport=Math.max(0,...visible.map(d=>d.received||0));
 return <>
  <View style={st.header}><Image source={require('../assets/mark.png')} style={{width:22,height:22,borderRadius:5}}/><Text style={{color:quick.ink,fontSize:17,fontWeight:'600'}}>1top</Text><View style={{flex:1}}/>
   <Pressable testID="computer-pill" accessibilityRole="button" accessibilityLabel={t('Choose computer','컴퓨터 선택')+' · '+chip} onPress={()=>setChoosing(true)} style={[st.pill,{flexShrink:1}]}>
    <View style={[st.dot,{backgroundColor:live?quick.mint:quick.amber}]}/>{short?<><Icon name="computer" size={13} color={quick.muted}/><Text style={st.pillText}>{devices.length}</Text></>
     :<Text numberOfLines={1} style={[st.pillText,{flexShrink:1}]}>{chip}</Text>}</Pressable>
   {gauge&&<Pressable testID="preset-switch" accessibilityRole="button" accessibilityLabel={preset==='cluster'?t('Standard view','기본 보기'):t('Cluster view','계기판 보기')} accessibilityState={{selected:preset==='cluster'}}
    onPress={()=>setPreset(preset==='cluster'?'dashboard':'cluster')} style={[st.circle,preset==='cluster'&&{borderColor:quick.mint}]}><Icon name="cluster" size={16} color={preset==='cluster'?quick.mint:quick.ink}/></Pressable>}
   <Pressable testID="theme-toggle" accessibilityRole="button" accessibilityLabel={t('Toggle theme','테마 전환')} accessibilityValue={{text:w.theme}} onPress={e=>w.toggleTheme(e.nativeEvent.pageX,e.nativeEvent.pageY)} style={st.circle}><Icon name={w.theme==='dark'?'moon':'sun'} size={15} color={quick.ink}/></Pressable>
   <LanguageButton testID="header-language"/>
   <Pressable accessibilityRole="button" accessibilityLabel={t('More','더 보기')} onPress={()=>setMore(true)} style={st.circle}><Icon name="more" size={15} color={quick.ink}/></Pressable>
   <WorkspaceButton size={30}/></View>
  {!!w.message&&<Pressable accessibilityRole="button" onPress={()=>w.setMessage('')} style={st.notice}><Text style={{color:quick.noticeInk,fontSize:12.5,lineHeight:18}}>{w.message}</Text></Pressable>}
  {!w.demo&&!live&&<View style={st.offline}><Text style={{color:quick.muted,fontSize:11.5,lineHeight:17,flex:1}}>{w.connection?.error||t('Waiting for a connection.','연결을 기다리고 있습니다.')}{lastReport?' '+t('Last report','마지막 보고')+' '+w.when(lastReport):''}</Text><Pressable accessibilityRole="button" onPress={w.connection?.retry} style={st.retry}><Text style={{color:quick.ink,fontSize:12,fontWeight:'600'}}>{t('Reconnect','다시 연결')}</Text></Pressable></View>}
  <Sheet visible={choosing} close={()=>setChoosing(false)} title={t('Computers','컴퓨터')}><ComputerList done={()=>setChoosing(false)}/>{lastReport>0&&<Text style={{color:quick.muted,fontSize:12.5}}>{t('Last report ','마지막 보고 ')+w.when(lastReport)}</Text>}</Sheet>
  <Sheet visible={more} close={()=>setMore(false)} title={t('More','더 보기')}>
   <Button label={t('Reconnect now','지금 다시 연결')} disabled={w.demo} onPress={()=>{setMore(false);w.connection?.retry?.();}}/>
   <Button label={w.tokensChosen?t('Show sessions as weekly limit %','세션을 주간 한도 %로 보기'):t('Show sessions as tokens','세션을 토큰으로 보기')} onPress={()=>{w.setTokensChosen(!w.tokensChosen);setMore(false);}}/>
   {w.demo&&<Button label={w.token?t('Sign out','로그아웃'):t('Leave demo','데모 끝내기')} onPress={()=>{setMore(false);w.logout();}}/>}</Sheet>
 </>;
}

const make=()=>StyleSheet.create({
 header:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:8,paddingBottom:10},
 pill:{flexDirection:'row',alignItems:'center',gap:6,height:30,paddingHorizontal:11,borderRadius:15,backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine,maxWidth:170},
 pillText:{color:quick.muted,fontSize:11.5},
 circle:{width:30,height:30,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine},
 dot:{width:6,height:6,borderRadius:3},
 notice:{marginHorizontal:14,marginBottom:10,padding:10,borderRadius:8,backgroundColor:quick.notice},
 offline:{flexDirection:'row',alignItems:'center',gap:10,marginHorizontal:14,marginBottom:10,padding:10,borderRadius:8,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 retry:{paddingHorizontal:10,paddingVertical:6,borderRadius:6,backgroundColor:quick.raised},
});
let st=make();onTheme(()=>{st=make();});
