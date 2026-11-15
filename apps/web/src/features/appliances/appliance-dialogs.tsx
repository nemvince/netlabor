import { desktopAvailable, softwareCatalog } from '@netlabor/catalog';
import {
  type ApplianceBuildCreated,
  type ApplianceBuildRow,
  type ComputeRow,
  type Desktop,
  OS_ARCHES,
  OS_FAMILIES,
  type OsArch,
  type OsFamily,
  type OsImageRow,
  type SymbolRow,
  type TemplateRow,
} from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import {
  ActivityIcon as Activity,
  ArrowsLeftRightIcon as ArrowLeftRight,
  PlugIcon as Cable,
  CubeIcon as Container,
  DatabaseIcon as Database,
  DownloadSimpleIcon as Download,
  FileCodeIcon as FileCode,
  GaugeIcon as Gauge,
  GitBranchIcon as GitBranch,
  GlobeIcon as Globe,
  HammerIcon as Hammer,
  KeyIcon as KeyRound,
  LockIcon as Lock,
  NetworkIcon as Network,
  ShieldIcon as Shield,
  TerminalIcon as Terminal,
  XIcon as X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogFooter } from '../../components/dialog.tsx';
import { Field, Input, Select, Textarea } from '../../components/field.tsx';
import { ImagePicker } from '../../components/image-picker.tsx';
import { Notice } from '../../components/notice.tsx';
import { client, orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';
import { queryClient } from '../../lib/query-client.ts';
import { DESKTOP_OPTIONS, familyLabel, suggestedBuildName } from './appliance-meta.ts';
import { Button } from '@netlabor/ui/components/button';

/** Add or edit a cloud image entry in the global OS repository. */
export function OsImageCreateDialog({
  osImage = null,
  onOpenChange,
  onSaved,
}: {
  /** Existing entry to edit; omitted when adding a new one. */
  osImage?: OsImageRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: OsImageRow) => void;
}) {
  const editing = osImage !== null;
  const [name, setName] = useState(osImage?.name ?? '');
  const [family, setFamily] = useState<OsFamily>(osImage?.family ?? 'debian');
  const [release, setRelease] = useState(osImage?.release ?? '');
  const [arch, setArch] = useState<OsArch>(osImage?.arch ?? 'amd64');
  const [sourceUrl, setSourceUrl] = useState(osImage?.sourceUrl ?? '');
  const [filename, setFilename] = useState(osImage?.filename ?? '');
  const [description, setDescription] = useState(osImage?.description ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (name.trim() === '' || release.trim() === '' || filename.trim() === '') {
      setError(new Error('Name, release, and filename are required.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const values = {
        name: name.trim(),
        family,
        release: release.trim(),
        arch,
        sourceUrl: sourceUrl.trim() === '' ? null : sourceUrl.trim(),
        filename: filename.trim(),
        description: description.trim() === '' ? null : description.trim(),
      };
      const saved = editing
        ? await client.appliances.os.update({ ...values, id: osImage.id })
        : await client.appliances.os.create(values);
      onSaved(saved);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={editing ? `Edit ${osImage.name}` : 'New OS image entry'}
      description="A cloud image the appliance builder can download and boot. Direct URLs only; uploads are adopted below."
      width={600}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" htmlFor="os-create-name" hint="Unique label in the repository.">
            <Input
              id="os-create-name"
              autoFocus
              placeholder="debian-13-genericcloud-amd64"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Family" htmlFor="os-create-family">
            <Select
              id="os-create-family"
              value={family}
              onChange={(event) => setFamily(event.target.value as OsFamily)}
            >
              {OS_FAMILIES.map((value) => (
                <option key={value} value={value}>
                  {familyLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <Field label="Release" htmlFor="os-create-release">
            <Input
              id="os-create-release"
              placeholder="13 (trixie)"
              value={release}
              onChange={(event) => setRelease(event.target.value)}
            />
          </Field>
          <Field label="Architecture" htmlFor="os-create-arch">
            <Select
              id="os-create-arch"
              value={arch}
              onChange={(event) => setArch(event.target.value as OsArch)}
            >
              {OS_ARCHES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Source URL"
          htmlFor="os-create-url"
          hint="Direct qcow2 or img URL. Leave empty when the artifact is uploaded and adopted instead."
        >
          <Input
            id="os-create-url"
            type="url"
            placeholder="https://cloud.debian.org/images/cloud/…/image.qcow2"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="os-create-description"
          hint="Shown in the repository list; keep it to one or two lines."
        >
          <Textarea
            id="os-create-description"
            rows={2}
            placeholder="Debian 13 cloud image with cloud-init."
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field
          label="Filename"
          htmlFor="os-create-filename"
          hint="Stored artifact name; must match the downloaded file."
        >
          <Input
            id="os-create-filename"
            placeholder="debian-13-genericcloud-amd64.qcow2"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            variant="default"
            size="sm"
          >
            {busy ? (editing ? 'Saving…' : 'Adding…') : editing ? 'Save changes' : 'Add entry'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** Point an OS entry at an image that already lives in the library. */
export function AdoptOsImageDialog({
  osImage,
  onOpenChange,
  onAdopted,
}: {
  osImage: OsImageRow;
  onOpenChange: (open: boolean) => void;
  onAdopted: (row: OsImageRow) => void;
}) {
  const [imageId, setImageId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function adopt() {
    if (!imageId) {
      setError(new Error('Choose a library image to adopt.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const adopted = await client.appliances.os.adopt({ id: osImage.id, imageId });
      onAdopted(adopted);
      onOpenChange(false);
    } catch (adoptError) {
      setError(adoptError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={`Adopt an image for ${osImage.name}`}
      description="Use an image that is already in the library as this entry's base artifact. It must be a cloud image prepared for cloud-init."
      width={560}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
        <ImagePicker
          id="os-adopt-image"
          label="Library image"
          allowEmpty={false}
          value={imageId}
          onChange={(next) => setImageId(next)}
          hint="Library images live on computes and are replicated like any other image."
        />
        {osImage.sha256 ? (
          <p className="tabular text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            Expected artifact: {osImage.filename} · sha256 {osImage.sha256.slice(0, 12)}…
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !imageId}
            onClick={() => void adopt()}
            variant="default"
            size="sm"
          >
            {busy ? 'Adopting…' : 'Adopt image'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** phosphor icons for catalog software entries, keyed by the catalog icon name. */
const SOFTWARE_ICONS: Record<string, typeof Globe> = {
  Activity,
  ArrowLeftRight,
  Cable,
  Container,
  Database,
  Download,
  FileCode,
  Gauge,
  GitBranch,
  Globe,
  Hammer,
  KeyRound,
  Lock,
  Network,
  Shield,
  Terminal,
};

const SOFTWARE_GROUPS: {
  id: 'gui' | 'office' | 'sysadmin' | 'network' | 'server' | 'tools';
  label: string;
}[] = [
  { id: 'gui', label: 'GUI software' },
  { id: 'office', label: 'Office clients' },
  { id: 'sysadmin', label: 'System administration' },
  { id: 'network', label: 'Network tooling' },
  { id: 'server', label: 'Server roles' },
  { id: 'tools', label: 'Developer & general tools' },
];

const PACKAGE_MANAGER: Record<OsFamily, string> = {
  debian: 'apt',
  ubuntu: 'apt',
  rocky: 'dnf',
  alpine: 'apk',
};

/**
 * Preinstalled-software picker: toggle cards from the catalog (icon + name +
 * one-line description) plus a free-form chip field for anything else.
 */
function SoftwarePicker({
  family,
  desktop,
  selected,
  extraPackages,
  onToggle,
  onExtraChange,
}: {
  family: OsFamily;
  desktop: Desktop;
  selected: string[];
  extraPackages: string[];
  onToggle: (id: string) => void;
  onExtraChange: (next: string[]) => void;
}) {
  const selectedSet = new Set(selected);
  const manager = PACKAGE_MANAGER[family];
  const groups = SOFTWARE_GROUPS.map((group) => ({
    ...group,
    entries: softwareCatalog.filter(
      (entry) =>
        entry.group === group.id &&
        (group.id !== 'gui' || desktop !== 'none') &&
        (entry.packages[family]?.length ?? 0) > 0,
    ),
  })).filter((group) => group.entries.length > 0);
  return (
    <Field
      label="Preinstalled software"
      htmlFor="build-software"
      hint={`Toggled entries install their ${manager} packages during the build.`}
    >
      {groups.map((group) => (
        <div key={group.id} className="mt-1">
          <div className="nb-rule-label">{group.label}</div>
          <ul className="mt-1 grid grid-cols-2 gap-1">
            {group.entries.map((entry) => {
              const active = selectedSet.has(entry.id);
              const Icon = SOFTWARE_ICONS[entry.icon] ?? Terminal;
              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    title={entry.description}
                    onClick={() => onToggle(entry.id)}
                    className="flex w-full items-center gap-1.5 rounded-[3px] border px-1.5 py-1 text-left text-[11px]"
                    style={{
                      borderColor: active ? 'var(--color-copper)' : 'var(--color-rule-strong)',
                      background: active
                        ? 'color-mix(in oklab, var(--color-copper) 14%, var(--color-panel-sunken))'
                        : 'var(--color-panel-sunken)',
                      color: active ? 'var(--color-copper)' : 'var(--color-ink-dim)',
                    }}
                  >
                    <Icon size={13} aria-hidden style={{ flexShrink: 0 }} />
                    <span className="truncate">{entry.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="mt-2">
        <PackageChipInput
          label="Extra packages"
          id="build-extra-packages"
          packages={extraPackages}
          onChange={onExtraChange}
          hint={`Anything not in the list above; ${manager} package names, Enter or comma to add.`}
        />
      </div>
    </Field>
  );
}

/** apt package chips: commit on Enter, comma, space, or blur. */
function PackageChipInput({
  packages,
  onChange,
  label = 'Extra packages',
  id = 'build-packages',
  hint = 'Package names; press Enter, comma, or space after each.',
}: {
  packages: string[];
  onChange: (next: string[]) => void;
  label?: string;
  id?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    const tokens = raw
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter((token) => token !== '');
    if (tokens.length === 0) {
      setDraft('');
      return;
    }
    onChange([...new Set([...packages, ...tokens])]);
    setDraft('');
  }

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        placeholder="htop, curl, tcpdump"
        value={draft}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
            event.preventDefault();
            commit(draft);
          } else if (event.key === 'Backspace' && draft === '' && packages.length > 0) {
            onChange(packages.slice(0, -1));
          }
        }}
        onChange={(event) => {
          const value = event.target.value;
          if (/[\s,]/.test(value)) commit(value);
          else setDraft(value);
        }}
        onBlur={() => commit(draft)}
      />
      {packages.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1" aria-label="Selected packages">
          {packages.map((pkg) => (
            <li key={pkg}>
              <span
                className="tabular inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px text-[11px]"
                style={{
                  borderColor: 'var(--color-rule-strong)',
                  background: 'var(--color-panel-sunken)',
                }}
              >
                {pkg}
                <button
                  type="button"
                  aria-label={`Remove ${pkg}`}
                  className="rounded-[2px] p-0.5 hover:bg-[var(--color-panel-raised)]"
                  onClick={() => onChange(packages.filter((candidate) => candidate !== pkg))}
                >
                  <X size={10} aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Field>
  );
}

function NumericField({
  label,
  id,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  id: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type="number"
        className="tabular"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

/**
 * Start an appliance build. The build VM is online (QEMU user networking) so
 * cloud-init can apt-install the desktop and packages; the resulting image is
 * later attached to lab links with no uplink.
 */
export function ApplianceBuildDialog({
  osImages,
  computes,
  onOpenChange,
  onCreated,
}: {
  osImages: OsImageRow[];
  computes: ComputeRow[];
  onOpenChange: (open: boolean) => void;
  onCreated: (created: ApplianceBuildCreated) => void;
}) {
  const readyOsImages = osImages.filter((osImage) => osImage.imageId !== null);
  const [osImageId, setOsImageId] = useState(readyOsImages[0]?.id ?? '');
  const [desktop, setDesktop] = useState<Desktop>('xfce');
  const [software, setSoftware] = useState<string[]>([]);
  const [extraPackages, setExtraPackages] = useState<string[]>([]);
  const [diskGb, setDiskGb] = useState(12);
  const [memoryMb, setMemoryMb] = useState(2048);
  const [cpus, setCpus] = useState(2);
  const [computeId, setComputeId] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const selectedOs = readyOsImages.find((osImage) => osImage.id === osImageId);
  const family = selectedOs?.family ?? 'debian';
  const desktopSupported = desktopAvailable(desktop, family);
  // Not every family ships every desktop environment (Rocky has no KDE/LXQt).
  const effectiveDesktop: Desktop = desktopSupported ? desktop : 'none';
  const suggested = useMemo(
    () => suggestedBuildName(selectedOs, effectiveDesktop),
    [selectedOs, effectiveDesktop],
  );
  // Toggled catalog entries + free-form chips become the build's package list.
  const packages = useMemo(() => {
    const selected = new Set(extraPackages);
    for (const entry of softwareCatalog) {
      if (!software.includes(entry.id)) continue;
      if (entry.group === 'gui' && effectiveDesktop === 'none') continue;
      for (const pkg of entry.packages[family] ?? []) selected.add(pkg);
    }
    return [...selected];
  }, [software, extraPackages, family, effectiveDesktop]);

  // A headless image is a server: reach it over SSH unless the user opts out.
  useEffect(() => {
    if (effectiveDesktop !== 'none') return;
    setSoftware((current) =>
      current.includes('ssh-server') ? current : [...current, 'ssh-server'],
    );
  }, [effectiveDesktop]);

  useEffect(() => {
    if (!nameTouched) setName(suggested);
  }, [suggested, nameTouched]);

  async function create() {
    if (osImageId === '') {
      setError(new Error('Download or adopt an OS image before starting a build.'));
      return;
    }
    if (name.trim() === '') {
      setError(new Error('Name the library image this build produces.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await client.appliances.builds.create({
        name: name.trim(),
        osImageId,
        desktop: effectiveDesktop,
        packages,
        diskGb,
        memoryMb,
        cpus,
        ...(computeId === '' ? {} : { computeId }),
      });
      onCreated(created);
      onOpenChange(false);
    } catch (createError) {
      setError(createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title="New appliance build"
      description="Boots the base cloud image in a throwaway VM with internet access, installs the selected software, then powers off into a reusable library image."
      width={660}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
        {readyOsImages.length === 0 ? (
          <Notice tone="warn">
            No OS image has a downloaded artifact yet. Download or adopt one in the repository
            first; builds boot that exact file.
          </Notice>
        ) : null}
        {(() => {
          // Selected arch vs the compute the build would run on; qemu can
          // emulate the other arch, but it is slow and KVM is unavailable then.
          const target =
            computes.find((compute) => compute.id === computeId) ??
            computes.find((compute) => compute.status === 'online');
          const hostArch = target?.capabilities?.arch;
          if (!selectedOs || !hostArch || hostArch === selectedOs.arch) return null;
          return (
            <Notice tone="warn">
              This image is {selectedOs.arch} but compute “{target.name}” runs {hostArch}. The build
              will fall back to emulation and may be very slow.
            </Notice>
          );
        })()}
        <div className="grid grid-cols-[1fr_200px] gap-2">
          <Field
            label="Base OS image"
            htmlFor="build-os"
            hint="Only entries with a verified artifact can be built."
          >
            <Select
              id="build-os"
              value={osImageId}
              onChange={(event) => setOsImageId(event.target.value)}
              disabled={readyOsImages.length === 0}
            >
              {readyOsImages.length === 0 ? <option value="">No downloaded OS image</option> : null}
              {readyOsImages.map((osImage) => (
                <option key={osImage.id} value={osImage.id}>
                  {osImage.name} · {osImage.release} · {osImage.arch}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Desktop"
            htmlFor="build-desktop"
            hint={`Not every desktop is packaged for ${family}.`}
          >
            <Select
              id="build-desktop"
              value={effectiveDesktop}
              onChange={(event) => setDesktop(event.target.value as Desktop)}
            >
              {DESKTOP_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={!desktopAvailable(option.value, family)}
                >
                  {option.label} — {option.hint}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Library image name"
          htmlFor="build-name"
          hint="The resulting image and node template use this name."
        >
          <Input
            id="build-name"
            value={name}
            onChange={(event) => {
              setNameTouched(true);
              setName(event.target.value);
            }}
          />
        </Field>
        <SoftwarePicker
          family={family}
          desktop={effectiveDesktop}
          selected={software}
          extraPackages={extraPackages}
          onToggle={(id) =>
            setSoftware((current) =>
              current.includes(id)
                ? current.filter((candidate) => candidate !== id)
                : [...current, id],
            )
          }
          onExtraChange={setExtraPackages}
        />
        <div className="grid grid-cols-3 gap-2">
          <NumericField
            label="Disk (GB)"
            id="build-disk"
            value={diskGb}
            min={2}
            max={200}
            hint="grown by the build"
            onChange={setDiskGb}
          />
          <NumericField
            label="Memory (MB)"
            id="build-memory"
            value={memoryMb}
            min={512}
            max={65536}
            hint="build VM only"
            onChange={setMemoryMb}
          />
          <NumericField
            label="CPUs"
            id="build-cpus"
            value={cpus}
            min={1}
            max={16}
            onChange={setCpus}
          />
        </div>
        <Field
          label="Compute"
          htmlFor="build-compute"
          hint="The build runs on this compute. Auto picks the one with the most free capacity."
        >
          <Select
            id="build-compute"
            value={computeId}
            onChange={(event) => setComputeId(event.target.value)}
          >
            <option value="">Auto — most free capacity</option>
            {computes.map((compute) => (
              <option key={compute.id} value={compute.id}>
                {compute.name}
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          The build VM has internet through QEMU user networking. The finished image is attached to
          lab links with <strong>no uplink</strong>, so lab traffic stays isolated.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || readyOsImages.length === 0}
            onClick={() => void create()}
            variant="default"
            size="sm"
          >
            {busy ? 'Queuing…' : 'Start build'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}

/** Turn a completed build's library image into a device template. */
export function BuildTemplateDialog({
  build,
  onOpenChange,
  onCreated,
}: {
  build: ApplianceBuildRow;
  onOpenChange: (open: boolean) => void;
  onCreated: (template: TemplateRow) => void;
}) {
  const [name, setName] = useState(build.name);
  const [category, setCategory] = useState('Appliances');
  const [symbol, setSymbol] = useState('pc');
  const [projectId, setProjectId] = useState('');
  const [adapters, setAdapters] = useState(1);
  const [ram, setRam] = useState(2048);
  const [cpus, setCpus] = useState(2);
  const [autoLogin, setAutoLogin] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const symbols = useQuery({
    ...orpc.symbols.list.queryOptions({ input: {} }),
    retry: false,
  });
  const projects = useQuery({
    ...orpc.projects.list.queryOptions({ input: { limit: 500, offset: 0 } }),
    retry: false,
  });

  const symbolRows: SymbolRow[] = symbols.data ?? [];

  async function create() {
    if (name.trim() === '') {
      setError(new Error('Name the template.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await client.appliances.builds.template({
        buildId: build.id,
        name: name.trim(),
        category: category.trim() === '' ? 'Appliances' : category.trim(),
        symbol,
        projectId: projectId === '' ? null : projectId,
        adapters,
        ram,
        cpus,
        cloudInitAutoLogin: autoLogin,
      });
      void queryClient.invalidateQueries({ queryKey: orpc.templates.list.key() });
      onCreated(created);
      onOpenChange(false);
    } catch (createError) {
      setError(createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      title={`Create a template from ${build.name}`}
      description="The template points at the finished library image, so nodes attach with no uplink."
      width={560}
    >
      <div className="flex flex-col gap-3">
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
        <div className="grid grid-cols-[1fr_160px] gap-2">
          <Field label="Template name" htmlFor="build-template-name">
            <Input
              id="build-template-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Category" htmlFor="build-template-category">
            <Input
              id="build-template-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Scope" htmlFor="build-template-project">
            <Select
              id="build-template-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Global library</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Symbol" htmlFor="build-template-symbol">
            {symbolRows.length > 0 ? (
              <Select
                id="build-template-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
              >
                {!symbolRows.some((row) => row.id === symbol) ? (
                  <option value={symbol}>{symbol} (not installed)</option>
                ) : null}
                {symbolRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="build-template-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
              />
            )}
          </Field>
        </div>
        {build.imageId ? (
          <div
            className="rounded-[3px] border px-2 py-1.5 text-[11px]"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
          >
            <span className="nb-rule-label">Library image</span>{' '}
            <span className="tabular">
              {build.name} · {build.imageId.slice(0, 8)}
            </span>
            <span style={{ color: 'var(--color-ink-faint)' }}> · offline-ready</span>
          </div>
        ) : null}
        <div>
          <div className="nb-rule-label">Node defaults</div>
          <div className="mt-1 grid grid-cols-3 gap-2">
            <NumericField
              label="Adapters"
              id="build-template-adapters"
              value={adapters}
              min={0}
              max={32}
              onChange={setAdapters}
            />
            <NumericField
              label="Memory (MB)"
              id="build-template-ram"
              value={ram}
              min={256}
              max={65536}
              onChange={setRam}
            />
            <NumericField
              label="CPUs"
              id="build-template-cpus"
              value={cpus}
              min={1}
              max={16}
              onChange={setCpus}
            />
          </div>
          <label
            className="mt-1.5 flex items-center gap-1.5 text-[12px]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            <input
              type="checkbox"
              checked={autoLogin}
              onChange={(event) => setAutoLogin(event.target.checked)}
            />
            Auto-login on first boot (cloud-init)
          </label>
        </div>
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          A project-scoped template needs <code>template.write</code> on that project; the
          controller refuses the create if the grant is missing.
        </p>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            variant="default"
            size="sm"
          >
            {busy ? 'Creating…' : 'Create template'}
          </Button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
