// Public-page theme (v6.0.0). Like the app's display preferences, a change opens the new page as a circle from the
// button that was pressed; reduced motion or a browser without View Transitions switches at once.
const KEY='1top-theme';
export const SUN='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
export const MOON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
export function theme(){try{return localStorage.getItem(KEY)==='light'?'light':'dark'}catch{return 'dark'}}
export function applyTheme(value=theme()){
 document.documentElement.dataset.theme=value;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',value==='light'?'#f4f5f5':'#0b0e10');
}
export function reveal(origin,update){
 if(!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){update();return}
 const r=origin?.getBoundingClientRect(),x=r?r.left+r.width/2:innerWidth/2,y=r?r.top+r.height/2:0,radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
 document.startViewTransition(update).ready.then(()=>document.documentElement.animate({clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${radius}px at ${x}px ${y}px)`]},{duration:700,easing:'cubic-bezier(.45,.05,.2,1)',pseudoElement:'::view-transition-new(root)'})).catch(()=>{});
}
export function toggleTheme(origin,after){
 const next=theme()==='light'?'dark':'light';
 try{localStorage.setItem(KEY,next)}catch{}
 reveal(origin,()=>{applyTheme(next);after?.()});
}
