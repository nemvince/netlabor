import type { ApplianceBuildRow, JobRow, OsFamily, OsImageRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Download,
  HardDriveDownload,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { toast } from '../../components/Toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { shortId } from '../../lib/format.ts';
import { waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/queryClient.ts';
import {
  AdoptOsImageDialog,
  ApplianceBuildDialog,
  BuildTemplateDialog,
  OsImageCreateDialog,
} from './ApplianceDialogs.tsx';
import {
  BUILD_STATUS_TONE,
  desktopLabel,
  type OsArtifactState,
  osArtifactState,
} from './appliance-meta.ts';

function OsStateCell({
  state,
  row,
  progress,
}: {
  state: OsArtifactState;
  row: OsImageRow;
  progress: number | null;
}) {
  if (state === 'ready') {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="up">artifact ready</Badge>
        <Link
          to="/images"
          className="tabular text-[10px] underline-offset-2 hover:underline"
          style={{ color: 'var(--color-ink-faint)' }}
          title="Open the image library"
        >
          image {shortId(row.imageId)}
        </Link>
      </div>
    );
  }
  if (state === 'downloading') {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="warn">downloading</Badge>
        {progress !== null ? (
          <>
            <div
              className="h-1 w-28 overflow-hidden rounded-full"
              style={{ background: 'var(--color-panel-sunken)' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <div
                className="h-full"
                style={{
                  width: `${Math.max(2, Math.min(100, progress))}%`,
                  background: 'var(--color-copper)',
                }}
              />
            </div>
            <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {Math.round(progress)}%
            </span>
          </>
        ) : null}
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="down">download failed</Badge>
        {row.error ? (
          <span
            className="max-w-52 truncate text-[10px]"
            title={row.error}
            style={{ color: 'var(--color-signal-down)' }}
          >
            {row.error}
          </span>
        ) : null}
      </div>
    );
  }
  return <Badge tone="neutral">needs download</Badge>;
}

function BuildLogTail({ build }: { build: ApplianceBuildRow }) {
  if (!build.log) {
    return (
      <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        no log yet
      </span>
    );
  }
  const lines = build.log.split('\n');
  const tail = lines.slice(-40).join('\n');
  const trimmed = lines.length > 40;
  return (
    <details className="max-w-lg">
      <summary className="cursor-pointer text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
        log tail{trimmed ? ` (last 40 of ${lines.length} lines)` : ''}
      </summary>
      <pre
        className="tabular mt-1 max-h-40 overflow-auto rounded-[2px] border px-2 py-1 text-[10px] leading-[1.5]"
        style={{
          borderColor: 'var(--color-rule)',
          background: 'var(--color-panel-sunken)',
          color: 'var(--color-ink-dim)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {tail}
      </pre>
    </details>
  );
}

function BuildsTable({
  builds,
  canCreateTemplates,
  cancelling,
  onCancel,
  onCreateTemplate,
}: {
  builds: ApplianceBuildRow[];
  canCreateTemplates: boolean;
  cancelling: string | null;
  onCancel: (build: ApplianceBuildRow) => void;
  onCreateTemplate: (build: ApplianceBuildRow) => void;
}) {
  return (
    <Table label="Appliance builds">
      <THead>
        <Th>Build</Th>
        <Th>Base OS</Th>
        <Th>Desktop</Th>
        <Th>Status</Th>
        <Th>Progress</Th>
        <Th>Log</Th>
        <Th align="right">Actions</Th>
      </THead>
      <TBody>
        {builds.map((build) => {
          const active = build.status === 'queued' || build.status === 'running';
          const progress = Math.max(0, Math.min(100, build.progress));
          return (
            <Tr key={build.id}>
              <Td>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12px] font-medium">{build.name}</span>
                  <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                    {build.diskGb} GB disk · {build.memoryMb} MB · {build.cpus} vCPU
                    {build.computeName ? ` · ${build.computeName}` : ' · compute auto'}
                  </span>
                  {build.packages.length > 0 ? (
                    <span
                      className="truncate text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                      title={build.packages.join(', ')}
                    >
                      packages: {build.packages.join(', ')}
                    </span>
                  ) : null}
                </div>
              </Td>
              <Td className="text-[11px]">{build.osImageName}</Td>
              <Td className="text-[11px]">{desktopLabel(build.desktop)}</Td>
              <Td>
                <div className="flex flex-col gap-0.5">
                  <Badge tone={BUILD_STATUS_TONE[build.status]}>{build.status}</Badge>
                  {build.error ? (
                    <span
                      className="max-w-52 truncate text-[10px]"
                      title={build.error}
                      style={{ color: 'var(--color-signal-down)' }}
                    >
                      {build.error}
                    </span>
                  ) : build.message ? (
                    <span
                      className="max-w-52 truncate text-[10px]"
                      title={build.message}
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {build.message}
                    </span>
                  ) : null}
                </div>
              </Td>
              <Td>
                <div className="flex flex-col gap-1">
                  <span className="tabular text-[10px]">{Math.round(progress)}%</span>
                  <div
                    className="h-1 w-24 overflow-hidden rounded-full"
                    style={{ background: 'var(--color-panel-sunken)' }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress)}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.max(2, progress)}%`,
                        background:
                          build.status === 'failed'
                            ? 'var(--color-signal-down)'
                            : build.status === 'cancelled'
                              ? 'var(--color-rule-strong)'
                              : 'var(--color-copper)',
                      }}
                    />
                  </div>
                </div>
              </Td>
              <Td>
                <BuildLogTail build={build} />
              </Td>
              <Td align="right">
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {active ? (
                    <button
                      type="button"
                      className="nb-button"
                      data-size="sm"
                      disabled={cancelling === build.id}
                      onClick={() => onCancel(build)}
                    >
                      {cancelling === build.id ? (
                        <RefreshCw size={11} className="animate-spin" aria-hidden />
                      ) : null}
                      Cancel
                    </button>
                  ) : null}
                  {build.status === 'completed' ? (
                    <>
                      <button
                        type="button"
                        className="nb-button"
                        data-size="sm"
                        data-variant="primary"
                        disabled={!canCreateTemplates}
                        title={
                          canCreateTemplates
                            ? 'Create a device template from this image'
                            : 'Creating a template needs template.write'
                        }
                        onClick={() => onCreateTemplate(build)}
                      >
                        <Wrench size={11} aria-hidden /> Create template
                      </button>
                      {build.imageId ? (
                        <Link
                          to="/images"
                          className="nb-button"
                          data-size="sm"
                          title="Open the image library"
                        >
                          image {shortId(build.imageId)}
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/**
 * Global OS image repository and appliance builds. Builds run online; their
 * output is a library image that lab links attach with no uplink.
 */
export function ApplianceImagesPanel({
  canWrite,
  canCreateTemplates,
}: {
  canWrite: boolean;
  canCreateTemplates: boolean;
}) {
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState<'all' | OsFamily>('all');
  const [createOsOpen, setCreateOsOpen] = useState(false);
  const [adoptTarget, setAdoptTarget] = useState<OsImageRow | null>(null);
  const [editTarget, setEditTarget] = useState<OsImageRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OsImageRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [buildOpen, setBuildOpen] = useState(false);
  const [templateTarget, setTemplateTarget] = useState<ApplianceBuildRow | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, { job: JobRow; progress: number }>>({});

  const osImages = useQuery({
    ...orpc.appliances.os.list.queryOptions({ input: { limit: 100, offset: 0 } }),
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.status === 'downloading') ? 2500 : false,
  });
  const builds = useQuery({
    ...orpc.appliances.builds.list.queryOptions({ input: { limit: 50, offset: 0 } }),
    refetchInterval: (query) =>
      query.state.data?.some((build) => build.status === 'queued' || build.status === 'running')
        ? 3000
        : false,
  });
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    retry: false,
  });

  const osRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (osImages.data ?? []).filter((row) => {
      if (family !== 'all' && row.family !== family) return false;
      if (needle === '') return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.release.toLowerCase().includes(needle) ||
        row.filename.toLowerCase().includes(needle) ||
        (row.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [osImages.data, search, family]);

  const readyOsImages = (osImages.data ?? []).filter((row) => row.imageId !== null);
  const buildRows = builds.data ?? [];
  const filtersActive = search.trim() !== '' || family !== 'all';

  function invalidateOs() {
    void queryClient.invalidateQueries({ queryKey: orpc.appliances.os.list.key() });
  }

  function invalidateBuilds() {
    void queryClient.invalidateQueries({ queryKey: orpc.appliances.builds.list.key() });
  }

  async function startDownload(row: OsImageRow) {
    if (downloads[row.id]) return;
    try {
      const job = await client.appliances.os.download({ id: row.id });
      setDownloads((current) => ({ ...current, [row.id]: { job, progress: job.progress } }));
      try {
        await waitForJob(job.id, {
          onUpdate: (update) =>
            setDownloads((current) =>
              current[row.id]
                ? { ...current, [row.id]: { job: update, progress: update.progress } }
                : current,
            ),
        });
        toast.success(`Downloaded ${row.name}.`);
      } catch (error) {
        toast.error(`Download failed: ${messageOf(error)}`);
      } finally {
        setDownloads((current) => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
        invalidateOs();
        void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
      }
    } catch (error) {
      toast.error(messageOf(error));
      invalidateOs();
    }
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.appliances.os.delete({ id: deleteTarget.id });
      setDeleteTarget(null);
      invalidateOs();
      void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
      toast.success('OS image entry deleted.');
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  }

  async function cancelBuild(build: ApplianceBuildRow) {
    setCancelling(build.id);
    try {
      await client.appliances.builds.cancel({ id: build.id });
      invalidateBuilds();
      void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
      toast.info(`Cancelling ${build.name}.`);
    } catch (error) {
      toast.error(messageOf(error));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-5">
      <Notice tone="info">
        <strong>Builds run online.</strong> The build VM boots the base cloud image with QEMU user
        networking so cloud-init can reach package mirrors and install the desktop. The finished
        image is then attached to lab links <strong>with no uplink</strong> — lab traffic never
        leaves the topology.
      </Notice>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold">OS image repository</h2>
            <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              Global base cloud images. Download the artifact once, then build desktops from it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5" htmlFor="os-search">
              <Search size={13} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
              <Input
                id="os-search"
                className="h-7 py-0 text-[12px]"
                style={{ width: 208 }}
                placeholder="Search OS images"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <Select
              aria-label="Filter by OS family"
              className="h-7 py-0 text-[12px]"
              style={{ width: 128 }}
              value={family}
              onChange={(event) => setFamily(event.target.value as 'all' | OsFamily)}
            >
              <option value="all">all families</option>
              <option value="debian">Debian</option>
              <option value="ubuntu">Ubuntu</option>
            </Select>
            {canWrite ? (
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                onClick={() => setCreateOsOpen(true)}
              >
                <Plus size={14} aria-hidden /> New OS entry
              </button>
            ) : (
              <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                read-only
              </span>
            )}
          </div>
        </div>

        {osImages.isPending ? (
          <Loading label="Reading OS images…" />
        ) : osImages.isError ? (
          <EmptyState
            icon={HardDriveDownload}
            title="OS images could not be read"
            description={messageOf(osImages.error)}
            action={
              <button type="button" className="nb-button" onClick={() => void osImages.refetch()}>
                Retry
              </button>
            }
          />
        ) : osRows.length === 0 ? (
          filtersActive ? (
            <EmptyState
              icon={HardDriveDownload}
              title="No OS image matches"
              description="Clear the search and family filters to see the whole repository."
              action={
                <button
                  type="button"
                  className="nb-button"
                  onClick={() => {
                    setSearch('');
                    setFamily('all');
                  }}
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={HardDriveDownload}
              title="The OS repository is empty"
              description="Add a cloud image by URL, or adopt an image that is already in the library. Appliance builds need one of these as their base."
              action={
                canWrite ? (
                  <button
                    type="button"
                    className="nb-button"
                    data-variant="primary"
                    onClick={() => setCreateOsOpen(true)}
                  >
                    <Plus size={14} aria-hidden /> New OS entry
                  </button>
                ) : null
              }
            />
          )
        ) : (
          <Table label="OS image repository">
            <THead>
              <Th>OS image</Th>
              <Th>Family</Th>
              <Th>Release</Th>
              <Th>Size</Th>
              <Th>State</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {osRows.map((row) => {
                const state = osArtifactState(row);
                const download = downloads[row.id];
                const progress = download?.progress ?? null;
                return (
                  <Tr key={row.id}>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[12px] font-medium">{row.name}</span>
                        <span
                          className="max-w-md text-[10px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                        >
                          {row.description ?? row.filename}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={row.family === 'debian' ? 'copper' : 'info'}>
                        {row.family === 'debian' ? 'Debian' : 'Ubuntu'}
                      </Badge>
                    </Td>
                    <Td className="text-[11px]">
                      {row.release}
                      <span className="tabular ml-1" style={{ color: 'var(--color-ink-faint)' }}>
                        · {row.arch}
                      </span>
                    </Td>
                    <Td mono>{row.sizeBytes === null ? 'unknown' : formatBytes(row.sizeBytes)}</Td>
                    <Td>
                      <OsStateCell state={state} row={row} progress={progress} />
                    </Td>
                    <Td align="right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {state !== 'ready' ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            disabled={
                              !canWrite ||
                              download !== undefined ||
                              state === 'downloading' ||
                              row.sourceUrl === null
                            }
                            title={
                              row.sourceUrl === null
                                ? 'This entry has no source URL; adopt an existing library image instead.'
                                : 'Download the cloud image into the library'
                            }
                            onClick={() => void startDownload(row)}
                          >
                            {download !== undefined || state === 'downloading' ? (
                              <RefreshCw size={11} className="animate-spin" aria-hidden />
                            ) : (
                              <Download size={11} aria-hidden />
                            )}
                            Download
                          </button>
                        ) : null}
                        {canWrite ? (
                          <>
                            <button
                              type="button"
                              className="nb-button"
                              data-size="sm"
                              data-variant="ghost"
                              disabled={download !== undefined || state === 'downloading'}
                              title="Edit name, release, or source URL"
                              aria-label={`Edit ${row.name}`}
                              onClick={() => setEditTarget(row)}
                            >
                              <Pencil size={12} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="nb-button"
                              data-size="sm"
                              disabled={download !== undefined || state === 'downloading'}
                              title="Point this entry at an existing library image"
                              onClick={() => setAdoptTarget(row)}
                            >
                              Adopt
                            </button>
                            <button
                              type="button"
                              className="nb-button"
                              data-size="sm"
                              data-variant="ghost"
                              title={
                                row.imageId
                                  ? 'Delete the entry and the artifact it owns'
                                  : 'Delete the OS image entry'
                              }
                              aria-label={`Delete ${row.name}`}
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget(row);
                              }}
                            >
                              <Trash2 size={12} aria-hidden />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[14px] font-semibold">Appliance builds</h2>
            <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              Desktop images built once from a base OS, then attachable offline as reusable nodes.
            </p>
          </div>
          <span className="flex items-center gap-2">
            {builds.isFetching && buildRows.some((build) => build.status === 'running') ? (
              <span
                className="flex items-center gap-1 text-[10px]"
                style={{ color: 'var(--color-ink-faint)' }}
              >
                <RefreshCw size={10} className="animate-spin" aria-hidden /> live
              </span>
            ) : null}
            <button
              type="button"
              className="nb-button"
              data-variant="primary"
              disabled={!canWrite || readyOsImages.length === 0}
              title={
                readyOsImages.length === 0
                  ? 'Download or adopt an OS image first.'
                  : 'Build a desktop image from a downloaded base OS'
              }
              onClick={() => setBuildOpen(true)}
            >
              <Plus size={14} aria-hidden /> New appliance build
            </button>
          </span>
        </div>

        {builds.isPending ? (
          <Loading label="Reading appliance builds…" />
        ) : builds.isError ? (
          <EmptyState
            icon={Wrench}
            title="Appliance builds could not be read"
            description={messageOf(builds.error)}
            action={
              <button type="button" className="nb-button" onClick={() => void builds.refetch()}>
                Retry
              </button>
            }
          />
        ) : buildRows.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No appliance builds yet"
            description={
              readyOsImages.length === 0
                ? 'Download or adopt an OS image above first. Then a build boots it online, installs the desktop, and stores the result as an offline-ready library image.'
                : 'Pick a downloaded OS image and a desktop. The build runs online, then the result is a library image attachable with no uplink.'
            }
            action={
              canWrite ? (
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  disabled={readyOsImages.length === 0}
                  onClick={() => setBuildOpen(true)}
                >
                  <Plus size={14} aria-hidden /> New appliance build
                </button>
              ) : null
            }
          />
        ) : (
          <BuildsTable
            builds={buildRows}
            canCreateTemplates={canCreateTemplates}
            cancelling={cancelling}
            onCancel={(build) => void cancelBuild(build)}
            onCreateTemplate={(build) => setTemplateTarget(build)}
          />
        )}
      </section>

      {createOsOpen ? (
        <OsImageCreateDialog
          onOpenChange={(open) => {
            if (!open) setCreateOsOpen(false);
          }}
          onSaved={(created) => {
            setCreateOsOpen(false);
            invalidateOs();
            toast.success(`Added ${created.name} to the OS repository.`);
          }}
        />
      ) : null}

      {editTarget ? (
        <OsImageCreateDialog
          key={editTarget.id}
          osImage={editTarget}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
          onSaved={(saved) => {
            setEditTarget(null);
            invalidateOs();
            toast.success(`Updated ${saved.name}.`);
          }}
        />
      ) : null}

      {adoptTarget ? (
        <AdoptOsImageDialog
          osImage={adoptTarget}
          onOpenChange={(open) => {
            if (!open) setAdoptTarget(null);
          }}
          onAdopted={(adopted) => {
            setAdoptTarget(null);
            invalidateOs();
            toast.success(`${adopted.name} now points at a library image.`);
          }}
        />
      ) : null}

      {buildOpen ? (
        <ApplianceBuildDialog
          osImages={osImages.data ?? []}
          computes={computes.data ?? []}
          onOpenChange={(open) => {
            if (!open) setBuildOpen(false);
          }}
          onCreated={(created) => {
            setBuildOpen(false);
            invalidateBuilds();
            void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
            toast.success(`Build ${created.build.name} queued.`);
          }}
        />
      ) : null}

      {templateTarget ? (
        <BuildTemplateDialog
          build={templateTarget}
          onOpenChange={(open) => {
            if (!open) setTemplateTarget(null);
          }}
          onCreated={(template) => {
            setTemplateTarget(null);
            toast.success(`Template ${template.name} created from the build.`);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        title={`Delete ${deleteTarget?.name ?? 'OS image'}?`}
        description="The repository entry is removed. An artifact owned by this entry is deleted from the library; running builds are not affected."
        confirmLabel="Delete OS image"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void performDelete()}
      />
    </div>
  );
}
