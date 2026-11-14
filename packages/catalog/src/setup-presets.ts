/**
 * First-run setup presets: curated appliance bundles the setup wizard offers.
 * Each maps to a seeded OS-repository family, a desktop, and entries of the
 * preinstalled-software catalog; the wizard lets the user trim the software.
 */

import type { Desktop, OsFamily } from '@netlabor/contract';

export interface SetupPreset {
  id: string;
  name: string;
  description: string;
  /** Which seeded OS-repository entry the build is based on. */
  family: OsFamily;
  desktop: Desktop;
  /** Software entry ids from the preinstalled-software catalog. */
  software: string[];
}

export const setupPresets: SetupPreset[] = [
  {
    id: 'desktop-lab',
    name: 'Desktop lab station',
    description:
      'Debian with an XFCE desktop, SSH, and everyday tools — a general-purpose GUI node.',
    family: 'debian',
    desktop: 'xfce',
    software: ['ssh-server', 'git', 'http-tools', 'sysmonitor', 'editors'],
  },
  {
    id: 'server-roles',
    name: 'Server roles box',
    description: 'Headless Debian with SSH, nginx, PostgreSQL, BIND9, and Docker preinstalled.',
    family: 'debian',
    desktop: 'none',
    software: ['ssh-server', 'web-nginx', 'db-postgres', 'dns-bind9', 'docker'],
  },
  {
    id: 'ubuntu-workstation',
    name: 'Ubuntu workstation',
    description: 'Ubuntu 24.04 with GNOME, Python 3, the build toolchain, and git.',
    family: 'ubuntu',
    desktop: 'gnome',
    software: ['python', 'toolchain', 'git', 'netdiag'],
  },
  {
    id: 'network-ops',
    name: 'Network ops toolkit',
    description: 'Headless Debian with capture, throughput, firewall, VPN, and metrics tooling.',
    family: 'debian',
    desktop: 'none',
    software: ['netdiag', 'monitoring-node-exporter', 'vpn-wireguard', 'firewall', 'ssh-server'],
  },
];
