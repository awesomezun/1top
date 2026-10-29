import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,Easing,Image,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {StateMark} from './state-mark';
import {demoThread} from './demo';
import {fresh,tool} from './metrics';
import {pickPhotos,rejectionText,type Photo} from './photos';
import {activityLabel,attachmentSummary,defaultPrompt,deliveryLabel,deliveryTone,effectiveStatus,kb,PHOTO_MAX,responseActivity,sendMode,sendOutcome,TEXT_MAX,workLabel,workState,type Mail,type Phase,type Work} from './thread';
import type {SessionRow} from './types';

// One conversation per session: its live work at the top, then messages and replies, then one composer.
// Delivery of each message is shown on the message; the session's work is shown apart from it.
const c={bg:'#0b0d0f',card:'#121518',raised:'#1c2125',mine:'#1f262c',line:'#23292e',ink:'#edf1f3',muted:'#9aa5ae',dim:'#6c7882',amber:'#e9b25c',red:'#f1a4aa'};
const mark=(work:Work)=>work==='working'||work==='waiting'||work==='paused'?work:'idle';
const motion=Platform.OS!=='web';

export function SessionDetails({row,close}:{row:SessionRow|null;close:()=>void}){
 const w=useWorkspace(),live:SessionRow|undefined=row?w.rows.find((r:SessionRow)=>r.key===row.key):undefined,current=live||row;
 return <Modal visible={!!row} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>{current&&<Conversation row={current} live={live} close={close}/>}</Modal>;
}

function Conversation({row,live,close}:{row:SessionRow;live:SessionRow|undefined;close:()=>void}){
 const w=useWorkspace(),t=w.t,now:number=w.clock;
 const available=!!live&&fresh(live.device,20000)&&(w.demo||w.connection.state==='live');
 const noControl=row.device.allow_control===false,caps:string[]=row.capabilities||[],{mode,photos:photosOk,replies}=sendMode(caps);
 const work=workState(row,now);
 const [thread,setThread]=useState<Mail[]>(()=>w.demo?demoThread(row.id,t):[]);
 const [sending,setSending]=useState(false),[error,setError]=useState(''),[rejected,setRejected]=useState<string[]>([]);
 const scroll=useRef<React.ComponentRef<typeof ScrollView>>(null),mounted=useRef(true);
 useEffect(()=>()=>{mounted.current=false;},[]);
 const draft:{text:string;photos:Photo[]}=w.draft,setDraft=w.setDraft;
 useEffect(()=>{
  if(w.demo||!replies||w.connection.state!=='live')return;
  const refresh=()=>w.connection.readMailbox(row);
  refresh();const timer=setInterval(refresh,5000);return()=>clearInterval(timer);
  // Identity and connection changes define the subscription; snapshots refresh separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[row.id,row.device.id,row.control_key,replies,w.demo,w.connection.state]);
 // Merge external socket events into this session's timeline. The connection only passes the reply to
 // the latest request, and this screen also checks it is for this computer and session.
 /* eslint-disable react-hooks/set-state-in-effect */
 useEffect(()=>{
  const response=w.connection.mailbox;
  if(!response||response.device_id!==row.device.id||response.session_id!==row.id)return;
  if(response.error){setError(response.error);return;}
  setError('');
  setThread(old=>{const server:Mail[]=response.messages||[];
   const merged=server.map(m=>{const mine=old.find(o=>o.id===m.id);return mine?.photos?{...m,photos:mine.photos}:m;});
   const waiting=old.filter(o=>o.local&&!o.instruction&&!server.some(m=>m.id===o.id)).map(o=>Date.now()/1000-o.created>30?{...o,status:'delivery_unconfirmed'}:o);
   return [...merged,...waiting,...old.filter(o=>o.instruction)];});
 },[w.connection.mailbox,row.device.id,row.id]);
 useEffect(()=>{
  const receipt=w.connection.receipt;if(!receipt)return;
  setThread(old=>old.map(m=>m.id===receipt.request.request_id&&m.status==='sending'?{...m,status:receipt.status==='failed'?'delivery_unconfirmed':m.instruction?'instruction_sent':'awaiting_reply'}:m));
  if(receipt.request.session_id===row.id&&receipt.request.device_id===row.device.id&&receipt.status==='failed')setError(receipt.message);
 },[w.connection.receipt,row.id,row.device.id]);
 /* eslint-enable react-hooks/set-state-in-effect */

 const shown=thread.map(m=>({...m,status:effectiveStatus(m,now/1000)}));
 const activity=responseActivity(shown,work);
 const photos=draft.photos,blocked=photos.length>0&&!photosOk;
 const canSend=available&&!noControl&&mode!=='none'&&!sending&&!w.pending[row.key]&&!blocked&&draft.text.length<=TEXT_MAX&&(draft.text.trim().length>0||photos.length>0);

 async function addPhotos(){
  setRejected([]);
  try{const out=await pickPhotos(PHOTO_MAX-photos.length);if(out.photos.length)setDraft((d:typeof draft)=>({...d,photos:[...d.photos,...out.photos].slice(0,PHOTO_MAX)}));setRejected(out.rejected.map(r=>rejectionText(r,t)));}
  catch(e:any){setRejected([e.message]);}
 }
 async function send(){
  if(!live||!canSend)return;
  const body=draft.text.trim()?draft.text:defaultPrompt(t);setError('');
  if(mode==='prompt'){
   // Older computers take a text instruction only; it is confirmed first and cannot be answered here.
   w.control(live,'prompt',body,(id:string,outcome:string)=>{if(outcome==='failed'||!mounted.current)return;
    setThread(old=>[...old,{id,text:body,created:Date.now()/1000,status:outcome==='sent'?(w.demo?'instruction_sent':'sending'):'delivery_unconfirmed',reply:'',local:true,instruction:true}]);setDraft((d:typeof draft)=>({...d,text:''}));});
   return;
  }
  const id=Crypto.randomUUID(),sent:Mail={id,text:body,created:Date.now()/1000,status:'sending',reply:'',local:true,photos:photos.map(p=>({uri:p.uri})),attachments:photos.map(p=>({name:p.name,mime:p.mime,bytes:p.bytes}))};
  setSending(true);
  try{
   await w.sendMessage(live,body,id,photos.map(p=>({mime:p.mime,data:p.data})));
   setThread(old=>[...old,{...sent,status:w.demo?'awaiting_reply':'sending'}]);setDraft({text:'',photos:[]});
   if(w.demo){
    // Demo only: the reply goes through the computer's three phases, then arrives and the activity ends.
    const step=(after:number,change:Partial<Mail>)=>setTimeout(()=>{if(mounted.current)setThread(old=>old.map(m=>m.id===id?{...m,...change}:m));},after);
    (['responding','working','writing'] as Phase[]).forEach((phase,i)=>step(i*2000,{activity:{phase,observed_at:Date.now()/1000+i*2}}));
    step(6500,{status:'replied',activity:null,reply:t('Demo reply: I looked at it and will fix it after the current test run.','예시 답신: 확인했습니다. 지금 돌고 있는 테스트가 끝나면 고치겠습니다.'),reply_at:Date.now()/1000+6.5});
   }
  }catch(e:any){
   // A refused send keeps the draft and photos. No answer means it may have arrived: never resend on our own.
   if(sendOutcome(e)==='failed')setError(e.message+' '+t('Your text and photos are kept.','작성한 내용과 사진은 그대로 있습니다.'));
   else{setThread(old=>[...old,{...sent,status:'delivery_unconfirmed'}]);setDraft({text:'',photos:[]});setError(t('No answer from the relay. The message may still arrive; check the session before sending again.','릴레이 응답이 없습니다. 전달됐을 수 있으니 다시 보내기 전에 세션을 확인하세요.'));}
  }finally{if(mounted.current)setSending(false);}
 }

 const controls=Object.entries({focus:t('Open on computer','컴퓨터에서 열기'),pause:t('Pause','일시정지'),resume:t('Resume','재개'),terminate:t('Quit CLI','CLI 종료')}).filter(([a])=>caps.includes(a));
 const reported=new Date(row.device.received).toLocaleTimeString();
 return <SafeAreaView style={st.fill}>
  <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
   <View style={st.head}>
    <View style={{flex:1,minWidth:0}}><Text numberOfLines={1} style={st.title}>{row.project||row.title||row.terminal||t('Session','세션')}</Text>
     <Text numberOfLines={1} style={st.sub}>{[row.device.name,row.app,row.terminal,tool(row),row.model].filter(Boolean).join(' · ')}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Close','닫기')} onPress={close} style={st.close}><Text style={{color:c.ink,fontSize:16}}>✕</Text></Pressable>
   </View>
   {/* The session's work stays in view while composing. */}
   <View testID="work-state" style={st.strip}>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><StateMark status={mark(work)}/><Text style={{color:work==='offline'||work==='stale'?c.amber:c.ink,fontSize:13,fontWeight:'600'}}>{workLabel(work,t)}</Text>
     <Text numberOfLines={1} style={{color:c.dim,fontSize:11.5,flexShrink:1}}>{(work==='offline'||work==='stale'?t('Last report ','마지막 보고 '):t('Report ','보고 '))+reported}</Text></View>
    {noControl?<Text style={st.note}>{t('This computer was connected without remote control. You can watch it here; messages and controls are off.','이 컴퓨터는 원격 제어 없이 연결되었습니다. 여기서 볼 수만 있고 메시지와 제어는 꺼져 있습니다.')}</Text>
     :!!controls.length&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{controls.map(([action,label])=><Pressable key={action} accessibilityRole="button" disabled={!available||!!w.pending[row.key]} onPress={()=>live&&w.control(live,action)} style={({pressed})=>[st.chip,(!available||!!w.pending[row.key])&&{opacity:.4},pressed&&{backgroundColor:c.raised}]}><Text style={{color:action==='terminate'?c.red:c.ink,fontSize:12,fontWeight:'600'}}>{label}</Text></Pressable>)}</View>}
    {!noControl&&!available&&<Text style={st.note}>{t('Sending and controls need a fresh report from this computer.','보내기와 제어는 이 컴퓨터의 최신 보고가 있어야 합니다.')}</Text>}
    {!!w.controlMessages[row.key]&&<Text style={st.note}>{w.controlMessages[row.key].message}</Text>}
   </View>
   <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={{padding:16,gap:14}} onContentSizeChange={()=>scroll.current?.scrollToEnd({animated:false})} onLayout={()=>scroll.current?.scrollToEnd({animated:false})} keyboardShouldPersistTaps="handled">
    {!shown.length&&<View style={{paddingVertical:20,gap:8}}><Text style={{color:c.ink,fontSize:18,fontWeight:'600'}}>{noControl?t('No conversation','대화가 없습니다'):t('Ask or tell this session','이 세션에 묻거나 맡기세요')}</Text>
     {!noControl&&<Text style={{color:c.muted,fontSize:14,lineHeight:21}}>{t('“How far along are you?” · “Fix the failing test next.”','“지금 어디까지 진행됐어?” · “이어서 실패한 테스트 고쳐 줘.”')}</Text>}</View>}
    {shown.map(m=><View key={m.id} style={{gap:8}}>
     <View style={st.mine}>
      {!!m.photos?.length&&<View style={{flexDirection:'row',gap:6,marginBottom:8}}>{m.photos.map((p,i)=><Image key={i} source={{uri:p.uri}} style={st.sent} accessibilityLabel={t(`Photo ${i+1}`,`사진 ${i+1}`)}/>)}</View>}
      {!m.photos?.length&&!!m.attachments?.length&&<Text style={{color:c.muted,fontSize:12,marginBottom:6}}>▣ {attachmentSummary(m.attachments,t)}</Text>}
      <Text selectable style={{color:c.ink,fontSize:15.5,lineHeight:22}}>{m.text}</Text>
      <Text style={{marginTop:6,fontSize:11.5,color:deliveryTone(m.status)==='problem'?c.amber:c.muted}}>{deliveryLabel(m.status,t)}</Text>
     </View>
     {!!m.reply&&<View style={st.reply}><Text style={{color:c.muted,fontSize:11.5,marginBottom:6}}>{t('Reply from the session','세션의 답신')}</Text><Text selectable style={{color:c.ink,fontSize:15.5,lineHeight:23}}>{m.reply}</Text>{m.truncated&&<Text style={{color:c.muted,fontSize:12,marginTop:6}}>{t('Long reply shortened.','긴 답신의 일부를 표시합니다.')}</Text>}</View>}
    </View>)}
   </ScrollView>
   {activity&&<Typing label={activityLabel(activity.phase,t)}/>}
   {noControl?null:<View style={st.composer}>
    {mode==='prompt'&&<Text style={[st.note,{color:c.amber}]}>{t('This computer’s 1top cannot send replies. Your text goes as an instruction only; check the answer on the computer.','이 컴퓨터의 1top은 답신을 보낼 수 없습니다. 입력한 내용은 지시로만 전달되며, 답은 컴퓨터에서 확인해야 합니다.')}</Text>}
    {mode==='none'&&<Text style={st.note}>{t('This session cannot take input right now. For a running terminal, pause the work first.','이 세션은 지금 입력을 받을 수 없습니다. 실행 중인 터미널은 먼저 작업을 멈춘 뒤 확인하세요.')}</Text>}
    {blocked&&<Text style={[st.note,{color:c.amber}]}>{t('This session cannot take photos. Your photos are kept but will not be sent; remove them to send text, or open a session that takes photos.','이 세션은 사진을 받을 수 없습니다. 고른 사진은 남겨 두었고 보내지 않습니다. 글만 보내려면 사진을 빼거나, 사진을 받는 세션을 여세요.')}</Text>}
    {rejected.map((r,i)=><Text key={i} style={[st.note,{color:c.amber}]}>{r}</Text>)}
    {!!error&&<Text style={[st.note,{color:c.red}]}>{error}</Text>}
    {!!photos.length&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{photos.map((p,i)=><View key={p.id} testID="photo-preview">
     <Image source={{uri:p.uri}} style={st.thumb} accessibilityLabel={t(`Photo ${i+1}, ${kb(p.bytes)}`,`사진 ${i+1}, ${kb(p.bytes)}`)}/>
     <Pressable accessibilityRole="button" accessibilityLabel={t(`Remove photo ${i+1}`,`사진 ${i+1} 빼기`)} onPress={()=>setDraft((d:typeof draft)=>({...d,photos:d.photos.filter(x=>x.id!==p.id)}))} style={st.remove}><Text style={{color:c.ink,fontSize:11,lineHeight:13}}>✕</Text></Pressable>
     <Text style={{color:c.dim,fontSize:10.5,textAlign:'center',marginTop:3}}>{kb(p.bytes)}</Text></View>)}</ScrollView>}
    <View style={{flexDirection:'row',alignItems:'flex-end',gap:8}}>
     {mode==='message'&&photosOk&&<Pressable accessibilityRole="button" accessibilityLabel={t('Add photos','사진 추가')} disabled={photos.length>=PHOTO_MAX||sending} onPress={addPhotos} style={[st.icon,(photos.length>=PHOTO_MAX||sending)&&{opacity:.4}]}><Text style={{color:c.ink,fontSize:18,lineHeight:20}}>＋</Text></Pressable>}
     <TextInput accessibilityLabel={mode==='prompt'?t('Instruction','지시 내용'):t('Message to this session','이 세션에 보낼 메시지')} multiline maxLength={TEXT_MAX} editable={mode!=='none'} value={draft.text} onChangeText={(text:string)=>setDraft((d:typeof draft)=>({...d,text}))} placeholder={mode==='prompt'?t('Instruction, e.g. continue and fix the errors','지시, 예: 이어서 오류 고쳐 줘'):t('Ask or tell this session…','질문이나 할 일을 입력하세요…')} placeholderTextColor={c.dim} style={st.input}/>
     <Pressable accessibilityRole="button" disabled={!canSend} onPress={send} style={[st.send,!canSend&&{opacity:.35}]}><Text style={{color:'#0b0d0f',fontSize:13.5,fontWeight:'700'}}>{sending?t('Sending','전송 중'):mode==='prompt'?t('Instruct','지시'):t('Send','보내기')}</Text></Pressable>
    </View>
    <Text style={{color:c.dim,fontSize:11}}>{draft.text.length.toLocaleString()}/4,000{photos.length?' · '+t(`${photos.length}/3 photos`,`사진 ${photos.length}/3`):''} · {t('Sending can use AI tokens.','보내면 AI 토큰을 쓸 수 있습니다.')}</Text>
   </View>}
  </KeyboardAvoidingView>
 </SafeAreaView>;
}

/** The computer's activity on the latest request: three dots that rise in turn, apart from the messages.
 *  One label for screen readers, not a live region, so it is not read again on every phase. */
function Typing({label}:{label:string}){
 const [phase]=useState(()=>new Animated.Value(0)),[still,setStill]=useState(false);
 useEffect(()=>{let alive=true;AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(alive)setStill(v);}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>{if(still)return;const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:1400,easing:Easing.linear,useNativeDriver:motion}));loop.start();return()=>{loop.stop();phase.setValue(0);};},[still,phase]);
 return <View testID="typing-indicator" accessible accessibilityLabel={label} style={st.typing}>
  <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{flexDirection:'row',alignItems:'center',gap:3,height:10}}>
   {[0,1,2].map(i=>{const a=.08+i*.14,b=a+.14,e=b+.14;return <Animated.View key={i} style={{width:5,height:5,borderRadius:3,backgroundColor:c.muted,
    opacity:still?.75:phase.interpolate({inputRange:[0,a,b,e,1],outputRange:[.4,.4,1,.4,.4]}),transform:[{translateY:still?0:phase.interpolate({inputRange:[0,a,b,e,1],outputRange:[0,0,-2.5,0,0]})}]}}/>;})}
  </View>
  <Text importantForAccessibility="no" style={{color:c.muted,fontSize:12}}>{label}</Text>
 </View>;
}

const st=StyleSheet.create({
 fill:{flex:1,backgroundColor:c.bg},
 head:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingTop:10,paddingBottom:8},
 title:{color:c.ink,fontSize:18,fontWeight:'600'},sub:{color:c.muted,fontSize:12,marginTop:2},
 close:{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:c.raised},
 strip:{gap:8,marginHorizontal:12,padding:12,borderRadius:12,borderWidth:1,borderColor:c.line,backgroundColor:c.card},
 chip:{paddingHorizontal:11,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:c.line},
 note:{color:c.muted,fontSize:12,lineHeight:18},
 mine:{alignSelf:'flex-end',maxWidth:'88%',backgroundColor:c.mine,paddingHorizontal:14,paddingVertical:11,borderRadius:16,borderBottomRightRadius:5},
 reply:{alignSelf:'flex-start',maxWidth:'92%',backgroundColor:c.card,borderWidth:1,borderColor:c.line,paddingHorizontal:14,paddingVertical:11,borderRadius:16,borderBottomLeftRadius:5},
 sent:{width:72,height:72,borderRadius:8,backgroundColor:c.raised},
 typing:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:18,paddingVertical:6},
 composer:{gap:8,paddingHorizontal:12,paddingTop:10,paddingBottom:12,borderTopWidth:1,borderTopColor:c.line,backgroundColor:c.bg},
 thumb:{width:64,height:64,borderRadius:8,backgroundColor:c.raised},
 remove:{position:'absolute',top:-6,right:-6,width:20,height:20,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:'#3a434b',borderWidth:1,borderColor:c.bg},
 icon:{width:40,height:40,borderRadius:20,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:c.line,backgroundColor:c.card},
 input:{flex:1,minHeight:40,maxHeight:140,paddingHorizontal:12,paddingTop:10,paddingBottom:10,borderRadius:12,borderWidth:1,borderColor:c.line,backgroundColor:c.card,color:c.ink,fontSize:15,textAlignVertical:'top'},
 send:{height:40,paddingHorizontal:14,borderRadius:20,alignItems:'center',justifyContent:'center',backgroundColor:c.ink},
});
