import type {Session,SessionRow,Tile,WindowKey} from './types';
export const palette=['#75cbb1','#86a6df','#bd9bdb','#ddb777','#83b9c7','#cf939c'];
export const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export const total=(v:unknown):number|null=>Array.isArray(v)&&v.length===4&&v.every(valid)?v.reduce((a,b)=>a+b,0):null;
export const format=(n:number|null|undefined)=>!valid(n)?'—':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1000?(n/1000).toFixed(1)+'k':Math.round(n).toLocaleString();
export const tool=(s:Session)=>s.kind==='Aside'?'':s.kind==='Claude'||s.kind==='GLM'?'Claude Code':s.kind;
export const fresh=(d:SessionRow['device'],limit=30000)=>d.online&&Date.now()-d.received<limit;
export function usage(rows:SessionRow[],period:WindowKey,group:string){
 const groups=new Map<string,Tile>();let known=0,unknown=0,zero=0;
 for(const s of rows.filter(s=>fresh(s.device))){const value=total(s.windows[period]);if(value===null){unknown++;continue;}known++;if(value===0){zero++;continue;}
  const id=group==='app'?s.app:group==='tool'?(tool(s)||'In-app runtime unreported'):group==='model'?(s.model||'Model unreported'):s.key;
  const old=groups.get(id);if(old)old.value+=value;else groups.set(id,{id,label:group==='session'?(s.project||s.title):id,value,color:'',detail:[s.device.name,s.app,s.terminal,tool(s),s.model].filter(Boolean).join(' · '),session:group==='session'?s:undefined});
 }
 let items=[...groups.values()].sort((a,b)=>b.value-a.value);const sum=items.reduce((a,b)=>a+b.value,0);
 if(items.length>32){const rest=items.splice(31);items.push({id:'other',label:'Other sessions',value:rest.reduce((a,b)=>a+b.value,0),color:''});}
 return {items:items.map((x,i)=>({...x,color:palette[i%palette.length],share:x.value/sum*100})),sum:known?sum:null,known,unknown,zero};
}
export function context(s:Session){const c=s.context_usage;if(c?.basis!=='last_request_input'||!valid(c.input_tokens))return null;
 const used=c.input_tokens,capacity=valid(c.capacity)&&c.capacity>0?c.capacity:null,validCapacity=capacity!==null&&capacity>=used;
 const parts=c.parts?.length===3&&c.parts.every(valid)&&Math.abs(c.parts.reduce((a,b)=>a+b,0)-used)<.01?c.parts:null;
 let items:Tile[]=parts?parts.map((v,i)=>({id:'input'+i,label:['Uncached input','Cache read','Cache write'][i],value:v,color:palette[i]})):[{id:'input',label:'Reported input',value:used,color:palette[0]}];
 if(validCapacity&&capacity>used)items.push({id:'free',label:'Remaining input capacity',value:capacity-used,color:'#707e92',free:true});
 return {used,capacity,percent:validCapacity?used/capacity*100:null,items:items.filter(x=>x.value>0).map(x=>({...x,share:x.value/(validCapacity?capacity:used)*100}))};
}
export function layout(items:Tile[],width:number,height:number):Tile[]{const out:Tile[]=[];
 function split(nodes:Tile[],x:number,y:number,w:number,h:number){if(!nodes.length)return;if(nodes.length===1){out.push({...nodes[0],x,y,w,h});return;}const sum=nodes.reduce((a,b)=>a+b.value,0);let part=0,best=Infinity,cut=1;for(let i=1;i<nodes.length;i++){part+=nodes[i-1].value;const distance=Math.abs(sum/2-part);if(distance<best){best=distance;cut=i;}}const a=nodes.slice(0,cut),b=nodes.slice(cut),ratio=a.reduce((s,t)=>s+t.value,0)/sum;if(w>=h){split(a,x,y,w*ratio,h);split(b,x+w*ratio,y,w*(1-ratio),h);}else{split(a,x,y,w,h*ratio);split(b,x,y+h*ratio,w,h*(1-ratio));}}
 split(items.filter(x=>valid(x.value)&&x.value>0),0,0,width,height);return out;
}
