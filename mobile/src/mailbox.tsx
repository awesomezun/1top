import React,{useEffect,useState} from 'react';
import {TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import type {SessionRow} from './types';

type Mail={id:string;text:string;created:number;status:string;reply:string;reply_at?:number;truncated?:boolean;local?:boolean};
export function MailboxPane({row,button:Button}:{row:SessionRow;button:any}){
 const w=useWorkspace(),[draft,setDraft]=useState(''),[rows,setRows]=useState<Mail[]>([]),[error,setError]=useState(''),[sending,setSending]=useState(false);
 const available=row.capabilities.includes('mailbox');
 useEffect(()=>{
  if(w.demo||!available||w.connection.state!=='live')return;
  const refresh=()=>w.connection.readMailbox(row);
  refresh();const timer=setInterval(refresh,5000);return()=>clearInterval(timer);
  // Identity and connection changes define the subscription; snapshots refresh separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[row.id,row.device.id,row.control_key,available,w.demo,w.connection.state]);
 // Merge external socket events into this open session's message history.
 /* eslint-disable react-hooks/set-state-in-effect */
 useEffect(()=>{
  const response=w.connection.mailbox;
  if(!response||response.device_id!==row.device.id||response.session_id!==row.id)return;
  if(response.error){setError(response.error);return;}
  setError('');setRows(old=>[...(response.messages||[]),...old.filter(r=>r.local&&!response.messages.some((m:Mail)=>m.id===r.id)).map(r=>Date.now()/1000-r.created>30?{...r,status:'delivery_unconfirmed'}:r)]);
 },[w.connection.mailbox,row.device.id,row.id]);
 useEffect(()=>{const receipt=w.connection.receipt;if(!receipt)return;setRows(old=>old.map(row=>row.id===receipt.request.request_id?{...row,status:receipt.status==='failed'?'delivery_unconfirmed':'awaiting_reply'}:row));if(receipt.request.session_id===row.id&&receipt.request.device_id===row.device.id&&receipt.status==='failed')setError(receipt.message);},[w.connection.receipt,row.id,row.device.id]);
 /* eslint-enable react-hooks/set-state-in-effect */
 const label=(status:string)=>({sending:w.t('Sending','전송 중'),queued:w.t('Waiting for this session to finish its current turn','현재 작업이 끝나면 전달'),awaiting_reply:w.t('Waiting for a reply','답신 대기'),replied:w.t('Replied','답신 도착'),delivery_unconfirmed:w.t('Delivery unconfirmed — check the session before resending','전달 미확인 · 재전송 전에 세션 확인'),source_changed:w.t('Reply source changed','답신 연결 변경됨'),not_delivered:w.t('Not delivered — the session changed or the wait expired','미전달 · 세션 변경 또는 대기 만료')})[status]||status;
 async function send(){
  const text=draft,id=Crypto.randomUUID(),created=Date.now()/1000;setSending(true);setError('');
  try{await w.sendMessage(row,text,id);setDraft('');setRows(old=>[...old,{id,text,created,status:w.demo?'replied':'sending',reply:w.demo?w.t('Demo reply: I have finished the first checks and am reviewing the remaining failures.','예시 답신: 첫 검사를 마쳤고 남은 오류를 확인하고 있습니다.'):'',local:true}]);}
  catch(e:any){setError(e.message+' '+w.t('If delivery is uncertain, check the session before sending again.','전달이 불확실하면 재전송 전에 세션을 확인하세요.'));}
  finally{setSending(false);}
 }
 const online=w.demo||(w.connection.state==='live'&&row.device.online&&w.clock-row.device.received<20000);
 return <View style={{gap:16}}>
  <Text style={{fontSize:15,color:'#a0adbd'}}>{w.t('Messages to this session and its replies. Your full work conversation stays on the computer.','이 세션에게 보낸 메시지와 답신입니다. 전체 작업 대화는 컴퓨터에 남습니다.')}</Text>
  {!available&&<Text style={{color:'#ddb777'}}>{w.t('A message connection is not available for this session yet.','현재 이 세션의 메시지 연결을 확인할 수 없습니다.')}</Text>}
  {!rows.length&&<View style={{paddingVertical:24}}><Text style={{fontSize:23,color:'#f1f3f6'}}>{w.t('Ask this session','이 세션에 물어보세요')}</Text><Text style={{marginTop:12,color:'#a0adbd',fontSize:16}}>{w.t('“How far along are you?”','“지금 어디까지 진행됐어?”')}</Text></View>}
  {rows.map(message=><View key={message.id} style={{gap:10}}><View style={{alignSelf:'flex-end',maxWidth:'94%',backgroundColor:'#213f39',padding:16,borderRadius:18}}><Text selectable style={{fontSize:17,color:'#f1f3f6'}}>{message.text}</Text><Text style={{marginTop:8,fontSize:13,color:'#a8c6bc'}}>{label(message.status)}</Text></View>{message.reply&&<View style={{alignSelf:'flex-start',maxWidth:'94%',backgroundColor:'#1b232d',padding:16,borderRadius:18}}><Text style={{fontSize:13,color:'#81d4b7',marginBottom:8}}>{w.t('Session reply','세션의 답신')}</Text><Text selectable style={{fontSize:17,lineHeight:26,color:'#f1f3f6'}}>{message.reply}</Text>{message.truncated&&<Text style={{color:'#a0adbd'}}>{w.t('Long reply shortened.','긴 답신의 일부를 표시합니다.')}</Text>}</View>}</View>)}
  {!!error&&<Text style={{color:'#f1a4aa'}}>{error}</Text>}
  <TextInput accessibilityLabel={w.t('Message to session','세션에 보낼 메시지')} multiline maxLength={4000} value={draft} onChangeText={setDraft} placeholder={w.t('Write a message…','메시지를 입력하세요…')} placeholderTextColor="#a0adbd" style={{minHeight:110,color:'#f1f3f6',fontSize:17,padding:16,borderWidth:1,borderColor:'#344553',borderRadius:16,textAlignVertical:'top'}}/>
  <Button label={sending?w.t('Sending…','전송 중…'):w.t('Send message','메시지 보내기')} disabled={!online||sending||!row.capabilities.includes('message')||!draft.trim()} onPress={send}/>
  <Text style={{fontSize:13,color:'#a0adbd'}}>{w.t('A busy session may reply later. Sending can use AI tokens.','작업 중인 세션은 답신이 늦을 수 있습니다. 메시지 전송은 AI 토큰을 사용할 수 있습니다.')}</Text>
 </View>;
}
