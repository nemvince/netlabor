import { XIcon  } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import {
  Dialog as UIDialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@netlabor/ui/components/dialog';

/**
 * Modal built on Base UI Dialog. Children own their layout so a form and its
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
    <UIDialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[86vh] w-[calc(100vw-2rem)] flex-col rounded-sm bg-card p-0 text-card-foreground ring-0"
        style={{ maxWidth: width, boxShadow: '0 18px 48px rgba(0, 0, 0, 0.45)' }}
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
          <DialogClose
            render={
              <button
                type="button"
                aria-label="Close dialog"
                className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              />
            }
          >
            <XIcon size={14} aria-hidden />
          </DialogClose>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>
      </DialogContent>
    </UIDialog>
  );
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
      {children}
    </div>
  );
}
