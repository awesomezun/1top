// Customizing on Android (customizing-spec_v1.2.2): what each preset draws from the stored layout, and what the edit
// mode may change and how, as the web's tray does it (agent/onetop/dist/customize.js, quick.js customize() and
// arrange(), cluster.js place()). No React here, so Node tests it (test/customize.test.mjs); the screens draw and edit
// through it (customize.tsx, cluster.tsx, dashboard.tsx). Every word is a Word, [English, Korean, Chinese] in the
// customizing glossary (docs/design/customizing/customizing-glossary_v1.0.0.md), shown with t(...word).
import {OBJECTS,MODES,defaults,type Group,type Layout,type Mode,type ObjectId} from './layout';

export type Preset='cluster'|'dashboard';
export type Box={x:number;y:number;w:number;h:number};
export type Word=[en:string,ko:string,zh:string];
export const SIZES:Word[]=[['Small','작게','小'],['Medium','보통','中'],['Large','크게','大']];
export const NAMES:Record<ObjectId,Word>={periods:['Time window picker','기간 선택','时段选择器'],dials:['Dials','두 계기','双仪表'],alerts:['Warning lights','경고등','警示灯'],
 odo:['Total · Trip','합계·트립','合计·小计'],temps:['CPU · Memory','CPU·메모리','CPU·内存'],fuel:['Limit left','남은 한도','剩余额度'],window:['Window (tabs)','창(탭)','窗口（标签页）'],
 tokens:['Token usage','토큰 사용','Token 用量'],weekly:['Account limits','계정 한도','账户额度'],resources:['CPU · Memory','CPU·메모리','CPU·内存'],sessions:['Session list','세션 목록','会话列表']};
export const SHAPES:Partial<Record<ObjectId,[string,Word][]>>={
 periods:[['auto',['Screen default','이 화면 기본','本屏默认']],['tabs',['Tabs','탭','标签页']],['drum',['Drum','드럼','滚筒']],['tuner',['Tuner','튜너','调谐尺']],['roller',['Roller','롤러','滚轮']],['knob',['Knob','노브','旋钮']],['lever',['Lever','레버','拨杆']]],
 dials:[['ring',['Ring','고리','圆环']],['glow',['Glow','빛','光晕']],['plate',['Plate','판','面板']]],
 alerts:[['label',['Labels','이름표','名称']],['chips',['Chips','칩','胶囊']],['strip',['Strip','띠','灯条']],['count',['Counts','숫자','数字']],['badge',['Badges','배지','徽章']],['lens',['Lenses','렌즈','透镜']]],
 odo:[['drum',['O5 Drum','O5 드럼','O5 滚筒']],['led',['O1 LED','O1 LED','O1 LED']],['led0',['O2 LED, zero-padded','O2 LED 0 채움','O2 LED 补零']],['print',['O3 Print','O3 인쇄','O3 印刷']],['print0',['O4 Print, zero-padded','O4 인쇄 0 채움','O4 印刷 补零']]]
};
export const TITLES:Record<Preset,Word>={cluster:['Cluster','계기판','组合仪表'],dashboard:['Dashboard','대시보드','仪表盘']};
// The editor's phrases around a name: the top bar's title, the list's and the gallery's titles, the − and the hidden chip.
export const PHRASES={
 customize:([en,ko,zh]:Word):Word=>[`Customize ${en}`,`${ko} 커스터마이징`,`自定义${zh}`],
 list:([en,ko,zh]:Word):Word=>[`${en} list`,`${ko} 목록`,`${zh}列表`],
 shape:([en,ko,zh]:Word):Word=>[`${en} · Shape`,`${ko} · 모양`,`${zh} · 样式`],
 hide:([en,ko,zh]:Word):Word=>[`Hide ${en}`,`${ko} 숨기기`,`隐藏${zh}`],
 hidden:(n:number):Word=>[`＋ Hidden parts ${n}`,`＋ 숨긴 부품 ${n}`,`＋ 已隐藏的部件 ${n}`]
};
// What each preset offers on the phone, as the tray: the cluster's CPU and memory show only on its side.
export const KNOWN:Record<Preset,ObjectId[]>={cluster:['periods','dials','alerts','odo','fuel','window'],dashboard:['periods','tokens','weekly','resources','sessions']};

export type Caps={size:boolean;count:boolean;shape:boolean;move:boolean;hide:boolean};
/** What one object can change here. The period control stays where it is (on the cluster its shape may change; the
 *  dashboard's period buttons have none) and the dials stay on top, always shown. */
export function caps(preset:Preset,id:ObjectId):Caps{
 const O=OBJECTS[id],plain=preset==='dashboard'&&id==='periods',fixed=id==='periods';
 return {size:'size' in O&&!plain,count:!!O.count&&!plain,shape:!!SHAPES[id]&&!!O.shape&&!plain,move:!fixed&&id!=='dials',hide:!fixed&&id!=='dials'};
}
/** A count's steps: its whole numbers, or its fixed steps, then null ('자동' or '모두') when it has one. */
export function countSteps(id:ObjectId):(number|null)[]{const O=OBJECTS[id];if(O.steps)return [...O.steps,null];const [lo,hi,def]=O.count!,out:(number|null)[]=[];for(let n=lo;n<=hi;n++)out.push(n);if(def===null)out.push(null);return out;}
/** Where a count stands among its steps; 'as many as fit' / 'all' stands at the number shown now (past the largest
 *  number, at 'all', so one step down is the largest). */
export function startAt(steps:(number|null)[],value:number|null|undefined,shown?:number|null){
 if(value!=null)return Math.max(0,steps.indexOf(value));if(!Number.isInteger(shown))return steps.length-1;
 const i=steps.findIndex(x=>x!==null&&x>=(shown as number));return i<0?steps.length-1:i;
}
/** A count as the glossary writes it: Auto (the fuel) or All, N slots, N (lights), N rows. */
export function countWord(id:ObjectId,v:number|null|undefined):Word{
 if(v===null||v===undefined)return id==='fuel'?['Auto','자동','自动']:['All','모두','全部'];
 return id==='sessions'?[`${v} rows`,`${v}줄`,`${v} 行`]:id==='alerts'?[`${v}`,`${v}개`,`${v} 个`]:[`${v} slots`,`${v}칸`,`${v} 格`];
}
export const shapeName=(id:ObjectId,v:string|undefined):Word=>{const list=SHAPES[id]||[];return (list.find(([k])=>k===v)||list[0]||['',['','','']])[1];};
export const sizeOf=(g:Group,id:ObjectId)=>{const n=g.opts[id]?.size;return Number.isInteger(n)?n as number:OBJECTS[id].size??2;};

// Changes, made on the caller's copy of the layout.
const opts=(g:Group,id:ObjectId)=>g.opts[id]||(g.opts[id]={});
export function hide(g:Group,id:ObjectId){if(!g.hidden.includes(id))g.hidden.push(id);}
export function toggle(g:Group,id:ObjectId){g.hidden=g.hidden.includes(id)?g.hidden.filter(x=>x!==id):[...g.hidden,id];}
export function setSize(g:Group,id:ObjectId,v:number){opts(g,id).size=Math.max(0,Math.min(2,v));}
export function setShape(g:Group,id:ObjectId,v:string){opts(g,id).shape=v;}
/** One count step either way from where it stands (from the number shown now when it shows 'all'). */
export function stepCount(g:Group,id:ObjectId,d:number,shown?:number|null){const s=countSteps(id),o=opts(g,id);o.count=s[Math.max(0,Math.min(s.length-1,startAt(s,o.count,shown)+d))];}
/** The count a grip drag of n steps from where it started (at) reaches. */
export function countAt(id:ObjectId,at:number,n:number){const s=countSteps(id);return s[Math.max(0,Math.min(s.length-1,at+n))];}
/** The list's ↑ and ↓: one place among the movable objects shown here. */
export function shift(g:Group,id:ObjectId,d:number,movable:ObjectId[]){
 const o=g.order,list=o.filter(x=>movable.includes(x)),i=list.indexOf(id),j=i+d;if(i<0||j<0||j>=list.length)return;
 o.splice(o.indexOf(id),1);const at=o.indexOf(list[j]);o.splice(d<0?at:at+1,0,id);
}
/** A drop: before the object it landed on, or after the last movable one. */
export function moveTo(g:Group,id:ObjectId,before:ObjectId|null,movable:ObjectId[]){
 const o=g.order;o.splice(o.indexOf(id),1);
 if(before)o.splice(o.indexOf(before),0,id);else{const last=[...o].reverse().find(x=>movable.includes(x));o.splice(last?o.indexOf(last)+1:o.length,0,id);}
}
export function reset(layout:Layout,preset:Preset){layout.presets[preset]=defaults().presets[preset];}
/** Where a moved object would land: before the first movable object whose middle is below the finger. */
export function target(boxes:{id:ObjectId;box:Box}[],dragged:ObjectId,y:number):{before:ObjectId|null;box:Box|null}{
 const list=boxes.filter(b=>b.id!==dragged);for(const b of list)if(y<b.box.y+b.box.h/2)return {before:b.id,box:b.box};
 const last=list[list.length-1];return {before:null,box:last?last.box:null};
}
/** The marks over one object, in its canvas's coordinates: the ring just inside it (so touching objects never share a
 *  line), the − on the ring's top-left corner and the grip inside its bottom-right, all inside the screen (view). The
 *  grip's 44 of touch keeps clear of the screen's sides (EDGE), where a drag would be Android's back gesture. */
export const EDGE=24;
export function marks(b:Box,view:{x0:number;x1:number;y0:number}){
 const x0=Math.max(view.x0+2,b.x+2),x1=Math.min(view.x1-2,b.x+b.w-2),clampX=(x:number,w:number)=>Math.max(view.x0+3,Math.min(view.x1-w-3,x));
 return {ring:{x:x0,y:b.y+2,w:x1-x0,h:Math.max(8,b.h-4)},minus:{x:clampX(x0-9,22),y:Math.max(view.y0+2,b.y-7),w:22,h:22},
  grip:{x:Math.max(view.x0+EDGE+10,Math.min(view.x1-EDGE-34,x1-24)),y:b.y+b.h-26,w:22,h:22}};
}
/** The value above the finger: 44 over it, inside the screen. */
export function tipAt(x:number,y:number,w:number,h:number,view:{x0:number;x1:number;y0:number}){return {x:Math.max(view.x0+4,Math.min(view.x1-w-4,x-w/2)),y:Math.max(view.y0+4,y-44-h)};}

// Drawing. Sizes step as on the web: the dials (cluster.js DIAL_K), the window (WIN_K) and the token dashboard's zoom.
export const DIAL_K=[.76,.88,1],WIN_K=[.7,1,1.35],TOKENS_K=[.7,.85,1];
export const PITCH=[0,58,58,58,58,56,54,50,47];
/** The cluster upright: the dials on top, where the housing takes their round shape; the rest in the layout's order,
 *  the period control right above the window (or in its place when the window is hidden). */
export function clusterOrder(g:Group):ObjectId[]{
 const hide=new Set(g.hidden),out:ObjectId[]=['dials'];
 for(const id of g.order){if(id==='dials'||id==='periods'||id==='temps')continue;if(id==='window')out.push('periods');if(!hide.has(id))out.push(id);}
 return out;
}
/** On its side the dials and the window keep their axes and the warnings the middle of the lower row; the odometer
 *  and the fuel take the sides in the layout's order. */
export const clusterSides=(g:Group)=>g.order.filter(id=>id==='odo'||id==='fuel') as ('odo'|'fuel')[];
export const dashboardOrder=(g:Group)=>g.order.filter(id=>!g.hidden.includes(id));
/** The dashboard's gear sits at the end of the first section's heading after the period control. */
export const gearSection=(g:Group)=>g.order.find(id=>id!=='periods'&&!g.hidden.includes(id))||null;
export const periodKind=(g:Group)=>{const s=g.opts.periods?.shape;return !s||s==='auto'?'drum':s;};
/** The window's pages, as many and in the order chosen. */
export function windowTabs<T extends [Mode,...string[]]>(g:Group,modes:T[]):T[]{const want=g.opts.window?.tabs;if(!Array.isArray(want)||!want.length)return modes;const kept=want.map(k=>modes.find(m=>m[0]===k)).filter((m):m is T=>!!m);return kept.length?kept:modes;}
/** The window's page: the one last shown when it is among the pages chosen, or else the first chosen (a choice that
 *  leaves out sessions opens on its first page, not on sessions). */
export function windowPage<T extends [Mode,...string[]]>(g:Group,modes:T[],last:Mode):Mode{const tabs=windowTabs(g,modes);return tabs.some(([k])=>k===last)?last:tabs[0][0];}
/** Fuel cans: as many as asked (or up to eight), fewer while they do not fit the room. */
export function fuelCans(room:number,gauges:number,cap:number|null|undefined){let n=Math.min(8,cap||8,gauges);while(n>2&&n*PITCH[n]>room)n--;return n;}
/** The warning lights' cells: n of them, each as wide as the shape asks or as the room allows. */
export function tellCell(shape:string,n:number,room:number){const want=shape==='label'?52:shape==='count'?50:36,inner=room-2-(shape==='label'?10:20)-(n-1)*(shape==='label'?1:4);return Math.max(30,Math.min(want,Math.floor(inner/Math.max(1,n))));}
// The phone's tabs: the workspace opens from the header's person button, so the bar holds the dashboard, the cluster
// (with two tabs), sessions, usage and limits; the settings route stays, off the bar.
export const TAB_BAR={two:['index','cluster','sessions','usage','accounts'],one:['index','sessions','usage','accounts']};
export const tabBar=(layout:Layout)=>TAB_BAR[layout.tabs==='one'?'one':'two'];
/** With two tabs the app opens on the chosen preset's tab (the cluster's for a layout whose preset is the cluster). */
export const startTab=(layout:Layout)=>layout.tabs!=='one'&&layout.preset==='cluster'?'cluster':'index';
/** With two tabs, showing the dashboard's or the cluster's tab chooses that preset, so the next launch opens there; with
 *  one tab the header's switch chooses it (null: nothing to change). */
export function tabPreset(layout:Layout,tab:string):Preset|null{
 if(layout.tabs==='one')return null;const p=tab==='index'?'dashboard':tab==='cluster'?'cluster':null;return p&&p!==layout.preset?p:null;
}
/** Whether the header's computers label fits beside the brand and its round buttons (30 each, 8 apart), Hangul and
 *  Chinese about 11.5 a character at its size and the rest 6.4; where it does not, the pill shows their count. */
export function pillFits(label:string,width:number,buttons:number){
 const room=width-32-76-buttons*38-8,wide=[...label].reduce((n,ch)=>n+(/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af]/.test(ch)?11.5:6.4),34);
 return wide<=room;
}
export {MODES};
