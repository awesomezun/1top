// Lists the Korean interface texts of the app dashboard (agent/onetop/dist, also 1top.si/app) that
// i18n.js leaves Korean in Chinese. The dashboard is written in Korean and i18n.js translates the
// page as it renders, so each text in the markup and scripts is put through that same translation.
// Texts that were already untranslated are kept in check-zh-baseline.json; a new one fails the check.
// node site/scripts/check-zh.mjs [--list] [--write-baseline]
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';

const dist=name=>readFileSync(new URL('../../agent/onetop/dist/'+name,import.meta.url),'utf8');
const BASELINE=new URL('./check-zh-baseline.json',import.meta.url);
const context={window:{},document:{body:null,documentElement:{}},MutationObserver:class{observe(){}disconnect(){}},NodeFilter:{},queueMicrotask};
vm.runInNewContext(dist('i18n.js'),context);
const i18n=context.window.OneTopI18n;i18n.setLanguage('zh');
const hangul=/[가-힣]/;

// Texts that are content, not interface: what a photo-only message says to the AI (sent in the chosen
// language), and a workspace name.
const CONTENT=new Set(['첨부한 사진을 확인해 주세요.','Aside 기본 작업공간']);
const texts=new Map();
const add=(text,where)=>{text=text.replace(/\s+/g,' ').trim();if(hangul.test(text)&&!CONTENT.has(text)&&!texts.has(text))texts.set(text,where);};
// A template part can start or end inside a tag; its attribute hints are read, the tag edges dropped.
const addHtml=(text,where)=>{
 for(const m of text.matchAll(/(?:aria-label|title|placeholder)="([^"$]+)"/g))add(m[1],where);
 for(const part of text.replace(/^[^<>]*>/,'').replace(/<[^>]*$/,'').split(/<[^>]*>/))add(part.replace(/&nbsp;/g,' '),where);
};

// Markup: text between tags and the attributes read aloud or shown as hints.
const html=dist('index.html').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g,'');
for(const m of html.matchAll(/>([^<>]+)</g))add(m[1],'index.html');
for(const m of html.matchAll(/(?:aria-label|title|placeholder)="([^"]+)"/g))add(m[1],'index.html');

// Scripts: every string literal and every text part of a template literal, including the ones
// inside ${...}, read with a small tokenizer so nested templates and quotes keep their place.
function strings(source,emit){
 let i=0;const n=source.length;
 const quoted=q=>{let s='';i++;while(i<n&&source[i]!==q){if(source[i]==='\\'){s+=source[i+1];i+=2;continue;}s+=source[i++];}i++;return s;};
 // A regular expression literal holds quotes and braces that are not code: skip it whole.
 function regex(){i++;let klass=false;while(i<n){const c=source[i];if(c==='\\'){i+=2;continue;}if(c==='[')klass=true;else if(c===']')klass=false;else if(c==='/'&&!klass){i++;break;}else if(c==='\n')break;i++;}}
 function template(){
  let part='';i++;
  while(i<n&&source[i]!=='`'){
   if(source[i]==='\\'){part+=source[i+1];i+=2;continue;}
   if(source[i]==='$'&&source[i+1]==='{'){emit(part,true);part='';i+=2;code('}');i++;continue;}
   part+=source[i++];
  }
  emit(part,true);i++;
 }
 function code(end){
  let depth=0;
  while(i<n){
   const c=source[i];
   if(c==='/'&&source[i+1]==='/'){while(i<n&&source[i]!=='\n')i++;continue;}
   if(c==='/'&&source[i+1]==='*'){i=source.indexOf('*/',i+2)+2;continue;}
   if(c==="'"||c==='"'){emit(quoted(c),false);continue;}
   if(c==='/'&&/[(,=:[!&|?{};+\-*%<>~^]$|^$/.test(source.slice(Math.max(0,i-30),i).trimEnd().slice(-1))){regex();continue;}
   if(c==='`'){template();continue;}
   if(c==='{')depth++;
   if(c==='}'){if(!depth&&end==='}')return;depth--;}
   i++;
  }
 }
 code(null);
}
const SCRIPTS=['app.js','dashboard.js','conversation.js','history.js','weekly.js','speed.js','effects.js','ranges.js'];
for(const file of SCRIPTS)strings(dist(file),(text,markup)=>markup||/[<>]/.test(text)?addHtml(text,file):add(text,file));

const missing=[...texts].filter(([text])=>hangul.test(i18n.t(text)));
if(process.argv.includes('--write-baseline')){writeFileSync(BASELINE,JSON.stringify(missing.map(([text])=>text).sort(),null,1)+'\n');console.log(`Baseline: ${missing.length} texts`);process.exit(0);}
const known=new Set(JSON.parse(readFileSync(BASELINE,'utf8'))),fresh=missing.filter(([text])=>!known.has(text));
const fixed=[...known].filter(text=>!missing.some(([m])=>m===text));
console.log(`${texts.size} Korean texts, ${missing.length} without Chinese (${fresh.length} new, ${missing.length-fresh.length} known), ${fixed.length} known now translated`);
if(process.argv.includes('--list'))for(const [text,file] of missing)console.log(known.has(text)?'KNOWN':'MISSING',file,JSON.stringify(text));
for(const [text,file] of fresh)console.log('NEW',file,JSON.stringify(text));
process.exit(fresh.length?1:0);
