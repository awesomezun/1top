"""Explicit remote payloads: bounded metrics, no paths or credential material."""
import copy
import hashlib
import math
from .fleet_usage import STOPS, PRESETS
from .time_ranges import extend_snapshot

CALIBRATION = ('pp_per_token', 'confidence', 'from', 'to', 'valid_until', 'source', 'seconds', 'used_pp', 'tokens')

def select(value, keys):
    return {k: value.get(k) for k in keys} if isinstance(value, dict) else {}

def period_metrics(window):
    result = select(window, ('key','label','tokens','partial','observed_seconds','seconds'))
    # Preserve absence for collectors that predate model attribution. Empty is
    # a known zero, not permission to reconstruct models from live sessions.
    if isinstance(window.get('by_model'), list):
        result['by_model'] = [select(row, ('kind','model','tokens','session_count'))
                              for row in window['by_model']]
    return result

def all_periods(db, state):
    """Same transaction and account attribution rules as the local time slider."""
    result = copy.deepcopy(state)
    result['remote_flows'] = {}
    # Skip heavy resources/history when making each per-period working copy.
    base = {k: state[k] for k in ('ready', 'updated', 'started', 'history_started',
            'period_usage', 'weekly_usage', 'sessions') if k in state}
    by_id = {s['id']: s for s in result['sessions']}
    accounts = {a['id']: a for a in result.get('weekly_usage', {}).get('accounts', [])}
    for key in [f'custom:{n}' for n in STOPS if n not in PRESETS] + ['all']:
        extended = extend_snapshot(db, base, key)
        result['period_usage']['windows'].append(extended['period_usage']['windows'][-1])
        for session in extended['sessions']:
            usage = by_id[session['id']].setdefault('usage', {})
            for field in ('windows', 'weekly_estimate'):
                if key in session.get('usage', {}).get(field, {}):
                    usage.setdefault(field, {})[key] = session['usage'][field][key]
        for account in extended.get('weekly_usage', {}).get('accounts', []):
            accounts[account['id']].setdefault('periods', {})[key] = account['periods'][key]
        chart = extended['chart_range']
        count = math.ceil((chart['end'] - chart['start']) / chart['step'])
        bins = [{} for _ in range(count)]
        for e in extended['events']:
            slot = min(count - 1, int((e['t'] - chart['start']) // chart['step']))
            kind = e['kind']
            bins[slot][kind] = bins[slot].get(kind, 0) + sum(e[k] for k in ('fresh','cached','written','output'))
        result['remote_flows'][key] = {**chart, 'as_of': state['updated'], 'reported': True, 'bins': bins}
    return result

def host_metrics(host):
    return {**select(host, ('load','uptime','process_count','unreadable_processes','platform','os')),
        'network': select(host.get('network'), ('rx','tx','interfaces')),
        'disk': select(host.get('disk'), ('total','free','percent','read','write')),
        'swap': select(host.get('swap'), ('used','total')),
        'battery': select(host.get('battery'), ('percent','plugged')) or None}

def system_metrics(system, session_ids=()):
    owners = set(session_ids)
    owners.update(r['id'] for r in system.get('shared', [])[:30]
        if isinstance(r.get('pid'), int) and not isinstance(r['pid'], bool)
        and 0 < r['pid'] <= 2**32 and r.get('id') == f"backend:{r['pid']}")
    return {'cpu_basis': system.get('cpu_basis') if system.get('cpu_basis') in ('host_total','single_core') else None,
        'sampler_ms': system.get('sampler_ms'),
        'monitor': select(system.get('monitor'), ('pid','cpu','rss')),
        'history': [select(r, ('t','cpu','memory','rx','tx')) for r in system.get('history', [])[-300:]],
        'top': [{**select(r, ('pid','ppid','name','created','cpu','rss')),
                 'owner': r.get('owner') if isinstance(r.get('owner'), str) and r['owner'] in owners else None}
                for r in system.get('top', [])[:15]],
        'shared': [select(r, ('id','pid','name','cpu','rss','count','pids')) for r in system.get('shared', [])[:30]]}

def public_history(data):
    """Retain grouping identity without uploading a local project directory."""
    series = data.get('series') or {}
    projects = []
    for row in series.get('by_project', [])[:13]:
        key = row.get('key', 'unknown')
        public_key = key if key in ('unknown', '__other__') else 'project:' + hashlib.sha256(key.encode()).hexdigest()
        projects.append({**select(row, ('label','tokens','folded')), 'key': public_key})
    return {'as_of': data.get('as_of'), 'coverage': [select(r, ('source','kind','from','to')) for r in data.get('coverage', [])],
        'series': {**select(series, ('start','end','step','bins','total')),
            'by_model': [select(r, ('key','kind','tokens','folded')) for r in series.get('by_model', [])[:13]],
            'by_project': projects},
        'heatmap': select(data.get('heatmap'), ('hours','days'))}
