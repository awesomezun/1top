// The phone copy of site/src/demo-usage.js: keep the two (and ios/OneTop/Model/DemoUsage.swift) the same.
// Demo token use with the shape of real use: work comes in bursts with short pauses, some hours rest
// completely, a minute's tokens have a long tail, and one session carries most of the load. Every
// number comes from a hash of (seed, time, slot), so the same seed gives the same minutes on every
// device and the past never changes as time goes on. Only + - * / and table lookups are used, so the
// phones' copies (mobile/src/demo-usage.ts, ios/OneTop/Model/DemoUsage.swift) give the same numbers;
// UNIT_CHECK below is asserted by all three test suites.
//
// Tables are inverse distribution functions as [probability, value] points, from one computer's
// collector over a working day (1-minute bins): 66% of minutes active; active runs median 4 min,
// p90 31, max 135; pauses median 1.5 min, p90 9; an active minute p10 0.22×, p90 3×, p99 5× its median.
type Table=[number,number][];
const RUN:Table=[[0,1],[.5,5],[.9,31],[.99,90],[1,135]];
const PAUSE:Table=[[0,1],[.5,1.5],[.9,9],[.98,30],[1,60]];
const AMOUNT:Table=[[0,.05],[.1,.22],[.5,1],[.9,3.04],[.99,4.99],[1,7.07]];
// Hours of complete rest in each 6-hour block, and how busy a working hour is.
const REST:Table=[[0,0],[.5,0],[.75,1.99],[.88,2.99],[.96,4.99],[1,5.99]];
const LEVEL:Table=[[0,.15],[.2,.5],[.5,1],[.85,1.5],[1,2.2]];
// How many of a working hour's active minutes stay: some hours are dense, some scattered.
const DENSITY:Table=[[0,.45],[.3,.8],[.6,1],[1,1]];
// How a session's share of its computer moves from hour to hour, so the busiest one changes.
const SHARE:Table=[[0,.1],[.3,.5],[.7,1.2],[1,2.5]];
const BLOCK=360;
/** Fresh input, cache reads, cache writes and output, as a collector reports them. */
export const MIX=[.005,.981,.009,.005];
export const UNIT_CHECK:[number,number,number][]=[[7,0,0],[7,29880000,5],[1234567,123,456],[42,99,100]];

/** A number in [0, 1) from three whole numbers. */
export function unit(seed:number,a:number,b:number):number{
 let h=(seed^Math.imul(a,0x9E3779B1))>>>0;
 h=Math.imul(h^(h>>>16),0x85EBCA6B)>>>0;
 h=(h^Math.imul(b+0x632BE5AB,0xC2B2AE35))>>>0;
 h=Math.imul(h^(h>>>13),0x27D4EB2F)>>>0;
 return ((h^(h>>>16))>>>0)/4294967296;
}
export function quantile(u:number,table:Table):number{
 for(let i=1;i<table.length;i++)if(u<=table[i][0]){const p0=table[i-1][0],v0=table[i-1][1],p1=table[i][0],v1=table[i][1];return v0+(v1-v0)*(u-p0)/(p1-p0);}
 return table[table.length-1][1];
}

// Which minutes of a 6-hour block are active: runs and pauses one after another.
const blocks=new Map<string,Uint8Array>();
function blockRuns(seed:number,block:number):Uint8Array{
 const key=seed+':'+block;let on=blocks.get(key);if(on)return on;
 on=new Uint8Array(BLOCK);let m=0,k=0,active=unit(seed,block,4)<.7;
 while(m<BLOCK){const length=Math.max(1,Math.floor(quantile(unit(seed,block,100+k),active?RUN:PAUSE)+.5));
  if(active)on.fill(1,m,Math.min(BLOCK,m+length));m+=length;k++;active=!active;}
 if(blocks.size>256)blocks.clear();
 blocks.set(key,on);return on;
}
function resting(seed:number,hour:number,awake:[number,number]):boolean{
 if(hour>=awake[0]&&hour<awake[1])return false;
 const block=Math.floor(hour/6),length=Math.floor(quantile(unit(seed,block,1),REST)),start=Math.floor(unit(seed,block,2)*(7-length)),at=hour-block*6;
 return at>=start&&at<start+length;
}

/** One computer's tokens in each whole minute from first to last (inclusive). scale is the median
 *  tokens of an active minute. Hours in awake [from, to) never rest, so a demo opens on a working hour.
 *  rest seeds the resting hours: one person's computers share it and rest together. duty keeps that
 *  share of active minutes, for a computer that works less than the main one. */
export function computerMinutes(seed:number,scale:number,first:number,last:number,awake:[number,number]=[0,0],rest=seed,duty=1):number[]{
 const out:number[]=new Array(last-first+1).fill(0);
 for(let m=first;m<=last;m++){
  const hour=Math.floor(m/60),block=Math.floor(m/BLOCK);
  // Working hours thin out in 3-minute pieces; the hours the demo opens on are ordinary working hours.
  const dense=hour>=awake[0]&&hour<awake[1]?.55+.3*unit(seed,hour,8):quantile(unit(seed,hour,8),DENSITY);
  if(!blockRuns(seed,block)[m-block*BLOCK]||resting(rest,hour,awake)||unit(seed,Math.floor(m/3),7)>=duty*dense)continue;
  out[m-first]=scale*quantile(unit(seed,hour,3),LEVEL)*quantile(unit(seed,m,5),AMOUNT);
 }
 return out;
}

/** The minutes of the last day (and a quarter hour more, for 15-minute bins) among a computer's sessions.
 *  streams: [{weight, start, stop}] in seconds; a session takes part from start until stop. Each active
 *  minute goes to one session, picked by its share, as one agent at a time does most of the work.
 *  anchor is when the demo began: with awake, the hours around it never rest. rest and duty are as in
 *  computerMinutes. span is how many minutes before the current one to cover (a weekly window needs more
 *  than a day). The current minute counts for the part of it that has passed. */
export type Stream={weight:number,start:number,stop:number};
export type Usage={first:number,last:number,minutes:number[][]};
export function usage(seed:number,scale:number,streams:Stream[],now:number,anchor:number,rest=seed,duty=1,awake=true,span=1455):Usage{
 const last=Math.floor(now/60),first=last-span,anchorHour=Math.floor(anchor/3600);
 const total=computerMinutes(seed,scale,first,last,awake?[anchorHour-1,anchorHour+1]:[0,0],rest,duty),part=(now-last*60)/60;
 const minutes:number[][]=streams.map(()=>new Array(total.length).fill(0));
 let hour:number|null=null,shares:number[]=[];
 for(let i=0;i<total.length;i++){
  const m=first+i,t=m*60;if(!total[i])continue;
  if(Math.floor(m/60)!==hour){const h=Math.floor(m/60);hour=h;shares=streams.map((s,j)=>s.weight*quantile(unit(seed,h,10+j),SHARE));}
  let sum=0;for(let j=0;j<streams.length;j++)if(t>=streams[j].start&&t<streams[j].stop)sum+=shares[j];
  if(!sum)continue;
  let pick=unit(seed,m,6)*sum,chosen=-1;
  for(let j=0;j<streams.length;j++)if(t>=streams[j].start&&t<streams[j].stop){chosen=j;pick-=shares[j];if(pick<0)break;}
  minutes[chosen][i]=m===last?total[i]*part:total[i];
 }
 return {first,last,minutes};
}

/** A session's tokens from since to now, from usage() minutes. */
export function since(u:Usage,j:number,from:number):number{
 let n=0;const row=u.minutes[j];
 for(let i=0;i<row.length;i++)if((u.first+i)*60>=from)n+=row[i];
 return n;
}
/** Bins of step seconds over the last seconds, aligned to the clock as a collector aligns them:
 *  [{kind: tokens}] for the sessions' kinds. */
export function bins(u:Usage,kinds:(string|null)[],now:number,seconds:number,step:number):{start:number,end:number,bins:Record<string,number>[]}{
 const end=Math.floor(now/step)*step+step,start=end-seconds,count=seconds/step,out:Record<string,number>[]=Array.from({length:count},()=>({}));
 for(let j=0;j<kinds.length;j++){const row=u.minutes[j],kind=kinds[j];if(!kind)continue;
  for(let i=0;i<row.length;i++){if(!row[i])continue;const b=Math.floor(((u.first+i)*60-start)/step);if(b<0||b>=count)continue;out[b][kind]=(out[b][kind]||0)+row[i];}}
 return {start,end,bins:out.map(bin=>Object.fromEntries(Object.entries(bin).map(([k,v])=>[k,Math.round(v)])))};
}
export const vector=(n:number):[number,number,number,number]=>{const v=MIX.slice(0,3).map(f=>Math.round(n*f));return [v[0],v[1],v[2],Math.round(n)-v[0]-v[1]-v[2]];};
