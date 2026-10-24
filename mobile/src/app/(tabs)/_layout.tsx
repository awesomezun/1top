import {Tabs} from 'expo-router';
import {Text} from 'react-native';
import {useWorkspace} from '../../workspace';
import {colors,Loading,SignIn} from '../../ui';
export default function Layout(){const w=useWorkspace();if(w.loading)return <Loading/>;if(!w.token&&!w.demo)return <SignIn/>;return <Tabs screenOptions={{headerShown:false,tabBarStyle:{backgroundColor:colors.bg,borderTopColor:colors.line,height:84,paddingTop:8},tabBarActiveTintColor:colors.mint,tabBarInactiveTintColor:colors.muted,tabBarLabelStyle:{fontSize:12}}}>{[['index','Sessions','세션','▥'],['usage','Usage','사용량','▦'],['accounts','Accounts','계정','◉'],['settings','Workspace','워크스페이스','⌘']].map(([name,en,ko,icon])=><Tabs.Screen key={name} name={name} options={{title:w.t(en,ko),tabBarIcon:({color})=><Text style={{color,fontSize:23}}>{icon}</Text>}}/>)}</Tabs>;}
