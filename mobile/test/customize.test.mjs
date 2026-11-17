import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const L=await import('../src/layout.ts'),M=await import('../src/customize-model.ts');

// The web gate's seeds (tests/customize-browser.py): its three extremes and seeded combinations of order, size, count,
// shape and hidden objects, for both presets.
const ORDER=['periods','dials','alerts','odo','temps','fuel','window'];
const SHAPES={periods:['auto','tabs','drum','tuner','roller','knob','lever'],dials:['ring','glow','plate'],alerts:['label','chips','strip','count','badge','lens'],odo:['drum','led','led0','print','print0']};
const EXTREMES=[
 {order:ORDER,hidden:[],opts:{dials:{size:0},alerts:{count:3,shape:'lens'},odo:{shape:'led0'},fuel:{count:8},window:{size:0}}},
 {order:ORDER,hidden:[],opts:{dials:{size:2,shape:'plate'},alerts:{count:6,shape:'chips'},odo:{shape:'print0'},fuel:{count:3},window:{size:2}}},
 {order:['periods','window','fuel','odo','alerts','dials','temps'],hidden:['alerts','odo'],opts:{}}];
let seed=46;const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;},pickOne=a=>a[Math.floor(rnd()*a.length)],shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const sample=(a,n)=>shuffle(a).slice(0,n);
const cluster=()=>{const opts=Object.fromEntries(Object.entries(SHAPES).map(([k,v])=>[k,{shape:pickOne(v)}]));Object.assign(opts.dials,{size:Math.floor(rnd()*3),needle:pickOne(['default','red','amber'])});opts.alerts.count=3+Math.floor(rnd()*4);
 opts.fuel={count:pickOne([null,3,4,5,6,7,8])};opts.window={size:Math.floor(rnd()*3),tabs:sample(L.MODES,1+Math.floor(rnd()*7))};
 return {order:['periods',...shuffle(ORDER.slice(1))],hidden:sample(['alerts','odo','fuel','window','temps'],Math.floor(rnd()*3)),opts};};
const dashboard=()=>({order:['periods',...shuffle(['tokens','weekly','resources','sessions'])],hidden:sample(['tokens','weekly','resources'],Math.floor(rnd()*3)),
 opts:{tokens:{size:Math.floor(rnd()*3)},weekly:{count:pickOne([2,4,6,null])},sessions:{count:pickOne([3,5,10,null])}}});
const clusters=[...EXTREMES,...Array.from({length:40},cluster)].map(g=>L.read(JSON.stringify({v:1,preset:'cluster',presets:{cluster:g}})).layout.presets.cluster);
const dashboards=Array.from({length:30},dashboard).map(g=>L.read(JSON.stringify({v:1,presets:{dashboard:g}})).layout.presets.dashboard);
const WIDTHS=[360,393,412];

test('upright the dials stay on top, the period control right above the window, and nothing hidden is drawn',()=>{
 for(const g of clusters){const o=M.clusterOrder(g),shown=['dials','periods',...g.order.filter(id=>!['dials','periods','temps'].includes(id)&&!g.hidden.includes(id))];
  assert.equal(o[0],'dials');assert.equal(new Set(o).size,o.length);assert.deepEqual([...o].sort(),[...shown].sort());assert.ok(!o.includes('temps'));
  const w=o.indexOf('window');if(w>=0)assert.equal(o[w-1],'periods');
  // The rest keep the layout's order.
  const rest=o.filter(id=>id!=='dials'&&id!=='periods');assert.deepEqual(rest,g.order.filter(id=>rest.includes(id)));}
});

test('the dashboard draws its shown sections in order, and the gear goes to the first after the period control',()=>{
 for(const g of dashboards){assert.deepEqual(M.dashboardOrder(g),g.order.filter(id=>!g.hidden.includes(id)));
  assert.equal(M.gearSection(g),g.order.find(id=>id!=='periods'&&!g.hidden.includes(id)));}
 assert.equal(M.gearSection(L.defaults().presets.dashboard),'tokens');
});

test('G2: every seeded cluster fits its housing at 360, 393 and 412 dp, and its marks stay on the screen without overlapping',()=>{
 const fails=[];
 for(const W of WIDTHS){const housingW=Math.min(W,820)-32-28,inner=housingW;
  for(const [i,g] of clusters.entries()){const at=`${W}dp #${i}`;
   const full=Math.floor((housingW-10)/2),dial=Math.floor(full*M.DIAL_K[M.sizeOf(g,'dials')]);
   if(2*dial+Math.max(10,housingW-2*full)>inner)fails.push(at+' dials');
   const shape=g.opts.alerts.shape,n=g.opts.alerts.count,cell=M.tellCell(shape,n,inner);
   // The widest the lights can be: every light lit with a count.
   const lights=shape==='chips'?Math.min(inner,340):shape==='lens'?3*44+2*6+16+2:shape==='label'?n*cell+(n-1)+12:n*Math.max(Math.min(36,cell),shape==='count'?cell:0)+(n-1)*4+22;
   if(lights>inner)fails.push(at+' lights '+shape+' '+lights);
   if(shape==='label'&&cell<44)fails.push(at+' label cells '+cell);
   for(const gauges of [1,4,8,12]){const cans=M.fuelCans(housingW,gauges,g.opts.fuel.count);if(cans*M.PITCH[Math.max(2,cans)]>housingW)fails.push(at+' fuel');if(g.opts.fuel.count&&cans>g.opts.fuel.count)fails.push(at+' fuel cap');}
   // The objects stack 16 apart in the housing (16 from the screen's edge, 14 inside it); their marks stay inside the
   // screen and inside each object, so no two rings meet.
   const view={x0:-16,x1:W-16,y0:0};let y=18;const rings=[];
   for(const id of M.clusterOrder(g)){const h=id==='dials'?dial:id==='window'?300*M.WIN_K[M.sizeOf(g,'window')]:60,box={x:14,y,w:housingW,h},m=M.marks(box,view);
    for(const r of [m.ring,m.minus,m.grip])if(r.x<view.x0||r.x+r.w>view.x1||r.y<view.y0)fails.push(at+' '+id+' mark off screen');
    if(m.ring.x<box.x||m.ring.x+m.ring.w>box.x+box.w||m.ring.y<box.y||m.ring.y+m.ring.h>box.y+box.h)fails.push(at+' '+id+' ring outside');
    for(const r of rings)if(m.ring.y<r.y+r.h&&r.y<m.ring.y+m.ring.h)fails.push(at+' '+id+' rings overlap');rings.push(m.ring);y+=h+16;}
  }}
 assert.deepEqual(fails,[]);
});

test('G2: the marks of objects touching the screen\'s edges stay on it',()=>{
 for(const W of WIDTHS){const view={x0:0,x1:W,y0:0},m=M.marks({x:0,y:0,w:W,h:50},view);
  assert.ok(m.minus.x>=3&&m.grip.x+m.grip.w<=W-3&&m.ring.x>=2&&m.ring.x+m.ring.w<=W-2&&m.minus.y>=2);
  // The grip's touch (10 round it, 44 across) stays out of the back gesture's edges, inside its object.
  assert.ok(m.grip.x-10>=M.EDGE&&m.grip.x+34<=W-M.EDGE&&m.grip.x+m.grip.w<=m.ring.x+m.ring.w);
  for(const x of [0,W/2,W]){const t=M.tipAt(x,10,70,30,view);assert.ok(t.x>=4&&t.x+70<=W-4&&t.y>=4);}}
});

test('what each object can change on the phone',()=>{
 assert.deepEqual(M.caps('cluster','periods'),{size:false,count:false,shape:true,move:false,hide:false});
 assert.deepEqual(M.caps('dashboard','periods'),{size:false,count:false,shape:false,move:false,hide:false});
 assert.deepEqual(M.caps('cluster','dials'),{size:true,count:false,shape:true,move:false,hide:false});
 assert.deepEqual(M.caps('cluster','alerts'),{size:false,count:true,shape:true,move:true,hide:true});
 assert.deepEqual(M.caps('cluster','window'),{size:true,count:false,shape:false,move:true,hide:true});
 assert.deepEqual(M.caps('dashboard','tokens'),{size:true,count:false,shape:false,move:true,hide:true});
 assert.deepEqual(M.KNOWN.cluster,['periods','dials','alerts','odo','fuel','window']);
});

test('counts step as the web steps them, from the number shown when they show all',()=>{
 assert.deepEqual(M.countSteps('weekly'),[2,4,6,null]);assert.deepEqual(M.countSteps('fuel'),[3,4,5,6,7,8,null]);assert.deepEqual(M.countSteps('alerts'),[3,4,5,6]);
 assert.equal(M.countWord('fuel',null)[1],'자동');assert.equal(M.countWord('sessions',null)[1],'모두');assert.equal(M.countWord('sessions',5)[1],'5줄');assert.equal(M.countWord('alerts',6)[1],'6개');
 const g=L.defaults().presets.cluster;M.stepCount(g,'fuel',-1,6);assert.equal(g.opts.fuel.count,5);M.stepCount(g,'fuel',1);M.stepCount(g,'fuel',1);M.stepCount(g,'fuel',1);M.stepCount(g,'fuel',1);assert.equal(g.opts.fuel.count,null);
 M.stepCount(g,'alerts',1);assert.equal(g.opts.alerts.count,6);M.stepCount(g,'alerts',-5);assert.equal(g.opts.alerts.count,3);
 // Past the last number (12 rows shown, 10 the most), one step down from 'all' is the most, as on the web.
 const d=L.defaults().presets.dashboard;M.stepCount(d,'sessions',-1,12);assert.equal(d.opts.sessions.count,10);M.stepCount(d,'weekly',1);assert.equal(d.opts.weekly.count,6);
 assert.equal(M.countAt('weekly',1,5),null);assert.equal(M.countAt('weekly',1,-5),2);
});

test('moving, hiding, sizing and resetting keep a layout every platform reads back the same',()=>{
 const l=L.defaults(),g=l.presets.cluster,movable=['alerts','odo','fuel','window'];
 M.shift(g,'fuel',-1,movable);M.shift(g,'fuel',-1,movable);assert.deepEqual(g.order,['periods','dials','fuel','alerts','odo','temps','window']);
 M.moveTo(g,'window',null,movable);assert.equal(g.order.indexOf('window'),g.order.indexOf('odo')+1);M.moveTo(g,'window','alerts',movable);assert.equal(g.order.indexOf('window'),g.order.indexOf('alerts')-1);
 M.hide(g,'odo');M.hide(g,'odo');assert.deepEqual(g.hidden,['temps','odo']);M.toggle(g,'odo');assert.deepEqual(g.hidden,['temps']);
 M.setSize(g,'dials',5);assert.equal(g.opts.dials.size,2);M.setSize(g,'dials',0);M.setShape(g,'alerts','badge');
 assert.deepEqual(L.read(L.write(l)).layout,l);
 M.reset(l,'cluster');assert.deepEqual(l.presets.cluster,L.defaults().presets.cluster);
 // A drop lands before the first object whose middle is below the finger, or after the last.
 const boxes=[['alerts',100],['odo',200],['fuel',300]].map(([id,y])=>({id,box:{x:0,y,w:10,h:60}}));
 assert.equal(M.target(boxes,'fuel',120).before,'alerts');assert.equal(M.target(boxes,'alerts',140).before,'odo');assert.equal(M.target(boxes,'alerts',900).before,null);
});

test('the period control\'s auto is the phone\'s drum, and the window shows the pages chosen, in order',()=>{
 assert.equal(M.periodKind(L.defaults().presets.cluster),'drum');
 const g=L.read(JSON.stringify({v:1,presets:{cluster:{opts:{periods:{shape:'knob'},window:{tabs:['map','sessions']}}}}})).layout.presets.cluster;
 assert.equal(M.periodKind(g),'knob');assert.deepEqual(M.windowTabs(g,L.MODES.map(k=>[k,k])).map(m=>m[0]),['map','sessions']);
 // The page remembered shows when it is chosen; otherwise the first chosen page, never a page left out.
 const pages=L.MODES.map(k=>[k,k]),only=L.read(JSON.stringify({v:1,presets:{cluster:{opts:{window:{tabs:['system','map']}}}}})).layout.presets.cluster;
 assert.equal(M.windowPage(only,pages,'sessions'),'system');assert.equal(M.windowPage(only,pages,'map'),'map');
 assert.equal(M.windowPage(g,pages,'sessions'),'sessions');assert.equal(M.windowPage(L.defaults().presets.cluster,pages,'heat'),'heat');
});

test('the tab bar: the workspace leaves it for the header; the cluster\'s tab only with two tabs',()=>{
 const two=L.defaults(),one=L.read(JSON.stringify({v:1,tabs:'one'})).layout;
 assert.deepEqual(M.tabBar(two),['index','cluster','sessions','usage','accounts']);
 assert.deepEqual(M.tabBar(one),['index','sessions','usage','accounts']);
 // The settings route stays registered (navigable from the header), off the bar.
 const tabs=readFileSync(new URL('../src/app/(tabs)/_layout.tsx',import.meta.url),'utf8');
 assert.match(tabs,/\['settings','Workspace','워크스페이스'/);assert.match(tabs,/tabBar\(layout\)/);
 // The header's workspace button is the person in a ring, never the gear that customizes, on the dashboard's and the cluster's headers.
 const ui=readFileSync(new URL('../src/ui.tsx',import.meta.url),'utf8'),icons=readFileSync(new URL('../src/icons.tsx',import.meta.url),'utf8');
 assert.match(icons,/case 'person':/);
 const button=ui.slice(ui.indexOf('export function WorkspaceButton'),ui.indexOf('export function ConnectionBadge'));
 assert.match(button,/name="person"/);assert.doesNotMatch(button,/name="workspace"/);assert.match(button,/router\.navigate\('\/settings'\)/);
 // Both tabs share the 1top header, the person button at its right end (as the iPhone's).
 assert.match(readFileSync(new URL('../src/header.tsx',import.meta.url),'utf8'),/<WorkspaceButton size=\{30\}\/><\/View>/);
 for(const f of ['dashboard.tsx','cluster.tsx'])assert.match(readFileSync(new URL('../src/'+f,import.meta.url),'utf8'),/<BrandHeader/,f);
});

test('with two tabs the app opens on the chosen preset\'s tab, and showing either tab chooses it for the next launch',()=>{
 const at=(o)=>L.read(JSON.stringify({v:1,...o})).layout;
 assert.equal(M.startTab(L.defaults()),'index');
 assert.equal(M.startTab(at({preset:'cluster'})),'cluster');
 assert.equal(M.startTab(at({tabs:'one',preset:'cluster'})),'index');
 assert.equal(M.tabPreset(at({preset:'cluster'}),'index'),'dashboard');
 assert.equal(M.tabPreset(at({preset:'dashboard'}),'cluster'),'cluster');
 assert.equal(M.tabPreset(at({preset:'cluster'}),'cluster'),null);
 assert.equal(M.tabPreset(at({preset:'cluster'}),'sessions'),null);
 // With one tab the header's switch chooses the preset; the tabs leave it alone.
 assert.equal(M.tabPreset(at({tabs:'one',preset:'cluster'}),'index'),null);
});

// G5: the cluster's and the dashboard's tabs and the customizing editor speak English and Chinese, in the glossary
// (docs/design/customizing/customizing-glossary_v1.0.0.md) and the cluster words agreed for 4.5.1.
test('no Korean is left on the dashboard, the cluster or the editor in English and Chinese',async()=>{
 const {translate}=await import('../src/i18n.ts'),{chinese}=await import('../src/chinese.ts');
 const hangul=/[가-힣]/;
 // Every glossary Word the editor shows, in both languages.
 const words=[...M.SIZES,...Object.values(M.NAMES),...Object.values(M.TITLES),...Object.values(M.SHAPES).flatMap(l=>l.map(([,w])=>w)),
  ...['fuel','alerts','weekly','sessions'].flatMap(id=>[null,3,6].map(n=>M.countWord(id,n))),
  ...Object.values(M.TITLES).flatMap(w=>[M.PHRASES.customize(w),M.PHRASES.list(w)]),...Object.values(M.NAMES).flatMap(w=>[M.PHRASES.shape(w),M.PHRASES.hide(w)]),M.PHRASES.hidden(2)];
 for(const w of words)for(const lang of ['en','zh']){const s=translate(lang,w[0],w[1],w[2]);assert.ok(s&&!hangul.test(s),lang+' '+w.join(' / '));}
 // The glossary's own words, exactly.
 const G={Customize:'自定义',Preset:'预设',List:'列表',Close:'关闭',Show:'显示',Size:'大小',Count:'数量',Fewer:'减少',Shape:'样式','Full list':'完整列表','Move up':'上移','Move down':'下移',
  'Reset to defaults':'恢复默认','Dashboard and Cluster tabs':'仪表盘与组合仪表标签页',Separate:'分开',Combined:'合并','You can only drag it to another place.':'只能拖动改变位置。','Its place is fixed.':'位置是固定的。',Workspace:'工作区'};
 for(const [en,zh] of Object.entries(G))assert.equal(chinese(en),zh,en);
 assert.deepEqual(M.NAMES.odo,['Total · Trip','합계·트립','合计·小计']);assert.deepEqual(M.countWord('fuel',null),['Auto','자동','自动']);assert.deepEqual(M.countWord('sessions',5),['5 rows','5줄','5 行']);
 // 4.5.1's cluster words.
 const C={Waiting:'等待回复',Done:'已完成','Sign in':'重新登录','Low limit':'额度不足','Limit burn':'额度消耗','Time left':'可用时长',Trip:'小计',Limits:'额度',Goals:'目标',Resources:'资源',
  'By AI':'按 AI',Live:'实时',Working:'工作中',Total:'合计','Token speed':'Token 速度','Limit left':'剩余额度','All AI':'全部 AI',h:'小时'};
 for(const [en,zh] of Object.entries(C))assert.equal(chinese(en),zh,en);
 // A Word is always shown through say(): never as a raw [English, Korean, Chinese] child or label.
 const editor=readFileSync(new URL('../src/customize.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(editor,/[>=]\{M\.(NAMES|TITLES|SIZES)\[/);assert.doesNotMatch(editor,/>\{l\}</);
 // 완료 is Done / 完成 everywhere (ending customizing, a goal reached), though the warning light's 완료됨 is 已完成; the
 // dashboard's unnamed models and unsplit computers read as on the web and the Mac.
 assert.match(readFileSync(new URL('../src/customize.tsx',import.meta.url),'utf8'),/t\('Done','완료','完成'\)/);
 assert.match(readFileSync(new URL('../src/cluster.tsx',import.meta.url),'utf8'),/complete:\[t\('Done','완료','完成'\)/);
 assert.equal(translate('zh','Done','완료','完成'),'完成');assert.equal(translate('zh','Done','완료됨'),'已完成');
 assert.equal(chinese('No model info'),'无模型信息');assert.equal(chinese('Computers without a split'),'无明细的电脑');
 // In the sources no Korean is left outside t(english, korean), a Word or a table row with its English, and comments.
 const tables=[];
 for(const f of ['cluster.tsx','customize.tsx','customize-model.ts','periods.tsx','dashboard.tsx','header.tsx','lcd.tsx']){
  let code=readFileSync(new URL('../src/'+f,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>l.replace(/(^|[^:'"`])\/\/.*$/,'$1')).join('\n');
  for(const m of code.matchAll(/\['[a-z_]+','([^']+)','([^']+)'(?:,[^\]]*)?\]/g))tables.push([m[1],m[2],f]);
  code=code.replace(/\bt\(\s*'(?:[^'\\]|\\.)*'\s*,\s*'(?:[^'\\]|\\.)*'\s*(?:,\s*'(?:[^'\\]|\\.)*'\s*)?\)/g,'')
   .replace(/\bt\(\s*`[^`]*`\s*,\s*`[^`]*`\s*(?:,\s*`[^`]*`\s*)?\)/g,'')
   .replace(/\[\s*(['`])(?:(?!\1).)*\1\s*,\s*(['`])(?:(?!\2).)*\2\s*,\s*(['`])(?:(?!\3).)*\3\s*\]/g,'')
   .replace(/\['[a-z_]+','[^']+','[^']+'(?:,[^\]]*)?\]/g,'');
  assert.deepEqual(code.split('\n').filter(l=>hangul.test(l)).map(l=>f+': '+l.trim().slice(0,120)),[],f);
 }
 // Each table row (the window's pages, the lights, the chips) carries its English, which has its Chinese.
 const rows=tables.filter(([,ko])=>hangul.test(ko));
 assert.ok(rows.length>=19,'pages, lights and chips');
 for(const [en,ko,f] of rows){assert.ok(!hangul.test(en),f+' '+en);assert.notEqual(chinese(en),en,f+' '+en+' / '+ko);}
});

test('the 1top header keeps every button whole: the computers\' label gives way to their count where it does not fit',()=>{
 // 4 round buttons with two tabs (theme, language, more, workspace), 5 with one (the preset switch too).
 const labels={ko:'모든 컴퓨터 · 3',en:'All computers · 3',zh:'全部电脑 · 3'};
 // At 411 dp (a 1080-pixel phone) the whole label fits beside four buttons; beside five, and at 360, the count shows.
 for(const lang of ['ko','en','zh']){
  assert.equal(M.pillFits(labels[lang],411,4),true,lang+' 411 two tabs: the whole label');
  assert.equal(M.pillFits(labels[lang],411,5),false,lang+' 411 one tab: the count');
  assert.equal(M.pillFits(labels[lang],360,4),false,lang+' 360 two tabs: the count');
  assert.equal(M.pillFits(labels[lang],360,5),false,lang+' 360 one tab: the count');
 }
 // A short label (one computer's name) stays whole beside five buttons at 411.
 assert.equal(M.pillFits('Mac mini',411,5),true);
});

test('the dashboard\'s scope holds still with less motion asked for, and turns only while its tab shows and tokens flow',()=>{
 const src=readFileSync(new URL('../src/dashboard.tsx',import.meta.url),'utf8'),scope=src.slice(src.indexOf('function Scope('),src.indexOf('function MiniGauge('));
 assert.match(scope,/calm=useCalm\(\)/);assert.match(scope,/moving=\(data\.average\?\?0\)>0&&!calm/);
 // No animation frame is asked for while calm or away, and none once the grow-in ends without a beam.
 assert.match(scope,/if\(!focused\)return;if\(calm\)\{startTransition\(\(\)=>\{setGrow\(1\);setHead\(-90\);\}\);return;\}/);
 assert.match(scope,/if\(moving\|\|t<\.8\)frame=requestAnimationFrame\(tick\)/);
 // The working wave by each session follows less motion when it is asked for later too, and runs on the native driver.
 const mark=readFileSync(new URL('../src/state-mark.tsx',import.meta.url),'utf8');
 assert.match(mark,/addEventListener\('reduceMotionChanged',setStill\)/);assert.match(mark,/useNativeDriver:true/);assert.doesNotMatch(mark,/useNativeDriver:false/);
});
