import Stripe from 'stripe';
import type {Env} from './hub';
import {hostedAccess} from './access';

export const billingReady=(env:Env)=>env.BILLING_ENABLED==='true' && !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET && /^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_ID||'');
export function stripeClient(env:Env){
 if(!env.STRIPE_SECRET_KEY)throw Error('Billing is not configured');
 return new Stripe(env.STRIPE_SECRET_KEY,{httpClient:Stripe.createFetchHttpClient(),timeout:10000,maxNetworkRetries:1});
}
const now=()=>Math.floor(Date.now()/1000);
const result=(value:unknown,status=200)=>Response.json(value,{status});
const configuredDevices=(env:Env)=>Math.max(1,Math.min(25,Math.floor(Number(env.PLAN_MAX_DEVICES))||3));
export async function billingStatus(env:Env,uid:string){
 const access=await hostedAccess(env.DB,uid);
 const customer=await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?').bind(uid).first<{customer_id:string}>();
 let price:null|{amount:number;currency:string;interval:string;max_devices:number}=null;
 if(billingReady(env)){
  const p=await stripeClient(env).prices.retrieve(env.STRIPE_PRICE_ID!);
  if(p.active && p.type==='recurring' && p.recurring?.interval==='month' && p.recurring.interval_count===1 && p.unit_amount!==null)price={amount:p.unit_amount,currency:p.currency,interval:'month',max_devices:configuredDevices(env)};
 }
 return {managed_available:!!price,price,access,can_manage_billing:!!customer,role:access?.kind==='operator'?'admin':'member'};
}
async function customerId(env:Env,uid:string){
 const saved=await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?').bind(uid).first<{customer_id:string}>();
 if(saved)return saved.customer_id;
 const customer=await stripeClient(env).customers.create({metadata:{onetop_user_id:uid}},{idempotencyKey:'1top-customer-'+uid});
 await env.DB.prepare('INSERT INTO billing_customers(user_id,customer_id,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING').bind(uid,customer.id,now()).run();
 return (await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?').bind(uid).first<{customer_id:string}>())!.customer_id;
}
export async function checkout(env:Env,uid:string,storage:DurableObjectStorage){
 if(!billingReady(env))return result({error:'Managed subscriptions are not open yet.',code:'billing_unavailable'},503);
 if((await hostedAccess(env.DB,uid))?.kind==='operator')return result({error:'The administrator already has managed access.'},409);
 const client=stripeClient(env),customer=await customerId(env,uid);
 const existing=await client.subscriptions.list({customer,status:'all',limit:100});
 if(existing.has_more || existing.data.some(s=>!['canceled','incomplete_expired'].includes(s.status)))return result({error:'A subscription already exists. Manage it in the billing portal.',code:'subscription_exists'},409);
 const price=await client.prices.retrieve(env.STRIPE_PRICE_ID!);
 if(!price.active||price.type!=='recurring'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw Error('Invalid managed price');
 let pending=await storage.get<{key:string;session?:string;expires:number}>('checkout');
 if(pending?.session){
  const previous=await client.checkout.sessions.retrieve(pending.session);
  if(previous.status==='open'&&previous.url)return result({url:previous.url});
  if(previous.status==='complete')return result({error:'Payment is being confirmed. Refresh your account shortly.',code:'payment_pending'},409);
  pending=undefined;
 }
 if(pending&&pending.expires<=now())pending=undefined;
 if(!pending){pending={key:crypto.randomUUID(),expires:now()+3600};await storage.put('checkout',pending);}
 const session=await client.checkout.sessions.create({customer,mode:'subscription',expires_at:pending.expires,line_items:[{price:price.id,quantity:1}],allowed_payment_method_types:['card'],success_url:env.WEB_URL+'/app?billing=success',cancel_url:env.WEB_URL+'/app?billing=cancelled',subscription_data:{metadata:{product:'1top-managed'}},client_reference_id:uid},{idempotencyKey:'1top-checkout-'+pending.key});
 await storage.put('checkout',{...pending,session:session.id});
 return result({url:session.url});
}
export async function portal(env:Env,uid:string){
 if(!billingReady(env))return result({error:'Billing is not available.'},503);
 const saved=await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?').bind(uid).first<{customer_id:string}>();
 if(!saved)return result({error:'No billing account exists.'},404);
 const session=await stripeClient(env).billingPortal.sessions.create({customer:saved.customer_id,return_url:env.WEB_URL+'/app'});
 return result({url:session.url});
}
export async function webhook(req:Request,env:Env){
 if(!billingReady(env))return result({error:'Billing is not configured'},503);
 const raw=await req.text();if(raw.length>256000)return result({error:'Payload too large'},413);
 let event:Stripe.Event;
 try{event=await stripeClient(env).webhooks.constructEventAsync(raw,req.headers.get('Stripe-Signature')||'',env.STRIPE_WEBHOOK_SECRET!,300,Stripe.createSubtleCryptoProvider());}
 catch{return result({error:'Invalid webhook signature'},400);}
 const live=env.STRIPE_SECRET_KEY!.startsWith('sk_live_')||env.STRIPE_SECRET_KEY!.startsWith('rk_live_');
 if(event.livemode!==live)return result({error:'Webhook mode mismatch'},400);
 if(!['checkout.session.completed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed','invoice.payment_action_required'].includes(event.type))return result({received:true});
 const obj=event.data.object as unknown as {customer?:string|{id:string}};
 const customer=typeof obj.customer==='string'?obj.customer:obj.customer?.id;
 if(!customer)return result({received:true});
 const row=await env.DB.prepare('SELECT user_id FROM billing_customers WHERE customer_id=?').bind(customer).first<{user_id:string}>();
 if(!row)return result({received:true});
 // The server-owned mapping and current Stripe state are authoritative.
 // Event order, redirect URLs, and client-supplied plans cannot grant access.
 return env.HUBS.get(env.HUBS.idFromName(row.user_id)).fetch(new Request('https://hub/billing/sync',{method:'POST',body:JSON.stringify({uid:row.user_id,customer,event_id:event.id})}));
}
export async function reconcileSubscription(env:Env,uid:string,customer:string){
 const mapping=await env.DB.prepare('SELECT customer_id FROM billing_customers WHERE user_id=?').bind(uid).first<{customer_id:string}>();
 if(mapping?.customer_id!==customer)throw Error('Customer mismatch');
 const subscriptions=await stripeClient(env).subscriptions.list({customer,status:'all',limit:100,expand:['data.latest_invoice']});
 if(subscriptions.has_more)throw Error('Subscription reconciliation requires review');
 const eligible=subscriptions.data.filter(s=>s.status==='active'&&!s.pause_collection&&s.collection_method==='charge_automatically'&&s.items.data.length===1&&s.items.data[0].price.id===env.STRIPE_PRICE_ID&&s.items.data[0].quantity===1&&typeof s.latest_invoice==='object'&&s.latest_invoice?.status==='paid');
 const valid=eligible.map(s=>({id:s.id,expires:s.items.data[0].current_period_end})).filter(s=>Number.isSafeInteger(s.expires)&&s.expires>now()).sort((a,b)=>b.expires-a.expires)[0];
 const grant=await hostedAccess(env.DB,uid);
 const changed=grant?.kind!=='operator'&&(!!valid!==!!grant || (!!valid&&(grant?.expires_at!==valid.expires||grant?.max_devices!==configuredDevices(env)||grant?.kind!=='subscription')));
 await env.DB.batch([
  env.DB.prepare('UPDATE billing_customers SET subscription_id=?,status=?,updated_at=? WHERE user_id=?').bind(valid?.id||null,valid?'active':'inactive',now(),uid),
  valid?env.DB.prepare("INSERT INTO hosted_access(user_id,kind,expires_at,max_devices,created_at,revoked_at) VALUES(?,'subscription',?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET kind='subscription',expires_at=excluded.expires_at,max_devices=excluded.max_devices,revoked_at=NULL WHERE hosted_access.kind!='operator'").bind(uid,valid.expires,configuredDevices(env),now()):env.DB.prepare("UPDATE hosted_access SET revoked_at=? WHERE user_id=? AND kind='subscription'").bind(now(),uid),
  env.DB.prepare('DELETE FROM tickets WHERE user_id=?').bind(uid),
 ]);
 return {active:!!valid||grant?.kind==='operator',operator:grant?.kind==='operator',changed,expires:valid?.expires||null};
}
