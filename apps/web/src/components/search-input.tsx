import { MagnifyingGlassIcon  } from '@phosphor-icons/react';
import type { ComponentProps, CSSProperties } from 'react';
import { Input } from './field.tsx';

/**
 * MagnifyingGlassIcon field with the icon inside the control. The left padding is a
 * utility class on top of the shared field padding.
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
      <MagnifyingGlassIcon
        size={13}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        {...props}
        aria-label={props['aria-label'] ?? label}
        className="h-7 py-0 pl-7 text-xs"
      />
    </div>
  );
}
