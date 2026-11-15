import { type ComponentProps, type ReactNode, useId } from 'react';
import { Input as InputPrimitive } from '@netlabor/ui/components/input';
import { Label as LabelPrimitive } from '@netlabor/ui/components/label';
import { Textarea as TextareaPrimitive } from '@netlabor/ui/components/textarea';
import { cn } from '@netlabor/ui/lib/utils';

/** Labelled form field with a single line for errors, hints, and help. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <LabelPrimitive htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </LabelPrimitive>
      {children}
      {error ? (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const fieldClassName = 'h-7 rounded-sm border-input bg-background px-2.5 py-1 text-xs md:text-xs';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <InputPrimitive {...props} className={cn(fieldClassName, className)} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={cn(
        'h-7 w-full rounded-sm border border-input bg-background px-2.5 py-1 text-xs text-foreground',
        'hover:border-ring/70 focus:border-ring focus:ring-[3px] focus:ring-ring/50 focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <TextareaPrimitive
      {...props}
      className={cn(
        'min-h-[72px] rounded-sm border-input bg-background px-2.5 py-1 font-mono text-xs md:text-xs',
        className,
      )}
    />
  );
}

export function Checkbox({ className, style, ...props }: ComponentProps<'input'>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn('size-3.5 shrink-0 accent-primary', className)}
      style={style}
    />
  );
}

/** Checkbox plus wrapping label; used for role, group, and scope lists. */
export function CheckboxOption({
  label,
  description,
  id,
  ...props
}: ComponentProps<'input'> & { label: ReactNode; description?: string }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className="flex cursor-pointer items-start gap-2 text-xs leading-[1.5]"
    >
      <Checkbox id={inputId} {...props} />
      <span className="min-w-0">
        <span className="block text-foreground">{label}</span>
        {description ? <span className="block text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}
