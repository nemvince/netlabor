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
  {
    id: '0b000000-0000-4000-8000-000000000003',
    name: 'rocky-9-genericcloud-amd64',
    family: 'rocky',
    release: '9 (latest)',
    arch: 'amd64',
    description: 'Rocky Linux 9 Generic Cloud image with cloud-init. Server builds (dnf).',
    sourceUrl:
      'https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2',
    filename: 'Rocky-9-GenericCloud-Base.latest.x86_64.qcow2',
  },
  {
    id: '0b000000-0000-4000-8000-000000000004',
    name: 'alpine-3.24-cloudinit-amd64',
    family: 'alpine',
    release: '3.24.2',
    arch: 'amd64',
    description: 'Alpine Linux cloud image with cloud-init. Server builds (apk, OpenRC).',
    sourceUrl:
      'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/alpine-3.24.2-x86_64-cloudinit-r2.qcow2',
    filename: 'alpine-3.24.2-x86_64-cloudinit-r2.qcow2',
  },
];

export interface DesktopRecipe {
  /** Packages per family, with the desktop's browser and file manager included. */
  packages: Partial<Record<OsFamily, string[]>>;
  /** Display manager service per family (a systemd unit or an OpenRC service). */
  displayManager: Partial<Record<OsFamily, string>>;
}

/**
 * Desktop environments per distro family. Rocky has no KDE or LXQt packages, so
 * those two combinations are refused instead of half-installed.
 * Ubuntu's browser is epiphany: its `firefox` package is a snap, which needs a
 * working snapd inside the build VM.
 */
export const desktopRecipes: Record<Exclude<Desktop, 'none'>, DesktopRecipe> = {
  xfce: {
    packages: {
      debian: [
        'xfce4',
        'xfce4-terminal',
        'thunar',
        'mousepad',
        'ristretto',
        'firefox-esr',
        'lightdm',
        'lightdm-gtk-greeter',
        'xorg',
        'xserver-xorg-video-vesa',
      ],
      ubuntu: [
        'xfce4',
        'xfce4-terminal',
        'thunar',
        'mousepad',
        'ristretto',
        'epiphany-browser',
        'lightdm',
        'lightdm-gtk-greeter',
        'xorg',
        'xserver-xorg-video-vesa',
      ],
      rocky: [
        'epel-release',
        'xfce4-session',
        'xfwm4',
        'xfce4-panel',
        'xfce4-terminal',
        'mousepad',
        'nautilus',
        'eog',
        'firefox',
        'lightdm',
        'lightdm-gtk',
        'xorg-x11-server-Xorg',
      ],
      alpine: [
        'xfce4',
        'xfce4-terminal',
        'thunar',
        'mousepad',
        'ristretto',
        'firefox',
        'lightdm',
        'lightdm-gtk-greeter',
        'xorg-server',
        'xf86-video-vesa',
      ],
    },
    displayManager: {
      debian: 'lightdm',
      ubuntu: 'lightdm',
      rocky: 'lightdm',
      alpine: 'lightdm',
    },
  },
  gnome: {
    packages: {
      debian: [
        'gnome-core',
        'gnome-terminal',
        'nautilus',
        'gnome-text-editor',
        'eog',
        'firefox-esr',
        'gdm3',
        'xorg',
      ],
      ubuntu: [
        'gnome-core',
        'gnome-terminal',
        'nautilus',
        'gnome-text-editor',
        'eog',
        'epiphany-browser',
        'gdm3',
        'xorg',
      ],
      rocky: [
        'gnome-shell',
        'gnome-session',
        'gnome-terminal',
        'nautilus',
        'firefox',
        'gdm',
        'xorg-x11-server-Xorg',
      ],
      alpine: [
        'gnome-shell',
        'gnome-session',
        'gnome-terminal',
        'nautilus',
        'firefox',
        'gdm',
        'xorg-server',
        'xf86-video-vesa',
      ],
    },
    displayManager: { debian: 'gdm3', ubuntu: 'gdm3', rocky: 'gdm', alpine: 'gdm' },
  },
  kde: {
    packages: {
      debian: [
        'kde-plasma-desktop',
        'konsole',
        'dolphin',
        'kate',
        'gwenview',
        'firefox-esr',
        'sddm',
        'xorg',
      ],
      ubuntu: [
        'kde-plasma-desktop',
        'konsole',
        'dolphin',
        'kate',
        'gwenview',
        'epiphany-browser',
        'sddm',
        'xorg',
      ],
      alpine: [
        'plasma-desktop',
        'konsole',
        'dolphin',
        'kate',
        'gwenview',
        'firefox',
        'sddm',
        'xorg-server',
        'xf86-video-vesa',
      ],
    },
    displayManager: { debian: 'sddm', ubuntu: 'sddm', alpine: 'sddm' },
  },
  lxqt: {
    packages: {
      debian: [
        'lxqt',
        'qterminal',
        'pcmanfm-qt',
        'featherpad',
        'lximage-qt',
        'firefox-esr',
        'sddm',
        'xorg',
      ],
      ubuntu: [
        'lxqt',
        'qterminal',
        'pcmanfm-qt',
        'featherpad',
        'lximage-qt',
        'epiphany-browser',
        'sddm',
        'xorg',
      ],
      alpine: [
        'lxqt',
        'qterminal',
        'pcmanfm-qt',
        'firefox',
        'sddm',
        'xorg-server',
        'xf86-video-vesa',
      ],
    },
    displayManager: { debian: 'sddm', ubuntu: 'sddm', alpine: 'sddm' },
  },
};

/** Whether a base-image family can install the desktop. */
export function desktopAvailable(desktop: Desktop, family: OsFamily): boolean {
  return desktop === 'none' || (desktopRecipes[desktop].packages[family]?.length ?? 0) > 0;
}

/** Default cloud-init login on each family's cloud image. */
export const cloudInitDefaultUser: Record<OsFamily, string> = {
  debian: 'debian',
  ubuntu: 'ubuntu',
  rocky: 'rocky',
  alpine: 'alpine',
};
