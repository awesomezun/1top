"""Explicit, single-prompt enrollment; background reads can never request UI."""
import getpass
import json
from pathlib import Path
import shutil
import subprocess
import sys

from .platform_support import data_directory

NAME='onetop-credential-store-v1.0.0'

def helper():
    path=data_directory()/'tools'/NAME
    return path if path.is_file() and not path.is_symlink() else None

def install_helper():
    from .claude_profiles import CredentialError
    if helper():return helper()
    packaged=Path(sys.executable).parent/NAME
    if not packaged.is_file():raise CredentialError('helper_unavailable')
    path=data_directory()/'tools'/NAME;path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    # Never overwrite a helper that already owns a Keychain ACL.
    with packaged.open('rb') as src,path.open('xb') as dst:shutil.copyfileobj(src,dst)
    path.chmod(0o500)
    return path

def account_key(root):
    from .accounts import read_json,identity
    config=Path.home()/'.claude.json' if root.resolve()==(Path.home()/'.claude').resolve() else root/'.claude.json'
    a=read_json(config).get('oauthAccount') or {}
    return identity('Claude',a['accountUuid'],a.get('organizationUuid','')) if a.get('accountUuid') else None

def invoke(root,action,document=None,interactive=False):
    from .claude_profiles import service_name,CredentialError
    if interactive != (action=='authorize'):raise CredentialError('invalid_operation')
    path=install_helper() if interactive else helper()
    if not path:return None
    key=account_key(root)
    if not key:
        if action=='get':return None
        raise CredentialError('login_required')
    command=[str(path),action,service_name(root),getpass.getuser()]
    if interactive:command.append(key)
    payload=None if document is None else json.dumps({'schema':1,'account_id':key,'document':document}).encode()
    try:
        p=subprocess.run(command,input=payload,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                         timeout=120 if interactive else 8,check=False)
        if len(p.stdout)>128*1024:raise ValueError()
        result=json.loads(p.stdout)
    except (OSError,ValueError,subprocess.TimeoutExpired):raise CredentialError('credential_store_unavailable') from None
    if not isinstance(result,dict) or p.returncode:raise CredentialError('credential_store_unavailable')
    if result.get('missing'):return None
    if action=='get':
        if result.get('account_id')!=key:return None
        value=result.get('document')
        return value if isinstance(value,dict) else None
    return result

def enrolled_document(root):
    if sys.platform!='darwin':return None
    return invoke(Path(root),'get')

def save_enrolled(root,document):
    return invoke(Path(root),'set',document)

def authorize(root):
    from .claude_profiles import managed,CredentialError,refresh_lock
    root=Path(root).expanduser().resolve()
    if sys.platform!='darwin' or not managed(root):raise CredentialError('managed_profile_required')
    with refresh_lock(root):return invoke(root,'authorize',interactive=True)
