import {Stack} from 'expo-router';
import {StatusBar} from 'expo-status-bar';
import {WorkspaceProvider} from '../workspace';
export default function Root(){return <WorkspaceProvider><StatusBar style="light"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:'#0b0e12'}}}/></WorkspaceProvider>;}
