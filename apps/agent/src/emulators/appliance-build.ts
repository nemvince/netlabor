/**
 * Throwaway QEMU build VM for appliance images.
 *
 * A build boots a base cloud image with QEMU user networking (the guest is
 * online, nothing from the lab is reachable), lets cloud-init provision the
 * desktop, then powers off. The resulting qcow2 is hashed and moved into the
 * compute's image store, where nodes attach to it without any uplink.
 */

import { closeSync, type Dirent, existsSync, openSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  type ApplianceBuildArtifact,
  type ApplianceBuildSpec,
  type ApplianceBuildStartOutput,
  type ApplianceBuildStatusOutput,
} from '@netlabor/contract';
import type { Logger } from '@netlabor/shared';
import type { AgentConfig } from '../config.ts';
import { blobFile } from '../storage/images.ts';
import { writeCloudInitSeed } from './cloud-init.ts';

export interface ApplianceBuildContext {
  config: AgentConfig;
  logger?: Logger;
}

/** The subset of Bun's subprocess handle the build runner needs. */
interface BuildProcess {
  pid: number;
  exited: Promise<number>;
  unref(): void;
}

type BuildPhase = 'running' | 'completed' | 'failed' | 'cancelled';

interface BuildState {
  buildId: string;
  artifactName: string;
  status: BuildPhase;
  /** 0..1, as reported by NETLABOR_PROGRESS markers. */
  progress: number;
  message: string | null;
  error: string | null;
  pid: number | null;
  artifact: ApplianceBuildArtifact | null;
  startedAt: string;
  updatedAt: string;
}

interface BuildRuntime {
  /** Null when the build was adopted after an agent restart. */
  proc: BuildProcess | null;
  pid: number;
  cancelRequested: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

interface LogPump {
  offset: number;
  pending: string;
}

interface MarkerUpdate {
  progress: number | null;
  message: string | null;
  ok: boolean;
  failure: string | null;
}

interface BuildMarkers {
  ok: boolean;
  failure: string | null;
  progress: number | null;
  message: string | null;
}

const BUILD_DIR = 'appliance-builds';
const STATE_FILE = 'state.json';
const CONSOLE_FILE = 'console.log';
const QEMU_LOG_FILE = 'qemu.log';
const DISK_FILE = 'build.qcow2';
const LOG_TAIL_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const EXIT_POLL_MS = 1_000;
const KILL_GRACE_MS = 10_000;
const CANCEL_WAIT_MS = 20_000;
const MAX_STATE_ERROR = 2_000;
const MAX_LOG_PENDING = 8 * 1024;
const LOG_CHUNK_BYTES = 1024 * 1024;
/** A completed build keeps its log; a failed or cancelled one keeps only state. */
const KEEP_COMPLETED = new Set([STATE_FILE, CONSOLE_FILE]);
const KEEP_TERMINAL = new Set([STATE_FILE, QEMU_LOG_FILE, CONSOLE_FILE]);

const runtimes = new Map<string, BuildRuntime>();

function createRuntime(proc: BuildProcess | null, pid: number): BuildRuntime {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { proc, pid, cancelRequested: false, done: promise, resolveDone: resolve };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve with the promise's value, or null when the timer fires first. */
async function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  const { promise: timeout, resolve } = Promise.withResolvers<null>();
  const timer = setTimeout(() => resolve(null), ms);
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function assertBuildId(buildId: string): string {
  if (!/^[0-9A-Za-z_-]{1,64}$/.test(buildId)) {
    throw new AppError('BAD_REQUEST', 'invalid build id');
  }
  return buildId;
}

function safeArtifactName(name: string): string {
  const base = path.basename(name);
  if (base !== name || base === '' || base === '.' || base === '..' || base.includes('\0')) {
    throw new AppError('BAD_REQUEST', 'invalid build artifact name');
  }
  if (base.length > 255) throw new AppError('BAD_REQUEST', 'build artifact name is too long');
  return base;
}

function workspacePath(config: AgentConfig, buildId: string): string {
  return path.join(config.stateDir, BUILD_DIR, buildId);
}

function timeoutMs(): number {
  const raw = process.env.NB_APPLIANCE_BUILD_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function timeoutMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

function findQemu(): string {
  for (const candidate of ['qemu-system-x86_64', 'qemu-system-aarch64']) {
    const found = Bun.which(candidate);
    if (found) return found;
  }
  throw new AppError('BINARY_MISSING', 'no qemu-system binary found on this compute');
}

function findQemuImg(): string {
  const found = Bun.which('qemu-img');
  if (!found) throw new AppError('BINARY_MISSING', 'qemu-img is required to prepare build disks');
  return found;
}

function isProcessAlive(pid: number | null): boolean {
  if (pid === null || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Trust a recorded pid only while its command line still belongs to the build. */
async function isBuildProcessAlive(pid: number | null, buildId: string): Promise<boolean> {
  if (!isProcessAlive(pid) || pid === null) return false;
  try {
    const cmdline = await Bun.file(`/proc/${pid}/cmdline`).text();
    return cmdline.includes(buildId) || cmdline.includes(`netlabor-build-${buildId}`);
  } catch {
    return true;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // not a process-group leader; signal the process itself
  }
  try {
    process.kill(pid, signal);
  } catch {
    // already gone
  }
}

async function waitForStop(runtime: BuildRuntime, ms: number): Promise<boolean> {
  if (runtime.proc) {
    return (await waitAtMost(runtime.proc.exited, ms)) !== null;
  }
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!isProcessAlive(runtime.pid)) return true;
    await Bun.sleep(200);
  }
  return !isProcessAlive(runtime.pid);
}

async function terminateProcess(runtime: BuildRuntime): Promise<void> {
  const pid = runtime.proc?.pid ?? runtime.pid;
  if (!pid) return;
  signalProcess(pid, 'SIGTERM');
  if (await waitForStop(runtime, KILL_GRACE_MS)) return;
  signalProcess(pid, 'SIGKILL');
  await waitForStop(runtime, 2_000);
}

/* ------------------------------------------------------------- state file --- */

async function readState(workspace: string): Promise<BuildState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(workspace, STATE_FILE), 'utf8'),
    ) as Partial<BuildState>;
    if (typeof parsed.buildId !== 'string' || typeof parsed.status !== 'string') return null;
    if (!['running', 'completed', 'failed', 'cancelled'].includes(parsed.status)) return null;
    return parsed as BuildState;
  } catch {
    return null;
  }
}

async function saveState(workspace: string, state: BuildState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  const target = path.join(workspace, STATE_FILE);
  const temp = path.join(workspace, `.state-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, target);
}

async function readPidFile(workspace: string): Promise<number | null> {
  try {
    const value = Number((await readFile(path.join(workspace, 'qemu.pid'), 'utf8')).trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * QEMU rejects unix socket paths at ~108 bytes; the build workspace under the
 * state dir can be longer, so keep the QMP socket in the system temp dir.
 */
function qmpSocketPath(buildId: string): string {
  return path.join(tmpdir(), `netlabor-build-${buildId}.sock`);
}

async function removeWorkspaceContents(
  workspace: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(workspace, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => !keep.has(entry.name))
      .map((entry) => rm(path.join(workspace, entry.name), { recursive: true, force: true })),
  );
  await rm(qmpSocketPath(path.basename(workspace)), { force: true }).catch(() => undefined);
}

/* ------------------------------------------------------------------ logs --- */

function parseMarkerLine(line: string): MarkerUpdate {
  const text = line.replace(/\r/g, '');
  const update: MarkerUpdate = { progress: null, message: null, ok: false, failure: null };
  if (/NETLABOR_BUILD_OK\b/.test(text)) update.ok = true;
  const failed = /NETLABOR_BUILD_FAILED(?:\s+(.*))?$/.exec(text);
  if (failed) update.failure = (failed[1] ?? '').trim() || 'build script reported failure';
  const progress = /NETLABOR_PROGRESS\s+(\d{1,3})(?:\s+(.*))?$/.exec(text);
  if (progress?.[1]) {
    const percent = Number(progress[1]);
    if (Number.isFinite(percent)) {
      update.progress = Math.min(1, Math.max(0, percent / 100));
      const message = (progress[2] ?? '').trim();
      if (message) update.message = message.slice(0, 500);
    }
  }
  return update;
}

function applyMarkers(markers: BuildMarkers, updates: MarkerUpdate[]): void {
  for (const update of updates) {
    if (update.ok) markers.ok = true;
    if (update.failure !== null) markers.failure = update.failure;
    if (update.progress !== null) markers.progress = update.progress;
    if (update.message !== null) markers.message = update.message;
  }
}

/** Read newly appended console bytes, yielding complete lines. */
async function readNewLines(pump: LogPump, filePath: string, flush: boolean): Promise<string[]> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return [];
  }
  if (size < pump.offset) {
    // The file was truncated or replaced; rescan from the beginning.
    pump.offset = 0;
    pump.pending = '';
  }
  const lines: string[] = [];
  while (pump.offset < size) {
    const end = Math.min(size, pump.offset + LOG_CHUNK_BYTES);
    let text: string;
    try {
      text = await Bun.file(filePath).slice(pump.offset, end).text();
    } catch {
      break;
    }
    pump.offset = end;
    const parts = (pump.pending + text).split('\n');
    pump.pending = parts.pop() ?? '';
    lines.push(...parts);
    if (pump.pending.length > MAX_LOG_PENDING) pump.pending = pump.pending.slice(-MAX_LOG_PENDING);
  }
  if (flush && pump.pending.length > 0) {
    lines.push(pump.pending);
    pump.pending = '';
  }
  return lines;
}

async function scanMarkers(filePath: string): Promise<BuildMarkers> {
  const markers: BuildMarkers = { ok: false, failure: null, progress: null, message: null };
  const pump: LogPump = { offset: 0, pending: '' };
  applyMarkers(markers, (await readNewLines(pump, filePath, true)).map(parseMarkerLine));
  return markers;
}

async function tailOf(filePath: string, bytes = LOG_TAIL_BYTES): Promise<string | null> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return null;
  }
  if (size === 0) return null;
  const start = Math.max(0, size - bytes);
  try {
    return await Bun.file(filePath).slice(start).text();
  } catch {
    return null;
  }
}

async function qemuLogHint(workspace: string): Promise<string> {
  const tail = await tailOf(path.join(workspace, QEMU_LOG_FILE), 2_000);
  if (tail === null) return '';
  const last = tail.trim().split('\n').pop()?.trim();
  return last ? `: ${last.slice(0, 500)}` : '';
}

/* --------------------------------------------------------------- artifact --- */

async function hashFile(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(filePath).stream()) hasher.update(chunk);
  return Buffer.from(hasher.digest()).toString('hex');
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Active image root: shared NFS when configured, otherwise the local store. */
async function imageRoot(config: AgentConfig): Promise<string> {
  if (config.storageDriver !== 'nfs') return config.imageDir;
  if (!config.nfsImageDir) {
    throw new AppError('CAPABILITY_UNSUPPORTED', 'NB_NFS_IMAGE_DIR is not configured');
  }
  let directory = false;
  try {
    directory = (await stat(config.nfsImageDir)).isDirectory();
  } catch {
    throw new AppError(
      'CAPABILITY_UNSUPPORTED',
      `NFS image directory ${config.nfsImageDir} is not mounted`,
    );
  }
  if (!directory) {
    throw new AppError(
      'CAPABILITY_UNSUPPORTED',
      `NFS image directory ${config.nfsImageDir} is not a directory`,
    );
  }
  return config.nfsImageDir;
}

/** Hash the build disk and atomically move it to `<root>/<sha256>/<name>`. */
async function storeArtifact(
  config: AgentConfig,
  diskPath: string,
  artifactName: string,
): Promise<ApplianceBuildArtifact> {
  const sha256 = await hashFile(diskPath);
  const root = await imageRoot(config);
  const directory = path.join(root, sha256);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const target = path.join(directory, artifactName);
  const temp = path.join(directory, `.partial-${process.pid}-${Date.now()}`);
  let moved = false;
  try {
    try {
      await rename(diskPath, temp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await copyFile(diskPath, temp);
      await rm(diskPath, { force: true });
    }
    await syncFile(temp);
    await rename(temp, target);
    moved = true;
  } finally {
    if (!moved) await rm(temp, { force: true }).catch(() => undefined);
  }
  const info = await stat(target);
  return { sha256, filename: artifactName, sizeBytes: info.size };
}

/* ---------------------------------------------------------------- qemu --- */

interface QemuImageInfo {
  format?: unknown;
}

async function detectBaseFormat(qemuImg: string, basePath: string): Promise<'qcow2' | 'raw'> {
  const proc = Bun.spawn([qemuImg, 'info', '--output=json', basePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new AppError('AGENT_ERROR', 'the base cloud image is not readable by qemu-img', {
      details: stderr.trim().slice(0, 2_000),
    });
  }
  let info: QemuImageInfo;
  try {
    info = JSON.parse(stdout) as QemuImageInfo;
  } catch {
    throw new AppError('AGENT_ERROR', 'qemu-img returned unparseable base image metadata');
  }
  const format = typeof info.format === 'string' ? info.format : '';
  if (format !== 'qcow2' && format !== 'raw') {
    throw new AppError(
      'AGENT_ERROR',
      `unsupported base cloud image format: ${format || 'unknown'}`,
    );
  }
  return format;
}

interface OverlayInput {
  qemuImg: string;
  basePath: string;
  baseFormat: 'qcow2' | 'raw';
  target: string;
  diskGb: number;
}

async function createOverlay(input: OverlayInput): Promise<void> {
  const proc = Bun.spawn(
    [
      input.qemuImg,
      'create',
      '-f',
      'qcow2',
      '-F',
      input.baseFormat,
      '-b',
      input.basePath,
      input.target,
      `${input.diskGb}G`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new AppError('AGENT_ERROR', 'qemu-img could not create the build disk', {
      details: stderr.trim().slice(0, 2_000),
    });
  }
}

interface QemuArgsInput {
  qemu: string;
  buildId: string;
  memoryMb: number;
  cpus: number;
  diskPath: string;
  diskInterface: 'ide' | 'virtio';
  firmware: 'bios' | 'uefi';
  ovmfCode: string | null;
  ovmfVars: string | null;
  seedPath: string;
  consoleLog: string;
  qmpSocket: string;
  pidFile: string;
}

function qemuArgs(input: QemuArgsInput): string[] {
  const accel = existsSync('/dev/kvm') ? 'kvm' : 'tcg';
  const firmware =
    input.firmware === 'uefi' && input.ovmfCode && input.ovmfVars
      ? [
          '-drive',
          `if=pflash,format=raw,readonly=on,file=${input.ovmfCode}`,
          '-drive',
          `if=pflash,format=raw,file=${input.ovmfVars}`,
        ]
      : [];
  return [
    input.qemu,
    ...firmware,
    '-name',
    `netlabor-build-${input.buildId}`,
    '-m',
    String(input.memoryMb),
    '-smp',
    String(input.cpus),
    // Modern distro userlands (Rocky 9+) require x86-64-v2; qemu64 lacks it.
    '-cpu',
    'max',
    '-drive',
    `file=${input.diskPath},if=${input.diskInterface},format=qcow2`,
    '-drive',
    `file=${input.seedPath},media=cdrom,readonly=on`,
    '-nic',
    'user,model=virtio-net-pci',
    '-display',
    'none',
    '-vga',
    'none',
    '-serial',
    `file:${input.consoleLog}`,
    '-qmp',
    `unix:${input.qmpSocket},server=on,wait=off`,
    '-pidfile',
    input.pidFile,
    '-accel',
    accel,
    '-no-reboot',
  ];
}

/* --------------------------------------------------------------- runner --- */

async function persistProgress(
  workspace: string,
  state: BuildState,
  markers: BuildMarkers,
): Promise<void> {
  let changed = false;
  if (markers.progress !== null && markers.progress > state.progress) {
    state.progress = markers.progress;
    if (markers.message !== null) state.message = markers.message;
    changed = true;
  } else if (markers.message !== null && state.message === null) {
    state.message = markers.message;
    changed = true;
  }
  if (!changed) return;
  await saveState(workspace, state).catch(() => undefined);
}

async function failBuild(
  ctx: ApplianceBuildContext,
  workspace: string,
  state: BuildState,
  message: string,
): Promise<void> {
  const error = message.slice(0, MAX_STATE_ERROR);
  state.status = 'failed';
  state.error = error;
  state.message = 'build failed';
  try {
    await saveState(workspace, state);
  } catch (saveError) {
    ctx.logger?.error('failed to persist appliance build state', {
      buildId: state.buildId,
      err: saveError,
    });
  }
  await removeWorkspaceContents(workspace, KEEP_TERMINAL).catch(() => undefined);
  ctx.logger?.warn('appliance build failed', { buildId: state.buildId, error });
}

async function completeBuild(
  ctx: ApplianceBuildContext,
  workspace: string,
  state: BuildState,
  runtime: BuildRuntime,
): Promise<void> {
  const diskPath = path.join(workspace, DISK_FILE);
  try {
    await stat(diskPath);
  } catch {
    await failBuild(ctx, workspace, state, 'build disk is missing after the build VM exited');
    return;
  }
  state.progress = Math.max(state.progress, 0.99);
  state.message = 'publishing artifact';
  state.error = null;
  await saveState(workspace, state).catch(() => undefined);
  if (runtime.cancelRequested) return;
  try {
    const artifact = await storeArtifact(ctx.config, diskPath, state.artifactName);
    if (runtime.cancelRequested) return;
    state.status = 'completed';
    state.progress = 1;
    state.message = 'build completed';
    state.artifact = artifact;
    state.error = null;
    await saveState(workspace, state);
    const tail = await tailOf(path.join(workspace, CONSOLE_FILE));
    if (tail !== null) {
      await writeFile(path.join(workspace, CONSOLE_FILE), tail, { mode: 0o600 }).catch(
        () => undefined,
      );
    }
    await removeWorkspaceContents(workspace, KEEP_COMPLETED).catch(() => undefined);
    ctx.logger?.info('appliance build completed', {
      buildId: state.buildId,
      sha256: artifact.sha256,
      filename: artifact.filename,
      sizeBytes: artifact.sizeBytes,
    });
  } catch (error) {
    await failBuild(
      ctx,
      workspace,
      state,
      `build artifact could not be published: ${errorMessage(error)}`,
    );
  }
}

async function monitorBuild(
  ctx: ApplianceBuildContext,
  workspace: string,
  state: BuildState,
  runtime: BuildRuntime,
): Promise<void> {
  const timeout = timeoutMs();
  const started = Date.parse(state.startedAt);
  const deadline = (Number.isFinite(started) ? started : Date.now()) + timeout;
  const consolePath = path.join(workspace, CONSOLE_FILE);
  const pump: LogPump = { offset: 0, pending: '' };
  const markers: BuildMarkers = { ok: false, failure: null, progress: null, message: null };
  let timedOut = false;
  try {
    while (true) {
      applyMarkers(markers, (await readNewLines(pump, consolePath, false)).map(parseMarkerLine));
      await persistProgress(workspace, state, markers);
      if (runtime.cancelRequested) return;
      if (markers.failure !== null) {
        await terminateProcess(runtime);
        break;
      }
      const exited = runtime.proc
        ? (await waitAtMost(runtime.proc.exited, EXIT_POLL_MS)) !== null
        : !(await isBuildProcessAlive(runtime.pid, state.buildId));
      if (exited) break;
      if (Date.now() >= deadline) {
        timedOut = true;
        await terminateProcess(runtime);
        break;
      }
    }
    applyMarkers(markers, (await readNewLines(pump, consolePath, true)).map(parseMarkerLine));
    await persistProgress(workspace, state, markers);
    if (runtime.cancelRequested) return;
    const exitCode = runtime.proc ? await runtime.proc.exited : null;
    if (markers.failure !== null) {
      await failBuild(ctx, workspace, state, `build failed: ${markers.failure}`);
    } else if (timedOut) {
      await failBuild(
        ctx,
        workspace,
        state,
        `build exceeded the ${timeoutMinutes(timeout)} minute limit`,
      );
    } else if (!markers.ok) {
      if (runtime.proc === null) {
        // The agent did not own this process; it vanished without a marker.
        await failBuild(ctx, workspace, state, 'build interrupted');
      } else {
        const code = exitCode === null ? '' : ` (qemu exited with code ${exitCode})`;
        await failBuild(
          ctx,
          workspace,
          state,
          `build did not report completion${code}${await qemuLogHint(workspace)}`,
        );
      }
    } else {
      await completeBuild(ctx, workspace, state, runtime);
    }
  } catch (error) {
    if (!runtime.cancelRequested) {
      await terminateProcess(runtime).catch(() => undefined);
      await failBuild(ctx, workspace, state, `build runner error: ${errorMessage(error)}`);
    }
  } finally {
    runtimes.delete(state.buildId);
    runtime.resolveDone();
  }
}

/**
 * A status poll found a live build process that this agent process did not
 * spawn (the agent restarted while the VM kept running). Watch it to the end.
 */
async function adoptBuild(
  ctx: ApplianceBuildContext,
  workspace: string,
  state: BuildState,
  pid: number,
): Promise<void> {
  if (runtimes.has(state.buildId)) return;
  const runtime = createRuntime(null, pid);
  runtimes.set(state.buildId, runtime);
  void monitorBuild(ctx, workspace, state, runtime);
}

/** Recover a build whose process died while no runner was attached. */
async function reconcileDeadBuild(
  ctx: ApplianceBuildContext,
  workspace: string,
  state: BuildState,
): Promise<void> {
  if (runtimes.has(state.buildId)) return;
  const markers = await scanMarkers(path.join(workspace, CONSOLE_FILE));
  if (markers.failure !== null) {
    await failBuild(ctx, workspace, state, `build failed: ${markers.failure}`);
    return;
  }
  if (!markers.ok) {
    await failBuild(ctx, workspace, state, 'build interrupted');
    return;
  }
  const runtime = createRuntime(null, 0);
  runtimes.set(state.buildId, runtime);
  void completeBuild(ctx, workspace, state, runtime).finally(() => {
    runtimes.delete(state.buildId);
    runtime.resolveDone();
  });
}

/* ------------------------------------------------------------ public API --- */

interface LaunchInput {
  workspace: string;
  qemu: string;
  qemuImg: string;
  basePath: string;
  baseFormat: 'qcow2' | 'raw';
  spec: ApplianceBuildSpec;
  artifactName: string;
}

/** Locate OVMF firmware; layout differs between Arch and Debian hosts. */
function locateOvmf(): { code: string; vars: string } | null {
  const candidates = [
    ['/usr/share/edk2/x64/OVMF_CODE.4m.fd', '/usr/share/edk2/x64/OVMF_VARS.4m.fd'],
    ['/usr/share/OVMF/OVMF_CODE.fd', '/usr/share/OVMF/OVMF_VARS.fd'],
    ['/usr/share/OVMF/OVMF_CODE_4M.fd', '/usr/share/OVMF/OVMF_VARS_4M.fd'],
    ['/usr/share/qemu/OVMF_CODE.fd', '/usr/share/OVMF/OVMF_VARS.fd'],
  ] as const;
  for (const [code, vars] of candidates) {
    if (existsSync(code) && existsSync(vars)) return { code, vars };
  }
  return null;
}

async function launchBuild(input: LaunchInput): Promise<{ proc: BuildProcess; state: BuildState }> {
  const { workspace, spec } = input;
  const diskPath = path.join(workspace, DISK_FILE);
  const seedPath = path.join(workspace, 'seed');
  const consoleLog = path.join(workspace, CONSOLE_FILE);
  const qmpSocket = qmpSocketPath(spec.buildId);
  const pidFile = path.join(workspace, 'qemu.pid');
  let firmwareFiles: { code: string; vars: string } | null = null;
  if (spec.firmware === 'uefi') {
    const ovmf = locateOvmf();
    if (!ovmf) {
      throw new AppError(
        'CAPABILITY_UNSUPPORTED',
        'UEFI firmware (OVMF) is not installed; install edk2-ovmf or ovmf on the compute',
      );
    }
    const varsPath = path.join(workspace, 'ovmf-vars.fd');
    await copyFile(ovmf.vars, varsPath);
    firmwareFiles = { code: ovmf.code, vars: varsPath };
  }
  await rm(qmpSocket, { force: true }).catch(() => undefined);

  await createOverlay({
    qemuImg: input.qemuImg,
    basePath: input.basePath,
    baseFormat: input.baseFormat,
    target: diskPath,
    diskGb: spec.diskGb,
  });
  const seedIso = await writeCloudInitSeed(seedPath, {
    userData: spec.userData,
    metaData: spec.metaData,
    ...(spec.networkConfig !== undefined ? { networkConfig: spec.networkConfig } : {}),
  });

  const state: BuildState = {
    buildId: spec.buildId,
    artifactName: input.artifactName,
    status: 'running',
    progress: 0,
    message: 'build VM started',
    error: null,
    pid: null,
    artifact: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveState(workspace, state);

  const argv = qemuArgs({
    qemu: input.qemu,
    buildId: spec.buildId,
    memoryMb: spec.memoryMb,
    cpus: spec.cpus,
    diskPath,
    diskInterface: spec.diskInterface,
    firmware: spec.firmware,
    ovmfCode: firmwareFiles?.code ?? null,
    ovmfVars: firmwareFiles?.vars ?? null,
    seedPath: seedIso,
    consoleLog,
    qmpSocket,
    pidFile,
  });
  const qemuLog = openSync(path.join(workspace, QEMU_LOG_FILE), 'a', 0o600);
  let proc: BuildProcess;
  try {
    proc = Bun.spawn(argv, {
      cwd: workspace,
      env: { ...process.env },
      stdin: 'ignore',
      stdout: qemuLog,
      stderr: qemuLog,
      detached: true,
    });
  } finally {
    closeSync(qemuLog);
  }
  return { proc, state };
}

/**
 * Boot the throwaway build VM. Returns as soon as QEMU is running; progress
 * and the artifact are reported through {@link buildStatus}. Errors after the
 * process starts are surfaced through the build state, never thrown.
 */
export async function startBuild(
  ctx: ApplianceBuildContext,
  spec: ApplianceBuildSpec,
): Promise<ApplianceBuildStartOutput> {
  const buildId = assertBuildId(spec.buildId);
  const artifactName = safeArtifactName(spec.artifactName);
  if (runtimes.has(buildId)) {
    throw new AppError('CONFLICT', 'a build with this id is already running');
  }
  const qemu = findQemu();
  const qemuImg = findQemuImg();
  const basePath = await blobFile(ctx.config, spec.base.sha256, spec.base.filename);
  if (!basePath) {
    throw new AppError('IMAGE_MISSING', 'the base cloud image is not present on this compute');
  }
  const baseFormat = await detectBaseFormat(qemuImg, basePath);

  const workspace = workspacePath(ctx.config, buildId);
  const existing = await readState(workspace);
  if (existing?.status === 'running') {
    const pid = existing.pid ?? (await readPidFile(workspace));
    if (await isBuildProcessAlive(pid, buildId)) {
      throw new AppError('CONFLICT', 'a build with this id is already running');
    }
  }
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true, mode: 0o755 });

  let launched: { proc: BuildProcess; state: BuildState };
  try {
    launched = await launchBuild({
      workspace,
      qemu,
      qemuImg,
      basePath,
      baseFormat,
      spec,
      artifactName,
    });
  } catch (error) {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError('AGENT_ERROR', 'the build VM could not be started', {
      details: errorMessage(error),
    });
  }

  const runtime = createRuntime(launched.proc, launched.proc.pid);
  runtimes.set(buildId, runtime);
  launched.proc.unref();
  launched.state.pid = launched.proc.pid;
  try {
    await saveState(workspace, launched.state);
  } catch (error) {
    ctx.logger?.warn('appliance build pid was not persisted', { buildId, err: error });
  }
  void monitorBuild(ctx, workspace, launched.state, runtime);
  return { buildId, workspace };
}

/** Current build status, adopting or recovering a build after agent restarts. */
export async function buildStatus(
  ctx: ApplianceBuildContext,
  buildId: string,
): Promise<ApplianceBuildStatusOutput> {
  assertBuildId(buildId);
  const workspace = workspacePath(ctx.config, buildId);
  let state = await readState(workspace);
  if (!state) {
    return {
      buildId,
      status: 'failed',
      progress: 0,
      message: null,
      log: null,
      artifact: null,
      error: 'build not found on this agent',
    };
  }
  if (state.status === 'running') {
    const pid = state.pid ?? (await readPidFile(workspace));
    const alive = await isBuildProcessAlive(pid, buildId);
    if (alive && pid !== null) {
      if (!runtimes.has(buildId)) await adoptBuild(ctx, workspace, state, pid);
    } else if (!runtimes.has(buildId)) {
      await reconcileDeadBuild(ctx, workspace, state);
      state = (await readState(workspace)) ?? state;
    }
  }
  const log = await tailOf(path.join(workspace, CONSOLE_FILE));
  return {
    buildId,
    status: state.status,
    progress: state.status === 'completed' ? 1 : Math.min(1, Math.max(0, state.progress)),
    message: state.message,
    log,
    artifact: state.artifact,
    error: state.error,
  };
}

/** Cancel a build, stop its VM, and drop the workspace build data. */
export async function cancelBuild(
  ctx: ApplianceBuildContext,
  buildId: string,
): Promise<{ ok: true }> {
  assertBuildId(buildId);
  const workspace = workspacePath(ctx.config, buildId);
  const state = await readState(workspace);
  if (!state) return { ok: true };
  if (state.status !== 'running') return { ok: true };

  const runtime = runtimes.get(buildId);
  if (runtime) {
    runtime.cancelRequested = true;
    await terminateProcess(runtime);
    await waitAtMost(runtime.done, CANCEL_WAIT_MS);
  } else {
    const pid = state.pid ?? (await readPidFile(workspace));
    const detached = createRuntime(null, pid ?? 0);
    detached.cancelRequested = true;
    await terminateProcess(detached);
  }

  const latest = (await readState(workspace)) ?? state;
  if (latest.status === 'running') {
    latest.status = 'cancelled';
    latest.message = 'build cancelled';
    latest.error = null;
    try {
      await saveState(workspace, latest);
    } catch (error) {
      ctx.logger?.warn('failed to persist cancelled appliance build', { buildId, err: error });
    }
  }
  await removeWorkspaceContents(workspace, KEEP_TERMINAL).catch(() => undefined);
  ctx.logger?.info('appliance build cancelled', { buildId });
  return { ok: true };
}
