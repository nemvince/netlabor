import type { ComputeRow, ImageKind, ImageRow } from '@netlabor/contract';
import { IMAGE_KINDS } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import {
  FileTextIcon as FileText,
  HardDriveIcon as HardDrive,
  ArrowsClockwiseIcon as RefreshCw,
  CloudArrowUpIcon as UploadCloud,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { SearchInput } from '../../components/search-input.tsx';
import { toast } from '../../components/toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';
import { useMe } from '../auth/use-me.ts';
import { ImageDetailDialog } from './image-detail-dialog.tsx';
import { ImagePruneDialog } from './image-prune-dialog.tsx';
import { ImageSyncDialog } from './image-sync-dialog.tsx';
import { ImageUploadDialog } from './image-upload-dialog.tsx';
import { Button } from '@netlabor/ui/components/button';

function replicaSummary(
  image: ImageRow,
  computes: ComputeRow[],
): { label: string; tone: BadgeTone } {
  const states =
    computes.length > 0
      ? computes.map(
          (compute) =>
            image.replicas.find((replica) => replica.computeId === compute.id)?.state ?? 'absent',
        )
      : image.replicas.map((replica) => replica.state);
  if (states.length === 0) return { label: 'no replicas', tone: 'neutral' };
  const present = states.filter((state) => state === 'present').length;
  return {
    label: `${present}/${states.length} on computes`,
    tone: present === states.length ? 'up' : 'warn',
  };
}

/** Library images: upload, rename, replicas, sync, and prune. */
export function LibraryImagesPanel() {
  const { can } = useMe();
  const canWrite = can('image.write');
  const canSync = can('image.sync');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | ImageKind>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [syncTarget, setSyncTarget] = useState<ImageRow | null>(null);
  const [detailTarget, setDetailTarget] = useState<ImageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ImageRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [renameTarget, setRenameTarget] = useState<ImageRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<unknown>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const images = useQuery(
    orpc.images.list.queryOptions({
      input: {
        limit: 200,
        offset: 0,
        ...(query === '' ? {} : { search: query }),
        ...(kind === 'all' ? {} : { kind }),
      },
    }),
  );
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    enabled: can('compute.read'),
    retry: false,
  });

  function invalidateImages() {
    void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
  }

  async function performRename() {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (name === '') {
      setRenameError(new Error('enter an image name'));
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      const updated = await client.images.update({ id: renameTarget.id, name });
      setRenameTarget(null);
      toast.success(`${updated.name} renamed.`);
      void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
    } catch (error) {
      setRenameError(error);
    } finally {
      setRenaming(false);
    }
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.images.delete({ id: deleteTarget.id });
      setDeleteTarget(null);
      if (detailTarget?.id === deleteTarget.id) setDetailTarget(null);
      toast.success(`${deleteTarget.name} deleted.`);
      invalidateImages();
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          id="image-search"
          label="Search images"
          placeholder="Search images"
          wrapperStyle={{ width: 256 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by image kind"
          className="h-7 py-0 text-[12px]"
          style={{ width: 144 }}
          value={kind}
          onChange={(event) => setKind(event.target.value as 'all' | ImageKind)}
        >
          <option value="all">all kinds</option>
          {IMAGE_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {images.data?.length ?? 0} image(s)
        </span>
        {canWrite ? (
          <span className="ml-auto flex items-center gap-2">
            <Button type="button" onClick={() => setPruneOpen(true)} variant="outline" size="xs">
              <RefreshCw size={13} aria-hidden /> Prune
            </Button>
            <Button type="button" onClick={() => setUploadOpen(true)} variant="default" size="sm">
              <UploadCloud size={14} aria-hidden /> Upload image
            </Button>
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        {images.isPending ? (
          <Loading label="Reading images…" />
        ) : images.isError ? (
          <EmptyState
            icon={HardDrive}
            title="Images could not be read"
            description={messageOf(images.error)}
          />
        ) : images.data.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title={query === '' && kind === 'all' ? 'No images uploaded' : 'No image matches'}
            description="Upload a qcow2, IOU, or Dynamips image. The controller hashes it and replicates it on demand."
            action={
              canWrite ? (
                <Button
                  type="button"
                  onClick={() => setUploadOpen(true)}
                  variant="default"
                  size="sm"
                >
                  <UploadCloud size={14} aria-hidden /> Upload image
                </Button>
              ) : null
            }
          />
        ) : (
          <div
            className="overflow-hidden rounded-[3px] border"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
          >
            <ul>
              {images.data.map((image) => {
                const summary = replicaSummary(image, computes.data ?? []);
                return (
                  <li
                    key={image.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 last:border-b-0"
                    style={{ borderColor: 'var(--color-rule)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        className="max-w-full truncate text-left text-[13px] font-medium underline-offset-2 hover:underline"
                        onClick={() => setDetailTarget(image)}
                        title={`Open details for ${image.name}`}
                      >
                        {image.name}
                      </button>
                      <p
                        className="tabular mt-0.5 truncate text-[10px]"
                        style={{ color: 'var(--color-ink-faint)' }}
                        title={image.filename}
                      >
                        {image.kind} · {image.filename} · {formatBytes(image.sizeBytes)} ·{' '}
                        {formatStamp(image.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={summary.tone}>{summary.label}</Badge>
                      <Button
                        type="button"
                        aria-label={`Details for ${image.name}`}
                        title="Image details, replicas, and actions"
                        onClick={() => setDetailTarget(image)}
                        variant="ghost"
                        size="xs"
                      >
                        <FileText size={12} aria-hidden /> Details
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {uploadOpen ? (
        <ImageUploadDialog
          onOpenChange={setUploadOpen}
          onCreated={(image) => {
            setUploadOpen(false);
            toast.success(`${image.name} uploaded with ${image.replicas.length} replica(s).`);
            invalidateImages();
            void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
          }}
        />
      ) : null}

      {syncTarget && computes.data ? (
        <ImageSyncDialog
          image={syncTarget}
          computes={computes.data}
          onOpenChange={(open) => {
            if (!open) setSyncTarget(null);
          }}
          onChanged={() => {
            invalidateImages();
            toast.success('Image replicas updated.');
          }}
        />
      ) : null}

      {pruneOpen ? (
        <ImagePruneDialog
          onOpenChange={setPruneOpen}
          onChanged={() => {
            invalidateImages();
            toast.success('Prune completed.');
          }}
        />
      ) : null}

      {detailTarget ? (
        <ImageDetailDialog
          image={images.data?.find((image) => image.id === detailTarget.id) ?? detailTarget}
          computes={computes.data ?? []}
          canWrite={canWrite}
          canSync={canSync}
          onOpenChange={(open) => {
            if (!open) setDetailTarget(null);
          }}
          onSync={() => {
            setDetailTarget(null);
            setSyncTarget(detailTarget);
          }}
          onRename={() => {
            setDetailTarget(null);
            setRenameError(null);
            setRenameValue(detailTarget.name);
            setRenameTarget(detailTarget);
          }}
          onDelete={() => {
            setDetailTarget(null);
            setDeleteError(null);
            setDeleteTarget(detailTarget);
          }}
        />
      ) : null}

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameError(null);
          }
        }}
        title={`Rename ${renameTarget?.name ?? 'image'}`}
        description="The stored file and replicas keep their hashes; only the library label changes."
      >
        <div className="px-5 py-4">
          <Input
            aria-label="Image name"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
          />
          {renameError ? <Notice tone="error">{messageOf(renameError)}</Notice> : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => setRenameTarget(null)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={renaming}
            onClick={() => void performRename()}
            variant="default"
            size="sm"
          >
            {renaming ? 'Saving…' : 'Rename'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Delete ${deleteTarget?.name ?? 'image'}?`}
        description="The image and every replica are removed. Running nodes keep it locked; stopped nodes and template requirements are released."
        confirmLabel="Delete image"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void performDelete()}
      />
    </div>
  );
}
