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
assert.equal(W.pending('a',{stale:false},100),'환산 기준 수집 중');
assert.equal(W.pending('a',{stale:false},0),'이 기간의 보고 토큰 없음');

assert.equal(W.scope({basis:'calibrated_token_equivalent',calibration:{confidence:'early'}}),'환산 추정 · 초기 기준');
assert.equal(W.basis({calibration:{seconds:240,used_pp:1,tokens:3000000}}),'4분 기준 · 1%p / 3,000,000 tokens');

const freshQuota={id:'a',stale:false};
// A five-hour selection with only 30 minutes observed uses that half hour.
const partialPeriod={used_pp:10,observed_seconds:1800,partial:true,period_seconds:18000};
assert.equal(W.accountBurn(partialPeriod,freshQuota),20);
assert.equal(W.accountBurn({...partialPeriod,partial:false},freshQuota),20);
assert.equal(W.accountBurn({used_pp:0,observed_seconds:120},freshQuota),0);
assert.equal(W.burn(20),'20%p/시간');
assert.equal(W.burn(0),'0%p/시간');
assert.equal(W.burn(null),'—');
for(const p of [null,{used_pp:1,observed_seconds:119},{used_pp:1,observed_seconds:0},{used_pp:null,observed_seconds:600},{used_pp:-1,observed_seconds:600},{used_pp:Infinity,observed_seconds:600},{used_pp:1,observed_seconds:NaN}])assert.equal(W.accountBurn(p,freshQuota),null);
assert.equal(W.accountBurn(partialPeriod,{id:'a',stale:true}),null);
assert.equal(W.accountBurn(partialPeriod,null),null);
assert.equal(W.accountBurn(partialPeriod,{id:'a'}),null);

const calibrated={basis:'calibrated_token_equivalent',account_id:'a',calibration:{tokens:3000000,used_pp:1,seconds:240}};
assert.ok(Math.abs(W.sessionBurn(calibrated,1000,freshQuota)-1.2)<1e-12);
assert.equal(W.sessionBurn(calibrated,0,freshQuota),0);
for(const value of [null,undefined,-1,NaN,Infinity,'1000'])assert.equal(W.sessionBurn(calibrated,value,freshQuota),null);
for(const c of [{tokens:0,used_pp:1,seconds:240},{tokens:3000000,used_pp:0,seconds:240},{tokens:3000000,used_pp:1,seconds:119},{tokens:NaN,used_pp:1,seconds:240}])assert.equal(W.sessionBurn({...calibrated,calibration:c},1000,freshQuota),null);
assert.equal(W.sessionBurn(calibrated,1000,{id:'b',stale:false}),null);
assert.equal(W.sessionBurn(calibrated,1000,{id:'a',stale:true}),null);
assert.equal(W.sessionBurn(calibrated,1000,null),null);
assert.equal(W.sessionBurn({...calibrated,basis:'observed_share'},1000,freshQuota),null);
assert.equal(W.sessionBurn({...calibrated,calibration:{tokens:1,used_pp:1,seconds:240}},Number.MAX_VALUE,freshQuota),null);
console.log('Burn rate: observed duration, zero/missing, stale data, account isolation and finite estimates passed.');
