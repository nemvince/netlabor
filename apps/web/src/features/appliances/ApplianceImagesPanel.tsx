import {
  type ApplianceBuildRow,
  OS_FAMILIES,
  type OsFamily,
  type OsImageRow,
} from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Download,
  FileText,
  HardDriveDownload,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Badge } from '../../components/Badge.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DetailList } from '../../components/DetailList.tsx';
import { Dialog, DialogFooter } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading } from '../../components/Page.tsx';
import { SearchInput } from '../../components/SearchInput.tsx';
import { toast } from '../../components/Toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { messageOf } from '../../lib/errors.ts';
import { trackOsDownload, useOsDownloadProgress } from '../../lib/downloadToasts.ts';
import { formatStamp, shortId } from '../../lib/format.ts';
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
  familyLabel,
  type OsArtifactState,
  osArtifactState,
} from './appliance-meta.ts';

function barWidth(value: number): string {
  return `${Math.max(2, Math.min(100, value))}%`;
}

function Meter({ value, tone = 'var(--color-copper)' }: { value: number; tone?: string }) {
  const rounded = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div
      className="h-1 overflow-hidden rounded-full"
      style={{ background: 'var(--color-panel-sunken)' }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
    >
      <div className="h-full" style={{ width: barWidth(value), background: tone }} />
    </div>
  );
}

function OsStateBadge({ state, progress }: { state: OsArtifactState; progress: number | null }) {
  if (state === 'ready') return <Badge tone="up">artifact ready</Badge>;
  if (state === 'downloading') {
    return (
      <Badge tone="warn">downloading{progress !== null ? ` ${Math.round(progress)}%` : ''}</Badge>
    );
  }
  if (state === 'error') return <Badge tone="down">download failed</Badge>;
  return <Badge tone="neutral">needs download</Badge>;
}

function EntryShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[3px] border"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
    >
      <ul>{children}</ul>
    </div>
  );
}

function OsImageEntry({
  row,
  progress,
  busy,
  canWrite,
  onDownload,
  onOpen,
}: {
  row: OsImageRow;
  progress: number | null;
  busy: boolean;
  canWrite: boolean;
  onDownload: () => void;
  onOpen: () => void;
}) {
  const state = osArtifactState(row);
  return (
    <li
      className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 last:border-b-0"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="max-w-full truncate text-left text-[13px] font-medium underline-offset-2 hover:underline"
          title={`Open details for ${row.name}`}
          onClick={onOpen}
        >
          {row.name}
        </button>
        <p
          className="mt-0.5 truncate text-[11px]"
          style={{ color: 'var(--color-ink-faint)' }}
          title={row.description ?? row.filename}
        >
          {row.description ?? row.filename}
        </p>
        <p
          className="tabular mt-1 truncate text-[10px]"
          style={{ color: 'var(--color-ink-faint)' }}
        >
          {familyLabel(row.family)} {row.release} · {row.arch} ·{' '}
          {row.sizeBytes === null ? 'size unknown' : formatBytes(row.sizeBytes)}
          {row.imageId ? ` · image ${shortId(row.imageId)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <OsStateBadge state={state} progress={progress} />
        {canWrite && state !== 'ready' ? (
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            disabled={busy || state === 'downloading' || row.sourceUrl === null}
            title={
              row.sourceUrl === null
                ? 'This entry has no source URL; adopt an existing library image instead.'
                : 'Download the cloud image into the library'
            }
            onClick={onDownload}
          >
            {busy || state === 'downloading' ? (
              <RefreshCw size={11} className="animate-spin" aria-hidden />
            ) : (
              <Download size={11} aria-hidden />
            )}
            Download
          </button>
        ) : null}
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          data-variant="ghost"
          aria-label={`Details for ${row.name}`}
          title="Details, edit, adopt, delete"
          onClick={onOpen}
        >
          <FileText size={12} aria-hidden /> Details
        </button>
      </div>
      {state === 'downloading' && progress !== null ? (
        <div className="absolute inset-x-0 bottom-0 h-px">
          <div
            className="h-full"
            style={{ width: barWidth(progress), background: 'var(--color-copper)' }}
          />
        </div>
      ) : null}
    </li>
  );
}

function OsImageDetailDialog({
  row,
  progress,
  canWrite,
  onOpenChange,
  onDownload,
  onEdit,
  onAdopt,
  onDelete,
}: {
  row: OsImageRow;
  progress: number | null;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
  onDownload: () => void;
  onEdit: () => void;
  onAdopt: () => void;
  onDelete: () => void;
}) {
  const state = osArtifactState(row);
  const close = () => onOpenChange(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={row.name}
      description={`${familyLabel(row.family)} ${row.release} · ${row.arch}`}
      width={620}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <OsStateBadge state={state} progress={progress} />
          {row.imageId ? (
            <Link
              to="/library"
              search={{ tab: 'images' }}
              className="tabular text-[11px] underline-offset-2 hover:underline"
              style={{ color: 'var(--color-ink-dim)' }}
              title="Open the image library"
            >
              image {shortId(row.imageId)}
            </Link>
          ) : null}
        </div>

        {row.error ? <Notice tone="error">{row.error}</Notice> : null}

        {state === 'downloading' && progress !== null ? (
          <div className="flex flex-col gap-1">
            <Meter value={progress} />
            <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {Math.round(progress)}% downloaded
            </span>
          </div>
        ) : null}

        <DetailList
          rows={[
            { label: 'Family', value: familyLabel(row.family) },
            { label: 'Release', value: row.release },
            { label: 'Arch', value: row.arch },
            {
              label: 'Size',
              value: row.sizeBytes === null ? 'unknown' : formatBytes(row.sizeBytes),
            },
            {
              label: 'Filename',
              value: <span className="tabular break-all">{row.filename}</span>,
            },
            {
              label: 'SHA-256',
              value: row.sha256 ? (
                <span className="tabular break-all">{row.sha256}</span>
              ) : (
                <span style={{ color: 'var(--color-ink-faint)' }}>not verified</span>
              ),
            },
            {
              label: 'Source',
              value: row.sourceUrl ? (
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="tabular break-all underline-offset-2 hover:underline"
                  style={{ color: 'var(--color-signal-info)' }}
                >
                  {row.sourceUrl}
                </a>
              ) : (
                <span style={{ color: 'var(--color-ink-faint)' }}>no source URL</span>
              ),
            },
            {
              label: 'Added',
              value: <span className="tabular">{formatStamp(row.createdAt)}</span>,
            },
            {
              label: 'Updated',
              value: <span className="tabular">{formatStamp(row.updatedAt)}</span>,
            },
          ]}
        />
      </div>

      <DialogFooter>
        {canWrite ? (
          <button
            type="button"
            className="nb-button mr-auto"
            data-variant="danger"
            onClick={onDelete}
          >
            <Trash2 size={12} aria-hidden /> Delete
          </button>
        ) : null}
        <button type="button" className="nb-button" onClick={close}>
          Close
        </button>
        {canWrite && state !== 'ready' && row.sourceUrl !== null ? (
          <button
            type="button"
            className="nb-button"
            disabled={state === 'downloading'}
            onClick={onDownload}
          >
            <Download size={12} aria-hidden /> Download
          </button>
        ) : null}
        {canWrite ? (
          <button
            type="button"
            className="nb-button"
            disabled={state === 'downloading'}
            onClick={onAdopt}
          >
            Adopt
          </button>
        ) : null}
        {canWrite ? (
          <button
            type="button"
            className="nb-button"
            disabled={state === 'downloading'}
            onClick={onEdit}
          >
            <Pencil size={12} aria-hidden /> Edit
          </button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}

function BuildEntry({
  build,
  canCreateTemplates,
  cancelling,
  onCancel,
  onCreateTemplate,
  onOpen,
}: {
  build: ApplianceBuildRow;
  canCreateTemplates: boolean;
  cancelling: boolean;
  onCancel: () => void;
  onCreateTemplate: () => void;
  onOpen: () => void;
}) {
  const active = build.status === 'queued' || build.status === 'running';
  const progress = Math.max(0, Math.min(100, build.progress));
  const desktop = build.desktop === 'none' ? 'server' : desktopLabel(build.desktop);
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 last:border-b-0"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="max-w-full truncate text-left text-[13px] font-medium underline-offset-2 hover:underline"
          title={`Open details for ${build.name}`}
          onClick={onOpen}
        >
          {build.name}
        </button>
        <p
          className="tabular mt-0.5 truncate text-[10px]"
          style={{ color: 'var(--color-ink-faint)' }}
        >
          {build.osImageName} · {desktop} · {build.diskGb} GB disk · {build.memoryMb} MB RAM ·{' '}
          {build.cpus} vCPU{build.computeName ? ` · ${build.computeName}` : ''}
        </p>
        {active ? (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="w-40 max-w-full">
              <Meter value={progress} />
            </div>
            <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {Math.round(progress)}%
            </span>
            {build.message ? (
              <span
                className="truncate text-[10px]"
                style={{ color: 'var(--color-ink-faint)' }}
                title={build.message}
              >
                {build.message}
              </span>
            ) : null}
          </div>
        ) : build.error ? (
          <p
            className="mt-1 max-w-xl truncate text-[10px]"
            style={{ color: 'var(--color-signal-down)' }}
            title={build.error}
          >
            {build.error}
          </p>
        ) : build.message ? (
          <p
            className="mt-1 max-w-xl truncate text-[10px]"
            style={{ color: 'var(--color-ink-faint)' }}
            title={build.message}
          >
            {build.message}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={BUILD_STATUS_TONE[build.status]}>{build.status}</Badge>
        {active ? (
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? <RefreshCw size={11} className="animate-spin" aria-hidden /> : null}
            Cancel
          </button>
        ) : null}
        {build.status === 'completed' ? (
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
            onClick={onCreateTemplate}
          >
            <Wrench size={11} aria-hidden /> Create template
          </button>
        ) : null}
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          data-variant="ghost"
          aria-label={`Details for ${build.name}`}
          title="Build details and log"
          onClick={onOpen}
        >
          <FileText size={12} aria-hidden /> Details
        </button>
      </div>
    </li>
  );
}

function BuildDetailDialog({
  build,
  canCreateTemplates,
  cancelling,
  onOpenChange,
  onCancel,
  onClearLog,
  onCreateTemplate,
}: {
  build: ApplianceBuildRow;
  canCreateTemplates: boolean;
  cancelling: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onClearLog: () => void;
  onCreateTemplate: () => void;
}) {
  const active = build.status === 'queued' || build.status === 'running';
  const progress = Math.max(0, Math.min(100, build.progress));
  const desktop = build.desktop === 'none' ? 'server' : desktopLabel(build.desktop);
  const logLines = build.log ? build.log.split('\n').length : 0;
  const close = () => onOpenChange(false);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={build.name}
      description={`${build.osImageName} · ${desktop}`}
      width={760}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={BUILD_STATUS_TONE[build.status]}>{build.status}</Badge>
          {active ? (
            <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {Math.round(progress)}%
            </span>
          ) : null}
        </div>

        {active ? <Meter value={progress} /> : null}
        {build.error ? <Notice tone="error">{build.error}</Notice> : null}

        <DetailList
          rows={[
            { label: 'Base OS', value: build.osImageName },
            { label: 'Desktop', value: desktop },
            { label: 'Disk', value: `${build.diskGb} GB` },
            { label: 'Memory', value: `${build.memoryMb} MB` },
            { label: 'CPUs', value: `${build.cpus} vCPU` },
            {
              label: 'Compute',
              value: build.computeName ?? (
                <span style={{ color: 'var(--color-ink-faint)' }}>auto</span>
              ),
            },
            {
              label: 'Packages',
              value:
                build.packages.length > 0 ? (
                  <span className="tabular break-words">{build.packages.join(', ')}</span>
                ) : (
                  <span style={{ color: 'var(--color-ink-faint)' }}>none</span>
                ),
            },
            {
              label: 'Created',
              value: <span className="tabular">{formatStamp(build.createdAt)}</span>,
            },
            {
              label: 'Updated',
              value: <span className="tabular">{formatStamp(build.updatedAt)}</span>,
            },
          ]}
        />

        <section>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 className="text-[12px] font-medium">Build log</h3>
            <span
              className="tabular flex items-center gap-2 text-[10px]"
              style={{ color: 'var(--color-ink-faint)' }}
            >
              {build.log ? `${logLines} lines` : 'empty'}
              {!active && build.log ? (
                <button
                  type="button"
                  className="nb-button"
                  data-size="sm"
                  data-variant="ghost"
                  aria-label="Clear the build log"
                  title="Discard the stored log"
                  onClick={onClearLog}
                >
                  Clear log
                </button>
              ) : null}
            </span>
          </div>
          {build.log ? (
            <pre
              className="tabular max-h-52 overflow-auto rounded-[3px] border px-3 py-2 text-[11px] leading-[1.55]"
              style={{
                borderColor: 'var(--color-rule)',
                background: 'var(--color-panel-sunken)',
                color: 'var(--color-ink-dim)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {build.log}
            </pre>
          ) : (
            <p
              className="rounded-[3px] border border-dashed px-3 py-4 text-[11px]"
              style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-faint)' }}
            >
              {active
                ? 'The build has not written any output yet.'
                : 'This build has no log output.'}
            </p>
          )}
        </section>

        {build.imageId ? (
          <Link
            to="/library"
            search={{ tab: 'images' }}
            className="tabular text-[11px] underline-offset-2 hover:underline"
            style={{ color: 'var(--color-ink-dim)' }}
            title="Open the image library"
          >
            image {shortId(build.imageId)}
          </Link>
        ) : null}
      </div>

      <DialogFooter>
        {active ? (
          <button
            type="button"
            className="nb-button mr-auto"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? <RefreshCw size={11} className="animate-spin" aria-hidden /> : null}
            Cancel build
          </button>
        ) : null}
        <button type="button" className="nb-button" onClick={close}>
          Close
        </button>
        {build.status === 'completed' ? (
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            disabled={!canCreateTemplates}
            title={
              canCreateTemplates
                ? 'Create a device template from this image'
                : 'Creating a template needs template.write'
            }
            onClick={onCreateTemplate}
          >
            <Wrench size={12} aria-hidden /> Create template
          </button>
        ) : null}
      </DialogFooter>
    </Dialog>
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
  const [detailTarget, setDetailTarget] = useState<OsImageRow | null>(null);
  const [buildDetail, setBuildDetail] = useState<ApplianceBuildRow | null>(null);
  const downloadProgress = useOsDownloadProgress();
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

  // An image only boots on a compute of its architecture, so hide the ones no
  // registered compute can run (until a compute has reported capabilities).
  const computeArchs = useMemo(() => {
    const archs = new Set<string>();
    for (const compute of computes.data ?? []) {
      const arch = compute.capabilities?.arch;
      if (arch) archs.add(arch);
    }
    return archs;
  }, [computes.data]);
  const supported = useCallback(
    (row: OsImageRow) => computeArchs.size === 0 || computeArchs.has(row.arch),
    [computeArchs],
  );

  const osRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (osImages.data ?? []).filter((row) => {
      if (!supported(row)) return false;
      if (family !== 'all' && row.family !== family) return false;
      if (needle === '') return true;
      return (
        row.name.toLowerCase().includes(needle) ||
        row.release.toLowerCase().includes(needle) ||
        row.filename.toLowerCase().includes(needle) ||
        (row.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [osImages.data, search, family, supported]);

  const readyOsImages = (osImages.data ?? []).filter(
    (row) => row.imageId !== null && supported(row),
  );
  const buildRows = builds.data ?? [];
  const filtersActive = search.trim() !== '' || family !== 'all';
  const detailRow = detailTarget
    ? (osImages.data?.find((row) => row.id === detailTarget.id) ?? detailTarget)
    : null;
  const detailBuild = buildDetail
    ? (builds.data?.find((build) => build.id === buildDetail.id) ?? buildDetail)
    : null;

  function invalidateOs() {
    void queryClient.invalidateQueries({ queryKey: orpc.appliances.os.list.key() });
  }

  function invalidateBuilds() {
    void queryClient.invalidateQueries({ queryKey: orpc.appliances.builds.list.key() });
  }

  async function startDownload(row: OsImageRow) {
    if (row.status === 'downloading') return;
    try {
      const job = await client.appliances.os.download({ id: row.id });
      // Progress is tracked app-wide by the download-toast tracker.
      trackOsDownload(job);
    } catch (error) {
      toast.error(messageOf(error));
    }
    invalidateOs();
    void queryClient.invalidateQueries({ queryKey: orpc.jobs.list.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.images.list.key() });
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
    <div className="mt-4 flex flex-col gap-6">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">OS image repository</h2>
            <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              Global base cloud images. Download the artifact once, then build desktops from it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              id="os-search"
              label="Search OS images"
              placeholder="Search OS images"
              wrapperStyle={{ width: 208 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              aria-label="Filter by OS family"
              className="h-7 py-0 text-[12px]"
              style={{ width: 128 }}
              value={family}
              onChange={(event) => setFamily(event.target.value as 'all' | OsFamily)}
            >
              <option value="all">all families</option>
              {OS_FAMILIES.map((value) => (
                <option key={value} value={value}>
                  {familyLabel(value)}
                </option>
              ))}
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

        <div className="mt-3">
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
            <EntryShell>
              {osRows.map((row) => (
                <OsImageEntry
                  key={row.id}
                  row={row}
                  progress={downloadProgress[row.id] ?? null}
                  busy={row.status === 'downloading'}
                  canWrite={canWrite}
                  onDownload={() => void startDownload(row)}
                  onOpen={() => setDetailTarget(row)}
                />
              ))}
            </EntryShell>
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">Appliance builds</h2>
            <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              Desktop images built once from a base OS, then attachable offline as reusable nodes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {builds.isFetching && buildRows.some((build) => build.status === 'running') ? (
              <span
                className="flex items-center gap-1.5 text-[10px]"
                style={{ color: 'var(--color-ink-faint)' }}
              >
                <span
                  aria-hidden
                  className="inline-block size-[5px] rounded-full"
                  style={{ background: 'var(--color-copper)' }}
                />
                live
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
          </div>
        </div>

        <div className="mt-3">
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
            <EntryShell>
              {buildRows.map((build) => (
                <BuildEntry
                  key={build.id}
                  build={build}
                  canCreateTemplates={canCreateTemplates}
                  cancelling={cancelling === build.id}
                  onCancel={() => void cancelBuild(build)}
                  onCreateTemplate={() => setTemplateTarget(build)}
                  onOpen={() => setBuildDetail(build)}
                />
              ))}
            </EntryShell>
          )}
        </div>
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

      {detailRow ? (
        <OsImageDetailDialog
          row={detailRow}
          progress={downloadProgress[detailRow.id] ?? null}
          canWrite={canWrite}
          onOpenChange={(open) => {
            if (!open) setDetailTarget(null);
          }}
          onDownload={() => void startDownload(detailRow)}
          onEdit={() => {
            setDetailTarget(null);
            setEditTarget(detailRow);
          }}
          onAdopt={() => {
            setDetailTarget(null);
            setAdoptTarget(detailRow);
          }}
          onDelete={() => {
            setDetailTarget(null);
            setDeleteError(null);
            setDeleteTarget(detailRow);
          }}
        />
      ) : null}

      {detailBuild ? (
        <BuildDetailDialog
          build={detailBuild}
          canCreateTemplates={canCreateTemplates}
          cancelling={cancelling === detailBuild.id}
          onOpenChange={(open) => {
            if (!open) setBuildDetail(null);
          }}
          onCancel={() => void cancelBuild(detailBuild)}
          onClearLog={() => {
            void client.appliances.builds
              .clearLog({ id: detailBuild.id })
              .then(() => invalidateBuilds())
              .catch((error: unknown) => toast.error(messageOf(error)));
          }}
          onCreateTemplate={() => {
            setBuildDetail(null);
            setTemplateTarget(detailBuild);
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
