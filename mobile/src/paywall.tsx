import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Linking,Modal,Pressable,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {quick} from './theme';
import {useLayout} from './customize';
import {PREVIEW,money,perMonth,saving,sortPlans,type Backend,type Plan} from './subscription';

// Paywall B (docs/design/subscription/paywall-options_v1.0.0), as on the iPhone (PaywallSheet.swift): over the demo a
// bar above the tabs leads to sign-in and the subscription; the sheet slides up over the demo, which stays where it
// was when the sheet closes.

/** Above the tab capsule while the demo shows: the examples are examples, and 내 컴퓨터 연결. */
export function DemoConnectBar(){
 const w=useWorkspace(),L=useLayout(),inset=useSafeAreaInsets();
 // The edit mode's sheets take the tabs' place, and the bar steps aside with them.
 if(!w.demo||L?.editing)return null;
 return <View pointerEvents="box-none" style={{position:'absolute',left:0,right:0,bottom:Math.max(inset.bottom,10)+6+66+8,alignItems:'center'}}>
  <View style={{flexDirection:'row',alignItems:'center',gap:10,width:'94%',maxWidth:460,paddingHorizontal:16,paddingVertical:10,borderRadius:26,
   backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine,shadowColor:'#000',shadowOpacity:.2,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:10}}>
   <View style={{width:7,height:7,borderRadius:4,backgroundColor:quick.amber}}/>
   <Text style={{flex:1,fontSize:13,color:quick.amber}}>{w.t('Example data','예시 데이터')}</Text>
   <Pressable testID="demo-connect" accessibilityRole="button" disabled={w.busy} onPress={()=>{w.connectFromDemo();}} hitSlop={8}>
    <Text style={{fontSize:14,fontWeight:'600',color:quick.segmentOn}}>{w.busy?w.t('Connecting…','연결하는 중…'):w.t('＋ Connect my computer','＋ 내 컴퓨터 연결')}</Text>
   </Pressable>
  </View>
 </View>;
}

export function PaywallSheet({backend=PREVIEW}:{backend?:Backend}){
 const w=useWorkspace(),t=w.t,inset=useSafeAreaInsets();
 const [plans,setPlans]=useState<Plan[]>([]),[chosen,setChosen]=useState<string|null>(null),[phase,setPhase]=useState<'idle'|'buying'|'restoring'|'waiting'>('idle'),[note,setNote]=useState('');
 useEffect(()=>{if(!w.paywall||plans.length)return;backend.plans().then(p=>{const sorted=sortPlans(p);setPlans(sorted);setChosen(c=>c??sorted[0]?.id??null);}).catch(e=>setNote(e.message));},[w.paywall,plans.length,backend]);
 const plan=plans.find(p=>p.id===chosen)??plans[0],off=saving(plans),close=()=>w.setPaywall(false);
 const price=(p:Plan)=>money(p.amount,p.currency,w.lang==='zh'?'zh-CN':w.lang==='ko'?'ko-KR':'en-US');
 async function connectAfterPurchase(){setPhase('waiting');const ok=await w.awaitAccess();setPhase('idle');if(!ok)setNote(t('The subscription is active; your computer will connect in a moment.','구독이 시작됐습니다. 잠시 뒤 내 컴퓨터가 연결됩니다.'));}
 async function subscribe(){if(!plan)return;setPhase('buying');setNote('');let ok=false;try{ok=await backend.buy(plan.id);}catch(e:any){setNote(backend.live?e.message:t('Subscriptions open soon. Nothing was charged.','구독은 곧 열립니다. 결제된 것은 없습니다.'));}setPhase('idle');if(ok)await connectAfterPurchase();}
 async function restore(){setPhase('restoring');setNote('');let ok=false;try{ok=await backend.restore();if(!ok)setNote(t('No subscription was found for this Google account.','이 Google 계정으로 구독한 내역이 없습니다.'));}catch(e:any){setNote(e.message);}setPhase('idle');if(ok)await connectAfterPurchase();}
 const cta=plan?.trialDays?t(`Start ${plan.trialDays}-day free trial`,`${plan.trialDays}일 무료로 시작`):t('Subscribe','구독하기');
 const detail=plan?(plan.trialDays?(plan.yearly?t(`then ${price(plan)} a year`,`체험 후 연 ${price(plan)}`):t(`then ${price(plan)} a month`,`체험 후 월 ${price(plan)}`))
  :(plan.yearly?t(`${price(plan)} a year`,`연 ${price(plan)}`):t(`${price(plan)} a month`,`월 ${price(plan)}`)))+t(' · cancel any time',' · 언제든 취소'):'';
 const busy=phase!=='idle';
 return <Modal visible={!!w.paywall} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
  <View style={{flex:1,justifyContent:'flex-end'}}>
   <Pressable accessibilityLabel={t('Close','닫기')} onPress={close} style={{position:'absolute',top:0,left:0,right:0,bottom:0,backgroundColor:'rgba(0,0,0,0.45)'}}/>
   <View testID="paywall" style={{backgroundColor:quick.card,borderTopLeftRadius:22,borderTopRightRadius:22,borderTopWidth:1,borderColor:quick.line,paddingHorizontal:20,paddingTop:10,paddingBottom:Math.max(inset.bottom,12)+8,gap:12}}>
    <View style={{alignSelf:'center',width:36,height:5,borderRadius:3,backgroundColor:quick.line,marginBottom:4}}/>
    <View style={{flexDirection:'row',alignItems:'flex-start',gap:8}}>
     <Text style={{flex:1,fontSize:19,fontWeight:'700',color:quick.ink}}>{t('Subscribe to connect your computer','내 컴퓨터를 연결하려면 구독이 필요해요')}</Text>
     <Pressable testID="paywall-close" accessibilityRole="button" accessibilityLabel={t('Close','닫기')} onPress={close} hitSlop={8}
      style={{width:30,height:30,borderRadius:15,backgroundColor:quick.raised,alignItems:'center',justifyContent:'center'}}><Text style={{fontSize:14,color:quick.muted}}>✕</Text></Pressable>
    </View>
    <Text style={{fontSize:12.5,color:quick.amber}}>{'🔒 '+t('You are looking at example data','지금은 예시 데이터를 보고 있어요')}</Text>
    {!plans.length&&<ActivityIndicator color={quick.segmentOn} style={{height:120}}/>}
    {plans.map(p=>{const on=p.id===plan?.id;
     return <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{selected:on}} onPress={()=>setChosen(p.id)}
      style={{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:14,paddingVertical:12,borderRadius:14,borderWidth:1.5,
       borderColor:on?quick.segmentOn:quick.line,backgroundColor:on?'rgba(157,255,60,0.07)':quick.raised,marginTop:p.yearly&&off?8:0}}>
      <View style={{width:20,height:20,borderRadius:10,borderWidth:1.5,borderColor:on?quick.segmentOn:quick.dim,alignItems:'center',justifyContent:'center'}}>{on&&<View style={{width:10,height:10,borderRadius:5,backgroundColor:quick.segmentOn}}/>}</View>
      <View style={{flex:1}}>
       <Text style={{fontSize:15,fontWeight:'600',color:quick.ink}}>{p.yearly?t('Yearly','연간'):t('Monthly','월간')}</Text>
       {p.yearly&&<Text style={{fontSize:12,color:quick.muted}}>{t(`${money(perMonth(p),p.currency,w.lang==='ko'?'ko-KR':'en-US')} a month`,`월 ${money(perMonth(p),p.currency,'ko-KR')}꼴`)}</Text>}
      </View>
      <View style={{alignItems:'flex-end'}}>
       <Text style={{fontSize:15,fontWeight:'700',color:quick.ink}}>{price(p)}</Text>
       <Text style={{fontSize:11.5,color:quick.muted}}>{p.yearly?t('/year','/년'):t('/month','/월')}</Text>
      </View>
      {p.yearly&&off!==null&&<View style={{position:'absolute',top:-10,left:12,backgroundColor:quick.segmentOn,borderRadius:999,paddingHorizontal:8,paddingVertical:2}}>
       <Text style={{fontSize:10.5,fontWeight:'700',color:'#0c1400'}}>{t(`Save ${off}%`,`${off}% 절약`)}</Text></View>}
     </Pressable>;})}
    <Pressable testID="paywall-subscribe" accessibilityRole="button" disabled={!plan||busy} onPress={subscribe}
     style={({pressed})=>({borderRadius:14,paddingVertical:13,alignItems:'center',backgroundColor:quick.segmentOn,opacity:!plan||busy?.55:pressed?.85:1})}>
     <Text style={{fontSize:16,fontWeight:'700',color:'#0c1400'}}>{phase==='waiting'?t('Connecting your computer…','내 컴퓨터를 연결하는 중…'):cta}</Text>
     {!!detail&&<Text style={{fontSize:11.5,color:'#0c1400',opacity:.75,marginTop:2}}>{detail}</Text>}
    </Pressable>
    {!!note&&<Text style={{fontSize:12.5,color:quick.muted,textAlign:'center'}}>{note}</Text>}
    <View style={{flexDirection:'row',justifyContent:'center',gap:16}}>
     <Pressable accessibilityRole="button" disabled={busy} onPress={restore}><Text style={{fontSize:12.5,color:quick.muted,textDecorationLine:'underline'}}>{t('Restore purchases','구매 복원')}</Text></Pressable>
     <Pressable accessibilityRole="link" onPress={()=>Linking.openURL('https://1top.si/terms')}><Text style={{fontSize:12.5,color:quick.muted,textDecorationLine:'underline'}}>{t('Terms of use','이용약관')}</Text></Pressable>
     <Pressable accessibilityRole="link" onPress={()=>Linking.openURL('https://1top.si/privacy')}><Text style={{fontSize:12.5,color:quick.muted,textDecorationLine:'underline'}}>{t('Privacy','개인정보 처리방침')}</Text></Pressable>
    </View>
    <Text style={{fontSize:10.5,lineHeight:15,color:quick.dim,textAlign:'center'}}>{t('Unless cancelled, the trial turns into a paid subscription, and the subscription renews each period. Cancel any time in Google Play subscriptions.',
     '취소하지 않으면 체험이 끝난 뒤 자동으로 결제되고, 구독은 기간마다 자동 갱신됩니다. Google Play 정기 결제에서 언제든 해지할 수 있습니다.')}</Text>
   </View>
  </View>
 </Modal>;
}
