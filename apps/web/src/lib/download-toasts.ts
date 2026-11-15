/**
 * App-wide tracker for long-running jobs that move bytes (OS image downloads,
 * marketplace appliance installs). Jobs run server-side and survive route
 * changes; this keeps one progress toast alive app-wide and settles it when
 * the job ends.
 */

import type { JobRow } from '@netlabor/contract';
import { create } from 'zustand';
import { toast } from '../components/toast.tsx';
import { client } from './api.ts';

/** osImageId → download percent; panels read this instead of tracking jobs. */
export const useOsDownloadProgress = create<Record<string, number>>(() => ({}));

interface TrackedJob {
  toastId: number;
  progress: number | null;
  success: string;
  failure: string;
}

const tracked = new Map<string, TrackedJob>();

let started = false;

function jobName(job: JobRow): string {
  const name = job.payload['name'];
  return typeof name === 'string' && name !== '' ? name : 'job';
}

/**
 * Attach a progress toast to a running job. `success`/`failure` are the final
 * messages; they default to download wording.
 */
export function trackJob(job: JobRow, copy: { success?: string; failure?: string } = {}): void {
  if (tracked.has(job.id)) return;
  const name = jobName(job);
  tracked.set(job.id, {
    toastId: toast.progress(`Working on ${name}…`, job.progress),
    progress: job.progress,
    success: copy.success ?? `Downloaded ${name}.`,
    failure: copy.failure ?? `Download failed: ${name}`,
  });
}

/** Attach a progress toast to a running os.download job. */
export function trackOsDownload(job: JobRow): void {
  trackJob(job);
}

/** Track and poll every job this app started; call once on app mount. */
export function startDownloadTracking(): void {
  if (started) return;
  started = true;
  const poll = async (): Promise<void> => {
    // Pick up downloads started elsewhere (another tab, before a reload).
    const running = await Promise.all([
      client.jobs.list({ kind: 'os.download', state: 'running', limit: 20 }).catch(() => []),
      client.jobs.list({ kind: 'appliance.install', state: 'running', limit: 20 }).catch(() => []),
    ]);
    for (const job of running.flat()) {
      trackJob(
        job,
        job.kind === 'appliance.install'
          ? {
              success: `${jobName(job)} installed into the template library.`,
              failure: `${jobName(job)} could not be installed`,
            }
          : {},
      );
    }
    if (tracked.size === 0) return;
    const percentByOsId: Record<string, number> = {};
    for (const [jobId, entry] of [...tracked]) {
      let job: JobRow;
      try {
        job = await client.jobs.get({ id: jobId });
      } catch {
        continue;
      }
      if (job.state === 'running') {
        const osImageId = job.payload['osImageId'];
        if (typeof osImageId === 'string') percentByOsId[osImageId] = job.progress;
        if (job.progress !== entry.progress) {
          entry.progress = job.progress;
          toast.update(entry.toastId, { progress: job.progress });
        }
        continue;
      }
      tracked.delete(jobId);
      if (job.state === 'completed') toast.settle(entry.toastId, 'success', entry.success);
      else toast.settle(entry.toastId, 'error', job.error ?? entry.failure);
    }
    useOsDownloadProgress.setState(percentByOsId);
  };
  void poll();
  window.setInterval(() => void poll(), 2000);
}
