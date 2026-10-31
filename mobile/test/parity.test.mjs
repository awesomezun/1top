import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files.
register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}"));
const {chinese}=await import('../src/chinese.ts');
const {accountTags,sessionAccount}=await import('../src/fleet.ts');
const {demoDevices,demoThread,setDemoNow}=await import('../src/demo.ts');
const {WORLD}=await import('../src/demo-world.ts');
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

test('the demo is the one demo world: the same computers, sessions, accounts and numbers as the web demo at the same moment',async()=>{
 // The phones' copies are written from site/src/demo-world.js and are up to date.
 const {files}=await import('../../scripts/demo-world.mjs');
 for(const [path,text] of files)assert.equal(readFileSync(new URL('../../'+path,import.meta.url),'utf8'),text,path+' is out of date: run node scripts/demo-world.mjs');
 const {WORLD:web}=await import('../../site/src/demo-world.js');
 assert.deepEqual(Object.fromEntries(Object.entries(WORLD).filter(([k])=>k!=='caps')),JSON.parse(JSON.stringify(web)));
 // The web demo relay held at the same moment gives the same screen.
 const at=1_800_000_000;setDemoNow(at);globalThis.setInterval=()=>0;
 const {demoRelay}=await import('../../site/src/remote-demo.js'),site=demoRelay({demoNow:at}).devices(),phone=demoDevices();
 const sum=v=>v?v.reduce((a,b)=>a+b,0):null;
 const shape=devices=>devices.map(d=>({id:d.id,name:d.name,platform:d.platform,
  sessions:d.snapshot.sessions.map(s=>[s.id,s.kind,s.model||'',s.project,s.app,s.terminal,s.status,s.root_session_id,s.parent_session_id,s.capabilities.join(','),s.weekly_account||null,sum(s.windows['1h']),sum(s.windows['24h']),s.rate,sum(s.tokens),s.weekly_estimate?.['24h']?.used_pp??null,s.context_usage?JSON.stringify(s.context_usage):null]),
  host:[d.snapshot.host.cpu,d.snapshot.host.used_memory,d.snapshot.host.total_memory,d.snapshot.host.cores],
  quotas:d.snapshot.account_quotas.map(q=>[q.id,q.kind,q.account_label,q.alias||null,q.stale,q.windows.map(w=>w.pct).join('/'),q.weekly['24h'].used_pp,q.weekly['1h'].used_pp])}));
 assert.deepEqual(shape(phone),shape(site));
 assert.deepEqual(phone.map(d=>d.name),['MacBook Pro','Mac mini','Workstation']);
 // Accounts are numbered the way the desktop numbers them, and the alias replaces a number.
 assert.deepEqual(accountTags(phone),{'demo-claude-4f1c2a':'1','demo-claude-9b07e3':'Studio','demo-codex-61d8f0':'1','demo-codex-c2a957':'2'});
 // An English screen shows no Korean, and the conversation follows the language too.
 const english=JSON.stringify([demoDevices((en)=>en),demoThread('s1','en')]);
 assert.equal(/[가-힣]/.test(english.replace(/"label":"주간"/g,'')),false);
 // The conversation demo opens as on the web and the desktop: the same messages in each language, a
 // photo listed by name, and nothing being answered.
 const {earlierMessages}=await import('../../site/src/demo-model.js'),{demoMailbox}=await import('../../scripts/demo-state.mjs');
 for(const lang of ['ko','en','zh']){
  const web=earlierMessages('s1',at,lang).map(({changed,reply_at,...m})=>({...m,...(reply_at===null?{}:{reply_at})}));
  assert.deepEqual(demoThread('s1',lang),web,lang);
  assert.deepEqual(demoMailbox('s1',at,lang),earlierMessages('s1',at,lang),lang);
 }
 // The web relay lists them in the page's language (Korean without a page).
 assert.deepEqual(await demoRelay({demoNow:at}).mailbox({session_id:'s1'}),earlierMessages('s1',at,'ko').map(({changed,...m})=>m));
 assert.deepEqual(demoThread('s1','ko').map(m=>m.status),['replied','replied','delivery_unconfirmed']);
 assert.ok(demoThread('s1','ko').every(m=>!m.activity));
 assert.deepEqual(demoThread('s1','ko').flatMap(m=>(m.attachments||[]).map(a=>a.name)),['receipt.png']);
 assert.deepEqual(demoThread('s3','ko'),[]);
 setDemoNow(null);
});

test('a demo held for filming shows its moment on every screen, and only while the demo is on screen',async()=>{
 const {holdDemo,showingDemo,now}=await import('../src/clock.ts'),{fresh}=await import('../src/metrics.ts'),{reportAge,resetIn}=await import('../src/i18n.ts');
 const at=1_800_000_000,en=(e)=>e;setDemoNow(at);showingDemo(true);
 const devices=demoDevices(),quotas=devices.flatMap(d=>d.snapshot.account_quotas);
 assert.equal(now(),at*1000);
 assert.ok(devices.every(d=>fresh({...d,online:true})),'held demo computers are online');
 assert.equal(reportAge(quotas.find(q=>q.id==='demo-codex-61d8f0').updated,en),'38m ago');
 assert.equal(resetIn(quotas.find(q=>q.id==='demo-claude-4f1c2a').windows[0].reset,en),resetIn(at+7400,en,at));
 // Signed in, the screens take the phone's clock even with a hold left from a QA link.
 showingDemo(false);assert.ok(Math.abs(now()-Date.now())<1000);
 holdDemo(null);setDemoNow(null);
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
 const byKind={};for(const s of sessions)byKind[s.kind]=(byKind[s.kind]||0)+(s.windows['24h']||[]).reduce((a,b)=>a+b,0);
 const all=Object.values(byKind).reduce((a,b)=>a+b,0);
 assert.ok(byKind.Claude/all>.6&&byKind.Codex/all<.35,JSON.stringify(byKind));
});

test('limit windows are named from their key in the chosen language',()=>{
 const ko=(en,k)=>k;
 assert.equal(windowName({key:'5h',label:'5H'},ko),'5시간');
 assert.equal(windowName({key:'7d',label:'주간'},(en)=>en),'Weekly');
 assert.equal(windowName({key:'5h',label:'5H'},(en,k)=>translate('zh',en,k)),'5小时');
});

test('phone demo limits follow the web demo rules and give the web model values',async()=>{
 const {machines:webMachines,accounts:webAccounts}=await import('../../site/src/demo-model.js');
 // Over a week of start times: an account's sessions add up to no more than its period use, which grows
 // 1h ≤ 5h ≤ 24h, stays below the weekly percent, and is a plausible part of it.
 for(let k=0;k<28;k++){const anchor=1_793_200_000+k*21600,devices=demoDevices(undefined,anchor+600,anchor),sessions=devices.flatMap(d=>d.snapshot.sessions);
  for(const q of new Map(devices.flatMap(d=>d.snapshot.account_quotas).map(q=>[q.id,q])).values()){
   const week=q.windows.find(w=>w.key==='7d').pct,[h1,h5,day]=['1h','5h','24h'].map(p=>q.weekly[p].used_pp);
   for(const p of ['1h','5h','24h'])assert.ok(sessions.filter(s=>s.weekly_account===q.id).reduce((n,s)=>n+s.weekly_estimate[p].used_pp,0)<=q.weekly[p].used_pp+1e-3,q.id+' '+p);
   assert.ok(h1<=h5+1e-9&&h5<=day+1e-9&&day<=week+.05,q.id+' at '+k);
   // Limits are whole percent, as providers report them.
   assert.ok(q.windows.every(w=>Number.isInteger(w.pct)),q.id+' whole percent at '+k);
   assert.ok(day/week>=.05&&day/week<=.5,q.id+' day share '+(day/week).toFixed(2)+' at '+k);
  }
  // The web model gives the same limits.
  const web=webAccounts(webMachines(anchor+600,anchor),anchor+600,anchor);
  for(const q of new Map(devices.flatMap(d=>d.snapshot.account_quotas).map(q=>[q.id,q])).values()){const w=web.find(a=>a.id===q.id);
   assert.deepEqual(q.windows.map(x=>x.pct),[...(w.five!==null?[w.five]:[]),w.weekly],q.id+' at '+k);}
 }
});
