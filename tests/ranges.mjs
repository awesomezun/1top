import assert from 'node:assert/strict';
import range from '../agent/onetop/dist/ranges.js';
for(const [text,key] of [['30분','30m'],['36시간','custom:129600'],['7일','custom:604800'],['1.5h','custom:5400'],['36 hours','custom:129600'],['7天','custom:604800'],['전체 기록','all'],['all history','all'],['全部记录','all'],['3650d','custom:315360000']])assert.equal(range.parse(text),key);
for(const text of ['9분','-1h','NaN','<script>','1000000000000d','24'])assert.equal(range.parse(text),null);
for(const max of [86400,7*86400,3650*86400]){
 let previous=0;
 for(let p=0;p<1000;p++){
  const key=range.fromPosition(p,max),seconds=range.seconds(key);
  assert.ok(seconds>=600&&seconds>=previous&&seconds<=max);previous=seconds;
 }
 assert.equal(range.fromPosition(0,max),'10m');
 assert.equal(range.fromPosition(1000,max),'all');
 assert.equal(range.position('all',max),1000);
 assert.equal(range.position('10m',max),0);
 assert.equal(range.seconds(range.fromPosition(999,max)),max);
}
assert.equal(range.maximum(1000,900,'custom:315360000'),315360000);
assert.equal(range.label('custom:129600','ko'),'36시간');
assert.equal(range.label('custom:604800','en'),'7d');
assert.equal(range.label('custom:5400','zh'),'90分钟');
console.log('Duration slider: monotonic minute-rounded scale, endpoints, large ranges, localized entry and validation passed.');
