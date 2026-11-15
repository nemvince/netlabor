import type { ProjectRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CopyIcon as Copy, DownloadSimpleIcon as Download, FileCodeIcon as FileJson2, KanbanIcon as FolderKanban, LockIcon as Lock, PlayIcon as Play, PlusIcon as Plus, SlidersHorizontalIcon as Settings2, SquareIcon as Square, TrashIcon as Trash2, LockOpenIcon as Unlock, UploadSimpleIcon as Upload   } from '@phosphor-icons/react';
import { useDeferredValue, useState } from 'react';
import { Badge } from '../components/badge.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { EmptyState } from '../components/empty-state.tsx';
import { Select } from '../components/field.tsx';
import { Loading, Page, PageHeader } from '../components/page.tsx';
import { SearchInput } from '../components/search-input.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../components/table.tsx';
import { toast } from '../components/toast.tsx';
import { NotAllowed } from '../features/auth/require-auth.tsx';
import { useMe } from '../features/auth/use-me.ts';
import {
  CreateProjectDialog,
  DuplicateProjectDialog,
  ExportNotice,
  ImportProjectDialog,
} from '../features/projects/project-dialogs.tsx';
import { ApplyManifestDialog } from '../features/projects/apply-manifest-dialog.tsx';
import { ProjectSettingsDialog } from '../features/projects/project-settings-dialog.tsx';
import { useProjectExport } from '../features/projects/use-project-export.ts';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { formatStamp } from '../lib/format.ts';
import { queryClient } from '../lib/query-client.ts';

function refetchProjects() {
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.nodes.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.links.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.stats.key() });
}

export function ProjectsPage() {
  const { me, can } = useMe();
  const navigate = useNavigate();
  const canRead = can('project.read');
  const canWrite = can('project.write');
  const canMembers = can('project.members');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [status, setStatus] = useState<'' | 'opened' | 'closed'>('');
  const [includeClosed, setIncludeClosed] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<ProjectRow | null>(null);
  const [settingsTarget, setSettingsTarget] = useState<ProjectRow | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<ProjectRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null);
  const { state: exportState, run: runExport, clear: clearExport } = useProjectExport();

  const projects = useQuery({
    ...orpc.projects.list.queryOptions({
      input: {
        ...(deferredSearch === '' ? {} : { search: deferredSearch }),
        ...(status === '' ? {} : { status }),
        includeClosed,
        limit: 200,
        offset: 0,
      },
    }),
    enabled: canRead,
    refetchInterval: 20_000,
  });

  const openProject = useMutation({
    ...orpc.projects.open.mutationOptions(),
    onSuccess: refetchProjects,
    onError: (error) => toast.error(messageOf(error)),
  });
  const closeProject = useMutation({
    ...orpc.projects.close.mutationOptions(),
    onSuccess: refetchProjects,
    onError: (error) => toast.error(messageOf(error)),
  });
  const lockProject = useMutation({
    ...orpc.projects.lock.mutationOptions(),
    onSuccess: refetchProjects,
    onError: (error) => toast.error(messageOf(error)),
  });
  const unlockProject = useMutation({
    ...orpc.projects.unlock.mutationOptions(),
    onSuccess: refetchProjects,
    onError: (error) => toast.error(messageOf(error)),
  });
  const remove = useMutation({
    ...orpc.projects.delete.mutationOptions(),
    onSuccess: () => {
      setDeleteTarget(null);
      refetchProjects();
    },
  });

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="project.read" />;

  const busyId =
    (openProject.isPending ? openProject.variables?.id : undefined) ??
    (closeProject.isPending ? closeProject.variables?.id : undefined) ??
    (lockProject.isPending ? lockProject.variables?.id : undefined) ??
    (unlockProject.isPending ? unlockProject.variables?.id : undefined);

  return (
    <Page>
      <PageHeader
        title="Projects"
        description="A project owns one topology, one network namespace per compute, and its files."
        actions={
          <span className="flex items-center gap-2">
            {canWrite ? (
              <>
                <button
                  type="button"
                  className="nb-button"
                  onClick={() => {
                    setApplyTarget(null);
                    setApplyOpen(true);
                  }}
                >
                  <FileJson2 size={14} aria-hidden /> Apply manifest
                </button>
                <button type="button" className="nb-button" onClick={() => setImportOpen(true)}>
                  <Upload size={14} aria-hidden /> Import
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={14} aria-hidden /> New project
                </button>
              </>
            ) : null}
          </span>
        }
      />

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <SearchInput
          label="Search projects"
          placeholder="Search projects"
          wrapperClassName="min-w-[240px] flex-1"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter project status"
          style={{ width: 168 }}
          value={status}
          onChange={(event) => setStatus(event.target.value as '' | 'opened' | 'closed')}
        >
          <option value="">All statuses</option>
          <option value="opened">Opened</option>
          <option value="closed">Closed</option>
        </Select>
        <label
          className="flex items-center gap-1.5 text-[12px]"
          style={{ color: 'var(--color-ink-dim)' }}
        >
          <input
            type="checkbox"
            className="size-3.5"
            style={{ accentColor: 'var(--color-copper)' }}
            checked={includeClosed}
            onChange={(event) => setIncludeClosed(event.target.checked)}
          />
          Include closed
        </label>
      </div>
      {exportState ? (
        <div className="mt-3">
          <ExportNotice
            projectName={
              projects.data?.find((project) => project.id === exportState.projectId)?.name ??
              exportState.projectId.slice(0, 8)
            }
            progress={exportState.progress}
            busy={exportState.busy}
            {...(exportState.error ? { error: exportState.error } : {})}
            onDismiss={clearExport}
          />
        </div>
      ) : null}

      <div className="mt-4">
        {projects.isPending ? (
          <Loading label="Reading projects…" />
        ) : projects.isError ? (
          <EmptyState
            icon={FolderKanban}
            title="Projects could not be read"
            description={messageOf(projects.error)}
          />
        ) : projects.data.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects match"
            description="Create a project, or clear the search and status filters."
            action={
              canWrite ? (
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus size={14} aria-hidden /> New project
                </button>
              ) : null
            }
          />
        ) : (
          <Table label="Projects">
            <THead>
              <Th>Project</Th>
              <Th>Status</Th>
              <Th>Owner</Th>
              <Th align="right">Nodes</Th>
              <Th align="right">Links</Th>
              <Th>Updated</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {projects.data.map((project) => {
                const pending = busyId === project.id;
                const isOpened = project.status === 'opened';
                return (
                  <Tr key={project.id}>
                    <Td>
                      <button
                        type="button"
                        className="block max-w-[360px] truncate text-left font-medium hover:underline"
                        onClick={() =>
                          void navigate({
                            to: '/projects/$projectId',
                            params: { projectId: project.id },
                          })
                        }
                      >
                        {project.name}
                      </button>
                      {project.description ? (
                        <span
                          className="block max-w-[360px] truncate text-[11px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                          title={project.description}
                        >
                          {project.description}
                        </span>
                      ) : null}
                      <span
                        className="tabular block text-[10px]"
                        style={{ color: 'var(--color-ink-faint)' }}
                      >
                        {project.id.slice(0, 8)}
                        {project.poolId ? ` · pool ${project.poolId.slice(0, 8)}` : ''}
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1">
                        <Badge tone={isOpened ? 'up' : 'neutral'}>
                          {isOpened ? 'opened' : 'closed'}
                        </Badge>
                        {project.locked ? <Badge tone="warn">locked</Badge> : null}
                        {project.autoOpen ? <Badge tone="info">auto-open</Badge> : null}
                        {project.autoStart ? <Badge tone="info">auto-start</Badge> : null}
                      </span>
                    </Td>
                    <Td>{project.ownerName}</Td>
                    <Td mono align="right">
                      {project.nodeCount}
                    </Td>
                    <Td mono align="right">
                      {project.linkCount}
                    </Td>
                    <Td mono>{formatStamp(project.updatedAt)}</Td>
                    <Td align="right">
                      <span className="inline-flex items-center gap-1">
                        {can('project.open') ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={isOpened ? `Close ${project.name}` : `Open ${project.name}`}
                            aria-label={isOpened ? `Close ${project.name}` : `Open ${project.name}`}
                            disabled={pending}
                            onClick={() => {
                              if (isOpened) closeProject.mutate({ id: project.id });
                              else openProject.mutate({ id: project.id });
                            }}
                          >
                            {isOpened ? (
                              <Square size={13} aria-hidden />
                            ) : (
                              <Play size={13} aria-hidden />
                            )}
                          </button>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={
                              project.locked ? `Unlock ${project.name}` : `Lock ${project.name}`
                            }
                            aria-label={
                              project.locked ? `Unlock ${project.name}` : `Lock ${project.name}`
                            }
                            disabled={pending}
                            onClick={() => {
                              if (project.locked) unlockProject.mutate({ id: project.id });
                              else lockProject.mutate({ id: project.id });
                            }}
                          >
                            {project.locked ? (
                              <Unlock size={13} aria-hidden />
                            ) : (
                              <Lock size={13} aria-hidden />
                            )}
                          </button>
                        ) : null}
                        {can('project.export') ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={`Export ${project.name}`}
                            aria-label={`Export ${project.name}`}
                            disabled={
                              exportState?.busy === true && exportState.projectId === project.id
                            }
                            onClick={() => void runExport(project.id)}
                          >
                            <Download size={13} aria-hidden />
                          </button>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={`Duplicate ${project.name}`}
                            aria-label={`Duplicate ${project.name}`}
                            onClick={() => setDuplicate(project)}
                          >
                            <Copy size={13} aria-hidden />
                          </button>
                        ) : null}
                        {canWrite ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={`Apply a manifest to ${project.name}`}
                            aria-label={`Apply a manifest to ${project.name}`}
                            onClick={() => {
                              setApplyTarget(project);
                              setApplyOpen(true);
                            }}
                          >
                            <FileJson2 size={13} aria-hidden />
                          </button>
                        ) : null}
                        {canWrite || canMembers ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={`Settings for ${project.name}`}
                            aria-label={`Settings for ${project.name}`}
                            onClick={() => setSettingsTarget(project)}
                          >
                            <Settings2 size={13} aria-hidden />
                          </button>
                        ) : null}
                        {can('project.delete') ? (
                          <button
                            type="button"
                            className="nb-button"
                            data-size="sm"
                            data-variant="ghost"
                            title={`Delete ${project.name}`}
                            aria-label={`Delete ${project.name}`}
                            onClick={() => {
                              remove.reset();
                              setDeleteTarget(project);
                            }}
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      {createOpen ? (
        <CreateProjectDialog
          onOpenChange={setCreateOpen}
          onCreated={(project) => {
            toast.success(`Project ${project.name} created.`);
          }}
        />
      ) : null}
      {importOpen ? (
        <ImportProjectDialog
          onOpenChange={setImportOpen}
          onCompleted={(projectId) => {
            toast.success(`Project imported as ${projectId.slice(0, 8)}.`);
          }}
        />
      ) : null}
      {duplicate ? (
        <DuplicateProjectDialog
          project={duplicate}
          onOpenChange={(open) => {
            if (!open) setDuplicate(null);
          }}
          onCompleted={(projectId) => {
            toast.success(`Project duplicated as ${projectId.slice(0, 8)}.`);
          }}
        />
      ) : null}

      {applyOpen ? (
        <ApplyManifestDialog
          {...(applyTarget ? { project: applyTarget } : {})}
          onOpenChange={setApplyOpen}
        />
      ) : null}

      {settingsTarget ? (
        <ProjectSettingsDialog
          project={settingsTarget}
          onOpenChange={(open) => {
            if (!open) setSettingsTarget(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            remove.reset();
          }
        }}
        title={`Delete ${deleteTarget?.name ?? 'project'}?`}
        description="The project stops, its dataplane is removed, and its topology, files, and snapshots are deleted."
        confirmLabel="Delete project"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => {
          if (deleteTarget) remove.mutate({ id: deleteTarget.id });
        }}
      />
    </Page>
  );
}
