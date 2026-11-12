/** IOU adapter: NETMAP generation, iol_bridge anchors, and console piping. */

import { chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { anchorHash } from '@netlabor/catalog/anchors';
import { AppError } from '@netlabor/contract';
import { closeConsole, openRawBridge } from '../console/proxy.ts';
import {
  type NodeAdapter,
  type NodeContext,
  type NodeStartResult,
  registerAdapter,
} from '../dataplane/node.ts';
import { ubridgeClientFor } from '../dataplane/project.ts';
import type { ProjectRegistry } from '../state.ts';

interface IouRuntime {
  pid: number;
  write: (data: Uint8Array) => void;
  kill: () => void;
  transcript: string;
  listeners: Set<(chunk: Uint8Array) => void>;
}

const runtime = new WeakMap<ProjectRegistry, Map<string, IouRuntime>>();

function runtimes(registry: ProjectRegistry): Map<string, IouRuntime> {
  let map = runtime.get(registry);
  if (!map) {
    map = new Map();
    runtime.set(registry, map);
  }
  return map;
}

/**
 * NETMAP grammar: `<appId+512>:<bay>/<unit><appId padded to 5>:<bay>/<unit>`.
 * The padding is part of the format; do not change the separator.
 */
export function buildNetmap(
  applicationId: number,
  ethernetAdapters: number,
  serialAdapters: number,
): string {
  // The NETMAP grammar covers every IOU bay (0..15) and unit (0..3); adapter
  // counts only decide which of those ports the node actually exposes.
  void ethernetAdapters;
  void serialAdapters;
  const lines: string[] = [];
  const base = applicationId + 512;
  const padded = String(applicationId).padStart(5, ' ');
  for (let bay = 0; bay < 16; bay++) {
    for (let unit = 0; unit < 4; unit++) {
      lines.push(`${base}:${bay}/${unit}${padded}:${bay}/${unit}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Build the IOU argv from node properties (exported for tests). */
export function buildIouArgs(
  properties: Record<string, unknown>,
  applicationId: number,
  hasStartupConfig = false,
): string[] {
  const args: string[] = [];
  const ethernet = Number(properties.ethernetAdapters ?? 2);
  const serial = Number(properties.serialAdapters ?? 0);
  const ram = Number(properties.ram ?? 256);
  const nvram = Number(properties.nvram ?? 128);
  if (ethernet !== 2) args.push('-e', String(ethernet));
  if (serial !== 0) args.push('-s', String(serial));
  if (nvram !== 128) args.push('-n', String(nvram));
  if (ram !== 256) args.push('-m', String(ram));
  if (properties.useDefaultIouValues === false) args.push('-q');
  if (hasStartupConfig) args.push('-c', 'startup-config.cfg');
  args.push(String(applicationId));
  return args;
}

/**
 * IOU images are the emulator executable; run the uploaded image directly.
 * A PATH lookup is kept only as a fallback for hosts that install a runner.
 */
async function iouBinary(imagePath: string | undefined): Promise<string> {
  if (imagePath) {
    try {
      await chmod(imagePath, 0o755);
      return imagePath;
    } catch {
      throw new AppError('BINARY_MISSING', `IOU image is not executable: ${imagePath}`);
    }
  }
  for (const name of ['iou', 'iou.bin', 'ioulive64', 'i86bi-linux-l3-adventerprisek9']) {
    const found = Bun.which(name);
    if (found) return found;
  }
  throw new AppError('BINARY_MISSING', 'no IOU image is configured for this node');
}

/** Recreate TAP anchors deterministically; start may run after a restart/close. */
async function ensureAnchorTaps(ctx: NodeContext): Promise<void> {
  const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
  if (!client) throw new AppError('AGENT_ERROR', 'project ubridge is not running');
  for (const port of ctx.spec.ports) {
    if (port.laneType !== 'ethernet') continue;
    const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
    const tap = `t${hash}`;
    await client.send(`tap delete ${tap}`).catch(() => undefined);
    await client.send(`tap create ${tap}`).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('already exists') && !message.includes('busy')) throw error;
    });
    await client.send(`tap set_owner ${tap} ${ctx.config.emulatorUid}`).catch(() => undefined);
  }
}

/** Execute CLI commands over the piped IOU console (used by faults and MCP). */
export async function execIouConsole(
  registry: ProjectRegistry,
  nodeId: string,
  commands: string[],
  timeoutMs: number,
  prompt: RegExp,
): Promise<{ transcript: string; ok: boolean; timedOut: boolean }> {
  const runtime = runtimes(registry).get(nodeId);
  if (!runtime) throw new AppError('NODE_NOT_RUNNING', 'IOU console is not running');
  const deadline = Date.now() + Math.max(1_000, timeoutMs);
  const readyUntil = Math.min(deadline, Date.now() + Math.min(8_000, timeoutMs));
  while (Date.now() < readyUntil && !prompt.test(runtime.transcript)) {
    await Bun.sleep(120);
  }
  // The console can be flooded by IOS logs. Truncating before taking the
  // cursor prevents start from landing past the retained transcript window.
  runtime.transcript = runtime.transcript.slice(-20_000);
  const start = runtime.transcript.length;
  for (const command of commands) {
    runtime.write(new TextEncoder().encode(`${command}\r\n`));
  }
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (prompt.test(runtime.transcript.slice(start)) || Date.now() > deadline) {
        clearInterval(timer);
        resolve();
      }
    }, 120);
  });
  const transcript = runtime.transcript.slice(start);
  return { transcript, ok: prompt.test(transcript), timedOut: !prompt.test(transcript) };
}

const iouAdapter: NodeAdapter = {
  nodeType: 'iou',

  async create(ctx: NodeContext): Promise<void> {
    const applicationId = ctx.spec.applicationId;
    if (applicationId === null) throw new AppError('BAD_REQUEST', 'IOU node has no application id');
    const imageId =
      typeof ctx.spec.properties.imageId === 'string' ? ctx.spec.properties.imageId : null;
    if (!imageId) throw new AppError('IMAGE_MISSING', 'IOU node has no image');
    const imagePath = ctx.spec.images[imageId];
    if (!imagePath) throw new AppError('IMAGE_MISSING', 'IOU image is not present on this compute');

    const ethernet = Number(ctx.spec.properties.ethernetAdapters ?? 2);
    const serial = Number(ctx.spec.properties.serialAdapters ?? 0);
    await writeFile(path.join(ctx.dir, 'NETMAP'), buildNetmap(applicationId, ethernet, serial), {
      mode: 0o644,
    });

    const startupConfig =
      typeof ctx.spec.properties.startupConfig === 'string' &&
      ctx.spec.properties.startupConfig.trim() !== ''
        ? ctx.spec.properties.startupConfig
        : null;
    if (startupConfig !== null) {
      await writeFile(path.join(ctx.dir, 'startup-config.cfg'), startupConfig, { mode: 0o644 });
    }

    if (ctx.spec.properties.licenseCheck !== false) {
      if (
        typeof ctx.spec.properties.__iourc === 'string' &&
        ctx.spec.properties.__iourc.length > 0
      ) {
        await writeFile(path.join(ctx.dir, 'iourc'), ctx.spec.properties.__iourc, { mode: 0o600 });
      } else {
        throw new AppError('LICENSE_MISSING', 'IOU requires an iourc license secret for this node');
      }
    }

    await ensureAnchorTaps(ctx);
  },

  async start(ctx: NodeContext): Promise<NodeStartResult> {
    const applicationId = ctx.spec.applicationId;
    if (applicationId === null) throw new AppError('BAD_REQUEST', 'IOU node has no application id');
    const imageId =
      typeof ctx.spec.properties.imageId === 'string' ? ctx.spec.properties.imageId : null;
    const imagePath = imageId ? ctx.spec.images[imageId] : undefined;
    if (!imagePath) throw new AppError('IMAGE_MISSING', 'IOU image is not present on this compute');

    const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
    if (!client) throw new AppError('AGENT_ERROR', 'project ubridge is not running');
    const bridgeName = `IOL-BRIDGE-${applicationId + 512}`;
    await client
      .send(`iol_bridge create ${bridgeName} ${applicationId + 512}`)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('already')) throw error;
      });

    await ensureAnchorTaps(ctx);
    const binary = await iouBinary(imagePath);
    const hasStartupConfig = await Bun.file(path.join(ctx.dir, 'startup-config.cfg')).exists();
    const args = buildIouArgs(ctx.spec.properties, applicationId, hasStartupConfig);
    // IOU's NETIO fabric lives under /tmp/netio<uid>. ubridge runs as root,
    // so the IOU process must use the same uid or the IOL bridge socket in
    // /tmp/netio0 is invisible to the instance (/tmp/netio1000).
    const proc = Bun.spawn(['ip', 'netns', 'exec', ctx.netns, binary, ...args], {
      cwd: ctx.dir,
      env: {
        ...process.env,
        IOURC: path.join(ctx.dir, 'iourc'),
        NETMAP: path.join(ctx.dir, 'NETMAP'),
        LD_LIBRARY_PATH: path.dirname(imagePath),
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const write = (data: Uint8Array) => {
      try {
        proc.stdin.write(data);
        proc.stdin.flush();
      } catch {
        // stdin closed
      }
    };

    for (const port of ctx.spec.ports) {
      if (port.laneType !== 'ethernet') continue;
      const hash = anchorHash(ctx.spec.nodeId, port.adapter, port.port);
      const tap = `t${hash}`;
      await client.send(
        `iol_bridge add_nio_tap ${bridgeName} ${applicationId} ${port.adapter} ${port.port} ${tap}`,
      );
    }
    await client.send(`iol_bridge start ${bridgeName}`);

    const listeners = new Set<(chunk: Uint8Array) => void>();
    const runtime: IouRuntime = {
      pid: proc.pid,
      write,
      kill: () => proc.kill('SIGTERM'),
      transcript: '',
      listeners,
    };
    const stdout = proc.stdout as unknown as ReadableStream<Uint8Array>;
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let answeredInitialDialog = false;
    let answeredAutoinstall = false;
    let pressedReturn = false;
    void (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        runtime.transcript = (runtime.transcript + decoder.decode(value, { stream: true })).slice(
          -200_000,
        );
        // Fresh IOU logs pause at "Press RETURN to get started!" before the
        // first prompt. Answer it automatically so console exec sees a prompt.
        if (!pressedReturn && /Press RETURN to get started!/i.test(runtime.transcript)) {
          pressedReturn = true;
          write(new TextEncoder().encode('\r\n'));
        }
        // A fresh IOU nvram puts the device at an interactive first-boot
        // dialog; leave it at a usable switch prompt instead of hanging every
        // console call until a human answers.
        if (
          !answeredInitialDialog &&
          /initial configuration dialog[^\n]*\[yes\/no\]:\s*$/i.test(runtime.transcript)
        ) {
          answeredInitialDialog = true;
          write(new TextEncoder().encode('no\r\n'));
        }
        if (
          !answeredAutoinstall &&
          /terminate autoinstall[^\n]*\[yes\]:\s*$/i.test(runtime.transcript)
        ) {
          answeredAutoinstall = true;
          write(new TextEncoder().encode('yes\r\n'));
        }
        for (const listener of listeners) listener(value);
      }
      for (const listener of listeners) listener(new TextEncoder().encode(''));
    })();

    if (ctx.spec.console.externalPort !== null && ctx.spec.console.type === 'telnet') {
      await openRawBridge({
        nodeId: ctx.spec.nodeId,
        externalPort: ctx.spec.console.externalPort,
        connect: (onData, onClose) => {
          const listener = (chunk: Uint8Array) => {
            if (chunk.byteLength === 0) onClose();
            else onData(chunk);
          };
          listeners.add(listener);
          return {
            write,
            close: () => {
              listeners.delete(listener);
              onClose();
            },
          };
        },
      });
    }

    runtimes(ctx.registry).set(ctx.spec.nodeId, runtime);
    return { pid: proc.pid, internalConsolePort: null, internalVncPort: null };
  },

  async stop(ctx: NodeContext): Promise<void> {
    const state = runtimes(ctx.registry).get(ctx.spec.nodeId);
    await closeConsole(ctx.spec.nodeId);
    if (!state) return;
    state.kill();
    runtimes(ctx.registry).delete(ctx.spec.nodeId);
    const client = ubridgeClientFor(ctx.registry, ctx.spec.projectId);
    const applicationId = ctx.spec.applicationId;
    if (client && applicationId !== null) {
      await client
        .send(`iol_bridge delete IOL-BRIDGE-${applicationId + 512}`)
        .catch(() => undefined);
    }
  },

  async delete(ctx: NodeContext): Promise<void> {
    await closeConsole(ctx.spec.nodeId);
  },
};

export function registerIouAdapter(): void {
  registerAdapter(iouAdapter);
}
