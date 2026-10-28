import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../agent/onetop/dist/maps.js';
const M=globalThis.OneTopMaps;
const sessions=[{id:'a',kind:'Claude',project:'A',app:'Orca',windows:{'1h':[10,20,0,10]}},{id:'b',kind:'Codex',project:'B',app:'Orca',windows:{'1h':[10,10,0,0]}},{id:'c',kind:'Unknown',windows:{}},{id:'d',kind:'Claude',windows:{'1h':[0,0,0,0]}}];
const u=M.usage(sessions,'1h');assert.equal(u.total,60);assert.equal(u.known,3);assert.equal(u.unknown,1);assert.equal(u.zero,1);
assert.equal(M.usage(sessions,'1h','app').items[0].value,60);
assert.equal(M.usage([sessions[2]],'1h').total,null);assert.equal(M.usage([sessions[3]],'1h').total,0);
assert.equal(M.context({tokens:[999999,999999,999999,999999],model:'model-1m'}).available,false);
const c=M.context({context_usage:{basis:'last_request_input',input_tokens:40,capacity:100,parts:[10,30,0]}});
assert.equal(c.percent,40);assert.equal(c.items.find(x=>x.free).value,60);
assert.equal(M.context({request_input:40}).percent,null);
assert.equal(M.context({request_input:200,context_size:100}).over,true);
assert.equal(M.context({request_input:200,context_size:100}).items.some(x=>x.free),false);
for(let size=1;size<=60;size++){
 const input=Array.from({length:size},(_,i)=>({id:String(i),value:(i+1)**2})),total=input.reduce((n,x)=>n+x.value,0),out=M.layout(input,630,280);
 assert.equal(out.length,size);assert.ok(Math.abs(out.reduce((n,x)=>n+x.w*x.h,0)-630*280)<.0001);
 for(const tile of out){assert.ok(Math.abs(tile.w*tile.h/(630*280)-tile.value/total)<1e-9);assert.ok(tile.x>=0&&tile.y>=0&&tile.x+tile.w<=630.0001&&tile.y+tile.h<=280.0001);}
 for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++){const a=out[i],b=out[j];assert.ok(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)<1e-7||Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)<1e-7);}
}
const quiltInput=[28.5,24.8,19.3,13.2,6.6,4.2,3.4].map((value,i)=>({id:String(i),label:'Session '+i,value}));
const originalQuilt=JSON.stringify(quiltInput);
for(const [width,height] of [[1800,480],[960,240],[630,280],[480,630]]){
 const tiles=M.layout(quiltInput,width,height),total=quiltInput.reduce((n,x)=>n+x.value,0);
 assert.equal(tiles.length,quiltInput.length);
 assert.ok(Math.abs(tiles.reduce((n,x)=>n+x.w*x.h,0)-width*height)<1e-6);
 for(const tile of tiles){
  assert.ok(Math.abs(tile.w*tile.h/(width*height)-tile.value/total)<1e-9);
  assert.ok(tile.x>=0&&tile.y>=0&&tile.x+tile.w<=width+1e-7&&tile.y+tile.h<=height+1e-7);
 }
 for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++){
  const a=tiles[i],b=tiles[j];
  assert.ok(Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)<1e-7||Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y)<1e-7);
 }
 if(width>height*2){
  assert.ok(new Set(tiles.map(t=>Math.round(t.y*1e6))).size>=2);
  assert.ok(tiles.slice(0,4).every(t=>t.h<height-1));
  assert.ok(tiles.slice(0,4).some(t=>t.y>0));
 }
}
assert.equal(JSON.stringify(quiltInput),originalQuilt);
for(const f of ['maps.js','maps.css'])assert.deepEqual(fs.readFileSync(new URL('../agent/onetop/dist/'+f,import.meta.url)),fs.readFileSync(new URL('../site/src/'+f,import.meta.url)));
console.log('Map accounting, exact-area layout, unknown/zero cases, capacity guards and shared assets passed.');
