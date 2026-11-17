import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire,register} from 'node:module';
// The app imports its modules without extensions, as Metro allows; let Node find the .ts files. SecureStore is native,
// so here the phone's store is the Map in globalThis.secureStore.
const secureStore='data:text/javascript,'+encodeURIComponent('export const getItemAsync=async k=>globalThis.secureStore.get(k)??null,setItemAsync=async(k,v)=>{globalThis.secureStore.set(k,v);};');
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){if(s==='expo-secure-store')return {url:${JSON.stringify(secureStore)},shortCircuit:true};if(s.startsWith('.')&&!/\\.[a-z]+$/.test(s)){try{return await n(s+'.ts',c);}catch{}}return n(s,c);}`));
const L=await import('../src/layout.ts'),store=await import('../src/layout-store.ts');
const web=createRequire(import.meta.url)('../../agent/onetop/dist/layout.js');
// The file the web, the Mac and the iPhone check too (tests/layout.mjs), read where it is.
const cases=JSON.parse(readFileSync(new URL('../../tests/fixtures/layout_v1.json',import.meta.url),'utf8'));

test('every stored case reads to exactly its expected layout, keys in the same order',()=>{
 assert.ok(cases.length>=36,'all the stored cases');
 for(const c of cases){const got=L.read(c.raw,c.legacy);assert.deepEqual(got,c.expect,c.name);assert.equal(JSON.stringify(got),JSON.stringify(c.expect),c.name);}
});

test('nothing stored reads as the defaults; what is written reads back the same, word for word',()=>{
 for(const raw of [null,undefined,''])assert.deepEqual(L.read(raw),{layout:L.defaults(),locked:false});
 assert.notEqual(L.defaults().presets.cluster.order,L.defaults().presets.cluster.order,'each call its own copy');
 for(const c of cases){
  const text=L.write(c.expect.layout);assert.equal(text,JSON.stringify(c.expect.layout),c.name);
  assert.deepEqual(L.read(text),{layout:c.expect.layout,locked:false},c.name);assert.equal(L.write(L.read(text).layout),text,c.name);
 }
});

// Beyond the stored cases: every value of every stored layout swapped for an odd one, or dropped, reads as the web reads it.
test('any layout reads exactly as the web reads it',()=>{
 const ODD=[undefined,null,-2.5,-0.5,0.5,1.5,2.5,3,5,7,1e9,'2','x','auto',true,[],{},['map','map','x','sessions'],{v:1,size:1,count:null}];
 const paths=(v,at=[])=>v&&typeof v==='object'?[at,...Object.keys(v).flatMap(k=>paths(v[k],[...at,k]))]:[at];
 const put=(v,[k,...rest],x)=>{if(k===undefined)return x;const c=Array.isArray(v)?[...v]:{...v};if(x===undefined&&!rest.length)delete c[k];else c[k]=put(v?.[k],rest,x);return c;};
 const json=s=>{try{return JSON.parse(s);}catch{return null;}};
 const seeds=[...new Set(cases.flatMap(c=>[c.raw,JSON.stringify(c.expect.layout)]))].map(json).filter(v=>v&&typeof v==='object');
 let n=0;
 for(const seed of seeds)for(const at of paths(seed))for(const x of ODD){
  const changed=put(seed,at,x),text=JSON.stringify(changed);if(text===undefined)continue;
  assert.equal(JSON.stringify(L.read(text)),JSON.stringify(web.read(text)),text);n++;
  // The same changes as the web dashboard's own saved panels, taken over when nothing is stored.
  if(at[0]==='wide'&&at[1]==='dashboard'){const legacy={dashboard:JSON.stringify(changed.wide?.dashboard),quickCluster:x};assert.equal(JSON.stringify(L.read(null,legacy)),JSON.stringify(web.read(null,legacy)),JSON.stringify(legacy));n++;}
 }
 assert.ok(n>10000,`${n} layouts`);
});

test('the phone keeps the layout in SecureStore under the web key and never writes over a newer version',async()=>{
 assert.match(L.KEY,/^[\w.-]+$/,'a key SecureStore accepts');assert.equal(L.KEY,web.KEY);
 const memory=globalThis.secureStore=new Map();
 assert.deepEqual(await store.load(),{layout:L.defaults(),locked:false});
 const state=await store.load();state.layout.tabs='one';state.layout.presets.cluster.hidden=[];
 assert.equal(await store.save(state),true);assert.equal(memory.get(L.KEY),L.write(state.layout));assert.deepEqual(await store.load(),state);
 memory.set(L.KEY,'{"v":2,"tabs":"one"}');const newer=await store.load();
 assert.deepEqual(newer,{layout:L.defaults(),locked:true});assert.equal(await store.save(newer),false);assert.equal(memory.get(L.KEY),'{"v":2,"tabs":"one"}');
 // A store that cannot be read or written reads as the defaults and saves nothing.
 globalThis.secureStore=null;assert.deepEqual(await store.load(),{layout:L.defaults(),locked:false});assert.equal(await store.save(state),false);
});
