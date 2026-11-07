// A preview must use this checkout/version, and cannot send input to a real session.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
const child=spawn(process.execPath,['scripts/preview-desktop.mjs','0','--now','1800000000'],{stdio:['ignore','pipe','pipe']});
let error='';child.stderr.on('data',x=>error+=x);
try{
 const timeout=new Promise((_,reject)=>setTimeout(()=>reject(Error('Preview startup timed out: '+error)),10000).unref());
 const chunk=await Promise.race([once(child.stdout,'data'),timeout]);
 const info=JSON.parse(String(chunk[0]).trim());
 const version=readFileSync('pyproject.toml','utf8').match(/^version\s*=\s*"([^"]+)"/m)[1];
 const health=await (await fetch(info.url+'/health')).json();assert.equal(health.version,version);assert.equal(health.edition,'desktop-demo');
 const state=await (await fetch(info.url+'/api/state')).json();assert.equal(state.version,version);assert.equal(state.ready,true);
 const updates=await (await fetch(info.url+'/api/updates')).json();assert.equal(updates.version,version);assert.equal(updates.available,false);
 assert.equal((await (await fetch(info.url+'/')).text()).includes('class="remote-link"'),true);
 const action=await fetch(info.url+'/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'message',session_id:'actual-session-not-a-fixture',request_id:'test',prompt:'Must not leave this preview'})});
 assert.equal(action.status,403);
 console.log('Desktop preview: source version, local data, remote entry retained, and real controls refused.');
}finally{child.kill('SIGTERM');await once(child,'exit');}
