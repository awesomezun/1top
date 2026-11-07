import assert from 'node:assert/strict';
import H from '../agent/onetop/dist/history.js';

assert.equal(H.step(3600),'60');
assert.equal(H.step(5*3600),'300');
assert.equal(H.step(86400),'900');
assert.equal(H.step(7*86400),'3600');
assert.equal(H.step(30*86400),'day');
assert.equal(H.step(400*86400),'week');

// Top rows by total; the tail and the server's folded row become one other row; empty rows drop.
const rows=[{key:'a',tokens:[1,2]},{key:'b',tokens:[5,5]},{key:'c',tokens:[0,0]},{key:'d',tokens:[null,1]},{key:'__other__',folded:7,tokens:[null,3]}];
const folded=H.fold(rows,2);
assert.deepEqual(folded.shown.map(r=>r.key),['b','a']);
assert.deepEqual(folded.other,{key:'__other__',folded:8,tokens:[null,4],total:4});
assert.equal(H.fold([{key:'a',tokens:[1]}],5).other,null);

// Survivors keep their slot; newcomers take the lowest free one.
assert.deepEqual(H.slots({a:2,b:0},['b','c','a']),{b:0,a:2,c:1});
assert.deepEqual(H.slots(null,['x','y']),{x:0,y:1});

// 2026-10-26 is a Monday.
assert.equal(H.weekday('2026-10-26'),0);
assert.equal(H.weekday('2026-11-01'),6);
const grid=H.weekHours([['2026-10-26',9,100],['2026-11-02',9,0],['2026-10-27',3,null]]);
assert.deepEqual(grid[0][9],{value:50,days:2,used:1});
assert.equal(grid[1][3],null);

// A year grid: 53 Monday-first weeks ending this week; before the record is null, after today future.
const y=H.year([['2026-10-27',5],['2026-10-28',7]],'2026-10-29');
assert.equal(y.weeks.length,53);
assert.ok(y.weeks.every(w=>w.length===7));
const last=y.weeks.at(-1);
assert.equal(last[0].date,'2026-10-26');
assert.equal(last[0].value,null);
assert.equal(last[1].value,5);
assert.equal(last[3].future,false);
assert.equal(last[4].future,true);
assert.ok(y.months.some(m=>m.month===10));
assert.equal(H.level(null,10),null);
assert.equal(H.level(0,10),0);
assert.equal(H.level(10,10),5);
assert.equal(H.level(0.01,10),1);
assert.equal(H.level(5,10),3);
assert.equal(H.axisMax(2.02e9),2.4e9);
assert.equal(H.axisMax(0),1);
assert.equal(H.axisMax(7e6),8e6);

// Monotone samples pass through the points and never dip below zero between them.
const samples=H.smooth([0,10,0,0,8],4);
assert.equal(samples[0].y,0);
assert.equal(samples.at(-1).y,8);
assert.ok(samples.every(p=>p.y>=0));
assert.ok(samples.filter(p=>p.x>2&&p.x<3).every(p=>p.y===0));

assert.deepEqual(H.runs([null,1,2,null,0]),[[1,2],[4,4]]);
assert.equal(H.modelName('claude-opus-5-5'),'opus-5-5');
assert.equal(H.modelName('gpt-6-astra'),'GPT-6-astra');
assert.equal(H.modelName('glm-5.3[1m]'),'glm-5.3');
assert.equal(H.projectName({key:'/Users/kang/.aside/u/0',label:'0'}),'Aside 기본 작업공간');
assert.equal(H.projectName({key:'/x/1top',label:'1top'}),'1top');
console.log('Usage history: trend bins, folding, sticky colours, weekday-hour averages, year grid, levels and monotone smoothing passed.');
