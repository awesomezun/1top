// What the screens take as now: report freshness, "updated … ago" and resets. It is the phone's clock,
// except while the demo is on screen held at one moment for QA and filming (onetop://?qaDemoNow=<unix
// seconds>): then every screen shows that moment, the one the web page (/app?demo&demoNow=…), the desktop
// demo collector and the iPhone (-qaDemoNow) take. A signed-in connection never holds.
let held:number|null=null,shown=false;
/** QA and filming: hold the demo at this moment (unix seconds), or let it run again with null. */
export function holdDemo(seconds:number|null){held=seconds&&seconds>0?seconds:null;}
export const heldDemo=()=>held;
/** Whether the demo is on screen; only then does a hold change what the screens show. */
export function showingDemo(on:boolean){shown=on;}
/** Now in milliseconds, as the screens show it. */
export const now=()=>shown&&held!==null?held*1000:Date.now();
