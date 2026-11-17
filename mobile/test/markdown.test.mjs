import {test} from 'node:test';
import assert from 'node:assert/strict';
const {markdown:md,inline}=await import('../src/markdown.ts');
// The desktop's assertions (tests/conversation.mjs), read as blocks and runs instead of HTML.
const p=(...lines)=>({type:'p',lines}),t=text=>({text}),list=(ordered,items,start=1)=>({type:'list',ordered,start,items}),item=(lines,lists=[])=>({lines,lists});

test('blocks: a bold line, then a list nested by indent with inline code; snake_case and 2 * 3 stay as written',()=>{
 assert.deepEqual(md('**1. 푸시**\n- `c974ed4` 올림\n  - 하위 snake_case 2 * 3'),[p([{text:'1. 푸시',bold:true}]),
  list(false,[item([[{text:'c974ed4',code:true},t(' 올림')]],[list(false,[item([[t('하위 snake_case 2 * 3')]])])])])]);
});
test('paragraphs keep single line breaks; a blank line between items keeps the list',()=>{
 assert.deepEqual(md('첫 줄\n둘째 줄'),[p([t('첫 줄')],[t('둘째 줄')])]);
 assert.deepEqual(md('1. 하나\n\n2. 둘'),[list(true,[item([[t('하나')]]),item([[t('둘')]])])]);
 assert.deepEqual(md('3) 셋\n4) 넷'),[list(true,[item([[t('셋')]]),item([[t('넷')]])],3)]);
});
test('task boxes, headings, fenced code kept as written, tables and quotes',()=>{
 assert.deepEqual(md('- [x] 끝\n- [ ] 남음'),[list(false,[item([[t('☑ 끝')]]),item([[t('☐ 남음')]])])]);
 assert.deepEqual(md('## 제목'),[{type:'h',level:2,runs:[t('제목')]}]);
 assert.deepEqual(md('```\n<b>x</b>\n```'),[{type:'code',text:'<b>x</b>'}]);
 assert.deepEqual(md('~~~sh\n**not bold**\n  indented\n~~~'),[{type:'code',text:'**not bold**\n  indented'}]);
 assert.deepEqual(md('| a | b |\n|---|---|\n| 1 | **2** |'),[{type:'table',head:[[t('a')],[t('b')]],rows:[[[t('1')],[{text:'2',bold:true}]]]}]);
 assert.deepEqual(md('| a | b |\n|:-|-:|\n| 1 |'),[{type:'table',head:[[t('a')],[t('b')]],rows:[[[t('1')],[]]]}]);
 assert.deepEqual(md('> 인용\n---'),[{type:'quote',blocks:[p([t('인용')])]},{type:'hr'}]);
});
test('only http(s) links, bare addresses without trailing punctuation, and nothing from the reply runs',()=>{
 assert.deepEqual(md('[문서](https://x.com/?a=1&b=2)와 https://1top.si/app.'),[p([{text:'문서',link:'https://x.com/?a=1&b=2'},t('와 '),{text:'https://1top.si/app',link:'https://1top.si/app'},t('.')])]);
 assert.deepEqual(md('[x](javascript:alert(1)) <img src=x onerror=a()>'),[p([t('[x](javascript:alert(1)) <img src=x onerror=a()>')])]);
 assert.deepEqual(inline('[**굵은** 링크](http://a.b/c)'),[{text:'굵은',bold:true,link:'http://a.b/c'},{text:' 링크',link:'http://a.b/c'}]);
 assert.deepEqual(inline('ftp://a.b mailto:x@y.z'),[t('ftp://a.b mailto:x@y.z')]);
});
test('strike, italic and bold, by either mark',()=>{
 assert.deepEqual(md('~~옛~~ *기울임* _도_ __굵게__'),[p([{text:'옛',strike:true},t(' '),{text:'기울임',italic:true},t(' '),{text:'도',italic:true},t(' '),{text:'굵게',bold:true}])]);
 assert.deepEqual(inline('**굵게 `코드`**'),[{text:'굵게 ',bold:true},{text:'코드',bold:true,code:true}]);
 assert.deepEqual(inline('a_b_c *x* y'),[t('a_b_c '),{text:'x',italic:true},t(' y')]);
});
test('a list switches kind beside itself and comes back out of a deeper level',()=>{
 assert.deepEqual(md('- a\n1. b'),[list(false,[item([[t('a')]])]),list(true,[item([[t('b')]])])]);
 assert.deepEqual(md('- a\n    - b\n  - c\n- d'),[list(false,[item([[t('a')]],[list(false,[item([[t('b')]])]),list(false,[item([[t('c')]])])]),item([[t('d')]])])]);
 assert.deepEqual(md('- a\n  이어짐\n\n다음'),[list(false,[item([[t('a')],[t('이어짐')]])]),p([t('다음')])]);
 assert.deepEqual(md(''),[]);assert.deepEqual(md(null),[]);
});
