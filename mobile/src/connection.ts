import {useEffect,useState} from 'react';
import {AppState,Platform} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import type {Device} from './types';
export const API='https://onetop-relay.gitreels.workers.dev';
const key='onetop.mobile.session.v1';
export const loadToken=()=>SecureStore.getItemAsync(key);
export async function api(path:string,token:string,body?:unknown){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
 try{const response=await fetch(API+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'Connection failed'),{status:response.status,code:result.code});return result;}finally{clearTimeout(timeout);}
}
const random=async(n:number)=>Array.from(await Crypto.getRandomBytesAsync(n)).map(v=>v.toString(16).padStart(2,'0')).join('');
export async function signIn(){
 const token='1tm_'+await random(32),state=await random(16),challenge=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,token);
 const url='https://1top.si/mobile-connect?'+new URLSearchParams({challenge,state,platform:Platform.OS==='ios'?'iOS':'Android'});
 const result=await WebBrowser.openAuthSessionAsync(url,'onetop://connected');
 if(result.type!=='success')throw new Error('Sign-in was cancelled.');
 if(new URL(result.url).searchParams.get('state')!==state)throw new Error('Sign-in response did not match this request.');
 await api('/api/devices',token);
 await SecureStore.setItemAsync(key,token,{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY});
 return token;
}
export async function signOut(token:string|null){
 if(token){try{await api('/api/mobile/logout',token,{});}catch(e:any){if(![400,401].includes(e.status))throw e;}}
 await SecureStore.deleteItemAsync(key);
}
export function useConnection(token:string|null){
 const [owner,setOwner]=useState(token);
 const [devices,setDevices]=useState<Device[]>([]),[state,setState]=useState('offline'),[error,setError]=useState(''),[account,setAccount]=useState<any>(null),[retryKey,setRetryKey]=useState(0),[active,setActive]=useState(AppState.currentState==='active'),[network,setNetwork]=useState(true),[receipt,setReceipt]=useState<any>(null);
 useEffect(()=>{const sub=AppState.addEventListener('change',v=>setActive(v==='active'));const off=NetInfo.addEventListener(v=>setNetwork(v.isConnected!==false));return()=>{sub.remove();off();};},[]);
 // Clear account-scoped external connection state before a new subscription is created.
 // eslint-disable-next-line react-hooks/set-state-in-effect
 useEffect(()=>{setOwner(token);setDevices([]);setAccount(null);setError('');setReceipt(null);},[token]);
 useEffect(()=>{
  if(!token||!active||!network)return;
  let alive=true,ws:WebSocket|null=null,timer:ReturnType<typeof setTimeout>|undefined,attempt=0;
  async function connect(){
   if(!alive)return;setState('connecting');
   try{const info=await api('/api/devices',token!);if(!alive)return;setAccount(info.account);
    const ticket=await api('/api/live-ticket',token!,{});if(!alive)return;
    ws=new (WebSocket as any)(ticket.socket_url,['1top','ticket.'+ticket.ticket],{headers:{Origin:'https://1top.si'}} as any);
    ws!.onopen=()=>{if(alive){attempt=0;setState('live');setError('');}};
    ws!.onmessage=(e:MessageEvent)=>{if(!alive)return;try{const m=JSON.parse(e.data);if(m.type==='state')setDevices(m.devices);if(m.type==='snapshot')setDevices(old=>[...old.filter(d=>d.id!==m.device.id),m.device]);if(m.type==='offline')setDevices(old=>old.map(d=>d.id===m.device_id?{...d,online:false}:d));if(m.type==='removed')setDevices(old=>old.filter(d=>d.id!==m.device_id));if(m.type==='result')setReceipt(m);}catch{setError('Invalid device report. Reconnect to try again.');}};
    ws!.onerror=()=>{if(alive)setState('offline');};
    ws!.onclose=()=>{if(!alive)return;setState('offline');timer=setTimeout(connect,Math.min(30000,1000*2**attempt++));};
   }catch(e:any){if(!alive)return;setState(e.status===403?'restricted':'offline');setError(e.message);if(e.status!==400&&e.status!==401&&e.status!==403)timer=setTimeout(connect,Math.min(30000,1000*2**attempt++));}
  }
  connect();return()=>{alive=false;clearTimeout(timer);if(ws){ws.onclose=null;ws.close();}};
 },[token,active,network,retryKey]);
 return {devices:owner===token?devices:[],state:token&&active&&network?state:'offline',error,account:owner===token?account:null,receipt:owner===token?receipt:null,retry:()=>setRetryKey(v=>v+1)};
}
