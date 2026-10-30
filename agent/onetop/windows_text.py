"""Words the Windows shell shows outside the dashboard, in the dashboard's language (한·EN·中).

The dashboard keeps the chosen language in its own storage. The quick view reports it to the
shell, which keeps a copy here so the tray menu, window titles and startup notices match it
even before a page has loaded. Only the language and theme are stored; no session data.
"""
import json

LANGUAGES = ('ko', 'en', 'zh')

TEXT = {
    'window_title': ('1top — 이 PC', '1top — This PC', '1top — 此电脑'),
    'quick_title': ('1top 간략 대시보드', '1top quick view', '1top 简略仪表盘'),
    'tray_tip': ('1top · AI 세션', '1top · AI sessions', '1top · AI 会话'),
    'menu_quick': ('간략 대시보드', 'Quick view', '简略仪表盘'),
    'menu_dashboard': ('전체 대시보드', 'Full dashboard', '完整仪表盘'),
    'menu_browser': ('브라우저에서 열기', 'Open in browser', '在浏览器中打开'),
    'menu_login': ('로그인할 때 실행', 'Open at login', '登录时启动'),
    'menu_remote': ('원격 대시보드 (선택)', 'Remote dashboard (optional)', '远程仪表盘（可选）'),
    'menu_connect': ('원격 기기 연결…', 'Connect a remote device…', '连接远程设备…'),
    'menu_updates': ('업데이트 확인…', 'Check for updates…', '检查更新…'),
    'menu_restart': ('로컬 수집기 다시 시작', 'Restart the local collector', '重启本地采集器'),
    'menu_quit': ('1top 종료', 'Quit 1top', '退出 1top'),
    'startup_title': ('1top — 시작할 수 없음', '1top — Unable to start', '1top — 无法启动'),
    'startup_intro': ('1top이 로컬 대시보드를 열지 못했습니다.', '1top could not open the local dashboard.',
                      '1top 无法打开本地仪表盘。'),
    'startup_kept': ('AI 세션은 멈추지 않았습니다.', 'Your AI sessions have not been stopped.', '你的 AI 会话没有停止。'),
    'startup_retry': ('다시 시도를 누르면 1top을 다시 시작합니다.', 'Retry to start 1top again.', '点击“重试”重新启动 1top。'),
    'startup_logs_hint': ('진단 기록을 확인한 뒤 1top을 다시 여세요.', 'Check the diagnostic logs and reopen 1top.',
                          '请查看诊断日志后重新打开 1top。'),
    'startup_logs': ('진단 기록:', 'Diagnostic logs:', '诊断日志：'),
    'collector_exited': ('로컬 수집기가 예기치 않게 종료되었습니다.', 'The local collector exited unexpectedly.',
                         '本地采集器意外退出。'),
    'connection_timeout': ('로컬 수집기가 {port} 포트에 연결되지 않았습니다.',
                           'The local collector did not connect on port {port}.', '本地采集器未在端口 {port} 上连接。'),
    'launch_failed': ('로컬 수집기를 시작하지 못했습니다.', 'The local collector could not be started.', '无法启动本地采集器。'),
    'webview_needed': ('대시보드를 표시하려면 Microsoft Edge WebView2 런타임이 필요합니다. 1top을 다시 열어 설치를 다시 시도하거나 '
                       'https://developer.microsoft.com/microsoft-edge/webview2 에서 런타임을 설치하세요.',
                       'Microsoft Edge WebView2 Runtime is needed. Reopen 1top to retry setup, '
                       'or install the runtime from https://developer.microsoft.com/microsoft-edge/webview2.',
                       '需要 Microsoft Edge WebView2 运行时。请重新打开 1top 再次安装，'
                       '或从 https://developer.microsoft.com/microsoft-edge/webview2 安装运行时。'),
    'window_failed': ('대시보드 창을 열지 못했습니다. Microsoft Edge WebView2 런타임이 설치되어 있는지 확인하세요.',
                      'The desktop window could not be opened. Check that Microsoft Edge WebView2 Runtime is installed.',
                      '无法打开仪表盘窗口。请确认已安装 Microsoft Edge WebView2 运行时。'),
    'webview_setup_title': ('1top — WebView2 설치', '1top — WebView2 setup', '1top — 安装 WebView2'),
    'webview_setup': ('대시보드를 표시하려면 Microsoft Edge WebView2 런타임이 필요합니다.\n\n'
                      '지금 설치할까요? Microsoft에서 런타임을 내려받으며 몇 분 걸릴 수 있습니다.',
                      '1top needs Microsoft Edge WebView2 Runtime to display the dashboard.\n\n'
                      'Install it now? This downloads the runtime from Microsoft and may take a few minutes.',
                      '1top 需要 Microsoft Edge WebView2 运行时来显示仪表盘。\n\n'
                      '现在安装吗？将从 Microsoft 下载运行时，可能需要几分钟。'),
    'collector_elsewhere': ('이 수집기는 다른 곳에서 시작되었습니다. 처음 시작한 앱이나 CLI에서 연결하세요.',
                            'This collector was started elsewhere. Connect from its original app or CLI.',
                            '此采集器是在别处启动的。请从最初启动它的应用或 CLI 连接。'),
    'https_only': ('HTTPS 서버 주소만 입력하세요.', 'Enter an HTTPS server address only.', '请只输入 HTTPS 服务器地址。'),
    'connect_started': ('원격 연결을 시작했습니다. 1top.si에서 이 PC를 확인하세요.',
                        'Remote connection started. Check this PC on 1top.si.', '已开始远程连接。请在 1top.si 上查看此电脑。'),
    'connect_failed': ('연결을 시작하지 못했습니다. HTTPS 주소를 확인하고 필요하면 1top을 다시 시작하세요.',
                       'Connection did not start. Check the HTTPS address and restart 1top if needed.',
                       '连接未能启动。请检查 HTTPS 地址，必要时重新启动 1top。'),
    'restart_elsewhere': ('다른 곳에서 시작한 수집기는 여기서 다시 시작할 수 없습니다.',
                          'A collector started elsewhere cannot be restarted here.', '在别处启动的采集器无法在此重启。'),
    'restart_started': ('로컬 수집기를 다시 시작했습니다.', 'The local collector restarted.', '本地采集器已重启。'),
    'restart_failed': ('로컬 수집기를 시작하지 못했습니다. 앱을 다시 열어 주세요.',
                       'The local collector could not start. Reopen the app.', '无法启动本地采集器。请重新打开应用。'),
    'login_store': ('Windows 설정 › 앱 › 시작 프로그램에서 1top을 켜거나 끌 수 있습니다.',
                    'Turn 1top on or off in Windows Settings › Apps › Startup.',
                    '可在 Windows 设置 › 应用 › 启动 中开启或关闭 1top。'),
    'login_failed': ('로그인할 때 실행 설정을 저장하지 못했습니다.', 'Could not save the open-at-login setting.',
                     '无法保存登录时启动的设置。'),
}


def text(key, lang='ko', **values):
    row = TEXT[key]
    value = row[LANGUAGES.index(lang)] if lang in LANGUAGES else row[0]
    return value.format(**values) if values else value


def _path():
    from .platform_support import data_directory
    return data_directory() / 'desktop-ui.json'


def load_preferences(path=None):
    """The dashboard's last language and theme; Korean and dark like the dashboard's own defaults."""
    try:
        value = json.loads((path or _path()).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        value = {}
    lang = value.get('lang') if isinstance(value, dict) else None
    theme = value.get('theme') if isinstance(value, dict) else None
    return {'lang': lang if lang in LANGUAGES else 'ko', 'theme': theme if theme in ('dark', 'light') else 'dark'}


def save_preferences(lang, theme, path=None):
    if lang not in LANGUAGES or theme not in ('dark', 'light'):
        return False
    target = path or _path()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps({'lang': lang, 'theme': theme}), encoding='utf-8')
        return True
    except OSError:
        return False
