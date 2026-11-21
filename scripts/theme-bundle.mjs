// Writes the phones' theme page: the dashboard's themes (agent/onetop/dist/themes) and scripts/theme-host.js in one
// HTML, for the iPhone (a bundle resource its WKWebView loads) and Android (a string its WebView loads).
//   node scripts/theme-bundle.mjs          write both
//   import {files} from './scripts/theme-bundle.mjs'   what they should hold, for the checks
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';

const at=p=>new URL('../'+p,import.meta.url);
const read=p=>readFileSync(at(p),'utf8');
const THEMES='agent/onetop/dist/themes/';
const STYLE=`html,body{margin:0;padding:0;background:transparent;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;-webkit-text-size-adjust:100%}
#art svg{display:block;width:100%;height:auto}
#art svg *{pointer-events:none}#art :is([data-cl-alert],[data-cl-period],[data-cl-trip]),#art :is([data-cl-alert],[data-cl-period],[data-cl-trip]) *{pointer-events:all}
body.side{background:#000;overflow:hidden}body.side #art{position:fixed;left:50%;top:50%;width:calc(100vh - 32px);transform:translate(-50%,-50%) rotate(90deg)}
body.picking #art{display:none}
.ot-pair{display:flex;align-items:center;justify-content:center}.ot-cut{min-width:0}.ot-cut>svg{display:block;width:100%;height:100%}
#gallery{font:14px/1.4 -apple-system,system-ui,sans-serif;color:#e9ebef;padding:0 0 24px}
@media (prefers-color-scheme:light){#gallery{color:#15171b}}
#gallery .kinds{display:flex;gap:6px;padding:4px 2px 12px;overflow-x:auto}
#gallery .kinds button{font:600 13px system-ui;padding:6px 12px;border-radius:99px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit}
#gallery .kinds button[aria-pressed=true]{background:rgba(128,128,128,.22)}
#gallery .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
#gallery .card{display:grid;gap:4px;text-align:left;padding:8px;border-radius:14px;border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.06);color:inherit;font:inherit}
#gallery .card.on{border-color:#5ee08f;box-shadow:0 0 0 1px #5ee08f}
#gallery .prev{display:block;aspect-ratio:1280/480;border-radius:8px;overflow:hidden;background:#07090b}#gallery .prev svg{display:block;width:100%;height:100%}
#gallery b{font-size:14px}#gallery small{opacity:.65;font-size:12px}`;

export function html(){
 const names=readdirSync(at(THEMES)).filter(n=>/^t\d\d-\d\d\.js$/.test(n)).sort();
 const js=['core.js',...names,'pairs.js','compact.js'].map(n=>read(THEMES+n)).concat(read('scripts/theme-host.js'));
 return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>${STYLE}</style></head>`
  +`<body><div id="art"></div><div id="gallery"></div>${js.map(s=>`<script>${s.replace(/<\/script/gi,'<\\/script')}</script>`).join('')}</body></html>\n`;
}
// The app's copy of the kinds (the gallery's narrowing), from the dashboard's catalog.
const kinds=()=>Object.fromEntries(JSON.parse(read(THEMES+'catalog.json')).map(c=>[c.rank,c.type]));
// The themes run once: each one's name (the customizing list names the look chosen) and the width over height of its
// two instruments cut out (themes/compact.js), which sizes the phones' view of them.
let ran=null;
function themes(){
 if(ran)return ran;const box={};box.window=box;vm.createContext(box);
 for(const n of ['core.js',...readdirSync(at(THEMES)).filter(n=>/^t\d\d-\d\d\.js$/.test(n)).sort(),'pairs.js','compact.js'])vm.runInContext(read(THEMES+n),box);
 const list=box.OneTop.THEMES.slice().sort((a,b)=>a.id.localeCompare(b.id));
 return ran={names:Object.fromEntries(list.map(t=>[t.id,t.name])),compact:Object.fromEntries(list.map(t=>[t.id,Math.round(box.OneTop.compactAspect(t.id)*1e4)/1e4]))};
}
const names=()=>themes().names,compact=()=>themes().compact;
export function files(){
 const page=html();
 return [['ios/OneTop/Resources/ThemeHost.html',page],
  ['mobile/src/theme-host.ts',`// Written by scripts/theme-bundle.mjs from the dashboard's themes; do not edit.\nexport const THEME_HOST=${JSON.stringify(page)};\nexport const THEME_KINDS:Record<string,string>=${JSON.stringify(kinds())};\nexport const THEME_NAMES:Record<string,string>=${JSON.stringify(names())};\nexport const THEME_COMPACT:Record<string,number>=${JSON.stringify(compact())};\n`],
  ['ios/OneTop/Resources/ThemeKinds.json',JSON.stringify(kinds())+'\n'],
  ['ios/OneTop/Resources/ThemeNames.json',JSON.stringify(names())+'\n'],
  ['ios/OneTop/Resources/ThemeCompact.json',JSON.stringify(compact())+'\n']];
}
if(import.meta.url===`file://${process.argv[1]}`)for(const [p,text] of files()){writeFileSync(at(p),text);console.log(p,text.length);}
