import { type ComponentProps, type ReactNode, useId } from 'react';

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
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="text-[12px] font-medium"
          style={{ color: 'var(--color-ink-dim)' }}
        >
          {label}
        </label>
      ) : (
        <span className="text-[12px] font-medium" style={{ color: 'var(--color-ink-dim)' }}>
          {label}
        </span>
      )}
      {children}
      {error ? (
        <p className="text-[11px]" style={{ color: 'var(--color-signal-down)' }} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={`nb-field ${className ?? ''}`} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={`nb-field ${className ?? ''}`}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={`nb-field ${className ?? ''}`} />;
}

export function Checkbox({ className, style, ...props }: ComponentProps<'input'>) {
  return (
    <input
      {...props}
      type="checkbox"
      className={`size-3.5 shrink-0 ${className ?? ''}`}
      style={{ accentColor: 'var(--color-copper)', ...style }}
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
      className="flex cursor-pointer items-start gap-2 text-[12px] leading-[1.5]"
    >
      <Checkbox id={inputId} {...props} />
      <span className="min-w-0">
        <span className="block" style={{ color: 'var(--color-ink)' }}>
          {label}
        </span>
        {description ? (
          <span className="block" style={{ color: 'var(--color-ink-faint)' }}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
