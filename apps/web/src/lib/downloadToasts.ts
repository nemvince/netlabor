/**
 * App-wide tracker for OS-image download jobs. Downloads run as controller
 * jobs that keep going regardless of the page they were started from; this
 * keeps a progress toast alive app-wide and settles it when the job ends.
 */

import type { JobRow } from '@netlabor/contract';
import { create } from 'zustand';
import { toast } from '../components/Toast.tsx';
import { client } from './api.ts';
import { messageOf } from './errors.ts';

/** osImageId → download percent; panels read this instead of tracking jobs. */
export const useOsDownloadProgress = create<Record<string, number>>(() => ({}));

interface TrackedDownload {
  toastId: number;
  name: string;
  /** last reported percent, to skip identical updates */
  progress: number | null;
}

const tracked = new Map<string, TrackedDownload>();

let started = false;

function jobName(job: JobRow): string {
  const name = job.payload['name'];
  return typeof name === 'string' && name !== '' ? name : 'OS image';
}

/** Attach a progress toast to a running os.download job. */
export function trackOsDownload(job: JobRow): void {
  if (tracked.has(job.id)) return;
  const name = jobName(job);
  tracked.set(job.id, {
    toastId: toast.progress(`Downloading ${name}…`, job.progress),
    name,
    progress: job.progress,
  });
}

/** Attach toasts to every running download job; call once on app mount. */
export function startDownloadTracking(): void {
  if (started) return;
  started = true;
  const poll = async (): Promise<void> => {
    if (tracked.size === 0) return;
    let running: JobRow[];
    try {
      running = await client.jobs.list({ kind: 'os.download', state: 'running', limit: 50 });
    } catch {
      return;
    }
    const runningIds = new Set(running.map((job) => job.id));
    const percentByOsId: Record<string, number> = {};
    for (const job of running) {
      trackOsDownload(job);
      const osImageId = job.payload['osImageId'];
      if (typeof osImageId === 'string') percentByOsId[osImageId] = job.progress;
      const entry = tracked.get(job.id);
      if (entry && job.progress !== entry.progress) {
        entry.progress = job.progress;
        toast.update(entry.toastId, { progress: job.progress });
      }
    }
    useOsDownloadProgress.setState(percentByOsId);
    // Jobs that left the running list have settled; fetch their outcome.
    for (const [jobId, entry] of tracked) {
      if (runningIds.has(jobId)) continue;
      tracked.delete(jobId);
      try {
        const job = await client.jobs.get({ id: jobId });
        if (job.state === 'completed') {
          toast.settle(entry.toastId, 'success', `Downloaded ${entry.name}.`);
        } else {
          toast.settle(entry.toastId, 'error', `Download failed: ${job.error ?? 'cancelled'}`);
        }
      } catch (error) {
        toast.settle(entry.toastId, 'error', `Download failed: ${messageOf(error)}`);
      }
    }
  };
  void poll();
  window.setInterval(() => void poll(), 2000);
}
