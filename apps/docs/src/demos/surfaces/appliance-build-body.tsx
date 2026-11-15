import type { ComputeRow, OsImageRow } from '@netlabor/contract';
import { ApplianceBuildDialog } from '@web/features/appliances/appliance-dialogs.tsx';
import { useState } from 'react';
import { computes as fixtureComputes, osImages as fixtureOsImages } from '../fixtures/workspace.ts';

export interface ApplianceBuildSurfaceProps {
  osImages?: OsImageRow[];
  computes?: ComputeRow[];
}

/**
 * The real "New appliance build" dialog. The repository rows have no verified
 * artifact (`imageId: null`), so the product's own rule disables Start build
 * and shows its warning notice; no controller request is possible.
 */
export default function ApplianceBuildSurface({
  osImages = fixtureOsImages,
  computes = fixtureComputes,
}: ApplianceBuildSurfaceProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="nb-button"
        data-variant="primary"
        onClick={() => setOpen(true)}
      >
        New appliance build
      </button>
      {open ? (
        <ApplianceBuildDialog
          osImages={osImages}
          computes={computes}
          onOpenChange={(next) => setOpen(next)}
          onCreated={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
