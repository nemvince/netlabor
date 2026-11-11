import type { ImageKind, NodeType } from '@netlabor/contract';
import {
  AtmSwitchProperties,
  CloudProperties,
  DockerProperties,
  DynamipsProperties,
  FrameRelaySwitchProperties,
  HubProperties,
  IouProperties,
  NatProperties,
  QemuProperties,
  SwitchProperties,
  VpcsProperties,
} from '@netlabor/contract';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import { Field, Input, Select, Textarea } from '../../components/Field.tsx';
import { ImagePicker } from '../../components/ImagePicker.tsx';
import { orpc } from '../../lib/api.ts';
import { messageOf } from '../../lib/errors.ts';

export interface PropertyField {
  /** Supports dotted paths for nested properties, e.g. `disks.hda.imageId`. */
  key: string;
  label: string;
  kind:
    | 'text'
    | 'number'
    | 'checkbox'
    | 'select'
    | 'textarea'
    | 'image'
    | 'secret'
    | 'ports'
    | 'password';
  hint?: string;
  /** Optional collapsible section label (e.g. Cloud-init). */
  group?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  imageKind?: ImageKind;
  /** Row shape for the structured `portsMapping` editor. */
  portsKind?: 'cloud' | 'switch' | 'hub';
}

/** Control for one property field, including library image pickers. */
export function PropertyFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PropertyField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  if (field.kind === 'checkbox') {
    return (
      <label className="flex items-center gap-2 py-1 text-[12px]">
        <input
          type="checkbox"
          className="size-3.5"
          style={{ accentColor: 'var(--color-copper)' }}
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  if (field.kind === 'image') {
    return (
      <ImagePicker
        label={field.label}
        kind={field.imageKind}
        hint={field.hint}
        disabled={disabled}
        value={typeof value === 'string' ? value : null}
        onChange={(imageId) => onChange(imageId)}
      />
    );
  }
  if (field.kind === 'ports') {
    return (
      <PortsMappingEditor field={field} value={value} onChange={onChange} disabled={disabled} />
    );
  }
  if (field.kind === 'secret') {
    return <SecretField field={field} value={value} onChange={onChange} disabled={disabled} />;
  }
  return (
    <Field label={field.label} hint={field.hint}>
      {field.kind === 'select' ? (
        <Select
          disabled={disabled}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">default</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : field.kind === 'textarea' ? (
        <Textarea
          rows={2}
          className="tabular text-[11px]"
          placeholder={field.placeholder}
          disabled={disabled}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : field.kind === 'password' ? (
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={field.placeholder}
          disabled={disabled}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          type={field.kind === 'number' ? 'number' : 'text'}
          className={field.kind === 'number' ? 'tabular text-[11px]' : undefined}
          placeholder={field.placeholder}
          disabled={disabled}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) =>
            onChange(field.kind === 'number' ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </Field>
  );
}

/** Encrypted secret picker backed by `secrets.list` (requires settings.read). */
function SecretField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PropertyField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const secrets = useQuery({
    ...orpc.secrets.list.queryOptions({ input: {} }),
    retry: false,
  });
  if (secrets.isPending) {
    return (
      <Field label={field.label} hint="Loading secrets…">
        <Select disabled value="">
          <option value="">loading…</option>
        </Select>
      </Field>
    );
  }
  if (secrets.isError) {
    return (
      <Field label={field.label} hint={messageOf(secrets.error)}>
        <Select disabled value="">
          <option value="">unavailable</option>
        </Select>
      </Field>
    );
  }
  const items = secrets.data ?? [];
  if (items.length === 0) {
    return (
      <Field
        label={field.label}
        hint="No encrypted secrets exist. An administrator with settings.write must create one first."
      >
        <Select disabled value="">
          <option value="">none available</option>
        </Select>
      </Field>
    );
  }
  const currentId = typeof value === 'string' ? value : '';
  const known = items.some((secret) => secret.id === currentId);
  return (
    <Field label={field.label} hint={field.hint}>
      <Select
        disabled={disabled}
        value={currentId}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">none</option>
        {currentId !== '' && !known ? (
          <option value={currentId}>unknown secret ({currentId.slice(0, 8)})</option>
        ) : null}
        {items.map((secret) => (
          <option key={secret.id} value={secret.id}>
            {secret.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const CLOUD_PORT_TYPES = [
  { value: 'ethernet', label: 'ethernet' },
  { value: 'tap', label: 'tap' },
  { value: 'udp', label: 'udp' },
];

const SWITCH_PORT_TYPES = [
  { value: 'access', label: 'access' },
  { value: 'dot1q', label: 'dot1q' },
  { value: 'qinq', label: 'qinq' },
];

type PortRow = Record<string, unknown>;

function blankPort(kind: 'cloud' | 'switch' | 'hub', index: number): PortRow {
  if (kind === 'switch') {
    return { name: `Ethernet${index}`, portNumber: index, type: 'access', vlan: 1 };
  }
  if (kind === 'hub') return { name: `Port ${index}`, portNumber: index };
  return { name: `eth${index}`, type: 'ethernet' };
}

function numberOrUndefined(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const PORT_LABEL_STYLE = { color: 'var(--color-ink-faint)' } as const;

/** Structured `portsMapping` editor for cloud, switch, and hub node types. */
function PortsMappingEditor({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PropertyField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const kind = field.portsKind ?? 'cloud';
  // `portsMapping` is validated by the node-type Zod schema before it reaches
  // this editor, so rows are plain objects with the fields rendered below.
  const rows = (Array.isArray(value) ? value : []) as PortRow[];

  function update(index: number, patch: PortRow) {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[3px] border px-2 py-1.5"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel-sunken)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="nb-rule-label">{field.label}</span>
        <button
          type="button"
          className="nb-button"
          data-size="sm"
          disabled={disabled}
          onClick={() => onChange([...rows, blankPort(kind, rows.length)])}
        >
          <Plus size={12} aria-hidden /> Add port
        </button>
      </div>
      {field.hint ? (
        <p className="text-[10px] leading-[1.5]" style={PORT_LABEL_STYLE}>
          {field.hint}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-[10px] leading-[1.5]" style={PORT_LABEL_STYLE}>
          No ports defined. Add one port for every link endpoint.
        </p>
      ) : null}
      {rows.map((row, index) => {
        const portType = typeof row.type === 'string' ? row.type : '';
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: port rows are positional and carry no id
            key={index}
            className="grid grid-cols-2 gap-1.5 rounded-[2px] border p-1.5"
            style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
          >
            <div className="flex flex-col gap-0.5 text-[10px]">
              <span style={PORT_LABEL_STYLE}>Name</span>
              <Input
                aria-label={`Port ${index + 1} name`}
                className="py-1 text-[11px]"
                disabled={disabled}
                value={typeof row.name === 'string' ? row.name : ''}
                onChange={(event) => update(index, { name: event.target.value })}
              />
            </div>
            {kind === 'cloud' ? (
              <div className="flex flex-col gap-0.5 text-[10px]">
                <span style={PORT_LABEL_STYLE}>Type</span>
                <Select
                  aria-label={`Port ${index + 1} type`}
                  className="py-1 text-[11px]"
                  disabled={disabled}
                  value={portType}
                  onChange={(event) => {
                    const next = event.target.value;
                    update(
                      index,
                      next === 'udp' ? { type: next, interface: null } : { type: next, udp: null },
                    );
                  }}
                >
                  {CLOUD_PORT_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5 text-[10px]">
                <span style={PORT_LABEL_STYLE}>Port number</span>
                <Input
                  aria-label={`Port ${index + 1} number`}
                  type="number"
                  min={0}
                  step={1}
                  className="tabular py-1 text-[11px]"
                  disabled={disabled}
                  value={typeof row.portNumber === 'number' ? String(row.portNumber) : ''}
                  onChange={(event) =>
                    update(index, { portNumber: numberOrUndefined(event.target.value) })
                  }
                />
              </div>
            )}
            {kind === 'cloud' ? (
              portType === 'udp' ? (
                <div className="flex flex-col gap-0.5 text-[10px]">
                  <span style={PORT_LABEL_STYLE}>UDP endpoint</span>
                  <Input
                    aria-label={`Port ${index + 1} UDP endpoint`}
                    className="py-1 text-[11px]"
                    placeholder="10.0.0.1:5000"
                    disabled={disabled}
                    value={typeof row.udp === 'string' ? row.udp : ''}
                    onChange={(event) =>
                      update(index, { udp: event.target.value === '' ? null : event.target.value })
                    }
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 text-[10px]">
                  <span style={PORT_LABEL_STYLE}>Host interface</span>
                  <Input
                    aria-label={`Port ${index + 1} host interface`}
                    className="py-1 text-[11px]"
                    placeholder="eth0"
                    disabled={disabled}
                    value={typeof row.interface === 'string' ? row.interface : ''}
                    onChange={(event) =>
                      update(index, {
                        interface: event.target.value === '' ? null : event.target.value,
                      })
                    }
                  />
                </div>
              )
            ) : null}
            {kind === 'switch' ? (
              <>
                <div className="flex flex-col gap-0.5 text-[10px]">
                  <span style={PORT_LABEL_STYLE}>Mode</span>
                  <Select
                    aria-label={`Port ${index + 1} mode`}
                    className="py-1 text-[11px]"
                    disabled={disabled}
                    value={portType === '' ? 'access' : portType}
                    onChange={(event) => update(index, { type: event.target.value })}
                  >
                    {SWITCH_PORT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-0.5 text-[10px]">
                  <span style={PORT_LABEL_STYLE}>VLAN</span>
                  <Input
                    aria-label={`Port ${index + 1} VLAN`}
                    type="number"
                    min={1}
                    max={4094}
                    step={1}
                    className="tabular py-1 text-[11px]"
                    disabled={disabled}
                    value={typeof row.vlan === 'number' ? String(row.vlan) : ''}
                    onChange={(event) =>
                      update(index, { vlan: numberOrUndefined(event.target.value) })
                    }
                  />
                </div>
              </>
            ) : null}
            <div className="col-span-2 flex justify-end">
              <button
                type="button"
                className="nb-button"
                data-size="sm"
                data-variant="ghost"
                aria-label={`Remove port ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, position) => position !== index))}
              >
                <Trash2 size={12} aria-hidden /> Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Render scalar properties grouped into optional collapsible sections. */
export function GroupedPropertyFields({
  fields,
  values,
  onChange,
  disabled,
}: {
  fields: PropertyField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}) {
  const isWide = (field: PropertyField) =>
    field.kind === 'textarea' ||
    field.kind === 'image' ||
    field.kind === 'ports' ||
    field.kind === 'checkbox' ||
    field.kind === 'password';
  const grid = (list: PropertyField[]) => (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
      {list.map((field) => (
        <div key={field.key} className={isWide(field) ? 'col-span-2' : undefined}>
          <PropertyFieldInput
            field={field}
            disabled={disabled}
            value={readProperty(values, field.key)}
            onChange={(value) => onChange(field.key, value)}
          />
        </div>
      ))}
    </div>
  );
  const plain = fields.filter((field) => !field.group);
  const groups = [...new Set(fields.map((field) => field.group).filter(Boolean))] as string[];
  return (
    <div className="flex flex-col gap-2">
      {plain.length > 0 ? grid(plain) : null}
      {groups.map((group) => (
        <details
          key={group}
          className="rounded-[2px] border px-2 py-1.5"
          style={{ borderColor: 'var(--color-rule)' }}
        >
          <summary
            className="cursor-pointer text-[11px]"
            style={{ color: 'var(--color-ink-soft)' }}
          >
            {group}
          </summary>
          <div className="mt-1.5">{grid(fields.filter((field) => field.group === group))}</div>
        </details>
      ))}
    </div>
  );
}

/** Read a possibly nested property (`disks.hda.imageId`). */
export function readProperty(properties: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, properties);
}

/** Write a possibly nested property, preserving sibling values. */
export function withProperty(
  properties: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const segments = key.split('.');
  const clone = structuredClone(properties);
  let cursor: Record<string, unknown> = clone;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const last = segments[segments.length - 1] as string;
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
  return clone;
}

const CONSOLE_OPTIONS = [
  { value: 'telnet', label: 'telnet' },
  { value: 'vnc', label: 'vnc' },
  { value: 'none', label: 'none' },
  { value: 'http', label: 'http' },
  { value: 'https', label: 'https' },
];

const QEMU_CONSOLE_OPTIONS = CONSOLE_OPTIONS.filter((option) =>
  ['telnet', 'vnc', 'none'].includes(option.value),
);

const ADAPTER_TYPES = [
  'e1000',
  'virtio-net-pci',
  'rtl8139',
  'i82557b',
  'i82559er',
  'ne2k_pci',
  'pcnet',
].map((value) => ({ value, label: value }));

const BOOT_PRIORITIES = ['c', 'd', 'n', 'cn', 'cd', 'dn', 'dc', 'nc', 'nd'].map((value) => ({
  value,
  label: value,
}));

const DYNAMIPS_PLATFORMS = ['c7200', 'c3745', 'c3725', 'c3600', 'c2691', 'c2600', 'c1700'].map(
  (value) => ({ value, label: value }),
);

const NPE_OPTIONS = [
  'npe-100',
  'npe-150',
  'npe-175',
  'npe-200',
  'npe-225',
  'npe-400',
  'npe-g1',
  'npe-g2',
].map((value) => ({ value, label: value }));

const MIDPLANE_OPTIONS = [
  { value: 'std', label: 'std' },
  { value: 'vxr', label: 'vxr' },
];

const NODE_SCHEMAS: Record<NodeType, z.ZodType> = {
  qemu: QemuProperties,
  iou: IouProperties,
  dynamips: DynamipsProperties,
  vpcs: VpcsProperties,
  docker: DockerProperties,
  cloud: CloudProperties,
  nat: NatProperties,
  ethernet_switch: SwitchProperties,
  ethernet_hub: HubProperties,
  atm_switch: AtmSwitchProperties,
  frame_relay_switch: FrameRelaySwitchProperties,
};

export function parseTemplateProperties(
  nodeType: NodeType,
  properties: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  const schema = NODE_SCHEMAS[nodeType];
  const parsed = schema.safeParse(properties);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, message: `${path}${issue?.message ?? 'properties are invalid'}` };
  }
  if (typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
    return { ok: false, message: 'properties must be a JSON object' };
  }
  return { ok: true, value: Object.fromEntries(Object.entries(parsed.data)) };
}

export const PROPERTY_FIELDS: Partial<Record<NodeType, PropertyField[]>> = {
  qemu: [
    { key: 'ram', label: 'RAM (MB)', kind: 'number' },
    { key: 'cpus', label: 'CPUs', kind: 'number' },
    { key: 'adapters', label: 'Adapters', kind: 'number' },
    { key: 'adapterType', label: 'Adapter type', kind: 'select', options: ADAPTER_TYPES },
    { key: 'consoleType', label: 'Console', kind: 'select', options: QEMU_CONSOLE_OPTIONS },
    { key: 'consoleAutoStart', label: 'Auto-open console', kind: 'checkbox' },
    { key: 'bootPriority', label: 'Boot priority', kind: 'select', options: BOOT_PRIORITIES },
    { key: 'machineType', label: 'Machine type', kind: 'text', placeholder: 'pc' },
    { key: 'platform', label: 'Platform', kind: 'text', placeholder: 'x86_64' },
    { key: 'macAddress', label: 'Base MAC', kind: 'text', placeholder: '52:54:00:…' },
    { key: 'qemuPath', label: 'QEMU binary', kind: 'text', hint: 'empty uses the agent default' },
    { key: 'linkedClone', label: 'Linked clone disks', kind: 'checkbox' },
    { key: 'disks.hda.imageId', label: 'Disk hda image', kind: 'image', imageKind: 'qemu' },
    { key: 'disks.hdb.imageId', label: 'Disk hdb image', kind: 'image', imageKind: 'qemu' },
    { key: 'disks.hdc.imageId', label: 'Disk hdc image', kind: 'image', imageKind: 'qemu' },
    { key: 'disks.hdd.imageId', label: 'Disk hdd image', kind: 'image', imageKind: 'qemu' },
    { key: 'cdromImageId', label: 'CD-ROM image', kind: 'image', imageKind: 'qemu' },
    {
      key: 'cloudInitEnabled',
      label: 'Enable cloud-init',
      kind: 'checkbox',
      group: 'Cloud-init',
      hint: 'Attach a NoCloud seed ISO at start. Requires xorriso on the compute.',
    },
    {
      key: 'cloudInitVariant',
      label: 'Profile',
      kind: 'select',
      group: 'Cloud-init',
      options: [
        { value: 'server', label: 'Server (headless)' },
        { value: 'desktop', label: 'Desktop (XFCE, GUI)' },
      ],
      hint: 'Desktop installs XFCE (32 GiB disk) and auto-logs the cloud user into the GUI. Use a VNC console.',
    },
    { key: 'cloudInitUser', label: 'User', kind: 'text', group: 'Cloud-init' },
    {
      key: 'cloudInitPassword',
      label: 'Password',
      kind: 'password',
      group: 'Cloud-init',
      hint: 'Change the template default before starting the node.',
    },
    { key: 'cloudInitHostname', label: 'Hostname', kind: 'text', group: 'Cloud-init' },
    {
      key: 'cloudInitNetworkMode',
      label: 'Network',
      kind: 'select',
      group: 'Cloud-init',
      options: [
        { value: 'dhcp', label: 'DHCP' },
        { value: 'static', label: 'Static' },
      ],
    },
    {
      key: 'cloudInitIpAddress',
      label: 'Address / prefix',
      kind: 'text',
      group: 'Cloud-init',
      placeholder: '10.0.0.10/24',
    },
    { key: 'cloudInitGateway', label: 'Gateway', kind: 'text', group: 'Cloud-init' },
    {
      key: 'cloudInitDns',
      label: 'DNS servers',
      kind: 'text',
      group: 'Cloud-init',
      placeholder: '1.1.1.1, 9.9.9.9',
    },
    {
      key: 'cloudInitAutoLogin',
      label: 'Auto-login desktop',
      kind: 'checkbox',
      group: 'Cloud-init',
      hint: 'Sign the cloud user into the GUI automatically. Desktop profile only.',
    },
    {
      key: 'cloudInitSshKey',
      label: 'SSH public keys',
      kind: 'textarea',
      group: 'Cloud-init',
      hint: 'One key per line.',
    },
    {
      key: 'cloudInitUserData',
      label: 'Custom user-data',
      kind: 'textarea',
      group: 'Cloud-init (custom seed)',
      hint: 'Verbatim NoCloud user-data. Overrides the generated user-data; upload railink output here.',
    },
    {
      key: 'cloudInitMetaData',
      label: 'Custom meta-data',
      kind: 'textarea',
      group: 'Cloud-init (custom seed)',
      hint: 'Verbatim meta-data. Empty generates an instance-id from the seed contents.',
    },
    {
      key: 'cloudInitNetworkConfig',
      label: 'Custom network-config',
      kind: 'textarea',
      group: 'Cloud-init (custom seed)',
      hint: 'Verbatim netplan v2. Overrides the DHCP/static fields above.',
    },
  ],
  iou: [
    { key: 'ram', label: 'RAM (MB)', kind: 'number' },
    { key: 'nvram', label: 'NVRAM (KB)', kind: 'number' },
    { key: 'ethernetAdapters', label: 'Ethernet adapters', kind: 'number' },
    { key: 'serialAdapters', label: 'Serial adapters', kind: 'number' },
    { key: 'licenseCheck', label: 'License check', kind: 'checkbox' },
    { key: 'useDefaultIouValues', label: 'Default IOU values', kind: 'checkbox' },
    { key: 'l1Keepalives', label: 'L1 keepalives', kind: 'checkbox' },
    { key: 'consoleType', label: 'Console', kind: 'select', options: CONSOLE_OPTIONS },
    { key: 'consoleAutoStart', label: 'Auto-open console', kind: 'checkbox' },
    { key: 'imageId', label: 'IOU image', kind: 'image', imageKind: 'iou' },
    { key: 'iourcSecretId', label: 'iourc secret', kind: 'secret' },
    {
      key: 'startupConfig',
      label: 'Startup config',
      kind: 'textarea',
      hint: 'Applied with -c at launch. A startup-config.cfg uploaded through node files wins if this is empty.',
    },
  ],
  dynamips: [
    { key: 'platform', label: 'Platform', kind: 'select', options: DYNAMIPS_PLATFORMS },
    { key: 'ram', label: 'RAM (MB)', kind: 'number' },
    { key: 'nvram', label: 'NVRAM (KB)', kind: 'number' },
    { key: 'imageId', label: 'IOS image', kind: 'image', imageKind: 'dynamips' },
    { key: 'npe', label: 'NPE', kind: 'select', options: NPE_OPTIONS },
    { key: 'midplane', label: 'Midplane', kind: 'select', options: MIDPLANE_OPTIONS },
    { key: 'mmap', label: 'Use mmap', kind: 'checkbox' },
    { key: 'sparsemem', label: 'Sparse memory', kind: 'checkbox' },
    { key: 'consoleType', label: 'Console', kind: 'select', options: CONSOLE_OPTIONS },
    { key: 'consoleAutoStart', label: 'Auto-open console', kind: 'checkbox' },
    { key: 'auxConsole', label: 'Aux console', kind: 'checkbox' },
    { key: 'idlepc', label: 'Idle-PC', kind: 'text' },
    { key: 'idlemax', label: 'Idle max', kind: 'number' },
    { key: 'idlesleep', label: 'Idle sleep', kind: 'number' },
  ],
  vpcs: [
    { key: 'consoleType', label: 'Console', kind: 'select', options: CONSOLE_OPTIONS },
    { key: 'consoleAutoStart', label: 'Auto-open console', kind: 'checkbox' },
    {
      key: 'macId',
      label: 'MAC ID',
      kind: 'number',
      hint: '0 assigns a MAC automatically on start',
    },
    { key: 'startupScript', label: 'Startup script', kind: 'textarea' },
  ],
  docker: [
    { key: 'imageName', label: 'Container image', kind: 'text', placeholder: 'alpine:3.20' },
    { key: 'adapters', label: 'Adapters', kind: 'number' },
    {
      key: 'privileged',
      label: 'Privileged',
      kind: 'checkbox',
      hint: 'Required by routing images such as FRR; GNS3 enables it for all Docker nodes.',
    },
    { key: 'consoleType', label: 'Console', kind: 'select', options: CONSOLE_OPTIONS },
    { key: 'consoleAutoStart', label: 'Auto-open console', kind: 'checkbox' },
    { key: 'startCommand', label: 'Start command', kind: 'textarea' },
    {
      key: 'environment',
      label: 'Environment',
      kind: 'textarea',
      hint: 'newline separated KEY=VALUE',
    },
    { key: 'extraHosts', label: 'Extra hosts', kind: 'textarea' },
    {
      key: 'extraVolumes',
      label: 'Extra volumes',
      kind: 'textarea',
      hint: 'One absolute container path per line. It binds the same path under the node files directory.',
    },
    { key: 'consoleHttpPort', label: 'HTTP console port', kind: 'number' },
    { key: 'consoleHttpPath', label: 'HTTP console path', kind: 'text' },
  ],
  cloud: [
    {
      key: 'portsMapping',
      label: 'Ports',
      kind: 'ports',
      portsKind: 'cloud',
      hint: 'ethernet and tap ports bind a host interface; udp ports tunnel to a remote endpoint.',
    },
    { key: 'remoteConsoleHost', label: 'Remote console host', kind: 'text' },
    { key: 'remoteConsolePort', label: 'Remote console port', kind: 'number' },
    {
      key: 'remoteConsoleType',
      label: 'Remote console type',
      kind: 'select',
      options: CONSOLE_OPTIONS,
    },
    { key: 'remoteConsoleHttpPath', label: 'Remote HTTP path', kind: 'text' },
  ],
  ethernet_switch: [
    {
      key: 'portsMapping',
      label: 'Ports',
      kind: 'ports',
      portsKind: 'switch',
      hint: 'Access ports carry one VLAN untagged; dot1q and qinq ports carry tagged VLANs.',
    },
  ],
  ethernet_hub: [
    {
      key: 'portsMapping',
      label: 'Ports',
      kind: 'ports',
      portsKind: 'hub',
      hint: 'Every hub port floods to all other ports.',
    },
  ],
};
