import type { ComponentProps } from 'react';
import { Input } from './field.tsx';

/** Numeric field with its unit inside the control instead of floating beside it. */
export function UnitInput({
  unit,
  ...props
}: Omit<ComponentProps<'input'>, 'style'> & { unit: string }) {
  return (
    <div className="relative">
      <Input {...props} className="pr-[72px]" />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground"
      >
        {unit}
      </span>
    </div>
  );
}
