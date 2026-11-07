// Customizing layout (agent/onetop/dist/layout.js, customizing-spec_v1.1.0): every case in tests/fixtures/layout_v1.json
// reads to exactly its expected layout; the Mac, the iPhone and Android check the same file.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),L=require('../agent/onetop/dist/layout.js');
const cases=JSON.parse(readFileSync(new URL('./fixtures/layout_v1.json',import.meta.url),'utf8'));
assert.ok(cases.length>=30,'at least 30 cases');
for(const c of cases)assert.deepEqual(L.read(c.raw,c.legacy),c.expect,c.name);
// Nothing stored reads as the defaults; what is written reads back the same, word for word.
assert.deepEqual(L.read(null).layout,L.defaults());
for(const c of cases){const text=L.write(c.expect.layout);assert.equal(L.write(L.read(text).layout),text,c.name);}
// A newer version is never written over.
const memory={};globalThis.localStorage={getItem:k=>memory[k]??null,setItem:(k,v)=>{memory[k]=v;}};
memory[L.KEY]='{"v":2}';const state=L.load();assert.equal(state.locked,true);assert.equal(L.save(state),false);assert.equal(memory[L.KEY],'{"v":2}');
delete memory[L.KEY];memory['onetop.quick.v1']='{"cluster":false}';assert.equal(L.load().layout.preset,'dashboard');
console.log(`Layout: ${cases.length} stored cases, defaults, round trips and the newer-version lock passed.`);
