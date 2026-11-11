import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Field, Input } from '../../components/Field.tsx';
import { KeyValueEditor } from '../../components/KeyValueEditor.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading, Page, PageHeader, Section } from '../../components/Page.tsx';
import { toast } from '../../components/Toast.tsx';
import { SecretsSection } from '../../features/admin/SecretsSection.tsx';
import { NotAllowed } from '../../features/auth/require-auth.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/queryClient.ts';

const NUMERIC_SETTINGS = [
  {
    key: 'ui.defaultConsoleRows',
    label: 'Console rows',
    hint: 'Default terminal height for new console tabs.',
  },
  {
    key: 'ui.defaultConsoleCols',
    label: 'Console columns',
    hint: 'Default terminal width for new console tabs.',
  },
  {
    key: 'project.autoCloseIdleMinutes',
    label: 'Auto-close idle minutes',
    hint: 'Projects with auto_close close after this many idle minutes.',
  },
] as const;

export function SettingsAdminPage() {
  const { me, can } = useMe();
  const canRead = can('settings.read') || can('settings.write');
  const canWrite = can('settings.write');
  const [settingsMap, setSettingsMap] = useState<Record<string, unknown>>({});
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    ...orpc.settings.get.queryOptions({ input: {} }),
    enabled: canRead,
  });

  useEffect(() => {
    if (!settings.data) return;
    setSettingsMap(settings.data);
    setNumbers(
      Object.fromEntries(
        NUMERIC_SETTINGS.map((setting) => [
          setting.key,
          String(settings.data?.[setting.key] ?? ''),
        ]),
      ),
    );
  }, [settings.data]);

  const updateSettings = useMutation({
    ...orpc.settings.update.mutationOptions(),
    onSuccess: () => {
      setError(null);
      toast.success('Settings saved.');
      void queryClient.invalidateQueries({ queryKey: orpc.settings.get.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
    },
    onError: (mutationError) => {
        setError(messageOf(mutationError));
    },
  });

  function onSave() {
    const patch: Record<string, unknown> = { ...settingsMap };
    for (const setting of NUMERIC_SETTINGS) {
      const raw = numbers[setting.key]?.trim() ?? '';
      if (raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > 100_000) {
        setError(`${setting.label} must be a number between 0 and 100000.`);
        return;
      }
      patch[setting.key] = value;
    }
    setError(null);
    updateSettings.mutate(patch);
  }

  function onReset() {
    if (!settings.data) return;
    setSettingsMap(settings.data);
    setNumbers(
      Object.fromEntries(
        NUMERIC_SETTINGS.map((setting) => [
          setting.key,
          String(settings.data?.[setting.key] ?? ''),
        ]),
      ),
    );
    setError(null);
  }

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="settings.read" />;

  return (
    <Page wide={false}>
      <PageHeader
        title="Settings"
        description="Global controller settings and encrypted secrets for emulator licenses."
        actions={
          canWrite ? (
            <>
              <button
                type="button"
                className="nb-button"
                onClick={onReset}
                disabled={!settings.data}
              >
                Reset
              </button>
              <button
                type="button"
                className="nb-button"
                data-variant="primary"
                onClick={onSave}
                disabled={updateSettings.isPending || settings.isPending}
              >
                {updateSettings.isPending ? 'Saving…' : 'Save settings'}
              </button>
            </>
          ) : null
        }
      />

      <div className="mt-4 flex flex-col gap-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!canWrite ? (
          <Notice tone="info">
            Your account has settings.read only, so this page is read-only.
          </Notice>
        ) : null}
      </div>

      {settings.isPending ? (
        <Loading label="Loading settings…" />
      ) : settings.isError ? (
        <Notice tone="error">{messageOf(settings.error)}</Notice>
      ) : (
        <>
          <Section
            title="Known settings"
            description="Typed fields for the settings the browser reads directly."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {NUMERIC_SETTINGS.map((setting) => (
                <Field
                  key={setting.key}
                  label={setting.label}
                  htmlFor={`setting-${setting.key}`}
                  hint={setting.hint}
                >
                  <Input
                    id={`setting-${setting.key}`}
                    type="number"
                    min={0}
                    max={100_000}
                    value={numbers[setting.key] ?? ''}
                    disabled={!canWrite}
                    onChange={(event) =>
                      setNumbers((previous) => ({ ...previous, [setting.key]: event.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
          </Section>

          <Section
            title="Settings map"
            description="Every key the controller stores. Values typed as digits or true/false keep their JSON type. Save upserts each key; removing a row here does not delete the stored entry."
          >
            <KeyValueEditor
              ariaLabel="Settings map"
              value={settingsMap}
              onChange={setSettingsMap}
              disabled={!canWrite}
              keyPlaceholder="setting key"
              valuePlaceholder="value (text, number, true/false)"
            />
          </Section>

          <SecretsSection canWrite={canWrite} />
        </>
      )}
    </Page>
  );
}
