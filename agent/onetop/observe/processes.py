"""Process facts and argv roles. The only owner of CLI execution-shape rules."""
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
import psutil
from ..platform_support import owned_process, process_terminal
from .. import _rust_bridge

CLI_NAMES = {'claude':'Claude','codex':'Codex','gemini':'Gemini','opencode':'OpenCode',
    'aider':'Aider','goose':'Goose','agy':'Antigravity','qwen':'Qwen Code',
    'copilot':'GitHub Copilot','droid':'Droid','amp':'Amp'}
PACKAGES = {'@anthropic-ai/claude-code':'Claude','@openai/codex':'Codex',
    '@google/gemini-cli':'Gemini','@github/copilot':'GitHub Copilot',
    '@qwen-code/qwen-code':'Qwen Code','opencode-ai':'OpenCode'}
ERRORS = (psutil.Error, OSError, SystemError, AttributeError)
SID = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}$')


def _py_cli_kind(name, args, exe=''):
    name = str(name).replace('\\', '/').rsplit('/', 1)[-1].lower().removesuffix('.exe')
    if name in CLI_NAMES:
        return CLI_NAMES[name]
    if name.startswith('agy_acp_server'):
        return 'Antigravity'  # Orca's chat runtime for Antigravity
    if name in ('claude bg-spare', 'claude bg-pty-host') or name.startswith('<claude '):
        return 'Claude'
    if re.search(r'(?:^|/)claude/versions/\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\.exe)?$', str(exe).replace('\\', '/')):
        return 'Claude'
    if name in ('node', 'nodejs') or name.startswith('python'):
        entry = str(args[1]).replace('\\', '/') if len(args) > 1 else ''
        for package, kind in PACKAGES.items():
            if '/node_modules/' + package + '/' in entry:
                return kind
        if name.startswith('python') and list(args[1:3]) == ['-m', 'aider']:
            return 'Aider'
    return None


def cli_kind(name, args, exe=''):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_cli_kind(name, args, exe)
    s_args = [str(a) for a in (args or ())]
    if m == 'new':
        return _rust_bridge.native.proc_cli_kind(str(name), s_args, str(exe or ''))
    return _rust_bridge.shadow_check('processes.cli_kind', _py_cli_kind(name, args, exe),
                                     _rust_bridge.native.proc_cli_kind(str(name), s_args, str(exe or '')))


def _py_explicit_session(args):
    for i, value in enumerate(args):
        if value in ('--resume', '--session-id', 'resume') and i + 1 < len(args) and SID.fullmatch(args[i+1]):
            return args[i+1]
        if value.startswith('--session-id=') and SID.fullmatch(value.split('=', 1)[1]):
            return value.split('=', 1)[1]
    return None


def explicit_session(args):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_explicit_session(args)
    s_args = [str(a) for a in (args or ())]
    if m == 'new':
        return _rust_bridge.native.proc_explicit_session(s_args)
    return _rust_bridge.shadow_check('processes.explicit_session', _py_explicit_session(args),
                                     _rust_bridge.native.proc_explicit_session(s_args))


CLAUDE_FLAGS = set('''--dangerously-skip-permissions --allow-dangerously-skip-permissions --resume --continue
    --session-id --fork-session --allowed-tools --allowedTools --disallowed-tools --disallowedTools
    --permission-mode --model --effort --plugin-dir --add-dir --mcp-config --strict-mcp-config
    --system-prompt --append-system-prompt --settings --setting-sources --agents --agent --debug
    --debug-file --verbose --output-format --input-format --print -p -c -r --include-partial-messages
    --max-turns --max-budget-usd --tools --betas --ide --no-session-persistence --permission-prompt-tool
    --replay-user-messages --worktree -w --remote --teleport --from-pr --chrome --no-chrome'''.split())


def describe(row):
    args = row.get('argv') or []
    first = args[0] if args else row.get('name', '')
    kind = row.get('kind') or cli_kind(first, args, row.get('exe', first))
    if '--type' in args or '--monitor-self' in args or '--handshake-fd' in args:
        return {'kind': None, 'role': 'helper'}  # Electron helpers, not CLI sessions
    if row.get('own_probe'):
        # 1top's own quota reads (agy /usage every two minutes) run under the collector; no one's session.
        return {'kind': kind, 'role': 'helper', 'explicit_session': None}
    env = row.get('env') or {}
    # T4: a seat Orca runs without a terminal.
    chat = env.get('ORCA_STRUCTURED_SESSION') == '1' and bool(env.get('ORCA_AGENT_SESSION_ID'))
    # T5: an app drives Claude over stdin (Agent SDK stream-json) without a terminal of its own.
    if kind in ('Claude', 'GLM') and row.get('tty') in ('', '?', '??', None) \
            and any(str(a).split('=', 1)[0] == '--input-format' for a in args[1:]):
        chat = True
    role = 'chat' if chat else 'interactive'
    if kind and '/.openmausbot/' in str(row.get('cwd') or '').replace('\\', '/'):
        # T5: OpenMausBot's task runs are counted from its own usage ledger, never from a transcript as well.
        return {'kind': kind, 'role': 'helper', 'explicit_session': None}
    if kind in ('Claude', 'GLM'):
        # Native Claude embeds search applets in the same executable. They carry
        # argv[0]=bfs/rg/ugrep (ugrep from Claude Code 2.1.3xx), although the OS reports
        # claude/versions/<version>.
        if str(first).rsplit('/', 1)[-1] in ('bfs', 'rg', 'ripgrep', 'ugrep', 'ug'):
            return {'kind':kind, 'role':'helper'}
        # The PTY host also carries its child's --bg-spare args: host wins.
        # The Claude in Chrome extension's native messaging host is no conversation either.
        if '--bg-pty-host' in args or first == 'claude bg-pty-host' or args[1:3] == ['daemon', 'run'] or '--chrome-native-host' in args:
            role = 'helper'
        elif '--bg-spare' in args or first == 'claude bg-spare':
            role = 'background'
        elif '--no-session-persistence' in args and row.get('tty') in ('', '?', '??', None) \
                and not env.get('ORCA_STRUCTURED_SESSION'):
            # T5: an app's probe or one-shot run keeps no conversation to show; a host app with a
            # usage ledger (OpenMausBot) reports its tokens itself.
            role = 'helper'
        elif chat:
            pass
        elif any(a.startswith('-') and a.split('=', 1)[0] not in CLAUDE_FLAGS for a in args[1:]):
            role = 'shape_unknown'
        provider = row.get('provider', '')
        if provider in ('api.z.ai', 'open.bigmodel.cn') or row.get('configured_model', '').lower().startswith('glm'):
            kind = 'GLM'
    elif kind == 'Codex' and ('app-server' in args and not chat or 'exec-server' in args):
        role = 'helper'  # shared backends and the cloud-environment relay hold no conversation of their own
    return {'kind': kind, 'role': role, 'explicit_session': row.get('explicit_session') or explicit_session(args)}


def _py_argv_shape(args):
    if not args:
        return []
    first = str(args[0]).replace('\\', '/')
    result = ['<claude ' + first.rsplit('/', 1)[-1] + '>' if '/claude/versions/' in first else first.rsplit('/', 1)[-1]]
    for value in args[1:]:
        if value.startswith('-'):
            result.append(value.split('=', 1)[0])
        elif SID.fullmatch(value) or value.isdigit() or value in ('run', 'daemon', 'resume', 'exec', 'app-server', 'exec-server'):
            result.append(value)
        elif value.endswith('.jsonl'):
            result.append('<transcript:' + Path(value).stem + '>')
        else:
            result.append('<path>' if value.startswith('/') else '<json>' if value.startswith('{') else '<arg>')
    return result


def argv_shape(args):
    m = _rust_bridge.mode()
    if m == 'old':
        return _py_argv_shape(args)
    s_args = [str(a) for a in (args or ())]
    if m == 'new':
        return _rust_bridge.native.proc_argv_shape(s_args)
    return _rust_bridge.shadow_check('processes.argv_shape', _py_argv_shape(args),
                                     _rust_bridge.native.proc_argv_shape(s_args))


class Reader:
    def __init__(self):
        self.cache = {}

    def read(self):
        from ..discovery import app_from
        rows, kept = [], {}
        # No attrs on the generator: proc_cmdline may raise SystemError before
        # a caller's per-PID guard. Expensive immutable facts are read once/birth.
        for proc in psutil.process_iter():
            try:
                base = proc.as_dict(attrs=['pid', 'ppid', 'name', 'create_time'])
                pid, birth = proc.pid, base['create_time']
                key = (pid, birth)
                static = self.cache.get(key)
                if static and static.get('_name') != base.get('name'):
                    static = None  # exec can change the program without changing PID/birth
                if static is None:
                    if not owned_process(proc):
                        kept[key] = {'skip': True}; continue
                    exe = proc.exe()
                    name = base.get('name') or ''
                    kind = cli_kind(name, [], exe)
                    candidate = kind or name.lower().removesuffix('.exe') in ('node', 'nodejs') or name.startswith('python')
                    args = proc.cmdline() if candidate else []
                    kind = cli_kind(name, args, exe)
                    try:
                        env = proc.environ() if kind else {}
                    except ERRORS:
                        env = {}
                    profile = env.get('CODEX_HOME' if kind == 'Codex' else 'CLAUDE_CONFIG_DIR')
                    safe = {k: env[k] for k in ('ORCA_TERMINAL_HANDLE', 'ORCA_TAB_ID', 'TMUX_PANE', 'ORCA_AGENT_SESSION_ID', 'ORCA_STRUCTURED_SESSION') if env.get(k)}
                    static = {'_name':base.get('name'), 'exe': exe, 'argv': argv_shape(args), 'kind': kind,
                        'config_dir': profile or str(Path.home()/('.codex' if kind == 'Codex' else '.claude')),
                        'env': safe, 'provider': urlsplit(env.get('ANTHROPIC_BASE_URL', '')).hostname or '',
                        'configured_model': env.get('ANTHROPIC_MODEL') or env.get('ANTHROPIC_DEFAULT_OPUS_MODEL', ''),
                        'explicit_session': explicit_session(args), 'app': app_from(exe, name)}
                    del env
                    static.update(describe({**static, 'argv': args}))
                kept[key] = static
                if static.get('skip'):
                    continue
                cwd, tty = '', ''
                if static.get('kind'):
                    try:
                        cwd, tty = proc.cwd(), process_terminal(proc)
                    except ERRORS:
                        pass
                rows.append({**static, 'pid': pid, 'ppid': base['ppid'], 'name': base.get('name') or '',
                    'birth': birth, 'started': time.strftime('%a %b %d %H:%M:%S %Y', time.localtime(birth)),
                    'cwd': cwd, 'tty': tty, 'ai': bool(static.get('kind'))})
            except ERRORS:
                continue
        self.cache = kept
        mark_own_probes(rows, os.getpid())
        return rows


def mark_own_probes(rows, own):
    """An AI CLI the collector itself started (a quota read) is a helper, never a session row."""
    parents = {r['pid']: r.get('ppid') for r in rows}
    for row in rows:
        if not row.get('kind'):
            continue
        parent, seen = row.get('ppid'), set()
        while parent and parent not in seen:
            if parent == own:
                row.update(own_probe=True, role='helper')
                break
            seen.add(parent); parent = parents.get(parent)
    return rows
