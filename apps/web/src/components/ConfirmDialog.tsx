import type { ReactNode } from 'react';
import { messageOf } from '../lib/errors.ts';
import { Dialog, DialogFooter } from './Dialog.tsx';
import { Notice } from './Notice.tsx';

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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      width={480}
    >
      <div className="flex flex-col gap-3">
        {children}
        {error ? <Notice tone="error">{messageOf(error)}</Notice> : null}
        <DialogFooter>
          <button type="button" className="nb-button" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="nb-button"
            data-variant="danger"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </DialogFooter>
      </div>
    </Dialog>
  );
}
