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
assert.equal(W.basis({calibration:{seconds:240,used_pp:1,tokens:3000000}}),'4분 기준 · 1% / 3,000,000 tokens');

const freshQuota={id:'a',stale:false};
// A five-hour selection with only 30 minutes observed uses that half hour.
const partialPeriod={used_pp:10,observed_seconds:1800,partial:true,period_seconds:18000};
assert.equal(W.accountBurn(partialPeriod,freshQuota),20);
assert.equal(W.accountBurn({...partialPeriod,partial:false},freshQuota),20);
assert.equal(W.accountBurn({used_pp:0,observed_seconds:120},freshQuota),0);
assert.equal(W.burn(20),'20%/시간');
assert.equal(W.burn(0),'0%/시간');
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

// A high absolute weekly usage must not flatten a small selected-period increase.
const lowIncrease=W.increaseTrend({history:[[100,89],[200,89.25],[300,89.5]]},100,300);
assert.deepEqual(lowIncrease.segments,[[{t:100,value:0},{t:200,value:.25},{t:300,value:.5}]]);
assert.equal(lowIncrease.max,.5);
assert.equal(lowIncrease.increase,.5);
assert.equal(lowIncrease.partial,false);

// Reset/correction differences are unknown, not negative spend or a joined line.
const resetTrend=W.increaseTrend({history:[[100,98],[200,99],[300,1],[400,3],[500,2],[600,2.5]]},100,600);
assert.deepEqual(resetTrend.segments,[
 [{t:100,value:0},{t:200,value:1}],
 [{t:300,value:1},{t:400,value:3}],
 [{t:500,value:3},{t:600,value:3.5}]
]);
assert.equal(resetTrend.max,3.5);
assert.equal(resetTrend.observedSeconds,300);
assert.equal(resetTrend.partial,true);

const gapTrend=W.increaseTrend({history:[[0,20],[120,21],[600,30],[720,31]]},0,720);
assert.equal(gapTrend.segments.length,2);
assert.equal(gapTrend.increase,2); // The unobserved nine-point change stays excluded.
assert.equal(gapTrend.observedSeconds,240);

const zeroTrend=W.increaseTrend({flow:[[100,200,0]],history:[[100,10],[200,20]]},100,200);
assert.equal(zeroTrend.hasData,true);
assert.equal(zeroTrend.max,0);
assert.equal(zeroTrend.partial,false);
assert.deepEqual(zeroTrend.segments,[[{t:100,value:0},{t:200,value:0}]]);
for(const account of [null,{flow:[]},{history:[[100,20]]},{flow:[],history:[[100,10],[200,20]]}]){
 const result=W.increaseTrend(account,100,200);
 assert.equal(result.hasData,false);assert.equal(result.partial,true);
}

// Never import or proportionally divide quota changes crossing a selected boundary.
const boundary=W.increaseTrend({flow:[[50,150,8],[150,250,2],[250,350,7]]},100,300);
assert.deepEqual(boundary.segments,[[{t:150,value:0},{t:250,value:2}]]);
assert.equal(boundary.increase,2);assert.equal(boundary.observedSeconds,100);
assert.equal(boundary.partial,true);
const flow={flow:[[300,400,1],[100,200,.5],[200,300,.25],[100,200,.5]]};
const frozen=JSON.stringify(flow);
assert.equal(W.increaseTrend(flow,100,400).increase,1.75);
assert.equal(JSON.stringify(flow),frozen); // Sorting and duplicate exclusion are pure.
assert.equal(W.increaseTrend({flow:[[0,301,10],[301,401,-1],[401,501,NaN],[501,601,1]]},0,601).increase,1);
assert.equal(W.increaseTrend({history:[[0,20],[100,NaN],[200,21]]},0,200).hasData,false);
assert.equal(W.increaseTrend({flow:[[0,100,1]]},100,0).hasData,false);
console.log('Increase trend: selected baseline, resets, gaps, zero, boundaries and finite scale passed.');

// Account totals know how much changed across a gap, not when it changed.
const completeGap=W.increaseTrend({increase_intervals:[[100,1180,4,false]],flow:[]},0,1200);
assert.equal(completeGap.increase,4);
assert.equal(completeGap.hasData,true);
assert.equal(completeGap.observedSeconds,1080);
assert.deepEqual(completeGap.segments,[[{t:100,value:0}],[{t:1180,value:4}]]);
assert.equal(completeGap.partial,true);
const uncertainReset=W.increaseTrend({increase_intervals:[[100,200,2,true],[200,300,1,false]],flow:[[200,300,1]]},100,300);
assert.equal(uncertainReset.increase,3);
assert.deepEqual(uncertainReset.segments,[[{t:100,value:0}],[{t:200,value:2},{t:300,value:3}]]);
assert.equal(uncertainReset.partial,true);
const corrections=W.increaseTrend({increase_intervals:[[100,200,null,true],[200,300,-2,true],[300,400,1,false]]},100,400);
assert.equal(corrections.increase,1);
assert.deepEqual(corrections.segments,[[{t:300,value:0},{t:400,value:1}]]);
assert.equal(W.increaseTrend({increase_intervals:[],flow:[[100,200,4]]},100,200).hasData,false);
assert.equal(W.increaseTrend({increase_intervals:[[0,150,5,true],[150,250,2,false],[250,400,7,false]]},100,300).increase,2);
assert.equal(W.increaseTrend({flow:[[100,1180,4]]},0,1200).hasData,false);
console.log('Complete interval trend: gap/reset totals match periods without drawing unknown timing.');

// The account graph shows absolute quota usage: 45 -> 100, while recent growth is 55.
const absolute=W.quotaTrend({usage_points:[[100,45,20000],[200,70,20000],[300,100,20000]],history:[[100,0],[300,55]]},100,300);
assert.deepEqual(absolute.segments,[[{t:100,value:45},{t:200,value:70},{t:300,value:100}]]);
assert.equal(absolute.last.value,100);assert.equal(absolute.max,100);assert.equal(absolute.min,45);
assert.equal(absolute.hasData,true);assert.deepEqual(absolute.gaps,[]);

// A 5m15 reporting interval still draws one continuous line using only actual points.
const usageGap=W.quotaTrend({usage_points:[[100,45,20000],[200,50,20000],[515,70,20000],[600,100,20000]]},100,600);
assert.deepEqual(usageGap.segments,[[{t:100,value:45},{t:200,value:50},{t:515,value:70},{t:600,value:100}]]);
assert.deepEqual(usageGap.gaps,[]);

// Reset cycles and reported corrections remain visible as ordinary changes in the line.
const quotaReset=W.quotaTrend({usage_points:[[100,90,1000],[200,95,1000],[600,98,2000],[700,5,2000],[800,10,2000]]},100,800);
assert.deepEqual(quotaReset.segments,[[{t:100,value:90},{t:200,value:95},{t:600,value:98},{t:700,value:5},{t:800,value:10}]]);
assert.deepEqual(quotaReset.gaps,[]);
assert.equal(W.quotaTrend({usage_points:[[100,10,2000],[200,15,2030]]},100,200).segments.length,1); // Provider reset timestamp jitter.

// Keep actual before-boundary points for canvas clipping, never manufacture 0 or a boundary sample.
const quotaBoundary=W.quotaTrend({usage_points:[[50,42,2000],[100,45,2000],[200,50,2000],[400,90,2000]]},150,300);
assert.deepEqual(quotaBoundary.segments,[[{t:100,value:45},{t:200,value:50}]]);
assert.equal(quotaBoundary.last.t,200);
assert.equal(W.quotaTrend({usage_points:[[100,45,2000]]},150,300).hasData,false);
const realZero=W.quotaTrend({usage_points:[[100,0,2000]]},100,300);
assert.equal(realZero.hasData,true);assert.equal(realZero.last.value,0);
assert.equal(W.quotaTrend({usage_points:[],history:[[100,40],[200,50]]},100,200).hasData,false);
assert.deepEqual(W.quotaTrend({history:[[100,20],[500,30]]},100,500).segments,[[{t:100,value:20},{t:500,value:30}]]);
assert.deepEqual(W.quotaTrend({history:[[100,20],[200,NaN],[300,30]]},100,300).segments,[[{t:100,value:20},{t:300,value:30}]]);
assert.equal(W.quotaTrend({usage_points:[[100,-1],[200,101],[300,null]]},100,300).hasData,false);
const immutablePoints={usage_points:[[200,15,2000],[100,10,2000]]},immutableJSON=JSON.stringify(immutablePoints);
W.quotaTrend(immutablePoints,100,200);assert.equal(JSON.stringify(immutablePoints),immutableJSON);
console.log('Absolute quota trend: true endpoint, continuous sampled line, reset/correction values, clipping, legacy data and real zero passed.');
