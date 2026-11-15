import { Alert as AlertPrimitive } from '@netlabor/ui/components/alert';
import { cn } from '@netlabor/ui/lib/utils';
import type { ReactNode } from 'react';

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
  const variant = tone === 'error' ? 'destructive' : 'default';
  return (
    <AlertPrimitive
      // AlertPrimitive hardcodes role="alert"; spread order lets this override it.
      role={tone === 'error' ? 'alert' : 'status'}
      variant={variant}
      className={cn(
        'rounded-[3px] border-border px-3 py-2 text-[12px] leading-[1.55]',
        `border-[color-mix(in_oklab,${color}_45%,transparent)] bg-[color-mix(in_oklab,${color}_8%,transparent)]`,
        tone === 'info' ? 'text-foreground' : 'text-destructive',
      )}
      style={tone === 'info' ? undefined : { color }}
    >
      {children}
    </AlertPrimitive>
  );
}
