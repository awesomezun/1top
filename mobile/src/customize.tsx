import React,{createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,Animated,BackHandler,Easing,type GestureResponderEvent,type HostInstance,Pressable,ScrollView,type ScrollViewInstance,type StyleProp,StyleSheet,View,type ViewStyle,useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import {router,useIsFocused} from 'expo-router';
import {Text} from './typography';
import {Icon} from './icons';
import {useWorkspace} from './workspace';
import {onTheme,quick} from './theme';
import {read,type Group,type Layout,type LayoutState,type ObjectId} from './layout';
import {load,save} from './layout-store';
import * as M from './customize-model';
import {ReportSettings} from './report-view';
import {resetPrefs,shapeName,usePrefs} from './reports';

// Customizing on Android (customizing-spec_v1.2.2), the web's edit mode (agent/onetop/dist/customize.js) on the phone:
// the layout kept on this phone, shared by the dashboard and cluster tabs, and the edit mode over a screen's objects.
// The objects jiggle (the home screen's cycle, each out of step); − hides one; a long press and a drag moves it; the
// corner grip changes its size or count with the value near the finger; a tap opens its sheet (size, count, 모양 ▸ into
// the gallery drawn by the real screen, shown); 목록 lists every object at once. Every change is saved at once, never over
// a newer version's layout. Its words are the customizing glossary's (customize-model.ts Word, or t(english, korean)).

/** The words in the language shown: t(english, korean[, chinese]) and a glossary Word. */
export function useSay(){const t=useWorkspace().t as (en:string,ko:string,zh?:string)=>string;return {t,say:(w:M.Word)=>t(w[0],w[1],w[2])};}

export function useCalm(){
 const [calm,setCalm]=useState(false);
 useEffect(()=>{AccessibilityInfo.isReduceMotionEnabled().then(setCalm).catch(()=>{});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',setCalm);return()=>sub.remove();},[]);
 return calm;
}

type Screen='index'|'cluster';
/** QA only (the demo): onetop://?qaLayout=<json> stores a layout, qaCustomize=on|list|off|<id>|gallery:<id> opens the
 *  edit mode on the screen in view, and qaReport=1 logs where every object and mark is ('[qa-layout] ' in the log). */
type Qa={open:string;report:boolean;at:number;screen:Screen};
type Resume={screen:Screen;sheet:'list'};
type LayoutApi={state:LayoutState;change:(fn:(l:Layout)=>void)=>void;editing:boolean;setEditing:(screen:Screen,on:boolean)=>void;
 resume:Resume|null;setResume:(r:Resume|null)=>void;qa:Qa|null;doneQa:()=>void};
const LayoutContext=createContext<LayoutApi|null>(null);
export const useLayout=()=>useContext(LayoutContext) as LayoutApi;

export function LayoutProvider({children}:{children:React.ReactNode}){
 const w=useWorkspace(),[state,setState]=useState<LayoutState|null>(null),[editing,setEdited]=useState<Screen|null>(null),[resume,setResume]=useState<Resume|null>(null),[qa,setQa]=useState<Qa|null>(null);
 const now=useRef(state),queue=useRef<Promise<unknown>>(Promise.resolve());
 useEffect(()=>{load().then(s=>{now.current=s;setState(s);});},[]);
 // One write after another, so the last change is the one kept.
 const keep=useCallback((s:LayoutState)=>{now.current=s;setState(s);queue.current=queue.current.then(()=>save(s));},[]);
 const change=useCallback((fn:(l:Layout)=>void)=>{const cur=now.current;if(!cur)return;const layout:Layout=JSON.parse(JSON.stringify(cur.layout));fn(layout);keep({layout,locked:cur.locked});},[keep]);
 useEffect(()=>{if(!w.demo)return;
  const take=(url:string|null)=>{if(!url)return;const {queryParams,path,hostname}=Linking.parse(url),q=queryParams||{},one=(v:unknown)=>Array.isArray(v)?v[0]:v;
   const raw=one(q.qaLayout),open=one(q.qaCustomize);
   if(typeof raw==='string'){const s=read(raw);if(!s.locked&&!now.current?.locked)keep(s);}
   if(typeof open==='string'){const screen=(hostname||path)==='cluster'?'cluster':'index';setQa({open,report:one(q.qaReport)==='1',at:Date.now(),screen});setTimeout(()=>router.navigate(screen==='cluster'?'/cluster':'/'),300);}};
  Linking.getInitialURL().then(take).catch(()=>{});const sub=Linking.addEventListener('url',e=>take(e.url));return()=>sub.remove();},[w.demo,keep]);
 // Which screen is customizing: a screen leaving its edit mode never ends another's.
 const setEditing=useCallback((screen:Screen,on:boolean)=>setEdited(old=>on?screen:old===screen?null:old),[]);
 if(!state)return null;
 return <LayoutContext.Provider value={{state,change,editing:!!editing,setEditing,resume,setResume,qa,doneQa:()=>setQa(null)}}>{children}</LayoutContext.Provider>;
}
/** Which preset a tab shows: the cluster tab its own; the dashboard tab the dashboard, or with one tab the chosen one. */
export function shownPreset(layout:Layout,screen:Screen):M.Preset{return screen==='cluster'?'cluster':layout.tabs==='one'?layout.preset:'dashboard';}
/** The header's quick switch (one tab): the preset, kept in the layout. */
export function usePresetSwitch(){const L=useLayout();return (p:M.Preset)=>L.change(l=>{l.preset=p;});}

type Entry={ref:HostInstance|null;shown?:number|null;preview?:(shape:string)=>React.ReactNode};
type Drag={id:ObjectId;x:number;y:number};
type Grip={id:ObjectId;x:number;y:number};
type Sheet={kind:'obj'|'gallery'|'list';id?:ObjectId};
type EditApi={on:boolean;preset:M.Preset;group:Group;open:()=>void;sel:ObjectId|null;drag:Drag|null;grip:Grip|null;rects:Partial<Record<ObjectId,M.Box>>;
 parts:React.RefObject<Map<ObjectId,Entry>>;canvas:React.RefObject<HostInstance|null>;measure:()=>void;pick:(id:ObjectId)=>void;change:(fn:(g:Group)=>void)=>void;
 startDrag:(id:ObjectId,x:number,y:number)=>void;moveDrag:(x:number,y:number)=>void;drop:(y:number)=>void;cancelDrag:()=>void;setGrip:(g:Grip|null)=>void;
 phase:Animated.Value|null;view:{x0:number;x1:number;y0:number};win:React.RefObject<{x:number;y:number}>;scrollable:boolean;room:number;quiet:<A extends unknown[]>(fn:(...a:A)=>void)=>(...a:A)=>void;enter:()=>void;close:()=>void;still:(on:boolean)=>void};
const EditContext=createContext<EditApi|null>(null);
export const useEditor=()=>useContext(EditContext);
/** A host's press handler that waits while customizing (the long press that opened it lets go over the object). */
export function useQuiet(){const e=useContext(EditContext);return e?e.quiet:<A extends unknown[]>(fn:(...a:A)=>void)=>fn;}

/** The edit mode over one screen: the host draws its objects in Part, inside one Canvas, and scrolls with scrollRef. */
export function Editor({screen,preset,scrollRef,children}:{screen:Screen;preset:M.Preset;scrollRef:React.RefObject<ScrollViewInstance|null>;children:React.ReactNode}){
 const L=useLayout(),focused=useIsFocused(),calm=useCalm(),{width,height}=useWindowDimensions(),inset=useSafeAreaInsets(),{t,say}=useSay();
 const [on,setOn]=useState(false),[sel,setSel]=useState<ObjectId|null>(null),[sheet,setSheet]=useState<Sheet|null>(null),[drag,setDrag]=useState<Drag|null>(null),[grip,setGrip]=useState<Grip|null>(null);
 const [rects,setRects]=useState<Partial<Record<ObjectId,M.Box>>>({}),[canvasX,setCanvasX]=useState(0);
 const parts=useRef(new Map<ObjectId,Entry>()),canvas=useRef<HostInstance|null>(null),win=useRef({x:0,y:0}),live=useRef(false),frame=useRef(0),held=useRef<Drag|null>(null);
 // While an object is carried or a grip turned the page holds still at once, before the next drawing catches up.
 const still=useCallback((on:boolean)=>{scrollRef.current?.setNativeProps?.({scrollEnabled:!on});},[scrollRef]);
 const hold=useCallback((d:Drag|null)=>{held.current=d;setDrag(d);still(!!d);},[still]);
 const group=L.state.layout.presets[preset];
 const change=useCallback((fn:(g:Group)=>void)=>L.change(l=>fn(l.presets[preset])),[L,preset]);
 // Each shown object's box in the canvas, read at once where it moved (the new architecture measures synchronously,
 // so a change shows its marks in the same frame), and once more on the next frame for anything that moved with it.
 const measureNow=useCallback(()=>{const c=canvas.current;if(!c||!live.current)return;
  c.measureInWindow((x,y)=>{win.current={x,y};setCanvasX(x);});
  const list=[...parts.current.entries()],out:Partial<Record<ObjectId,M.Box>>={};let left=list.length;if(!left){setRects({});return;}
  for(const [id,p] of list){const done=()=>{if(--left===0)setRects(old=>JSON.stringify(old)===JSON.stringify(out)?old:out);};
   if(!p.ref){done();continue;}p.ref.measureLayout(c,(x,y,w,h)=>{if(w>0&&h>0)out[id]={x,y,w,h};done();},done);}},[]);
 const measure=useCallback(()=>{measureNow();cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(measureNow);},[measureNow]);
 useEffect(()=>{if(on)measure();},[on,measure,L.state,width]);
 const [phase]=useState(()=>new Animated.Value(0));
 useEffect(()=>{if(!on||calm){phase.stopAnimation();phase.setValue(0);return;}
  const loop=Animated.loop(Animated.timing(phase,{toValue:1,duration:260,easing:Easing.linear,useNativeDriver:true}));loop.start();return()=>loop.stop();},[on,calm,phase]);
 const enter=useCallback(()=>{live.current=true;setOn(true);setSel(null);setSheet(null);L.setEditing(screen,true);measureNow();},[L,screen,measureNow]);
 const close=useCallback(()=>{live.current=false;setOn(false);setSel(null);setSheet(null);held.current=null;setDrag(null);setGrip(null);still(false);L.setEditing(screen,false);},[L,screen,still]);
 // Away from the screen the edit mode ends; the tab bar comes back.
 const setEditing=L.setEditing;
 useEffect(()=>()=>{if(live.current)setEditing(screen,false);},[setEditing,screen]);
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(!focused&&on)close();},[focused,on,close]);
 // Back closes the gallery into its object's sheet, a sheet, then the edit mode.
 useEffect(()=>{if(!on||!focused)return;const sub=BackHandler.addEventListener('hardwareBackPress',()=>{
  if(sheet?.kind==='gallery'){setSheet(sel?{kind:'obj',id:sel}:null);return true;}if(sheet){setSheet(null);setSel(null);return true;}close();return true;});return()=>sub.remove();},[on,focused,sheet,sel,close]);
 // A tab change from the list carries the edit mode to the screen that now shows the preset.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{if(focused&&L.resume?.screen===screen){L.setResume(null);enter();setSheet({kind:'list'});}},[focused,L,screen,enter]);
 // A picked object comes to the middle of what its sheet leaves of the screen.
 const reveal=useCallback((id:ObjectId)=>{const r=rects[id],sv=scrollRef.current,inner=sv?.getInnerViewRef?.(),c=canvas.current;if(!r||!sv||!inner||!c)return;
  const band=(inset.top+52+height-Math.min(360,height*.46))/2;
  c.measureLayout(inner,(_x,y)=>sv.scrollTo({y:Math.max(0,inset.top+y+r.y+r.h/2-band),animated:!calm}),()=>{});},[rects,scrollRef,height,inset.top,calm]);
 const pick=useCallback((id:ObjectId)=>{const next=sel===id?null:id;setSel(next);setSheet(next?{kind:'obj',id:next}:null);if(next)reveal(next);},[sel,reveal]);
 const startDrag=useCallback((id:ObjectId,x:number,y:number)=>{setSel(null);setSheet(null);canvas.current?.measureInWindow((cx,cy)=>{win.current={x:cx,y:cy};hold({id,x:x-cx,y:y-cy});});},[hold]);
 const moveDrag=useCallback((x:number,y:number)=>{const d=held.current;if(d)hold({...d,x:x-win.current.x,y:y-win.current.y});},[hold]);
 const order=useMemo(()=>(Object.entries(rects) as [ObjectId,M.Box][]).sort((a,b)=>a[1].y-b[1].y).map(([id,box])=>({id,box})),[rects]);
 const movable=order.filter(o=>M.caps(preset,o.id).move);
 const drop=useCallback((y:number)=>{const d=held.current;hold(null);if(!d)return;const t=M.target(movable,d.id,y-win.current.y);change(g=>M.moveTo(g,d.id,t.before,movable.map(m=>m.id)));},[movable,change,hold]);
 const quiet=useCallback(<A extends unknown[]>(fn:(...a:A)=>void)=>(...a:A)=>{if(!live.current)fn(...a);},[]);
 const view={x0:-canvasX,x1:width-canvasX,y0:0};
 // QA: open, report.
 const report=()=>{const c=canvas.current;if(!c)return;c.measureInWindow((cx,cy,cw,ch)=>{const list=[...parts.current.entries()],out:Record<string,M.Box>={};let left=list.length;
  const done=()=>{if(--left>0)return;const v={x0:-cx,x1:width-cx,y0:0},marks=Object.fromEntries(Object.entries(out).map(([id,b])=>{const m=M.marks({...b,x:b.x-cx,y:b.y-cy},v),sh=(r:M.Box)=>({x:r.x+cx,y:r.y+cy,w:r.w,h:r.h});
   return [id,{ring:sh(m.ring),minus:M.caps(preset,id as ObjectId).hide?sh(m.minus):null,grip:M.caps(preset,id as ObjectId).size||M.caps(preset,id as ObjectId).count?sh(m.grip):null}];}));
   console.log('[qa-layout] '+JSON.stringify({screen,preset,width,height,canvas:{x:cx,y:cy,w:cw,h:ch},parts:out,marks,group,tabs:L.state.layout.tabs,chosen:L.state.layout.preset,locked:L.state.locked,jiggle:!calm}));};
  for(const [id,p] of list){if(!p.ref){done();continue;}p.ref.measureInWindow((x,y,w,h)=>{if(w>0&&h>0)out[id]={x,y,w,h};done();});}});};
 const qa=L.qa;
 useEffect(()=>{if(!qa||!focused||qa.screen!==screen)return;L.doneQa();const [kind,id]=qa.open.split(':') as [string,ObjectId|undefined];
  // eslint-disable-next-line react-hooks/set-state-in-effect
  if(kind==='off'){close();return;}enter();
  if(kind==='list')setSheet({kind:'list'});else if(kind==='gallery'&&id){setSel(id);setSheet({kind:'gallery',id});}else if(kind!=='on'){setSel(kind as ObjectId);setSheet({kind:'obj',id:kind as ObjectId});}
  if(qa.report)setTimeout(()=>report(),1400);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[qa,focused]);
 const api:EditApi={on,preset,group,open:enter,sel,drag,grip,rects,parts,canvas,measure,pick,change,startDrag,moveDrag,drop,cancelDrag:()=>hold(null),setGrip,
  phase:on&&!calm?phase:null,view,win,scrollable:!drag&&!grip,quiet,enter,close,still,
  // Room under the objects for a sheet, so the last one can come up above it.
  room:on&&sheet?Math.min(620,height*.7):0};
 const hidden=group.hidden.filter(id=>M.KNOWN[preset].includes(id)).length,presets=screen==='index'&&L.state.layout.tabs==='one';
 return <EditContext.Provider value={api}>
  {children}
  {on&&<View style={[st.top,{paddingTop:inset.top,height:inset.top+52}]}>
   <Pill label={t('List','목록')} onPress={()=>{setSel(null);setSheet({kind:'list'});}} style={{position:'absolute',left:12,bottom:9}}/>
   {presets?<View accessibilityRole="radiogroup" accessibilityLabel={t('Preset','프리셋')} style={st.seg}>{(['dashboard','cluster'] as M.Preset[]).map(p=><Pressable key={p} accessibilityRole="radio" accessibilityState={{checked:preset===p}}
     onPress={()=>{setSel(null);setSheet(null);L.change(l=>{l.preset=p;});}} style={[st.segItem,preset===p&&{backgroundColor:quick.raised}]}><Text style={[st.segText,preset===p&&{color:quick.ink}]}>{say(M.TITLES[p])}</Text></Pressable>)}</View>
    :<Text numberOfLines={1} style={st.topTitle}>{say(M.PHRASES.customize(M.TITLES[preset]))}</Text>}
   <Pill label={t('Done','완료','完成')} strong onPress={close} style={{position:'absolute',right:12,bottom:9}}/>
  </View>}
  {on&&!sheet&&hidden>0&&<Pressable accessibilityRole="button" onPress={()=>setSheet({kind:'list'})} style={[st.chip,{bottom:inset.bottom+24}]}><Text style={st.chipText}>{say(M.PHRASES.hidden(hidden))}</Text></Pressable>}
  {on&&sheet&&<SheetFrame key={sheet.kind+(sheet.id||'')} kind={sheet.kind} calm={calm}>
   {sheet.kind==='obj'&&sheet.id&&<ObjectSheet id={sheet.id} api={api} close={()=>{setSel(null);setSheet(null);}} gallery={()=>setSheet({kind:'gallery',id:sheet.id})} list={()=>{setSel(null);setSheet({kind:'list'});}}/>}
   {sheet.kind==='gallery'&&sheet.id&&<Gallery id={sheet.id} api={api} close={()=>setSheet(sel?{kind:'obj',id:sel}:null)}/>}
   {sheet.kind==='list'&&<List api={api} screen={screen} close={()=>setSheet(null)} gallery={id=>setSheet({kind:'gallery',id})}/>}
  </SheetFrame>}
 </EditContext.Provider>;
}

/** The objects' common box: in the edit mode it jiggles, takes the touches meant for it, and fades while another is picked. */
export function Part({id,style,children,shown,preview}:{id:ObjectId;style?:StyleProp<ViewStyle>;children:React.ReactNode;shown?:number|null;preview?:(shape:string)=>React.ReactNode}){
 const e=useContext(EditContext),{say}=useSay(),ref=useRef<HostInstance|null>(null),touch=useRef<{x:number;y:number;moved:boolean;live:boolean;timer?:ReturnType<typeof setTimeout>}|null>(null);
 useEffect(()=>{if(!e)return;const map=e.parts.current;map.set(id,{ref:ref.current,shown,preview});});
 useEffect(()=>{const map=e?.parts.current;return()=>{map?.delete(id);};},[e?.parts,id]);
 // Each object out of step: a share of the cycle by its place (customize.js: (i·7 mod 10)/40 s of 0.26 s).
 const i=Math.max(0,M.KNOWN.cluster.concat(M.KNOWN.dashboard).indexOf(id)),phase=e?.phase;
 const jiggle=useMemo(()=>{if(!phase)return null;const t=Animated.modulo(Animated.add(phase,((i*7)%10)/40/.26),1),K=[0,.25,.5,.75,1];
  return [{rotate:t.interpolate({inputRange:K,outputRange:['-0.3deg','0deg','0.3deg','0deg','-0.3deg']})},{translateY:t.interpolate({inputRange:K,outputRange:[.3,-.2,.3,-.2,.3]})}];},[phase,i]);
 if(!e)return <View style={style}>{children}</View>;
 const c=M.caps(e.preset,id),lifted=e.drag?.id===id,dim=!!e.sel&&e.sel!==id;
 const end=()=>{const t=touch.current;if(t?.timer)clearTimeout(t.timer);touch.current=null;return t;};
 // Outside the edit mode a long press on the object opens it, without taking the touch from what is inside.
 const outside=e.on?{}:{onTouchStart:(ev:GestureResponderEvent)=>{end();const {pageX:x,pageY:y}=ev.nativeEvent;touch.current={x,y,moved:false,live:false,timer:setTimeout(()=>{touch.current=null;e.enter();},500)};},
  onTouchMove:(ev:GestureResponderEvent)=>{const t=touch.current;if(t&&Math.hypot(ev.nativeEvent.pageX-t.x,ev.nativeEvent.pageY-t.y)>10)end();},onTouchEnd:end,onTouchCancel:end};
 // In it: a tap picks; held still for a moment, a drag moves (and the page stops scrolling); a swipe still scrolls.
 const inside=e.on?{onStartShouldSetResponder:()=>true,
  onResponderGrant:(ev:GestureResponderEvent)=>{end();const {pageX:x,pageY:y}=ev.nativeEvent;const t={x,y,moved:false,live:false,timer:undefined as ReturnType<typeof setTimeout>|undefined};touch.current=t;
   if(c.move)t.timer=setTimeout(()=>{t.live=true;e.startDrag(id,x,y);},380);return false;},
  onResponderMove:(ev:GestureResponderEvent)=>{const t=touch.current;if(!t)return;const {pageX:x,pageY:y}=ev.nativeEvent;if(!t.moved&&Math.hypot(x-t.x,y-t.y)>6){t.moved=true;if(!t.live&&t.timer)clearTimeout(t.timer);}if(t.live)e.moveDrag(x,y);},
  onResponderRelease:(ev:GestureResponderEvent)=>{const t=end();if(!t)return;if(t.live)e.drop(ev.nativeEvent.pageY);else if(!t.moved)e.pick(id);},
  onResponderTerminationRequest:()=>!touch.current?.live,onResponderTerminate:()=>{const t=end();if(t?.live)e.cancelDrag();}}:{};
 return <Animated.View ref={ref} collapsable={false} onLayout={e.on?e.measure:undefined} pointerEvents={e.on?'box-only':'auto'} {...outside} {...inside}
  accessible={e.on} accessibilityRole={e.on?'button':undefined} accessibilityLabel={e.on?say(M.NAMES[id]):undefined} accessibilityState={e.on?{selected:e.sel===id}:undefined}
  style={[style,jiggle&&!lifted?{transform:jiggle}:null,lifted?{opacity:.35}:dim?{opacity:.32}:null]}>{children}</Animated.View>;
}

/** The objects' common ground: the marks over them ride in it, so they scroll with the objects. */
export function Canvas({style,children}:{style?:StyleProp<ViewStyle>;children:React.ReactNode}){
 const e=useContext(EditContext);
 return <View ref={e?.canvas} collapsable={false} style={style} onLayout={e?.on?e.measure:undefined}>{children}{e?.on&&<Marks e={e}/>}</View>;
}

/** The gear into customizing, hidden (keeping its place) while customizing. */
export function Gear({style}:{style?:StyleProp<ViewStyle>}){
 const e=useContext(EditContext),{t}=useSay();
 return <Pressable accessibilityRole="button" accessibilityLabel={t('Customize','커스터마이징')} disabled={!e||e.on} hitSlop={10} onPress={()=>e?.open()} style={[st.gear,(!e||e.on)&&{opacity:0},style]}>
  <Icon name="workspace" size={17} color={quick.muted}/></Pressable>;
}

function Marks({e}:{e:EditApi}){
 const {say}=useSay();
 const [tip,setTip]=useState({w:60,h:30}),[ghost,setGhost]=useState({w:90,h:36});
 const entries=(Object.entries(e.rects) as [ObjectId,M.Box][]).filter(([id])=>e.parts.current.has(id));
 const drop=e.drag?M.target(entries.filter(([id])=>M.caps(e.preset,id).move).sort((a,b)=>a[1].y-b[1].y).map(([id,box])=>({id,box})),e.drag.id,e.drag.y):null;
 const value=(id:ObjectId)=>{const c=M.caps(e.preset,id);return say(c.count?M.countWord(id,e.group.opts[id]?.count):M.SIZES[M.sizeOf(e.group,id)]);};
 return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
  {entries.map(([id,box])=>{const c=M.caps(e.preset,id),m=M.marks(box,e.view),on=e.sel===id;
   return <React.Fragment key={id}>
    {on&&<View pointerEvents="none" style={[st.halo,{left:m.ring.x-4,top:m.ring.y-4,width:m.ring.w+8,height:m.ring.h+8}]}/>}
    <View pointerEvents="none" style={[on?st.ringOn:st.ring,{left:m.ring.x,top:m.ring.y,width:m.ring.w,height:m.ring.h}]}/>
    {c.hide&&<Pressable accessibilityRole="button" accessibilityLabel={say(M.PHRASES.hide(M.NAMES[id]))} hitSlop={8} onPress={()=>e.change(g=>M.hide(g,id))} style={[st.minus,{left:m.minus.x,top:m.minus.y}]}><Text style={st.minusText}>−</Text></Pressable>}
    {(c.size||c.count)&&<GripMark id={id} e={e} at={m.grip}/>}
   </React.Fragment>;})}
  {e.drag&&drop?.box&&<View pointerEvents="none" style={[st.drop,{left:drop.box.x,top:drop.before?drop.box.y-6:drop.box.y+drop.box.h+4,width:drop.box.w}]}/>}
  {e.drag&&<View pointerEvents="none" onLayout={ev=>{const {width:w,height:h}=ev.nativeEvent.layout;if(w!==ghost.w||h!==ghost.h)setGhost({w,h});}} style={[st.ghost,{left:e.drag.x-ghost.w/2,top:e.drag.y-ghost.h/2}]}><Text style={st.ghostText}>{say(M.NAMES[e.drag.id])}</Text></View>}
  {e.grip&&(()=>{const p=M.tipAt(e.grip.x,e.grip.y,tip.w,tip.h,e.view);return <View pointerEvents="none" onLayout={ev=>{const {width:w,height:h}=ev.nativeEvent.layout;if(w!==tip.w||h!==tip.h)setTip({w,h});}} style={[st.tip,{left:p.x,top:p.y}]}><Text style={st.tipText}>{value(e.grip.id)}</Text></View>;})()}
 </View>;
}
/** The grip: every 44 of travel is one step (sideways for a count, along the diagonal for a size). */
function GripMark({id,e,at}:{id:ObjectId;e:EditApi;at:M.Box}){
 const start=useRef<{x:number;y:number;size:number;at:number}|null>(null),c=M.caps(e.preset,id),self=useRef(e);
 useEffect(()=>{self.current=e;});
 const point=(ev:GestureResponderEvent)=>({x:ev.nativeEvent.pageX-self.current.win.current.x,y:ev.nativeEvent.pageY-self.current.win.current.y});
 return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{position:'absolute',left:at.x-10,top:at.y-10,width:44,height:44}}
  onStartShouldSetResponder={()=>true} onResponderTerminationRequest={()=>false}
  onResponderGrant={ev=>{const g=self.current.group,steps=c.count?M.countSteps(id):null;start.current={x:ev.nativeEvent.pageX,y:ev.nativeEvent.pageY,size:M.sizeOf(g,id),at:steps?M.startAt(steps,g.opts[id]?.count,self.current.parts.current.get(id)?.shown):0};
   self.current.still(true);self.current.canvas.current?.measureInWindow((x,y)=>{self.current.win.current={x,y};self.current.setGrip({id,...point(ev)});});return true;}}
  onResponderMove={ev=>{const s=start.current,E=self.current;if(!s)return;const dx=ev.nativeEvent.pageX-s.x,dy=ev.nativeEvent.pageY-s.y;
   if(c.count){const v=M.countAt(id,s.at,Math.round(dx/44));if(v!==(E.group.opts[id]?.count??null))E.change(g=>{(g.opts[id]||(g.opts[id]={})).count=v;});}
   else{const v=Math.max(0,Math.min(2,s.size+Math.round((dx+dy)/2/44)));if(v!==M.sizeOf(E.group,id))E.change(g=>M.setSize(g,id,v));}
   E.setGrip({id,...point(ev)});}}
  onResponderRelease={()=>{start.current=null;self.current.setGrip(null);self.current.still(false);}} onResponderTerminate={()=>{start.current=null;self.current.setGrip(null);self.current.still(false);}}>
  <View pointerEvents="none" style={[st.grip,{left:10,top:10}]}/></View>;
}

function Pill({label,onPress,strong,style}:{label:string;onPress:()=>void;strong?:boolean;style?:StyleProp<ViewStyle>}){
 return <Pressable accessibilityRole="button" onPress={onPress} style={[st.pill,strong&&{backgroundColor:quick.mint,borderColor:quick.mint},style]}><Text style={[st.pillText,strong&&{color:'#06261a'}]}>{label}</Text></Pressable>;
}
function SheetFrame({kind,calm,children}:{kind:Sheet['kind'];calm:boolean;children:React.ReactNode}){
 const {height}=useWindowDimensions(),inset=useSafeAreaInsets(),[y]=useState(()=>new Animated.Value(calm?0:1));
 useEffect(()=>{if(calm)return;Animated.timing(y,{toValue:0,duration:320,easing:Easing.bezier(.2,.8,.2,1),useNativeDriver:true}).start();},[y,calm]);
 const max=kind==='obj'?Math.min(360,height*.46):Math.min(620,height*.7);
 return <Animated.View style={[st.sheet,{maxHeight:max+inset.bottom,paddingBottom:inset.bottom+18,transform:[{translateY:y.interpolate({inputRange:[0,1],outputRange:[0,max+60]})}]}]}>{children}</Animated.View>;
}
function SheetHead({title,close}:{title:string;close:()=>void}){const {t}=useSay();return <View style={st.sheetHead}><Text numberOfLines={1} style={[st.sheetTitle,{flexShrink:1}]}>{title}</Text><Pill label={t('Close','닫기')} onPress={close}/></View>;}
function Switch({on,disabled,onPress,label}:{on:boolean;disabled?:boolean;onPress:()=>void;label:string}){
 return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{checked:on,disabled}} disabled={disabled} hitSlop={8} onPress={onPress} style={[st.sw,on&&{backgroundColor:quick.mint},disabled&&{opacity:.4}]}>
  <View style={[st.knob,on&&{transform:[{translateX:18}]}]}/></Pressable>;
}
function Mini({children}:{children:React.ReactNode}){return <View style={st.mini}>{children}</View>;}
function MiniButton({label,on,onPress,a11y}:{label:string;on?:boolean;onPress:()=>void;a11y?:string}){
 return <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={on===undefined?undefined:{selected:on}} onPress={onPress} hitSlop={4} style={[st.miniButton,on&&{backgroundColor:quick.raised}]}><Text style={[st.miniText,on&&{color:quick.ink}]}>{label}</Text></Pressable>;
}
function SizeControl({value,set}:{value:number;set:(v:number)=>void}){const {say}=useSay();return <Mini>{M.SIZES.map((l,i)=><MiniButton key={l[0]} label={say(l)} on={value===i} onPress={()=>set(i)}/>)}</Mini>;}
function CountControl({id,value,step}:{id:ObjectId;value:number|null|undefined;step:(d:number)=>void}){const {t,say}=useSay();
 return <Mini><MiniButton label="−" a11y={t('Fewer','줄이기')} onPress={()=>step(-1)}/><Text style={st.miniValue}>{say(M.countWord(id,value))}</Text><MiniButton label="＋" a11y={t('More','늘리기','增加')} onPress={()=>step(1)}/></Mini>;}
function ShapeButton({id,value,onPress}:{id:ObjectId;value?:string;onPress:()=>void}){const {say}=useSay();return <Pressable accessibilityRole="button" onPress={onPress} style={st.shape}><Text style={st.shapeText}>{say(M.shapeName(id,value))} ▸</Text></Pressable>;}

/** A picked object's own sheet, in the settings-sheet style: its size, its count, its shape (into the gallery) and whether it shows. */
function ObjectSheet({id,api,close,gallery,list}:{id:ObjectId;api:EditApi;close:()=>void;gallery:()=>void;list:()=>void}){
 const c=M.caps(api.preset,id),o=api.group.opts[id]||{},shown=api.parts.current.get(id)?.shown,{t,say}=useSay();
 const rows=[c.size&&<Row key="size" label={t('Size','크기')}><SizeControl value={M.sizeOf(api.group,id)} set={v=>api.change(g=>M.setSize(g,id,v))}/></Row>,
  c.count&&<Row key="count" label={t('Count','개수')}><CountControl id={id} value={o.count} step={d=>api.change(g=>M.stepCount(g,id,d,shown))}/></Row>,
  c.shape&&<Row key="shape" label={t('Shape','모양')}><ShapeButton id={id} value={o.shape} onPress={gallery}/></Row>,
  c.hide&&<Row key="shown" label={t('Show','보이기')}><Switch on={!api.group.hidden.includes(id)} label={t('Show','보이기')} onPress={()=>{close();api.change(g=>M.hide(g,id));}}/></Row>].filter(Boolean);
 return <><SheetHead title={say(M.NAMES[id])} close={close}/>
  <ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:8}}>{rows.length?rows:<Text style={st.none}>{c.move?t('You can only drag it to another place.','끌어서 자리만 옮길 수 있습니다.'):t('Its place is fixed.','자리가 정해져 있습니다.')}</Text>}</ScrollView>
  <Pill label={t('Full list','전체 목록')} onPress={list} style={{alignSelf:'center'}}/></>;
}
function Row({label,children}:{label:string;children:React.ReactNode}){return <View style={st.orow}><Text style={st.rowLabel}>{label}</Text>{children}</View>;}

/** Shapes: each drawn by the real screen, the chosen one marked; a tap takes it at once. Closing goes back to the object's sheet. */
function Gallery({id,api,close}:{id:ObjectId;api:EditApi;close:()=>void}){
 const {say}=useSay();
 const preview=api.parts.current.get(id)?.preview,scroll=useRef<ScrollViewInstance>(null),{width}=useWindowDimensions(),placed=useRef(false);
 const cur=api.group.opts[id]?.shape,chosen=id==='periods'&&(!cur||cur==='auto')?'drum':cur??(M.SHAPES[id]||[])[0]?.[0];
 const list=(M.SHAPES[id]||[]).filter(([v])=>id!=='periods'||v!=='auto');
 return <><SheetHead title={say(M.PHRASES.shape(M.NAMES[id]))} close={close}/>
  <ScrollView ref={scroll} style={{flexShrink:1}} contentContainerStyle={{gap:10,padding:2}}>{list.map(([v,l])=>{const on=chosen===v;
   return <Pressable key={v} accessibilityRole="button" accessibilityState={{selected:on}} accessibilityLabel={say(l)} onPress={()=>api.change(g=>M.setShape(g,id,v))}
    onLayout={on?ev=>{if(placed.current)return;placed.current=true;scroll.current?.scrollTo({y:Math.max(0,ev.nativeEvent.layout.y-80),animated:false});}:undefined} style={[st.card,on&&{borderColor:quick.mint}]}>
    <View pointerEvents="none" style={{alignItems:'center',width:width-28-24,overflow:'hidden'}}>{preview?.(v)}</View>
    <Text style={[st.cardText,on&&{color:quick.ink}]}>{say(l)}</Text></Pressable>;})}</ScrollView></>;
}

/** Every object at once: its order, size or count, shape and whether it shows; the phone's tabs at the top and the reset below. */
function List({api,screen,close,gallery}:{api:EditApi;screen:Screen;close:()=>void;gallery:(id:ObjectId)=>void}){
 const {t,say}=useSay(),reportLook=usePrefs(),[reports,setReports]=useState(false);
 const L=useLayout(),g=api.group,known=M.KNOWN[api.preset],ids=g.order.filter(id=>known.includes(id)),movable=ids.filter(id=>M.caps(api.preset,id).move);
 const tabs=L.state.layout.tabs;
 // '하나로' takes the cluster tab into the dashboard's (choosing the preset in view); '따로' gives it back.
 const setTabs=(v:'one'|'two')=>{if(v===tabs)return;
  if(v==='one'){L.change(l=>{l.tabs='one';l.preset=screen==='cluster'?'cluster':'dashboard';});if(screen==='cluster'){L.setResume({screen:'index',sheet:'list'});router.navigate('/');}}
  else{const moving=screen==='index'&&L.state.layout.preset==='cluster';L.change(l=>{l.tabs='two';});if(moving){L.setResume({screen:'cluster',sheet:'list'});router.navigate('/cluster');}}};
 return <><SheetHead title={say(M.PHRASES.list(M.TITLES[api.preset]))} close={close}/>
  <ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:6}}>
   <View style={[st.orow,{minHeight:52}]}><Text style={[st.rowLabel,{flexShrink:1}]}>{t('Dashboard and Cluster tabs','대시보드·계기판 탭')}</Text><Mini><MiniButton label={t('Separate','따로')} on={tabs!=='one'} onPress={()=>setTabs('two')}/><MiniButton label={t('Combined','하나로')} on={tabs==='one'} onPress={()=>setTabs('one')}/></Mini></View>
   {ids.map(id=>{const c=M.caps(api.preset,id),o=g.opts[id]||{},off=g.hidden.includes(id),value=c.size?<SizeControl value={M.sizeOf(g,id)} set={v=>api.change(x=>M.setSize(x,id,v))}/>
     :c.count?<CountControl id={id} value={o.count} step={d=>api.change(x=>M.stepCount(x,id,d,api.parts.current.get(id)?.shown))}/>:null;
    return <View key={id} style={st.lrow}>
     <View style={st.lhead}><Text style={st.handle}>≡</Text><Text numberOfLines={1} style={[st.rowLabel,{flex:1}]}>{say(M.NAMES[id])}</Text>
      <Switch on={!off} label={t('Show','보이기')} disabled={!c.hide&&!off} onPress={()=>api.change(x=>M.toggle(x,id))}/>
      <View style={st.ud}>{c.move?<><MiniButton label="↑" a11y={t('Move up','위로')} onPress={()=>api.change(x=>M.shift(x,id,-1,movable))}/><MiniButton label="↓" a11y={t('Move down','아래로')} onPress={()=>api.change(x=>M.shift(x,id,1,movable))}/></>:null}</View></View>
     {(value||c.shape)&&<View style={st.lline}>{value}{c.shape&&<ShapeButton id={id} value={o.shape} onPress={()=>gallery(id)}/>}</View>}
    </View>;})}
   {/* The reports' look lives apart from the layout (reports.ts) and opens its own sheet. */}
   <View style={[st.orow,{minHeight:52}]}><Text style={[st.rowLabel,{flexShrink:1}]}>{t('Value · weekly report','본전·주간 리포트')}</Text><MiniButton label={shapeName(reportLook.shape,t)+' ▸'} onPress={()=>setReports(true)}/></View>
  </ScrollView>
  <Pill label={t('Reset to defaults','기본값으로 되돌리기')} onPress={()=>{L.change(l=>M.reset(l,api.preset));resetPrefs();}} style={{alignSelf:'center'}}/>
  <ReportSettings visible={reports} close={()=>setReports(false)}/></>;
}

const make=()=>StyleSheet.create({
 top:{position:'absolute',left:0,right:0,top:0,zIndex:40,alignItems:'center',justifyContent:'flex-end',paddingBottom:9,backgroundColor:quick.background+'eb',borderBottomWidth:1,borderBottomColor:quick.line},
 topTitle:{fontSize:15,fontWeight:'700',color:quick.ink,height:32,lineHeight:32},
 seg:{flexDirection:'row',gap:2,padding:3,borderRadius:11,borderWidth:1,borderColor:quick.line,backgroundColor:quick.card},
 segItem:{height:28,paddingHorizontal:14,borderRadius:8,justifyContent:'center'},segText:{fontSize:13.5,fontWeight:'600',color:quick.muted},
 pill:{height:32,paddingHorizontal:14,borderRadius:16,borderWidth:1,borderColor:quick.line,backgroundColor:quick.raised,justifyContent:'center'},pillText:{fontSize:13.5,fontWeight:'700',color:quick.ink},
 chip:{position:'absolute',alignSelf:'center',zIndex:40,paddingHorizontal:14,paddingVertical:8,borderRadius:999,borderWidth:1,borderStyle:'dashed',borderColor:quick.line,backgroundColor:quick.card},chipText:{fontSize:13,color:quick.muted},
 gear:{width:26,height:26,borderRadius:7,alignItems:'center',justifyContent:'center'},
 ring:{position:'absolute',borderWidth:1.5,borderStyle:'dashed',borderColor:quick.muted+'8c',borderRadius:16},
 ringOn:{position:'absolute',borderWidth:2,borderColor:quick.mint,borderRadius:16},
 halo:{position:'absolute',borderWidth:4,borderColor:quick.mint+'2e',borderRadius:20},
 minus:{position:'absolute',width:22,height:22,borderRadius:11,backgroundColor:'#3a4349',alignItems:'center',justifyContent:'center',elevation:4},
 minusText:{color:'#fff',fontSize:16,lineHeight:18,fontWeight:'800'},
 grip:{position:'absolute',width:22,height:22,borderRightWidth:4,borderBottomWidth:4,borderColor:quick.ink,borderBottomRightRadius:9},
 tip:{position:'absolute',paddingHorizontal:12,paddingVertical:5,borderRadius:10,backgroundColor:quick.mint},tipText:{fontSize:14,fontWeight:'800',color:'#06261a'},
 ghost:{position:'absolute',paddingHorizontal:14,paddingVertical:8,borderRadius:12,borderWidth:1,borderColor:quick.mint,backgroundColor:quick.card,elevation:12},ghostText:{fontSize:14,fontWeight:'700',color:quick.ink},
 drop:{position:'absolute',height:3,borderRadius:3,backgroundColor:quick.mint},
 sheet:{position:'absolute',left:0,right:0,bottom:0,zIndex:50,gap:10,paddingHorizontal:14,paddingTop:14,borderTopWidth:1,borderColor:quick.line,borderTopLeftRadius:22,borderTopRightRadius:22,backgroundColor:quick.card,elevation:24},
 sheetHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},sheetTitle:{fontSize:17,fontWeight:'700',color:quick.ink},
 orow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,minHeight:56,paddingHorizontal:12,borderRadius:12,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 rowLabel:{fontSize:14.5,fontWeight:'700',color:quick.ink},none:{fontSize:13.5,color:quick.muted,marginVertical:6,marginHorizontal:2},
 mini:{flexDirection:'row',alignItems:'center',gap:2,padding:2,borderRadius:9,borderWidth:1,borderColor:quick.line},
 miniButton:{height:32,minWidth:40,paddingHorizontal:9,borderRadius:7,alignItems:'center',justifyContent:'center'},miniText:{fontSize:13.5,fontWeight:'600',color:quick.muted},
 miniValue:{minWidth:52,textAlign:'center',fontSize:13.5,fontWeight:'700',color:quick.ink},
 shape:{height:34,paddingHorizontal:11,borderRadius:9,borderWidth:1,borderColor:quick.line,justifyContent:'center'},shapeText:{fontSize:13.5,color:quick.ink},
 sw:{width:44,height:26,borderRadius:13,backgroundColor:quick.line,padding:3},knob:{width:20,height:20,borderRadius:10,backgroundColor:'#fff'},
 card:{alignItems:'center',gap:8,paddingTop:12,paddingBottom:10,paddingHorizontal:10,borderRadius:16,borderWidth:2,borderColor:quick.line,backgroundColor:quick.background},
 cardText:{fontSize:13.5,fontWeight:'600',color:quick.muted},
 lrow:{gap:8,paddingHorizontal:10,paddingVertical:10,borderRadius:12,borderWidth:1,borderColor:quick.line,backgroundColor:quick.background},
 lhead:{flexDirection:'row',alignItems:'center',gap:8,minHeight:32},lline:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8,paddingLeft:26},
 handle:{width:18,fontSize:15,color:quick.dim},ud:{flexDirection:'row',gap:2,width:84,justifyContent:'flex-end'},
});
let st=make();onTheme(()=>{st=make();});
