/* Adapted from the user-owned GitReels Prefs.tsx and matrixVeil.ts. */
window.OneTopEffects=(()=>{
"use strict";
// The language change, like the theme change: the page in the new language opens as a circle from the button, and its
// edge is a ring of small green characters raining down, thick and fuzzy (no hard line: each character comes and goes
// by its distance from the edge and a little noise), that sweeps out across the screen in a moment. The ring is a
// canvas with its own view-transition name (so the page's clip does not cut it), drawn from a pre-rendered glyph sheet.


const SCRIPT = {
  en: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ko: "깃릴스코드레포영상별가나다라마바사아자차카타파하",
  zh: "代码仓库短片视频星标趋势开源项目读取生成发布",
};
const DIGITS = "0123456789", CELL = 11, FONT = 10, LEAD = 46, TRAIL = 150;
const RING_MS = 1100;

// cubic-bezier(.45,.05,.2,1): a soft start and a long, smooth landing
function ease(t) {
  const x1 = 0.45, y1 = 0.05, x2 = 0.2, y2 = 1;
  const bx = (s) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3, by = (s) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (bx(mid) < t) lo = mid; else hi = mid; }
  return by((lo + hi) / 2);
}
const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };


function matrixRing(lang) {
  const W = innerWidth, H = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
  const light = document.documentElement.dataset.theme === "light";
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100vw", height: "100vh", zIndex: "2147483647", pointerEvents: "none", viewTransitionName: "onetop-matrix" });
  canvas.setAttribute("aria-hidden", "true");
  // the glyph sheet: each character once in the trail's green and once in the bright head colour
  const chars = Array.from(DIGITS + DIGITS + SCRIPT[lang]), size = Math.ceil(CELL * dpr), sheet = document.createElement("canvas");
  sheet.width = size * chars.length; sheet.height = size * 2;
  const s = sheet.getContext("2d");
  s.font = `600 ${FONT * dpr}px ui-monospace, "SFMono-Regular", Menlo, "Apple SD Gothic Neo", "Malgun Gothic", "PingFang SC", "Microsoft YaHei", monospace`;
  s.textAlign = "center"; s.textBaseline = "middle";
  chars.forEach((c, i) => {
    s.fillStyle = light ? "#139a4f" : "#2be27c"; s.fillText(c, i * size + size / 2, size / 2);
    s.fillStyle = light ? "#075f2f" : "#dcffe9"; s.fillText(c, i * size + size / 2, size * 1.5);
  });
  const ctx = canvas.getContext("2d");
  const cols = Math.ceil(W / CELL), speed = Array.from({ length: cols }, (_, c) => 16 + hash(c, 1, 7) * 30), phase = Array.from({ length: cols }, (_, c) => hash(c, 2, 9));
  let stop = false;

  const reach = (x, y) => Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) + LEAD + 20;
  return {
    canvas,
    // the page's clip, sampled from the same curve the ring follows
    frames: (x, y) => {
      const R = reach(x, y);
      return { radius: R, clip: Array.from({ length: 25 }, (_, i) => ({ offset: i / 24, clipPath: `circle(${(ease(i / 24) * R).toFixed(1)}px at ${x}px ${y}px)` })) };
    },
    run: (x, y) => {
      const R = reach(x, y), start = performance.now();
      const frame = (now) => {
        if (stop) return;
        const t = Math.min(1, (now - start) / RING_MS), r = ease(t) * R, secs = (now - start) / 1000, step = Math.floor(secs * 14);
        const fade = Math.min(1, t / 0.12) * (t < 0.7 ? 1 : 1 - ((t - 0.7) / 0.3) ** 1.5);   // in softly, out slowly
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
        const outer = r + LEAD, inner = Math.max(0, r - TRAIL);
        for (let c = Math.max(0, Math.floor((x - outer) / CELL)); c <= Math.min(cols - 1, Math.ceil((x + outer) / CELL)); c++) {
          const cx = c * CELL + CELL / 2, dx = cx - x;
          if (Math.abs(dx) > outer) continue;
          const yo = Math.sqrt(outer * outer - dx * dx), yi = Math.abs(dx) < inner ? Math.sqrt(inner * inner - dx * dx) : 0;
          const fall = (phase[c] + speed[c] * secs) % 1;   // the column's rain moves down a cell at a time
          for (const [a, b] of [[y - yo, y - yi], [y + yi, y + yo]]) {
            for (let row = Math.floor(a / CELL - fall); row * CELL + fall * CELL <= b; row++) {
              const cy = (row + fall) * CELL, d = Math.hypot(dx, cy - y) - r;
              const near = d > 0 ? Math.exp(-((d / 20) ** 2)) : Math.exp(-((d / 62) ** 2)) * 0.95;   // sharp-ish ahead, a long tail behind
              const n = hash(c, row, step);
              if (n > near * 1.15) continue;
              const head = d > -8 && d < 14 && n < 0.45, g = Math.floor(hash(row, c, step + 3) * chars.length);
              ctx.globalAlpha = Math.min(1, near * (0.55 + 0.45 * hash(c, row, 5))) * fade;
              ctx.drawImage(sheet, g * size, head ? size : 0, size, size, (cx - CELL / 2) * dpr, (cy - CELL / 2) * dpr, size, size);
            }
          }
        }
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    },
    remove: () => { stop = true; canvas.remove(); },
  };
}
// Serialize rapid picks and keep the newest queued choice. Cleanup also runs when a
// transition is skipped, the document becomes hidden, or an engine rejects snapshots.
let active=null,pending=null;
function reveal(element,apply,lang=null){
  const b=element.getBoundingClientRect(),origin={x:b.left+b.width/2,y:b.top+b.height/2};
  const task={origin,apply,lang};
  if(active){pending=task;active.transition.skipTransition();return;}
  run(task);
}
function run({origin:{x,y},apply,lang}){
  if(!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){apply();return;}
  let ring=null,applied=false;
  const update=()=>{if(applied)return;applied=true;apply();if(lang){ring=matrixRing(lang);document.body.appendChild(ring.canvas);}};
  try{
    const transition=document.startViewTransition(update);
    active={transition};document.documentElement.dataset.preferenceTransition=lang?'language':'theme';
    transition.ready.then(()=>{
      const radius=Math.hypot(Math.max(x,innerWidth-x),Math.max(y,innerHeight-y));
      const frames=ring?ring.frames(x,y).clip:{clipPath:[`circle(0px at ${x}px ${y}px)`,`circle(${radius}px at ${x}px ${y}px)`]};
      document.documentElement.animate(frames,{duration:ring?RING_MS:700,easing:ring?'linear':'cubic-bezier(.22,.8,.24,1)',pseudoElement:'::view-transition-new(root)'});
      ring?.run(x,y);
    }).catch(()=>{});
    const finish=()=>{ring?.remove();if(active?.transition!==transition)return;active=null;delete document.documentElement.dataset.preferenceTransition;const next=pending;pending=null;if(next)run(next);};
    transition.finished.then(finish,finish);
  }catch{update();ring?.remove();active=null;delete document.documentElement.dataset.preferenceTransition;}
}
return {reveal,get running(){return !!active;}};
})();
