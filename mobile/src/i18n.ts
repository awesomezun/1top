import {chinese} from './chinese';
import {now as shownNow} from './clock';
// Korean, English or Simplified Chinese, as on the iPhone: every label is t(english, korean), and
// Chinese is looked up by the English text, so call sites stay two-language.
export type Lang='ko'|'en'|'zh';
export const LANGS:[Lang,string,string][]=[['ko','한','한국어'],['en','EN','English'],['zh','中','中文']];
/** One tap moves on in a fixed order, 한 → EN → 中 → 한, as on the desktop dashboard and the iPhone. */
export const nextLang=(lang:Lang):Lang=>LANGS[(LANGS.findIndex(l=>l[0]===lang)+1)%LANGS.length][0];
export const translate=(lang:Lang,en:string,ko:string)=>lang==='ko'?ko:lang==='zh'?chinese(en):en;
export const locale=(lang:Lang)=>lang==='ko'?'ko-KR':lang==='zh'?'zh-CN':'en-US';
/** Clock time for today's reports ("오후 4:21", "4:21 PM", "下午4:21"); date and time for older ones. */
export function when(ms:number,lang:Lang,now=shownNow()){
 const d=new Date(ms),today=new Date(now).toDateString()===d.toDateString();
 return d.toLocaleString(locale(lang),today?{hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
/** How long until a limit resets, as the iPhone says it. */
export function resetIn(at:number|null|undefined,t:(en:string,ko:string)=>string,now=shownNow()/1000){
 if(!at||!(at>0))return t('Reset time not reported','초기화 시각 미보고');
 const minutes=Math.ceil((at-now)/60);if(minutes<=0)return t('Waiting for the reset report','초기화 보고 대기');
 if(minutes>=1440){const d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60);return t(`Resets in ${d}d ${h}h`,`${d}일 ${h}시간 후 초기화`);}
 return minutes>=60?t(`Resets in ${Math.floor(minutes/60)}h ${minutes%60}m`,`${Math.floor(minutes/60)}시간 ${minutes%60}분 후 초기화`):t(`Resets in ${minutes}m`,`${minutes}분 후 초기화`);
}
/** A limit window's name from its key: "5 hours" and "Weekly" in the chosen language. */
export function windowName(w:{key?:string;label:string},t:(en:string,ko:string)=>string){
 if(w.key==='5h'||w.label==='5H')return t('5 hours','5시간');
 if(w.key==='7d'||w.key==='weekly'||w.label==='주간'||w.label==='Weekly')return t('Weekly','주간');
 return w.label;
}
/** The state a session is in, in the iPhone's words. */
export const statusName=(status:string,t:(en:string,ko:string)=>string)=>({working:t('Working','작업 중'),waiting:t('Needs input','확인 필요'),paused:t('Paused','일시정지'),
 idle:t('Idle','대기 중'),interrupted:t('Interrupted','중단됨'),resuming:t('Resuming','재개 중')} as Record<string,string>)[status]||t('Unknown state','상태 미확인');
/** How old a value that could not be refreshed is, so an old % never reads as current. */
export function reportAge(updated:number|null|undefined,t:(en:string,ko:string)=>string,now=shownNow()/1000){
 if(!updated||!(updated>0))return t('Last report','마지막 보고');const s=Math.max(0,now-updated);
 if(s<60)return t('Just now','방금 보고');if(s<3600)return t(`${Math.floor(s/60)}m ago`,`${Math.floor(s/60)}분 전 보고`);
 if(s<86400)return t(`${Math.floor(s/3600)}h ago`,`${Math.floor(s/3600)}시간 전 보고`);return t(`${Math.floor(s/86400)}d ago`,`${Math.floor(s/86400)}일 전 보고`);
}
const RECONNECT=new Set(['login_required','login_expired','credential_store_unavailable','access_denied']);
/** What a stale limit says instead of a rate: reconnect needed, or how old it is. */
export const staleLabel=(q:{status?:string|null;updated?:number|null},t:(en:string,ko:string)=>string)=>RECONNECT.has(q.status||'')?t('Reconnect needed','재연결 필요'):reportAge(q.updated,t);
/** Period names on every picker, shortest first, as on the iPhone. */
export const PERIOD_NAMES:[import('./types').WindowKey,string,string][]=[['10m','10m','10분'],['30m','30m','30분'],['1h','1h','1시간'],['5h','5h','5시간'],['12h','12h','12시간'],['24h','24h','24시간']];
