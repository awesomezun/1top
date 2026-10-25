export const MOBILE_TOKEN=/^1tm_[a-f0-9]{64}$/;
export const CHALLENGE=/^[a-f0-9]{64}$/;
export async function mobileIdentity(db:D1Database,hash:string,now:number){
 const row=await db.prepare('SELECT user_id,expires_at FROM mobile_sessions WHERE token_hash=? AND expires_at>?').bind(hash,now).first<{user_id:string;expires_at:number}>();
 if(!row)throw Error('Mobile sign-in expired');
 return {id:row.user_id,expires:row.expires_at*1000,mobileHash:hash};
}
export async function authorizeMobile(db:D1Database,uid:string,challenge:unknown,platform:unknown,now:number,grantExpiry:number|null){
 if(typeof challenge!=='string'||!CHALLENGE.test(challenge)||!['iOS','Android'].includes(String(platform)))throw new SyntaxError('Invalid mobile request');
 const expires=Math.min(now+30*86400,grantExpiry||Infinity);
 const inserted=await db.prepare('INSERT INTO mobile_sessions(token_hash,user_id,platform,created_at,expires_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM mobile_sessions WHERE user_id=? AND expires_at>?)<5 ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash').bind(challenge,uid,platform,now,expires,uid,now).first();
 return inserted?{ok:true,expires_at:expires}:null;
}
