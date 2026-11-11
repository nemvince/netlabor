import { ConfirmDialog } from '@web/components/ConfirmDialog.tsx';
import { Dialog, DialogFooter } from '@web/components/Dialog.tsx';
import { Field, Input } from '@web/components/Field.tsx';
import { Notice } from '@web/components/Notice.tsx';
import { useState } from 'react';

export default function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <>
      <div className="docs-stack">
        <button type="button" className="nb-button" data-variant="primary" onClick={() => setOpen(true)}>
          New link
        </button>
        <button type="button" className="nb-button" data-variant="danger" onClick={() => setConfirmOpen(true)}>
          Delete node
        </button>
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New link"
        description="Choose the endpoints and the link type. Ports are allocated automatically."
      >
        <div className="flex flex-col gap-3">
          <Field label="Endpoint A" htmlFor="demo-endpoint-a" hint="Exact port names come from the node's port list.">
            <Input id="demo-endpoint-a" defaultValue="sw1 · Ethernet0" />
          </Field>
          <Field label="Endpoint B" htmlFor="demo-endpoint-b">
            <Input id="demo-endpoint-b" defaultValue="sw2 · Ethernet0" />
          </Field>
          <Notice tone="info">Both endpoints must be started before the link becomes active.</Notice>
          <DialogFooter>
            <button type="button" className="nb-button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="nb-button" data-variant="primary" onClick={() => setOpen(false)}>
              Create link
            </button>
          </DialogFooter>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete node"
        description="sw2 and its links are removed. Node files on the compute are deleted too."
        confirmLabel="Delete node"
        pending={pending}
        onConfirm={() => {
          setPending(true);
          window.setTimeout(() => {
            setPending(false);
            setConfirmOpen(false);
          }, 800);
        }}
      />
    </>
  );
}
