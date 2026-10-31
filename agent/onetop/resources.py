"""Host sampling and conservative process-tree attribution. No command-line text."""
import collections
import os
import platform
import time
from pathlib import Path
import psutil


def counter_rate(current,previous,seconds):
    if previous is None or seconds<=0 or current<previous:return None
    return (current-previous)/seconds


def owner_of(pid,parents,roots):
    seen=set()
    while pid and pid not in seen:
        if pid in roots:return roots[pid]
        seen.add(pid);pid=parents.get(pid)
    return None


def attribute(rows,session_roots,shared_roots):
    """Nearest root owns a process; shared backends override session ownership."""
    roots={pid:sid for sid,pids in session_roots.items() for pid in pids}
    roots.update({pid:f'backend:{pid}' for pid in shared_roots})
    parents={pid:r['ppid'] for pid,r in rows.items()}
    groups={}
    for pid,row in rows.items():
        owner=owner_of(pid,parents,roots)
        if owner is None:continue
        group=groups.setdefault(owner,{'cpu':0.0,'rss':0,'count':0,'pids':[],'cpu_known':False})
        group['rss']+=row['rss'];group['count']+=1;group['pids'].append(pid)
        if row['cpu'] is not None:group['cpu']+=row['cpu'];group['cpu_known']=True
        row['owner']=owner
    for group in groups.values():
        group['cpu']=round(min(100,group['cpu']),1) if group.pop('cpu_known') else None
    return groups


class ResourceSampler:
    def __init__(self):
        self.previous={};self.last=None;self.io_previous={};self.history=collections.deque(maxlen=300)
        self.cores=psutil.cpu_count() or 1
        self.cpu_previous=None

    def sample(self,sessions,shared_roots):
        before=time.monotonic();now=time.time();dt=before-self.last if self.last is not None else 0
        rows={};current={};denied=0
        for p in psutil.process_iter(['pid','ppid','name','create_time','cpu_times','memory_info'],ad_value=None):
            info=p.info;ct=info.get('cpu_times');mem=info.get('memory_info')
            if ct is None or mem is None:denied+=1;continue
            pid=info['pid'];identity=(pid,info['create_time']);ticks=ct.user+ct.system
            previous=self.previous.get(identity);rate=counter_rate(ticks,previous,dt)
            rows[pid]={'pid':pid,'ppid':info['ppid'],'name':info['name'] or 'unknown','created':info['create_time'],
                       # Match the host chart: all logical CPUs together are 100%.
                       # Keep two decimals until grouping so small processes still add up.
                       'cpu':round(min(100,rate*100/self.cores),2) if rate is not None else None,'rss':mem.rss}
            current[identity]=ticks
        self.previous=current;self.last=before
        roots={s['id']:s['pids'] for s in sessions if s.get('process_started') and len(s['pids'])==1}
        # A reused PID must never inherit resource ownership from a stale discovery.
        for sid,pids in list(roots.items()):
            spec=next(s for s in sessions if s['id']==sid)
            row=rows.get(pids[0])
            try:started=time.mktime(time.strptime(spec['process_started'],'%a %b %d %H:%M:%S %Y'))
            except (ValueError,TypeError):started=0
            birth=spec.get('process_birth')
            valid=row and (row['created']==birth if birth is not None else abs((row.get('created') or 0)-started)<1.1)
            if not valid:roots.pop(sid)
        groups=attribute(rows,roots,shared_roots)
        for s in sessions:s['resources']=groups.get(s['id'])
        shared=[{'id':f'backend:{pid}','pid':pid,'name':rows.get(pid,{}).get('name','Codex'),
                 **groups[f'backend:{pid}']} for pid in shared_roots if f'backend:{pid}' in groups]
        cpu=psutil.cpu_times();values=cpu._asdict();total=sum(values.values());idle=values.get('idle',0)
        host_cpu=None
        if self.cpu_previous:
            delta=total-self.cpu_previous[0]
            if delta>0:host_cpu=round(max(0,min(100,100*(1-(idle-self.cpu_previous[1])/delta))),1)
        self.cpu_previous=(total,idle)
        memory=psutil.virtual_memory();swap=psutil.swap_memory()
        disk_path='/System/Volumes/Data' if Path('/System/Volumes/Data').exists() else Path.home().anchor
        disk=psutil.disk_usage(disk_path);diskio=psutil.disk_io_counters()
        interfaces=psutil.net_io_counters(pernic=True);stats=psutil.net_if_stats()
        net={}
        # en* is physical Ethernet/Wi-Fi on this Mac; omit VPN/bridge/loopback double counting.
        for name,value in interfaces.items():
            if (name.startswith('en') if platform.system()=='Darwin' else not any(x in name.lower() for x in ('loopback','vethernet','vpn','tunnel'))) and stats.get(name) and stats[name].isup:
                prev=self.io_previous.get(name)
                net[name]={'rx':counter_rate(value.bytes_recv,prev[0] if prev else None,dt),
                           'tx':counter_rate(value.bytes_sent,prev[1] if prev else None,dt)}
            self.io_previous[name]=(value.bytes_recv,value.bytes_sent)
        old_disk=self.io_previous.get('disk')
        io={'read':counter_rate(diskio.read_bytes,old_disk[0] if old_disk else None,dt),
            'write':counter_rate(diskio.write_bytes,old_disk[1] if old_disk else None,dt)} if diskio else {'read':None,'write':None}
        if diskio:self.io_previous['disk']=(diskio.read_bytes,diskio.write_bytes)
        network={'interfaces':list(net),'rx':sum(v['rx'] or 0 for v in net.values()) if dt and net else None,
                 'tx':sum(v['tx'] or 0 for v in net.values()) if dt and net else None}
        battery=psutil.sensors_battery()
        host={'cpu':host_cpu,'cores':self.cores,'load':list(os.getloadavg()) if hasattr(os,'getloadavg') else [],
              'memory':{'total':memory.total,'available':memory.available,'used':memory.total-memory.available,'percent':memory.percent},
              'swap':{'used':swap.used,'total':swap.total},
              'disk':{'path':disk_path,'total':disk.total,'free':disk.free,'percent':disk.percent,**io},
              'network':network,'battery':{'percent':battery.percent,'plugged':battery.power_plugged} if battery else None,
              'uptime':now-psutil.boot_time(),'process_count':len(rows),'unreadable_processes':denied,
              'platform':platform.machine(),'os':platform.system(),'gpu':None,'gpu_note':'GPU·온도 센서는 수집하지 않습니다.'}
        self.history.append({'t':now,'cpu':host_cpu,'memory':memory.percent,'rx':network['rx'],'tx':network['tx']})
        top=sorted(rows.values(),key=lambda r:(r['cpu'] or 0,r['rss']),reverse=True)[:15]
        monitor=rows.get(os.getpid(),{})
        return {'cpu_basis':'host_total','host':host,'shared':shared,'top':top,'history':list(self.history),
                'sampler_ms':round((time.monotonic()-before)*1000,1),
                'monitor':{k:monitor.get(k) for k in ('pid','cpu','rss')}}
