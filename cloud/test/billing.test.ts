import {env} from 'cloudflare:test';
import {beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import Stripe from 'stripe';
import schema from '../schema.sql?raw';
import {billingReady,billingStatus,checkout,portal,reconcileSubscription,webhook} from '../src/billing';
const mocks=vi.hoisted(()=>({subscriptions:vi.fn(),price:vi.fn(),create:vi.fn(),retrieve:vi.fn(),customer:vi.fn(),portal:vi.fn()}));
vi.mock('stripe',async original=>{
 const Real=(await original<typeof import('stripe')>()).default;
 class Fake extends Real{
  constructor(...args:any[]){super(args[0],args[1]);this.subscriptions.list=mocks.subscriptions;this.prices.retrieve=mocks.price;this.checkout.sessions.create=mocks.create;this.checkout.sessions.retrieve=mocks.retrieve;this.customers.create=mocks.customer;this.billingPortal.sessions.create=mocks.portal;}
 }
 return {default:Fake};
});
const e:any={...env,BILLING_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',STRIPE_PRICE_ID:'price_fixture',PLAN_MAX_DEVICES:'3'};
const now=()=>Math.floor(Date.now()/1000);
const subscription=(extra:any={})=>({id:'sub_fixture',status:'active',collection_method:'charge_automatically',items:{data:[{price:{id:'price_fixture'},quantity:1,current_period_end:now()+86400}]},latest_invoice:{status:'paid'},...extra});
const storage=()=>{const data=new Map();return {get:async(k:string)=>data.get(k),put:async(k:string,v:any)=>data.set(k,v)} as any;};
let seq=0;
async function member(kind?:string){const uid='billing'+(++seq);await e.DB.prepare('INSERT INTO billing_customers(user_id,customer_id,created_at) VALUES(?,?,1)').bind(uid,'cus_'+uid).run();if(kind)await e.DB.prepare('INSERT INTO hosted_access(user_id,kind,expires_at,max_devices,created_at) VALUES(?,?,?,?,1)').bind(uid,kind,kind==='operator'?null:now()+86400,3).run();return uid;}
beforeAll(async()=>{for(const sql of schema.split(';').map(s=>s.trim()).filter(Boolean))await e.DB.prepare(sql).run();});
beforeEach(()=>{vi.clearAllMocks();mocks.subscriptions.mockResolvedValue({data:[],has_more:false});mocks.price.mockResolvedValue({id:'price_fixture',active:true,type:'recurring',recurring:{interval:'month',interval_count:1},unit_amount:900,currency:'usd'});mocks.create.mockResolvedValue({id:'cs_fixture',url:'https://checkout.stripe.com/fixture'});mocks.retrieve.mockResolvedValue({status:'open',url:'https://checkout.stripe.com/fixture'});});
describe('billing admission',()=>{
 it('stays disabled without all explicit server configuration',()=>{for(const value of [undefined,'false'])expect(billingReady({...e,BILLING_ENABLED:value})).toBe(false);for(const key of ['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PRICE_ID'])expect(billingReady({...e,[key]:''})).toBe(false);});
 it('returns the server price and never exposes credentials',async()=>{const result=await billingStatus(e,await member());expect(result.price).toEqual({amount:900,currency:'usd',interval:'month',max_devices:3});expect(JSON.stringify(result)).not.toContain('sk_test');});
 it('reuses an open checkout',async()=>{const uid=await member(),s=storage();for(let i=0;i<2;i++)expect((await checkout(e,uid,s)).status).toBe(200);expect(mocks.create).toHaveBeenCalledTimes(1);});
 it('reuses the creation idempotency key after an ambiguous network failure',async()=>{const uid=await member(),s=storage();mocks.create.mockRejectedValueOnce(Error('network'));await expect(checkout(e,uid,s)).rejects.toThrow();await checkout(e,uid,s);expect(mocks.create.mock.calls[0][1].idempotencyKey).toBe(mocks.create.mock.calls[1][1].idempotencyKey);});
 it('rejects duplicate subscriptions and administrator checkout',async()=>{expect((await checkout(e,await member('operator'),storage())).status).toBe(409);mocks.subscriptions.mockResolvedValue({data:[subscription()],has_more:false});expect((await checkout(e,await member(),storage())).status).toBe(409);expect(mocks.create).not.toHaveBeenCalled();});
 it('requires a server-owned customer for portal access',async()=>{expect((await portal(e,'no_customer')).status).toBe(404);expect(mocks.portal).not.toHaveBeenCalled();});
});
describe('paid entitlement projection',()=>{
 it('grants only a currently paid configured subscription and is idempotent',async()=>{const uid=await member();mocks.subscriptions.mockResolvedValue({data:[subscription()],has_more:false});expect((await reconcileSubscription(e,uid,'cus_'+uid)).changed).toBe(true);expect((await reconcileSubscription(e,uid,'cus_'+uid)).changed).toBe(false);expect(await e.DB.prepare('SELECT kind,max_devices FROM hosted_access WHERE user_id=?').bind(uid).first()).toEqual({kind:'subscription',max_devices:3});});
 it.each(['past_due','unpaid','canceled','trialing','incomplete'])('revokes %s and invalidates outstanding tickets',async status=>{const uid=await member('subscription');await e.DB.prepare('INSERT INTO tickets(hash,user_id,expires_at,auth_expires) VALUES(?,?,?,?)').bind(uid,uid,now()+30,Date.now()+30000).run();mocks.subscriptions.mockResolvedValue({data:[subscription({status})],has_more:false});expect((await reconcileSubscription(e,uid,'cus_'+uid)).active).toBe(false);expect((await e.DB.prepare('SELECT revoked_at FROM hosted_access WHERE user_id=?').bind(uid).first()).revoked_at).toBeTruthy();expect(await e.DB.prepare('SELECT hash FROM tickets WHERE user_id=?').bind(uid).first()).toBeNull();});
 it.each([{latest_invoice:{status:'open'}},{pause_collection:{}},{collection_method:'send_invoice'},{items:{data:[{price:{id:'price_wrong'},quantity:1,current_period_end:now()+5000}]}}])('does not grant from an ineligible subscription',async extra=>{const uid=await member();mocks.subscriptions.mockResolvedValue({data:[subscription(extra)],has_more:false});expect((await reconcileSubscription(e,uid,'cus_'+uid)).active).toBe(false);});
 it('preserves administrator access after cancellation',async()=>{const uid=await member('operator');expect(await reconcileSubscription(e,uid,'cus_'+uid)).toMatchObject({active:true,operator:true,changed:false});expect((await e.DB.prepare('SELECT kind,revoked_at FROM hosted_access WHERE user_id=?').bind(uid).first()).revoked_at).toBeNull();});
 it('rejects another customer and leaves grants unchanged on provider errors',async()=>{const uid=await member('subscription');await expect(reconcileSubscription(e,uid,'cus_other')).rejects.toThrow('Customer mismatch');mocks.subscriptions.mockRejectedValue(Error('offline'));await expect(reconcileSubscription(e,uid,'cus_'+uid)).rejects.toThrow();expect((await e.DB.prepare('SELECT revoked_at FROM hosted_access WHERE user_id=?').bind(uid).first()).revoked_at).toBeNull();});
});
describe('webhook authentication',()=>{
 async function request(event:any,secret='whsec_fixture',timestamp=now()){const payload=JSON.stringify(event);const signature=await Stripe.webhooks.generateTestHeaderStringAsync({payload,secret,timestamp,cryptoProvider:Stripe.createSubtleCryptoProvider()});return new Request('https://relay.test/api/billing/webhook',{method:'POST',body:payload,headers:{'Stripe-Signature':signature}});}
 it('rejects forged and stale signatures',async()=>{for(const req of [await request({},'wrong'),await request({},'whsec_fixture',now()-500)])expect((await webhook(req,e)).status).toBe(400);});
 it('rejects live events in test mode',async()=>{expect((await webhook(await request({livemode:true}),e)).status).toBe(400);});
 it('routes signed events only through persisted customer mapping',async()=>{const uid=await member(),sync=vi.fn().mockResolvedValue(Response.json({received:true})),names:string[]=[];const target={...e,HUBS:{idFromName:(name:string)=>{names.push(name);return name;},get:()=>({fetch:sync})}};const event={id:'evt_fixture',livemode:false,type:'invoice.paid',data:{object:{customer:'cus_'+uid,metadata:{user_id:'attacker'}}}};expect((await webhook(await request(event),target)).status).toBe(200);expect(names).toEqual([uid]);expect(JSON.parse(await sync.mock.calls[0][0].text()).uid).toBe(uid);});
 it('ignores unknown customers instead of using event metadata',async()=>{const r=await webhook(await request({livemode:false,type:'invoice.paid',data:{object:{customer:'cus_unknown',metadata:{user_id:'a'}}}}),e);expect(r.status).toBe(200);expect(mocks.subscriptions).not.toHaveBeenCalled();});
});
