import type {SessionRow} from './types';

const order:Record<string,number>={working:0,waiting:1,resuming:2,paused:3,idle:4,interrupted:5,unknown:6};
// Keep ties stable so live token updates do not shuffle cards under the reader.
export function sortSessions(rows:SessionRow[],now=Date.now()):SessionRow[]{
 const rank=(row:SessionRow)=>row.device.online&&now-row.device.received<30000?(order[row.status]??6):7;
 return [...rows].sort((a,b)=>rank(a)-rank(b));
}
