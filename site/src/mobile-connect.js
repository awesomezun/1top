export function mobileConnection(t,user){
 const p=new URLSearchParams(location.search),challenge=p.get('challenge'),state=p.get('state'),platform=p.get('platform');
 if(!/^[a-f0-9]{64}$/.test(challenge||'')||!/^[a-f0-9]{32}$/.test(state||'')||!['iOS','Android'].includes(platform))return `<main class="center-page"><h1>${t('Open sign-in from the 1top app.','1top 앱에서 로그인을 시작하세요.')}</h1><p>${t('This connection request is invalid.','올바른 모바일 연결 요청이 아닙니다.')}</p></main>`;
 return `<main class="center-page"><p class="eyebrow">1TOP / ${platform}</p><h1>${t('Your computers. On your phone.','내 컴퓨터를, 휴대폰에서도.')}</h1><p>${t('Connect the 1top mobile app you just opened to your account. It can view your linked computers and use the session controls you enabled.','방금 실행한 1top 모바일 앱을 본인 계정에 연결합니다. 연결된 컴퓨터를 조회하고 허용된 세션 제어를 사용할 수 있습니다.')}</p><p class="fine">${t('Only continue if you started this request in your own 1top app. Managed access is currently limited to approved accounts.','본인의 1top 앱에서 시작한 요청일 때만 연결하세요. 현재 관리형 원격 접속은 승인된 계정에 한정됩니다.')}</p><button class="primary" ${user?'data-mobile-approve':'data-login'}>${user?t('Connect my mobile app','내 모바일 앱 연결'):t('Sign in with Google','Google로 로그인')}</button><div id="mobileResult" role="status"></div></main>`;
}
export async function approveMobile(api,t){
 const p=new URLSearchParams(location.search),button=document.querySelector('[data-mobile-approve]');button.disabled=true;
 try{
  await api('/api/mobile/authorize',{challenge:p.get('challenge'),platform:p.get('platform')});
  const target='onetop://connected?state='+encodeURIComponent(p.get('state'));
  const result=document.getElementById('mobileResult');result.replaceChildren();
  const title=document.createElement('h2');title.textContent=t('Connected. Return to 1top.','연결됐습니다. 1top으로 돌아가세요.');
  const link=document.createElement('a');link.className='primary';link.href=target;link.textContent=t('Open 1top','1top 열기');result.append(title,link);button.hidden=true;location.href=target;
 }catch(error){button.disabled=false;throw error;}
}
