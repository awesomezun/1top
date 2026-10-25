import React,{createContext,useContext,useEffect,useState} from 'react';
import {Alert} from 'react-native';
import * as Crypto from 'expo-crypto';
import {API,selectRelay,api,loadToken,signIn,signOut,useConnection} from './connection';
import {demoDevices} from './demo';
import {fresh} from './metrics';
import type {Device,SessionRow,WindowKey} from './types';
const Context=createContext<any>(null);
export const useWorkspace=()=>useContext(Context);
export function WorkspaceProvider({children}:{children:React.ReactNode}){
 const [token,setToken]=useState<string|null>(null),[loading,setLoading]=useState(true),[demo,setDemo]=useState(false),[ko,setKo]=useState(false),[selected,setSelected]=useState('all'),[period,setPeriod]=useState<WindowKey>('24h'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<Record<string,string>>({}),[clock,setClock]=useState(()=>Date.now());
 const [relay,setRelay]=useState(API);
 const connection=useConnection(token),t=(en:string,kr:string)=>ko?kr:en;
 useEffect(()=>{loadToken().then(value=>{setToken(value);setRelay(API);}).catch(()=>setMessage('Unable to read saved sign-in.')).finally(()=>setLoading(false));},[]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),2000);return()=>clearInterval(timer);},[]);
 // Reset view state at the authentication boundary to prevent cross-account carryover.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setSelected('all');setPending({});setMessage('');},[token,demo]);
 // The server receipt is an external event; reflect its completion in pending controls.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{const result=connection.receipt;if(!result)return;setPending(old=>Object.fromEntries(Object.entries(old).filter(([,id])=>id!==result.request.request_id)));setMessage(result.status+': '+(result.message||''));},[connection.receipt]);
 const devices:Device[]=demo?demoDevices():connection.devices;
 const visible=devices.filter(d=>selected==='all'||d.id===selected);
 const rows:SessionRow[]=visible.flatMap(d=>d.snapshot.sessions.map(s=>({...s,device:d,key:d.id+':'+s.id})));
 async function changeRelay(value:string){if(token)throw Error(t('Sign out before changing servers.','서버 변경 전에 로그아웃하세요.'));setRelay(await selectRelay(value));setMessage(t('Server saved. Sign in to connect.','서버를 저장했습니다. 로그인하여 연결하세요.'));}
 async function login(){setBusy(true);setMessage('');try{setToken(await signIn());setDemo(false);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}
 async function logout(){setBusy(true);try{if(!demo)await signOut(token);setToken(null);setDemo(false);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}
 function control(row:SessionRow,action:string){
  if(!fresh(row.device,20000)||!row.capabilities.includes(action)||pending[row.key])return;
  const labels:Record<string,string>={focus:t('Open on computer','컴퓨터에서 열기'),pause:t('Pause work','작업 일시정지'),resume:t('Resume work','작업 재개'),terminate:t('Quit CLI','CLI 종료')};
  Alert.alert(labels[action],row.device.name+' · '+row.app+' · '+row.terminal+'\n'+row.project+(action==='terminate'?'\n'+t('This ends the CLI process. Unsaved work may be lost.','CLI 프로세스를 종료합니다. 저장하지 않은 작업은 유실될 수 있습니다.'):'\n'+t('Runs on the selected computer.','선택한 컴퓨터에서 실행됩니다.')),[{text:t('Cancel','취소'),style:'cancel'},{text:labels[action],style:action==='terminate'?'destructive':'default',onPress:async()=>{
   if(demo){setMessage(t('Demo only. No command was sent.','체험 화면입니다. 명령을 전송하지 않았습니다.'));return;}
   if(!fresh(row.device,20000)||connection.state!=='live'){setMessage(t('Computer report is stale. Reconnect first.','컴퓨터 정보가 오래됐습니다. 먼저 재연결하세요.'));return;}
   const id=Crypto.randomUUID();setPending(old=>({...old,[row.key]:id}));
   try{const result=await api('/api/action',token!,{action,request_id:id,device_id:row.device.id,session_id:row.id,control_key:row.control_key});setMessage(result.status==='completed'?t('Completed','완료'):t('Sent. Waiting for the computer.','전송했습니다. 컴퓨터 응답을 기다립니다.'));}
   catch(e:any){setPending(old=>{const next={...old};delete next[row.key];return next;});setMessage(e.message);return;}
   setTimeout(()=>setPending(old=>{if(old[row.key]!==id)return old;const next={...old};delete next[row.key];setMessage(t('Result unconfirmed. Check the computer before retrying.','결과 미확인. 다시 요청하기 전에 컴퓨터를 확인하세요.'));return next;}),25000);
  }}]);
 }
 return <Context.Provider value={{relay,changeRelay,token,loading,demo,setDemo,ko,setKo,t,selected,setSelected,period,setPeriod,busy,message,setMessage,pending,clock,devices,visible,rows,connection,login,logout,control}}>{children}</Context.Provider>;
}
