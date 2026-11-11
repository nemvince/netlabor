import { zodResolver } from '@hookform/resolvers/zod';
import type { SessionRow } from '@netlabor/contract';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Badge } from '../components/Badge.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { Field, Input } from '../components/Field.tsx';
import { KeyValueEditor } from '../components/KeyValueEditor.tsx';
import { Notice } from '../components/Notice.tsx';
import { Loading, Page, PageHeader, RuleRow, Section } from '../components/Page.tsx';
import { Table, TBody, Td, THead, Th, Tr } from '../components/Table.tsx';
import { toast } from '../components/Toast.tsx';
import { useMe } from '../features/auth/use-me.ts';
import { orpc } from '../lib/api.ts';
import { messageOf } from '../lib/errors.ts';
import { formatStamp, formatUserAgent, shortId } from '../lib/format.ts';
import { queryClient } from '../lib/queryClient.ts';

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

  function onSavePreferences() {
    setPreferencesError(null);
    savePreferences.mutate({ value: preferencesDraft });
  }

  if (!me) return <Loading label="Loading account…" />;

  return (
    <Page>
      <PageHeader
        title="Profile"
        description="Your identity, credentials, sessions, and preferences."
        actions={<Badge tone="copper">@{me.username}</Badge>}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Section title="Identity">
          <div className="nb-panel overflow-hidden" style={{ borderColor: 'var(--color-rule)' }}>
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
              <span className="tabular">{me.projectGrants.length}</span>
            </RuleRow>
            <RuleRow label="Account">
              {me.isActive ? <Badge tone="up">active</Badge> : <Badge tone="down">disabled</Badge>}
            </RuleRow>
          </div>
        </Section>

        <Section
          title="Change password"
          description="At least 12 characters. Changing it signs out every session, including this one."
        >
          <form className="nb-panel flex flex-col gap-3 p-4" onSubmit={onSubmitPassword} noValidate>
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
        </Section>
      </div>

      <Section
        title="Active sessions"
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
      </Section>

      <Section
        title="Preferences"
        description="Values stored with your account and read by the browser app."
        actions={
          <button
            type="button"
            className="nb-button"
            data-variant="primary"
            data-size="sm"
            onClick={onSavePreferences}
            disabled={savePreferences.isPending}
          >
            {savePreferences.isPending ? 'Saving…' : 'Save preferences'}
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {preferencesError ? <Notice tone="error">{preferencesError}</Notice> : null}
          <KeyValueEditor
            ariaLabel="Preferences"
            value={preferencesDraft}
            onChange={setPreferencesDraft}
            disabled={preferences.isPending}
            keyPlaceholder="preference key"
            valuePlaceholder="value (text, number, true/false)"
          />
        </div>
      </Section>

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
