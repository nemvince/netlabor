import type { ImageRow, NodeType, SymbolRow, TemplateRow } from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { ArrowsLeftRightIcon as ArrowRightLeft, CopyIcon as Copy, FileCodeIcon as FileCode2, SquaresFourIcon as LayoutTemplate, PencilIcon as Pencil, PlusIcon as Plus, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { Field, Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { SearchInput } from '../../components/search-input.tsx';
import { SymbolGlyph } from '../../components/symbol-glyph.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { toast } from '../../components/toast.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';
import {
  matchesFilename,
  missingRequiredImages,
  type RequiredImageState,
  requiredImageStates,
} from '../../lib/template-images.ts';
import { BaseConfigDialog } from './base-config-dialog.tsx';
import { TemplateDialog } from './template-dialog.tsx';
import { Button } from '@netlabor/ui/components/button';

const GLOBAL_SCOPE = 'global';

function DuplicateTemplateDialog({
  template,
  onOpenChange,
  onDuplicated,
}: {
  template: TemplateRow;
  onOpenChange: (open: boolean) => void;
  onDuplicated: (template: TemplateRow) => void;
}) {
  const [name, setName] = useState(`${template.name} copy`);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    if (name.trim() === '') {
      setError('Enter a name for the copy.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await client.templates.duplicate({ id: template.id, name: name.trim() });
      void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
      onDuplicated(created);
      onOpenChange(false);
    } catch (duplicateError) {
      setError(messageOf(duplicateError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={`Duplicate ${template.name}`}
      description="The copy is a user template and can be edited independently."
      width={480}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="New name" htmlFor="duplicate-template-name">
          <Input
            id="duplicate-template-name"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void duplicate()} variant="default" size="sm">
            {busy ? 'Duplicating…' : 'Duplicate'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/**
 * Copy a global template into a project. Device members with template.write on
 * the project can do this without managing the global library.
 */
function CreateInProjectDialog({
  template,
  projects,
  initialProjectId,
  onOpenChange,
  onCreated,
}: {
  template: TemplateRow;
  projects: { id: string; name: string }[];
  initialProjectId: string | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: TemplateRow, projectId: string) => void;
}) {
  const [projectId, setProjectId] = useState(initialProjectId ?? projects[0]?.id ?? '');
  const [name, setName] = useState(template.name);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (projectId === '') {
      setError(new Error('Choose the project that should own the copy.'));
      return;
    }
    if (name.trim() === '') {
      setError(new Error('Enter a name for the project template.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await client.templates.create({
        name: name.trim(),
        nodeType: template.nodeType,
        category: template.category,
        symbol: template.symbol,
        defaultNameFormat: template.defaultNameFormat,
        computeId: template.computeId,
        properties: template.properties,
        requiredImages: template.requiredImages,
        faults: template.faults,
        projectId,
      });
      void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
      onCreated(created, projectId);
      onOpenChange(false);
    } catch (createError) {
      setError(createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={`Create a copy of ${template.name} in a project`}
      description="The copy keeps the same node type, properties, and image requirements. Only the scope changes."
      width={520}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
        <Field
          label="Project"
          htmlFor="create-in-project-scope"
          hint="Project members can use and edit the copy; the global template stays untouched."
        >
          <Select
            id="create-in-project-scope"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.length === 0 ? <option value="">No readable projects</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Template name" htmlFor="create-in-project-name">
          <Input
            id="create-in-project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          Creating inside a project needs <code>template.write</code> on that project. Without it
          the controller refuses with a permission error.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button type="button" disabled={busy || projects.length === 0} onClick={() => void create()} variant="default" size="sm">
            {busy ? 'Creating…' : 'Create in project'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** Compact per-requirement strip: one tick per required image, present or missing. */
function ImageCoverageStrip({
  states,
  imagesLoaded,
}: {
  states: RequiredImageState[];
  imagesLoaded: boolean;
}) {
  if (states.length === 0) {
    return (
      <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
        no images required
      </span>
    );
  }
  const present = states.filter((state) => state.present).length;
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex items-center gap-[3px]" aria-hidden>
        {states.map((state) => (
          <span
            key={`${state.required.kind}:${state.required.name}`}
            title={`${state.required.name} · ${imagesLoaded ? (state.present ? 'present' : 'missing') : 'library not read'}`}
            className="inline-block h-2.5 w-3 rounded-[1px] border"
            style={{
              borderColor: 'var(--color-rule)',
              background: imagesLoaded
                ? state.present
                  ? 'var(--color-signal-up)'
                  : 'var(--color-signal-warn)'
                : 'var(--color-rule)',
            }}
          />
        ))}
      </span>
      <span
        className="tabular text-[10px]"
        style={{
          color:
            imagesLoaded && present < states.length
              ? 'var(--color-signal-warn)'
              : 'var(--color-ink-faint)',
        }}
      >
        {imagesLoaded ? `${present}/${states.length}` : 'images unread'}
      </span>
    </span>
  );
}

function RequiredImageList({
  template,
  images,
}: {
  template: TemplateRow;
  images: ImageRow[] | undefined;
}) {
  if (template.requiredImages.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
        This template requires no images.
      </p>
    );
  }
  return (
    <Table label="Required images">
      <THead>
        <Th>Requirement</Th>
        <Th>Kind</Th>
        <Th>Filename</Th>
        <Th>State</Th>
      </THead>
      <TBody>
        {template.requiredImages.map((required) => {
          const present =
            images?.some(
              (image) =>
                image.kind === required.kind &&
                ((required.sha256 !== undefined && image.sha256 === required.sha256) ||
                  image.name === required.name ||
                  matchesFilename(image.filename, required.filenamePattern)),
            ) ?? false;
          return (
            <Tr key={`${required.kind}:${required.name}`}>
              <Td>{required.name}</Td>
              <Td mono>{required.kind}</Td>
              <Td mono>{required.filenamePattern}</Td>
              <Td>
                {images === undefined ? (
                  <Badge tone="neutral">unread</Badge>
                ) : present ? (
                  <Badge tone="up">present</Badge>
                ) : (
                  <Badge tone="warn">missing</Badge>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

/**
 * Device template library: project-scoped list, filters, and a detail panel
 * whose action bar covers edit, duplicate, base configs, delete, and copy into
 * a project.
 */
export function DeviceTemplatesPanel({
  canWrite,
  canReadImages,
  onOpenAppliances,
}: {
  canWrite: boolean;
  canReadImages: boolean;
  onOpenAppliances: () => void;
}) {
  const [scope, setScope] = useState<string>(GLOBAL_SCOPE);
  const [search, setSearch] = useState('');
  const [nodeTypeFilter, setNodeTypeFilter] = useState<'all' | NodeType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ template: TemplateRow | null } | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<TemplateRow | null>(null);
  const [copyTarget, setCopyTarget] = useState<TemplateRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [baseConfigTarget, setBaseConfigTarget] = useState<TemplateRow | null>(null);

  const projects = useQuery({
    ...orpc.projects.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    retry: false,
  });
  const templates = useQuery(
    orpc.templates.list.queryOptions({
      input: { limit: 500, offset: 0, ...(scope === GLOBAL_SCOPE ? {} : { projectId: scope }) },
    }),
  );
  const symbols = useQuery({
    ...orpc.symbols.list.queryOptions({ input: {} }),
    retry: false,
  });
  const images = useQuery({
    ...orpc.images.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    enabled: canReadImages,
    retry: false,
  });
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    retry: false,
  });

  const projectRows = projects.data ?? [];
  const projectNames = useMemo(
    () => new Map(projectRows.map((project) => [project.id, project.name])),
    [projectRows],
  );

  useEffect(() => {
    if (scope !== GLOBAL_SCOPE && !projectRows.some((project) => project.id === scope)) {
      setScope(GLOBAL_SCOPE);
    }
  }, [projectRows, scope]);

  const symbolMap = useMemo(
    () => new Map((symbols.data ?? []).map((symbol) => [symbol.id, symbol])),
    [symbols.data],
  );
  const computeNames = useMemo(
    () => new Map((computes.data ?? []).map((compute) => [compute.id, compute.name])),
    [computes.data],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (templates.data ?? []).filter((template) => {
      if (nodeTypeFilter !== 'all' && template.nodeType !== nodeTypeFilter) return false;
      if (needle === '') return true;
      return (
        template.name.toLowerCase().includes(needle) ||
        template.category.toLowerCase().includes(needle) ||
        template.nodeType.toLowerCase().includes(needle) ||
        (template.projectId != null &&
          (projectNames.get(template.projectId) ?? '').toLowerCase().includes(needle))
      );
    });
  }, [templates.data, search, nodeTypeFilter, projectNames]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, Map<string, TemplateRow[]>>();
    for (const template of filtered) {
      let byType = byCategory.get(template.category);
      if (!byType) {
        byType = new Map();
        byCategory.set(template.category, byType);
      }
      const bucket = byType.get(template.nodeType) ?? [];
      bucket.push(template);
      byType.set(template.nodeType, bucket);
    }
    return [...byCategory.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, byType]) => ({
        category,
        types: [...byType.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([nodeType, rows]) => ({ nodeType, rows })),
      }));
  }, [filtered]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current && filtered.some((template) => template.id === current)
        ? current
        : (filtered[0]?.id ?? null),
    );
  }, [filtered]);

  const selected = (templates.data ?? []).find((template) => template.id === selectedId) ?? null;
  const selectedStates = selected
    ? requiredImageStates(selected, images.data)
    : ([] satisfies RequiredImageState[]);
  const selectedMissing = selected ? missingRequiredImages(selected, images.data ?? []) : [];
  const imagesLoaded = images.data !== undefined;

  function iconFor(symbolId: string): SymbolRow | undefined {
    return symbolMap.get(symbolId);
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await client.templates.delete({ id: deleteTarget.id });
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
      toast.success('Template deleted.');
    } catch (error) {
      setDeleteError(error);
    } finally {
      setDeleting(false);
    }
  }

  const filtersActive = search.trim() !== '' || nodeTypeFilter !== 'all';

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5" htmlFor="template-scope">
          <span className="nb-rule-label">Scope</span>
          <Select
            id="template-scope"
            aria-label="Template scope"
            className="h-7 py-0 text-[12px]"
            style={{ width: 208 }}
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
              setSelectedId(null);
            }}
          >
            <option value={GLOBAL_SCOPE}>Global library</option>
            {projectRows.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </label>
        <SearchInput
          id="template-search"
          label="Search templates"
          wrapperStyle={{ width: 224 }}
          placeholder="Search templates"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by node type"
          className="h-7 py-0 text-[12px]"
          style={{ width: 160 }}
          value={nodeTypeFilter}
          onChange={(event) => setNodeTypeFilter(event.target.value as 'all' | NodeType)}
        >
          <option value="all">all node types</option>
          {[...new Set((templates.data ?? []).map((template) => template.nodeType))]
            .sort()
            .map((nodeType) => (
              <option key={nodeType} value={nodeType}>
                {nodeType}
              </option>
            ))}
        </Select>
        <span className="tabular text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          {filtered.length} visible ·{' '}
          {filtered.filter((template) => template.projectId != null).length} project
        </span>
        <span className="flex-1" />
        {canWrite ? (
          <Button type="button" onClick={() => setEditor({ template: null })} variant="default" size="sm">
            <Plus size={14} aria-hidden /> New template
          </Button>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            read-only
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
        The global library is always included. Pick a project to add its own templates to the list;
        project templates stay scoped to that project.
      </p>

      {templates.isPending ? (
        <Loading label="Reading templates…" />
      ) : templates.isError ? (
        <div className="mt-3">
          <EmptyState
            icon={LayoutTemplate}
            title="Templates could not be read"
            description={messageOf(templates.error)}
            action={
              <Button type="button" onClick={() => void templates.refetch()} variant="outline" size="sm">
                Retry
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex flex-col gap-4">
            {groups.length === 0 ? (
              filtersActive ? (
                <EmptyState
                  icon={LayoutTemplate}
                  title="No template matches"
                  description="Clear the search and node-type filters, or create a template in the selected scope."
                  action={
                    <Button type="button" onClick={() => { setSearch(''); setNodeTypeFilter('all'); }} variant="outline" size="sm">
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={LayoutTemplate}
                  title="No device templates in this scope"
                  description="Create a template directly, or build an appliance image under Images → OS repository & builds and turn it into a template."
                  action={
                    <span className="flex flex-wrap items-center justify-center gap-2">
                      {canWrite ? (
                        <Button type="button" onClick={() => setEditor({ template: null })} variant="default" size="sm">
                          <Plus size={14} aria-hidden /> New template
                        </Button>
                      ) : null}
                      <Button type="button" onClick={onOpenAppliances} variant="outline" size="sm">
                        Open appliance builds
                      </Button>
                    </span>
                  }
                />
              )
            ) : (
              groups.map((group) => (
                <section key={group.category}>
                  <div className="mb-1 flex items-center gap-2">
                    <h2 className="text-[13px] font-semibold">{group.category}</h2>
                    <span
                      className="tabular text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {group.types.reduce((sum, type) => sum + type.rows.length, 0)}
                    </span>
                  </div>
                  {group.types.map((type) => (
                    <div key={type.nodeType} className="mb-2">
                      <div className="nb-rule-label mb-1 flex items-center gap-2">
                        {type.nodeType}
                        <span className="h-px flex-1" style={{ background: 'var(--color-rule)' }} />
                      </div>
                      <ul
                        className="overflow-hidden rounded-[3px] border"
                        style={{ borderColor: 'var(--color-rule)' }}
                      >
                        {type.rows.map((template) => {
                          const symbol = iconFor(template.symbol);
                          const states = requiredImageStates(template, images.data);
                          const missing = imagesLoaded
                            ? missingRequiredImages(template, images.data ?? [])
                            : [];
                          const active = template.id === selectedId;
                          return (
                            <li
                              key={template.id}
                              className="border-b last:border-b-0"
                              style={{
                                borderColor: 'var(--color-rule)',
                                background: active
                                  ? 'var(--color-panel-raised)'
                                  : 'var(--color-panel)',
                              }}
                            >
                              <button
                                type="button"
                                className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left"
                                aria-pressed={active}
                                onClick={() => setSelectedId(template.id)}
                              >
                                <span
                                  className="flex size-8 shrink-0 items-center justify-center rounded-[2px] border"
                                  style={{
                                    borderColor: 'var(--color-rule)',
                                    background: 'var(--color-panel-sunken)',
                                  }}
                                >
                                  {symbol ? (
                                    <SymbolGlyph svg={symbol.svg} className="size-6" />
                                  ) : (
                                    <span className="text-[10px]">?</span>
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-1.5">
                                    <span className="truncate text-[12px] font-medium">
                                      {template.name}
                                    </span>
                                    <Badge tone={template.projectId ? 'copper' : 'neutral'}>
                                      {template.projectId ? 'project' : 'global'}
                                    </Badge>
                                    {template.builtin ? <Badge tone="info">seeded</Badge> : null}
                                    {missing.length > 0 ? (
                                      <Badge tone="warn" title={missing.join(', ')}>
                                        missing image
                                      </Badge>
                                    ) : null}
                                  </span>
                                  <span className="mt-0.5 flex flex-wrap items-center gap-2">
                                    <span
                                      className="tabular text-[10px]"
                                      style={{ color: 'var(--color-ink-faint)' }}
                                    >
                                      {template.nodeType} · {template.category}
                                      {template.projectId
                                        ? ` · ${projectNames.get(template.projectId) ?? 'project'}`
                                        : ''}
                                    </span>
                                    <ImageCoverageStrip
                                      states={states}
                                      imagesLoaded={imagesLoaded}
                                    />
                                  </span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>

          <aside
            className="h-fit rounded-[3px] border lg:sticky lg:top-3"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
            aria-label="Template details"
          >
            {selected ? (
              <div className="flex flex-col">
                <div
                  className="flex items-start gap-3 border-b px-3 py-2.5"
                  style={{ borderColor: 'var(--color-rule)' }}
                >
                  <span
                    className="flex size-16 shrink-0 items-center justify-center rounded-[2px] border"
                    style={{
                      borderColor: 'var(--color-rule)',
                      background: 'var(--color-panel-sunken)',
                    }}
                  >
                    {iconFor(selected.symbol) ? (
                      <SymbolGlyph svg={iconFor(selected.symbol)?.svg ?? ''} className="size-12" />
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold">{selected.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      <Badge tone="copper">{selected.nodeType}</Badge>
                      <Badge tone="neutral">{selected.category}</Badge>
                      <Badge tone={selected.projectId ? 'copper' : 'neutral'}>
                        {selected.projectId ? 'project' : 'global'}
                      </Badge>
                      {selected.builtin ? <Badge tone="info">seeded</Badge> : null}
                    </div>
                    <div
                      className="tabular mt-1 text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {selected.projectId
                        ? `project: ${projectNames.get(selected.projectId) ?? selected.projectId.slice(0, 8)} · `
                        : 'global library · '}
                      updated {formatStamp(selected.updatedAt)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
                  <span className="nb-rule-label">Name format</span>
                  <span className="tabular">{selected.defaultNameFormat}</span>
                  <span className="nb-rule-label">Symbol</span>
                  <span className="tabular">{selected.symbol}</span>
                  <span className="nb-rule-label">Compute</span>
                  <span className="tabular">
                    {selected.computeId
                      ? (computeNames.get(selected.computeId) ?? selected.computeId.slice(0, 8))
                      : 'auto'}
                  </span>
                  <span className="nb-rule-label">Faults</span>
                  <span>{selected.faults.length === 0 ? 'none' : selected.faults.length}</span>
                </div>

                <div className="border-t px-3 py-2" style={{ borderColor: 'var(--color-rule)' }}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="nb-rule-label">Image coverage</span>
                    <ImageCoverageStrip states={selectedStates} imagesLoaded={imagesLoaded} />
                  </div>
                  <RequiredImageList template={selected} images={images.data} />
                  {imagesLoaded && selectedMissing.length > 0 ? (
                    <div
                      className="mt-2 rounded-[3px] border px-2 py-1.5"
                      style={{
                        borderColor:
                          'color-mix(in oklab, var(--color-signal-warn) 45%, transparent)',
                        background: 'color-mix(in oklab, var(--color-signal-warn) 8%, transparent)',
                      }}
                    >
                      <p className="text-[11px]" style={{ color: 'var(--color-signal-warn)' }}>
                        Missing {selectedMissing.join(', ')}. Nodes from this template cannot start
                        until the library has them.
                      </p>
                      <Button type="button" onClick={onOpenAppliances} className="mt-1.5" variant="outline" size="xs">
                        Open OS repository
                      </Button>
                    </div>
                  ) : null}
                </div>

                {selected.faults.length > 0 ? (
                  <div className="border-t px-3 py-2" style={{ borderColor: 'var(--color-rule)' }}>
                    <div className="nb-rule-label mb-1">Device faults</div>
                    <ul className="flex flex-wrap gap-1">
                      {selected.faults.map((fault) => (
                        <li key={fault.id}>
                          <Badge tone="copper">{fault.label}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="border-t px-3 py-2" style={{ borderColor: 'var(--color-rule)' }}>
                  <div className="nb-rule-label mb-1">Properties</div>
                  {Object.keys(selected.properties).length === 0 ? (
                    <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      No properties set.
                    </p>
                  ) : (
                    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-0.5 text-[11px]">
                      {Object.entries(selected.properties).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt
                            className="truncate"
                            style={{ color: 'var(--color-ink-dim)' }}
                            title={key}
                          >
                            {key}
                          </dt>
                          <dd className="tabular truncate">
                            {value === null || value === undefined
                              ? '—'
                              : typeof value === 'string'
                                ? value
                                : JSON.stringify(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                <div
                  className="flex flex-wrap items-center gap-1 border-t px-3 py-2"
                  style={{ borderColor: 'var(--color-rule)' }}
                >
                  <Button type="button" onClick={() => setBaseConfigTarget(selected)} variant="outline" size="xs">
                    <FileCode2 size={12} aria-hidden /> Base configs
                  </Button>
                  {canWrite ? (
                    <>
                      <Button type="button" onClick={() => setEditor({ template: selected })} variant="outline" size="xs">
                        <Pencil size={12} aria-hidden /> Edit
                      </Button>
                      <Button type="button" onClick={() => setDuplicateTarget(selected)} variant="outline" size="xs">
                        <Copy size={12} aria-hidden /> Duplicate
                      </Button>
                      <Button type="button" onClick={() => { setDeleteError(null); setDeleteTarget(selected); }} variant="destructive" size="xs">
                        <Trash2 size={12} aria-hidden /> Delete
                      </Button>
                      {selected.projectId == null ? (
                        <Button type="button" disabled={projectRows.length === 0} title={ projectRows.length === 0 ? 'No readable projects to copy into.' : 'Copy this global template into a project' } onClick={() => setCopyTarget(selected)} variant="default" size="xs">
                          <ArrowRightLeft size={12} aria-hidden /> Create in project
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="p-4 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
                Select a template to inspect its image coverage, properties, and actions.
              </div>
            )}
          </aside>
        </div>
      )}

      {editor ? (
        <TemplateDialog
          template={editor.template}
          symbols={symbols.data ?? []}
          computes={computes.data ?? []}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSaved={(saved) => {
            setEditor(null);
            setSelectedId(saved.id);
            void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
            void queryClient.invalidateQueries({ queryKey: orpc.templates.catalog.key() });
          }}
        />
      ) : null}

      {duplicateTarget ? (
        <DuplicateTemplateDialog
          template={duplicateTarget}
          onOpenChange={(open) => {
            if (!open) setDuplicateTarget(null);
          }}
          onDuplicated={(created) => {
            setDuplicateTarget(null);
            setSelectedId(created.id);
          }}
        />
      ) : null}

      {copyTarget ? (
        <CreateInProjectDialog
          template={copyTarget}
          projects={projectRows.map((project) => ({ id: project.id, name: project.name }))}
          initialProjectId={scope === GLOBAL_SCOPE ? null : scope}
          onOpenChange={(open) => {
            if (!open) setCopyTarget(null);
          }}
          onCreated={(created, projectId) => {
            setCopyTarget(null);
            setScope(projectId);
            setSelectedId(created.id);
            toast.success(`Created ${created.name} in its project.`);
          }}
        />
      ) : null}

      {baseConfigTarget ? (
        <BaseConfigDialog
          template={baseConfigTarget}
          onOpenChange={(open) => {
            if (!open) setBaseConfigTarget(null);
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
        title={`Delete ${deleteTarget?.name ?? 'template'}?`}
        description="User templates are removed. Seeded templates cannot be deleted."
        confirmLabel="Delete template"
        pending={deleting}
        error={deleteError}
        onConfirm={() => void performDelete()}
      />
    </>
  );
}
