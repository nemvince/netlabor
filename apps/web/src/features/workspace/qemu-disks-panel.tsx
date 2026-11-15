import type { NodeRow } from '@netlabor/contract';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDriveIcon as HardDrive, ArrowsOutIcon as Maximize2, PlusIcon as Plus, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Field, Input } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { toast } from '../../components/toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';

const DISKS = ['hda', 'hdb', 'hdc', 'hdd'] as const;
type Disk = (typeof DISKS)[number];
type DiskAction = 'create' | 'resize' | 'delete';

const MIB = 1024 * 1024;
const MAX_MIB = 1024 * 1024;

/** Parse a whole number of MiB from a text field; null when out of range. */
function parseMiB(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_MIB ? value : null;
}

/**
 * Blank QEMU disk management for a stopped node. hda-hdd map to
 * `<node dir>/<disk>.qcow2` on the agent; the controller rejects calls while
 * the node runs.
 */
export function QemuDisksPanel({
  node,
  canUpdate,
  canListFiles,
}: {
  node: NodeRow;
  canUpdate: boolean;
  canListFiles: boolean;
}) {
  const queryClient = useQueryClient();
  const [sizes, setSizes] = useState<Record<Disk, string>>({
    hda: '512',
    hdb: '512',
    hdc: '512',
    hdd: '512',
  });
  const [results, setResults] = useState<
    Partial<Record<Disk, { path: string; sizeBytes: number }>>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ disk: Disk; action: 'create' | 'delete' } | null>(null);

  const files = useQuery({
    ...orpc.nodes.files.list.queryOptions({ input: { nodeId: node.id, path: '' } }),
    enabled: canListFiles,
    retry: false,
  });

  const present = new Map<Disk, number>();
  for (const entry of files.data ?? []) {
    if (entry.directory) continue;
    const match = /^(hda|hdb|hdc|hdd)\.qcow2$/.exec(entry.path);
    if (match?.[1]) present.set(match[1] as Disk, entry.sizeBytes);
  }

  const stopped = node.status === 'stopped';
  const existenceKnown = canListFiles && files.isSuccess;
  const locked = !canUpdate || !stopped || busy !== null;

  async function run(disk: Disk, action: DiskAction) {
    const sizeMiB = action === 'delete' ? null : parseMiB(sizes[disk]);
    if (action !== 'delete' && sizeMiB === null) {
      setError(`Set ${disk} to a whole number of MiB between 1 and ${MAX_MIB}.`);
      return;
    }
    setBusy(`${disk}:${action}`);
    setError(null);
    try {
      if (action === 'delete') {
        await client.nodes.qemu.diskImage.delete({ nodeId: node.id, disk });
        setResults((current) => {
          const next = { ...current };
          delete next[disk];
          return next;
        });
        toast.success(`${disk}.qcow2 deleted from ${node.name}.`);
      } else {
        const output =
          action === 'create'
            ? await client.nodes.qemu.diskImage.create({
                nodeId: node.id,
                disk,
                sizeBytes: (sizeMiB as number) * MIB,
              })
            : await client.nodes.qemu.diskImage.resize({
                nodeId: node.id,
                disk,
                sizeBytes: (sizeMiB as number) * MIB,
              });
        setResults((current) => {
          const next = { ...current };
          next[disk] = output;
          return next;
        });
        toast.success(
          `${disk}.qcow2 ${action === 'create' ? 'created' : 'resized'} at ${sizeMiB} MiB.`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
      if (canListFiles) {
        void queryClient.invalidateQueries({ queryKey: orpc.nodes.files.list.key() });
      }
    } catch (runError) {
      setError(messageOf(runError));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="mt-1 flex flex-col gap-2 border-t pt-2"
      style={{ borderColor: 'var(--color-rule)' }}
      aria-label="QEMU disks"
    >
      <div className="flex items-center justify-between">
        <span className="nb-rule-label flex items-center gap-1">
          <HardDrive size={12} aria-hidden /> Disks
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          blank qcow2 images
        </span>
      </div>
      {!stopped ? (
        <Notice tone="warn">Stop {node.name} before creating, resizing, or deleting disks.</Notice>
      ) : !canUpdate ? (
        <Notice tone="warn">Changing disks requires the node.update privilege.</Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {canListFiles && files.isError ? (
        <Notice tone="warn">
          Existing disk files could not be listed: {messageOf(files.error)}
        </Notice>
      ) : null}

      {DISKS.map((disk) => {
        // Prefer the live file listing; fall back to the last call result.
        const sizeBytes = present.get(disk) ?? results[disk]?.sizeBytes;
        const path = results[disk]?.path;
        const exists = present.has(disk) || results[disk] !== undefined;
        return (
          <div
            key={disk}
            className="flex flex-col gap-1 rounded-[3px] border px-2 py-1.5"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="tabular font-medium">{disk}.qcow2</span>
              <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                {sizeBytes === undefined
                  ? 'not present'
                  : `present · file ${formatBytes(sizeBytes)}`}
              </span>
            </div>
            {path ? (
              <div
                className="tabular truncate text-[10px]"
                title={path}
                style={{ color: 'var(--color-ink-faint)' }}
              >
                {path}
              </div>
            ) : null}
            <div className="flex items-end gap-1.5">
              <Field label="Size (MiB)" htmlFor={`disk-${disk}-size`}>
                <Input
                  id={`disk-${disk}-size`}
                  type="number"
                  min={1}
                  max={MAX_MIB}
                  step={1}
                  className="tabular w-24 py-1 text-[11px]"
                  inputMode="numeric"
                  disabled={locked}
                  value={sizes[disk]}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault();
                  }}
                  onChange={(event) =>
                    setSizes((current) => ({ ...current, [disk]: event.target.value }))
                  }
                />
              </Field>
              <div className="flex flex-1 flex-wrap justify-end gap-1">
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={locked}
                  onClick={() => {
                    if (!existenceKnown || exists) setConfirm({ disk, action: 'create' });
                    else void run(disk, 'create');
                  }}
                >
                  <Plus size={12} aria-hidden />
                  {busy === `${disk}:create` ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={locked}
                  onClick={() => void run(disk, 'resize')}
                >
                  <Maximize2 size={12} aria-hidden />
                  {busy === `${disk}:resize` ? 'Resizing…' : 'Resize'}
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  disabled={locked}
                  onClick={() => setConfirm({ disk, action: 'delete' })}
                >
                  <Trash2 size={12} aria-hidden />
                  {busy === `${disk}:delete` ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-[10px] leading-[1.5]" style={{ color: 'var(--color-ink-faint)' }}>
        Disks are blank qcow2 files in the node directory on {node.computeName}. Existing blank
        disks are listed when you have the node.files privilege.
      </p>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm === null
            ? 'Disk action'
            : confirm.action === 'delete'
              ? `Delete ${confirm.disk}.qcow2`
              : `Create ${confirm.disk}.qcow2`
        }
        description={
          confirm === null
            ? ''
            : confirm.action === 'delete'
              ? `This removes the blank disk file from ${node.name} on ${node.computeName}. Any data on it is lost.`
              : `Creating writes an empty image at ${confirm.disk}.qcow2 and replaces any existing file. Data on the disk is lost.`
        }
        confirmLabel={confirm?.action === 'delete' ? 'Delete disk' : 'Create disk'}
        pending={busy !== null}
        onConfirm={() => {
          if (confirm === null) return;
          const { disk, action } = confirm;
          setConfirm(null);
          void run(disk, action);
        }}
      />
    </section>
  );
}
