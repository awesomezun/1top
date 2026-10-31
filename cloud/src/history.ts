import {num,str} from './metrics';
import {SPEED_SECONDS} from './protocol';
export function historyQuery(v:any){
 const period=v?.period??'1h',step=String(v?.step??'60'),kind=v?.kind;
 if(v?.view==='sessions'){
  const offset=v.offset??0,limit=v.limit??100;
  if(!(period==='all'||Object.hasOwn(SPEED_SECONDS,period))||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid session page');
  return {view:'sessions',period:period as string,offset,limit};
 }
 if(!(period==='all'||Object.hasOwn(SPEED_SECONDS,period))||!['60','300','900','3600','day','week'].includes(step)||
   (kind!=null&&!['Claude','Codex','GLM','Aside','Antigravity','Gemini','OpenCode'].includes(kind)))throw Error('Invalid history query');
 return {period:period as string,step,...(kind?{kind:kind as string}:{})};
}
export function historyData(v:any){
 if(v?.view==='sessions')return sessionHistoryData(v);
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

function sessionHistoryData(v:any){
 const integer=(n:any)=>Number.isSafeInteger(n)&&n>=0;
 const vector=(a:any)=>{if(!Array.isArray(a)||a.length!==4||!a.every(x=>num(x)!==null))throw Error('Invalid session tokens');return [...a] as number[];};
 if(num(v.as_of)===null||num(v.start)===null||num(v.end)===null||!integer(v.session_count)||!integer(v.offset)||
   (v.next_offset!==null&&!integer(v.next_offset))||!Array.isArray(v.sessions)||v.sessions.length>200)throw Error('Invalid sessions');
 const ids=new Set<string>();
 const sessions=v.sessions.map((s:any)=>{
  if(typeof s?.id!=='string'||!s.id||s.id.length>200||ids.has(s.id)||!Array.isArray(s.models)||s.models.length>256||typeof s.listed!=='boolean')throw Error('Invalid session identity');
  ids.add(s.id);
  const models=s.models.map((m:any)=>({model:m.model==null?null:str(m.model,160),tokens:vector(m.tokens)})),tokens=vector(s.tokens);
  if(tokens.some((n,i)=>models.reduce((sum:number,m:any)=>sum+m.tokens[i],0)!==n))throw Error('Session models do not sum');
  return {id:s.id,kind:str(s.kind,40),title:s.title==null?null:str(s.title,200),project:s.project==null?null:str(s.project,100),
   app:s.app==null?null:str(s.app,80),model:s.model==null?null:str(s.model,160),identity_source:str(s.identity_source,40),
   listed:s.listed,tokens,models,first_usage:num(s.first_usage),last_usage:num(s.last_usage)};
 });
 return {view:'sessions',period:str(v.period,40),as_of:v.as_of,start:v.start,end:v.end,session_count:v.session_count,
  tokens:vector(v.tokens),offset:v.offset,next_offset:v.next_offset,sessions};
}
