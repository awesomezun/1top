import {Tabs} from 'expo-router';
import {Text} from 'react-native';
import {fonts} from '../../typography';
import {useWorkspace} from '../../workspace';
import {colors,Loading,SignIn} from '../../ui';
export default function Layout(){const w=useWorkspace();if(w.loading)return <Loading/>;if(!w.token&&!w.demo)return <SignIn/>;return <Tabs screenOptions={{headerShown:false,tabBarStyle:{backgroundColor:'#0b0d0f',borderTopColor:colors.line,height:84,paddingTop:8},tabBarActiveTintColor:colors.mint,tabBarInactiveTintColor:colors.muted,tabBarLabelStyle:{fontSize:12,fontFamily:fonts.semibold,fontWeight:"normal"}}}>{[['index','Dashboard','대시보드','◎'],['sessions','Sessions','세션','▥'],['usage','Usage','사용량','▦'],['accounts','Accounts','계정','◉'],['settings','Workspace','워크스페이스','⌘']].map(([name,en,ko,icon])=><Tabs.Screen key={name} name={name} options={{title:w.t(en,ko),tabBarIcon:({color})=><Text style={{color,fontSize:23}}>{icon}</Text>}}/>)}</Tabs>;}
