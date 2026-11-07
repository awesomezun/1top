"""Account-scoped credentials. Refresh in the existing native credential store."""
import base64
import hashlib
import json
import threading
import time
import urllib.error
from pathlib import Path

from .accounts import read_json, identity, timestamp, claude_credentials, claude_identity, codex_rpc
from .claude_profiles import CredentialError, refresh_managed
from .credential_store import account_key


def jwt_expiry(token):
    try:
        part=token.split('.')[1]
        value=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4))).get('exp')
        return timestamp(value)
    except (ValueError,IndexError,AttributeError,TypeError):return 0


class Credentials:
    def __init__(self,sampler):
        self.sampler=sampler
        self.lock=threading.Lock();self.locks={};self.cache={}
        self.sources={};self.sources_at=0
        self.verified={}

    def get(self,account,force=False,rejected=None):
        key=account['id']
        with self.lock:guard=self.locks.setdefault(key,threading.Lock())
        with guard:
            now=time.time()
            if account['kind']=='GLM':
                from .provider_quotas import discover
                with self.lock:
                    if now-self.sources_at>120 or key not in self.sources:
                        self.sources={s.id:s for s in discover() if s.kind=='GLM'}
                        self.sources_at=now
                    source=self.sources.get(key)
                if not source:raise CredentialError('login_required')
                return {'Authorization':'Bearer '+source.token,'_host':source.host}
            roots=[Path(root) for root,binding in self.sampler.roots().items()
                   if binding[0]==key and binding[1]==account['kind']]
            if not roots:raise CredentialError('login_required')
            # Managed profiles are independent of the CLI's currently selected account.
            from .claude_profiles import managed
            roots.sort(key=lambda root:not managed(root))
            last_error=CredentialError('login_required')
            for root in roots:
                try:return self._profile(account,root,now,force,rejected)
                except CredentialError as error:last_error=error
                except (OSError,ValueError):last_error=CredentialError('credential_store_unavailable')
            raise last_error

    def _profile(self,account,root,now,force,rejected):
        key=account['id'];kind=account['kind']
        def current_key():
            if kind=='Claude':return account_key(root)
            tokens=read_json(root/'auth.json').get('tokens') or {}
            return identity('Codex',tokens['account_id']) if tokens.get('account_id') else None
        if current_key()!=key:raise CredentialError('account_changed')
        cache=self.cache.get((key,str(root)))
        # Concurrent 401s share the first refresh instead of rotating again.
        if cache and cache[0]>now and (not force or (rejected and cache[1].get('Authorization')!=rejected)):
            return dict(cache[1])
        if kind=='Claude':
            value=claude_credentials(root)
            refreshed=False
            if ((force and (not rejected or 'Bearer '+str(value.get('accessToken',''))==rejected))
                    or timestamp(value.get('expiresAt'))<now+60):
                value=refresh_managed(root,force=force)
                refreshed=True
            def verify(value):
                token=value.get('accessToken')
                if not isinstance(token,str) or not token:raise CredentialError('login_required')
                fingerprint=hashlib.sha256(token.encode()).hexdigest()
                existing=getattr(self.sampler,'claude_verified',{})
                if self.verified.get(fingerprint)==key or isinstance(existing,dict) and existing.get(fingerprint)==key:return
                if claude_identity(token)!=key:raise CredentialError('account_changed')
                if len(self.verified)>128:self.verified.clear()
                self.verified[fingerprint]=key
            try:verify(value)
            except urllib.error.HTTPError as error:
                code=error.code;error.close()
                if code!=401 or refreshed:raise CredentialError('login_required' if code==401 else 'provider_unavailable') from None
                value=refresh_managed(root,force=True)
                verify(value)
            token=value.get('accessToken')
            config=Path.home()/'.claude.json' if root.resolve()==(Path.home()/'.claude').resolve() else root/'.claude.json'
            oauth=read_json(config).get('oauthAccount') or {}
            result={'Authorization':'Bearer '+str(token or ''),'_account_uuid':oauth.get('accountUuid','')}
            expires=timestamp(value.get('expiresAt'))
        elif kind=='Codex':
            value=read_json(root/'auth.json').get('tokens') or {}
            token=value.get('access_token');expires=jwt_expiry(token)
            if ((force and (not rejected or 'Bearer '+str(token or '')==rejected)) or (expires and expires<now+60)):
                codex_rpc(root,refresh=True)
                value=read_json(root/'auth.json').get('tokens') or {}
                token=value.get('access_token');expires=jwt_expiry(token)
            result={'Authorization':'Bearer '+str(token or ''),'ChatGPT-Account-Id':value.get('account_id',''),
                    'originator':'codex_cli_rs'}
        else:raise CredentialError('provider_unavailable')
        if current_key()!=key:raise CredentialError('account_changed')
        if not isinstance(token,str) or not token:raise CredentialError('login_required')
        self.cache[(key,str(root))]=(min(now+30,expires-30) if expires else now+30,dict(result))
        return result
