import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import {
  Dialog as ShadcnDialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@netlabor/ui/components/dialog';

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
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-40 bg-foreground/60" />
        <RadixDialog.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-sm border border-input bg-card shadow-[0_18px_48px_rgba(0,0,0,0.45)] outline-none"
          style={{ maxWidth: width }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <DialogTitle className="text-[15px] font-semibold tracking-tight">
                {title}
              </DialogTitle>
              {description ? (
                <DialogDescription className="mt-1 text-[12px]">
                  {description}
                </DialogDescription>
              ) : (
                <DialogDescription className="sr-only">{title}</DialogDescription>
              )}
            </div>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <X size={14} aria-hidden />
              </button>
            </DialogClose>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            {children}
          </div>
        </RadixDialog.Content>
      </DialogPortal>
    </ShadcnDialog>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
      {children}
    </div>
  );
}
