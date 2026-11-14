/** Nodes: rows, per-emulator property schemas, and node operations. */

import { z } from 'zod';
import { ConsoleType, Id, LaneType, NodePort, NodeStatus, NodeType, Timestamp } from './common.ts';

const PortLabelProps = {
  firstPortName: z.string().optional(),
  portNameFormat: z.string().optional(),
  portSegmentSize: z.number().int().positive().nullable().optional(),
};

export const QemuProperties = z.object({
  qemuPath: z.string().nullable().optional(),
  platform: z.string().nullable().optional(),
  ram: z.number().int().min(16).max(1_048_576).default(256),
  cpus: z.number().int().min(1).max(64).default(1),
  adapters: z.number().int().min(0).max(32).default(1),
  adapterType: z
    .enum(['e1000', 'virtio-net-pci', 'rtl8139', 'i82557b', 'i82559er', 'ne2k_pci', 'pcnet'])
    .default('e1000'),
  macAddress: z.string().nullable().optional(),
  ...PortLabelProps,
  consoleType: z.enum(['telnet', 'vnc', 'none']).default('telnet'),
  consoleAutoStart: z.boolean().default(true),
  bootPriority: z.enum(['c', 'd', 'n', 'cn', 'cd', 'dn', 'dc', 'nc', 'nd']).default('c'),
  disks: z
    .object({
      hda: z
        .object({
          imageId: Id.nullable().optional(),
          interface: z.string().optional(),
          format: z.string().optional(),
          sizeBytes: z.number().int().positive().optional(),
        })
        .optional(),
      hdb: z
        .object({
          imageId: Id.nullable().optional(),
          interface: z.string().optional(),
          format: z.string().optional(),
          sizeBytes: z.number().int().positive().optional(),
        })
        .optional(),
      hdc: z
        .object({
          imageId: Id.nullable().optional(),
          interface: z.string().optional(),
          format: z.string().optional(),
          sizeBytes: z.number().int().positive().optional(),
        })
        .optional(),
      hdd: z
        .object({
          imageId: Id.nullable().optional(),
          interface: z.string().optional(),
          format: z.string().optional(),
          sizeBytes: z.number().int().positive().optional(),
        })
        .optional(),
    })
    .default({}),
  cdromImageId: Id.nullable().optional(),
  biosImageId: Id.nullable().optional(),
  kernelImageId: Id.nullable().optional(),
  initrdImageId: Id.nullable().optional(),
  kernelCommandLine: z.string().optional(),
  machineType: z.string().optional(),
  cpuModel: z.string().optional(),
  options: z.array(z.string()).default([]),
  linkedClone: z.boolean().default(true),
  cloudInitEnabled: z.boolean().default(false),
  cloudInitVariant: z.enum(['server', 'desktop']).default('server'),
  cloudInitUser: z.string().optional(),
  cloudInitPassword: z.string().optional(),
  cloudInitHostname: z.string().optional(),
  cloudInitNetworkMode: z.enum(['dhcp', 'static']).default('dhcp'),
  cloudInitIpAddress: z.string().optional(),
  cloudInitGateway: z.string().optional(),
  cloudInitDns: z.string().optional(),
  cloudInitSshKey: z.string().optional(),
  cloudInitAutoLogin: z.boolean().default(true),
  /** Verbatim NoCloud files; any non-empty value overrides the generated file. */
  cloudInitUserData: z.string().optional(),
  cloudInitMetaData: z.string().optional(),
  cloudInitNetworkConfig: z.string().optional(),
});
export type QemuProperties = z.infer<typeof QemuProperties>;

export const IouProperties = z.object({
  imageId: Id.nullable().optional(),
  iourcSecretId: Id.nullable().optional(),
  licenseCheck: z.boolean().default(true),
  ethernetAdapters: z.number().int().min(0).max(16).default(2),
  serialAdapters: z.number().int().min(0).max(16).default(2),
  ram: z.number().int().min(64).default(256),
  nvram: z.number().int().min(64).default(128),
  useDefaultIouValues: z.boolean().default(true),
  startupConfig: z.string().nullable().optional(),
  privateConfig: z.string().nullable().optional(),
  applicationId: z.number().int().nullable().optional(),
  l1Keepalives: z.boolean().default(false),
  consoleType: ConsoleType.default('telnet'),
  consoleAutoStart: z.boolean().default(true),
  ...PortLabelProps,
});
export type IouProperties = z.infer<typeof IouProperties>;

export const DynamipsProperties = z.object({
  platform: z
    .enum(['c7200', 'c3745', 'c3725', 'c3600', 'c2691', 'c2600', 'c1700'])
    .default('c7200'),
  imageId: Id.nullable().optional(),
  ram: z.number().int().min(64).default(256),
  nvram: z.number().int().min(16).default(128),
  mmap: z.boolean().default(true),
  execArea: z.number().int().nullable().optional(),
  macAddr: z.string().nullable().optional(),
  systemId: z.string().nullable().optional(),
  startupConfig: z.string().nullable().optional(),
  privateConfig: z.string().nullable().optional(),
  idlepc: z.string().nullable().optional(),
  idlemax: z.number().int().default(1500),
  idlesleep: z.number().int().default(30),
  autoDeleteDisks: z.boolean().default(false),
  npe: z
    .enum(['npe-100', 'npe-150', 'npe-175', 'npe-200', 'npe-225', 'npe-400', 'npe-g1', 'npe-g2'])
    .nullable()
    .optional(),
  midplane: z.enum(['std', 'vxr']).nullable().optional(),
  sparsemem: z.boolean().default(false),
  consoleType: ConsoleType.default('telnet'),
  consoleAutoStart: z.boolean().default(true),
  auxConsole: z.boolean().default(false),
  slots: z.array(z.string().nullable()).default([]),
  wics: z.array(z.string().nullable()).default([]),
  ...PortLabelProps,
});
export type DynamipsProperties = z.infer<typeof DynamipsProperties>;

export const VpcsProperties = z.object({
  startupScript: z.string().nullable().optional(),
  macId: z.number().int().min(0).max(65535).optional(),
  consoleType: ConsoleType.default('telnet'),
  consoleAutoStart: z.boolean().default(true),
  ...PortLabelProps,
});
export type VpcsProperties = z.infer<typeof VpcsProperties>;

export const DockerProperties = z.object({
  imageName: z.string().default('alpine:3.20'),
  adapters: z.number().int().min(0).max(32).default(1),
  macAddress: z.string().nullable().optional(),
  /** GNS3 runs Docker nodes privileged; FRR and other routing images need it. */
  privileged: z.boolean().default(true),
  startCommand: z.string().nullable().optional(),
  environment: z.string().nullable().optional(),
  extraHosts: z.string().nullable().optional(),
  extraVolumes: z.string().nullable().optional(),
  consoleType: ConsoleType.default('telnet'),
  consoleAutoStart: z.boolean().default(true),
  consoleHttpPort: z.number().int().min(1).max(65535).nullable().optional(),
  consoleHttpPath: z.string().nullable().optional(),
  consoleResolution: z.string().nullable().optional(),
  consoleUser: z.string().nullable().optional(),
});
export type DockerProperties = z.infer<typeof DockerProperties>;

export const CloudProperties = z.object({
  portsMapping: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['ethernet', 'tap', 'udp']),
        interface: z.string().nullable().optional(),
        udp: z.string().nullable().optional(),
      }),
    )
    .default([]),
  remoteConsoleHost: z.string().nullable().optional(),
  remoteConsolePort: z.number().int().nullable().optional(),
  remoteConsoleType: z.enum(['telnet', 'vnc', 'http', 'https', 'none']).default('none'),
  remoteConsoleHttpPath: z.string().nullable().optional(),
});
export type CloudProperties = z.infer<typeof CloudProperties>;

export const NatProperties = z.object({
  portsMapping: z
    .array(
      z.object({ name: z.string(), type: LaneType, interface: z.string().nullable().optional() }),
    )
    .default([{ name: 'nat0', type: 'ethernet' }]),
});

export const SwitchVlanSchema = z.object({
  vlan: z.number().int().min(1).max(4094).nullable().optional(),
  type: z.enum(['access', 'dot1q', 'qinq', 'none']).default('access'),
  nativeVlan: z.number().int().min(1).max(4094).nullable().optional(),
  taggedVlans: z.array(z.number().int().min(1).max(4094)).default([]),
  ethertype: z.enum(['0x8100', '0x88a8']).default('0x8100'),
});

export const SwitchProperties = z.object({
  portsMapping: z
    .array(
      z.object({
        name: z.string(),
        portNumber: z.number().int().min(0),
        type: z.enum(['access', 'dot1q', 'qinq']).default('access'),
        vlan: z.number().int().min(1).max(4094).default(1),
      }),
    )
    .default([]),
  consoleType: z.literal('none').default('none'),
});

export const HubProperties = z.object({
  portsMapping: z
    .array(z.object({ name: z.string(), portNumber: z.number().int().min(0) }))
    .default([]),
});

const DynMappingKey = z
  .string()
  .regex(/^\d+(:\d+){1,2}$/, 'expected "<port>:<vpi>:<vci>" or "<port>:<dlci>"');
export const AtmSwitchProperties = z.object({
  mappings: z.record(DynMappingKey, DynMappingKey).default({}),
});
export const FrameRelaySwitchProperties = AtmSwitchProperties;

export const NodeProperties = z.union([
  QemuProperties,
  IouProperties,
  DynamipsProperties,
  VpcsProperties,
  DockerProperties,
  CloudProperties,
  NatProperties,
  SwitchProperties,
  HubProperties,
  AtmSwitchProperties,
]);

export const NodeRow = z.object({
  id: Id,
  projectId: Id,
  computeId: Id,
  computeName: z.string(),
  name: z.string(),
  symbol: z.string(),
  nodeType: NodeType,
  templateId: Id.nullable(),
  x: z.number(),
  y: z.number(),
  z: z.number().int(),
  layer: z.string(),
  locked: z.boolean(),
  isolated: z.boolean(),
  consolePort: z.number().int().nullable(),
  consoleType: ConsoleType,
  consoleAutoStart: z.boolean(),
  properties: z.record(z.string(), z.unknown()),
  status: NodeStatus,
  ports: z.array(NodePort),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type NodeRow = z.infer<typeof NodeRow>;

export const NodeCreateInput = z.object({
  projectId: Id,
  templateId: Id.optional(),
  nodeType: NodeType.optional(),
  computeId: Id.optional(),
  name: z.string().min(1).max(128).optional(),
  x: z.number().default(0),
  y: z.number().default(0),
  z: z.number().int().default(0),
  layer: z.string().default('default'),
  symbol: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type NodeCreateInput = z.infer<typeof NodeCreateInput>;

export const NodeUpdateInput = z.object({
  id: Id,
  name: z.string().min(1).max(128).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().int().optional(),
  layer: z.string().optional(),
  locked: z.boolean().optional(),
  symbol: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  consoleAutoStart: z.boolean().optional(),
});

export const NodeDuplicateInput = z.object({
  id: Id,
  x: z.number().optional(),
  y: z.number().optional(),
  name: z.string().min(1).max(128).optional(),
});

export const NodeActionOutput = z.object({ id: Id, status: NodeStatus });

export const ConsoleTicketInput = z.object({
  id: Id,
  purpose: z.enum(['console', 'vnc']).default('console'),
});

export const ConsoleTicketOutput = z.object({
  ticket: z.string(),
  wsUrl: z.string(),
  /** Direct TCP endpoint the agent exposes for external telnet clients. */
  tcp: z.object({ host: z.string(), port: z.number().int() }).nullable(),
  consoleType: ConsoleType,
});

export const ConsoleExecInput = z.object({
  id: Id,
  commands: z.array(z.string()).min(1).max(64),
  timeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
  /** Optional prompt regex; defaults to the device's usual > or # prompt. */
  prompt: z.string().min(1).max(500).optional(),
  /** Send terminal length 0 before commands on IOS-style consoles. */
  terminalLengthZero: z.boolean().default(true),
});

export const ConsoleExecOutput = z.object({
  transcript: z.string(),
  ok: z.boolean(),
  timedOut: z.boolean(),
});

/**
 * Detailed-input shape for the node web-console proxy: path params plus the
 * request parts that are forwarded upstream unchanged.
 */
export const WebProxyInput = z.object({
  params: z.object({ nodeId: Id, rest: z.string() }),
  query: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.any().optional(),
});

/** Detailed-input shape for the console root page (no catch-all segment). */
export const WebProxyRootInput = z.object({
  params: z.object({ nodeId: Id }),
  query: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.any().optional(),
});

/** Statuses a proxied node web console may return to the browser. */
export const WEB_PROXY_STATUSES = [200, 201, 202, 204, 206, 301, 302, 303, 304, 307, 308] as const;

export interface WebProxyOutput {
  status?: (typeof WEB_PROXY_STATUSES)[number];
  headers?: Record<string, string>;
  body: unknown;
}

const webProxyVariant = (status: number) =>
  z.object({
    status: z.literal(status),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.any(),
  });

export const WebProxyOutputSchema = z.union(
  WEB_PROXY_STATUSES.map(webProxyVariant) as [
    ReturnType<typeof webProxyVariant>,
    ReturnType<typeof webProxyVariant>,
    ...ReturnType<typeof webProxyVariant>[],
  ],
) as unknown as z.ZodType<WebProxyOutput>;

export const NodeFileEntry = z.object({
  path: z.string(),
  sizeBytes: z.number(),
  mtime: Timestamp,
  directory: z.boolean(),
});

export const NodeFileReadOutput = z.object({
  path: z.string(),
  content: z.string(),
  sizeBytes: z.number(),
});

export const NodeFileWriteInput = z.object({
  nodeId: Id,
  path: z.string().min(1).max(1_024),
  content: z.string().max(32 * 1024 * 1024),
});

export const DiskImageInput = z.object({
  nodeId: Id,
  disk: z.enum(['hda', 'hdb', 'hdc', 'hdd']),
  sizeBytes: z.number().int().positive().optional(),
});

export const DiskImageResizeInput = DiskImageInput.extend({
  sizeBytes: z.number().int().positive(),
});

export const DiskImageOutput = z.object({
  disk: z.string(),
  path: z.string(),
  sizeBytes: z.number(),
});

export const IdlepcInput = z.object({ nodeId: Id, idlepc: z.string().min(1) });

export const IdlepcProposal = z.object({
  idlepc: z.string(),
  score: z.number(),
  /** Human-readable count of idle cycles, when the hypervisor reports one. */
  description: z.string().optional(),
});
