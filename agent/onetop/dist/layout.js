/* Customizing (customizing-spec_v1.1.0): which objects each screen shows, in what order, and their size, count and
   shape, kept on this device. One plain JSON, read the same way on the web, the Mac, the iPhone and Android: anything
   unknown, out of range or broken falls back to the defaults, which draw today's screens exactly; a layout written by a
   newer version is shown as the defaults and never written over. Every reader is checked against
   tests/fixtures/layout_v1.json. */
(function(root){
 'use strict';
 const KEY='onetop.layout.v1',VERSION=1;
 const MODES=['sessions','flow','weekly','map','heat','goals','system'];
 // Each object's options: size is a step 0–2 (2 is today's size unless said), count a whole number in its range or null
 // for 'as many as fit' / 'all', shape one of its list (the first is today's; 'auto' is each screen's own: the tray's
 // period buttons, the phone's and dashboard's drum).
 const OBJECTS={
  periods:{shape:['auto','tabs','drum','tuner','roller','knob','lever']},
  dials:{size:2,shape:['ring','glow','plate'],needle:['default','red','amber']},
  alerts:{count:[3,6,6],shape:['label','chips','strip','count','badge','lens']},
  odo:{shape:['drum','led','led0','print','print0']},
  temps:{},
  fuel:{count:[3,8,null]},
  window:{size:1,tabs:true},
  tokens:{size:2},
  weekly:{count:[2,6,4],steps:[2,4,6]},
  resources:{},
  sessions:{count:[3,10,null]}
 };
 const PRESETS={
  cluster:{order:['periods','dials','alerts','odo','temps','fuel','window'],hidden:['temps']},
  dashboard:{order:['periods','tokens','weekly','resources','sessions'],hidden:[],plain:['periods']}
 };
 const WIDE_CLUSTER={order:['periods','dials','alerts','odo','temps','fuel','window'],hidden:[]};
 const PANELS=['speed','summary','flow','map','sessions','shared'];
 const SPANS={speed:3,summary:9,flow:6,map:6,sessions:12,shared:12};
 const isObj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const whole=v=>typeof v==='number'&&Number.isFinite(v)?Math.round(v):null;
 const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
 function option(id,plain){
  const O=plain?{}:OBJECTS[id],o={};
  if('size' in O)o.size=O.size;
  if(O.count)o.count=O.count[2];
  if(O.shape)o.shape=O.shape[0];
  if(O.needle)o.needle=O.needle[0];
  if(O.tabs)o.tabs=[...MODES];
  return o;
 }
 function readOption(id,raw,plain){
  const O=plain?{}:OBJECTS[id],o=option(id,plain);if(!isObj(raw))return o;
  if('size' in O){const n=whole(raw.size);if(n!==null)o.size=clamp(n,0,2);}
  if(O.count){
   if(raw.count===null)o.count=O.count[2]===null||id==='weekly'?null:O.count[2];
   else{const n=whole(raw.count);if(n!==null){if(O.steps){o.count=O.steps.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a);}else o.count=clamp(n,O.count[0],O.count[1]);}}
  }
  if(O.shape&&O.shape.includes(raw.shape))o.shape=raw.shape;
  if(O.needle&&O.needle.includes(raw.needle))o.needle=raw.needle;
  if(O.tabs&&Array.isArray(raw.tabs)){const t=[...new Set(raw.tabs.filter(x=>MODES.includes(x)))];if(t.length)o.tabs=t;}
  return o;
 }
 // Known IDs once each, in the stored order; a missing one goes back right after the nearest earlier one it follows
 // by default (or first).
 function readOrder(raw,base){
  const out=Array.isArray(raw)?[...new Set(raw.filter(x=>base.includes(x)))]:[];
  base.forEach((id,i)=>{if(out.includes(id))return;let at=0;for(let j=i-1;j>=0;j--){const k=out.indexOf(base[j]);if(k>=0){at=k+1;break;}}out.splice(at,0,id);});
  return out;
 }
 const readHidden=(raw,order)=>Array.isArray(raw)?order.filter(id=>raw.includes(id)):null;
 function readGroup(raw,def){
  const plain=id=>!!def.plain?.includes(id),group={order:[...def.order],hidden:[...def.hidden],opts:Object.fromEntries(def.order.map(id=>[id,option(id,plain(id))]))};
  if(!isObj(raw))return group;
  group.order=readOrder(raw.order,def.order);
  const hidden=readHidden(raw.hidden,group.order);if(hidden)group.hidden=hidden;
  // Nothing left to show would be an empty screen: start that group over.
  if(group.hidden.length>=group.order.length)return readGroup(null,def);
  if(isObj(raw.opts))for(const id of def.order)group.opts[id]=readOption(id,raw.opts[id],plain(id));
  return group;
 }
 function readWideDashboard(raw){
  const d={panels:[...PANELS],hidden:[],spans:{...SPANS},heights:{},instrument:'sweep',instrumentWidth:null,rows:null};
  if(!isObj(raw))return d;
  d.panels=readOrder(raw.panels,PANELS);
  const hidden=readHidden(raw.hidden,d.panels);if(hidden&&hidden.length<d.panels.length)d.hidden=hidden;
  if(isObj(raw.spans))for(const id of PANELS){const n=whole(raw.spans[id]);if(n!==null)d.spans[id]=clamp(n,id==='summary'?6:3,12);}
  if(isObj(raw.heights))for(const id of PANELS){const n=whole(raw.heights[id]);if(n!==null)d.heights[id]=clamp(n,id==='sessions'?250:150,1200);}
  if(['sweep','scope'].includes(raw.instrument))d.instrument=raw.instrument;
  {const n=whole(raw.instrumentWidth);if(n!==null)d.instrumentWidth=clamp(n,200,600);}
  if(raw.rows===null)d.rows=null;else{const n=whole(raw.rows);if(n!==null)d.rows=clamp(n,3,50);}
  return d;
 }
 function defaults(){
  // The panels open on the dashboard today, so the dashboard preset comes first until one is chosen.
  return {v:VERSION,tabs:'two',preset:'dashboard',
   presets:{cluster:readGroup(null,PRESETS.cluster),dashboard:readGroup(null,PRESETS.dashboard)},
   wide:{dashboard:readWideDashboard(null),cluster:readGroup(null,WIDE_CLUSTER)}};
 }
 function parse(raw){if(typeof raw!=='string')return null;try{const v=JSON.parse(raw);return isObj(v)?v:null;}catch{return null;}}
 // The dashboard's own saved panels (onetop.dashboard.v1) and the panels' chosen view (quickCluster) are taken over once,
 // the first time nothing has been saved under the new key.
 function fromLegacy(legacy){
  const layout=defaults();if(!isObj(legacy))return layout;
  const d=parse(legacy.dashboard);
  if(d){const spans=isObj(d.spans)?d.spans:{};layout.wide.dashboard=readWideDashboard({panels:d.panels,spans,heights:d.heights,instrument:d.instrument,instrumentWidth:d.instrumentWidth});}
  if(typeof legacy.quickCluster==='boolean')layout.preset=legacy.quickCluster?'cluster':'dashboard';
  return layout;
 }
 /** read(raw, legacy) → {layout, locked}. raw is the stored string or null. locked: a newer version wrote it; show the
  *  defaults and do not save over it. */
 function read(raw,legacy){
  if(raw==null||raw==='')return {layout:fromLegacy(legacy),locked:false};
  const v=parse(raw);
  if(!v||typeof v.v!=='number'||!Number.isFinite(v.v))return {layout:defaults(),locked:false};
  if(v.v>VERSION)return {layout:defaults(),locked:true};
  const layout=defaults();
  if(['two','one'].includes(v.tabs))layout.tabs=v.tabs;
  if(['cluster','dashboard'].includes(v.preset))layout.preset=v.preset;
  if(isObj(v.presets))for(const k of ['cluster','dashboard'])layout.presets[k]=readGroup(v.presets[k],PRESETS[k]);
  if(isObj(v.wide)){layout.wide.dashboard=readWideDashboard(v.wide.dashboard);layout.wide.cluster=readGroup(v.wide.cluster,WIDE_CLUSTER);}
  return {layout,locked:false};
 }
 // The stored form: the normalized layout itself, keys in a fixed order so every platform writes the same text.
 const write=layout=>JSON.stringify(read(JSON.stringify(layout)).layout);
 function load(){let raw=null,legacy={};try{raw=root.localStorage?.getItem(KEY)??null;legacy.dashboard=root.localStorage?.getItem('onetop.dashboard.v1')??null;
  const q=JSON.parse(root.localStorage?.getItem('onetop.quick.v1')||'null');if(typeof q?.cluster==='boolean')legacy.quickCluster=q.cluster;}catch{}return read(raw,legacy);}
 function save(state){if(state.locked)return false;try{root.localStorage?.setItem(KEY,write(state.layout));return true;}catch{return false;}}
 // One state for the page, so the dashboard, its cluster and the tray never write over each other's changes.
 let SHARED=null;const shared=()=>SHARED||(SHARED=load());
 const api={KEY,VERSION,MODES,OBJECTS,PRESETS,PANELS,defaults,read,write,load,save,shared,option};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopLayout=api;
})(typeof globalThis!=='undefined'?globalThis:this);
