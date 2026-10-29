// Lists every English text the /app dashboard can show that has no Chinese yet.
// node site/scripts/check-zh.mjs [--list]   (exit code 1 when anything is missing)
import {readFileSync} from 'node:fs';
import {ZH,zhText} from '../src/zh.js';

const src=f=>readFileSync(new URL('../src/'+f,import.meta.url),'utf8');
// Pages other than /app fall back to English, so their functions are not checked.
const OTHER_PAGES=['landing','privacy','renderConnect','approvePair','releaseStatus','renderSettings','relayConsent'];

function calls(text,name){
 const found=[],re=new RegExp(`(^|[^\\w$.])${name}\\(`,'g');let m;
 while((m=re.exec(text))){let i=m.index+m[0].length,depth=1,arg='',args=[],quote=null;
  for(;i<text.length&&depth>0;i++){const c=text[i];
   if(quote){arg+=c;if(c==='\\'){arg+=text[++i];continue;}if(c===quote)quote=null;continue;}
   if(c==="'"||c==='"'||c==='`'){quote=c;arg+=c;continue;}
   if('([{'.includes(c))depth++;if(')]}'.includes(c))depth--;
   if(depth===0)break;if(depth===1&&c===','){args.push(arg.trim());arg='';continue;}arg+=c;}
  args.push(arg.trim());found.push(args);}
 return found;
}
const literal=a=>{const m=a.match(/^(['"])((?:\\.|(?!\1).)*)\1$/s)||a.match(/^`([^`$]*)`$/s);return m?(m[2]??m[1]).replace(/\\'/g,"'").replace(/\\"/g,'"'):null;};

function withoutOtherPages(text){
 for(const fn of OTHER_PAGES){const i=text.indexOf(`function ${fn}(`);if(i<0)continue;const j=text.indexOf('\nfunction ',i+1),k=text.indexOf('\nasync function ',i+1);const end=Math.min(...[j,k].filter(x=>x>0),text.length);text=text.slice(0,i)+text.slice(end);}
 return text;
}
const sources={'main.js':withoutOtherPages(src('main.js')),'cockpit.js':src('cockpit.js'),'usage-maps.js':src('usage-maps.js'),'session-mailbox.js':src('session-mailbox.js')};
const missing=new Set(),dynamic=[];let checked=0;
for(const [file,text] of Object.entries(sources))for(const args of calls(text,'t')){
 if(args.length<2)continue;const en=literal(args[0]);
 if(en===null){if(args.length<3)dynamic.push(file+': t('+args[0].slice(0,70)+')');continue;}
 checked++;if(args.length<3&&zhText(en)===en&&!(en in ZH))missing.add(en);
}
// maps.js is shared with the desktop dashboard and speaks only ko/en; its English is translated on the page.
for(const args of calls(src('maps.js'),'text')){const en=literal(args[1]||'');if(en===null)continue;checked++;const key=en.trim();if(!(key in ZH)&&zhText(key)===key)missing.add(key);}
console.log(`${checked} texts, ${Object.keys(ZH).length} entries, ${missing.size} missing, ${dynamic.length} dynamic without Chinese`);
if(process.argv.includes('--list')){for(const m of missing)console.log('MISSING',JSON.stringify(m));for(const d of dynamic)console.log('DYNAMIC',d);}
process.exit(missing.size||dynamic.length?1:0);
