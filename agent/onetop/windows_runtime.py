"""Windows package identity and writable WebView storage, without WinRT dependencies."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys

STORE_UPDATES = 'ms-windows-store://downloadsandupdates'


def package_identity():
    if sys.platform != 'win32':
        return None
    length = ctypes.c_uint32(0)
    get_name = ctypes.windll.kernel32.GetCurrentPackageFullName
    get_name.argtypes = [ctypes.POINTER(ctypes.c_uint32), ctypes.c_wchar_p]
    get_name.restype = ctypes.c_long
    if get_name(ctypes.byref(length), None) != 122:  # ERROR_INSUFFICIENT_BUFFER
        return None
    buffer = ctypes.create_unicode_buffer(length.value)
    return buffer.value if get_name(ctypes.byref(length), buffer) == 0 else None


def package_metadata():
    if not package_identity() or not getattr(sys, 'frozen', False):
        return {}
    try:
        value = json.loads((Path(sys.executable).parent / 'distribution.json').read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def configure_test_activation():
    # Store builds cannot activate this fixture loader. Packaged activation is
    # brokered by Windows, so a test cannot rely on inheriting the CI environment.
    if '--smoke-config' not in sys.argv or package_metadata().get('channel') != 'test':
        return
    path = Path(sys.argv[sys.argv.index('--smoke-config') + 1])
    values = json.loads(path.read_text(encoding='utf-8'))
    allowed = {'ONETOP_DATA', 'ONETOP_PORT', 'ONETOP_SMOKE_REPORT', 'CLAUDE_CONFIG_DIR',
               'FIXTURE_SESSION', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
               'no_proxy', 'ONETOP_SMOKE_STORAGE_EXPECT', 'ONETOP_SMOKE_STORAGE_WRITE',
               'ONETOP_SMOKE_MIGRATION_EXPECT'}
    if not isinstance(values, dict) or not set(values) <= allowed or not all(isinstance(v, str) for v in values.values()):
        raise ValueError('Invalid packaged test configuration')
    os.environ.update(values)


def webview_storage():
    from .platform_support import data_directory
    path = data_directory() / 'webview'
    path.mkdir(parents=True, exist_ok=True)
    return path


def webview_runtime_version():
    if sys.platform != 'win32':
        return None
    import winreg
    key = r'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for view in (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
            try:
                with winreg.OpenKey(hive, key, 0, winreg.KEY_READ | view) as handle:
                    version = winreg.QueryValueEx(handle, 'pv')[0]
                    if isinstance(version, str) and version and version != '0.0.0.0':
                        return version
            except OSError:
                pass
    return None


def ensure_webview_runtime():
    if webview_runtime_version():
        return True
    installer = Path(sys.executable).parent / 'MicrosoftEdgeWebview2Setup.exe'
    if not installer.is_file():
        return False
    # The build checks this bundled Microsoft's Authenticode signature. The
    # MSIX signature protects it on disk. Run as the current user, never elevate.
    answer = ctypes.windll.user32.MessageBoxW(None,
        '1top needs Microsoft Edge WebView2 Runtime to display the dashboard.\n\n'
        'Install it now? This downloads the runtime from Microsoft and may take a few minutes.',
        '1top — WebView2 setup', 0x24)
    if answer != 6:
        return False
    try:
        subprocess.run([str(installer), '/silent', '/install'], timeout=240, check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.SubprocessError):
        return False
    return bool(webview_runtime_version())
