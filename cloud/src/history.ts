import {num,str} from './metrics';
import {SPEED_SECONDS} from './protocol';
export function historyQuery(v:any){
 const period=v?.period??'1h',step=String(v?.step??'60'),kind=v?.kind;
 if(!(period==='all'||Object.hasOwn(SPEED_SECONDS,period))||!['60','300','900','3600','day','week'].includes(step)||
   (kind!=null&&!['Claude','Codex','GLM','Aside','Antigravity','Gemini','OpenCode'].includes(kind)))throw Error('Invalid history query');
 return {period:period as string,step,...(kind?{kind:kind as string}:{})};
}
export function historyData(v:any){
 const series=v?.series,n=series?.bins?.length;
 if(num(v?.as_of)===null||!Array.isArray(series?.bins)||n>400||!series.bins.every((x:any)=>num(x)!==null)||num(series.start)===null||num(series.end)===null)throw Error('Invalid history');
 const tokens=(a:any)=>{if(!Array.isArray(a)||a.length!==n||!a.every(x=>x===null||num(x)!==null))throw Error('Invalid history tokens');return a as (number|null)[];};
 const groups=(a:any,project=false)=>{
   if(!Array.isArray(a)||a.length>13)throw Error('Invalid history groups');
   return a.map(r=>{const key=str(r?.key,100);if(project&&!/^(project:[a-f0-9]{64}|unknown|__other__)$/.test(key))throw Error('Project path is not allowed');
     return {key,...(project?{label:str(r.label,100)}:{kind:str(r.kind,40)}),tokens:tokens(r.tokens),...(num(r.folded)!==null?{folded:num(r.folded)}:{})};});
 };
 const heat=(a:any,hours=false)=>{
   if(!Array.isArray(a)||a.length>(hours?750:36600))throw Error('Invalid heatmap');
   return a.map(r=>{if(!Array.isArray(r)||r.length!==(hours?3:2)||!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||
     (hours&&(!Number.isInteger(r[1])||num(r[1],23)===null))||(r.at(-1)!==null&&num(r.at(-1))===null))throw Error('Invalid heatmap cell');return [...r];});
 };
 if(!Array.isArray(v.coverage)||v.coverage.length>32)throw Error('Invalid coverage');
 return {as_of:v.as_of,coverage:v.coverage.map((r:any)=>({source:str(r.source,40),kind:r.kind==null?null:str(r.kind,40),from:num(r.from),to:num(r.to)})),
 series:{start:series.start,end:series.end,step:str(String(series.step),10),bins:[...series.bins],total:tokens(series.total),by_model:groups(series.by_model),by_project:groups(series.by_project,true)},
 heatmap:{hours:heat(v.heatmap?.hours,true),days:heat(v.heatmap?.days)}};
}
