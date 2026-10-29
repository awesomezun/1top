import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {Alert} from 'react-native';
import * as Crypto from 'expo-crypto';
import {API,selectRelay,api,loadToken,signIn,signOut,useConnection} from './connection';
import {demoDevices} from './demo';
import {fresh} from './metrics';
import {sortSessions} from './session-order';
import {applyReceipts,checkAttachments,EMPTY,sendOutcome,TEXT_MAX,type Attachment,type Convo,type Mail} from './thread';
import type {Device,SessionRow,WindowKey} from './types';
const Context=createContext<any>(null);
export const useWorkspace=()=>useContext(Context);
export function WorkspaceProvider({children}:{children:React.ReactNode}){
 const [token,setToken]=useState<string|null>(null),[loading,setLoading]=useState(true),[demo,setDemo]=useState(false),[ko,setKo]=useState(false),[selected,setSelected]=useState('all'),[period,setPeriod]=useState<WindowKey>('24h'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<Record<string,string>>({}),[clock,setClock]=useState(()=>Date.now());
 const [relay,setRelay]=useState(API);
 const [controlMessages,setControlMessages]=useState<Record<string,{id:string;message:string;final:boolean}>>({});
 // Each session (device id : session id) keeps its own draft and timeline. A send that finishes late,
 // or a receipt, only changes the session it belongs to, even after the reader moved on.
 const [convos,setConvos]=useState<Record<string,Convo>>({});
 const seen=useRef(new Set<string>());
 function updateConvo(key:string,change:(c:Convo)=>Convo,seed?:Mail[]){setConvos(old=>({...old,[key]:change(old[key]??{draft:EMPTY,thread:seed??[]})}));}
 const connection=useConnection(token),t=(en:string,kr:string)=>ko?kr:en;
 useEffect(()=>{loadToken().then(value=>{setToken(value);setRelay(API);}).catch(()=>setMessage('Unable to read saved sign-in.')).finally(()=>setLoading(false));},[]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),2000);return()=>clearInterval(timer);},[]);
 // Reset view state at the authentication boundary to prevent cross-account carryover.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setSelected('all');setPending({});setMessage('');setControlMessages({});setConvos({});seen.current=new Set();},[token,demo]);
 // Server receipts are external events. Each is applied once to pending controls, control messages and
 // every conversation's sends; results that arrive together are all kept by the connection.
 useEffect(()=>{const all:any[]=connection.receipts,next=all.filter(r=>r?.request?.request_id&&!seen.current.has(r.request.request_id));if(!next.length)return;
  for(const r of next)seen.current.add(r.request.request_id);const ids=new Set(next.map(r=>r.request.request_id)),last=next[next.length-1];
  setPending(old=>Object.fromEntries(Object.entries(old).filter(([,id])=>!ids.has(id))));setMessage(last.status+': '+(last.message||''));
  setControlMessages(old=>{const out={...old};for(const r of next)out[r.request.device_id+':'+r.request.session_id]={id:r.request.request_id,message:r.status+': '+(r.message||''),final:true};return out;});
  setConvos(old=>Object.fromEntries(Object.entries(old).map(([k,c])=>[k,{...c,thread:applyReceipts(c.thread,all)}])));},[connection.receipts]);
 const devices:Device[]=demo?demoDevices():connection.devices;
 const visible=devices.filter(d=>selected==='all'||d.id===selected);
 const rows:SessionRow[]=sortSessions(visible.flatMap(d=>d.snapshot.sessions.map(s=>({...s,device:d,key:d.id+':'+s.id}))),period);
 async function changeRelay(value:string){if(token)throw Error(t('Sign out before changing servers.','서버 변경 전에 로그아웃하세요.'));setRelay(await selectRelay(value));setMessage(t('Server saved. Sign in to connect.','서버를 저장했습니다. 로그인하여 연결하세요.'));}
 async function login(){setBusy(true);setMessage('');try{setToken(await signIn());setDemo(false);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}
 async function logout(){setBusy(true);try{if(!demo)await signOut(token);setToken(null);setDemo(false);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}
 async function sendMessage(row:SessionRow,text:string,id:string,attachments:Attachment[]=[]){
  const refuse=(message:string)=>Object.assign(Error(message),{local:true});
  if(!row||!fresh(row.device,20000)||!row.capabilities.includes('message')||(!demo&&connection.state!=='live'))throw refuse(t('This session cannot receive messages right now.','현재 이 세션에 메시지를 보낼 수 없습니다.'));
  if(!text.trim()||text.length>TEXT_MAX)throw refuse(t('Enter up to 4,000 characters.','4,000자 이내로 입력하세요.'));
  if(attachments.length&&!row.capabilities.includes('message_images'))throw refuse(t('This session cannot receive photos.','이 세션은 사진을 받을 수 없습니다.'));
  if(checkAttachments(attachments))throw refuse(t('Up to 3 JPEG or PNG photos, each at most 512KB.','사진은 JPEG·PNG 3장까지, 장당 512KB 이하입니다.'));
  if(demo)return;
  await api('/api/action',token!,{action:'message',request_id:id,device_id:row.device.id,session_id:row.id,control_key:row.control_key,prompt:text,...(attachments.length?{attachments}:{})},undefined,attachments.length?60000:15000);
 }
 function control(row:SessionRow,action:string,instruction?:string,after?:(id:string,outcome:'sent'|'failed'|'unconfirmed')=>void){
  if(!row||!fresh(row.device,20000)||!row.capabilities.includes(action)||pending[row.key])return;
  if(action==='prompt'&&(!instruction?.trim()||instruction.length>4000)){setMessage(t('Enter an instruction up to 4,000 characters.','4,000자 이내의 지시를 입력하세요.'));return;}
  const labels:Record<string,string>={prompt:t('Send AI instruction','AI에게 지시 보내기'),focus:t('Open on computer','컴퓨터에서 열기'),pause:t('Pause work','작업 일시정지'),resume:t('Resume work','작업 재개'),terminate:t('Quit CLI','CLI 종료')};
  Alert.alert(labels[action],row.device.name+' · '+row.app+' · '+row.terminal+'\n'+row.project+(action==='prompt'?'\n\n'+instruction!.slice(0,300)+(instruction!.length>300?'…':'')+'\n\n'+t('Sends a new instruction to this AI session. It may use tokens.','이 AI 세션에 새 지시를 보내며 토큰을 사용할 수 있습니다.'):action==='terminate'?'\n'+t('This ends the CLI process. Unsaved work may be lost.','CLI 프로세스를 종료합니다. 저장하지 않은 작업은 유실될 수 있습니다.'):'\n'+t('Runs on the selected computer.','선택한 컴퓨터에서 실행됩니다.')),[{text:t('Cancel','취소'),style:'cancel'},{text:labels[action],style:action==='terminate'?'destructive':'default',onPress:async()=>{
   if(demo){const message=t('Demo only. No command was sent.','체험 화면입니다. 명령을 전송하지 않았습니다.');setMessage(message);setControlMessages(old=>({...old,[row.key]:{id:'demo',message,final:true}}));after?.('demo-'+Date.now(),'sent');return;}
   if(!fresh(row.device,20000)||connection.state!=='live'){const message=t('Computer report is stale. Reconnect first.','컴퓨터 정보가 오래됐습니다. 먼저 재연결하세요.');setMessage(message);setControlMessages(old=>({...old,[row.key]:{id:'stale',message,final:true}}));return;}
   const id=Crypto.randomUUID();setPending(old=>({...old,[row.key]:id}));
   const report=(message:string,final=false)=>{setMessage(message);setControlMessages(old=>old[row.key]?.id===id&&old[row.key]?.final?old:({...old,[row.key]:{id,message,final}}));};
   report(t('Sending…','전송 중…'));
   try{const result=await api('/api/action',token!,{action,request_id:id,device_id:row.device.id,session_id:row.id,control_key:row.control_key,...(action==='prompt'?{prompt:instruction}:{})});after?.(id,'sent');report(result.status==='completed'?t('Completed','완료'):t('Sent. Waiting for the computer.','전송했습니다. 컴퓨터 응답을 기다립니다.'),result.status==='completed');}
   catch(e:any){setPending(old=>{const next={...old};delete next[row.key];return next;});after?.(id,sendOutcome(e));report(e.message,true);return;}
   setTimeout(()=>setPending(old=>{if(old[row.key]!==id)return old;const next={...old};delete next[row.key];report(t('Result unconfirmed. Check the computer before retrying.','결과 미확인. 다시 요청하기 전에 컴퓨터를 확인하세요.'),true);return next;}),25000);
  }}]);
 }
 return <Context.Provider value={{relay,changeRelay,token,loading,demo,setDemo,ko,setKo,t,selected,setSelected,period,setPeriod,busy,message,setMessage,pending,controlMessages,clock,devices,visible,rows,connection,login,logout,control,sendMessage,convos,updateConvo}}>{children}</Context.Provider>;
}
