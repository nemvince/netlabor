import { CircleNotchIcon } from '@phosphor-icons/react';
import { type ReactNode, useEffect } from 'react';

/** Page frame: one max width, dense vertical rhythm, hairline header rule. */
export function Page({ children, wide = true }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto px-5 py-5 ${wide ? 'max-w-[1500px]' : 'max-w-5xl'}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Netlabor`;
  }, [title]);

  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-[12px] text-foreground/80">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description ? <p className="text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground">
      <CircleNotchIcon size={14} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function RuleRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-2 last:border-b-0">
      <span className="nb-rule-label pt-0.5">{label}</span>
      <span className="min-w-0 text-right text-[13px]">{children}</span>
    </div>
  );
}
