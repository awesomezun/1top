/* 1top's own (not the design session's): on a phone held upright, or a narrow dashboard, a theme shows only its two
   headline instruments, as large as the 1top dials (4.9.0, the user's choice E). A theme whose token speed and limit
   burn are two round dials shows those two cut out of its drawing side by side, the token speed on the left as the
   1top dials stand; one whose instruments are displays or bars, or drawn one inside the other, shows the band from one
   to the other. Where each instrument sits comes from pairs.js (scripts/theme_pairs.py); '크게 보기' shows the whole
   theme. The cut-outs touch: the padding pairs.js leaves round each instrument is the gap between them. They stand at
   most TALL pixels high, so a band nearly as tall as it is wide never fills the screen. */
(function(G){
 'use strict';
 const O=G.OneTop,TALL=240;
 const round=b=>b[2]/b[3]>=.72&&b[2]/b[3]<=1.4&&b[3]>=180;
 // How much of the smaller instrument lies inside the other.
 const shared=(a,b)=>{const w=Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])),h=Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));return w*h/Math.min(a[2]*a[3],b[2]*b[3]);};
 const band=(a,b)=>{const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]);return [x,y,Math.max(a[0]+a[2],b[0]+b[2])-x,Math.max(a[1]+a[3],b[1]+b[3])-y];};
 // The boxes theme id shows: two side by side, or one band; none without its measurements.
 function cuts(id){
  const p=(O.PAIRS||{})[id],r=p?.rate,b=p?.burn;if(!r||!b)return null;
  return round(r)&&round(b)&&shared(r,b)<.3?[r,b]:[band(r,b)];
 }
 // Width over height of what compact() draws (the phones size their view by it); the whole drawing's without cuts.
 function compactAspect(id){const c=cuts(id);return c?c.reduce((n,b)=>n+b[2]/b[3],0):1280/480;}
 // The theme's instruments for figures d, as markup: each cut-out the same drawing seen through its own viewBox, the
 // whole at most as wide as TALL high at its aspect (the phones keep their view to it as well).
 function compact(t,d){
  const svg=O.render(t,d),c=cuts(t.id),wide=`max-width:${Math.round(TALL*compactAspect(t.id))}px;margin:0 auto`;if(!c)return `<div class="ot-pair" style="${wide}">${svg}</div>`;
  const view=b=>svg.replace(/viewBox="[^"]*"/,`viewBox="${b.join(' ')}" preserveAspectRatio="xMidYMid slice"`);
  return `<div class="ot-pair" style="${wide}">${c.map(b=>`<div class="ot-cut" style="flex:${(b[2]/b[3]).toFixed(4)} 1 0;aspect-ratio:${b[2]}/${b[3]}">${view(b)}</div>`).join('')}</div>`;
 }
 Object.assign(O,{compact,compactAspect,COMPACT_TALL:TALL});
})(typeof window==='undefined'?globalThis:window);
