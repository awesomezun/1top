"""Read source facts into session-capture.v1. No conversation identity decisions."""
import platform
import time
from pathlib import Path
from . import processes, claude_registry, transcripts, orca, codex, aside, tmux, antigravity, openbot, openmausbot, devin
from ..discovery import claude_transcript


class Observer:
    def __init__(self, home=None):
        self.home = home or Path.home()
        self.processes = processes.Reader()
        self.transcripts = transcripts.Reader()
        self.paths = {}
        self.run = None
        self.agents_at = 0
        self.ledger_at = 0
        self.apps_at = 0

    def refresh(self, record):
        """Cheap event/registry refresh between topology scans; immutable records."""
        now = time.time()
        regs = claude_registry.read_all(record['processes'])
        observed = {}
        for p in record['processes']:
            reg = regs.get(str(p['pid']), {})
            sid = reg.get('sessionId')
            if not sid:
                continue
            key = (p['config_dir'], sid)
            path = self.paths.get(key)
            if not path or not Path(path).exists():
                path = claude_transcript(*key)
            if path:
                self.paths[key] = path
            name = key[0]+':'+sid
            if name not in observed:
                observed[name] = self.transcripts.claude(path, now)
        self.paths = {k:v for k,v in self.paths.items() if k[0]+':'+k[1] in observed}
        logs = [{**log, **(self.transcripts.read(log.get('path')) or {'events':[]})} for log in record.get('codex_logs', [])]
        running = any(p.get('name') == 'aside-daemon' for p in record['processes'])
        seats = record.get('orca_agents')
        if self.run and now - self.agents_at >= 5:
            seats, self.agents_at = orca.agents(self.run), now
        # T5: OpenMausBot's turns from its own usage ledger (its Claude runs keep no transcript).
        bots = record.get('openmausbot_threads')
        if bots is None or now - self.ledger_at >= 5:
            bots, self.ledger_at = openmausbot.read(self.home, now), now
        # T5: Devin sessions and the ACP runtime's Antigravity conversations, from their own databases.
        found = {k: record.get(k) for k in ('devin_sessions', 'antigravity_conversations')}
        if None in found.values() or now - self.apps_at >= 5:
            found, self.apps_at = {'devin_sessions': devin.read(self.home, now),
                                   'antigravity_conversations': antigravity.conversations(self.home, now)}, now
        result = {**record, **found, 'captured_at': now, 'orca_agents': seats,
                  'antigravity_sessions': antigravity.refresh(record.get('antigravity_sessions', [])), 'claude_registry':regs, 'claude_transcripts':observed,
                  'codex_logs':logs, 'aside_sessions':aside.read(self.home, now, running), 'openmausbot_threads': bots}
        self.transcripts.prune()
        return result

    def read(self, run):
        procs = self.processes.read()
        self.run, self.agents_at = run, 0
        record = {'schema':'onetop.session-capture.v1', 'captured_at':time.time(), 'platform':platform.system(),
            'processes':procs, 'orca_terminals':orca.read(run), 'antigravity_sessions':antigravity.read(procs, run),
            'openbot_agents':openbot.read(self.home, procs), 'tmux_panes':tmux.read(run),
            'openmausbot_running':any('/OpenMausBot.app/Contents/MacOS/' in str(p.get('exe') or '') for p in procs),
            'openbot_running':openbot.running(procs), 'devin_running':any(p.get('name') == 'devin' for p in procs),
            'codex_logs':codex.read(procs, self.transcripts, run, platform.system())}
        return self.refresh(record)
