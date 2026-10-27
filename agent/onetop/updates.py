"""Daily release checks. An unsigned preview is never installed automatically."""
import json
import re
import threading
import time
import urllib.request
from . import __version__
from .bridge import SSL,NoRedirect

FEED='https://1top.si/release.json'
RELEASES='https://github.com/awesomezun/1top/releases/tag/v'

def release_info(value,current=__version__):
    version=value.get('version','')
    if not isinstance(version,str) or not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Invalid release version')
    return dict(version=version,current=current,available=tuple(map(int,version.split('.')))>tuple(map(int,current.split('.'))),
                release_url=RELEASES+version,status='verified' if value.get('signed') is True and value.get('notarized') is True else 'preview',
                automatic_install=False,checked=time.time())

class UpdateMonitor:
    def __init__(self):
        self.value={'current':__version__,'available':False,'checked':None,'automatic_install':False}
    def check(self):
        from .windows_runtime import package_identity, STORE_UPDATES
        if package_identity():
            self.value={'current':__version__,'available':False,'checked':time.time(),
                        'automatic_install':False,'channel':'microsoft-store',
                        'release_url':STORE_UPDATES,'status':'store-managed'}
            return
        try:
            opener=urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=SSL))
            with opener.open(urllib.request.Request(FEED,headers={'User-Agent':'1top/'+__version__}),timeout=10) as response:
                raw=response.read(65537)
                if len(raw)>65536:raise ValueError('Release metadata too large')
                self.value=release_info(json.loads(raw))
        except (OSError,ValueError,TypeError):
            self.value={**self.value,'error':'Update check unavailable. Your installed app continues to work.'}
    def run(self,stop):
        while not stop.is_set():
            self.check()
            if stop.wait(86400):break
