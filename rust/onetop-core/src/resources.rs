use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProcRow {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub created: f64,
    pub cpu: Option<f64>,
    pub rss: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResourceGroup {
    pub cpu: Option<f64>,
    pub rss: u64,
    pub count: usize,
    pub pids: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub t: f64,
    pub cpu: Option<f64>,
    pub memory: f64,
    pub rx: Option<f64>,
    pub tx: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total: u64,
    pub available: u64,
    pub used: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SwapStats {
    pub used: u64,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiskStats {
    pub path: String,
    pub total: u64,
    pub free: u64,
    pub percent: f64,
    pub read: Option<f64>,
    pub write: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NetworkStats {
    pub interfaces: Vec<String>,
    pub rx: Option<f64>,
    pub tx: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BatteryStats {
    pub percent: f64,
    pub plugged: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostStats {
    pub cpu: Option<f64>,
    pub cores: usize,
    pub load: Vec<f64>,
    pub memory: MemoryStats,
    pub swap: SwapStats,
    pub disk: DiskStats,
    pub network: NetworkStats,
    pub battery: Option<BatteryStats>,
    pub uptime: f64,
    pub process_count: usize,
    pub unreadable_processes: usize,
    pub platform: String,
    pub os: String,
    pub gpu: Option<serde_json::Value>,
    pub gpu_note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SharedBackendStats {
    pub id: String,
    pub pid: u32,
    pub name: String,
    pub cpu: Option<f64>,
    pub rss: u64,
    pub count: usize,
    pub pids: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitorSelfStats {
    pub pid: Option<u32>,
    pub cpu: Option<f64>,
    pub rss: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SystemSnapshot {
    pub cpu_basis: String,
    pub host: HostStats,
    pub shared: Vec<SharedBackendStats>,
    pub top: Vec<ProcRow>,
    pub history: Vec<HistoryEntry>,
    pub sampler_ms: f64,
    pub monitor: MonitorSelfStats,
}

/// Exact port of `resources.py:counter_rate`.
pub fn counter_rate(current: f64, previous: Option<f64>, seconds: f64) -> Option<f64> {
    let prev = previous?;
    if seconds <= 0.0 || current < prev {
        return None;
    }
    Some((current - prev) / seconds)
}

/// Exact port of `resources.py:host_cpu_percent`.
pub fn host_cpu_percent(
    current: &BTreeMap<String, f64>,
    previous: Option<&BTreeMap<String, f64>>,
) -> Option<f64> {
    let prev = previous?;
    if current.len() != prev.len() || !current.keys().all(|k| prev.contains_key(k)) {
        return None;
    }
    let mut delta: HashMap<&str, f64> = HashMap::with_capacity(current.len());
    let mut sum = 0.0_f64;
    for (k, &v) in current {
        let d = (v - prev[k]).max(0.0);
        sum += d;
        delta.insert(k.as_str(), d);
    }
    let total = sum
        - delta.get("guest").copied().unwrap_or(0.0)
        - delta.get("guest_nice").copied().unwrap_or(0.0);
    if total <= 0.0 {
        return None;
    }
    let busy = total
        - delta.get("idle").copied().unwrap_or(0.0)
        - delta.get("iowait").copied().unwrap_or(0.0);
    let pct = (100.0 * busy / total).clamp(0.0, 100.0);
    Some((pct * 10.0).round_ties_even() / 10.0)
}

/// Exact port of `resources.py:owner_of`.
pub fn owner_of<'a>(
    mut pid: u32,
    parents: &HashMap<u32, u32>,
    roots: &'a HashMap<u32, String>,
) -> Option<&'a str> {
    let mut seen = HashSet::new();
    while pid != 0 && seen.insert(pid) {
        if let Some(owner) = roots.get(&pid) {
            return Some(owner.as_str());
        }
        pid = parents.get(&pid).copied().unwrap_or(0);
    }
    None
}

/// Exact port of `resources.py:attribute`.
pub fn attribute(
    rows: &mut HashMap<u32, ProcRow>,
    session_roots: &HashMap<String, Vec<u32>>,
    shared_roots: &[u32],
) -> HashMap<String, ResourceGroup> {
    let mut roots: HashMap<u32, String> = HashMap::new();
    for (sid, pids) in session_roots {
        for &pid in pids {
            roots.insert(pid, sid.clone());
        }
    }
    for &pid in shared_roots {
        roots.insert(pid, format!("backend:{pid}"));
    }
    let parents: HashMap<u32, u32> = rows.iter().map(|(&pid, r)| (pid, r.ppid)).collect();
    let mut groups: HashMap<String, (f64, u64, usize, Vec<u32>, bool)> = HashMap::new();

    for (&pid, row) in rows.iter_mut() {
        let Some(owner) = owner_of(pid, &parents, &roots) else {
            continue;
        };
        let entry = groups
            .entry(owner.to_string())
            .or_insert_with(|| (0.0, 0, 0, Vec::new(), false));
        entry.1 = entry.1.saturating_add(row.rss);
        entry.2 += 1;
        entry.3.push(pid);
        if let Some(cpu) = row.cpu {
            entry.0 += cpu;
            entry.4 = true;
        }
        row.owner = Some(owner.to_string());
    }

    groups
        .into_iter()
        .map(|(owner, (cpu, rss, count, mut pids, cpu_known))| {
            pids.sort_unstable();
            (
                owner,
                ResourceGroup {
                    cpu: if cpu_known {
                        Some(((cpu.min(100.0)) * 10.0).round_ties_even() / 10.0)
                    } else {
                        None
                    },
                    rss,
                    count,
                    pids,
                },
            )
        })
        .collect()
}

pub struct NativeResourceSampler {
    sys: System,
    disks: Disks,
    networks: Networks,
    previous_pids: HashSet<(u32, u64)>,
    last: Option<Instant>,
    net_previous: HashMap<String, (u64, u64)>,
    history: VecDeque<HistoryEntry>,
    cores: usize,
    has_host_cpu_baseline: bool,
}

impl Default for NativeResourceSampler {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeResourceSampler {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());
        let cores = sys.cpus().len().max(1);
        let disks = Disks::new_with_refreshed_list();
        let networks = Networks::new_with_refreshed_list();
        Self {
            sys,
            disks,
            networks,
            previous_pids: HashSet::new(),
            last: None,
            net_previous: HashMap::new(),
            history: VecDeque::with_capacity(300),
            cores,
            has_host_cpu_baseline: false,
        }
    }

    pub fn sample(
        &mut self,
        session_candidates: &HashMap<String, Vec<(u32, Option<f64>)>>,
        shared_roots: &[u32],
    ) -> (SystemSnapshot, HashMap<String, ResourceGroup>) {
        let before = Instant::now();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let dt = self
            .last
            .map(|prev| before.duration_since(prev).as_secs_f64())
            .unwrap_or(0.0);

        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_memory().with_cpu(),
        );
        self.sys.refresh_memory();
        self.sys.refresh_cpu_usage();
        self.disks.refresh(true);
        self.networks.refresh(true);

        let mut rows: HashMap<u32, ProcRow> = HashMap::new();
        let mut current_pids: HashSet<(u32, u64)> = HashSet::new();
        let mut denied = 0usize;

        for (pid_obj, proc_info) in self.sys.processes() {
            let pid = pid_obj.as_u32();
            let rss = proc_info.memory();
            let start = proc_info.start_time();
            if rss == 0 && start == 0 {
                denied += 1;
                continue;
            }
            let ppid = proc_info.parent().map(|p| p.as_u32()).unwrap_or(0);
            let identity = (pid, start);
            let cpu = if dt > 0.0 && self.previous_pids.contains(&identity) {
                let pct =
                    (f64::from(proc_info.cpu_usage()) / (self.cores as f64)).clamp(0.0, 100.0);
                Some((pct * 100.0).round_ties_even() / 100.0)
            } else {
                None
            };
            let name = proc_info.name().to_string_lossy().into_owned();
            rows.insert(
                pid,
                ProcRow {
                    pid,
                    ppid,
                    name: if name.is_empty() {
                        "unknown".into()
                    } else {
                        name
                    },
                    created: start as f64,
                    cpu,
                    rss,
                    owner: None,
                },
            );
            current_pids.insert(identity);
        }

        self.previous_pids = current_pids;
        self.last = Some(before);

        let mut session_roots: HashMap<String, Vec<u32>> = HashMap::new();
        for (sid, candidates) in session_candidates {
            let mut pids = Vec::new();
            for &(pid, birth) in candidates {
                if let Some(row) = rows.get(&pid) {
                    if let Some(b) = birth {
                        if (row.created - b).abs() < 2.0 {
                            pids.push(pid);
                        }
                    } else {
                        pids.push(pid);
                    }
                }
            }
            if !pids.is_empty() {
                pids.sort_unstable();
                pids.dedup();
                session_roots.insert(sid.clone(), pids);
            }
        }

        let groups = attribute(&mut rows, &session_roots, shared_roots);

        let shared: Vec<SharedBackendStats> = shared_roots
            .iter()
            .filter_map(|&pid| {
                let key = format!("backend:{pid}");
                let g = groups.get(&key)?;
                let name = rows
                    .get(&pid)
                    .map(|r| r.name.clone())
                    .unwrap_or_else(|| "Codex".into());
                Some(SharedBackendStats {
                    id: key,
                    pid,
                    name,
                    cpu: g.cpu,
                    rss: g.rss,
                    count: g.count,
                    pids: g.pids.clone(),
                })
            })
            .collect();

        let host_cpu = if self.has_host_cpu_baseline {
            let v = f64::from(self.sys.global_cpu_usage()).clamp(0.0, 100.0);
            Some((v * 10.0).round_ties_even() / 10.0)
        } else {
            self.has_host_cpu_baseline = true;
            None
        };

        let mem_total = self.sys.total_memory();
        let mem_avail = self.sys.available_memory();
        let mem_used = mem_total.saturating_sub(mem_avail);
        let mem_pct = if mem_total > 0 {
            (((mem_used as f64) * 100.0 / (mem_total as f64)) * 10.0).round_ties_even() / 10.0
        } else {
            0.0
        };

        let disk_target = if Path::new("/System/Volumes/Data").exists() {
            "/System/Volumes/Data"
        } else {
            "/"
        };
        let (disk_total, disk_free) = self
            .disks
            .iter()
            .find(|d| d.mount_point() == Path::new(disk_target))
            .or_else(|| self.disks.iter().next())
            .map(|d| (d.total_space(), d.available_space()))
            .unwrap_or((0, 0));
        let disk_pct = if disk_total > 0 {
            ((((disk_total.saturating_sub(disk_free)) as f64) * 100.0 / (disk_total as f64)) * 10.0)
                .round_ties_even()
                / 10.0
        } else {
            0.0
        };

        let mut net_ifaces = Vec::new();
        let mut rx_sum = 0.0_f64;
        let mut tx_sum = 0.0_f64;
        let mut has_net = false;

        for (iface, data) in &self.networks {
            #[cfg(target_os = "macos")]
            let include = iface.starts_with("en");
            #[cfg(not(target_os = "macos"))]
            let include = {
                let low = iface.to_lowercase();
                !["loopback", "vethernet", "vpn", "tunnel"]
                    .iter()
                    .any(|p| low.contains(p))
            };
            let rx_tot = data.total_received();
            let tx_tot = data.total_transmitted();
            if include {
                let prev = self.net_previous.get(iface).copied();
                if let Some(r) = counter_rate(rx_tot as f64, prev.map(|p| p.0 as f64), dt) {
                    rx_sum += r;
                    has_net = true;
                }
                if let Some(t) = counter_rate(tx_tot as f64, prev.map(|p| p.1 as f64), dt) {
                    tx_sum += t;
                    has_net = true;
                }
                net_ifaces.push(iface.clone());
            }
            self.net_previous.insert(iface.clone(), (rx_tot, tx_tot));
        }

        let network = NetworkStats {
            interfaces: net_ifaces,
            rx: if dt > 0.0 && has_net {
                Some(rx_sum)
            } else {
                None
            },
            tx: if dt > 0.0 && has_net {
                Some(tx_sum)
            } else {
                None
            },
        };

        let load_avg = System::load_average();
        let load = vec![load_avg.one, load_avg.five, load_avg.fifteen];

        let host = HostStats {
            cpu: host_cpu,
            cores: self.cores,
            load,
            memory: MemoryStats {
                total: mem_total,
                available: mem_avail,
                used: mem_used,
                percent: mem_pct,
            },
            swap: SwapStats {
                used: self.sys.used_swap(),
                total: self.sys.total_swap(),
            },
            disk: DiskStats {
                path: disk_target.to_string(),
                total: disk_total,
                free: disk_free,
                percent: disk_pct,
                read: None,
                write: None,
            },
            network: network.clone(),
            battery: None,
            uptime: System::uptime() as f64,
            process_count: rows.len(),
            unreadable_processes: denied,
            platform: std::env::consts::ARCH.to_string(),
            os: match std::env::consts::OS {
                "macos" => "Darwin".into(),
                "windows" => "Windows".into(),
                other => other.into(),
            },
            gpu: None,
            gpu_note: "GPU·온도 센서는 수집하지 않습니다.".into(),
        };

        if self.history.len() == 300 {
            self.history.pop_front();
        }
        self.history.push_back(HistoryEntry {
            t: now,
            cpu: host_cpu,
            memory: mem_pct,
            rx: network.rx,
            tx: network.tx,
        });

        let mut top: Vec<ProcRow> = rows.values().cloned().collect();
        top.sort_by(|a, b| {
            let ac = a.cpu.unwrap_or(0.0);
            let bc = b.cpu.unwrap_or(0.0);
            bc.partial_cmp(&ac)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.rss.cmp(&a.rss))
        });
        top.truncate(15);

        let own_pid = std::process::id();
        let mon = rows.get(&own_pid);
        let monitor = MonitorSelfStats {
            pid: mon.map(|m| m.pid),
            cpu: mon.and_then(|m| m.cpu),
            rss: mon.map(|m| m.rss),
        };

        let sampler_ms = ((before.elapsed().as_secs_f64() * 1000.0) * 10.0).round() / 10.0;
        let snapshot = SystemSnapshot {
            cpu_basis: "host_total".into(),
            host,
            shared,
            top,
            history: self.history.iter().cloned().collect(),
            sampler_ms,
            monitor,
        };
        (snapshot, groups)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_cpu_and_attribution_match_python() {
        let prev = BTreeMap::from([
            ("user".into(), 10.0),
            ("system".into(), 5.0),
            ("idle".into(), 85.0),
        ]);
        let curr = BTreeMap::from([
            ("user".into(), 20.0),
            ("system".into(), 10.0),
            ("idle".into(), 110.0),
        ]);
        // delta user=10, sys=5, idle=25 -> total=40, busy=15 -> 37.5%
        assert_eq!(host_cpu_percent(&curr, Some(&prev)), Some(37.5));

        let mut rows = HashMap::from([
            (
                10,
                ProcRow {
                    pid: 10,
                    ppid: 1,
                    name: "claude".into(),
                    created: 100.0,
                    cpu: Some(12.34),
                    rss: 1000,
                    owner: None,
                },
            ),
            (
                11,
                ProcRow {
                    pid: 11,
                    ppid: 10,
                    name: "child".into(),
                    created: 101.0,
                    cpu: Some(5.11),
                    rss: 500,
                    owner: None,
                },
            ),
        ]);
        let sroots = HashMap::from([("s1".into(), vec![10])]);
        let groups = attribute(&mut rows, &sroots, &[]);
        let g = groups.get("s1").unwrap();
        assert_eq!(g.rss, 1500);
        assert_eq!(g.count, 2);
        // 12.34 + 5.11 = 17.45 -> Python round(17.45, 1) == 17.4 (round-half-to-even)
        assert_eq!(g.cpu, Some(17.4));
    }
}
