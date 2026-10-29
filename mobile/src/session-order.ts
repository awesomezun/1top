import type {SessionRow,WindowKey} from './types';
import {total} from './metrics';

// Working sessions first, then every other session together, each by selected-period tokens.
// Same order as the dashboard, the menu bar and the iPhone app; states never split the usage order.
export function sortSessions(rows:SessionRow[],period:WindowKey='1h'):SessionRow[]{
 const tokens=(row:SessionRow)=>total(row.windows?.[period])??-1;
 return [...rows].sort((a,b)=>Number(b.status==='working')-Number(a.status==='working')||tokens(b)-tokens(a)||(a.key<b.key?-1:a.key>b.key?1:0));
}
