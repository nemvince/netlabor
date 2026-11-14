import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Download,
  KeyRound,
  RefreshCw,
  RotateCcw,
  TerminalSquare,
  Timer,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Field } from '../../components/Field.tsx';
import { displaySettingValue, KeyValueEditor } from '../../components/KeyValueEditor.tsx';
import { Notice } from '../../components/Notice.tsx';
import { Loading, Page, PageHeader } from '../../components/Page.tsx';
import { toast } from '../../components/Toast.tsx';
import { UnitInput } from '../../components/UnitInput.tsx';
import { SecretsSection } from '../../features/admin/SecretsSection.tsx';
import { NotAllowed } from '../../features/auth/require-auth.tsx';
import { useMe } from '../../features/auth/use-me.ts';
import { SettingsCard, SettingsIcon } from '../../features/settings/SettingsCard.tsx';
import { SettingsNav } from '../../features/settings/SettingsNav.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { formatStamp } from '../../lib/format.ts';
import { queryClient } from '../../lib/queryClient.ts';
import { versionLabel } from '../../lib/version.ts';

const ROWS_KEY = 'ui.defaultConsoleRows';
const COLS_KEY = 'ui.defaultConsoleCols';
const IDLE_KEY = 'project.autoCloseIdleMinutes';
const CHANNEL_KEY = 'update.channel';

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 80;
const DEFAULT_IDLE_MINUTES = 10;
const MAX_IDLE_MINUTES = 10_080;

const ROWS_RANGE = { min: 4, max: 200 } as const;
const COLS_RANGE = { min: 20, max: 400 } as const;
const IDLE_RANGE = { min: 1, max: MAX_IDLE_MINUTES } as const;

interface Range {
  min: number;
  max: number;
}

/** Inline validation for the numeric settings; the message names the fix. */
function rangeError(raw: string, range: Range, unit: string): string | null {
  const text = raw.trim();
  if (text === '') return `Enter a whole number of ${unit}s.`;
  const value = Number(text);
  if (!Number.isInteger(value)) return `Use a whole number of ${unit}s.`;
  if (value < range.min || value > range.max) {
    return `Use between ${range.min} and ${range.max} ${unit}s.`;
  }
  return null;
}

/** Order-independent comparison of stored settings maps. */
function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function buildPatch(
  map: Record<string, unknown>,
  rows: string,
  cols: string,
  idleEnabled: boolean,
  idle: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...map };
  patch[ROWS_KEY] = Number(rows);
  patch[COLS_KEY] = Number(cols);
  patch[IDLE_KEY] = idleEnabled ? Number(idle) : 0;
  return patch;
}

export function SettingsAdminPage() {
  const { me, can } = useMe();
  const canRead = can('settings.read') || can('settings.write');
  const canWrite = can('settings.write');
  const [map, setMap] = useState<Record<string, unknown>>({});
  const [rowsText, setRowsText] = useState('');
  const [colsText, setColsText] = useState('');
  const [idleEnabled, setIdleEnabled] = useState(false);
  const [idleText, setIdleText] = useState(String(DEFAULT_IDLE_MINUTES));
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    ...orpc.settings.get.queryOptions({ input: {} }),
    enabled: canRead,
  });

  const syncFromServer = useCallback((data: Record<string, unknown>) => {
    setMap(data);
    setRowsText(displaySettingValue(data[ROWS_KEY] ?? ''));
    setColsText(displaySettingValue(data[COLS_KEY] ?? ''));
    const idle = Number(data[IDLE_KEY] ?? 0);
    const enabled = Number.isFinite(idle) && idle > 0;
    setIdleEnabled(enabled);
    setIdleText(enabled ? String(idle) : String(DEFAULT_IDLE_MINUTES));
  }, []);

  useEffect(() => {
    if (settings.data) syncFromServer(settings.data);
  }, [settings.data, syncFromServer]);

  const updateSettings = useMutation({
    ...orpc.settings.update.mutationOptions(),
    onSuccess: () => {
      setError(null);
      toast.success('Settings saved.');
      void queryClient.invalidateQueries({ queryKey: orpc.settings.get.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.audit.list.key() });
      void queryClient.invalidateQueries({ queryKey: orpc.updates.check.key() });
    },
    onError: (mutationError) => {
      setError(messageOf(mutationError));
    },
  });

  const updateCheck = useQuery({
    ...orpc.updates.check.queryOptions({ input: {} }),
    enabled: canRead,
    retry: false,
    staleTime: 60_000,
  });

  const installUpdate = useMutation({
    ...orpc.updates.apply.mutationOptions(),
    onSuccess: () => {
      setError(null);
      toast.success('Update installed. The controller is restarting.');
    },
    onError: (mutationError) => {
      setError(messageOf(mutationError));
    },
  });

  const rowsError = rangeError(rowsText, ROWS_RANGE, 'row');
  const colsError = rangeError(colsText, COLS_RANGE, 'column');
  const idleError = idleEnabled ? rangeError(idleText, IDLE_RANGE, 'minute') : null;
  const hasFieldErrors = rowsError !== null || colsError !== null || idleError !== null;
  const channel = map[CHANNEL_KEY] === 'nightly' ? 'nightly' : 'stable';

  const dirty = useMemo(() => {
    if (!settings.data) return false;
    if (hasFieldErrors) return true;
    const patch = buildPatch(map, rowsText, colsText, idleEnabled, idleText);
    return stableValue(patch) !== stableValue(settings.data);
  }, [settings.data, map, rowsText, colsText, idleEnabled, idleText, hasFieldErrors]);

  function onSave() {
    if (hasFieldErrors) {
      setError('Fix the highlighted fields before saving.');
      return;
    }
    setError(null);
    updateSettings.mutate(buildPatch(map, rowsText, colsText, idleEnabled, idleText));
  }

  function onDiscard() {
    if (!settings.data) return;
    syncFromServer(settings.data);
    setError(null);
    updateSettings.reset();
  }

  function onRowsChange(value: string) {
    setRowsText(value);
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isInteger(parsed)) {
      setMap((previous) => ({ ...previous, [ROWS_KEY]: parsed }));
    }
  }

  function onColsChange(value: string) {
    setColsText(value);
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isInteger(parsed)) {
      setMap((previous) => ({ ...previous, [COLS_KEY]: parsed }));
    }
  }

  function onIdleTextChange(value: string) {
    setIdleText(value);
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isInteger(parsed)) {
      setMap((previous) => ({ ...previous, [IDLE_KEY]: parsed }));
    }
  }

  function onIdleToggle(enabled: boolean) {
    setIdleEnabled(enabled);
    if (!enabled) {
      setMap((previous) => ({ ...previous, [IDLE_KEY]: 0 }));
      return;
    }
    const valid = rangeError(idleText, IDLE_RANGE, 'minute') === null;
    if (!valid) setIdleText(String(DEFAULT_IDLE_MINUTES));
    setMap((previous) => ({
      ...previous,
      [IDLE_KEY]: valid ? Number(idleText) : DEFAULT_IDLE_MINUTES,
    }));
  }

  function onConsoleDefaults() {
    setRowsText(String(DEFAULT_ROWS));
    setColsText(String(DEFAULT_COLS));
    setMap((previous) => ({
      ...previous,
      [ROWS_KEY]: DEFAULT_ROWS,
      [COLS_KEY]: DEFAULT_COLS,
    }));
  }

  function onChannel(next: 'stable' | 'nightly') {
    setMap((previous) => ({ ...previous, [CHANNEL_KEY]: next }));
  }

  function onMapChange(next: Record<string, unknown>) {
    setMap(next);
    if (typeof next[ROWS_KEY] === 'number') setRowsText(String(next[ROWS_KEY]));
    if (typeof next[COLS_KEY] === 'number') setColsText(String(next[COLS_KEY]));
    if (typeof next[IDLE_KEY] === 'number') {
      const idle = next[IDLE_KEY];
      setIdleEnabled(idle > 0);
      if (idle > 0) setIdleText(String(idle));
    }
  }

  if (!me) return <Loading label="Loading account…" />;
  if (!canRead) return <NotAllowed requirement="settings.read" />;

  const consoleSample =
    rowsError === null && colsError === null
      ? `${Number(colsText)} columns × ${Number(rowsText)} rows`
      : null;

  return (
    <Page wide={false}>
      <PageHeader
        title="Controller settings"
        description="Defaults the controller hands to every new console and project, its update channel, and the encrypted secrets it stores."
      />
      <SettingsNav />

      <div className="mt-4 flex flex-col gap-2">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {!canWrite ? (
          <Notice tone="info">
            Your account has settings.read only, so this page is read-only. Ask an administrator for
            settings.write to change these values.
          </Notice>
        ) : null}
      </div>

      {settings.isPending ? (
        <Loading label="Loading settings…" />
      ) : settings.isError ? (
        <Notice tone="error">{messageOf(settings.error)}</Notice>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <SettingsCard
            icon={TerminalSquare}
            title="Console defaults"
            description="The terminal size a console tab opens with when a node does not override it. Rows are the height; columns are the width."
            actions={
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                onClick={onConsoleDefaults}
                disabled={!canWrite}
              >
                <RotateCcw size={13} aria-hidden />
                Reset to defaults
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Rows"
                htmlFor="setting-console-rows"
                hint="Terminal height for new console tabs."
                error={rowsError ?? undefined}
              >
                <UnitInput
                  id="setting-console-rows"
                  unit="rows"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={ROWS_RANGE.min}
                  max={ROWS_RANGE.max}
                  value={rowsText}
                  disabled={!canWrite}
                  onChange={(event) => onRowsChange(event.target.value)}
                  aria-describedby="setting-console-sample"
                />
              </Field>
              <Field
                label="Columns"
                htmlFor="setting-console-cols"
                hint="Terminal width for new console tabs."
                error={colsError ?? undefined}
              >
                <UnitInput
                  id="setting-console-cols"
                  unit="columns"
                  type="number"
                  inputMode="numeric"
                  step={1}
                  min={COLS_RANGE.min}
                  max={COLS_RANGE.max}
                  value={colsText}
                  disabled={!canWrite}
                  onChange={(event) => onColsChange(event.target.value)}
                  aria-describedby="setting-console-sample"
                />
              </Field>
            </div>
            <div
              id="setting-console-sample"
              className="mt-3 flex flex-wrap items-center gap-2 rounded-[2px] border px-2.5 py-2"
              style={{
                borderColor: 'var(--color-rule)',
                background: 'var(--color-panel-sunken)',
              }}
            >
              <span className="nb-rule-label">New consoles open at</span>
              <span className="tabular text-[12px]">
                {consoleSample ?? 'set valid rows and columns to preview'}
              </span>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={Timer}
            title="Project lifecycle"
            description="Auto-close shuts down projects that have been idle, so emulator processes and network namespaces do not pile up. Off means a project stays open until someone closes it."
          >
            <fieldset className="border-0 p-0">
              <legend className="text-[12px] font-medium" style={{ color: 'var(--color-ink-dim)' }}>
                Auto-close idle projects
              </legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <label
                  className="flex min-h-7 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 py-1 text-[12px]"
                  style={{
                    borderColor: !idleEnabled ? 'var(--color-rule-strong)' : 'var(--color-rule)',
                    background: !idleEnabled ? 'var(--color-panel-raised)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="setting-auto-close-mode"
                    checked={!idleEnabled}
                    disabled={!canWrite}
                    onChange={() => onIdleToggle(false)}
                  />
                  Off
                </label>
                <label
                  className="flex min-h-7 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 py-1 text-[12px]"
                  style={{
                    borderColor: idleEnabled ? 'var(--color-rule-strong)' : 'var(--color-rule)',
                    background: idleEnabled ? 'var(--color-panel-raised)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="setting-auto-close-mode"
                    checked={idleEnabled}
                    disabled={!canWrite}
                    onChange={() => onIdleToggle(true)}
                  />
                  On
                </label>
              </div>
              <p
                id="setting-auto-close-help"
                className="mt-1 text-[11px]"
                style={{ color: 'var(--color-ink-faint)' }}
              >
                {idleEnabled
                  ? 'Projects with auto-close enabled stop after the idle period below; unsaved console state is lost when they close.'
                  : 'Off is stored as 0 idle minutes. Projects open now stay open until closed manually.'}
              </p>
            </fieldset>
            {idleEnabled ? (
              <div className="mt-3 max-w-xs">
                <Field
                  label="Idle for"
                  htmlFor="setting-auto-close-minutes"
                  hint="Minutes of inactivity before the project closes."
                  error={idleError ?? undefined}
                >
                  <UnitInput
                    id="setting-auto-close-minutes"
                    unit="minutes"
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={IDLE_RANGE.min}
                    max={IDLE_RANGE.max}
                    value={idleText}
                    disabled={!canWrite}
                    onChange={(event) => onIdleTextChange(event.target.value)}
                    aria-describedby="setting-auto-close-help"
                  />
                </Field>
              </div>
            ) : null}
          </SettingsCard>

          <SettingsCard
            icon={Download}
            title="Controller updates"
            description="Updates come from this project's GitHub releases. Stable follows tagged releases; nightly follows every commit on main. Save the channel before checking."
            actions={
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                onClick={() => void updateCheck.refetch()}
                disabled={!canRead || updateCheck.isFetching}
              >
                <RefreshCw size={13} aria-hidden />
                {updateCheck.isFetching ? 'Checking…' : 'Check now'}
              </button>
            }
          >
            <fieldset className="border-0 p-0">
              <legend className="text-[12px] font-medium" style={{ color: 'var(--color-ink-dim)' }}>
                Release channel
              </legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(
                  [
                    ['stable', 'Stable', 'Tagged releases only.'],
                    ['nightly', 'Nightly', 'Every commit on main, published as a prerelease.'],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className="flex min-h-7 cursor-pointer items-center gap-2 rounded-[2px] border px-2.5 py-1 text-[12px]"
                    style={{
                      borderColor:
                        channel === value ? 'var(--color-rule-strong)' : 'var(--color-rule)',
                      background: channel === value ? 'var(--color-panel-raised)' : 'transparent',
                    }}
                    title={hint}
                  >
                    <input
                      type="radio"
                      name="setting-update-channel"
                      checked={channel === value}
                      disabled={!canWrite}
                      onChange={() => onChannel(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
              <span>
                <span className="nb-rule-label block">running</span>
                <span className="tabular">{versionLabel(updateCheck.data?.currentVersion)}</span>
              </span>
              <span>
                <span className="nb-rule-label block">latest</span>
                <span className="tabular">{updateCheck.data?.latestVersion ?? '—'}</span>
              </span>
              <span>
                <span className="nb-rule-label block">published</span>
                <span className="tabular">{formatStamp(updateCheck.data?.publishedAt)}</span>
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              {updateCheck.isPending ? (
                <span style={{ color: 'var(--color-ink-faint)' }}>Checking…</span>
              ) : updateCheck.isError ? (
                <span style={{ color: 'var(--color-signal-down)' }}>
                  {messageOf(updateCheck.error)}
                </span>
              ) : updateCheck.data?.installable === false ? (
                <span style={{ color: 'var(--color-ink-faint)' }}>{updateCheck.data.reason}</span>
              ) : updateCheck.data?.available ? (
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  data-size="sm"
                  onClick={() => installUpdate.mutate({})}
                  disabled={!canWrite || installUpdate.isPending}
                >
                  <Download size={13} aria-hidden />
                  {installUpdate.isPending
                    ? 'Installing…'
                    : `Install ${updateCheck.data.latestVersion ?? 'update'}`}
                </button>
              ) : updateCheck.data?.latestVersion === null ? (
                <span style={{ color: 'var(--color-ink-faint)' }}>
                  No releases published on this channel yet.
                </span>
              ) : (
                <span style={{ color: 'var(--color-signal-up)' }}>Up to date.</span>
              )}
            </div>
          </SettingsCard>

          <SettingsCard
            icon={KeyRound}
            title="Secrets & licenses"
            description="Encrypted values the controller stores but never shows again. IOU nodes read their iourc license from a secret here by ID."
          >
            <SecretsSection canWrite={canWrite} bare />
          </SettingsCard>

          <details className="nb-panel">
            <summary className="cursor-pointer px-4 py-3">
              <span className="flex items-start gap-2.5">
                <SettingsIcon icon={Wrench} />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">
                    Advanced — direct settings keys
                  </span>
                  <span className="block text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
                    Unsupported escape hatch. Edit the stored key map directly for keys that have no
                    control above.
                  </span>
                </span>
              </span>
            </summary>
            <div className="border-t px-4 py-3.5" style={{ borderColor: 'var(--color-rule)' }}>
              <p className="mb-2 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                Values typed as digits or true/false keep their JSON type. Saving upserts each key;
                removing a row here does not delete the stored entry.
              </p>
              <KeyValueEditor
                ariaLabel="Raw settings map"
                value={map}
                onChange={onMapChange}
                disabled={!canWrite}
                keyPlaceholder="setting key"
                valuePlaceholder="value (text, number, true/false)"
              />
            </div>
          </details>

          {canWrite && dirty ? (
            <div
              className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t py-2.5"
              style={{
                borderColor: 'var(--color-rule-strong)',
                background: 'color-mix(in oklab, var(--color-panel-sunken) 92%, transparent)',
                backdropFilter: 'blur(4px)',
              }}
            >
              <p className="text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
                You have unsaved changes.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="nb-button"
                  onClick={onDiscard}
                  disabled={updateSettings.isPending}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="nb-button"
                  data-variant="primary"
                  onClick={onSave}
                  disabled={updateSettings.isPending || hasFieldErrors}
                >
                  {updateSettings.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Page>
  );
}
