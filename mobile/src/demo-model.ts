// The phone copy of site/src/demo-model.js: the demo world's numbers at a moment, the same steps the web
// demo and the desktop demo collector take (mobile/test/parity.test.mjs compares them). The world itself
// is demo-world.ts, written from site/src/demo-world.js by scripts/demo-world.mjs.
import {usage,vector,type Stream,type Usage} from './demo-usage';

type Vector=[number,number,number,number];
export type DemoWorld={
 rest:number;
 computers:{id:string;name:string;platform:string;seed:number;scale:number;duty:number;control:boolean;cores:number;memory:number;used:number;cpu:[number,number];
  network:{interfaces:string[];rx:[number,number];tx:[number,number]};disk:{total:number;free:number;read:number;write:number}}[];
 accounts:{key:string;id:string;kind:string;email:string;alias?:string;plan:string;per:number;reset:number;five?:{reset:number;factor:number};source?:string;stale?:number;status?:string}[];
 // [computer, id, kind, project, model, status, account, weight, app, title, effort]
 sessions:[number,string,string,string,string|null,string,string|null,number,string,string,string|null][];
 children:[string,string,number,string][];
 earlier:[number,string,string|null,string|null,string,number][];
 noReplies:string[];
 operations:{installed_skills:number;observed_events:number;goals:{thread_id:string;runtime:string;status:string;tokens_used:number;time_used_seconds:number;session_connected:boolean;evidence:string}[]}[];
 caps:Record<string,string[]>;
};
export type Part=Stream&{id:string;kind:string;project:string;model:string|null;account:string|null;status?:string;row?:number;child?:{lead:string;name:string;status:string};earlier?:boolean};
export type Machine={c:number;list:Part[];u:Usage;n:number;sum:(j:number,from:number,to?:number)=>number};

export const DAY=86400,WEEK=7*DAY,HISTORY_DAYS=90,STARTED=30*3600,WEEK_SPAN=8*1440+15;

/** A computer's streams: its shown sessions in world order, their subagents, then its earlier sessions. */
export function streams(world:DemoWorld,c:number,anchor:number):Part[]{
 const out:Part[]=[];
 world.sessions.forEach(([computer,id,kind,project,model,status,account,weight],i)=>{
  if(computer!==c)return;
  const stop=status==='waiting'?anchor-(3+i)*60:status==='paused'?anchor-12*60:status==='idle'?anchor-(40+i*31)*60:Infinity;
  out.push({id,kind,project,model,account,weight,status,start:anchor-STARTED,stop,row:i});
 });
 for(const [lead,name,share,status] of world.children){const parent=out.find(s=>s.id===lead);if(!parent)continue;
  out.push({...parent,id:lead+'-'+name,weight:parent.weight*share,status,stop:status==='working'?parent.stop:Math.min(parent.stop,anchor-25*60),child:{lead,name,status}});}
 world.earlier.forEach(([computer,kind,account,model,project,weight],i)=>{
  if(computer===c)out.push({id:'earlier-'+i,kind,account,model,project,weight,start:anchor-HISTORY_DAYS*DAY,stop:anchor-STARTED,earlier:true});});
 return out;
}

/** A computer's minutes from span minutes before now, with sums over any stretch: sum(j, from, to). */
export function machine(world:DemoWorld,c:number,now:number,anchor:number,span=WEEK_SPAN):Machine{
 const computer=world.computers[c],list=streams(world,c,anchor);
 const u=usage(computer.seed,computer.scale,list,now,anchor,world.rest,computer.duty,true,span),n=u.minutes[0].length;
 const cum=u.minutes.map(row=>{const s=new Float64Array(n+1);for(let i=0;i<n;i++)s[i+1]=s[i]+row[i];return s;});
 const at=(t:number)=>Math.min(n,Math.max(0,Math.ceil(t/60)-u.first));
 const sum=(j:number,from:number,to=Infinity)=>{const a=at(from),b=to===Infinity?n:at(to);return b>a?cum[j][b]-cum[j][a]:0;};
 return {c,list,u,n,sum};
}

export function machines(world:DemoWorld,now:number,anchor:number):Machine[]{
 return world.computers.map((_,c)=>machine(world,c,now,anchor));
}

/** A session's numbers: tokens over each period, its recent rate and its total since a day before the demo.
 *  A subagent's total starts where its lead's does, as the desktop demo collector counts it. */
export function sessionNumbers(m:Machine,j:number,now:number,anchor:number,keys:[string,number][]):{windows:Record<string,Vector>;rate:number;tokens:Vector}{
 const s=m.list[j],base=s.child?m.list.find(p=>p.id===s.child!.lead)!.weight:s.weight;
 return {windows:Object.fromEntries(keys.map(([key,seconds])=>[key,vector(m.sum(j,now-seconds))])),rate:Math.round(m.sum(j,now-600)/600),
  tokens:vector(base*5e7+m.sum(j,anchor-DAY))};
}

/** A computer's host at now: as busy as its last whole minute of tokens (the current one is partial). */
export function host(world:DemoWorld,m:Machine){
 const computer=world.computers[m.c],busy=Math.min(1,m.u.minutes.reduce((n,row)=>n+row[row.length-2],0)/(computer.scale*3));
 return {cpu:Math.round((computer.cpu[0]+computer.cpu[1]*busy)*10)/10,used_memory:Math.round(computer.used*2**30),total_memory:computer.memory*2**30,cores:computer.cores};
}

export type Limits=Omit<DemoWorld['accounts'][number],'five'>&{resetAt:number;start:number;reportAt:number;used:(from:number,to?:number)=>number;weekly:number;five:number|null;fiveReset:number|null};
/** Each account's limits over every computer it works on. Providers report limits in whole percent. */
export function accounts(world:DemoWorld,all:Machine[],now:number,anchor:number):Limits[]{
 const used=(key:string,from:number,to=Infinity)=>all.reduce((n,m)=>n+m.list.reduce((k,s,j)=>k+(s.account===key?m.sum(j,from,to):0),0),0);
 return world.accounts.map(a=>{
  const reset=anchor+a.reset,start=reset-WEEK,reportAt=a.stale?now-a.stale:now;
  return {...a,resetAt:reset,start,reportAt,used:(from:number,to?:number)=>used(a.key,from,to),
   weekly:Math.round(used(a.key,start,reportAt)*a.per),
   five:a.five?Math.min(100,Math.round(used(a.key,anchor+a.five.reset-5*3600,reportAt)*a.per*a.five.factor)):null,
   fiveReset:a.five?anchor+a.five.reset:null};
 });
}
