import { type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Copper instrument plate used by every settings card and disclosure. */
export function SettingsIcon({ icon: Icon }: { icon: Icon }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-[2px] border"
      style={{
        borderColor: 'color-mix(in oklab, var(--color-copper) 35%, transparent)',
        background: 'color-mix(in oklab, var(--color-copper) 8%, transparent)',
        color: 'var(--color-copper)',
      }}
    >
      <Icon size={14} strokeWidth={1.75} />
    </span>
  );
}

/**
 * Explained settings card: icon, plain-language purpose, and its own controls.
 * Cards are the unit of grouping so a reader never has to infer what a field
 * belongs to from page order alone.
 */
export function SettingsCard({
  icon,
  title,
  description,
  actions,
  children,
}: {
  icon: Icon;
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="nb-panel">
      <header
        className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--color-rule)' }}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <SettingsIcon icon={icon} />
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold">{title}</h2>
            <p className="mt-0.5 max-w-2xl text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              {description}
            </p>
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** Small bordered container for rule rows inside a card body. */
export function CardRows({ children }: { children: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[2px] border"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      {children}
    </div>
  );
}
