import {test} from 'node:test';
import assert from 'node:assert/strict';
const {base64Bytes,fitted,fitPlan,fitPhoto,checkAttachments,sendMode,defaultPrompt,deliveryLabel,deliveryTone,effectiveStatus,workState,workLabel,sendOutcome,attachmentSummary,responseActivity,activityLabel,PHOTO_LIMIT,EDGES,QUALITIES}=await import('../src/thread.ts');
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
test('a refused send keeps the draft; a timeout or dropped connection is only unconfirmed',()=>{
 assert.equal(sendOutcome({status:413}),'failed');assert.equal(sendOutcome({local:true}),'failed');assert.equal(sendOutcome({name:'AbortError'}),'unconfirmed');assert.equal(sendOutcome(new TypeError('Network request failed')),'unconfirmed');
});
test('stored photos show as a count and their names',()=>{
 assert.equal(attachmentSummary([],ko),'');assert.equal(attachmentSummary([{name:'a.jpg',bytes:1}],ko),'사진 1장 · a.jpg');assert.equal(attachmentSummary([{bytes:1},{bytes:2}],en),'2 photos');
});
