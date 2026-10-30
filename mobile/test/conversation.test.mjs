import {test} from 'node:test';
import assert from 'node:assert/strict';
const {base64Bytes,fitted,fitPlan,fitPhoto,checkAttachments,sendMode,defaultPrompt,deliveryLabel,deliveryTone,effectiveStatus,workState,workLabel,sendOutcome,inTurn,attachmentSummary,responseActivity,activityLabel,EMPTY,startSend,sendFailed,sendUnconfirmed,bringBack,mergeMailbox,applyReceipts,forward,PHOTO_LIMIT,EDGES,QUALITIES}=await import('../src/thread.ts');
const en=(e)=>e,ko=(_,k)=>k,b64=n=>Buffer.alloc(n,7).toString('base64');

test('decoded base64 size counts padding',()=>{
 assert.equal(base64Bytes(''),0);assert.equal(base64Bytes(b64(1)),1);assert.equal(base64Bytes(b64(2)),2);assert.equal(base64Bytes(b64(3)),3);assert.equal(base64Bytes(b64(PHOTO_LIMIT)),PHOTO_LIMIT);
});
test('photos shrink to a 1600 px long edge, keep their shape and are never enlarged',()=>{
 assert.deepEqual(fitted(4032,3024,1600),{width:1600,height:1200});assert.deepEqual(fitted(3024,4032,1600),{width:1200,height:1600});assert.deepEqual(fitted(800,600,1600),{width:800,height:600});
 const plan=fitPlan(4032,3024);assert.equal(plan.length,EDGES.length*QUALITIES.length);assert.deepEqual(plan[0],{width:1600,height:1200,quality:QUALITIES[0]});
 assert.ok(plan.every((p,i)=>i===0||Math.max(p.width,p.height)<=Math.max(plan[i-1].width,plan[i-1].height)));
 // A small photo is tried at its own size once, then smaller, never at a size it does not have.
 const small=fitPlan(900,700);assert.deepEqual(small.slice(0,3).map(p=>p.width),[900,900,900]);assert.ok(small.every(p=>p.width<=900));
});
test('fitting stops at the first encoding within the limit, lowers quality then size, and rejects what never fits',async()=>{
 const calls=[];const sizes={'1600:0.82':600000,'1600:0.68':560000,'1600:0.55':500000};
 const out=await fitPhoto(4032,3024,async(w,h,q)=>{calls.push([w,q]);return {data:b64(sizes[w+':'+q]??100),uri:'file:'+w};});
 assert.equal(out.ok,true);assert.equal(out.photo.quality,.55);assert.equal(out.photo.width,1600);assert.equal(out.photo.bytes,500000);assert.equal(calls.length,3);
 const shrink=await fitPhoto(4032,3024,async(w)=>({data:b64(w>1024?700000:400000),uri:'u'}));assert.equal(shrink.ok,true);assert.equal(shrink.photo.width,1024);
 let tries=0;const never=await fitPhoto(4032,3024,async(w)=>{tries++;return {data:b64(PHOTO_LIMIT+w),uri:'u'};});
 assert.equal(never.ok,false);assert.equal(never.smallest,PHOTO_LIMIT+640);assert.equal(tries,EDGES.length*QUALITIES.length);
 const unreadable=await fitPhoto(4032,3024,async()=>({data:'',uri:''}));assert.deepEqual(unreadable,{ok:false,smallest:null});
});
test('attachments: at most three JPEG or PNG photos of at most 512KB each',()=>{
 const ok={mime:'image/jpeg',data:b64(1000)};
 assert.equal(checkAttachments([]),null);assert.equal(checkAttachments([ok,{...ok,mime:'image/png'},ok]),null);
 assert.equal(checkAttachments([ok,ok,ok,ok]),'count');assert.equal(checkAttachments([{...ok,mime:'image/heic'}]),'type');
 assert.equal(checkAttachments([{...ok,data:''}]),'empty');assert.equal(checkAttachments([{...ok,data:b64(PHOTO_LIMIT)}]),null);assert.equal(checkAttachments([{...ok,data:b64(PHOTO_LIMIT+1)}]),'size');
});
test('questions and instructions go as one message; prompt-only computers cannot reply or take photos',()=>{
 assert.deepEqual(sendMode(['message','mailbox','message_images','prompt']),{mode:'message',photos:true,replies:true});
 assert.deepEqual(sendMode(['message','mailbox','prompt']),{mode:'message',photos:false,replies:true});
 assert.deepEqual(sendMode(['prompt','message_images']),{mode:'prompt',photos:false,replies:false});
 assert.deepEqual(sendMode(['focus','pause']),{mode:'none',photos:false,replies:false});
 assert.equal(defaultPrompt(en),'Please inspect the attached image(s).');assert.equal(defaultPrompt(ko),'첨부한 사진을 확인해 주세요.');
});
test('every delivery status has its own words in both languages and a tone apart from the work state',()=>{
 const all=['queued','sending','awaiting_reply','replied','delivery_unconfirmed','source_changed','not_delivered','instruction_sent'];
 for(const t of [en,ko]){const words=all.map(s=>deliveryLabel(s,t));assert.equal(new Set(words).size,all.length);assert.ok(words.every((w,i)=>w!==all[i]));}
 assert.equal(deliveryLabel('later_status',ko),'later_status');
 assert.deepEqual(all.map(deliveryTone),['progress','progress','progress','done','problem','problem','problem','done']);
 assert.equal(effectiveStatus({status:'sending',local:true,created:100},131),'delivery_unconfirmed');assert.equal(effectiveStatus({status:'sending',local:true,created:100},120),'sending');assert.equal(effectiveStatus({status:'sending',created:100},500),'sending');
});
test('work comes from live status and report freshness, never from delivery',()=>{
 const now=1_000_000,row=(status,extra={})=>({status,device:{online:true,received:now-1000,...extra}});
 assert.equal(workState(row('working'),now),'working');assert.equal(workState(row('waiting'),now),'waiting');assert.equal(workState(row('paused'),now),'paused');assert.equal(workState(row('resuming'),now),'paused');assert.equal(workState(row('idle'),now),'idle');assert.equal(workState(row('interrupted'),now),'idle');
 assert.equal(workState(row('working',{online:false}),now),'offline');assert.equal(workState(row('working',{received:now-31000}),now),'stale');
 assert.equal(workLabel('waiting',ko),'입력 대기');assert.equal(workLabel('stale',en),'Report is old');
});
test('the typing indicator follows request-scoped activity only, the latest one, and never an offline or old report',()=>{
 const act=(phase,observed_at)=>({phase,observed_at});
 const rows=[{status:'awaiting_reply',activity:act('working',100)},{status:'awaiting_reply',activity:act('writing',130)},{status:'awaiting_reply',activity:null}];
 assert.deepEqual(responseActivity(rows,'working'),act('writing',130));
 // Activity, not the session's status, turns it on; a working session without activity claims nothing.
 assert.deepEqual(responseActivity(rows,'idle'),act('writing',130));
 assert.equal(responseActivity([{status:'awaiting_reply'},{status:'awaiting_reply',activity:null}],'working'),null);
 for(const status of ['queued','sending','awaiting_reply'])assert.equal(responseActivity([{status}],'working'),null);
 // Offline or old reports hide it; a reply, a queued or failed request never shows it.
 assert.equal(responseActivity(rows,'offline'),null);assert.equal(responseActivity(rows,'stale'),null);
 for(const status of ['replied','queued','delivery_unconfirmed','not_delivered','source_changed'])assert.equal(responseActivity([{status,activity:act('writing',5)}],'working'),null);
 assert.deepEqual(responseActivity([{status:'sending',activity:act('responding',5)}],'working'),act('responding',5));
 // Unknown phases and missing times are ignored.
 assert.equal(responseActivity([{status:'awaiting_reply',activity:act('thinking',5)},{status:'awaiting_reply',activity:{phase:'writing'}}],'working'),null);
 assert.deepEqual(['responding','working','writing'].map(p=>activityLabel(p,ko)),['응답 준비 중…','작업 중…','답변 작성 중…']);
 assert.deepEqual(['responding','working','writing'].map(p=>activityLabel(p,en)),['Preparing a reply…','Working…','Writing a reply…']);
});
test('only a refusal (4xx) or a check on the phone is a definite failure; 5xx, timeouts and dropped connections are unconfirmed',()=>{
 for(const status of [400,401,404,409,413,422,429,499])assert.equal(sendOutcome({status}),'failed',String(status));
 for(const status of [500,502,503,504,520,399])assert.equal(sendOutcome({status}),'unconfirmed',String(status));
 assert.equal(sendOutcome({local:true}),'failed');assert.equal(sendOutcome({name:'AbortError'}),'unconfirmed');assert.equal(sendOutcome(new TypeError('Network request failed')),'unconfirmed');assert.equal(sendOutcome({}),'unconfirmed');
});
// The workspace keeps one conversation per device:session and changes only the one named.
const put=(all,key,fn)=>({...all,[key]:fn(all[key]??{draft:EMPTY,thread:[]})});
const photo=id=>({id,uri:'file:'+id,name:id+'.jpg',mime:'image/jpeg',data:'AAAA',bytes:3});
const mail=(id,extra={})=>({id,text:'m'+id,created:Number(String(id).replace(/\D/g,''))||1,status:'sending',reply:'',local:true,...extra});
test('drafts belong to their session: A, then B, then A again keeps both texts and photos',()=>{
 let all={};
 all=put(all,'mac:A',c=>({...c,draft:{text:'for A',photos:[photo('a1'),photo('a2')]}}));
 all=put(all,'mac:B',c=>({...c,draft:{...c.draft,text:'for B'}}));
 assert.deepEqual(all['mac:B'].draft,{text:'for B',photos:[]});
 assert.deepEqual(all['mac:A'].draft.text,'for A');assert.deepEqual(all['mac:A'].draft.photos.map(p=>p.id),['a1','a2']);
 all=put(all,'mini:A',c=>c);assert.deepEqual(all['mini:A'].draft,EMPTY);
});
test('sending empties only its own composer, and a late result for A never touches B',()=>{
 const sentA={text:'question A',photos:[photo('a1')]};
 let all=put({},'mac:A',c=>({...c,draft:sentA}));
 all=put(all,'mac:A',c=>startSend(c,mail('r1',{draft:sentA})));
 assert.deepEqual(all['mac:A'].draft,EMPTY);assert.equal(all['mac:A'].thread.length,1);
 all=put(all,'mac:B',c=>({...c,draft:{text:'writing B',photos:[photo('b1')]}}));
 const before=all['mac:B'];
 // A's late success changes no draft at all; its late refusal or timeout changes only A.
 for(const late of [c=>sendFailed(c,'r1','413'),c=>sendUnconfirmed(c,'r1')]){const after=put(all,'mac:A',late);assert.equal(after['mac:B'],before);}
 // Meanwhile the reader writes the next message in A; a late refusal must not overwrite it.
 all=put(all,'mac:A',c=>({...c,draft:{text:'next in A',photos:[]}}));
 const failed=put(all,'mac:A',c=>sendFailed(c,'r1','Too large'))['mac:A'];
 assert.equal(failed.draft.text,'next in A');assert.equal(failed.thread[0].status,'not_sent');assert.equal(failed.thread[0].error,'Too large');assert.deepEqual(failed.thread[0].draft,sentA);
});
test('a refusal restores into an empty composer, otherwise it can be brought back after the current draft',()=>{
 const sent={text:'retry me',photos:[photo('p1'),photo('p2')]};
 const restored=sendFailed(startSend({draft:sent,thread:[]},mail('r1',{draft:sent})),'r1','400');
 assert.deepEqual(restored.draft,sent);assert.equal(restored.thread.length,0);
 const kept={draft:{text:'new text',photos:[photo('n1'),photo('n2')]},thread:[mail('r1',{status:'not_sent',draft:sent})]};
 const back=bringBack(kept,'r1');
 assert.equal(back.draft.text,'new text\n\nretry me');assert.deepEqual(back.draft.photos.map(p=>p.id),['n1','n2','p1']);
 // The photo that did not fit the three-photo limit stays on the refused message.
 assert.equal(back.thread.length,1);assert.deepEqual(back.thread[0].draft.photos.map(p=>p.id),['p2']);assert.equal(back.thread[0].draft.text,'');
 const all=bringBack(back,'r1');assert.equal(all.draft.photos.length,3);assert.equal(all.thread.length,1);
 const roomy=bringBack({draft:EMPTY,thread:[mail('r1',{status:'not_sent',draft:sent})]},'r1');assert.deepEqual(roomy.draft,sent);assert.equal(roomy.thread.length,0);
});
test('twelve quick messages stay twelve when the mailbox returns only the latest ten',()=>{
 let thread=[];for(let i=1;i<=12;i++)thread=startSend({draft:EMPTY,thread},mail('r'+i)).thread;
 const server=Array.from({length:10},(_,k)=>({id:'r'+(k+3),text:'m'+(k+3),created:k+3,status:'awaiting_reply',reply:''}));
 const merged=mergeMailbox(thread,server);
 assert.equal(merged.length,12);assert.deepEqual(merged.map(m=>m.id),thread.map(m=>m.id));
 assert.deepEqual(merged.slice(0,2).map(m=>m.status),['sending','sending']);assert.ok(merged.slice(2).every(m=>m.status==='awaiting_reply'&&!m.local));
});
test('a late reply stays and a reply is never taken back to waiting',()=>{
 const thread=[{id:'r1',text:'q',created:1,status:'replied',reply:'done',reply_at:5},{id:'r2',text:'q2',created:2,status:'awaiting_reply',reply:''}];
 const missing=mergeMailbox(thread,[{id:'r2',text:'q2',created:2,status:'awaiting_reply',reply:''}]);
 assert.equal(missing.length,2);assert.equal(missing[0].reply,'done');assert.equal(missing[0].status,'replied');
 const stale=mergeMailbox(thread,[{id:'r1',text:'q',created:1,status:'awaiting_reply',reply:''}]);
 assert.equal(stale[0].status,'replied');assert.equal(stale[0].reply,'done');
 assert.equal(forward('replied','awaiting_reply'),'replied');assert.equal(forward('awaiting_reply','replied'),'replied');assert.equal(forward('delivery_unconfirmed','awaiting_reply'),'awaiting_reply');assert.equal(forward('queued','sending'),'queued');assert.equal(forward('awaiting_reply','not_delivered'),'not_delivered');
});
test('activity comes only from the latest answer, and a sent message is matched by its request id',()=>{
 const thread=[{id:'r1',text:'a',created:1,status:'awaiting_reply',reply:'',activity:{phase:'writing',observed_at:9}},{id:'local-2',request_id:'req-2',text:'b',created:2,status:'sending',reply:'',local:true,photos:[{uri:'file:x'}]}];
 const merged=mergeMailbox(thread,[{id:'srv-2',request_id:'req-2',text:'b',created:2,status:'awaiting_reply',reply:'',activity:{phase:'responding',observed_at:10}}]);
 assert.equal(merged.length,2);assert.equal(merged[0].activity,null);assert.deepEqual(merged[1].activity,{phase:'responding',observed_at:10});
 assert.deepEqual(merged[1].photos,[{uri:'file:x'}]);assert.equal(merged[1].status,'awaiting_reply');
 const none=mergeMailbox(merged,[]);assert.ok(none.every(m=>m.activity==null));assert.equal(none.length,2);
});
test('every receipt that arrives together is applied once to the send it names',()=>{
 const thread=[mail('r1'),mail('r2'),{...mail('r3'),status:'replied'},{...mail('r4'),instruction:true}];
 const out=applyReceipts(thread,[{status:'completed',request:{request_id:'r1'}},{status:'failed',request:{request_id:'r2'}},{status:'completed',request:{request_id:'r3'}},{status:'completed',request:{request_id:'r4'}}]);
 assert.deepEqual(out.map(m=>m.status),['awaiting_reply','delivery_unconfirmed','replied','instruction_sent']);
 assert.equal(applyReceipts(out,[{status:'completed',request:{request_id:'zz'}}]),out);
});
test('stored photos show as a count and their names',()=>{
 assert.equal(attachmentSummary([],ko),'');assert.equal(attachmentSummary([{name:'a.jpg',bytes:1}],ko),'사진 1장 · a.jpg');assert.equal(attachmentSummary([{bytes:1},{bytes:2}],en),'2 photos');
});

// A fake relay: a request reaches it after its upload time, then is answered (or refused) at once.
function fakeRelay(){const arrived=[];return {arrived,send:(name,upload,refuse=false)=>()=>new Promise((ok,fail)=>setTimeout(()=>{arrived.push(name);refuse?fail(Object.assign(Error('Refused'),{status:400})):ok({status:'sent'});},upload))};}
test('one session\'s sends reach the relay in order: a slow photo send first, then a quick text',async()=>{
 const lanes=new Map(),relay=fakeRelay();
 const first=inTurn(lanes,'dev:s1',relay.send('1 photo',300)),second=inTurn(lanes,'dev:s1',relay.send('2 text',10));
 await Promise.all([first,second]);
 assert.deepEqual(relay.arrived,['1 photo','2 text']);assert.equal(lanes.size,0);
});
test('another session does not wait for this session\'s slow upload',async()=>{
 const lanes=new Map(),relay=fakeRelay();
 const slow=inTurn(lanes,'dev:s1',relay.send('A photo',300));await inTurn(lanes,'dev:s2',relay.send('B text',10));
 assert.deepEqual(relay.arrived,['B text']);await slow;assert.deepEqual(relay.arrived,['B text','A photo']);
});
test('a refused send ends only its own turn: the next one still goes, in order, and the refusal stays definite',async()=>{
 const lanes=new Map(),relay=fakeRelay();
 const first=inTurn(lanes,'dev:s1',relay.send('1 refused',200,true)),second=inTurn(lanes,'dev:s1',relay.send('2 next',10));
 const failure=await first.then(()=>null,e=>e);assert.equal(sendOutcome(failure),'failed');
 assert.deepEqual(await second,{status:'sent'});assert.deepEqual(relay.arrived,['1 refused','2 next']);
});
