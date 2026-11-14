import type { ApplianceBuildStatus, Desktop, OsFamily, OsImageRow } from '@netlabor/contract';
import type { BadgeTone } from '../../components/Badge.tsx';

export const DESKTOP_OPTIONS: { value: Desktop; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'server image, console only' },
  { value: 'xfce', label: 'XFCE', hint: 'light desktop' },
  { value: 'gnome', label: 'GNOME', hint: 'full desktop' },
  { value: 'kde', label: 'KDE Plasma', hint: 'full desktop' },
  { value: 'lxqt', label: 'LXQt', hint: 'minimal desktop' },
];

export function familyLabel(value: OsFamily): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function desktopLabel(value: Desktop): string {
  return DESKTOP_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export type OsArtifactState = 'ready' | 'downloading' | 'error' | 'missing';

/** Library artifact state of an OS repository entry. */
export function osArtifactState(row: OsImageRow): OsArtifactState {
  if (row.imageId !== null) return 'ready';
  if (row.status === 'downloading') return 'downloading';
  if (row.status === 'error') return 'error';
  return 'missing';
}

export const BUILD_STATUS_TONE: Record<ApplianceBuildStatus, BadgeTone> = {
  queued: 'neutral',
  running: 'warn',
  completed: 'up',
  failed: 'down',
  cancelled: 'neutral',
};

/** Suggested library image name from the selected OS entry and desktop. */
export function suggestedBuildName(os: OsImageRow | undefined, desktop: Desktop): string {
  if (!os) return '';
  const base = os.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${desktop}-lab`;
}
