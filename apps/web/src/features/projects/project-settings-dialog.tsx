import { zodResolver } from '@hookform/resolvers/zod';
import type { ProjectRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PlusIcon as Plus, SlidersHorizontalIcon as SlidersHorizontal, UsersIcon as UsersRound, XIcon as X   } from '@phosphor-icons/react';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { CheckboxOption, Field, Input, Select, Textarea } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { TabBar } from '../../components/tab-bar.tsx';
import { toast } from '../../components/toast.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
import { useMe } from '../auth/use-me.ts';
import { ProjectAccessPanel } from './project-access-panel.tsx';

const settingsSchema = z.object({
  name: z.string().min(1, 'enter a project name').max(128, 'use at most 128 characters'),
  description: z.string().max(2000, 'use at most 2000 characters'),
  poolId: z.string(),
  ownerId: z.string(),
  variables: z.array(z.object({ key: z.string(), value: z.string() })),
  autoOpen: z.boolean(),
  autoClose: z.boolean(),
  autoStart: z.boolean(),
});

type SettingsValues = z.infer<typeof settingsSchema>;
type SettingsTab = 'general' | 'access';

function invalidateProject() {
  void queryClient.invalidateQueries({ queryKey: orpc.projects.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.get.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.projects.stats.key() });
}

/** Project metadata, policy, variables, and the people who can reach it. */
export function ProjectSettingsDialog({
  project,
  initialTab = 'general',
  onOpenChange,
}: {
  project: ProjectRow;
  initialTab?: SettingsTab;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useMe();
  const canWrite = can('project.write');
  const canMembers = can('project.members');
  const [tab, setTab] = useState<SettingsTab>(() => {
    if (initialTab === 'access' && canMembers) return 'access';
    return canWrite ? 'general' : 'access';
  });

  const tabs = [
    ...(canWrite ? [{ id: 'general' as const, label: 'General', icon: SlidersHorizontal }] : []),
    ...(canMembers ? [{ id: 'access' as const, label: 'Access', icon: UsersRound }] : []),
  ];

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Settings · ${project.name}`}
      description="Metadata, policy, and the users or groups that can reach this project."
      width={680}
    >
      {tabs.length > 1 ? (
        <TabBar label="Project settings" value={tab} items={tabs} onChange={setTab} />
      ) : null}
      <div className="pt-4">
        {tab === 'general' ? (
          <GeneralSettings project={project} onOpenChange={onOpenChange} />
        ) : (
          <ProjectAccessPanel projectId={project.id} />
        )}
      </div>
    </Dialog>
  );
}

function GeneralSettings({
  project,
  onOpenChange,
}: {
  project: ProjectRow;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = useMe();
  const canReadPeople = can('user.read');
  const [serverError, setServerError] = useState<string | null>(null);
  const [variableError, setVariableError] = useState<string | null>(null);
  const pools = useQuery(orpc.pools.list.queryOptions({ input: {} }));
  const users = useQuery({
    ...orpc.users.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    enabled: canReadPeople,
    retry: false,
  });

  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      poolId: project.poolId ?? '',
      ownerId: project.ownerId,
      variables: Object.entries(project.variables).map(([key, value]) => ({ key, value })),
      autoOpen: project.autoOpen,
      autoClose: project.autoClose,
      autoStart: project.autoStart,
    },
  });
  const variables = useFieldArray({ control: form.control, name: 'variables' });

  const save = useMutation({
    ...orpc.projects.update.mutationOptions(),
    onSuccess: () => {
      invalidateProject();
      toast.success('Project settings saved.');
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
    save.mutate({
      id: project.id,
      name: values.name.trim(),
      description: values.description.trim() === '' ? null : values.description.trim(),
      poolId: values.poolId === '' ? null : values.poolId,
      ...(canReadPeople && values.ownerId ? { ownerId: values.ownerId } : {}),
      variables: variablesMap,
      autoOpen: values.autoOpen,
      autoClose: values.autoClose,
      autoStart: values.autoStart,
    });
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      {serverError ? <Notice tone="error">{serverError}</Notice> : null}
      {project.locked ? (
        <Notice tone="info">Unlock the topology to change these settings.</Notice>
      ) : null}
      <Field label="Name" htmlFor="settings-name" error={form.formState.errors.name?.message}>
        <Input id="settings-name" autoFocus {...form.register('name')} />
      </Field>
      <Field label="Description" htmlFor="settings-description">
        <Textarea
          id="settings-description"
          rows={2}
          placeholder="What this lab demonstrates"
          {...form.register('description')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Pool"
          htmlFor="settings-pool"
          hint="Leave empty to resolve the compute per node."
        >
          <Select id="settings-pool" {...form.register('poolId')}>
            <option value="">No pool</option>
            {(pools.data ?? []).map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Owner"
          htmlFor="settings-owner"
          hint={
            canReadPeople
              ? 'The owner always holds the owner role on this project.'
              : 'Requires the user.read privilege to change.'
          }
        >
          {canReadPeople ? (
            <Select id="settings-owner" {...form.register('ownerId')}>
              {(users.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName ? `${user.displayName} (${user.username})` : user.username}
                </option>
              ))}
            </Select>
          ) : (
            <Input id="settings-owner" readOnly value={project.ownerName} />
          )}
        </Field>
      </div>

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
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="ghost"
                aria-label={`Remove variable ${index + 1}`}
                onClick={() => variables.remove(index)}
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-1">
          <button
            type="button"
            className="nb-button"
            data-size="sm"
            onClick={() => variables.append({ key: '', value: '' })}
          >
            <Plus size={12} aria-hidden /> Add variable
          </button>
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
      {users.isError ? <Notice tone="error">{messageOf(users.error)}</Notice> : null}
      <DialogFooter>
        <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
          Cancel
        </button>
        <button
          type="submit"
          className="nb-button"
          data-variant="primary"
          disabled={save.isPending || project.locked}
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </DialogFooter>
    </form>
  );
}
