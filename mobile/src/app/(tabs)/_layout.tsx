import {Tabs} from 'expo-router';
import {Pressable,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Text} from '../../typography';
import {useWorkspace} from '../../workspace';
import {Loading,SignIn} from '../../ui';
import {quick} from '../../theme';
import {Icon,type IconName} from '../../icons';

// The tabs float in one translucent capsule above the content, like the iPhone's Liquid Glass tab bar,
// with the same names and the same symbols.
const TABS:[string,string,string,IconName][]=[['index','Dashboard','대시보드','dashboard'],['sessions','Sessions','세션','sessions'],['usage','Usage','사용량','usage'],['accounts','Limits','한도','limits'],['settings','Workspace','워크스페이스','workspace']];
export default function Layout(){const w=useWorkspace();if(w.loading)return <Loading/>;if(!w.token&&!w.demo)return <SignIn/>;
 return <Tabs screenOptions={{headerShown:false,sceneStyle:{backgroundColor:quick.background}}} tabBar={({state,navigateToTab})=><Capsule index={state.index} go={(name:string)=>{const route=state.routes.find(r=>r.name===name);if(route)navigateToTab(route.key);}}/>}>{TABS.map(([name,en,ko])=><Tabs.Screen key={name} name={name} options={{title:w.t(en,ko)}}/>)}</Tabs>;}

function Capsule({index,go}:{index:number;go:(name:string)=>void}){
 const w=useWorkspace(),inset=useSafeAreaInsets();
 return <View pointerEvents="box-none" style={{position:'absolute',left:0,right:0,bottom:Math.max(inset.bottom,10)+6,alignItems:'center'}}>
  <View accessibilityRole="tablist" style={{flexDirection:'row',padding:5,gap:2,borderRadius:34,backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine,
   shadowColor:'#000',shadowOpacity:.25,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:12,width:'92%',maxWidth:420}}>
   {TABS.map(([name,en,ko,icon],i)=>{const on=i===index,color=on?quick.mint:quick.ink;
    return <Pressable key={name} accessibilityRole="tab" accessibilityState={{selected:on}} accessibilityLabel={w.t(en,ko)} onPress={()=>go(name)}
     style={{flex:1,alignItems:'center',justifyContent:'center',gap:2,height:56,borderRadius:28,backgroundColor:on?quick.selected:'transparent'}}>
     <Icon name={icon} size={23} color={color}/><Text numberOfLines={1} style={{fontSize:10.5,fontWeight:'600',color}}>{w.t(en,ko)}</Text></Pressable>;})}
  </View>
 </View>;
}
