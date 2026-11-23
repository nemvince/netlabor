import { zodResolver } from '@hookform/resolvers/zod';
import type { OidcProviderRow, RoleRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  GlobeIcon as Globe,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  TrashIcon as Trash,
} from '@phosphor-icons/react';
import { Fragment, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../../components/badge.tsx';
import { ConfirmDialog } from '../../components/confirm-dialog.tsx';
import { CopyButton } from '../../components/copy-button.tsx';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { EmptyState } from '../../components/empty-state.tsx';
import { CheckboxOption, Field, Input, Select } from '../../components/field.tsx';
import { Notice } from '../../components/notice.tsx';
import { Loading, Page, PageHeader, Section } from '../../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../../components/table.tsx';
import { NotAllowed } from '../../features/auth/require-auth.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp, shortId } from '../../lib/format.ts';
import { queryClient } from '../../lib/query-client.ts';
import { Button } from '@netlabor/ui/components/button';

const providerSchema = z.object({
  name: z.string().min(1, 'enter a name').max(64, 'use at most 64 characters'),
  issuer: z.url('enter the issuer URL, including https://'),
  clientId: z.string().min(1, 'enter the client ID'),
  clientSecret: z.string(),
  scopes: z.string().min(1, 'list at least one scope'),
  groupClaim: z.string().min(1, 'enter the claim name').max(64, 'use at most 64 characters'),
  defaultRoleId: z.string(),
  autoCreate: z.boolean(),
  enabled: z.boolean(),
  groupMappings: z.array(
    z.object({
      key: z.string().max(128),
      value: z.string().max(128),
    }),
  ),
});

type ProviderValues = z.infer<typeof providerSchema>;

function redirectUriFor(providerId: string): string {
  return `${window.location.origin}/auth/oidc/${providerId}/callback`;
}

function invalidateProviders() {
  void queryClient.invalidateQueries({ queryKey: orpc.auth.oidc.list.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.auth.oidc.publicProviders.key() });
  void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
}

function ProviderDialog({
  provider,
  roles,
  onOpenChange,
}: {
  provider?: OidcProviderRow;
  roles: RoleRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ProviderValues>({
    resolver: zodResolver(providerSchema),
    defaultValues: {
      name: provider?.name ?? '',
      issuer: provider?.issuer ?? '',
      clientId: provider?.clientId ?? '',
      clientSecret: '',
      scopes: (provider?.scopes ?? ['openid', 'profile', 'email']).join(', '),
      groupClaim: provider?.groupClaim ?? 'groups',
      defaultRoleId: provider?.defaultRoleId ?? '',
      autoCreate: provider?.autoCreate ?? false,
      enabled: provider?.enabled ?? true,
      groupMappings: provider
        ? Object.entries(provider.groupMappings).map(([key, value]) => ({ key, value }))
        : [],
    },
  });
  const mappings = useFieldArray({ control: form.control, name: 'groupMappings' });

  const createProvider = useMutation({
    ...orpc.auth.oidc.create.mutationOptions(),
    onSuccess: () => {
      invalidateProviders();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });
  const updateProvider = useMutation({
    ...orpc.auth.oidc.update.mutationOptions(),
    onSuccess: () => {
      invalidateProviders();
      onOpenChange(false);
    },
    onError: (error) => setServerError(messageOf(error)),
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    const secret = values.clientSecret.trim();
    if (!provider && secret === '') {
      form.setError('clientSecret', { message: 'a client secret is required for a new provider' });
      return;
    }
    const scopes = values.scopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (scopes.length === 0) {
      form.setError('scopes', { message: 'list at least one scope' });
      return;
    }
    const groupMappings: Record<string, string> = {};
    for (const entry of values.groupMappings) {
      const key = entry.key.trim();
      if (key === '') continue;
      groupMappings[key] = entry.value.trim();
    }
    const base = {
      name: values.name.trim(),
      issuer: values.issuer.trim(),
      clientId: values.clientId.trim(),
      scopes,
      groupClaim: values.groupClaim.trim(),
      groupMappings,
      defaultRoleId: values.defaultRoleId === '' ? null : values.defaultRoleId,
      autoCreate: values.autoCreate,
      enabled: values.enabled,
      ...(secret === '' ? {} : { clientSecret: secret }),
    };
    if (provider) updateProvider.mutate({ id: provider.id, ...base });
    else createProvider.mutate(base);
  });

  const pending = createProvider.isPending || updateProvider.isPending;

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={provider ? `Edit provider ${provider.name}` : 'Add identity provider'}
      description="OpenID Connect discovery, PKCE, group mapping, and JIT account creation."
      width={720}
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
        {serverError ? <Notice tone="error">{serverError}</Notice> : null}
        {provider ? (
          <div
            className="flex flex-wrap items-center gap-2 rounded-[3px] border px-3 py-2"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <span className="nb-rule-label">redirect uri</span>
            <code className="tabular min-w-0 break-all text-[11px]">
              {redirectUriFor(provider.id)}
            </code>
            <CopyButton value={redirectUriFor(provider.id)} label="Copy URI" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="oidc-name" error={form.formState.errors.name?.message}>
            <Input
              id="oidc-name"
              placeholder="corporate-sso"
              spellCheck={false}
              {...form.register('name')}
            />
          </Field>
          <Field
            label="Issuer URL"
            htmlFor="oidc-issuer"
            hint="The provider's discovery base URL. For Entra use https://login.microsoftonline.com/<tenant-id>/v2.0."
            error={form.formState.errors.issuer?.message}
          >
            <Input
              id="oidc-issuer"
              placeholder="https://idp.example.com"
              spellCheck={false}
              {...form.register('issuer')}
            />
          </Field>
          <Field
            label="Client ID"
            htmlFor="oidc-client-id"
            error={form.formState.errors.clientId?.message}
          >
            <Input id="oidc-client-id" spellCheck={false} {...form.register('clientId')} />
          </Field>
          <Field
            label={provider ? 'Client secret (optional)' : 'Client secret'}
            htmlFor="oidc-client-secret"
            hint={provider ? 'Leave blank to keep the stored secret.' : undefined}
            error={form.formState.errors.clientSecret?.message}
          >
            <Input
              id="oidc-client-secret"
              type="password"
              autoComplete="new-password"
              placeholder={provider ? 'unchanged' : ''}
              {...form.register('clientSecret')}
            />
          </Field>
          <Field
            label="Scopes"
            htmlFor="oidc-scopes"
            hint="Comma separated; openid is always required by the provider."
            error={form.formState.errors.scopes?.message}
          >
            <Input id="oidc-scopes" spellCheck={false} {...form.register('scopes')} />
          </Field>
          <Field
            label="Group claim"
            htmlFor="oidc-group-claim"
            hint="ID-token claim that carries group membership."
            error={form.formState.errors.groupClaim?.message}
          >
            <Input id="oidc-group-claim" spellCheck={false} {...form.register('groupClaim')} />
          </Field>
          <Field
            label="Default role"
            htmlFor="oidc-default-role"
            hint={
              roles.length === 0
                ? 'Listing roles requires user.read.'
                : 'Applied to new accounts. Leave unset to put them in the no-privilege pending role until an admin changes it.'
            }
          >
            <Select id="oidc-default-role" {...form.register('defaultRoleId')}>
              <option value="">No default role</option>
              {roles
                .filter((role) => role.name !== 'owner')
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="flex flex-col justify-end gap-1.5 pb-1">
            <CheckboxOption
              label="Create accounts on first sign-in"
              checked={form.watch('autoCreate')}
              onChange={(event) =>
                form.setValue('autoCreate', event.target.checked, { shouldDirty: true })
              }
            />
            <CheckboxOption
              label="Provider enabled"
              checked={form.watch('enabled')}
              onChange={(event) =>
                form.setValue('enabled', event.target.checked, { shouldDirty: true })
              }
            />
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-2 border-t pt-3"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <span className="nb-rule-label">group mappings · claim value → app group</span>
          <Button
            type="button"
            onClick={() => mappings.append({ key: '', value: '' })}
            variant="outline"
            size="xs"
          >
            <Plus size={12} aria-hidden />
            Add mapping
          </Button>
        </div>
        {mappings.fields.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
            No mappings: provider groups do not grant app groups.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {mappings.fields.map((field, index) => (
              <div key={field.id} className="flex items-center gap-2">
                <Input
                  aria-label={`Mapping ${index + 1} provider group`}
                  placeholder="provider group value"
                  spellCheck={false}
                  {...form.register(`groupMappings.${index}.key`)}
                />
                <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  →
                </span>
                <Input
                  aria-label={`Mapping ${index + 1} app group`}
                  placeholder="app group name"
                  spellCheck={false}
                  {...form.register(`groupMappings.${index}.value`)}
                />
                <Button
                  type="button"
                  aria-label={`Remove mapping ${index + 1}`}
                  onClick={() => mappings.remove(index)}
                  variant="ghost"
                  size="xs"
                >
                  <Trash size={13} aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button type="submit" disabled={pending} variant="default" size="sm">
            {pending ? 'Saving…' : provider ? 'Save provider' : 'Add provider'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function OidcAdminPage() {
  const { me, can } = useMe();
  const canWrite = can('settings.write');
  const canReadUsers = can('user.read');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; provider: OidcProviderRow } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<OidcProviderRow | null>(null);

  const providers = useQuery({
    ...orpc.auth.oidc.list.queryOptions({ input: {} }),
    enabled: canWrite,
  });
  const roles = useQuery({
    ...orpc.roles.list.queryOptions({ input: {} }),
    enabled: canWrite && canReadUsers,
  });

  const deleteProvider = useMutation({
    ...orpc.auth.oidc.delete.mutationOptions(),
    onSuccess: () => {
      invalidateProviders();
      setDeleteTarget(null);
    },
  });

  function toggleRow(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!me) return <Loading label="Loading account…" />;
  if (!canWrite) return <NotAllowed requirement="settings.write" />;

  const roleRows = roles.data ?? [];
  const roleName = (id: string | null): string => {
    if (!id) return '—';
    return roleRows.find((role) => role.id === id)?.name ?? shortId(id);
  };

  return (
    <Page>
      <PageHeader
        title="Single sign-on"
        description="OpenID Connect providers. Configure allowed redirect URIs on the provider before enabling one."
        actions={
          <Button
            type="button"
            onClick={() => setDialog({ mode: 'create' })}
            variant="default"
            size="sm"
          >
            <Plus size={14} aria-hidden />
            Add provider
          </Button>
        }
      />

      <div className="mt-5">
        {providers.isPending ? (
          <Loading label="Loading providers…" />
        ) : providers.isError ? (
          <Notice tone="error">{messageOf(providers.error)}</Notice>
        ) : providers.data.length === 0 ? (
          <EmptyState
            icon={Globe}
            title="No identity providers"
            description="Add an OpenID Connect provider so accounts can sign in through your identity platform."
            action={
              <Button
                type="button"
                onClick={() => setDialog({ mode: 'create' })}
                variant="default"
                size="sm"
              >
                Add provider
              </Button>
            }
          />
        ) : (
          <Table label="OIDC providers">
            <THead>
              <Th> </Th>
              <Th>Provider</Th>
              <Th>Issuer</Th>
              <Th>Client ID</Th>
              <Th>Default role</Th>
              <Th>State</Th>
              <Th align="right">Actions</Th>
            </THead>
            <TBody>
              {providers.data.map((provider) => {
                const open = expanded.has(provider.id);
                return (
                  <Fragment key={provider.id}>
                    <Tr>
                      <Td>
                        <Button
                          type="button"
                          aria-label={open ? 'Hide provider details' : 'Show provider details'}
                          aria-expanded={open}
                          onClick={() => toggleRow(provider.id)}
                          variant="ghost"
                          size="xs"
                        >
                          {open ? (
                            <ChevronDown size={13} aria-hidden />
                          ) : (
                            <ChevronRight size={13} aria-hidden />
                          )}
                        </Button>
                      </Td>
                      <Td>
                        <div className="tabular text-[12px]">{provider.name}</div>
                        <div
                          className="tabular text-[11px]"
                          style={{ color: 'var(--color-ink-faint)' }}
                        >
                          {shortId(provider.id)}
                        </div>
                      </Td>
                      <Td>
                        <span className="tabular text-[11px]" title={provider.issuer}>
                          {provider.issuer}
                        </span>
                      </Td>
                      <Td mono>{provider.clientId}</Td>
                      <Td>
                        <span className="tabular text-[12px]">
                          {roleName(provider.defaultRoleId)}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {provider.enabled ? (
                            <Badge tone="up">enabled</Badge>
                          ) : (
                            <Badge tone="down">disabled</Badge>
                          )}
                          {provider.autoCreate ? <Badge tone="copper">auto-create</Badge> : null}
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="inline-flex items-center gap-0.5">
                          <Button
                            type="button"
                            aria-label={`Edit provider ${provider.name}`}
                            title="Edit provider"
                            onClick={() => setDialog({ mode: 'edit', provider })}
                            variant="ghost"
                            size="xs"
                          >
                            <Pencil size={13} aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            aria-label={`Delete provider ${provider.name}`}
                            title="Delete provider"
                            onClick={() => setDeleteTarget(provider)}
                            variant="ghost"
                            size="xs"
                          >
                            <Trash size={13} aria-hidden />
                          </Button>
                        </span>
                      </Td>
                    </Tr>
                    {open ? (
                      <tr
                        className="border-b last:border-b-0"
                        style={{
                          borderColor: 'var(--color-rule)',
                          background: 'var(--color-panel-sunken)',
                        }}
                      >
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="nb-rule-label">redirect uri</span>
                              <code className="tabular min-w-0 break-all text-[11px]">
                                {redirectUriFor(provider.id)}
                              </code>
                              <CopyButton value={redirectUriFor(provider.id)} label="Copy URI" />
                            </div>
                            <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                              The provider must allow exactly this URI. It is computed from the
                              current browser origin and the provider id.
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="nb-rule-label">scopes</span>
                              <span className="flex flex-wrap gap-1">
                                {provider.scopes.map((scope) => (
                                  <Badge key={scope} tone="neutral">
                                    {scope}
                                  </Badge>
                                ))}
                              </span>
                              <span className="nb-rule-label ml-3">group claim</span>
                              <span className="tabular text-[11px]">{provider.groupClaim}</span>
                            </div>
                            <div>
                              <div className="nb-rule-label mb-1">group mappings</div>
                              {Object.entries(provider.groupMappings).length === 0 ? (
                                <p
                                  className="text-[11px]"
                                  style={{ color: 'var(--color-ink-faint)' }}
                                >
                                  none
                                </p>
                              ) : (
                                <ul className="flex flex-col gap-0.5">
                                  {Object.entries(provider.groupMappings).map(([claim, group]) => (
                                    <li key={claim} className="tabular text-[11px]">
                                      <span>{claim}</span>
                                      <span style={{ color: 'var(--color-ink-faint)' }}> → </span>
                                      <span>{group}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div
                              className="tabular text-[11px]"
                              style={{ color: 'var(--color-ink-faint)' }}
                            >
                              added {formatStamp(provider.createdAt)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </TBody>
          </Table>
        )}
      </div>

      <Section
        title="How sign-in flows"
        description="Server-side authorization code flow with PKCE."
      >
        <ol
          className="flex list-decimal flex-col gap-1 pl-5 text-[12px]"
          style={{ color: 'var(--color-ink-dim)' }}
        >
          <li>An enabled provider appears as a button on the sign-in page.</li>
          <li>
            The controller redirects to the provider, then verifies issuer, audience, nonce, and
            signature.
          </li>
          <li>
            Claim groups map through the table above and grant app groups. New accounts get the
            default role, or the no-privilege <code>pending</code> role when none is set.
          </li>
        </ol>
      </Section>

      {dialog?.mode === 'create' ? (
        <ProviderDialog
          roles={roleRows}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}
      {dialog?.mode === 'edit' ? (
        <ProviderDialog
          provider={dialog.provider}
          roles={roleRows}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            deleteProvider.reset();
          }
        }}
        title={deleteTarget ? `Delete provider ${deleteTarget.name}?` : 'Delete provider?'}
        description="Sign-in through this provider stops immediately. External identities stored for it are removed; local passwords keep working."
        confirmLabel="Delete provider"
        pending={deleteProvider.isPending}
        error={deleteProvider.error}
        onConfirm={() => {
          if (deleteTarget) deleteProvider.mutate({ id: deleteTarget.id });
        }}
      />
    </Page>
  );
}
