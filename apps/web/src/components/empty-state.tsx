import { type Icon  } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Empty state: says what is missing and offers the action that fills it. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: Icon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[3px] border border-dashed border-border px-6 py-12 text-center">
      {Icon ? (
        <Icon size={22} strokeWidth={1.5} aria-hidden className="text-muted-foreground" />
      ) : null}
      <p className="mt-2 text-[14px] font-medium">{title}</p>
      <p className="mt-1 max-w-md text-[12px] text-foreground/80">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
