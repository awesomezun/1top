import argparse,json,os,platform,sys,threading,time,signal
from pathlib import Path
from . import __version__
from .platform_support import lock_instance

def main():
    parser=argparse.ArgumentParser(prog='1top',description='Your AI agents, across apps and computers.')
    parser.add_argument('command',nargs='?',choices=['run','connect','local','version','statusline','telemetry-enable','telemetry-disable','telemetry-status','authorize-claude','gateway','gateway-claude','gateway-codex','gateway-glm'],default='run')
    parser.add_argument('--profile',help='Exact existing 1top Claude profile to connect once')
    parser.add_argument('--config',help='Local statusline wrapper specification (statusline only)')
    parser.add_argument('--port',type=int,default=18766)
    parser.add_argument('--gateway-port',type=int,default=18767)
    parser.add_argument('--headless',action='store_true')
    parser.add_argument('--relay',help='Explicit HTTPS origin of your own relay (connect only)')
    # Native CLI arguments are accepted only after an explicit separator.
    raw=sys.argv[1:];client_args=[]
    if '--' in raw:
        separator=raw.index('--');client_args=raw[separator+1:];raw=raw[:separator]
    args=parser.parse_args(raw)
    if client_args and args.command not in ('gateway-claude','gateway-codex','gateway-glm'):
        parser.error('native arguments require a gateway client command')
    if args.relay and args.command!='connect':parser.error('--relay requires connect')
    if args.command=='version':print(__version__);return
    if args.command=='authorize-claude':
        if not args.profile:parser.error('authorize-claude requires --profile')
        from .credential_store import authorize
        from .claude_profiles import CredentialError
        try:print(json.dumps(authorize(args.profile)))
        except CredentialError as error:print(json.dumps({'ok':False,'error':error.code}));sys.exit(1)
        return
    if args.profile:parser.error('--profile requires authorize-claude')
    if args.command.startswith('telemetry-'):
        from .telemetry_setup import command
        print(json.dumps(command(args.command, args.port),ensure_ascii=False,indent=2));return
    if args.command=='statusline':
        if not args.config:parser.error('statusline requires --config')
        from .claude_statusline import run
        sys.exit(run(args.config))
    if args.config:parser.error('--config requires statusline')
    if args.command in ('gateway-claude','gateway-codex','gateway-glm'):
        from .gateway_client import run
        from .platform_support import data_directory
        provider={'gateway-claude':'Claude','gateway-codex':'Codex','gateway-glm':'GLM'}[args.command]
        try:code=run(provider,client_args,data_directory(),args.gateway_port)
        except (OSError,ValueError):
            print('1top gateway 또는 원래 CLI에 연결하지 못했습니다. 먼저 1top gateway를 실행하세요.',file=sys.stderr);code=1
        sys.exit(code)
    if args.command=='gateway':
        from .gateway import run
        from .platform_support import data_directory
        run(data_directory(),args.gateway_port);return
    if platform.system() not in ('Darwin','Windows'):
        print('This release supports macOS and Windows.',file=sys.stderr);sys.exit(2)
    from .server import Collector,Handler,DATA,DashboardHTTPServer
    from .controls import Controller
    from .bridge import CloudLink,save_private,open_url
    import secrets
    DATA.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=(DATA/'agent.lock').open('a+')
    try:lock_instance(lock)
    except BlockingIOError:
        print('1top is already running.',file=sys.stderr);return
    server=DashboardHTTPServer(('127.0.0.1',args.port),Handler)
    collector=Collector();server.collector=collector;server.action_token=secrets.token_urlsafe(32)
    from .gateway import GatewayService
    server.routing=GatewayService(DATA,collector.accounts)
    server.routing.start_saved()
    from .telemetry import receiver_key
    server.telemetry_key=receiver_key(DATA)
    from .account_login import AccountLogin
    server.account_login=AccountLogin()
    server.controller=Controller(collector,Collector,state_file=DATA/'controls-v5.json')
    collector.controller=server.controller
    threading.Thread(target=collector.loop,daemon=True).start()
    threading.Thread(target=server.serve_forever,daemon=True).start()
    bridge=CloudLink(collector,server.controller,DATA,relay=args.relay)
    server.bridge=bridge
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
    finally:bridge.stop.set();server.routing.close();server.shutdown();server.server_close();lock.close()

if __name__=='__main__':main()
