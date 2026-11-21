import {valid,type ClusterSession,type ClusterState,type Readings} from './cluster-model';

// The cluster's readings as the themes read them, the same figures cluster-themes.js figures() hands them on the
// dashboard: the scales the dials run to, the subject picked, the hottest computer, the trip, the four warnings, the
// window's sessions and the period's flow.
export type Figures=Record<string,unknown>;
const GEARS=['10m','30m','1h','5h','12h','24h'],SHORT:Record<string,string>={Claude:'Claude',Codex:'Codex',Antigravity:'Agy',GLM:'GLM'};
const SPAN:Record<string,number>={m:60,h:3600,d:86400,w:604800};
const seconds=(p:string)=>{const m=/^(\d+)([mhdw])$/.exec(p||'');return m?Number(m[1])*SPAN[m[2]]:3600;};
const short=(n:number)=>n>=1e9?(n/1e9).toFixed(1)+'B':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?Math.round(n/1e3)+'K':String(Math.round(n));
// The period in 24 slices of tokens, oldest first, from the minute events in the reports (zeros past them).
function flow(state:ClusterState,period:string,now:number){
 const span=seconds(period),start=now-span,bins=Array(24).fill(0) as number[];
 for(const e of state.events)if(e.t>=start&&e.t<=now&&valid(e.n))bins[Math.min(23,Math.floor((e.t-start)/span*24))]+=e.n;
 return bins;
}
export function figures(r:Readings,state:ClusterState,o:{now:number;odo:number|null;name:(s:ClusterSession)=>string}):Figures{
 const fuel=r.accounts.filter(a=>valid(a.left)).map(a=>({name:SHORT[a.kind]||a.kind||'',plan:a.plan||'',left:a.left as number,burn:valid(a.burn)?a.burn:0}));
 const counts={working:0,waiting:0,idle:0};for(const s of r.sessions)counts[s.state==='working'?'working':s.state==='waiting'?'waiting':'idle']++;
 const hot=r.heat.hottest,reach=r.speed.reach;
 return {period:r.period,gears:GEARS.includes(r.period)?GEARS.slice():[...GEARS,r.period],
  rate:valid(r.tach.rate)?r.tach.rate:0,rateMax:r.tach.full||200e6,tokens:r.tach.tokens||0,
  burn:valid(r.speed.value)?r.speed.value:0,burnMax:r.speed.max||20,cruise:valid(r.speed.cruise)?r.speed.cruise:null,
  heat:valid(r.heat.value)?r.heat.value:0,cpu:valid(hot?.cpu)?hot.cpu:0,mem:valid(hot?.memory)?hot.memory:0,
  fuel,fuelLeft:fuel.length?Math.round(fuel.reduce((n,f)=>n+f.left,0)/fuel.length):0,minLeft:fuel.length?Math.min(...fuel.map(f=>f.left)):0,
  rangeH:valid(reach.hours)?Math.min(99,reach.hours):null,
  odo:valid(o.odo)?o.odo:(r.tach.tokens||0),trip:valid(r.trip?.tokens)?r.trip.tokens:0,
  sessions:{...counts,total:r.sessions.length},
  list:r.sessions.slice(0,7).map(x=>({name:String(o.name(x.session)||x.kind||''),state:x.state==='working'||x.state==='waiting'?x.state:'idle',tok:short(x.tokens||0),tokens:x.tokens||0})),
  flow:flow(state,r.period,o.now),
  lamps:{waiting:r.tells.waiting.length,reconnect:r.tells.reconnect.length,empty:r.tells.empty.length,late:r.tells.fresh?0:1},
  clock:new Date(o.now*1000).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}),temp:''};
}
// Before the cluster has drawn: the dials at rest.
export const REST:Figures={period:'1h',gears:GEARS,rate:0,rateMax:200e6,tokens:0,burn:0,burnMax:20,cruise:null,heat:0,cpu:0,mem:0,fuel:[],fuelLeft:0,minLeft:0,rangeH:null,odo:0,trip:0,
 sessions:{working:0,waiting:0,idle:0,total:0},list:[],flow:Array(24).fill(0),lamps:{waiting:0,reconnect:0,empty:0,late:0},clock:'',temp:''};

