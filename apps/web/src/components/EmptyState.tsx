import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Empty state: says what is missing and offers the action that fills it. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-[3px] border border-dashed px-6 py-12 text-center"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      {Icon ? (
        <Icon size={22} strokeWidth={1.5} aria-hidden style={{ color: 'var(--color-ink-faint)' }} />
      ) : null}
      <p className="mt-2 text-[14px] font-medium">{title}</p>
      <p className="mt-1 max-w-md text-[12px]" style={{ color: 'var(--color-ink-dim)' }}>
        {description}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
