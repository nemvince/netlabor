/**
 * First-run setup wizard: claim the admin account, glance at the environment,
 * pick appliance presets (customizable), and watch downloads/builds progress
 * with an ETA until every device template exists.
 */

import { setupPresets, softwareCatalog } from '@netlabor/catalog';
import type { Desktop } from '@netlabor/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowRight,
  Cable,
  Check,
  Circle,
  CircleCheck,
  CircleDashed,
  Database,
  Globe,
  Server,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Field, Input, Select } from '../../components/Field.tsx';
import { Notice } from '../../components/Notice.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { DESKTOP_OPTIONS } from '../appliances/appliance-meta.ts';

type Step = 'account' | 'environment' | 'presets' | 'progress';

interface PresetChoice {
  id: string;
  selected: boolean;
  desktop: Desktop;
  /** Software entry ids from the catalog; expanded to packages at build time. */
  software: string[];
}

const SOFTWARE_ICONS: Record<string, typeof Globe> = { Database, Globe };

function softwareEntry(id: string) {
  return softwareCatalog.find((entry) => entry.id === id);
}

function StepHeader({ step, title, hint }: { step: string; title: string; hint: string }) {
  return (
    <div className="mb-4">
      <div className="nb-rule-label" style={{ color: 'var(--color-copper)' }}>
        setup · {step}
      </div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
        {hint}
      </p>
    </div>
  );
}

export function SetupWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('account');
  const [error, setError] = useState<unknown>(null);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [choices, setChoices] = useState<PresetChoice[]>(
    setupPresets.map((preset) => ({
      id: preset.id,
      selected: true,
      desktop: preset.desktop,
      software: [...preset.software],
    })),
  );

  const status = useQuery({ ...orpc.auth.setup.status.queryOptions({ input: {} }), retry: false });
  const needsSetup = status.data?.needsSetup === true;

  // The wizard only makes sense on a fresh controller.
  useEffect(() => {
    if (status.isSuccess && !needsSetup) void navigate({ to: '/', replace: true });
  }, [status.isSuccess, needsSetup, navigate]);

  const createAdmin = useMutation({
    mutationFn: () =>
      client.auth.setup.createAdmin({ username: username.toLowerCase().trim(), password }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: orpc.auth.me.key() });
      setStep('environment');
    },
  });

  function submitAccount() {
    if (password.length < 12) {
      setError(new Error('Password needs at least 12 characters.'));
      return;
    }
    if (password !== confirm) {
      setError(new Error('Passwords do not match.'));
      return;
    }
    setError(null);
    createAdmin.mutate();
  }

  if (status.isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-[13px]"
        style={{ color: 'var(--color-ink-faint)' }}
      >
        Checking controller state…
      </div>
    );
  }
  if (!needsSetup) return null;

  return (
    <div className="flex min-h-screen items-start justify-center px-4 py-10">
      <div className="w-full max-w-[680px]">
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}

        {step === 'account' ? (
          <div>
            <StepHeader
              step="1 of 4"
              title="Welcome to netlabor"
              hint="Create the first administrator account. Everything else can be changed later."
            />
            <div className="flex flex-col gap-3">
              <Field
                label="Username"
                htmlFor="setup-username"
                hint="Lowercase letters, digits, dot, dash, underscore."
              >
                <Input
                  id="setup-username"
                  autoFocus
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor="setup-password" hint="At least 12 characters.">
                <Input
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="Confirm password" htmlFor="setup-confirm">
                <Input
                  id="setup-confirm"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
              <button
                type="button"
                className="nb-button self-start"
                data-variant="primary"
                disabled={createAdmin.isPending}
                onClick={submitAccount}
              >
                {createAdmin.isPending ? 'Creating…' : 'Create admin account'}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'environment' ? <EnvironmentStep onContinue={() => setStep('presets')} /> : null}

        {step === 'presets' ? (
          <PresetsStep
            choices={choices}
            setChoices={setChoices}
            onStarted={() => setStep('progress')}
          />
        ) : null}

        {step === 'progress' ? <ProgressStep choices={choices} /> : null}
      </div>
    </div>
  );
}

/** Environment snapshot: computes online, what to do about agents, pointers. */
function EnvironmentStep({ onContinue }: { onContinue: () => void }) {
  const computes = useQuery({
    ...orpc.computes.list.queryOptions({ input: {} }),
    refetchInterval: 5000,
  });
  const rows = computes.data ?? [];
  const online = rows.filter((compute) => compute.status === 'online').length;
  return (
    <div>
      <StepHeader
        step="2 of 4"
        title="Your environment"
        hint="Appliance builds run on compute agents. You can register more later on the Computes page."
      />
      <div
        className="rounded-[3px] border px-3 py-2 text-[12px]"
        style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
      >
        <div className="flex items-center gap-2">
          <Server size={15} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
          <span className="font-medium">
            {online > 0
              ? `${online} of ${rows.length} compute agent${rows.length === 1 ? '' : 's'} online`
              : 'No compute agents registered yet'}
          </span>
        </div>
        {rows.map((compute) => (
          <div
            key={compute.id}
            className="mt-1 flex items-center gap-2 text-[11px]"
            style={{ color: 'var(--color-ink-faint)' }}
          >
            <Cable size={11} aria-hidden />
            {compute.name} ·{' '}
            <span
              style={{
                color:
                  compute.status === 'online'
                    ? 'var(--color-signal-up)'
                    : 'var(--color-signal-warn)',
              }}
            >
              {compute.status}
            </span>
          </div>
        ))}
        {online === 0 ? (
          <p className="mt-2 text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
            Preparation still queues below; downloads and builds start as soon as an agent is
            online.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="nb-button mt-4 self-start"
        data-variant="primary"
        onClick={onContinue}
      >
        Choose appliance presets <ArrowRight size={13} aria-hidden />
      </button>
    </div>
  );
}

function PresetsStep({
  choices,
  setChoices,
  onStarted,
}: {
  choices: PresetChoice[];
  setChoices: (next: PresetChoice[]) => void;
  onStarted: () => void;
}) {
  const osImages = useQuery({
    ...orpc.appliances.os.list.queryOptions({ input: { limit: 100, offset: 0 } }),
    retry: false,
  });
  const osRows = osImages.data ?? [];

  function update(id: string, patch: Partial<PresetChoice>) {
    setChoices(choices.map((choice) => (choice.id === id ? { ...choice, ...patch } : choice)));
  }

  const selected = choices.filter((choice) => choice.selected);

  return (
    <div>
      <StepHeader
        step="3 of 4"
        title="Prepare appliance images"
        hint="Presets download a base cloud image and build it into an offline-ready device template. Tweak each preset before starting."
      />
      <div className="flex flex-col gap-2">
        {setupPresets.map((preset) => {
          const choice = choices.find((entry) => entry.id === preset.id);
          if (!choice) return null;
          const osImage = osRows.find((row) => row.family === preset.family);
          return (
            <div
              key={preset.id}
              className="rounded-[3px] border px-3 py-2"
              style={{
                borderColor: choice.selected ? 'var(--color-copper)' : 'var(--color-rule-strong)',
                background: choice.selected
                  ? 'color-mix(in oklab, var(--color-copper) 8%, var(--color-panel))'
                  : 'var(--color-panel)',
              }}
            >
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={choice.selected}
                  onChange={(event) => update(preset.id, { selected: event.target.checked })}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="text-[13px] font-medium">{preset.name}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                    {preset.description}
                    {osImage ? ` · base: ${osImage.name}` : ''}
                  </span>
                </span>
              </label>
              {choice.selected ? (
                <div className="mt-2 flex flex-wrap items-start gap-3">
                  <span
                    className="flex items-center gap-1.5 text-[11px]"
                    style={{ color: 'var(--color-ink-faint)' }}
                  >
                    <label htmlFor={`setup-desktop-${preset.id}`}>Desktop</label>
                    <Select
                      id={`setup-desktop-${preset.id}`}
                      className="h-6 py-0 text-[11px]"
                      style={{ width: 130 }}
                      value={choice.desktop}
                      onChange={(event) =>
                        update(preset.id, { desktop: event.target.value as Desktop })
                      }
                    >
                      {DESKTOP_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </span>
                  <span className="flex max-w-[420px] flex-wrap gap-1">
                    {softwareCatalog.map((entry) => {
                      const active = choice.software.includes(entry.id);
                      const IconName = SOFTWARE_ICONS[entry.icon] ?? Circle;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          aria-pressed={active}
                          title={entry.description}
                          className="inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px text-[10px]"
                          style={{
                            borderColor: active
                              ? 'var(--color-copper)'
                              : 'var(--color-rule-strong)',
                            background: active
                              ? 'color-mix(in oklab, var(--color-copper) 14%, var(--color-panel-sunken))'
                              : 'var(--color-panel-sunken)',
                            color: active ? 'var(--color-copper)' : 'var(--color-ink-faint)',
                          }}
                          onClick={() =>
                            update(preset.id, {
                              software: active
                                ? choice.software.filter((id) => id !== entry.id)
                                : [...choice.software, entry.id],
                            })
                          }
                        >
                          <IconName size={11} aria-hidden />
                          {entry.name}
                        </button>
                      );
                    })}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="nb-button"
          data-variant="primary"
          disabled={osImages.isPending}
          onClick={() => {
            if (selected.length === 0 && !confirm('Prepare nothing and finish setup?')) return;
            onStarted();
          }}
        >
          {selected.length > 0
            ? `Prepare ${selected.length} image${selected.length === 1 ? '' : 's'}`
            : 'Skip — nothing to prepare'}
        </button>
      </div>
    </div>
  );
}

interface TrackRow {
  choice: PresetChoice;
  presetName: string;
  osImageId: string;
  /** Build id once queued; 'pending' while the create call is in flight. */
  buildId: string | null;
  templateDone: boolean;
  failed: string | null;
}

function packagesOf(software: string[]): string[] {
  const pkgs = new Set<string>();
  for (const id of software) {
    for (const pkg of softwareEntry(id)?.packages ?? []) pkgs.add(pkg);
  }
  return [...pkgs];
}

/** Live progress: base-image downloads, builds with slope ETA, template creation. */
function ProgressStep({ choices }: { choices: PresetChoice[] }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selected = choices.filter((choice) => choice.selected);
  const osImages = useQuery({
    ...orpc.appliances.os.list.queryOptions({ input: { limit: 100, offset: 0 } }),
    refetchInterval: 3000,
    retry: false,
  });
  const builds = useQuery({
    ...orpc.appliances.builds.list.queryOptions({ input: { limit: 50, offset: 0 } }),
    refetchInterval: 3000,
    retry: false,
  });
  const downloadJobs = useQuery({
    ...orpc.jobs.list.queryOptions({ input: { kind: 'os.download', state: 'running', limit: 50 } }),
    refetchInterval: 3000,
    retry: false,
  });

  // One track per selected preset, pinned by software-catalog preset id.
  const tracksRef = useRef<Map<string, TrackRow>>(new Map());
  if (tracksRef.current.size === 0) {
    for (const choice of selected) {
      const preset = setupPresets.find((entry) => entry.id === choice.id);
      if (!preset) continue;
      const osImage =
        (osImages.data ?? []).find((row) => row.family === preset.family && row.imageId !== null) ??
        (osImages.data ?? []).find((row) => row.family === preset.family);
      if (!osImage) continue;
      tracksRef.current.set(preset.id, {
        choice,
        presetName: preset.name,
        osImageId: osImage.id,
        buildId: null,
        templateDone: false,
        failed: null,
      });
    }
  }

  // Queue the base-image download for entries without an artifact (once).
  useEffect(() => {
    const osRows = osImages.data ?? [];
    for (const track of tracksRef.current.values()) {
      const osImage = osRows.find((row) => row.id === track.osImageId);
      if (!osImage || osImage.imageId !== null || track.buildId !== null) continue;
      track.buildId = 'waiting-download';
      void client.appliances.os.download({ id: osImage.id }).catch((error: unknown) => {
        track.failed = messageOf(error);
      });
    }
  }, [osImages.data]);

  // Queue builds for tracks whose base image became available.
  useEffect(() => {
    const osRows = osImages.data ?? [];
    for (const track of tracksRef.current.values()) {
      const osImage = osRows.find((row) => row.id === track.osImageId);
      if (!osImage || track.buildId !== 'waiting-download') continue;
      if (osImage.imageId === null || osImage.status !== 'available') continue;
      track.buildId = 'pending';
      void client.appliances.builds
        .create({
          name: `${osImage.name.replace(/\.qcow2$|\.img$/, '')}-${track.choice.desktop}-lab`,
          osImageId: osImage.id,
          desktop: track.choice.desktop,
          packages: packagesOf(track.choice.software),
          diskGb: 12,
          memoryMb: 2048,
          cpus: 2,
        })
        .then((created) => {
          track.buildId = created.build.id;
        })
        .catch((error: unknown) => {
          track.buildId = 'waiting-download';
          track.failed = messageOf(error);
        });
    }
  }, [osImages.data]);

  // Create device templates for completed builds (once per track).
  useEffect(() => {
    const buildRows = builds.data ?? [];
    for (const track of tracksRef.current.values()) {
      if (track.templateDone || !track.buildId || track.buildId === 'waiting-download') continue;
      if (track.buildId === 'pending') continue;
      const build = buildRows.find((row) => row.id === track.buildId);
      if (build?.status !== 'completed') continue;
      track.templateDone = true;
      void client.appliances.builds
        .template({ buildId: build.id, name: build.name })
        .catch((error: unknown) => {
          track.templateDone = false;
          track.failed = messageOf(error);
        });
    }
  }, [builds.data]);

  // Progress history for slope-based ETA.
  const historyRef = useRef<Map<string, { at: number; progress: number }[]>>(new Map());
  function etaOf(key: string, progress: number): string | null {
    const history = historyRef.current.get(key) ?? [];
    const now = Date.now();
    history.push({ at: now, progress });
    while (history.length > 12) history.shift();
    historyRef.current.set(key, history);
    const first = history[0];
    if (!first || history.length < 3) return null;
    const span = (now - first.at) / 1000;
    if (span < 4) return null;
    const rate = (progress - first.progress) / span;
    if (rate <= 0.02) return null;
    const seconds = Math.max(0, (100 - progress) / rate);
    if (seconds < 45) return 'under a minute';
    const minutes = Math.round(seconds / 60);
    return minutes === 1 ? '~1 min' : `~${minutes} min`;
  }

  const tracks = [...tracksRef.current.values()];
  const allDone = tracks.length === 0 || tracks.every((track) => track.templateDone);

  if (selected.length === 0) {
    return (
      <div>
        <StepHeader
          step="4 of 4"
          title="Setup complete"
          hint="You skipped image preparation. Appliances can be built any time on the Library page."
        />
        <button
          type="button"
          className="nb-button"
          data-variant="primary"
          onClick={() => void navigate({ to: '/', replace: true })}
        >
          Open netlabor <ArrowRight size={13} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div>
      <StepHeader
        step="4 of 4"
        title="Preparing your appliances"
        hint="Base images download, then build into offline-ready device templates. Leaving this page is safe; progress stays on the Library page."
      />
      <ul className="flex flex-col gap-1.5">
        {tracks.map((track) => {
          const osRows = osImages.data ?? [];
          const osImage = osRows.find((row) => row.id === track.osImageId);
          const buildRows = builds.data ?? [];
          const build =
            track.buildId && track.buildId !== 'pending' && track.buildId !== 'waiting-download'
              ? buildRows.find((row) => row.id === track.buildId)
              : undefined;
          const downloadJob = (downloadJobs.data ?? []).find(
            (job) => job.payload.osImageId === track.osImageId,
          );

          let label = 'waiting…';
          let progress: number | null = null;
          let eta: string | null = null;
          let done = false;
          let tone = 'var(--color-copper)';
          if (track.failed) {
            label = `failed: ${track.failed}`;
            tone = 'var(--color-signal-down)';
          } else if (track.templateDone) {
            label = 'device template ready';
            done = true;
            tone = 'var(--color-signal-up)';
          } else if (build) {
            if (build.status === 'completed') label = 'image built — creating template…';
            else {
              label = `building image · ${build.status}`;
              progress = build.progress;
              eta = etaOf(track.buildId ?? '', build.progress);
            }
          } else if (osImage?.status === 'downloading') {
            label = 'downloading base image';
            if (downloadJob) {
              progress = downloadJob.progress;
              eta = etaOf(`dl:${track.osImageId}`, downloadJob.progress);
            }
          } else if (osImage?.imageId) {
            label = 'base image ready — queueing build…';
          }

          const Icon = done
            ? CircleCheck
            : track.failed
              ? Circle
              : progress === null
                ? CircleDashed
                : Circle;
          return (
            <li
              key={track.osImageId}
              className="flex items-center gap-2.5 rounded-[3px] border px-3 py-2"
              style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
            >
              <Icon size={16} aria-hidden style={{ color: tone, flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="truncate font-medium">{track.presetName}</span>
                  <span className="truncate text-[11px]" style={{ color: 'var(--color-ink-dim)' }}>
                    {label}
                  </span>
                  {eta ? (
                    <span
                      className="tabular ml-auto text-[10px]"
                      style={{ color: 'var(--color-ink-faint)' }}
                    >
                      {eta} remaining
                    </span>
                  ) : null}
                </div>
                {progress !== null && !done ? (
                  <div
                    className="mt-1 h-1 overflow-hidden rounded-full"
                    style={{ background: 'var(--color-panel-sunken)' }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress)}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${Math.max(2, progress)}%`,
                        background: 'var(--color-copper)',
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="nb-button mt-4"
        data-variant={allDone ? 'primary' : 'default'}
        disabled={!allDone}
        title={allDone ? undefined : 'Templates are still being created'}
        onClick={() => {
          void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
          void navigate({ to: '/', replace: true });
        }}
      >
        {allDone ? (
          <>
            <Check size={13} aria-hidden /> Setup complete — open netlabor
          </>
        ) : (
          'Preparing…'
        )}
      </button>
    </div>
  );
}
