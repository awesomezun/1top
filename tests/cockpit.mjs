import assert from 'node:assert/strict';
import {reading,orderSessions} from '../site/src/cockpit.js';

const device=(flow,periods)=>({snapshot:{flow:{'10m':flow},periods}});
const total=bins=>bins.map(b=>b.total);
// One computer: its own bins, newest first, per hour.
const one=reading([device({step:60,start:0,end:180,bins:[{Claude:1},{Claude:2},{Codex:3}]})],[],'10m');
assert.deepEqual(total(one.bins),[180,120,60]);
// Two computers line up on real time; the axis ends where both have reported and a bin one lacks stays unknown.
const a=device({step:60,start:0,end:180,bins:[{Claude:1},{Claude:2},{Codex:3}]}),late=device({step:60,start:120,end:240,bins:[{Claude:10},{Codex:20}]});
const two=reading([a,late],[],'10m');
assert.deepEqual(total(two.bins),[(3+10)*60,null,null]);
assert.deepEqual(two.bins[0].parts,[['Claude',600],['Codex',180]]);
// Different steps fall back to the nested period totals.
const coarse=device({step:300,start:0,end:300,bins:[{Claude:1}]});
assert.equal(reading([a,coarse],[],'10m').bins.length,1);
// Working sessions first, then everything else, each by the selected period's tokens.
const rows=[{id:'a',status:'idle',windows:{'1h':[900,0,0,0]}},{id:'b',status:'working',windows:{'1h':[10,0,0,0]}},{id:'c',status:'waiting',windows:{'1h':[50,0,0,0]}},{id:'d',status:'working',windows:{'1h':[20,0,0,0]}}];
assert.deepEqual(orderSessions(rows,'1h').map(r=>r.id),['d','b','a','c']);
console.log('Remote cockpit: per-hour bins, cross-computer time alignment with unknown edges, step fallback and working-first order passed.');
