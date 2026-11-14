/** Controller self-update through GitHub release channels. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError, type UpdateChannel, type UpdateStatus } from '@netlabor/contract';
import type { AppDeps } from '../implementer.ts';
import { untarGzip } from './archives.ts';
import { getSettings } from './rbac.ts';

const REPO = 'nemvince/netlabor';
const API = `https://api.github.com/repos/${REPO}`;
const NIGHTLY_TAG = 'nightly';
const HEADERS = {
  accept: 'application/vnd.github+json',
  'user-agent': 'netlabor-controller',
};

const PLATFORMS: Record<string, string> = { x64: 'x64', arm64: 'arm64' };

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  published_at: string | null;
  assets: ReleaseAsset[];
}

export interface CheckResult {
  status: UpdateStatus;
  release: Release | null;
}

/** Numeric semver comparison; a non-semver current version counts as older. */
export function newerVersion(latest: string, current: string): boolean {
  const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)/.exec(value)?.slice(1, 4).map(Number);
  const next = parse(latest);
  const now = parse(current);
  if (!next) return false;
  if (!now) return true;
  for (let index = 0; index < 3; index += 1) {
    const a = next[index] ?? 0;
    const b = now[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) sums.set(match[2], match[1]);
  }
  return sums;
}

async function github<T>(endpoint: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(`${API}${endpoint}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new AppError('INTERNAL', 'could not reach GitHub', { details: String(error) });
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new AppError('INTERNAL', `GitHub returned ${response.status}`, {
      details: (await response.text()).slice(0, 500),
    });
  }
  return (await response.json()) as T;
}

export async function checkUpdate(deps: AppDeps): Promise<CheckResult> {
  const settings = await getSettings(deps.db);
  const channel: UpdateChannel = settings['update.channel'] === 'nightly' ? 'nightly' : 'stable';
  const currentVersion = deps.config.version;
  const blocked = (reason: string): CheckResult => ({
    status: {
      channel,
      currentVersion,
      latestVersion: null,
      available: false,
      installable: false,
      reason,
      publishedAt: null,
    },
    release: null,
  });

  if (currentVersion === 'development') {
    return blocked('This controller runs from source; install a release build to use updates.');
  }
  if (!PLATFORMS[process.arch]) {
    return blocked(`Updates are not published for ${process.arch}.`);
  }

  const release = await github<Release>(
    channel === 'nightly' ? `/releases/tags/${NIGHTLY_TAG}` : '/releases/latest',
  );
  if (!release) {
    return {
      status: {
        channel,
        currentVersion,
        latestVersion: null,
        available: false,
        installable: true,
        reason: null,
        publishedAt: null,
      },
      release: null,
    };
  }

  let latestVersion = release.tag_name.replace(/^v/, '');
  if (channel === 'nightly') {
    const ref = await github<{ object: { sha: string } }>(`/git/ref/tags/${NIGHTLY_TAG}`);
    if (ref) latestVersion = ref.object.sha.slice(0, 7);
  }

  const available =
    channel === 'nightly'
      ? currentVersion !== latestVersion
      : newerVersion(latestVersion, currentVersion);

  return {
    status: {
      channel,
      currentVersion,
      latestVersion,
      available,
      installable: true,
      reason: null,
      publishedAt: release.published_at,
    },
    release,
  };
}

async function download(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'user-agent': HEADERS['user-agent'] },
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    throw new AppError('INTERNAL', 'could not download the update', { details: String(error) });
  }
  if (!response.ok) {
    throw new AppError('INTERNAL', `update download returned ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function writable(directory: string): Promise<void> {
  try {
    await access(directory, constants.W_OK);
  } catch {
    throw new AppError(
      'INTERNAL',
      `${directory} is not writable; re-run the installer to enable controller updates`,
    );
  }
}

/** Download, verify, and install the available release, then restart. */
export async function applyUpdate(deps: AppDeps): Promise<UpdateStatus> {
  const { status, release } = await checkUpdate(deps);
  if (!status.installable) {
    throw new AppError('BAD_REQUEST', status.reason ?? 'updates are unavailable');
  }
  if (!release || !status.available) {
    throw new AppError('BAD_REQUEST', 'the controller is already up to date');
  }

  const platform = PLATFORMS[process.arch];
  if (!platform) {
    throw new AppError('INTERNAL', `updates are not published for ${process.arch}`);
  }
  const binaryName = `netlabor-controller-linux-${platform}`;
  const webName = 'netlabor-web.tar.gz';
  const sumsName = 'SHA256SUMS';
  const assets = new Map(release.assets.map((asset) => [asset.name, asset.browser_download_url]));
  for (const name of [binaryName, webName, sumsName]) {
    if (!assets.has(name)) {
      throw new AppError('INTERNAL', `release ${release.tag_name} has no ${name}`);
    }
  }

  const [binary, web, sums] = await Promise.all([
    download(assets.get(binaryName)!),
    download(assets.get(webName)!),
    download(assets.get(sumsName)!),
  ]);
  const expected = parseChecksums(new TextDecoder().decode(sums));
  if (expected.get(binaryName) !== sha256(binary) || expected.get(webName) !== sha256(web)) {
    throw new AppError('INTERNAL', 'the downloaded update does not match SHA256SUMS');
  }

  const execPath = process.execPath;
  const webRoot = path.resolve(deps.config.webRoot);
  await writable(path.dirname(execPath));
  await writable(path.dirname(webRoot));

  const binaryNext = `${execPath}.new`;
  const webNext = `${webRoot}.new`;
  const webOld = `${webRoot}.old`;
  await rm(binaryNext, { force: true });
  await rm(webNext, { recursive: true, force: true });
  await rm(webOld, { recursive: true, force: true });
  await writeFile(binaryNext, binary, { mode: 0o755 });
  await chmod(binaryNext, 0o755);
  await mkdir(webNext, { recursive: true });
  for (const [name, data] of await untarGzip(web)) {
    const target = path.resolve(webNext, name);
    if (!target.startsWith(`${webNext}${path.sep}`)) continue;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  try {
    await rename(binaryNext, execPath);
    await rename(webRoot, webOld);
    try {
      await rename(webNext, webRoot);
    } catch (error) {
      await rename(webOld, webRoot);
      throw error;
    }
    await rm(webOld, { recursive: true, force: true });
  } catch (error) {
    throw new AppError('INTERNAL', 'could not install the update', { details: String(error) });
  }

  // The reply goes out first; systemd restarts the controller from the new binary.
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1000);
  return {
    ...status,
    currentVersion: status.latestVersion ?? status.currentVersion,
    available: false,
  };
}
