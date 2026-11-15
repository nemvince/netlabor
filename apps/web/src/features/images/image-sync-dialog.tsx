import type { ComputeRow, ImageRow, JobRow } from '@netlabor/contract';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge } from '../../components/badge.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Notice } from '../../components/notice.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/query-client.ts';

/** Replicate one image to selected computes and poll the resulting job. */
export function ImageSyncDialog({
  image,
  computes,
  onOpenChange,
  onChanged,
}: {
  image: ImageRow;
  computes: ComputeRow[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const missing = computes.filter(
    (compute) => !image.replicas.some((replica) => replica.computeId === compute.id),
  );
  const [selected, setSelected] = useState<Set<string>>(
    new Set(missing.length > 0 ? missing.map((compute) => compute.id) : []),
  );
  const [job, setJob] = useState<JobRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  function toggle(computeId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(computeId)) next.delete(computeId);
      else next.add(computeId);
      return next;
    });
  }

  async function run() {
    if (selected.size === 0) {
      setError('Select at least one compute.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    setJob(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const created = await client.images.sync({
        imageId: image.id,
        computeIds: [...selected],
      });
      setJob(created);
      const completed = await waitForJob(created.id, {
        signal: controller.signal,
        onUpdate: setJob,
      });
      setJob(completed);
      setNotice('Sync completed.');
      void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
      onChanged();
    } catch (syncError) {
      setError(messageOf(syncError));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function cancel() {
    if (!job) return;
    try {
      await client.jobs.cancel({ id: job.id });
    } catch (cancelError) {
      setError(messageOf(cancelError));
    }
    abortRef.current?.abort();
    setBusy(false);
  }

  const progress = job?.progress ?? 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false);
      }}
      title={`Sync ${image.name}`}
      description="The controller copies the blob from a peer or the staging store."
      width={620}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        <ul
          className="overflow-hidden rounded-[3px] border"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          {computes.map((compute) => {
            const replica = image.replicas.find((row) => row.computeId === compute.id);
            return (
              <li
                key={compute.id}
                className="flex items-center gap-2 border-b px-2 py-1.5 last:border-b-0"
                style={{ borderColor: 'var(--color-rule)' }}
              >
                <input
                  type="checkbox"
                  id={`sync-${compute.id}`}
                  className="size-3.5"
                  style={{ accentColor: 'var(--color-copper)' }}
                  checked={selected.has(compute.id)}
                  disabled={busy}
                  onChange={() => toggle(compute.id)}
                />
                <label htmlFor={`sync-${compute.id}`} className="flex-1 text-[12px]">
                  {compute.name}
                  <span
                    className="tabular ml-2 text-[10px]"
                    style={{ color: 'var(--color-ink-faint)' }}
                  >
                    {compute.status}
                  </span>
                </label>
                {replica ? (
                  <Badge
                    tone={
                      replica.state === 'present'
                        ? 'up'
                        : replica.state === 'syncing'
                          ? 'warn'
                          : 'down'
                    }
                  >
                    {replica.state}
                  </Badge>
                ) : (
                  <Badge tone="neutral">absent</Badge>
                )}
              </li>
            );
          })}
          {computes.length === 0 ? (
            <li className="px-3 py-3 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              No computes are available.
            </li>
          ) : null}
        </ul>

        {job ? (
          <div
            className="rounded-[3px] border px-2 py-1.5"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
          >
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1">
                {job.state === 'completed' ? (
                  <CheckCircle2 size={12} aria-hidden style={{ color: 'var(--color-signal-up)' }} />
                ) : job.state === 'failed' || job.state === 'cancelled' ? (
                  <XCircle size={12} aria-hidden style={{ color: 'var(--color-signal-down)' }} />
                ) : (
                  <RefreshCw
                    size={12}
                    className="animate-spin"
                    aria-hidden
                    style={{ color: 'var(--color-copper)' }}
                  />
                )}
                <span className="tabular">{job.state}</span>
              </span>
              <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                job {job.id.slice(0, 8)} · {progress.toFixed(0)}%
              </span>
            </div>
            <div
              className="mt-1 h-1 overflow-hidden rounded-full"
              style={{ background: 'var(--color-panel)' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <div
                className="h-full"
                style={{ width: `${Math.max(2, progress)}%`, background: 'var(--color-copper)' }}
              />
            </div>
            {job.error ? (
              <p className="mt-1 text-[11px]" style={{ color: 'var(--color-signal-down)' }}>
                {job.error}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            className="nb-button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
          {busy && job ? (
            <button
              type="button"
              className="nb-button"
              data-variant="danger"
              onClick={() => void cancel()}
            >
              Cancel job
            </button>
          ) : null}
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            disabled={busy || selected.size === 0}
            onClick={() => void run()}
          >
            {busy ? 'Syncing…' : 'Sync image'}
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
