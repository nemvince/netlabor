import { ConfirmDialog } from '@web/components/confirm-dialog.tsx';
import { Dialog, DialogFooter } from '@web/components/dialog.tsx';
import { Field, Input } from '@web/components/field.tsx';
import { Notice } from '@web/components/notice.tsx';
import { useState } from 'react';
import { Button } from '@netlabor/ui/components/button';

export default function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <>
      <div className="docs-stack">
        <Button type="button" onClick={() => setOpen(true)} variant="default" size="sm">
          New link
        </Button>
        <Button type="button" onClick={() => setConfirmOpen(true)} variant="destructive" size="sm">
          Delete node
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New link"
        description="Choose the endpoints and the link type. Ports are allocated automatically."
      >
        <div className="flex flex-col gap-3">
          <Field
            label="Endpoint A"
            htmlFor="demo-endpoint-a"
            hint="Exact port names come from the node's port list."
          >
            <Input id="demo-endpoint-a" defaultValue="sw1 · Ethernet0" />
          </Field>
          <Field label="Endpoint B" htmlFor="demo-endpoint-b">
            <Input id="demo-endpoint-b" defaultValue="sw2 · Ethernet0" />
          </Field>
          <Notice tone="info">
            Both endpoints must be started before the link becomes active.
          </Notice>
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)} variant="outline" size="sm">
              Cancel
            </Button>
            <Button type="button" onClick={() => setOpen(false)} variant="default" size="sm">
              Create link
            </Button>
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
