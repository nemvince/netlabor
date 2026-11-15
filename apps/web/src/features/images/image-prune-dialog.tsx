import type { JobRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircleIcon as CheckCircle2,
  ArrowsClockwiseIcon as RefreshCw,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Notice } from '../../components/notice.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/query-client.ts';
import { Button } from '@netlabor/ui/components/button';

const PruneImageSchema = z.object({
  imageId: z.string(),
  name: z.string(),
  sha256: z.string(),
  replicas: z.array(
    z.object({
      computeId: z.string(),
      computeName: z.string(),
      path: z.string().nullable(),
    }),
  ),
});

const PruneResultSchema = z.object({
  dryRun: z.boolean(),
  images: z.array(PruneImageSchema).optional(),
  removed: z.array(z.object({ imageId: z.string(), computeId: z.string() })).optional(),
});

/** Prune unreferenced replicas: dry-run preview, then an explicit real run. */
export function ImagePruneDialog({
  onOpenChange,
  onChanged,
}: {
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [job, setJob] = useState<JobRow | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof PruneResultSchema> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'preview' | 'prune'>('preview');
  const started = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    retry: false,
  });
  const computeNames = new Map((computes.data ?? []).map((compute) => [compute.id, compute.name]));

  const run = useCallback(
    async (dryRun: boolean) => {
      setBusy(true);
      setError(null);
      if (!dryRun) setNotice(null);
      setPhase(dryRun ? 'preview' : 'prune');
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const created = await client.images.prune({ dryRun });
        setJob(created);
        const completed = await waitForJob(created.id, {
          signal: controller.signal,
          onUpdate: setJob,
        });
        const parsed = PruneResultSchema.safeParse(completed.result);
        if (parsed.success) setPreview(parsed.data);
        if (!dryRun) {
          setNotice('Prune completed.');
          void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
          void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
          onChanged();
        }
      } catch (pruneError) {
        setError(messageOf(pruneError));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [onChanged],
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run(true);
  }, [run]);

  const candidates = preview?.images ?? [];
  const removable = candidates.reduce((sum, image) => sum + image.replicas.length, 0);
  const progress = job?.progress ?? 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onOpenChange(false);
      }}
      title="Prune image replicas"
      description="Only replicas not referenced by a node or template are candidates. The library copy stays on the controller and remains downloadable."
      width={760}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={phase === 'prune' ? 'warn' : 'info'}>
            {phase === 'preview' ? 'dry-run preview' : 'real prune'}
          </Badge>
          <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
            {candidates.length} image(s) · {removable} replica(s)
          </span>
          <span className="ml-auto flex items-center gap-1 text-[11px]">
            {busy ? (
              <RefreshCw
                size={12}
                className="animate-spin"
                aria-hidden
                style={{ color: 'var(--color-copper)' }}
              />
            ) : job?.state === 'failed' ? (
              <XCircle size={12} aria-hidden style={{ color: 'var(--color-signal-down)' }} />
            ) : (
              <CheckCircle2 size={12} aria-hidden style={{ color: 'var(--color-signal-up)' }} />
            )}
            <span className="tabular">
              {busy ? `${progress.toFixed(0)}%` : (job?.state ?? 'idle')}
            </span>
          </span>
        </div>
        {busy ? (
          <div
            className="h-1 overflow-hidden rounded-full"
            style={{ background: 'var(--color-panel-sunken)' }}
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
        ) : null}

        {job?.error ? <Notice tone="error">{job.error}</Notice> : null}

        {candidates.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
            {phase === 'prune'
              ? 'No candidates remained after the prune.'
              : 'No unreferenced replicas are available to prune.'}
          </p>
        ) : (
          <Table label="Prune candidates">
            <THead>
              <Th>Image</Th>
              <Th>SHA-256</Th>
              <Th>Replicas</Th>
            </THead>
            <TBody>
              {candidates.map((image) => (
                <Tr key={image.imageId}>
                  <Td>{image.name}</Td>
                  <Td mono title={image.sha256}>
                    {image.sha256.slice(0, 12)}…
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {image.replicas.map((replica) => (
                        <Badge key={replica.computeId} tone="warn">
                          {replica.computeName ||
                            computeNames.get(replica.computeId) ||
                            replica.computeId.slice(0, 8)}
                        </Badge>
                      ))}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}

        {preview?.removed && preview.removed.length > 0 ? (
          <Notice tone="success">
            Removed {preview.removed.length} replica(s) across {candidates.length} image(s).
          </Notice>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            variant="outline"
            size="sm"
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              setJob(null);
              void run(true);
            }}
            variant="outline"
            size="sm"
          >
            Re-run dry run
          </Button>
          <Button
            type="button"
            disabled={busy || removable === 0}
            onClick={() => void run(false)}
            variant="destructive"
            size="sm"
          >
            <Trash2 size={12} aria-hidden /> Prune {removable} replica(s)
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
