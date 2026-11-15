import { zodResolver } from '@hookform/resolvers/zod';
import type { SessionRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { KeyIcon as KeyRound, MonitorIcon as Monitor, SlidersHorizontalIcon as SlidersHorizontal, DeviceMobileIcon as Smartphone, UserIcon as UserRound, WrenchIcon as Wrench   } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../components/badge.tsx';
import { ConfirmDialog } from '../components/confirm-dialog.tsx';
import { Field, Input } from '../components/field.tsx';
import { KeyValueEditor } from '../components/key-value-editor.tsx';
import { Notice } from '../components/notice.tsx';
import { Loading, Page, PageHeader, RuleRow } from '../components/page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../components/table.tsx';
import { toast } from '../components/toast.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { CardRows, SettingsCard, SettingsIcon } from '../features/settings/settings-card.tsx';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { formatStamp, formatUserAgent, shortId } from '../lib/format.ts';
import { queryClient } from '../lib/query-client.ts';

const passwordSchema = z
  .object({
    current: z.string().min(1, 'enter your current password').max(256),
    next: z.string().min(12, 'use at least 12 characters').max(256, 'use at most 256 characters'),
    confirm: z.string().min(1, 'repeat the new password'),
  })
  .refine((values) => values.next === values.confirm, {
    message: 'passwords do not match',
    path: ['confirm'],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

const PREFERENCE_FIELDS = [
  {
    key: 'ui.defaultConsoleRows',
    label: 'Console rows',
    hint: 'Terminal height when you open a console tab.',
    min: 4,
    max: 200,
  },
  {
    key: 'ui.defaultConsoleCols',
    label: 'Console columns',
    hint: 'Terminal width when you open a console tab.',
    min: 20,
    max: 400,
  },
] as const;

function preferenceError(value: unknown, range: { min: number; max: number }): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return 'Use a whole number.';
    if (value < range.min || value > range.max) {
      return `Use between ${range.min} and ${range.max}.`;
    }
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return 'Enter a number, or remove the key under Advanced.';
  }
  return 'Use a whole number.';
}

function DeviceGlyph({ userAgent }: { userAgent: string | null }) {
  const mobile = /iphone|ipad|android|mobile|tablet/i.test(userAgent ?? '');
  const Icon = mobile ? Smartphone : Monitor;
  return (
    <Icon size={13} aria-hidden className="shrink-0" style={{ color: 'var(--color-ink-faint)' }} />
  );
}

export function ProfilePage() {
  const { me } = useMe();
  const navigate = useNavigate();
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [preferencesDraft, setPreferencesDraft] = useState<Record<string, unknown>>({});
  const [preferencesError, setPreferencesError] = useState<string | null>(null);

  const sessions = useQuery({
    ...orpc.auth.sessions.list.queryOptions({ input: {} }),
    enabled: me !== null,
  });
  const preferences = useQuery({
    ...orpc.preferences.get.queryOptions({ input: {} }),
    enabled: me !== null,
  });

  useEffect(() => {
    if (preferences.data) setPreferencesDraft(preferences.data);
  }, [preferences.data]);

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: '', next: '', confirm: '' },
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const changePassword = useMutation({
    ...orpc.auth.password.change.mutationOptions(),
    onSuccess: () => {
      queryClient.clear();
      void navigate({ to: '/login', search: { notice: 'password-changed' }, replace: true });
    },
    onError: (error) => setPasswordError(messageOf(error)),
  });

  const revokeSession = useMutation({
    ...orpc.auth.sessions.revoke.mutationOptions(),
    onSuccess: () => {
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: orpc.auth.sessions.list.key() });
    },
  });

  const savePreferences = useMutation({
    ...orpc.preferences.update.mutationOptions(),
    onSuccess: () => {
      setPreferencesError(null);
      toast.success('Preferences saved.');
      void queryClient.invalidateQueries({ queryKey: orpc.preferences.get.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
    },
    onError: (error) => {
      setPreferencesError(messageOf(error));
    },
  });

  const onSubmitPassword = passwordForm.handleSubmit((values) => {
    setPasswordError(null);
    changePassword.mutate({ current: values.current, next: values.next });
  });

  const preferenceFields = PREFERENCE_FIELDS.filter(
    (field) => preferencesDraft[field.key] !== undefined,
  ).map((field) => ({
    ...field,
    value: preferencesDraft[field.key],
    error: preferenceError(preferencesDraft[field.key], field),
  }));
  const hasPreferenceErrors = preferenceFields.some((field) => field.error !== null);

  function onPreferenceChange(key: string, raw: string) {
    const text = raw.trim();
    setPreferencesDraft((previous) => ({
      ...previous,
      [key]: text === '' ? '' : /^-?\d+$/.test(text) ? Number(text) : raw,
    }));
  }

  function onSavePreferences() {
    if (hasPreferenceErrors) return;
    setPreferencesError(null);
    savePreferences.mutate({ value: preferencesDraft });
  }

  if (!me) return <Loading label="Loading account…" />;

  return (
    <Page>
      <PageHeader
        title="Profile & preferences"
        description="Your identity, credentials, sessions, and the defaults this browser uses for you."
        actions={<Badge tone="copper">@{me.username}</Badge>}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SettingsCard
          icon={UserRound}
          title="Account"
          description="The identity this session signs in as, with its roles and project grants."
        >
          <CardRows>
            <RuleRow label="Username">
              <span className="tabular">{me.username}</span>
            </RuleRow>
            <RuleRow label="Display name">{me.displayName ?? '—'}</RuleRow>
            <RuleRow label="Email">{me.email ?? '—'}</RuleRow>
            <RuleRow label="Roles">
              {me.roles.length === 0 ? (
                <span style={{ color: 'var(--color-ink-faint)' }}>no roles</span>
              ) : (
                <span className="flex flex-wrap justify-end gap-1">
                  {me.roles.map((role) => (
                    <Badge key={role} tone="neutral">
                      {role}
                    </Badge>
                  ))}
                </span>
              )}
            </RuleRow>
            <RuleRow label="Project grants">
              {me.projectGrants.length === 0 ? (
                <span style={{ color: 'var(--color-ink-faint)' }}>no grants</span>
              ) : (
                <span className="flex flex-wrap justify-end gap-1">
                  {me.projectGrants.map((grant) => (
                    <Badge key={grant.projectId} tone="neutral" title={grant.projectId}>
                      {grant.role} · {shortId(grant.projectId)}
                    </Badge>
                  ))}
                </span>
              )}
            </RuleRow>
            <RuleRow label="Account">
              {me.isActive ? <Badge tone="up">active</Badge> : <Badge tone="down">disabled</Badge>}
            </RuleRow>
          </CardRows>
        </SettingsCard>

        <SettingsCard
          icon={KeyRound}
          title="Password"
          description="Choose a new password. The rules are the same ones the controller enforces."
        >
          <ul
            className="mb-3 flex list-disc flex-col gap-0.5 pl-4 text-[11px]"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            <li>At least 12 characters, at most 256.</li>
            <li>Both new password fields must match.</li>
            <li>Your current password is required.</li>
            <li>Changing it signs out every session, including this one.</li>
          </ul>
          <form className="flex flex-col gap-3" onSubmit={onSubmitPassword} noValidate>
            {passwordError ? <Notice tone="error">{passwordError}</Notice> : null}
            <Field
              label="Current password"
              htmlFor="password-current"
              error={passwordForm.formState.errors.current?.message}
            >
              <Input
                id="password-current"
                type="password"
                autoComplete="current-password"
                {...passwordForm.register('current')}
              />
            </Field>
            <Field
              label="New password"
              htmlFor="password-next"
              hint="Minimum 12 characters, maximum 256."
              error={passwordForm.formState.errors.next?.message}
            >
              <Input
                id="password-next"
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('next')}
              />
            </Field>
            <Field
              label="Repeat new password"
              htmlFor="password-confirm"
              error={passwordForm.formState.errors.confirm?.message}
            >
              <Input
                id="password-confirm"
                type="password"
                autoComplete="new-password"
                {...passwordForm.register('confirm')}
              />
            </Field>
            <div className="flex justify-end">
              <button
                type="submit"
                className="nb-button"
                data-variant="primary"
                disabled={changePassword.isPending}
              >
                {changePassword.isPending ? 'Changing…' : 'Change password'}
              </button>
            </div>
          </form>
        </SettingsCard>
      </div>

      <div className="mt-4">
        <SettingsCard
          icon={Monitor}
          title="Sessions"
          description="Each row is one signed-in browser. Revoking a session takes effect immediately."
          actions={
            <button
              type="button"
              className="nb-button"
              data-size="sm"
              onClick={() => void sessions.refetch()}
              disabled={sessions.isFetching}
            >
              {sessions.isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          }
        >
          {sessions.isPending ? (
            <Loading label="Loading sessions…" />
          ) : sessions.isError ? (
            <Notice tone="error">{messageOf(sessions.error)}</Notice>
          ) : (
            <Table label="Active sessions">
              <THead>
                <Th>Device</Th>
                <Th>IP</Th>
                <Th>Created</Th>
                <Th>Last seen</Th>
                <Th>Expires</Th>
                <Th align="right">Actions</Th>
              </THead>
              <TBody>
                {sessions.data.map((session) => (
                  <Tr key={session.id}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <DeviceGlyph userAgent={session.userAgent} />
                        <span title={session.userAgent ?? undefined}>
                          {formatUserAgent(session.userAgent)}
                        </span>
                        {session.current ? <Badge tone="copper">this session</Badge> : null}
                      </div>
                      <div
                        className="tabular text-[11px]"
                        style={{ color: 'var(--color-ink-faint)' }}
                      >
                        {shortId(session.id)}
                      </div>
                    </Td>
                    <Td mono>{session.ip ?? '—'}</Td>
                    <Td mono>{formatStamp(session.createdAt)}</Td>
                    <Td mono>{formatStamp(session.lastSeenAt)}</Td>
                    <Td mono>{formatStamp(session.expiresAt)}</Td>
                    <Td align="right">
                      {session.current ? (
                        <span className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                          sign out to end
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="nb-button"
                          data-size="sm"
                          onClick={() => setRevokeTarget(session)}
                        >
                          Revoke
                        </button>
                      )}
                    </Td>
                  </Tr>
                ))}
                {sessions.data.length === 0 ? (
                  <Tr>
                    <Td colSpan={6} className="text-center">
                      <span style={{ color: 'var(--color-ink-faint)' }}>
                        No sessions are recorded.
                      </span>
                    </Td>
                  </Tr>
                ) : null}
              </TBody>
            </Table>
          )}
        </SettingsCard>
      </div>

      <div className="mt-4">
        <SettingsCard
          icon={SlidersHorizontal}
          title="Preferences"
          description="Values stored with your account and read by the browser app. They override controller defaults for you only."
          actions={
            <button
              type="button"
              className="nb-button"
              data-variant="primary"
              data-size="sm"
              onClick={onSavePreferences}
              disabled={savePreferences.isPending || hasPreferenceErrors}
            >
              {savePreferences.isPending ? 'Saving…' : 'Save preferences'}
            </button>
          }
        >
          <div className="flex flex-col gap-2">
            {preferencesError ? <Notice tone="error">{preferencesError}</Notice> : null}
            {preferenceFields.length === 0 ? (
              <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                No ui.* preferences are set for this account. Add them under Advanced to override
                the controller's console defaults.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {preferenceFields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    htmlFor={`preference-${field.key}`}
                    hint={field.hint}
                    error={field.error ?? undefined}
                  >
                    <Input
                      id={`preference-${field.key}`}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={field.min}
                      max={field.max}
                      value={String(field.value ?? '')}
                      disabled={preferences.isPending}
                      onChange={(event) => onPreferenceChange(field.key, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
            )}

            <details
              className="mt-1 rounded-[2px] border"
              style={{ borderColor: 'var(--color-rule)' }}
            >
              <summary className="cursor-pointer px-3 py-2">
                <span className="flex items-start gap-2.5">
                  <SettingsIcon icon={Wrench} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">
                      Advanced — raw preference keys
                    </span>
                    <span className="block text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      Unsupported. Edit the stored map directly; removing a key here removes the
                      stored preference.
                    </span>
                  </span>
                </span>
              </summary>
              <div className="border-t px-3 py-3" style={{ borderColor: 'var(--color-rule)' }}>
                <KeyValueEditor
                  ariaLabel="Preferences"
                  value={preferencesDraft}
                  onChange={setPreferencesDraft}
                  disabled={preferences.isPending}
                  keyPlaceholder="preference key"
                  valuePlaceholder="value (text, number, true/false)"
                />
              </div>
            </details>
          </div>
        </SettingsCard>
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeTarget(null);
            revokeSession.reset();
          }
        }}
        title="Revoke session"
        description={
          revokeTarget
            ? `${formatUserAgent(revokeTarget.userAgent)} at ${revokeTarget.ip ?? 'unknown IP'} loses access immediately.`
            : 'This session loses access immediately.'
        }
        confirmLabel="Revoke session"
        pending={revokeSession.isPending}
        error={revokeSession.error}
        onConfirm={() => {
          if (revokeTarget) revokeSession.mutate({ id: revokeTarget.id });
        }}
      />
    </Page>
  );
}
