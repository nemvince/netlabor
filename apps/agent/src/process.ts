/** Emulator process helpers: spawn inside a namespace, log, and stop cleanly. */

import { openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@netlabor/contract';
import type { AgentConfig } from './config.ts';

/** Open stdin pipes kept alive for daemons that exit on EOF (dynamips). */
const stdinHandles = new Map<number, { end(): void }>();

export interface StartProcessOptions {
  argv: string[];
  netns: string;
  config: AgentConfig;
  cwd: string;
  logFile?: string;
  uid?: number;
  gid?: number;
  env?: Record<string, string>;
  /** Keep an open stdin pipe; some daemons exit immediately on EOF. */
  keepStdinOpen?: boolean;
}

/**
 * Spawn an emulator inside the project namespace under the emulator account.
 * stdio goes to a per-node log file so console proxies own the terminal.
 */
export async function startNodeProcess(options: StartProcessOptions): Promise<number> {
  const argv = options.argv;
  const uid = options.uid ?? options.config.emulatorUid;
  const gid = options.gid ?? options.config.emulatorGid;
  const exec = [
    'ip',
    'netns',
    'exec',
    options.netns,
    'setpriv',
    `--reuid=${uid}`,
    `--regid=${gid}`,
    '--clear-groups',
    ...argv,
  ];

  let stdout: 'ignore' | number = 'ignore';
  let stderr: 'ignore' | number = 'ignore';
  if (options.logFile) {
    await mkdir(path.dirname(options.logFile), { recursive: true });
    const logFd = openSync(options.logFile, 'a');
    stdout = logFd;
    stderr = logFd;
  }

  const proc = Bun.spawn(exec, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdout,
    stderr,
    stdin: options.keepStdinOpen ? 'pipe' : 'ignore',
  });
  if (options.keepStdinOpen && proc.stdin) {
    stdinHandles.set(proc.pid, proc.stdin as unknown as { end(): void });
  }

  await Bun.sleep(50);
  proc.unref();
  return proc.pid;
}

/** Direct children of a pid, read from /proc (no shell, no extra deps). */
async function childPids(pid: number): Promise<number[]> {
  const children: number[] = [];
  const glob = new Bun.Glob('/proc/[0-9]*/stat');
  for await (const entry of glob.scan('/proc')) {
    try {
      const stat = await Bun.file(`/proc/${entry.split('/')[2]}/stat`).text();
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (Number(fields[1]) === pid) children.push(Number(entry.split('/')[2]));
    } catch {
      // process vanished while scanning
    }
  }
  return children;
}

/**
 * Stop a process tree. VPCS daemonises: the spawned pid is a supervisor and
 * the emulator is its child, so children must be signalled too.
 */
export async function stopProcess(pid: number, timeoutMs = 5_000): Promise<void> {
  stdinHandles.get(pid)?.end();
  stdinHandles.delete(pid);
  const children = await childPids(pid);
  for (const child of children) {
    try {
      process.kill(child, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(100);
  }
  for (const child of await childPids(pid)) {
    try {
      process.kill(child, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

export function requireBinary(names: string[], label: string): string {
  for (const name of names) {
    const found = Bun.which(name);
    if (found) return found;
  }
  throw new AppError('BINARY_MISSING', `${label} is not installed on this compute`, {
    details: names,
  });
}
