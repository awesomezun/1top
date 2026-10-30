// The one demo world every surface shows: the desktop dashboard and the menu bar and tray panels
// (scripts/demo-state.mjs, the MacBook Pro as "this Mac"), 1top.si/app?demo (remote-demo.js) and both
// phones (mobile/src/demo-world.ts and ios/OneTop/Model/DemoWorld.swift, written from this file by
// scripts/demo-world.mjs). Token use comes from demo-model.js over demo-usage.js. Projects, terminals,
// paths and accounts are invented; tool kinds, apps and models are ones the collector reports.
export const WORLD={
 // One person's computers rest together.
 rest:7,
 // seed and scale shape a computer's minutes (scale: the median tokens of an active minute); duty is how
 // often it works next to the main one. control: remote control allowed (the Mac mini is paired for usage
 // only). Host: memory and used in GB; cpu (%) and network rx and tx (bytes/s) are [idle, added when
 // busy], busy being its last whole minute of tokens over three times its scale (demo-model.js host).
 // The MacBook Pro's are the desktop demo collector's own.
 computers:[
  {id:'demo-0',name:'MacBook Pro',platform:'Darwin',seed:23,scale:1.3e6,duty:1,control:true,cores:12,memory:36,used:22.032,cpu:[9,45],
   network:{interfaces:['en0'],rx:[400e3,2.4e6],tx:[90e3,600e3]},disk:{total:1099511627776,free:440234147840,read:3250585.6,write:1258291.2}},
  {id:'demo-1',name:'Mac mini',platform:'Darwin',seed:61,scale:.3e6,duty:.2,control:false,cores:10,memory:24,used:15,cpu:[12.25,48],
   network:{interfaces:['en0','en1'],rx:[131072,917504],tx:[24576,147456]},disk:{total:549755813888,free:201863462912,read:838860.8,write:314572.8}},
  {id:'demo-2',name:'Workstation',platform:'Windows',seed:37,scale:.6e6,duty:.3,control:true,cores:16,memory:64,used:38,cpu:[14.35,48],
   network:{interfaces:['Ethernet'],rx:[545259.52,3816816.64],tx:[159744,958464]},disk:{total:2199023255552,free:1209462790553.6,read:5662310.4,write:2306867.2}},
 ],
 // Two accounts for each of Claude Code and Codex. id: what the relay shows ('Claude · 4f1c2a');
 // email: what the computer itself shows. per: weekly percent per token, set once from a typical week
 // of this world, so a limit is the tokens of its weekly window times per. reset: seconds after the demo
 // began (the window began 7 days before); five: the 5-hour window's reset and its percent per weekly
 // percent. The Codex account ml could not be refreshed for 38 minutes and asks to sign in again.
 accounts:[
  {key:'dev',id:'demo-claude-4f1c2a',kind:'Claude',email:'dev@example.com',plan:'Max',per:1.29e-8,reset:266000,five:{reset:7400,factor:6},source:'claude_statusline'},
  {key:'studio',id:'demo-claude-9b07e3',kind:'Claude',email:'studio@example.com',alias:'Studio',plan:'Pro',per:5.4e-8,reset:330000,five:{reset:14200,factor:6},source:'claude_statusline'},
  {key:'ops',id:'demo-codex-c2a957',kind:'Codex',email:'ops@example.com',plan:'Pro',per:1.3e-7,reset:300000},
  {key:'ml',id:'demo-codex-61d8f0',kind:'Codex',email:'ml@example.com',plan:'Plus',per:1.8e-8,reset:220000,stale:2280,status:'login_required'},
 ],
 // Shown sessions: [computer, id, kind, project, model, status, account, weight, app, title, effort].
 // status 'paused' is idle underneath; 'waiting' asks for input; weight is a usual share of its
 // computer. Gemini, Qwen Code, OpenCode and GitHub Copilot report sessions without token counts.
 sessions:[
  [0,'s1','Claude','checkout-web','claude-opus-5-5','working','dev',30,'Orca','Checkout UI','xhigh'],
  [0,'s2','Codex','billing-service','gpt-6.1-sol','working','ml',8,'Orca','Billing API','ultra'],
  [0,'s3','Claude','docs-site','claude-sonnet-5-5','working','studio',6,'Visual Studio Code','docs','high'],
  [0,'s4','GLM','data-sync','glm-5.3[1m]','waiting',null,2,'Orca','Nightly sync','high'],
  [0,'s5','Aside','0','gpt-6.1-sol','working',null,1.5,'Aside','Release notes','medium'],
  [0,'s6','Codex','api-gateway','gpt-6-astra','idle','ops',3,'Orca','Gateway','high'],
  [0,'s7','Claude','mobile-app','claude-haiku-5-5','paused','dev',2,'Orca','Mobile','low'],
  [0,'s8','Antigravity','research','gemini-3.5-pro','unknown',null,0,'Cursor','research',null],
  [0,'s9','Claude','design-tokens','claude-sonnet-5-5','waiting','dev',4,'Ghostty','tokens','medium'],
  [0,'s10','Gemini','release-bot',null,'unknown',null,0,'iTerm2','release',null],
  [0,'s11','Codex','data-pipeline','gpt-6-astra','idle','ops',2,'Terminal','etl','low'],
  [0,'s12','Claude','onboarding','claude-sonnet-5-5','idle','studio',1,'Warp','onboard','medium'],
  [1,'m1','Antigravity','search-index','claude-sonnet-5-5','working',null,2,'Ghostty','indexer','medium'],
  [1,'m2','Claude','support-replies','claude-haiku-5-5','idle','studio',2,'Claude','','low'],
  [1,'m3','Qwen Code','prototype',null,'unknown',null,0,'Terminal','proto',null],
  [2,'w1','Claude','game-engine','claude-fable-5-1','working','dev',14,'Windows Terminal','engine','max'],
  [2,'w2','Codex','infra-scripts','gpt-6.1-sol','waiting','ops',3,'powershell','infra','medium'],
  [2,'w3','GLM','analytics','glm-5.3[1m]','working',null,1.5,'Windsurf','analytics','xhigh'],
  [2,'w4','OpenCode','ui-kit',null,'unknown',null,0,'Windows Terminal','ui',null],
  [2,'w5','GitHub Copilot','notes',null,'unknown',null,0,'Visual Studio Code','copilot',null],
  [2,'w6','Codex','research','gpt-6-astra','idle','ml',1,'ChatGPT','','high'],
 ],
 // Subagents under a lead: [lead, name, share of the lead's weight, status].
 children:[['s1','reviewer',.25,'working'],['s1','tester',.1,'idle'],['s2','migrator',.3,'working']],
 // Earlier sessions, closed before the shown ones began: they fill the weekly windows and the history.
 // [computer, kind, account, model, project, weight].
 earlier:[
  [0,'Claude','dev','claude-opus-5-5','storefront',30],[0,'Claude','dev','claude-sonnet-5-5','design-system',8],
  [0,'Claude','studio','claude-sonnet-5-5','docs-site',6],[0,'Codex','ops','gpt-6-astra','api-gateway',4],
  [0,'Codex','ml','gpt-6.1-sol','ml-pipeline',7],[0,'GLM',null,'glm-5.3[1m]','data-sync',2],[0,'Aside',null,'gpt-6.1-sol','0',1.5],
  [1,'Claude','studio','claude-haiku-5-5','support-replies',2],
  [2,'Claude','dev','claude-fable-5-1','game-engine',14],[2,'Codex','ops','gpt-6.1-sol','infra-scripts',3],[2,'Codex','ml','gpt-6-astra','research',1],
 ],
 // A session whose CLI build sends no replies: instructions only.
 noReplies:['s6'],
 // The conversation demo on Checkout UI, alike on the web, the desktop dashboard and both phones.
 // earlier: what it opens with, oldest first. Nothing is being answered, so no reply is being written;
 // ago is seconds before now and replied seconds after sending; photos are listed by name, since the
 // relay carries no picture. script: what a sent message goes through, also filmed for the landing page.
 // Its text and photo (under site/public; the phones carry the same picture) are the example to send;
 // each step comes at seconds after sending. A message of the person's own keeps its text and photos,
 // and the steps and the reply follow the script.
 conversation:{
  session:'s1',
  earlier:[
   {ago:1500,status:'replied',replied:60,
    text:{ko:'지금 어디까지 진행됐나요?',en:'How far along are you?',zh:'现在进展到哪里了？'},
    reply:{ko:'결제 화면의 카드 입력 단계를 새 컴포넌트로 옮겼습니다. 남은 작업은 영수증 화면과 테스트 두 개입니다.',en:'I moved the card entry step of checkout to the new component. The receipt screen and two tests are left.',zh:'已将结账页面的银行卡输入步骤移到新组件，剩下收据页面和两个测试。'}},
   {ago:1080,status:'replied',replied:120,photos:['receipt.png'],
    text:{ko:'영수증 화면도 이 사진처럼 맞춰 주세요.',en:'Make the receipt screen match this photo too.',zh:'收据页面也请按这张照片调整。'},
    reply:{ko:'사진대로 영수증 화면의 여백과 글자 크기를 맞췄습니다.',en:'I matched the receipt screen\'s spacing and text sizes to the photo.',zh:'已按照片调整了收据页面的间距和字号。'}},
   {ago:420,status:'delivery_unconfirmed',
    text:{ko:'테스트가 끝나면 알려 주세요.',en:'Let me know when the tests finish.',zh:'测试完成后告诉我。'}},
  ],
  script:{
   text:{ko:'결제 화면 테스트는 어디까지 진행됐나요? 할인 코드 입력란도 확인해 주세요.',en:'How far along are the checkout tests? Please check the discount-code field too.',zh:'结账页面测试进行到哪里了？也请检查一下优惠码输入框。'},
   photo:'demo/checkout.png',
   // Taken in (queued), delivered and awaiting the reply, the session's three phases, then the reply.
   steps:[{at:0,status:'queued'},{at:2.2,status:'awaiting_reply'},{at:4.4,status:'awaiting_reply',activity:'responding'},
    {at:6.6,status:'awaiting_reply',activity:'working'},{at:8.8,status:'awaiting_reply',activity:'writing'},{at:11,status:'replied'}],
   reply:{ko:'결제 화면 테스트 42개 중 40개가 통과했습니다. 남은 2개는 보내 주신 화면의 할인 코드 입력란 문제라서 지금 고치고 있습니다.',en:'40 of the 42 checkout tests pass. The other 2 are the discount-code field in the screenshot you sent, and I am fixing it now.',zh:'42 个结账测试中有 40 个已通过。剩下 2 个是你发来的截图里的优惠码输入框问题，我正在修复。'},
  },
 },
 // Goals, loops and skills each computer reports, by computer.
 operations:[
  {installed_skills:14,observed_events:9,goals:[{thread_id:'demo-goal-1',runtime:'Codex',status:'active',tokens_used:18400000,time_used_seconds:6300,session_connected:true,evidence:'reported'}]},
  {installed_skills:8,observed_events:3,goals:[{thread_id:'demo-goal-2',runtime:'Claude Code',status:'complete',tokens_used:6200000,time_used_seconds:2700,session_connected:false,evidence:'last_observed'}]},
  {installed_skills:11,observed_events:5,goals:[{thread_id:'demo-goal-3',runtime:'Codex',status:'paused',tokens_used:9100000,time_used_seconds:4100,session_connected:true,evidence:'reported'}]},
 ],
};
// The conversation demo by itself, for the landing page's recordings: its earlier messages and the script.
export const CONVERSATION=WORLD.conversation;
