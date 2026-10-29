// Every Korean text the collector writes for people (agent/onetop/*.py) reads in English and Chinese on
// the dashboard, and the names the dashboard or the collector gives a project, a location or an account
// are translated even where names are kept as written.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';

const dist=new URL('../agent/onetop/dist/',import.meta.url),agent=new URL('../agent/onetop/',import.meta.url);
const context={document:{documentElement:{},body:null,dispatchEvent(){}},Event:class{},MutationObserver:class{observe(){}disconnect(){}},NodeFilter:{SHOW_TEXT:4},queueMicrotask};
context.window=context;vm.createContext(context);vm.runInContext(readFileSync(new URL('i18n.js',dist),'utf8'),context);
const i18n=context.OneTopI18n,hangul=/[가-힣]/;

// Pieces the collector joins with a name or a number; the joined sentences are checked below instead.
const PIECES=new Set([' CLI를 먼저 설치해 주세요.','Codex 계정 ','Claude 계정 ','터미널 제목을 ','(으)로 변경했습니다.',' 터미널로 이동했습니다.',' 새 작업 시작을 확인했습니다.',' 실제 시작은 상태 갱신으로 확인합니다.']);
// Sent to the AI as written, and shown as it will be sent.
const SENT=new Set(['이전에 중단된 작업을 이어서 진행해 주세요. 먼저 현재 진행 상태와 이미 완료한 변경을 확인하고, 중복 실행을 피해서 계속해 주세요.']);
const JOINED=['Claude Code CLI를 먼저 설치해 주세요.','Codex CLI를 먼저 설치해 주세요.','Codex 계정 1a2b3c','Claude 계정 4f21a8','터미널 제목을 Checkout UI(으)로 변경했습니다.',
 'Checkout UI 터미널로 이동했습니다.','이어서 작업하는 새 요청을 보냈습니다. 새 작업 시작을 확인했습니다.','이어서 작업하는 새 요청을 보냈습니다. 실제 시작은 상태 갱신으로 확인합니다.'];

const texts=new Set(JOINED);
for(const file of readdirSync(agent).filter(f=>f.endsWith('.py')&&f!=='windows_text.py')){
 const code=readFileSync(new URL(file,agent),'utf8');
 for(const m of code.matchAll(/(^|[^A-Za-z_])([fbr]?)(['"])((?:\\.|(?!\3).)*?)\3/gm)){
  const text=m[4].replace(/\\'/g,"'").replace(/\\"/g,'"');
  if(!hangul.test(text)||m[2]==='f'||PIECES.has(text)||SENT.has(text))continue;
  texts.add(text);
 }
}
const missing=[];
for(const language of ['en','zh']){
 i18n.setLanguage(language);
 for(const text of texts){const shown=i18n.t(text);if(hangul.test(shown))missing.push(`${language}: ${text} → ${shown}`);}
}
assert.deepEqual(missing,[],'collector texts left in Korean');
assert.ok(texts.size>80,`read ${texts.size} collector texts`);

// Names inside the parts kept as written: translated on the page, and back to Korean with the language.
const page=new vm.Script(`
 const nodes=[];const make=(text,kept)=>{const node={nodeValue:text,parentElement:{closest:()=>kept}};nodes.push(node);return node;};
 const names=[make('Aside 기본 작업공간',true),make('Claude 계정 4f21a8 · Pro',true),make('checkout-web',true),make('위치 미확인',true)];
 let index=0;document.body={};document.createTreeWalker=()=>({nextNode:()=>nodes[index++]||null});document.querySelectorAll=()=>[];
 globalThis.__names=names;globalThis.__reset=()=>{index=0;};`);
page.runInContext(context);
const shown=()=>Array.from(context.__names,n=>n.nodeValue);
i18n.setLanguage('en');assert.deepEqual(shown(),['Aside default workspace','Claude account 4f21a8 · Pro','checkout-web','Location unknown']);
context.__reset();i18n.setLanguage('zh');assert.deepEqual(shown(),['Aside 默认工作区','Claude 账户 4f21a8 · Pro','checkout-web','位置未知']);
context.__reset();i18n.setLanguage('ko');assert.deepEqual(shown(),['Aside 기본 작업공간','Claude 계정 4f21a8 · Pro','checkout-web','위치 미확인']);
console.log(`Collector texts: ${texts.size} Korean texts read in English and Chinese, and given names translated where names are kept as written passed.`);
