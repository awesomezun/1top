// The cluster themes (cluster-themes plan v1.1.0): the phones' theme page and tables are what scripts/theme-bundle.mjs
// writes from the dashboard's themes, the collector and the site serve every theme file, and every theme draws the
// figures with nothing missing, keeps its four warnings, six gears and trip pressable, at rest, without fuel, cruise,
// range or sessions, with every warning lit and with a period outside its gears.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {files} from '../scripts/theme-bundle.mjs';
import {dashboardFiles} from '../site/scripts/dashboard-pages.mjs';

const at=p=>new URL('../'+p,import.meta.url),read=p=>readFileSync(at(p),'utf8');
for(const [p,text] of files())assert.equal(read(p),text,`${p} is behind the dashboard's themes: node scripts/theme-bundle.mjs`);

const DIR='agent/onetop/dist/themes/',names=readdirSync(at(DIR)).sort(),server=read('agent/onetop/server.py'),site=dashboardFiles();
for(const n of names){
 assert.ok(server.includes(`'/themes/${n}'`),`server.py serves themes/${n}`);
 assert.ok(site.includes('themes/'+n),`the site carries themes/${n}`);
}
assert.ok(read('pyproject.toml').includes('"dist/themes/*"'),'the package carries dist/themes');

const box={};box.window=box;vm.createContext(box);
for(const n of ['core.js',...names.filter(n=>/^t\d\d-\d\d\.js$/.test(n)),'pairs.js','compact.js'])vm.runInContext(read(DIR+n),box);
const O=box.OneTop,themes=O.THEMES.slice().sort((a,b)=>a.id.localeCompare(b.id)),base=O.snapshot();
assert.equal(themes.length,72);
// Joined: the themes' arrays come from the vm's own realm.
assert.equal(themes.map(t=>t.id).join(),Array.from({length:72},(_,i)=>String(i+1).padStart(2,'0')).join());
const kinds=JSON.parse(read(DIR+'catalog.json')),mini=JSON.parse(read(DIR+'mini.json'));
for(const t of themes){assert.ok(kinds.some(c=>c.rank===t.id&&['아날로그','디지털','혼합'].includes(c.type)),`catalog kind of ${t.id}`);assert.ok(mini[t.id],`mini palette of ${t.id}`);}

const cases={
 demo:base,
 rest:{...base,rate:0,burn:0,heat:0,cpu:0,mem:0,tokens:0,odo:0,trip:0,list:[],flow:Array(24).fill(0)},
 'no cruise, range or fuel':{...base,cruise:null,rangeH:null,fuel:[],fuelLeft:0,minLeft:0},
 'no sessions':{...base,sessions:{working:0,waiting:0,idle:0,total:0},list:[]},
 'every warning':{...base,lamps:{waiting:9,reconnect:3,empty:2,late:1}},
 'past the limits':{...base,rate:640e6,rateMax:700e6,burn:73,burnMax:80},
 'a period outside the gears':{...base,period:'7d',periodLabel:O.periodKo('7d'),gears:[...base.gears,'7d']},
};
const pressable=(svg,k)=>new Set([...svg.matchAll(new RegExp(`data-cl-${k}="([^"]*)"`,'g'))].map(m=>m[1]));
for(const [name,d] of Object.entries(cases))for(const t of themes){
 const svg=O.render(t,d),where=`theme ${t.id} (${name})`;
 assert.ok(svg.startsWith('<svg'),where);
 assert.doesNotMatch(svg,/NaN|undefined|Infinity/,where);
 assert.deepEqual([...pressable(svg,'alert')].sort(),['empty','live','reconnect','waiting'],where);
 assert.ok(pressable(svg,'period').size>=6&&pressable(svg,'trip').size===1,where);
}
// A phone held upright: every theme has both headline instruments measured, and their cut-outs draw.
for(const t of themes){
 const p=O.PAIRS[t.id],html=O.compact(t,base),where=`theme ${t.id} upright`;
 assert.ok(p?.rate?.length===4&&p?.burn?.length===4,where);
 assert.match(html,/class="ot-cut"/,where);assert.doesNotMatch(html,/NaN|undefined|Infinity/,where);
 assert.ok(O.compactAspect(t.id)>.5&&O.compactAspect(t.id)<6,where);
}
console.log(`cluster themes: ${files().length} bundle files current, ${names.length} files served, ${themes.length} themes × ${Object.keys(cases).length} cases`);
