import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const {chinese}=await import('../src/chinese.ts');
const {accountTags,sessionAccount}=await import('../src/fleet.ts');
const {demoDevices,demoThread}=await import('../src/demo.ts');
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
 const ios=[...swift.matchAll(/session\("(\w+)", "(\w+)", "([^"]+)", "([^"]+)", L\.t\("([^"]+)", "([^"]+)"\), "(\w+)", ([\d_]+), account: (?:"([^"]+)"|nil)/g)]
  .map(m=>({id:m[1],kind:m[2],model:m[3],project:m[4],en:m[5],ko:m[6],status:m[7],hour:Number(m[8].replace(/_/g,'')),account:m[9]||null}));
 assert.equal(ios.length,10);
 for(const lang of ['en','ko']){
  const t=(en,ko)=>translate(lang,en,ko),devices=demoDevices(t),sessions=devices.flatMap(d=>d.snapshot.sessions);
  assert.deepEqual(sessions.map(s=>({id:s.id,kind:s.kind,model:s.model,project:s.project,en:'',ko:'',status:s.status,hour:s.windows['1h'].reduce((a,b)=>a+b,0),account:s.weekly_account})).map(x=>({...x,hour:Math.round(x.hour)})),
   ios.map(x=>({...x,en:'',ko:''})));
  assert.deepEqual(sessions.map(s=>s.terminal),ios.map(x=>lang==='en'?x.en:x.ko));
  assert.deepEqual(devices.map(d=>d.name),lang==='en'?['Demo Mac Studio','Demo Mac mini']:['데모 Mac Studio','데모 Mac mini']);
 }
 const iosQuotas=[...swift.matchAll(/Quota\(id: "([^"]+)", kind: "(\w+)", accountLabel: "([^"]+)"/g)].map(m=>[m[1],m[2],m[3]]);
 const quotas=new Map(demoDevices().flatMap(d=>d.snapshot.account_quotas).map(q=>[q.id,[q.id,q.kind,q.account_label]]));
 assert.deepEqual([...quotas.values()].sort(),iosQuotas.sort());
 assert.deepEqual(accountTags(demoDevices()),{'demo:claude-a':'1','demo:claude-b':'Team','demo:codex-b':'1','demo:codex-a':'2'});
 // An English screen shows no Korean, and the conversation follows the language too.
 const english=JSON.stringify([demoDevices((en)=>en),demoThread('d1',(en)=>en)]);
 assert.equal(/[가-힣]/.test(english.replace(/"label":"주간"/g,'')),false);
 assert.equal(demoThread('d1',(en)=>en).length,8);
});

test('limit windows are named from their key in the chosen language',()=>{
 const ko=(en,k)=>k;
 assert.equal(windowName({key:'5h',label:'5H'},ko),'5시간');
 assert.equal(windowName({key:'7d',label:'주간'},(en)=>en),'Weekly');
 assert.equal(windowName({key:'5h',label:'5H'},(en,k)=>translate('zh',en,k)),'5小时');
});
