import React,{useEffect,useRef,useState} from 'react';
import {Animated,Easing,StyleSheet,View} from 'react-native';
import Svg,{Defs,LinearGradient,Polygon,Rect,Stop,Text as SvgText} from 'react-native-svg';
import {Text} from './typography';
import {rangeText,valid} from './cluster-model';

// The cluster's seven-segment readouts, drawn as the desktop's (agent/onetop/dist/speed.js seg7): only the lit
// segments, blank leading cells dropped and a lone 1 centred in its cell, so a figure sits centred and evenly spaced.
export type Cells={c:string[];u:string;dp?:number|null};
const SEG:Record<string,string>={0:'abcdef',1:'bc',2:'abged',3:'abgcd',4:'fgbc',5:'afgcd',6:'afgedc',7:'abc',8:'abcdefg',9:'abcdfg','-':'g',' ':''};
const n2=(v:number)=>+v.toFixed(2);
function segments(w:number,h:number,t:number):Record<string,[number,number][]>{
 const g=.9,ht=t/2;
 const H=(cy:number,x0:number,x1:number):[number,number][]=>[[x0,cy],[x0+ht,cy-ht],[x1-ht,cy-ht],[x1,cy],[x1-ht,cy+ht],[x0+ht,cy+ht]];
 const V=(cx:number,y0:number,y1:number):[number,number][]=>[[cx,y0],[cx+ht,y0+ht],[cx+ht,y1-ht],[cx,y1],[cx-ht,y1-ht],[cx-ht,y0+ht]];
 return {a:H(ht,ht+g,w-ht-g),g:H(h/2,ht+g,w-ht-g),d:H(h-ht,ht+g,w-ht-g),f:V(ht,ht+g,h/2-g),b:V(w-ht,ht+g,h/2-g),e:V(ht,h/2+g,h-ht-g),c:V(w-ht,h/2+g,h-ht-g)};
}
/** The token speed in three cells with k, M or B beside them (108M), as the dashboard's instrument. */
export function tokenCells(v:number|null|undefined):Cells{
 if(!valid(v))return {c:['-','-','-'],u:''};
 if(v<.5)return {c:[' ',' ','0'],u:''};
 const unit=(n:number):[number,string]=>n>=1e9?[1e9,'B']:n>=1e6?[1e6,'M']:n>=1e3?[1e3,'k']:[1,''];
 let [d,u]=unit(v),x=Math.round(v/d);
 if(x>=1000&&u!=='B'){[d,u]=unit(x*d);x=Math.round(v/d);}
 return {c:[...String(Math.min(999,x)).padStart(3,' ')],u};
}
/** The burn in three cells with its decimal point (0.51, 12.4, 135); unknown keeps the shape, -.--. */
export function burnCells(v:number|null|undefined):Cells{
 if(!valid(v))return {c:['-','-','-'],u:'',dp:0};
 const s=v<9.995?v.toFixed(2):v<99.95?v.toFixed(1):String(Math.min(999,Math.round(v))),dot=s.indexOf('.');
 return {c:[...s.replace('.','')],u:'',dp:dot<0?null:dot-1};
}
export function Lcd({cells,height,color}:{cells:Cells;height:number;color:string}){
 const lead=cells.c.findIndex(ch=>ch!==' ');
 const g:Cells=lead>0?{...cells,c:cells.c.slice(lead),dp:Number.isInteger(cells.dp)?(cells.dp as number)-lead:cells.dp}:cells;
 const h=40,w=h*.55,gap=h*.15,t=h*.115,room=t*1.2,pitch=w+gap,us=h*.46,skew=Math.tan(9*Math.PI/180);
 const marks=Number.isInteger(g.dp)?[g.dp as number]:[];
 const n=g.c.length,at=(i:number)=>i*pitch+room*marks.filter(k=>k<i).length,tail=2;
 const W=Math.ceil((n-1)*pitch+w+(g.u?gap+us*.8:0)+marks.length*room+h*skew+2),S=segments(w,h,t);
 // The face leans 9° like a real display: a point at height y moves right by (h - y)·tan 9°.
 const lean=(x:number,y:number)=>`${n2(x+(h-y)*skew+1)},${n2(y)}`;
 const shapes:React.ReactNode[]=[];
 g.c.forEach((ch,i)=>{const lit=SEG[ch]??'',x=at(i)-(ch==='1'?w/2-t/2:0);
  for(const k of lit)shapes.push(<Polygon key={i+k} points={S[k].map(([px,py])=>lean(px+x,py)).join(' ')} fill={color}/>);});
 marks.forEach((k,j)=>{const d=t*1.05,x=at(k)+w+(gap+room-d)/2;
  shapes.push(<Rect key={'m'+j} x={x+(h-(h-d/2))*skew+1} y={h-d} width={d} height={d} rx={d*.22} fill={color}/>);});
 return <Svg width={height*W/(h+tail)} height={height} viewBox={`0 -1 ${W} ${h+tail}`}>{shapes}
  {!!g.u&&<SvgText x={at(n-1)+w+gap+1} y={h} fontSize={us} fontWeight="700" fontStyle="italic" fill={color}>{g.u}</SvgText>}</Svg>;
}

// The odometer rolls like a car's (cluster.js odometer, its drum face): each digit a wheel of printed digits in its own
// shaded window that only ever turns up (9 rolls on to 0), once every three seconds and slowly; the count never goes
// back while it stays mounted (the cluster remounts it when the period changes), and leading zeros stay hidden. The
// range rolls on the same wheels, either way. height is a window's: its digits are 0.8 of it, its width 0.624.
const ROLL=Easing.bezier(.22,.8,.3,1);
const glyph=(height:number,color:string)=>({fontSize:height*.8,lineHeight:height,fontWeight:'600' as const,color,fontVariant:['tabular-nums' as const],textAlign:'center' as const});
// A wheel's window (cluster.css .cl-wheels[data-face=drum] i): black at the edges, lighter through the middle, a faint
// inner edge.
function Window({height,plain,children}:{height:number;plain?:boolean;children:React.ReactNode}){
 const w=Math.round(height*.624*10)/10;
 return <View style={{width:w,height,borderRadius:3,overflow:'hidden'}}>
  {!plain&&<Svg style={StyleSheet.absoluteFill} width={w} height={height}>
   <Defs><LinearGradient id="win" x1="0" x2="0" y1="0" y2="1"><Stop offset={0} stopColor="#000"/><Stop offset={.22} stopColor="#1d2226"/><Stop offset={.5} stopColor="#2a3034"/><Stop offset={.78} stopColor="#1d2226"/><Stop offset={1} stopColor="#000"/></LinearGradient></Defs>
   <Rect x={0} y={0} width={w} height={height} rx={3} fill="url(#win)"/>
   <Rect x={.5} y={.5} width={w-1} height={height-1} rx={2.5} fill="none" stroke="#fff" strokeOpacity={.05} strokeWidth={1}/></Svg>}
  {children}</View>;
}
// A wheel's printed strip: 0–9 twice for the odometer, so a wheel passing 9 turns on into the second run and never
// shows an empty window; 0–9 and a dash for the range.
const Strip=React.memo(function Strip({marks,height,color}:{marks:string[];height:number;color:string}){
 return <>{marks.map((m,k)=><Text key={k} style={[glyph(height,color),{height}]}>{m}</Text>)}</>;
});
const TWICE=Array.from({length:20},(_,k)=>String(k%10)),DASHED=[...'0123456789-'];
function Wheel({digit,height,color,calm,plain}:{digit:number;height:number;color:string;calm:boolean;plain?:boolean}){
 const [pos]=useState(()=>new Animated.Value(digit)),was=useRef(digit),over=useRef(false);
 useEffect(()=>{const from=was.current;if(digit===from)return;was.current=digit;pos.stopAnimation();if(over.current){pos.setValue(from);over.current=false;}
  if(calm){pos.setValue(digit);return;}
  // Up only: past 9 the wheel turns on into the second run, then settles unseen on the same digit in the first.
  const to=digit<from?10+digit:digit;over.current=to>=10;
  Animated.timing(pos,{toValue:to,duration:1600,easing:ROLL,useNativeDriver:true}).start(({finished})=>{if(finished&&to>=10){pos.setValue(digit);over.current=false;}});},[digit,calm,pos]);
 return <Window height={height} plain={plain}><Animated.View style={{transform:[{translateY:Animated.multiply(pos,-height)}]}}><Strip marks={TWICE} height={height} color={color}/></Animated.View></Window>;
}
// The range's wheel turns straight to the new mark, down when the hours fall and up when they rise.
function Turn({index,height,calm}:{index:number;height:number;calm:boolean}){
 const [pos]=useState(()=>new Animated.Value(index)),was=useRef(index);
 useEffect(()=>{if(index===was.current)return;was.current=index;pos.stopAnimation();
  if(calm)pos.setValue(index);else Animated.timing(pos,{toValue:index,duration:1600,easing:ROLL,useNativeDriver:true}).start();},[index,calm,pos]);
 return <Window height={height}><Animated.View style={{transform:[{translateY:Animated.multiply(pos,-height)}]}}><Strip marks={DASHED} height={height} color="#eef2f4"/></Animated.View></Window>;
}
// The drum plate's padding (cluster.css .cl-wheels[data-face=drum] on .cl-led): 0.2em by 0.3em of the display's size.
export const drumPlate=(height:number)=>({paddingHorizontal:Math.round(height*.22),paddingVertical:Math.round(height*.15),borderRadius:Math.round(height*.33)});
// The odometer's faces (customizing, cluster.js odoFace): drum (the default) and print roll printed digits, the drum in
// shaded windows and print on the plate itself; led and led0 light seven segments in the display colour (cluster.css
// --led: white, red or amber), which change in place. led0 and print0 show all ten places, the leading zeros faint.
export type OdoFace='drum'|'led'|'led0'|'print'|'print0';
export function Odometer({value,height,color,calm,face='drum',led='#eef2f4'}:{value:number|null|undefined;height:number;color:string;calm:boolean;face?:string;led?:string}){
 const target=Math.max(0,Math.min(9999999999,Math.round(value||0))),latest=useRef(target),[shown,setShown]=useState(target);
 useEffect(()=>{latest.current=target;},[target]);
 useEffect(()=>{const id=setInterval(()=>setShown(s=>Math.max(s,latest.current)),3000);return()=>clearInterval(id);},[]);
 const zeros=face==='led0'||face==='print0',lead=zeros?10-String(shown).length:0,s=String(shown).padStart(lead+String(shown).length,'0'),n=s.length,lit=face.startsWith('led');
 const faint=(i:number)=>i<lead?{opacity:.32}:null;
 return <View accessible accessibilityRole="image" accessibilityLabel={shown.toLocaleString('ko-KR')+' tokens'} style={{flexDirection:'row',alignItems:'flex-end',gap:lit?1:2}}>
  {[...s].map((ch,i)=><React.Fragment key={n-i}>{i>0&&(n-i)%3===0&&<Text style={[glyph(height,lit?led:'#8a949b'),{marginHorizontal:-1},lit&&{fontWeight:'800'},faint(i-1)]}>,</Text>}
   {lit?<View style={faint(i)}><Lcd cells={{c:[ch],u:''}} height={height*.92} color={led}/></View>:<View style={faint(i)}><Wheel digit={Number(ch)} height={height} color={color} calm={calm} plain={face!=='drum'}/></View>}</React.Fragment>)}</View>;
}
/** The range on an LCD for every face but the drum (cluster.js rangeDigits): three cells and its point. */
export function rangeCells(hours:number|null|undefined):Cells{
 if(!valid(hours))return {c:['-','-','-'],u:''};const s=rangeText(hours),d=s.indexOf('.'),c=[...s.replace('.','')];
 while(c.length<3)c.unshift(' ');return {c,u:'',dp:d<0?null:d-1+(3-s.replace('.','').length)};
}
// The range: a wheel per digit with the point between them; when the shape changes (9.9 → 10) the wheels are set anew, unrolled.
export function RangeWheels({hours,height,calm}:{hours:number|null|undefined;height:number;calm:boolean}){
 const s=rangeText(hours),shape=s.replace(/[\d-]/g,'0');let k=0;
 return <View key={shape} accessible accessibilityRole="image" accessibilityLabel={s} style={{flexDirection:'row',alignItems:'flex-end',gap:2}}>
  {[...s].map((ch,i)=>ch==='.'?<Text key={'p'+i} style={[glyph(height,'#eef2f4'),{marginHorizontal:1}]}>.</Text>:<Turn key={k++} index={ch==='-'?10:Number(ch)} height={height} calm={calm}/>)}</View>;
}
