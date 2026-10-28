import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import weekly from '../agent/onetop/dist/weekly.js';

// Execute the real renderer with a small DOM seam. No network or session action runs.
const html=fs.readFileSync(new URL('../agent/onetop/dist/index.html',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../agent/onetop/dist/app.js',import.meta.url),'utf8');
const nodes=Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,{
 value:'',innerHTML:'',dataset:{},addEventListener(){},querySelectorAll(){return [];},
 classList:{add(){},remove(){},toggle(){}}
}]));
const context=vm.createContext({
 document:{getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},
 window:{addEventListener(){}},fetch:()=>new Promise(()=>{}),setInterval(){},setTimeout(){},clearTimeout(){},
 AbortSignal,URL,Date,OneTopWeekly:weekly
});
vm.runInContext(source,context);
vm.runInContext(`data={ready:true,updated:Date.now()/1000,account_quotas:[],period_usage:{windows:[{key:'1h',label:'1시간',seconds:3600}]}};`,context);
const controlFixture={id:'root',kind:'Codex',status:'idle',display_status:'paused',children_working:1,
 control_key:'fixture',orca_terminal:{title:'Fixture root'},input_verified:true};
function buttons(fixture){
 context.fixture=fixture;
 const result=vm.runInContext('actions(fixture)',context);
 return Object.fromEntries([...result.matchAll(/<button\b([^>]+)>/g)].map(([,attrs])=>[
  /data-action="([^"]+)"/.exec(attrs)[1],!attrs.includes('disabled')
 ]));
}
assert.equal(buttons(controlFixture).resume,true);
assert.equal(vm.runInContext('display(fixture)',context),'working'); // Group badge still reflects its child.
const resuming=buttons({...controlFixture,status:'working',display_status:'resuming'});
assert.equal(resuming.pause,false);
assert.equal(resuming.terminate,false);
assert.equal(buttons({...controlFixture,control_key:null}).resume,false);

vm.runInContext(`
 const child={id:'child',kind:'Codex',status:'idle',project:'fixture',model:'child-model',pids:[],
  is_subagent:true,tokens:[1,0,0,0],usage:{windows:{'1h':[1,0,0,0]}}};
 const sibling={...child,id:'busy-child',status:'working'};
 const root={...child,id:'root',is_subagent:false,status:'working',model:'root-model',
  children_ids:['child','busy-child'],children_count:2};
 data.sessions=[root,child,sibling];data.root_sessions=[root];
`,context);
nodes.search.value='';nodes.modelFilter.value='all';nodes.sort.value='status';
const rowIDs=()=>[...nodes.sessionsBody.innerHTML.matchAll(/\bdata-session="([^"]+)"/g)].map(([,id])=>id);
nodes.stateFilter.value='idle';
vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['root','child']);
assert.equal(nodes.tableCount.textContent,1);
nodes.stateFilter.value='all';
vm.runInContext('renderTable()',context);
assert.deepEqual(rowIDs(),['root']); // Resetting the filter restores the collapsed group.
vm.runInContext("expandedSessions.add('root');renderTable();",context);
assert.deepEqual(rowIDs(),['root','child','busy-child']);
console.log('Session groups: root controls retain their own state; matching descendants appear under state filters.');
