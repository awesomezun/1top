import argparse,json,os,platform,sys,threading,time,webbrowser,fcntl,signal
from pathlib import Path
from . import __version__

def main():
    parser=argparse.ArgumentParser(prog='1top',description='Your AI agents, across apps and computers.')
    parser.add_argument('command',nargs='?',choices=['run','connect','local','version'],default='run')
    parser.add_argument('--port',type=int,default=18766)
    parser.add_argument('--headless',action='store_true')
    args=parser.parse_args()
    if args.command=='version':print(__version__);return
    if platform.system()!='Darwin':
        print('This release supports macOS. Windows and Linux builds are not available yet.',file=sys.stderr);sys.exit(2)
    from .server import Collector,Handler,DATA
    from .controls import Controller
    from .bridge import CloudLink,save_private
    from http.server import ThreadingHTTPServer
    import secrets
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=(DATA/'agent.lock').open('a')
    try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        print('1top is already running.',file=sys.stderr);return
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    collector=Collector();server.collector=collector;server.action_token=secrets.token_urlsafe(32)
    server.controller=Controller(collector,Collector,state_file=DATA/'controls-v5.json')
    threading.Thread(target=collector.loop,daemon=True).start()
    threading.Thread(target=server.serve_forever,daemon=True).start()
    bridge=CloudLink(collector,server.controller,DATA)
    def write_status():
        while not bridge.stop.is_set():
            save_private(DATA/'status.json',{'updated':time.time(),'status':bridge.status,'detail':'Connected computers are visible only to your Google account. Keep 1top running to report usage.'})
            bridge.stop.wait(1)
    threading.Thread(target=write_status,daemon=True).start()
    def stop_signal(signum,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,stop_signal)
    try:
        if args.command=='local':
            if not args.headless:webbrowser.open('http://127.0.0.1:'+str(args.port))
        else:
            if (args.command=='connect' or not bridge.config) and not args.headless:bridge.pair()
            if bridge.config:
                threading.Thread(target=bridge.run,daemon=True).start()
                if not args.headless:webbrowser.open('https://1top.si/app')
        while True:time.sleep(1)
    except KeyboardInterrupt:pass
    except Exception:
        bridge.status='Connection failed. Reopen 1top to try again.'
        save_private(DATA/'status.json',{'updated':time.time(),'status':bridge.status,'detail':'Your AI sessions are unaffected.'})
        raise
    finally:bridge.stop.set();server.shutdown()

if __name__=='__main__':main()
