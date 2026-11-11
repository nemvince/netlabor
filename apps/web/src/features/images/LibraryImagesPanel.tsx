import type { ImageKind, ImageRow } from '@netlabor/contract';
import { IMAGE_KINDS } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { HardDrive, Layers, Pencil, RefreshCw, Search, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '../../components/Badge.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Dialog, DialogFooter } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { toast } from '../../components/Toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { useMe } from '../auth/use-me.ts';
import { ImagePruneDialog } from './ImagePruneDialog.tsx';
import { ImageReplicaDrawer } from './ImageReplicaDrawer.tsx';
import { ImageSyncDialog } from './ImageSyncDialog.tsx';
import { ImageUploadDialog } from './ImageUploadDialog.tsx';

function replicaTone(state: ImageRow['replicas'][number]['state'] | 'absent'): BadgeTone {
  if (state === 'present') return 'up';
  if (state === 'syncing') return 'warn';
  if (state === 'missing') return 'down';
  return 'neutral';
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
  const [drawerTarget, setDrawerTarget] = useState<ImageRow | null>(null);
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
      if (drawerTarget?.id === deleteTarget.id) setDrawerTarget(null);
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
        <label className="flex items-center gap-1.5" htmlFor="image-search">
          <Search size={13} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
          <Input
            id="image-search"
            className="h-7 w-64 py-0 text-[12px]"
            placeholder="Search images"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <Select
          aria-label="Filter by image kind"
          className="h-7 w-36 py-0 text-[12px]"
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
        {canWrite ? (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => setPruneOpen(true)}
            >
              <RefreshCw size={13} aria-hidden /> Prune
            </button>
            <button
              type="button"
              className="nb-button"
              data-variant="primary"
              onClick={() => setUploadOpen(true)}
            >
              <UploadCloud size={14} aria-hidden /> Upload image
            </button>
          </span>
        ) : null}
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {images.data?.length ?? 0} image(s)
        </span>
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
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={() => setUploadOpen(true)}
                >
                  <UploadCloud size={14} aria-hidden /> Upload image
                </button>
              ) : null
            }
          />
        ) : (
          <Table label="Images">
            <THead>
              <Th>Image</Th>
              <Th>Kind</Th>
              <Th>File</Th>
              <Th>SHA-256</Th>
              <Th align="right">Size</Th>
              <Th>Created</Th>
              <Th>Replicas</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {images.data.map((image) => (
                <Tr key={image.id}>
                  <Td>
                    <button
                      type="button"
                      className="max-w-[190px] truncate text-left font-medium underline-offset-2 hover:underline"
                      onClick={() => setDrawerTarget(image)}
                      title={image.name}
                    >
                      {image.name}
                    </button>
                    <span
                      className="tabular block text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {image.id.slice(0, 8)}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone="copper">{image.kind}</Badge>
                  </Td>
                  <Td mono>{image.filename}</Td>
                  <Td>
                    <span className="flex items-center gap-1">
                      <span className="tabular text-[10px]" title={image.sha256}>
                        {image.sha256.slice(0, 12)}…
                      </span>
                      <CopyButton value={image.sha256} label="copy" />
                    </span>
                  </Td>
                  <Td mono align="right">
                    {formatBytes(image.sizeBytes)}
                  </Td>
                  <Td mono>{formatStamp(image.createdAt)}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {(computes.data ?? []).length > 0
                        ? computes.data?.map((compute) => {
                            const replica = image.replicas.find(
                              (row) => row.computeId === compute.id,
                            );
                            const state = replica?.state ?? 'absent';
                            return (
                              <button
                                key={compute.id}
                                type="button"
                                title={replica?.path ?? 'no replica'}
                                onClick={() => setDrawerTarget(image)}
                              >
                                <Badge tone={replicaTone(state)}>
                                  {compute.name} {state}
                                </Badge>
                              </button>
                            );
                          })
                        : image.replicas.map((replica) => (
                            <button
                              key={replica.computeId}
                              type="button"
                              title={replica.path ?? 'no path'}
                              onClick={() => setDrawerTarget(image)}
                            >
                              <Badge tone={replicaTone(replica.state)}>
                                {replica.computeName} {replica.state}
                              </Badge>
                            </button>
                          ))}
                      {image.replicas.length === 0 && (computes.data ?? []).length === 0 ? (
                        <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                          none
                        </span>
                      ) : null}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="nb-button"
                        data-size="sm"
                        data-variant="ghost"
                        title="Replica inventory"
                        aria-label={`Replicas for ${image.name}`}
                        onClick={() => setDrawerTarget(image)}
                      >
                        <Layers size={12} aria-hidden />
                      </button>
                      {canSync ? (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          disabled={computes.isPending || computes.isError}
                          title="Sync to computes"
                          aria-label={`Sync ${image.name}`}
                          onClick={() => setSyncTarget(image)}
                        >
                          <RefreshCw size={12} aria-hidden />
                        </button>
                      ) : null}
                      {canWrite ? (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          title="Rename image"
                          aria-label={`Rename ${image.name}`}
                          onClick={() => {
                            setRenameError(null);
                            setRenameValue(image.name);
                            setRenameTarget(image);
                          }}
                        >
                          <Pencil size={12} aria-hidden />
                        </button>
                      ) : null}
                      {canWrite ? (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          title="Delete image"
                          aria-label={`Delete ${image.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteTarget(image);
                          }}
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      ) : null}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
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

      {drawerTarget ? (
        <ImageReplicaDrawer
          image={images.data?.find((image) => image.id === drawerTarget.id) ?? drawerTarget}
          onClose={() => setDrawerTarget(null)}
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
          <button type="button" className="nb-button" onClick={() => setRenameTarget(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            disabled={renaming}
            onClick={() => void performRename()}
          >
            {renaming ? 'Saving…' : 'Rename'}
          </button>
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
