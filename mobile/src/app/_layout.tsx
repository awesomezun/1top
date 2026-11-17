import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {useWorkspace,WorkspaceProvider} from '../workspace';
import {quick} from '../theme';
function Screens(){const w=useWorkspace();return <><StatusBar style={w.theme==='light'?'dark':'light'}/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:quick.background}}}/></>;}
export default function Root(){return <WorkspaceProvider><Screens/></WorkspaceProvider>;}
