/* Usage history for the usage-map view: token trends by model and project, and usage heatmaps.
   Data comes from GET /api/history (docs/handoffs/usage-history-contract_v1.0.0.md). */
(function(root){
 'use strict';
 const DAY=86400;
 // Trend bin for the selected period, as in the contract's table.
 const step=seconds=>seconds<=3600?'60':seconds<=6*3600?'300':seconds<=DAY?'900':seconds<=7*DAY?'3600':seconds<=120*DAY?'day':'week';
 const stepLabel=s=>({'60':'1분 단위','300':'5분 단위','900':'15분 단위','3600':'1시간 단위',day:'1일 단위',week:'1주 단위'})[s]||'';
 const sum=values=>values.reduce((n,v)=>n+(v||0),0);
 // The top rows by period total; the rest, with the server's own folded row, become one "other" row.
 function fold(rows,count=5){
  const ranked=rows.filter(r=>r.key!=='__other__').map(r=>({...r,total:sum(r.tokens)})).filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
  const rest=[...ranked.slice(count),...rows.filter(r=>r.key==='__other__')],length=rows[0]?.tokens.length||0;
  if(!rest.length)return {shown:ranked.slice(0,count),other:null};
  const tokens=Array.from({length},(_,i)=>rest.every(r=>r.tokens[i]==null)?null:sum(rest.map(r=>r.tokens[i])));
  const folded=rest.reduce((n,r)=>n+(r.key==='__other__'?r.folded||0:1),0);
  return {shown:ranked.slice(0,count),other:tokens.some(v=>v>0)?{key:'__other__',folded,tokens,total:sum(tokens)}:null};
 }
 // Colour slots that stay with an entity across refreshes: survivors keep theirs, newcomers take
 // the lowest free slot in rank order.
 function slots(previous,keys,count=5){
  const out={},used=new Set();
  for(const k of keys){const s=previous?.[k];if(Number.isInteger(s)&&s<count&&!used.has(s)){out[k]=s;used.add(s);}}
  for(const k of keys)if(out[k]===undefined){let s=0;while(used.has(s))s++;out[k]=s;used.add(s);}
  return out;
 }
 // Monday-first weekday of a local "YYYY-MM-DD" date.
 const weekday=date=>{const [y,m,d]=date.split('-').map(Number);return (new Date(y,m-1,d).getDay()+6)%7;};
 // Weekday × hour: the average over the days each cell was on record, and how many of them had use.
 function weekHours(hours){
  const cells=Array.from({length:7},()=>Array.from({length:24},()=>({sum:0,days:0,used:0})));
  for(const [date,hour,value] of hours){if(value==null||!(hour>=0&&hour<24))continue;const c=cells[weekday(date)][hour];c.sum+=value;c.days++;if(value>0)c.used++;}
  return cells.map(row=>row.map(c=>c.days?{value:c.sum/c.days,days:c.days,used:c.used}:null));
 }
 // The last 53 Monday-first weeks ending this week, as columns of seven days, with each month's
 // first column. Days before the record are null (no record); days after today are future.
 function year(days,todayKey){
  const values=new Map(days.map(([d,v])=>[d,v])),first=days.length?days[0][0]:todayKey,[y,m,d]=todayKey.split('-').map(Number);
  const today=new Date(y,m-1,d),start=new Date(y,m-1,d-((today.getDay()+6)%7)-52*7),key=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
  const weeks=[],months=[];
  for(let w=0;w<53;w++){const col=[];for(let i=0;i<7;i++){const day=new Date(start.getFullYear(),start.getMonth(),start.getDate()+w*7+i),k=key(day);
    col.push({date:k,day:day.getDate(),future:k>todayKey,value:k>todayKey?undefined:k<first?null:values.has(k)?values.get(k):null});
    if(day.getDate()===1)months.push({week:w,month:day.getMonth()+1});}
   weeks.push(col);}
  return {weeks,months};
 }
 // Five equal classes of the largest value, so a busy hour stands out. Measured zero is its own class.
 const level=(value,max)=>value==null?null:!(value>0)||!(max>0)?0:Math.max(1,Math.min(5,Math.ceil(5*value/max)));
 // Axis top for a stacked total: steps whose halves are round too (the middle guide shows max/2).
 const axisMax=peak=>{if(!(peak>0))return 1;const p=10**Math.floor(Math.log10(peak));return ([1,1.2,1.6,2,2.4,3,4,5,6,8,10].find(k=>k*p>=peak)||10)*p;};
 // Monotone cubic samples (Fritsch–Carlson) between equally spaced points. It never overshoots,
 // so non-negative values stay non-negative and stacked layers never cross.
 function smooth(values,samples=6){
  const n=values.length;if(n<2)return values.map((y,i)=>({x:i,y}));
  const d=values.slice(1).map((y,i)=>y-values[i]),m=values.map((_,i)=>i===0?d[0]:i===n-1?d[n-2]:d[i-1]*d[i]<=0?0:(d[i-1]+d[i])/2);
  for(let i=0;i<n-1;i++){if(d[i]===0){m[i]=0;m[i+1]=0;continue;}const a=m[i]/d[i],b=m[i+1]/d[i],s=a*a+b*b;if(s>9){const t=3/Math.sqrt(s);m[i]=t*a*d[i];m[i+1]=t*b*d[i];}}
  const out=[];
  for(let i=0;i<n-1;i++)for(let k=0;k<samples;k++){const t=k/samples,t2=t*t,t3=t2*t;
   out.push({x:i+t,y:Math.max(0,(2*t3-3*t2+1)*values[i]+(t3-2*t2+t)*m[i]+(-2*t3+3*t2)*values[i+1]+(t3-t2)*m[i+1])});}
  out.push({x:n-1,y:values[n-1]});
  return out;
 }
 // Runs of bins that are on record; null bins are outside the record and draw nothing.
 function runs(total){const out=[];let start=-1;total.forEach((v,i)=>{if(v!=null&&start<0)start=i;if(v==null&&start>=0){out.push([start,i-1]);start=-1;}});if(start>=0)out.push([start,total.length-1]);return out;}
 // Display names: model IDs keep their version, without the vendor prefix the tool colour already shows.
 const modelName=key=>key==='unknown'?'모델 미확인':String(key).replace(/\[1m\]/gi,'').replace(/^claude-/i,'').replace(/^gpt-/i,'GPT-');
 const projectName=row=>row.key==='unknown'?'프로젝트 미확인':/\/\.aside\/u\/[^/]+$/.test(row.key)||row.label==='0'?'Aside 기본 작업공간':row.label||row.key;
 const api={step,stepLabel,fold,slots,weekday,weekHours,year,level,axisMax,smooth,runs,modelName,projectName};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OneTopHistory=api;
})(typeof globalThis!=='undefined'?globalThis:this);
