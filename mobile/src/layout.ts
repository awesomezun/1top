// Customizing (customizing-spec_v1.1.0): which objects each screen shows, in what order, and their size, count and shape,
// kept on this phone. A line-by-line port of the web's reader (agent/onetop/dist/layout.js), so the web, the Mac, the
// iPhone and Android read one JSON the same way: anything unknown, out of range or broken falls back to the defaults,
// which draw today's screens exactly; a layout written by a newer version is shown as the defaults and never written
// over. mobile/test/layout.test.mjs checks every case in tests/fixtures/layout_v1.json. No React here, so Node runs it;
// the phone's store is layout-store.ts.
export const KEY='onetop.layout.v1',VERSION=1;
export const MODES=['sessions','flow','weekly','map','heat','goals','system'] as const;
export type Mode=typeof MODES[number];
export type ObjectId='periods'|'dials'|'alerts'|'odo'|'temps'|'fuel'|'window'|'tokens'|'weekly'|'resources'|'sessions';
export type Panel='speed'|'summary'|'flow'|'map'|'sessions'|'shared';
/** An object's chosen options; which of them it has is its OBJECTS entry (none for the dashboard preset's period buttons). */
export type Options={size?:number;count?:number|null;shape?:string;needle?:string;tabs?:Mode[]};
export type Group={order:ObjectId[];hidden:ObjectId[];opts:Partial<Record<ObjectId,Options>>};
export type WideDashboard={panels:Panel[];hidden:Panel[];spans:Record<Panel,number>;heights:Partial<Record<Panel,number>>;instrument:'sweep'|'scope';instrumentWidth:number|null;rows:number|null};
export type Layout={v:number;tabs:'two'|'one';preset:'cluster'|'dashboard';presets:{cluster:Group;dashboard:Group};wide:{dashboard:WideDashboard;cluster:Group}};
/** locked: a newer version wrote it; show the defaults and do not save over it. */
export type LayoutState={layout:Layout;locked:boolean};
/** What an older version kept, taken over once: the web dashboard's saved panels and the panel's chosen view. The phone has neither. */
export type Legacy={dashboard?:string|null;quickCluster?:boolean};
type Spec={size?:number;count?:[number,number,number|null];shape?:string[];needle?:string[];tabs?:boolean;steps?:number[]};
type Def={order:ObjectId[];hidden:ObjectId[];plain?:ObjectId[]};
type Rec=Record<string,unknown>;
// Each object's options: size is a step 0–2 (2 is today's size unless said), count a whole number in its range or null
// for 'as many as fit' / 'all', shape one of its list (the first is today's; 'auto' is each screen's own: the tray's
// period buttons, the phone's and dashboard's drum).
export const OBJECTS:Record<ObjectId,Spec>={
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
export const PRESETS:Record<'cluster'|'dashboard',Def>={
 cluster:{order:['periods','dials','alerts','odo','temps','fuel','window'],hidden:['temps']},
 dashboard:{order:['periods','tokens','weekly','resources','sessions'],hidden:[],plain:['periods']}
};
const WIDE_CLUSTER:Def={order:['periods','dials','alerts','odo','temps','fuel','window'],hidden:[]};
export const PANELS:Panel[]=['speed','summary','flow','map','sessions','shared'];
const SPANS:Record<Panel,number>={speed:3,summary:9,flow:6,map:6,sessions:12,shared:12};
const isObj=(v:unknown):v is Rec=>!!v&&typeof v==='object'&&!Array.isArray(v);
const whole=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.round(v):null;
const clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
// The web's list.includes(value), telling TypeScript the value is then one of the list.
const one=<T extends string>(list:readonly T[],v:unknown):v is T=>list.includes(v as T);
export function option(id:ObjectId,plain?:boolean):Options{
 const O:Spec=plain?{}:OBJECTS[id],o:Options={};
 if('size' in O)o.size=O.size;
 if(O.count)o.count=O.count[2];
 if(O.shape)o.shape=O.shape[0];
 if(O.needle)o.needle=O.needle[0];
 if(O.tabs)o.tabs=[...MODES];
 return o;
}
function readOption(id:ObjectId,raw:unknown,plain:boolean):Options{
 const O:Spec=plain?{}:OBJECTS[id],o=option(id,plain);if(!isObj(raw))return o;
 if('size' in O){const n=whole(raw.size);if(n!==null)o.size=clamp(n,0,2);}
 if(O.count){
  if(raw.count===null)o.count=O.count[2]===null||id==='weekly'?null:O.count[2];
  else{const n=whole(raw.count);if(n!==null){if(O.steps){o.count=O.steps.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a);}else o.count=clamp(n,O.count[0],O.count[1]);}}
 }
 if(O.shape&&one(O.shape,raw.shape))o.shape=raw.shape;
 if(O.needle&&one(O.needle,raw.needle))o.needle=raw.needle;
 if(O.tabs&&Array.isArray(raw.tabs)){const t=[...new Set(raw.tabs.filter(x=>one(MODES,x)))];if(t.length)o.tabs=t;}
 return o;
}
// Known IDs once each, in the stored order; a missing one goes back right after the nearest earlier one it follows
// by default (or first).
function readOrder<T extends string>(raw:unknown,base:readonly T[]):T[]{
 const out:T[]=Array.isArray(raw)?[...new Set(raw.filter(x=>one(base,x)))]:[];
 base.forEach((id,i)=>{if(out.includes(id))return;let at=0;for(let j=i-1;j>=0;j--){const k=out.indexOf(base[j]);if(k>=0){at=k+1;break;}}out.splice(at,0,id);});
 return out;
}
const readHidden=<T extends string>(raw:unknown,order:T[]):T[]|null=>Array.isArray(raw)?order.filter(id=>raw.includes(id)):null;
function readGroup(raw:unknown,def:Def):Group{
 const plain=(id:ObjectId)=>!!def.plain?.includes(id),group:Group={order:[...def.order],hidden:[...def.hidden],opts:Object.fromEntries(def.order.map(id=>[id,option(id,plain(id))]))};
 if(!isObj(raw))return group;
 group.order=readOrder(raw.order,def.order);
 const hidden=readHidden(raw.hidden,group.order);if(hidden)group.hidden=hidden;
 // Nothing left to show would be an empty screen: start that group over.
 if(group.hidden.length>=group.order.length)return readGroup(null,def);
 const opts=raw.opts;if(isObj(opts))for(const id of def.order)group.opts[id]=readOption(id,opts[id],plain(id));
 return group;
}
function readWideDashboard(raw:unknown):WideDashboard{
 const d:WideDashboard={panels:[...PANELS],hidden:[],spans:{...SPANS},heights:{},instrument:'sweep',instrumentWidth:null,rows:null};
 if(!isObj(raw))return d;
 d.panels=readOrder(raw.panels,PANELS);
 const hidden=readHidden(raw.hidden,d.panels);if(hidden&&hidden.length<d.panels.length)d.hidden=hidden;
 const spans=raw.spans,heights=raw.heights;
 if(isObj(spans))for(const id of PANELS){const n=whole(spans[id]);if(n!==null)d.spans[id]=clamp(n,id==='summary'?6:3,12);}
 if(isObj(heights))for(const id of PANELS){const n=whole(heights[id]);if(n!==null)d.heights[id]=clamp(n,id==='sessions'?250:150,1200);}
 if(one(['sweep','scope'],raw.instrument))d.instrument=raw.instrument;
 {const n=whole(raw.instrumentWidth);if(n!==null)d.instrumentWidth=clamp(n,200,600);}
 if(raw.rows===null)d.rows=null;else{const n=whole(raw.rows);if(n!==null)d.rows=clamp(n,3,50);}
 return d;
}
export function defaults():Layout{
 // The panels open on the dashboard today, so the dashboard preset comes first until one is chosen.
 return {v:VERSION,tabs:'two',preset:'dashboard',
  presets:{cluster:readGroup(null,PRESETS.cluster),dashboard:readGroup(null,PRESETS.dashboard)},
  wide:{dashboard:readWideDashboard(null),cluster:readGroup(null,WIDE_CLUSTER)}};
}
function parse(raw:unknown):Rec|null{if(typeof raw!=='string')return null;try{const v:unknown=JSON.parse(raw);return isObj(v)?v:null;}catch{return null;}}
// The dashboard's own saved panels (onetop.dashboard.v1) and the panels' chosen view (quickCluster) are taken over once,
// the first time nothing has been saved under the new key.
function fromLegacy(legacy:unknown):Layout{
 const layout=defaults();if(!isObj(legacy))return layout;
 const d=parse(legacy.dashboard);
 if(d){const spans=isObj(d.spans)?d.spans:{};layout.wide.dashboard=readWideDashboard({panels:d.panels,spans,heights:d.heights,instrument:d.instrument,instrumentWidth:d.instrumentWidth});}
 if(typeof legacy.quickCluster==='boolean')layout.preset=legacy.quickCluster?'cluster':'dashboard';
 return layout;
}
/** read(raw, legacy) → {layout, locked}. raw is the stored string or null. locked: a newer version wrote it; show the
 *  defaults and do not save over it. */
export function read(raw:string|null|undefined,legacy?:Legacy|null):LayoutState{
 if(raw==null||raw==='')return {layout:fromLegacy(legacy),locked:false};
 const v=parse(raw);
 if(!v||typeof v.v!=='number'||!Number.isFinite(v.v))return {layout:defaults(),locked:false};
 if(v.v>VERSION)return {layout:defaults(),locked:true};
 const layout=defaults();
 if(one(['two','one'],v.tabs))layout.tabs=v.tabs;
 if(one(['cluster','dashboard'],v.preset))layout.preset=v.preset;
 const presets=v.presets,wide=v.wide;
 if(isObj(presets))for(const k of ['cluster','dashboard'] as const)layout.presets[k]=readGroup(presets[k],PRESETS[k]);
 if(isObj(wide)){layout.wide.dashboard=readWideDashboard(wide.dashboard);layout.wide.cluster=readGroup(wide.cluster,WIDE_CLUSTER);}
 return {layout,locked:false};
}
// The stored form: the normalized layout itself, keys in a fixed order so every platform writes the same text.
export const write=(layout:Layout):string=>JSON.stringify(read(JSON.stringify(layout)).layout);
