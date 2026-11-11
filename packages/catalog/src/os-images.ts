/**
 * Seeded OS image repository. Fixed IDs so restarts refresh the upstream URL of
 * the same entry; downloads and user-added rows are never touched.
 */

import type { Desktop, OsArch, OsFamily } from '@netlabor/contract';

export interface CatalogOsImage {
  id: string;
  name: string;
  family: OsFamily;
  release: string;
  arch: OsArch;
  description: string;
  sourceUrl: string;
  filename: string;
}

export const catalogOsImages: CatalogOsImage[] = [
  {
    id: '0b000000-0000-4000-8000-000000000001',
    name: 'debian-13-genericcloud-amd64',
    family: 'debian',
    release: '13 (trixie)',
    arch: 'amd64',
    description: 'Debian 13 cloud image with cloud-init. Base for Debian desktops and servers.',
    sourceUrl:
      'https://cloud.debian.org/images/cloud/trixie/latest/debian-13-genericcloud-amd64.qcow2',
    filename: 'debian-13-genericcloud-amd64.qcow2',
  },
  {
    id: '0b000000-0000-4000-8000-000000000002',
    name: 'ubuntu-24.04-cloudimg-amd64',
    family: 'ubuntu',
    release: '24.04 LTS (noble)',
    arch: 'amd64',
    description: 'Ubuntu 24.04 LTS cloud image with cloud-init. Base for Ubuntu labs.',
    sourceUrl: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    filename: 'noble-server-cloudimg-amd64.img',
  },
];

export interface DesktopRecipe {
  /** Packages installed for the desktop environment. */
  packages: string[];
  /** systemd target and display manager to enable. */
  displayManager: string | null;
}

/** apt package sets per desktop environment, valid for Debian and Ubuntu. */
export const desktopRecipes: Record<Exclude<Desktop, 'none'>, DesktopRecipe> = {
  xfce: {
    packages: ['xfce4', 'xfce4-terminal', 'lightdm', 'lightdm-gtk-greeter'],
    displayManager: 'lightdm',
  },
  gnome: {
    packages: ['gnome-core', 'gnome-terminal', 'gdm3'],
    displayManager: 'gdm3',
  },
  kde: {
    packages: ['kde-plasma-desktop', 'sddm'],
    displayManager: 'sddm',
  },
  lxqt: {
    packages: ['lxqt', 'sddm'],
    displayManager: 'sddm',
  },
};
