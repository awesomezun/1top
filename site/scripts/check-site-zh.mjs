// Every t('English','한국어') call on the 1top.si pages carries a third, Chinese argument.
// node site/scripts/check-site-zh.mjs [file ...]   (default: the pages main.js renders and the landing)
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const src=fileURLToPath(new URL('../src/',import.meta.url));
const files=process.argv.slice(2).length?process.argv.slice(2):['main.js','relay-settings.js','mobile-connect.js','landing.js'].map(f=>src+f);
const str=String.raw`'(?:[^'\\]|\\.)*'`,two=new RegExp(String.raw`\bt\(\s*(${str})\s*,\s*(${str})\s*\)`,'g');
let missing=0;
for(const file of files){
 const text=readFileSync(file,'utf8'),found=[...text.matchAll(two)];
 for(const m of found)console.log(`${file.replace(src,'site/src/')}: no Chinese for ${m[1].slice(0,70)}`);
 missing+=found.length;
}
console.log(`${files.length} files, ${missing} texts without Chinese`);
process.exit(missing?1:0);
