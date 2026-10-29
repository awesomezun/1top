// Dark and light palettes, the same values as the iPhone's QuickTheme and the desktop dashboard:
// LCD green for instruments, tool colours for tools. Screens read these objects at render time;
// a theme change swaps the values in place and rebuilds every style sheet registered with onTheme.
export type ThemeName='dark'|'light';

const DARK={background:'#0b0d0f',card:'#121518',raised:'#1c2125',line:'#23292e',ink:'#edf1f3',muted:'#9aa5ae',dim:'#6c7882',
 accent:'#9dff3c',mint:'#6ccfa9',segmentOn:'#9dff3c',segmentLead:'#e2ffc4',segmentOff:'#1d2327',grid:'#2b3238',amber:'#e9b25c',red:'#ff6450',
 soft:'#f1a4aa',mine:'#1f262c',notice:'#253935',noticeInk:'#b5eddb',glass:'rgba(30,35,40,0.86)',glassLine:'rgba(255,255,255,0.10)',
 selected:'rgba(255,255,255,0.12)',chip:'rgba(154,165,174,0.18)',onAccent:'#0b0d0f'};
const LIGHT:typeof DARK={background:'#f6f7f8',card:'#ffffff',raised:'#eef1f3',line:'#e3e7ea',ink:'#111518',muted:'#5b6670',dim:'#87929b',
 accent:'#6aa800',mint:'#13805f',segmentOn:'#6aa800',segmentLead:'#3d6300',segmentOff:'#eef1f3',grid:'#d3dade',amber:'#9a6410',red:'#cf4334',
 soft:'#c0392b',mine:'#e3eef0',notice:'#dff3ec',noticeInk:'#11573f',glass:'rgba(255,255,255,0.88)',glassLine:'rgba(17,21,24,0.08)',
 selected:'rgba(17,21,24,0.07)',chip:'rgba(91,102,112,0.14)',onAccent:'#ffffff'};

export const quick={...DARK};
let current:ThemeName='dark';
const listeners=new Set<()=>void>();
export const themeName=()=>current;
export function applyTheme(name:ThemeName){if(name===current)return;current=name;Object.assign(quick,name==='light'?LIGHT:DARK);listeners.forEach(f=>f());}
/** Runs when the theme changes; modules rebuild their StyleSheet here. */
export function onTheme(rebuild:()=>void){listeners.add(rebuild);}

export const toolColor=(kind:string)=>({Claude:'#d4956b',Codex:'#3fae8c',GLM:'#8f98e0',Antigravity:'#619db9',Aside:'#a99bdb'} as Record<string,string>)[kind]||'#8b939f';
export const toolName=(kind:string)=>kind==='Claude'?'Claude Code':kind==='Antigravity'?'Agy CLI':kind;
