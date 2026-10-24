export type WindowKey='24h'|'12h'|'5h'|'1h'|'30m'|'10m';
export type Vector=[number,number,number,number];
export type Session={id:string;control_key:string;kind:string;app:string;terminal:string;project:string;title:string;model:string;status:string;tokens:Vector|null;rate:number|null;windows:Partial<Record<WindowKey,Vector|null>>;cpu:number|null;rss:number|null;capabilities:string[];context_usage?:{basis:string;input_tokens:number;capacity:number|null;parts:number[]|null;observed_at:number;model:string}|null};
export type Quota={id:string;kind:string;account_label:string;plan:string;updated:number;stale:boolean;windows:{key:string;label:string;pct:number|null;reset:number}[]};
export type Device={id:string;name:string;platform:string;online:boolean;received:number;snapshot:{version:string;sessions:Session[];host:{cpu:number|null;used_memory:number|null;total_memory:number|null;cores:number};account_quotas?:Quota[];operations?:{installed_skills:number|null;observed_events:number|null;goals:{runtime:string;status:string;tokens_used:number|null;session_connected:boolean}[]}}};
export type SessionRow=Session&{device:Device;key:string};
export type Tile={id:string;label:string;value:number;color:string;detail?:string;session?:SessionRow;share?:number;free?:boolean;x?:number;y?:number;w?:number;h?:number};
