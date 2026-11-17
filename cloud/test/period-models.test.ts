import {env,runInDurableObject} from 'cloudflare:test';
import {expect,it} from 'vitest';
import {snapshot,SPEED_SECONDS} from '../src/protocol';

const rows=()=>[
  {kind:'Claude',model:'claude-opus-5-5',tokens:[79,0,0,0],session_count:2},
  {kind:'Codex',model:'gpt-6-astra',tokens:[10,1,2,3],session_count:1},
  {kind:'Aside',model:'gpt-6-astra',tokens:[5,0,0,0],session_count:1},
  {kind:'Claude',model:null,tokens:[6,0,0,0],session_count:1}
];
const period=(by_model:unknown)=>({key:'1h',tokens:[100,1,2,3],by_model});
const clean=(by_model:unknown)=>snapshot({sessions:[],periods:[period(by_model)]}).periods[0];

it('retains ended-session model attribution in every period independently of live sessions',()=>{
  const periods=[...Object.keys(SPEED_SECONDS),'all'].map(key=>({...period(rows()),key}));
  const report=snapshot({sessions:[],periods});
  expect(report.sessions).toEqual([]);expect(report.periods).toHaveLength(19);
  for(const p of report.periods)expect(p.by_model).toEqual(rows());
});

it('preserves old-server absence, known zero and genuinely unidentified models',()=>{
  expect(clean(undefined)).not.toHaveProperty('by_model');
  expect(clean(null)).not.toHaveProperty('by_model');
  expect(clean(rows()).by_model?.[3].model).toBeNull();
  expect(snapshot({sessions:[],periods:[{key:'1h',tokens:[0,0,0,0],by_model:[]}]}).periods[0].by_model).toEqual([]);
  expect(clean([])).not.toHaveProperty('by_model');
});

it('drops private nested fields without losing model identity or token components',()=>{
  const source=rows().map(r=>({...r,prompt:'PRIVATE',cwd:'/private/path',account:'SECRET',session_ids:['private-session']}));
  const report=clean(source);
  expect(report.by_model).toEqual(rows());
  for(const privateText of ['PRIVATE','SECRET','/private','private-session'])expect(JSON.stringify(report)).not.toContain(privateText);
});

it('omits invalid breakdowns atomically rather than presenting a partial model share',()=>{
  for(const invalid of [
    [...rows(),rows()[0]],
    rows().slice(1),
    rows().map((r,i)=>i===0?{...r,tokens:[78,0,0,0]}:r),
    rows().map((r,i)=>i===0?{...r,tokens:[79,-1,3,3]}:r),
    rows().map((r,i)=>i===0?{...r,tokens:[NaN,0,0,0]}:r),
    rows().map((r,i)=>i===0?{...r,model:''}:r),
    rows().map((r,i)=>i===0?{...r,model:'x'.repeat(161)}:r),
    rows().map((r,i)=>i===0?{...r,session_count:1.5}:r),
    rows().map((r,i)=>i===0?{...r,kind:''}:r),
    Array.from({length:257},(_,i)=>({kind:'Codex',model:'model-'+i,tokens:[0,0,0,0],session_count:0})),
    [null],{},'bad'
  ]){
    const report=clean(invalid);
    expect(report).not.toHaveProperty('by_model');
    expect(report.tokens).toEqual([100,1,2,3]);
  }
});

it('keeps model breakdown through Durable Object storage and device retrieval',async()=>{
  const hub=env.HUBS.get(env.HUBS.idFromName('period-models-'+crypto.randomUUID()));
  const device={id:crypto.randomUUID(),name:'test',platform:'test',received:Date.now(),
    snapshot:snapshot({sessions:[],periods:[period(rows())]})};
  await runInDurableObject(hub,async(i:any)=>{
    await i.storeDevice(device);
    expect((await i.readDevice(device.id)).snapshot.periods[0].by_model).toEqual(rows());
    expect((await i.devices())[0].snapshot.periods[0].by_model).toEqual(rows());
    await i.removeDevice(device.id);
  });
});
