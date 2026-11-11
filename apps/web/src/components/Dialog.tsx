import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

/**
 * Modal built on Radix Dialog. Children own their layout so a form and its
 * footer stay one element; the body scrolls, the header stays put.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  width = 560,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(6, 8, 7, 0.64)' }}
        />
        <RadixDialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[3px] border"
          style={{
            maxWidth: width,
            background: 'var(--color-panel)',
            borderColor: 'var(--color-rule-strong)',
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)',
          }}
        >
          <header
            className="flex items-start justify-between gap-4 border-b px-5 py-3.5"
            style={{ borderColor: 'var(--color-rule)' }}
          >
            <div className="min-w-0">
              <RadixDialog.Title className="text-[15px] font-semibold tracking-tight">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description
                  className="mt-1 text-[12px]"
                  style={{ color: 'var(--color-ink-dim)' }}
                >
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="flex size-7 shrink-0 items-center justify-center rounded-[3px] border"
                style={{ borderColor: 'var(--color-rule)', color: 'var(--color-ink-dim)' }}
              >
                <X size={14} aria-hidden />
              </button>
            </RadixDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {children}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-4 flex items-center justify-end gap-2 border-t pt-3"
      style={{ borderColor: 'var(--color-rule)' }}
    >
      {children}
    </div>
  );
}
