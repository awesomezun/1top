// Local synthetic desktop preview. No AI process or remote service is contacted.
// node scripts/preview-desktop.mjs [port] [--now <unix seconds>]
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:null;};
// --from <unix seconds> starts the clock at that moment and lets it run, for recordings of a busy moment.
const ROOT=resolve(arg('--root')||new URL('../',import.meta.url).pathname)+'/',HELD=Number(arg('--now'))||null,FROM=Number(arg('--from'))||null,OFF=FROM?FROM*1000-Date.now():0;
const clock=()=>HELD??(Date.now()+OFF)/1000;
const {demoState,demoHistory,demoMailbox}=await import(pathToFileURL(ROOT+'scripts/demo-state.mjs').href);
const {CONVERSATION}=await import(pathToFileURL(ROOT+'tests/fixtures/demo/demo-world.js').href),{scriptStep}=await import(pathToFileURL(ROOT+'tests/fixtures/demo/demo-model.js').href);
// Messages sent here, each moving through the script's steps at their times after sending.
const sent=[];
function converse(command,lang,now){
 if(sent.some(m=>m.id===command.request_id))return;
 const row={id:command.request_id,text:command.prompt,created:now,changed:now,status:'queued',reply:'',reply_at:null,truncated:false,activity:null,
  attachments:(command.attachments||[]).map((a,i)=>({name:`photo-${i+1}.jpg`,mime:a.mime,bytes:Math.round((a.data||'').length*.75)}))};
 sent.push(row);
 for(const step of CONVERSATION.script.steps)setTimeout(()=>{const at=clock();Object.assign(row,scriptStep(step,lang,at));row.changed=at;},step.at*1000);
}
const DIST=ROOT+'agent/onetop/dist/',PORT=Number(process.argv[2]??18874),ANCHOR=clock(),VERSION=demoState(clock()).version;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
const HOLD=HELD?`<script>(()=>{const Real=Date,at=${HELD*1000};window.Date=class extends Real{constructor(...a){super(...(a.length?a:[at]));}static now(){return at;}};})();</script>`:'';
const SHIFT=!HELD&&OFF?`<script>(()=>{const Real=Date,off=${OFF};window.Date=class extends Real{constructor(...a){super(...(a.length?a:[Real.now()+off]));}static now(){return Real.now()+off;}};})();</script>`:'';
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://x'),now=clock(),q=Object.fromEntries(url.searchParams);
 // What people wrote follows the browser's language.
 const lang=(req.headers['accept-language']||'ko').slice(0,2).replace(/^(?!en|zh).*/,'ko');
 try{
  if(url.pathname==='/health')return json(res,200,{ok:true,version:VERSION,edition:'desktop-demo',checkout:ROOT.split('/').filter(Boolean).pop()});
  if(url.pathname==='/api/state')return json(res,200,demoState(now,{period:q.period||'1h',anchor:ANCHOR,lang}));
  if(url.pathname==='/api/history'){const h=demoHistory(now,{period:q.period||'1h',step:q.step||'60',kind:q.kind||null,anchor:ANCHOR});return json(res,h.status||200,h);}
  if(url.pathname==='/api/updates')return json(res,200,{version:VERSION,current:VERSION,available:false,release_url:'',status:'current',automatic_install:false,checked:now});
  if(url.pathname==='/api/mailbox'){let body='';for await(const c of req)body+=c;const {session_id}=JSON.parse(body||'{}');
   const rows=[...demoMailbox(session_id,ANCHOR,lang),...(session_id===CONVERSATION.session?sent:[])];
   return json(res,200,{ok:true,messages:rows.sort((a,b)=>b.changed-a.changed).slice(0,10).sort((a,b)=>a.created-b.created).map(({changed,...m})=>m)});}
  if(url.pathname==='/api/action'){let body='';for await(const c of req)body+=c;const command=JSON.parse(body||'{}');
   if(command.action==='message'&&command.session_id===CONVERSATION.session){converse(command,lang,now);return json(res,200,{ok:true,queued:true,status:'queued',message:''});}}
  if(url.pathname.startsWith('/api/'))return json(res,403,{ok:false,error:'This demo does not send controls.'});
  const path=normalize(join(DIST,url.pathname==='/'?'index.html':url.pathname));if(!path.startsWith(DIST))return json(res,404,{});
  let data=await readFile(path);
  if(extname(path)==='.html'&&(HOLD||SHIFT))data=data.toString().replace('<head>','<head>'+(HOLD||SHIFT));
  res.writeHead(200,{'Content-Type':TYPES[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch(e){json(res,404,{error:String(e.message||e)});}
}).listen(PORT,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,version:VERSION,edition:'desktop-demo'})));
