// Each recording is visible in its own section. No carousel or reveal click.
export function mountLandingMotion(){
 const films=[...document.querySelectorAll('video.product-film')],button=document.querySelector('[data-motion-toggle]');
 if(!films.length)return ()=>{};
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 let paused=preference.matches;
 const visible=new Set();
 const sync=()=>{
  document.querySelector(".product-landing")?.classList.toggle("motion-paused",paused);
  for(const film of films){
   film.muted=true;
   if(paused||document.hidden||!visible.has(film))film.pause();
   else film.play().catch(()=>{});
  }
  if(button){button.textContent=paused?'▶ '+button.dataset.play:'Ⅱ '+button.dataset.pause;button.setAttribute('aria-pressed',String(paused));}
 };
 const observer=new IntersectionObserver(entries=>{for(const e of entries)e.isIntersecting?visible.add(e.target):visible.delete(e.target);sync();},{threshold:.08});
 films.forEach(f=>observer.observe(f));
 const toggle=()=>{paused=!paused;sync();};
 const change=()=>{paused=preference.matches;sync();};
 button?.addEventListener('click',toggle);preference.addEventListener('change',change);document.addEventListener('visibilitychange',sync);sync();
 return ()=>{observer.disconnect();films.forEach(f=>f.pause());button?.removeEventListener('click',toggle);preference.removeEventListener('change',change);document.removeEventListener('visibilitychange',sync);};
}
