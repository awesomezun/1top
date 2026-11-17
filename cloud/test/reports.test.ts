import {env,runInDurableObject} from 'cloudflare:test';
import {describe,it,expect} from 'vitest';
import {reports,MAX_REPORT_BYTES} from '../src/reports';
import {snapshot} from '../src/protocol';
function fixture():any{return {version:1,as_of:1794090000,value:{month:'2026-11',start:1793505600,end:1794090000,currency:'USD',prices_as_of:'2026-11-07',plans:[{account_id:'claude:abcd',kind:'Claude',plan:'max',label:'Claude Max',price:100,source:'detected'}],plan_total:100,api_value:200,ratio:2,api_billed:0,unpriced:{tokens:10,models:['unknown']},excluded:{api_value:2,kinds:['Aside']},by_kind:[{kind:'Claude',api_value:200,plan_total:100,ratio:2}],by_model:[{model:'claude-opus-5-5',kind:'Claude',api_value:200,tokens:[100,200,300,400]}],months:[{month:'2026-10',api_value:300,plan_total:100}]},weekly:{start:1793595600,end:1794200400,since:1793595600,working_s:500,waiting_s:30,longest_wait:{session_id:'thread:1',label:'테스트',kind:'Codex',seconds:30},previous:{working_s:100,waiting_s:0,partial:true},days:[{date:'2026-11-03',working_s:500,waiting_s:30}]}};}
const sample=(report?:any)=>({updated:Date.now()/1000,sessions:[],features:['history','reports'],reports:report,host:{},periods:[]});
describe('reports allowlist',()=>{
 it('preserves bridge fields, null prices/ratio, and optional sections',()=>{
  const r=fixture();expect(reports(r)).toEqual(r);r.value.plans[0].price=null;r.value.plans[0].source='unknown';r.value.ratio=null;r.weekly.longest_wait=null;expect(reports(r)).toEqual(r);expect(reports({version:1,as_of:1,value:null,weekly:null})).toEqual({version:1,as_of:1});
 });
 it('drops extra nested credentials and messages, paths and email labels',()=>{
  const r=fixture();r.credentials='PRIVATE';r.value.plans[0].secret='PRIVATE';r.weekly.previous.prompt='PRIVATE';r.weekly.longest_wait.path='/PRIVATE';r.value.unpriced.secret='PRIVATE';r.weekly.longest_wait.label='user@example.com';r.value.plans[0].label='/Users/private';const clean=reports(r);expect(clean).toBeDefined();expect(JSON.stringify(clean)).not.toMatch(/PRIVATE|user@example|Users/);
 });
 it.each([NaN,Infinity,-1,'200',true])('rejects invalid numeric data %s without dropping other session data',bad=>{
  const r=fixture();r.value.api_value=bad;expect(reports(r)).toBeUndefined();const s=snapshot(sample(r));expect(s.reports).toBeUndefined();expect(s.features).not.toContain('reports');expect(s.sessions).toEqual([]);
 });
 it('bounds collections, bytes, versions, identities and dates',()=>{
  for(const change of [(r:any)=>r.version=2,(r:any)=>r.value.plans=Array(25).fill(r.value.plans[0]),(r:any)=>r.value.months=Array(7).fill(r.value.months[0]),(r:any)=>r.weekly.days[0].date='2026-02-31',(r:any)=>r.weekly.previous.partial='true',(r:any)=>r.value.plans[0].account_id='user@example.com',(r:any)=>r.value.by_model[0].tokens=[1,2,3],(r:any)=>r.extra='가'.repeat(MAX_REPORT_BYTES)]){const r=fixture();change(r);expect(reports(r)).toBeUndefined();}
 });
 it('keeps old agents compatible and advertises only valid reports',()=>{expect(snapshot(sample()).features).toEqual(['history']);expect(snapshot(sample(fixture())).features).toContain('reports');});
 it('validates a real device message before forwarding it live to its viewer',async()=>{
  const e:any=env,hub=e.HUBS.get(e.HUBS.idFromName('reports-live'));
  async function open(role:string,id:string){const response=await hub.fetch('https://hub/ws?'+new URLSearchParams({role,id,expires:String(Date.now()+60000)}),{headers:{Upgrade:'websocket'}});const ws=response.webSocket!;ws.accept();return ws;}
  const viewer=await open('browser','viewer');
  const next=()=>new Promise<any>(resolve=>{const handler=(m:any)=>{const value=JSON.parse(m.data);if(value.type==='report_policy')return;viewer.removeEventListener('message',handler);resolve(value);};viewer.addEventListener('message',handler);});
  await next();const device=await open('device','mac'),received=next();
  const raw=fixture();raw.weekly.previous.path='/PRIVATE';device.send(JSON.stringify({type:'snapshot',data:sample(raw)}));
  const message=await received;expect(message.type).toBe('snapshot');expect(message.device.snapshot.reports).toEqual(fixture());expect(JSON.stringify(message)).not.toContain('PRIVATE');viewer.close();device.close();
 });
 it('persists through cold memory and sends only to the owning account hub',async()=>{
  const e:any=env,hub=e.HUBS.get(e.HUBS.idFromName('reports-a')),other=e.HUBS.get(e.HUBS.idFromName('reports-b'));
  await runInDurableObject(hub,async(instance:any)=>{await instance.keepDevice({id:'report-mac',name:'Mac',platform:'Darwin',received:Date.now(),snapshot:snapshot(sample(fixture()))},true);instance.latest.clear();instance.persisted.clear();expect((await instance.readDevice('report-mac')).snapshot.reports).toEqual(fixture());});
  async function initial(target:any){const response=await target.fetch('https://hub/ws?role=browser&id=viewer&expires='+String(Date.now()+60000),{headers:{Upgrade:'websocket'}});const ws=response.webSocket!;ws.accept();const message=await new Promise<any>(resolve=>ws.addEventListener('message',(m:any)=>resolve(JSON.parse(m.data))));ws.close();return message;}
  const a=await initial(hub),b=await initial(other);expect(a.devices[0].snapshot.reports).toEqual(fixture());expect(a.devices[0].snapshot.features).toContain('reports');expect(b.devices).toEqual([]);
 });
});
