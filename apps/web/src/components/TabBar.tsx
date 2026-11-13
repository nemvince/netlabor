import type { LucideIcon } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

/** Underline tab strip shared by the library and the network tools. */
export function TabBar<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: readonly TabItem<T>[];
  onChange: (id: T) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next = index;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    buttons.current[next]?.focus();
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b"
      style={{ borderColor: 'var(--color-rule)' }}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className="flex items-center gap-1 px-3 py-1.5 text-[12px]"
            style={{
              color: active ? 'var(--color-ink)' : 'var(--color-ink-dim)',
              borderBottom: active ? '2px solid var(--color-copper)' : '2px solid transparent',
            }}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKey(event, index)}
          >
            {Icon ? <Icon size={13} aria-hidden /> : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
