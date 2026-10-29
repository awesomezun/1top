import React,{useState} from 'react';
import {ActivityIndicator,Alert,Image,Linking,Modal,TextInput,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {Text} from './typography';
import {SafeAreaView} from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import {useWorkspace} from './workspace';
import {SessionDetails} from './conversation';
import {format,fresh,layout,usage} from './metrics';
import {accountTags,sessionAccount,short} from './fleet';
import {StateMark} from './state-mark';
import {Icon} from './icons';
import {LANGS,PERIOD_NAMES,resetIn,staleLabel,statusName,windowName} from './i18n';
import {onTheme,quick,toolColor,toolName} from './theme';
import type {Device,Quota,SessionRow,Tile,WindowKey} from './types';

// The tabs other than the dashboard follow the iPhone: a large title, the computer menu at the top
// right, the period picker, and inset grouped lists. The floating tab bar sits over the bottom.
export const shortModel=(model?:string|null)=>{let m=(model||'').trim();if(!m)return '';m=m.replace(/\[1m\]/ig,'');if(/^claude-/i.test(m))m=m.slice(7);if(/^gpt-/i.test(m))m='GPT-'+m.slice(4);return m;};
/** "Claude Code 2", "Claude Code Team", or the tool's name when it has one account. */
export function toolWithAccount(row:SessionRow,tags:Record<string,string>,period:WindowKey){const tag=tags[sessionAccount(row,period)||''];return toolName(row.kind)+(tag?' '+tag:'');}

function Wordmark(){return <Text accessibilityLabel="1top" style={[s.logo,{fontWeight:'600',letterSpacing:0}]}>1top</Text>;}
export function Button({label,onPress,disabled=false,danger=false}:{label:string;onPress:()=>void;disabled?:boolean;danger?:boolean}){return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({pressed})=>[s.button,disabled&&{opacity:.4},pressed&&{backgroundColor:quick.raised}]}><Text style={[s.buttonText,danger&&{color:quick.soft}]}>{label}</Text></Pressable>;}
function Caption({children}:{children:React.ReactNode}){return <Text style={s.caption}>{children}</Text>;}
/** Tells same-tool accounts apart, as on the desktop dashboard: "1", "2", or the account's name. */
export function AccountChip({text}:{text?:string}){const w=useWorkspace();if(!text)return null;return <Text accessibilityLabel={w.t(`Account ${text}`,`계정 ${text}`)} style={s.chip}>{text}</Text>;}

/** One capsule of choices with the chosen one raised, like the iPhone's glass segments. */
export function Segments<V extends string>({items,value,onChange,height=36,size=12.5}:{items:[V,string][];value:V;onChange:(v:V,x:number,y:number)=>void;height?:number;size?:number}){
 return <View style={[s.segments,{height,borderRadius:height/2}]}>{items.map(([v,label])=>{const on=v===value;return <Pressable key={v} accessibilityRole="button" accessibilityState={{selected:on}} onPress={e=>onChange(v,e.nativeEvent.pageX,e.nativeEvent.pageY)}
  style={[s.segment,{borderRadius:(height-6)/2},on&&{backgroundColor:quick.selected}]}><Text numberOfLines={1} style={{fontSize:size,fontWeight:on?'600':'500',color:on?quick.ink:quick.muted}}>{label}</Text></Pressable>;})}</View>;
}
export function PeriodPicker(){const w=useWorkspace();return <Segments items={PERIOD_NAMES.map(([k,en,ko])=>[k,w.t(en,ko)] as [WindowKey,string])} value={w.period} onChange={(v:WindowKey)=>w.setPeriod(v)}/>;}
export const periodLabel=(k:WindowKey,t:(en:string,ko:string)=>string)=>{const p=PERIOD_NAMES.find(x=>x[0]===k);return p?t(p[1],p[2]):k;};
/** The language in one round button: it shows the current language and each tap moves to the next,
 *  한 → EN → 中 → 한, spreading out in a circle like the theme toggle. Remembered on this phone. */
export function LanguageButton({size=30,testID}:{size?:number;testID?:string}){const w=useWorkspace(),mark=LANGS.find(l=>l[0]===w.shownLang)?.[1]||'한',next=LANGS[(LANGS.findIndex(l=>l[0]===w.shownLang)+1)%LANGS.length][2];
 return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={w.t('Language','언어')} accessibilityValue={{text:w.shownLang}} accessibilityHint={w.t('Switches to ','다음으로 바꿉니다: ')+next} onPress={e=>w.cycleLang(e.nativeEvent.pageX,e.nativeEvent.pageY)}
  style={[s.glassButton,{width:size,height:size,borderRadius:size/2}]}><Text style={{fontSize:size>=40?14:12,fontWeight:'600',color:quick.ink}}>{mark}</Text></Pressable>;}

export function SignIn(){const w=useWorkspace();return <SafeAreaView style={s.fill}><ScrollView contentContainerStyle={s.welcome}><Image source={require('../assets/mark.png')} style={{width:88,height:88,borderRadius:22}}/><Wordmark/><Text style={s.hero}>{w.t('Your AI work.\nIn view.','어디서든,\n내 AI 작업을 한눈에.')}</Text><Text style={s.body}>{w.t('Sessions, tokens and computers. Together.','세션, 토큰, 컴퓨터를 한곳에서 확인하세요.')}</Text>
 <View style={{alignItems:'center',paddingVertical:4}}><LanguageButton size={44} testID="welcome-language"/></View>
 <Button label={w.busy?w.t('Connecting…','연결 중…'):w.t('Continue with Google','Google로 계속')} disabled={w.busy} onPress={w.login}/><Button label={w.t('Explore the demo','체험 화면 보기')} onPress={()=>w.setDemo(true)}/><Caption>{w.t('Remote access is available to approved accounts. Install 1top on your computer to collect local activity.','원격 연결은 승인된 계정에서 이용할 수 있습니다. 컴퓨터의 활동을 수집하려면 컴퓨터에 1top을 설치하세요.')}</Caption>{!!w.message&&<Text style={s.notice}>{w.message}</Text>}
 <Group header={w.t('Connection server','연결 서버')}><RelaySettings/></Group><Button label={w.t('Desktop downloads ↗','데스크톱 다운로드 ↗')} onPress={()=>Linking.openURL('https://1top.si/#download')}/></ScrollView></SafeAreaView>;}
export function Loading(){return <SafeAreaView style={[s.fill,{justifyContent:'center'}]}><ActivityIndicator color={quick.mint}/></SafeAreaView>;}
export function Sheet({visible,close,title,children}:{visible:boolean;close:()=>void;title:string;children:React.ReactNode}){const w=useWorkspace();return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}><SafeAreaView style={s.fill}><ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={s.sheet}><View style={s.titleRow}><Text style={[s.title,{flex:1}]}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel={w.t('Close','닫기')} onPress={close} style={s.round}><Icon name="close" size={16} color={quick.ink}/></Pressable></View>{children}</ScrollView></SafeAreaView></Modal>;}

/** All computers or one: the same choices as the dashboard's computer menu. */
export function ComputerList({done}:{done?:()=>void}){const w=useWorkspace();const all:Device[]=w.devices||[];
 const row=(d:Device|null)=>{const on=(d?.id||'all')===w.selected;return <Pressable key={d?.id||'all'} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>{w.setSelected(d?.id||'all');done?.();}} style={s.row}>
  {d?<View style={[s.dot,{backgroundColor:fresh(d)?quick.mint:quick.amber}]}/>:<Icon name="usage" size={14} color={quick.mint}/>}
  <View style={{flex:1}}><Text style={s.body}>{d?d.name:w.t('All computers','모든 컴퓨터')+' · '+all.length}</Text>{d&&<Text style={s.small}>{[d.platform,d.snapshot.version&&'v'+d.snapshot.version,fresh(d)?w.t('Online','온라인'):w.t('Offline · last report ','오프라인 · 마지막 보고 ')+w.when(d.received)].filter(Boolean).join(' · ')}</Text>}</View>
  {on&&<Icon name="check" size={18} color={quick.mint}/>}</Pressable>;};
 return <View style={s.group}>{[null,...all].map((d,i)=><View key={d?.id||'all'}>{i>0&&<View style={s.hair}/>}{row(d)}</View>)}</View>;}

/** A tab's frame: large title, the computer menu when there are several computers, notices. */
export function Screen({title,children}:{title:string;children:React.ReactNode}){const w=useWorkspace(),[choosing,setChoosing]=useState(false);
 return <SafeAreaView edges={['top','left','right']} style={s.fill}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  <View style={s.titleRow}><Text style={s.hero}>{title}</Text><View style={{flex:1}}/>{(w.devices||[]).length>1&&<Pressable accessibilityRole="button" accessibilityLabel={w.t('Choose computer','컴퓨터 선택')} onPress={()=>setChoosing(true)} style={s.glassButton}><Icon name="computer" size={20} color={quick.ink}/></Pressable>}</View>
  {!!w.message&&<Pressable onPress={()=>w.setMessage('')}><Text style={s.notice}>{w.message}</Text></Pressable>}
  {!w.demo&&w.connection.state!=='live'&&<View style={s.card}><Caption>{w.connection.error||w.t('Waiting for a connection. Previous reports stay visible with their timestamp.','연결을 기다립니다. 이전 정보는 수신 시각과 함께 표시됩니다.')}</Caption><Button label={w.t('Reconnect','다시 연결')} onPress={w.connection.retry}/></View>}
  {children}</ScrollView>
  <Sheet visible={choosing} close={()=>setChoosing(false)} title={w.t('Computers','컴퓨터')}><ComputerList done={()=>setChoosing(false)}/></Sheet></SafeAreaView>;}
/** An inset group: a small header, rows on one card, a footer note. */
export function Group({header,footer,children}:{header?:React.ReactNode;footer?:React.ReactNode;children?:React.ReactNode}){return <View style={{gap:7}}>{!!header&&<View style={{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:16}}>{typeof header==='string'?<Text style={s.groupHead}>{header}</Text>:header}</View>}{!!children&&<View style={s.group}>{children}</View>}{!!footer&&<Text style={[s.small,{paddingHorizontal:16}]}>{footer}</Text>}</View>;}
const Hair=()=><View style={s.hair}/>;
function Labeled({label,children}:{label:string;children:React.ReactNode}){return <View style={s.row}><Text style={[s.body,{flex:1}]}>{label}</Text>{typeof children==='string'?<Text numberOfLines={1} style={[s.body,{color:quick.muted,flexShrink:1}]}>{children}</Text>:children}</View>;}

export {SessionDetails};
/** A session in the list: what it is, where it runs, the period's tokens and its pace per hour. */
function SessionItem({row,tags,onPress}:{row:SessionRow;tags:Record<string,string>;onPress:()=>void}){const w=useWorkspace(),ok=fresh(row.device),name=row.terminal||row.project||row.kind;
 const tokens=(()=>{const v=row.windows?.[w.period as WindowKey];return Array.isArray(v)?v.reduce((a,b)=>a+b,0):null;})();
 return <Pressable accessibilityRole="button" onPress={onPress} style={({pressed})=>[s.session,pressed&&{backgroundColor:quick.raised}]}>
  <View style={{width:4,height:46,borderRadius:2,backgroundColor:toolColor(row.kind)}}/>
  <View style={{flex:1,minWidth:0,gap:2}}><Text numberOfLines={1} style={{fontSize:15,fontWeight:'600',color:quick.ink}}>{name}</Text>
   <Text numberOfLines={1} style={s.small}>{[toolWithAccount(row,tags,w.period),shortModel(row.model),row.project].filter(Boolean).join(' · ')}</Text>
   <Text numberOfLines={1} style={[s.small,{color:quick.dim}]}>{[row.device.name,row.app,row.terminal===name?'':row.terminal].filter(Boolean).join(' · ')}</Text></View>
  <View style={{alignItems:'flex-end',gap:3}}><Text style={{fontSize:15,fontWeight:'600',color:quick.ink,fontVariant:['tabular-nums']}}>{short(tokens)}</Text>
   <Text style={[s.small,{fontSize:11}]}>{ok&&row.rate!==null?short((row.rate||0)*3600)+w.t(' tokens/h',' tokens/시간'):'—'}</Text>
   <View style={{flexDirection:'row',alignItems:'center',gap:4}}><StateMark status={ok?row.status:'stale'} size={9}/><Text style={[s.small,{fontSize:11,color:ok&&row.status==='working'?quick.ink:quick.muted}]}>{ok?statusName(row.status,w.t):w.t('Last report ','마지막 보고 ')+w.when(row.device.received)}</Text></View></View>
 </Pressable>;}
export function Sessions(){const w=useWorkspace(),[detail,setDetail]=useState<SessionRow|null>(null),[query,setQuery]=useState('');const tags=accountTags(w.devices||[]);
 const rows:SessionRow[]=w.rows.filter((r:SessionRow)=>!query.trim()||[r.terminal,r.project,r.model,toolName(r.kind),r.app,r.device.name].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 const working=rows.filter(r=>fresh(r.device)&&r.status==='working'),rest=rows.filter(r=>!working.includes(r));
 const section=(title:string,list:SessionRow[])=>!!list.length&&<Group header={title}>{list.map((r,i)=><View key={r.key}>{i>0&&<Hair/>}<SessionItem row={r} tags={tags} onPress={()=>setDetail(r)}/></View>)}</Group>;
 return <Screen title={w.t('Sessions','세션')}>
  <TextInput value={query} onChangeText={setQuery} placeholder={w.t('Session, project, model, computer','세션, 프로젝트, 모델, 컴퓨터')} placeholderTextColor={quick.dim} style={s.search} accessibilityLabel={w.t('Search','검색')}/>
  <PeriodPicker/>
  <View style={{flexDirection:'row',gap:28,paddingHorizontal:6}}><View><Text style={s.metric}>{w.rows.length}</Text><Caption>{w.t('sessions','세션')}</Caption></View><View><Text style={s.metric}>{w.rows.filter((r:SessionRow)=>fresh(r.device)&&r.status==='working').length}</Text><View style={{flexDirection:'row',alignItems:'center',gap:5}}><StateMark status="working"/><Caption>{w.t('working','작업 중')}</Caption></View></View></View>
  {section(w.t(`Working ${working.length}`,`작업 중 ${working.length}`),working)}
  {section(w.t(`Not working ${rest.length}`,`작업 중 아님 ${rest.length}`),rest)}
  {!rows.length&&<Group header={query?w.t('No results','검색 결과 없음'):w.t('No sessions yet','아직 세션이 없습니다')} footer={query?undefined:w.t('Connect a computer to your account. Its active sessions appear here.','컴퓨터를 계정에 연결하면 활동 중인 세션이 표시됩니다.')}/>}
  <SessionDetails key={detail?.key||'none'} row={detail} close={()=>setDetail(null)}/></Screen>;}

export function Map({items}:{items:Tile[]}){const [width,setWidth]=useState(0),[picked,setPicked]=useState<Tile|null>(null);const w=useWorkspace();return <><View onLayout={e=>setWidth(e.nativeEvent.layout.width)} style={{height:240}}>{layout(items,width,240).map(tile=>{const show=(tile.w||0)>110&&(tile.h||0)>82;return <Pressable key={tile.id} accessibilityRole="button" accessibilityLabel={tile.label+', '+tile.value.toLocaleString()+' tokens'} onPress={()=>setPicked(tile)} style={[s.tile,{left:tile.x,top:tile.y,width:Math.max(0,(tile.w||0)-3),height:Math.max(0,(tile.h||0)-3),borderColor:tile.color,backgroundColor:tile.free?quick.raised:tile.color+'30'}]}>{show&&<><Text style={s.tileLabel} numberOfLines={2}>{tile.label}</Text><Text style={[s.number,{color:tile.color}]}>{format(tile.value)}</Text></>}</Pressable>;})}</View><Caption>{w.t('Tap any area for the full label and exact token count.','영역을 누르면 전체 이름과 정확한 토큰 수가 표시됩니다.')}</Caption><Sheet visible={!!picked} close={()=>setPicked(null)} title={picked?.label||''}><Text style={s.metric}>{picked?.value.toLocaleString()}</Text><Caption>tokens · {picked?.share?.toFixed(2)}%</Caption><Text style={s.body}>{picked?.detail}</Text></Sheet></>;}
export function Usage(){const w=useWorkspace(),[group,setGroup]=useState('session');const data=usage(w.rows,w.period,group),label=periodLabel(w.period,w.t);
 return <Screen title={w.t('Usage share','사용량 비율')}><PeriodPicker/>
  <View style={{gap:4,paddingHorizontal:4}}><Caption>{w.t(`Last ${label} · reported tokens, including cache`,`최근 ${label} · 보고된 토큰 · 캐시 포함`)}</Caption><Text style={s.metric}>{format(data.sum)}</Text></View>
  <Segments items={[['session',w.t('Sessions','세션')],['app',w.t('Apps','실행 앱')],['tool',w.t('Tools','실행 도구')],['model',w.t('Models','모델')]]} value={group} onChange={setGroup}/>
  {data.items.length?<Map items={data.items}/>:<Caption>{w.t('No positive reported usage in this period.','이 기간에 보고된 양의 사용량이 없습니다.')}</Caption>}
  <Caption>{w.t(`${data.known} reported · ${data.unknown} unknown · ${data.zero} zero`,`보고 ${data.known} · 미보고 ${data.unknown} · 사용량 0 세션 ${data.zero}`)}</Caption><Caption>{w.t('Current fresh sessions only. This is not a billing amount.','현재 최신 정보가 있는 세션 기준입니다. 청구 금액이 아닙니다.')}</Caption></Screen>;}

/** Account limits: each account once, its windows as the provider reports them, which computers
 *  reported them and when. */
export function Accounts(){const w=useWorkspace(),tags=accountTags(w.devices||[]);
 const entries:{quota:Quota;computers:string[];fresh:boolean}[]=[];
 for(const d of w.visible as Device[])for(const q of d.snapshot.account_quotas||[]){const e=entries.find(x=>x.quota.id===q.id);if(e){e.computers.push(d.name);if((q.updated||0)>(e.quota.updated||0)){e.quota=q;e.fresh=fresh(d);}}else entries.push({quota:q,computers:[d.name],fresh:fresh(d)});}
 return <Screen title={w.t('Account limits','계정 한도')}>
  {!entries.length&&<Group header={w.t('No account report yet','계정 정보가 없습니다')} footer={w.t('Sign in to your AI tools on the computer. Available limits will appear here.','컴퓨터에서 AI 도구에 로그인하면 수집 가능한 한도가 표시됩니다.')}/>}
  {entries.map(({quota:q,computers,fresh:ok})=><Group key={q.id} header={<><View style={[s.dot,{backgroundColor:toolColor(q.kind)}]}/><Text style={[s.groupHead,{color:quick.ink}]}>{toolName(q.kind)}</Text><AccountChip text={tags[q.id]}/><Text style={s.groupHead}>{q.plan}</Text></>}
   footer={[q.account_label,computers.join(', '),q.stale||!ok?staleLabel(q,w.t):w.t('Updated ','업데이트 ')+w.when(q.updated*1000)].filter(Boolean).join(' · ')}>
   {q.windows.map((win,i)=><View key={i}>{i>0&&<Hair/>}<View style={{paddingHorizontal:16,paddingVertical:12,gap:8}}><View style={{flexDirection:'row'}}><Text style={[s.body,{flex:1}]}>{windowName(win,w.t)}</Text><Text style={[s.body,{fontWeight:'600'}]}>{win.pct===null?w.t('Unknown','미확인'):Math.round(win.pct*10)/10+'%'+w.t(' used',' 사용')}</Text></View>
    <View style={s.track}><View style={[s.bar,{width:Math.min(100,win.pct||0)+'%' as any,backgroundColor:(win.pct||0)>=85?quick.amber:toolColor(q.kind)}]}/></View><Text style={s.small}>{resetIn(win.reset,w.t)}</Text></View></View>)}
  </Group>)}
  <Text style={[s.small,{paddingHorizontal:16}]}>{w.t('Add or switch AI accounts in the desktop app. Provider credentials stay on that computer.','AI 계정 추가·전환은 데스크톱 앱에서 합니다. 제공업체 인증 정보는 해당 컴퓨터에 보관됩니다.')+' '+w.t('Account names are the ones given in the desktop app.','계정 이름은 데스크톱 앱에서 정한 이름을 따릅니다.')}</Text></Screen>;}

function RelaySettings(){const w=useWorkspace(),[address,setAddress]=useState(w.relay);return <View style={{padding:16,gap:10}}><TextInput accessibilityLabel={w.t('Relay HTTPS address','연결 서버 HTTPS 주소')} value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} editable={!w.token&&!w.busy} keyboardType="url" style={[s.body,s.input]} /><Caption>{w.t('Use your own trusted Cloudflare relay, or the 1top managed server. Sign out before changing it.','본인의 신뢰할 수 있는 Cloudflare 서버 또는 1top 관리형 서버를 사용합니다. 변경 전에 로그아웃하세요.')}</Caption><Button disabled={!!w.token||w.busy||address===w.relay} label={w.t('Use this server','이 서버 사용')} onPress={()=>Alert.alert(w.t('Connect to this server?','이 서버로 연결할까요?'),address,[{text:w.t('Cancel','취소'),style:'cancel'},{text:w.t('Use server','사용'),onPress:()=>w.changeRelay(address).catch((e:Error)=>w.setMessage(e.message))}])}/></View>;}
export function ConnectionBadge(){const w=useWorkspace();const [label,color]=w.demo?[w.t('Demo','데모'),'#4c8dff']:w.connection.state==='live'?[w.t('Live','실시간'),quick.mint]:w.connection.state==='connecting'?[w.t('Connecting','연결 중'),quick.amber]:[w.t('Offline','오프라인'),quick.amber];
 return <View style={{flexDirection:'row',alignItems:'center',gap:6}}><View style={[s.dot,{width:7,height:7,backgroundColor:color}]}/><Text style={[s.body,{color:quick.muted}]}>{label}</Text></View>;}
export function Settings(){const w=useWorkspace();const host=String(w.relay||'').replace(/^https?:\/\//,'').replace(/\/.*$/,'');
 const version=[Constants.expoConfig?.version,Constants.expoConfig?.android?.versionCode&&'('+Constants.expoConfig.android.versionCode+')'].filter(Boolean).join(' ');
 return <Screen title={w.t('Workspace','워크스페이스')}>
  <Group header={w.t('Connection','연결')}><Labeled label={w.t('Status','상태')}><ConnectionBadge/></Labeled><Hair/><Labeled label={w.t('Server','서버')}>{host}</Labeled></Group>
  <Group header={w.t('Account','계정')} footer={w.t('Remote access does not add AI credits. Usage is reported by your computer.','원격 연결에 AI 사용 크레딧은 포함되지 않습니다. 사용량은 컴퓨터가 보고한 값입니다.')}><View style={s.row}><Text style={s.body}>{w.demo?w.t('Demo workspace','체험 워크스페이스'):w.connection.account?.role==='admin'?w.t('Admin · Pro','관리자 · Pro'):w.t('Connected account','연결된 계정')}</Text></View></Group>
  <Group header={w.t('Computers','컴퓨터')}/><View style={{marginTop:-10}}><ComputerList/></View>
  {(w.visible as Device[]).map(d=>{const h=d.snapshot.host,ops=d.snapshot.operations;return <Group key={d.id} header={d.name+' · Goals · Loops · Skills'} footer={w.t('Loop activity is not yet verified. Installed skills do not mean they are running.','Loop 실행 여부는 아직 검증하지 못했습니다. 설치된 스킬이 실행 중이라는 의미는 아닙니다.')}>
   <View style={s.row}><Text style={s.small}>{[d.platform,'CPU '+(h?.cpu==null?'—':Math.round(h.cpu*10)/10+'%'),h?.used_memory?'RAM '+(h.used_memory/2**30).toFixed(1)+' GB':''].filter(Boolean).join(' · ')}</Text></View><Hair/>
   <Labeled label={w.t('Installed skills','설치된 스킬')}>{ops?.installed_skills==null?'—':String(ops.installed_skills)}</Labeled><Hair/><Labeled label={w.t('Observed events','관측된 이벤트')}>{ops?.observed_events==null?'—':String(ops.observed_events)}</Labeled>
   {(ops?.goals||[]).map((g,i)=><View key={i}><Hair/><Labeled label={[g.runtime,g.status].filter(Boolean).join(' · ')}>{short(g.tokens_used)+' tokens'}</Labeled></View>)}</Group>;})}
  <Group header={w.t('Connection server','연결 서버')}><RelaySettings/></Group>
  <Group header={w.t('Theme and language','테마와 언어')}><View style={{padding:12,gap:10}}><Segments items={[['system',w.t('System','시스템')],['light',w.t('Light','라이트')],['dark',w.t('Dark','다크')]]} value={w.appearance} onChange={v=>w.setAppearance(v)}/></View><Hair/>
   <View style={s.row}><Text style={[s.body,{flex:1}]}>{w.t('Language','언어')}</Text><Text style={[s.body,{color:quick.muted}]}>{LANGS.find(l=>l[0]===w.shownLang)?.[2]}</Text><LanguageButton testID="settings-language"/></View></Group>
  <Group><Pressable accessibilityRole="link" onPress={()=>Linking.openURL('https://1top.si/#download')} style={s.row}><Text style={[s.body,{color:quick.mint}]}>{w.t('Get the desktop app ↗','데스크톱 앱 다운로드 ↗')}</Text></Pressable><Hair/><Pressable accessibilityRole="link" onPress={()=>Linking.openURL('https://1top.si/privacy')} style={s.row}><Text style={[s.body,{color:quick.mint}]}>{w.t('Privacy ↗','개인정보 처리 ↗')}</Text></Pressable></Group>
  <Group footer={'1top Android · '+version}><Pressable accessibilityRole="button" disabled={w.busy} onPress={w.logout} style={s.row}><Text style={[s.body,{color:w.demo?quick.mint:quick.red}]}>{w.demo?w.t('Leave demo','체험 종료'):w.t('Sign out','로그아웃')}</Text></Pressable></Group>
 </Screen>;}

const make=()=>StyleSheet.create({fill:{flex:1,backgroundColor:quick.background},content:{padding:16,gap:18,paddingBottom:130,maxWidth:820,width:'100%',alignSelf:'center'},sheet:{padding:16,gap:14,paddingBottom:36},welcome:{padding:28,gap:16,maxWidth:560,width:'100%',alignSelf:'center',paddingTop:60},
 hero:{fontSize:32,fontWeight:'700',letterSpacing:-.6,lineHeight:40,color:quick.ink},logo:{fontSize:24,fontWeight:'700',color:quick.ink},body:{fontSize:16,lineHeight:22,color:quick.ink},caption:{fontSize:13.5,lineHeight:19,color:quick.muted},small:{fontSize:12.5,lineHeight:17,color:quick.muted},
 titleRow:{flexDirection:'row',alignItems:'center',gap:12},row:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,minHeight:48,paddingVertical:10},
 group:{backgroundColor:quick.card,borderRadius:16,overflow:'hidden'},groupHead:{fontSize:13,fontWeight:'600',color:quick.muted},hair:{height:StyleSheet.hairlineWidth,backgroundColor:quick.line,marginLeft:16},
 card:{backgroundColor:quick.card,borderRadius:16,padding:16,gap:10},title:{fontSize:20,lineHeight:27,fontWeight:'600',color:quick.ink},
 button:{paddingVertical:13,paddingHorizontal:16,minHeight:46,borderRadius:14,backgroundColor:quick.card,justifyContent:'center'},buttonText:{fontSize:15,fontWeight:'600',color:quick.ink},
 round:{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:quick.raised},glassButton:{width:44,height:44,borderRadius:22,alignItems:'center',justifyContent:'center',backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine},
 segments:{flexDirection:'row',padding:3,gap:2,backgroundColor:quick.glass,borderWidth:1,borderColor:quick.glassLine},segment:{flex:1,alignItems:'center',justifyContent:'center',paddingHorizontal:4},
 chip:{fontSize:10.5,fontWeight:'600',color:quick.ink,backgroundColor:quick.chip,paddingHorizontal:5,borderRadius:4,overflow:'hidden',minWidth:16,textAlign:'center'},
 dot:{width:8,height:8,borderRadius:4},session:{flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:14,paddingVertical:10},
 search:{height:40,borderRadius:12,paddingHorizontal:14,backgroundColor:quick.raised,color:quick.ink,fontSize:15},input:{borderWidth:1,borderColor:quick.line,padding:12,borderRadius:10},
 metric:{fontSize:30,lineHeight:38,fontWeight:'600',color:quick.ink,fontVariant:['tabular-nums']},number:{fontSize:16,fontWeight:'500',color:quick.ink,fontVariant:['tabular-nums']},
 tile:{position:'absolute',borderRadius:7,borderWidth:1,padding:10,overflow:'hidden',justifyContent:'space-between'},tileLabel:{fontSize:15,lineHeight:21,color:quick.ink,fontWeight:'600'},
 notice:{padding:14,backgroundColor:quick.notice,color:quick.noticeInk,borderRadius:12,fontSize:15,lineHeight:23},track:{height:6,borderRadius:3,backgroundColor:quick.raised,overflow:'hidden'},bar:{height:6,borderRadius:3}});
let s=make();onTheme(()=>{s=make();});
