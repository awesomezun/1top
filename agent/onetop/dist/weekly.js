/* Provider percentages and token-share estimates are separate measurements. */
(function(root){
 'use strict';
 const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const number=n=>!valid(n)?'—':n>0&&n<.01?'<0.01':Number(n.toFixed(2)).toLocaleString('ko-KR');
 const percent=n=>number(n)+(valid(n)?'%':'');
 const estimate=e=>valid(e?.used_pp)?'≈'+percent(e.used_pp):'측정 중';
 const weekly=q=>q?.windows?.find(w=>w.label==='주간');
 const explanation='계정의 주간 한도 증가량을 같은 구간에 관측된 세션 토큰 비중으로 배분한 추정입니다. 캐시·모델별 한도 가중치는 미반영이며, 다른 기기의 사용량이 섞일 수 있습니다. 계정이 다른 세션끼리 %를 더하지 않습니다.';
 const pending=(account,quota,tokens)=>!account?'계정 연결 필요':quota?.stale?'한도 조회 대기':tokens===0?'이 기간의 보고 토큰 없음':'다음 한도 보고 대기';
 const api={valid,number,percent,estimate,weekly,pending,explanation};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopWeekly=api;
})(typeof globalThis!=='undefined'?globalThis:this);
