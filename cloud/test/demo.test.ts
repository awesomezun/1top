import {expect,it} from 'vitest';
import {snapshot} from '../src/protocol';
// @ts-expect-error The public site is plain JavaScript.
import {demoDevices} from '../../site/src/demo.js';
const KEYS=['24h','12h','5h','1h','30m','10m'];
const sum=(v:number[]|null)=>v?v.reduce((a,b)=>a+b,0):0;
it('preserves every supplied web demo field when the relay adds optional defaults',()=>{
 for(const d of demoDevices()){
  // Optional protocol additions may fill absent fields. Every supplied demo value must survive.
  expect(snapshot(d.snapshot)).toMatchObject(d.snapshot);
  expect(Object.keys(d.snapshot.flow).sort()).toEqual([...KEYS].sort());
  expect(d.snapshot.speed_periods.length).toBeGreaterThan(0);
  expect(d.snapshot.operations.installed_skills).not.toBeNull();
  for(const q of d.snapshot.account_quotas){expect(Object.keys(q.weekly).sort()).toEqual([...KEYS].sort());expect(q.usage_points.length).toBe(60);}
 }
});
it('derives every demo number from the same token events',()=>{
 for(const d of demoDevices()){
  for(const p of d.snapshot.periods)expect(sum(p.tokens)).toBe(d.snapshot.sessions.reduce((n:number,s:any)=>n+sum(s.windows[p.key]),0));
  for(const s of d.snapshot.sessions)if(s.tokens)expect(sum(s.tokens)).toBeGreaterThanOrEqual(sum(s.windows['24h']));
  // The radar's bins start on the next whole minute, so they hold the period's tokens or slightly fewer.
  for(const key of KEYS){const bins=d.snapshot.flow[key].bins.reduce((n:number,b:Record<string,number>)=>n+Object.values(b).reduce((a,c)=>a+c,0),0);
   const period=sum(d.snapshot.periods.find((p:any)=>p.key===key).tokens);
   expect(bins).toBeGreaterThan(0);expect(bins).toBeLessThanOrEqual(period);}
 }
});
