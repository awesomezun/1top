import React,{useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,Easing,Image,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {StateMark} from './state-mark';
import {demoThread} from './demo';
import {WORLD} from './demo-world';
import {scriptStep} from './demo-model';
import {now as shownNow} from './clock';
import {fresh,projectName} from './metrics';
import {accountTags,short} from './fleet';
import {toolWithAccount,shortModel,periodLabel} from './ui';
import {Icon,type IconName} from './icons';
import {resetComposer} from '../modules/composer-reset';
import {onTheme,quick as c,toolColor,toolName} from './theme';
import {pickPhotos,rejectionText} from './photos';
import {activityLabel,attachmentSummary,bringBack,defaultPrompt,deliveryIcon,deliveryLabel,deliveryMeaning,deliveryTone,effectiveStatus,EMPTY,forward,kb,mergeMailbox,PHOTO_MAX,responseActivity,sendFailed,sendMode,sendOutcome,sendUnconfirmed,startSend,TEXT_MAX,workLabel,workState,type Convo,type Mail,type Work} from './thread';
import type {SessionRow} from './types';

// One conversation per session, as in a chat app: its live work at the top, then the messages with the AI's
// under them, then one composer. A small state sits under each sent message, apart from the session's work.
// The demo's pictures: the conversation script's checkout screen (demo-world.js) and a plain one, as on
// the iPhone; the relay itself returns no image data.
const DEMO_PHOTOS:Record<string,number>={'demo:checkout':require('../assets/demo/checkout.png'),'demo:2':require('../assets/demo/photo-2.png')};
const photoSource=(uri:string)=>DEMO_PHOTOS[uri]??{uri};
// QA and filming only (onetop://?qaDemoImages=N in the demo): the same pictures in the composer, the script's first, as on the iPhone.
const TINY_PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const QA_PHOTOS=[1,2,3].map(n=>({id:'qa-'+n,uri:n===1?'demo:checkout':'demo:2',name:n===1?'checkout.png':'IMG_04'+(13+n)+'.png',mime:'image/png',data:TINY_PNG,bytes:180_000}));
const mark=(work:Work)=>work==='working'||work==='waiting'||work==='paused'?work:'idle';
const motion=Platform.OS!=='web';

export function SessionDetails({row,close}:{row:SessionRow|null;close:()=>void}){
 const w=useWorkspace(),live:SessionRow|undefined=row?w.rows.find((r:SessionRow)=>r.key===row.key):undefined,current=live||row;
 // A new session mounts a new screen, so nothing of the previous session's timeline or state shows.
 return <Modal visible={!!row} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>{current&&<Conversation key={current.key} row={current} live={live} close={close}/>}</Modal>;
}

function Conversation({row,live,close}:{row:SessionRow;live:SessionRow|undefined;close:()=>void}){
 const w=useWorkspace(),t=w.t,now:number=w.clock,key=row.key;
 const available=!!live&&fresh(live.device,20000)&&(w.demo||w.connection.state==='live');
 const noControl=row.device.allow_control===false,caps:string[]=row.capabilities||[],{mode,photos:photosOk,replies}=sendMode(caps);
 const work=workState(row,now);
 // This session's own draft and timeline live in the workspace, keyed by device and session.
 const seed=():Mail[]=>w.demo?demoThread(row.id,w.lang):[];
 const convo:Convo=w.convos[key]??{draft:EMPTY,thread:seed()};
 const change=(fn:(c:Convo)=>Convo)=>w.updateConvo(key,fn,seed());
 const draft=convo.draft,thread=convo.thread;
 const [picking,setPicking]=useState(false),[error,setError]=useState(''),[rejected,setRejected]=useState<string[]>([]);
 const scroll=useRef<React.ComponentRef<typeof ScrollView>>(null);
 // The newest message stays in view. The AI's message comes as the dots and the sent message's state go, and
 // the first scroll can land before that layout is on screen, so it scrolls once more just after.
 const toEnd=()=>{scroll.current?.scrollToEnd({animated:false});setTimeout(()=>scroll.current?.scrollToEnd({animated:false}),150);};
 // A send hands the composer back to Android's keyboard afresh (modules/composer-reset); otherwise the
 // keyboard types the word it was composing back in front of the next key.
 const field=useRef<React.ComponentRef<typeof TextInput>>(null);
 useEffect(()=>{if(w.demo&&w.qaPhotos>0&&photosOk&&!w.convos[key])change(c=>({...c,draft:{...c.draft,photos:QA_PHOTOS.slice(0,w.qaPhotos),...(w.qaScript?{text:WORLD.conversation.script.text[w.lang as 'ko'|'en'|'zh']}:{})}}));
  // Once, when a demo conversation first opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{
  if(w.demo||!replies||w.connection.state!=='live')return;
  const refresh=()=>w.connection.readMailbox(row);
  refresh();const timer=setInterval(refresh,5000);return()=>clearInterval(timer);
  // Identity and connection changes define the subscription; snapshots refresh separately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[row.id,row.device.id,row.control_key,replies,w.demo,w.connection.state]);
 // The connection passes only the answer to the latest request; this screen also checks it is for this
 // computer and session, then merges it by request so nothing it leaves out disappears.
 useEffect(()=>{
  const response=w.connection.mailbox;
  if(!response||response.device_id!==row.device.id||response.session_id!==row.id)return;
  if(response.error){setError(response.error);return;}
  setError('');w.updateConvo(key,(c:Convo)=>({...c,thread:mergeMailbox(c.thread,response.messages||[])}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[w.connection.mailbox,row.device.id,row.id,key]);

 const shown=thread.map(m=>({...m,status:effectiveStatus(m,now/1000)}));
 const activity=responseActivity(shown,work);
 const photos=draft.photos,blocked=photos.length>0&&!photosOk;
 // Sending goes at once, with no confirmation: what this session does with a message is said where it is written.
 const placeholder=mode==='prompt'?t('Instructions only. Write an instruction…','지시만 받는 세션입니다. 지시를 입력하세요…')
  :mode==='message'&&work==='working'?t('Sends after the current work…','지금 작업이 끝나면 차례로 보냅니다…'):t('Write a message…','메시지를 입력하세요…');
 // Messages can follow one another without waiting; a prompt-only computer takes one instruction at a time.
 const canSend=available&&!noControl&&mode!=='none'&&!(mode==='prompt'&&w.pending[key])&&!blocked&&draft.text.length<=TEXT_MAX&&(draft.text.trim().length>0||photos.length>0);

 async function addPhotos(){
  setRejected([]);setPicking(true);
  try{const out=await pickPhotos(PHOTO_MAX-photos.length);if(out.photos.length)change(c=>({...c,draft:{...c.draft,photos:[...c.draft.photos,...out.photos].slice(0,PHOTO_MAX)}}));setRejected(out.rejected.map(r=>rejectionText(r,t)));}
  catch(e:any){setRejected([e.message]);}
  finally{setPicking(false);}
 }
 async function send(){
  if(!live||!canSend)return;
  const sent=draft,body=sent.text.trim()?sent.text:defaultPrompt(t);setError('');
  if(mode==='prompt'){
   // Older computers take a text instruction only; it goes at once, as a message does, and cannot be answered here.
   w.control(live,'prompt',body,(id:string,outcome:string)=>{if(outcome==='failed')return;
    if(draft.text===sent.text)resetComposer(field.current,sent.text);
    w.updateConvo(key,(c:Convo)=>({draft:c.draft.text===sent.text?{...c.draft,text:''}:c.draft,thread:[...c.thread,{id,text:body,created:shownNow()/1000,status:outcome==='sent'?(w.demo?'instruction_sent':'sending'):'delivery_unconfirmed',reply:'',local:true,instruction:true}]}));});
   return;
  }
  const id=Crypto.randomUUID();
  // The composer empties now, so the next message can be written while this one travels.
  resetComposer(field.current,sent.text);
  change(c=>startSend(c,{id,text:body,created:shownNow()/1000,status:'sending',reply:'',local:true,draft:sent,photos:sent.photos.map(p=>({uri:p.uri})),attachments:sent.photos.map(p=>({name:p.name,mime:p.mime,bytes:p.bytes}))}));
  try{
   await w.sendMessage(live,body,id,sent.photos.map(p=>({mime:p.mime,data:p.data})));
   // Success leaves every draft alone: the reader may already be writing here or in another session.
   if(w.demo){
    // Demo only: the conversation script (demo-world.js), as on the web: taken in, delivered, the session's
    // three phases, then the scripted reply, each at its time after sending. The text and photos stay, and
    // delivery only moves forward, except that the computer's queue is the truth over 'sending', as on the web.
    for(const step of WORLD.conversation.script.steps)setTimeout(()=>{const at=shownNow()/1000;
     w.updateConvo(key,(c:Convo)=>({...c,thread:c.thread.map(m=>{if(m.id!==id)return m;const next=scriptStep(WORLD,step,w.lang,at);return {...m,...next,status:next.status==='queued'&&m.status==='sending'?'queued':forward(m.status,next.status)};})}));},step.at*1000);
   }
  }catch(e:any){
   // A refusal (4xx) brings the text and photos back only into an empty composer; otherwise they stay on
   // the refused message. No answer, a timeout or a server error may still have delivered it: never resend.
   if(sendOutcome(e)==='failed'){w.updateConvo(key,(c:Convo)=>sendFailed(c,id,e.message));setError(e.message);}
   else{w.updateConvo(key,(c:Convo)=>sendUnconfirmed(c,id));setError(deliveryMeaning('delivery_unconfirmed',t));}
  }
 }

 const controls=Object.entries({focus:t('Open','열기'),pause:t('Pause','일시정지'),resume:t('Resume','재개'),terminate:t('Quit CLI','CLI 종료')}).filter(([a])=>caps.includes(a));
 const reported=w.when(row.device.received),tags=accountTags(w.devices||[]),name=row.terminal||projectName(row,t)||row.title||t('Session','세션');
 const sum=(v:unknown)=>Array.isArray(v)?v.reduce((a:number,b:number)=>a+b,0):null;
 return <SafeAreaView style={st.fill}>
  {/* Android draws edge to edge, so the window no longer resizes for the keyboard: lift the composer here too. */}
  <KeyboardAvoidingView style={{flex:1}} behavior="padding">
   <View style={st.head}>
    {/* The title in the middle, as on the iPhone's sheet; where it runs goes on the first line below. */}
    <View style={{width:34}}/><Text numberOfLines={1} style={[st.title,{flex:1,textAlign:'center'}]}>{name}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Close','닫기')} onPress={close} style={st.close}><Icon name="close" size={18} color={c.ink}/></Pressable>
   </View>
   {/* The session's work stays in view while composing. */}
   <View testID="work-state" style={st.strip}>
    <Text numberOfLines={1} style={st.sub}>{[row.device.name,row.app,row.terminal===name?'':row.terminal,row.kind==='Aside'?'':toolWithAccount(row,tags,w.period),shortModel(row.model)].filter(Boolean).join(' · ')}</Text>
    <View style={{flexDirection:'row',alignItems:'center',gap:8}}><StateMark status={mark(work)}/><Text style={{color:work==='offline'||work==='stale'?c.amber:c.ink,fontSize:13,fontWeight:'600'}}>{workLabel(work,t)}</Text>
     <Text numberOfLines={1} style={{color:c.dim,fontSize:11.5,flexShrink:1}}>{t('Last report ','마지막 보고 ')+reported}</Text></View>
    <Text numberOfLines={1} style={{color:c.muted,fontSize:12,fontVariant:['tabular-nums']}}>{[t('Total ','누적 ')+short(sum(row.tokens)),(()=>{const label=periodLabel(w.period,t);return t(`Last ${label}`,`최근 ${label}`)+' '+short(sum(row.windows?.[w.period as keyof typeof row.windows]));})(),row.rate===null?'—':short(row.rate*3600)+t(' tokens/h',' tokens/시간')].join(' · ')}</Text>
    {noControl?<Text style={st.note}>{t('This computer was connected without remote control. You can watch it here; messages and controls are off.','이 컴퓨터는 원격 제어 없이 연결되었습니다. 여기서 볼 수만 있고 메시지와 제어는 꺼져 있습니다.')}</Text>
     :!!controls.length&&<View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{controls.map(([action,label])=><Pressable key={action} accessibilityRole="button" disabled={!available||!!w.pending[row.key]} onPress={()=>live&&w.control(live,action)} style={({pressed})=>[st.chip,(!available||!!w.pending[row.key])&&{opacity:.4},pressed&&{backgroundColor:c.line}]}><Icon name={action as IconName} size={16} color={action==='terminate'?c.soft:c.ink} cut={c.raised}/><Text style={{color:action==='terminate'?c.soft:c.ink,fontSize:13,fontWeight:'600'}}>{label}</Text></Pressable>)}</View>}
    {!noControl&&!available&&<Text style={st.note}>{t('Sending and controls need a fresh report from this computer.','보내기와 제어는 이 컴퓨터의 최신 보고가 있어야 합니다.')}</Text>}
    {!!w.controlMessages[row.key]&&<Text style={st.note}>{w.controlMessages[row.key].message}</Text>}
   </View>
   <ScrollView ref={scroll} style={{flex:1}} contentContainerStyle={{padding:16,gap:14}} onContentSizeChange={toEnd} onLayout={toEnd} keyboardShouldPersistTaps="handled">
    <Text style={st.note}>{t('Only chats from 1top show here.','1top에서 나눈 대화만 표시됩니다.')}</Text>
    {!shown.length&&<View style={{paddingVertical:20,gap:8}}><Text style={{color:c.ink,fontSize:18,fontWeight:'600'}}>{noControl?t('No conversation','대화가 없습니다'):t('Ask or tell this session','이 세션에 묻거나 맡기세요')}</Text>
     {!noControl&&<Text style={{color:c.muted,fontSize:14,lineHeight:21}}>{t('“How far along are you?” · “Fix the failing test next.”','“지금 어디까지 진행됐어?” · “이어서 실패한 테스트 고쳐 줘.”')}</Text>}</View>}
    {shown.map(m=><View key={m.id} style={{gap:8}}>
     <View style={st.mine}>
      {!!m.photos?.length&&<View style={{flexDirection:'row',gap:6,marginBottom:8}}>{m.photos.map((p,i)=><Image key={i} source={photoSource(p.uri)} style={st.sent} accessibilityLabel={t(`Photo ${i+1}`,`사진 ${i+1}`)}/>)}</View>}
      {!m.photos?.length&&!!m.attachments?.length&&<View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6}}><Icon name="photo" size={15} color={c.muted}/><Text style={{color:c.muted,fontSize:12,flexShrink:1}}>{attachmentSummary(m.attachments,t)}</Text></View>}
      <Text selectable style={{color:c.ink,fontSize:15.5,lineHeight:22}}>{m.text}</Text>
     </View>
     {(()=>{const label=deliveryLabel(m.status,t),meaning=deliveryMeaning(m.status,t);if(!label)return null;
      const tone=m.status==='not_delivered'||m.status==='not_sent'?c.soft:deliveryTone(m.status)==='problem'?c.amber:c.dim;
      return <View testID="mail-status" accessible accessibilityLabel={meaning?label+(w.lang==='zh'?'，':'. ')+meaning:label} style={st.state}><Icon name={deliveryIcon(m.status)} size={12} color={tone}/><Text style={{fontSize:11.5,color:tone}}>{label}</Text></View>;})()}
     {m.status==='not_sent'&&<>{!!m.error&&<Text style={{alignSelf:'flex-end',marginTop:-4,fontSize:11.5,color:c.muted}}>{m.error}</Text>}
      {!!m.draft&&<Pressable testID="bring-back" accessibilityRole="button" onPress={()=>change(cv=>bringBack(cv,m.id))} style={st.bring}><Text style={{color:c.ink,fontSize:12,fontWeight:'600'}}>{t('Try again','다시 시도')}</Text></Pressable>}</>}
     {!!m.reply&&<View style={{gap:6}}>
      <View testID="mail-from" style={st.from}><Icon name="sparkle" size={14} color={toolColor(row.kind)}/><Text style={{color:c.muted,fontSize:12,fontWeight:'600'}}>{toolName(row.kind)}</Text></View>
      <View style={st.reply}><Text selectable style={{color:c.ink,fontSize:15.5,lineHeight:23}}>{m.reply}</Text>{m.truncated&&<Text style={{color:c.muted,fontSize:12,marginTop:6}}>{t('Long message shortened.','길어서 앞부분만 표시합니다.')}</Text>}</View>
     </View>}
    </View>)}
   </ScrollView>
   {activity&&<Typing label={activityLabel(activity.phase,t)}/>}
   {noControl?null:<View style={st.composer}>
    {mode==='prompt'&&<Text style={[st.note,{color:c.amber}]}>{t('This session takes instructions only. See the result on the computer.','이 세션은 지시만 받습니다. 결과는 컴퓨터에서 확인하세요.')}</Text>}
    {mode==='none'&&<Text style={st.note}>{t('This session cannot take input right now. For a running terminal, pause the work first.','이 세션은 지금 입력을 받을 수 없습니다. 실행 중인 터미널은 먼저 작업을 멈춘 뒤 확인하세요.')}</Text>}
    {blocked&&<Text style={[st.note,{color:c.amber}]}>{t('This session cannot take photos. Your photos are kept but will not be sent; remove them to send text, or open a session that takes photos.','이 세션은 사진을 받을 수 없습니다. 고른 사진은 남겨 두었고 보내지 않습니다. 글만 보내려면 사진을 빼거나, 사진을 받는 세션을 여세요.')}</Text>}
    {rejected.map((r,i)=><Text key={i} style={[st.note,{color:c.amber}]}>{r}</Text>)}
    {!!error&&<Text style={[st.note,{color:c.soft}]}>{error}</Text>}
    {!!photos.length&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>{photos.map((p,i)=><View key={p.id} testID="photo-preview">
     <Image source={photoSource(p.uri)} style={st.thumb} accessibilityLabel={t(`Photo ${i+1}, ${kb(p.bytes)}`,`사진 ${i+1}, ${kb(p.bytes)}`)}/>
     <Pressable accessibilityRole="button" accessibilityLabel={t(`Remove photo ${i+1}`,`사진 ${i+1} 빼기`)} onPress={()=>change(c=>({...c,draft:{...c.draft,photos:c.draft.photos.filter(x=>x.id!==p.id)}}))} style={st.remove}><Icon name="close" size={11} color={c.ink}/></Pressable>
     <Text style={{color:c.dim,fontSize:10.5,textAlign:'center',marginTop:3}}>{kb(p.bytes)}</Text></View>)}</ScrollView>}
    <View style={{flexDirection:'row',alignItems:'flex-end',gap:8}}>
     {mode==='message'&&photosOk&&<Pressable accessibilityRole="button" accessibilityLabel={t('Add photos','사진 추가')} disabled={photos.length>=PHOTO_MAX||picking} onPress={addPhotos} style={[st.icon,(photos.length>=PHOTO_MAX||picking)&&{opacity:.4}]}><Icon name="photo" size={20} color={c.ink}/></Pressable>}
     <TextInput ref={field} accessibilityLabel={mode==='prompt'?t('Instruction','지시 내용'):t('Message to this session','이 세션에 보낼 메시지')} multiline maxLength={TEXT_MAX} editable={mode!=='none'} value={draft.text} onChangeText={(text:string)=>change(c=>({...c,draft:{...c.draft,text}}))} placeholder={placeholder} placeholderTextColor={c.dim} style={st.input}/>
     <Pressable accessibilityRole="button" accessibilityLabel={mode==='prompt'?t('Instruct','지시'):t('Send','보내기')} disabled={!canSend} onPress={send} style={[st.send,!canSend&&{opacity:.35}]}><Icon name="send" size={20} color={c.onAccent}/></Pressable>
    </View>
    <Text style={{color:c.dim,fontSize:11}}>{photos.length?t(`${photos.length}/3 photos`,`사진 ${photos.length}/3`)+' · ':''}{t('Messages can use AI tokens.','메시지를 보내면 AI 토큰이 쓰일 수 있습니다.')}</Text>
   </View>}
  </KeyboardAvoidingView>
 </SafeAreaView>;
}

/** The computer's activity on the latest request: three dots that rise in turn, apart from the messages,
 *  sized like the desktop's. The phase is only read out to screen readers; the work state above already
 *  says the session is working. */
function Typing({label}:{label:string}){
 const [phase]=useState(()=>new Animated.Value(0)),[still,setStill]=useState(false);
 useEffect(()=>{let alive=true;AccessibilityInfo.isReduceMotionEnabled().then(v=>{if(alive)setStill(v);}).catch(()=>{});return()=>{alive=false;};},[]);
 useEffect(()=>{if(still)return;const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:1150,easing:Easing.linear,useNativeDriver:motion}));loop.start();return()=>{loop.stop();phase.setValue(0);};},[still,phase]);
 return <View testID="typing-indicator" accessible accessibilityLabel={label} style={st.typing}>
  <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{flexDirection:'row',alignItems:'center',gap:4,height:12}}>
   {[0,1,2].map(i=>{
    // The desktop's beat: a 1.15s cycle, each dot .14s after the last, highest at 40% of its own cycle.
    const d=i*.14/1.15,w=d/.6,lift=still?null:phase.interpolate({inputRange:i?[0,d,d+.4,1]:[0,.4,1],outputRange:i?[w,0,1,w]:[0,1,0],easing:Easing.inOut(Easing.ease)});
    return <Animated.View key={i} style={{width:6,height:6,borderRadius:3,backgroundColor:c.muted,
     opacity:lift?lift.interpolate({inputRange:[0,1],outputRange:[.3,.9]}):.6,transform:[{translateY:lift?lift.interpolate({inputRange:[0,1],outputRange:[0,-2.5]}):0}]}}/>;})}
  </View>
 </View>;
}

const make=()=>StyleSheet.create({
 fill:{flex:1,backgroundColor:c.background},
 head:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingTop:10,paddingBottom:8},
 title:{color:c.ink,fontSize:18,fontWeight:'600'},sub:{color:c.muted,fontSize:12,marginTop:2},
 close:{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:c.raised},
 strip:{gap:8,paddingHorizontal:16,paddingBottom:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:c.line},
 chip:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:12,height:34,borderRadius:17,backgroundColor:c.raised},
 note:{color:c.muted,fontSize:12,lineHeight:18},
 mine:{alignSelf:'flex-end',maxWidth:'88%',backgroundColor:c.mint+'2e',paddingHorizontal:14,paddingVertical:11,borderRadius:16,borderBottomRightRadius:5},
 reply:{alignSelf:'flex-start',maxWidth:'92%',backgroundColor:c.raised,paddingHorizontal:14,paddingVertical:11,borderRadius:16,borderBottomLeftRadius:5},
 sent:{width:72,height:72,borderRadius:8,backgroundColor:c.raised},
 typing:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:18,paddingVertical:6},
 composer:{gap:8,paddingHorizontal:12,paddingTop:10,paddingBottom:12,borderTopWidth:1,borderTopColor:c.line,backgroundColor:c.background},
 // A sent message's state sits just under it, at its edge; the AI's name just over its message.
 state:{alignSelf:'flex-end',flexDirection:'row',alignItems:'center',gap:4,marginTop:-4,marginRight:4},
 from:{flexDirection:'row',alignItems:'center',gap:6,marginLeft:2},
 bring:{alignSelf:'flex-end',marginTop:-2,paddingHorizontal:10,paddingVertical:6,borderRadius:8,borderWidth:1,borderColor:c.line},
 thumb:{width:64,height:64,borderRadius:8,backgroundColor:c.raised},
 remove:{position:'absolute',top:-6,right:-6,width:20,height:20,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:c.raised,borderWidth:1,borderColor:c.background},
 icon:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:c.raised},
 input:{flex:1,minHeight:44,maxHeight:140,paddingHorizontal:14,paddingTop:11,paddingBottom:11,borderRadius:22,borderWidth:1,borderColor:c.line,backgroundColor:c.card,color:c.ink,fontSize:15,textAlignVertical:'top'},
 send:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:c.mint},
});
let st=make();onTheme(()=>{st=make();});
