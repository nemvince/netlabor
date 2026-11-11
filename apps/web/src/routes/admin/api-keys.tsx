import { zodResolver } from '@hookform/resolvers/zod';
import { type ApiKeyCreated, type ApiKeyRow, PRIVILEGES, type Privilege } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/Badge.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { CopyButton } from '../../components/CopyButton.tsx';
import { Dialog, DialogFooter } from '../../components/Dialog.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';
import { Field, Input } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { PrivilegeGrid } from '../../components/PrivilegeGrid.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/Table.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { READ_PRIVILEGES } from '../../lib/privileges.ts';
import { queryClient } from '../../lib/queryClient.ts';

const keySchema = z.object({
  name: z.string().min(1, 'enter a key name').max(128, 'use at most 128 characters'),
  scopes: z.array(z.enum(PRIVILEGES)).min(1, 'select at least one scope'),
  expiresAt: z.string(),
});

type KeyValues = z.infer<typeof keySchema>;
type CreatedKey = z.infer<typeof ApiKeyCreated>;

function CreateKeyDialog({
  available,
  onOpenChange,
}: {
  available: Privilege[];
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const form = useForm<KeyValues>({
    resolver: zodResolver(keySchema),
    defaultValues: { name: '', scopes: [], expiresAt: '' },
  });

  const createKey = useMutation({
    ...orpc.auth.apiKeys.create.mutationOptions(),
    onSuccess: (result) => {
      setCreated(result);
      void queryClient.invalidateQueries({ queryKey: orpc.auth.apiKeys.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const selected = form.watch('scopes');

  function toggle(privilege: Privilege) {
    const current = form.getValues('scopes');
    form.setValue(
      'scopes',
      current.includes(privilege)
        ? current.filter((value) => value !== privilege)
        : [...current, privilege],
      { shouldDirty: true },
    );
  }

  function select(values: readonly Privilege[]) {
    form.setValue('scopes', [...values], { shouldDirty: true });
  }

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    let expiresAt: string | undefined;
    if (values.expiresAt.trim() !== '') {
      const parsed = new Date(values.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        form.setError('expiresAt', { message: 'enter a valid date and time' });
        return;
      }
      if (parsed.getTime() <= Date.now()) {
        form.setError('expiresAt', { message: 'expiry must be in the future' });
        return;
      }
      expiresAt = parsed.toISOString();
    }
    createKey.mutate({
      name: values.name.trim(),
      scopes: values.scopes,
      ...(expiresAt ? { expiresAt } : {}),
    });
  });

  if (created) {
    return (
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="API key created"
        description="The plaintext key is shown once. Copy it now; it cannot be retrieved later."
        width={560}
      >
        <div className="flex flex-col gap-3">
          <Notice tone="warn">
            This key cannot be shown again. Store it in your secret manager before closing this
            dialog.
          </Notice>
          <div
            className="rounded-[3px] border p-3"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
          >
            <div className="nb-rule-label">plaintext key</div>
            <div className="mt-1 flex items-start gap-2">
              <code className="tabular min-w-0 flex-1 break-all text-[12px]">
                {created.plaintext}
              </code>
              <CopyButton value={created.plaintext} label="Copy key" />
            </div>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="nb-rule-label">name</dt>
            <dd>{created.key.name}</dd>
            <dt className="nb-rule-label">prefix</dt>
            <dd className="tabular">{created.key.prefix}</dd>
            <dt className="nb-rule-label">scopes</dt>
            <dd className="tabular">{created.key.scopes.length}</dd>
            <dt className="nb-rule-label">expires</dt>
            <dd>{created.key.expiresAt ? formatStamp(created.key.expiresAt) : 'never'}</dd>
          </dl>
          <DialogFooter>
            <button
              type="button"
              className="nb-button"
              data-variant="primary"
              onClick={() => onOpenChange(false)}
            >
              Done
            </button>
          </DialogFooter>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Create API key"
      description="Scopes are capped at your current privileges; a key can never exceed its owner."
      width={720}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="key-name" error={form.formState.errors.name?.message}>
            <Input
              id="key-name"
              placeholder="automation"
              spellCheck={false}
              {...form.register('name')}
            />
          </Field>
          <Field
            label="Expires"
            htmlFor="key-expires"
            hint="Optional. Without an expiry the key stays valid until revoked."
            error={form.formState.errors.expiresAt?.message}
          >
            <Input id="key-expires" type="datetime-local" {...form.register('expiresAt')} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="nb-rule-label">
            Scopes · <span className="tabular">{selected.length}</span> of {available.length}{' '}
            available
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => select(available)}
            >
              All
            </button>
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() =>
                select(READ_PRIVILEGES.filter((privilege) => available.includes(privilege)))
              }
            >
              Read-only
            </button>
            <button type="button" className="nb-button" data-size="sm" onClick={() => select([])}>
              Clear
            </button>
          </span>
        </div>
        {form.formState.errors.scopes ? (
          <Notice tone="error">{form.formState.errors.scopes.message}</Notice>
        ) : null}
        <PrivilegeGrid selected={selected} onToggle={toggle} available={available} />
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className="nb-button"
            data-variant="primary"
            disabled={createKey.isPending}
          >
            {createKey.isPending ? 'Creating…' : 'Create key'}
          </button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function ApiKeysAdminPage() {
  const { me } = useMe();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);

  const keys = useQuery({
    ...orpc.auth.apiKeys.list.queryOptions({ input: {} }),
    enabled: me !== null,
  });

  const revokeKey = useMutation({
    ...orpc.auth.apiKeys.revoke.mutationOptions(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.auth.apiKeys.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
      setRevokeTarget(null);
    },
  });

  if (!me) return <Loading label="Loading account…" />;

  const now = Date.now();

  return (
    <Page>
      <PageHeader
        title="API keys"
        description="Long-lived bearer keys for oRPC and MCP clients. Session-only procedures reject them by design."
        actions={
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            onClick={() => setCreateOpen(true)}
          >
            <Plus size={14} aria-hidden />
            Create key
          </button>
        }
      />

      <div className="mt-5">
        {keys.isPending ? (
          <Loading label="Loading keys…" />
        ) : keys.isError ? (
          <Notice tone="error">{messageOf(keys.error)}</Notice>
        ) : keys.data.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API keys"
            description="Create a key to let a script or MCP client call the controller without a browser session."
            action={
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                onClick={() => setCreateOpen(true)}
              >
                Create key
              </button>
            }
          />
        ) : (
          <Table label="API keys">
            <THead>
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th>Scopes</Th>
              <Th>Created</Th>
              <Th>Last used</Th>
              <Th>Expires</Th>
              <Th>State</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {keys.data.map((key) => {
                const expired = key.expiresAt !== null && new Date(key.expiresAt).getTime() <= now;
                return (
                  <Tr key={key.id}>
                    <Td>
                      <div className="text-[12px]">{key.name}</div>
                    </Td>
                    <Td mono>{key.prefix}</Td>
                    <Td>
                      <span className="tabular text-[12px]">{key.scopes.length}</span>
                      <div
                        className="tabular text-[10px]"
                        style={{ color: 'var(--color-ink-faint)' }}
                        title={key.scopes.join(', ')}
                      >
                        {key.scopes.slice(0, 3).join(', ')}
                        {key.scopes.length > 3 ? ` +${key.scopes.length - 3}` : ''}
                      </div>
                    </Td>
                    <Td mono>{formatStamp(key.createdAt)}</Td>
                    <Td mono>{key.lastUsedAt ? formatStamp(key.lastUsedAt) : 'never'}</Td>
                    <Td mono>{key.expiresAt ? formatStamp(key.expiresAt) : 'never'}</Td>
                    <Td>
                      {key.revokedAt ? (
                        <Badge tone="down">revoked</Badge>
                      ) : expired ? (
                        <Badge tone="warn">expired</Badge>
                      ) : (
                        <Badge tone="up">active</Badge>
                      )}
                    </Td>
                    <Td align="right">
                      {key.revokedAt ? (
                        <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                          {formatStamp(key.revokedAt)}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          onClick={() => setRevokeTarget(key)}
                        >
                          Revoke
                        </button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      {createOpen ? (
        <CreateKeyDialog
          available={me.privileges}
          onOpenChange={(open) => {
            if (!open) setCreateOpen(false);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
            revokeKey.reset();
          }
        }}
        title={revokeTarget ? `Revoke key ${revokeTarget.name}?` : 'Revoke key?'}
        description="Clients using this key lose access immediately. The row stays visible as revoked."
        confirmLabel="Revoke key"
        pending={revokeKey.isPending}
        error={revokeKey.error}
        onConfirm={() => {
          if (revokeTarget) revokeKey.mutate({ id: revokeTarget.id });
        }}
      />
    </Page>
  );
}
