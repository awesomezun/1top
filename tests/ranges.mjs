import assert from 'node:assert/strict';
import range from '../agent/onetop/dist/ranges.js';
for(const [text,key] of [['30분','30m'],['36시간','custom:129600'],['7일','custom:604800'],['1.5h','custom:5400'],['36 hours','custom:129600'],['7天','custom:604800'],['전체 기록','all'],['all history','all'],['全部记录','all'],['3650d','custom:315360000']])assert.equal(range.parse(text),key);
for(const text of ['9분','-1h','NaN','<script>','1000000000000d','24'])assert.equal(range.parse(text),null);
const expected=[600,900,1800,3600,7200,10800,18000,21600,43200,86400,172800,259200,604800,1209600,2592000,7776000,15552000,31536000];
assert.deepEqual(range.stops.slice(0,-1).map(range.seconds),expected);
for(let p=0;p<=18;p++)assert.equal(range.position(range.fromPosition(p)),p);
for(let p=0;p<=18;p+=.01){
 const selected=range.fromPosition(p);
 assert.ok(selected==='all'||expected.includes(range.seconds(selected)));
 assert.ok(!['custom:9240','custom:8040'].includes(selected));
}
assert.equal(range.fromPosition(0),'10m');
assert.equal(range.fromPosition(18),'all');
assert.equal(range.fromPosition(1000),'all');
// A saved/typed custom duration stays readable; moving the thumb snaps to a fixed stop.
assert.equal(range.label('custom:9240','ko'),'154분');
assert.ok(range.stops.includes(range.fromPosition(range.position('custom:9240'))));
for(const language of ['ko','en','zh'])for(const selected of range.stops)assert.equal(range.parse(range.label(selected,language)),selected);
assert.equal(range.label('custom:129600','ko'),'36시간');
assert.equal(range.label('custom:604800','en'),'1w');
assert.equal(range.label('custom:5400','zh'),'90分钟');
console.log('Duration slider: fixed stops only, exact keyboard steps, no arbitrary minutes, endpoints and localized entry passed.');
