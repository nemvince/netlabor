/** Process helpers: argv-only spawning with captured output and timeouts. */

import { statSync } from 'node:fs';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    readonly argv: string[],
    readonly result: CommandResult,
  ) {
    super(
      `${argv.join(' ')} exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
    this.name = 'CommandError';
  }
}

export interface RunOptions {
  timeoutMs?: number;
  allowFailure?: boolean;
  env?: Record<string, string | undefined>;
  stdin?: string;
}

/** Run a binary with an argument array (never a shell string). */
export async function run(argv: string[], options: RunOptions = {}): Promise<CommandResult> {
  const proc = Bun.spawn(argv, {
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: options.stdin === undefined ? 'ignore' : 'pipe',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });

  if (options.stdin !== undefined && proc.stdin) {
    proc.stdin.write(options.stdin);
    proc.stdin.end();
  }

  const timeout = options.timeoutMs ?? 30_000;
  const timer = setTimeout(() => proc.kill(), timeout);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  clearTimeout(timer);

  const result: CommandResult = { code, stdout, stderr };
  if (code !== 0 && options.allowFailure !== true) throw new CommandError(argv, result);
  return result;
}

/** Run `ip netns exec <netns> <argv...>`. */
export function runInNetns(
  netns: string,
  argv: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return run(['ip', 'netns', 'exec', netns, ...argv], options);
}

/** Give the unprivileged emulator account ownership of a path. */
export async function chownForEmulator(target: string, uid: number, gid: number): Promise<void> {
  if (process.getuid?.() !== 0) return;
  try {
    const { chown } = await import('node:fs/promises');
    await chown(target, uid, gid);
  } catch {
    // best effort: the emulator will fail with a clear permission error
  }
}

/**
 * Supplementary group that owns /dev/kvm, or null when the device is absent.
 * QEMU runs with cleared groups, so this gid must be passed explicitly.
 */
export function kvmGid(): number | null {
  try {
    const stat = statSync('/dev/kvm');
    return stat.gid;
  } catch {
    return null;
  }
}

/** True when /dev/kvm grants its group read/write access. */
export function kvmGroupWritable(): boolean {
  try {
    const mode = statSync('/dev/kvm').mode;
    return (mode & 0o060) === 0o060;
  } catch {
    return false;
  }
}

export async function whichBinary(name: string): Promise<string | null> {
  return Bun.which(name);
}
