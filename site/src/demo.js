// Synthetic demonstration data. Never copy live machines into public assets.
// Built the way a real computer reports: per-minute token events become the session windows,
// period totals, cockpit flow and weekly-limit samples, in the shape the relay delivers.
const windows=[['24h','24h',86400],['12h','12h',43200],['5h','5h',18000],['1h','1h',3600],['30m','30m',1800],['10m','10m',600]];
const STOPS=[600,900,1800,3600,7200,10800,18000,21600,43200,86400,172800,259200,604800,1209600,2592000,7776000,15552000,31536000];
const PRESETS={600:'10m',1800:'30m',3600:'1h',18000:'5h',43200:'12h',86400:'24h'};
const examples=[
  ['website','Claude','Orca','Frontend','claude-sonnet-4-6',38],
  ['api-service','Codex','Orca','Backend','gpt-5.4',22],
  ['research','Codex','Aside','Research','gpt-5.4',13],
  ['docs','GLM','Visual Studio Code','Docs','glm-5',8],
  ['design-system','Claude','Cursor','Components','claude-sonnet-4-6',6],
  ['mobile-app','Codex','Terminal','Mobile','gpt-5.4',4],
  ['test-suite','Claude','Orca','Tests','claude-sonnet-4-6',3],
  ['data-pipeline','Codex','Visual Studio Code','Data','gpt-5.4',2],
  ['release-notes','GLM','Terminal','Release','glm-5',1.5],
  ['auth-service','Claude','Cursor','Auth','claude-sonnet-4-6',1.2],
  ['search-index','Codex','Aside','Search','gpt-5.4',.8],
  ['icon-library','Claude','Orca','Icons','claude-sonnet-4-6',.5],
];
// Each subscription account is reported by the computer it is signed in on; pp is weekly % per token.
const accounts={
  Claude:{id:'demo-claude-4f21a8',device:0,plan:'max',pct:61,pp:7e-7,five:[24,8040],reset:172800},
  Codex:{id:'demo-codex-9c03e2',device:1,plan:'pro',pct:72,pp:1.2e-6,reset:259200},
};
const HISTORY=36*60,FRESH=300,SAMPLE=120;
function vector(amount){const v=[Math.round(amount*.22),Math.round(amount*.63),Math.round(amount*.03)];return [...v,Math.round(amount)-v.reduce((a,b)=>a+b,0)];}
/** Tokens per minute, newest first. Working sessions report in the current minute; idle ones stopped earlier. */
function minutes(index,share){
  const idle=index<5?0:(index-4)*6,born=HISTORY-index*90;
  return Array.from({length:HISTORY},(_,k)=>{if(k<idle||k>=born)return 0;const p=k+index*37,wave=Math.max(.05,1+.6*Math.sin(p/9)*Math.cos(p/23));
    return Math.round(share*10000/60*wave*((k+index*11)%47<4?.2:1));});
}
const prefix=series=>series.reduce((sums,v)=>(sums.push(sums[sums.length-1]+v),sums),[0]);
export function demoDevices(){
  const now=Date.now()/1000,at=k=>now-5-k*60,newer=from=>Math.max(0,Math.min(HISTORY,Math.ceil((now-5-from)/60)));
  const all=examples.map(([project,kind,app,terminal,model,share],index)=>{const series=minutes(index,share);return {index,project,kind,app,terminal,model,series,sums:prefix(series)};});
  const since=(sums,seconds)=>sums[newer(now-seconds)];
  // Weekly % samples every two minutes, rising with every session on that account across computers.
  const weekly=Object.fromEntries(Object.entries(accounts).map(([kind,a])=>{
    const sums=prefix(Array.from({length:HISTORY},(_,k)=>all.reduce((n,s)=>n+(s.kind===kind?s.series[k]:0),0)));
    const points=Array.from({length:Math.ceil((86400+FRESH)/SAMPLE)},(_,j)=>{const t=now-30-j*SAMPLE;return [t,Math.round((a.pct-a.pp*sums[newer(t)])*100)/100,now+a.reset];}).reverse();
    const periods=Object.fromEntries(windows.map(([key,,seconds])=>{const use=points.filter(p=>p[0]>=now-seconds),covered=use.length>1?use[use.length-1][0]-use[0][0]:0;
      return [key,{used_pp:Math.round((use[use.length-1][1]-use[0][1])*1e4)/1e4,observed_seconds:covered,partial:covered<seconds-FRESH}];}));
    return [kind,{points,periods}];
  }));
  return ['MacBook Pro','Mac mini'].map((name,deviceIndex)=>{
    const mine=all.filter(s=>s.index%2===deviceIndex);
    const sessions=mine.map(({index,project,kind,app,terminal,model,series,sums})=>{const account=accounts[kind];return {
      id:'demo-session-'+index,control_key:'demo',kind,app,terminal,project,title:project+' · '+kind,model,
      status:series[0]>0?'working':'idle',tokens:vector(sums[HISTORY]),rate:series[0]/60,
      windows:Object.fromEntries(windows.map(([key,,seconds])=>[key,vector(since(sums,seconds))])),
      cpu:series[0]>0?7.4+index:.3,rss:(180+index*20)*2**20,
      capabilities:['focus','pause','terminate',...(app==='Orca'&&index>=5?['prompt','message','mailbox']:[])],
      context_usage:{basis:'last_request_input',input_tokens:64000+index*6000,capacity:kind==='Codex'?200000:null,parts:[12000+index*2000,48000+index*4000,4000],observed_at:now,model},
      weekly_account:account?.id||'',
      weekly_estimate:account?Object.fromEntries(windows.map(([key,,seconds])=>{const tokens=since(sums,seconds);
        return [key,{used_pp:Math.round(tokens*account.pp*1e4)/1e4,partial:false,period_seconds:seconds,tokens,account_id:account.id}];})):{},
      root_session_id:'demo-session-'+index,parent_session_id:null,
    };});
    // An unreported counter stays unknown and has no invented map area.
    if(deviceIndex===1)sessions.push({id:'demo-unreported',control_key:'demo',kind:'Gemini',app:'Terminal',terminal:'Prototype',project:'prototype',title:'prototype · Gemini',model:'',status:'unknown',
      tokens:null,rate:null,windows:Object.fromEntries(windows.map(([key])=>[key,null])),cpu:.6,rss:120*2**20,capabilities:['focus'],
      context_usage:null,weekly_account:'',weekly_estimate:{},root_session_id:'demo-unreported',parent_session_id:null});
    const device=prefix(Array.from({length:HISTORY},(_,k)=>mine.reduce((n,s)=>n+s.series[k],0)));
    const finish=Math.floor(now/60)*60+60;
    return {id:'demo-'+deviceIndex,name,platform:'Darwin',online:true,received:Date.now(),snapshot:{
      version:'demo',updated:now,recording_started:now-172800,
      speed_periods:[...STOPS.map(seconds=>({key:PRESETS[seconds]||'custom:'+seconds,seconds,tokens:since(device,seconds),known:true,partial:seconds>172800})),
        {key:'all',seconds:172800,tokens:since(device,172800),known:true,partial:false}],
      // The cockpit radar's bins, on the same clock and buckets as the companion's flow export.
      flow:Object.fromEntries(windows.map(([key,,seconds])=>{const step=seconds>18000?900:seconds>3600?300:60,start=finish-seconds,bins=Array.from({length:seconds/step},()=>({}));
        for(const s of mine)s.series.forEach((v,k)=>{const t=at(k);if(!v||t<start||t>=finish||t>now)return;const b=bins[Math.min(bins.length-1,Math.floor((t-start)/step))];b[s.kind]=(b[s.kind]||0)+v;});
        return [key,{step,start,end:finish,as_of:now,reported:true,bins}];})),
      account_quotas:Object.entries(accounts).filter(([,a])=>a.device===deviceIndex).map(([kind,a])=>({
        id:a.id,kind,account_label:kind+' · '+a.id.slice(-6),plan:a.plan,updated:now-40,stale:false,note:'',status:'',
        windows:[...(a.five?[{label:'5H',pct:a.five[0],reset:now+a.five[1]}]:[]),{label:'주간',pct:a.pct,reset:now+a.reset}],
        weekly:weekly[kind].periods,usage_points:weekly[kind].points.slice(-60)})),
      operations:{updated:now-30,installed_skills:deviceIndex?6:18,observed_events:deviceIndex?2:7,loop_state:'not_verified',skill_runtime:'partial',
        goals:deviceIndex?[]:[{thread_id:'demo-goal-1',runtime:'Codex',status:'active',tokens_used:1240000,time_used_seconds:5400,session_connected:true,evidence:'reported'}]},
      applications:[...new Set(sessions.map(s=>s.app))].map(name=>({name,evidence:'application_process'})),
      host:{cpu:18+deviceIndex*12,used_memory:(14+deviceIndex*8)*2**30,total_memory:32*2**30,cores:12},
      periods:windows.map(([key,label,seconds])=>({key,label,tokens:[0,1,2,3].map(j=>sessions.reduce((sum,s)=>sum+(s.windows[key]?.[j]||0),0)),partial:false,observed_seconds:seconds})),
      sessions,
    }};
  });
}
