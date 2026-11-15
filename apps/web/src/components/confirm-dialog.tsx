import type { MouseEvent, ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@netlabor/ui/components/alert-dialog';
import { messageOf } from '../lib/errors.ts';
import { Notice } from './notice.tsx';

/**
 * Confirmation dialog for destructive actions. The caller owns the mutation;
 * this only renders pending and failure state around the confirm button.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  error?: unknown;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="flex max-h-[86vh] w-[calc(100vw-2rem)] max-w-[480px] flex-col gap-3 rounded-sm p-5">
        <AlertDialogTitle className="text-[15px] font-semibold tracking-tight">
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-[12px]">{description}</AlertDialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-3">
            {children}
            {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
          </div>
        </div>
        <AlertDialogFooter className="flex-row items-center justify-end gap-2 border-t border-border pt-3">
          <AlertDialogCancel className="h-8 rounded-sm border-border px-3 text-[13px]">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            className="h-8 rounded-sm px-3 text-[13px]"
            onClick={(event: MouseEvent<HTMLButtonElement>) => {
              // The confirm button must not close the dialog while the
              // mutation is pending or has failed; the caller decides when.
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
