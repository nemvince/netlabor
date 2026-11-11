/** Formatting for machine values rendered in tables and detail rows. */

const stampFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatStamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : stampFormatter.format(date);
}

export function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 8);
}

export function shorten(value: string, max = 56): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function formatUserAgent(value: string | null | undefined): string {
  if (!value) return 'unknown device';
  return shorten(value, 64);
}
