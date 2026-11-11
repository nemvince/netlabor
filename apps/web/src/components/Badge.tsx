import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'up' | 'warn' | 'down' | 'info' | 'copper';

const TONE_COLOR: Record<BadgeTone, string> = {
  neutral: 'var(--color-ink-faint)',
  up: 'var(--color-signal-up)',
  warn: 'var(--color-signal-warn)',
  down: 'var(--color-signal-down)',
  info: 'var(--color-signal-info)',
  copper: 'var(--color-copper)',
};

/** Signal badge: a dot plus sentence-case label, never colour as the only cue. */
export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
}) {
  const color = TONE_COLOR[tone];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-px text-[11px] leading-[1.6]"
      style={{
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 9%, transparent)`,
        color,
      }}
    >
      <span
        aria-hidden
        className="inline-block size-[5px] rounded-full"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}
