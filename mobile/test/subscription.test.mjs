// Paywall B's words and the relay answer that opens it, as the iPhone's SubscriptionTests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PREVIEW,needsSubscription,perMonth,saving,sortPlans,money} from '../src/subscription.ts';

test('the planned prices read as the sheet shows them', async()=>{
 const plans=sortPlans(await PREVIEW.plans());
 assert.deepEqual(plans.map(p=>p.yearly),[true,false]);
 assert.equal(saving(plans),44);
 assert.equal(perMonth(plans[0]),1.67);
 assert.equal(money(plans[0].amount,'USD','en-US'),'$19.99');
 assert.equal(money(plans[0].amount,'USD','ko-KR'),'$19.99');
 assert.equal(money(1.67,'USD','zh-CN'),'$1.67');
 assert.equal(plans[0].trialDays,7);
});
test('the preview charges nothing', async()=>{
 await assert.rejects(PREVIEW.buy('remote:yearly'));
 assert.equal(await PREVIEW.restore(),false);
 assert.equal(PREVIEW.live,false);
});
test('only the access code opens the subscription', ()=>{
 assert.equal(needsSubscription({status:403,code:'hosted_access_required'}),true);
 assert.equal(needsSubscription({status:403,code:'subscription_required'}),true);
 assert.equal(needsSubscription({status:403}),false);
 assert.equal(needsSubscription({status:401,code:'hosted_access_required'}),false);
});
