/* Fixed duration stops; the slider never produces arbitrary minute counts. */
(function(root){
 'use strict';
 const presets={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
 const seconds=key=>presets[key]??(key.startsWith('custom:')?Number(key.slice(7)):null);
 const key=n=>Object.keys(presets).find(k=>presets[k]===n)||'custom:'+n;
 const stops=[600,900,1800,3600,7200,10800,18000,21600,43200,86400,172800,259200,604800,1209600,2592000,7776000,15552000,31536000].map(key).concat('all');
 function fromPosition(value){return stops[Math.max(0,Math.min(stops.length-1,Math.round(Number(value)||0)))];}
 function position(selected){if(selected==='all')return stops.length-1;const n=seconds(selected)||600;return stops.slice(0,-1).reduce((best,k,i)=>Math.abs(Math.log(seconds(k)/n))<Math.abs(Math.log(seconds(stops[best])/n))?i:best,0);}
 function label(selected,language='ko'){
  if(selected==='all')return language==='en'?'All history':language==='zh'?'全部记录':'전체 기록';
  const n=seconds(selected),unit=selected==='24h'?3600:n%31536000===0?31536000:n%2592000===0?2592000:n%604800===0?604800:n%86400===0?86400:n%3600===0?3600:60;
  return (n/unit)+({ko:{60:'분',3600:'시간',86400:'일',604800:'주',2592000:'개월',31536000:'년'},en:{60:'m',3600:'h',86400:'d',604800:'w',2592000:'mo',31536000:'y'},zh:{60:'分钟',3600:'小时',86400:'天',604800:'周',2592000:'个月',31536000:'年'}}[language]||{})[unit];
 }
 function parse(value){
  const v=value.trim().toLowerCase();if(['all','all history','전체 기록','전체','全部记录'].includes(v))return 'all';
  const m=v.match(/^(\d+(?:\.\d+)?)\s*(m|min|minutes?|분|分钟|h|hr|hours?|시간|小时|d|days?|일|天|w|weeks?|주|周|mo|months?|개월|个月|y|years?|년|年)$/);if(!m)return null;
  const unit=/^(m|min|minutes?|분|分钟)$/.test(m[2])?60:/^(h|hr|hours?|시간|小时)$/.test(m[2])?3600:/^(d|days?|일|天)$/.test(m[2])?86400:/^(w|weeks?|주|周)$/.test(m[2])?604800:/^(mo|months?|개월|个月)$/.test(m[2])?2592000:31536000;
  const n=Math.floor(Number(m[1])*unit/60)*60;
  return Number.isSafeInteger(n)&&n>=600&&n<=8e12?key(n):null;
 }
 const api={seconds,key,stops,fromPosition,position,label,parse};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopRanges=api;
})(typeof window==='undefined'?globalThis:window);
