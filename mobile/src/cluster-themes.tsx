import React,{useCallback,useEffect,useRef,useSyncExternalStore} from 'react';
import {type StyleProp,type ViewStyle} from 'react-native';
import {WebView,type WebViewMessageEvent} from 'react-native-webview';
import * as SecureStore from 'expo-secure-store';
import {THEME_HOST,THEME_KINDS,THEME_NAMES} from './theme-host';
import {REST,type Figures} from './theme-figures';

// The cluster's look (customizing, cluster-themes plan v1.1.0): the 1top instruments or one of the 72 themes the
// dashboard draws (agent/onetop/dist/themes), drawn here in a web view of the phones' theme page (theme-host.ts, written
// by scripts/theme-bundle.mjs). Kept apart from the layout under the dashboard's key (cluster-themes.js), so an older
// app that saves the layout keeps it.
const KEY='onetop.clusterTheme.v1';
const pick=(v:unknown)=>typeof v==='string'&&/^\d\d$/.test(v)&&v in THEME_NAMES?v:null;
let current:string|null=null,loaded=false,chosen=false;
const listeners=new Set<()=>void>();
/** Chooses the look: "01" … "72", or null for the 1top instruments. */
export function setClusterTheme(id:string|null){current=pick(id);chosen=true;listeners.forEach(f=>f());SecureStore.setItemAsync(KEY,JSON.stringify({theme:current})).catch(()=>{});}
// Read from the phone once; a look chosen before that read returns wins.
function subscribe(f:()=>void){
 listeners.add(f);
 if(!loaded){loaded=true;SecureStore.getItemAsync(KEY).then(raw=>{if(!raw||chosen)return;try{current=pick(JSON.parse(raw)?.theme);listeners.forEach(g=>g());}catch{}}).catch(()=>{});}
 return()=>{listeners.delete(f);};
}
export const useClusterTheme=():string|null=>useSyncExternalStore(subscribe,()=>current);
/** The gallery's words, keyed as the theme page names them (in Korean, as the dashboard's catalog does). */
export const galleryLabels=(t:(en:string,ko:string)=>string)=>({'전체':t('All','전체'),'아날로그':t('Analog','아날로그'),'디지털':t('Digital','디지털'),'혼합':t('Mixed','혼합'),
 '1top 기본':t('1top default','1top 기본'),'지금의 계기판':t('Current cluster','지금의 계기판')});
/** The look's name as the customizing list shows it. */
export const lookName=(id:string|null,t:(en:string,ko:string)=>string)=>id?`${id} · ${THEME_NAMES[id]||''}`:t('1top default','1top 기본');

/** The figures the cluster last drew, for the customizing gallery (which opens over the cluster). */
export {figures,type Figures} from './theme-figures';
export const shownFigures:{current:(()=>Figures)|null}={current:null};
export type Press={alert:string}|{period:string}|{trip:true}|{pick:string|null};
export type Mode={kind:'theme'|'side'|'compact';id:string}|{kind:'gallery';selected:string|null;labels:Record<string,string>;ink:string};
/** The theme page in a web view: the chosen theme from the cluster's figures (on its side over the whole screen with
 *  'side', only its two headline instruments cut out for a phone held upright with 'compact'), or the gallery of every theme. The figures go over only when stamp or the mode changes, so the needles
 *  glide between reports instead of starting again; what is pressed comes back through onPress. */
export function ThemeView({mode,stamp,figures:get,onPress,style,testID}:{mode:Mode;stamp:string;figures:()=>Figures|null;onPress?:(p:Press)=>void;style?:StyleProp<ViewStyle>;testID?:string}){
 const web=useRef<WebView<object>>(null),ready=useRef(false),sent=useRef(''),self=useRef({mode,stamp,get,onPress});
 useEffect(()=>{self.current={mode,stamp,get,onPress};});
 const push=useCallback(()=>{const s=self.current,key=JSON.stringify(s.mode)+'|'+s.stamp;if(!ready.current||!web.current||key===sent.current)return;sent.current=key;
  const fig=s.get()||REST,m=s.mode;
  web.current.injectJavaScript(m.kind==='gallery'
   // The sheet's ink, whatever the system's light or dark.
   ?`document.getElementById('gallery').style.color=${JSON.stringify(m.ink)};OneTopHost.gallery(${JSON.stringify({figures:fig,theme:m.selected||'',kinds:THEME_KINDS,labels:m.labels,names:THEME_NAMES})});true;`
   :`OneTopHost.compact(${m.kind==='compact'});OneTopHost.side(${m.kind==='side'});OneTopHost.draw(${JSON.stringify(m.id)},${JSON.stringify(fig)});true;`);},[]);
 useEffect(()=>{push();});
 const message=(e:WebViewMessageEvent)=>{let m:Record<string,unknown>;try{m=JSON.parse(e.nativeEvent.data);}catch{return;}
  if(m.ready){ready.current=true;sent.current='';push();return;}
  const p=self.current.onPress;if(!p)return;
  if(typeof m.alert==='string')p({alert:m.alert});else if(typeof m.period==='string')p({period:m.period});else if(m.trip)p({trip:true});else if(typeof m.pick==='string')p({pick:m.pick||null});};
 const gallery=mode.kind==='gallery';
 // WebView<object>: its own default (undefined) leaves its props never under this TypeScript.
 return <WebView<object> ref={web} testID={testID} source={{html:THEME_HOST}} originWhitelist={['*']} onMessage={message} scrollEnabled={gallery} nestedScrollEnabled={gallery}
  overScrollMode="never" bounces={false} showsVerticalScrollIndicator={gallery} setSupportMultipleWindows={false} androidLayerType="hardware" style={[{backgroundColor:'transparent'},style]}/>;
}
