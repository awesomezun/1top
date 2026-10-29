import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run the actual canvas renderer with a controlled clock and recorded drawing calls.
const source=fs.readFileSync(new URL('../agent/onetop/dist/dashboard.js',import.meta.url),'utf8');
function fixture(rates){
 let now=0;
 const label={textContent:''},canvases=rates.map((rate,i)=>{
  const arcs=[],labels=[],attrs={};
  return {dataset:{burnRate:String(rate),kind:'Codex'},arcs,labels,attrs,hidden:false,
   closest:()=>({dataset:{session:String(i)}}),
   getBoundingClientRect(){return {width:this.hidden?0:96,height:46};},
   setAttribute:(k,v)=>attrs[k]=v,
   getContext:()=>({scale(){},beginPath(){},stroke(){},fill(){},moveTo(){},lineTo(){},arc:(...v)=>arcs.push(v),fillText:(...v)=>labels.push(v)})};
 });
 const context=vm.createContext({window:{},localStorage:{getItem:()=>null},performance:{now:()=>now},devicePixelRatio:1,
  document:{documentElement:{dataset:{},style:{}},querySelectorAll:()=>canvases,querySelector:()=>label},
  getComputedStyle:()=>({getPropertyValue:()=> '#888'})});
 vm.runInContext(source,context);
 return {api:context.window.OneTopDashboard,canvases,label,tick(ms){now+=ms;}};
}
for(const [rates,max] of [
 [[0,0],1],[[.1,.3],1],[[1,2],2],[[1,3],5],[[3,9],10],[[10,18],20],
 [[10,40],50],[[10,50,90],100],[[50,130],200],[[150,450],500],[[1,999],1000]
]){
 const f=fixture(rates);f.api.drawGauges();
 assert.equal(f.label.textContent,`0–${max.toLocaleString('ko-KR')}%/시간`);
 f.canvases.forEach((c,i)=>{
  assert.equal(Number(c.dataset.burnMax),max);
  assert.equal(c.arcs[1][4],Math.PI+Math.PI*rates[i]/max); // One linear scale across rows.
  assert.match(c.attrs['aria-label'],/%\/시간/);
  assert.equal(c.labels.at(-1)[0],max.toLocaleString('ko-KR')+'%');
 });
}
const stable=fixture([1,3]);stable.api.drawGauges();
stable.canvases[1].dataset.burnRate='90';stable.api.drawGauges();
assert.equal(stable.canvases[0].dataset.burnMax,'100'); // Expand immediately, never clip at 2 or 5.
stable.canvases[1].dataset.burnRate='3';stable.api.drawGauges();stable.tick(29000);stable.api.drawGauges();
assert.equal(stable.canvases[0].dataset.burnMax,'100');
stable.tick(1000);stable.api.drawGauges();assert.equal(stable.canvases[0].dataset.burnMax,'5');
stable.canvases[1].dataset.burnRate='5.01';stable.api.drawGauges();
stable.canvases[1].dataset.burnRate='4.99';stable.tick(60000);stable.api.drawGauges();
assert.equal(stable.canvases[0].dataset.burnMax,'10'); // Threshold noise does not flip 5/10.
stable.canvases[1].dataset.burnRate='3';stable.api.state.period='30m';stable.api.drawGauges();
assert.equal(stable.canvases[0].dataset.burnMax,'5'); // Explicit range/filter changes reset the scale.
const hidden=fixture([1,3,9000]);hidden.canvases[2].hidden=true;hidden.api.drawGauges();
assert.equal(hidden.canvases[0].dataset.burnMax,'5');
for(const invalid of [null,undefined,NaN,Infinity,-1])assert.doesNotMatch(hidden.api.rateCell(invalid,'Codex'),/<canvas/);
assert.match(hidden.api.rateCell(0,'Codex'),/data-burn-rate="0"/);
hidden.api.state.lang='en';hidden.api.drawGauges();assert.equal(hidden.label.textContent,'0–5%/h');
hidden.api.state.lang='zh';hidden.api.drawGauges();assert.equal(hidden.label.textContent,'0–5%/小时');
console.log('Burn gauges: shared linear 1/2/5 steps, low/high rates, immediate expansion, stable shrink, hidden/unknown values, and language labels passed.');

for(const period of ['10m','24h','all','custom:600','custom:129600','custom:315360000000'])assert.equal(hidden.api.validPeriod(period),true);
for(const period of ['custom:0','custom:599','custom:601','custom:nan','custom:1e30','custom:-600','bad'])assert.equal(hidden.api.validPeriod(period),false);
