// An agent's reply in Markdown, read by the same rules as the desktop's conversation (agent/onetop/dist/conversation.js):
// paragraphs keep their line breaks; headings, lists nested by indent (with task boxes), quotes, fenced code, tables and
// rules; inline code, bold, italic, strike and http(s) links. Pure functions that return blocks and runs of text for the
// conversation to draw; nothing in a reply runs, and only http(s) addresses become links.

export type Run={text:string;bold?:true;italic?:true;strike?:true;code?:true;link?:string};
export type Item={lines:Run[][];lists:List[]};
export type List={type:'list';ordered:boolean;start:number;items:Item[]};
export type Block={type:'p';lines:Run[][]}|{type:'h';level:number;runs:Run[]}|{type:'hr'}|{type:'code';text:string}
 |{type:'quote';blocks:Block[]}|{type:'table';head:Run[][];rows:Run[][][]}|List;

// Marks open and close as private-use characters, while code and links are held aside as \0n\0 so no mark starts
// inside them; the marked text is then read once into runs. The patterns are the desktop's.
const B0='',B1='',I0='',I1='',S0='',S1='';
const em=(s:string)=>s.replace(/\*\*(\S(?:[^*]*?\S)?)\*\*|__(\S(?:[^_]*?\S)?)__/g,(_,a,b)=>B0+(a??b)+B1)
 .replace(/~~(\S(?:[^~]*?\S)?)~~/g,S0+'$1'+S1)
 .replace(/(^|[^\w*])\*(\S(?:[^*\n]*?\S)?)\*(?![\w*])/g,'$1'+I0+'$2'+I1)
 .replace(/(^|[^\w_])_(\S(?:[^_\n]*?\S)?)_(?![\w_])/g,'$1'+I0+'$2'+I1);
const same=(a:Run,b:Run)=>!a.code&&!b.code&&a.bold===b.bold&&a.italic===b.italic&&a.strike===b.strike&&a.link===b.link;
// A held run takes the marks around it; neighbours with the same marks join.
function read(s:string,keep:Run[][]):Run[]{
 const out:Run[]=[],on={bold:0,italic:0,strike:0};
 const put=(r:Run)=>{
  if(!r.text)return;const x:Run={text:r.text};
  if(on.bold||r.bold)x.bold=true;if(on.italic||r.italic)x.italic=true;if(on.strike||r.strike)x.strike=true;if(r.code)x.code=true;if(r.link)x.link=r.link;
  const last=out.at(-1);if(last&&same(last,x))last.text+=x.text;else out.push(x);
 };
 for(const part of s.split(/(\u0000\d+\u0000|[-])/)){
  const held=part.match(/^\u0000(\d+)\u0000$/);
  if(held)keep[+held[1]].forEach(put);
  else if(part===B0||part===B1)on.bold=Math.max(0,on.bold+(part===B0?1:-1));
  else if(part===I0||part===I1)on.italic=Math.max(0,on.italic+(part===I0?1:-1));
  else if(part===S0||part===S1)on.strike=Math.max(0,on.strike+(part===S0?1:-1));
  else put({text:part});
 }
 return out;
}
export function inline(text:string):Run[]{
 const keep:Run[][]=[],hold=(r:Run[])=>`\u0000${keep.push(r)-1}\u0000`;
 const s=String(text).replace(/[\u0000-]/g,'')
  .replace(/`([^`\n]+)`/g,(_,c)=>hold([{text:c,code:true}]))
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)\u0000]+)\)/g,(_,t,u)=>hold(read(em(t),keep).map(r=>({...r,link:u}))))
  .replace(/https?:\/\/[^\s\u0000"'<>]+/g,u=>{const end=u.match(/[.,;:!?)\]]+$/)?.[0]||'',href=u.slice(0,u.length-end.length);return hold([{text:href,link:href}])+end;});
 return read(em(s),keep);
}

const LIST=/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/,RULE=/^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/,FENCE=/^\s*(`{3,}|~{3,})/;
const SPLIT=/^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/,cells=(l:string)=>l.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
const table=(a:string,b:string|undefined)=>a.includes('|')&&(b||'').includes('-')&&SPLIT.test(b||'');
const opens=(l:string,next:string|undefined)=>FENCE.test(l)||/^\s{0,3}#{1,6}\s/.test(l)||/^\s*>/.test(l)||RULE.test(l)||LIST.test(l)||table(l,next);
type Raw={indent:number;ordered:boolean;number:number;text:string};
// Deeper items open a list inside the item above; an item of the other kind at the same depth starts a list beside it.
function lists(items:Raw[]):List[]{
 const top:List[]=[],stack:{indent:number;list:List;home:List[]}[]=[];
 for(const it of items){
  const item:Item={lines:it.text.replace(/^\[([ xX])\]\s+/,(_,x)=>x===' '?'☐ ':'☑ ').split('\n').map(inline),lists:[]};
  const list=():List=>({type:'list',ordered:it.ordered,start:it.number,items:[item]});
  while(stack.length&&it.indent<stack[stack.length-1].indent)stack.pop();
  const last=stack.at(-1);
  if(!last||it.indent>last.indent){const home=last?last.list.items[last.list.items.length-1].lists:top,l=list();home.push(l);stack.push({indent:it.indent,list:l,home});}
  else if(last.list.ordered!==it.ordered){last.list=list();last.home.push(last.list);}
  else last.list.items.push(item);
 }
 return top;
}
export function markdown(text:string|null|undefined):Block[]{
 const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n'),out:Block[]=[];let i=0,m:RegExpMatchArray|null;
 while(i<lines.length){
  const l=lines[i];
  if(!l.trim()){i++;continue;}
  if((m=l.match(FENCE))){const fence=m[1],body:string[]=[];i++;while(i<lines.length&&!lines[i].trim().startsWith(fence))body.push(lines[i++]);i++;out.push({type:'code',text:body.join('\n')});continue;}
  if((m=l.match(/^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/))){out.push({type:'h',level:m[1].length,runs:inline(m[2])});i++;continue;}
  if(RULE.test(l)){out.push({type:'hr'});i++;continue;}
  if(/^\s*>/.test(l)){const body:string[]=[];while(i<lines.length&&/^\s*>/.test(lines[i]))body.push(lines[i++].replace(/^\s*>\s?/,''));out.push({type:'quote',blocks:markdown(body.join('\n'))});continue;}
  if(table(l,lines[i+1])){
   const head=cells(l);i+=2;const rows:string[][]=[];while(i<lines.length&&lines[i].includes('|')&&lines[i].trim())rows.push(cells(lines[i++]));
   out.push({type:'table',head:head.map(inline),rows:rows.map(r=>head.map((_,k)=>inline(r[k]??'')))});continue;}
  if(LIST.test(l)){
   // An item runs on over indented lines; a blank line between items keeps the list going.
   const items:Raw[]=[];
   while(i<lines.length){
    const x=lines[i],li=x.match(LIST);
    if(li&&!RULE.test(x)){items.push({indent:li[1].replace(/\t/g,'  ').length,ordered:/\d/.test(li[2]),number:parseInt(li[2],10)||1,text:li[3]});i++;}
    else if(x.trim()&&/^\s{2,}/.test(x)&&items.length&&!FENCE.test(x)){items[items.length-1].text+='\n'+x.trim();i++;}
    else if(!x.trim()&&LIST.test(lines[i+1]||'')){i++;}
    else break;
   }
   out.push(...lists(items));continue;}
  const para:string[]=[];while(i<lines.length&&lines[i].trim()&&(!para.length||!opens(lines[i],lines[i+1])))para.push(lines[i++].trim());
  out.push({type:'p',lines:para.map(inline)});
 }
 return out;
}
