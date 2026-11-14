/**
 * Curated appliance catalog for the in-app marketplace. Entries mirror
 * gns3-registry appliances (`.gns3a`) that publish a direct download URL, so
 * installing one is a plain image download plus a template row.
 *
 * Keep one x86_64 image per entry; the registry also ships arm64 and older
 * builds, which the user can still adopt by hand.
 */

export type MarketplaceNodeType = 'qemu' | 'docker';

export interface MarketplaceImage {
  filename: string;
  version: string;
  sizeBytes: number;
  url: string;
}

export interface MarketplaceQemu {
  ram: number;
  cpus: number;
  adapters: number;
  adapterType: 'e1000' | 'virtio-net-pci' | 'rtl8139';
  hdaInterface: 'ide' | 'virtio' | 'sata';
  /** Disk image format of the base image; raw for appliances shipped as .img. */
  format?: 'qcow2' | 'raw';
  consoleType: 'telnet' | 'vnc';
  machineType?: string;
  cpuModel?: string;
  options: string[];
}

export interface MarketplaceDocker {
  image: string;
  adapters: number;
  consoleType: 'telnet' | 'vnc';
  startCommand: string | null;
  environment: string;
}

export interface MarketplaceAppliance {
  /** GNS3 appliance id. */
  id: string;
  name: string;
  vendor: string;
  category: string;
  description: string;
  status: 'stable' | 'experimental';
  nodeType: MarketplaceNodeType;
  symbol: string;
  arch: string;
  image: MarketplaceImage | null;
  qemu?: MarketplaceQemu;
  docker?: MarketplaceDocker;
  /** Upstream registry file for reference. */
  registryFile: string;
}

const SF = 'https://downloads.sourceforge.net/project/gns-3/Qemu%20Appliances';

export const marketplaceAppliances: MarketplaceAppliance[] = [
  {
    id: 'alpine-linux-virt',
    name: 'Alpine Linux Virt',
    vendor: 'Alpine Linux Development Team',
    category: 'End devices',
    description:
      'Lightweight musl/busybox Linux for QEMU. Default packages only — no SSH server installed.',
    status: 'stable',
    nodeType: 'qemu',
    symbol: 'pc',
    arch: 'x86_64',
    registryFile: 'alpine-linux-virt.gns3a',
    image: {
      filename: 'alpine-virt-3.24.3-x86_64.qcow2',
      version: '3.24.3',
      sizeBytes: 68_459_520,
      url: `${SF}/alpine/alpine-virt-3.24.3-x86_64.qcow2/download`,
    },
    qemu: {
      ram: 256,
      cpus: 1,
      adapters: 1,
      adapterType: 'e1000',
      hdaInterface: 'virtio',
      consoleType: 'telnet',
      options: [],
    },
  },
  {
    id: 'tinycore-linux',
    name: 'Tiny Core Linux',
    vendor: 'Team Tiny Core',
    category: 'End devices',
    description: 'A graphical Linux desktop in a few MiB, useful as a fast GUI endpoint.',
    status: 'stable',
    nodeType: 'qemu',
    symbol: 'pc',
    arch: 'x86_64',
    registryFile: 'tinycore-linux.gns3a',
    image: {
      filename: 'linux-tinycore-17.0.qcow2',
      version: '17.0',
      sizeBytes: 35_061_760,
      url: `${SF}/linux-tinycore-17.0.qcow2`,
    },
    qemu: {
      ram: 128,
      cpus: 1,
      adapters: 1,
      adapterType: 'e1000',
      hdaInterface: 'virtio',
      consoleType: 'vnc',
      options: ['-vga', 'std', '-usbdevice', 'tablet'],
    },
  },
  {
    id: 'microcore-linux',
    name: 'Micro Core Linux',
    vendor: 'Team Tiny Core',
    category: 'End devices',
    description: 'Tiny Core without a desktop: a complete Linux system needing very little RAM.',
    status: 'stable',
    nodeType: 'qemu',
    symbol: 'pc',
    arch: 'x86_64',
    registryFile: 'microcore-linux.gns3a',
    image: {
      filename: 'linux-microcore-6.4.img',
      version: '6.4',
      sizeBytes: 16_580_608,
      url: `${SF}/linux-microcore-6.4.img`,
    },
    qemu: {
      ram: 64,
      cpus: 1,
      adapters: 1,
      adapterType: 'e1000',
      hdaInterface: 'ide',
      consoleType: 'telnet',
      options: [],
    },
  },
  {
    id: 'frr',
    name: 'FRR',
    vendor: 'FRRouting Project',
    category: 'Routers',
    description:
      'FRRouting suite with BGP, OSPF, IS-IS, LDP, PIM, and RIP on an Alpine guest image.',
    status: 'stable',
    nodeType: 'qemu',
    symbol: 'router',
    arch: 'x86_64',
    registryFile: 'frr.gns3a',
    image: {
      filename: 'alpine-virt-3.24.3-frr-10.6.1-x86_64.qcow2',
      version: '10.6.1',
      sizeBytes: 80_178_176,
      url: `${SF}/alpine/alpine-virt-3.24.3-frr-10.6.1-x86_64.qcow2`,
    },
    qemu: {
      ram: 256,
      cpus: 1,
      adapters: 4,
      adapterType: 'e1000',
      hdaInterface: 'virtio',
      consoleType: 'telnet',
      options: [],
    },
  },
  {
    id: 'bird',
    name: 'BIRD',
    vendor: 'CZ.NIC Labs',
    category: 'Routers',
    description:
      'BIRD dynamic IP routing daemon on Debian, aimed at BGP and OSPF labs on non-Cisco routers.',
    status: 'stable',
    nodeType: 'qemu',
    symbol: 'router',
    arch: 'x86_64',
    registryFile: 'bird.gns3a',
    image: {
      filename: 'debian-13.7-bird2-2.17.5-amd64.qcow2',
      version: '2.17.5',
      sizeBytes: 276_758_528,
      url: `${SF}/debian/debian-13.7-bird2-2.17.5-amd64.qcow2`,
    },
    qemu: {
      ram: 512,
      cpus: 1,
      adapters: 4,
      adapterType: 'virtio-net-pci',
      hdaInterface: 'virtio',
      consoleType: 'telnet',
      options: [],
    },
  },
  {
    id: 'opnsense',
    name: 'OPNsense',
    vendor: 'Deciso B.V.',
    category: 'Firewalls',
    description:
      'Open source FreeBSD based firewall and routing platform. Console defaults: root / opnsense, first IP 192.168.1.1.',
    status: 'stable',
    nodeType: 'qemu',
    symbol: 'firewall',
    arch: 'x86_64',
    registryFile: 'opnsense.gns3a',
    image: {
      filename: 'OPNsense-25.7-nano-amd64.img',
      version: '25.7',
      sizeBytes: 3_221_225_472,
      url: 'https://opnsense.c0urier.net/releases/25.7/OPNsense-25.7-nano-amd64.img',
    },
    qemu: {
      ram: 1024,
      cpus: 1,
      adapters: 4,
      adapterType: 'virtio-net-pci',
      hdaInterface: 'virtio',
      format: 'raw',
      consoleType: 'telnet',
      options: [],
    },
  },
  {
    id: 'alpine-docker',
    name: 'Alpine Linux (Docker)',
    vendor: 'Alpine Linux Development Team',
    category: 'End devices',
    description: 'Minimal Alpine container; the image pulls on the compute when the node starts.',
    status: 'stable',
    nodeType: 'docker',
    symbol: 'pc',
    arch: 'x86_64',
    registryFile: 'alpine-docker.gns3a',
    image: null,
    docker: {
      image: 'alpine:latest',
      adapters: 1,
      consoleType: 'telnet',
      startCommand: null,
      environment: '',
    },
  },
  {
    id: 'frr-docker-lite',
    name: 'FRR Docker (lite)',
    vendor: 'FRRouting Project',
    category: 'Routers',
    description: 'FRR container running only zebra with OSPFv2/v3 — the lowest-RAM FRR option.',
    status: 'experimental',
    nodeType: 'docker',
    symbol: 'router',
    arch: 'x86_64',
    registryFile: 'frr-docker-lite.gns3a',
    image: null,
    docker: {
      image: 'gns3/frr:latest',
      adapters: 8,
      consoleType: 'telnet',
      startCommand: '/usr/lib/frr/docker-start',
      environment: 'FRR_PROFILE=lite\nTERM=xterm',
    },
  },
];
