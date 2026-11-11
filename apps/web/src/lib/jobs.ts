import type { JobRow } from '@netlabor/contract';
import { client } from './api.ts';

const POLL_START_MS = 250;
const POLL_MAX_MS = 1500;

export class JobFailedError extends Error {
  readonly job: JobRow;

  constructor(job: JobRow) {
    super(job.error ?? `job ${job.id} failed`);
    this.name = 'JobFailedError';
    this.job = job;
  }
}

export class JobCancelledError extends Error {
  readonly job: JobRow;

  constructor(job: JobRow) {
    super('the job was cancelled');
    this.name = 'JobCancelledError';
    this.job = job;
  }
}

/** Poll `jobs.get` until a background job settles; the only job transport. */
export async function waitForJob(
  jobId: string,
  options: {
    signal?: AbortSignal;
    onUpdate?: (job: JobRow) => void;
  } = {},
): Promise<JobRow> {
  let delay = POLL_START_MS;
  for (;;) {
    if (options.signal?.aborted) throw new DOMException('job polling aborted', 'AbortError');
    const job = await client.jobs.get({ id: jobId });
    options.onUpdate?.(job);
    if (job.state === 'completed') return job;
    if (job.state === 'failed') throw new JobFailedError(job);
    if (job.state === 'cancelled') throw new JobCancelledError(job);
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, delay);
    await promise;
    delay = Math.min(delay * 1.5, POLL_MAX_MS);
  }
}

/** Best-effort typed read of a job result field. */
export function jobResultString(job: JobRow, field: string): string | null {
  const value = job.result?.[field];
  return typeof value === 'string' ? value : null;
}

export function triggerDownload(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = '';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
