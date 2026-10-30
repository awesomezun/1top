// The signed-in relay: the account's computers and their snapshots over the live socket, and controls
// sent as relay actions. Same requests as the site's earlier dashboard (main.js connect and api).
import {initializeApp} from 'firebase/app';
import {getAuth,onAuthStateChanged,signOut} from 'firebase/auth';
import config from '../firebase-config.json';
import {selectedRelay,socketForRelay} from './relay-settings.js';

export function liveRelay({onStatus}){
 const auth=getAuth(initializeApp(config)),API=selectedRelay(),results=new Set(),mailboxes=new Map(),histories=new Map();
 let historyTurn=Promise.resolve(),historySent=0;
 let user=null,devices=new Map(),deviceList=[],ws=null,retry=null,attempt=0,generation=0;
 async function api(path,data){
  const token=user?await user.getIdToken():null;
  const r=await fetch(API+path,{method:data===undefined?'GET':'POST',redirect:'error',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
  const result=await r.json();if(!r.ok){const error=Error(result.error||'Request failed');error.status=r.status;error.code=result.code;throw error;}return result;
 }
 async function connect(){
  const current=++generation;clearTimeout(retry);if(ws){ws.onclose=null;ws.close();}
  try{
   const result=await api('/api/devices');deviceList=result.devices||[];
   for(const d of deviceList)if(!devices.has(d.id))devices.set(d.id,{...d,online:false,received:0,snapshot:{host:{},periods:[],sessions:[],applications:[],account_quotas:[]}});
   onStatus({state:'connecting',user,account:result.account,computers:deviceList.length});
   const ticket=await api('/api/live-ticket',{});if(current!==generation)return;
   ws=new WebSocket(socketForRelay(ticket.socket_url,API),['1top','ticket.'+ticket.ticket]);
   ws.onopen=()=>{attempt=0;onStatus({state:'live',user,computers:deviceList.length});};
   ws.onmessage=e=>{
    const m=JSON.parse(e.data);if(current!==generation)return;
    if(m.type==='state'){devices=new Map(m.devices.map(d=>[d.id,d]));for(const d of deviceList)if(!devices.has(d.id))devices.set(d.id,{...d,online:false,received:0,snapshot:{host:{},periods:[],sessions:[],applications:[],account_quotas:[]}});}
    if(m.type==='snapshot')devices.set(m.device.id,m.device);
    if(m.type==='state')onStatus({state:'live',user,computers:devices.size});
    if(m.type==='offline'){const d=devices.get(m.device_id);if(d)d.online=false;}
    if(m.type==='removed')devices.delete(m.device_id);
    if(m.type==='result')for(const listener of results)listener(m);
    if(m.type==='mailbox'){const done=mailboxes.get(m.request_id);if(done){mailboxes.delete(m.request_id);done(m);}}
    if(m.type==='history'){const done=histories.get(m.request_id);if(done){histories.delete(m.request_id);done(m);}}
   };
   ws.onclose=()=>{if(current!==generation||!user)return;onStatus({state:'reconnecting',user});retry=setTimeout(connect,Math.min(30000,1000*2**attempt++));};
  }catch(error){
   if(current!==generation||!user)return;
   if(error.status===403){onStatus({state:'denied',user,message:error.message});return;}
   onStatus({state:'reconnecting',user,message:error.message});retry=setTimeout(connect,Math.min(30000,2000*2**attempt++));
  }
 }
 onAuthStateChanged(auth,value=>{user=value;if(!user){generation++;clearTimeout(retry);ws?.close();devices.clear();onStatus({state:'signed-out'});return;}connect();});
 return {
  devices:()=>[...devices.values()],
  send:command=>api('/api/action',command),
  onResult:listener=>results.add(listener),
  // Disconnecting a computer, as the earlier web dashboard did; the relay also tells the socket.
  async revoke(id){await api('/api/devices/revoke',{device_id:id});devices.delete(id);deviceList=deviceList.filter(d=>d.id!==id);},
  // One mailbox read: the computer answers on the socket with at most ten recently changed rows.
  mailbox(request){
   if(ws?.readyState!==1)return Promise.reject(Object.assign(Error('컴퓨터 연결이 끊겼습니다. 재연결하면 답신을 확인할 수 있습니다.'),{status:503}));
   const request_id=crypto.randomUUID();
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{mailboxes.delete(request_id);reject(Object.assign(Error('메시지 연결을 확인하지 못했습니다.'),{status:504}));},15000);
    mailboxes.set(request_id,m=>{clearTimeout(timer);m.error?reject(Object.assign(Error(m.error),{status:409})):resolve(m.messages||[]);});
    ws.send(JSON.stringify({type:'mailbox_request',request_id,...request}));
   });
  },
  // A computer's usage history (usage-history-contract_v1.0.0), asked on the socket. The relay keeps one
  // request per viewer at a time, two seconds apart, so requests wait their turn.
  history(request){
   const turn=historyTurn.then(async()=>{
    await new Promise(done=>setTimeout(done,Math.max(0,historySent+2000-Date.now())));
    if(ws?.readyState!==1)throw Object.assign(Error('Disconnected'),{status:503});
    const request_id=crypto.randomUUID();historySent=Date.now();
    return new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{histories.delete(request_id);reject(Object.assign(Error('History was not answered.'),{status:504}));},15000);
     histories.set(request_id,m=>{clearTimeout(timer);m.error?reject(Object.assign(Error(m.error),{status:409})):resolve(m.data);});
     ws.send(JSON.stringify({type:'history_request',request_id,...request}));
    });
   });
   historyTurn=turn.catch(()=>{});return turn;
  },
  // An account's display name; its result arrives like a control's.
  alias:command=>api('/api/accounts/alias',command),
  signOut:()=>{generation++;clearTimeout(retry);ws?.close();return signOut(auth);},
 };
}
