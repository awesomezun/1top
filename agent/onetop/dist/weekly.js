/* Provider percentages and token-share estimates are separate measurements. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const number=n=>!valid(n)?'—':n>0&&n<.01?'<0.01':Number(n.toFixed(2)).toLocaleString('ko-KR');
 const percent=n=>number(n)+(valid(n)?'%':'');
 const estimate=e=>valid(e?.used_pp)?'≈'+percent(e.used_pp):'측정 중';
 const weekly=q=>q?.windows?.find(w=>w.label==='주간');
 const explanation='선택 기간의 보고 토큰 × (기준 구간의 계정 한도 증가 %p ÷ 같은 구간의 관측 토큰)입니다. 현재 계정 기준의 참고용 환산이며 실제 차감량이 아닙니다. 모델·캐시 구성과 다른 기기의 사용에 따라 달라집니다. 과거 미귀속 토큰의 실제 결제 계정을 복원하지 않습니다.';
 const pending=(account,quota,tokens)=>!account?'계정 연결 필요':quota?.stale?'한도 조회 대기':tokens===0?'이 기간의 보고 토큰 없음':'환산 기준 수집 중';
 const duration=s=>s<60?'1분 미만':s<3600?Math.floor(s/60)+'분':Math.floor(s/3600)+'시간 '+Math.floor(s%3600/60)+'분';
 const scope=e=>e?.basis==='calibrated_token_equivalent'?'환산 추정'+(e.calibration?.confidence==='early'?' · 초기 기준':'')+(e.partial?' · 일부 토큰':''):'관측 구간 추정';
 const basis=e=>e?.calibration?`${duration(e.calibration.seconds)} 기준 · ${number(e.calibration.used_pp)}%p / ${Math.round(e.calibration.tokens).toLocaleString('ko-KR')} tokens`:'';
 const api={valid,number,percent,estimate,weekly,pending,explanation,duration,scope,basis};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopWeekly=api;
})(typeof globalThis!=='undefined'?globalThis:this);
