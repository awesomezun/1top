// Synthetic demonstration data. Never copy live machines into public assets.
const windows=[['24h','24h',86400],['12h','12h',43200],['5h','5h',18000],['1h','1h',3600],['30m','30m',1800],['10m','10m',600]];
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
function vector(amount){const v=[Math.round(amount*.22),Math.round(amount*.63),Math.round(amount*.03)];return [...v,Math.round(amount)-v.reduce((a,b)=>a+b,0)];}
export function demoDevices(){
  const now=Date.now()/1000;
  return ['MacBook Pro','Mac mini'].map((name,deviceIndex)=>{
    const sessions=examples.flatMap(([project,kind,app,terminal,model,share],index)=>index%2!==deviceIndex?[]:[{
      id:'demo-session-'+index,kind,app,terminal,project,title:'Example session',model,
      context_usage:{basis:'last_request_input',input_tokens:64000+index*6000,capacity:kind==='Codex'?200000:null,parts:[12000+index*2000,48000+index*4000,4000],observed_at:now,model},
      status:index<5?'working':'idle',tokens:vector(share*180000),rate:index<5?Math.round(share*9):0,
      cpu:index<5?7.4+index:.3,rss:(180+index*20)*2**20,
      windows:Object.fromEntries(windows.map(([key,,seconds])=>[key,vector(share*10000*seconds/3600)])),
      capabilities:['focus','pause','terminate',...(app==='Orca'&&index>=5?['prompt']:[])],control_key:'demo',
    }]);
    // An unreported counter stays unknown and has no invented map area.
    if(deviceIndex===1)sessions.push({id:'demo-unreported',kind:'Gemini',app:'Terminal',terminal:'Prototype',project:'prototype',title:'Example unreported session',model:'',status:'unknown',tokens:null,rate:null,cpu:.6,rss:120*2**20,windows:{},capabilities:['focus'],control_key:'demo'});
    return {id:'demo-'+deviceIndex,name,platform:'Darwin',online:true,received:Date.now(),snapshot:{
      account_quotas:[{id:'demo-account-'+deviceIndex,kind:deviceIndex?'Codex':'Claude',account_label:(deviceIndex?'Codex':'Claude')+' · demo0'+deviceIndex,plan:deviceIndex?'Pro':'Max',updated:now,stale:false,windows:[...(!deviceIndex?[{label:'5H',pct:24,reset:now+8040}]:[]),{label:'Weekly',pct:deviceIndex?72:61,reset:now+172800}]}],
      version:'demo',updated:now,recording_started:now-172800,
      host:{cpu:18+deviceIndex*12,used_memory:(14+deviceIndex*8)*2**30,total_memory:32*2**30,cores:12},
      applications:[...new Set(sessions.map(s=>s.app))].map(name=>({name})),
      periods:windows.map(([key,label,seconds])=>({key,label,tokens:[0,1,2,3].map(j=>sessions.reduce((sum,s)=>sum+(s.windows[key]?.[j]||0),0)),partial:false,observed_seconds:seconds})),sessions,
    }};
  });
}
