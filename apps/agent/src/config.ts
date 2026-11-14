/** Agent configuration, validated from the environment at startup. */

import { type LogLevel, parseLogLevel } from '@netlabor/shared';

/** Baked in by `bun run build`; undeclared when running from source. */
declare const NB_BUILD_VERSION: string;

const buildVersion = typeof NB_BUILD_VERSION === 'string' ? NB_BUILD_VERSION : 'development';

export interface AgentConfig {
  listen: { hostname: string; port: number };
  token: string;
  stateDir: string;
  runDir: string;
  underlayIndex: number;
  underlayHost: string;
  underlayCidr: string;
  underlayInterface: string;
  ubridgePath: string;
  natBridge: string;
  cloudInterfaces: string[];
  emulatorUid: number;
  emulatorGid: number;
  dockerSocket: string;
  storageDriver: 'local' | 'nfs';
  imageDir: string;
  nfsImageDir: string | null;
  maxSharkdSessions: number;
  logLevel: LogLevel;
  tlsCert: string | null;
  tlsKey: string | null;
  version: string;
  controllerUrl: string | null;
  dockerAutoPull: boolean;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function required(name: string): string {
  const value = env(name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function parseListen(value: string): { hostname: string; port: number } {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) throw new Error(`invalid listen address: ${value}`);
  return { hostname: match[1] ?? '0.0.0.0', port: Number(match[2]) };
}

export function loadAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const storageDriver = (env('NB_STORAGE_DRIVER') ?? 'local') as 'local' | 'nfs';
  if (storageDriver !== 'local' && storageDriver !== 'nfs') {
    throw new Error('NB_STORAGE_DRIVER must be "local" or "nfs"');
  }
  const underlayIndex = Number(required('NB_UNDERLAY_INDEX'));
  if (!Number.isInteger(underlayIndex) || underlayIndex < 1 || underlayIndex > 254) {
    throw new Error('NB_UNDERLAY_INDEX must be an integer between 1 and 254');
  }
  const nfsImageDir = env('NB_NFS_IMAGE_DIR') ?? null;
  if (storageDriver === 'nfs' && !nfsImageDir) {
    throw new Error('NB_NFS_IMAGE_DIR is required when NB_STORAGE_DRIVER=nfs');
  }

  return {
    listen: parseListen(env('NB_AGENT_LISTEN') ?? '0.0.0.0:8081'),
    token: required('NB_AGENT_TOKEN'),
    stateDir: env('NB_STATE_DIR') ?? '/var/lib/netlabor',
    runDir: env('NB_RUN_DIR') ?? '/run/netlabor',
    underlayIndex,
    underlayHost: required('NB_UNDERLAY_HOST'),
    underlayCidr: env('NB_UNDERLAY_CIDR') ?? '10.99.0.0/16',
    underlayInterface: env('NB_UNDERLAY_INTERFACE') ?? 'wg0',
    ubridgePath: env('NB_UBRIDGE_PATH') ?? '/usr/local/bin/ubridge',
    natBridge: env('NB_NAT_BRIDGE') ?? 'nb-nat',
    cloudInterfaces: (env('NB_CLOUD_INTERFACES') ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    emulatorUid: Number(env('NB_EMULATOR_UID') ?? '1001'),
    emulatorGid: Number(env('NB_EMULATOR_GID') ?? '1001'),
    dockerSocket: env('NB_DOCKER_SOCKET') ?? '/var/run/docker.sock',
    storageDriver,
    imageDir: env('NB_IMAGE_DIR') ?? '/var/lib/netlabor/images',
    nfsImageDir,
    maxSharkdSessions: Number(env('NB_MAX_SHARKD_SESSIONS') ?? '8'),
    logLevel: parseLogLevel(env('NB_LOG_LEVEL')),
    tlsCert: env('NB_TLS_CERT') ?? null,
    tlsKey: env('NB_TLS_KEY') ?? null,
    version: env('NB_VERSION') ?? buildVersion,
    controllerUrl: env('NB_CONTROLLER_URL') ?? null,
    dockerAutoPull: env('NB_DOCKER_AUTO_PULL') === '1',
    ...overrides,
  };
}
