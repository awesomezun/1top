import type {Device,Session} from './types';
import type {Mail} from './thread';
export function demoDevices():Device[]{const now=Date.now();const sessions:Session[]=[
 {id:'demo-a',control_key:'demo',kind:'Claude',app:'Cursor',terminal:'Frontend',project:'website',title:'website',model:'claude-sonnet-4-6',status:'working',tokens:[14000,62000,4000,5000],rate:820,windows:{'24h':[50000,220000,10000,30000],'12h':[30000,160000,8000,22000],'5h':[20000,100000,5000,12000],'1h':[14000,62000,4000,5000],'30m':[8000,30000,2000,3000],'10m':[2000,9000,500,800]},cpu:12,rss:220000000,capabilities:['focus','pause','resume','terminate','prompt','message','mailbox','message_images'],context_usage:{basis:'last_request_input',input_tokens:64000,capacity:null,parts:[12000,48000,4000],observed_at:now/1000,model:'claude-sonnet-4-6'}},
 {id:'demo-b',control_key:'demo',kind:'Codex',app:'Orca',terminal:'Backend',project:'api-service',title:'api-service',model:'gpt-5.4',status:'working',tokens:[22000,48000,0,8000],rate:470,windows:{'24h':[60000,150000,0,40000],'12h':[35000,100000,0,27000],'5h':[25000,80000,0,16000],'1h':[22000,48000,0,8000],'30m':[10000,22000,0,4000],'10m':[4000,7000,0,1000]},cpu:8,rss:180000000,capabilities:['focus','pause','terminate','prompt'],context_usage:{basis:'last_request_input',input_tokens:70000,capacity:200000,parts:[22000,48000,0],observed_at:now/1000,model:'gpt-5.4'}},
 {id:'demo-c',control_key:'demo',kind:'Aside',app:'Aside',terminal:'Research',project:'literature',title:'literature',model:'gpt-5.4',status:'working',tokens:null,rate:null,windows:{},cpu:null,rss:null,capabilities:['focus','prompt','message','mailbox']}
 ];return [{id:'demo-mac',name:'MacBook Pro',platform:'Darwin',online:true,received:now,snapshot:{version:'demo',sessions,host:{cpu:24,used_memory:28*2**30,total_memory:64*2**30,cores:12},account_quotas:[{id:'claude-demo',kind:'Claude',account_label:'Claude Code · Personal',plan:'Max',updated:now/1000,stale:false,windows:[{key:'5h',label:'5H',pct:28,reset:now/1000+7200},{key:'weekly',label:'Weekly',pct:61,reset:now/1000+172800}]},{id:'codex-demo',kind:'Codex',account_label:'Codex · Work',plan:'Pro',updated:now/1000,stale:false,windows:[{key:'weekly',label:'Weekly',pct:72,reset:now/1000+190000}]}],operations:{installed_skills:18,observed_events:7,goals:[{runtime:'Codex',status:'active',tokens_used:12000,session_connected:true}]}}},
 // A second computer so "All computers" shows its sessions, meters, the shared Codex account once,
 // a limit that could not be refreshed, the waiting and paused shapes, and a computer paired without remote control.
 {id:'demo-mini',name:'Mac mini',platform:'Darwin',online:true,allow_control:false,received:now,snapshot:{version:'demo',sessions:[
  {id:'demo-d',control_key:'demo',kind:'GLM',app:'Terminal',terminal:'Docs',project:'docs',title:'docs',model:'glm-5',status:'working',tokens:[6000,30000,0,2000],rate:210,windows:{'24h':[20000,90000,0,6000],'12h':[12000,60000,0,4000],'5h':[9000,42000,0,3000],'1h':[6000,30000,0,2000],'30m':[3000,14000,0,1000],'10m':[1000,4000,0,300]},cpu:6,rss:150000000,capabilities:[]},
  {id:'demo-e',control_key:'demo',kind:'Codex',app:'Terminal',terminal:'Release',project:'release-notes',title:'release-notes',model:'gpt-5.4',status:'waiting',tokens:[2000,9000,0,500],rate:0,windows:{'24h':[4000,18000,0,1000],'12h':[2000,9000,0,500],'5h':[1000,4000,0,200],'1h':[300,1200,0,50],'30m':[0,0,0,0],'10m':[0,0,0,0]},cpu:0.2,rss:90000000,capabilities:[]},
  {id:'demo-f',control_key:'demo',kind:'Claude',app:'Terminal',terminal:'Migrate',project:'data-pipeline',title:'data-pipeline',model:'claude-sonnet-4-6',status:'paused',tokens:[1000,6000,0,300],rate:0,windows:{'24h':[3000,12000,0,600],'12h':[1000,6000,0,300],'5h':[500,2000,0,100],'1h':[0,0,0,0],'30m':[0,0,0,0],'10m':[0,0,0,0]},cpu:0.1,rss:80000000,capabilities:[]}
 ],host:{cpu:31,used_memory:44*2**30,total_memory:64*2**30,cores:10},account_quotas:[{id:'codex-demo',kind:'Codex',account_label:'Codex · Work',plan:'Pro',updated:now/1000-60,stale:false,windows:[{key:'weekly',label:'Weekly',pct:71,reset:now/1000+190000}]},{id:'claude-team-demo',kind:'Claude',account_label:'Claude Code · Team',plan:'Team',updated:now/1000-38*60,stale:true,windows:[{key:'weekly',label:'Weekly',pct:44,reset:now/1000+250000}]}]}}];}

/** Demo conversations: Frontend works without activity on its open request, so only its work shows;
 *  Research is preparing a reply and shows every delivery problem. Nothing here is sent anywhere. */
export function demoThread(sessionId:string,t:(en:string,ko:string)=>string):Mail[]{
 const now=Date.now()/1000;
 if(sessionId==='demo-a')return [
  {id:'m1',created:now-1500,status:'replied',text:t('How far along are you?','지금 어디까지 진행됐어?'),reply:t('The checkout refactor is done. 10 of 12 tests pass; I am looking at the two failures in the address form.','결제 화면 리팩터링은 끝났습니다. 테스트 12개 중 10개가 통과했고, 주소 입력 폼의 실패 2개를 보고 있습니다.'),reply_at:now-1440},
  {id:'m2',created:now-900,status:'replied',text:t('The pay button looks off on my phone. Can you check this screenshot?','폰에서 결제 버튼이 어긋나 보여. 이 스크린샷 확인해 줘.'),attachments:[{id:'a1',name:'checkout.jpg',mime:'image/jpeg',bytes:286000}],reply:t('The button sat 8px below the grid on narrow screens. Fixed in CheckoutFooter.tsx.','좁은 화면에서 버튼이 격자보다 8px 내려가 있었습니다. CheckoutFooter.tsx에서 고쳤습니다.'),reply_at:now-820},
  {id:'m3',created:now-120,status:'awaiting_reply',text:t('What is causing the last two failures?','남은 실패 2개 원인이 뭐야?'),reply:''},
 ];
 if(sessionId==='demo-c')return [
  {id:'r1',created:now-3000,status:'not_delivered',text:t('Summarise the three papers we saved.','저장한 논문 세 편 요약해 줘.'),reply:''},
  {id:'r2',created:now-2400,status:'source_changed',text:t('Add the citation list too.','인용 목록도 붙여 줘.'),reply:''},
  {id:'r3',created:now-600,status:'delivery_unconfirmed',text:t('Which one is the most recent?','가장 최근 논문은 어느 거야?'),reply:''},
  {id:'r4',created:now-300,status:'queued',text:t('Then draft the related-work section.','그다음 관련 연구 절 초안 써 줘.'),reply:''},
  {id:'r5',created:now-90,status:'awaiting_reply',text:t('Are you still there?','아직 거기 있어?'),reply:'',activity:{phase:'responding',observed_at:now-4}},
  {id:'r6',created:now-5,status:'sending',text:t('Use APA style.','APA 형식으로 해 줘.'),reply:''},
 ];
 return [];
}
