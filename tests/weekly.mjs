import assert from 'node:assert/strict';
import W from '../agent/onetop/dist/weekly.js';
assert.equal(W.estimate(null),'측정 중');
assert.equal(W.estimate({used_pp:0}),'≈0%');
assert.equal(W.estimate({used_pp:.001}),'≈<0.01%');
assert.equal(W.estimate({used_pp:.75}),'≈0.75%');
assert.equal(W.percent(null),'—');
assert.equal(W.percent(NaN),'—');
assert.equal(W.percent(100),'100%');
assert.equal(W.weekly({windows:[{label:'5H',pct:14},{label:'주간',pct:29}]}).pct,29);
console.log('Weekly presentation: unknown, observed zero, tiny estimates and weekly-only selection passed.');

assert.equal(W.pending(null,null,100),'계정 연결 필요');
assert.equal(W.pending('a',{stale:true},100),'한도 조회 대기');
assert.equal(W.pending('a',{stale:false},100),'다음 한도 보고 대기');
assert.equal(W.pending('a',{stale:false},0),'이 기간의 보고 토큰 없음');
