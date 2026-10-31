// Synthetic-only recording server for the v7.0.0 films (127.0.0.1:18868).
// Usage: node fixture_server.mjs <capture source folder> <ko|en|zh> [demo moment, unix seconds]
// With a demo moment the state and history hold there, as /app?demo&demoNow=… and the phones' QA option do, so
// every surface shows the same numbers; the conversation's own steps still run on from that moment.
// /api/state, /api/history and the mailbox come from scripts/demo-state.mjs at the demo moment (or the current second): invented
// projects and accounts, token use shaped like real work, in the scene's language. It never reads user data
// or contacts a collector, and refuses every control. The one exception is the conversation scene: a
// message to the checkout session follows the demo world's script (CONVERSATION.script), as on the web and the
// phones: queued, awaiting the reply, the session's phases, then the reply.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const SRC=resolve(process.argv[2]||'build/showcase_v7.0.0/src'),LANG=process.argv[3]||'ko',HELD=Number(process.argv[4])||null,BEGAN=Date.now()/1000;
// The demo's now: held at the demo moment, or the wall clock. The conversation's clock runs on from the same start.
const at=()=>HELD??Date.now()/1000,clock=()=>HELD?HELD+Date.now()/1000-BEGAN:Date.now()/1000;
const DIST=join(SRC,'agent/onetop/dist');
const {demoState,demoHistory,demoMailbox}=await import(pathToFileURL(join(SRC,'scripts/demo-state.mjs')).href);
const MIME={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',json:'application/json',
 png:'image/png',svg:'image/svg+xml',woff2:'font/woff2',ttf:'font/ttf',otf:'font/otf',ico:'image/x-icon'};
// The demo world's conversation (site/src/demo-world.js): its session, the messages it already holds and the
// script a sent message follows, the same on the web, the desktop and both phones.
const {CONVERSATION}=await import(pathToFileURL(join(SRC,'site/src/demo-world.js')).href);
const {scriptStep}=await import(pathToFileURL(join(SRC,'site/src/demo-model.js')).href);
const ANCHOR=HELD??BEGAN,TALK=CONVERSATION.session;
// Messages sent during the take, after the session's earlier ones.
const sent=[];

// Each step of the script comes when it says, counted from the send, as the web demo relay and the phones do.
function converse(command){
 const row={id:command.request_id,text:command.prompt,created:clock(),changed:clock(),status:'queued',reply:'',reply_at:null,truncated:false,activity:null,
  attachments:(command.attachments||[]).map((a,i)=>({name:`photo-${i+1}.jpg`,mime:a.mime,bytes:Math.round((a.data||'').length*.75)}))};
 sent.push(row);
 for(const step of CONVERSATION.script.steps)setTimeout(()=>{const at=clock();Object.assign(row,scriptStep(step,LANG,at));row.changed=at;},step.at*1000);
 return {ok:true,queued:true,status:'queued',message:''};
}
const body=req=>new Promise(done=>{let text='';req.on('data',c=>text+=c);req.on('end',()=>{try{done(JSON.parse(text||'{}'))}catch{done({})}});});
const send=(res,code,data,type=MIME.json)=>{res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));};

http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname,q=Object.fromEntries(url.searchParams),now=at();
 if(req.method==='POST'){
  const command=await body(req),ok=req.headers['x-monitor-token']===demoState(now,{anchor:ANCHOR,lang:LANG}).action_token&&command.session_id===TALK;
  if(path==='/api/action'&&ok&&command.action==='message')return send(res,200,converse(command));
  if(path==='/api/mailbox'&&ok){
   const rows=[...demoMailbox(TALK,ANCHOR,LANG),...sent];
   return send(res,200,{ok:true,messages:rows.sort((a,b)=>b.changed-a.changed).slice(0,10).sort((a,b)=>a.created-b.created).map(({changed,...m})=>m)});
  }
  return send(res,403,{ok:false,message:'Recording fixture: controls disabled'});
 }
 if(path==='/api/state'){
  // The numbers hold at the demo moment, but the report is as new as the clock that runs on from it: the dashboard
  // and the panel read a report older than 20 seconds as a lost collector.
  const state=demoState(now,{period:q.period||'1h',anchor:ANCHOR,lang:LANG});if(HELD)state.updated=clock();
  return send(res,200,state);
 }
 if(path==='/api/history'){const h=demoHistory(now,{period:q.period||'1h',step:q.step||'60',kind:q.kind||null,anchor:ANCHOR});return send(res,h.status||200,h);}
 if(path==='/api/updates')return send(res,200,{available:false,status:'current',automatic_install:false,checked:now});
 const file=normalize(join(DIST,path==='/'?'index.html':path));
 if(!file.startsWith(DIST))return send(res,404,'');
 try{send(res,200,await readFile(file),MIME[extname(file).slice(1)]||'application/octet-stream');}catch{send(res,404,'');}
}).listen(18868,'127.0.0.1');
