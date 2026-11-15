import { ToastViewport, toast } from '@web/components/toast.tsx';
import { Button } from '@netlabor/ui/components/button';

export interface ToastSurfaceProps {
  infoMessage?: string;
  errorMessage?: string;
}

/**
 * The real toast store and viewport. Every open workspace and the docs share
 * one queue; the buttons push a message the same way an SSE event handler or
 * a failed mutation does.
 */
export default function ToastSurface({
  infoMessage = 'Maya joined the project',
  errorMessage = 'CONFLICT: node sw2 was changed by another editor',
}: ToastSurfaceProps) {
  return (
    <>
      <div className="docs-stack">
        <Button type="button" onClick={() => toast.info(infoMessage)} variant="default" size="sm">
          Collaborator joined
        </Button>
        <Button
          type="button"
          onClick={() => toast.error(errorMessage)}
          variant="destructive"
          size="sm"
        >
          Conflicting save
        </Button>
      </div>
      <ToastViewport />
    </>
  );
}
