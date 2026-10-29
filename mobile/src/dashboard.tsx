import React,{useEffect,useMemo,useState} from 'react';
import {Image,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Svg,{Circle,G,Line,Path,Polygon} from 'react-native-svg';
import {Text} from './typography';
import {useWorkspace} from './workspace';
import {total,valid} from './metrics';
import type {Flow,Quota,SessionRow,WindowKey} from './types';

// The phone dashboard follows the Mac menu bar quick view: the same palette, sizes and order.
// The period picker governs every number below it.
export const quick={background:'#0b0d0f',card:'#121518',raised:'#1c2125',line:'#23292e',ink:'#edf1f3',muted:'#9aa5ae',dim:'#6c7882',
 accent:'#6ccfa9',segmentOn:'#74d4b1',segmentLead:'#c4f5e2',segmentOff:'#1d2327',grid:'#2b3238',amber:'#e9b25c',red:'#ff6450'};
export const toolColor=(kind:string)=>({Claude:'#d4956b',Codex:'#3fae8c',GLM:'#8f98e0',Antigravity:'#619db9',Aside:'#a99bdb'} as Record<string,string>)[kind]||'#8b939f';
export const toolName=(kind:string)=>kind==='Claude'?'Claude Code':kind==='Antigravity'?'Agy CLI':kind;
const PERIODS:[WindowKey,string,string][]=[['10m','10분','10m'],['30m','30분','30m'],['1h','1시간','1h'],['5h','5시간','5h'],['12h','12시간','12h'],['24h','24시간','24h']];
const SECONDS:Record<WindowKey,number>={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
const ORDER=['Claude','Codex','GLM','Antigravity','Aside'];

/** 158M, 7.5M, 0. Unknown stays a dash, never zero. */
export function short(n:number|null|undefined){if(!valid(n))return '—';if(n<.5)return '0';const [d,u]=n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];const x=n/d;return (x>=10?String(Math.round(x)):String(Number(x.toFixed(1))))+u;}
export function pct(n:number|null|undefined){if(!valid(n))return '—';if(n===0)return '0%';if(n<.05)return '<0.1%';const t=Math.round(n*10)/10;return (Number.isInteger(t)?String(t):t.toFixed(1))+'%';}
export const shortModel=(s:SessionRow)=>{let m=(s.model||'').trim();if(!m)return toolName(s.kind);m=m.replace(/\[1m\]/ig,'');if(/^claude-/i.test(m))m=m.slice(7);if(/^gpt-/i.test(m))m='GPT-'+m.slice(4);return m;};
const display=(s:SessionRow)=>s.project==='0'&&s.kind==='Aside'?'Aside workspace':s.project;
const nameOf=(s:SessionRow)=>(s.terminal||'').trim()||display(s)||s.kind;

/** Bins from the nested period totals: for the last hour, the last 10 minutes, 10–30 and 30–60 minutes ago.
 *  Each bin is a speed in tokens per hour by tool, so bins of different lengths compare fairly. */
function reading(rows:SessionRow[],period:WindowKey,periodTotal:number|null,flow?:Flow){
 const seconds=SECONDS[period],sum=rows.map(r=>total(r.windows[period])).filter(valid),totalTokens=periodTotal??(sum.length?sum.reduce((a,b)=>a+b,0):null),average=totalTokens===null?null:totalTokens/seconds*3600;
 // Fine bins from the collector when the relay carries them: oldest first, tokens per bin.
 if(flow?.bins?.length&&flow.step>0){const n=flow.bins.length;return {average,bins:flow.bins.map((values,i)=>{const parts=Object.entries(values).sort((a,b)=>(ORDER.indexOf(a[0])+99)%99-(ORDER.indexOf(b[0])+99)%99).map(([k,v])=>[k,Math.max(0,v)/flow.step*3600] as [string,number]);const ago=(n-1-i)*flow.step;return {start:ago,end:Math.min(seconds,ago+flow.step),parts,total:parts.reduce((a,p)=>a+p[1],0)};}).reverse()};}
 const keys=PERIODS.map(([k])=>k).filter(k=>SECONDS[k]<seconds);
 const edges:[number,WindowKey|null][]=[[0,null],...keys.map(k=>[SECONDS[k],k] as [number,WindowKey]),[seconds,period]];
 const kinds=[...new Set(rows.map(r=>r.kind))].sort((a,b)=>(ORDER.indexOf(a)+99)%99-(ORDER.indexOf(b)+99)%99);
 const within=(r:SessionRow,k:WindowKey|null)=>k?total(r.windows[k])??0:0;
 const bins=edges.slice(1).map(([b,kb],i)=>{const [a,ka]=edges[i];const parts=kinds.map(kind=>[kind,rows.filter(r=>r.kind===kind).reduce((n,r)=>n+Math.max(0,within(r,kb)-within(r,ka)),0)/(b-a)*3600] as [string,number]);return {start:a,end:b,parts,total:parts.reduce((n,p)=>n+p[1],0)};});
 return {bins,average};
}

const P=(cx:number,cy:number,r:number,a:number)=>[cx+r*Math.cos(a*Math.PI/180),cy+r*Math.sin(a*Math.PI/180)];
function sector(cx:number,cy:number,r0:number,r1:number,a0:number,a1:number){const [x0,y0]=P(cx,cy,r1,a0),[x1,y1]=P(cx,cy,r1,a1),[x2,y2]=P(cx,cy,r0,a1),[x3,y3]=P(cx,cy,r0,a0),l=a1-a0>180?1:0;
 return `M${x0} ${y0}A${r1} ${r1} 0 ${l} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${l} 0 ${x3} ${y3}Z`;}
function arc(cx:number,cy:number,r:number,a0:number,a1:number){const [x0,y0]=P(cx,cy,r,a0),[x1,y1]=P(cx,cy,r,a1);return `M${x0} ${y0}A${r} ${r} 0 ${a1-a0>180?1:0} 1 ${x1} ${y1}`;}

/** Seven-segment digits: whole numbers on three places with the unit letter. */
function Digits({value,height}:{value:number|null;height:number}){
 const lit:Record<string,string>={'0':'abcdef','1':'bc','2':'abged','3':'abgcd','4':'fgbc','5':'afgcd','6':'afgedc','7':'abc','8':'abcdefg','9':'abcdfg','-':'g',' ':''};
 let digits='---',unit='';
 if(valid(value)){if(value<.5)digits='  0';else{const [d,u]=value>=1e9?[1e9,'B']:value>=1e6?[1e6,'M']:value>=1e3?[1e3,'k']:[1,''];digits=String(Math.min(999,Math.round(value/d))).padStart(3,' ');unit=u;}}
 const h=height,w=h*.55,gap=h*.15,t=h*.115,ht=t/2,g=h*.031,slant=Math.tan(9*Math.PI/180),skew=h*slant,unitSize=h*.46;
 const hz=(y:number,x0:number,x1:number)=>`${x0},${y} ${x0+ht},${y-ht} ${x1-ht},${y-ht} ${x1},${y} ${x1-ht},${y+ht} ${x0+ht},${y+ht}`;
 const vt=(x:number,y0:number,y1:number)=>`${x},${y0} ${x+ht},${y0+ht} ${x+ht},${y1-ht} ${x},${y1} ${x-ht},${y1-ht} ${x-ht},${y0+ht}`;
 const seg:Record<string,string>={a:hz(ht,ht+g,w-ht-g),g:hz(h/2,ht+g,w-ht-g),d:hz(h-ht,ht+g,w-ht-g),f:vt(ht,ht+g,h/2-g),b:vt(w-ht,ht+g,h/2-g),e:vt(ht,h/2+g,h-ht-g),c:vt(w-ht,h/2+g,h-ht-g)};
 const width=3*w+2*gap+(unit?gap+unitSize*.82:0)+skew,on=valid(value)?quick.segmentOn:quick.segmentOn+'66';
 return <View style={{width,height:h}}>
  <Svg width={width} height={h}><G transform={`matrix(1 0 ${-slant} 1 ${skew} 0)`}>
   {[...digits].map((ch,i)=>[...'abcdefg'].map(k=><Polygon key={i+k} points={seg[k]} fill={(lit[ch]||'').includes(k)?on:quick.segmentOff} transform={`translate(${i*(w+gap)} 0)`}/>))}
  </G></Svg>
  {!!unit&&<Text style={{position:'absolute',left:3*w+3*gap,bottom:-h*.06,color:quick.segmentOn,fontSize:unitSize,fontWeight:'700',fontStyle:'italic'}}>{unit}</Text>}
 </View>;
}

/** Scope: one turn is the period. The newest bin sits just right of ▼ (now) and the ring goes back
 *  in time clockwise to an opening left of twelve o'clock. A beam sweeps while tokens flow. */
function Scope({data,size,period}:{data:ReturnType<typeof reading>;size:number;period:WindowKey}){
 const t=useWorkspace().t;
 const [head,setHead]=useState(-90),[grow,setGrow]=useState(0),moving=(data.average??0)>0;
 // The first frame resets the grow-in; state changes only happen in animation frames.
 useEffect(()=>{const start=Date.now();let frame=0;const tick=()=>{const t=(Date.now()-start)/1000;setGrow(Math.min(1,1-Math.pow(1-Math.min(1,t/.8),3)));setHead(moving?(Date.now()/1000*80)%360-90:-90);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[period,moving]);
 const c=size/2,outer=size/2-7,inner=outer*.6,opening=12,end=270-opening,span=360-opening,seconds=SECONDS[period];
 const scale=Math.max(data.average??0,...data.bins.map(b=>b.total))*1.06,rr=(v:number)=>inner+(outer-inner)*(scale>0?Math.min(1,v/scale)*grow:0);
 const bars:React.ReactNode[]=[];
 data.bins.forEach((bin,i)=>{if(!(bin.total>0))return;const a0=-90+bin.start/seconds*span+.6,a1=-90+bin.end/seconds*span-.6,age=data.bins.length>1?i/(data.bins.length-1):0,rest=.9-.58*age,newest=i===0;
  const behind=(((head-(a0+a1)/2)%360)+360)%360,lit=moving&&!newest?Math.exp(-behind/75):0;let r0=inner+1,acc=0;
  for(const [kind,v] of bin.parts){if(!(v>0))continue;acc+=v;const r1=rr(acc);if(r1<=r0+.3)continue;bars.push(<Path key={i+kind} d={sector(c,c,r0,r1,a0,a1)} fill={toolColor(kind)} opacity={newest?1:rest+(1-rest)*.75*lit}/>);r0=r1;}
  if(newest&&r0>inner+1)bars.push(<Path key={'edge'+i} d={sector(c,c,inner+1,r0,a0,a1)} fill="none" stroke={quick.segmentLead} strokeWidth={1}/>);});
 return <View style={{width:size,height:size}}>
  <Svg width={size} height={size}>
   {Array.from({length:12},(_,k)=>{const [x0,y0]=P(c,c,inner,-90+30*k),[x1,y1]=P(c,c,outer,-90+30*k);return <Line key={'s'+k} x1={x0} y1={y0} x2={x1} y2={y1} stroke={quick.grid} strokeOpacity={.7} strokeWidth={.7}/>;})}
   {[.25,.5,.75,1].map(f=><Path key={'r'+f} d={arc(c,c,inner+(outer-inner)*f,-90,end)} fill="none" stroke={quick.grid} strokeWidth={.8} strokeDasharray={f===1?undefined:'1.5 3'}/>)}
   <Line x1={c} y1={c-inner} x2={c} y2={c-outer} stroke={quick.red} strokeOpacity={.6} strokeWidth={1}/>
   {moving&&Array.from({length:12},(_,j)=><Path key={'w'+j} d={sector(c,c,inner,outer,head-(j+1)*4,head-j*4)} fill={quick.segmentOn} opacity={.26*Math.pow(1-j/12,1.6)}/>)}
   {bars}
   {moving&&(()=>{const [x0,y0]=P(c,c,inner,head),[x1,y1]=P(c,c,outer+2,head);return <Line x1={x0} y1={y0} x2={x1} y2={y1} stroke={quick.segmentLead} strokeOpacity={.9} strokeWidth={1.4} strokeLinecap="round"/>;})()}
   {valid(data.average)&&data.average>0&&<Path d={arc(c,c,rr(data.average),-90,end)} fill="none" stroke={quick.segmentLead} strokeWidth={1.1} strokeDasharray="3 2.5"/>}
   <Circle cx={c} cy={c} r={inner-3} fill={quick.card} stroke={quick.grid} strokeWidth={.8}/>
   <Polygon points={`${c-3.5},${c-outer-6.5} ${c+3.5},${c-outer-6.5} ${c},${c-outer-1}`} fill={quick.red}/>
  </Svg>
  <View style={[StyleSheet.absoluteFill,{alignItems:'center',justifyContent:'center'}]} pointerEvents="none">
   <Text style={{color:quick.dim,fontSize:10.5}}>{t('Average','평균')}</Text>
   <Digits value={data.average} height={29}/>
   <Text style={{color:quick.muted,fontSize:10.5,marginTop:2}}>{data.average===null?t('Checking','확인 중'):t('tokens/h','tokens/시간')}</Text>
  </View>
 </View>;
}

/** A small speedometer that leads each session row: current tokens per hour on a shared scale; the hub shows the state. */
function MiniGauge({value,scale,color,hub}:{value:number|null;scale:number;color:string;hub:string}){
 const w=20,h=12,c={x:w/2,y:h-1.5},r=Math.min(w/2-1.5,h-3),pace=value??0,angle=180+180*Math.min(1,Math.max(0,pace/Math.max(scale,.0001)));
 const a=(to:number)=>{const [x0,y0]=P(c.x,c.y,r,180),[x1,y1]=P(c.x,c.y,r,to);return `M${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}`;};
 const [tx,ty]=P(c.x,c.y,r-1.5,angle);
 return <Svg width={w} height={h}><Path d={a(359.9)} stroke={quick.line} strokeWidth={2.6} strokeLinecap="round" fill="none"/>
  {pace>0&&<Path d={a(angle)} stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none"/>}
  {value!==null&&<Line x1={c.x} y1={c.y} x2={tx} y2={ty} stroke={pace>0?quick.ink:quick.dim} strokeWidth={1.2} strokeLinecap="round"/>}
  <Circle cx={c.x} cy={c.y} r={2} fill={hub}/></Svg>;
}

/** A root session with its subagents. Usage adds up; weekly estimates add up only within the root's account. */
type Group={root:SessionRow;members:SessionRow[]};
function groups(rows:SessionRow[]):Group[]{const by=new Map<string,SessionRow[]>();for(const r of rows){const k=r.device.id+':'+(r.root_session_id||r.id);by.set(k,[...(by.get(k)||[]),r]);}
 return [...by.entries()].map(([k,m])=>({root:m.find(r=>r.device.id+':'+r.id===k)||m[0],members:m}));}
const gTokens=(g:Group,p:WindowKey)=>{const v=g.members.map(r=>total(r.windows[p])).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};
const gWorking=(g:Group)=>g.members.some(r=>r.status==='working');
const gRate=(g:Group)=>{const v=g.members.map(r=>r.rate).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};
function sameAccount(g:Group,p:WindowKey){const acct=g.root.weekly_estimate?.[p]?.account_id||g.root.weekly_account;if(!acct)return [];return g.members.map(r=>[r,r.weekly_estimate?.[p]] as const).filter(([,e])=>e&&e.account_id===acct);}
const gEstimate=(g:Group,p:WindowKey)=>{const v=sameAccount(g,p).map(([,e])=>e?.used_pp).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};
const gPace=(g:Group,p:WindowKey)=>{const v=sameAccount(g,p).map(([r,e])=>valid(r.rate)&&valid(e?.calibration?.pp_per_token)?r.rate*e!.calibration!.pp_per_token!*3600:null).filter(valid);return v.length?v.reduce((a,b)=>a+b,0):null;};

/** The weekly % across the period, ending at the current report. */
function Spark({points,start,end,color,faded}:{points:number[][];start:number;end:number;color:string;faded:boolean}){
 const [w,setW]=useState(0),h=14;
 const pts=points.filter(p=>p.length>=2&&valid(p[0])&&p[0]<=end&&valid(p[1])&&p[1]<=100).sort((a,b)=>a[0]-b[0]);const first=pts.findIndex(p=>p[0]>=start),use=first<0?[]:pts.slice(Math.max(0,first-1));
 let lo=Math.min(...use.map(p=>p[1])),hi=Math.max(...use.map(p=>p[1]));if(hi-lo<2){const m=(hi+lo)/2;lo=m-1;hi=m+1;}const pad=(hi-lo)*.15;lo-=pad;hi+=pad;if(lo<0){hi-=lo;lo=0;}
 const pw=Math.max(1,w-6),xy=(p:number[])=>[(Math.max(start,p[0])-start)/(end-start)*pw,5+(1-(p[1]-lo)/(hi-lo))*(h-10)];
 const line=use.map((p,i)=>{const [x,y]=xy(p);return (i?'L':'M')+x+' '+y;}).join(''),tip=use.length?xy(use[use.length-1]):null;
 return <View style={{flex:1,height:h,opacity:faded?.5:1}} onLayout={e=>setW(e.nativeEvent.layout.width)}>{w>0&&use.length>0&&<Svg width={w} height={h}><Path d={line} stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round"/>{tip&&<><Circle cx={tip[0]} cy={tip[1]} r={4.5} fill={color} opacity={.25}/><Circle cx={tip[0]} cy={tip[1]} r={2.4} fill={color}/></>}</Svg>}</View>;
}

const nice=(v:number)=>{if(!(v>0))return 1;const p=10**Math.floor(Math.log10(v));return ([1,2,5,10].map(n=>n*p).find(n=>n>=v))||10*p;};

export function Dashboard(){
 const w=useWorkspace(),t=w.t,period:WindowKey=w.period,rows:SessionRow[]=w.rows;
 const periodName=(k:WindowKey)=>{const p=PERIODS.find(x=>x[0]===k);return p?t(p[2],p[1]):k;};
 const device=(w.visible||[])[0],live=w.demo||w.connection?.state==='live';
 const periodTotal=null;
 const flow=(w.visible||[])[0]?.snapshot?.flow?.[period];
 const data=useMemo(()=>reading(rows,period,periodTotal,flow),[rows,period,flow]);
 const ordered=useMemo(()=>groups(rows).sort((a,b)=>{const wa=gWorking(a),wb=gWorking(b);if(wa!==wb)return wa?-1:1;const ta=gTokens(a,period)??-1,tb=gTokens(b,period)??-1;return ta!==tb?tb-ta:a.root.key<b.root.key?-1:1;}),[rows,period]);
 // Weekly % needs the collector's estimates; a collector that does not send them shows tokens.
 const tokensMode=!rows.some(r=>r.weekly_estimate);
 const slices=useMemo(()=>{const by=new Map<string,{kind:string;model:string;tokens:number}>();for(const s of rows){const t=total(s.windows[period]);if(!valid(t)||t<=0)continue;const m=shortModel(s),k=s.kind+'|'+m;const o=by.get(k);if(o)o.tokens+=t;else by.set(k,{kind:s.kind,model:m,tokens:t});}
  const list=[...by.values()].sort((a,b)=>b.tokens-a.tokens),sum=list.reduce((n,x)=>n+x.tokens,0),shown=list.length<=4?list:list.slice(0,3),seen:Record<string,number>={};
  const out=shown.map(x=>{const i=seen[x.kind]||0;seen[x.kind]=i+1;return {id:x.kind+x.model,name:x.model,detail:toolName(x.kind),color:toolColor(x.kind),opacity:[1,.68,.46][Math.min(i,2)],value:x.tokens};});
  const rest=sum-shown.reduce((n,x)=>n+x.tokens,0);if(rest>sum*.005)out.push({id:'rest',name:t('Other models','기타 모델'),detail:String(list.length-shown.length),color:quick.dim,opacity:1,value:rest});return {out,sum};},[rows,period,t]);
 const quotas:Quota[]=(device?.snapshot?.account_quotas||[]).slice(0,4),host=device?.snapshot?.host,now:number=w.clock/1000;
 const memory=host&&valid(host.used_memory)&&valid(host.total_memory)&&host.total_memory>0?host.used_memory/host.total_memory*100:null;
 const paces=ordered.map(g=>tokensMode?(()=>{const r=gRate(g);return r===null?null:r*3600;})():gPace(g,period)),scale=nice(Math.max(1,...paces.filter(valid)));
 const end=device?.snapshot?.updated||now,start=end-SECONDS[period];
 const label=w.demo?t('Demo','데모')+' · '+(device?.name||''):live?t('Live','실시간')+' · '+(device?.name||''):w.connection?.state==='connecting'?t('Connecting','연결 중'):t('Offline · last report','오프라인 · 마지막 기록');
 return <SafeAreaView edges={['top']} style={{flex:1,backgroundColor:quick.background}}>
  <ScrollView contentContainerStyle={{paddingBottom:24}}>
   <View style={st.header}><Image source={require('../assets/mark.png')} style={{width:22,height:22,borderRadius:5}}/><Text style={{color:quick.ink,fontSize:17,fontWeight:'600'}}>1top</Text><View style={{flex:1}}/>
    <View style={st.pill}><View style={[st.dot,{backgroundColor:live?quick.accent:quick.amber}]}/><Text numberOfLines={1} style={{color:quick.muted,fontSize:11.5}}>{label}</Text></View></View>
   <View style={st.picker}>{PERIODS.map(([key])=>{const on=key===period;return <Pressable key={key} accessibilityRole="button" accessibilityState={{selected:on}} onPress={()=>w.setPeriod(key)} style={[st.pickerItem,on&&{backgroundColor:quick.raised}]}><Text style={{fontSize:12.5,fontWeight:on?'600':'500',color:on?quick.ink:quick.muted}}>{periodName(key)}</Text></Pressable>;})}</View>
   <View style={{paddingHorizontal:16}}>
    <View style={st.titleRow}><Text style={st.title}>{t('Token usage','토큰 사용')}</Text><Text style={st.sub}>{t('Last ','최근 ')+periodName(period)}</Text></View>
    <View style={{flexDirection:'row',alignItems:'center',gap:16}}>
     <Scope data={data} size={176} period={period}/>
     <View style={{flex:1,gap:10}}>
      {slices.out.length?<><Text style={{color:quick.muted,fontSize:10.5}}>{t('By model','모델별')}</Text>
       <View style={{flexDirection:'row',gap:2,height:8}}>{slices.out.map(x=><View key={x.id} style={{flex:x.value,backgroundColor:x.color,opacity:x.opacity,transform:[{skewX:'-20deg'}]}}/>)}</View>
       <View style={{gap:8}}>{slices.out.map(x=><View key={x.id} style={{flexDirection:'row',alignItems:'flex-start',gap:7}}><View style={[st.dot,{backgroundColor:x.color,opacity:x.opacity,marginTop:5}]}/><View style={{flex:1}}><Text numberOfLines={1} style={{color:quick.ink,fontSize:11.5,fontWeight:'600'}}>{x.name}</Text><Text numberOfLines={1} style={{color:quick.muted,fontSize:10.5}}>{x.detail}</Text></View><Text style={{color:quick.ink,fontSize:11.5,fontWeight:'600'}}>{slices.sum>0?(x.value/slices.sum*100<1?'<1%':Math.round(x.value/slices.sum*100)+'%'):'—'}</Text></View>)}</View></>
       :<Text style={{color:quick.muted,fontSize:11.5}}>{data.average===null?t('Checking usage','사용량을 확인하고 있습니다'):t('No usage reported in this period','이 기간에 보고된 사용이 없습니다')}</Text>}
     </View>
    </View>
   </View>
   <View style={{paddingHorizontal:14,paddingTop:14,gap:7}}>
    <View style={[st.titleRow,{paddingHorizontal:2,marginBottom:0}]}><Text style={st.title}>{t('Weekly limits','주간 한도')}</Text><Text style={st.sub}>{t('100% per account','계정별 100%')}</Text></View>
    {quotas.length?<View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{quotas.map(q=>{const wk=q.windows.find(x=>['주간','Weekly','7d'].includes(x.label)),color=toolColor(q.kind),mins=wk?.reset?Math.ceil((wk.reset-now)/60):0;
      return <View key={q.id} style={[st.tile,{backgroundColor:color+'12'}]}><View style={{flexDirection:'row',alignItems:'center',gap:5}}><View style={[st.dot,{backgroundColor:color}]}/><Text style={{color:quick.ink,fontSize:12.5,fontWeight:'600'}}>{toolName(q.kind)}</Text><View style={{flex:1}}/><Text style={{color:q.stale?quick.muted:quick.ink,fontSize:17,fontWeight:'600'}}>{pct(wk?.pct)}</Text></View>
       <View style={{flexDirection:'row',alignItems:'center',gap:6}}><Text numberOfLines={1} style={{width:62,color:quick.muted,fontSize:10.5}}>{q.account_label.includes(' · ')?q.account_label.split(' · ').pop():q.account_label.split('@')[0]}</Text>
        <Spark points={q.usage_points||[]} start={start} end={end} color={color} faded={q.stale}/>
        <Text numberOfLines={1} style={{width:58,textAlign:'right',color:q.stale?quick.amber:color,fontSize:10.5,fontWeight:'500'}}>{q.stale?t('Last report','마지막 보고'):(()=>{const p=q.weekly?.[period];return valid(p?.used_pp)&&valid(p?.observed_seconds)&&p.observed_seconds>=120?pct(p.used_pp/p.observed_seconds*3600)+t('/h','/시간'):mins>0?(mins>=1440?t(`in ${Math.floor(mins/1440)}d`,`${Math.floor(mins/1440)}일 후`):t(`in ${Math.floor(mins/60)}h`,`${Math.floor(mins/60)}시간 후`)):t('Collecting','수집 중');})()}</Text></View></View>;})}</View>
     :<Text style={{color:quick.muted,fontSize:11.5}}>{t('Connect subscription accounts in 1top on your computer.','컴퓨터의 1top에서 구독 계정을 연결하면 표시됩니다.')}</Text>}
   </View>
   <View style={{flexDirection:'row',gap:18,paddingHorizontal:16,paddingTop:12,paddingBottom:10}}>
    {[['CPU',host?.cpu??null],[t('Memory','메모리'),memory]].map(([name,v])=><View key={name as string} style={{flex:1,flexDirection:'row',alignItems:'center',gap:7}}><Text style={{color:quick.muted,fontSize:11.5}}>{name}</Text><View style={st.track}><View style={{width:`${Math.min(100,Math.max(0,(v as number)||0))}%`,height:3,borderRadius:2,backgroundColor:((v as number)||0)>90?quick.amber:quick.accent}}/></View><Text style={{color:quick.ink,fontSize:11.5,width:44,textAlign:'right'}}>{pct(v as number|null)}</Text></View>)}
   </View>
   <View style={st.listHead}><Text style={st.title}>{t('Sessions','세션')}</Text><Text style={st.count}>{ordered.length}</Text><View style={[st.dot,{backgroundColor:live?quick.accent:quick.amber,marginLeft:4}]}/><Text style={{color:live?quick.accent:quick.amber,fontSize:11.5,fontWeight:'500'}}>{live?t(`${ordered.filter(gWorking).length} working`,`작업 중 ${ordered.filter(gWorking).length}`):t('Last report','마지막 기록')}</Text><View style={{flex:1}}/><Text style={{color:quick.muted,fontSize:10.5,width:78,textAlign:'right'}}>{tokensMode?t('Tokens','토큰'):t('Weekly limit','주간 한도 사용량')}</Text></View>
   {ordered.map((g,i)=>{const s=g.root,pace=live?paces[i]:null,hub=gWorking(g)?quick.accent:s.status==='waiting'?quick.amber:quick.dim,tokens=gTokens(g,period),est=gEstimate(g,period);
    const value=tokensMode?short(tokens):est!==null?'≈'+pct(est):tokens===0?'0%':'—',children=g.members.length-1;
    return <View key={s.key} style={st.row}><View style={{width:54,alignItems:'center',gap:2}}><MiniGauge value={pace} scale={scale} color={toolColor(s.kind)} hub={hub}/><Text numberOfLines={1} style={{fontSize:9.5,color:pace===null?quick.dim:pace===0?quick.muted:quick.ink}}>{pace===null?'—':(tokensMode?short(pace):pct(pace))+t('/h','/시간')}</Text></View>
     <View style={{flex:1,minWidth:0}}><View style={{flexDirection:'row',alignItems:'center',gap:6}}><Text numberOfLines={1} style={{flexShrink:1,color:quick.ink,fontSize:13,fontWeight:'600'}}>{nameOf(s)}</Text>{children>0&&<Text style={st.badge}>{t(`+${children}`,`하위 ${children}`)}</Text>}</View><Text numberOfLines={1} style={{fontSize:11.5}}><Text style={{color:toolColor(s.kind)}}>{toolName(s.kind)}</Text><Text style={{color:quick.muted}}>{display(s)?' · '+display(s):''}</Text></Text></View>
     <Text style={{width:70,textAlign:'right',color:value==='—'?quick.dim:quick.ink,fontSize:13,fontWeight:'600'}}>{value}</Text></View>;})}
  </ScrollView>
 </SafeAreaView>;
}

const st=StyleSheet.create({
 header:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingTop:8,paddingBottom:10},
 pill:{flexDirection:'row',alignItems:'center',gap:6,height:24,paddingHorizontal:9,borderRadius:12,borderWidth:1,borderColor:quick.line,maxWidth:230},
 dot:{width:6,height:6,borderRadius:3},
 picker:{flexDirection:'row',gap:2,padding:3,marginHorizontal:14,marginBottom:10,borderRadius:9,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 pickerItem:{flex:1,height:28,alignItems:'center',justifyContent:'center',borderRadius:6},
 titleRow:{flexDirection:'row',alignItems:'baseline',gap:6,marginBottom:8},
 title:{color:quick.ink,fontSize:12.5,fontWeight:'600'},sub:{color:quick.muted,fontSize:11.5},
 tile:{width:'48.8%',gap:3,paddingHorizontal:10,paddingVertical:8,borderRadius:8},
 track:{flex:1,height:3,borderRadius:2,backgroundColor:quick.line,overflow:'hidden'},
 listHead:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:16,paddingVertical:8,borderTopWidth:1,borderTopColor:quick.line},
 count:{color:quick.muted,fontSize:11.5,fontWeight:'600',paddingHorizontal:6,borderRadius:5,backgroundColor:quick.raised,overflow:'hidden'},
 badge:{color:quick.muted,fontSize:10.5,paddingHorizontal:5,borderRadius:8,borderWidth:1,borderColor:quick.line},
 row:{flexDirection:'row',alignItems:'center',gap:9,height:50,paddingHorizontal:16,borderBottomWidth:1,borderBottomColor:quick.line+'b3'},
});
