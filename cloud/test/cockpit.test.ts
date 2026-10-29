import {expect,it} from 'vitest';
import {snapshot} from '../src/protocol';
const sample=()=>({updated:3601,sessions:[{id:'s',kind:'Claude',weekly_account:'a',root_session_id:'root',parent_session_id:'root',
 weekly_estimate:{'1h':{used_pp:2,partial:false,period_seconds:3600,tokens:100,account_id:'a',
 calibration:{pp_per_token:.02,confidence:'early',from:100,to:200,private:'SECRET'}}}}],
 account_quotas:[{id:'a',kind:'Claude',account_label:'PRIVATE EMAIL',weekly:{'1h':{used_pp:2,observed_seconds:3600,partial:false}},
 usage_points:Array.from({length:80},(_,i)=>[i,20,4000])}],
 flow:{'1h':{step:60,start:60,end:3660,as_of:3601,reported:true,bins:Array.from({length:60},()=>({Claude:10,Codex:2,private:'SECRET'}))}}});
it('preserves bounded cockpit flow, account measurements and session conversions',()=>{
 const clean=snapshot(sample());
 expect(clean.flow?.['1h'].bins).toHaveLength(60);
 expect(clean.flow?.['1h'].bins[0]).toEqual({Claude:10,Codex:2});
 expect(clean.account_quotas[0].weekly?.['1h']).toEqual({used_pp:2,observed_seconds:3600,partial:false});
 expect(clean.account_quotas[0].usage_points).toHaveLength(60);
 expect(clean.sessions[0].weekly_estimate?.['1h'].calibration?.pp_per_token).toBe(.02);
 expect(clean.sessions[0].root_session_id).toBe('root');
 expect(JSON.stringify(clean)).not.toMatch(/SECRET|PRIVATE EMAIL/);
});
it('rejects invalid bins and mismatched-account calibration without inventing values',()=>{
 const bad:any=sample();bad.flow['1h'].bins.push({Claude:1});
 bad.sessions[0].weekly_estimate['1h'].account_id='other';
 bad.account_quotas[0].usage_points=[[1,-10,100],[2,NaN,100],[3,10,100]];
 const clean=snapshot(bad);expect(clean.flow).toEqual({});
 expect(clean.sessions[0].weekly_estimate).toEqual({});
 expect(clean.account_quotas[0].usage_points).toEqual([[3,10,100]]);
 const invalid:any=sample();invalid.flow['1h'].bins[0]={Claude:Infinity,Codex:-1};
 expect(snapshot(invalid).flow?.['1h'].bins[0]).toEqual({});
 expect(snapshot({sessions:[]}).flow).toEqual({});
});
