/** Host statistics: CPU, memory, disk, load, uptime, and process usage. */

import { statfs } from 'node:fs/promises';
import type { AgentStats } from '@netlabor/contract';
import type { AgentConfig } from '../config.ts';
import type { ProjectRegistry } from '../state.ts';

interface MemInfo {
  total: number;
  available: number;
}

async function readMemInfo(): Promise<MemInfo> {
  try {
    const text = await Bun.file('/proc/meminfo').text();
    const total = Number(/^MemTotal:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024;
    const available = Number(/^MemAvailable:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024;
    return { total, available };
  } catch {
    return { total: 0, available: 0 };
  }
}

async function readLoad(): Promise<[number, number, number]> {
  try {
    const text = (await Bun.file('/proc/loadavg').text()).trim().split(' ');
    return [Number(text[0] ?? 0), Number(text[1] ?? 0), Number(text[2] ?? 0)];
  } catch {
    return [0, 0, 0];
  }
}

async function readUptime(): Promise<number> {
  try {
    const text = (await Bun.file('/proc/uptime').text()).trim().split(' ');
    return Number(text[0] ?? 0);
  } catch {
    return 0;
  }
}

async function countProcesses(): Promise<number> {
  try {
    const glob = new Bun.Glob('/proc/[0-9]*');
    let count = 0;
    for await (const _entry of glob.scan('/proc')) count++;
    return count;
  } catch {
    return 0;
  }
}

async function readDiskUsage(path: string): Promise<{ total: number; used: number }> {
  try {
    const stats = await statfs(path);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    return { total, used: total - free };
  } catch {
    return { total: 0, used: 0 };
  }
}

async function nodeProcessUsage(
  pids: { pid: number; nodeId: string; name: string }[],
  uptime: number,
): Promise<AgentStats['processes']> {
  const out: AgentStats['processes'] = [];
  for (const entry of pids) {
    try {
      const status = await Bun.file(`/proc/${entry.pid}/status`).text();
      const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024;
      const stat = await Bun.file(`/proc/${entry.pid}/stat`).text();
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const userTicks = Number(fields[11] ?? 0);
      const systemTicks = Number(fields[12] ?? 0);
      const hertz = 100;
      const startedTicks = Number(fields[19] ?? 0);
      const elapsed = Math.max(uptime - startedTicks / hertz, 0.1);
      const cpuPercent = Math.min(((userTicks + systemTicks) / hertz / elapsed) * 100, 100 * 64);
      out.push({
        pid: entry.pid,
        name: entry.name,
        nodeId: entry.nodeId,
        cpuPercent,
        memoryBytes: rss,
      });
    } catch {
      // process exited between listing and reading
    }
  }
  return out;
}

export async function collectStats(
  config: AgentConfig,
  registry: ProjectRegistry,
): Promise<AgentStats> {
  const [memory, load, uptime, disk, processCount] = await Promise.all([
    readMemInfo(),
    readLoad(),
    readUptime(),
    readDiskUsage(config.stateDir),
    countProcesses(),
  ]);
  const tracked = registry
    .allNodes()
    .filter((node) => node.pid !== null && node.pid > 0)
    .map((node) => ({ pid: node.pid as number, nodeId: node.nodeId, name: node.nodeId }));
  const processes = await nodeProcessUsage(tracked, uptime);

  return {
    underlayHost: config.underlayHost,
    cpuCount: navigator.hardwareConcurrency,
    loadAverage: load,
    memoryTotalBytes: memory.total,
    memoryUsedBytes: Math.max(memory.total - memory.available, 0),
    diskTotalBytes: disk.total,
    diskUsedBytes: disk.used,
    processCount,
    uptimeSeconds: uptime,
    processes,
    collectedAt: new Date().toISOString(),
  };
}
