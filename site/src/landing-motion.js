import {mountHeroMotion} from './hero-motion.js';
import './hero-motion.css';
import {mountLandingEffects} from './landing-effects.js';
// Each recording is visible in its own section. No carousel or reveal click.
export function mountLandingMotion(){
 const stage=document.querySelector('[data-hero-motion]'),heroStop=stage?mountHeroMotion(stage,{lang:{ko:'ko','zh-CN':'zh'}[document.documentElement.lang]||'en'}):()=>{};
 const stopEffects=mountLandingEffects(document.querySelector('.gauge-landing')),stopHero=()=>{heroStop();stopEffects();};
 const films=[...document.querySelectorAll('video.product-film')],button=document.querySelector('[data-motion-toggle]');
 // The tour reel has its own button, and the film itself toggles too; a choice made there outlasts the page-wide setting.
 const reelButton=document.querySelector('[data-reel-toggle]'),reel=reelButton?.parentElement.querySelector('video'),choice=new Map();
 if(!films.length)return stopHero;
 const preference=matchMedia('(prefers-reduced-motion: reduce)');
 let paused=preference.matches;
 const visible=new Set();
 const playing=film=>choice.get(film)??!paused;
 const sync=()=>{
  document.querySelector(".product-landing")?.classList.toggle("motion-paused",paused);
  for(const film of films){
   film.muted=true;
   if(!playing(film)||document.hidden||!visible.has(film))film.pause();
   else film.play().catch(()=>{});
  }
  if(button){button.textContent=paused?'▶ '+button.dataset.play:'Ⅱ '+button.dataset.pause;button.setAttribute('aria-pressed',String(paused));}
  if(reel){const on=playing(reel);reelButton.firstElementChild.textContent=on?'❚❚':'▶';reelButton.setAttribute('aria-label',on?reelButton.dataset.pause:reelButton.dataset.play);}
 };
 const observer=new IntersectionObserver(entries=>{for(const e of entries)e.isIntersecting?visible.add(e.target):visible.delete(e.target);sync();},{threshold:.08});
 films.forEach(f=>observer.observe(f));
 const toggle=()=>{paused=!paused;choice.clear();sync();};
 const change=()=>{paused=preference.matches;sync();};
 const pick=()=>{choice.set(reel,!playing(reel));sync();};
 button?.addEventListener('click',toggle);reelButton?.addEventListener('click',pick);reel?.addEventListener('click',pick);preference.addEventListener('change',change);document.addEventListener('visibilitychange',sync);sync();
 return ()=>{stopHero();observer.disconnect();films.forEach(f=>f.pause());button?.removeEventListener('click',toggle);reelButton?.removeEventListener('click',pick);reel?.removeEventListener('click',pick);preference.removeEventListener('change',change);document.removeEventListener('visibilitychange',sync);};
}
