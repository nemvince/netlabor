/** Agent Prometheus surface: registry gauges plus host CPU, memory, and disk. */

import { statfsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import type { ProjectRegistry } from './state.ts';
import type { SharkdPool } from './wireshark/sharkd.ts';

async function memoryBytes(): Promise<{ total: number; available: number }> {
  try {
    const text = await readFile('/proc/meminfo', 'utf8');
    const pick = (key: string): number => {
      const match = new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text);
      return match?.[1] ? Number(match[1]) * 1024 : 0;
    };
    return { total: pick('MemTotal'), available: pick('MemAvailable') };
  } catch {
    return { total: 0, available: 0 };
  }
}

export async function renderAgentMetrics(
  registry: ProjectRegistry,
  pool: SharkdPool,
): Promise<string> {
  const projects = registry.list();
  const nodes = registry.allNodes();
  const statuses = new Map<string, number>();
  for (const node of nodes) statuses.set(node.status, (statuses.get(node.status) ?? 0) + 1);
  const links = projects.reduce((sum, project) => sum + project.links.size, 0);
  const captures = projects.reduce((sum, project) => sum + project.captures.size, 0);
  const memory = await memoryBytes();
  const disk = (() => {
    try {
      const info = statfsSync('/');
      return { total: info.blocks * info.bsize, free: info.bavail * info.bsize };
    } catch {
      return { total: 0, free: 0 };
    }
  })();
  const lines = [
    '# HELP nb_agent_namespaces Project namespaces managed by this agent.',
    '# TYPE nb_agent_namespaces gauge',
    `nb_agent_namespaces ${projects.length}`,
    '# HELP nb_agent_nodes Nodes by status.',
    '# TYPE nb_agent_nodes gauge',
    ...[...statuses.entries()].map(
      ([status, count]) => `nb_agent_nodes{status="${status}"} ${count}`,
    ),
    '# HELP nb_agent_links Link dataplanes.',
    '# TYPE nb_agent_links gauge',
    `nb_agent_links ${links}`,
    '# HELP nb_agent_captures Active packet captures.',
    '# TYPE nb_agent_captures gauge',
    `nb_agent_captures ${captures}`,
    '# HELP nb_sharkd_sessions Active sharkd sessions.',
    '# TYPE nb_sharkd_sessions gauge',
    `nb_sharkd_sessions ${pool.count()}`,
    '# HELP nb_agent_processes Emulator processes tracked by the registry.',
    '# TYPE nb_agent_processes gauge',
    `nb_agent_processes ${nodes.filter((node) => node.status === 'started').length}`,
    '# HELP nb_host_load1 One-minute load average.',
    '# TYPE nb_host_load1 gauge',
    `nb_host_load1 ${os.loadavg()[0] ?? 0}`,
    '# HELP nb_host_memory_bytes Host memory in bytes.',
    '# TYPE nb_host_memory_bytes gauge',
    `nb_host_memory_bytes{state="total"} ${memory.total}`,
    `nb_host_memory_bytes{state="available"} ${memory.available}`,
    '# HELP nb_host_disk_bytes Root filesystem bytes.',
    '# TYPE nb_host_disk_bytes gauge',
    `nb_host_disk_bytes{state="total"} ${disk.total}`,
    `nb_host_disk_bytes{state="free"} ${disk.free}`,
  ];
  return `${lines.join('\n')}\n`;
}
