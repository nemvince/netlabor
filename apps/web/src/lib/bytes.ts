/** Human-readable byte sizes for machine counters and progress. */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = unit === 0 ? 0 : digits;
  return `${value.toFixed(precision)} ${UNITS[unit]}`;
}

/** Shifts a fixed unit (used for disk totals where GiB is the readable scale). */
export function formatGiB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
