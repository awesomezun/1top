// /app is the desktop dashboard itself: agent/onetop/dist's markup, styles and scripts, served at
// /dashboard/ and never copied into the site, plus src/remote-app.js, which runs first and answers
// the dashboard's /api/* requests from relay snapshots. Remote-only markup changes are listed here.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const DIST=fileURLToPath(new URL('../../agent/onetop/dist/',import.meta.url));
const TYPES={css:'text/css',js:'text/javascript',png:'image/png',json:'application/json'};
const file=name=>readFileSync(DIST+name);
const url=name=>`/dashboard/${name}?v=${createHash('sha256').update(file(name)).digest('hex').slice(0,10)}`;

// Every asset the dashboard's index.html loads, in its order.
export function dashboardFiles(){
 const html=file('index.html').toString();
 // benchmark.json is fetched by app.js for Measurements.
 return [...html.matchAll(/(?:href|src)="\/([\w.-]+\.(?:css|js|png))"/g)].map(m=>m[1]).concat('benchmark.json');
}

const REMOTE_FOOT='<div class="rail-bottom"><i class="dot green"></i> <span id="remoteIdentity" data-user-content>원격 워크스페이스</span><br><small id="localVersion">REMOTE</small><a class="remote-link" id="remoteHome" href="/" data-user-content>1top.si ↗</a><button id="remoteSignOut" type="button" data-user-content hidden>로그아웃</button><button id="helpButton">수치와 제어 이해하기 ↗</button></div></aside>';
function replaceOnce(text,pattern,value){
 const count=typeof pattern==='string'?text.split(pattern).length-1:(text.match(new RegExp(pattern.source,'g'))||[]).length;
 if(count!==1)throw Error(`Dashboard markup changed: expected one ${pattern}, found ${count}`);
 return text.replace(pattern,value);
}

export function dashboardMarkup(){
 const html=file('index.html').toString();
 const head=html.slice(html.indexOf('<head>'),html.indexOf('</head>'));
 const assets=[...head.matchAll(/<link rel="stylesheet" href="\/([\w.-]+)">|<script defer src="\/([\w.-]+)"><\/script>/g)]
  .map(m=>m[1]?`<link rel="stylesheet" href="${url(m[1])}">`:`<script defer src="${url(m[2])}"></script>`).join('');
 let body=html.slice(html.indexOf('<body>')+6,html.indexOf('</body>'));
 body=replaceOnce(body,'src="/brand-mark_v1.1.0.png"',`src="${url('brand-mark_v1.1.0.png')}"`);
 body=replaceOnce(body,'<span class="brand-tag">LOCAL</span>','<span class="brand-tag">REMOTE</span>');
 body=replaceOnce(body,'<div class="breadcrumb">Workspace <span>/</span> This computer</div>','<div class="breadcrumb">Workspace <span>/</span> <span id="remoteScope" data-user-content>All computers</span></div>');
 body=replaceOnce(body,/<div class="rail-bottom">[\s\S]*?<\/div><\/aside>/,REMOTE_FOOT);
 body=replaceOnce(body,'<div id="notice" class="notice" hidden></div>','<div id="notice" class="notice" hidden></div><div id="remoteNotice" class="notice remote-notice" data-user-content hidden></div>');
 body=replaceOnce(body,'<section id="systemView" class="view" hidden>','<section id="systemView" class="view" hidden><section id="remoteComputers" class="remote-computers" data-user-content></section>');
 return {assets,body};
}

export function dashboardPages(){
 return {
  name:'1top-dashboard-pages',
  configureServer(server){
   server.middlewares.use((req,res,next)=>{
    const [path,query]=req.url.split('?');
    if(path==='/app'||path==='/app/'){req.url='/app.html'+(query?'?'+query:'');return next();}
    if(!path.startsWith('/dashboard/'))return next();
    const name=path.slice('/dashboard/'.length);
    if(!dashboardFiles().includes(name)){res.statusCode=404;return res.end();}
    res.setHeader('Content-Type',TYPES[name.split('.').pop()]);res.setHeader('Cache-Control','no-store');res.end(file(name));
   });
  },
  transformIndexHtml:{order:'post',handler(html,ctx){
   if(!ctx.path.endsWith('app.html'))return html;
   const {assets,body}=dashboardMarkup();
   return replaceOnce(replaceOnce(html,'</head>',assets+'</head>'),'<!--dashboard-body-->',body);
  }},
  generateBundle(){for(const name of dashboardFiles())this.emitFile({type:'asset',fileName:'dashboard/'+name,source:file(name)});}
 };
}
