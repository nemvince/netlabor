import type { ComputeRow, ImageRow } from '@netlabor/contract';
import { DownloadSimpleIcon as Download, PencilIcon as Pencil, ArrowsClockwiseIcon as RefreshCw, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { Badge } from '../../components/badge.tsx';
import { CopyButton } from '../../components/copy-button.tsx';
import { DetailList } from '../../components/detail-list.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { formatBytes } from '../../lib/bytes.ts';
import { formatStamp } from '../../lib/format.ts';
import { Button, buttonVariants } from '@netlabor/ui/components/button';

function replicaTone(state: ImageRow['replicas'][number]['state'] | 'absent') {
  if (state === 'present') return 'up';
  if (state === 'syncing') return 'warn';
  if (state === 'missing') return 'down';
  return 'neutral';
}

/** Image metadata, replica inventory, and the actions that change them. */
export function ImageDetailDialog({
  image,
  computes,
  canWrite,
  canSync,
  onOpenChange,
  onSync,
  onRename,
  onDelete,
}: {
  image: ImageRow;
  computes: ComputeRow[];
  canWrite: boolean;
  canSync: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const close = () => onOpenChange(false);
  const replicaRows =
    computes.length > 0
      ? computes.map((compute) => ({
          computeId: compute.id,
          computeName: compute.name,
          replica: image.replicas.find((row) => row.computeId === compute.id),
        }))
      : image.replicas.map((replica) => ({
          computeId: replica.computeId,
          computeName: replica.computeName,
          replica,
        }));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={image.name}
      description={`${image.kind} · ${formatBytes(image.sizeBytes)} · added ${formatStamp(image.createdAt)}`}
      width={640}
    >
      <div className="flex flex-col gap-4">
        <DetailList
          rows={[
            { label: 'ID', value: <span className="tabular break-all">{image.id}</span> },
            { label: 'Kind', value: image.kind },
            {
              label: 'File',
              value: <span className="tabular break-all">{image.filename}</span>,
            },
            {
              label: 'Size',
              value: <span className="tabular">{formatBytes(image.sizeBytes)}</span>,
            },
            {
              label: 'SHA-256',
              value: (
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  <span className="tabular break-all">{image.sha256}</span>
                  <CopyButton value={image.sha256} label="Copy sha" />
                </span>
              ),
            },
          ]}
        />

        <section>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 className="text-[12px] font-medium">Replicas</h3>
            <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {replicaRows.length} compute(s)
            </span>
          </div>
          <p className="mb-1.5 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
            Compute replicas are caches. The library keeps its own copy on the controller, so
            Download and Sync still work for images with no replica left.
          </p>
          {replicaRows.length === 0 ? (
            <p
              className="rounded-[3px] border border-dashed px-3 py-4 text-[11px]"
              style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-faint)' }}
            >
              The image has no replica on any compute yet. Sync it to make it startable.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {replicaRows.map(({ computeId, computeName, replica }) => {
                const state = replica?.state ?? 'absent';
                return (
                  <li
                    key={computeId}
                    className="rounded-[2px] border px-2.5 py-2"
                    style={{
                      borderColor: 'var(--color-rule)',
                      background: 'var(--color-panel-sunken)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-medium">{computeName}</span>
                      <Badge tone={replicaTone(state)}>{state}</Badge>
                    </div>
                    <div
                      className="tabular mt-0.5 break-all text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {replica?.path ?? 'no path'}
                    </div>
                    <div
                      className="tabular text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      verified {formatStamp(replica?.verifiedAt)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <DialogFooter>
        {canWrite ? (
          <Button type="button" onClick={onDelete} className="mr-auto" variant="destructive" size="sm">
            <Trash2 size={12} aria-hidden /> Delete
          </Button>
        ) : null}
        <Button type="button" onClick={close} variant="outline" size="sm">
          Close
        </Button>
        <a
          href={`/api/blobs/${image.sha256}/${encodeURIComponent(image.filename)}`}
          download
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Download size={12} aria-hidden /> Download
        </a>
        {canSync ? (
          <Button type="button" disabled={computes.length === 0} title={computes.length === 0 ? 'No compute is registered yet' : 'Sync to computes'} onClick={onSync} variant="outline" size="sm">
            <RefreshCw size={12} aria-hidden /> Sync
          </Button>
        ) : null}
        {canWrite ? (
          <Button type="button" onClick={onRename} variant="outline" size="sm">
            <Pencil size={12} aria-hidden /> Rename
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}
