import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Camera, Download, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogFooter } from '../../components/Dialog.tsx';
import { Field, Input } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { triggerDownload, waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/queryClient.ts';

const snapshotSchema = z.object({
  name: z.string().min(1, 'enter a snapshot name').max(128, 'use at most 128 characters'),
  description: z.string().max(2000, 'use at most 2000 characters'),
});

type SnapshotValues = z.infer<typeof snapshotSchema>;

interface BusyJob {
  kind: 'create' | 'restore';
  progress: number;
  state: string;
}

function invalidateProject() {
  void queryClient.invalidateQueries({ queryKey: orpc.snapshots.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.drawings.list.key() });
}

/** Snapshot create, restore, download, and delete, each create/restore job-polled. */
export function SnapshotsDialog({
  projectId,
  onOpenChange,
}: {
  projectId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [job, setJob] = useState<BusyJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const snapshots = useQuery(orpc.snapshots.list.queryOptions({ input: { projectId } }));
  const form = useForm<SnapshotValues>({
    resolver: zodResolver(snapshotSchema),
    defaultValues: { name: '', description: '' },
  });

  const remove = useMutation({
    ...orpc.snapshots.delete.mutationOptions(),
    onSuccess: () => {
      setDeleteConfirmId(null);
      invalidateProject();
    },
    onError: (deleteError) => setError(messageOf(deleteError)),
  });

  async function track(
    kind: BusyJob['kind'],
    jobId: string,
    successMessage: string,
  ): Promise<void> {
    setJob({ kind, progress: 0, state: 'running' });
    setError(null);
    setNotice(null);
    try {
      await waitForJob(jobId, {
        onUpdate: (update) =>
          setJob({ kind, progress: Math.round(update.progress), state: update.state }),
      });
      setJob(null);
      setNotice(successMessage);
      invalidateProject();
    } catch (jobError) {
      setJob(null);
      setError(messageOf(jobError));
    }
  }

  async function createSnapshot(values: SnapshotValues) {
    setError(null);
    try {
      const started = await client.snapshots.create({
        projectId,
        name: values.name.trim(),
        description: values.description.trim() === '' ? null : values.description.trim(),
      });
      form.reset({ name: '', description: '' });
      await track('create', started.id, `Snapshot "${values.name.trim()}" created.`);
    } catch (createError) {
      setError(messageOf(createError));
    }
  }

  async function restoreSnapshot(snapshotId: string, name: string) {
    setError(null);
    try {
      const started = await client.snapshots.restore({ id: snapshotId });
      await track('restore', started.id, `Restored snapshot "${name}".`);
    } catch (restoreError) {
      setError(messageOf(restoreError));
    }
  }

  async function downloadSnapshot(snapshotId: string) {
    setError(null);
    try {
      const result = await client.snapshots.download({ id: snapshotId });
      triggerDownload(result.downloadUrl);
    } catch (downloadError) {
      setError(messageOf(downloadError));
    }
  }

  const busy = job !== null;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Snapshots"
      description="A snapshot stops nodes, archives each compute's project slice, and pauses the project while it runs."
      width={680}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}
        {job ? (
          <Notice tone="info">
            {job.kind === 'create' ? 'Creating snapshot' : 'Restoring snapshot'} · {job.progress}% ·{' '}
            {job.state}
          </Notice>
        ) : null}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            void form.handleSubmit(createSnapshot)(event);
          }}
        >
          <div className="min-w-[180px] flex-1">
            <Field
              label="Snapshot name"
              htmlFor="snapshot-name"
              error={form.formState.errors.name?.message}
            >
              <Input
                id="snapshot-name"
                className="py-1 text-[12px]"
                placeholder="before-change"
                disabled={busy}
                {...form.register('name')}
              />
            </Field>
          </div>
          <div className="min-w-[220px] flex-[2]">
            <Field label="Description" htmlFor="snapshot-description">
              <Input
                id="snapshot-description"
                className="py-1 text-[12px]"
                placeholder="optional"
                disabled={busy}
                {...form.register('description')}
              />
            </Field>
          </div>
          <button type="submit" className="nb-button" data-variant="primary" disabled={busy}>
            <Camera size={13} aria-hidden /> {busy ? 'Working…' : 'Create snapshot'}
          </button>
        </form>

        {snapshots.isPending ? (
          <Loading label="Reading snapshots…" />
        ) : snapshots.isError ? (
          <Notice tone="error">{messageOf(snapshots.error)}</Notice>
        ) : snapshots.data.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
            No snapshots yet.
          </p>
        ) : (
          <Table label="Project snapshots">
            <THead>
              <Th>Snapshot</Th>
              <Th>Created</Th>
              <Th align="right">Size</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {snapshots.data.map((snapshot) => (
                <Tr key={snapshot.id}>
                  <Td>
                    <span className="font-medium">{snapshot.name}</span>
                    {snapshot.description ? (
                      <span
                        className="block max-w-[300px] truncate text-[10px]"
                        style={{ color: 'var(--color-ink-faint)' }}
                        title={snapshot.description}
                      >
                        {snapshot.description}
                      </span>
                    ) : null}
                    <span
                      className="tabular block text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {snapshot.sha256.slice(0, 12)}
                    </span>
                  </Td>
                  <Td mono>{formatStamp(snapshot.createdAt)}</Td>
                  <Td mono align="right">
                    {formatBytes(snapshot.sizeBytes)}
                  </Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="nb-button"
                        data-size="sm"
                        data-variant="ghost"
                        title={`Restore ${snapshot.name}`}
                        aria-label={`Restore ${snapshot.name}`}
                        disabled={busy}
                        onClick={() => void restoreSnapshot(snapshot.id, snapshot.name)}
                      >
                        <RotateCcw size={12} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="nb-button"
                        data-size="sm"
                        data-variant="ghost"
                        title={`Download ${snapshot.name}`}
                        aria-label={`Download ${snapshot.name}`}
                        onClick={() => void downloadSnapshot(snapshot.id)}
                      >
                        <Download size={12} aria-hidden />
                      </button>
                      {deleteConfirmId === snapshot.id ? (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="danger"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: snapshot.id })}
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          title={`Delete ${snapshot.name}`}
                          aria-label={`Delete ${snapshot.name}`}
                          onClick={() => setDeleteConfirmId(snapshot.id)}
                        >
                          <Trash2 size={12} aria-hidden />
                        </button>
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
