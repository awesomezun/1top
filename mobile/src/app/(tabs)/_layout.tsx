import {useEffect,useRef} from 'react';
import {Tabs} from 'expo-router';
import {Pressable,View,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Text} from '../../typography';
import {useWorkspace} from '../../workspace';
import {Loading,SignIn} from '../../ui';
import {quick} from '../../theme';
import {Icon,type IconName} from '../../icons';
import {LayoutProvider,useLayout} from '../../customize';
import {DemoConnectBar,PaywallSheet} from '../../paywall';
import {startTab,tabBar,tabPreset} from '../../customize-model';

// The tabs float in one translucent capsule above the content, like the iPhone's Liquid Glass tab bar,
// with the same names and the same symbols. The cluster follows the dashboard, as in the desktop sidebar; with one tab
// chosen (customizing, layout.tabs) the dashboard's tab holds both presets and the cluster's leaves the bar. The
// workspace opens from the header's person button (its route stays, off the bar).
const TABS:[string,string,string,IconName][]=[['index','Dashboard','대시보드','dashboard'],['cluster','Cluster','계기판','cluster'],['sessions','Sessions','세션','sessions'],['usage','Usage','사용량','usage'],['accounts','Limits','한도','limits'],['settings','Workspace','워크스페이스','workspace']];
export default function Layout(){const w=useWorkspace();if(w.loading)return <Loading/>;if(!w.token&&!w.demo)return <SignIn/>;
 return <LayoutProvider><Tabs screenOptions={{headerShown:false,sceneStyle:{backgroundColor:quick.background}}} tabBar={({state,navigateToTab})=><Capsule index={state.index} go={(name:string)=>{const route=state.routes.find(r=>r.name===name);if(route)navigateToTab(route.key);}}/>}>{TABS.map(([name,en,ko])=><Tabs.Screen key={name} name={name} options={{title:w.t(en,ko)}}/>)}</Tabs><DemoConnectBar/><PaywallSheet/></LayoutProvider>;}

function Capsule({index,go}:{index:number;go:(name:string)=>void}){
 const w=useWorkspace(),L=useLayout(),inset=useSafeAreaInsets(),{width,height}=useWindowDimensions(),layout=L.state.layout,one=layout.tabs==='one';
 const name=TABS[index]?.[0],first=useRef(true);
 // With two tabs the app opens on the chosen preset's tab, and showing the dashboard's or the cluster's tab chooses it.
 useEffect(()=>{const opening=first.current;first.current=false;
  if(opening&&name==='index'&&startTab(layout)==='cluster'){go('cluster');return;}
  const p=name?tabPreset(layout,name):null;if(p)L.change(l=>{l.preset=p;});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[name]);
 // A phone on its side gives the cluster the whole screen, as the web does; turning it upright brings the tabs back.
 // While customizing the tabs step aside for the edit mode's sheets.
 const cluster=name==='cluster'||name==='index'&&one&&layout.preset==='cluster';
 if(L.editing||cluster&&width>height&&height<600)return null;
 const shown=tabBar(layout),tabs=TABS.filter(([k])=>shown.includes(k));
 return <View pointerEvents="box-none" style={{position:'absolute',left:0,right:0,bottom:Math.max(inset.bottom,10)+6,alignItems:'center'}}>
  <View accessibilityRole="tablist" style={{flexDirection:'row',padding:5,gap:2,borderRadius:34,backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine,
   shadowColor:'#000',shadowOpacity:.25,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:12,width:'94%',maxWidth:460}}>
   {tabs.map(([name,en,ko,icon])=>{const on=name===TABS[index]?.[0],color=on?quick.mint:quick.ink;
    return <Pressable key={name} accessibilityRole="tab" accessibilityState={{selected:on}} accessibilityLabel={w.t(en,ko)} onPress={()=>go(name)}
     style={{flex:1,alignItems:'center',justifyContent:'center',gap:2,height:56,borderRadius:28,backgroundColor:on?quick.selected:'transparent'}}>
     <Icon name={icon} size={23} color={color}/><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.8} style={{fontSize:10.5,fontWeight:'600',color,paddingHorizontal:1}}>{w.t(en,ko)}</Text></Pressable>;})}
  </View>
 </View>;
}
