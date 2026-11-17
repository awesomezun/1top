// The remote subscription's plans (docs/design/subscription/subscription-plan_v1.0.0.md), as on the iPhone
// (Subscription.swift). RevenueCat supplies the store's own prices, trial and purchases once its key is in the app;
// until then the preview shows the planned prices and buys nothing. Remote access itself is decided by the relay.
export type Plan={id:string;yearly:boolean;amount:number;currency:string;trialDays:number|null};
export type Backend={live:boolean;plans:()=>Promise<Plan[]>;buy:(id:string)=>Promise<boolean>;restore:()=>Promise<boolean>};

// 월 $2.99 · 연 $19.99 with a 7-day trial; Google Play's subscription remote with the base plans monthly and yearly.
export const PREVIEW:Backend={live:false,
 plans:async()=>[{id:'remote:yearly',yearly:true,amount:19.99,currency:'USD',trialDays:7},{id:'remote:monthly',yearly:false,amount:2.99,currency:'USD',trialDays:7}],
 buy:async()=>{throw new Error('Subscriptions open soon. Nothing was charged.');},
 restore:async()=>false};

/** The relay's answer for a signed-in account without remote access: the subscription sheet answers it. */
export const needsSubscription=(e:any)=>e?.status===403&&['hosted_access_required','subscription_required'].includes(e?.code);

export const sortPlans=(plans:Plan[])=>[...plans].sort((a,b)=>Number(b.yearly)-Number(a.yearly));
export function money(amount:number,currency:string,locale?:string){
 // Hermes writes US$ for dollars in Korean; the plain sign reads as the sheet shows it everywhere.
 if(currency==='USD')return '$'+amount.toFixed(2);
 try{return new Intl.NumberFormat(locale,{style:'currency',currency,currencyDisplay:'narrowSymbol'}).format(amount);}catch{return currency+' '+amount.toFixed(2);}
}
/** The yearly plan per month, for comparison: $1.67. */
export const perMonth=(plan:Plan)=>Math.round(plan.amount/12*100)/100;
/** The yearly plan against twelve monthly payments, in whole percent: 44. */
export function saving(plans:Plan[]){
 const y=plans.find(p=>p.yearly),m=plans.find(p=>!p.yearly);
 if(!y||!m||m.amount<=0||y.currency!==m.currency)return null;
 const share=y.amount/(m.amount*12);return share<1?Math.floor((1-share)*100+1e-9):null;
}
