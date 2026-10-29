import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const {chinese}=await import('../src/chinese.ts');
const {accountTags,sessionAccount}=await import('../src/fleet.ts');
const {demoDevices,demoThread,DEMO_ROWS}=await import('../src/demo.ts');
const {unit,usage,since,bins,UNIT_CHECK}=await import('../src/demo-usage.ts');
const {translate,windowName}=await import('../src/i18n.ts');

const src=new URL('../src/',import.meta.url);
const files=readdirSync(src,{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)&&!f.endsWith('chinese.ts'));
// Texts that read the same in Chinese: names, units and symbols.
const SAME=new Set(['CPU','Goals · Skills','tokens/h','1top']);

test('every label has a Chinese text, as on the iPhone',()=>{
 const missing=new Set();
 for(const f of files){const code=readFileSync(new URL(f,src),'utf8');
  for(const m of code.matchAll(/\bt\(\s*(['`])((?:\\.|(?!\1).)*?)\1\s*,/g)){
   const en=m[2].replace(/\\'/g,"'").replace(/\\n/g,'\n').replace(/\$\{[^}]*\}/g,'3');
   if(!SAME.has(en.trim())&&chinese(en)===en)missing.add(en);}}
 assert.deepEqual([...missing],[]);
});

test('the Chinese table carries every entry of the iPhone table',()=>{
 const swift=readFileSync(new URL('../../ios/OneTop/Model/Chinese.swift',import.meta.url),'utf8'),exact=swift.slice(swift.indexOf('static let exact'),swift.indexOf('/// Strings with numbers'));
 const missing=[...exact.matchAll(/^\s*"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",\s*$/gm)].map(m=>[m[1].replace(/\\n/g,'\n').replace(/\\"/g,'"'),m[2].replace(/\\n/g,'\n').replace(/\\"/g,'"')]).filter(([en,zh])=>chinese(en)!==zh).map(([en])=>en);
 assert.deepEqual(missing,[]);
});

test('same-tool accounts are numbered by label once a tool has two, and a given name replaces the number',()=>{
 const q=(id,kind,label,alias)=>({id,kind,account_label:label,plan:'',updated:1,stale:false,windows:[],alias});
 const dev=(quotas)=>({id:'a',name:'a',online:true,received:Date.now(),snapshot:{sessions:[],host:{},account_quotas:quotas}});
 assert.deepEqual(accountTags([dev([q('x','Claude','Claude · b'),q('y','Claude','claude · A'),q('z','Codex','Codex · c')])]),{y:'1',x:'2'});
 assert.deepEqual(accountTags([dev([q('x','Claude','Claude · b','Team'),q('y','Claude','Claude · a')])]),{y:'1',x:'Team'});
 assert.equal(sessionAccount({weekly_account:'w',weekly_estimate:{'1h':{account_id:'e'}}},'1h'),'e');
 assert.equal(sessionAccount({weekly_account:'w',weekly_estimate:null},'1h'),'w');
});

test('the demo matches the iPhone demo: computers, sessions, models, names and accounts',()=>{
 const swift=readFileSync(new URL('../../ios/OneTop/Model/DemoData.swift',import.meta.url),'utf8');
 const ios=[...swift.matchAll(/Row\("(\w+)", "(\w+)", "([^"]+)", "([^"]+)", "([^"]+)", "([^"]+)", "(\w+)", ([\d.]+), (?:"([^"]+)"|nil)(?:, capabilities: \[([^\]]*)\])?\)/g)]
  .map(m=>[m[1],m[2],m[3],m[4],m[5],m[6],m[7],Number(m[8]),m[9]||null,m[10]?m[10].split(', ').map(x=>x.replace(/"/g,'')):'controls']);
 assert.equal(ios.length,10);
 assert.deepEqual(DEMO_ROWS.map(r=>[...r.slice(0,9),r[9].length===8?'controls':r[9]]),ios);
 for(const lang of ['en','ko']){
  const t=(en,ko)=>translate(lang,en,ko),devices=demoDevices(t),sessions=devices.flatMap(d=>d.snapshot.sessions);
  assert.deepEqual(sessions.map(s=>[s.id,s.kind,s.model,s.project,s.status,s.weekly_account]),ios.map(r=>[r[0],r[1],r[2],r[3],r[6],r[8]]));
  assert.deepEqual(sessions.map(s=>s.terminal),ios.map(r=>lang==='en'?r[4]:r[5]));
  assert.deepEqual(devices.map(d=>d.name),lang==='en'?['Demo Mac Studio','Demo Mac mini']:['데모 Mac Studio','데모 Mac mini']);
 }
 // The session names are read through the language table at run time, so each needs a Chinese text.
 assert.deepEqual(DEMO_ROWS.filter(r=>chinese(r[4])===r[4]).map(r=>r[4]),[]);
 const iosQuotas=[...swift.matchAll(/quota\("([^"]+)", "(\w+)", "([^"]+)"/g)].map(m=>[m[1],m[2],m[3]]);
 const quotas=new Map(demoDevices().flatMap(d=>d.snapshot.account_quotas).map(q=>[q.id,[q.id,q.kind,q.account_label]]));
 assert.deepEqual([...quotas.values()].sort(),iosQuotas.sort());
 assert.deepEqual(accountTags(demoDevices()),{'demo:claude-a':'1','demo:claude-b':'Team','demo:codex-b':'1','demo:codex-a':'2'});
 // An English screen shows no Korean, and the conversation follows the language too.
 const english=JSON.stringify([demoDevices((en)=>en),demoThread('d1',(en)=>en)]);
 assert.equal(/[가-힣]/.test(english.replace(/"label":"주간"/g,'')),false);
 assert.equal(demoThread('d1',(en)=>en).length,8);
});

test('demo usage gives the numbers the iPhone and the web give (DemoUsageTests.swift, tests/demo-usage.mjs)',()=>{
 assert.deepEqual(UNIT_CHECK.map(([a,b,c])=>unit(a,b,c)),[0.638385457219556,0.416402937611565,0.8966296215076,0.9844421946909279]);
 const now=1800000000.5,u=usage(23,1.2e6,[{weight:52,start:0,stop:Infinity},{weight:12,start:0,stop:now-3000}],now,now-600);
 assert.deepEqual([since(u,0,now-3600),since(u,1,now-86400),since(u,0,now-600)].map(Math.round),[92181344,292954505,8620266]);
 const quiet=usage(23,1.2e6,[{weight:52,start:0,stop:Infinity},{weight:12,start:0,stop:now-3000}],now,now-600,7,.4,false);
 assert.deepEqual([since(quiet,0,now-86400),since(quiet,1,now-86400)].map(Math.round),[513711382,161355472]);
 assert.deepEqual(bins(u,['Claude','Codex'],now,3600,300).bins.slice(-4),[{Claude:1511996},{Claude:1823151},{Claude:7315948},{Claude:3781}]);
});

test('the demo is uneven as real use is: pauses, a long tail, and one tool carrying most of it',()=>{
 const now=1800000000,u=usage(23,1.2e6,[{weight:1,start:0,stop:Infinity}],now,now),sessions=demoDevices().flatMap(d=>d.snapshot.sessions);
 const totals=bins(u,['Claude'],now,86400,900).bins.map(b=>b.Claude||0),busy=totals.filter(n=>n>0).sort((a,b)=>a-b);
 assert.ok(busy.length<totals.length,'some quarter hours rest');
 assert.ok(busy.at(-1)>busy[Math.floor(busy.length/2)]*2.5,'the busiest quarter hour is well above the middle one');
 const byKind={};for(const s of sessions)byKind[s.kind]=(byKind[s.kind]||0)+s.windows['24h'].reduce((a,b)=>a+b,0);
 const all=Object.values(byKind).reduce((a,b)=>a+b,0);
 assert.ok(byKind.Claude/all>.6&&byKind.Codex/all<.35,JSON.stringify(byKind));
});

test('limit windows are named from their key in the chosen language',()=>{
 const ko=(en,k)=>k;
 assert.equal(windowName({key:'5h',label:'5H'},ko),'5시간');
 assert.equal(windowName({key:'7d',label:'주간'},(en)=>en),'Weekly');
 assert.equal(windowName({key:'5h',label:'5H'},(en,k)=>translate('zh',en,k)),'5小时');
});
