import { Badge as BadgePrimitive } from '@netlabor/ui/components/badge';
import { cn } from '@netlabor/ui/lib/utils';
import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'up' | 'warn' | 'down' | 'info' | 'copper';

const TONE_COLOR: Record<BadgeTone, string> = {
  neutral: 'var(--muted-foreground)',
  up: 'var(--color-signal-up)',
  warn: 'var(--color-signal-warn)',
  down: 'var(--color-signal-down)',
  info: 'var(--color-signal-info)',
  copper: 'var(--primary)',
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
  const isSignal = tone === 'up' || tone === 'warn' || tone === 'down' || tone === 'info';
  return (
    <BadgePrimitive
      title={title}
      variant="outline"
      className={cn(
        'w-auto gap-1 rounded-[3px] px-1.5 py-px text-[11px] font-normal leading-[1.6]',
        tone === 'neutral' && 'border-border bg-muted/40 text-muted-foreground',
        tone === 'copper' && 'border-primary/40 bg-primary/10 text-primary',
        isSignal &&
          `border-[color-mix(in_oklab,${color}_40%,transparent)] bg-[color-mix(in_oklab,${color}_9%,transparent)]`,
      )}
      style={isSignal ? { color } : undefined}
    >
      <span
        aria-hidden
        className={cn(
          'inline-block size-[5px] rounded-full',
          tone === 'neutral' && 'bg-muted-foreground',
          tone === 'copper' && 'bg-primary',
        )}
        style={isSignal ? { background: color } : undefined}
      />
      {children}
    </BadgePrimitive>
  );
}
