/**
 * Fixture rows for the workspace demos. Shapes come from `@netlabor/contract`
 * and ports are derived with the same `portsForNode` the controller uses, so
 * the node cards, palette, and port picker render realistic data without a
 * server.
 */

import { catalogSymbols, catalogTemplates, portsForNode } from '@netlabor/catalog';
import type {
  ComputeRow,
  DrawingRow,
  EventEnvelope,
  ImageRow,
  JobRow,
  LinkRow,
  MeOutput,
  NodeRow,
  NodeStatus,
  NodeType,
  OsImageRow,
  ProjectRow,
  ProjectStats,
  SnapshotRow,
  TemplateRow,
} from '@netlabor/contract';

export const PROJECT_ID = '0f000000-0000-4000-8000-000000000001';
export const COMPUTE_ID = '0c000000-0000-4000-8000-0000000000a1';
export const USER_ID = '0a000000-0000-4000-8000-0000000000d1';

const CREATED = '2026-11-11T08:40:00+00:00';
const UPDATED = '2026-11-11T09:12:00+00:00';

function catalogTemplate(name: string): TemplateRow {
  const template = catalogTemplates.find((entry) => entry.name === name);
  if (!template) throw new Error(`fixture template missing: ${name}`);
  return {
    ...template,
    nodeType: template.nodeType as NodeType,
    computeId: null,
    poolId: null,
    builtin: true,
    createdBy: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    projectId: null,
  };
}

/** The four rows the palette lists, in the same shape `templates.list` returns. */
export const templates: TemplateRow[] = [
  catalogTemplate('Ethernet switch'),
  catalogTemplate('IOU L3 router'),
  catalogTemplate('VPCS'),
  catalogTemplate('Debian 13 cloud desktop'),
];

const templateByName = new Map(templates.map((template) => [template.name, template]));

/** Symbol SVGs, keyed by symbol id, exactly like the workspace's `symbols` map. */
export const symbols = new Map(catalogSymbols.map((symbol) => [symbol.id, symbol.svg]));

interface NodeFixture {
  id: string;
  name: string;
  template: string;
  status: NodeStatus;
  x: number;
  y: number;
  consolePort: number | null;
  properties?: Record<string, unknown>;
}

function node(fixture: NodeFixture): NodeRow {
  const template = templateByName.get(fixture.template);
  if (!template) throw new Error(`fixture template missing: ${fixture.template}`);
  const properties = { ...template.properties, ...(fixture.properties ?? {}) };
  const consoleType = properties.consoleType;
  return {
    id: fixture.id,
    projectId: PROJECT_ID,
    computeId: COMPUTE_ID,
    computeName: 'eu-1',
    name: fixture.name,
    symbol: template.symbol,
    nodeType: template.nodeType,
    templateId: template.id,
    x: fixture.x,
    y: fixture.y,
    z: 0,
    layer: 'default',
    locked: false,
    isolated: false,
    consolePort: fixture.consolePort,
    consoleType:
      consoleType === 'vnc' || consoleType === 'http' || consoleType === 'https'
        ? consoleType
        : consoleType === 'none'
          ? 'none'
          : 'telnet',
    consoleAutoStart: fixture.consolePort !== null,
    properties,
    status: fixture.status,
    ports: portsForNode(template.nodeType, properties),
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
}

export const nodes: NodeRow[] = [
  node({
    id: '0d000000-0000-4000-8000-000000000001',
    name: 'sw1',
    template: 'Ethernet switch',
    status: 'started',
    x: 110,
    y: 64,
    consolePort: null,
  }),
  node({
    id: '0d000000-0000-4000-8000-000000000002',
    name: 'r1',
    template: 'Debian 13 cloud desktop',
    status: 'stopped',
    x: 360,
    y: 20,
    consolePort: 5901,
    properties: { adapters: 2 },
  }),
  node({
    id: '0d000000-0000-4000-8000-000000000003',
    name: 'pc1',
    template: 'VPCS',
    status: 'started',
    x: 360,
    y: 168,
    consolePort: 5001,
  }),
  node({
    id: '0d000000-0000-4000-8000-000000000004',
    name: 'core1',
    template: 'IOU L3 router',
    status: 'error',
    x: 54,
    y: 186,
    consolePort: 5002,
  }),
];

export const nodeByName = new Map(nodes.map((row) => [row.name, row]));

/** A started switch with eight Ethernet ports, used by the palette/port demos. */
export const switchNode = nodeByName.get('sw1')!;

const link = (input: {
  id: string;
  a: string;
  adapterA: number;
  portA: number;
  b: string;
  adapterB: number;
  portB: number;
  style: LinkRow['style'];
}): LinkRow => {
  const nodeA = nodeByName.get(input.a);
  const nodeB = nodeByName.get(input.b);
  if (!nodeA || !nodeB) throw new Error('fixture link endpoint missing');
  return {
    id: input.id,
    projectId: PROJECT_ID,
    linkType: 'ethernet',
    nodeAId: nodeA.id,
    nodeAName: nodeA.name,
    adapterA: input.adapterA,
    portA: input.portA,
    nodeBId: nodeB.id,
    nodeBName: nodeB.name,
    adapterB: input.adapterB,
    portB: input.portB,
    suspend: false,
    status: 'active',
    style: input.style,
    filters: {},
    capture: null,
    dataplane: {
      mode: 'kernel',
      captureNodeId: null,
      filterSide: null,
      endpoints: [
        { computeId: COMPUTE_ID, anchor: `nl-${input.id}-a`, lport: 1, anchorKind: 'tap' },
        { computeId: COMPUTE_ID, anchor: `nl-${input.id}-b`, lport: 2, anchorKind: 'tap' },
      ],
      peer: null,
    },
    createdAt: CREATED,
    updatedAt: UPDATED,
  };
};

export const links: LinkRow[] = [
  link({
    id: '0e000000-0000-4000-8000-000000000001',
    a: 'sw1',
    adapterA: 0,
    portA: 0,
    b: 'r1',
    adapterB: 0,
    portB: 0,
    style: { type: 'orthogonal', width: 2 },
  }),
  link({
    id: '0e000000-0000-4000-8000-000000000002',
    a: 'sw1',
    adapterA: 0,
    portA: 1,
    b: 'pc1',
    adapterB: 0,
    portB: 0,
    style: { type: 'straight' },
  }),
];

const event = (
  id: number,
  type: EventEnvelope['type'],
  ts: string,
  payload: Record<string, unknown>,
): EventEnvelope => ({
  id,
  type,
  projectId: PROJECT_ID,
  userId: USER_ID,
  ts,
  payload,
});

export const events: EventEnvelope[] = [
  event(4121, 'node.created', '2026-11-11T08:41:02+00:00', {
    name: 'sw1',
    nodeType: 'ethernet_switch',
    computeName: 'eu-1',
  }),
  event(4122, 'link.status', '2026-11-11T08:41:19+00:00', {
    a: 'sw1',
    b: 'r1',
    status: 'active',
    linkType: 'ethernet',
  }),
  event(4123, 'node.status', '2026-11-11T09:05:44+00:00', {
    name: 'core1',
    from: 'stopped',
    status: 'error',
  }),
  event(4124, 'fault.applied', '2026-11-11T09:06:10+00:00', {
    node: 'core1',
    fault: 'Port in shutdown',
    adapter: 1,
    port: 3,
  }),
];

export const project: ProjectRow = {
  id: PROJECT_ID,
  name: 'ccna-lab',
  description: 'Switching and routing practice, one pod per student.',
  status: 'opened',
  locked: false,
  ownerId: USER_ID,
  ownerName: 'operator',
  poolId: null,
  variables: {
    mgmt_subnet: '10.99.12.0/24',
    ios_image: 'i86bi-linux-l3-adventerprisek9-15.5.2T.bin',
  },
  scene: { viewport: { x: 0, y: 0, zoom: 1 }, gridVisible: true },
  autoOpen: true,
  autoClose: false,
  autoStart: false,
  createdAt: CREATED,
  updatedAt: UPDATED,
  nodeCount: nodes.length,
  linkCount: links.length,
};

export const stats: ProjectStats = {
  nodeCount: nodes.length,
  linkCount: links.length,
  drawingCount: 3,
  nodesByStatus: { started: 2, stopped: 1, error: 1 },
  slots: [
    {
      computeId: COMPUTE_ID,
      slot: 12,
      netns: 'nl-ccna-lab-12',
      projectIp: '10.99.12.2',
      ubridgeSocket: '/run/netlabor/ubridge-12.sock',
    },
  ],
};

export const me: MeOutput = {
  id: USER_ID,
  username: 'operator',
  email: 'operator@netlabor.invalid',
  displayName: 'Network operator',
  isActive: true,
  createdAt: CREATED,
  roles: ['editor'],
  privileges: [
    'project.read',
    'node.read',
    'node.update',
    'node.control',
    'node.console',
    'link.read',
    'image.read',
    'template.read',
    'compute.read',
    'snapshot.read',
  ],
  projectGrants: [],
  preferences: {},
};

/** Canvas annotations: one keyed frame and its keyed label, as apply leaves them. */
export const drawings: DrawingRow[] = [
  {
    id: '0f100000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    type: 'rect',
    svg: null,
    text: null,
    filePath: null,
    x: 76,
    y: 34,
    width: 196,
    height: 138,
    rotation: 0,
    z: 1,
    layer: 'annotations',
    locked: false,
    style: {
      fill: 'color-mix(in oklab, var(--color-signal-info) 7%, transparent)',
      stroke: 'var(--color-signal-info)',
      strokeWidth: 1,
      dash: '6 4',
      opacity: 0.9,
      applyKey: 'pod-a-frame',
    },
  },
  {
    id: '0f100000-0000-4000-8000-000000000002',
    projectId: PROJECT_ID,
    type: 'text',
    svg: null,
    text: 'pod A · vlan 12',
    filePath: null,
    x: 84,
    y: 40,
    width: 160,
    height: 20,
    rotation: 0,
    z: 2,
    layer: 'annotations',
    locked: false,
    style: {
      stroke: 'var(--color-signal-info)',
      fontSize: 12,
      fontWeight: '600',
      applyKey: 'pod-a-label',
    },
  },
  {
    id: '0f100000-0000-4000-8000-000000000003',
    projectId: PROJECT_ID,
    type: 'note',
    svg: null,
    text: 'exam: do not move\n169.254.12.1/30',
    filePath: null,
    x: 300,
    y: 190,
    width: 168,
    height: 54,
    rotation: 0,
    z: 3,
    layer: 'annotations',
    locked: false,
    style: { stroke: 'var(--color-signal-warn)', fontSize: 11 },
  },
];

/**
 * The library images the image-coverage strip is computed from. Only the
 * Debian base is present, so the IOU template reports a missing image.
 */
export const images: ImageRow[] = [
  {
    id: '0b100000-0000-4000-8000-000000000001',
    name: 'debian-13-genericcloud-amd64',
    kind: 'qemu',
    filename: 'debian-13-genericcloud-amd64.qcow2',
    sha256: 'a3f1c9e27b4d8065a3f1c9e27b4d8065a3f1c9e27b4d8065a3f1c9e27b4d8065',
    sizeBytes: 402653184,
    metadata: {},
    createdBy: null,
    createdAt: CREATED,
    replicas: [
      {
        computeId: COMPUTE_ID,
        computeName: 'eu-1',
        state: 'present',
        path: '/var/lib/netlabor/images/debian-13',
        verifiedAt: UPDATED,
      },
    ],
  },
];

/** Restore points and the jobs that produced or consumed them. */
export const snapshots: SnapshotRow[] = [
  {
    id: '0f200000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    name: 'after-vlan-trunking',
    description: 'Before the spanning-tree exercise.',
    sha256: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    sizeBytes: 918273645,
    createdBy: USER_ID,
    createdAt: '2026-11-10T15:02:00+00:00',
  },
  {
    id: '0f200000-0000-4000-8000-000000000002',
    projectId: PROJECT_ID,
    name: 'day-one-baseline',
    description: null,
    sha256: 'd2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3',
    sizeBytes: 640223311,
    createdBy: USER_ID,
    createdAt: '2026-11-09T08:30:00+00:00',
  },
  {
    id: '0f200000-0000-4000-8000-000000000003',
    projectId: PROJECT_ID,
    name: 'pre-exam-freeze',
    description: 'Taken after locking the project.',
    sha256: 'e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4',
    sizeBytes: 1048576000,
    createdBy: USER_ID,
    createdAt: '2026-11-08T18:45:00+00:00',
  },
];

export const jobs: JobRow[] = [
  {
    id: '0f300000-0000-4000-8000-000000000001',
    kind: 'snapshot.create',
    state: 'completed',
    progress: 100,
    payload: { projectId: PROJECT_ID, name: 'after-vlan-trunking' },
    result: { snapshotId: snapshots[0]?.id, sizeBytes: snapshots[0]?.sizeBytes },
    error: null,
    createdAt: '2026-11-10T15:01:12+00:00',
    updatedAt: '2026-11-10T15:02:00+00:00',
  },
  {
    id: '0f300000-0000-4000-8000-000000000002',
    kind: 'snapshot.restore',
    state: 'running',
    progress: 62,
    payload: { projectId: PROJECT_ID, snapshotId: snapshots[1]?.id },
    result: null,
    error: null,
    createdAt: '2026-11-11T09:20:04+00:00',
    updatedAt: '2026-11-11T09:20:57+00:00',
  },
  {
    id: '0f300000-0000-4000-8000-000000000003',
    kind: 'project.export',
    state: 'failed',
    progress: 41,
    payload: { projectId: PROJECT_ID },
    result: null,
    error: 'AGENT_UNAVAILABLE: compute eu-1 is offline',
    createdAt: '2026-11-11T09:10:00+00:00',
    updatedAt: '2026-11-11T09:10:19+00:00',
  },
  {
    id: '0f300000-0000-4000-8000-000000000004',
    kind: 'projects.import',
    state: 'cancelled',
    progress: 12,
    payload: { name: 'imported-lab' },
    result: null,
    error: null,
    createdAt: '2026-11-10T21:00:00+00:00',
    updatedAt: '2026-11-10T21:00:31+00:00',
  },
];

/**
 * OS repository rows before any artifact is downloaded. The builder's real
 * disabled state is derived from `imageId === null`, so the dialog cannot
 * queue a build in the docs.
 */
export const osImages: OsImageRow[] = [
  {
    id: '0f400000-0000-4000-8000-000000000001',
    name: 'Debian 13 genericcloud',
    family: 'debian',
    release: 'trixie',
    arch: 'amd64',
    description: 'Debian 13 (trixie) cloud image.',
    sourceUrl:
      'https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2',
    filename: 'debian-13-genericcloud-amd64.qcow2',
    sha256: null,
    sizeBytes: null,
    status: 'available',
    error: null,
    imageId: null,
    createdAt: CREATED,
    updatedAt: UPDATED,
  },
  {
    id: '0f400000-0000-4000-8000-000000000002',
    name: 'Ubuntu 24.04 cloudimg',
    family: 'ubuntu',
    release: '24.04 LTS',
    arch: 'amd64',
    description: 'Ubuntu Noble cloud image.',
    sourceUrl: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    filename: 'noble-server-cloudimg-amd64.img',
    sha256: null,
    sizeBytes: null,
    status: 'downloading',
    error: null,
    imageId: null,
    createdAt: CREATED,
    updatedAt: UPDATED,
  },
];

export const computes: ComputeRow[] = [
  {
    id: COMPUTE_ID,
    name: 'eu-1',
    url: 'https://eu-1.netlabor.invalid',
    underlayIndex: 1,
    underlayHost: '10.99.0.11',
    status: 'online',
    version: '0.9.0',
    capabilities: null,
    lastSeenAt: UPDATED,
    createdAt: CREATED,
    updatedAt: UPDATED,
    pools: [],
  },
  {
    id: '0c000000-0000-4000-8000-0000000000a2',
    name: 'eu-2',
    url: 'https://eu-2.netlabor.invalid',
    underlayIndex: 2,
    underlayHost: '10.99.0.12',
    status: 'online',
    version: '0.9.0',
    capabilities: null,
    lastSeenAt: UPDATED,
    createdAt: CREATED,
    updatedAt: UPDATED,
    pools: [],
  },
];
