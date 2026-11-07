import argparse,json,os,platform,sys,threading,time,signal
from pathlib import Path
from . import __version__
from .platform_support import lock_instance

def main():
    parser=argparse.ArgumentParser(prog='1top',description='Your AI agents, across apps and computers.')
    parser.add_argument('command',nargs='?',choices=['run','connect','local','version'],default='run')
    parser.add_argument('--port',type=int,default=18766)
    parser.add_argument('--headless',action='store_true')
    parser.add_argument('--relay',help='Explicit HTTPS origin of your own relay (connect only)')
    args=parser.parse_args()
    if args.relay and args.command!='connect':parser.error('--relay requires connect')
    if args.command=='version':print(__version__);return
    if platform.system() not in ('Darwin','Windows'):
        print('This release supports macOS and Windows.',file=sys.stderr);sys.exit(2)
    from .server import Collector,Handler,DATA
    from .controls import Controller
    from .bridge import CloudLink,save_private,open_url
    from http.server import ThreadingHTTPServer
    import secrets
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=(DATA/'agent.lock').open('a+')
    try:lock_instance(lock)
    except BlockingIOError:
        print('1top is already running.',file=sys.stderr);return
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    collector=Collector();server.collector=collector;server.action_token=secrets.token_urlsafe(32)
    from .account_login import AccountLogin
    server.account_login=AccountLogin()
    server.controller=Controller(collector,Collector,state_file=DATA/'controls-v5.json')
    threading.Thread(target=collector.loop,daemon=True).start()
    threading.Thread(target=server.serve_forever,daemon=True).start()
    bridge=CloudLink(collector,server.controller,DATA,relay=args.relay)
    from .updates import UpdateMonitor
    server.updates=UpdateMonitor()
    threading.Thread(target=server.updates.run,args=(bridge.stop,),daemon=True).start()
    bridge.status='Local monitoring'
    status_detail='Free local monitoring. No account or cloud connection is required.'
    def write_status():
        while not bridge.stop.is_set():
            save_private(DATA/'status.json',{'updated':time.time(),'status':bridge.status,'detail':status_detail})
            bridge.stop.wait(1)
    threading.Thread(target=write_status,daemon=True).start()
    def stop_signal(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop_signal)
    try:
        paired=False
        if args.command=='connect' and not args.headless:
            try:
                bridge.pair();paired=True
            except Exception:
                bridge.status='Local monitoring'
                status_detail='Remote connection is unavailable. Local monitoring is ready and your AI sessions are unaffected.'
        # A saved connection is prior opt-in. Fresh installs never pair implicitly.
        if args.command!='local' and bridge.config:
            status_detail='Local monitoring is ready. Your previously connected remote workspace is also enabled.'
            threading.Thread(target=bridge.run,daemon=True).start()
        if not args.headless:open_url('https://1top.si/app' if paired else 'http://127.0.0.1:'+str(args.port))
        while True:time.sleep(1)
    except KeyboardInterrupt:pass
    except Exception:
        bridge.status='Connection failed. Reopen 1top to try again.'
        save_private(DATA/'status.json',{'updated':time.time(),'status':bridge.status,'detail':'Your AI sessions are unaffected.'})
        raise
    finally:bridge.stop.set();server.shutdown();server.server_close();lock.close()

if __name__=='__main__':main()
