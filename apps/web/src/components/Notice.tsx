import type { ReactNode } from 'react';
import { messageOf } from '../lib/errors.ts';

export type NoticeTone = 'info' | 'success' | 'warn' | 'error';

const TONE_COLOR: Record<NoticeTone, string> = {
  info: 'var(--color-signal-info)',
  success: 'var(--color-signal-up)',
  warn: 'var(--color-signal-warn)',
  error: 'var(--color-signal-down)',
};

/** Inline message strip. Errors say what happened; they never apologise. */
export function Notice({ tone = 'info', children }: { tone?: NoticeTone; children: ReactNode }) {
  const color = TONE_COLOR[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className="rounded-[3px] border px-3 py-2 text-[12px] leading-[1.55]"
      style={{
        borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
        background: `color-mix(in oklab, ${color} 8%, transparent)`,
        color: tone === 'info' ? 'var(--color-ink)' : color,
      }}
    >
      {children}
    </div>
  );
}

export function ErrorNotice({ error, prefix }: { error: unknown; prefix?: string }) {
  return (
    <Notice tone="error">{prefix ? `${prefix} ${messageOf(error)}` : messageOf(error)}</Notice>
  );
}
