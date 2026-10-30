import React from 'react';
import Svg,{Circle,Defs,G,Line,Mask,Path,Polygon,Polyline,Rect} from 'react-native-svg';

// Vector icons in the shapes of the iPhone's SF Symbols, so both phones point at the same things:
// gauge.with.needle, terminal, square.grid.2x2, chart.bar.xaxis, gearshape and the controls.
export type IconName='dashboard'|'sessions'|'usage'|'limits'|'workspace'|'computer'|'moon'|'sun'|'more'|'focus'|'pause'|'resume'|'terminate'|'send'|'photo'|'close'|'check'|'clock'|'sending'|'warning'|'branch'|'failed'|'sparkle';

const gear=(()=>{const teeth=8,out=10.2,inn=7.8,pts:string[]=[];for(let i=0;i<teeth*4;i++){const a=(i/(teeth*4))*Math.PI*2-Math.PI/2,r=i%4<2?out:inn;pts.push(`${12+r*Math.cos(a)},${12+r*Math.sin(a)}`);}return pts.join(' ');})();

export function Icon({name,size=24,color,cut='#000'}:{name:IconName;size?:number;color:string;cut?:string}){
 const id='m'+name;
 const body=(()=>{switch(name){
  case 'dashboard':return <><Defs><Mask id={id}><Rect width={24} height={24} fill="white"/><Line x1={12} y1={13} x2={6.8} y2={7.8} stroke="black" strokeWidth={2.4} strokeLinecap="round"/><Circle cx={12} cy={13} r={2.6} fill="black"/></Mask></Defs><Circle cx={12} cy={12.5} r={10} fill={color} mask={`url(#${id})`}/></>;
  case 'sessions':return <><Defs><Mask id={id}><Rect width={24} height={24} fill="white"/><Polyline points="6.5,9 9.8,12 6.5,15" fill="none" stroke="black" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/><Line x1={11.5} y1={15.5} x2={17} y2={15.5} stroke="black" strokeWidth={2} strokeLinecap="round"/></Mask></Defs><Rect x={1.5} y={3.5} width={21} height={17} rx={4} fill={color} mask={`url(#${id})`}/></>;
  case 'usage':return <G fill={color}><Rect x={2.5} y={2.5} width={8.4} height={8.4} rx={2.2}/><Rect x={13.1} y={2.5} width={8.4} height={8.4} rx={2.2}/><Rect x={2.5} y={13.1} width={8.4} height={8.4} rx={2.2}/><Rect x={13.1} y={13.1} width={8.4} height={8.4} rx={2.2}/></G>;
  case 'limits':return <G fill={color}><Rect x={3.5} y={11} width={4} height={8.5} rx={1.2}/><Rect x={10} y={6} width={4} height={13.5} rx={1.2}/><Rect x={16.5} y={2.5} width={4} height={17} rx={1.2}/><Rect x={1.5} y={20.8} width={21} height={1.7} rx={.85}/></G>;
  case 'workspace':return <><Defs><Mask id={id}><Rect width={24} height={24} fill="white"/><Circle cx={12} cy={12} r={3.3} fill="black"/></Mask></Defs><Polygon points={gear} fill={color} strokeLinejoin="round" stroke={color} strokeWidth={1.4} mask={`url(#${id})`}/></>;
  case 'computer':return <G><Rect x={2.5} y={3.5} width={19} height={13} rx={2.2} fill="none" stroke={color} strokeWidth={1.8}/><Line x1={12} y1={16.5} x2={12} y2={20} stroke={color} strokeWidth={1.8}/><Line x1={7.5} y1={20.5} x2={16.5} y2={20.5} stroke={color} strokeWidth={1.8} strokeLinecap="round"/></G>;
  case 'moon':return <Path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6Z" fill={color}/>;
  case 'sun':return <G><Circle cx={12} cy={12} r={4.6} fill={color}/>{Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return <Line key={i} x1={12+7.2*Math.cos(a)} y1={12+7.2*Math.sin(a)} x2={12+9.6*Math.cos(a)} y2={12+9.6*Math.sin(a)} stroke={color} strokeWidth={2} strokeLinecap="round"/>;})}</G>;
  case 'more':return <G fill={color}><Circle cx={5} cy={12} r={2}/><Circle cx={12} cy={12} r={2}/><Circle cx={19} cy={12} r={2}/></G>;
  case 'focus':return <G><Rect x={2.5} y={4} width={19} height={14.5} rx={2.5} fill="none" stroke={color} strokeWidth={1.8}/><Line x1={2.5} y1={8} x2={21.5} y2={8} stroke={color} strokeWidth={1.6}/><Path d="M13 11.5l7.5 3-3.2 1.2-1.3 3.3Z" fill={color} stroke={cut} strokeWidth={1}/></G>;
  case 'pause':return <G><Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.8}/><Line x1={9.5} y1={8.5} x2={9.5} y2={15.5} stroke={color} strokeWidth={2.2} strokeLinecap="round"/><Line x1={14.5} y1={8.5} x2={14.5} y2={15.5} stroke={color} strokeWidth={2.2} strokeLinecap="round"/></G>;
  case 'resume':return <G><Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.8}/><Path d="M10 8.2v7.6l6.2-3.8Z" fill={color}/></G>;
  case 'terminate':return <G><Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.8}/><Line x1={8.8} y1={8.8} x2={15.2} y2={15.2} stroke={color} strokeWidth={2} strokeLinecap="round"/><Line x1={15.2} y1={8.8} x2={8.8} y2={15.2} stroke={color} strokeWidth={2} strokeLinecap="round"/></G>;
  case 'send':return <G><Line x1={12} y1={19} x2={12} y2={5.5} stroke={color} strokeWidth={2.4} strokeLinecap="round"/><Polyline points="6,11 12,5 18,11" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/></G>;
  case 'photo':return <G><Rect x={6} y={2.5} width={15.5} height={13} rx={2.2} fill="none" stroke={color} strokeWidth={1.7}/><Path d="M3.5 7.5v10.5a2.5 2.5 0 0 0 2.5 2.5h12" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round"/><Path d="M8 14l3.6-4 2.7 3 1.8-1.8 3.4 2.8" fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round"/><Circle cx={17} cy={6.5} r={1.4} fill={color}/></G>;
  case 'close':return <G><Line x1={6} y1={6} x2={18} y2={18} stroke={color} strokeWidth={2.2} strokeLinecap="round"/><Line x1={18} y1={6} x2={6} y2={18} stroke={color} strokeWidth={2.2} strokeLinecap="round"/></G>;
  case 'clock':return <G><Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.8}/><Polyline points="12,7 12,12 15.5,14" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/></G>;
  case 'sending':return <G><Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.8}/><Line x1={12} y1={16.5} x2={12} y2={8} stroke={color} strokeWidth={1.8} strokeLinecap="round"/><Polyline points="8.5,11 12,7.5 15.5,11" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"/></G>;
  case 'warning':return <G><Path d="M12 3.5 21.5 20h-19Z" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round"/><Line x1={12} y1={9.5} x2={12} y2={14} stroke={color} strokeWidth={1.9} strokeLinecap="round"/><Circle cx={12} cy={17} r={1.1} fill={color}/></G>;
  case 'branch':return <G fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><Path d="M12 21v-7l-6-6"/><Path d="M12 14l6-6"/><Polyline points="3.5,8 6,5.5 8.5,8" transform="rotate(-45 6 6.5)"/><Polyline points="15.5,8 18,5.5 20.5,8" transform="rotate(45 18 6.5)"/></G>;
  case 'failed':return <G><Circle cx={12} cy={12} r={9.5} fill="none" stroke={color} strokeWidth={1.8}/><Line x1={8.8} y1={8.8} x2={15.2} y2={15.2} stroke={color} strokeWidth={2} strokeLinecap="round"/><Line x1={15.2} y1={8.8} x2={8.8} y2={15.2} stroke={color} strokeWidth={2} strokeLinecap="round"/></G>;
  // The AI's mark beside its name in a conversation, filled in its tool colour.
  case 'sparkle':return <Path d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10Z" fill={color}/>;
  case 'check':return <Polyline points="5,12.5 10,17.5 19,6.5" fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"/>;
 }})();
 return <Svg width={size} height={size} viewBox="0 0 24 24">{body}</Svg>;
}
