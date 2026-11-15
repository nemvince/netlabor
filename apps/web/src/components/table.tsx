import {
  Table as TablePrimitive,
  TableBody as TableBodyPrimitive,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@netlabor/ui/components/table';
import { cn } from '@netlabor/ui/lib/utils';
import type { ReactNode } from 'react';

/** Dense hairline table. Rows carry the rules, the panel carries the edge. */
export function Table({
  children,
  label,
  maxHeight,
  stickyHead = false,
}: {
  children: ReactNode;
  label: string;
  /** Caps the result height and scrolls inside the panel. */
  maxHeight?: number;
  stickyHead?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-[3px] border border-border bg-card">
      <div
        className={[
          maxHeight === undefined ? 'overflow-x-auto' : 'overflow-auto',
          stickyHead ? 'nb-scroll-table' : '',
        ].join(' ')}
        style={maxHeight === undefined ? undefined : { maxHeight }}
        {...(maxHeight === undefined
          ? {}
          : { role: 'region' as const, 'aria-label': `${label} results`, tabIndex: 0 })}
      >
        <TablePrimitive aria-label={label} className="w-full border-collapse text-[13px]">
          {children}
        </TablePrimitive>
      </div>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <TableHeader className="border-border">{children}</TableHeader>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <TableBodyPrimitive>{children}</TableBodyPrimitive>;
}

export function Th({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <TableHead
      scope="col"
      className={cn(
        'nb-rule-label h-auto px-3 py-2 font-normal',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
      )}
    >
      {children}
    </TableHead>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <TableRow className="align-top">{children}</TableRow>;
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
    <TableCell
      colSpan={colSpan}
      title={title}
      className={cn(
        'min-w-0 px-3 py-1.5 align-top whitespace-normal',
        mono && 'tabular text-[12px]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </TableCell>
  );
}
