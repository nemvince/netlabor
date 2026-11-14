/**
 * Seeded device catalog. IDs are fixed so controller restarts update the same
 * built-in rows; user templates are never touched by the seed.
 */

import type { ImageKind, TemplateFault } from '@netlabor/contract';
import { iosFaults } from './fault-catalog.ts';

export interface CatalogRequiredImage {
  name: string;
  kind: ImageKind;
  filenamePattern: string;
  sha256?: string;
}

export interface CatalogTemplate {
  id: string;
  name: string;
  nodeType: string;
  category: string;
  symbol: string;
  defaultNameFormat: string;
  properties: Record<string, unknown>;
  requiredImages: CatalogRequiredImage[];
  faults: TemplateFault[];
}

const switchPorts = Array.from({ length: 8 }, (_value, index) => ({
  name: `Ethernet${index}`,
  portNumber: index,
  type: 'access' as const,
  vlan: 1,
}));

const hubPorts = Array.from({ length: 8 }, (_value, index) => ({
  name: `Ethernet${index}`,
  portNumber: index,
}));

export const catalogTemplates: CatalogTemplate[] = [
  {
    id: '0190c4a0-0000-7000-8000-000000000001',
    name: 'VPCS',
    nodeType: 'vpcs',
    category: 'End devices',
    symbol: 'pc',
    defaultNameFormat: 'pc-{index}',
    properties: {
      startupScript: null,
      consoleType: 'telnet',
      consoleAutoStart: true,
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000002',
    name: 'Ethernet switch',
    nodeType: 'ethernet_switch',
    category: 'Switches',
    symbol: 'switch',
    defaultNameFormat: 'switch-{index}',
    properties: {
      portsMapping: switchPorts,
      consoleType: 'none',
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000003',
    name: 'Ethernet hub',
    nodeType: 'ethernet_hub',
    category: 'Switches',
    symbol: 'hub',
    defaultNameFormat: 'hub-{index}',
    properties: {
      portsMapping: hubPorts,
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000004',
    name: 'Cloud',
    nodeType: 'cloud',
    category: 'Switches',
    symbol: 'cloud',
    defaultNameFormat: 'cloud-{index}',
    properties: {
      portsMapping: [],
      remoteConsoleHost: null,
      remoteConsolePort: null,
      remoteConsoleType: 'none',
      remoteConsoleHttpPath: null,
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000005',
    name: 'NAT',
    nodeType: 'nat',
    category: 'Switches',
    symbol: 'nat',
    defaultNameFormat: 'nat-{index}',
    properties: {
      portsMapping: [{ name: 'nat0', type: 'ethernet', interface: null }],
      consoleType: 'none',
      consoleAutoStart: false,
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000006',
    name: 'Linux VM',
    nodeType: 'qemu',
    category: 'End devices',
    symbol: 'server',
    defaultNameFormat: 'vm-{index}',
    properties: {
      qemuPath: null,
      platform: 'x86_64',
      ram: 256,
      cpus: 1,
      adapters: 1,
      adapterType: 'e1000',
      macAddress: null,
      consoleType: 'telnet',
      consoleAutoStart: true,
      bootPriority: 'c',
      disks: {},
      options: [],
      linkedClone: true,
      machineType: 'pc',
    },
    requiredImages: [{ name: 'Linux disk image', kind: 'qemu', filenamePattern: '*.qcow2' }],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000007',
    name: 'Docker container',
    nodeType: 'docker',
    category: 'Containers',
    symbol: 'docker',
    defaultNameFormat: 'docker-{index}',
    properties: {
      imageName: 'alpine:3.20',
      adapters: 1,
      consoleType: 'telnet',
      consoleAutoStart: true,
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000008',
    name: 'IOU L3 router',
    nodeType: 'iou',
    category: 'Routers',
    symbol: 'router',
    defaultNameFormat: 'r{index}',
    properties: {
      imageId: null,
      iourcSecretId: null,
      licenseCheck: true,
      ethernetAdapters: 2,
      serialAdapters: 2,
      ram: 256,
      nvram: 128,
      useDefaultIouValues: true,
      l1Keepalives: false,
      consoleType: 'telnet',
      consoleAutoStart: true,
    },
    requiredImages: [
      { name: 'IOU L3 image', kind: 'iou', filenamePattern: 'i86bi-linux-l3-*.bin' },
    ],
    faults: iosFaults,
  },
  {
    id: '0190c4a0-0000-7000-8000-000000000009',
    name: 'Cisco 7206VXR',
    nodeType: 'dynamips',
    category: 'Routers',
    symbol: 'router',
    defaultNameFormat: 'R{index}',
    properties: {
      platform: 'c7200',
      imageId: null,
      ram: 256,
      nvram: 128,
      mmap: true,
      idlemax: 1500,
      idlesleep: 30,
      autoDeleteDisks: false,
      npe: 'npe-400',
      midplane: 'vxr',
      sparsemem: false,
      consoleType: 'telnet',
      consoleAutoStart: true,
      auxConsole: false,
      slots: ['C7200-IO-FE'],
      wics: [],
    },
    requiredImages: [
      { name: 'Cisco c7200 IOS image', kind: 'dynamips', filenamePattern: 'c7200-*.bin' },
    ],
    faults: iosFaults,
  },
  {
    id: '0190c4a0-0000-7000-8000-00000000000a',
    name: 'ATM switch',
    nodeType: 'atm_switch',
    category: 'Switches',
    symbol: 'atm-switch',
    defaultNameFormat: 'atmsw-{index}',
    properties: {
      mappings: {},
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-00000000000b',
    name: 'Frame relay switch',
    nodeType: 'frame_relay_switch',
    category: 'Switches',
    symbol: 'frame-relay-switch',
    defaultNameFormat: 'frsw-{index}',
    properties: {
      mappings: {},
    },
    requiredImages: [],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-00000000000c',
    name: 'Debian 13 cloud',
    nodeType: 'qemu',
    category: 'End devices',
    symbol: 'server',
    defaultNameFormat: 'debian-{index}',
    properties: {
      platform: 'x86_64',
      ram: 1024,
      cpus: 1,
      adapters: 1,
      adapterType: 'virtio-net-pci',
      consoleType: 'telnet',
      consoleAutoStart: true,
      bootPriority: 'c',
      disks: {},
      options: [],
      linkedClone: true,
      machineType: 'q35',
      cloudInitEnabled: true,
      cloudInitVariant: 'server',
      osFamily: 'debian',
      cloudInitPassword: '',
      cloudInitHostname: '',
      cloudInitNetworkMode: 'dhcp',
      cloudInitIpAddress: '',
      cloudInitGateway: '',
      cloudInitDns: '',
      cloudInitSshKey: '',
      cloudInitAutoLogin: true,
    },
    requiredImages: [
      {
        name: 'Debian 13 genericcloud qcow2',
        kind: 'qemu',
        filenamePattern: 'debian-13-genericcloud-amd64.qcow2',
      },
    ],
    faults: [],
  },
  {
    id: '0190c4a0-0000-7000-8000-00000000000d',
    name: 'Debian 13 cloud desktop',
    nodeType: 'qemu',
    category: 'End devices',
    symbol: 'pc',
    defaultNameFormat: 'debian-gui-{index}',
    properties: {
      platform: 'x86_64',
      ram: 2048,
      cpus: 2,
      adapters: 1,
      adapterType: 'virtio-net-pci',
      consoleType: 'vnc',
      consoleAutoStart: false,
      bootPriority: 'c',
      disks: { hda: { sizeBytes: 32212254720 } },
      options: [],
      linkedClone: true,
      machineType: 'q35',
      cloudInitEnabled: true,
      cloudInitVariant: 'desktop',
      osFamily: 'debian',
      cloudInitPassword: '',
      cloudInitHostname: '',
      cloudInitNetworkMode: 'dhcp',
      cloudInitIpAddress: '',
      cloudInitGateway: '',
      cloudInitDns: '',
      cloudInitSshKey: '',
      cloudInitAutoLogin: true,
    },
    requiredImages: [
      {
        name: 'Debian 13 genericcloud qcow2',
        kind: 'qemu',
        filenamePattern: 'debian-13-genericcloud-amd64.qcow2',
      },
    ],
    faults: [],
  },
];
