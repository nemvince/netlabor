import type { ReactNode } from 'react';

/** Dense hairline table. Rows carry the rules, the panel carries the edge. */
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="overflow-hidden rounded-[3px] border"
      style={{ borderColor: 'var(--color-rule)', background: 'var(--color-panel)' }}
    >
      <div className="overflow-x-auto">
        <table aria-label={label} className="w-full border-collapse text-[13px]">
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b" style={{ borderColor: 'var(--color-rule)' }}>
        {children}
      </tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      scope="col"
      className="nb-rule-label whitespace-nowrap px-3 py-2 font-normal"
      style={{ textAlign: align }}
    >
      {children}
    </th>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return (
    <tr
      className="border-b align-top last:border-b-0 hover:bg-white/[0.015]"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  mono = false,
  align = 'left',
  colSpan,
  className,
  title,
}: {
  children: ReactNode;
  mono?: boolean;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  className?: string;
  title?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      title={title}
      className={`px-3 py-1.5 ${mono ? 'tabular text-[12px]' : ''} ${className ?? ''}`}
      style={{ textAlign: align }}
    >
      {children}
    </td>
  );
}
