import React,{useRef,useState} from 'react';
import {Modal,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Svg,{Circle,Line as SvgLine,LinearGradient,Defs,Path,Rect,Stop,Text as SvgText} from 'react-native-svg';
import {File,Paths} from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {Lcd,type Cells} from './lcd';
import {quick,toolColor,toolName} from './theme';
import {DEFAULTS,SHAPES,figures,money,reportsOf,resetPrefs,sentences,setPrefs,shapeName,times,usePrefs,week,when,duration,type Figures,type Shape,type Week} from './reports';
import type {Device,Quota} from './types';

// The month's subscriptions at API prices and the week's agent hours on top of the usage tab, the forecast on each
// account and the settings and share sheets: the five looks agent/onetop/dist/reports.js draws, on the phone.
const GREEN='#82cba7',AMBER='#e9b25c',LCD='#9dff3c',PAPER='#f4f1e8',INK='#1d1c19',STAMP='#c2412d';
const oneDecimal=(v:number|null|undefined):Cells=>{if(v==null||!Number.isFinite(v)||v<0)return {c:['-','-'],u:'',dp:0};const t=v>=999.95?'999':v.toFixed(1),d=t.indexOf('.');return {c:[...t.replace('.','')],u:'',dp:d<0?null:d-1};};
const locale=(lang:string)=>lang==='ko'?'ko-KR':lang==='zh'?'zh-CN':'en-US';

function Led({value,color=LCD,height}:{value:number|null|undefined;color?:string;height:number}){
 return <View style={{alignSelf:'flex-start',backgroundColor:'#0a0d0f',borderRadius:height*.22,paddingHorizontal:height*.22,paddingVertical:height*.16}}><Lcd cells={oneDecimal(value)} height={height} color={color}/></View>;}

export function ReportPanel(){
 const w=useWorkspace(),p=usePrefs(),[settings,setSettings]=useState(false),[sharing,setSharing]=useState(false),[open,setOpen]=useState(false);
 if(p.hidden)return null;
 const loc=locale(w.shownLang||w.lang),r=reportsOf(w.visible as Device[]),v=figures(r,p.basis,loc),wk=week(r,loc);
 if(!v)return (w.devices||[]).length?<View style={st.card}><Text style={st.title}>{w.t('Value · this week','본전 · 이번 주')}</Text><Text style={st.small}>{w.t('Shown after the collector update','수집기 업데이트 후 표시됩니다')}</Text></View>:null;
 return <><ReportBody shape={p.shape} v={v} wk={wk} basis={p.basis} open={open} setOpen={setOpen} onSettings={()=>setSettings(true)} onShare={()=>setSharing(true)}/>
  <ReportSettings visible={settings} close={()=>setSettings(false)}/><ShareSheet visible={sharing} close={()=>setSharing(false)} v={v} wk={wk}/></>;
}

function ReportBody({shape,v,wk,basis,open,setOpen,onSettings,onShare,preview=false}:{shape:Shape;v:Figures;wk:Week|null;basis:string;open:boolean;setOpen:(b:boolean)=>void;onSettings:()=>void;onShare:()=>void;preview?:boolean}){
 const w=useWorkspace(),t=w.t,loc=locale(w.shownLang||w.lang);
 const period=new Date(v.first*1000).toLocaleDateString(loc,{month:'short',day:'numeric'})+' ~ '+new Date(v.end*1000).toLocaleString(loc,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const sign=(d:number)=>(d>=0?'+':'−')+duration(Math.abs(d),t),weekNote=wk?.partial?t(' · since 4.8.0',' · 4.8.0 설치 이후'):'';
 const basisNote=basis==='prorated'?t(`Against ${money(v.cost)}, the share of this month's subscriptions so far`,`지난 ${Math.max(1,Math.round(v.share*100))}% 기간의 구독료 ${money(v.cost)}와 비교`):t(`Against this month's ${money(v.plan)} in subscriptions`,`이번 달 구독료 ${money(v.plan)} 전체와 비교`);
 const buttons=<View style={{flexDirection:'row',gap:6}}><Chip label={t('Shape','모양')} onPress={onSettings} disabled={preview}/><Chip label={t('Share card','공유 카드')} onPress={onShare} disabled={preview}/></View>;
 const notes=[t('Long-context rates and models without a known price are left out, so this may read low','긴 문맥 요금과 가격을 모르는 모델은 빼고 계산해 실제보다 낮게 나올 수 있습니다'),...(v.left?[t(`${v.leftKinds.map(toolName).join(', ')} ${money(v.left)} left out: plan price unknown`,`요금제를 모르는 ${v.leftKinds.map(toolName).join(', ')} ${money(v.left)}은 빼고 계산했습니다`)]:[]),...(v.prices?[t(`Prices as of ${v.prices}`,`가격 ${v.prices} 기준`)]:[])];
 const title=shape==='receipt'?t(`${v.label} usage receipt`,`${v.label} 사용 영수증`):shape==='trend'?t('Value trend · this week','본전 추이 · 이번 주'):t(`${v.label} value · this week`,`${v.label} 본전 · 이번 주`);
 const top=Math.max(36000,...(wk?.days||[]).map(d=>(d.work||0)+(d.wait||0)));
 const weekCols=wk&&<View style={{gap:10}}><Hair/><View style={{flexDirection:'row'}}><View style={{flex:1,gap:3}}><Text style={st.small}>{t('Working this week','이번 주 작업')+weekNote}</Text><Text style={st.big}>{duration(wk.work,t)}</Text>{wk.prev&&<Text style={[st.tiny,{color:GREEN}]}>{t(`vs last week ${sign(wk.work-wk.prev.work)}`,`지난주 같은 때보다 ${sign(wk.work-wk.prev.work)}`)}</Text>}</View>
   <View style={{flex:1,gap:3}}><Text style={st.small}>{t('Waiting for you','대기로 멈춘 시간')}</Text><Text style={[st.big,{color:AMBER}]}>{duration(wk.wait,t)}</Text>{wk.prev&&<Text style={[st.tiny,{color:wk.wait<=wk.prev.wait?GREEN:AMBER}]}>{t(`vs last week ${sign(wk.wait-wk.prev.wait)}`,`지난주 같은 때보다 ${sign(wk.wait-wk.prev.wait)}`)}</Text>}</View></View>
  <View style={{flexDirection:'row',alignItems:'flex-end',height:118,gap:8}}>{wk.days.map(d=><View key={d.label} style={{flex:1,alignItems:'center',gap:4}}><View style={{height:92,justifyContent:'flex-end',width:'70%',gap:2}}><View style={{height:90*(d.wait||0)/top,backgroundColor:AMBER,borderRadius:3}}/><View style={{height:90*(d.work||0)/top,backgroundColor:GREEN,borderRadius:3}}/></View><Text style={st.tiny}>{d.label}</Text></View>)}</View>
  {wk.longest&&<Text style={st.small}>{t(`Longest wait ${wk.longest.label} · ${toolName(wk.longest.kind)} · ${duration(wk.longest.seconds,t)}`,`가장 오래 멈춘 세션 ${wk.longest.label} · ${toolName(wk.longest.kind)} · ${duration(wk.longest.seconds,t)}`)}</Text>}</View>;
 let body:React.ReactNode;
 if(shape==='receipt'){
  body=<View style={{gap:14}}><View style={{backgroundColor:PAPER,borderRadius:4,padding:14,gap:4,alignItems:'stretch'}}><Text style={[st.mono,{textAlign:'center',fontWeight:'700',letterSpacing:1.5}]}>1TOP RECEIPT</Text><Text style={[st.mono,{textAlign:'center',fontSize:11,color:'#6c675c'}]}>{period}</Text>
   {v.models.slice(0,8).map(m=><Dotted key={m.model} l={m.model} r={money(m.api_value)}/>)}<Dashed/><Dotted l={t('At API prices','API 가격 합계')} r={money(v.api)}/><Dotted l={t(`Plans ${v.plans}`,`구독료 ${v.plans}개`)} r={'−'+money(v.plan)}/><Dashed/><Dotted l={t('Saved','아낀 돈')} r={money(v.saved)} bold/>
   <View style={{alignItems:'center',marginTop:8}}><Text style={[st.mono,{color:STAMP,fontWeight:'800',fontSize:16,borderWidth:2.5,borderColor:STAMP,borderRadius:6,paddingHorizontal:10,paddingVertical:3,transform:[{rotate:'-8deg'}]}]}>{t(`Value ${times(v.ratio)}×`,`본전 ${times(v.ratio)}배`)}</Text></View></View>
   {wk&&<View style={{gap:6}}><Text style={st.title}>{t("This week's timesheet",'이번 주 근무표')+weekNote}</Text>{wk.days.map(d=><View key={d.label} style={{flexDirection:'row',alignItems:'center',gap:8}}><Text style={[st.small,{width:26}]}>{d.label}</Text><View style={{flex:1,height:10,borderRadius:3,backgroundColor:quick.raised,flexDirection:'row',overflow:'hidden',gap:2}}><View style={{width:`${(d.work||0)/top*100}%` as any,backgroundColor:GREEN}}/><View style={{width:`${(d.wait||0)/top*100}%` as any,backgroundColor:AMBER}}/></View><Text style={[st.tiny,{width:104,textAlign:'right'}]}>{d.work==null?'—':`${(d.work/3600).toFixed(1)}h · ${t('wait ','대기 ')}${((d.wait||0)/3600).toFixed(1)}h`}</Text></View>)}
    <Text style={st.body}>{t(`Work ${duration(wk.work,t)} · waiting ${duration(wk.wait,t)} · all sessions`,`작업 ${duration(wk.work,t)} · 대기 ${duration(wk.wait,t)} · 세션 합`)}</Text>
    {wk.longest&&<Text style={st.small}>{t(`Longest wait: ${wk.longest.label} · ${toolName(wk.longest.kind)} · ${duration(wk.longest.seconds,t)}`,`가장 오래 멈춘 세션: ${wk.longest.label} · ${toolName(wk.longest.kind)} · ${duration(wk.longest.seconds,t)}`)}</Text>}</View>}</View>;
 }else if(shape==='big'){
  const span=Math.max(v.api,v.cost||0,1),maxK=Math.max(1,...v.kinds.map(k=>k.ratio||0));
  body=<View style={{gap:10}}><View style={{flexDirection:'row',alignItems:'baseline',gap:4}}><Text style={{fontSize:52,lineHeight:58,fontWeight:'700',color:quick.ink}}>{times(v.ratio)}</Text><Text style={[st.big,{color:quick.muted}]}>{t('×','배')}</Text></View>
   <Text style={st.small}>{t(`${money(basis==='prorated'?v.cost:v.plan)} in subscriptions bought ${money(v.api)} at API prices.`,`구독료 ${money(basis==='prorated'?v.cost:v.plan)}로 API 가격 기준 ${money(v.api)}어치를 썼습니다.`)}</Text>
   <Bar label={t('Plans','구독료')} f={(v.cost||0)/span} color="#5a6270" value={money(v.cost)}/><Bar label={t('API value','API 환산')} f={v.api/span} color={GREEN} value={money(v.api)}/><Hair/>
   {v.kinds.map(k=><Bar key={k.kind} label={toolName(k.kind)} f={(k.ratio||0)/maxK} color={toolColor(k.kind)} value={k.plan?times(k.ratio)+t('×','배'):'—'} thin/>)}{weekCols}</View>;
 }else if(shape==='trend'){
  const rows=[...v.months.map(m=>({...m,now:false})),{label:v.label,api:v.api,plan:v.plan||0,now:true}],max=Math.max(v.proj||0,...rows.map(r=>r.api),1)*1.12;
  body=<View style={{gap:10}}><View style={{flexDirection:'row',alignItems:'baseline',gap:10,flexWrap:'wrap'}}><Text style={st.big}>{times(v.ratio)+t('×','배')}</Text><Text style={st.small}>{t(`${v.label} so far ${money(v.api)} / plans ${money(v.cost)}`,`${v.label} 지금까지 ${money(v.api)} / 구독료 ${money(v.cost)}`)}</Text></View>
   <View style={{flexDirection:'row',alignItems:'flex-end',gap:10,height:170}}>{rows.map(r=><View key={r.label} style={{flex:1,alignItems:'center',gap:4}}>{r.plan>0&&<Text style={[st.tiny,{color:LCD,fontWeight:'700'}]}>{times(r.api/(r.now&&basis==='prorated'?(v.cost||r.plan):r.plan))+t('×','배')}</Text>}
    <View style={{height:130,width:'100%',justifyContent:'flex-end'}}>{r.now&&v.proj&&<View style={{position:'absolute',bottom:0,left:0,right:0,height:130*v.proj/max,borderWidth:1,borderStyle:'dashed',borderColor:GREEN,borderRadius:4}}/>}<View style={{height:Math.max(2,130*r.api/max),backgroundColor:r.now?GREEN:GREEN+'73',borderRadius:4}}/></View><Text style={[st.tiny,r.now&&{color:quick.ink,fontWeight:'600'}]}>{r.label}</Text></View>)}</View>
   {v.proj&&<Text style={st.small}>{t(`At this pace ${money(v.proj)} by month end · ${times(v.plan?v.proj/v.plan:null)}×`,`이 속도면 ${v.label} 말 ${money(v.proj)} · ${times(v.plan?v.proj/v.plan:null)}배 예상`)}</Text>}{weekCols}</View>;
 }else if(shape==='strip'){
  body=<View style={{gap:10}}><View style={{flexDirection:'row',flexWrap:'wrap',rowGap:10}}>
    <Cell k={t(`${v.label} value`,`${v.label} 본전`)} value={times(v.ratio)+t('×','배')} note={money(v.api)+' / '+money(v.cost)}/>
    <Cell k={t('Working this week','이번 주 작업')} value={wk?duration(wk.work,t):'—'} note={t('All sessions','세션 합')+weekNote}/>
    <Cell k={t('Waiting for you','대기로 멈춤')} value={wk?duration(wk.wait,t):'—'} note={wk?.longest?t(`Longest ${wk.longest.label}`,`최장 ${wk.longest.label}`):''} color={AMBER}/></View>
   <View style={{flexDirection:'row',alignItems:'center'}}><Pressable disabled={preview} onPress={()=>setOpen(!open)} accessibilityRole="button"><Text style={[st.small,{color:quick.mint,fontWeight:'600'}]}>{open?t('Less','접기'):t('Details','자세히')}</Text></Pressable><View style={{flex:1}}/>{buttons}</View>
   {open&&<View style={{gap:5}}><Hair/>{v.models.slice(0,8).map(m=><View key={m.model} style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={[st.dot,{backgroundColor:toolColor(m.kind)}]}/><Text style={[st.small,{flex:1}]}>{m.model}</Text><Text style={st.small}>{money(m.api_value)}</Text></View>)}
    <View style={{flexDirection:'row'}}><Text style={[st.small,{flex:1,fontWeight:'600',color:quick.ink}]}>{t('Saved','아낀 돈')}</Text><Text style={[st.small,{color:GREEN,fontWeight:'600'}]}>{money(v.saved)}</Text></View></View>}</View>;
 }else{
  body=<View style={{gap:14}}><View style={{gap:6}}><Text style={st.small}>{t('Value multiple','본전 배수')}</Text><View style={{flexDirection:'row',alignItems:'flex-end',gap:8}}><Led value={v.ratio} height={40}/><Text style={{color:LCD,fontSize:20,fontWeight:'700',fontStyle:'italic',paddingBottom:4}}>{t('×','배')}</Text></View><Text style={st.tiny}>{basisNote}</Text></View><Hair/>
   <View style={{gap:8}}><Row k={t('At API prices','API 가격 환산')} value={money(v.api)}/><Row k={t(`Subscriptions · ${v.plans} plans`,`구독료 · 요금제 ${v.plans}개`)} value={money(v.plan)}/><Row k={t('Saved','아낀 돈')} value={v.saved==null?'—':(v.saved>=0?'+':'−')+money(Math.abs(v.saved))} color={GREEN}/></View><Hair/>
   {wk&&<View style={{gap:8}}><Text style={st.small}>{t('Agent hours this week · all sessions','이번 주 에이전트 시간 · 세션 합')+weekNote}</Text><View style={{flexDirection:'row',alignItems:'center',gap:10}}><Led value={wk.work/3600} height={22}/><Text style={st.small}>{t('hours working','시간 작업')}</Text></View>
    <View style={{flexDirection:'row',alignItems:'center',gap:10}}><Led value={wk.wait/3600} color={AMBER} height={22}/><Text style={st.small}>{t('hours waiting for you','시간 대기로 멈춤')}</Text></View>
    {wk.prev&&<Text style={st.tiny}>{t(`Versus last week at this time: work ${sign(wk.work-wk.prev.work)} · waiting ${sign(wk.wait-wk.prev.wait)}`,`지난주 같은 때보다 작업 ${sign(wk.work-wk.prev.work)} · 대기 ${sign(wk.wait-wk.prev.wait)}`)}</Text>}</View>}
   <View style={{gap:6}}>{v.kinds.map(k=><View key={k.kind} style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={[st.dot,{backgroundColor:toolColor(k.kind)}]}/><Text style={st.small}>{toolName(k.kind)}</Text>{k.plan?<><Text style={[st.small,{color:LCD,fontWeight:'700'}]}>{times(k.ratio)+t('×','배')}</Text><Text style={st.tiny}>{money(k.api)+' / '+money(k.plan)}</Text></>:<Text style={st.tiny}>{money(k.api)+' · '+t('plan to confirm','요금제 확인 필요')}</Text>}</View>)}</View></View>;
 }
 return <View style={st.card}>{shape!=='strip'&&<View style={{flexDirection:'row',alignItems:'flex-start',gap:8,marginBottom:12}}><View style={{flex:1,gap:2}}><Text style={st.title}>{title}</Text><Text style={st.tiny}>{t('At API prices · ','API 가격으로 환산 · ')+period}</Text></View>{buttons}</View>}
  {body}<Text style={[st.tiny,{marginTop:12}]}>{notes.join(' · ')}</Text></View>;
}
function Chip({label,onPress,disabled}:{label:string;onPress:()=>void;disabled?:boolean}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[st.chip,pressed&&{backgroundColor:quick.raised}]}><Text style={[st.tiny,{color:quick.mint,fontWeight:'700'}]}>{label}</Text></Pressable>;}
function Row({k,value,color=quick.ink}:{k:string;value:string;color?:string}){return <View style={{flexDirection:'row',alignItems:'baseline'}}><Text style={[st.small,{flex:1}]}>{k}</Text><Text style={[st.body,{fontWeight:'600',color}]}>{value}</Text></View>;}
function Cell({k,value,note,color=quick.ink}:{k:string;value:string;note:string;color?:string}){return <View style={{width:'50%',gap:2,paddingRight:8}}><Text numberOfLines={1} style={st.small}>{k}</Text><Text numberOfLines={1} style={[st.body,{fontWeight:'700',color}]}>{value}</Text><Text numberOfLines={1} style={st.tiny}>{note}</Text></View>;}
function Bar({label,f,color,value,thin}:{label:string;f:number;color:string;value:string;thin?:boolean}){return <View style={{flexDirection:'row',alignItems:'center',gap:10}}><Text numberOfLines={1} style={[st.small,{width:84}]}>{label}</Text><View style={{flex:1,height:thin?6:12,borderRadius:6,backgroundColor:quick.raised,overflow:'hidden'}}><View style={{width:`${Math.max(2,Math.min(100,f*100))}%` as any,height:'100%',backgroundColor:color,borderRadius:6}}/></View><Text style={[st.small,{width:64,textAlign:'right',color:quick.ink,fontWeight:'600'}]}>{value}</Text></View>;}
function Dotted({l,r,bold}:{l:string;r:string;bold?:boolean}){return <View style={{flexDirection:'row',alignItems:'flex-end',gap:6}}><Text numberOfLines={1} style={[st.mono,bold&&{fontWeight:'800',fontSize:15}]}>{l}</Text><View style={{flex:1,borderBottomWidth:1.5,borderStyle:'dotted',borderColor:'#a39d8f',marginBottom:4}}/><Text style={[st.mono,{fontWeight:bold?'800':'600'},bold&&{fontSize:15}]}>{r}</Text></View>;}
function Dashed(){return <View style={{borderTopWidth:1.5,borderStyle:'dashed',borderColor:'#a39d8f',marginVertical:6}}/>;}
function Hair(){return <View style={{height:StyleSheet.hairlineWidth,backgroundColor:quick.line}}/>;}

/** What an account card adds under its windows, in the panel's look; nothing without a verified weekly burn. */
export function ForecastBlock({quota,quotas,name}:{quota:Quota;quotas:Quota[];name:(q:Quota)=>string}){
 const w=useWorkspace(),p=usePrefs(),t=w.t,loc=locale(w.shownLang||w.lang),now=w.clock/1000;
 const s=sentences(quota,quotas,w.period,now,loc,t,name);if(!s)return null;
 const extra=<>{s.alt&&<Text style={st.small}>{s.alt}</Text>}{s.h5&&<Text style={st.small}>{s.h5}</Text>}</>;
 if(s.f.state==='idle')return <View style={st.forecast}><Text style={st.small}>{s.main}</Text>{s.h5&&<Text style={st.small}>{s.h5}</Text>}</View>;
 if(p.shape==='trip'&&s.warn)return <View style={st.forecast}><View style={{flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:AMBER+'66',borderRadius:10,padding:10}}><Led value={(s.f as any).hours} color={AMBER} height={18}/><View style={{flex:1,gap:2}}><Text style={[st.small,{color:AMBER,fontWeight:'600'}]}>{s.main}</Text><Text style={st.tiny}>{s.sub}</Text></View></View>{extra}</View>;
 if(p.shape==='big'&&s.f.reset){const span=s.f.reset-now,f=s.warn&&span>0?Math.min(1,((s.f as any).end-now)/span):1;
  return <View style={st.forecast}><View style={{height:8,borderRadius:4,backgroundColor:quick.raised,overflow:'visible'}}><View style={{width:`${f*100}%` as any,height:8,borderRadius:4,backgroundColor:toolColor(quota.kind)+'b3'}}/>{s.warn&&<View style={{position:'absolute',left:`${f*100}%` as any,top:-4,width:2,height:16,backgroundColor:AMBER}}/>}</View>
   <View style={{flexDirection:'row'}}><Text style={[st.tiny,{flex:1}]}>{t('Now','지금')}</Text><Text style={st.tiny}>{t(`Resets ${when(s.f.reset,now,loc,t)}`,`초기화 ${when(s.f.reset,now,loc,t)}`)}</Text></View>
   <Text style={st.small}><Text style={{color:s.warn?AMBER:GREEN,fontWeight:'600'}}>{s.main}</Text>{s.sub?' · '+s.sub:''}</Text>{extra}</View>;}
 if(p.shape==='strip')return <View style={st.forecast}><Text style={[st.tiny,{alignSelf:'flex-start',fontWeight:'700',color:s.warn?AMBER:GREEN,backgroundColor:(s.warn?AMBER:GREEN)+'29',borderRadius:999,paddingHorizontal:8,paddingVertical:2,overflow:'hidden'}]}>{s.warn?t(`Runs out ${when((s.f as any).end,now,loc,t)}`,`${when((s.f as any).end,now,loc,t)} 바닥`):t('Lasts to the reset','초기화까지 넉넉함')}</Text><Text style={st.small}>{s.main+(s.sub?' · '+s.sub:'')}</Text>{extra}</View>;
 return <View style={st.forecast}><Text style={st.small}><Text style={{color:s.warn?AMBER:GREEN,fontWeight:'600'}}>{s.main}</Text>{s.sub?' · '+s.sub:''}</Text>{extra}</View>;
}

/** The report's sheet, also opened from the customizing list: the panel's look drawn with today's figures, the share
 *  card's look, the multiple's basis and whether the panel shows. */
export function ReportSettings({visible,close}:{visible:boolean;close:()=>void}){
 const w=useWorkspace(),p=usePrefs(),t=w.t,[tab,setTab]=useState<'shape'|'share'|'more'>('shape'),loc=locale(w.shownLang||w.lang);
 const r=reportsOf(w.visible as Device[]),v=figures(r,p.basis,loc),wk=week(r,loc);
 return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}><SafeAreaView style={{flex:1,backgroundColor:quick.background}}><ScrollView contentContainerStyle={{padding:16,gap:14}}>
  <View style={{flexDirection:'row',alignItems:'center'}}><Text style={[st.title,{flex:1,fontSize:17}]}>{t('Value · weekly report','본전·주간 리포트')}</Text><Chip label={t('Done','완료')} onPress={close}/></View>
  <View style={st.tabs}>{([['shape',t('Report shape','리포트 모양')],['share',t('Share card','공유 카드')],['more',t('Basis · show','기준·보이기')]] as const).map(([k,l])=><Pressable key={k} accessibilityRole="button" accessibilityState={{selected:tab===k}} onPress={()=>setTab(k)} style={[st.tab,tab===k&&{backgroundColor:quick.raised}]}><Text style={[st.small,{color:tab===k?quick.ink:quick.muted,fontWeight:'600'}]}>{l}</Text></Pressable>)}</View>
  {tab==='shape'&&v&&SHAPES.map(k=><Pressable key={k} accessibilityRole="button" accessibilityState={{selected:p.shape===k}} onPress={()=>setPrefs({shape:k})} style={[st.option,p.shape===k&&{borderColor:quick.accent}]}><View pointerEvents="none"><ReportBody shape={k} v={v} wk={wk} basis={p.basis} open={false} setOpen={()=>{}} onSettings={()=>{}} onShare={()=>{}} preview/></View><Text style={[st.body,{textAlign:'center',fontWeight:'600'}]}>{shapeName(k,t)+(k===DEFAULTS.shape?t(' · default',' · 기본'):'')}</Text></Pressable>)}
  {tab==='share'&&v&&SHAPES.map(k=><Pressable key={k} accessibilityRole="button" accessibilityState={{selected:p.share===k}} onPress={()=>setPrefs({share:k})} style={[st.option,p.share===k&&{borderColor:quick.accent}]}><View pointerEvents="none" style={{width:'100%',aspectRatio:1200/630,borderRadius:8,overflow:'hidden'}}><ShareCard shape={k} v={v} wk={wk} width={330}/></View><Text style={[st.body,{textAlign:'center',fontWeight:'600'}]}>{shapeName(k,t)+(k===DEFAULTS.share?t(' · default',' · 기본'):'')}</Text></Pressable>)}
  {tab==='more'&&<View style={{gap:12}}><View style={st.tabs}>{([['month',t("The whole month's plans",'구독료 전체')],['prorated',t('The share so far','지난 날짜만큼')]] as const).map(([k,l])=><Pressable key={k} accessibilityRole="button" accessibilityState={{selected:p.basis===k}} onPress={()=>setPrefs({basis:k})} style={[st.tab,p.basis===k&&{backgroundColor:quick.raised}]}><Text style={[st.small,{color:p.basis===k?quick.ink:quick.muted,fontWeight:'600'}]}>{l}</Text></Pressable>)}</View>
   <Text style={st.small}>{p.basis==='month'?t("Compares with this month's subscriptions in full. Small early in the month, large at its end.",'이번 달 구독료 전체와 비교합니다. 달 초에는 작게 시작해 월말에 커집니다.'):t('Compares with the part of the subscriptions the days so far stand for. The same size as last month even early on.','지난 날짜만큼 나눈 구독료와 비교합니다. 달 초에도 지난달과 같은 크기로 비교됩니다.')}</Text>
   <Pressable accessibilityRole="switch" accessibilityState={{checked:!p.hidden}} onPress={()=>setPrefs({hidden:!p.hidden})} style={{flexDirection:'row',alignItems:'center'}}><Text style={[st.body,{flex:1}]}>{t('Show on the usage tab','사용량 화면에 보이기')}</Text><View style={[st.switch,!p.hidden&&{backgroundColor:quick.accent}]}><View style={[st.knob,!p.hidden&&{transform:[{translateX:18}]}]}/></View></Pressable>
   <Chip label={t('Back to defaults','기본값으로 되돌리기')} onPress={resetPrefs}/></View>}
  {!v&&tab!=='more'&&<Text style={st.small}>{t('Shown after the collector update','수집기 업데이트 후 표시됩니다')}</Text>}
 </ScrollView></SafeAreaView></Modal>;
}

/** The share sheet: the chosen card at 1200 × 630, its other looks, then the system share sheet. The image never holds
 *  an e-mail, a session name or a path. */
function ShareSheet({visible,close,v,wk}:{visible:boolean;close:()=>void;v:Figures;wk:Week|null}){
 const w=useWorkspace(),p=usePrefs(),t=w.t,ref=useRef<any>(null),[note,setNote]=useState('');
 const share=()=>{if(!ref.current)return;ref.current.toDataURL(async(base64:string)=>{try{const file=new File(Paths.cache,`1top-${p.share}.png`);if(file.exists)file.delete();file.create();file.write(base64,{encoding:'base64'});
  if(await Sharing.isAvailableAsync())await Sharing.shareAsync(file.uri,{mimeType:'image/png',dialogTitle:t('Share card','공유 카드')});else setNote(t('Sharing is not available on this phone.','이 휴대폰에서는 공유할 수 없습니다.'));}catch{setNote(t('Could not make the image.','이미지를 만들지 못했습니다.'));}},{width:1200,height:630});};
 return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>{setNote('');close();}}><SafeAreaView style={{flex:1,backgroundColor:quick.background}}><ScrollView contentContainerStyle={{padding:16,gap:14}}>
  <View style={{flexDirection:'row',alignItems:'center'}}><Text style={[st.title,{flex:1,fontSize:17}]}>{t('Share card','공유 카드')}</Text><Chip label={t('Done','완료')} onPress={()=>{setNote('');close();}}/></View>
  <View style={{width:'100%',aspectRatio:1200/630,borderRadius:10,overflow:'hidden'}}><ShareCard shape={p.share} v={v} wk={wk} width={360} svgRef={ref}/></View>
  <View style={[st.tabs,{flexWrap:'wrap'}]}>{SHAPES.map(k=><Pressable key={k} accessibilityRole="button" accessibilityState={{selected:p.share===k}} onPress={()=>setPrefs({share:k})} style={[st.tab,{flexGrow:0,paddingHorizontal:10},p.share===k&&{backgroundColor:quick.raised}]}><Text style={[st.tiny,{color:p.share===k?quick.ink:quick.muted,fontWeight:'600'}]}>{shapeName(k,t)}</Text></Pressable>)}</View>
  <Text style={st.small}>{t('An estimate at public API prices. No e-mail, session name or path is on the card.','공개 API 단가로 계산한 추정치입니다. 이메일·세션 이름·경로는 넣지 않습니다.')}</Text>
  <Pressable accessibilityRole="button" onPress={share} style={({pressed})=>[st.primary,pressed&&{opacity:.8}]}><Text style={[st.body,{color:'#0d1a05',fontWeight:'700',textAlign:'center'}]}>{t('Share','공유')}</Text></Pressable>
  {!!note&&<Text style={[st.small,{color:AMBER}]}>{note}</Text>}
 </ScrollView></SafeAreaView></Modal>;
}

// The five share cards on a 1200 × 630 face, the layouts reports.js draws on its canvas.
const UI='#e9ebef',MUTED='#9ba1ad',SOFT='#c9ced6';
function seg7(value:number|null|undefined,x:number,y:number,h:number,color:string){
 const cells=oneDecimal(value),w=h*.55,gap=h*.15,t=h*.115,room=t*1.2,ht=t/2,g=h*.031,skew=Math.tan(9*Math.PI/180);
 const SEG:Record<string,string>={0:'abcdef',1:'bc',2:'abged',3:'abgcd',4:'fgbc',5:'afgcd',6:'afgedc',7:'abc',8:'abcdefg',9:'abcdfg','-':'g'};
 const H=(cy:number,x0:number,x1:number)=>[[x0,cy],[x0+ht,cy-ht],[x1-ht,cy-ht],[x1,cy],[x1-ht,cy+ht],[x0+ht,cy+ht]];
 const V=(cx:number,y0:number,y1:number)=>[[cx,y0],[cx+ht,y0+ht],[cx+ht,y1-ht],[cx,y1],[cx-ht,y1-ht],[cx-ht,y0+ht]];
 const S:Record<string,number[][]>={a:H(ht,ht+g,w-ht-g),g:H(h/2,ht+g,w-ht-g),d:H(h-ht,ht+g,w-ht-g),f:V(ht,ht+g,h/2-g),b:V(w-ht,ht+g,h/2-g),e:V(ht,h/2+g,h-ht-g),c:V(w-ht,h/2+g,h-ht-g)};
 const out:React.ReactNode[]=[];let cx=x;
 cells.c.forEach((ch,i)=>{const shift=ch==='1'?-(w/2-t/2):0;for(const k of SEG[ch]||'')out.push(<Path key={`${i}${k}`} d={'M'+S[k].map(([px,py])=>`${cx+shift+px+(h-py)*skew},${y+py}`).join('L')+'Z'} fill={color}/>);
  cx+=w+gap;if(i===cells.dp){out.push(<Rect key={`dp${i}`} x={cx-gap/2-t*.5+room/4} y={y+h-t*1.05} width={t*1.05} height={t*1.05} rx={t*.2} fill={color}/>);cx+=room;}});
 return {nodes:out,width:cx-x-gap+h*skew};
}
function Brand({x,y}:{x:number;y:number}){return <><Rect x={x} y={y+6} width={40} height={40} rx={10} fill="#6ccfa9"/><SvgText x={x+56} y={y+43} fill={UI} fontSize={50} fontWeight="600">1top</SvgText><SvgText x={x+196} y={y+40} fill={MUTED} fontSize={28} fontWeight="600">1top.si</SvgText></>;}
export function ShareCard({shape,v,wk,width,svgRef}:{shape:Shape;v:Figures;wk:Week|null;width:number;svgRef?:React.Ref<any>}){
 const w=useWorkspace(),t=w.t;
 const kinds=(x:number,y:number)=>{let cx=x;return v.kinds.filter(k=>k.ratio!=null).slice(0,3).map(k=>{const label=toolName(k.kind).replace(' Code','')+' '+times(k.ratio)+t('×','배'),node=<React.Fragment key={k.kind}><Circle cx={cx+12} cy={y-12} r={12} fill={toolColor(k.kind)}/><SvgText x={cx+34} y={y} fill={SOFT} fontSize={34} fontWeight="700">{label}</SvgText></React.Fragment>;cx+=label.length*19+90;return node;});};
 let face:React.ReactNode;
 if(shape==='trip'){const lcd=seg7(v.ratio,60,150,180,LCD);
  face=<><Rect width={1200} height={630} fill="#07090a"/><SvgText x={72} y={104} fill={MUTED} fontSize={40} fontWeight="600">{t(`${v.label} AI coding mileage`,`${v.label} AI 코딩 연비`)}</SvgText>{lcd.nodes}<SvgText x={84+lcd.width} y={320} fill={LCD} fontSize={92} fontWeight="800" fontStyle="italic">{t('×','배')}</SvgText>
   <SvgText x={72} y={430} fill={UI} fontSize={44} fontWeight="700">{t(`Plans ${money(v.cost)} → API prices ${money(v.api)}`,`구독료 ${money(v.cost)} → API 가격 ${money(v.api)}`)}</SvgText><SvgText x={72} y={494} fill={GREEN} fontSize={44} fontWeight="700">{t(`Saved +${money(Math.max(0,v.saved||0))}`,`아낀 돈 +${money(Math.max(0,v.saved||0))}`)}</SvgText>{kinds(72,556)}<Brand x={1200-72-268} y={40}/></>;}
 else if(shape==='receipt'){
  // Each line's place down the paper, worked out in one pass: a dashed rule after the models and before the total.
  const entries:({l:string;r:string;big?:boolean}|'dash')[]=[...v.models.slice(0,6).map(m=>({l:m.model,r:money(m.api_value)})),'dash',{l:t('At API prices','API 가격 합계'),r:money(v.api)},{l:t(`Plans ${v.plans}`,`구독료 ${v.plans}`),r:'−'+money(v.plan)},'dash',{l:t('Saved','아낀 돈'),r:money(v.saved),big:true}];
  const rows:React.ReactNode[]=[];let y=146;
  for(let i=0;i<entries.length;i++){const e=entries[i];
   if(e==='dash'){y+=i===entries.length-2?10:6;rows.push(<SvgLine key={'d'+i} x1={40} x2={620} y1={y-30} y2={y-30} stroke="#a39d8f" strokeWidth={2} strokeDasharray="6 6"/>);continue;}
   const size=e.big?32:25,weight=e.big?'800':'400';
   rows.push(<React.Fragment key={'l'+i}><SvgText x={40} y={y} fill={INK} fontSize={size} fontWeight={weight} fontFamily="monospace">{e.l}</SvgText><SvgText x={620} y={y} fill={INK} fontSize={size} fontWeight={weight} fontFamily="monospace" textAnchor="end">{e.r}</SvgText></React.Fragment>);
   y+=e.big?52:40;}
  face=<><Rect width={1200} height={630} fill="#1a1c20"/><SvgText x={72} y={140} fill={MUTED} fontSize={34} fontWeight="600">{t(`${v.label} AI coding receipt`,`${v.label} AI 코딩 영수증`)}</SvgText><SvgText x={66} y={280} fill={UI} fontSize={120} fontWeight="800">{times(v.ratio)}<SvgText fill={MUTED} fontSize={54}>{' '+t('×','배')}</SvgText></SvgText>
   <SvgText x={72} y={350} fill={GREEN} fontSize={38} fontWeight="700">{t(`Saved ${money(v.saved)}`,`아낀 돈 ${money(v.saved)}`)}</SvgText><SvgText x={72} y={402} fill={SOFT} fontSize={30} fontWeight="600">{t(`Plans ${money(v.plan)}`,`구독료 ${money(v.plan)}`)}</SvgText>
   <Svg x={470} y={18} width={660} height={590}><Rect width={660} height={580} fill={PAPER}/>{Array.from({length:48},(_,i)=><Circle key={i} cx={7+i*14} cy={580} r={6} fill="#1a1c20"/>)}<SvgText x={330} y={60} fill={INK} fontSize={36} fontWeight="800" fontFamily="monospace" textAnchor="middle">1TOP RECEIPT</SvgText>
    <SvgText x={330} y={96} fill="#6c675c" fontSize={24} fontFamily="monospace" textAnchor="middle">{v.label+' · '+t('at API prices','API 가격 기준')}</SvgText>{rows}
    <SvgText x={490} y={Math.min(540,y+28)} fill={STAMP} fontSize={40} fontWeight="800" fontFamily="monospace" textAnchor="middle" rotation={-7} origin={`490,${Math.min(540,y+28)}`}>{t(`Value ${times(v.ratio)}×`,`본전 ${times(v.ratio)}배`)}</SvgText></Svg><Brand x={72} y={630-92}/></>;}
 else if(shape==='big'){const span=Math.max(v.api,v.cost||0,1);
  face=<><Defs><LinearGradient id="g" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#101318"/><Stop offset="1" stopColor="#16211b"/></LinearGradient></Defs><Rect width={1200} height={630} fill="url(#g)"/><SvgText x={72} y={100} fill={MUTED} fontSize={40} fontWeight="600">{v.label+' · '+t('Subscription value','구독 본전')}</SvgText>
   <SvgText x={60} y={318} fill={UI} fontSize={236} fontWeight="800">{times(v.ratio)}<SvgText fill={MUTED} fontSize={96}>{' '+t('×','배')}</SvgText></SvgText><SvgText x={72} y={404} fill={UI} fontSize={42} fontWeight="700">{t(`Plans ${money(v.cost)} → API prices ${money(v.api)}`,`구독료 ${money(v.cost)} → API 가격 ${money(v.api)}`)}</SvgText>
   {([[452,t('Plans','구독료'),(v.cost||0)/span,'#5a6270',money(v.cost)],[512,t('API value','API 환산'),v.api/span,GREEN,money(v.api)]] as [number,string,number,string,string][]).map(([y,l,f,c,val])=><React.Fragment key={y}><SvgText x={72} y={y+30} fill={MUTED} fontSize={30} fontWeight="700">{l}</SvgText><Rect x={232} y={y} width={640} height={40} rx={8} fill="#22262d"/><Rect x={232} y={y} width={Math.max(10,640*Math.min(1,f))} height={40} rx={8} fill={c}/><SvgText x={892} y={y+32} fill={UI} fontSize={34} fontWeight="800">{val}</SvgText></React.Fragment>)}<Brand x={1200-72-268} y={40}/></>;}
 else if(shape==='strip'){
  face=<><Rect width={1200} height={630} fill="#0d0e11"/><SvgText x={72} y={128} fill={MUTED} fontSize={40} fontWeight="600">{t(`${v.label}, my AI coding on 1top`,`${v.label}, 1top으로 본 내 AI 코딩`)}</SvgText><SvgText x={66} y={276} fill={UI} fontSize={118} fontWeight="800">{t(`${times(v.ratio)}× my plans`,`구독료의 ${times(v.ratio)}배`)}</SvgText>
   <SvgText x={72} y={360} fill={SOFT} fontSize={44} fontWeight="700">{t(`${money(v.api)} at API prices`,`API 가격으로 ${money(v.api)}어치`)}</SvgText>{wk&&<SvgText x={72} y={420} fill={SOFT} fontSize={44} fontWeight="700">{t(`Agents worked ${duration(wk.work,t)} this week`,`이번 주 에이전트 작업 ${duration(wk.work,t)}`)}</SvgText>}{kinds(72,506)}<Brand x={1200-72-268} y={630-92}/></>;}
 else{const rows=[...v.months.map(m=>({...m,now:false})),{label:v.label,api:v.api,plan:v.plan||0,now:true}],max=Math.max(v.proj||0,...rows.map(r=>r.api),1)*1.08,H0=530,HH=300,stp=Math.min(160,980/rows.length);
  face=<><Rect width={1200} height={630} fill="#101114"/><SvgText x={72} y={104} fill={UI} fontSize={58} fontWeight="800">{t(`${v.label} value ${times(v.ratio)}×`,`${v.label} 본전 ${times(v.ratio)}배`)}</SvgText>
   <SvgText x={72} y={152} fill={MUTED} fontSize={32} fontWeight="600">{t(`API prices ${money(v.api)} · plans ${money(v.cost)}`,`API 가격 ${money(v.api)} · 구독료 ${money(v.cost)}`)+(v.proj?t(` · month end ${money(v.proj)}`,` · 월말 예상 ${money(v.proj)}`):'')}</SvgText>
   {rows.map((r,i)=>{const cx=72+stp*i+stp/2,h=r.api/max*HH,hp=r.now&&v.proj?v.proj/max*HH:0;return <React.Fragment key={r.label}>{r.now&&v.proj&&<Rect x={cx-46} y={H0-hp} width={92} height={hp} rx={10} fill="none" stroke={GREEN} strokeWidth={3} strokeDasharray="10 8"/>}<Rect x={cx-46} y={H0-h} width={92} height={Math.max(2,h)} rx={10} fill={r.now?GREEN:'#3d6b57'}/>
    <SvgText x={cx} y={H0+42} fill={r.now?UI:MUTED} fontSize={30} fontWeight="700" textAnchor="middle">{r.label}</SvgText>{r.plan>0&&<SvgText x={cx} y={H0-h-16} fill={LCD} fontSize={30} fontWeight="800" textAnchor="middle">{times(r.api/(r.now?(v.cost||r.plan):r.plan))+t('×','배')}</SvgText>}</React.Fragment>;})}<Brand x={1200-72-268} y={40}/></>;}
 return <Svg ref={svgRef} width={width} height={width*630/1200} viewBox="0 0 1200 630">{face}</Svg>;
}

const st=StyleSheet.create({
 card:{borderRadius:14,borderWidth:StyleSheet.hairlineWidth,borderColor:quick.line,backgroundColor:quick.card,padding:14},
 title:{fontSize:15,fontWeight:'600',color:quick.ink},body:{fontSize:15,color:quick.ink},small:{fontSize:12.5,lineHeight:18,color:quick.muted},tiny:{fontSize:11,lineHeight:15,color:quick.muted},
 big:{fontSize:22,fontWeight:'700',color:quick.ink},mono:{fontFamily:'monospace',fontSize:13,color:INK},dot:{width:8,height:8,borderRadius:4},
 chip:{borderWidth:1,borderColor:quick.line,borderRadius:8,paddingHorizontal:10,paddingVertical:5,backgroundColor:quick.background},
 forecast:{paddingHorizontal:16,paddingBottom:12,gap:6},
 tabs:{flexDirection:'row',gap:2,padding:2,borderRadius:9,borderWidth:1,borderColor:quick.line},tab:{flexGrow:1,alignItems:'center',paddingVertical:7,borderRadius:7},
 option:{borderWidth:2,borderColor:quick.line,borderRadius:16,padding:10,gap:8},
 switch:{width:44,height:26,borderRadius:13,backgroundColor:quick.line,padding:3},knob:{width:20,height:20,borderRadius:10,backgroundColor:'#fff'},
 primary:{backgroundColor:LCD,borderRadius:12,paddingVertical:12},
});
