// Paywall B on the web (docs/design/subscription/paywall-options_v1.0.0), as on the phones: over the demo a bar leads to
// the live workspace, and a signed-in account without remote access gets the subscription sheet over the demo, which
// stays where it was when the sheet closes. The relay decides access; checkout opens once billing is switched on.
const PLANS=[{id:'yearly',yearly:true,amount:19.99,currency:'USD',trialDays:7},{id:'monthly',yearly:false,amount:2.99,currency:'USD',trialDays:7}];
const TEXT={
 example:['예시 데이터','Example data','示例数据'],
 connect:['＋ 내 컴퓨터 연결','＋ Connect my computer','＋ 连接我的电脑'],
 title:['내 컴퓨터를 연결하려면 구독이 필요해요','Subscribe to connect your computer','连接你的电脑需要订阅'],
 looking:['지금은 예시 데이터를 보고 있어요','You are looking at example data','你正在查看示例数据'],
 yearly:['연간','Yearly','年度'],monthly:['월간','Monthly','月度'],
 perYear:['/년','/year','/年'],perMonth:['/월','/month','/月'],
 each:['월 {p}꼴','{p} a month','每月约 {p}'],save:['{n}% 절약','Save {n}%','省 {n}%'],
 trial:['{n}일 무료로 시작','Start {n}-day free trial','免费试用 {n} 天'],subscribe:['구독하기','Subscribe','订阅'],
 thenYear:['체험 후 연 {p}','then {p} a year','试用后每年 {p}'],thenMonth:['체험 후 월 {p}','then {p} a month','试用后每月 {p}'],
 cancel:[' · 언제든 취소',' · cancel any time',' · 可随时取消'],
 soon:['구독은 곧 열립니다. 결제된 것은 없습니다.','Subscriptions open soon. Nothing was charged.','订阅即将开放，未产生任何扣款。'],
 terms:['이용약관','Terms of use','使用条款'],privacy:['개인정보 처리방침','Privacy','隐私政策'],close:['닫기','Close','关闭'],
 fine:['취소하지 않으면 체험이 끝난 뒤 자동으로 결제되고, 구독은 기간마다 자동 갱신됩니다. 계정 화면에서 언제든 해지할 수 있습니다.',
  'Unless cancelled, the trial turns into a paid subscription, and the subscription renews each period. Cancel any time from your account.',
  '除非取消，试用结束后将自动扣款，订阅按周期自动续订。可随时在账户页面取消。'],
};
const lang=()=>document.documentElement.lang.startsWith('zh')?2:document.documentElement.lang==='en'?1:0;
const say=(key,values={})=>Object.entries(values).reduce((text,[k,v])=>text.replace('{'+k+'}',v),TEXT[key][lang()]);
const money=(amount,currency)=>{try{return new Intl.NumberFormat(['ko-KR','en-US','zh-CN'][lang()],{style:'currency',currency,currencyDisplay:'narrowSymbol'}).format(amount);}catch{return currency+' '+amount.toFixed(2);}};
const saving=()=>{const y=PLANS.find(p=>p.yearly),m=PLANS.find(p=>!p.yearly),share=y.amount/(m.amount*12);return share<1?Math.floor((1-share)*100+1e-9):null;};

/** The bar and the sheet. subscribing: a signed-in account without remote access, sent here by the live page. */
export function paywall({subscribing,open=subscribing}){
 let chosen='yearly',note='';
 const bar=document.createElement('div');bar.className='paywall-bar';bar.innerHTML='<span class="paywall-dot"></span><span data-t="example"></span><button type="button" data-t="connect" data-paywall-connect></button>';
 const sheet=document.createElement('dialog');sheet.className='paywall-sheet';sheet.setAttribute('aria-labelledby','paywallTitle');
 document.body.append(bar,sheet);
 function render(){
  for(const el of bar.querySelectorAll('[data-t]'))el.textContent=say(el.dataset.t);
  const plan=PLANS.find(p=>p.id===chosen),price=money(plan.amount,plan.currency),off=saving();
  const row=p=>`<button type="button" class="paywall-plan${p.id===chosen?' on':''}" data-paywall-plan="${p.id}" role="radio" aria-checked="${p.id===chosen}">
   ${p.yearly&&off!==null?`<span class="paywall-badge">${say('save',{n:off})}</span>`:''}<span class="paywall-radio"></span>
   <span class="paywall-name"><b>${say(p.yearly?'yearly':'monthly')}</b>${p.yearly?`<small>${say('each',{p:money(Math.round(p.amount/12*100)/100,p.currency)})}</small>`:''}</span>
   <span class="paywall-price"><b>${money(p.amount,p.currency)}</b><small>${say(p.yearly?'perYear':'perMonth')}</small></span></button>`;
  sheet.innerHTML=`<div class="paywall-grab"></div><div class="paywall-head"><h2 id="paywallTitle">${say('title')}</h2><button type="button" class="paywall-close" data-paywall-close aria-label="${say('close')}">✕</button></div>
   <p class="paywall-lock">🔒 ${say('looking')}</p><div class="paywall-plans" role="radiogroup">${PLANS.map(row).join('')}</div>
   <button type="button" class="paywall-cta" data-paywall-subscribe autofocus>${plan.trialDays?say('trial',{n:plan.trialDays}):say('subscribe')}<small>${say(plan.yearly?'thenYear':'thenMonth',{p:price})+say('cancel')}</small></button>
   <p class="paywall-note"${note?'':' hidden'}>${note}</p>
   <p class="paywall-links"><a href="/terms">${say('terms')}</a><a href="/privacy">${say('privacy')}</a></p><p class="paywall-fine">${say('fine')}</p>`;
 }
 const show=()=>{render();if(!sheet.open)sheet.showModal();};
 bar.addEventListener('click',e=>{
  if(!e.target.closest('[data-paywall-connect]'))return;
  // Signed in without access, the sheet; otherwise the live workspace, which signs in first and sends an account
  // without access back here.
  if(subscribing)show();else location.assign('/app/');
 });
 sheet.addEventListener('click',e=>{
  if(e.target===sheet||e.target.closest('[data-paywall-close]')){sheet.close();return;}
  const plan=e.target.closest('[data-paywall-plan]');if(plan){chosen=plan.dataset.paywallPlan;render();return;}
  if(e.target.closest('[data-paywall-subscribe]')){note=say('soon');render();}
 });
 new MutationObserver(render).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 render();if(open)show();
 return {show};
}
