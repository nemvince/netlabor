/** Controller configuration, validated from the environment at startup. */

import { type LogLevel, parseLogLevel, parseSecretKey } from '@netlabor/shared';

/** Baked in by `bun run build`; undeclared when running from source. */
declare const NB_BUILD_VERSION: string;

const buildVersion = typeof NB_BUILD_VERSION === 'string' ? NB_BUILD_VERSION : 'development';

export interface ControllerConfig {
  databaseUrl: string;
  listen: { hostname: string; port: number };
  publicUrl: string;
  secretKey: Uint8Array;
  webRoot: string;
  stagingDir: string;
  storageDriver: 'local' | 'nfs';
  nfsImageDir: string | null;
  sessionTtlHours: number;
  autoCloseIdleMinutes: number;
  adminUser: string;
  adminPassword: string | null;
  logLevel: LogLevel;
  logPretty: boolean;
  maxUploadBytes: number;
  maxNodesPerProject: number;
  allowInsecureAgent: boolean;
  tlsCert: string | null;
  tlsKey: string | null;
  version: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

function parseListen(value: string): { hostname: string; port: number } {
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) throw new Error(`invalid listen address: ${value}`);
  return { hostname: match[1] ?? '0.0.0.0', port: Number(match[2]) };
}

function integerEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

function required(name: string): string {
  const value = env(name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

export function loadControllerConfig(overrides?: Partial<ControllerConfig>): ControllerConfig {
  const storageDriver = (env('NB_STORAGE_DRIVER') ?? 'local') as 'local' | 'nfs';
  if (storageDriver !== 'local' && storageDriver !== 'nfs') {
    throw new Error('NB_STORAGE_DRIVER must be "local" or "nfs"');
  }
  const nfsImageDir = env('NB_NFS_IMAGE_DIR') ?? null;
  if (storageDriver === 'nfs' && !nfsImageDir) {
    throw new Error('NB_NFS_IMAGE_DIR is required when NB_STORAGE_DRIVER=nfs');
  }

  const config: ControllerConfig = {
    databaseUrl: required('NB_DATABASE_URL'),
    listen: parseListen(env('NB_LISTEN') ?? '0.0.0.0:8080'),
    publicUrl: (env('NB_PUBLIC_URL') ?? 'http://localhost:8080').replace(/\/$/, ''),
    secretKey: parseSecretKey(required('NB_SECRET_KEY')),
    webRoot: env('NB_WEB_ROOT') ?? 'apps/web/dist',
    stagingDir: env('NB_STAGING_DIR') ?? '/var/lib/netlabor/staging',
    storageDriver,
    nfsImageDir,
    sessionTtlHours: integerEnv('NB_SESSION_TTL_HOURS', 24),
    autoCloseIdleMinutes: integerEnv('NB_AUTO_CLOSE_IDLE_MINUTES', 10),
    adminUser: (env('NB_ADMIN_USER') ?? 'admin').toLowerCase(),
    adminPassword: env('NB_ADMIN_PASSWORD') ?? null,
    logLevel: parseLogLevel(env('NB_LOG_LEVEL')),
    logPretty: env('NB_LOG_PRETTY') === '1',
    maxUploadBytes: integerEnv('NB_MAX_UPLOAD_BYTES', 64 * 1024 * 1024 * 1024),
    maxNodesPerProject: integerEnv('NB_MAX_NODES_PER_PROJECT', 500),
    allowInsecureAgent: env('NB_ALLOW_INSECURE_AGENT') === '1',
    tlsCert: env('NB_TLS_CERT') ?? null,
    tlsKey: env('NB_TLS_KEY') ?? null,
    version: env('NB_VERSION') ?? buildVersion,
    ...overrides,
  };

  return config;
}

export function isSecureOrigin(config: ControllerConfig): boolean {
  return config.publicUrl.startsWith('https://');
}
