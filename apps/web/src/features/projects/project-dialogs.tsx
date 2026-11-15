import { zodResolver } from '@hookform/resolvers/zod';
import type { JobRow, ProjectRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  DownloadSimpleIcon as Download,
  PlusIcon as Plus,
  UploadSimpleIcon as Upload,
  XIcon as X,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { CheckboxOption, Field, Input, Select, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { jobResultString, waitForJob } from '../../lib/jobs.ts';
import { queryClient } from '../../lib/query-client.ts';
import { uploadFile } from '../../lib/uploads.ts';
import { Button } from '@netlabor/ui/components/button';

const projectSchema = z.object({
  name: z.string().min(1, 'enter a project name').max(128, 'use at most 128 characters'),
  description: z.string().max(2000, 'use at most 2000 characters'),
  poolId: z.string(),
  variables: z.array(z.object({ key: z.string(), value: z.string() })),
  autoOpen: z.boolean(),
  autoClose: z.boolean(),
  autoStart: z.boolean(),
});

type ProjectValues = z.infer<typeof projectSchema>;

function invalidateProjects() {
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
}

/** Create a project with a key/value variable map and open/start policies. */
export function CreateProjectDialog({
  onOpenChange,
  onCreated,
}: {
  onOpenChange: (open: boolean) => void;
  onCreated?: (project: ProjectRow) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [variableError, setVariableError] = useState<string | null>(null);
  const pools = useQuery(orpc.pools.list.queryOptions({ input: {} }));
  const form = useForm<ProjectValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '',
      description: '',
      poolId: '',
      variables: [{ key: '', value: '' }],
      autoOpen: false,
      autoClose: false,
      autoStart: false,
    },
  });
  const variables = useFieldArray({ control: form.control, name: 'variables' });

  const createProject = useMutation({
    ...orpc.projects.create.mutationOptions(),
    onSuccess: (project) => {
      invalidateProjects();
      onCreated?.(project);
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    setVariableError(null);
    const variablesMap: Record<string, string> = {};
    for (const entry of values.variables) {
      const key = entry.key.trim();
      if (key === '') continue;
      if (Object.hasOwn(variablesMap, key)) {
        setVariableError(`variable "${key}" is entered more than once`);
        return;
      }
      variablesMap[key] = entry.value;
    }
    createProject.mutate({
      name: values.name.trim(),
      description: values.description.trim() === '' ? null : values.description.trim(),
      poolId: values.poolId === '' ? null : values.poolId,
      variables: variablesMap,
      autoOpen: values.autoOpen,
      autoClose: values.autoClose,
      autoStart: values.autoStart,
    });
  });

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="New project"
      description="Projects own a network namespace, topology, files, and compute slots."
      width={620}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <Field label="Name" htmlFor="project-name" error={form.formState.errors.name?.message}>
          <Input
            id="project-name"
            autoFocus
            placeholder="branch-office"
            {...form.register('name')}
          />
        </Field>
        <Field label="Description" htmlFor="project-description">
          <Textarea
            id="project-description"
            rows={2}
            placeholder="What this lab demonstrates"
            {...form.register('description')}
          />
        </Field>
        <Field
          label="Pool"
          htmlFor="project-pool"
          hint="Leave empty to resolve the compute per node."
        >
          <Select id="project-pool" {...form.register('poolId')}>
            <option value="">No pool</option>
            {(pools.data ?? []).map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-medium" style={{ color: 'var(--color-ink-dim)' }}>
            Variables
          </span>
          <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            Use them as {'{{name}}'} in template properties and startup configs.
          </p>
          <div className="mt-1 flex flex-col gap-1.5">
            {variables.fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-1.5">
                <Input
                  aria-label={`Variable ${index + 1} name`}
                  placeholder="key"
                  className="w-1/3"
                  {...form.register(`variables.${index}.key`)}
                />
                <Input
                  aria-label={`Variable ${index + 1} value`}
                  placeholder="value"
                  {...form.register(`variables.${index}.value`)}
                />
                <Button
                  type="button"
                  aria-label={`Remove variable ${index + 1}`}
                  onClick={() => variables.remove(index)}
                  variant="ghost"
                  size="xs"
                >
                  <X size={13} aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-1">
            <Button
              type="button"
              onClick={() => variables.append({ key: '', value: '' })}
              variant="outline"
              size="xs"
            >
              <Plus size={12} aria-hidden /> Add variable
            </Button>
          </div>
          {variableError ? (
            <p className="text-[11px]" role="alert" style={{ color: 'var(--color-signal-down)' }}>
              {variableError}
            </p>
          ) : null}
        </div>
        <fieldset
          className="flex flex-col gap-1.5 rounded-[3px] border px-3 py-2"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <legend className="nb-rule-label px-1">Project policy</legend>
          <CheckboxOption
            label="Open on controller start"
            description="Create the namespace and dataplane when the controller boots."
            {...form.register('autoOpen')}
          />
          <CheckboxOption
            label="Close when idle"
            description="Remove the dataplane after the configured idle period."
            {...form.register('autoClose')}
          />
          <CheckboxOption
            label="Start nodes on open"
            description="Start every node after the project opens."
            {...form.register('autoStart')}
          />
        </fieldset>
        {pools.isError ? <Notice tone="error">{messageOf(pools.error)}</Notice> : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button type="submit" disabled={createProject.isPending} variant="default" size="sm">
            {createProject.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

const duplicateSchema = z.object({
  name: z.string().min(1, 'enter a name').max(128, 'use at most 128 characters'),
  includeFiles: z.boolean(),
});

type DuplicateValues = z.infer<typeof duplicateSchema>;

/** Duplicate a project as a background job; the new project id arrives on completion. */
export function DuplicateProjectDialog({
  project,
  onOpenChange,
  onCompleted,
}: {
  project: Pick<ProjectRow, 'id' | 'name'>;
  onOpenChange: (open: boolean) => void;
  onCompleted?: (projectId: string) => void;
}) {
  const [job, setJob] = useState<JobRow | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultName = `${project.name} copy`.slice(0, 128);
  const form = useForm<DuplicateValues>({
    resolver: zodResolver(duplicateSchema),
    defaultValues: { name: defaultName, includeFiles: true },
  });

  const duplicate = useMutation({
    ...orpc.projects.duplicate.mutationOptions(),
    onSuccess: (started) => {
      setJob(started);
      void (async () => {
        try {
          const completed = await waitForJob(started.id, { onUpdate: setJob });
          const projectId = jobResultString(completed, 'projectId');
          invalidateProjects();
          setCreatedId(projectId);
          if (projectId) onCompleted?.(projectId);
        } catch (jobError) {
          setError(messageOf(jobError));
        }
      })();
    },
    onError: (mutationError) => setError(messageOf(mutationError)),
  });

  const busy = duplicate.isPending || job?.state === 'running';
  const completed = job?.state === 'completed';

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Duplicate project"
      description="Copies the topology with new identifiers. Node working directories are copied when files are included."
      width={520}
    >
      {completed ? (
        <div className="flex flex-col gap-3">
          <Notice tone="success">
            The duplicate was created{createdId ? ` with project ${createdId.slice(0, 8)}` : ''}.
          </Notice>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)} variant="default" size="sm">
              Done
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            void form.handleSubmit((values) => {
              setError(null);
              duplicate.mutate({
                id: project.id,
                name: values.name.trim(),
                includeFiles: values.includeFiles,
              });
            })(event);
          }}
        >
          {error ? <Notice tone="error">{error}</Notice> : null}
          {job ? (
            <Notice tone="info">
              Duplicating · {Math.round(job.progress)}% · {job.state}
            </Notice>
          ) : null}
          <Field
            label="New name"
            htmlFor="duplicate-name"
            error={form.formState.errors.name?.message}
          >
            <Input id="duplicate-name" autoFocus {...form.register('name')} />
          </Field>
          <CheckboxOption
            label="Include node files"
            description="Copy disks, configs, and other node working directories."
            {...form.register('includeFiles')}
          />
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} variant="default" size="sm">
              {busy ? 'Duplicating…' : 'Duplicate project'}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}

const importSchema = z.object({
  name: z.string().max(128, 'use at most 128 characters'),
});

type ImportValues = z.infer<typeof importSchema>;

/** Chunked upload of a `netlabor.project/1` archive, then the import job. */
export function ImportProjectDialog({
  onOpenChange,
  onCompleted,
}: {
  onOpenChange: (open: boolean) => void;
  onCompleted?: (projectId: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'importing' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const form = useForm<ImportValues>({
    resolver: zodResolver(importSchema),
    defaultValues: { name: '' },
  });

  async function submit(values: ImportValues) {
    if (!file) {
      setError('Choose a .tar.gz project archive first.');
      return;
    }
    setError(null);
    setNotice(null);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase('uploading');
      const uploadId = await uploadFile(
        file,
        (fraction) => setProgress(Math.round(fraction * 50)),
        { signal: controller.signal },
      );
      setPhase('importing');
      const started = await client.projects.import({
        uploadId,
        ...(values.name.trim() === '' ? {} : { name: values.name.trim() }),
      });
      const completed = await waitForJob(started.id, {
        onUpdate: (job) => setProgress(50 + Math.round(job.progress / 2)),
      });
      invalidateProjects();
      const projectId = jobResultString(completed, 'projectId');
      setCreatedId(projectId);
      setPhase('done');
      if (projectId) onCompleted?.(projectId);
    } catch (submitError) {
      setPhase('idle');
      if (submitError instanceof DOMException && submitError.name === 'AbortError') {
        setNotice('Upload cancelled.');
      } else {
        setError(messageOf(submitError));
      }
    } finally {
      abortRef.current = null;
    }
  }

  const busy = phase === 'uploading' || phase === 'importing';

  if (phase === 'done') {
    return (
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Project imported"
        description="Images referenced by the archive that are missing on this controller are reported by the import job."
        width={520}
      >
        <div className="flex flex-col gap-3">
          <Notice tone="success">
            The archive was imported{createdId ? ` as project ${createdId.slice(0, 8)}` : ''}.
          </Notice>
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)} variant="default" size="sm">
              Done
            </Button>
          </DialogFooter>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Import project"
      description="Uploads a netlabor.project/1 tar.gz through the chunked upload API, then runs the import job."
      width={540}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          void form.handleSubmit(submit)(event);
        }}
      >
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="info">{notice}</Notice> : null}
        <Field label="Archive" htmlFor="import-file" hint="A project export from this controller.">
          <Input
            id="import-file"
            type="file"
            accept=".tar.gz,.tgz,application/gzip"
            className=""
            disabled={busy}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
            }}
          />
        </Field>
        {file ? (
          <p className="tabular text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            {file.name} · {file.size.toLocaleString()} bytes
          </p>
        ) : null}
        <Field
          label="Name override"
          htmlFor="import-name"
          hint="Leave empty to keep the name stored in the manifest."
        >
          <Input id="import-name" disabled={busy} {...form.register('name')} />
        </Field>
        {busy ? (
          <div>
            <div className="mb-1 flex justify-between text-[11px]">
              <span style={{ color: 'var(--color-ink-dim)' }}>
                {phase === 'uploading' ? 'Uploading archive' : 'Importing topology'}
              </span>
              <span className="tabular">{progress}%</span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-[1px] border"
              style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
            >
              <div
                className="h-full"
                style={{ width: `${progress}%`, background: 'var(--color-copper)' }}
              />
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            disabled={phase === 'importing'}
            onClick={() => {
              if (phase === 'uploading') abortRef.current?.abort();
              else onOpenChange(false);
            }}
            variant="outline"
            size="sm"
          >
            {phase === 'uploading' ? 'Stop upload' : 'Cancel'}
          </Button>
          <Button type="submit" disabled={busy || !file} variant="default" size="sm">
            <Upload size={14} aria-hidden />
            {busy ? 'Importing…' : 'Upload and import'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Small progress notice shared by the project list. */
export function ExportNotice({
  projectName,
  progress,
  busy,
  error,
  onDismiss,
}: {
  projectName: string;
  progress: number;
  busy: boolean;
  error?: string;
  onDismiss: () => void;
}) {
  if (error) {
    return (
      <Notice tone="error">
        Export of {projectName} failed: {error}
        <button type="button" className="ml-2 underline" onClick={onDismiss}>
          dismiss
        </button>
      </Notice>
    );
  }
  return (
    <Notice tone={busy ? 'info' : 'success'}>
      <span className="inline-flex items-center gap-1">
        {busy ? <Download size={12} aria-hidden /> : null}
        {busy
          ? `Exporting ${projectName} · ${progress}%`
          : `Export of ${projectName} is ready; the download has started.`}
      </span>
      {busy ? null : (
        <button type="button" className="ml-2 underline" onClick={onDismiss}>
          dismiss
        </button>
      )}
    </Notice>
  );
}
