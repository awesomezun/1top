"""Windows package identity and writable WebView storage, without WinRT dependencies."""
import ctypes
import json
import os
from pathlib import Path
import subprocess
import sys

STORE_UPDATES = 'ms-windows-store://downloadsandupdates'


def desktop_size():
    from ctypes import wintypes
    work = wintypes.RECT()
    if ctypes.windll.user32.SystemParametersInfoW(48, 0, ctypes.byref(work), 0):
        return min(1400, max(800, work.right - work.left - 48)), min(900, max(540, work.bottom - work.top - 48))
    return 1200, 800


# The quick view at 100%, like the macOS menu bar panel: 440 × 800, never taller than the work area.
QUICK_SIZE = (440, 800)
QUICK_GAP = 8


def quick_frame(cursor, work, screen, scale=1.0, zoom=1.0):
    """Where the quick view opens: next to the notification area, on the taskbar's side.

    Everything is in physical pixels: the cursor, and the work area and full bounds (left, top,
    right, bottom) of the monitor the tray was clicked on. Returns x, y, width, height.
    """
    scale = scale if scale and scale > 0 else 1.0
    left, top, right, bottom = work
    s_left, s_top, s_right, s_bottom = screen
    x, y = cursor
    gap = QUICK_GAP * scale
    width = min(round(QUICK_SIZE[0] * scale * zoom), int(right - left - 2 * gap))
    height = min(round(QUICK_SIZE[1] * scale * zoom), int(bottom - top - 2 * gap))
    # The taskbar sits on the side where the work area is shorter than the monitor; an
    # auto-hidden taskbar leaves no gap, and Windows puts it at the bottom by default.
    gaps = {'bottom': s_bottom - bottom, 'top': top - s_top, 'left': left - s_left, 'right': s_right - right}
    edge = max(gaps, key=gaps.get) if any(v > 0 for v in gaps.values()) else 'bottom'
    if edge in ('bottom', 'top'):
        px = x - width / 2
        py = bottom - height - gap if edge == 'bottom' else top + gap
    else:
        px = left + gap if edge == 'left' else right - width - gap
        py = y - height / 2
    px = min(max(px, left + gap), right - width - gap)
    py = min(max(py, top + gap), bottom - height - gap)
    return int(round(px)), int(round(py)), int(width), int(height)


def window_handle(window):
    native = getattr(window, 'native', None)
    handle = getattr(native, 'Handle', None)
    return int(handle.ToInt64()) if handle is not None else None


def place_panel(hwnd, frame):
    """Topmost, outside the taskbar and Alt+Tab like a tray panel, at a physical-pixel frame."""
    user32 = ctypes.windll.user32
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
    style = user32.GetWindowLongPtrW(ctypes.c_void_p(hwnd), -20)  # GWL_EXSTYLE
    user32.SetWindowLongPtrW(ctypes.c_void_p(hwnd), -20, (style | 0x80) & ~0x40000)  # +TOOLWINDOW −APPWINDOW
    x, y, width, height = frame
    user32.SetWindowPos(ctypes.c_void_p(hwnd), ctypes.c_void_p(-1), x, y, width, height, 0x0010 | 0x0020)  # TOPMOST, NOACTIVATE|FRAMECHANGED


def bring_forward(hwnd):
    ctypes.windll.user32.SetForegroundWindow(ctypes.c_void_p(hwnd))


def cursor_position():
    from ctypes import wintypes
    point = wintypes.POINT()
    ctypes.windll.user32.GetCursorPos(ctypes.byref(point))
    return point.x, point.y


def monitor_areas(point):
    """Work area and full bounds of the monitor under a physical point."""
    from ctypes import wintypes

    class MonitorInfo(ctypes.Structure):
        _fields_ = [('cbSize', wintypes.DWORD), ('rcMonitor', wintypes.RECT),
                    ('rcWork', wintypes.RECT), ('dwFlags', wintypes.DWORD)]
    user32 = ctypes.windll.user32
    user32.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
    user32.MonitorFromPoint.restype = wintypes.HMONITOR
    user32.GetMonitorInfoW.argtypes = [wintypes.HMONITOR, ctypes.POINTER(MonitorInfo)]
    user32.GetMonitorInfoW.restype = wintypes.BOOL
    monitor = user32.MonitorFromPoint(wintypes.POINT(*point), 2)  # MONITOR_DEFAULTTONEAREST
    info = MonitorInfo()
    info.cbSize = ctypes.sizeof(MonitorInfo)
    if not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
        width, height = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        return (0, 0, width, height), (0, 0, width, height)
    rect = lambda r: (r.left, r.top, r.right, r.bottom)
    return rect(info.rcWork), rect(info.rcMonitor)


def scale_factor(point=None):
    # Resolve the clicked monitor, rather than always using the primary monitor.
    try:
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        user32.MonitorFromPoint.argtypes = [wintypes.POINT, wintypes.DWORD]
        user32.MonitorFromPoint.restype = wintypes.HMONITOR
        monitor = user32.MonitorFromPoint(wintypes.POINT(*(point or cursor_position())), 2)
        get_dpi = ctypes.windll.shcore.GetDpiForMonitor
        get_dpi.argtypes = [wintypes.HMONITOR, ctypes.c_int, ctypes.POINTER(wintypes.UINT), ctypes.POINTER(wintypes.UINT)]
        get_dpi.restype = ctypes.c_long
        x, y = wintypes.UINT(), wintypes.UINT()
        if get_dpi(monitor, 0, ctypes.byref(x), ctypes.byref(y)) == 0 and x.value:
            return x.value / 96
    except (AttributeError, OSError):
        pass
    try:
        return ctypes.windll.shcore.GetScaleFactorForDevice(0) / 100
    except (AttributeError, OSError):
        return 1.0


RUN_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
RUN_VALUE = '1top'


def login_command():
    # Opening at login shows the quick view, like the macOS login item.
    return f'"{sys.executable}" --quick-view'


def opens_at_login():
    if sys.platform != 'win32' or package_identity():
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as key:
            return bool(winreg.QueryValueEx(key, RUN_VALUE)[0])
    except OSError:
        return False


def set_open_at_login(enabled):
    """Per-user Run entry for the installer build. Store builds are managed in Windows Settings."""
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, RUN_VALUE, 0, winreg.REG_SZ, login_command())
        else:
            try:
                winreg.DeleteValue(key, RUN_VALUE)
            except FileNotFoundError:
                pass


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


def ensure_webview_runtime(lang='ko'):
    from .windows_text import text
    if webview_runtime_version():
        return True
    installer = Path(sys.executable).parent / 'MicrosoftEdgeWebview2Setup.exe'
    if not installer.is_file():
        return False
    # The build checks this bundled Microsoft's Authenticode signature. The
    # MSIX signature protects it on disk. Run as the current user, never elevate.
    answer = ctypes.windll.user32.MessageBoxW(None, text('webview_setup', lang), text('webview_setup_title', lang), 0x24)
    if answer != 6:
        return False
    try:
        subprocess.run([str(installer), '/silent', '/install'], timeout=240, check=True,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.SubprocessError):
        return False
    return bool(webview_runtime_version())
