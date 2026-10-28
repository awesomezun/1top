/* Duration scale shared by the visible slider and direct text entry. */
(function(root){
 'use strict';
 const presets={'10m':600,'30m':1800,'1h':3600,'5h':18000,'12h':43200,'24h':86400};
 const seconds=key=>presets[key]??(key.startsWith('custom:')?Number(key.slice(7)):null);
 const key=n=>Object.keys(presets).find(k=>presets[k]===n)||'custom:'+n;
 function maximum(updated,started,selected){return Math.max(86400,Math.ceil(Math.max(0,(updated||0)-(started||updated||0))/86400)*86400,seconds(selected)||0);}
 function fromPosition(position,max){if(Number(position)>=1000)return 'all';return key(Math.max(600,Math.round(Math.exp(Math.log(600)+Number(position)/999*Math.log(max/600))/60)*60));}
 function position(selected,max){return selected==='all'?1000:Math.max(0,Math.min(999,Math.round(Math.log((seconds(selected)||600)/600)/Math.log(max/600)*999)));}
 function label(selected,language='ko'){
  if(selected==='all')return language==='en'?'All history':language==='zh'?'全部记录':'전체 기록';
  const n=seconds(selected),unit=n%86400===0?86400:n%3600===0?3600:60;
  return (n/unit)+({ko:{60:'분',3600:'시간',86400:'일'},en:{60:'m',3600:'h',86400:'d'},zh:{60:'分钟',3600:'小时',86400:'天'}}[language]||{60:'m',3600:'h',86400:'d'})[unit];
 }
 function parse(value){
  const v=value.trim().toLowerCase();if(['all','all history','전체 기록','전체','全部记录'].includes(v))return 'all';
  const m=v.match(/^(\d+(?:\.\d+)?)\s*(m|min|minutes?|분|分钟|h|hr|hours?|시간|小时|d|days?|일|天)$/);if(!m)return null;
  const unit=/^(m|min|minutes?|분|分钟)$/.test(m[2])?60:/^(h|hr|hours?|시간|小时)$/.test(m[2])?3600:86400;
  const n=Math.floor(Number(m[1])*unit/60)*60;
  return Number.isSafeInteger(n)&&n>=600&&n<=8e12?key(n):null;
 }
 const api={seconds,key,maximum,fromPosition,position,label,parse};
 if(typeof module!=='undefined')module.exports=api;else root.OneTopRanges=api;
})(typeof window==='undefined'?globalThis:window);
