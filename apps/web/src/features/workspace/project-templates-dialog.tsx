import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { SquaresFourIcon as LayoutTemplate, TrashIcon as Trash2   } from '@phosphor-icons/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog } from '../../components/dialog.tsx';
import { Field, Input, Select, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { toast } from '../../components/toast.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';
import { useMe } from '../auth/use-me.ts';

const templateSchema = z.object({
  name: z.string().min(1, 'enter a template name').max(128, 'use at most 128 characters'),
  description: z.string().max(2000, 'use at most 2000 characters'),
});

type TemplateValues = z.infer<typeof templateSchema>;

function invalidateTemplates() {
  void queryClient.invalidateQueries({ queryKey: orpc.projects.templates.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
}

/** Project templates: capture the current project, apply one, or delete one. */
export function ProjectTemplatesDialog({
  project,
  onOpenChange,
}: {
  project: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useMe();
  const navigate = useNavigate();
  const canWrite = can('project.write');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [applyTemplateId, setApplyTemplateId] = useState('');
  const [applyName, setApplyName] = useState('');

  const templates = useQuery({
    ...orpc.projects.templates.list.queryOptions({ input: {} }),
    retry: false,
  });

  const form = useForm<TemplateValues>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: project.name, description: '' },
  });

  const templateRows = templates.data ?? [];
  const create = useMutation({
    ...orpc.projects.templates.create.mutationOptions(),
    onSuccess: (template) => {
      setError(null);
      setNotice(`Template ${template.name} captured from this project.`);
      form.reset({ name: project.name, description: '' });
      invalidateTemplates();
    },
    onError: (createError) => setError(messageOf(createError)),
  });

  const apply = useMutation({
    ...orpc.projects.templates.apply.mutationOptions(),
    onSuccess: (created) => {
      setError(null);
      toast.success(`Project ${created.name} created from the template.`);
      invalidateTemplates();
      void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
      onOpenChange(false);
      void navigate({ to: '/projects/$projectId', params: { projectId: created.id } });
    },
    onError: (applyError) => setError(messageOf(applyError)),
  });

  const remove = useMutation({
    ...orpc.projects.templates.delete.mutationOptions(),
    onSuccess: () => {
      setDeleteConfirmId(null);
      setError(null);
      setNotice('Project template deleted.');
      invalidateTemplates();
    },
    onError: (deleteError) => setError(messageOf(deleteError)),
  });

  function submitCreate(values: TemplateValues) {
    setNotice(null);
    create.mutate({
      projectId: project.id,
      name: values.name,
      description: values.description.trim() === '' ? null : values.description.trim(),
    });
  }

  function submitApply() {
    if (applyTemplateId === '') {
      setError('Choose a template to apply.');
      return;
    }
    if (applyName.trim() === '') {
      setError('Enter a name for the new project.');
      return;
    }
    setError(null);
    setNotice(null);
    apply.mutate({ templateId: applyTemplateId, name: applyName.trim() });
  }

  const pending = create.isPending || apply.isPending || remove.isPending;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Project templates"
      description="A project template stores the topology without a project identity. Applying it creates a new project with fresh IDs."
      width={720}
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice tone="success">{notice}</Notice> : null}

        {templates.isPending ? (
          <Loading label="Reading project templates…" />
        ) : templates.isError ? (
          <Notice tone="error">{messageOf(templates.error)}</Notice>
        ) : templateRows.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
            No project templates exist yet. Capture this project below to create the first one.
          </p>
        ) : (
          <Table label="Project templates">
            <THead>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Created</Th>
              <Th align="right">Action</Th>
            </THead>
            <TBody>
              {templateRows.map((template) => (
                <Tr key={template.id}>
                  <Td>{template.name}</Td>
                  <Td>
                    <span
                      className="block max-w-[260px] truncate"
                      style={{ color: 'var(--color-ink-dim)' }}
                      title={template.description ?? undefined}
                    >
                      {template.description ?? '—'}
                    </span>
                  </Td>
                  <Td mono>{formatStamp(template.createdAt)}</Td>
                  <Td align="right">
                    <span className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        className="nb-button"
                        data-size="sm"
                        data-variant="ghost"
                        disabled={!canWrite || pending}
                        title="Create a project from this template"
                        onClick={() => {
                          setApplyTemplateId(template.id);
                          setApplyName(template.name);
                          setError(null);
                          setNotice(null);
                        }}
                      >
                        Use
                      </button>
                      {deleteConfirmId === template.id ? (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="danger"
                          disabled={pending}
                          onClick={() => remove.mutate({ id: template.id })}
                        >
                          Confirm delete
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          data-variant="ghost"
                          disabled={!canWrite || pending}
                          title={`Delete ${template.name}`}
                          aria-label={`Delete ${template.name}`}
                          onClick={() => setDeleteConfirmId(template.id)}
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

        <form
          className="flex flex-col gap-3 border-t pt-3"
          style={{ borderColor: 'var(--color-rule)' }}
          onSubmit={form.handleSubmit(submitCreate)}
        >
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <LayoutTemplate size={13} aria-hidden /> Capture this project
          </div>
          <Field
            label="Template name"
            htmlFor="template-name"
            error={form.formState.errors.name?.message}
          >
            <Input id="template-name" {...form.register('name')} />
          </Field>
          <Field
            label="Description"
            htmlFor="template-description"
            error={form.formState.errors.description?.message}
          >
            <Textarea
              id="template-description"
              rows={2}
              placeholder="What this topology is for"
              {...form.register('description')}
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              className="nb-button"
              data-size="sm"
              data-variant="primary"
              disabled={!canWrite || pending}
            >
              {create.isPending ? 'Capturing…' : 'Create template'}
            </button>
          </div>
        </form>

        <div
          className="flex flex-col gap-3 border-t pt-3"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <div className="flex items-center gap-1.5 text-[12px] font-medium">
            <LayoutTemplate size={13} aria-hidden /> Apply a template
          </div>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field label="Template" htmlFor="apply-template">
              <Select
                id="apply-template"
                value={applyTemplateId}
                disabled={templates.isPending || pending}
                onChange={(event) => {
                  const id = event.target.value;
                  setApplyTemplateId(id);
                  const chosen = templateRows.find((template) => template.id === id);
                  if (chosen) setApplyName(chosen.name);
                }}
              >
                <option value="">Choose a template</option>
                {templateRows.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="New project name" htmlFor="apply-name">
              <Input
                id="apply-name"
                value={applyName}
                disabled={pending}
                onChange={(event) => setApplyName(event.target.value)}
              />
            </Field>
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              disabled={!canWrite || pending || applyTemplateId === ''}
              onClick={submitApply}
            >
              {apply.isPending ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
