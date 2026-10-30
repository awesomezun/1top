// Session conversation in the dashboard (agent/onetop/dist/conversation.js): delivery only moves
// forward, mailbox answers merge by ID, what a session takes, and the demo relay's mailbox.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),c=require('../agent/onetop/dist/conversation.js');

// Forward only; a reply proves arrival; problems are reported as they come.
assert.equal(c.advance('awaiting_reply','sending',false),'awaiting_reply');
assert.equal(c.advance('sending','queued',false),'sending');
assert.equal(c.advance('queued','awaiting_reply',false),'awaiting_reply');
assert.equal(c.advance('replied','delivery_unconfirmed',false),'replied');
assert.equal(c.advance('awaiting_reply','delivery_unconfirmed',false),'delivery_unconfirmed');
assert.equal(c.advance('delivery_unconfirmed','awaiting_reply',false),'awaiting_reply');
assert.equal(c.advance('sending','not_delivered',true),'replied');

// The computer answers with recently changed rows only: nothing shown is dropped, activity belongs
// to this answer, and a late row never takes a reply away.
const shown=[{id:'a',text:'first',created:1,status:'awaiting_reply',reply:'',activity:{phase:'writing'}},{id:'b',text:'second',created:2,status:'replied',reply:'done'}];
const merged=c.merge(shown,[{id:'b',text:'second',created:2,status:'awaiting_reply',reply:''},{id:'c',text:'third',created:3,status:'queued',reply:'',activity:null},{id:'a',text:'',created:1,status:'awaiting_reply',reply:'',activity:{phase:'responding',observed_at:5}}]);
assert.deepEqual(merged.map(m=>m.id),['a','b','c']);
assert.equal(merged[0].text,'first');assert.equal(merged[0].activity.phase,'responding');
assert.equal(merged[1].status,'replied');assert.equal(merged[1].reply,'done');assert.equal(merged[1].activity,null);
assert.equal(c.merge(merged,[]).every(m=>m.activity===null),true);

// What a session takes: the relay's list as it is, or the collector's own rules on local rows.
assert.deepEqual([...c.capabilities({capabilities:['mailbox','message']})],['mailbox','message']);
const local={control_key:'k',path:'/tmp/s.jsonl',kind:'Codex',orca_terminal:{title:'Tab'},input_verified:true};
assert.deepEqual([...c.capabilities({...local,status:'idle'})].sort(),['mailbox','message','message_images','prompt']);
assert.deepEqual([...c.capabilities({...local,status:'working'})].sort(),['mailbox','message','message_images']);
assert.deepEqual([...c.capabilities({...local,status:'idle',orca_terminal:null})].sort(),['mailbox']);
assert.deepEqual([...c.capabilities({...local,kind:'Aside',orca_terminal:null,input_verified:false,status:'working'})].sort(),['mailbox','message','prompt']);
assert.deepEqual([...c.capabilities({...local,control_key:'',status:'idle'})],[]);
assert.deepEqual([...c.capabilities({...local,path:'',status:'idle'})],['prompt']);

// Work state is the session's, apart from delivery; offline and stale say why nothing moves.
assert.equal(c.workState({status:'idle',display_status:'paused'},true),'paused');
assert.equal(c.workState({status:'working'},false),'stale');
assert.equal(c.workState({status:'working',offline:true},true),'offline');
assert.equal(c.workState({status:'interrupted'},true),'idle');

// Why the composer cannot send: no input, photos where none are taken, length, freshness.
const draft=(text,photos=0)=>({text,photos:Array.from({length:photos},(_,i)=>({id:String(i)}))});
assert.equal(c.sendBlock({capabilities:['message','message_images']},draft('hi',2),true),'');
assert.match(c.sendBlock({capabilities:['message']},draft('hi',1),true),/사진/);
assert.match(c.sendBlock({capabilities:[]},draft('hi'),true),/입력 연결/);
assert.match(c.sendBlock({capabilities:['message']},draft('x'.repeat(4001)),true),/4,000/);
assert.match(c.sendBlock({capabilities:['message']},draft('hi'),false),/최신 정보/);
assert.equal(c.MAX_PHOTOS,3);assert.equal(c.MAX_BYTES,524288);
for(const status of ['queued','sending','awaiting_reply','replied','delivery_unconfirmed','source_changed','not_delivered','send_failed'])assert.ok(c.DELIVERY[status],status);
for(const phase of ['responding','working','writing'])assert.ok(c.TYPING[phase],phase);

// The demo relay keeps a mailbox like a computer: the conversation demo's earlier messages (demo-world.js)
// come first, and a sent message follows the script, each step at its time, to the scripted reply.
const {demoRelay}=await import('../site/src/remote-demo.js'),{WORLD}=await import('../site/src/demo-world.js');
const relay=demoRelay(),device=relay.devices()[0],session=device.snapshot.sessions.find(s=>s.id===WORLD.conversation.session);
assert.ok(session.capabilities.includes('mailbox')&&session.capabilities.includes('message_images')&&session.status==='working');
const ask={device_id:device.id,session_id:session.id,control_key:session.control_key};
assert.deepEqual((await relay.mailbox(ask)).map(r=>[r.status,r.activity]),[['replied',null],['replied',null],['delivery_unconfirmed',null]]);
const command={action:'message',request_id:'11111111-1111-1111-1111-111111111111',...ask,prompt:'How far along are you?',attachments:[{mime:'image/jpeg',data:'AAAA'}]};
const later=[],timeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms)=>ms>=1000?later.push([ms,fn]):timeout(fn,ms);
assert.equal((await relay.send(command)).status,'sent');assert.equal((await relay.send(command)).status,'sent');
globalThis.setTimeout=timeout;
let rows=await relay.mailbox(ask);
assert.equal(rows.length,4);assert.equal(rows[3].status,'queued');assert.equal(rows[3].attachments[0].bytes,3);
const seen=[];
for(const [ms,step] of later.sort((a,b)=>a[0]-b[0])){step();const row=(await relay.mailbox(ask))[3];seen.push([ms/1000,row.status,row.activity?.phase??null]);}
assert.deepEqual(seen,WORLD.conversation.script.steps.filter(s=>s.at>0).map(s=>[s.at,s.status,s.activity??null]));
rows=await relay.mailbox(ask);
assert.equal(rows[3].text,'How far along are you?');assert.equal(rows[3].reply,WORLD.conversation.script.reply.ko);
console.log('Conversation: forward-only delivery, ID merge, capabilities, work state, send blocks and the demo mailbox and script passed.');
process.exit(0);
