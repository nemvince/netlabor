import { Search } from 'lucide-react';
import type { ComponentProps, CSSProperties } from 'react';
import { Input } from './Field.tsx';

/**
 * Search field with the icon inside the control. The left padding is inline
 * because `.nb-field` sets its own padding shorthand.
 */
export function SearchInput({
  label,
  wrapperStyle,
  wrapperClassName = '',
  ...props
}: Omit<ComponentProps<'input'>, 'style' | 'className'> & {
  label: string;
  wrapperStyle?: CSSProperties;
  wrapperClassName?: string;
}) {
  return (
    <div className={`relative ${wrapperClassName}`} style={wrapperStyle}>
      <Search
        size={13}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
        style={{ color: 'var(--color-ink-faint)' }}
      />
      <Input
        {...props}
        aria-label={props['aria-label'] ?? label}
        className="h-7 py-0 text-[12px]"
        style={{ paddingLeft: 28 }}
      />
    </div>
  );
}
