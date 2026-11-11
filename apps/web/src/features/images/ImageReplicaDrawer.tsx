import type { ImageRow } from '@netlabor/contract';
import { X } from 'lucide-react';
import { Badge } from '../../components/Badge.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { formatBytes } from '../../lib/bytes.ts';
import { formatStamp } from '../../lib/format.ts';

/** Replica inventory for one image, shown as a right-hand drawer. */
export function ImageReplicaDrawer({ image, onClose }: { image: ImageRow; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        aria-label="Close replica drawer"
        style={{ background: 'rgba(6, 8, 7, 0.48)' }}
        onClick={onClose}
      />
      <aside
        className="absolute top-0 right-0 flex h-full w-[440px] max-w-[calc(100vw-2rem)] flex-col border-l"
        style={{ borderColor: 'var(--color-rule-strong)', background: 'var(--color-panel)' }}
        role="dialog"
        aria-modal="true"
        aria-label={`Replicas for ${image.name}`}
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-4 py-3"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold">{image.name}</h2>
            <p className="text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
              replica inventory · {image.replicas.length} compute(s)
            </p>
          </div>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-[3px] border"
            style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-dim)' }}
            aria-label="Close replica drawer"
            onClick={onClose}
          >
            <X size={14} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
            <span className="nb-rule-label">Kind</span>
            <span className="tabular">{image.kind}</span>
            <span className="nb-rule-label">File</span>
            <span className="tabular break-all">{image.filename}</span>
            <span className="nb-rule-label">Size</span>
            <span className="tabular">{formatBytes(image.sizeBytes)}</span>
            <span className="nb-rule-label">Created</span>
            <span className="tabular">{formatStamp(image.createdAt)}</span>
            <span className="nb-rule-label">SHA-256</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="tabular break-all">{image.sha256}</span>
              <CopyButton value={image.sha256} label="Copy sha" />
            </span>
          </div>

          <div className="mt-4">
            <div className="nb-rule-label mb-1">Replicas</div>
            {image.replicas.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                The image has no replica on any compute yet. Sync it to make it startable.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {image.replicas.map((replica) => (
                  <li
                    key={replica.computeId}
                    className="rounded-[2px] border px-2 py-1.5"
                    style={{
                      borderColor: 'var(--color-rule)',
                      background: 'var(--color-panel-sunken)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12px] font-medium">
                        {replica.computeName}
                      </span>
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
                    </div>
                    <div
                      className="tabular mt-0.5 break-all text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {replica.path ?? 'no path'}
                    </div>
                    <div
                      className="tabular text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      verified {formatStamp(replica.verifiedAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
