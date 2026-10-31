// Used by tests/dashboard-browser.py. Text and blocks of the cluster that fall outside its housing's curved edge, and text boxes that overlap.
(()=>{const c=document.querySelector('#clusterView .cluster');if(!c)return {missing:true};const body=c.querySelector('.cl-body'),b=body.getBoundingClientRect(),cs=getComputedStyle(body);
 const rad=k=>{const v=cs[k].split(' ').map(parseFloat),x=v[0],y=v[1]??v[0];return [Math.min(x,b.width/2),Math.min(y,b.height/2)];};
 const R={tl:rad('borderTopLeftRadius'),tr:rad('borderTopRightRadius'),br:rad('borderBottomRightRadius'),bl:rad('borderBottomLeftRadius')};
 const corner=(x,y,cx,cy,[rx,ry],sx,sy)=>{const dx=(x-cx)*sx,dy=(y-cy)*sy;return dx<=0||dy<=0||(dx/rx)**2+(dy/ry)**2<=1.0001;};
 const inside=(x,y)=>x>=b.left-.5&&x<=b.right+.5&&y>=b.top-.5&&y<=b.bottom+.5&&corner(x,y,b.left+R.tl[0],b.top+R.tl[1],R.tl,-1,-1)&&corner(x,y,b.right-R.tr[0],b.top+R.tr[1],R.tr,1,-1)
  &&corner(x,y,b.right-R.br[0],b.bottom-R.br[1],R.br,1,1)&&corner(x,y,b.left+R.bl[0],b.bottom-R.bl[1],R.bl,-1,1);
 const shown=e=>{if(e.closest('[hidden],.cl-tip,.cl-range'))return false;const r=e.getBoundingClientRect();if(!r.width||!r.height)return false;for(let n=e;n&&n!==c;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0')return false;}return true;};
 const boxOut=r=>![[r.left,r.top],[r.right,r.top],[r.left,r.bottom],[r.right,r.bottom]].every(([x,y])=>inside(x,y));
 const wheel=e=>e.closest('.cl-odo>[role=img]');
 const texts=[...c.querySelectorAll('*')].filter(e=>!wheel(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&shown(e));
 const blocks=[...c.querySelectorAll('.cl-top,.cl-dial,.cl-window,.cl-gear>[role=group],.cl-left,.cl-odo>[role=img],.cl-trip')].filter(shown);
 const name=e=>(e.className?.baseVal??e.className??e.tagName)+': '+e.textContent.trim().replace(/\s+/g,' ').slice(0,24);
 const out=[...texts,...blocks].filter(e=>boxOut(e.getBoundingClientRect())).map(name);
 // Overlap is judged on the text itself (each element's own text nodes), not on its whole box.
 const tight=e=>{const rs=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).map(n=>{const g=document.createRange();g.selectNodeContents(n);return g.getBoundingClientRect();}).filter(r=>r.width&&r.height);
  let box=rs.length?{left:Math.min(...rs.map(r=>r.left)),right:Math.max(...rs.map(r=>r.right)),top:Math.min(...rs.map(r=>r.top)),bottom:Math.max(...rs.map(r=>r.bottom))}:e.getBoundingClientRect();
  // What a clipping ancestor hides (an ellipsis, a row that cuts its overflow) does not show, so it cannot overlap.
  for(let n=e;n&&n!==c;n=n.parentElement){const s=getComputedStyle(n);if(s.overflowX!=='visible'||s.overflowY!=='visible'){const r=n.getBoundingClientRect();box={left:Math.max(box.left,r.left),right:Math.min(box.right,r.right),top:Math.max(box.top,r.top),bottom:Math.min(box.bottom,r.bottom)};}}
  return box;};
 const boxes=texts.map(e=>[e,tight(e)]),overlap=[];
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const [a,ra]=boxes[i],[d,rd]=boxes[j];if(a.contains(d)||d.contains(a))continue;
  const w=Math.min(ra.right,rd.right)-Math.max(ra.left,rd.left),h=Math.min(ra.bottom,rd.bottom)-Math.max(ra.top,rd.top);if(w>1.5&&h>1.5)overlap.push(name(a)+' × '+name(d));}
 return {out,overlap,page:document.documentElement.scrollWidth-innerWidth};})()
