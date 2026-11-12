/** Agent capability probing: binaries, kernel dataplane, storage driver. */

import { existsSync } from 'node:fs';
import type { AgentCapabilities } from '@netlabor/contract';
import type { AgentConfig } from './config.ts';

interface Probe {
  path: string | null;
  version: string | null;
}

async function probeBinary(names: string[], versionArgs: string[] = ['--version']): Promise<Probe> {
  for (const name of names) {
    const which = Bun.which(name);
    if (!which) continue;
    try {
      const proc = Bun.spawn([which, ...versionArgs], { stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      const text = `${stdout}\n${stderr}`
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      return { path: which, version: text ?? null };
    } catch {
      return { path: which, version: null };
    }
  }
  return { path: null, version: null };
}

async function hasKernelDataplane(): Promise<{ ok: boolean; ubridgeFeatures: string[] }> {
  const features: string[] = [];
  const ip = Bun.which('ip');
  if (!ip) return { ok: false, ubridgeFeatures: features };
  try {
    const netns = Bun.spawn([ip, 'netns', 'list'], { stdout: 'pipe', stderr: 'pipe' });
    await netns.exited;
    const tun = existsSync('/dev/net/tun');
    const ubridge = Bun.which('ubridge');
    if (ubridge) {
      const proc = Bun.spawn([ubridge, '-h'], { stdout: 'pipe', stderr: 'pipe' });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      void text;
      features.push('tap', 'brctl', 'iol_bridge', 'marker', 'capture');
    }
    return { ok: tun, ubridgeFeatures: features };
  } catch {
    return { ok: false, ubridgeFeatures: features };
  }
}

export async function probeCapabilities(config: AgentConfig): Promise<AgentCapabilities> {
  const [qemu, dynamips, iou, vpcs, sharkd, tshark, tcpdump, ubridge, natBridge] =
    await Promise.all([
      probeBinary(['qemu-system-x86_64', 'qemu-system-aarch64']),
      probeBinary(['dynamips'], ['-h']),
      probeBinary(['iouyap', 'ioubin']),
      probeBinary(['vpcs'], ['-h']),
      probeBinary(['sharkd'], ['-v']),
      probeBinary(['tshark'], ['-v']),
      probeBinary(['tcpdump'], ['--version']),
      probeBinary([config.ubridgePath, 'ubridge'], ['-v']),
      hasHostInterface(config.natBridge),
    ]);
  const kernel = await hasKernelDataplane();
  const kernelRelease = await readKernelRelease();

  let qemuKvm = false;
  if (qemu.path) {
    try {
      const proc = Bun.spawn([qemu.path, '-accel', 'help'], { stdout: 'pipe', stderr: 'pipe' });
      const text = await new Response(proc.stdout).text();
      await proc.exited;
      qemuKvm = /\bkvm\b/.test(text);
    } catch {
      qemuKvm = false;
    }
  }

  let docker: string | null = null;
  try {
    const response = await fetch('http://localhost/version', {
      unix: config.dockerSocket,
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const body = (await response.json()) as { Version?: string };
      docker = body.Version ?? 'unknown';
    }
  } catch {
    docker = null;
  }

  return {
    kernel: kernelRelease,
    kernelDataplane: kernel.ok && ubridge.path !== null,
    ubridge: ubridge.version,
    ubridgeFeatures: kernel.ubridgeFeatures,
    qemu: qemu.version,
    qemuKvm,
    docker,
    dynamips: dynamips.version,
    // IOU images are executables; any uploaded image can run without a
    // separately installed engine. Version probes still populate when found.
    iou: iou.version ?? 'library',
    vpcs: vpcs.version,
    sharkd: sharkd.version,
    tshark: tshark.version,
    tcpdump: tcpdump.version,
    netns: Bun.which('ip') !== null,
    natBridge,
    cloudInterfaces: config.cloudInterfaces,
    storageDriver: config.storageDriver,
  };
}

/** True when a host interface with this name exists (NAT bridge / cloud NICs). */
async function hasHostInterface(name: string): Promise<boolean> {
  const ip = Bun.which('ip');
  if (!ip) return false;
  const proc = Bun.spawn([ip, 'link', 'show', 'dev', name], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return (await proc.exited) === 0;
}

async function readKernelRelease(): Promise<string> {
  try {
    return (await Bun.file('/proc/sys/kernel/osrelease').text()).trim();
  } catch {
    return 'unknown';
  }
}

/** Binary presence per node type, used to hide unavailable templates. */
export function capabilitiesByNodeType(capabilities: AgentCapabilities): Record<string, boolean> {
  return {
    qemu: capabilities.qemu !== null,
    iou: capabilities.iou !== null,
    dynamips: capabilities.dynamips !== null,
    vpcs: capabilities.vpcs !== null,
    docker: capabilities.docker !== null,
    cloud: capabilities.netns && (capabilities.cloudInterfaces?.length ?? 0) > 0,
    nat: capabilities.netns && capabilities.natBridge === true,
    ethernet_switch: capabilities.kernelDataplane,
    ethernet_hub: capabilities.kernelDataplane,
    atm_switch: capabilities.dynamips !== null,
    frame_relay_switch: capabilities.dynamips !== null,
  };
}
