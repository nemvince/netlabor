/** Controller version string for display. */

/**
 * A built controller reports the release tag or, for nightly builds, the short
 * commit. Source runs report `development`.
 */
export function versionLabel(version: string | undefined): string {
  if (!version) return '—';
  return version === 'development' ? 'Development' : version;
}
