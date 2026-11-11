/** ubridge process lifecycle inside a project namespace. */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@netlabor/contract';
import type { AgentConfig } from '../config.ts';
import { UbridgeClient, ubridgeVersion } from './client.ts';

export interface UbridgeProcess {
  pid: number;
  socketPath: string;
  client: UbridgeClient;
  stop(): Promise<void>;
}

export interface StartUbridgeOptions {
  config: AgentConfig;
  netns: string;
  short: string;
  markerSink?: string | null;
  markerProject?: string | null;
}

export async function startUbridge(options: StartUbridgeOptions): Promise<UbridgeProcess> {
  const { config, netns, short } = options;
  await mkdir(config.runDir, { recursive: true, mode: 0o700 });
  const socketPath = path.join(config.runDir, `${short}.sock`);
  await rm(socketPath, { force: true });

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (options.markerSink) {
    env.UBRIDGE_MARKER_SINK = options.markerSink;
    env.UBRIDGE_MARKER_NODE = options.markerProject ?? short;
  }

  const ubridgeBinary = Bun.which(config.ubridgePath) ?? Bun.which('ubridge');
  if (!ubridgeBinary) {
    throw new AppError('BINARY_MISSING', `ubridge not found at ${config.ubridgePath}`);
  }
  const proc = Bun.spawn(['ip', 'netns', 'exec', netns, ubridgeBinary, '-U', socketPath], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const clientPromise = UbridgeClient.connect(socketPath, 8_000).then(async (client) => {
    const version = await ubridgeVersion(client);
    if (!version) throw new AppError('AGENT_ERROR', 'ubridge did not report a version');
    return client;
  });

  let exited = false;
  proc.exited.then(() => {
    exited = true;
  });

  let client: UbridgeClient;
  try {
    client = await clientPromise;
  } catch (error) {
    proc.kill();
    const stderr = await new Response(proc.stderr).text();
    throw new AppError('AGENT_ERROR', 'ubridge failed to start', {
      details: stderr.trim() || (error instanceof Error ? error.message : String(error)),
    });
  }

  return {
    pid: proc.pid,
    socketPath,
    client,
    async stop() {
      client.close();
      if (!exited) {
        proc.kill('SIGTERM');
        const timer = setTimeout(() => proc.kill('SIGKILL'), 3_000);
        await proc.exited;
        clearTimeout(timer);
      }
      await rm(socketPath, { force: true });
    },
  };
}
