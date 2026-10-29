// One invented collector state (/api/state) for screenshots of the desktop dashboard and the menu bar
// and tray panels, with token use shaped like real use (site/src/demo-usage.js). Projects and accounts
// are made up. node scripts/demo-state.mjs [now] > fixture.json
import {usage,since,vector} from '../site/src/demo-usage.js';

const PERIODS=[['10m','10분',600],['30m','30분',1800],['1h','1시간',3600],['5h','5시간',18000],['12h','12시간',43200],['24h','24시간',86400]];
// Weekly percent per token, as a calibration of 1 percentage point over tokens.
const ACCOUNTS={'claude-a':40e6,'claude-b':9e6,'codex-a':3e6,'codex-b':6e6};
// [id, kind, project, model, status, account, weight, extra]: weight is the usual share of this computer.
const ROWS=[
 ['s1','Claude','checkout-web','claude-opus-5-5','working','claude-a',30,{effort:'xhigh',orca_terminal:{title:'Checkout UI'},children_count:2,children_working:1}],
 ['s2','Codex','billing-service','gpt-6.1-sol','working','codex-b',8,{location:{app:'Windows Terminal',app_path:'C:/wt.exe'}}],
 ['s3','Claude','docs-site','claude-sonnet-5-5','working','claude-b',6,{location:{app:'Visual Studio Code',app_path:'C:/code.exe'}}],
 ['s4','GLM','data-sync','glm-5.3[1m]','waiting',null,2,{orca_terminal:{title:'Nightly sync'}}],
 ['s5','Aside','0','gpt-6.1-sol','working',null,1.5,{title:'Release notes'}],
 ['s6','Codex','api-gateway','gpt-6-astra','idle','codex-a',3,{orca_terminal:{title:'Gateway'}}],
 ['s7','Claude','mobile-app','claude-haiku-5-5','idle','claude-a',2,{display_status:'paused',orca_terminal:{title:'Mobile'}}],
 ['s8','Antigravity','research',null,'idle',null,0,{location:{app:'Cursor',app_path:'C:/cursor.exe'}}],
];

export function demoState(now){
 const streams=ROWS.map(([,,,,status,,weight],i)=>({weight,start:now-30*3600,stop:status==='waiting'?now-(3+i)*60:status==='idle'?now-(45+i*31)*60:Infinity}));
 const u=usage(23,1.3e6,streams,now,now),window=j=>Object.fromEntries(PERIODS.map(([k,,s])=>[k,vector(since(u,j,now-s))]));
 const used=(account,from)=>ROWS.reduce((n,row,j)=>n+(row[5]===account?since(u,j,from):0),0);
 const sessions=ROWS.map(([id,kind,project,model,status,account,weight,extra],j)=>{
  const windows=window(j),{effort=null,...rest}=extra,per=account?1/ACCOUNTS[account]:0;
  return {id,kind,project,model,effort,status,tokens:weight?vector(weight*5e7+since(u,j,now-86400)):null,control_key:'demo-'+id,input_verified:true,
   usage:{rate:status==='working'?Math.round(since(u,j,now-600)/600):0,windows,weekly_account:account,
    weekly_estimate:account?Object.fromEntries(PERIODS.map(([k])=>{const tokens=windows[k].reduce((a,b)=>a+b,0);
     return [k,{used_pp:Math.round(tokens*per*100)/100,account_id:account,partial:false,basis:'calibrated_token_equivalent',tokens,
      calibration:{tokens:ACCOUNTS[account],used_pp:1,seconds:1800,confidence:'good'}}];})):{}},
   resources:{cpu:status==='working'?Math.round((1.5+Math.min(30,u.minutes[j].at(-2)/4e4))*10)/10:.3,rss:2.1e8},...rest};
 });
 const quota=(id,kind,label,plan,five,week,extra={})=>({id,kind,account_label:label,plan,updated:now-40,stale:false,note:'',
  windows:[{label:'5시간',pct:five,reset:now+7400},{label:'주간',pct:week,reset:now+266000}],...extra});
 const quotas=[quota('claude-a','Claude','dev@example.com','Max',42,61),quota('claude-b','Claude','studio@example.com','Pro',18,33,{alias:'Studio'}),
  quota('codex-a','Codex','ops@example.com','Pro',55,72),
  quota('codex-b','Codex','ml@example.com','Plus',9,18,{stale:true,status:'login_required',updated:now-2280,note:'저장된 로그인이 만료되어 한도를 새로 확인하지 못했습니다.'})];
 const weekly={accounts:quotas.map(q=>{const per=1/ACCOUNTS[q.id],pct=q.windows[1].pct;
  return {id:q.id,periods:Object.fromEntries(PERIODS.map(([k,,s])=>[k,{used_pp:Math.round(used(q.id,now-s)*per*100)/100,partial:false,observed_seconds:s}])),
   usage_points:Array.from({length:49},(_,i)=>{const t=now-86400+i*1800;return [t,Math.max(0,Math.round((pct-used(q.id,t)*per)*100)/100),now+266000];})};})};
 // One event a minute for each tool that worked in it, as the collector groups them.
 const events=[];
 for(let i=0;i<u.minutes[0].length;i++){const t=(u.first+i)*60+30;if(t<now-86400)continue;const byKind={};
  ROWS.forEach((row,j)=>{if(u.minutes[j][i])byKind[row[1]]=(byKind[row[1]]||0)+u.minutes[j][i];});
  for(const [kind,n] of Object.entries(byKind))events.push({t:Math.min(t,now),kind,n:Math.round(n)});}
 const total=s=>sessions.reduce((n,x)=>n+(x.usage.windows[s]||[]).reduce((a,b)=>a+b,0),0);
 const period_usage={known_kinds:['Claude','Codex','GLM','Aside'],computers:1,expected:1,
  windows:PERIODS.map(([k,l,s])=>({key:k,label:l,tokens:vector(total(k)),partial:false,observed_seconds:s,seconds:s}))};
 const busy=Math.min(1,u.minutes.reduce((n,row)=>n+row.at(-2),0)/3.9e6);
 return {ready:true,error:null,updated:now,version:'demo',started:now-90000,action_token:'demo-token',sessions,root_sessions:sessions,account_quotas:quotas,
  weekly_usage:weekly,period_usage,events,system:{host:{cpu:Math.round((9+45*busy)*10)/10,memory:{percent:61.2,used:2.1e10,total:3.4e10}}}};
}

if(import.meta.url===`file://${process.argv[1]}`)process.stdout.write(JSON.stringify(demoState(Number(process.argv[2])||Date.now()/1000)));
